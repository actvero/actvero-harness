/** Package generation, compatibility refusal and executable Client registration. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  it('copies a customized package, builds the real Client and releases its registration on disposal', async () => {
    const path = await root()
    const source = join(path, 'development with spaces')
    await createWorkbench(source, '@local/delivery-checklist')
    const archive = await packWorkbench(source, path)
    const checked = await checkWorkbench(archive)
    expect(checked.name).toBe('@local/delivery-checklist')
    expect(checked.sha256).toMatch(/^[a-f0-9]{64}$/u)
    await extract({ cwd: path, file: archive })
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
