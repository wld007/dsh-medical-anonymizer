// Test helpers: what a batch wrote to the records of an output root.
import { join } from 'node:path'
import { openRecords } from '../lib/records.js'

export const recordsOf = (root) => openRecords(join(root, '_records'))
/** Review list of a batch (was review-items.json). */
export const reviewFilesOf = async (root, runId) => (await (await recordsOf(root)).getReviewFiles(runId)) ?? []
/** Original ↔ anonymized paths of a batch (was path-map.json). */
export const pathMapOf = async (root, runId) => (await recordsOf(root)).getDoc(runId, 'path-map')
/** Comparison of a batch as text: the file list and every file's rows. */
export async function compareTextOf(root, runId) {
  const store = await recordsOf(root)
  const list = (await store.getCompareList(runId)) ?? []
  const parts = [JSON.stringify(list)]
  for (const entry of list) parts.push(JSON.stringify(await store.getCompareFile(runId, entry.n)))
  return parts.join('\n')
}
