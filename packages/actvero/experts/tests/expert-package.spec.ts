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
async function fixture(work:(value:{ packages:ExpertPackages;local:LocalSkills;mcp:LocalConnectors;engine:Experts;archive:(change?:Map<string,Uint8Array>)=>Uint8Array;root:string;failSave:()=>void })=>Promise<void>,options:{ firstParty?:string }={}){
  const root=await mkdtemp(join(tmpdir(),'actvero-package-'));let stored:unknown=[],saveFailure=false;const local=new LocalSkills({ root:join(root,'skills'),changed:()=>{},syncHost:async()=>{} }),mcp=new LocalConnectors({ load:async()=>stored,save:async (v)=>{stored=structuredClone(v)},openExternal:async()=>{throw new Error('must_not_authorize')} },()=>{})
  const engine=new Experts({ root:join(root,'experts'),scope:()=>undefined,changed:()=>{},skills:local,connectors:async()=>[] })
  const packages=new ExpertPackages({ list:()=>engine.list(),get:id=>engine.get(id),save:async (e)=>{if(saveFailure)throw new Error('test_write_failed');return engine.save(e)} },{ platform:()=>undefined,scope:()=>undefined,pack:f=>local.pack(f),unpack:b=>local.unpack(b),skills:{ state:async()=>({ items:await local.state() }),preview:(f,n)=>local.previewFiles(f,n),discard:t=>local.discard(t),install:t=>local.install(t),remove:id=>local.uninstall(id),files:id=>local.exportFiles(id),authorized:async()=>false },connectors:{ list:()=>mcp.list(),template:v=>mcp.template(v),portable:id=>mcp.portable(id),save:v=>mcp.saveDisabled(v),remove:id=>mcp.remove(id),authorized:async()=>false,fingerprint:async()=>{throw new Error('denied')},firstParty: async (_key: string, _name: string) => options.firstParty } })
  const archive=(changes?:Map<string,Uint8Array>)=>{const files=new Map<string,Uint8Array>([['expert.json',encode(manifest)],['dependencies.json',encode({ schemaVersion:1,skills:[{ key:'write',source:'local',path:'skills/writer' }],connectors:[{ key:'notes',source:'local',path:'connectors/notes.json' }] })],['skills/writer/SKILL.md',skill()],['connectors/notes.json',encode({ name:'Package Notes',transport:'http',url:'http://127.0.0.1:1/mcp',auth:'bearer' })]]);for(const [path,bytes] of changes??[])files.set(path,bytes);files.set('package.json',encode({ format:'actvero-expert',schemaVersion:1,files:[...files].map(([path,bytes])=>({ path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex') })) }));return local.pack(files)}
  try{await work({ packages,local,mcp,engine,archive,root,failSave:()=>{saveFailure=true} })}finally{await mcp.dispose();await rm(root,{ recursive:true,force:true })}
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
  const restored=await packages.import(plan.token);expect(restored.manifest.name).toBe(imported.manifest.name);expect(restored.manifest.id).not.toBe(imported.manifest.id)
  expect(await local.state()).toHaveLength(1);expect(await mcp.list()).toHaveLength(1)
}))
it('reuses a managed first-party connector during expert import',()=>fixture(async({ packages,mcp,engine,archive })=>{
  const plan=await packages.preview(archive());expect(plan.rows.map(r=>r.status)).toEqual(['install','reuse']);expect(plan.rows[1]!.id).toBe('local-managed')
  const imported=await packages.import(plan.token);expect(imported.bindings.connectors.notes).toBe('local-managed');expect(await mcp.list()).toEqual([]);expect(await engine.list()).toHaveLength(1)
},{ firstParty:'local-managed' }))
it('refuses same-name differing content and preserves installed files',()=>fixture(async({ packages,local,archive })=>{
  await packages.import((await packages.preview(archive())).token);const changed=await packages.preview(archive(new Map([['skills/writer/SKILL.md',new TextEncoder().encode('---\nname: package-writer\ndescription: Write notes\n---\nDifferent behavior')]])));expect(changed.canImport).toBe(false);expect(changed.rows[0]!.status).toBe('conflict');await expect(packages.import(changed.token)).rejects.toThrow('expert_package_changed');expect(await local.state()).toHaveLength(1)
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
