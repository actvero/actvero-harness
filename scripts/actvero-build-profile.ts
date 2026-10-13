/** Read and normalize local Actvero Build Profile files. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface ActveroBuildProfile {
  readonly schemaVersion: 1
  readonly name: string
  readonly baseConfig: string
  readonly product?: { readonly displayName?: string | undefined; readonly version?: string | undefined }
  readonly platform?: { readonly defaultUrl?: string | undefined }
  readonly branding?: { readonly icon?: string | undefined; readonly logo?: string | undefined; readonly trayIcon?: string | undefined }
  readonly package?: {
    readonly target?: string | undefined
    readonly format?: string | undefined
    readonly out?: string | undefined
    readonly downloadBaseUrl?: string | undefined
    readonly releaseDate?: string | undefined
    readonly notes?: string | undefined
    readonly minSystem?: string | undefined
  }
}

function record(value: unknown, subject: string, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`build profile ${subject}: expected an object`)
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`build profile ${subject}: unsupported field ${key}`)
  return value as Record<string, unknown>
}

function optionalText(value: unknown, subject: string, max: number): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`build profile ${subject}: invalid text`)
  return value
}

function optionalNotes(value: unknown, subject: string): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > 262_144) throw new Error(`build profile ${subject}: invalid notes`)
  return value
}

function optionalGroup(value: unknown, subject: string, fields: readonly string[]): Record<string, unknown> | undefined {
  return value === undefined ? undefined : record(value, subject, fields)
}

/** Validate one parsed profile, without reading its referenced product config. */
export function normalizeActveroBuildProfile(value: unknown): ActveroBuildProfile {
  const input = record(value, 'root', ['schemaVersion', 'name', 'slug', 'baseConfig', 'product', 'platform', 'branding', 'package',
    // These fields are accepted for one-way compatibility with the first builder preview.
    'presetName', 'productName', 'version', 'platformUrl', 'target', 'format', 'output', 'minSystem', 'notes', 'assets'])
  if (input.schemaVersion !== 1) throw new Error('build profile schemaVersion: expected 1')
  const legacy = input.presetName !== undefined || input.productName !== undefined || input.version !== undefined
    || input.platformUrl !== undefined || input.target !== undefined || input.format !== undefined || input.output !== undefined
    || input.minSystem !== undefined || input.notes !== undefined || input.assets !== undefined
  const name = optionalText(input.name ?? input.presetName, 'name', 80) ?? '未命名预设'
  const baseConfig = optionalText(input.baseConfig, 'baseConfig', 512) ?? 'actvero/product.json'
  const product = optionalGroup(input.product, 'product', ['displayName', 'version'])
  const platform = optionalGroup(input.platform, 'platform', ['defaultUrl'])
  const branding = optionalGroup(input.branding, 'branding', ['icon', 'logo', 'trayIcon'])
  const packageInput = optionalGroup(input.package, 'package', ['target', 'format', 'out', 'downloadBaseUrl', 'releaseDate', 'notes', 'minSystem'])
  const legacyAssets = input.assets === undefined ? undefined : record(input.assets, 'assets', ['icon', 'logo', 'trayIcon'])
  const normalized: ActveroBuildProfile = {
    schemaVersion: 1,
    name,
    baseConfig,
    ...(product || legacy && (input.productName !== undefined || input.version !== undefined) ? {
      product: {
        ...(optionalText(product?.displayName ?? input.productName, 'product.displayName', 80) === undefined ? {} : { displayName: optionalText(product?.displayName ?? input.productName, 'product.displayName', 80) }),
        ...(optionalText(product?.version ?? input.version, 'product.version', 64) === undefined ? {} : { version: optionalText(product?.version ?? input.version, 'product.version', 64) }),
      },
    } : {}),
    ...(platform || legacy && input.platformUrl !== undefined ? {
      platform: { ...(optionalText(platform?.defaultUrl ?? input.platformUrl, 'platform.defaultUrl', 512) === undefined ? {} : { defaultUrl: optionalText(platform?.defaultUrl ?? input.platformUrl, 'platform.defaultUrl', 512) }) },
    } : {}),
    ...(branding || legacyAssets ? {
      branding: {
        ...(optionalText(branding?.icon ?? legacyAssets?.icon, 'branding.icon', 512) === undefined ? {} : { icon: optionalText(branding?.icon ?? legacyAssets?.icon, 'branding.icon', 512) }),
        ...(optionalText(branding?.logo ?? legacyAssets?.logo, 'branding.logo', 512) === undefined ? {} : { logo: optionalText(branding?.logo ?? legacyAssets?.logo, 'branding.logo', 512) }),
        ...(optionalText(branding?.trayIcon ?? legacyAssets?.trayIcon, 'branding.trayIcon', 512) === undefined ? {} : { trayIcon: optionalText(branding?.trayIcon ?? legacyAssets?.trayIcon, 'branding.trayIcon', 512) }),
      },
    } : {}),
    ...(packageInput || legacy ? {
      package: {
        ...(optionalText(packageInput?.target ?? input.target, 'package.target', 64) === undefined ? {} : { target: optionalText(packageInput?.target ?? input.target, 'package.target', 64) }),
        ...(optionalText(packageInput?.format ?? input.format, 'package.format', 16) === undefined ? {} : { format: optionalText(packageInput?.format ?? input.format, 'package.format', 16) }),
        ...(optionalText(packageInput?.out ?? input.output, 'package.out', 512) === undefined ? {} : { out: optionalText(packageInput?.out ?? input.output, 'package.out', 512) }),
        ...(optionalText(packageInput?.downloadBaseUrl, 'package.downloadBaseUrl', 512) === undefined ? {} : { downloadBaseUrl: optionalText(packageInput?.downloadBaseUrl, 'package.downloadBaseUrl', 512) }),
        ...(optionalText(packageInput?.releaseDate, 'package.releaseDate', 32) === undefined ? {} : { releaseDate: optionalText(packageInput?.releaseDate, 'package.releaseDate', 32) }),
        ...(optionalNotes(packageInput?.notes ?? input.notes, 'package.notes') === undefined ? {} : { notes: optionalNotes(packageInput?.notes ?? input.notes, 'package.notes') }),
        ...(optionalText(packageInput?.minSystem ?? input.minSystem, 'package.minSystem', 256) === undefined ? {} : { minSystem: optionalText(packageInput?.minSystem ?? input.minSystem, 'package.minSystem', 256) }),
      },
    } : {}),
  }
  return normalized
}

/** Read and validate a profile path relative to the repository. */
export function readActveroBuildProfile(root: string, path: string): { readonly path: string; readonly profile: ActveroBuildProfile } {
  const resolved = resolve(root, path)
  let value: unknown
  try { value = JSON.parse(readFileSync(resolved, 'utf8')) } catch { throw new Error(`build profile: cannot read ${path}`) }
  return { path: resolved, profile: normalizeActveroBuildProfile(value) }
}
