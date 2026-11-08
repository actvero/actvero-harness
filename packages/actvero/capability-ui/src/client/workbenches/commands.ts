/** Native command registrations scoped to the provider's associated conversations. */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkbenchInstanceId } from '../../types.ts'

/** Register native commands with current association checks and popup lifetime ownership.
 * @param ctx Registry lifetime and native services.
 * @param id Owning workbench id.
 * @param commands Author contributions; names remain native, globally unique command names.
 * @param unavailable Localized refusal shown by the native command menu.
 * @returns Disposer that invalidates captured callbacks before dismissing popups and removing commands.
 */
export function registerWorkbenchCommands(
  ctx: Context, id: string, commands: readonly CommandContribution[], unavailable: () => string,
): () => void | Promise<void> {
  return ctx.effect(function* () {
    let active = true
    yield () => { active = false }
    for (const command of commands) {
      const selected = new WeakMap<ClientSessionContext, WorkbenchInstanceId>()
      const instance = (session: ClientSessionContext) => {
        const state = ctx.sessions.list.getSnapshot()
        const binding = state.phase === 'ready' ? state.byId[session.sessionId]?.projectionValues?.actveroWorkbench : undefined
        return active && binding?.id === id ? binding.instanceId : undefined
      }
      const available = (session: ClientSessionContext) => instance(session) !== undefined && command.available(session)
      const requireInstance = (session: ClientSessionContext) => {
        const current = instance(session)
        if (current === undefined || !command.available(session) || (selected.has(session) && selected.get(session) !== current)) {
          throw new RemoteError('workbench/command', unavailable(), { status: 'unavailable' })
        }
        return current
      }
      const ui = command.ui
      const dispose = ctx.commandUi.register({ ...command, available, ui: ui.kind === 'action'
        ? { kind: 'action', run(session) { requireInstance(session); ui.run(session) } }
        : { ...ui,
          async options(session, signal) {
            selected.set(session, requireInstance(session))
            const options = await ui.options(session, signal)
            signal.throwIfAborted()
            requireInstance(session)
            return options
          },
          onSelect(option, session) {
            requireInstance(session)
            if (!selected.has(session)) throw new RemoteError('workbench/command', unavailable(), { status: 'unavailable' })
            return ui.onSelect(option, session)
          },
        },
      })
      yield () => { active = false; ctx.commandUi.dismiss(command.name); dispose() }
    }
  })
}
