import { Connectors } from '@actvero/dsh-connectors/main'
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteExperts } from '../src/remote-main.ts'
import { Experts } from '../src/main.ts'
import type { RemoteSnapshot,RemoteEnvelope } from '../src/remote-types.ts'
import { envelope,hash,canonical } from '../src/remote-contract.ts'
import type { RemoteFixture } from './remote-fixture.mjs'
import { remoteFixture,ids } from './remote-fixture.mjs'
type Harness=RemoteFixture&{
  f:RemoteFixture
  remote:RemoteExperts
  engine:Experts
  root:string
  id:string
  options:ConstructorParameters<typeof RemoteExperts>[0]&{ fetcher:typeof fetch } }
async function remoteLock(engine:Experts,id:string){
  const lock=await engine.prepare(id);assert.ok(lock.remote)
  return { ...lock,remote:lock.remote }
}
async function setup(run:(f:Harness)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'remote-experts-'));const f=remoteFixture();const options={ createConnector:(config:ConstructorParameters<typeof Connectors>[0])=>new Connectors(config),root:join(root,'remote'),identity:()=>f.identity,skills:f.skills,issue:f.issue,fetcher:f.fetcher,changed:()=>{} };const remote=new RemoteExperts(options);const engine=new Experts({ root:join(root,'experts'),scope:()=>f.identity.key,skills:f.skills,remote,connectors:()=>remote.rows(),changed:()=>{} });try{const page=await remote.list();const id=page.items[0]!.manifest.id;await run({ ...f,f,remote,engine,root,id,options })}finally{remote.dispose();await rm(root,{ recursive:true,force:true })}}
test('pinned platform v1 and v2 manifests and digests parse without rewriting release bytes',async()=>{for(const v of [1,2]){const e=JSON.parse(await readFile(new URL(`./expert-release-v${v}.example.json`,import.meta.url),'utf8')) as Pick<RemoteEnvelope,'manifest'|'dependency_refs'>&{ sha256:string };assert.equal(hash(canonical({ manifest:e.manifest,dependency_refs:e.dependency_refs })),e.sha256);assert.ok(envelope({ contract_version:v,expert_id:e.manifest.id,name:e.manifest.name,description:e.manifest.description,avatar:'',tags:[],category:{ id:'dynamic',name:'任意分类' },metadata_revision:1,release:{ id:ids.release,version:'1.0.0',sha256:e.sha256 },...e }))}})
test('remote catalog, dynamic categories, exact skill installation and scoped MCP assembly',()=>setup(async({ remote,engine,id,f })=>{assert.equal((await remote.categories())[0]!.id,'dynamic-engineering');const plan=await remote.plan(id);assert.equal(f.installs,0);assert.equal(plan.dependencies[0]!.action,'install');await remote.stage(id);assert.equal(f.installs,2);const lock=await remoteLock(engine,id),runtime=await engine.resolve(lock.id);assert.equal(runtime.skills[0]!.content,'REMOTE_ALWAYS_BODY');assert.equal(runtime.skills[1]!.load,'on_demand');assert.ok(runtime.connectors[0]!.startsWith('expert-mcp-'));await remote.select(runtime.connectors[0]!,'session-a');assert.equal((await remote.snapshot(['session-a']))[0]!.inventory.tools.length,1);assert.ok(f.calls.some(r=>r.path.includes('/experts/')));assert.ok(!f.calls.some(r=>r.path==='/api/mcp/services/'+ids.service));await remote.call(runtime.connectors[0]!,'session-a','tools/call',{ name:'search_documents' });await assert.rejects(remote.call(runtime.connectors[0]!,'session-a','tools/call',{ name:'sum_numbers' }),/expert_tool_denied/);await assert.rejects(remote.call(runtime.connectors[0]!,'session-b','tools/call',{ name:'search_documents' }));assert.deepEqual(await engine.recent(),[]);await engine.recordUse(id);assert.equal((await engine.recent())[0]!.manifest.id,id)}))
test('empty MCP tool selection retains prompts, resources and templates',()=>setup(async({ f,remote,engine,id })=>{f.refs.connectors[0]!.tools=[];f.rehash();await remote.list();await remote.plan(id);await remote.stage(id);const lock=await remoteLock(engine,id);const [row]=await remote.snapshot([]);assert.ok(row);assert.equal(row.inventory.tools.length,0);assert.equal(row.inventory.prompts.length,1);assert.equal(row.inventory.resources.length,1);assert.equal(row.inventory.resourceTemplates.length,1);await remote.select(lock.connectors[0]!.id,'s');await assert.rejects(remote.call(lock.connectors[0]!.id,'s','tools/call',{ name:'search_documents' }),/expert_tool_denied/)}))
test('release changes are not silently substituted and require a new catalog selection',()=>setup(async({ f,remote,id })=>{await remote.plan(id);f.state.releaseChanged=true;await assert.rejects(remote.stage(id),/expert_release_changed/);assert.equal(f.installs,0)}))
test('wrong release digests and untrusted endpoints fail before installation',()=>setup(async({ f,remote,id })=>{f.state.badDigest=true;await assert.rejects(remote.plan(id),/expert_remote_checksum/);f.state.badDigest=false;f.state.badEndpoint=true;await assert.rejects(remote.plan(id),/expert_remote_endpoint/);assert.equal(f.installs,0)}))
test('platform returning tools outside the release allowlist blocks preparation',()=>setup(async({ f,remote,id })=>{await remote.plan(id);f.state.rogueTool=true;await assert.rejects(remote.stage(id),/expert_remote_capability_denied/)}))
test('account switch cannot use another account cached expert or bound MCP',()=>setup(async({ f,remote,engine,id })=>{await remote.plan(id);await remote.stage(id);const lock=await remoteLock(engine,id);await remote.select(lock.connectors[0]!.id,'s');f.identity.key='another-member';remote.invalidate();await assert.rejects(engine.resolve(lock.id),/expert_account_changed/);await assert.rejects(remote.get(id));assert.deepEqual(await engine.recent(),[])}))
test('withdrawal blocks existing snapshots; network failure is not reported as withdrawal',()=>setup(async({ f,remote,engine,id })=>{await remote.plan(id);await remote.stage(id);const lock=await remoteLock(engine,id);f.state.visible=false;await assert.rejects(engine.resolve(lock.id),/expert_remote_unavailable/);f.state.visible=true;f.state.network=true;await assert.rejects(engine.resolve(lock.id),/expert_remote_network/);f.state.network=false;assert.equal((await engine.resolve(lock.id)).expert.id,id)}))
test('optional revoked skills are removed from runtime even when their local files remain',()=>setup(async({ f,remote,engine,id })=>{await remote.plan(id);await remote.stage(id);const lock=await remoteLock(engine,id);f.state.optionalDenied=true;const runtime=await engine.resolve(lock.id);assert.deepEqual(runtime.skills.map(r=>r.name),['remote-report']);assert.ok(runtime.warnings.includes('摘要技能'));assert.equal(f.installed.size,2)}))
test('cold restore keeps exact release and capability scope; new release does not replace old instructions',()=>setup(async({ f,remote,engine,id,options,root })=>{await remote.plan(id);await remote.stage(id);const lock=await remoteLock(engine,id);remote.dispose()
  const restored=new RemoteExperts(options);try{const second=new Experts({ root:join(root,'experts'),scope:()=>f.identity.key,skills:f.skills,remote:restored,connectors:()=>restored.rows(),changed:()=>{} });f.state.conflict=true;const runtime=await second.resolve(lock.id);assert.equal(runtime.expert.instructions,'REMOTE_PERSONA');assert.equal(runtime.connectors[0]!,lock.connectors[0]!.id)}finally{restored.dispose()}}))
test('resource expiry refreshes once; a skill version conflict blocks old runtime',()=>setup(async({ f,remote,engine,id })=>{f.state.tokenExpired=true;await remote.plan(id);await remote.stage(id);const lock=await remoteLock(engine,id);f.state.skillChanged=true;await assert.rejects(engine.resolve(lock.id),/expert_dependencies_missing/)}))

test('recent lookup deduplicates and batches release checks rather than issuing one request per row',()=>setup(async({ f,remote,id })=>{await remote.detail(id);f.calls.length=0;const rows=await remote.recent([id,id]);assert.equal(rows.length,1);assert.equal(f.calls.filter(r=>r.path.endsWith('/check-updates')).length,1);const body=f.calls[0]!.body;assert.ok(body);assert.ok(Array.isArray(body.items));assert.equal(body.items.length,1)}))

test('expert-scoped MCP instances cannot be rebound through the local expert creator',()=>setup(async({ remote,engine,id })=>{await remote.plan(id);await remote.stage(id);const lock=await remoteLock(engine,id);assert.deepEqual((await engine.catalog()).connectors,[]);const local={ manifest:{ ...lock.expert.manifest,id:'local-rebinding',skills:[] },bindings:{ skills:{},connectors:lock.expert.bindings.connectors },revision:0 };await engine.save(local);await assert.rejects(engine.prepare('local-rebinding'),/expert_dependencies_missing/)}))

test('contract v3 checks all four MCP capabilities and uses exact adoption proofs',()=>setup(async({ f,remote,engine,id })=>{await remote.plan(id);await remote.stage(id);const lock=await remoteLock(engine,id);for(const kind of ['tools','prompts','resources','templates'] as const)assert.ok(lock.remote.envelope.dependency_refs.connectors[0]!.capability_contracts?.[kind]);const adopts=f.calls.filter(r=>r.path.endsWith('/adopt'));assert.ok(adopts.every(r=>r.body?.access_version===3&&r.body?.release_id===ids.release&&r.body?.request_id));assert.equal(new Set(adopts.map(r=>r.body?.request_id)).size,1);const resolves=f.calls.filter(r=>r.path.endsWith('/resolve'));assert.ok(resolves.every(r=>r.body?.access_version===3))}))

test('opening exact release details preserves prepared dependencies without reinstalling',()=>setup(async({ remote,engine,id,f })=>{await remote.plan(id);await remote.stage(id);const installs=f.installs;const before=await remoteLock(engine,id);await remote.detail(id);const after=await remoteLock(engine,id);assert.equal(f.installs,installs);assert.deepEqual(after.skills,before.skills);assert.deepEqual(after.connectors,before.connectors);assert.equal((await engine.resolve(after.id)).skills.length,2)}))


const nextRelease='77777777-7777-4777-8777-777777777777'
const latestRelease='88888888-8888-4888-8888-888888888888'
const cachePath=(root:string,id:string)=>join(root,'remote',id+'.json')
function deferred(){let resolve=()=>{};const promise=new Promise<void>((r)=>{resolve=r});return { promise,resolve }}

test('successive releases reset preparation, reuse exact skills and preserve old conversation locks after restart',()=>setup(async({ remote,engine,id,f,root,options })=>{
  await remote.plan(id);await remote.stage(id);const original=await remoteLock(engine,id)
  for(const [release,version] of [[nextRelease,'1.0.4'],[latestRelease,'1.0.5']] as const){
    f.publish(release,version);await remote.list();await remote.detail(id)
    const unprepared=await remote.get(id);assert.deepEqual(unprepared.bindings,{ skills:{},connectors:{} })
    await remote.plan(id);await remote.stage(id);await remote.stage(id)
    const p=JSON.parse(await readFile(cachePath(root,id),'utf8')) as RemoteSnapshot;assert.equal(p.envelope.release.id,release);assert.equal(p.connectors[0]!.endpoint,f.endpoint())
  }
  assert.equal(f.installs,2);assert.equal((await engine.resolve(original.id)).expert.instructions,'REMOTE_PERSONA')
  const current=await remoteLock(engine,id);assert.notEqual(current.connectors[0]!.id,original.connectors[0]!.id)
  remote.dispose()
  const restored=new RemoteExperts(options)
  try{
    await restored.list();await restored.plan(id);await restored.stage(id);assert.equal(f.installs,2)
    assert.equal((await restored.prepare(id)).remote.envelope.release.id,latestRelease)
    await restored.validate(original.remote,original.expert)
  }finally{restored.dispose()}
}))

test('known mixed-release preparation is recovered only by verified current detail and keeps conversation snapshots strict',()=>setup(async({ remote,engine,id,f,root })=>{
  await remote.plan(id);await remote.stage(id);const old=await remoteLock(engine,id)
  f.publish(nextRelease,'1.0.4');const broken={ ...old.remote,envelope:structuredClone(f.wire) };await writeFile(cachePath(root,id),JSON.stringify(broken))
  await assert.rejects(remote.get(id),/expert_remote_cache_stale/);await assert.rejects(remote.validate(broken),/expert_remote_endpoint/)
  await remote.list();await remote.plan(id);const cleared=JSON.parse(await readFile(cachePath(root,id),'utf8')) as RemoteSnapshot;assert.deepEqual(cleared.skills,[]);assert.deepEqual(cleared.connectors,[])
  await remote.stage(id);assert.equal((await remote.prepare(id)).remote.connectors[0]!.endpoint,f.endpoint());assert.equal(f.installs,2)
}))

test('recovery rejects altered envelopes, foreign endpoints and foreign account records without rewriting them',()=>setup(async({ remote,engine,id,f,root })=>{
  await remote.plan(id);await remote.stage(id);const old=(await remoteLock(engine,id)).remote;f.publish(nextRelease,'1.0.4');await remote.list()
  for(const [change,error] of [
    [(p:RemoteSnapshot)=>{p.envelope.release.sha256='0'.repeat(64)},/expert_remote_checksum/],
    [(p:RemoteSnapshot)=>{p.connectors[0]!.endpoint='https://evil.example/mcp'},/expert_remote_endpoint/],
    [(p:RemoteSnapshot)=>{p.connectors[0]!.endpoint=p.connectors[0]!.endpoint.replace(ids.service,ids.other)},/expert_remote_endpoint/],
    [(p:RemoteSnapshot)=>{p.scope='another-member'},/expert_account_changed/],
  ] as const){const p={ ...structuredClone(old),envelope:structuredClone(f.wire) };change(p);const bytes=JSON.stringify(p);await writeFile(cachePath(root,id),bytes);await assert.rejects(remote.plan(id),error);assert.equal(await readFile(cachePath(root,id),'utf8'),bytes)}
}))

test('failed current release fetch leaves mixed preparation untouched until a successful retry',()=>setup(async({ remote,engine,id,f,root })=>{
  await remote.plan(id);await remote.stage(id);const old=(await remoteLock(engine,id)).remote;f.publish(nextRelease,'1.0.4');await remote.list()
  const bytes=JSON.stringify({ ...old,envelope:f.wire })
  await writeFile(cachePath(root,id),bytes);f.state.network=true
  await assert.rejects(remote.plan(id),/expert_remote_network/);assert.equal(await readFile(cachePath(root,id),'utf8'),bytes)
  f.state.network=false;await remote.plan(id);await remote.stage(id)
  assert.equal((await remote.prepare(id)).remote.envelope.release.id,nextRelease)
}))

test('a delayed preparation cannot overwrite a newer detail commit',()=>setup(async({ remote,id,f,root })=>{
  await remote.plan(id);const entered=deferred(),resume=deferred(),has=f.skills.hasVersion
  f.skills.hasVersion=async(...args:Parameters<typeof has>)=>{entered.resolve();await resume.promise;return has(...args)}
  const staging=remote.stage(id);const rejected=assert.rejects(staging,/expert_release_changed/);await entered.promise
  try{f.publish(nextRelease,'1.0.4');await remote.list();await remote.detail(id)}finally{resume.resolve()}
  await rejected;const p=JSON.parse(await readFile(cachePath(root,id),'utf8')) as RemoteSnapshot;assert.equal(p.envelope.release.id,nextRelease);assert.deepEqual(p.connectors,[])
  f.skills.hasVersion=has;await remote.plan(id);await remote.stage(id)
}))

test('concurrent preparations share installation and same-release detail retains committed readiness',()=>setup(async({ remote,id,f })=>{
  await remote.plan(id);await Promise.all([remote.stage(id),remote.stage(id),remote.detail(id)])
  assert.equal(f.installs,2);assert.equal((await remote.prepare(id)).remote.connectors.length,1)
}))

test('an account switch during a dependency probe cannot publish preparation or install for the next account',()=>setup(async({ remote,id,f,root })=>{
  await remote.plan(id);const before=await readFile(cachePath(root,id),'utf8'),entered=deferred(),resume=deferred(),has=f.skills.hasVersion
  f.skills.hasVersion=async(...args:Parameters<typeof has>)=>{entered.resolve();await resume.promise;return has(...args)}
  const rejected=assert.rejects(remote.stage(id),/expert_account_changed/);await entered.promise
  f.identity.key='another-member';remote.invalidate();resume.resolve();await rejected
  assert.equal(f.installs,0);assert.equal(await readFile(cachePath(root,id),'utf8'),before)
}))

test('a release published during preparation fails even when the catalog was not refreshed',()=>setup(async({ remote,id,f,root })=>{
  await remote.plan(id);const before=await readFile(cachePath(root,id),'utf8'),entered=deferred(),resume=deferred(),has=f.skills.hasVersion
  f.skills.hasVersion=async(...args:Parameters<typeof has>)=>{entered.resolve();await resume.promise;return has(...args)}
  const rejected=assert.rejects(remote.stage(id),/expert_release_changed/);await entered.promise
  f.publish(nextRelease,'1.0.4');resume.resolve();await rejected;assert.equal(await readFile(cachePath(root,id),'utf8'),before)
}))


test('an older detail response cannot overwrite a release selected while the response was pending',()=>setup(async({ remote,id,f,options,root })=>{
  await remote.plan(id);const entered=deferred(),resume=deferred(),fetcher=options.fetcher
  let hold=true
  options.fetcher=async(input:string|URL|Request,init?:RequestInit)=>{
    const response=await fetcher(input,init)
    if(hold&&(typeof input==='string'?input:input instanceof URL?input.href:input.url).endsWith('/'+ids.expert)){hold=false;entered.resolve();await resume.promise}
    return response
  }
  const rejected=assert.rejects(remote.detail(id),/expert_release_changed/);await entered.promise
  try{f.publish(nextRelease,'1.0.4');await remote.list();await remote.detail(id)}finally{resume.resolve()}
  await rejected;const current=JSON.parse(await readFile(cachePath(root,id),'utf8')) as RemoteSnapshot;assert.equal(current.envelope.release.id,nextRelease)
}))

test('a release with changed dependency keys starts with empty readiness rather than borrowing old keys',()=>setup(async({ remote,id,f })=>{
  await remote.plan(id);await remote.stage(id);f.publish(nextRelease,'1.0.4')
  f.wire.manifest.skills[0]!.key='weekly-new';f.refs.skills[0]!.key='weekly-new';f.rehash()
  await remote.list();await remote.plan(id);assert.deepEqual((await remote.get(id)).bindings,{ skills:{},connectors:{} })
  await remote.stage(id);assert.deepEqual((await remote.prepare(id)).remote.skills,['weekly-new','summary']);assert.equal(f.installs,2)
}))

test('rate limiting from the previous account does not block a newly authenticated catalog',()=>setup(async({ remote,f,options })=>{
  const fetcher=options.fetcher
  options.fetcher=async()=>new Response('{}',{ status:429,headers:{ 'retry-after':'60' } })
  await assert.rejects(remote.list(),/expert_remote_rate_limited/)
  f.identity.key='new-member';remote.invalidate();options.fetcher=fetcher
  assert.equal((await remote.list()).items.length,1)
}))


test('reused release IDs with different digests cannot borrow an already connected MCP instance',()=>setup(async({ remote,id,f })=>{
  await remote.plan(id);await remote.stage(id)
  f.wire.manifest.instructions='ALTERED_RELEASE';f.rehash();await remote.list();await remote.plan(id)
  await assert.rejects(remote.stage(id),/expert_release_changed/)
  assert.deepEqual((await remote.get(id)).bindings,{ skills:{},connectors:{} })
}))


test.each([401,429])('an account switch while draining HTTP %i cannot refresh or throttle the new account',status=>setup(async({ remote,f,options })=>{
  const entered=deferred(),resume=deferred(),fetcher=options.fetcher,issue=options.issue
  let issues=0
  options.issue=(resource)=>{issues++;return issue(resource)}
  options.fetcher=async()=>new Response(new ReadableStream({ cancel:async()=>{entered.resolve();await resume.promise} }),
    { status,headers:{ 'retry-after':'60' } })
  const rejected=assert.rejects(remote.list(),/expert_account_changed/);await entered.promise
  f.identity.key='next-member';remote.invalidate();options.fetcher=fetcher;resume.resolve();await rejected
  assert.equal(issues,0);assert.equal((await remote.list()).items.length,1);assert.equal(issues,1)
}))
test('retains remote update notices across detail previews and restart until preparation succeeds',()=>setup(async({ remote,engine,id,f,options })=>{
  await remote.plan(id);await remote.stage(id)
  const old=await remoteLock(engine,id)
  f.publish(nextRelease,'1.0.4')
  assert.deepEqual((await remote.list()).updates[id],{ from:'1.0.0',to:'1.0.4' })
  await remote.detail(id)
  assert.deepEqual((await remote.list()).updates[id],{ from:'1.0.0',to:'1.0.4' })
  const restart=new RemoteExperts(options)
  try {
    assert.deepEqual((await restart.list()).updates[id],{ from:'1.0.0',to:'1.0.4' })
    const plan=await restart.plan(id)
    assert.equal(plan.previousVersion,'1.0.0');assert.equal(plan.version,'1.0.4')
    await restart.stage(id)
    assert.deepEqual((await restart.list()).updates,{})
    assert.equal((await engine.resolve(old.id)).expert.version,'1.0.0')
  } finally {restart.dispose()}
}))

test('warm selection reuses packages and adoption, and avoids global skill discovery',()=>setup(async({ remote,engine,id,f })=>{
  await remote.plan(id);await remote.stage(id)
  const installs=f.installs
  f.calls.length=0
  f.skills.hostList=async()=>{throw new Error('unrelated skill unavailable')}
  await remote.plan(id);await remote.stage(id)
  const { lock,runtime }=await engine.prepareRuntime(id)
  assert.equal(runtime.skills.length,2)
  assert.equal(f.installs,installs)
  assert.equal(f.calls.filter(r=>r.path.endsWith('/adopt')).length,0)
  assert.equal(f.calls.filter(r=>r.path.endsWith('/resolve')).length,3)
  assert.equal(f.calls.filter(r=>r.path.endsWith('/check-updates')).length,0)
  f.state.visible=false
  await assert.rejects(engine.resolve(lock.id),/expert_remote_unavailable/)
}))
