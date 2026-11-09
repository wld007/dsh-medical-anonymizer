/**
 * Public-release hygiene check. Scans tracked text files for personal paths,
 * private network addresses, local package scopes, and dataset identifiers.
 *
 * Run: npm run check:public
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const skipDirs = new Set(['.claude', 'node_modules', 'dist', '.git', '.tmp', 'vendor'])
const skipFiles = new Set([
  'scripts/check-public.mjs',
  'scripts/check-public.local.json',
  'PUBLISHING.md',
  'package-lock.json',
  'pnpm-lock.yaml',
])
const textExtensions = new Set(['.js', '.mjs', '.json', '.yml', '.yaml', '.md', '.txt'])
const patterns = [
  { name: 'absolute user path', re: /\/Users\/|\/home\/|[A-Za-z]:\\Users\\/ },
  { name: 'private IPv4', re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/ },
  { name: 'local package scope', re: /@local\// },
]

// Private identifiers (internal dataset ids, model names, ...) live in an
// untracked file so the patterns themselves are never published.
// Format: [{ "name": "...", "pattern": "regex source" }]
const localPatternsFile = join(root, 'scripts', 'check-public.local.json')
if (existsSync(localPatternsFile)) {
  for (const { name, pattern } of JSON.parse(readFileSync(localPatternsFile, 'utf8'))) {
    patterns.push({ name, re: new RegExp(pattern) })
  }
}

const findings = []

function scanFile(path) {
  const rel = relative(root, path).split(sep).join('/')
  if (skipFiles.has(rel)) return
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return
  }
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    for (const pattern of patterns) {
      if (pattern.re.test(line)) {
        findings.push(`${rel}:${index + 1}: ${pattern.name}: ${line.trim().slice(0, 120)}`)
      }
    }
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue
      walk(join(dir, entry.name))
      continue
    }
    if (!entry.isFile()) continue
    const path = join(dir, entry.name)
    if (entry.name.endsWith('.png') || entry.name.endsWith('.xlsx')) continue
    const ext = entry.name.slice(entry.name.lastIndexOf('.'))
    if (!textExtensions.has(ext)) continue
    if (statSync(path).size > 2_000_000) continue
    scanFile(path)
  }
}

walk(root)

if (findings.length > 0) {
  console.error(`FAIL: ${findings.length} public-release finding(s)`)
  for (const finding of findings) console.error(`  ${finding}`)
  process.exit(1)
}
console.log('PUBLIC CHECK PASS: no personal paths, private addresses, or local scopes')
