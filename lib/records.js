/**
 * Records store: one SQLite database per output root
 * (`<outputRoot>/_records/records.sqlite`, mode 0600), shared by the batches
 * of that root and keyed by run id. It holds what used to be loose JSON files
 * that were read, changed and written back as a whole:
 *
 *   runs              batch list (was _records/index.json)
 *   review_decisions  reviewer decision per review item (was runs/<id>/review-decisions.json)
 *   review_log        every decision as it was made (append-only, audit)
 *   model_calls       model-call log, metadata only (was runs/<id>/calls.json)
 *   cross_check       cross-check detail (was runs/<id>/cross-check.json)
 *   image_checks      image-check verdicts (was runs/<id>/image-checks.json)
 *   manual_edits      reviewer edits outside the list (was runs/<id>/manual-edits.json)
 *   run_docs          small per-run documents: advice, resume (was advice.json / resume.json)
 *
 * Still files: report.md / report.json (for people and other tools), the
 * vault (vault.json, optionally encrypted as a whole), the model-reply cache
 * (model-cache.jsonl, deleted when a batch finishes), the staging output,
 * review copies, path-map.json and the side-by-side comparison (compare/).
 *
 * Cross-check rows, image verdicts and decisions may quote original text: the
 * database is as sensitive as the vault. It is created with mode 0600 (SQLite
 * gives its -wal/-shm files the database's mode) and runs with
 * secure_delete, so deleted batches do not linger in free pages.
 *
 * Columns are TEXT / INTEGER only and structures are JSON text, so the tables
 * can later be copied into another database as they are. The schema version
 * is PRAGMA user_version; a database newer than this plugin is refused.
 *
 * On the first open the old files of the root are imported once; they stay
 * where they are and are no longer written. Without node:sqlite (Node before
 * 22.13) the store reads and writes the old files, as before.
 */
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const RECORDS_FILE = 'records.sqlite'
export const SCHEMA_VERSION = 1
const PRODUCER = 'dsh-medical-anonymizer'

/** Old per-run files and what they became. */
export const LEGACY_FILES = {
  index: 'index.json',
  decisions: 'review-decisions.json',
  calls: 'calls.json',
  crossCheck: 'cross-check.json',
  imageChecks: 'image-checks.json',
  manualEdits: 'manual-edits.json',
  docs: { advice: 'advice.json', resume: 'resume.json' },
}
const DOC_NAMES = Object.keys(LEGACY_FILES.docs)

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS runs (
     id TEXT PRIMARY KEY,
     status TEXT,
     started_at TEXT,
     finished_at TEXT,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS runs_started ON runs (started_at);
   CREATE TABLE IF NOT EXISTS review_decisions (
     run_id TEXT NOT NULL,
     item_id TEXT NOT NULL,
     action TEXT,
     at TEXT,
     data TEXT NOT NULL,
     PRIMARY KEY (run_id, item_id)
   );
   CREATE TABLE IF NOT EXISTS review_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     run_id TEXT NOT NULL,
     item_id TEXT NOT NULL,
     op TEXT NOT NULL,
     action TEXT,
     at TEXT,
     data TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS review_log_item ON review_log (run_id, item_id);
   CREATE TABLE IF NOT EXISTS model_calls (
     run_id TEXT NOT NULL,
     seq INTEGER NOT NULL,
     at TEXT,
     stage TEXT,
     model TEXT,
     result TEXT,
     ms INTEGER,
     tokens INTEGER,
     data TEXT NOT NULL,
     PRIMARY KEY (run_id, seq)
   );
   CREATE TABLE IF NOT EXISTS cross_check (
     run_id TEXT NOT NULL,
     n INTEGER NOT NULL,
     file TEXT,
     outcome TEXT,
     data TEXT NOT NULL,
     PRIMARY KEY (run_id, n)
   );
   CREATE TABLE IF NOT EXISTS image_checks (
     run_id TEXT NOT NULL,
     item_id TEXT NOT NULL,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (run_id, item_id)
   );
   CREATE TABLE IF NOT EXISTS manual_edits (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     run_id TEXT NOT NULL,
     at TEXT,
     action TEXT,
     type TEXT,
     pseudonym TEXT,
     scope TEXT,
     files INTEGER,
     count INTEGER,
     data TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS manual_edits_run ON manual_edits (run_id);
   CREATE TABLE IF NOT EXISTS run_docs (
     run_id TEXT NOT NULL,
     name TEXT NOT NULL,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (run_id, name)
   );`,
]

let sqliteModule
async function loadSqlite() {
  if (sqliteModule === undefined) {
    // node:sqlite still prints an ExperimentalWarning on some Node versions;
    // the plugin has nothing to act on, so it is not shown.
    const { emitWarning } = process
    process.emitWarning = (warning, ...rest) => {
      if (String(warning?.message ?? warning).includes('SQLite')) return
      return emitWarning.call(process, warning, ...rest)
    }
    try { sqliteModule = await import('node:sqlite') } catch { sqliteModule = null } finally { process.emitWarning = emitWarning }
  }
  return sqliteModule
}

const exists = (path) => stat(path).then(() => true, () => false)
async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return fallback }
}
const now = () => new Date().toISOString()
const int = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.round(Number(value)) : null)
const text = (value) => (value === undefined || value === null ? null : String(value))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* ------------------------------------------------------------------ sqlite */

async function sqliteStore(DatabaseSync, recordsDir) {
  const path = join(recordsDir, RECORDS_FILE)
  // Created 0600 before SQLite opens it: SQLite gives -wal/-shm the same mode.
  if (!(await exists(path))) await writeFile(path, '', { mode: 0o600, flag: 'a' })
  await chmod(path, 0o600).catch(() => {})
  const db = new DatabaseSync(path)
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA secure_delete = ON;')
    const version = db.prepare('PRAGMA user_version').get().user_version
    if (version > SCHEMA_VERSION) throw new Error(`记录库 ${path} 的版本（${version}）比本插件新（${SCHEMA_VERSION}），请升级插件`)
    for (let v = version; v < SCHEMA_VERSION; v += 1) tx(() => { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`) })
  } catch (error) {
    db.close()
    throw error
  }
  for (const suffix of ['-wal', '-shm']) await chmod(path + suffix, 0o600).catch(() => {})

  const q = {
    meta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    runPut: db.prepare(`INSERT INTO runs (id, status, started_at, finished_at, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, started_at = excluded.started_at,
        finished_at = excluded.finished_at, data = excluded.data, updated_at = excluded.updated_at`),
    runImport: db.prepare('INSERT OR IGNORE INTO runs (id, status, started_at, finished_at, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    runGet: db.prepare('SELECT data FROM runs WHERE id = ?'),
    runList: db.prepare('SELECT data FROM runs ORDER BY started_at DESC, id DESC LIMIT ?'),
    decisions: db.prepare('SELECT item_id, data FROM review_decisions WHERE run_id = ?'),
    decisionPut: db.prepare(`INSERT INTO review_decisions (run_id, item_id, action, at, data) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(run_id, item_id) DO UPDATE SET action = excluded.action, at = excluded.at, data = excluded.data`),
    decisionLog: db.prepare('INSERT INTO review_log (run_id, item_id, op, action, at, data) VALUES (?, ?, ?, ?, ?, ?)'),
    decisionHistory: db.prepare('SELECT op, at, data FROM review_log WHERE run_id = ? AND item_id = ? ORDER BY id'),
    calls: db.prepare('SELECT data FROM model_calls WHERE run_id = ? ORDER BY seq'),
    callMax: db.prepare('SELECT MAX(seq) AS seq FROM model_calls WHERE run_id = ?'),
    callPut: db.prepare(`INSERT OR REPLACE INTO model_calls (run_id, seq, at, stage, model, result, ms, tokens, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    cross: db.prepare('SELECT data FROM cross_check WHERE run_id = ? ORDER BY n'),
    crossClear: db.prepare('DELETE FROM cross_check WHERE run_id = ?'),
    crossPut: db.prepare('INSERT INTO cross_check (run_id, n, file, outcome, data) VALUES (?, ?, ?, ?, ?)'),
    images: db.prepare('SELECT item_id, data FROM image_checks WHERE run_id = ?'),
    imagePut: db.prepare(`INSERT INTO image_checks (run_id, item_id, data, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(run_id, item_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
    edits: db.prepare('SELECT data FROM manual_edits WHERE run_id = ? ORDER BY id'),
    editPut: db.prepare('INSERT INTO manual_edits (run_id, at, action, type, pseudonym, scope, files, count, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    docGet: db.prepare('SELECT data FROM run_docs WHERE run_id = ? AND name = ?'),
    docPut: db.prepare(`INSERT INTO run_docs (run_id, name, data, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(run_id, name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
    docDel: db.prepare('DELETE FROM run_docs WHERE run_id = ? AND name = ?'),
  }
  const RUN_TABLES = ['runs:id', 'review_decisions:run_id', 'review_log:run_id', 'model_calls:run_id', 'cross_check:run_id', 'image_checks:run_id', 'manual_edits:run_id', 'run_docs:run_id']
  const runDel = RUN_TABLES.map((entry) => { const [table, column] = entry.split(':'); return db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`) })
  q.setMeta.run('producer', PRODUCER)
  q.setMeta.run('schema_version', String(SCHEMA_VERSION))

  const putRun = (summary, statement = q.runPut) => statement.run(String(summary.id), text(summary.status), text(summary.startedAt), text(summary.finishedAt), JSON.stringify(summary), now())
  const putCall = (runId, entry) => q.callPut.run(runId, int(entry.seq) ?? 0, text(entry.at), text(entry.stage), text(entry.model), text(entry.result), int(entry.ms), int(entry.tokens), JSON.stringify(entry))
  const putEdit = (runId, entry) => q.editPut.run(runId, text(entry.at), text(entry.action), text(entry.type), text(entry.pseudonym), text(entry.scope), int(entry.files), int(entry.count), JSON.stringify(entry))
  const putCross = (runId, entries) => {
    q.crossClear.run(runId)
    entries.forEach((entry, n) => q.crossPut.run(runId, n, text(entry?.file), text(entry?.outcome), JSON.stringify(entry)))
  }
  // op: 'set' (a reviewer decided) or 'import' (taken over from the old files).
  const putDecisions = (runId, changed, op = 'set') => {
    for (const [itemId, value] of changed) {
      q.decisionPut.run(runId, itemId, text(value?.action), text(value?.at), JSON.stringify(value))
      q.decisionLog.run(runId, itemId, op, text(value?.action), text(value?.at) ?? now(), JSON.stringify(value))
    }
  }

  // Old files of this root, imported once (left in place, no longer written).
  if (!q.meta.get('legacy_imported')) {
    const index = await readJson(join(recordsDir, LEGACY_FILES.index), [])
    const runIds = new Set((Array.isArray(index) ? index : []).map((item) => item?.id).filter(Boolean))
    try {
      for (const entry of await readdir(join(recordsDir, 'runs'), { withFileTypes: true })) if (entry.isDirectory()) runIds.add(entry.name)
    } catch { /* none */ }
    const perRun = []
    for (const id of runIds) {
      const dir = join(recordsDir, 'runs', id)
      const docs = {}
      for (const name of DOC_NAMES) docs[name] = await readJson(join(dir, LEGACY_FILES.docs[name]), null)
      perRun.push({
        id,
        decisions: await readJson(join(dir, LEGACY_FILES.decisions), null),
        calls: await readJson(join(dir, LEGACY_FILES.calls), null),
        cross: await readJson(join(dir, LEGACY_FILES.crossCheck), null),
        images: await readJson(join(dir, LEGACY_FILES.imageChecks), null),
        edits: await readJson(join(dir, LEGACY_FILES.manualEdits), null),
        docs,
      })
    }
    tx(() => {
      for (const summary of Array.isArray(index) ? index : []) if (summary?.id) putRun(summary, q.runImport)
      for (const run of perRun) {
        if (run.decisions && typeof run.decisions === 'object' && q.decisions.all(run.id).length === 0) {
          putDecisions(run.id, Object.entries(run.decisions), 'import')
        }
        if (Array.isArray(run.calls) && !q.callMax.get(run.id)?.seq) for (const entry of run.calls) putCall(run.id, entry)
        if (Array.isArray(run.cross) && q.cross.all(run.id).length === 0) putCross(run.id, run.cross)
        if (run.images && typeof run.images === 'object' && q.images.all(run.id).length === 0) {
          for (const [itemId, value] of Object.entries(run.images)) q.imagePut.run(run.id, itemId, JSON.stringify(value), now())
        }
        if (Array.isArray(run.edits) && q.edits.all(run.id).length === 0) for (const entry of run.edits) putEdit(run.id, entry)
        for (const name of DOC_NAMES) {
          if (run.docs[name] != null && !q.docGet.get(run.id, name)) q.docPut.run(run.id, name, JSON.stringify(run.docs[name]), now())
        }
      }
      q.setMeta.run('legacy_imported', now())
    })
  }

  let open = true
  const parse = (row) => (row ? JSON.parse(row.data) : null)
  return {
    kind: 'sqlite',
    path,
    get open() { return open },

    async listRuns(limit = 50) { return q.runList.all(limit).map(parse) },
    async getRun(id) { return parse(q.runGet.get(id)) },
    async putRun(summary) { putRun(summary) },
    /** Change some fields of a listed batch (no-op when it is not listed). */
    async patchRun(id, fields) {
      tx(() => {
        const current = parse(q.runGet.get(id))
        if (current) putRun({ ...current, ...fields, id })
      })
    },
    /** Every row of one batch, in every table. */
    async deleteRun(id) {
      let removed = false
      tx(() => { for (const statement of runDel) removed = statement.run(id).changes > 0 || removed })
      return removed
    },

    async getDecisions(runId) {
      const out = {}
      for (const row of q.decisions.all(runId)) out[row.item_id] = JSON.parse(row.data)
      return out
    },
    /**
     * Store the decisions given (itemId → decision) that differ from the
     * stored ones; each change is also appended to review_log. Returns how
     * many changed.
     */
    async saveDecisions(runId, decisions) {
      return tx(() => {
        const stored = new Map(q.decisions.all(runId).map((row) => [row.item_id, row.data]))
        const changed = Object.entries(decisions ?? {}).filter(([itemId, value]) => value && stored.get(itemId) !== JSON.stringify(value))
        putDecisions(runId, changed)
        return changed.length
      })
    },
    /** Every change of one item's decision: [{ op, at, decision }], oldest first. */
    async decisionHistory(runId, itemId) {
      return q.decisionHistory.all(runId, itemId).map((row) => ({ op: row.op, at: row.at, decision: JSON.parse(row.data) }))
    },

    async getCalls(runId) { return q.calls.all(runId).map(parse) },
    /** Store a batch's call log (entries carry their own seq). */
    async putCalls(runId, entries) { tx(() => { for (const entry of entries) putCall(runId, entry) }) },
    /** Append entries after the last stored seq; returns them numbered. */
    async appendCalls(runId, entries) {
      return tx(() => {
        let seq = q.callMax.get(runId)?.seq ?? 0
        return entries.map((entry) => { seq += 1; const numbered = { ...entry, seq }; putCall(runId, numbered); return numbered })
      })
    },

    async getCrossCheck(runId) { const rows = q.cross.all(runId); return rows.length ? rows.map(parse) : null },
    async putCrossCheck(runId, entries) { tx(() => putCross(runId, entries)) },

    async getImageChecks(runId) {
      const out = {}
      for (const row of q.images.all(runId)) out[row.item_id] = JSON.parse(row.data)
      return out
    },
    /** Upsert the verdicts that changed (itemId → verdict). */
    async putImageChecks(runId, results) {
      tx(() => {
        const stored = new Map(q.images.all(runId).map((row) => [row.item_id, row.data]))
        for (const [itemId, value] of Object.entries(results ?? {})) {
          const data = JSON.stringify(value)
          if (stored.get(itemId) !== data) q.imagePut.run(runId, itemId, data, now())
        }
      })
    },

    async getManualEdits(runId) { return q.edits.all(runId).map(parse) },
    async addManualEdit(runId, entry) { putEdit(runId, entry) },

    async getDoc(runId, name) { return parse(q.docGet.get(runId, name)) },
    async putDoc(runId, name, value) { q.docPut.run(runId, name, JSON.stringify(value), now()) },
    async deleteDoc(runId, name) { q.docDel.run(runId, name) },

    close() {
      if (!open) return
      open = false
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* busy: SQLite checkpoints later */ }
      db.close()
    },
  }
}

/* ------------------------------------------------- old file layout fallback */

function fileStore(recordsDir) {
  const runDir = (id) => join(recordsDir, 'runs', id)
  const indexFile = join(recordsDir, LEGACY_FILES.index)
  const write = async (file, value, pretty = true) => {
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value), { mode: 0o600 })
  }
  const listed = async () => { const value = await readJson(indexFile, []); return Array.isArray(value) ? value : [] }
  // One writer at a time per file: the old files were read and written whole.
  let queue = Promise.resolve()
  const serial = (fn) => { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next }
  return {
    kind: 'files',
    path: null,
    open: true,

    async listRuns(limit = 50) { return (await listed()).slice(0, limit) },
    async getRun(id) { return (await listed()).find((item) => item?.id === id) ?? null },
    putRun: (summary) => serial(async () => write(indexFile, [summary, ...(await listed()).filter((item) => item?.id !== summary.id)].slice(0, 50))),
    patchRun: (id, fields) => serial(async () => {
      const list = await listed()
      if (!list.some((item) => item?.id === id)) return
      await write(indexFile, list.map((item) => (item?.id === id ? { ...item, ...fields, id } : item)))
    }),
    deleteRun: (id) => serial(async () => {
      const list = await listed()
      if (!list.some((item) => item?.id === id)) return false
      await write(indexFile, list.filter((item) => item?.id !== id))
      return true
    }),

    async getDecisions(runId) { return readJson(join(runDir(runId), LEGACY_FILES.decisions), {}) },
    saveDecisions: (runId, decisions) => serial(async () => {
      const file = join(runDir(runId), LEGACY_FILES.decisions)
      const stored = await readJson(file, {})
      const changed = Object.entries(decisions ?? {}).filter(([itemId, value]) => value && !same(stored[itemId], value))
      if (changed.length === 0) return 0
      for (const [itemId, value] of changed) stored[itemId] = value
      await write(file, stored)
      return changed.length
    }),
    async decisionHistory() { return [] },

    async getCalls(runId) { return readJson(join(runDir(runId), LEGACY_FILES.calls), []) },
    putCalls: (runId, entries) => serial(async () => {
      const file = join(runDir(runId), LEGACY_FILES.calls)
      const bySeq = new Map((await readJson(file, [])).map((entry) => [entry.seq, entry]))
      for (const entry of entries) bySeq.set(entry.seq, entry)
      await write(file, [...bySeq.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)), false)
    }),
    appendCalls: (runId, entries) => serial(async () => {
      const file = join(runDir(runId), LEGACY_FILES.calls)
      const log = await readJson(file, [])
      let seq = log.reduce((max, entry) => Math.max(max, Number(entry.seq) || 0), 0)
      const numbered = entries.map((entry) => { seq += 1; return { ...entry, seq } })
      await write(file, [...log, ...numbered], false)
      return numbered
    }),

    async getCrossCheck(runId) { return readJson(join(runDir(runId), LEGACY_FILES.crossCheck), null) },
    putCrossCheck: (runId, entries) => serial(() => write(join(runDir(runId), LEGACY_FILES.crossCheck), entries, false)),

    async getImageChecks(runId) { return readJson(join(runDir(runId), LEGACY_FILES.imageChecks), {}) },
    putImageChecks: (runId, results) => serial(async () => {
      const file = join(runDir(runId), LEGACY_FILES.imageChecks)
      await write(file, { ...(await readJson(file, {})), ...results })
    }),

    async getManualEdits(runId) { return readJson(join(runDir(runId), LEGACY_FILES.manualEdits), []) },
    addManualEdit: (runId, entry) => serial(async () => {
      const file = join(runDir(runId), LEGACY_FILES.manualEdits)
      await write(file, [...(await readJson(file, [])), entry])
    }),

    async getDoc(runId, name) { return readJson(join(runDir(runId), LEGACY_FILES.docs[name] ?? `${name}.json`), null) },
    putDoc: (runId, name, value) => serial(() => write(join(runDir(runId), LEGACY_FILES.docs[name] ?? `${name}.json`), value)),
    async deleteDoc(runId, name) { await rm(join(runDir(runId), LEGACY_FILES.docs[name] ?? `${name}.json`), { force: true }) },

    close() {},
  }
}

/* -------------------------------------------------------------- open/close */

// Open stores by records directory, shared by the pipeline and the service
// of this process. A closed store is opened again on the next use.
const stores = new Map()
let preferFiles = false

/** Tests and troubleshooting: use the old file layout even with node:sqlite. */
export function useFileRecords(on = true) { preferFiles = on }

/** Whether this runtime keeps records in SQLite. */
export async function sqliteAvailable() {
  return !preferFiles && Boolean((await loadSqlite())?.DatabaseSync)
}

/**
 * The records store of one `_records` directory.
 *   create: false — return null when the directory does not exist (read-only
 *   callers must not recreate the records of a deleted output root).
 *   guard — the batch's write guard; checked before the database is created.
 */
export async function openRecords(recordsDir, { create = true, guard = null } = {}) {
  recordsDir = resolve(recordsDir)
  const cached = stores.get(recordsDir)
  if (cached) {
    const store = await cached.catch(() => null)
    if (store?.open) return store
    if (stores.get(recordsDir) === cached) stores.delete(recordsDir)
  }
  if (!(await exists(recordsDir))) {
    if (!create) return null
    if (guard) await guard.check(recordsDir)
    await mkdir(recordsDir, { recursive: true, mode: 0o700 })
  }
  if (stores.has(recordsDir)) return openRecords(recordsDir, { create, guard })
  const opening = (async () => {
    const mod = preferFiles ? null : await loadSqlite()
    if (!mod?.DatabaseSync) return fileStore(recordsDir)
    if (guard) await guard.check(join(recordsDir, RECORDS_FILE))
    return sqliteStore(mod.DatabaseSync, recordsDir)
  })()
  stores.set(recordsDir, opening)
  opening.catch(() => { if (stores.get(recordsDir) === opening) stores.delete(recordsDir) })
  return opening
}

/** Close every open store (plugin unload); later calls open them again. */
export async function closeRecords() {
  const open = [...stores.values()]
  stores.clear()
  for (const pending of open) {
    try { (await pending).close() } catch { /* failed to open */ }
  }
}
