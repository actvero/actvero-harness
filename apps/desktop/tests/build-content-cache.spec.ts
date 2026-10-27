import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { BuildContentCacheError, buildContentDigest, materializeBuildCache } from '../scripts/build-content-cache.ts'

const roots: string[] = []
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-content-cache-'))
  roots.push(root)
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('reuses the same inputs and keeps signing changes out of the cached tree', async () => {
  const root = await temporary()
  const options = { cache: join(root, 'cache'), key: buildContentDigest('win-arm64 locked inputs'), destination: join(root, 'runtime'),
    prepare: vi.fn(async (output: string) => { await writeFile(join(output, 'python.exe'), 'unsigned runtime') }), report: vi.fn<(state: 'hit' | 'miss') => void>() }
  expect(await materializeBuildCache(options)).toBe(false)
  await writeFile(join(options.destination, 'python.exe'), 'signed runtime')
  expect(await materializeBuildCache(options)).toBe(true)
  expect(options.prepare).toHaveBeenCalledTimes(1)
  expect(await readFile(join(options.destination, 'python.exe'), 'utf8')).toBe('unsigned runtime')
  expect(options.report.mock.calls.map(([state]) => state)).toEqual(['miss', 'hit'])
  expect(await readdir(options.cache)).toEqual([options.key])
})

it('invalidates changed inputs without deleting another cached target', async () => {
  const root = await temporary()
  const prepare = vi.fn(async (output: string) => { await writeFile(join(output, 'runtime'), String(prepare.mock.calls.length)) })
  const options = { cache: join(root, 'cache'), destination: join(root, 'runtime'), prepare }
  const old = buildContentDigest('x64 lock A'), next = buildContentDigest('arm64 lock B')
  await materializeBuildCache({ ...options, key: old })
  await materializeBuildCache({ ...options, key: next })
  expect(prepare).toHaveBeenCalledTimes(2)
  expect((await readdir(options.cache)).sort()).toEqual([old, next].sort())
})

it('stops on corrupt cached bytes and preserves the previous output', async () => {
  const root = await temporary()
  const options = { cache: join(root, 'cache'), key: buildContentDigest('recipe'), destination: join(root, 'runtime'),
    prepare: vi.fn(async (output: string) => { await writeFile(join(output, 'python.exe'), 'original') }) }
  await materializeBuildCache(options)
  await writeFile(join(options.cache, options.key, 'payload', 'python.exe'), 'changed')
  await expect(materializeBuildCache(options)).rejects.toBeInstanceOf(BuildContentCacheError)
  expect(await readFile(join(options.destination, 'python.exe'), 'utf8')).toBe('original')
  expect(options.prepare).toHaveBeenCalledTimes(1)
})

it('cleans its failed preparation without publishing a partial entry', async () => {
  const root = await temporary()
  const cache = join(root, 'cache')
  await expect(materializeBuildCache({ cache, key: buildContentDigest('recipe'), destination: join(root, 'runtime'),
    prepare: async (output) => { await writeFile(join(output, 'partial'), 'bytes'); throw new Error('fixture preparation failed') },
  })).rejects.toThrow('fixture preparation failed')
  expect(await readdir(cache)).toEqual([])
})

it('allows concurrent publishers to produce independent, verified output copies', async () => {
  const root = await temporary()
  const cache = join(root, 'cache'), key = buildContentDigest('parallel recipe')
  const prepare = async (output: string) => { await writeFile(join(output, 'node.exe'), 'native node') }
  await Promise.all(['first', 'second'].map(name => materializeBuildCache({ cache, key, prepare, destination: join(root, name) })))
  expect(await readFile(join(root, 'first', 'node.exe'), 'utf8')).toBe('native node')
  expect(await readFile(join(root, 'second', 'node.exe'), 'utf8')).toBe('native node')
  expect(await readdir(cache)).toEqual([key])
})

it.skipIf(process.platform === 'win32')('preserves internal aliases and rejects links outside the cached input', async () => {
  const root = await temporary()
  const cache = join(root, 'cache')
  await materializeBuildCache({ cache, key: buildContentDigest('valid aliases'), destination: join(root, 'valid'), prepare: async (output) => {
    await writeFile(join(output, 'python3.12'), 'interpreter')
    await symlink('python3.12', join(output, 'python'))
  } })
  expect(await readFile(join(root, 'valid', 'python'), 'utf8')).toBe('interpreter')
  await expect(materializeBuildCache({ cache, key: buildContentDigest('external alias'), destination: join(root, 'invalid'), prepare: async (output) => {
    await symlink('../outside', join(output, 'python'))
  } })).rejects.toBeInstanceOf(BuildContentCacheError)
})

it('ignores generated caches, artifacts and local signing inputs without hiding source or lockfiles', () => {
  const root = resolve(import.meta.dirname, '../../..')
  const generated = ['apps/desktop/.desktop-build/cache/win-arm64/primary-runtime/receipt.json',
    'apps/desktop/.desktop-build/targets/win-x64/artifacts/client-release.json',
    'apps/desktop/.desktop-build/targets/win-arm64/artifacts/app.exe',
    'apps/desktop/.desktop-build/packaging-runs/run/events.jsonl',
    'apps/desktop/.env.windows', 'apps/desktop/.env.windows.local', 'apps/desktop/signing.pfx',
    'apps/desktop/packaging/.local/production.env', 'apps/desktop/config/windows-packaging/test.env',
    'apps/desktop/config/windows-packaging/windows-signing.env', 'apps/desktop/config/windows-packaging/signing.cer']
  const source = ['pnpm-lock.yaml', 'scripts/primary-runtime/lock.json', 'apps/desktop/scripts/build-content-cache.ts',
    'apps/desktop/packaging/README.md', 'apps/desktop/tests/fixtures/signing.key',
    'apps/desktop/config/windows-packaging/test.env.example']
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: root, input: [...generated, ...source].join('\n') + '\n', encoding: 'utf8' }).trim().split(/\r?\n/u)
  expect(ignored.sort()).toEqual(generated.sort())
})
