/**
 * Model-reply cache that makes a cancelled or failed batch resumable.
 *
 * Every model reply of a run is appended to `_records/runs/<id>/model-cache.jsonl`
 * (mode 0600), keyed by a hash of the prompt only, not the model: a batch
 * interrupted because one model ran out of quota can be resumed with another
 * model, which then only receives the prompts that were never answered. Resuming starts a new run
 * over the same input with the earlier run's cache loaded: work that was
 * already done replays instantly from the cache (same prompt → same reply),
 * so the new run only calls the model for what is left, including the rest
 * of a large file that was interrupted halfway.
 *
 * The cache holds model output, which quotes original identifiers: it is as
 * sensitive as the vault and is deleted as soon as a run finishes.
 */
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'

export const CACHE_FILE = 'model-cache.jsonl'

export async function createReplayCache({ file, sources = [] }) {
  const replies = new Map()
  for (const source of sources) {
    let text = ''
    try { text = await readFile(source, 'utf8') } catch { continue }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line)
        if (entry?.k && entry.r) replies.set(entry.k, entry.r)
      } catch { /* a line cut off by a killed process */ }
    }
  }
  const written = new Set()
  let queue = Promise.resolve()
  let ready = null
  const stats = { replayed: 0, loaded: replies.size }

  function persist(key, reply) {
    if (written.has(key)) return
    written.add(key)
    const line = `${JSON.stringify({ k: key, r: reply })}\n`
    queue = queue.then(async () => {
      ready ??= mkdir(dirname(file), { recursive: true })
      await ready
      await appendFile(file, line, { mode: 0o600 })
    }).catch(() => {})
  }

  function wrap(llm) {
    if (!llm) return null
    return Object.assign(Object.create(Object.getPrototypeOf(llm)), llm, {
      async chatJson(messages, opts = {}) {
        const key = createHash('sha256').update(JSON.stringify([messages, opts.maxTokens ?? null])).digest('hex')
        const hit = replies.get(key)
        // A cached reply of the wrong shape (from before validation) is not reused.
        if (hit && !(opts.validate && !opts.validate(hit.json))) {
          stats.replayed += 1
          // Carried into this run's own cache so a resumed run can resume too.
          persist(key, hit)
          return { ...hit, cached: true }
        }
        const reply = await llm.chatJson(messages, opts)
        const stored = { json: reply.json, usage: reply.usage ?? null, model: llm.model ?? '' }
        replies.set(key, stored)
        persist(key, stored)
        return reply
      },
    })
  }

  return {
    wrap,
    stats,
    /** Wait for pending writes. */
    flush: () => queue,
    /** Delete this run's cache file (after a finished run). */
    async remove() {
      await queue
      await rm(file, { force: true })
    },
  }
}
