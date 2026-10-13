/** Built official Host composition, with no business credentials or modified installations. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { DesktopHostProcess } from '../src/host-process.ts'
import { DesktopProjectManager } from '../src/project-manager.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { prepareDevelopmentProject } from '../scripts/development-project.ts'
const repository = fileURLToPath(new URL('../../../', import.meta.url))
function version(path: string): string {
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version
}
describe.skipIf(!existsSync(join(repository, 'apps/desktop-host/lib/index.js')))('built ACTVERO account composition', () => {
  it('loads ACTVERO account assets through the official Host and leaves baseline account composition intact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'actvero-account-composition-'))
    let host: DesktopHostProcess | undefined
    try {
      for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD/u.test(name)) vi.stubEnv(name, undefined)
      const home = join(root, 'home')
      mkdirSync(home)
      vi.stubEnv('DSH_HOME', home)
      vi.stubEnv('DSH_TELEMETRY_MODE', 'DISABLED')
      const project = prepareDevelopmentProject({
        projectDir: join(root, 'project'),
        cliDir: join(repository, 'apps/cli'),
        hostDir: join(repository, 'apps/desktop-host'),
        dependencyDir: join(repository, 'node_modules/.pnpm/node_modules'),
        release: {
          schemaVersion: 1,
          version: version(join(repository, 'apps/desktop/package.json')),
          pnpmVersion: version(join(repository, 'apps/desktop/node_modules/pnpm/package.json')),
          nodeVersion: process.versions.node,
          hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
        },
        target: 'mac-x64',
      })
      cpSync(join(repository, 'packages/skill/skill-office/assets'), join(root, 'runtime/office-skills'), {
        recursive: true,
      })
      const nodeBin = join(root, 'runtime/primary-runtime/dependencies/node/bin')
      mkdirSync(nodeBin, { recursive: true })
      cpSync(process.execPath, join(nodeBin, process.platform === 'win32' ? 'node.exe' : 'node'))
      const paths = resolveDesktopPaths(home),
        manager = new DesktopProjectManager(paths, { dsh: project })
      await manager.applyRelease()
      writeFileSync(
        join(paths.profile, 'cordis.patch.yml'),
        '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n- id: web-runtime\n  config:\n    printUrl: false\n',
      )
      for (const enabled of ['1', '0']) {
        vi.stubEnv('ACTVERO_DESKTOP', enabled)
        host = new DesktopHostProcess(process.execPath, project, paths.profile)
        const ready = await host.start()
        const graph = ready.injections?.find(
          row => typeof row === 'object' && row !== null && 'name' in row && row.name === '__DSH_BOOT__',
        )
        const serialized = JSON.stringify(graph)
        expect(serialized).toBeDefined()
        if (enabled === '1') {
          expect(serialized).toContain('@actvero/dsh-client-account')
          expect(serialized).not.toContain('@deepseek-ai/dsh-client-ui-settings-account')
          expect(serialized).not.toContain('@deepseek-ai/dsh-client-ui-brand-official')
          const auth = await fetch(ready.url, { redirect: 'manual' })
          const cookie = auth.headers
            .getSetCookie()
            .map(value => value.split(';')[0])
            .join('; ')
          await auth.body?.cancel()
          if (
            !graph ||
            typeof graph !== 'object' ||
            !('value' in graph) ||
            !graph.value ||
            typeof graph.value !== 'object' ||
            !('batches' in graph.value) ||
            !Array.isArray(graph.value.batches)
          )
            throw new Error('Missing client batches')
          const batches: unknown[] = graph.value.batches
          const batch = batches.find(
            (row: unknown) =>
              typeof row === 'object' && row !== null && JSON.stringify(row).includes('@actvero/dsh-client-account'),
          )
          if (!batch || typeof batch !== 'object' || !('url' in batch) || typeof batch.url !== 'string')
            throw new Error('Missing account artifact')
          const response = await fetch(new URL(batch.url, ready.url), { headers: { cookie } })
          expect(response.status).toBe(200)
          const asset = await response.text()
          expect(asset).toContain('actvero.account')
          expect(asset).toContain('settings.section')
          expect(asset).toContain('sidebar.brand.mark')
        } else {
          expect(serialized).not.toContain('@actvero/dsh-client-account')
          expect(serialized).toContain('@deepseek-ai/dsh-client-ui-settings-account')
          expect(serialized).toContain('@deepseek-ai/dsh-client-ui-brand-official')
        }
        await host.stop()
        host = undefined
      }
    } finally {
      await host?.stop()
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
