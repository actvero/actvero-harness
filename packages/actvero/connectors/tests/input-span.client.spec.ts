import { test } from 'vitest'
import assert from 'node:assert/strict'
import { appendSpan } from '../src/client/input-span.ts'
test('append span keeps multiple reference chips and unicode text intact', () => {
  assert.deepEqual(
    appendSpan({
      draft: '/long-skill 你好 /b',
      draftRev: 9,
      occurrences: [{ length: 11 }, { length: 2 }],
    }),
    { start: 6, end: 6, draftRev: 9 },
  )
})
