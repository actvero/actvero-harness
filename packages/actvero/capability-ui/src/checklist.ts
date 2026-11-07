/** Built-in checklist behavior shared by human controls and conversation tools. */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkbenchProvider } from './workbench-provider.ts'
import type { WorkbenchId } from './types.ts'
import { checklistDocument } from './checklist-data.ts'

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), args: z.object({ text: z.string().trim().min(1).max(2000) }).strict() }),
  z.object({ action: z.literal('complete'), args: z.object({ id: z.string(), completed: z.boolean() }).strict() }),
  z.object({ action: z.literal('import-legacy'), args: z.object({ completed: z.array(z.enum(['sampleItem1', 'sampleItem2', 'sampleItem3'])) }).strict() }),
])

/** Optional local expert and versioned checklist actions. */
export const checklistProvider: WorkbenchProvider = {
  id: 'builtin:project-checklist' as WorkbenchId,
  name: '项目清单', version: '1.0.0',
  expert: { name: '项目清单助手', version: '1.0.0', instructions: '帮助用户整理待办、补充任务、更新完成状态。先读取项目清单，仅在用户要求时修改。准确报告工具结果；遇到并发修改先重新读取，不要覆盖用户的手动操作。' },
  actionHelp: 'Actions: add args={"text":"task description"}; complete args={"id":"item id from read","completed":true or false}. Read returns json (business document with items) and revision. import-legacy is reserved for initial UI migration.',
  initial: () => JSON.stringify({ items: [
    { id: 'sampleItem1', text: '确认需求和交付范围', completed: false },
    { id: 'sampleItem2', text: '整理项目资料', completed: false },
    { id: 'sampleItem3', text: '检查交付内容', completed: false },
  ], legacyImported: false }),
  reduce(json, action, raw) {
    const state = checklistDocument.parse(JSON.parse(json))
    let args: unknown
    try { args = JSON.parse(raw) } catch (_error) { throw new RemoteError('workbench/invalid-action', 'Action arguments must be JSON.', {}) }
    const parsed = actions.safeParse({ action, args })
    if (!parsed.success) throw new RemoteError('workbench/invalid-action', 'Unsupported checklist action or arguments.', {})
    const input = parsed.data
    switch (input.action) {
      case 'add': {
        if (state.items.length >= 1000) throw new RemoteError('workbench/invalid-action', 'The checklist is full.', {})
        return JSON.stringify({ ...state, items: [...state.items, { id: randomUUID(), text: input.args.text, completed: false }] })
      }
      case 'complete': {
        if (!state.items.some(row => row.id === input.args.id)) throw new RemoteError('workbench/invalid-action', 'Checklist item no longer exists.', {})
        return JSON.stringify({ ...state,
          items: state.items.map(row => row.id === input.args.id ? { ...row, completed: input.args.completed } : row),
        })
      }
      case 'import-legacy': return JSON.stringify(state.legacyImported ? state : { ...state, legacyImported: true,
        items: state.items.map(row => ({ ...row, completed: row.completed || input.args.completed.some(id => id === row.id) })) })
    }
  },
}
