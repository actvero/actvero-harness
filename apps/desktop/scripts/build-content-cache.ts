/** Reuse verified unsigned build inputs while giving every signing run its own writable copy. */
import { recordPackagingEvent } from './packaging-run.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

type Entry = { path: string; kind: 'directory'; mode: number }
  | { path: string; kind: 'file'; mode: number; sha256: string }
  | { path: string; kind: 'link'; target: string }

/** A corrupt cache stops before its files can be used or signed; remove that entry and rebuild. */
export class BuildContentCacheError extends Error {
  readonly code = 'build-content-cache-invalid'
}

/** Identify a build recipe or file inventory without including personal paths in the receipt. */
export function buildContentDigest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Report verified cache outcomes in the normal console and packaging event record. */
export function reportBuildCache(input: 'electron' | 'primary-runtime', state: 'hit' | 'miss'): void {
  process.stderr.write(`desktop cache: ${input} ${state}\n`)
  const directory = process.env.DSH_DESKTOP_PACKAGING_RUN_DIR
  if (directory) recordPackagingEvent(directory, { type: 'build-cache', input, state })
}

async function inventory(root: string, prefix = ''): Promise<Entry[]> {
  const result: Entry[] = []
  const items = await readdir(join(root, prefix), { withFileTypes: true })
  for (const item of items.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const path = prefix ? `${prefix}/${item.name}` : item.name
    const file = join(root, path)
    const info = await lstat(file)
    if (info.isSymbolicLink()) {
      const target = await readlink(file)
      const destination = relative(resolve(root), resolve(dirname(file), target))
      if (isAbsolute(target) || destination === '..' || destination.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(destination)) {
        throw new BuildContentCacheError('desktop build cache: external symlink is not a reusable input')
      }
      result.push({ path, kind: 'link', target })
    } else if (info.isDirectory()) {
      result.push({ path, kind: 'directory', mode: info.mode & 0o777 })
      result.push(...await inventory(root, path))
    } else if (info.isFile()) {
      result.push({ path, kind: 'file', mode: info.mode & 0o777, sha256: buildContentDigest(await readFile(file)) })
    } else {
      throw new BuildContentCacheError('desktop build cache: unsupported filesystem entry')
    }
  }
  return result
}

/** Hash a recipe's local input tree; timestamps and checkout paths do not affect reuse. */
export async function buildDirectoryDigest(root: string): Promise<string> {
  return buildContentDigest(JSON.stringify(await inventory(root)))
}

/**
 * Publish one immutable, checksummed input tree, then verify a fresh copy before replacing output.
 * A miss runs prepare in an owned staging directory; concurrent publishers retain the first valid
 * entry. Corrupt receipts or copied bytes stop the build. Signing never modifies the cache tree.
 */
export async function materializeBuildCache(options: {
  cache: string
  key: string
  destination: string
  prepare: (output: string) => Promise<void>
  report?: (state: 'hit' | 'miss') => void
}): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/u.test(options.key)) throw new BuildContentCacheError('desktop build cache: invalid input identity')
  await mkdir(options.cache, { recursive: true })
  const entry = join(options.cache, options.key)
  let hit = true
  try { await lstat(entry) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    hit = false
  }
  if (!hit) {
    const stage = await mkdtemp(join(options.cache, '.prepare-'))
    try {
      const payload = join(stage, 'payload')
      await mkdir(payload)
      await options.prepare(payload)
      const digest = await buildDirectoryDigest(payload)
      await writeFile(join(stage, 'receipt.json'), JSON.stringify({ schemaVersion: 1, key: options.key, digest }) + '\n', { flag: 'wx', mode: 0o600 })
      try { await rename(stage, entry) } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        // A concurrent publisher is usable only after the same receipt and copy checks below.
        if (!(await lstat(entry)).isDirectory()) throw error
      }
    } finally { await rm(stage, { recursive: true, force: true }) }
  }
  if (!(await lstat(entry)).isDirectory() || !(await lstat(join(entry, 'payload'))).isDirectory() || (await lstat(join(entry, 'receipt.json'))).isSymbolicLink()) {
    throw new BuildContentCacheError(`desktop build cache: entry must contain ordinary directories and a receipt; remove ${entry} and retry`)
  }
  let receipt: { schemaVersion?: number; key?: string; digest?: string }
  try { receipt = JSON.parse(await readFile(join(entry, 'receipt.json'), 'utf8')) }
  catch (error) { throw new BuildContentCacheError(`desktop build cache: unreadable receipt; stop builds, remove ${entry} and retry`, { cause: error }) }
  if (receipt?.schemaVersion !== 1 || receipt.key !== options.key || typeof receipt.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(receipt.digest)) {
    throw new BuildContentCacheError(`desktop build cache: invalid receipt; stop builds, remove ${entry} and retry`)
  }
  await mkdir(dirname(options.destination), { recursive: true })
  const temporary = join(dirname(options.destination), `.restore-${randomUUID()}`)
  try {
    await cp(join(entry, 'payload'), temporary, { recursive: true, verbatimSymlinks: true })
    if (await buildDirectoryDigest(temporary) !== receipt.digest) {
      throw new BuildContentCacheError(`desktop build cache: input files changed; stop builds, remove ${entry} and retry`)
    }
    await rm(options.destination, { recursive: true, force: true })
    await rename(temporary, options.destination)
  } finally { await rm(temporary, { recursive: true, force: true }) }
  options.report?.(hit ? 'hit' : 'miss')
  return hit
}
