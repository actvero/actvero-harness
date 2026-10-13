/** Resolve public packaging inputs and export verified installers with download-page metadata. */
import { createHash } from 'node:crypto'
import { accessSync, constants, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { copyFile, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { readProductAssembly, validateProductConfig, type ProductConfig } from './actvero-product.ts'
import { readActveroBuildProfile, type ActveroBuildProfile } from './actvero-build-profile.ts'
import { resolveDesktopPackageTarget, type DesktopPackageTarget } from '../apps/desktop/scripts/package-target.ts'
import { productAssetPath } from '../apps/desktop/scripts/actvero-branding.ts'

const stringOptions = ['profile', 'config', 'target', 'format', 'out', 'name', 'version', 'icon', 'logo', 'tray-icon',
  'platform-url', 'download-base-url', 'release-date', 'notes', 'min-system'] as const
const booleanOptions = ['package', 'dir', 'check', 'skip-prepare'] as const

/** Validated build inputs; download URLs describe planned hosting and never trigger an upload. */
export interface ActveroBuildRequest {
  readonly config: ProductConfig
  readonly sourceConfig: string
  readonly overridden: boolean
  readonly package: boolean
  readonly directory: boolean
  readonly check: boolean
  readonly skipPrepare: boolean
  readonly target: DesktopPackageTarget | undefined
  readonly formats: readonly ('dmg' | 'zip' | 'exe')[]
  readonly output: string | undefined
  readonly downloadBaseUrl: string | null
  readonly releaseDate: string | null
  readonly notes: string
  readonly minimumSystem: string | null
}

/** One final installer and the fields shown on the platform download form. */
export interface ActveroReleaseArtifact {
  readonly system: 'macos' | 'windows'
  readonly architecture: 'arm64' | 'x64'
  readonly file_name: string
  readonly file_size: number
  readonly sha256: string
  readonly minimum_system_requirement: string | null
  readonly download_url: string | null
  readonly download_url_status: 'planned' | 'not_provided'
}

/** Local build evidence; publication date, recommendation and hosting remain operator-owned. */
export interface ActveroReleaseManifest {
  readonly schemaVersion: 1
  readonly product: ProductConfig['product']
  readonly version: string
  readonly built_at: string
  readonly release_date: string | null
  readonly release_notes: string
  readonly signing: 'unsigned'
  readonly artifacts: readonly ActveroReleaseArtifact[]
}

function date(value: string | undefined): string | null {
  if (value === undefined) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('ACTVERO package: --release-date must be a real YYYY-MM-DD date')
  }
  return value
}

function hosting(value: string | undefined): string | null {
  if (value === undefined) return null
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('ACTVERO package: --download-base-url requires HTTPS without credentials, query or fragment')
  }
  return `${url.href.replace(/\/+$/u, '')}/`
}

/** Map a profile's public fields to the existing package option names. */
function profileDefaults(profile: ActveroBuildProfile | undefined): Partial<Record<typeof stringOptions[number], string | undefined>> {
  if (profile === undefined) return {}
  return {
    config: profile.baseConfig,
    name: profile.product?.displayName,
    version: profile.product?.version,
    'platform-url': profile.platform?.defaultUrl,
    icon: profile.branding?.icon,
    logo: profile.branding?.logo,
    'tray-icon': profile.branding?.trayIcon,
    target: profile.package?.target,
    format: profile.package?.format,
    out: profile.package?.out,
    'download-base-url': profile.package?.downloadBaseUrl,
    'release-date': profile.package?.releaseDate,
    'min-system': profile.package?.minSystem,
  }
}

/**
 * Validate CLI arguments and Make environment values before starting a build.
 * @param root - Repository directory; relative CLI asset and output paths start here.
 * @param args - Explicit CLI arguments; these override ACTVERO_BUILD_* environment values.
 * @param environment - Make variables mapped to the ACTVERO_BUILD_* namespace.
 * @param host - Node process platform and architecture used to qualify the target.
 * @returns Selected configuration and packaging options; source files remain unchanged.
 */
export function resolveActveroBuildRequest(root: string, args: readonly string[], environment: NodeJS.ProcessEnv = process.env,
  host: { readonly platform: NodeJS.Platform; readonly architecture: string } = { platform: process.platform, architecture: process.arch },
): ActveroBuildRequest {
  const options = { ...Object.fromEntries(stringOptions.map(key => [key, { type: 'string' as const }])),
    ...Object.fromEntries(booleanOptions.map(key => [key, { type: 'boolean' as const }])) }
  const { values } = parseArgs({ args: args.filter(value => value !== '--'), options })
  const profileArgument = values.profile
  if (profileArgument !== undefined && typeof profileArgument !== 'string') throw new Error('ACTVERO build: --profile requires text')
  const selectedProfile = profileArgument ?? environment.ACTVERO_BUILD_PROFILE
  const profile = selectedProfile === undefined || selectedProfile === '' ? undefined : readActveroBuildProfile(root, selectedProfile).profile
  const defaults = profileDefaults(profile)
  const strings = Object.fromEntries(stringOptions.map((key) => {
    const explicit = values[key]
    if (explicit !== undefined && typeof explicit !== 'string') throw new Error(`ACTVERO build: --${key} requires text`)
    const environmentValue = environment[`ACTVERO_BUILD_${key.replaceAll('-', '_').toUpperCase()}`]
    const value = explicit ?? (environmentValue === undefined || environmentValue === '' ? defaults[key] : environmentValue)
    return [key, value === '' ? undefined : value]
  })) as Partial<Record<typeof stringOptions[number], string>>
  const boolean = (key: typeof booleanOptions[number]): boolean => {
    const value = values[key] ?? environment[`ACTVERO_BUILD_${key.replaceAll('-', '_').toUpperCase()}`]
    if (value === undefined || value === '' || value === '0' || value === false) return false
    if (value === true || value === '1') return true
    throw new Error(`ACTVERO build: ${key} expects 0 or 1 in Make`)
  }
  const packaged = boolean('package'), directory = boolean('dir'), check = boolean('check'), skipPrepare = boolean('skip-prepare')
  const packageKeys = ['target', 'format', 'out', 'download-base-url', 'release-date', 'notes', 'min-system'] as const
  if (!packaged && (directory || skipPrepare || packageKeys.some(key => strings[key] !== undefined))) {
    throw new Error('ACTVERO build: packaging options require --package')
  }
  const sourceConfig = resolve(root, strings.config ?? 'actvero/product.json')
  const original = readProductAssembly(root, sourceConfig).config
  const assets = { icon: strings.icon, logo: strings.logo, trayIcon: strings['tray-icon'] }
  const overridden = [strings.name, strings.version, strings['platform-url'], ...Object.values(assets)].some(value => value !== undefined)
  const config = validateProductConfig({ ...original,
    product: { ...original.product, displayName: strings.name ?? original.product.displayName,
      version: strings.version ?? original.product.version },
    platform: { defaultUrl: strings['platform-url'] ?? original.platform.defaultUrl },
    branding: { ...original.branding, ...Object.fromEntries(Object.entries(assets).filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, relative(dirname(sourceConfig), resolve(root, value ?? '')).replaceAll('\\', '/')])),
    },
  })
  for (const asset of Object.values(config.branding)) productAssetPath(root, sourceConfig, asset)
  if (packaged && config.updates.enabled) throw new Error('ACTVERO build: unsigned packages require updates.enabled=false')
  const target = packaged ? resolveDesktopPackageTarget(
    strings.target ?? `${host.platform === 'darwin' ? 'mac' : 'win'}-${host.architecture}`, host.platform, host.architecture) : undefined
  const format = strings.format ?? 'all'
  if (!['all', 'dmg', 'zip', 'exe'].includes(format)) throw new Error('ACTVERO package: --format must be dmg, zip, exe or all')
  const installerKeys = ['format', 'out', 'download-base-url', 'release-date', 'notes', 'min-system'] as const
  if (directory && installerKeys.some(key => strings[key] !== undefined)) {
    throw new Error('ACTVERO package: --dir cannot be combined with installer format, output or release metadata')
  }
  if (target && (target.platform === 'win32' ? !['all', 'exe'].includes(format) : format === 'exe')) {
    throw new Error('ACTVERO package: format does not match the target system')
  }
  const formats: ActveroBuildRequest['formats'] = !target || directory ? [] : target.platform === 'win32' ? ['exe']
    : format === 'dmg' ? ['dmg'] : format === 'zip' ? ['zip'] : ['dmg', 'zip']
  const minimumSystem = strings['min-system'] ?? null
  if (minimumSystem !== null && (minimumSystem.length > 256 || /\p{Cc}/u.test(minimumSystem))) throw new Error('ACTVERO package: --min-system requires up to 256 characters without controls')
  let notes = profile?.package?.notes ?? ''
  if (strings.notes !== undefined) {
    const bytes = readFileSync(resolve(root, strings.notes))
    if (bytes.length > 262_144) throw new Error('ACTVERO package: --notes file exceeds 256 KiB')
    notes = bytes.toString('utf8')
  }
  return { config, sourceConfig, overridden, package: packaged, directory, check, skipPrepare, target, formats,
    output: target && !directory ? join(resolve(root, strings.out ?? 'dist'), config.product.id, config.product.version, target.name) : undefined,
    downloadBaseUrl: hosting(strings['download-base-url']), releaseDate: date(strings['release-date']), notes, minimumSystem }
}

/**
 * Materialize overrides in the build cache, with artwork paths rebased to their original files.
 * @param root - Repository directory.
 * @param request - Validated build request.
 * @returns Configuration path for all subprocesses; the original JSON is never edited.
 */
export function prepareActveroBuildConfiguration(root: string, request: ActveroBuildRequest): string {
  if (!request.overridden) return request.sourceConfig
  const fingerprint = createHash('sha256').update(JSON.stringify(request.config)).update(request.sourceConfig).digest('hex')
  const path = join(root, 'apps/desktop/.desktop-build/actvero/configs', fingerprint, 'product.json')
  const branding = Object.fromEntries(Object.entries(request.config.branding).map(([key, asset]) => [key,
    relative(dirname(path), productAssetPath(root, request.sourceConfig, asset)).replaceAll('\\', '/')]))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ ...request.config, branding }, null, 2)}\n`)
  return path
}

/**
 * Reject an occupied destination or unwritable parent before expensive preparation or file replacement.
 * @param output - Final product/version/target directory.
 */
export function assertActveroOutputAvailable(output: string): void {
  if (existsSync(output)) throw new Error(`ACTVERO package: output already exists: ${output}; choose another --out or version`)
  let ancestor = dirname(output)
  while (!existsSync(ancestor)) ancestor = dirname(ancestor)
  if (!statSync(ancestor).isDirectory()) throw new Error(`ACTVERO package: output parent is not a directory: ${ancestor}`)
  accessSync(ancestor, constants.W_OK)
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256')
  const chunks: AsyncIterable<Uint8Array> = createReadStream(path)
  for await (const chunk of chunks) hash.update(chunk)
  return hash.digest('hex')
}

/**
 * Copy successful installers and calculate metadata from the copied final bytes.
 * @param request - Validated package inputs; unpacked applications are not exported.
 * @param source - Internal electron-builder output directory, after runtime checks pass.
 * @returns Final release metadata; failures remove only this call's temporary staging directory.
 */
export async function exportActveroRelease(request: ActveroBuildRequest, source: string): Promise<ActveroReleaseManifest> {
  if (!request.output || !request.target || request.directory) throw new Error('ACTVERO package: release export requires installer output')
  const output = request.output, target = request.target, product = request.config.product
  assertActveroOutputAvailable(output)
  mkdirSync(dirname(output), { recursive: true })
  const staging = await mkdtemp(join(dirname(output), '.actvero-export-'))
  try {
    const artifacts: ActveroReleaseArtifact[] = []
    for (const extension of request.formats) {
      const fileName = `${product.id}-${product.version}-${target.platform === 'darwin' ? 'mac' : 'win'}-${target.arch}-unsigned.${extension}`
      const path = join(staging, fileName)
      await copyFile(join(source, fileName), path)
      const size = (await stat(path)).size
      if (size === 0) throw new Error(`ACTVERO package: installer is empty: ${fileName}`)
      const downloadPath = [product.id, product.version, target.name, fileName].map(encodeURIComponent).join('/')
      artifacts.push({ system: target.platform === 'darwin' ? 'macos' : 'windows', architecture: target.arch,
        file_name: fileName, file_size: size, sha256: await digest(path), minimum_system_requirement: request.minimumSystem,
        download_url: request.downloadBaseUrl === null ? null : new URL(downloadPath, request.downloadBaseUrl).href,
        download_url_status: request.downloadBaseUrl === null ? 'not_provided' : 'planned' })
    }
    const manifest: ActveroReleaseManifest = { schemaVersion: 1, product, version: product.version,
      built_at: new Date().toISOString(), release_date: request.releaseDate, release_notes: request.notes, signing: 'unsigned', artifacts }
    const info = [`应用名称：${product.displayName}`, `版本号：${product.version}`, `发布日期：${request.releaseDate ?? '待发布时确定'}`,
      '签名状态：未签名', ...artifacts.flatMap(artifact => ['', `系统：${artifact.system}`, `架构：${artifact.architecture}`,
        `文件名：${artifact.file_name}`, `文件大小（字节）：${artifact.file_size}`, `SHA256：${artifact.sha256}`,
        `最低系统要求：${artifact.minimum_system_requirement ?? '未指定，待兼容验证'}`,
        `下载链接：${artifact.download_url ?? '未提供'}`, '下载状态：未上传，未验证链接']), '', '更新说明：', request.notes]
    await writeFile(join(staging, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(join(staging, 'release-info.txt'), `${info.join('\n')}\n`)
    await writeFile(join(staging, 'build-config.json'), `${JSON.stringify(request.config, null, 2)}\n`)
    assertActveroOutputAvailable(output)
    await rename(staging, output)
    return manifest
  }
  finally { await rm(staging, { recursive: true, force: true }) }
}
