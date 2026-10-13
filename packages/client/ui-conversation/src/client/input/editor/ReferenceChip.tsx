/**
 * Visual body of one inline reference chip: the DecoratorNode's React
 * face. Pure display — identity, invalidation, and lifecycle live on the
 * ReferenceChipNode; this component renders whatever the node carries.
 */
import clsx from 'clsx'
import { IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { ReferenceIconRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReferenceIconKind } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ReferenceChip.module.css'
import referenceCss from './composer-editor.module.css'

/** Display inputs of one chip (the node's cached owner projections). */
export interface ReferenceChipProps {
  readonly label: string
  readonly onRemove?: () => void
  /** Domain glyph; absent renders the trigger marker instead of an icon. */
  readonly appearance?: ReferenceIconKind | undefined
  /** Owner-resolution failure styling bit. */
  readonly invalid: boolean
}

/**
 * Render one inline reference chip.
 * @param props - label, optional domain glyph, and the invalid bit.
 * @returns the chip body (icon + truncating label).
 */
export function ReferenceChip({ label, appearance, invalid, onRemove }: ReferenceChipProps): ReactNode {
  return (
    <span className={clsx(referenceCss.reference, css.chip, appearance === 'skill' && css.skill, appearance === 'file' && !invalid && referenceCss.openable, invalid && css.invalid)} title={label}>
      {appearance === undefined
        ? <span className={css.marker} aria-hidden>@</span>
        : <span className={css.glyph}><ReferenceIconRegular kind={appearance} size={14} className={css.icon} />{appearance==='skill'&&onRemove&&<button type="button" data-remove-reference aria-label={`${label} ×`} className={css.remove} onPointerDown={(event)=>{ event.preventDefault() }} onClick={(event)=>{event.preventDefault();event.stopPropagation();onRemove()}}><IconCloseOutlineRegular size={14}/></button>}</span>}
      <span className={css.label}>{label}</span>
    </span>
  )
}
