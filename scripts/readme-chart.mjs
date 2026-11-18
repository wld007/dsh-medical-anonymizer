/**
 * Draw the README benchmark chart (assets/benchmark.png) from the published
 * results in docs/benchmark/README.md: a one-page HTML rendered by headless
 * Chrome at 1200×800.
 *
 *   node scripts/readme-chart.mjs assets/benchmark.png
 *
 * Numbers are copied from docs/benchmark/README.md (medians of 3 runs, ranges
 * in brackets); update both together after a new benchmark.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const out = resolve(process.argv[2] ?? 'assets/benchmark.png')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const rows = [
  { name: '只用规则', leak: 216, range: null, recall: 85.1, clean: 20, over: 0, color: '#e0a458' },
  { name: '只用模型', leak: 226, range: [224, 229], recall: 84.4, clean: 63, over: 8, color: '#d9796b' },
  { name: '规则 + 识别模型（无核验）', leak: 91, range: [79, 107], recall: 93.7, clean: 76, over: 0, color: '#8fb8de' },
  { name: '三层，识别模型自己核验', leak: 19, range: [16, 22], recall: 98.7, clean: 86, over: 0, color: '#5fa8a0' },
  { name: '三层：规则 + 识别 + 独立核验', leak: 19, range: [18, 19], recall: 98.7, clean: 86, over: 0, color: '#1f8a7e', best: true },
]
const max = 280
const bar = (row) => {
  const width = (row.leak / max) * 100
  const range = row.range ? `<i class="rng" style="left:${(row.range[0] / max) * 100}%;width:${((row.range[1] - row.range[0]) / max) * 100}%"></i>` : ''
  return `<div class="row${row.best ? ' best' : ''}"><span class="lbl">${row.name}</span><div class="track"><b style="width:${width}%;background:${row.color}"></b>${range}<em style="left:calc(${(Math.max(row.leak, row.range?.[1] ?? 0) / max) * 100}% + 8px)">${row.leak}${row.range ? `<small>（${row.range[0]}–${row.range[1]}）</small>` : ''}</em></div><span class="side">召回 ${row.recall}%<br><small>全清 ${row.clean}/100 · 误改 ${row.over}</small></span></div>`
}
const ticks = [0, 50, 100, 150, 200, 250].map((v) => `<span style="left:${(v / max) * 100}%">${v}</span>`).join('')

const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1200px;height:800px;background:#f7f9fa;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif;color:#1b2a2f;padding:34px 36px}
h1{margin:0 0 8px;font-size:27px}p.sub{margin:0 0 22px;color:#5d6e73;font-size:14px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}
.kpi{background:#fff;border:1px solid #e1e8ea;border-radius:12px;padding:16px 20px}.kpi b{display:block;font-size:30px;font-weight:600}.kpi span{font-size:13px;color:#5d6e73}
.kpi.good b{color:#1f8a7e}
.note{background:#eef6f5;border-left:4px solid #1f8a7e;border-radius:8px;padding:14px 20px;font-size:14px;line-height:1.75;margin-bottom:24px}.note b{font-weight:600}.note ul{margin:4px 0 0;padding-left:18px}
h2{font-size:18px;margin:0 0 12px;padding-left:10px;border-left:4px solid #1f8a7e}
.chart{background:#fff;border:1px solid #e1e8ea;border-radius:12px;padding:20px 24px 14px}
.row{display:grid;grid-template-columns:230px 1fr 170px;align-items:center;gap:16px;height:44px;font-size:14px}
.row.best .lbl{font-weight:700}.track{position:relative;height:24px;background:#edf1f2;border-radius:6px}
.track b{position:absolute;left:0;top:0;bottom:0;border-radius:6px}.track .rng{position:absolute;top:-4px;bottom:-4px;border-left:2px solid #1b2a2f;border-right:2px solid #1b2a2f;opacity:.45}
.track em{position:absolute;top:2px;white-space:nowrap;font-style:normal;font-weight:700;font-size:14px}.track em small{font-weight:400;color:#5d6e73;font-size:12px}
.side{font-size:13px;line-height:1.35}.side small{color:#5d6e73}
.axis{position:relative;margin:6px 186px 0 246px;height:18px;font-size:11px;color:#8a989c}.axis span{position:absolute;transform:translateX(-50%)}
.legend{margin-top:6px;font-size:12px;color:#5d6e73}
</style>
<h1>医疗数据匿名化 · 三层架构评测</h1>
<p class="sub">合成病历 100 个文件 · 1452 处标识符 · 924 个陷阱 · 识别 qwen3.6-35b-a3b，核验 gemma-4-26b-a4b-it · 温度 0 · 用到模型的配置各跑 3 次取中位数</p>
<div class="kpis">
<div class="kpi"><b>216</b><span>只用规则：泄漏处数</span></div>
<div class="kpi"><b>226</b><span>只用模型：泄漏处数</span></div>
<div class="kpi good"><b>19</b><span>三层：泄漏处数（−91%）</span></div>
<div class="kpi good"><b>0</b><span>三层：误改片段 · 陷阱丢失</span></div>
</div>
<div class="note"><b>结论</b><ul>
<li><b>规则和模型漏的不是同一类</b>：规则漏叙述里的姓名和地址，模型漏编码字段里的纯数字编号和表格列；叠加后泄漏从约 220 降到约 90。</li>
<li><b>独立核验再减少约八成</b>（约 90 → 19），三次运行之间也更稳定（79–107 → 18–19）。</li>
<li><b>不误改</b>：帕金森病、徐长卿、上级医院等 924 个陷阱一个没丢，误改片段为 0。</li>
</ul></div>
<h2>泄漏处数（越少越好）</h2>
<div class="chart">${rows.map(bar).join('')}<div class="axis">${ticks}</div><div class="legend">竖线为 3 次运行的范围 · 泄漏：一处标识符超过一半的字符原样保留</div></div>`

const dir = await mkdtemp(join(tmpdir(), 'anon-chart-'))
try {
  const page = join(dir, 'chart.html')
  await writeFile(page, html)
  await promisify(execFile)(CHROME, ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,800', `--screenshot=${out}`, `file://${page}`])
  console.log(out)
} finally {
  await rm(dir, { recursive: true, force: true })
}
