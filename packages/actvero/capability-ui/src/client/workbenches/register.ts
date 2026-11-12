import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { workbenchArchiveSource, type AccountSnapshot, type PublishedWorkbench, type PublishedWorkbenchCatalog } from '@actvero/dsh-client-account/protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchDisplayRequest, WorkbenchDisplayState, WorkbenchId, WorkbenchDocument, WorkbenchInstanceId } from '../../types.ts'
import type { WorkbenchClientContext, WorkbenchObjectLocation } from '../../contracts.ts'
import { resolveWorkbenchProtocol } from '../../workbench-protocol.ts'
import type { ActveroWorkbench, ActveroWorkbenchRegistry } from '../../contracts.ts'
import { createWorkbenchManagement, type WorkbenchManagement } from './management.ts'
import { Example } from './Example.tsx'
import checklistPreview from './assets/project-checklist.png'
import checklistProgressPreview from './assets/project-checklist-progress.png'
import checklistReviewPreview from './assets/project-checklist-review.png'
import checklistCompletedPreview from './assets/project-checklist-completed.png'
import checklistDarkPreview from './assets/project-checklist-dark.png'
import { Manager } from './Manager.tsx'
import { OpenWorkbench, BusinessContent, WorkbenchChat, WorkbenchBadge, WorkbenchUtilities, type ConversationWorkbenchActions } from './RuntimeView.tsx'
import { connectWorkbenchDisplay, waitForWorkbenchView } from './presentation.ts'
import { WorkbenchClientRuntime } from './runtime.ts'
import { workbenchResource } from './resource.ts'
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
import { publishedWorkbenchAction } from './platform.ts'
import { Navigation } from './Navigation.tsx'
import { workbenchIconUrl } from './catalog.ts'
import { IconChecklistOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { en, zh } from './locales.ts'
import { WorkbenchToolbar } from './Toolbar.tsx'
import { registerWorkbenchReferences } from './references.tsx'
import { registerWorkbenchCommands } from './commands.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'actvero.workbenches': keyof typeof zh
  }
}
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { actveroWorkbench: true }
}

const namespace = 'actvero.workbenches'
const managerPanel = 'actvero-workbench-manager' as MainPanelId
const businessPanel = 'actvero-workbench-business' as MainPanelId
type WorkbenchAccessError = 'platformDenied' | 'platformCheckFailed'

const selectionKey = 'actvero.workbenches.selected.v1'
const visibilityKey = 'actvero.workbenches.visibility.v1'

function readVisibility(): Readonly<Partial<Record<string, boolean>>> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(visibilityKey) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.values(value).some(item => typeof item !== 'boolean')) throw new Error('Invalid workbench visibility preferences')
    return Object.fromEntries(Object.entries(value).map(([key, visible]) => [key, visible === true]))
  } catch (error) {
    console.warn('Unable to restore workbench visibility', error)
    return {}
  }
}

function readSelection(): string | null {
  try {
    return localStorage.getItem(selectionKey)
  } catch (error) {
    console.warn('Unable to restore workbench selection', error)
    return null
  }
}

/** Profile catalog and foreground view state consumed by the registered slots. */
export interface WorkbenchView extends WorkbenchManagement {
  location: WorkbenchObjectLocation | null
  platform: { phase: 'login' | 'loading' | 'ready' | 'failed'; catalog?: PublishedWorkbenchCatalog }
  accessEpoch: number
  accessError: WorkbenchAccessError | null
  entries: readonly ActveroWorkbench[]
  opened: string | null
  remembered: readonly ActveroWorkbench[]
  instance: WorkbenchDocument | null
  preparing: boolean
  runtimeFailed: boolean
  chat: SessionReference | null
  chatCollapsed: boolean
  chatPreparing: boolean
  visibility: Readonly<Partial<Record<string, boolean>>>
  canOpenDirectory: boolean
  catalogButtons: Readonly<Partial<Record<string, 'show' | 'hide'>>>
}

/** Human-triggered navigation and local installation. */
export interface WorkbenchAction extends Omit<ReturnType<typeof createWorkbenchManagement>, 'initial' | 'dispose' | 'installPublished' | 'report' | 'setEnabled'> {
  open(id: string): void
  refreshPlatform(): Promise<void>
  usePublished(release: PublishedWorkbench): Promise<void>
  setEnabled(name: string, enabled: boolean): Promise<void>
  back(): void
  context(instanceId: WorkbenchInstanceId | null): WorkbenchClientContext
  supportsAI(instanceId: WorkbenchInstanceId | null): boolean
  /** Open the provider's host-managed data directory using the native file manager.
   * @param id Loaded workbench identity.
   * @returns Resolves after native opening or a visible failure report.
   */
  openDataDirectory(id: string): Promise<void>
  conversation(fresh: boolean): Promise<void>
  /** Switch the floating view to an existing conversation of the current business instance.
   * @param sessionId Associated conversation to display.
   * @returns Resolves after switching or reporting a load failure.
   */
  switchConversation(sessionId: SessionId): Promise<void>
  restoreChat(): void
  collapseChat(): void
  releaseChat(): void
  focusChat(): void
  present(request: WorkbenchDisplayRequest, signal: AbortSignal): Promise<WorkbenchDisplayState>
}

/** Register the Actvero workbench catalog, navigation and native business seat.
 * @param ctx Client plugin scope.
 * @returns Completion when the host catalog and client registrations are ready.
 */
export async function registerWorkbenches(ctx: Context): Promise<void> {
  const providers = await ctx.remote.actveroWorkbench.list()
  if (!providers.ok) throw providers.error
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }))
  const t = ctx.locale.bind(namespace)
  const examples: ActveroWorkbench[] = providers.value.some(entry => entry.id === 'builtin:project-checklist') ? [{
    id: 'builtin:project-checklist', name: t('sampleName'), description: t('sampleDescription'), category: 'office', version: '1.0.0',
    previewUrls: [checklistPreview, checklistProgressPreview, checklistReviewPreview, checklistCompletedPreview, checklistDarkPreview],
  }] : []
  const management = createWorkbenchManagement(ctx.remote.pluginManager, (state) => { update(state) }, async (id) => {
    try { await ctx.sessions.refresh() }
    catch (error) { ctx.logger.warn('Unable to inspect linked conversation activity: %s', error); return 'sessionStateUnavailable' }
    const sessions = ctx.sessions.list.getSnapshot()
    if (sessions.phase !== 'ready') return 'sessionStateUnavailable'
    return sessions.ids.some(key => sessions.byId[key]?.running && sessions.byId[key]?.projectionValues?.actveroWorkbench?.id === id)
      ? 'activeConversation' : null
  })
  let view: WorkbenchView = { ...management.initial, entries: examples, remembered: [], opened: readSelection(),
    platform: { phase: 'login' }, accessEpoch: 0, accessError: null,
    instance: null, location: null, preparing: false, runtimeFailed: false, chat: null, chatCollapsed: true,
    chatPreparing: false, visibility: readVisibility(), canOpenDirectory: false, catalogButtons: {} }
  const listeners = new Set<() => void>()
  const update = (patch: Partial<WorkbenchView>) => {
    view = { ...view, ...patch }
    for (const listener of listeners) listener()
  }
  const source = {
    getSnapshot: () => view,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  const bridge = window.actveroAccount
  let account: AccountSnapshot | null = null
  let accountKey: string | undefined
  let catalogRequest = 0
  const ready = () => account?.phase === 'ready' && account.organization?.status === 'active' && !account.organization.needsLogin
  const refreshPlatform = async () => {
    if (!bridge?.workbenchCatalog || !ready()) return
    const request = ++catalogRequest
    update({ platform: { phase: 'loading', ...(view.platform.catalog ? { catalog: view.platform.catalog } : {}) } })
    try {
      const catalog = await bridge.workbenchCatalog()
      if (request === catalogRequest) update({ platform: { phase: 'ready', catalog } })
    } catch (error) {
      ctx.logger.warn('Unable to list platform workbenches: %s', error)
      if (request === catalogRequest) update({ platform: { phase: 'failed' } })
    }
  }
  const installed = (id: string) => view.bundles.find(bundle => bundle.installed && bundle.name === id)
  const checkAccess = async (id: string): Promise<WorkbenchAccessError | null> => {
    if (id === 'builtin:project-checklist') return null
    if (!installed(id) || view.inventoryFailed) await management.refresh()
    if (view.inventoryFailed) return 'platformCheckFailed'
    const source = workbenchArchiveSource(installed(id)?.source)
    if (!source) return null
    if (!bridge?.workbenchCheck || !ready()) return 'platformDenied'
    const epoch = view.accessEpoch
    try {
      const result = await bridge.workbenchCheck(source)
      if (result.status !== 'current') void refreshPlatform()
      return view.accessEpoch === epoch && result.adoptedUsable ? null : 'platformDenied'
    } catch (error) {
      ctx.logger.warn('Unable to check installed workbench: %s', error)
      return 'platformCheckFailed'
    }
  }
  let navigation = 0
  let pendingOpen: { id: string; version: string; signal: AbortSignal; epoch: number } | undefined
  let chatGeneration = 0
  let preparation = 0
  let linkedSession: SessionId | null = null
  let restoreSidebar: boolean | undefined
  let changingSidebar = false
  let displaying = new AbortController()
  let observedPanel = ctx.layout.panelInfo.getSnapshot().activePanelId
  const selectPanel = (panel: MainPanelId | null) => {
    observedPanel = panel
    ctx.layout.selectPanel(panel)
    if (panel !== businessPanel) restoreNavigation()
  }
  const snapshot = (): WorkbenchDisplayState => {
    const business = ctx.layout.panelInfo.getSnapshot().activePanelId === businessPanel
      ? document.querySelector<HTMLElement>('[data-workbench-main]') : null
    const conversation = ctx.layout.panelInfo.getSnapshot().activePanelId === null
      ? document.querySelector<HTMLElement>('[data-workbench-conversation]') : null
    const root = business ?? conversation
    if (root?.querySelector('[data-slot-error], [data-factory-error]')) throw new Error('Workbench view failed to render')
    const id = (business?.dataset.workbenchMain ?? conversation?.dataset.workbenchConversation) as WorkbenchId | undefined
    const instanceId = (business?.dataset.workbenchInstance ?? conversation?.dataset.workbenchInstance) as WorkbenchInstanceId | undefined
    const sessionId = root?.dataset.workbenchSession as SessionId | undefined
    const preview = conversation?.querySelector('[data-workbench-preview]')
    return { id: id ?? null, instanceId: instanceId ?? null, sessionId: sessionId ?? null,
      mode: business ? 'business' : conversation ? 'conversation' : 'other',
      aiVisible: Boolean(business?.querySelector('[data-workbench-ai]:not([hidden])')),
      previewVisible: Boolean(preview), sidebar: ctx.layout.sidebarExpanded.getSnapshot() ? 'expanded' : 'collapsed' }
  }
  const restoreNavigation = () => {
    if (restoreSidebar !== undefined) {
      changingSidebar = true
      try { ctx.layout.setSidebarExpanded(restoreSidebar) } finally { changingSidebar = false; restoreSidebar = undefined }
    }
  }
  const setFocus = (focus: boolean) => {
    restoreSidebar ??= ctx.layout.sidebarExpanded.getSnapshot()
    changingSidebar = true
    try { ctx.layout.setSidebarExpanded(focus ? false : restoreSidebar) } finally { changingSidebar = false }
  }
  ctx.effect(() => ctx.layout.panelInfo.subscribe(() => {
    const panel = ctx.layout.panelInfo.getSnapshot().activePanelId
    if (panel === observedPanel) return
    observedPanel = panel
    displaying.abort()
    if (panel !== businessPanel) restoreNavigation()
  }))
  const runtime = new WorkbenchClientRuntime(ctx)
  ctx.effect(() => {
    let active = true
    void ctx.remote.session.canOpenWorkspacePath().then((result) => {
      if (active) update({ canOpenDirectory: result.ok && result.value })
    }).catch((error: unknown) => { ctx.logger.warn('Unable to inspect native file opening: %s', error) })
    return () => { active = false }
  })
  const failed = () => { ctx.capabilityHub.notify(ctx.locale.bind(namespace)('runtimeFailed')) }
  const rememberVisibility = (key: string, visible: boolean) => {
    const visibility = { ...view.visibility, [key]: visible }
    update({ visibility })
    try { localStorage.setItem(visibilityKey, JSON.stringify(visibility)) }
    catch (error) { console.warn('Unable to save workbench visibility', error) }
  }
  ctx.effect(() => {
    let expanded = ctx.layout.sidebarExpanded.getSnapshot()
    let width = window.innerWidth
    return ctx.layout.sidebarExpanded.subscribe(() => {
      const next = ctx.layout.sidebarExpanded.getSnapshot()
      const resized = width !== window.innerWidth
      width = window.innerWidth
      if (next === expanded) return
      expanded = next
      if (!changingSidebar && !resized && view.opened && ctx.layout.panelInfo.getSnapshot().activePanelId === businessPanel) {
        rememberVisibility(`focus:${view.opened}`, !next)
      }
    })
  })
  const collapseChat = () => {
    chatGeneration++
    if (view.instance) rememberVisibility(`chat:${view.instance.instanceId}`, false)
    update({ chatCollapsed: true })
  }
  const releaseChat = () => {
    chatGeneration++; preparation++; view.chat?.release()
    update({ chat: null, chatCollapsed: true, chatPreparing: false })
  }
  const showChat = async (id: SessionId) => {
    if (view.instance) rememberVisibility(`chat:${view.instance.instanceId}`, true)
    if (view.chat?.sessionId === id) { update({ chatCollapsed: false }); return }
    const generation = ++chatGeneration
    const reference = ctx.sessions.retain(id, { source: 'actveroWorkbench' })
    try {
      await reference.ready
      if (generation !== chatGeneration || ctx.fiber.uid === null) { reference.release(); return }
      view.chat?.release()
      linkedSession = id
      update({ chat: reference, chatCollapsed: false })
    } catch (error) { reference.release(); throw error }
  }
  const context = (instanceId: WorkbenchInstanceId | null, sessionId: SessionId | null) => {
    const generation = chatGeneration
    const providerId = sessionId
      ? ctx.sessions.list.getSnapshot().byId[sessionId]?.projectionValues?.actveroWorkbench?.id : view.instance?.id
    const descriptor = view.entries.find(entry => entry.id === (providerId ?? view.opened))
    const scope = descriptor ? workbenchArchiveSource(installed(descriptor.id)?.source)?.scope : undefined
    const providerEntry = view.entries.find(entry => entry.id === providerId)
    const isCurrent = () => generation === chatGeneration && ctx.fiber.uid !== null
      && (providerEntry !== undefined && view.entries.includes(providerEntry))
      && (ctx.layout.panelInfo.getSnapshot().activePanelId === businessPanel && view.instance?.instanceId === instanceId
        || sessionId !== null && ctx.layout.panelInfo.getSnapshot().activePanelId === null
          && Boolean(ctx.sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView))
    return { ...runtime.context(instanceId, sessionId, async (id) => {
      if (generation === chatGeneration && ctx.fiber.uid !== null) await showChat(id)
    }, async (options) => {
      const document = instanceId ? await ctx.remote.actveroWorkbench.read({ instanceId }) : null
      if (document && !document.ok) throw document.error
      const id = document?.ok ? document.value.id : view.opened as WorkbenchId | null
      if (!id) throw new Error('No workbench is selected')
      const result = await ctx.remote.actveroWorkbench.show({ ...options, id, ...(sessionId ? { sessionId } : {}) })
      if (!result.ok) throw result.error
      if (result.value.status !== 'confirmed') throw new RemoteError('workbench/display', result.value.reason, { status: result.value.status })
      return result.value.state
    }, snapshot, (selection) => {
      const signal = ctx.layout.beginNavigation()
      return runtime.reference(instanceId, sessionId, selection, async (id) => {
        signal.throwIfAborted()
        if (generation !== chatGeneration || ctx.fiber.uid === null) throw new RemoteError('workbench/reference', 'Workbench navigation superseded', { status: 'superseded' })
        if (ctx.layout.panelInfo.getSnapshot().activePanelId === businessPanel) {
          await showChat(id)
          signal.throwIfAborted()
          if (view.chat?.sessionId !== id || view.chatCollapsed) throw new RemoteError('workbench/reference', 'Workbench conversation changed', { status: 'superseded' })
        } else if (sessionId !== id || !ctx.sessions.retainInfo(id).getSnapshot().retainedBy.mainView) {
          throw new RemoteError('workbench/reference', 'Workbench conversation is no longer displayed', { status: 'superseded' })
        }
      }, signal)
    }, isCurrent, descriptor && scope ? { ...descriptor, scope } : descriptor),
    location: view.location?.instanceId === instanceId ? view.location : null }
  }
  const load = async (id: string, target?: WorkbenchInstanceId, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const reusable = view.opened === id && view.instance && !view.preparing && !view.runtimeFailed
      && (!target || target === view.instance.instanceId) ? view.instance : null
    const generation = ++navigation
    if (!reusable) {
      releaseChat()
      update({ opened: id, instance: null, location: null, preparing: true, runtimeFailed: false, accessError: null })
    }
    try {
      const accessError = await checkAccess(id)
      if (generation !== navigation || ctx.fiber.uid === null) return
      if (accessError) {
        releaseChat()
        update({ instance: null, location: null, preparing: false, accessError })
        return
      }
      signal?.throwIfAborted()
      if (reusable) { update({ accessError: null }); return reusable }
      const opened = await runtime.open(id)
      const result = target ? await ctx.remote.actveroWorkbench.read({ instanceId: target }) : null
      if (result && !result.ok) throw result.error
      const instance = result?.ok ? result.value : opened
      if (instance && instance.id !== id) throw new Error('Workbench instance belongs to another provider')
      if (generation !== navigation || ctx.fiber.uid === null) throw new Error('Workbench navigation superseded')
      signal?.throwIfAborted()
      update({ instance, preparing: false })
      return instance
    } catch (error) {
      if (generation === navigation && ctx.fiber.uid !== null && !signal?.aborted) {
        ctx.logger.warn('Unable to open workbench: %s', error)
        update({ preparing: false, runtimeFailed: true })
      }
      throw error
    }
  }
  const settings = new Set<string>()
  const objectNavigation = new Set<string>()
  const conversationTargets = new Map<string, NonNullable<Parameters<ActveroWorkbenchRegistry['register']>[2]>['conversationTarget']>()
  const settingsId = (id: string) => `actvero.workbench:${id}`
  const registry: ActveroWorkbenchRegistry = {
    async openObject(target) {
      const captured = { ...target }
      const entry = view.entries.find(item => item.id === captured.workbenchId)
      if (!objectNavigation.has(captured.workbenchId)) throw new RemoteError('workbench/object', 'Workbench object navigation is unavailable', { status: 'unavailable' })
      displaying.abort()
      displaying = new AbortController()
      const signal = AbortSignal.any([ctx.layout.beginNavigation(), displaying.signal])
      const document = await ctx.remote.actveroWorkbench.read({ instanceId: captured.instanceId })
      if (!document.ok) throw document.error
      if (document.value.id !== captured.workbenchId) {
        throw new RemoteError('workbench/object', 'Object belongs to another workbench', { status: 'mismatch' })
      }
      const object = await ctx.remote.actveroWorkbench.inspectObject({
        instanceId: captured.instanceId, objectId: captured.objectId,
      }, signal)
      if (!object.ok) throw object.error
      signal.throwIfAborted()
      if (!entry || !view.entries.includes(entry)) throw new RemoteError('workbench/object', 'Workbench was unloaded', { status: 'unavailable' })
      await load(captured.workbenchId, captured.instanceId, signal)
      signal.throwIfAborted()
      if (!view.entries.includes(entry)) throw new RemoteError('workbench/object', 'Workbench was unloaded', { status: 'unavailable' })
      update({ location: captured })
      selectPanel(businessPanel)
      const mounted = AbortSignal.any([ctx.layout.beginNavigation(), displaying.signal])
      await waitForWorkbenchView(() => {
        const state = snapshot()
        return state.instanceId === captured.instanceId && state.mode === 'business' ? state : null
      }, mounted)
    },
    openSettings(id) {
      const navigation = ctx.get('settingsNavigation')
      if (!settings.has(id) || !navigation) throw new Error(`Workbench settings unavailable: ${id}`)
      navigation.open(settingsId(id))
    },
    register(descriptor, component, options) {
      resolveWorkbenchProtocol(descriptor.protocol)
      const { id, name, description, version } = descriptor
      if (!/^[a-z0-9@][a-z0-9@/._-]{0,213}$/.test(id) || !name.trim() || !description.trim() || !version.trim()) {
        throw new Error('Invalid Actvero workbench registration.')
      }
      if (view.entries.some(item => item.id === id)) throw new Error(`Duplicate Actvero workbench: ${id}`)
      const entry = { ...descriptor }
      return ctx.effect(function* () {
        if (options?.conversationTarget) {
          conversationTargets.set(id, options.conversationTarget)
          yield () => { conversationTargets.delete(id) }
        }
        if (options?.objectNavigation) {
          objectNavigation.add(id)
          yield () => { objectNavigation.delete(id) }
        }
        yield registerWorkbenchCommands(ctx, id, options?.commands ?? [], () => ctx.locale.bind(namespace)('commandUnavailable'))
        yield ctx.slots.inject('actvero.workbench.body', () => ctx.slots.register({
          name: 'actvero.workbench.body', key: entry.id, locale: options?.locale, store: options?.store,
        }, component))
        if (options?.header) {
          const header = options.header
          yield ctx.slots.inject('actvero.workbench.header', () => ctx.slots.register({
            name: 'actvero.workbench.header', key: entry.id, locale: options.locale, store: options.store,
          }, header))
        }
        if (options?.settings) {
          const page = options.settings
          yield ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section', id: settingsId(id), label: page.label ?? (() => name),
            locale: options.locale, store: options.store,
          }, page.component))
          settings.add(id)
          yield () => { settings.delete(id) }
        }
        yield () => {
          const { [id]: _removed, ...catalogButtons } = view.catalogButtons
          update({ entries: view.entries.filter(item => item !== entry), catalogButtons })
        }
        update({ entries: [...view.entries, entry], remembered: [...view.remembered.filter(item => item.id !== entry.id), entry],
          catalogButtons: { ...view.catalogButtons, [id]: options?.catalogButton ?? 'show' } })
        if (pendingOpen?.id === id && pendingOpen.version === version) {
          const intent = pendingOpen
          pendingOpen = undefined
          queueMicrotask(() => {
            if (!intent.signal.aborted && intent.epoch === view.accessEpoch && ctx.fiber.uid !== null) action.open(id)
          })
        }
      })
    },
  }

  const { initial: _initial, dispose: _dispose, installPublished, report, setEnabled, ...operations } = management
  const action: WorkbenchAction = {
    open(id) {
      if (!view.entries.some(entry => entry.id === id)) return
      linkedSession = null
      displaying.abort()
      const opening = load(id)
      const generation = navigation
      void opening.then(() => {
        const preference = view.visibility[`focus:${id}`] ?? (view.entries.find(item => item.id === id)?.display?.sidebar === 'focus')
        setFocus(preference)
        action.restoreChat()
      }).catch(() => { if (generation === navigation && ctx.fiber.uid !== null) failed() })
      try {
        localStorage.setItem(selectionKey, id)
      } catch (error) {
        console.warn('Unable to save workbench selection', error)
      }
      selectPanel(businessPanel)
    },
    refreshPlatform,
    async setEnabled(id, enabled) {
      if (enabled) {
        const error = await checkAccess(id)
        if (error) { report(error); return }
      }
      await setEnabled(id, enabled)
    },
    async usePublished(release) {
      const catalog = view.platform.catalog
      if (view.platform.phase !== 'ready' || !catalog || !bridge?.workbenchDownload || view.busy) return
      const download = bridge.workbenchDownload
      const epoch = view.accessEpoch
      const signal = ctx.layout.beginNavigation()
      pendingOpen = undefined
      const stillCurrent = () => view.accessEpoch === epoch && ctx.fiber.uid !== null
      await management.refresh()
      if (!stillCurrent() || view.busy || view.inventoryFailed) return
      const bundle = installed(release.packageName)
      const operation = publishedWorkbenchAction(release, catalog.scope, bundle)
      if (operation === 'restartState') { report('restart'); return }
      if (operation === 'platformConflict') { report('platformConflict'); return }
      if (operation === 'open') {
        if (view.entries.some(entry => entry.id === release.packageName && entry.version === release.version)) {
          if (!signal.aborted) action.open(release.packageName)
          return
        }
        const error = await checkAccess(release.packageName)
        if (error) { report(error); return }
        if (!stillCurrent() || !await setEnabled(release.packageName, true)) return
      } else if (!await installPublished(release, catalog.scope,
        () => download({ ...release, scope: catalog.scope }), stillCurrent)) {
        if (stillCurrent()) void refreshPlatform()
        return
      }
      if (!stillCurrent() || signal.aborted) return
      if (view.entries.some(entry => entry.id === release.packageName && entry.version === release.version))
        action.open(release.packageName)
      else pendingOpen = { id: release.packageName, version: release.version, signal, epoch }
    },
    back() {
      displaying.abort()
      releaseChat()
      selectPanel(managerPanel)
    },
    context: instanceId => context(instanceId, linkedSession),
    supportsAI: instanceId => runtime.supportsAI(instanceId),
    async openDataDirectory(id) {
      try {
        const instance = await runtime.open(id)
        if (!instance) throw new Error('Workbench has no managed data directory')
        const environment = await ctx.remote.actveroWorkbench.environment({ instanceId: instance.instanceId })
        if (!environment.ok) throw environment.error
        const opened = await ctx.remote.session.openWorkspacePath({ path: environment.value.dataDirectory })
        if (!opened.ok) throw opened.error
      } catch (error) {
        ctx.logger.warn('Unable to open workbench data directory: %s', error)
        ctx.capabilityHub.notify(ctx.locale.bind(namespace)('openDirectoryFailed'))
      }
    },
    restoreChat() {
      if (runtime.supportsAI(view.instance?.instanceId ?? null) && view.instance && (view.visibility[`chat:${view.instance.instanceId}`] ?? view.entries.find(item => item.id === view.opened)?.display?.ai !== 'hide')) void action.conversation(false)
    },
    collapseChat,
    releaseChat,
    focusChat() {
      const id = view.chat?.sessionId
      if (!id) return
      ctx.uiWorkspace.openSession(id)
      releaseChat()
      selectPanel(null)
    },
    async present(request, callerSignal) {
      displaying.abort()
      displaying = new AbortController()
      const signal = AbortSignal.any([callerSignal, displaying.signal])
      signal.throwIfAborted()
      if (!view.entries.some(entry => entry.id === request.id)) throw new Error('Workbench client is not loaded')
      if (request.objectId !== undefined && request.mode !== 'business') throw new Error('Business object navigation requires business mode')
      if (view.opened !== request.id) linkedSession = null
      const instance = await load(request.id)
      signal.throwIfAborted()
      if (request.objectId !== undefined) {
        if (!instance || !objectNavigation.has(request.id)) throw new Error('Workbench object navigation is unavailable')
        const obj = await ctx.remote.actveroWorkbench.inspectObject({ instanceId: instance.instanceId, objectId: request.objectId }, signal)
        if (!obj.ok) throw obj.error
        signal.throwIfAborted()
      }
      if (request.sessionId) {
        await ctx.sessions.refresh()
        signal.throwIfAborted()
        if (!instance || ctx.sessions.list.getSnapshot().byId[request.sessionId]?.projectionValues?.actveroWorkbench?.instanceId
          !== instance.instanceId) {
          throw new Error('Conversation belongs to another workbench')
        }
      }
      if (request.objectId !== undefined && instance) {
        update({ location: { workbenchId: request.id, instanceId: instance.instanceId, objectId: request.objectId } })
      }
      linkedSession = request.sessionId ?? linkedSession
      let expectedSessionId: SessionId | undefined
      if (request.mode === 'business') selectPanel(businessPanel)
      else {
        if (!instance || !runtime.supportsAI(instance.instanceId)) throw new Error('Workbench AI is disabled')
        const sessionId = request.sessionId ?? await runtime.conversation(instance.instanceId)
        expectedSessionId = sessionId
        signal.throwIfAborted()
        rememberVisibility(`preview:${sessionId}:${instance.instanceId}`, request.mode === 'preview')
        observedPanel = null
        ctx.uiWorkspace.openSession(sessionId)
        releaseChat()
        selectPanel(null)
      }
      const generation = navigation
      const abort = () => { if (generation === navigation) { navigation++; chatGeneration++ } }
      signal.addEventListener('abort', abort, { once: true })
      try {
        if (request.mode === 'business') {
          const focus = request.sidebar === undefined ? view.visibility[`focus:${request.id}`]
            ?? view.entries.find(entry => entry.id === request.id)?.display?.sidebar === 'focus' : request.sidebar === 'focus'
          setFocus(focus)
          if (instance && request.ai !== undefined) rememberVisibility(`chat:${instance.instanceId}`, request.ai === 'show')
          if (request.ai === 'show') {
            if (!instance || !runtime.supportsAI(instance.instanceId)) throw new Error('Workbench AI is disabled')
            const sessionId = request.sessionId ?? await runtime.conversation(instance.instanceId)
            expectedSessionId = sessionId
            signal.throwIfAborted()
            await showChat(sessionId)
          } else if (request.ai === 'hide') collapseChat()
          else if (instance && runtime.supportsAI(instance.instanceId)
            && (view.visibility[`chat:${instance.instanceId}`] ?? view.entries.find(entry => entry.id === request.id)?.display?.ai !== 'hide')) {
            const sessionId = await runtime.conversation(instance.instanceId, request.sessionId)
            expectedSessionId = sessionId
            signal.throwIfAborted()
            await showChat(sessionId)
          }
        }
        return await waitForWorkbenchView(() => {
          const state = snapshot()
          if (state.id !== request.id || (request.mode === 'business' ? state.mode !== 'business'
            : state.mode !== 'conversation' || state.previewVisible !== (request.mode === 'preview'))) return null
          if (expectedSessionId && state.sessionId !== expectedSessionId) return null
          if (request.mode === 'business' && request.ai !== undefined && state.aiVisible !== (request.ai === 'show')) return null
          return state
        }, signal)
      } finally { signal.removeEventListener('abort', abort) }
    },
    async conversation(fresh) {
      if (!view.instance || view.chatPreparing) return
      const generation = chatGeneration
      const request = ++preparation
      const instance = view.instance
      const entry = view.entries.find(item => item.id === instance.id)
      const target = conversationTargets.get(instance.id)
      const current = context(instance.instanceId, linkedSession)
      update({ chatPreparing: true })
      try {
        if (fresh) {
          const objectId = context(view.instance.instanceId, linkedSession).object?.id ?? null
          const result = await ctx.remote.actveroWorkbench.bind({ instanceId: view.instance.instanceId, objectId })
          if (!result.ok) throw result.error
          await ctx.sessions.refresh()
          if (generation === chatGeneration && ctx.fiber.uid !== null) await showChat(result.value.sessionId)
        } else {
          const options = target ? { objectId: await target() } : undefined
          if (generation !== chatGeneration || ctx.fiber.uid === null || view.instance !== instance
            || !entry || !view.entries.includes(entry)) return
          await current.conversation(options)
        }
      } catch (error) {
        ctx.logger.warn('Unable to open workbench conversation: %s', error)
        if (request === preparation && ctx.fiber.uid !== null) failed()
      } finally {
        if (request === preparation) update({ chatPreparing: false })
      }
    },
    async switchConversation(sessionId) {
      if (!view.instance || view.chatPreparing) return
      const selection = ctx.sessions.list.getSnapshot().byId[sessionId]?.projectionValues?.actveroWorkbench
      if (selection?.instanceId !== view.instance.instanceId) { failed(); return }
      const request = ++preparation
      update({ chatPreparing: true })
      try { await showChat(sessionId) }
      catch (error) {
        ctx.logger.warn('Unable to switch workbench conversation: %s', error)
        if (request === preparation && ctx.fiber.uid !== null) failed()
      } finally {
        if (request === preparation) update({ chatPreparing: false })
      }
    },
    ...operations,
  }

  ctx.effect(() => {
    const refresh = () => { void management.refresh() }
    const disposers = [ctx.remote.$on('plugin-manager/changed', refresh), ctx.on('connection/reset', refresh)]
    if (bridge) {
      const changed = (snapshot: AccountSnapshot | null) => {
        account = snapshot
        const key = snapshot && JSON.stringify([snapshot.baseUrl, snapshot.user?.id, snapshot.organization?.memberId, ready()])
        if ((key ?? undefined) === accountKey) return
        accountKey = key ?? undefined
        catalogRequest++
        pendingOpen = undefined
        update({ accessEpoch: view.accessEpoch + 1, platform: { phase: ready() ? 'loading' : 'login' } })
        if (view.opened && workbenchArchiveSource(installed(view.opened)?.source)) {
          navigation++
          releaseChat()
          update({ instance: null, preparing: false, accessError: 'platformDenied' })
        }
        void refreshPlatform()
      }
      let received = false
      disposers.push(bridge.subscribe((snapshot) => { received = true; changed(snapshot) }))
      void bridge.snapshot().then((snapshot) => {
        if (!received && ctx.fiber.uid !== null) changed(snapshot)
      }).catch(error => ctx.logger.warn('Unable to read the workbench account: %s', error))
    }
    refresh()
    return () => { catalogRequest++; management.dispose(); for (const dispose of disposers) dispose() }
  })

  const inject = () => ({ hooks: { view: source }, action,
    resolveText: (text: Parameters<typeof ctx.locale.resolveText>[0]) => ctx.locale.resolveText(text),
  })
  ctx.effect(() => ctx.reflect.provide('actveroWorkbenches', registry))
  ctx.effect(() => ctx.resources.register(workbenchResource(ctx.remote.actveroWorkbench)))
  ctx.effect(() => connectWorkbenchDisplay(ctx, (request, signal) => action.present(request, signal), snapshot))
  ctx.effect(() => () => { displaying.abort(); navigation++; releaseChat(); restoreNavigation() })
  registerWorkbenchReferences(ctx, target => registry.openObject(target))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: managerPanel, order: -20, label: () => t('title'),
  }, WorkbenchIcon))
  ctx.slots.inject('sidebar.panellist.row', () => ctx.slots.register({
    name: 'sidebar.panellist.row', key: managerPanel, locale: namespace, inject,
  }, Navigation))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: managerPanel, locale: namespace, inject,
  }, Manager))
  ctx.effect(() => ctx.slots.registerFactory({
    name: 'actvero.workbench.content', scope: 'root', locale: namespace,
    children: { 'actvero.workbench.body': { kind: 'keyed', scope: 'root' } },
  }, BusinessContent))
  ctx.effect(() => ctx.slots.registerFactory({ name: 'actvero.workbench.toolbar', scope: 'root', locale: namespace }, WorkbenchToolbar))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: businessPanel, locale: namespace, inject,
    children: { 'actvero.workbench.chat': { kind: 'single', scope: 'session' },
      'actvero.workbench.header': { kind: 'keyed', scope: 'root' } },
  }, OpenWorkbench))
  ctx.slots.inject('actvero.workbench.chat', () => ctx.slots.register({ name: 'actvero.workbench.chat' }, WorkbenchChat))
  if (examples.length) ctx.slots.inject('actvero.workbench.body', () => ctx.slots.register({
    name: 'actvero.workbench.body', key: 'builtin:project-checklist', locale: namespace,
  }, Example))
  const conversationAction = (sessionId: SessionId): ConversationWorkbenchActions => ({
    detach: async () => { const result = await ctx.remote.actveroWorkbench.detach({ sessionId }); if (!result.ok) throw result.error },
    open(id, instanceId, selectedSession) {
      linkedSession = selectedSession
      void action.present({ id: id as WorkbenchId, mode: 'business', sessionId: selectedSession }, new AbortController().signal)
        .catch(() => { failed() })
    },
    context: (instanceId, selectedSession) => context(instanceId, selectedSession),
    preview(instanceId, visible) { rememberVisibility(`preview:${sessionId}:${instanceId}`, visible) },
    authorize: async (id) => {
      const error = await checkAccess(id)
      if (error) ctx.capabilityHub.notify(t(error))
      return !error
    },
    failed,
  })
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left',
    id: 'actvero-selected-workbench', locale: namespace, order: 30,
    inject: sessionId => ({ action: conversationAction(sessionId), hooks: { view: source } }),
  }, WorkbenchBadge))
  ctx.slots.inject('conversation.session.header.resident-utilities', () => ctx.slots.register({ name: 'conversation.session.header.resident-utilities',
    id: 'actvero-workbench-views', locale: namespace, order: -10, inject: sessionId => ({ action: conversationAction(sessionId), hooks: { view: source } }),
  }, WorkbenchUtilities))
  ctx.effect(() => ctx.commandUi.register({ name: 'workbench', section: 'add', label: () => t('title'),
    description: () => t('choose'), icon: WorkbenchIcon, available: () => true,
    ui: { kind: 'popupSelect', searchLabels: () => ({ placeholder: t('search'), empty: t('empty'), noResults: t('empty') }),
      options: async (_session, signal) => {
        const result = await ctx.remote.actveroWorkbench.list()
        signal.throwIfAborted()
        if (!result.ok) throw result.error
        return result.value.filter(item => item.aiEnabled && view.entries.some(entry => entry.id === item.id))
          .map(item => ({ id: item.id, label: item.name,
            icon: item.id === 'builtin:project-checklist' ? IconChecklistOutlineMedium : WorkbenchIcon,
            avatar: { src: workbenchIconUrl(view, item.id), fallback: item.name.slice(0, 1) },
          }))
      },
      onSelect: async (option, session) => {
        const error = await checkAccess(option.id)
        if (error) { ctx.capabilityHub.notify(t(error)); return }
        await runtime.select(option.id, session.sessionId)
      },
    },
  }))
}
