/** Bind human navigation to native business instances and conversations. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@actvero/dsh-client-account/protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ActveroWorkbench, WorkbenchClientContext } from '../../contracts.ts'
import type { WorkbenchDocument, WorkbenchId, WorkbenchInstanceId } from '../../types.ts'

/** Human actions for opening data and selecting a conversation environment. */
export class WorkbenchClientRuntime {
  private readonly pending = new Map<string, Promise<WorkbenchDocument | null>>()
  private readonly conversations = new Map<WorkbenchInstanceId, SessionId>()

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
    if (!catalog.value.some(item => item.id === id)) return null
    const result = await this.ctx.remote.actveroWorkbench.open(id as WorkbenchId)
    if (!result.ok) throw result.error
    return result.value
  }

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
   * @param descriptor Registered package and version, with its organization scope for platform installs.
   * @returns Capabilities bound to this instance.
   */
  context(instanceId: WorkbenchInstanceId | null, sessionId: SessionId | null,
    showConversation: (id: SessionId) => Promise<void>,
    descriptor?: Pick<ActveroWorkbench, 'id' | 'version'> & { scope?: string }): WorkbenchClientContext {
    return {
      instanceId, sessionId,
      resourceAddress: instanceId ? `dsh-resource://actvero-workbench/${instanceId}` : null,
      account: async () => {
        const account = await window.actveroAccount?.snapshot()
        if (account?.phase !== 'ready' || !account.user) return null
        return { user: { id: account.user.id, name: account.user.name }, organization: account.organization
          ? { tenantId: account.organization.tenantId, name: account.organization.name } : null }
      },
      config: async () => {
        const bridge = window.actveroAccount
        if (!descriptor || !bridge?.workbenchConfig) throw new Error('workbench_config_unavailable')
        return bridge.workbenchConfig({ packageName: descriptor.id, version: descriptor.version,
          ...(descriptor.scope ? { scope: descriptor.scope } : {}),
        })
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
