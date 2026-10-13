// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, expect, it, vi } from 'vitest'
import type { AccountBridge, AccountSnapshot, Organization } from '../src/protocol.ts'
import type {} from '../src/client/index.ts'
import { AccountSection, BrandMark } from '../src/client/Account.tsx'
import { en, zh, type CopyKey } from '../src/client/locales.ts'

afterEach(cleanup)

const first: Organization = { tenantId: 'one', memberId: 'member-one', name: 'First organization', status: 'active', needsLogin: false }
const second: Organization = { tenantId: 'two', memberId: 'member-two', name: 'Second organization', status: 'active', needsLogin: false }
function ready(): AccountSnapshot {
  return {
    phase: 'ready', baseUrl: 'https://platform.example', brand: { name: 'ACTVERO' },
    user: { id: 'user', name: 'Member', email: 'member@example.com' },
    organization: first, organizations: [first, second],
    quota: { phase: 'unconfigured', windows: [] },
  }
}
function mount(initial: AccountSnapshot, copy = en) {
  let snapshot = initial
  const bridge = {
    snapshot: vi.fn(async () => snapshot), subscribe: vi.fn(() => () => {}),
    login: vi.fn(async () => {}), cancel: vi.fn(async () => {}), reopen: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}), quota: vi.fn(async () => {}), logout: vi.fn(async () => {}),
    configure: vi.fn(async () => {}), selectOrganization: vi.fn(async () => {}),
    continueAccount: vi.fn(async () => {}), switchAccount: vi.fn(async () => {}),
    personalCenter: vi.fn(async () => {}), local: vi.fn(async () => {}), show: vi.fn(async () => {}),
  } satisfies AccountBridge
  const component = () => <AccountSection {...({} as GlobalStandardProps)}
    bridge={bridge} useAccount={selector => selector(snapshot)} close={() => {}}
    t={key => key in copy ? copy[key as CopyKey] : key} />
  const view = render(component())
  return { bridge, update: (next: AccountSnapshot) => { snapshot = next; view.rerender(component()) } }
}

it.each([en, zh])('keeps organization with its platform and account actions in the sidebar', async (copy) => {
  const { bridge } = mount(ready(), copy)
  const connection = screen.getByRole('group', { name: copy.connection })
  expect(within(connection).getByText('https://platform.example')).toBeTruthy()
  expect(within(connection).getByText(first.name)).toBeTruthy()
  for (const name of [copy.refresh, copy.login, copy.logout]) expect(screen.queryByRole('button', { name })).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy.accountInfo })) })
  expect(bridge.personalCenter).toHaveBeenCalledOnce()
})

it('displays a single organization without offering a switch', () => {
  mount({ ...ready(), organizations: [first] })
  expect(screen.getByText(first.name)).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.choose })).toBeNull()
})

it('switches eligible organizations, dismisses the menu and rejects unavailable rows', async () => {
  const unavailable = { ...second, tenantId: 'blocked', name: 'Unavailable organization', status: 'blocked' }
  const needsLogin = { ...second, tenantId: 'verify', name: 'Verification required', needsLogin: true }
  const { bridge } = mount({ ...ready(), organizations: [first, second, unavailable, needsLogin] })
  fireEvent.click(screen.getByRole('button', { name: en.choose }))
  expect(screen.getByRole('menuitem', { name: unavailable.name }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('menuitem', { name: needsLogin.name }).hasAttribute('disabled')).toBe(true)
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: second.name })) })
  expect(bridge.selectOrganization).toHaveBeenCalledWith(second.tenantId)
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.choose }))
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
})

it('queries quota on entry and organization changes without querying on quota updates', () => {
  const initial = ready()
  const { bridge, update } = mount(initial)
  expect(bridge.quota).toHaveBeenCalledTimes(1)
  update({ ...initial, quota: { phase: 'loading', windows: [] } })
  expect(bridge.quota).toHaveBeenCalledTimes(1)
  const { organization: _organization, ...restoring } = initial
  update({ ...restoring, phase: 'restoring' })
  expect(bridge.quota).toHaveBeenCalledTimes(1)
  update({ ...initial, organization: second })
  expect(bridge.quota).toHaveBeenCalledTimes(2)
  update({ ...initial, phase: 'offline', organization: second })
  expect(bridge.quota).toHaveBeenCalledTimes(2)
  update({ ...initial, organization: second })
  expect(bridge.quota).toHaveBeenCalledTimes(3)
})

it('cancels address editing without changing the platform or login', () => {
  const { bridge } = mount(ready())
  fireEvent.click(screen.getByRole('button', { name: en.change }))
  fireEvent.change(screen.getByRole('textbox', { name: en.address }), { target: { value: 'https://different.example' } })
  fireEvent.click(screen.getByRole('button', { name: en.cancelEdit }))
  expect(bridge.configure).not.toHaveBeenCalled()
  expect(bridge.logout).not.toHaveBeenCalled()
  expect(screen.getByText('https://platform.example')).toBeTruthy()
})


it('uses the shipped mark without a remote image and recovers after a broken image URL changes', () => {
  let snapshot = ready()
  const component = () => <BrandMark useAccount={selector => selector(snapshot)} />
  const view = render(component())
  const fallback = () => view.container.querySelector('[data-actvero-default-mark]')
  expect(fallback()).not.toBeNull()
  expect(view.container.querySelector('img')).toBeNull()
  snapshot = { ...snapshot, brand: { name: 'Platform', logoUrl: 'https://platform.example/logo.png' } }
  view.rerender(component())
  const image = view.container.querySelector('img')!
  expect(image.src).toBe(snapshot.brand.logoUrl)
  expect(fallback()).toBeNull()
  fireEvent.error(image)
  expect(fallback()).not.toBeNull()
  snapshot = { ...snapshot, brand: { name: 'Platform', logoUrl: 'https://platform.example/new-logo.png' } }
  view.rerender(component())
  expect(view.container.querySelector('img')?.src).toBe(snapshot.brand.logoUrl)
  expect(fallback()).toBeNull()
  snapshot = { ...snapshot, brand: { name: 'Platform' } }
  view.rerender(component())
  expect(fallback()).not.toBeNull()
})

it('uses the build image when a platform has no logo or its logo fails, without retrying failed images in a loop', () => {
  const fallbackLogoUrl = 'data:image/png;base64,build-artwork'
  let snapshot: AccountSnapshot = { ...ready(), brand: { name: 'Customer AI', fallbackLogoUrl } }
  const component = () => <BrandMark useAccount={selector => selector(snapshot)} />
  const view = render(component())
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe(fallbackLogoUrl)
  snapshot = { ...snapshot, brand: { ...snapshot.brand, logoUrl: 'https://platform.example/missing.png' } }
  view.rerender(component())
  fireEvent.error(view.container.querySelector('img')!)
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe(fallbackLogoUrl)
  fireEvent.error(view.container.querySelector('img')!)
  expect(view.container.querySelector('img')).toBeNull()
  expect(view.container.querySelector('[data-actvero-default-mark]')).not.toBeNull()
})
