import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  namespace: '', available: true,
  isAsyncEncryptionAvailable: vi.fn(async () => true),
  encryptStringAsync: vi.fn<(...args: [string]) => Promise<Buffer>>(),
  decryptStringAsync: vi.fn<(...args: [Buffer]) => Promise<{ result: string; shouldReEncrypt: boolean }>>(),
  rename: vi.fn<typeof import('node:fs/promises')['rename']>(),
}))
vi.mock('electron', () => ({ safeStorage: native }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, rename: (...args: Parameters<typeof fs.rename>) => native.rename(...args) }
})
const { SecureJsonFile } = await import('../src/actvero/secure-json.ts')
const { configureProductIdentity } = await import('../src/actvero/native-identity.ts')
const directories: string[] = []
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'actvero-secure-json-'))
  directories.push(directory)
  return { directory, path: join(directory, 'local-mcp.enc'), store: new SecureJsonFile() }
}
beforeEach(async () => {
  vi.clearAllMocks()
  native.namespace = 'com.actvero.desktop'
  native.isAsyncEncryptionAvailable.mockResolvedValue(true)
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  native.rename.mockImplementation(fs.rename)
  native.encryptStringAsync.mockImplementation(async (text) => {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(native.namespace).digest(), nonce)
    return Buffer.concat([nonce, cipher.update(text), cipher.final(), cipher.getAuthTag()])
  })
  native.decryptStringAsync.mockImplementation(async (bytes) => {
    const cipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(native.namespace).digest(), bytes.subarray(0, 12))
    cipher.setAuthTag(bytes.subarray(-16))
    return { result: Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString(), shouldReEncrypt: false }
  })
})
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('native identity and encrypted capability configuration', () => {
  it('keeps saved configuration readable when only display branding changes', async () => {
    const { path, store, directory } = await fixture()
    const paths = new Map<string, string>([['appData', tmpdir()]])
    const app = { isPackaged: true, setName: (name: string) => { native.namespace = name },
      getPath: (key: string) => paths.get(key)!,
      setPath: (key: string, value: string) => { paths.set(key, value) }, setAppUserModelId: vi.fn() }
    const product = { applicationId: 'com.actvero.desktop', displayName: 'ACTVERO' }
    const environment = { DSH_HOME: '/explicit/profile' }
    configureProductIdentity(app, product, environment, 'darwin')
    const records = [{ id: 'local-test', name: 'Private MCP', enabled: true }]
    await store.save(path, records)
    const renamed = { ...product, displayName: 'New brand' }
    configureProductIdentity(app, renamed, environment, 'darwin')
    expect(await new SecureJsonFile().read(path, [])).toEqual(records)
    expect(paths.get('userData')).toBe(join(tmpdir(), product.applicationId))
    expect(environment.DSH_HOME).toBe('/explicit/profile')
    expect((await readFile(path)).includes(Buffer.from('Private MCP'))).toBe(false)
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readdir(directory)).toEqual(['local-mcp.enc'])
  })
  it('preserves development paths and isolates other installed distributions', () => {
    const app = { isPackaged: false, setName: vi.fn(), getPath: () => tmpdir(), setPath: vi.fn(), setAppUserModelId: vi.fn() }
    configureProductIdentity(app, { applicationId: 'com.example.customer' }, {}, 'darwin')
    expect(app.setName).toHaveBeenCalledWith('com.example.customer')
    expect(app.setPath).not.toHaveBeenCalled()
    app.isPackaged = true
    const environment: NodeJS.ProcessEnv = {}
    configureProductIdentity(app, { applicationId: 'com.example.customer' }, environment, 'win32')
    expect(app.setPath).toHaveBeenCalledWith('userData', join(tmpdir(), 'com.example.customer'))
    expect(app.setAppUserModelId).toHaveBeenCalledWith('com.example.customer')
    expect(environment.DSH_HOME).toBe(join(tmpdir(), 'com.example.customer', 'dsh'))
  })
  it('only uses initial state for a missing file', async () => {
    const { path, store } = await fixture()
    expect(await store.read(path, ['initial'])).toEqual(['initial'])
    expect(native.isAsyncEncryptionAvailable).not.toHaveBeenCalled()
    await writeFile(path, 'not encrypted')
    await expect(store.read(path, [])).rejects.toThrow('secure_storage_invalid')
    expect(await readFile(path, 'utf8')).toBe('not encrypted')
  })
  it('does not discard configuration if the system key cannot decrypt it', async () => {
    const { path, store, directory } = await fixture()
    await store.save(path, [{ id: 'preserved' }])
    const ciphertext = await readFile(path)
    native.namespace = 'different.application'
    await expect(store.read(path, [])).rejects.toThrow('secure_storage_invalid')
    expect(await readFile(path)).toEqual(ciphertext)
    expect(await readdir(directory)).toEqual(['local-mcp.enc'])
  })
  it('reports unavailable storage separately and preserves previous data', async () => {
    const { path, store } = await fixture()
    await store.save(path, ['preserved'])
    const ciphertext = await readFile(path)
    native.isAsyncEncryptionAvailable.mockResolvedValue(false)
    await expect(store.read(path, [])).rejects.toThrow('secure_storage_unavailable')
    await expect(store.save(path, ['replacement'])).rejects.toThrow('secure_storage_unavailable')
    expect(await readFile(path)).toEqual(ciphertext)
    native.isAsyncEncryptionAvailable.mockResolvedValue(true)
    native.decryptStringAsync.mockRejectedValueOnce(new Error('safeStorage.decryptStringAsync is temporarily unavailable. Please try again.'))
    await expect(store.read(path, [])).rejects.toThrow('secure_storage_unavailable')
  })
  it('cleans temporary ciphertext and retains the original on a failed replacement', async () => {
    const { path, store, directory } = await fixture()
    await store.save(path, ['preserved'])
    const ciphertext = await readFile(path)
    native.rename.mockRejectedValueOnce(new Error('locked file'))
    await expect(store.save(path, ['replacement'])).rejects.toThrow('secure_storage_unavailable')
    expect(await readFile(path)).toEqual(ciphertext)
    expect(await readdir(directory)).toEqual(['local-mcp.enc'])
  })
  it('rejects invalid JSON and filesystem read failures without a reset', async () => {
    const { path, store, directory } = await fixture()
    await store.save(path, ['preserved'])
    native.decryptStringAsync.mockResolvedValueOnce({ result: '{broken', shouldReEncrypt: false })
    await expect(store.read(path, [])).rejects.toThrow('secure_storage_invalid')
    await expect(store.read(directory, [])).rejects.toThrow('secure_storage_unavailable')
    native.encryptStringAsync.mockRejectedValueOnce(new Error('unavailable'))
    await expect(store.save(path, [])).rejects.toThrow('secure_storage_unavailable')
    expect(await store.read(path, [])).toEqual(['preserved'])
  })
})
