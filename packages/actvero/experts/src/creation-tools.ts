import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

type AuthorAction = 'catalog' | 'create' | 'author-list' | 'author-get' | 'author-update' | 'author-check'
const maxConfiguration = 700_000
const idField = { type: 'string', maxLength: 80, description: 'Exact local expert ID from expert_list.' } as const
const output: ToolDefinition['output'] = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
}

function argsRecord(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !allowed.includes(key))) throw new Error('expert_invalid')
  return input as Record<string, unknown>
}

function readId(input: unknown): string {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(input)) throw new Error('expert_invalid')
  return input
}

function readJson(input: unknown): unknown {
  if (typeof input !== 'string' || input.length > maxConfiguration) throw new Error('expert_invalid')
  try {
    return JSON.parse(input)
  } catch (error) {
    throw new Error('expert_invalid', { cause: error })
  }
}

/**
 * Expose local expert authoring through the Desktop operation gateway.
 * @param request - closed local operations implemented by the expert store.
 * @returns model tool declarations with validated request arguments.
 */
export function creationTools(request: (action: AuthorAction, input: Record<string, unknown>) => Promise<unknown>) {
  const run = async (action: AuthorAction, input: Record<string, unknown>) => JSON.stringify(await request(action, input))
  return [
    {
      name: 'expert_catalog',
      description: 'List exact IDs of installed skills and configured MCP connections for local expert bindings. Does not connect or install anything.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output,
      async execute(input) {
        argsRecord(input, [])
        return run('catalog', {})
      },
    },
    {
      name: 'expert_create',
      description: 'Save a new local ACTVERO expert designed with the user. Load expert-creator before authoring. A role name alone is not a design brief: ask about missing work context, inputs and expected results, then wait for the answer before saving. Use an already complete or agreed plan without repeating questions. Tool success confirms saving only; expert_check checks dependencies, not task quality.',
      parameters: {
        type: 'object',
        properties: {
          configuration: { type: 'string', maxLength: maxConfiguration, description: 'JSON with manifest and bindings based on the user’s understood requirements. Dependency IDs come from expert_catalog.' },
        },
        required: ['configuration'],
        additionalProperties: false,
      },
      output,
      async execute(input) {
        const { configuration } = argsRecord(input, ['configuration'])
        return run('create', { expert: readJson(configuration) })
      },
    },
    {
      name: 'expert_list',
      description: 'Find local experts by name, description or ID. Returns at most 50 identities and their revisions per page.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', maxLength: 120 }, page: { type: 'integer', minimum: 1, maximum: 10000 } },
        additionalProperties: false,
      },
      output,
      async execute(input) {
        const { query, page } = argsRecord(input, ['query', 'page'])
        if (query !== undefined && (typeof query !== 'string' || query.length > 120)) throw new Error('expert_invalid')
        if (page !== undefined && (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1 || page > 10000)) {
          throw new Error('expert_invalid')
        }
        return run('author-list', { ...(query === undefined ? {} : { query }), ...(page === undefined ? {} : { page }) })
      },
    },
    {
      name: 'expert_get',
      description: 'Read one local expert, its bindings and current revision. Portrait contents are omitted.',
      parameters: { type: 'object', properties: { id: idField }, required: ['id'], additionalProperties: false },
      output,
      async execute(input) {
        return run('author-get', { id: readId(argsRecord(input, ['id']).id) })
      },
    },
    {
      name: 'expert_update',
      description: 'Revise an existing local expert for the user’s requested change. Follow expert-creator, read expert_get and use its current revision. Ask and wait when the intended improvement is unclear; apply an already clear change without another interview. Omitted fields are preserved. expert_check verifies dependencies, not task quality.',
      parameters: {
        type: 'object',
        properties: {
          id: idField,
          revision: { type: 'integer', minimum: 1, description: 'Current revision returned by expert_get.' },
          changes: { type: 'string', maxLength: maxConfiguration, description: 'JSON patch with editable manifest fields and/or bindings. Supplied arrays and each supplied binding map replace their previous values.' },
        },
        required: ['id', 'revision', 'changes'],
        additionalProperties: false,
      },
      output,
      async execute(input) {
        const { id, revision, changes } = argsRecord(input, ['id', 'revision', 'changes'])
        if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) throw new Error('expert_invalid')
        return run('author-update', { id: readId(id), revision, patch: readJson(changes) })
      },
    },
    {
      name: 'expert_check',
      description: 'Check whether a local expert’s saved skill and MCP dependencies are ready. Does not run the expert.',
      parameters: { type: 'object', properties: { id: idField }, required: ['id'], additionalProperties: false },
      output,
      async execute(input) {
        return run('author-check', { id: readId(argsRecord(input, ['id']).id) })
      },
    },
  ] satisfies ToolDefinition[]
}
