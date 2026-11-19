/** Request and response fields for local expert authoring through the development connection. */
import { z } from 'zod'
import { MAX_EXPERT_SELECTION_AVATAR_CHARS } from '../packages/actvero/experts/src/avatar.ts'
import { expertCategories } from '../packages/actvero/experts/src/categories.ts'

const id = z.string().min(1).max(80).regex(/^(?!(?:__proto__|constructor|prototype)$)[a-zA-Z0-9_-]+$/u)
const localId = id.refine(value => !value.startsWith('remote-')).describe('从 expert author-list 取得的本机专家 ID。')
const revision = z.number().int().min(1)
const line = (max: number) => z.string().min(1).max(max).refine(value => !!value.trim() && !value.includes('\0'))
const requirement = z.strictObject({ key: id, label: line(120), required: z.boolean() })
const bindingMap = z.record(id, id)
const bindings = z.strictObject({ skills: bindingMap.optional(), connectors: bindingMap.optional() })
const manifestFields = z.strictObject({
  name: line(80), description: line(500), instructions: line(64_000),
  avatar: z.string().max(MAX_EXPERT_SELECTION_AVATAR_CHARS)
    .regex(/^(?:data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*|)$/u).optional(),
  category: z.enum(expertCategories).optional(), tags: z.array(line(30)).max(8).optional(),
  conversationStarters: z.array(line(1000)).max(6).optional(),
  skills: z.array(requirement.extend({ load: z.enum(['always', 'on_demand']) })).max(32).optional(),
  connectors: z.array(requirement).max(32).optional(),
})
const version = z.string().max(30).regex(/^\d+\.\d+\.\d+$/u)
const manifest = manifestFields.extend({ schemaVersion: z.literal(1), version })
const storedManifest = manifest.extend({ id })
const resultBindings = z.looseObject({ skills: bindingMap, connectors: bindingMap })
const summary = z.looseObject({ id, name: z.string(), description: z.string(), version, revision })
const dependency = z.looseObject({ id, name: z.string(), description: z.string(), ready: z.boolean() })

/** Local expert requests accepted by the CLI. The owning store checks current revisions and dependency IDs. */
export const expertCliInputs = {
  catalog: z.strictObject({}),
  'author-list': z.strictObject({ query: z.string().max(120).optional(), page: z.number().int().min(1).max(10_000).optional() }),
  'author-get': z.strictObject({ id: localId }),
  create: z.strictObject({ expert: z.strictObject({
    // The host assigns both values. Older callers may still send their original create payload.
    manifest: manifest.extend({ id: id.optional() }),
    bindings,
    revision: z.number().int().nonnegative().optional(),
  }) }),
  'author-update': z.strictObject({ id: localId, revision, patch: z.strictObject({
    manifest: manifestFields.partial().optional(),
    bindings: bindings.optional(),
  }).refine(value => !!(Object.keys(value.manifest ?? {}).length || Object.keys(value.bindings ?? {}).length),
    '至少提供一个要修改的字段。') }),
  'author-check': z.strictObject({ id: localId }),
}

/** Results returned by the local expert owner, excluding inline avatars from author-get. */
export const expertCliOutputs = {
  catalog: z.looseObject({ skills: z.array(dependency), connectors: z.array(dependency) }),
  'author-list': z.looseObject({ items: z.array(summary), total: z.number().int().nonnegative() }),
  'author-get': z.looseObject({ manifest: storedManifest.omit({ avatar: true }), bindings: resultBindings, revision, hasAvatar: z.boolean() }),
  create: z.looseObject({ manifest: storedManifest, bindings: resultBindings, revision }),
  'author-update': summary,
  'author-check': z.looseObject({ ready: z.boolean(), warnings: z.array(z.string()), missing: z.array(z.string()) }),
}
