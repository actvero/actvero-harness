/** The Harness agent and an external CLI see the same Desktop-managed Skill inventory. */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createUserMessage, LlmAdapter, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@actvero/dsh-capability-ui'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { expect, it, vi } from 'vitest'
import { localCapabilityCli } from '../../../scripts/actvero-local-capability-cli.ts'
import { fixtureUserPrompts, launchWebScaffold, recordFixture, webSnapshotMode } from './scaffold.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/actvero-local-capabilities', import.meta.url))
const fixture = join(directory, 'session.v4.jsonl')
const provider = 'actvero-local-capabilities-fixture'
const inventory = [{ id: 'local-737533df-d1a0-4144-870d-e217b3ed6e50', name: 'decision-notes', enabled: true, version: '1.0.0' }]

class InventoryAdapter extends LlmAdapter {
  private calls = 0
  override async listModels() { return [{ provider, id: 'fixture', name: 'Fixture' }] }
  override async *stream(): AsyncIterable<StreamChunk> {
    if (this.calls++ === 0) {
      const id = ToolCallId('list-installed-skills')
      const args = '{"operation":"skill-list"}'
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'local_capabilities', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'local_capabilities', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = '本机已安装并启用 decision-notes。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it.skipIf(webSnapshotMode() === 'record')('lists the same installed Skills through the Harness tool and the external command', async () => {
  const existing = existsSync(fixture)
  if (!existing && webSnapshotMode() !== 'refresh') throw new Error('Missing local capabilities recording')
  const prompt = existing ? fixtureUserPrompts(await readFile(fixture, 'utf8'))[0] : '帮我看看 Harness 本机安装了哪些 Skill。'
  if (!prompt) throw new Error('Missing recorded local capability input')

  const send = Object.getOwnPropertyDescriptor(process, 'send')
  const connected = Object.getOwnPropertyDescriptor(process, 'connected')
  const request = vi.fn((message: { id: string; action: string }) => {
    if (message.action === 'manage-local') {
      process.emit('message', { type: 'actvero:workbench:result', id: message.id, value: inventory }, undefined)
    }
    return true
  })
  Object.defineProperty(process, 'send', { value: request, configurable: true })
  Object.defineProperty(process, 'connected', { value: true, configurable: true })
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  try {
    scaffold = await launchWebScaffold({ extraOverlayPath: join(directory, 'cordis.patch.yml'),
      ...(existing ? { replayFixture: fixture, replayProviders: [{ id: provider, name: provider,
        models: [{ id: 'fixture', name: 'Fixture', contextWindow: 128_000 }] }] } : {}),
    })
    const { ctx, workspaceCwd } = scaffold
    if (!existing) ctx.effect(() => ctx.llm.registerAdapter([provider], new InventoryAdapter()))
    await ctx.agentDefaultModel.saveSelection({ provider, model: 'fixture' })
    const { sessionId } = await ctx.sessionController.create({ cwd: workspaceCwd })
    const agent = ctx.agents.get(sessionId)!
    agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const result = agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    expect(JSON.stringify(result)).toContain('decision-notes')
    const connection = await ctx.actveroWorkbenchDevelopment.connection()
    expect(await localCapabilityCli(['skill', 'list', '--connection', connection])).toEqual(inventory)
    expect(request.mock.calls.filter(([message]) => message.action === 'manage-local')).toHaveLength(2)
    await ctx.sessions.flush(agent.session)
    if (!existing && webSnapshotMode() === 'refresh') await recordFixture(scaffold, sessionId, fixture)
  } finally {
    try { await scaffold?.close() } finally {
      if (send) Object.defineProperty(process, 'send', send)
      else Reflect.deleteProperty(process, 'send')
      if (connected) Object.defineProperty(process, 'connected', connected)
      else Reflect.deleteProperty(process, 'connected')
    }
  }
})
