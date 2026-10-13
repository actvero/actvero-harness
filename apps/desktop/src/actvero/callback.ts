import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { AccountError } from './policy.ts'
import { browserAccountPage, callbackPage } from './callback-page.ts'
export interface CallbackResult {
  code?: string
  error?: string
}
/** Verified display information only; no tokens, identifiers or OAuth proof. */
export interface BrowserLoginState {
  phase: 'checking' | 'confirm-account' | 'complete' | 'failed'
  user?: { name: string; email?: string }
  brand?: string
}
/** Fixed decisions for the one account attempt that owns this listener. */
export interface BrowserLoginInteraction {
  state(): BrowserLoginState
  continue(): Promise<void>
  switch(): Promise<void>
}
export interface Loopback {
  redirect: string
  readonly browserUrl?: string | undefined
  close(): void
  arm(state: string, issuer: string, accept: (result: CallbackResult) => void, interaction?: BrowserLoginInteraction): void
}
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}
function sendPage(res: ServerResponse, page: ReturnType<typeof callbackPage>, cookie?: string): void {
  res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': page.csp, ...(cookie ? { 'Set-Cookie': cookie } : {}) })
  res.end(page.html)
}
/**
 * Bind an IPv4 loopback callback and a one-attempt browser confirmation page.
 * @returns A Main-owned listener; decisions require its cookie, CSRF value and exact origin.
 */
export async function listenCallback(): Promise<Loopback> {
  let proof: { state: string; issuer: string; accept: (result: CallbackResult) => void; interaction?: BrowserLoginInteraction } | undefined
  let consumed = false, closed = false, acting = false
  let redirect = ''
  const path = `/actvero/account/${randomBytes(24).toString('hex')}`,
    csrf = randomBytes(32).toString('base64url'),
    cookieName = `actvero_${randomBytes(12).toString('hex')}`,
    cookieValue = randomBytes(32).toString('base64url')
  const stop = () => {
    if (closed) return
    closed = true
    // Finish an in-flight decision response; then close its socket and any idle sockets.
    server.close()
    const timeout = setTimeout(() => { server.closeAllConnections() }, 5000)
    timeout.unref()
  }
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const reject = (status = 400) => {
      res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('此登录请求无效，请返回桌面端。')
    }
    if (closed || req.headers.host !== new URL(redirect).host || !proof || (req.url?.length ?? 0) > 8192)
    { reject(); return }
    let url: URL
    try { url = new URL(req.url ?? '/', redirect) } catch { reject(); return }
    const origin = new URL(redirect).origin
    if (url.origin !== origin) { reject(); return }
    const interaction = proof.interaction
    if (interaction && consumed && url.pathname.startsWith(path)) {
      if (url.search) { reject(); return }
      if (req.headers.origin && req.headers.origin !== origin) { reject(403); return }
      if (req.method === 'GET' && url.pathname === path) {
        sendPage(res, browserAccountPage(path, csrf), `${cookieName}=${cookieValue}; HttpOnly; SameSite=Strict; Path=${path}`)
        return
      }
      if (!(req.headers.cookie ?? '').split(';').some(value => value.trim() === `${cookieName}=${cookieValue}`))
      { reject(403); return }
      const json = (value: BrowserLoginState | { phase: 'switching' }) => {
        res.writeHead(200, { ...headers, 'Content-Type': 'application/json' })
        res.end(JSON.stringify(value))
      }
      if (req.method === 'GET' && url.pathname === `${path}/state`) { json(interaction.state()); return }
      if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['content-type'] !== 'application/json' ||
        ![`${path}/continue`, `${path}/switch`].includes(url.pathname)) { reject(403); return }
      // A small exact body rejects streamed oversize requests and cross-origin form posts.
      let body = '', ownsDecision = false
      try {
        for await (const chunk of req) {
          body += String(chunk)
          if (body.length > 128) { reject(413); return }
        }
        const value: unknown = JSON.parse(body)
        if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 || !('csrf' in value) ||
          typeof value.csrf !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(value.csrf) || !timingSafeEqual(Buffer.from(value.csrf), Buffer.from(csrf)))
        { reject(403); return }
        if (acting || interaction.state().phase !== 'confirm-account') { reject(409); return }
        acting = true
        ownsDecision = true
        if (url.pathname === `${path}/switch`) {
          json({ phase: 'switching' })
          await interaction.switch()
        } else {
          await interaction.continue()
          json(interaction.state())
        }
      } catch {
        if (!res.headersSent) json({ phase: 'failed' })
      } finally { if (ownsDecision) acting = false }
      return
    }
    if (req.method !== 'GET' || consumed || url.pathname !== '/actvero/callback') { reject(); return }
    for (const name of ['state', 'iss', 'code', 'error']) if (url.searchParams.getAll(name).length > 1) { reject(); return }
    if (url.searchParams.get('state') !== proof.state || url.searchParams.get('iss') !== proof.issuer) { reject(); return }
    const code = url.searchParams.get('code'), error = url.searchParams.get('error')
    if ((!code && !error) || (code && error) || (code?.length ?? 0) > 4096) { reject(); return }
    consumed = true
    if (interaction && code) {
      res.writeHead(303, { ...headers, Location: path })
      res.end()
    } else {
      sendPage(res, callbackPage(!!error))
      stop()
    }
    proof.accept(code ? { code } : { error: 'login_cancelled' })
  }
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, headers)
      res.end()
    })
  })
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => { reject(new AccountError('callback_unavailable')) })
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string' || address.port < 1024) {
    stop()
    throw new AccountError('callback_unavailable')
  }
  redirect = `http://127.0.0.1:${address.port}/actvero/callback`
  return {
    redirect,
    get browserUrl() { return consumed && proof?.interaction && !closed ? `${new URL(redirect).origin}${path}` : undefined },
    arm: (state, issuer, accept, interaction) => { proof = { state, issuer, accept, ...(interaction ? { interaction } : {}) } },
    close: stop,
  }
}
