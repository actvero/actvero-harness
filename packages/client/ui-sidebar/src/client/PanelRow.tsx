import clsx from 'clsx'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarPanelMetadata, SidebarRootInjected, SidebarSectionOwnerProps } from './contract/slots.ts'
import css from './SidebarRoot.module.css'

type PanelRowProps =
  Pick<SidebarPanelMetadata, 'id' | 'label'>
  & Pick<SidebarSectionOwnerProps, 'wide'>
  & Pick<PropsRuntime<'sidebar'>, 'usePanelInfo'>
  & Pick<InjectFace<SidebarRootInjected>, 'selectPanel' | 'trackEntryClick'>
  & PropsRenderSlots<'sidebar.panellist' | 'sidebar.panellist.row'>

/** Identifies the official panels that report navigation analytics.
 * @param id Registered panel identifier.
 * @returns The analytics category for a tracked panel.
 */
export function officialEntry(id: string): 'plugin' | 'cron' | undefined {
  if (id === 'plugins') return 'plugin'
  return id === 'schedules' ? 'cron' : undefined
}

/** Renders the registered panel row or its default icon and label.
 * @param props Panel metadata, presentation and navigation actions.
 * @returns The panel entry subscribed to its own selection state.
 */
export function PanelRow({ id, label, wide, usePanelInfo, selectPanel, trackEntryClick, renderSlot }: PanelRowProps) {
  const active = usePanelInfo(info => info.activePanelId === id)
  const onOpen = (): void => {
    const entry = officialEntry(id)
    if (entry !== undefined) trackEntryClick({ menu_name: entry, position: 'sidebar' })
    selectPanel(id)
  }
  return renderSlot('sidebar.panellist.row', { id, label, wide, active, onOpen }, { entryKey: id, fallback: (
    <Tooltip label={label} delayMs={500} disabled={wide} side="right" portal>
      <button
        type="button"
        className={clsx(css.panelRow, active && css.panelActive)}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        onClick={onOpen}
      >
        <span className={css.panelGlyph} aria-hidden="true">
          {renderSlot('sidebar.panellist', { size: wide ? 16 : 18, active }, { only: id })}
        </span>
        {wide && (
          <span className={clsx(css.panelTitle, css.wide)}>
            {label}
          </span>
        )}
      </button>
    </Tooltip>
  ) })
}
