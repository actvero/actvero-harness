/** Run the delivery case's read-only rules against a JSON export. */
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

async function audit() {
  const { values } = parseArgs({
    options: { input: { type: 'string' }, 'as-of': { type: 'string' } },
  })
  const asOf = values['as-of']
  if (!values.input || !isDate(asOf)) {
    throw new Error('请用 --input 指定交付文件，使用 --as-of YYYY-MM-DD 指定巡检日期。')
  }
  const input = JSON.parse(await readFile(values.input, 'utf8'))
  if (!Array.isArray(input?.deliveries)) throw new Error('输入文件必须包含 deliveries 数组。')

  const findings = []
  const ids = new Set()
  for (const [index, item] of input.deliveries.entries()) {
    if (typeof item?.id !== 'string' || !item.id.trim() || ids.has(item.id)) {
      throw new Error(`第 ${index + 1} 条记录需要一个唯一且非空的 id。`)
    }
    ids.add(item.id)
    if (!['pending', 'ready', 'delivered'].includes(item.status)) {
      throw new Error(`${item.id} 的 status 无效。`)
    }
    if (!isDate(item.dueDate)) throw new Error(`${item.id} 的 dueDate 无效。`)
    if (item.evidence !== undefined && typeof item.evidence !== 'string') {
      throw new Error(`${item.id} 的 evidence 必须是文本。`)
    }
    if (item.status !== 'delivered' && item.dueDate < asOf) {
      findings.push({ id: item.id, rule: 'overdue', dueDate: item.dueDate })
    }
    if (item.status === 'ready' && !item.evidence?.trim()) {
      findings.push({ id: item.id, rule: 'missing-evidence' })
    }
  }
  return { ok: true, asOf, checked: input.deliveries.length, findings }
}

try {
  console.log(JSON.stringify(await audit()))
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }))
  process.exitCode = 1
}
