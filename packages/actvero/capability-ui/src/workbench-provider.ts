/** Host extension points for independently developed workbenches. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkbenchEnvironment, WorkbenchExpert, WorkbenchId } from './types.ts'

/** Per-conversation context; business data stays separate from model-visible instructions. */
export interface WorkbenchRuntimeContext extends WorkbenchEnvironment {
  sessionId: SessionId
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
  /** Optional dependency preparation; failure prevents the next model request. */
  prepare?(context: WorkbenchRuntimeContext, signal: AbortSignal): Promise<void>
  /** Mount conversation-scoped capabilities; failures dispose contributions. Returned expert instructions are captured in the Session. */
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
