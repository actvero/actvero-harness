import { expect,it,vi } from 'vitest'
import { creationTools } from '../src/creation-tools.ts'

it('dispatches catalog reads and validated creation inputs through Main',async()=>{
  const request=vi.fn(async()=>({ id:'created' }))
  const tools=creationTools(request),catalog=tools.find(t=>t.name==='expert_catalog')!,create=tools.find(t=>t.name==='expert_create')!
  expect(await catalog.execute({})).toBe('{"id":"created"}')
  expect(request).toHaveBeenLastCalledWith('catalog',{})
  expect(await create.execute({ configuration:'{"manifest":{"name":"Example"}}' })).toBe('{"id":"created"}')
  expect(request).toHaveBeenLastCalledWith('create',{ expert:{ manifest:{ name:'Example' } } })
})

it('rejects malformed or oversized model inputs before touching the local gateway',async()=>{
  const request=vi.fn(async()=>null)
  const tools=creationTools(request),catalog=tools.find(t=>t.name==='expert_catalog')!,create=tools.find(t=>t.name==='expert_create')!
  for(const args of [null,[],{ extra:true }])await expect(catalog.execute(args)).rejects.toThrow('expert_invalid')
  for(const args of [null,[],{}, { configuration:3 }, { configuration:'{}',extra:true }, { configuration:'x'.repeat(700001) }])await expect(create.execute(args)).rejects.toThrow('expert_invalid')
  await expect(create.execute({ configuration:'{invalid' })).rejects.toThrow()
  expect(request).not.toHaveBeenCalled()
})

it('routes model authoring tools to the closed Desktop operations', async () => {
  const request = vi.fn(async () => ({ revision: 2 }))
  const tools = creationTools(request)
  const list = tools.find(tool => tool.name === 'expert_list')!
  const get = tools.find(tool => tool.name === 'expert_get')!
  const update = tools.find(tool => tool.name === 'expert_update')!
  const check = tools.find(tool => tool.name === 'expert_check')!
  await list.execute({ query: '周报', page: 2 })
  await get.execute({ id: 'report' })
  await expect(update.execute({ id: 'report', revision: 1, changes: '{"manifest":{"name":"项目周报"}}' })).resolves.toBe('{"revision":2}')
  await check.execute({ id: 'report' })
  expect(request.mock.calls).toEqual([
    ['author-list', { query: '周报', page: 2 }],
    ['author-get', { id: 'report' }],
    ['author-update', { id: 'report', revision: 1, patch: { manifest: { name: '项目周报' } } }],
    ['author-check', { id: 'report' }],
  ])
  request.mockClear()
  await expect(update.execute({ id: 'report', revision: '1', changes: '{}' })).rejects.toThrow('expert_invalid')
  await expect(get.execute({ id: '../other' })).rejects.toThrow('expert_invalid')
  expect(request).not.toHaveBeenCalled()
})
