/** Replay preserves the selected object independently of installed providers and rejects unsupported records. */
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import { expect, it, onTestFinished } from 'vitest'
import { workbenchProjection } from '../src/workbench-projection.ts'
import type { WorkbenchId, WorkbenchInstanceId } from '../src/types.ts'
import type { WorkbenchObjectId } from '../src/workbench-reference.ts'

const selection = { id: 'test:documents' as WorkbenchId, instanceId: 'f0000000-0000-4000-8000-000000000001' as WorkbenchInstanceId,
  name: '文档', version: '1', expert: null }

async function fixture() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(Projections)
  ctx.sessionProjections.register(workbenchProjection)
  const session = ctx.sessions.create(SessionId('object-replay'))
  return { ctx, session }
}

it('replays legacy selections, object bindings and detach records, retaining object identity in forks', async () => {
  const { ctx, session } = await fixture()
  session.append('actvero/workbench', { schemaVersion: 1, selection })
  expect(ctx.sessionProjections.stateOf(session, 'actveroWorkbench')).toEqual(selection)
  const bound = { ...selection, object: { id: 'document-a' as WorkbenchObjectId, label: '文档 A' } }
  session.append('actvero/workbench', { schemaVersion: 2, selection: bound })
  const restored = ctx.sessionProjections.restore({}, session.snapshotEvents(),
    SessionLogOffset(0), session.header, session.inheritedEventCount)
  expect(restored.checkpoint.actveroWorkbench?.val).toEqual(bound)
  const fork = ctx.sessions.fork(session)
  session.append('actvero/workbench', { schemaVersion: 1, selection: null })
  expect(ctx.sessionProjections.stateOf(session, 'actveroWorkbench')).toBeNull()
  expect(ctx.sessionProjections.stateOf(fork, 'actveroWorkbench')).toEqual(bound)
})

it.each([
  { schemaVersion: 3, selection },
  { schemaVersion: 2, selection },
  { schemaVersion: 2, selection: { ...selection, object: { id: '', label: '无效' } } },
  { schemaVersion: 1, selection: { ...selection, object: { id: 'a', label: 'A' } } },
])('refuses unsupported or incomplete persisted bindings: $schemaVersion', async (data) => {
  const { ctx, session } = await fixture()
  session.append('actvero/workbench', { schemaVersion: 1, selection })
  const event = { ...session.snapshotEvents().find(entry => entry.type === 'actvero/workbench')! }
  // Model corrupt JSONL data without weakening the production event union.
  Object.assign(event, { data })
  expect(() => ctx.sessionProjections.restore({}, [event], SessionLogOffset(0), session.header, session.inheritedEventCount)).toThrow()
})
