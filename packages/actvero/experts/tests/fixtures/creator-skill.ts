import type { Context } from '@deepseek-ai/cordis'
import { creatorSkill } from '../../src/creator.ts'

export const name = 'snapshot-expert-creator'
export const inject = ['skills']

/** Register the bundled skill in a profile without the Electron expert bridge.
 * @param ctx - Profile context with the native skill registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.skills.register(creatorSkill))
}
