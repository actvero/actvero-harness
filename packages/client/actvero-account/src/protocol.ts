/** Public desktop account projections. Credentials never cross the preload bridge. */
export interface Organization {
  tenantId: string
  memberId: string
  name: string
  status: string
  needsLogin: boolean
}
/** Sanitized native state shared by the welcome, settings and sidebar. */
export interface AccountSnapshot {
  phase:
    | 'signed-out'
    | 'restoring'
    | 'waiting'
    | 'exchanging'
    | 'ready'
    | 'select-organization'
    | 'no-organization'
    | 'blocked'
    | 'offline'
    | 'error'
    | 'logout-pending'
  baseUrl: string
  brand: { name: string; logoUrl?: string; fallbackLogoUrl?: string; sidebarLogoUrl?: string }
  user?: { id: string; name: string; email?: string; avatarUrl?: string }
  organizations: Organization[]
  organization?: Organization
  error?: { code: string; retryable: boolean; requestId?: string }
  quota: { phase: 'idle' | 'loading' | 'ready' | 'unconfigured' | 'failed'; windows: QuotaWindow[]; stale?: boolean }
}
/** One independent platform quota window; points remain decimal strings. */
export interface QuotaWindow {
  name: string
  limit: string
  remaining: string
  used: string
  reserved: string
  resetsAt: string | null
}

/** Exact release identity used for download and installed-version checks. */
export interface WorkbenchReleasePin {
  workbenchId: string
  versionId: string
  sha256: string
}

/** Published release metadata visible to the current organization member. */
export interface PublishedWorkbench extends WorkbenchReleasePin {
  packageName: string
  name: string
  description: string
  /** Inline raster artwork supplied by the authorized release catalog. */
  iconUrl?: string
  previewUrls?: readonly string[]
  category: string
  version: string
  dshRequirement: string
  size: number
}

/** A verified source saved as a file dependency by the profile installer. */
export interface WorkbenchArchiveSource extends WorkbenchReleasePin {
  scope: string
}

/** Read the organization and exact release from a managed file dependency.
 * @param source The profile installer's normalized dependency spec.
 * @returns Release identity for a platform archive, or undefined for local imports.
 */
export function workbenchArchiveSource(source: string | undefined): WorkbenchArchiveSource | undefined {
  if (!source?.startsWith('file:')) return undefined
  const file = source.replaceAll('\\', '/').split('/').at(-1)
  if (!file) return undefined
  const pin = /^actvero-wb-([0-9a-f]{32})-([0-9a-f-]{36})-([0-9a-f-]{36})-([0-9a-f]{64})\.tgz$/.exec(file)
  if (!pin) return undefined
  const [, scope, workbenchId, versionId, sha256] = pin
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/
  if (!scope || !workbenchId || !uuid.test(workbenchId) || !versionId || !uuid.test(versionId) || !sha256) return undefined
  return { scope, workbenchId, versionId, sha256 }
}

/** The currently published catalog and its local organization scope. */
export interface PublishedWorkbenchCatalog {
  scope: string
  items: readonly PublishedWorkbench[]
}

/** Whether the exact installed release can open and whether a new release exists. */
export interface WorkbenchReleaseCheck {
  status: 'current' | 'update_available' | 'unavailable'
  adoptedUsable: boolean
}

/** Fixed Main-owned actions, with no arbitrary endpoint or credential access. */
export interface AccountBridge {
  snapshot(): Promise<AccountSnapshot | null>
  /** Read organization values for a registered package name and running version. */
  workbenchConfig?(input: { packageName: string; version: string; scope?: string }): Promise<Readonly<Record<string, string>>>
  /** List the current organization's published and authorized workbenches. */
  workbenchCatalog?(): Promise<PublishedWorkbenchCatalog>
  /** Check the adopted release against current organization authorization. */
  workbenchCheck?(input: WorkbenchArchiveSource): Promise<WorkbenchReleaseCheck>
  /** Store the verified archive and return the file dependency for the installer. */
  workbenchDownload?(input: WorkbenchReleasePin & { scope: string; size: number }): Promise<string>
  subscribe(listener: (snapshot: AccountSnapshot) => void): () => void
  login(): Promise<void>
  continueAccount(): Promise<void>
  switchAccount(): Promise<void>
  cancel(): Promise<void>
  reopen(): Promise<void>
  refresh(): Promise<void>
  quota(): Promise<void>
  logout(): Promise<void>
  configure(baseUrl: string): Promise<void>
  selectOrganization(tenantId: string): Promise<void>
  personalCenter(): Promise<void>
  local(): Promise<void>
  show(): Promise<void>
}
declare global {
  interface Window {
    actveroAccount?: AccountBridge
  }
}
