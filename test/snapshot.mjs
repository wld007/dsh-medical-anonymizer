/**
 * Byte-level snapshot of a directory tree (or a single file): relative path →
 * SHA-256. Tests compare snapshots of the input before and after a run to
 * prove the plugin never modifies source files.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'

export async function snapshotTree(root, { exclude = [] } = {}) {
  const out = {}
  const info = await stat(root)
  if (info.isFile()) {
    out['.'] = createHash('sha256').update(await readFile(root)).digest('hex')
    return out
  }
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (exclude.some((skip) => path === skip || path.startsWith(`${skip}/`))) continue
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) out[relative(root, path)] = createHash('sha256').update(await readFile(path)).digest('hex')
    }
  }
  await walk(root)
  return out
}
