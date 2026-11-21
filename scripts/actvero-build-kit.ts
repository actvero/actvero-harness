/** Create, exchange, and build local ACTVERO product configurations. */
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, constants, copyFileSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { unzipSync, zipSync } from 'fflate'
import { normalizeActveroBuildProfile, readActveroBuildProfile, type ActveroBuildProfile } from './actvero-build-profile.ts'
import { resolveActveroBuildRequest } from './actvero-package.ts'
import { rasterActveroArtwork } from '../apps/desktop/scripts/actvero-branding.ts'
import { readProductAssembly, validateProductConfig } from './actvero-product.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

const root = resolve(import.meta.dirname, '..')
const local = join(root, '.actvero-builder')
const kits = join(local, 'kits')
const maxFileSize = 8 * 1024 * 1024
const maxKitSize = 32 * 1024 * 1024
const maxFiles = 24
const targets = ['mac-arm64', 'mac-x64', 'win-arm64', 'win-x64'] as const
type Target = typeof targets[number]
type Files = Map<string, Uint8Array>
const productFile = (id: string) => `products/${id}/product.json`
const profileFile = (target: Target) => `presets/${target}.json`
const asJson = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n')
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function fields(value: unknown, keys: readonly string[] | null, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected an object`)
  const entries = Object.entries(value)
  for (const [key] of entries) {
    if (keys && !keys.includes(key)) throw new Error(`${label}: unsupported field ${key}`)
  }
  return Object.fromEntries(entries)
}

function slug(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(value)
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/u.test(value)) throw new Error('Expected a portable lowercase ID (letters, digits, hyphens)')
  return value
}

function portable(path: string): boolean {
  const parts = path.split('/')
  return path.length <= 200 && parts.length <= 3
    && parts.every(part => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(part) && !part.endsWith('.')
      && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part))
}

function limitedFile(path: string, limit: number): Buffer {
  const info = lstatSync(path)
  if (!info.isFile() || info.size > limit) throw new Error(`Expected a regular file up to ${limit} bytes: ${path}`)
  return readFileSync(path)
}

function readFiles(path: string): Files {
  let total = 0
  const seen = new Set<string>()
  const files: Files = new Map()
  const check = (name: string, size: number) => {
    total += size
    if (!portable(name) || seen.has(name.toLowerCase())) throw new Error(`Unsafe or repeated build kit path: ${name}`)
    if (size > maxFileSize || total > maxKitSize || seen.size === maxFiles) throw new Error('Build kit exceeds the file or size limit')
    seen.add(name.toLowerCase())
  }
  const visit = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name
      if (!portable(name)) throw new Error(`Unsafe build kit path: ${name}`)
      const child = join(directory, entry.name)
      if (entry.isDirectory() && name.split('/').length < 3) visit(child, name + '/')
      else if (entry.isFile()) {
        const bytes = limitedFile(child, maxFileSize)
        check(name, bytes.length)
        files.set(name, bytes)
      } else throw new Error(`Expected a regular build kit file: ${name}`)
    }
  }
  if (lstatSync(path).isDirectory()) visit(path, '')
  else {
    if (extname(path).toLowerCase() !== '.zip') throw new Error('Expected a build kit directory or .zip file')
    const unpacked = unzipSync(limitedFile(path, maxKitSize), { filter: (entry) => {
      check(entry.name, Math.max(entry.size, entry.originalSize))
      return true
    } })
    for (const [name, bytes] of Object.entries(unpacked)) files.set(name, bytes)
  }
  return files
}

function parseFile(files: Files, file: string): unknown {
  const bytes = files.get(file)
  if (!bytes) throw new Error(`Missing build kit file: ${file}`)
  return JSON.parse(Buffer.from(bytes).toString('utf8'))
}

function lockHashes() {
  return { upstream: sha256(readFileSync(join(root, 'actvero/upstream.lock.json'))),
    plugins: sha256(readFileSync(join(root, 'actvero/plugins.lock.json'))) }
}

function buildTargets(value: unknown): Target[] {
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length) throw new Error('targets: expected unique build targets')
  return value.map((entry: unknown) => {
    const target = targets.find(candidate => candidate === entry)
    if (!target) throw new Error(`Unsupported build target: ${String(entry)}`)
    return target
  })
}

function validate(files: Files) {
  const manifest = fields(parseFile(files, 'manifest.json'), ['schemaVersion', 'id', 'productId', 'locks', 'targets', 'files'], 'manifest')
  if (manifest.schemaVersion !== 1) throw new Error('manifest.schemaVersion: expected 1')
  const id = slug(manifest.id)
  const productId = slug(manifest.productId)
  const supportedTargets = buildTargets(manifest.targets)
  const locks = fields(manifest.locks, ['upstream', 'plugins'], 'manifest.locks')
  const current = lockHashes()
  if (locks.upstream !== current.upstream || locks.plugins !== current.plugins) throw new Error('Build kit lock fingerprints differ from this source checkout')
  const expected = fields(manifest.files, null, 'manifest.files')
  if (Object.keys(expected).length !== files.size - 1) throw new Error('Build kit has missing or extra files')
  for (const [name, bytes] of files) {
    if (name !== 'manifest.json' && (!Object.hasOwn(expected, name) || expected[name] !== sha256(bytes))) throw new Error(`Build kit checksum mismatch: ${name}`)
  }

  const product = validateProductConfig(parseFile(files, productFile(productId)))
  if (product.product.id !== productId || product.updates.enabled || product.updates.feedUrl !== null) {
    throw new Error('Build kit must match its product ID and use the local unsigned update settings')
  }
  const defaultPlugins = readProductAssembly(root).config.plugins
  if (product.plugins.length !== defaultPlugins.length || product.plugins.some((plugin, index) => plugin !== defaultPlugins[index])) {
    throw new Error('Build kit must use the source checkout’s default plugin presets')
  }
  const referenced = new Set(['manifest.json', productFile(productId), ...supportedTargets.map(profileFile)])
  for (const asset of Object.values(product.branding)) {
    if (!portable(asset) || asset.includes('/') || !/\.(png|svg)$/iu.test(asset)) throw new Error(`Expected a local SVG or PNG: ${asset}`)
    const file = `products/${productId}/${asset}`
    if (!files.has(file) || files.get(file)?.length === 0) throw new Error(`Missing or empty artwork: ${file}`)
    referenced.add(file)
  }
  if (referenced.size !== files.size) throw new Error('Build kit contains files outside the product and preset references')
  for (const target of supportedTargets) {
    const path = profileFile(target)
    const raw = fields(parseFile(files, path), ['schemaVersion', 'name', 'baseConfig', 'package'], path)
    fields(raw.package, ['target', 'format'], path + '.package')
    const profile = normalizeActveroBuildProfile(raw)
    const format = profile.package?.format
    if (profile.baseConfig !== productFile(productId) || profile.package?.target !== target
      || (target.startsWith('win-') ? format !== 'exe' : format !== 'dmg' && format !== 'zip' && format !== 'all')) {
      throw new Error(`Preset must reference its own product and match the target/format: ${path}`)
    }
  }
  return { id, productId, product, targets: supportedTargets }
}

function create(specPath: string): Files {
  const raw: unknown = JSON.parse(limitedFile(specPath, maxFileSize).toString('utf8'))
  const spec = fields(raw, ['id', 'product', 'platform', 'assistant', 'branding', 'targets'], 'spec')
  const id = slug(spec.id)
  const defaultPath = join(root, 'actvero/product.json')
  const defaults = readProductAssembly(root, defaultPath).config
  const given = fields(spec.product, ['id', 'applicationId', 'displayName', 'version', 'defaultLocale'], 'spec.product')
  const productId = slug(given.id)
  const selected = buildTargets(spec.targets)
  const customBranding = spec.branding !== undefined
  const branding = spec.branding === undefined ? {} : fields(spec.branding, ['icon', 'logo', 'wordmark', 'sidebarLogo', 'trayIcon'], 'spec.branding')
  const files: Files = new Map()
  const assets: Record<string, string> = {}
  for (const kind of ['icon', 'logo', 'wordmark', 'sidebarLogo', 'trayIcon'] as const) {
    const userPath = branding[kind]
    const defaultAsset = kind === 'icon' || !customBranding ? defaults.branding[kind] : undefined
    const asset = userPath === undefined ? defaultAsset : userPath
    if (asset === undefined) continue
    if (typeof asset !== 'string' || asset.trim() === '') throw new Error(`spec.branding.${kind}: expected an artwork path`)
    const source = resolve(dirname(userPath === undefined ? defaultPath : specPath), asset)
    const extension = extname(source).toLowerCase()
    if (!['.svg', '.png'].includes(extension)) throw new Error(`Expected SVG/PNG artwork for ${kind}`)
    const filename = kind + extension
    assets[kind] = filename
    files.set(`products/${productId}/${filename}`, limitedFile(source, maxFileSize))
  }
  const product = validateProductConfig({
    schemaVersion: 1, product: { defaultLocale: defaults.product.defaultLocale, ...given },
    branding: assets, platform: spec.platform ?? defaults.platform, updates: { enabled: false, feedUrl: null },
    plugins: defaults.plugins, ...(spec.assistant === undefined ? {} : { assistant: spec.assistant }),
  })
  files.set(productFile(productId), asJson(product))
  for (const target of selected) {
    files.set(profileFile(target), asJson({ schemaVersion: 1, name: `${product.product.displayName} · ${target}`,
      baseConfig: productFile(productId), package: { target, format: target.startsWith('win-') ? 'exe' : 'dmg' } }))
  }
  files.set('manifest.json', asJson({ schemaVersion: 1, id, productId, targets: selected, locks: lockHashes(),
    files: Object.fromEntries([...files].map(([path, bytes]) => [path, sha256(bytes)])) }))
  if ([...files.values()].reduce((total, bytes) => total + bytes.length, 0) > maxKitSize) throw new Error('Build kit exceeds the total size limit')
  return files
}

async function inspect(files: Files) {
  const kit = validate(files)
  for (const [kind, asset] of Object.entries(kit.product.branding)) {
    const path = `products/${kit.productId}/${asset}`
    const data = files.get(path)
    if (!data) throw new Error(`Missing artwork: ${path}`)
    try {
      await rasterActveroArtwork(Buffer.from(data), 64, kind === 'icon' || kind === 'trayIcon')
    } catch (error) {
      throw new Error(`Invalid artwork ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return kit
}

async function install(files: Files) {
  const kit = await inspect(files)
  const destination = join(kits, kit.id)
  mkdirSync(kits, { recursive: true })
  if (existsSync(destination)) {
    const existing = readFiles(destination)
    if (existing.size === files.size && [...files].every(([name, bytes]) => {
      const previous = existing.get(name)
      return previous !== undefined && Buffer.from(bytes).equals(previous)
    })) return { id: kit.id, path: destination, status: 'already-present' }
    throw new Error(`Build kit ID already exists with different files: ${kit.id}. Keep the existing kit and create a new revision ID.`)
  }
  const stage = mkdtempSync(join(kits, '.import-'))
  try {
    for (const [name, bytes] of files) {
      const file = join(stage, name)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, bytes, { flag: 'wx' })
    }
    renameSync(stage, destination)
  } finally { rmSync(stage, { recursive: true, force: true }) }
  return { id: kit.id, path: destination, status: 'installed' }
}

async function exportKit(id: string, output: string) {
  if (extname(output).toLowerCase() !== '.zip') throw new Error('Export path must end in .zip')
  const files = readFiles(join(kits, id))
  await inspect(files)
  mkdirSync(dirname(output), { recursive: true })
  const stage = mkdtempSync(join(dirname(output), '.kit-export-'))
  try {
    const archive = join(stage, 'kit.zip')
    writeFileSync(archive, zipSync(Object.fromEntries(files)))
    copyFileSync(archive, output, constants.COPYFILE_EXCL)
  } finally { rmSync(stage, { recursive: true, force: true }) }
  return { id, path: output }
}

function readCandidate(path: string, id: string, config?: string) {
  const profile: ActveroBuildProfile = readActveroBuildProfile(root, path).profile
  const product = readProductAssembly(root, config ?? profile.baseConfig).config.product
  const target = profile.package?.target
  return {
    id, path, config, name: profile.product?.displayName ?? product.displayName, version: profile.product?.version ?? product.version,
    target, format: profile.package?.format, compatible: target !== undefined && target === hostTarget(),
  }
}
type Candidate = ReturnType<typeof readCandidate>

function hostTarget() {
  return process.platform === 'darwin' ? `mac-${process.arch}`
    : process.platform === 'win32' ? `win-${process.arch}` : undefined
}

function catalog() {
  const presets: Candidate[] = []
  const errors: { path: string; error: string }[] = []
  function add(path: string, read: () => void) {
    try { read() } catch (error) { errors.push({ path, error: error instanceof Error ? error.message : String(error) }) }
  }
  const legacy = join(local, 'presets')
  if (existsSync(legacy)) for (const entry of readdirSync(legacy, { withFileTypes: true })) {
    if (!entry.isFile() || extname(entry.name) !== '.json') continue
    const path = join(legacy, entry.name)
    add(path, () => presets.push(readCandidate(path, `local:${basename(entry.name, '.json')}`)))
  }
  if (existsSync(kits)) for (const entry of readdirSync(kits, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const path = join(kits, entry.name)
    add(path, () => {
      const kit = validate(readFiles(path))
      if (kit.id !== entry.name) throw new Error('Directory and manifest IDs differ')
      for (const target of kit.targets) {
        presets.push(readCandidate(join(path, profileFile(target)), `kit:${kit.id}/${target}`, join(path, productFile(kit.productId))))
      }
    })
  }
  const product = readProductAssembly(root).config.product
  for (const target of targets) {
    presets.push({ id: `default:${target}`, path: '', config: join(root, 'actvero/product.json'),
      name: product.displayName, version: product.version, target, format: target.startsWith('win-') ? 'exe' : 'dmg',
      compatible: target === hostTarget() })
  }
  return { host: hostTarget() ?? null, presets: presets.sort((a, b) => a.id.localeCompare(b.id)), errors }
}

function runPackage(args: string[], environment: NodeJS.ProcessEnv, log: number): Promise<void> {
  const command = pnpmInvocation(['run', 'actvero:package', ...args], environment)
  return new Promise((done, reject) => {
    const child = spawn(command.command, command.args, { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (bytes: Buffer) => {
      writeFileSync(log, bytes)
      process.stderr.write(bytes)
    })
    const interrupt = () => { child.kill('SIGINT') }
    const terminate = () => { child.kill('SIGTERM') }
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    child.once('error', (error) => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); reject(error) })
    child.once('close', (code, signal) => {
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', terminate)
      if (code === 0) done()
      else reject(new Error(`Packaging command exited with ${String(code ?? signal)}`))
    })
  })
}

async function verifyRelease(output: string, formats: readonly string[]) {
  const value: unknown = JSON.parse(readFileSync(join(output, 'release.json'), 'utf8'))
  const release = fields(value, null, 'release.json')
  if (!Array.isArray(release.artifacts) || release.artifacts.length !== formats.length) throw new Error('Unexpected number of installer artifacts')
  const remaining = new Set(formats)
  const artifacts = []
  for (const value of release.artifacts) {
    const artifact = fields(value, null, 'release.artifacts entry')
    const { file_name: name, file_size: size, sha256: digest } = artifact
    if (typeof name !== 'string' || basename(name) !== name || !remaining.delete(extname(name).slice(1))) throw new Error('Unexpected installer filename')
    const path = join(output, name)
    const info = lstatSync(path)
    if (!info.isFile() || info.size === 0 || info.size !== size) throw new Error(`Invalid installer: ${name}`)
    const hash = createHash('sha256')
    const chunks: AsyncIterable<Uint8Array> = createReadStream(path)
    for await (const chunk of chunks) hash.update(chunk)
    if (hash.digest('hex') !== digest) throw new Error(`Installer does not match release.json: ${name}`)
    artifacts.push({ path, size, sha256: digest })
  }
  return artifacts
}

async function build(id: string, out: string | undefined, check: boolean, allowDirty: boolean) {
  const candidate = catalog().presets.find(preset => preset.id === id)
  if (!candidate) throw new Error(`Unknown or invalid preset: ${id}. Run list to inspect available presets and errors.`)
  const { target } = candidate
  if (!target || !candidate.compatible) throw new Error(`Preset target ${candidate.target} requires a matching Node host (this host: ${hostTarget() ?? 'unsupported'}).`)
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== ''
  if (dirty && !check && !allowDirty) throw new Error('Source has local changes. Review them first, then explicitly use --allow-dirty if intended.')
  const run = `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`
  const directory = out ?? join(local, 'results', run)
  const args = ['--out', directory, '--target', target, '--format', candidate.format ?? 'all']
  if (candidate.path) args.push('--profile', candidate.path)
  if (candidate.config) args.push('--config', candidate.config)
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('ACTVERO_BUILD_')))
  const request = resolveActveroBuildRequest(root, ['--package', ...args], environment)
  const { output } = request
  if (output === undefined) throw new Error('Build kit requires an installer output directory')
  const logPath = join(local, 'logs', run + '.log')
  mkdirSync(dirname(logPath), { recursive: true })
  const lock = join(local, 'kit-build.lock')
  let guard: number
  try { guard = openSync(lock, 'wx') }
  catch (error) {
    if (existsSync(lock)) throw new Error(`A build-kit run owns ${lock}. Check its PID and log before starting another build.`)
    throw error
  }
  let log: number | undefined
  try {
    writeFileSync(guard, asJson({ pid: process.pid, preset: id, log: logPath }))
    log = openSync(logPath, 'wx')
    await runPackage([...args, '--check'], environment, log)
    const details = { preset: id, commit, dirty, version: request.config.product.version, target: request.target?.name, log: logPath }
    if (check) return { ...details, status: 'preflight-passed' }
    await runPackage(args, environment, log)
    const artifacts = await verifyRelease(output, request.formats)
    return { ...details, status: 'built', output, release: join(output, 'release.json'), artifacts }
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}. Log: ${logPath}`)
  } finally {
    if (log !== undefined) closeSync(log)
    closeSync(guard)
    rmSync(lock)
  }
}

const usage = `pnpm run actvero:build-kit -- <command>
  list
  create --spec <json>
  validate <directory-or-zip>
  import <directory-or-zip>
  export --id <kit-id> --out <zip>
  build --preset <exact-preset-id> [--out <directory>] [--check] [--allow-dirty]

Results are JSON on stdout. Build progress is streamed to stderr and a local log.`

async function main() {
  const [command, ...args] = process.argv.slice(2).filter(argument => argument !== '--')
  if (command === undefined || command === '--help') { console.log(usage); return }
  const options = command === 'create' ? { spec: { type: 'string' as const } }
    : command === 'export' ? { id: { type: 'string' as const }, out: { type: 'string' as const } }
      : command === 'build' ? { preset: { type: 'string' as const }, out: { type: 'string' as const },
        check: { type: 'boolean' as const }, 'allow-dirty': { type: 'boolean' as const } } : {}
  const { positionals, values } = parseArgs({ args, options, allowPositionals: true })
  const fileCommand = command === 'validate' || command === 'import'
  if (positionals.length !== (fileCommand ? 1 : 0)) throw new Error(usage)
  function required(value: string | boolean | undefined, option: string): string {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing ${option}\n${usage}`)
    return value
  }
  let result: unknown
  switch (command) {
    case 'list': result = catalog(); break
    case 'create': result = await install(create(resolve(required(values.spec, '--spec')))); break
    case 'validate': {
      const path = resolve(required(positionals[0], '<directory-or-zip>'))
      const kit = await inspect(readFiles(path))
      result = { path, id: kit.id, productId: kit.productId, targets: kit.targets, status: 'valid' }
      break
    }
    case 'import': result = await install(readFiles(resolve(required(positionals[0], '<directory-or-zip>')))); break
    case 'export': result = await exportKit(slug(values.id), resolve(required(values.out, '--out'))); break
    case 'build': result = await build(required(values.preset, '--preset'), typeof values.out === 'string' ? resolve(required(values.out, '--out')) : undefined,
      values.check === true, values['allow-dirty'] === true); break
    default: throw new Error(usage)
  }
  console.log(JSON.stringify(result))
}

if (import.meta.main) await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
