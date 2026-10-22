/** Maximum avatar size accepted by the durable expert-selection projection. */
export const MAX_EXPERT_SELECTION_AVATAR_CHARS = 500_000

/**
 * Keep durable session metadata bounded while retaining normal URL/data avatars.
 * Uses the same bound as the portable manifest so every accepted portrait survives selection.
 */
export function normalizeExpertSelectionAvatar(value: string): string {
  return value.length <= MAX_EXPERT_SELECTION_AVATAR_CHARS ? value : ''
}
