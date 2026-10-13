/** Mount the local React renderer before Electron reveals the welcome window. */
import '@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/gradient-shadow-text.css'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Welcome } from './WelcomePage.tsx'
import { ActveroWelcome } from './ActveroWelcome.tsx'
import type { WelcomeApi } from '../welcome-api.ts'

declare global {
  interface Window {
    dshWelcome: WelcomeApi
  }
}

const palette = window.matchMedia('(prefers-color-scheme: dark)')
const syncPalette = (): void => { document.body.toggleAttribute('data-ds-dark-theme', palette.matches) }
syncPalette()
palette.addEventListener('change', syncPalette)
window.addEventListener('pagehide', () => { palette.removeEventListener('change', syncPalette) }, { once: true })

const container = document.getElementById('root')
if (container === null) throw new Error('desktop welcome: missing React root')
const root = createRoot(container)
void (async () => {
  const account = await window.actveroAccount?.snapshot()
  document.body.toggleAttribute('data-actvero-welcome', !!account)
  flushSync(() => {
    root.render(account && window.actveroAccount
      ? <ActveroWelcome bridge={window.actveroAccount} initial={account} api={window.dshWelcome} />
      : <Welcome api={window.dshWelcome} />)
  })
})()
window.addEventListener('pagehide', () => { root.unmount() }, { once: true })
