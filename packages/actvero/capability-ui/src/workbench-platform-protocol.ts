/** Main/Host JSON validation for the fixed model-directory capability. */
import { z } from 'zod'
import type { WorkbenchModelCatalog, WorkbenchModelId, WorkbenchPlatformModel, WorkbenchPlatformScopeId } from './types.ts'
export type { WorkbenchModelCatalog } from './types.ts'

const modalities = z.array(z.string().min(1).max(64)).max(32)
const modelId = z.string().min(1).max(214).transform(value => value as WorkbenchModelId)
const operation = z.object({ kind: z.string().min(1).max(80), inputModalities: modalities, outputModalities: modalities }).strict()
const model = z.object({ id: modelId, name: z.string().max(256), description: z.string().max(2048),
  operations: z.array(operation).max(32) }).strict()
const catalog = z.object({ scope: z.string().regex(/^[a-f0-9]{64}$/u).transform(value => value as WorkbenchPlatformScopeId),
  models: z.array(model).max(2000).refine(rows => new Set(rows.map(row => row.id)).size === rows.length) }).strict()
const page = z.object({ data: z.array(z.object({ id: modelId, name: z.string().max(256).optional(),
  description: z.string().max(2048).optional(), operations: z.array(z.object({ kind: z.string().min(1).max(80),
    input_modalities: modalities.optional(), output_modalities: modalities.optional() })).max(32),
})).max(2000), has_more: z.boolean().optional() })

/** Decode a complete credential-free Main reply.
 * @param value Untrusted IPC JSON.
 * @returns Validated model directory and owning account generation.
 */
export function parseWorkbenchModelCatalog(value: unknown): WorkbenchModelCatalog { return catalog.parse(value) }

/** Select only public fields from a platform model page.
 * @param value Untrusted platform JSON; unknown fields are discarded.
 * @returns Public model metadata and the pagination flag.
 */
export function parseWorkbenchModelPage(value: unknown): { models: WorkbenchPlatformModel[]; hasMore: boolean } {
  const result = page.parse(value)
  return { models: result.data.map(row => ({ id: row.id, name: row.name ?? row.id, description: row.description ?? '',
    operations: row.operations.map(op => ({ kind: op.kind, inputModalities: op.input_modalities ?? [],
      outputModalities: op.output_modalities ?? [] })) })),
  hasMore: result.has_more === true }
}
