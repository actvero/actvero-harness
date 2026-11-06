/** Local workbench import and business navigation through the shipped Desktop Host. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { create } from 'tar'
import { describe, expect, it, vi } from 'vitest'
import { DesktopHostProcess } from '../../desktop/src/host-process.ts'
import { DesktopProjectManager } from '../../desktop/src/project-manager.ts'
import { resolveDesktopPaths } from '../../desktop/src/paths.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../../desktop/src/host-protocol.ts'
import { prepareDevelopmentProject } from '../../desktop/scripts/development-project.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtureName = 'actvero-manager-fixture'
const title = '活动复盘工作台'

function version(path: string): string {
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version
}

describe.skipIf(!existsSync(join(repository, 'apps/desktop-host/lib/index.js')))('Actvero workbench manager', () => {
  it('opens and persists the checklist, imports a bundle and reopens its business page after restarting the Host', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'actvero-workbench-manager-')))
    let host: DesktopHostProcess | undefined
    try {
      for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD/u.test(name)) vi.stubEnv(name, undefined)
      const home = join(root, 'home')
      mkdirSync(home)
      vi.stubEnv('DSH_HOME', home)
      vi.stubEnv('DSH_TELEMETRY_MODE', 'DISABLED')
      vi.stubEnv('ACTVERO_DESKTOP', '1')
      const pnpmDirectory = join(repository, 'apps/desktop/node_modules/pnpm')
      const project = prepareDevelopmentProject({
        projectDir: join(root, 'project'), cliDir: join(repository, 'apps/cli'),
        hostDir: join(repository, 'apps/desktop-host'), dependencyDir: join(repository, 'node_modules/.pnpm/node_modules'),
        release: { schemaVersion: 1, version: version(join(repository, 'apps/desktop/package.json')),
          pnpmVersion: version(join(pnpmDirectory, 'package.json')),
          nodeVersion: process.versions.node, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION },
        target: 'mac-arm64',
      })
      const paths = resolveDesktopPaths(home)
      cpSync(join(repository, 'packages/skill/skill-office/assets'), join(root, 'runtime/office-skills'), { recursive: true })
      const nodeBin = join(root, 'runtime/primary-runtime/dependencies/node/bin')
      mkdirSync(nodeBin, { recursive: true })
      cpSync(process.execPath, join(nodeBin, 'node'))
      await new DesktopProjectManager(paths, { dsh: project }).applyRelease()
      writeFileSync(join(paths.profile, 'cordis.patch.yml'), [
        '- id: webserver', '  config:', '    host: 127.0.0.1', '    port: 0',
        '- id: web-runtime', '  config:', '    printUrl: false', '    openBrowser: false',
        '- id: ui-settings-general', '  config:', "    welcomeNoticeVersion: '2026-09-28.1'", '',
      ].join('\n'))

      const folder = join(root, 'package')
      const archive = join(root, 'workbench.tgz')
      mkdirSync(folder)
      writeFileSync(join(folder, 'package.json'), JSON.stringify({
        name: fixtureName, version: '1.0.0', type: 'module',
        main: './index.js', exports: { '.': './index.js', './client': './client.js' },
        dsh: { actveroWorkbench: 1, bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['@actvero/dsh-capability-ui'] } },
      }))
      writeFileSync(join(folder, 'index.js'), `export const name = '${fixtureName}'; export function apply() {}`)
      writeFileSync(join(folder, 'cordis.patch.yml'), `- insert:\n    - id: ${fixtureName}\n      name: ${fixtureName}\n`)
      writeFileSync(join(folder, 'client.js'), `window.__ModuleLoader__.load({ id: '${fixtureName}', factory(require) {
        const h = require('react').createElement;
        function Panel() { return h('p', null, '已打开活动复盘业务页'); }
        return { inject: ['actveroWorkbenches'], apply(ctx) {
          ctx.effect(() => ctx.actveroWorkbenches.register({
            id: '${fixtureName}', name: '${title}', description: '整理活动结果与待跟进事项', version: '1.0.0', category: 'content'
          }, Panel));
        } };
      }});`)
      await create({ cwd: root, file: archive, gzip: true }, ['package/package.json', 'package/index.js', 'package/client.js', 'package/cordis.patch.yml'])

      function startHost() {
        host = new DesktopHostProcess(process.execPath, project, paths.profile, undefined, process.env,
          undefined, undefined, { pnpm: join(pnpmDirectory, 'bin/pnpm.cjs'), nodeBin: dirname(process.execPath) },
          undefined, (message) => {
            if (message.type === 'actvero:mcp:request' || message.type === 'actvero:skills:request') {
              host?.sendCapabilityMessage({ type: message.type === 'actvero:mcp:request' ? 'actvero:mcp:result' : 'actvero:skills:result', id: message.id, value: [] })
            } else if (message.type === 'actvero:experts:request') {
              host?.sendCapabilityMessage({ type: 'actvero:experts:result', id: message.id, error: 'expert_not_found' })
            }
          })
        return host.start()
      }
      const ready = await startHost()
      const browser = await chromium.launch({ channel: 'chrome' })
      try {
        const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
        // Chrome runs the same renderer without Electron's preload.
        await context.addInitScript((path) => {
          Object.defineProperty(globalThis, '__DSH_HOST_PATHS__', { value: { pathFor: () => path } })
        }, archive)
        const page = await context.newPage()
        page.setDefaultTimeout(15_000)
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text().split('\n')[0] ?? '') })
        page.on('response', async (response) => {
          if (response.status() >= 500) errors.push(`${new URL(response.url()).pathname}: ${await response.text()}`)
        })
        const openManager = async () => {
          await page.getByRole('button', { name: '工作台', exact: true }).click()
          await page.getByRole('heading', { name: '我的工作台' }).waitFor()
        }
        await page.goto(ready.url)
        await openManager()
        const fixtureCard = page.locator('article').filter({ has: page.getByRole('heading', { name: title }) })
        const example = page.locator('article').filter({ has: page.getByRole('heading', { name: '项目清单' }) })
        await page.getByRole('button', { name: '数据分析', exact: true }).click()
        await page.getByText('没有匹配的工作台').waitFor()
        await page.getByRole('button', { name: '清除筛选', exact: true }).click()
        await example.getByRole('button', { name: '打开', exact: true }).click()
        await page.getByRole('checkbox', { name: '确认需求和交付范围' }).check()
        await page.getByText('进度已保存在本机').waitFor()
        await page.reload()
        await openManager()
        await example.getByRole('button', { name: '打开', exact: true }).click()
        expect(await page.getByRole('checkbox', { name: '确认需求和交付范围' }).isChecked()).toBe(true)
        await page.getByRole('button', { name: '返回工作台列表' }).click()

        const picker = page.locator('input[type="file"][accept=".tgz"]')
        await picker.setInputFiles({ name: 'invalid.tgz', mimeType: 'application/gzip', buffer: Buffer.from('not an archive') })
        await page.getByText('请选择有效的 Actvero 工作台 .tgz 包。').waitFor()
        await picker.setInputFiles(archive)
        const installStatus = page.getByText(/工作台已安装。/)
        await installStatus.waitFor({ timeout: 40_000 })
        const needsRestart = (await installStatus.innerText()).includes('重启')
        const restart = async () => {
          await page.goto('about:blank')
          await host?.stop()
          const next = await startHost()
          await page.goto(next.url)
          await openManager()
        }
        if (needsRestart) await restart()
        try {
          await fixtureCard.waitFor()
        } catch (error) {
          console.error('Workbench failed to load', {
            needsRestart,
            profile: readFileSync(join(paths.profile, 'package.json'), 'utf8'),
            fixtureRequested: await page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('actvero-manager-fixture'))),
            bootEntry: await page.evaluate((name) => {
              const boot = (globalThis as { __DSH_BOOT__?: unknown }).__DSH_BOOT__
              return JSON.stringify(boot).includes(name)
            }, fixtureName),
            errors,
          })
          throw error
        }
        await page.getByRole('textbox', { name: '搜索工作台' }).fill('活动复盘')
        expect(await example.count()).toBe(0)
        await fixtureCard.getByRole('button', { name: '打开', exact: true }).click()
        await page.getByText('已打开活动复盘业务页').waitFor()
        if (!needsRestart) await restart()
        else await page.getByRole('button', { name: '返回工作台列表' }).click()
        await fixtureCard.getByRole('button', { name: '打开', exact: true }).click()
        await page.getByText('已打开活动复盘业务页').waitFor()

        await page.getByRole('button', { name: '返回工作台列表' }).click()
        mkdirSync(join(repository, '.artifacts'), { recursive: true })
        await page.screenshot({ path: join(repository, '.artifacts/actvero-workbench-manager.png') })
        const collapseSidebar = page.getByRole('button', { name: '收起侧边栏', exact: true })
        if (await collapseSidebar.isVisible()) await collapseSidebar.click()
        await page.emulateMedia({ colorScheme: 'dark' })
        await page.setViewportSize({ width: 650, height: 850 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: join(repository, '.artifacts/actvero-workbench-manager-narrow.png') })
      } finally {
        await browser.close()
      }
    } finally {
      await host?.stop()
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
