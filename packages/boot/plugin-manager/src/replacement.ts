/** Local archive replacement preparation without executing package code. */
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import { Parser } from 'tar'
import semver from 'semver'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { ManagementFailure } from './failure.ts'

/** Immutable local archive and restoration of the prior pnpm package link. */
export interface Replacement {
  readonly spec: string
  readonly manifest: object
  /** Restore the installed package link after pnpm has stopped. */
  restore(): Promise<void>
  /** Remove the temporary copy once replacement or recovery has completed. */
  dispose(): Promise<void>
}

/** Cache and inspect a newer archive, retaining the old package link for failed installs.
 * @param spec Absolute .tgz selected for replacement.
 * @param expected Installed identity and version the user reviewed.
 * @param profile Profile whose direct pnpm dependency is being replaced.
 * @returns Cached archive and restoration handle; rejects malformed, mismatched or non-newer releases.
 */
export async function prepareReplacement(
  spec: string, expected: { name: string; version: string; nextVersion: string }, profile: string,
): Promise<Replacement> {
  // Bounds apply before parsing untrusted compressed archives.
  if (!spec.endsWith('.tgz') || (await stat(spec)).size > 8 * 1024 * 1024) throw new ManagementFailure('invalid-spec')
  const bytes = await readFile(spec)
  if (bytes.length > 8 * 1024 * 1024) throw new ManagementFailure('invalid-spec')
  const directory = join(profile, '.plugin-manager', 'archives')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const cached = join(directory, `${createHash('sha256').update(bytes).digest('hex')}.tgz`)
  await writeFileAtomic(cached, bytes, { mode: 0o600 })
  const chunks: Buffer[] = []
  const paths = new Set<string>()
  let expanded = 0
  const invalid = new Set<string>()
  const content = await promisify(gunzip)(bytes, { maxOutputLength: 32 * 1024 * 1024 })
  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({ strict: true, onReadEntry(entry) {
      expanded += entry.size
      if (expanded > 32 * 1024 * 1024 || paths.has(entry.path) || !entry.path.startsWith('package/')
        || entry.path.includes('\\') || entry.path.split('/').includes('..') || !['File', 'Directory'].includes(entry.type)) {
        invalid.add(entry.path)
      }
      paths.add(entry.path)
      if (entry.path === 'package/package.json') {
        if (entry.type !== 'File' || entry.size > 128 * 1024) invalid.add(entry.path)
        else entry.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      }
      entry.resume()
    } })
    parser.on('error', reject)
    parser.on('end', resolve)
    parser.end(content)
  })
  if (invalid.size > 0) throw new ManagementFailure('invalid-spec')
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof value !== 'object' || value === null) throw new ManagementFailure('invalid-spec')
  const manifest = value as { name?: unknown; version?: unknown }
  if (manifest.name !== expected.name || typeof manifest.version !== 'string'
    || manifest.version !== expected.nextVersion
    || semver.valid(manifest.version) !== manifest.version || !semver.valid(expected.version)
    || !semver.gt(manifest.version, expected.version)) throw new ManagementFailure('invalid-spec')
  const link = join(profile, 'node_modules', expected.name)
  const linked = (await lstat(link)).isSymbolicLink()
  const target = linked ? await readlink(link) : undefined
  const original = await realpath(link)
  const backup = await mkdtemp(join(profile, '.plugin-manager', 'replacement-'))
  try { await cp(original, join(backup, 'package'), { recursive: true }) }
  catch (error) { await rm(backup, { recursive: true, force: true }); throw error }
  return {
    spec: cached, manifest,
    async restore() {
      // Hoisted pnpm installs use directories; isolated installs use virtual-store links.
      await rm(link, { recursive: true, force: true })
      if (target === undefined) await cp(join(backup, 'package'), link, { recursive: true })
      else {
        await cp(join(backup, 'package'), original, { recursive: true })
        await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
      }
    },
    async dispose() { await rm(backup, { recursive: true, force: true }) },
  }
}
