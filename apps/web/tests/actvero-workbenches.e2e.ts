/** Original workbench host composed with the shipped Desktop Host and a local fixture bundle. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { describe, expect, it, vi } from 'vitest'
import { DesktopHostProcess } from '../../desktop/src/host-process.ts'
import { DesktopProjectManager } from '../../desktop/src/project-manager.ts'
import { resolveDesktopPaths } from '../../desktop/src/paths.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../../desktop/src/host-protocol.ts'
import { prepareDevelopmentProject } from '../../desktop/scripts/development-project.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtureName = 'actvero-workbench-migration-fixture'
const title = '迁移验收工作台'

function version(path: string): string {
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version
}

describe.skipIf(!existsSync(join(repository, 'apps/desktop-host/lib/index.js')))('ACTVERO workbench migration', () => {
  it('loads a local provider, keeps native chat, restores switching and fits narrow layouts', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'actvero-workbenches-')))
    let host: DesktopHostProcess | undefined
    try {
      for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD/u.test(name)) vi.stubEnv(name, undefined)
      const home = join(root, 'home')
      mkdirSync(home)
      vi.stubEnv('DSH_HOME', home)
      vi.stubEnv('DSH_TELEMETRY_MODE', 'DISABLED')
      vi.stubEnv('ACTVERO_DESKTOP', '1')
      const project = prepareDevelopmentProject({
        projectDir: join(root, 'project'), cliDir: join(repository, 'apps/cli'),
        hostDir: join(repository, 'apps/desktop-host'), dependencyDir: join(repository, 'node_modules/.pnpm/node_modules'),
        release: { schemaVersion: 1, version: version(join(repository, 'apps/desktop/package.json')),
          pnpmVersion: version(join(repository, 'apps/desktop/node_modules/pnpm/package.json')),
          nodeVersion: process.versions.node, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION },
        target: 'mac-arm64',
      })
      const paths = resolveDesktopPaths(home)
      cpSync(join(repository, 'packages/skill/skill-office/assets'), join(root, 'runtime/office-skills'), { recursive: true })
      const nodeBin = join(root, 'runtime/primary-runtime/dependencies/node/bin')
      mkdirSync(nodeBin, { recursive: true })
      cpSync(process.execPath, join(nodeBin, 'node'))
      await new DesktopProjectManager(paths, { dsh: project }).applyRelease()
      const fixture = join(root, 'fixture')
      mkdirSync(fixture)
      writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: fixtureName, version: '1.0.0', type: 'module',
        main: './index.js', exports: { '.': './index.js', './client': './client.js' },
        dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['dsh-desktop-workbenches'] } } }))
      writeFileSync(join(fixture, 'index.js'), `export const name = '${fixtureName}'; export function apply() {}`)
      writeFileSync(join(fixture, 'cordis.patch.yml'), `- insert:\n    - id: ${fixtureName}\n      name: ${fixtureName}\n`)
      writeFileSync(join(fixture, 'client.js'), `window.__ModuleLoader__.load({ id: '${fixtureName}', factory(require) {
        const React = require('react'), h = React.createElement;
        function Panel({ service, conversation }) {
          const [show, setShow] = React.useState(false);
          return h('section', { 'data-migration-fixture': '', 'data-current-session':service.currentSession() || '', style: {display:'flex',flexDirection:'column',flex:1,minWidth:0,minHeight:0,padding:24,boxSizing:'border-box',overflow:'auto'} },
            h('h1', null, '${title}'), h('p', null, '仅用于验证宿主迁移 / Workbench host migration verification'),
            h('button', {onClick:async () => {await service.ensureSession({folder:${JSON.stringify(root)}});setShow(true)}}, '打开 AI 协助'),
            show && h('div', {style:{display:'flex',flex:1,minHeight:300}}, conversation));
        }
        return { inject:['desktopWorkbenches'], apply(ctx) {
          const service = ctx.desktopWorkbenches;
          function OwnedPanel(props) {return h(Panel,{...props,service})}
          ctx.effect(() => service.register({title:'${title}',description:'宿主迁移验收示例',customFrame:true},OwnedPanel));
        } };
      }});`)
      const manifestPath = join(paths.profile, 'package.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
      manifest.dependencies[fixtureName] = `file:${fixture}`
      manifest.dsh.profile.bundles.push(fixtureName)
      writeFileSync(manifestPath, JSON.stringify(manifest))
      mkdirSync(join(paths.profile, 'node_modules'), { recursive: true })
      symlinkSync(fixture, join(paths.profile, 'node_modules', fixtureName), 'dir')
      writeFileSync(join(paths.profile, 'cordis.patch.yml'),
        "- id: actvero-workbenches\n  disabled: false\n- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n- id: web-runtime\n  config:\n    printUrl: false\n    openBrowser: false\n- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: '2026-09-28.1'\n" +
        readFileSync(join(repository, 'apps/web/tests/pin-browse-picker.overlay.yml'), 'utf8'))
      host = new DesktopHostProcess(process.execPath, project, paths.profile, undefined, process.env,
        undefined, undefined, undefined, undefined, (message) => {
          if (message.type === 'actvero:mcp:request' || message.type === 'actvero:skills:request')
            host?.sendCapabilityMessage({ type: message.type === 'actvero:mcp:request' ? 'actvero:mcp:result' : 'actvero:skills:result', id: message.id, value: [] })
          else if (message.type === 'actvero:experts:request')
            host?.sendCapabilityMessage({ type: 'actvero:experts:result', id: message.id, error: 'expert_not_found' })
        })
      const ready = await host.start()
      const browser = await chromium.launch({ channel: 'chrome' })
      try {
        const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
        const page = await context.newPage(), errors: string[] = []
        page.setDefaultTimeout(20_000)
        page.on('pageerror', (error) => { errors.push(error.message); console.error('Page error', error.message) })
        page.on('response', async (response) => { if (response.status() >= 500) console.error('Host failure', new URL(response.url()).pathname, await response.text()) })
        page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()) })
        await page.goto(ready.url)
        try { await page.getByRole('button', { name: '打开工作台主页', exact: true }).click() }
        catch (error) {
          await page.screenshot({ path: join(repository, '.artifacts/actvero-workbenches-failure.png') })
          console.error('Workbench boot', errors, await page.locator('body').innerText())
          throw error
        }
        await page.getByRole('tab', { name: /^已安装/ }).click()
        await page.getByText(title, { exact: true }).first().waitFor()
        await page.screenshot({ path: join(repository, '.artifacts/actvero-workbenches-installed.png') })
        await page.locator('.dshWbModeSwitch').click()
        await page.getByRole('menuitemradio').filter({ hasText: title }).click()
        await page.locator('[data-migration-fixture] h1').waitFor()
        expect(await page.locator('[data-migration-fixture] [contenteditable]').count()).toBe(0)
        await page.getByRole('button', { name: '打开 AI 协助', exact: true }).click()
        try { await page.locator('[data-migration-fixture] [contenteditable="true"]').first().waitFor() }
        catch (error) {
          await page.screenshot({ path: join(repository, '.artifacts/actvero-workbenches-conversation-failure.png') })
          console.error('Conversation boot', errors, await page.locator('body').innerText())
          throw error
        }
        expect(await page.locator('[data-migration-fixture]').count()).toBe(1)
        expect(await page.locator('[data-migration-fixture] [contenteditable="true"]').count()).toBe(1)
        for (const theme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: theme })
          for (const width of [1440, 900]) {
            await page.setViewportSize({ width, height: 1000 })
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
            await page.screenshot({ path: join(repository, `.artifacts/actvero-workbenches-${theme}-${width}.png`) })
          }
        }
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.getByRole('button', { name: '收起侧边栏', exact: true }).click()
        await page.setViewportSize({ width: 390, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: join(repository, '.artifacts/actvero-workbenches-collapsed-390.png') })
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
        const ownedSession = await page.locator('[data-migration-fixture]').getAttribute('data-current-session')
        await page.locator('.dshWbModeSwitch').click()
        await page.getByRole('menuitemradio', { name: '会话', exact: true }).click()
        await expect.poll(() => page.locator('[data-migration-fixture]').isVisible()).toBe(false)
        await page.locator('[contenteditable="true"]').first().waitFor()
        await expect.poll(async () => {
          const current = await page.locator('[data-migration-fixture]').getAttribute('data-current-session')
          return Boolean(current && current !== ownedSession)
        }, { timeout: 20_000 }).toBe(true)
        const expand = page.getByRole('button', { name: '打开侧边栏', exact: true })
        if (await expand.isVisible()) await expand.click()
        await page.locator('.dshWbModeSwitch').click()
        await page.getByRole('menuitemradio').filter({ hasText: title }).click()
        await page.reload()
        await page.locator('[data-migration-fixture] h1').waitFor()
        expect(errors).toEqual([])
      } finally { await browser.close() }
    } finally {
      await host?.stop()
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
