/** Join installed releases with independently registered client panels. */
import type { BundleInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type { ActveroWorkbench } from '../../contracts.ts'
import type { WorkbenchView } from './register.ts'

/** Package text resolver supplied by the host locale service. */
export type ResolveText = (text: NonNullable<NonNullable<BundleInfo['meta']>['title']>) => string

/** Manageable catalog item; loaded and installed versions can differ until restart. */
export interface WorkbenchItem extends ActveroWorkbench {
  bundle?: BundleInfo
  state: 'ready' | 'disabledState' | 'restartState' | 'failedState' | 'unloadedState'
  runningVersion?: string
}

/** Resolve the package artwork shared by every workbench view.
 * @param view Installed metadata and current or retained Client descriptors.
 * @param id Stable workbench package identity.
 * @returns Public package icon, legacy Client artwork, or undefined for the native fallback.
 */
export function workbenchIconUrl(view: Pick<WorkbenchView, 'entries' | 'remembered' | 'bundles'>, id: string): string | undefined {
  return view.bundles.find(bundle => bundle.name === id && bundle.installed)?.meta?.icon
    ?? view.entries.find(entry => entry.id === id)?.iconUrl
    ?? view.remembered.find(entry => entry.id === id)?.iconUrl
}

/** Build cards from the installed catalog without hiding disabled or failed bundles.
 * @param view Installed inventory and live panel registrations.
 * @param resolveText Current locale's package text resolver.
 * @returns Installed and independently contributed workbenches.
 */
export function workbenchCatalog(view: Pick<WorkbenchView, 'entries' | 'remembered' | 'bundles' | 'restart'>, resolveText: ResolveText): WorkbenchItem[] {
  const installed = view.bundles.filter(bundle => bundle.installed && (
    bundle.client?.inject?.includes('@actvero/dsh-capability-ui') || view.remembered.some(entry => entry.id === bundle.name)
  ))
  const cards: WorkbenchItem[] = installed.map((bundle) => {
    const live = view.entries.find(entry => entry.id === bundle.name)
    const remembered = live ?? view.remembered.find(entry => entry.id === bundle.name)
    const entry: ActveroWorkbench = remembered ?? {
      id: bundle.name,
      name: bundle.meta?.title ? resolveText(bundle.meta.title) : bundle.name,
      description: bundle.meta?.description ? resolveText(bundle.meta.description) : bundle.description ?? '',
      version: bundle.version ?? '',
      ...(bundle.meta?.icon ? { iconUrl: bundle.meta.icon } : {}),
    }
    const iconUrl = workbenchIconUrl(view, bundle.name)
    const restart = bundle.restartRequired || view.restart.includes(bundle.name)
      || (live && (!bundle.enabled || live.version !== bundle.version))
    return { ...entry, ...(iconUrl ? { iconUrl } : {}), version: bundle.version ?? entry.version, bundle,
      ...(live ? { runningVersion: live.version } : {}),
      state: restart ? 'restartState' : bundle.error ? 'failedState' : !bundle.enabled ? 'disabledState' : live ? 'ready' : 'unloadedState',
    }
  })
  return [...cards, ...view.entries.filter(entry => !installed.some(bundle => bundle.name === entry.id))
    .map(entry => ({ ...entry, state: 'ready' as const, runningVersion: entry.version }))]
}
