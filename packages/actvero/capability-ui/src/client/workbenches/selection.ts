/** Automatic references are owned by one native draft, never by the active window. */
import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkbenchReferenceSnapshot } from '../../workbench-reference.ts'
import { encodeWorkbenchReference, workbenchSelectionSource } from '../../workbench-reference.ts'

type Managed = { ref: string }

/** Tracks automatic chips while their native input exists; explicit references remain independent. */
export class WorkbenchSelections {
  private readonly drafts = new WeakMap<SessionInput, Managed>()

  /** Attach a captured selection or remove only the automatically managed chip.
   * @param input Addressed native input, retained by the caller during this operation.
   * @param snapshot Immutable business content, or null to clear the selection.
   * @returns Admission status; removing or sending a chip consumes that selection until it changes.
   */
  update(input: SessionInput, snapshot: WorkbenchReferenceSnapshot | null): 'attached' | 'cleared' | 'dismissed' | 'busy' {
    const occurrences = input.state.getSnapshot().occurrences
    const previous = this.drafts.get(input)
    const current = occurrences.find(item => item.source === workbenchSelectionSource && (!previous || item.ref === previous.ref))
    if (!snapshot) {
      if (current && !input.updateReference(current, null)) return 'busy'
      this.drafts.delete(input)
      return 'cleared'
    }
    const ref = encodeWorkbenchReference(snapshot)
    if (current?.ref === ref) { this.drafts.set(input, { ref }); return 'attached' }
    if (previous?.ref === ref) return 'dismissed'
    const insert = { source: workbenchSelectionSource, ref, label: snapshot.label, appearance: 'file' as const, clipboardText: ref }
    const applied = input.updateReference(current ?? null, insert)
    if (!applied) return 'busy'
    const added = input.state.getSnapshot().occurrences.find(item => item.source === workbenchSelectionSource && item.ref === ref
      && (current ? item.occurrenceId === current.occurrenceId : !occurrences.some(old => old.occurrenceId === item.occurrenceId)))
    if (!added) throw new Error('Native composer did not publish the inserted workbench reference')
    this.drafts.set(input, { ref })
    return 'attached'
  }
}
