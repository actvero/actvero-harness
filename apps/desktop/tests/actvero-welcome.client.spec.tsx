// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActveroWelcome } from '../src/client/ActveroWelcome.tsx'
import { resolveDesktopLocale } from '../src/locale.ts'
import type { WelcomeApi } from '../src/welcome-api.ts'
import type { AccountBridge, AccountSnapshot } from '@actvero/dsh-client-account/protocol'

afterEach(cleanup)
const organization = { tenantId: 'alpha', memberId: 'member', name: '测试组织', status: 'active', needsLogin: false }
const initial: AccountSnapshot = { phase: 'ready', baseUrl: 'https://example.test', brand: { name: 'ACTVERO' },
  user: { id: 'user', name: '测试用户', email: 'user@example.test' }, organization, organizations: [organization], quota: { phase: 'idle', windows: [] } }
function mount(snapshot = initial, language = 'zh-CN') {
  let receive: (value: AccountSnapshot) => void = () => {}
  const bridge = { snapshot: vi.fn(async () => snapshot), subscribe: (listener) => { receive = listener; return () => {} },
    login: vi.fn(async () => {}), continueAccount: vi.fn(async () => {}), switchAccount: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}), reopen: vi.fn(async () => {}), refresh: vi.fn(async () => {}), quota: vi.fn(async () => {}),
    logout: vi.fn(async () => {}), configure: vi.fn(async () => {}), selectOrganization: vi.fn(async () => {}),
    personalCenter: vi.fn(async () => {}), local: vi.fn(async () => {}), show: vi.fn(async () => {}) } satisfies AccountBridge
  const api = resolveDesktopLocale(language) as WelcomeApi
  const view = render(<ActveroWelcome bridge={bridge} initial={snapshot} api={api} />)
  return { bridge, view, receive: (value: AccountSnapshot) => { act(() => { receive(value) }) } }
}
describe('ACTVERO account confirmation', () => {
  it.each(['zh-CN', 'en'])('keeps restored %s identity visible until Continue and snapshots its copy', async (language) => {
    const { bridge, receive } = mount(initial, language)
    await act(async () => {})
    receive({ ...initial })
    expect(bridge.continueAccount).not.toHaveBeenCalled()
    expect(bridge.login).not.toHaveBeenCalled()
    const copy = [document.querySelector('h1')!.textContent, ...Array.from(document.querySelectorAll('main button')).map(button => button.textContent)].join('\n')
    await expect(copy).toMatchFileSnapshot(`./expected/welcome/actvero-${language}.expected.txt`)
    fireEvent.click(screen.getByRole('button', { name: language === 'zh-CN' ? '继续使用此账号' : 'Continue with this account' }))
    await act(async () => {})
    expect(bridge.continueAccount).toHaveBeenCalledOnce()
    expect(bridge.logout).not.toHaveBeenCalled()
  })
  it('switches only when explicitly clicked and prevents duplicate or competing actions', async () => {
    const { bridge } = mount()
    const pending = Promise.withResolvers<undefined>()
    vi.mocked(bridge.switchAccount).mockReturnValue(pending.promise)
    const button = screen.getByRole('button', { name: '切换账号登录' })
    fireEvent.click(button); fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: '继续使用此账号' }))
    expect(bridge.switchAccount).toHaveBeenCalledOnce()
    expect(bridge.continueAccount).not.toHaveBeenCalled()
    await act(async () => { pending.resolve(undefined) })
  })
  it.each(['zh-CN', 'en'])('waits for the browser choice in %s without offering duplicate desktop confirmation', async (language) => {
    const pending: AccountSnapshot = { phase: 'waiting', baseUrl: initial.baseUrl, brand: initial.brand,
      organizations: [], quota: { phase: 'idle', windows: [] } }
    const { bridge } = mount(pending, language)
    expect(screen.queryByText('user@example.test')).toBeNull()
    expect(screen.queryByRole('button', { name: language === 'zh-CN' ? '继续使用此账号' : 'Continue with this account' })).toBeNull()
    expect(screen.getByText(language === 'zh-CN' ? '请在浏览器中确认要使用的账号，完成后会自动进入工作区。'
      : 'Confirm the account in your browser. The workspace will open automatically.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: language === 'zh-CN' ? '重新打开浏览器' : 'Open browser again' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: language === 'zh-CN' ? '取消登录' : 'Cancel sign in' }))
    await act(async () => {})
    expect(bridge.reopen).toHaveBeenCalledOnce()
    expect(bridge.cancel).toHaveBeenCalledOnce()
    expect(bridge.continueAccount).not.toHaveBeenCalled()
    expect(bridge.login).not.toHaveBeenCalled()
  })
  it('keeps offline identity and retries connection without initiating browser login', async () => {
    const { bridge } = mount({ ...initial, phase:'offline' })
    expect(screen.getByText('user@example.test')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name:'重试连接' }))
    await act(async () => {})
    expect(bridge.refresh).toHaveBeenCalledOnce()
    expect(bridge.login).not.toHaveBeenCalled()
    expect(bridge.continueAccount).not.toHaveBeenCalled()
  })
})
