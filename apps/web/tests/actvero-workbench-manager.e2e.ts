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
      const environmentReport = join(root, 'workbench-environment.json')
      writeFileSync(join(folder, 'index.js'), `
        import { readFile, writeFile } from 'node:fs/promises';
        import { join } from 'node:path';
        export const name = '${fixtureName}';
        export const inject = ['actveroWorkbenchRuntime', 'actveroWorkbenchPlatform', 'agents', 'webServer', 'tools'];
        export async function apply(ctx) {
          const runtime = ctx.actveroWorkbenchRuntime;
          let refused = false;
          try { runtime.register({ id: '${fixtureName}', name: '不兼容', version: '1.0.0', protocol: { schemaVersion: 1, hostApi: '^2' } }); }
          catch (error) { if (error.code !== 'incompatible-host') throw error; refused = true; }
          if (!refused) throw new Error('Host admitted an incompatible workbench');
          ctx.effect(() => runtime.register({ id: '${fixtureName}', name: '活动复盘', version: '1.0.0', protocol: { schemaVersion: 1, hostApi: '^1' }, resourcesDirectory: import.meta.dirname }));
          ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/__workbench_test/display', handler: async (req, res) => {
            const params = new URL(req.url, 'http://127.0.0.1').searchParams;
            const request = params.has('mode') ? { id: params.get('id') || '${fixtureName}', mode: params.get('mode'),
              sidebar: params.get('sidebar') || undefined, ai: params.get('ai') || undefined } : null;
            let result;
            if (params.has('platform')) {
              try { result = await ctx.actveroWorkbenchPlatform.models(await runtime.open('@local/ai-checklist'), AbortSignal.timeout(5000)); }
              catch (error) { result = { error: error.message, code: error.code, details: error.details }; }
            } else if (params.has('tool')) {
              const executed = await ctx.tools.execute({ callId: 'display-test', name: request ? 'workbench_open' : 'workbench_status',
                arguments: request ? { id: request.id, mode: request.mode, ...(request.sidebar ? { sidebar: request.sidebar } : {}) } : {},
                signal: AbortSignal.timeout(10000) });
              if (executed.isError || executed.content[0]?.type !== 'text') throw new Error(JSON.stringify(executed));
              result = JSON.parse(executed.content[0].text);
            } else result = await runtime.present(request, AbortSignal.timeout(10000));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ...result, sessions: ctx.agents.list().length }));
          }}));
          const before = ctx.agents.list().length;
          const document = await runtime.open('${fixtureName}');
          const environment = await runtime.environment(document);
          const file = join(environment.dataDirectory, 'campaign.txt');
          try { await writeFile(file, '作者自定义文件 / Campaign review', { flag: 'wx' }); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
          await writeFile(${JSON.stringify(environmentReport)}, JSON.stringify({ ...environment,
            text: await readFile(file, 'utf8'), sessionsCreated: ctx.agents.list().length - before }));
        }
      `)
      writeFileSync(join(folder, 'cordis.patch.yml'), `- insert:\n    - id: ${fixtureName}\n      name: ${fixtureName}\n`)
      writeFileSync(join(folder, 'client.js'), `window.__ModuleLoader__.load({ id: '${fixtureName}', factory(require) {
        const { createElement: h, useEffect, useState } = require('react');
        const { defineStore } = require('@deepseek-ai/dsh-client-store');
        function createNavigation() {
          return defineStore({ init: () => ({ report: false }), actions: {
            showReport(state, report) { state.report = report; }
          } });
        }
        function Header({ title, renderFactorySlot, useStore, actions }) {
          const report = useStore(state => state.report);
          return renderFactorySlot('actvero.workbench.toolbar', { title,
            breadcrumbs: [{ id: 'overview', label: '复盘总览', onSelect: () => actions.showReport(false) },
              ...(report ? [{ id: 'report', label: '渠道投放成效与后续行动报告 / Campaign results and next steps' }] : [])],
            status: { text: report ? '报告已保存' : '总览已保存' },
            actions: [{ id: 'report', label: '查看报告', onSelect: () => actions.showReport(true) },
              { id: 'download', label: '下载原始数据', disabled: true, onSelect() { throw new Error('Disabled action ran'); } }]
          });
        }
        function WorkspacePanel(props) {
          const report = props.useStore(state => state.report);
          return h('section', null, h('p', { 'data-report-view': report }, report ? '报告详情' : '复盘内容'),
            h('button', { onClick: () => props.actions.showReport(!report) }, '切换业务页面'), h(Panel, props));
        }
        function Panel({ workbench }) {
          const [storage, setStorage] = useState('');
          const [crash, setCrash] = useState(false);
          if (crash) throw new Error('Intentional workbench render failure');
          useEffect(() => { let active = true;
            workbench.environment().then(value => { if (active) setStorage(value?.storage ?? 'ui-only'); });
            return () => { active = false; };
          }, [workbench]);
          return h('div', null, h('p', null, '已打开活动复盘业务页'), h('p', { 'data-workbench-storage': storage }, storage),
            h('button', { onClick: () => workbench.display({ mode: 'business', sidebar: 'focus', ai: 'hide' }) }, '作者专注展示'),
            h('button', { onClick: () => setCrash(true) }, '模拟工作台界面错误'));
        }
        return { inject: ['actveroWorkbenches'], apply(ctx) {
          let refused = false;
          try { ctx.actveroWorkbenches.register({ id: '${fixtureName}', name: '不兼容', description: '拒绝加载', version: '1.0.0', protocol: { schemaVersion: 1, hostApi: '^2' } }, Panel); }
          catch (error) { if (error.code !== 'incompatible-host') throw error; refused = true; }
          if (!refused) throw new Error('Client admitted an incompatible workbench');
          ctx.effect(() => ctx.actveroWorkbenches.register({
            id: '${fixtureName}', name: '${title}', protocol: { schemaVersion: 1, hostApi: '^1' }, description: '整理活动结果与待跟进事项，汇总 Campaign Review 的渠道数据、反馈和负责人。', version: '1.0.0', category: 'content', iconUrl: 'data:image/png;base64,invalid', previewUrls: ${JSON.stringify(Array.from({ length: 5 }, () => 'data:image/png;base64,' + readFileSync(join(repository, 'packages/actvero/capability-ui/src/client/workbenches/assets/project-checklist.png')).toString('base64')))}
          }, WorkspacePanel, { header: Header, store: createNavigation() }));
          ctx.effect(() => ctx.actveroWorkbenches.register({
            id: '${fixtureName}-single', name: '单图工作台', description: '单张图片的预览', version: '1.0.0',
            previewUrls: ${JSON.stringify(['data:image/png;base64,' + readFileSync(join(repository, 'packages/actvero/capability-ui/src/client/workbenches/assets/project-checklist.png')).toString('base64')])}
          }, Panel));
          ctx.effect(() => ctx.actveroWorkbenches.register({
            id: '${fixtureName}-long', name: '长简介工作台',
            description: ${JSON.stringify('汇总活动交付材料，核对负责人和业务进度。Review campaign deliverables and the next steps. '.repeat(45) + '完整介绍结尾')},
            author: 'ACTVERO 开发团队', version: '1.0.0',
            previewUrls: ${JSON.stringify(Array.from({ length: 5 }, () => 'data:image/png;base64,' + readFileSync(join(repository, 'packages/actvero/capability-ui/src/client/workbenches/assets/project-checklist.png')).toString('base64')))}
          }, Panel));
        } };
      }});`)
      await create({ cwd: root, file: archive, gzip: true }, ['package/package.json', 'package/index.js', 'package/client.js', 'package/cordis.patch.yml'])
      const development = join(root, 'checklist-source')
      const developerCommand = join(repository, 'scripts/actvero-workbench.client.ts')
      execFileSync(process.execPath, ['--import', 'tsx/esm', developerCommand, 'create', development, '@local/project-checklist', '--template', 'plain'], { cwd: repository })
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
            } else if (message.type === 'actvero:workbench:request') {
              startedHost.sendCapabilityMessage({ type: 'actvero:workbench:result', id: message.id,
                value: { scope: 'a'.repeat(64), models: [{ id: 'fixture-image', name: '测试图片模型', description: '',
                  operations: [{ kind: 'image.generate', inputModalities: ['text'], outputModalities: ['image'] }] }] } })
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
        const chooser = page.getByRole('button', { name: '切换工作台 · 选择工作台', exact: true })
        await chooser.click()
        await page.getByRole('menuitem', { name: '项目清单', exact: true }).waitFor()
        await page.keyboard.press('Escape')
        expect(await chooser.evaluate(element => element === document.activeElement)).toBe(true)
        try { await switcher.click() }
        catch (error) { console.error('Workbench navigation unavailable', { errors, body: await page.locator('body').innerText() }); throw error }
        expect(await page.getByRole('menuitem').allTextContents()).toEqual(['项目清单'])
        expect(await page.getByRole('tab', { name: '我的工作台', exact: true }).count()).toBe(0)
        await page.keyboard.press('Escape')
        expect(await switcher.evaluate(element => element === document.activeElement)).toBe(true)
        await switcher.click()
        await page.getByRole('menuitem', { name: '项目清单', exact: true }).click()
        await page.getByRole('region', { name: '项目清单', exact: true }).waitFor()
        expect(await page.getByRole('button', { name: /^(专注展示|显示导航)$/ }).count()).toBe(0)
        await page.getByRole('button', { name: '收起侧边栏', exact: true }).click()
        await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
        expect(await page.getByRole('button', { name: '返回工作台列表' }).count()).toBe(1)
        expect(await page.getByRole('dialog').count()).toBe(0)
        const chat = page.getByRole('complementary', { name: '工作台对话', exact: true })
        await chat.getByRole('button', { name: /^切换对话 · / }).waitFor()
        await chat.getByRole('button', { name: '收起', exact: true }).click()
        await openManager()
        expect(await switcher.textContent()).toBe('项目清单')
        expect(await switcher.getAttribute('aria-haspopup')).toBe('menu')
        expect(await switcher.locator('..').getByRole('button').count()).toBe(2)
        await switcher.click({ position: { x: 4, y: 12 } })
        await page.getByRole('menuitem', { name: '项目清单', exact: true }).waitFor()
        expect(await page.getByRole('tab', { name: '我的工作台', exact: true }).isVisible()).toBe(true)
        await page.keyboard.press('Escape')
        await switcher.focus()
        await page.keyboard.press('Enter')
        await page.getByRole('menuitem', { name: '项目清单', exact: true }).click()
        await page.getByRole('region', { name: '项目清单', exact: true }).waitFor()
        await openManager()
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
        await page.getByRole('checkbox', { name: '准备 Campaign Review 交付材料' }).click()
        const checklistPage = page.getByRole('region', { name: '项目清单', exact: true })
        const titleBar = checklistPage.locator('[data-window-drag]')
        expect((await titleBar.boundingBox())!.height).toBe(50)
        expect(await checklistPage.getByRole('heading', { name: '项目清单', exact: true }).count()).toBe(1)
        const launcher = page.getByRole('button', { name: '使用 AI', exact: true })
        const launcherRect = (await launcher.boundingBox())!
        expect(launcherRect.x + launcherRect.width).toBe(1416)
        expect(launcherRect.y + launcherRect.height).toBe(976)
        await launcher.hover()
        const launcherTooltip = page.getByRole('tooltip', { name: '使用 AI', exact: true })
        await launcherTooltip.waitFor()
        const tooltipRect = (await launcherTooltip.boundingBox())!
        expect(tooltipRect.y + tooltipRect.height).toBeLessThan(launcherRect.y)
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme })
          await launcher.hover()
          await page.screenshot({ animations: 'disabled', path: join(repository, `.artifacts/actvero-workbench-ai-launcher-${colorScheme}.png`),
            clip: { x: launcherRect.x - 80, y: launcherRect.y - 80, width: launcherRect.width + 100, height: launcherRect.height + 100 } })
        }
        await page.emulateMedia({ colorScheme: 'light' })
        await launcher.click()
        await chat.getByRole('button', { name: '项目清单', exact: true }).waitFor()
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
        expect(chatRect.width).toBe(400)
        expect(chatRect.y).toBeGreaterThanOrEqual(64)
        expect(chatRect.height).toBe(700)
        expect(1440 - chatRect.x - chatRect.width).toBe(16)
        expect(1000 - chatRect.y - chatRect.height).toBe(16)
        await page.mouse.move(chatRect.x + 8, chatRect.y + 3)
        await page.mouse.down()
        await page.mouse.move(chatRect.x - 112, chatRect.y + 43, { steps: 1 })
        await page.mouse.up()
        await expect.poll(async () => Math.round((await chat.boundingBox())?.x ?? 0)).toBe(Math.round(chatRect.x - 120))
        await chat.getByRole('button', { name: '收起', exact: true }).click()
        await page.getByRole('button', { name: '使用 AI', exact: true }).click()
        await expect.poll(async () => Math.round((await chat.boundingBox())?.x ?? 0)).toBe(Math.round(chatRect.x - 120))
        const movedChatRect = (await chat.boundingBox())!
        for (const label of ['新建对话', '全屏对话', '收起']) {
          const control = chat.getByRole('button', { name: label, exact: true })
          const rect = (await control.boundingBox())!
          expect(rect.x).toBeGreaterThan(movedChatRect.x + movedChatRect.width / 2)
          expect(rect.y).toBeLessThan(movedChatRect.y + 48)
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
        await expect.poll(() => chat.getByRole('button', { name: '新建对话', exact: true }).isEnabled()).toBe(true)
        await writeComposerDraft(page, draft, 'Draft B：另一条对话的草稿')
        await expect.poll(() => draft.textContent()).toBe('Draft B：另一条对话的草稿')
        const conversationTitle = chat.getByRole('button', { name: /^切换对话 · / })
        await expect.poll(() => conversationTitle.isEnabled()).toBe(true)
        await conversationTitle.click()
        const conversations = page.getByRole('menu').getByRole('menuitem')
        await expect.poll(() => conversations.count()).toBe(2)
        const menuRect = (await page.getByRole('menu').boundingBox())!
        const titleRect = (await conversationTitle.boundingBox())!
        expect(menuRect.x).toBeCloseTo(titleRect.x, 0)
        expect(menuRect.width).toBeCloseTo(titleRect.width, 0)
        expect(menuRect.y).toBeGreaterThan(titleRect.y + titleRect.height)
        // Reload reuses the first conversation; only explicit New creates the second.
        // Host order puts the most recent first; the selected row has a trailing check.
        await conversations.filter({ hasNot: page.locator('svg') }).first().click()
        await expect.poll(() => draft.textContent()).toBe('Campaign Review：保留这份草稿')
        await conversationTitle.click()
        await conversations.filter({ hasNot: page.locator('svg') }).first().click()
        await expect.poll(() => draft.textContent()).toBe('Draft B：另一条对话的草稿')
        await conversationTitle.focus()
        await page.keyboard.press('Enter')
        await page.getByRole('menu').waitFor()
        await page.keyboard.press('Escape')
        await page.getByRole('menu').waitFor({ state: 'hidden' })
        expect(await chat.isVisible()).toBe(true)
        await expect.poll(() => conversationTitle.evaluate(element => element === document.activeElement)).toBe(true)
        await chat.getByRole('button', { name: '全屏对话', exact: true }).click()
        await expect.poll(() => page.getByRole('button', { name: '添加文件或调用指令', exact: true }).isEnabled()).toBe(true)
        const floating = page.getByRole('complementary', { name: '悬浮工作台', exact: true })
        await floating.waitFor()
        const previewCanvas = floating.locator('[inert]')
        const previewTask = previewCanvas.locator('label').filter({ hasText: '准备 Campaign Review 交付材料' }).locator('input')
        await expect.poll(() => previewTask.isChecked()).toBe(true)
        expect(await floating.getByRole('checkbox').count()).toBe(0)
        expect(await previewCanvas.evaluate(element => ({ width: (element as HTMLElement).offsetWidth,
          height: (element as HTMLElement).offsetHeight, transform: getComputedStyle(element).transform })))
          .toEqual({ width: 960, height: 640, transform: 'matrix(0.3125, 0, 0, 0.3125, 0, 0)' })
        expect(await previewCanvas.locator(':scope > div').evaluate(element => getComputedStyle(element).overflow)).toBe('hidden')
        const floatRect = await floating.boundingBox()
        expect(floatRect!.height).toBe(200)
        expect(floatRect!.width).toBe(300)
        expect(await floating.locator(':scope > header').count()).toBe(0)
        const previewActions = floating.locator(':scope > div').first()
        await page.mouse.move(0, 0)
        await page.getByRole('button', { name: '悬浮工作台', exact: true }).focus()
        await expect.poll(() => previewActions.evaluate(element => getComputedStyle(element).opacity)).toBe('0')
        await floating.hover()
        await expect.poll(() => previewActions.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
        expect(await previewActions.evaluate((element) => {
          const style = getComputedStyle(element)
          return { background: style.backgroundColor, border: style.borderWidth, shadow: style.boxShadow }
        })).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' })
        const previewEnter = floating.getByRole('button', { name: '进入工作台', exact: true })
        expect(await previewEnter.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)')
        const previewScroll = await floating.evaluate(element => element.scrollTop)
        await page.mouse.wheel(0, 300)
        expect(await floating.evaluate(element => element.scrollTop)).toBe(previewScroll)
        // Drag from the rendered canvas, without invoking any business control.
        await page.mouse.move(floatRect!.x + 100, floatRect!.y + 100)
        await page.mouse.down()
        await page.mouse.move(floatRect!.x - 80, floatRect!.y + 220, { steps: 6 })
        await page.mouse.up()
        const movedFloat = (await floating.boundingBox())!
        expect(movedFloat.x).toBeCloseTo(floatRect!.x - 180, 0)
        expect(movedFloat.y).toBeCloseTo(floatRect!.y + 120, 0)
        // Fast movement and native capture loss retain the last rendered location.
        await page.mouse.move(movedFloat.x + 100, movedFloat.y + 100)
        await page.mouse.down()
        await page.mouse.move(movedFloat.x - 60, movedFloat.y + 180)
        await floating.evaluate((element) => {
          element.addEventListener('pointermove', (event) => {
            if (event instanceof PointerEvent && element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
          }, { once: true })
        })
        await page.mouse.move(movedFloat.x - 80, movedFloat.y + 200)
        await page.mouse.up()
        const interruptedFloat = (await floating.boundingBox())!
        expect(interruptedFloat.x).toBeCloseTo(movedFloat.x - 180, 0)
        expect(interruptedFloat.y).toBeCloseTo(movedFloat.y + 100, 0)
        await expect.poll(() => floating.getAttribute('data-dragging')).toBe(null)
        await floating.focus()
        await page.keyboard.press('ArrowRight')
        const rememberedFloat = (await floating.boundingBox())!
        expect(rememberedFloat.x).toBe(interruptedFloat.x + 16)
        expect(await previewTask.isChecked()).toBe(true)
        await page.mouse.move(0, 0)
        await floating.getByRole('button', { name: '收起', exact: true }).focus()
        await expect.poll(() => previewActions.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
        const floatControl = await page.getByRole('button', { name: '悬浮工作台', exact: true }).boundingBox()
        expect(floatControl!.x).toBeGreaterThan(1000)
        await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts/actvero-workbench-floating.png') })
        await page.setViewportSize({ width: 390, height: 720 })
        await page.emulateMedia({ colorScheme: 'dark' })
        await expect.poll(async () => {
          const rect = (await floating.boundingBox())!
          return rect.x + rect.width
        }).toBeLessThanOrEqual(374)
        const narrowFloat = await floating.boundingBox()
        expect(narrowFloat!.x).toBeGreaterThanOrEqual(16)
        expect(narrowFloat!.x + narrowFloat!.width).toBeLessThanOrEqual(374)
        expect(narrowFloat!.y + narrowFloat!.height).toBeLessThanOrEqual(704)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
        await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts/actvero-workbench-floating-dark.png') })
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.emulateMedia({ colorScheme: 'light' })
        await floating.getByRole('button', { name: '收起', exact: true }).click()
        expect(await page.getByRole('button', { name: '取消使用工作台', exact: true }).count()).toBe(1)
        await page.reload()
        await page.getByRole('button', { name: '取消使用工作台', exact: true }).waitFor()
        expect(await floating.count()).toBe(0)
        expect(await page.getByRole('button', { name: '悬浮工作台', exact: true }).getAttribute('aria-pressed')).toBe('false')
        await page.getByRole('button', { name: '悬浮工作台', exact: true }).click()
        await expect.poll(() => previewTask.isChecked()).toBe(true)
        const restoredFloat = (await floating.boundingBox())!
        expect(restoredFloat.x).toBeCloseTo(rememberedFloat.x, 0)
        expect(restoredFloat.y).toBeCloseTo(rememberedFloat.y, 0)
        const floatToggle = page.getByRole('button', { name: '悬浮工作台', exact: true })
        await page.mouse.move(0, 0)
        await floatToggle.hover()
        const floatTip = page.getByRole('tooltip', { name: '悬浮工作台', exact: true })
        await floatTip.waitFor()
        const toggleRect = (await floatToggle.boundingBox())!
        expect((await floatTip.boundingBox())!.y).toBeGreaterThan(toggleRect.y + toggleRect.height)
        await floating.hover()
        await floating.getByRole('button', { name: '进入工作台', exact: true }).click()
        // Each presentation remembers its own visibility, including across navigation.
        await chat.getByRole('button', { name: '全屏对话', exact: true }).click()
        await floating.waitFor()
        await floating.hover()
        await floating.getByRole('button', { name: '进入工作台', exact: true }).click()
        await chat.getByRole('button', { name: '收起', exact: true }).click()
        await openManager()
        await example.getByRole('button', { name: '打开', exact: true }).click()
        await launcher.waitFor()
        expect(await chat.isVisible()).toBe(false)
        await launcher.click()
        await chat.getByRole('button', { name: '全屏对话', exact: true }).click()
        await page.getByRole('button', { name: '取消使用工作台', exact: true }).click()
        await page.getByRole('button', { name: '悬浮工作台', exact: true }).waitFor({ state: 'hidden' })
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
        const waitInstalled = async (name: string) => {
          const card = page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) })
            .filter({ has: page.locator('footer').filter({ hasText: '本地' }) })
          await expect.poll(() => card.getAttribute('data-workbench-state'), { timeout: 40_000 })
            .toMatch(/^(ready|restartState)$/)
          await expect.poll(() => page.getByRole('button', { name: '导入工作台', exact: true }).isEnabled()).toBe(true)
          expect(await page.getByText(/工作台已安装。|工作台已启用。|工作台已停用|工作台已卸载。/).count()).toBe(0)
          return await card.getByText('待重启', { exact: true }).count() > 0
        }
        await picker.setInputFiles({ name: 'invalid.tgz', mimeType: 'application/gzip', buffer: Buffer.from('not an archive') })
        await page.getByText('请选择有效的 Actvero 工作台 .tgz 包。').waitFor()
        await importArchive(archive)
        let needsRestart: boolean
        try {
          needsRestart = await waitInstalled(title)
        } catch (error) {
          console.error('Workbench import did not complete', { page: await page.locator('body').innerText(),
            diagnostic: await page.locator('details pre').allTextContents(), errors })
          throw error
        }
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
        const shortDetailSize = await detail.boundingBox()
        const shortOpenAction = await detail.getByRole('button', { name: '打开', exact: true }).boundingBox()
        await detail.getByRole('button', { name: '关闭', exact: true }).click()
        const longCard = page.locator('article').filter({ has: page.getByRole('heading', { name: '长简介工作台', exact: true }) })
        expect(await longCard.locator('p').first().evaluate(element => element.getBoundingClientRect().height)).toBe(40)
        expect(await fixtureCard.locator('p').first().evaluate(element => element.getBoundingClientRect().height)).toBe(40)
        await longCard.getByRole('button', { name: '查看预览 · 长简介工作台 · 1', exact: true }).click()
        const longDetail = page.getByRole('dialog', { name: '长简介工作台', exact: true })
        expect((await longDetail.boundingBox())!.height).toBeCloseTo(shortDetailSize!.height, 0)
        expect((await longDetail.getByRole('button', { name: '打开', exact: true }).boundingBox())!.y).toBeCloseTo(shortOpenAction!.y, 0)
        const description = longDetail.getByRole('region', { name: '简介', exact: true })
        expect(await description.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
        await description.focus()
        await page.keyboard.press('End')
        await expect.poll(() => description.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
        await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts/workbench-long-description-light.png') })
        await page.emulateMedia({ colorScheme: 'dark' })
        await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts/workbench-long-description-dark.png') })
        await page.emulateMedia({ colorScheme: 'light' })
        await longDetail.getByRole('button', { name: '关闭', exact: true }).click()
        await page.getByRole('textbox', { name: '搜索工作台' }).fill('活动复盘')
        expect(await example.count()).toBe(0)
        await fixtureCard.getByRole('button', { name: '打开', exact: true }).click()
        await page.getByText('已打开活动复盘业务页').waitFor()
        await page.locator('[data-workbench-storage="custom"]').waitFor()
        const toolbar = page.locator('[data-workbench-header]')
        await toolbar.getByRole('button', { name: '查看报告', exact: true }).click()
        await page.locator('[data-report-view="true"]').waitFor()
        await toolbar.getByText('报告已保存', { exact: true }).waitFor()
        await toolbar.getByRole('button', { name: '复盘总览', exact: true }).click()
        await page.locator('[data-report-view="false"]').waitFor()
        await page.getByRole('button', { name: '切换业务页面', exact: true }).click()
        await toolbar.getByText('报告已保存', { exact: true }).waitFor()
        expect(await toolbar.ariaSnapshot()).toMatchInlineSnapshot(`
          "- navigation "工作台导航":
            - text: 活动复盘工作台 · Campaign Review Workspace
            - button "复盘总览"
            - heading "渠道投放成效与后续行动报告 / Campaign results and next steps" [level=1]
            - button "工作台导航"
          - status: 报告已保存
          - button "查看报告"
          - button "下载原始数据" [disabled]
          - button "工作台操作""
        `)
        await page.getByRole('button', { name: '收起侧边栏', exact: true }).click()
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme })
          for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 1000 })
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
            const frame = await toolbar.boundingBox()
            expect(frame!.x).toBeGreaterThanOrEqual(0)
            expect(frame!.x + frame!.width).toBeLessThanOrEqual(width)
            await page.screenshot({ animations: 'disabled', path: join(repository, `.artifacts/workbench-toolbar-${colorScheme}-${width}.png`) })
            if (width === 390) {
              const navigation = toolbar.getByRole('button', { name: '工作台导航', exact: true })
              await navigation.click()
              await page.getByRole('menuitem', { name: /渠道投放成效/ }).waitFor()
              const bounds = await page.getByRole('menu').boundingBox()
              expect(bounds!.x).toBeGreaterThanOrEqual(0)
              expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
              await page.keyboard.press('Escape')
              expect(await navigation.evaluate(element => element === document.activeElement)).toBe(true)
              const overflow = toolbar.getByRole('button', { name: '工作台操作', exact: true })
              await overflow.click()
              expect(await page.getByRole('menuitem', { name: '下载原始数据', exact: true }).isDisabled()).toBe(true)
              await page.keyboard.press('Escape')
              await page.mouse.move(0, 0)
              await overflow.hover()
              await page.getByRole('tooltip', { name: '工作台操作' }).waitFor()
              await overflow.click()
              await page.getByRole('button', { name: '切换业务页面', exact: true }).click()
              await page.getByRole('menu').waitFor({ state: 'hidden' })
              await page.getByRole('button', { name: '切换业务页面', exact: true }).click()
              await navigation.click()
              await page.getByRole('menuitem', { name: '复盘总览', exact: true }).click()
              await page.locator('[data-report-view="false"]').waitFor()
              await overflow.click()
              await page.getByRole('menuitem', { name: '查看报告', exact: true }).click()
              await page.locator('[data-report-view="true"]').waitFor()
            }
          }
        }
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.emulateMedia({ colorScheme: 'light' })
        await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
        expect(await page.getByRole('button', { name: '使用 AI', exact: true }).count()).toBe(0)
        const initialEnvironment = JSON.parse(readFileSync(environmentReport, 'utf8')) as { dataDirectory: string; storage: string; text: string; sessionsCreated: number }
        expect({ storage: initialEnvironment.storage, text: initialEnvironment.text, sessionsCreated: initialEnvironment.sessionsCreated }).toMatchInlineSnapshot(`
          {
            "sessionsCreated": 0,
            "storage": "custom",
            "text": "作者自定义文件 / Campaign review",
          }
        `)
        if (!needsRestart) await restart()
        else await openManager()
        await fixtureCard.getByRole('button', { name: '打开', exact: true }).click()
        await page.getByText('已打开活动复盘业务页').waitFor()
        await page.locator('[data-workbench-storage="custom"]').waitFor()
        const restoredEnvironment = JSON.parse(readFileSync(environmentReport, 'utf8')) as { dataDirectory: string; text: string }
        expect(restoredEnvironment.dataDirectory).toBe(initialEnvironment.dataDirectory)
        expect(restoredEnvironment.text).toBe(initialEnvironment.text)
        const display = async (query = '') => page.evaluate(async (query) => {
          const response = await fetch(`/__workbench_test/display${query}`)
          return response.json() as Promise<{
            status: string
            state?: { id: string; mode: string; aiVisible: boolean; sidebar: string }
            sessions: number
          }>
        }, query)
        await expect.poll(async () => (await display()).status).toBe('confirmed')
        const beforeDisplay = await display()
        const focused = await display('?mode=business&sidebar=focus&ai=hide')
        expect(focused).toMatchObject({ status: 'confirmed', state: { id: fixtureName, mode: 'business', aiVisible: false, sidebar: 'collapsed' } })
        expect(focused.sessions).toBe(beforeDisplay.sessions)
        expect(await page.getByText('已打开活动复盘业务页').isVisible()).toBe(true)
        const repeated = await display('?mode=business&sidebar=focus&tool=1')
        expect(repeated.sessions).toBe(beforeDisplay.sessions)
        expect(repeated).toMatchObject({ status: 'confirmed', state: { id: fixtureName, mode: 'business', sidebar: 'collapsed' } })
        expect(await display('?tool=1')).toMatchObject({ status: 'confirmed', state: { id: fixtureName } })
        await display('?mode=business&sidebar=preserve&ai=hide')
        await page.getByRole('button', { name: '作者专注展示', exact: true }).click()
        await expect.poll(async () => (await display()).state?.sidebar).toBe('collapsed')
        await display('?mode=business&sidebar=preserve&ai=hide')
        const missing = await display('?mode=business&id=missing-client')
        expect(missing.status).toBe('failed')
        await expect.poll(async () => (await display()).state?.id).toBe(fixtureName)
        const secondClient = await context.newPage()
        try {
          await secondClient.goto(page.url())
          await expect.poll(async () => (await display()).status).toBe('ambiguous')
        } finally { await secondClient.close() }
        await expect.poll(async () => (await display()).status).toBe('confirmed')
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
        expect(await page.getByRole('menuitem').count()).toBe(4)
        await page.getByRole('menuitem', { name: '项目清单', exact: true }).click()
        await expect.poll(() => page.getByRole('checkbox', { name: '确认需求和交付范围' }).isChecked()).toBe(true)
        await switcher.click()
        await page.getByRole('menu').waitFor()
        await switcher.press('End')
        await expect.poll(() => page.getByRole('menuitem', { name: '长简介工作台', exact: true })
          .evaluate(element => element === document.activeElement)).toBe(true)
        await page.keyboard.press('ArrowUp')
        await expect.poll(() => page.getByRole('menuitem', { name: '单图工作台', exact: true })
          .evaluate(element => element === document.activeElement)).toBe(true)
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
          await page.mouse.move(0, 0)
          await page.screenshot({ animations: 'disabled', path: join(repository, `.artifacts/actvero-workbench-switcher-${colorScheme}.png`) })
          await page.screenshot({ animations: 'disabled', path: join(repository, `.artifacts/actvero-workbench-switcher-detail-${colorScheme}.png`),
            clip: { x: rowBox!.x - 8, y: rowBox!.y - 8, width: rowBox!.width + 16,
              height: menuBox!.y + menuBox!.height - rowBox!.y + 16 } })
          await page.getByRole('region', { name: title, exact: true }).click()
          await menu.waitFor({ state: 'hidden' })
        }

        await switcher.click()
        const items = page.getByRole('menuitem')
        const originalOrder = await items.allTextContents()
        const moving = page.locator('[data-workbench-entry]').filter({ has: page.getByRole('menuitem', { name: '长简介工作台', exact: true }) })
        const grip = moving.locator('[data-workbench-grip]')
        const gripBox = await grip.boundingBox()
        const firstBox = await items.first().boundingBox()
        await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2)
        await page.mouse.down()
        await page.mouse.move(firstBox!.x + 20, firstBox!.y + 3, { steps: 2 })
        await expect.poll(() => page.locator('[data-drop="before"]').count()).toBe(1)
        await page.mouse.up()
        const sortedOrder = ['长简介工作台', ...originalOrder.filter(name => name !== '长简介工作台')]
        expect(await items.allTextContents()).toEqual(sortedOrder)
        expect(await switcher.textContent()).toBe(title)
        expect(await page.getByRole('menuitem', { name: title, exact: true }).getAttribute('aria-current')).toBe('page')
        await page.keyboard.press('Escape')
        await page.reload()
        await switcher.click()
        await expect.poll(() => items.allTextContents()).toEqual(sortedOrder)
        expect(await switcher.textContent()).toBe(title)
        const movedRow = page.getByRole('menuitem', { name: '长简介工作台', exact: true })
        await movedRow.focus()
        await page.keyboard.press('Alt+ArrowDown')
        expect(await items.allTextContents()).toEqual([sortedOrder[1], sortedOrder[0], ...sortedOrder.slice(2)])
        expect(await movedRow.evaluate(element => element === document.activeElement)).toBe(true)
        await page.keyboard.press('Alt+ArrowUp')
        expect(await items.allTextContents()).toEqual(sortedOrder)
        await page.keyboard.press('Escape')

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
        if (await waitInstalled('项目清单')) await restart()
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
        const disableDialog = page.getByRole('dialog', { name: '停用工作台', exact: true })
        await disableDialog.getByText(/本地业务数据和历史对话会保留/).waitFor()
        await disableDialog.getByRole('button', { name: '取消', exact: true }).click()
        expect(await packaged.getAttribute('data-workbench-state')).toBe('ready')
        await menu('停用')
        await disableDialog.getByRole('button', { name: '停用', exact: true }).click()
        await packaged.getByText('已停用', { exact: true }).waitFor()
        await restart()
        await packaged.getByText('已停用', { exact: true }).waitFor()
        expect(await packaged.getByRole('heading', { name: '项目清单', exact: true }).count()).toBe(1)
        await page.getByRole('button', { name: /切换工作台/ }).click()
        expect(await page.getByRole('menuitem', { name: '项目清单', exact: true }).count()).toBe(1)
        await page.keyboard.press('Escape')
        await packaged.getByRole('button', { name: '启用', exact: true }).click()
        if (await waitInstalled('项目清单')) await restart()
        await expect.poll(() => packaged.getAttribute('data-workbench-state')).toBe('ready')
        expect(await page.getByText('工作台已启用。', { exact: true }).count()).toBe(0)
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
        await expect.poll(() => packaged.getAttribute('data-workbench-state')).toBe('ready')
        await packaged.getByText(/v1.1.0/).waitFor()
        await packaged.getByRole('button', { name: '打开', exact: true }).click()
        expect(await scope.isChecked()).toBe(true)
        await openManager()
        await importArchive(checklistArchive)
        try { await page.getByText('不支持降级。请选择比已安装版本更新的工作台包。').waitFor() }
        catch (error) {
          writeFileSync(join(repository, '.artifacts/workbench-downgrade-page.txt'), await page.locator('body').innerText())
          await page.screenshot({ path: join(repository, '.artifacts/workbench-downgrade-failure.png') })
          throw error
        }
        await menu('卸载')
        const removeDialog = page.getByRole('dialog', { name: '卸载工作台', exact: true })
        await removeDialog.getByText(/保留本地业务数据和历史对话/).waitFor()
        await removeDialog.getByRole('button', { name: '取消', exact: true }).click()
        await packaged.waitFor()
        await menu('卸载')
        await removeDialog.getByRole('button', { name: '卸载', exact: true }).click()
        await packaged.waitFor({ state: 'hidden', timeout: 40_000 })
        await importArchive(newerArchive)
        if (await waitInstalled('项目清单')) await restart()
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
        await openManager()
        await page.getByRole('button', { name: '制作工作台', exact: true }).click()
        const developer = page.getByRole('dialog', { name: '制作工作台', exact: true })
        await developer.getByText(/本地开发需要 ACTVERO/).waitFor()
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme })
          await page.setViewportSize({ width: 390, height: 850 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await developer.getByRole('button', { name: '复制开发说明', exact: true }).waitFor()
          await page.screenshot({ animations: 'disabled', path: join(repository, `.artifacts/workbench-developer-${colorScheme}.png`) })
        }
        await page.keyboard.press('Escape')
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.emulateMedia({ colorScheme: 'light' })
        const aiDevelopment = join(root, 'ai-development')
        execFileSync(process.execPath, ['--import', 'tsx/esm', developerCommand, 'create', aiDevelopment, '--template', 'ai', '@local/ai-checklist'], { cwd: repository })
        const extensionEntry = join(aiDevelopment, 'src/client/index.ts')
        const extensionMetadata = join(aiDevelopment, 'workbench.json')
        writeFileSync(extensionMetadata, readFileSync(extensionMetadata, 'utf8').replace('^1.2.0', '^1.3.0'))
        writeFileSync(extensionEntry, readFileSync(extensionEntry, 'utf8').replace('header: Header', `header: Header,
          settings: { label: () => '清单偏好', component: ({ close }) => createElement('section', null,
            createElement('h2', null, '清单偏好'), createElement('p', null, '工作台安装级设置示例'),
            createElement('button', { onClick: close }, '返回清单对话')) },
          commands: [{ name: 'checklist-settings', label: () => '打开清单设置', available: () => true,
            ui: { kind: 'action', run() { ctx.actveroWorkbenches.openSettings(manifest.name) } } }]`))
        const aiManifestPath = join(aiDevelopment, 'package.json')
        const aiManifest = JSON.parse(readFileSync(aiManifestPath, 'utf8')) as { icon?: string }
        aiManifest.icon = './assets/icon.png'
        writeFileSync(aiManifestPath, JSON.stringify(aiManifest))
        const iconBytes = readFileSync(join(repository, 'packages/actvero/capability-ui/src/client/workbenches/assets/project-checklist-dark.png'))
        writeFileSync(join(aiDevelopment, 'assets/icon.png'), iconBytes)
        const packageIconUrl = `data:image/png;base64,${iconBytes.toString('base64')}`
        execFileSync(process.execPath, ['--import', 'tsx/esm', developerCommand, 'pack', aiDevelopment, root], { cwd: repository })
        await importArchive(join(root, 'local-ai-checklist-1.0.0.tgz'))
        if (await waitInstalled('AI 项目清单')) await restart()
        await openManager()
        const aiCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'AI 项目清单', exact: true }) })
        const hasArtwork = (images: Element[], url: string) => images.some(image => image instanceof HTMLImageElement
          && image.getAttribute('src') === url && image.complete && image.naturalWidth > 0)
        await expect.poll(() => aiCard.locator('img').evaluateAll(hasArtwork, packageIconUrl)).toBe(true)
        await aiCard.getByRole('button', { name: '查看预览 · AI 项目清单 · 1', exact: true }).click()
        await expect.poll(() => page.getByRole('dialog').locator('img').evaluateAll(hasArtwork, packageIconUrl)).toBe(true)
        await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
        await aiCard.getByRole('button', { name: '打开', exact: true }).click()
        const aiBusiness = page.getByRole('region', { name: 'AI 项目清单', exact: true })
        await expect.poll(() => aiBusiness.locator('header[data-window-drag] img').evaluateAll(hasArtwork, packageIconUrl)).toBe(true)
        await switcher.click()
        await expect.poll(() => page.getByRole('menuitem', { name: 'AI 项目清单', exact: true }).locator('img')
          .evaluateAll(hasArtwork, packageIconUrl)).toBe(true)
        await page.keyboard.press('Escape')
        expect(await aiBusiness.locator('[data-workbench-ai]').count()).toBe(0)
        await aiBusiness.getByRole('checkbox', { name: '确认需求和交付范围', exact: true }).click()
        await expect.poll(() => aiBusiness.getByRole('checkbox', { name: '确认需求和交付范围', exact: true }).isChecked()).toBe(true)
        await aiBusiness.getByRole('textbox', { name: '输入待办事项', exact: true }).fill('真实长度的交付复核 / Campaign acceptance review')
        await aiBusiness.getByRole('button', { name: '添加任务', exact: true }).click()
        await aiBusiness.getByRole('checkbox', { name: '真实长度的交付复核 / Campaign acceptance review', exact: true }).waitFor()
        const platformEndpoint = new URL('/__workbench_test/display?platform=1', page.url())
        const platformResult: unknown = await (await fetch(platformEndpoint)).json()
        expect(platformResult).toMatchObject({ scope: 'a'.repeat(64), models: [{ id: 'fixture-image' }] })
        await aiBusiness.getByRole('button', { name: '查看可用模型', exact: true }).click()
        try { await aiBusiness.getByText('可用模型: 测试图片模型', { exact: true }).waitFor() }
        catch (error) { writeFileSync(join(repository, '.artifacts/workbench-platform-debug.json'), JSON.stringify({ text: await aiBusiness.innerText(), errors })); throw error }
        await page.reload()
        await openManager()
        await aiCard.getByRole('button', { name: '打开', exact: true }).click()
        expect(await aiBusiness.getByRole('checkbox', { name: '确认需求和交付范围', exact: true }).isChecked()).toBe(true)
        expect(await page.getByText('工作台操作未完成。请确认会话未在运行、工作台已加载，然后重试。', { exact: true }).count()).toBe(0)
        await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts/workbench-ai-header.png') })
        await expect.poll(() => aiBusiness.locator('[data-workbench-header]').innerText()).toContain('交付检查 1 / 2')
        expect(await aiBusiness.getByRole('button', { name: '请 AI 协助', exact: true }).count()).toBe(0)
        await aiBusiness.getByRole('button', { name: '引用清单', exact: true }).click()
        await aiBusiness.locator('[data-workbench-ai]').waitFor()
        await aiBusiness.locator('[data-composer-chip="actvero-workbench-reference"]').getByText('交付检查', { exact: true }).waitFor()
        await aiBusiness.getByRole('button', { name: '选为上下文', exact: true }).first().click()
        const automatic = aiBusiness.locator('[data-composer-chip="actvero-workbench-selection"]')
        await automatic.getByText('确认需求和交付范围', { exact: true }).waitFor()
        await automatic.getByText('确认需求和交付范围', { exact: true }).click()
        const snapshotDialog = page.getByRole('dialog', { name: '确认需求和交付范围', exact: true })
        await snapshotDialog.getByRole('button', { name: '打开对象', exact: true }).click()
        await snapshotDialog.waitFor({ state: 'hidden' })
        expect(await aiBusiness.getByRole('checkbox').count()).toBe(1)
        expect(await aiBusiness.getByRole('checkbox', { name: '确认需求和交付范围', exact: true }).isChecked()).toBe(true)
        await aiBusiness.getByRole('button', { name: '全部任务', exact: true }).click()
        expect(await aiBusiness.getByRole('checkbox').count()).toBe(2)
        await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts/workbench-ai-template.png') })
        await aiBusiness.locator('[data-workbench-ai]').getByRole('button', { name: '全屏对话', exact: true }).click()
        await page.reload()
        await page.locator('[data-composer-chip="actvero-workbench-reference"]').getByText('交付检查', { exact: true }).waitFor()
        const referenceInput = page.locator('[data-composer-input][contenteditable="true"]')
        await referenceInput.click()
        await referenceInput.press('ControlOrMeta+a')
        await referenceInput.press('Backspace')
        expect(await page.locator('[data-composer-chip="actvero-workbench-reference"]').count()).toBe(0)
        await page.reload()
        await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
        expect(await page.locator('[data-composer-chip="actvero-workbench-reference"]').count()).toBe(0)
        await expect.poll(() => page.locator('[data-workbench-badge] img').evaluateAll(hasArtwork, packageIconUrl)).toBe(true)
        const floatingControl = page.getByRole('button', { name: '悬浮工作台', exact: true })
        await expect.poll(() => floatingControl.locator('img').evaluateAll(hasArtwork, packageIconUrl)).toBe(true)
        await page.getByRole('button', { name: '添加文件或调用指令', exact: true }).click()
        await page.getByRole('option', { name: /工作台/ }).click()
        await expect.poll(() => page.getByRole('option', { name: 'AI 项目清单', exact: true }).locator('img')
          .evaluateAll(hasArtwork, packageIconUrl)).toBe(true)
        await page.keyboard.press('Escape')
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme })
          await page.screenshot({ animations: 'disabled', path: join(repository, `.artifacts/workbench-package-icon-${colorScheme}.png`) })
        }
        await page.emulateMedia({ colorScheme: 'light' })
        await writeComposerDraft(page, referenceInput, '/checklist-settings')
        await page.getByRole('option', { name: /打开清单设置/ }).waitFor()
        await referenceInput.press('Enter')
        const settingsDialog = page.getByRole('dialog', { name: '设置', exact: true })
        await settingsDialog.getByRole('heading', { name: '清单偏好', exact: true }).waitFor()
        expect(await settingsDialog.getByRole('button', { name: '清单偏好', exact: true }).getAttribute('aria-current')).toBe('true')
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme })
          for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 1000 })
            const bounds = await settingsDialog.boundingBox()
            expect(bounds!.x).toBeGreaterThanOrEqual(0)
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
            await page.screenshot({ animations: 'disabled', path: join(repository, `.artifacts/workbench-settings-${colorScheme}-${width}.png`) })
          }
        }
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.emulateMedia({ colorScheme: 'light' })
        await settingsDialog.getByRole('button', { name: '返回清单对话', exact: true }).click()
        await settingsDialog.waitFor({ state: 'hidden' })
        expect((await referenceInput.innerText()).trim()).toBe('')
        await page.getByRole('button', { name: '取消使用工作台', exact: true }).click()
        await page.getByRole('button', { name: '取消使用工作台', exact: true }).waitFor({ state: 'hidden' })
        await page.getByRole('button', { name: '添加文件或调用指令', exact: true }).click()
        await page.getByRole('option', { name: /工作台/ }).waitFor()
        expect(await page.getByRole('option', { name: /打开清单设置/ }).count()).toBe(0)
        await page.getByRole('option', { name: /工作台/ }).click()
        await page.getByRole('option', { name: 'AI 项目清单', exact: true }).click()
        await page.getByRole('option', { name: 'AI 项目清单', exact: true }).waitFor({ state: 'hidden' })
        await page.getByRole('button', { name: '取消使用工作台', exact: true }).waitFor()
        await openManager()
        expect(await page.locator('[data-workbench-header]').count()).toBe(0)
        await aiCard.hover()
        await aiCard.getByRole('button', { name: '更多操作 · AI 项目清单', exact: true }).click()
        await page.getByRole('menuitem', { name: '停用', exact: true }).click()
        await page.getByRole('dialog', { name: '停用工作台', exact: true }).getByRole('button', { name: '停用', exact: true }).click()
        await aiCard.getByText('已停用', { exact: true }).waitFor()
        await page.keyboard.press('ControlOrMeta+Alt+,')
        await settingsDialog.waitFor()
        expect(await settingsDialog.getByRole('button', { name: '清单偏好', exact: true }).count()).toBe(0)
        await page.keyboard.press('Escape')
        await settingsDialog.waitFor({ state: 'hidden' })
        expect(await display('?mode=business&ai=hide')).toMatchObject({ status: 'confirmed' })
        expect(await page.locator('[data-workbench-header]').getByText('交付检查 1 / 2', { exact: true }).count()).toBe(0)
        await page.locator('[data-workbench-header]').getByRole('button', { name: '查看报告', exact: true }).click()
        await page.locator('[data-report-view="true"]').waitFor()
        await page.getByRole('button', { name: '模拟工作台界面错误', exact: true }).click()
        await expect.poll(async () => (await display()).status).toBe('failed')
        expect(errors.filter(error => /ReferenceError|TypeError|SyntaxError/u.test(error))).toEqual([])
        const displayEndpoint = new URL('/__workbench_test/display', page.url())
        await browser.close()
        await expect.poll(async () => {
          const response = await fetch(displayEndpoint)
          return (await response.json() as { status: string }).status
        }).toBe('unavailable')
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
