import { expect, it } from 'vitest'
import { desktopTestExpert } from '../src/defaults.ts'
import { expertOptions } from '../src/client/selector.ts'
import { en } from '../src/client/locales.ts'

it('shows recent summons in order with no ordinary mode or manager navigation', () => {
  const other = { ...desktopTestExpert, manifest: { ...desktopTestExpert.manifest, id: 'other', name: 'Other expert', avatar: 'data:image/png;base64,portrait' } }
  const current = { snapshotId: 'snapshot', ...desktopTestExpert.manifest }
  const rows = expertOptions([other, desktopTestExpert, other], current, key => en[key])
  expect(rows.map(row => row.id)).toEqual(['other', desktopTestExpert.manifest.id])
  expect(rows.map(row => row.active)).toEqual([false, true])
  expect(rows.map(row => row.avatar)).toEqual([
    { src: other.manifest.avatar, fallback: 'O' },
    { src: desktopTestExpert.manifest.avatar, fallback: '桌' },
  ])
  expect(rows.every(row => row.group?.label === en.recent)).toBe(true)
  expect(expertOptions([], null, key => en[key])).toEqual([])
})

it('distinguishes same-name experts by their owning workbench', () => {
  const entry = (id: string, name: string) => ({ ...desktopTestExpert,
    manifest: { ...desktopTestExpert.manifest, id: 'workbench:' + id, name: '项目助手' }, workbench: { name } })
  const rows = expertOptions([entry('@local/board', '项目看板'), entry('@local/data', '数据看板')], null, key => en[key])
  expect(rows.map(row => [row.label, row.detail])).toEqual([['项目助手', '项目看板'], ['项目助手', '数据看板']])
  expect(rows.every(row => row.group?.label === en.fromWorkbench)).toBe(true)
})
