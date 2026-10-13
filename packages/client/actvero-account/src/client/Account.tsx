import { useEffect, useState } from 'react'
import { Button, Input, Menu, MenuItemButton, IconUserOutlineMedium, IconRightUpOutlineRegular, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountBridge, AccountSnapshot } from '../protocol.ts'
import { errorKey } from './locales.ts'
import css from './Account.module.css'
export interface Operations {
  bridge: AccountBridge
  hooks: { account: HostObservable<AccountSnapshot | null> }
}
type SectionProps = PropsRuntime<'settings.section'> & PropsLocale<'actvero.account'> & InjectFace<Operations>
type MenuProps = PropsRuntime<'settings.launcher'> & PropsLocale<'actvero.account'> & InjectFace<Operations>
function Usage({ account, t }: { account: AccountSnapshot; t: PropsLocale<'actvero.account'>['t'] }) {
  const quota = account.quota
  return (
    <div className={css.usage} aria-live="polite">
      {quota.phase === 'loading' && <p>{t('loading')}</p>}
      {quota.phase === 'unconfigured' && <p>{t('unconfigured')}</p>}
      {quota.phase === 'failed' && (
        <p role="status">
          {t('unavailable')} {quota.windows.length > 0 && t('stale')}
        </p>
      )}
      {quota.windows.map((window, index) => {
        const limit = Number(window.limit),
          remaining = Number(window.remaining)
        const percent = limit > 0 ? Math.min(100, Math.max(0, (remaining / limit) * 100)) : 0
        const name =
          window.name === 'calendar_week'
            ? t('weekly')
            : /^\d+$/.test(window.name)
              ? `${window.name} ${t('hours')}`
              : window.name
        return (
          <div className={css.window} key={`${index}:${name}`}>
            <div className={css.line}>
              <span>{name}</span>
              <span>
                {t('remaining')} {Math.floor(percent)}%
              </span>
            </div>
            <progress
              max={100}
              value={percent}
              aria-label={`${name}: ${t('remaining')} ${window.remaining} / ${window.limit} ${t('points')}`}
            />
            <div className={css.detail}>
              {window.remaining} / {window.limit} {t('points')}
              {window.resetsAt && (
                <span>
                  {' '}
                  · {t('reset')} {new Date(window.resetsAt).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
function PlatformConnection({ account, bridge, t }: {
  account: AccountSnapshot
  bridge: AccountBridge
  t: SectionProps['t']
}) {
  const [editing, setEditing] = useState(false),
    [address, setAddress] = useState(''),
    [choosing, setChoosing] = useState(false)
  useEffect(() => {
    setEditing(false)
    setChoosing(false)
  }, [account.baseUrl])
  const organization = account.organization
  const canChoose = ['ready', 'select-organization', 'blocked'].includes(account.phase)
  return (
    <div className={css.card} role="group" aria-label={t('connection')}>
      <div className={css.line}>
        <span>{t('address')}</span>
        {!editing && <Button size="sm"
          onClick={() => {
            setAddress(account.baseUrl)
            setEditing(true)
          }}
        >{t('change')}</Button>}
      </div>
      {editing ? (
        <form className={css.form}
          onSubmit={(event) => {
            event.preventDefault()
            void bridge.configure(address)
            setEditing(false)
          }}
        >
          <label className={css.label}>
            {t('address')}
            <Input value={address} type="url" required
              onChange={(event) => { setAddress(event.target.value) }} />
          </label>
          <p className={css.detail}>{t('switchNotice')}</p>
          <div className={css.actions}>
            <Button variant="outline" onClick={() => { setEditing(false) }}>{t('cancelEdit')}</Button>
            <Button type="submit" variant="primary">{t('save')}</Button>
          </div>
        </form>
      ) : <p className={css.detail}>{account.baseUrl}</p>}
      {account.user && (
        <div className={css.organizationRow}>
          <span>{t('organization')}</span>
          {account.organizations.length > 1 || account.phase === 'select-organization' || account.phase === 'blocked' ? (
            <Menu open={choosing} portal autoFocus align="end" className={css.organizationAnchor} listClassName={css.organizationMenu}
              selectedId={organization?.tenantId}
              items={account.organizations.map(org => ({
                id: org.tenantId, label: org.name, disabled: org.status !== 'active' || org.needsLogin,
              }))}
              onClose={() => { setChoosing(false) }}
              onSelect={(id) => {
                setChoosing(false)
                if (id !== organization?.tenantId) void bridge.selectOrganization(id)
              }}
              anchor={
                <Button size="sm" className={css.organizationButton} disabled={!canChoose || editing}
                  aria-label={t('choose')} aria-haspopup="menu" aria-expanded={choosing}
                  onClick={() => { setChoosing(value => !value) }}>
                  <span>{organization?.name ?? t('choose')}</span>
                  <IconChevronDownOutlineRegular size={12} />
                </Button>
              }
            />
          ) : <span className={css.organizationName}>{organization?.name ?? t('noOrganizationName')}</span>}
        </div>
      )}
      {account.phase === 'no-organization' && <p className={css.detail}>{t('noOrganization')}</p>}
      {account.phase === 'blocked' && <p className={css.detail}>{t('blocked')}</p>}
      {account.phase === 'offline' && !account.error && <p role="status" className={css.detail}>{t('offline')}</p>}
      {account.error && <p role="alert" className={css.detail}>{t(errorKey(account.error.code))}</p>}
    </div>
  )
}
export function AccountSection({ useAccount, bridge, t }: SectionProps) {
  const account = useAccount(value => value)
  useEffect(() => {
    if (account?.phase === 'ready') void bridge.quota()
  }, [bridge, account?.phase, account?.baseUrl, account?.user?.id, account?.organization?.tenantId])
  if (!account) return null
  return (
    <section className={css.section} aria-label={t('nav')}>
      <div className={css.card}>
        <div className={css.line}>
          <div className={css.identity}>
            <span className={css.profileAvatar}>{account.user?.name.slice(0, 1) ?? <IconUserOutlineMedium size={16} />}</span>
            <div className={css.identityCopy}>
              <span className={css.name}>{account.user?.name ?? t('signedOut')}</span>
              {account.user?.email && <span className={css.detail}>{account.user.email}</span>}
            </div>
          </div>
          {account.user && <Button className={css.accountInfo}
            onClick={() => { void bridge.personalCenter() }}>
            {t('accountInfo')}<IconRightUpOutlineRegular size={12} />
          </Button>}
        </div>
      </div>
      {account.user && (
        <div className={css.card}>
          <span className={css.heading}>{t('usage')}</span>
          <Usage account={account} t={t} />
        </div>
      )}
      <PlatformConnection account={account} bridge={bridge} t={t} />
    </section>
  )
}
export function AccountMenu({ useAccount, bridge, wide, openSettings, t }: MenuProps) {
  const account = useAccount(value => value)
  const [open, setOpen] = useState(false)
  if (!account) return null
  const close = () => {
    setOpen(false)
  }
  return (
    <Menu
      open={open}
      side="top"
      portal
      autoFocus
      listClassName={css.menu}
      className={css.anchor}
      onClose={close}
      anchor={
        <button
          className={css.trigger}
          data-collapsed={!wide}
          type="button"
          aria-label={t('menu')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            setOpen(value => !value)
          }}
        >
          <span className={css.avatar}>{account.user?.name.slice(0, 1) ?? <IconUserOutlineMedium size={16} />}</span>
          {wide && <span>{account.user?.name ?? t('login')}</span>}
        </button>
      }
    >
      {account.phase === 'offline' && !account.error && <p className={css.detail}>{t('offline')}</p>}
      {account.error && (
        <p role="status" className={css.detail}>
          {t(errorKey(account.error.code))}
        </p>
      )}
      <MenuItemButton
        onSelect={() => {
          close()
          openSettings()
        }}
      >
        {t('settings')}
      </MenuItemButton>
      {account.user && (
        <MenuItemButton
          onSelect={() => {
            close()
            void bridge.personalCenter()
          }}
        >
          {t('center')}
        </MenuItemButton>
      )}
      <MenuItemButton
        onSelect={() => {
          close()
          void (account.user ? bridge.logout() : bridge.show())
        }}
      >
        {account.user ? t('logout') : t('login')}
      </MenuItemButton>
    </Menu>
  )
}
type BrandProps = InjectFace<Operations> & PropsLocale<'actvero.account'>
export function BrandName({ useAccount, t }: BrandProps) {
  const account = useAccount(value => value)
  return <strong>{account?.brand.name ?? t('fallbackName')}</strong>
}
/** Shows platform artwork, then build artwork, then the shipped Actvero mark. */
export function BrandMark({ useAccount }: Pick<BrandProps, 'useAccount'>) {
  const account = useAccount(value => value)
  const [failedUrl, setFailedUrl] = useState<string>()
  const [failedFallback, setFailedFallback] = useState<string>()
  const remoteLogo = account?.brand.logoUrl
  const fallbackLogo = account?.brand.fallbackLogoUrl
  const logo = remoteLogo && remoteLogo !== failedUrl ? remoteLogo : fallbackLogo !== failedFallback ? fallbackLogo : undefined
  return (
    <span aria-hidden="true" className={css.mark}>
      {logo && logo !== failedUrl ? <img src={logo} alt="" onError={() => { if (logo === remoteLogo) setFailedUrl(logo); else setFailedFallback(logo) }} /> : (
        <svg viewBox="0 0 256 256" fill="currentColor" focusable="false" data-actvero-default-mark="">
          <path d="M 76 28 H 144 A 12 12 0 0 1 156 40 V 48 A 24 24 0 0 1 132 72 H 108 A 20 20 0 0 0 88 92 V 120 A 20 20 0 0 0 108 140 H 112 A 12 12 0 0 1 124 152 V 168 A 12 12 0 0 1 112 180 H 76 A 48 48 0 0 1 28 132 V 76 A 48 48 0 0 1 76 28 Z" />
          <path d="M 76 28 H 144 A 12 12 0 0 1 156 40 V 48 A 24 24 0 0 1 132 72 H 108 A 20 20 0 0 0 88 92 V 120 A 20 20 0 0 0 108 140 H 112 A 12 12 0 0 1 124 152 V 168 A 12 12 0 0 1 112 180 H 76 A 48 48 0 0 1 28 132 V 76 A 48 48 0 0 1 76 28 Z" transform="rotate(180 128 128)" />
        </svg>
      )}
    </span>
  )
}
