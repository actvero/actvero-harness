import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Input,
  Modal,
  ImageLightbox,
  ActionMenu,
  Tooltip,
  IconChecklistOutlineMedium,
  IconChevronLeftOutlineMedium,
  IconChevronRightOutlineMedium,
  IconSearchOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsHooks, PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ActveroWorkbench } from '../../contracts.ts'
import type { WorkbenchAction, WorkbenchView } from './register.ts'
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
import { SourceTabs, catalogStyles } from '../sources.ts'
import hubStyles from '../hub.module.css'
import styles from './workbenches.module.css'
import checklistPreview from './assets/project-checklist.png'

const categories = ['all', 'office', 'engineering', 'design', 'content', 'data', 'education', 'lifestyle', 'general', 'uncategorized'] as const
type Category = typeof categories[number]
type Locale = PropsLocale<'actvero.workbenches'>
type ViewHooks = PropsHooks<{ view: { getSnapshot: () => WorkbenchView; subscribe: (listener: () => void) => () => void } }>

function categoryOf(value: string | undefined): Category {
  return categories.find(category => category !== 'all' && category === value) ?? 'uncategorized'
}

function Mark({ entry, builtIn }: { entry: ActveroWorkbench; builtIn: boolean }) {
  const [failed, setFailed] = useState<string>()
  return <span className={styles.mark}>
    {entry.iconUrl && failed !== entry.iconUrl
      ? <img src={entry.iconUrl} alt="" onError={() => { setFailed(entry.iconUrl) }} />
      : builtIn ? <IconChecklistOutlineMedium size={22} /> : <WorkbenchIcon size={22} />}
  </span>
}

function PreviewImage({ url, t }: Locale & { url: string }) {
  const [failed, setFailed] = useState<string>()
  return <span className={styles.preview}>
    {failed !== url ? <img src={url} alt="" loading="lazy" onError={() => { setFailed(url) }} />
      : <span className={styles.previewFallback}><WorkbenchIcon size={22} /><span>{t('noPreview')}</span></span>}
  </span>
}

function Card({ entry, builtIn, open, showDetails, t }: Locale & {
  entry: ActveroWorkbench
  builtIn: boolean
  open: () => void
  showDetails: (previewIndex: number) => void
}) {
  const previews = entry.previewUrls ?? []
  return <article className={styles.card}>
    <button className={styles.cardTrigger} aria-label={`${t('details')} · ${entry.name}`} onClick={() => { showDetails(0) }} />
    <header className={styles.cardHeader}>
      <div className={styles.identity}>
        <Mark entry={entry} builtIn={builtIn} />
        <h3 className={styles.name} title={entry.name}>{entry.name}</h3>
      </div>
      <div className={styles.cardActions}>
        <ActionMenu className={styles.more} label={`${t('more')} · ${entry.name}`}
          items={[{ id: 'details', label: t('details') }]} onSelect={() => { showDetails(0) }} />
        <Button className={styles.openButton} variant="primary" onClick={open}>{t('open')}</Button>
      </div>
    </header>
    <p className={styles.description}>{entry.description}</p>
    <div className={styles.previewRow}>
      {previews.length ? previews.slice(0, 3).map((url, index) => (
        <button key={`${index}:${url}`} className={styles.previewButton}
          aria-label={`${t('viewPreview')} · ${entry.name} · ${index + 1}`} onClick={() => { showDetails(index) }}>
          <PreviewImage url={url} t={t} />
          {index === 2 && previews.length > 3 && <span className={styles.extraPreviews}>+{previews.length - 3}</span>}
        </button>
      )) : <span className={`${styles.preview} ${styles.previewFallback}`}><WorkbenchIcon size={22} /><span>{t('noPreview')}</span></span>}
    </div>
    <footer className={styles.cardFoot}>
      <span className={styles.metadata}>{t(builtIn ? 'builtIn' : 'local')} · {t('versionPrefix')}{entry.version}</span>
    </footer>
  </article>
}

function Details({ entry, builtIn, initialPreview, onClose, open, t }: Locale & {
  entry: ActveroWorkbench
  builtIn: boolean
  initialPreview: number
  onClose: () => void
  open: () => void
}) {
  const previews = entry.previewUrls ?? []
  const [selected, setSelected] = useState(initialPreview)
  const [enlarged, setEnlarged] = useState(false)
  const thumbnails = useRef<HTMLDivElement>(null)
  const selectedIndex = Math.min(selected, Math.max(0, previews.length - 1))
  const current = previews[selectedIndex]
  useEffect(() => {
    thumbnails.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedIndex])
  const changePreview = (direction: number) => {
    if (previews.length > 1) setSelected((selectedIndex + direction + previews.length) % previews.length)
  }
  return <>
    <Modal open title={entry.name} closeLabel={t('close')} onClose={onClose} className={styles.detail}
      contentClassName={styles.detailContent}>
      <div className={styles.detailLayout}>
        <section className={styles.gallery} aria-label={t('previews')}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            changePreview(event.key === 'ArrowLeft' ? -1 : 1)
          }}>
          {current ? <>
            <button className={styles.largePreview} aria-label={t('enlarge')} onClick={() => { setEnlarged(true) }}>
              <PreviewImage url={current} t={t} />
            </button>
            <div className={styles.galleryToolbar}>
              {previews.length > 1 && <span className={styles.metadata} aria-live="polite">{selectedIndex + 1} / {previews.length}</span>}
              <div>
                <Button variant="ghost" onClick={() => { setEnlarged(true) }}>{t('enlarge')}</Button>
                {previews.length > 1 && <>
                  <Tooltip label={t('previous')} side="top" portal><Button variant="ghost" aria-label={t('previous')} onClick={() => { changePreview(-1) }}><IconChevronLeftOutlineMedium size={16} /></Button></Tooltip>
                  <Tooltip label={t('next')} side="top" portal><Button variant="ghost" aria-label={t('next')} onClick={() => { changePreview(1) }}><IconChevronRightOutlineMedium size={16} /></Button></Tooltip>
                </>}
              </div>
            </div>
            {previews.length > 1 && <div className={styles.thumbnails} ref={thumbnails}>
              {previews.map((url, index) => <button key={`${index}:${url}`} className={styles.thumbnail}
                aria-label={`${t('viewPreview')} ${index + 1}`} aria-pressed={index === selectedIndex}
                onClick={() => { setSelected(index) }}><PreviewImage url={url} t={t} /></button>)}
            </div>}
          </> : <div className={`${styles.largePreview} ${styles.previewFallback}`}><WorkbenchIcon size={32} /><span>{t('noPreview')}</span></div>}
        </section>
        <section className={styles.detailSummary} aria-label={t('about')}>
          <div className={styles.detailIdentity}><Mark entry={entry} builtIn={builtIn} /><h3>{t('about')}</h3></div>
          <p className={styles.detailDescription}>{entry.description}</p>
          {!!entry.tags?.length && <div className={styles.tags}>{entry.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
          <dl className={styles.facts}>
            <div><dt>{t('source')}</dt><dd>{t(builtIn ? 'builtIn' : 'local')}</dd></div>
            <div><dt>{t('version')}</dt><dd>{entry.version}</dd></div>
            {entry.author && <div><dt>{t('author')}</dt><dd>{entry.author}</dd></div>}
          </dl>
          <div className={styles.detailActions}><Button variant="primary" onClick={open}>{t('open')}</Button></div>
        </section>
      </div>
    </Modal>
    {enlarged && current && <ImageLightbox src={current} alt={`${entry.name} · ${t('viewPreview')} ${selectedIndex + 1}`}
      labels={{ dialog: t('originalPreview'), close: t('closePreview') }} onClose={() => { setEnlarged(false) }} />}
  </>
}

/** Search, import and open workbenches registered in the current profile. */
export function Manager({ t, useView, action }: Locale & ViewHooks & { action: WorkbenchAction }) {
  const view = useView(value => value)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [source, setSource] = useState<'platform' | 'local'>('local')
  const [detailSelection, setDetailSelection] = useState<{ id: string; previewIndex: number }>()
  const fileInput = useRef<HTMLInputElement>(null)
  const needle = query.trim().toLocaleLowerCase()
  const builtIn: ActveroWorkbench = { id: 'builtin:project-checklist', name: t('sampleName'), description: t('sampleDescription'), category: 'office', version: '1.0.0', previewUrls: [checklistPreview] }
  const catalog = [builtIn, ...view.entries]
  const detail = catalog.find(entry => entry.id === detailSelection?.id)
  const entries = catalog.filter(entry => [entry.name, entry.description, entry.author ?? '', ...(entry.tags ?? []), t(categoryOf(entry.category))]
    .some(value => value.toLocaleLowerCase().includes(needle)))

  return <section className={`${hubStyles.page} ${styles.page}`}>
    <header className={styles.pageTitle}>
      <h1>{t('title')}</h1>
    </header>
    <div className={`${catalogStyles.toolbar} ${styles.toolbar}`}>
      <Input className={catalogStyles.search} icon={<IconSearchOutlineMedium />}
        aria-label={t('search')} placeholder={t('search')} value={query} onChange={(event) => { setQuery(event.currentTarget.value) }} />
      <Button variant="outline" disabled={view.importing} onClick={() => fileInput.current?.click()}>
        {t(view.importing ? 'importing' : 'import')}
      </Button>
      <input ref={fileInput} type="file" accept=".tgz" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void action.importFile(file)
      }} />
    </div>
    <div className={styles.content}>
      <SourceTabs value={source} platformLabel={t('platform')} localLabel={t('mine')}
        count={source === 'local' ? entries.length : undefined} onChange={setSource} />
      {source === 'platform' && <nav className={catalogStyles.categories} aria-label={t('categories')}>
        {categories.map(value => <Button key={value} variant="ghost" aria-pressed={value === category} onClick={() => { setCategory(value) }}>{t(value)}</Button>)}
      </nav>}
      {view.notice && <p className={styles.notice} role="status">{t(view.notice)}</p>}
      {source === 'platform' ? <div className={styles.platformEmpty}>
        <span className={styles.platformMark}><WorkbenchIcon size={30} /></span>
        <h2>{t('platformComing')}</h2>
        <p>{t('platformDescription')}</p>
        <Button variant="outline" onClick={() => { setSource('local') }}>{t('viewMine')}</Button>
      </div> : entries.length > 0 ? <div className={catalogStyles.grid}>
        {entries.map(entry => (
          <Card key={entry.id} entry={entry} builtIn={entry.id === builtIn.id} t={t}
            showDetails={(previewIndex) => { setDetailSelection({ id: entry.id, previewIndex }) }} open={() => { action.open(entry.id) }} />
        ))}
      </div> : <div className={styles.empty}>
        <WorkbenchIcon size={27} />
        <p>{t('empty')}</p>
        <Button variant="ghost" onClick={() => { setQuery('') }}>{t('clear')}</Button>
      </div>}
    </div>
    {detail && detailSelection && <Details key={detail.id} entry={detail} builtIn={detail.id === builtIn.id}
      initialPreview={detailSelection.previewIndex} t={t} onClose={() => { setDetailSelection(undefined) }}
      open={() => { setDetailSelection(undefined); action.open(detail.id) }} />}
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
      <Button variant="ghost" onClick={() => { action.back() }}><IconChevronLeftOutlineMedium size={15} />{t('back')}</Button>
      <h1 ref={heading} tabIndex={-1}>{name}</h1>
    </header>
    <div className={styles.business}>
      {opened && renderSlot('actvero.workbench.body', {}, { entryKey: opened, fallback: <p>{t('unavailable')}</p> })}
    </div>
  </section>
}
