/** Run this project's commands with its explicitly bound ACTVERO source toolchain. */
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const [command, argument, ...extra] = process.argv.slice(2)
  if (!['doctor', 'typecheck', 'pack', 'check', 'bind'].includes(command) || extra.length || (argument && !['check', 'bind'].includes(command))) {
    throw new Error('用法：node scripts/workbench.mjs doctor|typecheck|pack|check [包路径]，或 bind <ACTVERO 源码目录>。')
  }
  let repository
  if (command === 'bind') {
    if (!argument) throw new Error('请提供已安装依赖的 ACTVERO 源码目录。')
    repository = resolve(argument)
  } else {
    const path = join(project, '.actvero/toolchain.json')
    let binding
    try { binding = JSON.parse(await readFile(path, 'utf8')) } catch (error) {
      throw new Error(`无法读取本机工具链绑定；请运行 node scripts/workbench.mjs bind <ACTVERO 源码目录>。${error.message}`)
    }
    if (binding.schemaVersion !== 1 || typeof binding.repository !== 'string' || !isAbsolute(binding.repository)) {
      throw new Error('本机工具链绑定无效；请重新运行 bind。')
    }
    repository = binding.repository
  }
  const launcher = join(repository, 'node_modules/tsx/dist/cli.mjs')
  const entry = join(repository, 'scripts/actvero-workbench.client.ts')
  try { await Promise.all([stat(launcher), stat(entry)]) } catch (error) {
    throw new Error(`找不到已绑定的源码工具链或其依赖；请在源码仓库安装锁定依赖，目录移动后重新 bind。${error.message}`)
  }
  let args = [command, project]
  if (command === 'pack') args.push(join(project, 'dist'))
  if (command === 'check') {
    let archive = argument && resolve(argument)
    if (!archive) {
      const output = join(project, 'dist')
      let files
      try { files = (await readdir(output)).filter(file => file.endsWith('.tgz')) } catch (error) {
        throw new Error(`未找到构建产物，请先运行 npm run build。${error.message}`)
      }
      if (files.length !== 1) throw new Error('dist 中需要恰好一个 .tgz；请先构建，或运行 npm run check -- <包的绝对路径> 指定产物。')
      archive = join(output, files[0])
    }
    args = [command, archive]
  }
  await new Promise((resolveChild, reject) => {
    const child = spawn(process.execPath, [launcher, entry, ...args], { cwd: repository, stdio: 'inherit', shell: false })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`开发命令被信号 ${signal} 中止。`))
      else { process.exitCode = code ?? 1; resolveChild() }
    })
  })
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
