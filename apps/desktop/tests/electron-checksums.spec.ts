/** Cached Electron archives retain verification against the pinned npm distribution. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, onTestFinished } from 'vitest'
import { readElectronChecksums } from '../scripts/electron-checksums.ts'

const filename = 'electron-v44.7.0-darwin-arm64.zip'
const digest = 'a'.repeat(64)
function fixture(value: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'electron-checksums-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'checksums.json'), JSON.stringify(value))
  return root
}

it('selects the exact target archive and excludes another platform checksum', () => {
  const root = fixture({ [filename]: digest, 'electron-v44.7.0-win32-x64.zip': 'b'.repeat(64) })
  expect(readElectronChecksums(root, filename)).toEqual({ [filename]: digest })
  expect(() => readElectronChecksums(root, 'electron-v44.8.0-darwin-arm64.zip')).toThrow('no SHA256 checksum')
})

it.each([null, [], {}, { [filename]: 123 }, { [filename]: 'a'.repeat(63) }, { [filename]: 'z'.repeat(64) }])(
  'refuses missing or malformed checksum metadata (%j)', (table) => {
    expect(() => readElectronChecksums(fixture(table), filename)).toThrow('no SHA256 checksum')
  },
)
