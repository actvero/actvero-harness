import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './workbenches.module.css'

const storageKey = 'actvero.workbenches.project-checklist.v1'
const items = ['sampleItem1', 'sampleItem2', 'sampleItem3'] as const
type Item = typeof items[number]

function readCompleted(): Item[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(value) ? items.filter(item => value.includes(item)) : []
  } catch (_error) {
    return []
  }
}

/** Small built-in workbench with device-local checklist progress. */
export function Example({ t }: PropsLocale<'actvero.workbenches'>) {
  const [completed, setCompleted] = useState(readCompleted)
  const [save, setSave] = useState<'sampleSaved' | 'sampleSaveFailed'>()
  function toggle(item: Item) {
    const next = completed.includes(item) ? completed.filter(value => value !== item) : [...completed, item]
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setCompleted(next)
      setSave('sampleSaved')
    } catch (_error) {
      setSave('sampleSaveFailed')
    }
  }
  return <section className={styles.checklist}>
    <header>
      <h2>{t('sampleSection')}</h2>
      <span className={styles.meta}>{completed.length} / {items.length}</span>
    </header>
    {items.map(item => <label className={styles.checklistItem} key={item}>
      <input type="checkbox" checked={completed.includes(item)} onChange={() =>{  toggle(item) }} />
      <span>{t(item)}</span>
    </label>)}
    <p role="status" className={styles.meta}>{save && t(save)}</p>
  </section>
}
