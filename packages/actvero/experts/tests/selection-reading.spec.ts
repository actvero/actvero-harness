import { it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Experts } from '../src/main.ts'

it('reads only bound local skills once and does not inspect unrelated connectors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'expert-selected-reading-'))
  const definition = { name: 'bound-skill', description: 'Example', content: 'CONTENT', source: 'actvero', provider: 'actvero-skills', invocation: { userInvocable: true, modelInvocable: true } }
  const hostList = vi.fn(async () => [{ id: 'local-skill', versionId: 'v1', name: 'bound-skill', description: 'Example' }])
  const hostGet = vi.fn(async () => definition)
  const connectors = vi.fn(async () => { throw new Error('unrelated service offline') })
  const engine = new Experts({ root, scope: () => 'member', changed: () => {}, skills: { hostList, hostGet }, connectors })
  try {
    await engine.save({ manifest: { schemaVersion: 1, id: 'local-report', version: '1.0.0', name: 'Report', description: 'Prepare a report', avatar: '', tags: [], instructions: 'Report', conversationStarters: [], skills: [{ key: 'report', label: 'Report', required: true, load: 'always' }], connectors: [] }, bindings: { skills: { report: 'local-skill' }, connectors: {} }, revision: 0 })
    const result = await engine.prepareRuntime('local-report')
    expect(hostList).toHaveBeenCalledWith(['local-skill'])
    expect(hostGet).toHaveBeenCalledTimes(1)
    expect(connectors).not.toHaveBeenCalled()
    expect(result.runtime.skills[0]?.content).toBe('CONTENT')
    hostGet.mockResolvedValue({ ...definition, content: 'CHANGED' })
    await expect(engine.resolve(result.lock.id)).rejects.toThrow('expert_skill_changed')
  } finally { await rm(root, { recursive: true, force: true }) }
})
