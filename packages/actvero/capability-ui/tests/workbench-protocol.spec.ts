/** Package JSON, Host and Client share one compatibility decision. */
import { describe, expect, it } from 'vitest'
import { resolveWorkbenchProtocol } from '../src/workbench-protocol.ts'

describe('workbench compatibility', () => {
  it('resolves legacy packages and accepts the current extension API independently of DSH versions', () => {
    expect(resolveWorkbenchProtocol()).toEqual({ schemaVersion: 1, hostApi: '^1.0.0' })
    expect(resolveWorkbenchProtocol({ schemaVersion: 1, hostApi: ' >=1.0.0 <2.0.0 ' })).toEqual({ schemaVersion: 1, hostApi: '>=1.0.0 <2.0.0' })
    expect(resolveWorkbenchProtocol({ schemaVersion: 1, hostApi: '^1.1.0' })).toEqual({ schemaVersion: 1, hostApi: '^1.1.0' })
  })

  it.each([
    [null, 'invalid-declaration'],
    [{}, 'invalid-declaration'],
    [{ schemaVersion: 1, hostApi: '' }, 'invalid-declaration'],
    [{ schemaVersion: 1, hostApi: 'not a version' }, 'invalid-declaration'],
    [{ schemaVersion: 1, hostApi: '^1', requiredFeature: 'private-dom' }, 'invalid-declaration'],
    [{ schemaVersion: '1', hostApi: '^1' }, 'invalid-declaration'],
    [{ schemaVersion: 2, hostApi: '^1' }, 'unsupported-schema'],
    [{ schemaVersion: 1, hostApi: '^2.0.0' }, 'incompatible-host'],
  ])('rejects an unsupported declaration %j', (declaration, code) => {
    expect(() => resolveWorkbenchProtocol(declaration)).toThrow(expect.objectContaining({ name: 'WorkbenchProtocolError', code }))
  })
})
