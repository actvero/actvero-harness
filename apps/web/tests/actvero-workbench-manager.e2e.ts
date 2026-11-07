/** Local workbench import and business navigation through the shipped Desktop Host. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { create } from 'tar'
import { describe, expect, it, vi } from 'vitest'
import { DesktopHostProcess } from '../../desktop/src/host-process.ts'
import { DesktopProjectManager } from '../../desktop/src/project-manager.ts'
import { resolveDesktopPaths } from '../../desktop/src/paths.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../../desktop/src/host-protocol.ts'
import { prepareDevelopmentProject } from '../../desktop/scripts/development-project.ts'
import { startPrefixProxy, type PrefixProxy } from './prefix-proxy.ts'
import { writeComposerDraft } from './support.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtureName = 'actvero-manager-fixture'
const title = '活动复盘工作台 · Campaign Review Workspace'

function version(path: string): string {
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version
}

describe.skipIf(!existsSync(join(repository, 'apps/desktop-host/lib/index.js')))('Actvero workbench manager', () => {
  it('opens and persists the checklist, imports a bundle and reopens its business page after restarting the Host', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'actvero-workbench-manager-')))
    let host: DesktopHostProcess | undefined
    let proxy: PrefixProxy | undefined
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
        '- id: agent-default-model', '  config:', '    provider: workbench-fixture', '    model: fixture',
        '- id: llm-pi-ai', '  config:', '    providers:', '      workbench-fixture:',
        '        displayName: Workbench Fixture', '        api: openai-completions',
        '        baseURL: https://workbench.invalid/v1', '        models:', '          - id: fixture', '            name: Fixture', '',
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
            id: '${fixtureName}', name: '${title}', description: '整理活动结果与待跟进事项，汇总 Campaign Review 的渠道数据、反馈和负责人。', version: '1.0.0', category: 'content', iconUrl: 'data:image/png;base64,invalid', previewUrls: ${JSON.stringify(Array.from({ length: 5 }, () => 'data:image/png;base64,' + readFileSync(join(repository, 'packages/actvero/capability-ui/src/client/workbenches/assets/project-checklist.png')).toString('base64')))}
          }, Panel));
          ctx.effect(() => ctx.actveroWorkbenches.register({
            id: '${fixtureName}-single', name: '单图工作台', description: '单张图片的预览', version: '1.0.0',
            previewUrls: ${JSON.stringify(['data:image/png;base64,' + readFileSync(join(repository, 'packages/actvero/capability-ui/src/client/workbenches/assets/project-checklist.png')).toString('base64')])}
          }, Panel));
        } };
      }});`)
      await create({ cwd: root, file: archive, gzip: true }, ['package/package.json', 'package/index.js', 'package/client.js', 'package/cordis.patch.yml'])
      const development = join(root, 'checklist-source')
      const developerCommand = join(repository, 'scripts/actvero-workbench.client.ts')
      execFileSync(process.execPath, ['--import', 'tsx/esm', developerCommand, 'create', development], { cwd: repository })
      execFileSync(process.execPath, ['--import', 'tsx/esm', developerCommand, 'pack', development, root], { cwd: repository })
      const checklistArchive = join(root, 'local-project-checklist-1.0.0.tgz')

      function startHost() {
        let capabilitiesClosed = false
        const startedHost = new DesktopHostProcess(process.execPath, project, paths.profile, undefined, process.env,
          undefined, undefined, { pnpm: join(pnpmDirectory, 'bin/pnpm.cjs'), nodeBin: dirname(process.execPath) },
          undefined, (message) => {
            if (capabilitiesClosed) return
            if (message.type === 'actvero:mcp:request' || message.type === 'actvero:skills:request') {
              startedHost.sendCapabilityMessage({ type: message.type === 'actvero:mcp:request' ? 'actvero:mcp:result' : 'actvero:skills:result', id: message.id, value: [] })
            } else if (message.type === 'actvero:experts:request') {
              startedHost.sendCapabilityMessage({ type: 'actvero:experts:result', id: message.id, error: 'expert_not_found' })
            }
          }, () => { capabilitiesClosed = true })
        host = startedHost
        return startedHost.start()
      }
      const ready = await startHost()
      // Keep browser storage at one origin, as Desktop does while its Host restarts.
      const browserOrigin = await startPrefixProxy({ prefix: '/' })
      proxy = browserOrigin
      const browserUrl = (hostUrl: string) => {
        const url = new URL(hostUrl)
        browserOrigin.setTarget(Number(url.port))
        url.port = String(browserOrigin.port)
        return url.href
      }
      const browser = await chromium.launch({ channel: 'chrome' })
      try {
        const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
        // Chrome runs the same renderer without Electron's preload.
        await context.addInitScript(({ root }) => {
          Object.defineProperty(globalThis, '__DSH_HOST_PATHS__', { value: { pathFor: (file: File) => `${root}/${file.name}` } })
        }, { root })
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
          await page.getByRole('tab', { name: '我的工作台', exact: true }).waitFor()
        }
        await page.goto(browserUrl(ready.url))
        const switcher = page.getByRole('button', { name: /^切换工作台 · / })
        await switcher.click()
        expect(await page.getByRole('menuitem').allTextContents()).toEqual(['项目清单'])
        expect(await page.getByRole('tab', { name: '我的工作台', exact: true }).count()).toBe(0)
        await page.keyboard.press('Escape')
        expect(await switcher.evaluate(element => element === document.activeElement)).toBe(true)
        await switcher.click()
        await page.getByRole('menuitem', { name: '项目清单', exact: true }).click()
        await page.getByRole('region', { name: '项目清单', exact: true }).waitFor()
        expect(await page.getByRole('button', { name: '返回工作台列表' }).count()).toBe(1)
        expect(await page.getByRole('dialog').count()).toBe(0)
        await openManager()
        expect(await switcher.textContent()).toContain('项目清单')
        const fixtureCard = page.locator('article').filter({ has: page.getByRole('heading', { name: title }) })
        const example = page.locator('article').filter({ has: page.getByRole('heading', { name: '项目清单' }) })
        await expect.poll(() => example.locator('img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0) && images.length === 5)).toBe(true)
        expect(await example.getByText('+2', { exact: true }).count()).toBe(0)
        const cardStrip = example.getByRole('group', { name: '工作台预览 · 项目清单', exact: true })
        const cardTrack = cardStrip.getByRole('button', { name: '查看预览 · 项目清单 · 1', exact: true }).locator('..')
        expect(await cardTrack.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
        await page.mouse.move(0, 0)
        const cardNext = cardStrip.getByRole('button', { name: '下一张', exact: true })
        await expect.poll(() => cardNext.evaluate(element => getComputedStyle(element).opacity)).toBe('0')
        await cardStrip.hover()
        expect(await cardNext.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
        await page.mouse.wheel(240, 0)
        await expect.poll(() => cardTrack.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
        expect(await page.getByRole('dialog').count()).toBe(0)
        await cardNext.click()
        await cardStrip.getByRole('button', { name: '查看预览 · 项目清单 · 5', exact: true }).click()
        const fifthDetail = page.getByRole('dialog', { name: '项目清单', exact: true })
        await fifthDetail.getByRole('button', { name: '查看预览 5', exact: true, pressed: true }).waitFor()
        await fifthDetail.getByRole('button', { name: '关闭', exact: true }).click()
        expect(await example.locator('img').evaluateAll(images => images.every(image => image.getBoundingClientRect().bottom <= image.closest('article')!.querySelector('footer')!.getBoundingClientRect().top))).toBe(true)
        const mine = page.getByRole('tab', { name: '我的工作台', exact: true })
        expect(await page.getByRole('navigation', { name: '工作台分类' }).count()).toBe(0)
        await mine.focus()
        await page.keyboard.press('ArrowRight')
        await page.getByText('平台工作台即将开放', { exact: true }).waitFor()
        expect(await page.getByRole('tab', { name: '平台工作台', exact: true }).getAttribute('aria-selected')).toBe('true')
        await page.getByRole('navigation', { name: '工作台分类' }).getByRole('button', { name: '数据分析', exact: true }).click()
        await page.getByRole('button', { name: '查看我的工作台', exact: true }).click()
        expect(await mine.getAttribute('aria-selected')).toBe('true')
        expect(await page.getByRole('navigation', { name: '工作台分类' }).count()).toBe(0)
        await example.getByRole('button', { name: '查看详情 · 项目清单', exact: true }).click({ position: { x: 8, y: 8 } })
        const checklistDetail = page.getByRole('dialog', { name: '项目清单', exact: true })
        await checklistDetail.getByRole('button', { name: '查看预览 1', exact: true, pressed: true }).waitFor()
        expect(await checklistDetail.getByText('1 / 5', { exact: true }).count()).toBe(0)
        const gallery = await checklistDetail.getByRole('region', { name: '工作台预览', exact: true }).boundingBox()
        const openAction = await checklistDetail.getByRole('button', { name: '打开', exact: true }).boundingBox()
        expect(openAction!.x).toBeGreaterThan(gallery!.x + gallery!.width)
        expect(openAction!.y + openAction!.height).toBeLessThanOrEqual(gallery!.y + gallery!.height + 1)
        await expect.poll(() => checklistDetail.locator('img').evaluateAll(images => images.length === 6 && images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
        expect(await checklistDetail.locator('img').evaluateAll(images => new Set(images.map(image => image.getAttribute('src'))).size)).toBe(5)
        const firstPreview = await checklistDetail.locator('img').first().getAttribute('src')
        const detailStrip = checklistDetail.getByRole('group', { name: '工作台预览', exact: true })
        expect(await detailStrip.getByRole('button', { name: '下一张', exact: true }).count()).toBe(0)
        expect(await detailStrip.getByRole('button', { name: '上一张', exact: true }).count()).toBe(0)
        const stripBox = await detailStrip.boundingBox()
        const firstThumbnail = await detailStrip.getByRole('button', { name: '查看预览 1', exact: true }).boundingBox()
        expect(firstThumbnail!.x - stripBox!.x).toBeLessThanOrEqual(3)
        for (const imageButton of [checklistDetail.getByRole('button', { name: '放大查看', exact: true }), checklistDetail.getByRole('button', { name: '查看预览 2', exact: true })]) {
          expect(await imageButton.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('1px')
          expect(await imageButton.evaluate(element => getComputedStyle(element).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)')
        }
        await checklistDetail.getByRole('button', { name: '查看预览 2', exact: true }).click()
        await checklistDetail.getByRole('button', { name: '查看预览 2', exact: true, pressed: true }).waitFor()
        expect(await checklistDetail.locator('img').first().getAttribute('src')).not.toBe(firstPreview)
        await page.mouse.move(0, 0)
        await page.keyboard.press('Tab')
        await checklistDetail.getByRole('button', { name: '查看预览 2', exact: true }).focus()
        mkdirSync(join(repository, '.artifacts'), { recursive: true })
        await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts/actvero-workbench-project-detail.png') })
        await page.keyboard.press('Escape')
        await page.getByRole('dialog').waitFor({ state: 'hidden' })
        await example.hover()
        const more = example.getByRole('button', { name: '更多操作 · 项目清单', exact: true })
        expect(await more.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
        await more.click()
        await page.getByRole('menuitem', { name: '查看详情', exact: true }).click()
        await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
        await page.getByRole('textbox', { name: '搜索工作台' }).fill('不存在的工作台')
        await page.getByText('没有匹配的工作台').waitFor()
        await page.getByRole('button', { name: '清除搜索', exact: true }).click()
        await example.getByRole('button', { name: '查看预览 · 项目清单 · 1', exact: true }).click()
        await checklistDetail.getByRole('button', { name: '打开', exact: true }).click()
        await page.getByRole('checkbox', { name: '确认需求和交付范围' }).click()
        await expect.poll(() => page.getByRole('checkbox', { name: '确认需求和交付范围' }).isChecked()).toBe(true)
        await page.getByText('进度已保存在本机').waitFor()
        await page.reload()
        await page.getByRole('button', { name: '切换工作台 · 项目清单', exact: true }).waitFor()
        await openManager()
        await example.getByRole('button', { name: '打开', exact: true }).click()
        await expect.poll(() => page.getByRole('checkbox', { name: '确认需求和交付范围' }).isChecked()).toBe(true)
        await page.getByRole('textbox', { name: '输入待办事项' }).fill('准备 Campaign Review 交付材料')
        await page.getByRole('button', { name: '添加任务', exact: true }).click()
        await page.getByRole('checkbox', { name: '准备 Campaign Review 交付材料' }).waitFor()
        const checklistPage = page.getByRole('region', { name: '项目清单', exact: true })
        const titleBar = checklistPage.locator('[data-window-drag]')
        expect((await titleBar.boundingBox())!.height).toBe(50)
        expect(await checklistPage.getByRole('heading', { name: '项目清单', exact: true }).count()).toBe(1)
        const launcher = page.getByRole('button', { name: 'AI 协助', exact: true })
        const launcherRect = (await launcher.boundingBox())!
        expect(launcherRect.x + launcherRect.width).toBe(1416)
        expect(launcherRect.y + launcherRect.height).toBe(976)
        await launcher.click()
        const chat = page.getByRole('complementary', { name: '工作台对话', exact: true })
        await chat.getByRole('button', { name: '取消使用工作台', exact: true }).waitFor()
        await expect.poll(() => chat.getByRole('button', { name: '添加文件或调用指令', exact: true }).isEnabled()).toBe(true)
        const draft = chat.locator('[data-composer-input]')
        await writeComposerDraft(page, draft, 'Campaign Review：保留这份草稿')
        expect(await draft.textContent()).toBe('Campaign Review：保留这份草稿')
        await chat.getByRole('button', { name: '收起', exact: true }).click()
        await chat.waitFor({ state: 'hidden' })
        await expect.poll(() => launcher.evaluate(element => element === document.activeElement)).toBe(true)
        await page.keyboard.press('Enter')
        await chat.waitFor()
        expect(await draft.textContent()).toBe('Campaign Review：保留这份草稿')
        const chatRect = (await chat.boundingBox())!
        for (const label of ['新建对话', '全屏对话', '收起']) {
          const control = chat.getByRole('button', { name: label, exact: true })
          const rect = (await control.boundingBox())!
          expect(rect.x).toBeGreaterThan(chatRect.x + chatRect.width / 2)
          expect(rect.y).toBeLessThan(chatRect.y + 48)
          expect(rect.height).toBe(28)
          await control.hover()
          await page.getByRole('tooltip', { name: label, exact: true }).waitFor()
        }
        await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts/actvero-workbench-ai-float.png') })
        await page.setViewportSize({ width: 390, height: 720 })
        await page.emulateMedia({ colorScheme: 'dark' })
        const mobileChat = (await chat.boundingBox())!
        expect(mobileChat.x).toBeGreaterThanOrEqual(16)
        expect(mobileChat.x + mobileChat.width).toBeLessThanOrEqual(374)
        expect(mobileChat.y).toBeGreaterThanOrEqual(48)
        expect(mobileChat.y + mobileChat.height).toBeLessThanOrEqual(704)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
        await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts/actvero-workbench-ai-narrow-dark.png') })
        await draft.click()
        await page.keyboard.press('Escape')
        await launcher.waitFor()
        await launcher.click()
        expect(await draft.textContent()).toBe('Campaign Review：保留这份草稿')
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.emulateMedia({ colorScheme: 'light' })
        await chat.getByRole('button', { name: '新建对话', exact: true }).click()
        await expect.poll(() => draft.textContent()).toBe('')
        await chat.getByRole('button', { name: '全屏对话', exact: true }).click()
        await expect.poll(() => page.getByRole('button', { name: '添加文件或调用指令', exact: true }).isEnabled()).toBe(true)
        await page.getByRole('button', { name: '悬浮查看工作台', exact: true }).click()
        const floating = page.getByRole('complementary', { name: '悬浮查看工作台', exact: true })
        await floating.getByRole('checkbox', { name: '准备 Campaign Review 交付材料' }).click()
        await expect.poll(() => floating.getByRole('checkbox', { name: '准备 Campaign Review 交付材料' }).isChecked()).toBe(true)
        const floatRect = await floating.boundingBox()
        expect(floatRect!.height).toBeLessThan(500)
        expect(floatRect!.width).toBeLessThanOrEqual(480)
        const floatControl = await page.getByRole('button', { name: '悬浮查看工作台', exact: true }).boundingBox()
        expect(floatControl!.x).toBeGreaterThan(1000)
        await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts/actvero-workbench-floating.png') })
        await page.setViewportSize({ width: 900, height: 700 })
        await page.emulateMedia({ colorScheme: 'dark' })
        const narrowFloat = await floating.boundingBox()
        expect(narrowFloat!.x).toBeGreaterThanOrEqual(0)
        expect(narrowFloat!.x + narrowFloat!.width).toBeLessThanOrEqual(900)
        expect(narrowFloat!.y + narrowFloat!.height).toBeLessThanOrEqual(700)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(900)
        await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts/actvero-workbench-floating-dark.png') })
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.emulateMedia({ colorScheme: 'light' })
        await floating.getByRole('button', { name: '收起', exact: true }).click()
        expect(await page.getByRole('button', { name: '取消使用工作台', exact: true }).count()).toBe(1)
        await page.reload()
        await page.getByRole('button', { name: '取消使用工作台', exact: true }).waitFor()
        await page.getByRole('button', { name: '悬浮查看工作台', exact: true }).click()
        await expect.poll(() => floating.getByRole('checkbox', { name: '准备 Campaign Review 交付材料' }).isChecked()).toBe(true)
        await floating.getByRole('button', { name: '进入工作台', exact: true }).click()
        await page.getByRole('button', { name: 'AI 协助', exact: true }).click()
        await chat.getByRole('button', { name: '全屏对话', exact: true }).click()
        await page.getByRole('button', { name: '取消使用工作台', exact: true }).click()
        await page.getByRole('button', { name: '悬浮查看工作台', exact: true }).waitFor({ state: 'hidden' })
        await page.getByRole('button', { name: '添加文件或调用指令', exact: true }).click()
        await page.getByRole('option', { name: /工作台/ }).click()
        await page.getByRole('option', { name: '项目清单', exact: true }).click()
        await page.getByRole('button', { name: '取消使用工作台', exact: true }).waitFor()
        await openManager()

        const picker = page.locator('input[type="file"][accept=".tgz"]')
        const importArchive = async (path: string) => {
          await expect.poll(() => page.getByRole('button', { name: '导入工作台', exact: true }).isEnabled()).toBe(true)
          await picker.setInputFiles(path)
        }
        await picker.setInputFiles({ name: 'invalid.tgz', mimeType: 'application/gzip', buffer: Buffer.from('not an archive') })
        await page.getByText('请选择有效的 Actvero 工作台 .tgz 包。').waitFor()
        await importArchive(archive)
        const installStatus = page.getByText(/工作台已安装。|变更已保存，重启 Harness 后生效。/)
        await installStatus.waitFor({ timeout: 40_000 })
        const needsRestart = (await installStatus.innerText()).includes('重启')
        const restart = async () => {
          await page.goto('about:blank')
          await host?.stop()
          const next = await startHost()
          await page.goto(browserUrl(next.url))
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
        await page.getByRole('button', { name: '查看详情 · 单图工作台', exact: true }).click({ position: { x: 8, y: 8 } })
        const singleDetail = page.getByRole('dialog', { name: '单图工作台', exact: true })
        await singleDetail.waitFor()
        expect(await singleDetail.getByRole('button', { name: '上一张', exact: true }).count()).toBe(0)
        expect(await singleDetail.getByRole('button', { name: '查看预览 1', exact: true }).count()).toBe(0)
        expect(await singleDetail.getByText('1 / 1', { exact: true }).count()).toBe(0)
        await expect.poll(() => singleDetail.locator('img').evaluateAll(images => images.length === 1 && images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
        await singleDetail.getByRole('button', { name: '关闭', exact: true }).click()
        await expect.poll(() => fixtureCard.locator('img').evaluateAll(images => images.length === 5 && images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
        const previewPositions = await fixtureCard.locator('img').evaluateAll(images => images.map(image => image.getBoundingClientRect().y))
        expect(new Set(previewPositions).size).toBe(1)
        await fixtureCard.getByRole('button', { name: `查看预览 · ${title} · 3`, exact: true }).click()
        const detail = page.getByRole('dialog', { name: title, exact: true })
        await detail.getByRole('heading', { name: title, exact: true }).waitFor()
        await detail.getByRole('button', { name: '查看预览 3', exact: true, pressed: true }).waitFor()
        await detail.getByRole('button', { name: '查看预览 4', exact: true }).click()
        await detail.getByRole('button', { name: '查看预览 4', exact: true, pressed: true }).waitFor()
        await page.keyboard.press('ArrowRight')
        await detail.getByRole('button', { name: '查看预览 5', exact: true, pressed: true }).waitFor()
        await detail.getByRole('button', { name: '查看预览 2', exact: true }).click()
        await detail.getByRole('button', { name: '查看预览 2', exact: true, pressed: true }).waitFor()
        await detail.getByRole('button', { name: '放大查看', exact: true }).first().click()
        await page.getByRole('dialog', { name: '大图预览', exact: true }).waitFor()
        await page.keyboard.press('Escape')
        await page.getByRole('dialog', { name: '大图预览', exact: true }).waitFor({ state: 'hidden' })
        expect(await detail.isVisible()).toBe(true)
        mkdirSync(join(repository, '.artifacts'), { recursive: true })
        await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts/actvero-workbench-details.png') })
        await detail.getByRole('button', { name: '关闭', exact: true }).click()
        await page.getByRole('textbox', { name: '搜索工作台' }).fill('活动复盘')
        expect(await example.count()).toBe(0)
        await fixtureCard.getByRole('button', { name: '打开', exact: true }).click()
        await page.getByText('已打开活动复盘业务页').waitFor()
        if (!needsRestart) await restart()
        else await openManager()
        await fixtureCard.getByRole('button', { name: '打开', exact: true }).click()
        await page.getByText('已打开活动复盘业务页').waitFor()
        const business = page.getByRole('region', { name: title, exact: true })
        const businessGeometry = await business.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          let parent = element.parentElement!
          while (getComputedStyle(parent).display === 'contents') parent = parent.parentElement!
          return {
            width: Math.round(rect.width), available: Math.round(parent.getBoundingClientRect().width),
            padding: getComputedStyle(element).paddingLeft,
          }
        })
        expect(businessGeometry.width).toBe(businessGeometry.available)
        expect(businessGeometry.padding).toBe('0px')
        expect(await page.getByRole('button', { name: '返回工作台列表' }).count()).toBe(1)
        await switcher.click()
        expect(await page.getByRole('menuitem').count()).toBe(3)
        await page.getByRole('menuitem', { name: '项目清单', exact: true }).click()
        await expect.poll(() => page.getByRole('checkbox', { name: '确认需求和交付范围' }).isChecked()).toBe(true)
        await switcher.click()
        await page.getByRole('menuitem', { name: '单图工作台', exact: true }).focus()
        await page.keyboard.press('Enter')
        await page.getByRole('region', { name: '单图工作台', exact: true }).waitFor()
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme })
          await switcher.click()
          await page.getByRole('menuitem', { name: title, exact: true }).click()
          await switcher.click()
          const menu = page.getByRole('menu')
          expect(await menu.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
          const rowBox = await switcher.locator('..').boundingBox()
          const menuBox = await menu.boundingBox()
          expect(Math.abs(menuBox!.x - rowBox!.x)).toBeLessThan(1)
          expect(Math.abs(menuBox!.width - rowBox!.width)).toBeLessThan(1)
          expect(menuBox!.y).toBeGreaterThanOrEqual(rowBox!.y + rowBox!.height)
          await page.screenshot({ animations: 'disabled', path: join(repository, `.artifacts/actvero-workbench-switcher-${colorScheme}.png`) })
          await page.getByRole('region', { name: title, exact: true }).click()
          await menu.waitFor({ state: 'hidden' })
        }

        await openManager()
        mkdirSync(join(repository, '.artifacts'), { recursive: true })
        await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts/actvero-workbench-manager.png') })
        const collapseSidebar = page.getByRole('button', { name: '收起侧边栏', exact: true })
        if (await collapseSidebar.isVisible()) await collapseSidebar.click()
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme })
          for (const width of [900, 650, 390]) {
            await page.setViewportSize({ width, height: 850 })
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
            expect(await fixtureCard.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
            await fixtureCard.getByRole('button', { name: '打开', exact: true }).waitFor()
            await page.screenshot({ animations: 'disabled', path: join(repository, `.artifacts/actvero-workbench-manager-${colorScheme}-${width}.png`) })
            if (width === 390) {
              await fixtureCard.getByRole('button', { name: `查看预览 · ${title} · 1`, exact: true }).click()
              const detail = page.getByRole('dialog', { name: title, exact: true })
              expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
              expect(await detail.getByRole('button', { name: '打开', exact: true }).isVisible()).toBe(true)
              await expect.poll(() => detail.locator('img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
              await page.screenshot({ animations: 'disabled', path: join(repository, `.artifacts/actvero-workbench-details-${colorScheme}-390.png`) })
              await detail.getByRole('button', { name: '关闭', exact: true }).click()
            }
          }
        }
        const touch = await browser.newContext({
          storageState: await context.storageState(), locale: 'zh-CN', viewport: { width: 390, height: 850 }, hasTouch: true, isMobile: true,
        })
        try {
          const touchPage = await touch.newPage()
          await touchPage.goto(page.url())
          await touchPage.getByRole('button', { name: '打开侧边栏', exact: true }).tap()
          await touchPage.getByRole('button', { name: '工作台', exact: true }).click()
          await touchPage.getByRole('button', { name: '收起侧边栏', exact: true }).tap()
          await touchPage.getByRole('button', { name: '查看预览 · 项目清单 · 1', exact: true }).tap()
          const touchDetail = touchPage.getByRole('dialog', { name: '项目清单', exact: true })
          await touchDetail.getByRole('button', { name: '查看预览 2', exact: true }).tap()
          await touchDetail.getByRole('button', { name: '查看预览 2', exact: true, pressed: true }).waitFor()
        } finally {
          await touch.close()
        }
        await page.setViewportSize({ width: 1440, height: 1000 })
        const expand = page.getByRole('button', { name: '打开侧边栏', exact: true })
        if (await expand.isVisible()) await expand.click()
        await openManager()
        await importArchive(checklistArchive)
        await installStatus.waitFor({ timeout: 40_000 })
        if ((await installStatus.innerText()).includes('重启')) await restart()
        const packaged = page.locator('article').filter({ has: page.getByRole('heading', { name: '项目清单', exact: true }) }).filter({ has: page.locator('footer').filter({ hasText: '本地' }) })
        await packaged.waitFor()
        await packaged.getByRole('button', { name: '打开', exact: true }).click()
        const scope = page.getByRole('checkbox', { name: '确认需求和交付范围' })
        expect(await scope.isChecked()).toBe(false)
        await scope.check()
        await page.getByText('进度已保存在本机').waitFor()
        await page.reload()
        await openManager()
        await packaged.getByRole('button', { name: '打开', exact: true }).click()
        expect(await scope.isChecked()).toBe(true)
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme })
          for (const width of [1440, 650]) {
            await page.setViewportSize({ width, height: 900 })
            await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { resolve() }))))
            const business = page.getByRole('region', { name: '项目清单', exact: true })
            expect(await business.locator('header[data-window-drag]').getByRole('heading', { name: '项目清单', exact: true }).count()).toBe(1)
            expect(await business.getByRole('checkbox', { name: '确认需求和交付范围' }).isChecked()).toBe(true)
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
            await page.screenshot({ animations: 'disabled', path: join(repository, `.artifacts/actvero-packaged-checklist-${colorScheme}-${width}.png`) })
          }
        }
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.emulateMedia({ colorScheme: 'light' })
        await openManager()
        const menu = async (label: string) => {
          await packaged.hover()
          await packaged.getByRole('button', { name: '更多操作 · 项目清单', exact: true }).click()
          await page.getByRole('menuitem', { name: label, exact: true }).click()
        }
        await menu('停用')
        await packaged.getByText('已停用', { exact: true }).waitFor()
        await restart()
        await packaged.getByText('已停用', { exact: true }).waitFor()
        expect(await packaged.getByRole('heading', { name: '项目清单', exact: true }).count()).toBe(1)
        await page.getByRole('button', { name: /切换工作台/ }).click()
        expect(await page.getByRole('menuitem', { name: '项目清单', exact: true }).count()).toBe(1)
        await page.keyboard.press('Escape')
        await packaged.getByRole('button', { name: '启用', exact: true }).click()
        await packaged.getByText('已加载', { exact: true }).waitFor()
        await importArchive(checklistArchive)
        await page.getByText('这个版本已经安装，无需重复导入。').waitFor()
        const packagePath = join(development, 'package.json')
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { version: string }
        packageJson.version = '1.1.0'
        writeFileSync(packagePath, JSON.stringify(packageJson))
        execFileSync(process.execPath, ['--import', 'tsx/esm', developerCommand, 'pack', development, root], { cwd: repository })
        const newerArchive = join(root, 'local-project-checklist-1.1.0.tgz')
        await importArchive(newerArchive)
        const updateDialog = page.getByRole('dialog', { name: '更新工作台', exact: true })
        await updateDialog.getByText('项目清单 · 1.0.0 → 1.1.0', { exact: true }).waitFor()
        await updateDialog.getByRole('button', { name: '取消', exact: true }).click()
        await packaged.getByText(/v1.0.0/).waitFor()
        await importArchive(newerArchive)
        await updateDialog.getByRole('button', { name: '确认更新', exact: true }).click()
        await packaged.getByText('待重启', { exact: true }).waitFor({ timeout: 40_000 })
        await packaged.getByText(/v1.1.0/).waitFor()
        await page.reload()
        await openManager()
        await packaged.getByText('待重启', { exact: true }).waitFor()
        await page.screenshot({ path: join(repository, '.artifacts/workbench-update-pending.png') })
        await restart()
        await packaged.getByText('已加载', { exact: true }).waitFor()
        await packaged.getByText(/v1.1.0/).waitFor()
        await packaged.getByRole('button', { name: '打开', exact: true }).click()
        expect(await scope.isChecked()).toBe(true)
        await openManager()
        await importArchive(checklistArchive)
        await page.getByText('不支持降级。请选择比已安装版本更新的工作台包。').waitFor()
        await menu('卸载')
        const removeDialog = page.getByRole('dialog', { name: '卸载工作台', exact: true })
        await removeDialog.getByRole('button', { name: '取消', exact: true }).click()
        await packaged.waitFor()
        await menu('卸载')
        await removeDialog.getByRole('button', { name: '卸载', exact: true }).click()
        await packaged.waitFor({ state: 'hidden', timeout: 40_000 })
        await importArchive(newerArchive)
        await installStatus.waitFor({ timeout: 40_000 })
        if ((await installStatus.innerText()).includes('重启')) await restart()
        await packaged.getByRole('button', { name: '打开', exact: true }).click()
        expect(await scope.isChecked()).toBe(true)
        await openManager()
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme })
          await packaged.hover()
          await packaged.getByRole('button', { name: '更多操作 · 项目清单', exact: true }).click()
          await page.getByRole('menuitem', { name: '更新版本', exact: true }).waitFor()
          await page.screenshot({ path: join(repository, `.artifacts/workbench-management-${colorScheme}.png`) })
          await page.keyboard.press('Escape')
        }
        expect(errors.filter(error => /ReferenceError|TypeError|SyntaxError/u.test(error))).toEqual([])
      } finally {
        await browser.close()
      }
    } finally {
      await proxy?.close()
      await host?.stop()
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
