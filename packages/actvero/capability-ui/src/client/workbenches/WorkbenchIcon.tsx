/** Native application mark shared by workbench navigation and controls. */
import { useState } from 'react'
import { IconAppsAddOutlineRegular, IconChecklistOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './artwork.module.css'

/** Render the shared workbench mark.
 * @param props Icon size in CSS pixels.
 * @returns Native outline icon.
 */
export function WorkbenchIcon({ size = 16 }: { size?: number }) {
  return <IconAppsAddOutlineRegular size={size} />
}

/** Display a workbench's artwork with the native fallback for missing or failed images.
 * @param props Stable workbench identity, public image URL and display size.
 * @returns Decorative artwork; the surrounding control supplies its accessible name.
 */
export function WorkbenchArtwork({ id, url, size = 16 }: { id: string; url?: string; size?: number }) {
  const [failed, setFailed] = useState<string>()
  if (url && failed !== url) return <img className={styles.image} width={size} height={size} src={url} alt=""
    onError={() => { setFailed(url) }} />
  return id === 'builtin:project-checklist' ? <IconChecklistOutlineMedium size={size} /> : <WorkbenchIcon size={size} />
}
