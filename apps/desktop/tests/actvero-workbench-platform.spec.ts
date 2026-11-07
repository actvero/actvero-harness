/** Main-owned catalog projection, identity races, cancellation and credential containment. */
import { describe, expect, it, vi } from 'vitest'
import type { AccountSnapshot } from '@actvero/dsh-client-account/protocol'
import { WorkbenchPlatform } from '../src/actvero/workbench-platform.ts'

function setup() {
  let snapshot: AccountSnapshot = { phase: 'ready', baseUrl: 'https://platform.example', brand: { name: 'Test' },
    user: { id: 'user-a', name: 'User' }, organization: { tenantId: 'tenant-a', memberId: 'member-a', name: 'Organization', status: 'active', needsLogin: false },
    organizations: [], quota: { phase: 'idle', windows: [] } }
  let revision = 0
  const account = { snapshot: () => snapshot, identityRevision: () => revision,
    resourceToken: vi.fn(async () => ({ access_token: 'main-only-secret', token_type: 'Bearer', resource: 'llm:catalog',
      endpoint: 'https://platform.example/api/llm/v1', scope: 'models:read', expires_in: 60 })) }
  const request = vi.fn<typeof fetch>()
  const platform = new WorkbenchPlatform(account, request)
  return { platform, account, request, change: (value: Partial<AccountSnapshot>) => { snapshot = { ...snapshot, ...value }; revision++ } }
}
const response = (id: string, hasMore = false) => Response.json({ data: [{ id, name: 'Image and video', resource: 'hidden-resource',
  operations: [{ kind: 'generate', input_modalities: ['text'], output_modalities: ['image', 'video'], endpoint: { token: 'discard-this' } }] }], has_more: hasMore })

describe('workbench platform directory', () => {
  it('uses the account-scoped resource and returns every operation without credentials or endpoints', async () => {
    const { platform, account, request } = setup()
    request.mockResolvedValueOnce(response('first', true)).mockResolvedValueOnce(response('second'))
    const result = await platform.models(new AbortController().signal)
    expect(account.resourceToken).toHaveBeenCalledWith('llm:catalog')
    expect(request.mock.calls.map(call => call[0])).toEqual(['https://platform.example/api/llm/v1/models?page=1', 'https://platform.example/api/llm/v1/models?page=2'])
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer main-only-secret' } })
    expect(result.models[0]?.operations).toEqual([{ kind: 'generate', inputModalities: ['text'], outputModalities: ['image', 'video'] }])
    expect(result.scope).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.stringify(result)).not.toMatch(/main-only-secret|discard-this|endpoint|resource|access_token/u)
  })

  it('rejects unavailable accounts and foreign token endpoints before sending HTTP', async () => {
    const fixture = setup()
    fixture.change({ phase: 'signed-out' })
    await expect(fixture.platform.models(new AbortController().signal)).rejects.toThrow('platform_account_unavailable')
    expect(fixture.account.resourceToken).not.toHaveBeenCalled()
    const next = setup()
    next.account.resourceToken.mockResolvedValue({ access_token: 'main-only-secret', token_type: 'Bearer', resource: 'llm:catalog',
      endpoint: 'https://other.example/api/llm/v1', scope: 'models:read', expires_in: 60 })
    await expect(next.platform.models(new AbortController().signal)).rejects.toThrow('platform_invalid_response')
    expect(next.request).not.toHaveBeenCalled()
  })

  it('discards a late response when an identity operation starts, including the same user signing in again', async () => {
    const { platform, request, change } = setup()
    const waiting = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<undefined>()
    request.mockImplementation(() => { started.resolve(undefined); return waiting.promise })
    const result = platform.models(new AbortController().signal)
    await started.promise
    change({})
    waiting.resolve(response('late'))
    await expect(result).rejects.toThrow('platform_account_changed')
  })

  it('cancels pending reads on invalidation and leaves the next scope usable', async () => {
    const { platform, request } = setup()
    const waiting = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<undefined>()
    request.mockImplementationOnce(() => { started.resolve(undefined); return waiting.promise }).mockResolvedValue(response('fresh'))
    const result = platform.models(new AbortController().signal)
    await started.promise
    platform.invalidate()
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    waiting.resolve(response('old'))
    await expect(result).rejects.toThrow()
    expect((await platform.models(new AbortController().signal)).models[0]?.id).toBe('fresh')
  })

  it('uses a fresh account scope for a new Main lifetime and closes completed network reads', async () => {
    const first = setup()
    const second = setup()
    first.request.mockResolvedValue(response('restored'))
    second.request.mockResolvedValue(response('restored'))
    const one = await first.platform.models(new AbortController().signal)
    const two = await second.platform.models(new AbortController().signal)
    expect(one.scope).not.toBe(two.scope)
    expect(first.request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it('fails visibly on HTTP failure, malformed pages and oversized catalogs', async () => {
    const { platform, request } = setup()
    request.mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(Response.json({ data: 'wrong' }))
      .mockResolvedValueOnce(new Response('x'.repeat(1024 * 1024 + 1)))
    await expect(platform.models(new AbortController().signal)).rejects.toThrow('platform_request_failed')
    await expect(platform.models(new AbortController().signal)).rejects.toThrow()
    await expect(platform.models(new AbortController().signal)).rejects.toThrow('platform_catalog_too_large')
  })
})
