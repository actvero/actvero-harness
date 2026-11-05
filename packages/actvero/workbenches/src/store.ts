/** Atomic local project records; business data and native Session logs have separate owners. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { stateSchema, WorkbenchError, type WorkbenchState } from './contracts.ts'

/** Atomic local records protected by an interprocess file lock. */
export class WorkbenchStore {
  readonly path: string
  constructor(readonly root: string) { this.path = join(root, 'state.json') }

  async read(): Promise<WorkbenchState> {
    let source: string
    try { source = await readFile(this.path, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, projects: [], conversations: [], favorites: [] }
      throw error
    }
    try { return stateSchema.parse(JSON.parse(source)) }
    catch (error) { throw new WorkbenchError('invalid-state', { cause: error }) }
  }

  async change<T>(operation: (state: WorkbenchState) => T | Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    return withFileLock(this.path, async () => {
      const state = await this.read()
      const result = await operation(state)
      await writeFileAtomic(this.path, JSON.stringify(stateSchema.parse(state)) + '\n', { mode: 0o600, dirMode: 0o700 })
      return result
    })
  }
}
