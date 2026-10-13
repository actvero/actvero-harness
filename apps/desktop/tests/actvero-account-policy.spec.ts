/** Authentication URLs, public branding and loopback requests are external input. */
import { describe, expect, it } from 'vitest'
import { AccountApi } from '../src/actvero/api.ts'
import { listenCallback } from '../src/actvero/callback.ts'
import { platformUrl, serviceFromMetadata, verifyAuthorization } from '../src/actvero/policy.ts'
const baseUrl = 'https://platform.example',
  issuer = 'https://platform.example/identity/realms/actvero'
const metadata = {
  contract_version: 1,
  issuer,
  client_id: 'actvero-desktop',
  api_base: `${baseUrl}/api/v1`,
  discovery_url: `${issuer}/.well-known/openid-configuration`,
  callback_template: 'http://127.0.0.1:{port}/actvero/callback',
  refresh_recovery_versions: [1, 2],
}
describe('native account external inputs', () => {
  it('accepts one configured service and refuses credentials or insecure remote URLs', () => {
    expect(platformUrl('https://platform.example/')).toBe(baseUrl)
    expect(serviceFromMetadata(metadata, baseUrl).issuer).toBe(issuer)
    for (const url of [
      'http://platform.example',
      'https://user:password@platform.example',
      'https://platform.example/?token=x',
    ])
      expect(() => platformUrl(url)).toThrow()
    expect(() => serviceFromMetadata({ ...metadata, api_base: 'https://other.example/api/v1' }, baseUrl)).toThrow()
    expect(() => serviceFromMetadata({ ...metadata, refresh_recovery_versions: [1] }, baseUrl)).toThrow()
  })
  it('requires the discovered authorization endpoint and exact PKCE/state/redirect values', () => {
    const redirect = 'http://127.0.0.1:12345/actvero/callback',
      state = 'a'.repeat(43),
      challenge = 'synthetic-challenge'
    const endpoint = `${issuer}/protocol/openid-connect/auth`,
      url = new URL(endpoint)
    url.search = new URLSearchParams({
      client_id: 'actvero-desktop',
      redirect_uri: redirect,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      response_type: 'code',
    }).toString()
    const attempt = {
      attempt_id: 'test',
      state,
      issuer,
      authorization_url: url.href,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    }
    expect(verifyAuthorization(attempt, endpoint, serviceFromMetadata(metadata, baseUrl), redirect, challenge).state).toBe(
      state,
    )
    url.searchParams.append('state', state)
    expect(() =>
      verifyAuthorization(
        { ...attempt, authorization_url: url.href },
        endpoint,
        serviceFromMetadata(metadata, baseUrl),
        redirect,
        challenge,
      ),
    ).toThrow()
    expect(() =>
      verifyAuthorization(
        attempt,
        'https://other.example/auth',
        serviceFromMetadata(metadata, baseUrl),
        redirect,
        challenge,
      ),
    ).toThrow()
  })
  it('returns inline platform images, with no device credentials, and does not fetch cross-origin images', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = []
    let logo = `${baseUrl}/api/v1/platform/logo?v=test`
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const fetcher: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      seen.push({ url, init })
      return url.endsWith('/auth/session')
        ? Response.json({ platform_name: 'Example', platform_logo_url: logo })
        : new Response(png, { headers: { 'content-type': 'image/png' } })
    }
    const api = new AccountApi(baseUrl, fetcher)
    expect(await api.branding()).toEqual({
      name: 'Example',
      logoUrl: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    })
    expect(
      seen.every(request => request.init?.credentials === 'omit' && !new Headers(request.init.headers).has('Authorization')),
    ).toBe(true)
    logo = 'https://external.example/logo.png'
    seen.length = 0
    expect(await api.branding()).toEqual({ name: 'Example' })
    expect(seen).toHaveLength(1)
  })
  it('rejects callback replays and duplicate fields without consuming a valid callback', async () => {
    const listener = await listenCallback(),
      accepted: unknown[] = []
    listener.arm('synthetic-state', issuer, (result) => {
      accepted.push(result)
    })
    try {
      const query = new URLSearchParams({ state: 'synthetic-state', iss: issuer, code: 'synthetic-code' })
      const duplicate = await fetch(`${listener.redirect}?${query}&state=synthetic-state`)
      expect(duplicate.status).toBe(400)
      expect(accepted).toHaveLength(0)
      const wrong = new URLSearchParams(query)
      wrong.set('iss', 'https://other.example')
      expect((await fetch(`${listener.redirect}?${wrong}`)).status).toBe(400)
      const response = await fetch(`${listener.redirect}?${query}`)
      expect(response.status).toBe(200)
      expect(accepted).toEqual([{ code: 'synthetic-code' }])
      const html = await response.text()
      expect(html).not.toContain('synthetic-code')
      expect(html).not.toContain('synthetic-state')
      expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
      await expect(fetch(`${listener.redirect}?${query}`)).rejects.toThrow()
    } finally {
      listener.close()
    }
  })
})
