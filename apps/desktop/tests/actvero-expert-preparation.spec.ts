import { expect,it,onTestFinished,vi } from 'vitest'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'

type Invoke=(event:IpcMainInvokeEvent,action:unknown,input:unknown)=>Promise<unknown>
const native=vi.hoisted(()=>({ root:'',handlers:new Map<string,Invoke>() }))
vi.mock('electron',()=>({
  app:{ getPath:()=>native.root,once:()=>{} },dialog:{},
  ipcMain:{
    handle:(name:string,handler:Invoke)=>native.handlers.set(name,handler),
    removeHandler:(name:string)=>native.handlers.delete(name),
  },
  safeStorage:{
    isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(value),decryptString:(value:Buffer)=>value.toString(),
  },
  shell:{ openExternal:async()=>{} },
}))
import { Capabilities } from '../src/actvero/capabilities/runtime.ts'

async function setup(){
  const root=await mkdtemp(join(tmpdir(),'actvero-expert-preparation-'))
  native.root=root
  vi.stubEnv('ACTVERO_FREECAD_DATA_DIR',join(root,'freecad'))
  const account={ snapshot:()=>({ baseUrl:'https://platform.example',phase:'ready',user:{ id:'user-a' },organization:{ tenantId:'tenant-a',memberId:'member-a',status:'active' } }),resourceToken:async()=>{throw new Error('unexpected_token_request')} }
  const frame={ url:'dsh-app://app/index.html' },sender={ mainFrame:frame,send:vi.fn() }
  const caps=new Capabilities(account as never,()=>[{ isDestroyed:()=>false,webContents:sender }] as never)
  onTestFinished(async()=>{
    caps.dispose();await caps.connectors.dispose();await rm(root,{ recursive:true,force:true })
    vi.restoreAllMocks();vi.unstubAllEnvs()
  })
  const invoke=native.handlers.get('actvero:experts:invoke')!
  return { caps,invoke,event:{ sender,senderFrame:frame } }
}

it('waits for remote dependency preparation before completing the expert manager request',async()=>{
  const { caps,invoke,event }=await setup(),id='remote-'+'a'.repeat(64)
  const expert:Awaited<ReturnType<typeof caps.remote.stage>>={
    manifest:{ schemaVersion:1,id,version:'1.0.0',name:'Research',description:'',avatar:'',tags:[],instructions:'Research public sources.',conversationStarters:[],skills:[],connectors:[] },
    bindings:{ skills:{ research:'skill-a' },connectors:{ search:'connector-a' } },revision:1,
  }
  let complete!:(value:typeof expert)=>void
  const prepared=new Promise<typeof expert>((resolve)=>{complete=resolve})
  const stage=vi.spyOn(caps.remote,'stage').mockReturnValue(prepared)
  const local=vi.spyOn(caps.experts,'dispatch'),settled=vi.fn()
  const result=invoke(event as never,'remote-stage',{ id }).then((value)=>{settled();return value})
  await vi.waitFor(()=>expect(stage).toHaveBeenCalledWith(id))
  expect(settled).not.toHaveBeenCalled()
  expect(local).not.toHaveBeenCalled()
  complete(expert)
  await expect(result).resolves.toEqual({ ok:true,value:expert })
})

it('reports required dependency failures instead of completing expert preparation',async()=>{
  const { caps,invoke,event }=await setup(),id='remote-'+'b'.repeat(64)
  vi.spyOn(caps.remote,'stage').mockRejectedValue(new Error('expert_dependencies_missing'))
  await expect(invoke(event as never,'remote-stage',{ id })).resolves.toEqual({ ok:false,error:'expert_dependencies_missing' })
})

it('rejects preparation requests from a frame outside the owned desktop window',async()=>{
  const { caps,invoke,event }=await setup()
  const stage=vi.spyOn(caps.remote,'stage')
  await expect(invoke({ ...event,senderFrame:{ url:'dsh-app://app/index.html' } } as never,'remote-stage',{ id:'remote-'+'c'.repeat(64) })).rejects.toThrow('unauthorized_sender')
  expect(stage).not.toHaveBeenCalled()
})
