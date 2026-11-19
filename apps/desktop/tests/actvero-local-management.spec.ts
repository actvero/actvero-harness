/** Local management operates on the same stores as the desktop managers. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished, vi } from 'vitest'
import { Skills } from '@actvero/dsh-skills/main'
import { Connectors } from '@actvero/dsh-connectors/main'
import { manageLocalCapability } from '../src/actvero/capabilities/local-management.ts'

it('installs a package for native discovery and edits one file without dropping its other resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actvero-local-management-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const skills = new Skills({
    root: join(root, 'store'), identity: () => undefined, issue: async () => { throw new Error('unexpected_platform_request') },
    changed: () => {}, syncHost: vi.fn(async () => {}), openExternal: async () => {},
  })
  const path = join(root, 'source')
  const first = '---\nname: decision-notes\ndescription: Write decision notes\n---\nRead notes.md.\n'
  await mkdir(path)
  await writeFile(join(path, 'SKILL.md'), first)
  await writeFile(join(path, 'notes.md'), 'Original reference.')
  const run = (command: unknown) => manageLocalCapability(skills.local, undefined, command)
  await run({ operation: 'skill-install', path })
  const [initial] = await skills.hostList()
  if (!initial) throw new Error('installed_skill_unavailable')
  const edit = { operation: 'skill-edit', id: initial.id, version: initial.versionId, path: 'SKILL.md',
    content: first + 'Record the owner and the due date.\n' }
  await run(edit)
  const [current] = await skills.hostList()
  expect(current?.id).toBe(initial.id)
  expect(current?.versionId).not.toBe(initial.versionId)
  expect(await run({ operation: 'skill-read', id: initial.id, path: 'notes.md' })).toEqual({ path: 'notes.md', content: 'Original reference.' })
  expect(await run({ operation: 'skill-read', id: initial.id, path: 'SKILL.md' })).toEqual({ path: 'SKILL.md', content: edit.content })
  expect((await skills.hostGet(initial.id, initial.versionId))?.content).not.toContain('due date')
  await expect(run(edit)).rejects.toThrow('local_changes')
})

it('saves a disabled MCP, tests it independently, and rejects edits based on stale revisions', async () => {
  let saved: unknown
  const connectors = new Connectors({
    identity: () => undefined, issue: async () => { throw new Error('unexpected_platform_request') },
    load: async () => [], save: async () => {}, openExternal: async () => {}, changed: () => {},
    local: { load: async () => saved, save: async (value) => { saved = value }, openExternal: async () => {} },
  })
  onTestFinished(() => connectors.dispose())
  const local = connectors.local
  if (!local) throw new Error('local_connectors_unavailable')
  const root = await mkdtemp(join(tmpdir(), 'actvero-local-management-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const skills = new Skills({
    root, identity: () => undefined, issue: async () => { throw new Error('unexpected_platform_request') },
    changed: () => {}, syncHost: async () => {}, openExternal: async () => {},
  })
  const run = (command: unknown) => manageLocalCapability(skills.local, local, command)
  const args = [fileURLToPath(new URL('../../../packages/actvero/connectors/tests/mcp-fixture.mjs', import.meta.url)), '--stdio']
  await run({ operation: 'mcp-create', config: { name: 'Local MCP fixture', transport: 'stdio', command: process.execPath, args } })
  const [row] = await local.authorList()
  if (!row) throw new Error('saved_connector_unavailable')
  expect(row).toMatchObject({ enabled: false, status: 'disabled', argumentCount: 2 })
  expect(row).not.toHaveProperty('args')
  expect(await run({ operation: 'mcp-test', id: row.id })).toEqual({ connected: true })
  expect(await local.snapshot()).toEqual([])
  const edit = { operation: 'mcp-update', id: row.id, revision: row.revision, patch: { name: 'Updated MCP' } }
  expect(await run(edit)).toMatchObject({ name: 'Updated MCP', enabled: false })
  await expect(run(edit)).rejects.toThrow('connector_edit_conflict')
  expect(await run({ operation: 'mcp-enable', id: row.id, enabled: true })).toMatchObject({ enabled: true, status: 'connected' })
  expect(await local.snapshot()).toHaveLength(1)
  await run({ operation: 'mcp-enable', id: row.id, enabled: false })
  expect(await local.snapshot()).toEqual([])
})
