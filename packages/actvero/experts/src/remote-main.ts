import { mkdir,readFile,writeFile,rename,rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Connectors } from '@actvero/dsh-connectors/main'
import type { Skills } from '@actvero/dsh-skills/main'
import type { Expert } from './contracts.ts'
import { fail,validId } from './schema.ts'
import { envelope,summary,hash,canonical,expertEndpoint,uuid } from './remote-contract.ts'
import type { RemoteEnvelope,RemoteSummary,RemoteSnapshot,RemoteDependency,RemotePlan } from './remote-contract.ts'
type Token=Awaited<ReturnType<ConstructorParameters<typeof Connectors>[0]['issue']>>
type Identity={ key:string;baseUrl:string;available:boolean }
interface Options {
  /** Main-owned factory retains the shared connector implementation. */
  createConnector(config:ConstructorParameters<typeof Connectors>[0]):Connectors
  root:string
  identity():Identity|undefined
  issue(resource:string):Promise<Token>
  skills:Pick<Skills,'state'|'hasVersion'>&{ detail(id:string,versionId?:string,expert?:{ expert_id:string;expert_release_id:string }):Promise<{ current_version:{ id:string;sha256:string } }>;install(id:string,version:string,sha256:string,expert?:{ expert_id:string;expert_release_id:string },activate?:boolean):Promise<unknown>;enable(id:string,enabled:boolean):Promise<unknown> }
  changed():void
  fetcher?:typeof fetch
}
type Connection={ client:Connectors;service:string;key:string;scope:string;envelope:RemoteEnvelope;endpoint:string;ready?:Promise<void> }
/** Platform expert preparation caches and exact conversation dependencies owned by Electron Main. */
export class RemoteExperts {
  private epoch=0;private abort=new AbortController()
  private token?:Token&{ until:number };private tokenFlight?:Promise<Token>;private retryAt=0
  private summaries=new Map<string,RemoteSummary>();private instances=new Map<string,Connection>()
  private flights=new Map<string,Promise<{ skills:string[];connectors:string[] }>>()
  private writes=new Map<string,Promise<unknown>>()
  private stages=new Map<string,Promise<Expert>>()
  constructor(private options:Options){}
  /**
   * Check whether the selected account exposes platform expert resources.
   * @returns Whether the current identity is available.
   */
  available(): boolean {return !!this.options.identity()?.available}
  /** Revoke in-flight account work, cached authority, preparation flights and live connections. */
  invalidate():void{
    this.epoch++;this.abort.abort();this.abort=new AbortController()
    this.token=undefined;this.tokenFlight=undefined;this.retryAt=0
    this.summaries.clear();this.stages.clear();this.flights.clear()
    for(const row of this.instances.values())void row.client.dispose()
    this.instances.clear();this.options.changed()
  }
  /** Invalidate account authority and start closing owned connector clients. */
  dispose(): void {this.invalidate()}
  private context(){const identity=this.options.identity();if(!identity?.available)fail('expert_remote_login');return { identity:{ ...identity },epoch:this.epoch }}
  private guard(c:ReturnType<RemoteExperts['context']>){if(c.epoch!==this.epoch||c.identity.key!==this.options.identity()?.key||!this.available())fail('expert_account_changed')}
  private async resource(){
    const c=this.context();if(this.token&&this.token.until>Date.now()+30000)return this.token
    if(!this.tokenFlight){const flight=this.options.issue('experts:catalog').then((t)=>{this.guard(c);if(t.resource!=='experts:catalog'||t.token_type!=='Bearer'||t.scope!=='experts:read'||!t.access_token||!Number.isFinite(t.expires_in)||t.expires_in<=0||t.expires_in>600||t.endpoint!==c.identity.baseUrl+'/api/v1/desktop/experts')fail('expert_remote_invalid');this.token={ ...t,until:Date.now()+t.expires_in*1000 };return t});this.tokenFlight=flight;void flight.finally(()=>{if(this.tokenFlight===flight)this.tokenFlight=undefined}).catch(()=>{})}
    return this.tokenFlight
  }
  private async request<T>(path:string,body?:unknown,retry=true):Promise<T>{
    const c=this.context();if(Date.now()<this.retryAt)fail('expert_remote_rate_limited')
    const token=await this.resource()
    this.guard(c);let response:Response
    try{response=await (this.options.fetcher??fetch)(token.endpoint+path,{ method:body===undefined?'GET':'POST',headers:{ Authorization:'Bearer '+token.access_token,...(body===undefined?{}:{ 'Content-Type':'application/json' }) },body:body===undefined?undefined:JSON.stringify(body),redirect:'error',credentials:'omit',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(20000)]) })}catch{this.guard(c);return fail('expert_remote_network')}
    this.guard(c)
    if(response.status===401&&retry){await response.body?.cancel();this.guard(c);this.token=undefined;return this.request(path,body,false)}
    if(!response.ok){await response.body?.cancel();this.guard(c);if(response.status===429){const after=response.headers.get('retry-after')??'60',sec=Number(after);this.retryAt=Number.isFinite(sec)?Date.now()+Math.max(1,sec)*1000:Math.max(Date.now()+1000,Date.parse(after)||Date.now()+60000)}return fail(({ 401:'expert_remote_login',403:'expert_remote_unavailable',404:'expert_remote_unavailable',409:'expert_release_changed',422:'expert_remote_category_changed',429:'expert_remote_rate_limited' } as Record<number,string>)[response.status]??'expert_remote_network')}
    const reader=response.body?.getReader();if(!reader)fail('expert_remote_invalid');let size=0
    const chunks:Uint8Array[]=[]
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16*1024*1024){await reader.cancel();fail('expert_remote_invalid')}chunks.push(part.value)}
    this.guard(c);try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T}catch{return fail('expert_remote_invalid')}
  }
  private id(e:Pick<RemoteSummary,'expert_id'>){return 'remote-'+hash(this.context().identity.key+'|'+e.expert_id)}
  private path(id:string){if(!/^remote-[a-f0-9]{64}$/.test(id))fail('expert_remote_invalid');return join(this.options.root,validId(id)+'.json')}
  /** Serialize cache commits per expert; queued writes retain their initiating account. */
  private async commit<T>(id:string,c:ReturnType<RemoteExperts['context']>,run:()=>Promise<T>):Promise<T>{
    const task=(this.writes.get(id)??Promise.resolve()).catch(()=>{}).then(()=>{this.guard(c);return run()})
    this.writes.set(id,task)
    try{return await task}finally{if(this.writes.get(id)===task)this.writes.delete(id)}
  }
  private sameRelease(a:RemoteEnvelope,b:RemoteSummary){return a.release.id===b.release.id&&a.release.sha256===b.release.sha256}
  private guardRelease(id:string,e:RemoteEnvelope){const selected=this.summaries.get(id);if(selected&&!this.sameRelease(e,selected))fail('expert_release_changed')}
  private async persist(id:string,value:RemoteSnapshot,c:ReturnType<RemoteExperts['context']>){
    this.guard(c);this.proof(value);if(this.id(value.envelope)!==id)fail('expert_account_changed')
    await mkdir(this.options.root,{ recursive:true,mode:0o700 })
    const path=this.path(id),temp=path+'.'+randomUUID()+'.tmp'
    try{await writeFile(temp,JSON.stringify(value),{ mode:0o600,flag:'wx' })
      this.guard(c);this.guardRelease(id,value.envelope);await rename(temp,path);this.guard(c)}finally{await rm(temp,{ force:true })}
  }
  /** Recovery discards only derived preparation whose endpoints name another release of this expert. */
  private async saved(id:string,recover=false):Promise<RemoteSnapshot>{
    const c=this.context();let value:RemoteSnapshot
    try{value=JSON.parse(await readFile(this.path(id),'utf8')) as RemoteSnapshot}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return fail('expert_remote_unavailable');return fail('expert_remote_invalid')}
    this.guard(c)
    try{this.proof(value)}catch(error){
      if(!(error instanceof Error)||error.message!=='expert_remote_endpoint')throw error
      this.proof(value,true)
      if(!recover)fail('expert_remote_cache_stale')
      value={ scope:value.scope,envelope:value.envelope,skills:[],connectors:[] }
    }
    if(this.id(value.envelope)!==id)fail('expert_account_changed');return value
  }
  private proof(p:RemoteSnapshot,previousRelease=false){
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Cached snapshot JSON may be null before validation.
    if(!p||p.scope!==this.context().identity.key)fail('expert_account_changed');envelope(p.envelope)
    if(!Array.isArray(p.skills)||!Array.isArray(p.connectors)||p.skills.some(k=>!p.envelope.manifest.skills.some(r=>r.key===k))||new Set(p.skills).size!==p.skills.length||new Set(p.connectors.map(r=>r.key)).size!==p.connectors.length)fail('expert_remote_invalid')
    for(const r of p.connectors){
      if(!previousRelease){expertEndpoint(this.context().identity.baseUrl,p.envelope,r.key,r.endpoint);continue}
      const release=typeof r.endpoint==='string'?r.endpoint.match(/\/releases\/([^/]+)\/[^/]+$/)?.[1]:undefined
      if(!uuid(release))fail('expert_remote_endpoint')
      expertEndpoint(this.context().identity.baseUrl,{ ...p.envelope,release:{ ...p.envelope.release,id:release } },r.key,r.endpoint)
    }
  }
  private view(e:RemoteSummary):Expert {return { manifest:{ schemaVersion:1,id:this.id(e),version:e.release.version,name:e.name,description:e.description,avatar:e.avatar,tags:e.tags,category:'general',instructions:'',conversationStarters:[],skills:[],connectors:[] },bindings:{ skills:{},connectors:{} },revision:e.metadata_revision }}
  private expert(p:RemoteSnapshot):Expert {
    const e=p.envelope,view=this.view(e)
    view.manifest={ ...e.manifest,id:view.manifest.id }
    for(const r of e.dependency_refs.skills)if(p.skills.includes(r.key))view.bindings.skills[r.key]=r.skill_id
    for(const r of p.connectors)view.bindings.connectors[r.key]=this.connectionId(p,r.key)
    return view
  }
  /**
   * Read and validate platform expert category counts.
   * @param q - Catalog search text.
   * @returns Unique validated category rows.
   */
  async categories(q=''): Promise<{ id: string; name: string; count: number }[]> {const rows=await this.request<{ id:string;name:string;count:number }[]>('/categories?'+new URLSearchParams({ q }));if(!Array.isArray(rows)||rows.some(r=>typeof r.id!=='string'||r.id.length>200||typeof r.name!=='string'||r.name.length>200||!Number.isSafeInteger(r.count)||r.count<0)||new Set(rows.map(r=>r.id)).size!==rows.length)fail('expert_remote_invalid');return rows}
  /**
   * Read a platform catalog page and retain exact release identities for later selection.
   * @param q - Catalog search text.
   * @param category - Optional category identifier.
   * @param page - One-based page number.
   * @returns Validated catalog page with account-scoped expert cards.
   */
  async list(q='',category='',page=1): Promise<{ items: Expert[]; total: number; page: number; page_size: number }> {const c=this.context(),params=new URLSearchParams({ q,page:String(Math.max(1,Math.floor(page))) });if(category)params.set('category',category)
    const data=await this.request<{ items:RemoteSummary[];total:number;page:number;page_size:number }>('?'+params);if(!Array.isArray(data.items)||data.items.length>20||!Number.isSafeInteger(data.total)||data.total<0||data.page!==page||data.page_size!==20)fail('expert_remote_invalid')
    this.guard(c)
    const items=data.items.map((raw)=>{const e=summary(raw),id=this.id(e);this.summaries.set(id,e);return this.view(e)})
    return { ...data,items }
  }
  /**
   * Fetch the selected release; preserve preparation only for the same release ID and digest.
   * @param id - Account-scoped catalog expert ID.
   * @returns Validated details with current preparation persisted separately.
   */
  async detail(id:string):Promise<Expert>{
    const c=this.context(),expected=this.summaries.get(id)??(await this.saved(id,true)).envelope
    this.guard(c)
    const e=envelope(await this.request('/'+expected.expert_id));this.guard(c)
    if(this.id(e)!==id)fail('expert_account_changed');if(!this.sameRelease(e,expected))fail('expert_release_changed')
    await this.commit(id,c,async()=>{
      this.guardRelease(id,e)
      const saved=await this.saved(id,true).catch((error:unknown)=>{if(error instanceof Error&&error.message==='expert_remote_unavailable')return undefined;throw error})
      this.guard(c)
      const value=saved&&this.sameRelease(saved.envelope,e)
        ?{ ...saved,envelope:e }
        :{ scope:c.identity.key,envelope:e,skills:[],connectors:[] }
      await this.persist(id,value,c)
    })
    return { ...this.view(e),manifest:{ ...e.manifest,id } }
  }
  /**
   * Read a saved expert belonging to the current account.
   * @param id - Account-scoped expert identifier.
   * @returns Expert reconstructed from the saved release.
   */
  async get(id:string): Promise<Expert> {return this.expert(await this.saved(id))}
  /**
   * Read recent account-owned experts, allowing outdated preparation to remain selectable for recovery.
   * @param ids - Recorded expert IDs, deduplicated and bounded before reading.
   * @returns Visible expert cards; unavailable records and failed update checks produce no cards.
   */
  async recent(ids:string[]):Promise<Expert[]>{
    if(!this.available())return []
    const saved=await Promise.allSettled([...new Set(ids.filter(id=>id.startsWith('remote-')))].slice(0,100).map(id=>this.saved(id,true)))
    const snapshots=saved.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);if(!snapshots.length)return []
    try {const updates=await this.updates(snapshots);return snapshots.flatMap((p,i)=>{const item=updates[i];if(item.status==='unavailable')return [];return [this.expert({ ...p,envelope:{ ...p.envelope,...(item.status==='current'?item.expert:{}),manifest:p.envelope.manifest,dependency_refs:p.envelope.dependency_refs } })]})}
    catch{return []}
  }
  private async adopt(p:RemoteSnapshot){const e=p.envelope,h=hash(p.scope+'|'+e.expert_id+'|'+e.release.id),request_id=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;await this.request('/'+e.expert_id+'/adopt',{ access_version:3,release_id:e.release.id,sha256:e.release.sha256,request_id })}
  private async resolution(p:RemoteSnapshot){
    this.proof(p)
    const e=p.envelope,c=this.context()
    const result=await this.request<{ release_id:string;sha256:string;can_prepare:boolean;dependencies:RemoteDependency[] }>('/'+e.expert_id+'/resolve',{ access_version:3,release_id:e.release.id,sha256:e.release.sha256 });this.guard(c)
    if(result.release_id!==e.release.id||result.sha256!==e.release.sha256||typeof result.can_prepare!=='boolean'||!Array.isArray(result.dependencies)||result.dependencies.length!==e.manifest.skills.length+e.manifest.connectors.length)fail('expert_remote_invalid')
    const seen=new Set<string>();for(const d of result.dependencies){if(!['skills','connectors'].includes(d.kind)||!['available','unavailable','version_conflict','connection_required','unverified','temporary_error'].includes(d.status)||!['none','contact_admin','configure','authorize','retry','verify'].includes(d.action))fail('expert_remote_invalid')
      const req=e.manifest[d.kind].find(r=>r.key===d.key);if(!req||req.required!==d.required||seen.has(d.kind+':'+d.key))fail('expert_remote_invalid');seen.add(d.kind+':'+d.key)
      if(['available','unverified'].includes(d.status)){if(d.kind==='skills'){const ref=e.dependency_refs.skills.find(r=>r.key===d.key)??fail('expert_remote_invalid');if(d.status!=='available'||d.resource_id!==ref.skill_id||d.version_id!==ref.version_id||d.sha256!==ref.sha256)fail('expert_remote_invalid')}else {const ref=e.dependency_refs.connectors.find(r=>r.key===d.key)??fail('expert_remote_invalid');if(d.resource_id!==ref.connector_id||typeof d.mcp_endpoint!=='string'||canonical(d.tools??null)!==canonical(ref.tools??null))fail('expert_remote_invalid');expertEndpoint(c.identity.baseUrl,e,d.key,d.mcp_endpoint)}}
    }return result
  }
  /**
   * Refresh selected release details and resolve exact dependency actions without installing them.
   * @param id - Account-scoped catalog expert ID.
   * @returns Required and optional actions after current authorization and local version checks.
   */
  async plan(id:string):Promise<RemotePlan>{
    const c=this.context();await this.detail(id)
    this.guard(c)
    const p=await this.saved(id);this.guard(c)
    await this.adopt(p)
    this.guard(c)
    const r=await this.resolution(p)
    this.guard(c)
    const state=await this.options.skills.state();this.guard(c)
    const dependencies=await Promise.all(r.dependencies.map(async(d)=>{
      let action=d.action
      if(d.kind==='skills'&&d.status==='available'){const installed=state.items.find(s=>s.skill.id===d.resource_id),present=await this.options.skills.hasVersion((d.resource_id??fail('expert_remote_invalid')),(d.version_id??fail('expert_remote_invalid')),(d.sha256??fail('expert_remote_invalid')));action=!present?'install':!installed?.enabled?'enable':'none'}
      if(d.kind==='connectors'&&d.status==='unverified')action='verify'
      return { kind:d.kind,key:d.key,label:(p.envelope.manifest[d.kind].find(req=>req.key===d.key)??fail('expert_remote_invalid')).label,required:d.required,status:d.status,action }
    }))
    this.guard(c);this.guardRelease(id,p.envelope)
    return { id,name:p.envelope.manifest.name,
      canPrepare:r.can_prepare&&r.dependencies.every(d=>!d.required||['available','unverified'].includes(d.status)),dependencies }
  }
  /**
   * Coalesce preparation for one exact release; commit only while it remains the selected current release.
   * @param id - Account-scoped catalog expert ID with validated cached details.
   * @returns Exact expert bindings after successful preparation and cache commit.
   */
  async stage(id:string):Promise<Expert>{
    const c=this.context(),p=await this.saved(id)
    this.guard(c);this.guardRelease(id,p.envelope)
    const key=hash(c.identity.key+'|'+id+'|'+p.envelope.release.id+'|'+p.envelope.release.sha256)
    const existing=this.stages.get(key)
    if(existing)return existing
    const task=this.stageNow(id,p,c);this.stages.set(key,task)
    try{return await task}finally{if(this.stages.get(key)===task)this.stages.delete(key)}
  }
  private async stageNow(id:string,p:RemoteSnapshot,c:ReturnType<RemoteExperts['context']>){
    await this.adopt(p)
    this.guard(c)
    const resolution=await this.resolution(p);this.guard(c)
    if(!resolution.can_prepare||resolution.dependencies.some(d=>d.required&&!['available','unverified'].includes(d.status)))fail('expert_dependencies_missing')
    const skills:string[]=[],connections:{ key:string;endpoint:string }[]=[]
    for(const d of resolution.dependencies){if(!['available','unverified'].includes(d.status))continue
      try{
        this.guard(c);this.guardRelease(id,p.envelope)
        if(d.kind==='skills'){
          const ref=p.envelope.dependency_refs.skills.find(r=>r.key===d.key)??fail('expert_remote_invalid')
          const present=await this.options.skills.hasVersion(ref.skill_id,ref.version_id,ref.sha256)
          this.guard(c);this.guardRelease(id,p.envelope)
          if(!present){
            await this.options.skills.install(ref.skill_id,ref.version_id,ref.sha256,
              { expert_id:p.envelope.expert_id,expert_release_id:p.envelope.release.id },false)
            this.guard(c)
          }
          const state=await this.options.skills.state();this.guard(c)
          if(!state.items.find(r=>r.skill.id===ref.skill_id)?.enabled){await this.options.skills.enable(ref.skill_id,true);this.guard(c)}
          skills.push(d.key)
        }else{const row={ key:d.key,endpoint:(d.mcp_endpoint??fail('expert_remote_invalid')) };await this.ensure({ ...p,connectors:[row] },row.key);connections.push(row)}
        this.guard(c);this.guardRelease(id,p.envelope)
      }catch(error){this.guard(c);this.guardRelease(id,p.envelope);if(d.required)throw error}
    }
    const ready={ ...p,skills,connectors:connections }
    if(!(await this.resolution(ready)).can_prepare)fail('expert_dependencies_missing');this.guard(c)
    const update=await this.update(ready);this.guard(c)
    if(update.status==='unavailable')fail('expert_remote_unavailable');if(update.status!=='current')fail('expert_release_changed')
    await this.commit(id,c,async()=>{
      const current=await this.saved(id);this.guard(c)
      if(!this.sameRelease(current.envelope,p.envelope))fail('expert_release_changed')
      await this.persist(id,{ ...ready,envelope:current.envelope },c)
    })
    return this.expert(ready)
  }
  /**
   * Validate committed preparation for a new immutable conversation snapshot.
   * @param id - Account-scoped expert ID whose current dependencies have been staged.
   * @returns Exact expert bindings and release data; account and release changes reject preparation.
   */
  async prepare(id:string):Promise<{ expert:Expert;remote:RemoteSnapshot }>{
    const c=this.context(),p=await this.saved(id)
    this.guard(c);this.guardRelease(id,p.envelope)
    if(!(await this.resolution(p)).can_prepare)fail('expert_dependencies_missing');this.guard(c)
    for(const r of p.envelope.manifest.skills)if(r.required&&!p.skills.includes(r.key))fail('expert_dependencies_missing')
    for(const r of p.envelope.manifest.connectors)if(r.required&&!p.connectors.some(c=>c.key===r.key))fail('expert_dependencies_missing')
    await this.validate(p)
    this.guard(c);this.guardRelease(id,p.envelope);return { expert:this.expert(p),remote:p }
  }
  private async updates(snapshots:RemoteSnapshot[]){
    const r=await this.request<{ items:{ expert_id:string;status:string;expert:RemoteSummary|null }[] }>('/check-updates',{ access_version:3,items:snapshots.map(p=>({ expert_id:p.envelope.expert_id,release_id:p.envelope.release.id,sha256:p.envelope.release.sha256 })) })
    if(!Array.isArray(r.items)||r.items.length!==snapshots.length||new Set(r.items.map(i=>i.expert_id)).size!==r.items.length)fail('expert_remote_invalid')
    return snapshots.map((p)=>{const e=p.envelope,item=r.items.find(i=>i.expert_id===e.expert_id);if(!item||!['current','update_available','unavailable'].includes(item.status))fail('expert_remote_invalid');if(item.status!=='unavailable'){const value=summary(item.expert);if(value.expert_id!==e.expert_id||(item.status==='current'&&(value.release.id!==e.release.id||value.release.sha256!==e.release.sha256)))fail('expert_remote_invalid')}return item})
  }
  private async update(p:RemoteSnapshot){return (await this.updates([p]))[0]}
  /**
   * Recheck a snapshot release, authorization and required dependencies; concurrent checks share work.
   * @param p - Saved account-scoped release snapshot.
   * @param expert - Optional expert content that must match the snapshot.
   * @returns Allowed skill and connector requirement keys; unavailable required resources reject.
   */
  async validate(p:RemoteSnapshot,expert?:Expert): Promise<{ skills: string[]; connectors: string[] }> {this.proof(p);if(expert&&canonical(expert)!==canonical(this.expert(p)))fail('expert_snapshot_invalid')
    const key=hash(canonical(p))
    const existing=this.flights.get(key);if(existing)return existing
    const run=this.validateNow(p);this.flights.set(key,run)
    try{return await run}finally{if(this.flights.get(key)===run)this.flights.delete(key)}
  }
  private async validateNow(p:RemoteSnapshot){const c=this.context(),allowed={ skills:[] as string[],connectors:[] as string[] };if(!(await this.resolution(p)).can_prepare)fail('expert_dependencies_missing');if((await this.update(p)).status==='unavailable')fail('expert_remote_unavailable');for(const key of p.skills){const ref=p.envelope.dependency_refs.skills.find(r=>r.key===key)??fail('expert_remote_invalid');try{const current=await this.options.skills.detail(ref.skill_id,ref.version_id,{ expert_id:p.envelope.expert_id,expert_release_id:p.envelope.release.id });if(current.current_version.id!==ref.version_id||current.current_version.sha256!==ref.sha256)fail('expert_skill_changed');allowed.skills.push(key)}catch(e){if(p.envelope.manifest.skills.find(r=>r.key===key)?.required)throw e}}
    for(const r of p.connectors){
      try{await this.ensure(p,r.key);allowed.connectors.push(r.key)}
      catch(e){if(p.envelope.manifest.connectors.find(d=>d.key===r.key)?.required)throw e}
    }
    this.guard(c);return allowed
  }
  private connectionId(p:RemoteSnapshot,key:string){return 'expert-mcp-'+hash(p.scope+'|'+p.envelope.expert_id+'|'+p.envelope.release.id+'|'+key)}
  private async ensure(p:RemoteSnapshot,key:string){
    this.proof(p)
    const c=this.context(),ref=p.envelope.dependency_refs.connectors.find(r=>r.key===key)??fail('expert_remote_invalid'),endpoint=(p.connectors.find(r=>r.key===key)??fail('expert_remote_invalid')).endpoint,id=this.connectionId(p,key);let row=this.instances.get(id)
    if(row&&!this.sameRelease(row.envelope,p.envelope))fail('expert_release_changed')
    if(!row){const service=ref.connector_id
      const client=this.options.createConnector({ identity:()=>{const current=this.options.identity();return current?.key===p.scope?{ ...current,key:current.key+'|'+id }:undefined},issue:(resource)=>{if(!['mcp:catalog','mcp:'+service].includes(resource))fail('expert_remote_endpoint');return this.options.issue(resource)},load:async()=>[],save:async()=>{},openExternal:async()=>fail('expert_dependencies_missing'),changed:()=>this.options.changed(),fetch:async(input,init)=>{
        this.guard(c)
        const url=String(input),origin=c.identity.baseUrl,ordinary=origin+'/api/mcp/services/'+service
        if(url!==ordinary&&![origin+'/api/v1/desktop/mcp/connectors/'+service,origin+'/api/v1/desktop/mcp/connectors/'+service+'/connection/verify'].includes(url))fail('expert_remote_endpoint')
        // Keep the existing token validator and protocol executor; only the exact service transport is scoped.
        return (this.options.fetcher??fetch)(url===ordinary?expertEndpoint(origin,p.envelope,key,endpoint):url,init)
      } });row={ client,service,key,scope:p.scope,envelope:p.envelope,endpoint };this.instances.set(id,row)}
    if(!row.ready){const entry=row;entry.ready=entry.client.add(entry.service).then((inventory)=>{this.guard(c);this.inventoryProof(ref,inventory);if(ref.tools!=null&&inventory.tools.some(t=>!t.name||!ref.tools?.includes(t.name)))fail('expert_remote_tools')}).catch((e)=>{entry.ready=undefined;throw e})}
    await row.ready
    this.guard(c);return row
  }
  private inventoryProof(ref:RemoteEnvelope['dependency_refs']['connectors'][number],inventory:import('@actvero/dsh-connectors/contracts').Inventory){if(ref.reference_version!==3)return
    const proof=ref.capability_contracts;if(!proof)fail('expert_remote_unverified');for(const [kind,rows] of [['tools',inventory.tools],['prompts',inventory.prompts],['resources',inventory.resources],['templates',inventory.resourceTemplates]] as const)for(const row of rows){const key=kind==='resources'?row.uri:kind==='templates'?row.uriTemplate:row.name;if(!key||!proof[kind]?.[key])fail('expert_remote_capability_denied')}}
  /**
   * Expose ready release-bound connectors for expert preparation.
   * @returns Connector choices with verified inventories.
   */
  async rows(): Promise<{ id: string; name: string; description: string; ready: boolean; inventory: import('@actvero/dsh-connectors/contracts').Inventory }[]> {const snapshots=await this.snapshot([]);return snapshots.map(row=>({ id:row.id,name:row.id,description:'',ready:true,inventory:row.inventory }))}
  /**
   * Read authorized release-bound MCP inventories and exclude unavailable instances.
   * @param sessions - Conversation identifiers to register with each connector client.
   * @returns Verified inventories with their scoped connector identifiers.
   */
  async snapshot(sessions:string[]): Promise<{ id: string; inventory: import('@actvero/dsh-connectors/contracts').Inventory; sessions: string[] }[]> {if(!this.available())return []
    const out=[];for(const [id,row] of this.instances){try{const rows=await row.client.hostSnapshot(sessions);if(!rows.length)row.ready=undefined;for(const item of rows){const ref=row.envelope.dependency_refs.connectors.find(r=>r.key===row.key)??fail('expert_remote_invalid');this.inventoryProof(ref,item.inventory);if(ref.tools!=null&&item.inventory.tools.some(t=>!t.name||!ref.tools?.includes(t.name)))fail('expert_remote_tools');out.push({ ...item,id })}}catch{row.ready=undefined/* Missing instances are excluded; required locks fail closed. */}}return out}
  /**
   * Change conversation selection for an existing account-owned expert connector.
   * @param id - Release-bound connector identifier.
   * @param sessionId - Conversation identifier.
   * @param enabled - Whether this conversation selects the connector.
   */
  async select(id:string,sessionId:string,enabled=true): Promise<void> {const row=this.instances.get(id);if(!row||row.scope!==this.context().identity.key)fail('expert_connector_unavailable');await row.client.select(row.service,sessionId,enabled)}
  /**
   * Execute a selected release-bound MCP capability with its platform restrictions.
   * @param id - Release-bound connector identifier.
   * @param sessionId - Conversation identifier.
   * @param method - Supported MCP operation.
   * @param params - Operation-specific request parameters.
   * @param signal - Optional request cancellation signal.
   * @returns MCP response; wrong-account or denied capabilities reject.
   */
  async call(id:string,sessionId:string,method:string,params:unknown,signal?:AbortSignal): Promise<unknown> {const row=this.instances.get(id);if(!row||row.scope!==this.context().identity.key)fail('expert_connector_unavailable')
    const ref=row.envelope.dependency_refs.connectors.find(r=>r.key===row.key)??fail('expert_remote_invalid');if(method==='tools/call'&&ref.tools!=null&&!ref.tools.includes(String((params as { name?:unknown })?.name)))fail('expert_tool_denied')
    const scoped=method==='tools/call'&&params&&typeof params==='object'&&!Array.isArray(params)?{ ...(params as Record<string,unknown>),_meta:{ ...(((params as Record<string,unknown>)._meta as Record<string,unknown>|undefined)??{}),'actvero/project_id':sessionId } }:params;return row.client.call(row.service,sessionId,method,scoped,signal)}
}
