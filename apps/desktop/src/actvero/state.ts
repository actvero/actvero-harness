import type { Service, Tokens } from './policy.ts'
import { AccountError, object, platformUrl, text, tokens } from './policy.ts'
export interface LoginProof {
  attempt_id: string
  state: string
  code_verifier: string
}
export interface Session {
  service: Service
  tokens: Tokens
  expiresAt: number
  /** Verified browser identity is awaiting explicit consent to enter this desktop. */
  browserPending?: true
  pending?: { refreshToken: string; requestId: string }
  acknowledge?: { requestId: string }
}
export interface Cleanup {
  id: string
  service: Service
  refreshToken?: string
  proof?: LoginProof
}
export interface VaultData {
  version: 1
  baseUrl: string
  session?: Session
  login?: { service: Service; proof: LoginProof }
  cleanup: Cleanup[]
  reauthenticate?: boolean
}
export interface Vault {
  ready(): Promise<void>
  load(): Promise<VaultData | undefined>
  save(value: VaultData): Promise<void>
}
function service(value: unknown): Service {
  const v = object(value),
    baseUrl = platformUrl(text(v.baseUrl)),
    issuer = text(v.issuer)
  if (v.clientId !== 'actvero-desktop') throw new AccountError('storage_invalid')
  const url = new URL(issuer)
  if (
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
  )
    throw new AccountError('storage_invalid')
  return { baseUrl, issuer, clientId: v.clientId }
}
function proof(value: unknown): LoginProof {
  const p = object(value)
  return { attempt_id: text(p.attempt_id), state: text(p.state), code_verifier: text(p.code_verifier) }
}
/** Decode encrypted storage without trusting a JSON assertion. */
export function decodeVault(value: unknown): VaultData {
  const v = object(value)
  if (v.version !== 1 || !Array.isArray(v.cleanup)) throw new AccountError('storage_invalid')
  const data: VaultData = {
    version: 1,
    baseUrl: platformUrl(text(v.baseUrl)),
    cleanup: v.cleanup.map((raw) => {
      const c = object(raw)
      return {
        id: text(c.id),
        service: service(c.service),
        ...(c.refreshToken === undefined ? {} : { refreshToken: text(c.refreshToken) }),
        ...(c.proof === undefined ? {} : { proof: proof(c.proof) }),
      }
    }),
  }
  if (v.reauthenticate === true) data.reauthenticate = true
  if (v.session !== undefined) {
    const s = object(v.session)
    if (typeof s.expiresAt !== 'number' || !Number.isFinite(s.expiresAt)) throw new AccountError('storage_invalid')
    const t = object(s.tokens)
    data.session = {
      service: service(s.service),
      tokens: tokens({ ...t, token_type: 'Bearer', scope: 'desktop:self' }),
      expiresAt: s.expiresAt,
    }
    if (s.browserPending !== undefined && s.browserPending !== true) throw new AccountError('storage_invalid')
    if (s.browserPending === true) data.session.browserPending = true
    if (data.session.service.baseUrl !== data.baseUrl) throw new AccountError('storage_invalid')
    if (s.pending !== undefined) {
      const p = object(s.pending)
      data.session.pending = { refreshToken: text(p.refreshToken), requestId: text(p.requestId) }
    }
    if (s.acknowledge !== undefined) data.session.acknowledge = { requestId: text(object(s.acknowledge).requestId) }
  }
  if (v.login !== undefined) {
    const l = object(v.login)
    data.login = { service: service(l.service), proof: proof(l.proof) }
  }
  return data
}
