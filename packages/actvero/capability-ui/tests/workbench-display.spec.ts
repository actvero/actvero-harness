/** Display outcomes distinguish Client acknowledgement from business-data preparation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchDisplay } from '../src/workbench-display.ts'
import type { WorkbenchDisplayCommand, WorkbenchDisplayState, WorkbenchId } from '../src/types.ts'

const request = { id: 'test:display' as WorkbenchId, mode: 'business' as const }
const state: WorkbenchDisplayState = { id: request.id, instanceId: null, sessionId: null, mode: 'business',
  aiVisible: false, previewVisible: false, sidebar: 'expanded' }
afterEach(() => { vi.useRealTimers() })

describe('Client display acknowledgements', () => {
  it('does not claim a view when no Client or more than one Client is connected', async () => {
    const broker = new WorkbenchDisplay(1000)
    const signal = new AbortController().signal
    expect(await broker.request(request, signal)).toMatchObject({ status: 'unavailable' })
    const a = broker.attach(() => {})
    const b = broker.attach(() => {})
    expect(await broker.request(request, signal)).toMatchObject({ status: 'ambiguous' })
    a.dispose(); b.dispose()
  })

  it('settles only from the owning attachment, discards late replies and permits a fresh inspection', async () => {
    const broker = new WorkbenchDisplay(1000)
    const commands: WorkbenchDisplayCommand[] = []
    const first = broker.attach((command) => { commands.push(command) })
    const pending = broker.request(request, new AbortController().signal)
    const command = commands[0]
    if (command?.type !== 'open') throw new Error('Expected navigation request')
    const other = broker.attach(() => {})
    other.reply(command.requestId, { status: 'confirmed', state })
    let resolved = false
    void pending.then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    first.reply(command.requestId, { status: 'failed', reason: 'Provider failed to render' })
    expect(await pending).toEqual({ status: 'failed', reason: 'Provider failed to render' })
    first.reply(command.requestId, { status: 'confirmed', state })
    other.dispose()
    const inspect = broker.request(null, new AbortController().signal)
    const query = commands[1]
    if (query?.type !== 'inspect') throw new Error('Expected inspection')
    first.reply(query.requestId, { status: 'confirmed', state })
    expect(await inspect).toEqual({ status: 'confirmed', state })
    first.dispose()
  })

  it('does not dispatch an already cancelled request and releases a failed channel attempt', async () => {
    vi.useFakeTimers()
    const broker = new WorkbenchDisplay(500)
    const send = vi.fn(() => { throw new Error('Channel closed') })
    const client = broker.attach(send)
    const controller = new AbortController()
    controller.abort()
    expect(await broker.request(request, controller.signal)).toMatchObject({ status: 'cancelled' })
    expect(send).not.toHaveBeenCalled()
    expect(await broker.request(request, new AbortController().signal)).toMatchObject({ status: 'unknown' })
    expect(vi.getTimerCount()).toBe(0)
    client.dispose()
  })

  it('reports disconnect and timeout as unknown, forwards cancellation and never replays an open', async () => {
    vi.useFakeTimers()
    const broker = new WorkbenchDisplay(500)
    const commands: WorkbenchDisplayCommand[] = []
    const client = broker.attach((command) => { commands.push(command) })
    const controller = new AbortController()
    const cancelled = broker.request(request, controller.signal)
    controller.abort()
    expect(await cancelled).toMatchObject({ status: 'cancelled' })
    expect(commands.map(command => command.type)).toEqual(['open', 'cancel'])
    const timeout = broker.request(request, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(500)
    expect(await timeout).toMatchObject({ status: 'unknown' })
    const disconnected = broker.request(request, new AbortController().signal)
    client.dispose()
    expect(await disconnected).toMatchObject({ status: 'unknown' })
    expect(vi.getTimerCount()).toBe(0)
    const replacement = broker.attach((command) => { commands.push(command) })
    expect(commands.filter(command => command.type === 'open')).toHaveLength(3)
    replacement.dispose()
  })
})
