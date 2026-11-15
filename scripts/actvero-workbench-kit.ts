/** Export the coordinated compiler, templates and declarations as a relocatable local developer kit. */
import { cp, mkdir, readFile, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { build } from 'tsdown'
import ts from 'typescript'
import { z } from 'zod'
import { generateWorkbenchSkillReference } from './actvero-workbench-skill.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))
const manifestSchema = z.looseObject({ name: z.string(), version: z.string(), dependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional() })
const runtimeDependencies = ['typescript', 'tsdown', 'lightningcss', 'tar', 'zod', 'semver', '@types/node', '@types/react', '@types/react-dom']

/** Resolve a package despite export maps which hide package.json. */
function packageDirectory(name: string, from: string): string {
  const require = createRequire(join(from, 'package.json'))
  for (const search of require.resolve.paths(name) ?? []) {
    const candidate = join(search, name)
    if (ts.sys.fileExists(join(candidate, 'package.json'))) return candidate
  }
  try { return dirname(require.resolve(`${name}/package.json`)) } catch (_hiddenManifest) {
    let directory = dirname(require.resolve(name))
    for (;;) {
      if (ts.sys.fileExists(join(directory, 'package.json'))) {
        const candidate = manifestSchema.safeParse(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')))
        if (candidate.success && candidate.data.name === name) return directory
      }
      const parent = dirname(directory)
      if (parent === directory) throw new Error(`无法定位开发依赖：${name}`)
      directory = parent
    }
  }
}

/** Export into a new directory; native compiler dependencies match this machine's platform and architecture.
 * @param destination New kit directory, never an existing project or source checkout.
 * @returns Absolute kit location and the exact runtime baseline.
 */
export async function exportWorkbenchKit(destination: string): Promise<{ path: string; runtimeVersion: string }> {
  const output = resolve(destination)
  await mkdir(dirname(output), { recursive: true })
  await mkdir(output)
  const baseline = z.object({ version: z.string() }).parse(JSON.parse(await readFile(join(repository, 'actvero/upstream.lock.json'), 'utf8')))
  const copied = new Map<string, string>()
  const copyDependency = async (source: string): Promise<string> => {
    source = await realpath(source)
    const found = copied.get(source)
    if (found) return found
    const parsedManifest = manifestSchema.safeParse(JSON.parse(await readFile(join(source, 'package.json'), 'utf8')))
    if (!parsedManifest.success) throw new Error(`无效开发依赖清单：${source}`, { cause: parsedManifest.error })
    const manifest = parsedManifest.data
    const key = createHash('sha256').update(relative(repository, source)).digest('hex').slice(0, 16)
    const target = join(output, 'node_modules/.store', key)
    copied.set(source, target)
    await cp(source, target, { recursive: true, dereference: true, filter: file => !relative(source, file).split('/').includes('node_modules') })
    const names = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {})])
    for (const name of names) {
      let dependency: string
      try { dependency = packageDirectory(name, source) } catch (error) {
        if (name in (manifest.optionalDependencies ?? {}) || name in (manifest.peerDependencies ?? {})) continue
        throw error
      }
      await linkDependency(name, await copyDependency(dependency), join(target, 'node_modules'))
    }
    return target
  }
  const linkDependency = async (name: string, target: string, modules: string) => {
    const link = join(modules, name)
    await mkdir(dirname(link), { recursive: true })
    if (!ts.sys.fileExists(join(link, 'package.json'))) await symlink(relative(dirname(link), target), link, 'dir')
  }
  for (const name of runtimeDependencies) await linkDependency(name, await copyDependency(packageDirectory(name, repository)), join(output, 'node_modules'))
  for (const path of ['tsconfig.base.json', 'tsconfig.base.client.json', 'scripts/types', 'actvero/upstream.lock.json', 'actvero/templates', 'LICENSE']) {
    await mkdir(dirname(join(output, path)), { recursive: true })
    await cp(join(repository, path), join(output, path), { recursive: true })
  }
  // Installed declarations and runtime exports are SDK artifacts, never source-checkout aliases.
  for (const parent of ['packages', 'vendor']) {
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(join(repository, directory), { withFileTypes: true })) {
        if (!entry.isDirectory() || ['node_modules', 'src', 'tests', 'lib'].includes(entry.name)) continue
        const path = join(directory, entry.name)
        const manifestPath = join(repository, path, 'package.json')
        if (!ts.sys.fileExists(manifestPath)) { await visit(path); continue }
        if (!ts.sys.directoryExists(join(repository, path, 'lib'))) continue
        await mkdir(join(output, path), { recursive: true })
        await cp(manifestPath, join(output, path, 'package.json'))
        for (const file of await readdir(join(repository, path))) {
          if (/^(?:licen[cs]e|notice|copying)(?:[.-].*)?$/iu.test(file)) {
            await cp(join(repository, path, file), join(output, path, file), { recursive: true })
          }
        }
        await cp(join(repository, path, 'lib'), join(output, path, 'lib'), { recursive: true, filter: file => !file.endsWith('.map') })
        const { name } = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
        await linkDependency(name, join(output, path), join(output, 'node_modules'))
      }
    }
    await visit(parent)
  }
  // Resolve the declaration graph using all three supported authoring templates.
  const config = ts.readConfigFile(join(repository, 'tsconfig.base.client.json'), file => ts.sys.readFile(file))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repository)
  const roots = ['blank-workbench', 'project-checklist', 'ai-checklist'].flatMap(template => ['src/index.ts', 'src/client/index.ts'].map(file => join(repository, 'actvero/templates', template, file)))
  const program = ts.createProgram(roots, { ...parsed.options, noEmit: true, types: ['node', 'client-build-environment'] })
  const imports = new Set<string>()
  for (const file of program.getSourceFiles()) {
    for (const item of ts.preProcessFile(file.text).importedFiles) {
      if (!item.fileName.startsWith('.') && !isBuiltin(item.fileName)) imports.add(item.fileName.split('/').slice(0, item.fileName.startsWith('@') ? 2 : 1).join('/'))
    }
  }
  for (const name of imports) {
    if (ts.sys.fileExists(join(output, 'node_modules', name, 'package.json'))) continue
    let source: string
    try { source = packageDirectory(name, repository) } catch (_notDirectDependency) { continue }
    await linkDependency(name, await copyDependency(source), join(output, 'node_modules'))
  }
  for (const skill of ['develop-workbench', 'workbench-frontend']) {
    await cp(join(repository, 'packages/actvero/capability-ui/assets', skill), join(output, 'packages/actvero/capability-ui/assets', skill), { recursive: true })
  }
  generateWorkbenchSkillReference(
    join(output, 'packages/actvero/capability-ui/assets/develop-workbench/reference'), 'standalone-kit',
  )
  const environment = { schemaVersion: 1, runtimeVersion: baseline.version,
    platform: process.platform, arch: process.arch, node: process.versions.node }
  await writeFile(join(output, 'workbench-kit.json'), JSON.stringify(environment, null, 2) + '\n')
  await writeFile(join(output, 'package.json'), JSON.stringify({ name: '@actvero/workbench-development-kit', version: baseline.version, private: true, type: 'module' }, null, 2) + '\n')
  await build({ entry: { 'actvero-workbench.client': join(repository, 'scripts/actvero-workbench.client.ts') }, outDir: join(output, 'scripts'),
    format: 'esm', platform: 'node', target: 'node22', fixedExtension: true, config: false, clean: false, dts: false, sourcemap: false,
    deps: { neverBundle: runtimeDependencies } })
  await stat(join(output, 'scripts/actvero-workbench.client.mjs'))
  await writeFile(join(output, 'README.md'), '# 工作台开发套件\n\n面向工作台开发者和 Agent；无需 Harness 源码。需要与套件匹配的操作系统、CPU 架构和 Node 版本。\n\n运行 `node scripts/actvero-workbench.client.mjs create /绝对路径/my-workbench` 创建项目，再按项目 AGENTS.md 开发。套件可以移动；已有项目通过 `node scripts/workbench.mjs bind /套件新路径` 重新绑定。安装与真实业务验收使用目标 Harness 客户端。\n')
  return { path: output, runtimeVersion: baseline.version }
}

// Match Node's physical module URL when the checkout is reached through a directory symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const destination = process.argv[2]
  if (!destination) throw new Error('用法：tsx scripts/actvero-workbench-kit.ts <新套件目录>')
  console.log(JSON.stringify(await exportWorkbenchKit(destination)))
}
