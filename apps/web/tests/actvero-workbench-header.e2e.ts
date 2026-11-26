/** Empty workbench defaults and author-owned headers in the shipped Web composition. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { expect, it } from 'vitest'
import type { WorkbenchId } from '@actvero/dsh-capability-ui'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { initialShortcutConfig } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

declare global {
  interface Window { __headerTarget: { waiting: boolean; finish(): void } }
}

async function setPlatform(page: Page, platform: string) {
  await page.addInitScript(({ value, snapshot }) => {
    if (value !== 'browser') Object.assign(window, { dshDesktop: { protocolVersion: 1,
      keyboard: { subscribe: () => () => {}, closeWindow: async () => {} },
      shortcuts: { get: async () => ({ ...snapshot, status: 'ready' }),
        subscribe: () => () => {}, recording: async () => {},
        edit: async () => ({ status: 'not-ready', snapshot }) },
    } })
    const mark = () => {
      document.documentElement.toggleAttribute('data-windows-titlebar', value === 'windows')
      if (value === 'darwin') document.documentElement.dataset.platform = value
      document.documentElement.style.setProperty('--dsh-windows-titlebar-height', '40px')
    }
    if (document.documentElement === null) document.addEventListener('DOMContentLoaded', mark, { once: true })
    else mark()
  }, { value: platform, snapshot: initialShortcutConfig() })
}

it.each(['browser', 'darwin', 'windows'])('%s gives a custom header the whole business region and restores the default on another workbench', async (platform) => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-header-'))
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  const errors: string[] = []
  try {
    await mkdir(join(process.cwd(), '.artifacts'), { recursive: true })
    const name = '@local/header-acceptance'
    const packages = []
    for (const kind of ['custom', 'default']) {
      const directory = join(root, kind)
      await mkdir(directory)
      packages.push({ dir: directory, enabled: true })
      const packageName = `${name}-${kind}`
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0', type: 'module',
        exports: { '.': './index.js', './client': './client.js' },
        dsh: { actveroWorkbench: 1, bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['@actvero/dsh-capability-ui'] } },
      }))
      await writeFile(join(directory, 'cordis.patch.yml'), `- insert:\n    - id: header-${kind}\n      name: ${JSON.stringify(packageName)}\n`)
      await writeFile(join(directory, 'index.js'), `export const inject = ['actveroWorkbenchRuntime'];
      export function apply(ctx) { const id = '${kind}'; ctx.effect(() => ctx.actveroWorkbenchRuntime.register({
        id: '${name}-' + id, name: id + ' identity', version: '1.0.0', ai: id === 'custom',
        resolveObject: async id => { if (id === 'missing') throw new Error('Missing object'); return { label: id }; } })); }`)
      await writeFile(join(directory, 'client.js'), `window.__ModuleLoader__.load({ id: '${packageName}', factory(require) {
      const { createElement: h } = require('react');
      let selected = 'project-a'; let delay = false;
      const targetState = { waiting: false, finish() {} };
      if ('${kind}' === 'custom') window.__headerTarget = targetState;
      async function conversationTarget() {
        const target = selected;
        if (target === 'fail') throw new Error('Preparation failed');
        if (delay) { targetState.waiting = true; await new Promise(resolve => { targetState.finish = resolve; }); targetState.waiting = false; }
        return target === 'all' ? null : target;
      }
      function Header() { return h('div', { 'data-author-header': '', style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
        h('button', { onClick: event => { event.currentTarget.textContent = 'Saved by author'; } }, 'Save drawing'),
        h('input', { 'aria-label': 'Find in drawing', style: { minWidth: 0, width: 120 } })); }
      function Body(p) { return h('div', null, h('output', { 'aria-label': 'Opened object' }, p.workbench.location?.objectId ?? ''), h('p', null, 'Business content'),
        h('select', { 'aria-label': 'Project', defaultValue: selected, onChange: e => { selected = e.target.value; } },
          ...['project-a', 'project-b', 'all', 'fail'].map(id => h('option', { key: id, value: id }, id))),
        h('input', { type: 'checkbox', 'aria-label': 'Delay preparation', onChange: e => { delay = e.target.checked; } })); }
      return { inject: ['actveroWorkbenches'], apply(ctx) {
        const id = '${kind}'; ctx.effect(() => ctx.actveroWorkbenches.register({
          id: '${name}-' + id, name: id + ' identity', description: 'Header acceptance', version: '1.0.0'
        }, Body, id === 'custom' ? { header: Header, catalogButton: 'hide', conversationTarget, objectNavigation: true } : undefined));
      } };
    } });`)
    }
    const overlay = join(root, 'test.patch.yml')
    await writeFile(overlay, '- id: actvero-capability-ui\n  disabled: false\n')
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, profile: { packages } })
    for (const bundle of await scaffold.ctx.pluginManager.listBundles()) {
      if (bundle.name.startsWith(name)) expect(bundle.error, JSON.stringify(bundle.error)).toBeUndefined()
    }
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    await setPlatform(page, platform)
    const log = watchConsole(page)
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const rail = page.locator('[data-navigation-column] nav')
    const home = rail.getByRole('button', { name: 'Home', exact: true })
    const conversations = page.locator('#sidebar-conversations')
    const positions = () => rail.getByRole('button').evaluateAll(nodes => nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return [box.x, box.y]
    }))
    await home.waitFor()
    const glyphColor = (button: Locator) => button.locator('svg').evaluate(el => getComputedStyle(el).color)
    const workbenches = rail.getByRole('button', { name: 'Workbenches', exact: true })
    const capabilities = rail.getByRole('button', { name: 'Capability Center', exact: true })
    const toolbar = page.locator('[data-navigation-toolbar]')
    const toolbarButton = toolbar.locator('button[aria-controls="sidebar-conversations"]')
    const divider = page.locator('[data-navigation-column]')
    const geometry = async () => {
      const [bar, toggle, column] = await Promise.all([toolbar.boundingBox(), toolbarButton.boundingBox(), divider.boundingBox()])
      expect(toggle!.y).toBeGreaterThanOrEqual(bar!.y)
      expect(toggle!.y + toggle!.height).toBeLessThanOrEqual(column!.y + 1)
      return [toggle!.x, toggle!.y, column!.y]
    }
    const back = toolbar.getByRole('button', { name: 'Back', exact: true })
    const forward = toolbar.getByRole('button', { name: 'Forward', exact: true })
    const edges = () => page.evaluate(() => {
      const rail = document.querySelector('[data-navigation-column]')!
      const center = document.querySelector('[data-module-surface]') ?? document.querySelector('[data-rightbar-col]')!.previousElementSibling!
      return [getComputedStyle(rail, '::after').bottom, getComputedStyle(center).borderTopLeftRadius,
        getComputedStyle(center).borderBottomLeftRadius]
    })
    await back.waitFor()
    expect(await forward.isDisabled()).toBe(true)
    expect(await edges()).toEqual(['8px', '12px', '0px'])
    const wideBack = (await back.boundingBox())!.x
    const chrome = await geometry()
    if (platform === 'darwin') expect(chrome[0]).toBe(88)
    if (platform === 'darwin') {
      expect(chrome[2]).toBe(50)
      const newSession = conversations.getByRole('button', { name: 'New session', exact: true })
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, colorScheme === 'dark')
        const idleColor = await glyphColor(conversations.getByRole('button', { name: 'Add workspace', exact: true }))
        const selectedColor = await glyphColor(home)
        expect(idleColor).not.toBe(selectedColor)
        for (const entry of [workbenches, capabilities]) {
          expect(await glyphColor(entry)).toBe(idleColor)
          await entry.hover()
          expect(await glyphColor(entry)).toBe(selectedColor)
          await page.mouse.move(650, 200)
        }
        const fill = () => newSession.evaluate(el => getComputedStyle(el).backgroundColor)
        const rest = await fill()
        expect(rest).not.toBe('rgba(0, 0, 0, 0)')
        await newSession.hover()
        expect(await fill()).not.toBe(rest)
        await page.mouse.move(650, 200)
      }
      await page.emulateMedia({ colorScheme: 'light' })
      expect((await newSession.boundingBox())!.height).toBe(38)
      expect(await newSession.evaluate((el) => {
        const icon = el.querySelector('svg')!.getBoundingClientRect()
        const label = el.querySelector('svg + span')!.getBoundingClientRect()
        const button = el.getBoundingClientRect()
        return Math.abs((icon.left + label.right - button.left - button.right) / 2)
      })).toBeLessThan(1)
      await newSession.press('Enter')
      await page.locator('[data-conversation-content][data-content-phase="hero"]').waitFor()
      await page.screenshot({ path: join(process.cwd(), '.artifacts/new-session-docked-toolbar.png'), clip: { x: 0, y: 0, width: 390, height: 138 } })
      const dockEdge = () => conversations.evaluate(el => el.getBoundingClientRect().right)
      const forwardEdge = () => forward.evaluate(el => el.getBoundingClientRect().right)
      const initialEdge = await dockEdge()
      expect(await forwardEdge()).toBe(initialEdge - 8)
      await page.mouse.move(initialEdge, 200)
      await page.mouse.down()
      await page.mouse.move(initialEdge + 48, 200)
      await page.mouse.up()
      await expect.poll(dockEdge).toBe(initialEdge + 48)
      expect(await forwardEdge()).toBe(await dockEdge() - 8)
      expect(await geometry()).toEqual(chrome)
      await toolbarButton.click()
      await conversations.waitFor({ state: 'hidden' })
      await toolbar.getByRole('button', { name: 'New session', exact: true }).waitFor()
      expect(await edges()).toEqual(['0px', '0px', '0px'])
      const newChat = page.locator('[data-conversation-content][data-content-phase="hero"]')
      await newChat.waitFor()
      expect(await newChat.evaluate((el) => {
        const style = getComputedStyle(el)
        return [style.borderTopLeftRadius, style.borderBottomLeftRadius, style.borderTopStyle, style.borderLeftStyle]
      })).toEqual(['12px', '0px', 'solid', 'solid'])
      expect((await newChat.boundingBox())!.y).toBe((await divider.boundingBox())!.y)
      expect(await divider.evaluate(el => getComputedStyle(el, '::after').width)).toBe('0px')
      await page.screenshot({ path: join(process.cwd(), '.artifacts/new-session-collapsed-corner.png'), clip: { x: 0, y: 0, width: 390, height: 138 } })
      expect((await back.boundingBox())!.x).toBe(chrome[0]! + 36)
      await toolbarButton.click()
      await conversations.waitFor()
      expect(await toolbar.getByRole('button').count()).toBe(3)
      expect(await forwardEdge()).toBe(await dockEdge() - 8)
    }
    const fixed = await positions()
    expect(fixed).toHaveLength(5)
    for (const name of ['Workbenches', 'Capability Center', 'Plugins', 'Automation tasks']) {
      await rail.getByRole('button', { name, exact: true }).click()
      await conversations.waitFor({ state: 'hidden' })
      expect(await positions()).toEqual(fixed)
      expect(await edges()).toEqual(['0px', '12px', '0px'])
      const surface = page.locator('[data-module-surface]')
      expect((await surface.boundingBox())!.y).toBe((await divider.boundingBox())!.y)
      expect(await toolbarButton.count()).toBe(0)
      expect(await page.locator('[data-navigation-column]').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(52, 0)
      expect(await back.isDisabled()).toBe(true)
      expect(await forward.isDisabled()).toBe(true)
    }
    expect((await back.boundingBox())!.x).toBeLessThan(wideBack)
    const taskFilters = page.getByRole('group', { name: 'Task status' })
    const filter = taskFilters.getByRole('button').nth(1)
    await filter.click()
    if (platform === 'darwin') {
      const arrows = () => toolbar.locator('[data-window-history] button').evaluateAll(buttons => buttons.map((button) => {
        const icon = getComputedStyle(button.querySelector('svg')!)
        const pixel = document.createElement('canvas').getContext('2d')!
        pixel.fillStyle = icon.color
        pixel.fillRect(0, 0, 1, 1)
        const [r, g, b] = Array.from(pixel.getImageData(0, 0, 1, 1).data, (v) => {
          const c = v / 255
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return { color: icon.color, luminance: 0.2126 * r! + 0.7152 * g! + 0.0722 * b!, weight: parseFloat(icon.strokeWidth) }
      }))
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, colorScheme === 'dark')
        await page.mouse.move(650, 200)
        const [enabled, disabled] = await arrows()
        expect(enabled!.color).toBe(await glyphColor(workbenches))
        const lighter = colorScheme === 'light' ? disabled! : enabled!
        const darker = colorScheme === 'light' ? enabled! : disabled!
        expect((lighter.luminance + 0.05) / (darker.luminance + 0.05)).toBeGreaterThan(2.5)
        expect(enabled!.weight).toBeGreaterThan(disabled!.weight)
        await back.press('Enter')
        await expect.poll(() => back.isDisabled()).toBe(true)
        expect(await arrows()).toEqual([disabled, enabled])
        await forward.click()
        await expect.poll(() => forward.isDisabled()).toBe(true)
      }
      await page.emulateMedia({ colorScheme: 'light' })
    }
    await back.click()
    expect(await taskFilters.getByRole('button').first().getAttribute('aria-pressed')).toBe('true')
    await rail.getByRole('button', { name: 'Capability Center' }).click()
    const skills = page.getByRole('tab', { name: 'Skills', exact: true })
    await skills.click()
    await back.click()
    await expect.poll(() => page.getByRole('tab', { name: 'Experts', exact: true }).getAttribute('aria-selected')).toBe('true')
    await forward.click()
    expect(await skills.getAttribute('aria-selected')).toBe('true')
    await rail.getByRole('button', { name: 'Plugins', exact: true }).click()
    const morePlugins = page.locator('[data-plugin-group="extensions"]').getByRole('button', { name: 'More', exact: true })
    await morePlugins.click()
    await back.click()
    await morePlugins.waitFor()
    await forward.click()
    await page.getByRole('heading', { name: 'Experimental plugins', level: 1 }).waitFor()
    await rail.getByRole('button', { name: 'Automation tasks' }).click()
    await forward.click()
    expect(await filter.getAttribute('aria-pressed')).toBe('true')
    await home.hover()
    await conversations.waitFor()
    const preview = (await conversations.boundingBox())!
    expect(preview.x).toBe(56)
    expect(preview.width).toBe(264)
    expect(preview.y + preview.height).toBe(892)
    const homeRow = (await home.boundingBox())!
    await page.mouse.move(preview.x - 2, homeRow.y + homeRow.height / 2)
    expect(await conversations.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(rect.left - 2, rect.top + 16))
    })).toBe(true)
    await page.setViewportSize({ width: 1440, height: 180 })
    const tree = conversations.getByRole('tree')
    await expect.poll(() => tree.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    expect(await conversations.evaluate(el => el.getBoundingClientRect().bottom)).toBe(172)
    await page.setViewportSize({ width: 1440, height: 900 })
    expect(await rail.getByRole('button', { name: 'Automation tasks' }).getAttribute('aria-current')).toBe('page')
    await conversations.getByRole('button', { name: 'New session', exact: true }).hover()
    await page.keyboard.press('Escape')
    await conversations.waitFor({ state: 'hidden' })
    await home.press('ArrowRight')
    await conversations.waitFor()
    await page.keyboard.press('Escape')
    await home.click()
    await conversations.waitFor()
    await toolbarButton.click()
    await conversations.waitFor({ state: 'hidden' })
    await home.click()
    await home.press('Enter')
    expect(await toolbarButton.getAttribute('aria-expanded')).toBe('false')
    await rail.getByRole('button', { name: 'Workbenches', exact: true }).click()
    await home.hover()
    await conversations.waitFor()
    await home.click()
    await conversations.waitFor({ state: 'hidden' })
    expect(await toolbarButton.getAttribute('aria-expanded')).toBe('false')
    await toolbarButton.click()
    await conversations.waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await conversations.waitFor({ state: 'hidden' })
    await home.click()
    expect(await toolbarButton.getAttribute('aria-expanded')).toBe('false')
    await toolbarButton.click()
    await home.click()
    expect(await toolbarButton.getAttribute('aria-expanded')).toBe('true')
    await toolbarButton.click()
    await page.setViewportSize({ width: 1440, height: 900 })
    await conversations.waitFor()
    expect(await positions()).toEqual(fixed)
    await rail.getByRole('button', { name: 'Workbenches', exact: true }).click()
    await page.getByRole('tab', { name: 'My workbenches', exact: true }).click()
    await page.getByRole('heading', { name: 'custom identity', exact: true }).waitFor()
    const show = async (id: string) => {
      const result = await scaffold!.ctx.actveroWorkbenchRuntime.present({ id: `${name}-${id}` as WorkbenchId,
        mode: 'business', sidebar: 'focus', ai: 'hide' }, AbortSignal.timeout(15_000))
      expect(result, JSON.stringify(result)).toMatchObject({ status: 'confirmed' })
    }
    expect(await page.getByRole('button', { name: /^Switch workbench/ }).count()).toBe(0)
    await page.getByRole('tab', { name: 'Platform workbenches' }).click()
    await back.click()
    expect(await page.getByRole('tab', { name: 'My workbenches' }).getAttribute('aria-selected')).toBe('true')
    await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'custom identity' }) }).getByRole('button', { name: 'Open', exact: true }).click()
    expect(await forward.isDisabled()).toBe(true)
    await back.click()
    await page.getByRole('heading', { name: 'Workbenches', exact: true }).waitFor()
    await forward.click()
    await page.locator('[data-author-header]').waitFor()
    const objectOpened = await scaffold.ctx.actveroWorkbenchRuntime.present({ id: `${name}-custom` as WorkbenchId,
      mode: 'business', objectId: 'project-b' as import('@actvero/dsh-capability-ui').WorkbenchObjectId, ai: 'hide' }, AbortSignal.timeout(15_000))
    expect(objectOpened).toMatchObject({ status: 'confirmed' })
    await expect.poll(() => page.getByLabel('Opened object').innerText()).toBe('project-b')
    const missingObject = await scaffold.ctx.actveroWorkbenchRuntime.present({ id: `${name}-custom` as WorkbenchId,
      mode: 'business', objectId: 'missing' as import('@actvero/dsh-capability-ui').WorkbenchObjectId, ai: 'hide' }, AbortSignal.timeout(15_000))
    expect(missingObject).toMatchObject({ status: 'failed' })
    const invalidObjectMode = await scaffold.ctx.actveroWorkbenchRuntime.present({ id: `${name}-custom` as WorkbenchId,
      mode: 'preview', objectId: 'project-a' as import('@actvero/dsh-capability-ui').WorkbenchObjectId }, AbortSignal.timeout(15_000))
    expect(invalidObjectMode).toMatchObject({ status: 'failed' })
    const header = page.locator('[data-workbench-header]')
    await header.getByRole('textbox', { name: 'Find in drawing' }).fill('node A')
    await header.getByRole('button', { name: 'Save drawing' }).click()
    await header.getByRole('button', { name: 'Saved by author' }).waitFor()
    expect(await header.innerText()).toBe('Saved by author')
    expect(await header.locator('[data-author-header]').count()).toBe(1)
    expect(await page.locator('[data-workbench-default-header]').count()).toBe(0)
    expect(await header.locator('..').getByRole('button', { name: 'Back to workbenches', exact: true }).count()).toBe(0)
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await page.setViewportSize({ width: 390, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await header.getByRole('textbox', { name: 'Find in drawing' }).inputValue()).toBe('node A')
      expect(await header.getByRole('button', { name: 'Saved by author' }).isVisible()).toBe(true)
    }
    // Native window controls clear the business header beside the fixed rail.
    const frame = page.locator('[data-shell-bottom]').locator('..')
    const row = header.locator('..')
    const checkHeaderGeometry = async (collapsed: boolean, fullscreen = false) => {
      const geometry = await row.evaluate((element) => {
        const rectangle = element.getBoundingClientRect()
        const leading = document.querySelector('[data-shell-leading]')?.getBoundingClientRect()
        const parent = element.parentElement!.getBoundingClientRect()
        return { top: rectangle.top - parent.top, height: rectangle.height,
          inset: Number.parseFloat(getComputedStyle(element).paddingInlineStart),
          controlsShareRow: !leading || leading.top >= rectangle.top && leading.bottom <= rectangle.bottom,
          headerClearsControls: !leading || element.querySelector('[data-workbench-header]')!.getBoundingClientRect().left >= leading.right,
        }
      })
      if (platform === 'darwin') {
        const body = page.locator('[data-shell-panel-body]')
        expect(await body.evaluate(el => getComputedStyle(el).borderTopLeftRadius)).toBe('12px')
        expect((await body.boundingBox())!.y).toBe(chrome[2])
      }
      expect(geometry.top).toBe(0)
      expect(geometry.height).toBeGreaterThanOrEqual(50)
      expect(geometry.inset).toBe(platform === 'darwin' && collapsed ? fullscreen ? 36 : 112 : 20)
      expect(geometry.controlsShareRow).toBe(true)
      expect(geometry.headerClearsControls).toBe(true)
      expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await page.locator('[data-workbench-window-chrome]').count()).toBe(0)
    }
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { resolve() }))))
      await show('custom')
      await expect.poll(() => frame.getAttribute('data-sidebar-collapsed')).toBe('true')
      await expect.poll(() => page.locator('[data-shell-leading]').count()).toBe(platform === 'darwin' ? 1 : 0)
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        await checkHeaderGeometry(true)
        const input = header.getByRole('textbox', { name: 'Find in drawing' })
        await input.click()
        await input.press('End')
        await input.press('ArrowLeft')
        expect(await input.evaluate(element => document.activeElement === element)).toBe(true)
        expect(await input.inputValue()).toBe('node A')
        await header.getByRole('button', { name: 'Saved by author' }).click()
        await page.screenshot({ animations: 'disabled', path: join(process.cwd(), `.artifacts/workbench-header-${platform}-${width}-${colorScheme}.png`) })
      }
    }
    if (platform === 'darwin') {
      await page.evaluate(() => document.documentElement.setAttribute('data-fullscreen', ''))
      await checkHeaderGeometry(true, true)
      await page.evaluate(() => document.documentElement.removeAttribute('data-fullscreen'))
      await page.setViewportSize({ width: 1280, height: 844 })
      const input = await header.getByRole('textbox', { name: 'Find in drawing' }).elementHandle()
      await home.hover()
      await conversations.waitFor()
      await page.keyboard.press('Escape')
      await conversations.waitFor({ state: 'hidden' })
      await checkHeaderGeometry(true)
      expect(await page.evaluate(element => element?.isConnected, input)).toBe(true)
    }
    const framedContent = platform === 'darwin' ? page.locator('[data-shell-panel-body]') : page.locator('[data-module-surface]')
    expect({ contentCorner: await framedContent.evaluate(element => getComputedStyle(element).borderTopLeftRadius),
      separateWindowRows: await page.locator('[data-workbench-window-chrome]').count(),
      headerAtTop: await row.evaluate(element =>
        element.getBoundingClientRect().top === element.parentElement!.getBoundingClientRect().top),
      input: await header.getByRole('textbox', { name: 'Find in drawing' }).inputValue(),
    }).toMatchInlineSnapshot(`
      {
        "contentCorner": "12px",
        "headerAtTop": true,
        "input": "node A",
        "separateWindowRows": 0,
      }
    `)
    await page.setViewportSize({ width: 1440, height: 900 })
    const business = page.locator('[data-workbench-main]')
    const readBinding = (id: SessionId) => {
      const agent = scaffold!.ctx.agents.get(id)
      if (!agent) throw new Error('Missing associated agent')
      return scaffold!.ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench')
    }
    const binding = async () => {
      const id = await business.getAttribute('data-workbench-session')
      if (!id) throw new Error('Missing displayed conversation')
      return readBinding(id as SessionId)
    }
    const openAI = async () => {
      await page.getByRole('button', { name: 'Use AI', exact: true }).click()
      await page.locator('[data-workbench-ai]:not([hidden])').waitFor()
    }
    await page.getByRole('checkbox', { name: 'Delay preparation' }).check()
    await page.getByRole('button', { name: 'Use AI', exact: true }).click()
    await page.waitForFunction(() => window.__headerTarget.waiting)
    await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption('project-b')
    await page.evaluate(() => { window.__headerTarget.finish() })
    await page.locator('[data-workbench-ai]:not([hidden])').waitFor()
    const original = await business.getAttribute('data-workbench-session')
    expect({ header: await header.innerText(), object: (await binding())?.object?.id }).toMatchInlineSnapshot(`
      {
        "header": "Saved by author",
        "object": "project-a",
      }
    `)
    await page.getByRole('button', { name: 'Collapse', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Delay preparation' }).uncheck()
    await openAI()
    expect((await binding())?.object?.id).toBe('project-b')
    expect(await business.getAttribute('data-workbench-session')).not.toBe(original)
    expect(readBinding(original as SessionId)?.object?.id).toBe('project-a')
    await page.getByRole('button', { name: 'Collapse', exact: true }).click()
    await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption('project-a')
    await openAI()
    expect(await business.getAttribute('data-workbench-session')).toBe(original)
    await page.getByRole('button', { name: 'Collapse', exact: true }).click()
    await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption('all')
    await openAI()
    expect((await binding())?.object).toBeUndefined()
    await page.getByRole('button', { name: 'Collapse', exact: true }).click()
    await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption('fail')
    await page.getByRole('button', { name: 'Use AI', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button[aria-label="Use AI"]')?.disabled)
    expect(await page.locator('[data-workbench-ai]:not([hidden])').count()).toBe(0)
    await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption('project-a')
    await page.getByRole('checkbox', { name: 'Delay preparation' }).check()
    await page.getByRole('button', { name: 'Use AI', exact: true }).click()
    await page.waitForFunction(() => window.__headerTarget.waiting)
    await show('default')
    await page.evaluate(() => { window.__headerTarget.finish() })
    expect(await header.locator('[data-author-header]').count()).toBe(0)
    await header.getByRole('heading', { name: 'default identity' }).waitFor()
    expect(await page.locator('[data-workbench-default-header]').count()).toBe(1)
    expect(await header.locator('..').getByRole('button', { name: 'Back to workbenches', exact: true }).count()).toBe(1)
    expect(await page.locator('[data-workbench-ai]:not([hidden])').count()).toBe(0)
    const catalogReturn = page.getByRole('button', { name: 'Back to workbenches', exact: true })
    const checkDefaultAlignment = async () => {
      const offsets = await catalogReturn.evaluate((button) => {
        const center = (element: Element) => {
          const box = element.getBoundingClientRect()
          return box.top + box.height / 2
        }
        const navigation = button.closest('[data-workbench-navigation]')!
        const divider = navigation.querySelector(':scope > [aria-hidden="true"]')!
        const title = navigation.parentElement!.querySelector('[data-workbench-default-header]')!
        const leading = document.querySelector('[data-shell-leading]')
        return [divider, title, ...(leading ? [leading] : [])].map(element => Math.abs(center(element) - center(button)))
      })
      expect(Math.max(...offsets)).toBeLessThanOrEqual(1)
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await checkDefaultAlignment()
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    if (platform === 'darwin') {
      await home.hover()
      await conversations.waitFor()
      await checkDefaultAlignment()
      await page.keyboard.press('Escape')
      await conversations.waitFor({ state: 'hidden' })
    }
    await catalogReturn.hover()
    await page.getByRole('tooltip', { name: 'Back to workbenches', exact: true }).waitFor()
    expect(await catalogReturn.evaluate((button) => {
      const box = button.getBoundingClientRect()
      return button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
    })).toBe(true)
    await page.screenshot({ animations: 'disabled', path: join(process.cwd(), `.artifacts/workbench-default-header-${platform}.png`) })
    await catalogReturn.click()
    await page.getByRole('heading', { name: 'Workbenches', exact: true }).waitFor()
    expect(log.pageErrors).toEqual([])
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0]
    if (page) console.error({ errors, body: await page.locator('body').innerText() })
    throw error
  } finally {
    try { await browser?.close() } finally {
      try { await scaffold?.close() } finally { await rm(root, { recursive: true, force: true }) }
    }
  }
})

it.each(['browser', 'darwin'])('%s returns to earlier conversations on Home after visiting another module', async (platform) => {
  const root = await mkdtemp(join(tmpdir(), 'home-history-'))
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  try {
    const overlay = join(root, 'test.patch.yml')
    await writeFile(overlay, '- id: actvero-capability-ui\n  disabled: false\n')
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, developerTools: true })
    const seed = await readFile(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url), 'utf8')
    const first = await seedSession(scaffold, seed, 'navigation-first')
    const second = await seedSession(scaffold, seed, 'navigation-second')
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    await setPlatform(page, platform)
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitem', { name: 'In one list', exact: true }).click()
    const row = (id: SessionId) => page.locator(`[data-row-key="session:${id}"]`)
    await row(first).click()
    await row(second).click()
    const toggle = page.locator('[data-navigation-toolbar] button[aria-controls="sidebar-conversations"]')
    await toggle.click()
    const body = page.locator(`[data-sidebar-collapsed] [data-conversation-session="${second}"][data-content-phase="active"]`)
    await body.waitFor()
    if (platform === 'darwin') {
      expect((await body.boundingBox())!.y).toBe(50)
      expect((await page.locator('[data-navigation-column]').boundingBox())!.y).toBe(50)
    }
    expect(await body.evaluate((el) => {
      const header = el.parentElement!.querySelector('header')!
      const style = getComputedStyle(el)
      return {
        meetsHeader: el.getBoundingClientRect().top === header.getBoundingClientRect().bottom,
        headerRule: getComputedStyle(header).borderBottomWidth,
        corner: style.borderTopLeftRadius,
        bottomCorner: style.borderBottomLeftRadius,
        top: style.borderTopStyle,
        left: style.borderLeftStyle,
        railRule: getComputedStyle(document.querySelector('[data-navigation-column]')!, '::after').width,
      }
    })).toEqual({
      meetsHeader: true, headerRule: '0px', corner: '12px', bottomCorner: '0px', top: 'solid', left: 'solid', railRule: '0px',
    })
    await toggle.click()
    const menu = page.getByRole('button', { name: 'More actions', exact: true })
    await menu.click()
    expect(await page.locator('[data-conversation-tabs]').count()).toBe(0)
    await page.getByRole('menuitem', { name: 'Download session log', exact: true }).waitFor()
    await page.getByRole('menuitem', { name: 'Trajectory', exact: true }).click()
    const tools = page.getByRole('toolbar', { name: 'Trajectory toolbar' })
    await tools.waitFor()
    await menu.click()
    await page.getByRole('menuitem', { name: 'Chat', exact: true }).click()
    await tools.waitFor({ state: 'hidden' })
    expect(await page.getByRole('menu').count()).toBe(0)
    const rail = page.locator('[data-navigation-column] nav')
    await rail.getByRole('button', { name: 'Workbenches', exact: true }).click()
    await rail.getByRole('button', { name: 'Home', exact: true }).click()
    const toolbar = page.locator('[data-navigation-toolbar]')
    await toolbar.getByRole('button', { name: 'Back', exact: true }).click()
    await expect.poll(() => row(first).getAttribute('aria-selected')).toBe('true')
    await toolbar.getByRole('button', { name: 'Forward', exact: true }).click()
    await expect.poll(() => row(second).getAttribute('aria-selected')).toBe('true')
  } finally {
    try { await browser?.close() } finally {
      try { await scaffold?.close() } finally { await rm(root, { recursive: true, force: true }) }
    }
  }
})

it('keeps a clean catalog empty even after restoring a retired sample selection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-empty-'))
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  try {
    const overlay = join(root, 'test.patch.yml')
    await writeFile(overlay, '- id: actvero-capability-ui\n  disabled: false\n')
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
    expect(scaffold.ctx.actveroWorkbenchRuntime.list()).toEqual([])
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const log = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const checkEmpty = async () => {
      await page.getByRole('button', { name: 'Workbenches', exact: true }).click()
      await page.getByRole('tab', { name: 'My workbenches', exact: true }).click()
      await page.getByText('No workbenches yet', { exact: true }).waitFor()
      expect(await page.getByText('No workbenches yet', { exact: true }).locator('..').innerText()).toMatchInlineSnapshot(`
        "No workbenches yet

        Import a workbench package or choose Develop workbench to create your own."
      `)
      expect(await page.getByText('Project checklist', { exact: true }).count()).toBe(0)
      expect(await page.getByText('DSH Workbenches', { exact: true }).count()).toBe(0)
      expect(await page.getByRole('button', { name: 'Clear search', exact: true }).count()).toBe(0)
      expect(await page.getByRole('button', { name: /^Switch workbench/ }).count()).toBe(0)
    }
    await checkEmpty()
    await page.evaluate(() => { localStorage.setItem('actvero.workbenches.selected.v1', 'builtin:project-checklist') })
    await page.reload({ waitUntil: 'load' })
    await checkEmpty()
    expect(log.pageErrors).toEqual([])
  } finally {
    try { await browser?.close() } finally {
      try { await scaffold?.close() } finally { await rm(root, { recursive: true, force: true }) }
    }
  }
})
