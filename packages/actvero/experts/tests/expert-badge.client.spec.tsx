// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type {} from '../src/client/Manager.tsx'
import { ExpertBadge } from '../src/client/ExpertBadge.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
const choice = { snapshotId: 'snapshot', id: 'test', version: '1.0.0', name: 'Test expert', avatar: '' }
function mount(copy = en, selected: typeof choice | null = choice, locked = false) {
  const load = vi.fn(async () => {}), open = vi.fn(), clear = vi.fn(async () => {}), failed = vi.fn()
  const view = render(<ExpertBadge useChoice={selector => selector(selected)} useLocked={selector => selector(locked)}
    useExpanded={selector => selector(false)} load={load} open={open} clear={clear} failed={failed} t={key => key in copy ? copy[key as keyof typeof copy] : key} />)
  return { view, load, open, clear, failed }
}

it.each([en, zh])('reopens the expert picker by name and removes the expert by its portrait action', async (copy) => {
  const { load, open, clear } = mount(copy)
  expect(load).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: choice.name }))
  expect(open).toHaveBeenCalledOnce()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: copy.cancelExpert })))
  expect(clear).toHaveBeenCalledOnce()
})

it('shows no label without an expert and refuses selection changes while input is locked', () => {
  const empty = mount(en, null)
  expect(screen.queryByRole('button')).toBeNull()
  empty.view.unmount()
  const locked = mount(en, choice, true)
  fireEvent.click(screen.getByRole('button', { name: choice.name }))
  fireEvent.click(screen.getByRole('button', { name: en.cancelExpert }))
  expect(locked.open).not.toHaveBeenCalled()
  expect(locked.clear).not.toHaveBeenCalled()
})

it('keeps the selected expert visible and reports a failed removal', async () => {
  const { clear, failed } = mount()
  clear.mockRejectedValueOnce(new Error('Unavailable'))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: en.cancelExpert })))
  expect(failed).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: choice.name })).toBeTruthy()
  expect(screen.getByRole('button', { name: en.cancelExpert }).hasAttribute('disabled')).toBe(false)
})

it('falls back to the expert initial when its portrait cannot load', () => {
  const portrait = 'data:image/png;base64,AAAA'
  const { view } = mount(en, { ...choice, avatar: portrait })
  const image = view.container.querySelector('img')
  expect(image?.getAttribute('src')).toBe(portrait)
  fireEvent.error(image!)
  expect(view.container.querySelector('img')).toBeNull()
  expect(view.container.querySelector('[aria-hidden="true"]')?.textContent).toBe('T')
})
