/** Validate ACTVERO build inputs without changing the official desktop product. */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { valid } from 'semver'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** Validated public build defaults; asset paths are resolved relative to the selected JSON. */
export interface ProductConfig {
  readonly schemaVersion: 1
  readonly product: {
    readonly id: string
    readonly applicationId: string
    readonly displayName: string
    readonly version: string
    readonly defaultLocale: 'zh-CN' | 'en-US'
  }
  readonly branding: { readonly icon: string; readonly logo?: string; readonly trayIcon?: string }
  readonly platform: { readonly defaultUrl: string }
  readonly updates: { readonly enabled: boolean; readonly feedUrl: string | null }
  readonly plugins: readonly string[]
}

interface PluginPin {
  readonly id: string
  readonly package: string
  readonly version: string
  readonly source: 'workspace' | 'npm'
  readonly manifest?: string
  readonly integrity?: string
  readonly qualification: 'baseline-only' | 'migration-required' | 'qualified'
}

/** Public selected pins and upstream baseline; this metadata does not install plugins. */
export interface ProductAssembly {
  readonly assemblyStatus: 'configuration-only'
  readonly config: ProductConfig
  readonly upstream: {
    readonly schemaVersion: 1
    readonly repository: string
    readonly branch: string
    readonly tag: string
    readonly commit: string
    readonly version: string
  }
  readonly plugins: readonly PluginPin[]
}

function record(value: unknown, keys: readonly string[] | null, subject: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${subject}: expected an object`)
  }
  for (const key of Object.keys(value)) {
    if (keys !== null && !keys.includes(key)) throw new Error(`${subject}: unsupported field ${key}`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, subject: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${subject}: expected a nonempty string`)
  return value
}

function version(value: unknown, subject: string): string {
  const result = text(value, subject)
  if (valid(result) !== result) throw new Error(`${subject}: expected an exact version`)
  return result
}

function schema(value: unknown, subject: string): 1 {
  if (value !== 1) throw new Error(`${subject}: expected schemaVersion 1`)
  return value
}

function url(value: unknown, subject: string): string {
  const result = new URL(text(value, subject))
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(result.hostname)
  if (!(result.protocol === 'https:' || result.protocol === 'http:' && loopback)
    || result.username !== '' || result.password !== '' || result.search !== '' || result.hash !== '') {
    throw new Error(`${subject}: use HTTPS, or loopback HTTP, without credentials, query or fragment`)
  }
  return result.href.replace(/\/$/u, '')
}

/**
 * Parse public build configuration and reject unsupported or secret-bearing fields.
 * @param value - JSON value read from the product file.
 * @returns Validated configuration; a runtime address override is not read here.
 */
export function validateProductConfig(value: unknown): ProductConfig {
  const input = record(value, ['schemaVersion', 'product', 'branding', 'platform', 'updates', 'plugins'], 'product config')
  const product = record(input.product, ['id', 'applicationId', 'displayName', 'version', 'defaultLocale'], 'product')
  const branding = record(input.branding, ['icon', 'logo', 'trayIcon'], 'branding')
  const platform = record(input.platform, ['defaultUrl'], 'platform')
  const updates = record(input.updates, ['enabled', 'feedUrl'], 'updates')
  const displayName = text(product.displayName, 'product.displayName')
  if (displayName.length > 80 || /[<>:"/\\|?*\p{Cc}]/u.test(displayName) || displayName.trim() !== displayName || displayName.endsWith('.')) throw new Error('product.displayName: use a portable application name, up to 80 characters')
  const id = text(product.id, 'product.id')
  const applicationId = text(product.applicationId, 'product.applicationId')
  if (!/^[a-z][a-z0-9-]*$/u.test(id)) throw new Error('product.id: expected a lowercase identifier')
  if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u.test(applicationId)) throw new Error('product.applicationId: expected a reverse-domain identifier')
  if (product.defaultLocale !== 'zh-CN' && product.defaultLocale !== 'en-US') throw new Error('product.defaultLocale: unsupported locale')
  if (typeof updates.enabled !== 'boolean') throw new Error('updates.enabled: expected a boolean')
  const feedUrl = updates.feedUrl === null ? null : url(updates.feedUrl, 'updates.feedUrl')
  if (updates.enabled && feedUrl === null) throw new Error('updates.feedUrl: required when updates are enabled')
  if (feedUrl !== null && /(^|\.)deepseek\.com$/u.test(new URL(feedUrl).hostname)) throw new Error('updates.feedUrl: an ACTVERO feed must not use the official DeepSeek service')
  if (!Array.isArray(input.plugins)) throw new Error('plugins: expected a list of preset identifiers')
  const plugins: string[] = input.plugins.map((entry: unknown) => text(entry, 'plugins'))
  if (new Set(plugins).size !== plugins.length) throw new Error('plugins: duplicate preset identifier')
  return {
    schemaVersion: schema(input.schemaVersion, 'product config'),
    product: { id, applicationId, displayName,
      version: version(product.version, 'product.version'), defaultLocale: product.defaultLocale },
    branding: { icon: text(branding.icon, 'branding.icon'),
      ...(branding.logo === undefined ? {} : { logo: text(branding.logo, 'branding.logo') }),
      ...(branding.trayIcon === undefined ? {} : { trayIcon: text(branding.trayIcon, 'branding.trayIcon') }) },
    platform: { defaultUrl: url(platform.defaultUrl, 'platform.defaultUrl') },
    updates: { enabled: updates.enabled, feedUrl },
    plugins,
  }
}

function json(path: string): unknown { return JSON.parse(readFileSync(path, 'utf8')) }

function pluginPin(value: unknown): PluginPin {
  const input = record(value, ['id', 'package', 'version', 'source', 'manifest', 'integrity', 'qualification'], 'plugin pin')
  if (input.source !== 'workspace' && input.source !== 'npm') throw new Error('plugin pin: unsupported source')
  if (input.qualification !== 'baseline-only' && input.qualification !== 'migration-required' && input.qualification !== 'qualified') {
    throw new Error('plugin pin: unsupported qualification')
  }
  const name = text(input.package, 'plugin package')
  if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/u.test(name)) throw new Error('plugin package: expected an npm package name')
  const result = { id: text(input.id, 'plugin id'), package: name, version: version(input.version, 'plugin version'),
    source: input.source, qualification: input.qualification }
  if (input.source === 'workspace') {
    const manifest = text(input.manifest, 'plugin manifest')
    if (!/^packages\/[a-z0-9-]+\/[a-z0-9-]+\/package\.json$/u.test(manifest) || input.integrity !== undefined) {
      throw new Error('plugin manifest: expected a repository package manifest without npm integrity')
    }
    return { ...result, source: 'workspace', qualification: input.qualification, manifest }
  }
  const integrity = text(input.integrity, 'plugin integrity')
  if (!/^sha512-[A-Za-z0-9+/]{86}==$/u.test(integrity) || input.manifest !== undefined) {
    throw new Error('plugin integrity: expected a SHA-512 npm digest without a workspace manifest')
  }
  return { ...result, source: 'npm', qualification: input.qualification, integrity }
}

/**
 * Resolve selected pins and check that official workspace versions match the recorded baseline.
 * @param root - Repository directory containing the ACTVERO configuration and upstream workspaces.
 * @param configPath - Product JSON path relative to the repository, or absolute.
 * @returns Deterministic public assembly metadata; no plugin installation or activation occurs.
 */
export function readProductAssembly(root: string, configPath = 'actvero/product.json'): ProductAssembly {
  const config = validateProductConfig(json(resolve(root, configPath)))
  const upstream = record(json(join(root, 'actvero', 'upstream.lock.json')), ['schemaVersion', 'repository', 'branch', 'tag', 'commit', 'version'], 'upstream lock')
  const commit = text(upstream.commit, 'upstream commit')
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error('upstream commit: expected a full Git revision')
  const upstreamVersion = version(upstream.version, 'upstream version')
  const rootManifest = record(json(join(root, 'package.json')), null, 'root manifest')
  if (rootManifest.version !== upstreamVersion) throw new Error('upstream version: differs from the repository package version')
  const lock = record(json(join(root, 'actvero', 'plugins.lock.json')), ['schemaVersion', 'plugins'], 'plugins lock')
  schema(lock.schemaVersion, 'plugins lock')
  if (!Array.isArray(lock.plugins)) throw new Error('plugins lock: expected a plugin list')
  const pins: PluginPin[] = lock.plugins.map((entry: unknown) => pluginPin(entry))
  if (new Set(pins.map(pin => pin.id)).size !== pins.length) throw new Error('plugins lock: duplicate plugin identifier')
  const plugins = config.plugins.map((id) => {
    const pin = pins.find(entry => entry.id === id)
    if (pin === undefined) throw new Error(`plugins lock: missing pin for ${id}`)
    if (pin.source === 'workspace' && pin.manifest !== undefined) {
      const manifestValue: unknown = json(join(root, pin.manifest))
      const manifest = record(manifestValue, null, pin.manifest)
      if (manifest.name !== pin.package || manifest.version !== pin.version || pin.version !== upstreamVersion) {
        throw new Error(`plugins lock: workspace pin differs from ${pin.manifest}`)
      }
    }
    return pin
  })
  return { assemblyStatus: 'configuration-only', config,
    upstream: { schemaVersion: schema(upstream.schemaVersion, 'upstream lock'),
      repository: url(upstream.repository, 'upstream repository'), branch: text(upstream.branch, 'upstream branch'),
      tag: text(upstream.tag, 'upstream tag'), commit, version: upstreamVersion }, plugins }
}

/**
 * Override all baseline state and debug locations so inherited settings cannot select a user's profile.
 * @param root - Current repository directory.
 * @param id - Validated product identifier.
 * @param environment - Parent process environment.
 * @returns Child environment for the official development launcher.
 */
export function baselineEnvironment(root: string, id: string, environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const directory = join(root, 'apps', 'desktop', '.desktop-build', `${id}-baseline`)
  return { ...environment, DSH_HOME: join(directory, 'home'),
    DSH_DESKTOP_USER_DATA_DIR: join(directory, 'electron-user-data'),
    DSH_DESKTOP_MAIN_INSPECT_PORT: id.endsWith('-account') ? '19429' : '19329', DSH_DESKTOP_RENDERER_DEBUG_PORT: id.endsWith('-account') ? '19422' : '19322',
    DSH_DESKTOP_HOST_INSPECT_PORT: id.endsWith('-account') ? '19430' : '19330', DSH_DESKTOP_OPEN_DEVTOOLS: '0' }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ args: process.argv.slice(2).filter(value => value !== '--'), options: { check: { type: 'boolean' }, prepare: { type: 'boolean' },
    config: { type: 'string' }, baseline: { type: 'boolean' }, account: { type: 'boolean' }, 'skip-build': { type: 'boolean' } } })
  if ([values.check, values.prepare, values.baseline, values.account].filter(Boolean).length !== 1 || values['skip-build'] && !values.baseline && !values.account) {
    throw new Error('ACTVERO: choose exactly one of --check, --prepare, --baseline or --account; --skip-build requires a desktop mode')
  }
  const root = resolve(import.meta.dirname, '..')
  const assembly = readProductAssembly(root, values.config)
  const { prepareProductBranding } = await import('../apps/desktop/scripts/actvero-branding.ts')
  const branding = await prepareProductBranding(root, values.config)
  console.log(`ACTVERO: ${assembly.config.product.version}, DSH ${assembly.upstream.version}; configuration-only, not a packaged product`)
  if (values.check) return
  if (values.prepare) {
    const directory = join(root, '.artifacts', 'actvero')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'product.json'), `${JSON.stringify(assembly, null, 2)}\n`)
    console.log('ACTVERO: wrote .artifacts/actvero/product.json; public defaults prepared; plugin presets are not installed')
    return
  }
  const environment = baselineEnvironment(root, values.account ? `${assembly.config.product.id}-account` : assembly.config.product.id, process.env)
  environment.ACTVERO_DESKTOP = values.account ? '1' : '0'
  environment.ACTVERO_PRODUCT_CONFIG = resolve(root, values.config ?? 'actvero/product.json')
  environment.ACTVERO_ICON_PATH = join(branding.directory, 'icon.png')
  const invocation = pnpmInvocation(['run', values['skip-build'] ? 'start:desktop' : 'dev:desktop'], environment)
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, { cwd: root, env: environment, stdio: 'inherit' })
    const interrupt = (): void => { child.kill('SIGINT') }
    const terminate = (): void => { child.kill('SIGTERM') }
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', terminate)
      if (code === 0) resolvePromise()
      else reject(new Error(`ACTVERO baseline: launcher exited with ${String(code ?? signal)}`))
    })
  })
}

// Branding imports the validator here; CLI evaluation must finish before that dynamic import.
if (import.meta.main) void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
