import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp,mkdir,writeFile,readdir,rm,symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Experts } from '../src/main.ts'
import { parseManifest } from '../src/schema.ts'
import type { Expert } from '../src/contracts.ts'
const base=():Expert=>({ manifest:{ schemaVersion:1,id:'report',version:'1.0.0',name:'周报助手',description:'整理周报',avatar:'',tags:[],instructions:'EXPERT_RULE {{literal}}',conversationStarters:[],skills:[{ key:'report',label:'周报技能',required:true,load:'always' }],connectors:[{ key:'notes',label:'资料服务',required:true }] },bindings:{ skills:{ report:'local-skill' },connectors:{ notes:'local-notes' } },revision:0 })
async function fixture(fn:(f:any)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'actvero-expert-test-'));try{
  const dir=join(root,'package');await mkdir(dir);await writeFile(join(dir,'SKILL.md'),'SKILL_A')
  let enabled=true,account='member-a',version='v1',rows=[{ id:'local-notes',name:'notes',description:'Notes',ready:true,inventory:{ tools:['read'],prompts:[],resources:[] } }]
  const def={ name:'report',description:'Report',content:'SKILL_A',provider:'actvero-skills',source:'actvero',invocation:{ modelInvocable:true,userInvocable:true },resourceBase:{ kind:'directory',path:dir } }
  const options={ root:join(root,'experts'),changed:()=>{},scope:()=>account,skills:{ hostList:async()=>enabled?[{ id:'local-skill',name:'report',description:'Report',versionId:version }]:[],hostGet:async(id:string,v:string)=>enabled&&id==='local-skill'&&v===version?def:undefined },connectors:async()=>rows }
  const engine=new Experts(options)
  await fn({ engine,options,root,dir,def,disable:()=>{enabled=false},update:()=>{version='v2'},account:(v:string)=>{account=v},connections:(v:any)=>{rows=v} })
}finally{await rm(root,{ recursive:true,force:true })}}
test('expert saves are revision checked; export excludes bindings; import gets a new identity',()=>fixture(async({ engine }:any)=>{
  const saved=await engine.save(base());assert.equal(saved.revision,1);await assert.rejects(engine.save(base()),/expert_edit_conflict/)
  const next=await engine.save(saved);assert.equal(next.manifest.version,'1.0.1')
  const exported=await engine.dispatch('export',{ id:'report' });assert.equal(exported.bindings,undefined);assert.equal(exported.instructions,'EXPERT_RULE {{literal}}')
  const resolved=await engine.dispatch('get',{ id:'report' });assert.equal(resolved.manifest.name,'周报助手')
  const imported=await engine.dispatch('import',{ manifest:exported });assert.notEqual(imported.manifest.id,'report');assert.deepEqual(imported.bindings,{ skills:{},connectors:{} })
  assert.equal((await engine.inspect(imported.manifest.id)).ready,false)
}))
test('snapshot survives engine restart and deleting editable expert, retaining exact version',()=>fixture(async({ engine,options }:any)=>{
  await engine.save(base());const lock=await engine.prepare('report');await engine.remove('report');const restored=new Experts(options);const runtime=await restored.resolve(lock.id)
  assert.equal(runtime.expert.version,'1.0.0');assert.equal(runtime.skills[0]!.content,'SKILL_A');assert.deepEqual(runtime.connectors,['local-notes']);assert.deepEqual(await restored.list(),[])
}))
test('same-name binding to a different ID is not silently substituted',()=>fixture(async({ engine }:any)=>{
  const expert=base();expert.bindings.skills.report='local-different';await engine.save(expert);await assert.rejects(engine.prepare('report'),/expert_dependencies_missing/)
}))
test('changed supporting file and symlink invalidate the entire required skill package',()=>fixture(async({ engine,dir }:any)=>{
  await engine.save(base());const lock=await engine.prepare('report');await writeFile(join(dir,'references.md'),'changed');await assert.rejects(engine.resolve(lock.id),/expert_skill_changed/)
  await rm(join(dir,'references.md'));await symlink(join(dir,'SKILL.md'),join(dir,'linked'));await assert.rejects(engine.resolve(lock.id),/expert_skill_changed/)
}))
test('changed parsed instructions also invalidate skill identity',()=>fixture(async({ engine,def }:any)=>{
  await engine.save(base());const lock=await engine.prepare('report');def.content='CHANGED';await assert.rejects(engine.resolve(lock.id),/expert_skill_changed/)
}))
test('disabled and upgraded required skills stop old snapshots',async()=>{
  for(const action of ['disable','update'])await fixture(async(f:any)=>{await f.engine.save(base());const lock=await f.engine.prepare('report');f[action]();await assert.rejects(f.engine.resolve(lock.id),/expert_skill_changed/)})
})
test('optional dependency absence is explicit and never broadens the runtime catalog',()=>fixture(async({ engine }:any)=>{
  const expert=base();expert.manifest.skills[0]!.required=false;expert.bindings.skills.report='local-missing';await engine.save(expert);const lock=await engine.prepare('report');const runtime=await engine.resolve(lock.id);assert.deepEqual(runtime.skills,[]);assert.deepEqual(runtime.warnings,['周报技能'])
}))
test('MCP capability changes invalidate required bindings',()=>fixture(async({ engine,connections }:any)=>{
  await engine.save(base());const lock=await engine.prepare('report');connections([{ id:'local-notes',name:'notes',ready:true,inventory:{ tools:['write'] } }]);await assert.rejects(engine.resolve(lock.id),/expert_connector_changed/)
}))
test('platform bindings cannot move between accounts',()=>fixture(async({ engine,connections,account }:any)=>{
  const expert=base();expert.bindings.connectors.notes='remote-notes';connections([{ id:'remote-notes',name:'notes',ready:true,inventory:{ tools:['read'] } }]);await engine.save(expert);const lock=await engine.prepare('report');account('member-b');await assert.rejects(engine.resolve(lock.id),/expert_connector_changed/)
}))
test('dependency checks leave no abandoned snapshots; creator uses normal validation',()=>fixture(async({ engine,root }:any)=>{
  await engine.save(base());assert.equal((await engine.inspect('report')).ready,true);assert.deepEqual(await readdir(join(root,'experts/snapshots')),[])
  const expert=base();const created=await engine.dispatch('create',{ expert });assert.notEqual(created.manifest.id,'report');assert.equal(created.revision,1)
  await assert.rejects(engine.dispatch('create',{ expert:{ manifest:{ ...expert.manifest,instructions:'' } } }),/expert_invalid/)
}))
test('strict manifests reject unsupported versions, remote avatars and undeclared fields',()=>{
  for(const extra of [{ schemaVersion:2 },{ id:'../escape' },{ id:'__proto__' },{ skills:[{ key:'constructor',label:'Unsafe key',required:true,load:'always' }] },{ avatar:'https://example.com/avatar.png' },{ token:'secret' },{ version:'latest' }])assert.throws(()=>parseManifest({ ...base().manifest,...extra }),/expert_/)
})

test('expert categories remain compatible with old packages and round-trip through import',()=>fixture(async({ engine }:any)=>{
  const legacy=base();assert.equal(parseManifest(legacy.manifest).category,'general')
  const expert=base();expert.manifest.category='engineering';await engine.save(expert)
  const exported=await engine.dispatch('export',{ id:'report' });const imported=await engine.dispatch('import',{ manifest:exported })
  assert.equal(imported.manifest.category,'engineering')
  assert.throws(()=>parseManifest({ ...legacy.manifest,category:'unknown' }),/expert_invalid/)
}))

test('recent experts persist successful selections only, reorder without duplicates and ignore removed items',()=>fixture(async({ engine,options }:any)=>{
  await engine.save(base());const other=base();other.manifest.id='other';await engine.save(other)
  await engine.inspect('report');await engine.prepare('report');assert.deepEqual(await engine.recent(),[])
  await engine.recordUse('report');await engine.recordUse('other');await engine.recordUse('report')
  const restored=new Experts(options);assert.deepEqual((await restored.recent()).map(e=>e.manifest.id),['report','other'])
  await assert.rejects(engine.recordUse('missing'));assert.deepEqual((await engine.recent()).map((e:Expert)=>e.manifest.id),['report','other'])
  await engine.remove('report');assert.deepEqual((await engine.recent()).map((e:Expert)=>e.manifest.id),['other'])
  assert.equal((await engine.dispatch('export',{ id:'other' })).history,undefined)
}))

test('import binds explicitly selected local capabilities and rejects unknown or embedded bindings',()=>fixture(async({ engine }:any)=>{
  const source=base();const imported=await engine.dispatch('import',{ manifest:source.manifest,bindings:source.bindings })
  assert.notEqual(imported.manifest.id,source.manifest.id);assert.equal((await engine.inspect(imported.manifest.id)).ready,true)
  const lock=await engine.prepare(imported.manifest.id);assert.equal(lock.skills[0]!.id,'local-skill');assert.equal(lock.connectors[0]!.id,'local-notes')
  const before=(await engine.list()).length
  for(const bindings of [{ skills:{ report:'foreign-skill' },connectors:{} },{ skills:{},connectors:{ notes:'expert-mcp-hidden' } },{ skills:{ undeclared:'local-skill' },connectors:{} }])await assert.rejects(engine.dispatch('import',{ manifest:source.manifest,bindings }),/expert_dependencies_missing|expert_invalid/)
  await assert.rejects(engine.dispatch('import',{ manifest:{ ...source.manifest,bindings:source.bindings } }),/expert_invalid/)
  assert.equal((await engine.list()).length,before)
}))
