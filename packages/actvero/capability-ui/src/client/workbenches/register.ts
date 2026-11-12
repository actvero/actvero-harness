import type { Context } from '@deepseek-ai/cordis'
import { workbenchArchiveSource, type AccountSnapshot, type PublishedWorkbench, type PublishedWorkbenchCatalog } from '@actvero/dsh-client-account/protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchDocument, WorkbenchInstanceId } from '../../types.ts'
import type { WorkbenchClientContext } from '../../contracts.ts'
import type { ActveroWorkbench, ActveroWorkbenchRegistry } from '../../contracts.ts'
import { createWorkbenchManagement, type WorkbenchManagement } from './management.ts'
import { Manager } from './Manager.tsx'
import { OpenWorkbench, BusinessContent, WorkbenchChat, WorkbenchBadge, WorkbenchUtilities, type ConversationWorkbenchActions } from './RuntimeView.tsx'
import { WorkbenchClientRuntime } from './runtime.ts'
import { workbenchResource } from './resource.ts'
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
import { publishedWorkbenchAction } from './platform.ts'
import { Navigation } from './Navigation.tsx'
import { en, zh } from './locales.ts'

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

function readSelection(): string | null {
  try {
    const selected = localStorage.getItem(selectionKey)
    return selected === 'builtin:project-checklist' ? null : selected
  } catch (error) {
    console.warn('Unable to restore workbench selection', error)
    return null
  }
}

/** Profile catalog and foreground view state consumed by the registered slots. */
export interface WorkbenchView extends WorkbenchManagement {
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
}

/** Human-triggered navigation and local installation. */
export interface WorkbenchAction extends Omit<ReturnType<typeof createWorkbenchManagement>, 'initial' | 'dispose' | 'installPublished' | 'report' | 'setEnabled'> {
  open(id: string): void
  refreshPlatform(): Promise<void>
  usePublished(release: PublishedWorkbench): Promise<void>
  setEnabled(name: string, enabled: boolean): Promise<void>
  back(): void
  context(instanceId: WorkbenchInstanceId | null): WorkbenchClientContext
  conversation(fresh: boolean): Promise<void>
  collapseChat(): void
  releaseChat(): void
  focusChat(): void
}

/** Register the Actvero workbench catalog, navigation and native business seat.
 * @param ctx Client plugin scope.
 */
export function registerWorkbenches(ctx: Context): void {
  const management = createWorkbenchManagement(ctx.remote.pluginManager, (state) => { update(state) })
  let view: WorkbenchView = { ...management.initial, entries: [], remembered: [], opened: readSelection(),
    platform: { phase: 'login' }, accessEpoch: 0, accessError: null,
    instance: null, preparing: false, runtimeFailed: false, chat: null, chatCollapsed: true }
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
  let linkedSession: SessionId | null = null
  const runtime = new WorkbenchClientRuntime(ctx)
  const failed = () => { ctx.capabilityHub.notify(ctx.locale.bind(namespace)('runtimeFailed')) }
  const collapseChat = () => { chatGeneration++; update({ chatCollapsed: true }) }
  const releaseChat = () => { chatGeneration++; view.chat?.release(); update({ chat: null, chatCollapsed: true }) }
  const showChat = async (id: SessionId) => {
    if (view.chat?.sessionId === id) { update({ chatCollapsed: false }); return }
    releaseChat()
    const generation = chatGeneration
    const reference = ctx.sessions.retain(id, { source: 'actveroWorkbench' })
    try {
      await reference.ready
      if (generation !== chatGeneration || ctx.fiber.uid === null) { reference.release(); return }
      linkedSession = id
      update({ chat: reference, chatCollapsed: false })
    } catch (error) { reference.release(); throw error }
  }
  const context = (instanceId: WorkbenchInstanceId | null, sessionId: SessionId | null, workbenchId = view.opened) => {
    const generation = chatGeneration
    const descriptor = view.entries.find(entry => entry.id === workbenchId)
    const scope = workbenchId ? workbenchArchiveSource(installed(workbenchId)?.source)?.scope : undefined
    return runtime.context(instanceId, sessionId, async (id) => {
      if (generation === chatGeneration && ctx.fiber.uid !== null) await showChat(id)
    }, descriptor && scope ? { ...descriptor, scope } : descriptor)
  }
  const load = async (id: string, target?: WorkbenchInstanceId) => {
    const generation = ++navigation
    releaseChat()
    update({ opened: id, instance: null, preparing: true, runtimeFailed: false, accessError: null })
    try {
      const accessError = await checkAccess(id)
      if (generation !== navigation || ctx.fiber.uid === null) return
      if (accessError) { update({ preparing: false, accessError }); return }
      const result = target ? await ctx.remote.actveroWorkbench.read({ instanceId: target }) : null
      if (result && !result.ok) throw result.error
      const instance = result?.ok ? result.value : await runtime.open(id)
      if (generation === navigation && ctx.fiber.uid !== null) update({ instance, preparing: false })
    } catch (error) {
      ctx.logger.warn('Unable to open workbench: %s', error)
      if (generation === navigation && ctx.fiber.uid !== null) update({ preparing: false, runtimeFailed: true })
    }
  }
  const registry: ActveroWorkbenchRegistry = {
    register(descriptor, component) {
      const { id, name, description, version } = descriptor
      if (!/^[a-z0-9@][a-z0-9@/._-]{0,213}$/.test(id) || !name.trim() || !description.trim() || !version.trim()) {
        throw new Error('Invalid Actvero workbench registration.')
      }
      if (view.entries.some(item => item.id === id)) throw new Error(`Duplicate Actvero workbench: ${id}`)
      const entry = { ...descriptor }
      const stop = ctx.slots.inject('actvero.workbench.body', () => ctx.slots.register({
        name: 'actvero.workbench.body', key: entry.id,
      }, component))
      update({ entries: [...view.entries, entry], remembered: [...view.remembered.filter(item => item.id !== entry.id), entry] })
      if (pendingOpen?.id === id && pendingOpen.version === version) {
        const intent = pendingOpen
        pendingOpen = undefined
        queueMicrotask(() => {
          if (!intent.signal.aborted && intent.epoch === view.accessEpoch && ctx.fiber.uid !== null) action.open(id)
        })
      }
      return () => {
        stop()
        update({ entries: view.entries.filter(item => item !== entry) })
      }
    },
  }

  const { initial: _initial, dispose: _dispose, installPublished, report, setEnabled, ...operations } = management
  const action: WorkbenchAction = {
    open(id) {
      if (!view.entries.some(entry => entry.id === id)) return
      linkedSession = null
      void load(id)
      try {
        localStorage.setItem(selectionKey, id)
      } catch (error) {
        console.warn('Unable to save workbench selection', error)
      }
      ctx.layout.selectPanel(businessPanel)
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
      releaseChat()
      ctx.layout.selectPanel(managerPanel)
    },
    context: instanceId => context(instanceId, linkedSession),
    collapseChat,
    releaseChat,
    focusChat() {
      const id = view.chat?.sessionId
      if (!id) return
      ctx.uiWorkspace.openSession(id)
      releaseChat()
      ctx.layout.selectPanel(null)
    },
    async conversation(fresh) {
      if (!view.instance) return
      const generation = chatGeneration
      try {
        if (fresh) {
          const result = await ctx.remote.actveroWorkbench.bind({ instanceId: view.instance.instanceId })
          if (!result.ok) throw result.error
          await ctx.sessions.refresh()
          if (generation === chatGeneration && ctx.fiber.uid !== null) await showChat(result.value.sessionId)
        } else await context(view.instance.instanceId, linkedSession).conversation()
      } catch (error) {
        ctx.logger.warn('Unable to open workbench conversation: %s', error)
        if (generation === chatGeneration && ctx.fiber.uid !== null) failed()
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
  ctx.effect(() => () => { navigation++; releaseChat() })
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }))
  const t = ctx.locale.bind(namespace)
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
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: businessPanel, locale: namespace, inject,
    children: { 'actvero.workbench.chat': { kind: 'single', scope: 'session' } },
  }, OpenWorkbench))
  ctx.slots.inject('actvero.workbench.chat', () => ctx.slots.register({ name: 'actvero.workbench.chat' }, WorkbenchChat))
  const conversationAction = (sessionId: SessionId): ConversationWorkbenchActions => ({
    detach: async () => { const result = await ctx.remote.actveroWorkbench.detach({ sessionId }); if (!result.ok) throw result.error },
    open(id, instanceId, selectedSession) {
      linkedSession = selectedSession
      void load(id, instanceId)
      ctx.layout.selectPanel(businessPanel)
    },
    context: (id, instanceId, selectedSession) => context(instanceId, selectedSession, id),
    authorize: async (id) => {
      const error = await checkAccess(id)
      if (error) ctx.capabilityHub.notify(t(error))
      return !error
    },
    failed, icon: id => view.entries.find(entry => entry.id === id)?.iconUrl,
  })
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left',
    id: 'actvero-selected-workbench', locale: namespace, order: 30, inject: sessionId => ({ action: conversationAction(sessionId) }),
  }, WorkbenchBadge))
  ctx.slots.inject('conversation.session.header.resident-utilities', () => ctx.slots.register({ name: 'conversation.session.header.resident-utilities',
    id: 'actvero-workbench-views', locale: namespace, order: -10, inject: sessionId => ({ action: conversationAction(sessionId), hooks: { view: source } }),
  }, WorkbenchUtilities))
  ctx.effect(() => ctx.commandUi.register({ name: 'workbench', section: 'add', label: () => t('title'),
    description: () => t('choose'), icon: WorkbenchIcon, available: () => view.entries.length > 0,
    ui: { kind: 'popupSelect', searchLabels: () => ({ placeholder: t('search'), empty: t('empty'), noResults: t('empty') }),
      options: async (_session, signal) => {
        const result = await ctx.remote.actveroWorkbench.list()
        signal.throwIfAborted()
        if (!result.ok) throw result.error
        return result.value.filter(item => view.entries.some(entry => entry.id === item.id))
          .map(item => ({ id: item.id, label: item.name, icon: WorkbenchIcon }))
      },
      onSelect: async (option, session) => {
        const error = await checkAccess(option.id)
        if (error) { ctx.capabilityHub.notify(t(error)); return }
        await runtime.select(option.id, session.sessionId)
      },
    },
  }))
}
