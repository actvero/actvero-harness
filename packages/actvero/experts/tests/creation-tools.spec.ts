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
