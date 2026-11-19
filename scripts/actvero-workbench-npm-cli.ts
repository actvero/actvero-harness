/** npm command for the pinned, offline workbench compiler; never starts Harness. */
import { localCapabilityCli } from './actvero-local-capability-cli.ts'
import { cliCommandName, parseWorkbenchInvocation, workbenchGuide, workbenchCommands } from './actvero-workbench-command-guide.ts'
import { printCliFailure, printCliResult, validateCliResult, WorkbenchCliError } from './actvero-workbench-cli-result.ts'
import { installDevelopmentSkills } from './actvero-development-skills.ts'
import { createReadStream, realpathSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { extract } from 'tar'
import { z } from 'zod'

const releaseSchema = z.object({
  schemaVersion: z.literal(1), name: z.string(), version: z.string(),
  platform: z.enum(['darwin', 'linux', 'win32']), arch: z.enum(['arm64', 'x64']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u), runtimeVersion: z.string(), hostApiVersion: z.string(),
})

async function releaseAt(directory: string) {
  return releaseSchema.parse(JSON.parse(await readFile(join(directory, 'release.json'), 'utf8')))
}

/** Extract the immutable bundled compiler into a private cache, shared by concurrent invocations.
 * @param directory Installed npm package directory.
 * @param cacheRoot Parent directory owned by this tool; caller chooses an isolated root in tests.
 * @returns Ready compiler directory; integrity or platform failures leave existing caches untouched.
 */
export async function ensureNpmWorkbenchKit(directory: string, cacheRoot: string): Promise<string> {
  const release = await releaseAt(directory)
  if (release.platform !== process.platform || release.arch !== process.arch) {
    throw new Error(`此开发套件仅支持 ${release.platform}-${release.arch}，当前为 ${process.platform}-${process.arch}。`)
  }
  const destination = join(resolve(cacheRoot), release.sha256)
  const ready = async (): Promise<boolean> => {
    try { await access(destination) } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
      throw error
    }
    const marker = await readFile(join(destination, '.npm-kit-ready'), 'utf8')
    if (marker !== release.sha256) throw new Error(`套件缓存不完整，请移走后重试：${destination}`)
    await access(join(destination, 'scripts/actvero-workbench.client.mjs'))
    return true
  }
  if (await ready()) return destination
  const archive = join(directory, 'kit.tgz')
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(archive)) hash.update(bytes)
  if (hash.digest('hex') !== release.sha256) throw new Error('开发套件校验失败，请重新安装 npm 包。')
  await mkdir(cacheRoot, { recursive: true })
  const temporary = await mkdtemp(join(resolve(cacheRoot), '.extract-'))
  try {
    await extract({ file: archive, cwd: temporary, strip: 1, strict: true })
    await access(join(temporary, 'scripts/actvero-workbench.client.mjs'))
    const kit = z.object({ platform: z.string(), arch: z.string(), runtimeVersion: z.string() })
      .parse(JSON.parse(await readFile(join(temporary, 'workbench-kit.json'), 'utf8')))
    if (kit.platform !== release.platform || kit.arch !== release.arch || kit.runtimeVersion !== release.runtimeVersion) {
      throw new Error('开发套件元数据与 npm 发行版本不一致。')
    }
    await writeFile(join(temporary, '.npm-kit-ready'), release.sha256)
    try { await rename(temporary, destination) } catch (error) {
      if (!(error instanceof Error && 'code' in error && ['EEXIST', 'ENOTEMPTY'].includes(String(error.code)) && await ready())) throw error
    }
    return destination
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

/** Copy the three shared authoring Skills without replacing existing user instructions.
 * @param kit Verified compiler directory.
 * @param destination Agent Skill collection directory, not an individual Skill path.
 * @returns Installed Skill paths.
 */
export async function installWorkbenchSkills(kit: string, destination: string): Promise<string[]> {
  return installDevelopmentSkills(kit, destination)
}

async function main(args: string[]): Promise<void> {
  const guide = workbenchGuide(args)
  if (guide !== undefined) { console.log(guide); return }
  const { name, entry, machine, values, positionals } = parseWorkbenchInvocation(args)
  if (entry.input) {
    printCliResult(name, await localCapabilityCli(args), machine)
    return
  }
  const directory = fileURLToPath(new URL('../', import.meta.url))
  const release = await releaseAt(directory)
  if (name === 'version') {
    printCliResult(name, { version: release.version }, machine, release.version)
    return
  }
  const kit = await ensureNpmWorkbenchKit(directory, process.env['ACTVERO_WORKBENCH_CACHE_DIR'] ?? join(homedir(), '.cache/actvero-workbench'))
  const print = (result: unknown) => printCliResult(name, validateCliResult(entry.output, result, false, entry.recovery), machine)
  if (name === 'info') {
    print({ ...release, directory: kit, skills: join(kit, 'packages/actvero/capability-ui/assets') })
    return
  }
  if (name === 'skills.install' || name === 'skills.update') {
    const destination = values.global ? join(homedir(), '.agents/skills') : resolve(positionals[0] ?? '.agents/skills')
    print({ installed: await installDevelopmentSkills(kit, destination, name === 'skills.update') })
    return
  }
  const child = spawn(process.execPath, [join(kit, 'scripts/actvero-workbench.client.mjs'), ...args], { stdio: 'inherit', shell: false })
  const interrupt = () => { child.kill('SIGINT') }
  const terminate = () => { child.kill('SIGTERM') }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  try {
    await new Promise<void>((resolveChild, reject) => {
      child.once('error', reject)
      child.once('close', (code) => {
        if (code === null && machine) { reject(new WorkbenchCliError('compiler_interrupted', '工作台执行进程已中断。', 'unknown')); return }
        process.exitCode = code ?? 1
        resolveChild()
      })
    })
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const name = cliCommandName(args)
  main(args).catch((error: unknown) => printCliFailure(error, name, args.includes('--json'), workbenchCommands[name]?.recovery))
}
