/** Reject mixed DSH releases before preparing an ACTVERO runtime. */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProductAssembly } from './actvero-product.ts'

/**
 * Verify the pinned Git release and all shipped workspace versions.
 * @param root - Git checkout used for the build.
 * @param upstream - Validated public upstream pin.
 */
export function assertActveroBaseline(root: string, upstream: ProductAssembly['upstream']): void {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (upstream.tag !== `dsh-v${upstream.version}` || /-(?:alpha|beta|dev|canary|nightly)(?:[.-]|$)/u.test(upstream.version)) {
    throw new Error('ACTVERO baseline: use the pinned published DSH release, not an alpha/beta development version')
  }
  if (git('rev-parse', `${upstream.tag}^{commit}`) !== upstream.commit) {
    throw new Error('ACTVERO baseline: upstream tag and commit do not match')
  }
  const released = JSON.parse(git('show', `${upstream.commit}:package.json`)) as { version: string }
  if (released.version !== upstream.version) throw new Error('ACTVERO baseline: pinned commit has a different DSH version')
  const paths = git('ls-files', '-z', '--', 'package.json', 'apps/*/package.json', 'packages/*/*/package.json').split('\0').filter(Boolean)
  for (const path of paths) {
    // An unstaged baseline restoration can leave deleted alpha-only packages in the index.
    if (!existsSync(join(root, path))) continue
    const manifest = JSON.parse(readFileSync(join(root, path), 'utf8')) as { name?: string; version?: string }
    if (manifest.name?.startsWith('@deepseek-ai/dsh') && manifest.version !== upstream.version) {
      throw new Error(`ACTVERO baseline: ${path} uses ${manifest.version}; expected ${upstream.version}`)
    }
  }
}
