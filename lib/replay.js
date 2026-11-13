/**
 * Model-reply cache that makes a cancelled, failed or interrupted batch
 * resumable.
 *
 * Every model reply of a run is stored in the records (records.js
 * model_cache, keyed by run id and a hash of the prompt only, not the model):
 * a batch interrupted because one model ran out of quota can be resumed with
 * another model, which then only receives the prompts that were never
 * answered. Resuming starts a new run over the same input with the earlier
 * run's replies loaded: work that was already done replays instantly (same
 * prompt → same reply), so the new run only calls the model for what is
 * left, including the rest of a large file that was interrupted halfway.
 *
 * The cache holds model output, which quotes original identifiers: it is as
 * sensitive as the vault and is deleted as soon as a run finishes
 * (records.purgeRun). Batches written before 0.11 kept it in
 * `_records/runs/<id>/model-cache.jsonl`; such files can still be replayed.
 */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export const CACHE_FILE = 'model-cache.jsonl'

/**
 * @param {object} options
 * @param {() => Promise<object>} options.records the records store (opened on use)
 * @param {string} options.runId this run
 * @param {string[]} [options.from] earlier runs whose replies are replayed
 * @param {string[]} [options.sources] old model-cache.jsonl files to replay
 */
export async function createReplayCache({ records, runId, from = [], sources = [] }) {
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
  for (const earlier of from) {
    try {
      for (const [key, reply] of await (await records()).getCache(earlier)) if (reply) replies.set(key, reply)
    } catch { /* records unavailable: the batch runs without them */ }
  }
  const written = new Set()
  let queue = Promise.resolve()
  const stats = { replayed: 0, loaded: replies.size }

  function persist(key, reply) {
    if (written.has(key)) return
    written.add(key)
    queue = queue.then(async () => (await records()).putCache(runId, key, reply)).catch(() => {})
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
  }
}
