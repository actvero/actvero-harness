/** Validate platform release data and persist verified installer inputs. */
import { createHash } from 'node:crypto'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { join } from 'node:path'
import type { PublishedWorkbench, WorkbenchReleaseCheck } from '@actvero/dsh-client-account/protocol'
import type { DesktopWorkbenchPin } from './platform.generated.ts'
import { AccountError, object } from './policy.ts'

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/
const digest = /^[0-9a-f]{64}$/
const packagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const rasterData = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

function catalogImage(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length <= 23 + 4 * Math.ceil(maxBytes / 3) && rasterData.test(value)
}

function string(value: unknown, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length > max || (pattern && !pattern.test(value)))
    throw new AccountError('invalid_response')
  return value
}

/** Read an exact release pin from a desktop action.
 * @param value Preload action fields.
 * @returns A validated platform request body.
 */
export function releasePin(value: Record<string, unknown>): DesktopWorkbenchPin {
  return {
    workbench_id: string(value.workbenchId, 36, uuid),
    version_id: string(value.versionId, 36, uuid),
    sha256: string(value.sha256, 64, digest),
  }
}

/** Require the platform's compressed size limit before buffering a package.
 * @param value Published compressed byte count.
 * @returns The validated size.
 */
export function packageSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 8 * 1024 * 1024)
    throw new AccountError('invalid_response')
  return value
}

/** Read the authorized workbench catalog from the platform response.
 * @param value Catalog response JSON.
 * @returns Sanitized release metadata for the renderer.
 */
export function publishedWorkbenches(value: unknown): PublishedWorkbench[] {
  const { items } = object(value)
  if (!Array.isArray(items)) throw new AccountError('invalid_response')
  return items.map((item: unknown) => {
    const row = object(item)
    const icon = row.icon_data_url
    const previews = Array.isArray(row.preview_data_urls)
      ? row.preview_data_urls.slice(0, 3).filter((url: unknown) => catalogImage(url, 128 * 1024))
      : []
    return {
      workbenchId: string(row.workbench_id, 36, uuid),
      versionId: string(row.version_id, 36, uuid),
      sha256: string(row.sha256, 64, digest),
      packageName: string(row.package_name, 214, packagePattern),
      name: string(row.display_name, 100),
      description: string(row.description, 1024),
      ...(catalogImage(icon, 64 * 1024) ? { iconUrl: icon } : {}),
      ...(previews.length ? { previewUrls: previews } : {}),
      category: string(row.category, 20),
      version: string(row.version, 80),
      dshRequirement: string(row.dsh_requirement, 160),
      size: packageSize(row.size),
    }
  })
}

/** Read the current authority of an installed release from the platform response.
 * @param value Release check response JSON.
 * @returns Sanitized release status for the renderer.
 */
export function checkedWorkbench(value: unknown): WorkbenchReleaseCheck {
  const { status, adopted_usable: adoptedUsable } = object(value)
  if ((status !== 'current' && status !== 'update_available' && status !== 'unavailable')
    || typeof adoptedUsable !== 'boolean'
    || (status === 'current' && !adoptedUsable)
    || (status === 'unavailable' && adoptedUsable)) throw new AccountError('invalid_response')
  return { status, adoptedUsable }
}

/** Store the archive under the exact organization and release that authorized it.
 * @param root User data directory.
 * @param scope Hash of platform address and organization.
 * @param pin Authorized release.
 * @param bytes Downloaded archive.
 * @returns The persistent archive path referenced by the profile installer.
 */
export async function storeWorkbench(root: string, scope: string, pin: DesktopWorkbenchPin, bytes: Buffer): Promise<string> {
  if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw new AccountError('workbench_digest_mismatch')
  const filename = `actvero-wb-${scope}-${pin.workbench_id}-${pin.version_id}-${pin.sha256}.tgz`
  const path = join(root, 'actvero-workbench-packages', filename)
  await writeFileAtomic(path, bytes, { mode: 0o600, dirMode: 0o700 })
  return path
}
