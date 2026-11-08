/** Host extension points for independently developed workbenches. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkbenchEnvironment, WorkbenchExpert, WorkbenchId, WorkbenchObject } from './types.ts'
import type { WorkbenchObjectId } from './workbench-reference.ts'
import type { WorkbenchProtocol } from './workbench-protocol.ts'

/** Per-conversation context; business data stays separate from model-visible instructions. */
export interface WorkbenchRuntimeContext extends WorkbenchEnvironment {
  sessionId: SessionId
  /** Fixed conversation target; null for instance-wide conversations. */
  readonly object: WorkbenchObject | null
}
/** Optional host-managed JSON storage; authors may instead own files, databases or remote storage. */
export interface WorkbenchJsonStorage {
  /** Valid JSON returned once for a new instance. */
  initial(): string
  /** Pure business transform. The runtime serializes it with other writes. */
  reduce(json: string, action: string, args: string): string
  /** Model-visible action documentation, captured by native prompt assembly. */
  actionHelp: string
}
/** Metadata and optional conversation preparation shared by both storage modes. */
export interface WorkbenchProviderBase {
  /** Host API requirements shared with the Client registration; omitted for legacy packages. */
  protocol?: WorkbenchProtocol
  id: WorkbenchId
  name: string
  version: string
  /** Absolute package resources directory; omitted legacy providers expose null in the environment. The host never writes here. */
  resourcesDirectory?: string
  /** Enable native conversations. Defaults to true for legacy JSON providers and false for custom providers. */
  ai?: boolean
  /** Fixed platform reads requested by this package; omission denies platform access. */
  platform?: readonly 'models:read'[]
  expert?: WorkbenchExpert
  /** Resolve an existing author-owned object before binding and every model step; never create a replacement.
   * @param id Stable object identity in this instance.
   * @param environment Managed instance paths, without ambient UI selection.
   * @param signal Cancellation; reject missing or inaccessible objects and stop owned work before settling.
   * @returns Current display name; only explicit binding records a new name.
   */
  resolveObject?(id: WorkbenchObjectId, environment: WorkbenchEnvironment, signal: AbortSignal): Promise<{ label: string }>
  /** Prepare before binding and each model step. Observe cancellation and settle only after owned work stops;
   * failure prevents the model request and releases this conversation's capabilities. Persistent registrations belong in activate.
   */
  prepare?(context: WorkbenchRuntimeContext, signal: AbortSignal): Promise<void>
  /** Mount capabilities through the supplied scope once per binding lifetime. Failures dispose contributions.
   * Observe cancellation; do not await your own unregister or scope disposal. Returned instructions are captured in the Session.
   */
  activate?(ctx: Context, context: WorkbenchRuntimeContext, signal: AbortSignal): Promise<WorkbenchActivation>
}
/** Exact dependency generation and optional compiled expert instructions for a conversation. */
export interface WorkbenchActivation {
  /** Content identity used to reject changed dependencies on resume. */
  digest: string
  expert: WorkbenchExpert | null
}
/** Legacy JSON providers retain their data and registration API. */
export interface WorkbenchLegacyProvider extends WorkbenchProviderBase, WorkbenchJsonStorage {}
/** Independent business provider; omitting storage keeps business data entirely author-owned. */
export interface WorkbenchCustomProvider extends WorkbenchProviderBase {
  /** Optional JSON adapter; absence disables workbench_read and workbench_action. */
  storage?: WorkbenchJsonStorage
}
/** Business behavior registered for the lifetime of its plugin. */
export type WorkbenchProvider = WorkbenchLegacyProvider | WorkbenchCustomProvider

/** Resolve the legacy API or explicitly selected JSON adapter.
 * @param provider Registered business implementation.
 * @returns JSON storage, or undefined for author-owned storage.
 */
export function workbenchJsonStorage(provider: WorkbenchProvider): WorkbenchJsonStorage | undefined {
  return 'initial' in provider ? provider : provider.storage
}

/** Resolve explicit AI configuration while preserving legacy conversation behavior.
 * @param provider Registered business implementation.
 * @returns Whether users may bind native conversations.
 */
export function workbenchAIEnabled(provider: WorkbenchProvider): boolean {
  return provider.ai ?? ('initial' in provider)
}
