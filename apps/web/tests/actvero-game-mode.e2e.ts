/** 真实 Loader、原生会话与设置；仅操作系统窗口和账户/专家外部入口使用无凭据替身。 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { chromium, type Page } from 'playwright'
import { expect, it, onTestFinished, vi } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, openSettings, writeComposerDraft } from './support.ts'

function nativeFixtures(): void {
  const listeners = new Set<(value: { action: 'state'; state: { enabled: boolean; visible: boolean; material: 'vibrancy' } }) => void>()
  let enabled = false
  const account = { phase: 'ready', baseUrl: 'https://example.invalid', brand: { name: 'ACTVERO' },
    user: { id: 'game-test-user', name: 'Game test' }, organization: { tenantId: 'test', memberId: 'test', name: 'Test', status: 'active', needsLogin: false },
    organizations: [], quota: { phase: 'unconfigured', windows: [] } }
  const expert = { manifest: { schemaVersion: 1, id: 'game-expert', name: 'Survival expert', description: 'Test fixture',
    version: '1.0.0', avatar: '', tags: [], category: 'other', instructions: '', conversationStarters: [], skills: [], connectors: [] },
  bindings: { skills: {}, connectors: {} }, revision: 1 }
  Object.assign(window, {
    actveroAccount: { snapshot: async () => account, subscribe: (listener: (value: typeof account) => void) => {
      const change = () => { listener({ ...account, organization: { ...account.organization, tenantId: 'another-tenant' } }) }
      window.addEventListener('game-fixture-switch-organization', change)
      return () => { window.removeEventListener('game-fixture-switch-organization', change) }
    }, quota: async () => {}, refresh: async () => {} },
    actveroExperts: { subscribe: () => () => {}, request: async (action: string, input?: { sessionId?: string }) => {
      if (action === 'list' || action === 'recent') return [expert]
      if (action === 'selection') return { id: 'game-expert', snapshotId: 'fixture', name: 'Survival expert', avatar: '', version: '1.0.0' }
      if (action === 'select') return { sessionId: input?.sessionId }
      if (action === 'sources') return { remote: false }
      return null
    } },
    actveroGameMode: {
      configure: async (settings: unknown) => { document.documentElement.dataset.gameConfig = JSON.stringify(settings) },
      enable: async (value: boolean) => {
        enabled = value
        const state = { enabled, visible: true, material: 'vibrancy' as const }
        document.documentElement.dataset.gameEnabled = String(enabled)
        listeners.forEach((listener) => { listener({ action: 'state', state }) })
        return state
      },
      show: async () => { document.documentElement.dataset.gameHidden = 'false' },
      hide: async () => { document.documentElement.dataset.gameHidden = 'true' },
      state: async () => ({ enabled, visible: true, material: 'vibrancy' }),
      subscribe: (listener: Parameters<typeof listeners.add>[0]) => { listeners.add(listener); return () => listeners.delete(listener) },
    },
  })
}

it('keeps native drafts, saves slots, restores the theme and supports keyboard navigation at desktop and narrow widths', async () => {
  vi.stubEnv('ACTVERO_DESKTOP', '1')
  onTestFinished(() => { vi.unstubAllEnvs() })
  const scaffold = await launchGameScaffold()
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch({ channel: 'chrome' })
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  await page.addInitScript(nativeFixtures)
  const consoleLog = watchConsole(page)
  const artifacts = join(process.cwd(), '.artifacts', 'game-mode')
  mkdirSync(artifacts, { recursive: true })
  const shots = mkdtempSync(join(artifacts, 'run-'))
  console.info('Game mode screenshots:', shots)
  page.setDefaultTimeout(15000)
  try {
    await page.goto(scaffold.authenticatedUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.getByRole('button', { name: 'Enter game mode', exact: true }).waitFor()
    await writeComposerDraft(page, page.locator('[data-composer-input]'), 'Plan my next exploration route.')
    await openSettings(page, 'en')
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('button', { name: 'Game mode', exact: true }).click()
    await settings.getByLabel('Expert slots 1', { exact: true }).selectOption('game-expert')
    await settings.getByRole('button', { name: 'Save settings', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Settings saved' }).waitFor()
    await page.screenshot({ path: join(shots, 'settings.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await settings.waitFor({ state: 'hidden' })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      const before = await page.evaluate(() => document.body.style.background)
      await page.getByRole('button', { name: 'Enter game mode', exact: true }).click()
      await page.getByRole('button', { name: 'Exit game mode', exact: true }).waitFor()
      expect(await page.locator('[data-composer-input]').innerText()).toContain('Plan my next exploration route.')
      expect(await page.evaluate(() => document.documentElement.dataset.gameConfig)).toContain('game-expert')
      for (const width of [1060, 390]) {
        await page.setViewportSize({ width, height: 760 })
        const control = page.getByRole('button', { name: width === 390 ? 'Game mode' : 'Exit game mode', exact: true })
        const bounds = await control.boundingBox()
        expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width).toBe(true)
        await gameAction(page, 'Choose expert')
        const picker = page.getByRole('dialog', { name: 'Choose expert', exact: true })
        await picker.waitFor()
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => page.locator('.actvero-game-slot[aria-pressed=true]').innerText()).toContain('2')
        await page.keyboard.press('ArrowLeft')
        expect(await picker.getByRole('button', { name: /Survival expert/ }).isVisible()).toBe(true)
        await page.screenshot({ path: join(shots, `experts-${scheme}-${width}.png`), animations: 'disabled' })
        if (width === 1060) await picker.getByRole('button', { name: /Survival expert/ }).click()
        else await page.keyboard.press('Escape')
        await picker.waitFor({ state: 'hidden' })
        expect(await page.locator('[data-composer-input]').innerText()).toContain('Plan my next exploration route.')
        const inputFill = await page.locator('[data-composer-input]').evaluate(element =>
          getComputedStyle(element).getPropertyValue('--dsw-specific-input-major').trim())
        expect(inputFill).toBe('rgba(48,55,61,.76)')
        await page.screenshot({ path: join(shots, `chat-${scheme}-${width}.png`), animations: 'disabled' })
      }
      await page.setViewportSize({ width: 1060, height: 760 })
      await page.getByRole('button', { name: 'Return to game', exact: true }).click()
      expect(await page.evaluate(() => document.documentElement.dataset.gameHidden)).toBe('true')
      await page.getByRole('button', { name: 'Exit game mode', exact: true }).click()
      await expect.poll(() => page.evaluate(() => document.body.style.background)).toBe(before)
    }
    await page.getByRole('button', { name: 'Enter game mode', exact: true }).click()
    await page.getByRole('button', { name: 'Exit game mode', exact: true }).waitFor()
    await page.evaluate(() => { window.dispatchEvent(new Event('game-fixture-switch-organization')) })
    await page.getByRole('button', { name: 'Enter game mode', exact: true }).waitFor()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.gameEnabled)).toBe('false')
    await page.reload()
    await openSettings(page, 'en')
    await settings.getByRole('button', { name: 'Game mode', exact: true }).click()
    expect(await settings.getByLabel('Expert slots 1', { exact: true }).inputValue()).toBe('game-expert')
    await expect((await settings.locator('.actvero-game-fields').first().innerText()) + '\n')
      .toMatchFileSnapshot(join(import.meta.dirname, 'expected', 'game-mode-slots.txt'))
    expect(consoleLog.pageErrors).toEqual([])
  } catch (error) {
    writeFileSync(join(shots, 'failure.html'), await page.content())
    console.warn(await settingsSnapshot(page))
    await page.screenshot({ path: join(shots, 'failure.png'), animations: 'disabled' }).catch((error: unknown) => { console.warn('Failed to capture game mode diagnostic screenshot', error) })
    throw error
  }
}, 90000)

async function gameAction(page: Page, name: string): Promise<void> {
  const menu = page.getByRole('button', { name: 'Game mode', exact: true })
  if (await menu.isVisible()) {
    await menu.click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  } else await page.getByRole('button', { name, exact: true }).click()
}

async function settingsSnapshot(page: Page) {
  return await page.locator('select').evaluateAll(elements => elements.map(element => ({
    aria: element.getAttribute('aria-label'), text: element.textContent,
  })))
}

/** 通过已安装的组合包激活，保持与插件管理器一致的加载路径。 */
function launchGameScaffold(withoutExperts = false) {
  const resolve = createRequire(new URL('../../../packages/bundle/web-app/package.json', import.meta.url)).resolve
  return launchWebScaffold({ ...(withoutExperts ? { extraOverlayPath: join(import.meta.dirname, 'game-mode-no-experts.overlay.yml') } : {}), profile: { hmr: false, packages: [
    { dir: dirname(resolve('@actvero/dsh-game-mode/package.json')), enabled: true },
  ] } })
}

it.each(['window bridge', 'expert service'])('shows a persistent compatibility message without the %s', async (missing) => {
  vi.stubEnv('ACTVERO_DESKTOP', '1')
  onTestFinished(() => { vi.unstubAllEnvs() })
  const scaffold = await launchGameScaffold(missing === 'expert service')
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch({ channel: 'chrome' })
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  if (missing === 'expert service') await page.addInitScript(nativeFixtures)
  const consoleLog = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  await page.getByRole('button', { name: 'Game mode', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('status').filter({ hasText: 'This app does not include' }).waitFor()
  expect(await page.getByRole('button', { name: 'Enter game mode', exact: true }).count()).toBe(0)
  await expect((await settings.getByRole('status').innerText()) + '\n')
    .toMatchFileSnapshot(join(import.meta.dirname, 'expected', 'game-mode-unavailable.txt'))
  expect(consoleLog.pageErrors).toEqual([])
}, 90000)
