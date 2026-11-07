/** Movable business previews and native AI windows with separate saved positions. */
import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Button, IconCloseOutlineRegular, IconFullscreenOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchInstanceId } from '../../types.ts'
import styles from './runtime.module.css'

interface Position { x: number; y: number }

function readPosition(key: string): Position | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (value !== null && typeof value === 'object' && 'x' in value && 'y' in value
      && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y)) {
      return { x: value.x, y: value.y }
    }
  } catch (error) { console.warn('Cannot restore workbench preview position', error) }
  return null
}

function savePosition(key: string, value: Position): void {
  try { localStorage.setItem(key, JSON.stringify(value)) }
  catch (error) { console.warn('Cannot remember workbench preview position', error) }
}

/**
 * Preview mode scales inert business content; chat mode keeps native input and scrolling.
 * Drag the preview or chat header, or focus the window and use arrow keys to move it.
 * @param props - business instance, preview content and native window actions. Mount separately per instance.
 * @returns floating preview; interrupted drags retain their last visible position.
 */
export function FloatingPreview({ instanceId, children, enter, collapse, t, mode = 'preview', hidden }: PropsLocale<'actvero.workbenches'> & {
  instanceId: WorkbenchInstanceId
  children: ReactNode
  mode?: 'preview' | 'chat'
  hidden?: boolean
  enter: () => void
  collapse: () => void
}) {
  const key = `actvero.workbenches.${mode === 'chat' ? 'chat' : 'preview'}-position.v1:${instanceId}`
  const [position, setPosition] = useState(() => readPosition(key))
  const element = useRef<HTMLElement>(null)
  const drag = useRef<{ pointerId: number; origin: Position; start: Position; latest: Position } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [geometry, setGeometry] = useState({ width: 300, height: 200,
    viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, top: 16 })
  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const measure = () => {
      if (node.hidden) return
      const overlayTop = Number.parseFloat(getComputedStyle(node).getPropertyValue('--dsh-frame-overlay-top')) || 0
      setGeometry({ width: node.offsetWidth, height: node.offsetHeight, viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight, top: Math.max(16, overlayTop) })
    }
    const stopScroll = (event: WheelEvent) => { if (mode === 'preview') event.preventDefault() }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    window.addEventListener('resize', measure)
    node.addEventListener('wheel', stopScroll, { passive: false })
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      node.removeEventListener('wheel', stopScroll)
    }
  }, [hidden, mode])
  const clamp = ({ x, y }: Position): Position => ({
    x: Math.max(16, Math.min(x, geometry.viewportWidth - geometry.width - 16)),
    y: Math.max(geometry.top, Math.min(y, geometry.viewportHeight - geometry.height - 16)),
  })
  const finish = (event: PointerEvent<HTMLElement>, interrupted: boolean) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
    // Capture loss can follow leaving the native window; its coordinates are not a release position.
    const next = interrupted ? clamp(active.latest)
      : clamp({ x: active.origin.x + event.clientX - active.start.x, y: active.origin.y + event.clientY - active.start.y })
    setPosition(next)
    savePosition(key, next)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const visible = position && clamp(position)
  const viewport = { width: 960, height: 640 }
  const scale = Math.min(geometry.width / viewport.width, geometry.height / viewport.height)
  return <aside data-workbench-preview={mode === 'preview' ? '' : undefined} data-workbench-ai={mode === 'chat' ? '' : undefined} ref={element} className={mode === 'chat' ? styles.chatFloat : styles.workbenchFloat} hidden={hidden}
    aria-label={t(mode === 'chat' ? 'workbenchConversation' : 'floatWorkbench')} aria-description={t('movePreview')}
    tabIndex={0} data-dragging={dragging || undefined} style={visible ? { left: `clamp(16px, ${visible.x}px, calc(100vw - var(--actvero-floating-width) - 16px))`,
      top: `clamp(max(16px, var(--dsh-frame-overlay-top, 0px)), ${visible.y}px, calc(100dvh - var(--actvero-floating-height) - 16px))`, right: 'auto' } : undefined}
    onPointerDown={(event) => {
      if (event.button !== 0 || !event.isPrimary || drag.current || (event.target instanceof Element && event.target.closest('button'))) return
      if (mode === 'chat' && !(event.target instanceof Element && event.target.closest('[data-workbench-drag]'))) return
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      drag.current = { pointerId: event.pointerId, origin: { x: rect.x, y: rect.y },
        start: { x: event.clientX, y: event.clientY }, latest: { x: rect.x, y: rect.y } }
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
    }}
    onPointerMove={(event) => {
      const active = drag.current
      if (active?.pointerId !== event.pointerId) return
      active.latest = clamp({ x: active.origin.x + event.clientX - active.start.x, y: active.origin.y + event.clientY - active.start.y })
      setPosition(active.latest)
    }}
    onPointerUp={(event) => { finish(event, false) }} onPointerCancel={(event) => { finish(event, true) }}
    onLostPointerCapture={(event) => { finish(event, true) }}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); collapse(); return }
      if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      const next = clamp({ x: rect.x + (event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0),
        y: rect.y + (event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0) })
      setPosition(next)
      savePosition(key, next)
    }}>
    {mode === 'preview' && <div className={styles.previewActions}>
      <Button size="sm" className={styles.iconButton} aria-label={t('fullWorkbench')}
        onClick={enter}><IconFullscreenOutlineRegular /></Button>
      <Button size="sm" className={styles.iconButton} aria-label={t('collapse')}
        onClick={collapse}><IconCloseOutlineRegular /></Button>
    </div>}
    {mode === 'preview' ? <div className={styles.previewCanvas} {...{ inert: '' }} aria-hidden="true"
      style={{ ...viewport, transform: `scale(${scale})` }}>{children}</div> : children}
  </aside>
}
