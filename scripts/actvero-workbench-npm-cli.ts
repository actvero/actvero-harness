/** npm command for the pinned, offline workbench compiler; never starts Harness. */
import { localCapabilityCli } from './actvero-local-capability-cli.ts'
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

async function main(): Promise<void> {
  const directory = fileURLToPath(new URL('../', import.meta.url))
  const release = await releaseAt(directory)
  const args = process.argv.slice(2)
  const command = args[0]
  if (!command || command === '--help') {
    console.log('actvero-workbench create <新目录> [包名] [--template blank|plain|ai]\nactvero-workbench bind|doctor|typecheck|dev|pack|check <路径>\nactvero-workbench attach <项目目录> --connection <连接文件>\nactvero-workbench status|logs|detach <项目目录>\nactvero-workbench expert <操作> --connection <连接文件> [--file <请求.json>]\nactvero-workbench skill|mcp <操作> --connection <连接文件> [--file <请求.json>]\nactvero-workbench info\nactvero-workbench skills install|update [--global | <Skill目录>]\nactvero-workbench --version\n\n--global 安装到 ~/.agents/skills；更新会保留用户修改的 Skill。默认安装到当前目录的 .agents/skills。')
    return
  }
  if (command === 'skill' || command === 'mcp') {
    console.log(JSON.stringify(await localCapabilityCli(args), null, 2))
    return
  }
  if (args[0] === '--version') { console.log(release.version); return }
  const kit = await ensureNpmWorkbenchKit(directory, process.env['ACTVERO_WORKBENCH_CACHE_DIR'] ?? join(homedir(), '.cache/actvero-workbench'))
  if (args[0] === 'info' && args.length === 1) {
    console.log(JSON.stringify({ ...release, directory: kit, skills: join(kit, 'packages/actvero/capability-ui/assets') }, null, 2))
    return
  }
  if (args[0] === 'skills') {
    if (!['install', 'update'].includes(args[1] ?? '') || args.length > 3 || args[2]?.startsWith('--') && args[2] !== '--global') throw new Error('用法：actvero-workbench skills install|update [--global | <Skill目录>]')
    const destination = args[2] === '--global' ? join(homedir(), '.agents/skills') : resolve(args[2] ?? '.agents/skills')
    console.log(JSON.stringify({ installed: await installDevelopmentSkills(kit, destination, args[1] === 'update') }, null, 2))
    return
  }
  if (!['create', 'bind', 'doctor', 'typecheck', 'dev', 'pack', 'check', 'attach', 'detach', 'status', 'logs', 'expert'].includes(command)) throw new Error('未知命令，请运行 actvero-workbench --help。')
  const child = spawn(process.execPath, [join(kit, 'scripts/actvero-workbench.client.mjs'), ...args], { stdio: 'inherit', shell: false })
  const interrupt = () => { child.kill('SIGINT') }
  const terminate = () => { child.kill('SIGTERM') }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  try {
    await new Promise<void>((resolveChild, reject) => {
      child.once('error', reject)
      child.once('close', (code) => { process.exitCode = code ?? 1; resolveChild() })
    })
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
}
