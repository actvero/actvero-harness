import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { IconSkillOutlineMedium,IconLinkOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { nativeSkills,insertSkill } from './selection.ts'
interface Bridge { request(action:string,input?:Record<string,unknown>):Promise<unknown> }
interface SkillState { items:{ skill:{ id:string;name:string;display_name:string;description:string;source?:string };enabled:boolean;status:string }[] }
interface McpState { added:string[];enabled:string[];ready:string[];rows?:{ id:string;name:string;description:string;icon?:string;required:boolean }[] }
interface Mcp { id:string;display_name:string;description:string;icon?:string }
/** Native popup presentation with resource-specific icons and the Session's effective catalog. */
export function selectors(ctx:Context):void {
  const t=ctx.locale.bind('actvero.hub'),bridges=window as Window & { actveroSkills?:Bridge;actveroConnectors?:Bridge }
  for(const tab of ['skills','connectors'] as const)ctx.effect(()=>ctx.commandUi.register({ name:tab==='skills'?'skill':'connector',section:'add',label:()=>t(tab),description:()=>t(tab==='skills'?'skillHelp':'connectorHelp'),icon:tab==='skills'?IconSkillOutlineMedium:IconLinkOutlineMedium,available:()=>!!(tab==='skills'?bridges.actveroSkills:bridges.actveroConnectors),ui:{ kind:'popupSelect',searchLabels:()=>({ placeholder:t(tab),empty:t('empty'),noResults:t('noResults') }),options:async(session,signal)=>{
    if(tab==='skills'){
      const [state,catalog]=await Promise.all([bridges.actveroSkills!.request('state') as Promise<SkillState>,nativeSkills(ctx,session.sessionId,signal)]);signal.throwIfAborted()
      return catalog.map((skill)=>{const record=state.items.find(r=>r.skill.name===skill.name&&r.enabled&&r.status!=='unavailable');return { id:skill.name,label:record?.skill.display_name||skill.name,icon:IconSkillOutlineMedium,detail:skill.description,group:{ name:record?.skill.source==='platform'?'platform':'local',label:t(record?.skill.source==='platform'?'platformSkills':'localSkills') } }})
    }
    const state=await bridges.actveroConnectors!.request('state',{ sessionId:session.sessionId }) as McpState
    if(state.rows){signal.throwIfAborted();return state.rows.map(row=>({ id:row.id,label:row.name,icon:IconLinkOutlineMedium,...(row.icon?{ avatar:{ src:row.icon,fallback:'' } }:{}),detail:[row.description,t(state.ready.includes(row.id)?'connected':'disconnected')].filter(Boolean).join(' · '),toggle:{ checked:row.required||state.enabled.includes(row.id),disabled:row.required,...(row.required?{ title:t('requiredConnector') }:{}) } }))}
    const settled=await Promise.allSettled(state.added.map(async id=>await bridges.actveroConnectors!.request('detail',{ id }) as Mcp));signal.throwIfAborted();return settled.flatMap(r=>r.status==='fulfilled'?[{ id:r.value.id,label:r.value.display_name,icon:IconLinkOutlineMedium,detail:r.value.description,toggle:{ checked:state.enabled.includes(r.value.id) } }]:[])
  },onSelect:async(option,session)=>{if(tab==='skills'){const row=(await nativeSkills(ctx,session.sessionId)).find(r=>r.name===option.id);if(!row)throw new Error('skill_unavailable');insertSkill(ctx,session.sessionId,row)}else{const state=await bridges.actveroConnectors!.request('state',{ sessionId:session.sessionId }) as McpState;await bridges.actveroConnectors!.request('select',{ id:option.id,sessionId:session.sessionId,enabled:!state.enabled.includes(option.id) })}} } }))
}
