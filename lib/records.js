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
 *   run_docs          small per-run documents: advice, resume (was advice.json /
 *                     resume.json), path-map (was path-map.json), live (state of a
 *                     running batch), image-job (image-check progress)
 *   run_detail        the full batch record (was report.json, still written as an export)
 *   file_results      per-file result of a running batch, so a resumed batch can
 *                     take over finished files (deleted when the batch finishes)
 *   review_files / review_items   review list (was review-items.json)
 *   compare_files / compare_changes  side-by-side comparison (was compare/)
 *   model_cache       model replies of an unfinished batch (was model-cache.jsonl;
 *                     deleted when the batch finishes)
 *
 * Still files: report.md / report.json (exports for people and other tools),
 * the staging output and the review copies. The vault has its own database
 * (vault.sqlite, see pseudonym.js).
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
import { appendFile, chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const RECORDS_FILE = 'records.sqlite'
export const SCHEMA_VERSION = 2
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
  report: 'report.json',
  reviewItems: 'review-items.json',
  compare: 'compare',
  pathMap: 'path-map.json',
  cache: 'model-cache.jsonl',
  checkpoint: 'file-results.jsonl',
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
  `CREATE TABLE IF NOT EXISTS run_detail (
     run_id TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS file_results (
     run_id TEXT NOT NULL,
     rel_path TEXT NOT NULL,
     out_rel TEXT,
     print TEXT,
     config TEXT,
     status TEXT,
     data TEXT NOT NULL,
     done_at TEXT NOT NULL,
     PRIMARY KEY (run_id, rel_path)
   );
   CREATE TABLE IF NOT EXISTS review_files (
     run_id TEXT NOT NULL,
     n INTEGER NOT NULL,
     rel_path TEXT,
     data TEXT NOT NULL,
     PRIMARY KEY (run_id, n)
   );
   CREATE TABLE IF NOT EXISTS review_items (
     run_id TEXT NOT NULL,
     item_id TEXT NOT NULL,
     file_n INTEGER NOT NULL,
     k INTEGER NOT NULL,
     code TEXT,
     data TEXT NOT NULL,
     PRIMARY KEY (run_id, item_id)
   );
   CREATE INDEX IF NOT EXISTS review_items_file ON review_items (run_id, file_n, k);
   CREATE TABLE IF NOT EXISTS compare_files (
     run_id TEXT NOT NULL,
     n INTEGER NOT NULL,
     rel_path TEXT,
     data TEXT NOT NULL,
     PRIMARY KEY (run_id, n)
   );
   CREATE TABLE IF NOT EXISTS compare_changes (
     run_id TEXT NOT NULL,
     n INTEGER NOT NULL,
     k INTEGER NOT NULL,
     before_text TEXT,
     after_text TEXT,
     data TEXT NOT NULL,
     PRIMARY KEY (run_id, n, k)
   );
   CREATE TABLE IF NOT EXISTS model_cache (
     run_id TEXT NOT NULL,
     k TEXT NOT NULL,
     data TEXT NOT NULL,
     PRIMARY KEY (run_id, k)
   );`,
]

/** A comparison row ↔ its columns: before / after text apart, the rest as JSON. */
function changeColumns(change) {
  const { before, after, same: unchanged, ...rest } = change
  return [text(before), unchanged ? null : text(after ?? before), JSON.stringify(rest)]
}
function changeOf(row) {
  const rest = JSON.parse(row.data)
  const out = { id: rest.id, i: rest.i, field: rest.field, before: row.before_text }
  if (row.after_text === null) out.same = true
  else out.after = row.after_text
  for (const [key, value] of Object.entries(rest)) if (!(key in out)) out[key] = value
  if (out.i === undefined) delete out.i
  return out
}
/** Review list rows: a file without its items, items one by one. */
function splitReviewFiles(files) {
  return files.map((file, n) => {
    const { items = [], ...meta } = file
    return { n, relPath: file.relPath ?? null, meta, items }
  })
}
async function readLines(path) {
  let raw = ''
  try { raw = await readFile(path, 'utf8') } catch { return [] }
  const out = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* a line cut off by a killed process */ }
  }
  return out
}

let sqliteModule
/** node:sqlite, or null when this runtime has none (or the file layout is forced). */
export async function sqliteModuleOrNull() {
  return preferFiles ? null : loadSqlite()
}
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
    detailGet: db.prepare('SELECT data FROM run_detail WHERE run_id = ?'),
    detailPut: db.prepare(`INSERT INTO run_detail (run_id, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
    fileGet: db.prepare('SELECT rel_path, out_rel, print, config, status, data FROM file_results WHERE run_id = ?'),
    filePut: db.prepare(`INSERT INTO file_results (run_id, rel_path, out_rel, print, config, status, data, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, rel_path) DO UPDATE SET out_rel = excluded.out_rel, print = excluded.print, config = excluded.config,
        status = excluded.status, data = excluded.data, done_at = excluded.done_at`),
    fileDel: db.prepare('DELETE FROM file_results WHERE run_id = ?'),
    reviewFiles: db.prepare('SELECT n, data FROM review_files WHERE run_id = ? ORDER BY n'),
    reviewItems: db.prepare('SELECT file_n, data FROM review_items WHERE run_id = ? ORDER BY file_n, k'),
    reviewItem: db.prepare('SELECT file_n FROM review_items WHERE run_id = ? AND item_id = ?'),
    reviewFile: db.prepare('SELECT data FROM review_files WHERE run_id = ? AND n = ?'),
    reviewFileItems: db.prepare('SELECT data FROM review_items WHERE run_id = ? AND file_n = ? ORDER BY k'),
    reviewFilesDel: db.prepare('DELETE FROM review_files WHERE run_id = ?'),
    reviewItemsDel: db.prepare('DELETE FROM review_items WHERE run_id = ?'),
    reviewFilePut: db.prepare('INSERT INTO review_files (run_id, n, rel_path, data) VALUES (?, ?, ?, ?)'),
    reviewItemPut: db.prepare('INSERT OR REPLACE INTO review_items (run_id, item_id, file_n, k, code, data) VALUES (?, ?, ?, ?, ?, ?)'),
    compareList: db.prepare('SELECT data FROM compare_files WHERE run_id = ? ORDER BY n'),
    compareFile: db.prepare('SELECT data FROM compare_files WHERE run_id = ? AND n = ?'),
    compareFilePut: db.prepare(`INSERT INTO compare_files (run_id, n, rel_path, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(run_id, n) DO UPDATE SET rel_path = excluded.rel_path, data = excluded.data`),
    compareChanges: db.prepare('SELECT k, before_text, after_text, data FROM compare_changes WHERE run_id = ? AND n = ? ORDER BY k'),
    compareMatching: db.prepare(`SELECT k, before_text, after_text, data FROM compare_changes
      WHERE run_id = ? AND n = ? AND instr(coalesce(after_text, before_text), ?) > 0 ORDER BY k`),
    compareChangePut: db.prepare(`INSERT INTO compare_changes (run_id, n, k, before_text, after_text, data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, n, k) DO UPDATE SET before_text = excluded.before_text, after_text = excluded.after_text, data = excluded.data`),
    compareChangesDel: db.prepare('DELETE FROM compare_changes WHERE run_id = ? AND n = ?'),
    cacheAll: db.prepare('SELECT k, data FROM model_cache WHERE run_id = ?'),
    cachePut: db.prepare('INSERT OR IGNORE INTO model_cache (run_id, k, data) VALUES (?, ?, ?)'),
    cacheDel: db.prepare('DELETE FROM model_cache WHERE run_id = ?'),
  }
  const RUN_TABLES = ['runs:id', 'review_decisions:run_id', 'review_log:run_id', 'model_calls:run_id', 'cross_check:run_id', 'image_checks:run_id', 'manual_edits:run_id', 'run_docs:run_id',
    'run_detail:run_id', 'file_results:run_id', 'review_files:run_id', 'review_items:run_id', 'compare_files:run_id', 'compare_changes:run_id', 'model_cache:run_id']
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
  const runDir = (id) => join(recordsDir, 'runs', id)
  // Content written to deleted rows can stay in the WAL until it is
  // checkpointed: move it into the (secure_delete) database file now.
  const checkpoint = () => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* busy: SQLite checkpoints later */ } }
  const putReview = (runId, files) => {
    q.reviewItemsDel.run(runId)
    q.reviewFilesDel.run(runId)
    for (const { n, relPath, meta, items } of splitReviewFiles(files)) {
      q.reviewFilePut.run(runId, n, text(relPath), JSON.stringify(meta))
      items.forEach((item, k) => q.reviewItemPut.run(runId, String(item.id), n, k, text(item.code), JSON.stringify(item)))
    }
  }
  const putCompare = (runId, entry, changes) => {
    q.compareFilePut.run(runId, entry.n, text(entry.relPath), JSON.stringify(entry))
    q.compareChangesDel.run(runId, entry.n)
    changes.forEach((change, k) => q.compareChangePut.run(runId, entry.n, k, ...changeColumns(change)))
  }
  // Batches written before 0.11 keep these as files in runs/<id>/: taken
  // over the first time they are asked for (the files stay as they are).
  const legacyReview = async (runId) => {
    const files = await readJson(join(runDir(runId), LEGACY_FILES.reviewItems), null)
    if (!Array.isArray(files)) return null
    tx(() => { if (q.reviewFiles.all(runId).length === 0) putReview(runId, files) })
    return files
  }
  const legacyCompare = async (runId) => {
    const dir = join(runDir(runId), LEGACY_FILES.compare)
    const index = await readJson(join(dir, 'index.json'), null)
    if (!Array.isArray(index)) return null
    const files = []
    for (const entry of index) files.push({ entry, data: entry.skipped ? null : await readJson(join(dir, `${entry.n}.json`), null) })
    tx(() => {
      if (q.compareList.all(runId).length > 0) return
      for (const { entry, data } of files) putCompare(runId, entry, data?.changes ?? [])
    })
    return index
  }
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
      checkpoint()
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

    async getDoc(runId, name) {
      const row = q.docGet.get(runId, name)
      if (row) return parse(row)
      if (name !== 'path-map') return null
      // path-map.json of a batch written before 0.11.
      const legacy = await readJson(join(runDir(runId), LEGACY_FILES.pathMap), null)
      if (legacy) q.docPut.run(runId, name, JSON.stringify(legacy), now())
      return legacy
    },
    async putDoc(runId, name, value) { q.docPut.run(runId, name, JSON.stringify(value), now()) },
    async deleteDoc(runId, name) { q.docDel.run(runId, name) },

    /** The full batch record (report.json of batches written before 0.11). */
    async getRunDetail(id) {
      const row = q.detailGet.get(id)
      if (row) return parse(row)
      const legacy = await readJson(join(runDir(id), LEGACY_FILES.report), null)
      if (legacy?.id) q.detailPut.run(id, JSON.stringify(legacy), now())
      return legacy?.id ? legacy : null
    },
    async putRunDetail(run) { q.detailPut.run(String(run.id), JSON.stringify(run), now()) },

    /** Per-file results of a batch (relPath → { outRel, print, config, status, data }). */
    async getFileResults(runId) {
      return new Map(q.fileGet.all(runId).map((row) => [row.rel_path, { outRel: row.out_rel, print: row.print, config: row.config, status: row.status, data: JSON.parse(row.data) }]))
    },
    async putFileResult(runId, { relPath, outRel, print, config, status, data }) {
      q.filePut.run(runId, relPath, text(outRel), text(print), text(config), text(status), JSON.stringify(data), now())
    },

    /** Review list as written by the batch: [{ relPath, reviewCopy, items }], or null. */
    async getReviewFiles(runId) {
      const files = q.reviewFiles.all(runId)
      if (files.length === 0) return legacyReview(runId)
      const out = files.map((row) => ({ ...JSON.parse(row.data), items: [] }))
      const byN = new Map(files.map((row, at) => [row.n, out[at]]))
      for (const row of q.reviewItems.all(runId)) byN.get(row.file_n)?.items.push(JSON.parse(row.data))
      return out
    },
    /** One review item and its file (with all of that file's items). */
    async getReviewItem(runId, itemId) {
      let hit = q.reviewItem.get(runId, String(itemId))
      if (!hit && q.reviewFiles.all(runId).length === 0 && await legacyReview(runId)) hit = q.reviewItem.get(runId, String(itemId))
      if (!hit) return null
      const file = { ...parse(q.reviewFile.get(runId, hit.file_n)), items: q.reviewFileItems.all(runId, hit.file_n).map(parse) }
      return { file, item: file.items.find((item) => String(item.id) === String(itemId)) }
    },
    async putReviewFiles(runId, files) { tx(() => putReview(runId, files)) },

    /** Comparison: file list ([{ n, relPath, changed, total, … }]) or null. */
    async getCompareList(runId) {
      const rows = q.compareList.all(runId)
      return rows.length ? rows.map(parse) : legacyCompare(runId)
    },
    /** One file's comparison: { relPath, all, changes }, or null. */
    async getCompareFile(runId, n) {
      let entry = parse(q.compareFile.get(runId, n))
      if (!entry && q.compareList.all(runId).length === 0 && await legacyCompare(runId)) entry = parse(q.compareFile.get(runId, n))
      if (!entry || entry.skipped) return null
      return { relPath: entry.relPath, all: true, changes: q.compareChanges.all(runId, n).map(changeOf) }
    },
    /** Rows of one file's comparison: [{ k, change }]; with `needle`, only rows whose current text holds it. */
    async getCompareRows(runId, n, needle = null) {
      const rows = needle ? q.compareMatching.all(runId, n, needle) : q.compareChanges.all(runId, n)
      return rows.map((row) => ({ k: row.k, change: changeOf(row) }))
    },
    /** Rewrite some rows ([{ k, change }]) and the file's list entry fields. */
    async updateCompare(runId, n, rows, fields = null) {
      tx(() => {
        for (const { k, change } of rows) q.compareChangePut.run(runId, n, k, ...changeColumns(change))
        if (fields) {
          const entry = parse(q.compareFile.get(runId, n))
          if (entry) q.compareFilePut.run(runId, n, text(entry.relPath), JSON.stringify({ ...entry, ...fields }))
        }
      })
    },
    /** One file's comparison as the batch writes it (entry.n numbers the files). */
    async putCompareFile(runId, entry, changes = []) { tx(() => putCompare(runId, entry, changes)) },
    async finishCompare() {},

    /** Model replies of a batch: [[key, reply]]. */
    async getCache(runId) { return q.cacheAll.all(runId).map((row) => [row.k, JSON.parse(row.data)]) },
    async putCache(runId, key, value) { q.cachePut.run(runId, key, JSON.stringify(value)) },

    /**
     * Drop what only an unfinished batch needs (model replies, per-file
     * results; both quote original text) and scrub it from the WAL.
     */
    async purgeRun(runId) {
      tx(() => { q.cacheDel.run(runId); q.fileDel.run(runId) })
      checkpoint()
    },

    close() {
      if (!open) return
      open = false
      checkpoint()
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
  const docFile = (name) => LEGACY_FILES.docs[name] ?? (name === 'path-map' ? LEGACY_FILES.pathMap : `${name}.json`)
  const pendingCompare = new Map()
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

    async getDoc(runId, name) { return readJson(join(runDir(runId), docFile(name)), null) },
    putDoc: (runId, name, value) => serial(() => write(join(runDir(runId), docFile(name)), value)),
    async deleteDoc(runId, name) { await rm(join(runDir(runId), docFile(name)), { force: true }) },

    async getRunDetail(id) { const run = await readJson(join(runDir(id), LEGACY_FILES.report), null); return run?.id ? run : null },
    // report.json is the record itself here; the caller writes it.
    async putRunDetail() {},

    async getFileResults(runId) {
      const out = new Map()
      for (const row of await readLines(join(runDir(runId), LEGACY_FILES.checkpoint))) out.set(row.relPath, row)
      return out
    },
    putFileResult: (runId, row) => serial(async () => {
      await mkdir(runDir(runId), { recursive: true })
      await appendFile(join(runDir(runId), LEGACY_FILES.checkpoint), `${JSON.stringify(row)}\n`, { mode: 0o600 })
    }),

    async getReviewFiles(runId) { const files = await readJson(join(runDir(runId), LEGACY_FILES.reviewItems), null); return Array.isArray(files) ? files : null },
    async getReviewItem(runId, itemId) {
      const files = await this.getReviewFiles(runId)
      for (const file of files ?? []) {
        const item = file.items.find((entry) => String(entry.id) === String(itemId))
        if (item) return { file, item }
      }
      return null
    },
    putReviewFiles: (runId, files) => serial(() => write(join(runDir(runId), LEGACY_FILES.reviewItems), files)),

    async getCompareList(runId) { const index = await readJson(join(runDir(runId), LEGACY_FILES.compare, 'index.json'), null); return Array.isArray(index) ? index : null },
    async getCompareFile(runId, n) { return readJson(join(runDir(runId), LEGACY_FILES.compare, `${n}.json`), null) },
    async getCompareRows(runId, n, needle = null) {
      const data = await this.getCompareFile(runId, n)
      return (data?.changes ?? []).map((change, k) => ({ k, change }))
        .filter(({ change }) => !needle || (change.same ? change.before : change.after).includes(needle))
    },
    updateCompare: (runId, n, rows, fields = null) => serial(async () => {
      const dir = join(runDir(runId), LEGACY_FILES.compare)
      const data = await readJson(join(dir, `${n}.json`), null)
      if (!data) return
      for (const { k, change } of rows) data.changes[k] = change
      await write(join(dir, `${n}.json`), data, false)
      if (fields) {
        const index = await readJson(join(dir, 'index.json'), [])
        await write(join(dir, 'index.json'), index.map((entry) => (entry.n === n ? { ...entry, ...fields } : entry)), false)
      }
    }),
    // The list is written once at the end (finishCompare), not per file.
    putCompareFile: (runId, entry, changes = []) => serial(async () => {
      ;(pendingCompare.get(runId) ?? pendingCompare.set(runId, []).get(runId)).push(entry)
      if (!entry.skipped) await write(join(runDir(runId), LEGACY_FILES.compare, `${entry.n}.json`), { relPath: entry.relPath, all: true, changes }, false)
    }),
    finishCompare: (runId) => serial(async () => {
      const index = pendingCompare.get(runId)
      pendingCompare.delete(runId)
      if (index?.length) await write(join(runDir(runId), LEGACY_FILES.compare, 'index.json'), index, false)
    }),

    async getCache(runId) { return (await readLines(join(runDir(runId), LEGACY_FILES.cache))).filter((entry) => entry?.k && entry.r).map((entry) => [entry.k, entry.r]) },
    putCache: (runId, key, value) => serial(async () => {
      await mkdir(runDir(runId), { recursive: true })
      await appendFile(join(runDir(runId), LEGACY_FILES.cache), `${JSON.stringify({ k: key, r: value })}\n`, { mode: 0o600 })
    }),
    purgeRun: (runId) => serial(async () => {
      for (const name of [LEGACY_FILES.cache, LEGACY_FILES.checkpoint]) await rm(join(runDir(runId), name), { force: true })
    }),

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
