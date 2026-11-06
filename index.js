/**
 * Host half of the medical data anonymizer bundle.
 *
 * Registers six agent tools, one /anonymize command, and one authenticated
 * browser RPC channel. Every caller shares the same service methods.
 */
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createService } from './lib/service.js'

/**
 * Native "choose file" dialog on the machine running the Harness (macOS).
 * The browser's own folder picker cannot select a single file, and a file
 * input would only give the page a name, not a path. Returns null on cancel.
 */
function pickFile() {
  if (process.platform !== 'darwin') {
    return Promise.reject(new Error('选择单个文件目前只支持 macOS；请直接在输入框里填写文件的完整路径'))
  }
  const script = 'POSIX path of (choose file with prompt "选择要匿名化的文件（txt/md/csv/json/xlsx/zip/DICOM）")'
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 10 * 60 * 1000 }, (error, stdout, stderr) => {
      if (error) {
        // -128: the user pressed Cancel.
        if (/-128/.test(String(stderr)) || /-128/.test(String(error.message))) resolve(null)
        else reject(new Error(String(stderr || error.message).trim()))
        return
      }
      resolve(String(stdout).replace(/\n$/, '').trim() || null)
    })
  })
}

export const name = 'medical-anonymizer'
export const inject = ['tools']

const CHANNEL = '/medical-anonymizer'
const ENTRY_ID = 'medical-anonymizer'

export function apply(ctx, config = {}) {
  const workingDirectory = ctx.get('workingDirectory')
  const defaultDirectory = workingDirectory?.defaultDirectory ?? process.cwd()
  // Small plugin state (remembered output roots) lives with the profile.
  const stateDir = process.env.DSH_PROFILE_DIR
    ? join(process.env.DSH_PROFILE_DIR, 'plugin-data', 'medical-anonymizer')
    : join(homedir(), '.dsh', 'plugin-data', 'medical-anonymizer')
  const service = createService({ config, defaultDirectory, stateDir })

  ctx.tools.register(tool({
    name: 'anonymize_start',
    description: 'dsh-medical-anonymizer 插件：批量匿名化医疗数据（txt/md/csv/json/xlsx，以及 zip 压缩包：解压到临时目录处理后重新打包，原包只读），把直接标识符替换为稳定假名并生成报告，文件结构不变；文件名和目录名里的姓名、证件号、病人编号、住院号/门诊号也会替换；文件很多时自动分组，不丢文件；绝不修改源文件。DICOM 影像（如 CT）只处理元数据：删除姓名与各类 ID、PatientID 换成不可回查的随机编号、UID 重新生成、日期整体平移，像素原样保留，且不经过模型。完成后交付数据（与输入同名、名称中的标识符已替换的文件夹或文件）直接放在输出根目录下，报告、映射库等记录统一放在输出根目录的 _records 里。病历原文只发往用户在插件设置中配置的模型端点（通常为本机或内网）；未配置模型时只在本机用规则处理。立即返回批次 id。',
    parameters: {
      inputDir: { type: 'string', required: true, description: '待处理的目录或单个文件（含 .zip）的绝对路径（或相对当前工作区的路径）。传单个文件时只处理该文件。' },
      outputRoot: { type: 'string', description: '输出根目录，不能与输入目录相同；交付数据直接放在它下面，记录放在其中的 _records。省略时用设置里的默认值，再缺省则为输入目录（或输入文件）旁的 _medical-anonymizer。' },
      maxRounds: { type: 'number', description: '发现-复核的最大轮次（1–6）；省略时用设置里的默认值。' },
    },
    // Model endpoint, model, key and thinking mode always come from the user's
    // saved settings: the agent cannot redirect patient text elsewhere.
    execute: async (args, exec) => service.start({
      inputDir: args.inputDir,
      outputRoot: args.outputRoot,
      maxRounds: args.maxRounds,
      source: { kind: 'agent', sessionId: sessionIdOf(exec?.agent) },
    }),
    render: (args, value) => [{
      type: 'text',
      text: value.modelConfigured
        ? `已启动批次 ${value.runId}（模型 ${value.model}）。用 anonymize_status 查看进度。`
        : `已启动批次 ${value.runId}（未配置模型，仅规则层）。用 anonymize_status 查看进度。`,
    }],
  }))

  ctx.tools.register(tool({
    name: 'anonymize_cancel',
    description: '取消正在运行的匿名化批次（省略 runId 时取消当前批次）。已写出的部分结果保留在 _records/runs/<批次>/output（不放到输出根目录），报告状态记为已取消。',
    parameters: {
      runId: { type: 'string', description: '批次 id；省略则取消当前正在运行的批次。' },
    },
    execute: async (args) => service.cancel(args.runId),
    render: (args, value) => [{
      type: 'text',
      text: value.cancelled
        ? `已请求取消批次 ${value.runId}（正在中断模型调用，报告记为已取消）。`
        : `没有取消：${value.reason ?? '当前没有运行中的批次'}`,
    }],
  }))

  ctx.tools.register(tool({
    name: 'anonymize_undo_mappings',
    description: '撤销某个匿名化批次新增到映射库里的"原值→假名"对应关系（例如发现规则误判后清理）。只改映射库，不删除该批次的输出文件；之后重跑会重新生成映射。',
    parameters: {
      runId: { type: 'string', required: true, description: '要撤销映射的批次 id。' },
    },
    execute: async (args) => service.undoMappings(args.runId),
    render: (args, value) => [{
      type: 'text',
      text: `已从映射库移除批次 ${value.runId} 新增的 ${value.removed} 条映射（${value.vaultPath}）。该批次的输出文件未改动。`,
    }],
  }))

  ctx.tools.register(tool({
    name: 'anonymize_status',
    description: '查看匿名化批次的状态、进度、实体统计与未解决问题。省略 runId 时查看最近一批。',
    parameters: {
      runId: { type: 'string', description: '批次 id；省略则取最近一批。' },
    },
    execute: async (args) => {
      const { run, active } = await service.status(args.runId)
      if (!run) return { found: false, active }
      // CT batches can hold tens of thousands of slices: list files with
      // problems first and cap the rest.
      const allFiles = run.files ?? []
      const noisy = allFiles.filter((file) => file.status !== 'clean' || (file.issues ?? []).length > 0)
      const quiet = allFiles.filter((file) => !noisy.includes(file))
      const listed = [...noisy.slice(0, 100), ...quiet.slice(0, Math.max(0, 50 - Math.min(noisy.length, 50)))]
      return {
        found: true,
        active,
        run: {
          id: run.id,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          inputDir: run.inputDir,
          runDir: run.runDir,
          output: run.output ?? null,
          config: run.config,
          totals: run.totals,
          filesOmitted: allFiles.length - listed.length,
          files: listed.map((file) => ({
            relPath: file.relPath,
            status: file.status,
            rounds: file.rounds,
            entities: (file.entities ?? []).reduce((sum, entity) => sum + entity.count, 0),
            issues: (file.issues ?? []).filter((issue) => issue.severity === 'error').length,
            warnings: (file.issues ?? []).filter((issue) => issue.severity === 'warn').length,
          })),
          batchWarnings: run.warnings ?? [],
          ...(run.current ? { current: run.current } : {}),
          ...(run.error ? { error: run.error } : {}),
        },
      }
    },
    render: (args, value) => {
      if (!value.found) return [{ type: 'text', text: '还没有匿名化批次。' }]
      const run = value.run
      const lines = [
        `批次 ${run.id}: ${run.status}`,
        `文件 ${run.totals?.files ?? 0} 个，实体 ${run.totals?.entities ?? 0} 处，待复核 ${run.totals?.unresolved ?? 0} 项`,
        `模型 ${run.config?.model || '未配置'}，调用 ${run.totals?.modelCalls ?? 0} 次`,
      ]
      if (run.status === 'running' && run.current) {
        const current = run.current
        lines.push(`进行中：${current.file}${current.round ? ` 第 ${current.round} 轮` : ''}·${current.step}（已调用模型 ${current.modelCalls ?? 0} 次）`)
      }
      for (const warning of run.batchWarnings ?? []) lines.push(`⚠️ ${warning}`)
      for (const file of run.files ?? []) {
        lines.push(`- ${file.relPath}: ${file.status}，${file.entities} 处，${file.issues} 个错误 / ${file.warnings} 个提示`)
      }
      if (run.filesOmitted > 0) lines.push(`…另有 ${run.filesOmitted} 个文件全部通过，未逐一列出`)
      if (value.active) lines.push(`（批次 ${value.active} 正在运行）`)
      return [{ type: 'text', text: lines.join('\n') }]
    },
  }))

  ctx.tools.register(tool({
    name: 'anonymize_report',
    description: '读取匿名化批次的 Markdown 报告（汇总、文件明细、残留问题、人工复核清单）。',
    parameters: {
      runId: { type: 'string', description: '批次 id；省略则取最近一批。' },
    },
    execute: async (args) => service.report(args.runId),
    render: (args, value) => {
      const text = String(value.markdown ?? '')
      const clipped = text.length > 6000 ? `${text.slice(0, 6000)}\n\n…（报告较长，完整内容见 ${value.path}）` : text
      return [{ type: 'text', text: clipped }]
    },
  }))

  ctx.tools.register(tool({
    name: 'anonymize_runs',
    description: '列出最近的匿名化批次（时间、状态、文件数、实体数、待复核数）。',
    parameters: {},
    execute: async () => service.list(),
    render: (args, value) => {
      if (!value.runs?.length) return [{ type: 'text', text: '还没有批次。' }]
      return [{
        type: 'text',
        text: value.runs.map((run) =>
          `${run.id}  ${run.startedAt}  ${run.status}  文件 ${run.files}  实体 ${run.entities}  待复核 ${run.unresolved}`,
        ).join('\n'),
      }]
    },
  }))

  ctx.inject(['commands'], (cmdCtx) => {
    const dispose = cmdCtx.commands.register({
      name: 'anonymize',
      description: '批量匿名化医疗数据：/anonymize <目录或文件> [--model 名称] [--endpoint URL] [--rounds N] [--output 目录] [--no-think]',
      input: { hint: '目录或文件 [--model 名称] [--endpoint URL] [--rounds N] [--output 目录] [--no-think]' },
      handler: async (invocation) => {
        const usage = '用法：/anonymize <输入目录或文件> [--model 名称] [--endpoint URL] [--rounds N] [--output 目录] [--no-think]'
        const tokens = String(invocation.rawInput ?? '').trim().split(/\s+/).filter(Boolean)
        const inputDir = tokens.shift()
        if (!inputDir) return { kind: 'error', text: usage }
        const request = { inputDir, source: { kind: 'command', sessionId: sessionIdOf(invocation.agent) } }
        while (tokens.length > 0) {
          const token = tokens.shift()
          if (token === '--no-think') { request.disableThinking = true; continue }
          if (token === '--think') { request.disableThinking = false; continue }
          if (token === '--model' || token === '--endpoint' || token === '--base-url' || token === '--rounds' || token === '--output') {
            const value = tokens.shift()
            if (!value) return { kind: 'error', text: `缺少 ${token} 的值。${usage}` }
            if (token === '--model') request.model = value
            else if (token === '--endpoint' || token === '--base-url') request.baseURL = value
            else if (token === '--output') request.outputRoot = value
            else request.maxRounds = Number(value)
            continue
          }
          return { kind: 'error', text: `未知参数 ${token}。${usage}` }
        }
        try {
          const info = await service.start(request)
          return {
            kind: 'success',
            text: `已启动批次 ${info.runId}，模型 ${info.model || '未配置（仅规则层）'}${info.disableThinking ? '，思考模式已关闭' : ''}。输入 ${info.inputDir}。用 anonymize_status 查看进度。`,
          }
        } catch (error) {
          return { kind: 'error', text: String(error?.message ?? error) }
        }
      },
    })
    cmdCtx.effect(() => dispose, 'medical-anonymizer: /anonymize command')
  })

  ctx.inject(['connection', 'webServer'], (rpcCtx) => {
    const route = {
      kind: 'prefix',
      path: CHANNEL,
      handler: async (req, res) => {
        const admission = rpcCtx.connection.admit(req)
        if ('rejection' in admission) {
          res.writeHead(admission.rejection)
          res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        const endpoint = new URL(req.url ?? '/', 'http://x').pathname.slice(CHANNEL.length + 1)
        if (!endpoint) {
          res.writeHead(404)
          res.end()
          return
        }
        if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          res.writeHead(415)
          res.end()
          return
        }
        let body
        try {
          const chunks = []
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > 1_000_000) throw new Error('request body too large')
            chunks.push(chunk)
          }
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: String(error?.message ?? error) }))
          return
        }
        const rpcId = typeof body?.rpcId === 'string' ? body.rpcId : 'invalid-request'
        if (body?.type !== 'client-request' || body?.method !== endpoint) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: false, error: { code: 'bad-request', message: 'invalid client-request envelope', details: {} } } }))
          return
        }
        const result = await dispatch(endpoint, body.payload)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'server-response', rpcId, result }))
      },
    }
    rpcCtx.effect(() => rpcCtx.webServer.register(route), 'medical-anonymizer: rpc route')
  })

  /**
   * Persist page defaults into the profile's own patch layer through the
   * Harness config editor. That layer outranks the bundle's defaults, so the
   * values survive restarts and plugin reinstalls. Saving re-applies this
   * plugin, so it is refused while a batch is running.
   *
   * User-only: no agent tool exposes this, because it changes where every
   * future batch sends patient text.
   */
  async function saveDefaults(request) {
    if (service.isRunning()) throw new Error('有批次正在运行；请等它完成或取消后再保存默认配置')
    const patch = service.normalizeDefaults(request)
    const editor = ctx.get('configEditor')
    if (!editor?.edit || !editor?.entries) {
      throw new Error('当前 DSH 不支持从页面保存配置；请在 profile 的 cordis.patch.yml 中修改 medical-anonymizer 的 config')
    }
    const entries = editor.entries()
    let entry
    try { entry = entries.find((item) => item.fiber === ctx.fiber) } catch { /* fall back to id */ }
    entry ??= entries.find((item) => item.options?.id === ENTRY_ID)
    if (!entry) throw new Error(`找不到插件配置行 ${ENTRY_ID}`)
    await editor.edit(entry, (current) => ({ ...current, ...patch }))
    return { saved: true, config: patch }
  }

  async function dispatch(endpoint, payload) {
    try {
      const request = payload && typeof payload === 'object' ? payload : {}
      switch (endpoint) {
        case 'config':
          return { ok: true, value: service.configInfo() }
        case 'ping':
          return { ok: true, value: await service.ping(request) }
        case 'list':
          return { ok: true, value: await service.list() }
        case 'status':
          return { ok: true, value: await service.status(request.runId) }
        case 'report':
          return { ok: true, value: await service.report(request.runId) }
        case 'cancel':
          return { ok: true, value: await service.cancel(request.runId) }
        case 'undoMappings':
          return { ok: true, value: await service.undoMappings(request.runId) }
        case 'deleteRun':
          return { ok: true, value: await service.deleteRun(request.runId, { deliverable: request.deliverable === true }) }
        case 'calls':
          return { ok: true, value: await service.calls(request.runId, request.since) }
        case 'start':
          // The page is the only RPC caller that starts batches.
          return { ok: true, value: await service.start({ ...request, source: { kind: 'panel' } }) }
        case 'advice':
          return { ok: true, value: await service.advice(request.runId) }
        case 'pickFile':
          return { ok: true, value: { path: await pickFile() } }
        case 'saveDefaults':
          return { ok: true, value: await saveDefaults(request) }
        default:
          return { ok: false, error: { code: 'unknown-endpoint', message: `未知方法: ${endpoint}`, details: {} } }
      }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'medical-anonymizer',
          message: String(error?.message ?? error),
          details: {},
        },
      }
    }
  }

}

function sessionIdOf(agent) {
  try {
    const id = agent?.session?.id
    return typeof id === 'string' ? id : undefined
  } catch {
    return undefined
  }
}

function tool(def) {
  return {
    name: def.name,
    description: def.description,
    parameters: toJsonSchema(def.parameters ?? {}),
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: def.render ?? ((args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]),
    },
    execute: def.execute,
  }
}

function toJsonSchema(parameters) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(parameters)) {
    const property = { type: spec.type }
    if (spec.description) property.description = spec.description
    if (spec.enum) property.enum = spec.enum
    properties[key] = property
    if (spec.required) required.push(key)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}
