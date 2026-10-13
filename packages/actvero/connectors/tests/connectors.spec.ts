import { test } from 'vitest'
import assert from 'node:assert/strict'
import { Connectors } from '../src/main.ts'
const id = '12345678-1234-1234-1234-123456789abc'
function fixture() {
  let identity = {
    key: 'member-a',
    baseUrl: 'http://127.0.0.1:5194',
    available: true,
  }
  const requests: {
    url: string
    method: string
    rpc?: string
    authorization: string
  }[] = []
  let issue = 0,
    calls = 0,
    changes = 0,
    failCall = false
  const saved = new Map<string, string[]>()
  const connector = {
    id,
    name: 'fixture',
    display_name: '联调服务',
    description: '',
    icon: '',
    examples: [],
    auth_mode: 'none',
    credential_fields: [],
    connection: { status: 'connected', action: 'none' },
    counts: {},
    endpoint: `${identity.baseUrl}/api/mcp/services/${id}`,
  }
  const service = new Connectors({
    identity: () => identity,
    issue: async (resource) => {
      issue++
      return {
        resource,
        access_token: resource,
        token_type: 'Bearer',
        scope: 'mcp:invoke',
        expires_in: 600,
        endpoint:
          identity.baseUrl +
          (resource === 'mcp:catalog'
            ? '/api/v1/desktop/mcp/connectors'
            : `/api/mcp/services/${id}`),
      }
    },
    load: async key => saved.get(key) ?? [],
    save: async (key, ids) => {
      saved.set(key, ids)
    },
    openExternal: async () => {},
    changed: () => { changes++ },
    fetch: async (url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      requests.push({
        url: String(url),
        method: init?.method ?? 'GET',
        rpc: body?.method,
        authorization: new Headers(init?.headers).get('Authorization') ?? '',
      })
      if (String(url).includes('/desktop/mcp/'))
        return Response.json(
          String(url).includes('?')
            ? { items: [connector], total: 1, page: 1, page_size: 20 }
            : connector,
        )
      if (body.method === 'notifications/initialized')
        return new Response(null, { status: 202 })
      let result: unknown = {}
      if (body.method === 'initialize')
        result = {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {}, prompts: {}, resources: {} },
        }
      if (body.method === 'tools/list')
        result = {
          tools: [
            {
              name: 'echo',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
              },
            },
          ],
        }
      if (body.method === 'prompts/list')
        result = { prompts: [{ name: 'summarize' }] }
      if (body.method === 'resources/list')
        result = { resources: [{ uri: 'fixture://doc' }] }
      if (body.method === 'resources/templates/list')
        result = { resourceTemplates: [{ uriTemplate: 'fixture://{id}' }] }
      if (body.method === 'tools/call') {
        calls++
        if (failCall) throw new Error('lost')
        result = { content: [{ type: 'text', text: 'ok' }] }
      }
      if (body.method === 'prompts/get')
        result = {
          messages: [
            { role: 'user', content: { type: 'text', text: 'Summarize' } },
          ],
        }
      if (body.method === 'resources/read')
        result = { contents: [{ uri: body.params.uri, text: 'Document' }] }
      return Response.json({ jsonrpc: '2.0', id: body.id, result })
    },
  })
  return {
    service,
    requests,
    saved,
    setIdentity: (key: string) => {
      identity = { ...identity, key }
    },
    fail: () => {
      failCall = true
    },
    stats: () => ({ issue, calls, changes }),
  }
}
test('full primary capability discovery and calls use resource-specific POST without SSE GET', async () => {
  const f = fixture()
  const inventory = await f.service.add(id)
  assert.equal(inventory.tools.length, 1)
  assert.equal(inventory.prompts.length, 1)
  assert.equal(inventory.resources.length, 1)
  assert.equal(inventory.resourceTemplates.length, 1)
  await f.service.select(id, 'session-a', true)
  await f.service.call(id, 'session-a', 'tools/call', {
    name: 'echo',
    arguments: { text: 'hello' },
  })
  await f.service.call(id, 'session-a', 'prompts/get', { name: 'summarize' })
  await f.service.call(id, 'session-a', 'resources/read', {
    uri: 'fixture://doc',
  })
  assert.ok(
    f.requests
      .filter(r => r.rpc)
      .every(
        r => r.method === 'POST' && r.authorization === `Bearer mcp:${id}`,
      ),
  )
  assert.equal(f.stats().issue, 2)
})
test('session selection and device removal deny invocation', async () => {
  const f = fixture()
  await f.service.add(id)
  await assert.rejects(
    f.service.call(id, 'session-b', 'tools/call', {}),
    /connector_not_enabled/,
  )
  await f.service.select(id, 'session-a', true)
  await f.service.select(id, 'session-a', false)
  await assert.rejects(
    f.service.call(id, 'session-a', 'tools/call', {}),
    /connector_not_enabled/,
  )
  await f.service.remove(id)
  assert.deepEqual((await f.service.state()).added, [])
  assert.equal(f.stats().calls, 0)
})
test('account switch clears session grants and separates device additions', async () => {
  const f = fixture()
  await f.service.select(id, 'session-a', true)
  f.setIdentity('member-b')
  await assert.rejects(
    f.service.call(id, 'session-a', 'tools/call', {}),
    /connector_not_enabled/,
  )
  assert.deepEqual((await f.service.state()).added, [])
  assert.deepEqual(f.saved.get('member-a'), [id])
  f.setIdentity('member-a')
  assert.deepEqual((await f.service.state()).added, [id])
  assert.deepEqual((await f.service.state('session-a')).enabled, [])
})
test('ambiguous network failure never replays a business call', async () => {
  const f = fixture()
  await f.service.select(id, 'session-a', true)
  f.fail()
  await assert.rejects(
    f.service.call(id, 'session-a', 'tools/call', {}),
    /connection_interrupted/,
  )
  assert.equal(f.stats().calls, 1)
})
test('renderer cannot invoke tools or arbitrary URLs', async () => {
  const f = fixture()
  await assert.rejects(
    f.service.dispatch('call', { id, method: 'tools/call' }),
    /invalid_action/,
  )
  await assert.rejects(
    f.service.dispatch('preview', { id, sessionId: 's', method: 'tools/call' }),
    /invalid_action/,
  )
  await assert.rejects(
    f.service.dispatch('detail', { id: 'https://evil.invalid' }),
    /invalid_connector/,
  )
})
test('resource token endpoints are validated before any bearer request', async () => {
  let requested = false
  const service = new Connectors({
    identity: () => ({
      key: 'a',
      baseUrl: 'http://127.0.0.1:5194',
      available: true,
    }),
    issue: async resource => ({
      resource,
      token_type: 'Bearer',
      access_token: 'secret',
      expires_in: 600,
      scope: 'mcp:catalog',
      endpoint: 'https://evil.invalid/api/v1/desktop/mcp/connectors',
    }),
    load: async () => [],
    save: async () => {},
    openExternal: async () => {},
    changed: () => {},
    fetch: async () => {
      requested = true
      return Response.json({})
    },
  })
  await assert.rejects(service.catalog(), /invalid_resource_response/)
  assert.equal(requested, false)
})

test('unchanged capability refresh preserves registered tools; removal still invalidates', async () => {
  const f = fixture()
  await f.service.select(id, 'session-a', true)
  const before = f.stats().changes
  await f.service.inventory(id)
  assert.equal(f.stats().changes, before)
  await f.service.call(id, 'session-a', 'prompts/get', { name: 'summarize' })
  await f.service.remove(id)
  assert.ok(f.stats().changes > before)
  await assert.rejects(f.service.call(id, 'session-a', 'resources/read', {
    uri: 'fixture://doc',
  }), /connector_not_enabled/)
})
