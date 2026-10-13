/** Product variants own their native identity and embed only validated public defaults. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareProductBranding, productAssetPath } from '../scripts/actvero-branding.ts'
import { createActveroElectronBuilderConfig } from '../scripts/actvero-electron-builder.mjs'
import { unpackIco } from '../scripts/render-tray-icon.ts'
import { brandDesktopLocale } from '../src/actvero/brand-locale.ts'
import { resolveDesktopLocale } from '../src/locale.ts'
import { resolveDesktopPackageTarget } from '../scripts/package-target.ts'
const repository = resolve(import.meta.dirname, '../../..')
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'actvero-branding-')); roots.push(root)
  for (const file of ['actvero/product.json', 'actvero/icon.svg', 'actvero/app-icon.svg', 'actvero/upstream.lock.json', 'actvero/plugins.lock.json',
    'package.json', 'packages/client/ui-sidebar-documentpreview/package.json']) {
    const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, readFileSync(join(repository, file)))
  }
  return root
}
describe('ACTVERO build variants', () => {
  it('keeps two configurations isolated and produces relocatable public brand metadata', async () => {
    const root = fixture(), first = await prepareProductBranding(root)
    const alternate = structuredClone(first.assembly.config)
    const file = join(root, 'actvero', 'customer.json')
    writeFileSync(file, JSON.stringify({ ...alternate, product: { ...alternate.product, id: 'customer', applicationId: 'com.example.desktop', displayName: 'Customer AI', version: '1.2.3' }, platform: { defaultUrl: 'https://customer.example/platform' } }))
    const second = await prepareProductBranding(root, file)
    expect(second.product).toMatchObject({ id: 'customer', applicationId: 'com.example.desktop', displayName: 'Customer AI', version: '1.2.3', protocolScheme: 'customer-desktop', defaultUrl: 'https://customer.example/platform' })
    expect(first.directory).not.toBe(second.directory)
    expect((await prepareProductBranding(root)).fingerprint).toBe(first.fingerprint)
    expect(readFileSync(join(first.directory, 'build-product.json'), 'utf8')).not.toContain(root)
    expect(second.product.logoDataUrl).toBe(`data:image/svg+xml;base64,${readFileSync(join(root, 'actvero/icon.svg')).toString('base64')}`)
    expect(second.product.iconDataUrl).toMatch(/^data:image\/png;base64,/u)
    expect(unpackIco(readFileSync(join(second.directory, 'tray.ico'))).map(value => value.size)).toEqual([16, 20, 24, 32, 40, 48, 64, 128, 256])
    writeFileSync(join(root, 'actvero', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="blue"/></svg>')
    const replaced = await prepareProductBranding(root)
    expect(replaced.fingerprint).not.toBe(first.fingerprint)
    expect(replaced.product.logoDataUrl).not.toBe(first.product.logoDataUrl)
  })
  it('rejects missing, non-square, absolute and escaping artwork before producing a package', async () => {
    const root = fixture(), path = join(root, 'actvero/product.json')
    for (const file of ['/tmp/icon.png', 'https://example.com/icon.png', 'missing.png']) expect(() => productAssetPath(root, path, file)).toThrow()
    const external = mkdtempSync(join(tmpdir(), 'actvero-external-icon-')); roots.push(external)
    writeFileSync(join(external, 'icon.svg'), readFileSync(join(root, 'actvero/icon.svg')))
    symlinkSync(join(external, 'icon.svg'), join(root, 'actvero/escaped.svg'))
    expect(() => productAssetPath(root, path, 'escaped.svg')).toThrow('inside')
    writeFileSync(join(root, 'actvero/app-icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32"/></svg>')
    await expect(prepareProductBranding(root)).rejects.toThrow('square')
  })
  it.each(['darwin', 'win32'])('assembles %s test installers without the official identity or update/signing service', async (platform) => {
    const root = fixture(), branding = await prepareProductBranding(root)
    const packed = createActveroElectronBuilderConfig(branding.product, branding.directory, { DSH_DESKTOP_TARGET_PLATFORM: platform, DSH_DESKTOP_TARGET_ARCH: 'x64' })
    expect(packed.appId).toBe('com.actvero.desktop')
    expect(packed.extraMetadata.version).toBe('0.1.0')
    expect(packed.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
    expect(packed.productName).toBe('Actvero Harness')
    expect(packed.protocols).toEqual([{ name: 'Actvero Harness', schemes: ['actvero-desktop'] }])
    expect(packed.publish).toBeNull()
    expect(packed.mac.notarize).toBe(false)
    expect(packed.mac.identity).toBeNull()
    expect(packed.win.forceCodeSigning).toBe(false)
    expect(packed.artifactName).toContain('-unsigned.')
    const tray = packed.extraResources.find(value => value.to === 'tray.ico')
    expect(!!tray).toBe(platform === 'win32')
    expect(packed.nsis.deleteAppDataOnUninstall).toBe(false)
    expect(packed.asarUnpack).toContain('**/node_modules/@deepseek-ai/libreoffice-kit/**/*')
  })
  it('keeps official baseline copy unchanged and localizes the native product name', () => {
    for (const language of ['zh-CN', 'en']) {
      const official = resolveDesktopLocale(language)
      const customer = brandDesktopLocale(official, 'Customer AI')
      expect(customer.messages.aboutProduct).toBe('Customer AI')
      expect(customer.messages.openApplication).toContain('Customer AI')
      expect(official.messages.aboutProduct).toBe('DeepSeek Harness')
      expect(brandDesktopLocale(official)).toBe(official)
    }
    expect(() => resolveDesktopPackageTarget('win-x64', 'darwin', 'arm64')).toThrow('Windows x64')
  })
})
