/** Workbench inventory survives failed reads and never equates saved changes with activation. */
import { expect, it, vi } from 'vitest'
import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createWorkbenchManagement, type WorkbenchManagement } from '../src/client/workbenches/management.ts'
import { workbenchCatalog } from '../src/client/workbenches/catalog.ts'
import { publishedWorkbenchAction, publishedWorkbenchDetails } from '../src/client/workbenches/platform.ts'


const bundle: BundleInfo = {
  name: '@local/checklist', version: '1.0.0', description: 'Checklist', official: false,
  availability: 'profile', installed: true, enabled: true, optional: false, removable: true,
  rows: [], overrides: [], client: { platform: 'web', inject: ['@actvero/dsh-capability-ui'] },
}

function fixture() {
  type Remote = Parameters<typeof createWorkbenchManagement>[0]
  const remote = {
    listBundles: vi.fn<Remote['listBundles']>().mockResolvedValue({ ok: true, value: [bundle] }),
    installBundle: vi.fn<Remote['installBundle']>(),
    setBundleEnabled: vi.fn<Remote['setBundleEnabled']>(),
    removeBundle: vi.fn<Remote['removeBundle']>(),
  }
  const publish = vi.fn<(state: WorkbenchManagement) => void>()
  const actions = createWorkbenchManagement(remote, publish)
  const latest = () => publish.mock.calls.at(-1)?.[0] ?? actions.initial
  return { actions, remote, publish, latest }
}

it('retains the last inventory and blocks mutations until a failed read recovers', async () => {
  const { actions, remote, latest } = fixture()
  await actions.refresh()
  remote.listBundles.mockRejectedValueOnce(new Error('offline'))
  await actions.refresh()
  expect(latest()).toMatchObject({ bundles: [bundle], inventoryFailed: true, refreshing: false })
  await actions.remove(bundle.name)
  expect(remote.removeBundle).not.toHaveBeenCalled()
  await actions.refresh()
  expect(latest().inventoryFailed).toBe(false)
})

it.each([
  ['applied', 'enabled'], ['restart-required', 'restart'], ['overridden', 'overridden'],
  ['cancelled', 'cancelled'], ['failed', 'operationFailed'],
] as const)('reports %s independently of persistent selection', async (application, notice) => {
  const { actions, remote, latest } = fixture()
  remote.setBundleEnabled.mockResolvedValue({ ok: true, value: { application, changed: true, stage: 'enable', target: bundle.name } })
  await actions.setEnabled(bundle.name, true)
  expect(latest().notice).toBe(notice)
  expect(latest().restart).toEqual(application === 'restart-required' ? [bundle.name] : [])
})

it('serializes user operations and suppresses updates after disposal', async () => {
  const { actions, remote, publish } = fixture()
  const pending = Promise.withResolvers<{ ok: true; value: ChangeResult }>()
  remote.setBundleEnabled.mockReturnValue(pending.promise)
  const first = actions.setEnabled(bundle.name, false)
  await actions.remove(bundle.name)
  expect(remote.removeBundle).not.toHaveBeenCalled()
  actions.dispose()
  const calls = publish.mock.calls.length
  pending.resolve({ ok: true, value: { application: 'applied', changed: true, stage: 'enable', target: bundle.name } })
  await first
  expect(publish.mock.calls).toHaveLength(calls)
  expect(remote.listBundles).not.toHaveBeenCalled()
})

it('keeps disabled releases in the catalog and separates installed and running versions', () => {
  const { actions } = fixture()
  const view = { ...actions.initial, bundles: [{ ...bundle, enabled: false }], entries: [], remembered: [], opened: null }
  const resolveText = () => 'Localized title'
  expect(workbenchCatalog(view, resolveText)).toMatchObject([{ id: bundle.name, version: '1.0.0', state: 'disabledState' }])
  const live = { id: bundle.name, name: 'Checklist', description: 'Saved tasks', version: '1.0.0' }
  expect(workbenchCatalog({ ...view, entries: [live], bundles: [{ ...bundle, version: '1.1.0' }] }, resolveText))
    .toMatchObject([{ version: '1.1.0', runningVersion: '1.0.0', state: 'restartState' }])
  expect(workbenchCatalog({ ...view, bundles: [{ ...bundle, restartRequired: true }] }, resolveText))
    .toMatchObject([{ state: 'restartState' }])
  expect(workbenchCatalog({ ...view, bundles: [{ ...bundle, error: { code: 'not-bundle' } }] }, resolveText))
    .toMatchObject([{ state: 'failedState' }])
})

it('downloads a newer release only after a platform action and keeps its guarded replacement', async () => {
  const { actions, remote, latest } = fixture()
  const scope = 'a'.repeat(32)
  const workbenchId = 'a0000000-0000-4000-8000-000000000001'
  const oldId = 'a0000000-0000-4000-8000-000000000002'
  const source = `file:/archive/actvero-wb-${scope}-${workbenchId}-${oldId}-${'b'.repeat(64)}.tgz`
  const installed = { ...bundle, source }
  const release = {
    scope, workbenchId, versionId: 'a0000000-0000-4000-8000-000000000003', packageName: bundle.name,
    version: '1.1.0', sha256: 'c'.repeat(64), size: 42, name: 'Checklist', description: '', category: 'office',
    dshRequirement: '*',
  }
  remote.listBundles.mockResolvedValue({ ok: true, value: [installed] })
  remote.installBundle.mockResolvedValue({
    ok: true, value: { application: 'restart-required', changed: true, stage: 'enable', target: bundle.name },
  })
  const download = vi.fn(async () => '/archive/latest.tgz')
  await actions.refresh()
  expect(publishedWorkbenchAction(release, scope, undefined)).toBe('usePublished')
  expect(publishedWorkbenchAction(release, scope, installed)).toBe('updateAndOpen')
  const current = { ...release, version: '1.0.0', versionId: oldId, sha256: 'b'.repeat(64) }
  expect(publishedWorkbenchAction(current, scope, installed)).toBe('open')
  expect(publishedWorkbenchAction(release, 'd'.repeat(32), installed)).toBe('platformConflict')
  const live = {
    id: bundle.name, name: 'Checklist', description: '', version: '1.0.0', runningVersion: '1.0.0', bundle: installed,
    state: 'ready' as const, iconUrl: 'loaded-icon', previewUrls: ['loaded-preview'], author: 'Author', tags: ['Tasks'],
  }
  expect(publishedWorkbenchDetails(current, scope, live)).toMatchObject({
    iconUrl: 'loaded-icon', previewUrls: ['loaded-preview'], author: 'Author', state: 'ready',
  })
  expect(publishedWorkbenchDetails({ ...current, previewUrls: ['published-preview'] }, scope, live).previewUrls)
    .toEqual(['published-preview'])
  expect(publishedWorkbenchDetails(release, scope, live).previewUrls).toBeUndefined()
  expect(publishedWorkbenchDetails(current, 'd'.repeat(32), live).previewUrls).toBeUndefined()
  expect(publishedWorkbenchDetails(current, scope, { ...live, runningVersion: '1.1.0' }).previewUrls).toBeUndefined()
  expect(download).not.toHaveBeenCalled()

  await expect(actions.installPublished(release, scope, download, () => true)).resolves.toBe(false)
  expect(download).toHaveBeenCalledOnce()
  expect(remote.installBundle).toHaveBeenCalledWith('/archive/latest.tgz', {
    enabled: true, registry: null, replace: { name: bundle.name, version: '1.0.0', nextVersion: '1.1.0', source },
  })
  expect(latest().notice).toBe('restart')
})
