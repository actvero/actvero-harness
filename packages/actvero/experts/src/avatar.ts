/** Maximum avatar size accepted by the durable expert-selection projection. */
export const MAX_EXPERT_SELECTION_AVATAR_CHARS = 200_000

/**
 * Keep durable session metadata bounded while retaining normal URL/data avatars.
 * Oversized imported portraits fall back to the expert name in the UI.
 */
export function normalizeExpertSelectionAvatar(value: string): string {
  return value.length <= MAX_EXPERT_SELECTION_AVATAR_CHARS ? value : ''
}
