/** Build one native Actvero product through its configured packaging mode. */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Build failures leave remote release state untouched; inspect native logs before retrying. */
export class ClientBuildError extends Error {
  code = 'client-build-failed'
}

/**
 * Resolve an explicit native target before starting a package build.
 * @param {string} input Target name or native platform alias.
 * @param {NodeJS.Platform} platform Build host platform.
 * @param {string} arch Build host Node architecture.
 * @returns {'win-x64' | 'win-arm64' | 'mac-arm64' | 'mac-x64'} Native build target.
 */
export function resolveClientBuildTarget(input, platform = process.platform, arch = process.arch) {
  const target = input === 'mac' ? `mac-${arch}` : input === 'win' ? `win-${arch}` : input
  if (!['win-x64', 'win-arm64', 'mac-arm64', 'mac-x64'].includes(target)) throw new ClientBuildError('client build: choose win-x64, win-arm64, mac-arm64 or mac-x64')
  if ((target.startsWith('win-') && (platform !== 'win32' || arch !== target.slice(4))) || (target.startsWith('mac-') && platform !== 'darwin')) throw new ClientBuildError('client build: run Windows builds on a Windows host with matching Node architecture, and Mac builds on a Mac host')
  return target
}

/**
 * Delegate product, output and update validation to the Actvero packager.
 * @param {string[]} args Target followed by Actvero package options.
 * @param {NodeJS.Platform} platform Build host platform.
 * @param {string} arch Build host Node architecture.
 * @returns {string[]} pnpm arguments; no update settings are synthesized.
 */
export function clientBuildArguments(args, platform = process.platform, arch = process.arch) {
  const [input, ...options] = args.filter(value => value !== '--')
  const target = resolveClientBuildTarget(input, platform, arch)
  if (options.some(value => value === '--target' || value.startsWith('--target='))) {
    throw new ClientBuildError('client build: select the target once, before package options')
  }
  return ['run', 'actvero:package', '--target', target, ...options.map(value =>
    value === '--minimum-os' ? '--min-system' : value.startsWith('--minimum-os=') ? value.replace('--minimum-os=', '--min-system=') : value)]
}

async function build(args) {
  const pnpm = process.env.npm_execpath
  if (!pnpm) throw new ClientBuildError('client build: launch with pnpm client:build <target>')
  const command = clientBuildArguments(args)
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [pnpm, ...command], { cwd: resolve(import.meta.dirname, '../../..'), stdio: 'inherit', env: process.env })
    const interrupt = () => { child.kill('SIGINT') }
    const terminate = () => { child.kill('SIGTERM') }
    const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate) }
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate)
    child.once('error', () => { cleanup(); reject(new ClientBuildError('client build: cannot start the Actvero packager')) })
    child.once('close', code => { cleanup(); code === 0 ? done() : reject(new ClientBuildError('client build: Actvero packaging failed; inspect its report before retrying')) })
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await build(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: { code: 'client-build-failed', message: error instanceof ClientBuildError ? error.message : 'client build failed; inspect the native build report and configuration before retrying' } }) + '\n')
    process.exitCode = 1
  }
}
