import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { Experts } from '../src/main.ts'
import { desktopTestExpert } from '../src/defaults.ts'

it('ships an immediately usable local test expert once and preserves edits and deletion on restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actvero-default-expert-'))
  const options = { root, scope: () => undefined, changed: () => {}, defaults: [desktopTestExpert],
    skills: { hostList: async () => [], hostGet: async () => undefined }, connectors: async () => [] }
  try {
    const engine = new Experts(options)
    const expert = await engine.get(desktopTestExpert.manifest.id)
    expect(expert.revision).toBe(1)
    expect(await engine.recent()).toEqual([])
    const lock = await engine.prepare(expert.manifest.id)
    const runtime = await engine.resolve(lock.id)
    expect(runtime.expert.instructions).toContain('桌面测试专家已就绪')
    expect(runtime.skills).toEqual([])
    expect(runtime.connectors).toEqual([])
    await engine.save({ ...expert, manifest: { ...expert.manifest, name: 'Customized test expert' } })
    const restarted = new Experts(options)
    expect((await restarted.get(expert.manifest.id)).manifest.name).toBe('Customized test expert')
    await restarted.remove(expert.manifest.id)
    expect(await new Experts(options).list()).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('does not replace an existing expert with the same identifier', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actvero-existing-expert-'))
  const options = { root, scope: () => undefined, changed: () => {},
    skills: { hostList: async () => [], hostGet: async () => undefined }, connectors: async () => [] }
  try {
    const engine = new Experts(options)
    await engine.save({ ...desktopTestExpert, manifest: { ...desktopTestExpert.manifest, name: 'Existing expert' } })
    const seeded = new Experts({ ...options, defaults: [desktopTestExpert] })
    expect((await seeded.get(desktopTestExpert.manifest.id)).manifest.name).toBe('Existing expert')
    await seeded.remove(desktopTestExpert.manifest.id)
    expect(await new Experts({ ...options, defaults: [desktopTestExpert] }).list()).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})
