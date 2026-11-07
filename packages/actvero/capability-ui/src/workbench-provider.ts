/** Host extension points for independently developed workbenches. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchExpert, WorkbenchId, WorkbenchInstanceId } from './types.ts'

/** Per-conversation context; business data stays separate from model-visible instructions. */
export interface WorkbenchRuntimeContext {
  id: WorkbenchId
  instanceId: WorkbenchInstanceId
  sessionId: SessionId
  /** Managed directory for this instance's files; the user need not select a folder. */
  dataDirectory: string
}
/** Business behavior registered for the lifetime of its plugin. */
export interface WorkbenchProvider {
  id: WorkbenchId
  name: string
  version: string
  expert?: WorkbenchExpert
  /** Valid JSON returned once for a new instance. */
  initial(): string
  /** Pure business transform. The runtime serializes it with other writes. */
  reduce(json: string, action: string, args: string): string
  /** Model-visible action documentation, captured by native prompt assembly. */
  actionHelp: string
  /** Optional dependency preparation; failure prevents the next model request. */
  prepare?(context: WorkbenchRuntimeContext, signal: AbortSignal): Promise<void>
}
