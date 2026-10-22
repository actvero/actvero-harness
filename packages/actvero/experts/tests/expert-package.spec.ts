import { it,expect } from 'vitest'
import { mkdtemp,rm,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { ExpertPackages,Experts } from '../src/main.ts'
import { LocalSkills } from '../../skills/src/local.ts'
import { LocalConnectors } from '../../connectors/src/local-mcp.ts'
import type { ExpertManifest } from '../src/contracts.ts'
const manifest:ExpertManifest={ schemaVersion:1,id:'fixture',version:'1.0.0',name:'Package expert',description:'Fixture',avatar:'',tags:[],instructions:'Use the writing skill',conversationStarters:[],skills:[{ key:'write',label:'Writer',required:true,load:'always' }],connectors:[{ key:'notes',label:'Notes',required:true }] }
const encode=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v))
const skill=()=>new TextEncoder().encode('---\nname: package-writer\ndescription: Write notes\n---\nWrite concise notes.')
async function fixture(work:(value:{
  packages:ExpertPackages
  local:LocalSkills
  mcp:LocalConnectors
  engine:Experts
  archive:(change?:Map<string,Uint8Array>)=>Uint8Array
  root:string
  failSave:()=>void
})=>Promise<void>,options:{ firstParty?:string;withoutConnector?:boolean }={}){
  const root=await mkdtemp(join(tmpdir(),'actvero-package-'));let stored:unknown=[],saveFailure=false;const local=new LocalSkills({ root:join(root,'skills'),changed:()=>{},syncHost:async()=>{} }),mcp=new LocalConnectors({ load:async()=>stored,save:async (v)=>{stored=structuredClone(v)},openExternal:async()=>{throw new Error('must_not_authorize')} },()=>{})
  const engine=new Experts({ root:join(root,'experts'),scope:()=>undefined,changed:()=>{},skills:local,connectors:async()=>[] })
  const packages=new ExpertPackages({ list:()=>engine.list(),get:id=>engine.get(id),packageOrigin:id=>engine.packageOrigin(id),saveImported:async (e,origin)=>{if(saveFailure)throw new Error('test_write_failed');return engine.saveImported(e,origin)} },{ platform:()=>undefined,scope:()=>undefined,pack:f=>local.pack(f),unpack:b=>local.unpack(b),skills:{ state:async()=>({ items:await local.state() }),preview:(f,n)=>local.previewFiles(f,n),discard:t=>local.discard(t),install:(t,replace)=>local.install(t,replace),restore:(id,expected,version)=>local.restoreVersion(id,expected,version),remove:id=>local.uninstall(id),files:id=>local.exportFiles(id),authorized:async()=>false },connectors:{ list:()=>mcp.list(),template:v=>mcp.template(v),portable:id=>mcp.portable(id),save:v=>mcp.saveDisabled(v),remove:id=>mcp.remove(id),authorized:async()=>false,fingerprint:async()=>{throw new Error('denied')},firstParty: async (_key: string, _name: string) => options.firstParty } })
  const archive=(changes?:Map<string,Uint8Array>)=>{const files=new Map<string,Uint8Array>([['expert.json',encode(manifest)],['dependencies.json',encode({ schemaVersion:1,skills:[{ key:'write',source:'local',path:'skills/writer' }],connectors:[{ key:'notes',source:'local',path:'connectors/notes.json' }] })],['skills/writer/SKILL.md',skill()],['connectors/notes.json',encode({ name:'Package Notes',transport:'http',url:'http://127.0.0.1:1/mcp',auth:'bearer' })]]);for(const [path,bytes] of changes??[])files.set(path,bytes);if(options.withoutConnector){const m=JSON.parse(new TextDecoder().decode(files.get('expert.json')));m.connectors=[];files.set('expert.json',encode(m));const refs=JSON.parse(new TextDecoder().decode(files.get('dependencies.json')));refs.connectors=[];files.set('dependencies.json',encode(refs));files.delete('connectors/notes.json')}files.set('package.json',encode({ format:'actvero-expert',schemaVersion:1,files:[...files].map(([path,bytes])=>({ path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex') })) }));return local.pack(files)}
  try{await work({ packages,local,mcp,engine,archive,root,failSave:()=>{saveFailure=true} })}
  finally{await mcp.dispose();await rm(root,{ recursive:true,force:true })}
}
it('previews without starting a server, imports missing dependencies disabled and round-trips exact reuse',()=>fixture(async({ packages,local,mcp,engine,archive })=>{
  const plan=await packages.preview(archive());expect(plan.rows.map(r=>r.status)).toEqual(['install','install']);expect(await local.state()).toEqual([]);expect(await mcp.list()).toEqual([])
  const imported=await packages.import(plan.token);expect(imported.manifest.id).not.toBe('fixture');expect((await mcp.list())[0]).toMatchObject({ enabled:false,status:'disabled',hasToken:false });expect(await engine.list()).toHaveLength(1)
  const second=await packages.preview(archive());expect(second.rows.map(r=>r.status)).toEqual(['reuse','reuse']);expect((await packages.import(second.token)).manifest.id).toBe(imported.manifest.id);expect(await local.state()).toHaveLength(1)
  const exported=await packages.export(imported.manifest.id);const roundtrip=await packages.preview(exported.bytes);expect(roundtrip.canImport).toBe(true);expect(roundtrip.rows.map(r=>r.status)).toEqual(['reuse','reuse'])
}))
it('allows an expert to be deleted and imported again while reusing its dependencies',()=>fixture(async({ packages,local,mcp,engine,archive })=>{
  const imported=await packages.import((await packages.preview(archive())).token)
  await engine.remove(imported.manifest.id)
  expect(await engine.list()).toEqual([])
  const plan=await packages.preview(archive());expect(plan.canImport).toBe(true);expect(plan.rows.map(r=>r.status)).toEqual(['reuse','reuse'])
  const restored=await packages.import(plan.token)
  expect(restored.manifest.name).toBe(imported.manifest.name);expect(restored.manifest.id).not.toBe(imported.manifest.id)
  expect(await local.state()).toHaveLength(1);expect(await mcp.list()).toHaveLength(1)
}))
it('reuses a managed first-party connector during expert import',()=>fixture(async({ packages,mcp,engine,archive })=>{
  const plan=await packages.preview(archive());expect(plan.rows.map(r=>r.status)).toEqual(['install','reuse']);expect(plan.rows[1]!.id).toBe('local-managed')
  const imported=await packages.import(plan.token);expect(imported.bindings.connectors.notes).toBe('local-managed');expect(await mcp.list()).toEqual([]);expect(await engine.list()).toHaveLength(1)
},{ firstParty:'local-managed' }))
it('refuses same-name differing content and preserves installed files',()=>fixture(async({ packages,local,archive })=>{
  await packages.import((await packages.preview(archive())).token);const changed=await packages.preview(archive(new Map([['skills/writer/SKILL.md',new TextEncoder().encode('---\nname: package-writer\ndescription: Write notes\n---\nDifferent behavior')]])));expect(changed.canImport).toBe(false);expect(changed.operation).toBe('conflict');expect(changed.reason).toBe('version');await expect(packages.import(changed.token)).rejects.toThrow('expert_package_changed');expect(await local.state()).toHaveLength(1)
}))
it('rolls back only its newly installed dependencies when the expert write fails',()=>fixture(async({ packages,local,mcp,engine,archive,failSave })=>{
  const plan=await packages.preview(archive());failSave();await expect(packages.import(plan.token)).rejects.toThrow('test_write_failed');expect(await local.state()).toEqual([]);expect(await mcp.list()).toEqual([]);expect(await engine.list()).toEqual([])
}))
it('rejects secret-bearing templates, corrupt checksums, extra payload files and platform-to-local copies',()=>fixture(async({ packages,local,archive })=>{
  await expect(packages.preview(archive(new Map([['connectors/notes.json',encode({ name:'Bad',url:'http://localhost/mcp',auth:'bearer',token:'fixture-secret' })]])))).rejects.toThrow('unsafe_template')
  const files=local.unpack(archive());files.set('expert.json',encode({ ...manifest,name:'Tampered' }));await expect(packages.preview(local.pack(files))).rejects.toThrow('expert_package_checksum')
  await expect(packages.preview(archive(new Map([['payload.sh',new TextEncoder().encode('never execute')]])))).rejects.toThrow('expert_package_invalid')
  await expect(packages.preview(archive(new Map([['dependencies.json',encode({ schemaVersion:1,skills:[{ key:'write',source:'platform',path:'skills/writer',id:'platform-skill' }],connectors:[] })]])))).rejects.toThrow('expert_package_invalid')
}))
it('rechecks modified installed files before committing a reuse plan',()=>fixture(async({ packages,local,archive,root })=>{
  const first=await packages.import((await packages.preview(archive())).token),preview=await packages.preview(archive());await writeFile(join(root,'skills/packages',first.bindings.skills.write!,'SKILL.md'),'changed');await expect(packages.import(preview.token)).rejects.toThrow('expert_package_changed');expect(await local.state()).toHaveLength(1)
}))
const upgrade = (version='1.1.0') => new Map<string,Uint8Array>([
  ['expert.json',encode({ ...manifest,version,name:'Updated package expert' })],
  ['skills/writer/SKILL.md',new TextEncoder().encode('---\nname: package-writer\ndescription: Write notes\n---\nUpdated writing instructions.')],
  ['connectors/notes.json',encode({ name:'Package Notes',transport:'http',url:'http://127.0.0.1:2/mcp',auth:'bearer' })],
])
it('updates a stable package identity, keeps old skill versions and creates a disabled MCP revision',()=>fixture(async({ packages,local,mcp,engine,archive,root })=>{
  const original=await packages.import((await packages.preview(archive())).token)
  const before=(await local.state())[0]!,definition=await local.hostGet(before.skill.id,before.version.id)
  const oldConnection=await mcp.portable(original.bindings.connectors.notes!)
  const plan=await packages.preview(archive(upgrade()))
  expect(plan).toMatchObject({ operation:'update',previousVersion:'1.0.0',version:'1.1.0',canImport:true })
  expect(plan.rows.map(row=>row.status)).toEqual(['update','update'])
  const updated=await packages.import(plan.token)
  expect(updated.manifest).toMatchObject({ id:original.manifest.id,name:'Updated package expert',version:'1.1.0' })
  expect(updated.bindings.skills).toEqual(original.bindings.skills)
  expect(updated.bindings.connectors.notes).not.toBe(original.bindings.connectors.notes)
  expect(await mcp.portable(original.bindings.connectors.notes!)).toEqual(oldConnection)
  expect((await mcp.list()).find(row=>row.id===updated.bindings.connectors.notes)).toMatchObject({ enabled:false,hasToken:false })
  const current=(await local.state())[0]!
  expect(current.version.id).not.toBe(before.version.id)
  expect((await local.hostGet(current.skill.id,current.version.id))?.content).toContain('Updated writing')
  expect(await local.hostGet(before.skill.id,before.version.id)).toEqual(definition)
  const restarted=new LocalSkills({ root:join(root,'skills'),changed:()=>{},syncHost:async()=>{} })
  expect(await restarted.hostGet(before.skill.id,before.version.id)).toEqual(definition)
  expect(await engine.list()).toHaveLength(1)
  const repeated=await packages.preview(archive(upgrade()))
  expect(repeated.operation).toBe('current')
  expect((await packages.import(repeated.token)).revision).toBe(updated.revision)
  expect((await packages.preview((await packages.export(updated.manifest.id)).bytes)).operation).toBe('current')
}))
it('rolls back updated skill selection and new MCP config when the final expert write fails',()=>fixture(async({ packages,local,mcp,engine,archive,failSave })=>{
  const original=await packages.import((await packages.preview(archive())).token),before=await local.state()
  const plan=await packages.preview(archive(upgrade()));failSave()
  await expect(packages.import(plan.token)).rejects.toThrow('test_write_failed')
  expect(await local.state()).toEqual(before)
  expect(await engine.get(original.manifest.id)).toEqual(original)
  expect(await mcp.list()).toHaveLength(1)
}))
it('blocks local edits and shared skill replacement, and rechecks the expert revision at commit',()=>fixture(async({ packages,engine,archive })=>{
  const original=await packages.import((await packages.preview(archive())).token)
  const plan=await packages.preview(archive(upgrade()))
  const shared=await engine.save({ ...original,manifest:{ ...original.manifest,id:'other-owner' },revision:0 })
  expect((await packages.preview(archive(upgrade()))).rows[0]!.status).toBe('conflict')
  await expect(packages.import(plan.token)).rejects.toThrow('expert_package_changed')
  await engine.remove(shared.manifest.id)
  await engine.save({ ...original,manifest:{ ...original.manifest,instructions:'Local customization' } })
  expect(await packages.preview(archive(upgrade('2.0.0')))).toMatchObject({ canImport:false,reason:'local_changes' })
}))
it('adopts a single legacy import only through a reviewed higher version and rejects downgrades',()=>fixture(async({ packages,engine,archive,root })=>{
  const original=await packages.import((await packages.preview(archive())).token)
  await writeFile(join(root,'experts/items',original.manifest.id+'.json'),JSON.stringify(original))
  const changes=upgrade();changes.set('expert.json',encode({ ...manifest,version:'1.1.0' }))
  const plan=await packages.preview(archive(changes));expect(plan).toMatchObject({ legacy:true,operation:'update',canImport:true })
  const updated=await packages.import(plan.token);expect(updated.manifest.id).toBe(original.manifest.id)
  expect(await engine.packageOrigin(updated.manifest.id)).toMatchObject({ sourceId:manifest.id })
  expect(await packages.preview(archive())).toMatchObject({ canImport:false,reason:'version' })
}))
it('refuses modified or extra local skill files during package update',()=>fixture(async({ packages,archive,root })=>{
  const original=await packages.import((await packages.preview(archive())).token)
  await writeFile(join(root,'skills/packages',original.bindings.skills.write!,'local-note.txt'),'keep this file')
  expect((await packages.preview(archive(upgrade()))).rows[0]!.status).toBe('conflict')
}))

it('keeps an existing conversation on its exact local skill and expert release after update',()=>fixture(async({ packages,engine,archive })=>{
  const original=await packages.import((await packages.preview(archive())).token)
  const lock=await engine.prepare(original.manifest.id)
  const before=await engine.resolve(lock.id)
  const updated=await packages.import((await packages.preview(archive(upgrade()))).token)
  expect(await engine.resolve(lock.id)).toEqual(before)
  const next=await engine.resolve((await engine.prepare(updated.manifest.id)).id)
  expect(next.expert.version).toBe('1.1.0')
  expect(next.skills[0]!.content).toContain('Updated writing')
},{ withoutConnector:true }))
it('repairs a removed dependency from the exact same package without creating another expert',()=>fixture(async({ packages,local,archive })=>{
  const original=await packages.import((await packages.preview(archive())).token)
  await local.uninstall(original.bindings.skills.write!)
  const repair=await packages.preview(archive())
  expect(repair).toMatchObject({ operation:'update',canImport:true,version:'1.0.0' })
  const restored=await packages.import(repair.token)
  expect(restored.manifest).toEqual(original.manifest)
  expect(restored.bindings.skills.write).not.toBe(original.bindings.skills.write)
}))
