/** The composer owns a removable expert selection, separate from native agent presets. */
import { useEffect, useState } from 'react'
import { Tooltip, IconCloseOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ExpertSelection } from '../contracts.ts'
import styles from './experts.module.css'

type Props = PropsLocale<'actvero.experts'> & {
  useChoice: <V>(selector: (choice: ExpertSelection | null) => V) => V
  useLocked: <V>(selector: (locked: boolean) => V) => V
  useExpanded: <V>(selector: (expanded: boolean) => V) => V
  load: () => Promise<void>
  open: () => void
  clear: () => Promise<void>
  failed: () => void
}
/** Open the current expert's picker from the full chip or the compact portrait.
 * @param props - framework-bound selection, input admission and localized callbacks.
 * @returns An expert pill, or no pill when the conversation has no expert.
 */
export function ExpertBadge({ useChoice, useLocked, useExpanded, load, open, clear, failed, t }: Props) {
  const choice = useChoice(value => value)
  const locked = useLocked(value => value)
  const expanded = useExpanded(value => value)
  const [busy, setBusy] = useState(false)
  const [failedAvatar, setFailedAvatar] = useState<string>()
  useEffect(() => { setFailedAvatar(undefined) }, [choice?.id, choice?.avatar])
  useEffect(() => { void load() }, [load])
  const cancel = async () => {
    if (busy || locked) return
    setBusy(true)
    try { await clear() } catch { failed() } finally { setBusy(false) }
  }
  if (!choice) return null
  const disabled = busy || locked
  const portrait = choice.avatar && choice.avatar !== failedAvatar
    ? <img src={choice.avatar} alt="" onError={() => { setFailedAvatar(choice.avatar) }} />
    : Array.from(choice.name)[0]
  return (
    <span className={styles.expertBadge} data-expert-badge="">
      <Tooltip label={t('cancelExpert')} portal side="top" disabled={disabled}>
        <button type="button" className={styles.expertRemove} aria-label={t('cancelExpert')}
          disabled={disabled} onMouseDown={(event) => { event.preventDefault() }} onClick={() => void cancel()}>
          <span className={styles.expertPortrait} aria-hidden="true">{portrait}</span>
          <span className={styles.expertClose} aria-hidden="true"><IconCloseOutlineMedium size={16} /></span>
        </button>
      </Tooltip>
      <Tooltip label={choice.name} portal side="top" disabled={expanded || disabled}>
        <button type="button" className={styles.expertTrigger} disabled={disabled}
          aria-label={choice.name} aria-haspopup="listbox" aria-expanded={expanded} onClick={open}>
          <span className={styles.compactPortrait} aria-hidden="true">{portrait}</span>
          <span className={styles.expertName}>{choice.name}</span>
        </button>
      </Tooltip>
    </span>
  )
}
