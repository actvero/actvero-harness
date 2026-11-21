import { z } from 'zod'
import { MAX_EXPERT_SELECTION_AVATAR_CHARS } from './avatar.ts'
import { expertCategories } from './categories.ts'
import type { Bindings, DependencyCatalog } from './contracts.ts'

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).describe('Exact installed ID from expert_catalog.')
const dependency = z.object({ id, required: z.boolean().optional().describe('Defaults to true.') }).strict()
const field = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\0]*$/u)
const draftSchema = z.object({
  name: field(80),
  description: field(500),
  instructions: field(64_000).describe('Complete agreed expert prompt.'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).max(30).optional().describe('Initial release, defaults to 1.0.0.'),
  avatarPath: field(4096).optional().describe('Path to the agreed PNG, JPEG or WebP in the conversation filesystem. Omit for the default portrait.'),
  category: z.enum(expertCategories).optional(),
  tags: z.array(field(30)).max(8).optional(),
  conversationStarters: z.array(field(1000)).max(6).optional(),
  skills: z.array(dependency.extend({ load: z.enum(['always', 'on_demand']).describe('always for the core workflow, on_demand for optional reading.') })).max(32).optional(),
  connectors: z.array(dependency).max(32).optional().describe('MCP connections used by the finished expert.'),
}).strict()

/** Model-facing inputs and their runtime validation come from the same definition. */
export const createExpertParameters = z.toJSONSchema(draftSchema, { target: 'draft-7' })

/** Convert a bounded, recognized local portrait into the manifest value.
 * @param bytes - Contents of the file selected for the expert.
 * @returns An inline image accepted by the expert manifest.
 */
function portraitData(bytes: Uint8Array): string {
  const data = Buffer.from(bytes)
  let type: string
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) type = 'png'
  else if (data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) type = 'jpeg'
  else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') type = 'webp'
  else throw new Error('avatarPath: expected a PNG, JPEG or WebP image')
  const url = 'data:image/' + type + ';base64,' + data.toString('base64')
  if (url.length > MAX_EXPERT_SELECTION_AVATAR_CHARS) throw new Error('avatarPath: resize the image before saving')
  return url
}

/** Resolve installed dependencies before saving a native creation request.
 * @param input - Model-supplied business fields.
 * @param catalog - Read the local catalog only for drafts with dependencies.
 * @param readPortrait - Read the supplied path through the current conversation's filesystem.
 * @returns Manifest and bindings for the existing Desktop create operation.
 */
export async function createExpertInput(
  input: unknown,
  catalog: () => Promise<DependencyCatalog>,
  readPortrait: (path: string) => Promise<Uint8Array>,
) {
  const parsed = draftSchema.safeParse(input)
  if (!parsed.success) throw new Error('expert_invalid: ' + parsed.error.issues.map(issue =>
    (issue.path.join('.') || 'expert_create') + ': ' + issue.message).join('; '))
  const { avatarPath, skills = [], connectors = [], version = '1.0.0', ...fields } = parsed.data
  const available = skills.length || connectors.length ? await catalog() : { skills: [], connectors: [] }
  const bindings: Bindings = { skills: {}, connectors: {} }
  function bind(kind: keyof DependencyCatalog, row: z.infer<typeof dependency>, index: number) {
    const path = `${kind}[${index}].id`
    const option = available[kind].find(entry => entry.id === row.id)
    if (!option) throw new Error(path + ': unknown ID, choose an installed entry from expert_catalog')
    if (Object.values(bindings[kind]).includes(row.id)) throw new Error(path + ': duplicate installed ID')
    const key = `${kind === 'skills' ? 'skill' : 'mcp'}-${index + 1}`
    bindings[kind][key] = row.id
    return { key, label: option.name, required: row.required ?? true }
  }
  const manifest = { ...fields, schemaVersion: 1, version,
    skills: skills.map((row, index) => ({ ...bind('skills', row, index), load: row.load })),
    connectors: connectors.map((row, index) => bind('connectors', row, index)),
    ...(avatarPath ? { avatar: portraitData(await readPortrait(avatarPath)) } : {}),
  }
  return { manifest, bindings }
}
