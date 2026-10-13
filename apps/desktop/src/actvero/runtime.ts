import { app, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AccountController } from './controller.ts'
import { SecureVault } from './vault.ts'
import { ACCOUNT_IPC } from './ipc.ts'
import type { AccountSnapshot } from '@actvero/dsh-client-account/protocol'
import { SCHEME } from '../ipc.ts'
interface Options {
  changed?():void
  enabled: boolean
  baseUrl: string
  version: string
  defaultBrand?: AccountSnapshot['brand']
  windows(): (BrowserWindow | undefined)[]
  enter(options?: { activate?: boolean }): Promise<void>
  confirmLogout(): Promise<boolean>
  local(): Promise<void>
  show(): Promise<void>
}
function readyForWorkspace(snapshot: AccountSnapshot | undefined): boolean {
  return snapshot?.phase === 'ready' && !!snapshot.user && !!snapshot.organization
    && snapshot.organization.status === 'active' && !snapshot.organization.needsLogin
}
/** Main owns credentials and recognizes only its two top-level account consumers. */
export function installAccount(options: Options): AccountController | undefined {
  let browserLogin = false
  let hadAccount = false
  const controller = options.enabled
    ? new AccountController({
      vault: new SecureVault(join(app.getPath('userData'), 'actvero-device-account.enc')),
      baseUrl: options.baseUrl,
      appVersion: options.version,
      ...(options.defaultBrand ? { defaultBrand: options.defaultBrand } : {}),
      openExternal: url => shell.openExternal(url),
      changed: (snapshot) => {
        options.changed?.()
        for (const window of options.windows())
          if (window && !window.isDestroyed()) window.webContents.send(ACCOUNT_IPC.state, snapshot)
        if (snapshot.phase === 'waiting' || snapshot.phase === 'exchanging') browserLogin = true
        if (snapshot.phase === 'signed-out' || snapshot.phase === 'logout-pending') {
          browserLogin = false
          if (hadAccount) {
            hadAccount = false
            void options.show().catch(() => undefined)
          }
        }
        if (snapshot.user) hadAccount = true
        if (browserLogin && readyForWorkspace(snapshot)) {
          browserLogin = false
          // Restore and renewal need confirmation; a new browser login already confirmed identity.
          void options.enter({ activate: false }).catch(() => options.show()).catch(() => undefined)
        }
      },
    })
    : undefined
  const authorize = (event: IpcMainInvokeEvent): void => {
    const window = options
      .windows()
      .find(candidate => candidate && !candidate.isDestroyed() && candidate.webContents === event.sender)
    if (!window || event.senderFrame !== event.sender.mainFrame) throw new Error('account: unauthorized sender')
    const url = new URL(event.senderFrame.url)
    const appPage = url.protocol === `${SCHEME}:` && url.hostname === 'app'
    const welcomePage =
      url.protocol === 'file:' && url.pathname === pathToFileURL(join(app.getAppPath(), 'renderer', 'welcome.html')).pathname
    if (!appPage && !welcomePage) throw new Error('account: unauthorized origin')
  }
  const handlers: [string, (value: unknown) => unknown][] = [
    [ACCOUNT_IPC.snapshot, () => controller?.snapshot() ?? null],
    [ACCOUNT_IPC.login, () => controller?.login()],
    [ACCOUNT_IPC.switchAccount, () => controller?.switchAccount()],
    [ACCOUNT_IPC.continueAccount, () => {
      const snapshot = controller?.snapshot()
      if (!readyForWorkspace(snapshot))
        throw new Error('account: not ready to continue')
      return options.enter()
    }],
    [ACCOUNT_IPC.cancel, () => { browserLogin = false; return controller?.cancel() }],
    [ACCOUNT_IPC.reopen, () => controller?.reopen()],
    [ACCOUNT_IPC.refresh, () => controller?.refresh()],
    [ACCOUNT_IPC.quota, () => controller?.quota()],
    [ACCOUNT_IPC.logout, () => controller?.logout(() => options.confirmLogout())],
    [
      ACCOUNT_IPC.configure,
      (value) => {
        if (typeof value !== 'string') throw new Error('account: invalid address')
        browserLogin = false
        return controller?.configure(value).then(() => options.show())
      },
    ],
    [
      ACCOUNT_IPC.selectOrganization,
      (value) => {
        if (typeof value !== 'string') throw new Error('account: invalid organization')
        return controller?.selectOrganization(value)
      },
    ],
    [ACCOUNT_IPC.personalCenter, () => controller?.personalCenter()],
    [ACCOUNT_IPC.local, () => {
      browserLogin = false
      if (['waiting', 'exchanging'].includes(controller?.snapshot().phase ?? '')) void controller?.cancel()
      return options.local()
    }],
    [ACCOUNT_IPC.show, () => { browserLogin = false; return options.show() }],
  ]
  for (const [channel, action] of handlers)
    ipcMain.handle(channel, (event, value: unknown) => {
      authorize(event)
      return action(value)
    })
  app.on('will-quit', () => {
    controller?.dispose()
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  })
  return controller
}
