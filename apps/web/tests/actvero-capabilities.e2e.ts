import { writeComposerDraft } from './support.ts'
/** Real shipped Host and browser, with public display fixtures only; no credentials or model calls. */
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { chromium } from 'playwright'
import { DesktopHostProcess } from '../../desktop/src/host-process.ts'
import { DesktopProjectManager } from '../../desktop/src/project-manager.ts'
import { resolveDesktopPaths } from '../../desktop/src/paths.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../../desktop/src/host-protocol.ts'
import { prepareDevelopmentProject } from '../../desktop/scripts/development-project.ts'

/** Renderer-only display fixtures, isolated from Main, grants and upstream calls. */
function installDisplayFixtures(): void {
  const version = {
    id: 'v1',
    version: '1.0.0',
    sha256: 'a'.repeat(64),
    size: 64,
    published_at: '2026-10-06',
    release_notes: '',
  }
  const skill = {
    id: 'fixture-skill',
    name: 'fixture-skill',
    display_name: 'Fixture skill',
    description: 'A display fixture',
    category: { id: 'office', name: 'Office' },
    icon: { source: '', image: '', sha256: '' },
    revision: 1,
    current_version: version,
  }
  const connector = {
    id: 'fixture-connector',
    name: 'fixture-connector',
    display_name: 'Fixture connector',
    description: 'Tools, prompts and resources',
    icon: null,
    examples: [],
    auth_mode: 'none',
    credential_fields: [],
    connection: { status: 'connected', action: 'none', checked_at: null, error_code: null },
    counts: { tools: 1, prompts: 1, resources: 1, resourceTemplates: 1 },
    endpoint: '',
  }
  const expert = {
    manifest: {
      schemaVersion: 1,
      id: 'fixture-expert',
      version: '1.0.0',
      name: 'Fixture expert',
      description: 'A public display fixture',
      avatar:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGNwrDhHU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAMOnHFvmx7iTAAAAAElFTkSuQmCC',
      tags: ['Office'],
      category: 'office',
      instructions: '',
      conversationStarters: ['Review this project'],
      skills: [],
      connectors: [],
    },
    bindings: { skills: {}, connectors: {} },
    revision: 1,
  }
  const remoteExpert = { ...expert, manifest: { ...expert.manifest, id: 'remote-' + 'a'.repeat(64), name: 'Platform fixture' } }
  let expertFailure = '', plans = 0
  window.addEventListener('actvero-fixture-expert-error', (event) => {
    expertFailure = (event as CustomEvent<string>).detail
  })
  const listeners = new Set<() => void>(),
    expertListeners = new Set<() => void>()
  let fail = '',
    delay = false,
    optionalOn = true,
    expertSelected = true
  const rows = [
    { id: connector.id, name: connector.display_name, description: connector.description, required: true },
    {
      id: 'optional-fixture',
      name: 'Optional connector',
      description: 'Can be disabled for this conversation',
      required: false,
    },
  ]
  const connectorState = () => ({
    added: rows.map(r => r.id),
    enabled: optionalOn ? rows.map(r => r.id) : [connector.id],
    ready: [connector.id],
    rows,
  })
  window.addEventListener('actvero-fixture-refresh', () => {
    delay = true
    listeners.forEach(fn => fn())
  })
  window.addEventListener('actvero-fixture-fail', () => {
    fail = 'network'
    listeners.forEach(fn => fn())
  })
  window.addEventListener('actvero-fixture-storage', () => {
    fail = 'secure_storage_invalid'
    listeners.forEach(fn => fn())
  })
  // The fixtures live in this test's browser context, never in application code.
  Object.assign(window, {
    actveroAccount: {
      snapshot: async () => ({
        phase: 'local',
        baseUrl: location.origin,
        brand: { name: 'ACTVERO' },
        organizations: [],
        quota: { phase: 'unconfigured', windows: [] },
      }),
      subscribe: () => () => {},
      login: async () => {},
      continueAccount: async () => {},
      switchAccount: async () => {},
      cancel: async () => {},
      reopen: async () => {},
      refresh: async () => {},
      quota: async () => {},
      logout: async () => {},
      configure: async () => {},
      selectOrganization: async () => {},
      personalCenter: async () => {},
      local: async () => {},
      show: async () => {},
    },
    actveroSkills: {
      subscribe: () => () => {},
      request: async (action: string) => {
        if (action === 'state')
          return {
            scope: 'fixture',
            available: true,
            items: [{ skill, version, enabled: true, status: 'current' }],
            busy: [],
            checkFailed: false,
          }
        if (action === 'catalog') return { items: [skill], total: 1, page: 1, page_size: 20 }
        if (action === 'categories') return [{ id: 'office', name: 'Office', count: 1 }]
        if (action === 'detail') return { ...skill, skill_md: '# Fixture', entrypoint: 'SKILL.md', files: [] }
        return null
      },
    },
    actveroConnectors: {
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => {
          listeners.delete(fn)
        }
      },
      request: async (action: string, input?: Record<string, unknown>) => {
        if (action === 'state') {
          if (input?.sessionId) Object.assign(window, { actveroFixtureSessionId: input.sessionId })
          return input?.sessionId ? connectorState() : { added: [connector.id], enabled: [], ready: [connector.id] }
        }
        if (action === 'select') {
          if (input?.id === 'optional-fixture') optionalOn = input.enabled === true
          return connectorState()
        }
        if (action === 'localList')
          return [
            {
              id: 'custom-fixture',
              name: 'Local fixture',
              transport: 'http',
              enabled: false,
              command: '',
              args: [],
              env: {},
              url: 'http://127.0.0.1:1/mcp',
              headers: {},
              status: 'disabled',
              error: null,
              counts: { tools: 0, prompts: 0, resources: 0, resourceTemplates: 0 },
            },
          ]
        if (action === 'detail') return connector
        if (action === 'catalog') {
          if (delay) {
            delay = false
            await new Promise(resolve => setTimeout(resolve, 700))
          }
          if (fail) throw new Error(fail)
          return { items: [connector], total: 1, page: 1, page_size: 20 }
        }
        return null
      },
    },
    actveroExperts: {
      subscribe: (fn: () => void) => {
        expertListeners.add(fn)
        return () => expertListeners.delete(fn)
      },
      request: async (action: string, input?: Record<string, unknown>) => {
        if (action === 'select') {
          expertSelected = input?.id !== null
          expertListeners.forEach(fn => fn())
          return { sessionId: input?.sessionId }
        }
        if (action === 'selection')
          return expertSelected
            ? {
              snapshotId: 'fixture-snapshot',
              id: expert.manifest.id,
              name: expert.manifest.name,
              version: expert.manifest.version,
              avatar: expert.manifest.avatar,
            }
            : null
        if (action === 'package-pick')
          return {
            kind: 'zip',
            plan: {
              token: 'fixture-preview',
              name: 'Package expert',
              description: 'Preview display fixture',
              rows: [
                { kind: 'skills', key: 'writer', name: 'Writer', required: true, status: 'reuse' },
                { kind: 'connectors', key: 'notes', name: 'Notes', required: true, status: 'install' },
              ],
              canImport: true,
            },
          }
        if (action === 'package-discard') return true
        if (action === 'sources') return { remote: true }
        if (action === 'remote-list') return { items: [expert], total: 1 }
        if (action === 'remote-categories') return [{ id: 'office', name: 'Office' }]
        if (action === 'remote-detail') { if (expertFailure) throw new Error(expertFailure); return remoteExpert }
        if (action === 'remote-plan') {
          plans++
          document.documentElement.dataset.expertPlanCount = String(plans)
          if (expertFailure) throw new Error(expertFailure)
          return { id: remoteExpert.manifest.id, name: remoteExpert.manifest.name, canPrepare: true, dependencies: [] }
        }
        if (action === 'list') return [expert]
        if (action === 'recent')
          return [
            expert,
            remoteExpert,
            {
              ...expert,
              manifest: { ...expert.manifest, id: 'fallback-expert', name: 'Default portrait expert', avatar: '' },
            },
          ]
        return null
      },
    },
  })
}

const repository = fileURLToPath(new URL('../../../', import.meta.url))
function version(path: string): string {
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version
}
describe.skipIf(!existsSync(join(repository, 'apps/desktop-host/lib/index.js')))('ACTVERO capability browser', () => {
  it('loads managers, retains data on failed refresh and fits official selectors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'actvero-account-composition-'))
    let host: DesktopHostProcess | undefined
    const controls = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
    const control = (action: 'connector-select' | 'connector-state', input: Record<string, unknown>) =>
      new Promise<unknown>((resolve, reject) => {
        const id = randomUUID()
        const timeout = setTimeout(() => {
          controls.delete(id)
          reject(new Error('control timeout'))
        }, 10000)
        controls.set(id, {
          resolve: (v) => {
            clearTimeout(timeout)
            resolve(v)
          },
          reject: (e) => {
            clearTimeout(timeout)
            reject(e)
          },
        })
        host!.sendCapabilityMessage({ type: 'actvero:experts:control', id, action, input })
      })
    try {
      for (const name of Object.keys(process.env))
        if (/KEY|TOKEN|SECRET|PASSWORD/u.test(name)) vi.stubEnv(name, undefined)
      const home = join(root, 'home')
      mkdirSync(home)
      for (const [name, base] of [
        ['fixture-skill', join(home, 'skills')],
        ['directory-fixture', join(root, 'workspace', '.agents', 'skills')],
      ]) {
        const path = join(base!, name!)
        mkdirSync(path, { recursive: true })
        writeFileSync(
          join(path, 'SKILL.md'),
          `---\nname: ${name}\ndescription: Local skill for browser verification\n---\nRead only verification instructions.\n`,
        )
      }
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
        "- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n- id: web-runtime\n  config:\n    printUrl: false\n    openBrowser: false\n- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: '2026-09-28.1'\n" +
          readFileSync(join(repository, 'apps/web/tests/pin-browse-picker.overlay.yml'), 'utf8'),
      )
      vi.stubEnv('ACTVERO_DESKTOP', '1')
      const createHost = () =>
        new DesktopHostProcess(
          process.execPath,
          project,
          paths.profile,
          undefined,
          process.env,
          undefined,
          undefined,
          undefined,
          undefined,
          (message) => {
            if (message.type === 'actvero:experts:controlled') {
              const p = controls.get(message.id)
              if (p) {
                controls.delete(message.id)
                if (message.error) p.reject(new Error(message.error))
                else p.resolve(message.value)
              }
              return
            }
            if (message.type === 'actvero:experts:request' && message.action === 'connector-state') {
              const off =
                Array.isArray(message.input.choices) &&
                message.input.choices.some(
                  c => c && c.scope === 'local' && c.id === 'public-connection' && c.enabled === false,
                )
              host?.sendCapabilityMessage({
                type: 'actvero:experts:result',
                id: message.id,
                value: {
                  added: ['public-connection'],
                  enabled: off ? [] : ['public-connection'],
                  ready: [],
                  rows: [{ scope: 'local', id: 'public-connection', name: 'Public inert connection', required: false }],
                },
              })
              return
            }
            if (message.type === 'actvero:mcp:request' || message.type === 'actvero:skills:request')
              host?.sendCapabilityMessage({
                type: message.type === 'actvero:mcp:request' ? 'actvero:mcp:result' : 'actvero:skills:result',
                id: message.id,
                value: [],
              })
            else if (message.type === 'actvero:experts:request')
              host?.sendCapabilityMessage({ type: 'actvero:experts:result', id: message.id, error: 'expert_not_found' })
          },
        )
      host = createHost()
      const ready = await host.start()
      const browser = await chromium.launch({ channel: 'chrome' })
      try {
        const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } })
        await context.addInitScript(installDisplayFixtures)
        const page = await context.newPage(),
          errors: string[] = []
        page.setDefaultTimeout(10000)
        page.on('pageerror', e => errors.push(e.message))
        try {
          await page.goto(ready.url)
          await page.getByRole('button', { name: 'Experts · Skills · Connectors', exact: true }).waitFor()
          await page
            .getByRole('button', { name: 'Experts · Skills · Connectors', exact: true })
            .click({ timeout: 20000 })
          await page.getByRole('button', { name: 'Fixture expert', exact: true }).waitFor()
          await page.locator('[data-actvero-default-mark]').waitFor()
          for (const theme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: theme })
            await page.getByRole('tab', { name: 'Skills', exact: true }).click()
            await page.getByRole('button', { name: /Fixture skill.*A display fixture/ }).waitFor()
            await page.getByRole('button', { name: /Fixture skill.*A display fixture/ }).click()
            await page.getByRole('dialog').waitFor()
            await page.keyboard.press('Escape')
            await page.getByRole('dialog').waitFor({ state: 'hidden' })
            await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
            await page.locator('button:not([aria-haspopup])').getByText('Fixture connector', { exact: true }).waitFor()
            await page.evaluate(() => {
              window.dispatchEvent(new Event('actvero-fixture-refresh'))
            })
            await page.getByRole('status', { name: 'Loading…', exact: true }).waitFor()
            await page.getByRole('status', { name: 'Loading…', exact: true }).waitFor({ state: 'hidden' })
            await page.locator('button:not([aria-haspopup])').getByText('Fixture connector', { exact: true }).waitFor()
            await page.screenshot({
              animations: 'disabled',
              path: join(repository, '.artifacts', `actvero-connectors-${theme}.png`),
            })
            await page.getByRole('tab', { name: 'Local connectors', exact: true }).click()
            await page.getByRole('button', { name: 'Details Local fixture', exact: true }).waitFor()
            expect(
              await page
                .locator('button:not([aria-haspopup])')
                .getByText('Fixture connector', { exact: true })
                .isVisible(),
            ).toBe(false)
            expect(await page.getByRole('switch', { name: 'Enable Local fixture', exact: true }).isDisabled()).toBe(
              false,
            )
            await page.screenshot({
              animations: 'disabled',
              path: join(repository, '.artifacts', `actvero-local-connectors-${theme}.png`),
            })
            await page.getByRole('tab', { name: 'Platform connectors', exact: true }).click()
            await page.locator('button:not([aria-haspopup])').getByText('Fixture connector', { exact: true }).waitFor()
            await page.getByRole('tab', { name: 'Experts', exact: true }).click()
            await page.getByRole('button', { name: 'Fixture expert', exact: true }).waitFor()
          }
          // Verify the rendered menu anchor is inside the card, before its primary action.
          // A menu button can exist in the DOM but be clipped by a wrongly positioned wrapper.
          const checkMenu = async (
            name: string,
            primaryRole: 'button' | 'switch',
            primaryName: string,
            entries: string[],
            shot: string,
          ) => {
            const card = page
              .locator('article')
              .filter({ has: page.getByText(name, { exact: true }) })
              .first()
            const trigger = card.locator('button[aria-haspopup="menu"]')
            await card.hover()
            await expect.poll(() => trigger.evaluate(el => getComputedStyle(el.parentElement!).opacity)).toBe('1')
            const bounds = await card.boundingBox(),
              menu = await trigger.boundingBox(),
              primary = await card.getByRole(primaryRole, { name: primaryName, exact: true }).boundingBox()
            expect(bounds).not.toBeNull()
            expect(menu).not.toBeNull()
            expect(primary).not.toBeNull()
            expect(menu!.x).toBeGreaterThanOrEqual(bounds!.x)
            expect(menu!.y).toBeGreaterThanOrEqual(bounds!.y)
            expect(menu!.y + menu!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height)
            expect(menu!.x + menu!.width).toBeLessThanOrEqual(primary!.x)
            expect(Math.abs(menu!.y + menu!.height / 2 - primary!.y - primary!.height / 2)).toBeLessThanOrEqual(5)
            await trigger.click()
            for (const name of entries) await page.getByRole('menuitem', { name, exact: true }).waitFor()
            await page.screenshot({ animations: 'disabled', path: join(repository, '.artifacts', shot + '.png') })
            await page.keyboard.press('Escape')
            await page.getByRole('menu').waitFor({ state: 'hidden' })
            // Keyboard focus also reveals the auxiliary action without a mouse hover.
            await page.mouse.move(0, 0)
            await trigger.focus()
            await expect.poll(() => trigger.evaluate(el => getComputedStyle(el.parentElement!).opacity)).toBe('1')
          }
          for (const theme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: theme })
            await page.getByRole('tab', { name: 'Experts', exact: true }).click()
            await page.getByRole('tab', { name: 'My experts', exact: true }).click()
            await checkMenu(
              'Fixture expert',
              'button',
              'Summon expert Fixture expert',
              ['View', 'Export', 'Delete'],
              `actvero-expert-menu-${theme}`,
            )
            await page.getByRole('tab', { name: 'Skills', exact: true }).click()
            await page.getByRole('tab', { name: 'Local skills', exact: true }).click()
            await checkMenu(
              'Fixture skill',
              'switch',
              'Disable skill Fixture skill',
              ['View', 'Uninstall'],
              `actvero-skill-menu-${theme}`,
            )
            await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
            await page.getByRole('tab', { name: 'Local connectors', exact: true }).click()
            await checkMenu(
              'Local fixture',
              'switch',
              'Enable Local fixture',
              ['Configure MCP', 'Remove'],
              `actvero-connector-menu-${theme}`,
            )
          }
          await page.getByRole('tab', { name: 'Experts', exact: true }).click()
          await page.getByRole('button', { name: 'Import expert', exact: true }).click()
          await page.getByRole('dialog', { name: 'Confirm expert import' }).waitFor()
          await page.getByText('Reuse existing', { exact: true }).waitFor()
          await page.getByText('Install / save template', { exact: true }).waitFor()
          await page.screenshot({
            animations: 'disabled',
            path: join(repository, '.artifacts', 'actvero-expert-zip-preview.png'),
          })
          await page.getByRole('button', { name: 'Cancel', exact: true }).click()
          await page.getByRole('dialog').waitFor({ state: 'hidden' })
          await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
          await page.getByRole('tab', { name: 'Platform connectors', exact: true }).click()
          await page.locator('button:not([aria-haspopup])').getByText('Fixture connector', { exact: true }).waitFor()
          await page.evaluate(() => {
            window.dispatchEvent(new Event('actvero-fixture-fail'))
          })
          await page.getByText('Operation failed. Try again.', { exact: true }).waitFor()
          expect(
            await page.locator('button:not([aria-haspopup])').getByText('Fixture connector', { exact: true }).count(),
          ).toBe(1)
          await page.evaluate(() => {
            window.dispatchEvent(new Event('actvero-fixture-storage'))
          })
          await page
            .getByText('Unable to decrypt local connector configuration. The original is preserved.', { exact: true })
            .waitFor()
          expect(
            await page.locator('button:not([aria-haspopup])').getByText('Fixture connector', { exact: true }).count(),
          ).toBe(1)
          await page
            .getByRole('button', { name: /^New Session$/i })
            .first()
            .click()
          if (await page.getByRole('textbox', { name: 'Choose workspace', exact: true }).count())
            await page.getByRole('textbox', { name: 'Choose workspace', exact: true }).click()
          else await page.getByRole('button', { name: 'Add workspace', exact: true }).click()
          const picker = page.getByRole('dialog', { name: 'Select Workspace Directory', exact: true })
          await picker.waitFor()
          await picker.getByRole('button', { name: 'Edit path', exact: true }).click()
          const pathInput = picker.getByRole('textbox', { name: 'Edit path', exact: true })
          await pathInput.fill(join(root, 'workspace'))
          await pathInput.press('Enter')
          await pathInput.waitFor({ state: 'hidden' })
          await picker.getByRole('button', { name: 'Open', exact: true }).click()
          await picker.waitFor({ state: 'hidden' })
          await page.locator('[data-composer-input]').waitFor()
          await page.getByRole('button', { name: 'Fixture expert', exact: true }).waitFor()
          const heading = page.getByRole('heading', { name: 'What shall we do together?', exact: true })
          await heading.waitFor()
          expect(await page.getByText('Preview', { exact: true }).count()).toBe(0)
          for (const theme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: theme })
            for (const width of [1440, 900, 650]) {
              await page.setViewportSize({ width, height: 700 })
              await expect
                .poll(async () => {
                  const title = await heading.boundingBox(),
                    card = await page.locator('[data-composer-card]').boundingBox()
                  return title && card ? Math.abs(title.x + title.width / 2 - card.x - card.width / 2) : Infinity
                })
                .toBeLessThan(2)
              const bounds = await heading.boundingBox()
              const card = await page.locator('[data-composer-card]').boundingBox()
              expect(bounds).not.toBeNull()
              expect(card).not.toBeNull()
              expect(bounds!.x).toBeGreaterThanOrEqual(0)
              expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
              expect(Math.abs(bounds!.x + bounds!.width / 2 - card!.x - card!.width / 2)).toBeLessThan(2)
              const styles = await heading.evaluate((element) => {
                const style = getComputedStyle(element)
                return { fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight }
              })
              expect(styles).toEqual({ fontSize: '26px', lineHeight: '32px', fontWeight: '500' })
              await page.screenshot({
                animations: 'disabled',
                path: join(repository, '.artifacts', `actvero-hero-${theme}-${width}.png`),
              })
            }
          }
          await page.setViewportSize({ width: 1440, height: 1000 })
          const permission = page.getByRole('button', { name: 'Access mode, current: Workspace Write', exact: true })
          const expertBadge = page.locator('[data-expert-badge]')
          await permission.waitFor()
          await expect
            .poll(() =>
              page.evaluate(() => {
                const expert = document.querySelector('[data-expert-badge]')?.getBoundingClientRect()
                const access = document
                  .querySelector('button[aria-label="Access mode, current: Workspace Write"]')
                  ?.getBoundingClientRect()
                return !!expert && !!access && expert.right < access.left
              }),
            )
            .toBe(true)
          await expect.poll(() => permission.getByText('Workspace Write', { exact: true }).isVisible()).toBe(true)
          await page.locator('[data-composer-input]').click()
          await page.keyboard.insertText('/')
          await page.getByRole('option', { name: /^Skills(?:\s|$)/ }).click()
          await page.getByRole('option', { name: /^Fixture skill/ }).waitFor()
          await page.getByRole('option', { name: /^directory-fixture/ }).waitFor()
          expect(await page.getByRole('option', { name: /Manage experts/ }).count()).toBe(0)
          await page.keyboard.press('Escape')
          await page.getByRole('option', { name: /^Fixture skill/ }).waitFor({ state: 'hidden' })
          // Both /skill and the native slash source insert the same badge; typing resumes to its right.
          await writeComposerDraft(page, page.locator('[data-composer-input]'), 'existing draft')
          await page.getByRole('button', { name: 'Add files or run commands', exact: true }).click()
          await page.getByRole('option', { name: /^Skills(?:\s|$)/ }).click()
          await page.getByRole('option', { name: /^directory-fixture/ }).click()
          await page.locator('[data-composer-chip="skill"]').waitFor()
          expect(
            await page
              .locator('[data-composer-chip="skill"] > span')
              .evaluate(element => getComputedStyle(element).color),
          ).toBe(await page.locator('[data-composer-input]').evaluate(element => getComputedStyle(element).color))
          await page.keyboard.insertText('right')
          await expect
            .poll(() => page.locator('[data-composer-input]').textContent())
            .toBe('existing draft directory-fixture right')
          await page.keyboard.insertText(' /fixture-skill')
          await page.getByRole('option', { name: /^fixture-skill(?:\s|$)/ }).click()
          await expect.poll(() => page.locator('[data-composer-chip="skill"]').count()).toBe(2)
          await page.keyboard.insertText('tail')
          await expect
            .poll(() => page.locator('[data-composer-input]').textContent())
            .toBe('existing draft directory-fixture right fixture-skill tail')
          const chip = page.locator('[data-composer-chip="skill"]').first()
          await chip.hover()
          await chip.getByRole('button', { name: 'directory-fixture ×', exact: true }).click()
          await expect.poll(() => page.locator('[data-composer-chip="skill"]').count()).toBe(1)
          await page.keyboard.press('Meta+z')
          await expect.poll(() => page.locator('[data-composer-chip="skill"]').count()).toBe(2)
          await page.screenshot({
            animations: 'disabled',
            path: join(repository, '.artifacts', 'actvero-skill-badges.png'),
          })
          await writeComposerDraft(page, page.locator('[data-composer-input]'), '')
          // Directory skills are visible without import and expose original-file preview, not uninstall.
          await page.getByRole('button', { name: 'Experts · Skills · Connectors', exact: true }).click()
          await page.getByRole('tab', { name: 'Skills', exact: true }).click()
          await page.getByRole('tab', { name: 'Local skills', exact: true }).click()
          await page.getByRole('button', { name: /^directory-fixture Local skill for browser verification/ }).click()
          const directoryDetails = page.getByRole('dialog', { name: 'directory-fixture', exact: true })
          await directoryDetails.waitFor()
          await directoryDetails.getByRole('button', { name: 'View file', exact: true }).waitFor()
          expect(await directoryDetails.getByRole('button', { name: 'Uninstall', exact: true }).count()).toBe(0)
          expect(
            await directoryDetails
              .getByText(realpathSync(join(root, 'workspace', '.agents', 'skills', 'directory-fixture', 'SKILL.md')), {
                exact: true,
              })
              .count(),
          ).toBe(1)
          await page.screenshot({
            animations: 'disabled',
            path: join(repository, '.artifacts', 'actvero-directory-skill.png'),
          })
          await directoryDetails.getByRole('button', { name: 'View file', exact: true }).click()
          await page.locator('[data-textpreview-body]').waitFor()
          await expect
            .poll(async () =>
              (await page.locator('[data-textpreview-body]').innerText()).includes(
                'Read only verification instructions.',
              ),
            )
            .toBe(true)
          await page.getByRole('button', { name: 'Experts · Skills · Connectors', exact: true }).click()
          await page.getByRole('tab', { name: 'Skills', exact: true }).click()
          await page.getByRole('tab', { name: 'Local skills', exact: true }).click()
          await page.getByRole('button', { name: 'Use skill directory-fixture', exact: true }).click()
          await page.locator('[data-composer-input]').waitFor()
          await expect.poll(() => page.locator('[data-composer-chip="skill"]').count()).toBe(1)
          await page.keyboard.insertText('manager')
          await expect.poll(() => page.locator('[data-composer-input]').textContent()).toBe('directory-fixture manager')
          await writeComposerDraft(page, page.locator('[data-composer-input]'), '')
          const collapseRight = page.getByRole('button', { name: 'Collapse right sidebar', exact: true })
          if (await collapseRight.isVisible()) await collapseRight.click()
          await page.getByRole('button', { name: 'Add files or run commands', exact: true }).click()
          await page.getByRole('option', { name: /^Connectors(?:\s|$)/ }).click()
          await page.getByRole('option', { name: /^Fixture connector/ }).waitFor()
          expect(await page.getByRole('option', { name: /Manage experts/ }).count()).toBe(0)
          const required = page.getByRole('switch', { name: 'Fixture connector', exact: true }),
            optional = page.getByRole('switch', { name: 'Optional connector', exact: true })
          await expect.poll(() => required.getAttribute('aria-checked')).toBe('true')
          expect(await required.isDisabled()).toBe(true)
          await optional.click()
          await expect.poll(() => optional.getAttribute('aria-checked')).toBe('false')
          expect(await page.getByRole('listbox').count()).toBeGreaterThan(0)
          const rect = await page.getByRole('listbox').last().boundingBox()
          expect(rect?.x).toBeGreaterThanOrEqual(0)
          expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(1440)
          await page.screenshot({
            animations: 'disabled',
            path: join(repository, '.artifacts', 'actvero-selector.png'),
          })
          await page.mouse.click(1100, 150)
          await page.getByRole('option', { name: /^Fixture connector/ }).waitFor({ state: 'hidden' })
          await page.setViewportSize({ width: 900, height: 700 })
          await page.getByRole('button', { name: 'Add files or run commands', exact: true }).click()
          await page.getByRole('option', { name: /^Experts(?:\s|$)/ }).click()
          await page.getByRole('option', { name: /^Fixture expert/ }).waitFor()
          await page.getByText('Recently summoned', { exact: true }).waitFor()
          const avatar = page.getByRole('option', { name: 'Fixture expert', exact: true }).locator('img')
          await expect
            .poll(() =>
              avatar.evaluate(
                image => image instanceof HTMLImageElement && image.complete && image.naturalWidth === 32,
              ),
            )
            .toBe(true)
          const fallback = page
            .getByRole('option', { name: 'Default portrait expert', exact: true })
            .locator('[aria-hidden="true"]')
          expect(await fallback.innerText()).toBe('D')
          expect(await avatar.evaluate(image => image.parentElement!.getBoundingClientRect().width)).toBe(24)
          expect(await page.getByRole('option', { name: /Standard mode|Manage experts/ }).count()).toBe(0)
          const expertRect = await page.getByRole('listbox').last().boundingBox()
          expect(expertRect?.x).toBeGreaterThanOrEqual(0)
          expect(expertRect?.y).toBeGreaterThanOrEqual(0)
          expect((expertRect?.x ?? 0) + (expertRect?.width ?? 0)).toBeLessThanOrEqual(900)
          expect((expertRect?.y ?? 0) + (expertRect?.height ?? 0)).toBeLessThanOrEqual(700)
          await page.screenshot({
            animations: 'disabled',
            path: join(repository, '.artifacts', 'actvero-expert-selector-narrow.png'),
          })
          await page.keyboard.press('Escape')
          await page.getByRole('option', { name: /^Fixture expert/ }).waitFor({ state: 'hidden' })
          // Each summon checks the current release even after a successful summon of the same expert.
          for (const count of [1, 2]) {
            await expertBadge.getByRole('button', { name: 'Fixture expert', exact: true }).click()
            await page.getByRole('option', { name: 'Platform fixture', exact: true }).click()
            await expect.poll(() => page.locator('html').getAttribute('data-expert-plan-count')).toBe(String(count))
            await page.getByRole('option', { name: 'Platform fixture', exact: true }).waitFor({ state: 'hidden' })
          }
          for (const [code, message] of [
            ['expert_remote_cache_stale', 'Local expert preparation is outdated. Refresh platform experts and summon again.'],
            ['expert_remote_checksum', 'Expert release validation failed. Contact your administrator.'],
          ] as const) {
            await page.evaluate(code => window.dispatchEvent(new CustomEvent('actvero-fixture-expert-error', { detail: code })), code)
            await expertBadge.getByRole('button', { name: 'Fixture expert', exact: true }).click()
            await page.getByRole('option', { name: 'Platform fixture', exact: true }).click()
            await page.getByText(message, { exact: true }).waitFor()
            await page.keyboard.press('Escape')
          }
          await page.evaluate(() => window.dispatchEvent(new CustomEvent('actvero-fixture-expert-error', { detail: '' })))
          await page.setViewportSize({ width: 450, height: 700 })
          await expect.poll(() => permission.getByText('Workspace Write', { exact: true }).isVisible()).toBe(false)
          const compactExpert = await expertBadge.boundingBox(),
            compactPermission = await permission.boundingBox()
          expect(compactExpert!.x + compactExpert!.width).toBeLessThan(compactPermission!.x)
          await expect.poll(() => permission.getByText('Workspace Write', { exact: true }).isVisible()).toBe(false)
          expect(await permission.locator('svg:visible').count()).toBe(1)
          await permission.hover()
          await page.getByRole('tooltip', { name: 'Access mode, current: Workspace Write', exact: true }).waitFor()
          await permission.click()
          await page.getByRole('menuitem', { name: 'Read Only', exact: true }).waitFor()
          const menu = await page.getByRole('menu').boundingBox()
          expect(menu!.x).toBeGreaterThanOrEqual(0)
          expect(menu!.y).toBeGreaterThanOrEqual(0)
          expect(menu!.x + menu!.width).toBeLessThanOrEqual(450)
          expect(menu!.y + menu!.height).toBeLessThanOrEqual(700)
          await page.keyboard.press('Escape')
          await page.getByRole('menu').waitFor({ state: 'hidden' })
          await permission.click()
          await page.getByRole('menu').waitFor()
          await page.mouse.click(400, 100)
          await page.getByRole('menu').waitFor({ state: 'hidden' })
          await page.screenshot({
            animations: 'disabled',
            path: join(repository, '.artifacts', 'actvero-expert-permission-compact.png'),
          })
          await page.setViewportSize({ width: 900, height: 700 })
          await expect.poll(() => permission.getByText('Workspace Write', { exact: true }).isVisible()).toBe(true)
          const input = page.locator('[data-composer-input]')
          await writeComposerDraft(page, input, 'Keep this draft')
          await expect.poll(() => input.innerText()).toBe('Keep this draft')
          const badge = page.locator('[data-expert-badge]')
          for (const theme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: theme })
            await badge.getByRole('button', { name: 'Fixture expert', exact: true }).click()
            await page.getByRole('option', { name: /^Fixture expert/ }).waitFor()
            await page.getByRole('option', { name: /^Fixture expert/ }).click()
            await page.getByRole('option', { name: /^Fixture expert/ }).waitFor({ state: 'hidden' })
            expect(await input.innerText()).toBe('Keep this draft')
            await badge.hover()
            const remove = badge.getByRole('button', { name: 'Stop using this expert', exact: true })
            await expect
              .poll(() =>
                remove
                  .locator('[aria-hidden]')
                  .last()
                  .evaluate(element => getComputedStyle(element).opacity),
              )
              .toBe('1')
            await remove.hover()
            await page.getByRole('tooltip', { name: 'Stop using this expert', exact: true }).waitFor()
            await page.screenshot({
              animations: 'disabled',
              path: join(repository, '.artifacts', `actvero-expert-badge-${theme}.png`),
            })
            await badge.getByRole('button', { name: 'Fixture expert', exact: true }).click()
            await page.getByRole('option', { name: /^Fixture expert/ }).waitFor()
            await page.keyboard.press('Escape')
            await page.getByRole('option', { name: /^Fixture expert/ }).waitFor({ state: 'hidden' })
          }
          await badge.getByRole('button', { name: 'Stop using this expert', exact: true }).click()
          await badge.waitFor({ state: 'hidden' })
          expect(await input.innerText()).toBe('Keep this draft')
          expect(errors).toEqual([])
          const sessionId = await page.evaluate(() => Reflect.get(window, 'actveroFixtureSessionId'))
          expect(typeof sessionId).toBe('string')
          expect(
            await control('connector-select', { sessionId, id: 'public-connection', enabled: false }),
          ).toMatchObject({ enabled: [] })
          await host.stop()
          host = createHost()
          await host.start()
          expect(await control('connector-state', { sessionId })).toMatchObject({ enabled: [] })
        } catch (error) {
          await page.screenshot({
            animations: 'disabled',
            path: join(repository, '.artifacts', 'actvero-capabilities-failure.png'),
          })
          console.log({ errors, body: (await page.locator('body').innerText()).slice(0, 4000) })
          throw error
        }
      } finally {
        await browser.close()
      }
    } finally {
      await host?.stop()
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  }, 90000)
})
