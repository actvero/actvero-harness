import { parsePackageOrigin, type PackageOrigin } from './package-origin.ts'
export { ExpertPackages } from './expert-package.ts'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm, readdir, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import type { Expert, ExpertLock, ExpertRuntime, DependencyCatalog } from './contracts.ts'
import { fail, parseExpert, parseManifest, parseBindings, validId } from './schema.ts'
interface ConnectorRow {
  id: string
  name: string
  description: string
  ready: boolean
  inventory?: unknown
}
interface Options {
  remote?: {
    get(id: string): Promise<Expert>
    recent(ids: string[]): Promise<Expert[]>
    prepare(id: string): Promise<{ expert: Expert; remote: import('./remote-contract.ts').RemoteSnapshot }>
    validate(
      p: import('./remote-contract.ts').RemoteSnapshot,
      expert?: Expert,
    ): Promise<{ skills: string[]; connectors: string[] }>
  }
  defaults?: readonly Expert[]
  root: string
  scope(): string | undefined
  changed(): void
  skills: {
    hostList(): Promise<{ id: string; name: string; description: string; versionId: string }[]>
    hostGet(id: string, versionId: string): Promise<unknown>
  }
  connectors(): Promise<ConnectorRow[]>
}
const digest = (v: unknown) =>
  createHash('sha256')
    .update(typeof v === 'string' ? v : JSON.stringify(v))
    .digest('hex')
/** Hash every file in the existing installed package, never execute it or follow symlinks. */
async function fingerprint(skill: SkillDefinition): Promise<string> {
  if (skill.resourceBase?.kind !== 'directory') return digest(skill)
  const hash = createHash('sha256').update(digest(skill))
  let count = 0,
    bytes = 0
  const walk = async (path: string, rel: string) => {
    const st = await lstat(path)
    if (st.isSymbolicLink()) fail('expert_skill_changed')
    if (st.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await walk(join(path, name), rel + '/' + name)
    } else if (st.isFile()) {
      if (++count > 2000 || (bytes += st.size) > 32 * 1024 * 1024) fail('expert_skill_changed')
      hash.update(rel + '\0').update(await readFile(path))
    } else fail('expert_skill_changed')
  }
  await walk(skill.resourceBase.path, '')
  return hash.digest('hex')
}
/** Main-owned expert editing and immutable conversation dependency snapshots. */
export class Experts {
  private queue: Promise<unknown> = Promise.resolve()
  private initialized: Promise<void>
  constructor(private options: Options) {
    this.initialized = this.seedDefaults(options.defaults ?? [])
    this.queue = this.initialized
  }
  private async seedDefaults(defaults: readonly Expert[]): Promise<void> {
    for (const input of defaults) {
      const expert = parseExpert(input),
        id = expert.manifest.id
      try {
        await readFile(this.path('defaults', id))
        continue
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
      try {
        await readFile(this.path('items', id))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        await this.atomic('items', id, { ...expert, revision: 1 })
      }
      await this.atomic('defaults', id, { schemaVersion: 1 })
      this.options.changed()
    }
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const p = this.queue.then(run)
    this.queue = p.catch(() => {})
    return p
  }
  private path(kind: string, id: string) {
    return join(this.options.root, kind, validId(id) + '.json')
  }
  private async atomic(kind: string, id: string, value: unknown) {
    const p = this.path(kind, id)
    await mkdir(join(this.options.root, kind), { recursive: true, mode: 0o700 })
    const temp = p + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' })
      await rename(temp, p)
    } finally {
      await rm(temp, { force: true })
    }
  }
  /**
   * Read local expert records after pending writes complete.
   * @returns Validated local expert records.
   */
  async list(): Promise<Expert[]> {
    await this.queue
    let names: string[]
    try {
      names = await readdir(join(this.options.root, 'items'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
    return Promise.all(
      names
        .filter(n => n.endsWith('.json'))
        .map(async n =>
          this.parseStored(JSON.parse(await readFile(join(this.options.root, 'items', n), 'utf8'))),
        ),
    )
  }
  private async history(): Promise<string[]> {
    try {
      const ids: unknown = JSON.parse(await readFile(this.path('history', 'recent'), 'utf8'))
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) fail('expert_history_invalid')
      return ids
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
  }
  /**
   * Resolve recorded recent experts that remain available in the current account.
   * @returns Recent local and remote experts in use order.
   */
  async recent(): Promise<Expert[]> {
    await this.queue
    const ids = await this.history(),
      items = new Map((await this.list()).map(expert => [expert.manifest.id, expert]))
    for (const e of (await this.options.remote?.recent(ids)) ?? []) items.set(e.manifest.id, e)
    return ids.flatMap((id) => {
      const item = items.get(id)
      return item === undefined ? [] : [item]
    })
  }
  /**
   * Persist a bounded most-recently-used expert history.
   * @param id - Local or account-scoped remote expert identifier.
   */
  recordUse(id: string): Promise<void> {
    return this.serial(async () => {
      await this.get(id)
      const ids = await this.history()
      await this.atomic('history', 'recent', [id, ...ids.filter(old => old !== id)].slice(0, 100))
      this.options.changed()
    })
  }
  /**
   * Read an expert through its local store or current remote account.
   * @param id - Local or account-scoped remote expert identifier.
   * @returns Validated expert; missing or unavailable records reject.
   */
  async get(id: string): Promise<Expert> {
    await this.initialized
    if (id.startsWith('remote-')) return this.options.remote?.get(id) ?? fail('expert_remote_unavailable')
    return this.parseStored(JSON.parse(await readFile(this.path('items', id), 'utf8')))
  }
  private parseStored(value: unknown): Expert {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expert_invalid')
    const { packageOrigin, ...expert } = value as Record<string, unknown>
    if (packageOrigin !== undefined) parsePackageOrigin(packageOrigin)
    return parseExpert(expert)
  }
  /** Read package source identity and digests outside renderer records and conversation locks.
   * @param id - Local expert identifier.
   * @returns The original import baseline, when recorded.
   */
  async packageOrigin(id: string): Promise<PackageOrigin | undefined> {
    const value = JSON.parse(await readFile(this.path('items', id), 'utf8')) as Record<string, unknown>
    this.parseStored(value)
    return value.packageOrigin === undefined ? undefined : parsePackageOrigin(value.packageOrigin)
  }
  /** Atomically publish the reviewed expert and its import baseline.
   * @param input - Expert with its expected local revision.
   * @param origin - Validated package identity and original dependency digests.
   * @returns The saved local expert.
   */
  saveImported(input: Expert, origin: PackageOrigin): Promise<Expert> {
    return this.write(input, parsePackageOrigin(origin))
  }
  /**
   * Persist a validated local expert with optimistic revision checking.
   * @param input - Complete edited expert with its expected revision.
   * @returns Saved expert with advanced revision and, when needed, patch version.
   */
  save(input: unknown): Promise<Expert> { return this.write(input) }
  private write(input: unknown, origin?: PackageOrigin): Promise<Expert> {
    return this.serial(async () => {
      const next = parseExpert(input)
      if (next.manifest.id.startsWith('remote-')) fail('expert_remote_readonly')
      let old: Expert | undefined
      try {
        old = await this.get(next.manifest.id)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
      if (next.revision !== (old?.revision ?? 0)) fail('expert_edit_conflict')
      next.revision++
      if (old && !origin && old.manifest.version === next.manifest.version) {
        const p = next.manifest.version.split('.').map(Number)
        next.manifest.version = `${p[0]}.${p[1]}.${p[2] + 1}`
      }
      const packageOrigin = origin ?? (old ? await this.packageOrigin(old.manifest.id) : undefined)
      await this.atomic('items', next.manifest.id, { ...next, ...(packageOrigin ? { packageOrigin } : {}) })
      this.options.changed()
      return next
    })
  }
  /**
   * Delete the local expert record without removing conversation snapshots or dependencies.
   * @param id - Local expert identifier.
   */
  remove(id: string): Promise<void> {
    return this.serial(async () => {
      await rm(this.path('items', id))
      this.options.changed()
    })
  }
  /**
   * Read reusable skill and connector choices for local dependency binding.
   * @returns Skills and connectors with their current readiness.
   */
  async catalog(): Promise<DependencyCatalog> {
    const [skills, connectors] = await Promise.all([
      this.options.skills.hostList(),
      this.options.connectors(),
    ])
    return {
      skills: skills.map(s => ({ id: s.id, name: s.name, description: s.description, ready: true })),
      connectors: connectors
        .filter(row => !row.id.startsWith('expert-mcp-'))
        .map(({ id, name, description, ready }) => ({ id, name, description, ready })),
    }
  }
  private scope(id: string) {
    return id.startsWith('local-') ? 'local' : digest(this.options.scope() ?? fail('expert_account_changed'))
  }
  /**
   * Verify exact dependencies and persist an immutable conversation snapshot.
   * @param id - Local or account-scoped remote expert identifier.
   * @returns Saved snapshot; missing required dependencies reject and optional gaps become warnings.
   */
  async prepare(id: string): Promise<ExpertLock> {
    const account = this.options.scope()
    const prepared = id.startsWith('remote-') ? await this.options.remote?.prepare(id) : undefined
    if (id.startsWith('remote-') && !prepared) fail('expert_remote_unavailable')
    const expert = prepared?.expert ?? (await this.get(id)),
      skills = await this.options.skills.hostList(),
      connectors = (await this.options.connectors()).filter(
        row => prepared || !row.id.startsWith('expert-mcp-'),
      )
    if (account !== this.options.scope()) fail('expert_account_changed')
    const lock: ExpertLock = {
      ...(prepared ? { remote: prepared.remote } : {}),
      id: randomUUID(),
      expert,
      skills: [],
      connectors: [],
      warnings: [],
    }
    const missing: string[] = []
    for (const req of expert.manifest.skills) {
      const id = expert.bindings.skills[req.key],
        row = skills.find(s => s.id === id)
      try {
        if (!row) throw new Error()
        const versionId =
          prepared?.remote.envelope.dependency_refs.skills.find(r => r.key === req.key)?.version_id ??
          row.versionId
        const scope = this.scope(row.id),
          def = (await this.options.skills.hostGet(row.id, versionId)) as SkillDefinition | undefined
        if (!def) throw new Error()
        lock.skills.push({ key: req.key, id: row.id, versionId, digest: await fingerprint(def), scope })
        if (scope !== this.scope(row.id)) fail('expert_account_changed')
      } catch {
        ;(req.required ? missing : lock.warnings).push(req.label)
      }
    }
    for (const req of expert.manifest.connectors) {
      const id = expert.bindings.connectors[req.key],
        row = connectors.find(s => s.id === id)
      if (!row?.ready || !row.inventory) {
        ;(req.required ? missing : lock.warnings).push(req.label)
        continue
      }
      lock.connectors.push({
        key: req.key,
        id: row.id,
        digest: digest(row.inventory),
        scope: this.scope(row.id),
      })
    }
    if (missing.length)
      throw Object.assign(new Error('expert_dependencies_missing'), {
        code: 'expert_dependencies_missing',
        details: missing,
      })
    const names = await Promise.all(
      lock.skills.map(
        async s => ((await this.options.skills.hostGet(s.id, s.versionId)) as SkillDefinition).name,
      ),
    )
    if (new Set(names).size !== names.length) fail('expert_skill_conflict')
    await this.atomic('snapshots', lock.id, lock)
    try {
      await this.resolve(lock.id)
      return lock
    } catch (e) {
      await rm(this.path('snapshots', lock.id), { force: true })
      throw e
    }
  }
  /** Read required connector declarations independently of temporary connection health.
   * @param id - immutable expert snapshot identifier.
   * @returns Connector rows after validating manifest bindings and account scope.
   */
  async connectorPolicy(
    id: string,
  ): Promise<{ id: string; name: string; description: string; required: boolean }[]> {
    const lock = JSON.parse(await readFile(this.path('snapshots', id), 'utf8')) as ExpertLock,
      expert = parseExpert(lock.expert)
    return lock.connectors.map((row) => {
      const req = expert.manifest.connectors.find(r => r.key === row.key)
      if (!req || row.id !== expert.bindings.connectors[row.key] || row.scope !== this.scope(row.id))
        fail('expert_account_changed')
      return { id: row.id, name: req.label, description: '', required: req.required }
    })
  }
  /**
   * Revalidate a saved snapshot against its account, file digests and live dependencies.
   * @param id - Saved snapshot identifier.
   * @returns Runtime expert content; changed required dependencies reject.
   */
  async resolve(id: string): Promise<ExpertRuntime> {
    const account = this.options.scope()
    const lock = JSON.parse(await readFile(this.path('snapshots', id), 'utf8')) as ExpertLock
    if (
      !lock ||
      lock.id !== id ||
      !Array.isArray(lock.skills) ||
      !Array.isArray(lock.connectors) ||
      !Array.isArray(lock.warnings) ||
      lock.warnings.some(s => typeof s !== 'string')
    )
      fail('expert_snapshot_invalid')
    const expert = parseExpert(lock.expert)
    if (expert.manifest.id.startsWith('remote-') !== !!lock.remote) fail('expert_snapshot_invalid')
    let remoteAllowed: { skills: string[]; connectors: string[] } | undefined
    if (lock.remote) {
      if (!this.options.remote) fail('expert_remote_unavailable')
      remoteAllowed = await this.options.remote.validate(lock.remote, expert)
    }
    const out: ExpertRuntime = {
      snapshotId: id,
      expert: expert.manifest,
      skills: [],
      connectors: [],
      warnings: [...lock.warnings],
    }
    for (const req of expert.manifest.skills) {
      const row = lock.skills.find(s => s.key === req.key)
      try {
        if (
          !row ||
          row.id !== expert.bindings.skills[req.key] ||
          (remoteAllowed && !remoteAllowed.skills.includes(req.key)) ||
          this.scope(row.id) !== row.scope
        )
          throw new Error()
        const def = (await this.options.skills.hostGet(row.id, row.versionId)) as SkillDefinition | undefined
        if (!def || (await fingerprint(def)) !== row.digest || this.scope(row.id) !== row.scope)
          throw new Error()
        out.skills.push({ ...def, load: req.load })
      } catch {
        if (req.required) fail('expert_skill_changed')
        out.warnings.push(req.label)
      }
    }
    const connectors = lock.connectors.length
      ? (await this.options.connectors()).filter(row => lock.remote || !row.id.startsWith('expert-mcp-'))
      : []
    for (const req of expert.manifest.connectors) {
      const row = lock.connectors.find(s => s.key === req.key),
        current = connectors.find(s => s.id === row?.id)
      try {
        if (
          !row ||
          row.id !== expert.bindings.connectors[req.key] ||
          (remoteAllowed && !remoteAllowed.connectors.includes(req.key)) ||
          row.scope !== this.scope(row.id) ||
          !current?.ready ||
          !current.inventory ||
          (!lock.remote && digest(current.inventory) !== row.digest)
        )
          throw new Error()
        out.connectors.push(row.id)
      } catch {
        if (req.required) fail('expert_connector_changed')
        out.warnings.push(req.label)
      }
    }
    if (account !== this.options.scope()) fail('expert_account_changed')
    out.warnings = [...new Set(out.warnings)]
    return out
  }
  /**
   * Check preparation readiness and remove the temporary inspection snapshot.
   * @param id - Local or account-scoped remote expert identifier.
   * @returns Readiness, warnings and missing dependency diagnostics.
   */
  async inspect(id: string): Promise<{ ready: boolean; warnings: string[]; missing: string[] }> {
    try {
      const lock = await this.prepare(id)
      await rm(this.path('snapshots', lock.id), { force: true })
      return { ready: true, warnings: lock.warnings, missing: [] }
    } catch (e) {
      const err = e as { code?: string; details?: string[] }
      return { ready: false, warnings: [], missing: err.details ?? [err.code ?? 'expert_invalid'] }
    }
  }
  /**
   * Validate and route expert editing, import and snapshot bridge actions.
   * @param action - Supported expert action.
   * @param input - Action-specific renderer input.
   * @returns Action result; invalid actions and conflicting writes reject.
   */
  async dispatch(
    action: string,
    input: Record<string, unknown> = {},
  ): Promise<
    | Awaited<
      ReturnType<
        Experts['list' | 'recent' | 'get' | 'catalog' | 'save' | 'inspect' | 'prepare' | 'resolve']
      >
    >
    | Expert['manifest']
    | void
  > {
    switch (action) {
      case 'list':
        return this.list()
      case 'recent':
        return this.recent()
      case 'get':
        return this.get(validId(input.id))
      case 'record-use':
        return this.recordUse(validId(input.id))
      case 'catalog':
        return this.catalog()
      case 'create': {
        const raw = input.expert as Record<string, unknown>
        if (!raw || !raw.manifest) fail('expert_invalid')
        return this.save({ ...raw, revision: 0, manifest: { ...(raw.manifest as object), id: randomUUID() } })
      }
      case 'save':
        return this.save(input.expert)
      case 'remove':
        return this.remove(validId(input.id))
      case 'check':
        return this.inspect(validId(input.id))
      case 'export':
        return (await this.get(validId(input.id))).manifest
      case 'import': {
        const manifest = parseManifest(input.manifest)
        manifest.id = randomUUID()
        const bindings = parseBindings(input.bindings ?? { skills: {}, connectors: {} }, manifest)
        const catalog = await this.catalog()
        for (const kind of ['skills', 'connectors'] as const)
          for (const id of Object.values(bindings[kind]))
            if (!catalog[kind].some(row => row.id === id)) fail('expert_dependencies_missing')
        return this.save({ manifest, revision: 0, bindings })
      }
      case 'prepare':
        return this.prepare(validId(input.id))
      case 'resolve':
        return this.resolve(validId(input.id))
      default:
        return fail('expert_invalid_action')
    }
  }
}
