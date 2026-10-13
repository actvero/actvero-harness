import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { baselineEnvironment, readProductAssembly, validateProductConfig } from './actvero-product.ts'

const repository = resolve(import.meta.dirname, '..')
const temporary: string[] = []
const config = (): Record<string, unknown> => JSON.parse(readFileSync(join(repository, 'actvero', 'product.json'), 'utf8')) as Record<string, unknown>

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'actvero-product-'))
  temporary.push(root)
  for (const file of ['actvero/product.json', 'actvero/upstream.lock.json', 'actvero/plugins.lock.json',
    'package.json', 'packages/client/ui-sidebar-documentpreview/package.json']) {
    const target = join(root, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, readFileSync(join(repository, file)))
  }
  return root
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('ACTVERO build configuration', () => {
  it('runs the source CLI without a product/branding import deadlock', () => {
    const child = spawnSync(process.execPath, ['--import', 'tsx/esm', 'scripts/actvero-product.ts', '--check', '--config', 'actvero/product.example.json'], { cwd: repository, encoding: 'utf8', timeout: 15_000 })
    expect(child.error).toBeUndefined()
    expect(child.status).toBe(0)
    expect(child.stdout).toContain('configuration-only')
    expect(child.stderr).not.toContain('unsettled top-level await')
  })
  it('accepts a configured deployment path without requiring an issuer', () => {
    const input = config()
    input.platform = { defaultUrl: 'https://example.com/platform/' }
    expect(validateProductConfig(input).platform.defaultUrl).toBe('https://example.com/platform')
  })

  it.each(['http://example.com', 'https://user:password@example.com',
    'https://example.com?token=secret', 'https://example.com/#fragment'])('rejects unsafe configured address %s', (defaultUrl) => {
    const input = config()
    input.platform = { defaultUrl }
    expect(() => validateProductConfig(input)).toThrow()
  })

  it.each(['http://localhost:5194', 'http://127.0.0.1:5194', 'http://[::1]:5194'])('allows loopback development at %s', (defaultUrl) => {
    const input = config()
    input.platform = { defaultUrl }
    expect(validateProductConfig(input).platform.defaultUrl).toBe(defaultUrl)
  })

  it.each(['Bad/Name', 'Bad\\Name', 'Trailing.', ' Leading', 'Name\nInjected'])('rejects a non-portable native product name %s', (displayName) => {
    const input = validateProductConfig(config())
    expect(() => validateProductConfig({ ...input, product: { ...input.product, displayName } })).toThrow('portable')
  })

  it('rejects secrets and duplicate presets in public build inputs', () => {
    expect(() => validateProductConfig({ ...config(), accessToken: 'secret' })).toThrow('unsupported field')
    expect(() => validateProductConfig({ ...config(), plugins: ['better-sidebar', 'better-sidebar'] })).toThrow('duplicate')
  })

  it('requires a separate configured feed before enabling updates', () => {
    expect(() => validateProductConfig({ ...config(), updates: { enabled: true, feedUrl: null } })).toThrow('required')
    expect(() => validateProductConfig({ ...config(), updates: { enabled: true, feedUrl: 'https://cdn.deepseek.com/feed' } })).toThrow('DeepSeek')
    expect(validateProductConfig({ ...config(), updates: { enabled: true, feedUrl: 'https://updates.example.com/feed' } }).updates.enabled).toBe(true)
  })

  it('does not turn an old preset pin into runtime compatibility evidence', () => {
    const root = fixture()
    const first = readProductAssembly(root)
    expect(first.assemblyStatus).toBe('configuration-only')
    expect(first.plugins.filter(pin => pin.source === 'npm').map(pin => pin.qualification)).toEqual(['migration-required', 'migration-required'])
    expect(readProductAssembly(root)).toEqual(first)
    expect(readFileSync(join(root, 'actvero', 'product.json'))).toEqual(readFileSync(join(repository, 'actvero', 'product.json')))
  })

  it('rejects an unpinned preset and a workspace version that differs from the baseline', () => {
    const root = fixture()
    writeFileSync(join(root, 'actvero', 'product.json'), JSON.stringify({ ...config(), plugins: ['unresolved'] }))
    expect(() => readProductAssembly(root)).toThrow('missing pin')
    writeFileSync(join(root, 'actvero', 'product.json'), JSON.stringify(config()))
    writeFileSync(join(root, 'packages/client/ui-sidebar-documentpreview/package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview', version: '0.2.1-alpha.1',
    }))
    expect(() => readProductAssembly(root)).toThrow('workspace pin differs')
  })

  it('overrides inherited state and debug locations only for the isolated baseline', () => {
    const inherited = { DSH_HOME: '/user/profile', DSH_DESKTOP_USER_DATA_DIR: '/user/browser',
      DSH_DESKTOP_MAIN_INSPECT_PORT: '9229', DSH_DESKTOP_OPEN_DEVTOOLS: '1', PATH: '/bin' }
    const root = resolve(tmpdir(), 'actvero-repository')
    const environment = baselineEnvironment(root, 'actvero', inherited)
    expect(environment.DSH_HOME).toBe(join(root, 'apps/desktop/.desktop-build/actvero-baseline/home'))
    expect(environment.DSH_DESKTOP_USER_DATA_DIR).toBe(join(root, 'apps/desktop/.desktop-build/actvero-baseline/electron-user-data'))
    expect(environment.DSH_DESKTOP_MAIN_INSPECT_PORT).toBe('19329')
    expect(environment.PATH).toBe('/bin')
    expect(inherited.DSH_HOME).toBe('/user/profile')
  })
})
