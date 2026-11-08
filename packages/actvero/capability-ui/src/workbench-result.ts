/** Provider-independent result metadata persisted by native tools. */
import { z } from 'zod'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import { workbenchReferenceSchema, encodeWorkbenchReference, type WorkbenchReferenceSnapshot } from './workbench-reference.ts'

/** Immutable business result; links retain a readable snapshot even when their provider is absent. */
export interface WorkbenchResult {
  readonly schemaVersion: 1
  readonly title: string
  readonly summary: string
  readonly references: readonly WorkbenchReferenceSnapshot[]
}

const resultSchema = z.object({
  schemaVersion: z.literal(1), title: z.string().min(1), summary: z.string(),
  references: z.array(workbenchReferenceSchema),
}).strict().refine(result => new Set(result.references.map(reference => JSON.stringify([
  reference.workbenchId, reference.instanceId, reference.objectId, reference.revision,
]))).size === result.references.length, 'Duplicate workbench result references')

/** Validate durable metadata without loading a business plugin.
 * @param metadata Tool-owned JSON from the Session log.
 * @returns Supported result, or undefined so native raw output remains the fallback.
 */
export function readWorkbenchResult(metadata: unknown): WorkbenchResult | undefined {
  if (!metadata || typeof metadata !== 'object' || !('actveroWorkbench' in metadata)) return undefined
  const result = resultSchema.safeParse(metadata.actveroWorkbench)
  return result.success ? result.data : undefined
}

/** Build the native output.presentationMeta payload from a validated business result.
 * @param result Fixed title, summary and object snapshots; never callbacks or ambient selection.
 * @returns JSON copied into tool/result and nested PTC records.
 */
export function workbenchResultMetadata(result: WorkbenchResult): NonNullable<ToolResult['meta']> {
  const parsed = resultSchema.parse(result)
  return { actveroWorkbench: { ...parsed, references: parsed.references.map(reference => ({ ...reference })) } }
}

/** Render the same facts for the model and text-only clients.
 * @param result Fixed business result captured by tool execution.
 * @returns Readable summary and versioned reference envelopes.
 */
export function workbenchResultText(result: WorkbenchResult): string {
  return [result.title, result.summary, ...result.references.map(encodeWorkbenchReference)].join('\n\n')
}
