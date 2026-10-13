import { SourceTabs } from '@actvero/dsh-capability-ui/client/sources'
import type { CustomView } from '../local-config.ts'
import { zh, en } from './locales.ts'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CatalogSkeleton } from '@actvero/dsh-capability-ui/client/loading'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { CustomMcp } from './custom.tsx'
import type {} from '@actvero/dsh-capability-ui/client/contracts'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { appendSpan } from './input-span.ts'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRenderSlots, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useState, useRef } from 'react'
import {
  Button,
  Switch,
  Input,
  Modal,
  IconLinkOutlineMedium,
  IconPlusOutlineMedium,
  IconNewChatOutlineMedium,
  IconSearchOutlineMedium,
  Menu,
  IconLightOutlineMedium,
  IconCloseOutlineMedium,
  StateDot,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Catalog, Connector, LocalView } from '../contracts.ts'
import styles from './connectors.module.css'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'actvero.connectors': keyof typeof zh
  }
}
const request = async <T,>(action: string, input: Record<string, unknown> = {}) => {
  const bridge = window.actveroConnectors
  if (!bridge) throw new Error('login_required')
  return (await bridge.request(action, input)) as T
}
function errorText(error: unknown, t: PropsLocale<'actvero.connectors'>['t']): string {
  const code = error instanceof Error ? error.message : ''
  return t(
    (
      {
        login_required: 'login',
        workspace_required: 'workspace',
        secure_storage_unavailable: 'cmStorageError',
        secure_storage_invalid: 'cmStorageInvalid',
      } as Record<string, keyof typeof zh>
    )[code] ?? 'retry',
  )
}
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
function ConnectorIcon({ item, large = false }: { item: Connector; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [item.icon])
  return (
    <span className={large ? styles.largeIcon : styles.icon}>
      {!failed && item.icon && /^data:image\/(png|jpeg|webp);base64,/.test(item.icon) ? (
        <img src={item.icon} alt="" onError={() => setFailed(true)} />
      ) : (
        <IconLinkOutlineMedium size={large ? 36 : 22} />
      )}
    </span>
  )
}
function Panel({
  renderSlot,
  t,
  useSessions,
  append,
  openConversation,
  ensureConversation,
}: PropsRuntime<'actvero.capability.content'> &
  PropsLocale<'actvero.connectors'> &
  PropsRenderSlots<'actvero.connector.brand.mark'> & {
    append: (sessionId: string, text: string) => void
    openConversation: () => void
    ensureConversation: () => Promise<string>
  }) {
  const [customOpen, setCustomOpen] = useState(false),
    [customItem, setCustomItem] = useState<CustomView>(),
    [source, setSource] = useState<'platform' | 'local'>('platform'),
    [customRows, setCustomRows] = useState<CustomView[]>([])
  const sessionId = useSessions(state => Object.values(state.byId).find(s => (s.retainedBy.mainView ?? 0) > 0)?.id)
  const dialogContent = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [data, setData] = useState<Catalog>(),
    [selected, setSelected] = useState<Connector>(),
    [local, setLocal] = useState<LocalView>({
      added: [],
      enabled: [],
      ready: [],
    }),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [values, setValues] = useState<Record<string, string>>({}),
    [attempt, setAttempt] = useState<string>()
  useEffect(() => {
    if (!selected) return
    const previous = document.activeElement as HTMLElement | null
    dialogContent.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [selected?.id])
  const operationEpoch = useRef(0)
  const activeAttempt = useRef<string>()
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (activeAttempt.current)
        void request('oauth', {
          id: activeAttempt.current,
          action: 'cancel',
        }).catch(() => {})
    }
  }, [])
  useEffect(() => window.actveroConnectors?.subscribe(() => setRevision(n => n + 1)), [])
  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    const timer = setTimeout(() => {
      void Promise.all([
        source === 'platform' ? request<Catalog>('catalog', { q, page }) : request<CustomView[]>('localList'),
        request<LocalView>('state', { sessionId }),
      ])
        .then(([catalog, state]) => {
          if (current) {
            if (source === 'platform') setData(catalog as Catalog)
            else setCustomRows(catalog as CustomView[])
            setLocal(state)
          }
        })
        .catch((e) => {
          if (current) {
            setError(errorText(e, t))
          }
        })
        .finally(() => {
          if (current) setLoading(false)
        })
    }, 180)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [q, page, revision, sessionId, source])
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await fn()
      const state = await request<LocalView>('state', { sessionId })
      if (alive.current) {
        setLocal(state)
        setRevision(n => n + 1)
      }
    } catch (e) {
      if (alive.current) setError(errorText(e, t))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const close = () => {
    operationEpoch.current++
    if (activeAttempt.current)
      void request('oauth', {
        id: activeAttempt.current,
        action: 'cancel',
      }).catch(() => {})
    activeAttempt.current = undefined
    setAttempt(undefined)
    setSelected(undefined)
    setValues({})
  }
  useEffect(() => {
    if (!attempt) return
    let stopped = false,
      polling = false
    const poll = async () => {
      if (polling || stopped) return
      polling = true
      try {
        const result = await request<{ status: string }>('oauth', {
          id: attempt,
          action: 'status',
        })
        if (stopped) return
        if (['awaiting_confirmation', 'completed'].includes(result.status)) {
          if (result.status !== 'completed') await request('oauth', { id: attempt, action: 'complete' })
          if (stopped) return
          activeAttempt.current = undefined
          setAttempt(undefined)
          if (selected)
            await run(async () => {
              await request('add', { id: selected.id })
              setSelected(await request('detail', { id: selected.id }))
            })
        } else if (['failed', 'expired', 'cancelled'].includes(result.status)) {
          setAttempt(undefined)
          activeAttempt.current = undefined
          setError(t('retry'))
        }
      } catch (error) {
        if (!stopped) setError(errorText(error, t))
      } finally {
        polling = false
      }
    }
    const timer = setInterval(() => void poll(), 2000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [attempt])
  const choose = async (item: Connector) => {
    const epoch = ++operationEpoch.current
    setValues({})
    setSelected(item)
    setError('')
    try {
      const detail = await request<Connector>('detail', { id: item.id })
      if (alive.current && operationEpoch.current === epoch) setSelected(detail)
    } catch (error) {
      if (operationEpoch.current === epoch) setError(errorText(error, t))
    }
  }
  const tryConnector = async (item: Connector) => {
    const target = await ensureConversation()
    await request('select', { id: item.id, sessionId: target, enabled: true })
    close()
    openConversation()
  }
  const insert = async (text: string) => {
    if (!selected) return
    const target = await ensureConversation()
    await request('select', { id: selected.id, sessionId: target, enabled: true })
    append(target, text)
    close()
  }
  return (
    <section className={styles.page}>
      {customOpen && <CustomMcp t={t} initialItem={customItem} startInForm onClose={() => setCustomOpen(false)} />}
      <header className={styles.header}>
        <div className={styles.searchTools}>
          <Input
            className={styles.search}
            icon={<IconSearchOutlineMedium />}
            aria-label={t('search')}
            placeholder={t('search')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
          <Button
            className={styles.customButton}
            variant="outline"
            onClick={() => {
              setCustomItem(undefined)
              setCustomOpen(true)
            }}
          >
            <IconPlusOutlineMedium />
            {t('customMcp')}
          </Button>
        </div>
      </header>
      <div className={styles.content}>
        <SourceTabs
          value={source}
          platformLabel={t('platformTab')}
          localLabel={t('localTab')}
          count={source === 'platform' ? data?.total : customRows.length}
          onChange={(value) => {
            setSource(value)
            setQ('')
            setPage(1)
          }}
        />
        {source === 'local' && <p className={styles.hint}>{t('localHelp')}</p>}
        {error && !selected && (
          <div role="alert" className={styles.notice}>
            <span>{error}</span>
            <Button onClick={() => setRevision(n => n + 1)}>{t('retryAction')}</Button>
          </div>
        )}
        {loading && <CatalogSkeleton label={t('loading')} />}
        <div className={styles.grid} hidden={loading || source !== 'platform'}>
          {data?.items.map((item) => {
            const added = local.added.includes(item.id)
            const ready = added && local.ready.includes(item.id) && item.connection.status === 'connected'
            return (
              <article className={styles.card} key={item.id}>
                <Button
                  className={styles.cardBody}
                  onClick={() => void choose(item)}
                  aria-label={`${t('details')} ${item.display_name}`}
                >
                  <span className={styles.cardHeading}>
                    <ConnectorIcon item={item} />
                    <strong>{item.display_name || item.name}</strong>
                    {added && (
                      <span
                        className={styles.connectionState}
                        role="img"
                        aria-label={ready ? t('ready') : t('needsAttention')}
                        title={ready ? t('ready') : t('needsAttention')}
                      >
                        <StateDot state={ready ? 'done' : 'warning'} size={8} />
                      </span>
                    )}
                  </span>
                  <span className={styles.description}>{item.description}</span>
                </Button>
                <CardMenu
                  className={styles.more}
                  label={`${t('details')} ${item.display_name}`}
                  disabled={busy}
                  items={
                    added
                      ? [
                        { id: 'view', label: t('details') },
                        { type: 'separator', id: 'platform-menu-separator' as const },
                        { id: 'remove', label: t('remove'), danger: true },
                      ]
                      : [{ id: 'view', label: t('details') }]
                  }
                  onSelect={(id) => {
                    if (id === 'view') void choose(item)
                    else void run(() => request('remove', { id: item.id }))
                  }}
                />
                <Button
                  className={added ? styles.tryAction : styles.addAction}
                  disabled={busy}
                  aria-label={`${added && ready ? t('try') : t('connect')} ${item.display_name}`}
                  title={added && ready ? t('try') : t('connect')}
                  onClick={() => (added && ready ? void run(() => tryConnector(item)) : void choose(item))}
                >
                  {added ? <IconNewChatOutlineMedium size={18} /> : <IconPlusOutlineMedium size={18} />}
                </Button>
              </article>
            )
          })}
        </div>
        {source === 'local' && !loading && (
          <div className={styles.grid}>
            {customRows
              .filter(row => row.name.toLocaleLowerCase().includes(q.toLocaleLowerCase()))
              .map(row => (
                <article className={styles.card} key={row.id}>
                  <Button
                    className={styles.cardBody}
                    aria-label={`${t('details')} ${row.name}`}
                    onClick={() => {
                      setCustomItem(row)
                      setCustomOpen(true)
                    }}
                  >
                    <span className={styles.cardHeading}>
                      <span className={styles.icon}>
                        <IconLinkOutlineMedium size={22} />
                      </span>
                      <strong>{row.name}</strong>
                    </span>
                    <span className={styles.description}>
                      {row.transport === 'stdio'
                        ? t('cmStdioProtocol')
                        : row.transport === 'sse'
                          ? t('cmSse')
                          : t('cmHttp')}
                    </span>
                    <span className={styles.localStatus}>
                      <StateDot
                        state={
                          row.status === 'connected'
                            ? 'done'
                            : row.status === 'connecting'
                              ? 'ongoing'
                              : row.status === 'disabled'
                                ? 'idle'
                                : 'warning'
                        }
                        size={8}
                      />
                      {t(
                        (
                          {
                            connected: 'cmConnected',
                            connecting: 'cmConnecting',
                            disabled: 'cmDisabled',
                            error: 'cmError',
                            authorization_required: 'cmAuthError',
                          } as const
                        )[row.status],
                      )}
                    </span>
                  </Button>
                  <CardMenu
                    className={styles.more}
                    label={`${t('cmEdit')} ${row.name}`}
                    disabled={busy}
                    items={[
                      { id: 'edit', label: t('cmEdit') },
                      { type: 'separator', id: 'local-menu-separator' as const },
                      { id: 'remove', label: t('cmRemove'), danger: true },
                    ]}
                    onSelect={(id) => {
                      if (id === 'edit') {
                        setCustomItem(row)
                        setCustomOpen(true)
                      } else
                        void run(() => request('localRemove', { id: row.id })).then(() => {
                          if (customItem?.id === row.id) {
                            setCustomItem(undefined)
                            setCustomOpen(false)
                          }
                        })
                    }}
                  />
                  <span className={styles.localSwitch}>
                    <Switch
                      checked={row.enabled}
                      disabled={busy}
                      label={`${t('cmToggle')} ${row.name}`}
                      onChange={enabled =>
                        void run(async () => {
                          await request('localEnable', { id: row.id, enabled })
                        })
                      }
                    />
                  </span>
                </article>
              ))}
          </div>
        )}
        {source === 'local' &&
          !loading &&
          !error &&
          !customRows.some(row => row.name.toLocaleLowerCase().includes(q.toLocaleLowerCase())) && (
          <div className={styles.empty}>
            <IconLinkOutlineMedium size={32} />
            <h2>{t(q ? 'noResults' : 'cmEmpty')}</h2>
            {!q && (
              <Button
                onClick={() => {
                  setCustomItem(undefined)
                  setCustomOpen(true)
                }}
              >
                <IconPlusOutlineMedium />
                {t('cmAdd')}
              </Button>
            )}
          </div>
        )}
        {!loading && source === 'platform' && !error && data?.total === 0 && (
          <div className={styles.empty}>
            <IconLinkOutlineMedium size={32} />
            <h2>{t('emptyTitle')}</h2>
            <p>{t('empty')}</p>
          </div>
        )}
        {source === 'platform' && (data?.total ?? 0) > (data?.page_size ?? 20) && (
          <footer className={styles.pagination}>
            <Button disabled={page === 1 || loading} onClick={() => setPage(n => n - 1)}>
              {t('previous')}
            </Button>
            <span>
              {page} / {Math.max(1, Math.ceil((data?.total ?? 0) / (data?.page_size ?? 20)))}
            </span>
            <Button
              disabled={!data || page * data.page_size >= data.total || loading}
              onClick={() => setPage(n => n + 1)}
            >
              {t('next')}
            </Button>
          </footer>
        )}
      </div>
      <Modal
        open={!!selected}
        onClose={close}
        title={selected?.display_name ?? t('title')}
        headless
        className={styles.modal}
      >
        {selected && (
          <div
            className={styles.body}
            ref={dialogContent}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return
              const nodes = [
                ...event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]',
                ),
              ].filter(node => node.getClientRects().length > 0)
              const first = nodes[0],
                last = nodes[nodes.length - 1]
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last?.focus()
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first?.focus()
              }
            }}
          >
            <Button className={styles.close} aria-label={t('close')} onClick={close}>
              <IconCloseOutlineMedium size={20} />
            </Button>
            <div className={styles.hero}>
              <div className={styles.connectionVisual} aria-hidden="true">
                <span className={styles.brandIcon}>
                  {renderSlot(
                    'actvero.connector.brand.mark',
                    { size: 48 },
                    { fallback: <IconLinkOutlineMedium size={48} /> },
                  )}
                </span>
                <span className={styles.linkDots}>
                  <i />
                  <i />
                  <i />
                </span>
                <ConnectorIcon item={selected} large />
              </div>
              <h2>
                {t('connect')} {selected.display_name}
              </h2>
              <p>{selected.description}</p>
            </div>
            {error && (
              <div className={styles.notice} role="alert">
                <p>{error}</p>
                {error === t('workspace') && (
                  <Button
                    onClick={() => {
                      close()
                      openConversation()
                    }}
                  >
                    {t('chooseWorkspace')}
                  </Button>
                )}
              </div>
            )}
            {attempt ? (
              <div className={styles.actions}>
                <p role="status">{t('waiting')}</p>
                <Button onClick={() => void run(() => request('oauth', { id: attempt, action: 'reopen' }))}>
                  {t('reopen')}
                </Button>
                <Button
                  onClick={() =>
                    void run(async () => {
                      await request('oauth', { id: attempt, action: 'cancel' })
                      activeAttempt.current = undefined
                      setAttempt(undefined)
                    })
                  }
                >
                  {t('cancel')}
                </Button>
              </div>
            ) : (
              <>
                {selected.auth_mode === 'personal' && selected.connection.action === 'configure' ? (
                  <form
                    className={styles.authForm}
                    onSubmit={(e) => {
                      e.preventDefault()
                      void run(async () => {
                        const epoch = operationEpoch.current
                        await request('credentials', {
                          id: selected.id,
                          values,
                        })
                        await request('add', { id: selected.id })
                        const detail = await request<Connector>('detail', { id: selected.id })
                        if (epoch === operationEpoch.current) {
                          setValues({})
                          setSelected(detail)
                        }
                      })
                    }}
                  >
                    {selected.credential_fields.map(field => (
                      <label className={styles.field} key={field.key}>
                        {field.label}
                        <Input
                          type="password"
                          autoComplete="off"
                          required
                          value={values[field.key] ?? ''}
                          onChange={e =>
                            setValues({
                              ...values,
                              [field.key]: e.target.value,
                            })
                          }
                        />
                      </label>
                    ))}
                    <Button type="submit" variant="primary" disabled={busy}>
                      {t('credentials')}
                    </Button>
                  </form>
                ) : selected.connection.action === 'contact_admin' ? (
                  <p>{t('admin')}</p>
                ) : selected.auth_mode === 'oauth' && selected.connection.action === 'authorize' ? (
                  <div className={styles.actions}>
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const epoch = operationEpoch.current
                          const result = await request<{ id: string }>('authorize', { id: selected.id })
                          if (!alive.current || epoch !== operationEpoch.current) {
                            await request('oauth', {
                              id: result.id,
                              action: 'cancel',
                            })
                            return
                          }
                          activeAttempt.current = result.id
                          setAttempt(result.id)
                        })
                      }
                    >
                      <IconLinkOutlineMedium />
                      {t('connect')}
                    </Button>
                  </div>
                ) : (
                  <div className={styles.actions}>
                    {local.added.includes(selected.id) ? (
                      <>
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() => void run(() => tryConnector(selected))}
                        >
                          <IconNewChatOutlineMedium />
                          {t('try')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const epoch = operationEpoch.current
                            await request('add', { id: selected.id })
                            const detail = await request<Connector>('detail', { id: selected.id })
                            if (epoch === operationEpoch.current) setSelected(detail)
                          })
                        }
                      >
                        <IconLinkOutlineMedium />
                        {t('connect')}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
            {selected.examples.length > 0 && (
              <>
                <h3 className={styles.sectionTitle}>
                  <IconLightOutlineMedium size={20} />
                  {t('examples')}
                </h3>
                <div className={styles.examples}>
                  {selected.examples.map((example, i) => (
                    <Button
                      key={i}
                      disabled={busy || !!attempt || !local.added.includes(selected.id)}
                      onClick={() => void run(() => insert(example))}
                    >
                      <span>{example}</span>
                      <IconNewChatOutlineMedium size={20} />
                    </Button>
                  ))}
                </div>
              </>
            )}
            {selected.examples.length === 0 && <p className={styles.exampleHint}>{t('noExamples')}</p>}
            {['personal', 'oauth'].includes(selected.auth_mode) && (
              <div className={styles.disconnect}>
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(t('confirm')))
                      void run(async () => {
                        await request('disconnect', { id: selected.id })
                        setSelected(await request('detail', { id: selected.id }))
                      })
                  }}
                >
                  {t('disconnect')}
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </section>
  )
}
export const inject = ['slots', 'locale', 'layout', 'sessions', 'conversation', 'capabilityHub']
export function apply(ctx: Context) {
  ctx.effect(() => ctx.locale.register('actvero.connectors', { zh, en }))
  ctx.slots.inject('actvero.capability.content', () =>
    ctx.slots.register(
      {
        name: 'actvero.capability.content',
        key: 'connectors',
        children: { 'actvero.connector.brand.mark': { kind: 'single', scope: 'root' } },
        locale: 'actvero.connectors',
        inject: () => ({
          ensureConversation: async () => {
            // Host and Client share the Cordis property name; use the public Client face here.
            const sessions = ctx.sessions as ISessions
            const state = sessions.list.getSnapshot()
            const id = Object.values(state.byId).find(s => (s.retainedBy.mainView ?? 0) > 0)?.id
            if (!id || !state.byId[id]?.cwd) throw new Error('workspace_required')
            return id
          },
          openConversation: () => ctx.layout.selectPanel(null),
          append: (sessionId: string, text: string) => {
            const scope = (ctx.sessions as ISessions).scope(sessionId as SessionId)
            if (!scope) throw new Error('session_unavailable')
            {
              const state = ctx.conversation.input.for(scope).state.getSnapshot()
              const applied = scope.bail(scope, 'slash/input-insert-text', {
                text: `\n${text}\n`,
                span: appendSpan(state),
              })
              if (!applied) throw new Error('draft_busy')
              ctx.layout.selectPanel(null)
            }
          },
        }),
      },
      Panel,
    ),
  )
}
