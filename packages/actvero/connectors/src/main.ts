import { LocalConnectors, type LocalOptions } from './local-mcp.ts'
import { randomUUID } from 'node:crypto'
import type { Catalog, Connector, Identity, Inventory, ResourceToken, LocalView } from './contracts.ts'
/** Platform MCP failure carrying a safe code and optional HTTP/request metadata. */
export class ConnectorError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
    readonly requestId?: string,
  ) {
    super(code)
  }
}
interface Options {
  local?: LocalOptions
  identity(): Identity | undefined
  issue(resource: string): Promise<ResourceToken>
  load(key: string): Promise<string[]>
  save(key: string, ids: string[]): Promise<void>
  openExternal(url: string): Promise<void>
  changed(): void
  fetch?: typeof fetch
}
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const methodNames = new Set([
  'tools/list',
  'tools/call',
  'prompts/list',
  'prompts/get',
  'resources/list',
  'resources/templates/list',
  'resources/read',
])
/** Account-scoped platform MCP discovery and conversation selections with optional local connections. */
export class Connectors {
  private key = ''
  private epoch = 0
  private added = new Set<string>()
  private enabled = new Map<string, Set<string>>()
  private inventories = new Map<string, Inventory>()
  private tokens = new Map<string, { value: ResourceToken; expires: number }>()
  private issuing = new Map<string, Promise<ResourceToken>>()
  private attempts = new Map<string, string>()
  private abort = new AbortController()
  private restoring?: Promise<void>
  private checked = new Map<string, number>()
  private reconciling?: Promise<void>
  private saving: Promise<void> = Promise.resolve()
  /** Device-local connection manager when encrypted storage callbacks are configured. */
  readonly local?: LocalConnectors
  constructor(private options: Options) {
    if (options.local) this.local = new LocalConnectors(options.local, options.changed)
  }
  /** Dispose local connections and cancel outstanding platform requests. */
  async dispose(): Promise<void> {
    await this.local?.dispose()
    this.abort.abort()
  }
  /** Cancel account work and discard cached credentials, inventories and selections. */
  invalidate(): void {
    this.epoch++
    this.key = ''
    this.abort.abort()
    this.abort = new AbortController()
    this.added.clear()
    this.enabled.clear()
    this.inventories.clear()
    this.tokens.clear()
    this.issuing.clear()
    this.attempts.clear()
    this.restoring = undefined
    this.checked.clear()
    this.reconciling = undefined
    this.options.changed()
  }
  private async context() {
    const identity = this.options.identity()
    if (!identity?.available) {
      if (this.key) this.invalidate()
      throw new ConnectorError('login_required')
    }
    if (identity.key !== this.key) {
      this.invalidate()
      this.key = identity.key
      const epoch = this.epoch
      this.restoring = this.options.load(identity.key).then((ids) => {
        if (epoch === this.epoch) this.added = new Set(ids.filter(id => uuid.test(id)))
      })
    }
    const epoch = this.epoch
    await this.restoring
    this.check(epoch)
    return { identity, epoch, signal: this.abort.signal }
  }
  private persist() {
    const key = this.key,
      ids = [...this.added]
    const pending = this.saving.catch(() => {}).then(() => this.options.save(key, ids))
    this.saving = pending
    return pending
  }
  private check(epoch: number) {
    if (
      epoch !== this.epoch ||
      this.options.identity()?.key !== this.key ||
      !this.options.identity()?.available
    )
      throw new ConnectorError('account_changed')
  }
  private id(id: unknown): string {
    if (typeof id !== 'string' || !uuid.test(id)) throw new ConnectorError('invalid_connector')
    return id
  }
  private async token(resource: string) {
    const { epoch, identity } = await this.context()
    const cached = this.tokens.get(resource)
    if (cached && cached.expires > Date.now() + 30000) return cached.value
    let pending = this.issuing.get(resource)
    if (!pending) {
      pending = this.options.issue(resource).then((value) => {
        this.check(epoch)
        const expected =
          resource === 'mcp:catalog'
            ? '/api/v1/desktop/mcp/connectors'
            : `/api/mcp/services/${this.id(resource.slice(4))}`
        const endpoint = new URL(value.endpoint)
        if (
          value.resource !== resource ||
          value.token_type !== 'Bearer' ||
          !value.access_token ||
          !Number.isFinite(value.expires_in) ||
          value.expires_in <= 0 ||
          endpoint.origin !== new URL(identity.baseUrl).origin ||
          endpoint.pathname !== expected ||
          endpoint.search ||
          endpoint.hash ||
          endpoint.username ||
          endpoint.password
        )
          throw new ConnectorError('invalid_resource_response')
        this.tokens.set(resource, {
          value,
          expires: Date.now() + value.expires_in * 1000,
        })
        return value
      })
      this.issuing.set(resource, pending)
    }
    try {
      return await pending
    } finally {
      if (this.issuing.get(resource) === pending) this.issuing.delete(resource)
    }
  }
  private async http(
    resource: string,
    path: string,
    method: string,
    body?: unknown,
    protocol?: string,
    signal?: AbortSignal,
  ) {
    const { identity, epoch, signal: accountSignal } = await this.context()
    const token = await this.token(resource)
    const url = protocol ? token.endpoint : `${identity.baseUrl}/api/v1/desktop/mcp${path}`
    let response: Response
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        method,
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.any([
          accountSignal,
          ...(signal ? [signal] : []),
          AbortSignal.timeout(protocol ? 910000 : 120000),
        ]),
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: protocol ? 'application/json, text/event-stream' : 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(protocol ? { 'MCP-Protocol-Version': protocol } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      throw new ConnectorError('connection_interrupted')
    }
    this.check(epoch)
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; request_id?: string }
      }
      const code = error.error?.code ?? `http_${response.status}`
      if (response.status === 401) this.tokens.delete(resource)
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        this.inventories.clear()
        this.enabled.clear()
        this.options.changed()
      }
      throw new ConnectorError(
        /^[a-z_0-9]{1,70}$/.test(code) ? code : 'request_failed',
        response.status,
        error.error?.request_id,
      )
    }
    if (response.status === 204 || response.status === 202) return undefined
    // Bound output while streaming, before parsing; never print response bodies.
    const reader = response.body?.getReader()
    if (!reader) throw new ConnectorError('invalid_response')
    let size = 0
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2100000) {
        await reader.cancel()
        throw new ConnectorError('response_too_large')
      }
      chunks.push(value)
    }
    this.check(epoch)
    const data = Buffer.concat(chunks).toString('utf8')
    try {
      return JSON.parse(data)
    } catch {
      throw new ConnectorError('invalid_response')
    }
  }
  /**
   * Read a page of connectors available to the current account.
   * @param q - Catalog search text.
   * @param page - One-based page number.
   * @returns Platform catalog page.
   */
  async catalog(q = '', page = 1): Promise<Catalog> {
    return (await this.http(
      'mcp:catalog',
      `/connectors?q=${encodeURIComponent(q.slice(0, 200))}&page=${Math.max(1, Math.floor(page))}`,
      'GET',
    )) as Catalog
  }
  /**
   * Read platform or local connector metadata without returning credentials.
   * @param id - Platform or local connector identifier.
   * @returns Connector details and connection status.
   */
  async detail(id: string): Promise<Connector> {
    if (id.startsWith('local-') && this.local) return this.local.detail(id)
    return (await this.http('mcp:catalog', `/connectors/${this.id(id)}`, 'GET')) as Connector
  }
  /**
   * Combine platform and local connector selections for one conversation.
   * @param sessionId - Conversation identifier; omitted reads the default selection view.
   * @returns Added, enabled and ready identifiers.
   */
  async state(sessionId = ''): Promise<LocalView> {
    const local = (await this.local?.state(sessionId)) ?? { added: [], enabled: [], ready: [] }
    if (!this.options.identity()?.available) {
      if (this.key) this.invalidate()
      return local
    }
    await this.context()
    return {
      added: [...this.added, ...local.added],
      enabled: [...(this.enabled.get(sessionId) ?? []), ...local.enabled],
      ready: [...this.inventories.keys(), ...local.ready],
    }
  }
  /**
   * Ask the platform to verify a connector connection.
   * @param id - Platform connector identifier.
   * @returns Refreshed connector details.
   */
  async verify(id: string): Promise<Connector> {
    await this.http('mcp:catalog', `/connectors/${this.id(id)}/connection/verify`, 'POST', {})
    return this.detail(id)
  }
  /**
   * Validate required personal fields, save them to the platform and verify the connection.
   * @param id - Platform connector identifier.
   * @param values - Submitted personal credential fields.
   * @returns Verified connector details; incomplete credentials reject.
   */
  async credentials(id: string, values: unknown): Promise<Connector> {
    const item = await this.detail(id)
    if (item.auth_mode !== 'personal' || !values || typeof values !== 'object')
      throw new ConnectorError('invalid_credentials')
    const safe: Record<string, string> = {}
    for (const field of item.credential_fields) {
      const value = (values as Record<string, unknown>)[field.key]
      if (typeof value !== 'string' || !value || value.length > 8192)
        throw new ConnectorError('invalid_credentials')
      safe[field.key] = value
    }
    await this.http('mcp:catalog', `/connectors/${id}/connection`, 'PUT', {
      values: safe,
    })
    return this.verify(id)
  }
  /**
   * Delete platform connection authorization and remove local selection state.
   * @param id - Platform connector identifier.
   */
  async disconnect(id: string): Promise<void> {
    await this.http('mcp:catalog', `/connectors/${this.id(id)}/connection`, 'DELETE')
    await this.remove(id)
  }
  /**
   * Create a platform OAuth attempt and open its validated browser URL.
   * @param id - Platform connector identifier.
   * @returns Attempt identifier and initial status.
   */
  async authorize(id: string): Promise<{ id: string; status: string }> {
    const item = await this.detail(id)
    if (item.auth_mode !== 'oauth') throw new ConnectorError('invalid_auth_mode')
    const value = (await this.http('mcp:catalog', `/connectors/${id}/oauth-attempts`, 'POST', {})) as {
      id: string
      authorization_url: string
      status: string
    }
    const url = new URL(value.authorization_url)
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
      throw new ConnectorError('unsafe_authorization_url')
    this.attempts.set(value.id, url.href)
    await this.options.openExternal(url.href)
    return { id: value.id, status: value.status }
  }
  /**
   * Operate only on an OAuth attempt created by this manager.
   * @param id - Known authorization attempt identifier.
   * @param action - Read, complete, cancel or reopen the attempt.
   * @returns Platform attempt result, or no result when reopening the browser.
   */
  async oauth(id: string, action: 'status' | 'complete' | 'cancel' | 'reopen'): Promise<unknown> {
    this.id(id)
    const attempt = this.attempts.get(id)
    if (attempt === undefined) throw new ConnectorError('unknown_attempt')
    if (action === 'reopen') {
      await this.options.openExternal(attempt)
      return
    }
    const result = await this.http(
      'mcp:catalog',
      `/oauth-attempts/${id}${action === 'complete' ? '/complete' : ''}`,
      action === 'status' ? 'GET' : action === 'cancel' ? 'DELETE' : 'POST',
      action === 'complete' ? {} : undefined,
    )
    if (action === 'cancel' || action === 'complete') this.attempts.delete(id)
    return result
  }
  private async rpc(
    id: string,
    method: string,
    params: unknown = {},
    version = '2025-11-25',
    signal?: AbortSignal,
  ) {
    const requestId = randomUUID()
    const result = (await this.http(
      `mcp:${this.id(id)}`,
      '',
      'POST',
      { jsonrpc: '2.0', id: requestId, method, params },
      version,
      signal,
    )) as {
      id?: string
      jsonrpc?: string
      error?: { code: number; message: string; data?: { code?: string } }
      result?: unknown
    }
    if (result?.jsonrpc !== '2.0' || result.id !== requestId) throw new ConnectorError('invalid_mcp_response')
    if (result.error) {
      const code = result.error.data?.code
      if (
        ['capability_denied', 'connection_or_definition_changed', 'connector_unavailable'].includes(
          code ?? '',
        )
      ) {
        this.inventories.delete(id)
        for (const ids of this.enabled.values()) ids.delete(id)
        this.options.changed()
      }
      throw new ConnectorError(code && /^[a-z_]{1,70}$/.test(code) ? code : `mcp_${result.error.code}`)
    }
    return result.result
  }
  /**
   * Negotiate MCP and collect all supported capability pages within configured bounds.
   * @param id - Platform connector identifier.
   * @returns Discovered inventory and negotiated protocol version.
   */
  async discover(id: string): Promise<Inventory> {
    const { epoch } = await this.context()
    const initialized = (await this.rpc(id, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'DS', version: '0.1.0' },
    })) as { protocolVersion: string; capabilities: Record<string, unknown> }
    if (!['2025-11-25', '2025-06-18', '2025-03-26'].includes(initialized.protocolVersion))
      throw new ConnectorError('unsupported_protocol')
    await this.http(
      `mcp:${id}`,
      '',
      'POST',
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      initialized.protocolVersion,
    )
    const result: Inventory = {
      tools: [],
      prompts: [],
      resources: [],
      resourceTemplates: [],
      protocolVersion: initialized.protocolVersion,
    }
    for (const [cap, method, key] of [
      ['tools', 'tools/list', 'tools'],
      ['prompts', 'prompts/list', 'prompts'],
      ['resources', 'resources/list', 'resources'],
      ['resources', 'resources/templates/list', 'resourceTemplates'],
    ] as const) {
      if (initialized.capabilities[cap]) {
        let cursor: string | undefined
        const seen = new Set<string>()
        let pages = 0
        do {
          if (++pages > 100) throw new ConnectorError('catalog_too_large')
          const response = (await this.rpc(
            id,
            method,
            cursor ? { cursor } : {},
            initialized.protocolVersion,
          )) as Record<string, unknown>
          if (
            !Array.isArray(response[key]) ||
            (response.nextCursor !== undefined && typeof response.nextCursor !== 'string')
          )
            throw new ConnectorError('unsupported_catalog_response')
          result[key].push(...(response[key] as Inventory[typeof key]))
          if (result[key].length > 10000) throw new ConnectorError('catalog_too_large')
          cursor = response.nextCursor as string | undefined
          if (cursor) {
            if (cursor.length > 2048 || seen.has(cursor)) throw new ConnectorError('invalid_mcp_cursor')
            seen.add(cursor)
          }
        } while (cursor)
      }
    }
    this.check(epoch)
    return result
  }
  /**
   * Verify and discover a platform connector before persisting its added state.
   * @param id - Platform connector identifier.
   * @returns Discovered inventory.
   */
  async add(id: string): Promise<Inventory> {
    const { epoch } = await this.context()
    const detail = await this.detail(id)
    if (detail.connection.status !== 'connected') await this.verify(id)
    const inventory = await this.discover(id)
    this.check(epoch)
    this.inventories.set(id, inventory)
    this.checked.set(id, Date.now())
    this.added.add(id)
    await this.persist()
    this.check(epoch)
    this.options.changed()
    return inventory
  }
  /**
   * Remove a platform connector and clear its cached inventory and session selections.
   * @param id - Platform connector identifier.
   */
  async remove(id: string): Promise<void> {
    await this.context()
    this.id(id)
    this.added.delete(id)
    this.inventories.delete(id)
    for (const ids of this.enabled.values()) ids.delete(id)
    await this.persist()
    this.options.changed()
  }
  /**
   * Enable or disable a connector for one conversation.
   * @param id - Platform or local connector identifier.
   * @param sessionId - Nonempty conversation identifier.
   * @param enabled - Requested conversation selection.
   * @returns Updated conversation selection state.
   */
  async select(id: string, sessionId: string, enabled: boolean): Promise<LocalView> {
    if (!sessionId || sessionId.length > 200) throw new ConnectorError('session_required')
    if (id.startsWith('local-') && this.local) {
      await this.local.select(id, sessionId, enabled)
      return this.state(sessionId)
    }
    const { epoch } = await this.context()
    if (enabled) {
      if (!this.added.has(id) || !this.inventories.has(id)) await this.add(id)
      this.check(epoch)
      const selected = this.enabled.get(sessionId) ?? new Set<string>()
      selected.add(id)
      this.enabled.set(sessionId, selected)
    } else this.enabled.get(sessionId)?.delete(id)
    return this.state(sessionId)
  }
  /**
   * Refresh an added platform connector and notify only when its inventory changes.
   * @param id - Platform connector identifier.
   * @returns Current capability inventory.
   */
  async inventory(id: string): Promise<Inventory> {
    await this.context()
    if (!this.added.has(id)) throw new ConnectorError('connector_not_added')
    const inventory = await this.discover(id)
    const previous = this.inventories.get(id)
    this.inventories.set(id, inventory)
    this.checked.set(id, Date.now())
    // A health refresh must not unregister unchanged tools during an agent turn.
    // Access failures still remove the inventory and session grants in reconcile.
    if (JSON.stringify(previous) !== JSON.stringify(inventory)) this.options.changed()
    return inventory
  }
  /**
   * Execute MCP only when the connector is selected and ready for the conversation.
   * @param id - Platform or local connector identifier.
   * @param sessionId - Conversation identifier.
   * @param method - Supported MCP operation.
   * @param params - Operation-specific request parameters.
   * @param signal - Optional request cancellation signal.
   * @returns MCP response; missing authorization or unsupported methods reject.
   */
  async call(
    id: string,
    sessionId: string,
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (id.startsWith('local-') && this.local) return this.local.call(id, sessionId, method, params, signal)
    await this.context()
    if (!this.added.has(id) || !this.enabled.get(sessionId)?.has(id) || !methodNames.has(method))
      throw new ConnectorError('connector_not_enabled')
    const inventory = this.inventories.get(id)
    if (!inventory) throw new ConnectorError('connector_not_ready')
    return this.rpc(id, method, params, inventory.protocolVersion, signal)
  }
  /**
   * Validate and route renderer connector actions to the owning platform or local manager.
   * @param action - Supported bridge action.
   * @param p - Action-specific input fields.
   * @returns Action result; invalid inputs reject.
   */
  async dispatch(action: string, p: Record<string, unknown> = {}): Promise<unknown> {
    if (action.startsWith('local') && this.local) return this.local.dispatch(action, p)
    if (typeof p.id === 'string' && p.id.startsWith('local-') && this.local) {
      if (action === 'detail') return this.local.detail(p.id)
      if (action === 'select' && typeof p.sessionId === 'string' && typeof p.enabled === 'boolean')
        return this.select(p.id, p.sessionId, p.enabled)
      if (action === 'remove') return this.local.remove(p.id)
      throw new ConnectorError('invalid_action')
    }
    switch (action) {
      case 'preview':
        if (!['prompts/get', 'resources/read'].includes(String(p.method)) || typeof p.sessionId !== 'string')
          throw new ConnectorError('invalid_action')
        return this.call(this.id(p.id), p.sessionId, String(p.method), p.params)
      case 'catalog':
        return this.catalog(typeof p.q === 'string' ? p.q : '', typeof p.page === 'number' ? p.page : 1)
      case 'state':
        return this.state(typeof p.sessionId === 'string' ? p.sessionId : '')
      case 'detail':
        return this.detail(this.id(p.id))
      case 'add':
        return this.add(this.id(p.id))
      case 'remove':
        return this.remove(this.id(p.id))
      case 'verify':
        return this.verify(this.id(p.id))
      case 'credentials':
        return this.credentials(this.id(p.id), p.values)
      case 'disconnect':
        return this.disconnect(this.id(p.id))
      case 'authorize':
        return this.authorize(this.id(p.id))
      case 'oauth':
        if (!['status', 'complete', 'cancel', 'reopen'].includes(String(p.action)))
          throw new ConnectorError('invalid_action')
        return this.oauth(this.id(p.id), p.action as 'status')
      case 'select':
        if (typeof p.sessionId !== 'string' || typeof p.enabled !== 'boolean')
          throw new ConnectorError('invalid_selection')
        return this.select(this.id(p.id), p.sessionId, p.enabled)
      case 'inventory':
        return this.inventory(this.id(p.id))
      default:
        throw new ConnectorError('invalid_action')
    }
  }
  /** Refresh stale platform inventories; authoritative revocations clear affected selections. */
  async reconcile(): Promise<void> {
    await this.context()
    if (this.reconciling) return this.reconciling
    const epoch = this.epoch
    const pending = (async () => {
      for (const id of [...this.inventories.keys()]) {
        if (Date.now() - (this.checked.get(id) ?? 0) < 30000) continue
        try {
          await this.detail(id)
          await this.inventory(id)
        } catch (error) {
          this.check(epoch)
          // Temporary network/rate errors keep selection; authoritative revocations remove it.
          if (!(error instanceof ConnectorError) || ![401, 403, 404, 410].includes(error.status ?? 0))
            throw error
          this.inventories.delete(id)
          for (const ids of this.enabled.values()) ids.delete(id)
          this.options.changed()
        }
      }
    })()
    this.reconciling = pending
    try {
      await pending
    } finally {
      if (this.reconciling === pending) this.reconciling = undefined
    }
  }
  /**
   * Expose currently usable MCP inventories and their selected conversations.
   * @param sessions - Local conversation identifiers to register before collecting the snapshot.
   * @returns Combined local and platform inventories for Host registration.
   */
  async hostSnapshot(
    sessions: string[] = [],
  ): Promise<{ id: string; inventory: Inventory; sessions: string[] }[]> {
    const local = (await this.local?.snapshot(sessions)) ?? []
    if (!this.options.identity()?.available) {
      if (this.key) this.invalidate()
      return local
    }
    try {
      await this.reconcile()
    } catch (error) {
      if (error instanceof ConnectorError && error.status && [401, 403, 404, 410].includes(error.status))
        throw error
    }
    return local.concat(
      [...this.inventories].map(([id, inventory]) => ({
        id,
        inventory,
        sessions: [...this.enabled].filter(([, ids]) => ids.has(id)).map(([session]) => session),
      })),
    )
  }
}
