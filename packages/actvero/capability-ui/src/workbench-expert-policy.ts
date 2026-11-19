/** Host-only expert selection shared by workbench activation and MCP filtering. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ConversationExpertSelection } from './types.ts'

/** Ordinary expert selection and connector intent supplied by its owning plugin. */
export interface ExpertSelectionPolicy {
  /** Resolve the effective selection, including inherited parent experts.
   * @param agent Conversation whose expert source is changing.
   * @returns Exact recorded selection, or null for ordinary mode.
   */
  selection(agent: Agent): Promise<ConversationExpertSelection | null>
  /** Resolve configured connector intent for a conversation.
   * @param agent Conversation requesting tools.
   * @returns Allowed connector IDs, or undefined when no expert restricts the default view.
   */
  connectors(agent: Agent): Promise<readonly string[] | undefined>
}
declare module '@deepseek-ai/cordis' { interface Context { actveroExpertPolicy: ExpertSelectionPolicy } }
