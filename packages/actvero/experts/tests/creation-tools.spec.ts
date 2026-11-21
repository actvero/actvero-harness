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

it('validates field locations, installed identifiers and the portrait before saving', async () => {
  const catalog = { skills: [{ id: 'local-news', name: 'newsroom' }], connectors: [] }
  const request = vi.fn(async (action: string) => {
    if (action !== 'catalog') throw new Error('unexpected write')
    return catalog
  })
  const tool = creationTools(request, async () => Buffer.from('not an image')).find(t => t.name === 'expert_create')!
  const draft = { name: '新闻稿', description: '活动报道', instructions: '先提纲后成稿' }
  for (const [args, issue] of [
    [{ ...draft, skills: [{ id: 'local-news', load: 'now' }] }, 'skills.0.load'],
    [{ ...draft, connectors: [{ id: 'missing' }] }, 'connectors[0].id'],
    [{ ...draft, skills: Array(2).fill({ id: 'local-news', load: 'always' }) }, 'skills[1].id'],
    [{ ...draft, avatarPath: 'image.webp' }, 'avatarPath'],
  ] as const) await expect(tool.execute(args)).rejects.toThrow(issue)
  expect(request.mock.calls.every(([action]) => action === 'catalog')).toBe(true)
})

it('binds Skill and MCP IDs independently and persists the selected WebP', async () => {
  const avatar = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')
  const request = vi.fn(async (action: string, input: Record<string, unknown>) => action === 'catalog'
    ? { skills: [{ id: 'local-news', name: '编辑流程' }], connectors: [{ id: 'local-docs', name: '文档' }] }
    : input.expert)
  const read = vi.fn(async () => avatar)
  const tool = creationTools(request, read).find(t => t.name === 'expert_create')!
  const draft = {
    name: '新闻稿编辑', description: '准备新闻稿', instructions: '标出资料来源',
    skills: [{ id: 'local-news', load: 'on_demand' }], connectors: [{ id: 'local-docs', required: false }],
    avatarPath: 'news.webp',
  }
  const response = await tool.execute(draft)
  expect(JSON.parse(response)).toMatchObject({ hasAvatar: true, manifest: { version: '1.0.0', schemaVersion: 1 } })
  expect(response).not.toContain(avatar.toString('base64'))
  expect(read).toHaveBeenCalledWith('news.webp', undefined)
  expect(request).toHaveBeenLastCalledWith('create', { expert: {
    manifest: { name: draft.name, description: draft.description, instructions: draft.instructions,
      schemaVersion: 1, version: '1.0.0', avatar: 'data:image/webp;base64,' + avatar.toString('base64'),
      skills: [{ key: 'skill-1', label: '编辑流程', load: 'on_demand', required: true }],
      connectors: [{ key: 'mcp-1', label: '文档', required: false }] },
    bindings: { skills: { 'skill-1': 'local-news' }, connectors: { 'mcp-1': 'local-docs' } },
  } })
})
