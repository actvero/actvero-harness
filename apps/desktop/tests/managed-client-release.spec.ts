import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { dump } from 'js-yaml'
import { managedDesktopUpdateRoot, resolveDesktopAutoUpdateConfig, resolveDesktopUploadConfig } from '../scripts/desktop-auto-update-environment.mjs'
import { resolveDesktopPolicyEnvironment } from '../scripts/desktop-policy-environment.mjs'
import { loadDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { createMacOSAppUpdateConfig, resolveMacOSAppUpdateFeed } from '../scripts/macos-app-update-config.mjs'
import { clientBuildArguments, resolveClientBuildTarget } from '../scripts/build-client-release.mjs'
import { ClientReleaseExportError, exportClientRelease } from '../scripts/export-client-release.mjs'

const feed = 'https://platform.example.com/api/v1/client-updates/actvero'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

it.each([
  ['darwin', 'arm64', 'mac-arm64'], ['darwin', 'x64', 'mac-x64'],
  ['win32', 'x64', 'win-x64'], ['win32', 'arm64', 'win-arm64'],
] as const)('uses the Actvero packager for %s/%s without update settings', (platform, arch, target) => {
  expect(clientBuildArguments([target], platform, arch)).toEqual(['run', 'actvero:package', '--target', target])
})

it('preserves a private product profile, remote platform and package options without treating them as update settings', () => {
  expect(clientBuildArguments(['mac', '--profile', '.actvero-builder/presets/team.json', '--platform-url', 'https://platform.example.com', '--out', 'release files', '--minimum-os', 'macOS 13', '--check'], 'darwin', 'arm64'))
    .toEqual(['run', 'actvero:package', '--target', 'mac-arm64', '--profile', '.actvero-builder/presets/team.json', '--platform-url', 'https://platform.example.com', '--out', 'release files', '--min-system', 'macOS 13', '--check'])
  expect(() => clientBuildArguments(['mac-arm64', '--target=win-arm64'], 'darwin', 'arm64')).toThrow('target once')
})

it('embeds per-target managed feeds without COS credentials and preserves the channel', () => {
  const env = { DSH_DESKTOP_UPDATE_BASE_URL: feed, DSH_DESKTOP_UPDATE_CHANNEL: 'latest' }
  for (const [platform, arch, target] of [['darwin', 'arm64', 'mac-arm64'], ['darwin', 'x64', 'mac-x64'], ['win32', 'x64', 'win-x64'], ['win32', 'arm64', 'win-arm64']] as const) {
    expect(resolveDesktopAutoUpdateConfig(env, platform, arch)).toMatchObject({ publicUrl: `${feed}/${target}/`, channel: 'latest', useMultipleRangeRequest: false })
  }
  expect(() => resolveDesktopUploadConfig(env, 'win32', 'x64')).toThrow('platform CLI')
  const selected = resolveMacOSAppUpdateFeed([{ provider: 'generic', url: feed + '/mac-arm64/', channel: 'latest', useMultipleRangeRequest: false }])
  expect(createMacOSAppUpdateConfig(selected, 'updater')).toMatchObject({ useMultipleRangeRequest: false })
})

it.each(['http://example.com', 'https://name:secret@example.com', 'https://example.com/?token=secret', 'https://example.com/#secret', ' '])('rejects invalid managed root without exposing credentials', (value) => {
  expect(() => managedDesktopUpdateRoot({ DSH_DESKTOP_UPDATE_BASE_URL: value })).toThrow()
  expect(() => managedDesktopUpdateRoot({ DSH_DESKTOP_UPDATE_BASE_URL: value })).not.toThrow('secret')
})

it('only omits mandatory policy when explicitly selected for a valid managed feed', () => {
  expect(resolveDesktopPolicyEnvironment({ DSH_DESKTOP_UPDATE_BASE_URL: feed, DSH_DESKTOP_MANDATORY_UPDATE_DISABLED: '1' })).toBeUndefined()
  expect(() => resolveDesktopPolicyEnvironment({ DSH_DESKTOP_MANDATORY_UPDATE_DISABLED: '1' })).toThrow('managed update feed')
})

it('loads the managed configuration from the platform file and preserves explicit channel overrides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'managed-feed-settings-'))
  roots.push(root)
  await writeFile(join(root, '.env.macos'), `DSH_DESKTOP_UPDATE_BASE_URL=${feed}\nDSH_DESKTOP_UPDATE_CHANNEL=nightly\nDSH_DESKTOP_MANDATORY_UPDATE_DISABLED=1\n`)
  const settings = loadDesktopPackageEnvironment('darwin', { DSH_DESKTOP_UPDATE_BASE_URL: 'https://stale.example.com', DSH_DESKTOP_UPDATE_CHANNEL: 'latest' }, root)
  expect(resolveDesktopAutoUpdateConfig(settings, 'darwin', 'arm64')).toMatchObject({ publicUrl: `${feed}/mac-arm64/`, channel: 'latest' })
  expect(resolveDesktopPolicyEnvironment(settings)).toBeUndefined()
  expect(loadDesktopPackageEnvironment('darwin', {}, root).DSH_DESKTOP_UPDATE_CHANNEL).toBe('nightly')
})

async function fixture(target: 'win-x64' | 'win-arm64' | 'mac-arm64') {
  const root = await mkdtemp(join(tmpdir(), 'managed-client-release-'))
  roots.push(root)
  const version = '1.2.0'
  const base = `deepseek-harness-${version}-${target}`
  const payload = `${base}.${target.startsWith('win-') ? 'exe' : 'zip'}`
  const bytes = Buffer.from('installer-fixture')
  await writeFile(join(root, `${target}-release.json`), JSON.stringify({ schemaVersion: 1, version, target, commit: 'a'.repeat(40), dirty: false, channel: 'latest', publicUrl: `${feed}/${target}/` }))
  await writeFile(join(root, `latest${target.startsWith('win-') ? '' : '-mac'}.yml`), dump({ version, files: [{ url: payload, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') }] }))
  await writeFile(join(root, payload), bytes)
  await writeFile(join(root, payload + '.blockmap'), 'blockmap-fixture')
  if (target === 'mac-arm64') await writeFile(join(root, base + '.dmg'), bytes)
  return { root, payload }
}

it.each(['win-x64', 'win-arm64', 'mac-arm64'] as const)('exports %s with portable file paths and checksums', async (target) => {
  const { root } = await fixture(target)
  const path = await exportClientRelease(root, target, 'supported OS')
  const manifest = JSON.parse(await readFile(path, 'utf8')) as { artifacts: Array<{ file: string }> }
  expect(manifest).toMatchObject({ schema_version: 1, version: '1.2.0', channel: 'latest', source_commit: 'a'.repeat(40), feed_roots: { [target]: `${feed}/${target}/` } })
  expect(manifest.artifacts).toHaveLength(target.startsWith('win-') ? 2 : 3)
  expect(manifest.artifacts[0]!.file).not.toContain('/')
  await expect(exportClientRelease(root, target, 'supported OS')).rejects.toBeInstanceOf(ClientReleaseExportError)
})

it('rejects a changed payload before creating a manifest', async () => {
  const { root, payload } = await fixture('win-x64')
  await writeFile(join(root, payload), 'modified')
  await expect(exportClientRelease(root, 'win-x64', 'supported OS')).rejects.toThrow('differs from builder metadata')
  await expect(readFile(join(root, 'client-release.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})


it('rejects dirty source records before exporting an upload manifest', async () => {
  const { root } = await fixture('win-x64')
  const path = join(root, 'win-x64-release.json')
  const record = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  await writeFile(path, JSON.stringify({ ...record, dirty: true }))
  await expect(exportClientRelease(root, 'win-x64', 'Windows 10')).rejects.toThrow('clean committed source')
  await expect(readFile(join(root, 'client-release.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})


it('selects native build targets and rejects mismatched Windows architectures', () => {
  expect(resolveClientBuildTarget('mac', 'darwin', 'arm64')).toBe('mac-arm64')
  expect(resolveClientBuildTarget('mac-x64', 'darwin', 'arm64')).toBe('mac-x64')
  expect(resolveClientBuildTarget('win', 'win32', 'x64')).toBe('win-x64')
  expect(() => resolveClientBuildTarget('win-x64', 'darwin', 'arm64')).toThrow('matching Node architecture')
  expect(resolveClientBuildTarget('win-arm64', 'win32', 'arm64')).toBe('win-arm64')
  expect(resolveClientBuildTarget('win', 'win32', 'arm64')).toBe('win-arm64')
  expect(() => resolveClientBuildTarget('win-arm64', 'win32', 'x64')).toThrow('matching Node architecture')
})
