/** Durable workbench records keep CAS writes and provider lifecycle independent of presentation. */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkbenchRuntime } from '../src/runtime.ts'
import { WorkbenchStore } from '../src/store.ts'
import { CREATIVE_ID, exampleProviders } from '../src/examples.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'actvero-workbench-record-'))
  directories.push(root)
  const runtime = new WorkbenchRuntime(new Context(), root, 2500)
  const provider = exampleProviders()[0]!
  const dispose = runtime.register(provider)
  return { root, runtime, dispose }
}
it('opens without workspace services and rejects stale or invalid changes without losing records', async () => {
  const { root, runtime } = await fixture()
  const first = await runtime.action({ action: 'open', workbenchId: CREATIVE_ID })
  expect(await runtime.action({ action: 'open', workbenchId: CREATIVE_ID })).toEqual(first)
  const project = (await runtime.snapshot()).projects[0]!
  expect((await runtime.snapshot()).conversations).toEqual([])
  const data = { nodes: [{ id: 'brief', kind: 'text', title: '秋日新品 / Autumn launch', text: '本地保存的业务内容' }] }
  await runtime.action({ action: 'update', projectId: project.id, revision: 0, data })
  await expect(runtime.action({ action: 'update', projectId: project.id, revision: 0, data: project.data })).rejects.toMatchObject({ code: 'conflict' })
  await expect(runtime.action({ action: 'update', projectId: project.id, revision: 1, data: { notes: 'wrong provider' } })).rejects.toThrow()
  const restored = await new WorkbenchStore(root).read()
  expect(restored.projects[0]?.data).toEqual(data)
  expect(restored.projects[0]?.revision).toBe(1)
})
it('preserves corrupt state and rejects writes instead of replacing user data', async () => {
  const { root, runtime } = await fixture()
  await runtime.action({ action: 'open', workbenchId: CREATIVE_ID })
  const path = join(root, 'state.json'), source = '{"schemaVersion":99,"projects":[]}'
  await writeFile(path, source)
  await expect(runtime.snapshot()).rejects.toMatchObject({ code: 'invalid-state' })
  await expect(runtime.action({ action: 'open', workbenchId: CREATIVE_ID })).rejects.toMatchObject({ code: 'invalid-state' })
  expect(await readFile(path, 'utf8')).toBe(source)
})
it('serializes writes and retains data when a provider unloads', async () => {
  const { runtime, dispose } = await fixture()
  await Promise.all(Array.from({ length: 8 }, (_, i) => runtime.action({ action: 'create', workbenchId: CREATIVE_ID, title: String(i) })))
  expect((await runtime.snapshot()).projects).toHaveLength(8)
  dispose()
  expect((await runtime.snapshot()).definitions).toEqual([])
  expect((await runtime.snapshot()).projects).toHaveLength(8)
  await expect(runtime.action({ action: 'open', workbenchId: CREATIVE_ID })).rejects.toMatchObject({ code: 'unavailable' })
})
