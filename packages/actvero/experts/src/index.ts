import { creationTools } from './creation-tools.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { expertProjection,connectorProjection,connectorChoices } from './projection.ts'
import type {} from '@deepseek-ai/dsh-session-projection'
import { creatorSkill } from './creator.ts'
import { randomUUID } from 'node:crypto'
import type { ExpertRuntime,ExpertLock,ExpertSelection } from './contracts.ts'
import { normalizeExpertSelectionAvatar } from './avatar.ts'
export const name='actvero-experts'
export const inject=['agents','skills','tools','systemPrompt','sessionController','workspaceRegistry','sessionProjections','actveroMcp']
declare module '@deepseek-ai/cordis' {interface Context {
  actveroMcp:{ refresh():Promise<void>;names(sessionId:string):string[];ids(sessionId:string):string[] }
  actveroExpertPolicy:{ connectors(agent:Agent):Promise<readonly string[]|undefined> }
}}

export function apply(ctx:Context){
  if(!process.send)return
  ctx.sessionProjections.register(expertProjection)
  ctx.sessionProjections.register(connectorProjection)
  let disposed=false
  const pending=new Map<string,{ resolve(v:unknown):void;reject(e:Error):void;timer:NodeJS.Timeout }>()
  const request=<T>(action:string,input:Record<string,unknown>):Promise<T>=>new Promise((resolve,reject)=>{
    if(disposed){reject(new Error('expert_host_unavailable'));return}const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('expert_host_timeout'))},30000)
    pending.set(id,{ resolve:v=>resolve(v as T),reject,timer });process.send?.({ type:'actvero:experts:request',id,action,input })
  })
  const projection=(agent:Agent)=>{const value=ctx.sessionProjections.stateOf(agent.session,'actveroExpert');if(!value)throw new Error('expert_projection_unavailable');return value}
  const selected=async(agent:Agent,seen=new Set<string>()):Promise<ExpertSelection|null>=>{
    if(seen.has(agent.id))throw new Error('expert_lineage_invalid');seen.add(agent.id)
    const state=projection(agent);if(state.hasSelection)return state.selection
    const parent=agent.session.header.parentSession
    if(parent){const owner=ctx.agents.get(parent);if(owner)return selected(owner,seen);const resolved=await ctx.sessionController.resolveAgent(parent);if('error' in resolved)throw new Error('expert_lineage_unavailable');return selected(resolved.agent,seen)}
    return null
  }
  const runtime=async(agent:Agent):Promise<ExpertRuntime|undefined>=>{const choice=await selected(agent);return choice?request<ExpertRuntime>('resolve',{ id:choice.snapshotId }):Promise.resolve(undefined)}
  const choices=(agent:Agent)=>ctx.sessionProjections.stateOf(agent.session,'actveroConnectors')?.choices??[]
  const connectorState=async(agent:Agent)=>request<{ added:string[];enabled:string[];ready:string[];rows:{ id:string;scope:string;name:string;description:string;required:boolean }[] }>('connector-state',{ sessionId:agent.id,snapshotId:(await selected(agent))?.snapshotId,choices:choices(agent) })
  ctx.provide('actveroExpertPolicy',{ connectors:async(agent:Agent)=>{const state=await connectorState(agent);return await selected(agent)?state.enabled:undefined} })
  ctx.effect(()=>ctx.skills.register(creatorSkill))
  for(const tool of creationTools(request))ctx.tools.register(tool)
  ctx.effect(()=>ctx.skills.registerViewResolver(async(options)=>{
    const agent=ctx.agents.list().find(a=>a===options.scope);if(!agent)return undefined
    return (await runtime(agent))?.skills
  },{ includeDiscovered:true }))
  // Resolve and await actual MCP registrations before DSH freezes the next model call.
  ctx.on('agent/pre-step',async({ agent,signal },next)=>{
    if(await selected(agent)){const plan=await runtime(agent);signal.throwIfAborted();if(plan)await request('activate',{ id:plan.snapshotId,sessionId:agent.id,choices:choices(agent) });signal.throwIfAborted();await ctx.actveroMcp.refresh();signal.throwIfAborted();const ready=new Set(ctx.actveroMcp.ids(agent.id)),awaitedEnabled=new Set((await connectorState(agent)).enabled);if(plan?.connectors.some(id=>(awaitedEnabled.has(id))&&!ready.has(id)))throw new Error('expert_connector_unavailable')}
    return next()
  })
  ctx.on('system-prompt/assemble',async(_assembly,context,next)=>{
    const assembly=await next(),agent=ctx.agents.list().find(a=>a===context.scope);if(!agent)return assembly
    const plan=await runtime(agent);if(!plan)return assembly
    const names=new Set(ctx.actveroMcp.names(agent.id))
    return { ...assembly,
      sections:[...assembly.sections,{ name:'actvero-expert',text:'{{actvero_expert}}' }],
      variables:{ ...assembly.variables,actvero_expert:`Expert: ${plan.expert.name} (${plan.expert.version})\n${plan.expert.instructions}\n\n${plan.skills.filter(s=>s.load==='always').map(skill=>ctx.skills.renderContent(skill)).join('\n\n')}` },
      tools:assembly.tools.filter(t=>!t.name.startsWith('mcp_')||names.has(t.name)),
    }
  })
  ctx.on('tools/pre-execute',async(exec,next)=>{if(exec.agent&&exec.name.startsWith('mcp_')&&await selected(exec.agent)){await runtime(exec.agent);if(!ctx.actveroMcp.names(exec.agent.id).includes(exec.name))return { kind:'deny',reason:'expert_connector_denied' }}return next()})
  const binding=async(input:Record<string,unknown>)=>{
    let agent:Agent|undefined
    if(typeof input.sessionId==='string'){const result=await ctx.sessionController.resolveAgent(input.sessionId as SessionId);if('error' in result)throw new Error('expert_session_missing');agent=result.agent}
    // A summon requires an explicit, live workspace, even when a session already exists.
    if(input.id!==null&&typeof input.workspaceId!=='string')throw new Error('expert_workspace_required')
    const existing=agent
    const workspace=typeof input.workspaceId==='string'?ctx.workspaceRegistry.get(input.workspaceId as WorkspaceId)
      :existing?ctx.workspaceRegistry.list().find(w=>w.sessionIds.includes(existing.id)):undefined
    if(input.workspaceId!==undefined&&!workspace)throw new Error('expert_workspace_missing')
    const started=(a:Agent)=>projection(a).started
    if(!agent||started(agent)||agent.status==='running'||(workspace&&!workspace.sessionIds.includes(agent.id))){
      const created=await ctx.sessionController.create({ sessionId:randomUUID() as SessionId,
        ...(workspace?{ workspaceId:workspace.id }:agent?.session.header.cwd?{ cwd:agent.session.header.cwd }:{}) })
      const result=await ctx.sessionController.resolveAgent(created.sessionId);if('error' in result)throw new Error('expert_session_missing')
      if(agent?.options.provider&&agent.options.model)await ctx.sessionController.selectModel({
        sessionId:created.sessionId,provider:agent.options.provider,model:agent.options.model,
        ...(agent.options.reasoningEffort?{ reasoningEffort:agent.options.reasoningEffort }:{}) })
      agent=result.agent
    }
    const target=agent,operation=typeof input.operation==='string'?{ operation:input.operation }:{}
    return target.runMaintenance(async(signal)=>{
      if(started(target))throw new Error('expert_session_locked')
      let choice:ExpertSelection|null=null
      if(input.id!==null){if(typeof input.id!=='string')throw new Error('expert_invalid');const lock=await request<ExpertLock>('prepare',{ id:input.id,...operation });signal.throwIfAborted()
        await request('activate',{ id:lock.id,sessionId:target.id,choices:choices(target),...operation });signal.throwIfAborted()
        choice={ snapshotId:lock.id,id:lock.expert.manifest.id,name:lock.expert.manifest.name,
          avatar:normalizeExpertSelectionAvatar(lock.expert.manifest.avatar),version:lock.expert.manifest.version }
      }
      const previous=await selected(target);target.session.append('actvero/expert',{ schemaVersion:1,selection:choice });try{await ctx.actveroMcp.refresh();if(choice){const plan=await request<ExpertRuntime>('resolve',{ id:choice.snapshotId,...operation });const ready=new Set(ctx.actveroMcp.ids(target.id));const enabled=new Set((await connectorState(target)).enabled);if(plan.connectors.some(id=>enabled.has(id)&&!ready.has(id)))throw new Error('expert_connector_unavailable')}}catch(e){target.session.append('actvero/expert',{ schemaVersion:1,selection:previous });await ctx.actveroMcp.refresh();throw e}
      if(choice)await request('record-use',{ id:choice.id }).catch(()=>{console.warn('[actvero-experts] Unable to save recent expert history')})
      return { sessionId:target.id,selection:choice }
    })
  }
  const receive=(raw:unknown)=>{
    const m=raw as { type?:string;id?:string;action?:string;input?:Record<string,unknown>;value?:unknown;error?:string };if(!m?.id)return
    if(m.type==='actvero:experts:result'){
      const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer)
      if(m.error)p.reject(new Error(m.error));else p.resolve(m.value)
      return
    }
    if(m.type!=='actvero:experts:control')return
    const input=m.input??{}
    const run=async()=>{if(m.action==='select')return binding(input);if(m.action==='connector-state'||m.action==='connector-select'){
      if(typeof input.sessionId!=='string')throw new Error('expert_session_missing');const resolved=await ctx.sessionController.resolveAgent(input.sessionId as SessionId);if('error' in resolved)throw new Error('expert_session_missing');const agent=resolved.agent
      if(m.action==='connector-state')return connectorState(agent)
      return agent.runMaintenance(async()=>{const state=await connectorState(agent),row=state.rows.find(r=>r.id===input.id);if(!row||typeof input.enabled!=='boolean')throw new Error('expert_invalid');if(row.required&&!input.enabled)throw new Error('expert_connector_required')
        const next=connectorChoices.parse([...choices(agent).filter(c=>c.id!==row.id||c.scope!==row.scope),
          { id:row.id,scope:row.scope,enabled:input.enabled }])
        agent.session.append('actvero/connectors',{ schemaVersion:1,choices:next });const result=await connectorState(agent);await ctx.actveroMcp.refresh();return result
      })
    }if(m.action==='selection'){if(typeof input.sessionId!=='string')return null;const r=await ctx.sessionController.resolveAgent(input.sessionId as SessionId);if('error' in r)return null;return selected(r.agent)}throw new Error('expert_invalid_action')}
    void run().then((value)=>{process.send?.({ type:'actvero:experts:controlled',id:m.id,value })},(error)=>{process.send?.({ type:'actvero:experts:controlled',id:m.id,error:/^expert_[a-z_]+$/.test(error?.message??'')?error.message:'expert_action_failed' })})
  }
  ctx.effect(()=>{process.on('message',receive);return()=>{disposed=true;process.off('message',receive);for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('expert_host_unavailable'))}pending.clear()}})
}
