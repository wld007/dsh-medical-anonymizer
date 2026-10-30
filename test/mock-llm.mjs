/**
 * Deterministic OpenAI-compatible mock used to exercise the full pipeline
 * without a local model. It intentionally "misses" 刘建国 on first sight so
 * the verification → repair round is covered.
 */
import http from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 18123)
const seen = new Set()
let detectCalls = 0
let verifyCalls = 0

const NAME_LABEL = /(?:姓名|患者|病人|联系人|医师|医生|接诊医师)\s*[：:]\s*([\u4e00-\u9fa5]{2,4})/g
const NAME_PROSE = /(?:患者)([\u4e00-\u9fa5]{2,3})(?=[，,。；;、\s]|于|因|男|女)/g

function detect(segments) {
  const entities = []
  let skipped = false
  for (const segment of segments) {
    const text = String(segment.text ?? '')
    const add = (type, value) => {
      if (!value) return
      if (value === '刘建国' && !seen.has('刘建国')) { skipped = true; return }
      entities.push({ segment: segment.id, type, text: value, context: text.slice(0, 20) })
    }
    for (const match of text.matchAll(/(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])/g)) add('身份证号', match[0])
    for (const match of text.matchAll(/(?<!\d)1[3-9]\d{9}(?!\d)/g)) add('电话', match[0])
    for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) add('邮箱', match[0])
    for (const match of text.matchAll(NAME_LABEL)) add('姓名', match[1])
    for (const match of text.matchAll(NAME_PROSE)) add('姓名', match[1])
    for (const match of text.matchAll(/(?:家庭住址|住址|地址)\s*[：:]\s*([^\n，。；;]{4,60})/g)) add('地址', match[1])
    for (const match of text.matchAll(/(?:病历号|住院号|就诊号|门诊号)\s*[：:]\s*([A-Za-z0-9-]{4,24})/g)) {
      add(text.includes(`住院号${match[1]}`) ? '住院号' : '病历号', match[1])
    }
  }
  if (skipped) seen.add('刘建国')
  return entities
}

function verify(segments) {
  const issues = []
  for (const segment of segments) {
    if (String(segment.text).includes('刘建国')) {
      issues.push({ segment: segment.id, type: '姓名', text: '刘建国', reason: '姓名仍以明文出现' })
    }
  }
  return issues
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'mock-medical' }] }))
    return
  }
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end()
    return
  }
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    try {
      const payload = JSON.parse(body)
      const content = payload.messages?.map((message) => message.content).join('\n') ?? ''
      const marker = content.lastIndexOf('段落：')
      const segments = marker === -1 ? [] : JSON.parse(content.slice(marker + 3))
      let result
      if (content.includes('任务：找出')) {
        detectCalls += 1
        result = { entities: detect(segments) }
      } else {
        verifyCalls += 1
        result = { issues: verify(segments) }
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        model: 'mock-medical',
        choices: [{ message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 200, completion_tokens: 60, total_tokens: 260 },
      }))
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: String(error) } }))
    }
  })
})

server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write(`mock-llm listening on http://127.0.0.1:${PORT}/v1 (detect=${detectCalls}, verify=${verifyCalls})\n`)
})

process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.on('SIGINT', () => server.close(() => process.exit(0)))
