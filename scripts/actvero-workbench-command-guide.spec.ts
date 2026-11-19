/** The npm command reference supplies executable requests and stable failure handling. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { parseWorkbenchInvocation, workbenchCommands, workbenchGuide } from './actvero-workbench-command-guide.ts'
import { developmentApplier, developmentRequest } from './actvero-workbench-connection.ts'

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

it('sends only the digest and archive path from a completed build to the strict development endpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actvero-cli-build-request-'))
  try {
    const connection = join(root, 'connection.json')
    const id = '8597702e-5112-4b34-a289-6e48fa8b4cf0'
    await writeFile(connection, JSON.stringify({ schemaVersion: 1, url: 'http://127.0.0.1:1/', token: 'a'.repeat(64) }), { mode: 0o600 })
    await mkdir(join(root, '.actvero'))
    await writeFile(join(root, '.actvero/development.json'), JSON.stringify({ connection, id }), { mode: 0o600 })
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, value: { application: 'busy' } }))
    vi.stubGlobal('fetch', request)
    const artifact = { path: join(root, 'artifact.tgz'), sha256: 'a'.repeat(64), name: '@local/workbench', bytes: 2 }
    const apply = await developmentApplier(root)
    expect(await apply?.(artifact, new AbortController().signal)).toEqual({ application: 'busy' })
    const requestBody = request.mock.calls[0]?.[1]?.body
    expect(typeof requestBody === 'string' && JSON.parse(requestBody)).toEqual({ action: 'apply', id, path: artifact.path, sha256: artifact.sha256 })
  } finally {
    vi.unstubAllGlobals()
    await rm(root, { recursive: true, force: true })
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
    vi.stubGlobal('fetch', request)
    await expect(developmentRequest(connection, command, undefined, options))
      .rejects.toMatchObject({ code: 'local_changes', outcome: 'not_applied', recovery: options.recovery })
    await expect(developmentRequest(connection, command, undefined, options))
      .rejects.toMatchObject({ code: 'connection_failed', outcome: 'unknown', recovery: options.recovery })
    await expect(developmentRequest(connection, command, undefined, options))
      .rejects.toMatchObject({ code: 'connection_denied', outcome: 'not_applied' })
    await expect(developmentRequest(connection, command, undefined, options))
      .rejects.toMatchObject({ code: 'invalid_response', outcome: 'unknown' })
    expect(request).toHaveBeenCalledTimes(4)
  } finally {
    vi.unstubAllGlobals()
    await rm(root, { recursive: true, force: true })
  }
})
