/** Content-sized permission and model collapse for the composer's two control groups. */

/**
 * Collapse permission text first, then model text when the controls cannot share a line.
 * Both seats consume the row's inherited display variables; wrapping remains available
 * when even the icons cannot fit. Each notification is measured synchronously.
 * @param row - Composer control row with its leading and trailing groups.
 * @returns Disconnect the layout observers and font listener.
 */
export function observeControlRow(row: HTMLElement): () => void {
  const measure = (): void => {
    // Always measure expanded demand, including text changed while collapsed.
    row.removeAttribute('data-permission-compact')
    row.removeAttribute('data-model-compact')
    const style = getComputedStyle(row)
    const available = row.getBoundingClientRect().width
      - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const demand = (): number => {
      const widths = Array.from(row.children, child => child.getBoundingClientRect().width)
        .filter(width => width > 0)
      return widths.reduce((sum, width) => sum + width, 0)
        + Math.max(0, widths.length - 1) * parseFloat(style.columnGap)
    }
    row.toggleAttribute('data-permission-compact', demand() > available)
    row.toggleAttribute('data-model-compact', demand() > available)
  }
  const resize = new ResizeObserver(measure)
  resize.observe(row)
  for (const child of row.children) resize.observe(child)
  const mutation = new MutationObserver(measure)
  mutation.observe(row, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['hidden'],
  })
  const fonts = document.fonts
  fonts.addEventListener('loadingdone', measure)
  measure()
  return () => {
    resize.disconnect()
    mutation.disconnect()
    fonts.removeEventListener('loadingdone', measure)
  }
}
