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
import { workbenchArchiveSource, type PublishedWorkbench } from '@actvero/dsh-client-account/protocol'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { workbenchCatalog, type ResolveText, type WorkbenchItem } from './catalog.ts'
import type { WorkbenchAction } from './register.ts'
import type { WorkbenchViewHooks } from './Navigation.tsx'
import { publishedWorkbenchAction, publishedWorkbenchDetails, type PublishedWorkbenchAction, type WorkbenchDetails } from './platform.ts'
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
import { SourceTabs, catalogStyles } from '../sources.ts'
import hubStyles from '../hub.module.css'
import styles from './workbenches.module.css'

const categories = ['all', 'office', 'engineering', 'design', 'content', 'data', 'education', 'lifestyle', 'general', 'uncategorized'] as const
type Category = typeof categories[number]
type Locale = PropsLocale<'actvero.workbenches'>
type ViewHooks = WorkbenchViewHooks

function categoryOf(value: string | undefined): Category {
  return categories.find(category => category !== 'all' && category === value) ?? 'uncategorized'
}

function Mark({ url }: { url?: string }) {
  const [failed, setFailed] = useState<string>()
  return <span className={styles.mark}>
    {url && failed !== url
      ? <img src={url} alt="" onError={() => { setFailed(url) }} />
      : <WorkbenchIcon size={22} />}
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

function CardPreviews({ name, previews = [], showPreview, t }: Locale & {
  name: string
  previews?: readonly string[]
  showPreview: (index: number) => void
}) {
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
  return <div className={`${styles.previewStrip} ${styles.cardPreviews}`} role="group" aria-label={`${t('previews')} · ${name}`} data-empty={!previews.length || undefined}>
    <div className={styles.previewRow} ref={track}>
      {previews.length ? previews.map((url, index) => (
        <button key={`${index}:${url}`} className={styles.previewButton}
          aria-label={`${t('viewPreview')} · ${name} · ${index + 1}`} onClick={() => { showPreview(index) }}>
          <PreviewImage url={url} t={t} />
        </button>
      )) : <span className={`${styles.preview} ${styles.previewFallback}`}><WorkbenchIcon size={22} /><span>{t('noPreview')}</span></span>}
    </div>
    {(!edges.start || !edges.end) && <PreviewArrows t={t} atStart={edges.start} atEnd={edges.end}
      previous={() => { scroll(-1) }} next={() => { scroll(1) }} />}
  </div>
}

type ManageAction = 'update' | 'enable' | 'disable' | 'remove'

function ManagementActions({ entry, t, open, manage, blocked, details }: Locale & {
  entry: WorkbenchItem
  open: () => void
  manage: (action: ManageAction) => void
  blocked: boolean
  details?: () => void
}) {
  const bundle = entry.bundle
  const waiting = entry.state === 'restartState'
  const primary = bundle && !entry.runningVersion ? (bundle.enabled ? 'load' : 'enable') : 'open'
  const locked = blocked || waiting || !!bundle?.readOnlyReason
  const managed = !!workbenchArchiveSource(bundle?.source)
  return <div className={styles.cardActions}>
    {(bundle || details) && <ActionMenu className={styles.more} label={`${t('more')} · ${entry.name}`} items={[
      ...(details ? [{ id: 'details', label: t('details') }] : []),
      ...(bundle ? [
        ...(managed ? [] : [{ id: 'update', label: t('update'), disabled: locked || !bundle.removable }]),
        { id: bundle.enabled ? 'disable' : 'enable', label: t(bundle.enabled ? 'disable' : 'enable'), disabled: locked },
        { id: 'remove', label: t('remove'), disabled: locked || !bundle.removable, danger: true },
      ] : []),
    ]} onSelect={(id) => {
      if (id === 'details') details?.()
      else if (id === 'update' || id === 'enable' || id === 'disable' || id === 'remove') manage(id)
    }} />}
    <Button className={styles.openButton} variant="primary" disabled={primary === 'open' ? blocked : locked}
      onClick={() => { if (primary === 'open') open(); else manage('enable') }}>{t(primary)}</Button>
  </div>
}

function Card({ entry, open, showDetails, t, manage, blocked }: Locale & {
  entry: WorkbenchItem
  manage: (action: ManageAction) => void
  blocked: boolean
  open: () => void
  showDetails: (previewIndex: number) => void
}) {
  return <article className={styles.card}>
    <button className={styles.cardTrigger} aria-label={`${t('details')} · ${entry.name}`} onClick={() => { showDetails(0) }} />
    <header className={styles.cardHeader}>
      <div className={styles.identity}>
        <Mark url={entry.iconUrl} />
        <h3 className={styles.name} title={entry.name}>{entry.name}</h3>
      </div>
      <ManagementActions entry={entry} t={t} open={open} manage={manage} blocked={blocked} details={() => { showDetails(0) }} />
    </header>
    <p className={styles.description}>{entry.description}</p>
    <CardPreviews name={entry.name} previews={entry.previewUrls} showPreview={showDetails} t={t} />
    <footer className={styles.cardFoot}>
      <span className={styles.metadata}>{t(workbenchArchiveSource(entry.bundle?.source) ? 'platform' : 'local')} · {t('versionPrefix')}{entry.version}</span>
      <span className={styles.status} data-state={entry.state}>{t(entry.state)}</span>
    </footer>
  </article>
}

type DetailActions =
  | { kind: 'local'; entry: WorkbenchItem; open: () => void; manage: (action: ManageAction) => void; blocked: boolean }
  | ({ kind: 'platform' } & PlatformActionProps)

function Details({ entry, source, actions, initialPreview, onClose, t }: Locale & {
  entry: WorkbenchDetails
  source: 'platform' | 'local'
  actions: DetailActions
  initialPreview: number
  onClose: () => void
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
            <div className={styles.detailIdentity}><Mark url={entry.iconUrl} /><h3>{t('about')}</h3></div>
            <p className={styles.detailDescription}>{entry.description}</p>
            {!!entry.tags?.length && <div className={styles.tags}>{entry.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
            <dl className={styles.facts}>
              <div><dt>{t('source')}</dt><dd>{t(source)}</dd></div>
              <div><dt>{t('version')}</dt><dd>{entry.version}</dd></div>
              {entry.state && <div><dt>{t('status')}</dt><dd>{t(entry.state)}</dd></div>}
              {actions.kind === 'platform' && actions.item.operation === 'updateAndOpen' && actions.item.installedVersion &&
                <div><dt>{t('installedVersion')}</dt><dd>{actions.item.installedVersion}</dd></div>}
              {entry.runningVersion && entry.runningVersion !== entry.version && <div><dt>{t('runningVersion')}</dt><dd>{entry.runningVersion}</dd></div>}
              {entry.author && <div><dt>{t('author')}</dt><dd>{entry.author}</dd></div>}
            </dl>
            <div className={styles.detailActions}>
              {actions.kind === 'platform'
                ? <PlatformActions t={t} item={actions.item} activate={actions.activate} openInstalled={actions.openInstalled} />
                : <ManagementActions t={t} entry={actions.entry} open={actions.open} manage={actions.manage} blocked={actions.blocked} />}
            </div>
          </section>
        </div>
      </div>
    </Modal>
    {enlarged && current && <ImageLightbox src={current} alt={`${entry.name} · ${t('viewPreview')} ${selectedIndex + 1}`}
      labels={{ dialog: t('originalPreview'), close: t('closePreview') }} onClose={() => { setEnlarged(false) }} />}
  </>
}

type PlatformItem = {
  release: PublishedWorkbench
  details: WorkbenchDetails
  operation: PublishedWorkbenchAction
  installedVersion?: string
  busy: boolean
  blocked: boolean
}

type PlatformActionProps = {
  item: PlatformItem
  activate: () => void
  openInstalled: () => void
}

function PlatformActions({ item, activate, openInstalled, t }: Locale & PlatformActionProps) {
  const { release, operation, busy, blocked } = item
  return <div className={styles.cardActions}>
    {operation === 'updateAndOpen' && <ActionMenu className={styles.more} label={`${t('more')} · ${release.name}`}
      items={[{ id: 'open-installed', label: t('openInstalled'), disabled: blocked }]} onSelect={openInstalled} />}
    <Button className={styles.openButton} variant="primary" disabled={blocked || operation === 'restartState' || operation === 'platformConflict'}
      onClick={activate}>{t(busy ? 'busy' : operation === 'platformConflict' ? 'versionConflict' : operation)}</Button>
  </div>
}

function PlatformCard({ item, activate, openInstalled, showDetails, t }: Locale & PlatformActionProps & {
  showDetails: (previewIndex: number) => void
}) {
  const { details, operation, installedVersion } = item
  return <article className={styles.card}>
    <button className={styles.cardTrigger} aria-label={`${t('details')} · ${details.name}`} onClick={() => { showDetails(0) }} />
    <header className={styles.cardHeader}>
      <div className={styles.identity}>
        <Mark url={details.iconUrl} />
        <h3 className={styles.name} title={details.name}>{details.name}</h3>
      </div>
      <PlatformActions item={item} t={t} activate={activate} openInstalled={openInstalled} />
    </header>
    <p className={styles.description}>{details.description}</p>
    <CardPreviews name={details.name} previews={details.previewUrls} showPreview={showDetails} t={t} />
    <footer className={styles.cardFoot}>
      <span className={styles.metadata}>{t('versionPrefix')}{details.version}</span>
      {operation === 'updateAndOpen' && <span className={styles.status}>{t('installedVersion')} {installedVersion}</span>}
    </footer>
  </article>
}

/** Search, import and open workbenches registered in the current profile. */
export function Manager({ t, useView, action, resolveText }: Locale & ViewHooks & { action: WorkbenchAction; resolveText: ResolveText }) {
  const view = useView(value => value)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [source, setSource] = useState<'platform' | 'local'>('local')
  const [detailSelection, setDetailSelection] = useState<{ source: 'platform' | 'local'; id: string; previewIndex: number }>()
  const fileInput = useRef<HTMLInputElement>(null)
  const updateTarget = useRef<string>()
  const [removeTarget, setRemoveTarget] = useState<WorkbenchItem>()
  useEffect(() => {
    if (source === 'platform') void action.refreshPlatform()
  }, [source, action])
  const blocked = !!view.busy || view.inventoryFailed
  const needle = query.trim().toLocaleLowerCase()
  const catalog = workbenchCatalog(view, resolveText)
  const platform = view.platform.catalog
  const published = platform?.items.filter(entry => (category === 'all' || categoryOf(entry.category) === category)
    && [entry.name, entry.description, entry.packageName, t(categoryOf(entry.category))]
      .some(value => value.toLocaleLowerCase().includes(needle))) ?? []
  const platformItems: PlatformItem[] = platform ? published.map((release) => {
    const bundle = view.bundles.find(item => item.name === release.packageName && item.installed)
    const installed = catalog.find(entry => entry.id === release.packageName)
    const operation = installed?.state === 'restartState' ? 'restartState' : publishedWorkbenchAction(release, platform.scope, bundle)
    return { release, details: publishedWorkbenchDetails(release, platform.scope, installed), operation,
      installedVersion: bundle?.version, busy: view.busy === release.packageName,
      blocked: blocked || view.refreshing || view.platform.phase !== 'ready' }
  }) : []
  const platformDetail = detailSelection?.source === 'platform'
    ? platformItems.find(item => item.release.workbenchId === detailSelection.id) : undefined
  const detail = detailSelection?.source === 'local' ? catalog.find(entry => entry.id === detailSelection.id) : undefined
  const entries = catalog.filter(entry => [entry.name, entry.description, entry.author ?? '', ...(entry.tags ?? []), t(categoryOf(entry.category))]
    .some(value => value.toLocaleLowerCase().includes(needle)))

  const manage = (entry: WorkbenchItem, operation: ManageAction) => {
    if (operation === 'update') { updateTarget.current = entry.id; fileInput.current?.click() }
    else if (operation === 'remove') setRemoveTarget(entry)
    else void action.setEnabled(entry.id, operation === 'enable')
  }
  return <section className={`${hubStyles.page} ${styles.page}`}>
    <header className={styles.pageTitle}>
      <h1>{t('title')}</h1>
    </header>
    <div className={`${catalogStyles.toolbar} ${styles.toolbar}`}>
      <Input className={catalogStyles.search} icon={<IconSearchOutlineMedium />}
        aria-label={t('search')} placeholder={t('search')} value={query} onChange={(event) => { setQuery(event.currentTarget.value) }} />
      {source === 'local' ? <Button variant="outline" disabled={blocked} onClick={() => { updateTarget.current = undefined; fileInput.current?.click() }}>
        {t(view.busy ? 'busy' : 'import')}
      </Button> : view.platform.phase !== 'login' && <Button variant="outline" disabled={view.platform.phase === 'loading' || blocked}
        onClick={() => { void action.refreshPlatform() }}>{t('refresh')}</Button>}
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
      {source === 'platform' ? (platformItems.length > 0 ? <div className={catalogStyles.grid}>
        {platformItems.map(item => <PlatformCard key={item.release.workbenchId} item={item} t={t}
          activate={() => { void action.usePublished(item.release) }}
          openInstalled={() => { action.open(item.release.packageName) }}
          showDetails={(previewIndex) => { setDetailSelection({ source: 'platform', id: item.release.workbenchId, previewIndex }) }} />)}
      </div> : <div className={styles.platformEmpty}>
        <span className={styles.platformMark}><WorkbenchIcon size={30} /></span>
        <p role={view.platform.phase === 'failed' ? 'alert' : 'status'}>{t(
          view.platform.phase === 'loading' ? 'platformLoading' : view.platform.phase === 'failed' ? 'platformCatalogFailed'
            : view.platform.phase === 'login' ? 'platformLogin' : query.trim() || category !== 'all' ? 'empty' : 'platformEmpty',
        )}</p>
      </div>) : entries.length > 0 ? <div className={catalogStyles.grid}>
        {entries.map(entry => (
          <Card key={entry.id} entry={entry} t={t} blocked={blocked}
            manage={(operation) => { manage(entry, operation) }}
            showDetails={(previewIndex) => { setDetailSelection({ source: 'local', id: entry.id, previewIndex }) }} open={() => { action.open(entry.id) }} />
        ))}
      </div> : <div className={styles.empty}>
        <WorkbenchIcon size={27} />
        <p>{t(needle ? 'empty' : 'myEmpty')}</p>
        {needle && <Button variant="ghost" onClick={() => { setQuery('') }}>{t('clear')}</Button>}
      </div>}
    </div>
    {detail && detailSelection && <Details key={detail.id} entry={detail}
      source={workbenchArchiveSource(detail.bundle?.source) ? 'platform' : 'local'}
      initialPreview={detailSelection.previewIndex} t={t} onClose={() => { setDetailSelection(undefined) }}
      actions={{ kind: 'local', entry: detail, blocked, manage: (operation) => { manage(detail, operation) },
        open: () => { setDetailSelection(undefined); action.open(detail.id) } }} />}
    {platformDetail && detailSelection && <Details key={platformDetail.release.versionId} entry={platformDetail.details} source="platform"
      initialPreview={detailSelection.previewIndex} t={t} onClose={() => { setDetailSelection(undefined) }}
      actions={{ kind: 'platform', item: platformDetail,
        activate: () => { setDetailSelection(undefined); void action.usePublished(platformDetail.release) },
        openInstalled: () => { setDetailSelection(undefined); action.open(platformDetail.release.packageName) } }} />}
    <ConfirmDialog open={!!view.pendingUpdate} title={t('updateTitle')} closeLabel={t('close')}
      resourceName={`${catalog.find(entry => entry.id === view.pendingUpdate?.name)?.name ?? view.pendingUpdate?.name ?? ''} · ${view.pendingUpdate?.from ?? ''} → ${view.pendingUpdate?.to ?? ''}`}
      description={t('updateHelp')} cancelLabel={t('cancel')} confirmLabel={t('confirmUpdate')} pending={!!view.busy}
      onCancel={action.cancelUpdate} onConfirm={() => { void action.confirmUpdate() }} />
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
