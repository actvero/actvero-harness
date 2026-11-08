/** Package generation, compatibility refusal and executable Client registration. */
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runInNewContext } from 'node:vm'
import { create, extract } from 'tar'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { checkWorkbench, createWorkbench, doctorWorkbench, packWorkbench } from './actvero-workbench.client.ts'
import { bindWorkbenchProject, typecheckWorkbench } from './actvero-workbench-project.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))
const execute = promisify(execFile)

const roots: string[] = []
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'actvero-workbench-test-'))
  roots.push(path)
  return path
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('local workbench developer commands', () => {
  it('runs a blank project outside the checkout and rebinds after relocation without changing author files', async () => {
    const directory = await root()
    const original = join(directory, '空白 project')
    await createWorkbench(original)
    const identity = z.object({ name: z.string() })
    const report = z.object({ name: z.string(), warnings: z.array(z.string()) })
    const manifest = identity.parse(JSON.parse(await readFile(join(original, 'package.json'), 'utf8')))
    expect(manifest.name).toMatch(/^@local\/project-[a-f0-9]{8}$/u)
    expect((await doctorWorkbench(original)).warnings).toHaveLength(1)
    const design = '目标：整理客户资料。\n视觉：原生。\n'
    await writeFile(join(original, 'DESIGN.md'), design)
    const moved = join(directory, 'moved project')
    await rename(original, moved)
    await bindWorkbenchProject(moved, repository)
    expect(await readFile(join(moved, 'DESIGN.md'), 'utf8')).toBe(design)
    expect(identity.parse(JSON.parse(await readFile(join(moved, 'package.json'), 'utf8'))).name).toBe(manifest.name)
    const launcher = join(moved, 'scripts/workbench.mjs')
    const run = (...args: string[]) => execute(process.execPath, [launcher, ...args], { cwd: moved })
    expect(report.parse(JSON.parse((await run('doctor')).stdout)).warnings).toEqual([])
    await expect(run('check')).rejects.toMatchObject({ code: 1 })
    await run('typecheck')
    await run('pack')
    const checked = identity.parse(JSON.parse((await run('check')).stdout))
    expect(checked.name).toBe(manifest.name)
    await writeFile(join(moved, 'dist/another.tgz'), 'ambiguous archive')
    await expect(run('check')).rejects.toThrow('恰好一个')
    await rm(join(moved, '.actvero/toolchain.json'))
    await expect(run('doctor')).rejects.toThrow('bind')
    await run('bind', repository)
    expect(await readFile(join(moved, 'DESIGN.md'), 'utf8')).toBe(design)
    expect(report.parse(JSON.parse((await run('doctor')).stdout)).name).toBe(manifest.name)
  }, 90000)

  it('builds and registers native AI by following the guide without a JSON adapter or expert', async () => {
    const path = await root()
    const source = join(path, 'native AI only')
    await createWorkbench(source, '@local/native-ai-only', 'plain')
    const guide = await readFile(new URL('../actvero/workbench-development.zh.md', import.meta.url), 'utf8')
    const section = guide.split('<a id="native-ai"></a>')[1]!.split('<a id="expert-bundle"></a>')[0]!
    const entry = /```ts\n([\s\S]*?)\n```/u.exec(section)?.[1]
    if (!entry) throw new Error('Missing native AI example')
    await writeFile(join(source, 'src/index.ts'), entry + '\n')
    const archive = await packWorkbench(source, path)
    await extract({ cwd: path, file: archive })
    interface Provider { id: string; name: string; version: string; ai: boolean }
    const providers: Provider[] = []
    const disposers: (() => void)[] = []
    const ctx = {
      effect(callback: () => () => void) { disposers.push(callback()) },
      actveroWorkbenchRuntime: { register(provider: Provider) {
        providers.push(provider)
        return () => { providers.splice(providers.indexOf(provider), 1) }
      } },
    }
    const plugin = await import(pathToFileURL(join(path, 'package/lib/index.js')).href) as { apply(context: typeof ctx): void }
    plugin.apply(ctx)
    expect(providers).toEqual([{ id: '@local/native-ai-only', name: '项目清单', version: '1.0.0', ai: true }])
    for (const dispose of disposers.reverse()) dispose()
    expect(providers).toEqual([])
  })

  it('builds the AI template with native data, its expert and declared local skill', async () => {
    const path = await root()
    const source = join(path, 'AI development')
    await createWorkbench(source, '@local/ai-checklist', 'ai')
    const archive = await packWorkbench(source, path)
    expect((await checkWorkbench(archive)).name).toBe('@local/ai-checklist')
    await extract({ cwd: path, file: archive })
    const expert = JSON.parse(await readFile(join(path, 'package/assets/expert.json'), 'utf8')) as { skills: { key: string }[] }
    expect(expert.skills).toEqual([{ key: 'checklist', label: '清单操作', required: true, load: 'always' }])
    expect(await readFile(join(path, 'package/assets/skills/checklist/SKILL.md'), 'utf8')).toContain('workbench_read')
    expect(await readFile(join(path, 'package/lib/index.js'), 'utf8')).toContain('models:read')
    expect(await readFile(join(path, 'package/lib/client.js'), 'utf8')).toContain('ai-checklist')
  })

  it('copies a customized package, builds the real Client and releases its registration on disposal', async () => {
    const path = await root()
    const source = join(path, 'development with spaces')
    await createWorkbench(source, '@local/delivery-checklist', 'plain')
    await mkdir(join(source, 'assets', 'expert'), { recursive: true })
    await writeFile(join(source, 'assets', 'expert', 'expert.json'), '{"instructions":"本地资源"}')
    const archive = await packWorkbench(source, path)
    const checked = await checkWorkbench(archive)
    expect(checked.name).toBe('@local/delivery-checklist')
    expect(checked.sha256).toMatch(/^[a-f0-9]{64}$/u)
    await extract({ cwd: path, file: archive })
    expect(await readFile(join(path, 'package/assets/expert/expert.json'), 'utf8')).toContain('本地资源')
    const patch = load(await readFile(join(path, 'package/cordis.patch.yml'), 'utf8'))
    expect(patch).toEqual([{ insert: [{ id: '@local/delivery-checklist', name: '@local/delivery-checklist' }] }])
    interface Descriptor { id: string; name: string; version: string; previewUrls: string[] }
    const entries: Descriptor[] = []
    const disposers: (() => void)[] = []
    let loadedId: string | undefined
    runInNewContext(await readFile(join(path, 'package/lib/client.js'), 'utf8'), {
      window: { __ModuleLoader__: { load(value: { id: string; factory(require: (id: string) => object): { apply(ctx: object): void } }) {
        loadedId = value.id
        const plugin = value.factory(() => ({}))
        plugin.apply({
          effect(callback: () => () => void) { disposers.push(callback()) },
          locale: { register: () => () => {}, bind: () => () => '' },
          actveroWorkbenches: { register(descriptor: Descriptor) {
            entries.push(descriptor)
            return () => { entries.splice(entries.indexOf(descriptor), 1) }
          } },
        })
      } } },
    })
    expect(loadedId).toBe('@local/delivery-checklist')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: '@local/delivery-checklist', name: '项目清单', version: '1.0.0' })
    expect(entries[0]!.previewUrls).toHaveLength(2)
    expect(entries[0]!.previewUrls.every(url => url.startsWith('data:image/png;base64,'))).toBe(true)
    for (const dispose of disposers.reverse()) dispose()
    expect(entries).toEqual([])
    await writeFile(join(source, 'src/index.ts'), "import missing from 'actvero-definitely-uninstalled-testdependency'; export function apply() { return missing }\n")
    await expect(packWorkbench(source, path)).rejects.toThrow('Cannot find module')
    expect((await checkWorkbench(archive)).sha256).toBe(checked.sha256)
    const duplicate = join(path, 'duplicate.tgz')
    await create({ cwd: path, file: duplicate, gzip: true }, ['package', 'package/lib/index.js'])
    await expect(checkWorkbench(duplicate)).rejects.toThrow('重复路径')
    await writeFile(join(path, 'outside.txt'), 'outside the package')
    const outside = join(path, 'outside.tgz')
    await create({ cwd: path, file: outside, gzip: true }, ['package', 'outside.txt'])
    await expect(checkWorkbench(outside)).rejects.toThrow('包目录之外')
    await rm(join(path, 'package/lib/client.js'))
    const broken = join(path, 'broken.tgz')
    await create({ cwd: path, file: broken, gzip: true }, ['package'])
    await expect(checkWorkbench(broken)).rejects.toThrow('缺少入口文件')
  })

  it('preserves an existing directory and refuses a package requiring another runtime', async () => {
    const path = await root()
    const directory = join(path, 'project')
    await createWorkbench(directory)
    const manifestPath = join(directory, 'package.json')
    const original = await readFile(manifestPath, 'utf8')
    await expect(createWorkbench(directory)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(manifestPath, 'utf8')).toBe(original)
    await writeFile(manifestPath, original.replace('0.2.1-rc.3', '999.0.0'))
    await expect(packWorkbench(directory, path)).rejects.toThrow('当前开发基线')
  })

  it('rejects author type errors before packaging and requires both entrypoints', async () => {
    const directory = join(await root(), 'invalid source')
    await createWorkbench(directory)
    await writeFile(join(directory, 'src/index.ts'), 'export const value: number = "wrong"\n')
    await expect(typecheckWorkbench(directory, repository)).rejects.toThrow('not assignable')
    await expect(packWorkbench(directory, join(directory, 'dist'))).rejects.toThrow('not assignable')
    await rm(join(directory, 'src/index.ts'))
    await expect(typecheckWorkbench(directory, repository)).rejects.toThrow('not found')
  })

  it('rejects an unrelated file before installation', async () => {
    const path = join(await root(), 'wrong.tgz')
    await writeFile(path, 'not a workbench')
    await expect(checkWorkbench(path)).rejects.toThrow('未通过客户端导入校验')
  })
})
