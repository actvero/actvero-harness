/** Serve the local Actvero Harness packaging form and run the existing package command. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { normalizeActveroBuildProfile, type ActveroBuildProfile } from './actvero-build-profile.ts'

export const BUILDER_DIRECTORY = '.actvero-builder'
export const PRESET_DIRECTORY = join(BUILDER_DIRECTORY, 'presets')
export const ASSET_DIRECTORY = join(BUILDER_DIRECTORY, 'assets')
const MAX_ASSET_BYTES = 8 * 1024 * 1024
const ASSET_KINDS = ['icon', 'logo', 'trayIcon'] as const
const ASSET_EXTENSIONS = new Set(['.svg', '.png'])
const TARGETS = new Set(['win-x64', 'mac-arm64', 'mac-x64'])
const FORMATS = new Set(['exe', 'dmg', 'zip', 'all'])
type AssetKind = typeof ASSET_KINDS[number]
type BuilderFormat = 'exe' | 'dmg' | 'zip' | 'all'
interface UploadedAsset { name: string; data: string }
interface BuilderInput {
  presetSlug: string | undefined
  presetName: string
  productName: string | undefined
  version: string | undefined
  platformUrl: string | undefined
  target: string
  format: BuilderFormat
  output: string
  minSystem: string | undefined
  notes: string | undefined
  assets?: Partial<Record<AssetKind, UploadedAsset>>
}
interface StoredPreset extends ActveroBuildProfile { readonly slug?: string }
interface BuildJob {
  id: string
  events: string[]
  subscribers: Set<ServerResponse>
  done: boolean
  ok: boolean
  artifacts: string[]
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const jobs = new Map<string, BuildJob>()

/** Convert a user-facing preset name into a stable filename component. */
export function presetSlug(value: string): string {
  const normalized = value.normalize('NFKC').trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80)
  return normalized || 'preset'
}

function localPath(path: string): string { return relative(root, resolve(root, path)).split(sep).join('/') }
function presetPath(slug: string): string { return join(root, PRESET_DIRECTORY, `${presetSlug(slug)}.json`) }
function assetPath(slug: string, kind: AssetKind, name: string): string { return join(root, ASSET_DIRECTORY, presetSlug(slug), `${kind}-${presetSlug(name)}${extname(name).toLowerCase()}`) }
function jsonResponse(response: ServerResponse, status: number, value: unknown): void { const body = JSON.stringify(value); response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' }); response.end(body) }
function textResponse(response: ServerResponse, status: number, body: string, contentType: string): void { response.writeHead(status, { 'content-type': contentType, 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' }); response.end(body) }
async function body(request: IncomingMessage): Promise<unknown> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
function stringField(value: unknown, name: string, max = 256, rejectControls = true): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > max || rejectControls && /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${name} is invalid`)
  return value
}
function input(value: unknown): BuilderInput {
  if (typeof value !== 'object' || value === null) throw new Error('builder input must be an object')
  const record = value as Record<string, unknown>
  const presetName = stringField(record.presetName, 'presetName', 80) ?? '未命名预设'
  const target = stringField(record.target, 'target') ?? 'win-x64'; if (!TARGETS.has(target)) throw new Error(`unsupported target ${target}`)
  const format = stringField(record.format, 'format') as BuilderFormat | undefined ?? 'exe'; if (!FORMATS.has(format)) throw new Error(`unsupported format ${format}`)
  const output = stringField(record.output, 'output', 512) ?? 'dist'
  const assets: Partial<Record<AssetKind, UploadedAsset>> = {}
  if (typeof record.assets === 'object' && record.assets !== null) for (const kind of ASSET_KINDS) {
    const asset = (record.assets as Record<string, unknown>)[kind]
    if (asset === undefined) continue
    if (typeof asset !== 'object' || asset === null || typeof (asset as Record<string, unknown>).name !== 'string' || typeof (asset as Record<string, unknown>).data !== 'string') throw new Error(`${kind} upload is invalid`)
    const upload = asset as { name: string; data: string }; const name = upload.name; const data = upload.data
    const extension = extname(name).toLowerCase(); if (!ASSET_EXTENSIONS.has(extension)) throw new Error(`${kind} must be SVG or PNG`)
    if (!data.startsWith('data:') || !data.includes(';base64,')) throw new Error(`${kind} upload is invalid`)
    const encoded = data.slice(data.indexOf(';base64,') + 8); const bytes = Buffer.from(encoded, 'base64'); if (bytes.length > MAX_ASSET_BYTES) throw new Error(`${kind} is too large`)
    assets[kind] = { name, data }
  }
  return { presetSlug: stringField(record.presetSlug, 'presetSlug', 80), presetName, productName: stringField(record.productName, 'productName', 80), version: stringField(record.version, 'version', 64), platformUrl: stringField(record.platformUrl, 'platformUrl', 512), target, format, output, minSystem: stringField(record.minSystem, 'minSystem', 256), notes: stringField(record.notes, 'notes', 262_144, false), assets }
}
function profileForInput(request: BuilderInput, assets: Partial<Record<AssetKind, string | undefined>>, baseConfig = 'actvero/product.json'): StoredPreset {
  return normalizeActveroBuildProfile({ schemaVersion: 1, name: request.presetName, baseConfig,
    ...(request.productName || request.version ? { product: { ...(request.productName ? { displayName: request.productName } : {}), ...(request.version ? { version: request.version } : {}) } } : {}),
    ...(request.platformUrl ? { platform: { defaultUrl: request.platformUrl } } : {}),
    ...(Object.keys(assets).length > 0 ? { branding: assets } : {}),
    package: { target: request.target, format: request.format, out: request.output, ...(request.minSystem ? { minSystem: request.minSystem } : {}), ...(request.notes ? { notes: request.notes } : {}) },
  })
}
async function previousPreset(slug: string): Promise<StoredPreset | undefined> {
  try { return await readPreset(slug) } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined; throw error }
}
async function saveInput(request: BuilderInput, slug = presetSlug(request.presetName)): Promise<StoredPreset> {
  const previous = await previousPreset(slug)
  await mkdir(join(root, PRESET_DIRECTORY), { recursive: true })
  const assets: Partial<Record<AssetKind, string | undefined>> = { ...previous?.branding }; if (request.assets && Object.keys(request.assets).length > 0) await mkdir(join(root, ASSET_DIRECTORY, slug), { recursive: true })
  for (const kind of ASSET_KINDS) { const asset = request.assets?.[kind]; if (!asset) continue; const path = assetPath(slug, kind, asset.name); const encoded = asset.data.slice(asset.data.indexOf(';base64,') + 8); await writeFile(path, Buffer.from(encoded, 'base64')); assets[kind] = localPath(path) }
  const stored = profileForInput(request, assets, previous?.baseConfig)
  await writeFile(presetPath(slug), `${JSON.stringify(stored, null, 2)}\n`); return stored
}
async function listPresets(): Promise<StoredPreset[]> {
  let names: string[]
  try { names = await readdir(join(root, PRESET_DIRECTORY)) } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error }
  const presets: StoredPreset[] = []
  for (const name of names.filter(value => value.endsWith('.json'))) { try { presets.push(normalizeActveroBuildProfile(JSON.parse(await readFile(join(root, PRESET_DIRECTORY, name), 'utf8'))) as StoredPreset) } catch { /* Ignore a partially-written local preset. */ } }
  return presets.sort((a, b) => a.name.localeCompare(b.name))
}
async function readPreset(slug: string): Promise<StoredPreset> { return normalizeActveroBuildProfile(JSON.parse(await readFile(presetPath(slug), 'utf8'))) as StoredPreset }
async function hydrateStoredAssets(request: BuilderInput, slug: string): Promise<BuilderInput> {
  const stored = await readPreset(slug); const assets: Partial<Record<AssetKind, UploadedAsset>> = { ...request.assets }
  for (const kind of ASSET_KINDS) { const path = stored.branding?.[kind]; if (assets[kind] || !path) continue; const absolute = resolve(root, path); const bytes = await readFile(absolute); const extension = extname(absolute).toLowerCase(); assets[kind] = { name: basename(absolute), data: `data:image/${extension === '.svg' ? 'svg+xml' : 'png'};base64,${bytes.toString('base64')}` } }
  return { ...request, assets }
}
async function materializeAssets(request: BuilderInput, jobId: string): Promise<Partial<Record<AssetKind, string>>> {
  const assets: Partial<Record<AssetKind, string>> = {}; const directory = join(root, ASSET_DIRECTORY, 'runs', jobId); await mkdir(directory, { recursive: true })
  for (const kind of ASSET_KINDS) { const asset = request.assets?.[kind]; if (!asset) continue; const path = join(directory, `${kind}${extname(asset.name).toLowerCase()}`); const encoded = asset.data.slice(asset.data.indexOf(';base64,') + 8); await writeFile(path, Buffer.from(encoded, 'base64')); assets[kind] = localPath(path) }
  return assets
}
function emit(job: BuildJob, event: object): void { const message = `data: ${JSON.stringify(event)}\n\n`; job.events.push(message); for (const subscriber of job.subscribers) subscriber.write(message) }
function environmentFor(profilePath: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, ACTVERO_BUILD_PROFILE: profilePath }
  for (const key of ['CONFIG', 'TARGET', 'FORMAT', 'OUT', 'NAME', 'VERSION', 'ICON', 'LOGO', 'TRAY_ICON', 'PLATFORM_URL', 'DOWNLOAD_BASE_URL', 'RELEASE_DATE', 'NOTES', 'MIN_SYSTEM']) {
    delete environment[`ACTVERO_BUILD_${key}`]
  }
  return environment
}
async function runBuild(request: BuilderInput, check: boolean, job: BuildJob): Promise<void> {
  const assets = await materializeAssets(request, job.id); const profile = profileForInput(request, assets); const profilePath = join(root, ASSET_DIRECTORY, 'runs', job.id, 'profile.json'); await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`)
  const environment = environmentFor(localPath(profilePath))
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'; const args = ['run', 'actvero:package']; if (check) args.push('--', '--check')
  emit(job, { type: 'log', line: `$ ${executable} ${args.join(' ')}` }); const child = spawn(executable, args, { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let artifactDirectory: string | undefined
  const forward = (chunk: Buffer) => chunk.toString().split(/\r?\n/u).filter(Boolean).forEach((line) => { const marker = 'ACTVERO package: installers and release.json at '; if (line.includes(marker)) artifactDirectory = line.slice(line.indexOf(marker) + marker.length).trim(); emit(job, { type: 'log', line }) })
  child.stdout.on('data', forward); child.stderr.on('data', forward)
  await new Promise<void>(resolvePromise => child.once('close', (code) => { job.ok = code === 0; job.done = true; job.artifacts = code === 0 && !check ? [artifactDirectory ?? resolve(root, request.output)] : []; emit(job, { type: 'done', ok: job.ok, artifacts: job.artifacts }); resolvePromise() }))
}
async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1'); const path = url.pathname
  if (request.method === 'GET' && path === '/') return textResponse(response, 200, await readFile(join(import.meta.dirname, 'actvero-builder.html'), 'utf8'), 'text/html; charset=utf-8')
  if (request.method === 'GET' && path === '/api/presets') return jsonResponse(response, 200, (await listPresets()).map(preset => ({ slug: preset.slug ?? presetSlug(preset.name), name: preset.name, target: preset.package?.target, format: preset.package?.format })))
  if (request.method === 'GET' && path.startsWith('/api/presets/')) { try { const slug = presetSlug(decodeURIComponent(path.slice('/api/presets/'.length))); const preset = await readPreset(slug); return jsonResponse(response, 200, { ...preset, slug }) } catch { return jsonResponse(response, 404, { error: 'preset not found' }) } }
  if (request.method === 'POST' && path === '/api/presets') { try { const requestInput = input(await body(request)); const slug = requestInput.presetSlug ? presetSlug(requestInput.presetSlug) : presetSlug(requestInput.presetName); const saved = await saveInput(requestInput, slug); return jsonResponse(response, 200, { ...saved, slug }) } catch (error) { return jsonResponse(response, 400, { error: error instanceof Error ? error.message : String(error) }) } }
  if (request.method === 'DELETE' && path.startsWith('/api/presets/')) { const slug = presetSlug(decodeURIComponent(path.slice('/api/presets/'.length))); await rm(presetPath(slug), { force: true }); await rm(join(root, ASSET_DIRECTORY, slug), { recursive: true, force: true }); return jsonResponse(response, 200, { ok: true }) }
  if (request.method === 'POST' && path === '/api/build') {
    try {
      const record = await body(request) as Record<string, unknown>; const requestInput = input(record); const preset = stringField(record.presetSlug, 'presetSlug', 80); const hydrated = preset ? await hydrateStoredAssets(requestInput, preset) : requestInput
      const job: BuildJob = { id: randomUUID(), events: [], subscribers: new Set(), done: false, ok: false, artifacts: [] }; jobs.set(job.id, job)
      void runBuild(hydrated, record.check === true, job).catch((error) => { job.done = true; job.ok = false; emit(job, { type: 'log', line: error instanceof Error ? error.message : String(error) }); emit(job, { type: 'done', ok: false, artifacts: [] }) }); return jsonResponse(response, 202, { id: job.id })
    } catch (error) { return jsonResponse(response, 400, { error: error instanceof Error ? error.message : String(error) }) }
  }
  if (request.method === 'GET' && path.startsWith('/api/build/') && path.endsWith('/events')) { const id = path.slice('/api/build/'.length, -'/events'.length); const job = jobs.get(id); if (!job) return jsonResponse(response, 404, { error: 'build not found' }); response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); job.events.forEach(event => response.write(event)); if (job.done) response.end(); else { job.subscribers.add(response); request.on('close', () => job.subscribers.delete(response)) } return }
  return textResponse(response, 404, 'Not found', 'text/plain; charset=utf-8')
}

async function main(): Promise<void> {
  const server = createServer((request, response) => { void route(request, response).catch(error => jsonResponse(response, 500, { error: error instanceof Error ? error.message : String(error) })) })
  const portIndex = process.argv.indexOf('--port'); const requestedPort = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 0
  server.on('error', (error) => { console.error(`Actvero Harness Builder: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
  server.listen(Number.isFinite(requestedPort) ? requestedPort : 0, '127.0.0.1', () => { const address = server.address(); if (address && typeof address !== 'string') console.log(`Actvero Harness Builder: http://127.0.0.1:${address.port}`) })
  process.once('SIGINT', () => server.close(() => process.exit(0))); process.once('SIGTERM', () => server.close(() => process.exit(0)))
}
if (import.meta.main) await main()
