/** Session-log validation and replay for the selected workbench environment. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { WorkbenchId, WorkbenchInstanceId, WorkbenchSelection } from './types.ts'

/** Validates persisted provider IDs, including the built-in checklist. */
export const workbenchIdSchema = z.string().regex(/^[a-z0-9@][a-z0-9@/._:-]{0,213}$/).transform(value => value as WorkbenchId)
/** Validates host-created instance IDs. */
export const instanceIdSchema = z.uuid().transform(value => value as WorkbenchInstanceId)
/** Exact environment restored from the Session log. */
export const selectionSchema = z.object({
  id: workbenchIdSchema, instanceId: instanceIdSchema, name: z.string().min(1), version: z.string().min(1),
  expert: z.object({ name: z.string(), version: z.string(), instructions: z.string() }).strict().nullable(),
}).strict().nullable()

const eventSchema = z.object({ schemaVersion: z.literal(1), selection: selectionSchema }).strict()

/** Native replay and wire projection; absence and explicit unlink both expose null. */
export const workbenchProjection = {
  key: 'actveroWorkbench', stateVersion: 1, stateSchema: selectionSchema,
  init: () => null,
  apply: (previous, event) => {
    if (event.type !== 'actvero/workbench') return previous
    return eventSchema.parse(event.data).selection
  },
  wire: { viewSchema: selectionSchema, view: state => state },
} satisfies ProjectionDefinition<'actveroWorkbench', WorkbenchSelection | null>
