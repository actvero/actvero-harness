/** Native display channel and render acknowledgement, independent of business storage. */
import type { Context } from '@deepseek-ai/cordis'
import type { WorkbenchDisplayChannelId, WorkbenchDisplayCommand, WorkbenchDisplayRequest, WorkbenchDisplayRequestId,
  WorkbenchDisplayResult,
  WorkbenchDisplayState } from '../../types.ts'

/** Wait for a committed host view, without polling or treating a data-open result as rendering evidence.
 * @param read Current view read, returning null until the requested view is mounted.
 * @param signal Navigation, connection or caller cancellation.
 * @returns The observed mounted state; cancellation releases the DOM observer.
 */
export function waitForWorkbenchView(read: () => WorkbenchDisplayState | null, signal: AbortSignal): Promise<WorkbenchDisplayState> {
  return new Promise((resolve, reject) => {
    const stop = () => { observer.disconnect(); signal.removeEventListener('abort', abort) }
    const abort = () => { stop(); reject(signal.reason instanceof Error ? signal.reason : new Error('Workbench display cancelled', { cause: signal.reason })) }
    const check = () => {
      if (signal.aborted) { abort(); return }
      try {
        const state = read()
        if (state) { stop(); resolve(state) }
      } catch (error) { stop(); reject(error instanceof Error ? error : new Error('Workbench view failed', { cause: error })) }
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-workbench-main', 'data-workbench-conversation', 'data-workbench-instance', 'data-workbench-session', 'data-slot-error', 'data-factory-error', 'hidden'] })
    signal.addEventListener('abort', abort, { once: true })
    check()
  })
}

/** Mount an answering Client on the native reconnecting Remote stream; only queries are safe to repeat.
 * @param ctx Client scope with the generated workbench namespace.
 * @param present Shared navigation used by the UI and workbench authors.
 * @param snapshot Current committed view, queried for every status request.
 * @returns Awaited teardown of requests and their connection generation.
 */
export function connectWorkbenchDisplay(ctx: Context,
  present: (request: WorkbenchDisplayRequest, signal: AbortSignal) => Promise<WorkbenchDisplayState>,
  snapshot: () => WorkbenchDisplayState): () => Promise<void> {
  const pending = new Map<WorkbenchDisplayRequestId, AbortController>()
  const tasks = new Set<Promise<void>>()
  const lifetime = new AbortController()
  const stream = ctx.remote.$stream<WorkbenchDisplayCommand>({ name: 'actvero-workbench-display',
    open: signal => ctx.remote.actveroWorkbench.displayCommands(signal),
    ended: () => new Error('Workbench display channel ended'),
  })
  const consume = (async () => {
    let channelId: WorkbenchDisplayChannelId | undefined
    for await (const frame of stream) {
      if (frame.value.type === 'ready') { channelId = frame.value.channelId; frame.accept(); continue }
      if (frame.value.type === 'cancel') { pending.get(frame.value.requestId)?.abort(); continue }
      const channel = channelId
      if (!channel) throw new Error('Workbench display channel has no readiness identity')
      const command = frame.value
      const abort = new AbortController()
      pending.set(command.requestId, abort)
      const signal = AbortSignal.any([abort.signal, frame.signal, lifetime.signal])
      const task = (async () => {
        let result: WorkbenchDisplayResult
        try {
          const state = command.type === 'inspect' ? snapshot() : await present(command.request, signal)
          signal.throwIfAborted()
          result = { status: 'confirmed', state }
        } catch (error) {
          ctx.logger.warn('Workbench display request did not complete: %s', error)
          result = signal.aborted ? { status: 'cancelled', reason: 'Client navigation cancelled or superseded.' }
            : { status: 'failed', reason: 'Workbench view could not be loaded. Check the installed provider and try again.' }
        }
        if (!frame.signal.aborted && !lifetime.signal.aborted) {
          const reply = await ctx.remote.actveroWorkbench.acknowledgeDisplay(channel, command.requestId, result)
          if (!reply.ok) ctx.logger.warn('Workbench display acknowledgement failed: %s', reply.error)
        }
      })().catch((error: unknown) => { ctx.logger.warn('Workbench display channel failed: %s', error) })
        .finally(() => { pending.delete(command.requestId); tasks.delete(task) })
      tasks.add(task)
    }
  })().catch((error: unknown) => {
    if (!lifetime.signal.aborted) ctx.logger.warn('Workbench display connection ended: %s', error)
  })
  return async () => {
    lifetime.abort()
    await stream.dispose()
    await consume
    await Promise.all(tasks)
  }
}
