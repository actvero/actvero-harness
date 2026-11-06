const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
const MAX_MANIFEST_BYTES = 128 * 1024
const TAR_BLOCK = 512

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Read the manifest from an npm-packed Actvero bundle before requesting installation.
 * @param file Local archive selected by the user.
 * @returns The declared package name and version, or undefined for an invalid or unrelated bundle.
 */
export async function readWorkbenchPackage(file: File): Promise<{ name: string; version: string } | undefined> {
  if (!file.name.toLowerCase().endsWith('.tgz') || file.size > MAX_FILE_BYTES) return undefined
  try {
    const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        if (length > MAX_ARCHIVE_BYTES) {
          await reader.cancel()
          return undefined
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }

    const bytes = new Uint8Array(length)
    let position = 0
    for (const chunk of chunks) {
      bytes.set(chunk, position)
      position += chunk.length
    }

    const decoder = new TextDecoder()
    let manifest: Record<string, unknown> | undefined
    for (let offset = 0; offset + TAR_BLOCK <= length;) {
      const header = bytes.subarray(offset, offset + TAR_BLOCK)
      const path = decoder.decode(header.subarray(0, 100)).split('\0')[0]
      if (!path) break
      const sizeField = decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim()
      if (!/^[0-7]+$/.test(sizeField)) return undefined
      const size = Number.parseInt(sizeField, 8)
      const data = offset + TAR_BLOCK
      if (data + size > length) return undefined
      if (path === 'package/package.json') {
        if (manifest || size > MAX_MANIFEST_BYTES || (header[156] !== 0 && header[156] !== 48)) return undefined
        manifest = record(JSON.parse(decoder.decode(bytes.subarray(data, data + size))))
        if (!manifest) return undefined
      }
      offset = data + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
    }

    const name = manifest?.name
    const dsh = record(manifest?.dsh)
    const client = record(dsh?.client)
    const bundle = record(dsh?.bundle)
    const entry = record(manifest?.exports)?.['./client']
    if (typeof name !== 'string' || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) return undefined
    if (typeof manifest?.version !== 'string' || !manifest.version || typeof bundle?.patch !== 'string' || !bundle.patch) return undefined
    if (client?.platform !== 'web' || !Array.isArray(client.inject) || !client.inject.includes('@actvero/dsh-capability-ui')) return undefined
    if (dsh?.actveroWorkbench !== 1 || (typeof entry !== 'string' && !record(entry))) return undefined
    return { name, version: manifest.version }
  } catch (error) {
    if (error instanceof Error) return undefined
    throw error
  }
}
