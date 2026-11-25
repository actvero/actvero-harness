/** Bounded, in-memory navigation for one module in a window. */
import type { PanelRoutes } from '@deepseek-ai/dsh-client-ui-layout/client'

/** Tracks committed destinations and skips ones the module can no longer open. */
export class PanelHistory<T> {
  private entries: { destination: T }[] = []
  private index = -1

  constructor(private readonly routes: PanelRoutes<T>) {}

  /** Clear destinations when the account changes. */
  reset(): void {
    this.entries = []
    this.index = -1
  }

  /** Append a newly selected destination and discard any forward branch. */
  record(): void {
    const value = this.routes.getSnapshot()
    const previous = this.entries[this.index]
    if (previous) {
      if (this.routes.same(previous.destination, value)) return
      if (this.routes.replace?.(previous.destination, value)) {
        previous.destination = value
        return
      }
    }
    this.entries.splice(this.index + 1, this.entries.length, { destination: value })
    if (this.entries.length > 100) this.entries.shift()
    this.index = this.entries.length - 1
  }

  /** @param listener Receives destination and availability changes while this module is active.
   * @returns Removes the subscription.
   */
  subscribe(listener: () => void): () => void {
    return this.routes.subscribe(listener)
  }

  /** @param direction Backward or forward traversal.
   * @returns The next accessible entry index, or -1 at the end.
   */
  next(direction: -1 | 1): number {
    const current = this.entries[this.index]
    if (!current) return -1
    for (let i = this.index + direction; i >= 0 && i < this.entries.length; i += direction) {
      const entry = this.entries[i]
      if (entry && !this.routes.same(current.destination, entry.destination)
        && (this.routes.available?.(entry.destination) ?? true)) return i
    }
    return -1
  }

  /** Restore an accessible entry and advance the cursor when the selection succeeds.
   * @param direction Backward or forward traversal.
   */
  go(direction: -1 | 1): void {
    const target = this.next(direction)
    const entry = this.entries[target]
    if (!entry) return
    this.routes.open(entry.destination)
    if (this.routes.same(entry.destination, this.routes.getSnapshot())) this.index = target
  }
}
