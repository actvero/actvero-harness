/** Workbench inventory survives failed reads and never equates saved changes with activation. */
import { expect, it, vi } from 'vitest'
import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createWorkbenchManagement, type WorkbenchManagement } from '../src/client/workbenches/management.ts'
import { workbenchCatalog, workbenchIconUrl } from '../src/client/workbenches/catalog.ts'
import { publishedWorkbenchAction } from '../src/client/workbenches/platform.ts'

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
  const beforeChange = vi.fn<Parameters<typeof createWorkbenchManagement>[2]>().mockResolvedValue(null)
  const actions = createWorkbenchManagement(remote, publish, beforeChange)
  const latest = () => publish.mock.calls.at(-1)?.[0] ?? actions.initial
  return { actions, remote, publish, latest, beforeChange }
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
  ['applied', null], ['restart-required', 'restart'], ['overridden', 'overridden'],
  ['cancelled', null], ['failed', 'operationFailed'],
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
  const entered = Promise.withResolvers<undefined>()
  remote.setBundleEnabled.mockImplementation(() => { entered.resolve(undefined); return pending.promise })
  const first = actions.setEnabled(bundle.name, false)
  await entered.promise
  await actions.remove(bundle.name)
  expect(remote.removeBundle).not.toHaveBeenCalled()
  actions.dispose()
  const calls = publish.mock.calls.length
  pending.resolve({ ok: true, value: { application: 'applied', changed: true, stage: 'enable', target: bundle.name } })
  await first
  expect(publish.mock.calls).toHaveLength(calls)
  expect(remote.listBundles).not.toHaveBeenCalled()
})

it.each(['activeConversation', 'sessionStateUnavailable'] as const)('retains installations when activity inspection reports %s', async (notice) => {
  const { actions, remote, latest, beforeChange } = fixture()
  beforeChange.mockResolvedValue(notice)
  await actions.setEnabled(bundle.name, false)
  await actions.remove(bundle.name)
  expect(remote.setBundleEnabled).not.toHaveBeenCalled()
  expect(remote.removeBundle).not.toHaveBeenCalled()
  expect(latest()).toMatchObject({ bundles: [bundle], busy: null, notice })
  beforeChange.mockResolvedValue(null)
  remote.removeBundle.mockResolvedValue({ ok: true, value: { application: 'applied', changed: true, stage: 'remove', target: bundle.name } })
  await actions.remove(bundle.name)
  expect(remote.removeBundle).toHaveBeenCalledOnce()
  expect(latest().notice).toBeNull()
})

it('does not begin a package change after disposal during activity inspection', async () => {
  const { actions, remote, beforeChange } = fixture()
  const checked = Promise.withResolvers<null>()
  beforeChange.mockReturnValue(checked.promise)
  const removal = actions.remove(bundle.name)
  actions.dispose()
  checked.resolve(null)
  await removal
  expect(remote.removeBundle).not.toHaveBeenCalled()
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

it('keeps the package icon authoritative across loading and legacy Client descriptors', () => {
  const entry = { id: bundle.name, name: 'Checklist', description: 'Saved tasks', version: '1.0.0', iconUrl: 'legacy-client-icon' }
  const installed = { ...bundle, meta: { icon: 'package-icon' } }
  const view = { entries: [entry], remembered: [], bundles: [installed], restart: [] }
  expect(workbenchIconUrl(view, bundle.name)).toBe('package-icon')
  expect(workbenchCatalog(view, () => 'Checklist')[0]?.iconUrl).toBe('package-icon')
  expect(workbenchIconUrl({ ...view, entries: [] }, bundle.name)).toBe('package-icon')
  expect(workbenchIconUrl({ ...view, bundles: [] }, bundle.name)).toBe('legacy-client-icon')
  expect(workbenchIconUrl({ entries: [], bundles: [], remembered: [entry] }, bundle.name)).toBe('legacy-client-icon')
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
  expect(download).not.toHaveBeenCalled()

  await expect(actions.installPublished(release, scope, download, () => true)).resolves.toBe(false)
  expect(download).toHaveBeenCalledOnce()
  expect(remote.installBundle).toHaveBeenCalledWith('/archive/latest.tgz', {
    enabled: true, registry: null, replace: { name: bundle.name, version: '1.0.0', nextVersion: '1.1.0', source },
  })
  expect(latest().notice).toBe('restart')
})
