import { z } from 'zod'
import { fail } from './schema.ts'

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const dependency = z.object({ id, digest: sha }).strict()
const schema = z.object({
  schemaVersion: z.literal(1), sourceId: id, version: z.string().regex(/^\d+\.\d+\.\d+$/).max(30),
  digest: sha, snapshot: sha,
  dependencies: z.object({ skills: z.record(id, dependency), connectors: z.record(id, dependency) }).strict(),
}).strict()
/** Main-only source record, stored atomically beside the local expert, never in conversation snapshots. */
export type PackageOrigin = z.infer<typeof schema>
/** Validate persisted package ownership before allowing a later import to replace resources. */
export function parsePackageOrigin(value: unknown): PackageOrigin {
  const result = schema.safeParse(value)
  if (!result.success) fail('expert_package_invalid')
  return result.data
}
