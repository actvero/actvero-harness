/** Shared directory discovery and atomic skill insertion for capability surfaces. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One skill returned by the effective Session catalog. */
export interface NativeSkill {
  /** Stable invocation name. */
  name: string
  /** Package description from SKILL.md. */
  description: string
  /** Original entrypoint when this skill exposes a file preview. */
  path?: string
  /** Whether the model may select this skill without an explicit user gesture. */
  modelInvocable: boolean
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Retains the Session until native skill discovery settles. */
    actveroSkillCatalog: unknown
  }
}

/**
 * Read the effective catalog, including directory skills and exact expert pins.
 * @param ctx - capability plugin context with the Session and skill Remote services.
 * @param sessionId - retained conversation whose workspace and expert determine the catalog.
 * @param signal - optional cancellation for a replaced query or closed panel.
 * @returns native user-invocable skill summaries.
 */
export async function nativeSkills(ctx: Context, sessionId: SessionId, signal?: AbortSignal): Promise<readonly NativeSkill[]> {
  return ctx.sessions.using(sessionId, { source: 'actveroSkillCatalog', ...(signal ? { signal } : {}) }, async () => {
    const result = await ctx.remote.skills.list({ sessionId }, signal)
    signal?.throwIfAborted()
    if (!result.ok) throw new Error('skill_catalog_unavailable')
    return result.value.skills
  })
}

/**
 * Append one atomic badge without discarding draft text, then restore composer focus.
 * @param ctx - capability plugin context with the Session, composer and layout services.
 * @param sessionId - live conversation that owns the draft.
 * @param skill - catalog-verified invocation name.
 */
export function insertSkill(ctx: Context, sessionId: SessionId, skill: { name: string }): void {
  const scope = ctx.sessions.scope(sessionId)
  if (!scope) throw new Error('session_unavailable')
  const input = ctx.conversation.input.for(scope)
  let draft = input.state.getSnapshot()
  if (draft.draft && !/\s$/.test(draft.draft)) {
    const end = draft.draft.length - draft.occurrences.reduce((sum, item) => sum + item.length - 1, 0)
    if (!scope.bail(scope, 'slash/input-insert-text', { text: ' ', span: { start: end, end, draftRev: draft.draftRev } })) {
      throw new Error('draft_busy')
    }
    draft = input.state.getSnapshot()
  }
  const at = draft.draft.length - draft.occurrences.reduce((sum, item) => sum + item.length - 1, 0)
  if (!scope.bail(scope, 'slash/input-insert-reference', {
    span: { start: at, end: at, draftRev: draft.draftRev },
    reference: { source: 'skill', ref: `/${skill.name}`, label: skill.name, appearance: 'skill', clipboardText: `/${skill.name}` },
  })) throw new Error('draft_busy')
  ctx.layout.selectPanel(null)
  requestAnimationFrame(() => { input.focus() })
}
