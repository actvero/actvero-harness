/** Fixed platform reads performed in Main; no token or arbitrary URL crosses to a workbench. */
import { createHash, randomUUID } from 'node:crypto'
import { parseWorkbenchModelCatalog, parseWorkbenchModelPage, type WorkbenchModelCatalog } from '@actvero/dsh-capability-ui/platform'
import type { AccountController } from './controller.ts'

/** Main-owned account and cancellation scope for workbench platform access. */
export class WorkbenchPlatform {
  private generation = 0
  private readonly lifetimeId = randomUUID()
  private readonly active = new Set<AbortController>()
  /** @param account Native credential authority. @param request Main-owned HTTP implementation. */
  constructor(private readonly account: Pick<AccountController, 'snapshot' | 'resourceToken' | 'identityRevision'>,
    private readonly request: typeof fetch = fetch) {}

  /** Invalidate pending reads when account availability or organization changes. */
  invalidate(): void { this.generation++; for (const controller of this.active) controller.abort() }

  private scope(): string {
    const value = this.account.snapshot()
    if (value.phase !== 'ready' || !value.user || !value.organization || value.organization.status !== 'active' || value.organization.needsLogin) {
      throw new Error('platform_account_unavailable')
    }
    return createHash('sha256').update(JSON.stringify([value.baseUrl, value.user.id, value.organization.tenantId,
      value.organization.memberId, this.account.identityRevision(), this.generation, this.lifetimeId])).digest('hex')
  }

  /** Read all visible model operations through an account-scoped, read-only resource.
   * @param signal Host cancellation, timeout or disconnect.
   * @returns Complete public directory; a scope change rejects without returning earlier data.
   */
  async models(signal: AbortSignal): Promise<WorkbenchModelCatalog> {
    const scope = this.scope()
    const controller = new AbortController()
    this.active.add(controller)
    const lifetime = AbortSignal.any([signal, controller.signal])
    const current = () => {
      lifetime.throwIfAborted()
      if (this.scope() !== scope) throw new Error('platform_account_changed')
    }
    try {
      current()
      const token = await this.account.resourceToken('llm:catalog')
      current()
      if (token.endpoint !== `${this.account.snapshot().baseUrl}/api/llm/v1`) throw new Error('platform_invalid_response')
      const models: WorkbenchModelCatalog['models'] = []
      for (let page = 1; page <= 100; page++) {
        const response = await this.request(`${token.endpoint}/models?page=${page}`, {
          headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/json' }, redirect: 'error', signal: lifetime,
        })
        current()
        if (!response.ok) { await response.body?.cancel(); throw new Error('platform_request_failed') }
        const reader = response.body?.getReader()
        if (!reader) throw new Error('platform_invalid_response')
        const chunks: Uint8Array[] = []
        let size = 0
        try {
          for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            size += chunk.value.byteLength
            if (size > 1024 * 1024) throw new Error('platform_catalog_too_large')
            chunks.push(chunk.value)
          }
        } finally { await reader.cancel(); reader.releaseLock() }
        current()
        const parsed = parseWorkbenchModelPage(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        models.push(...parsed.models)
        if (models.length > 2000 || Buffer.byteLength(JSON.stringify(models)) > 1024 * 1024) throw new Error('platform_catalog_too_large')
        if (!parsed.hasMore) return parseWorkbenchModelCatalog({ scope, models })
      }
      throw new Error('platform_catalog_too_large')
    } finally { controller.abort(); this.active.delete(controller) }
  }
}
