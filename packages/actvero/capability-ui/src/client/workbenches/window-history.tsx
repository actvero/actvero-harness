/** Per-window navigation between committed main views. */
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId, PanelHistoryRegistry, PanelRoutes } from '@deepseek-ai/dsh-client-ui-layout/client'
import { IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsHooks, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PanelHistory } from './panel-history.ts'
import type { WorkbenchAction, WorkbenchView } from './register.ts'

type Direction = -1 | 1
type Availability = { back: boolean; forward: boolean }
type ModuleHistory = Pick<PanelHistory<never>, 'record' | 'next' | 'go' | 'reset' | 'subscribe'>

function HistoryButtons({ useAvailability, go, t }: PropsHooks<{ availability: ObservableSnapshot<Availability> }>
  & PropsLocale<'actvero.workbenches'> & { go: (direction: Direction) => void }) {
  const { back, forward } = useAvailability(value => value)
  return <div data-window-history>
    <Tooltip label={t('windowBack')} side="bottom" delayMs={500} portal>
      <button type="button" disabled={!back} aria-label={t('windowBack')} onClick={() => go(-1)}>
        <IconChevronLeftOutlineRegular size={16} />
      </button>
    </Tooltip>
    <Tooltip label={t('windowForward')} side="bottom" delayMs={500} portal>
      <button type="button" disabled={!forward} aria-label={t('windowForward')} onClick={() => go(1)}>
        <IconChevronRightOutlineRegular size={16} />
      </button>
    </Tooltip>
  </div>
}

/** Register Back and Forward for the current window and account.
 * @param ctx Client services owning panel navigation and accessible conversations.
 * @param view Workbench catalog and active workbench.
 * @param managerPanel Workbench catalog panel.
 * @param businessPanel Main panel shared by workbench providers.
 * @param action Actions used by the workbench catalog and business views.
 */
export function registerWindowHistory(ctx: Context, view: ObservableSnapshot<WorkbenchView>,
  managerPanel: MainPanelId, businessPanel: MainPanelId, action: WorkbenchAction): void {
  ctx.slots.inject('sidebar.history', function* () {
    const availability = createSnapshotStore<Availability>({ back: false, forward: false })
    const histories = new Map<MainPanelId | null, ModuleHistory>()
    let active: ModuleHistory | undefined
    let unsubscribe: (() => void) | undefined
    let epoch = view.getSnapshot().accessEpoch
    let pending = false
    let disposed = false
    const current = () => histories.get(ctx.layout.panelInfo.getSnapshot().activePanelId)
    function sync(): void {
      if (epoch !== view.getSnapshot().accessEpoch) {
        for (const history of new Set(histories.values())) history.reset()
        epoch = view.getSnapshot().accessEpoch
      }
      const history = current()
      if (history !== active) {
        unsubscribe?.()
        active = history
        unsubscribe = history?.subscribe(schedule)
      }
      history?.record()
      const back = (history?.next(-1) ?? -1) >= 0
      const forward = (history?.next(1) ?? -1) >= 0
      const last = availability.getSnapshot()
      if (last.back !== back || last.forward !== forward) availability.set({ back, forward })
    }
    // Panel selection and its committed destination can change in the same event.
    function schedule(): void {
      if (pending) return
      pending = true
      queueMicrotask(() => { pending = false; if (!disposed) sync() })
    }
    const registry: PanelHistoryRegistry = {
      register<T>(panels: readonly (MainPanelId | null)[], routes: PanelRoutes<T>) {
        for (const panel of panels) {
          if (histories.has(panel)) throw new Error(`Navigation history already registered for ${panel ?? 'Home'}`)
        }
        const history = new PanelHistory(routes)
        for (const panel of panels) histories.set(panel, history)
        schedule()
        return () => {
          for (const panel of panels) histories.delete(panel)
          schedule()
        }
      },
    }
    const go = (direction: Direction) => {
      sync()
      current()?.go(direction)
      sync()
    }
    yield () => { disposed = true; unsubscribe?.() }
    yield view.subscribe(() => { if (epoch !== view.getSnapshot().accessEpoch) schedule() })
    yield ctx.layout.panelInfo.subscribe(schedule)
    yield ctx.reflect.provide('panelHistory', registry)
    const sessions = ctx.uiWorkspace.sessionsView
    const workspaces = ctx.uiWorkspace.workspacesView
    yield registry.register<SessionId | null>([null], {
      getSnapshot: () => Object.values(ctx.sessions.list.getSnapshot().byId).find(row => row.retainedBy.mainView)?.id ?? null,
      subscribe: (listener) => {
        const stops = [ctx.sessions.list.subscribe(listener), sessions.subscribe(listener), workspaces.subscribe(listener)]
        return () => stops.forEach(stop => stop())
      },
      same: Object.is, replace: previous => previous === null,
      available: id => id !== null && Boolean(sessions.getSnapshot().byId[id]) && !workspaces.getSnapshot().archivedSessionIds.includes(id),
      open: (id) => { if (id !== null) ctx.uiWorkspace.openSession(id) },
    })
    type WorkbenchRoute = { kind: 'catalog'; source: WorkbenchView['catalogSource'] } | { kind: 'business'; id: string }
    yield registry.register<WorkbenchRoute>([managerPanel, businessPanel], {
      getSnapshot: () => {
        const { opened, catalogSource } = view.getSnapshot()
        return ctx.layout.panelInfo.getSnapshot().activePanelId === businessPanel && opened !== null
          ? { kind: 'business', id: opened } : { kind: 'catalog', source: catalogSource }
      },
      subscribe: view.subscribe,
      same: (a, b) => a.kind === 'catalog' ? b.kind === 'catalog' && a.source === b.source : b.kind === 'business' && a.id === b.id,
      available: entry => entry.kind === 'catalog' || view.getSnapshot().entries.some(item => item.id === entry.id),
      open: (entry) => {
        if (entry.kind === 'business') action.open(entry.id)
        else {
          action.selectCatalogSource(entry.source)
          if (ctx.layout.panelInfo.getSnapshot().activePanelId !== managerPanel) action.back()
        }
      },
    })
    yield ctx.slots.register({ name: 'sidebar.history', locale: 'actvero.workbenches',
      inject: () => ({ go, hooks: { availability } }) }, HistoryButtons)
  })
}
