/** Local workbench client composition; retains the native Conversation through its public Frame Factory. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SlotComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchId } from '../contracts.ts'
import type { WorkbenchBusinessProps } from './contract.ts'
import { CREATIVE_ID, LIBRARY_ID } from '../examples.ts'
import { IconBrowseOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { createElement } from 'react'
import { WorkbenchClient, PANEL } from './controller.ts'
import { WorkbenchHome, WorkbenchNav, WorkbenchFrame, NativeWorkbenchConversation, CreativeBusiness, LibraryBusiness } from './Workbench.tsx'
import { zh, en } from './locales.ts'
import './contract.ts'
export type { WorkbenchBusinessProps } from './contract.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopWorkbenches: {
      state: {
        active: string | null
      }
      subscribe(listener: () => void): () => void
      leave(): Promise<void>
    }
  }
}
/** Required native services; missing services prevent plugin activation. */
export const inject = ['desktopWorkbenches', 'slots', 'locale', 'layout', 'sessions', 'uiWorkspace', 'remote', 'remote.pluginManager', 'pluginNavigation']
/** Compose the workbench plugin through native services and disposable registrations.
 * @param ctx - Cordis registration owner. */
export function apply(ctx: Context): void {
  const controller = new WorkbenchClient(ctx)
  const state = { getSnapshot: controller.getSnapshot, subscribe: controller.subscribe }
  const injected = () => ({ controller, hooks: { workbench: state } })
  ctx.effect(() => ctx.locale.register('actvero.workbenches', { zh, en }))
  const register = (id: WorkbenchId, component: SlotComponent<WorkbenchBusinessProps>) => ctx.slots.inject('actvero.workbench.business', () => ctx.slots.register({ name: 'actvero.workbench.business', key: id, locale: 'actvero.workbenches' }, component))
  ctx.effect(() => ctx.reflect.provide('actveroWorkbenches', { register, open: (id: WorkbenchId) => controller.open(id) }))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: 'actvero.workbenches', inject: injected }, WorkbenchHome))
  const t = ctx.locale.bind('actvero.workbenches')
  ctx.slots.inject('sidebar.quickSwitcher', () => {
    let panelDispose: (() => void) | undefined
    let dispose: (() => void) | undefined
    const update = () => {
      if (ctx.desktopWorkbenches.state.active || ctx.layout.panelInfo.getSnapshot().activePanelId === 'desktop-workbenches') {
        dispose?.()
        dispose = undefined
        panelDispose ??= ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL, order: -1, label: () => t('local'),
        }, LocalWorkbenchIcon))
      }
      else {
        panelDispose?.()
        panelDispose = undefined
        dispose ??= ctx.slots.register({ name: 'sidebar.quickSwitcher', priority: -100, locale: 'actvero.workbenches', inject: injected }, WorkbenchNav)
      }
    }
    update()
    const unsubscribe = ctx.desktopWorkbenches.subscribe(update)
    const unsubscribeLayout = ctx.layout.panelInfo.subscribe(update)
    return () => { unsubscribe(); unsubscribeLayout(); dispose?.(); panelDispose?.() }
  })
  ctx.effect(() => ctx.layout.panelInfo.subscribe(() => {
    if (ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL && ctx.desktopWorkbenches.state.active)
      void ctx.desktopWorkbenches.leave()
  }))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'actvero-local-workbench', locale: 'actvero.workbenches', inject: injected, children: { 'actvero.workbench.business': { kind: 'keyed', scope: 'root' }, 'actvero.workbench.conversation': { kind: 'single', scope: 'session' } } }, WorkbenchFrame))
  ctx.slots.inject('actvero.workbench.conversation', () => ctx.slots.register({ name: 'actvero.workbench.conversation' }, NativeWorkbenchConversation))
  ctx.effect(() => register(CREATIVE_ID, CreativeBusiness))
  ctx.effect(() => register(LIBRARY_ID, LibraryBusiness))
  ctx.effect(() => ctx.uiWorkspace.registerSessionStarter(() => {
    if (!controller.getSnapshot().active) return false
    void controller.newConversation()
    return true
  }))
  ctx.effect(() => { void controller.start(); return () => { controller.dispose() } })
}
function LocalWorkbenchIcon() { return createElement(IconBrowseOutlineMedium) }
