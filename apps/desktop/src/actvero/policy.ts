/** Trust and decoding boundaries for the ACTVERO device account. */
import type { DesktopTokens } from './platform.generated.ts'
export class AccountError extends Error {
  constructor(readonly code: string, readonly status = 0, readonly retryMs = 0) { super(code) }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccountError('invalid_response')
  return value as Record<string, unknown>
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 16_384) throw new AccountError('invalid_response')
  return value
}
export function date(value: unknown): string {
  const result = text(value)
  if (!Number.isFinite(Date.parse(result))) throw new AccountError('invalid_response')
  return result
}
export function trustedUrl(raw: string): URL {
  let url: URL
  try { url = new URL(raw) } catch { throw new AccountError('invalid_service') }
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new AccountError('invalid_service')
  return url
}
export function platformUrl(raw: string): string {
  const url = trustedUrl(raw.trim())
  if (url.pathname !== '/' || url.search) throw new AccountError('invalid_service')
  return url.origin
}
export interface Service { baseUrl: string; issuer: string; clientId: string }
export function serviceFromMetadata(value: unknown, baseUrl: string): Service {
  const meta = object(value)
  const issuer = trustedUrl(text(meta.issuer))
  if (issuer.search || (new URL(baseUrl).protocol === 'https:' && issuer.protocol !== 'https:') ||
    meta.contract_version !== 1 || meta.client_id !== 'actvero-desktop' || meta.api_base !== `${baseUrl}/api/v1` ||
    meta.discovery_url !== `${issuer.href.replace(/\/$/, '')}/.well-known/openid-configuration` ||
    meta.callback_template !== 'http://127.0.0.1:{port}/actvero/callback' ||
    !Array.isArray(meta.refresh_recovery_versions) || !meta.refresh_recovery_versions.includes(2)) throw new AccountError('unsupported_contract')
  return { baseUrl, issuer: issuer.href.replace(/\/$/, ''), clientId: 'actvero-desktop' }
}
export interface Tokens extends Omit<Required<DesktopTokens>, 'token_type' | 'scope' | 'recovery_until'> {}
export function tokens(value: unknown, requestId?: string): Tokens {
  const v = object(value)
  if (v.token_type !== 'Bearer' || v.scope !== 'desktop:self' || !Number.isInteger(v.expires_in) ||
    typeof v.expires_in !== 'number' || v.expires_in < 0 ||
    (v.session_policy !== 'persistent' && v.session_policy !== 'strict') ||
    typeof v.acknowledgement_required !== 'boolean' ||
    (requestId !== undefined && (v.refresh_request_id !== requestId || !v.acknowledgement_required))) throw new AccountError('invalid_response')
  return { access_token: text(v.access_token), refresh_token: text(v.refresh_token), device_session_id: text(v.device_session_id),
    expires_in: v.expires_in, session_expires_at: date(v.session_expires_at), idle_expires_at: date(v.idle_expires_at),
    server_time: date(v.server_time), session_policy: v.session_policy, acknowledgement_required: v.acknowledgement_required,
    refresh_request_id: v.refresh_request_id === null ? null : text(v.refresh_request_id),
    reauthenticate_at: v.reauthenticate_at === null ? null : date(v.reauthenticate_at) }
}
export function verifyAuthorization(value: unknown, endpoint: string, service: Service, redirect: string, challenge: string) {
  const v = object(value), url = trustedUrl(text(v.authorization_url)), expected = trustedUrl(endpoint), issuer = new URL(service.issuer)
  if (expected.origin !== issuer.origin || !expected.pathname.startsWith(issuer.pathname + '/') || expected.search ||
    v.issuer !== service.issuer || url.origin !== expected.origin || url.pathname !== expected.pathname) throw new AccountError('untrusted_authorization')
  for (const [key, value] of Object.entries({ client_id: service.clientId, redirect_uri: redirect, state: text(v.state), code_challenge: challenge, code_challenge_method: 'S256', response_type: 'code' })) {
    if (url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value) throw new AccountError('untrusted_authorization')
  }
  if (text(v.state).length < 43 || Date.parse(date(v.expires_at)) <= Date.now()) throw new AccountError('invalid_login')
  return { attemptId: text(v.attempt_id), state: text(v.state), url: url.href, expiresAt: date(v.expires_at) }
}
export function safeAccountUrl(raw: string, baseUrl: string): string {
  const url = trustedUrl(raw)
  if (url.origin !== baseUrl) throw new AccountError('untrusted_account_url')
  return url.href
}
