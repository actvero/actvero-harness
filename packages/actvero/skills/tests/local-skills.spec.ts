import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp,mkdir,writeFile,readFile,rm,symlink,access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync,strToU8 } from 'fflate'
import { Skills } from '../src/main.ts'
const content='---\nname: acceptance-skill\ndescription: Local acceptance skill\n---\n\nUse references/notes.md.\n'
async function setup(){const root=await mkdtemp(join(tmpdir(),'actvero-local-skills-'));let failSync=false;const main=new Skills({ root:join(root,'store'),identity:()=>undefined,issue:async()=>{throw new Error('no login expected')},openExternal:async()=>{},changed:()=>{},syncHost:async()=>{if(failSync)throw new Error('skill_registration_failed')} });return { root,main,setFail:()=>{failSync=true},cleanup:()=>rm(root,{ recursive:true,force:true }) }}
test('folder import copies complete package and works signed out; uninstall preserves original files',async()=>{
  const s=await setup();try{const source=join(s.root,'original');await mkdir(join(source,'references'),{ recursive:true });await writeFile(join(source,'SKILL.md'),content);await writeFile(join(source,'references/notes.md'),'Notes')
    const p=await s.main.local.preview(source);assert.equal(p.skill.current_version.version,'');await s.main.dispatch('localImport',{ token:p.token });const state=await s.main.state();assert.equal(state.available,false);assert.equal(state.items[0]!.skill.source,'local');const host=await s.main.hostList();assert.equal(host.length,1);const definition=await s.main.hostGet(host[0]!.id,host[0]!.versionId);assert.ok(definition?.resourceBase);assert.ok(definition?.path?.includes('/store/local/packages/'))
    await s.main.dispatch('enable',{ id:p.skill.id,enabled:false });assert.equal((await s.main.hostList()).length,0);await s.main.dispatch('enable',{ id:p.skill.id,enabled:true });assert.equal((await s.main.hostList()).length,1)
    await s.main.dispatch('uninstall',{ id:p.skill.id });assert.deepEqual((await s.main.state()).items,[]);assert.equal(await readFile(join(source,'SKILL.md'),'utf8'),content);await assert.rejects(access(join(s.root,'store/local/packages',p.skill.id)))
  }finally{await s.cleanup()}
})
test('Markdown, nested ZIP, metadata version, same-name protection and preview expiry',async()=>{const s=await setup();try{
  const md=join(s.root,'any.md');await writeFile(md,content);const p=await s.main.local.preview(md);await s.main.local.install(p.token);await assert.rejects(s.main.local.install(p.token),/preview_expired/)
  const duplicate=await s.main.local.preview(md);await assert.rejects(s.main.local.install(duplicate.token),/skill_name_conflict/);s.main.local.discard(duplicate.token)
  const zip=join(s.root,'archive.zip');await writeFile(zip,zipSync({ 'wrapper/sample/SKILL.md':strToU8(content.replace('acceptance-skill','second-skill').replace('---\n\n','metadata:\n  version: "2.0"\n---\n\n')),'wrapper/sample/references/a.txt':strToU8('zip resource') }));const second=await s.main.local.preview(zip);assert.equal(second.skill.current_version.version,'2.0');await s.main.local.install(second.token);assert.equal((await s.main.state()).items.length,2)
}finally{await s.cleanup()}})
test('reject symlinks, missing metadata, traversal and multiple skills; rollback registration; preserve local edits',async()=>{const s=await setup();try{
  const bad=join(s.root,'bad.md');await writeFile(bad,'No metadata');await assert.rejects(s.main.local.preview(bad),/invalid_skill/);const md=join(s.root,'good.md');await writeFile(md,content);const link=join(s.root,'linked.md');await symlink(md,link);await assert.rejects(s.main.local.preview(link),/unsafe_package/)
  const zip=join(s.root,'bad.zip');await writeFile(zip,zipSync({ 'a/SKILL.md':strToU8(content),'b/SKILL.md':strToU8(content) }));await assert.rejects(s.main.local.preview(zip),/multiple_skills/);await writeFile(zip,zipSync({ '../SKILL.md':strToU8(content) }));await assert.rejects(s.main.local.preview(zip),/unsafe_package/)
  const p=await s.main.local.preview(md);await s.main.local.install(p.token);const dest=join(s.root,'store/local/packages',p.skill.id,'SKILL.md');await writeFile(dest,content+'Local edit');await assert.rejects(s.main.local.uninstall(p.skill.id),/local_changes/);assert.ok((await readFile(dest,'utf8')).endsWith('Local edit'))
}finally{await s.cleanup()}const r=await setup();try{await writeFile(join(r.root,'skill.md'),content);const p=await r.main.local.preview(join(r.root,'skill.md'));r.setFail();await assert.rejects(r.main.local.install(p.token),/skill_registration_failed/);assert.deepEqual((await r.main.state()).items,[])}finally{await r.cleanup()}})
