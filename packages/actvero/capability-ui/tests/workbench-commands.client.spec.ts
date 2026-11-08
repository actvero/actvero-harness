// @vitest-environment jsdom
/** Command menus cannot outlive their provider or the association they opened against. */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchId, WorkbenchInstanceId, WorkbenchSelection } from '../src/types.ts'
import { registerWorkbenchCommands } from '../src/client/workbenches/commands.ts'
import type { WorkbenchObjectId } from '../src/workbench-reference.ts'

const selection: WorkbenchSelection = { id: '@local/test' as WorkbenchId, instanceId: 'first' as WorkbenchInstanceId,
  name: 'Test', version: '1.0.0', expert: null }
const session = { sessionId: 'linked' as SessionId }

async function fixture() {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  await runtime.sessions.add({ id: session.sessionId })
  const bind = (value: WorkbenchSelection | null) => runtime.sessions.updateSummary(session.sessionId, {
    projectionValues: { actveroWorkbench: value },
  })
  await bind(selection)
  const commands = new Map<string, CommandContribution>()
  const dismiss = vi.fn()
  runtime.ctx.provide('commandUi', {
    register(command: CommandContribution) {
      if (commands.has(command.name)) throw new Error('Duplicate command')
      commands.set(command.name, command)
      return () => { commands.delete(command.name) }
    }, dismiss,
  })
  const run = vi.fn()
  const options = vi.fn(async () => [{ id: 'open', label: 'Open' }])
  const onSelect = vi.fn()
  const available = vi.fn(() => true)
  const contributions: CommandContribution[] = [
    { name: 'test-action', available, ui: { kind: 'action', run } },
    { name: 'test-popup', available, ui: { kind: 'popupSelect', options, onSelect } },
  ]
  return { runtime, commands, dismiss, run, options, onSelect, available, contributions, bind }
}

describe('workbench command scope', () => {
  it('keeps ordinary conversations clean and rechecks both association and author availability at execution', async () => {
    const { runtime, commands, contributions, run, bind, available } = await fixture()
    registerWorkbenchCommands(runtime.ctx, selection.id, contributions, () => 'no longer available')
    const command = commands.get('test-action')!
    const ui = command.ui
    if (ui.kind !== 'action') throw new Error('Expected action command')
    expect(command.available({ sessionId: 'ordinary' as SessionId })).toBe(false)
    expect(command.available(session)).toBe(true)
    ui.run(session)
    expect(run).toHaveBeenCalledExactlyOnceWith(session)
    available.mockReturnValue(false)
    expect(() => { ui.run(session) }).toThrow('no longer available')
    available.mockReturnValue(true)
    await bind(null)
    expect(command.available(session)).toBe(false)
    expect(() => { ui.run(session) }).toThrow('no longer available')
    expect(run).toHaveBeenCalledOnce()
  })

  it('rejects stale popup choices after the same workbench switches data instances', async () => {
    const { runtime, commands, contributions, bind, onSelect } = await fixture()
    registerWorkbenchCommands(runtime.ctx, selection.id, contributions, () => 'no longer available')
    const ui = commands.get('test-popup')!.ui
    if (ui.kind !== 'popupSelect') throw new Error('Expected popup')
    const options = await ui.options(session, new AbortController().signal)
    await bind({ ...selection, instanceId: 'second' as WorkbenchInstanceId })
    expect(() => ui.onSelect(options[0]!, session)).toThrow('no longer available')
    expect(onSelect).not.toHaveBeenCalled()
    const reopened = { ...session }
    await ui.options(reopened, new AbortController().signal)
    await ui.onSelect(options[0]!, reopened)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(options[0], reopened)
  })

  it('rejects a captured choice after changing objects inside the same instance', async () => {
    const { runtime, commands, contributions, bind, onSelect } = await fixture()
    await bind({ ...selection, object: { id: 'one' as WorkbenchObjectId, label: 'One' } })
    registerWorkbenchCommands(runtime.ctx, selection.id, contributions, () => 'no longer available')
    const ui = commands.get('test-popup')!.ui
    if (ui.kind !== 'popupSelect') throw new Error('Expected popup')
    const options = await ui.options(session, new AbortController().signal)
    await bind({ ...selection, object: { id: 'two' as WorkbenchObjectId, label: 'Two' } })
    expect(() => ui.onSelect(options[0]!, session)).toThrow('no longer available')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('discards late options and captured callbacks after disposal, and allows a fresh registration', async () => {
    const { runtime, commands, contributions, options, dismiss, run, onSelect } = await fixture()
    const pending = Promise.withResolvers<{ id: string; label: string }[]>()
    options.mockReturnValue(pending.promise)
    const dispose = registerWorkbenchCommands(runtime.ctx, selection.id, contributions, () => 'no longer available')
    const ui = commands.get('test-popup')!.ui
    const action = commands.get('test-action')!.ui
    if (ui.kind !== 'popupSelect' || action.kind !== 'action') throw new Error('Expected registered commands')
    const loading = ui.options(session, new AbortController().signal)
    const rejected = expect(loading).rejects.toThrow('no longer available')
    await dispose()
    pending.resolve([{ id: 'open', label: 'Open' }])
    await rejected
    expect(commands.size).toBe(0)
    expect(dismiss.mock.calls.flat().sort()).toEqual(['test-action', 'test-popup'])
    expect(() => { action.run(session) }).toThrow('no longer available')
    expect(() => ui.onSelect({ id: 'open', label: 'Open' }, session)).toThrow('no longer available')
    expect(run).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
    const replacement = registerWorkbenchCommands(runtime.ctx, selection.id, contributions, () => 'no longer available')
    await dispose()
    expect(commands.size).toBe(2)
    await replacement()
  })

  it('rolls back earlier commands on a name collision without removing the other owner', async () => {
    const { runtime, commands, contributions } = await fixture()
    const occupied = contributions[1]!
    commands.set(occupied.name, occupied)
    expect(() => registerWorkbenchCommands(runtime.ctx, selection.id, contributions, () => 'no longer available')).toThrow('Duplicate command')
    await Promise.resolve()
    expect([...commands.values()]).toEqual([occupied])
  })
})
