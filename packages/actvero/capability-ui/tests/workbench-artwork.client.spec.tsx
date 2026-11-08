// @vitest-environment jsdom
/** Failed artwork falls back without leaving a broken image and recovers for a new package URL. */
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { WorkbenchArtwork } from '../src/client/workbenches/WorkbenchIcon.tsx'

afterEach(cleanup)

it('recovers from missing and failed artwork when an updated icon becomes available', () => {
  const { container, rerender } = render(<WorkbenchArtwork id="local:checklist" />)
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('svg')).not.toBeNull()
  rerender(<WorkbenchArtwork id="local:checklist" url="data:image/png;base64,broken" />)
  const broken = container.querySelector('img')
  if (!broken) throw new Error('Missing declared artwork')
  fireEvent.error(broken)
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('svg')).not.toBeNull()
  rerender(<WorkbenchArtwork id="local:checklist" url="data:image/svg+xml,new-version" size={22} />)
  expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/svg+xml,new-version')
  expect(container.querySelector('img')?.width).toBe(22)
})
