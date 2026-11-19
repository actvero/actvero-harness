/** Native tool admission and Desktop IPC dispatch for local capability management. */
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { registerLocalCapabilities } from '../src/workbench-local-tools.ts'

it('lists local Skills and refuses installation when the native approval path cannot authorize it', async () => {
  const ctx = new Context()
  const send = Object.getOwnPropertyDescriptor(process, 'send')
  const connected = Object.getOwnPropertyDescriptor(process, 'connected')
  const request = vi.fn((message: { id: string; action: string; input: { operation: string } }) => {
    if (message.action === 'manage-local') {
      process.emit('message', { type: 'actvero:workbench:result', id: message.id, value: [{ name: 'decision-notes' }] }, undefined)
    }
    return true
  })
  Object.defineProperty(process, 'send', { value: request, configurable: true })
  Object.defineProperty(process, 'connected', { value: true, configurable: true })
  try {
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Object.assign((scope: Context) => { registerLocalCapabilities(scope) }, { inject: ['tools'] }))
    const call = (operation: string, input?: object) => ctx.tools.execute({
      name: 'local_capabilities', callId: ToolCallId(operation), signal: new AbortController().signal,
      arguments: { operation, ...(input ? { input_json: JSON.stringify(input) } : {}) },
    })
    const read = await call('skill-list')
    expect(read.isError).toBe(false)
    expect(JSON.stringify(read)).toContain('decision-notes')
    const install = await call('skill-install', { path: '/fixture/SKILL.md' })
    expect(install.isError).toBe(true)
    expect(request).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: 'manage-local', input: { operation: 'skill-list' } }), expect.any(Function),
    )
  } finally {
    await ctx.fiber.dispose()
    if (send) Object.defineProperty(process, 'send', send)
    else Reflect.deleteProperty(process, 'send')
    if (connected) Object.defineProperty(process, 'connected', connected)
    else Reflect.deleteProperty(process, 'connected')
  }
})
