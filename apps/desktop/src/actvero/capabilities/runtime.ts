import assert from 'node:assert/strict'
import { app,dialog,ipcMain,shell,type BrowserWindow,type IpcMainInvokeEvent } from 'electron'
import { mkdir,readFile,writeFile } from 'node:fs/promises'
import { SecureJsonFile } from '../secure-json.ts'
import { join } from 'node:path'
import { createHash,randomUUID } from 'node:crypto'
import { Skills } from '@actvero/dsh-skills/main'
import { Connectors } from '@actvero/dsh-connectors/main'
import { Experts,ExpertPackages } from '@actvero/dsh-experts/main'
import { RemoteExperts } from '@actvero/dsh-experts/remote-main'
import type { AccountController } from '../controller.ts'
import type { CapabilityHostMessage,CapabilityMainMessage } from '../capability-ipc.ts'
import { SCHEME } from '../../ipc.ts'
const max=1024*1024
const safeError=(e:unknown)=>{const code=e instanceof Error?e.message:'';return /^[a-z_0-9]{1,80}$/.test(code)?code:'capability_action_failed'}
function input(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>max)throw new Error('invalid_input');return value as Record<string,unknown>}
/** Native authority shared by manager, selectors and the owned Host plugins. */
export class Capabilities {
  readonly skills:Skills;readonly connectors:Connectors;readonly experts:Experts
  readonly remote:RemoteExperts;readonly packages:ExpertPackages
  private storage=new SecureJsonFile()
  private readonly root:string
  private send:((message:CapabilityMainMessage)=>void)|undefined
  private pending=new Map<string,{ resolve(value:unknown):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout> }>()
  private restored=new Map<string,string>()
  private firstPartyReady:Promise<void>=Promise.resolve()
  private active=new Map<string,AbortController>();private owner='';private channels:string[]=[]
  private available=false
  constructor(private account:AccountController,private windows:()=>readonly (BrowserWindow|undefined)[]){
    const root=join(app.getPath('userData'),'actvero-capabilities')
    this.root=root
    const issue=(resource:string)=>account.resourceToken(resource)
    const changed=()=>this.changed()
    this.connectors=new Connectors({ identity:()=>this.identity(),issue,changed,load:key=>this.read<string[]>(join(root,'connections',this.hash(key)+'.enc'),[]),save:(key,ids)=>this.save(join(root,'connections',this.hash(key)+'.enc'),ids),openExternal:url=>shell.openExternal(url),local:{ load:()=>this.read(join(root,'local-mcp.enc'),[]),save:value=>this.save(join(root,'local-mcp.enc'),value),openExternal:url=>shell.openExternal(url) } })
    this.firstPartyReady=this.ensureFreeCADConnector()
    this.skills=new Skills({ root:join(root,'skills'),identity:()=>this.identity(),issue,changed,syncHost:async(name,skillId)=>{await this.control('actvero:skills:sync',{ ...(name?{ name }:{}),...(skillId?{ skillId }:{}) })},openExternal:url=>shell.openExternal(url) })
    this.remote=new RemoteExperts({ createConnector:config=>new Connectors(config),root:join(root,'remote-experts'),identity:()=>this.identity(),issue,skills:this.skills,changed })
    this.experts=new Experts({ root:join(root,'experts'),scope:()=>this.identity()?.key??'local',skills:this.skills,remote:this.remote,changed,connectors:async()=>{const snapshot=await this.connectors.hostSnapshot(),local=await this.connectors.local?.list()??[],state=await this.connectors.state();return [...await Promise.all(state.added.map(async (id)=>{const row=snapshot.find(r=>r.id===id),detail=await this.connectors.detail(id).catch(()=>undefined);return { id,name:detail?.display_name??local.find(c=>c.id===id)?.name??id,description:detail?.description??'',ready:!!row,...(row?{ inventory:row.inventory }:{}) }})),...await this.remote.rows()]} })
    const localConnectors=this.connectors.local
    assert(localConnectors,'Desktop local connector registry must be configured')
    this.packages=new ExpertPackages(this.experts,{ platform:()=>this.identity()?.baseUrl,scope:()=>this.identity()?.key,unpack:bytes=>this.skills.local.unpack(bytes),pack:files=>this.skills.local.pack(files),skills:{ state:()=>this.skills.state(),preview:(files,name)=>this.skills.local.previewFiles(files,name),install:token=>this.skills.local.install(token),discard:token=>this.skills.local.discard(token),remove:id=>this.skills.local.uninstall(id),files:id=>this.skills.local.exportFiles(id),authorized:async(id,version)=>!!await this.skills.hostGet(id,version) },connectors:{ list:()=>localConnectors.list(),template:input=>localConnectors.template(input),portable:id=>localConnectors.portable(id),save:input=>localConnectors.saveDisabled(input),remove:id=>localConnectors.remove(id),fingerprint:async (id)=>{const row=(await this.connectors.hostSnapshot()).find(r=>r.id===id);if(!row)throw new Error('expert_dependencies_missing');return this.hash(JSON.stringify(row.inventory))},authorized:async(id,digest)=>{const row=(await this.connectors.hostSnapshot()).find(r=>r.id===id);return !!row&&this.hash(JSON.stringify(row.inventory))===digest},firstParty:(key,name,restore)=>this.firstPartyConnector(key,name,restore) } })
    for(const kind of ['skills','connectors','experts'] as const){const channel=`actvero:${kind}:invoke`;this.channels.push(channel);ipcMain.handle(channel,async(event,action:unknown,raw:unknown)=>{this.authorize(event);if(typeof action!=='string'||action.length>40)throw new Error('invalid_action');try{return { ok:true,value:await this.dispatch(kind,action,input(raw??{})) }}catch(e){return { ok:false,error:safeError(e) }}})}
    const drop='actvero:skills:drop';this.channels.push(drop);ipcMain.handle(drop,async(event,path:unknown)=>{this.authorize(event);try{if(typeof path!=='string'||!path||path.length>4096||path.includes('\0'))throw new Error('invalid_input');return { ok:true,value:await this.skills.local.preview(path) }}catch(e){return { ok:false,error:safeError(e) }}})
    app.once('will-quit',()=>this.dispose())
  }
  private async ensureFreeCADConnector(restore=false){
    const local=this.connectors.local;if(!local)return
    try{
      const roots=process.env.ACTVERO_FREECAD_DATA_DIR
        ? [process.env.ACTVERO_FREECAD_DATA_DIR]
        : process.platform==='darwin'
          ? [join(app.getPath('appData'),'ActveroFreeCAD')]
          : process.platform==='win32'
            ? [join(process.env.LOCALAPPDATA||join(app.getPath('home'),'AppData','Local'),'ActveroFreeCAD')]
            : [join(process.env.XDG_DATA_HOME||join(app.getPath('home'),'.local','share'),'actvero-freecad')]
      let installationPath:string|undefined,installation:{ python?:unknown;freecad?:{ gui?:unknown } }|undefined
      for(const root of roots){try{const candidate=join(root,'installation.json');installation=JSON.parse(await readFile(candidate,'utf8'));installationPath=candidate;break}catch{/* Try the platform's next managed location. */}}
      if(!installationPath||!installation)return
      if(typeof installation.python!=='string'||!installation.python||typeof installation.freecad?.gui!=='string'||!installation.freecad.gui)return
      // A managed connector is created only once during normal startup. Removing
      // it from the local connector manager is an explicit user choice; keep
      // that choice across relaunches until an expert import explicitly requires
      // FreeCAD and asks the package path to restore it.
      try {
        const markerPath=join(this.root,'managed-connectors.json')
        const suppressed=JSON.parse(await readFile(markerPath,'utf8')) as Record<string,unknown>
        if(!restore&&(suppressed.freecadSuppressed===true||suppressed.freecadInstallation===installationPath))return
        if(restore&&suppressed.freecadSuppressed===true){
          // An expert package that explicitly requires FreeCAD is an intentional
          // request to restore this desktop-managed registration. Keep every
          // unrelated marker field intact; only clear FreeCAD's suppression bit.
          await writeFile(markerPath,JSON.stringify({ ...suppressed,freecadSuppressed:false }),{ mode:0o600 })
        }
      } catch {/* Missing or invalid marker means the managed connector may be offered. */}
      const config={ name:'FreeCAD MCP',transport:'stdio',command:installation.python,args:['-m','actvero_freecad_mcp.cli','--host','127.0.0.1'],cwd:'',env:{ ACTVERO_FREECAD_CONFIG:installationPath },auth:'none',token:'',headers:{},clientId:'' }
      const rows=await local.list();const existing=rows.find(row=>row.name.toLocaleLowerCase()==='freecad mcp')
      if(!existing){
        await local.dispatch('localSave',{ config })
        const saved=(await local.list()).find(row=>row.name.toLocaleLowerCase()==='freecad mcp')
        if(saved&&!saved.enabled)await local.dispatch('localEnable',{ id:saved.id,enabled:true })
        return
      }
      const current=await local.configuration(existing.id)
      const same=current.name===config.name&&current.transport===config.transport&&current.command===config.command
        &&JSON.stringify(current.args)===JSON.stringify(config.args)&&current.cwd===config.cwd
        &&current.env.ACTVERO_FREECAD_CONFIG===installationPath
      if(!same||!existing.enabled||existing.status!=='connected'){
        await local.dispatch('localSave',{ id:existing.id,config })
        const refreshed=await local.list();const saved=refreshed.find(row=>row.id===existing.id)
        if(saved&&!saved.enabled)await local.dispatch('localEnable',{ id:existing.id,enabled:true })
      }
    }catch{/* FreeCAD is optional; the environment assistant will surface setup errors. */}
  }
  private async markManagedFreeCADSuppressed(installationPath:unknown){
    if(typeof installationPath!=='string'||!installationPath)return
    try{
      await mkdir(this.root,{ recursive:true })
      await writeFile(join(this.root,'managed-connectors.json'),JSON.stringify({ freecadSuppressed:true,freecadInstallation:installationPath }),{ mode:0o600 })
    }catch{/* The connector was removed; a marker failure must not turn a successful delete into an error. */}
  }
  private async firstPartyConnector(key:string,name:string,restore=false){
    if(key!=='freecad-mcp'||name.toLocaleLowerCase()!=='freecad mcp')return undefined
    await this.firstPartyReady
    if(restore)await this.ensureFreeCADConnector(true)
    const rows=await this.connectors.local?.list()??[]
    const row=rows.find(candidate=>candidate.name.toLocaleLowerCase()==='freecad mcp')
    // Bind experts to the managed connector as soon as it is enabled. Its
    // connection state is reported by the connector manager; requiring
    // `connected` here made package import race startup and fall back to a
    // broken uvx template. A failed/connecting instance remains visible for
    // repair instead of being duplicated as another local connector.
    return row?.enabled?row.id:undefined
  }
  private hash(value:string){return createHash('sha256').update(value).digest('hex')}
  private identity(){const s=this.account.snapshot();if(!s.user||!s.organization)return undefined;return { key:this.hash(`${s.baseUrl}|${s.user.id}|${s.organization.tenantId}|${s.organization.memberId}`),baseUrl:s.baseUrl,available:s.phase==='ready'&&s.organization.status==='active'&&!s.organization.needsLogin }}
  /** Account changes invalidate all token, catalog and connection caches together. */
  accountChanged(){
    const identity=this.identity(),key=identity?.key??'',available=identity?.available??false
    if(key===this.owner){
      if(available!==this.available){this.available=available;this.changed()}
      return
    }
    this.owner=key;this.available=available
    this.restored.clear();this.packages.invalidate();this.skills.invalidate();this.connectors.invalidate();this.remote.invalidate()
    const send=this.send;this.close();this.send=send;this.changed()
  }
  private read<T>(path:string,fallback:T):Promise<T>{return this.storage.read(path,fallback)}
  private save(path:string,value:unknown){return this.storage.save(path,value)}
  private authorize(event:IpcMainInvokeEvent){if(event.senderFrame!==event.sender.mainFrame||!this.windows().some(w=>w&&!w.isDestroyed()&&w.webContents===event.sender))throw new Error('unauthorized_sender');const url=new URL(event.senderFrame.url);if(url.protocol!==`${SCHEME}:`||url.hostname!=='app')throw new Error('unauthorized_origin')}
  attach(send:(message:CapabilityMainMessage)=>void){this.close();this.send=send}
  close(){this.send=undefined;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('capability_host_unavailable'))}this.pending.clear();for(const c of this.active.values())c.abort();this.active.clear()}
  private changed(){for(const w of this.windows())if(w&&!w.isDestroyed())for(const kind of ['skills','connectors','experts'])w.webContents.send(`actvero:${kind}:changed`);try{this.send?.({ type:'actvero:skills:changed' });this.send?.({ type:'actvero:mcp:changed' });this.send?.({ type:'actvero:llm:changed' })}catch{/* Host restart republishes from persistent state. */}}
  private control(type:'actvero:skills:sync'|'actvero:experts:control',value:Record<string,unknown>):Promise<unknown>{return new Promise((resolve,reject)=>{if(!this.send){reject(new Error('capability_host_unavailable'));return}if(this.pending.size>=100){reject(new Error('operation_in_progress'));return}const id=randomUUID(),timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('capability_host_timeout'))},45000);this.pending.set(id,{ resolve,reject,timer });try{this.send({ type,id,...value } as CapabilityMainMessage)}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e as Error)}})}
  /** Called only after the closed wire validator in DesktopHostProcess. */
  receive(message:CapabilityHostMessage){if(message.type==='actvero:mcp:cancel'){this.active.get(message.id)?.abort();return}if(message.type==='actvero:skills:synced'||message.type==='actvero:experts:controlled'){const p=this.pending.get(message.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(message.id);if(message.error)p.reject(new Error(message.error));else p.resolve(message.value);return}if(message.type==='actvero:llm:request'){void this.account.resourceToken(message.input.resource).then(value=>this.send?.({ type:'actvero:llm:result',id:message.id,value }),error=>this.send?.({ type:'actvero:llm:result',id:message.id,error:safeError(error) }));return}if(this.active.size>=100){this.reply(message,undefined,'operation_in_progress');return}const abort=new AbortController();this.active.set(message.id,abort);const work=async()=>{const p=message.input;if(message.type==='actvero:skills:request')return message.action==='list'?this.skills.hostList():this.skills.hostGet(String(p.id),String(p.versionId));if(message.type==='actvero:experts:request'){if(message.action==='connector-state')return this.connectorState(p);if(message.action==='activate'){await this.experts.resolve(String(p.id));return this.connectorState({ ...p,snapshotId:p.id },true)}return this.experts.dispatch(message.action,p)}if(message.action==='snapshot'){const sessions=Array.isArray(p.sessions)?p.sessions.filter((v):v is string=>typeof v==='string'&&v.length<100):[];return [...await this.connectors.hostSnapshot(sessions),...await this.remote.snapshot(sessions)]}return String(p.id).startsWith('expert-mcp-')?this.remote.call(String(p.id),String(p.sessionId),String(p.method),p.params,abort.signal):this.connectors.call(String(p.id),String(p.sessionId),String(p.method),p.params,abort.signal)};void work().then(value=>this.reply(message,value),e=>this.reply(message,undefined,safeError(e))).finally(()=>this.active.delete(message.id))}
  private reply(message:Extract<CapabilityHostMessage,{ action:string }>,value?:unknown,error?:string){try{this.send?.({ type:message.type.replace('request','result') as 'actvero:skills:result'|'actvero:experts:result'|'actvero:mcp:result',id:message.id,...(error?{ error }:{ value }) })}catch{/* Disconnected request belongs to the previous Host. */}}
  /** Restores durable intent before Host takes its capability snapshot. No credential material leaves Main. */
  private async connectorState(p:Record<string,unknown>,force=false){
    const session=String(p.sessionId??'');if(!session||session.length>200)throw new Error('session_required')
    const choices=Array.isArray(p.choices)?p.choices as { id:string;scope:string;enabled:boolean }[]:[]
    if(choices.length>256||choices.some(c=>!c||typeof c.id!=='string'||typeof c.scope!=='string'||typeof c.enabled!=='boolean'))throw new Error('invalid_selection')
    if(typeof p.snapshotId==='string'&&!this.restored.has(session))await this.experts.resolve(p.snapshotId).catch(()=>{})
    const scope=this.identity()?.key??'',base=await this.connectors.state(session),local=await this.connectors.local?.list()??[]
    const bound=typeof p.snapshotId==='string'?await this.experts.connectorPolicy(p.snapshotId):[]
    const catalog=await Promise.all(base.added.map(async (id)=>{const detail=await this.connectors.detail(id).catch(()=>undefined);return { id,scope:id.startsWith('local-')?'local':scope,name:detail?.display_name??local.find(c=>c.id===id)?.name??id,description:detail?.description??'',...(detail?.icon?{ icon:detail.icon }:{}),required:false }}))
    const byId=new Map<string,{ id:string;scope:string;name:string;description:string;icon?:string;required:boolean }>(
      catalog.map(row=>[row.id,row]))
    for(const row of bound)byId.set(row.id,{ ...byId.get(row.id),...row,scope:row.id.startsWith('local-')?'local':scope })
    const rows=[...byId.values()]
    const enabled=rows.filter(row=>row.required||(choices.find(c=>c.id===row.id&&c.scope===row.scope)?.enabled
      ??(bound.some(b=>b.id===row.id)||base.enabled.includes(row.id)))).map(r=>r.id)
    const signature=JSON.stringify([scope,p.snapshotId,choices,rows.map(r=>r.id),enabled])
    if(force||this.restored.get(session)!==signature){this.restored.set(session,signature);for(const row of rows){const on=enabled.includes(row.id);if(row.id.startsWith('local-')&&!local.find(c=>c.id===row.id)?.enabled)continue;try{if(row.id.startsWith('expert-mcp-'))await this.remote.select(row.id,session,on);else if(base.enabled.includes(row.id)!==on)await this.connectors.select(row.id,session,on)}catch{/* Intent is retained; failed connections stay unavailable to Host. */}}}
    const ready=[...(await this.connectors.state(session)).ready,...(await this.remote.rows()).filter(r=>r.ready).map(r=>r.id)]
    return { added:rows.map(r=>r.id),enabled,ready,rows }
  }
  private async dispatch(kind:'skills'|'connectors'|'experts',action:string,p:Record<string,unknown>){this.accountChanged();if(kind==='skills'){if(action==='localPick'){if(!['file','folder'].includes(String(p.kind)))throw new Error('invalid_input');const result=await dialog.showOpenDialog({ properties:[p.kind==='folder'?'openDirectory':'openFile'],filters:[{ name:'Skill package',extensions:['zip','md'] }] });if(result.canceled||!result.filePaths[0])return null;return this.skills.local.preview(result.filePaths[0])}return this.skills.dispatch(action,p)}if(kind==='connectors'){if((action==='state'||action==='select')&&typeof p.sessionId==='string'&&p.sessionId)return this.control('actvero:experts:control',{ action:action==='state'?'connector-state':'connector-select',input:p });if((action==='remove'||action==='localRemove')&&typeof p.id==='string'&&p.id.startsWith('local-')){await this.firstPartyReady;const id=p.id;const config=await this.connectors.local?.configuration(id).catch(()=>undefined);const result=await this.connectors.dispatch('localRemove',p);if(config?.name.toLocaleLowerCase()==='freecad mcp'){await this.markManagedFreeCADSuppressed(config.env.ACTVERO_FREECAD_CONFIG)}return result}return this.connectors.dispatch(action,p)}
    switch(action){case 'package-pick':{const result=await dialog.showOpenDialog({ properties:['openFile'],filters:[{ name:'Expert package',extensions:['zip','json'] }] });if(result.canceled||!result.filePaths[0])return null;const path=result.filePaths[0],file=await import('node:fs/promises').then(fs=>fs.open(path,'r'));try{const st=await file.stat();if(!st.isFile()||st.size>20*1024*1024)throw new Error('expert_package_invalid');const bytes=await file.readFile();if(bytes.length>20*1024*1024)throw new Error('expert_package_invalid');if(/\.json$/i.test(path)){if(bytes.length>650000)throw new Error('expert_package_invalid');return { kind:'json',manifest:JSON.parse(bytes.toString('utf8')) }}return { kind:'zip',plan:await this.packages.preview(bytes) }}finally{await file.close()}}case 'package-discard':return this.packages.discard(String(p.token));case 'package-import':return this.packages.import(String(p.token));case 'package-export':{const result=await this.packages.export(String(p.id)),pick=await dialog.showSaveDialog({ defaultPath:result.name.replace(/[\\/:*?"<>|]/g,'_')+'.zip',filters:[{ name:'Expert package',extensions:['zip'] }] });if(pick.canceled||!pick.filePath)return false;await writeFile(pick.filePath,result.bytes,{ mode:0o600 });return true}case 'select':if(typeof p.id==='string'&&p.id.startsWith('remote-'))await this.remote.stage(p.id);return this.control('actvero:experts:control',{ action,input:p });case 'selection':return this.control('actvero:experts:control',{ action,input:p });case 'remote-list':return this.remote.list(String(p.q??''),String(p.category??''),Number(p.page??1));case 'remote-categories':return this.remote.categories(String(p.q??''));case 'remote-detail':return this.remote.detail(String(p.id));case 'remote-plan':return this.remote.plan(String(p.id));case 'sources':return { remote:this.remote.available() };case 'remote-available':return this.remote.available();default:return this.experts.dispatch(action,p)}
  }
  dispose(){
    this.close();this.packages.invalidate();for(const channel of this.channels)ipcMain.removeHandler(channel)
    void this.connectors.dispose();this.remote.dispose()
  }
}
