/** Session-log validation and replay for the selected workbench environment. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { WorkbenchId, WorkbenchInstanceId, WorkbenchSelection } from './types.ts'
import type { WorkbenchObjectId } from './workbench-reference.ts'

/** Validates persisted provider IDs, including the built-in checklist. */
export const workbenchIdSchema = z.string().regex(/^[a-z0-9@][a-z0-9@/._:-]{0,213}$/).transform(value => value as WorkbenchId)
/** Validates host-created instance IDs. */
export const instanceIdSchema = z.uuid().transform(value => value as WorkbenchInstanceId)
/** Exact environment restored from the Session log. */
const legacySelectionSchema = z.object({
  id: workbenchIdSchema, instanceId: instanceIdSchema, name: z.string().min(1), version: z.string().min(1),
  expert: z.object({ name: z.string(), version: z.string(), instructions: z.string() }).strict().nullable(),
  capabilityDigest: z.string().min(1).optional(),
}).strict()
const objectSchema = z.object({ id: z.string().min(1).transform(value => value as WorkbenchObjectId), label: z.string().min(1) }).strict()
/** Current projection accepts legacy whole-instance selections and explicit object bindings. */
export const selectionSchema = legacySelectionSchema.extend({ object: objectSchema.optional() }).strict().nullable()

const eventSchema = z.discriminatedUnion('schemaVersion', [
  z.object({ schemaVersion: z.literal(1), selection: legacySelectionSchema.nullable() }).strict(),
  z.object({ schemaVersion: z.literal(2), selection: legacySelectionSchema.extend({ object: objectSchema }).strict() }).strict(),
])

/** Native replay and wire projection; absence and explicit unlink both expose null. */
export const workbenchProjection = {
  key: 'actveroWorkbench', stateVersion: 2, stateSchema: selectionSchema,
  init: () => null,
  apply: (previous, event) => {
    if (event.type !== 'actvero/workbench') return previous
    return eventSchema.parse(event.data).selection
  },
  wire: { viewSchema: selectionSchema, view: state => state },
} satisfies ProjectionDefinition<'actveroWorkbench', WorkbenchSelection | null>
