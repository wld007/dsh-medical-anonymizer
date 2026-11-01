/**
 * Source-file protection. The plugin must never modify its input: every
 * write goes through a guard that resolves symlinks and refuses any target
 * inside an input root or outside the run's output directory, and every input
 * file is fingerprinted before the run and re-checked afterwards.
 */
import { realpath, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

const inside = (path, root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)

/** Real path of `path`, or of its nearest existing ancestor plus the rest. */
async function realOrAncestor(path) {
  const absolute = resolve(path)
  let current = absolute
  const rest = []
  for (;;) {
    try {
      const real = await realpath(current)
      return rest.length > 0 ? resolve(real, ...rest.reverse()) : real
    } catch {
      const parent = dirname(current)
      if (parent === current) return absolute
      rest.push(current.slice(parent.length).replace(/^[\\/]+/, ''))
      current = parent
    }
  }
}

export class InputProtectionError extends Error {
  constructor(message) {
    super(message)
    this.code = 'input-protection'
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
  const outputs = [resolve(outputRoot), await realOrAncestor(outputRoot)]
  // An output root inside the input directory is allowed (the input listing
  // excludes it); one equal to an input root, or containing it, is not.
  for (const output of outputs) {
    for (const input of inputs) {
      if (inside(input, output)) throw new InputProtectionError('输出根目录不能与输入相同或包含输入，请选择输入之外的位置')
    }
  }
  const realOutputs = [...new Set(outputs)]
  return {
    /** Throws unless `target` is inside the output root and not an input file. */
    async check(target) {
      const real = await realOrAncestor(target)
      const absolute = resolve(target)
      if (!realOutputs.some((root) => inside(real, root) || inside(absolute, root))) {
        throw new InputProtectionError(`拒绝写入输出目录之外的位置：${absolute}`)
      }
      for (const input of inputs) {
        // The output root may sit inside the input directory (default
        // .medical-anonymizer next to a file); only exact input files and
        // paths outside the output root are protected then.
        if ((inside(real, input) || inside(absolute, input)) && !realOutputs.some((root) => inside(root, input) && (inside(real, root) || inside(absolute, root)))) {
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
