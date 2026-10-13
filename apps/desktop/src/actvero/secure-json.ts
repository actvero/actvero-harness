import { safeStorage } from 'electron'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Main-owned JSON storage; failed reads preserve ciphertext and never reset it. */
export class SecureJsonFile {
  private async ready(): Promise<void> {
    try {
      if (!(await safeStorage.isAsyncEncryptionAvailable()) ||
          (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'))
        throw new Error('secure_storage_unavailable')
    } catch {
      throw new Error('secure_storage_unavailable')
    }
  }

  /**
   * Read encrypted JSON; only a missing file uses the caller's initial state.
   * @param path - Private ciphertext file.
   * @param fallback - Initial value for a file that does not exist.
   * @returns Decoded JSON; the caller validates its domain schema.
   */
  async read<T>(path: string, fallback: T): Promise<T> {
    let encrypted: Buffer
    try {
      encrypted = await readFile(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
      throw new Error('secure_storage_unavailable')
    }
    await this.ready()
    try {
      return JSON.parse((await safeStorage.decryptStringAsync(encrypted)).result) as T
    } catch (error) {
      if (error instanceof Error && error.message.includes('temporarily unavailable'))
        throw new Error('secure_storage_unavailable')
      throw new Error('secure_storage_invalid')
    }
  }

  /**
   * Encrypt before replacing the file, flushing private contents before commit.
   * @param path - Private ciphertext file.
   * @param value - Complete next JSON value; no plaintext is written to disk.
   */
  async save(path: string, value: unknown): Promise<void> {
    await this.ready()
    const temp = `${path}.${randomUUID()}.tmp`
    try {
      const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value))
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const file = await open(temp, 'wx', 0o600)
      try {
        await file.writeFile(encrypted)
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temp, path)
      if (process.platform !== 'win32') {
        const directory = await open(dirname(path), 'r')
        try { await directory.sync() } finally { await directory.close() }
      }
    } catch {
      throw new Error('secure_storage_unavailable')
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
  }
}
