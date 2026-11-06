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
  IconCloseOutlineMedium,
  IconSearchOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ActveroWorkbench } from '../../contracts.ts'
import type { WorkbenchAction } from './register.ts'
import type { WorkbenchViewHooks } from './Navigation.tsx'
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
import { SourceTabs, catalogStyles } from '../sources.ts'
import hubStyles from '../hub.module.css'
import styles from './workbenches.module.css'
import checklistPreview from './assets/project-checklist.png'
import checklistProgressPreview from './assets/project-checklist-progress.png'
import checklistReviewPreview from './assets/project-checklist-review.png'
import checklistCompletedPreview from './assets/project-checklist-completed.png'
import checklistDarkPreview from './assets/project-checklist-dark.png'

const categories = ['all', 'office', 'engineering', 'design', 'content', 'data', 'education', 'lifestyle', 'general', 'uncategorized'] as const
type Category = typeof categories[number]
type Locale = PropsLocale<'actvero.workbenches'>
type ViewHooks = WorkbenchViewHooks

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

function PreviewArrows({ t, previous, next, atStart = false, atEnd = false }: Locale & {
  previous: () => void
  next: () => void
  atStart?: boolean
  atEnd?: boolean
}) {
  return <>
    <Tooltip label={t('previous')} side="top" portal>
      <Button className={`${styles.stripArrow} ${styles.stripPrevious}`} variant="outline" aria-label={t('previous')}
        disabled={atStart} onClick={previous}><IconChevronLeftOutlineMedium size={16} /></Button>
    </Tooltip>
    <Tooltip label={t('next')} side="top" portal>
      <Button className={`${styles.stripArrow} ${styles.stripNext}`} variant="outline" aria-label={t('next')}
        disabled={atEnd} onClick={next}><IconChevronRightOutlineMedium size={16} /></Button>
    </Tooltip>
  </>
}

function CardPreviews({ entry, showDetails, t }: Locale & { entry: ActveroWorkbench; showDetails: (index: number) => void }) {
  const previews = entry.previewUrls ?? []
  const track = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })
  useEffect(() => {
    const element = track.current
    if (!element) return
    const measure = () => {
      setEdges({ start: element.scrollLeft <= 1, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.addEventListener('scroll', measure)
    return () => { observer.disconnect(); element.removeEventListener('scroll', measure) }
  }, [previews.length])
  const scroll = (direction: number) => {
    const element = track.current
    if (element) element.scrollBy({ left: direction * element.clientWidth })
  }
  return <div className={`${styles.previewStrip} ${styles.cardPreviews}`} role="group" aria-label={`${t('previews')} · ${entry.name}`}>
    <div className={styles.previewRow} ref={track}>
      {previews.length ? previews.map((url, index) => (
        <button key={`${index}:${url}`} className={styles.previewButton}
          aria-label={`${t('viewPreview')} · ${entry.name} · ${index + 1}`} onClick={() => { showDetails(index) }}>
          <PreviewImage url={url} t={t} />
        </button>
      )) : <span className={`${styles.preview} ${styles.previewFallback}`}><WorkbenchIcon size={22} /><span>{t('noPreview')}</span></span>}
    </div>
    {(!edges.start || !edges.end) && <PreviewArrows t={t} atStart={edges.start} atEnd={edges.end}
      previous={() => { scroll(-1) }} next={() => { scroll(1) }} />}
  </div>
}

function Card({ entry, builtIn, open, showDetails, t }: Locale & {
  entry: ActveroWorkbench
  builtIn: boolean
  open: () => void
  showDetails: (previewIndex: number) => void
}) {
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
    <CardPreviews entry={entry} showDetails={showDetails} t={t} />
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
    <Modal open headless title={entry.name} onClose={onClose} className={styles.detail}>
      <div className={styles.detailContent}>
        <header className={styles.detailHeader}>
          <h2>{entry.name}</h2>
          <Button variant="ghost" onClick={onClose} aria-label={t('close')}><IconCloseOutlineMedium size={18} /></Button>
        </header>
        <div className={styles.detailLayout}>
          <section className={styles.gallery} aria-label={t('previews')}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              changePreview(event.key === 'ArrowLeft' ? -1 : 1)
            }}>
            {current ? <>
              <Tooltip label={t('enlarge')} side="top" portal>
                <button className={styles.largePreview} aria-label={t('enlarge')} onClick={() => { setEnlarged(true) }}>
                  <PreviewImage url={current} t={t} />
                </button>
              </Tooltip>
              {previews.length > 1 && <div className={`${styles.previewStrip} ${styles.detailPreviews}`} role="group" aria-label={t('previews')}>
                <div className={styles.thumbnails} ref={thumbnails}>
                  {previews.map((url, index) => <button key={`${index}:${url}`} className={styles.thumbnail}
                    aria-label={`${t('viewPreview')} ${index + 1}`} aria-pressed={index === selectedIndex}
                    onClick={() => { setSelected(index) }}><PreviewImage url={url} t={t} /></button>)}
                </div>
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
  const builtIn: ActveroWorkbench = {
    id: 'builtin:project-checklist', name: t('sampleName'), description: t('sampleDescription'), category: 'office', version: '1.0.0',
    previewUrls: [checklistPreview, checklistProgressPreview, checklistReviewPreview, checklistCompletedPreview, checklistDarkPreview],
  }
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
  const entry = entries.find(item => item.id === opened)
  const name = opened === 'builtin:project-checklist' ? t('sampleName') : entry?.name ?? t('title')
  const unavailable = <div className={styles.empty}>
    <p role="status">{t('unavailable')}</p>
    <Button variant="outline" onClick={() => { action.back() }}>{t('back')}</Button>
  </div>
  return <section className={styles.business} aria-label={name}>
    {opened ? renderSlot('actvero.workbench.body', {}, { entryKey: opened, fallback: unavailable }) : unavailable}
  </section>
}
