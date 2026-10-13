import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { HeroHeading, WorkingLabel } from './ConversationCopy.tsx'
import type { AccountSnapshot } from '../protocol.ts'
import { AccountMenu, AccountSection, BrandMark, BrandName, type Operations } from './Account.tsx'
import { en, zh, type CopyKey } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'actvero.account': CopyKey
  }
}
export const inject = ['slots', 'locale']
/** Registers the native account in official settings and brand slots. */
export function apply(ctx: Context): void {
  const bridge = window.actveroAccount
  if (!bridge) return
  ctx.effect(() => ctx.locale.register('actvero.account', { en, zh }), 'actvero: account dictionaries')
  const t = ctx.locale.bind('actvero.account')
  let snapshot: AccountSnapshot | null = null,
    revision = 0,
    disposed = false
  const listeners = new Set<() => void>()
  const publish = (value: AccountSnapshot | null) => {
    snapshot = value
    for (const listener of listeners) listener()
  }
  ctx.effect(() => {
    const stop = bridge.subscribe((value) => {
      revision++
      publish(value)
    })
    const initial = revision
    void bridge.snapshot().then((value) => {
      if (!disposed && revision === initial) publish(value)
    })
    return () => {
      disposed = true
      stop()
      listeners.clear()
    }
  }, 'actvero: native account state')
  const operations: Operations = {
    bridge,
    hooks: {
      account: {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      },
    },
  }
  ctx.slots.inject('conversation.hero.heading', () =>
    ctx.slots.register({ name: 'conversation.hero.heading', locale: 'actvero.account' }, HeroHeading),
  )
  ctx.slots.inject('conversation.chat.running.label', () =>
    ctx.slots.register({ name: 'conversation.chat.running.label', locale: 'actvero.account' }, WorkingLabel),
  )
  ctx.slots.inject('settings.launcher', () =>
    ctx.slots.register({ name: 'settings.launcher', locale: 'actvero.account', inject: () => operations }, AccountMenu),
  )
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'account',
        order: -20,
        label: () => t('nav'),
        locale: 'actvero.account',
        inject: () => operations,
      },
      AccountSection,
    ),
  )
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.register({ name: 'sidebar.brand.mark', locale: 'actvero.account', inject: () => operations }, BrandMark),
  )
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name', locale: 'actvero.account', inject: () => operations }, BrandName),
  )
}
