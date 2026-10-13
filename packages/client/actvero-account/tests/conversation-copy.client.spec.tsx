// @vitest-environment jsdom
/** ACTVERO copy through the real Loader; native clock and fallback remain owned by DSH. */
import { act, cleanup, render, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import { ClientRoster, TestClient, remoteDefaultResponses, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountBridge } from '../src/protocol.ts'
import { WorkingLabel } from '../src/client/ConversationCopy.tsx'
import { en, zh } from '../src/client/locales.ts'
import { RunningStatus } from '../../ui-chat/src/client/chat/RunningStatus.tsx'
import { zh as chatZh } from '../../ui-chat/src/client/locale.ts'
import { zh as commonZh } from '../../locale/src/locales/zh.ts'

const ACCOUNT = '@actvero/dsh-client-account'
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); Reflect.deleteProperty(window, 'actveroAccount') })

it('installs localized copy and restores the native hero on unloading through the real Loader', async () => {
  Object.assign(window, { actveroAccount: {
    snapshot: async () => ({ phase: 'signed-out', baseUrl: 'https://platform.example', brand: { name: 'ACTVERO' }, organizations: [], quota: { phase: 'unconfigured', windows: [] } }),
    subscribe: () => () => {}, login: async () => {}, logout: async () => {}, cancel: async () => {}, reopen: async () => {},
    refresh: async () => {}, quota: async () => {}, configure: async () => {}, selectOrganization: async () => {},
    personalCenter: async () => {}, local: async () => {}, show: async () => {},
    continueAccount: async () => {}, switchAccount: async () => {},
  } satisfies AccountBridge })
  const roster = ClientRoster.of([
    ...webApp.rows.filter(row => row.name !== ACCOUNT),
    { name: ACCOUNT, inject: ['@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-chat', '@deepseek-ai/dsh-client-locale'], immediately: false },
  ])
  const mock = RemoteMock.create().load(remoteDefaultResponses).unary('settings/mutate', undefined)
  const client = await TestClient.start({ roster }, mock, { mount: true })
  try {
    await act(async () => { client.ctx.locale.setLocale('en') })
    expect(within(client.container!).getByRole('heading', { name: en.heroHeadline })).toBeTruthy()
    expect(within(client.container!).queryByText('Preview', { exact: true })).toBeNull()
    expect(client.ctx.slots.entries('conversation.chat.running.label')).toHaveLength(1)
    await act(async () => { client.ctx.locale.setLocale('zh') })
    expect(within(client.container!).getByRole('heading', { name: zh.heroHeadline })).toBeTruthy()
    await act(async () => { await client.unload(ACCOUNT) })
    expect(within(client.container!).queryByRole('heading', { name: zh.heroHeadline })).toBeNull()
    expect(within(client.container!).getByText('探索未至之境', { exact: true })).toBeTruthy()
    expect(within(client.container!).getByText('预览版', { exact: true })).toBeTruthy()
    expect(client.ctx.slots.entries('conversation.chat.running.label')).toHaveLength(0)
    mock.assertNoUnmatched()
  } finally { await client.dispose() }
}, 60000)

it('keeps Working stable for screen readers while the native clock advances visually', () => {
  vi.useFakeTimers(); vi.setSystemTime(5000)
  const copy = makeTranslate(zh)
  const view = render(<RunningStatus startTime={4000} t={makeTranslate(chatZh, commonZh)} renderSlot={(_key, owner) => {
    if (!('duration' in owner) || (owner.duration !== undefined && typeof owner.duration !== 'string')) return null
    return <WorkingLabel {...({} as PropsRuntime<'conversation.chat.running.label'>)} duration={owner.duration} t={copy} />
  }} />)
  expect(view.getByRole('status').textContent).toBe(zh.working)
  expect(view.getAllByText('正在工作 · 1秒…')).toHaveLength(2)
  act(() => { vi.advanceTimersByTime(2000) })
  expect(view.getAllByText('正在工作 · 3秒…')).toHaveLength(2)
  expect(view.getByRole('status').textContent).toBe(zh.working)
  expect(view.container.querySelectorAll('[data-shimmer="true"]')).toHaveLength(1)
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})
