/** Workbench-scoped platform reads over the credential-free Main/Host channel. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService, principalOf } from '@deepseek-ai/dsh-typert-protocol'
import { parseWorkbenchModelCatalog } from './workbench-platform-protocol.ts'
import type { WorkbenchModelCatalog, WorkbenchTarget } from './types.ts'
import type { WorkbenchRuntime } from './workbench-runtime.ts'

declare module '@deepseek-ai/cordis' { interface Context { actveroWorkbenchPlatform: WorkbenchPlatformAccess } }
declare module '@deepseek-ai/dsh-typert-protocol' { interface RemoteErrorDetailsMap { 'workbench/platform': { code: string } } }

/** Read-only platform consumer; model tokens stay in Electron Main. */
export class WorkbenchPlatformAccess extends TypertRemoteService {
  private readonly pending = new Map<string, { complete(value: unknown, error?: string): void; cancel(code: string): void }>()
  private disposed = false
  /** @param ctx Host plugin lifetime. @param runtime Loaded workbench registry. @param timeoutMs Maximum request wait. */
  constructor(ctx: Context, private readonly runtime: WorkbenchRuntime, private readonly timeoutMs: number) {
    super(ctx, 'actveroWorkbenchPlatform', { namespace: 'actveroWorkbenchPlatform' })
    ctx.effect(() => {
      const receive = (value: unknown) => {
        if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'actvero:workbench:result'
          || !('id' in value) || typeof value.id !== 'string') return
        const error = 'error' in value && typeof value.error === 'string' && /^[a-z_0-9]{1,80}$/u.test(value.error) ? value.error : undefined
        this.pending.get(value.id)?.complete('value' in value ? value.value : undefined, error)
      }
      process.on('message', receive)
      return () => {
        this.disposed = true
        process.off('message', receive)
        for (const entry of [...this.pending.values()]) entry.cancel('platform_unavailable')
      }
    })
  }

  /** Read the current account's directory for an explicitly declared workbench capability.
   * @param target Installed business instance; UI-only and undeclared providers are rejected.
   * @param signal Caller lifetime; cancellation stops Main's pending HTTP read.
   * @returns Sanitized model metadata for one account generation, without credentials or service URLs.
   */
  @Remote
  async models(target: WorkbenchTarget, signal: AbortSignal): Promise<WorkbenchModelCatalog> {
    if (principalOf(this.ctx.invocation)) throw new RemoteError('workbench/platform', 'Owner access required.', { code: 'platform_not_authorized' })
    const version = this.runtime.platformAccess(target)
    if (this.disposed || !process.send) throw new RemoteError('workbench/platform', 'Desktop platform unavailable.', { code: 'platform_unavailable' })
    signal.throwIfAborted()
    const result = await new Promise<WorkbenchModelCatalog>((resolve, reject) => {
      const id = randomUUID()
      const finish = (value: unknown, error?: string) => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        signal.removeEventListener('abort', aborted)
        if (error) { reject(new RemoteError('workbench/platform', 'Platform read did not complete.', { code: error })); return }
        try { resolve(parseWorkbenchModelCatalog(value)) }
        catch (_error) { reject(new RemoteError('workbench/platform', 'Invalid platform reply.', { code: 'platform_invalid_response' })) }
      }
      const cancel = (code: string) => {
        try { process.send?.({ type: 'actvero:workbench:cancel', id }) }
        catch (error) { this.ctx.logger.warn('Unable to cancel platform read: %s', error) }
        finish(undefined, code)
      }
      const aborted = () => { cancel('platform_cancelled') }
      const timer = setTimeout(() => { cancel('platform_timeout') }, this.timeoutMs)
      this.pending.set(id, { complete: finish, cancel })
      signal.addEventListener('abort', aborted, { once: true })
      try { process.send?.({ type: 'actvero:workbench:request', id, action: 'models', input: {} }) }
      catch (_error) { finish(undefined, 'platform_unavailable') }
    })
    signal.throwIfAborted()
    if (this.runtime.platformAccess(target) !== version) throw new RemoteError('workbench/platform', 'Workbench changed.', { code: 'platform_workbench_changed' })
    return result
  }
}
