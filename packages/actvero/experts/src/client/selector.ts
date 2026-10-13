/** Expert popup rows follow the durable recent-summon list. */
import type { SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { Expert, ExpertSelection } from '../contracts.ts'
import type { zh } from './locales.ts'
import { normalizeExpertSelectionAvatar } from '../avatar.ts'

/** List recent summons in recorded order, without manager or ordinary-mode options.
 * @param recent - authorized experts ordered by the durable summon history.
 * @param current - the current conversation's immutable expert selection.
 * @param t - localized expert dictionary.
 * @returns Native popup options for recent experts only.
 */
export function expertOptions(recent: Expert[], current: ExpertSelection | null,
  t: (key: keyof typeof zh) => string): SelectOption[] {
  const seen = new Set<string>()
  return recent.flatMap(({ manifest }) => {
    if (seen.has(manifest.id)) return []
    seen.add(manifest.id)
    return [{ id: manifest.id, label: manifest.name,
      avatar: { src: normalizeExpertSelectionAvatar(manifest.avatar), fallback: Array.from(manifest.name)[0] ?? '' },
      group: { name: 'recent', label: t('recent') }, active: current?.id === manifest.id }]
  })
}
