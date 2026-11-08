/** Versioned text embedded in native drafts and user messages; independent of installed providers. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import type { WorkbenchId, WorkbenchInstanceId } from './types.ts'

/** Source identity persisted by native draft occurrences. */
export const workbenchReferenceSource = 'actvero-workbench-reference'
/** Separately owned automatic chip; manual references are never replaced by selection updates. */
export const workbenchSelectionSource = 'actvero-workbench-selection'

/** Provider-owned business identity, unique within its workbench instance. */
export type WorkbenchObjectId = Branded<'ActveroWorkbenchObjectId'>

/** Immutable selection supplied explicitly by the business view; never an instruction to submit. */
export interface WorkbenchReferenceInput {
  readonly objectId: WorkbenchObjectId
  readonly label: string
  /** Opaque revision of the referenced content, assigned by the business provider. */
  readonly revision: string
  /** Readable snapshot; authors decide its scope and may include selected element ids. */
  readonly content: string
}

/** V1 user-owned content stored verbatim by the native draft and Session writers. */
export interface WorkbenchReferenceSnapshot extends WorkbenchReferenceInput {
  readonly schemaVersion: 1
  readonly workbenchId: WorkbenchId
  readonly instanceId: WorkbenchInstanceId
}

/** Parser shared by native reference envelopes and persisted tool-result metadata. */
export const workbenchReferenceSchema = z.object({
  schemaVersion: z.literal(1),
  workbenchId: z.string().min(1).transform(value => value as WorkbenchId),
  instanceId: z.string().min(1).transform(value => value as WorkbenchInstanceId),
  objectId: z.string().min(1).transform(value => value as WorkbenchObjectId),
  label: z.string().min(1), revision: z.string().min(1), content: z.string(),
}).strict()
const start = '<workbench-reference>'
const end = '</workbench-reference>'

/** Encode business content as data; escaped delimiters cannot terminate the containing reference.
 * @param snapshot Fixed provider identity and selected content.
 * @returns Readable JSON enclosed in a versioned reference envelope.
 */
export function encodeWorkbenchReference(snapshot: WorkbenchReferenceSnapshot): string {
  const { schemaVersion, workbenchId, instanceId, objectId, label, revision, content } = snapshot
  return start + JSON.stringify({ schemaVersion, workbenchId, instanceId, objectId, label, revision, content }).replaceAll('<', '\\u003c') + end
}

/** Parse persisted or pasted text without consulting a live provider.
 * @param text Complete reference envelope.
 * @returns Supported snapshot, or undefined for malformed or unsupported data.
 */
export function decodeWorkbenchReference(text: string): WorkbenchReferenceSnapshot | undefined {
  if (!text.startsWith(start) || !text.endsWith(end)) return undefined
  let json: unknown
  try { json = JSON.parse(text.slice(start.length, -end.length)) } catch (_error) { return undefined }
  const result = workbenchReferenceSchema.safeParse(json)
  return result.success ? result.data : undefined
}

/** Find the next supported snapshot while leaving malformed text visible to readers.
 * @param text Original user text.
 * @param from UTF-16 search offset.
 * @returns Snapshot and its original text span, or undefined.
 */
export function findWorkbenchReference(text: string, from: number):
{ start: number; end: number; data: WorkbenchReferenceSnapshot } | undefined {
  let offset = text.indexOf(start, from)
  while (offset !== -1) {
    const close = text.indexOf(end, offset + start.length)
    if (close === -1) return undefined
    const until = close + end.length
    const data = decodeWorkbenchReference(text.slice(offset, until))
    if (data) return { start: offset, end: until, data }
    offset = text.indexOf(start, offset + start.length)
  }
  return undefined
}
