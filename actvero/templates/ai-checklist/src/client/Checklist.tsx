/** Native resource updates are shared by manual controls and AI business tools. */
import { useState } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchBodyProps } from '@actvero/dsh-capability-ui/client/contracts'
import type { WorkbenchModelCatalog } from '@actvero/dsh-capability-ui/types'
import styles from './checklist.module.css'
import { checklistDocument } from '../document.ts'

/** Display the authoritative Host document and request AI only when needed.
 * @param props Native resource hooks, workbench operations and localized copy.
 * @returns Business checklist.
 */
export function Checklist({ t, description, workbench, useResource }: PropsLocale<'actvero.template.ai-checklist'> & Pick<WorkbenchBodyProps, 'workbench' | 'useResource'> & { description: string }) {
  const resource = useResource<'actvero-workbench'>(workbench.resourceAddress ?? '')
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const [catalog, setCatalog] = useState<WorkbenchModelCatalog>()
  const [modelsPending, setModelsPending] = useState(false)
  const [modelsFailed, setModelsFailed] = useState(false)
  const value = resource.value
  const state = value ? checklistDocument.parse(JSON.parse(value.json)) : null
  async function submit(action: string, args: object): Promise<void> {
    if (!value || pending) return
    setPending(true); setError(false)
    try { await workbench.action(value.revision, action, JSON.stringify(args)); if (action === 'add') setText('') }
    catch (_error) { setError(true) }
    finally { setPending(false) }
  }
  async function models(): Promise<void> {
    setModelsPending(true); setModelsFailed(false); setCatalog(undefined)
    try { setCatalog(await workbench.models()) }
    catch (_error) { setModelsFailed(true) }
    finally { setModelsPending(false) }
  }
  return <div className={styles.page}>
    <p className={styles.description}>{description}</p>
    <div className={styles.actions}>
      <Button variant="ghost" disabled={modelsPending} onClick={() => { void models() }}>{t(modelsPending ? 'loading' : 'models')}</Button>
    </div>
    {modelsFailed && <p role="alert">{t('modelsFailed')}</p>}
    {catalog && <p role="status">{t('modelsLoaded')}: {catalog.models.map(model => model.name).join('、') || t('noModels')}</p>}
    {!state ? <p role="status">{t(resource.status === 'failed' ? 'readFailed' : 'loading')}</p> : <section className={styles.checklist}>
      <header><h2>{t('section')}</h2><span className={styles.meta}>{state.items.filter(item => item.completed).length} / {state.items.length}</span></header>
      {state.items.map(item => <Checkbox key={item.id} className={styles.item} label={item.text} checked={item.completed}
        disabled={pending || resource.status !== 'live'} onChange={completed => { void submit('complete', { id: item.id, completed }) }} />)}
      <form className={styles.actions} onSubmit={event => { event.preventDefault(); if (text.trim()) void submit('add', { text }) }}>
        <Input aria-label={t('task')} placeholder={t('task')} value={text} maxLength={2000} onChange={event => { setText(event.target.value) }} />
        <Button type="submit" disabled={pending || !text.trim() || resource.status !== 'live'}>{t('add')}</Button>
      </form>
      <p role={error ? 'alert' : 'status'}>{t(error ? 'saveFailed' : 'saved')}</p>
    </section>}
  </div>
}
