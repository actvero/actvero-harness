import type { InstalledSkillDefinition } from './contracts.ts'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import { constants } from 'node:fs'
import { mkdir, readFile, writeFile, rename, rm, lstat, readdir, open } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseDocument } from 'yaml'
import { zipSync } from 'fflate'
import { digest, fail, parseSkill, safePath, unpack } from './package.ts'
import type { Installed, SkillDetail, SkillFile } from './contracts.ts'

type VersionEntry = Installed & { directory: string; entrypoint: string; files: SkillFile[] }
type Entry = VersionEntry & { previous?: VersionEntry[] }
type Preview = { token: string; skill: SkillDetail; filename: string }
type Pending = Preview & { files: Map<string, Uint8Array>; until: number }
interface Options {
  root: string
  changed(): void
  syncHost(name?: string, id?: string): Promise<void>
}
const validId = (id: string) => /^local-[0-9a-f-]{36}$/.test(id)
const reserved = new Set(['compact', 'export', 'feedback', 'goal', 'permission', 'plan', 'model'])

/** Device-owned imports. Original files are never modified or removed. */
export class LocalSkills {
  private records?: Entry[]
  private loading?: Promise<Entry[]>
  private queue: Promise<unknown> = Promise.resolve()
  private pending = new Map<string, Pending>()
  constructor(private options: Options) {}
  private async entries() {
    if (this.records) return this.records
    this.loading ??= (async () => {
      let value: unknown
      try {
        value = JSON.parse(await readFile(join(this.options.root, 'installed.json'), 'utf8'))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return fail('local_state_invalid')
        value = []
      }
      if (
        !Array.isArray(value) ||
        value.some(
          r =>
            !validId(r.skill?.id ?? '') ||
            r.skill.source !== 'local' ||
            !this.validDirectory(r) ||
            (r.previous !== undefined && (!Array.isArray(r.previous)
              || r.previous.some((old: VersionEntry) => old.skill.id !== r.skill.id
                || !this.validDirectory(old) || !Array.isArray(old.files)))) ||
            typeof r.enabled !== 'boolean' ||
            !Array.isArray(r.files),
        )
      )
        return fail('local_state_invalid')
      for (const r of value.flatMap((row: Entry) => [row, ...(row.previous ?? [])])) {
        safePath(r.entrypoint)
        for (const f of r.files) safePath(f.path)
      }
      this.records = value
      return this.records
    })()
    try {
      return await this.loading
    } finally {
      this.loading = undefined
    }
  }
  private validDirectory(row: VersionEntry): boolean {
    return row.directory === `packages/${row.skill.id}` ||
      (/^[0-9a-f-]{36}$/.test(row.version?.id ?? '') && row.directory === `versions/${row.skill.id}/${row.version.id}`)
  }
  private async verify(row: VersionEntry): Promise<void> {
    const expected = new Map(row.files.map(file => [file.path, file]))
    const walk = async (directory: string, prefix = ''): Promise<void> => {
      if ((await lstat(directory)).isSymbolicLink()) fail('local_changes')
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = prefix + entry.name
        if (entry.isSymbolicLink()) fail('local_changes')
        if (entry.isDirectory()) await walk(join(directory, entry.name), path + '/')
        else {
          const file = expected.get(path)
          if (!file || digest(await this.boundedFile(join(directory, entry.name))) !== file.sha256) fail('local_changes')
          expected.delete(path)
        }
      }
    }
    let directory = this.options.root
    for (const part of row.directory.split('/')) {
      directory = join(directory, part)
      if ((await lstat(directory)).isSymbolicLink()) return fail('local_changes')
    }
    await walk(directory)
    if (expected.size) fail('local_changes')
  }
  /**
   * Read managed local installation metadata without source file contents.
   * @returns Installed local skill views.
   */
  async state(): Promise<Installed[]> {
    return (await this.entries()).map(({ skill, version, enabled, status }) => ({
      skill,
      version,
      enabled,
      status,
    }))
  }
  private async persist() {
    await mkdir(this.options.root, { recursive: true, mode: 0o700 })
    const path = join(this.options.root, `records-${randomUUID()}.tmp`)
    try {
      await writeFile(path, JSON.stringify(this.records), { mode: 0o600, flag: 'wx' })
      await rename(path, join(this.options.root, 'installed.json'))
    } finally {
      await rm(path, { force: true })
    }
  }
  private mutate<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => {}).then(work)
    this.queue = task
    return task.finally(() => this.options.changed())
  }
  private async boundedFile(path: string, max = 5 * 1024 * 1024) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > max) return fail('unsafe_package')
      const data = await file.readFile()
      if (data.length > max) return fail('unsafe_package')
      return data
    } finally {
      await file.close()
    }
  }
  /**
   * Validate a folder, ZIP or Markdown entrypoint without modifying the original files.
   * @param path - User-selected import path.
   * @returns Expiring preview containing validated skill metadata.
   */
  async preview(path: string): Promise<Preview> {
    for (const [id, p] of this.pending) if (p.until < Date.now()) this.pending.delete(id)
    if (this.pending.size >= 3) return fail('too_many_previews')
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) return fail('unsafe_package')
    let files = new Map<string, Uint8Array>()
    if (stat.isDirectory()) {
      let total = 0,
        entriesVisited = 0
      const walk = async (dir: string, prefix = ''): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (++entriesVisited > 1000 || prefix.split('/').length > 32) return fail('unsafe_package')
          if (entry.name === '.DS_Store') continue
          const relative = safePath(prefix + entry.name),
            absolute = join(dir, entry.name)
          if (entry.isSymbolicLink()) return fail('unsafe_package')
          if (entry.isDirectory()) await walk(absolute, relative + '/')
          else {
            if (!entry.isFile() || files.size >= 500) return fail('unsafe_package')
            const bytes = await this.boundedFile(absolute)
            total += bytes.length
            if (total > 40 * 1024 * 1024) return fail('unsafe_package')
            files.set(relative, bytes)
          }
        }
      }
      await walk(path)
    } else if (stat.isFile() && /\.zip$/i.test(path))
      files = unpack(await this.boundedFile(path, 20 * 1024 * 1024))
    else if (stat.isFile() && /\.md$/i.test(path)) files.set('SKILL.md', await this.boundedFile(path))
    else return fail('invalid_skill')
    return this.previewFiles(files, basename(path))
  }
  /** Read an archive through the existing path and expanded-size validator.
   * @param bytes - complete ZIP bytes.
   * @returns Validated relative file paths and their original content.
   */
  unpack(bytes: Uint8Array): Map<string, Uint8Array> {
    return unpack(bytes)
  }
  /** Encode relative files into a ZIP; the caller validates complete archive bounds.
   * @param files - relative paths and content.
   * @returns Compressed ZIP bytes.
   */
  pack(files: Map<string, Uint8Array>): Uint8Array {
    return zipSync(Object.fromEntries(files), { level: 6 })
  }
  /** Stage one embedded standard skill without executing its content.
   * @param files - validated relative files for exactly one skill.
   * @param filename - display name for the staged package.
   * @returns An expiring preview and generated local skill identifier.
   */
  async previewFiles(files: Map<string, Uint8Array>, filename: string): Promise<Preview> {
    for (const [id, p] of this.pending) if (p.until < Date.now()) this.pending.delete(id)
    if (this.pending.size >= 32) return fail('too_many_previews')
    if (
      files.size > 500 ||
      [...files.values()].some(b => b.length > 5 * 1024 * 1024) ||
      [...files.values()].reduce((n, b) => n + b.length, 0) > 40 * 1024 * 1024
    )
      return fail('unsafe_package')
    // Imported folders and ZIPs contain exactly one skill, not suites.
    const entries = [...files.keys()].filter(p => p.split('/').at(-1) === 'SKILL.md')
    if (entries.length !== 1) return fail(entries.length ? 'multiple_skills' : 'missing_skill')
    const entrypoint = entries[0],
      text = new TextDecoder('utf-8', { fatal: true }).decode(files.get(entrypoint))
    const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
    if (!match) return fail('invalid_skill')
    const doc = parseDocument(match[1], { uniqueKeys: true })
    if (doc.errors.length) return fail('invalid_skill')
    const meta = doc.toJS({ maxAliasCount: 20 }),
      name = meta?.name
    if (typeof name !== 'string' || name.length > 64) return fail('invalid_skill')
    const parsed = parseSkill(text, name)
    if (parsed.description.length > 1024 || reserved.has(name)) return fail('invalid_skill')
    const seen = new Set<string>()
    for (const p of files.keys()) {
      const normalized = safePath(p).normalize('NFKC').toLowerCase()
      if (seen.has(normalized)) return fail('unsafe_package')
      seen.add(normalized)
    }
    const manifest = [...files].map(([path, bytes]) => ({
      path,
      size: bytes.length,
      sha256: digest(bytes),
      previewable: false,
    }))
    const version = typeof meta.metadata?.version === 'string' ? meta.metadata.version.slice(0, 80) : ''
    const id = 'local-' + randomUUID()
    const skill: SkillDetail = {
      id,
      source: 'local',
      name,
      display_name: name,
      description: parsed.description,
      category: { id: 'local', name: '' },
      icon: { source: 'fallback', image: '', sha256: '' },
      revision: 1,
      current_version: {
        id: randomUUID(),
        version,
        sha256: digest(JSON.stringify(manifest)),
        size: manifest.reduce((n, f) => n + f.size, 0),
        published_at: '',
        release_notes: '',
      },
      entrypoint,
      files: manifest,
      skill_md: parsed.content,
    }
    const result = { token: randomUUID(), filename, skill }
    this.pending.set(result.token, { ...result, files, until: Date.now() + 10 * 60_000 })
    return result
  }
  /**
   * Discard a staged import without installing it.
   * @param token - Preview token to discard.
   */
  discard(token: string): void {
    this.pending.delete(token)
  }
  /**
   * Install an unexpired preview after checking native skill-name collisions.
   * @param token - Validated import preview token.
   * @param replace - Reviewed installation and current version to advance while retaining its files.
   * @returns Updated local installation state; failed writes roll back the new package.
   */
  async install(token: string, replace?: { id: string; versionId: string }): Promise<Installed[]> {
    return this.mutate(async () => {
      const preview = this.pending.get(token)
      if (!preview || preview.until < Date.now()) return fail('preview_expired')
      const records = await this.entries(),
        { skill, files } = preview
      const previous = replace ? records.find(row => row.skill.id === replace.id) : undefined
      if (replace && (!previous || previous.version.id !== replace.versionId || previous.skill.name !== skill.name)) return fail('local_changes')
      if (previous) await this.verify(previous)
      if (records.some(r => r.skill.name === skill.name && r !== previous)) return fail('skill_name_conflict')
      if (previous) skill.id = previous.skill.id
      await this.options.syncHost(skill.name, skill.id)
      const directory = previous ? `versions/${skill.id}/${skill.current_version.id}` : `packages/${skill.id}`,
        target = join(this.options.root, directory),
        stage = target + '.staging'
      let committed = false
      try {
        await mkdir(stage, { recursive: true, mode: 0o700 })
        for (const [path, bytes] of files) {
          const dest = join(stage, safePath(path))
          await mkdir(dirname(dest), { recursive: true, mode: 0o700 })
          await writeFile(dest, bytes, { flag: 'wx', mode: 0o600 })
        }
        await rename(stage, target)
        this.records = [
          ...records.filter(row => row !== previous),
          {
            skill,
            version: skill.current_version,
            enabled: previous?.enabled ?? true,
            status: 'current',
            ...(previous ? { previous: [...(previous.previous ?? []), this.versionOnly(previous)] } : {}),
            directory,
            entrypoint: skill.entrypoint,
            files: skill.files,
          },
        ]
        await this.options.syncHost()
        await this.persist()
        committed = true
        this.pending.delete(token)
        return this.state()
      } catch (e) {
        this.records = records
        await this.options.syncHost().catch(() => {})
        throw e
      } finally {
        await rm(stage, { recursive: true, force: true })
        if (!committed) await rm(target, { recursive: true, force: true })
      }
    })
  }
  private versionOnly({ previous: _previous, ...version }: Entry): VersionEntry { return version }
  /** Restore an import's previous current version after a failed expert commit; newer edits win.
   * @param id - Local skill identifier.
   * @param expectedVersion - Current version produced by this import.
   * @param versionId - Previously installed version to restore.
   */
  async restoreVersion(id: string, expectedVersion: string, versionId: string): Promise<void> {
    return this.mutate(async () => {
      const records = await this.entries(), current = records.find(row => row.skill.id === id)
      const previous = current?.previous?.find(row => row.version.id === versionId)
      if (!current || current.version.id !== expectedVersion || !previous) return fail('local_changes')
      await this.verify(current)
      this.records = records.map(row => row !== current ? row : {
        ...previous, enabled: current.enabled,
        previous: [...(current.previous ?? []).filter(old => old !== previous), this.versionOnly(current)],
      })
      try { await this.options.syncHost(); await this.persist() }
      catch (error) { this.records = records; await this.options.syncHost().catch(() => {}); throw error }
    })
  }
  /** Verify installed files before exposing them to an expert archive.
   * @param id - installed local skill identifier.
   * @returns Exact original files after path, size and digest verification.
   */
  async exportFiles(id: string): Promise<Map<string, Uint8Array>> {
    const row = (await this.entries()).find(r => r.skill.id === id)
    if (!row) return fail('skill_not_installed')
    await this.verify(row)
    const files = new Map<string, Uint8Array>()
    for (const f of row.files) {
      let path = this.options.root
      for (const part of (row.directory + '/' + safePath(f.path)).split('/')) {
        path = join(path, part)
        if ((await lstat(path)).isSymbolicLink()) return fail('local_changes')
      }
      const bytes = await this.boundedFile(path)
      if (bytes.length !== f.size || digest(bytes) !== f.sha256) return fail('local_changes')
      files.set(f.path, bytes)
    }
    return files
  }
  /**
   * Read metadata for an installed local skill.
   * @param id - Managed local skill identifier.
   * @returns Skill details and file inventory; absent installations reject.
   */
  async detail(id: string): Promise<SkillDetail> {
    const r = (await this.entries()).find(r => r.skill.id === id)
    if (!r) return fail('skill_not_installed')
    return { ...r.skill, entrypoint: r.entrypoint, files: r.files, skill_md: '' }
  }
  /**
   * Persist local enablement and synchronize native skill discovery.
   * @param id - Managed local skill identifier.
   * @param enabled - Whether native discovery may expose the installation.
   */
  async enable(id: string, enabled: boolean): Promise<void> {
    return this.mutate(async () => {
      const records = await this.entries(),
        item = records.find(r => r.skill.id === id)
      if (!item) return fail('skill_not_installed')
      if (enabled) await this.options.syncHost(item.skill.name, id)
      this.records = records.map(r => (r === item ? { ...r, enabled } : r))
      try {
        await this.options.syncHost()
        await this.persist()
      } catch (e) {
        this.records = records
        await this.options.syncHost().catch(() => {})
        throw e
      }
    })
  }
  /**
   * Verify unchanged installed files before removing the managed copy.
   * @param id - Managed local skill identifier.
   */
  async uninstall(id: string): Promise<void> {
    return this.mutate(async () => {
      const records = await this.entries(),
        item = records.find(r => r.skill.id === id)
      if (!item) return fail('skill_not_installed')
      const versions = [item, ...(item.previous ?? [])]
      for (const version of versions) await this.verify(version)
      this.records = records.filter(r => r !== item)
      try {
        await this.options.syncHost()
        await this.persist()
      } catch (e) {
        this.records = records
        await this.options.syncHost().catch(() => {})
        throw e
      }
      for (const version of versions) await rm(join(this.options.root, version.directory), { recursive: true, force: true })
    })
  }
  /**
   * List enabled local skills whose entrypoints remain readable and valid.
   * @returns Native provider candidates with exact installed version identifiers.
   */
  async hostList(): Promise<
    {
      id: string
      name: string
      description: string
      versionId: string
      invocation: SkillDefinition['invocation']
    }[]
  > {
    const rows = []
    for (const r of await this.entries())
      if (r.enabled) {
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
    return rows
  }
  /**
   * Read a matching enabled version without following symbolic links.
   * @param id - Managed local skill identifier.
   * @param versionId - Expected installed version identifier.
   * @returns Native skill definition, or undefined when the version is absent or disabled.
   */
  async hostGet(id: string, versionId: string): Promise<InstalledSkillDefinition | undefined> {
    const current = (await this.entries()).find(row => row.skill.id === id && row.enabled)
    const r = current?.version.id === versionId ? current : current?.previous?.find(row => row.version.id === versionId)
    if (!r) return undefined
    let path = this.options.root
    for (const part of (r.directory + '/' + r.entrypoint).split('/')) {
      path = join(path, part)
      if ((await lstat(path)).isSymbolicLink()) return fail('invalid_skill')
    }
    const parsed = parseSkill((await this.boundedFile(path)).toString('utf8'), r.skill.name)
    return {
      ...parsed,
      source: 'local',
      provider: 'actvero-skills',
      path,
      resourceBase: { kind: 'directory', path: dirname(path) },
    }
  }
}
