/** Native application mark shared by workbench navigation and controls. */
import { IconAppsAddOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/** Render the shared workbench mark.
 * @param props Icon size in CSS pixels.
 * @returns Native outline icon.
 */
export function WorkbenchIcon({ size = 16 }: { size?: number }) {
  return <IconAppsAddOutlineRegular size={size} />
}
