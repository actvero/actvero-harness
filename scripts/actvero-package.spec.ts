/** Package inputs preserve public source configuration and export hashes of final installers. */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertActveroOutputAvailable, exportActveroRelease, prepareActveroBuildConfiguration, resolveActveroBuildRequest as resolveBuild } from './actvero-package.ts'
import { readProductAssembly, validateProductConfig } from './actvero-product.ts'
import { prepareProductBranding } from '../apps/desktop/scripts/actvero-branding.ts'
import { resolveDesktopPackageTarget } from '../apps/desktop/scripts/package-target.ts'

const repository = resolve(import.meta.dirname, '..')
const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'actvero-package-')); roots.push(root)
  for (const file of ['actvero/product.json', 'actvero/icon.svg', 'actvero/app-icon.svg', 'actvero/upstream.lock.json', 'actvero/plugins.lock.json',
    'package.json', 'packages/client/ui-sidebar-documentpreview/package.json']) {
    const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, readFileSync(join(repository, file)))
  }
  // Export filenames use the fixture's version independently of repository releases.
  const configPath = join(root, 'actvero/product.json')
  const config = validateProductConfig(JSON.parse(readFileSync(configPath, 'utf8')))
  writeFileSync(configPath, JSON.stringify({ ...config, product: { ...config.product, version: '0.1.0' } }))
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const host = { platform: 'darwin' as const, architecture: 'arm64' }
const hostTarget = 'mac-arm64'
const resolveActveroBuildRequest = (root: string, args: string[], environment: NodeJS.ProcessEnv) =>
  resolveBuild(root, args, environment, host)
const argumentsFor = (extra: string[] = []) => ['--package', '--target', hostTarget, ...extra]

describe('ACTVERO packaging inputs', () => {
  it('uses a shared Build Profile as defaults without rewriting the product config', () => {
    const root = fixture()
    writeFileSync(join(root, 'profile.json'), JSON.stringify({ schemaVersion: 1, name: 'mac profile', baseConfig: 'actvero/product.json',
      product: { displayName: 'Profile Harness', version: '0.1.4' }, package: { target: hostTarget, format: 'dmg', out: 'profile-dist', notes: '来自预设' } }))
    const request = resolveActveroBuildRequest(root, argumentsFor(['--profile', 'profile.json']), {})
    expect(request.config.product).toMatchObject({ displayName: 'Profile Harness', version: '0.1.4' })
    expect(request.formats).toEqual(['dmg'])
    expect(request.notes).toBe('来自预设')
    expect(request.output).toBe(join(root, 'profile-dist/actvero/0.1.4', hostTarget))
    const overridden = resolveActveroBuildRequest(root, argumentsFor(['--profile', 'profile.json', '--name', 'CLI Harness']), {})
    expect(overridden.config.product.displayName).toBe('CLI Harness')
  })

  it('uses CLI overrides before Make variables and leaves the source JSON unchanged', async () => {
    const root = fixture(), original = readFileSync(join(root, 'actvero/product.json'))
    const request = resolveActveroBuildRequest(root, argumentsFor(['--name', 'CLI Harness', '--version', '1.2.3', '--platform-url', 'https://example.com/platform',
      '--icon', 'actvero/app-icon.svg', '--logo', 'actvero/icon.svg', '--tray-icon', 'actvero/app-icon.svg']), { ACTVERO_BUILD_NAME: 'Make Harness' })
    const selected = prepareActveroBuildConfiguration(root, request)
    expect(readProductAssembly(root, selected).config.product).toMatchObject({ displayName: 'CLI Harness', version: '1.2.3', applicationId: 'com.actvero.desktop' })
    const branding = await prepareProductBranding(root, selected)
    expect(branding.product.defaultUrl).toBe('https://example.com/platform')
    expect(branding.product.logoDataUrl).toBe(`data:image/svg+xml;base64,${readFileSync(join(root, 'actvero/icon.svg')).toString('base64')}`)
    expect(readFileSync(join(root, 'actvero/product.json'))).toEqual(original)
    expect(prepareActveroBuildConfiguration(root, request)).toBe(selected)
    expect(request.output).toBe(join(root, 'dist/actvero/1.2.3', hostTarget))
  })
  it('loads nested profile artwork through configuration preparation on the build host', async () => {
    const root = fixture(), original = readFileSync(join(root, 'actvero/product.json'))
    const assets = 'actvero/assets/custom'
    mkdirSync(join(root, assets), { recursive: true })
    for (const file of ['app-icon.svg', 'icon.svg']) {
      writeFileSync(join(root, assets, file), readFileSync(join(root, 'actvero', file)))
    }
    const branding = { icon: `${assets}/app-icon.svg`, logo: `${assets}/icon.svg`, trayIcon: `${assets}/app-icon.svg` }
    writeFileSync(join(root, 'profile.json'), JSON.stringify({ schemaVersion: 1, name: 'Nested artwork',
      baseConfig: 'actvero/product.json', branding }))
    const request = resolveActveroBuildRequest(root, argumentsFor(['--profile', 'profile.json']), {})
    expect(request.config.branding).toEqual({ icon: 'assets/custom/app-icon.svg', logo: 'assets/custom/icon.svg', trayIcon: 'assets/custom/app-icon.svg' })
    const prepared = await prepareProductBranding(root, prepareActveroBuildConfiguration(root, request))
    expect(prepared.product.logoDataUrl).toBe(`data:image/svg+xml;base64,${readFileSync(join(root, assets, 'icon.svg')).toString('base64')}`)
    expect(readFileSync(join(root, 'actvero/product.json'))).toEqual(original)
  })
  it('keeps the source path when there are no overrides and accepts an output directory with spaces', () => {
    const root = fixture(), request = resolveActveroBuildRequest(root, argumentsFor(['--out', 'installer output']), {})
    expect(prepareActveroBuildConfiguration(root, request)).toBe(join(root, 'actvero/product.json'))
    expect(request.output).toBe(join(root, 'installer output/actvero/0.1.0', hostTarget))
    expect(request.releaseDate).toBeNull()
    expect(request.minimumSystem).toBeNull()
  })
  it('treats shell metacharacters in a name as literal public data', () => {
    const root = fixture(), request = resolveActveroBuildRequest(root, argumentsFor(), { ACTVERO_BUILD_NAME: 'Harness $(literal) `literal`' })
    expect(readProductAssembly(root, prepareActveroBuildConfiguration(root, request)).config.product.displayName).toBe('Harness $(literal) `literal`')
  })
  it.each([
    ['--format', 'tar'], ['--format', 'exe'],
    ['--dir', '--out', 'dist'], ['--dir', '--format', 'all'], ['--name', '../Other'], ['--version', 'not-a-version'],
    ['--release-date', '2026-02-30'], ['--release-date', '2026-13-01'], ['--release-date', 'today'],
    ['--download-base-url', 'http://example.com'], ['--download-base-url', 'https://user:pass@example.com'],
    ['--download-base-url', 'https://example.com?token=secret'], ['--download-base-url', 'https://example.com/#hash'],
    ['--icon', '../outside.svg'], ['--min-system', 'Windows\nInjected'],
  ].map(args => ({ args })))('rejects invalid input $args before building', ({ args }) => {
    expect(() => resolveActveroBuildRequest(fixture(), argumentsFor(args), {})).toThrow()
  })
  it('rejects missing notes, excessive notes, invalid Make booleans and packaging options on a source-only build', () => {
    const root = fixture()
    expect(() => resolveActveroBuildRequest(root, argumentsFor(['--notes', 'missing.md']), {})).toThrow()
    writeFileSync(join(root, 'notes.md'), 'a'.repeat(262_145))
    expect(() => resolveActveroBuildRequest(root, argumentsFor(['--notes', 'notes.md']), {})).toThrow('256 KiB')
    expect(() => resolveActveroBuildRequest(root, argumentsFor(), { ACTVERO_BUILD_SKIP_PREPARE: 'yes' })).toThrow('0 or 1')
    expect(() => resolveActveroBuildRequest(root, ['--out', 'dist'], {})).toThrow('require --package')
  })
  it.skipIf(process.platform !== 'darwin')('runs the real Make entry without shell interpolation and checks the host toolchain', () => {
    const root = fixture()
    const child = spawnSync('make', ['package-check', `PNPM=${process.execPath} node_modules/pnpm/bin/pnpm.cjs`, `TARGET=${hostTarget}`,
      'NAME=Make Harness `literal`', `OUT=${join(root, 'output with spaces')}`], { cwd: repository, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, ACTVERO_BUILD_NAME: '' } })
    expect(child.error).toBeUndefined()
    expect(child.status, child.stderr).toBe(0)
    expect(child.stdout).toContain('Make Harness `literal`')
    expect(child.stdout).toContain('output with spaces')
  })
})

describe('ACTVERO installer export', () => {
  it('exports actual bytes, notes and planned URLs without marking the release published', async () => {
    const root = fixture()
    writeFileSync(join(root, 'notes.md'), '修复登录。\n')
    const request = resolveActveroBuildRequest(root, argumentsFor(['--download-base-url', 'https://downloads.example.com/desktop',
      '--release-date', '2026-10-06', '--notes', 'notes.md', '--min-system', 'Test OS baseline']), {})
    const source = join(root, 'internal'); mkdirSync(source)
    const bytes = Buffer.from('final installer bytes\0\xff', 'utf8')
    for (const extension of request.formats) writeFileSync(join(source, `actvero-0.1.0-mac-arm64-unsigned.${extension}`), bytes)
    const manifest = await exportActveroRelease(request, source)
    for (const artifact of manifest.artifacts) {
      expect(artifact.file_size).toBe(bytes.length)
      expect(artifact.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
      expect(artifact.download_url).toBe(`https://downloads.example.com/desktop/actvero/0.1.0/${hostTarget}/${artifact.file_name}`)
      expect(artifact.download_url_status).toBe('planned')
      expect(readFileSync(join(request.output ?? '', artifact.file_name))).toEqual(bytes)
    }
    expect(manifest.release_notes).toBe('修复登录。\n')
    expect(manifest.signing).toBe('unsigned')
    expect(manifest).not.toHaveProperty('recommended')
    expect(JSON.parse(readFileSync(join(request.output ?? '', 'release.json'), 'utf8'))).toEqual(manifest)
    expect(readFileSync(join(request.output ?? '', 'release-info.txt'), 'utf8')).toContain('未上传，未验证链接')
    expect(() => { assertActveroOutputAvailable(request.output ?? '') }).toThrow('already exists')
  })
  it('describes Windows x64 artifacts independently of the host architecture', async () => {
    const root = fixture(), base = resolveActveroBuildRequest(root, argumentsFor(), {})
    const request = { ...base, target: resolveDesktopPackageTarget('win-x64', 'win32', 'x64'), formats: ['exe'] as const, output: join(root, 'windows-export') }
    const source = join(root, 'internal'); mkdirSync(source)
    writeFileSync(join(source, 'actvero-0.1.0-win-x64-unsigned.exe'), 'test installer')
    const manifest = await exportActveroRelease(request, source)
    expect(manifest.artifacts[0]).toMatchObject({ system: 'windows', architecture: 'x64', download_url: null, download_url_status: 'not_provided', minimum_system_requirement: null })
  })
  it('rejects a file blocking the export path before packaging', () => {
    const root = fixture()
    writeFileSync(join(root, 'blocked'), 'keep')
    expect(() => { assertActveroOutputAvailable(join(root, 'blocked', 'actvero/0.1.0/mac-arm64')) }).toThrow('not a directory')
  })
  it('removes staging on a missing installer and preserves an existing export', async () => {
    const root = fixture(), request = resolveActveroBuildRequest(root, argumentsFor(), {})
    await expect(exportActveroRelease(request, root)).rejects.toThrow()
    expect(readdirSync(dirname(request.output ?? ''))).toEqual([])
    mkdirSync(request.output ?? '', { recursive: true })
    writeFileSync(join(request.output ?? '', 'keep.txt'), 'keep')
    await expect(exportActveroRelease(request, root)).rejects.toThrow('already exists')
    expect(readFileSync(join(request.output ?? '', 'keep.txt'), 'utf8')).toBe('keep')
  })
})
