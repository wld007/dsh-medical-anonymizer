/**
 * Visual report (one self-contained HTML file, inline SVG, no network).
 *
 *   node eval/bench/report.mjs <syntheticWorkDir> <realWorkDir> <out.html>
 *
 * Reads <syntheticWorkDir>/score.json (gold-labelled synthetic corpus) and
 * <realWorkDir>/real-score.json (real export, model-judged reference). Both
 * hold aggregates only; the report contains no original record text.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [synDir, realDir, outFile] = process.argv.slice(2)
const syn = JSON.parse(await readFile(join(synDir, 'score.json'), 'utf8'))
let real = null
try { real = JSON.parse(await readFile(join(realDir, 'real-score.json'), 'utf8')) } catch { /* synthetic only */ }

const NAMES = {
  rules: '仅规则',
  model: '仅模型',
  'rules+model': '规则 + 识别模型',
  'full@old': '三层（修复前）',
  full: '三层（修复后）',
  'full-same': '三层·同模型核验',
}
const SHORT = { rules: '规则', model: '模型', 'rules+model': '规则+模型', 'full@old': '修复前', full: '修复后', 'full-same': '同模型核验' }
const COLORS = {
  rules: '#9aa5b1', model: '#e0a33b', 'rules+model': '#5b8def', 'full@old': '#8fb9a8', full: '#1f9d74', 'full-same': '#7d6bd6',
}
const ORDER = ['rules', 'model', 'rules+model', 'full-same', 'full@old', 'full']
const ordered = (obj) => ORDER.filter((key) => obj[key])
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const pct = (x, digits = 1) => (x === null || x === undefined ? '—' : `${(100 * x).toFixed(digits)}%`)
const k = (n) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const secs = (ms) => (ms === undefined ? '—' : ms >= 60000 ? `${(ms / 60000).toFixed(1)} 分` : `${Math.round(ms / 1000)} 秒`)
const tokensOf = (run) => (run?.models?.detect?.tokens ?? 0) + (run?.models?.verify?.tokens ?? 0)
const callsOf = (run) => (run?.models?.detect?.calls ?? 0) + (run?.models?.verify?.calls ?? 0)

/** Horizontal bars. rows: [{ key, value, label }] */
function hbars(rows, { max = Math.max(1, ...rows.map((r) => r.value)), width = 560, unit = '' } = {}) {
  const rowH = 30
  const left = 150
  const h = rows.length * rowH + 10
  const bars = rows.map((row, i) => {
    const w = Math.max(2, ((width - left - 210) * row.value) / max)
    const y = 5 + i * rowH
    return `<text x="${left - 10}" y="${y + 19}" text-anchor="end" class="lbl">${esc(NAMES[row.key] ?? row.key)}</text>
      <rect x="${left}" y="${y + 4}" width="${w}" height="20" rx="3" fill="${COLORS[row.key] ?? '#888'}"/>
      <text x="${left + w + 6}" y="${y + 19}" class="val">${esc(row.label ?? `${row.value}${unit}`)}</text>`
  }).join('')
  return `<svg viewBox="0 0 ${width} ${h}" width="100%" style="max-width:${width}px">${bars}</svg>`
}

/** Cost vs. leaks scatter: x = tokens, y = leak rate. */
function scatter(points, { title = '' } = {}) {
  const W = 560
  const H = 300
  const pad = { l: 60, r: 20, t: 20, b: 44 }
  const maxX = Math.max(1, ...points.map((p) => p.x)) * 1.1
  const maxY = Math.max(0.01, ...points.map((p) => p.y)) * 1.15
  const sx = (x) => pad.l + ((W - pad.l - pad.r) * x) / maxX
  const sy = (y) => H - pad.b - ((H - pad.t - pad.b) * y) / maxY
  const ticksY = [0, maxY / 2, maxY].map((y) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(y)}" y2="${sy(y)}" class="grid"/><text x="${pad.l - 6}" y="${sy(y) + 4}" text-anchor="end" class="axis">${pct(y, 1)}</text>`).join('')
  const ticksX = [0, maxX / 2, maxX].map((x) => `<text x="${sx(x)}" y="${H - pad.b + 16}" text-anchor="middle" class="axis">${k(Math.round(x))}</text>`).join('')
  const dots = points.map((p) => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="7" fill="${COLORS[p.key]}" fill-opacity="0.85" stroke="#fff" stroke-width="1.5"><title>${esc(NAMES[p.key])}：${k(Math.round(p.x))} tokens，泄漏率 ${pct(p.y, 2)}</title></circle>`).join('')
  const legend = `<div class="legend">${points.map((p) => `<span><span class="dot" style="background:${COLORS[p.key]}"></span>${esc(NAMES[p.key])} <span class="muted">${k(Math.round(p.x))} · ${pct(p.y, 1)}</span></span>`).join('')}</div>`
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${ticksY}${ticksX}
    <text x="${(W + pad.l) / 2}" y="${H - 6}" text-anchor="middle" class="axis">模型 tokens（越左越省）</text>
    <text x="14" y="${H / 2}" text-anchor="middle" class="axis" transform="rotate(-90 14 ${H / 2})">泄漏率（越低越好）</text>
    ${dots}${title ? `<text x="${pad.l}" y="12" class="axis">${esc(title)}</text>` : ''}</svg>${legend}`
}

/** Table with cells shaded by value (0 = white). */
function heat(rowsLabel, rows, cols, cell, { total = null } = {}) {
  const max = Math.max(1, ...rows.flatMap((row) => cols.map((col) => cell(row, col) ?? 0)))
  const head = `<tr><th>${esc(rowsLabel)}</th>${total ? '<th class="num">n</th>' : ''}${cols.map((col) => `<th class="num" title="${esc(NAMES[col])}" style="border-bottom:3px solid ${COLORS[col]}">${esc(SHORT[col] ?? NAMES[col])}</th>`).join('')}</tr>`
  const body = rows.map((row) => `<tr><td>${esc(row)}</td>${total ? `<td class="num muted">${total(row)}</td>` : ''}${cols.map((col) => {
    const v = cell(row, col) ?? 0
    const a = v === 0 ? 0 : 0.12 + 0.75 * (v / max)
    return `<td class="num" style="background:rgba(220,70,60,${a.toFixed(2)})">${v}</td>`
  }).join('')}</tr>`).join('')
  return `<div class="scroll"><table class="heat">${head}${body}</table></div>`
}

// ------------------------------------------------------------- synthetic
const synCfg = ordered(syn)
const synBest = syn.full ?? syn[synCfg.at(-1)]
const synRows = synCfg.map((c) => {
  const r = syn[c]
  return `<tr><td><span class="dot" style="background:${COLORS[c]}"></span>${esc(NAMES[c])}</td>
    <td class="num">${r.leaked} / ${r.occurrences}</td><td class="num">${pct(r.recall)}</td><td class="num">${r.cleanFiles} / ${r.files}</td>
    <td class="num">${r.overSpans}</td><td class="num">${r.decoysLost} / ${r.decoys}</td>
    <td class="num">${callsOf(r.run)}</td><td class="num">${k(tokensOf(r.run))}</td><td class="num">${secs(r.run?.ms)}</td><td class="num">${r.run?.filesReview ?? '—'}</td></tr>`
}).join('')
const synTypes = Object.keys(syn[synCfg[0]].byType)
const synKinds = Object.keys(syn[synCfg[0]].byKind)
const KIND_ZH = { admission: '入院记录', progress: '病程记录', discharge: '出院小结', consent: '知情同意书', followup: '电话随访', transfer: '转院信', lab: '检验单', csv: '检验结果表 CSV', 'export-json': '平台导出 JSON', 'emr-json': 'ITM_NM/ITM_VLU JSON' }

// ------------------------------------------------------------- real
let realHtml = '<p class="muted">（未提供真实数据评测结果）</p>'
if (real) {
  const cfg = ordered(real.results)
  const R0 = real.results // every run as measured
  const R = { ...R0 } // repeated configurations replaced by their median run
  // Repeats: "full@2", "full@old3" … belong to "full" / "full@old".
  const groupOf = (name) => (name.startsWith('full@old') ? 'full@old' : name.startsWith('full@') && /^full@\d+$/.test(name) ? 'full' : name)
  const repeats = {}
  for (const name of Object.keys(R)) (repeats[groupOf(name)] ??= []).push(name)
  const leakedOf = Object.fromEntries(Object.entries(R).map(([name, r]) => [name, r.leaked]))
  const range = (c) => {
    const list = (repeats[c] ?? [c]).map((name) => leakedOf[name])
    return list.length > 1 ? `，${list.length} 次 ${Math.min(...list)}–${Math.max(...list)}` : ''
  }
  // Main rows and charts use the median run of a repeated configuration.
  for (const [group, list] of Object.entries(repeats)) {
    if (list.length < 2 || !R[group]) continue
    const median = [...list].sort((a, b) => R[a].leaked - R[b].leaked)[Math.floor(list.length / 2)]
    R[group] = { ...R[median], medianOf: list.length }
  }
  const repeatRows = Object.entries(repeats).filter(([, list]) => list.length > 1).flatMap(([group, list]) => list.map((name) => {
    const r = R0[name]
    return `<tr><td><span class="dot" style="background:${COLORS[group]}"></span>${esc(NAMES[group])}</td><td>${esc(name)}</td><td class="num">${r.leaked}</td><td class="num">${pct(r.recall)}</td><td class="num">${r.overSpans}</td><td class="num">${callsOf(r.run)}</td><td class="num">${k(tokensOf(r.run))}</td><td class="num">${secs(r.run?.ms)}</td><td class="num">${r.run?.reviewItems ?? '—'}</td></tr>`
  })).join('')
  const rows = cfg.map((c) => {
    const r = R[c]
    return `<tr><td><span class="dot" style="background:${COLORS[c]}"></span>${esc(NAMES[c])}${r.medianOf ? `<span class="muted">（${r.medianOf} 次取中位）</span>` : ''}</td>
      <td class="num">${r.leaked} / ${r.refs}</td><td class="num">${pct(r.recall)}</td>
      <td class="num">${r.overSpans}</td><td class="num">${r.uncertainSpans}</td><td class="num">${r.broken || 0}</td>
      <td class="num">${callsOf(r.run)}</td><td class="num">${k(tokensOf(r.run))}</td><td class="num">${secs(r.run?.ms)}</td><td class="num">${r.run?.reviewItems ?? '—'}</td></tr>`
  }).join('')
  const types = Object.entries(real.totals.refsByType).sort((a, b) => b[1] - a[1]).map(([t]) => t)
  const cats = Object.entries(real.totals.refsByCategory).sort((a, b) => b[1] - a[1]).map(([c]) => c)
  const topFields = (key) => [...new Set(cfg.flatMap((c) => Object.keys(R[c][key])))]
    .sort((a, b) => Math.max(...cfg.map((c) => R[c][key][b] ?? 0)) - Math.max(...cfg.map((c) => R[c][key][a] ?? 0))).slice(0, 12)
  const fields = topFields('leakByField')
  const overFields = topFields('overByField')
  realHtml = `
  <p>${real.files} 个文件（${(real.bytes / 1024 / 1024).toFixed(1)} MB），${real.patients} 位病人，${Object.keys(real.categories).length} 类记录。
  所有配置改动过的片段共 ${real.totals.distinct} 种（去重），由两个本地模型独立裁定：一致判为标识符 ${real.totals.agreedYes} 种、一致判为非标识符 ${real.totals.agreedNo} 种、意见不一致或未答 ${real.totals.uncertain} 种。
  参照标识符共 <b>${real.totals.refs}</b> 处。</p>
  <div class="grid2">
    <div class="card"><h4>估计泄漏（参照标识符未被替换）</h4>${hbars(cfg.map((c) => ({ key: c, value: R[c].leaked, label: `${R[c].leaked}（召回 ${pct(R[c].recall)}${range(c)}）` })))}</div>
    <div class="card"><h4>误改片段（判为非标识符却被改动）</h4>${hbars(cfg.map((c) => ({ key: c, value: R[c].overSpans, label: `${R[c].overSpans} 段 / ${R[c].overChars} 字` })))}</div>
  </div>
  <table><tr><th>配置</th><th class="num">估计泄漏</th><th class="num">召回</th><th class="num">误改片段</th><th class="num">裁定不一的改动</th><th class="num">JSON 损坏</th><th class="num">模型调用</th><th class="num">tokens</th><th class="num">用时</th><th class="num">待复核项</th></tr>${rows}</table>
  ${repeatRows ? `<h4>重复运行（同一配置、同一样本）</h4><table><tr><th>配置</th><th>运行</th><th class="num">估计泄漏</th><th class="num">召回</th><th class="num">误改片段</th><th class="num">模型调用</th><th class="num">tokens</th><th class="num">用时</th><th class="num">待复核项</th></tr>${repeatRows}</table>` : ''}
  <div class="grid2">
    <div class="card"><h4>成本与泄漏</h4>${scatter(cfg.map((c) => ({ key: c, x: tokensOf(R[c].run), y: R[c].refs ? R[c].leaked / R[c].refs : 0 })))}</div>
    <div class="card"><h4>按标识符类型的泄漏</h4>${heat('类型', types, cfg, (t, c) => R[c].leakByType[t] ?? 0, { total: (t) => real.totals.refsByType[t] })}</div>
  </div>
  <div class="grid2">
    <div class="card"><h4>按记录类别的泄漏</h4>${heat('类别', cats, cfg, (t, c) => R[c].leakByCategory[t] ?? 0, { total: (t) => real.totals.refsByCategory[t] })}</div>
    <div class="card"><h4>泄漏最多的字段（前 12）</h4>${heat('字段', fields, cfg, (f, c) => R[c].leakByField[f] ?? 0)}</div>
  </div>
  <div class="grid2">
    <div class="card"><h4>误改最多的字段（前 12）</h4>${heat('字段', overFields, cfg, (f, c) => R[c].overByField[f] ?? 0)}</div>
    <div class="card"><h4>怎么读</h4><p class="muted">字段名是区域平台导出的卫生数据元编码（如 WS02_01_039_001 = 患者姓名，WS01_00_* 为标识类编号）。“泄漏”列里集中在 WS01_00_* 的数字说明：病历号、住院号、门诊号这类编号是当前三层架构的主要缺口；“误改”里仅模型集中在数值和编码字段，说明它把普通代码也当成了编号。</p></div>
  </div>`
  // Findings computed from the full-system runs.
  const fullRuns = repeats.full ?? ['full']
  const sumTypes = (name, types) => types.reduce((a, t) => a + (R0[name].leakByType[t] ?? 0), 0)
  const people = fullRuns.map((name) => sumTypes(name, ['姓名', '医生', '地址', '医院']))
  const records = fullRuns.map((name) => sumTypes(name, ['病历号', '住院号', '就诊号']) / Math.max(1, R0[name].leaked))
  const leaksFull = fullRuns.map((name) => R0[name].leaked)
  const leaksOld = (repeats['full@old'] ?? []).map((name) => R0[name].leaked)
  const flipFields = Object.keys(Object.assign({}, ...fullRuns.map((name) => R0[name].leakByField)))
    .filter((f) => { const v = fullRuns.map((name) => R0[name].leakByField[f] ?? 0); return Math.max(...v) > 0 && Math.min(...v) === 0 })
  realHtml += `
  <div class="note"><b>真实数据上的发现</b><ul>
    <li>三层架构在 ${fullRuns.length} 次运行中，姓名、医护姓名、地址、医院合计泄漏 ${Math.min(...people)}–${Math.max(...people)} 处；剩下的泄漏 ${pct(Math.min(...records), 0)}–${pct(Math.max(...records), 0)} 是<b>编码字段里的病历号 / 住院号 / 就诊号</b>（字段名为 WS01_00_* 等卫生数据元编码，模型从字段名看不出含义）。</li>
    <li>这类字段是“整列”判定：一次字段画像把某列判为编号或代码，整列跟着变。${fullRuns.length} 次运行泄漏 ${Math.min(...leaksFull)}–${Math.max(...leaksFull)} 处${leaksOld.length ? `（修复前 ${Math.min(...leaksOld)}–${Math.max(...leaksOld)}）` : ''}，差异几乎全来自 ${flipFields.length} 个时有时无的字段。本轮修复针对的写法在这批真实数据里很少出现，效果被这种波动淹没。</li>
    <li>仅模型召回 ${pct(R.model?.recall)}，低于所有含规则的流水线配置；另有 ${R.model?.broken ?? 0} 个 JSON 文件被改坏（替换跨过了引号或键名），${R.model?.run?.models?.detect?.failed ?? 0} 次调用失败的分块未经检查；误改 ${R.model?.overSpans ?? 0} 段，是流水线的十倍以上；耗时与 tokens 也最高。</li>
    <li>仅规则在真实数据上召回不到一半：病人姓名在 WS02_01_039_001 这类编码字段里，没有“姓名”标签可依。</li>
  </ul></div>`
}

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>匿名化架构对比评测</title>
<style>
:root{--fg:#1d2733;--muted:#6b7785;--line:#e3e7ec;--bg:#f6f8fa}
body{font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--fg);background:var(--bg);margin:0}
main{max-width:1180px;margin:0 auto;padding:28px 28px 60px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 10px;padding-top:8px;border-top:1px solid var(--line)}h4{margin:4px 0 8px;font-size:14px}
.muted{color:var(--muted)}.num{text-align:right;font-variant-numeric:tabular-nums}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin:16px 0}
.card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:14px 16px}
.kpi b{font-size:26px;display:block}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0}
@media(max-width:900px){.grid2{grid-template-columns:1fr}}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line);margin:10px 0}
th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{background:#fafbfc;font-weight:600}
table.heat td,table.heat th{padding:4px 8px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}
svg .lbl{font-size:12px;fill:var(--fg)}svg .val{font-size:12px;fill:var(--muted)}svg .axis{font-size:11px;fill:var(--muted)}svg .grid{stroke:var(--line)}
.layers{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap;margin:10px 0}
.layer{flex:1;min-width:200px;background:#fff;border:1px solid var(--line);border-top:4px solid;border-radius:8px;padding:10px 12px}
.note{background:#fff8e6;border:1px solid #f1d58a;border-radius:8px;padding:10px 14px}
li{margin:3px 0}
.scroll{overflow-x:auto}.grid2>*{min-width:0}.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;margin-top:6px}
</style></head><body><main>
<h1>匿名化架构对比评测</h1>
<div class="muted">dsh-medical-anonymizer · 识别模型 qwen3.6-35b-a3b · 核验模型 gemma-4-26b-a4b-it · 生成于 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</div>

<div class="cards">
  <div class="card kpi"><span class="muted">合成语料 · 三层（修复后）泄漏</span><b>${synBest.leaked} / ${synBest.occurrences}</b><span class="muted">仅规则 ${syn.rules?.leaked ?? '—'}，仅模型 ${syn.model?.leaked ?? '—'}</span></div>
  ${real ? `<div class="card kpi"><span class="muted">真实样本 · 三层（修复后）估计泄漏（3 次）</span><b>${(() => { const l = Object.keys(real.results).filter((n) => /^full(@\d+)?$/.test(n)).map((n) => real.results[n].leaked); return `${Math.min(...l)}–${Math.max(...l)}` })()} / ${real.results.full?.refs ?? '—'}</b><span class="muted">仅规则 ${real.results.rules?.leaked ?? '—'}，仅模型 ${real.results.model?.leaked ?? '—'}</span></div>` : ''}
  <div class="card kpi"><span class="muted">结论</span><b style="font-size:17px;line-height:1.4">规则与模型互补，三层架构在两类数据上都最好；真实数据剩余泄漏集中在编码字段的记录号</b></div>
</div>

<h2>被比较的配置</h2>
<div class="layers">
  <div class="layer" style="border-top-color:${COLORS.rules}"><b>仅规则</b><br><span class="muted">字段名 + 正则 + 校验位，不调模型</span></div>
  <div class="layer" style="border-top-color:${COLORS.model}"><b>仅模型</b><br><span class="muted">原文分块交给识别模型，按返回片段全文替换；无规则、无字段画像、无核验</span></div>
  <div class="layer" style="border-top-color:${COLORS['rules+model']}"><b>规则 + 识别模型</b><br><span class="muted">插件流水线，核验关闭，1 轮</span></div>
  <div class="layer" style="border-top-color:${COLORS.full}"><b>三层</b><br><span class="muted">识别模型 + 规则替换 + 独立盲审，最多 3 轮；分修复前 / 修复后两版</span></div>
</div>

<h2>一、合成语料（有标准答案）</h2>
<p class="muted">表格列名：规则 = 仅规则，模型 = 仅模型，规则+模型 = 规则 + 识别模型（无核验），修复前 / 修复后 = 三层架构的两个版本，同模型核验 = 三层但由识别模型自己核验。</p>
<p>${syn[synCfg[0]].files} 个文件、${syn[synCfg[0]].occurrences} 处标识符（每处位置已知）、${syn[synCfg[0]].decoys} 个诱饵（人名命名的病名、像人名的中药、病区、ICD 编码等）。文本模板含家属/医护姓名、外院名称、空格分组的号码等难例。</p>
<div class="grid2">
  <div class="card"><h4>泄漏处数</h4>${hbars(synCfg.map((c) => ({ key: c, value: syn[c].leaked, label: `${syn[c].leaked}（召回 ${pct(syn[c].recall)}）` })))}</div>
  <div class="card"><h4>成本与泄漏</h4>${scatter(synCfg.map((c) => ({ key: c, x: tokensOf(syn[c].run), y: syn[c].leaked / syn[c].occurrences })))}</div>
</div>
<table><tr><th>配置</th><th class="num">泄漏</th><th class="num">召回</th><th class="num">全清文件</th><th class="num">误改片段</th><th class="num">诱饵丢失</th><th class="num">模型调用</th><th class="num">tokens</th><th class="num">用时</th><th class="num">待复核文件</th></tr>${synRows}</table>
<div class="grid2">
  <div class="card"><h4>按类型的泄漏</h4>${heat('类型', synTypes, synCfg, (t, c) => syn[c].byType[t].leaked, { total: (t) => syn[synCfg[0]].byType[t].n })}</div>
  <div class="card"><h4>按文档的泄漏</h4>${heat('文档', synKinds.map((x) => KIND_ZH[x] ?? x), synCfg, (t, c) => syn[c].byKind[Object.keys(KIND_ZH).find((key) => KIND_ZH[key] === t) ?? t].leaked, { total: (t) => syn[synCfg[0]].byKind[Object.keys(KIND_ZH).find((key) => KIND_ZH[key] === t) ?? t].n })}</div>
</div>

<h2>二、真实数据样本（无标准答案，模型裁定参照）</h2>
${realHtml}

<h2>三、本轮修复</h2>
<ul>
  <li><b>分组书写的身份证号</b>（如“110105 19491231 002X”、4 位一组）：规则新增识别（校验位必须正确），格式检查放行。修复前，识别与核验都正确报出了这类号码，却被格式检查丢弃，文件仍标为“已完成”。</li>
  <li><b>两模型一致、仅格式不符的值进入人工复核</b>（新复核类型“两模型均报出但格式不符”），不再只记一条提示。</li>
  <li><b>医院名不再吞并前文</b>：职称、“与/及/并/已”等处断开；同一段里的两个医院分别识别。修复前“主治医师某某已与某市中心医院”整段被当作医院替换。</li>
</ul>

<h2>四、建议</h2>
<ol>
  <li><b>内置卫生数据元编码字典</b>（WS 363 / WS 445：如 DE01.00.* 标识类 → 病历号/住院号/门诊号，DE02.01.039 → 姓名，DE02.01.030 → 证件号码，DE02.01.010 → 电话）。字段名命中即按列确定类型，不再依赖模型猜编码字段，可同时消除真实数据上的主要泄漏和运行间波动。</li>
  <li><b>字段画像求稳</b>：对“标识符 / 代码”判定不一致的列，用两模型都判一次或多次投票；判为代码但取值像编号（长数字、含字母的流水号）的列，进入复核而不是直接放过。</li>
  <li><b>保留三层结构</b>：识别模型与规则互补是主要收益来源；核验层在合成语料上把最后几处残留压到 0，在真实数据上负责把分歧送人工，作用是兜底。单模型方案在召回、误改、文件完整性和成本上都不占优。</li>
  <li>在真实数据上抽 50–100 处“裁定不一”的片段做人工标注，校准本报告的估计。</li>
</ol>

<h2>五、方法与局限</h2>
<ul>
  <li>对齐：原文与输出逐字段（JSON 按值）做字符级对齐；一处标识符超过一半字符原样保留记为泄漏。</li>
  <li>合成语料由模板生成，字段标签多，偏向规则；病人跨文件重复，偏向流水线的批内扩散。</li>
  <li>真实样本没有标准答案：参照标识符 = 任一配置改动过、且两个本地模型都判为标识符的片段。<b>所有配置都没改的标识符不在参照内</b>，因此“估计泄漏”只反映配置之间的相对差距，是泄漏的下限；裁判模型与被测系统同源，对三层架构可能偏宽。意见不一致的片段单列，不计入泄漏和误改。</li>
  <li>真实样本为分层抽样（自由文本类全部小文件，结构化类每类最多 3 个 ≤ 60 KB 的文件），病人目录改名为 P1–P6。</li>
  <li>本报告只含统计数字、类型名和字段名，不含病历原文；带原文的中间文件保存在评测目录（权限 0600），仅本机可见。</li>
</ul>
</main></body></html>`
await writeFile(outFile, html)
console.log(`wrote ${outFile}`)
