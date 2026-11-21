/** 保存新闻稿专家后，通过真实 Host 召唤到独立会话，检查发给模型的材料。 */
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import * as ExpertHost from '@actvero/dsh-experts'
import { Experts } from '@actvero/dsh-experts/main'
import type { DependencyCatalog, ExpertAuthorDetail, ExpertSelection } from '@actvero/dsh-experts/contracts'
import type { CapabilityHostMessage } from '../../desktop/src/actvero/capability-ipc.ts'
import { launchWebScaffold } from './scaffold.ts'

const skillContent = '编辑 SOP：先列提纲，保留报名与签到的数字口径，确认后才写成稿。'
const instructions = '你是活动新闻编辑。按编辑 SOP 交付。'
const portrait = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rCkAAAAASUVORK5CYII='
const provider = 'newsroom-fixture'

class EditorFixture extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override async listModels() { return [{ provider, id: 'fixture', name: 'Fixture' }] }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const confirmed = JSON.stringify(options.messages).includes('确认提纲，请成稿')
    const text = confirmed ? '社区开放日共有 120 人报名、96 人签到。' : '提纲：社区开放日；报名 120 人，签到 96 人。请确认提纲。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it('creates and summons a local expert with its saved portrait and always-loaded newsroom Skill', async () => {
  const scaffold = await launchWebScaffold()
  const { ctx, workspaceCwd } = scaffold
  const originalSend = Object.getOwnPropertyDescriptor(process, 'send')
  const selection = Promise.withResolvers<{ sessionId: string; selection: ExpertSelection }>()
  try {
    const engine = new Experts({
      root: join(workspaceCwd, 'experts'), scope: () => 'local', changed() {}, connectors: async () => [],
      skills: {
        hostList: async () => [{ id: 'local-news', name: 'newsroom', description: '编辑 SOP', versionId: 'v1' }],
        hostGet: async (id, version) => id === 'local-news' && version === 'v1' ? {
          name: 'newsroom', description: '编辑 SOP', content: skillContent, provider: 'actvero-skills', source: 'actvero',
          invocation: { modelInvocable: true, userInvocable: true },
        } : undefined,
      },
    })
    Object.defineProperty(process, 'send', { configurable: true, value: (m: CapabilityHostMessage) => {
      if (m.type === 'actvero:experts:controlled') {
        if (m.error) selection.reject(new Error(m.error))
        else selection.resolve(m.value as Awaited<typeof selection.promise>)
      } else if (m.type === 'actvero:experts:request') {
        const value = m.action === 'activate' ? Promise.resolve(null) : m.action === 'connector-state'
          ? Promise.resolve({ added: [], enabled: [], ready: [], rows: [] }) : engine.dispatch(m.action, m.input)
        void value.then(value => process.emit('message', { type: 'actvero:experts:result', id: m.id, value }, undefined),
          (error: unknown) => process.emit('message', { type: 'actvero:experts:result', id: m.id, error: error instanceof Error ? error.message : 'expert_test_error' }, undefined))
      }
      return true
    } })
    ctx.provide('actveroMcp', { async refresh() {}, ids: () => [], names: () => [], owns: () => false })
    await ctx.plugin(ExpertHost)
    const model = new EditorFixture()
    ctx.effect(() => ctx.llm.registerAdapter([provider], model))
    await ctx.agentDefaultModel.saveSelection({ provider, model: 'fixture' })
    const author = await ctx.sessionController.create({ cwd: workspaceCwd })
    const call = async <T = unknown>(name: string, args: Record<string, unknown>) => {
      const result = await ctx.tools.execute({ name, arguments: args, agent: ctx.agents.get(author.sessionId)!,
        callId: ToolCallId(randomUUID()), signal: new AbortController().signal })
      if (result.isError) throw new Error(result.error.message)
      if (typeof result.value !== 'string') throw new Error('Expected a JSON text result')
      return JSON.parse(result.value) as T
    }
    await writeFile(join(workspaceCwd, 'editor.png'), Buffer.from(portrait, 'base64'))
    const catalog = await call<DependencyCatalog>('expert_catalog', {})
    const created = await call<ExpertAuthorDetail>('expert_create', {
      name: '新闻稿编辑', description: '整理活动资料', instructions, avatarPath: 'editor.png',
      skills: [{ id: catalog.skills[0]!.id, load: 'always' }],
    })
    const { id } = created.manifest
    expect(created).toMatchObject({ hasAvatar: true, revision: 1, manifest: { version: '1.0.0' } })
    expect(created.manifest).not.toHaveProperty('avatar')
    expect(await call('expert_get', { id })).toMatchObject({ hasAvatar: true, bindings: { skills: { 'skill-1': 'local-news' } } })
    expect(await call('expert_check', { id })).toMatchObject({ ready: true })
    process.emit('message', { type: 'actvero:experts:control', id: randomUUID(), action: 'select', input: { id } }, undefined)
    const picked = await selection.promise
    expect(picked.sessionId).not.toBe(author.sessionId)
    expect(picked.selection).toMatchObject({ id, avatar: 'data:image/png;base64,' + portrait })
    const editor = ctx.agents.list().find(agent => agent.id === picked.sessionId)!
    expect(ctx.sessionProjections.stateOf(editor.session, 'actveroExpert')?.selection).toEqual(picked.selection)
    for (const prompt of ['请给社区开放日新闻稿提纲。报名 120 人，签到 96 人。', '确认提纲，请成稿。']) {
      editor.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] }))
      await editor.whenIdle()
      const request = model.requests.findLast(item => JSON.stringify(item.messages).includes(prompt))
      expect(request).toBeDefined()
      const assembled = JSON.stringify([request?.system, request?.messages])
      expect(assembled).toContain(skillContent)
      expect(assembled).toContain(instructions)
    }
    const messages = editor.session.snapshotEvents().filter(e => e.type === 'assistant/message')
    expect(messages.map(e => e.data.message.content)).toEqual([
      [{ type: 'text', text: '提纲：社区开放日；报名 120 人，签到 96 人。请确认提纲。' }],
      [{ type: 'text', text: '社区开放日共有 120 人报名、96 人签到。' }],
    ])
  } finally {
    try { await scaffold.close() } finally {
      if (originalSend) Object.defineProperty(process, 'send', originalSend)
      else Reflect.deleteProperty(process, 'send')
    }
  }
})
