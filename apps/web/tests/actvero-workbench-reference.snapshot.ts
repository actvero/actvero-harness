/** 原生消息持久化引用快照；没有安装业务包时仍可查看历史选区。 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import { LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { fixtureUserPrompts, launchWebScaffold, readPersistedEvents, recordFixture, watchConsole, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/actvero-workbench-reference', import.meta.url))
const fixture = join(directory, 'session.v4.jsonl')
const provider = 'workbench-reference-fixture'

class ReferenceAdapter extends LlmAdapter {
  override async listModels() { return [{ provider, id: 'fixture', name: 'Fixture' }] }
  override async *stream(): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: '已读取引用时的两个元素。' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '已读取引用时的两个元素。' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it.skipIf(webSnapshotMode() === 'record')('persists and replays a workbench snapshot without its business provider', async () => {
  const existing = existsSync(fixture)
  if (!existing && webSnapshotMode() !== 'refresh') throw new Error('Missing reference recording')
  const prompt = existing ? fixtureUserPrompts(await readFile(fixture, 'utf8'))[0] : '分析这个选区：<workbench-reference>{"schemaVersion":1,"workbenchId":"uninstalled:whiteboard","instanceId":"archived-board","objectId":"drawing-7","label":"流程图选区","revision":"4","content":"选中元素 A、B；矩形 A 指向 B。"}</workbench-reference>'
  if (!prompt) throw new Error('Missing recorded workbench reference input')
  const scaffold = await launchWebScaffold({ extraOverlayPath: join(directory, 'cordis.patch.yml'),
    ...(existing ? { replayFixture: fixture, replayProviders: [{ id: provider, name: provider,
      models: [{ id: 'fixture', name: 'Fixture', contextWindow: 128_000 }] }] } : {}),
  })
  let browser: Browser | undefined
  try {
    if (!existing) scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter([provider], new ReferenceAdapter()))
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
    const user = agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
    expect(user).toHaveLength(1)
    expect(JSON.stringify(user)).toContain('选中元素 A、B；矩形 A 指向 B。')
    await scaffold.ctx.sessions.flush(agent.session)
    expect(await readPersistedEvents(scaffold, sessionId)).toEqual(agent.session.snapshotEvents())
    if (webSnapshotMode() === 'refresh') await recordFixture(scaffold, sessionId, fixture)
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await page.getByRole('button', { name: '流程图选区', exact: true }).click()
      const modal = page.getByRole('dialog', { name: '流程图选区', exact: true })
      await modal.getByText('选中元素 A、B；矩形 A 指向 B。', { exact: true }).waitFor()
      expect(await modal.getByText('Revision: 4', { exact: true }).count()).toBe(1)
      await page.keyboard.press('Escape')
    }
    expect(console.pageErrors).toEqual([])
  } finally {
    try { await browser?.close() } finally { await scaffold.close() }
  }
})
