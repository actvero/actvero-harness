/** Local project scaffolding and TypeScript checks using the installed source toolchain. */
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { z } from 'zod'
import { generateWorkbenchSkillReference } from './actvero-workbench-skill.ts'
import { builtDeclarationPath } from './doc-typecheck-paths.ts'

function compilerOptions(directory: string, repository: string): Record<string, unknown> {
  const config = ts.readConfigFile(join(repository, 'tsconfig.base.json'), file => ts.sys.readFile(file))
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repository)
  const paths = Object.fromEntries(Object.entries(parsed.options.paths ?? {}).map(([key, values]) => [
    key, values.map(value => resolve(repository, builtDeclarationPath(value))),
  ]))
  return {
    composite: false, incremental: false, declaration: false, declarationMap: false, noEmit: true,
    types: ['node', 'client-build-environment'],
    paths: {
      ...paths,
      '@actvero/dsh-experts/workbench': [join(repository, 'packages/actvero/experts/lib/types/workbench.d.ts')],
      react: [join(repository, 'node_modules/@types/react/index.d.ts')],
      'react/*': [join(repository, 'node_modules/@types/react/*')],
      '*': [join(directory, 'node_modules/*'), join(repository, 'node_modules/*')],
    },
  }
}

/** Add portable Agent instructions and a launcher bound to a local source checkout.
 * @param directory Newly created project directory.
 * @param repository Source checkout with installed development dependencies.
 * @param template Selected blank or example template.
 */
export async function initializeWorkbenchProject(directory: string, repository: string, template: string): Promise<void> {
  const shared = join(repository, 'actvero/templates/workbench-project')
  for (const entry of await readdir(shared)) {
    await cp(join(shared, entry), join(directory, entry.replace(/\.template$/u, '')), { recursive: true, errorOnExist: true, force: false })
  }
  const manifest = z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')))
  await writeFile(join(directory, 'package.json'), JSON.stringify({ ...manifest, scripts: {
    doctor: 'node scripts/workbench.mjs doctor', typecheck: 'node scripts/workbench.mjs typecheck',
    build: 'node scripts/workbench.mjs pack', pack: 'node scripts/workbench.mjs pack',
    check: 'node scripts/workbench.mjs check',
  } }, null, 2) + '\n')
  await bindWorkbenchProject(directory, repository, template)
}

/** Refresh generated toolchain configuration and bundled development guidance without changing author files.
 * @param directory Existing development directory.
 * @param repository Source checkout supplying the compiler and current guidance.
 * @param template Initial template label; rebinding preserves the recorded label.
 */
export async function bindWorkbenchProject(directory: string, repository: string, template?: string): Promise<void> {
  const baseline = z.object({ version: z.string() }).parse(JSON.parse(await readFile(join(repository, 'actvero/upstream.lock.json'), 'utf8')))
  const binding = join(directory, '.actvero/toolchain.json')
  if (template === undefined && ts.sys.fileExists(binding)) {
    const previous = z.object({ template: z.string().optional() }).parse(JSON.parse(await readFile(binding, 'utf8')))
    template = previous.template
  }
  await mkdir(join(directory, '.actvero/skills'), { recursive: true })
  await writeFile(binding, JSON.stringify({ schemaVersion: 1, repository, runtimeVersion: baseline.version, template: template ?? 'custom' }, null, 2) + '\n')
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
    extends: join(repository, 'tsconfig.base.client.json'), compilerOptions: compilerOptions(directory, repository), include: ['src'],
  }, null, 2) + '\n')
  for (const skill of ['develop-workbench', 'workbench-frontend']) {
    await mkdir(join(directory, '.actvero/skills', skill), { recursive: true })
    await cp(join(repository, 'packages/actvero/capability-ui/assets', skill, 'SKILL.md'), join(directory, '.actvero/skills', skill, 'SKILL.md'), { recursive: true })
  }
  generateWorkbenchSkillReference(join(directory, '.actvero/skills/develop-workbench/reference'))
}

/** Check author code against declarations from the coordinated toolchain build.
 * @param directory Workbench source directory, including projects outside the checkout.
 * @param repository Source checkout supplying the baseline compiler configuration.
 */
export async function typecheckWorkbench(directory: string, repository: string): Promise<void> {
  directory = resolve(directory)
  if (!ts.sys.fileExists(join(repository, 'packages/actvero/capability-ui/lib/types/contracts.d.ts'))) {
    throw new Error('源码工具链缺少类型产物；请先在 ACTVERO 仓库运行 pnpm run build:artifacts，再执行工作台检查。')
  }
  const configPath = join(directory, 'tsconfig.json')
  const config = ts.sys.fileExists(configPath) ? ts.parseConfigFileTextToJson(configPath, await readFile(configPath, 'utf8')) : {
    config: { extends: join(repository, 'tsconfig.base.client.json'), compilerOptions: compilerOptions(directory, repository), include: ['src'] }, error: undefined,
  }
  const format = (diagnostics: readonly ts.Diagnostic[]) => ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: path => path, getCurrentDirectory: () => directory, getNewLine: () => '\n',
  })
  if (config.error) throw new Error(format([config.error]))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, directory,
    { noEmit: true, composite: false, incremental: false }, configPath)
  if (parsed.errors.length) throw new Error(format(parsed.errors))
  // Require both entrypoints even when a project narrows its include patterns.
  const files = [...new Set([...parsed.fileNames, join(directory, 'src/index.ts'), join(directory, 'src/client/index.ts')])]
  const program = ts.createProgram(files, parsed.options)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length) throw new Error(format(diagnostics))
}
