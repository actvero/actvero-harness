/** Workbench authors own the complete header; omitted headers retain a minimal identity. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import type { WorkbenchId } from '@actvero/dsh-capability-ui'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

it('gives a custom header the whole business region and restores the default on another workbench', async () => {
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
        id: '${name}-' + id, name: id + ' identity', version: '1.0.0', ai: false })); }`)
      await writeFile(join(directory, 'client.js'), `window.__ModuleLoader__.load({ id: '${packageName}', factory(require) {
      const { createElement: h } = require('react');
      function Header() { return h('div', { 'data-author-header': '', style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
        h('button', { onClick: event => { event.currentTarget.textContent = 'Saved by author'; } }, 'Save drawing'),
        h('input', { 'aria-label': 'Find in drawing', style: { minWidth: 0, width: 120 } })); }
      function Body() { return h('p', null, 'Business content'); }
      return { inject: ['actveroWorkbenches'], apply(ctx) {
        const id = '${kind}'; ctx.effect(() => ctx.actveroWorkbenches.register({
          id: '${name}-' + id, name: id + ' identity', description: 'Header acceptance', version: '1.0.0'
        }, Body, id === 'custom' ? { header: Header } : undefined));
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
    const header = page.locator('[data-workbench-header]')
    await header.getByRole('textbox', { name: 'Find in drawing' }).fill('node A')
    await header.getByRole('button', { name: 'Save drawing' }).click()
    await header.getByRole('button', { name: 'Saved by author' }).waitFor()
    expect(await header.innerText()).toBe('Saved by author')
    expect(await header.locator('[data-author-header]').count()).toBe(1)
    expect(await page.locator('[data-workbench-default-header]').count()).toBe(0)
    expect(await header.locator('..').getByRole('button', { name: 'Back to workbenches', exact: true }).count()).toBe(1)
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await page.setViewportSize({ width: 390, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await header.getByRole('textbox', { name: 'Find in drawing' }).inputValue()).toBe('node A')
      expect(await header.getByRole('button', { name: 'Saved by author' }).isVisible()).toBe(true)
    }
    await show('default')
    expect(await header.locator('[data-author-header]').count()).toBe(0)
    await header.getByRole('heading', { name: 'default identity' }).waitFor()
    expect(await page.locator('[data-workbench-default-header]').count()).toBe(1)
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
