/** Bind human navigation to native business instances and conversations. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@actvero/dsh-client-account/protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchClientContext } from '../../contracts.ts'
import type { WorkbenchDocument, WorkbenchId, WorkbenchInstanceId } from '../../types.ts'

const legacyKey = 'actvero.workbenches.project-checklist.v1'

/** Human actions for opening data and selecting a conversation environment. */
export class WorkbenchClientRuntime {
  private readonly pending = new Map<string, Promise<WorkbenchDocument | null>>()
  private readonly conversations = new Map<WorkbenchInstanceId, SessionId>()
  private readonly aiInstances = new Set<WorkbenchInstanceId>()

  /**
   * @param ctx Client services.
   */
  constructor(private readonly ctx: Context) {}

  /** Resolve business data while leaving UI-only workbenches usable.
   * @param id Registered workbench identifier.
   * @returns Managed document, or null for UI-only providers.
   */
  async open(id: string): Promise<WorkbenchDocument | null> {
    const pending = this.pending.get(id)
    if (pending) return pending
    const operation = this.load(id)
    this.pending.set(id, operation)
    try { return await operation } finally { this.pending.delete(id) }
  }

  private async load(id: string): Promise<WorkbenchDocument | null> {
    const catalog = await this.ctx.remote.actveroWorkbench.list()
    if (!catalog.ok) throw catalog.error
    const provider = catalog.value.find(item => item.id === id)
    if (!provider) return null
    const result = await this.ctx.remote.actveroWorkbench.open(id as WorkbenchId)
    if (!result.ok) throw result.error
    if (provider.aiEnabled) this.aiInstances.add(result.value.instanceId)
    else this.aiInstances.delete(result.value.instanceId)
    if (id !== 'builtin:project-checklist') return result.value
    // The previous built-in stored only these three booleans in the renderer.
    let legacy: unknown
    try { legacy = JSON.parse(localStorage.getItem(legacyKey) ?? '[]') } catch (_error) { legacy = [] }
    const state: unknown = JSON.parse(result.value.json)
    if (typeof state === 'object' && state !== null && 'legacyImported' in state && state.legacyImported === false) {
      const completed = Array.isArray(legacy) ? ['sampleItem1', 'sampleItem2', 'sampleItem3'].filter(item => legacy.includes(item)) : []
      const migrated = await this.ctx.remote.actveroWorkbench.action({ instanceId: result.value.instanceId,
        revision: result.value.revision, action: 'import-legacy', args: JSON.stringify({ completed }) })
      if (!migrated.ok) {
        if (migrated.error.code !== 'workbench/conflict') throw migrated.error
        const latest = await this.ctx.remote.actveroWorkbench.read({ instanceId: result.value.instanceId })
        if (!latest.ok) throw latest.error
        return latest.value
      }
      return migrated.value
    }
    return result.value
  }

  /** Inspect AI availability after open() resolves the installed provider.
   * @param instanceId Opened instance, or null for a UI-only workbench.
   * @returns Whether the provider enables native conversations.
   */
  supportsAI(instanceId: WorkbenchInstanceId | null): boolean { return instanceId !== null && this.aiInstances.has(instanceId) }

  /** Attach the chosen business instance and navigate to its native conversation.
   * @param id Workbench identity.
   * @param sessionId Existing conversation, omitted for a fresh one.
   */
  async select(id: string, sessionId?: SessionId): Promise<void> {
    const document = await this.open(id)
    if (!document) throw new Error('Workbench has no conversation provider')
    const session = await this.bind(document.instanceId, sessionId)
    this.ctx.uiWorkspace.openSession(session)
    this.ctx.layout.selectPanel(null)
  }

  private async bind(instanceId: WorkbenchInstanceId, sessionId?: SessionId): Promise<SessionId> {
    const result = await this.ctx.remote.actveroWorkbench.bind({ instanceId, ...(sessionId ? { sessionId } : {}) })
    if (!result.ok) throw result.error
    this.conversations.set(instanceId, result.value.sessionId)
    await this.ctx.sessions.refresh()
    return result.value.sessionId
  }

  /** Build view callbacks without exposing credentials or service objects.
   * @param instanceId Managed business identity, absent for a UI-only workbench.
   * @param sessionId Conversation whose workbench is being previewed.
   * @param showConversation Render the associated conversation if its view is still active.
   * @returns Capabilities bound to this instance.
   */
  context(instanceId: WorkbenchInstanceId | null, sessionId: SessionId | null,
    showConversation: (id: SessionId) => Promise<void>): WorkbenchClientContext {
    return {
      instanceId, sessionId,
      resourceAddress: instanceId ? `dsh-resource://actvero-workbench/${instanceId}` : null,
      environment: async () => {
        if (!instanceId) return null
        const result = await this.ctx.remote.actveroWorkbench.environment({ instanceId })
        if (!result.ok) throw result.error
        return result.value
      },
      account: async () => {
        const account = await window.actveroAccount?.snapshot()
        if (account?.phase !== 'ready' || !account.user) return null
        return { user: { id: account.user.id, name: account.user.name }, organization: account.organization
          ? { tenantId: account.organization.tenantId, name: account.organization.name } : null }
      },
      conversation: async () => {
        if (!instanceId) throw new Error('Workbench has no conversation provider')
        const target = sessionId ?? this.conversations.get(instanceId)
        const bound = await this.bind(instanceId, target)
        await showConversation(bound)
      },
      action: async (revision, action, args) => {
        if (!instanceId) throw new Error('Workbench has no business instance')
        const result = await this.ctx.remote.actveroWorkbench.action({ instanceId, revision, action, args })
        if (!result.ok) throw result.error
        return result.value
      },
    }
  }
}
