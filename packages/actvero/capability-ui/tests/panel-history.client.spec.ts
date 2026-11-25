/** Closed or inaccessible entries cannot redirect later Back and Forward actions. */
import { expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { PanelHistory } from '../src/client/workbenches/panel-history.ts'

it('skips removed entries and retains a forward branch until a new destination is visited', () => {
  const route = createSnapshotStore('a')
  const removed = new Set<string>()
  const history = new PanelHistory({ ...route, same: Object.is, open: route.set, available: id => !removed.has(id) })
  for (const id of ['a', 'b', 'c']) { route.set(id); history.record() }
  removed.add('b')
  history.go(-1)
  expect(route.getSnapshot()).toBe('a')
  history.record()
  history.go(1)
  expect(route.getSnapshot()).toBe('c')
  history.go(-1)
  route.set('d')
  history.record()
  expect(history.next(1)).toBe(-1)
  history.reset()
  expect(history.next(-1)).toBe(-1)
  expect(history.next(1)).toBe(-1)
})

it('replaces an unresolved Home entry and leaves the cursor in place when opening is declined', () => {
  const route = createSnapshotStore<string | null>(null)
  const history = new PanelHistory({ ...route, same: Object.is, replace: previous => previous === null,
    open: (id) => { if (id !== 'first') route.set(id) },
  })
  history.record()
  route.set('first')
  history.record()
  expect(history.next(-1)).toBe(-1)
  route.set('second')
  history.record()
  history.go(-1)
  expect(route.getSnapshot()).toBe('second')
  expect(history.next(-1)).toBe(0)
  expect(history.next(1)).toBe(-1)
})
