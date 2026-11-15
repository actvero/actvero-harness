/** 快捷专家激活必须恢复最近匹配会话，并阻止取消后的迟到导航。 */
import { expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createExpertLauncher, type ExpertLauncherSource } from '../src/client/launcher.ts'

const id = (value: string) => value as SessionId
function fixture() {
  const source = {
    list: vi.fn(async () => [{ id: 'expert', name: 'Expert', avatar: '' }]),
    candidates: vi.fn<ExpertLauncherSource['candidates']>(() => [
      { id: id('old'), updatedAt: 1 }, { id: id('recent'), updatedAt: 3 }, { id: id('other'), updatedAt: 4 },
    ]),
    selection: vi.fn<ExpertLauncherSource['selection']>(async sessionId => ({ id: sessionId === 'other' ? 'other-expert' : 'expert' })),
    open: vi.fn<ExpertLauncherSource['open']>(),
    summon: vi.fn<ExpertLauncherSource['summon']>(async () => {}),
  }
  return { source, launcher: createExpertLauncher(source), abort: new AbortController() }
}

it('resumes the newest matching conversation and leaves older history untouched', async () => {
  const { source, launcher, abort } = fixture()
  await launcher.activate('expert', id('current'), abort.signal)
  expect(source.candidates).toHaveBeenCalledWith('current')
  expect(source.selection.mock.calls).toEqual([['other'], ['recent']])
  expect(source.open).toHaveBeenCalledExactlyOnceWith('recent')
  expect(source.summon).not.toHaveBeenCalled()
})

it('uses the native summon flow when the workspace has no matching history', async () => {
  const { source, launcher, abort } = fixture()
  source.selection.mockResolvedValue(null)
  await launcher.activate('expert', id('current'), abort.signal)
  expect(source.open).not.toHaveBeenCalled()
  expect(source.summon).toHaveBeenCalledExactlyOnceWith('expert', 'current', abort.signal)
})

it.each(['workspace', 'catalog'])('rejects a missing %s before reading or navigating history', async (missing) => {
  const { source, launcher, abort } = fixture()
  if (missing === 'workspace') source.candidates.mockReturnValue(undefined)
  else source.list.mockResolvedValue([])
  await expect(launcher.activate('expert', id('current'), abort.signal)).rejects.toThrow('expert_')
  expect(source.selection).not.toHaveBeenCalled()
  expect(source.open).not.toHaveBeenCalled()
  expect(source.summon).not.toHaveBeenCalled()
})

it('does not navigate when cancellation overlaps a history lookup', async () => {
  const { source, launcher, abort } = fixture()
  const lookup = Promise.withResolvers<{ id: string } | null>()
  const started = Promise.withResolvers<undefined>()
  source.selection.mockImplementationOnce(() => { started.resolve(undefined); return lookup.promise })
  const pending = launcher.activate('expert', id('current'), abort.signal)
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await started.promise
  abort.abort()
  lookup.resolve({ id: 'expert' })
  await rejected
  expect(source.open).not.toHaveBeenCalled()
  expect(source.summon).not.toHaveBeenCalled()
})
