/** Browser-safe workbench identities, durable selections and business documents. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { TypertResource } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable package-owned workbench identity. */
export type WorkbenchId = Branded<'ActveroWorkbenchId'>
/** Host-created business data instance, independent of its conversations. */
export type WorkbenchInstanceId = Branded<'ActveroWorkbenchInstanceId'>
/** Platform-owned model identity; selection never exposes a resource token. */
export type WorkbenchModelId = Branded<'ActveroWorkbenchModelId'>
/** Account and organization generation that owns one catalog response. */
export type WorkbenchPlatformScopeId = Branded<'ActveroWorkbenchPlatformScopeId'>
/** Sanitized operation metadata returned by the platform, without upstream URLs or credentials. */
export interface WorkbenchModelOperation { kind: string; inputModalities: string[]; outputModalities: string[] }
/** Available model metadata; operation kinds retain the platform's own vocabulary. */
export interface WorkbenchPlatformModel { id: WorkbenchModelId; name: string; description: string; operations: WorkbenchModelOperation[] }
/** One complete model directory bound to the account generation at request time. */
export interface WorkbenchModelCatalog { scope: WorkbenchPlatformScopeId; models: WorkbenchPlatformModel[] }
/** Optional instructions packaged with a workbench; no model configuration is required. */
export interface WorkbenchExpert { name: string; version: string; instructions: string }
/** Immutable environment selected for one conversation. */
export interface WorkbenchSelection {
  id: WorkbenchId
  instanceId: WorkbenchInstanceId
  name: string
  version: string
  expert: WorkbenchExpert | null
  /** Exact activated dependency generation; absent for providers without scoped capability loading. */
  capabilityDigest?: string
}
/** Stable instance metadata. Custom storage starts at json "null", revision zero; existing JSON remains available for migration. */
export interface WorkbenchDocument {
  id: WorkbenchId
  instanceId: WorkbenchInstanceId
  revision: number
  json: string
}
/** Session-independent runtime paths. Resource paths do not grant model or filesystem permissions. */
export interface WorkbenchEnvironment extends WorkbenchTarget {
  id: WorkbenchId
  version: string
  /** Stable writable root retained across reload, upgrade and uninstall; authors own layout and transactions. */
  dataDirectory: string
  /** Declared package resources, or null when the provider does not declare any. Never use for business writes. */
  resourcesDirectory: string | null
  /** JSON uses the optional host adapter; custom stores only instance metadata in the host. */
  storage: 'json' | 'custom'
  /** Whether the loaded provider enables native conversations. */
  aiEnabled: boolean
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
export interface WorkbenchRuntimeEntry { id: WorkbenchId; name: string; version: string; aiEnabled: boolean }

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
    /** A captured Client command no longer belongs to the conversation's active workbench instance. */
    'workbench/command': { status: 'unavailable' }
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
    /** The provider owns its storage and does not expose the generic JSON action API. */
    'workbench/unsupported-storage': Record<string, never>
    /** Native conversations are disabled by the workbench author. */
    'workbench/ai-disabled': Record<string, never>
    /** Display was not confirmed; inspect the current view after unknown or cancelled outcomes. */
    'workbench/display': { status: Exclude<WorkbenchDisplayResult['status'], 'confirmed'> }
    /** Reference insertion or serialization failed; the draft remains editable for correction. */
    'workbench/reference': { status: 'unavailable' | 'superseded' | 'busy' | 'invalid' }
  }
}

/** Client-owned view modes; focus hides navigation, never enters operating-system fullscreen. */
export interface WorkbenchDisplayRequest {
  id: WorkbenchId
  mode: 'business' | 'conversation' | 'preview'
  /** Existing associated conversation; omitted conversation modes reuse or create a native conversation. */
  sessionId?: SessionId
  /** Omission preserves the user's saved choice. */
  sidebar?: 'preserve' | 'focus'
  /** Omission restores the saved visibility. Showing AI may create a native conversation. */
  ai?: 'show' | 'hide'
}
/** Observed Client state; null identities mean that no workbench is on the foreground view. */
export interface WorkbenchDisplayState {
  id: WorkbenchId | null
  instanceId: WorkbenchInstanceId | null
  sessionId: SessionId | null
  mode: 'business' | 'conversation' | 'other'
  aiVisible: boolean
  previewVisible: boolean
  sidebar: 'expanded' | 'collapsed'
}
/** Confirmed host view mount, or an explicit failure; unknown may have partially changed the view. */
export type WorkbenchDisplayResult = { status: 'confirmed'; state: WorkbenchDisplayState }
  | { status: 'unavailable' | 'ambiguous' | 'unknown' | 'failed' | 'cancelled'; reason: string }
/** Correlation identity minted by the Host for one live Client request. */
export type WorkbenchDisplayRequestId = Branded<'WorkbenchDisplayRequestId'>
/** One Client attachment, independent of the Peer shared by browser documents. */
export type WorkbenchDisplayChannelId = Branded<'WorkbenchDisplayChannelId'>
/** Commands for one live answering Client stream; never replay navigation after connection loss. */
export type WorkbenchDisplayCommand = { type: 'ready'; channelId: WorkbenchDisplayChannelId }
  | { type: 'inspect'; requestId: WorkbenchDisplayRequestId }
  | { type: 'open'; requestId: WorkbenchDisplayRequestId; request: WorkbenchDisplayRequest }
  | { type: 'cancel'; requestId: WorkbenchDisplayRequestId }
