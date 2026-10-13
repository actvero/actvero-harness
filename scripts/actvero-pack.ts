/** Add private ACTVERO workspace tarballs to a local Desktop package set; never publish them. */
import { globSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pnpmInvocation } from './pnpm-invocation.ts'
import { runConcurrent } from './release/process.ts'

/**
 * Pack ACTVERO-owned workspaces after the official release family has been packed.
 * @param root - Repository directory.
 * @param destination - Existing target-owned tarball directory.
 * @returns Resolves after every package has been packed; interrupted or failed commands reject.
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
}
if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } })
  if (!values.out) throw new Error('ACTVERO package: --out is required')
  await packActveroWorkspaces(resolve(import.meta.dirname, '..'), resolve(values.out))
}
