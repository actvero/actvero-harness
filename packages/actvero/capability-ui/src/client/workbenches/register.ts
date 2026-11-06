import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ActveroWorkbench, ActveroWorkbenchRegistry } from '../../contracts.ts'
import { createWorkbenchManagement, type WorkbenchManagement } from './management.ts'
import { Example } from './Example.tsx'
import { Manager, OpenWorkbench } from './Manager.tsx'
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
import { Navigation } from './Navigation.tsx'
import { en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'actvero.workbenches': keyof typeof zh
  }
  interface SlotMap {
    /** The root business panel keyed by the provider's workbench identifier. */
    'actvero.workbench.body': { kind: 'keyed'; scope: 'root'; entryKey: string }
  }
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
}

/** Human-triggered navigation and local installation. */
export interface WorkbenchAction extends Omit<ReturnType<typeof createWorkbenchManagement>, 'initial' | 'dispose'> {
  open(id: string): void
  back(): void
}

/** Register the Actvero workbench catalog, navigation and native business seat.
 * @param ctx Client plugin scope.
 */
export function registerWorkbenches(ctx: Context): void {
  const management = createWorkbenchManagement(ctx.remote.pluginManager, (state) => { update(state) })
  let view: WorkbenchView = { ...management.initial, entries: [], remembered: [], opened: readSelection() }
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
      update({ opened: id })
      try {
        localStorage.setItem(selectionKey, id)
      } catch (error) {
        console.warn('Unable to save workbench selection', error)
      }
      ctx.layout.selectPanel(businessPanel)
    },
    back() {
      ctx.layout.selectPanel(managerPanel)
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
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: businessPanel, locale: namespace, inject,
    children: { 'actvero.workbench.body': { kind: 'keyed', scope: 'root' } },
  }, OpenWorkbench))
  ctx.slots.inject('actvero.workbench.body', () => ctx.slots.register({
    name: 'actvero.workbench.body', key: 'builtin:project-checklist', locale: namespace,
  }, Example))
}
