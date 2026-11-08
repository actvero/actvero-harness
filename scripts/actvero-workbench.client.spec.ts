/** Package generation, compatibility refusal and executable Client registration. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { create, extract } from 'tar'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { checkWorkbench, createWorkbench, packWorkbench } from './actvero-workbench.client.ts'

const roots: string[] = []
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'actvero-workbench-test-'))
  roots.push(path)
  return path
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('local workbench developer commands', () => {
  it('builds and registers native AI by following the guide without a JSON adapter or expert', async () => {
    const path = await root()
    const source = join(path, 'native AI only')
    await createWorkbench(source, '@local/native-ai-only')
    const guide = await readFile(new URL('../actvero/workbench-development.zh.md', import.meta.url), 'utf8')
    const section = guide.split('<a id="native-ai"></a>')[1]!.split('<a id="expert-bundle"></a>')[0]!
    const entry = /```js\n([\s\S]*?)\n```/u.exec(section)?.[1]
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
    const plugin: { apply(context: typeof ctx): void } = await import(pathToFileURL(join(path, 'package/lib/index.js')).href)
    plugin.apply(ctx)
    expect(providers).toEqual([{ id: '@local/native-ai-only', name: '项目清单', version: '1.0.0', ai: true }])
    for (const dispose of disposers.reverse()) dispose()
    expect(providers).toEqual([])
  })

  it('builds the AI template with native data, its expert and declared local skill', async () => {
    const path = await root()
    const source = join(path, 'AI development')
    await createWorkbench(source, undefined, 'ai')
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
    await createWorkbench(source, '@local/delivery-checklist')
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
    await writeFile(join(source, 'src/index.ts'), "import 'actvero-definitely-uninstalled-testdependency'; export function apply() {}\n")
    await expect(packWorkbench(source, path)).rejects.toThrow('依赖未解析')
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

  it('rejects an unrelated file before installation', async () => {
    const path = join(await root(), 'wrong.tgz')
    await writeFile(path, 'not a workbench')
    await expect(checkWorkbench(path)).rejects.toThrow('未通过客户端导入校验')
  })
})
