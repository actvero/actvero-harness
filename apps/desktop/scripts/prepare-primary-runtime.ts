/** Desktop resource locations and signing-aware verification for the shared runtime builder. */

import { createRequire } from 'node:module'
import { buildContentDigest, buildDirectoryDigest, materializeBuildCache, reportBuildCache } from './build-content-cache.ts'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { preparePrimaryRuntime as preparePayload, primaryRuntimePayloadDigest, smokePrimaryRuntime as smokePayload } from '../../../scripts/primary-runtime/prepare.ts'
import { parsePrimaryRuntime, workspaceDependencyPaths } from '../../../packages/skill/tool-workspace-dependencies/src/index.ts'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import lock from '../../../scripts/primary-runtime/lock.json' with { type: 'json' }
import { scrubWindowsSigningEnvironment } from './windows-sign.mjs'

/**
 * Prepare Desktop resources for its selected packaging target.
 * @param options - Signed Windows packaging defers execution until its supervised signing stage.
 * @returns Resolves after preparation and, unless deferred, native-target execution checks.
 */
export async function preparePrimaryRuntime(options: { deferSmoke?: boolean } = {}): Promise<void> {
  const paths = resolveDesktopTargetBuildPaths()
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  const target = resolveDesktopBuildTarget()
  const require = createRequire(import.meta.url)
  const pnpmVersion = (JSON.parse(readFileSync(require.resolve('pnpm'), 'utf8')) as { version: string }).version
  const assets = join(require.resolve('@deepseek-ai/dsh-skill-office/package.json'), '..', 'assets')
  const recipe = [new URL('../../../scripts/primary-runtime/prepare.ts', import.meta.url),
    new URL('../../../scripts/primary-runtime/prune-python-tests.ts', import.meta.url),
    new URL('../../../packages/skill/tool-workspace-dependencies/src/index.ts', import.meta.url),
    new URL('./prepare-primary-runtime.ts', import.meta.url),
    new URL('./build-content-cache.ts', import.meta.url)].map(file => buildContentDigest(readFileSync(file)))
  const key = buildContentDigest(JSON.stringify({ format: 1, recipe,
    payload: primaryRuntimePayloadDigest(target, lock, pnpmVersion), assets: await buildDirectoryDigest(assets),
  }))
  await materializeBuildCache({ cache: join(paths.cache, 'primary-runtime'), key, destination: paths.runtime,
    prepare: output => preparePayload({ target, output, cache: paths.downloads, version, skillSource: assets }),
    report: state => reportBuildCache('primary-runtime', state),
  })
  const manifestPath = join(paths.runtime, 'primary-runtime', 'runtime.json')
  const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(manifestPath, 'utf8')))
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, desktopVersion: version }, undefined, 2) + '\n')
  if (!options.deferSmoke) smokePrimaryRuntime(join(paths.runtime, 'primary-runtime'))
}

/**
 * Verify Desktop's complete payload after preparation or platform signing.
 * @param root - Final payload directory, including any platform signatures.
 */
export function smokePrimaryRuntime(root: string): void {
  const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8')))
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) return
  if (Object.keys(manifest.pythonPackages).length === 0) throw new Error('primary runtime: missing Python distribution versions; prepare the payload before running its smoke checks.')
  const entries = workspaceDependencyPaths(root, manifest)
  if (entries.node === undefined || entries.pnpm === undefined) throw new Error('primary runtime: the Desktop payload must declare node and pnpm components.')
  smokePayload(root, scrubWindowsSigningEnvironment(process.env))
}

if (import.meta.main) await preparePrimaryRuntime()
