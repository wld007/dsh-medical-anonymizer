/**
 * Local preview of the workspace page outside the Harness: serves client.js
 * with React and answers its RPC calls from the real service (read-only use;
 * no batch is started unless you click "start").
 *
 *   node scripts/preview-page.mjs <outputRoot> [port]
 *   open http://127.0.0.1:<port>/?run=<runId>
 *
 * Needs React 18 UMD files; set REACT_UMD_DIR to a node_modules folder that
 * holds react/umd and react-dom/umd.
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createService } from '../lib/service.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const outputRoot = process.argv[2]
const port = Number(process.argv[3] ?? 18766)
const umd = process.env.REACT_UMD_DIR
if (!outputRoot || !umd) {
  console.error('usage: REACT_UMD_DIR=<node_modules> node scripts/preview-page.mjs <outputRoot> [port]')
  process.exit(1)
}
const service = createService({ config: { outputRoot }, defaultDirectory: outputRoot })

const page = `<!doctype html><meta charset="utf-8"><title>preview</title>
<style>html,body,#root{margin:0;height:100%}
:root{--dsw-alias-bg-base:#0b1418;--dsw-alias-bg-layer-1:#111b20;--dsw-alias-bg-layer-2:#18242a;--dsw-alias-label-primary:#e6edef;--dsw-alias-label-secondary:#93a4a9;--dsw-alias-label-tertiary:#647479;--dsw-alias-border-l1:#1d2a30;--dsw-alias-border-l2:#2a3a41;--dsw-alias-state-success-primary:#3fbf6f;--dsw-alias-state-warn-primary:#f0a020;--dsw-alias-state-error-primary:#e5484d}
:root.light{--dsw-alias-bg-base:#f4f6f7;--dsw-alias-bg-layer-1:#ffffff;--dsw-alias-bg-layer-2:#eef2f3;--dsw-alias-label-primary:#1b2a2f;--dsw-alias-label-secondary:#5d6e73;--dsw-alias-label-tertiary:#8a989c;--dsw-alias-border-l1:#e3e9eb;--dsw-alias-border-l2:#d2dcdf;--dsw-alias-state-success-primary:#1f9d55;--dsw-alias-state-warn-primary:#d98a00;--dsw-alias-state-error-primary:#d23c3c}
body{background:var(--dsw-alias-bg-base);font-family:-apple-system,"PingFang SC",sans-serif}</style>
<script>if (new URLSearchParams(location.search).get('theme') === 'light') document.documentElement.classList.add('light')</script>
<div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>
  let def = null
  window.__ModuleLoader__ = { load(d) { def = d } }
</script>
<script src="/client.js"></script>
<script>
  const plugin = def.factory((name) => (name === 'react' ? React : {}))
  let Page = null
  const ctx = {
    get(name) {
      if (name === 'connection') return { rpc: { call: (_channel, endpoint, payload) => fetch('/rpc/' + endpoint, { method: 'POST', body: JSON.stringify(payload ?? {}) }).then((r) => r.json()) } }
      if (name === 'uiWorkspace') return { openSession() {} }
      return null
    },
    locale: { getLocale: () => ({ active: 'zh' }), t: null },
    slots: {
      inject: (_name, fn) => { fn(); return () => {} },
      register: (opts, component) => { if (opts.name === 'main') Page = component; return () => {} },
    },
  }
  plugin.apply(ctx)
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Page))
  // ?station=blind clicks that station once the page has data (for screenshots).
  if (new URLSearchParams(location.search).get('open') === 'runs') {
    const tm = setInterval(() => { const b = document.querySelector('.wd-switch'); if (b && document.querySelectorAll('.wd-st').length) { b.click(); clearInterval(tm) } }, 200)
  }
  const pick = new URLSearchParams(location.search).get('station')
  if (pick) {
    const order = ['prescan', 'read', 'discover', 'rules', 'blind', 'repair', 'rescan', 'pack', 'review', 'deliver']
    const timer = setInterval(() => {
      const nodes = document.querySelectorAll('.wd-st')
      if (nodes.length === 10) { nodes[order.indexOf(pick)].dispatchEvent(new MouseEvent('click', { bubbles: true })); clearInterval(timer) }
    }, 200)
  }
</script>`

const handlers = {
  config: () => service.configInfo(),
  list: () => service.list(),
  status: (p) => service.status(p.runId),
  report: (p) => service.report(p.runId),
  advice: (p) => service.advice(p.runId),
  calls: (p) => service.calls(p.runId, p.since),
  crossCheck: (p) => service.crossCheck(p.runId),
  reviewItems: (p) => service.reviewItems(p.runId),
  compareList: (p) => service.compareList(p.runId),
  compareFile: (p) => service.compareFile(p.runId, p.n),
  opaquePreview: (p) => service.opaquePreview(p.runId, p.itemId),
}

http.createServer(async (req, res) => {
  try {
    if (req.url === '/' || req.url.startsWith('/?')) { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(page) }
    if (req.url === '/react.js') return res.end(await readFile(join(umd, 'react/umd/react.production.min.js')))
    if (req.url === '/react-dom.js') return res.end(await readFile(join(umd, 'react-dom/umd/react-dom.production.min.js')))
    if (req.url === '/client.js') { res.setHeader('content-type', 'text/javascript'); return res.end(await readFile(join(root, 'client.js'))) }
    if (req.url.startsWith('/rpc/')) {
      const endpoint = req.url.slice(5)
      let body = ''
      for await (const chunk of req) body += chunk
      const handler = handlers[endpoint]
      if (!handler) return res.end(JSON.stringify({ ok: false, error: { message: `preview: ${endpoint} not available` } }))
      try { return res.end(JSON.stringify({ ok: true, value: await handler(JSON.parse(body || '{}')) })) } catch (error) { return res.end(JSON.stringify({ ok: false, error: { message: String(error?.message ?? error) } })) }
    }
    res.statusCode = 404
    res.end()
  } catch (error) { res.statusCode = 500; res.end(String(error)) }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`))
