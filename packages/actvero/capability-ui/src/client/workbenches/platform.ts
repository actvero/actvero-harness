/** Classify published releases against the profile's installed file dependencies. */
import semver from 'semver'
import type { BundleInfo } from '@deepseek-ai/dsh-api-remotes/client'
import { workbenchArchiveSource, type PublishedWorkbench } from '@actvero/dsh-client-account/protocol'

/** Platform card action, derived from release identity and installer state. */
export type PublishedWorkbenchAction = 'usePublished' | 'open' | 'updateAndOpen' | 'restartState' | 'platformConflict'

/** Determine the available action for a published release.
 * @param release Current published release.
 * @param scope Organization associated with the catalog.
 * @param bundle Profile dependency with the same package name, if any.
 * @returns The action permitted by the installed release's identity and version.
 */
export function publishedWorkbenchAction(
  release: PublishedWorkbench,
  scope: string,
  bundle: BundleInfo | undefined,
): PublishedWorkbenchAction {
  if (!bundle?.installed) return 'usePublished'
  const source = workbenchArchiveSource(bundle.source)
  if (source?.scope !== scope || source.workbenchId !== release.workbenchId) return 'platformConflict'
  if (bundle.restartRequired) return 'restartState'
  if (source.versionId === release.versionId && source.sha256 === release.sha256 && bundle.version === release.version) return 'open'
  if (bundle.version && semver.valid(bundle.version) && semver.valid(release.version) && semver.gt(release.version, bundle.version))
    return 'updateAndOpen'
  return 'platformConflict'
}
