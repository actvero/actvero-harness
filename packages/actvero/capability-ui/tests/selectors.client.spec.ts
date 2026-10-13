import type {} from '@actvero/dsh-skills/contracts'
import type {} from '@actvero/dsh-connectors/contracts'
// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { expect,it,onTestFinished } from 'vitest'
import type { CommandContribution,PopupSelectSpec } from '@deepseek-ai/dsh-client-ui-commands/client'
import { sectionRows } from '../../../client/ui-commands/src/client/presentation.ts'
import { selectors } from '../src/client/selectors.ts'
it('uses native popupSelect and appends into the captured session without shifting reference chips',async()=>{
  const ctx=new Context(),scope=createScope(ctx,{ kind:'selector' }),rows=new Map<string,CommandContribution>();let inserted:unknown,reference:unknown;const calls:unknown[]=[]
  onTestFinished(async()=>{delete window.actveroSkills;delete window.actveroConnectors;await scope.dispose();await ctx.fiber.dispose()})
  ctx.provide('locale',{ bind:()=>((key:string)=>key) } as never)
  ctx.provide('layout',{ selectPanel:()=>{} } as never)
  ctx.provide('sessions',{ scope:(id:string)=>id==='captured'?scope.ctx:undefined,using:async (_id:string,_options:unknown,operation:(reference:never)=>unknown)=>operation(undefined as never) } as never)
  ctx.provide('remote',{ skills:{ list:async()=>({ ok:true,value:{ skills:[{ name:'writer',description:'Write',modelInvocable:true }] } }) } } as never)
  ctx.provide('conversation',{ input:{ for:()=>({ state:{ getSnapshot:()=>({ draft:'hello @notes.md',draftRev:7,occurrences:[{ length:9 }] }) } }) } } as never)
  ctx.provide('commandUi',{ register:(row:CommandContribution)=>{rows.set(row.name,row);return()=>rows.delete(row.name)} } as never)
  ctx.provide('capabilityHub',{ open:()=>{},notify:()=>{} })
  scope.ctx.on('slash/input-insert-text',(value)=>{inserted=value;return true})
  scope.ctx.on('slash/input-insert-reference',(value)=>{reference=value;return true})
  window.actveroSkills={ subscribe:()=>()=>{},request:async()=>({ items:[{ skill:{ id:'skill1',name:'writer',display_name:'Writer',description:'Write' },enabled:true,status:'current' }] }) }
  window.actveroConnectors={ subscribe:()=>()=>{},request:async(action,input)=>{calls.push({ action,input });return action==='state'?{ added:['mcp1'],enabled:[],ready:['mcp1'] }:{ id:'mcp1',display_name:'MCP',description:'Connected' }} }
  selectors(ctx)
  const native=(name:string)=>{const ui=rows.get(name)?.ui;if(ui?.kind!=='popupSelect')throw new Error('Missing native popup');return ui as PopupSelectSpec}
  const skill=native('skill'),session={ sessionId:SessionId('captured') };const options=await skill.options(session,new AbortController().signal);expect(options.map(row=>row.id)).toEqual(['writer']);await skill.onSelect(options[0]!,session)
  expect(inserted).toEqual({ text:' ',span:{ start:7,end:7,draftRev:7 } })
  expect(reference).toMatchObject({ span:{ start:7,end:7,draftRev:7 },reference:{ ref:'/writer',label:'writer' } })
  const connector=native('connector'),mcpOptions=await connector.options(session,new AbortController().signal);expect(mcpOptions.map(row=>row.id)).toEqual(['mcp1']);await connector.onSelect(mcpOptions[0]!,session)
  expect(calls).toContainEqual({ action:'select',input:{ id:'mcp1',sessionId:'captured',enabled:true } })
  const abort=new AbortController();abort.abort();await expect(skill.options(session,abort.signal)).rejects.toThrow()
})
it('places business additions beside native Add rows without duplicates',()=>{
  const t=(key:string)=>key;const rows=['file','goal','plan','feedback','compact','permission','model','skill','connector','expert'].map(name=>({ id:name,name,label:name,section:['skill','connector','expert'].includes(name)?'section.add':undefined }))
  const arranged=sectionRows(rows as never,t as never)
  expect(arranged.map(row=>row.name)).toEqual(['file','goal','plan','skill','connector','expert','feedback','compact','permission','model'])
  expect(arranged.filter(row=>row.section==='section.add')).toHaveLength(7)
})
