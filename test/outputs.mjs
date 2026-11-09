/** Where a finished batch put its data (see lib/layout.js). */
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

/**
 * A directory standing in for the batch's output: the delivered folder for a
 * directory input. For a single-file input the delivered file may carry a
 * " (2)" suffix, so a tiny path object maps its original name to it.
 */
export async function outDirOf(root, runId) {
  const run = JSON.parse(await readFile(join(root, '_records', 'runs', runId, 'report.json'), 'utf8'))
  if (run.withheld) {
    // Held for review: the finished result is in the run's staging folder.
    const staging = join(root, '_records', 'runs', runId, 'output')
    if (run.outputKind !== 'file') return staging
    const { readdirSync } = await import('node:fs')
    return { file: join(staging, readdirSync(staging)[0]), dir: staging }
  }
  if (!run.output) throw new Error(`batch ${runId} delivered no output`)
  if (run.outputKind !== 'file') return run.output
  return { file: run.output, dir: dirname(run.output) }
}

/** join() that understands the single-file form returned by outDirOf. */
export function outJoin(base, ...parts) {
  if (typeof base === 'string') return join(base, ...parts)
  const rel = join(...parts)
  const delivered = basename(base.file)
  const ext = extname(rel)
  const plain = delivered.replace(/ \(\d+\)(\.[^.]*)?$/, (_, tail) => tail ?? '')
  return rel === delivered || (rel === plain && extname(plain) === ext) ? base.file : join(base.dir, rel)
}
