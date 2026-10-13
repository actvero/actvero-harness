import { useEffect, useRef, useState } from 'react'
import type { AccountBridge, AccountSnapshot } from '@actvero/dsh-client-account/protocol'
import type { WelcomeApi } from '../welcome-api.ts'
import './actvero-welcome.css'
const errors: Record<string, string> = {
  network_unavailable: '暂时无法连接平台，登录状态会保留，请联网后重试。',
  identity_unavailable: '身份服务暂时不可用，请稍后重试。',
  storage_unavailable: '系统安全存储不可用，请解锁系统钥匙串后重试。',
  storage_invalid: '无法读取保存的登录状态，请检查系统安全存储。',
  unsupported_contract: '平台登录接口尚不兼容，请联系管理员升级。',
  invalid_response: '平台返回了不兼容的登录信息，请联系管理员。',
  device_revoked: '此设备已退出，请重新登录。',
  session_expired: '保存的登录已到期，请重新登录。',
  reauthentication_required: '账号需要重新验证，请再次登录。',
  refresh_recovery_expired: '登录恢复窗口已过期，请重新登录。',
  refresh_replayed: '登录恢复发生冲突，请重试恢复已保存的凭据。',
  logout_pending: '已在本机退出，远端撤销尚待完成，联网后会继续重试。',
  invalid_service: '请输入有效的平台地址；远程服务必须使用 HTTPS。',
  login_expired: '本次登录已过期，请重新开始。',
}
/** Platform account confirmation beside the approved flowing login artwork. */
export function ActveroWelcome({
  bridge,
  initial,
  api,
}: {
  bridge: AccountBridge
  initial: AccountSnapshot
  api: WelcomeApi
}) {
  const [account, setAccount] = useState(initial),
    [editing, setEditing] = useState(false),
    [address, setAddress] = useState(initial.baseUrl),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(false),
    [failedLogo, setFailedLogo] = useState<string>(),
    [failedFallback, setFailedFallback] = useState<string>()
  const busyRef = useRef(false)
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setActionError(false)
    try { await action() } catch { setActionError(true) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const zh = api.id === 'zh-CN'
  const label = (cn: string, en: string) => (zh ? cn : en)
  useEffect(() => {
    let alive = true,
      revision = 0
    const stop = bridge.subscribe((value) => {
      revision++
      if (alive) setAccount(value)
    })
    void bridge.snapshot().then((value) => {
      if (alive && revision === 0 && value) setAccount(value)
    })
    return () => {
      alive = false
      stop()
    }
  }, [bridge])
  useEffect(() => {
    document.title = account.brand.name
  }, [account.brand.name])
  const logo = account.brand.logoUrl && account.brand.logoUrl !== failedLogo
    ? account.brand.logoUrl : account.brand.fallbackLogoUrl !== failedFallback ? account.brand.fallbackLogoUrl : undefined
  const hasAccount = !!account.user || ['offline', 'restoring'].includes(account.phase)
  const confirmed = account.phase === 'ready' && !!account.user && !!account.organization
  const waiting = ['waiting', 'exchanging', 'restoring'].includes(account.phase)
  return (
    <>
      <div className="titlebar" aria-hidden="true" />
      <div className="actvero-login-layout">
        <aside className="actvero-atmosphere" aria-label={account.brand.name}>
          <div className="atmosphere-layer" data-actvero-atmosphere aria-hidden="true">
            <img src="assets/actvero-login-atmosphere.webp" alt="" />
          </div>
          <strong className="actvero-brand">
            {logo && logo !== failedLogo && <img src={logo} alt="" onError={() => { if (logo === account.brand.logoUrl) setFailedLogo(logo); else setFailedFallback(logo) }} />}
            {account.brand.name}
          </strong>
          <div className="actvero-tagline">
            <p>{label('你的桌面 AI 工作空间', 'Your desktop AI workspace')}</p>
            <h2>{label('让想法', 'Bring your ideas')}<br />{label('更进一步。', 'one step further.')}</h2>
            <p>{label('从一个问题开始，把想法变成现实。', 'Start with a question. Make it happen.')}</p>
          </div>
        </aside>
        <main className="welcome actvero-welcome" aria-labelledby="actvero-welcome-title">
          <div className="actvero-login-panel">
            <section className="actvero-content" aria-live="polite">
              <h1 id="actvero-welcome-title">
                {editing
                  ? label('连接平台服务', 'Platform address')
                  : account.phase === 'select-organization'
                    ? label('选择组织', 'Choose an organization')
                    : account.phase === 'no-organization'
                      ? label('等待加入组织', 'Join an organization')
                      : waiting
                        ? label('正在完成登录', 'Completing sign in')
                        : confirmed
                          ? label('继续使用这个账号？', 'Continue with this account?')
                          : label('欢迎回来', 'Welcome back')}
              </h1>
              {editing ? (
                <form
                  id="actvero-address"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void run(async () => {
                      await bridge.configure(address)
                      const next = await bridge.snapshot()
                      if (next && !next.error) setEditing(false)
                    })
                  }}
                >
                  <label>
                    {label('平台地址', 'Platform address')}
                    <input
                      type="url"
                      required
                      value={address}
                      onChange={(event) => {
                        setAddress(event.target.value)
                      }}
                      disabled={busy}
                      autoFocus
                    />
                  </label>
                  <p>
                    {label(
                      '更改平台会退出当前账号，本机文件和对话会保留。',
                      'Changing platform signs out this account. Local files and conversations are retained.',
                    )}
                  </p>
                </form>
              ) : (
                <>
                  {account.user && (
                    <div className="actvero-identity">
                      <span className="actvero-avatar" aria-hidden="true">
                        {account.user.avatarUrl ? <img src={account.user.avatarUrl} alt="" /> : account.user.name.slice(0, 1)}
                      </span>
                      <div><div className="actvero-identity-name">{account.user.name}</div>
                        {account.user.email && <div className="actvero-identity-email">{account.user.email}</div>}
                      </div>
                    </div>
                  )}
                  {['select-organization', 'blocked'].includes(account.phase) && (
                    <div className="actvero-organizations">
                      {account.organizations.map(org => (
                        <button
                          key={org.tenantId}
                          className="secondary"
                          type="button"
                          disabled={busy || org.status !== 'active' || org.needsLogin}
                          onClick={() => {
                            void run(() => bridge.selectOrganization(org.tenantId))
                          }}
                        >
                          {org.name}
                          {org.status !== 'active' || org.needsLogin ? label('（暂不可用）', ' (unavailable)') : ''} →
                        </button>
                      ))}
                    </div>
                  )}
                  {account.phase === 'no-organization' && (
                    <p>
                      {label(
                        '账号已经登录。请联系管理员加入组织，然后点击刷新。',
                        'You are signed in. Ask your administrator to add you to an organization, then refresh.',
                      )}
                    </p>
                  )}
                  {account.phase === 'blocked' && (
                    <p>
                      {label(
                        '当前组织不可用，请选择其他组织或联系管理员。',
                        'This organization is unavailable. Choose another organization or contact your administrator.',
                      )}
                    </p>
                  )}
                  {account.phase === 'offline' && (
                    <p>{label('当前离线，已保留登录状态。', 'Offline. Your saved login is retained.')}</p>
                  )}
                  {account.phase === 'waiting' && (
                    <p>
                      {label(
                        '请在浏览器中确认要使用的账号，完成后会自动进入工作区。',
                        'Confirm the account in your browser. The workspace will open automatically.',
                      )}
                    </p>
                  )}
                  {!hasAccount && !waiting && (
                    <p>{label('登录平台账号，继续你的工作。', 'Sign in to your platform account to continue.')}</p>
                  )}
                  {confirmed && <p>{label('确认账号后继续，或切换账号登录。', 'Confirm this account to continue, or sign in with another account.')}</p>}
                  <div className="actvero-address">
                    <div className="actvero-connection">
                      {account.organization && <span className="actvero-organization">{account.organization.name}</span>}
                      <span title={account.baseUrl}>{account.baseUrl}</span>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setAddress(account.baseUrl)
                        setEditing(true)
                      }}
                    >
                      {label('更改', 'Change')}
                    </button>
                  </div>
                </>
              )}
              {actionError && <p role="alert" className="key-error">{label('操作未完成，请重试。', 'Could not complete this action. Try again.')}</p>}
              {account.error && (
                <p role="alert" className="key-error">
                  {zh
                    ? (errors[account.error.code] ?? '操作未完成，请重试。')
                    : 'Could not complete the operation. Retry or contact your administrator.'}
                </p>
              )}
            </section>
            <div className="actions">
              {editing ? (
                <>
                  <button className="primary" type="submit" form="actvero-address" disabled={busy}>
                    {label('保存', 'Save')}
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      setEditing(false)
                    }}
                    disabled={busy}
                  >
                    {label('取消', 'Cancel')}
                  </button>
                </>
              ) : waiting ? (
                <>
                  <button
                    className="primary"
                    type="button"
                    disabled={busy || account.phase !== 'waiting'}
                    onClick={() => {
                      void run(() => bridge.reopen())
                    }}
                  >
                    {account.phase === 'waiting'
                      ? label('重新打开浏览器', 'Open browser again')
                      : label('正在恢复…', 'Restoring…')}
                  </button>
                  {account.phase === 'waiting' && (
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void run(() => bridge.cancel())
                      }}
                    >
                      {label('取消登录', 'Cancel sign in')}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    className="primary"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void run(() => confirmed ? bridge.continueAccount() : hasAccount ? bridge.refresh() : bridge.login())
                    }}
                  >
                    {confirmed ? label('继续使用此账号', 'Continue with this account') : hasAccount ? label('重试连接', 'Retry connection') : label('使用平台账号登录', 'Sign in')}
                  </button>
                  {account.user && <button className="secondary" type="button" disabled={busy}
                    onClick={() => { void run(() => bridge.switchAccount()) }}>
                    {label('切换账号登录', 'Sign in with another account')}
                  </button>}
                  <button
                    className="actvero-local"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void run(() => bridge.local())
                    }}
                  >
                    {label('暂不登录，使用本地工作区', 'Continue with local workspace')}
                  </button>
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  )
}
