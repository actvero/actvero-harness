/** Owner-confirmed workbench data cleanup followed by native package removal. */
import type { Context } from '@deepseek-ai/cordis'
import type { PluginManager } from '@deepseek-ai/dsh-plugin-manager'
import { Remote, RemoteError, TypertRemoteService, principalOf } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkbenchRuntime } from './workbench-runtime.ts'
import type { WorkbenchId, WorkbenchRemovalResult } from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { actveroWorkbenchMaintenance: WorkbenchMaintenance } }

/** Uses the same installer as ordinary removal, with explicit consent to data destruction. */
export class WorkbenchMaintenance extends TypertRemoteService {
  private busy = false
  /**
   * @param ctx Host owner scope.
   * @param runtime Business data and provider lifetimes.
   * @param installer Native installer shared with ordinary removal.
   */
  constructor(ctx: Context, private readonly runtime: WorkbenchRuntime, private readonly installer: Pick<PluginManager, 'listBundles' | 'removeBundle'>) {
    super(ctx, 'actveroWorkbenchMaintenance', { namespace: 'actveroWorkbenchMaintenance' })
  }

  /** Clean a reviewed, loaded workbench and then remove its package. Never invoked for ordinary keep-data removal.
   * @param request Exact package version and explicit cleanup consent from the owner UI.
   * @returns Separate data and package outcomes; partial cleanup stops package removal and requires inspection/restart.
   */
  @Remote
  async uninstall(request: { id: WorkbenchId; version: string; deleteData: boolean }): Promise<WorkbenchRemovalResult> {
    if (principalOf(this.ctx.invocation)) {
      throw new RemoteError('workbench/unavailable', 'Owner access required.', {})
    }
    if (!request.deleteData || this.busy) throw new RemoteError('workbench/unavailable', 'Explicit cleanup consent and an idle installer are required.', {})
    this.busy = true
    let data: WorkbenchRemovalResult['data'] = 'preserved'
    try {
      const bundle = (await this.installer.listBundles()).find(item => item.name === request.id)
      if (!bundle?.installed || !bundle.removable || bundle.version !== request.version || bundle.restartRequired) {
        throw new Error('Installed workbench changed; refresh or restart before removing data')
      }
      const removal = await this.runtime.prepareRemoval(request.id, request.version)
      const current = (await this.installer.listBundles()).find(item => item.name === request.id)
      if (!current?.installed || current.version !== request.version || current.restartRequired) {
        throw new Error('Installed package changed before cleanup; restart the host')
      }
      data = 'partial'
      await removal.cleanup()
      data = 'cleaned'
      const result = await this.installer.removeBundle(request.id, request.version)
      if (result.application === 'applied') removal.complete()
      return { application: result.application === 'applied' || result.application === 'restart-required' ? result.application : 'failed',
        data, diagnostic: result.error?.diagnostic ?? result.error?.code ?? '' }
    } catch (error) {
      this.ctx.logger.warn('Workbench cleanup/removal incomplete: %s', error)
      return { application: 'failed', data, diagnostic: error instanceof Error ? error.message : String(error) }
    } finally { this.busy = false }
  }
}
