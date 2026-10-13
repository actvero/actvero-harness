import { SourceTabs } from '@actvero/dsh-capability-ui/client/sources'
import { nativeSkills, insertSkill, type NativeSkill } from '@actvero/dsh-capability-ui/client/selection'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { zh, en } from './locales.ts'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { CatalogSkeleton, DetailLoading } from '@actvero/dsh-capability-ui/client/loading'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ImportSkill } from './import.tsx'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@actvero/dsh-capability-ui/client/contracts'
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Input,
  Modal,
  Menu,
  Switch,
  IconSkillOutlineMedium,
  IconPlusOutlineMedium,
  IconCheckOutlineMedium,
  IconSearchOutlineMedium,
  IconCloseOutlineMedium,
  IconDownloadOutlineMedium,
  IconNewChatOutlineMedium,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Catalog, Category, Skill, SkillDetail, LocalState } from '../contracts.ts'
import styles from './skills.module.css'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'actvero.skills': keyof typeof zh
  }
}
type T = (key: keyof typeof zh) => string

interface CardMenuProps {
  label: string
  items: readonly MenuEntry[]
  onSelect: (id: string) => void
  disabled?: boolean
  className?: string
}
function CardMenu({ label, items, onSelect, disabled = false, className }: CardMenuProps) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      className={className}
      open={open}
      align="end"
      dense
      portal
      onClose={() => setOpen(false)}
      items={items}
      onSelect={(id) => {
        setOpen(false)
        onSelect(id)
      }}
      anchor={
        <Button
          className={styles.moreButton}
          disabled={disabled}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >
          <span aria-hidden="true" className={styles.cardMenuGlyph}>
            ···
          </span>
        </Button>
      }
    />
  )
}

const request = async <T,>(action: string, input: Record<string, unknown> = {}): Promise<T> => {
  if (!window.actveroSkills) throw new Error('skills_unavailable')
  return (await window.actveroSkills.request(action, input)) as T
}
function errorText(error: unknown, t: T) {
  const code = error instanceof Error ? error.message : ''
  return t(
    (
      {
        skills_unavailable: 'notEnabled',
        account_changed: 'login',
        reauthentication_required: 'login',
        skill_unavailable: 'unavailable',
        skill_version_changed: 'changed',
        package_checksum_mismatch: 'checksum',
        skill_name_conflict: 'conflict',
        local_changes: 'localChanges',
        unsafe_package: 'unsafe',
        invalid_skill: 'unsafe',
        skill_registration_failed: 'host',
        skills_host_timeout: 'host',
        workspace_required: 'workspace',
      } as Record<string, keyof typeof zh>
    )[code] ?? 'failed',
  )
}
function Avatar({ item, large = false }: { item: Skill; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [item.icon?.image])
  return (
    <span className={large ? styles.largeIcon : styles.icon}>
      {!failed && /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.icon?.image ?? '') ? (
        <img src={item.icon.image} alt="" onError={() => setFailed(true)} />
      ) : (
        <IconSkillOutlineMedium size={large ? 32 : 20} />
      )}
    </span>
  )
}
function Panel({
  t,
  useSkill,
  useSessions,
  listNative,
  useNative,
  previewNative,
  notify,
}: PropsRuntime<'actvero.capability.content'> &
  PropsLocale<'actvero.skills'> & {
    useSkill: (item: Skill) => Promise<void>
    listNative: (id: SessionId, signal: AbortSignal) => Promise<readonly NativeSkill[]>
    useNative: (skill: NativeSkill) => Promise<void>
    previewNative: (skill: NativeSkill) => void
  }) {
  const sessionId = useSessions(state => Object.values(state.byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)?.id)
  const [directory, setDirectory] = useState<readonly NativeSkill[]>([]),
    [directoryLoading, setDirectoryLoading] = useState(false),
    [directoryError, setDirectoryError] = useState(''),
    [selectedDirectory, setSelectedDirectory] = useState<NativeSkill>()
  const [mode, setMode] = useState<'catalog' | 'installed'>('catalog'),
    [q, setQ] = useState(''),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [page, setPage] = useState(1)
  const [catalog, setCatalog] = useState<Catalog>(),
    [categories, setCategories] = useState<Category[]>([]),
    [local, setLocal] = useState<LocalState>({ available: false, items: [], busy: [], checkFailed: false })
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<SkillDetail>(),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [confirm, setConfirm] = useState(false),
    [working, setWorking] = useState(false)
  const identityScope = useRef<string | undefined>(undefined),
    toolbar = useRef<HTMLElement>(null)
  const detailEpoch = useRef(0),
    trigger = useRef<HTMLElement | null>(null),
    mounted = useRef(true)
  const close = () => {
    detailEpoch.current++
    setSelected(undefined)
    setSelectedDirectory(undefined)
    setDetailLoading(false)
    setDetailError('')
    setConfirm(false)
    trigger.current?.focus()
  }
  useEffect(() => {
    mounted.current = true
    let disposed = false,
      seq = 0
    const load = () => {
      const stamp = ++seq
      void request<LocalState>('state')
        .then((state) => {
          if (!disposed && stamp === seq) {
            if (identityScope.current !== state.scope) {
              identityScope.current = state.scope
              setCatalog(undefined)
              setCategories([])
              close()
              setRevision(v => v + 1)
            }
            setLocal(state)
            if (!state.available) {
              setCatalog(undefined)
              setCategories([])
            }
          }
        })
        .catch((e) => {
          if (!disposed && stamp === seq) setError(errorText(e, t))
        })
    }
    load()
    const off = window.actveroSkills?.subscribe(load)
    return () => {
      mounted.current = false
      disposed = true
      detailEpoch.current++
      off?.()
    }
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(q.trim())
      setPage(1)
    }, 180)
    return () => clearTimeout(timer)
  }, [q])
  useEffect(() => {
    if (mode === 'installed') {
      setLoading(false)
      setError('')
      return
    }
    let active = true
    setLoading(true)
    setError('')
    Promise.all([
      request<Catalog>('catalog', { q: query, category, page }),
      request<Category[]>('categories', { q: query }),
    ])
      .then(([data, groups]) => {
        if (active) {
          setCatalog(data)
          setCategories(groups)
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e, t))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [query, category, page, revision, mode])
  useEffect(() => {
    void request('check').catch(() => {})
  }, [mode, revision])
  useEffect(() => {
    if (mode !== 'installed') {
      setDirectoryLoading(false)
      return
    }
    if (!sessionId) {
      setDirectoryLoading(false)
      setDirectory([])
      setDirectoryError(t('workspace'))
      return
    }
    const abort = new AbortController()
    setDirectoryLoading(true)
    setDirectoryError('')
    void listNative(sessionId, abort.signal)
      .then((rows) => {
        if (!abort.signal.aborted) setDirectory(rows)
      })
      .catch(() => {
        if (!abort.signal.aborted) setDirectoryError(t('directoryFailed'))
      })
      .finally(() => {
        if (!abort.signal.aborted) setDirectoryLoading(false)
      })
    return () => abort.abort()
  }, [mode, sessionId, revision])
  const discovered = directory.filter(skill => !local.items.some(row => row.skill.name === skill.name))
  const directoryRows =
    mode === 'installed'
      ? discovered.filter(skill =>
        `${skill.name} ${skill.description} ${skill.path ?? ''}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      )
      : []
  const installed = local.items.find(r => r.skill.id === selected?.id)
  const list =
    mode === 'catalog'
      ? (catalog?.items ?? [])
      : local.items
        .filter(r =>
          `${r.skill.display_name} ${r.skill.name} ${r.skill.description}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
        )
        .sort((a, b) => Number(b.skill.source === 'local') - Number(a.skill.source === 'local'))
        .map(r => r.skill)
  const clear = useCallback(() => {
    setQ('')
    setQuery('')
    setCategory('')
    setPage(1)
  }, [])
  const returnToCatalog = useCallback(() => {
    setMode('catalog')
    clear()
    requestAnimationFrame(() => toolbar.current?.querySelector<HTMLInputElement>('input')?.focus())
  }, [clear])
  const choose = async (item: Skill) => {
    trigger.current = document.activeElement as HTMLElement
    const epoch = ++detailEpoch.current
    setSelected(undefined)
    setDetailLoading(true)
    setDetailError('')
    setConfirm(false)
    try {
      const detail = await request<SkillDetail>('detail', { id: item.id })
      if (epoch === detailEpoch.current) setSelected(detail)
    } catch (e) {
      if (epoch === detailEpoch.current) {
        if (local.items.some(r => r.skill.id === item.id))
          setSelected({ ...item, entrypoint: '', skill_md: '', files: [] })
        setDetailError(errorText(e, t))
      }
    } finally {
      if (epoch === detailEpoch.current) setDetailLoading(false)
    }
  }
  const install = async (item: Skill) => {
    if (working) return
    setWorking(true)
    setDetailError('')
    setError('')
    try {
      await request('install', {
        id: item.id,
        version_id: item.current_version.id,
        sha256: item.current_version.sha256,
      })
      if (mounted.current)
        notify(t(local.items.some(r => r.skill.id === item.id) ? 'updateDone' : 'installDone'), 'success')
    } catch (e) {
      if (mounted.current) {
        notify(errorText(e, t))
        if (selected) setDetailError(errorText(e, t))
      }
    } finally {
      if (mounted.current) setWorking(false)
    }
  }
  const toggle = async (id: string, enabled: boolean) => {
    try {
      await request('enable', { id, enabled })
    } catch (e) {
      notify(errorText(e, t))
    }
  }
  const remove = async () => {
    if (!selected) return
    setWorking(true)
    try {
      await request('uninstall', { id: selected.id })
      notify(t('removeDone'), 'success')
      close()
    } catch (e) {
      notify(errorText(e, t))
    } finally {
      setWorking(false)
    }
  }
  const use = async () => {
    if (!selected) return
    try {
      await useSkill(selected)
      close()
    } catch (e) {
      setDetailError(errorText(e, t))
    }
  }
  const skillMenu = (record: LocalState['items'][number] | undefined): readonly MenuEntry[] =>
    record
      ? [
        { id: 'view', label: t('view') },
        { type: 'separator', id: 'skill-menu-separator' as const },
        { id: 'remove', label: t('remove'), danger: true },
      ]
      : ([{ id: 'view', label: t('view') }] as const)
  const selectSkillMenu = (item: Skill, id: string) => {
    if (id === 'view') {
      void choose(item)
      return
    }
    if (id === 'remove') {
      void choose(item).then(() => setConfirm(true))
    }
  }
  return (
    <section className={styles.page}>
      <header ref={toolbar} className={styles.header}>
        <Input
          icon={<IconSearchOutlineMedium />}
          className={styles.search}
          maxLength={100}
          placeholder={t(mode === 'installed' ? 'searchInstalled' : 'search')}
          aria-label={t(mode === 'installed' ? 'searchInstalled' : 'search')}
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        {mode === 'installed' && (
          <Button variant="outline" onClick={() => setRevision(v => v + 1)}>
            {t('refresh')}
          </Button>
        )}
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <IconPlusOutlineMedium />
          {t('addLocal')}
        </Button>
      </header>
      <div className={styles.content}>
        <SourceTabs
          value={mode === 'catalog' ? 'platform' : 'local'}
          platformLabel={t('platformTab')}
          localLabel={t('localTab')}
          count={mode === 'catalog' ? catalog?.total : local.items.length + discovered.length}
          onChange={(source) => {
            setMode(source === 'platform' ? 'catalog' : 'installed')
            clear()
          }}
        />
        {mode === 'installed' && <p className={styles.hint}>{t('directoryHelp')}</p>}
        {directoryError && mode === 'installed' && (
          <div className={styles.notice} role="alert">
            {directoryError}
            {sessionId && <Button onClick={() => setRevision(v => v + 1)}>{t('retry')}</Button>}
          </div>
        )}
        {mode === 'catalog' ? (
          <nav className={styles.categories} aria-label={t('allSkills')}>
            <Button
              variant="ghost"
              aria-pressed={!category}
              onClick={() => {
                setCategory('')
                setPage(1)
              }}
            >
              {t('all')}
            </Button>
            {categories
              .filter(c => c.count > 0 || c.id === category)
              .map(c => (
                <Button
                  variant="ghost"
                  key={c.id}
                  aria-pressed={category === c.id}
                  onClick={() => {
                    setCategory(c.id)
                    setPage(1)
                  }}
                >
                  {c.name}
                </Button>
              ))}
          </nav>
        ) : null}
        {error && (
          <div role="alert" className={styles.notice}>
            {error}
            <Button onClick={() => setRevision(v => v + 1)}>{t('retry')}</Button>
          </div>
        )}
        {local.checkFailed && (
          <p role="status" className={styles.hint}>
            {t('checkFailed')}
          </p>
        )}

        {loading || (mode === 'installed' && directoryLoading) ? (
          <CatalogSkeleton label={t('loading')} />
        ) : list.length || directoryRows.length ? (
          <div className={styles.grid} aria-busy={loading}>
            {list.map((item, index) => {
              const record = local.items.find(r => r.skill.id === item.id),
                busy = local.busy.includes(item.id) || working
              return (
                <div key={item.id} style={{ display: 'contents' }}>
                  {mode === 'installed' && (index === 0 || item.source !== list[index - 1].source) && (
                    <h3 style={{ gridColumn: '1 / -1', margin: '8px 0 0', fontSize: 14, fontWeight: 500 }}>
                      {t(item.source === 'local' ? 'localGroup' : 'platform')}
                    </h3>
                  )}
                  <article className={styles.card}>
                    <Button className={styles.cardBody} onClick={() => void choose(item)}>
                      <span className={styles.cardHeading}>
                        <Avatar item={item} />
                        <strong title={item.display_name}>{item.display_name || item.name}</strong>
                      </span>
                      <span className={styles.description}>{item.description}</span>
                      <span className={styles.cardFoot}>
                        <span>{item.category.name}</span>
                        {record && (
                          <span className={record.status === 'update_available' ? styles.update : styles.status}>
                            {t(
                              record.status === 'unavailable'
                                ? 'unavailable'
                                : record.status === 'update_available'
                                  ? 'updateAvailable'
                                  : record.enabled
                                    ? 'installedState'
                                    : 'disabled',
                            )}
                          </span>
                        )}
                      </span>
                    </Button>
                    <CardMenu
                      className={styles.more}
                      label={`${t('view')} ${item.display_name}`}
                      disabled={busy}
                      items={skillMenu(record)}
                      onSelect={id => selectSkillMenu(item, id)}
                    />
                    {mode === 'installed' && record ? (
                      <div className={styles.cardAction}>
                        <Switch
                          checked={record.enabled && record.status !== 'unavailable'}
                          disabled={busy || record.status === 'unavailable'}
                          label={`${t(record.enabled ? 'off' : 'enabled')} ${item.display_name}`}
                          onChange={value => void toggle(item.id, value)}
                          className={styles.switch}
                        />
                      </div>
                    ) : (
                      <Button
                        className={styles.cardAction}
                        title={t(record ? 'installedState' : 'install')}
                        aria-label={`${t(record ? 'installedState' : 'install')} ${item.display_name}`}
                        disabled={busy}
                        onClick={() => void choose(item)}
                      >
                        {record ? <IconCheckOutlineMedium /> : <IconPlusOutlineMedium />}
                      </Button>
                    )}
                  </article>
                </div>
              )
            })}
            {directoryRows.length > 0 && <h3 className={styles.groupHeading}>{t('directoryGroup')}</h3>}
            {directoryRows.map(skill => (
              <article className={styles.card} key={`directory:${skill.name}`}>
                <Button
                  className={styles.cardBody}
                  onClick={() => {
                    trigger.current = document.activeElement as HTMLElement
                    setSelectedDirectory(skill)
                  }}
                >
                  <span className={styles.cardHeading}>
                    <span className={styles.icon}>
                      <IconSkillOutlineMedium size={20} />
                    </span>
                    <strong>{skill.name}</strong>
                  </span>
                  <span className={styles.description}>{skill.description}</span>
                  <span className={styles.directoryPath} title={skill.path}>
                    {skill.path ?? t('builtIn')}
                  </span>
                </Button>
                <CardMenu
                  className={styles.more}
                  label={`${t('view')} ${skill.name}`}
                  items={[
                    { id: 'view', label: t('view') },
                    { id: 'use', label: t('use') },
                  ]}
                  onSelect={id =>
                    id === 'view'
                      ? setSelectedDirectory(skill)
                      : void useNative(skill).catch(e => notify(errorText(e, t)))
                  }
                />
                <Button
                  className={styles.cardAction}
                  title={t('use')}
                  aria-label={`${t('use')} ${skill.name}`}
                  onClick={() => void useNative(skill).catch(e => notify(errorText(e, t)))}
                >
                  <IconNewChatOutlineMedium />
                </Button>
              </article>
            ))}
          </div>
        ) : (
          !error && (
            <div className={styles.empty}>
              <IconSkillOutlineMedium size={32} />
              <h2>{t(query || category ? 'noResults' : mode === 'installed' ? 'emptyInstalled' : 'empty')}</h2>
              <p>{t(mode === 'installed' ? 'browse' : 'emptyHelp')}</p>
              {query || category ? (
                <Button onClick={clear}>{t('clear')}</Button>
              ) : mode === 'installed' ? (
                <Button onClick={returnToCatalog}>{t('browse')}</Button>
              ) : null}
            </div>
          )
        )}
        {mode === 'catalog' && catalog && catalog.total > 20 && (
          <div className={styles.pagination}>
            <Button disabled={page === 1 || loading} onClick={() => setPage(v => v - 1)}>
              {t('previous')}
            </Button>
            <span>
              {page} / {Math.max(1, Math.ceil(catalog.total / 20))}
            </span>
            <Button disabled={page * 20 >= catalog.total || loading} onClick={() => setPage(v => v + 1)}>
              {t('next')}
            </Button>
          </div>
        )}
      </div>
      {importOpen && (
        <ImportSkill
          t={t}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            setImportOpen(false)
            notify(t('importSuccess'), 'success')
            setMode('installed')
            clear()
          }}
        />
      )}
      <Modal
        open={!!selected || !!selectedDirectory || detailLoading || !!detailError}
        onClose={close}
        title={selected?.display_name ?? selectedDirectory?.name ?? t('loading')}
        headless
        className={styles.modal}
      >
        <div
          className={styles.body}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return
            const nodes = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled),a[href],input,[tabindex="0"]',
              ),
            ].filter(n => n.getClientRects().length)
            const first = nodes[0],
              last = nodes.at(-1)
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }}
        >
          <Button autoFocus className={styles.close} aria-label={t('close')} onClick={close}>
            <IconCloseOutlineMedium />
          </Button>
          {selectedDirectory && (
            <>
              <div className={styles.hero}>
                <span className={styles.largeIcon}>
                  <IconSkillOutlineMedium size={32} />
                </span>
                <div>
                  <h2>{selectedDirectory.name}</h2>
                  <div className={styles.actions}>
                    <Button
                      variant="primary"
                      onClick={() =>
                        void useNative(selectedDirectory)
                          .then(close)
                          .catch(e => setDetailError(errorText(e, t)))
                      }
                    >
                      <IconNewChatOutlineMedium />
                      {t('use')}
                    </Button>
                    {selectedDirectory.path && (
                      <Button onClick={() => previewNative(selectedDirectory)}>{t('previewFile')}</Button>
                    )}
                  </div>
                </div>
              </div>
              <p className={styles.detailDescription}>{selectedDirectory.description}</p>
              <p className={styles.directoryPath} title={selectedDirectory.path}>
                {selectedDirectory.path ?? t('builtIn')}
              </p>
              <p className={styles.hint}>{t('directoryHelp')}</p>
            </>
          )}
          {detailLoading ? (
            <DetailLoading label={t('loading')} />
          ) : (
            selected && (
              <>
                <div className={styles.hero}>
                  <Avatar item={selected} large />
                  <div>
                    <h2>{selected.display_name || selected.name}</h2>
                    {selected.current_version.version && (
                      <span className={styles.subtitle}>
                        {t('version')} {t('versionPrefix')}
                        {selected.current_version.version}
                      </span>
                    )}
                    <div className={styles.actions}>
                      {!installed ? (
                        <Button
                          variant="primary"
                          disabled={working || !selected.entrypoint}
                          onClick={() => void install(selected)}
                        >
                          <IconDownloadOutlineMedium />
                          {t(working ? 'installing' : 'install')}
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="primary"
                            disabled={working || !installed.enabled || installed.status === 'unavailable'}
                            onClick={() => void use()}
                          >
                            <IconNewChatOutlineMedium />
                            {t('use')}
                          </Button>
                          {installed.status === 'update_available' && (
                            <Button disabled={working || !selected.entrypoint} onClick={() => void install(selected)}>
                              <IconDownloadOutlineMedium />
                              {t(working ? 'installing' : 'update')}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <p className={styles.detailDescription}>{selected.description}</p>
                {installed && (
                  <div className={styles.installedBar}>
                    <span>
                      {installed.version.version
                        ? `${t('installedVersion')} ${t('versionPrefix')}${installed.version.version}`
                        : t('localGroup')}
                    </span>
                    <Switch
                      className={styles.switch}
                      checked={installed.enabled && installed.status !== 'unavailable'}
                      label={t(installed.enabled ? 'off' : 'enabled')}
                      disabled={working || local.busy.includes(selected.id) || installed.status === 'unavailable'}
                      onChange={value => void toggle(selected.id, value)}
                    />
                  </div>
                )}
                {confirm && (
                  <div className={styles.confirm}>
                    <strong>{t('confirmRemove')}</strong>
                    <p>{t('removeHelp')}</p>
                    <div>
                      <Button onClick={() => setConfirm(false)}>{t('cancel')}</Button>
                      <Button variant="primary" disabled={working} onClick={() => void remove()}>
                        {t(working ? 'busy' : 'remove')}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )
          )}
          {detailError && (
            <div className={styles.notice} role="alert">
              {detailError}
              {selected && <Button onClick={() => void choose(selected)}>{t('refresh')}</Button>}
            </div>
          )}
        </div>
      </Modal>
    </section>
  )
}
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Installed skill state changed; listeners may refresh their capability views.
     * @mode emit
     */
    'actvero/skills-changed'(): void
  }
}
export const inject = [
  'slots',
  'locale',
  'capabilityHub',
  'sessions',
  'conversation',
  'layout',
  'remote',
  'remote.skills',
  'sidebarRight',
]
export function apply(ctx: Context) {
  ctx.effect(() => window.actveroSkills?.subscribe(() => ctx.emit('actvero/skills-changed')) ?? (() => {}))
  ctx.effect(() => ctx.locale.register('actvero.skills', { zh, en }))
  ctx.slots.inject('actvero.capability.content', () =>
    ctx.slots.register(
      {
        name: 'actvero.capability.content',
        key: 'skills',
        locale: 'actvero.skills',
        inject: () => ({
          listNative: (id: SessionId, signal: AbortSignal) => nativeSkills(ctx, id, signal),
          previewNative: (skill: NativeSkill) => {
            const sessions = ctx.sessions as ISessions,
              rows = sessions.list.getSnapshot().byId,
              current = Object.values(rows).find(s => (s.retainedBy?.mainView ?? 0) > 0)
            if (current && skill.path) {
              ctx.layout.selectPanel(null)
              ctx.sidebarRight.openResource(fileAddressFor(current.id, current.cwd, skill.path))
            }
          },
          useNative: async (skill: NativeSkill) => {
            const sessions = ctx.sessions as ISessions,
              id = Object.values(sessions.list.getSnapshot().byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)?.id
            if (!id) throw new Error('workspace_required')
            const entry = (await nativeSkills(ctx, id)).find(row => row.name === skill.name)
            if (!entry) throw new Error('skill_unavailable')
            insertSkill(ctx, id, entry)
          },
          useSkill: async (item: Skill) => {
            const sessions = ctx.sessions as ISessions,
              id = Object.values(sessions.list.getSnapshot().byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)?.id
            if (!id) throw new Error('workspace_required')
            const state = await request<LocalState>('state'),
              installed = state.items.find(r => r.skill.id === item.id)
            if (!installed?.enabled || installed.status === 'unavailable') throw new Error('skill_unavailable')
            if (!(await nativeSkills(ctx, id)).some(row => row.name === item.name))
              throw new Error('skill_unavailable')
            insertSkill(ctx, id, item)
          },
        }),
      },
      Panel,
    ),
  )
}
