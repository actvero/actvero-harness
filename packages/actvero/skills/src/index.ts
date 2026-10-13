import type { Context } from '@deepseek-ai/cordis'
import type { SkillDefinition, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { randomUUID } from 'node:crypto'
export const name='actvero-skills'
export const inject=['skills']
export function apply(ctx:Context){
  if(!process.send)return
  let disposed=false,control:SkillProviderControl
  const pending=new Map<string,{ resolve(value:any):void;reject(error:Error):void;timer:NodeJS.Timeout }>()
  const request=<T>(action:string,input:unknown={}):Promise<T>=>new Promise((resolve,reject)=>{
    if(disposed){reject(new Error('provider_disposed'));return}
    const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('skills_host_timeout'))},15000)
    pending.set(id,{ resolve,reject,timer });process.send?.({ type:'actvero:skills:request',id,action,input })
  })
  const off=ctx.skills.registerProvider((c)=>{control=c;return {
    name:'actvero-skills',
    async list(options){
      // This provider is an optional overlay on DSH's native registry. A
      // deleted package or a host restart must not make the whole Session
      // skill catalog fail; retrying the overlay will happen on the next
      // catalog refresh.
      let rows:{ id:string;name:string;description:string;versionId:string;invocation:{ modelInvocable:boolean;userInvocable:boolean } }[]
      try { rows=await request<typeof rows>('list') } catch { return [] }
      options.signal?.throwIfAborted()
      return rows.map(row=>({ name:row.name,description:row.description,source:'actvero',provider:'actvero-skills',rank:250,locator:{ id:row.id,versionId:row.versionId },invocation:row.invocation }))
    },
    async get(candidate,options){let value:SkillDefinition|undefined;try{value=await request<SkillDefinition|undefined>('get',candidate.locator)}catch{return undefined}options.signal?.throwIfAborted();return value},
  }})
  const receive=(raw:unknown)=>{
    const m=raw as { type?:string;id?:string;value?:unknown;error?:string;name?:string;skillId?:string }
    if(m?.type==='actvero:skills:result'&&m.id){const item=pending.get(m.id);if(!item)return;pending.delete(m.id);clearTimeout(item.timer);m.error?item.reject(new Error(m.error)):item.resolve(m.value)}
    if(m?.type==='actvero:skills:changed')control.invalidate()
    if(m?.type==='actvero:skills:sync'&&m.id){
      const respond=(error?:string)=>process.send?.({ type:'actvero:skills:synced',id:m.id,error })
      control.invalidate()
      void (async()=>{
        if(m.name){const catalog=await ctx.skills.list({ cwd:process.cwd() });const existing=catalog.find(s=>s.name===m.name);const own=await request<{ name:string;id:string }[]>('list');if((existing&&existing.provider!=='actvero-skills')||own.some(s=>s.name===m.name&&s.id!==m.skillId))throw new Error('skill_name_conflict')}
        else {
          // A refresh after uninstall/disable is best-effort. The durable
          // local state is already authoritative; a stale Host or a session
          // being torn down must not roll the user's deletion back.
          try { const rows=await request<{ name:string;id:string;versionId:string }[]>('list');for(const row of rows){const skill=await ctx.skills.get(row.name,{ cwd:process.cwd() });if(!skill||skill.provider!=='actvero-skills')throw new Error('skill_name_conflict')} } catch { /* retry on the next invalidation */ }
        }
        respond()
      })().catch(e=>respond(e.message==='skill_name_conflict'?'skill_name_conflict':'skill_registration_failed'))
    }
  }
  ctx.effect(()=>{process.on('message',receive);return()=>{disposed=true;off();process.off('message',receive);for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('provider_disposed'))}pending.clear()}})
}
