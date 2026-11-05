/** Reversible navigation contributions and filtered sidebar projections. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'

type Subscribe = (listener: () => void) => () => void
type Filter<T> = (id: T) => boolean

/** Source and explicit target of one native navigation request. */
export interface SessionNavigationContext {
  readonly workspaceId?: WorkspaceId
  readonly created?: boolean
}

/** A contribution returns true only when it owns the requested navigation. */
export type SessionOpener = (sessionId: SessionId | undefined, source: 'explicit-session' | 'workspace', context?: SessionNavigationContext) => boolean

/** Native navigation extension points; every registration returns its removal. */
export interface NavigationPolicyRegistration {
  /** Intercept explicit Session or Workspace opens without replacing the native browser. */
  registerSessionOpener(handler: SessionOpener): () => void
  /** Restrict which blank Sessions native New Session may reuse. */
  registerSessionReuseFilter(handler: Filter<SessionId>): () => void
  /** Filter sidebar Sessions and refresh when the contribution changes. */
  registerSessionFilter(handler: Filter<SessionId>, subscribe: Subscribe): () => void
  /** Filter sidebar Workspaces and refresh when the contribution changes. */
  registerWorkspaceFilter(handler: Filter<WorkspaceId>, subscribe: Subscribe): () => void
  /** Handle a scoped Workspace removal before deleting the shared Workspace. */
  registerWorkspaceDeleteHandler(handler: (id: WorkspaceId) => boolean | Promise<boolean>): () => void
  /** Handle global New Session before the ordinary blank-reuse flow. */
  registerSessionStarter(handler: (workspaceId?: WorkspaceId) => boolean): () => void
}

function projected<S, T>(
  source: ObservableSnapshot<S>, revision: ObservableSnapshot<number>, project: (value: S) => T,
): ObservableSnapshot<T> {
  let previous: S | undefined
  let seenRevision = -1
  let value: T
  return {
    getSnapshot() {
      const next = source.getSnapshot()
      const nextRevision = revision.getSnapshot()
      if (next !== previous || nextRevision !== seenRevision) {
        value = project(next)
        previous = next
        seenRevision = nextRevision
      }
      return value
    },
    subscribe(listener) {
      const stopSource = source.subscribe(listener)
      const stopRevision = revision.subscribe(listener)
      return () => { stopSource(); stopRevision() }
    },
  }
}

/** Owns optional policies; source Controllers remain unfiltered and authoritative. */
export class WorkspaceNavigationPolicies implements NavigationPolicyRegistration {
  private readonly revision = createSnapshotStore(0)
  private readonly stops = new Set<() => void>()
  private readonly openers = new Set<SessionOpener>()
  private readonly reuse = new Set<Filter<SessionId>>()
  private readonly sessionFilters = new Set<Filter<SessionId>>()
  private readonly workspaceFilters = new Set<Filter<WorkspaceId>>()
  private readonly removers = new Set<(id: WorkspaceId) => boolean | Promise<boolean>>()
  private readonly starters = new Set<(workspaceId?: WorkspaceId) => boolean>()
  /** Filtered sidebar Session catalog, independent of the native source. */
  readonly sessions: ObservableSnapshot<SessionListState>
  /** Filtered sidebar Workspace catalog, independent of the native source. */
  readonly workspaces: ObservableSnapshot<WorkspaceSnapshot>

  /**
   * @param sessions - native Session catalog.
   * @param workspaces - native Workspace catalog.
   */
  constructor(sessions: ObservableSnapshot<SessionListState>, workspaces: ObservableSnapshot<WorkspaceSnapshot>) {
    this.sessions = projected(sessions, this.revision, value => this.sessionFilters.size === 0 ? value : {
      ...value,
      ids: value.ids.filter(id => this.sessionVisible(id)),
      byId: Object.fromEntries(Object.entries(value.byId).filter(([id]) => this.sessionVisible(id as SessionId))),
    })
    this.workspaces = projected(workspaces, this.revision, value => this.workspaceFilters.size === 0 ? value : {
      ...value, items: value.items.filter(item => [...this.workspaceFilters].every(filter => filter(item.workspaceId))),
    })
  }

  private changed = (): void => { this.revision.set(this.revision.getSnapshot() + 1) }

  private register<T>(set: Set<T>, entry: T, subscribe?: Subscribe): () => void {
    set.add(entry)
    const unsubscribe = subscribe?.(this.changed)
    this.changed()
    const dispose = (): void => {
      if (!this.stops.delete(dispose)) return
      unsubscribe?.()
      set.delete(entry)
      this.changed()
    }
    this.stops.add(dispose)
    return dispose
  }

  registerSessionOpener(handler: SessionOpener): () => void { return this.register(this.openers, handler) }
  registerSessionReuseFilter(handler: Filter<SessionId>): () => void { return this.register(this.reuse, handler) }
  registerSessionFilter(handler: Filter<SessionId>, subscribe: Subscribe): () => void {
    return this.register(this.sessionFilters, handler, subscribe)
  }
  registerWorkspaceFilter(handler: Filter<WorkspaceId>, subscribe: Subscribe): () => void {
    return this.register(this.workspaceFilters, handler, subscribe)
  }
  registerWorkspaceDeleteHandler(handler: (id: WorkspaceId) => boolean | Promise<boolean>): () => void {
    return this.register(this.removers, handler)
  }
  registerSessionStarter(handler: (workspaceId?: WorkspaceId) => boolean): () => void { return this.register(this.starters, handler) }

  /**
   * Evaluate all sidebar Session filters.
   * @param id - Session being displayed.
   * @returns whether every filter accepts it.
   */
  sessionVisible(id: SessionId): boolean { return [...this.sessionFilters].every(filter => filter(id)) }
  /**
   * Evaluate all blank Session reuse filters.
   * @param id - Blank Session under consideration.
   * @returns whether every filter accepts reuse.
   */
  reusable(id: SessionId): boolean { return [...this.reuse].every(filter => filter(id)) }
  /**
   * Offer navigation to the registered policies in registration order.
   * @param id - Explicit target, or absent for Workspace navigation.
   * @param source - User navigation entry.
   * @param context - Workspace and creation facts when available.
   * @returns whether a contribution accepted navigation.
   */
  open(id: SessionId | undefined, source: 'explicit-session' | 'workspace', context?: SessionNavigationContext): boolean {
    return [...this.openers].some(opener => opener(id, source, context))
  }
  /**
   * Offer the global New Session action to scoped policies.
   * @param workspaceId - Explicit Workspace, when provided.
   * @returns whether a contribution handled the action.
   */
  start(workspaceId?: WorkspaceId): boolean { return [...this.starters].some(starter => starter(workspaceId)) }
  /**
   * Offer Workspace removal before shared data is deleted.
   * @param workspaceId - Workspace being removed.
   * @returns whether a contribution handled the removal.
   */
  async remove(workspaceId: WorkspaceId): Promise<boolean> {
    for (const remove of this.removers) if (await remove(workspaceId)) return true
    return false
  }
  /** Remove all policies and subscriptions during owner teardown. */
  dispose(): void { for (const stop of [...this.stops]) stop() }
}
