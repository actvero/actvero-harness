/** Connection-owned display requests; a successful business open is not a UI acknowledgement. */
import { randomUUID } from 'node:crypto'
import type { WorkbenchDisplayCommand, WorkbenchDisplayRequest, WorkbenchDisplayRequestId, WorkbenchDisplayResult } from './types.ts'

interface Client {
  send(command: WorkbenchDisplayCommand): void
  pending: Map<WorkbenchDisplayRequestId, (result: WorkbenchDisplayResult) => void>
}

/** Broker shared by the native Remote channel and resident tools; each attachment owns its pending replies. */
export class WorkbenchDisplay {
  private readonly clients = new Set<Client>()
  /** @param timeoutMs Maximum wait for an actual Client acknowledgement. */
  constructor(private readonly timeoutMs: number) {}

  /** Attach one answering Client for exactly the stream lifetime.
   * @param send Downlink owned by the connected Client.
   * @returns Reply routing and a disposer that settles outstanding requests as unknown.
   */
  attach(send: Client['send']): { reply(id: WorkbenchDisplayRequestId, result: WorkbenchDisplayResult): void; dispose(): void } {
    const client: Client = { send, pending: new Map() }
    this.clients.add(client)
    return {
      reply: (id, result) => { client.pending.get(id)?.(result) },
      dispose: () => {
        this.clients.delete(client)
        for (const finish of [...client.pending.values()]) finish({ status: 'unknown', reason: 'Client disconnected; inspect the view before retrying.' })
      },
    }
  }

  /** Ask exactly one connected Client, without choosing arbitrarily between multiple windows.
   * @param request Display choices; null reads the current mounted view.
   * @param signal Caller cancellation; late replies are discarded and cancellation is forwarded.
   * @returns Confirmation only after a reply; missing Client, cancellation and uncertain outcomes remain distinct.
   */
  request(request: WorkbenchDisplayRequest | null, signal: AbortSignal): Promise<WorkbenchDisplayResult> {
    if (signal.aborted) return Promise.resolve({ status: 'cancelled', reason: 'Display request cancelled.' })
    let client: Client | undefined
    for (const candidate of this.clients) {
      if (client) return Promise.resolve({ status: 'ambiguous', reason: 'Multiple Clients are connected. Keep one answering Client open before navigating.' })
      client = candidate
    }
    if (!client) return Promise.resolve({ status: 'unavailable', reason: 'No answering Client is connected. Open the desktop or Web Client.' })
    const target = client
    const requestId = randomUUID() as WorkbenchDisplayRequestId
    return new Promise((resolve) => {
      const finish = (result: WorkbenchDisplayResult) => {
        if (!target.pending.delete(requestId)) return
        clearTimeout(timer)
        signal.removeEventListener('abort', cancel)
        resolve(result)
      }
      const cancel = () => {
        target.send({ type: 'cancel', requestId })
        finish({ status: 'cancelled', reason: 'Display request cancelled; inspect the view if navigation had already begun.' })
      }
      const timer = setTimeout(() => {
        target.send({ type: 'cancel', requestId })
        finish({ status: 'unknown', reason: 'Client did not confirm before the deadline. Inspect the view before retrying.' })
      }, this.timeoutMs)
      target.pending.set(requestId, finish)
      signal.addEventListener('abort', cancel, { once: true })
      try { target.send(request ? { type: 'open', requestId, request } : { type: 'inspect', requestId }) }
      catch (_error) { finish({ status: 'unknown', reason: 'Display channel failed. Inspect the view after reconnecting.' }) }
    })
  }
}
