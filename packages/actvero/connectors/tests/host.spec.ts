import { test } from 'vitest'
import assert from 'node:assert/strict'
import { apply } from '../src/index.ts'
import type { Context } from '@deepseek-ai/cordis'
interface FixtureTool {
  name: string
  execute(args: unknown, context: { agent: { id: string }; signal: AbortSignal }): Promise<unknown>
}
interface Request {
  type: string
  id: string
  action: string
  input: { sessionId: string; method: string }
}
test('host tools stay in the selected agent scope and are disposed on revocation', async () => {
  const original = Object.getOwnPropertyDescriptor(process, 'send')
  const definitions = new Map<string, FixtureTool>()
  const effects: (() => void)[] = []
  let calls = 0
  const inventory = {
    tools: [
      {
        name: 'echo',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
        },
      },
    ],
    prompts: [{ name: 'greet' }],
    resources: [{ uri: 'fixture://guide' }],
    resourceTemplates: [],
    protocolVersion: '2025-11-25',
  }
  let rows = [{ id: 'connector', inventory, sessions: ['selected'] }]
  process.send = ((raw: unknown) => {
    const message = raw as Request
    queueMicrotask(() => {
      if (message.type !== 'actvero:mcp:request') return
      if (message.action === 'call') {
        calls++
        assert.equal(message.input.sessionId, 'selected')
        assert.equal(message.input.method, 'tools/call')
      }
      process.emit('message', {
        type: 'actvero:mcp:result',
        id: message.id,
        value:
          message.action === 'snapshot'
            ? rows
            : { content: [{ type: 'text', text: 'ok' }] },
      },undefined)
    })
    return true
  }) as NonNullable<typeof process.send>
  try {
    const services=new Map<string,unknown>()
    apply({
      provide:(name:string,value:unknown)=>services.set(name,value),
      get:(name:string)=>services.get(name),
      agents: {
        list: () => [
          {
            id: 'selected',
            ctx: {
              tools: {
                register: (tool: FixtureTool) => {
                  definitions.set(tool.name, tool)
                  return () => definitions.delete(tool.name)
                },
              },
            },
          },
          {
            id: 'other',
            ctx: {
              tools: {
                register: () => {
                  throw new Error('Cross-session registration')
                },
              },
            },
          },
        ],
      },
      effect: (fn: () => () => void) => effects.push(fn()),
    } as never)
    const mcp = services.get('actveroMcp') as Context['actveroMcp']
    await mcp.refresh()
    assert.equal(definitions.size, 6)
    const echo = [...definitions.values()].find(tool =>
      tool.name.endsWith('_echo'),
    )
    assert.ok(echo)
    await assert.rejects(
      echo.execute(
        { text: 'no' },
        { agent: { id: 'other' }, signal: new AbortController().signal },
      ),
      /connector_not_enabled/,
    )
    await echo.execute(
      { text: 'yes' },
      { agent: { id: 'selected' }, signal: new AbortController().signal },
    )
    assert.equal(calls, 1)
    rows = []
    process.emit('message', { type: 'actvero:mcp:changed' },undefined)
    await mcp.refresh()
    assert.equal(definitions.size, 0)
    inventory.tools[0]!.name = ''
    rows = [{ id: 'connector', inventory, sessions: ['selected'] }]
    await mcp.refresh()
    assert.equal(definitions.size, 0)
  } finally {
    effects.forEach((dispose) => { dispose() })
    if (original) Object.defineProperty(process, 'send', original)
    else delete process.send
  }
})

test('expert policy separates concurrent sessions and rejects stale handles before business dispatch', async () => {
  const original = Object.getOwnPropertyDescriptor(process, 'send')
  const effects: (() => void)[] = [], services = new Map<string, unknown>()
  let calls = 0, allowedA = ['one']
  const registries = new Map<string, Map<string, FixtureTool>>([['a', new Map()], ['b', new Map()]])
  const agents = [...registries].map(([id, definitions]) => ({ id, ctx: { tools: { register: (tool: FixtureTool) => {
    definitions.set(tool.name, tool)
    return () => definitions.delete(tool.name)
  } } } }))
  const inventory={ tools:[{ name:'same-name',inputSchema:{ type:'object' } }],prompts:[{ name:'p' }],resources:[{ uri:'fixture://r' }],resourceTemplates:[{ uriTemplate:'fixture://r/{id}' }] }
  services.set('actveroExpertPolicy', { connectors: async (agent: { id: string }) => agent.id === 'a' ? allowedA : ['two'] })
  process.send = ((raw: unknown) => {
    const message = raw as Request
    if (message.type === 'actvero:mcp:request') queueMicrotask(() => {
      if (message.action === 'call') calls++
      process.emit('message', { type: 'actvero:mcp:result', id: message.id,
        value: message.action === 'snapshot' ? ['one', 'two'].map(id => ({ id, inventory, sessions: ['a', 'b'] })) : { content: [] },
      }, undefined)
    })
    return true
  }) as NonNullable<typeof process.send>
  try {
    apply({ provide: (name: string, value: unknown) => services.set(name, value),
      get: (name: string) => services.get(name), agents: { list: () => agents },
      effect: (fn: () => () => void) => effects.push(fn()),
    } as never)
    const mcp = services.get('actveroMcp') as Context['actveroMcp']
    await mcp.refresh()
    assert.equal(registries.get('a')!.size,6);assert.equal(registries.get('b')!.size,6)
    assert.equal(mcp.owns('mcp__independent__read'), false)
    for (const name of mcp.names('a')) assert.equal(mcp.owns(name), true)
    assert.deepEqual(mcp.ids('a'), ['one']); assert.deepEqual(mcp.ids('b'), ['two'])
    const namesA=[...registries.get('a')!.keys()],namesB=[...registries.get('b')!.keys()];assert.ok(!namesA.some(n=>namesB.includes(n)))
    const stale=registries.get('a')!.get(namesA.find(n=>n.endsWith('_same_name'))!)
    assert.ok(stale)
    allowedA=[]
    await assert.rejects(stale.execute({}, { agent: agents[0]!, signal: new AbortController().signal }), /expert_connector_denied/)
    assert.equal(calls, 0)
    await mcp.refresh(); assert.equal(registries.get('a')!.size, 0); assert.equal(registries.get('b')!.size, 6)
  } finally {
    effects.forEach((dispose) => { dispose() })
    if (original) Object.defineProperty(process, 'send', original)
    else delete process.send
  }
})
