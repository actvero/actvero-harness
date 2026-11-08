/** 对象关联进入原生模型请求和日志，切换画面不修改目标；失效对象阻止后续请求。 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createUserMessage, LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { WorkbenchId, WorkbenchObjectId } from '@actvero/dsh-capability-ui'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { fixtureUserPrompts, launchWebScaffold, readPersistedEvents, recordFixture, webSnapshotMode } from './scaffold.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/actvero-workbench-object', import.meta.url))
const fixture = join(directory, 'session.v4.jsonl')
const provider = 'workbench-object-fixture'

class ObjectAdapter extends LlmAdapter {
  override async listModels() { return [{ provider, id: 'fixture', name: 'Fixture' }] }
  override async *stream(): AsyncIterable<StreamChunk> {
    const text = '当前对话关联文档 A。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it.skipIf(webSnapshotMode() === 'record')('records the fixed business object and refuses a missing target without falling back', async () => {
  const existing = existsSync(fixture)
  if (!existing && webSnapshotMode() !== 'refresh') throw new Error('Missing workbench object recording')
  const expected = existing ? await readFile(fixture, 'utf8') : ''
  const prompt = existing ? fixtureUserPrompts(expected)[0] : '当前对话关联哪份文档？'
  if (!prompt) throw new Error('Missing recorded workbench object input')
  const scaffold = await launchWebScaffold({ extraOverlayPath: join(directory, 'cordis.patch.yml'),
    ...(existing ? { replayFixture: fixture, replayProviders: [{ id: provider, name: provider,
      models: [{ id: 'fixture', name: 'Fixture', contextWindow: 128_000 }] }] } : {}),
  })
  try {
    const { ctx } = scaffold
    if (!existing) ctx.effect(() => ctx.llm.registerAdapter([provider], new ObjectAdapter()))
    await ctx.agentDefaultModel.saveSelection({ provider, model: 'fixture' })
    const runtime = ctx.actveroWorkbenchRuntime
    const id = 'test:object-recording' as WorkbenchId
    const objectId = 'document-a' as WorkbenchObjectId
    let available = true
    ctx.effect(() => runtime.register({ id, name: '文档管理', version: '1.0.0', ai: true,
      protocol: { schemaVersion: 1, hostApi: '^1.4.0' },
      resolveObject: async (target) => {
        if (!available || target !== objectId) throw new Error('Document unavailable')
        return { label: '文档 A' }
      },
    }))
    const { sessionId } = await ctx.sessionController.create({ cwd: scaffold.workspaceCwd })
    const agent = ctx.agents.get(sessionId)!
    const document = await runtime.open(id)
    const binding = await runtime.bind({ ...document, sessionId, objectId })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(agent.session.snapshotEvents().some(event => event.type === 'request/header')).toBe(true)
    expect(ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench')).toEqual(binding.selection)
    // The same recorded task must fail before another request when its author-owned object disappears.
    const requests = agent.session.snapshotEvents().filter(event => event.type === 'request/header').length
    const errors: string[] = []
    ctx.on('agent/error', ({ agent: subject, error }) => {
      if (subject === agent && error instanceof Error) errors.push(error.message)
    })
    available = false
    agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(errors).toEqual(['Document unavailable'])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'request/header')).toHaveLength(requests)
    expect(ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench')).toEqual(binding.selection)
    await ctx.sessions.flush(agent.session)
    expect(await readPersistedEvents(scaffold, sessionId)).toEqual(agent.session.snapshotEvents())
    if (webSnapshotMode() === 'refresh') await recordFixture(scaffold, sessionId, fixture)
  } finally { await scaffold.close() }
})
