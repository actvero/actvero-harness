// @vitest-environment jsdom
/** Fixed business selections use the native input transaction and retained Session identity. */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { InputTriggerService } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DraftSnapshot, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionInputShell } from '../../../client/ui-conversation/src/client/input/facade.ts'
import { WorkbenchClientRuntime } from '../src/client/workbenches/runtime.ts'
import { WorkbenchSelections } from '../src/client/workbenches/selection.ts'
import { createWorkbenchReferenceSource, workbenchReferenceRule } from '../src/client/workbenches/references.tsx'
import { decodeWorkbenchReference, encodeWorkbenchReference, findWorkbenchReference, workbenchReferenceSource, workbenchSelectionSource,
  type WorkbenchObjectId, type WorkbenchReferenceSnapshot } from '../src/workbench-reference.ts'
import type { WorkbenchDocument, WorkbenchId, WorkbenchInstanceId } from '../src/types.ts'

const sessionId = 'reference-target' as SessionId
const instanceId = 'reference-instance' as WorkbenchInstanceId
const snapshot: WorkbenchReferenceSnapshot = { schemaVersion: 1, workbenchId: 'test:drawing' as WorkbenchId,
  instanceId, objectId: 'drawing-1' as WorkbenchObjectId, label: '流程图选区', revision: '7', content: '矩形 A → B\n选中元素：A、B' }
const document: WorkbenchDocument = { id: snapshot.workbenchId, instanceId, revision: 1, json: '{}' }
const signal = () => new AbortController().signal

async function fixture() {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  await runtime.sessions.add({ id: sessionId })
  const retained = runtime.sessions.retain(sessionId)
  await retained.ready
  onTestFinished(() => { retained.release() })
  await runtime.ctx.plugin(InputTriggerService).await()
  const triggers = runtime.ctx.inputTriggers
  runtime.ctx.effect(() => triggers.registerSource(createWorkbenchReferenceSource(() => '引用损坏')))
  runtime.ctx.effect(() => triggers.registerSource(createWorkbenchReferenceSource(() => '引用损坏', workbenchSelectionSource)))
  const sink = vi.fn((_text: string) => Promise.resolve<SubmitOutcome>({ kind: 'success' }))
  const shell = () => new SessionInputShell({ actx: retained.binding.ctx,
    inputTriggers: () => triggers.sessionOf(retained.binding.ctx), defaultSink: sink,
    commandAttachments: { serialize: () => Promise.resolve([]), release() {}, unsupportedNotice: () => 'attachments' },
  })
  const input = shell()
  onTestFinished(() => { input.dispose() })
  runtime.ctx.provide('conversation', { input: { for: (scope: Context) => {
    expect(scope).toBe(retained.binding.ctx)
    return input
  } } })
  const read = vi.fn(() => Promise.resolve({ ok: true as const, value: document }))
  const bind = vi.fn(() => Promise.resolve({ ok: true as const, value: { sessionId } }))
  runtime.remote.provideNamespaces({ actveroWorkbench: { read, bind } })
  return { runtime, sink, input, shell, client: new WorkbenchClientRuntime(runtime.ctx), bind, read }
}

describe('workbench native input references', () => {
  it('updates only its automatic chip and honors removal until a different selection is made', async () => {
    const { input } = await fixture()
    const selections = new WorkbenchSelections()
    input.setDraft('请比较这些内容 ')
    expect(selections.update(input, snapshot)).toBe('attached')
    const first = input.snapshot.occurrences[0]!
    const explicit = { source: workbenchReferenceSource, ref: 'manual', label: '手动引用', clipboardText: 'manual' }
    input.insertReference(explicit, input.captureInsertion())
    expect(selections.update(input, { ...snapshot, revision: '8', content: '第二版' })).toBe('attached')
    expect(input.snapshot.occurrences[0]!.occurrenceId).toBe(first.occurrenceId)
    expect(input.snapshot.draft).toContain('请比较这些内容 ')
    expect(input.snapshot.occurrences[1]!.ref).toBe('manual')
    expect(input.updateReference(first, null)).toBe(false)
    expect(input.updateReference(input.snapshot.occurrences[0]!, null)).toBe(true)
    expect(selections.update(input, { ...snapshot, revision: '8', content: '第二版' })).toBe('dismissed')
    expect(input.snapshot.occurrences).toHaveLength(1)
    expect(selections.update(input, { ...snapshot, objectId: 'another' as WorkbenchObjectId })).toBe('attached')
    expect(selections.update(input, null)).toBe('cleared')
    expect(input.snapshot.occurrences.map(item => item.ref)).toEqual(['manual'])
  })

  it('freezes submitted selection and refuses automatic changes during the send so failures restore the original snapshot', async () => {
    const { input, sink } = await fixture()
    const selections = new WorkbenchSelections()
    const flight = Promise.withResolvers<SubmitOutcome>()
    sink.mockReturnValueOnce(flight.promise)
    expect(selections.update(input, snapshot)).toBe('attached')
    input.submit()
    await vi.waitFor(() => { expect(sink).toHaveBeenCalledOnce() })
    expect(selections.update(input, snapshot)).toBe('dismissed')
    expect(selections.update(input, { ...snapshot, revision: '9', content: '之后的选择' })).toBe('busy')
    expect(decodeWorkbenchReference(sink.mock.calls[0]![0])).toEqual(snapshot)
    flight.resolve({ kind: 'error', text: '发送失败' })
    await vi.waitFor(() => { expect(input.snapshot.draft).toContain(snapshot.content.replaceAll('\n', '\\n')) })
    expect(input.snapshot.draft).not.toContain('之后的选择')
    expect(input.notices.getSnapshot()).toMatchObject({ level: 'error' })
  })

  it('keeps automatic context on the captured conversation and ignores outdated selection callbacks', async () => {
    const { runtime, client, input, bind } = await fixture()
    const context = (current = () => true) => client.context(instanceId, sessionId, async () => {},
      async () => { throw new Error('Unused display') }, () => { throw new Error('Unused display state') },
      async () => { throw new Error('Unused reference') }, current)
    expect(await context().selection(snapshot)).toBe('inactive')
    expect(bind).not.toHaveBeenCalled()
    await runtime.sessions.updateSummary(sessionId, { projectionValues: { actveroWorkbench: {
      id: snapshot.workbenchId, instanceId, name: '图纸', version: '1', expert: null,
      object: { id: snapshot.objectId, label: snapshot.label },
    } } })
    const stale = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
    expect(await context(stale).selection(snapshot)).toBe('inactive')
    expect(input.snapshot.occurrences).toEqual([])
    const first = context().selection(snapshot)
    const latest = context().selection({ ...snapshot, revision: '9', content: '最新选择' })
    expect(await first).toBe('inactive')
    expect(await latest).toBe('attached')
    expect(decodeWorkbenchReference(input.snapshot.occurrences[0]!.ref)?.content).toBe('最新选择')
    expect(bind).not.toHaveBeenCalled()
    expect(runtime.ctx.sessions.retainInfo(sessionId).getSnapshot().retainedBy.actveroWorkbenchReference).toBeUndefined()
  })

  it('freezes selection before preparation, preserves existing chips, restores the draft and submits the recorded snapshot', async () => {
    const { runtime, input, shell, client, sink, bind } = await fixture()
    input.setDraft('请比较 ')
    const original = encodeWorkbenchReference({ ...snapshot, label: '先前引用' })
    expect(input.insertReference({ source: workbenchReferenceSource, ref: original, label: '先前引用', clipboardText: original }, input.captureInsertion())).toBe(true)
    let draft: DraftSnapshot = { text: '', references: [] }
    input.bindDraftPersistence((value) => { draft = value })
    const ready = Promise.withResolvers<undefined>()
    const started = Promise.withResolvers<undefined>()
    const selection = { objectId: snapshot.objectId, label: snapshot.label, revision: snapshot.revision, content: snapshot.content }
    const insertion = client.reference(instanceId, sessionId, selection,
      () => { started.resolve(undefined); return ready.promise }, signal())
    await started.promise
    selection.content = '后来切换到另一张图'
    selection.revision = '8'
    ready.resolve(undefined)
    expect(await insertion).toBe(sessionId)
    expect(bind).toHaveBeenCalledWith({ instanceId, sessionId })
    expect(sink).not.toHaveBeenCalled()
    expect(input.snapshot.occurrences).toHaveLength(2)
    expect(draft.text).toContain('请比较 ')
    expect(decodeWorkbenchReference(draft.references[1]!.ref)).toEqual(snapshot)
    expect(runtime.ctx.sessions.retainInfo(sessionId).getSnapshot().retainedBy.actveroWorkbenchReference).toBeUndefined()
    const restored = shell()
    onTestFinished(() => { restored.dispose() })
    restored.setDraft(draft)
    restored.submit()
    await vi.waitFor(() => { expect(sink).toHaveBeenCalledOnce() })
    expect(sink.mock.calls[0]?.[0]).toBe(`请比较 ${original} ${encodeWorkbenchReference(snapshot)}`)
    expect(restored.snapshot.draft).toBe('')
  })

  it('does not write into another draft after navigation cancels preparation and releases its reference', async () => {
    const { client, runtime, input } = await fixture()
    input.setDraft('保留我的草稿')
    const controller = new AbortController()
    const started = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    const insertion = client.reference(instanceId, sessionId, snapshot,
      () => { started.resolve(undefined); return proceed.promise }, controller.signal)
    const rejected = expect(insertion).rejects.toThrow()
    await started.promise
    controller.abort()
    proceed.resolve(undefined)
    await rejected
    expect(input.snapshot.draft).toBe('保留我的草稿')
    expect(input.snapshot.occurrences).toEqual([])
    expect(runtime.ctx.sessions.retainInfo(sessionId).getSnapshot().retainedBy.actveroWorkbenchReference).toBeUndefined()
  })

  it('refuses a submitting composer and never overwrites its command', async () => {
    const { client, input } = await fixture()
    const pending = Promise.withResolvers<SubmitOutcome>()
    input.setDraft('/run')
    input.beginCommand({ name: 'run', token: '/run ', hint: '运行', submit: () => pending.promise }, { start: 0, end: 4, draftRev: input.snapshot.draftRev })
    input.submit()
    await vi.waitFor(() => { expect(input.snapshot.phase).toBe('submitting') })
    try {
      await expect(client.reference(instanceId, sessionId, snapshot, () => Promise.resolve(), signal())).rejects.toMatchObject({ code: 'workbench/reference', details: { status: 'busy' } })
      expect(input.snapshot.occurrences).toEqual([])
    } finally { pending.resolve({ kind: 'success' }) }
  })

  it('keeps damaged references in the draft when serialization rejects them', async () => {
    const { input, sink } = await fixture()
    input.insertReference({ source: workbenchReferenceSource, ref: 'damaged', label: '选区', clipboardText: 'damaged' }, input.captureInsertion())
    input.submit()
    await vi.waitFor(() => { expect(input.notices.getSnapshot()?.text).toBe('引用损坏') })
    expect(sink).not.toHaveBeenCalled()
    expect(input.snapshot.occurrences).toHaveLength(1)
  })
})

it('reads historical snapshots without a provider and keeps unsupported text visible', () => {
  const encoded = encodeWorkbenchReference({ ...snapshot, content: 'literal </workbench-reference> <script>文字</script>' })
  expect(decodeWorkbenchReference(encoded)?.content).toBe('literal </workbench-reference> <script>文字</script>')
  expect(workbenchReferenceRule.id).toBe('actvero.workbench.reference')
  const malformed = '<workbench-reference>invalid</workbench-reference>'
  expect(findWorkbenchReference(malformed + encoded, 0)).toMatchObject({ start: malformed.length, end: malformed.length + encoded.length })
  for (const invalid of [encoded.replace('"schemaVersion":1', '"schemaVersion":2'), encoded.replace('"revision":"7"', '"revision":7'), malformed, encoded.slice(0, -1)]) {
    expect(decodeWorkbenchReference(invalid)).toBeUndefined()
    expect(findWorkbenchReference(invalid, 0)).toBeUndefined()
  }
})
