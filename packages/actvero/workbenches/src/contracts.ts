/** Browser-safe package and project records for local workbenches. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable package-defined local workbench identifier. */
export type WorkbenchId = Branded<'ActveroWorkbenchId'>
/** UUID of a durable business record; independent of native Session identity. */
export type ProjectId = Branded<'ActveroWorkbenchProjectId'>
/** JSON-serializable business value. */
export type WorkbenchJsonValue = string | number | boolean | null | WorkbenchJsonValue[] | { [key: string]: WorkbenchJsonValue }
/** Provider-validated business data persisted by the local host. */
export type WorkbenchData = Record<string, WorkbenchJsonValue>
/** Presentation of the same business material and native conversation. */
export type WorkbenchView = 'business' | 'split' | 'conversation'
/** Validate an identifier received from package or wire metadata. */
export const workbenchIdSchema = z.string().regex(/^[a-z0-9@][a-z0-9@/._-]{1,150}$/).transform(value => brandString<WorkbenchId>(value))
/** Validate a business record UUID from durable or wire data. */
export const projectIdSchema = z.uuid().transform(value => brandString<ProjectId>(value))
/** Validate a native Session UUID in workbench associations. */
export const sessionIdSchema = z.uuid().transform(value => brandString<SessionId>(value))
/** Validate JSON-only business data before provider validation. */
export const dataSchema = z.record(z.string(), z.json())
/** Validate loaded provider metadata and visible catalog text. */
export const descriptorSchema = z.object({
  id: workbenchIdSchema,
  packageName: z.string().min(1).max(214),
  title: z.string().min(1).max(100),
  description: z.string().max(500),
  version: z.string().min(1).max(50),
  icon: z.enum(['canvas', 'files']),
  example: z.boolean(),
})
/** Loaded provider metadata displayed in the local catalog. */
export type WorkbenchDescriptor = z.infer<typeof descriptorSchema>
/** Versioned durable business material and its optimistic revision. */
export const projectSchema = z.object({
  id: projectIdSchema,
  workbenchId: workbenchIdSchema,
  title: z.string().min(1).max(150),
  data: dataSchema,
  revision: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
/** Local business material with a revision checked by every update. */
export type WorkbenchProject = z.infer<typeof projectSchema>
/** Durable many-to-one association of a native conversation with business material. */
export const conversationSchema = z.object({
  sessionId: sessionIdSchema,
  projectId: projectIdSchema,
  createdAt: z.iso.datetime(),
})
/** Native conversation associated with a business record. */
export type WorkbenchConversation = z.infer<typeof conversationSchema>
/** Versioned on-disk state; unsupported or corrupt data fails without replacement. */
export const stateSchema = z.object({
  schemaVersion: z.literal(1),
  projects: z.array(projectSchema).max(10000),
  conversations: z.array(conversationSchema).max(50000),
  favorites: z.array(workbenchIdSchema),
})
/** Durable business records, conversation associations and favorite identifiers. */
export type WorkbenchState = z.infer<typeof stateSchema>
/** Validate a host catalog response before renderer consumption. */
export const snapshotSchema = stateSchema.extend({
  definitions: z.array(descriptorSchema),
  storagePath: z.string(),
  refreshIntervalMs: z.int().positive(),
})
/** Loaded providers and durable state with the managed storage location. */
export type WorkbenchSnapshot = z.infer<typeof snapshotSchema>
/** Validate user or model commands before changing local state. */
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), workbenchId: workbenchIdSchema }),
  z.object({ action: z.literal('create'), workbenchId: workbenchIdSchema, title: z.string().trim().min(1).max(150) }),
  z.object({ action: z.literal('update'), projectId: projectIdSchema, revision: z.int().nonnegative(), data: dataSchema, title: z.string().trim().min(1).max(150).optional() }),
  z.object({ action: z.literal('conversation'), projectId: projectIdSchema }),
  z.object({ action: z.literal('favorite'), workbenchId: workbenchIdSchema }),
])
/** Validated business command accepted by the local runtime. */
export type WorkbenchAction = z.infer<typeof actionSchema>
/** Validate optional identifiers returned by a completed host action. */
export const actionResultSchema = z.object({
  projectId: projectIdSchema.optional(),
  sessionId: sessionIdSchema.optional(),
})
/** Identifiers produced by an acknowledged local action. */
export type WorkbenchActionResult = z.infer<typeof actionResultSchema>
/** Expected local failures; partial native conversation creation is never reported as applied. */
export class WorkbenchError extends Error {
  constructor(readonly code: 'invalid-state' | 'invalid-request' | 'unavailable' | 'conflict' | 'missing-project' | 'missing-directory' | 'conversation-failed' | 'binding-save-failed', options?: ErrorOptions) {
    super(code, options)
  }
}

/** Author-owned business state and instructions; registering never sends a model request. */
export interface WorkbenchProvider {
  descriptor: WorkbenchDescriptor
  initialData(): WorkbenchData
  validateData(data: WorkbenchData): WorkbenchData
  instructions: string
}
