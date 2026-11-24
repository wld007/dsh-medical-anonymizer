/**
 * Busy chart series: every point of the whole run covers the same time,
 * load is averaged (not sampled), and the last 30 minutes stay at 2 s.
 * Run: node test/load-series.mjs
 */
import assert from 'node:assert/strict'
import { addLoadSample } from '../lib/pipeline.js'

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${name}\n      ${error.stack?.split('\n').slice(0, 4).join('\n      ')}`)
  }
}

// Five hours of 2 s readings. Calls completed so far grow by one per reading,
// so done[0] counts readings and shows how much time each point covers.
function run(readings, load = () => 4) {
  const series = { step: 2000, points: [] }
  for (let i = 0; i < readings; i += 1) {
    addLoadSample(series, {
      points: [load(i), 1, 8, 2],
      limits: [4, i < 600 ? 4 : 64],
      done: [i + 1, (i + 1) * 100, i + 1, (i + 1) * 50],
      io: [(i + 1) * 300, (i + 1) * 900],
      srv: [[12, 8, 0.4], null],
    })
  }
  return series
}

check('全程：点数不超过 360，时间轴均匀（每个点覆盖同样多的读数）', () => {
  const series = run(9000)
  assert.ok(series.points.length <= 361 && series.points.length >= 180, String(series.points.length))
  const perPoint = series.step / 2000
  const gaps = new Set(series.done.slice(1).map((row, i) => row[0] - series.done[i][0]))
  assert.deepEqual([...gaps], [perPoint])
  // The span the step claims is the span the readings cover.
  assert.equal(series.done[series.done.length - 1][0] - series.done[0][0], (series.points.length - 1) * perPoint)
  for (const key of ['limits', 'done', 'io', 'srv']) assert.equal(series[key].length, series.points.length, key)
})

check('全程：在途请求取平均，不是抽样', () => {
  // Alternating 0 and 8: a dropped-sample series shows 0 or 8, the average 4.
  const series = run(4000, (i) => (i % 2 ? 8 : 0))
  for (const point of series.points) assert.equal(point[0], 4)
})

check('全程：上限和累计数取每段最后一个读数', () => {
  const series = run(4000)
  const last = series.done[series.done.length - 1][0]
  assert.equal(series.limits[series.limits.length - 1][1], 64)
  assert.ok(last <= 4000 && last > 4000 - series.step / 2000, String(last))
})

check('最近 30 分钟：保留 900 个 2 秒读数，最新的在最后', () => {
  const series = run(9000)
  assert.equal(series.recent.points.length, 900)
  assert.equal(series.recent.done[899][0], 9000)
  assert.equal(series.recent.done[0][0], 8101)
  for (const key of ['limits', 'done', 'io', 'srv']) assert.equal(series.recent[key].length, 900, key)
})

check('服务器读数缺失（null）时不报错，平均只算有读数的', () => {
  const series = run(800)
  for (const row of series.srv) {
    assert.deepEqual(row[0], [12, 8, 0.4])
    assert.equal(row[1], null)
  }
})

check('批次中途多了核验模型：读数形状变化，重新累计', () => {
  const series = { step: 2000, points: [] }
  addLoadSample(series, { points: [1, 0], limits: [4], done: [1, 1], io: [1], srv: [null] })
  addLoadSample(series, { points: [1, 0, 3, 1], limits: [4, 8], done: [2, 2, 1, 1], io: [2, 1], srv: [null, null] })
  assert.deepEqual(series.points[series.points.length - 1], [1, 0, 3, 1])
})

console.log(failures === 0 ? 'LOAD SERIES PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
