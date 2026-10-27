/** Export qualified Desktop artifacts as a portable platform CLI import manifest. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { load } from 'js-yaml'
import { valid } from 'semver'

/** An export failure leaves remote release state untouched; fix inputs and rerun. */
export class ClientReleaseExportError extends Error {
  code = 'client-release-export-failed'
}

async function fingerprint(path) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) throw new ClientReleaseExportError('desktop export: expected a nonempty regular artifact')
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return { size_bytes: info.size, sha512: hash.digest('base64') }
}

/**
 * Validate one completion record, update YAML and exact file inventory, then export.
 * @param {string} directory Completed target artifact directory.
 * @param {'win-x64' | 'win-arm64' | 'mac-arm64' | 'mac-x64'} target Packaged target.
 * @param {string} minimumOS Human-readable minimum supported OS.
 * @returns {Promise<string>} New manifest path. Existing manifests are never overwritten.
 * @throws {ClientReleaseExportError} For incomplete or inconsistent artifacts; no upload occurs.
 */
export async function exportClientRelease(directory, target, minimumOS) {
  try {
    if (!['win-x64', 'win-arm64', 'mac-arm64', 'mac-x64'].includes(target) || !minimumOS?.trim()) throw new ClientReleaseExportError('desktop export: target and minimum OS are required')
    const record = JSON.parse(await readFile(join(directory, `${target}-release.json`), 'utf8'))
    if (record.schemaVersion !== 1 || record.target !== target || !valid(record.version)
      || record.version.includes('+') || !['latest', 'nightly'].includes(record.channel)
      || (record.channel === 'latest' && record.version.includes('-'))) throw new ClientReleaseExportError('desktop export: invalid completion record')
    if (!/^[a-f0-9]{40}$/u.test(record.commit ?? '') || record.dirty !== false) throw new ClientReleaseExportError('desktop export: a clean committed source record is required')
    const feed = new URL(record.publicUrl)
    if (feed.protocol !== 'https:' || feed.username || feed.password || feed.search || feed.hash || !feed.pathname.endsWith(`/${target}/`)) throw new ClientReleaseExportError('desktop export: invalid packaged feed URL')
    const suffix = target.startsWith('mac-') ? '-mac' : ''
    const metadata = load(await readFile(join(directory, `${record.channel}${suffix}.yml`), 'utf8'))
    if (!metadata || typeof metadata !== 'object' || metadata.version !== record.version || !Array.isArray(metadata.files)) throw new ClientReleaseExportError('desktop export: update metadata differs from completion record')
    const base = `deepseek-harness-${record.version}-${target}`
    const extension = target.startsWith('win-') ? 'exe' : 'zip'
    const inventory = [['payload', `${base}.${extension}`], ['blockmap', `${base}.${extension}.blockmap`]]
    if (target.startsWith('mac-')) inventory.push(['installer', `${base}.dmg`])
    const artifacts = []
    for (const [role, filename] of inventory) {
      const computed = await fingerprint(join(directory, filename))
      if (role === 'payload') {
        const listed = metadata.files.find(file => file.url === filename)
        if (!listed || listed.sha512 !== computed.sha512 || listed.size !== computed.size_bytes) throw new ClientReleaseExportError('desktop export: payload differs from builder metadata')
      }
      artifacts.push({ target, role, file: filename, filename, ...computed })
    }
    const path = join(directory, 'client-release.json')
    await writeFile(path, JSON.stringify({ schema_version: 1, version: record.version, channel: record.channel, source_commit: record.commit,
      notes: typeof metadata.releaseNotes === 'string' ? metadata.releaseNotes : '',
      minimum_os: { [target]: minimumOS.trim() }, feed_roots: { [target]: record.publicUrl }, artifacts }, null, 2) + '\n', { flag: 'wx' })
    return path
  } catch (error) {
    if (error instanceof ClientReleaseExportError) throw error
    throw new ClientReleaseExportError('desktop export: cannot read qualified artifacts or create manifest; check paths and remove an obsolete export explicitly before retrying', { cause: error })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'minimum-os': { type: 'string' } } })
    if (positionals.length !== 2) throw new ClientReleaseExportError('Usage: node export-client-release.mjs <directory> <target> --minimum-os <label>')
    process.stdout.write(await exportClientRelease(resolve(positionals[0]), positionals[1], values['minimum-os']) + '\n')
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: { code: 'client-release-export-failed', message: error instanceof ClientReleaseExportError ? error.message : 'desktop export failed; check arguments' } }) + '\n')
    process.exitCode = 1
  }
}
