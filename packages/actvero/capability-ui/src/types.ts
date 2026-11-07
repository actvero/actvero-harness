/** Browser-safe workbench identities, durable selections and business documents. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { TypertResource } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable package-owned workbench identity. */
export type WorkbenchId = Branded<'ActveroWorkbenchId'>
/** Host-created business data instance, independent of its conversations. */
export type WorkbenchInstanceId = Branded<'ActveroWorkbenchInstanceId'>
/** Optional instructions packaged with a workbench; no model configuration is required. */
export interface WorkbenchExpert { name: string; version: string; instructions: string }
/** Immutable environment selected for one conversation. */
export interface WorkbenchSelection {
  id: WorkbenchId
  instanceId: WorkbenchInstanceId
  name: string
  version: string
  expert: WorkbenchExpert | null
}
/** Host-owned persisted business state. JSON content belongs to the provider. */
export interface WorkbenchDocument {
  id: WorkbenchId
  instanceId: WorkbenchInstanceId
  revision: number
  json: string
}
/** Resource named by a business read or write. */
export interface WorkbenchTarget { instanceId: WorkbenchInstanceId }
/** Compare-and-set business action; stale writes fail without applying the action. */
export interface WorkbenchActionRequest extends WorkbenchTarget {
  revision: number
  action: string
  args: string
}
/** Attach to a conversation, or create a conversation when sessionId is absent. */
export interface WorkbenchBindRequest extends WorkbenchTarget { sessionId?: SessionId }
/** Conversation association returned after a durable selection event. */
export interface WorkbenchBinding { sessionId: SessionId; selection: WorkbenchSelection | null }
/** Runtime provider summary. UI-only workbenches do not appear in this list. */
export interface WorkbenchRuntimeEntry { id: WorkbenchId; name: string; version: string }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact workbench environment for subsequent turns. Null explicitly unlinks it; forks retain the recorded association. */
    'actvero/workbench': { schemaVersion: 1; selection: WorkbenchSelection | null }
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { actveroWorkbench: WorkbenchSelection | null }
  interface SessionProjectionMap { actveroWorkbench: WorkbenchSelection | null }
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertResourceMap {
    /** Business instance owned by the workbench runtime. */
    actveroWorkbench: TypertResource<WorkbenchInstanceId>
  }
  interface RemoteErrorDetailsMap {
    /** The linked provider is unavailable or no longer matches its selected version. */
    'workbench/unavailable': Record<string, never>
    /** The business instance does not exist. */
    'workbench/not-found': Record<string, never>
    /** Another write committed; reread the document before submitting a new action. */
    'workbench/conflict': Record<string, never>
    /** Provider rejected an unknown or malformed business action. */
    'workbench/invalid-action': Record<string, never>
    /** Business state could not be read or persisted. */
    'workbench/failed': Record<string, never>
  }
}
