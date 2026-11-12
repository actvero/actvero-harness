/** Installed workbench operations; runtime registration remains a separate source of truth. */
import type { Context } from '@deepseek-ai/cordis'
import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-api-remotes/client'
import semver from 'semver'
import { workbenchArchiveSource, type PublishedWorkbench } from '@actvero/dsh-client-account/protocol'
import { WorkbenchHostCompatibilityError } from '../../workbench-protocol.ts'
import { readWorkbenchPackage } from './archive.ts'

/** Localized outcome with optional installer diagnostics. */
export type WorkbenchNotice = 'invalidPackage' | 'desktopOnly' | 'importFailed' | 'incompatible' | 'restart'
  | 'currentVersion' | 'olderVersion' | 'wrongPackage' | 'changedElsewhere'
  | 'operationFailed' | 'overridden' | 'unknownOutcome' | 'stopFirst' | 'activeConversation' | 'sessionStateUnavailable'
  | 'platformDownloadFailed' | 'platformConflict' | 'platformDenied' | 'platformCheckFailed'
  | { kind: 'hostIncompatible'; requiredHostApi: string; currentHostApi: string }

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
 * @param beforeChange Refresh linked conversation activity and reject changes while its state is running or unavailable.
 * @returns Actions and disposal for the owning client registration.
 */
export function createWorkbenchManagement(
  remote: Pick<Context['remote']['pluginManager'], 'listBundles' | 'installBundle' | 'setBundleEnabled' | 'removeBundle'>,
  publish: (state: WorkbenchManagement) => void,
  beforeChange: (name: string) => Promise<'activeConversation' | 'sessionStateUnavailable' | null>,
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
  const outcome = (result: ChangeResult) => {
    let notice: WorkbenchNotice | null
    switch (result.application) {
      case 'applied': notice = null; break
      case 'restart-required': notice = 'restart'; update({ restart: [...new Set([...state.restart, result.target])] }); break
      case 'overridden': notice = 'overridden'; break
      case 'cancelled': notice = null; break
      case 'failed':
        notice = result.error?.code === 'incompatible-version' ? 'incompatible'
          : result.error?.code === 'stale-approval' ? 'changedElsewhere'
            : result.error?.code === 'stop-profile' || result.error?.code === 'bundle-in-use' ? 'stopFirst' : 'operationFailed'
        break
    }
    update({ notice, diagnostic: notice === null ? '' : result.error?.diagnostic ?? result.packageResult?.kind ?? '' })
  }
  const run = async (target: string, operation: () => ReturnType<typeof remote.installBundle>) => {
    if (state.busy || state.inventoryFailed || disposed) return false
    update({ busy: target, notice: null, diagnostic: '' })
    try {
      const blocked = await beforeChange(target)
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose() can run during the await.
      if (disposed) return
      if (blocked) { update({ notice: blocked }); return }
      const result = await operation()
      if (result.ok) {
        outcome(result.value)
        return result.value.application === 'applied'
      }
      update({ notice: 'unknownOutcome' })
    } catch (error) {
      console.warn('Workbench operation outcome unavailable', error)
      update({ notice: 'unknownOutcome' })
    } finally {
      await refresh()
      update({ busy: null })
    }
    return false
  }
  return {
    initial: state,
    refresh,
    dispose: () => { disposed = true },
    report(notice: WorkbenchNotice) { update({ notice, diagnostic: '' }) },
    async installPublished(
      release: PublishedWorkbench,
      scope: string,
      download: () => Promise<string>,
      stillCurrent: () => boolean,
    ) {
      if (state.busy || state.inventoryFailed || disposed) return false
      update({ busy: release.packageName, notice: null, diagnostic: '', pendingUpdate: null })
      const current = state.bundles.find(bundle => bundle.name === release.packageName && bundle.installed)
      try {
        if (current) {
          const source = workbenchArchiveSource(current.source)
          if (!source || source.scope !== scope || source.workbenchId !== release.workbenchId
            || !current.removable || !current.version || !semver.valid(current.version)
            || !semver.valid(release.version) || !semver.gt(release.version, current.version)) {
            update({ notice: 'platformConflict' })
            return false
          }
        }
        let path: string
        try {
          path = await download()
        } catch {
          if (stillCurrent()) update({ notice: 'platformDownloadFailed' })
          return false
        }
        if (disposed || !stillCurrent()) return false
        update({ busy: null })
        return await run(release.packageName, () => remote.installBundle(path, {
          enabled: true, registry: null,
          ...(current?.version ? { replace: {
            name: release.packageName,
            version: current.version,
            nextVersion: release.version,
            ...(current.source ? { source: current.source } : {}),
          } }
            : { installNew: { name: release.packageName, version: release.version } }),
        }))
      } finally {
        update({ busy: null })
      }
    },
    cancelUpdate() { if (!state.busy) update({ pendingUpdate: null }) },
    async confirmUpdate() {
      const pending = state.pendingUpdate
      if (!pending || state.busy) return
      update({ pendingUpdate: null })
      await run(pending.name, () => remote.installBundle(pending.path, {
        enabled: pending.enabled, registry: null, replace: { name: pending.name, version: pending.from, nextVersion: pending.to },
      }))
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
          if (workbenchArchiveSource(current.source)) { update({ notice: 'platformConflict' }); return }
          if (!current.version || !semver.valid(current.version) || !current.removable) { update({ notice: 'operationFailed' }); return }
          if (semver.eq(summary.version, current.version)) { update({ notice: 'currentVersion' }); return }
          if (semver.lt(summary.version, current.version)) { update({ notice: 'olderVersion' }); return }
          update({ pendingUpdate: { name: summary.name, from: current.version, to: summary.version, path, enabled: current.enabled } })
        } else if (expectedName) update({ notice: 'changedElsewhere' })
        else {
          // Transfer the inspection's write guard directly to the installer.
          update({ busy: null })
          await run(summary.name, () => remote.installBundle(path, { enabled: true, registry: null }))
        }
      } catch (error) {
        if (error instanceof WorkbenchHostCompatibilityError) {
          update({ notice: { kind: 'hostIncompatible', requiredHostApi: error.requiredHostApi, currentHostApi: error.currentHostApi } })
          return
        }
        console.warn('Unable to inspect workbench archive', error)
        update({ notice: 'importFailed' })
      } finally { update({ busy: null }) }
    },
    async setEnabled(name: string, enabled: boolean) {
      return run(name, () => remote.setBundleEnabled(name, enabled))
    },
    async remove(name: string) {
      await run(name, () => remote.removeBundle(name))
    },
  }
}
