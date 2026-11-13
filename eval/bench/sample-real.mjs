/**
 * Draws a stratified sample of a real export for the benchmark.
 *
 *   node eval/bench/sample-real.mjs <sourceDir> <workDir>
 *
 * <sourceDir>/<patient>/<category>/.../*.json → <workDir>/corpus/P<n>/<category>/...
 * Patient folders are renamed P1, P2, … (their names are identifiers; the
 * renamed copy lets outputs map back to inputs). Free-text categories: every
 * file ≤ 150 KB. Other categories: up to 3 files ≤ 60 KB, from different
 * patients where possible. Prints counts only, never names or contents.
 */
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'

const [source, workDir] = process.argv.slice(2)
if (!source || !workDir) throw new Error('usage: sample-real.mjs <sourceDir> <workDir>')
const FREE_TEXT = new Set(['会诊与转诊', '住院病历与病程', '手术与麻醉', '门急诊病历', '住院记录'])

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(path))
    else if (entry.name.endsWith('.json')) out.push(path)
  }
  return out
}

const patients = (await readdir(source, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
  .map((entry) => entry.name).sort()
const files = []
for (const [index, patient] of patients.entries()) {
  for (const path of await walk(join(source, patient))) {
    const rel = relative(join(source, patient), path)
    files.push({ path, patient: `P${index + 1}`, category: rel.split('/')[0], rel, size: (await stat(path)).size })
  }
}
const chosen = []
const byCategory = Map.groupBy(files, (file) => file.category)
for (const [category, list] of byCategory) {
  if (FREE_TEXT.has(category)) {
    chosen.push(...list.filter((file) => file.size <= 150 * 1024))
    continue
  }
  const fit = list.filter((file) => file.size <= 60 * 1024 && file.size >= 2 * 1024).sort((a, b) => b.size - a.size)
  const picked = []
  for (const file of fit) {
    if (picked.length >= 3) break
    if (picked.some((other) => other.patient === file.patient) && fit.some((other) => !picked.includes(other) && !picked.some((p) => p.patient === other.patient))) continue
    picked.push(file)
  }
  chosen.push(...picked)
}
await rm(join(workDir, 'corpus'), { recursive: true, force: true })
const manifest = []
for (const file of chosen) {
  const target = join(workDir, 'corpus', file.patient, file.rel)
  await mkdir(dirname(target), { recursive: true })
  await copyFile(file.path, target)
  manifest.push({ file: join(file.patient, file.rel), patient: file.patient, category: file.category, size: file.size })
}
await writeFile(join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 1), { mode: 0o600 })
const summary = {}
for (const item of manifest) summary[item.category] = (summary[item.category] ?? 0) + 1
console.log(`${manifest.length} files, ${Math.round(manifest.reduce((a, f) => a + f.size, 0) / 1024)} KB, ${patients.length} patients`)
console.log(summary)
