import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp,mkdir,writeFile,readdir,rm,symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Experts } from '../src/main.ts'
import { parseManifest } from '../src/schema.ts'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import type { Expert, ExpertManifest } from '../src/contracts.ts'
type ExpertOptions = ConstructorParameters<typeof Experts>[0]
type Connector = Awaited<ReturnType<ExpertOptions['connectors']>>[number]
interface Fixture {
  engine: Experts
  options: ExpertOptions
  root: string
  dir: string
  def: SkillDefinition
  disable(): void
  update(): void
  account(value: string): void
  connections(value: Connector[]): void
}
const base=():Expert=>({ manifest:{ schemaVersion:1,id:'report',version:'1.0.0',name:'周报助手',description:'整理周报',avatar:'',tags:[],instructions:'EXPERT_RULE {{literal}}',conversationStarters:[],skills:[{ key:'report',label:'周报技能',required:true,load:'always' }],connectors:[{ key:'notes',label:'资料服务',required:true }] },bindings:{ skills:{ report:'local-skill' },connectors:{ notes:'local-notes' } },revision:0 })
async function fixture(fn:(f:Fixture)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'actvero-expert-test-'));try{
  const dir=join(root,'package');await mkdir(dir);await writeFile(join(dir,'SKILL.md'),'SKILL_A')
  let enabled=true,account='member-a',version='v1'
  let rows:Connector[]=[{ id:'local-notes',name:'notes',description:'Notes',ready:true,inventory:{ tools:['read'],prompts:[],resources:[] } }]
  const def:SkillDefinition={ name:'report',description:'Report',content:'SKILL_A',provider:'actvero-skills',source:'actvero',invocation:{ modelInvocable:true,userInvocable:true },resourceBase:{ kind:'directory',path:dir } }
  const options:ExpertOptions={ root:join(root,'experts'),changed:()=>{},scope:()=>account,skills:{ hostList:async()=>enabled?[{ id:'local-skill',name:'report',description:'Report',versionId:version }]:[],hostGet:async(id:string,v:string)=>enabled&&id==='local-skill'&&v===version?def:undefined },connectors:async()=>rows }
  const engine=new Experts(options)
  await fn({ engine,options,root,dir,def,disable:()=>{enabled=false},update:()=>{version='v2'},account:(v:string)=>{account=v},connections:(v:Connector[])=>{rows=v} })
}finally{await rm(root,{ recursive:true,force:true })}}
test('expert saves are revision checked; export excludes bindings; import gets a new identity',()=>fixture(async({ engine })=>{
  const saved=await engine.save(base());assert.equal(saved.revision,1);await assert.rejects(engine.save(base()),/expert_edit_conflict/)
  const next=await engine.save(saved);assert.equal(next.manifest.version,'1.0.1')
  const exported=await engine.dispatch('export',{ id:'report' }) as ExpertManifest;assert.equal(Reflect.get(exported,'bindings'),undefined);assert.equal(exported.instructions,'EXPERT_RULE {{literal}}')
  const resolved=await engine.dispatch('get',{ id:'report' }) as Expert;assert.equal(resolved.manifest.name,'周报助手')
  const imported=await engine.dispatch('import',{ manifest:exported }) as Expert;assert.notEqual(imported.manifest.id,'report');assert.deepEqual(imported.bindings,{ skills:{},connectors:{} })
  assert.equal((await engine.inspect(imported.manifest.id)).ready,false)
}))
test('snapshot survives engine restart and deleting editable expert, retaining exact version',()=>fixture(async({ engine,options })=>{
  await engine.save(base());const lock=await engine.prepare('report');await engine.remove('report');const restored=new Experts(options);const runtime=await restored.resolve(lock.id)
  assert.equal(runtime.expert.version,'1.0.0');assert.equal(runtime.skills[0]!.content,'SKILL_A');assert.deepEqual(runtime.connectors,['local-notes']);assert.deepEqual(await restored.list(),[])
}))
test('same-name binding to a different ID is not silently substituted',()=>fixture(async({ engine })=>{
  const expert=base();expert.bindings.skills.report='local-different';await engine.save(expert);await assert.rejects(engine.prepare('report'),/expert_dependencies_missing/)
}))
test('changed supporting file and symlink invalidate the entire required skill package',()=>fixture(async({ engine,dir })=>{
  await engine.save(base());const lock=await engine.prepare('report');await writeFile(join(dir,'references.md'),'changed');await assert.rejects(engine.resolve(lock.id),/expert_skill_changed/)
  await rm(join(dir,'references.md'));await symlink(join(dir,'SKILL.md'),join(dir,'linked'));await assert.rejects(engine.resolve(lock.id),/expert_skill_changed/)
}))
test('changed parsed instructions also invalidate skill identity',()=>fixture(async({ engine,def })=>{
  await engine.save(base());const lock=await engine.prepare('report');def.content='CHANGED';await assert.rejects(engine.resolve(lock.id),/expert_skill_changed/)
}))
test('disabled and upgraded required skills stop old snapshots',async()=>{
  for(const action of ['disable','update'] as const)await fixture(async(f:Fixture)=>{await f.engine.save(base());const lock=await f.engine.prepare('report');f[action]();await assert.rejects(f.engine.resolve(lock.id),/expert_skill_changed/)})
})
test('optional dependency absence is explicit and never broadens the runtime catalog',()=>fixture(async({ engine })=>{
  const expert=base();expert.manifest.skills[0]!.required=false;expert.bindings.skills.report='local-missing';await engine.save(expert);const lock=await engine.prepare('report');const runtime=await engine.resolve(lock.id);assert.deepEqual(runtime.skills,[]);assert.deepEqual(runtime.warnings,['周报技能'])
}))
test('MCP capability changes invalidate required bindings',()=>fixture(async({ engine,connections })=>{
  await engine.save(base());const lock=await engine.prepare('report');connections([{ id:'local-notes',name:'notes',description:'Notes',ready:true,inventory:{ tools:['write'] } }]);await assert.rejects(engine.resolve(lock.id),/expert_connector_changed/)
}))
test('platform bindings cannot move between accounts',()=>fixture(async({ engine,connections,account })=>{
  const expert=base();expert.bindings.connectors.notes='remote-notes';connections([{ id:'remote-notes',name:'notes',description:'Notes',ready:true,inventory:{ tools:['read'] } }]);await engine.save(expert);const lock=await engine.prepare('report');account('member-b');await assert.rejects(engine.resolve(lock.id),/expert_connector_changed/)
}))
test('dependency checks leave no abandoned snapshots; creator uses normal validation',()=>fixture(async({ engine,root })=>{
  await engine.save(base());assert.equal((await engine.inspect('report')).ready,true);assert.deepEqual(await readdir(join(root,'experts/snapshots')),[])
  const expert=base();const created=await engine.dispatch('create',{ expert }) as Expert;assert.notEqual(created.manifest.id,'report');assert.equal(created.revision,1)
  assert.equal(created.manifest.avatar, '')
  const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rCkAAAAASUVORK5CYII='
  const withAvatar = await engine.dispatch('create', { expert: { ...expert, manifest: { ...expert.manifest, avatar } } }) as Expert
  assert.equal((await engine.get(withAvatar.manifest.id)).manifest.avatar, avatar)
  await assert.rejects(engine.dispatch('create',{ expert:{ manifest:{ ...expert.manifest,instructions:'' } } }),/expert_invalid/)
}))
test('strict manifests reject unsupported versions, remote avatars and undeclared fields',()=>{
  for(const extra of [{ schemaVersion:2 },{ id:'../escape' },{ id:'__proto__' },{ skills:[{ key:'constructor',label:'Unsafe key',required:true,load:'always' }] },{ avatar:'https://example.com/avatar.png' },{ token:'secret' },{ version:'latest' }])assert.throws(()=>parseManifest({ ...base().manifest,...extra }),/expert_/)
})

test('authoring patches retain local identity and only one concurrent edit wins', () => fixture(async ({ engine }: { engine: Experts }) => {
  const original = base()
  original.manifest.avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rCkAAAAASUVORK5CYII='
  const saved = await engine.save(original)
  const id = saved.manifest.id
  const lock = await engine.prepare(id)

  const { avatar: _avatar, ...manifest } = saved.manifest
  assert.deepEqual(await engine.dispatch('author-get', { id }), {
    manifest,
    bindings: original.bindings,
    revision: 1,
    hasAvatar: true,
  })
  assert.deepEqual(await engine.dispatch('author-list', { query: '周报' }), {
    items: [{ id, name: original.manifest.name, description: original.manifest.description, version: '1.0.0', revision: 1 }],
    total: 1,
  })
  assert.deepEqual(await engine.dispatch('author-list', { query: '周报', page: 2 }), { items: [], total: 1 })

  const patch = { manifest: { instructions: '先按项目归纳成果，再整理阻碍。' } }
  const edits = await Promise.allSettled([
    engine.dispatch('author-update', { id, revision: 1, patch }),
    engine.dispatch('author-update', { id, revision: 1, patch }),
  ])
  assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1)
  const conflict = edits.find(result => result.status === 'rejected')
  assert.match(String(conflict?.reason), /expert_edit_conflict/)

  const updated = await engine.get(id)
  assert.deepEqual(updated, {
    manifest: { ...saved.manifest, ...patch.manifest, version: '1.0.1' },
    bindings: saved.bindings,
    revision: 2,
  })
  assert.deepEqual((await engine.resolve(lock.id)).expert, saved.manifest)
  assert.deepEqual(await engine.dispatch('author-check', { id }), { ready: true, warnings: [], missing: [] })
  await assert.rejects(engine.dispatch('author-update', { id, revision: 2, patch: { manifest: { id: 'other' } } }), /expert_invalid/)
  await assert.rejects(engine.dispatch('author-update', { id: 'remote-report', revision: 1, patch }), /expert_remote_readonly/)
  assert.deepEqual(await engine.get(id), updated)
}))

test('expert categories remain compatible with old packages and round-trip through import',()=>fixture(async({ engine })=>{
  const legacy=base();assert.equal(parseManifest(legacy.manifest).category,'general')
  const expert=base();expert.manifest.category='engineering';await engine.save(expert)
  const exported=await engine.dispatch('export',{ id:'report' });const imported=await engine.dispatch('import',{ manifest:exported }) as Expert
  assert.equal(imported.manifest.category,'engineering')
  assert.throws(()=>parseManifest({ ...legacy.manifest,category:'unknown' }),/expert_invalid/)
}))

test('recent experts persist successful selections only, reorder without duplicates and ignore removed items',()=>fixture(async({ engine,options })=>{
  await engine.save(base());const other=base();other.manifest.id='other';await engine.save(other)
  await engine.inspect('report');await engine.prepare('report');assert.deepEqual(await engine.recent(),[])
  await engine.recordUse('report');await engine.recordUse('other');await engine.recordUse('report')
  const restored=new Experts(options);assert.deepEqual((await restored.recent()).map(e=>e.manifest.id),['report','other'])
  await assert.rejects(engine.recordUse('missing'));assert.deepEqual((await engine.recent()).map((e:Expert)=>e.manifest.id),['report','other'])
  await engine.remove('report');assert.deepEqual((await engine.recent()).map((e:Expert)=>e.manifest.id),['other'])
  assert.equal(Reflect.get((await engine.dispatch('export',{ id:'other' })) as ExpertManifest,'history'),undefined)
}))

test('import binds explicitly selected local capabilities and rejects unknown or embedded bindings',()=>fixture(async({ engine })=>{
  const source=base();const imported=await engine.dispatch('import',{ manifest:source.manifest,bindings:source.bindings }) as Expert
  assert.notEqual(imported.manifest.id,source.manifest.id);assert.equal((await engine.inspect(imported.manifest.id)).ready,true)
  const lock=await engine.prepare(imported.manifest.id);assert.equal(lock.skills[0]!.id,'local-skill');assert.equal(lock.connectors[0]!.id,'local-notes')
  const before=(await engine.list()).length
  for(const bindings of [{ skills:{ report:'foreign-skill' },connectors:{} },{ skills:{},connectors:{ notes:'expert-mcp-hidden' } },{ skills:{ undeclared:'local-skill' },connectors:{} }])await assert.rejects(engine.dispatch('import',{ manifest:source.manifest,bindings }),/expert_dependencies_missing|expert_invalid/)
  await assert.rejects(engine.dispatch('import',{ manifest:{ ...source.manifest,bindings:source.bindings } }),/expert_invalid/)
  assert.equal((await engine.list()).length,before)
}))
