/** Local expert bundles mounted into a workbench-owned conversation scope. */
import type { Context } from '@deepseek-ai/cordis'
import type { WorkbenchActivation, WorkbenchRuntimeContext } from '@actvero/dsh-capability-ui'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { Config as McpConfig, apply as applyMcp, name as mcpName, inject as mcpInject } from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { parseManifest } from './schema.ts'
import type { ExpertManifest } from './contracts.ts'

const skillRef = z.discriminatedUnion('source', [
  z.object({ key: z.string(), source: z.literal('local'), path: z.string().min(1) }).strict(),
  z.object({ key: z.string(), source: z.literal('installed'), name: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
])
const dependencies = z.object({
  schemaVersion: z.literal(1),
  skills: z.array(skillRef).max(32).default([]),
  connectors: z.array(z.object({ key: z.string(), source: z.literal('local'), path: z.string().min(1) }).strict()).max(32).default([]),
  cli: z.array(z.object({ name: z.string().min(1), path: z.string().min(1), runtime: z.enum(['node', 'python', 'executable']), description: z.string().min(1) }).strict()).max(32).default([]),
}).strict()
type Dependencies = z.infer<typeof dependencies>
interface LoadedBundle {
  root: string
  manifest: ExpertManifest
  dependencies: Dependencies
  skills: Map<string, SkillDefinition>
  connectors: Map<string, Record<string, unknown>>
  digest: string
}

/** Failures identify which local dependency cannot safely be used. */
export class WorkbenchExpertError extends Error {
  /** Stable reason for preparation or authorization failure. */
  readonly code: 'bundle-invalid' | 'dependency-missing' | 'dependency-changed' | 'dependency-unavailable'
  /**
   * @param code Machine-readable reason.
   * @param message Affected dependency and recovery action, without credentials.
   * @param cause Original failure, when available.
   */
  constructor(code: WorkbenchExpertError['code'], message: string, cause?: unknown) {
    super(message, { cause })
    this.code = code
  }
}

/** A local expert directory and optional explicitly selected interpreters. */
export interface WorkbenchExpertBundleOptions {
  /** Absolute directory containing expert.json, dependencies.json and packaged resources. */
  directory: string
  /** Explicit interpreter paths; omitted entries resolve through the native workspaceDependencies service when needed. */
  runtimes?: { node?: string; python?: string }
}

/** Version-cached local resources; every activation gets independent native registrations and MCP connections. */
export class WorkbenchExpertBundle {
  private readonly cached = new Map<string, Promise<LoadedBundle>>()
  /**
   * @param options Installed expert directory and optional interpreter overrides.
   */
  constructor(private readonly options: WorkbenchExpertBundleOptions) {
    if (!isAbsolute(options.directory)) throw new WorkbenchExpertError('bundle-invalid', 'Expert bundle directory must be absolute.')
    for (const path of Object.values(options.runtimes ?? {})) {
      if (!isAbsolute(path)) throw new WorkbenchExpertError('bundle-invalid', 'Interpreter paths must be absolute.')
    }
  }

  /** Mount a bundle through WorkbenchProvider.activate; the runtime owns rollback and quiescent disposal.
   * @param ctx Conversation-scoped context supplied by the workbench runtime.
   * @param environment Business paths and associated Session.
   * @param signal Cancels preparation and MCP startup.
   * @returns Exact dependency digest and compiled instructions, captured by the workbench Session.
   */
  readonly activate = async (ctx: Context, environment: WorkbenchRuntimeContext, signal: AbortSignal): Promise<WorkbenchActivation> => {
    signal.throwIfAborted()
    let loading = this.cached.get(environment.version)
    if (!loading) {
      loading = this.load(ctx).catch((error: unknown) => { this.cached.delete(environment.version); throw error })
      this.cached.set(environment.version, loading)
    }
    const bundle = await loading
    signal.throwIfAborted()
    const skills = ctx.get('skills')
    const installed: Extract<Dependencies['skills'][number], { source: 'installed' }>[] = []
    const always: string[] = []
    const warnings: string[] = []
    for (const requirement of bundle.manifest.skills) {
      const ref = bundle.dependencies.skills.find(item => item.key === requirement.key)
      if (!ref) {
        if (requirement.required) throw missing(requirement.key)
        warnings.push(`Optional skill unavailable: ${requirement.label}`)
        continue
      }
      if (!skills) throw missing('native skill registry')
      let skill: SkillDefinition | undefined
      try { skill = ref.source === 'local' ? bundle.skills.get(ref.key) : await this.installedSkill(ctx, ref, signal) }
      catch (error) {
        if (requirement.required || !(error instanceof WorkbenchExpertError) || error.code !== 'dependency-missing') throw error
      }
      if (!skill) {
        if (requirement.required) throw missing(requirement.key)
        warnings.push(`Optional skill unavailable: ${requirement.label}`)
        continue
      }
      skills.register({ ...skill, source: 'bundled' })
      if (ref.source === 'installed') installed.push(ref)
      if (requirement.load === 'always') always.push(renderSkillContent(skill))
    }
    let runtimePaths = this.options.runtimes
    const interpreter = async (name: 'node' | 'python'): Promise<string> => {
      if (!runtimePaths?.[name]) {
        const runtime = ctx.get('workspaceDependencies')
        if (!runtime) throw missing(`native ${name} runtime`)
        runtimePaths = { ...await runtime.resolve(), ...this.options.runtimes }
      }
      const path = runtimePaths[name]
      if (!path) throw missing(`${name} interpreter`)
      await stat(path)
      return path
    }
    const expand = async (value: string): Promise<string> => {
      let result = value.replaceAll('${bundle}', bundle.root).replaceAll('${data}', environment.dataDirectory)
      for (const name of ['node', 'python'] as const) {
        if (result.includes('${' + name + '}')) result = result.replaceAll('${' + name + '}', await interpreter(name))
      }
      return result
    }
    const agent = ctx.get('agents')?.get(environment.sessionId)
    const tools = ctx.get('tools')
    if (!agent || !tools) throw missing('native conversation tool registry')
    const requiredTools: string[] = []
    for (const requirement of bundle.manifest.connectors) {
      const raw = bundle.connectors.get(requirement.key)
      if (!raw) {
        if (requirement.required) throw missing(requirement.key)
        warnings.push(`Optional MCP unavailable: ${requirement.label}`)
        continue
      }
      const serverName = 'wb_' + hash(environment.id + ':' + requirement.key).slice(0, 20)
      const expanded = await expandConfig(raw, expand)
      const endpoint = z.discriminatedUnion('transport', [
        z.object({ transport: z.literal('stdio'), command: z.string() }).loose(),
        z.object({ transport: z.literal('streamable-http'), url: z.string() }).loose(),
      ]).parse(expanded)
      const config = McpConfig({ ...endpoint, serverName, failOnStartupError: true,
        ...(endpoint.transport === 'stdio' && !expanded.cwd ? { cwd: bundle.root } : {}) })
      try { await ctx.plugin({ name: mcpName, inject: mcpInject, Config: McpConfig, apply: applyMcp }, config) }
      catch (error) {
        signal.throwIfAborted()
        if (requirement.required) throw new WorkbenchExpertError('dependency-unavailable', `MCP ${requirement.label} failed to start. Check its command, service and authorization.`, error)
        warnings.push(`Optional MCP unavailable: ${requirement.label}`)
        continue
      }
      signal.throwIfAborted()
      if (requirement.required) requiredTools.push(...tools.schemas(agent).map(item => item.name).filter(name => name.startsWith(`mcp__${serverName}__`)))
    }
    const commands: string[] = []
    for (const cli of bundle.dependencies.cli) {
      const file = await contained(bundle.root, cli.path)
      const argv = cli.runtime === 'executable' ? [file] : [await interpreter(cli.runtime), file]
      commands.push(`CLI ${cli.name}: ${cli.description}\nCommand argv: ${JSON.stringify(argv)}`)
    }
    ctx.on('agent/pre-step', async (_event, next) => {
      for (const ref of installed) await this.installedSkill(ctx, ref, _event.signal)
      if (requiredTools.some(name => !tools.get(name, agent))) throw new WorkbenchExpertError('dependency-unavailable', 'A required workbench MCP is disconnected. Restore the service before continuing.')
      return next()
    })
    signal.throwIfAborted()
    return { digest: bundle.digest, expert: { name: bundle.manifest.name, version: bundle.manifest.version,
      instructions: [bundle.manifest.instructions, `Business data directory: ${environment.dataDirectory}`,
        `Packaged resources directory: ${bundle.root}`, ...always, ...commands, ...warnings].join('\n\n') } }
  }

  private async installedSkill(ctx: Context, ref: Extract<Dependencies['skills'][number], { source: 'installed' }>, signal: AbortSignal): Promise<SkillDefinition> {
    // Read the unscoped authority, not the copy mounted in this conversation.
    const skill = await ctx.get('skills')?.get(ref.name, { signal })
    signal.throwIfAborted()
    if (!skill) throw missing(ref.name)
    const digest = skill.resourceBase?.kind === 'directory'
      ? hash(JSON.stringify([skill.content, await directoryDigest(skill.resourceBase.path)])) : hash(skill.content)
    if (digest !== ref.sha256) throw new WorkbenchExpertError('dependency-changed', `Installed skill ${ref.name} changed. Rebuild the workbench with the intended version.`)
    return skill
  }

  private async load(ctx: Context): Promise<LoadedBundle> {
    try {
      const root = await realpath(this.options.directory)
      const manifest = parseManifest(JSON.parse(await readFile(join(root, 'expert.json'), 'utf8')))
      let raw: unknown
      try { raw = JSON.parse(await readFile(join(root, 'dependencies.json'), 'utf8')) }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        raw = { schemaVersion: 1 }
      }
      const refs = dependencies.parse(raw)
      for (const kind of ['skills', 'connectors'] as const) {
        const keys = refs[kind].map(item => item.key)
        if (new Set(keys).size !== keys.length || keys.some(key => !manifest[kind].some(item => item.key === key))) throw new WorkbenchExpertError('bundle-invalid', `Expert ${kind} bindings do not match its declarations.`)
      }
      const controller = new AbortController()
      const files = new FileSystemSkillProvider(ctx, { signal: controller.signal, invalidate() {} }, {
        providerName: 'workbench-bundle', includeDefaultRoots: false, watch: false,
        customSkillDirs: [...new Set(await Promise.all(refs.skills.filter(item => item.source === 'local').map(async item => dirname(await contained(root, item.path)))))],
      })
      const skills = new Map<string, SkillDefinition>()
      try {
        const catalog = await files.list({})
        const candidates = Array.isArray(catalog) ? catalog : catalog.candidates
        for (const ref of refs.skills) {
          if (ref.source !== 'local') continue
          const path = join(await contained(root, ref.path), 'SKILL.md')
          const candidate = candidates.find(item => item.path === path)
          if (!candidate) throw missing(ref.key)
          const skill = await files.get(candidate, {})
          if (!skill) throw missing(ref.key)
          if ([...skills.values()].some(existing => existing.name === skill.name)) throw new WorkbenchExpertError('bundle-invalid', 'Bundled skill names must be unique.')
          skills.set(ref.key, skill)
        }
      } finally { await files.dispose(); controller.abort() }
      const connectors = new Map<string, Record<string, unknown>>()
      for (const ref of refs.connectors) {
        connectors.set(ref.key, z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(await contained(root, ref.path), 'utf8'))))
      }
      return { root, manifest, dependencies: refs, skills, connectors, digest: await directoryDigest(root) }
    } catch (error) {
      if (error instanceof WorkbenchExpertError) throw error
      throw new WorkbenchExpertError('bundle-invalid', 'Cannot load the local workbench expert. Check its manifest, bindings and packaged files.', error)
    }
  }
}

function hash(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex') }
function missing(name: string): WorkbenchExpertError { return new WorkbenchExpertError('dependency-missing', `Workbench dependency ${name} is missing. Install the declared dependency or rebuild the package.`) }
async function contained(root: string, path: string): Promise<string> {
  const target = await realpath(resolve(root, path))
  const location = relative(root, target)
  if (isAbsolute(path) || location === '..' || location.startsWith('..' + sep) || isAbsolute(location)) {
    throw new WorkbenchExpertError('bundle-invalid', 'Expert resource path escapes its package.')
  }
  return target
}
async function directoryDigest(root: string): Promise<string> {
  const digest = createHash('sha256')
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) digest.update(JSON.stringify([relative(root, path).split(sep).join('/'), hash(await readFile(path))]))
      else throw new WorkbenchExpertError('bundle-invalid', 'Expert bundles cannot contain links or special files.')
    }
  }
  await visit(root)
  return digest.digest('hex')
}
async function expandConfig(raw: Record<string, unknown>, expand: (value: string) => Promise<string>): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...raw }
  for (const key of ['command', 'url', 'cwd']) if (typeof raw[key] === 'string') result[key] = await expand(raw[key])
  if (Array.isArray(raw.args)) {
    const args: unknown[] = raw.args
    result.args = await Promise.all(args.map(value => typeof value === 'string' ? expand(value) : value))
  }
  for (const key of ['env', 'headers']) {
    const values = raw[key]
    if (typeof values === 'object' && values !== null && !Array.isArray(values)) {
      const entries: [string, unknown][] = Object.entries(values)
      result[key] = Object.fromEntries(await Promise.all(entries.map(async ([name, value]) =>
        [name, typeof value === 'string' ? await expand(value) : value])))
    }
  }
  return result
}
