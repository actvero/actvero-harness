import type { AccountSnapshot } from '@actvero/dsh-client-account/protocol'
import { AccountError, object, text, trustedUrl } from './policy.ts'
/** Fixed desktop endpoints; never accepts renderer-supplied endpoint paths. */
export class AccountApi {
  constructor(
    readonly baseUrl: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  async json(path: string, body?: unknown, access?: string): Promise<unknown> {
    return this.request(`${this.baseUrl}/api/v1${path}`, body, access)
  }
  async discovery(url: string): Promise<unknown> {
    return this.request(url)
  }
  /** Read public platform branding without cookies or device credentials. */
  async branding(): Promise<AccountSnapshot['brand']> {
    const value = object(await this.json('/auth/session'))
    const name = text(value.platform_name)
    if (name.length > 80) throw new AccountError('invalid_response')
    const brand: AccountSnapshot['brand'] = { name }
    if (typeof value.platform_logo_url === 'string') {
      const url = trustedUrl(value.platform_logo_url)
      // Public uploads are served by the selected platform; no external fetch receives credentials.
      if (url.origin === this.baseUrl) brand.logoUrl = await this.image(url.href)
    }
    return brand
  }
  private async image(url: string): Promise<string> {
    const response = await this.fetcher(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15_000) })
    const mime = response.headers.get('content-type')?.split(';')[0]
    if (!response.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(mime ?? '') || !response.body)
      throw new AccountError('invalid_response')
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.length
        if (size > 2 * 1024 * 1024) throw new AccountError('invalid_response')
        chunks.push(chunk.value)
      }
    } finally {
      await reader.cancel()
    }
    const bytes = Buffer.concat(chunks)
    const valid =
      mime === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === 'image/jpeg'
          ? bytes[0] === 255 && bytes[1] === 216
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    if (!valid) throw new AccountError('invalid_response')
    return `data:${mime};base64,${bytes.toString('base64')}`
  }
  private async request(url: string, body?: unknown, access?: string): Promise<unknown> {
    trustedUrl(url)
    let response: Response
    try {
      response = await this.fetcher(url, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(access ? { Authorization: `Bearer ${access}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new AccountError('network_unavailable', 0, 15_000)
    }
    if (!response.ok) {
      let code = `http_${response.status}`
      try {
        const error = object(object(await response.json()).error)
        if (typeof error.code === 'string' && /^[a-z_0-9]{1,70}$/.test(error.code)) code = error.code
      } catch {
        /* Do not expose upstream bodies or credentials. */
      }
      const retry = response.headers.get('Retry-After')
      const retryMs =
        retry === null ? 0 : /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())
      throw new AccountError(code, response.status, Number.isFinite(retryMs) ? retryMs : 0)
    }
    if (response.status === 204) return null
    try {
      return await response.json()
    } catch {
      throw new AccountError('invalid_response')
    }
  }
}
