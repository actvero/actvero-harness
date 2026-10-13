/** Expose only fixed account actions and sanitized snapshots to an owned renderer. */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AccountBridge, AccountSnapshot } from '@actvero/dsh-client-account/protocol'
import { ACCOUNT_IPC } from './ipc.ts'
export function exposeAccountBridge(): void {
  const invoke = (channel: string, value?: string): Promise<void> => ipcRenderer.invoke(channel, value)
  const api: AccountBridge = {
    snapshot: () => ipcRenderer.invoke(ACCOUNT_IPC.snapshot) as Promise<AccountSnapshot | null>,
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: AccountSnapshot): void => {
        listener(value)
      }
      ipcRenderer.on(ACCOUNT_IPC.state, receive)
      return () => {
        ipcRenderer.off(ACCOUNT_IPC.state, receive)
      }
    },
    login: () => invoke(ACCOUNT_IPC.login),
    continueAccount: () => invoke(ACCOUNT_IPC.continueAccount),
    switchAccount: () => invoke(ACCOUNT_IPC.switchAccount),
    cancel: () => invoke(ACCOUNT_IPC.cancel),
    reopen: () => invoke(ACCOUNT_IPC.reopen),
    refresh: () => invoke(ACCOUNT_IPC.refresh),
    quota: () => invoke(ACCOUNT_IPC.quota),
    logout: () => invoke(ACCOUNT_IPC.logout),
    configure: value => invoke(ACCOUNT_IPC.configure, value),
    selectOrganization: value => invoke(ACCOUNT_IPC.selectOrganization, value),
    personalCenter: () => invoke(ACCOUNT_IPC.personalCenter),
    local: () => invoke(ACCOUNT_IPC.local),
    show: () => invoke(ACCOUNT_IPC.show),
  }
  contextBridge.exposeInMainWorld('actveroAccount', api)
}

/** Capability messages expose only sanitized data and a closed action transport. */
export function exposeCapabilityBridges():void {
  for(const kind of ['skills','connectors','experts'])contextBridge.exposeInMainWorld(`actvero${kind[0]!.toUpperCase()}${kind.slice(1)}`,{
    ...(kind==='skills'?{ previewDrop:async(file:File)=>{const path=webUtils.getPathForFile(file);if(!path)throw new Error('invalid_input');const result=await ipcRenderer.invoke('actvero:skills:drop',path) as { ok:boolean;value?:unknown;error?:string };if(!result.ok)throw new Error(result.error??'import_failed');return result.value} }:{}),
    request:async(action:string,input:Record<string,unknown>={})=>{const result=await ipcRenderer.invoke(`actvero:${kind}:invoke`,action,input) as { ok:boolean;value?:unknown;error?:string };if(!result.ok)throw new Error(result.error??'capability_action_failed');return result.value},
    subscribe:(listener:()=>void)=>{const receive=()=>listener();ipcRenderer.on(`actvero:${kind}:changed`,receive);return()=>ipcRenderer.off(`actvero:${kind}:changed`,receive)},
  })
}
