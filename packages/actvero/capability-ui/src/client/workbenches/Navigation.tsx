/** Global workbench navigation and the page-local switcher. */
import { useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { IconCheckOutlineRegular, IconChevronDownOutlineMedium, IconEllipsisOutlineRegular, Menu, MenuItemButton, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsHooks, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchAction, WorkbenchView } from './register.ts'
import { WorkbenchArtwork, WorkbenchIcon } from './WorkbenchIcon.tsx'
import { workbenchIconUrl } from './catalog.ts'
import styles from './navigation.module.css'
import { moveWorkbench, orderWorkbenches, readWorkbenchOrder, saveWorkbenchOrder } from './navigation-order.ts'

/** Reactive catalog and current selection shared by navigation and business views. */
export type WorkbenchViewHooks = PropsHooks<{ view: {
  getSnapshot: () => WorkbenchView
  subscribe: (listener: () => void) => () => void
} }>

/** Opens the catalog and highlights the same icon for a workbench business view.
 * @param props Localized catalog action and active panel selector.
 * @returns The workbench entry in the permanent navigation rail.
 */
export function Navigation({ t, active, onOpen, usePanelInfo }: PropsRuntime<'sidebar.panellist.row'> & PropsLocale<'actvero.workbenches'>) {
  const inBusiness = usePanelInfo(info => info.activePanelId === 'actvero-workbench-business')
  return <Tooltip label={t('title')} portal side="right">
    <button type="button" className={styles.manage} aria-label={t('title')} aria-current={active || inBusiness ? 'page' : undefined}
      onClick={onOpen}><WorkbenchIcon size={18} /></button>
  </Tooltip>
}

/** Select and reorder installed workbenches from the business page.
 * @param props Localized page presentation and the active workbench catalog.
 * @returns The workbench picker with its keyboard-accessible menu.
 */
export function WorkbenchSwitcher({ t, view, action }: PropsLocale<'actvero.workbenches'> & {
  view: WorkbenchView
  action: WorkbenchAction
}) {
  const { entries, opened } = view
  const [menuOpen, setMenuOpen] = useState(false)
  const [order, setOrder] = useState(readWorkbenchOrder)
  const [saveFailed, setSaveFailed] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [drop, setDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const drag = useRef<{ id: string; pointer: number; y: number; moved: boolean } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const catalog = orderWorkbenches(entries, order)
  const move = (id: string, target: string, edge: 'before' | 'after') => {
    const next = moveWorkbench(order, catalog.map(entry => entry.id), id, target, edge)
    if (next === order) return
    setOrder(next)
    setSaveFailed(!saveWorkbenchOrder(next))
    const entry = catalog.find(entry => entry.id === id)
    if (!entry) return
    const name = entry.name
    setAnnouncement(t('reordered', { name, position: String(orderWorkbenches(catalog, next).findIndex(entry => entry.id === id) + 1) }))
  }
  const cancelDrag = () => { drag.current = null; setDragging(null); setDrop(null) }
  const destination = (event: PointerEvent<HTMLElement>) => {
    const row = [...(list.current?.querySelectorAll<HTMLElement>('[data-workbench-entry]') ?? [])].find((element) => {
      const rect = element.getBoundingClientRect()
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
    })
    if (!row) return null
    const rect = row.getBoundingClientRect()
    const id = row.dataset.workbenchEntry
    if (!id) return null
    return { id, edge: event.clientY < rect.top + rect.height / 2 ? 'before' as const : 'after' as const }
  }

  const selected = catalog.find(entry => entry.id === opened)
  const row = <Tooltip label={t('switch')} portal side="bottom">
    <button type="button" className={styles.switchButton}
      aria-label={`${t('switch')} · ${selected?.name ?? t('choose')}`}
      aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
      <WorkbenchIcon size={16} />
      <IconChevronDownOutlineMedium size={14} />
    </button>
  </Tooltip>
  return <>
    <Menu open={menuOpen} onClose={() => { setMenuOpen(false); cancelDrag() }} portal autoFocus minWidthFromAnchor
      className={styles.anchor} listClassName={styles.switchMenu} anchor={row}
      items={[{ type: 'label', id: 'heading', text: t('mine') }]}>
      <div ref={list} onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancelDrag() }
      }}>
        {catalog.length === 0 && <div className={styles.sortHint}>{t('noWorkbenches')}</div>}
        {catalog.map((entry, index) => <div key={entry.id} className={styles.entry} data-workbench-entry={entry.id}
          data-dragging={dragging === entry.id} data-drop={drop?.id === entry.id && drop.id !== dragging ? drop.edge : undefined}
          onKeyDown={(event) => {
            if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
            event.preventDefault()
            const target = event.key === 'ArrowUp' ? (index > 0 ? catalog.at(index - 1) : undefined) : catalog.at(index + 1)
            if (target) move(entry.id, target.id, event.key === 'ArrowUp' ? 'before' : 'after')
          }}>
          <MenuItemButton current={selected?.id === entry.id}
            icon={<WorkbenchArtwork id={entry.id} url={workbenchIconUrl(view, entry.id)} size={18} />}
            onSelect={() => { setMenuOpen(false); action.open(entry.id) }}>
            <span className={styles.entryLabel}>
              <TruncatedName name={entry.name} />
              {selected?.id === entry.id && <IconCheckOutlineRegular size={16} />}
            </span>
          </MenuItemButton>
          <Tooltip label={t('reorder')} side="right" portal>
            <span className={styles.grip} aria-hidden="true" data-workbench-grip
              onClick={(event) => { event.stopPropagation() }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                drag.current = { id: entry.id, pointer: event.pointerId, y: event.clientY, moved: false }
              }}
              onPointerMove={(event) => {
                const current = drag.current
                if (!current || current.pointer !== event.pointerId) return
                if (Math.abs(event.clientY - current.y) > 4) current.moved = true
                if (!current.moved) return
                setDragging(current.id)
                setDrop(destination(event))
                const viewport = list.current?.parentElement
                if (viewport && viewport.scrollHeight > viewport.clientHeight) {
                  const rect = viewport.getBoundingClientRect()
                  if (event.clientY < rect.top + 24) viewport.scrollTop -= 12
                  if (event.clientY > rect.bottom - 24) viewport.scrollTop += 12
                }
              }}
              onPointerUp={(event) => {
                const current = drag.current
                const target = destination(event)
                if (current?.pointer === event.pointerId && current.moved && target) move(current.id, target.id, target.edge)
                cancelDrag()
              }}
              onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
              <IconEllipsisOutlineRegular size={16} /><IconEllipsisOutlineRegular size={16} />
            </span>
          </Tooltip>
        </div>)}
      </div>
      {saveFailed && <div className={styles.sortHint} role="status">{t('orderSaveFailed')}</div>}
    </Menu>
    <span className={styles.srOnly} role="status">{announcement}</span>
  </>
}

function TruncatedName({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => { setTruncated(element.scrollWidth > element.clientWidth) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [name])
  return <Tooltip label={name} disabled={!truncated} portal>
    <span ref={ref} className={styles.currentName}>{name}</span>
  </Tooltip>
}
