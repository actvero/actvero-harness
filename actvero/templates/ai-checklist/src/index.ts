/** Native business data and a conversation-scoped packaged expert. */
import type { Context } from '@deepseek-ai/cordis'
import { workbenchResultMetadata, workbenchResultText } from '@actvero/dsh-capability-ui'
import type { WorkbenchId, WorkbenchObjectId, WorkbenchCustomProvider, WorkbenchResult } from '@actvero/dsh-capability-ui'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { WorkbenchExpertBundle } from '@actvero/dsh-experts/workbench'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import manifest from '../package.json'
import metadata from '../workbench.json'
import { checklistDocument } from './document.ts'

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), args: z.object({ text: z.string().trim().min(1).max(2000) }).strict() }),
  z.object({ action: z.literal('complete'), args: z.object({ id: z.string(), completed: z.boolean() }).strict() }),
])
/** Services supplied by the local workbench framework. */
export const inject = ['actveroWorkbenchRuntime']
/** Register business behavior until this package is unloaded.
 * @param ctx Native plugin lifetime.
 */
export function apply(ctx: Context): void {
  const resourcesDirectory = fileURLToPath(new URL('../assets/', import.meta.url))
  const expert = new WorkbenchExpertBundle({ directory: resourcesDirectory })
  const provider: WorkbenchCustomProvider = {
    id: manifest.name as WorkbenchId, name: metadata.name, version: manifest.version, protocol: metadata.protocol,
    resourcesDirectory, ai: true, platform: ['models:read'],
    async resolveObject(id, environment, signal) {
      signal.throwIfAborted()
      const document = ctx.actveroWorkbenchRuntime.read(environment)
      if (id === 'checklist') return { label: metadata.name }
      const item = checklistDocument.parse(JSON.parse(document.json)).items.find(item => item.id === id)
      if (!item) throw new Error('Task no longer exists')
      return { label: item.text }
    },
    async activate(scope, environment, signal) {
      const activation = await expert.activate(scope, environment, signal)
      const result = (raw: string): WorkbenchResult => {
        const saved = z.object({ revision: z.number(), json: z.string() }).parse(JSON.parse(raw))
        const json = saved.json
        const document = checklistDocument.parse(JSON.parse(json))
        const item = environment.object && document.items.find(item => item.id === environment.object?.id)
        if (environment.object && environment.object.id !== 'checklist' && !item) throw new Error('Task no longer exists')
        return { schemaVersion: 1, title: item?.text ?? metadata.name,
          summary: item ? `${item.completed ? '已完成' : '未完成'}：${item.text}` : `${document.items.filter(item => item.completed).length} / ${document.items.length}`,
          references: [{ schemaVersion: 1, workbenchId: environment.id, instanceId: environment.instanceId,
            objectId: environment.object?.id ?? 'checklist' as WorkbenchObjectId, label: item?.text ?? metadata.name,
            revision: String(saved.revision), content: item ? JSON.stringify(item) : json }] }
      }
      scope.tools.register(defineTool({ name: 'checklist_review', description: 'Read the checklist or the conversation-bound task and return a durable summary with an object link.',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, json: string) => [{ type: 'text', text: workbenchResultText(result(json)) }],
          presentationMeta: (_args, json: string) => workbenchResultMetadata(result(json)) },
        execute: async () => JSON.stringify(ctx.actveroWorkbenchRuntime.read(environment)),
      }))
      return activation
    },
    storage: {
      initial: () => JSON.stringify({ items: [{ id: 'scope', text: '确认需求和交付范围', completed: false }] }),
      actionHelp: 'add args={"text":"task"}; complete args={"id":"id from read","completed":true|false}. Read current revision before writing.',
      reduce(json, action, raw) {
        const state = checklistDocument.parse(JSON.parse(json))
        const input = actions.parse({ action, args: JSON.parse(raw) })
        if (input.action === 'add') {
          if (state.items.length >= 1000) throw new Error('Checklist full')
          state.items.push({ id: randomUUID(), text: input.args.text, completed: false })
        } else {
          const row = state.items.find(item => item.id === input.args.id)
          if (!row) throw new Error('Task no longer exists; read again')
          row.completed = input.args.completed
        }
        return JSON.stringify(state)
      },
    },
  }
  ctx.effect(() => ctx.actveroWorkbenchRuntime.register(provider))
}
