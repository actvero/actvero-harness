import { Context } from '@deepseek-ai/cordis'
import { createScope,scopeOf } from '@deepseek-ai/dsh-scope'
import SkillRegistry,{ renderSkillContent } from '@deepseek-ai/dsh-skill'
import { it,expect } from 'vitest'
const definition=(name:string,content:string)=>({ name,description:name,content,provider:'test',source:'test',invocation:{ modelInvocable:true,userInvocable:true } })
it('keeps native discovery in ordinary sessions and exact content in selected scopes, with HMR disposal',async()=>{const ctx=new Context();await ctx.plugin(SkillRegistry);ctx.skills.register(definition('sample','current'));ctx.skills.register(definition('ordinary','ordinary'));const scoped=createScope(ctx,{ kind:'expert' }),key=scopeOf(scoped.ctx);const off=ctx.skills.registerViewResolver(async o=>o.scope===key?[definition('sample','pinned')]:undefined);expect((await ctx.skills.list()).map(s=>s.name)).toEqual(['ordinary','sample']);expect((await ctx.skills.list({ scope:key })).map(s=>s.name)).toEqual(['sample']);expect((await ctx.skills.get('sample',{ scope:key }))?.content).toBe('pinned');expect(await ctx.skills.get('ordinary',{ scope:key })).toBeUndefined();expect(()=>ctx.skills.registerViewResolver(async()=>[])).toThrow();off();expect((await ctx.skills.get('sample',{ scope:key }))?.content).toBe('current');const off2=ctx.skills.registerViewResolver(async()=>[]);expect(await ctx.skills.list()).toEqual([]);off2();await scoped.dispose();await ctx.fiber.dispose()})
it('rejects invalid duplicate views and supports cancellation',async()=>{const ctx=new Context();await ctx.plugin(SkillRegistry);let off=ctx.skills.registerViewResolver(async()=>[definition('sample','a'),definition('sample','b')]);await expect(ctx.skills.list()).rejects.toThrow(/duplicate/);off();off=ctx.skills.registerViewResolver(async()=>new Promise(()=>{}));const abort=new AbortController();const pending=ctx.skills.list({ signal:abort.signal });abort.abort();await expect(pending).rejects.toThrow();off();await ctx.fiber.dispose()})

it('uses native resource framing for pinned skills included in a system prompt',async()=>{const ctx=new Context();await ctx.plugin(SkillRegistry);const skill={ ...definition('sample','instructions'),resourceBase:{ kind:'directory' as const,path:'/project/<assets>' } };expect(ctx.skills.renderContent(skill)).toBe(renderSkillContent(skill));expect(ctx.skills.renderContent(skill)).toContain('/project/&lt;assets&gt;');await ctx.fiber.dispose()})

it('augments pins with lazily discovered skills without replacing the exact version',async()=>{
  const ctx=new Context();await ctx.plugin(SkillRegistry);let loads=0
  const offProvider=ctx.skills.registerProvider(()=>({ name:'directory',list:async()=>['sample','extra'].map(name=>({ ...definition(name,'unused'),provider:'directory',rank:100,locator:name })),get:async (candidate)=>{loads++;return { ...definition(candidate.name,'directory content'),provider:'directory' }} }))
  const off=ctx.skills.registerViewResolver(async()=>[definition('sample','exact expert version')],{ includeDiscovered:true })
  expect((await ctx.skills.snapshot()).skills.map(row=>row.name)).toEqual(['extra','sample']);expect(loads).toBe(0)
  expect((await ctx.skills.get('sample'))?.content).toBe('exact expert version');expect(loads).toBe(0)
  expect((await ctx.skills.get('extra'))?.content).toBe('directory content');expect(loads).toBe(1)
  off();expect((await ctx.skills.get('sample'))?.content).toBe('directory content');offProvider();await ctx.fiber.dispose()
})
