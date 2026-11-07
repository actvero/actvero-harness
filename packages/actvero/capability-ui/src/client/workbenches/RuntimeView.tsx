/** Full business view and conversation-owned floating workbench preview. */
import { useEffect, useState } from 'react'
import { Button, Tooltip, IconCloseOutlineMedium, IconFullscreenOutlineMedium, IconNewChatOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
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
  const { opened, instance, preparing, runtimeFailed, chat, entries } = useView(value => value)
  const [conversationPending, setConversationPending] = useState(false)
  const conversation = (fresh: boolean) => {
    if (conversationPending) return
    setConversationPending(true)
    void action.conversation(fresh).finally(() => { setConversationPending(false) })
  }
  useEffect(() => () => { action.collapseChat() }, [action])
  const name = opened === 'builtin:project-checklist' ? t('sampleName') : entries.find(item => item.id === opened)?.name ?? t('title')
  return <section className={styles.page} aria-label={name}>
    <header className={styles.toolbar}>
      <span className={styles.title}>{name}</span>
      {instance && <>
        <Button variant="ghost" disabled={conversationPending} onClick={() => { conversation(false) }}>{t('askAI')}</Button>
        <Tooltip label={t('newConversation')}><Button variant="ghost" disabled={conversationPending} aria-label={t('newConversation')}
          onClick={() => { conversation(true) }}><IconNewChatOutlineMedium /></Button></Tooltip>
      </>}
    </header>
    {runtimeFailed ? <div className={styles.notice} role="alert">{t('runtimeFailed')}
      <Button variant="ghost" onClick={() => { if (opened) action.open(opened) }}>{t('refresh')}</Button></div>
      : preparing ? <p className={styles.notice} role="status">{t('preparing')}</p>
        : opened && renderFactorySlot('actvero.workbench.content', { id: opened, workbench: action.context(instance?.instanceId ?? null) })}
    {chat && <aside className={styles.chatFloat} aria-label={t('workbenchConversation')}>
      <header className={styles.toolbar}><span className={styles.title}>{t('workbenchConversation')}</span>
        <Button variant="ghost" onClick={() => { action.focusChat() }}>{t('fullConversation')}</Button>
        <Tooltip label={t('collapse')}><Button variant="ghost" aria-label={t('collapse')} onClick={() => { action.collapseChat() }}><IconCloseOutlineMedium /></Button></Tooltip>
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
  context(instanceId: WorkbenchInstanceId, sessionId: SessionId): WorkbenchClientContext
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
      <IconCloseOutlineMedium className={styles.cross} />
    </button></Tooltip>
    <Tooltip label={selection.name}><button type="button" className={styles.badgeName}
      onClick={() => { action.open(selection.id, selection.instanceId, sessionId) }}>{selection.name}</button></Tooltip>
  </div>
}

/** Conversation utilities appear only while this thread has a workbench association. */
export function WorkbenchUtilities({ t, useProjection, sessionId, action, renderFactorySlot }:
  PropsRuntime<'conversation.session.header.resident-utilities'> & Locale & PropsRenderFactories
  & { action: ConversationWorkbenchActions }) {
  const selection = useProjection('actveroWorkbench')
  const [floating, setFloating] = useState(false)
  if (!selection) return null
  return <div className={styles.utilities}>
    <Tooltip label={t('floatWorkbench')}><Button variant="ghost" aria-label={t('floatWorkbench')} aria-pressed={floating}
      onClick={() => { setFloating(value => !value) }}><WorkbenchIcon /></Button></Tooltip>
    <Tooltip label={t('fullWorkbench')}>
      <Button variant="ghost" aria-label={t('fullWorkbench')}
        onClick={() => { setFloating(false); action.open(selection.id, selection.instanceId, sessionId) }}>
        <IconFullscreenOutlineMedium /></Button></Tooltip>
    {floating && <aside className={styles.workbenchFloat} aria-label={t('floatWorkbench')} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); setFloating(false) }
    }}>
      <header className={styles.toolbar}><span className={styles.title}>{selection.name}</span>
        <Tooltip label={t('fullWorkbench')}>
          <Button variant="ghost" aria-label={t('fullWorkbench')}
            onClick={() => { setFloating(false); action.open(selection.id, selection.instanceId, sessionId) }}>
            <IconFullscreenOutlineMedium /></Button></Tooltip>
        <Tooltip label={t('collapse')}><Button variant="ghost" aria-label={t('collapse')}
          onClick={() => { setFloating(false) }}><IconCloseOutlineMedium /></Button></Tooltip>
      </header>
      {renderFactorySlot('actvero.workbench.content', { id: selection.id, workbench: action.context(selection.instanceId, sessionId) })}
    </aside>}
  </div>
}
