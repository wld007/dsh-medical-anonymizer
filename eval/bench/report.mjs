/**
 * Visual benchmark report: one self-contained HTML file (inline SVG, no
 * network), built from the synthetic corpus only.
 *
 *   node eval/bench/report.mjs <workDir> <out.html>
 *
 * Reads <workDir>/gold.json, <workDir>/score.json and the corpus/outputs for
 * the example excerpt. Repeated runs ("full@2", "full@3") are grouped: charts
 * and the main table show the median run, with the range across runs.
 * Everything in the corpus is invented, so examples are shown verbatim.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [workDir = 'eval/bench/.tmp', outFile = 'docs/benchmark/index.html'] = process.argv.slice(2)
const gold = JSON.parse(await readFile(join(workDir, 'gold.json'), 'utf8'))
const { results: R0 } = JSON.parse(await readFile(join(workDir, 'score.json'), 'utf8'))
const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
let models = { DETECT: { model: '—' }, VERIFY: { model: '—' } }
try { models = await import('./models.mjs') } catch { /* no endpoint configured */ }

const NAMES = {
  rules: '仅规则', model: '仅模型', 'rules+model': '规则 + 识别模型', 'full-same': '三层·同模型核验', 'full@old': '三层（修复前）', full: '三层（当前）',
}
const SHORT = { rules: '规则', model: '模型', 'rules+model': '规则+模型', 'full-same': '同模型核验', 'full@old': '修复前', full: '当前' }
const COLORS = { rules: '#9aa5b1', model: '#e0a33b', 'rules+model': '#5b8def', 'full-same': '#7d6bd6', 'full@old': '#8fb9a8', full: '#1f9d74' }
const ORDER = ['rules', 'model', 'rules+model', 'full-same', 'full@old', 'full']
const groupOf = (name) => (name.startsWith('full@old') ? 'full@old' : name.split('@')[0])

// Group repeated runs; the representative is the median run by leaks.
const runs = {}
for (const name of Object.keys(R0)) (runs[groupOf(name)] ??= []).push(name)
const R = {}
for (const [group, list] of Object.entries(runs)) {
  const sorted = [...list].sort((a, b) => R0[a].leaked - R0[b].leaked)
  R[group] = { ...R0[sorted[Math.floor(sorted.length / 2)]], runs: list.length, runName: sorted[Math.floor(sorted.length / 2)] }
}
const cfg = ORDER.filter((key) => R[key])
const spread = (group, pickValue) => {
  const values = runs[group].map((name) => pickValue(R0[name]))
  return { min: Math.min(...values), max: Math.max(...values), n: values.length }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const pct = (x, digits = 1) => (x === null || x === undefined || Number.isNaN(x) ? '—' : `${(100 * x).toFixed(digits)}%`)
const k = (n) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const secs = (ms) => (ms === undefined ? '—' : ms >= 60000 ? `${(ms / 60000).toFixed(1)} 分` : `${Math.round(ms / 1000)} 秒`)
const tokensOf = (r) => (r.run?.models?.detect?.tokens ?? 0) + (r.run?.models?.verify?.tokens ?? 0)
const callsOf = (r) => (r.run?.models?.detect?.calls ?? 0) + (r.run?.models?.verify?.calls ?? 0)
const rangeText = (group, pickValue) => { const s = spread(group, pickValue); return s.n > 1 && s.min !== s.max ? `（${s.n} 次 ${s.min}–${s.max}）` : s.n > 1 ? `（${s.n} 次相同）` : '' }

// ------------------------------------------------------------- charts
function hbars(rows, { width = 560 } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  const rowH = 30
  const left = 150
  const bars = rows.map((row, i) => {
    const w = Math.max(2, ((width - left - 210) * row.value) / max)
    const y = 5 + i * rowH
    const err = row.min !== undefined && row.max !== row.min
      ? `<line x1="${left + ((width - left - 210) * row.min) / max}" x2="${left + ((width - left - 210) * row.max) / max}" y1="${y + 14}" y2="${y + 14}" stroke="#333" stroke-width="1.5"/>`
      : ''
    return `<text x="${left - 10}" y="${y + 19}" text-anchor="end" class="lbl">${esc(NAMES[row.key])}</text>
      <rect x="${left}" y="${y + 4}" width="${w}" height="20" rx="3" fill="${COLORS[row.key]}"/>${err}
      <text x="${left + Math.max(w, ((width - left - 210) * (row.max ?? 0)) / max) + 6}" y="${y + 19}" class="val">${esc(row.label)}</text>`
  }).join('')
  return `<svg viewBox="0 0 ${width} ${rows.length * rowH + 10}" width="100%" style="max-width:${width}px">${bars}</svg>`
}

function scatter(points) {
  const W = 560
  const H = 280
  const pad = { l: 60, r: 20, t: 16, b: 40 }
  const maxX = Math.max(1, ...points.map((p) => p.x)) * 1.1
  const maxY = Math.max(0.01, ...points.map((p) => p.y)) * 1.15
  const sx = (x) => pad.l + ((W - pad.l - pad.r) * x) / maxX
  const sy = (y) => H - pad.b - ((H - pad.t - pad.b) * y) / maxY
  const grid = [0, maxY / 2, maxY].map((y) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(y)}" y2="${sy(y)}" class="grid"/><text x="${pad.l - 6}" y="${sy(y) + 4}" text-anchor="end" class="axis">${pct(y, 1)}</text>`).join('')
  const ticks = [0, maxX / 2, maxX].map((x) => `<text x="${sx(x)}" y="${H - pad.b + 16}" text-anchor="middle" class="axis">${k(Math.round(x))}</text>`).join('')
  const dots = points.map((p) => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="7" fill="${COLORS[p.key]}" fill-opacity="0.85" stroke="#fff" stroke-width="1.5"><title>${esc(NAMES[p.key])}</title></circle>`).join('')
  const legend = `<div class="legend">${points.map((p) => `<span><span class="dot" style="background:${COLORS[p.key]}"></span>${esc(NAMES[p.key])} <span class="muted">${k(Math.round(p.x))} · ${pct(p.y, 1)}</span></span>`).join('')}</div>`
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${grid}${ticks}
    <text x="${(W + pad.l) / 2}" y="${H - 4}" text-anchor="middle" class="axis">模型 tokens（越左越省）</text>
    <text x="14" y="${H / 2}" text-anchor="middle" class="axis" transform="rotate(-90 14 ${H / 2})">泄漏率（越低越好）</text>${dots}</svg>${legend}`
}

/** Shaded table: rows × configurations. cell → { v, n } (shade by v / n or by v). */
function heat(label, rows, cell, { rate = false, total = null } = {}) {
  const values = rows.flatMap((row) => cfg.map((c) => cell(row, c)))
  const max = Math.max(1e-9, ...values.map((x) => (rate ? (x.n ? x.v / x.n : 0) : x.v)))
  const head = `<tr><th>${esc(label)}</th>${total ? '<th class="num">n</th>' : ''}${cfg.map((c) => `<th class="num" title="${esc(NAMES[c])}" style="border-bottom:3px solid ${COLORS[c]}">${esc(SHORT[c])}</th>`).join('')}</tr>`
  const body = rows.map((row) => `<tr><td>${esc(row)}</td>${total ? `<td class="num muted">${total(row)}</td>` : ''}${cfg.map((c) => {
    const x = cell(row, c)
    const s = rate ? (x.n ? x.v / x.n : 0) : x.v
    const a = x.v === 0 ? 0 : 0.12 + 0.75 * (s / max)
    return `<td class="num" style="background:rgba(220,70,60,${a.toFixed(2)})">${x.v}</td>`
  }).join('')}</tr>`).join('')
  return `<div class="scroll"><table class="heat">${head}${body}</table></div>`
}

// ------------------------------------------------------------- corpus facts
const files = gold.files
const totalIds = files.reduce((a, f) => a + f.identifiers.length, 0)
const totalDecoys = files.reduce((a, f) => a + f.decoys.length, 0)
const totalNeutral = files.reduce((a, f) => a + (f.neutral?.length ?? 0), 0)
const caseCount = {}
const caseType = {}
for (const f of files) for (const g of f.identifiers) { caseCount[g.case] = (caseCount[g.case] ?? 0) + 1; (caseType[g.case] ??= new Set()).add(g.type) }
const trapExamples = {}
for (const f of files) for (const d of f.decoys) (trapExamples[d.cat] ??= new Set()).add(d.text)
const kindCount = {}
for (const f of files) kindCount[f.kind] = (kindCount[f.kind] ?? 0) + 1
const KIND = gold.kinds ?? {}

// ------------------------------------------------------------- example excerpt
async function excerpt(fileName, config) {
  const file = files.find((f) => f.name === fileName)
  const original = await readFile(join(workDir, 'corpus', fileName), 'utf8')
  let output = ''
  try { output = await readFile(join(workDir, 'out', config, fileName), 'utf8') } catch { /* none */ }
  const marks = [
    ...file.identifiers.map((g) => ({ ...g, cls: 'id', title: `${g.type} · ${g.case}` })),
    ...(file.neutral ?? []).map((g) => ({ ...g, cls: 'neu', title: `中性：${g.why}` })),
  ].sort((a, b) => a.start - b.start)
  const decoyTexts = [...new Set(file.decoys.map((d) => d.text))].sort((a, b) => b.length - a.length)
  const plain = (text) => {
    let html = esc(text)
    for (const d of decoyTexts) html = html.split(esc(d)).join(`<span class="trap" title="陷阱：不应替换">${esc(d)}</span>`)
    return html
  }
  let html = ''
  let at = 0
  for (const m of marks) {
    if (m.start < at) continue
    html += plain(original.slice(at, m.start)) + `<span class="${m.cls}" title="${esc(m.title)}">${esc(original.slice(m.start, m.end))}</span>`
    at = m.end
  }
  html += plain(original.slice(at))
  const out = esc(output).replace(/((?:化名|医生|证件|电话|邮箱|地址|病历|住院|就诊|社保|银行卡|医院)-[0-9A-F]{6})/g, '<span class="ps">$1</span>')
  return { html, out }
}
const sampleFile = files.find((f) => f.kind === 'admission')?.name ?? files[0].name
const sample = await excerpt(sampleFile, R.full?.runName ?? cfg.at(-1))

// ------------------------------------------------------------- sections
const mainRows = cfg.map((c) => {
  const r = R[c]
  return `<tr><td><span class="dot" style="background:${COLORS[c]}"></span>${esc(NAMES[c])}${r.runs > 1 ? `<span class="muted">（${r.runs} 次取中位）</span>` : ''}</td>
    <td class="num">${r.leaked}${rangeText(c, (x) => x.leaked)}</td><td class="num">${pct(r.recall)}</td><td class="num">${r.cleanFiles} / ${r.files}</td>
    <td class="num">${r.overSpans}${rangeText(c, (x) => x.overSpans)}</td><td class="num">${r.decoysLost} / ${r.decoys}</td><td class="num">${r.broken}</td>
    <td class="num">${callsOf(r)}</td><td class="num">${k(tokensOf(r))}</td><td class="num">${secs(r.run?.ms)}</td><td class="num">${r.run?.filesReview ?? '—'}</td></tr>`
}).join('')
const cases = Object.entries(caseCount).sort((a, b) => b[1] - a[1]).map(([c]) => c)
const traps = Object.keys(trapExamples)
const types = Object.keys(R[cfg[0]].byType).sort((a, b) => R[cfg[0]].byType[b].n - R[cfg[0]].byType[a].n)
const kinds = Object.keys(R[cfg[0]].byKind)
const leakList = (c, n = 20) => {
  const r = R[c]
  if (!r?.leaks?.length) return '<p class="muted">无</p>'
  const grouped = {}
  for (const l of r.leaks) { const key = `${l.case}|${l.type}|${l.text}`; grouped[key] = (grouped[key] ?? 0) + 1 }
  return `<table><tr><th>难点</th><th>类型</th><th>原文</th><th class="num">处</th></tr>${Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => { const [kase, type, text] = key.split('|'); return `<tr><td>${esc(kase)}</td><td>${esc(type)}</td><td><code>${esc(text)}</code></td><td class="num">${count}</td></tr>` }).join('')}</table>`
}
const overList = (c, n = 12) => {
  const r = R[c]
  if (!r?.overSpanList?.length) return '<p class="muted">无</p>'
  const grouped = {}
  for (const o of r.overSpanList) grouped[o.context] = (grouped[o.context] ?? 0) + 1
  return `<table><tr><th>上下文（被误改的部分在其中）</th><th class="num">处</th></tr>${Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, n).map(([ctx, count]) => `<tr><td><code>${esc(ctx)}</code></td><td class="num">${count}</td></tr>`).join('')}</table>`
}
const best = R.full ?? R[cfg.at(-1)]
const caseRate = (c, kase) => { const x = R[c].byCase[kase]; return x ? x.leaked / x.n : 0 }
const weakest = cfg.filter((c) => c !== 'full').map((c) => ({ c, top: cases.filter((kase) => caseRate(c, kase) >= 0.5) }))

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>匿名化架构对比评测（合成病历）</title>
<style>
:root{--fg:#1d2733;--muted:#6b7785;--line:#e3e7ec;--bg:#f6f8fa}
body{font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--fg);background:var(--bg);margin:0}
main{max-width:1180px;margin:0 auto;padding:28px 28px 60px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 10px;padding-top:8px;border-top:1px solid var(--line)}h4{margin:4px 0 8px;font-size:14px}
.muted{color:var(--muted)}.num{text-align:right;font-variant-numeric:tabular-nums}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin:16px 0}
.card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:14px 16px}
.kpi b{font-size:26px;display:block}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0}.grid2>*{min-width:0}
@media(max-width:900px){.grid2{grid-template-columns:1fr}}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line);margin:10px 0}
th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{background:#fafbfc;font-weight:600}
table.heat td,table.heat th{padding:4px 8px}.scroll{overflow-x:auto}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}
svg .lbl{font-size:12px;fill:var(--fg)}svg .val{font-size:12px;fill:var(--muted)}svg .axis{font-size:11px;fill:var(--muted)}svg .grid{stroke:var(--line)}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;margin-top:6px}
.layers{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.layer{flex:1;min-width:180px;background:#fff;border:1px solid var(--line);border-top:4px solid;border-radius:8px;padding:10px 12px}
.note{background:#fff8e6;border:1px solid #f1d58a;border-radius:8px;padding:10px 14px}
pre.doc{white-space:pre-wrap;background:#fff;border:1px solid var(--line);border-radius:8px;padding:12px;font:13px/1.7 "PingFang SC",monospace;max-height:520px;overflow:auto;margin:0}
.id{background:#ffe1dc;border-bottom:2px solid #dc463c}.trap{background:#e3f1ea;border-bottom:2px dotted #1f9d74}.neu{background:#eceff3;border-bottom:2px dashed #9aa5b1}.ps{background:#e6efff;color:#2c55c9}
.chips span{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:1px 9px;margin:2px 3px;font-size:12px}
code{background:#f1f3f5;border-radius:3px;padding:0 4px}li{margin:3px 0}
</style></head><body><main>
<h1>匿名化架构对比评测</h1>
<div class="muted">${esc(pkg.name)} ${esc(pkg.version)} · 识别模型 ${esc(models.DETECT.model)} · 核验模型 ${esc(models.VERIFY.model)} · 合成病历（种子 ${gold.seed}）· 生成于 ${new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</div>
<p class="muted">全部数据为合成：人名、证件号、电话、地址、机构都是虚构的（如“东江市”“云溪县”）。用 <code>eval/bench</code> 中的脚本可重新生成本报告，见 <code>eval/bench/README.md</code>。</p>

<div class="cards">
  <div class="card kpi"><span class="muted">三层（当前）· 泄漏</span><b>${best.leaked} / ${best.occurrences}</b><span class="muted">召回 ${pct(best.recall, 2)}${rangeText('full', (x) => x.leaked)}</span></div>
  <div class="card kpi"><span class="muted">仅规则 / 仅模型 · 泄漏</span><b>${R.rules?.leaked ?? '—'} / ${R.model?.leaked ?? '—'}</b><span class="muted">同一份语料</span></div>
  <div class="card kpi"><span class="muted">三层（当前）· 误改 / 陷阱丢失</span><b>${best.overSpans} / ${best.decoysLost}</b><span class="muted">共 ${totalDecoys} 个陷阱</span></div>
</div>

<h2>被比较的配置</h2>
<div class="layers">
  <div class="layer" style="border-top-color:${COLORS.rules}"><b>仅规则</b><br><span class="muted">字段名 + 正则 + 校验位，不调模型（未配置模型时的插件行为）</span></div>
  <div class="layer" style="border-top-color:${COLORS.model}"><b>仅模型</b><br><span class="muted">原文分块交给识别模型，按返回片段全文替换；无规则、无字段画像、无核验</span></div>
  <div class="layer" style="border-top-color:${COLORS['rules+model']}"><b>规则 + 识别模型</b><br><span class="muted">插件流水线，核验关闭，1 轮</span></div>
  <div class="layer" style="border-top-color:${COLORS.full}"><b>三层</b><br><span class="muted">识别模型 + 规则替换 + 独立盲审，最多 3 轮；另比较“同模型核验”和本轮修复前的版本（b632594）</span></div>
</div>

<h2>一、语料与陷阱</h2>
<p>${files.length} 个文件（${Object.entries(kindCount).map(([kk, n]) => `${esc(KIND[kk] ?? kk)} ${n}`).join('、')}），${new Set(files.map((f) => f.name.split('/')[0])).size} 个目录；
<b>${totalIds}</b> 处标识符（位置已知）、<b>${totalDecoys}</b> 个陷阱、${totalNeutral} 处中性值（机构代码、标本条码、仅到县的出生地等可争议的值，不计泄漏也不计误改）。</p>
<div class="grid2">
  <div class="card"><h4>标识符难点（${cases.length} 类）</h4><div class="chips">${cases.map((c) => `<span title="${esc([...caseType[c]].join('、'))}">${esc(c)} · ${caseCount[c]}</span>`).join('')}</div></div>
  <div class="card"><h4>陷阱（不应被替换，${traps.length} 类）</h4><div class="scroll"><table>${traps.map((t) => `<tr><td>${esc(t)}</td><td class="muted">${[...trapExamples[t]].slice(0, 5).map(esc).join('、')}</td></tr>`).join('')}</table></div></div>
</div>
<div class="grid2">
  <div class="card"><h4>样例：${esc(sampleFile)}（<span class="id">标识符</span> <span class="trap">陷阱</span> <span class="neu">中性</span>）</h4><pre class="doc">${sample.html}</pre></div>
  <div class="card"><h4>三层（当前）输出（<span class="ps">假名</span>）</h4><pre class="doc">${sample.out}</pre></div>
</div>

<h2>二、结果</h2>
<div class="grid2">
  <div class="card"><h4>泄漏处数（中位；黑线为 ${Math.max(...cfg.map((c) => R[c].runs))} 次运行的范围）</h4>${hbars(cfg.map((c) => { const s = spread(c, (x) => x.leaked); return { key: c, value: R[c].leaked, min: s.min, max: s.max, label: `${R[c].leaked}（召回 ${pct(R[c].recall)}）` } }))}</div>
  <div class="card"><h4>误改片段（标识符以外被改动）</h4>${hbars(cfg.map((c) => { const s = spread(c, (x) => x.overSpans); return { key: c, value: R[c].overSpans, min: s.min, max: s.max, label: `${R[c].overSpans} 段 · 陷阱丢失 ${R[c].decoysLost}` } }))}</div>
</div>
<table><tr><th>配置</th><th class="num">泄漏</th><th class="num">召回</th><th class="num">全清文件</th><th class="num">误改片段</th><th class="num">陷阱丢失</th><th class="num">JSON 损坏</th><th class="num">模型调用</th><th class="num">tokens</th><th class="num">用时</th><th class="num">待复核文件</th></tr>${mainRows}</table>
<div class="grid2">
  <div class="card"><h4>成本与泄漏</h4>${scatter(cfg.map((c) => ({ key: c, x: tokensOf(R[c]), y: R[c].leaked / R[c].occurrences })))}</div>
  <div class="card"><h4>按标识符类型的泄漏</h4>${heat('类型', types, (t, c) => ({ v: R[c].byType[t]?.leaked ?? 0, n: R[c].byType[t]?.n ?? 0 }), { rate: true, total: (t) => R[cfg[0]].byType[t].n })}</div>
</div>
<div class="grid2">
  <div class="card"><h4>按难点的泄漏（颜色按泄漏率）</h4>${heat('难点', cases, (kase, c) => ({ v: R[c].byCase[kase]?.leaked ?? 0, n: R[c].byCase[kase]?.n ?? 0 }), { rate: true, total: (kase) => caseCount[kase] })}</div>
  <div class="card"><h4>按陷阱类别的误替换</h4>${heat('陷阱', traps, (t, c) => ({ v: R[c].byTrap[t]?.lost ?? 0, n: R[c].byTrap[t]?.n ?? 0 }), { total: (t) => R[cfg[0]].byTrap[t]?.n ?? 0 })}
    <h4>按文档的泄漏</h4>${heat('文档', kinds.map((kk) => KIND[kk] ?? kk), (label, c) => { const kk = kinds.find((x) => (KIND[x] ?? x) === label); return { v: R[c].byKind[kk]?.leaked ?? 0, n: R[c].byKind[kk]?.n ?? 0 } }, { rate: true, total: (label) => R[cfg[0]].byKind[kinds.find((x) => (KIND[x] ?? x) === label)].n })}</div>
</div>

<h2>三、三层（当前）还漏了什么、误改了什么</h2>
<div class="grid2">
  <div class="card"><h4>泄漏明细（中位那次运行）</h4>${leakList('full')}</div>
  <div class="card"><h4>误改明细</h4>${overList('full')}</div>
</div>
<div class="note"><b>各配置的薄弱点</b>（泄漏率 ≥ 50% 的难点）<ul>${weakest.map(({ c, top }) => `<li><b>${esc(NAMES[c])}</b>：${top.length ? top.map(esc).join('、') : '无'}</li>`).join('')}</ul></div>

<h2>四、方法与局限</h2>
<ul>
  <li>对齐：原文与输出逐行做字符级对齐；一处标识符超过一半字符原样保留记为泄漏。标识符与中性值以外被改动的字符记为误改；陷阱在输出中出现次数减少记为丢失。</li>
  <li>每个用到模型的配置跑 ${Math.max(...cfg.map((c) => R[c].runs))} 次，取泄漏中位的一次展示，并给出范围；温度 0，但服务端批处理仍有波动。</li>
  <li>语料是模板生成的，比真实病历规整、病人跨文件重复（偏向流水线的批内扩散）；没有 OCR 错字、扫描件和超大表格。结果反映各层的作用和短板，不能直接当作真实数据上的泄漏率。</li>
  <li>“编码字段”模拟区域平台导出：字段名是数据元编码（如 <code>DE02.01.039.00</code>），从名字看不出含义；“裸编号”是不带前缀的纯数字病历号、住院号、门诊号。</li>
</ul>
</main></body></html>`
await writeFile(outFile, html)
console.log(`wrote ${outFile}`)
