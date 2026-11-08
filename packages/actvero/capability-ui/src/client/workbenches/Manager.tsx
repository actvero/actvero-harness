import { useEffect, useRef, useState } from 'react'
import {
  Button,
  ConfirmDialog,
  Input,
  Modal,
  ImageLightbox,
  ActionMenu,
  Tooltip,
  IconChevronLeftOutlineMedium,
  IconChevronRightOutlineMedium,
  IconCloseOutlineMedium,
  IconSearchOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ActveroWorkbench } from '../../contracts.ts'
import { workbenchCatalog, type ResolveText, type WorkbenchItem } from './catalog.ts'
import type { WorkbenchAction } from './register.ts'
import type { WorkbenchViewHooks } from './Navigation.tsx'
import { WorkbenchArtwork, WorkbenchIcon } from './WorkbenchIcon.tsx'
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

function Mark({ entry }: { entry: ActveroWorkbench }) {
  return <span className={styles.mark}><WorkbenchArtwork id={entry.id} url={entry.iconUrl} size={22} /></span>
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

type ManageAction = 'update' | 'enable' | 'disable' | 'remove' | 'directory'

function ManagementActions({ entry, t, open, manage, blocked, details, canOpenDirectory }: Locale & {
  entry: WorkbenchItem
  open: () => void
  manage: (action: ManageAction) => void
  blocked: boolean
  details?: () => void
  canOpenDirectory: boolean
}) {
  const bundle = entry.bundle
  const waiting = entry.state === 'restartState'
  const primary = bundle && !entry.runningVersion ? (bundle.enabled ? 'load' : 'enable') : 'open'
  const locked = blocked || waiting || !!bundle?.readOnlyReason
  return <div className={styles.cardActions}>
    {(bundle || details) && <ActionMenu className={styles.more} label={`${t('more')} · ${entry.name}`} items={[
      ...(details ? [{ id: 'details', label: t('details') }] : []),
      ...(bundle ? [
        ...(bundle.removable ? [{ id: 'update', label: t('update'), disabled: locked }] : []),
        ...(canOpenDirectory && entry.runningVersion ? [{ id: 'directory', label: t('openDirectory'), disabled: blocked }] : []),
        { id: bundle.enabled ? 'disable' : 'enable', label: t(bundle.enabled ? 'disable' : 'enable'), disabled: locked },
        ...(bundle.removable ? [{ type: 'separator' as const, id: 'remove-separator' },
          { id: 'remove', label: t('remove'), disabled: locked, danger: true }] : []),
      ] : []),
    ]} onSelect={(id) => {
      if (id === 'details') details?.()
      else if (id === 'update' || id === 'enable' || id === 'disable' || id === 'remove' || id === 'directory') manage(id)
    }} />}
    <Button className={styles.openButton} variant="primary" disabled={primary === 'open' ? blocked : locked}
      onClick={() => { if (primary === 'open') open(); else manage('enable') }}>{t(primary)}</Button>
  </div>
}

function Card({ entry, builtIn, open, showDetails, t, manage, blocked, canOpenDirectory }: Locale & {
  entry: WorkbenchItem
  manage: (action: ManageAction) => void
  blocked: boolean
  builtIn: boolean
  open: () => void
  showDetails: (previewIndex: number) => void
  canOpenDirectory: boolean
}) {
  const metadata = `${t('versionPrefix')}${entry.version} · ${t(builtIn ? 'builtIn' : 'local')}${entry.author ? ` · ${entry.author}` : ''}`
  return <article className={styles.card} data-workbench-state={entry.state}>
    <button className={styles.cardTrigger} aria-label={`${t('details')} · ${entry.name}`} onClick={() => { showDetails(0) }} />
    <header className={styles.cardHeader}>
      <div className={styles.identity}>
        <Mark entry={entry} />
        <h3 className={styles.name} title={entry.name}>{entry.name}</h3>
      </div>
      <ManagementActions entry={entry} t={t} open={open} manage={manage} blocked={blocked}
        canOpenDirectory={canOpenDirectory} details={() => { showDetails(0) }} />
    </header>
    <p className={styles.description}>{entry.description}</p>
    <CardPreviews entry={entry} showDetails={showDetails} t={t} />
    <footer className={styles.cardFoot}>
      <span className={styles.metadata} title={metadata}>{metadata}</span>
      {entry.state !== 'ready' && <span className={styles.status} data-state={entry.state}>{t(entry.state)}</span>}
    </footer>
  </article>
}

function Details({ entry, builtIn, initialPreview, onClose, open, t, manage, blocked, canOpenDirectory }: Locale & {
  entry: WorkbenchItem
  manage: (action: ManageAction) => void
  blocked: boolean
  builtIn: boolean
  initialPreview: number
  onClose: () => void
  open: () => void
  canOpenDirectory: boolean
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
          <div className={styles.detailName}><Mark entry={entry} /><h2>{entry.name}</h2></div>
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
            <div className={styles.detailMetadata}>
              <span aria-label={`${t('version')} ${entry.version}`}>{t('versionPrefix')}{entry.version}</span>
              <span>{t(builtIn ? 'builtIn' : 'local')}</span>
              {entry.author && <span>{entry.author}</span>}
            </div>
            <div className={styles.descriptionScroll} role="region" aria-label={t('description')} tabIndex={0}>
              <p className={styles.detailDescription}>{entry.description}</p>
              {!!entry.tags?.length && <div className={styles.tags}>{entry.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
            </div>
            {entry.state !== 'ready' && <div className={styles.detailState} role="status">
              <span>{t(entry.state)}</span>
              {entry.runningVersion && entry.runningVersion !== entry.version
                && <span>{t('runningVersion')} {entry.runningVersion}</span>}
            </div>}
            <div className={styles.detailActions}>
              <ManagementActions entry={entry} t={t} open={open} manage={manage} blocked={blocked} canOpenDirectory={canOpenDirectory} />
            </div>
          </section>
        </div>
      </div>
    </Modal>
    {enlarged && current && <ImageLightbox src={current} alt={`${entry.name} · ${t('viewPreview')} ${selectedIndex + 1}`}
      labels={{ dialog: t('originalPreview'), close: t('closePreview') }} onClose={() => { setEnlarged(false) }} />}
  </>
}

/** Search, import and open workbenches registered in the current profile. */
export function Manager({ t, useView, action, resolveText }: Locale & ViewHooks & { action: WorkbenchAction; resolveText: ResolveText }) {
  const view = useView(value => value)
  const [query, setQuery] = useState('')
  const [developerOpen, setDeveloperOpen] = useState(false)
  const [copyState, setCopyState] = useState<'copy' | 'copied' | 'copyFailed'>('copy')
  const [category, setCategory] = useState<Category>('all')
  const [source, setSource] = useState<'platform' | 'local'>('local')
  const [detailSelection, setDetailSelection] = useState<{ id: string; previewIndex: number }>()
  const fileInput = useRef<HTMLInputElement>(null)
  const updateTarget = useRef<string>()
  const [removeTarget, setRemoveTarget] = useState<WorkbenchItem>()
  const [disableTarget, setDisableTarget] = useState<WorkbenchItem>()
  const blocked = !!view.busy || view.inventoryFailed
  const needle = query.trim().toLocaleLowerCase()
  const builtIn: WorkbenchItem = {
    state: 'ready',
    id: 'builtin:project-checklist', name: t('sampleName'), description: t('sampleDescription'), category: 'office', version: '1.0.0',
    previewUrls: [checklistPreview, checklistProgressPreview, checklistReviewPreview, checklistCompletedPreview, checklistDarkPreview],
  }
  const catalog = [builtIn, ...workbenchCatalog(view, resolveText)]
  const detail = catalog.find(entry => entry.id === detailSelection?.id)
  const entries = catalog.filter(entry => [entry.name, entry.description, entry.author ?? '', ...(entry.tags ?? []), t(categoryOf(entry.category))]
    .some(value => value.toLocaleLowerCase().includes(needle)))

  const manage = (entry: WorkbenchItem, operation: ManageAction) => {
    if (operation === 'update') { updateTarget.current = entry.id; fileInput.current?.click() }
    else if (operation === 'remove') setRemoveTarget(entry)
    else if (operation === 'disable') setDisableTarget(entry)
    else if (operation === 'directory') void action.openDataDirectory(entry.id)
    else void action.setEnabled(entry.id, operation === 'enable')
  }
  async function copyInstructions(): Promise<void> {
    try { await navigator.clipboard.writeText(t('developPrompt')); setCopyState('copied') }
    catch (_error) { setCopyState('copyFailed') }
  }
  return <section className={`${hubStyles.page} ${styles.page}`}>
    <header className={styles.pageTitle}>
      <h1>{t('title')}</h1>
    </header>
    <div className={`${catalogStyles.toolbar} ${styles.toolbar}`}>
      <Input className={catalogStyles.search} icon={<IconSearchOutlineMedium />}
        aria-label={t('search')} placeholder={t('search')} value={query} onChange={(event) => { setQuery(event.currentTarget.value) }} />
      <Button variant="outline" disabled={blocked} onClick={() => { updateTarget.current = undefined; fileInput.current?.click() }}>
        {t(view.busy ? 'busy' : 'import')}
      </Button>
      <Button variant="primary" onClick={() => { setCopyState('copy'); setDeveloperOpen(true) }}>{t('develop')}</Button>
      <input ref={fileInput} type="file" accept=".tgz" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void action.importFile(file, updateTarget.current)
      }} />
    </div>
    <div className={styles.content}>
      <SourceTabs value={source} platformLabel={t('platform')} localLabel={t('mine')}
        count={source === 'local' ? entries.length : undefined} onChange={setSource} />
      {source === 'platform' && <nav className={catalogStyles.categories} aria-label={t('categories')}>
        {categories.map(value => <Button key={value} variant="ghost" aria-pressed={value === category} onClick={() => { setCategory(value) }}>{t(value)}</Button>)}
      </nav>}
      {view.inventoryFailed && <div className={styles.notice} role="alert"><span>{t('inventoryFailed')}</span>
        <Button variant="ghost" disabled={view.refreshing} onClick={() => { void action.refresh() }}>{t('refresh')}</Button></div>}
      {view.notice && <div className={styles.notice} role="status"><span>{t(view.notice)}</span>
        {view.diagnostic && <details><summary>{t('diagnostic')}</summary><pre>{view.diagnostic}</pre></details>}</div>}
      {source === 'platform' ? <div className={styles.platformEmpty}>
        <span className={styles.platformMark}><WorkbenchIcon size={30} /></span>
        <h2>{t('platformComing')}</h2>
        <p>{t('platformDescription')}</p>
        <Button variant="outline" onClick={() => { setSource('local') }}>{t('viewMine')}</Button>
      </div> : entries.length > 0 ? <div className={catalogStyles.grid}>
        {entries.map(entry => (
          <Card key={entry.id} entry={entry} builtIn={entry.id === builtIn.id} t={t} blocked={blocked}
            canOpenDirectory={view.canOpenDirectory}
            manage={(operation) => { manage(entry, operation) }}
            showDetails={(previewIndex) => { setDetailSelection({ id: entry.id, previewIndex }) }} open={() => { action.open(entry.id) }} />
        ))}
      </div> : <div className={styles.empty}>
        <WorkbenchIcon size={27} />
        <p>{t('empty')}</p>
        <Button variant="ghost" onClick={() => { setQuery('') }}>{t('clear')}</Button>
      </div>}
    </div>
    {detail && detailSelection && <Details key={detail.id} entry={detail} builtIn={detail.id === builtIn.id}
      initialPreview={detailSelection.previewIndex} t={t} blocked={blocked} canOpenDirectory={view.canOpenDirectory}
      manage={(operation) => { manage(detail, operation) }}
      onClose={() => { setDetailSelection(undefined) }}
      open={() => { setDetailSelection(undefined); action.open(detail.id) }} />}
    <Modal open={developerOpen} onClose={() => { setDeveloperOpen(false) }} title={t('develop')} closeLabel={t('close')}>
      <p>{t('developHelp')}</p>
      <p>{t('developPrerequisites')}</p>
      <pre className={styles.developerPrompt}>{t('developPrompt')}</pre>
      <Button variant="primary" onClick={() => { void copyInstructions() }}>{t('copy')}</Button>
      <p role="status">{copyState !== 'copy' && t(copyState)}</p>
    </Modal>
    <ConfirmDialog open={!!view.pendingUpdate} title={t('updateTitle')} closeLabel={t('close')}
      resourceName={`${catalog.find(entry => entry.id === view.pendingUpdate?.name)?.name ?? view.pendingUpdate?.name ?? ''} · ${view.pendingUpdate?.from ?? ''} → ${view.pendingUpdate?.to ?? ''}`}
      description={t('updateHelp')} cancelLabel={t('cancel')} confirmLabel={t('confirmUpdate')} pending={!!view.busy}
      onCancel={action.cancelUpdate} onConfirm={() => { void action.confirmUpdate() }} />
    <ConfirmDialog open={!!disableTarget} title={t('disableTitle')} closeLabel={t('close')}
      resourceName={disableTarget?.name ?? ''} description={t('disableHelp')} cancelLabel={t('cancel')}
      confirmLabel={t('disable')} pending={!!view.busy} onCancel={() => { setDisableTarget(undefined) }}
      onConfirm={() => {
        if (!disableTarget) return
        const name = disableTarget.id
        setDisableTarget(undefined)
        void action.setEnabled(name, false)
      }} />
    <ConfirmDialog open={!!removeTarget} title={t('removeTitle')} closeLabel={t('close')}
      resourceName={removeTarget?.name ?? ''} description={t('removeHelp')} cancelLabel={t('cancel')}
      confirmLabel={t('remove')} pending={!!view.busy} onCancel={() => { setRemoveTarget(undefined) }}
      onConfirm={() => {
        if (!removeTarget) return
        const name = removeTarget.id
        setRemoveTarget(undefined)
        setDetailSelection(undefined)
        void action.remove(name)
      }} />
  </section>
}
