import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
/** Local workbench home and an application-owned full-window business surface. */
import { useRef, useState } from 'react'
import type { PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input, Modal, SegmentedControl, IconBrowseOutlineMedium, IconFolderOpenOutlineMedium, IconPlusOutlineMedium, IconSearchOutlineMedium, IconChevronLeftOutlineMedium, IconAgentPresetOutlineMedium, IconNewChatOutlineMedium, IconCloseOutlineMedium, IconRefreshOutlineMedium, IconEditOutlineMedium, IconCheckOutlineMedium, IconPlayOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ControllerProps, WorkbenchBusinessProps } from './contract.ts'
import type { WorkbenchDescriptor, WorkbenchProject } from '../contracts.ts'
import { projectIdSchema, sessionIdSchema } from '../contracts.ts'
import { creativeSchema, librarySchema } from '../examples.ts'
import css from './workbench.module.css'
type Locale = PropsLocale<'actvero.workbenches'>
type Common = ControllerProps & Locale
function Notice({ controller, useWorkbench, t }: Common) {
  const { error, notice } = useWorkbench(s => s)
  const message = error ?? notice
  return message ? <div className={error ? css.error : css.notice} role={error ? 'alert' : 'status'}><span>{t(message)}</span>{error && <Button size="sm" onClick={() => void controller.reload()}>{t('retry')}</Button>}</div> : null
}
function Tile({ item, recent, favorite, busy, onOpen, onFavorite, t }: {
  item: WorkbenchDescriptor
  recent?: WorkbenchProject
  favorite: boolean
  busy: boolean
  onOpen: () => void
  onFavorite: () => void
} & Locale) {
  return <article className={css.tile}>
    <button className={css.tilePreview} data-kind={item.icon} onClick={onOpen} disabled={busy} aria-label={t('open') + ' ' + item.title}>
      {item.icon === 'canvas' ? <><span className={css.miniText}><IconEditOutlineMedium size={20}/><span>{t('stage')}</span></span><span className={css.miniImage}/><span className={css.miniFrame}><IconPlayOutlineMedium size={22}/></span></> : <><span className={css.libraryThumbnail}/><span className={css.assetLines}><span /><span /><span /></span></>}
    </button>
    <div className={css.tileBody}><div className={css.tileTitle}><h3>{item.title}</h3><Button className={favorite ? css.favoriteOn : css.favorite} aria-label={t(favorite ? 'unfavorite' : 'favorite')} title={t(favorite ? 'unfavorite' : 'favorite')} onClick={onFavorite} disabled={busy}><IconCheckOutlineMedium /></Button></div><p>{item.description}</p><div className={css.tileFoot}><span>{t(item.example ? 'examples' : 'local')}<span className={css.version}>{item.version}</span></span><Button variant="outline" size="sm" onClick={onOpen} disabled={busy}>{t(recent ? 'continue' : 'open')}</Button></div></div>
  </article>
}
/** Local catalog with recent material, favorites and native bundle import.
 * @param props - Typed slot properties from the owning client registration.
 * @returns The localized workbench interface. */
export function WorkbenchHome({ controller, useWorkbench, t }: Common) {
  const state = useWorkbench(s => s)
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<'all' | 'favorites'>('all'), [importOpen, setImportOpen] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const snapshot = state.snapshot
  const items = snapshot?.definitions.filter(item => (filter !== 'favorites' || snapshot.favorites.includes(item.id)) && (item.title + item.description).toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? []
  const recent = snapshot?.projects.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3) ?? []
  return <section className={css.home} data-actvero-local-home>
    <header className={css.homeHeader}><div><span className={css.eyebrow}>{t('local')}</span><h1>{t('title')}</h1><p>{t('subtitle')}</p></div><Button variant="primary" onClick={() => { setImportOpen(true) }}><IconPlusOutlineMedium />{t('import')}</Button></header>
    <Notice controller={controller} useWorkbench={useWorkbench} t={t}/>
    <div className={css.homeToolbar}><div className={css.filters}><Button variant={filter === 'all' ? 'outline' : 'ghost'} onClick={() => { setFilter('all') }}>{t('all')}</Button><Button variant={filter === 'favorites' ? 'outline' : 'ghost'} onClick={() => { setFilter('favorites') }}>{t('favorites')}</Button></div><label className={css.search}><IconSearchOutlineMedium /><Input aria-label={t('search')} placeholder={t('search')} value={query} onChange={(event) => { setQuery(event.target.value) }}/></label></div>
    {recent.length > 0 && !query && filter === 'all' && <section className={css.recent}><h2>{t('recent')}</h2><div className={css.recentItems}>{recent.map(project => <button key={project.id} onClick={() => { void controller.open(project.workbenchId).then(() => { controller.selectProject(project.id) }) }} disabled={state.busy}><IconFolderOpenOutlineMedium size={20}/><span><strong>{project.title}</strong><small>{snapshot?.definitions.find(item => item.id === project.workbenchId)?.title}</small></span><span className={css.continue}>{t('continue')}</span></button>)}</div></section>}
    <h2 className={css.sectionTitle}>{t('installed')}<span>{items.length}</span></h2>
    {!snapshot ? <p className={css.empty} role="status">{t('loading')}</p> : <div className={css.tiles}>{items.map(item => <Tile key={item.id} item={item} recent={snapshot.projects.find(p => p.workbenchId === item.id)} favorite={snapshot.favorites.includes(item.id)} busy={state.busy} t={t} onOpen={() => void controller.open(item.id)} onFavorite={() => void controller.favorite(item.id)}/>)}</div>}
    {snapshot && items.length === 0 && <p className={css.empty}>{t('empty')}</p>}
    <footer className={css.homeFooter}><p>{t('exampleHelp')}</p><div><Button size="sm" onClick={controller.manage}>{t('manage')}</Button><Button size="sm" onClick={controller.compatibility}>{t('compatibility')}</Button></div></footer>
    <Modal open={importOpen} onClose={() => { setImportOpen(false) }} title={t('import')} description={t('importHelp')} closeLabel={t('close')} footer={<><Button onClick={() => { setImportOpen(false) }}>{t('close')}</Button><Button variant="primary" disabled={state.busy} onClick={() => file.current?.click()}>{t(state.busy ? 'importBusy' : 'install')}</Button></>}>
      <Notice controller={controller} useWorkbench={useWorkbench} t={t}/><input className={css.fileInput} ref={file} type="file" accept=".tgz" aria-label={t('install')} onChange={(event) => { const selected = event.target.files?.[0]; if (selected)
        void controller.import(selected); event.target.value = '' }}/>
    </Modal>
  </section>
}
/** Sidebar entry for opening the local catalog.
 * @param props - Typed slot properties from the owning client registration.
 * @returns The localized workbench interface. */
export function WorkbenchNav({ controller, t }: Common) { return <Button className={css.nav} onClick={controller.showHome}><IconBrowseOutlineMedium size={19}/><span>{t('title')}</span></Button> }
/** Native conversation Factory rendered in the current Session scope.
 * @param props - Typed slot properties from the owning client registration.
 * @returns The localized workbench interface. */
export function NativeWorkbenchConversation({ renderFactorySlot }: PropsRuntime<'actvero.workbench.conversation'> & PropsRenderFactories) {
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false })
}
/** Full-window workbench with a persistent native conversation component.
 * @param props - Typed slot properties from the owning client registration.
 * @returns The localized workbench interface. */
export function WorkbenchFrame({ controller, useWorkbench, t, renderSlot, SessionProvider }: Common & PropsRenderSlots<'actvero.workbench.business' | 'actvero.workbench.conversation'>) {
  const state = useWorkbench(s => s)
  const snapshot = state.snapshot
  const project = snapshot?.projects.find(item => item.id === state.projectId)
  const definition = snapshot?.definitions.find(item => item.id === state.active)
  const [newProject, setNewProject] = useState(false), [title, setTitle] = useState(''), [storage, setStorage] = useState(false)
  if (!project || !definition)
    return null
  const conversations = snapshot?.conversations.filter(item => item.projectId === project.id) ?? []
  const onUpdate = async (data: WorkbenchProject['data'], revision = project.revision) => { await controller.update(project.id, revision, data); return !controller.getSnapshot().error }
  const business = () => renderSlot('actvero.workbench.business', { project, busy: state.busy, update: onUpdate, assistant: () => void controller.view('split') }, { entryKey: definition.id })
  return <section className={css.surface} data-actvero-workbench-surface data-view={state.view}>
    <header className={css.topbar} data-window-drag><div className={css.identity}><Button onClick={controller.showHome} title={t('back')}><IconChevronLeftOutlineMedium />{t('back')}</Button><span className={css.separator}/><IconBrowseOutlineMedium /><strong>{definition.title}</strong>{definition.example && <span className={css.sampleBadge}>{t('sampleLabel')}</span>}</div><div className={css.viewSwitcher}><SegmentedControl value={state.view} id="workbench-view" options={[{ value: 'business', label: t('business') }, { value: 'split', label: t('split') }, { value: 'conversation', label: t('conversation') }]} onChange={value => void controller.view(value)} label={t('views')} disabled={state.busy}/></div><Button title={t('storage')} aria-label={t('storage')} onClick={() => { setStorage(true) }}><IconFolderOpenOutlineMedium /></Button></header>
    <Notice controller={controller} useWorkbench={useWorkbench} t={t}/>
    <div className={css.projectbar}><div className={css.projectSelect}><IconFolderOpenOutlineMedium /><select aria-label={t('project')} value={project.id} onChange={(event) => { controller.selectProject(projectIdSchema.parse(event.target.value)) }} disabled={state.busy}>{snapshot?.projects.filter(p => p.workbenchId === definition.id).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div><span className={css.saved}><IconCheckOutlineMedium size={13}/>{t(state.busy ? 'saving' : 'saved')}</span><span className={css.spacer}/><Button size="sm" onClick={() => void controller.reload()} aria-label={t('refresh')} title={t('refresh')}><IconRefreshOutlineMedium /></Button><Button size="sm" onClick={() => { setTitle(''); setNewProject(true) }}><IconPlusOutlineMedium />{t('newProject')}</Button>{state.view === 'business' && <Button size="sm" variant="outline" onClick={() => void controller.view('split')} disabled={state.busy}><IconAgentPresetOutlineMedium />{t('assistant')}</Button>}</div>
    <div className={css.workarea}>
      <div className={css.business} data-actvero-business>{business()}</div>
      <section className={css.conversation} data-actvero-native-conversation aria-label={t('assistant')}>
        <header className={css.chatHeader}><IconAgentPresetOutlineMedium /><strong>{t('assistant')}</strong><span className={css.spacer}/><Button size="sm" onClick={() => void controller.newConversation()} disabled={state.busy} title={t('newChat')} aria-label={t('newChat')}><IconNewChatOutlineMedium /></Button>{state.view === 'conversation' && <Button size="sm" aria-label={t('previewToggle')} title={t('previewToggle')} onClick={controller.togglePreview}><IconBrowseOutlineMedium /></Button>}<Button size="sm" onClick={() => void controller.view('business')} aria-label={t('close')} title={t('close')}><IconCloseOutlineMedium /></Button></header>
        <div className={css.contextbar}><span title={t('context')}>{definition.title}<span className={css.contextSeparator}>/</span>{project.title}</span><select aria-label={t('topics')} value={state.sessionId ?? ''} disabled={state.busy} onChange={(event) => { void controller.selectConversation(sessionIdSchema.parse(event.target.value)) }}><option value="" disabled>{t('topics')}</option>{conversations.map((item, index) => <option key={item.sessionId} value={item.sessionId}>{t('topic') + ' ' + String(index + 1)}</option>)}</select></div>
        <div className={css.nativeBody}>{state.sessionId && state.reference ? <SessionProvider session={state.reference}>{renderSlot('actvero.workbench.conversation', {})}</SessionProvider> : <div className={css.assistantEmpty}><IconAgentPresetOutlineMedium size={32}/><h2>{t('noConversation')}</h2><p>{t('assistantHelp')}</p><Button variant="primary" onClick={() => void controller.view('split')} disabled={state.busy}>{t('startAssistant')}</Button></div>}</div>
      </section>
      {state.view === 'business' && <Button className={css.assistantLauncher} variant="primary" onClick={() => void controller.view('split')} disabled={state.busy}><IconAgentPresetOutlineMedium />{t('assistant')}</Button>}
      {state.view === 'conversation' && state.preview && <aside className={css.preview}><header><strong>{t('preview')}</strong><Button size="sm" onClick={controller.togglePreview} aria-label={t('close')}><IconCloseOutlineMedium /></Button></header><div className={css.previewBody}><div className={css.referencePhoto} role="img" aria-label={t('referenceTitle')}/><p>{project.title}</p></div></aside>}
    </div>
    <Modal open={newProject} onClose={() => { setNewProject(false) }} title={t('newProject')} description={t('storageHelp')} closeLabel={t('close')} footer={<><Button onClick={() => { setNewProject(false) }}>{t('cancel')}</Button><Button variant="primary" disabled={!title.trim() || state.busy} onClick={() => void controller.create(title.trim()).then(() => { if (!controller.getSnapshot().error)
      setNewProject(false) })}>{t('create')}</Button></>}><label className={css.field}>{t('projectName')}<Input autoFocus value={title} onChange={(event) => { setTitle(event.target.value) }} placeholder={t('projectPlaceholder')} maxLength={150}/></label><Notice controller={controller} useWorkbench={useWorkbench} t={t}/></Modal>
    <Modal open={storage} onClose={() => { setStorage(false) }} title={t('storage')} description={t('storageHelp')} closeLabel={t('close')}><code className={css.path}>{snapshot?.storagePath}</code></Modal>
  </section>
}
/** Editable creative reference with locally persisted text nodes.
 * @param props - Typed slot properties from the owning client registration.
 * @returns The localized workbench interface. */
export function CreativeBusiness({ project, busy, update, t }: WorkbenchBusinessProps) {
  const data = creativeSchema.parse(project.data)
  const [editRevision, setEditRevision] = useState(project.revision)
  const [selected, setSelected] = useState('visual'), [editing, setEditing] = useState<string>(), [nodeTitle, setNodeTitle] = useState(''), [nodeText, setNodeText] = useState('')
  const edit = (id: string) => { const node = data.nodes.find(item => item.id === id); if (!node)
    return; setEditRevision(project.revision); setNodeTitle(node.title); setNodeText(node.text); setEditing(id) }
  return <div className={css.canvas} data-actvero-canvas>
    <div className={css.canvasHeading}><span>{t('stage')}</span><small>{t('editHint')}</small></div>
    <div className={css.nodes}>{data.nodes.map(node => <article
      key={node.id} className={selected === node.id ? css.selectedNode : css.node} data-kind={node.kind}>
      <button className={css.nodeHeader} onClick={() => { setSelected(node.id) }} aria-pressed={selected === node.id}><span>{node.kind === 'text' ? <IconEditOutlineMedium /> : node.kind === 'video' ? <IconPlayOutlineMedium /> : <IconBrowseOutlineMedium />}{node.title}</span></button>
      {node.kind !== 'text' && <button className={css.photo} data-kind={node.kind} onClick={() => { edit(node.id) }} aria-label={t('edit') + ' ' + node.title}><span>{t('sampleMedia')}</span></button>}
      <p>{node.text}</p><Button className={css.editNode} size="sm" onClick={() => { edit(node.id) }} disabled={busy}><IconEditOutlineMedium />{t('edit')}</Button>
    </article>)}</div>
    <div className={css.canvasBottom}><Button variant="outline" onClick={() => void update({ nodes: [...data.nodes, { id: randomUUID(), kind: 'text', title: t('newNode'), text: t('newNodeText') }] })} disabled={busy || data.nodes.length >= 60}><IconPlusOutlineMedium />{t('addNode')}</Button><span>{t('selected') + ': ' + (data.nodes.find(n => n.id === selected)?.title ?? '')}</span></div>
    <Modal open={editing !== undefined} onClose={() => { setEditing(undefined) }} title={t('edit')} description={t('editHint')} closeLabel={t('close')} footer={<><Button onClick={() => { setEditing(undefined) }}>{t('cancel')}</Button><Button variant="primary" disabled={busy || !nodeTitle.trim()} onClick={() => void update({ nodes: data.nodes.map(node => node.id === editing ? { ...node, title: nodeTitle.trim(), text: nodeText } : node) }, editRevision).then((saved) => { if (saved)
      setEditing(undefined) })}>{t('save')}</Button></>}><label className={css.field}>{t('nodeTitle')}<Input value={nodeTitle} maxLength={200} onChange={(event) => { setNodeTitle(event.target.value) }}/></label><label className={css.field}>{t('nodeText')}<textarea aria-label={t('nodeText')} value={nodeText} maxLength={12000} onChange={(event) => { setNodeText(event.target.value) }}/></label></Modal>
  </div>
}
/** Local asset notes with revision-checked draft saving.
 * @param props - Typed slot properties from the owning client registration.
 * @returns The localized workbench interface. */
export function LibraryBusiness({ project, busy, update, t }: WorkbenchBusinessProps) {
  const data = librarySchema.parse(project.data)
  const [draft, setDraft] = useState<{
    projectId: string
    revision: number
    text: string
  }>()
  const notes = draft?.projectId === project.id ? draft.text : data.notes
  const setNotes = (text: string) => {
    setDraft(previous => ({
      projectId: project.id,
      revision: previous?.projectId === project.id ? previous.revision : project.revision,
      text,
    }))
  }
  return <div className={css.library} data-actvero-library><header><span className={css.eyebrow}>{t('reference')}</span><h1>{t('referenceTitle')}</h1><p>{t('standalone')}</p></header><div className={css.libraryColumns}><div className={css.referencePhoto} role="img" aria-label={t('referenceTitle')}/><section><h2>{t('notes')}</h2><p>{t('referenceHelp')}</p><label className={css.field}><textarea aria-label={t('notes')} placeholder={t('notesPlaceholder')} value={notes} onChange={(event) => { setNotes(event.target.value) }} maxLength={20000}/></label><Button variant="primary" disabled={busy || notes === data.notes} onClick={() => void update({ notes }, draft?.revision ?? project.revision).then((saved) => { if (saved)
    setDraft(undefined) })}>{t('save')}</Button>{notes !== data.notes && <Button onClick={() => { setDraft(undefined) }}>{t('retry')}</Button>}<p className={css.assetName}>{t('fileName')}</p></section></div></div>
}
