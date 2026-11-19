import type {} from '@actvero/dsh-capability-ui/remote'
import { ExpertBadge } from './ExpertBadge.tsx'
import { SourceTabs, catalogStyles, CapabilityIdentity } from '@actvero/dsh-capability-ui/client/sources'
import { expertOptions } from './selector.ts'
import { zh, en } from './locales.ts'
import { CatalogSkeleton } from '@actvero/dsh-capability-ui/client/loading'
import { prepareCreation } from '@actvero/dsh-capability-ui/client/selection'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@actvero/dsh-capability-ui/client/contracts'
import type { PopupSelectSpec } from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Input,
  Modal,
  ActionMenu as CardMenu,
  ConfirmDialog,
  IconPlusOutlineMedium,
  IconCloseOutlineMedium,
  IconSearchOutlineMedium,
  IconAgentPresetOutlineMedium,
  IconCopyOutlineMedium,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { expertCategories } from '../categories.ts'
import { creatorSkillName } from '../creator.ts'
import type { RemotePlan } from '../remote-contract.ts'
import type { ExpertPackagePreview } from '../expert-package.ts'
import { parseManifest } from '../schema.ts'
import type { Bindings, DependencyCatalog, Expert as StoredExpert, ExpertManifest, ExpertSelection } from '../contracts.ts'
import { normalizeExpertSelectionAvatar } from '../avatar.ts'
import styles from './experts.module.css'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'actvero.experts': keyof typeof zh
  }
}
type Expert = StoredExpert & { workbench?: { id: import('@actvero/dsh-capability-ui/types').WorkbenchId; name: string } }
type T = (key: keyof typeof zh) => string



const req = async <T,>(action: string, input: Record<string, unknown> = {}): Promise<T> => {
  if (!window.actveroExperts) throw new Error('expert_host_unavailable')
  return (await window.actveroExperts.request(action, input)) as T
}
const errorText = (e: unknown, t: T) => {
  const code = typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined
  if (code === 'workbench/busy') return t('waitForTurn')
  if (code === 'workbench/unavailable') return t('workbenchUnavailable')
  return t(
    (
      {
        secure_storage_unavailable: 'storageUnavailable',
        secure_storage_invalid: 'storageInvalid',
        expert_package_invalid: 'packageInvalid',
        expert_package_checksum: 'packageInvalid',
        unsafe_package: 'packageInvalid',
        unsafe_template: 'packageUnsafeTemplate',
        expert_package_changed: 'packageChanged',
        expert_package_expired: 'packageChanged',
        expert_package_cleanup: 'packageCleanup',
        expert_selection_expired: 'failed',
        expert_dependencies_changed: 'changedSkill',
        expert_remote_login: 'remoteLogin',
        expert_remote_network: 'remoteNetwork',
        expert_remote_rate_limited: 'remoteNetwork',
        expert_release_changed: 'remoteChanged',
        expert_remote_unavailable: 'remoteUnavailable',
        expert_remote_unsupported: 'remoteUnsupported',
        expert_remote_invalid: 'remoteInvalid',
        expert_remote_checksum: 'remoteInvalid',
        expert_remote_endpoint: 'remoteInvalid',
        expert_remote_cache_stale: 'remoteCacheStale',
        expert_remote_tools: 'remoteInvalid',
        expert_workspace_required: 'workspaceMissing',
        expert_workspace_missing: 'workspaceMissing',
        expert_edit_conflict: 'conflict',
        expert_session_busy: 'waitForTurn',
        expert_invalid: 'invalid',
        expert_schema_unsupported: 'invalid',
        expert_skill_changed: 'changedSkill',
        expert_connector_changed: 'changedConnector',
        expert_account_changed: 'accountChanged',
        expert_dependencies_missing: 'bindFirst',
        expert_skill_conflict: 'duplicateSkill',
        expert_connector_unavailable: 'changedConnector',
        expert_snapshot_invalid: 'invalid',
      } as Record<string, keyof typeof zh>
    )[e instanceof Error ? e.message : ''] ?? 'failed',
  )
}

function Avatar({ expert }: { expert: Pick<ExpertManifest, 'avatar' | 'name'> }) {
  return (
    <span className={styles.avatar}>
      {expert.avatar ? (
        <img src={expert.avatar} alt="" />
      ) : (
        <span>{expert.name.slice(0, 1) || <IconAgentPresetOutlineMedium size={22} />}</span>
      )}
    </span>
  )
}
function CardTags({ tags, label }: { tags: string[]; label: string }) {
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = strip.current
    if (!node) return
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || node.scrollWidth <= node.clientWidth)
        return
      const before = node.scrollLeft
      node.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? node.clientWidth : 1)
      if (node.scrollLeft !== before) event.preventDefault()
    }
    node.addEventListener('wheel', wheel, { passive: false })
    return () =>{  node.removeEventListener('wheel', wheel) }
  }, [])
  return (
    <div ref={strip} className={styles.tags} tabIndex={0} role="region" aria-label={label}>
      {tags.map((tag, i) => (
        <span key={i}>{tag}</span>
      ))}
    </div>
  )
}
function Dialog({
  title,
  close,
  children,
  className = '',
}: {
  title: string
  close: () => void
  children: React.ReactNode
  className?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const old = document.activeElement as HTMLElement
    root.current?.querySelector<HTMLElement>('input,button,textarea')?.focus()
    return () =>{  old?.focus() }
  }, [])
  return (
    <Modal open headless title={title} onClose={close} className={`${styles.modal} ${className}`}>
      <div
        ref={root}
        className={styles.dialog}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return
          const all = [
            ...e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),textarea,select',
            ),
          ].filter(el => el.getClientRects().length)
          if (e.shiftKey && document.activeElement === all[0]) {
            e.preventDefault()
            all.at(-1)?.focus()
          } else if (!e.shiftKey && document.activeElement === all.at(-1)) {
            e.preventDefault()
            all[0]?.focus()
          }
        }}
      >
        <div className={styles.close}>
          <Button onClick={close} aria-label={title + ' ×'}>
            <IconCloseOutlineMedium />
          </Button>
        </div>
        {children}
      </div>
    </Modal>
  )
}
type PreparationRequest = { plan: RemotePlan; finish: (ready?: RemotePlan) => void }
function Preparation({ t, pending, manage }: { t: T; pending: PreparationRequest; manage: () => void }) {
  const [plan, setPlan] = useState(pending.plan),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const refresh = async () => {
    setBusy(true)
    setError('')
    try {
      setPlan(await req<RemotePlan>('remote-plan', { id: plan.id }))
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }
  const prepare = async () => {
    setBusy(true)
    setError('')
    try {
      await req('remote-stage', { id: plan.id, releaseProof: plan.releaseProof })
      pending.finish(plan)
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      className={styles.workspaceModal}
      title={t(plan.previousVersion ? 'updateTitle' : 'prepareTitle')}
      close={() => {
        if (!busy) pending.finish()
      }}
    >
      <div className={styles.workspaceBody}>
        <h2>{plan.name}</h2>
        {(!plan.previousVersion || plan.dependencies.some(d => d.action !== 'none')) && <p>{t('prepareHelp')}</p>}
        {plan.version && <p>{t('version')} {plan.previousVersion ? `${plan.previousVersion} → ` : ''}{plan.version}</p>}
        {plan.previousVersion && <p>{t('updateSessions')}</p>}
        <div className={styles.preparationList}>
          {plan.dependencies.map(d => (
            <div key={d.kind + ':' + d.key} className={styles.preparationRow}>
              <span>
                <strong>{d.label}</strong>
                <small>
                  {t(d.required ? 'required' : 'optional')} · {t(d.kind === 'skills' ? 'skills' : 'connectors')}
                </small>
              </span>
              <span>
                {t((['available', 'unverified'].includes(d.status) ? d.action : d.status) as keyof typeof zh)}
              </span>
            </div>
          ))}
        </div>
        {plan.dependencies.some(d => d.status === 'connection_required') && (
          <Button
            onClick={() => {
              pending.finish()
              manage()
            }}
            disabled={busy}
          >
            {t('manageConnections')}
          </Button>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <footer className={styles.workspaceFooter}>
        <Button disabled={busy} onClick={() =>{  pending.finish() }}>
          {t('cancel')}
        </Button>
        <Button disabled={busy} onClick={() => void refresh()}>
          {t('prepareRetry')}
        </Button>
        <Button variant="primary" disabled={busy || !plan.canPrepare} onClick={() => void prepare()}>
          {t(busy ? 'busy' : plan.previousVersion ? 'updateAndUse' : 'prepareConfirm')}
        </Button>
      </footer>
    </Dialog>
  )
}
function PreparationOverlay({
  useRequest,
  manage,
  t,
}: {
  useRequest: <V>(selector: (value: PreparationRequest | undefined) => V) => V
  manage: () => void
  t: T
}) {
  const pending = useRequest(v => v)
  return pending ? <Preparation key={pending.plan.id} pending={pending} manage={manage} t={t} /> : null
}
type Props = PropsRuntime<'actvero.capability.content'> &
  PropsLocale<'actvero.experts'> & {
    useExpert(id: string, text?: string): Promise<void>
    createWithAI(text: string): Promise<void>
    loadLocalExperts(): Promise<Expert[]>
    ctxResources(): Promise<string>
    watchContributed(listener: () => void): () => void
  }
function CapabilityBindings({
  t,
  manifest,
  close,
  done,
}: {
  t: T
  manifest: ExpertManifest
  close: () => void
  done: (expert: Expert) => void
}) {
  const [catalog, setCatalog] = useState<DependencyCatalog>(),
    [bindings, setBindings] = useState<Bindings>({ skills: {}, connectors: {} }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void req<DependencyCatalog>('catalog')
      .then((v) => {
        if (live) setCatalog(v)
      })
      .catch((e) => {
        if (live) setError(errorText(e, t))
      })
    return () => {
      live = false
    }
  }, [t])
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await req<Expert>('import', { manifest, bindings })
      done(result)
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={t('importReview')}
      close={() => {
        if (!busy) close()
      }}
    >
      <div className={styles.workspaceBody}>
        <h2>{t('importReview')}</h2>
        <div className={styles.importIdentity}>
          <Avatar expert={manifest} />
          <strong>{manifest.name}</strong>
        </div>
        <p>{manifest.description}</p>
        <p>{t('bindingsHelp')}</p>
        {(['skills', 'connectors'] as const).map(
          kind =>
            manifest[kind].length > 0 && (
              <section key={kind} className={styles.bindingSection}>
                <h3>{t(kind)}</h3>
                {manifest[kind].map(r => (
                  <label key={r.key} className={styles.bindingRow}>
                    <span>
                      {r.label} · {t(r.required ? 'required' : 'optional')}
                    </span>
                    <select
                      aria-label={r.label}
                      disabled={busy || !catalog}
                      value={bindings[kind][r.key] ?? ''}
                      onChange={(e) => {
                        const id = e.target.value
                        setBindings((old) => {
                          const next = { ...old, [kind]: { ...old[kind] } }
                          if (id) next[kind][r.key] = id
                          else next[kind] = Object.fromEntries(Object.entries(next[kind]).filter(([key]) => key !== r.key))
                          return next
                        })
                      }}
                    >
                      <option value="">{t('unbound')}</option>
                      {catalog?.[kind].map(v => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                          {v.ready ? '' : ' · ' + t('connection_required')}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </section>
            ),
        )}
        {!catalog && !error && <p role="status">{t('loading')}</p>}
        {error && (
          <p role="alert" className={styles.notice}>
            {error}
          </p>
        )}
      </div>
      <footer className={styles.workspaceFooter}>
        <Button disabled={busy} onClick={close}>
          {t('cancel')}
        </Button>
        <Button variant="primary" disabled={busy || !catalog} onClick={() => void save()}>
          {t(busy ? 'busy' : 'import')}
        </Button>
      </footer>
    </Dialog>
  )
}
function PackagePreview({
  t,
  plan,
  close,
  done,
}: {
  t: T
  plan: ExpertPackagePreview
  close: () => void
  done: (expert: Expert) => void
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const commit = async () => {
    setBusy(true)
    setError('')
    try {
      done(await req<Expert>('package-import', { token: plan.token }))
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={t('importReview')}
      close={() => {
        if (!busy) close()
      }}
    >
      <div className={styles.workspaceBody}>
        <h2>{plan.name}</h2>
        <p>{plan.description}</p>
        <p>{t('version')} {plan.previousVersion ? `${plan.previousVersion} → ` : ''}{plan.version}</p>
        {plan.operation === 'current' && <p>{t('packageCurrent')}</p>}
        {plan.legacy && <p>{t('packageLegacy')}</p>}
        {plan.reason && <p role="alert">{t(({ local_changes:'packageLocalChanges',version:'packageVersionConflict',ambiguous:'packageAmbiguous' } as const)[plan.reason])}</p>}
        <p>{t('packageHelp')}</p>
        {plan.operation === 'update' && <p>{t('updateSessions')}</p>}
        <div className={styles.preparationList}>
          {plan.rows.map(row => (
            <div className={styles.preparationRow} key={row.kind + ':' + row.key}>
              <span>
                <strong>{row.name}</strong>
                <small>
                  {t(row.kind)} · {t(row.required ? 'required' : 'optional')}
                </small>
              </span>
              <span>
                {t(
                  (
                    {
                      reuse: 'packageReuse',
                      install: 'packageInstall',
                      update: row.kind === 'connectors' ? 'packageConnectorUpdate' : 'packageUpdate',
                      conflict: 'packageConflict',
                      authorization: 'packageAuthorization',
                    } as const
                  )[row.status],
                )}
              </span>
            </div>
          ))}
        </div>
        {!plan.canImport && <p className={styles.notice}>{t('packageBlocked')}</p>}
        {error && (
          <p role="alert" className={styles.notice}>
            {error}
          </p>
        )}
      </div>
      <footer className={styles.workspaceFooter}>
        <Button disabled={busy} onClick={close}>
          {t('cancel')}
        </Button>
        <Button variant="primary" disabled={busy || !plan.canImport} onClick={() => void commit()}>
          {t(busy ? 'busy' : plan.operation === 'update' ? 'confirmUpdate' : plan.operation === 'current' ? 'packageCurrent' : 'import')}
        </Button>
      </footer>
    </Dialog>
  )
}
function Panel({ t, useExpert, createWithAI, loadLocalExperts, ctxResources, watchContributed, notify }: Props) {
  const [items, setItems] = useState<Expert[]>([]),
    [q, setQ] = useState(''),
    [category, setCategory] = useState('all'),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<Expert>(),
    [busy, setBusy] = useState(false)
  const [source, setSource] = useState<'local' | 'platform'>('platform'),
    [available, setAvailable] = useState<boolean>(),
    [categories, setCategories] = useState<{ id: string; name: string }[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [revision, setRevision] = useState(0),
    [loadedSource, setLoadedSource] = useState<'local' | 'platform'>()
  const initialized = useRef(false)
  const sourceGeneration = useRef<number>()
  const [summoningId, setSummoningId] = useState<string>()
  const [updates, setUpdates] = useState<Record<string,{ from:string;to:string }>>({})
  const announcedUpdates = useRef(new Set<string>())
  const [packagePlan, setPackagePlan] = useState<ExpertPackagePreview>()
  const [removeTarget, setRemoveTarget] = useState<Expert>()
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [importing, setImporting] = useState<ExpertManifest>(),
    [message] = useState('')

  useEffect(() => {
    let live = true
    const update = () => {
      void req<{ remote: boolean; generation?: number }>('sources')
        .then((v) => {
          if (!live) return
          if (sourceGeneration.current !== v.generation) {
            sourceGeneration.current = v.generation
            setLoadedSource(undefined)
            setItems([])
            setUpdates({})
            setTotal(0)
            setCategories([])
            announcedUpdates.current.clear()
            setSelected(previous => previous?.manifest.id.startsWith('remote-') ? undefined : previous)
          }
          setAvailable(v.remote)
          if (!initialized.current) {
            initialized.current = true
            if (v.remote) setSource('platform')
          }
          if (!v.remote) {
            setSource('local')
            setSelected(previous => previous?.manifest.id.startsWith('remote-') ? undefined : previous)
          }
          setRevision(r => r + 1)
        })
        .catch(() => {
          if (live) {
            setAvailable(false)
            setSource('local')
            setRevision(r => r + 1)
          }
        })
    }
    update()
    const off = window.actveroExperts?.subscribe(update)
    return () => {
      live = false
      off?.()
    }
  }, [])
  useEffect(() => {
    if (available === undefined) return
    let live = true
    setLoading(true)
    setError('')
    const timer = setTimeout(
      () => {
        const load = async () => {
          if (source === 'platform') {
            const [data, cats] = await Promise.all([
              req<{ items: Expert[]; total: number; updates?:Record<string,{ from:string;to:string }> }>('remote-list', {
                q,
                category: category === 'all' ? '' : category,
                page,
              }),
              req<{ id: string; name: string }[]>('remote-categories', { q }),
            ])
            if (live) {
              setLoadedSource('platform')
              setItems(data.items)
              setUpdates(data.updates ?? {})
              const fresh=Object.entries(data.updates ?? {}).filter(([id,update])=>!announcedUpdates.current.has(id+':'+update.to))
              if(fresh.length){
                for(const [id,update] of fresh)announcedUpdates.current.add(id+':'+update.to)
                notify(t('updatesAvailable'))
              }
              setTotal(data.total)
              setCategories(cats)
            }
          } else {
            const data = await loadLocalExperts()
            if (live) {
              setLoadedSource('local')
              setItems(data)
              setUpdates({})
              setTotal(data.length)
              setCategories(expertCategories.map(id => ({ id, name: t(id) })))
            }
          }
        }
        void load()
          .catch((e) => {
            if (live) {
              setLoadedSource(source)
              setError(errorText(e, t))
              if (e instanceof Error && e.message === 'expert_remote_category_changed') setCategory('all')
            }
          })
          .finally(() => {
            if (live) setLoading(false)
          })
      },
      q ? 150 : 0,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q, category, page, source, revision, available, t])
  useEffect(() => watchContributed(() =>{  setRevision(value => value + 1) }), [watchContributed])
  const action = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      notify(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }
  const create = () => { setCreatorOpen(true) }
  const copyCreationInstructions = () => void action(async () => {
    const resources = await ctxResources()
    try { await navigator.clipboard.writeText(t('creatorHandoff') + '\n\n' + resources) }
    catch { notify(t('creatorCopyFailed')); return }
    notify(t('creatorCopied'), 'success')
  })
  const summon = (expert: Expert, text?: string) =>
    void action(async () => {
      setSummoningId(expert.manifest.id)
      try {
        await useExpert(expert.manifest.id, text)
        setSelected(undefined)
      } finally {
        setSummoningId(undefined)
      }
    })
  const choose = (expert: Expert) =>
    void action(async () => {
      const origin = source
      setRemoveTarget(undefined)
      setSelected(origin === 'platform' ? await req<Expert>('remote-detail', { id: expert.manifest.id }) : expert)
    })
  const removeSelected = () =>
    void action(async () => {
      if (!removeTarget) return
      await req('remove', { id: removeTarget.manifest.id })
      setRemoveTarget(undefined)
      setSelected(undefined)
      setRevision(r => r + 1)
      notify(t('removeDone'), 'success')
    })
  const expertMenu = (expert:Expert): readonly MenuEntry[] =>
    source === 'local' && !expert.workbench
      ? [
        { id: 'view', label: t('view') },
        { id: 'export', label: t('export') },
        { type: 'separator', id: 'expert-menu-separator' as const },
        { id: 'delete', label: t('remove'), danger: true },
      ]
      : [{ id: 'view', label: t('view') },...(updates[expert.manifest.id]?[{ id:'update',label:t('updateAndUse') }]:[])]
  const selectExpertMenu = (expert: Expert, id: string) => {
    if (id === 'update') { summon(expert); return }
    if (id === 'view') {
      choose(expert)
      return
    }
    if (id === 'export') {
      void action(async () => {
        if (await req<boolean>('package-export', { id: expert.manifest.id })) notify(t('packageExported'), 'success')
      })
      return
    }
    if (id === 'delete') {
      setRemoveTarget(expert)
    }
  }
  const pending = available === undefined || loadedSource !== source
  const visible =
    source === 'platform'
      ? items
      : items.filter(
        ({ manifest: m }) =>
          (category === 'all' || (m.category ?? 'general') === category) &&
            [m.name, m.description, ...m.tags].join(' ').toLocaleLowerCase().includes(q.trim().toLocaleLowerCase()),
      )
  return (
    <section className={styles.page}>
      <header className={`${styles.toolbar} ${catalogStyles.toolbar}`}>
        <Input
          className={`${styles.search} ${catalogStyles.search}`}
          icon={<IconSearchOutlineMedium />}
          placeholder={t('search')}
          aria-label={t('search')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
        />
        <Button
          variant="outline"
          disabled={busy}
          title={t('importHelp')}
          onClick={() =>
            void action(async () => {
              const picked = await req<
                { kind: 'json'; manifest: unknown } | { kind: 'zip'; plan: ExpertPackagePreview } | null
              >('package-pick')
              if (!picked) return
              if (picked.kind === 'zip') setPackagePlan(picked.plan)
              else setImporting(parseManifest(picked.manifest))
            })
          }
        >
          {t('import')}
        </Button>
        <Button variant="outline" disabled={busy} onClick={create}>
          <IconPlusOutlineMedium />
          {t('create')}
        </Button>
      </header>
      <div className={styles.content} aria-busy={pending || loading}>
        {message && (
          <p role="status" className={styles.notice}>
            {message}
          </p>
        )}
        {error && !selected && (
          <p role="alert" className={styles.notice}>
            {error}
          </p>
        )}
        <SourceTabs
          value={source}
          platformLabel={t('platform')}
          localLabel={t('local')}
          count={pending ? undefined : total}
          onChange={(value) => {
            setSource(value)
            setCategory('all')
            setPage(1)
          }}
        />
        <nav className={catalogStyles.categories} aria-label={t('category')}>
          {loadedSource !== source && pending ? (
            <div className={styles.skeletonCategories} aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} />
              ))}
            </div>
          ) : (
            [{ id: 'all', name: t('all') }, ...categories].map(value => (
              <Button
                key={value.id}
                aria-pressed={category === value.id}
                onClick={() => {
                  setCategory(value.id)
                  setPage(1)
                }}
              >
                {value.name}
              </Button>
            ))
          )}
        </nav>
        {pending ? (
          <CatalogSkeleton label={t('loading')} />
        ) : visible.length ? (
          <div className={catalogStyles.grid}>
            {visible.map(expert => (
              <article key={expert.manifest.id} className={styles.card}>
                <button
                  type="button"
                  className={styles.cardOpen}
                  onClick={() =>{  choose(expert) }}
                  aria-label={expert.manifest.name}
                >
                  <span className={styles.identity}>
                    <Avatar expert={expert.manifest} />
                    <strong title={expert.manifest.name}>{expert.manifest.name}</strong>
                  </span>
                  <span className={styles.description}>{expert.manifest.description}</span>
                  <span className={updates[expert.manifest.id] ? styles.update : styles.version}>
                    {updates[expert.manifest.id] ? `${t('updateAvailable')} · ${updates[expert.manifest.id]?.from} → ${updates[expert.manifest.id]?.to}` : `${expert.workbench ? t('fromWorkbench') + ' · ' + expert.workbench.name + ' · ' : ''}${t('versionPrefix')}${expert.manifest.version}`}
                  </span>
                </button>
                {!!expert.manifest.tags.length && (
                  <CardTags tags={expert.manifest.tags} label={expert.manifest.name + ' · ' + t('tags')} />
                )}
                <div className={styles.cardActions}>
                  <CardMenu
                    className={styles.more}
                    label={`${t('view')} ${expert.manifest.name}`}
                    disabled={busy}
                    items={expertMenu(expert)}
                    onSelect={(id) =>{  selectExpertMenu(expert, id) }}
                  />
                  <Button
                    className={styles.summon}
                    variant="primary"
                    disabled={busy}
                    aria-busy={summoningId === expert.manifest.id}
                    aria-label={t('use') + ' ' + expert.manifest.name}
                    onClick={() =>{  summon(expert) }}
                  >
                    {t(summoningId === expert.manifest.id ? 'summoning' : 'summon')}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <IconAgentPresetOutlineMedium size={36} />
            <h2>{t(items.length || q ? 'noResults' : 'empty')}</h2>
            {!items.length && !q && source === 'local' && (
              <>
                <p>{t('emptyHelp')}</p>
                <Button variant="outline" disabled={busy} onClick={create}>
                  <IconPlusOutlineMedium />
                  {t('create')}
                </Button>
              </>
            )}
          </div>
        )}
        {source === 'platform' && total > 20 && (
          <footer className={styles.pagination}>
            <Button disabled={loading || page === 1} onClick={() =>{  setPage(p => p - 1) }}>
              {t('previous')}
            </Button>
            <span>
              {page} / {Math.ceil(total / 20)}
            </span>
            <Button disabled={loading || page * 20 >= total} onClick={() =>{  setPage(p => p + 1) }}>
              {t('next')}
            </Button>
          </footer>
        )}
      </div>
      <Modal open={creatorOpen} onClose={() => { if (!busy) setCreatorOpen(false) }} title={t('create')}
        closeLabel={t('close')} description={t('creatorHelp')} className={styles.creatorDialog}>
        <p className={styles.creatorHint}>{t('creatorChoice')}</p>
        <div className={styles.creatorActions}>
          <Button variant="primary" disabled={busy} onClick={() => { void action(async () => {
            setCreatorOpen(false)
            await createWithAI(t('creatorPrompt'))
          }) }}>{t('creatorHere')}</Button>
          <Button variant="outline" disabled={busy} onClick={copyCreationInstructions}>
            <IconCopyOutlineMedium size={16} />{t('creatorElsewhere')}
          </Button>
        </div>
      </Modal>
      {selected && (
        <Dialog
          title={selected.manifest.name}
          close={() => {
            if (!busy) {
              setRemoveTarget(undefined)
              setSelected(undefined)
            }
          }}
        >
          <div className={styles.details}>
            <div className={styles.hero}>
              <Avatar expert={selected.manifest} />
              <div>
                <CapabilityIdentity name={selected.manifest.name} version={t('versionPrefix') + selected.manifest.version} />
                {selected.workbench && <p>{t('fromWorkbench')} · {selected.workbench.name}</p>}
                <div className={styles.heroActions}>
                  <Button variant="primary" disabled={busy || !!(selected.workbench && !loading && !items.some(item => item.manifest.id === selected.manifest.id))} aria-busy={summoningId === selected.manifest.id} onClick={() =>{  summon(selected) }}>
                    {t(summoningId === selected.manifest.id ? 'summoning' : 'use')}
                  </Button>
                </div>
              </div>
            </div>
            <p>{selected.manifest.description}</p>
            {!!selected.manifest.tags.length && (
              <div className={styles.tags}>
                {selected.manifest.tags.map((tag, i) => (
                  <span key={i}>{tag}</span>
                ))}
              </div>
            )}
            {selected.manifest.conversationStarters.length > 0 && (
              <>
                <h3>{t('preview')}</h3>
                <div className={styles.starters}>
                  {selected.manifest.conversationStarters.map((text, i) => (
                    <Button key={i} disabled={busy} onClick={() =>{  summon(selected, text) }}>
                      {text}
                      <span aria-hidden="true">↗</span>
                    </Button>
                  ))}
                </div>
              </>
            )}
            {error && (
              <p role="alert" className={styles.notice}>
                {error}
              </p>
            )}
          </div>
        </Dialog>
      )}
      {packagePlan && (
        <PackagePreview
          t={t}
          plan={packagePlan}
          close={() => {
            void req('package-discard', { token: packagePlan.token }).catch(() => {})
            setPackagePlan(undefined)
          }}
          done={() => {
            setPackagePlan(undefined)
            setSource('local')
            setCategory('all')
            setQ('')
            setPage(1)
            setRevision(r => r + 1)
            notify(t(packagePlan.operation === 'update' ? 'packageUpdated' : 'packageImported'), 'success')
          }}
        />
      )}
      {importing && (
        <CapabilityBindings
          t={t}
          manifest={importing}
          close={() =>{  setImporting(undefined) }}
          done={() => {
            setImporting(undefined)
            setSource('local')
            setCategory('all')
            setQ('')
            setPage(1)
            setRevision(r => r + 1)
            notify(t('importSuccess'), 'success')
          }}
        />
      )}
      <ConfirmDialog closeLabel={t('close')} open={!!removeTarget} title={t('removeTitle')} description={t('removeHelp')}
        resourceName={removeTarget?.manifest.name ?? ''} cancelLabel={t('cancel')}
        confirmLabel={t(busy ? 'busy' : 'remove')} pending={busy}
        onCancel={() =>{  setRemoveTarget(undefined) }} onConfirm={removeSelected} />
    </section>
  )
}
export const inject = [
  'slots',
  'locale',
  'sessions',
  'layout',
  'conversation',
  'commandUi',
  'capabilityHub',
  'workspaces',
  'uiWorkspace',
  'remote',
  'remote.actveroWorkbench',
  'actveroWorkbenches',
]
export function apply(ctx: Context) {
  const sessions = ctx.sessions
  ctx.effect(() => ctx.locale.register('actvero.experts', { zh, en }))
  const loaders = new Set<() => void>()
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const fn of listeners) fn()
    for (const load of loaders) load()
  }
  ctx.effect(() => window.actveroExperts?.subscribe(publish) ?? (() => {}))
  ctx.effect(() => sessions.list.subscribe(() => { for (const load of loaders) load() }))
  const workspaces = ctx.workspaces
  let pendingPreparation: PreparationRequest | undefined
  const preparationListeners = new Set<() => void>()
  const notifyPreparation = () => {
    for (const fn of preparationListeners) fn()
  }
  const prepareRemote = (plan: RemotePlan) =>
    new Promise<RemotePlan | undefined>((resolve) => {
      pendingPreparation?.finish()
      const request: PreparationRequest = {
        plan,
        finish: (ready) => {
          if (pendingPreparation !== request) return
          pendingPreparation = undefined
          notifyPreparation()
          resolve(ready)
        },
      }
      pendingPreparation = request
      notifyPreparation()
    })
  ctx.effect(() => () => pendingPreparation?.finish())
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'actvero-expert-preparation',
        locale: 'actvero.experts',
        inject: () => ({
          hooks: {
            request: {
              subscribe: (fn: () => void) => {
                preparationListeners.add(fn)
                return () => {
                  preparationListeners.delete(fn)
                }
              },
              getSnapshot: () => pendingPreparation,
            },
          },
          manage: () =>{  ctx.capabilityHub.open('connectors') },
        }),
      },
      PreparationOverlay,
    ),
  )
  const workspaceForSession = (sessionId?: string) =>
    sessionId
      ? workspaces.list.getSnapshot().items.find(w => w.sessionIds.includes(sessionId as SessionId))?.workspaceId
      : undefined
  const useExpert = async (
    id: string | null,
    sessionId?: string,
    text?: string,
  ) => {
    if (id?.startsWith('workbench:')) {
      const target = await ctx.actveroWorkbenches.summonExpert(id.slice('workbench:'.length), sessionId as SessionId | undefined)
      ctx.uiWorkspace.openSession(target)
      publish()
      return
    }
    if (id === null && sessionId && sessions.list.getSnapshot().byId[sessionId as SessionId]?.projectionValues?.actveroWorkbench) {
      const result = await ctx.remote.actveroWorkbench.detach({ sessionId: sessionId as SessionId })
      if (!result.ok) throw result.error
      await sessions.refresh()
      publish()
      return
    }
    const workspaceId = workspaceForSession(sessionId)
    let releaseProof: string | undefined
    if (id?.startsWith('remote-')) {
      const plan = await req<RemotePlan>('remote-plan', { id })
      const confirmed = plan.previousVersion || plan.dependencies.some(d => d.required && d.action !== 'none')
        ? await prepareRemote(plan)
        : plan
      if (!confirmed) return
      releaseProof = confirmed.releaseProof
    }
    const result = await req<{ sessionId: SessionId }>('select', { id, sessionId,
      ...(workspaceId ? { workspaceId } : {}), ...(releaseProof ? { releaseProof } : {}) })
    await sessions.refresh()
    ctx.uiWorkspace.openSession(result.sessionId)
    publish()
    if (text) {
      const scope = sessions.scope(result.sessionId)
      if (!scope) throw new Error('expert_session_missing')
      const { draft, draftRev, occurrences } = ctx.conversation.input.for(scope).state.getSnapshot()
      const end = draft.length - occurrences.reduce((sum, item) => sum + item.length - 1, 0)
      if (!scope.bail(scope, 'slash/input-insert-text', { text, span: { start: end, end, draftRev } })) {
        throw new Error('draft_busy')
      }
    }
  }
  const contributionListeners = new Set<() => void>()
  const watchContributed = (listener: () => void) => {
    contributionListeners.add(listener)
    return () => { contributionListeners.delete(listener) }
  }
  ctx.effect(() => {
    const abort = new AbortController()
    const watching = (async () => {
      let previous: string | undefined
      for await (const catalog of ctx.remote.actveroWorkbench.followExperts(abort.signal)) {
        const next = JSON.stringify(catalog)
        if (next === previous) continue
        previous = next
        for (const listener of contributionListeners) listener()
        publish()
      }
    })().catch((error: unknown) => {
      if (!abort.signal.aborted) ctx.logger.warn('Workbench expert catalog is unavailable: %s', error)
    })
    return async () => { abort.abort(); await watching }
  })
  const loadContributed = async (): Promise<Expert[]> => {
    const result = await ctx.remote.actveroWorkbench.experts()
    if (!result.ok) { ctx.logger.warn('Workbench expert catalog query failed: %s', result.error); throw result.error }
    return result.value.map(entry => ({
      manifest: { schemaVersion: 1, id: 'workbench:' + entry.id, name: entry.name, version: entry.version,
        description: entry.description, avatar: entry.avatar, category: 'general', tags: [], instructions: '',
        conversationStarters: [], skills: [], connectors: [] },
      bindings: { skills: {}, connectors: {} }, revision: 0, workbench: { id: entry.id, name: entry.workbenchName },
    }))
  }
  const catalogExperts = async (action: 'list' | 'recent'): Promise<Expert[]> => {
    const [ordinary, contributed] = await Promise.allSettled([req<Expert[]>(action), loadContributed()])
    if (contributed.status === 'rejected') ctx.logger.warn('Workbench expert catalog unavailable: %s', contributed.reason)
    if (ordinary.status === 'rejected' && contributed.status === 'rejected') throw ordinary.reason
    if (ordinary.status === 'rejected' || contributed.status === 'rejected') ctx.capabilityHub.notify(ctx.locale.bind('actvero.experts')('partialCatalog'))
    return [...(ordinary.status === 'fulfilled' ? ordinary.value : []), ...(contributed.status === 'fulfilled' ? contributed.value : [])]
  }
  const currentSelection = async (sessionId: string): Promise<ExpertSelection | null> => {
    const binding = sessions.list.getSnapshot().byId[sessionId as SessionId]?.projectionValues?.actveroWorkbench
    if (binding) return { snapshotId: binding.instanceId, id: 'workbench:' + binding.id,
      name: binding.expert?.name ?? binding.name, version: binding.expert?.version ?? binding.version, avatar: '' }
    return window.actveroExperts ? req<ExpertSelection | null>('selection', { sessionId }) : null
  }
  ctx.slots.inject('actvero.capability.content', () =>
    ctx.slots.register(
      {
        name: 'actvero.capability.content',
        key: 'experts',
        locale: 'actvero.experts',
        inject: () => ({
          loadLocalExperts: () => catalogExperts('list'),
          watchContributed,
          ctxResources: async () => {
            try {
              const result = await ctx.remote.actveroWorkbench.developmentResources()
              if (!result.ok) throw result.error
              return ctx.locale.bind('actvero.experts')('creatorResources', { skillPath: result.value.expertSkillPath ?? '', connectionPath: result.value.connectionPath ?? '' })
            } catch (error) { ctx.logger.warn('Unable to export expert creation resources: %s', error); throw error }
          },
          createWithAI: async (text: string) => {
            await prepareCreation(ctx, { name: creatorSkillName }, text,
              Object.values(sessions.list.getSnapshot().byId).find(s => (s.retainedBy.mainView ?? 0) > 0)?.id)
          },
          useExpert: (id: string, text?: string) =>
            useExpert(
              id,
              Object.values(sessions.list.getSnapshot().byId).find(s => (s.retainedBy.mainView ?? 0) > 0)?.id,
              text,
            ),
        }),
      },
      Panel,
    ),
  )
  const t = ctx.locale.bind('actvero.experts')
  const expertPopup: PopupSelectSpec = {
    kind: 'popupSelect',
    searchLabels: () => ({ placeholder: t('search'), empty: t('noRecent'), noResults: t('noResults') }),
    options: async (session, signal) => {
      const [recent, current] = await Promise.all([
        catalogExperts('recent'),
        currentSelection(session.sessionId),
      ])
      signal.throwIfAborted()
      return expertOptions(recent, current, t)
    },
    onSelect: async (option, session) => {
      try {
        await useExpert(option.id, session.sessionId)
      } catch (error) {
        throw new Error(errorText(error, t))
      }
    },
  }
  // The badge picker keeps a stop action when the toolbar hides the inline control.
  const stopOption = ':stop-expert'
  const badgePopup: PopupSelectSpec = {
    ...expertPopup,
    options: async (session, signal) => [
      ...await expertPopup.options(session, signal),
      { id: stopOption, label: t('cancelExpert'), icon: IconCloseOutlineMedium },
    ],
    onSelect: async (option, session) => {
      if (option.id !== stopOption) return expertPopup.onSelect(option, session)
      try {
        await useExpert(null, session.sessionId)
      } catch (error) {
        throw new Error(errorText(error, t))
      }
    },
  }
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.left',
        id: 'actvero-selected-expert',
        locale: 'actvero.experts',
        inject: (sessionId) => {
          const scope = sessions.scope(sessionId)
          if (!scope) throw new Error('expert_session_missing')
          const input = ctx.conversation.input.for(scope),
            popup = ctx.commandUi.popupFor(scope)
          let choice: ExpertSelection | null = null,
            flight: Promise<void> | undefined,
            live = true
          const changed = new Set<() => void>()
          const load = () => {
            if (flight) return flight
            flight = currentSelection(sessionId)
              .then(async (value) => {
                if (!live) return
                choice = value
                if (value && !value.avatar) {
                  try {
                    const expert = await req<Expert>('get', { id: value.id })
                    if (!live) return
                    if (expert.manifest.version === value.version)
                      choice = { ...value, avatar: normalizeExpertSelectionAvatar(expert.manifest.avatar) }
                  } catch { /* The saved selection remains usable when its source is unavailable. */ }
                }
                for (const fn of changed) fn()
              })
              .catch(() => {})
              .finally(() => {
                flight = undefined
              })
            return flight
          }
          return {
            hooks: {
              choice: {
                subscribe: (fn: () => void) => {
                  live = true
                  changed.add(fn)
                  loaders.add(load)
                  return () => {
                    changed.delete(fn)
                    if (!changed.size) {
                      live = false
                      loaders.delete(load)
                    }
                  }
                },
                getSnapshot: () => choice,
              },
              locked: {
                subscribe: input.state.subscribe,
                getSnapshot: () => ['adjudicating', 'submitting'].includes(input.state.getSnapshot().phase),
              },
              expanded: {
                subscribe: popup.state.subscribe,
                getSnapshot: () => popup.state.getSnapshot().open && popup.state.getSnapshot().command === 'expert',
              },
            },
            load,
            // A badge opens the same resident native picker with an empty span; it consumes no draft text.
            open: () =>{
              popup.open(
                'expert',
                badgePopup,
                { sessionId },
                { via: 'menu', span: { start: 0, end: 0, draftRev: input.state.getSnapshot().draftRev } },
              ) },
            clear: () => useExpert(null, sessionId),
            failed: () =>{  ctx.capabilityHub.notify(t('failed')) },
          }
        },
      },
      ExpertBadge,
    ),
  )
  ctx.effect(() =>
    ctx.commandUi.register({
      name: 'expert',
      section: 'add',
      label: () => t('selector'),
      description: () => t('expertHelp'),
      icon: IconAgentPresetOutlineMedium,
      available: () => true,
      ui: expertPopup,
    }),
  )
}
