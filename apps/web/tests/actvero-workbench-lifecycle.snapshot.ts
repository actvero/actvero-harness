/** 工作台准备失败经原生会话记录，并撤销工具；重试和解绑保留业务数据。 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { fixtureContext, normalizeSessionSnapshots } from '@deepseek-ai/dsh-session-snapshot'
import type { WorkbenchId } from '@actvero/dsh-capability-ui'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import {
  launchWebScaffold, rawSessionLog, readPersistedEvents, recordFixture, webSnapshotMode,
} from './scaffold.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/actvero-workbench-lifecycle', import.meta.url))
const fixture = join(directory, 'session.v4.jsonl')

it.skipIf(webSnapshotMode() === 'record')('records a failed workbench preparation without calling a model and restores capabilities on retry', async () => {
  const existing = existsSync(fixture)
  if (!existing && webSnapshotMode() !== 'refresh') throw new Error('Missing workbench lifecycle recording')
  let expected = existing ? await readFile(fixture, 'utf8') : ''
  // Preparation fails before user/message is appended; the durable inbox owns this input.
  const prompt = existing ? parseSessionLog(expected)
    .flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted : [])
    .flatMap(message => message.content)
    .find(content => content.type === 'text')?.text : '查看当前工作台的数据。'
  if (!prompt) throw new Error('Missing recorded workbench input')
  const scaffold = await launchWebScaffold({
    extraOverlayPath: join(directory, 'cordis.patch.yml'),
  })
  try {
    const { ctx } = scaffold
    const runtime = ctx.actveroWorkbenchRuntime
    const id = 'test:lifecycle' as WorkbenchId
    let offline = false
    ctx.effect(() => runtime.register({
      id, name: '生命周期验收', version: '1.0.0', ai: true,
      protocol: { schemaVersion: 1, hostApi: '^1.0.0' },
      storage: { initial: () => '{"items":[]}', reduce: json => json, actionHelp: '只读取验收数据。' },
      prepare: async () => { if (offline) throw new Error('Workbench dependency offline') },
    }))
    const { sessionId } = await ctx.sessionController.create({ cwd: scaffold.workspaceCwd })
    const agent = ctx.agents.get(sessionId)!
    const document = await runtime.open(id)
    const binding = await runtime.bind({ ...document, sessionId })
    expect(ctx.tools.get('workbench_read', agent)).toBeDefined()
    const errors: string[] = []
    ctx.on('agent/error', ({ agent: subject, error }) => {
      if (subject === agent && error instanceof Error) errors.push(error.message)
    })
    offline = true
    agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(errors).toEqual(['Workbench dependency offline'])
    expect(agent.session.snapshotEvents().some(event => event.type === 'request/header')).toBe(false)
    expect(agent.session.snapshotEvents().some(event => event.type === 'system/message')).toBe(false)
    expect(await readFile(join(directory, 'system-prompt.expected.md'), 'utf8')).toBe('<!-- 准备失败发生在模型请求前，没有系统提示词。 -->\n')
    expect(await readFile(join(directory, 'tool-schemas.expected.json'), 'utf8')).toBe('[]\n')
    expect(ctx.tools.get('workbench_read', agent)).toBeUndefined()
    expect(ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench')).toEqual(binding.selection)
    offline = false
    await runtime.bind({ ...document, sessionId })
    expect(ctx.tools.get('workbench_read', agent)).toBeDefined()
    await runtime.detach({ sessionId })
    expect(ctx.tools.get('workbench_read', agent)).toBeUndefined()
    expect(ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench')).toBeNull()
    expect(runtime.read(document)).toEqual(document)
    await ctx.sessions.flush(agent.session)
    expect(await readPersistedEvents(scaffold, sessionId)).toEqual(agent.session.snapshotEvents())
    if (webSnapshotMode() === 'refresh') {
      await recordFixture(scaffold, sessionId, fixture)
      expected = await readFile(fixture, 'utf8')
    }
    expect(normalizeSessionSnapshots([rawSessionLog(agent.session)], { sessionIds: [sessionId], cwd: scaffold.workspaceCwd }))
      .toEqual(normalizeSessionSnapshots([expected], fixtureContext(expected)))
  } finally { await scaffold.close() }
})
