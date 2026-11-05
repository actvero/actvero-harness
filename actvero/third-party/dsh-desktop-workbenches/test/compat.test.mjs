import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installCompatibleBundle } from '../compat-install.mjs'
import { resolveInstallTarget } from '../market-install.mjs'

test('an installed package is never silently overwritten on the older runtime', async () => {
  let called = false
  const manager = { listBundles: async () => [{ name: 'sample', installed: true }], installBundle: async () => { called = true } }
  await assert.rejects(installCompatibleBundle(manager, '/sample.tgz', 'sample', { replace: true }), /暂不支持直接覆盖/)
  assert.equal(called, false)
})

test('verified npm bytes are installed locally and a changed digest is refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-compat-'))
  try {
    await mkdir(join(root, 'package'))
    await writeFile(join(root, 'package/package.json'), JSON.stringify({ name: 'sample', version: '1.0.0' }))
    execFileSync('tar', ['-czf', join(root, 'sample.tgz'), '-C', root, 'package'])
    const bytes = await readFile(join(root, 'sample.tgz'))
    const entry = { distribution: { type: 'npm', name: 'sample', version: '1.0.0', integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` } }
    const fetchImpl = async url => url.includes('registry.npmjs.org')
      ? Response.json({ name: 'sample', version: '1.0.0', dist: { tarball: 'https://packages.example/sample.tgz' } })
      : new Response(bytes)
    const target = await resolveInstallTarget(entry, { fetchImpl, temporaryRoot: root })
    try { assert.deepEqual(await readFile(target.pluginSpec.slice(5)), bytes) }
    finally { await target.cleanup() }
    await assert.rejects(resolveInstallTarget({ distribution: { ...entry.distribution, integrity: `sha512-${'A'.repeat(86)}==` } }, { fetchImpl }), /integrity digest/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
