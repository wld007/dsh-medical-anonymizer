/**
 * Source-file protection. The plugin must never modify its input: every
 * write goes through a guard that resolves symlinks and refuses any target
 * inside an input root or outside the run's output directory, and every input
 * file is fingerprinted before the run and re-checked afterwards.
 *
 * Decisions use real paths only: a symlink under the output root that points
 * at an input file, into an input folder or anywhere outside the output root
 * (a dangling one included) is refused, since writeFile would follow it.
 */
import { lstat, readlink, realpath, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

const inside = (path, root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
const MAX_LINKS = 40

export class InputProtectionError extends Error {
  constructor(message) {
    super(message)
    this.code = 'input-protection'
  }
}

/**
 * Real path of `path`, or of its nearest existing ancestor plus the rest. A
 * dangling symlink on the way is followed by hand, so the result is where a
 * write would actually land.
 */
async function realOrAncestor(path, links = 0) {
  if (links > MAX_LINKS) throw new InputProtectionError('软链接层级过多，拒绝写入')
  const absolute = resolve(path)
  let current = absolute
  const rest = []
  for (;;) {
    try {
      const real = await realpath(current)
      return rest.length > 0 ? resolve(real, ...[...rest].reverse()) : real
    } catch {
      const info = await lstat(current).catch(() => null)
      if (info?.isSymbolicLink()) {
        const target = await readlink(current)
        return realOrAncestor(resolve(dirname(current), target, ...[...rest].reverse()), links + 1)
      }
      const parent = dirname(current)
      if (parent === current) return absolute
      rest.push(current.slice(parent.length).replace(/^[\\/]+/, ''))
      current = parent
    }
  }
}

/**
 * @param {{ inputRoots: string[], outputRoot: string }} options
 * inputRoots: directories (or single files) that must never be written.
 */
export async function createWriteGuard({ inputRoots, outputRoot }) {
  const inputs = []
  for (const root of inputRoots) {
    if (!root) continue
    inputs.push(resolve(root))
    inputs.push(await realOrAncestor(root))
  }
  const realOutput = await realOrAncestor(outputRoot)
  // An output root inside the input directory is allowed (the input listing
  // excludes it); one equal to an input root, or containing it, is not.
  for (const output of new Set([resolve(outputRoot), realOutput])) {
    for (const input of inputs) {
      if (inside(input, output)) throw new InputProtectionError('输出根目录不能与输入相同或包含输入，请选择输入之外的位置')
    }
  }
  return {
    /** Throws unless `target` really is inside the output root and not in an input. */
    async check(target) {
      const absolute = resolve(target)
      const real = await realOrAncestor(target)
      if (!inside(real, realOutput)) {
        throw new InputProtectionError(`拒绝写入输出目录之外的位置：${absolute}`)
      }
      for (const input of inputs) {
        // The output root may sit inside the input directory (default
        // _medical-anonymizer next to a file): only the output root's own
        // contents are writable then, judged by the real path alone.
        if (inside(real, input) && !(inside(realOutput, input) && inside(real, realOutput))) {
          throw new InputProtectionError(`拒绝写入输入目录：${absolute}`)
        }
      }
      return real
    },
  }
}

/** Size + mtime fingerprint of every input file. */
export async function fingerprint(paths) {
  const prints = new Map()
  for (const path of paths) {
    try {
      const info = await stat(path)
      prints.set(path, `${info.size}:${info.mtimeMs}`)
    } catch {
      prints.set(path, 'missing')
    }
  }
  return prints
}

/** Paths whose fingerprint changed (or that disappeared) since `before`. */
export async function changedSince(before) {
  const after = await fingerprint([...before.keys()])
  return [...before.keys()].filter((path) => after.get(path) !== before.get(path))
}
