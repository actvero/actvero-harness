/** Verify the archived runtime in a branded application using isolated temporary profiles. */
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import ts from 'typescript'
import { desktopNodeEnvironment } from '../apps/desktop/src/node-environment.ts'
import { join } from 'node:path'
import { resolveDesktopTargetBuildPaths } from '../apps/desktop/scripts/desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../apps/desktop/src/runtime-tree.ts'
import { smokePreparedRuntime } from '../apps/desktop/scripts/smoke-prepared-runtime.ts'
import type { BuildProduct } from '../apps/desktop/src/actvero/build-product.ts'

/** Verify that the actual ASAR carries the compiled Main bundle and resolves its external imports. */
async function verifyMainImports(archive: string, executable: string): Promise<void> {
  const compiled = readFileSync(join(import.meta.dirname, '../apps/desktop/lib/main.js'), 'utf8')
  const source = ts.createSourceFile('main.js', compiled, ts.ScriptTarget.Latest)
  const imports = source.statements.filter(ts.isImportDeclaration)
    .map(statement => (statement.moduleSpecifier as ts.StringLiteral).text)
    .filter(name => name !== 'electron')
  const script = `const fs = require('node:fs'); const {createRequire} = require('node:module');
    const main = process.argv[1];
    if (fs.readFileSync(main, 'utf8') !== fs.readFileSync(process.argv[2], 'utf8')) throw new Error('packaged Main differs from the build');
    const resolve = createRequire(main).resolve; const {isBuiltin} = require('node:module');
    const archive = process.argv[4] + require('node:path').sep;
    for (const name of JSON.parse(process.argv[3])) {
      const path = resolve(name);
      if (!isBuiltin(name) && !path.startsWith(archive)) throw new Error('Main import escaped the archive: ' + name);
    }
    console.log('ACTVERO package: Main external imports resolve inside the archive');`
  const { stdout } = await promisify(execFile)(executable,
    ['--eval', script, join(archive, 'lib/main.js'), join(import.meta.dirname, '../apps/desktop/lib/main.js'), JSON.stringify(imports), archive],
    { timeout: 30_000, windowsHide: true, env: desktopNodeEnvironment(executable, undefined, { ...process.env, NODE_OPTIONS: '' }) })
  process.stdout.write(stdout)
}

async function main(): Promise<void> {
  const directory = process.env.ACTVERO_BRANDING_DIRECTORY
  if (!directory) throw new Error('ACTVERO smoke: run through actvero:package')
  const product = JSON.parse(readFileSync(join(directory, 'build-product.json'), 'utf8')) as BuildProduct
  const platform = process.env.DSH_DESKTOP_TARGET_PLATFORM, arch = process.env.DSH_DESKTOP_TARGET_ARCH
  if (platform !== 'darwin' && platform !== 'win32' || arch !== 'arm64' && arch !== 'x64') throw new Error('ACTVERO smoke: invalid target')
  const output = join(directory, 'artifacts', `${platform}-${arch}`)
  const application = platform === 'win32' ? join(output, 'win-unpacked')
    : join(output, arch === 'arm64' ? 'mac-arm64' : 'mac', `${product.displayName}.app`, 'Contents')
  const staging = platform === 'win32' ? mkdtempSync(join(realpathSync.native(tmpdir()), 'actv-')) : undefined
  const errors: unknown[] = []
  try {
    // Python and the Office helper require short physical paths when Windows long paths are disabled.
    const smokeApplication = staging === undefined ? application : join(staging, 'app')
    if (staging !== undefined) cpSync(application, smokeApplication, { recursive: true, force: false, errorOnExist: true })
    const resources = join(smokeApplication, platform === 'win32' ? 'resources' : 'Resources')
    const executable = platform === 'win32' ? join(smokeApplication, `${product.displayName}.exe`)
      : join(smokeApplication, 'MacOS', product.displayName)
    await verifyMainImports(join(resources, 'app.asar'), executable)
    const paths = resolveDesktopTargetBuildPaths()
    const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version, { platform, arch })
    await smokePreparedRuntime(join(resources, 'app.asar', 'dsh'), executable, join(resources, 'runtime'), descriptor)
  } catch (error) {
    errors.push(error)
  }
  if (staging !== undefined) {
    try { rmSync(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
    catch (error) { errors.push(error) }
  }
  if (errors.length) throw new AggregateError(errors, 'ACTVERO package: archived runtime verification or cleanup failed')
  console.log(`ACTVERO package: verified archived runtime for ${product.displayName} ${product.version}`)
}
if (import.meta.main) await main()
