/** Export failure; remote state is untouched and local inputs must be checked before retry. */
export class ClientReleaseExportError extends Error {
  readonly code: string
}

/** Validate one complete target and create a portable client-release.json without overwriting it. */
export function exportClientRelease(directory: string, target: 'win-x64' | 'win-arm64' | 'mac-arm64' | 'mac-x64', minimumOS: string): Promise<string>
