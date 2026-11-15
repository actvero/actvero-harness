/** Archive inspection reports API requirements before any installation can begin. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import { expect, it, onTestFinished, vi } from 'vitest'
import { readWorkbenchPackage } from '../src/client/workbenches/archive.ts'
import { createWorkbenchManagement, type WorkbenchManagement } from '../src/client/workbenches/management.ts'
import { WORKBENCH_HOST_API_VERSION, WorkbenchHostCompatibilityError } from '../src/workbench-protocol.ts'

async function archive(hostApi: string): Promise<File> {
  const root = await mkdtemp(join(tmpdir(), 'workbench-import-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'package'))
  await writeFile(join(root, 'package/package.json'), JSON.stringify({
    name: '@local/import-fixture', version: '1.0.0', exports: { './client': './client.js' },
    dsh: { actveroWorkbench: 1, actveroWorkbenchProtocol: { schemaVersion: 1, hostApi },
      bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['@actvero/dsh-capability-ui'] } },
  }))
  const path = join(root, 'workbench.tgz')
  await create({ cwd: root, file: path, gzip: true }, ['package/package.json'])
  return new File([new Uint8Array(await readFile(path))], 'workbench.tgz')
}

it('distinguishes unsupported host requirements from invalid archives', async () => {
  await expect(readWorkbenchPackage(await archive('^1.7.0'))).resolves.toEqual({ name: '@local/import-fixture', version: '1.0.0' })
  const incompatible = await archive('^99.0.0')
  await expect(readWorkbenchPackage(incompatible)).rejects.toBeInstanceOf(WorkbenchHostCompatibilityError)
  await expect(readWorkbenchPackage(incompatible)).rejects.toMatchObject({
    code: 'incompatible-host', requiredHostApi: '^99.0.0', currentHostApi: WORKBENCH_HOST_API_VERSION,
  })
  await expect(readWorkbenchPackage(new File(['not an archive'], 'invalid.tgz'))).resolves.toBeUndefined()
  await expect(readWorkbenchPackage(await archive('invalid-range'))).resolves.toBeUndefined()
})

it('reports incompatible requirements without installing and clears them on the next import', async () => {
  type Remote = Parameters<typeof createWorkbenchManagement>[0]
  const remote = {
    listBundles: vi.fn<Remote['listBundles']>(), installBundle: vi.fn<Remote['installBundle']>(),
    setBundleEnabled: vi.fn<Remote['setBundleEnabled']>(), removeBundle: vi.fn<Remote['removeBundle']>(),
  }
  const publish = vi.fn<(state: WorkbenchManagement) => void>()
  const beforeChange = vi.fn<Parameters<typeof createWorkbenchManagement>[2]>()
  const actions = createWorkbenchManagement(remote, publish, beforeChange)
  onTestFinished(actions.dispose)
  await actions.importFile(await archive('^99.0.0'))
  expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({
    busy: null, notice: { kind: 'hostIncompatible', requiredHostApi: '^99.0.0', currentHostApi: WORKBENCH_HOST_API_VERSION },
    pendingUpdate: null, diagnostic: '',
  })
  expect(remote.listBundles).not.toHaveBeenCalled()
  expect(remote.installBundle).not.toHaveBeenCalled()
  expect(beforeChange).not.toHaveBeenCalled()
  await actions.importFile(new File(['not an archive'], 'invalid.tgz'))
  expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({ busy: null, notice: 'invalidPackage' })
})

it('retries a blocked import only after the person approves its listed dependency scripts', async () => {
  type Remote = Parameters<typeof createWorkbenchManagement>[0]
  const remote = {
    listBundles: vi.fn<Remote['listBundles']>().mockResolvedValue({ ok: true, value: [] }),
    installBundle: vi.fn<Remote['installBundle']>(),
    setBundleEnabled: vi.fn<Remote['setBundleEnabled']>(),
    removeBundle: vi.fn<Remote['removeBundle']>(),
  }
  const path = '/downloads/workbench.tgz'
  const name = '@local/import-fixture'
  const pendingBuilds = ['@ffmpeg-installer/darwin-arm64@4.1.5']
  const denied = { ok: true, value: { application: 'failed', changed: false, stage: 'install', target: path, pendingBuilds,
    packageResult: { exitCode: 1, output: '', truncated: false, logPath: '/logs/pnpm.log', kind: 'build-blocked' } } } as const
  remote.installBundle.mockResolvedValueOnce(denied).mockResolvedValueOnce(denied).mockResolvedValueOnce({
    ok: true, value: { application: 'applied', changed: true, stage: 'enable', target: name },
  })
  const publish = vi.fn<(state: WorkbenchManagement) => void>()
  const actions = createWorkbenchManagement(remote, publish, async () => null)
  vi.stubGlobal('__DSH_HOST_PATHS__', { pathFor: () => path })
  onTestFinished(() => { actions.dispose(); vi.unstubAllGlobals() })
  const file = await archive('^1.7.0')
  await actions.importFile(file)
  expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({ busy: null, notice: null, pendingBuilds })
  actions.cancelBuilds()
  await actions.confirmBuilds()
  expect(remote.installBundle).toHaveBeenCalledExactlyOnceWith(path, { enabled: true, registry: null })
  await actions.importFile(file)
  await actions.confirmBuilds()
  expect(remote.installBundle).toHaveBeenLastCalledWith(path, { enabled: true, registry: null, approvedBuilds: pendingBuilds })
  expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({ busy: null, notice: null, pendingBuilds: [] })
})
