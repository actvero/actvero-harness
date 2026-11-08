/** Full business view and conversation-owned floating workbench preview. */
import { useEffect, useRef, useState } from 'react'
import { Button, Menu, Tooltip, IconCloseOutlineRegular, IconFullscreenOutlineRegular, IconNewChatOutlineRegular,
  IconChevronDownOutlineRegular, IconSparkleRegular, IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryComponentPropsOf, PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchClientContext } from '../../contracts.ts'
import type { WorkbenchInstanceId } from '../../types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@actvero/dsh-client-account/client'
import type { WorkbenchAction } from './register.ts'
import type { WorkbenchViewHooks } from './Navigation.tsx'
import { WorkbenchArtwork, WorkbenchIcon } from './WorkbenchIcon.tsx'
import { workbenchIconUrl } from './catalog.ts'
import { FloatingPreview } from './FloatingPreview.tsx'
import styles from './runtime.module.css'

type Locale = PropsLocale<'actvero.workbenches'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    /** One business panel, independent of the conversation display mode. */
    'actvero.workbench.content': { scope: 'root'
      props: { id: string; workbench: WorkbenchClientContext; preview?: boolean }
      locale: 'actvero.workbenches'
      children: { 'actvero.workbench.body': { kind: 'keyed'; scope: 'root' } } }
  }
  interface SlotMap {
    /** Floating native conversation retained by the full business view. */
    'actvero.workbench.chat': { kind: 'single'; scope: 'session' }
  }
}

/** Render the same provider component at either presentation size. */
export function BusinessContent({ id, workbench, preview, renderSlot, t }: FactoryComponentPropsOf<'actvero.workbench.content'>) {
  return <div className={`${styles.content} ${preview ? styles.previewContent : ''}`}>{renderSlot('actvero.workbench.body', { workbench }, {
    entryKey: id, fallback: <p role="status">{t('unavailable')}</p>,
  })}</div>
}

/** Full business page with an optional floating native conversation. */
export function OpenWorkbench({ t, useView, useSessions, renderFactorySlot, renderSlot, SessionProvider, action }:
  Locale & WorkbenchViewHooks & Pick<PropsRuntime<'main'>, 'useSessions'> & PropsRenderFactories
  & PropsRenderSlots<'actvero.workbench.chat'> & { action: WorkbenchAction }) {
  const { opened, instance, preparing, runtimeFailed, chat, chatCollapsed, chatPreparing, entries } = useView(value => value)
  const icon = useView(value => opened ? workbenchIconUrl(value, opened) : undefined)
  const sessions = useSessions(value => value)
  const [menuOpen, setMenuOpen] = useState(false)
  const linked = sessions.ids.map(id => sessions.byId[id]).filter(summary =>
    instance !== null && summary.projectionValues?.actveroWorkbench?.instanceId === instance.instanceId)
  const chatTitle = (chat && sessions.byId[chat.sessionId]?.title) || t('newConversation')
  const launcher = useRef<HTMLButtonElement>(null)
  const conversation = (fresh: boolean) => {
    void action.conversation(fresh)
  }
  const collapse = () => { setMenuOpen(false); action.collapseChat(); requestAnimationFrame(() => { launcher.current?.focus() }) }
  useEffect(() => () => { action.releaseChat() }, [action])
  const name = opened === 'builtin:project-checklist' ? t('sampleName') : entries.find(item => item.id === opened)?.name ?? t('title')
  return <section className={styles.page} aria-label={name}
    data-workbench-main={!preparing && !runtimeFailed ? opened : undefined} data-workbench-instance={instance?.instanceId}
    data-workbench-session={chat?.sessionId}>
    <header className={styles.pageHeader} data-window-drag>
      <Tooltip label={t('back')}><Button size="sm" className={styles.iconButton} aria-label={t('back')}
        onClick={() => { action.back() }}><WorkbenchIcon /></Button></Tooltip>
      <span className={styles.separator} aria-hidden="true" />
      {opened && <WorkbenchArtwork id={opened} url={icon} size={18} />}
      <Tooltip label={name}><h1 className={styles.pageTitle}>{name}</h1></Tooltip>
    </header>
    {runtimeFailed ? <div className={styles.notice} role="alert">{t('runtimeFailed')}
      <Button variant="ghost" onClick={() => { if (opened) action.open(opened) }}>{t('refresh')}</Button></div>
      : preparing ? <p className={styles.notice} role="status">{t('preparing')}</p>
        : opened && renderFactorySlot('actvero.workbench.content', { id: opened, workbench: action.context(instance?.instanceId ?? null) })}
    {instance && action.supportsAI(instance.instanceId) && <Tooltip label={t('askAI')} side="top"><button ref={launcher} type="button" className={styles.aiLauncher}
      hidden={Boolean(chat && !chatCollapsed)} aria-label={t('askAI')} aria-expanded={Boolean(chat && !chatCollapsed)} disabled={chatPreparing}
      onClick={() => { if (chat && !chatCollapsed) collapse(); else conversation(false) }}>
      {chatPreparing ? <IconLoadingOutlineRegular className={styles.spinner} size={22} />
        : renderFactorySlot('actvero.brand.mark', {}, { fallback: <IconSparkleRegular size={22} /> })}
    </button></Tooltip>}
    {chat && instance && <FloatingPreview key={instance.instanceId} instanceId={instance.instanceId} mode="chat" hidden={chatCollapsed} t={t} collapse={collapse} enter={() => { action.focusChat() }}>
      <header className={styles.toolbar} data-workbench-drag="">
        <Menu open={menuOpen && !chatCollapsed} onClose={() => { setMenuOpen(false) }} portal autoFocus minWidthFromAnchor
          className={styles.titleMenu} listClassName={styles.conversationMenu} selectedId={chat.sessionId}
          anchor={<Button size="sm" className={styles.titleTrigger} disabled={chatPreparing}
            aria-label={`${t('switchConversation')} · ${chatTitle}`} aria-haspopup="menu" aria-expanded={menuOpen}
            onClick={() => { setMenuOpen(value => !value) }}>
            <span className={styles.title}>{chatTitle}</span><IconChevronDownOutlineRegular size={14} />
          </Button>}
          items={linked.map(summary => ({ id: summary.id,
            label: <span className={styles.conversationName}>{summary.title || t('newConversation')}</span>,
          }))}
          onSelect={(id) => {
            setMenuOpen(false)
            const selected = linked.find(summary => summary.id === id)
            if (selected) void action.switchConversation(selected.id)
          }} />
        <div className={styles.actions}>
          <Tooltip label={t('newConversation')}><Button size="sm" className={styles.iconButton} disabled={chatPreparing}
            aria-label={t('newConversation')} onClick={() => { conversation(true) }}><IconNewChatOutlineRegular /></Button></Tooltip>
          <Tooltip label={t('fullConversation')}><Button size="sm" className={styles.iconButton} aria-label={t('fullConversation')}
            onClick={() => { action.focusChat() }}><IconFullscreenOutlineRegular /></Button></Tooltip>
          <Tooltip label={t('collapse')}><Button size="sm" className={styles.iconButton} aria-label={t('collapse')}
            onClick={collapse}><IconChevronDownOutlineRegular /></Button></Tooltip>
        </div>
      </header>
      <SessionProvider session={chat}>{renderSlot('actvero.workbench.chat', {})}</SessionProvider>
    </FloatingPreview>}
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
  preview(instanceId: WorkbenchInstanceId, visible: boolean): void
}

/** Selected workbench badge follows the composer expert badge's compact and removal behavior. */
export function WorkbenchBadge({ t, useProjection, useView, sessionId, action }: PropsRuntime<'conversation.input.left'> & Locale & WorkbenchViewHooks
  & { action: ConversationWorkbenchActions }) {
  const selection = useProjection('actveroWorkbench')
  const [pending, setPending] = useState(false)
  const icon = useView(value => selection ? workbenchIconUrl(value, selection.id) : undefined)
  if (!selection) return null
  const mark = <WorkbenchArtwork id={selection.id} url={icon} />
  return <span className={styles.badge} data-workbench-badge="">
    <Tooltip label={t('detachWorkbench')} disabled={pending}><button type="button" className={styles.badgeRemove}
      disabled={pending} aria-label={t('detachWorkbench')}
      onClick={() => { setPending(true); void action.detach().catch(() => { action.failed() }).finally(() => { setPending(false) }) }}>
      <span className={styles.mark} aria-hidden="true">{mark}</span>
      <span className={styles.cross} aria-hidden="true"><IconCloseOutlineRegular /></span>
    </button></Tooltip>
    <Tooltip label={selection.name} disabled={pending}><button type="button" className={styles.badgeTrigger} disabled={pending}
      aria-label={selection.name} onClick={() => { action.open(selection.id, selection.instanceId, sessionId) }}>
      <span className={styles.compactMark} aria-hidden="true">{mark}</span>
      <span className={styles.badgeName}>{selection.name}</span>
    </button></Tooltip>
  </span>
}

/** Conversation utilities appear only while this thread has a workbench association. */
export function WorkbenchUtilities({ t, useProjection, useView, sessionId, action, renderFactorySlot }:
  PropsRuntime<'conversation.session.header.resident-utilities'> & Locale & PropsRenderFactories & WorkbenchViewHooks
  & { action: ConversationWorkbenchActions }) {
  const selection = useProjection('actveroWorkbench')
  const floating = useView(value => !selection || value.visibility[`preview:${sessionId}:${selection.instanceId}`] !== false)
  const icon = useView(value => selection ? workbenchIconUrl(value, selection.id) : undefined)
  const trigger = useRef<HTMLButtonElement>(null)
  if (!selection) return null
  const collapse = () => { action.preview(selection.instanceId, false); trigger.current?.focus() }
  return <div className={styles.utilities} data-workbench-conversation={selection.id}
    data-workbench-instance={selection.instanceId} data-workbench-session={sessionId}>
    <Tooltip label={t('floatWorkbench')} side="bottom"><Button ref={trigger} size="sm" className={styles.iconButton} aria-label={t('floatWorkbench')} aria-pressed={floating}
      onClick={() => { action.preview(selection.instanceId, !floating) }}>
      <WorkbenchArtwork id={selection.id} url={icon} /></Button></Tooltip>
    <Tooltip label={t('fullWorkbench')} side="bottom">
      <Button size="sm" className={styles.iconButton} aria-label={t('fullWorkbench')}
        onClick={() => { action.open(selection.id, selection.instanceId, sessionId) }}>
        <IconFullscreenOutlineRegular /></Button></Tooltip>
    {floating && <FloatingPreview key={selection.instanceId} instanceId={selection.instanceId} t={t} collapse={collapse}
      enter={() => { action.open(selection.id, selection.instanceId, sessionId) }}>
      {renderFactorySlot('actvero.workbench.content', { id: selection.id, workbench: action.context(selection.instanceId, sessionId), preview: true })}
    </FloatingPreview>}
  </div>
}
