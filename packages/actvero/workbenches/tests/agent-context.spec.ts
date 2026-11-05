/** Keyless native Agent execution records business instructions and updates the same durable data. */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { WorkbenchRuntime } from '../src/runtime.ts'
import { CREATIVE_ID, exampleProviders } from '../src/examples.ts'
import { sessionIdSchema } from '../src/contracts.ts'
import { registerAgentContext } from '../src/agent-context.ts'

it('limits tools to associated conversations and logs the native model inputs and results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actvero-workbench-agent-')), ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    const data = { nodes: [{ id: 'script', kind: 'text', title: '秋季新品', text: '由原生对话更新的创作脚本' }] }
    const adapter = new MockAdapter([
      toolCallResponse('read', 'actvero_workbench_read', {}),
      toolCallResponse('write', 'actvero_workbench_update', { revision: 0, dataJson: JSON.stringify(data) }),
      textResponse('已更新当前画布的创作脚本。'),
      textResponse('普通对话。'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const runtime = new WorkbenchRuntime(ctx, root, 2500)
    runtime.register(exampleProviders()[0]!)
    await ctx.plugin({ inject: ['tools', 'agents', 'systemPrompt'], apply: (owner: Context) =>{  registerAgentContext(owner, runtime) } })
    const { projectId } = await runtime.action({ action: 'open', workbenchId: CREATIVE_ID })
    if (!projectId) throw new Error('Expected opened business material')
    const sessionId = sessionIdSchema.parse(randomUUID())
    const agent = await ctx.agentLoop.create(sessionId, { provider: 'mock', model: 'mock' })
    await runtime.store.change((state) => { state.conversations.push({ projectId, sessionId, createdAt: new Date().toISOString() }) })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '修改当前画布的脚本' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect((await runtime.snapshot()).projects[0]?.data).toEqual(data)
    expect(adapter.requests).toHaveLength(3)
    expect(adapter.requests[0]?.tools?.map(tool => tool.name)).toMatchInlineSnapshot(`
      [
        "actvero_workbench_read",
        "actvero_workbench_update",
      ]
    `)
    expect(JSON.stringify(adapter.requests[0])).toContain('Workbench: 图文视频创作示例')
    const events = JSON.stringify(agent.session.snapshotEvents())
    expect(events).toContain('Workbench: 图文视频创作示例')
    expect(events).toContain('由原生对话更新的创作脚本')
    const ordinary = await ctx.agentLoop.create(sessionIdSchema.parse(randomUUID()), { provider: 'mock', model: 'mock' })
    ordinary.followup(createUserMessage({ content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }))
    await ordinary.whenIdle()
    expect(adapter.requests[3]?.tools?.map(tool => tool.name) ?? []).toEqual([])
    expect(JSON.stringify(adapter.requests[3])).not.toContain('Workbench:')
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
