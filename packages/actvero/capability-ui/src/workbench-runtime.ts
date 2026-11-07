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
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WorkbenchProvider, WorkbenchRuntimeContext } from './workbench-provider.ts'
import type { WorkbenchActionRequest, WorkbenchBinding, WorkbenchBindRequest, WorkbenchDocument, WorkbenchId,
  WorkbenchInstanceId, WorkbenchRuntimeEntry, WorkbenchSelection, WorkbenchTarget } from './types.ts'
import type { workbenchDomain } from './workbench-storage.ts'
import { workbenchProjection, workbenchIdSchema } from './workbench-projection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { actveroWorkbenchRuntime: WorkbenchRuntime }
}

/** Runtime deployment directory, resolved by the product profile. */
export interface WorkbenchRuntimeConfig {
  /** Absolute managed directory for workbench files and native workspaces. */
  dataDirectory: string
}

/** Native Remote owner and in-process business-provider registry. */
export class WorkbenchRuntime extends TypertRemoteService {
  private readonly providers = new Map<WorkbenchId, WorkbenchProvider>()
  private readonly scopes = new Map<Agent, Scope>()
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
    ctx.typert.resources.register('actveroWorkbench', { field: 'instanceId' })
    ctx.sessionProjections.register(workbenchProjection)
    ctx.on('domain/changed', (change) => { if (change.domain === domain.name) this.changed() })
    ctx.on('agent/disposed', ({ agent }) => {
      const scope = this.scopes.get(agent)
      this.scopes.delete(agent)
      void scope?.dispose().catch((error: unknown) => { ctx.logger.warn('Unable to dispose workbench scope: %s', error) })
    })
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const selection = this.selection(agent)
      if (selection) {
        const provider = this.provider(selection)
        const context = this.environment(selection, agent.id)
        await mkdir(context.dataDirectory, { recursive: true })
        await provider.prepare?.(context, signal)
        signal.throwIfAborted()
        this.provider(selection)
        if (!this.scopes.has(agent)) {
          const scope = createScope(ctx, agent)
          this.scopes.set(agent, scope)
          this.mountTools(scope.ctx)
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
      return { ...assembly,
        sections: [...assembly.sections, { name: 'actvero-workbench', text: '{{actvero_workbench}}' }],
        variables: { ...assembly.variables, actvero_workbench:
          `Workbench: ${selection.name} (${selection.version})\n${selection.expert?.instructions ?? ''}\n`
          + `Use workbench_read to inspect current business data, then workbench_action to change it. Never claim a change before its tool succeeds.\n${provider.actionHelp}` },
      }
    })
    ctx.effect(() => async () => {
      this.disposed = true
      this.changed()
      await Promise.all([...this.scopes.values()].map(scope => scope.dispose()))
      this.scopes.clear()
    })
  }

  /** Register business behavior; unregistering leaves documents and selections intact.
   * @param provider Package-owned business implementation.
   * @returns Disposer withdrawing the exact implementation.
   */
  register(provider: WorkbenchProvider): () => void {
    workbenchIdSchema.parse(provider.id)
    if (!provider.name.trim() || !provider.version.trim() || this.providers.has(provider.id)) throw new Error('Invalid or duplicate workbench provider')
    this.providers.set(provider.id, provider)
    this.changed()
    return () => { if (this.providers.get(provider.id) === provider) { this.providers.delete(provider.id); this.changed() } }
  }

  /** List providers that support conversation integration.
   * @returns Runtime-ready provider metadata, independent of UI-only cards.
   */
  @Remote
  list(): WorkbenchRuntimeEntry[] {
    return [...this.providers.values()].map(({ id, name, version }) => ({ id, name, version }))
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
      return existing
    }
    const pending = this.creating.get(id)
    if (pending) return pending
    const task = (async () => {
      const json = provider.initial()
      JSON.parse(json)
      const document = { id, instanceId: randomUUID() as WorkbenchInstanceId, revision: 0, json }
      await this.domain.table('instances').put(document.instanceId, document)
      return document
    })()
    this.creating.set(id, task)
    try { return await task } finally { this.creating.delete(id) }
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
    return this.domain.table('instances').update(request.instanceId, (document) => {
      if (this.providers.get(current.id) !== provider) throw new RemoteError('workbench/unavailable', 'Workbench changed while saving.', {})
      if (document.revision !== request.revision) throw new RemoteError('workbench/conflict', 'Business data changed. Read the latest document and retry.', {})
      const json = provider.reduce(document.json, request.action, request.args)
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
    const selection: WorkbenchSelection = { id: provider.id, instanceId: document.instanceId,
      name: provider.name, version: provider.version, expert: provider.expert ? { ...provider.expert } : null }
    let sessionId = request.sessionId
    if (!sessionId) {
      const directory = this.environment(selection, '' as SessionId).dataDirectory
      await mkdir(directory, { recursive: true })
      const workspace = await this.ctx.workspaceRegistry.create(directory, provider.name)
      sessionId = (await this.ctx.sessionController.create({ sessionId: randomUUID() as SessionId, workspaceId: workspace.id })).sessionId
    }
    const resolved = await this.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw new RemoteError('workbench/unavailable', 'Conversation is unavailable.', {})
    const agent = resolved.agent
    const selected = this.selection(agent)
    if (selected?.instanceId === selection.instanceId && selected.id === selection.id && selected.version === selection.version) {
      return { sessionId: agent.id, selection: selected }
    }
    return agent.runMaintenance(async (signal) => {
      this.provider(selection)
      const context = this.environment(selection, agent.id)
      await mkdir(context.dataDirectory, { recursive: true })
      await provider.prepare?.(context, signal)
      signal.throwIfAborted()
      this.provider(selection)
      await this.clearScope(agent)
      agent.session.append('actvero/workbench', { schemaVersion: 1, selection })
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
    return provider
  }
  private environment(selection: WorkbenchSelection, sessionId: SessionId): WorkbenchRuntimeContext {
    return { id: selection.id, instanceId: selection.instanceId, sessionId,
      dataDirectory: join(this.config.dataDirectory, selection.instanceId) }
  }
  private async clearScope(agent: Agent): Promise<void> {
    const scope = this.scopes.get(agent)
    await scope?.dispose()
    this.scopes.delete(agent)
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
