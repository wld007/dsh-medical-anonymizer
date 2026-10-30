/**
 * Build a versioned install directory: node scripts/build.mjs 0.1.2
 * The versioned path is what makes a reinstall load a fresh host module
 * generation without restarting the app (Node caches ESM by file URL).
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!version) {
  console.error('usage: node scripts/build.mjs <version>')
  process.exit(1)
}

const root = fileURLToPath(new URL('..', import.meta.url))
const target = join(root, 'dist', version)
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })

for (const file of [
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'icon.svg',
  'NOTICE',
  'LICENSE',
  'README.md',
]) {
  await cp(join(root, file), join(target, file))
}
for (const dir of ['lib', 'vendor', 'locale', 'assets']) {
  await cp(join(root, dir), join(target, dir), { recursive: true })
}
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
manifest.version = version
await writeFile(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(target)
