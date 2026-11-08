/** A runnable empty entry; business UI is supplied after requirements are confirmed. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@actvero/dsh-capability-ui/client/contracts'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement } from 'react'
import manifest from '../../package.json'
import metadata from '../../workbench.json'

const zh = { empty: '空白工作台' }
const en: Record<keyof typeof zh, string> = { empty: 'Blank workbench' }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'actvero.template.blank': keyof typeof zh }
}

/** Required Client services. */
export const inject = ['actveroWorkbenches', 'locale']

/** Register the empty view and release all contributions on unload.
 * @param ctx Client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(manifest.name, 'zh', zh))
  ctx.effect(() => ctx.locale.register(manifest.name, 'en', en))
  function Panel({ t }: PropsLocale<'actvero.template.blank'>) {
    return createElement('div', { style: { padding: 24, color: 'var(--ds-label-secondary)' } }, t('empty'))
  }
  ctx.effect(() => ctx.actveroWorkbenches.register({ ...metadata, id: manifest.name, version: manifest.version }, Panel, { locale: manifest.name as 'actvero.template.blank' }))
}
