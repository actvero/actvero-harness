/** The npm command reference supplies executable requests and stable failure handling. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { parseWorkbenchInvocation, workbenchCommands, workbenchGuide } from './actvero-workbench-command-guide.ts'
import { developmentRequest } from './actvero-workbench-connection.ts'

it('validates every documented command example with the actual parser', () => {
  for (const [name, entry] of Object.entries(workbenchCommands)) {
    const guide = JSON.parse(workbenchGuide(['schema', 'show', name])!)
    const { example } = guide
    expect(guide).toMatchObject({ command: name, schemaVersion: 1, output: { $schema: expect.any(String) } })
    expect(parseWorkbenchInvocation(example.command.slice(1)).name).toBe(name)
    if (entry.input) {
      const body = example.body ?? (name === 'skill.install' ? { path: '/fixture/SKILL.md' } : {})
      expect(entry.input.safeParse(body).success, name).toBe(true)
      if (example.body) expect(JSON.parse(workbenchGuide(['example', 'show', name])!)).toEqual(body)
    }
  }
  expect(workbenchGuide(['skill', '--help'])).toContain('skill edit')
  expect(workbenchGuide(['mcp', 'help'])).not.toContain('skill install')
  expect(() => parseWorkbenchInvocation(['skill', 'edit', '--connection', 'connection.json'])).toThrow('参数')
  expect(() => parseWorkbenchInvocation(['skills', 'install', './skills', '--global'])).toThrow('参数')
  expect(() => parseWorkbenchInvocation(['doctor', '.', '--file', 'request.json'])).toThrow('Unknown option')
})

it('offers one-shot update and version readback through the connection', () => {
  expect(parseWorkbenchInvocation(['update', './workbench', '--connection', 'connection.json']).name).toBe('update')
  expect(parseWorkbenchInvocation(['status', '@local/workbench', '--connection', 'connection.json']).name).toBe('status')
  expect(() => parseWorkbenchInvocation(['update', './workbench'])).toThrow('参数')
  for (const obsolete of ['attach', 'dev', 'logs', 'detach']) {
    expect(() => parseWorkbenchInvocation([obsolete, './workbench'])).toThrow()
  }
})

it('requires transport-specific MCP fields and rejects embedded URL credentials', () => {
  const input = workbenchCommands['mcp.create']!.input!
  expect(input.safeParse({ config: { name: 'Test', transport: 'stdio' } }).success).toBe(false)
  expect(input.safeParse({ config: { name: 'Test', transport: 'stdio', command: 'node' } }).success).toBe(true)
  expect(input.safeParse({ config: { name: 'Test', transport: 'http', url: 'not-a-url' } }).success).toBe(false)
  expect(input.safeParse({ config: { name: 'Test', transport: 'http', url: 'https://user:password@example.org/mcp' } }).success).toBe(false)
})

it('distinguishes rejected requests from writes that lost their confirmation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actvero-cli-contract-'))
  try {
    const connection = join(root, 'connection.json')
    await writeFile(connection, JSON.stringify({ schemaVersion: 1, url: 'http://127.0.0.1:1/', token: 'a'.repeat(64) }), { mode: 0o600 })
    const command = { action: 'local-capability', input: { operation: 'skill-edit' } }
    const options = { recovery: 'Read skill show before retrying.' }
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: false, diagnostic: 'local_changes' }, { status: 400 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(undefined, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: false, code: 'update_failed', diagnostic: 'Previous version restored', outcome: 'not_applied' }, { status: 400 }))
    vi.stubGlobal('fetch', request)
    await expect(developmentRequest(connection, command, undefined, options))
      .rejects.toMatchObject({ code: 'local_changes', outcome: 'not_applied', recovery: options.recovery })
    await expect(developmentRequest(connection, command, undefined, options))
      .rejects.toMatchObject({ code: 'connection_failed', outcome: 'unknown', recovery: options.recovery })
    await expect(developmentRequest(connection, command, undefined, options))
      .rejects.toMatchObject({ code: 'connection_denied', outcome: 'not_applied' })
    await expect(developmentRequest(connection, command, undefined, options))
      .rejects.toMatchObject({ code: 'invalid_response', outcome: 'unknown' })
    await expect(developmentRequest(connection, { action: 'workbench-update' }, undefined, options))
      .rejects.toMatchObject({ code: 'update_failed', message: 'Previous version restored', outcome: 'not_applied' })
    expect(request).toHaveBeenCalledTimes(5)
  } finally {
    vi.unstubAllGlobals()
    await rm(root, { recursive: true, force: true })
  }
})
