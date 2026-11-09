// @vitest-environment jsdom
/** Local navigation order survives reloads and changing provider availability. */
import { afterEach, expect, it, vi } from 'vitest'
import { moveWorkbench, orderWorkbenches, readWorkbenchOrder, saveWorkbenchOrder } from '../src/client/workbenches/navigation-order.ts'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

it('restores relative order, appends new providers, and retains temporarily unavailable ids during moves', () => {
  const saved = ['whiteboard', 'offline', 'checklist']
  const catalog = [{ id: 'checklist' }, { id: 'whiteboard' }, { id: 'new' }]
  expect(orderWorkbenches(catalog, saved).map(entry => entry.id)).toEqual(['whiteboard', 'checklist', 'new'])
  const moved = moveWorkbench(saved, ['whiteboard', 'checklist', 'new'], 'new', 'whiteboard', 'before')
  expect(saveWorkbenchOrder(moved)).toBe(true)
  expect(readWorkbenchOrder()).toEqual(['new', 'whiteboard', 'offline', 'checklist'])
  expect(orderWorkbenches([...catalog, { id: 'offline' }], readWorkbenchOrder()).map(entry => entry.id))
    .toEqual(['new', 'whiteboard', 'offline', 'checklist'])
  expect(moveWorkbench(moved, catalog.map(entry => entry.id), 'whiteboard', 'checklist', 'after'))
    .toEqual(['new', 'offline', 'checklist', 'whiteboard'])
})

it('ignores identical and unavailable drag endpoints', () => {
  const order = ['a', 'b']
  expect(moveWorkbench(order, order, 'a', 'a', 'after')).toBe(order)
  expect(moveWorkbench(order, order, 'a', 'missing', 'after')).toBe(order)
  expect(moveWorkbench(order, order, 'missing', 'a', 'before')).toBe(order)
})

it('uses catalog order when stored preferences are malformed or storage is unavailable', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  for (const value of ['{}', '["a",1]', '{']) {
    localStorage.setItem('actvero.workbenches.order.v1', value)
    expect(readWorkbenchOrder()).toEqual([])
  }
  localStorage.setItem('actvero.workbenches.order.v1', '["b","a","b"]')
  expect(readWorkbenchOrder()).toEqual(['b', 'a'])
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  expect(readWorkbenchOrder()).toEqual([])
  expect(saveWorkbenchOrder(['b', 'a'])).toBe(false)
  expect(warn).toHaveBeenCalled()
})
