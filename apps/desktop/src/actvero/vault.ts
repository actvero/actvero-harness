import { safeStorage } from 'electron'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Vault, VaultData } from './state.ts'
import { decodeVault } from './state.ts'
import { AccountError } from './policy.ts'
/** System encryption, atomic replacement and durable file contents. */
export class SecureVault implements Vault {
  constructor(private path: string) {}
  async ready(): Promise<void> {
    if (
      !(await safeStorage.isAsyncEncryptionAvailable()) ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new AccountError('storage_unavailable')
  }
  async load(): Promise<VaultData | undefined> {
    let encrypted: Buffer
    try {
      encrypted = await readFile(this.path)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw new AccountError('storage_unavailable')
    }
    await this.ready()
    try {
      return decodeVault(JSON.parse((await safeStorage.decryptStringAsync(encrypted)).result))
    } catch {
      throw new AccountError('storage_invalid')
    }
  }
  async save(value: VaultData): Promise<void> {
    await this.ready()
    const temp = `${this.path}.${randomUUID()}.tmp`
    try {
      const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value))
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      const file = await open(temp, 'wx', 0o600)
      try {
        await file.writeFile(encrypted)
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temp, this.path)
      // Directory synchronization persists the rename across a system crash on POSIX.
      if (process.platform !== 'win32') {
        const directory = await open(dirname(this.path), 'r')
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
      }
    } catch {
      throw new AccountError('storage_unavailable')
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
  }
}
