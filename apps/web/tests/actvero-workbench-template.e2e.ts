/** A generated non-canvas package uses native drafts, object conversations and durable results. */
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extract } from 'tar'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { LlmAdapter, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchId } from '@actvero/dsh-capability-ui'
import { readWorkbenchResult } from '../../../packages/actvero/capability-ui/src/workbench-result.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, expandTurnProcesses, newEnglishPage } from './support.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const provider = 'template-review-fixture'
const execute = promisify(execFile)
class ReviewAdapter extends LlmAdapter {
  private calls = 0
  override async listModels() { return [{ provider, id: 'fixture', name: 'Fixture' }] }
  override async *stream(): AsyncIterable<StreamChunk> {
    if (this.calls++ === 0) {
      const id = ToolCallId('review-template')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'checklist_review', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'checklist_review', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = '已检查当前任务。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it('creates, validates, loads and uses an AI checklist without host source edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-template-'))
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  try {
    const source = join(root, 'project')
    const name = '@local/acceptance-checklist'
    const command = (...args: string[]) => execute(process.execPath,
      ['--import', 'tsx/esm', join(repository, 'scripts/actvero-workbench.client.ts'), ...args], { cwd: repository })
    await command('create', source, name, '--template', 'ai')
    await writeFile(join(source, 'DESIGN.md'), '业务：按任务讨论并查看结果。\n视觉：DSH 原生。\n验收：独立任务关联、固定引用、历史跳转。\n')
    expect(z.object({ warnings: z.array(z.string()) }).parse(JSON.parse((await command('doctor', source)).stdout)).warnings).toEqual([])
    await command('pack', source, root)
    const archives = (await readdir(root)).filter(file => file.endsWith('.tgz'))
    expect(archives).toHaveLength(1)
    const archive = join(root, archives[0]!)
    expect(z.object({ name: z.string() }).parse(JSON.parse((await command('check', archive)).stdout)).name).toBe(name)
    await extract({ file: archive, cwd: root })
    const packaged = join(root, 'package')
    await symlink(join(repository, 'node_modules/.pnpm/node_modules'), join(packaged, 'node_modules'), 'junction')
    const overlay = join(root, 'test.patch.yml')
    await writeFile(overlay, '- id: actvero-capability-ui\n  disabled: false\n')
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, profile: { packages: [{ dir: packaged, enabled: true }] } })
    const { ctx } = scaffold
    ctx.effect(() => ctx.llm.registerAdapter([provider], new ReviewAdapter()))
    await ctx.agentDefaultModel.saveSelection({ provider, model: 'fixture' })
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const console = watchConsole(page)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const runtime = ctx.actveroWorkbenchRuntime
    await expect.poll(() => runtime.list().some(item => item.id === name)).toBe(true)
    expect(await runtime.present({ id: name as WorkbenchId, mode: 'business', ai: 'hide' }, AbortSignal.timeout(15_000))).toMatchObject({ status: 'confirmed' })
    const business = page.locator('[data-workbench-main]')
    const task = '确认需求和交付范围'
    await business.getByRole('checkbox', { name: task, exact: true }).waitFor()
    await business.getByRole('textbox', { name: 'Enter a task', exact: true }).fill('第二个独立任务')
    await business.getByRole('button', { name: 'Add task', exact: true }).click()
    await business.getByRole('checkbox', { name: '第二个独立任务', exact: true }).waitFor()
    await business.getByRole('button', { name: 'Discuss task', exact: true }).first().click()
    await business.locator('[data-workbench-ai] [data-composer-input]').waitFor()
    await business.getByRole('button', { name: 'Select as context', exact: true }).first().click()
    const chip = business.locator('[data-composer-chip="actvero-workbench-selection"]')
    const firstSession = await business.getAttribute('data-workbench-session')
    expect(firstSession).toBeTruthy()
    await chip.getByText(task, { exact: true }).click()
    const preview = page.getByRole('dialog', { name: task, exact: true })
    await preview.getByRole('button', { name: 'Open object', exact: true }).click()
    await preview.waitFor({ state: 'hidden' })
    expect(await business.getByRole('checkbox').count()).toBe(1)
    await business.getByRole('button', { name: 'All tasks', exact: true }).click()
    await business.getByRole('button', { name: 'Discuss task', exact: true }).nth(1).click()
    await expect.poll(() => business.getAttribute('data-workbench-session')).not.toBe(firstSession)
    const secondSession = await business.getAttribute('data-workbench-session')
    expect(secondSession).toBeTruthy()
    expect(ctx.sessionProjections.stateOf(ctx.agents.get(secondSession as SessionId)!.session, 'actveroWorkbench')?.object?.id).not.toBe('scope')
    await business.getByRole('button', { name: 'Select as context', exact: true }).nth(1).click()
    await chip.getByText('第二个独立任务', { exact: true }).waitFor()
    await business.getByRole('button', { name: 'Discuss task', exact: true }).first().click()
    await expect.poll(() => business.getAttribute('data-workbench-session')).toBe(firstSession)
    await chip.getByText(task, { exact: true }).waitFor()
    const settled = scaffold.whenTurnSettled()
    const input = business.locator('[data-composer-input]')
    await input.click()
    await input.press('End')
    await page.keyboard.insertText('检查当前任务')
    await input.press('Enter')
    const sessionId = await settled
    const agent = ctx.agents.get(sessionId)!
    expect(ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench')?.object?.id).toBe('scope')
    const toolResult = agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (toolResult?.type !== 'tool/result') throw new Error('Missing template tool result')
    expect(readWorkbenchResult(toolResult.data.meta)?.references[0]).toMatchObject({ objectId: 'scope', label: task })
    expect(ctx.tools.get('checklist_review')).toBeUndefined()
    await business.getByRole('button', { name: 'Full conversation', exact: true }).click()
    await ctx.sessions.flush(agent.session)
    await page.reload({ waitUntil: 'load' })
    await expandTurnProcesses(page)
    const card = page.getByRole('article', { name: task, exact: true })
    await card.getByRole('button', { name: task, exact: true }).click()
    await preview.getByRole('button', { name: 'Open object', exact: true }).click()
    await preview.waitFor({ state: 'hidden' })
    expect(await business.getByRole('checkbox').count()).toBe(1)
    expect(ctx.sessionProjections.stateOf(agent.session, 'actveroWorkbench')?.object?.id).toBe('scope')
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await page.setViewportSize({ width: 390, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: join(repository, `.artifacts/workbench-template-${colorScheme}.png`) })
    }
    expect(console.pageErrors).toEqual([])
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0]
    if (page) {
      await page.screenshot({ path: join(repository, '.artifacts/workbench-template-failure.png') })
      console.error(await page.locator('body').innerText())
    }
    throw error
  } finally {
    try { await browser?.close() } finally {
      try { await scaffold?.close() } finally { await rm(root, { recursive: true, force: true }) }
    }
  }
})
