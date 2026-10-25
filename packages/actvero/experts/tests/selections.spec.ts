import { expect, it, vi } from 'vitest'
import { ExpertSelections } from '../src/selections.ts'
import type { Experts } from '../src/main.ts'

function setup() {
  let scope = 'member-a', revision = 0
  const value: Awaited<ReturnType<Experts['prepareRuntime']>> = {
    lock: { id: 'snapshot-a', expert: { manifest: { schemaVersion: 1, id: 'local-test', name: 'Test',
      version: '1.0.0', description: '', instructions: 'Test', tags: [], avatar: '',
      conversationStarters: [], skills: [], connectors: [] }, bindings: { skills: {}, connectors: {} }, revision: 1 },
    skills: [], connectors: [], warnings: [] },
    runtime: { snapshotId: 'snapshot-a', expert: { schemaVersion: 1, id: 'local-test', name: 'Test',
      version: '1.0.0', description: '', instructions: 'Test', tags: [], avatar: '',
      conversationStarters: [], skills: [], connectors: [] }, skills: [], connectors: [], warnings: [] },
  }
  const prepare = vi.fn(async () => value)
  const selections = new ExpertSelections({ scope: () => scope, revision: () => revision, prepare })
  return { selections, prepare, value, account: () => { scope = 'member-b' }, change: () => { revision++ } }
}

it('shares sequential and simultaneous preparation only until the summon finishes', async () => {
  const f = setup()
  let expired = ''
  await f.selections.run('local-test', async (operation) => {
    expired = operation
    const [a, b] = await Promise.all([f.selections.prepare(operation, 'local-test'), f.selections.prepare(operation, 'local-test')])
    expect(a).toBe(b)
    expect(await f.selections.resolve(operation, a.lock.id)).toBe(a.runtime)
    expect(await f.selections.resolve(operation, a.lock.id)).toBe(a.runtime)
    expect(f.prepare).toHaveBeenCalledTimes(1)
  })
  await expect(f.selections.resolve(expired, 'snapshot-a')).rejects.toThrow('expert_selection_expired')
  await f.selections.run('local-test', operation => f.selections.prepare(operation, 'local-test'))
  expect(f.prepare).toHaveBeenCalledTimes(2)
})

it.each(['account', 'change', 'invalidate'] as const)('rejects evidence after %s changes', async (kind) => {
  const f = setup()
  await expect(f.selections.run('local-test', async (operation) => {
    await f.selections.prepare(operation, 'local-test')
    if (kind === 'invalidate') f.selections.invalidate()
    else f[kind]()
    await f.selections.resolve(operation, 'snapshot-a')
  })).rejects.toThrow(/expert_(account_changed|dependencies_changed|selection_expired)/)
})

it('cannot borrow another expert or snapshot and cannot retain failed preparation', async () => {
  const f = setup()
  await f.selections.run('local-test', async (operation) => {
    await expect(f.selections.prepare(operation, 'other')).rejects.toThrow('expert_snapshot_invalid')
    await expect(f.selections.resolve(operation, 'snapshot-a')).rejects.toThrow('expert_snapshot_invalid')
    await f.selections.prepare(operation, 'local-test')
    await expect(f.selections.resolve(operation, 'other')).rejects.toThrow('expert_snapshot_invalid')
  })
  f.prepare.mockRejectedValueOnce(new Error('expert_remote_unavailable'))
  await expect(f.selections.run('local-test', operation => f.selections.prepare(operation, 'local-test'))).rejects.toThrow('expert_remote_unavailable')
  await expect(f.selections.run('local-test', operation => f.selections.prepare(operation, 'local-test'))).resolves.toEqual(f.value)
})
