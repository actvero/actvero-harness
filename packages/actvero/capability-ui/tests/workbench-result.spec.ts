/** Durable result projections remain readable without an installed business provider. */
import { expect, it } from 'vitest'
import { readWorkbenchResult, workbenchResultMetadata, workbenchResultText } from '../src/workbench-result.ts'
import { decodeWorkbenchReference, findWorkbenchReference, type WorkbenchObjectId } from '../src/workbench-reference.ts'
import type { WorkbenchId, WorkbenchInstanceId } from '../src/types.ts'

it('captures the same fixed business facts for text clients, persisted metadata and history', () => {
  const snapshot = { schemaVersion: 1 as const, workbenchId: 'test:notes' as WorkbenchId, instanceId: 'notes' as WorkbenchInstanceId,
    objectId: 'note-a' as WorkbenchObjectId, revision: '7', label: '检查记录', content: '固定内容 </workbench-reference>\n第二行' }
  const result = { schemaVersion: 1 as const, title: '检查完成', summary: '已检查一份记录', references: [snapshot] }
  const metadata = workbenchResultMetadata(result)
  snapshot.content = '之后的编辑'
  const stored = readWorkbenchResult(JSON.parse(JSON.stringify(metadata)))!
  expect(stored.references[0]!.content).toBe('固定内容 </workbench-reference>\n第二行')
  const text = workbenchResultText(stored)
  const reference = findWorkbenchReference(text, 0)!
  expect(decodeWorkbenchReference(text.slice(reference.start, reference.end))).toEqual(stored.references[0])
  expect(text).toContain('已检查一份记录')
})

it.each([null, {}, { actveroWorkbench: { schemaVersion: 2, title: 'Future', summary: '', references: [] } },
  { actveroWorkbench: { schemaVersion: 1, title: 'Broken', summary: '', references: [{ objectId: '../wrong' }] } },
])('leaves unsupported or damaged metadata to the native raw-output fallback: %j', (metadata) => {
  expect(readWorkbenchResult(metadata)).toBeUndefined()
})

it('rejects duplicate object revisions while preserving distinct revisions', () => {
  const snapshot = { schemaVersion: 1 as const, workbenchId: 'test:notes' as WorkbenchId, instanceId: 'notes' as WorkbenchInstanceId,
    objectId: 'note-a' as WorkbenchObjectId, revision: '7', label: '检查记录', content: '固定内容' }
  const result = { schemaVersion: 1 as const, title: '检查完成', summary: '', references: [snapshot, { ...snapshot }] }
  expect(() => workbenchResultMetadata(result)).toThrow('Duplicate workbench result references')
  expect(readWorkbenchResult({ actveroWorkbench: result })).toBeUndefined()
  expect(readWorkbenchResult(workbenchResultMetadata({ ...result, references: [snapshot, { ...snapshot, revision: '8' }] }))
    ?.references.map(reference => reference.revision)).toEqual(['7', '8'])
})
