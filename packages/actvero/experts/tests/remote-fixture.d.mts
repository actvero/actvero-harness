import type { RemoteExperts } from '../src/remote-main.ts'
import type { Experts } from '../src/main.ts'
import type { RemoteEnvelope } from '../src/remote-types.ts'
import type { Installed } from '@actvero/dsh-skills/contracts'

type Options=ConstructorParameters<typeof RemoteExperts>[0]
/** Mutable public platform responses and skill state for exact-release regression tests. */
export interface RemoteFixture {
  identity:NonNullable<ReturnType<Options['identity']>>
  state:Record<'visible'|'conflict'|'releaseChanged'|'optionalDenied'|'skillChanged'|'network'|'badEndpoint'|'badDigest'|'rogueTool'|'tokenExpired',boolean>
  wire:RemoteEnvelope
  refs:RemoteEnvelope['dependency_refs']
  calls:{ path:string;method?:string;body?:Record<string,unknown> }[]
  skills:Options['skills']&ConstructorParameters<typeof Experts>[0]['skills']
  issue:Options['issue']
  fetcher:typeof fetch
  endpoint(release?:string):string
  installed:Map<string,Installed>
  readonly installs:number
  publish(id:string,version:string):void
  rehash():void
}
export const ids:{expert:string;release:string;skill:string;other:string;version:string;service:string}
export function remoteFixture():RemoteFixture
