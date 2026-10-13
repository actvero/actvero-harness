import { randomUUID, createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  ToolListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { Connector, Inventory } from './contracts.ts'
import { LocalOAuth, type OAuthData } from './local-oauth.ts'
import {
  normalizeConfig,
  parseConfigurations,
  bad,
  LocalConnectorError,
  type CustomConfig,
  type CustomView,
} from './local-config.ts'
export { LocalConnectorError } from './local-config.ts'

interface Saved {
  id: string
  config: CustomConfig
  enabled: boolean
  oauth?: OAuthData
}
interface Live {
  client: Client
  transport: Transport
  inventory: Inventory
}
/** Main-process storage and browser callbacks required by local MCP connections. */
export interface LocalOptions {
  load(): Promise<unknown>
  save(value: unknown): Promise<void>
  openExternal(url: string): Promise<void>
}
const isLocal = (id: string) => /^local-[0-9a-f-]{36}$/.test(id)
const fingerprint = (c: CustomConfig) => createHash('sha256').update(JSON.stringify(c)).digest('hex')
const safeError = (e: unknown) => {
  if (e instanceof LocalConnectorError) return e.code
  const code = (e as { code?: unknown })?.code
  if (['authorization_cancelled', 'authorization_timeout', 'authorization_denied'].includes(String(code)))
    return String(code)
  if (code === 'ENOENT') return 'command_not_found'
  if (
    code === 401 ||
    code === 403 ||
    /Unauthorized|authorization_required|invalid_grant|HTTP (?:401|403)/.test(String(e))
  )
    return 'authorization_required'
  if (/abort|timeout/i.test(String(e))) return 'connection_timeout'
  return 'connection_failed'
}
/** Device-local MCP configuration, connection lifetime and session selection owner. */
export class LocalConnectors {
  private records?: Saved[]
  private loaded?: Promise<Saved[]>
  private live = new Map<string, Live>()
  private states = new Map<string, { status: CustomView['status']; error?: string }>()
  private sessions = new Map<string, Set<string>>()
  private flights = new Map<string, Promise<void>>()
  private revisions = new Map<string, number>()
  private connecting = new Map<string, Client>()
  private queue: Promise<unknown> = Promise.resolve()
  private drafts = new Map<string, { config: CustomConfig[]; until: number }>()
  private authorized = new Map<string, { hash: string; oauth: OAuthData; until: number }>()
  private authorization?: AbortController
  private disposed = false
  constructor(
    private options: LocalOptions,
    private changed: () => void,
  ) {}
  private async entries() {
    if (this.records) return this.records
    this.loaded ??= (async () => {
      const raw = await this.options.load()
      if (raw !== undefined && !Array.isArray(raw)) return bad('local_state_invalid')
      const rows = (raw ?? []) as Saved[]
      if (
        rows.some(r => !isLocal(r.id) || typeof r.enabled !== 'boolean') ||
        new Set(rows.map(r => r.id)).size !== rows.length
      )
        return bad('local_state_invalid')
      this.records = rows.map(r => ({ ...r, config: normalizeConfig(r.config) }))
      return this.records
    })()
    try {
      return await this.loaded
    } finally {
      this.loaded = undefined
    }
  }
  private mutate<T>(fn: () => Promise<T>) {
    const task = this.queue.catch(() => {}).then(fn)
    this.queue = task
    return task
  }
  private saving: Promise<void> = Promise.resolve()
  private persist() {
    const value = structuredClone(this.records)
    const next = this.saving.catch(() => {}).then(() => this.options.save(value))
    this.saving = next
    return next
  }
  private async record(id: string) {
    const row = (await this.entries()).find(r => r.id === id)
    if (!row) return bad('connector_not_added')
    return row
  }
  private view(row: Saved): CustomView {
    const c = row.config
    return {
      ...c,
      id: row.id,
      enabled: row.enabled,
      token: '',
      hasToken: !!c.token,
      hasAuthorization: !!row.oauth?.tokens,
      env: Object.fromEntries(Object.keys(c.env).map(k => [k, ''])),
      headers: Object.fromEntries(Object.keys(c.headers).map(k => [k, ''])),
      ...(this.states.get(row.id) ?? { status: row.enabled ? 'connecting' : 'disabled' }),
    }
  }
  /**
   * Read saved local connections with credential values redacted.
   * @returns Renderer-safe configuration and status rows.
   */
  async list(): Promise<CustomView[]> {
    return (await this.entries()).map(r => this.view(r))
  }
  /**
   * Read local connection metadata in the shared connector format.
   * @param id - Saved local connector identifier.
   * @returns Connection metadata without configuration secrets.
   */
  async detail(id: string): Promise<Connector> {
    const r = await this.record(id),
      state = this.states.get(id)
    return {
      id,
      name: r.config.name,
      display_name: r.config.name,
      description: '',
      icon: null,
      examples: [],
      auth_mode: 'none',
      credential_fields: [],
      counts: {},
      endpoint: '',
      connection: {
        status: this.live.has(id)
          ? 'connected'
          : state?.status === 'authorization_required'
            ? 'reauthorization_required'
            : 'not_connected',
        action: 'retry',
        checked_at: null,
        error_code: state?.error ?? null,
      },
    }
  }
  /**
   * Read credentials for trusted Main-process integrations only.
   * @param id - Saved local connector identifier.
   * @returns A detached copy of the complete private configuration.
   */
  async configuration(id: string): Promise<CustomConfig> {
    return structuredClone((await this.record(id)).config)
  }
  private async candidate(input: unknown, id?: string, authDraft?: string) {
    const config = normalizeConfig(input)
    let oauth: OAuthData | undefined
    if (id) {
      const old = await this.record(id)
      const keep = (input as { keepSecrets?: boolean }).keepSecrets
      if (
        keep &&
        old.config.transport === config.transport &&
        old.config.url === config.url &&
        old.config.command === config.command &&
        old.config.auth === config.auth
      ) {
        if (!config.token) config.token = old.config.token
        for (const key of Object.keys(config.env))
          if (!config.env[key]) config.env[key] = old.config.env[key] ?? ''
        for (const key of Object.keys(config.headers))
          if (!config.headers[key]) config.headers[key] = old.config.headers[key] ?? ''
        if (old.config.clientId === config.clientId) oauth = old.oauth
      }
    }
    if (authDraft) {
      const saved = this.authorized.get(authDraft)
      if (!saved || saved.until < Date.now() || saved.hash !== fingerprint(config))
        return bad('authorization_expired')
      oauth = saved.oauth
    }
    if (config.auth === 'bearer' && !config.token) return bad('token_required')
    return { config, oauth }
  }
  private async transport(row: Saved, onOAuthChanged: () => Promise<void>) {
    const c = row.config
    if (c.transport === 'stdio') {
      const transport = new StdioClientTransport({
        command: c.command,
        args: c.args,
        env: c.env,
        cwd: c.cwd || undefined,
        stderr: 'pipe',
      })
      // Drain stderr without retaining credentials or arbitrary server output in application logs.
      transport.stderr?.on('data', () => {})
      return transport
    }
    if (c.auth === 'oauth' && !row.oauth?.tokens) return bad('authorization_required')
    const headers =
      c.auth === 'bearer' ? { Authorization: `Bearer ${c.token}` } : c.auth === 'headers' ? c.headers : {}
    const url = new URL(c.url)
    const boundFetch: typeof fetch = (input, init) => {
      const target = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      )
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
        return Promise.reject(new LocalConnectorError('invalid_url'))
      const h = new Headers(init?.headers)
      if (target.origin !== url.origin) {
        h.delete('Authorization')
        for (const k of Object.keys(headers)) h.delete(k)
      }
      return fetch(input, { ...init, headers: h, credentials: 'omit', redirect: 'error' })
    }
    const authProvider =
      c.auth === 'oauth'
        ? new LocalOAuth((row.oauth ??= {}), c.clientId, this.options.openExternal, onOAuthChanged)
        : undefined
    if (c.transport === 'sse')
      return new SSEClientTransport(url, { requestInit: { headers }, fetch: boundFetch, authProvider })
    return new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
      fetch: boundFetch,
      authProvider,
      reconnectionOptions: {
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 5000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 0,
      },
    })
  }
  private async discover(client: Client, protocolVersion: string): Promise<Inventory> {
    const inventory: Inventory = {
      tools: [],
      prompts: [],
      resources: [],
      resourceTemplates: [],
      protocolVersion,
    }
    const caps = client.getServerCapabilities() ?? {}
    const pages = async (
      method: 'listTools' | 'listPrompts' | 'listResources' | 'listResourceTemplates',
      key: keyof Omit<Inventory, 'protocolVersion'>,
    ) => {
      let cursor: string | undefined
      const seen = new Set<string>()
      for (let page = 0; page < 100; page++) {
        const result = (await client[method]({ cursor }, { timeout: 20_000 })) as Record<string, unknown>
        const rows = result[key]
        if (!Array.isArray(rows) || inventory[key].length + rows.length > 5000) return bad('capability_limit')
        inventory[key].push(...rows)
        const next = result.nextCursor
        if (!next) return
        if (typeof next !== 'string' || seen.has(next)) return bad('invalid_pagination')
        seen.add(next)
        cursor = next
      }
      return bad('capability_limit')
    }
    if (caps.tools) await pages('listTools', 'tools')
    if (caps.prompts) await pages('listPrompts', 'prompts')
    if (caps.resources) {
      await pages('listResources', 'resources')
      await pages('listResourceTemplates', 'resourceTemplates')
    }
    return inventory
  }
  private async open(row: Saved, persistOAuth = false): Promise<Live> {
    if (this.disposed) return bad('connector_cancelled')
    const client = new Client({ name: 'Actvero Harness', version: '0.1.0' }, { capabilities: {} })
    const transport: Transport = await this.transport(row, async () => {
      if (persistOAuth) await this.persist()
    })
    let protocolVersion = ''
    const setProtocolVersion = transport.setProtocolVersion?.bind(transport)
    transport.setProtocolVersion = (v) => {
      protocolVersion = v
      setProtocolVersion?.(v)
    }
    this.connecting.set(row.id, client)
    const timeout = setTimeout(() => void client.close(), 25_000)
    try {
      await client.connect(transport, { timeout: 20_000 })
      const inventory = await this.discover(client, protocolVersion)
      return { client, transport, inventory }
    } catch (e) {
      await client.close().catch(() => {})
      throw new LocalConnectorError(safeError(e))
    } finally {
      clearTimeout(timeout)
      if (this.connecting.get(row.id) === client) this.connecting.delete(row.id)
    }
  }
  private async stop(id: string) {
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1)
    const active = this.live.get(id)
    this.live.delete(id)
    await this.connecting
      .get(id)
      ?.close()
      .catch(() => {})
    await active?.client.close().catch(() => {})
    this.changed()
  }
  private async connect(id: string, force = false) {
    if (this.flights.has(id)) return this.flights.get(id)
    if (this.live.has(id) && !force) return
    const task = (async () => {
      const row = await this.record(id)
      if (!row.enabled || this.disposed) return
      await this.stop(id)
      const revision = this.revisions.get(id)
      this.states.set(id, { status: 'connecting' })
      this.changed()
      try {
        const live = await this.open(row, true)
        if (this.disposed || revision !== this.revisions.get(id) || !row.enabled) {
          await live.client.close()
          return
        }
        this.live.set(id, live)
        this.states.set(id, { status: 'connected' })
        live.client.onclose = () => {
          if (this.live.get(id) !== live) return
          this.live.delete(id)
          this.states.set(id, { status: 'error', error: 'connection_closed' })
          this.changed()
        }
        live.client.onerror = () => {}
        const refresh = async () => {
          try {
            const inventory = await this.discover(live.client, live.inventory.protocolVersion)
            if (this.live.get(id) === live) {
              live.inventory = inventory
              this.changed()
            }
          } catch {
            if (this.live.get(id) === live) {
              await this.stop(id)
              this.states.set(id, { status: 'error', error: 'connection_failed' })
              this.changed()
            }
          }
        }
        for (const schema of [
          ToolListChangedNotificationSchema,
          PromptListChangedNotificationSchema,
          ResourceListChangedNotificationSchema,
        ])
          live.client.setNotificationHandler(schema, refresh)
      } catch (e) {
        if (revision === this.revisions.get(id)) {
          const error = safeError(e)
          this.states.set(id, {
            status: error === 'authorization_required' ? 'authorization_required' : 'error',
            error,
          })
        }
      }
      this.changed()
    })()
    this.flights.set(id, task)
    try {
      await task
    } finally {
      if (this.flights.get(id) === task) this.flights.delete(id)
    }
  }
  /** Start enabled saved connections whose state has not yet been restored. */
  async restore(): Promise<void> {
    await Promise.all(
      (await this.entries())
        .filter(r => r.enabled && !this.states.has(r.id))
        .map(r => this.connect(r.id)),
    )
  }
  /**
   * Validate and persist a local configuration, then connect it if enabled.
   * @param input - Untrusted configuration, optionally preserving unchanged saved secrets.
   * @param id - Existing connection identifier when editing.
   * @param authDraft - Unexpired authorization token matching this configuration.
   * @returns Saved connection view with credential values redacted.
   */
  async save(input: unknown, id?: string, authDraft?: string): Promise<CustomView> {
    const { config, oauth } = await this.candidate(input, id, authDraft)
    const saved = await this.mutate(async () => {
      const records = await this.entries(),
        old = id ? await this.record(id) : undefined
      if (
        records.some(
          r => r.id !== id && r.config.name.toLocaleLowerCase() === config.name.toLocaleLowerCase(),
        )
      )
        return bad('name_conflict')
      const row: Saved = {
        id: old?.id ?? 'local-' + randomUUID(),
        config,
        enabled: old?.enabled ?? true,
        oauth,
      }
      await this.stop(row.id)
      await this.flights.get(row.id)?.catch(() => {})
      this.states.set(row.id, { status: row.enabled ? 'connecting' : 'disabled' })
      this.records = [...records.filter(r => r.id !== row.id), row]
      try {
        await this.persist()
      } catch (e) {
        this.records = records
        this.states.delete(row.id)
        throw e
      }
      return row
    })
    if (saved.enabled) await this.connect(saved.id)
    this.changed()
    return this.view(saved)
  }
  /** Validate a credentials-free portable template without launching it.
   * @param input - imported JSON configuration.
   * @returns The normalized template, or throws for credentials and device-specific commands.
   */
  template(input: unknown): CustomConfig {
    const parsed = parseConfigurations(JSON.stringify(input))
    if (parsed.length !== 1) return bad('unsafe_template')
    const c = parsed[0]
    if (
      c.token ||
      Object.values(c.env).some(Boolean) ||
      Object.values(c.headers).some(Boolean) ||
      c.cwd ||
      (c.url && new URL(c.url).search) ||
      (c.transport === 'stdio' &&
        (!['npx', 'uvx'].includes(c.command) ||
          !c.args.length ||
          c.args.some(
            arg =>
              !['-y', '--yes'].includes(arg) &&
              !/^@?[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)?(?:@[0-9][a-z0-9_.-]*|==[0-9][a-z0-9_.-]*)$/i.test(arg),
          )))
    )
      return bad('unsafe_template')
    return c
  }
  /** Export a portable template with credential values removed.
   * @param id - saved local MCP identifier.
   * @returns The credentials-free normalized template.
   */
  async portable(id: string): Promise<CustomConfig> {
    const { config: c } = await this.record(id)
    return this.template({
      ...c,
      token: '',
      env: Object.fromEntries(Object.keys(c.env).map(k => [k, ''])),
      headers: Object.fromEntries(Object.keys(c.headers).map(k => [k, ''])),
    })
  }
  /** Save a new template without starting its process or authorization flow.
   * @param input - credentials-free portable configuration.
   * @returns The disabled saved connection; same-name conflicts reject the write.
   */
  async saveDisabled(input: unknown): Promise<CustomView> {
    const config = this.template(input)
    return this.mutate(async () => {
      const records = await this.entries()
      if (records.some(r => r.config.name.toLowerCase() === config.name.toLowerCase()))
        return bad('name_conflict')
      const row: Saved = { id: 'local-' + randomUUID(), config, enabled: false }
      this.records = [...records, row]
      try {
        await this.persist()
      } catch (e) {
        this.records = records
        throw e
      }
      this.states.set(row.id, { status: 'disabled' })
      this.changed()
      return this.view(row)
    })
  }
  /**
   * Open a temporary connection, discover its capabilities and close it.
   * @param input - Candidate configuration.
   * @param id - Existing connection whose unchanged secrets may be reused.
   * @param authDraft - Optional matching authorization draft.
   * @returns Connection success; validation, authorization and discovery failures reject.
   */
  async test(input: unknown, id?: string, authDraft?: string): Promise<{ connected: boolean }> {
    const { config, oauth } = await this.candidate(input, id, authDraft)
    const live = await this.open({ id: 'test-' + randomUUID(), config, oauth, enabled: true }, !!id)
    try {
      return { connected: true }
    } finally {
      await live.client.close()
    }
  }
  /**
   * Authorize a candidate OAuth connection and retain an expiring configuration-bound draft.
   * @param input - Candidate HTTP or SSE OAuth configuration.
   * @param id - Existing connection whose unchanged fields may be reused.
   * @returns Draft token to pass when saving the same configuration.
   */
  async authorize(
    input: unknown,
    id?: string,
  ): Promise<{ authDraft: `${string}-${string}-${string}-${string}-${string}` }> {
    for (const [key, value] of this.authorized) if (value.until < Date.now()) this.authorized.delete(key)
    if (this.authorized.size >= 3) {
      const oldest = this.authorized.keys().next()
      if (!oldest.done) this.authorized.delete(oldest.value)
    }
    this.authorization?.abort()
    const controller = new AbortController()
    this.authorization = controller
    const { config } = await this.candidate(input, id)
    if (config.auth !== 'oauth' || config.transport === 'stdio') return bad('unsupported_auth')
    const oauth = new LocalOAuth({}, config.clientId, this.options.openExternal)
    try {
      const data = await oauth.authorize(config.url, controller.signal)
      const token = randomUUID()
      this.authorized.set(token, { hash: fingerprint(config), oauth: data, until: Date.now() + 600_000 })
      return { authDraft: token }
    } catch (e) {
      throw new LocalConnectorError(safeError(e))
    } finally {
      if (this.authorization === controller) this.authorization = undefined
    }
  }
  /** Cancel the current interactive local OAuth attempt. */
  cancelAuthorization(): void {
    this.authorization?.abort()
  }
  /**
   * Persist device enablement and start or stop the connection.
   * @param id - Saved local connector identifier.
   * @param enabled - Whether the connection may run on this device.
   */
  async enable(id: string, enabled: boolean): Promise<void> {
    await this.mutate(async () => {
      const row = await this.record(id),
        old = row.enabled
      row.enabled = enabled
      try {
        await this.persist()
      } catch (e) {
        row.enabled = old
        throw e
      }
      if (!enabled) {
        await this.stop(id)
        this.states.set(id, { status: 'disabled' })
      } else this.states.delete(id)
    })
    if (enabled) await this.connect(id)
    this.changed()
  }
  /**
   * Remove a saved connection, stop it and clear its session selections.
   * @param id - Saved local connector identifier.
   */
  async remove(id: string): Promise<void> {
    await this.mutate(async () => {
      const records = await this.entries(),
        row = await this.record(id),
        oldEnabled = row.enabled
      row.enabled = false
      await this.stop(id)
      this.records = records.filter(r => r.id !== id)
      try {
        await this.persist()
      } catch (e) {
        this.records = records
        row.enabled = oldEnabled
        this.states.delete(id)
        throw e
      }
      this.states.delete(id)
      for (const muted of this.sessions.values()) muted.delete(id)
    })
    this.changed()
  }
  /**
   * Validate import JSON without starting connections and retain an expiring preview.
   * @param raw - One configuration or an mcpServers JSON document.
   * @returns Preview token and rows including same-name conflicts.
   */
  async parse(
    raw: string,
  ): Promise<{
    token: `${string}-${string}-${string}-${string}-${string}`
    items: { index: number; name: string; transport: CustomConfig['transport']; conflict: boolean }[]
  }> {
    const config = parseConfigurations(raw),
      records = await this.entries()
    for (const [token, p] of this.drafts) if (p.until < Date.now()) this.drafts.delete(token)
    if (this.drafts.size >= 3) return bad('too_many_previews')
    const token = randomUUID()
    this.drafts.set(token, { config, until: Date.now() + 600_000 })
    return {
      token,
      items: config.map((c, index) => ({
        index,
        name: c.name,
        transport: c.transport,
        conflict: records.some(r => r.config.name.toLocaleLowerCase() === c.name.toLocaleLowerCase()),
      })),
    }
  }
  /**
   * Save selected preview entries and report failures per entry.
   * @param token - Unexpired preview token.
   * @param indices - Distinct zero-based row indices selected for import.
   * @returns Per-row saved views or safe diagnostic codes.
   */
  async import(
    token: string,
    indices: unknown,
  ): Promise<
    ({ index: number; item: CustomView; error?: never } | { index: number; error: string; item?: never })[]
  > {
    const draft = this.drafts.get(token)
    if (!draft || draft.until < Date.now()) return bad('preview_expired')
    if (
      !Array.isArray(indices) ||
      !indices.length ||
      new Set(indices).size !== indices.length ||
      indices.some(i => !Number.isInteger(i) || i < 0 || i >= draft.config.length)
    )
      return bad('invalid_selection')
    const results = []
    for (const index of indices) {
      try {
        const item = await this.save(draft.config[index])
        results.push({ index, item })
      } catch (e) {
        results.push({ index, error: safeError(e) })
      }
    }
    return results
  }
  /**
   * Restore connections and expose device and session selection state.
   * @param sessionId - Conversation identifier; empty reads device state without registering a session.
   * @returns Added, enabled and ready connector identifiers.
   */
  async state(sessionId: string): Promise<{ added: string[]; enabled: string[]; ready: string[] }> {
    await this.restore()
    const rows = await this.entries()
    if (sessionId && !this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Set())
      this.changed()
    }
    const muted = this.sessions.get(sessionId) ?? new Set()
    return {
      added: rows.map(r => r.id),
      enabled: rows.filter(r => r.enabled && !muted.has(r.id)).map(r => r.id),
      ready: [...this.live.keys()],
    }
  }
  /**
   * Change a conversation choice without overriding device disablement.
   * @param id - Saved local connector identifier.
   * @param sessionId - Conversation identifier.
   * @param enabled - Whether this conversation selects the connector.
   * @returns Updated conversation selection state.
   */
  async select(
    id: string,
    sessionId: string,
    enabled: boolean,
  ): Promise<{ added: string[]; enabled: string[]; ready: string[] }> {
    const row = await this.record(id)
    if (enabled && !row.enabled) return bad('connector_disabled')
    let muted = this.sessions.get(sessionId)
    if (!muted) {
      muted = new Set()
      this.sessions.set(sessionId, muted)
    }
    const before = muted.has(id)
    if (enabled) muted.delete(id)
    else muted.add(id)
    if (before !== muted.has(id)) this.changed()
    return this.state(sessionId)
  }
  /**
   * Restore connections and expose live inventories with their allowed conversations.
   * @param sessions - Additional conversation identifiers to register.
   * @returns Live connector inventories and selected session identifiers.
   */
  async snapshot(
    sessions: string[] = [],
  ): Promise<{ id: string; inventory: Inventory; sessions: string[] }[]> {
    for (const id of sessions)
      if (typeof id === 'string' && id.length <= 200 && !this.sessions.has(id))
        this.sessions.set(id, new Set())
    await this.restore()
    return [...this.live].map(([id, entry]) => ({
      id,
      inventory: entry.inventory,
      sessions: [...this.sessions].filter(([, muted]) => !muted.has(id)).map(([session]) => session),
    }))
  }
  /**
   * Execute an allowed MCP method for a selected live connection.
   * @param id - Saved local connector identifier.
   * @param session - Conversation identifier whose selection authorizes the call.
   * @param method - Supported MCP tool, prompt or resource method.
   * @param params - MCP method parameters.
   * @param signal - Optional native cancellation signal.
   * @returns MCP result; unavailable connections or unsupported methods reject.
   */
  async call(
    id: string,
    session: string,
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<
    Awaited<
      ReturnType<
        Client[
          | 'callTool'
          | 'listTools'
          | 'listPrompts'
          | 'getPrompt'
          | 'listResources'
          | 'readResource'
          | 'listResourceTemplates']
      >
    >
  > {
    const row = await this.record(id),
      live = this.live.get(id),
      disabled = this.sessions.get(session)
    if (!row.enabled || !live || !disabled || disabled.has(id))
      return bad('connector_not_enabled')
    // Keep project identity in MCP request metadata rather than in every tool's
    // visible JSON schema.  A single MCP process can therefore serve multiple
    // conversations without sharing the active document or output directory.
    const p = (
      method === 'tools/call' && params && typeof params === 'object' && !Array.isArray(params)
        ? {
          ...(params as Record<string, unknown>),
          _meta: {
            ...(((params as Record<string, unknown>)._meta as Record<string, unknown> | undefined) ?? {}),
            'actvero/project_id': session,
          },
        }
        : params
    ) as never
    const options = { signal, timeout: 900_000 }
    try {
      switch (method) {
        case 'tools/call':
          return await live.client.callTool(p, undefined, options)
        case 'tools/list':
          return await live.client.listTools(p, options)
        case 'prompts/list':
          return await live.client.listPrompts(p, options)
        case 'prompts/get':
          return await live.client.getPrompt(p, options)
        case 'resources/list':
          return await live.client.listResources(p, options)
        case 'resources/read':
          return await live.client.readResource(p, options)
        case 'resources/templates/list':
          return await live.client.listResourceTemplates(p, options)
        default:
          return bad('invalid_action')
      }
    } catch (e) {
      const code = safeError(e)
      if (code === 'authorization_required') {
        await this.stop(id)
        this.states.set(id, { status: 'authorization_required', error: code })
        this.changed()
      }
      throw new LocalConnectorError(code)
    }
  }
  /**
   * Validate and route one local connector bridge action.
   * @param action - Supported local-prefixed action.
   * @param p - Action-specific renderer input.
   * @returns Action result; invalid actions or inputs reject.
   */
  async dispatch(
    action: string,
    p: Record<string, unknown>,
  ): Promise<Awaited<
    ReturnType<LocalConnectors['list' | 'save' | 'test' | 'authorize' | 'parse' | 'import']>
  > | void> {
    const id = typeof p.id === 'string' ? p.id : undefined
    switch (action) {
      case 'localList':
        await this.restore()
        return this.list()
      case 'localSave':
        return this.save(p.config, id, typeof p.authDraft === 'string' ? p.authDraft : undefined)
      case 'localTest':
        return this.test(p.config, id, typeof p.authDraft === 'string' ? p.authDraft : undefined)
      case 'localAuthorize':
        return this.authorize(p.config, id)
      case 'localCancelAuth':
        return this.cancelAuthorization()
      case 'localDiscard':
        this.drafts.delete(String(p.token))
        return
      case 'localParse':
        return this.parse(p.json as string)
      case 'localImport':
        return this.import(p.token as string, p.indices)
      case 'localEnable':
        if (!id || typeof p.enabled !== 'boolean') return bad()
        await this.enable(id, p.enabled)
        return this.list()
      case 'localRemove':
        if (!id) return bad()
        await this.remove(id)
        return this.list()
      default:
        return bad('invalid_action')
    }
  }
  /** Cancel authorization, close owned clients and discard temporary import and authorization drafts. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.cancelAuthorization()
    await Promise.all(
      [...new Set([...this.live.keys(), ...this.connecting.keys()])].map(id => this.stop(id)),
    )
    this.drafts.clear()
    this.authorized.clear()
  }
}
