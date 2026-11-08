/** Shared compatibility declaration for Host and Client workbench registrations. */
import { satisfies, validRange } from 'semver'
import { z } from 'zod'

/** Workbench extension API implemented by this host. */
export const WORKBENCH_HOST_API_VERSION = '1.2.0'

/** Package requirements checked before registering a workbench implementation. */
export interface WorkbenchProtocol {
  /** Declaration format generation; the current host accepts 1. */
  schemaVersion: number
  /** SemVer range of the workbench extension API, separate from engines.dsh. */
  hostApi: string
}

/** Invalid declarations and unsupported requirements prevent registration without side effects. */
export class WorkbenchProtocolError extends Error {
  /**
   * @param code Stable compatibility failure category.
   * @param message Requirement and corrective context for package authors.
   */
  constructor(readonly code: 'invalid-declaration' | 'unsupported-schema' | 'incompatible-host', message: string) {
    super(message)
    this.name = 'WorkbenchProtocolError'
  }
}

const declaration = z.object({ schemaVersion: z.number().int(), hostApi: z.string().trim().min(1) }).strict()

/** Resolve legacy registrations and reject unsupported workbench requirements.
 * @param protocol Package JSON or registration declaration; omission uses the original API.
 * @returns Validated requirements; throws WorkbenchProtocolError before contributions are registered.
 */
export function resolveWorkbenchProtocol(protocol?: unknown): WorkbenchProtocol {
  const parsed = declaration.safeParse(protocol === undefined ? { schemaVersion: 1, hostApi: '^1.0.0' } : protocol)
  if (!parsed.success) throw new WorkbenchProtocolError('invalid-declaration', 'Workbench protocol requires schemaVersion and a hostApi SemVer range.')
  const resolved = parsed.data
  if (resolved.schemaVersion !== 1) throw new WorkbenchProtocolError('unsupported-schema', `Unsupported workbench schema version: ${resolved.schemaVersion}; this host supports 1.`)
  if (validRange(resolved.hostApi) === null) throw new WorkbenchProtocolError('invalid-declaration', 'Invalid workbench host API range.')
  if (!satisfies(WORKBENCH_HOST_API_VERSION, resolved.hostApi)) {
    throw new WorkbenchProtocolError('incompatible-host', `Workbench requires host API ${resolved.hostApi}; current host provides ${WORKBENCH_HOST_API_VERSION}.`)
  }
  return { ...resolved }
}
