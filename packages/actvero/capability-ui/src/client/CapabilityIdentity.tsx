/** Shared name and version layout for capability details. */
import type { JSX } from 'react'
import styles from './sources.module.css'

/** Render a wrapping capability name with a secondary version on the same row.
 * @param props Display name and optional localized version label and layout class supplied by the owning resource.
 * @returns Detail identity without actions or resource-specific artwork.
 */
export function CapabilityIdentity({ name, version, className }: { name: string; version?: string; className?: string }): JSX.Element {
  return <div className={[styles.identity, className].filter(Boolean).join(' ')}><h2>{name}</h2>{version && <span className={styles.version}>{version}</span>}</div>
}
