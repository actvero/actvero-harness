/** Local workbench providers, revisioned business records and native conversation creation. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { WorkbenchStore } from './store.ts'
import { descriptorSchema, projectIdSchema, WorkbenchError } from './contracts.ts'
import type { ProjectId, WorkbenchAction, WorkbenchActionResult, WorkbenchId, WorkbenchProject, WorkbenchSnapshot, WorkbenchProvider } from './contracts.ts'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session'
/** Provider registry and durable business operations; presentation never owns data. */
export class WorkbenchRuntime {
  /** Loaded providers; unloading retains durable records. */
  readonly providers: Map<WorkbenchId, WorkbenchProvider> = new Map()
  /** Atomic local business storage shared by tools and renderer actions. */
  readonly store: WorkbenchStore
  constructor(readonly ctx: Context, readonly root: string, readonly refreshIntervalMs: number) { this.store = new WorkbenchStore(root) }
  /** Register a loaded provider; the caller owns disposal through its Cordis effect.
     * @param provider - Business metadata, validation and model instructions.
     * @returns Unregistration operation that retains stored business records. */
  register(provider: WorkbenchProvider): () => void {
    const descriptor = descriptorSchema.parse(provider.descriptor)
    if (this.providers.has(descriptor.id))
      throw new Error('duplicate workbench provider: ' + descriptor.id)
    const registered = { ...provider, descriptor }
    this.providers.set(descriptor.id, registered)
    return () => { if (this.providers.get(descriptor.id) === registered)
      this.providers.delete(descriptor.id) }
  }
  /** Read the loaded catalog and durable data.
     * @returns Current providers, business records, associations and storage metadata. */
  async snapshot(): Promise<WorkbenchSnapshot> {
    return {
      ...await this.store.read(),
      definitions: [...this.providers.values()].map(p => p.descriptor),
      storagePath: this.root,
      refreshIntervalMs: this.refreshIntervalMs,
    }
  }
  /** Resolve business material without consulting foreground navigation.
     * @param sessionId - Native conversation identity.
     * @returns Associated material, or undefined for an ordinary conversation. */
  async projectForSession(sessionId: SessionId): Promise<WorkbenchProject | undefined> {
    const state = await this.store.read()
    const binding = state.conversations.find(item => item.sessionId === sessionId)
    return binding && state.projects.find(item => item.id === binding.projectId)
  }
  private provider(id: WorkbenchId): WorkbenchProvider {
    const provider = this.providers.get(id)
    if (!provider)
      throw new WorkbenchError('unavailable')
    return provider
  }
  /** Apply a validated business command; stale revisions and unavailable providers reject.
     * @param request - Validated host, renderer or tool command.
     * @returns Identifiers produced by the completed operation. */
  async action(request: WorkbenchAction): Promise<WorkbenchActionResult> {
    if (request.action === 'conversation')
      return this.createConversation(request.projectId)
    return this.store.change((state) => {
      if (request.action === 'favorite') {
        this.provider(request.workbenchId)
        state.favorites = state.favorites.includes(request.workbenchId)
          ? state.favorites.filter(id => id !== request.workbenchId)
          : [...state.favorites, request.workbenchId]
        return {}
      }
      if (request.action === 'update') {
        const project = state.projects.find(item => item.id === request.projectId)
        if (!project)
          throw new WorkbenchError('missing-project')
        const provider = this.provider(project.workbenchId)
        if (project.revision !== request.revision)
          throw new WorkbenchError('conflict')
        const data = provider.validateData(request.data)
        project.data = data
        if (request.title !== undefined)
          project.title = request.title
        project.updatedAt = new Date().toISOString()
        project.revision++
        return { projectId: project.id }
      }
      const provider = this.provider(request.workbenchId)
      const previous = request.action === 'open' ? state.projects.filter(item => item.workbenchId === request.workbenchId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] : undefined
      if (previous)
        return { projectId: previous.id }
      const now = new Date().toISOString()
      const project: WorkbenchProject = { id: projectIdSchema.parse(randomUUID()), workbenchId: request.workbenchId, title: request.action === 'create' ? request.title : provider.descriptor.title, data: provider.validateData(provider.initialData()), revision: 0, createdAt: now, updatedAt: now }
      state.projects.push(project)
      return { projectId: project.id }
    })
  }
  /** Each topic gets a new native Session while retaining the same business files directory. */
  private async createConversation(projectId: ProjectId): Promise<WorkbenchActionResult> {
    const state = await this.store.read()
    const project = state.projects.find(item => item.id === projectId)
    if (!project)
      throw new WorkbenchError('missing-project')
    this.provider(project.workbenchId)
    const directory = join(this.root, 'projects', project.id, 'files')
    const previous = state.conversations.some(item => item.projectId === project.id)
    if (previous) {
      try {
        if (!(await stat(directory)).isDirectory())
          throw new WorkbenchError('missing-directory')
      }
      catch (error) {
        throw new WorkbenchError('missing-directory', { cause: error })
      }
    }
    else
      await mkdir(directory, { recursive: true, mode: 0o700 })
    const workspace = await this.ctx.workspaceRegistry.create(directory, project.title)
    let sessionId: SessionId
    try {
      const created = await this.ctx.sessionController.create({ sessionId: randomUUID() as SessionId, workspaceId: workspace.id })
      sessionId = created.sessionId
    }
    catch (error) {
      throw new WorkbenchError('conversation-failed', { cause: error })
    }
    try {
      await this.store.change((next) => { next.conversations.push({ projectId, sessionId, createdAt: new Date().toISOString() }) })
    }
    catch (error) {
      throw new WorkbenchError('binding-save-failed', { cause: error })
    }
    return { projectId, sessionId }
  }
}
