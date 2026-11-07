/** Create and package local Actvero workbenches through the existing client compiler. */
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { create, list } from 'tar'
import { build } from 'tsdown'
import semver from 'semver'
import { z } from 'zod'
import { clientBundle } from '../packages/client/tsdown.client.ts'
import { readWorkbenchPackage } from '../packages/actvero/capability-ui/src/client/workbenches/archive.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))
const template = join(repository, 'actvero/templates/project-checklist')
const packageName = z.string().max(214).regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u)
const manifestSchema = z.object({
  name: packageName,
  version: z.string().refine(value => semver.valid(value) === value, '版本必须是完整的 SemVer'),
  type: z.literal('module'),
  engines: z.object({ dsh: z.string().refine(value => semver.validRange(value) !== null, 'DSH 版本范围无效') }),
  exports: z.object({ '.': z.literal('./lib/index.js'), './client': z.literal('./lib/client.js') }),
  dsh: z.object({
    actveroWorkbench: z.literal(1),
    bundle: z.object({ patch: z.literal('./cordis.patch.yml') }),
    client: z.object({ platform: z.literal('web'), inject: z.array(z.string()).refine(value => value.includes('@actvero/dsh-capability-ui')) }).loose(),
  }).loose(),
}).loose()
const metadataSchema = z.object({
  name: z.string().trim().min(1), description: z.string().trim().min(1),
  category: z.enum(['office', 'engineering', 'design', 'content', 'data', 'education', 'lifestyle', 'general', 'uncategorized']).optional(),
  author: z.string().optional(), tags: z.array(z.string()).optional(),
}).strict()

async function json(path: string): Promise<unknown> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  return value
}

/** Copy the editable checklist template without replacing an existing directory.
 * @param destination New development directory.
 * @param name Stable npm package identity; display text is edited in workbench.json.
 */
export async function createWorkbench(destination: string, name = '@local/project-checklist'): Promise<void> {
  packageName.parse(name)
  const directory = resolve(destination)
  await mkdir(dirname(directory), { recursive: true })
  await mkdir(directory)
  for (const entry of await readdir(template)) {
    await cp(join(template, entry), join(directory, entry), { recursive: true, errorOnExist: true, force: false })
  }
  const manifest = manifestSchema.parse(await json(join(directory, 'package.json')))
  await writeFile(join(directory, 'package.json'), JSON.stringify({ ...manifest, name }, null, 2) + '\n')
}

/** Validate a built archive with the same preflight the desktop import uses.
 * @param archive Absolute or relative .tgz path.
 * @returns Package identity, archive size and SHA-256 for this local artifact.
 */
export async function checkWorkbench(archive: string): Promise<{ name: string; bytes: number; sha256: string }> {
  const size = (await stat(archive)).size
  if (size > 8 * 1024 * 1024) throw new Error('工作台包超过客户端的 8 MiB 导入限制。')
  const bytes = await readFile(archive)
  const summary = await readWorkbenchPackage(new File([new Uint8Array(bytes)], basename(archive)))
  if (!summary) throw new Error('工作台包未通过客户端导入校验，请检查 .tgz 与 package.json。')
  const files = new Set<string>()
  const paths = new Set<string>()
  const manifestChunks: Buffer[] = []
  const invalidPaths: string[] = []
  await list({ file: archive, onReadEntry(entry) {
    const path = entry.path
    if (!path.startsWith('package/') || path.includes('\\') || path.split('/').includes('..')
      || !['File', 'Directory'].includes(entry.type) || paths.has(path)) invalidPaths.push(path)
    paths.add(path)
    if (entry.type === 'File' && entry.size > 0) files.add(path)
    if (path === 'package/package.json') entry.on('data', (chunk: Buffer) => { manifestChunks.push(chunk) })
  } })
  if (invalidPaths.length) throw new Error('工作台包包含重复路径、链接或包目录之外的文件。')
  const manifest = manifestSchema.parse(JSON.parse(Buffer.concat(manifestChunks).toString('utf8')))
  for (const file of [manifest.exports['.'], manifest.exports['./client'], manifest.dsh.bundle.patch]) {
    if (!files.has(`package/${file.slice(2)}`)) throw new Error(`工作台包缺少入口文件：${file}`)
  }
  return { name: summary.name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

/** Compile a template project and emit an npm-compatible archive; no install or publication occurs.
 * @param directory Editable template project containing src/index.ts and src/client/index.ts.
 * @param output Directory receiving the versioned .tgz.
 * @returns Absolute path of the validated archive.
 */
export async function packWorkbench(directory: string, output: string): Promise<string> {
  directory = resolve(directory)
  output = resolve(output)
  const manifest = manifestSchema.parse(await json(join(directory, 'package.json')))
  const metadata = metadataSchema.parse(await json(join(directory, 'workbench.json')))
  const baseline = z.object({ version: z.string() }).parse(await json(join(repository, 'actvero/upstream.lock.json')))
  if (!semver.satisfies(baseline.version, manifest.engines.dsh, { includePrerelease: true })) {
    throw new Error(`工作台要求 DSH ${manifest.engines.dsh}，当前开发基线为 ${baseline.version}。`)
  }
  const temporary = await mkdtemp(join(tmpdir(), 'actvero-workbench-pack-'))
  try {
    const folder = join(temporary, 'package')
    const lib = join(folder, 'lib')
    await mkdir(lib, { recursive: true })
    // Reuse the host/client compiler, including shared React, CSS Modules and image imports.
    for (const config of clientBundle(directory, ['src/index.ts'])({})) {
      await build({ ...config, cwd: directory, outDir: lib, config: false, tsconfig: join(repository, 'tsconfig.base.client.json'), sourcemap: false })
    }
    for (const file of ['index.js', 'client.js']) await stat(join(lib, file))
    if ((await readdir(directory)).includes('assets')) await cp(join(directory, 'assets'), join(folder, 'assets'), { recursive: true })
    await mkdir(join(folder, 'locale'))
    await writeFile(join(folder, 'locale/en.json'), JSON.stringify({ meta: { title: metadata.name, description: metadata.description } }) + '\n')
    await writeFile(join(folder, 'package.json'), JSON.stringify({ ...manifest, description: metadata.description,
      exports: { ...manifest.exports, './package.json': './package.json', './locale/*.json': './locale/*.json' },
      files: ['lib', 'locale', 'assets', 'cordis.patch.yml'],
    }, null, 2) + '\n')
    await writeFile(join(folder, 'cordis.patch.yml'), `- insert:\n    - id: ${JSON.stringify(manifest.name)}\n      name: ${JSON.stringify(manifest.name)}\n`)
    const archiveName = `${manifest.name.replace(/^@/u, '').replaceAll('/', '-')}-${manifest.version}.tgz`
    const packed = join(temporary, archiveName)
    await create({ cwd: temporary, file: packed, gzip: true, portable: true }, ['package'])
    await checkWorkbench(packed)
    await mkdir(output, { recursive: true })
    // Copy before renaming so outputs on another volume are supported.
    const staging = await mkdtemp(join(output, '.workbench-pack-'))
    try {
      await cp(packed, join(staging, archiveName))
      await rename(join(staging, archiveName), join(output, archiveName))
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
    return join(output, archiveName)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const [command, path, argument] = process.argv.slice(2)
  if (!path || process.argv.length > 5) throw new Error('用法：workbench create <新目录> [包名] | pack <项目目录> [输出目录] | check <归档.tgz>')
  if (command === 'create') {
    await createWorkbench(path, argument)
    console.log(`已创建工作台开发目录：${resolve(path)}`)
  } else if (command === 'pack') {
    const archive = await packWorkbench(path, argument ?? join(path, 'dist'))
    console.log(JSON.stringify({ path: archive, ...await checkWorkbench(archive) }, null, 2))
  } else if (command === 'check' && argument === undefined) {
    console.log(JSON.stringify(await checkWorkbench(path), null, 2))
  } else {
    throw new Error('未知命令，请使用 create、pack 或 check。')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
