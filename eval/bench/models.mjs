/**
 * Model endpoints for the benchmark: environment variables first
 * (DETECT_URL, DETECT_MODEL, VERIFY_URL, VERIFY_MODEL), otherwise the
 * plugin's own settings in the DSH profile (DSH_PROFILE, default "desktop").
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function pluginSettings() {
  try {
    const file = join(homedir(), '.dsh', 'profiles', process.env.DSH_PROFILE ?? 'desktop', 'cordis.patch.yml')
    const text = readFileSync(file, 'utf8')
    const start = text.search(/^- id: medical-anonymizer\s*$/m)
    if (start < 0) return {}
    const rest = text.slice(start + 1)
    const end = rest.search(/^- id: /m)
    const block = end < 0 ? rest : rest.slice(0, end)
    const read = (key) => block.match(new RegExp(`^\\s+${key}:\\s*"?([^"\\n]*)"?\\s*$`, 'm'))?.[1]?.trim() || ''
    return { baseURL: read('baseURL'), model: read('model'), verifyBaseURL: read('verifyBaseURL'), verifyModel: read('verifyModel') }
  } catch {
    return {}
  }
}

const saved = pluginSettings()
export const DETECT = {
  baseURL: process.env.DETECT_URL || saved.baseURL,
  model: process.env.DETECT_MODEL || saved.model,
}
export const VERIFY = {
  baseURL: process.env.VERIFY_URL || saved.verifyBaseURL || DETECT.baseURL,
  model: process.env.VERIFY_MODEL || saved.verifyModel || DETECT.model,
}
if (!DETECT.baseURL || !DETECT.model) throw new Error('模型端点未配置：设置 DETECT_URL / DETECT_MODEL，或在插件设置中配置模型')
