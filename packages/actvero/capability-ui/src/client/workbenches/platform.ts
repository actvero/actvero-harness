/** Classify published releases against the profile's installed file dependencies. */
import semver from 'semver'
import type { BundleInfo } from '@deepseek-ai/dsh-api-remotes/client'
import { workbenchArchiveSource, type PublishedWorkbench, type WorkbenchArchiveSource } from '@actvero/dsh-client-account/protocol'
import type { WorkbenchItem } from './catalog.ts'

/** The fields shared by installed and published workbench details. */
export type WorkbenchDetails = Pick<WorkbenchItem, 'name' | 'description' | 'version' | 'iconUrl' | 'previewUrls' | 'author' | 'tags'>
  & Partial<Pick<WorkbenchItem, 'state' | 'runningVersion'>>

function isPublishedRelease(
  release: PublishedWorkbench,
  scope: string,
  bundle: BundleInfo | undefined,
  source: WorkbenchArchiveSource | undefined,
): boolean {
  return bundle?.installed === true && source?.scope === scope && source.workbenchId === release.workbenchId
    && source.versionId === release.versionId && source.sha256 === release.sha256 && bundle.version === release.version
}

/** Present the authorized release, using registered metadata only for the exact loaded version.
 * @param release Current published release.
 * @param scope Organization associated with the catalog.
 * @param installed The profile item for the same package name.
 * @returns Artwork and details for the published card and dialog.
 */
export function publishedWorkbenchDetails(
  release: PublishedWorkbench,
  scope: string,
  installed: WorkbenchItem | undefined,
): WorkbenchDetails {
  const bundle = installed?.bundle
  const sameRelease = isPublishedRelease(release, scope, bundle, workbenchArchiveSource(bundle?.source))
  const live = sameRelease && installed?.runningVersion === release.version ? installed : undefined
  return {
    name: release.name,
    description: release.description,
    version: release.version,
    iconUrl: release.iconUrl ?? live?.iconUrl,
    previewUrls: release.previewUrls?.length ? release.previewUrls : live?.previewUrls,
    author: live?.author,
    tags: live?.tags,
    state: sameRelease ? installed?.state : undefined,
  }
}

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
  if (isPublishedRelease(release, scope, bundle, source)) return 'open'
  if (bundle.version && semver.valid(bundle.version) && semver.valid(release.version) && semver.gt(release.version, bundle.version))
    return 'updateAndOpen'
  return 'platformConflict'
}
