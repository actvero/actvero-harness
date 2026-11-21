/** Command metadata used to validate invocation and render the npm kit's offline reference. */
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { localCapabilityCommand } from '../packages/actvero/capability-ui/src/workbench-local-protocol.ts'
import { expertCliInputs, expertCliOutputs } from './actvero-expert-cli-schema.ts'
import { cliFailureSchema, WorkbenchCliError } from './actvero-workbench-cli-result.ts'

type Effect = 'read' | 'local_files' | 'harness_write' | 'connection_test'
type Flag = { type: 'string' | 'boolean'; required?: boolean; description: string; choices?: readonly string[] }
interface Entry {
  summary: string
  effect: Effect
  args?: readonly string[]
  flags?: Readonly<Record<string, Flag>>
  input?: z.ZodType
  output: z.ZodType
  example: { arguments: string[]; body?: object }
  success: string
  recovery?: string
}

const path = z.string()
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u)
const localId = 'local-737533df-d1a0-4144-870d-e217b3ed6e50'
const exampleToken = 'd60a2df1-d40e-4f21-9a35-573c3c85f6d7'
const expertId = '804b6c0e-9a25-4f8d-8423-435a45590a73'
const project = './my-workbench'
const connection = { type: 'string', required: true, description: '目标 Harness 导出的私有开发连接文件。' } as const
const requestFile = { type: 'string', description: 'UTF-8 JSON 请求文件。字段定义及示例见 schema show。' } as const
const fileArgs = ['--connection', './connection.json', '--file', './request.json']
const readArgs = ['--connection', './connection.json']
const checked = { name: z.string(), bytes: z.number().int().nonnegative(), sha256 }
/** Installed version and whether its Client graph is currently published. */
export const workbenchStatusSchema = z.strictObject({
  name: z.string(), installedVersion: z.string().nullable(), clientPublished: z.boolean(), pendingRestart: z.boolean(),
})
const skillState = { id: z.string(), name: z.string(), version: z.string(), enabled: z.boolean() }
const skillSummary = z.looseObject({ ...skillState, description: z.string() })
const enabling = z.looseObject({ id: z.string(), enabled: z.boolean() })
const mcpSummary = z.looseObject({
  ...enabling.shape, name: z.string(), transport: z.enum(['stdio', 'http', 'sse']), auth: z.enum(['none', 'bearer', 'headers', 'oauth']),
  command: z.string(), argumentCount: z.number().int().nonnegative(), endpointOrigin: z.string(),
  status: z.enum(['disabled', 'connecting', 'connected', 'authorization_required', 'error']), error: z.string().optional(), revision: z.string(),
})
const localInputs = new Map<string, z.ZodType>(localCapabilityCommand.options.map((option) => {
  const { operation, ...fields } = option.shape
  return [operation.value.replace('-', '.'), z.strictObject(fields)]
}))

function remote(name: string, summary: string, effect: Effect, output: z.ZodType, success: string,
  body?: object, recovery?: string): Entry {
  const action = name.slice('expert.'.length)
  const input = localInputs.get(name) ?? expertCliInputs[action as keyof typeof expertCliInputs]
  if (!input) throw new Error('Missing command schema: ' + name)
  const install = name === 'skill.install'
  const args = install ? ['[source]'] : undefined
  const flags = { connection, file: { ...requestFile, required: !install && !input.safeParse({}).success } }
  return {
    summary, effect, ...(args ? { args } : {}), flags, input, output, success,
    example: { arguments: body ? fileArgs : install ? ['./skill.zip', ...readArgs] : readArgs, ...(body ? { body } : {}) },
    ...(recovery ? { recovery } : {}),
  }
}

const skillRetry = '用 skill list 或 skill show 核对本机安装状态。编辑冲突时，从 show 重新读取版本，再读取文件并核对内容。'
const mcpRetry = '用 mcp list 或 mcp show 核对本机配置。更新冲突时，重新读取 revision 并核对要修改的字段。'
const expertRetry = '用 expert author-list 或 expert author-get 核对保存结果。修改前读取当前 revision。'
const developmentRetry = '用 status <包名> --connection <连接文件> 核对已安装版本和发布状态。连接失效时，从目标 Harness 重新导出连接文件。'

/** Public CLI commands, including the request and result validators used by the launcher. */
export const workbenchCommands: Readonly<Record<string, Entry>> = {
  create: {
    summary: '创建工作台源码项目。', effect: 'local_files', args: ['directory', '[packageName]'],
    flags: { template: { type: 'string', choices: ['blank', 'plain', 'ai'], description: '默认 blank。plain 和 ai 提供示例。' } },
    output: z.strictObject({ directory: path }), example: { arguments: [project, '@local/my-workbench'] },
    success: '目标目录包含可编辑模板；开发前先读项目 AGENTS.md 和 DESIGN.md。',
  },
  bind: {
    summary: '更新项目的工具链绑定、类型配置和开发说明。', effect: 'local_files', args: ['directory'],
    output: z.strictObject({ directory: path }), example: { arguments: [project] }, success: '项目可使用本套件的工具链。',
  },
  doctor: {
    summary: '检查工作台元数据、入口文件和基线兼容性。', effect: 'read', args: ['directory'],
    output: z.looseObject({ name: z.string(), baseline: z.string(), warnings: z.array(z.string()) }),
    example: { arguments: [project] }, success: '结构检查通过，warnings 保留待处理事项。',
  },
  typecheck: {
    summary: '用套件的声明检查项目的 TypeScript。', effect: 'read', args: ['directory'],
    output: z.strictObject({ checked: z.literal(true) }), example: { arguments: [project] }, success: '类型检查通过。',
  },
  pack: {
    summary: '构建并生成工作台 .tgz，默认写入项目 dist。', effect: 'local_files', args: ['directory', '[outputDirectory]'],
    output: z.looseObject({ ...checked, path }), example: { arguments: [project] }, success: 'path 指向已验包的本地归档。',
  },
  check: {
    summary: '检查工作台 .tgz 是否满足导入预检。', effect: 'read', args: ['archive'],
    output: z.looseObject(checked), example: { arguments: [project + '/dist/local-my-workbench-1.0.0.tgz'] },
    success: '归档通过预检。实际加载结果由目标 Harness 决定。',
  },
  update: {
    summary: '构建并安装或更新目标 Harness 的工作台，完成后退出。', effect: 'harness_write',
    args: ['directory'], flags: { connection },
    output: z.strictObject({ name: z.string(), version: z.string(), previousVersion: z.string().nullable(), sha256,
      application: z.literal('applied'), runtime: z.literal('loaded'), client: z.literal('published') }),
    example: { arguments: [project, ...readArgs] }, recovery: developmentRetry,
    success: '首次调用安装，已有同名包时要求项目版本更高。成功表示新版已安装、宿主已加载且前端已发布。',
  },
  status: {
    summary: '查询目标 Harness 的工作台已安装版本及当前发布状态。', effect: 'read',
    args: ['packageName'], flags: { connection }, output: workbenchStatusSchema,
    example: { arguments: ['@local/my-workbench', ...readArgs] }, success: 'installedVersion 为 null 表示未安装。',
  },
  info: {
    summary: '查看套件版本、工具链目录、平台和 API 兼容版本。', effect: 'local_files',
    output: z.looseObject({ name: z.string(), version: z.string(), directory: path, skills: path, platform: z.string(), arch: z.string(),
      runtimeVersion: z.string(), hostApiVersion: z.string(), sha256, schemaVersion: z.literal(1) }),
    example: { arguments: [] }, success: '返回已校验的套件目录。首次调用可能解压工具链缓存。',
  },
  version: {
    summary: '查看已安装 CLI 版本。', effect: 'read', output: z.strictObject({ version: z.string() }),
    example: { arguments: [] }, success: '返回已安装的套件版本。',
  },
  'skills.install': {
    summary: '复制随套件交付的 Skill 到其他 Agent 的技能目录。', effect: 'local_files', args: ['[directory]'],
    flags: { global: { type: 'boolean', description: '写入 ~/.agents/skills。与 directory 互斥。' } },
    output: z.strictObject({ installed: z.array(path) }), example: { arguments: ['--global'] },
    success: '返回已复制的路径。省略目标时写入当前项目 .agents/skills。已有同名目录时拒绝覆盖。',
  },
  'skills.update': {
    summary: '更新本套件安装且未被用户修改的开发 Skill。', effect: 'local_files', args: ['[directory]'],
    flags: { global: { type: 'boolean', description: '更新 ~/.agents/skills。与 directory 互斥。' } },
    output: z.strictObject({ installed: z.array(path) }), example: { arguments: ['--global'] },
    success: '返回处理的路径。已有用户修改时保留原副本。',
  },
  'skill.list': remote('skill.list', '列出目标 Harness 安装的本机 Skill。', 'read', z.array(skillSummary), '从列表读取精确 id。'),
  'skill.show': remote('skill.show', '查看一个已安装 Skill 的版本和文件清单。', 'read',
    skillSummary.extend({ entrypoint: path, files: z.array(z.looseObject({ path, size: z.number(), sha256, previewable: z.boolean() })) }),
    '使用 result.version 的完整值更新，文件路径从 result.files 取得。', { id: localId }),
  'skill.read': remote('skill.read', '读取一个已安装 Skill 的包内 UTF-8 文本。', 'read',
    z.looseObject({ path, content: z.string() }), '先 show 取得版本，再读取包内文件。更新使用刚才查询到的版本 ID。',
    { id: localId, path: 'SKILL.md' }),
  'skill.install': remote('skill.install', '从本机目录、ZIP 或 SKILL.md 安装到目标 Harness。', 'harness_write',
    z.looseObject(skillState), '返回安装 ID、版本 ID 和启用状态。JSON 请求中的 path 使用绝对路径。使用 source 或 --file 其中之一。',
    undefined, skillRetry),
  'skill.update': remote('skill.update', '从绝对路径导入同名新包并保留旧版本。', 'harness_write',
    z.looseObject(skillState), '用 skill show 取得 id 和 version。成功后返回原 id 和新版本 ID。',
    { id: localId, version: exampleToken, path: '/absolute/path/skill.zip' }, skillRetry),
  'skill.edit': remote('skill.edit', '替换一个已安装 Skill 文本文件的完整内容。', 'harness_write',
    z.looseObject(skillState), 'path 使用包内相对路径，content 使用完整文件内容。其他文件和旧版本保留。',
    { id: localId, version: exampleToken, path: 'SKILL.md', content: '---\nname: decision-notes\ndescription: Write decision notes\n---\nRecord the decision and its owner.\n' }, skillRetry),
  'skill.enable': remote('skill.enable', '保存本机 Skill 启停状态。', 'harness_write', enabling, '返回已保存的 enabled。',
    { id: localId, enabled: true }, skillRetry),
  'mcp.list': remote('mcp.list', '列出目标 Harness 的本机自定义连接。', 'read', z.array(mcpSummary), '用精确 id 读取配置摘要。'),
  'mcp.show': remote('mcp.show', '读取 MCP 配置摘要、运行状态和编辑修订号。', 'read', mcpSummary,
    '用 revision 更新。摘要提供参数数量和 URL 的来源地址，完整参数与凭据在连接器页面查看。', { id: localId }),
  'mcp.create': remote('mcp.create', '保存本机 MCP 配置，默认停用。', 'harness_write', mcpSummary,
    'HTTP/SSE 填 url，stdio 填 command。凭据通过桌面端输入。保存后用 mcp test 验证连接。',
    { config: { name: '文档服务', transport: 'http', url: 'https://example.org/mcp' } }, mcpRetry),
  'mcp.update': remote('mcp.update', '按当前 revision 修改配置，已启用的连接会尝试重连。', 'harness_write', mcpSummary,
    '仅传目标传输方式的变更字段。args 整组替换，省略字段保留。带凭据的连接改地址或程序时使用桌面端。查看 status 判断重连结果。',
    { id: localId, revision: exampleToken, patch: { name: '新显示名称' } }, mcpRetry),
  'mcp.test': remote('mcp.test', '建立临时连接测试已保存的配置，完成后关闭连接。', 'connection_test',
    z.strictObject({ connected: z.literal(true) }), 'connected=true 表示测试通过；保存的 enabled 状态独立于测试。',
    { id: localId }, mcpRetry),
  'mcp.enable': remote('mcp.enable', '保存启停状态，启用时尝试连接。', 'harness_write', mcpSummary,
    'enabled 表示已保存的开关。status=connected 才表示可用，status=error 或 authorization_required 时查看诊断。',
    { id: localId, enabled: true }, mcpRetry),
  'expert.catalog': remote('expert.catalog', '查询可以绑定给本机专家的依赖。', 'read', expertCliOutputs.catalog,
    '用返回的精确 id 建立绑定，并关注 ready。'),
  'expert.author-list': remote('expert.author-list', '按名称、描述或 ID 搜索本机专家。', 'read', expertCliOutputs['author-list'],
    '默认第一页，每页 50 条。返回 items 和 total。', { query: '决策', page: 1 }),
  'expert.author-get': remote('expert.author-get', '读取本机专家与当前修订号。', 'read', expertCliOutputs['author-get'],
    '用 revision 提交修改。hasAvatar 表示已有头像。', { id: expertId }),
  'expert.create': remote('expert.create', '根据已确认的职责、指令和依赖创建本机专家。', 'harness_write', expertCliOutputs.create,
    '返回保存结果。专家 ID 与修订号由 Harness 分配。保存后用 author-check 检查依赖。',
    { expert: { manifest: { schemaVersion: 1, version: '1.0.0', name: '决策记录专家', description: '整理项目决策。',
      instructions: '记录背景、结论、负责人和截止日期。' }, bindings: { skills: {}, connectors: {} } } }, expertRetry),
  'expert.author-update': remote('expert.author-update', '按当前修订号修改本机专家。', 'harness_write', expertCliOutputs['author-update'],
    '省略字段保留。提交的数组和每个 bindings 子映射整体替换。用 author-get 回读新修订号。',
    { id: expertId, revision: 1, patch: { manifest: { instructions: '记录决策、负责人和截止日期。' } } }, expertRetry),
  'expert.author-check': remote('expert.author-check', '检查本机专家的依赖是否就绪。', 'read', expertCliOutputs['author-check'],
    'ready 表示依赖已就绪，warnings 和 missing 提供诊断。用真实任务试跑验证专家质量。', { id: expertId }),
}

function lookup(name: string): Entry | undefined {
  return Object.hasOwn(workbenchCommands, name) ? workbenchCommands[name] : undefined
}

function invocation(name: string): string[] {
  return name === 'version' ? ['--version'] : name.split('.')
}

function usage(name: string, entry: Entry): string {
  const args = entry.args?.map(arg => arg.startsWith('[') ? arg : `<${arg}>`) ?? []
  const flags = Object.entries(entry.flags ?? {}).map(([key, flag]) => {
    const part = flag.type === 'string' ? `--${key} <${flag.choices?.join('|') ?? key}>` : `--${key}`
    return flag.required ? part : `[${part}]`
  })
  return ['actvero-workbench', ...invocation(name), ...args, ...flags, '[--json]'].join(' ')
}

/** Resolve the public command name before parsing command-specific flags.
 * @param args Arguments without the Node executable or script path.
 * @returns The dotted catalog name, or an empty name when no command was provided.
 */
export function cliCommandName(args: readonly string[]): string {
  const [group = '', action] = args.filter(arg => arg !== '--json')
  if (group === '--version') return 'version'
  if (['skill', 'mcp', 'expert', 'skills'].includes(group) && action && !action.startsWith('-')) return group + '.' + action
  return group
}

/** Parse a command's exact positionals and flags from the same metadata as its help.
 * @param args Arguments after the executable.
 * @returns Command catalog entry, parsed arguments and machine-output selection.
 */
export function parseWorkbenchInvocation(args: string[]) {
  const name = cliCommandName(args)
  const entry = lookup(name)
  if (!entry) throw new WorkbenchCliError('unknown_command', `未知命令 ${name}。`, 'not_applied', '运行 actvero-workbench --help。')
  const machine = args.includes('--json')
  const rest = args.filter(arg => arg !== '--json').slice(invocation(name).length)
  let parsed
  try {
    parsed = parseArgs({ args: rest, allowPositionals: true,
      options: Object.fromEntries(Object.entries(entry.flags ?? {}).map(([key, flag]) => [key, { type: flag.type }])), tokens: true })
  } catch (error) {
    throw new WorkbenchCliError('invalid_arguments', error instanceof Error ? error.message : String(error), 'not_applied', usage(name, entry))
  }
  const { positionals, values, tokens } = parsed
  const flags = tokens.flatMap(token => token.kind === 'option' ? [token.name] : [])
  const argumentNames = entry.args ?? []
  const requiredCount = argumentNames.filter(arg => !arg.startsWith('[')).length
  const invalidFlags = Object.entries(entry.flags ?? {}).some(([key, flag]) => {
    const value = values[key]
    return (flag.required && (typeof value !== 'string' || !value)) || (typeof value === 'string' && flag.choices && !flag.choices.includes(value))
  })
  const conflicting = (name.startsWith('skills.') && values.global && positionals.length)
    || (name === 'skill.install' && Number(!!positionals[0]) + Number(!!values.file) !== 1)
  if (positionals.length < requiredCount || positionals.length > argumentNames.length || positionals.some(arg => !arg)
    || invalidFlags || new Set(flags).size !== flags.length || conflicting) {
    throw new WorkbenchCliError('invalid_arguments', `参数不符合 ${name} 的用法。`, 'not_applied', usage(name, entry))
  }
  return { name, entry, machine, positionals, values }
}

/** Render offline help, response contracts, and runnable request examples.
 * @param args CLI arguments, including dotted or spaced command names for help and schema lookups.
 * @returns Text for an informational command, or undefined for an executable command.
 */
export function workbenchGuide(args: readonly string[]): string | undefined {
  const filtered = args.filter(arg => arg !== '--json')
  const [first, second, ...rest] = filtered
  if (first === 'schema' && second === 'list' && !rest.length) {
    return JSON.stringify({ schemaVersion: 1, commands: Object.entries(workbenchCommands).map(([name, entry]) =>
      ({ name, summary: entry.summary, effect: entry.effect })), failure: z.toJSONSchema(cliFailureSchema) }, null, 2)
  }
  if (first === 'expert' && second === 'schema' && !rest.length) {
    return JSON.stringify(Object.entries(workbenchCommands).filter(([name]) => name.startsWith('expert.'))
      .map(([name, entry]) => describe(name, entry)), null, 2)
  }
  if ((first === 'schema' || first === 'example') && second === 'show') {
    const name = rest.join('.')
    const entry = lookup(name)
    if (!entry) throw new WorkbenchCliError('unknown_command', `未知命令 ${name}。`, 'not_applied', '运行 actvero-workbench schema list。')
    if (first === 'schema') return JSON.stringify(describe(name, entry), null, 2)
    return JSON.stringify(entry.example.body ?? { command: ['actvero-workbench', ...invocation(name), ...entry.example.arguments, '--json'] }, null, 2)
  }
  if (first === 'schema' || first === 'example') {
    throw new WorkbenchCliError('invalid_arguments', '使用 schema list、schema show <命令> 或 example show <命令>。', 'not_applied')
  }
  const groupHelp = second === 'help' && !rest.length
  if (first && first !== 'help' && !groupHelp && !filtered.includes('--help') && !filtered.includes('-h')) return undefined
  const target = filtered.filter(arg => !['help', '-h', '--help'].includes(arg)).join('.')
  const exact = lookup(target)
  const rows = exact ? [[target, exact] as const]
    : Object.entries(workbenchCommands).filter(([name]) => !target || name.startsWith(target + '.'))
  if (!rows.length) throw new WorkbenchCliError('unknown_command', `未知命令 ${target}。`, 'not_applied', '运行 actvero-workbench --help。')
  const lines = rows.map(([name, entry]) => `${usage(name, entry)}\n  ${entry.summary}`)
  if (exact) lines.push(exact.success, ...(exact.recovery ? [exact.recovery] : []),
    '参数与返回字段  actvero-workbench schema show ' + target, '示例  actvero-workbench example show ' + target)
  else lines.push('机器可读命令  actvero-workbench schema list', '完整参数  actvero-workbench schema show <命令>',
    '请求示例  actvero-workbench example show <命令>')
  return lines.join('\n\n')
}

function describe(name: string, entry: Entry) {
  const example = { command: ['actvero-workbench', ...invocation(name), ...entry.example.arguments, '--json'],
    ...(entry.example.body ? { requestFile: './request.json', body: entry.example.body } : {}) }
  return {
    schemaVersion: 1, command: name, summary: entry.summary, usage: usage(name, entry), effect: entry.effect,
    positionals: (entry.args ?? []).map(arg => ({ name: arg.replace(/^\[|\]$/gu, ''), required: !arg.startsWith('[') })),
    flags: { ...entry.flags,
      json: { type: 'boolean', description: '输出带 schemaVersion 的单行 JSON。' } },
    ...(entry.input ? { input: z.toJSONSchema(entry.input, { io: 'input' }) } : {}),
    output: z.toJSONSchema(entry.output), success: entry.success, recovery: entry.recovery,
    outputMode: 'result', example,
  }
}
