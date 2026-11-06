import { useEffect, useRef, useState } from 'react'
import {
  Button,
  IconChecklistOutlineMedium,
  IconChevronLeftOutlineMedium,
  IconDownloadOutlineMedium,
  IconSearchOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsHooks, PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ActveroWorkbench } from '../../contracts.ts'
import type { WorkbenchAction, WorkbenchView } from './register.ts'
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
import styles from './workbenches.module.css'

const categories = ['all', 'office', 'engineering', 'design', 'content', 'data', 'education', 'lifestyle', 'general', 'uncategorized'] as const
type Category = typeof categories[number]
type Locale = PropsLocale<'actvero.workbenches'>
type ViewHooks = PropsHooks<{ view: { getSnapshot: () => WorkbenchView; subscribe: (listener: () => void) => () => void } }>

function categoryOf(value: string | undefined): Category {
  return categories.find(category => category !== 'all' && category === value) ?? 'uncategorized'
}

function Card({ entry, builtIn, open, t }: Locale & { entry: ActveroWorkbench; builtIn: boolean; open: () => void }) {
  const category = categoryOf(entry.category)
  return <article className={styles.card}>
    <div className={styles.cardHead}>
      <span className={styles.mark} data-category={category}>
        {builtIn ? <IconChecklistOutlineMedium size={21} /> : <WorkbenchIcon size={21} />}
      </span>
      <h3>{entry.name}</h3>
      <Button variant="primary" onClick={open}>{t('open')}</Button>
    </div>
    <p>{entry.description}</p>
    <footer className={styles.cardFoot}>
      <span className={styles.categoryTag}>{t(category)}</span>
      <span>{builtIn ? t('builtIn') : t('local')}</span>
      <span>{t('versionPrefix')}{entry.version}</span>
    </footer>
  </article>
}

/** Search, filter, import and open workbenches registered in the current profile. */
export function Manager({ t, useView, action }: Locale & ViewHooks & { action: WorkbenchAction }) {
  const view = useView(value => value)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const fileInput = useRef<HTMLInputElement>(null)
  const needle = query.trim().toLocaleLowerCase()
  const builtIn = { id: 'builtin:project-checklist', name: t('sampleName'), description: t('sampleDescription'), category: 'office', version: '1.0.0' }
  const entries = [builtIn, ...view.entries].filter((entry) => {
    if (category !== 'all' && categoryOf(entry.category) !== category) return false
    return [entry.name, entry.description, t(categoryOf(entry.category))].some(value => value.toLocaleLowerCase().includes(needle))
  })

  return <section className={styles.page}>
    <header className={styles.pageHeader}>
      <h1>{t('title')}</h1>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <IconSearchOutlineMedium size={16} />
          <input aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => setQuery(event.currentTarget.value)} />
        </label>
        <Button variant="primary" disabled={view.importing} onClick={() => fileInput.current?.click()}>
          <IconDownloadOutlineMedium size={15} />{t(view.importing ? 'importing' : 'import')}
        </Button>
        <input ref={fileInput} type="file" accept=".tgz" hidden onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void action.importFile(file)
        }} />
      </div>
    </header>
    <div className={styles.sectionHeader}>
      <h2>{t('mine')}</h2>
      <p>{t('subtitle')}</p>
    </div>
    <div className={styles.categories} role="group" aria-label={t('categories')}>
      {categories.map(value => <Button key={value} variant="ghost" aria-pressed={value === category} onClick={() => setCategory(value)}>{t(value)}</Button>)}
    </div>
    {view.notice && <p className={styles.notice} role="status">{t(view.notice)}</p>}
    {entries.length > 0 ? <div className={styles.grid}>
      {entries.map(entry => (
        <Card key={entry.id} entry={entry} builtIn={entry.id === builtIn.id} t={t} open={() => action.open(entry.id)} />
      ))}
    </div> : <div className={styles.empty}>
      <WorkbenchIcon size={27} />
      <p>{t('empty')}</p>
      <Button variant="ghost" onClick={() => { setQuery(''); setCategory('all') }}>{t('clear')}</Button>
    </div>}
  </section>
}

/** Native main-area seat for the currently opened business panel. */
export function OpenWorkbench({ t, useView, renderSlot, action }: Locale & ViewHooks
  & PropsRenderSlots<'actvero.workbench.body'> & { action: WorkbenchAction }) {
  const { entries, opened } = useView(value => value)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [opened])
  const entry = entries.find(item => item.id === opened)
  const name = opened === 'builtin:project-checklist' ? t('sampleName') : entry?.name ?? t('title')
  return <section className={styles.openPage}>
    <header className={styles.openHeader}>
      <Button variant="ghost" onClick={action.back}><IconChevronLeftOutlineMedium size={15} />{t('back')}</Button>
      <h1 ref={heading} tabIndex={-1}>{name}</h1>
    </header>
    <div className={styles.business}>
      {opened && renderSlot('actvero.workbench.body', {}, { entryKey: opened, fallback: <p>{t('unavailable')}</p> })}
    </div>
  </section>
}
