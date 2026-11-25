/** Window toolbar actions shared by the standard sidebar and fixed navigation. */
import {
  IconNewChatOutlineRegular, IconPanelLeftOutlineRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the frame's shell.leading slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarRootInjected } from './contract/slots.ts'
import css from './HeaderLeadingControls.module.css'

/** Sidebar actions used by the window toolbar. */
export type HeaderLeadingControlsProps =
  PropsRuntime<'shell.leading'> & InjectFace<SidebarRootInjected> & PropsLocale<'sidebar'>

type WindowNavigationControlsProps =
  Pick<HeaderLeadingControlsProps, 'toggleSidebar' | 'startSession' | 'trackEntryClick' | 'useShortcuts' | 't'>
  & { renderHistorySlot?: PropsRenderSlots<'sidebar.history'>['renderSlot'] }
  & { expanded?: boolean; showNewSession?: boolean; controls?: string; showToggle?: boolean }

/**
 * Uses the active sidebar state and the product’s available actions.
 * @param props - Injected sidebar actions plus the sidebar locale seat.
 * @returns the two window-chrome controls.
 */
export function HeaderLeadingControls(props: HeaderLeadingControlsProps) {
  return <WindowNavigationControls {...props} />
}

/** Renders the window-level sidebar toggle and the available conversation action.
 * @param props The current sidebar presentation, actions and shortcut bindings.
 * @returns The controls beside the native window buttons.
 */
export function WindowNavigationControls({ toggleSidebar, startSession, trackEntryClick, useShortcuts, t,
  renderHistorySlot, expanded, controls, showNewSession = true, showToggle = true }: WindowNavigationControlsProps) {
  const shortcut = useShortcuts(rows => rows.find(row => row.id === 'sidebar.left.toggle'))
  const label = t(expanded ? 'toggle.collapse' : 'toggle.open')
  const newShortcut = useShortcuts(rows => rows.find(row => row.id === 'session.new'))
  return (
    <div className={css.controls} data-rail-controls={renderHistorySlot ? true : undefined}>
      {showToggle && <Tooltip label={label} shortcutKeys={shortcut?.keys} delayMs={500}>
        <button
          type="button"
          className={css.iconButton}
          aria-label={label} aria-controls={controls} aria-expanded={expanded}
          aria-keyshortcuts={shortcut?.aria}
          onClick={() => { toggleSidebar() }}
        >
          <IconPanelLeftOutlineRegular size={16} className={css.panelIcon} />
        </button>
      </Tooltip>}
      {renderHistorySlot?.('sidebar.history', {})}
      {showNewSession && <Tooltip label={t('session.new.label')} shortcutKeys={newShortcut?.keys} delayMs={500}>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('session.new.label')}
          data-dsh-sidebar-new-session=""
          aria-keyshortcuts={newShortcut?.aria}
          onClick={() => {
            trackEntryClick({ menu_name: 'new_session', position: 'titlebar' })
            startSession()
          }}
        >
          <IconNewChatOutlineRegular size={16} />
        </button>
      </Tooltip>}
    </div>
  )
}
