import { test } from 'vitest'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { apply } from '../src/index.ts'
test('host tools stay in the selected agent scope and are disposed on revocation', async () => {
  const original = process.send
  const definitions = new Map<string, any>()
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
  process.send = ((message: any) => {
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
                register: (tool: any) => {
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
    await delay(10)
    assert.equal(definitions.size, 6)
    const echo = [...definitions.values()].find(tool =>
      tool.name.endsWith('_echo'),
    )
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
    await delay(10)
    assert.equal(definitions.size, 0)
  } finally {
    effects.forEach(dispose => dispose())
    if(original)process.send=original;else delete process.send
  }
})

test('expert policy separates concurrent sessions and rejects stale handles before business dispatch', async () => {
  const original=process.send, effects:(()=>void)[]=[], services=new Map<string,any>();let calls=0;let allowedA=['one']
  const registries=new Map<string,Map<string,any>>([['a',new Map()],['b',new Map()]])
  const agents=[...registries].map(([id,defs])=>({ id,ctx:{ tools:{ register:(tool:any)=>{defs.set(tool.name,tool);return()=>defs.delete(tool.name)} } } }))
  const inventory={ tools:[{ name:'same-name',inputSchema:{ type:'object' } }],prompts:[{ name:'p' }],resources:[{ uri:'fixture://r' }],resourceTemplates:[{ uriTemplate:'fixture://r/{id}' }] }
  services.set('actveroExpertPolicy',{ connectors:async(a:any)=>a.id==='a'?allowedA:['two'] })
  process.send=((m:any)=>{if(m.type==='actvero:mcp:request')setTimeout(()=>{if(m.action==='call')calls++;process.emit('message',{ type:'actvero:mcp:result',id:m.id,value:m.action==='snapshot'?['one','two'].map(id=>({ id,inventory,sessions:['a','b'] })):{ content:[] } },undefined)},5);return true}) as NonNullable<typeof process.send>
  try {
    apply({ provide:(name:string,value:any)=>services.set(name,value),get:(name:string)=>services.get(name),agents:{ list:()=>agents },effect:(fn:()=>()=>void)=>effects.push(fn()) } as never)
    await services.get('actveroMcp').refresh()
    assert.equal(registries.get('a')!.size,6);assert.equal(registries.get('b')!.size,6)
    assert.deepEqual(services.get('actveroMcp').ids('a'),['one']);assert.deepEqual(services.get('actveroMcp').ids('b'),['two'])
    const namesA=[...registries.get('a')!.keys()],namesB=[...registries.get('b')!.keys()];assert.ok(!namesA.some(n=>namesB.includes(n)))
    const stale=registries.get('a')!.get(namesA.find(n=>n.endsWith('_same_name'))!)
    allowedA=[]
    await assert.rejects(stale.execute({}, { agent:agents[0]!,signal:new AbortController().signal }),/expert_connector_denied/);assert.equal(calls,0)
    await services.get('actveroMcp').refresh();assert.equal(registries.get('a')!.size,0);assert.equal(registries.get('b')!.size,6)
  }finally{effects.forEach(fn=>fn());if(original)process.send=original;else delete process.send}
})
