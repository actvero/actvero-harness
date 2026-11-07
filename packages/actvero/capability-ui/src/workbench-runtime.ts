/** Host runtime: provider lifetime, business data and conversation-local capabilities. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import type {} from '@deepseek-ai/dsh-workspace'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WorkbenchActivation, WorkbenchProvider, WorkbenchRuntimeContext } from './workbench-provider.ts'
import { workbenchAIEnabled, workbenchJsonStorage } from './workbench-provider.ts'
import type { WorkbenchActionRequest, WorkbenchBinding, WorkbenchBindRequest, WorkbenchDocument, WorkbenchId,
  WorkbenchEnvironment, WorkbenchInstanceId, WorkbenchRuntimeEntry, WorkbenchSelection, WorkbenchTarget } from './types.ts'
import type { workbenchDomain } from './workbench-storage.ts'
import { workbenchProjection, workbenchIdSchema } from './workbench-projection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { actveroWorkbenchRuntime: WorkbenchRuntime }
}

interface ActiveCapabilities {
  scope: Scope
  abort: AbortController
  provider: WorkbenchProvider
  activation: WorkbenchActivation | null
  mounting: Promise<WorkbenchActivation> | undefined
}

/** Runtime deployment directory, resolved by the product profile. */
export interface WorkbenchRuntimeConfig {
  /** Absolute managed directory for workbench files and native workspaces. */
  dataDirectory: string
}

/** Native Remote owner and in-process business-provider registry. */
export class WorkbenchRuntime extends TypertRemoteService {
  private readonly providers = new Map<WorkbenchId, WorkbenchProvider>()
  private readonly scopes = new Map<Agent, ActiveCapabilities>()
  private readonly creating = new Map<WorkbenchId, Promise<WorkbenchDocument>>()
  private readonly listeners = new Set<() => void>()
  private disposed = false

  /**
   * @param ctx Host context with native sessions, tools, projections and storage.
   * @param domain Open profile-local business documents.
   * @param config Managed files directory.
   */
  constructor(ctx: Context, private readonly domain: Domain<typeof workbenchDomain>, private readonly config: WorkbenchRuntimeConfig) {
    super(ctx, 'actveroWorkbenchRuntime', { namespace: 'actveroWorkbench' })
    if (!isAbsolute(config.dataDirectory)) throw new Error('Workbench dataDirectory must be absolute')
    ctx.typert.resources.register('actveroWorkbench', { field: 'instanceId' })
    ctx.sessionProjections.register(workbenchProjection)
    ctx.on('domain/changed', (change) => { if (change.domain === domain.name) this.changed() })
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const selection = this.selection(agent)
      if (selection) {
        const provider = this.provider(selection)
        const context = { ...await this.environment(selection), sessionId: agent.id }
        await provider.prepare?.(context, signal)
        signal.throwIfAborted()
        this.provider(selection)
        const active = this.scopes.get(agent)
        if (!active || active.provider !== provider || active.abort.signal.aborted) {
          const activation = await this.activate(agent, provider, context, signal)
          if (activation?.digest !== selection.capabilityDigest
            || (activation && JSON.stringify(activation.expert) !== JSON.stringify(selection.expert))) {
            await this.clearScope(agent)
            throw new RemoteError('workbench/unavailable', 'Workbench dependencies changed. Select the installed workbench again.', {})
          }
        }
      }
      return next()
    })
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      const assembly = await next()
      const agent = ctx.agents.list().find(item => item === context.scope)
      const selection = agent && this.selection(agent)
      if (!selection) return assembly
      const provider = this.provider(selection)
      const storage = workbenchJsonStorage(provider)
      return { ...assembly,
        sections: [...assembly.sections, { name: 'actvero-workbench', text: '{{actvero_workbench}}' }],
        variables: { ...assembly.variables, actvero_workbench:
          `Workbench: ${selection.name} (${selection.version})\n${selection.expert?.instructions ?? ''}\n`
          + (storage ? `Use workbench_read to inspect current business data, then workbench_action to change it. Never claim a change before its tool succeeds.\n${storage.actionHelp}` : '') },
      }
    })
    ctx.effect(() => async () => {
      this.disposed = true
      this.changed()
      await Promise.all([...this.scopes.keys()].map(agent => this.clearScope(agent)))
    })
  }

  /** Register business behavior; unregistering leaves documents and selections intact.
   * @param provider Package-owned business implementation.
   * @returns Disposer withdrawing the exact implementation and awaiting its conversation capabilities.
   */
  register(provider: WorkbenchProvider): () => Promise<void> {
    workbenchIdSchema.parse(provider.id)
    if (!provider.name.trim() || !provider.version.trim() || this.providers.has(provider.id)) throw new Error('Invalid or duplicate workbench provider')
    if (provider.resourcesDirectory !== undefined && !isAbsolute(provider.resourcesDirectory)) throw new Error('Workbench resourcesDirectory must be absolute')
    this.providers.set(provider.id, provider)
    this.changed()
    return async () => {
      if (this.providers.get(provider.id) !== provider) return
      this.providers.delete(provider.id)
      this.changed()
      await Promise.all([...this.scopes].filter(([, active]) => active.provider === provider).map(([agent]) => this.clearScope(agent)))
    }
  }

  /** List providers with a managed runtime, including those with author-owned storage.
   * @returns Runtime-ready provider metadata, independent of UI-only cards.
   */
  @Remote
  list(): WorkbenchRuntimeEntry[] {
    return [...this.providers.values()].map(provider => ({ id: provider.id, name: provider.name, version: provider.version,
      aiEnabled: workbenchAIEnabled(provider) }))
  }

  /** Resolve the provider's local default instance without creating a conversation.
   * @param id Installed provider identity.
   * @returns Existing business document or a durably initialized instance.
   */
  @Remote
  async open(id: WorkbenchId): Promise<WorkbenchDocument> {
    const provider = this.providers.get(id)
    if (!provider) throw new RemoteError('workbench/unavailable', 'Workbench provider is not loaded.', {})
    const existing = [...this.domain.table('instances').entries()].find(([, value]) => value.id === id)?.[1]
    if (existing) {
      if (!this.ctx.remoteAccess.allows({ kind: 'actveroWorkbench', id: existing.instanceId })) throw new RemoteError('workbench/unavailable', 'Workbench instance is not accessible.', {})
      await this.ensureDirectory(existing.instanceId)
      this.assertLoaded(provider)
      return existing
    }
    const pending = this.creating.get(id)
    if (pending) return pending
    const task = (async () => {
      const storage = workbenchJsonStorage(provider)
      const json = storage ? storage.initial() : 'null'
      JSON.parse(json)
      const document = { id, instanceId: randomUUID() as WorkbenchInstanceId, revision: 0, json }
      await this.ensureDirectory(document.instanceId)
      this.assertLoaded(provider)
      await this.domain.table('instances').put(document.instanceId, document)
      return document
    })()
    this.creating.set(id, task)
    try { return await task } finally { this.creating.delete(id) }
  }

  /** Resolve runtime paths without creating a session or starting AI dependencies.
   * @param request Existing instance returned by open().
   * @returns Environment after its data directory is ready; directory failures reject without deleting existing data.
   */
  @Remote
  async environment(request: WorkbenchTarget): Promise<WorkbenchEnvironment> {
    const document = this.read(request)
    const provider = this.loadedProvider(document.id)
    const dataDirectory = await this.ensureDirectory(document.instanceId)
    this.assertLoaded(provider)
    return { id: document.id, instanceId: document.instanceId, version: provider.version,
      dataDirectory, resourcesDirectory: provider.resourcesDirectory ?? null,
      storage: workbenchJsonStorage(provider) ? 'json' : 'custom', aiEnabled: workbenchAIEnabled(provider) }
  }

  /** Read current business data; never returns a fabricated empty document.
   * @param request Instance to read.
   * @returns Persisted document.
   */
  @Remote
  read(request: WorkbenchTarget): WorkbenchDocument {
    const document = this.domain.table('instances').get(request.instanceId)
    if (!document) throw new RemoteError('workbench/not-found', 'Workbench instance was not found.', {})
    if (!this.providers.has(document.id)) throw new RemoteError('workbench/unavailable', 'Workbench provider is not loaded.', {})
    return document
  }

  /** Apply one business operation atomically with an expected revision.
   * @param request Instance, expected revision and provider-defined action.
   * @returns Document only after persistence succeeds.
   */
  @Remote
  async action(request: WorkbenchActionRequest): Promise<WorkbenchDocument> {
    const current = this.read(request)
    const provider = this.loadedProvider(current.id)
    const storage = workbenchJsonStorage(provider)
    if (!storage) throw new RemoteError('workbench/unsupported-storage', 'This workbench manages its own business storage.', {})
    return this.domain.table('instances').update(request.instanceId, (document) => {
      if (this.providers.get(current.id) !== provider) throw new RemoteError('workbench/unavailable', 'Workbench changed while saving.', {})
      if (document.revision !== request.revision) throw new RemoteError('workbench/conflict', 'Business data changed. Read the latest document and retry.', {})
      const json = storage.reduce(document.json, request.action, request.args)
      JSON.parse(json)
      return { ...document, json, revision: document.revision + 1 }
    })
  }

  /** Bind an idle existing conversation or create one in the managed files directory.
   * @param request Business instance and optional existing conversation.
   * @returns Conversation identity and the durably recorded environment.
   */
  @Remote
  async bind(request: WorkbenchBindRequest): Promise<WorkbenchBinding> {
    const document = this.read(request)
    const provider = this.loadedProvider(document.id)
    if (!workbenchAIEnabled(provider)) throw new RemoteError('workbench/ai-disabled', 'Native AI is disabled for this workbench.', {})
    const selection: WorkbenchSelection = { id: provider.id, instanceId: document.instanceId,
      name: provider.name, version: provider.version, expert: provider.expert ? { ...provider.expert } : null }
    let sessionId = request.sessionId
    if (!sessionId) {
      const directory = join(this.config.dataDirectory, '.sessions', selection.instanceId)
      await mkdir(directory, { recursive: true })
      const workspace = await this.ctx.workspaceRegistry.create(directory, provider.name)
      sessionId = (await this.ctx.sessionController.create({ sessionId: randomUUID() as SessionId, workspaceId: workspace.id })).sessionId
    }
    const resolved = await this.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw new RemoteError('workbench/unavailable', 'Conversation is unavailable.', {})
    const agent = resolved.agent
    const selected = this.selection(agent)
    const active = this.scopes.get(agent)
    if (selected?.instanceId === selection.instanceId && selected.id === selection.id && selected.version === selection.version
      && (!provider.activate || (active?.provider === provider && !active.abort.signal.aborted))) {
      return { sessionId: agent.id, selection: selected }
    }
    return agent.runMaintenance(async (signal) => {
      this.provider(selection)
      const context: WorkbenchRuntimeContext = { ...await this.environment(selection), sessionId: agent.id }
      await provider.prepare?.(context, signal)
      signal.throwIfAborted()
      this.provider(selection)
      const activation = await this.activate(agent, provider, context, signal)
      if (activation) { selection.expert = activation.expert; selection.capabilityDigest = activation.digest }
      try { agent.session.append('actvero/workbench', { schemaVersion: 1, selection }) }
      catch (error) { await this.clearScope(agent); throw error }
      return { sessionId: agent.id, selection }
    })
  }

  /** Stop using a workbench without deleting business data or conversation history.
   * @param request Conversation to unlink; running turns are governed by native maintenance admission.
   * @returns The cleared association.
   */
  @Remote
  async detach(request: { sessionId: SessionId }): Promise<WorkbenchBinding> {
    const resolved = await this.ctx.sessionController.resolveAgent(request.sessionId)
    if ('error' in resolved) throw new RemoteError('workbench/unavailable', 'Conversation is unavailable.', {})
    const agent = resolved.agent
    return agent.runMaintenance(async () => {
      await this.clearScope(agent)
      agent.session.append('actvero/workbench', { schemaVersion: 1, selection: null })
      return { sessionId: agent.id, selection: null }
    })
  }

  /** Observe authoritative business data while at least one UI is viewing it.
   * @param request Instance to observe.
   * @param signal Remote stream lifetime.
   * @returns Initial state and subsequent durable changes, coalesced without polling.
   */
  @Remote({ mode: 'stream' })
  async *follow(request: WorkbenchTarget, signal: AbortSignal): AsyncIterable<WorkbenchDocument> {
    const active = () => !signal.aborted && !this.disposed
    let dirty = true
    let wake: (() => void) | undefined
    const changed = () => { dirty = true; wake?.() }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed)
    try {
      while (active()) {
        if (!dirty) await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
        if (!active()) break
        dirty = false
        yield this.read(request)
      }
    } finally { this.listeners.delete(changed); signal.removeEventListener('abort', changed) }
  }

  private changed(): void { for (const listener of this.listeners) listener() }
  private selection(agent: Agent): WorkbenchSelection | null { return this.ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench') ?? null }
  private loadedProvider(id: WorkbenchId): WorkbenchProvider {
    const provider = this.providers.get(id)
    if (!provider) throw new RemoteError('workbench/unavailable', 'Workbench provider is not loaded.', {})
    return provider
  }
  private provider(selection: WorkbenchSelection): WorkbenchProvider {
    const provider = this.providers.get(selection.id)
    if (!provider || provider.version !== selection.version) throw new RemoteError('workbench/unavailable', 'The selected workbench version is unavailable. Select the installed version to continue.', {})
    if (!workbenchAIEnabled(provider)) throw new RemoteError('workbench/ai-disabled', 'Native AI is disabled for this workbench.', {})
    return provider
  }
  private assertLoaded(provider: WorkbenchProvider): void {
    if (this.providers.get(provider.id) !== provider) throw new RemoteError('workbench/unavailable', 'Workbench provider changed. Open the installed version again.', {})
  }
  private async ensureDirectory(instanceId: WorkbenchInstanceId): Promise<string> {
    const directory = join(this.config.dataDirectory, instanceId)
    try { await mkdir(directory, { recursive: true }) } catch (error) {
      this.ctx.logger.warn('Unable to prepare workbench data directory: %s', error)
      throw new RemoteError('workbench/failed', 'Workbench data directory is unavailable. Check disk access and retry.', {})
    }
    return directory
  }
  private async clearScope(agent: Agent): Promise<void> {
    const active = this.scopes.get(agent)
    if (!active) return
    active.abort.abort(new Error('Workbench capability scope closed'))
    await active.scope.dispose()
    if (this.scopes.get(agent) === active) this.scopes.delete(agent)
  }
  private async activate(
    agent: Agent, provider: WorkbenchProvider, context: WorkbenchRuntimeContext, signal: AbortSignal,
  ): Promise<WorkbenchActivation | null> {
    await this.clearScope(agent)
    if (!workbenchJsonStorage(provider) && !provider.activate) return null
    const scope = createScope(agent.ctx, agent)
    const active: ActiveCapabilities = { scope, provider, abort: new AbortController(), activation: null, mounting: undefined }
    this.scopes.set(agent, active)
    scope.ctx.effect(() => async () => {
      active.abort.abort(new Error('Workbench capability scope closed'))
      // bind or pre-step reports activation failures; disposal must also wait for the callback.
      await active.mounting?.catch((_activationFailed: unknown) => {})
      if (this.scopes.get(agent) === active) this.scopes.delete(agent)
    })
    const combined = AbortSignal.any([signal, active.abort.signal])
    const stop = () => { void scope.dispose().catch((error: unknown) => { this.ctx.logger.warn('Unable to close workbench capabilities: %s', error) }) }
    combined.addEventListener('abort', stop, { once: true })
    try {
      combined.throwIfAborted()
      if (workbenchJsonStorage(provider)) this.mountTools(scope.ctx)
      active.mounting = provider.activate?.(scope.ctx, context, combined)
      active.activation = await active.mounting ?? null
      combined.throwIfAborted()
      this.assertLoaded(provider)
      if (this.disposed) throw new RemoteError('workbench/unavailable', 'Workbench runtime is closed.', {})
      return active.activation
    } catch (error) { await this.clearScope(agent); throw error }
    finally { combined.removeEventListener('abort', stop) }
  }
  private toolSelection(agent: Agent | undefined): WorkbenchSelection {
    const selection = agent && this.selection(agent)
    if (!selection) throw new RemoteError('workbench/unavailable', 'This conversation has no selected workbench.', {})
    this.provider(selection)
    return selection
  }
  private mountTools(ctx: Context): void {
    const output = { schema: { type: 'string' as const }, render: (_args: object, json: string) => [{ type: 'text' as const, text: json }] }
    ctx.tools.register(defineTool({
      name: 'workbench_read', description: 'Read current business data and revision of this conversation’s selected workbench.', parameters: {}, output,
      execute: (_args, exec) => Promise.resolve(JSON.stringify(this.read(this.toolSelection(exec.agent)))),
      presentCall: () => ({ card: 'generic', title: 'Read workbench', kind: 'other' }),
    }))
    ctx.tools.register(defineTool({
      name: 'workbench_action', description: 'Apply a documented workbench action to the last observed revision. Read again on conflict; never overwrite a concurrent edit.',
      parameters: { revision: { type: 'integer', required: true }, action: { type: 'string', required: true }, args: { type: 'string', required: true, description: 'JSON object for the documented business action.' } }, output,
      execute: async (args, exec) => JSON.stringify(await this.action({ ...args, instanceId: this.toolSelection(exec.agent).instanceId })),
      presentCall: args => ({ card: 'generic', title: 'Update workbench', kind: 'other', rawInput: args }),
    }))
  }
}
