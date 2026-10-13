/** One serialized account authority for all desktop windows. Secrets stay here. */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type { AccountSnapshot, Organization, QuotaWindow } from '@actvero/dsh-client-account/protocol'
import { AccountApi } from './api.ts'
import { listenCallback, type BrowserLoginState, type CallbackResult, type Loopback } from './callback.ts'
import {
  AccountError,
  date,
  object,
  platformUrl,
  safeAccountUrl,
  serviceFromMetadata,
  text,
  tokens,
  verifyAuthorization,
  type Service,
  type Tokens,
} from './policy.ts'
import type { Cleanup, Session, Vault, VaultData } from './state.ts'

interface Options {
  vault: Vault
  baseUrl: string
  appVersion: string
  defaultBrand?: AccountSnapshot['brand']
  openExternal(url: string): Promise<void>
  changed(snapshot: AccountSnapshot): void
  api?: (baseUrl: string) => AccountApi
  loopback?: typeof listenCallback
}
const fatal = new Set([
  'device_revoked',
  'session_expired',
  'account_unavailable',
  'invalid_identity',
  'invalid_credential',
  'credential_type_mismatch',
  'reauthentication_required',
  'refresh_recovery_expired',
])
function temporary(error: AccountError): boolean {
  return (
    error.code === 'network_unavailable' ||
    error.code === 'identity_unavailable' ||
    error.status === 429 ||
    error.status >= 500
  )
}
function organization(value: unknown): Organization {
  const v = object(value)
  if (typeof v.needs_login !== 'boolean') throw new AccountError('invalid_response')
  return {
    tenantId: text(v.tenant_id),
    memberId: text(v.membership_id),
    name: text(v.name),
    status: text(v.status),
    needsLogin: v.needs_login,
  }
}
function decimal(value: unknown): string {
  const v = typeof value === 'number' ? String(value) : text(value)
  if (!/^\d+(\.\d+)?$/.test(v) || !Number.isFinite(Number(v))) throw new AccountError('invalid_response')
  return v
}
export class AccountController {
  private data: VaultData
  private view: AccountSnapshot
  private queue: Promise<void> = Promise.resolve()
  private refreshing: Promise<void> | undefined
  private logoutConfirmation: Promise<void> | undefined
  private generation = 0
  private retryAt = 0
  private failures = 0
  private forceAuthentication = false
  private browserAccount: AccountSnapshot | undefined
  private loop: Loopback | undefined
  private authorizationUrl: string | undefined
  private loginTimeout: ReturnType<typeof setTimeout> | undefined
  private ticker: ReturnType<typeof setInterval> | undefined
  private accountUrl: string | undefined
  private disposed = false
  private brand: AccountSnapshot['brand'] = { name: 'ACTVERO' }
  private brandGeneration = 0
  constructor(private options: Options) {
    this.brand = { ...(options.defaultBrand ?? { name: 'ACTVERO' }) }
    this.data = { version: 1, baseUrl: platformUrl(options.baseUrl), cleanup: [] }
    this.view = this.empty('signed-out')
  }
  snapshot(): AccountSnapshot {
    return structuredClone(this.view)
  }
  /** Main-only resource issuance shares the account's serialized refresh and organization lifetime. */
  async resourceToken(resource: string): Promise<{
    access_token: string
    token_type: string
    resource: string
    endpoint: string
    scope: string
    expires_in: number
  }> {
    if (!/^(?:(?:skills|experts):catalog|mcp:(?:catalog|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})|llm:(?:catalog|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))$/.test(resource)) throw new AccountError('invalid_resource')
    const generation=this.generation, organization=this.view.organization?.tenantId
    const task=this.queue.then(async()=>{
      const current=()=>!this.disposed && generation===this.generation && this.view.organization?.tenantId===organization
      if(!current()) throw new AccountError('account_changed')
      if(this.data.session?.browserPending) throw new AccountError('browser_confirmation_required')
      if(!this.data.session) throw new AccountError('reauthentication_required')
      if(!organization) throw new AccountError('organization_unavailable')
      let value:unknown
      try {
        if(this.view.phase==='offline') await this.readAccount(generation)
        if(!current()) throw new AccountError('account_changed')
        if(this.view.phase!=='ready' || this.view.organization?.status!=='active' || this.view.organization.needsLogin) throw new AccountError('organization_unavailable')
        const session=await this.ensureSession(generation)
        if(!session || !current()) throw new AccountError('account_changed')
        try {
          value=await this.api().json('/desktop/resource-tokens',{ resource },session.tokens.access_token)
        } catch(error) {
          if(!current()) throw new AccountError('account_changed')
          if(!(error instanceof AccountError) || error.code!=='access_expired') throw error
          await this.commit({ ...this.data,session:{ ...session,expiresAt:0 } })
          const renewed=await this.ensureSession(generation)
          if(!renewed || !current()) throw new AccountError('account_changed')
          value=await this.api().json('/desktop/resource-tokens',{ resource },renewed.tokens.access_token)
        }
      } catch(error) {
        // Only failures from the service/refresh path can retire a device session.
        if(!this.disposed && generation===this.generation && error instanceof AccountError && (fatal.has(error.code)||temporary(error))) {
          await this.report(error)
        }
        throw error
      }
      if(!current()) throw new AccountError('account_changed')
      const raw=object(value)
      const endpoints:Record<string,string>={ 'skills:catalog':'/api/v1/desktop/skills','experts:catalog':'/api/v1/desktop/experts','mcp:catalog':'/api/v1/desktop/mcp/connectors','llm:catalog':'/api/llm/v1' }
      const expected=endpoints[resource]??(resource.startsWith('llm:')?'/api/llm/v1':`/api/mcp/services/${resource.slice(4)}`)
      if(raw.resource!==resource || raw.token_type!=='Bearer' || raw.endpoint!==this.data.baseUrl+expected || typeof raw.expires_in!=='number' || !Number.isFinite(raw.expires_in) || raw.expires_in<=0 || raw.expires_in>600) throw new AccountError('invalid_response')
      return { access_token:text(raw.access_token),token_type:'Bearer',resource,endpoint:text(raw.endpoint),scope:text(raw.scope),expires_in:raw.expires_in }
    })
    this.queue=task.then(()=>{},()=>{})
    return task
  }
  private empty(phase: AccountSnapshot['phase']): AccountSnapshot {
    return {
      phase,
      baseUrl: this.data.baseUrl,
      brand: { ...this.brand },
      organizations: [],
      quota: { phase: 'idle', windows: [] },
    }
  }
  private publish(value: AccountSnapshot): void {
    this.view = value
    if (!this.disposed) this.options.changed(this.snapshot())
  }
  private api(baseUrl = this.data.baseUrl): AccountApi {
    return this.options.api?.(baseUrl) ?? new AccountApi(baseUrl)
  }
  private async commit(next: VaultData): Promise<void> {
    await this.options.vault.save(next)
    this.data = next
  }
  private serial(action: () => Promise<void>): Promise<void> {
    const generation = this.generation
    const task = this.queue
      .then(async () => {
        if (!this.disposed) await action()
      })
      .catch(async (error: unknown) => {
        if (!this.disposed && generation === this.generation) await this.report(error)
      })
    this.queue = task
    return task
  }
  private async report(value: unknown): Promise<void> {
    let error = value instanceof AccountError ? value : new AccountError('operation_failed')
    if (fatal.has(error.code) && this.data.session) {
      const { session: _session, login: _login, ...next } = this.data
      try {
        await this.commit({ ...next, reauthenticate: error.code === 'reauthentication_required' })
        this.forceAuthentication = error.code === 'reauthentication_required'
        this.accountUrl = undefined
        this.publish(this.empty('signed-out'))
      } catch {
        error = new AccountError('storage_unavailable')
      }
    }
    if (temporary(error)) {
      this.retryAt = Date.now() + Math.max(error.retryMs, Math.min(300_000, 15_000 * 2 ** Math.min(5, this.failures++)))
    }
    this.publish({
      ...this.view,
      phase:
        this.data.session?.browserPending
          ? 'waiting'
          : this.data.cleanup.length && !this.data.session
            ? 'logout-pending'
            : temporary(error) && this.data.session
              ? 'offline'
              : 'error',
      error: { code: error.code, retryable: temporary(error) || !fatal.has(error.code) },
    })
  }
  async restore(): Promise<void> {
    this.publish(this.empty('restoring'))
    await this.serial(async () => {
      const saved = await this.options.vault.load()
      if (saved) this.data = saved
      this.forceAuthentication = this.data.reauthenticate === true
      void this.refreshBrand()
      if (this.data.session?.browserPending) {
        // A crashed or closed browser confirmation never becomes a restored login.
        await this.commit({ version: 1, baseUrl: this.data.baseUrl, cleanup: this.retired() })
      }
      this.publish(this.empty(this.data.session ? 'restoring' : 'signed-out'))
      await this.cleanup()
      if (this.data.login) await this.cancelProof()
      if (this.data.session) await this.readAccount(this.generation)
    })
  }
  startPolling(): void {
    if (this.ticker) return
    this.ticker = setInterval(() => {
      if (Date.now() >= this.retryAt) void this.refresh()
    }, 30_000)
    this.ticker.unref()
  }
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    const generation = this.generation
    const task = this.serial(async () => {
      await this.cleanup()
      if (generation !== this.generation) return
      if (this.data.session) await this.readAccount(generation)
      else if (!this.data.cleanup.length && this.view.phase === 'logout-pending') this.publish(this.empty('signed-out'))
    })
    this.refreshing = task
    void task.finally(() => {
      if (this.refreshing === task) this.refreshing = undefined
    })
    return task
  }
  configure(raw: string): Promise<void> {
    let baseUrl: string
    try {
      baseUrl = platformUrl(raw)
    } catch (error) {
      return this.report(error)
    }
    if (baseUrl === this.data.baseUrl) return Promise.resolve()
    ++this.generation
    this.closeListener()
    return this.serial(async () => {
      const cleanup = this.retired()
      await this.commit({ version: 1, baseUrl, cleanup })
      this.accountUrl = undefined
      this.brandGeneration++
      this.brand = { ...(this.options.defaultBrand ?? { name: 'ACTVERO' }) }
      void this.refreshBrand()
      this.retryAt = 0
      this.failures = 0
      this.forceAuthentication = false
      this.publish(this.empty('signed-out'))
      // Retired credentials are only sent back to their original service.
      await this.cleanup()
    })
  }
  private retired(): Cleanup[] {
    const entries = [...this.data.cleanup]
    if (this.data.session)
      entries.push({
        id: randomUUID(),
        service: this.data.session.service,
        refreshToken: this.data.session.tokens.refresh_token,
      })
    if (this.data.login) entries.push({ id: randomUUID(), service: this.data.login.service, proof: this.data.login.proof })
    return entries
  }
  /** Explicit account switching retires this device and forces browser authentication. */
  async switchAccount(): Promise<void> {
    const generation = ++this.generation
    this.closeListener()
    const result = { prepared: false }
    await this.serial(async () => {
      if (generation !== this.generation) return
      await this.options.vault.ready()
      // Persist the switch before discarding the current account or opening a browser.
      await this.commit({ version: 1, baseUrl: this.data.baseUrl, cleanup: this.retired(), reauthenticate: true })
      this.forceAuthentication = true
      this.accountUrl = undefined
      this.publish(this.empty('signed-out'))
      result.prepared = true
      await this.cleanup()
    })
    if (result.prepared && generation === this.generation) await this.login()
  }
  login(): Promise<void> {
    const generation = ++this.generation
    this.closeListener()
    this.publish({ ...this.view, phase: 'waiting' })
    return this.serial(async () => {
      await this.options.vault.ready()
      if (this.data.session) throw new AccountError('already_signed_in')
      await this.cancelProof()
      const service = serviceFromMetadata(await this.api().json('/desktop/metadata'), this.data.baseUrl)
      const discovery = object(await this.api().discovery(`${service.issuer}/.well-known/openid-configuration`))
      if (discovery.issuer !== service.issuer) throw new AccountError('unsupported_contract')
      if (generation !== this.generation) return
      const loop = await (this.options.loopback ?? listenCallback)()
      this.loop = loop
      const verifier = randomBytes(32).toString('base64url'),
        challenge = createHash('sha256').update(verifier).digest('base64url')
      try {
        const raw = await this.api().json('/desktop/login/start', {
          contract_version: 1,
          redirect_uri: loop.redirect,
          code_challenge: challenge,
          device_name: hostname().slice(0, 100),
          os: process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux',
          app_version: this.options.appVersion,
          reauthenticate: this.forceAuthentication,
        })
        // Save the cancellation proof even when subsequent URL verification fails.
        const v = object(raw)
        await this.commit({
          ...this.data,
          login: { service, proof: { attempt_id: text(v.attempt_id), state: text(v.state), code_verifier: verifier } },
        })
        const attempt = verifyAuthorization(raw, text(discovery.authorization_endpoint), service, loop.redirect, challenge)
        if (generation !== this.generation) {
          await this.cancelProof()
          return
        }
        this.authorizationUrl = attempt.url
        loop.arm(attempt.state, service.issuer, (result) => {
          void this.serial(() => this.exchange(result, generation, service))
        }, {
          state: () => this.browserState(generation),
          continue: () => this.confirmBrowser(generation),
          switch: () => generation === this.generation ? this.switchAccount() : Promise.resolve(),
        })
        this.loginTimeout = setTimeout(
          () => {
            void this.cancel('login_expired')
          },
          Math.max(1, Math.min(600_000, Date.parse(attempt.expiresAt) - Date.now())),
        )
        this.publish(this.empty('waiting'))
        await this.options.openExternal(attempt.url)
      } catch (error) {
        this.closeListener()
        throw error
      }
    })
  }
  reopen(): Promise<void> {
    return this.serial(async () => {
      if (this.data.session?.browserPending) await this.readAccount(this.generation)
      const url = this.loop?.browserUrl ?? this.authorizationUrl
      if (!url) throw new AccountError('login_expired')
      await this.options.openExternal(url)
    })
  }
  cancel(code?: string): Promise<void> {
    // Capture before a concurrently accepted decision removes the pending marker.
    const cancelDevice = this.data.session?.browserPending === true
    ++this.generation
    this.closeListener()
    return this.serial(async () => {
      if (cancelDevice || this.data.session?.browserPending) {
        await this.commit({ version: 1, baseUrl: this.data.baseUrl, cleanup: this.retired() })
        this.accountUrl = undefined
        await this.cleanup()
      } else await this.cancelProof()
      this.publish({ ...this.empty('signed-out'), ...(code ? { error: { code, retryable: true } } : {}) })
    })
  }
  private closeListener(): void {
    this.loop?.close()
    this.loop = undefined
    this.browserAccount = undefined
    this.authorizationUrl = undefined
    clearTimeout(this.loginTimeout)
    this.loginTimeout = undefined
  }
  private async cancelProof(): Promise<void> {
    if (!this.data.login) return
    await this.api(this.data.login.service.baseUrl).json('/desktop/login/cancel', this.data.login.proof)
    const { login: _removed, ...next } = this.data
    await this.commit(next)
  }
  private async exchange(result: CallbackResult, generation: number, service: Service): Promise<void> {
    if (generation !== this.generation || !this.data.login) return
    if (!result.code) {
      this.closeListener()
      await this.cancelProof()
      throw new AccountError('login_cancelled')
    }
    this.publish(this.empty('exchanging'))
    const began = Date.now()
    const received = tokens(
      await this.api().json('/desktop/login/exchange', {
        ...this.data.login.proof,
        issuer: service.issuer,
        code: result.code,
      }),
    )
    if (generation !== this.generation) {
      await this.cancelProof()
      return
    }
    const { login: _removed, reauthenticate: _reauthenticate, ...next } = this.data
    await this.commit({ ...next, session: { ...this.savedSession(service, received, began), browserPending: true } })
    this.forceAuthentication = false
    await this.readAccount(generation)
  }
  private browserState(generation: number): BrowserLoginState {
    if (this.disposed || generation !== this.generation) return { phase: 'failed' }
    if (this.data.session?.browserPending && this.browserAccount?.user && !this.view.error) {
      const { name, email } = this.browserAccount.user
      return { phase: 'confirm-account', user: { name, ...(email ? { email } : {}) }, brand: this.brand.name }
    }
    if (this.data.session && !this.data.session.browserPending && this.view.user && !this.view.error)
      return { phase: 'complete' }
    return { phase: this.view.error ? 'failed' : 'checking' }
  }
  private confirmBrowser(generation: number): Promise<void> {
    return this.serial(async () => {
      if (generation !== this.generation || !this.data.session?.browserPending || !this.browserAccount?.user)
        throw new AccountError('login_expired')
      // Revalidate the device before accepting the displayed identity.
      const displayedId = this.browserAccount.user.id
      await this.readAccount(generation)
      if (generation !== this.generation) return
      if (this.browserAccount.user.id !== displayedId) throw new AccountError('invalid_response')
      const { browserPending: _pending, ...session } = this.data.session
      await this.commit({ ...this.data, session })
      if (generation !== this.generation) return
      clearTimeout(this.loginTimeout)
      this.loginTimeout = undefined
      await this.readAccount(generation)
      if (generation === this.generation) this.closeListener()
    })
  }
  private savedSession(service: Service, received: Tokens, began: number): Session {
    const deviceTtl =
      Math.min(Date.parse(received.session_expires_at), Date.parse(received.idle_expires_at)) -
      Date.parse(received.server_time)
    return { service, tokens: received, expiresAt: began + Math.max(0, Math.min(received.expires_in * 1000, deviceTtl)) }
  }
  private async ensureSession(generation: number): Promise<Session | undefined> {
    let session = this.data.session
    if (!session || generation !== this.generation) return
    // A committed successor is authoritative. It must never be replayed as the predecessor.
    if (session.acknowledge) {
      await this.api().json('/desktop/refresh/acknowledge', {
        refresh_token: session.tokens.refresh_token,
        request_id: session.acknowledge.requestId,
      })
      if (generation !== this.generation) return
      const { acknowledge: _removed, ...confirmed } = session
      await this.commit({ ...this.data, session: confirmed })
      session = confirmed
    }
    for (let recovery = 0; recovery < 2 && (session.pending || session.expiresAt <= Date.now() + 60_000); recovery++) {
      if (!session.pending) {
        const pending = { refreshToken: session.tokens.refresh_token, requestId: randomUUID() }
        await this.commit({ ...this.data, session: { ...session, pending } })
        session = this.data.session
      }
      if (!session?.pending || generation !== this.generation) return
      const pending = session.pending,
        began = Date.now()
      const received = tokens(
        await this.api().json('/desktop/refresh', {
          refresh_token: pending.refreshToken,
          request_id: pending.requestId,
          recovery_version: 2,
        }),
        pending.requestId,
      )
      if (received.device_session_id !== session.tokens.device_session_id) throw new AccountError('invalid_response')
      if (generation !== this.generation) return
      const next = { ...this.savedSession(session.service, received, began), acknowledge: { requestId: pending.requestId },
        ...(session.browserPending ? { browserPending: true as const } : {}) }
      // Failed storage leaves the previous durable pending record intact. No acknowledgement.
      await this.commit({ ...this.data, session: next })
      session = await this.ensureAcknowledged(next, generation)
      if (!session) return
    }
    if (session.expiresAt <= Date.now()) throw new AccountError('access_expired')
    return session
  }
  private async ensureAcknowledged(session: Session, generation: number): Promise<Session | undefined> {
    if (!session.acknowledge) return session
    await this.api().json('/desktop/refresh/acknowledge', {
      refresh_token: session.tokens.refresh_token,
      request_id: session.acknowledge.requestId,
    })
    if (generation !== this.generation) return
    const { acknowledge: _removed, ...confirmed } = session
    await this.commit({ ...this.data, session: confirmed })
    return confirmed
  }
  private async readAccount(generation: number): Promise<void> {
    try {
      const session = await this.ensureSession(generation)
      if (!session) return
      let raw: unknown
      try {
        raw = await this.api().json('/desktop/me', undefined, session.tokens.access_token)
      } catch (error) {
        if (generation !== this.generation) return
        if (!(error instanceof AccountError) || error.code !== 'access_expired') throw error
        await this.commit({ ...this.data, session: { ...session, expiresAt: 0 } })
        const renewed = await this.ensureSession(generation)
        if (!renewed) return
        raw = await this.api().json('/desktop/me', undefined, renewed.tokens.access_token)
      }
      if (generation !== this.generation) return
      const me = object(raw),
        user = object(me.user)
      if (!Array.isArray(me.organizations)) throw new AccountError('invalid_response')
      const organizations = me.organizations.map(organization),
        current = me.organization === null ? undefined : organization(me.organization)
      const phase =
        me.organization_state === 'ready'
          ? 'ready'
          : me.organization_state === 'selection_required'
            ? 'select-organization'
            : me.organization_state === 'blocked'
              ? 'blocked'
              : me.organization_state === 'no_available_organization'
                ? 'no-organization'
                : undefined
      if (!phase || (phase === 'ready' && (!current || current.status !== 'active' || current.needsLogin)))
        throw new AccountError('invalid_response')
      const accountUrl = safeAccountUrl(text(me.account_url), this.data.baseUrl)
      const previous = this.view
      const sameScope =
        previous.user?.id === user.id &&
        previous.organization?.tenantId === current?.tenantId &&
        previous.baseUrl === this.data.baseUrl
      this.accountUrl = accountUrl
      this.retryAt = 0
      this.failures = 0
      const verified: AccountSnapshot = {
        ...this.empty(phase),
        user: { id: text(user.id), name: text(user.name), ...(typeof user.email === 'string' ? { email: user.email } : {}) },
        organizations,
        ...(current ? { organization: current } : {}),
        quota: sameScope ? previous.quota : { phase: 'idle', windows: [] },
      }
      if (this.data.session?.browserPending) {
        this.browserAccount = verified
        this.publish(this.empty('waiting'))
      } else this.publish(verified)
    } catch (error) {
      if (generation !== this.generation) return
      if (error instanceof AccountError && fatal.has(error.code)) {
        const { session: _session, login: _login, ...next } = this.data
        await this.commit({ ...next, reauthenticate: error.code === 'reauthentication_required' })
        this.forceAuthentication = error.code === 'reauthentication_required'
        this.accountUrl = undefined
        this.publish(this.empty('signed-out'))
      }
      throw error
    }
  }
  selectOrganization(tenantId: string): Promise<void> {
    const generation = this.generation
    return this.serial(async () => {
      if (this.data.session?.browserPending) throw new AccountError('browser_confirmation_required')
      const selected = this.view.organizations.find(item => item.tenantId === tenantId)
      if (!selected || selected.status !== 'active' || selected.needsLogin)
        throw new AccountError('organization_unavailable')
      const session = await this.ensureSession(generation)
      if (!session) return
      await this.api().json('/desktop/organization', { tenant_id: tenantId }, session.tokens.access_token)
      if (generation !== this.generation) return
      // Scope-changing reads can never reuse quota from the previous organization.
      const { organization: _previous, ...identity } = this.view
      this.publish({ ...identity, phase: 'restoring', quota: { phase: 'idle', windows: [] } })
      await this.readAccount(generation)
    })
  }
  quota(): Promise<void> {
    const generation = this.generation
    return this.serial(async () => {
      const session = await this.ensureSession(generation)
      if (!session || !this.view.organization || this.view.phase !== 'ready') return
      const owner = this.view.organization.tenantId
      this.publish({ ...this.view, quota: { ...this.view.quota, phase: 'loading' } })
      try {
        const v = object(await this.api().json('/desktop/llm/quota', undefined, session.tokens.access_token))
        if (generation !== this.generation || owner !== this.snapshot().organization?.tenantId) return
        if ((v.status !== 'active' && v.status !== 'unconfigured') || !Array.isArray(v.windows))
          throw new AccountError('invalid_response')
        const windows: QuotaWindow[] = v.windows.map((raw) => {
          const w = object(raw),
            rule = object(w.rule)
          const name =
            typeof rule.name === 'string'
              ? rule.name
              : rule.kind === 'calendar_week'
                ? 'calendar_week'
                : typeof rule.hours === 'number'
                  ? String(rule.hours)
                  : '使用额度'
          return {
            name,
            limit: decimal(rule.points),
            used: decimal(w.used),
            reserved: decimal(w.reserved),
            remaining: decimal(w.remaining),
            resetsAt: w.resets_at === null ? null : date(w.resets_at),
          }
        })
        this.publish({ ...this.view, quota: { phase: v.status === 'active' ? 'ready' : 'unconfigured', windows } })
      } catch (error) {
        if (error instanceof AccountError && fatal.has(error.code)) throw error
        if (generation === this.generation && owner === this.snapshot().organization?.tenantId)
          this.publish({ ...this.view, quota: { ...this.view.quota, phase: 'failed', stale: true } })
      }
    })
  }
  /**
   * Request sign-out once; cancellation or an intervening account change retains the account.
   * @param confirm - Main-owned dialog; only explicit confirmation permits sign-out.
   * @returns Completion of the prompt and, when confirmed, local sign-out and remote cleanup.
   */
  logout(confirm: () => Promise<boolean>): Promise<void> {
    if (this.logoutConfirmation) return this.logoutConfirmation
    if (this.disposed) return Promise.resolve()
    const generation = this.generation
    const task = (async () => {
      if (!await confirm() || this.disposed || generation !== this.generation) return
      ++this.generation
      this.closeListener()
      await this.serial(async () => {
        await this.commit({ version: 1, baseUrl: this.data.baseUrl, cleanup: this.retired() })
        this.accountUrl = undefined
        this.publish(this.empty('logout-pending'))
        await this.cleanup()
        this.publish({
          ...this.empty(this.data.cleanup.length ? 'logout-pending' : 'signed-out'),
          ...(this.data.cleanup.length ? { error: { code: 'logout_pending', retryable: true } } : {}),
        })
      })
    })()
    this.logoutConfirmation = task
    const clear = () => { if (this.logoutConfirmation === task) this.logoutConfirmation = undefined }
    void task.then(clear, clear)
    return task
  }
  private async cleanup(): Promise<void> {
    for (const entry of [...this.data.cleanup]) {
      try {
        const api = this.api(entry.service.baseUrl)
        if (entry.proof) await api.json('/desktop/login/cancel', entry.proof)
        if (entry.refreshToken) await api.json('/desktop/logout', { refresh_token: entry.refreshToken })
      } catch {
        continue
      }
      await this.commit({ ...this.data, cleanup: this.data.cleanup.filter(item => item.id !== entry.id) })
    }
  }
  private async refreshBrand(): Promise<void> {
    const generation = this.brandGeneration,
      baseUrl = this.data.baseUrl
    try {
      const brand = await this.api(baseUrl).branding()
      if (this.disposed || generation !== this.brandGeneration || baseUrl !== this.data.baseUrl) return
      this.brand = this.options.defaultBrand ? { ...this.options.defaultBrand } : brand
      this.publish({ ...this.view, brand: this.brand })
    } catch {
      /* Public branding is optional; login and local work keep the product fallback. */
    }
  }
  personalCenter(): Promise<void> {
    return this.serial(async () => {
      if (!this.data.session?.browserPending && this.accountUrl)
        await this.options.openExternal(safeAccountUrl(this.accountUrl, this.data.baseUrl))
    })
  }
  dispose(): void {
    this.disposed = true
    ++this.brandGeneration
    ++this.generation
    this.closeListener()
    clearInterval(this.ticker)
  }
}
