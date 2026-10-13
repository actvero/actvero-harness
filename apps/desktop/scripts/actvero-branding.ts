/** Validate local artwork and prepare public defaults for one ACTVERO build. */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { readProductAssembly } from '../../../scripts/actvero-product.ts'
import { packIco, TRAY_ICON_SIZES } from './render-tray-icon.ts'
import type { BuildProduct } from '../src/actvero/build-product.ts'
const sharp: typeof import('sharp').default = createRequire(new URL('../package.json', import.meta.url))('sharp')

/**
 * Resolve artwork relative to its configuration, contained in the repository.
 * @param root - Repository directory.
 * @param configPath - Absolute configuration path.
 * @param file - Configured SVG or PNG relative path.
 * @returns Absolute existing artwork path; external paths and symlink escapes fail.
 */
export function productAssetPath(root: string, configPath: string, file: string): string {
  if (isAbsolute(file) || /^[a-z]+:/iu.test(file) || file.includes('\\')) throw new Error('branding: use a relative SVG or PNG file')
  const path = realpathSync(resolve(dirname(configPath), file))
  const inside = relative(realpathSync(root), path)
  if (inside === '..' || inside.startsWith('../') || inside.startsWith('..\\') || isAbsolute(inside)) throw new Error('branding: artwork must stay inside the repository')
  if (!['.svg', '.png'].includes(extname(path).toLowerCase())) throw new Error('branding: artwork must be SVG or PNG')
  return path
}

/**
 * Rasterize native artwork, preserve SVG UI themes, and emit public identity metadata.
 * @param root - Repository directory.
 * @param selectedConfig - Configuration path; omitted selects actvero/product.json.
 * @returns Validated assembly, embedded public defaults, and their fingerprinted directory.
 */
export async function prepareProductBranding(root: string, selectedConfig = 'actvero/product.json') {
  const configPath = resolve(root, selectedConfig)
  const assembly = readProductAssembly(root, configPath)
  const { config } = assembly
  const bytes = (path: string) => readFileSync(productAssetPath(root, configPath, path))
  const icon = bytes(config.branding.icon)
  const logoPath = config.branding.logo ?? config.branding.icon
  const logo = config.branding.logo === undefined ? icon : bytes(logoPath)
  const tray = config.branding.trayIcon === undefined ? icon : bytes(config.branding.trayIcon)
  const raster = async (source: Buffer, size: number, square: boolean) => {
    const image = sharp(source, { density: 144, limitInputPixels: 16_777_216 })
    const metadata = await image.metadata()
    if (!metadata.width || !metadata.height || square && metadata.width !== metadata.height) throw new Error('branding: application and tray icons must be square')
    return image.resize(size, size, { fit: 'contain', background: '#00000000' }).png().toBuffer()
  }
  const iconPng = await raster(icon, 1024, true)
  const logoPng = await raster(logo, 256, false)
  const product: BuildProduct = { ...config.product, protocolScheme: `${config.product.id}-desktop`, defaultUrl: config.platform.defaultUrl,
    // Preserve embedded SVG theme rules; native icons remain rasterized for Electron.
    logoDataUrl: extname(logoPath).toLowerCase() === '.svg'
      ? `data:image/svg+xml;base64,${logo.toString('base64')}`
      : `data:image/png;base64,${logoPng.toString('base64')}`,
    iconDataUrl: `data:image/png;base64,${iconPng.toString('base64')}` }
  const fingerprint = createHash('sha256').update(JSON.stringify(config)).update(icon).update(logo).update(tray).digest('hex')
  const directory = join(root, 'apps/desktop/.desktop-build/actvero/products', config.product.id, fingerprint)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'icon.png'), iconPng)
  writeFileSync(join(directory, 'logo.png'), logoPng)
  const sizes = [...TRAY_ICON_SIZES, 128, 256]
  const entries = await Promise.all(sizes.map(async size => ({ size, png: await raster(tray, size, true) })))
  writeFileSync(join(directory, 'tray.ico'), packIco(entries))
  writeFileSync(join(directory, 'build-product.json'), `${JSON.stringify(product, null, 2)}\n`)
  writeFileSync(join(directory, 'assembly.json'), `${JSON.stringify(assembly, null, 2)}\n`)
  return { assembly, product, fingerprint, directory }
}
