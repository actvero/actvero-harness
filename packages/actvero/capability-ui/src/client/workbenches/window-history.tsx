/** Per-window navigation between committed main views. */
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsHooks, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchView } from './register.ts'

type Destination =
  | { kind: 'panel'; id: MainPanelId }
  | { kind: 'workbench'; id: string }
  | { kind: 'home'; id: SessionId | undefined }
type Direction = -1 | 1
type Availability = { back: boolean; forward: boolean }

function same(a: Destination | undefined, b: Destination): boolean {
  return a?.kind === b.kind && a.id === b.id
}

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
 * @param businessPanel Main panel shared by workbench providers.
 * @param openWorkbench Open the selected workbench through its normal access checks.
 */
export function registerWindowHistory(ctx: Context, view: ObservableSnapshot<WorkbenchView>,
  businessPanel: MainPanelId, openWorkbench: (id: string) => void): void {
  ctx.slots.inject('sidebar.history', () => {
    const availability = createSnapshotStore<Availability>({ back: false, forward: false })
    const sessions = ctx.uiWorkspace.sessionsView
    const workspaces = ctx.uiWorkspace.workspacesView
    const entries: Destination[] = []
    let index = -1
    let epoch = view.getSnapshot().accessEpoch
    let pending = false
    let disposed = false

    function current(): Destination {
      const panel = ctx.layout.panelInfo.getSnapshot().activePanelId
      if (panel === null) {
        const row = Object.values(ctx.sessions.list.getSnapshot().byId).find(session => session.retainedBy.mainView)
        return { kind: 'home', id: row?.id }
      }
      const workbench = view.getSnapshot().opened
      if (panel === businessPanel && workbench !== null) return { kind: 'workbench', id: workbench }
      return { kind: 'panel', id: panel }
    }
    function available(entry: Destination): boolean {
      switch (entry.kind) {
        case 'home': return entry.id === undefined || Boolean(sessions.getSnapshot().byId[entry.id])
          && !workspaces.getSnapshot().archivedSessionIds.includes(entry.id)
        case 'workbench': return view.getSnapshot().entries.some(item => item.id === entry.id)
        case 'panel': return ctx.slots.entries('main').some(item => item.options.key === entry.id)
      }
    }
    function next(direction: Direction): number {
      for (let i = index + direction; i >= 0 && i < entries.length; i += direction) {
        const entry = entries[i]
        if (entry && !same(entries[index], entry) && available(entry)) return i
      }
      return -1
    }
    function sync(): void {
      const active = current()
      if (epoch !== view.getSnapshot().accessEpoch) {
        entries.length = 0
        index = -1
        epoch = view.getSnapshot().accessEpoch
      }
      const previous = entries[index]
      if (!same(previous, active)) {
        if (previous?.kind === 'home' && previous.id === undefined && active.kind === 'home') {
          entries[index] = active
        } else {
          entries.splice(index + 1, entries.length, active)
          if (entries.length > 100) entries.shift()
          index = entries.length - 1
        }
      }
      const back = next(-1) !== -1
      const forward = next(1) !== -1
      const last = availability.getSnapshot()
      if (last.back !== back || last.forward !== forward) availability.set({ back, forward })
    }
    // Opening a conversation transfers the main retain and reveals its panel in one turn.
    function schedule(): void {
      if (pending) return
      pending = true
      queueMicrotask(() => { pending = false; if (!disposed) sync() })
    }
    function go(direction: Direction): void {
      sync()
      const target = next(direction)
      const entry = entries[target]
      if (!entry) return
      switch (entry.kind) {
        case 'home':
          if (entry.id === undefined) ctx.layout.selectPanel(null)
          else ctx.uiWorkspace.openSession(entry.id)
          break
        case 'workbench': openWorkbench(entry.id); break
        case 'panel': ctx.layout.selectPanel(entry.id); break
      }
      const active = current()
      if (same(entry, active) || entry.kind === 'home' && entry.id === undefined && active.kind === 'home') {
        index = target
        entries[index] = active
      }
      sync()
    }

    const stops = [ctx.layout.panelInfo.subscribe(schedule), sessions.subscribe(schedule), workspaces.subscribe(schedule),
      view.subscribe(schedule), ctx.slots.subscribe('main', schedule)]
    sync()
    const remove = ctx.slots.register({ name: 'sidebar.history', locale: 'actvero.workbenches',
      inject: () => ({ go, hooks: { availability } }) }, HistoryButtons)
    return () => { disposed = true; stops.forEach(stop => stop()); remove() }
  })
}
