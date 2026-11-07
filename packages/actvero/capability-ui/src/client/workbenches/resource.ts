/** Authoritative workbench documents delivered through the native resource service. */
import type { Context } from '@deepseek-ai/cordis'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@actvero/dsh-capability-ui/remote'
import type { WorkbenchDocument, WorkbenchInstanceId } from '../../types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap { 'actvero-workbench': WorkbenchDocument }
}

/**
 * @param remote Native workbench document stream.
 * @returns Resource provider that retains the last successful value on transport failure.
 */
export function workbenchResource(remote: Context['remote']['actveroWorkbench']): ResourceProvider<'actvero-workbench'> {
  return {
    protocol: 'actvero-workbench',
    async *open(address, { signal }) {
      const match = /^dsh-resource:\/\/actvero-workbench\/([0-9a-f-]{36})$/.exec(address)
      if (!match) { yield { ok: false, error: new RemoteError('workbench/not-found', 'Invalid workbench address.', {}) }; return }
      try {
        for await (const value of remote.follow({ instanceId: match[1] as WorkbenchInstanceId }, signal)) yield { ok: true, value }
      } catch (error) {
        if (!signal.aborted) yield { ok: false, error: remoteErrorOf(error) ?? new RemoteError('workbench/failed', 'Unable to read business data.', {}) }
      }
    },
  }
}
