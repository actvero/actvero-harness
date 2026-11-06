import type { Context } from '@deepseek-ai/cordis'
import type {} from '@actvero/dsh-capability-ui/client/contracts'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createElement, useSyncExternalStore } from 'react'
import manifest from '../../package.json'
import metadata from '../../workbench.json'
import preview from './assets/project-checklist.png'
import completed from './assets/project-checklist-completed.png'
import { Checklist } from './Checklist.tsx'
import { en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'actvero.template.checklist': keyof typeof zh
  }
}

/** Services supplied by the Actvero desktop. */
export const inject = ['actveroWorkbenches', 'locale']

/** Register the packaged panel until this plugin is disposed.
 * @param ctx This workbench's Client plugin scope.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(manifest.name, 'zh', zh))
  ctx.effect(() => ctx.locale.register(manifest.name, 'en', en))
  const t = ctx.locale.bind(manifest.name)
  const subscribe = (listener: () => void) => ctx.locale.subscribe(listener)
  const snapshot = () => ctx.locale.getLocale()
  function Panel() {
    useSyncExternalStore(subscribe, snapshot)
    return createElement(Checklist, { t, name: metadata.name, description: metadata.description, storageKey: `${manifest.name}:checklist:v1` })
  }
  ctx.effect(() => ctx.actveroWorkbenches.register({
    ...metadata, id: manifest.name, version: manifest.version, previewUrls: [preview, completed],
  }, Panel))
}
