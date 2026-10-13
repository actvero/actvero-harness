import type { Configuration, MacConfiguration, WindowsConfiguration, NsisOptions } from 'electron-builder'
import type { BuildProduct } from '../src/actvero/build-product.ts'

/** Concrete brand fields emitted for an unsigned local installer. */
export interface ActveroElectronBuilderConfig extends Omit<Configuration, 'extraMetadata' | 'extraResources' | 'artifactName'> {
  readonly artifactName: string
  readonly extraMetadata: { readonly version: string; readonly dshDesktopAppId: string; readonly actveroBuildProduct: BuildProduct }
  readonly extraResources: readonly { readonly from: string; readonly to: string }[]
  readonly mac: MacConfiguration
  readonly win: WindowsConfiguration
  readonly nsis: NsisOptions
}

/**
 * Create an unsigned package from validated product defaults and prepared target resources.
 * @param product - Public identity and fallback artwork.
 * @param directory - Fingerprinted branding directory.
 * @param env - Target environment; defaults to process.env.
 * @returns Installer configuration with runtime verification callbacks.
 */
export function createActveroElectronBuilderConfig(product: BuildProduct, directory: string, env?: NodeJS.ProcessEnv): ActveroElectronBuilderConfig
