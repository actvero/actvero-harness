import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { parseDocument } from 'yaml'
import type { SkillDetail } from './contracts.ts'
export class SkillError extends Error { constructor(readonly code: string) { super(code) } }
export const digest = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')
export const fail = (code: string): never => { throw new SkillError(code) }
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
export function safePath(value: string): string {
  if (!value || value.length > 500 || /[\\\x00-\x1f\x7f:]/.test(value) || value.startsWith('/') || value !== value.normalize('NFC')) return fail('unsafe_package')
  const parts = value.replace(/\/$/, '').split('/')
  if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) return fail('unsafe_package')
  return parts.join('/')
}
export function parseSkill(text: string, name: string) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) return fail('invalid_skill')
  const doc = parseDocument(match[1], { uniqueKeys: true })
  if (doc.errors.length) return fail('invalid_skill')
  const meta = doc.toJS({ maxAliasCount: 20 })
  if (!meta || meta.name !== name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || typeof meta.description !== 'string' || !meta.description.trim()) return fail('invalid_skill')
  for (const key of ['disable-model-invocation', 'user-invocable']) if (meta[key] !== undefined && typeof meta[key] !== 'boolean') return fail('invalid_skill')
  return { name, description: meta.description, content: text.slice(match[0].length), invocation: { modelInvocable: meta['disable-model-invocation'] !== true, userInvocable: meta['user-invocable'] !== false } }
}
/** Inspect central directory before inflation; reject links, duplicates and bombs. */
export function unpack(bytes: Uint8Array, detail?: SkillDetail): Map<string, Uint8Array> {
  if (bytes.length > 20 * 1024 * 1024 || (detail && (bytes.length !== detail.current_version.size || digest(bytes) !== detail.current_version.sha256))) return fail('package_checksum_mismatch')
  const b = Buffer.from(bytes); let end = -1
  for (let at = b.length - 22; at >= Math.max(0, b.length - 65557); at--) if (b.readUInt32LE(at) === 0x06054b50 && at + 22 + b.readUInt16LE(at + 20) === b.length) { end = at; break }
  if (end < 0 || b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6)) return fail('unsafe_package')
  const count = b.readUInt16LE(end + 10); let at = b.readUInt32LE(end + 16), total = 0
  if (!count || count > 500 || b.readUInt16LE(end + 8) !== count || at + b.readUInt32LE(end + 12) !== end) return fail('unsafe_package')
  const centralStart = at
  const explicitPaths = new Set<string>()
  const entries = new Map<string, number>(); const folded = new Map<string, string>(); const files = new Set<string>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    for (let i = 0; i < count; i++) {
      if (at + 46 > end || b.readUInt32LE(at) !== 0x02014b50) return fail('unsafe_package')
      const flags = b.readUInt16LE(at + 8), method = b.readUInt16LE(at + 10), size = b.readUInt32LE(at + 24)
      const len = b.readUInt16LE(at + 28), extra = b.readUInt16LE(at + 30), comment = b.readUInt16LE(at + 32)
      if (at + 46 + len + extra + comment > end || flags & 1 || ![0,8].includes(method) || b.readUInt16LE(at + 34)) return fail('unsafe_package')
      const rawName = decoder.decode(b.subarray(at + 46, at + 46 + len)), path = safePath(rawName), directory = rawName.endsWith('/')
      const mode = b.readUInt32LE(at + 38) >>> 16, kind = mode & 0xf000
      if ((kind && kind !== (directory ? 0x4000 : 0x8000)) || (b.readUInt32LE(at + 38) & 0x400) || size > 5 * 1024 * 1024 || (directory && size !== 0)) return fail('unsafe_package')
      total += size; if (total > 40 * 1024 * 1024 || entries.has(rawName)) return fail('unsafe_package')
      const parts = path.split('/')
      for (let j = 1; j <= parts.length; j++) {
        const prefix = parts.slice(0,j).join('/'), normalized = prefix.normalize('NFKC').toLowerCase()
        if (folded.has(normalized) && folded.get(normalized) !== prefix) return fail('unsafe_package')
        if (j < parts.length && files.has(normalized)) return fail('unsafe_package')
        folded.set(normalized, prefix)
      }
      const key = path.normalize('NFKC').toLowerCase()
      if (explicitPaths.has(key)) return fail('unsafe_package')
      explicitPaths.add(key)
      if (!directory) { if ([...folded.keys()].some(k => k.startsWith(key + '/')) || files.has(key)) return fail('unsafe_package'); files.add(key) }
      const local = b.readUInt32LE(at + 42)
      if (local + 30 > centralStart || b.readUInt32LE(local) !== 0x04034b50) return fail('unsafe_package')
      const localLen = b.readUInt16LE(local + 26), localExtra = b.readUInt16LE(local + 28)
      if (local + 30 + localLen + localExtra + b.readUInt32LE(at + 20) > centralStart) return fail('unsafe_package')
      if (decoder.decode(b.subarray(local + 30, local + 30 + localLen)) !== rawName || b.readUInt16LE(local + 8) !== method || b.readUInt16LE(local + 6) !== flags) return fail('unsafe_package')
      entries.set(rawName, size); at += 46 + len + extra + comment
    }
    if (at !== end) return fail('unsafe_package')
    const content = unzipSync(bytes, { filter: (file) => {
      if (!entries.has(file.name) || entries.get(file.name) !== file.originalSize) return fail('unsafe_package')
      return !file.name.endsWith('/')
    } })
    const output = new Map<string, Uint8Array>()
    for (const [path, data] of Object.entries(content)) {
      if (data.length !== entries.get(path)) return fail('unsafe_package')
      output.set(path, data)
    }
    if (output.size !== files.size) return fail('unsafe_package')
    if (!detail) return output
    const expected = detail.files.filter(f => !f.path.endsWith('/'))
    if (expected.length !== output.size) return fail('package_checksum_mismatch')
    for (const file of expected) if (!output.has(file.path) || output.get(file.path)!.length !== file.size || digest(output.get(file.path)!) !== file.sha256) return fail('package_checksum_mismatch')
    safePath(detail.entrypoint)
    const entry = output.get(detail.entrypoint); if (!entry || detail.entrypoint.split('/').at(-1) !== 'SKILL.md') return fail('invalid_skill')
    parseSkill(decoder.decode(entry), detail.name)
    return output
  } catch (error) { if (error instanceof SkillError) throw error; return fail('unsafe_package') }
}
