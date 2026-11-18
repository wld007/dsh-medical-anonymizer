/**
 * Minimal Word (.docx, WordprocessingML) writer for the formal assessment
 * report: headings, paragraphs with styled runs, and bordered tables. No
 * dependencies; the package is written with the plugin's own zip writer.
 *
 * Blocks:
 *   { type: 'title' | 'subtitle' | 'h1' | 'h2' | 'p' | 'note', runs }
 *   { type: 'table', widths: number[] (twentieths of a point), rows: Cell[][], header?: boolean }
 *   { type: 'pagebreak' }
 * runs: string | Run | Run[]; Run = { text, bold?, color?, size? (half-points), red? }
 * Cell: string | Run[] | { runs, fill?, span? }
 */
import { chmod } from 'node:fs/promises'
import { writeZip } from './zip.js'

const RED = 'C00000'
const PAGE_WIDTH = 9638 // A4 minus 2 cm margins on each side, in twips

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Characters XML 1.0 does not allow.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
}

function runsOf(value) {
  if (value === null || value === undefined) return []
  if (typeof value === 'string' || typeof value === 'number') return [{ text: String(value) }]
  if (Array.isArray(value)) return value.flatMap(runsOf)
  return [value]
}

function runXml(run) {
  const props = []
  if (run.bold) props.push('<w:b/><w:bCs/>')
  const color = run.red ? RED : run.color
  if (color) props.push(`<w:color w:val="${color}"/>`)
  if (run.size) props.push(`<w:sz w:val="${run.size}"/><w:szCs w:val="${run.size}"/>`)
  const rpr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''
  // Line breaks inside a run.
  return String(run.text ?? '').split('\n').map((part, index) =>
    `<w:r>${rpr}${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(part)}</w:t></w:r>`).join('')
}

function paragraphXml(style, runs, { align, keepNext } = {}) {
  const ppr = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    keepNext ? '<w:keepNext/>' : '',
    align ? `<w:jc w:val="${align}"/>` : '',
  ].join('')
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runsOf(runs).map(runXml).join('')}</w:p>`
}

function cellXml(cell, width, header) {
  const value = cell !== null && typeof cell === 'object' && !Array.isArray(cell) && 'runs' in cell ? cell : { runs: cell }
  const runs = runsOf(value.runs).map((run) => (header ? { ...run, bold: true } : run))
  const fill = value.fill ?? (header ? 'E7EEF2' : null)
  const tcpr = [
    `<w:tcW w:w="${width}" w:type="dxa"/>`,
    value.span > 1 ? `<w:gridSpan w:val="${value.span}"/>` : '',
    fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '',
    '<w:vAlign w:val="center"/>',
  ].join('')
  return `<w:tc><w:tcPr>${tcpr}</w:tcPr>${paragraphXml('TableText', runs)}</w:tc>`
}

function tableXml(block) {
  const columns = block.widths ?? []
  const total = columns.reduce((sum, w) => sum + w, 0) || PAGE_WIDTH
  const scale = PAGE_WIDTH / total
  const widths = columns.map((w) => Math.round(w * scale))
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="8A9BA3"/>`
  const rows = block.rows.map((row, r) => {
    let at = 0
    const cells = row.map((cell) => {
      const span = (cell && typeof cell === 'object' && !Array.isArray(cell) && cell.span) || 1
      const width = widths.slice(at, at + span).reduce((sum, w) => sum + w, 0)
      at += span
      return cellXml(cell, width, block.header !== false && r === 0)
    }).join('')
    const trpr = block.header !== false && r === 0 ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>'
    return `<w:tr>${trpr}${cells}</w:tr>`
  }).join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="${PAGE_WIDTH}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>${paragraphXml('Spacer', '')}`
}

const STYLE_OF = { title: 'Title', subtitle: 'Subtitle', h1: 'Heading1', h2: 'Heading2', p: null, note: 'Note' }

export function documentXml(blocks) {
  const body = blocks.map((block) => {
    if (block.type === 'table') return tableXml(block)
    if (block.type === 'pagebreak') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    const align = block.type === 'title' || block.type === 'subtitle' ? 'center' : block.align
    return paragraphXml(STYLE_OF[block.type] ?? null, block.runs, { align, keepNext: block.type === 'h1' || block.type === 'h2' })
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1361" w:right="1134" w:bottom="1361" w:left="1134" w:header="851" w:footer="851" w:gutter="0"/></w:sectPr></w:body></w:document>`
}

const FONTS = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>'
const HEI = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="黑体" w:cs="Times New Roman"/>'

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${FONTS}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="120"/><w:jc w:val="center"/></w:pPr><w:rPr>${HEI}<w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="44545B"/><w:sz w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr>${HEI}<w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr>${HEI}<w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="5B6B72"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="260" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Spacer"><w:name w:val="Spacer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60" w:line="160" w:lineRule="exact"/></w:pPr></w:style>
</w:styles>`

function footerXml(text) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="7A8A90"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${esc(text)}  第 </w:t></w:r><w:r><w:rPr><w:color w:val="7A8A90"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="7A8A90"/><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:color w:val="7A8A90"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r><w:r><w:rPr><w:color w:val="7A8A90"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve"> 页</w:t></w:r></w:p></w:ftr>`
}

/**
 * Write a .docx (mode 0600: the report names local paths).
 * @param {string} path
 * @param {{ blocks: object[], title?: string, footer?: string }} doc
 */
export async function writeDocx(path, { blocks, title = '', footer = '' }) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>dsh-medical-anonymizer</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
    'word/document.xml': documentXml(blocks),
    'word/styles.xml': STYLES,
    'word/footer1.xml': footerXml(footer),
  }
  await writeZip(path, Object.entries(files).map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })))
  await chmod(path, 0o600).catch(() => {})
}
