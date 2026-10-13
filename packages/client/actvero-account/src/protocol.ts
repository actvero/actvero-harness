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
  brand: { name: string; logoUrl?: string; fallbackLogoUrl?: string }
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
/** Fixed Main-owned actions, with no arbitrary endpoint or credential access. */
export interface AccountBridge {
  snapshot(): Promise<AccountSnapshot | null>
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
