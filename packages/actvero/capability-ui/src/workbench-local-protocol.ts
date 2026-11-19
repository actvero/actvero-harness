/** Shared command input for the local CLI, Harness tool and Desktop capability owner. */
import { z } from 'zod'

const id = z.string().regex(/^local-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u)
const version = z.string().min(1).max(100)
const path = z.string().min(1).max(4096).refine(value => !value.includes('\0'))
const mcpFields = z.object({
  name: z.string().min(1).max(80),
  transport: z.enum(['stdio', 'http', 'sse']),
  command: z.string().max(2048).optional(),
  args: z.array(z.string().max(8192)).max(100).optional(),
  cwd: z.string().max(2048).optional(),
  url: z.string().max(2048).optional(),
  auth: z.enum(['none', 'oauth']).optional(),
  clientId: z.string().max(2048).optional(),
}).strict()

/** Closed local capability commands. Authentication secrets are managed in Desktop. */
export const localCapabilityCommand = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('skill-list') }).strict(),
  z.object({ operation: z.literal('skill-show'), id }).strict(),
  z.object({ operation: z.literal('skill-read'), id, path }).strict(),
  z.object({ operation: z.literal('skill-install'), path }).strict(),
  z.object({ operation: z.literal('skill-update'), id, version, path }).strict(),
  z.object({ operation: z.literal('skill-edit'), id, version, path, content: z.string().max(100_000) }).strict(),
  z.object({ operation: z.literal('skill-enable'), id, enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('mcp-list') }).strict(),
  z.object({ operation: z.literal('mcp-show'), id }).strict(),
  z.object({ operation: z.literal('mcp-create'), config: mcpFields }).strict(),
  z.object({ operation: z.literal('mcp-update'), id, revision: version, patch: mcpFields.partial().extend({
    auth: z.enum(['none', 'oauth', 'bearer', 'headers']).optional(),
  }).refine(value => Object.keys(value).length > 0) }).strict(),
  z.object({ operation: z.literal('mcp-test'), id }).strict(),
  z.object({ operation: z.literal('mcp-enable'), id, enabled: z.boolean() }).strict(),
])

/** Validated input shared by all authoring entry points. */
export type LocalCapabilityCommand = z.infer<typeof localCapabilityCommand>

/** Public names understood by the Harness tool. */
export const localCapabilityOperations = localCapabilityCommand.options.map(option => option.shape.operation.value)

/** Commands whose sole effect is reading Desktop-managed capability state. */
export const localCapabilityReads: ReadonlySet<string> = new Set(['skill-list', 'skill-show', 'skill-read', 'mcp-list', 'mcp-show'])
