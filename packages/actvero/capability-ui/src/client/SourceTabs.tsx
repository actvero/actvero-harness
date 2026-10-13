/** Shared source filters for expert, skill and connector managers. */
import type { JSX } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './sources.module.css'

type Source = 'platform' | 'local'
interface SourceTabsProps {
  value: Source
  platformLabel: string
  localLabel: string
  onChange: (source: Source) => void
  count?: number
}

/**
 * Render source filters with matching sizing and roving keyboard navigation.
 * @param props - current source, localized labels, selection callback and optional result count.
 * @returns the shared filter row.
 */
export function SourceTabs({ value, platformLabel, localLabel, onChange, count }: SourceTabsProps): JSX.Element {
  return (
    <div className={styles.sources}>
      <div role="tablist" aria-label={`${platformLabel} · ${localLabel}`} className={styles.tabs}>
        {(['platform', 'local'] as const).map(source => (
          <Button
            key={source} role="tab" aria-selected={source === value} tabIndex={source === value ? 0 : -1} variant="ghost"
            onClick={() => { onChange(source) }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 'platform'
                : event.key === 'End' ? 'local' : value === 'platform' ? 'local' : 'platform'
              onChange(next)
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next === 'platform' ? 0 : 1]?.focus()
            }}
          >
            {source === 'platform' ? platformLabel : localLabel}
          </Button>
        ))}
      </div>
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </div>
  )
}
