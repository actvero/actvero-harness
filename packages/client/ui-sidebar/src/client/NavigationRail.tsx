import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconNewChatOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import { WindowNavigationControls } from './HeaderLeadingControls.tsx'
import { PanelRow } from './PanelRow.tsx'
import css from './NavigationRail.module.css'

/** Fixed module launchers and the conversation browser shared by Home and its hover preview.
 * @param props Frame presentation, registered sidebar slots and navigation actions.
 * @returns The permanent rail and its single conversation pane.
 */
export function NavigationRail({ pane, usePanels, usePanelInfo, useShortcuts, selectPanel, toggleSidebar,
  startSession, trackEntryClick, renderSlot, windowControlsHost, t }: SidebarRootComponentProps & {
    pane: NonNullable<SidebarRootComponentProps['navigationPane']>
  }) {
  const panels = usePanels(value => value)
  const panel = usePanelInfo(info => info.activePanelId)
  const shortcut = useShortcuts(rows => rows.find(row => row.id === 'session.new'))
  const [preview, setPreview] = useState<'hover' | 'button' | null>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const home = useRef<HTMLButtonElement>(null)
  const browser = useRef<HTMLElement>(null)
  const timer = useRef<number>()
  const floating = pane === 'overlay' || (preview !== null && pane === 'closed')
  const visible = pane !== 'closed' || preview !== null
  const cancel = () => window.clearTimeout(timer.current)
  const close = () => { cancel(); setPreview(null) }
  useEffect(() => {
    cancel()
    setPreview(null)
    return cancel
  }, [panel, pane])
  useEffect(() => {
    if (!floating) return
    const dismiss = () => {
      close()
      if (pane === 'overlay') toggleSidebar()
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node
        && !browser.current?.contains(event.target) && !home.current?.contains(event.target) && !toolbar.current?.contains(event.target)
        && !event.composedPath().some(target => target instanceof Element && target.matches('[role="menu"],[role="dialog"]'))) dismiss()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="menu"],[role="dialog"]')) return
      dismiss()
      if (preview === 'button') toolbar.current?.querySelector('button')?.focus()
      else home.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [floating, pane, preview, toggleSidebar])
  const leave = () => {
    cancel()
    if (preview !== 'hover') return
    timer.current = window.setTimeout(() => {
      if (!browser.current?.contains(document.activeElement) && !document.querySelector('[role="menu"],[role="dialog"]')) setPreview(null)
    }, 180)
  }
  const toggle = () => {
    cancel()
    if (panel !== null) { setPreview(visible ? null : 'button'); return }
    close()
    toggleSidebar()
  }
  const expanded = panel === null ? pane !== 'closed' : visible
  const newSession = () => {
    close()
    if (pane === 'overlay') toggleSidebar()
    trackEntryClick({ menu_name: 'new_session', position: 'sidebar' })
    startSession()
  }
  const controls = <div ref={toolbar} data-navigation-toolbar>
    <WindowNavigationControls renderHistorySlot={renderSlot} toggleSidebar={toggle} startSession={startSession}
      trackEntryClick={trackEntryClick} t={t} useShortcuts={useShortcuts} controls="sidebar-conversations" expanded={expanded}
      toggleShortcut={panel === null}
      showNewSession={Boolean(windowControlsHost) && panel === null && !visible} />
  </div>
  return <div className={css.shell} data-navigation-shell={pane}>
    <div className={css.chrome} data-window-drag>
      {windowControlsHost === undefined ? controls : windowControlsHost && createPortal(controls, windowControlsHost)}
    </div>
    <div className={css.rail} data-navigation-column>
      <nav className={css.entries} aria-label={t('panels.label')}>
        <button ref={home} className={css.icon} type="button" aria-label={t('home')}
          aria-current={panel === null ? 'page' : undefined} aria-controls="sidebar-conversations" aria-expanded={visible}
          onPointerEnter={(event) => {
            cancel()
            if (event.pointerType === 'mouse' && !visible) timer.current = window.setTimeout(() => setPreview('hover'), 220)
          }} onPointerLeave={leave}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault()
              cancel()
              if (!visible) setPreview('hover')
              requestAnimationFrame(() => browser.current?.querySelector('button')?.focus())
            }
          }}
          onClick={() => { close(); if (panel !== null) selectPanel(null); else if (pane === 'closed') toggleSidebar() }}>
          {renderSlot('sidebar.home', {})}
        </button>
        {panels.map(({ id, label }) => <PanelRow key={id} id={id} label={label} wide={false}
          usePanelInfo={usePanelInfo} selectPanel={selectPanel} renderSlot={renderSlot} trackEntryClick={trackEntryClick} />)}
      </nav>
      <div className={css.foot}>
        {renderSlot('sidebar.footer.action', { wide: false })}
        {renderSlot('sidebar.settings', { wide: false })}
      </div>
    </div>
    <aside ref={browser} id="sidebar-conversations" className={css.browser} hidden={!visible}
      aria-label={t('home')} data-floating={floating || undefined}
      onPointerEnter={cancel} onPointerLeave={leave}
      onBlur={(event) => { if (preview && !event.currentTarget.contains(event.relatedTarget)) leave() }}>
      <div className={css.tools}>
        <button className={css.compose} type="button" data-dsh-sidebar-new-session="" aria-label={t('session.new.label')}
          aria-keyshortcuts={shortcut?.aria} onClick={newSession}><IconNewChatOutlineMedium size={16} />{t('session.new')}</button>
      </div>
      {renderSlot('sidebar.quickSwitcher', { wide: true, startSession })}
      {renderSlot('sidebar.workspaces', { wide: visible, expandSidebar: () => { cancel(); setPreview('hover') } })}
    </aside>
  </div>
}
