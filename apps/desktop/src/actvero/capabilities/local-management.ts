/** Main-process execution of local Skill and MCP authoring commands. */
import { isAbsolute } from 'node:path'
import { localCapabilityCommand } from '@actvero/dsh-capability-ui/local-capabilities'
import type { Skills } from '@actvero/dsh-skills/main'
import type { Connectors } from '@actvero/dsh-connectors/main'

function readText(bytes: Uint8Array): string {
  if (bytes.length > 100_000) throw new Error('skill_file_too_large')
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch (_error) { throw new Error('skill_file_not_text') }
}

/** Route one validated command through the same stores and runtime sync used by the capability manager.
 * @param skills Desktop Skill authority.
 * @param connectors Desktop MCP authority.
 * @param input Command received from Host IPC.
 * @returns Saved state, safe metadata, requested Skill text, or a connection test result.
 */
export async function manageLocalCapability(skills: Skills['local'], connectors: Connectors['local'], input: unknown): Promise<unknown> {
  const parsed = localCapabilityCommand.safeParse(input)
  if (!parsed.success) throw new Error('invalid_input')
  const command = parsed.data
  switch (command.operation) {
    case 'skill-list':
      return (await skills.state()).map(({ skill, version, enabled }) => ({
        id: skill.id, name: skill.name, description: skill.description, version: version.id, enabled,
      }))
    case 'skill-show': {
      const detail = await skills.detail(command.id)
      const row = (await skills.state()).find(item => item.skill.id === command.id)
      if (!row) throw new Error('skill_not_installed')
      if (detail.current_version.id !== row.version.id) throw new Error('local_changes')
      return { id: detail.id, name: detail.name, description: detail.description, entrypoint: detail.entrypoint,
        files: detail.files, version: row.version.id, enabled: row.enabled }
    }
    case 'skill-read': {
      const bytes = (await skills.exportFiles(command.id)).get(command.path)
      if (!bytes) throw new Error('skill_file_not_found')
      return { path: command.path, content: readText(bytes) }
    }
    case 'skill-install':
    case 'skill-update':
    case 'skill-edit': {
      const preview = await (async () => {
        if (command.operation !== 'skill-edit') {
          if (!isAbsolute(command.path)) throw new Error('absolute_path_required')
          return skills.preview(command.path)
        }
        const files = await skills.exportFiles(command.id)
        const current = files.get(command.path)
        if (!current) throw new Error('skill_file_not_found')
        readText(current)
        const bytes = new TextEncoder().encode(command.content)
        if (bytes.length > 100_000) throw new Error('skill_file_too_large')
        files.set(command.path, bytes)
        return skills.previewFiles(files, command.path)
      })()
      try {
        const reviewed = command.operation === 'skill-install' ? undefined : { id: command.id, versionId: command.version }
        const rows = await skills.install(preview.token, reviewed)
        const row = rows.find(item => item.skill.name === preview.skill.name)
        if (!row) throw new Error('skill_install_state_unavailable')
        return { id: row.skill.id, name: row.skill.name, version: row.version.id, enabled: row.enabled }
      } finally { skills.discard(preview.token) }
    }
    case 'skill-enable':
      await skills.enable(command.id, command.enabled)
      return { id: command.id, enabled: command.enabled }
  }
  if (!connectors) throw new Error('local_connectors_unavailable')
  switch (command.operation) {
    case 'mcp-list': return connectors.authorList()
    case 'mcp-show': return connectors.authorDetails(command.id)
    case 'mcp-create':
    case 'mcp-update': return connectors.authorSave(command)
    case 'mcp-test': return connectors.authorTest(command.id)
    case 'mcp-enable':
      await connectors.enable(command.id, command.enabled)
      return connectors.authorDetails(command.id)
  }
}
