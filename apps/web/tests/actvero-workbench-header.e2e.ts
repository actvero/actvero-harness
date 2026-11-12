/** Empty workbench defaults and author-owned headers in the shipped Web composition. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import type { WorkbenchId } from '@actvero/dsh-capability-ui'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { initialShortcutConfig } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

declare global {
  interface Window { __headerTarget: { waiting: boolean; finish(): void } }
}

it.each(['browser', 'darwin', 'windows'])('%s gives a custom header the whole business region and restores the default on another workbench', async (platform) => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-header-'))
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  const errors: string[] = []
  try {
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
    const log = watchConsole(page)
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.getByRole('button', { name: 'Workbenches', exact: true }).click()
    await page.getByRole('tab', { name: 'My workbenches', exact: true }).click()
    await page.getByRole('heading', { name: 'custom identity', exact: true }).waitFor()
    const show = async (id: string) => {
      const result = await scaffold!.ctx.actveroWorkbenchRuntime.present({ id: `${name}-${id}` as WorkbenchId,
        mode: 'business', sidebar: 'focus', ai: 'hide' }, AbortSignal.timeout(15_000))
      expect(result, JSON.stringify(result)).toMatchObject({ status: 'confirmed' })
    }
    await show('custom')
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
    // Desktop chrome must not consume the author's horizontal header space.
    const frame = page.locator('[data-shell-bottom]').locator('..')
    const windowChrome = page.locator('[data-workbench-window-chrome]')
    {
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 844 })
        // The frame records viewport changes through ResizeObserver and one animation frame.
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { resolve() }))))
        await show('custom')
        await expect.poll(() => frame.getAttribute('data-sidebar-collapsed')).toBe('true')
        await expect.poll(() => page.locator('[data-shell-leading]').count()).toBe(platform === 'darwin' ? 1 : 0)
        await expect.poll(() => windowChrome.evaluate(element => element.getBoundingClientRect().height)).toBe(platform === 'darwin' ? 48 : 0)
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme })
          const geometry = await header.evaluate((element) => {
            const row = element.parentElement!
            const page = row.parentElement!
            return { left: row.getBoundingClientRect().left - page.getBoundingClientRect().left,
              top: row.getBoundingClientRect().top - page.getBoundingClientRect().top,
              width: row.getBoundingClientRect().width, pageWidth: page.getBoundingClientRect().width,
              inset: Number.parseFloat(getComputedStyle(row).paddingInlineStart) }
          })
          expect(geometry).toEqual({ left: 0, top: platform === 'darwin' ? 48 : 0,
            width: geometry.pageWidth, pageWidth: geometry.pageWidth, inset: 20 })
          expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          const input = header.getByRole('textbox', { name: 'Find in drawing' })
          await input.click()
          await input.press('End')
          await input.press('ArrowLeft')
          expect(await input.evaluate(element => document.activeElement === element)).toBe(true)
          await header.getByRole('button', { name: 'Saved by author' }).click()
        }
      }
      if (platform === 'darwin') {
        await page.evaluate(() => document.documentElement.setAttribute('data-fullscreen', ''))
        expect(await windowChrome.evaluate(element => element.getBoundingClientRect().height)).toBe(48)
        await page.evaluate(() => document.documentElement.removeAttribute('data-fullscreen'))
        await page.setViewportSize({ width: 1280, height: 844 })
        await page.locator('[data-shell-leading]').getByRole('button', { name: 'Open sidebar', exact: true }).click()
        await expect.poll(() => frame.getAttribute('data-sidebar-collapsed')).toBeNull()
        expect(await windowChrome.isVisible()).toBe(false)
        expect(await header.getByRole('textbox', { name: 'Find in drawing' }).inputValue()).toBe('node A')
        await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
        await expect.poll(() => windowChrome.isVisible()).toBe(true)
      } else {
        expect(await windowChrome.isVisible()).toBe(false)
      }
    }
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
      await page.getByRole('button', { name: 'Switch workbench · Choose workbench', exact: true }).click()
      const menu = page.getByRole('menu')
      await menu.getByText('No workbenches yet', { exact: true }).waitFor()
      expect(await menu.getByRole('menuitem').count()).toBe(0)
      await page.keyboard.press('Escape')
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
