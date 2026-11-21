/** Authenticated local delivery for workbenches, experts, Skills and connectors. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile, rename, chmod } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { list } from 'tar'
import { z } from 'zod'
import { gt, valid } from 'semver'
import { WORKBENCH_HOST_API_VERSION } from './workbench-version.ts'
import { readWorkbenchPackage } from './workbench-archive.ts'
import { localCapabilityCommand } from './workbench-local-protocol.ts'
import { registerLocalCapabilities } from './workbench-local-tools.ts'
import type { WorkbenchRuntime } from './workbench-runtime.ts'
import type { WorkbenchId } from './types.ts'

const packageName = z.string().max(214).regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u)
const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('local-capability'), input: localCapabilityCommand }).strict(),
  z.object({ action: z.literal('expert'), operation: z.enum(['catalog', 'create', 'author-list', 'author-get', 'author-update', 'author-check']), input: z.record(z.string(), z.unknown()) }).strict(),
  z.strictObject({ action: z.literal('workbench-status'), name: packageName }),
  z.strictObject({ action: z.literal('workbench-update'), name: packageName, path: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u), expectedVersion: z.string().nullable() }),
])
type UpdateRequest = Extract<z.output<typeof commandSchema>, { action: 'workbench-update' }>

class DeliveryError extends Error {
  constructor(readonly code: string, message: string, readonly outcome: 'not_applied' | 'unknown' = 'not_applied') {
    super(message)
  }
}

declare module '@deepseek-ai/cordis' { interface Context { actveroWorkbenchDevelopment: WorkbenchDevelopment; actveroExpertAuthoring: { run(action: string, input: Record<string, unknown>): Promise<unknown>; directory: string; skill: { name: string; description: string; content: string } } } }

/** A private connection file authorizes local Agents; no endpoint exists before the owner exports development resources. */
export class WorkbenchDevelopment {
  private readonly token = randomBytes(32).toString('hex')
  private readonly localCapabilities: ReturnType<typeof registerLocalCapabilities>
  private server?: Server
  private starting?: Promise<string>
  private operation: Promise<unknown> = Promise.resolve()
  private closed = false
  /**
   * @param ctx Owner of the authenticated loopback endpoint.
   * @param runtime Profile workbench data and conversation ownership.
   * @param directory Private development files directory.
   */
  constructor(private readonly ctx: Context, private readonly runtime: WorkbenchRuntime, private readonly directory: string) {
    this.localCapabilities = registerLocalCapabilities(ctx)
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
      await Promise.all(['connection.json', 'connection.tmp'].map(file => rm(join(directory, file), { force: true })))
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
          return command.action === 'workbench-status' ? this.status(command.name) : this.update(command)
        })
        this.operation = task.catch(() => {})
        const value: unknown = await task
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true, value }))
      })().catch((error: unknown) => {
        this.ctx.logger.warn('Workbench development request failed: %s', error)
        const diagnostic = error instanceof Error ? error.message : String(error)
        const failure = error instanceof DeliveryError ? { code: error.code, outcome: error.outcome } : {}
        response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, diagnostic, ...failure }))
      })
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
  private installer() {
    const manager = this.ctx.get('pluginManager')
    if (!manager) throw new DeliveryError('installer_unavailable', '当前 Harness 不支持安装本机工作台。')
    return manager
  }

  private clientRevision(name: string): string | undefined {
    return this.ctx.clientModules.graph().entries.find(entry => entry.id === name)?.rev
  }

  private async status(name: string): Promise<{
    name: string
    installedVersion: string | null
    clientPublished: boolean
    pendingRestart: boolean
  }> {
    const bundle = (await this.installer().listBundles()).find(item => item.name === name && item.installed)
    return { name, installedVersion: bundle?.version ?? null,
      clientPublished: Boolean(bundle?.enabled && !bundle.restartRequired && this.clientRevision(name)),
      pendingRestart: bundle?.restartRequired === true }
  }

  private async prepareArchive(input: UpdateRequest) {
    if (!isAbsolute(input.path)) throw new DeliveryError('invalid_archive', '工作台归档必须使用绝对路径。')
    const source = await realpath(input.path)
    const info = await stat(source)
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new DeliveryError('invalid_archive', '工作台归档超过大小限制或不是普通文件。')
    const bytes = await readFile(source)
    if (bytes.length > 8 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== input.sha256) {
      throw new DeliveryError('invalid_archive', '工作台归档校验失败。')
    }
    const manifest = await readWorkbenchPackage(new File([new Uint8Array(bytes)], basename(source)))
    if (!manifest || manifest.name !== input.name || !valid(manifest.version)) {
      throw new DeliveryError('invalid_archive', '工作台归档的包名、版本或格式无效。')
    }
    const archiveDirectory = join(this.directory, 'archives')
    await mkdir(archiveDirectory, { recursive: true, mode: 0o700 })
    const path = join(archiveDirectory, input.sha256 + '.tgz')
    const staging = await mkdtemp(join(archiveDirectory, '.staging-'))
    try {
      const temporary = join(staging, 'archive.tgz')
      await writeFile(temporary, bytes, { mode: 0o600 })
      await this.validateArchiveEntries(temporary)
      await rename(temporary, path)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
    return { ...manifest, path }
  }

  private async validateArchiveEntries(path: string): Promise<void> {
    let size = 0
    const paths = new Set<string>()
    await list({ file: path, strict: true, onReadEntry(entry) {
      size += entry.size
      if (!entry.path.startsWith('package/') || entry.path.includes('\\') || entry.path.split('/').includes('..')
        || paths.has(entry.path) || !['File', 'Directory'].includes(entry.type) || size > 32 * 1024 * 1024 || paths.size >= 512) {
        throw new DeliveryError('invalid_archive', '工作台归档含有不支持的文件或路径。')
      }
      paths.add(entry.path)
    } })
  }

  private async update(input: UpdateRequest) {
    const manager = this.installer()
    const archive = await this.prepareArchive(input).catch((error: unknown) => {
      if (error instanceof DeliveryError) throw error
      throw new DeliveryError('invalid_archive', error instanceof Error ? error.message : String(error))
    })
    const current = (await manager.listBundles()).find(item => item.name === archive.name && item.installed)
    const previousVersion = current?.version ?? null
    if (previousVersion !== input.expectedVersion || (current && !current.version)) {
      throw new DeliveryError('version_changed', '目标 Harness 的安装版本已变化，请查询后重试。')
    }
    if (current?.restartRequired) throw new DeliveryError('pending_restart', '该工作台已有待重启的安装变更。')
    if (previousVersion && (!valid(previousVersion) || !gt(archive.version, previousVersion))) {
      throw new DeliveryError('version_not_newer', `项目版本必须高于已安装的 ${previousVersion}。`)
    }
    const id = archive.name as WorkbenchId
    const result = await this.runtime.replaceDevelopment(id, async () => {
      const clientBefore = this.clientRevision(id)
      const providerBefore = this.runtime.list().find(item => item.id === id)
      return manager.installLiveBundle(archive.path, { enabled: true, registry: null,
        ...(previousVersion ? { replace: { name: archive.name, version: previousVersion, nextVersion: archive.version } }
          : { installNew: { name: archive.name, version: archive.version } }),
      }, async (phase) => {
        const provider = this.runtime.list().find(item => item.id === id)
        if (phase === 'apply') {
          const revision = this.ctx.clientModules.rebuilt(id)
          if (!revision || revision === clientBefore || this.clientRevision(id) !== revision) {
            throw new Error('Harness did not publish the new workbench client')
          }
          if ((provider || providerBefore) && provider?.version !== archive.version) {
            throw new Error('The new workbench provider did not load')
          }
        } else {
          if (clientBefore) this.ctx.clientModules.rebuilt(id)
          if (Boolean(this.clientRevision(id)) !== Boolean(clientBefore) || provider?.version !== providerBefore?.version) {
            throw new Error('The previous workbench did not return')
          }
        }
        if (provider) await this.runtime.refreshDevelopmentBindings(id)
      })
    })
    if (result.busy) throw new DeliveryError('operation_in_progress', '该工作台正在运行任务，请等任务结束再更新。')
    const change = result.value
    if (change.application !== 'applied') {
      const diagnostic = change.error?.diagnostic ?? change.error?.code ?? change.application
      throw new DeliveryError(change.recoveryFailed ? 'recovery_failed' : 'update_failed', diagnostic,
        change.recoveryFailed || change.changed ? 'unknown' : 'not_applied')
    }
    return { name: archive.name, version: archive.version, previousVersion, sha256: input.sha256,
      application: 'applied', runtime: 'loaded', client: 'published' }
  }
}
