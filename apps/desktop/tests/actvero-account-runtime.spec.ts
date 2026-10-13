import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountSnapshot } from '@actvero/dsh-client-account/protocol'
import { ACCOUNT_IPC } from '../src/actvero/ipc.ts'

const fake = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => unknown>(),
  snapshot: undefined as AccountSnapshot | undefined,
  changed: undefined as ((value: AccountSnapshot) => void) | undefined,
  switch: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  logout: vi.fn(async (confirm: () => Promise<boolean>) => { await confirm() }),
}))
vi.mock('electron', () => ({ app: { getPath: () => '/isolated', getAppPath: () => '/desktop', on: vi.fn() }, shell: { openExternal: vi.fn() },
  ipcMain: { handle: (name: string, action: (event: unknown) => unknown) => fake.handlers.set(name, action), removeHandler: vi.fn() } }))
vi.mock('../src/actvero/vault.ts', () => ({ SecureVault: function () {} }))
vi.mock('../src/actvero/controller.ts', () => ({ AccountController: class {
  constructor(options: { changed(value: AccountSnapshot): void }) {
    fake.changed = (value) => { fake.snapshot = value; options.changed(value) }
  }
  snapshot() {return fake.snapshot}
  cancel = fake.cancel
  switchAccount = fake.switch
  logout = fake.logout
} }))
const { installAccount } = await import('../src/actvero/runtime.ts')
const ready: AccountSnapshot = { phase:'ready', baseUrl:'https://example.test', brand:{ name:'ACTVERO' },
  user:{ id:'test', name:'Test' }, organizations:[], organization:{ tenantId:'alpha', memberId:'member', name:'Alpha', status:'active', needsLogin:false },
  quota:{ phase:'idle',windows:[] } }
beforeEach(() => {fake.handlers.clear(); fake.snapshot = structuredClone(ready); vi.clearAllMocks()})
function mount() {
  const sender = { mainFrame:{ url:'file:///desktop/renderer/welcome.html' }, send:vi.fn() }
  const window = { isDestroyed:() => false, webContents:sender }
  const enter = vi.fn(async () => {})
  const confirmLogout = vi.fn(async () => false)
  const local = vi.fn(async () => {})
  const show = vi.fn(async () => {})
  installAccount({ enabled:true, baseUrl:ready.baseUrl, version:'test', windows:() => [window as never], enter, confirmLogout,
    local, show })
  return { enter, sender, confirmLogout, local, show, event:{ sender, senderFrame:sender.mainFrame } }
}
describe('Main-owned account confirmation', () => {
  it('publishes restored and refreshed account state without entering; Continue enters explicitly', async () => {
    const { enter, sender, event } = mount()
    fake.changed!(ready); fake.changed!(ready)
    expect(sender.send).toHaveBeenCalledTimes(2)
    expect(enter).not.toHaveBeenCalled()
    await fake.handlers.get(ACCOUNT_IPC.continueAccount)!(event)
    expect(enter).toHaveBeenCalledOnce()
  })
  it.each(['offline', 'blocked', 'signed-out'] as const)('rejects Continue when the current account is %s', (phase) => {
    const { enter, event } = mount()
    fake.snapshot = { ...ready, phase }
    expect(() => fake.handlers.get(ACCOUNT_IPC.continueAccount)!(event)).toThrow('not ready')
    expect(enter).not.toHaveBeenCalled()
  })
  it('rejects subframes and requires an active organization', () => {
    const { enter, event } = mount()
    expect(() => fake.handlers.get(ACCOUNT_IPC.switchAccount)!({ ...event, senderFrame:{ ...event.senderFrame } })).toThrow('unauthorized sender')
    fake.snapshot = { ...ready, organization:{ ...ready.organization!, needsLogin:true } }
    expect(() => fake.handlers.get(ACCOUNT_IPC.continueAccount)!(event)).toThrow('not ready')
    expect(fake.switch).not.toHaveBeenCalled()
    expect(enter).not.toHaveBeenCalled()
  })
})

it('passes the Main-owned confirmation to sign-out only for an authorized frame', async () => {
  const { event, confirmLogout } = mount()
  const handler = fake.handlers.get(ACCOUNT_IPC.logout)!
  expect(() => handler({ ...event, senderFrame:{ ...event.senderFrame } })).toThrow('unauthorized sender')
  expect(fake.logout).not.toHaveBeenCalled()
  await handler(event)
  expect(fake.logout).toHaveBeenCalledOnce()
  expect(confirmLogout).toHaveBeenCalledOnce()
})

const signedOut: AccountSnapshot = { phase: 'signed-out', baseUrl: ready.baseUrl, brand: ready.brand,
  organizations: [], quota: { phase: 'idle', windows: [] } }
describe('browser login and signed-out entry', () => {
  it('opens the workspace once after a new browser login, without replaying startup confirmation', () => {
    const { enter } = mount()
    fake.changed!({ ...signedOut, phase: 'waiting' })
    fake.changed!({ ...signedOut, phase: 'exchanging' })
    expect(enter).not.toHaveBeenCalled()
    fake.changed!(ready)
    fake.changed!(ready)
    expect(enter).toHaveBeenCalledExactlyOnceWith({ activate: false })
  })
  it('waits for organization selection and eligibility before completing a browser login', () => {
    const { enter } = mount()
    fake.changed!({ ...signedOut, phase: 'waiting' })
    const { organization:_organization,...unselected }=ready
    fake.changed!({ ...unselected, phase: 'select-organization' })
    fake.changed!({ ...ready, phase: 'blocked' })
    fake.changed!({ ...ready, organization: { ...ready.organization!, needsLogin: true } })
    expect(enter).not.toHaveBeenCalled()
    fake.changed!(ready)
    expect(enter).toHaveBeenCalledOnce()
  })
  it.each([ACCOUNT_IPC.cancel, ACCOUNT_IPC.local])('does not auto-enter after the user chooses %s', async (channel) => {
    const { enter, event } = mount()
    fake.changed!({ ...signedOut, phase: 'waiting' })
    await fake.handlers.get(channel)!(event)
    expect(fake.cancel).toHaveBeenCalledOnce()
    fake.changed!(ready)
    expect(enter).not.toHaveBeenCalled()
  })
  it('shows login immediately after local sign-out even while remote cleanup is pending', async () => {
    const { enter, show, local, event } = mount()
    fake.changed!(ready)
    await fake.handlers.get(ACCOUNT_IPC.local)!(event)
    fake.changed!({ ...signedOut, phase: 'logout-pending' })
    fake.changed!(signedOut)
    expect(show).toHaveBeenCalledOnce()
    expect(local).toHaveBeenCalledOnce()
    expect(enter).not.toHaveBeenCalled()
    await fake.handlers.get(ACCOUNT_IPC.local)!(event)
    expect(local).toHaveBeenCalledTimes(2)
  })
  it('keeps the workspace open when logout confirmation is cancelled', async () => {
    const { show, event } = mount()
    fake.changed!(ready)
    await fake.handlers.get(ACCOUNT_IPC.logout)!(event)
    expect(show).not.toHaveBeenCalled()
  })
})
