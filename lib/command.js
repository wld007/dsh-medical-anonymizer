/**
 * Argument parsing for the /anonymize command.
 */

const VALUE_FLAGS = new Set(['--model', '--endpoint', '--base-url', '--rounds', '--output'])
const SWITCHES = new Set(['--no-think', '--think'])

/**
 * Split a command line into words. Double or single quotes group a word
 * ("/data/Patient Records"); a backslash escapes a following space,
 * quote or backslash (inside double quotes: a quote or backslash). Each word records whether any part was quoted and
 * where it sits in the input.
 */
export function splitWords(input) {
  const text = String(input ?? '')
  const words = []
  let current = null
  let quote = null
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) { quote = null; continue }
      if (ch === '\\' && quote === '"' && i + 1 < text.length && (text[i + 1] === '"' || text[i + 1] === '\\')) { current.text += text[i + 1]; i += 1; continue }
      current.text += ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) { current.end = i; words.push(current); current = null }
      continue
    }
    current ??= { text: '', quoted: false, start: i, end: text.length }
    if (ch === '"' || ch === "'") { quote = ch; current.quoted = true; continue }
    // Only before a space, quote or backslash: other backslashes are kept
    // (Windows paths).
    if (ch === '\\' && i + 1 < text.length && /[\s"'\\]/.test(text[i + 1])) { current.text += text[i + 1]; current.quoted = true; i += 1; continue }
    current.text += ch
  }
  if (quote) throw new Error('引号没有闭合')
  if (current) { current.end = text.length; words.push(current) }
  return words
}

/**
 * Parse `/anonymize <path> [--model 名称] [--endpoint URL] [--rounds N]
 * [--output 目录] [--no-think]`. The path may be quoted; unquoted, every word
 * before the first `--` flag belongs to it, so a folder name with spaces
 * works without quotes too. Returns { inputDir, options } or { error }.
 */
export function parseAnonymizeArgs(rawInput) {
  let words
  try {
    words = splitWords(rawInput)
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
  const firstFlag = words.findIndex((word) => !word.quoted && word.text.startsWith('--'))
  const pathWords = firstFlag === -1 ? words : words.slice(0, firstFlag)
  const rest = firstFlag === -1 ? [] : words.slice(firstFlag)
  if (pathWords.length === 0) return { error: 'missing-input' }
  const raw = String(rawInput ?? '')
  // Unquoted words keep the spacing they had in the input.
  const inputDir = pathWords.length === 1 || pathWords.some((word) => word.quoted)
    ? pathWords.map((word) => word.text).join(' ')
    : raw.slice(pathWords[0].start, pathWords[pathWords.length - 1].end)
  const options = {}
  while (rest.length > 0) {
    const word = rest.shift()
    const token = word.quoted ? null : word.text
    if (token === '--no-think') { options.disableThinking = true; continue }
    if (token === '--think') { options.disableThinking = false; continue }
    if (token && VALUE_FLAGS.has(token)) {
      const value = rest.shift()
      if (!value || (!value.quoted && (VALUE_FLAGS.has(value.text) || SWITCHES.has(value.text)))) return { error: `缺少 ${token} 的值` }
      if (token === '--model') options.model = value.text
      else if (token === '--endpoint' || token === '--base-url') options.baseURL = value.text
      else if (token === '--output') options.outputRoot = value.text
      else options.maxRounds = Number(value.text)
      continue
    }
    return { error: `未知参数 ${word.text}（路径含空格时请用引号括起来）` }
  }
  return { inputDir, options }
}
