import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { expect, it, onTestFinished, vi } from 'vitest'
import * as gateway from '../src/index.ts'

it('restarts a catalog read after the desktop account becomes available', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const provider = 'actvero-platform'
  const resource = 'llm:11111111-1111-4111-8111-111111111111'
  const tokenEndpoint = 'https://platform.example/api/llm/v1'
  let signedIn = false
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    expect(String(input)).toBe(`${tokenEndpoint}/models?page=1`)
    return Response.json({ data: [{ id: 'flash', name: 'DeepSeek Flash', resource, operations: [{ kind: 'chat' }] }] })
  })
  onTestFinished(() => { vi.unstubAllGlobals() })
  const originalSend = Object.getOwnPropertyDescriptor(process, 'send')
  onTestFinished(() => {
    if (originalSend) Object.defineProperty(process, 'send', originalSend)
    else Reflect.deleteProperty(process, 'send')
  })
  Object.defineProperty(process, 'send', { configurable: true, writable: true,
    value: (request: { type: string; id: string }) => {
      expect(request.type).toBe('actvero:llm:request')
      process.emit('message', { type: 'actvero:llm:result', id: request.id,
        ...(signedIn ? { value: { access_token: 'catalog-token', token_type: 'Bearer', resource: 'llm:catalog',
          endpoint: tokenEndpoint, expires_in: 60 } } : { error: 'reauthentication_required' }) }, undefined)
      return true
    } })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(gateway, {})
  await expect(ctx.llm.listModels(provider)).rejects.toThrow('reauthentication_required')
  let reloaded: ReturnType<typeof ctx.llm.listModels> | undefined
  const stop = ctx.on('llm/adapters-updated', () => {
    reloaded = ctx.llm.listModels(provider)
  })
  onTestFinished(() => { stop() })
  signedIn = true
  process.emit('message', { type: 'actvero:llm:changed' }, undefined)
  expect(reloaded).toBeDefined()
  await expect(reloaded).resolves.toMatchObject([{ id: 'flash', name: 'DeepSeek Flash' }])
})
