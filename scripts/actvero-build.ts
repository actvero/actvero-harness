/** Build or package an ACTVERO variant through the official runtime preparation stages. */
import { spawn } from 'node:child_process'
import { assertActveroBaseline } from './actvero-baseline.ts'
import { join, resolve } from 'node:path'
import { prepareProductBranding } from '../apps/desktop/scripts/actvero-branding.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'
import { packageTarget, desktopElectronBuilderEnvironment } from '../apps/desktop/scripts/package-target.ts'
import { requireDesktopToolchain } from '../apps/desktop/scripts/desktop-toolchain-preflight.ts'
import { assertActveroOutputAvailable, exportActveroRelease, prepareActveroBuildConfiguration, resolveActveroBuildRequest } from './actvero-package.ts'

/**
 * Run one package command without a shell; forward interruption until the child exits.
 * @param args - pnpm arguments.
 * @param environment - Build environment.
 * @param cwd - Command directory.
 * @returns Resolves only after a successful child exit.
 */
async function run(args: readonly string[], environment: NodeJS.ProcessEnv, cwd: string): Promise<void> {
  const command = pnpmInvocation(args, environment)
  await new Promise<void>((done, reject) => {
    const child = spawn(command.command, command.args, { cwd, env: environment, stdio: 'inherit' })
    const interrupt = () => { child.kill('SIGINT') }
    const terminate = () => { child.kill('SIGTERM') }
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate)
      if (code === 0) done()
      else reject(new Error(`ACTVERO build: command failed (${String(code ?? signal)})`))
    })
  })
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '..')
  const request = resolveActveroBuildRequest(root, process.argv.slice(2))
  const { target } = request
  if (request.output) assertActveroOutputAvailable(request.output)
  const configPath = prepareActveroBuildConfiguration(root, request)
  const branding = await prepareProductBranding(root, configPath)
  assertActveroBaseline(root, branding.assembly.upstream)
  const { config } = branding.assembly
  console.log(`ACTVERO build: ${config.product.displayName} ${config.product.version}; ${config.product.applicationId}`)
  console.log(`ACTVERO build: icon=${request.config.branding.icon}; logo=${request.config.branding.logo ?? request.config.branding.icon}; tray=${request.config.branding.trayIcon ?? request.config.branding.icon}`)
  console.log(`ACTVERO build: platform=${config.platform.defaultUrl}`)
  if (target) {
    console.log(`ACTVERO package: target=${target.name}; format=${request.directory ? 'directory' : request.formats.join(',')}; output=${request.output ?? 'internal build directory'}`)
    await requireDesktopToolchain(target.platform)
  }
  if (request.check) return
  const environment = { ...process.env, ACTVERO_PRODUCT_CONFIG: configPath,
    ACTVERO_DESKTOP: '1', ACTVERO_LOCAL_UNSIGNED: '1', ACTVERO_BRANDING_DIRECTORY: branding.directory,
    DSH_DESKTOP_APP_ID: config.product.applicationId, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  if (!target) {
    await run(['run', 'build:official'], environment, root)
    return
  }
  const targetEnvironment = desktopElectronBuilderEnvironment({ ...environment,
    DSH_DESKTOP_TARGET_PLATFORM: target.platform, DSH_DESKTOP_TARGET_ARCH: target.arch }, true)
  if (!request.skipPrepare) {
    await packageTarget({ target, directory: true, prepareOnly: true, unsigned: false, check: false, requestedBuildVersion: undefined },
      targetEnvironment, undefined)
  }
  else await run(['--dir', 'apps/desktop', 'run', 'bundle'], targetEnvironment, root)
  await run(['exec', 'electron-builder', '--config', 'actvero.electron-builder.config.mjs',
    target.builderPlatform, ...request.formats.map(format => format === 'exe' ? 'nsis' : format),
    target.builderArch, '--publish', 'never', ...(request.directory ? ['--dir'] : [])],
  targetEnvironment, join(root, 'apps/desktop'))
  await run(['exec', 'tsx', 'scripts/actvero-smoke.ts'], targetEnvironment, root)
  const artifacts = join(branding.directory, 'artifacts', `${target.platform}-${target.arch}`)
  if (request.directory) console.log(`ACTVERO package: unpacked application at ${artifacts}`)
  else {
    const manifest = await exportActveroRelease(request, artifacts)
    console.log(`ACTVERO package: installers and release.json at ${request.output}`)
    for (const artifact of manifest.artifacts) console.log(`ACTVERO package: ${artifact.file_name}; ${artifact.file_size} bytes; SHA256 ${artifact.sha256}`)
  }
}
if (import.meta.main) await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
