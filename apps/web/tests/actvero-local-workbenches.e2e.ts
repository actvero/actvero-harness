/** Original workbench host composed with the shipped Desktop Host and a local fixture bundle. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { describe, expect, it, vi } from 'vitest'
import { DesktopHostProcess } from '../../desktop/src/host-process.ts'
import { DesktopProjectManager } from '../../desktop/src/project-manager.ts'
import { resolveDesktopPaths } from '../../desktop/src/paths.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../../desktop/src/host-protocol.ts'
import { prepareDevelopmentProject } from '../../desktop/scripts/development-project.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const title = '图文视频创作示例'

function version(path: string): string {
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { resolve() })))
    const animations = document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)))
  })
}

describe.skipIf(!existsSync(join(repository, 'apps/desktop-host/lib/index.js')))('ACTVERO local workbenches', () => {
  it('saves local work, preserves native drafts and reuses material across topics', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'actvero-workbenches-')))
    let host: DesktopHostProcess | undefined
    try {
      for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD/u.test(name)) vi.stubEnv(name, undefined)
      const home = join(root, 'home')
      mkdirSync(home)
      vi.stubEnv('DSH_HOME', home)
      vi.stubEnv('DSH_TELEMETRY_MODE', 'DISABLED')
      vi.stubEnv('ACTVERO_DESKTOP', '1')
      vi.stubEnv('DSH_CLIENT_VERSION', version(join(repository, 'apps/desktop/package.json')))
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
      mkdirSync(join(root, 'documents'))
      writeFileSync(join(paths.profile, 'cordis.patch.yml'),
        "- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n- id: web-runtime\n  config:\n    printUrl: false\n    openBrowser: false\n- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: '2026-09-28.1'\n" +
        readFileSync(join(repository, 'apps/web/tests/pin-browse-picker.overlay.yml'), 'utf8') + `\n- id: workspace-controller\n  config:\n    documentsDirectory: ${JSON.stringify(join(root, 'documents'))}\n`)
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
        page.on('console', (message) => { if (message.type() === 'error' || message.text().includes('Workbench')) console.error(message.text()) })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.goto(ready.url)
        await page.getByRole('button', { name: '工作台', exact: true }).click()
        await page.locator('[data-actvero-local-home]').waitFor()
        await page.getByRole('button', { name: '打开工作台 ' + title, exact: true }).click()
        const surface = page.locator('[data-actvero-workbench-surface]')
        await surface.waitFor()
        expect(await surface.locator('[contenteditable="true"]:visible').count()).toBe(0)
        await surface.getByRole('button', { name: '编辑内容', exact: true }).first().click()
        await page.getByLabel('标题', { exact: true }).fill('秋季新品宣传 / Autumn Launch')
        await page.getByLabel('内容', { exact: true }).fill('围绕秋日徒步场景，整理新品图文与短视频分镜。')
        await page.getByRole('button', { name: '保存修改', exact: true }).click()
        await surface.getByText('秋季新品宣传 / Autumn Launch', { exact: true }).first().waitFor()
        await surface.getByRole('tab', { name: '并排', exact: true }).click()
        const composer = surface.locator('[contenteditable="true"]:visible').first()
        await composer.waitFor()
        expect(await surface.getByText('探索未至之境', { exact: true }).count()).toBe(0)
        await expect.poll(() => composer.evaluate((element) => {
          const panel = element.closest('[data-actvero-native-conversation]')?.getBoundingClientRect()
          return panel !== undefined && element.getBoundingClientRect().top > panel.top + panel.height / 2
        })).toBe(true)
        await composer.fill('帮我整理当前画布的创作思路，暂不执行生成。')
        await surface.getByRole('tab', { name: '业务', exact: true }).click()
        await surface.getByRole('tab', { name: '并排', exact: true }).click()
        await expect.poll(() => composer.innerText()).toContain('帮我整理当前画布')
        const stateUrl = new URL('/api/actvero-workbenches/state', ready.url).href
        const readState = async () => (await (await page.request.get(stateUrl)).json()) as {
          projects: { id: string; data: object }[]
          conversations: { projectId: string; sessionId: string }[]
        }
        const first = await readState()
        expect(first.conversations).toHaveLength(1)
        await surface.getByRole('button', { name: '新建对话', exact: true }).click()
        await expect.poll(async () => (await readState()).conversations.length).toBe(2)
        const next = await readState()
        expect(next.conversations[0]?.projectId).toBe(next.conversations[1]?.projectId)
        expect(next.conversations[0]?.sessionId).not.toBe(next.conversations[1]?.sessionId)
        await expect.poll(() => composer.innerText()).toBe('')
        await page.keyboard.press('Alt+Meta+n')
        await expect.poll(async () => (await readState()).conversations.length).toBe(3)
        expect((await readState()).conversations.every(item => item.projectId === first.conversations[0]?.projectId)).toBe(true)
        await surface.getByRole('combobox', { name: '相关对话' }).selectOption(first.conversations[0].sessionId)
        await expect.poll(() => composer.innerText()).toContain('帮我整理当前画布')
        for (const theme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: theme })
          for (const view of ['业务', '并排', '对话']) {
            await surface.getByRole('tab', { name: view, exact: true }).click()
            await settle(page)
            await page.screenshot({ path: join(repository, `.artifacts/actvero-local-workbench-${theme}-${view}.png`) })
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          }
        }
        await surface.getByRole('button', { name: '显示或隐藏业务预览' }).click()
        await settle(page)
        await page.screenshot({ path: join(repository, '.artifacts/actvero-local-workbench-preview.png') })
        await page.reload()
        await surface.waitFor()
        await expect.poll(() => surface.getAttribute('data-view')).toBe('conversation')
        await expect.poll(() => composer.innerText()).toContain('帮我整理当前画布')
        await surface.getByRole('tab', { name: '业务', exact: true }).click()
        await page.setViewportSize({ width: 700, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await settle(page)
        await page.screenshot({ path: join(repository, '.artifacts/actvero-local-workbench-narrow.png') })
        await surface.getByRole('button', { name: '返回工作台', exact: true }).click()
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.getByRole('button', { name: '打开工作台 本地素材示例', exact: true }).click()
        const notes = surface.getByRole('textbox', { name: '素材说明' })
        await notes.fill('适合秋季新品广告；保留自然光与森林环境。')
        await surface.getByRole('button', { name: '保存修改', exact: true }).click()
        await page.reload()
        await expect.poll(() => notes.inputValue()).toContain('适合秋季新品广告')
        expect(await surface.locator('[contenteditable="true"]:visible').count()).toBe(0)
        await surface.getByRole('button', { name: '返回工作台', exact: true }).click()
        await settle(page)
        await page.screenshot({ path: join(repository, '.artifacts/actvero-local-workbench-home.png') })
        expect(errors).toEqual([])
      } catch (error) {
        // Save the actual composed UI before the test host is disposed.
        for (const page of browser.contexts().flatMap(context => context.pages())) {
          await settle(page)
          await page.screenshot({ path: join(repository, '.artifacts/actvero-local-workbench-failure.png') })
          console.error((await page.locator('body').innerText()).slice(0, 6500))
        }
        throw error
      } finally { await browser.close() }
    } finally {
      await host?.stop()
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  }, 180_000)
})
