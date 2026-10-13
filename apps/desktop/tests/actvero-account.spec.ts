import { describe, expect, it, vi, onTestFinished } from 'vitest'
import type { AccountSnapshot } from '@actvero/dsh-client-account/protocol'
import { AccountController } from '../src/actvero/controller.ts'
import { AccountApi } from '../src/actvero/api.ts'
import { listenCallback, type BrowserLoginState, type Loopback } from '../src/actvero/callback.ts'
import { AccountError } from '../src/actvero/policy.ts'
import { decodeVault, type Vault, type VaultData } from '../src/actvero/state.ts'

const baseUrl = 'http://127.0.0.1:5194'
const service = { baseUrl, issuer: 'http://127.0.0.1:5196/realms/actvero', clientId: 'actvero-desktop' }
function token(refresh = 'successor', expires = 300) {
  return { access_token: `access-${refresh}`, refresh_token: refresh, device_session_id: 'device', expires_in: expires,
    token_type: 'Bearer', scope: 'desktop:self', server_time: new Date().toISOString(), session_policy: 'persistent' as const,
    session_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    idle_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    reauthenticate_at: null, refresh_request_id: null as string | null, acknowledgement_required: false }
}
const org = { tenant_id: 'tenant-a', membership_id: 'member-a', name: 'Alpha', status: 'active', needs_login: false }
const me = { user: { id: 'user', name: 'Test', email: 'test@example.com' }, organization: org, organizations: [org], organization_state: 'ready', account_url: `${baseUrl}/account` }
class MemoryVault implements Vault {
  saved: VaultData = { version: 1, baseUrl, cleanup: [], session: { service, tokens: token('original'), expiresAt: 0 } }
  writes: VaultData[] = []
  failNext = false
  async ready() {}
  async load() { return structuredClone(this.saved) }
  async save(value: VaultData) {
    if (this.failNext) { this.failNext = false; throw new AccountError('storage_unavailable') }
    this.saved = structuredClone(value); this.writes.push(structuredClone(value))
  }
}
class Server extends AccountApi {
  calls: { path: string; body: unknown; access: string | undefined }[] = []
  reply: (path: string, body: unknown) => Promise<unknown> = async path => path === '/desktop/me' ? me : null
  constructor() { super(baseUrl) }
  override async json(path: string, body?: unknown, access?: string) {
    if (path === '/auth/session') return { platform_name: 'ACTVERO', platform_logo_url: null }
    this.calls.push({ path, body, access }); return this.reply(path, body)
  }
}
function setup(vault = new MemoryVault(), api = new Server()) {
  const controller = new AccountController({ vault, api: () => api, baseUrl, appVersion: 'test', changed: () => {}, openExternal: async () => {} })
  return { vault, api, controller }
}
function rotated(body: unknown, refresh = 'successor', expires = 300) {
  if (!body || typeof body !== 'object' || !('request_id' in body) || typeof body.request_id !== 'string') throw new Error('missing recovery request')
  return { ...token(refresh, expires), acknowledgement_required: true, refresh_request_id: body.request_id }
}
describe('persistent desktop recovery', () => {
  it('persists the predecessor before sending and the successor before acknowledging', async () => {
    const { controller, api, vault } = setup()
    api.reply = async (path, body) => {
      if (path === '/desktop/refresh') { expect(vault.saved.session?.pending).toBeDefined(); return rotated(body) }
      if (path === '/desktop/refresh/acknowledge') { expect(vault.saved.session?.tokens.refresh_token).toBe('successor'); expect(vault.saved.session?.pending).toBeUndefined() }
      return path === '/desktop/me' ? me : null
    }
    await controller.restore()
    expect(controller.snapshot().phase).toBe('ready')
    expect(vault.saved.session?.acknowledge).toBeUndefined()
    expect(api.calls.map(c => c.path)).toEqual(['/desktop/refresh', '/desktop/refresh/acknowledge', '/desktop/me'])
    expect(JSON.stringify(controller.snapshot())).not.toMatch(/original|successor|access-|refresh_token/)
  })
  it('recovers a lost response after restart with the same UUID and old token', async () => {
    const { controller, api, vault } = setup()
    api.reply = async () => { throw new AccountError('network_unavailable') }
    await controller.restore()
    const pending = vault.saved.session?.pending
    expect(controller.snapshot().phase).toBe('offline')
    controller.dispose()
    const next = setup(vault, new Server())
    next.api.reply = async (path, body) => path === '/desktop/refresh' ? rotated(body) : path === '/desktop/me' ? me : null
    await next.controller.restore()
    expect(next.api.calls[0]?.body).toEqual({ refresh_token: pending?.refreshToken, request_id: pending?.requestId, recovery_version: 2 })
    expect(next.controller.snapshot().phase).toBe('ready')
  })
  it('does not acknowledge when persisting the successor fails', async () => {
    const { controller, api, vault } = setup()
    api.reply = async (path, body) => { if (path === '/desktop/refresh') { vault.failNext = true; return rotated(body) } return null }
    await controller.restore()
    expect(vault.saved.session?.tokens.refresh_token).toBe('original')
    expect(vault.saved.session?.pending).toBeDefined()
    expect(api.calls.some(c => c.path.includes('acknowledge'))).toBe(false)
  })
  it('resumes acknowledgement after a crash without replaying the predecessor', async () => {
    const { controller, api, vault } = setup()
    api.reply = async (path, body) => { if (path === '/desktop/refresh') return rotated(body); throw new AccountError('network_unavailable') }
    await controller.restore(); controller.dispose()
    const next = setup(vault)
    await next.controller.restore()
    expect(next.api.calls.map(c => c.path)).toEqual(['/desktop/refresh/acknowledge', '/desktop/me'])
  })
  it('durably stores a recovered expired access, then rotates using a new UUID', async () => {
    const { controller, api, vault } = setup()
    let rotations = 0
    api.reply = async (path, body) => path === '/desktop/refresh' ? rotated(body, ++rotations === 1 ? 'recovered' : 'fresh', rotations === 1 ? 0 : 300) : path === '/desktop/me' ? me : null
    await controller.restore()
    const rotationsSent = api.calls.filter(c => c.path === '/desktop/refresh')
    expect(rotationsSent).toHaveLength(2)
    expect(rotationsSent[0]?.body).not.toEqual(rotationsSent[1]?.body)
    expect(vault.writes.some(v => v.session?.tokens.refresh_token === 'recovered')).toBe(true)
    expect(api.calls.find(c => c.path === '/desktop/me')?.access).toBe('access-fresh')
  })
  it('single-flights concurrent refresh and preserves pending on a replay conflict', async () => {
    const { controller, api, vault } = setup()
    api.reply = async () => { throw new AccountError('refresh_replayed', 409) }
    await controller.restore()
    const pending = structuredClone(vault.saved.session?.pending)
    const a = controller.refresh(), b = controller.refresh()
    expect(a).toBe(b); await a
    expect(vault.saved.session?.pending).toEqual(pending)
    expect(vault.saved.session).toBeDefined()
  })
  it('prevents late rotation from restoring a logged-out account', async () => {
    const { controller, api, vault } = setup()
    let finish: ((value: unknown) => void) | undefined
    api.reply = (path, body) => path === '/desktop/refresh' ? new Promise((resolve) => { finish = () =>{  resolve(rotated(body)) } }) : Promise.resolve(null)
    const restoring = controller.restore()
    await new Promise(resolve => setTimeout(resolve, 0))
    const logout = controller.logout(async () => true)
    finish?.(null)
    await Promise.all([restoring, logout])
    expect(vault.saved.session).toBeUndefined()
    expect(controller.snapshot().phase).toBe('signed-out')
    expect(api.calls.some(c => c.path === '/desktop/refresh/acknowledge')).toBe(false)
    expect(api.calls.some(c => c.path === '/desktop/logout')).toBe(true)
  })
  it('keeps login for no membership and never arbitrarily picks a multi-org entry', async () => {
    const { controller, api } = setup()
    api.reply = async (path, body) => path === '/desktop/refresh' ? rotated(body) : path === '/desktop/me' ? { ...me, organization: null, organizations: [org, { ...org, tenant_id: 'tenant-b' }], organization_state: 'selection_required' } : null
    await controller.restore()
    expect(controller.snapshot().phase).toBe('select-organization')
    expect(api.calls.some(c => c.path === '/desktop/organization')).toBe(false)
    api.reply = async () => ({ ...me, organization: null, organizations: [], organization_state: 'no_available_organization' })
    await controller.refresh()
    expect(controller.snapshot().phase).toBe('no-organization')
    expect(controller.snapshot().user?.id).toBe('user')
  })
  it('does not send a rotation when the pending record cannot be saved', async () => {
    const { controller, api, vault } = setup()
    vault.failNext = true
    await controller.restore()
    expect(api.calls).toHaveLength(0)
    expect(vault.saved.session?.tokens.refresh_token).toBe('original')
    expect(controller.snapshot().error?.code).toBe('storage_unavailable')
  })
  it('keeps signed-out state and retries an offline remote revocation', async () => {
    const { controller, api, vault } = setup()
    api.reply = async (path, body) => path === '/desktop/refresh' ? rotated(body) : path === '/desktop/me' ? me : null
    await controller.restore()
    api.reply = async () => { throw new AccountError('network_unavailable') }
    await controller.logout(async () => true)
    expect(vault.saved.session).toBeUndefined()
    expect(vault.saved.cleanup).toHaveLength(1)
    expect(controller.snapshot().phase).toBe('logout-pending')
    expect(controller.snapshot().user).toBeUndefined()
    api.reply = async () => null
    await controller.refresh()
    expect(vault.saved.cleanup).toHaveLength(0)
    expect(controller.snapshot().phase).toBe('signed-out')
  })
  it('removes the previous organization and quota if verification after switching fails', async () => {
    const { controller, api } = setup()
    api.reply = async (path, body) => path === '/desktop/refresh' ? rotated(body) : path === '/desktop/me' ? { ...me, organizations: [org, { ...org, tenant_id: 'tenant-b' }] } : null
    await controller.restore()
    api.reply = async (path) => { if (path === '/desktop/me') throw new AccountError('network_unavailable'); return null }
    await controller.selectOrganization('tenant-b')
    expect(controller.snapshot().organization).toBeUndefined()
    expect(controller.snapshot().quota.windows).toHaveLength(0)
    expect(controller.snapshot().user?.id).toBe('user')
    expect(controller.snapshot().phase).toBe('offline')
  })
  it('clears a revoked session even when quota is the first endpoint to report it', async () => {
    const { controller, api, vault } = setup()
    api.reply = async (path, body) => path === '/desktop/refresh' ? rotated(body) : path === '/desktop/me' ? me : null
    await controller.restore()
    api.reply = async () => { throw new AccountError('device_revoked', 401) }
    await controller.quota()
    expect(vault.saved.session).toBeUndefined()
    expect(controller.snapshot().user).toBeUndefined()
    expect(controller.snapshot().error?.code).toBe('device_revoked')
  })
  it('clears authorization only for a verified fatal session error', async () => {
    const { controller, api, vault } = setup()
    api.reply = async () => { throw new AccountError('device_revoked', 401) }
    await controller.restore()
    expect(vault.saved.session).toBeUndefined()
    expect(controller.snapshot().error?.code).toBe('device_revoked')
  })
})


describe('explicit account switching', () => {
  it('persists account retirement before browser authentication and forces a fresh prompt', async () => {
    const vault = new MemoryVault(), api = new Server()
    vault.saved.session!.expiresAt = Date.now() + 300_000
    const open = vi.fn(async () => {})
    const loop = { redirect: 'http://127.0.0.1:12345/actvero/callback', arm: vi.fn(), close: vi.fn() }
    const endpoint = `${service.issuer}/protocol/openid-connect/auth`
    vi.spyOn(api, 'discovery').mockResolvedValue({ issuer: service.issuer, authorization_endpoint: endpoint })
    api.reply = async (path, body) => {
      if (path === '/desktop/me') return me
      if (path === '/desktop/metadata') return { contract_version: 1, issuer: service.issuer, client_id: service.clientId,
        api_base: `${baseUrl}/api/v1`, discovery_url: `${service.issuer}/.well-known/openid-configuration`,
        callback_template: 'http://127.0.0.1:{port}/actvero/callback', refresh_recovery_versions: [1, 2] }
      if (path === '/desktop/logout') {
        expect(vault.saved.session).toBeUndefined()
        expect(vault.saved.reauthenticate).toBe(true)
        throw new AccountError('network_unavailable')
      }
      if (path === '/desktop/login/start') {
        expect(body).toMatchObject({ reauthenticate: true })
        expect(vault.saved.session).toBeUndefined()
        const input = body as { redirect_uri: string; code_challenge: string }
        const url = new URL(endpoint)
        url.search = new URLSearchParams({ client_id: service.clientId, redirect_uri: input.redirect_uri,
          state: 's'.repeat(43), code_challenge: input.code_challenge, code_challenge_method: 'S256', response_type: 'code' }).toString()
        return { issuer: service.issuer, attempt_id: 'switch-attempt', state: 's'.repeat(43), authorization_url: url.href,
          expires_at: new Date(Date.now() + 60_000).toISOString() }
      }
      return null
    }
    const controller = new AccountController({ vault, api: () => api, baseUrl, appVersion: 'test', changed: () => {},
      openExternal: open, loopback: async () => loop })
    try {
      await controller.restore()
      expect(controller.snapshot().user?.id).toBe('user')
      await controller.switchAccount()
      expect(open).toHaveBeenCalledOnce()
      expect(vault.saved.cleanup).toHaveLength(1)
      expect(controller.snapshot().phase).toBe('waiting')
      await controller.cancel()
      expect(controller.snapshot().user).toBeUndefined()
      expect(vault.saved.session).toBeUndefined()
      expect(vault.saved.reauthenticate).toBe(true)
    } finally { controller.dispose() }
  })
  it('retains the current account and opens no browser if the switch cannot be saved', async () => {
    const { controller, api, vault } = setup()
    vault.saved.session!.expiresAt = Date.now() + 300_000
    await controller.restore()
    vault.failNext = true
    await controller.switchAccount()
    expect(vault.saved.session?.tokens.refresh_token).toBe('original')
    expect(controller.snapshot().user?.id).toBe('user')
    expect(controller.snapshot().error?.code).toBe('storage_unavailable')
    expect(api.calls.some(call => call.path === '/desktop/login/start' || call.path === '/desktop/logout')).toBe(false)
    controller.dispose()
  })
})

describe('sign-out confirmation', () => {
  it('keeps the account, credentials and remote session when cancelled', async () => {
    const { controller, api, vault } = setup()
    api.reply = async (path, body) => path === '/desktop/refresh' ? rotated(body) : path === '/desktop/me' ? me : null
    await controller.restore()
    const saved = structuredClone(vault.saved)
    const view = controller.snapshot()
    api.calls.length = 0; vault.writes.length = 0
    await controller.logout(async () => false)
    expect(vault.saved).toEqual(saved)
    expect(controller.snapshot()).toEqual(view)
    expect(vault.writes).toHaveLength(0)
    expect(api.calls).toHaveLength(0)
  })
  it('shares one prompt across repeat clicks and waits for confirmation before signing out', async () => {
    const { controller, api, vault } = setup()
    api.reply = async (path, body) => path === '/desktop/refresh' ? rotated(body) : path === '/desktop/me' ? me : null
    await controller.restore()
    api.calls.length = 0
    const answer = Promise.withResolvers<boolean>()
    const confirm = vi.fn(() => answer.promise)
    const first = controller.logout(confirm)
    expect(controller.logout(confirm)).toBe(first)
    expect(confirm).toHaveBeenCalledOnce()
    expect(vault.saved.session).toBeDefined()
    expect(api.calls).toHaveLength(0)
    answer.resolve(true)
    await first
    expect(vault.saved.session).toBeUndefined()
    expect(api.calls.filter(call => call.path === '/desktop/logout')).toHaveLength(1)
    expect(controller.snapshot().phase).toBe('signed-out')
  })
  it.each(['configure', 'dispose'] as const)('ignores approval after %s changes the original account context', async (action) => {
    const { controller, api, vault } = setup()
    api.reply = async (path, body) => path === '/desktop/refresh' ? rotated(body) : path === '/desktop/me' ? me : null
    await controller.restore()
    const answer = Promise.withResolvers<boolean>()
    const pending = controller.logout(() => answer.promise)
    if (action === 'configure') await controller.configure('https://other.example')
    else controller.dispose()
    const saved = structuredClone(vault.saved)
    api.calls.length = 0; vault.writes.length = 0
    answer.resolve(true)
    await pending
    expect(vault.saved).toEqual(saved)
    expect(vault.writes).toHaveLength(0)
    expect(api.calls).toHaveLength(0)
  })
})

it.each([false, true])('restores the signed-out state after confirmed logout (remote unavailable=%s)', async (offline) => {
  const { controller, api, vault } = setup()
  vault.saved.session!.expiresAt = Date.now() + 300_000
  await controller.restore()
  api.reply = async () => { if (offline) throw new AccountError('network_unavailable'); return null }
  await controller.logout(async () => true)
  controller.dispose()
  const next = setup(vault, api)
  api.calls.length = 0
  await next.controller.restore()
  expect(next.controller.snapshot().user).toBeUndefined()
  expect(next.controller.snapshot().phase).toBe('signed-out')
  expect(vault.saved.session).toBeUndefined()
  expect(api.calls.some(call => call.path === '/desktop/me' || call.path === '/desktop/refresh')).toBe(false)
  next.controller.dispose()
})


async function browserLogin(account: unknown = me) {
  const vault = new MemoryVault(), api = new Server()
  vault.saved = { version: 1, baseUrl, cleanup: [] }
  const open = vi.fn(async (_url: string) => {}), changed = vi.fn<(snapshot: AccountSnapshot) => void>()
  let listener: Loopback | undefined
  const endpoint = `${service.issuer}/protocol/openid-connect/auth`
  vi.spyOn(api, 'discovery').mockResolvedValue({ issuer: service.issuer, authorization_endpoint: endpoint })
  api.reply = async (path, body) => {
    if (path === '/desktop/me') return account
    if (path === '/desktop/metadata') return { contract_version: 1, issuer: service.issuer, client_id: service.clientId,
      api_base: `${baseUrl}/api/v1`, discovery_url: `${service.issuer}/.well-known/openid-configuration`,
      callback_template: 'http://127.0.0.1:{port}/actvero/callback', refresh_recovery_versions: [1, 2] }
    if (path === '/desktop/login/start') {
      const input = body as { redirect_uri: string; code_challenge: string }
      const url = new URL(endpoint)
      url.search = new URLSearchParams({ client_id: service.clientId, redirect_uri: input.redirect_uri,
        state: 's'.repeat(43), code_challenge: input.code_challenge, code_challenge_method: 'S256', response_type: 'code' }).toString()
      return { issuer: service.issuer, attempt_id: 'browser-attempt', state: 's'.repeat(43), authorization_url: url.href,
        expires_at: new Date(Date.now() + 60_000).toISOString() }
    }
    return path === '/desktop/login/exchange' ? token('browser') : null
  }
  const controller = new AccountController({ vault, api: () => api, baseUrl, appVersion: 'test', changed,
    openExternal: open, loopback: async () => { listener = await listenCallback(); return listener } })
  await controller.restore()
  await controller.login()
  expect(listener).toBeDefined()
  const query = new URLSearchParams({ state: 's'.repeat(43), iss: service.issuer, code: 'synthetic-code' })
  const response = await fetch(`${listener!.redirect}?${query}`)
  const html = await response.text(), url = listener!.browserUrl!
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!
  const csrf = html.match(/csrf = "([A-Za-z0-9_-]{43})"/)![1]!
  await vi.waitFor(() => { expect(vault.saved.session?.browserPending).toBe(true) })
  await vi.waitFor(() => { expect(controller.snapshot().phase).toBe('waiting') })
  const state = async (): Promise<BrowserLoginState> => {
    const value: unknown = await (await fetch(url + '/state', { headers: { Cookie: cookie } })).json()
    return value as BrowserLoginState
  }
  await vi.waitFor(async () => { expect((await state()).phase).toBe('confirm-account') })
  const decide = (action: string, overrides?: Record<string, string>, body = JSON.stringify({ csrf })) =>
    fetch(url + '/' + action, { method: 'POST', headers: { Origin: new URL(url).origin, Cookie: cookie,
      'Content-Type': 'application/json', ...overrides }, body })
  return { controller, vault, api, open, changed, html, url, cookie, state, decide }
}

describe('verified browser account choice', () => {
  it('holds workspace entry and credentials behind an explicit browser choice', async () => {
    const flow = await browserLogin()
    try {
      expect(flow.controller.snapshot().user).toBeUndefined()
      expect(flow.changed.mock.calls.some(([snapshot]) => snapshot.phase === 'ready')).toBe(false)
      expect(await flow.state()).toEqual({ phase: 'confirm-account', user: { name: 'Test', email: 'test@example.com' }, brand: 'ACTVERO' })
      expect(flow.html).not.toMatch(/synthetic-code|access-browser|refresh_token|code_verifier/)
      await expect(flow.controller.resourceToken('llm:catalog')).rejects.toThrow('browser_confirmation_required')
      expect(flow.api.calls.some(call => call.path === '/desktop/resource-tokens')).toBe(false)
      await flow.controller.quota()
      await expect(flow.controller.selectOrganization('tenant-a')).resolves.toBeUndefined()
      expect(flow.api.calls.some(call => call.path === '/desktop/organization' || call.path === '/desktop/llm/quota')).toBe(false)
      await flow.controller.reopen()
      expect(flow.open).toHaveBeenLastCalledWith(flow.url)
      expect((await flow.decide('continue')).status).toBe(200)
      expect(flow.controller.snapshot().phase).toBe('ready')
      expect(flow.vault.saved.session?.browserPending).toBeUndefined()
    } finally { flow.controller.dispose() }
  })
  it('rejects missing cookies, invalid origins, CSRF, form posts and oversized bodies', async () => {
    const flow = await browserLogin()
    try {
      for (const headers of [{ Cookie: '' }, { Origin: 'https://evil.test' }, { 'Content-Type': 'text/plain' }])
        expect((await flow.decide('continue', headers)).status).toBe(403)
      expect((await flow.decide('continue', {}, JSON.stringify({ csrf: 'wrong' }))).status).toBe(403)
      expect((await flow.decide('continue', {}, 'x'.repeat(129))).status).toBe(413)
      expect((await fetch(flow.url + '/state')).status).toBe(403)
      expect((await fetch(flow.url + '/continue', { headers: { Cookie: flow.cookie } })).status).toBe(403)
      expect(flow.vault.saved.session?.browserPending).toBe(true)
      expect(flow.changed.mock.calls.some(([snapshot]) => snapshot.phase === 'ready')).toBe(false)
    } finally { flow.controller.dispose() }
  })
  it('retires the provisional device and forces fresh authentication when switching', async () => {
    const flow = await browserLogin()
    try {
      const response: unknown = await (await flow.decide('switch')).json()
      expect(response).toEqual({ phase: 'switching' })
      await vi.waitFor(() => { expect(flow.open).toHaveBeenCalledTimes(2) })
      expect(flow.vault.saved.session).toBeUndefined()
      expect(flow.api.calls.some(call => call.path === '/desktop/logout')).toBe(true)
      expect(flow.api.calls.filter(call => call.path === '/desktop/login/start').at(-1)?.body).toMatchObject({ reauthenticate: true })
      expect(flow.controller.snapshot().phase).toBe('waiting')
    } finally { flow.controller.dispose() }
  })
  it('revokes cancellation and never restores an unconfirmed browser identity after restart', async () => {
    const flow = await browserLogin()
    try {
      flow.controller.dispose()
      const next = setup(flow.vault, flow.api)
      flow.api.calls.length = 0
      await next.controller.restore()
      expect(flow.vault.saved.session).toBeUndefined()
      expect(next.controller.snapshot().phase).toBe('signed-out')
      expect(flow.api.calls.some(call => call.path === '/desktop/logout')).toBe(true)
      expect(flow.api.calls.some(call => call.path === '/desktop/me' || call.path === '/desktop/refresh')).toBe(false)
      next.controller.dispose()
    } finally { flow.controller.dispose() }
    const cancelled = await browserLogin()
    try {
      await cancelled.controller.cancel()
      expect(cancelled.vault.saved.session).toBeUndefined()
      expect(cancelled.controller.snapshot().phase).toBe('signed-out')
      await expect(cancelled.decide('continue')).rejects.toThrow()
    } finally { cancelled.controller.dispose() }
  })
  it('keeps pending confirmation on storage failure and revalidates when reopening', async () => {
    const flow = await browserLogin()
    try {
      flow.vault.failNext = true
      const response: unknown = await (await flow.decide('continue')).json()
      expect(response).toEqual({ phase: 'failed' })
      expect(flow.vault.saved.session?.browserPending).toBe(true)
      expect(flow.changed.mock.calls.some(([snapshot]) => snapshot.phase === 'ready')).toBe(false)
      await flow.controller.reopen()
      expect((await flow.state()).phase).toBe('confirm-account')
      expect((await flow.decide('continue')).status).toBe(200)
      expect(flow.controller.snapshot().phase).toBe('ready')
    } finally { flow.controller.dispose() }
  })
  it('rejects a revoked account instead of accepting the previously displayed identity', async () => {
    const flow = await browserLogin()
    try {
      flow.api.reply = async () => { throw new AccountError('device_revoked', 401) }
      const response: unknown = await (await flow.decide('continue')).json()
      expect(response).toEqual({ phase: 'failed' })
      expect(flow.vault.saved.session).toBeUndefined()
      expect(flow.controller.snapshot().phase).toBe('error')
      expect(flow.changed.mock.calls.some(([snapshot]) => snapshot.phase === 'ready')).toBe(false)
    } finally { flow.controller.dispose() }
  })
  it('preserves browser confirmation across access-token rotation and encrypted decoding', async () => {
    const flow = await browserLogin()
    try {
      expect(decodeVault(flow.vault.saved).session?.browserPending).toBe(true)
      expect(() => decodeVault({ ...flow.vault.saved, session: { ...flow.vault.saved.session, browserPending: false } }))
        .toThrow('storage_invalid')
      const accepted = structuredClone(flow.vault.saved)
      delete accepted.session!.browserPending
      expect(decodeVault(accepted).session?.browserPending).toBeUndefined()
      let expired = true
      flow.api.reply = async (path, body) => {
        if (path === '/desktop/me') {
          if (expired) { expired = false; throw new AccountError('access_expired', 401) }
          return me
        }
        return path === '/desktop/refresh' ? rotated(body) : null
      }
      await flow.controller.refresh()
      expect(flow.vault.saved.session?.tokens.refresh_token).toBe('successor')
      expect(flow.vault.saved.session?.browserPending).toBe(true)
      expect(flow.controller.snapshot().user).toBeUndefined()
      expect((await flow.state()).phase).toBe('confirm-account')
    } finally { flow.controller.dispose() }
  })
  it('ignores a browser decision cancelled while saving the accepted session', async () => {
    const flow = await browserLogin()
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const save = flow.vault.save.bind(flow.vault)
    vi.spyOn(flow.vault, 'save').mockImplementation(async (value) => {
      if (value.session && !value.session.browserPending) { entered.resolve(undefined); await release.promise }
      await save(value)
    })
    try {
      const decision = flow.decide('continue').catch(() => undefined)
      await entered.promise
      const cancel = flow.controller.cancel()
      release.resolve(undefined)
      await Promise.all([decision, cancel])
      expect(flow.vault.saved.session).toBeUndefined()
      expect(flow.controller.snapshot().phase).toBe('signed-out')
      expect(flow.api.calls.some(call => call.path === '/desktop/logout')).toBe(true)
      expect(flow.changed.mock.calls.some(([snapshot]) => snapshot.phase === 'ready')).toBe(false)
    } finally { release.resolve(undefined); flow.controller.dispose() }
  })
  it('rejects duplicate decisions while revalidating and refuses an identity changed since display', async () => {
    const flow = await browserLogin()
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    flow.api.reply = async (path) => {
      if (path === '/desktop/me') { entered.resolve(undefined); await release.promise; return { ...me, user: { ...me.user, id: 'different' } } }
      return null
    }
    try {
      const first = flow.decide('continue')
      await entered.promise
      expect((await flow.decide('continue')).status).toBe(409)
      expect((await flow.decide('switch')).status).toBe(409)
      release.resolve(undefined)
      const response: unknown = await (await first).json()
      expect(response).toEqual({ phase: 'failed' })
      expect(flow.vault.saved.session?.browserPending).toBe(true)
      expect(flow.changed.mock.calls.some(([snapshot]) => snapshot.phase === 'ready')).toBe(false)
    } finally { release.resolve(undefined); flow.controller.dispose() }
  })
  it('confirms identity before the desktop asks for organization selection', async () => {
    const flow = await browserLogin({ ...me, organization: null, organization_state: 'selection_required' })
    try {
      expect(flow.controller.snapshot().phase).toBe('waiting')
      const response: unknown = await (await flow.decide('continue')).json()
      expect(response).toEqual({ phase: 'complete' })
      expect(flow.controller.snapshot().phase).toBe('select-organization')
      expect(flow.vault.saved.session?.browserPending).toBeUndefined()
    } finally { flow.controller.dispose() }
  })
})

it('keeps packaged name and artwork together after reading the platform brand', async () => {
  const vault = new MemoryVault()
  vault.saved = { version: 1, baseUrl: 'https://saved.example', cleanup: [] }
  const api = new Server()
  const branding = vi.spyOn(api, 'branding').mockResolvedValue({ name: 'Remote Platform' })
  const fallback = { name: 'Customer AI', logoUrl: 'data:image/png;base64,build-logo' }
  const controller = new AccountController({ vault, api: () => api, baseUrl: 'https://build-default.example', defaultBrand: fallback,
    appVersion: '1.2.3', changed: () => {}, openExternal: async () => {} })
  expect(controller.snapshot().brand).toEqual(fallback)
  await controller.restore()
  await vi.waitFor(() => { expect(branding).toHaveBeenCalledOnce() })
  expect(controller.snapshot().baseUrl).toBe('https://saved.example')
  expect(controller.snapshot().brand).toEqual(fallback)
  branding.mockRejectedValue(new Error('offline'))
  await controller.configure('https://changed.example')
  expect(controller.snapshot().brand).toEqual(fallback)
  controller.dispose()
})

describe('desktop resource authorization recovery', () => {
  const issued = { access_token: 'catalog-test', token_type: 'Bearer', resource: 'llm:catalog',
    endpoint: baseUrl + '/api/llm/v1', scope: 'llm:catalog', expires_in: 600 }
  async function ready() {
    const fixture = setup()
    onTestFinished(() => { fixture.controller.dispose() })
    fixture.api.reply = async (path, body) => path === '/desktop/refresh' ? rotated(body)
      : path === '/desktop/me' ? me : path === '/desktop/resource-tokens' ? issued : null
    await fixture.controller.restore()
    fixture.api.calls.length = 0
    return fixture
  }
  it('recovers a temporarily offline account before issuing a catalog token', async () => {
    const { controller, api, vault } = await ready()
    const reply = api.reply
    api.reply = async () => { throw new AccountError('network_unavailable') }
    await controller.refresh()
    expect(controller.snapshot().phase).toBe('offline')
    await expect(controller.resourceToken('llm:catalog')).rejects.toThrow('network_unavailable')
    expect(vault.saved.session).toBeDefined()
    api.reply = reply
    await expect(controller.resourceToken('llm:catalog')).resolves.toEqual(issued)
    expect(controller.snapshot().phase).toBe('ready')
  })
  it('renews an access rejected by the server once and shares it across catalog requests', async () => {
    const { controller, api } = await ready()
    const reply = api.reply
    let attempts = 0
    api.reply = async (path, body) => {
      if (path === '/desktop/resource-tokens' && ++attempts === 1) throw new AccountError('access_expired', 401)
      return reply(path, body)
    }
    await expect(Promise.all([controller.resourceToken('llm:catalog'), controller.resourceToken('llm:catalog')])).resolves.toEqual([issued, issued])
    expect(api.calls.filter(call => call.path === '/desktop/refresh')).toHaveLength(1)
    expect(api.calls.filter(call => call.path === '/desktop/resource-tokens')).toHaveLength(3)
  })
  it('does not loop when the renewed access is rejected too', async () => {
    const { controller, api, vault } = await ready()
    const reply = api.reply
    api.reply = async (path, body) => {
      if (path === '/desktop/resource-tokens') throw new AccountError('access_expired', 401)
      return reply(path, body)
    }
    await expect(controller.resourceToken('llm:catalog')).rejects.toThrow('access_expired')
    expect(api.calls.filter(call => call.path === '/desktop/refresh')).toHaveLength(1)
    expect(vault.saved.session).toBeDefined()
  })
  it('retains the login on a model permission refusal', async () => {
    const { controller, api, vault } = await ready()
    api.reply = async () => { throw new AccountError('resource_denied', 403) }
    await expect(controller.resourceToken('llm:catalog')).rejects.toThrow('resource_denied')
    expect(controller.snapshot().phase).toBe('ready')
    expect(vault.saved.session).toBeDefined()
  })
  it('enters reauthentication when resource issuance rejects the device identity', async () => {
    const { controller, api, vault } = await ready()
    api.reply = async () => { throw new AccountError('reauthentication_required', 401) }
    await expect(controller.resourceToken('llm:catalog')).rejects.toThrow('reauthentication_required')
    expect(controller.snapshot().user).toBeUndefined()
    expect(controller.snapshot().error?.code).toBe('reauthentication_required')
    expect(vault.saved.session).toBeUndefined()
    expect(vault.saved.reauthenticate).toBe(true)
  })
  it('discards a late access-expired response after switching platforms', async () => {
    const { controller, api, vault } = await ready()
    const reply = api.reply
    const entered = Promise.withResolvers<undefined>(), finish = Promise.withResolvers<unknown>()
    api.reply = async (path, body) => {
      if (path === '/desktop/resource-tokens') { entered.resolve(undefined); return finish.promise }
      return reply(path, body)
    }
    const result = expect(controller.resourceToken('llm:catalog')).rejects.toThrow('account_changed')
    await entered.promise
    const changed = controller.configure('https://other.example')
    finish.reject(new AccountError('access_expired', 401))
    await result
    await changed
    expect(api.calls.some(call => call.path === '/desktop/refresh')).toBe(false)
    expect(vault.saved.session).toBeUndefined()
    expect(vault.saved.baseUrl).toBe('https://other.example')
  })
})
