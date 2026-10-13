import { it,expect,vi,onTestFinished } from 'vitest'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
const native=vi.hoisted(()=>({ root:'',handlers:new Map<string,unknown>() }))
vi.mock('electron',()=>({ app:{ getPath:()=>native.root,once:()=>{} },dialog:{},ipcMain:{ handle:(name:string,handler:unknown)=>native.handlers.set(name,handler),removeHandler:(name:string)=>native.handlers.delete(name) },safeStorage:{ isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(value),decryptString:(value:Buffer)=>value.toString() },shell:{ openExternal:async()=>{} } }))
import { Capabilities } from '../src/actvero/capabilities/runtime.ts'
import type { CapabilityMainMessage } from '../src/actvero/capability-ipc.ts'
it('notifies the model catalog when the same account goes offline and recovers',async()=>{
  native.root=await mkdtemp(join(tmpdir(),'actvero-availability-'))
  let phase='ready',needsLogin=false
  const account={ snapshot:()=>({ baseUrl:'https://platform.example',phase,user:{ id:'user-a' },organization:{ tenantId:'tenant-a',memberId:'member-a',status:'active',needsLogin } }),resourceToken:async()=>{throw new Error('must_not_issue')} }
  const caps=new Capabilities(account as never,()=>[])
  onTestFinished(async()=>{caps.dispose();await caps.connectors.dispose();await rm(native.root,{ recursive:true,force:true })})
  const send=vi.fn<(message:CapabilityMainMessage)=>void>()
  caps.attach(send);caps.accountChanged();send.mockClear()
  const notifications=()=>send.mock.calls.filter(([message])=>message.type==='actvero:llm:changed').length
  phase='offline';caps.accountChanged()
  expect(notifications()).toBe(1)
  caps.accountChanged();expect(notifications()).toBe(1)
  phase='ready';caps.accountChanged();expect(notifications()).toBe(2)
  needsLogin=true;caps.accountChanged();expect(notifications()).toBe(3)
  needsLogin=false;caps.accountChanged();expect(notifications()).toBe(4)
})
it('keeps required connectors on, honors optional off and isolates platform choices by account scope',async()=>{
  native.root=await mkdtemp(join(tmpdir(),'actvero-intent-'));const account={ snapshot:()=>({ baseUrl:'https://platform.example',phase:'ready',user:{ id:'user-a' },organization:{ tenantId:'tenant-a',memberId:'member-a',status:'active' } }),resourceToken:async()=>{throw new Error('must_not_issue')} }
  const caps=new Capabilities(account as never,()=>[])
  onTestFinished(async()=>{caps.dispose();await rm(native.root,{ recursive:true,force:true });vi.restoreAllMocks()})
  await caps.experts.list()
  vi.spyOn(caps.connectors,'state').mockResolvedValue({ added:['remote-required','remote-optional','remote-extra'],enabled:['remote-required','remote-optional'],ready:[] });vi.spyOn(caps.connectors,'detail').mockImplementation(async id=>({ id,display_name:id,description:'' }) as never);const select=vi.spyOn(caps.connectors,'select').mockResolvedValue({ added:[],enabled:[],ready:[] })
  vi.spyOn(caps.remote,'rows').mockResolvedValue([]);vi.spyOn(caps.experts,'resolve').mockResolvedValue({} as never);vi.spyOn(caps.experts,'connectorPolicy').mockResolvedValue([{ id:'remote-required',name:'Required',description:'',required:true },{ id:'remote-optional',name:'Optional',description:'',required:false }])
  const query=(input:Record<string,unknown>)=>new Promise<{ enabled:string[];ready:string[];rows:{ id:string;scope:string;required:boolean }[] }>((resolve,reject)=>{const id=randomUUID();caps.attach((m:CapabilityMainMessage)=>{if('id' in m&&m.id===id&&m.type==='actvero:experts:result'){if(m.error)reject(new Error(m.error));else resolve(m.value as never)}});caps.receive({ type:'actvero:experts:request',id,action:'connector-state',input })})
  const first=await query({ sessionId:'conversation',snapshotId:'snapshot',choices:[] }),scope=first.rows[0]!.scope
  const closed=await query({ sessionId:'conversation',snapshotId:'snapshot',choices:[{ scope,id:'remote-required',enabled:false },{ scope,id:'remote-optional',enabled:false }] })
  expect(closed.enabled).toEqual(['remote-required']);expect(closed.rows.map(row=>row.id)).toContain('remote-extra');expect(closed.ready).toEqual([]);expect(select).toHaveBeenCalledWith('remote-optional','conversation',false);expect(select).not.toHaveBeenCalledWith('remote-required','conversation',false)
  select.mockClear();await query({ sessionId:'conversation',snapshotId:'snapshot',choices:[{ scope,id:'remote-required',enabled:false },{ scope,id:'remote-optional',enabled:false }] });expect(select).not.toHaveBeenCalled()
  const extra=await query({ sessionId:'extra',snapshotId:'snapshot',choices:[{ scope,id:'remote-extra',enabled:true }] });expect(extra.enabled).toContain('remote-extra');expect(select).toHaveBeenCalledWith('remote-extra','extra',true)
  vi.mocked(caps.experts.connectorPolicy).mockResolvedValueOnce([]);const unbound=await query({ sessionId:'unbound',snapshotId:'no-connectors',choices:[] });expect(unbound.rows).toHaveLength(3);expect(unbound.rows.every(row=>!row.required)).toBe(true);expect(unbound.enabled).not.toContain('remote-extra')
  const foreign=await query({ sessionId:'other',snapshotId:'snapshot',choices:[{ scope:'another-account',id:'remote-optional',enabled:false }] });expect(foreign.enabled).toContain('remote-optional')
})
