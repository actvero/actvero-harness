import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchDocument, WorkbenchInstanceId } from '../../types.ts'
import type { WorkbenchClientContext } from '../../contracts.ts'
import type { ActveroWorkbench, ActveroWorkbenchRegistry } from '../../contracts.ts'
import { createWorkbenchManagement, type WorkbenchManagement } from './management.ts'
import { Example } from './Example.tsx'
import { Manager } from './Manager.tsx'
import { OpenWorkbench, BusinessContent, WorkbenchChat, WorkbenchBadge, WorkbenchUtilities, type ConversationWorkbenchActions } from './RuntimeView.tsx'
import { WorkbenchClientRuntime } from './runtime.ts'
import { workbenchResource } from './resource.ts'
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
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
const selectionKey = 'actvero.workbenches.selected.v1'

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
  entries: readonly ActveroWorkbench[]
  opened: string | null
  remembered: readonly ActveroWorkbench[]
  instance: WorkbenchDocument | null
  preparing: boolean
  runtimeFailed: boolean
  chat: SessionReference | null
}

/** Human-triggered navigation and local installation. */
export interface WorkbenchAction extends Omit<ReturnType<typeof createWorkbenchManagement>, 'initial' | 'dispose'> {
  open(id: string): void
  back(): void
  context(instanceId: WorkbenchInstanceId | null): WorkbenchClientContext
  conversation(fresh: boolean): Promise<void>
  collapseChat(): void
  focusChat(): void
}

/** Register the Actvero workbench catalog, navigation and native business seat.
 * @param ctx Client plugin scope.
 */
export function registerWorkbenches(ctx: Context): void {
  const management = createWorkbenchManagement(ctx.remote.pluginManager, (state) => { update(state) })
  let view: WorkbenchView = { ...management.initial, entries: [], remembered: [], opened: readSelection(),
    instance: null, preparing: false, runtimeFailed: false, chat: null }
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
  let navigation = 0
  let chatGeneration = 0
  let linkedSession: SessionId | null = null
  const runtime = new WorkbenchClientRuntime(ctx)
  const failed = () => { ctx.capabilityHub.notify(ctx.locale.bind(namespace)('runtimeFailed')) }
  const collapseChat = () => { chatGeneration++; view.chat?.release(); update({ chat: null }) }
  const showChat = async (id: SessionId) => {
    collapseChat()
    const generation = chatGeneration
    const reference = ctx.sessions.retain(id, { source: 'actveroWorkbench' })
    try {
      await reference.ready
      if (generation !== chatGeneration || ctx.fiber.uid === null) { reference.release(); return }
      linkedSession = id
      update({ chat: reference })
    } catch (error) { reference.release(); throw error }
  }
  const context = (instanceId: WorkbenchInstanceId | null, sessionId: SessionId | null) => {
    const generation = chatGeneration
    return runtime.context(instanceId, sessionId, async (id) => {
      if (generation === chatGeneration && ctx.fiber.uid !== null) await showChat(id)
    })
  }
  const load = async (id: string, target?: WorkbenchInstanceId) => {
    const generation = ++navigation
    collapseChat()
    update({ opened: id, instance: null, preparing: true, runtimeFailed: false })
    try {
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
      return () => {
        stop()
        update({ entries: view.entries.filter(item => item !== entry) })
      }
    },
  }

  const { initial: _initial, dispose: _dispose, ...operations } = management
  const action: WorkbenchAction = {
    open(id) {
      if (id !== 'builtin:project-checklist' && !view.entries.some(entry => entry.id === id)) return
      linkedSession = null
      void load(id)
      try {
        localStorage.setItem(selectionKey, id)
      } catch (error) {
        console.warn('Unable to save workbench selection', error)
      }
      ctx.layout.selectPanel(businessPanel)
    },
    back() {
      collapseChat()
      ctx.layout.selectPanel(managerPanel)
    },
    context: instanceId => context(instanceId, linkedSession),
    collapseChat,
    focusChat() {
      const id = view.chat?.sessionId
      if (!id) return
      ctx.uiWorkspace.openSession(id)
      collapseChat()
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
    refresh()
    return () => { management.dispose(); for (const dispose of disposers) dispose() }
  })

  const inject = () => ({ hooks: { view: source }, action,
    resolveText: (text: Parameters<typeof ctx.locale.resolveText>[0]) => ctx.locale.resolveText(text),
  })
  ctx.effect(() => ctx.reflect.provide('actveroWorkbenches', registry))
  ctx.effect(() => ctx.resources.register(workbenchResource(ctx.remote.actveroWorkbench)))
  ctx.effect(() => () => { navigation++; collapseChat() })
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
  ctx.slots.inject('actvero.workbench.body', () => ctx.slots.register({
    name: 'actvero.workbench.body', key: 'builtin:project-checklist', locale: namespace,
  }, Example))
  const conversationAction = (sessionId: SessionId): ConversationWorkbenchActions => ({
    detach: async () => { const result = await ctx.remote.actveroWorkbench.detach({ sessionId }); if (!result.ok) throw result.error },
    open(id, instanceId, selectedSession) {
      linkedSession = selectedSession
      void load(id, instanceId)
      ctx.layout.selectPanel(businessPanel)
    },
    context: (instanceId, selectedSession) => context(instanceId, selectedSession),
    failed, icon: id => view.entries.find(entry => entry.id === id)?.iconUrl,
  })
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left',
    id: 'actvero-selected-workbench', locale: namespace, order: 30, inject: sessionId => ({ action: conversationAction(sessionId) }),
  }, WorkbenchBadge))
  ctx.slots.inject('conversation.session.header.resident-utilities', () => ctx.slots.register({ name: 'conversation.session.header.resident-utilities',
    id: 'actvero-workbench-views', locale: namespace, order: -10, inject: sessionId => ({ action: conversationAction(sessionId) }),
  }, WorkbenchUtilities))
  ctx.effect(() => ctx.commandUi.register({ name: 'workbench', section: 'add', label: () => t('title'),
    description: () => t('choose'), icon: WorkbenchIcon, available: () => true,
    ui: { kind: 'popupSelect', searchLabels: () => ({ placeholder: t('search'), empty: t('empty'), noResults: t('empty') }),
      options: async (_session, signal) => {
        const result = await ctx.remote.actveroWorkbench.list()
        signal.throwIfAborted()
        if (!result.ok) throw result.error
        return result.value.filter(item => item.id === 'builtin:project-checklist' || view.entries.some(entry => entry.id === item.id))
          .map(item => ({ id: item.id, label: item.name, icon: WorkbenchIcon }))
      },
      onSelect: async (option, session) => { await runtime.select(option.id, session.sessionId) },
    },
  }))
  if (view.opened) void load(view.opened)
}
