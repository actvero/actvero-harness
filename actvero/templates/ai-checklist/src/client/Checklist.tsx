/** Native resource updates are shared by manual controls and AI business tools. */
import { useState } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchBodyProps, WorkbenchObjectId } from '@actvero/dsh-capability-ui/client/contracts'
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
  const [referencePending, setReferencePending] = useState(false)
  const [referenceFailed, setReferenceFailed] = useState(false)
  const [dismissedLocation, setDismissedLocation] = useState<typeof workbench.location>(null)
  const location = workbench.location !== dismissedLocation ? workbench.location : null
  const objectId = location?.objectId === 'checklist' ? null : location?.objectId
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
  async function reference(): Promise<void> {
    if (!value || referencePending) return
    setReferencePending(true); setReferenceFailed(false)
    try {
      await workbench.reference({ objectId: 'checklist' as WorkbenchObjectId, label: t('section'),
        revision: String(value.revision), content: value.json })
    } catch (_error) { setReferenceFailed(true) }
    finally { setReferencePending(false) }
  }
  async function discuss(item: { id: string; text: string; completed: boolean }): Promise<void> {
    if (!value || referencePending) return
    setReferencePending(true); setReferenceFailed(false)
    try {
      await workbench.conversation({ objectId: item.id as WorkbenchObjectId })
    } catch (_error) { setReferenceFailed(true) }
    finally { setReferencePending(false) }
  }
  async function select(item: { id: string; text: string; completed: boolean }): Promise<void> {
    if (!value) return
    try {
      const status = await workbench.selection({ objectId: item.id as WorkbenchObjectId, label: item.text,
        revision: String(value.revision), content: JSON.stringify(item) })
      setReferenceFailed(status === 'busy' || status === 'inactive')
    } catch (_error) { setReferenceFailed(true) }
  }
  return <div className={styles.page}>
    <p className={styles.description}>{description}</p>
    {location && <Button onClick={() => { setDismissedLocation(location) }}>{t('allTasks')}</Button>}
    <div className={styles.actions}>
      <Button variant="ghost" disabled={modelsPending} onClick={() => { void models() }}>{t(modelsPending ? 'loading' : 'models')}</Button>
      <Button variant="ghost" disabled={referencePending || !value || resource.status !== 'live'}
        onClick={() => { void reference() }}>{t('reference')}</Button>
    </div>
    {modelsFailed && <p role="alert">{t('modelsFailed')}</p>}
    {referenceFailed && <p role="alert">{t('referenceFailed')}</p>}
    {catalog && <p role="status">{t('modelsLoaded')}: {catalog.models.map(model => model.name).join('、') || t('noModels')}</p>}
    {!state ? <p role="status">{t(resource.status === 'failed' ? 'readFailed' : 'loading')}</p> : <section className={styles.checklist}>
      <header><h2>{t('section')}</h2><span className={styles.meta}>{state.items.filter(item => item.completed).length} / {state.items.length}</span></header>
      {objectId && !state.items.some(item => item.id === objectId) && <p role="alert">{t('objectMissing')}</p>}
      {state.items.filter(item => !objectId || item.id === objectId).map(item => <div key={item.id} className={styles.item}>
        <Checkbox label={item.text} checked={item.completed} disabled={pending || resource.status !== 'live'}
          onChange={completed => { void submit('complete', { id: item.id, completed }) }} />
        <Button disabled={referencePending} onClick={() => { void discuss(item) }}>{t('discuss')}</Button>
        <Button disabled={referencePending} onClick={() => { void select(item) }}>{t('select')}</Button>
      </div>)}
      <form className={styles.actions} onSubmit={event => { event.preventDefault(); if (text.trim()) void submit('add', { text }) }}>
        <Input aria-label={t('task')} placeholder={t('task')} value={text} maxLength={2000} onChange={event => { setText(event.target.value) }} />
        <Button type="submit" disabled={pending || !text.trim() || resource.status !== 'live'}>{t('add')}</Button>
      </form>
      <p role={error ? 'alert' : 'status'}>{t(error ? 'saveFailed' : 'saved')}</p>
    </section>}
  </div>
}
