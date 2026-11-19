/** Expert popup rows follow the durable recent-summon list. */
import type { SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { Expert, ExpertSelection } from '../contracts.ts'
import type { zh } from './locales.ts'
import { normalizeExpertSelectionAvatar } from '../avatar.ts'

/** List recent personal summons and loaded workbench experts without manager navigation.
 * @param recent - authorized personal experts followed by package-owned entries.
 * @param current - the current conversation's immutable expert selection.
 * @param t - localized expert dictionary.
 * @returns Native popup options with workbench names distinguishing package-owned entries.
 */
export function expertOptions(recent: (Expert & { workbench?: { name: string } })[], current: ExpertSelection | null,
  t: (key: keyof typeof zh) => string): SelectOption[] {
  const seen = new Set<string>()
  return recent.flatMap(({ manifest, workbench }) => {
    if (seen.has(manifest.id)) return []
    seen.add(manifest.id)
    return [{ id: manifest.id, label: manifest.name,
      ...(workbench ? { detail: workbench.name } : {}),
      avatar: { src: normalizeExpertSelectionAvatar(manifest.avatar), fallback: Array.from(manifest.name)[0] ?? '' },
      group: manifest.id.startsWith('workbench:') ? { name: 'workbench', label: t('fromWorkbench') } : { name: 'recent', label: t('recent') }, active: current?.id === manifest.id } satisfies SelectOption]
  })
}
