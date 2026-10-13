/** The composer owns a removable expert selection, separate from native agent presets. */
import { useEffect, useState } from 'react'
import { Button, Tooltip, IconCloseOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
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
/** Show the expert portrait and name; hover exposes removal and the name reopens its picker.
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
  return choice ? <span className={styles.expertBadge} data-expert-badge="">
    <Tooltip label={t('cancelExpert')} portal side="top"><Button variant="ghost" className={styles.expertRemove}
      aria-label={t('cancelExpert')} disabled={busy || locked} onMouseDown={event => event.preventDefault()}
      onClick={() => void cancel()}>
      <span className={styles.expertPortrait} aria-hidden="true">
        {choice.avatar && choice.avatar !== failedAvatar ? <img src={choice.avatar} alt=""
          onError={() => setFailedAvatar(choice.avatar)} /> : <span>{choice.name.slice(0, 1)}</span>}
      </span>
      <span className={styles.expertClose} aria-hidden="true"><IconCloseOutlineMedium size={16} /></span>
    </Button></Tooltip>
    <Button variant="ghost" className={styles.expertName} disabled={busy || locked}
      title={choice.name} aria-haspopup="listbox" aria-expanded={expanded} onClick={open}>
      {choice.name}
    </Button>
  </span> : null
}
