import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
/** Workbench navigation and native Session selection, independent of foreground presentation. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PluginInstallRequestId } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { z } from 'zod'
import { actionResultSchema, snapshotSchema, projectIdSchema, sessionIdSchema, workbenchIdSchema } from '../contracts.ts'
import type { WorkbenchData, ProjectId, WorkbenchAction, WorkbenchId, WorkbenchSnapshot, WorkbenchView } from '../contracts.ts'
import type { WorkbenchLocaleKey } from './locales.ts'
/** Native layout panel containing the workbench catalog. */
export const PANEL = 'actvero-local-workbenches' as MainPanelId
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    actveroWorkbench: unknown
  }
}
const STORAGE = 'actvero.local-workbench.navigation.v1'
const savedSchema = z.object({ active: workbenchIdSchema, projectId: projectIdSchema, sessionId: sessionIdSchema.optional(), view: z.enum(['business', 'split', 'conversation']) })
/** Observable navigation and request state; business data remains host-owned. */
export interface ClientState {
  snapshot?: WorkbenchSnapshot
  active?: WorkbenchId
  projectId?: ProjectId
  sessionId?: SessionId
  reference?: SessionReference
  view: WorkbenchView
  preview: boolean
  busy: boolean
  error?: WorkbenchLocaleKey
  notice?: WorkbenchLocaleKey
}
const errors: Record<string, WorkbenchLocaleKey> = { 'invalid-state': 'invalidState', 'invalid-request': 'invalidRequest', unavailable: 'unavailable', conflict: 'conflict', 'missing-directory': 'missingDirectory', 'missing-project': 'unavailable', 'conversation-failed': 'conversationFailed', 'binding-save-failed': 'bindingFailed' }
class RequestFailure extends Error {
  constructor(readonly key: WorkbenchLocaleKey) { super(key) }
}
const errorSchema = z.object({ error: z.string() })
async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch('/api/actvero-workbenches/' + path, { credentials: 'same-origin', cache: 'no-store', ...init })
  const data: unknown = await response.json()
  if (!response.ok) {
    const failure = errorSchema.safeParse(data)
    throw new RequestFailure(failure.success ? errors[failure.data.error] ?? 'failed' : 'failed')
  }
  return data
}
/** Disposable client controller for local work and native conversation selection. */
export class WorkbenchClient {
  private readonly state = createSnapshotStore<ClientState>({ view: 'business', preview: false, busy: false })
  private disposed = false
  private navigation = 0
  private reference?: SessionReference
  private readonly lifetime = new AbortController()
  private timer?: ReturnType<typeof setTimeout>
  readonly getSnapshot = () => this.state.getSnapshot()
  readonly subscribe = (listener: () => void) => this.state.subscribe(listener)
  constructor(readonly ctx: Context) { }
  private set(update: Partial<ClientState>): void {
    if (this.disposed)
      return
    this.state.set({ ...this.getSnapshot(), ...update })
  }
  private persist(): void {
    const { active, projectId, sessionId, view } = this.getSnapshot()
    try {
      if (active && projectId)
        localStorage.setItem(STORAGE, JSON.stringify({ active, projectId, sessionId, view }))
      else
        localStorage.removeItem(STORAGE)
    }
    catch (error) {
      console.warn('Workbench navigation preference could not be saved', error)
    }
  }
  private async command(action: WorkbenchAction) {
    return actionResultSchema.parse(await request('action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) }))
  }
  async refresh(): Promise<void> {
    const snapshot = snapshotSchema.parse(await request('state'))
    this.set({ snapshot })
  }
  private async run(operation: () => Promise<void>): Promise<void> {
    if (this.getSnapshot().busy || this.disposed)
      return
    this.set({ busy: true, error: undefined, notice: undefined })
    try {
      await operation()
    }
    catch (error) {
      this.set({ error: error instanceof RequestFailure ? error.key : 'failed' })
      console.warn('Local workbench operation failed', error)
    }
    finally {
      this.set({ busy: false })
    }
  }
  async start(): Promise<void> {
    await this.run(async () => {
      await this.refresh()
      let stored: unknown
      try {
        stored = JSON.parse(localStorage.getItem(STORAGE) ?? 'null')
      }
      catch (error) {
        console.warn('Workbench navigation preference is invalid', error)
      }
      const saved = savedSchema.safeParse(stored)
      const snapshot = this.getSnapshot().snapshot
      if (saved.success
        && snapshot?.projects.some(p => p.id === saved.data.projectId && p.workbenchId === saved.data.active)
        && snapshot.definitions.some(d => d.id === saved.data.active)) {
        this.set({ ...saved.data, view: 'business', sessionId: undefined })
        if (saved.data.sessionId)
          await this.selectSession(saved.data.sessionId)
        this.set(saved.data)
      }
    })
    this.poll()
  }
  private poll(): void {
    if (this.disposed)
      return
    const delay = this.getSnapshot().snapshot?.refreshIntervalMs ?? 2500
    this.timer = setTimeout(() => {
      const active = this.getSnapshot().active
      const done = active && !this.getSnapshot().busy ? this.refresh().catch((error: unknown) => { this.set({ error: error instanceof RequestFailure ? error.key : 'failed' }) }) : Promise.resolve()
      void done.finally(() => { this.poll() })
    }, delay)
  }
  open(id: WorkbenchId): Promise<void> {
    const ticket = ++this.navigation
    return this.run(async () => {
      const result = await this.command({ action: 'open', workbenchId: id })
      await this.refresh()
      if (ticket !== this.navigation || this.disposed)
        return
      const existing = this.getSnapshot().snapshot?.conversations.filter(c => c.projectId === result.projectId).at(-1)
      this.set({ active: id, projectId: result.projectId, sessionId: existing?.sessionId, view: 'business', preview: false })
      this.ctx.layout.selectPanel(PANEL)
      this.persist()
    })
  }
  showHome = (): void => {
    ++this.navigation
    this.set({ active: undefined, projectId: undefined, sessionId: undefined, view: 'business', preview: false, error: undefined })
    this.ctx.layout.selectPanel(PANEL)
    this.persist()
  }
  create = (title: string): Promise<void> => this.run(async () => {
    const active = this.getSnapshot().active
    if (!active)
      return
    const result = await this.command({ action: 'create', workbenchId: active, title })
    await this.refresh()
    this.set({ projectId: result.projectId, sessionId: undefined, view: 'business' })
    this.persist()
  })
  selectProject = (projectId: ProjectId): void => {
    const snapshot = this.getSnapshot().snapshot
    const project = snapshot?.projects.find(p => p.id === projectId && p.workbenchId === this.getSnapshot().active)
    if (!project)
      return
    const session = snapshot?.conversations.filter(c => c.projectId === projectId).at(-1)
    this.set({ projectId, sessionId: session?.sessionId, view: 'business' })
    this.persist()
  }
  update = (projectId: ProjectId, revision: number, data: WorkbenchData): Promise<void> => this.run(async () => {
    await this.command({ action: 'update', projectId, revision, data })
    await this.refresh()
  })
  favorite = (id: WorkbenchId): Promise<void> => this.run(async () => { await this.command({ action: 'favorite', workbenchId: id }); await this.refresh() })
  private async catalogReady(): Promise<void> {
    if (this.ctx.sessions.list.getSnapshot().phase === 'ready')
      return
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        if (this.ctx.sessions.list.getSnapshot().phase !== 'ready')
          return
        unsubscribe()
        this.lifetime.signal.removeEventListener('abort', abort)
        resolve()
      }
      const abort = () => { unsubscribe(); reject(new Error('Workbench disposed')) }
      const unsubscribe = this.ctx.sessions.list.subscribe(finish)
      this.lifetime.signal.addEventListener('abort', abort, { once: true })
      if (this.lifetime.signal.aborted)
        abort()
      else
        finish()
    })
  }
  private async selectSession(sessionId: SessionId): Promise<void> {
    await this.catalogReady()
    if (this.reference?.sessionId === sessionId)
      return
    const reference = this.ctx.sessions.retain(sessionId, { source: 'actveroWorkbench' })
    try {
      await reference.ready
    }
    catch (error) {
      reference.release()
      throw error
    }
    if (this.disposed) {
      reference.release()
      return
    }
    const previous = this.reference
    this.reference = reference
    this.ctx.uiWorkspace.openSession(sessionId)
    this.ctx.layout.selectPanel(PANEL)
    this.set({ reference })
    previous?.release()
  }
  selectConversation = (sessionId: SessionId): Promise<void> => this.run(async () => {
    const state = this.getSnapshot()
    if (!state.snapshot?.conversations.some(c => c.sessionId === sessionId && c.projectId === state.projectId))
      return
    await this.selectSession(sessionId)
    this.set({ sessionId, view: state.view === 'business' ? 'split' : state.view })
    this.persist()
  })
  view = (view: WorkbenchView): Promise<void> => this.run(async () => {
    const ticket = this.navigation
    const state = this.getSnapshot()
    if (view !== 'business') {
      if (!state.sessionId) {
        if (!state.projectId)
          return
        const result = await this.command({ action: 'conversation', projectId: state.projectId })
        if (!result.sessionId)
          throw new RequestFailure('conversationFailed')
        if (ticket !== this.navigation || this.disposed)
          return
        await this.selectSession(result.sessionId)
        this.set({ sessionId: result.sessionId })
        await this.refresh()
      }
      else
        await this.selectSession(state.sessionId)
    }
    this.set({ view })
    this.persist()
  })
  newConversation = (): Promise<void> => this.run(async () => {
    const ticket = this.navigation
    const state = this.getSnapshot()
    if (!state.projectId)
      return
    const result = await this.command({ action: 'conversation', projectId: state.projectId })
    if (!result.sessionId)
      throw new RequestFailure('conversationFailed')
    if (ticket !== this.navigation || this.disposed)
      return
    await this.selectSession(result.sessionId)
    this.set({ sessionId: result.sessionId, view: state.view === 'business' ? 'split' : state.view })
    await this.refresh()
    this.persist()
  })
  togglePreview = (): void => { this.set({ preview: !this.getSnapshot().preview }) }
  reload = (): Promise<void> => this.run(() => this.refresh())
  import = (file: File): Promise<void> => this.run(async () => {
    if (!file.name.toLowerCase().endsWith('.tgz'))
      throw new RequestFailure('invalidRequest')
    const uploaded = z.object({ path: z.string() }).parse(await request('import', { method: 'POST', headers: { 'content-type': 'application/gzip' }, body: file }))
    const result = await this.ctx.remote.pluginManager.installBundle(uploaded.path, {
      enabled: true, registry: null, requestId: brandString<PluginInstallRequestId>(randomUUID()),
    })
    if ('error' in result)
      throw new RequestFailure('notApplied')
    const application = result.value.application
    this.set({ notice: application === 'applied' ? 'installedApplied' : application === 'restart-required' ? 'restartRequired' : 'notApplied' })
    await this.refresh()
  })
  manage = (): void => { this.showHome(); this.ctx.pluginNavigation.openList() }
  compatibility = (): void => { this.showHome(); this.ctx.layout.selectPanel('desktop-workbenches' as MainPanelId) }
  dispose(): void { this.disposed = true; ++this.navigation; clearTimeout(this.timer); this.reference?.release(); this.lifetime.abort() }
}
