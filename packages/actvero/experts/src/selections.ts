import { randomUUID } from 'node:crypto'
import type { Experts } from './main.ts'
import { fail } from './schema.ts'

type Prepared = Awaited<ReturnType<Experts['prepareRuntime']>>
interface Selection {
  expertId: string
  scope: string
  revision: number
  prepared?: Promise<Prepared>
}
interface Options {
  scope(): string
  revision(): number
  prepare(id: string): Promise<Prepared>
}

/** Main-owned validation shared only by the IPC requests of one active summon. */
export class ExpertSelections {
  private operations = new Map<string, Selection>()
  constructor(private options: Options) {}

  /** Discard in-flight selection evidence after account changes or Host shutdown. */
  invalidate(): void { this.operations.clear() }

  /**
   * Own the complete selection lifetime; neither failures nor successes survive this callback.
   * @param expertId - Expert being selected.
   * @param work - Trusted Host control operation receiving an opaque operation identifier.
   * @returns The completed Host result; account or installation changes reject.
   */
  async run<T>(expertId: string, work: (operation: string) => Promise<T>): Promise<T> {
    const operation = randomUUID(), started = performance.now()
    this.operations.set(operation, { expertId, scope: this.options.scope(), revision: this.options.revision() })
    let completed = false
    try {
      const result = await work(operation)
      this.get(operation)
      completed = true
      return result
    } finally {
      this.operations.delete(operation)
      console.info('[actvero-experts]', JSON.stringify({ phase: 'summon', completed, durationMs: Math.round(performance.now() - started) }))
    }
  }

  private get(operation: string): Selection {
    const row = this.operations.get(operation)
    if (!row) return fail('expert_selection_expired')
    if (row.scope !== this.options.scope()) return fail('expert_account_changed')
    if (row.revision !== this.options.revision()) return fail('expert_dependencies_changed')
    return row
  }

  /**
   * Prepare an expert once for an active summon; opaque identifiers are never accepted from renderer state.
   * @param operation - Identifier issued by run for the trusted Host.
   * @param expertId - Must match the expert named when the operation began.
   * @returns The verified selection, shared by sequential and concurrent requests.
   */
  async prepare(operation: string, expertId: string): Promise<Prepared> {
    const row = this.get(operation)
    if (row.expertId !== expertId) return fail('expert_snapshot_invalid')
    row.prepared ??= this.options.prepare(expertId)
    const result = await row.prepared
    this.get(operation)
    return result
  }

  /**
   * Reuse verified content during activation of this selection, never for a later model step.
   * @param operation - Active trusted Host selection identifier.
   * @param snapshotId - Must be the snapshot prepared by this operation.
   * @returns Verified expert runtime.
   */
  async resolve(operation: string, snapshotId: string): Promise<Prepared['runtime']> {
    const row = this.get(operation)
    if (!row.prepared) return fail('expert_snapshot_invalid')
    const result = await row.prepared
    this.get(operation)
    if (result.lock.id !== snapshotId) return fail('expert_snapshot_invalid')
    return result.runtime
  }
}
