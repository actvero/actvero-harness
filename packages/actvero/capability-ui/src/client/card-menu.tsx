import { useState, type ReactNode } from 'react'
import { Button, IconEllipsisOutlineRegular, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'

/** A small, native DSH overflow menu used by capability cards. */
export interface CardMenuProps {
  label: string
  items: readonly MenuEntry[]
  onSelect: (id: string) => void
  disabled?: boolean
  className?: string
  children?: ReactNode
}

/**
 * Render an anchored card action menu. The list is portaled so cards can keep
 * their rounded clipping for content while the menu remains fully visible.
 */
export function CardMenu({ label, items, onSelect, disabled = false, className, children }: CardMenuProps) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      align="end"
      dense
      portal
      onClose={() => setOpen(false)}
      items={items}
      onSelect={(id) => {
        setOpen(false)
        onSelect(id)
      }}
      anchor={(
        <Button
          className={className}
          disabled={disabled}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >
          {children ?? <IconEllipsisOutlineRegular />}
        </Button>
      )}
    />
  )
}
