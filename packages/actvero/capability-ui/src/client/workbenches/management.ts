/** Installed workbench operations; runtime registration remains a separate source of truth. */
import type { Context } from '@deepseek-ai/cordis'
import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-api-remotes/client'
import semver from 'semver'
import { readWorkbenchPackage } from './archive.ts'

/** Localized outcome with optional installer diagnostics. */
export type WorkbenchNotice = 'invalidPackage' | 'desktopOnly' | 'importFailed' | 'incompatible' | 'applied' | 'restart'
  | 'currentVersion' | 'olderVersion' | 'wrongPackage' | 'changedElsewhere' | 'enabled' | 'disabled' | 'removed'
  | 'operationFailed' | 'overridden' | 'cancelled' | 'unknownOutcome' | 'stopFirst'

/** Reviewed replacement, held only until the person confirms or cancels. */
export interface WorkbenchUpdate {
  name: string
  from: string
  to: string
  path: string
  enabled: boolean
}

/** Installed inventory and operation state shared by workbench views. */
export interface WorkbenchManagement {
  bundles: readonly BundleInfo[]
  refreshing: boolean
  inventoryFailed: boolean
  busy: string | null
  notice: WorkbenchNotice | null
  diagnostic: string
  pendingUpdate: WorkbenchUpdate | null
  restart: readonly string[]
}

/** Create profile operations; failed reads retain the last list but disable writes until refreshed.
 * @param remote Host package manager facade.
 * @param publish Update the registered view state.
 * @returns Actions and disposal for the owning client registration.
 */
export function createWorkbenchManagement(
  remote: Pick<Context['remote']['pluginManager'], 'listBundles' | 'installBundle' | 'setBundleEnabled' | 'removeBundle'>,
  publish: (state: WorkbenchManagement) => void,
) {
  let state: WorkbenchManagement = {
    bundles: [], refreshing: false, inventoryFailed: false, busy: null, notice: null, diagnostic: '', pendingUpdate: null, restart: [],
  }
  let disposed = false
  let loading: Promise<void> | undefined
  let requested = false
  const update = (patch: Partial<WorkbenchManagement>) => { state = { ...state, ...patch }; if (!disposed) publish(state) }
  const refresh = (): Promise<void> => {
    requested = true
    if (loading) return loading
    loading = (async () => {
      update({ refreshing: true })
      while (requested && !disposed) {
        requested = false
        try {
          const result = await remote.listBundles()
          if (!result.ok) { update({ inventoryFailed: true }); continue }
          update({ bundles: result.value, inventoryFailed: false })
        } catch (error) {
          console.warn('Unable to refresh installed workbenches', error)
          update({ inventoryFailed: true })
        }
      }
      update({ refreshing: false })
    })().finally(() => { loading = undefined })
    return loading
  }
  const outcome = (result: ChangeResult, success: WorkbenchNotice) => {
    let notice: WorkbenchNotice
    switch (result.application) {
      case 'applied': notice = success; break
      case 'restart-required': notice = 'restart'; update({ restart: [...new Set([...state.restart, result.target])] }); break
      case 'overridden': notice = 'overridden'; break
      case 'cancelled': notice = 'cancelled'; break
      case 'failed':
        notice = result.error?.code === 'incompatible-version' ? 'incompatible'
          : result.error?.code === 'stale-approval' ? 'changedElsewhere'
            : result.error?.code === 'stop-profile' || result.error?.code === 'bundle-in-use' ? 'stopFirst' : 'operationFailed'
        break
    }
    update({ notice, diagnostic: result.error?.diagnostic ?? result.packageResult?.kind ?? '' })
  }
  const run = async (target: string, operation: () => ReturnType<typeof remote.installBundle>, success: WorkbenchNotice) => {
    if (state.busy || state.inventoryFailed || disposed) return
    update({ busy: target, notice: null, diagnostic: '' })
    try {
      const result = await operation()
      if (result.ok) outcome(result.value, success)
      else update({ notice: 'unknownOutcome' })
    } catch (error) {
      console.warn('Workbench operation outcome unavailable', error)
      update({ notice: 'unknownOutcome' })
    } finally {
      await refresh()
      update({ busy: null })
    }
  }
  return {
    initial: state,
    refresh,
    dispose: () => { disposed = true },
    cancelUpdate() { if (!state.busy) update({ pendingUpdate: null }) },
    async confirmUpdate() {
      const pending = state.pendingUpdate
      if (!pending || state.busy) return
      update({ pendingUpdate: null })
      await run(pending.name, () => remote.installBundle(pending.path, {
        enabled: pending.enabled, registry: null, replace: { name: pending.name, version: pending.from, nextVersion: pending.to },
      }), 'applied')
    },
    async importFile(file: File, expectedName?: string) {
      if (state.busy || disposed) return
      update({ busy: 'inspect', notice: null, diagnostic: '', pendingUpdate: null })
      try {
        const summary = await readWorkbenchPackage(file)
        if (!summary || semver.valid(summary.version) !== summary.version) { update({ notice: 'invalidPackage' }); return }
        if (expectedName && expectedName !== summary.name) { update({ notice: 'wrongPackage' }); return }
        const bridge = (globalThis as { __DSH_HOST_PATHS__?: { pathFor(file: File): string } }).__DSH_HOST_PATHS__
        const path = bridge?.pathFor(file)
        if (!path) { update({ notice: 'desktopOnly' }); return }
        await refresh()
        if (state.inventoryFailed) return
        const current = state.bundles.find(bundle => bundle.name === summary.name && bundle.installed)
        if (current) {
          if (!current.version || !semver.valid(current.version) || !current.removable) { update({ notice: 'operationFailed' }); return }
          if (semver.eq(summary.version, current.version)) { update({ notice: 'currentVersion' }); return }
          if (semver.lt(summary.version, current.version)) { update({ notice: 'olderVersion' }); return }
          update({ pendingUpdate: { name: summary.name, from: current.version, to: summary.version, path, enabled: current.enabled } })
        } else if (expectedName) update({ notice: 'changedElsewhere' })
        else {
          // Transfer the inspection's write guard directly to the installer.
          update({ busy: null })
          await run(summary.name, () => remote.installBundle(path, { enabled: true, registry: null }), 'applied')
        }
      } catch (error) {
        console.warn('Unable to inspect workbench archive', error)
        update({ notice: 'importFailed' })
      } finally { update({ busy: null }) }
    },
    async setEnabled(name: string, enabled: boolean) {
      await run(name, () => remote.setBundleEnabled(name, enabled), enabled ? 'enabled' : 'disabled')
    },
    async remove(name: string) {
      await run(name, () => remote.removeBundle(name), 'removed')
    },
  }
}
