/** Full business view and conversation-owned floating workbench preview. */
import { useEffect, useRef, useState } from 'react'
import { Button, Tooltip, IconCloseOutlineRegular, IconFullscreenOutlineRegular, IconNewChatOutlineRegular,
  IconChevronDownOutlineRegular, IconSparkleRegular, IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryComponentPropsOf, PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchClientContext } from '../../contracts.ts'
import type { WorkbenchInstanceId } from '../../types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchAction } from './register.ts'
import type { WorkbenchViewHooks } from './Navigation.tsx'
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
import styles from './runtime.module.css'

type Locale = PropsLocale<'actvero.workbenches'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    /** One business panel, independent of the conversation display mode. */
    'actvero.workbench.content': { scope: 'root'
      props: { id: string; workbench: WorkbenchClientContext }
      locale: 'actvero.workbenches'
      children: { 'actvero.workbench.body': { kind: 'keyed'; scope: 'root' } } }
  }
  interface SlotMap {
    /** Floating native conversation retained by the full business view. */
    'actvero.workbench.chat': { kind: 'single'; scope: 'session' }
  }
}

/** Render the same provider component at either presentation size. */
export function BusinessContent({ id, workbench, renderSlot, t }: FactoryComponentPropsOf<'actvero.workbench.content'>) {
  return <div className={styles.content}>{renderSlot('actvero.workbench.body', { workbench }, {
    entryKey: id, fallback: <p role="status">{t('unavailable')}</p>,
  })}</div>
}

/** Full business page with an optional floating native conversation. */
export function OpenWorkbench({ t, useView, renderFactorySlot, renderSlot, SessionProvider, action }:
  Locale & WorkbenchViewHooks & PropsRenderFactories & PropsRenderSlots<'actvero.workbench.chat'> & { action: WorkbenchAction }) {
  const { opened, instance, preparing, runtimeFailed, accessError, chat, chatCollapsed, entries } = useView(value => value)
  const [conversationPending, setConversationPending] = useState(false)
  const launcher = useRef<HTMLButtonElement>(null)
  const conversation = (fresh: boolean) => {
    if (conversationPending) return
    setConversationPending(true)
    void action.conversation(fresh).finally(() => { setConversationPending(false) })
  }
  const collapse = () => { action.collapseChat(); requestAnimationFrame(() => { launcher.current?.focus() }) }
  useEffect(() => () => { action.releaseChat() }, [action])
  const name = entries.find(item => item.id === opened)?.name ?? t('title')
  return <section className={styles.page} aria-label={name}>
    <header className={styles.pageHeader} data-window-drag>
      <Tooltip label={t('back')}><Button size="sm" className={styles.iconButton} aria-label={t('back')}
        onClick={() => { action.back() }}><WorkbenchIcon /></Button></Tooltip>
      <span className={styles.separator} aria-hidden="true" />
      <Tooltip label={name}><h1 className={styles.pageTitle}>{name}</h1></Tooltip>
    </header>
    {runtimeFailed || accessError ? <div className={styles.notice} role="alert">{t(accessError ?? 'runtimeFailed')}
      <Button variant="ghost" onClick={() => { if (opened) action.open(opened) }}>{t('refresh')}</Button></div>
      : preparing ? <p className={styles.notice} role="status">{t('preparing')}</p>
        : opened && renderFactorySlot('actvero.workbench.content', { id: opened, workbench: action.context(instance?.instanceId ?? null) })}
    {instance && <Tooltip label={t('askAI')} side="left"><button ref={launcher} type="button" className={styles.aiLauncher}
      hidden={Boolean(chat && !chatCollapsed)} aria-label={t('askAI')} aria-expanded={Boolean(chat && !chatCollapsed)} disabled={conversationPending}
      onClick={() => { if (chat && !chatCollapsed) collapse(); else conversation(false) }}>
      {conversationPending ? <IconLoadingOutlineRegular className={styles.spinner} size={22} /> : <IconSparkleRegular size={22} />}
    </button></Tooltip>}
    {chat && <aside className={styles.chatFloat} hidden={chatCollapsed} aria-label={t('workbenchConversation')}
      onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); collapse() } }}>
      <header className={styles.toolbar}><IconSparkleRegular /><span className={styles.title}>{t('workbenchConversation')}</span>
        <div className={styles.actions}>
          <Tooltip label={t('newConversation')}><Button size="sm" className={styles.iconButton} disabled={conversationPending}
            aria-label={t('newConversation')} onClick={() => { conversation(true) }}><IconNewChatOutlineRegular /></Button></Tooltip>
          <Tooltip label={t('fullConversation')}><Button size="sm" className={styles.iconButton} aria-label={t('fullConversation')}
            onClick={() => { action.focusChat() }}><IconFullscreenOutlineRegular /></Button></Tooltip>
          <Tooltip label={t('collapse')}><Button size="sm" className={styles.iconButton} aria-label={t('collapse')}
            onClick={collapse}><IconChevronDownOutlineRegular /></Button></Tooltip>
        </div>
      </header>
      <SessionProvider session={chat}>{renderSlot('actvero.workbench.chat', {})}</SessionProvider>
    </aside>}
  </section>
}

/** Native composer and transcript keep the same Session when the window is collapsed. */
export function WorkbenchChat({ useSession, renderFactorySlot }: PropsRuntime<'actvero.workbench.chat'> & PropsRenderFactories) {
  const session = useSession(value => value)
  const hero = session.blank && !session.promptAttempted
  return <div className={styles.chatBody}>{renderFactorySlot('conversation.content', {
    variant: 'embedded', phase: session.openState !== 'open' ? 'settling' : hero ? 'hero' : 'active', hero,
  })}</div>
}

/** Callback face shared by the badge and header; all operations stay Session-bound. */
export interface ConversationWorkbenchActions {
  detach(): Promise<void>
  open(id: string, instanceId: WorkbenchInstanceId, sessionId: SessionId): void
  context(id: string, instanceId: WorkbenchInstanceId, sessionId: SessionId): WorkbenchClientContext
  authorize(id: string): Promise<boolean>
  failed(): void
  icon(id: string): string | undefined
}

/** Selected workbench badge; hover exposes removal without changing the active expert. */
export function WorkbenchBadge({ t, useProjection, sessionId, action }: PropsRuntime<'conversation.input.left'> & Locale
  & { action: ConversationWorkbenchActions }) {
  const selection = useProjection('actveroWorkbench')
  const [pending, setPending] = useState(false)
  if (!selection) return null
  const icon = action.icon(selection.id)
  return <div className={styles.badge}>
    <Tooltip label={t('detachWorkbench')}><button type="button" className={styles.remove} disabled={pending} aria-label={t('detachWorkbench')}
      onClick={() => { setPending(true); void action.detach().catch(() => { action.failed() }).finally(() => { setPending(false) }) }}>
      <span className={styles.mark}>{icon ? <img src={icon} alt="" /> : <WorkbenchIcon />}</span>
      <IconCloseOutlineRegular className={styles.cross} />
    </button></Tooltip>
    <Tooltip label={selection.name}><button type="button" className={styles.badgeName}
      onClick={() => { action.open(selection.id, selection.instanceId, sessionId) }}>{selection.name}</button></Tooltip>
  </div>
}

/** Conversation utilities appear only while this thread has a workbench association. */
export function WorkbenchUtilities({ t, useProjection, sessionId, action, renderFactorySlot, useView }:
  PropsRuntime<'conversation.session.header.resident-utilities'> & Locale & PropsRenderFactories
  & WorkbenchViewHooks & { action: ConversationWorkbenchActions }) {
  const selection = useProjection('actveroWorkbench')
  const epoch = useView(value => value.accessEpoch)
  const [opened, setOpened] = useState<{ id: string; epoch: number }>()
  const [checking, setChecking] = useState(false)
  const floating = opened?.id === selection?.id && opened?.epoch === epoch
  const close = () => { setOpened(undefined) }
  if (!selection) return null
  return <div className={styles.utilities}>
    <Tooltip label={t('floatWorkbench')}><Button size="sm" className={styles.iconButton} aria-label={t('floatWorkbench')} aria-pressed={floating}
      disabled={checking} onClick={() => {
        if (floating) { close(); return }
        setChecking(true)
        void action.authorize(selection.id).then((allowed) => {
          if (allowed) setOpened({ id: selection.id, epoch })
        }).finally(() => { setChecking(false) })
      }}><WorkbenchIcon /></Button></Tooltip>
    <Tooltip label={t('fullWorkbench')}>
      <Button size="sm" className={styles.iconButton} aria-label={t('fullWorkbench')}
        onClick={() => { close(); action.open(selection.id, selection.instanceId, sessionId) }}>
        <IconFullscreenOutlineRegular /></Button></Tooltip>
    {floating && <aside className={styles.workbenchFloat} aria-label={t('floatWorkbench')} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close() }
    }}>
      <header className={styles.toolbar}><WorkbenchIcon /><span className={styles.title}>{selection.name}</span>
        <div className={styles.actions}>
          <Tooltip label={t('fullWorkbench')}>
            <Button size="sm" className={styles.iconButton} aria-label={t('fullWorkbench')}
              onClick={() => { close(); action.open(selection.id, selection.instanceId, sessionId) }}>
              <IconFullscreenOutlineRegular /></Button></Tooltip>
          <Tooltip label={t('collapse')}><Button size="sm" className={styles.iconButton} aria-label={t('collapse')}
            onClick={() => { close() }}><IconCloseOutlineRegular /></Button></Tooltip>
        </div>
      </header>
      {renderFactorySlot('actvero.workbench.content', { id: selection.id, workbench: action.context(selection.id, selection.instanceId, sessionId) })}
    </aside>}
  </div>
}
