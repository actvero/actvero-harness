import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { preparePrimaryRuntime } from '../scripts/prepare-primary-runtime.ts'

const state = vi.hoisted(() => ({ runtime: '', cache: '', downloads: '' }))
vi.mock('../scripts/desktop-build-paths.mjs', () => ({
  resolveDesktopBuildTarget: () => 'win-arm64',
  resolveDesktopTargetBuildPaths: () => state,
}))
vi.mock('../../../scripts/primary-runtime/prepare.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../scripts/primary-runtime/prepare.ts')>()
  return { ...original, preparePrimaryRuntime: vi.fn(async (options: { output: string }) => {
    await mkdir(join(options.output, 'primary-runtime'), { recursive: true })
    await writeFile(join(options.output, 'primary-runtime', 'runtime.json'), JSON.stringify({
      desktopVersion: '0.0.1', platform: 'win32', arch: 'arm64', python: '3.12.14', pythonPackages: { numpy: '2.3.5' },
      node: '24.21.0', pnpm: '11.28.5',
    }))
    await writeFile(join(options.output, 'primary-runtime', 'python.exe'), 'unsigned interpreter')
  }) }
})
const roots: string[] = []
afterEach(async () => { vi.clearAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('reuses unsigned inputs and refreshes release metadata without reassembling the payload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'primary-runtime-cache-'))
  roots.push(root)
  Object.assign(state, { runtime: join(root, 'runtime'), cache: join(root, 'cache'), downloads: join(root, 'downloads') })
  const { preparePrimaryRuntime: assemble } = await import('../../../scripts/primary-runtime/prepare.ts')
  const expected = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  await preparePrimaryRuntime({ deferSmoke: true })
  await writeFile(join(state.runtime, 'primary-runtime', 'python.exe'), 'signed bytes')
  const metadata = join(state.runtime, 'primary-runtime', 'runtime.json')
  const old = JSON.parse(await readFile(metadata, 'utf8')) as Record<string, unknown>
  await writeFile(metadata, JSON.stringify({ ...old, desktopVersion: 'old release' }))
  await preparePrimaryRuntime({ deferSmoke: true })
  expect(assemble).toHaveBeenCalledTimes(1)
  expect(JSON.parse(await readFile(metadata, 'utf8'))).toMatchObject({ desktopVersion: expected.version })
  expect(await readFile(join(state.runtime, 'primary-runtime', 'python.exe'), 'utf8')).toBe('unsigned interpreter')
})
