/**
 * Consistent pseudonym vault.
 *
 * Tokens are deterministic for one vault salt, so the same identifier maps to
 * the same token across rounds, files, and batches that share an output root.
 * The vault is the only place that holds original values.
 *
 * Storage: `_records/vault.sqlite` (mode 0600), one row per mapping:
 *
 *   entries(k, type, pseudonym UNIQUE, original | original_enc, seq, first_seen, run_id)
 *
 *   k            HMAC-SHA256 of type + normalized original: the lookup key, so
 *                no row has to be decrypted to find one
 *   original_enc with a passphrase (vaultPassphrase), each original is
 *                encrypted on its own (AES-256-GCM, key from scrypt); without
 *                one it is stored as is in `original` (mode 0600, as before)
 *
 * Only new and removed mappings are written, in one transaction; another
 * writer's mappings (another batch, a review edit) are taken in on the next
 * save. A changed passphrase re-encrypts every row. secure_delete keeps
 * removed mappings out of the file.
 *
 * `vault.json` (one JSON document, optionally encrypted as a whole) is the
 * format before 0.11: imported into vault.sqlite on first use and left as it
 * was (so an earlier version still reads it; it is no longer written). Without
 * node:sqlite the vault stays a vault.json, as before.
 */
import {
  createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync,
} from 'node:crypto'
import { readFile, writeFile, rename, chmod, mkdir, stat, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { sqliteModuleOrNull } from './records.js'

export const VAULT_DB = 'vault.sqlite'

const LABELS = {
  '姓名': '化名',
  '医生': '医生',
  '身份证号': '证件',
  '电话': '电话',
  '邮箱': '邮箱',
  '地址': '地址',
  '病历号': '病历',
  '住院号': '住院',
  '就诊号': '就诊',
  '社保号': '社保',
  '银行卡号': '银行卡',
  '医院': '医院',
}

export function labelOf(type) {
  return LABELS[type] ?? '标识'
}

function normalize(value) {
  return String(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

function keyOf(type, original) {
  return `${type}|${normalize(original)}`
}

/** Where the vault of a vault.json path is kept: vault.sqlite beside it (x.json → x.sqlite). */
export const vaultDbOf = (file) => (/\.json$/i.test(file) ? file.replace(/\.json$/i, '.sqlite') : `${file}.sqlite`)

const PASSPHRASE_MISMATCH = '映射库口令不匹配：映射库是用另一个口令加密的，请在设置里填写加密它时使用的口令'
const passphraseError = () => Object.assign(new Error(PASSPHRASE_MISMATCH), { code: 'vault-passphrase' })
const CHECK_TEXT = 'dsh-medical-anonymizer vault'

export class Vault {
  /**
   * @param {string} file absolute path of vault.json (the database sits beside it)
   * @param {string} [passphrase] when set, originals are AES-256-GCM encrypted
   * @param {{ format?: 'json' }} [options] format 'json': only vault.json (tests, old roots)
   */
  constructor(file, passphrase = '', { format = null } = {}) {
    this.file = file
    this.dbFile = vaultDbOf(file)
    this.format = format
    this.backend = null
    this.passphrase = passphrase || ''
    this.salt = null
    this.entries = new Map()
    // Live indexes: pseudonyms issued, and mappings per creating batch.
    this.pseudonyms = new Set()
    this.byRun = new Map()
    this.nextSeq = 1
    this.dirty = false
    // Batch that creates new entries; stored on each entry so one batch's
    // mappings can be withdrawn later (forgetRun).
    this.runId = null
    this.saving = Promise.resolve()
    // Keys this instance removed (forget), so a merge on save does not bring
    // them back; with their entries, to find the rows to delete.
    this.removed = new Map()
    // vault.json: size and mtime as this instance last read or wrote it.
    this.stamp = null
    // vault.sqlite: keys already stored, revision read, pending re-encryption.
    this.stored = new Set()
    this.rev = 0
    this.rekeyPending = false
    this.keys = null
  }

  /** The file holding the mappings (vault.sqlite, or vault.json). */
  get path() {
    return this.backend === 'sqlite' ? this.dbFile : this.file
  }

  addEntry(key, entry) {
    const previous = this.entries.get(key)
    if (previous) this.dropIndexes(previous)
    this.entries.set(key, entry)
    this.pseudonyms.add(entry.pseudonym)
    if (entry.runId) this.byRun.set(entry.runId, (this.byRun.get(entry.runId) ?? 0) + 1)
  }

  dropIndexes(entry) {
    this.pseudonyms.delete(entry.pseudonym)
    if (entry.runId) {
      const left = (this.byRun.get(entry.runId) ?? 1) - 1
      if (left > 0) this.byRun.set(entry.runId, left)
      else this.byRun.delete(entry.runId)
    }
  }

  /** Parse vault.json's wrapper into its payload (decrypting when needed). */
  readPayload(raw) {
    const wrapper = JSON.parse(raw)
    if (wrapper.enc === 'aes-256-gcm') {
      if (!this.passphrase) {
        throw new Error('映射库已加密，需要配置 vaultPassphrase 才能读取')
      }
      return { payload: decrypt(wrapper, this.passphrase), encrypted: true }
    }
    return { payload: wrapper, encrypted: false }
  }

  async load() {
    const sqlite = this.format === 'json' ? null : await sqliteModuleOrNull()
    if (sqlite?.DatabaseSync) {
      this.backend = 'sqlite'
      return this.loadDb(sqlite.DatabaseSync)
    }
    this.backend = 'json'
    return this.loadJson()
  }

  async loadJson() {
    let raw
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      this.salt = randomBytes(16).toString('hex')
      this.dirty = true
      return this
    }
    const { payload, encrypted } = this.readPayload(raw)
    this.stamp = await stampOf(this.file)
    this.salt = String(payload.salt)
    for (const entry of payload.entries ?? []) this.addEntry(keyOf(entry.type, entry.original), entry)
    this.nextSeq = Number(payload.nextSeq ?? this.entries.size + 1)
    // A passphrase is configured but the file is still plaintext (encryption
    // was enabled after it was written): the next save encrypts it, even when
    // no new mapping is added.
    if (this.passphrase && !encrypted) this.dirty = true
    return this
  }

  /* ------------------------------------------------------------ database */

  /** Open vault.sqlite (created 0600 with its schema), run fn(db), close. */
  async withDb(fn) {
    const sqlite = await sqliteModuleOrNull()
    const DatabaseSync = sqlite?.DatabaseSync
    if (!DatabaseSync) throw new Error('当前运行环境没有 node:sqlite，无法打开 vault.sqlite')
    await mkdir(dirname(this.dbFile), { recursive: true })
    if (!(await stampOf(this.dbFile))) await writeFile(this.dbFile, '', { mode: 0o600, flag: 'a' })
    await chmod(this.dbFile, 0o600).catch(() => {})
    const db = new DatabaseSync(this.dbFile)
    try {
      db.exec('PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON;')
      const version = db.prepare('PRAGMA user_version').get().user_version
      if (version > 1) throw new Error(`映射库 ${this.dbFile} 的版本（${version}）比本插件新，请升级插件`)
      if (version < 1) {
        db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS entries (
            k TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            pseudonym TEXT NOT NULL UNIQUE,
            original TEXT,
            original_enc TEXT,
            seq INTEGER,
            first_seen TEXT,
            run_id TEXT
          );
          CREATE INDEX IF NOT EXISTS entries_run ON entries (run_id);
          PRAGMA user_version = 1;
          COMMIT;`)
      }
      for (const suffix of ['-wal', '-shm']) await chmod(this.dbFile + suffix, 0o600).catch(() => {})
      return await fn(db)
    } finally {
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* busy: later */ }
      db.close()
    }
  }

  async loadDb() {
    // vault.json of an earlier version, taken over once (left as it is).
    let imported = null
    if (!(await stampOf(this.dbFile)) && (await stampOf(this.file))) {
      const { payload } = this.readPayload(await readFile(this.file, 'utf8'))
      imported = payload
    }
    await this.withDb((db) => {
      const meta = metaOf(db)
      if (!meta.salt) {
        // New database: from the imported vault.json, or empty.
        const salt = imported ? String(imported.salt) : randomBytes(16).toString('hex')
        const keys = this.passphrase ? newKeys(this.passphrase) : null
        transaction(db, () => {
          setMeta(db, { salt, next_seq: String(Number(imported?.nextSeq ?? (imported?.entries?.length ?? 0) + 1)), rev: '1', producer: 'dsh-medical-anonymizer', ...encMeta(keys), ...(imported ? { imported_from: 'vault.json', imported_at: new Date().toISOString() } : {}) })
          const insert = db.prepare(INSERT_SQL)
          for (const entry of imported?.entries ?? []) insertEntry(insert, entry, keys, salt)
        })
        Object.assign(meta, metaOf(db))
      }
      this.salt = meta.salt
      this.keys = this.unlock(meta)
      this.rev = Number(meta.rev ?? 0)
      this.nextSeq = Number(meta.next_seq ?? 1)
      for (const row of db.prepare('SELECT * FROM entries').all()) {
        const entry = this.rowEntry(row)
        const key = keyOf(entry.type, entry.original)
        this.addEntry(key, entry)
        this.stored.add(key)
      }
      this.nextSeq = Math.max(this.nextSeq, this.entries.size + 1)
      // A passphrase is configured but the rows are plaintext (encryption
      // was enabled after they were written): the next save encrypts them.
      if (this.passphrase && !meta.enc) {
        this.rekeyPending = true
        this.dirty = true
      }
    })
    return this
  }

  /** Keys for an encrypted database (checked against its check value); null when plaintext. */
  unlock(meta) {
    if (!meta.enc) return null
    if (!this.passphrase) throw new Error('映射库已加密，需要配置 vaultPassphrase 才能读取')
    const keys = deriveKeys(this.passphrase, meta.kdf_salt)
    let check
    try { check = openText(meta.check, keys) } catch { throw passphraseError() }
    if (check !== CHECK_TEXT) throw passphraseError()
    return keys
  }

  rowEntry(row) {
    const original = row.original_enc ? openText(row.original_enc, this.keys) : row.original
    return {
      type: row.type,
      original,
      pseudonym: row.pseudonym,
      seq: row.seq,
      firstSeen: row.first_seen,
      ...(row.run_id ? { runId: row.run_id } : {}),
    }
  }

  async saveDb() {
    await this.withDb((db) => transaction(db, () => {
      const meta = metaOf(db)
      // Another writer saved since this instance read: take in what it added.
      if (Number(meta.rev ?? 0) !== this.rev) {
        const current = this.unlock(meta)
        const keysBefore = this.keys
        this.keys = current
        for (const row of db.prepare('SELECT * FROM entries').all()) {
          const entry = this.rowEntry(row)
          const key = keyOf(entry.type, entry.original)
          this.stored.add(key)
          if (this.entries.has(key) || this.removed.has(key) || this.pseudonyms.has(entry.pseudonym)) continue
          this.addEntry(key, entry)
        }
        this.keys = keysBefore ?? current
        this.nextSeq = Math.max(this.nextSeq, Number(meta.next_seq ?? 0), this.entries.size + 1)
      }
      const insert = db.prepare(INSERT_SQL)
      if (this.rekeyPending) {
        // Every row again, with the new passphrase (or none).
        const keys = this.passphrase ? newKeys(this.passphrase) : null
        db.exec('DELETE FROM entries')
        for (const entry of this.entries.values()) insertEntry(insert, entry, keys, this.salt)
        setMeta(db, encMeta(keys))
        if (!keys) db.prepare("DELETE FROM meta WHERE key IN ('enc', 'kdf_salt', 'check')").run()
        this.keys = keys
        this.stored = new Set(this.entries.keys())
        this.rekeyPending = false
      } else {
        const remove = db.prepare('DELETE FROM entries WHERE k = ?')
        for (const entry of this.removed.values()) remove.run(lookupKey(entry.type, entry.original, this.keys, this.salt))
        for (const key of this.removed.keys()) this.stored.delete(key)
        for (const [key, entry] of this.entries) {
          if (this.stored.has(key)) continue
          insertEntry(insert, entry, this.keys, this.salt)
          this.stored.add(key)
        }
      }
      this.rev = Number(meta.rev ?? 0) + 1
      setMeta(db, { rev: String(this.rev), next_seq: String(Math.max(this.nextSeq, Number(meta.next_seq ?? 0))), updated_at: new Date().toISOString() })
    }))
  }

  /* ------------------------------------------------------------ vault.json */

  /**
   * Another writer changed vault.json since this instance read it: adopt
   * the mappings it added, so a save never drops them. Entries this instance
   * removed stay removed. Unreadable files are left to the overwrite.
   */
  async mergeFromDisk() {
    const now = await stampOf(this.file)
    if (!now || (this.stamp && now.size === this.stamp.size && now.mtimeMs === this.stamp.mtimeMs)) return
    let payload
    try {
      ;({ payload } = this.readPayload(await readFile(this.file, 'utf8')))
    } catch {
      return
    }
    for (const entry of payload.entries ?? []) {
      const key = keyOf(entry.type, entry.original)
      if (this.entries.has(key) || this.removed.has(key) || this.pseudonyms.has(entry.pseudonym)) continue
      this.addEntry(key, entry)
    }
    this.nextSeq = Math.max(this.nextSeq, Number(payload.nextSeq) || 0, this.entries.size + 1)
  }

  /**
   * Re-encrypt with another passphrase ('' = plaintext) on the next save.
   * The vault must have been loaded with the current one.
   */
  rekey(passphrase) {
    this.passphrase = passphrase || ''
    this.rekeyPending = true
    this.dirty = true
  }

  token(type, original) {
    const key = keyOf(type, original)
    // Distinct identifiers used in this run, new or already in the vault.
    ;(this.used ??= new Set()).add(key)
    const existing = this.entries.get(key)
    if (existing) return existing.pseudonym
    let code = this.codeFor(type, original)
    let pseudonym = `${labelOf(type)}-${code}`
    // Collision guard: extend the code rather than reuse another identity.
    let extra = 0
    while (this.pseudonyms.has(pseudonym)) {
      extra += 1
      code = this.codeFor(type, original, extra)
      pseudonym = `${labelOf(type)}-${code}`
    }
    this.removed.delete(key)
    this.addEntry(key, {
      type,
      original,
      pseudonym,
      seq: this.nextSeq++,
      firstSeen: new Date().toISOString(),
      ...(this.runId ? { runId: this.runId } : {}),
    })
    this.dirty = true
    return pseudonym
  }

  codeFor(type, original, extra = 0) {
    // A code of digits only ("病历-123456") reads like a real number written
    // after its label, so it is never issued: the next variant is used.
    for (let n = extra; ; n += 1) {
      const code = createHmac('sha256', this.salt)
        .update(`${type}\u0000${normalize(original)}\u0000${n}`)
        .digest('hex')
        .slice(0, 6)
        .toUpperCase()
      if (/[A-F]/.test(code)) return code
    }
  }

  /** Remove entries matching `predicate`; returns how many were removed. */
  forget(predicate) {
    let removed = 0
    for (const [key, entry] of this.entries) {
      if (predicate(entry)) {
        this.entries.delete(key)
        this.dropIndexes(entry)
        this.removed.set(key, entry)
        removed += 1
      }
    }
    if (removed > 0) this.dirty = true
    return removed
  }

  /** Remove every entry first created by batch `runId`. */
  forgetRun(runId) {
    if (!runId) return 0
    return this.forget((entry) => entry.runId === runId)
  }

  /** Distinct identifiers this run used (found), whether new or known. */
  countUsed() {
    return this.used?.size ?? 0
  }

  /** Number of entries first created by batch `runId`. */
  countRun(runId) {
    return this.byRun.get(runId) ?? 0
  }

  size() {
    return this.entries.size
  }

  /** Saves are serialized: concurrent files must not race on the store. */
  save() {
    this.saving = this.saving.catch(() => {}).then(() => this.saveNow())
    return this.saving
  }

  async saveNow() {
    if (!this.dirty) return
    // Cleared before the awaits: entries added while writing mark it dirty
    // again and are picked up by the next save.
    this.dirty = false
    try {
      if (this.backend === 'sqlite') await this.saveDb()
      else await this.saveJson()
    } catch (error) {
      this.dirty = true
      throw error
    }
  }

  async saveJson() {
    await mkdir(dirname(this.file), { recursive: true })
    await this.mergeFromDisk()
    const payload = {
      version: 1,
      salt: this.salt,
      updatedAt: new Date().toISOString(),
      nextSeq: this.nextSeq,
      entries: [...this.entries.values()],
    }
    const body = this.passphrase ? JSON.stringify(encrypt(payload, this.passphrase)) : JSON.stringify(payload, null, 2)
    this.rekeyPending = false
    // Unique per save: two instances in one process must not share it.
    const tmp = `${this.file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
    try {
      await writeFile(tmp, body, { mode: 0o600 })
      await rename(tmp, this.file)
      await chmod(this.file, 0o600)
      this.stamp = await stampOf(this.file)
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => {})
      throw error
    }
  }
}

/** Whether `dir` (a _records directory, or a pre-0.8 root) holds a vault. */
export async function hasVault(dir) {
  return Boolean((await stampOf(join(dir, VAULT_DB))) || (await stampOf(join(dir, 'vault.json'))))
}

/* ----------------------------------------------------------- row helpers */

const INSERT_SQL = 'INSERT OR IGNORE INTO entries (k, type, pseudonym, original, original_enc, seq, first_seen, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'

function insertEntry(statement, entry, keys, salt) {
  statement.run(
    lookupKey(entry.type, entry.original, keys, salt),
    String(entry.type),
    String(entry.pseudonym),
    keys ? null : String(entry.original),
    keys ? sealText(String(entry.original), keys) : null,
    Number.isFinite(Number(entry.seq)) ? Number(entry.seq) : null,
    entry.firstSeen ?? null,
    entry.runId ?? null,
  )
}

/** Row key: keyed hash of type + normalized original (the passphrase key when encrypted). */
function lookupKey(type, original, keys, salt) {
  return createHmac('sha256', keys ? keys.mac : Buffer.from(String(salt))).update(keyOf(type, original)).digest('hex')
}

function metaOf(db) {
  return Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((row) => [row.key, row.value]))
}

function setMeta(db, values) {
  const put = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  for (const [key, value] of Object.entries(values)) put.run(key, String(value))
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function newKeys(passphrase) {
  const kdfSalt = randomBytes(16).toString('base64')
  return { ...deriveKeys(passphrase, kdfSalt), kdfSalt }
}

function deriveKeys(passphrase, kdfSalt) {
  const bytes = scryptSync(passphrase, Buffer.from(String(kdfSalt), 'base64'), 64)
  return { enc: bytes.subarray(0, 32), mac: bytes.subarray(32), kdfSalt }
}

function encMeta(keys) {
  return keys ? { enc: 'aes-256-gcm', kdf_salt: keys.kdfSalt, check: sealText(CHECK_TEXT, keys) } : {}
}

/** base64(iv | tag | ciphertext) */
function sealText(text, keys) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keys.enc, iv)
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
}

function openText(sealed, keys) {
  if (!keys) throw passphraseError()
  const bytes = Buffer.from(String(sealed), 'base64')
  const decipher = createDecipheriv('aes-256-gcm', keys.enc, bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(12, 28))
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
}

/* ---------------------------------------------------- vault.json crypto */

function encrypt(payload, passphrase) {
  const salt = randomBytes(16)
  const key = scryptSync(passphrase, salt, 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return {
    version: 1,
    enc: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

function decrypt(wrapper, passphrase) {
  const salt = Buffer.from(wrapper.salt, 'base64')
  const key = scryptSync(passphrase, salt, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(wrapper.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(wrapper.tag, 'base64'))
  let data
  try {
    data = Buffer.concat([decipher.update(Buffer.from(wrapper.data, 'base64')), decipher.final()])
  } catch {
    const error = new Error('映射库口令不匹配：vault.json 是用另一个口令加密的，请在设置里填写加密它时使用的口令')
    error.code = 'vault-passphrase'
    throw error
  }
  return JSON.parse(data.toString('utf8'))
}

async function stampOf(file) {
  try {
    const info = await stat(file)
    return { size: info.size, mtimeMs: info.mtimeMs }
  } catch {
    return null
  }
}
