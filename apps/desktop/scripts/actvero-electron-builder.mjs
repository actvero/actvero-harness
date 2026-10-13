/** Assemble branded test packages using the verified DSH target runtime. */
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { officePackageDirectories } from '../../../scripts/libreoffice-packages.mjs'
import { fileURLToPath } from 'node:url'
import { resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
const appRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * Create an unsigned local package without inheriting official publishing or signing settings.
 * @param {import('../src/actvero/build-product.ts').BuildProduct} product - Validated public defaults.
 * @param {string} directory - Prepared branding assets.
 * @param {NodeJS.ProcessEnv} env - Target environment.
 * @returns {object} electron-builder configuration; runtime verification runs before and after packing.
 */
export function createActveroElectronBuilderConfig(product, directory, env = process.env) {
  const paths = resolveDesktopTargetBuildPaths(env)
  const platform = env.DSH_DESKTOP_TARGET_PLATFORM ?? process.platform
  const arch = env.DSH_DESKTOP_TARGET_ARCH ?? process.arch
  const runtimeVersion = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version
  const assertRuntime = async () => { const { verifyDesktopRuntime } = await import('../lib/types/runtime-tree.js'); await verifyDesktopRuntime(paths.dsh, runtimeVersion, { platform, arch }) }
  return {
    appId: product.applicationId, productName: product.displayName,
    protocols: [{ name: product.displayName, schemes: [product.protocolScheme] }],
    artifactName: `${product.id}-\${version}-\${os}-\${arch}-unsigned.\${ext}`,
    extraMetadata: { version: product.version, dshDesktopAppId: product.applicationId, actveroBuildProduct: product },
    directories: { output: join(directory, 'artifacts', `${platform}-${arch}`) },
    asar: true, electronDist: paths.electron, electronFuses: { runAsNode: true },
    files: ['lib/main.js', 'lib/actvero-build-product.json', 'lib/welcome/**/*', 'lib/preload-*.cjs', 'renderer/**/*', 'package.json',
      { from: paths.dsh, to: 'dsh', filter: ['**/*'] },
      { from: join(paths.dsh, 'node_modules'), to: 'dsh/node_modules', filter: ['**/*'] }],
    asarUnpack: ['**/*.{node,dylib,dll,so,exe}', '**/*.so.*', '**/spawn-helper', '**/@vscode/ripgrep-*/bin/rg',
      '**/node_modules/@deepseek-ai/libreoffice-kit/**/*',
      `**/node_modules/@deepseek-ai/libreoffice-kit-${platform}-${arch}/**/*`],
    extraResources: [{ from: paths.runtime, to: 'runtime' }, { from: join(directory, 'icon.png'), to: 'icon.png' },
      ...(platform === 'win32' ? [{ from: join(directory, 'tray.ico'), to: 'tray.ico' }] : [])],
    beforePack: async context => {
      const bundled = JSON.parse(readFileSync(join(appRoot, 'lib/actvero-build-product.json'), 'utf8'))
      if (JSON.stringify(bundled) !== JSON.stringify(product)) throw new Error('ACTVERO package: desktop bundle does not match the selected configuration; rebuild it')
      await assertRuntime()
      // The standalone Office CLI also requires the wrapper and its complete installed dependency closure.
      const office = await officePackageDirectories(paths.dsh, { platform, arch })
      const patterns = office.map(path => `**/${relative(paths.dsh, path).split(sep).join('/')}/**/*`)
      const existing = context.packager.config.asarUnpack ?? []
      context.packager.config.asarUnpack = [...(typeof existing === 'string' ? [existing] : existing), ...patterns]
    },
    afterPack: async () => { await assertRuntime() },
    mac: { icon: join(directory, 'icon.png'), identity: null, forceCodeSigning: false, hardenedRuntime: false, notarize: false,
      extendInfo: { CFBundleLocalizations: ['en', 'zh_CN'], NSMicrophoneUsageDescription: `${product.displayName} uses your microphone for voice input.` }, target: ['dmg', 'zip'] },
    dmg: { sign: false, writeUpdateInfo: false },
    win: { icon: join(directory, 'icon.png'), forceCodeSigning: false, signAndEditExecutable: true, target: ['nsis'] },
    nsis: { oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true,
      installerIcon: join(directory, 'tray.ico'), uninstallerIcon: join(directory, 'tray.ico'), deleteAppDataOnUninstall: false },
    publish: null,
  }
}
