import type { App } from 'electron'
import { join } from 'node:path'
import type { BuildProduct } from './build-product.ts'

/**
 * Set the system encryption namespace before Electron is ready. Display branding
 * must not change the keychain namespace or an installed distribution's data path.
 * @param app - Electron application.
 * @param product - Validated build identity.
 * @param environment - Runtime environment, retaining an explicit DSH_HOME.
 * @param platform - Operating system owning the native application identity.
 */
export function configureProductIdentity(
  app: Pick<App, 'isPackaged' | 'setName' | 'setPath' | 'getPath' | 'setAppUserModelId'>,
  product: Pick<BuildProduct, 'applicationId'>,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  app.setName(product.applicationId)
  if (!app.isPackaged) return
  const directory = join(app.getPath('appData'), product.applicationId)
  app.setPath('userData', directory)
  environment.DSH_HOME ??= join(directory, 'dsh')
  if (platform === 'win32') app.setAppUserModelId(product.applicationId)
}
