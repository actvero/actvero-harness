/** Electron's locked npm package supplies the checksum for its matching binary archive. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Read the target archive checksum without fetching a second release manifest.
 * @param packageDirectory - Installed, lockfile-verified Electron package directory.
 * @param filename - Exact Electron archive filename for the selected version and target.
 * @returns One SHA256 entry consumed by the normal Electron download validator.
 * @throws When the pinned package omits a valid checksum for the selected archive.
 */
export function readElectronChecksums(packageDirectory: string, filename: string): Record<string, string> {
  const table: unknown = JSON.parse(readFileSync(join(packageDirectory, 'checksums.json'), 'utf8'))
  const value = table !== null && typeof table === 'object' && !Array.isArray(table)
    ? (table as Record<string, unknown>)[filename] : undefined
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`desktop runtime: pinned Electron package has no SHA256 checksum for ${filename}`)
  }
  return { [filename]: value }
}
