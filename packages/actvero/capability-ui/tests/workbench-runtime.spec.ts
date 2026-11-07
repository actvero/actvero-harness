/** Native scopes, durable business state and concurrent workbench actions. */
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { randomUUID } from 'node:crypto'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as DomainStorage from '@deepseek-ai/dsh-storage-domain'
import Typert from '@deepseek-ai/dsh-typert-registry'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, onTestFinished } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as Workbenches from '../src/index.ts'
import { checklistProvider } from '../src/checklist.ts'
import { checklistDocument } from '../src/checklist-data.ts'
import type { WorkbenchId } from '../src/types.ts'

async function harness(root?: string) {
  const directory = root ?? await mkdtemp(join(tmpdir(), 'actvero-workbench-runtime-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); if (!root) await rm(directory, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx)
  const loop = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(Typert)
  await ctx.plugin(RemoteAccess)
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: directory })
  await ctx.plugin(DomainStorage, { backend: 'json' })
  await ctx.plugin(JsonlSessionPersistence, { root: join(directory, 'sessions'), compression: 'none' })
  await ctx.plugin(WorkspaceRegistry)
  const sessionController: Pick<Context['sessionController'], 'create' | 'resolveAgent'> = {
    create: async (request) => {
      const workspace = request.workspaceId ? ctx.workspaceRegistry.get(request.workspaceId) : undefined
      const cwd = workspace?.path ?? request.cwd
      const agent = await loop.create(request.sessionId ?? SessionId(randomUUID()), {}, cwd ? { cwd } : {})
      await workspace?.attachSession(agent.id)
      return { sessionId: agent.id }
    },
    resolveAgent: async (id) => {
      const agent = ctx.agents.get(id)
      if (!agent) throw new Error('Missing fixture session')
      return { agent }
    },
  }
  ctx.reflect.provide('sessionController', sessionController)
  await ctx.plugin(Workbenches, { dataDirectory: join(directory, 'files') })
  const runtime = ctx.actveroWorkbenchRuntime
  const prepare = (agent: Agent) => ctx.waterfall(scopeTarget(agent, agent), 'agent/pre-step', {
    agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal,
  }, async () => ({ kind: 'enter' as const, messages: [] }))
  return { ctx, runtime, loop, prepare, directory }
}

const id = checklistProvider.id

describe('workbench runtime', () => {
  it('coalesces opening, rejects stale writes and restores documents after reopening', async () => {
    const first = await harness()
    const [a, b] = await Promise.all([first.runtime.open(id), first.runtime.open(id)])
    expect(a.instanceId).toBe(b.instanceId)
    const outcomes = await Promise.allSettled([
      first.runtime.action({ ...a, action: 'add', args: JSON.stringify({ text: '长任务 / Campaign review' }) }),
      first.runtime.action({ ...a, action: 'complete', args: JSON.stringify({ id: 'sampleItem1', completed: true }) }),
    ])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'workbench/conflict' } })
    const saved = first.runtime.read(a)
    await first.ctx.fiber.dispose()
    const reopened = await harness(first.directory)
    expect(await reopened.runtime.open(id)).toEqual(saved)
  })

  it('shares live updates, stops following on abort and preserves legacy completion only once', async () => {
    const { runtime } = await harness()
    const document = await runtime.open(id)
    const abort = new AbortController()
    const stream = runtime.follow(document, abort.signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toEqual(document)
    const changed = stream.next()
    const imported = await runtime.action({ ...document, action: 'import-legacy', args: '{"completed":["sampleItem1"]}' })
    expect((await changed).value).toEqual(imported)
    const edited = await runtime.action({ ...imported, action: 'complete', args: '{"id":"sampleItem1","completed":false}' })
    const again = await runtime.action({ ...edited, action: 'import-legacy', args: '{"completed":["sampleItem1"]}' })
    expect(checklistDocument.parse(JSON.parse(again.json)).items[0]?.completed).toBe(false)
    abort.abort()
    expect((await stream.next()).done).toBe(true)
  })

  it('loads the bundled expert and tools only for the linked conversation, then removes them on detach', async () => {
    const { ctx, runtime, loop, prepare } = await harness()
    const normal = await loop.create(SessionId('normal'))
    const document = await runtime.open(id)
    const binding = await runtime.bind(document)
    const agent = ctx.agents.get(binding.sessionId)!
    expect(agent.session.header.cwd).toContain(document.instanceId)
    const workspace = await ctx.workspaceRegistry.create(agent.session.header.cwd!)
    expect(workspace.title).toBe(checklistProvider.name)
    expect(workspace.sessionIds).toContain(agent.id)
    await prepare(agent)
    await prepare(normal)
    expect(ctx.tools.get('workbench_read', normal)).toBeUndefined()
    expect(ctx.tools.get('workbench_read')).toBeUndefined()
    const prompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))
    expect(prompt).toContain(checklistProvider.expert?.instructions)
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: normal }))).not.toContain('Workbench:')
    const result = await ctx.tools.execute({ agent, signal: new AbortController().signal, callId: ToolCallId('workbench-add'),
      name: 'workbench_action', arguments: { revision: document.revision, action: 'add', args: '{"text":"整理验收材料"}' } })
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(JSON.stringify(result.content)).toContain('整理验收材料')
    expect(checklistDocument.parse(JSON.parse(runtime.read(document).json)).items.at(-1)?.text).toBe('整理验收材料')
    expect({ prompt, schemas: ctx.tools.schemas(agent).filter(tool => tool.name.startsWith('workbench_')) }).toMatchSnapshot()
    expect(ctx.sessionProjections.snapshot(agent.session).values.actveroWorkbench).toEqual(binding.selection)
    await runtime.detach({ sessionId: agent.id })
    expect(ctx.tools.get('workbench_action', agent)).toBeUndefined()
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))).not.toContain('Workbench:')
    expect(ctx.sessionProjections.snapshot(agent.session).values.actveroWorkbench).toBeNull()
    expect(runtime.read(document).revision).toBe(1)
  })

  it('does not commit a failed expert preparation and rejects unavailable selected versions', async () => {
    const { ctx, runtime, loop, prepare } = await harness()
    const agent = await loop.create(SessionId('existing'))
    const customId = 'test:workbench' as WorkbenchId
    const remove = runtime.register({ ...checklistProvider, id: customId, prepare: async () => { throw new Error('dependency unavailable') } })
    const document = await runtime.open(customId)
    await expect(runtime.bind({ ...document, sessionId: agent.id })).rejects.toThrow('dependency unavailable')
    expect(ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench')).toBeNull()
    remove()
    const unload = runtime.register({ ...checklistProvider, id: customId })
    await runtime.bind({ ...document, sessionId: agent.id })
    unload()
    runtime.register({ ...checklistProvider, id: customId, version: '2.0.0' })
    await expect(prepare(agent)).rejects.toMatchObject({ code: 'workbench/unavailable' })
    expect(ctx.tools.get('workbench_action', agent)).toBeUndefined()
    await runtime.bind({ ...document, sessionId: agent.id })
    await prepare(agent)
    expect(ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench')?.version).toBe('2.0.0')
  })

  it('records the expert request and AI business action through the native loop', async () => {
    const { ctx, runtime, loop } = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('read', 'workbench_read', {}),
      toolCallResponse('complete', 'workbench_action', { revision: 0, action: 'complete', args: '{"id":"sampleItem1","completed":true}' }),
      textResponse('已完成：确认需求和交付范围。'),
    ])
    ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
    const agent = await loop.create(SessionId('workbench-loop'), { provider: 'mock', model: 'mock' })
    const document = await runtime.open(id)
    await runtime.bind({ ...document, sessionId: agent.id })
    const idle = new Promise<void>((resolve) => {
      const stop = ctx.on('agent/status', (event) => { if (event.agent === agent && event.status === 'idle') { stop(); resolve() } })
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '把确认需求标记完成' }], source: { kind: 'user' } }))
    await idle
    expect(adapter.requests).toHaveLength(3)
    const events = agent.session.snapshotEvents()
    expect(events.some(event => event.type === 'actvero/workbench')).toBe(true)
    expect(events.some(event => event.type === 'tool/result')).toBe(true)
    expect(checklistDocument.parse(JSON.parse(runtime.read(document).json)).items[0]?.completed).toBe(true)
    expect({ system: adapter.requests[0]?.messages[0]?.content,
      tools: adapter.requests[0]?.tools?.map(tool => tool.name),
      data: checklistDocument.parse(JSON.parse(runtime.read(document).json)),
    }).toMatchSnapshot()
  })

  it('rejects invalid business actions without changing the stored document', async () => {
    const { runtime } = await harness()
    const document = await runtime.open(id)
    for (const [action, args] of [['add', '{"text":""}'], ['complete', '{"id":"missing","completed":true}'], ['unknown', '{}'], ['add', 'invalid']]) {
      await expect(runtime.action({ ...document, action: action!, args: args! })).rejects.toMatchObject({ code: 'workbench/invalid-action' })
      expect(runtime.read(document)).toEqual(document)
    }
  })
})
