// @vitest-environment jsdom
/** Explicit object navigation reuses only matching conversations and leaves other targets intact. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkbenchClientRuntime } from '../src/client/workbenches/runtime.ts'
import type { WorkbenchId, WorkbenchInstanceId, WorkbenchSelection } from '../src/types.ts'
import type { WorkbenchObjectId } from '../src/workbench-reference.ts'

const instanceId = 'documents' as WorkbenchInstanceId
const a = 'document-a' as WorkbenchObjectId
const b = 'document-b' as WorkbenchObjectId
const sessions = { a: 'chat-a' as SessionId, b: 'chat-b' as SessionId, all: 'chat-all' as SessionId, fresh: 'fresh' as SessionId }
const selection: WorkbenchSelection = { id: 'test:documents' as WorkbenchId, instanceId, name: '文档', version: '1', expert: null }

async function fixture() {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  for (const [id, object] of [
    [sessions.a, { id: a, label: '文档 A' }], [sessions.b, { id: b, label: '文档 B' }], [sessions.all, undefined],
  ] as const) {
    await runtime.sessions.add({ id })
    await runtime.sessions.updateSummary(id, { projectionValues: { actveroWorkbench: { ...selection, ...(object ? { object } : {}) } } })
  }
  const bind = vi.fn((request: { sessionId?: SessionId }) => Promise.resolve({ ok: true as const,
    value: { sessionId: request.sessionId ?? sessions.fresh } }))
  runtime.remote.provideNamespaces({ actveroWorkbench: { bind } })
  return { runtime, bind, client: new WorkbenchClientRuntime(runtime.ctx) }
}

it('chooses the requested object instead of rebinding the currently displayed conversation', async () => {
  const { client, bind, runtime } = await fixture()
  expect(await client.conversation(instanceId, sessions.a, { objectId: b })).toBe(sessions.b)
  expect(bind).toHaveBeenLastCalledWith({ instanceId, sessionId: sessions.b, objectId: b, expectedObjectId: b })
  expect(runtime.ctx.sessions.list.getSnapshot().byId[sessions.a]?.projectionValues?.actveroWorkbench?.object?.id).toBe(a)
  expect(await client.conversation(instanceId, sessions.b, { objectId: null })).toBe(sessions.all)
  expect(bind).toHaveBeenLastCalledWith({ instanceId, sessionId: sessions.all, objectId: null, expectedObjectId: null })
  expect(await client.conversation(instanceId, sessions.a, { objectId: b, fresh: true })).toBe(sessions.fresh)
  expect(bind).toHaveBeenLastCalledWith({ instanceId, objectId: b })
})

it('creates a new conversation for an unmatched object and preserves explicit associations when options are omitted', async () => {
  const { client, bind } = await fixture()
  const missing = 'document-c' as WorkbenchObjectId
  expect(await client.conversation(instanceId, sessions.a, { objectId: missing })).toBe(sessions.fresh)
  expect(bind).toHaveBeenLastCalledWith({ instanceId, objectId: missing })
  expect(await client.conversation(instanceId, sessions.a)).toBe(sessions.a)
  expect(bind).toHaveBeenLastCalledWith({ instanceId, sessionId: sessions.a })
})

it('exposes the recorded target to the renderer and waits for binding before revealing the selected conversation', async () => {
  const { client, bind } = await fixture()
  const reveal = vi.fn(async () => {})
  const context = client.context(instanceId, sessions.a, reveal,
    async () => { throw new Error('Unused display') }, () => { throw new Error('Unused display state') },
    async () => { throw new Error('Unused reference') })
  expect(context.object).toEqual({ id: a, label: '文档 A' })
  await context.conversation({ objectId: b })
  expect(reveal).toHaveBeenCalledExactlyOnceWith(sessions.b)
  bind.mockRejectedValueOnce(new Error('Object unavailable'))
  await expect(context.conversation({ objectId: b })).rejects.toThrow('Object unavailable')
  expect(reveal).toHaveBeenCalledOnce()
})
