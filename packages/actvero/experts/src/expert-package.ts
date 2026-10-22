import type { PackageOrigin } from './package-origin.ts'
/** Main-owned single-expert archive staging and installation. */
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Expert, ExpertManifest, Bindings } from './contracts.ts'
import { parseManifest, fail } from './schema.ts'
const hash = (v: Uint8Array | string) => createHash('sha256').update(v).digest('hex')
const canonical = (v: unknown): string => JSON.stringify(v, (_key: string, value: unknown): unknown => value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
const filesHash = (files: Map<string, Uint8Array>) => hash(canonical(
  [...files].map(([path, bytes]) => ({ path, size: bytes.length, sha256: hash(bytes) }))
    .sort((a, b) => a.path.localeCompare(b.path)),
))
const requiredValue = <T>(value: T | undefined): T => value ?? fail('expert_package_changed')
const sha = z.string().regex(/^[a-f0-9]{64}$/), key = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)
const reference = z.object({ key, source: z.enum(['local', 'platform']), path: z.string().max(500).optional(), id: z.string().max(128).optional(), versionId: z.string().max(128).optional(), sha256: sha.optional(), platform: z.string().max(2048).optional() }).strict()
const deps = z.object({ schemaVersion: z.literal(1), skills: z.array(reference).max(32), connectors: z.array(reference).max(32) }).strict()
type Ref = z.infer<typeof reference>
/** Import preview dependency outcome; conflicts never overwrite an installation. */
export interface PackageRow {
  kind: 'skills' | 'connectors'
  key: string
  name: string
  required: boolean
  status: 'reuse' | 'install' | 'update' | 'conflict' | 'authorization'
  id?: string
  digest?: string
  versionId?: string
  nameOverride?: string
  managed?: boolean
}
/** Bounded renderer-safe plan; the opaque token retains archive bytes in Main. */
export interface ExpertPackagePreview {
  token: string
  name: string
  description: string
  rows: PackageRow[]
  canImport: boolean
  operation: 'install' | 'update' | 'current' | 'conflict'
  version: string
  previousVersion?: string
  targetId?: string
  revision?: number
  legacy?: boolean
  reason?: 'local_changes' | 'version' | 'ambiguous'
}
interface SkillRow {
  skill: {
    id: string
    name: string
    source?: string
  }
  version: {
    id: string
    sha256: string
  }
  enabled: boolean
  status: string
}
/** Main-only adapters reuse the installed capability authorities; no renderer paths or credentials. */
export interface PackageAdapters {
  unpack(bytes: Uint8Array): Map<string, Uint8Array>
  pack(files: Map<string, Uint8Array>): Uint8Array
  platform(): string | undefined
  scope(): string | undefined
  skills: {
    state(): Promise<{
      items: SkillRow[]
    }>
    preview(files: Map<string, Uint8Array>, name: string): Promise<{
      token: string
      skill: {
        id: string
        name: string
        current_version: {
          id: string
        }
      }
    }>
    install(token: string, replace?: {
      id: string
      versionId: string
    }): Promise<unknown>
    restore(id: string, expectedVersion: string, versionId: string): Promise<void>
    discard(token: string): void
    remove(id: string): Promise<void>
    files(id: string): Promise<Map<string, Uint8Array>>
    authorized(id: string, versionId: string): Promise<boolean>
  }
  connectors: {
    list(): Promise<{
      id: string
      name: string
    }[]>
    template(input: unknown): unknown
    portable(id: string): Promise<unknown>
    save(input: unknown): Promise<{
      id: string
    }>
    remove(id: string): Promise<void>
    authorized(id: string, digest: string): Promise<boolean>
    fingerprint(id: string): Promise<string>
    /** Resolve a desktop-managed capability. `restore` is set only for an explicit package import. */
    firstParty?(key: string, name: string, restore?: boolean): Promise<string | undefined>
  }
}
interface Pending {
  manifest: ExpertManifest
  refs: z.infer<typeof deps>
  files: Map<string, Uint8Array>
  plan: ExpertPackagePreview
  until: number
  platform?: string
  scope?: string
}
/** Single-expert portable package, with bounded staging, exact reuse and credentials-free templates. */
export class ExpertPackages {
  private pending = new Map<string, Pending>()
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private experts: {
    list(): Promise<Expert[]>
    get(id: string): Promise<Expert>
    packageOrigin(id: string): Promise<PackageOrigin | undefined>
    saveImported(expert: Expert, origin: PackageOrigin): Promise<Expert>
  }, private a: PackageAdapters) { }
  private json(files: Map<string, Uint8Array>, path: string): unknown { const bytes = files.get(path); if (!bytes || bytes.length > 700000)
    fail('expert_package_invalid'); try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return value
  }
  catch {
    return fail('expert_package_invalid')
  } }
  private async target(manifest: ExpertManifest) {
    const all = await this.experts.list()
    const tracked = await Promise.all(all.map(async expert => ({
      expert, origin: await this.experts.packageOrigin(expert.manifest.id),
    })))
    const matches = tracked.filter(row => row.origin?.sourceId === manifest.id)
    const legacy = matches.length ? [] : tracked.filter(row => !row.origin && row.expert.manifest.name === manifest.name)
    const candidates = matches.length ? matches : legacy
    return { all, target: candidates.length === 1 ? candidates[0] : undefined, ambiguous: candidates.length > 1 }
  }
  private snapshot(expert: Expert) { return hash(canonical({ manifest: expert.manifest, bindings: expert.bindings })) }
  private compareVersion(a: string, b: string) {
    const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt)
    for (let i = 0; i < 3; i++)
      if (left[i] !== right[i])
        return requiredValue(left[i]) > requiredValue(right[i]) ? 1 : -1
    return 0
  }
  private async plan(p: Pending): Promise<ExpertPackagePreview> {
    const installed = await this.a.skills.state(), connections = await this.a.connectors.list(), rows: PackageRow[] = []
    const { all, target, ambiguous } = await this.target(p.manifest)
    const previous = target?.expert, origin = target?.origin
    const localChanges = !!(previous && origin && origin.snapshot !== this.snapshot(previous))
    for (const kind of ['skills', 'connectors'] as const)
      for (const req of p.manifest[kind]) {
        const ref = p.refs[kind].find(r => r.key === req.key), row: PackageRow = { kind, key: req.key, name: req.label, required: req.required, status: 'authorization' }
        if (kind === 'connectors' && req.key === 'freecad-mcp' && !ref) {
          const firstParty = await this.a.connectors.firstParty?.(req.key, req.label, true)
          if (firstParty) {
            row.status = 'reuse'
            row.id = firstParty
            row.managed = true
          }
          rows.push(row)
          continue
        }
        if (ref?.source === 'platform') {
          if (ref.platform === this.a.platform() && ref.id && ref.sha256) {
            if (kind === 'skills') {
              const match = installed.items.find(s => s.skill.id === ref.id && s.version.id === ref.versionId && s.version.sha256 === ref.sha256 && s.enabled && s.status !== 'unavailable')
              if (match && await this.a.skills.authorized(match.skill.id, match.version.id)) {
                row.status = 'reuse'
                row.id = match.skill.id
                row.digest = ref.sha256
              }
            }
            else if (await this.a.connectors.authorized(ref.id, ref.sha256)) {
              row.status = 'reuse'
              row.id = ref.id
              row.digest = ref.sha256
            }
          }
        }
        else if (ref?.path) {
          const boundId = previous?.bindings[kind][req.key], baseline = origin?.dependencies[kind][req.key]
          if (kind === 'skills') {
            const embedded = this.embedded(p.files, ref.path), preview = await this.a.skills.preview(embedded, ref.path)
            this.a.skills.discard(preview.token)
            row.digest = filesHash(embedded)
            const existing = installed.items.find(s => s.skill.source === 'local' && (boundId ? s.skill.id === boundId : s.skill.name === preview.skill.name))
            if (!existing)
              row.status = 'install'
            else {
              row.status = 'conflict'
              row.id = existing.skill.id
              row.versionId = existing.version.id
              try {
                const digest = filesHash(await this.a.skills.files(existing.skill.id))
                if (digest === row.digest && existing.enabled)
                  row.status = 'reuse'
                else if (boundId === existing.skill.id && existing.skill.name === preview.skill.name && existing.enabled &&
                                    (!baseline || baseline.id === existing.skill.id && baseline.digest === digest) &&
                                    !all.some(e => e.manifest.id !== previous?.manifest.id
                    && Object.values(e.bindings.skills).includes(existing.skill.id)))
                  row.status = 'update'
              }
              catch { /* Locally edited files remain a conflict. */ }
            }
          }
          else {
            const template = this.a.connectors.template(this.json(p.files, ref.path)) as {
              name: string
            }
            row.digest = hash(canonical(template))
            const firstParty = await this.a.connectors.firstParty?.(req.key, template.name, true)
            if (firstParty) {
              row.status = 'reuse'
              row.id = firstParty
              row.managed = true
            }
            else if (req.key !== 'freecad-mcp') {
              const existing = connections.find(c => boundId ? c.id === boundId : c.name.toLowerCase() === template.name.toLowerCase())
              if (!existing)
                row.status = 'install'
              else {
                row.status = 'conflict'
                row.id = existing.id
                try {
                  const portable = await this.a.connectors.portable(existing.id) as {
                    name: string
                  }
                  const digest = hash(canonical(portable))
                  if (hash(canonical({ ...portable, name: template.name })) === row.digest)
                    row.status = 'reuse'
                  else if (boundId === existing.id
                    && (!baseline || baseline.id === existing.id && baseline.digest === digest)) {
                    // A changed endpoint/command gets a separate disabled connection; credentials and old sessions stay with the original.
                    row.status = 'update'
                    const suffix = ` (${p.manifest.version}-${row.digest.slice(0, 8)})`
                    row.nameOverride = template.name.slice(0, 80 - suffix.length) + suffix
                    if (connections.some(c => c.name.toLowerCase() === requiredValue(row.nameOverride).toLowerCase()))
                      row.status = 'conflict'
                  }
                }
                catch { /* Nonportable or edited templates cannot be replaced. */ }
              }
            }
          }
        }
        rows.push(row)
      }
    let operation: ExpertPackagePreview['operation'] = previous ? 'update' : 'install'
    let reason: ExpertPackagePreview['reason']
    if (ambiguous) {
      operation = 'conflict'
      reason = 'ambiguous'
    }
    else if (localChanges) {
      operation = 'conflict'
      reason = 'local_changes'
    }
    else if (previous) {
      const version = this.compareVersion(p.manifest.version, previous.manifest.version)
      const identical = canonical({ ...p.manifest, id: previous.manifest.id }) === canonical(previous.manifest) && rows.every(r => r.status === 'reuse' ? previous.bindings[r.kind][r.key] === r.id : !r.required && r.status === 'authorization' && !previous.bindings[r.kind][r.key])
      if (version === 0 && identical)
        operation = 'current'
      else if (version === 0 && origin?.digest === filesHash(p.files)
        && canonical({ ...p.manifest, id: previous.manifest.id }) === canonical(previous.manifest))
        operation = 'update'
      else if (version <= 0) {
        operation = 'conflict'
        reason = 'version'
      }
    }
    return { token: p.plan.token, name: p.manifest.name, description: p.manifest.description, rows, operation, version: p.manifest.version,
      ...(previous ? {
        targetId: previous.manifest.id, revision: previous.revision, previousVersion: previous.manifest.version,
        ...(!origin ? { legacy: true } : {}),
      } : {}),
      ...(reason ? { reason } : {}), canImport: operation !== 'conflict' && !rows.some(r => r.status === 'conflict' || r.required && r.status === 'authorization') }
  }
  private embedded(files: Map<string, Uint8Array>, prefix: string) { const rows = new Map([...files].filter(([path]) => path.startsWith(prefix + '/')).map(([path, bytes]) => [path.slice(prefix.length + 1), bytes])); if (!rows.size)
    fail('expert_package_invalid'); return rows }
  /** Validate and stage an archive without installing or launching dependencies.
    * @param bytes - ZIP bytes read by the native picker.
    * @returns Current dependency outcomes and an expiring commit token.
    */
  async preview(bytes: Uint8Array): Promise<ExpertPackagePreview> {
    for (const [id, p] of this.pending)
      if (p.until < Date.now())
        this.pending.delete(id)
    if (this.pending.size >= 3)
      fail('expert_package_busy')
    const files = this.a.unpack(bytes), headerSchema = z.object({ format: z.literal('actvero-expert'), schemaVersion: z.literal(1), files: z.array(z.object({ path: z.string().max(500), size: z.number().int().min(0).max(5 * 1024 * 1024), sha256: sha }).strict()).max(499) }).strict()
    const checked = headerSchema.safeParse(this.json(files, 'package.json'))
    if (!checked.success)
      fail('expert_package_invalid')
    const header = checked.data
    if (header.files.length !== files.size - 1 || new Set(header.files.map(f => f.path)).size !== header.files.length)
      fail('expert_package_invalid')
    for (const f of header.files) {
      const content = files.get(f.path)
      if (f.path === 'package.json' || !content || content.length !== f.size || hash(content) !== f.sha256)
        fail('expert_package_checksum')
    }
    const manifest = parseManifest(this.json(files, 'expert.json')), parsedRefs = deps.safeParse(this.json(files, 'dependencies.json'))
    if (!parsedRefs.success)
      fail('expert_package_invalid')
    const refs = parsedRefs.data
    for (const kind of ['skills', 'connectors'] as const) {
      if (new Set(refs[kind].map(r => r.key)).size !== refs[kind].length
        || refs[kind].some(r => !manifest[kind].some(req => req.key === r.key)))
        fail('expert_package_invalid')
      for (const r of refs[kind]) {
        if (r.source === 'platform' && r.path || r.source === 'local' && r.path && !r.path.startsWith(kind === 'skills' ? 'skills/' : 'connectors/'))
          fail('expert_package_invalid')
      }
    }
    if ([...files.keys()].some(path => !['package.json', 'expert.json', 'dependencies.json'].includes(path) && !refs.skills.some(r => r.source === 'local' && r.path && path.startsWith(r.path + '/')) && !refs.connectors.some(r => r.source === 'local' && r.path === path)))
      fail('expert_package_invalid')
    const token = randomUUID(), p: Pending = { manifest, refs, files, until: Date.now() + 600000, platform: this.a.platform(), scope: this.a.scope(), plan: { token, name: manifest.name, description: manifest.description, rows: [], canImport: false, operation: 'install', version: manifest.version } }
    p.plan = await this.plan(p)
    this.pending.set(token, p)
    return p.plan
  }
  /** Release one staged archive.
    * @param token - opaque preview token.
    */
  discard(token: string): void { this.pending.delete(token) }
  /** Release all staged archives after an account change or disposal. */
  invalidate(): void { this.pending.clear() }
  /** Recheck and commit a reviewed plan; failure rolls back unreferenced new dependencies.
    * @param token - opaque preview token.
    * @returns The saved expert, or the identical existing expert when all bindings match.
    */
  import(token: string): Promise<Expert> {
    const task = this.queue.catch(() => { }).then(() => this.commit(token))
    this.queue = task
    return task
  }
  private async commit(token: string) {
    const p = this.pending.get(token)
    if (!p || p.until < Date.now())
      fail('expert_package_expired')
    if (p.platform !== this.a.platform() || p.scope !== this.a.scope())
      fail('expert_account_changed')
    const plan = await this.plan(p)
    if (!plan.canImport || canonical(plan) !== canonical(p.plan))
      fail('expert_package_changed')
    const bindings: Bindings = { skills: {}, connectors: {} }, created: {
      kind: 'skills' | 'connectors'
      id: string
    }[] = []
    const updated: {
      id: string
      before: string
      after: string
    }[] = []
    try {
      for (const row of plan.rows) {
        if (row.status === 'reuse') {
          bindings[row.kind][row.key] = requiredValue(row.id)
          continue
        }
        if (row.status !== 'install' && row.status !== 'update')
          continue
        const ref = requiredValue(p.refs[row.kind].find(r => r.key === row.key))
        if (row.kind === 'skills') {
          const preview = await this.a.skills.preview(this.embedded(p.files, requiredValue(ref.path)), requiredValue(ref.path))
          try {
            await this.a.skills.install(preview.token, row.status === 'update' ? { id: requiredValue(row.id), versionId: requiredValue(row.versionId) } : undefined)
          }
          finally {
            this.a.skills.discard(preview.token)
          }
          const id = row.status === 'update' ? requiredValue(row.id) : preview.skill.id
          if (row.status === 'update') {
            updated.push({ id, before: requiredValue(row.versionId), after: preview.skill.current_version.id })
          }
          else
            created.push({ kind: row.kind, id })
          bindings.skills[row.key] = id
        }
        else {
          const template = this.json(p.files, requiredValue(ref.path)) as Record<string, unknown>
          const result = await this.a.connectors.save({ ...template, ...(row.nameOverride ? { name: row.nameOverride } : {}) })
          created.push({ kind: row.kind, id: result.id })
          bindings.connectors[row.key] = result.id
        }
      }
      if (p.platform !== this.a.platform() || p.scope !== this.a.scope())
        fail('expert_account_changed')
      for (const kind of ['skills', 'connectors'] as const)
        for (const ref of p.refs[kind].filter(r => r.source === 'platform')) {
          if (!bindings[kind][ref.key])
            continue
          const granted = kind === 'skills' ? await this.a.skills.authorized(requiredValue(ref.id), requiredValue(ref.versionId)) : await this.a.connectors.authorized(requiredValue(ref.id), requiredValue(ref.sha256))
          if (!granted)
            fail('expert_package_changed')
        }
      const previous = plan.targetId ? await this.experts.get(plan.targetId) : undefined
      if (previous && previous.revision !== plan.revision)
        fail('expert_package_changed')
      const expert: Expert = {
        manifest: { ...p.manifest, id: previous?.manifest.id ?? randomUUID() }, revision: previous?.revision ?? 0, bindings,
      }
      const origin: PackageOrigin = {
        schemaVersion: 1, sourceId: p.manifest.id, version: p.manifest.version,
        digest: filesHash(p.files), snapshot: this.snapshot(expert), dependencies: { skills: {}, connectors: {} },
      }
      for (const kind of ['skills', 'connectors'] as const)
        for (const [key, id] of Object.entries(bindings[kind])) {
          if (!id.startsWith('local-'))
            continue
          // Managed first-party connectors are intentionally nonportable.
          const ref = p.refs[kind].find(r => r.key === key)
          if (ref?.source !== 'local' || !ref.path || plan.rows.some(row => row.kind === kind && row.key === key && row.managed))
            continue
          const digest = kind === 'skills' ? filesHash(await this.a.skills.files(id)) : hash(canonical(await this.a.connectors.portable(id)))
          origin.dependencies[kind][key] = { id, digest }
        }
      if (p.scope !== this.a.scope())
        fail('expert_account_changed')
      // Exact reimports do not bump the expert's public version or revision.
      const result = previous && plan.operation === 'current' && await this.experts.packageOrigin(previous.manifest.id)
        ? previous : await this.experts.saveImported(expert, origin)
      this.pending.delete(token)
      return result
    }
    catch (error) {
      let cleanupFailed = false
      for (const row of updated.reverse())
        try {
          await this.a.skills.restore(row.id, row.after, row.before)
        }
        catch {
          cleanupFailed = true
        }
      const installed = await this.experts.list()
      for (const row of created.reverse()) {
        if (installed.some(e => Object.values(e.bindings[row.kind]).includes(row.id)))
          continue
        try {
          await this.a[row.kind].remove(row.id)
        }
        catch {
          cleanupFailed = true
        }
      }
      if (cleanupFailed)
        fail('expert_package_cleanup')
      throw error
    }
  }
  /** Build one local expert archive; platform capabilities remain exact references.
    * @param id - local expert identifier.
    * @returns The display name and credentials-free archive bytes for native saving.
    */
  async export(id: string): Promise<{
    name: string
    bytes: Uint8Array
  }> {
    const expert = await this.experts.get(id)
    if (expert.manifest.id.startsWith('remote-'))
      fail('expert_remote_readonly')
    const files = new Map<string, Uint8Array>(), refs: z.infer<typeof deps> = { schemaVersion: 1, skills: [], connectors: [] }
    const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2))
    const state = await this.a.skills.state()
    for (const kind of ['skills', 'connectors'] as const)
      for (const req of expert.manifest[kind]) {
        const binding = expert.bindings[kind][req.key]
        if (!binding)
          continue
        const ref: Ref = { key: req.key, source: binding.startsWith('local-') ? 'local' : 'platform' }
        if (ref.source === 'local') {
          if (kind === 'skills') {
            ref.path = 'skills/' + req.key
            for (const [path, bytes] of await this.a.skills.files(binding))
              files.set(ref.path + '/' + path, bytes)
          }
          else {
            ref.path = 'connectors/' + req.key + '.json'
            files.set(ref.path, encode(await this.a.connectors.portable(binding)))
          }
        }
        else {
          ref.id = binding
          ref.platform = this.a.platform()
          if (kind === 'skills') {
            const row = state.items.find(r => r.skill.id === binding)
            if (!row)
              fail('expert_dependencies_missing')
            ref.versionId = row.version.id
            ref.sha256 = row.version.sha256
          }
          else
            ref.sha256 = await this.a.connectors.fingerprint(binding)
        }
        refs[kind].push(ref)
      }
    const origin = await this.experts.packageOrigin(id)
    files.set('expert.json', encode({ ...expert.manifest, ...(origin ? { id: origin.sourceId } : {}) }))
    files.set('dependencies.json', encode(refs))
    files.set('package.json', encode({ format: 'actvero-expert', schemaVersion: 1, files: [...files].map(([path, bytes]) => ({ path, size: bytes.length, sha256: hash(bytes) })).sort((a, b) => a.path.localeCompare(b.path)) }))
    const bytes = this.a.pack(files)
    this.a.unpack(bytes)
    return { name: expert.manifest.name, bytes }
  }
}
