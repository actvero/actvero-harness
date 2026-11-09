/** Browser-local workbench ordering; unavailable providers retain their saved positions. */
const storageKey = 'actvero.workbenches.order.v1'

/** Read saved ids, rejecting malformed browser storage without hiding the catalog.
 * @returns Unique saved workbench ids, or the default order when unavailable.
 */
export function readWorkbenchOrder(): readonly string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) throw new Error('Invalid workbench order')
    return [...new Set<string>(value)]
  } catch (error) {
    console.warn('Unable to restore workbench order', error)
    return []
  }
}

/** Save a local display preference without changing workbench selection or business data.
 * @param order Ordered workbench ids.
 * @returns Whether the preference was persisted.
 */
export function saveWorkbenchOrder(order: readonly string[]): boolean {
  try { localStorage.setItem(storageKey, JSON.stringify(order)); return true }
  catch (error) { console.warn('Unable to save workbench order', error); return false }
}

/** Keep saved relative positions and append newly available workbenches.
 * @param catalog Currently available workbenches in registration order.
 * @param saved Saved workbench ids, including temporarily unavailable entries.
 * @returns Available workbenches in display order.
 */
export function orderWorkbenches<T extends { id: string }>(catalog: readonly T[], saved: readonly string[]): T[] {
  const entries = new Map(catalog.map(entry => [entry.id, entry]))
  return [...new Set([...saved, ...entries.keys()])].flatMap((id) => {
    const entry = entries.get(id)
    return entry ? [entry] : []
  })
}

/** Move one available workbench relative to another while retaining unavailable ids.
 * @param saved Saved order.
 * @param available Currently available ids in display order.
 * @param id Workbench to move.
 * @param target Destination workbench.
 * @param edge Insert before or after the destination.
 * @returns Updated local order; invalid or identical ids leave it unchanged.
 */
export function moveWorkbench(saved: readonly string[], available: readonly string[], id: string, target: string, edge: 'before' | 'after'): readonly string[] {
  if (id === target || !available.includes(id) || !available.includes(target)) return saved
  const order = [...new Set([...saved, ...available])].filter(item => item !== id)
  order.splice(order.indexOf(target) + (edge === 'after' ? 1 : 0), 0, id)
  return order
}
