/** Add private ACTVERO workspace and pinned plugin tarballs to Desktop; never publish them. */
import { constants, copyFileSync, globSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pnpmInvocation } from './pnpm-invocation.ts'
import { runConcurrent } from './release/process.ts'
import { packedManifest } from './release/tarball.ts'

/**
 * Stage the exact plugin archives selected by repository-owned source records.
 * @param root - Repository directory containing actvero/plugins.
 * @param destination - Existing target-owned tarball directory.
 * @throws When a record, archive identity, digest, or destination conflicts.
 */
export function stageActveroPluginArchives(root: string, destination: string): void {
  for (const path of globSync('actvero/plugins/*/source.json', { cwd: root }).sort()) {
    const source: unknown = JSON.parse(readFileSync(resolve(root, path), 'utf8'))
    if (source === null || typeof source !== 'object' || Array.isArray(source)) throw new Error(`ACTVERO package: invalid plugin record ${path}`)
    const { archive, version, integrity } = source as Record<string, unknown>
    if (typeof archive !== 'string' || basename(archive) !== archive || archive.includes('\\') || !archive.endsWith('.tgz')
      || typeof version !== 'string' || version === '' || typeof integrity !== 'string') {
      throw new Error(`ACTVERO package: invalid plugin record ${path}`)
    }
    const file = resolve(root, dirname(path), archive)
    const digest = `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}`
    if (digest !== integrity) throw new Error(`ACTVERO package: plugin archive digest differs from ${path}`)
    const manifest = packedManifest(file)
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@actvero/dsh-')
      || manifest.private !== true || manifest.version !== version) {
      throw new Error(`ACTVERO package: plugin archive identity differs from ${path}`)
    }
    copyFileSync(file, resolve(destination, archive), constants.COPYFILE_EXCL)
  }
}

/**
 * Pack ACTVERO-owned workspaces after the official release family has been packed.
 * @param root - Repository directory.
 * @param destination - Existing target-owned tarball directory.
 * @returns Resolves after every workspace and pinned plugin has been staged; failures reject.
 */
export async function packActveroWorkspaces(root: string, destination: string): Promise<void> {
  const paths = globSync(['packages/actvero/*/package.json', 'packages/client/actvero-account/package.json'], { cwd: root }).sort()
  if (paths.length === 0) throw new Error('ACTVERO package: no owned workspaces found')
  for (const path of paths) {
    const manifest = JSON.parse(readFileSync(resolve(root, path), 'utf8')) as { name?: string; private?: boolean }
    if (!manifest.name?.startsWith('@actvero/dsh-') || manifest.private !== true) throw new Error(`ACTVERO package: ${path} must be a private ACTVERO workspace`)
    const invocation = pnpmInvocation(['--dir', resolve(root, dirname(path)), 'pack', '--pack-destination', destination])
    await runConcurrent(invocation.command, invocation.args)
  }
  stageActveroPluginArchives(root, destination)
}
if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } })
  if (!values.out) throw new Error('ACTVERO package: --out is required')
  await packActveroWorkspaces(resolve(import.meta.dirname, '..'), resolve(values.out))
}
