import { useState } from 'react'
import { Button } from './Button.tsx'
import { Menu, type MenuEntry } from './Menu.tsx'
import { Tooltip } from './Tooltip.tsx'
import { IconEllipsisOutlineRegular } from './icons/index.tsx'
import css from './ActionMenu.module.css'

/** Consistent overflow actions for resource cards; callers own the action labels. */
export interface ActionMenuProps {
  label: string
  items: readonly MenuEntry[]
  onSelect: (id: string) => void
  disabled?: boolean
  className?: string
}

/** Render a keyboard-accessible overflow trigger and a viewport-fitted menu. */
export function ActionMenu({ label, items, onSelect, disabled = false, className }: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  return <Menu className={className} open={open && !disabled} align="end" dense portal autoFocus
    onClose={() => { setOpen(false) }} items={items}
    onSelect={(id) => { setOpen(false); onSelect(id) }}
    anchor={<Tooltip label={label} portal disabled={open || disabled}>
      <Button size="sm" className={css.trigger} disabled={disabled} aria-label={label}
        aria-haspopup="menu" aria-expanded={open && !disabled} onClick={() => { setOpen(value => !value) }}>
        <IconEllipsisOutlineRegular />
      </Button>
    </Tooltip>} />
}
