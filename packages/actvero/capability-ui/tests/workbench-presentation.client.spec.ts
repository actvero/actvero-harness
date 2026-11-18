// @vitest-environment jsdom
/** Render acknowledgement follows committed DOM and releases cancelled observation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForWorkbenchView } from '../src/client/workbenches/presentation.ts'
import type { WorkbenchDisplayState } from '../src/types.ts'

const state: WorkbenchDisplayState = { id: null, instanceId: null, sessionId: null, mode: 'other',
  aiVisible: false, previewVisible: false, sidebar: 'expanded' }
afterEach(() => { document.body.replaceChildren() })

describe('workbench mount acknowledgement', () => {
  it('waits for a committed view and rejects a render failure', async () => {
    const ready = waitForWorkbenchView(() => document.querySelector('[data-workbench-main]') ? state : null, new AbortController().signal)
    const node = document.createElement('section')
    node.setAttribute('data-workbench-main', 'test')
    document.body.append(node)
    expect(await ready).toBe(state)
    const switched = waitForWorkbenchView(() => node.dataset.workbenchSession === 'next' ? state : null, new AbortController().signal)
    node.dataset.workbenchSession = 'next'
    expect(await switched).toBe(state)
    await expect(waitForWorkbenchView(() => { throw new Error('View failed') }, new AbortController().signal)).rejects.toThrow('View failed')
  })

  it('stops observing when navigation is cancelled, including cancellation before mounting', async () => {
    const controller = new AbortController()
    const read = vi.fn(() => null)
    const ready = waitForWorkbenchView(read, controller.signal)
    controller.abort(new Error('User navigated away'))
    await expect(ready).rejects.toThrow('User navigated away')
    document.body.append(document.createElement('section'))
    await Promise.resolve()
    expect(read).toHaveBeenCalledOnce()
    await expect(waitForWorkbenchView(read, controller.signal)).rejects.toThrow('User navigated away')
    expect(read).toHaveBeenCalledOnce()
    const dismissed = new AbortController()
    dismissed.abort('dismissed')
    await expect(waitForWorkbenchView(read, dismissed.signal)).rejects.toThrow('Workbench display cancelled')
  })

  it('observes the rendered object identity and label after the workbench mount', async () => {
    const node = document.createElement('section')
    node.dataset.workbenchMain = 'board'
    node.dataset.workbenchObject = 'old-board'
    node.dataset.workbenchObjectLabel = '研发看板'
    document.body.append(node)
    const read = vi.fn(() => node.dataset.workbenchObject === 'new-board'
      && node.dataset.workbenchObjectLabel === '新媒体工作台' ? state : null)
    const result = waitForWorkbenchView(read, new AbortController().signal)
    node.dataset.workbenchObject = 'new-board'
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(2)
    node.dataset.workbenchObjectLabel = '新媒体工作台'
    expect(await result).toBe(state)
  })
})
