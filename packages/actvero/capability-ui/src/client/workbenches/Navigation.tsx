/** Workbench management and quick switching share one sidebar row. */
import { useState } from 'react'
import { IconChecklistOutlineMedium, IconChevronDownOutlineMedium, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsHooks, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchAction, WorkbenchView } from './register.ts'
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
import styles from './navigation.module.css'

/** Reactive catalog and current selection shared by navigation and business views. */
export type WorkbenchViewHooks = PropsHooks<{ view: {
  getSnapshot: () => WorkbenchView
  subscribe: (listener: () => void) => () => void
} }>

function EntryIcon({ id, url }: { id: string; url?: string }) {
  const [failed, setFailed] = useState<string>()
  if (url && failed !== url) return <img className={styles.icon} src={url} alt="" onError={() => { setFailed(url) }} />
  return id === 'builtin:project-checklist' ? <IconChecklistOutlineMedium size={18} /> : <WorkbenchIcon size={18} />
}

/**
 * Render independent management and switch controls, including the collapsed rail.
 * @param props Sidebar state, workbench catalog, localized copy and navigation actions.
 * @returns Sidebar row with its workbench menu.
 */
export function Navigation({ t, wide, active, onOpen, useView, usePanelInfo, action }:
  PropsRuntime<'sidebar.panellist.row'> & PropsLocale<'actvero.workbenches'> & WorkbenchViewHooks & { action: WorkbenchAction }) {
  const { entries, opened } = useView(value => value)
  const inBusiness = usePanelInfo(info => info.activePanelId === 'actvero-workbench-business')
  const [menuOpen, setMenuOpen] = useState(false)
  const catalog = [{ id: 'builtin:project-checklist', name: t('sampleName'), iconUrl: undefined }, ...entries]
  const selected = catalog.find(entry => entry.id === opened)
  const row = <div className={styles.row} data-wide={wide} data-active={active || inBusiness} data-open={wide && menuOpen}>
    <Tooltip label={t('title')} disabled={wide} portal>
      <button type="button" className={styles.manage} aria-label={t('title')} aria-current={active ? 'page' : undefined}
        onClick={() => { setMenuOpen(false); onOpen() }}>
        <WorkbenchIcon size={wide ? 16 : 18} />
        {wide && <span>{t('title')}</span>}
      </button>
    </Tooltip>
    {wide && <Tooltip label={selected ? `${t('switch')} · ${selected.name}` : t('switch')} portal>
      <button type="button" className={styles.switchButton} aria-label={`${t('switch')} · ${selected?.name ?? t('choose')}`}
        aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => { setMenuOpen(value => !value) }}>
        <span className={styles.currentName}>{selected?.name ?? t('choose')}</span>
        <IconChevronDownOutlineMedium size={14} />
      </button>
    </Tooltip>}
  </div>
  return <Menu open={wide && menuOpen} onClose={() => { setMenuOpen(false) }} portal autoFocus minWidthFromAnchor
    className={styles.anchor} listClassName={styles.switchMenu} selectedId={selected?.id} anchor={row}
    items={[{ type: 'label', id: 'heading', text: t('mine') }, ...catalog.map(entry => ({
      id: entry.id, label: <span className={styles.entryName} title={entry.name}>{entry.name}</span>,
      icon: <EntryIcon id={entry.id} url={entry.iconUrl} />,
    }))]}
    onSelect={(id) => { setMenuOpen(false); action.open(id) }} />
}
