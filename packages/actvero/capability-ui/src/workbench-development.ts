/** Owner-initiated, profile-local development overlays using native Loader and Client module lifecycles. */
import type { Context } from '@deepseek-ai/cordis'
import { FiberState } from '@deepseek-ai/cordis'
import { EntryTree, type Entry, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-modules'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile, rename, chmod } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { extract, list } from 'tar'
import { z } from 'zod'
import { init, parse } from 'es-module-lexer'
import { satisfies } from 'semver'
import { WORKBENCH_HOST_API_VERSION } from './workbench-version.ts'
import { isBuiltin } from 'node:module'
import { resolveWorkbenchProtocol } from './workbench-protocol.ts'
import { localCapabilityCommand } from './workbench-local-protocol.ts'
import { registerLocalCapabilities } from './workbench-local-tools.ts'
import type { WorkbenchRuntime } from './workbench-runtime.ts'
import type { WorkbenchId, WorkbenchDevelopmentId } from './types.ts'

const manifestSchema = z.object({ name: z.string().regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/), version: z.string(),
  engines: z.object({ dsh: z.string() }), exports: z.object({ '.': z.string(), './client': z.string() }),
  dsh: z.object({ actveroWorkbench: z.literal(1), actveroWorkbenchProtocol: z.unknown().optional() }) })
const attachmentId = z.string().uuid().transform(value => value as WorkbenchDevelopmentId)
const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('local-capability'), input: localCapabilityCommand }).strict(),
  z.object({ action: z.literal('expert'), operation: z.enum(['catalog', 'create', 'author-list', 'author-get', 'author-update', 'author-check']), input: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal('attach'), directory: z.string() }).strict(),
  z.object({ action: z.literal('apply'), id: attachmentId, path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.enum(['status', 'detach']), id: attachmentId }).strict(),
])
interface Mount { directory: string; row: string }
interface Attachment {
  lastApplied?: string
  blocked?: boolean
  originalVersion?: string
  directory: string
  name: WorkbenchId
  mount?: Mount
  original: Entry[]
  originalOptions: Map<Entry, EntryOptions>
  builds: { sha256: string; outcome: string; diagnostic?: string }[]
}
class DevelopmentTree extends EntryTree { override write(): void {} }

declare module '@deepseek-ai/cordis' { interface Context { actveroWorkbenchDevelopment: WorkbenchDevelopment; actveroExpertAuthoring: { run(action: string, input: Record<string, unknown>): Promise<unknown>; skill: { name: string; description: string; content: string } } } }

/** A private connection file authorizes local Agents; no endpoint exists before the owner exports development resources. */
export class WorkbenchDevelopment {
  private readonly token = randomBytes(32).toString('hex')
  private readonly localCapabilities: ReturnType<typeof registerLocalCapabilities>
  private readonly resolveTree: () => DevelopmentTree
  private get tree(): DevelopmentTree { return this.resolveTree() }
  private readonly attachments = new Map<WorkbenchDevelopmentId, Attachment>()
  private readonly stages = new Set<string>()
  private server?: Server
  private starting?: Promise<string>
  private operation: Promise<unknown> = Promise.resolve()
  private closed = false
  /**
   * @param ctx Native Loader owner; this plugin must outlive every development overlay.
   * @param runtime Profile workbench data and conversation ownership.
   * @param directory Private development files directory.
   */
  constructor(private readonly ctx: Context, private readonly runtime: WorkbenchRuntime, private readonly directory: string) {
    this.localCapabilities = registerLocalCapabilities(ctx)
    const owner = ctx.fiber.entry
    let tree: DevelopmentTree | undefined
    let previousTree = owner?.subtree, previousGroup = owner?.subgroup
    this.resolveTree = () => {
      if (!tree) {
        previousTree = owner?.subtree
        previousGroup = owner?.subgroup
        tree = new DevelopmentTree(ctx)
      }
      return tree
    }
    const restoreTree = () => {
      if (!tree) return
      if (owner?.subtree === tree) { if (previousTree) owner.subtree = previousTree; else delete owner.subtree }
      if (owner?.subgroup === tree.root) { if (previousGroup) owner.subgroup = previousGroup; else delete owner.subgroup }
    }
    ctx.provide('actveroWorkbenchDevelopment', this)
    ctx.effect(() => async () => {
      this.closed = true
      await this.starting?.catch(() => {})
      await new Promise<void>((resolve, reject) => {
        if (!this.server?.listening) { resolve(); return }
        this.server.close((error) => { if (error) reject(error); else resolve() })
        this.server.closeIdleConnections()
      })
      await this.operation.catch(() => {})
      const failures: unknown[] = []
      for (const [id] of this.attachments) {
        try { await this.detach(id) } catch (error) { failures.push(error) }
      }
      restoreTree()
      for (const path of [...this.stages, join(directory, 'connection.json'), join(directory, 'connection.tmp')]) {
        try { await rm(path, { recursive: true, force: true }) } catch (error) { failures.push(error) }
      }
      if (failures.length) throw new AggregateError(failures, 'Development cleanup did not complete')
    })
  }

  /** Start a loopback-only endpoint and publish a mode-0600 connection file.
   * @returns Absolute connection file for the CLI; its token expires when this Host exits.
   */
  connection(): Promise<string> {
    if (this.closed) return Promise.reject(new Error('Development host is closed'))
    if (!this.starting) {
      const starting = this.start()
      this.starting = starting
      void starting.catch((_error: unknown) => { if (this.starting === starting) this.starting = undefined })
    }
    return this.starting
  }
  private runtimeVersion(): string {
    const release = this.ctx.clientModules.graph().release
    if (!release) throw new Error('Harness release identity is unavailable')
    return release.version
  }
  private async start(): Promise<string> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const server = createServer((request, response) => {
      const authorization = Buffer.from(request.headers.authorization ?? '')
      const expected = Buffer.from('Bearer ' + this.token)
      if (request.method !== 'POST' || request.url !== '/' || request.headers.origin
        || authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) { response.writeHead(403).end(); return }
      void (async () => {
        let body = ''
        request.setEncoding('utf8')
        for await (const chunk of request) { body += String(chunk); if (body.length > 1024 * 1024) throw new Error('Development request is too large') }
        const command = commandSchema.parse(JSON.parse(body))
        if (this.closed) throw new Error('Development host is closed')
        if (command.action === 'local-capability') {
          if (!this.localCapabilities) throw new Error('local_capability_unavailable')
          const value = await this.localCapabilities(command.input)
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ ok: true, value }))
          return
        }
        const task = this.operation.then(async () => {
          if (this.closed) throw new Error('Development host is closed')
          if (command.action === 'expert') {
            const authoring = this.ctx.get('actveroExpertAuthoring')
            if (!authoring) throw new Error('Local expert authoring is unavailable in this Harness')
            return authoring.run(command.operation, command.input)
          }
          if (command.action === 'attach') return this.attach(command.directory)
          const attachment = this.attachments.get(command.id)
          if (!attachment) throw new Error('Development attachment expired; attach again')
          if (command.action === 'status') return { name: attachment.name, directory: attachment.directory, loaded: !!attachment.mount, blocked: !!attachment.blocked, builds: attachment.builds, runtimeErrors: this.runtime.developmentDiagnostics(attachment.name) }
          if (command.action === 'detach') { await this.detach(command.id); return { detached: true } }
          if (command.action === 'apply') return this.apply(attachment, command.path, command.sha256)
          throw new Error('Unsupported development command')
        })
        this.operation = task.catch(() => {})
        const value: unknown = await task
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true, value }))
      })().catch((error: unknown) => { this.ctx.logger.warn('Workbench development request failed: %s', error); response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, diagnostic: error instanceof Error ? error.message : String(error) })) })
    })
    this.server = server
    server.on('error', (error) => { this.ctx.logger.warn('Workbench development endpoint failed: %s', error) })
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() }) })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Development endpoint is unavailable')
      const path = join(this.directory, 'connection.json')
      const temporary = join(this.directory, 'connection.tmp')
      await chmod(this.directory, 0o700)
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, url: `http://127.0.0.1:${address.port}/`, token: this.token, pid: process.pid, runtimeVersion: this.runtimeVersion(), hostApiVersion: WORKBENCH_HOST_API_VERSION }) + '\n', { mode: 0o600 })
      await chmod(temporary, 0o600)
      await rename(temporary, path)
      return path
    } catch (error) {
      if (server.listening) await new Promise<void>((resolve, reject) => {
        server.close((failure) => { if (failure) reject(failure); else resolve() })
      })
      if (this.server === server) this.server = undefined
      throw error
    }
  }
  private async attach(path: string): Promise<{ id: WorkbenchDevelopmentId; name: string }> {
    if (!isAbsolute(path)) throw new Error('Project directory must be absolute')
    const directory = await realpath(path)
    const manifest = manifestSchema.parse(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')))
    if ([...this.attachments.values()].some(item => item.name === manifest.name)) throw new Error('This workbench already has a development attachment')
    const id = randomUUID() as WorkbenchDevelopmentId
    const original: Entry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.disabled || entry.fiber?.state !== FiberState.ACTIVE) continue
      if (entry.options.name === manifest.name || await this.entryPackage(entry) === manifest.name) original.push(entry)
    }
    const installed = await this.ctx.get('pluginManager')?.listBundles()
    const originalVersion = installed?.find(item => item.name === manifest.name)?.version
      ?? this.runtime.list().find(item => item.id === manifest.name)?.version
    this.attachments.set(id, { directory, name: manifest.name as WorkbenchId, original,
      originalOptions: new Map(), originalVersion, builds: [] })
    return { id, name: manifest.name }
  }
  private async entryPackage(entry: Entry): Promise<string | undefined> {
    const name = entry.options.name
    if (!name.startsWith('file:') && !isAbsolute(name)) return undefined
    let directory = dirname(name.startsWith('file:') ? fileURLToPath(name) : name)
    for (;;) {
      try {
        const metadata = z.object({ name: z.string().optional() }).passthrough().parse(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')))
        if (metadata.name) return metadata.name
      } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
      const parent = dirname(directory)
      if (parent === directory) return undefined
      directory = parent
    }
  }
  private async restoreOriginal(attachment: Attachment): Promise<boolean> {
    const manager = this.ctx.get('pluginManager')
    if (manager && attachment.original.length) {
      const bundle = (await manager.listBundles()).find(item => item.name === attachment.name)
      if (!bundle?.enabled || bundle.version !== attachment.originalVersion || bundle.availability === 'missing') return false
    }
    let restored = false
    for (const entry of attachment.original) {
      if (entry.parent.tree.store[entry.options.id] !== entry) continue
      const options = attachment.originalOptions.get(entry)
      if (!options) continue
      await entry.update(options, true, true)
      await entry.fiber?.await()
      restored = true
    }
    return restored
  }
  private async stage(attachment: Attachment, path: string, sha256: string): Promise<string> {
    if (!isAbsolute(path)) throw new Error('Archive path must be absolute')
    path = await realpath(path)
    if (relative(attachment.directory, path).startsWith('..')) throw new Error('Archive must be inside the attached project')
    const bytes = await readFile(path)
    if (bytes.length > 8 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Development archive size or checksum is invalid')
    const target = await mkdtemp(join(this.directory, 'build-'))
    this.stages.add(target)
    const archive = join(target, 'artifact.tgz')
    await writeFile(archive, bytes)
    let total = 0
    const paths = new Set<string>()
    try {
      await list({ file: archive, strict: true, onReadEntry(entry) {
        total += entry.size
        if (!entry.path.startsWith('package/') || entry.path.includes('\\') || entry.path.split('/').includes('..') || paths.has(entry.path)
        || !['File', 'Directory'].includes(entry.type) || total > 32 * 1024 * 1024 || paths.size >= 512) throw new Error('Unsafe development archive')
        paths.add(entry.path)
      } })
      await extract({ file: archive, cwd: target, strict: true })
      const root = join(target, 'package')
      const manifest = manifestSchema.parse(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')))
      if (manifest.name !== attachment.name) throw new Error('Development archive belongs to another workbench')
      resolveWorkbenchProtocol(manifest.dsh.actveroWorkbenchProtocol)
      if (!satisfies(this.runtimeVersion(), manifest.engines.dsh, { includePrerelease: true })) throw new Error('Development archive requires a different Harness runtime')
      for (const entry of [manifest.exports['.'], manifest.exports['./client']]) {
        if (!entry.startsWith('./') || entry.split('/').includes('..') || !(await stat(join(root, entry))).isFile()) throw new Error('Invalid development entrypoint')
      }
      // Resolve native peers from this exact Harness installation, never from the author's compiler.
      await mkdir(join(root, 'node_modules'))
      await init
      const [imports] = parse(await readFile(join(root, manifest.exports['.']), 'utf8'))
      const peers = new Set(imports.flatMap(item => item.n && !item.n.startsWith('.') && !item.n.startsWith('file:') && !isBuiltin(item.n)
        ? [item.n.startsWith('@') ? item.n.split('/').slice(0, 2).join('/') : item.n.split('/')[0]] : []))
      for (const name of peers) {
        let resolved: string | undefined
        try { resolved = createRequire(import.meta.url).resolve(name) }
        catch (error) {
          resolved = this.ctx.get('clientModules')?.clientPath(name)
          if (!resolved) throw new Error(`Native dependency is unavailable in this Harness: ${name}`, { cause: error })
        }
        let packageRoot = dirname(resolved)
        for (;;) {
          try {
            const metadata: unknown = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
            if (typeof metadata === 'object' && metadata !== null && 'name' in metadata && metadata.name === name) break
          } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
          const parent = dirname(packageRoot)
          if (parent === packageRoot) throw new Error(`Cannot locate native package: ${name}`)
          packageRoot = parent
        }
        const link = join(root, 'node_modules', name)
        await mkdir(dirname(link), { recursive: true })
        await symlink(packageRoot, link, process.platform === 'win32' ? 'junction' : 'dir')
      }
      return root
    } catch (error) { await rm(target, { recursive: true, force: true }); throw error }
  }
  private async mount(directory: string): Promise<Mount> {
    const manifest = manifestSchema.parse(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')))
    const identity = await this.tree.create({ name: pathToFileURL(join(directory, manifest.exports['.'])).href })
    const row = identity.slice(identity.lastIndexOf(':') + 1)
    await this.tree.await()
    const entry = this.tree.resolve(row)
    try {
      await entry.fiber?.await()
      if (entry.fiber?.state !== FiberState.ACTIVE) throw new Error('Required native services are unavailable')
    } catch (error) {
      await entry.fiber?.dispose(); this.tree.remove(row)
      throw new Error('Development Host failed to activate: ' + (error instanceof Error ? error.message : String(error)), { cause: error })
    }
    return { row, directory }
  }
  private async unmount(mount: Mount): Promise<void> {
    const entry = this.tree.resolve(mount.row)
    await entry.fiber?.dispose()
    this.tree.remove(mount.row)
    await this.tree.await()
  }
  private async apply(attachment: Attachment, path: string, sha256: string): Promise<object> {
    if (attachment.blocked) throw new Error('Development state is untrusted; restart Harness before attaching again')
    if (attachment.lastApplied === sha256 && attachment.mount) return { application: 'applied', sha256, client: 'published', runtime: 'loaded' }
    if (!this.runtime.developmentIdle(attachment.name)) return { application: 'busy' }
    const directory = await this.stage(attachment, path, sha256)
    const result = await this.runtime.replaceDevelopment(attachment.name, async () => {
      const previous = attachment.mount
      try {
        if (previous) { await this.unmount(previous); attachment.mount = undefined }
        else for (const entry of attachment.original) {
          const fiber = entry.fiber
          attachment.originalOptions.set(entry, entry.options)
          // The profile row retains its original object; Loader sees only this temporary disabled copy.
          await entry.update({ ...entry.options, disabled: true }, true)
          await fiber?.dispose()
        }
        attachment.mount = await this.mount(directory)
        await this.runtime.refreshDevelopmentBindings(attachment.name)
        attachment.lastApplied = sha256
        attachment.builds.push({ sha256, outcome: 'applied' }); attachment.builds.splice(0, Math.max(0, attachment.builds.length - 20))
        return { application: 'applied', sha256, client: 'published', runtime: 'loaded' }
      } catch (error) {
        try {
          if (attachment.mount) await this.unmount(attachment.mount)
          attachment.mount = undefined
          if (previous) attachment.mount = await this.mount(previous.directory)
          const restored = previous ? true : await this.restoreOriginal(attachment)
          if (restored) await this.runtime.refreshDevelopmentBindings(attachment.name)
        } catch (rollback) {
          attachment.blocked = true
          attachment.builds.push({ sha256, outcome: 'recovery-failed', diagnostic: String(rollback) })
          throw new AggregateError([error, rollback], 'Development update and recovery failed. Restart Harness and inspect business data before continuing.')
        }
        attachment.builds.push({ sha256, outcome: 'failed', diagnostic: error instanceof Error ? error.message : String(error) })
        throw error
      }
    })
    return result.busy ? { application: 'busy' } : result.value
  }

  private async detach(id: WorkbenchDevelopmentId): Promise<void> {
    const attachment = this.attachments.get(id)
    if (!attachment) return
    if (this.closed) { if (attachment.mount) await this.unmount(attachment.mount); this.attachments.delete(id); return }
    if (attachment.blocked) throw new Error('Restart Harness before releasing an untrusted development overlay')
    const result = await this.runtime.replaceDevelopment(attachment.name, async () => {
      if (attachment.mount) await this.unmount(attachment.mount)
      if (await this.restoreOriginal(attachment)) await this.runtime.refreshDevelopmentBindings(attachment.name)
      this.attachments.delete(id)
    })
    if (result.busy) throw new Error('Stop the active workbench task before detaching')
  }
}
