#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual, parseArgs } from 'node:util'

const usage = `用法：node scripts/check-import.mjs <专家.zip|专家.json> [--desktop <Harness可执行文件> | --workspace <已构建的Harness仓库>]
macOS 默认使用 /Applications/Actvero Harness.app。也可用目标 Harness 的 executable 加 --expose-internals，在 ELECTRON_RUN_AS_NODE=1 下直接运行本脚本。
退出码 0 已隔离导入并回读，1 导入器拒绝输入，2 预览需目标环境的依赖，3 脚本、文件或运行环境错误。
dependencies 是隔离环境的运行依赖检查，单独于导入结果。`

const resultCodes = { imported: 0, rejected: 1, blocked: 2, error: 3 }
const report = { status: 'error', stage: 'arguments', isolation: 'temporary' }
const unavailable = () => { throw new Error('isolated_operation_unavailable') }
const noPlatform = async () => false

function loadImporters(manifestPath) {
  const load = createRequire(manifestPath)
  return {
    ...load('@actvero/dsh-experts/main'),
    ...load('@actvero/dsh-skills/local'),
    ...load('@actvero/dsh-connectors/local-mcp'),
    ...load('@actvero/dsh-experts/schema'),
  }
}

// 使用桌面导入器的本机存储实现，MCP 模板停用，平台不提供账号。
function createStores({ LocalSkills, LocalConnectors, Experts, ExpertPackages }, directory) {
  const skills = new LocalSkills({ root: join(directory, 'skills'), changed() {}, async syncHost() {} })
  let records = []
  const connectors = new LocalConnectors({
    load: async () => records,
    save: async value => { records = structuredClone(value) },
    openExternal: unavailable,
  }, () => {})
  const experts = new Experts({
    root: join(directory, 'experts'), scope: () => 'local', skills, changed() {},
    connectors: async () => (await connectors.list()).map(({ id, name }) => ({ id, name, description: '', ready: false })),
  })
  const packages = new ExpertPackages(experts, {
    platform: () => undefined, scope: () => undefined,
    unpack: bytes => skills.unpack(bytes), pack: files => skills.pack(files),
    skills: {
      state: async () => ({ items: await skills.state() }),
      preview: (files, name) => skills.previewFiles(files, name),
      discard: token => skills.discard(token),
      install: (token, replace) => skills.install(token, replace),
      restore: (id, expected, version) => skills.restoreVersion(id, expected, version),
      remove: id => skills.uninstall(id), files: id => skills.exportFiles(id), authorized: noPlatform,
    },
    connectors: {
      list: () => connectors.list(), template: input => connectors.template(input),
      portable: id => connectors.portable(id), save: input => connectors.saveDisabled(input),
      remove: id => connectors.remove(id), authorized: noPlatform, fingerprint: unavailable,
    },
  })
  return { experts, packages, connectors }
}

async function readInput(file, format) {
  const handle = await open(file, 'r')
  try {
    const limit = format === 'zip' ? 20 * 1024 * 1024 : 650_000
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('expected_regular_file')
    if (stat.size > limit) throw new Error('desktop_file_too_large')
    const bytes = await handle.readFile()
    if (bytes.length > limit) throw new Error('desktop_file_too_large')
    return bytes
  } finally {
    await handle.close()
  }
}

async function importAndReadback(runtime, bytes, directory) {
  const { experts, packages, connectors } = createStores(runtime, directory)
  try {
    let expert
    if (report.format === 'zip') {
      report.stage = 'preview'
      const plan = await packages.preview(bytes)
      report.preview = {
        name: plan.name, version: plan.version, canImport: plan.canImport, operation: plan.operation,
        rows: plan.rows.map(({ kind, key, required, status }) => ({ kind, key, required, status })),
      }
      if (!plan.canImport) {
        packages.discard(plan.token)
        report.status = 'blocked'
        return
      }
      report.stage = 'import'
      expert = await packages.import(plan.token)
    } else {
      report.stage = 'manifest'
      const manifest = runtime.parseManifest(JSON.parse(bytes.toString('utf8')))
      report.stage = 'import'
      expert = await experts.dispatch('import', { manifest, bindings: { skills: {}, connectors: {} } })
    }
    report.stage = 'readback'
    const stored = await experts.get(expert.manifest.id)
    if (!isDeepStrictEqual(stored, expert)) throw new Error('import_readback_mismatch')
    report.expert = { name: stored.manifest.name, version: stored.manifest.version, revision: stored.revision, hasAvatar: Boolean(stored.manifest.avatar) }
    report.stage = 'dependencies'
    report.dependencies = await experts.inspect(stored.manifest.id)
    report.status = 'imported'
  } finally {
    await connectors.dispose()
  }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, desktop: { type: 'string' }, workspace: { type: 'string' },
  } })
  if (values.help) { console.log(usage); return }
  if (positionals.length !== 1 || (values.desktop && values.workspace)) throw new Error(usage)
  const file = resolve(positionals[0])
  const format = extname(file).slice(1).toLowerCase()
  if (!['json', 'zip'].includes(format)) throw new Error(usage)
  report.format = format
  report.stage = 'runtime'
  if (!values.workspace && (!process.versions.electron || values.desktop)) {
    const executable = values.desktop ?? (process.platform === 'darwin'
      ? '/Applications/Actvero Harness.app/Contents/MacOS/Actvero Harness' : undefined)
    if (!executable) throw new Error('请用 --desktop 指定目标 Harness 可执行文件。')
    const child = spawnSync(executable, ['--expose-internals', fileURLToPath(import.meta.url), '--', file], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
    })
    if (child.error) throw child.error
    if (child.status === null) throw new Error('desktop_process_interrupted')
    process.exitCode = child.status
    return
  }
  const manifestPath = values.workspace
    ? resolve(values.workspace, 'apps', 'desktop', 'package.json')
    : join(process.resourcesPath, 'app.asar', 'package.json')
  const info = JSON.parse(await readFile(manifestPath, 'utf8'))
  report.runtime = { source: values.workspace ? 'workspace' : 'desktop', package: info.name, version: info.version }
  const runtime = loadImporters(manifestPath)
  report.stage = 'file'
  const bytes = await readInput(file, format)
  const directory = await mkdtemp(join(tmpdir(), 'check-expert-import-'))
  try {
    await importAndReadback(runtime, bytes, directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  output()
}

function output() {
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = resultCodes[report.status]
}

try {
  await main()
} catch (error) {
  const code = error.code ?? error.message
  const invalid = error instanceof SyntaxError && report.stage === 'manifest'
    || code === 'desktop_file_too_large'
    || (['preview', 'manifest', 'import'].includes(report.stage) && typeof code === 'string' && /^[a-z][a-z_]+$/.test(code))
  report.status = invalid ? 'rejected' : 'error'
  report.error = error instanceof SyntaxError && report.stage === 'manifest' ? 'invalid_json' : code
  output()
}
