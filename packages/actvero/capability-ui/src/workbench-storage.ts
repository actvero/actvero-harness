/** Authoritative workbench instances and serial compare-and-set updates. */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { WorkbenchDocument, WorkbenchInstanceId } from './types.ts'
import { instanceIdSchema, workbenchIdSchema } from './workbench-projection.ts'

/** Business state retains its provider identity across upgrades and uninstall. */
export const documentSchema = z.object({
  id: workbenchIdSchema, instanceId: instanceIdSchema,
  revision: z.number().int().nonnegative(), json: z.string().refine((value) => {
    try { JSON.parse(value); return true } catch (_error) { return false }
  }, 'Business document must contain JSON'),
}).strict()
/** Profile-local workbench documents; uninstall never deletes this domain. */
export const workbenchDomain = defineDomain({
  name: 'actvero_workbench', version: 1,
  tables: { instances: domainTable<WorkbenchInstanceId, WorkbenchDocument>(documentSchema) },
})
