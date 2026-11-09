/**
 * Minimal OpenAI-compatible client for local runtimes (Ollama, LM Studio,
 * llama.cpp, vLLM). Only `/chat/completions` and `/models` are used.
 */

export class LlmError extends Error {
  constructor(message, code = 'llm-error', status) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.status = status
  }
}

export const DETECT_TYPES = [
  '姓名', '医生', '身份证号', '电话', '邮箱', '地址',
  '病历号', '住院号', '就诊号', '社保号', '银行卡号', '医院',
]

export function detectPrompt(segments) {
  return [
    {
      role: 'user',
      content: `任务：找出下面每段文本中所有能直接识别个人身份的信息。

允许的类型（只能从中选择）：${DETECT_TYPES.join('、')}
输出格式：{"e":[["段id","类型","原文片段"]]}，每个实体一个三元数组；没有时输出 {"e":[]}
硬性要求：
1. 原文片段必须逐字摘自对应段落，不得改写、缩写、翻译或补全。
2. 同一实体在同一段只输出一次；同一段可有多个实体。
3. 不确定的不要输出；不要输出年龄、性别、日期、诊断、科室等非直接标识符。
4. 科室、病区、病房名称（如“内一科(肾脏病科)(11病区)”）不是医院；证件类型（如“居民身份证”）、各类代码和床号不是标识符。
5. 段落可能带有 field（字段名），可用来判断含义。
6. 只输出 JSON。

段落：${JSON.stringify(segments)}`,
    },
  ]
}

/**
 * Verification as an outside reviewer: the model sees only the anonymized
 * text, not what detection found or which pseudonyms were used, and is asked
 * to re-identify people from it.
 */
export function verifyPrompt(segments) {
  return [
    {
      role: 'user',
      content: `你是一名独立的数据安全审查员。下面是一批已经做过脱敏处理的病历文本，你事先不知道其中原来有哪些个人信息、被替换了哪些。
任务：尝试从这些文本中重新认出具体的人，找出所有仍能直接识别个人身份的内容。

可报告的类型：${DETECT_TYPES.join('、')}
输出格式：{"issues":[{"segment":"段id","type":"类型","text":"残留原文","reason":"简短原因"}]}
没有发现时输出 {"issues":[]}
要求：
1. 主动查找：自由文本中的人名（含家属、陪同人、医护人员）、证件号码、电话、邮箱、具体住址、病历号/住院号/就诊号、社保号、银行卡号、具体医院名称，包括被拆开、夹在句子里或写法不规范的。
2. text 必须逐字摘自段落；只报告确实存在的内容，不要推测。
3. 已脱敏的值不要报告：假名的格式是“类型标签-6 位以上十六进制”（如“化名-9F3A2C”“证件-1F0B67”“电话-3A91C0”），占位符形如“[姓名]”“[电话]”，遮盖值含有 *（如“张*”“138****8000”）。
4. 不要报告年龄、性别、日期、诊断、药品、检查项目、科室/病区名称、职称、证件类型、各类代码、床号等非直接标识符。
5. 段落可能带有 field（字段名），可用来判断含义。
6. 只输出 JSON。

段落：${JSON.stringify(segments)}`,
    },
  ]
}

/**
 * Field profiling for structured data: one decision per column instead of
 * one per value. The model sees the field name, simple statistics and a few
 * sample values.
 */
export function profilePrompt(fields) {
  return [
    {
      role: 'user',
      content: `任务：下面是一份结构化医疗数据（表格 / JSON）中的若干字段，每个字段给出字段名、统计信息和部分取值样例。请判断每个字段整体属于哪一类。

类别：
- identifier：该字段每个值都是能直接识别个人或机构的信息（如患者姓名、医生姓名、身份证号、电话、住址、病历号 / 住院号 / 就诊号、社保号、银行卡号、医院名称），需同时给出 type
- vocabulary：临床或管理用的通用词表（如诊断名称、药品名称、检验 / 检查项目、科室名称、单位、频次、给药途径、状态、类别），不指向具体个人
- code：编码或代码值（如 ICD 编码、项目编码、内部代码），不指向具体个人
- freetext：自由文本（病程、主诉、备注、描述），其中可能夹带个人信息
- uncertain：无法确定
type 只能从中选择：${DETECT_TYPES.join('、')}
输出格式：{"fields":[{"field":"字段名","category":"类别","type":"类型或空","reason":"简短原因"}]}
只要样例里有一个值可能是具体人名或个人信息，就不要判为 vocabulary / code；拿不准时选 uncertain。只输出 JSON。

字段：${JSON.stringify(fields)}`,
    },
  ]
}

/**
 * Round 2+: the detection model rules on what the verifier reported, so a
 * verifier false positive (a ward name, a drug) is not replaced blindly.
 */
export function adjudicatePrompt(candidates) {
  return [
    {
      role: 'user',
      content: `任务：另一位审查员认为下列文字可能仍是能直接识别个人身份的信息。请结合上下文逐条判断它是否确实是直接标识符。

类型范围：${DETECT_TYPES.join('、')}
判断为是：具体某个人的姓名、证件号、电话、邮箱、住址、病历号/住院号/就诊号、社保号、银行卡号、具体医院名称。
判断为否：科室/病区/病房名称、药品、检查项目、诊断、职称、机构类别、证件类型、各类代码、通用词，以及已脱敏的值（假名形如“化名-9F3A2C”，占位符形如“[姓名]”，含 * 的遮盖值）。
输出格式：{"verdicts":[{"i":序号,"identifier":true或false,"type":"类型","reason":"简短原因"}]}
每条候选都必须给出结论；只输出 JSON。

候选：${JSON.stringify(candidates)}`,
    },
  ]
}

/**
 * Entities from a detection reply, as [{ segment, type, text }]. Accepts the
 * compact form {"e":[["id","类型","原文"]]} and the older object form
 * {"entities":[{"segment","type","text"}]} (cached replies, other models).
 */
export function entitiesOf(json) {
  const list = Array.isArray(json?.e) ? json.e : Array.isArray(json?.entities) ? json.entities : []
  const out = []
  for (const item of list) {
    if (Array.isArray(item)) {
      if (item.length >= 3) out.push({ segment: String(item[0] ?? ''), type: String(item[1] ?? ''), text: String(item[2] ?? '') })
    } else if (item && typeof item === 'object') {
      out.push({ segment: String(item.segment ?? ''), type: String(item.type ?? ''), text: String(item.text ?? '') })
    }
  }
  return out
}

export function createLlm(options) {
  const baseURL = String(options.baseURL ?? '').replace(/\/+$/, '')
  const model = String(options.model ?? '')
  const apiKey = String(options.apiKey ?? '')
  const timeoutMs = Number(options.timeoutMs ?? 120000)
  const temperature = Number(options.temperature ?? 0)
  const jsonMode = options.jsonMode === true
  // Reasoning models (Qwen3 and friends) otherwise spend the whole token
  // budget on hidden reasoning: slow, and `content` can come back empty.
  const disableThinking = options.disableThinking === true

  function headers() {
    const result = { 'content-type': 'application/json' }
    if (apiKey) result.authorization = `Bearer ${apiKey}`
    return result
  }

  async function request(path, body, signal) {
    if (!baseURL) throw new LlmError('未配置模型端点（baseURL）', 'no-base-url')
    if (!model) throw new LlmError('未配置模型名称（model）', 'no-model')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('模型请求超时')), timeoutMs)
    const signals = [controller.signal, signal].filter(Boolean)
    const combined = AbortSignal.any(signals)
    try {
      const response = await fetch(`${baseURL}${path}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: combined,
      })
      const text = await response.text()
      let parsed = null
      try { parsed = text ? JSON.parse(text) : null } catch { /* keep raw */ }
      if (!response.ok) {
        const detail = parsed?.error?.message ?? parsed?.message ?? text.slice(0, 400)
        throw new LlmError(`模型端点返回 ${response.status}: ${detail}`, 'http-error', response.status)
      }
      return parsed
    } catch (error) {
      if (error instanceof LlmError) throw error
      if (error?.name === 'AbortError') throw new LlmError('模型请求已取消或超时', 'aborted')
      throw new LlmError(`无法连接模型端点: ${error?.message ?? String(error)}`, 'network')
    } finally {
      clearTimeout(timer)
    }
  }

  async function chat(messages, { signal, maxTokens = 2000, forceJson = false } = {}) {
    const body = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }
    if (jsonMode || forceJson) body.response_format = { type: 'json_object' }
    if (disableThinking) {
      // vLLM / SGLang read this from the chat template; servers that do not
      // understand it simply ignore the extra field.
      body.chat_template_kwargs = { ...(body.chat_template_kwargs ?? {}), enable_thinking: false }
    }
    let data
    try {
      data = await request('/chat/completions', body, signal)
    } catch (error) {
      // Some local servers reject response_format or chat_template_kwargs;
      // retry once without the optional fields before giving up.
      if (error?.status === 400 && (body.response_format || body.chat_template_kwargs)) {
        delete body.response_format
        delete body.chat_template_kwargs
        data = await request('/chat/completions', body, signal)
      } else {
        throw error
      }
    }
    const content = messageText(data)
    if (!content) throw new LlmError('模型返回了空内容', 'empty-response')
    return { text: content, usage: data?.usage ?? null, model: data?.model ?? model }
  }

  async function chatJson(messages, opts = {}) {
    let lastError = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const reply = await chat(messages, { ...opts, forceJson: true })
        const json = extractJson(reply.text)
        if (json === null) {
          lastError = new LlmError('模型输出不是有效 JSON', 'bad-json')
          continue
        }
        return { json, text: reply.text, usage: reply.usage }
      } catch (error) {
        lastError = error
        if (error?.code === 'aborted' || opts.signal?.aborted) break
        if (error?.status && error.status < 500 && error.status !== 408 && error.status !== 429) break
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
      }
    }
    throw lastError ?? new LlmError('模型调用失败', 'llm-failed')
  }

  async function listModels(signal) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), Math.min(timeoutMs, 15000))
    try {
      const response = await fetch(`${baseURL}/models`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
        signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]),
      })
      const data = await response.json()
      return (data?.data ?? []).map((item) => item.id).filter(Boolean)
    } catch (error) {
      throw new LlmError(`无法读取模型列表: ${error?.message ?? String(error)}`, 'network')
    } finally {
      clearTimeout(timer)
    }
  }

  return { chat, chatJson, listModels, baseURL, model }
}

function messageText(data) {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('').trim()
  }
  return ''
}

/** Extract the first balanced JSON value from a possibly chatty reply. */
export function extractJson(text) {
  if (typeof text !== 'string') return null
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try { return JSON.parse(cleaned) } catch { /* scan below */ }
  const start = cleaned.search(/[[{]/)
  if (start === -1) return null
  const open = cleaned[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}
