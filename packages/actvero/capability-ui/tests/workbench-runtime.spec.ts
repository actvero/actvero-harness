/** Native scopes, durable business state and concurrent workbench actions. */
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import Skills from '@deepseek-ai/dsh-skill'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
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
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
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
  const workbenches = await ctx.plugin(Workbenches, {
    dataDirectory: join(directory, 'files'), displayTimeoutMs: 30000, platformTimeoutMs: 30000,
  })
  const runtime = ctx.actveroWorkbenchRuntime
  const prepare = (agent: Agent) => ctx.waterfall(scopeTarget(agent, agent), 'agent/pre-step', {
    agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal,
  }, async () => ({ kind: 'enter' as const, messages: [] }))
  return { ctx, runtime, loop, prepare, directory, workbenches }
}

const id = checklistProvider.id

describe('workbench runtime', () => {
  it('rejects incompatible, duplicate and closed registrations before exposing a provider', async () => {
    const { runtime, workbenches } = await harness()
    const customId = 'test:protocol' as WorkbenchId
    const provider = { id: customId, name: '兼容协议', version: '1.0.0' }
    expect(() => runtime.register({ ...provider, protocol: { schemaVersion: 1, hostApi: '^2' } })).toThrow(expect.objectContaining({ code: 'incompatible-host' }))
    expect(runtime.list().some(entry => entry.id === customId)).toBe(false)
    const remove = runtime.register({ ...provider, protocol: { schemaVersion: 1, hostApi: '^1' } })
    expect(() => runtime.register(provider)).toThrow('Duplicate')
    await remove()
    await workbenches.dispose()
    expect(() => runtime.register(provider)).toThrow('closed')
    expect(runtime.list()).toEqual([])
  })

  it.each(['prepare', 'activate'] as const)('reserves an id while %s settles and prevents reentrant replacement', async (phase) => {
    const { ctx, runtime } = await harness()
    const started = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    let signal: AbortSignal | undefined
    let replacement: unknown
    let activations = 0
    let releases = 0
    const customId = 'test:retiring' as WorkbenchId
    const identity = { id: customId, name: '卸载准备', version: '1.0.0', ai: true }
    const wait = async (received: AbortSignal) => {
      signal = received
      received.addEventListener('abort', () => {
        try { runtime.register(identity) } catch (error) { replacement = error }
      }, { once: true })
      started.resolve(undefined)
      await proceed.promise
    }
    const remove = runtime.register({ ...identity,
      prepare: async (_context, received) => { if (phase === 'prepare') await wait(received) },
      activate: async (scope, _context, received) => {
        activations++
        scope.effect(() => () => { releases++ })
        if (phase === 'activate') await wait(received)
        return { digest: 'cancelled', expert: null }
      },
    })
    const document = await runtime.open(customId)
    const binding = runtime.bind(document)
    const failed = expect(binding).rejects.toThrow()
    await started.promise
    let withdrawn = false
    const retirement = remove()
    void retirement.then(() => { withdrawn = true })
    try {
      expect(remove()).toBe(retirement)
      expect(signal?.aborted).toBe(true)
      expect(replacement).toMatchObject({ message: 'Workbench provider is still retiring' })
      expect(withdrawn).toBe(false)
      expect(runtime.list().some(entry => entry.id === customId)).toBe(false)
      await expect(runtime.open(customId)).rejects.toMatchObject({ code: 'workbench/unavailable' })
      expect(() => runtime.register(identity)).toThrow('retiring')
    } finally { proceed.resolve(undefined); await retirement; await failed }
    expect(activations).toBe(phase === 'activate' ? 1 : 0)
    expect(releases).toBe(activations)
    expect(ctx.sessionProjections.stateOf(ctx.agents.list()[0]!.session, 'actveroWorkbench')).toBeNull()
    const next = runtime.register(identity)
    await remove()
    expect(runtime.list().some(entry => entry.id === customId)).toBe(true)
    await next()
  })

  it('withdraws active tools when preparation fails on a later turn and preserves the logged binding', async () => {
    const { ctx, runtime, prepare } = await harness()
    let fail = false
    runtime.register({ ...checklistProvider, id: 'test:prepare-failure' as WorkbenchId,
      prepare: async () => { if (fail) throw new Error('dependency offline') },
    })
    const document = await runtime.open('test:prepare-failure' as WorkbenchId)
    const binding = await runtime.bind(document)
    const agent = ctx.agents.get(binding.sessionId)!
    expect(ctx.tools.get('workbench_read', agent)).toBeDefined()
    fail = true
    await expect(prepare(agent)).rejects.toThrow('dependency offline')
    expect(ctx.tools.get('workbench_read', agent)).toBeUndefined()
    expect(ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench')).toEqual(binding.selection)
    fail = false
    await prepare(agent)
    expect(ctx.tools.get('workbench_read', agent)).toBeDefined()
  })

  it('keeps runtime teardown pending until preparation exits without committing a selection', async () => {
    const { ctx, runtime, workbenches } = await harness()
    const close = vi.spyOn(ctx.storageDomain.get('actvero_workbench')!, 'close')
    onTestFinished(() => { close.mockRestore() })
    const started = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    const cancelled = Promise.withResolvers<undefined>()
    const customId = 'test:runtime-shutdown' as WorkbenchId
    runtime.register({ id: customId, name: '宿主释放', version: '1.0.0', ai: true,
      prepare: async (_context, signal) => {
        signal.addEventListener('abort', () => { cancelled.resolve(undefined) }, { once: true })
        started.resolve(undefined)
        await proceed.promise
      },
    })
    const document = await runtime.open(customId)
    const binding = runtime.bind(document)
    const failed = expect(binding).rejects.toThrow()
    await started.promise
    let stopped = false
    const disposal = workbenches.dispose().then(() => { stopped = true })
    try {
      await cancelled.promise
      expect(stopped).toBe(false)
      expect(close).not.toHaveBeenCalled()
      expect(() => runtime.register({ id: customId, name: '新版本', version: '2.0.0' })).toThrow('closed')
    } finally { proceed.resolve(undefined); await disposal; await failed }
    expect(stopped).toBe(true)
    expect(close).toHaveBeenCalledOnce()
    expect(ctx.agents.list()[0]!.session.snapshotEvents().some(event => event.type === 'actvero/workbench')).toBe(false)
  })

  it('discovers the bundled developer skill when the native registry becomes available', async () => {
    const { ctx, workbenches } = await harness()
    await ctx.plugin(Skills)
    const skill = await ctx.skills.get('develop-workbench')
    expect(skill?.source).toBe('bundled')
    expect(skill?.content).toContain('reference/guide.zh.md')
    expect(skill?.resourceBase?.kind).toBe('directory')
    if (skill?.resourceBase?.kind !== 'directory') throw new Error('Missing packaged developer resources')
    expect(ctx.skills.renderContent(skill).replaceAll(skill.resourceBase.path, '<developer-skill>')).toMatchSnapshot()
    const frontend = await ctx.skills.get('workbench-frontend')
    expect(frontend?.source).toBe('bundled')
    expect(frontend?.resourceBase?.kind).toBe('directory')
    if (frontend?.resourceBase?.kind !== 'directory') throw new Error('Missing packaged frontend guidance')
    expect(ctx.skills.renderContent(frontend).replaceAll(frontend.resourceBase.path, '<frontend-skill>')).toMatchSnapshot()
    await workbenches.dispose()
    expect(await ctx.skills.get('develop-workbench')).toBeUndefined()
    expect(await ctx.skills.get('workbench-frontend')).toBeUndefined()
  })

  it('denies undeclared platform access and withdraws access with its loaded provider', async () => {
    const { runtime } = await harness()
    const document = await runtime.open(id)
    expect(() => runtime.platformAccess(document)).toThrow()
    const platformId = 'test:platform' as WorkbenchId
    const remove = runtime.register({ id: platformId, name: '平台读取', version: '1.0.0', platform: ['models:read'] })
    const target = await runtime.open(platformId)
    expect(runtime.platformAccess(target)).toBe('1.0.0')
    await remove()
    expect(() => runtime.platformAccess(target)).toThrow()
  })

  it('provides isolated stable directories without AI and preserves author-owned files through upgrades and reinstall', async () => {
    const first = await harness()
    const customId = 'test:file-storage' as WorkbenchId
    const provider = { id: customId, name: '自由存储', version: '1.0.0', resourcesDirectory: import.meta.dirname, activate: async () => { throw new Error('AI must remain disabled') } }
    const remove = first.runtime.register(provider)
    const document = await first.runtime.open(customId)
    const environment = await first.runtime.environment(document)
    expect(environment).toEqual({ id: customId, instanceId: document.instanceId, version: '1.0.0',
      dataDirectory: join(first.directory, 'files', document.instanceId), resourcesDirectory: import.meta.dirname, storage: 'custom', aiEnabled: false })
    expect(first.ctx.agents.list()).toHaveLength(0)
    await expect(first.runtime.bind(document)).rejects.toMatchObject({ code: 'workbench/ai-disabled' })
    expect(first.ctx.agents.list()).toHaveLength(0)
    await mkdir(join(environment.dataDirectory, 'project-a'))
    await mkdir(join(environment.dataDirectory, 'project-b'))
    await writeFile(join(environment.dataDirectory, 'project-a', 'notes.txt'), '中文业务数据 / Campaign review')
    await writeFile(join(environment.dataDirectory, 'project-b', 'notes.txt'), '独立项目')
    expect(first.runtime.read(document)).toEqual({ ...document, json: 'null', revision: 0 })
    await expect(first.runtime.action({ ...document, action: 'write', args: '{}' })).rejects.toMatchObject({ code: 'workbench/unsupported-storage' })
    const other = await first.runtime.environment(await first.runtime.open(id))
    expect(other.dataDirectory).not.toBe(environment.dataDirectory)
    await remove()
    await expect(first.runtime.environment(document)).rejects.toMatchObject({ code: 'workbench/unavailable' })
    await first.ctx.fiber.dispose()
    const reopened = await harness(first.directory)
    reopened.runtime.register({ ...provider, version: '2.0.0', resourcesDirectory: join(first.directory, 'package-v2') })
    const restored = await reopened.runtime.environment(await reopened.runtime.open(customId))
    expect(restored).toMatchObject({ instanceId: document.instanceId, dataDirectory: environment.dataDirectory, version: '2.0.0' })
    expect(await readFile(join(restored.dataDirectory, 'project-a', 'notes.txt'), 'utf8')).toBe('中文业务数据 / Campaign review')
    expect(await readFile(join(restored.dataDirectory, 'project-b', 'notes.txt'), 'utf8')).toBe('独立项目')
  })

  it('prepares custom conversation context without generic JSON tools or instructions', async () => {
    const { ctx, runtime, prepare } = await harness()
    const environments: string[] = []
    runtime.register({ id: 'test:custom-tools' as WorkbenchId, name: '文件工作台', version: '1.0.0', ai: true,
      prepare: async (environment) => { environments.push(environment.dataDirectory) },
      expert: { name: '文件助手', version: '1.0.0', instructions: 'Use the packaged CLI to manage business files.' } })
    const document = await runtime.open('test:custom-tools' as WorkbenchId)
    const environment = await runtime.environment(document)
    expect(environments).toEqual([])
    const binding = await runtime.bind(document)
    const agent = ctx.agents.get(binding.sessionId)!
    expect(agent.session.header.cwd).not.toBe(environment.dataDirectory)
    expect(agent.session.header.cwd).toContain(join('.sessions', document.instanceId))
    await prepare(agent)
    expect(environments).toEqual([environment.dataDirectory, environment.dataDirectory])
    expect(ctx.tools.get('workbench_read', agent)).toBeUndefined()
    expect(ctx.tools.get('workbench_action', agent)).toBeUndefined()
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))).toMatchInlineSnapshot(`
      "You are an AI agent powered by DeepSeek Harness.

      Workbench: 文件工作台 (1.0.0)
      Use the packaged CLI to manage business files.
      "
    `)
  })

  it('activates scoped capabilities once, logs their digest and waits for withdrawal', async () => {
    const { ctx, runtime, prepare, loop } = await harness()
    const normal = await loop.create(SessionId('unrelated'))
    let activations = 0
    let disposed = 0
    const customId = 'test:expert-bundle' as WorkbenchId
    const remove = runtime.register({ id: customId, name: '随包专家', version: '1.0.0', ai: true,
      activate: async (scope) => {
        activations++
        scope.get('tools')!.register(defineTool({ name: 'business_read', description: 'Read business files.', parameters: {},
          output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] },
          execute: async () => 'author data' }))
        scope.effect(() => () => { disposed++ })
        return { digest: 'bundle-v1', expert: { name: '业务专家', version: '1.0.0', instructions: 'Use business_read.' } }
      } })
    const document = await runtime.open(customId)
    const binding = await runtime.bind(document)
    const agent = ctx.agents.get(binding.sessionId)!
    await runtime.bind({ ...document, sessionId: agent.id })
    await prepare(agent)
    expect(activations).toBe(1)
    expect(binding.selection?.capabilityDigest).toBe('bundle-v1')
    expect(ctx.tools.get('business_read', agent)).toBeDefined()
    expect(ctx.tools.get('business_read', normal)).toBeUndefined()
    expect(ctx.tools.get('business_read')).toBeUndefined()
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))).toContain('Use business_read.')
    await remove()
    expect(disposed).toBe(1)
    expect(ctx.tools.get('business_read', agent)).toBeUndefined()
    runtime.register({ id: customId, name: '随包专家', version: '1.0.0', ai: true,
      activate: async () => ({ digest: 'changed', expert: null }) })
    await expect(prepare(agent)).rejects.toMatchObject({ code: 'workbench/unavailable' })
    expect(ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench')?.capabilityDigest).toBe('bundle-v1')
    await runtime.bind({ ...document, sessionId: agent.id })
    await prepare(agent)
    expect(ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench')?.capabilityDigest).toBe('changed')
    await runtime.detach({ sessionId: agent.id })
    expect(ctx.tools.get('business_read', agent)).toBeUndefined()
  })

  it('awaits capability cleanup when the owning native Agent is disposed', async () => {
    const { ctx, runtime } = await harness()
    let entered!: () => void
    let release!: () => void
    const closing = new Promise<void>((resolve) => { entered = resolve })
    const proceed = new Promise<void>((resolve) => { release = resolve })
    let released = false
    const customId = 'test:agent-disposal' as WorkbenchId
    runtime.register({ id: customId, name: '会话释放', version: '1.0.0', ai: true,
      activate: async (scope) => {
        scope.effect(() => async () => { entered(); await proceed; released = true })
        return { digest: 'lifecycle-v1', expert: null }
      } })
    const document = await runtime.open(customId)
    const handle = await ctx.agents.create({ sessionId: SessionId('owned-capabilities') })
    await runtime.bind({ ...document, sessionId: handle.agent.id })
    const disposal = handle.dispose()
    try {
      await closing
      expect(released).toBe(false)
    } finally { release(); await disposal }
    expect(released).toBe(true)
    expect(ctx.agents.get(handle.agent.id)).toBeUndefined()
  })

  it('withdraws pending activation and rolls back registrations on failure', async () => {
    const { ctx, runtime } = await harness()
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    let released = false
    const customId = 'test:cancel-bundle' as WorkbenchId
    const remove = runtime.register({ id: customId, name: '取消加载', version: '1.0.0', ai: true,
      activate: async (scope, _environment, signal) => {
        scope.effect(() => () => { released = true })
        entered()
        await new Promise<void>((_resolve, reject) =>{  signal.addEventListener('abort', () => { reject(new Error('scope closed')) }, { once: true }) })
        return { digest: 'unreachable', expert: null }
      } })
    const document = await runtime.open(customId)
    const binding = runtime.bind(document)
    const failure = expect(binding).rejects.toThrow('scope closed')
    await started
    await remove()
    await failure
    expect(released).toBe(true)
    expect(ctx.sessionProjections.stateOf(ctx.agents.list()[0]!.session, 'actveroWorkbench')).toBeNull()
    runtime.register({ id: customId, name: '失败加载', version: '1.0.0', ai: true,
      activate: async (scope) => {
        scope.effect(() => { released = false; return () => { released = true } })
        throw new Error('required dependency missing')
      } })
    await expect(runtime.bind(document)).rejects.toThrow('required dependency missing')
    expect(released).toBe(true)
  })

  it('supports an explicit JSON adapter and reports directory failures without replacing existing data', async () => {
    const { runtime, directory } = await harness()
    runtime.register({ id: 'test:adapter' as WorkbenchId, name: '适配器', version: '1.0.0', storage: checklistProvider })
    const document = await runtime.open('test:adapter' as WorkbenchId)
    expect(await runtime.environment(document)).toMatchObject({ storage: 'json', resourcesDirectory: null })
    const saved = await runtime.action({ ...document, action: 'add', args: '{"text":"适配器任务"}' })
    const dataDirectory = join(directory, 'files', document.instanceId)
    await rm(dataDirectory, { recursive: true })
    await writeFile(dataDirectory, 'do not overwrite')
    await expect(runtime.environment(document)).rejects.toMatchObject({ code: 'workbench/failed' })
    await expect(runtime.open(document.id)).rejects.toMatchObject({ code: 'workbench/failed' })
    expect(runtime.read(document)).toEqual(saved)
    expect(await readFile(dataDirectory, 'utf8')).toBe('do not overwrite')
  })

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

  it('retains legacy JSON for author migration and withdraws its tools when storage becomes custom', async () => {
    const { ctx, runtime, prepare } = await harness()
    const customId = 'test:storage-migration' as WorkbenchId
    const remove = runtime.register({ ...checklistProvider, id: customId })
    const document = await runtime.open(customId)
    const saved = await runtime.action({ ...document, action: 'add', args: '{"text":"保留旧业务数据"}' })
    const binding = await runtime.bind(document)
    const agent = ctx.agents.get(binding.sessionId)!
    await prepare(agent)
    expect(ctx.tools.get('workbench_read', agent)).toBeDefined()
    await remove()
    runtime.register({ id: customId, name: checklistProvider.name, version: checklistProvider.version, ai: true })
    await prepare(agent)
    expect(ctx.tools.get('workbench_read', agent)).toBeUndefined()
    expect(ctx.tools.get('workbench_action', agent)).toBeUndefined()
    expect(runtime.read(document)).toEqual(saved)
    expect(await runtime.environment(document)).toMatchObject({ storage: 'custom', instanceId: saved.instanceId })
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
    await remove()
    const unload = runtime.register({ ...checklistProvider, id: customId })
    await runtime.bind({ ...document, sessionId: agent.id })
    await unload()
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

  it('does not expose an answering display channel through unscoped in-process calls', async () => {
    const { runtime } = await harness()
    await expect(runtime.displayCommands(new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'workbench/unavailable' })
    expect(() => runtime.show({ id, mode: 'business' }, new AbortController().signal)).toThrow('Owner Client required')
  })

  it('records resident tools without requiring a selected workbench or a connected Client', async () => {
    const { ctx, runtime, loop } = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('catalog', 'workbench_list', {}),
      toolCallResponse('status', 'workbench_status', {}),
      toolCallResponse('open', 'workbench_open', { id: 'builtin:project-checklist', mode: 'business' }),
      textResponse('当前没有连接客户端，尚未打开界面。'),
    ])
    ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
    const agent = await loop.create(SessionId('display-tools'), { provider: 'mock', model: 'mock' })
    const idle = new Promise<void>((resolve) => {
      const stop = ctx.on('agent/status', (event) => { if (event.agent === agent && event.status === 'idle') { stop(); resolve() } })
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '列出工作台，查看状态并打开项目清单' }], source: { kind: 'user' } }))
    await idle
    expect(ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench')).toBeNull()
    expect(runtime.list()).toHaveLength(1)
    const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(3)
    expect(JSON.stringify(results)).toContain('unavailable')
    expect(JSON.stringify(results)).not.toContain('confirmed')
    expect({ requests: adapter.requests.map(item => item.tools?.map(tool => tool.name)),
      results: results.map(event => ({ callId: event.data.message.toolCallId,
        content: event.data.message.content, isError: event.data.message.isError })) }).toMatchSnapshot()
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
