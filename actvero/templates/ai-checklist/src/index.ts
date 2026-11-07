/** Native business data and a conversation-scoped packaged expert. */
import type { Context } from '@deepseek-ai/cordis'
import type { WorkbenchId, WorkbenchCustomProvider } from '@actvero/dsh-capability-ui'
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
    id: manifest.name as WorkbenchId, name: metadata.name, version: manifest.version,
    resourcesDirectory, ai: true, activate: expert.activate, platform: ['models:read'],
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
