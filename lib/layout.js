/**
 * Output-root layout.
 *
 *   <outputRoot>/
 *     <anonymized input name>/      finished data, ready to take away
 *     <anonymized file name>        (single-file input)
 *     _records/
 *       vault.json                  original ↔ pseudonym (sensitive)
 *       index.json                  batch list
 *       runs/<runId>/
 *         report.md, report.json
 *         path-map.json             original ↔ anonymized paths (sensitive)
 *         output/                   staging while the batch runs; holds the
 *                                   partial result of a cancelled/failed batch
 *
 * Batches before 0.8 kept vault.json, index.json and runs/ directly in the
 * output root; `migrateLegacy` moves them into _records once.
 */
import { mkdir, open, readdir, rename, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

export const RECORDS_DIR = '_records'
/** Default output root beside the input. Visible in Finder (no leading dot). */
export const DEFAULT_ROOT = '_medical-anonymizer'
/** Name used before 0.8; renamed to DEFAULT_ROOT on first use. */
export const LEGACY_DEFAULT_ROOT = '.medical-anonymizer'

/**
 * Whether a directory met while scanning input is an anonymizer output root:
 * the default name, any folder holding _records/vault.json or index.json, or
 * a pre-0.8 root under any name (a vault.json shaped like a mapping vault, or
 * index.json next to runs/, at its top level; migrateLegacy only moves these
 * for the current batch's own root). Such folders hold the vault with
 * original values and must never be read back in as records.
 */
export async function isOutputRoot(dir, name = basename(dir)) {
  if (name === DEFAULT_ROOT || name === LEGACY_DEFAULT_ROOT) return true
  const records = join(dir, RECORDS_DIR)
  if ((await exists(join(records, 'vault.json'))) || (await exists(join(records, 'index.json')))) return true
  if (VAULT_HEAD.test(await head(join(dir, 'vault.json')))) return true
  return (await isDir(join(dir, 'runs'))) && INDEX_HEAD.test(await head(join(dir, 'index.json')))
}

// The first bytes of a vault (plain or encrypted, see pseudonym.js) and of a
// batch index (a JSON array of run summaries): a patient export's own
// vault.json / index.json does not look like these.
const VAULT_HEAD = /^\s*\{\s*"version"\s*:\s*\d+\s*,\s*"(?:salt|enc)"\s*:/
const INDEX_HEAD = /^\s*\[\s*(?:\]|\{\s*"id"\s*:)/

/** Up to 256 leading bytes of a regular file as text ('' when unreadable). */
async function head(path) {
  let handle
  try {
    const info = await stat(path)
    if (!info.isFile()) return ''
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(256)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch {
    return ''
  } finally {
    await handle?.close().catch(() => {})
  }
}

const isDir = (path) => stat(path).then((info) => info.isDirectory(), () => false)

export function layout(root) {
  const records = join(root, RECORDS_DIR)
  return {
    root,
    records,
    vault: join(records, 'vault.json'),
    index: join(records, 'index.json'),
    runDir: (id) => join(records, 'runs', id),
    legacyRunDir: (id) => join(root, 'runs', id),
    legacyIndex: join(root, 'index.json'),
    legacyVault: join(root, 'vault.json'),
  }
}

const exists = (path) => stat(path).then(() => true, () => false)

/** Move a pre-0.8 vault, index and runs/ into _records (never overwrites). */
export async function migrateLegacy(root, guard) {
  const paths = layout(root)
  const moves = [
    [paths.legacyVault, paths.vault],
    [paths.legacyIndex, paths.index],
    [join(root, 'runs'), join(paths.records, 'runs')],
  ]
  let moved = 0
  for (const [from, to] of moves) {
    if (!(await exists(from)) || (await exists(to))) continue
    if (guard) {
      await guard.check(from)
      await guard.check(to)
    }
    await mkdir(paths.records, { recursive: true })
    await rename(from, to)
    moved += 1
  }
  return moved
}

/**
 * A name in `dir` that is not taken yet: `name`, then `name (2)`, `name (3)`…
 * For files the counter goes before the extension (`a (2).txt`).
 */
export async function freeName(dir, name, isFile) {
  if (!(await exists(join(dir, name)))) return name
  const ext = isFile ? extname(name) : ''
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${stem} (${index})${ext}`
    if (!(await exists(join(dir, candidate)))) return candidate
  }
  throw new Error(`输出根目录里同名项过多：${name}`)
}

/** Entries directly inside `dir` (empty when it does not exist). */
export async function entries(dir) {
  return readdir(dir, { withFileTypes: true }).catch(() => [])
}

/**
 * Move a finished staging folder into the output root, next to earlier
 * results, never over them. kind: 'dir' (one folder named deliverName),
 * 'file' or 'multi' (each staged entry delivered on its own).
 */
export async function deliverStaged({ outputRoot, outputDir, kind, deliverName, guard }) {
  const { rm: remove } = await import('node:fs/promises')
  const staged = await entries(outputDir)
  const delivered = []
  if (kind === 'file' || kind === 'multi') {
    for (const entry of staged) {
      const name = await freeName(outputRoot, entry.name, entry.isFile())
      if (guard) await guard.check(join(outputRoot, name))
      await rename(join(outputDir, entry.name), join(outputRoot, name))
      delivered.push(join(outputRoot, name))
    }
    await remove(outputDir, { recursive: true, force: true })
  } else if (staged.length > 0) {
    const name = await freeName(outputRoot, deliverName, false)
    if (guard) await guard.check(join(outputRoot, name))
    await rename(outputDir, join(outputRoot, name))
    delivered.push(join(outputRoot, name))
  }
  return delivered
}
