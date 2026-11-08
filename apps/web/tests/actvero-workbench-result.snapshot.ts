/** Native tool metadata and reference history remain readable after the business tool is removed. */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import { LlmAdapter, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { workbenchResultMetadata, workbenchResultText, type WorkbenchResult, type WorkbenchId, type WorkbenchInstanceId, type WorkbenchObjectId } from '@actvero/dsh-capability-ui'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { fixtureUserPrompts, launchWebScaffold, readPersistedEvents, recordFixture, watchConsole, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, expandTurnProcesses, newEnglishPage } from './support.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/actvero-workbench-result', import.meta.url))
const fixture = join(directory, 'session.v4.jsonl')
const provider = 'workbench-result-fixture'
const result: WorkbenchResult = { schemaVersion: 1, title: '任务检查完成', summary: '已检查需求确认任务，交付范围已记录。', references: [
  { schemaVersion: 1, workbenchId: 'uninstalled:checklist' as WorkbenchId, instanceId: 'archived-checklist' as WorkbenchInstanceId,
    objectId: 'task-scope' as WorkbenchObjectId, label: '需求确认', revision: '3', content: '任务：确认需求和交付范围。状态：已完成。' },
] }

class ResultAdapter extends LlmAdapter {
  private calls = 0
  override async listModels() { return [{ provider, id: 'fixture', name: 'Fixture' }] }
  override async *stream(): AsyncIterable<StreamChunk> {
    if (this.calls++ === 0) {
      const id = ToolCallId('checklist-review')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'checklist_review', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'checklist_review', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = '已完成检查，可查看结果中的任务快照。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it.skipIf(webSnapshotMode() === 'record')('replays business results without their tool and keeps inaccessible objects readable', async () => {
  const existing = existsSync(fixture)
  if (!existing && webSnapshotMode() !== 'refresh') throw new Error('Missing workbench result recording')
  const prompt = existing ? fixtureUserPrompts(await readFile(fixture, 'utf8'))[0] : '检查需求确认任务并给出结果。'
  if (!prompt) throw new Error('Missing recorded prompt')
  const scaffold = await launchWebScaffold({ extraOverlayPath: join(directory, 'cordis.patch.yml'),
    ...(existing ? { replayFixture: fixture, replayProviders: [{ id: provider, name: provider,
      models: [{ id: 'fixture', name: 'Fixture', contextWindow: 128_000 }] }] } : {}),
  })
  let browser: Browser | undefined
  try {
    if (!existing) scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter([provider], new ResultAdapter()))
    const remove = scaffold.ctx.tools.register(defineTool({ name: 'checklist_review', description: 'Read the fixed task summary.', parameters: {},
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: workbenchResultText(result) }],
        presentationMeta: () => workbenchResultMetadata(result) }, execute: async () => 'reviewed',
    }))
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider, model: 'fixture' })
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const console = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(prompt)
    await input.press('Enter')
    const sessionId = await settled
    const agent = scaffold.ctx.agents.get(sessionId)!
    expect(agent.session.snapshotEvents().find(event => event.type === 'tool/result')?.data).toMatchObject({ meta: workbenchResultMetadata(result) })
    await scaffold.ctx.sessions.flush(agent.session)
    expect(await readPersistedEvents(scaffold, sessionId)).toEqual(agent.session.snapshotEvents())
    if (webSnapshotMode() === 'refresh') await recordFixture(scaffold, sessionId, fixture)
    remove()
    await page.reload({ waitUntil: 'load' })
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await page.setViewportSize({ width: 390, height: 844 })
      const card = page.getByRole('article', { name: result.title })
      await expandTurnProcesses(page)
      await card.waitFor({ state: 'visible' })
      await card.getByRole('button', { name: '需求确认', exact: true }).click()
      const modal = page.getByRole('dialog', { name: '需求确认', exact: true })
      await modal.getByText(result.references[0]!.content, { exact: true }).waitFor()
      await modal.getByRole('button', { name: 'Open object', exact: true }).click()
      await modal.getByRole('alert').waitFor()
      expect(await modal.getByText(result.references[0]!.content, { exact: true }).count()).toBe(1)
      await page.screenshot({ path: join(fileURLToPath(new URL('../../../.artifacts/', import.meta.url)), `workbench-result-${colorScheme}.png`) })
      await page.keyboard.press('Escape')
    }
    expect(console.pageErrors).toEqual([])
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0]
    if (page) {
      await page.screenshot({ path: join(fileURLToPath(new URL('../../../.artifacts/', import.meta.url)), 'workbench-result-failure.png') })
      console.error(await page.locator('body').innerText())
    }
    throw error
  } finally {
    try { await browser?.close() } finally { await scaffold.close() }
  }
})
