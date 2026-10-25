import type { InstalledSkillDefinition } from './contracts.ts'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import { LocalSkills } from './local.ts'
import { mkdir, readFile, writeFile, rename, rm, lstat, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { digest, fail, parseSkill, safePath, SkillError, unpack, uuid } from './package.ts'
import type {
  Catalog,
  Category,
  Identity,
  Installed,
  LocalState,
  ResourceToken,
  Skill,
  SkillDetail,
  SkillFile,
} from './contracts.ts'
export { SkillError } from './package.ts'
interface RecordEntry extends Installed {
  directory: string
  entrypoint: string
  files: SkillFile[]
}
interface Options {
  root: string
  identity(): Identity | undefined
  issue(resource: string): Promise<ResourceToken>
  changed(reason?: 'identity'): void
  syncHost(name?: string, skillId?: string): Promise<void>
  fetcher?: typeof fetch
  openExternal?(url: string): Promise<void>
}
/** Main-owned platform skill installation and exact-version access with device-local imports. */
export class Skills {
  private token?: ResourceToken & { until: number }
  private tokenFlight?: Promise<ResourceToken>
  private tokenAfter = 0
  private epoch = 0
  private key = ''
  private blocked = false
  private records?: RecordEntry[]
  private loading?: Promise<RecordEntry[]>
  private queue: Promise<unknown> = Promise.resolve()
  private busy = new Set<string>()
  private checkFailed = false
  private active = new Set<AbortController>()
  /** Local import manager independent of platform account availability. */
  readonly local: LocalSkills
  constructor(private options: Options) {
    this.local = new LocalSkills({
      root: join(options.root, 'local'),
      changed: options.changed,
      syncHost: options.syncHost,
    })
  }
  /** Abort account requests and clear cached authority and installation views. */
  invalidate(): void {
    this.epoch++
    this.key = ''
    this.records = undefined
    this.loading = undefined
    this.token = undefined
    this.tokenFlight = undefined
    this.tokenAfter = 0
    this.checkFailed = false
    this.blocked = false
    this.busy.clear()
    for (const controller of this.active) controller.abort()
    this.active.clear()
    this.options.changed('identity')
  }
  private identity() {
    const value = this.options.identity()
    if (!value) return fail('reauthentication_required')
    if (!value.available) return fail('skills_unavailable')
    if (this.key !== value.key) {
      this.invalidate()
      this.key = value.key
    }
    if (this.blocked) return fail('reauthentication_required')
    return value
  }
  private scope() {
    const identity = this.identity()
    return { identity, epoch: this.epoch, root: join(this.options.root, digest(identity.key)) }
  }
  private guard(scope: ReturnType<Skills['scope']>) {
    if (
      scope.epoch !== this.epoch ||
      this.options.identity()?.key !== scope.identity.key ||
      !this.options.identity()?.available
    )
      fail('account_changed')
  }
  private async entries(scope = this.scope()): Promise<RecordEntry[]> {
    this.guard(scope)
    if (this.records) return this.records
    if (!this.loading)
      this.loading = (async () => {
        let value: unknown
        try {
          value = JSON.parse(await readFile(join(scope.root, 'installed.json'), 'utf8'))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return fail('local_state_invalid')
          value = []
        }
        if (
          !Array.isArray(value) ||
          value.some(
            x =>
              !x ||
              !uuid(x.skill?.id) ||
              !uuid(x.version?.id) ||
              !/^[a-f0-9]{64}$/.test(x.version?.sha256) ||
              !/^(?:packages\/[a-f0-9-]{36}\/[a-f0-9-]{36}|p\/[a-f0-9]{32})$/.test(x.directory) ||
              !Array.isArray(x.files) ||
              typeof x.enabled !== 'boolean' ||
              !['current', 'update_available', 'unavailable'].includes(x.status),
          )
        )
          return fail('local_state_invalid')
        if (new Set(value.map(x => x.skill.id)).size !== value.length) return fail('local_state_invalid')
        for (const item of value) {
          safePath(item.entrypoint)
          for (const file of item.files) safePath(file.path)
        }
        this.guard(scope)
        this.records = value
        return this.records
      })()
    try {
      return await this.loading
    } finally {
      if (scope.epoch === this.epoch) this.loading = undefined
    }
  }
  private async persist(scope: ReturnType<Skills['scope']>) {
    this.guard(scope)
    await mkdir(scope.root, { recursive: true, mode: 0o700 })
    const temp = join(scope.root, `installed-${randomUUID()}.tmp`)
    await writeFile(temp, JSON.stringify(this.records), { mode: 0o600, flag: 'wx' })
    try {
      this.guard(scope)
      await rename(temp, join(scope.root, 'installed.json'))
    } finally {
      await rm(temp, { force: true })
    }
  }
  private async resource(scope: ReturnType<Skills['scope']>) {
    this.guard(scope)
    if (this.tokenAfter > Date.now()) return fail('rate_limited')
    if (this.token && this.token.until > Date.now() + 15000) return this.token
    if (!this.tokenFlight) {
      this.tokenFlight = this.options.issue('skills:catalog').then((token) => {
        this.guard(scope)
        const expected = new URL('/api/v1/desktop/skills', scope.identity.baseUrl)
        if (
          token.resource !== 'skills:catalog' ||
          token.token_type.toLowerCase() !== 'bearer' ||
          !token.access_token ||
          token.endpoint !== expected.href ||
          !token.scope.split(' ').includes('skills:read') ||
          !token.scope.split(' ').includes('skills:download') ||
          token.expires_in <= 0 ||
          token.expires_in > 600
        )
          return fail('invalid_resource_response')
        this.token = { ...token, until: Date.now() + token.expires_in * 1000 }
        return token
      })
    }
    const flight = this.tokenFlight
    try {
      return await flight
    } finally {
      if (this.tokenFlight === flight) this.tokenFlight = undefined
    }
  }
  private async request(path: string, body?: unknown, retry = true): Promise<Response> {
    const scope = this.scope(),
      token = await this.resource(scope)
    this.guard(scope)
    const controller = new AbortController()
    this.active.add(controller)
    const timer = setTimeout(() => controller.abort(), 45000)
    try {
      const response = await (this.options.fetcher ?? fetch)(token.endpoint + path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      this.guard(scope)
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: { code?: string } } | null
        const code = data?.error?.code ?? `http_${response.status}`
        if (response.status === 429) {
          const header = response.headers.get('Retry-After') ?? '60'
          const seconds = Number(header)
          this.tokenAfter = Number.isFinite(seconds)
            ? Date.now() + Math.max(1, seconds) * 1000
            : Math.max(Date.now() + 1000, Date.parse(header) || Date.now() + 60000)
        }
        if (code === 'resource_token_expired' && retry) {
          this.token = undefined
          return this.request(path, body, false)
        }
        if (
          [
            'device_revoked',
            'session_expired',
            'reauthentication_required',
            'member_suspended',
            'member_removed',
            'organization_unavailable',
          ].includes(code)
        ) {
          this.invalidate()
          this.key = scope.identity.key
          this.records = []
          this.blocked = true
        }
        return fail(/^[a-z_0-9]{1,80}$/.test(code) ? code : 'request_failed')
      }
      // Consume while the timeout and identity cancellation still cover the body.
      const limit = path.endsWith('/download') ? 20 * 1024 * 1024 : 12 * 1024 * 1024
      if (Number(response.headers.get('content-length')) > limit) return fail('response_too_large')
      const reader = response.body?.getReader()
      if (!reader) return fail('invalid_response')
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > limit) {
          await reader.cancel()
          return fail('response_too_large')
        }
        chunks.push(value)
      }
      this.guard(scope)
      return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers })
    } catch (error) {
      if (error instanceof SkillError) throw error
      return fail(controller.signal.aborted ? 'request_cancelled' : 'network_unavailable')
    } finally {
      clearTimeout(timer)
      this.active.delete(controller)
    }
  }
  private async json<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.request(path, body)
    try {
      return (await response.json()) as T
    } catch {
      return fail('invalid_response')
    }
  }
  /**
   * Combine local installations with the selected platform account state.
   * @returns Installation view including busy operations and update-check status.
   */
  async state(): Promise<LocalState> {
    const local = await this.local.state()
    if (!this.options.identity()?.available || this.blocked)
      return { available: false, items: local, busy: [], checkFailed: false }
    const scope = this.scope(),
      records = await this.entries(scope)
    this.guard(scope)
    return {
      scope: digest(scope.identity.key),
      available: true,
      items: [
        ...local,
        ...records.map(({ skill, version, enabled, status }) => ({ skill, version, enabled, status })),
      ],
      busy: [...this.busy],
      checkFailed: this.checkFailed,
    }
  }
  /**
   * Read a page of authorized platform skills.
   * @param q - Search text.
   * @param category - Optional category identifier.
   * @param page - One-based page number.
   * @returns Platform skill catalog page.
   */
  async catalog(q = '', category = '', page = 1): Promise<Catalog> {
    const p = new URLSearchParams({ q, page: String(page) })
    if (category) p.set('category', category)
    return this.json<Catalog>(`?${p}`)
  }
  /**
   * Read platform category counts matching a search.
   * @param q - Search text.
   * @returns Available category rows.
   */
  async categories(q = ''): Promise<Category[]> {
    return this.json<Category[]>(`/categories?${new URLSearchParams({ q })}`)
  }
  /**
   * Read local or authorized platform skill details, optionally for an exact expert dependency.
   * @param id - Local or platform skill identifier.
   * @param versionId - Optional exact platform version.
   * @param expert - Optional expert release authorizing the dependency.
   * @returns Skill details; inaccessible platform content rejects.
   */
  async detail(
    id: string,
    versionId?: string,
    expert?: { expert_id: string; expert_release_id: string },
  ): Promise<SkillDetail> {
    if (id.startsWith('local-')) return this.local.detail(id)
    if (!uuid(id)) return fail('invalid_input')
    return this.json<SkillDetail>(
      `/${id}?${new URLSearchParams({ access_version: '2', ...(versionId ? { version_id: versionId } : {}), ...(expert ?? {}) })}`,
    )
  }
  /**
   * Read a previewable platform file from an exact skill version.
   * @param id - Platform skill UUID.
   * @param version - Platform version UUID.
   * @param path - Validated relative archive member path.
   * @returns File path and preview content.
   */
  async file(id: string, version: string, path: string): Promise<{ path: string; content: string }> {
    if (!uuid(id) || !uuid(version)) return fail('invalid_input')
    safePath(path)
    return this.json<{ path: string; content: string }>(
      `/${id}/file?${new URLSearchParams({ version_id: version, path })}`,
    )
  }
  private mutate<T>(id: string, work: (scope: ReturnType<Skills['scope']>) => Promise<T>): Promise<T> {
    const scope = this.scope()
    if (this.busy.has(id)) return Promise.reject(new SkillError('operation_in_progress'))
    this.busy.add(id)
    this.options.changed()
    const task = this.queue
      .catch(() => {})
      .then(() => {
        this.guard(scope)
        return work(scope)
      })
    this.queue = task
    return task.finally(() => {
      if (scope.epoch === this.epoch) {
        this.busy.delete(id)
        this.options.changed()
      }
    })
  }
  private async unchanged(scope: ReturnType<Skills['scope']>, item: RecordEntry) {
    const root = join(scope.root, item.directory)
    const expected = new Set(item.files.filter(f => !f.path.endsWith('/')).map(f => f.path))
    const walk = async (dir: string, prefix = ''): Promise<void> => {
      if ((await lstat(dir)).isSymbolicLink()) return fail('local_changes')
      for (const file of await readdir(dir, { withFileTypes: true })) {
        const path = prefix + file.name
        if (file.isSymbolicLink()) return fail('local_changes')
        if (file.isDirectory()) await walk(join(dir, file.name), path + '/')
        else if (!file.isFile() || !expected.has(path)) return fail('local_changes')
      }
    }
    try {
      await walk(root)
    } catch (error) {
      if (error instanceof SkillError) throw error
      return fail('local_changes')
    }
    for (const file of item.files) {
      if (file.path.endsWith('/')) continue
      const target = join(root, safePath(file.path))
      try {
        let current = root
        for (const part of file.path.split('/')) {
          current = join(current, part)
          if ((await lstat(current)).isSymbolicLink()) return fail('local_changes')
        }
        if (digest(await readFile(target)) !== file.sha256) return fail('local_changes')
      } catch (error) {
        if (error instanceof SkillError) throw error
        return fail('local_changes')
      }
    }
  }
  /**
   * Download, verify and adopt an exact platform skill version before committing its installation.
   * @param id - Platform skill UUID.
   * @param versionId - Exact version UUID.
   * @param sha256 - Expected archive SHA256.
   * @param expert - Optional expert release authorizing the dependency.
   * @param activate - Whether to replace an existing active version; false retains it for expert reuse.
   * @returns Updated installation state; validation or synchronization failures reject.
   */
  async install(
    id: string,
    versionId: string,
    sha256: string,
    expert?: { expert_id: string; expert_release_id: string },
    activate = true,
  ): Promise<LocalState> {
    if (!uuid(id) || !uuid(versionId) || !/^[a-f0-9]{64}$/.test(sha256)) return fail('invalid_input')
    return this.mutate(id, async (scope) => {
      const records = await this.entries(scope),
        detail = await this.detail(id, versionId, expert)
      this.guard(scope)
      if (detail.current_version.id !== versionId || detail.current_version.sha256 !== sha256)
        return fail('skill_version_changed')
      const old = records.find(r => r.skill.id === id)
      if ((await this.local.state()).some(r => r.skill.name === detail.name))
        return fail('skill_name_conflict')
      if (
        ['compact', 'export', 'feedback', 'goal', 'permission', 'plan', 'model'].includes(detail.name) ||
        records.some(r => r.skill.id !== id && r.skill.name === detail.name)
      )
        return fail('skill_name_conflict')
      if (old && activate) await this.unchanged(scope, old)
      await this.options.syncHost(detail.name, id)
      this.guard(scope) // probe collisions before any download
      const response = await this.request(`/${id}/download`, {
        access_version: 2,
        version_id: versionId,
        sha256,
        ...(expert ?? {}),
      })
      if (
        response.headers.get('content-type')?.split(';')[0] !== 'application/zip' ||
        response.headers.get('x-content-sha256') !== sha256 ||
        response.headers.get('x-skill-version-id') !== versionId
      )
        return fail('package_checksum_mismatch')
      const files = unpack(new Uint8Array(await response.arrayBuffer()), detail)
      this.guard(scope)
      const directory = `p/${randomUUID().replaceAll('-', '')}`,
        destination = join(scope.root, directory),
        staged = destination + '.staging'
      let committed = false
      try {
        await mkdir(staged, { recursive: true, mode: 0o700 })
        for (const [path, data] of files) {
          this.guard(scope)
          const target = join(staged, path)
          await mkdir(dirname(target), { recursive: true, mode: 0o700 })
          await writeFile(target, data, { flag: 'wx', mode: 0o600 })
        }
        this.guard(scope)
        await rename(staged, destination)
        const item: RecordEntry = {
          skill: detail,
          version: detail.current_version,
          enabled: old?.enabled ?? true,
          status: 'current',
          directory,
          entrypoint: detail.entrypoint,
          files: detail.files,
        }
        // Retain an addressable immutable package per version; active discovery is separate.
        const archive = join(scope.root, 'versions', id, versionId + '.json')
        await mkdir(dirname(archive), { recursive: true, mode: 0o700 })
        await this.json(`/${id}/adopt`, {
          access_version: 2,
          version_id: versionId,
          sha256,
          ...(expert ?? {}),
          request_id: this.adoptionId(scope.identity.key, id, versionId, expert),
        })
        this.guard(scope)
        if (old) {
          const oldArchive = join(scope.root, 'versions', id, old.version.id + '.json')
          await mkdir(dirname(oldArchive), { recursive: true, mode: 0o700 })
          await this.atomicArchive(oldArchive, old)
        }
        await this.atomicArchive(archive, item)
        this.records = !activate && old ? records : [...records.filter(r => r.skill.id !== id), item]
        await this.options.syncHost()
        this.guard(scope)
        await this.persist(scope)
        committed = true
        // Retain previous immutable version for recovery. It is outside discovery roots.
        return await this.state()
      } catch (error) {
        if (scope.epoch === this.epoch) {
          this.records = records
          await this.options.syncHost().catch(() => {})
        }
        throw error
      } finally {
        await rm(staged, { recursive: true, force: true })
        if (!committed) await rm(destination, { recursive: true, force: true })
      }
    })
  }
  private async atomicArchive(path: string, item: RecordEntry) {
    const temp = path + '.' + randomUUID()
    try {
      await writeFile(temp, JSON.stringify(item), { flag: 'wx', mode: 0o600 })
      await rename(temp, path)
    } finally {
      await rm(temp, { force: true })
    }
  }
  /**
   * Check a retained exact version and verify its installed files.
   * @param id - Platform skill UUID.
   * @param versionId - Exact version UUID.
   * @param sha256 - Expected archive SHA256.
   * @returns Whether the matching version exists; modified files reject.
   */
  async hasVersion(id: string, versionId: string, sha256: string): Promise<boolean> {
    if (!uuid(id) || !uuid(versionId)) return false
    const scope = this.scope(),
      records = await this.entries(scope)
    let item = records.find(r => r.skill.id === id && r.version.id === versionId)
    if (!item) {
      try {
        item = JSON.parse(
          await readFile(join(scope.root, 'versions', id, versionId + '.json'), 'utf8'),
        ) as RecordEntry
      } catch {
        return false
      }
    }
    if (
      item.skill.id !== id ||
      item.version.id !== versionId ||
      item.version.sha256 !== sha256 ||
      !/^(?:packages\/[a-f0-9-]{36}\/[a-f0-9-]{36}|p\/[a-f0-9]{32})$/.test(item.directory)
    )
      return false
    await this.unchanged(scope, item)
    this.guard(scope)
    return true
  }
  /**
   * Persist platform installation enablement and synchronize native discovery.
   * @param id - Installed platform skill UUID.
   * @param enabled - Whether the installation is enabled.
   * @returns Updated installation state.
   */
  async enable(id: string, enabled: boolean): Promise<LocalState> {
    return this.mutate(id, async (scope) => {
      const records = await this.entries(scope),
        item = records.find(r => r.skill.id === id)
      if (!item) return fail('skill_not_installed')
      if (enabled && item.status === 'unavailable') return fail('skill_unavailable')
      if (enabled) await this.options.syncHost(item.skill.name, id)
      this.records = records.map(r => (r === item ? { ...r, enabled } : r))
      try {
        await this.options.syncHost()
        this.guard(scope)
        await this.persist(scope)
      } catch (error) {
        if (scope.epoch === this.epoch) {
          this.records = records
          await this.options.syncHost().catch(() => {})
        }
        throw error
      }
      return this.state()
    })
  }
  /**
   * Remove an unchanged active platform installation after updating native discovery.
   * @param id - Installed platform skill UUID.
   * @returns Updated installation state.
   */
  async uninstall(id: string): Promise<LocalState> {
    return this.mutate(id, async (scope) => {
      const records = await this.entries(scope),
        item = records.find(r => r.skill.id === id)
      if (!item) return fail('skill_not_installed')
      await this.unchanged(scope, item)
      this.guard(scope)
      this.records = records.filter(r => r !== item)
      try {
        await this.options.syncHost()
        this.guard(scope)
        await this.persist(scope)
      } catch (error) {
        if (scope.epoch === this.epoch) {
          this.records = records
          await this.options.syncHost().catch(() => {})
        }
        throw error
      }
      await rm(join(scope.root, item.directory), { recursive: true, force: true })
      return this.state()
    })
  }
  /**
   * Refresh installed release availability and preserve authoritative withdrawals after partial failure.
   * @returns Updated installation state; failed checks reject and mark checkFailed.
   */
  async checkUpdates(): Promise<LocalState> {
    return this.mutate('check', async (scope) => {
      const records = await this.entries(scope)
      if (!records.length) return this.state()
      const updates = new Map<
        string,
        { status: Installed['status']; skill: Skill | null; adopted_usable?: boolean }
      >()
      try {
        for (let i = 0; i < records.length; i += 100) {
          const result = await this.json<{
            items: {
              skill_id: string
              status: Installed['status']
              skill: Skill | null
              adopted_usable?: boolean
            }[]
          }>('/check-updates', {
            access_version: 2,
            items: records
              .slice(i, i + 100)
              .map(r => ({ skill_id: r.skill.id, version_id: r.version.id, sha256: r.version.sha256 })),
          })
          for (const row of result.items) {
            if (!['current', 'update_available', 'unavailable'].includes(row.status))
              return fail('invalid_response')
            updates.set(row.skill_id, {
              ...row,
              status: row.adopted_usable === false ? 'unavailable' : row.status,
            })
          }
        }
        if (updates.size !== records.length)
          return fail('invalid_response')
        this.guard(scope)
        this.records = records.map((r) => {
          const row = updates.get(r.skill.id)
          if (row === undefined) return fail('invalid_response')
          return { ...r, skill: row.skill ?? r.skill, status: row.status }
        })
        await this.options.syncHost()
        this.guard(scope)
        await this.persist(scope)
        this.checkFailed = false
      } catch (error) {
        if (scope.epoch !== this.epoch) throw error
        // A confirmed withdrawal must remain disabled even if another batch,
        // registry synchronization or persistence failed afterwards.
        this.records = records.map(r =>
          updates.get(r.skill.id)?.status === 'unavailable' ? { ...r, status: 'unavailable' as const } : r,
        )
        if (this.records.some((r, i) => r.status !== records[i].status))
          await this.persist(scope).catch(() => {})
        await this.options.syncHost().catch(() => {})
        this.checkFailed = true
        throw error
      }
      return this.state()
    })
  }
  /**
   * List usable local and platform installations after current authorization checks.
   * @param ids - Restrict discovery to these installations; omitted lists every enabled installation.
   * @returns Native skill candidates with exact version identifiers.
   */
  async hostList(ids?: readonly string[]): Promise<
    {
      id: string
      name: string
      description: string
      versionId: string
      invocation: SkillDefinition['invocation']
    }[]
  > {
    const local = await this.local.hostList(ids)
    if (ids?.every(id => id.startsWith('local-'))) return local
    if (!this.options.identity()?.available || this.blocked) return local
    const scope = this.scope(),
      records = await this.entries(scope),
      rows = []
    for (const r of records.filter(r => r.enabled && r.status !== 'unavailable' && (!ids || ids.includes(r.skill.id)))) {
      const skill = await this.hostGet(r.skill.id, r.version.id)
      if (skill)
        rows.push({
          id: r.skill.id,
          name: r.skill.name,
          description: skill.description,
          versionId: r.version.id,
          invocation: skill.invocation,
        })
    }
    this.guard(scope)
    return [...local, ...rows]
  }
  private adoptionId(
    owner: string,
    id: string,
    version: string,
    expert?: { expert_id: string; expert_release_id: string },
  ) {
    const h = digest([owner, id, version, expert?.expert_id ?? '', expert?.expert_release_id ?? ''].join('|'))
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
  }
  /**
   * Verify current grants and file contents for an enabled exact skill version.
   * @param id - Local or platform skill identifier.
   * @param versionId - Exact installed version identifier.
   * @returns Native skill definition, or undefined for an absent or disabled version.
   */
  async hostGet(id: string, versionId: string): Promise<InstalledSkillDefinition | undefined> {
    if (id.startsWith('local-')) return this.local.hostGet(id, versionId)
    const scope = this.scope(),
      records = await this.entries(scope)
    if (!uuid(id) || !uuid(versionId)) return fail('invalid_input')
    const active = records.find(r => r.skill.id === id && r.enabled && r.status !== 'unavailable')
    if (!active) return undefined
    let item = active.version.id === versionId ? active : undefined
    if (!item) {
      try {
        item = JSON.parse(
          await readFile(join(scope.root, 'versions', id, versionId + '.json'), 'utf8'),
        ) as RecordEntry
      } catch {
        return undefined
      }
    }
    if (
      item.skill.id !== id ||
      item.version.id !== versionId ||
      !/^(?:packages\/[a-f0-9-]{36}\/[a-f0-9-]{36}|p\/[a-f0-9]{32})$/.test(item.directory)
    )
      return fail('local_state_invalid')
    // Current grants and withdrawal still apply to a retained adopted package.
    const live = await this.detail(id, versionId)
    if (live.current_version.sha256 !== item.version.sha256) return fail('skill_unavailable')
    await this.unchanged(scope, item)
    if (!item) return undefined
    const path = join(scope.root, item.directory, safePath(item.entrypoint))
    let parent = scope.root
    for (const part of (item.directory + '/' + item.entrypoint).split('/')) {
      parent = join(parent, part)
      if ((await lstat(parent)).isSymbolicLink()) return fail('invalid_skill')
    }
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024) return fail('invalid_skill')
    const parsed = parseSkill(await readFile(path, 'utf8'), item.skill.name)
    this.guard(scope)
    return {
      ...parsed,
      source: 'actvero',
      provider: 'actvero-skills',
      path,
      resourceBase: { kind: 'directory', path: dirname(path) },
    }
  }
  /**
   * Validate and route skill catalog, installation and preview bridge actions.
   * @param action - Supported skill action.
   * @param input - Action-specific renderer fields.
   * @returns Action result; invalid inputs and unavailable resources reject.
   */
  async dispatch(action: string, input: Record<string, unknown> = {}): Promise<unknown> {
    const text = (key: string, max = 100) => {
      const value = input[key]
      if (value !== undefined && (typeof value !== 'string' || value.length > max))
        return fail('invalid_input')
      return (value ?? '') as string
    }
    switch (action) {
      case 'openLink': {
        let url: URL
        try {
          url = new URL(text('url', 2048))
        } catch {
          return fail('invalid_input')
        }
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          !this.options.openExternal
        )
          return fail('invalid_input')
        await this.options.openExternal(url.href)
        return
      }
      case 'state':
        return this.state()
      case 'catalog': {
        const page = input.page ?? 1
        if (!Number.isInteger(page) || Number(page) < 1) return fail('invalid_input')
        return this.catalog(text('q'), text('category'), Number(page))
      }
      case 'categories':
        return this.categories(text('q'))
      case 'detail':
        return this.detail(text('id'))
      case 'file':
        return this.file(text('id'), text('version_id'), text('path', 500))
      case 'install':
        return this.install(text('id'), text('version_id'), text('sha256'))
      case 'localImport':
        await this.local.install(text('token'))
        return this.state()
      case 'localDiscard':
        this.local.discard(text('token'))
        return
      case 'enable':
        if (text('id').startsWith('local-')) {
          if (typeof input.enabled !== 'boolean') return fail('invalid_input')
          await this.local.enable(text('id'), input.enabled)
          return this.state()
        }
        if (typeof input.enabled !== 'boolean' || !uuid(input.id)) return fail('invalid_input')
        return this.enable(input.id, input.enabled)
      case 'uninstall':
        if (text('id').startsWith('local-')) {
          await this.local.uninstall(text('id'))
          return this.state()
        }
        if (!uuid(input.id)) return fail('invalid_input')
        return this.uninstall(input.id)
      case 'check':
        return this.checkUpdates()
      default:
        return fail('invalid_action')
    }
  }
}
