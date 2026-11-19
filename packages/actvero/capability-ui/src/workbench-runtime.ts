/** Host runtime: provider lifetime, business data and conversation-local capabilities. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import type {} from '@deepseek-ai/dsh-workspace'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, RemoteError, TypertRemoteService, principalOf, type PeerId } from '@deepseek-ai/dsh-typert-protocol'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type {} from './workbench-development.ts'
import type {} from './workbench-expert-policy.ts'
import type { WorkbenchActivation, WorkbenchProvider, WorkbenchRuntimeContext } from './workbench-provider.ts'
import { prepareWorkbenchData } from './workbench-lifecycle.ts'
import { WorkbenchDisplay } from './workbench-display.ts'
import { workbenchAIEnabled, workbenchJsonStorage } from './workbench-provider.ts'
import { resolveWorkbenchProtocol } from './workbench-protocol.ts'
import { installedWorkbenchCli } from './workbench-cli.ts'
import type { WorkbenchActionRequest, WorkbenchBinding, WorkbenchBindRequest, WorkbenchDocument, WorkbenchId, WorkbenchDevelopmentResources,
  WorkbenchDisplayChannelId, WorkbenchDisplayCommand, WorkbenchDisplayRequest, WorkbenchDisplayRequestId, WorkbenchDisplayResult,
  WorkbenchEnvironment, WorkbenchInstanceId, WorkbenchRuntimeEntry, WorkbenchExpertEntry, WorkbenchSelection, WorkbenchTarget, WorkbenchObjectTarget } from './types.ts'
import type { workbenchDomain } from './workbench-storage.ts'
import { workbenchProjection, workbenchIdSchema } from './workbench-projection.ts'
import type { WorkbenchObjectId } from './workbench-reference.ts'

/** Build-owned text resources embedded in the packaged Host; source execution reads the same asset tree. */
declare const ACTVERO_WORKBENCH_GUIDANCE: Readonly<Record<string, string>> | undefined
const packagedGuidance = typeof ACTVERO_WORKBENCH_GUIDANCE === 'undefined' ? undefined : ACTVERO_WORKBENCH_GUIDANCE

declare module '@deepseek-ai/cordis' {
  interface Context { actveroWorkbenchRuntime: WorkbenchRuntime }
}

interface DevelopmentDiagnostic { sessionId: SessionId; kind: 'tool' | 'turn'; code: string; message: string }

interface ActiveCapabilities {
  scope: Scope
  abort: AbortController
  provider: WorkbenchProvider
  activation: WorkbenchActivation | null
  ready: boolean
  mounting: Promise<WorkbenchActivation | null> | undefined
  objectId: WorkbenchObjectId | null
}

interface RegisteredWorkbench {
  provider: WorkbenchProvider
  abort: AbortController
  operations: Set<Promise<unknown>>
  retirement?: Promise<void>
}

/** Managed business directory and live Client acknowledgement deadline. */
export interface WorkbenchRuntimeConfig {
  /** Absolute managed directory for workbench business files. */
  dataDirectory: string
  /** Maximum live Client display acknowledgement wait. */
  displayTimeoutMs: number
}

/** Native Remote owner and in-process business-provider registry. */
export class WorkbenchRuntime extends TypertRemoteService {
  private readonly developmentLocks = new Set<WorkbenchId>()
  private readonly developmentOwner = new AsyncLocalStorage<WorkbenchId>()
  private readonly preparingData = new Map<string, Promise<void>>()
  private developerResources?: Promise<WorkbenchDevelopmentResources>
  private readonly preparedData = new WeakMap<WorkbenchProvider, Set<string>>()
  private readonly removalLifetime = new AbortController()
  private readonly cleanupOperations = new Set<Promise<void>>()
  private readonly removing = new Set<WorkbenchId>()
  private readonly providers = new Map<WorkbenchId, RegisteredWorkbench>()
  private readonly scopes = new Map<Agent, ActiveCapabilities>()
  private readonly creating = new Map<WorkbenchId, Promise<WorkbenchDocument>>()
  private readonly listeners = new Set<() => void>()
  private readonly catalogListeners = new Set<() => void>()
  private disposed = false
  private readonly display: WorkbenchDisplay
  private readonly displays = new Map<WorkbenchDisplayChannelId, ReturnType<WorkbenchDisplay['attach']> & { peerId: PeerId }>()

  /**
   * @param ctx Host context with native sessions, tools, projections and storage.
   * @param domain Open profile-local business documents.
   * @param config Managed files directory.
   */
  constructor(ctx: Context, private readonly domain: Domain<typeof workbenchDomain>, private readonly config: WorkbenchRuntimeConfig) {
    super(ctx, 'actveroWorkbenchRuntime', { namespace: 'actveroWorkbench' })
    this.display = new WorkbenchDisplay(config.displayTimeoutMs)
    this.mountDisplayTools(ctx)
    if (!isAbsolute(config.dataDirectory)) throw new Error('Workbench dataDirectory must be absolute')
    ctx.typert.resources.register('actveroWorkbench', { field: 'instanceId' })
    ctx.sessionProjections.register(workbenchProjection)
    ctx.on('domain/changed', (change) => { if (change.domain === domain.name) this.changed() })
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const selection = this.selection(agent)
      if (!selection) await this.clearScope(agent)
      if (selection) {
        const provider = this.provider(selection)
        await this.usingProvider(provider, async (lifetime) => {
          const combined = AbortSignal.any([signal, lifetime])
          const context = { ...await this.environment(selection), sessionId: agent.id, object: selection.object ?? null }
          const activation = await this.prepare(agent, provider, context, combined)
          if (activation?.digest !== selection.capabilityDigest
            || (activation && JSON.stringify(activation.expert) !== JSON.stringify(selection.expert))) {
            await this.clearScope(agent)
            throw new RemoteError('workbench/unavailable', 'Workbench dependencies changed. Select the installed workbench again.', {})
          }
        })
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
          + (selection.object ? `Bound business object: ${JSON.stringify(selection.object)}\n\nUse the bound object for business operations; viewing another object does not change this target.\n` : '')
          + (storage ? `Use workbench_read to inspect current business data, then workbench_action to change it. Never claim a change before its tool succeeds.\n${storage.actionHelp}` : '') },
      }
    })
    ctx.effect(() => async () => {
      this.disposed = true
      this.removalLifetime.abort(new Error('Host is shutting down'))
      for (const client of this.displays.values()) client.dispose()
      this.displays.clear()
      this.changed(true)
      const results = await Promise.allSettled([...this.providers.values()].map(entry => this.retire(entry)))
      await Promise.allSettled([...this.cleanupOperations])
      const failures = results.filter(result => result.status === 'rejected').map((result): unknown => result.reason)
      if (failures.length) throw new AggregateError(failures, 'Unable to close workbench providers')
    })
  }

  /** Register compatible business behavior; invalid, duplicate, retiring or closed registrations throw before publication.
   * @param provider Package-owned business implementation.
   * @returns Idempotent disposer withdrawing this implementation immediately, cancelling preparation/activation and awaiting
   * in-flight operations and scopes. Its id remains reserved until release completes; documents and selections stay intact.
   */
  register(provider: WorkbenchProvider): () => Promise<void> {
    if (this.disposed) throw new Error('Workbench runtime is closed')
    if (this.removing.has(provider.id)) throw new Error('Workbench data removal requires a host restart before reloading this provider')
    workbenchIdSchema.parse(provider.id)
    resolveWorkbenchProtocol(provider.protocol)
    if (provider.lifecycle && (!Number.isSafeInteger(provider.lifecycle.dataVersion) || provider.lifecycle.dataVersion < 0)) {
      throw new Error('Workbench dataVersion must be a nonnegative integer')
    }
    if (!provider.name.trim() || !provider.version.trim()) throw new Error('Invalid workbench provider')
    const existing = this.providers.get(provider.id)
    if (existing) throw new Error(existing.retirement ? 'Workbench provider is still retiring' : 'Duplicate workbench provider')
    if (provider.resourcesDirectory !== undefined && !isAbsolute(provider.resourcesDirectory)) throw new Error('Workbench resourcesDirectory must be absolute')
    const entry: RegisteredWorkbench = { provider, abort: new AbortController(), operations: new Set() }
    this.preparedData.delete(provider)
    this.providers.set(provider.id, entry)
    this.changed(true)
    return () => this.retire(entry)
  }

  private retire(entry: RegisteredWorkbench): Promise<void> {
    if (entry.retirement) return entry.retirement
    let resolve!: () => void
    let reject!: (reason: unknown) => void
    entry.retirement = new Promise<void>((done, fail) => { resolve = done; reject = fail })
    // Publish withdrawal before abort handlers or scope cleanup can re-enter registration.
    entry.abort.abort(new RemoteError('workbench/unavailable', 'Workbench provider was unloaded.', {}))
    this.changed(true)
    const cleanup = Promise.allSettled([...this.scopes].filter(([, active]) => active.provider === entry.provider)
      .map(([agent]) => this.clearScope(agent)))
    void (async () => {
      // Callers report operation failures; withdrawal owns cleanup failures and waits for every operation.
      await Promise.allSettled([...entry.operations])
      const results = await cleanup
      const failures = results.filter(result => result.status === 'rejected').map((result): unknown => result.reason)
      if (failures.length) throw new AggregateError(failures, 'Workbench cleanup failed; reload the host before replacing this provider')
      this.providers.delete(entry.provider.id)
    })().then(resolve, reject)
    return entry.retirement
  }

  private usingProvider<T>(provider: WorkbenchProvider, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const entry = this.assertLoaded(provider)
    // Reserve the operation before invoking provider code, including synchronous callbacks.
    const task = Promise.resolve().then(() => {
      entry.abort.signal.throwIfAborted()
      return run(entry.abort.signal)
    })
    entry.operations.add(task)
    void task.then(() => entry.operations.delete(task), () => entry.operations.delete(task))
    return task
  }

  /** Serve display commands only to the local owner's answering Client. Requests do not survive stream replacement.
   * @param signal Carrier lifetime.
   * @returns Readiness followed by live display requests; shutdown settles pending results as unknown.
   */
  @Remote({ mode: 'stream' })
  async *displayCommands(signal: AbortSignal): AsyncIterable<WorkbenchDisplayCommand> {
    const invocation = this.ctx.invocation
    const peer = invocation?.peer
    if (!peer || principalOf(invocation) || peer.interactions !== 'answer') {
      throw new RemoteError('workbench/unavailable', 'An answering owner Client is required.', {})
    }
    const queue: WorkbenchDisplayCommand[] = []
    let wake: (() => void) | undefined
    const stop = () => { wake?.() }
    let closed = false
    const attachment = this.display.attach((command) => { queue.push(command); wake?.() })
    const channelId = randomUUID() as WorkbenchDisplayChannelId
    const client = {
      peerId: peer.id,
      reply: (requestId: WorkbenchDisplayRequestId, result: WorkbenchDisplayResult) => { attachment.reply(requestId, result) },
      dispose: () => { closed = true; attachment.dispose(); wake?.() },
    }
    const active = () => !signal.aborted && !closed && !this.disposed && this.displays.get(channelId) === client
    this.displays.set(channelId, client)
    signal.addEventListener('abort', stop, { once: true })
    try {
      yield { type: 'ready', channelId }
      while (active()) {
        if (!queue.length) await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
        if (!active()) break
        const command = queue.shift()
        if (command) yield command
      }
    } finally {
      signal.removeEventListener('abort', stop)
      client.dispose()
      if (this.displays.get(channelId) === client) this.displays.delete(channelId)
    }
  }

  /** Route one acknowledgement only to the stream owned by the same authenticated Peer.
   * @param channelId Host-issued Client attachment identity.
   * @param requestId Host-issued correlation identity.
   * @param result Observed UI result, never a synthesized business-open success.
   */
  @Remote
  acknowledgeDisplay(channelId: WorkbenchDisplayChannelId, requestId: WorkbenchDisplayRequestId, result: WorkbenchDisplayResult): void {
    const invocation = this.ctx.invocation
    const peer = invocation?.peer
    if (!peer || principalOf(invocation)) throw new RemoteError('workbench/unavailable', 'Owner Client required.', {})
    const client = this.displays.get(channelId)
    if (client?.peerId === peer.id) client.reply(requestId, result)
  }

  /** Request display from an owner Client through the same bounded acknowledgement path as Agent tools.
   * @param request Installed workbench and display choices.
   * @param signal Carrier cancellation.
   * @returns Confirmation or an explicit unavailable, ambiguous, failed or uncertain outcome.
   */
  @Remote
  show(request: WorkbenchDisplayRequest, signal: AbortSignal): Promise<WorkbenchDisplayResult> {
    const invocation = this.ctx.invocation
    if (!invocation || principalOf(invocation)) throw new RemoteError('workbench/unavailable', 'Owner Client required.', {})
    return this.present(request, signal)
  }

  /** Request Client navigation without binding the calling Agent or changing its business data.
   * @param request Installed workbench and display choices.
   * @param signal Cancellation; timeout or carrier loss reports an unknown outcome.
   * @returns Client acknowledgement, or a structured failure. Mounted UI does not imply external business services are ready.
   */
  present(request: WorkbenchDisplayRequest | null, signal: AbortSignal): Promise<WorkbenchDisplayResult> {
    if (this.disposed) return Promise.resolve({ status: 'unavailable', reason: 'Workbench runtime is closed.' })
    return this.display.request(request, signal)
  }

  private mountDisplayTools(ctx: Context): void {
    const output = { schema: { type: 'string' as const }, render: (_args: object, json: string) => [{ type: 'text' as const, text: json }] }
    ctx.tools.register(defineTool({ name: 'workbench_list', description: 'List loaded local workbench providers. This does not open a view or start AI.',
      parameters: {}, output, execute: () => Promise.resolve(JSON.stringify(this.list())),
      presentCall: () => ({ card: 'generic', title: 'List workbenches', kind: 'other' }),
    }))
    ctx.tools.register(defineTool({ name: 'workbench_status', description: 'Inspect the actual workbench view in the connected Client. Unavailable or unknown is not an open view.',
      parameters: {}, output, execute: async (_args, exec) => JSON.stringify(await this.present(null, exec.signal)),
      presentCall: () => ({ card: 'generic', title: 'Inspect workbench view', kind: 'other' }),
    }))
    ctx.tools.register(defineTool({ name: 'workbench_open',
      description: 'Open a loaded workbench in the connected Client. Business mode does not start AI unless ai is show. Conversation/preview reuse an associated conversation or create one; they do not send a message. Only confirmed means the Client mounted the view. Reuse workbench_status after an unknown result.',
      parameters: {
        id: { type: 'string', required: true, description: 'Exact installed id from workbench_list.' },
        mode: { type: 'string', enum: ['business', 'conversation', 'preview'], required: true },
        object_id: { type: 'string', description: 'Existing provider-owned object id; business mode only. Does not rebind the conversation.' },
        sidebar: { type: 'string', enum: ['preserve', 'focus'] },
        ai: { type: 'string', enum: ['show', 'hide'] },
      }, output,
      execute: async (args, exec) => {
        const selection = exec.agent && this.selection(exec.agent)
        const { object_id, ...choices } = args
        if (object_id !== undefined && args.mode !== 'business') throw new Error('Business object navigation requires business mode')
        const request: WorkbenchDisplayRequest = { ...choices, id: args.id as WorkbenchId,
          ...(object_id !== undefined ? { objectId: object_id as WorkbenchObjectId } : {}),
          ...(selection?.id === args.id ? { sessionId: exec.agent?.id } : {}),
          ...(args.mode === 'business' && args.ai === undefined ? { ai: 'hide' as const } : {}),
        }
        return JSON.stringify(await this.present(request, exec.signal))
      },
      presentCall: args => ({ card: 'generic', title: 'Open workbench', kind: 'other', rawInput: args }),
    }))
  }

  /** Prepare an independent creation conversation, reusing only an ordinary blank draft.
   * @param request Optional foreground conversation; its active expert and started history remain intact in a separate conversation.
   * @returns New or reusable blank conversation with the Cordis preset and no expert source. No message is sent.
   */
  @Remote
  async startAuthoring(request: { sessionId?: SessionId }): Promise<{ sessionId: SessionId }> {
    let current: Agent | undefined
    if (request.sessionId) {
      const resolved = await this.ctx.sessionController.resolveAgent(request.sessionId)
      if ('error' in resolved) throw new RemoteError('workbench/unavailable', 'Conversation is unavailable.', {})
      current = resolved.agent
    }
    const ordinary = current ? await this.ctx.get('actveroExpertPolicy')?.selection(current) : null
    const reusable = current && !this.selection(current) && !ordinary && !current.session.header.parentSession
    const currentId = current?.id
    const workspace = currentId && this.ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(currentId))
    const result = await this.ctx.sessionController.create({ ...(reusable && currentId ? { sessionId: currentId } : {}), agentPreset: 'cordis',
      ...(workspace ? { workspaceId: workspace.id } : current?.session.header.cwd ? { cwd: current.session.header.cwd } : {}) })
    const target = await this.ctx.sessionController.resolveAgent(result.sessionId)
    if ('error' in target) throw new RemoteError('workbench/unavailable', 'Creation conversation is unavailable.', {})
    await target.agent.runMaintenance(async () => {
      await this.clearScope(target.agent)
      target.agent.session.append('actvero/workbench', { schemaVersion: 1, selection: null })
      target.agent.session.append('actvero/expert', { schemaVersion: 1, selection: null })
    })
    return { sessionId: result.sessionId }
  }

  /** Export bundled guidance to ordinary files readable by external Agents on this Host.
   * @returns Absolute skill entrypoints, including all relative guide and API references.
   */
  @Remote
  async developmentResources(): Promise<WorkbenchDevelopmentResources> {
    if (this.ctx.invocation && principalOf(this.ctx.invocation)) throw new RemoteError('workbench/unavailable', 'Owner Client required.', {})
    if (!this.developerResources) {
      this.developerResources = (async () => {
        const parent = join(this.config.dataDirectory, '.development-guides')
        await mkdir(parent, { recursive: true })
        const target = await mkdtemp(join(parent, 'snapshot-'))
        try {
          if (packagedGuidance) {
            for (const [path, content] of Object.entries(packagedGuidance)) {
              await mkdir(dirname(join(target, path)), { recursive: true })
              await writeFile(join(target, path), content)
            }
          } else {
            for (const skill of ['develop-workbench', 'workbench-frontend']) {
              await cp(fileURLToPath(new URL(`../assets/${skill}/`, import.meta.url)), join(target, skill), { recursive: true })
            }
          }
          const development = this.ctx.get('actveroWorkbenchDevelopment')
          const connectionPath = development ? await development.connection() : null
          const authoring = this.ctx.get('actveroExpertAuthoring')
          const embeddedExpert = packagedGuidance && packagedGuidance['expert-creator/SKILL.md'] !== undefined
          const expertSkillPath = authoring || embeddedExpert ? join(target, 'expert-creator/SKILL.md') : null
          if (authoring && expertSkillPath) {
            await mkdir(join(target, 'expert-creator'), { recursive: true })
            await writeFile(expertSkillPath, `---\nname: ${authoring.skill.name}\ndescription: ${JSON.stringify(authoring.skill.description)}\n---\n\n${authoring.skill.content}`)
          }
          return { skillPath: join(target, 'develop-workbench/SKILL.md'), frontendSkillPath: join(target, 'workbench-frontend/SKILL.md'),
            connectionPath, expertSkillPath, cli: installedWorkbenchCli() }
        } catch (error) {
          await rm(target, { recursive: true, force: true })
          throw error
        }
      })()
    }
    try { return await this.developerResources }
    catch (error) { this.developerResources = undefined; throw error }
  }

  /** List providers with a managed runtime, including those with author-owned storage.
   * @returns Runtime-ready provider metadata, independent of UI-only cards.
   */
  @Remote
  list(): WorkbenchRuntimeEntry[] {
    return [...this.providers.values()].filter(entry => !entry.retirement && !this.disposed)
      .map(({ provider }) => ({ id: provider.id, name: provider.name, version: provider.version, aiEnabled: workbenchAIEnabled(provider) }))
  }

  /** List conversational entries owned by loaded providers; withdrawal immediately removes them.
   * @returns Read-only expert metadata; listing never creates data, a workspace or a conversation.
   */
  @Remote
  experts(): WorkbenchExpertEntry[] {
    return [...this.providers.values()].filter(entry => !entry.retirement && !this.disposed
      && workbenchAIEnabled(entry.provider) && entry.provider.expertEntry !== false).map(({ provider }) => ({
      id: provider.id, name: (provider.expertEntry && provider.expertEntry.name) || provider.expert?.name || provider.name,
      version: (provider.expertEntry && provider.expertEntry.version) || provider.expert?.version || provider.version,
      workbenchName: provider.name, description: provider.expertEntry ? provider.expertEntry.description ?? '' : '',
      avatar: provider.expertEntry ? provider.expertEntry.avatar ?? '' : '',
    }))
  }

  /** Observe loaded expert entries, including installation, disablement and withdrawal.
   * @param signal Client lifetime.
   * @returns Initial catalog and changed catalogs; no business instances are allocated.
   */
  @Remote({ mode: 'stream' })
  async *followExperts(signal: AbortSignal): AsyncIterable<WorkbenchExpertEntry[]> {
    yield* this.observe(() => this.experts(), signal, this.catalogListeners)
  }

  /** Select a contributed expert in an existing idle conversation, or create an unbound conversation.
   * @param request Loaded provider and optional conversation; its filesystem workspace is preserved.
   * @returns Durable workbench association after capabilities are prepared.
   */
  @Remote
  async selectExpert(request: { id: WorkbenchId; sessionId?: SessionId }): Promise<WorkbenchBinding> {
    if (!this.experts().some(entry => entry.id === request.id)) throw new RemoteError('workbench/unavailable', 'Workbench expert is unavailable.', {})
    const document = await this.open(request.id)
    return this.bind({ instanceId: document.instanceId, ...(request.sessionId ? { sessionId: request.sessionId } : {}) })
  }

  /** Resolve the provider's local default instance without creating a conversation.
   * @param id Installed provider identity.
   * @returns Existing business document or a durably initialized instance.
   */
  @Remote
  async open(id: WorkbenchId): Promise<WorkbenchDocument> {
    const provider = this.loadedProvider(id)
    return this.usingProvider(provider, async () => {
      const existing = [...this.domain.table('instances').entries()].find(([, value]) => value.id === id)?.[1]
      if (existing) {
        if (!this.ctx.remoteAccess.allows({ kind: 'actveroWorkbench', id: existing.instanceId })) throw new RemoteError('workbench/unavailable', 'Workbench instance is not accessible.', {})
        await this.prepareData(provider, existing)
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
        await this.prepareData(provider, document)
        return document
      })()
      this.creating.set(id, task)
      try { return await task } finally { this.creating.delete(id) }
    })
  }

  /** Resolve runtime paths without creating a session or starting AI dependencies.
   * @param request Existing instance returned by open().
   * @returns Environment after its data directory is ready; directory failures reject without deleting existing data.
   */
  @Remote
  async environment(request: WorkbenchTarget): Promise<WorkbenchEnvironment> {
    const document = this.domain.table('instances').get(request.instanceId)
    if (!document) throw new RemoteError('workbench/not-found', 'Workbench instance was not found.', {})
    const provider = this.loadedProvider(document.id)
    return this.usingProvider(provider, async () => {
      await this.prepareData(provider, document)
      const dataDirectory = await this.ensureDirectory(document.instanceId)
      this.assertLoaded(provider)
      return { id: document.id, instanceId: document.instanceId, version: provider.version,
        dataDirectory, resourcesDirectory: provider.resourcesDirectory ?? null,
        storage: workbenchJsonStorage(provider) ? 'json' : 'custom', aiEnabled: workbenchAIEnabled(provider) }
    })
  }

  /** Read current business data; never returns a fabricated empty document.
   * @param request Instance to read.
   * @returns Persisted document.
   */
  @Remote
  read(request: WorkbenchTarget): WorkbenchDocument {
    const document = this.domain.table('instances').get(request.instanceId)
    if (!document) throw new RemoteError('workbench/not-found', 'Workbench instance was not found.', {})
    const provider = this.loadedProvider(document.id)
    if (provider.lifecycle && !this.preparedData.get(provider)?.has(document.instanceId)) {
      throw new RemoteError('workbench/unavailable', 'Open this workbench to finish preparing its data.', {})
    }
    return document
  }

  /** Validate a historical object's availability without binding a conversation or starting expert dependencies.
   * @param request Existing instance and author-owned object identity.
   * @param signal Carrier cancellation; provider removal also cancels the lookup.
   * @returns Current object name; missing providers and objects reject without creating data.
   */
  @Remote
  async inspectObject(request: WorkbenchObjectTarget, signal: AbortSignal): Promise<{ label: string }> {
    const document = this.read(request)
    const provider = this.loadedProvider(document.id)
    return this.usingProvider(provider, async (lifetime) => {
      const combined = AbortSignal.any([signal, lifetime])
      combined.throwIfAborted()
      if (!provider.resolveObject) throw new RemoteError('workbench/unavailable', 'This workbench does not support business object navigation.', {})
      const environment = await this.environment(request)
      const object = await provider.resolveObject(request.objectId, environment, combined)
      combined.throwIfAborted()
      return object
    })
  }

  /** Require a loaded provider's explicit platform declaration.
   * @param request Existing workbench instance.
   * @returns Installed provider version; throws before any request when access was not declared.
   */
  platformAccess(request: WorkbenchTarget): string {
    const provider = this.loadedProvider(this.read(request).id)
    if (!provider.platform?.includes('models:read')) throw new RemoteError('workbench/platform', 'Platform access was not declared.', { code: 'platform_not_declared' })
    return provider.version
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
    return this.usingProvider(provider, async () => this.domain.table('instances').update(request.instanceId, (document) => {
      this.assertLoaded(provider)
      if (document.revision !== request.revision) throw new RemoteError('workbench/conflict', 'Business data changed. Read the latest document and retry.', {})
      const json = storage.reduce(document.json, request.action, request.args)
      JSON.parse(json)
      return { ...document, json, revision: document.revision + 1 }
    }))
  }

  /** Bind an idle conversation or create one without assigning a filesystem workspace.
   * @param request Business instance and optional existing conversation.
   * @returns Conversation identity and the durably recorded environment.
   */
  @Remote
  async bind(request: WorkbenchBindRequest): Promise<WorkbenchBinding> {
    const requestedObject = request.objectId
    const expectedObject = request.expectedObjectId
    const document = this.read(request)
    const provider = this.loadedProvider(document.id)
    if (!workbenchAIEnabled(provider)) throw new RemoteError('workbench/ai-disabled', 'Native AI is disabled for this workbench.', {})
    return this.usingProvider(provider, async (lifetime) => {
      let selection: WorkbenchSelection = { id: provider.id, instanceId: document.instanceId,
        name: provider.name, version: provider.version, expert: provider.expert ? { ...provider.expert } : null }
      let sessionId = request.sessionId
      if (!sessionId) {
        sessionId = (await this.ctx.sessionController.create({ sessionId: randomUUID() as SessionId })).sessionId
      }
      const resolved = await this.ctx.sessionController.resolveAgent(sessionId)
      if ('error' in resolved) throw new RemoteError('workbench/unavailable', 'Conversation is unavailable.', {})
      lifetime.throwIfAborted()
      const agent = resolved.agent
      const selected = this.selection(agent)
      if (expectedObject !== undefined
        && (selected?.instanceId !== document.instanceId || (selected.object?.id ?? null) !== expectedObject)) {
        throw new RemoteError('workbench/conflict', 'Conversation target changed. Open the intended object again.', {})
      }
      const objectId = requestedObject === undefined
        ? (selected?.instanceId === document.instanceId ? selected.object?.id ?? null : null) : requestedObject
      const active = this.scopes.get(agent)
      if (selected?.instanceId === selection.instanceId && selected.id === selection.id && selected.version === selection.version
        && (selected.object?.id ?? null) === objectId && requestedObject === undefined
        && (active?.provider === provider && active.ready && !active.abort.signal.aborted)) {
        return { sessionId: agent.id, selection: selected }
      }
      if (agent.status === 'running') throw new RemoteError('workbench/busy', 'Wait for the current task before switching experts.', {})
      return agent.runMaintenance(async (signal) => {
        this.assertLoaded(provider)
        const combined = AbortSignal.any([signal, lifetime])
        const environment = await this.environment(selection)
        if (objectId !== null) {
          if (!provider.resolveObject) throw new RemoteError('workbench/unavailable', 'This workbench does not support business object bindings.', {})
          const object = await provider.resolveObject(objectId, environment, combined)
          combined.throwIfAborted()
          selection = { ...selection, object: { id: objectId, label: object.label } }
        }
        const context: WorkbenchRuntimeContext = { ...environment, sessionId: agent.id, object: selection.object ?? null }
        const activation = await this.prepare(agent, provider, context, combined)
        combined.throwIfAborted()
        if (activation) { selection.expert = activation.expert; selection.capabilityDigest = activation.digest }
        const ordinary = agent.session.snapshotEvents().findLast(event => event.type === 'actvero/expert')
        const policy = this.ctx.get('actveroExpertPolicy')
        const previousExpert = policy ? await policy.selection(agent) : ordinary?.type === 'actvero/expert' ? ordinary.data.selection : null
        combined.throwIfAborted()
        try {
          agent.session.append('actvero/expert', { schemaVersion: 1, selection: null })
          if (selection.object) agent.session.append('actvero/workbench', { schemaVersion: 2, selection: { ...selection, object: selection.object } })
          else agent.session.append('actvero/workbench', { schemaVersion: 1, selection })
        }
        catch (error) {
          if (previousExpert) agent.session.append('actvero/expert', { schemaVersion: 1, selection: previousExpert })
          await this.clearScope(agent)
          throw error
        }
        return { sessionId: agent.id, selection }
      })
    })
  }

  /** Check whether developer replacement can proceed without interrupting a conversation or business operation.
   * @param id Workbench package being replaced.
   * @returns False while the provider has an operation or a bound conversation is running.
   */
  developmentIdle(id: WorkbenchId): boolean {
    return !this.providers.get(id)?.operations.size && !this.ctx.agents.list().some(agent => agent.status === 'running' && this.selection(agent)?.id === id)
  }

  /** Release capabilities after another expert source has committed its selection under Agent maintenance.
   * @param agent Idle reserved conversation; callers retain the ordinary selection if cleanup fails and must report the failure.
   * @returns Completion after superseded workbench resources stop; a remaining binding is left intact.
   */
  async releaseSuperseded(agent: Agent): Promise<void> {
    if (!this.selection(agent)) await this.clearScope(agent)
  }

  /** Read bounded failure diagnostics from conversations currently associated with this developer workbench.
   * @param id Workbench being debugged.
   * @returns Up to twenty recent failures per retained conversation; without successful conversation message contents.
   */
  developmentDiagnostics(id: WorkbenchId): DevelopmentDiagnostic[] {
    return this.ctx.agents.list().filter(agent => this.selection(agent)?.id === id).flatMap(agent =>
      agent.session.snapshotEvents().flatMap<DevelopmentDiagnostic>((event) => {
        if (event.type === 'tool/result' && event.data.message.isError) return [{ sessionId: agent.id, kind: 'tool' as const,
          code: event.data.error?.code ?? 'tool_error', message: (event.data.error?.reason ?? event.data.error?.name ?? 'Tool call failed').slice(0, 2000) }]
        if (event.type === 'turn/end' && event.data.reason.kind === 'error') return [{ sessionId: agent.id, kind: 'turn' as const,
          code: event.data.reason.error.code, message: event.data.reason.error.message.slice(0, 2000) }]
        return []
      }).slice(-20))
  }

  /** Reserve all bound idle Agents and reject concurrent business calls during a developer replacement.
   * @param id Provider being replaced.
   * @param work Loader replacement and rollback, including refreshDevelopmentBindings before success.
   * @returns Busy without mutation, or the completed replacement result. Reservations release on failure too.
   */
  async replaceDevelopment<T>(id: WorkbenchId, work: () => Promise<T>): Promise<{ busy: true } | { busy: false; value: T }> {
    if (this.developmentLocks.has(id) || !this.developmentIdle(id)) return { busy: true }
    this.developmentLocks.add(id)
    const agents = this.ctx.agents.list().filter(agent => this.selection(agent)?.id === id)
    const reserve = (index: number): Promise<{ busy: true } | { busy: false; value: T }> => {
      if (index === agents.length) return work().then(value => ({ busy: false, value }))
      try { return agents[index].runMaintenance(() => reserve(index + 1)) }
      catch (_admissionError) { return Promise.resolve({ busy: true }) }
    }
    try { return await this.developmentOwner.run(id, () => reserve(0)) }
    finally { this.developmentLocks.delete(id) }
  }

  /** Capture the loaded development generation for reserved conversations without changing their workspace or business object.
   * @param id Provider owned by the current replaceDevelopment operation.
   * @returns Completion after every reserved conversation has its exact new capabilities recorded; failures require caller rollback.
   */
  async refreshDevelopmentBindings(id: WorkbenchId): Promise<void> {
    if (!this.developmentLocks.has(id) || this.developmentOwner.getStore() !== id) throw new Error('Development replacement does not own this workbench')
    const agents = this.ctx.agents.list().filter(agent => this.selection(agent)?.id === id)
    if (!agents.length) return
    const provider = this.loadedProvider(id)
    for (const agent of agents) {
      const previous = this.selection(agent)
      if (previous?.id !== id) continue
      const selection: WorkbenchSelection = { ...previous, name: provider.name, version: provider.version, expert: provider.expert ?? null }
      delete selection.capabilityDigest
      const environment = await this.environment(selection)
      const activation = await this.prepare(agent, provider,
        { ...environment, sessionId: agent.id, object: selection.object ?? null }, new AbortController().signal)
      if (activation) { selection.expert = activation.expert; selection.capabilityDigest = activation.digest }
      if (selection.object) agent.session.append('actvero/workbench', { schemaVersion: 2, selection: { ...selection, object: selection.object } })
      else agent.session.append('actvero/workbench', { schemaVersion: 1, selection })
    }
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
    yield* this.observe(() => this.read(request), signal, this.listeners)
  }

  private async *observe<T>(read: () => T, signal: AbortSignal, listeners: Set<() => void>): AsyncIterable<T> {
    const active = () => !signal.aborted && !this.disposed
    let dirty = true
    let wake: (() => void) | undefined
    const changed = () => { dirty = true; wake?.() }
    listeners.add(changed)
    signal.addEventListener('abort', changed)
    try {
      while (active()) {
        if (!dirty) await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
        if (!active()) break
        dirty = false
        yield read()
      }
    } finally { listeners.delete(changed); signal.removeEventListener('abort', changed) }
  }

  private changed(catalog = false): void {
    for (const listener of this.listeners) listener()
    if (catalog) for (const listener of this.catalogListeners) listener()
  }
  private selection(agent: Agent): WorkbenchSelection | null { return this.ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench') ?? null }
  /** Withdraw an idle provider before removal; cleanup is called only after explicit consent.
   * @param id Installed package identity.
   * @param version Version the person reviewed.
   * @returns Operations for existing instances; no new instance is created. Call complete after successful package removal.
   * Failures retain the provider reservation until Host restart.
   */
  async prepareRemoval(id: WorkbenchId, version: string): Promise<{ cleanup(): Promise<void>; complete(): void }> {
    const entry = this.providers.get(id)
    if (!entry || entry.retirement || entry.provider.version !== version) throw new RemoteError('workbench/unavailable', 'Reload the workbench before removing its data.', {})
    if (entry.operations.size || this.ctx.agents.list().some(agent => agent.status === 'running' && this.selection(agent)?.id === id)) {
      throw new RemoteError('workbench/unavailable', 'Stop active work before removing this workbench.', {})
    }
    const provider = entry.provider
    const documents = [...this.domain.table('instances').entries()].filter(([, document]) => document.id === id)
    this.removing.add(id)
    await this.retire(entry)
    let started = false
    let cleaned = false
    const cleanup = async () => {
      if (started) throw new Error('Workbench cleanup has already started')
      started = true
      const signal = this.removalLifetime.signal
      const task = (async () => {
        for (const [key, document] of documents) {
          signal.throwIfAborted()
          const environment: WorkbenchEnvironment = { id, instanceId: key, version,
            dataDirectory: join(this.config.dataDirectory, key), resourcesDirectory: provider.resourcesDirectory ?? null,
            storage: workbenchJsonStorage(provider) ? 'json' : 'custom', aiEnabled: workbenchAIEnabled(provider) }
          await provider.lifecycle?.cleanup?.(environment, signal)
          signal.throwIfAborted()
          await rm(environment.dataDirectory, { recursive: true, force: true })
          await this.domain.table('instances').delete(document.instanceId)
        }
      })()
      this.cleanupOperations.add(task)
      try { await task; cleaned = true } finally { this.cleanupOperations.delete(task) }
    }
    return { cleanup, complete: () => { if (!cleaned) throw new Error('Cleanup has not finished'); this.removing.delete(id) } }
  }

  private async prepareData(provider: WorkbenchProvider, document: WorkbenchDocument): Promise<void> {
    const dataDirectory = await this.ensureDirectory(document.instanceId)
    if (!provider.lifecycle || this.preparedData.get(provider)?.has(document.instanceId)) return
    let task = this.preparingData.get(document.instanceId)
    if (!task) {
      const entry = this.assertLoaded(provider)
      task = prepareWorkbenchData(provider.lifecycle, { id: document.id, instanceId: document.instanceId, version: provider.version,
        dataDirectory, resourcesDirectory: provider.resourcesDirectory ?? null,
        storage: workbenchJsonStorage(provider) ? 'json' : 'custom', aiEnabled: workbenchAIEnabled(provider) }, entry.abort.signal)
      this.preparingData.set(document.instanceId, task)
    }
    try {
      await task
      this.assertLoaded(provider)
      let ready = this.preparedData.get(provider)
      if (!ready) { ready = new Set(); this.preparedData.set(provider, ready) }
      ready.add(document.instanceId)
    } finally { if (this.preparingData.get(document.instanceId) === task) this.preparingData.delete(document.instanceId) }
  }

  private loadedProvider(id: WorkbenchId): WorkbenchProvider {
    if (this.developmentLocks.has(id) && this.developmentOwner.getStore() !== id) throw new RemoteError('workbench/unavailable', 'Workbench development update is in progress.', {})
    const entry = this.providers.get(id)
    const provider = !this.disposed && !this.removing.has(id) && !entry?.retirement ? entry?.provider : undefined
    if (!provider) throw new RemoteError('workbench/unavailable', 'Workbench provider is not loaded.', {})
    return provider
  }
  private provider(selection: WorkbenchSelection): WorkbenchProvider {
    const provider = this.loadedProvider(selection.id)
    if (provider.version !== selection.version) throw new RemoteError('workbench/unavailable', 'The selected workbench version is unavailable. Select the installed version to continue.', {})
    if (!workbenchAIEnabled(provider)) throw new RemoteError('workbench/ai-disabled', 'Native AI is disabled for this workbench.', {})
    return provider
  }
  private assertLoaded(provider: WorkbenchProvider): RegisteredWorkbench {
    const entry = this.providers.get(provider.id)
    if (this.disposed || entry?.provider !== provider || entry.retirement) throw new RemoteError('workbench/unavailable', 'Workbench provider changed. Open the installed version again.', {})
    return entry
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
  private async prepare(
    agent: Agent, provider: WorkbenchProvider, context: WorkbenchRuntimeContext, signal: AbortSignal,
  ): Promise<WorkbenchActivation | null> {
    let active = this.scopes.get(agent)
    if (active?.provider !== provider || active.abort.signal.aborted || active.objectId !== (context.object?.id ?? null)) {
      await this.clearScope(agent)
      signal.throwIfAborted()
      this.assertLoaded(provider)
      const scope = createScope(agent.ctx, agent)
      const created: ActiveCapabilities = {
        scope, provider, abort: new AbortController(), activation: null, ready: false, mounting: undefined,
        objectId: context.object?.id ?? null,
      }
      active = created
      this.scopes.set(agent, created)
      scope.ctx.effect(() => async () => {
        created.abort.abort(new Error('Workbench capability scope closed'))
        // The raw callbacks never await this disposer; their caller owns failure rollback.
        await created.mounting?.catch((_preparationFailed: unknown) => {})
        if (this.scopes.get(agent) === created) this.scopes.delete(agent)
      })
    }
    const owned = active
    const combined = AbortSignal.any([signal, owned.abort.signal])
    const predecessor = owned.mounting
    owned.mounting = Promise.resolve().then(async () => {
      await predecessor
      combined.throwIfAborted()
      this.assertLoaded(provider)
      if (context.object) {
        if (!provider.resolveObject) throw new RemoteError('workbench/unavailable', 'The selected business object is unavailable.', {})
        await provider.resolveObject(context.object.id, context, combined)
        combined.throwIfAborted()
      }
      await provider.prepare?.(context, combined)
      combined.throwIfAborted()
      this.assertLoaded(provider)
      if (!owned.ready) {
        if (workbenchJsonStorage(provider)) this.mountTools(owned.scope.ctx)
        owned.activation = await provider.activate?.(owned.scope.ctx, context, combined) ?? null
        combined.throwIfAborted()
        this.assertLoaded(provider)
        owned.ready = true
      }
      return owned.activation
    })
    const stop = () => { void owned.scope.dispose().catch((error: unknown) => { this.ctx.logger.warn('Unable to close workbench capabilities: %s', error) }) }
    combined.addEventListener('abort', stop, { once: true })
    try { return await owned.mounting }
    catch (error) { await this.clearScope(agent); throw error }
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
