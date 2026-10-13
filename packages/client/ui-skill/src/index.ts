/** Host half: validate and publish public skill presentation options. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { type Config, SKILL_CONFIG_GLOBAL } from './config.ts'
export { Config } from './config.ts'

/**
 * Publish skill presentation before the browser plugin activates.
 * @param ctx - Host page injection context.
 * @param config - validated public presentation preference.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: SKILL_CONFIG_GLOBAL, value: { referenceChips: config.referenceChips } })
  })
}
