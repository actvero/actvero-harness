import { test, onTestFinished } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { Skills } from '../src/main.ts'
import { digest, unpack, safePath, parseSkill } from '../src/package.ts'
import type { SkillDetail, Identity } from '../src/contracts.ts'
const id = '11111111-1111-4111-8111-111111111111',
  v1 = '22222222-2222-4222-8222-222222222222',
  v2 = '33333333-3333-4333-8333-333333333333'
function pack(version = v1, root = 'sample/', extra: Record<string, Uint8Array> = {}) {
  const content = `---\nname: sample\ndescription: Sample workflow\nuser-invocable: true\n---\n# Workflow ${version}\nRead references/example.md.`,
    files = {
      [root + 'SKILL.md']: strToU8(content),
      [root + 'references/example.md']: strToU8('Example'),
      ...extra,
    }
  const bytes = zipSync(files, { mtime: new Date('2026-01-01T00:00:00Z') })
  const detail: SkillDetail = {
    id,
    name: 'sample',
    display_name: '示例技能',
    description: '整理工作材料',
    category: { id: 'office', name: '办公协同' },
    icon: { source: 'fallback', image: '', sha256: '' },
    revision: 1,
    current_version: {
      id: version,
      version: version === v1 ? '1.0.0' : '2.0.0',
      sha256: digest(bytes),
      size: bytes.length,
      published_at: '2026-09-24T00:00:00Z',
      release_notes: '',
    },
    skill_md: content.split('---\n').at(-1)!,
    entrypoint: root + 'SKILL.md',
    files: Object.entries(files).map(([path, data]) => ({
      path,
      size: data.length,
      sha256: digest(data),
      previewable: true,
    })),
  }
  return { bytes, detail }
}
interface FixtureRequest {
  version_id?: string
  access_version?: number
  request_id?: string
  items?: { skill_id: string }[]
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-test-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  let identity: Identity | undefined = {
    key: 'platform|alice|membership',
    baseUrl: 'https://platform.test',
    available: true,
  },
    current = pack(),
    issues = 0,
    syncFail = false,
    conflict = false,
    networkFail = false,
    status: 'current' | 'update_available' | 'unavailable' = 'current',
    responseStatus = 200,
    expiredOnce = false,
    block: Promise<void> | undefined
  const versions = new Map([
    [v1, pack(v1)],
    [v2, pack(v2)],
  ])
  const calls: { url: string; body: FixtureRequest }[] = []
  const instance = new Skills({
    root,
    identity: () => identity,
    issue: async (resource) => {
      issues++
      return {
        access_token: 'test-resource',
        token_type: 'Bearer',
        resource,
        endpoint: 'https://platform.test/api/v1/desktop/skills',
        scope: 'skills:read skills:download',
        expires_in: 599,
      }
    },
    changed: () => {},
    syncHost: async (name) => {
      if (name && conflict) throw Object.assign(Error('skill_name_conflict'), { code: 'skill_name_conflict' })
      if (!name && syncFail) throw Error('registration failed')
      if (!name)
        for (const row of await instance.hostList()) assert.ok(await instance.hostGet(row.id, row.versionId))
    },
    fetcher: async (input, init) => {
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('Authorization'), 'Bearer test-resource')
      assert.equal(init?.credentials, 'omit')
      assert.equal(init?.redirect, 'error')
      assert.ok(!headers.has('Origin'))
      const url = String(input),
        body = init?.body ? (JSON.parse(String(init.body)) as FixtureRequest) : {}
      calls.push({ url, body })
      if (block) await block
      if (networkFail) throw Error('offline')
      if (responseStatus !== 200)
        return Response.json(
          { error: { code: responseStatus === 401 ? 'member_removed' : 'too_many_requests' } },
          { status: responseStatus, headers: { 'Retry-After': '60' } },
        )
      if (expiredOnce) {
        expiredOnce = false
        return Response.json({ error: { code: 'resource_token_expired' } }, { status: 401 })
      }
      if (url.endsWith('/download'))
        return new Response(current.bytes as BodyInit, {
          headers: {
            'Content-Type': 'application/zip',
            'X-Content-SHA256': current.detail.current_version.sha256,
            'X-Skill-Version-ID': current.detail.current_version.id,
          },
        })
      if (url.endsWith('/check-updates')) {
        assert.ok(body.items)
        return Response.json({
          items: body.items.map(r => ({
            skill_id: r.skill_id,
            status,
            skill: status === 'unavailable' ? null : current.detail,
          })),
        })
      }
      if (new URL(url).pathname.endsWith('/' + id))
        return Response.json(
          (
            versions.get(new URL(url).searchParams.get('version_id') ?? current.detail.current_version.id) ??
            current
          ).detail,
        )
      if (url.endsWith('/adopt')) return Response.json({ adopted: true })
      return Response.json({ items: [current.detail], total: 1, page: 1, page_size: 20 })
    },
  })
  return {
    root,
    instance,
    calls,
    get issues() {
      return issues
    },
    setIdentity: (value: Identity | undefined) => {
      identity = value
      instance.invalidate()
    },
    setPack: (value: ReturnType<typeof pack>) => {
      current = value
      versions.set(value.detail.current_version.id, value)
    },
    setSyncFail: (v: boolean) => (syncFail = v),
    setConflict: (v: boolean) => (conflict = v),
    setOffline: (v: boolean) => (networkFail = v),
    setStatus: (v: typeof status) => (status = v),
    setResponse: (v: number) => (responseStatus = v),
    expire: () => (expiredOnce = true),
    block: (p: Promise<void> | undefined) => (block = p),
    install: () =>
      instance.install(id, current.detail.current_version.id, current.detail.current_version.sha256),
  }
}
test('nested and root packages locate their own SKILL.md without executing code', () => {
  for (const root of ['', 'sample/']) {
    const p = pack(v1, root)
    assert.equal(unpack(p.bytes, p.detail).size, 2)
    assert.equal(
      parseSkill(new TextDecoder().decode(unpack(p.bytes, p.detail).get(p.detail.entrypoint)!), 'sample')
        .invocation.userInvocable,
      true,
    )
  }
})
test('reject cross-platform traversal, reserved paths and Unicode collisions', () => {
  for (const path of ['../x', '/x', 'C:\\x', 'a/../b', 'a//b', 'con.txt', 'a./b', 'a\\b', 'e\u0301.txt'])
    assert.throws(() => safePath(path))
  for (const extras of [
    { 'sample/SKILL.MD': strToU8('x') },
    { 'Sample/a': strToU8('x') },
    { 'sample/Ａ.txt': strToU8('x'), 'sample/A.txt': strToU8('y') },
    { '../outside': strToU8('x') },
  ]) {
    const p = pack(v1, 'sample/', extras as Record<string, Uint8Array>)
    assert.throws(() => unpack(p.bytes, p.detail))
  }
})
test('reject symlinks and decompression limits before inflation', () => {
  const p = pack(),
    bytes = Buffer.from(p.bytes)
  const at = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  bytes.writeUInt32LE((0xa1ff * 65536) >>> 0, at + 38)
  const d = structuredClone(p.detail)
  d.current_version.sha256 = digest(bytes)
  assert.throws(() => unpack(bytes, d), /unsafe_package/)
  const large = pack(v1, 'sample/', { 'sample/big': new Uint8Array(5 * 1024 * 1024 + 1) })
  assert.throws(() => unpack(large.bytes, large.detail), /unsafe_package/)
})
test('reject raw hash, file hash and frontmatter mismatch', () => {
  const p = pack()
  assert.throws(
    () =>
      unpack(p.bytes, {
        ...p.detail,
        current_version: { ...p.detail.current_version, sha256: '0'.repeat(64) },
      }),
    /checksum/,
  )
  const d = structuredClone(p.detail)
  d.files[0]!.sha256 = '0'.repeat(64)
  assert.throws(() => unpack(p.bytes, d), /checksum/)
  assert.throws(() => parseSkill('---\nname: different\ndescription: x\n---\n', 'sample'), /invalid_skill/)
})
test('successful install registers full content, invocation flags, resource root and restart state', async () => {
  const f = await fixture()
  await f.install()
  const state = await f.instance.state()
  assert.equal(state.items.length, 1)
  const skill = await f.instance.hostGet(id, v1)
  assert.equal(skill?.resourceBase.path, dirname(skill!.path))
  assert.match(skill!.content, /Read references/)
  assert.equal((await f.instance.hostList())[0]!.invocation.userInvocable, true)
  assert.equal(f.calls.find(c => c.url.endsWith('/download'))!.body.version_id, v1)
  f.instance.invalidate()
  assert.equal((await f.instance.state()).items[0]!.version.id, v1)
})
test('host registration failure rolls back a new install and an update', async () => {
  const f = await fixture()
  f.setSyncFail(true)
  await assert.rejects(f.install())
  assert.equal((await f.instance.state()).items.length, 0)
  f.setSyncFail(false)
  await f.install()
  f.setPack(pack(v2))
  f.setSyncFail(true)
  await assert.rejects(f.install())
  assert.equal((await f.instance.state()).items[0]!.version.id, v1)
  assert.ok(await f.instance.hostGet(id, v1))
})
test('local name conflicts block before download', async () => {
  const f = await fixture()
  f.setConflict(true)
  await assert.rejects(f.install(), /conflict/)
  assert.ok(!f.calls.some(c => c.url.endsWith('/download')))
})
test('modified and newly added personal files block update and uninstall', async () => {
  const f = await fixture()
  await f.install()
  const skill = await f.instance.hostGet(id, v1)
  await writeFile(join(dirname(skill!.path), 'personal.md'), 'Keep me')
  await assert.rejects(f.instance.uninstall(id), /local_changes/)
  f.setPack(pack(v2))
  await assert.rejects(f.install(), /local_changes/)
  await rm(join(dirname(skill!.path), 'personal.md'))
  await writeFile(skill!.path, 'edited')
  await assert.rejects(f.instance.uninstall(id), /local_changes/)
  assert.equal((await f.instance.state()).items.length, 1)
})
test('enabled state controls provider, metadata revisions and rollback versions sync separately', async () => {
  const f = await fixture()
  await f.install()
  await f.instance.enable(id, false)
  assert.deepEqual(await f.instance.hostList(), [])
  await f.instance.enable(id, true)
  const p = pack()
  p.detail.display_name = '新名称'
  p.detail.revision++
  f.setPack(p)
  await f.instance.checkUpdates()
  assert.equal((await f.instance.state()).items[0]!.skill.display_name, '新名称')
  assert.equal((await f.instance.state()).items[0]!.status, 'current')
  f.setPack(pack(v2))
  f.setStatus('update_available')
  await f.instance.checkUpdates()
  await f.install()
  f.setPack(pack(v1))
  await f.instance.checkUpdates()
  assert.equal((await f.instance.state()).items[0]!.status, 'update_available')
  await f.install()
  assert.equal((await f.instance.state()).items[0]!.version.id, v1)
})
test('offline checks preserve installed skills; explicit revocation removes only discoverability', async () => {
  const f = await fixture()
  await f.install()
  f.setOffline(true)
  await assert.rejects(f.instance.checkUpdates())
  assert.equal((await f.instance.state()).checkFailed, true)
  assert.equal((await f.instance.state()).items.length, 1)
  await assert.rejects(f.instance.hostList(), /network_unavailable/)
  f.setOffline(false)
  f.setStatus('unavailable')
  await f.instance.checkUpdates()
  assert.equal((await f.instance.state()).items[0]!.status, 'unavailable')
  assert.deepEqual(await f.instance.hostList(), [])
  await assert.rejects(f.instance.enable(id, true), /unavailable/)
  await f.instance.uninstall(id)
  assert.equal((await f.instance.state()).items.length, 0)
})
test('account switch cancels late responses and keeps each account installation isolated', async () => {
  const f = await fixture()
  await f.install()
  let release!: () => void
  f.block(new Promise<void>(r => (release = r)))
  const pending = f.instance.catalog()
  await new Promise(r => setTimeout(r, 5))
  f.setIdentity({ key: 'platform|bob|membership', baseUrl: 'https://platform.test', available: true })
  release()
  await assert.rejects(pending, /account_changed/)
  f.block(undefined)
  assert.deepEqual(await f.instance.hostList(), [])
  f.setIdentity({ key: 'platform|alice|membership', baseUrl: 'https://platform.test', available: true })
  assert.equal((await f.instance.hostList()).length, 1)
  f.setIdentity(undefined)
  assert.equal((await f.instance.state()).available, false)
  assert.deepEqual(await f.instance.hostList(), [])
})
test('single-flight resource token, one explicit expiry retry and Retry-After backoff', async () => {
  const f = await fixture()
  await Promise.all([f.instance.catalog(), f.instance.detail(id)])
  assert.equal(f.issues, 1)
  f.expire()
  await f.instance.catalog()
  assert.equal(f.issues, 2)
  f.setResponse(429)
  await assert.rejects(f.instance.catalog())
  const n = f.calls.length
  await assert.rejects(f.instance.catalog(), /rate_limited/)
  assert.equal(f.calls.length, n)
})
test('fatal membership response clears discovery without deleting local packages or retrying', async () => {
  const f = await fixture()
  await f.install()
  const path = (await f.instance.hostGet(id, v1))!.path
  f.setResponse(401)
  await assert.rejects(f.instance.catalog(), /member_removed/)
  assert.equal((await f.instance.state()).available, false)
  assert.deepEqual(await f.instance.hostList(), [])
  assert.ok(await readFile(path))
  await assert.rejects(f.instance.catalog(), /reauthentication_required/)
})
test('preview stays version-bound and dispatch rejects malformed and unknown actions', async () => {
  const f = await fixture()
  await assert.rejects(f.instance.dispatch('install', { id: 'no' }), /invalid_input/)
  await assert.rejects(f.instance.dispatch('publish', {}), /invalid_action/)
  await assert.rejects(f.instance.file(id, v1, '../secret'), /unsafe_package/)
  const p = pack(v2)
  f.setPack(p)
  await assert.rejects(
    f.instance.install(id, v1, pack().detail.current_version.sha256),
    /package_checksum_mismatch/,
  )
  assert.equal((await f.instance.state()).items.length, 0)
  assert.equal(f.calls.find(c => c.url.endsWith('/download'))!.body.version_id, v1)
})

test('reject duplicate directory/file paths and compressed data outside the ZIP body', () => {
  for (const extras of [
    { 'sample/item/': new Uint8Array(), 'sample/item': new Uint8Array() },
    { 'sample/item': new Uint8Array(), 'sample/item/': new Uint8Array() },
  ]) {
    const p = pack(v1, 'sample/', extras)
    assert.throws(() => unpack(p.bytes, p.detail), /unsafe_package/)
  }
  const p = pack(),
    bytes = Buffer.from(p.bytes),
    at = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  bytes.writeUInt32LE(bytes.length, at + 20)
  p.detail.current_version.sha256 = digest(bytes)
  assert.throws(() => unpack(bytes, p.detail), /unsafe_package/)
})
test('preview links use an explicit HTTP action and cannot launch local or application URLs', async () => {
  const opened: string[] = []
  const instance = new Skills({
    root: '/unused',
    identity: () => undefined,
    issue: async () => {
      throw Error('not used')
    },
    changed: () => {},
    syncHost: async () => {},
    openExternal: async (url) => {
      opened.push(url)
    },
  })
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'dsh://command',
    'https://user:secret@example.test',
    'data:text/html,test',
    '../local',
  ])
    await assert.rejects(instance.dispatch('openLink', { url }), /invalid_input/)
  assert.deepEqual(opened, [])
  await instance.dispatch('openLink', { url: 'https://example.test/guide' })
  assert.deepEqual(opened, ['https://example.test/guide'])
})

test('confirmed withdrawal stays disabled when host synchronization fails', async () => {
  const f = await fixture()
  await f.install()
  f.setStatus('unavailable')
  f.setSyncFail(true)
  await assert.rejects(f.instance.checkUpdates())
  assert.equal((await f.instance.state()).items[0]!.status, 'unavailable')
  assert.deepEqual(await f.instance.hostList(), [])
  f.instance.invalidate()
  assert.equal((await f.instance.state()).items[0]!.status, 'unavailable')
})

test('updates retain exact adopted packages after restart; expert preparation never downgrades active discovery', async () => {
  const f = await fixture()
  await f.install()
  const first = await f.instance.hostGet(id, v1)
  f.setPack(pack(v2))
  await f.install()
  assert.equal((await f.instance.hostList())[0]!.versionId, v2)
  f.instance.invalidate()
  assert.equal((await f.instance.hostGet(id, v1))?.content, first?.content)
  assert.equal((await f.instance.state()).items[0]!.version.id, v2)
  assert.equal(await f.instance.hasVersion(id, v1, pack(v1).detail.current_version.sha256), true)
  f.setPack(pack(v1))
  await f.instance.install(
    id,
    v1,
    pack(v1).detail.current_version.sha256,
    { expert_id: id, expert_release_id: v1 },
    false,
  )
  assert.equal((await f.instance.state()).items[0]!.version.id, v2)
  const adopts = f.calls.filter(c => c.url.endsWith('/adopt'))
  assert.ok(adopts.every(c => c.body.access_version === 2 && c.body.request_id))
  f.setStatus('unavailable')
  await f.instance.checkUpdates()
  assert.equal(await f.instance.hostGet(id, v1), undefined)
})
