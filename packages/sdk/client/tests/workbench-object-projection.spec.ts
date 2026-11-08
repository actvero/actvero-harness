/** SDK transport projection of the native Web workbench recording. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createProcessDeepSeekHarness } from '../src/api.ts'

function bindingRecords(value: unknown): { type: string; data: unknown }[] {
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'actvero/workbench' || !('data' in value)) return []
  return [{ type: value.type, data: value.data }]
}

it('retains the recorded workbench object in collected events and notifications', async () => {
  const recording = new URL('../../../../snapshots/web/actvero-workbench-object/session.v4.jsonl', import.meta.url)
  const bindings = (await readFile(recording, 'utf8')).trim().split('\n').flatMap((line) => {
    const record: unknown = JSON.parse(line)
    return bindingRecords(record)
  })
  const expected: unknown = JSON.parse(await readFile(new URL('./expected/workbench-object-projection.json', import.meta.url), 'utf8'))
  expect(bindings).toHaveLength(1)
  const harness = createProcessDeepSeekHarness({
    command: process.execPath,
    args: [fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))],
    environment: () => ({ ...process.env, FAKE_SESSION_EVENTS: JSON.stringify(bindings) }),
    description: 'recorded workbench object SDK projection',
    initializeTimeoutMs: 5000,
  })
  try {
    const result = await harness.run('Read the associated document.')
    const events = result.events.flatMap(bindingRecords)
    const notifications = result.notifications.flatMap((notification) => {
      if (notification.method !== 'session.event') return []
      expect(notification.params.sessionId).toBe(result.sessionId)
      return bindingRecords(notification.params.event)
    })
    expect(events).toEqual(expected)
    expect(notifications).toEqual(expected)
  } finally {
    await harness.close()
  }
})
