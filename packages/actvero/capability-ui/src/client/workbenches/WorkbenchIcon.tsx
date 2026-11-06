/** Grid mark shared by the sidebar and the local workbench cards. */
export function WorkbenchIcon({ size = 16 }: { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.65">
    <rect x="2.75" y="2.75" width="5.5" height="5.5" rx="1.1" />
    <rect x="11.75" y="2.75" width="5.5" height="5.5" rx="1.1" />
    <rect x="2.75" y="11.75" width="5.5" height="5.5" rx="1.1" />
    <rect x="11.75" y="11.75" width="5.5" height="5.5" rx="1.1" />
  </svg>
}
