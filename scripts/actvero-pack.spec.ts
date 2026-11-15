/** Pinned external plugin archives must reach the same package set as owned workspaces. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { stageActveroPluginArchives } from './actvero-pack.ts'

function fixture(manifest = { name: '@actvero/dsh-game-mode', version: '0.1.0-alpha.3', private: true }) {
  const root = mkdtempSync(join(tmpdir(), 'actvero-plugin-pack-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  const plugin = join(root, 'actvero', 'plugins', 'game-mode')
  const destination = join(root, 'packed')
  mkdirSync(join(plugin, 'package'), { recursive: true })
  mkdirSync(destination)
  writeFileSync(join(plugin, 'package', 'package.json'), JSON.stringify(manifest))
  execFileSync('tar', ['-czf', 'selected.tgz', 'package'], { cwd: plugin })
  const bytes = readFileSync(join(plugin, 'selected.tgz'))
  const record = { archive: 'selected.tgz', version: '0.1.0-alpha.3', integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
  const write = (value: unknown) => writeFileSync(join(plugin, 'source.json'), JSON.stringify(value))
  write(record)
  return { root, plugin, destination, bytes, record, write }
}

it('stages only the pinned archive, preserving bytes while older archives remain beside it', () => {
  const f = fixture()
  copyFileSync(join(f.plugin, 'selected.tgz'), join(f.plugin, 'older.tgz'))
  stageActveroPluginArchives(f.root, f.destination)
  expect(readdirSync(f.destination)).toEqual(['selected.tgz'])
  expect(readFileSync(join(f.destination, 'selected.tgz'))).toEqual(f.bytes)
  expect(() => stageActveroPluginArchives(f.root, f.destination)).toThrow()
})

it.each([null, [], {}, { archive: '../outside.tgz' }, { archive: '..\\outside.tgz' }, { archive: 'package.zip' }, { version: 3 }, { integrity: null }])(
  'rejects invalid source records before copying (%j)', (change) => {
    const f = fixture()
    f.write(change === null || Array.isArray(change) || Object.keys(change).length === 0 ? change : { ...f.record, ...change })
    expect(() => stageActveroPluginArchives(f.root, f.destination)).toThrow('invalid plugin record')
    expect(readdirSync(f.destination)).toEqual([])
  },
)

it('rejects modified archive bytes before inspecting or staging the package', () => {
  const f = fixture()
  writeFileSync(join(f.plugin, 'selected.tgz'), 'changed')
  expect(() => stageActveroPluginArchives(f.root, f.destination)).toThrow('digest differs')
  expect(readdirSync(f.destination)).toEqual([])
})

it.each([
  { name: 'unrelated-package', version: '0.1.0-alpha.3', private: true },
  { name: '@actvero/dsh-game-mode', version: '0.1.0-alpha.2', private: true },
  { name: '@actvero/dsh-game-mode', version: '0.1.0-alpha.3', private: false },
])('rejects archives whose package identity differs from the selection (%j)', (manifest) => {
  const f = fixture(manifest)
  expect(() => stageActveroPluginArchives(f.root, f.destination)).toThrow('identity differs')
  expect(readdirSync(f.destination)).toEqual([])
})
