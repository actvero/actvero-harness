import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './checklist.module.css'

const items = ['scope', 'materials', 'review'] as const
type Item = typeof items[number]

function read(storageKey: string): { completed: Item[]; failed: boolean } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(value) || value.some(item => !items.includes(item))) return { completed: [], failed: true }
    return { completed: items.filter(item => value.includes(item)), failed: false }
  } catch (_error) {
    return { completed: [], failed: true }
  }
}

/** Device-local checklist; failed reads never overwrite saved data.
 * @param props Localized copy, display metadata and package-scoped storage key.
 * @returns The workbench business panel.
 */
export function Checklist({ t, name, description, storageKey }: PropsLocale<'actvero.template.checklist'> & {
  name: string; description: string; storageKey: string
}) {
  const [state, setState] = useState(() => read(storageKey))
  const [notice, setNotice] = useState<'saved' | 'saveFailed'>()
  function toggle(item: Item) {
    const completed = state.completed.includes(item) ? state.completed.filter(value => value !== item) : [...state.completed, item]
    try {
      localStorage.setItem(storageKey, JSON.stringify(completed))
    } catch (_error) {
      setNotice('saveFailed')
      return
    }
    setState({ completed, failed: false })
    setNotice('saved')
  }
  return <div className={styles.page}>
    <h1>{name}</h1>
    <p className={styles.description}>{description}</p>
    <section className={styles.checklist}>
      <header><h2>{t('section')}</h2><span className={styles.meta}>{state.completed.length} / {items.length}</span></header>
      {items.map(item => <label className={styles.item} key={item}>
        <input type="checkbox" disabled={state.failed} checked={state.completed.includes(item)} onChange={() => { toggle(item) }} />
        <span>{t(item)}</span>
      </label>)}
      <p role="status" className={styles.meta}>{state.failed ? t('readFailed') : notice && t(notice)}</p>
    </section>
  </div>
}
