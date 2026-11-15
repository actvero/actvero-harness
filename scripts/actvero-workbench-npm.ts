/** Prepare an npm distribution containing the immutable compiler archive and its command. */
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createReadStream, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { create } from 'tar'
import { build } from 'tsdown'
import { z } from 'zod'
import { valid } from 'semver'
import { exportWorkbenchKit } from './actvero-workbench-kit.ts'
import { WORKBENCH_HOST_API_VERSION } from '../packages/actvero/capability-ui/src/workbench-version.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))
const distributionSchema = z.object({
  name: z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/u),
  version: z.string().refine(value => valid(value) !== null), tag: z.string().regex(/^[a-z][a-z0-9-]*$/u),
})

/** Export a locally testable npm package; publishing remains an explicit npm command.
 * @param destination New directory for the package contents.
 * @returns npm identity and absolute package directory.
 */
export async function prepareWorkbenchNpm(destination: string): Promise<{ name: string; version: string; tag: string; path: string }> {
  const distribution = distributionSchema.parse(JSON.parse(await readFile(join(repository, 'actvero/workbench-npm.json'), 'utf8')))
  const root = z.object({ engines: z.object({ node: z.string() }) }).parse(JSON.parse(await readFile(join(repository, 'package.json'), 'utf8')))
  const output = resolve(destination)
  await mkdir(dirname(output), { recursive: true })
  await mkdir(output)
  const temporary = await mkdtemp(join(dirname(output), '.workbench-npm-'))
  try {
    const kit = await exportWorkbenchKit(join(temporary, 'kit'))
    const archive = join(output, 'kit.tgz')
    await create({ cwd: temporary, file: archive, gzip: true, portable: true }, ['kit'])
    const hash = createHash('sha256')
    for await (const bytes of createReadStream(archive)) hash.update(bytes)
    await writeFile(join(output, 'release.json'), JSON.stringify({ schemaVersion: 1, name: distribution.name, version: distribution.version,
      platform: process.platform, arch: process.arch, sha256: hash.digest('hex'), runtimeVersion: kit.runtimeVersion,
      hostApiVersion: WORKBENCH_HOST_API_VERSION }, null, 2) + '\n')
    await writeFile(join(output, 'package.json'), JSON.stringify({
      name: distribution.name, version: distribution.version, type: 'module', license: 'MIT',
      description: 'ACTVERO 工作台独立开发套件：脚手架、编译打包与 Agent Skills。',
      engines: root.engines, os: [process.platform], cpu: [process.arch],
      bin: { 'actvero-workbench': './bin/actvero-workbench.mjs' },
      files: ['bin/', 'kit.tgz', 'release.json', 'README.md', 'README.en.md', 'LICENSE'],
      repository: { type: 'git', url: 'git+https://github.com/actvero/actvero-harness.git' },
      publishConfig: { registry: 'https://registry.npmjs.org/', access: 'public', tag: distribution.tag },
    }, null, 2) + '\n')
    await copyFile(join(repository, 'LICENSE'), join(output, 'LICENSE'))
    await writeFile(join(output, 'README.md'), (await readFile(join(repository, 'actvero/workbench-npm.zh.md'), 'utf8')).replace('(workbench-npm.md)', '(README.en.md)'))
    await writeFile(join(output, 'README.en.md'), (await readFile(join(repository, 'actvero/workbench-npm.md'), 'utf8')).replace('(workbench-npm.zh.md)', '(README.md)'))
    await build({ entry: { 'actvero-workbench': join(repository, 'scripts/actvero-workbench-npm-cli.ts') },
      outDir: join(output, 'bin'), format: 'esm', platform: 'node', target: 'node22', fixedExtension: true,
      config: false, dts: false, sourcemap: false, banner: '#!/usr/bin/env node', deps: { alwaysBundle: [/./u] } })
    await chmod(join(output, 'bin/actvero-workbench.mjs'), 0o755)
    return { ...distribution, path: output }
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const destination = process.argv[2]
  if (!destination || process.argv.length !== 3) throw new Error('用法：tsx scripts/actvero-workbench-npm.ts <新发行目录>')
  console.log(JSON.stringify(await prepareWorkbenchNpm(destination)))
}
