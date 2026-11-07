/** Built-in business view; human controls and AI actions share the Host document. */
import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkbenchBodyProps } from '../../contracts.ts'
import { checklistDocument } from '../../checklist-data.ts'
import styles from './workbenches.module.css'

/** Checklist with durable, concurrent-edit-aware actions. */
export function Example({ t, workbench, useResource }: PropsLocale<'actvero.workbenches'> & WorkbenchBodyProps) {
  const resource = useResource<'actvero-workbench'>(workbench.resourceAddress ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<'saveConflict' | 'sampleSaveFailed' | null>(null)
  const [text, setText] = useState('')
  const value = resource.value
  const parsed = value ? checklistDocument.safeParse(JSON.parse(value.json)) : null
  const state = parsed?.success ? parsed.data : null
  async function submit(action: string, args: object): Promise<void> {
    if (!value || pending) return
    setPending(true); setError(null)
    try {
      await workbench.action(value.revision, action, JSON.stringify(args))
      if (action === 'add') setText('')
    } catch (failure) { setError(remoteErrorOf(failure)?.code === 'workbench/conflict' ? 'saveConflict' : 'sampleSaveFailed') }
    finally { setPending(false) }
  }
  return <div className={styles.examplePage}>
    <h1>{t('sampleName')}</h1>
    <p className={styles.exampleDescription}>{t('sampleDescription')}</p>
    {!state ? <p role="status">{t(resource.status === 'loading' ? 'preparing' : 'unavailable')}</p> : <section className={styles.checklist}>
      <header><h2>{t('sampleSection')}</h2><span className={styles.meta}>{state.items.filter(item => item.completed).length} / {state.items.length}</span></header>
      {state.items.map(item => <label className={styles.checklistItem} key={item.id}>
        <input type="checkbox" disabled={pending || resource.status !== 'live'} checked={item.completed}
          onChange={() => { void submit('complete', { id: item.id, completed: !item.completed }) }} />
        <span>{item.text}</span>
      </label>)}
      <form className={styles.addTask} onSubmit={(event) => { event.preventDefault(); if (text.trim()) void submit('add', { text }) }}>
        <Input value={text} maxLength={2000} placeholder={t('taskPlaceholder')} aria-label={t('taskPlaceholder')}
          onChange={(event) => { setText(event.target.value) }} />
        <Button type="submit" variant="ghost" disabled={pending || !text.trim() || resource.status !== 'live'}>{t('addTask')}</Button>
      </form>
      <p role={error || resource.status === 'failed' ? 'alert' : 'status'} className={styles.meta}>
        {t(error ?? (resource.status === 'failed' ? 'sampleSaveFailed' : 'sampleSaved'))}
      </p>
    </section>}
  </div>
}
