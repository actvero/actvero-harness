/** DSH rc.2 detect projection represents each reference chip by one character.
 * Keep existing chips/attachments intact; draftRev guards concurrent edits. */
export function appendSpan(state: {
  draft: string
  draftRev: number
  occurrences?: readonly { length: number }[]
}) {
  const end =
    state.draft.length -
    (state.occurrences??[]).reduce((sum, item) => sum + item.length - 1, 0)
  return { start: end, end, draftRev: state.draftRev }
}
