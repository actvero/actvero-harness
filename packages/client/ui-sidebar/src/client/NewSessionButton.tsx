import clsx from 'clsx'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import { IconNewChatOutlineMedium, IconNewChatOutlineRegular, ShortcutKeys, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './SidebarRoot.module.css'

/** Sidebar action with a centered label and a shortcut hint on hover or keyboard focus.
 * @param props Sidebar presentation, localized labels, shortcut and activation handler.
 * @returns The New Session button for the conversation pane or standard sidebar.
 */
export function NewSessionButton({ wide, t, shortcut, onClick, windowsTitlebar = false }: {
  wide: boolean
  t: SidebarRootComponentProps['t']
  shortcut: ShortcutCatalogEntry | undefined
  onClick: () => void
  windowsTitlebar?: boolean
}) {
  return (
    <Tooltip label={t('session.new.label')} shortcutKeys={shortcut?.keys} delayMs={500} side={windowsTitlebar ? 'bottom' : 'right'} disabled={wide}>
      <button
        type="button"
        className={css.newSession}
        data-dsh-sidebar-new-session=""
        aria-label={t('session.new.label')}
        aria-keyshortcuts={shortcut?.aria}
        onClick={onClick}
      >
        <span className={css.newSessionLabelMask}><span className={css.newSessionContent}>
          {wide
            ? <IconNewChatOutlineMedium size={14} />
            : <IconNewChatOutlineRegular size={windowsTitlebar ? 16 : 18} />}
          {wide && <span className={clsx(css.newSessionLabel, css.wide)}>{t('session.new')}</span>}
        </span></span>
        {wide && shortcut !== undefined && shortcut.keys.length > 0 && <span className={css.newSessionShortcut} aria-hidden="true">
          <ShortcutKeys keys={shortcut.keys} />
        </span>}
      </button>
    </Tooltip>
  )
}
