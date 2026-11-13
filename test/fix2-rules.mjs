/**
 * Regression tests for review findings #18–#25 and #49: detection rules
 * (pseudonym look-alikes, labelled names, hospitals, phones, ID cards,
 * addresses, bank cards), the mask strategy and month-only date shifting.
 * Run: node test/fix2-rules.mjs
 */
import assert from 'node:assert/strict'
import { readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scan, isPseudonym } from '../lib/rules.js'
import { maskValue, insideProtected, quasiReplacements, isProtectedText, resolvePolicy } from '../lib/policy.js'
import { createPathAnonymizer } from '../lib/paths.js'
import { runBatch, echoesPseudonym } from '../lib/pipeline.js'
import { outDirOf, outJoin } from './outputs.mjs'
import { Vault } from '../lib/pseudonym.js'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'fix2-rules')

await rm(tmp, { recursive: true, force: true })
let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${name}\n      ${error.stack?.split('\n').slice(0, 4).join('\n      ')}`)
  }
}

const hits = (text, type, options = { landline: true }) => scan(text, options).filter((hit) => !type || hit.type === type)
const texts = (text, type, options) => hits(text, type, options).map((hit) => hit.text)
/** Every hit's text must be the exact span of the input. */
function spansExact(text, options = { landline: true }) {
  for (const hit of scan(text, options)) assert.equal(text.slice(hit.start, hit.end), hit.text, JSON.stringify(hit))
}

/* ------------------------------------------------------------------ #18 */

await check('#18 「标签-数字」不是化名：电话-手机号、证件-身份证号仍被检出', async () => {
  assert.deepEqual(texts('联系人：张三 电话-13800138000', '电话'), ['13800138000'])
  assert.deepEqual(texts('证件-11010519491231002X', '身份证号'), ['11010519491231002X'])
  assert.deepEqual(texts('病历-13912345678 复诊', '电话'), ['13912345678'])
  assert.deepEqual(texts('银行卡-6222020200001234562', '银行卡号'), ['6222020200001234562'])
  // The policy guard no longer treats them as protected output.
  assert.equal(insideProtected('电话-13800138000', 3, 14), false)
  assert.equal(insideProtected('证件-11010519491231002X', 3, 21), false)
  // Model detections of these values are not "echoes" of a pseudonym.
  assert.equal(echoesPseudonym('电话-13800138000', '13800138000'), false)
  assert.equal(echoesPseudonym('证件-11010519491231002X', '11010519491231002X'), false)
  // An 8-digit landline written as "电话-66809363" is not a pseudonym.
  assert.equal(isPseudonym('电话-66809363'), false)
  assert.equal(isPseudonym('电话-13800138000'), false)
})

await check('#18 真化名仍受保护（含字母的 6 位码，以及本库签发的纯数字码）', async () => {
  assert.equal(isPseudonym('化名-9F3A2C'), true)
  assert.equal(isPseudonym('患者-1A2B3C4D'), true) // DICOM path code
  assert.equal(insideProtected('至医院-97BDA1就诊', 1, 9), true)
  assert.deepEqual(texts('至医院-97BDA1就诊', '医院'), [])
  assert.equal(echoesPseudonym('证件-294CD0 复查', '294CD0'), true)
  // A decimal-only code is protected only when the plugin issued it.
  const issued = new Set(['病历-123456'])
  assert.equal(insideProtected('病历-123456', 3, 9, undefined, (token) => issued.has(token)), true)
  assert.equal(insideProtected('病历-654321', 3, 9, undefined, (token) => issued.has(token)), false)
  assert.equal(isPseudonym('病历-123456', (token) => issued.has(token)), true)
  assert.equal(isPseudonym('病历-123456'), false)
  assert.equal(insideProtected('病历-123456', 3, 9), false)
  // An issued token glued to more digits is still the token.
  assert.equal(insideProtected('病历-9F3A2C01', 3, 9, undefined, (token) => token === '病历-9F3A2C'), true)
  assert.equal(insideProtected('病历-9F3A2C01', 3, 9), false)
  // DICOM path codes: 8 hex with a letter; 8 plain digits are a real number.
  assert.equal(isPseudonym('住院-20240301'), false)
  assert.equal(insideProtected('住院-20240301 出院', 3, 11), false)
  assert.equal(insideProtected('患者-1A2B3C4D 复查', 3, 11), true)
})

await check('#18 映射库不再签发纯数字代码（与真实编号无法区分）', async () => {
  const vault = new Vault(join(tmp, 'vault-digits.json'))
  vault.salt = 'fixed-salt-for-test'
  for (let i = 0; i < 400; i += 1) {
    const code = vault.codeFor('病历号', `MRN${i}`)
    assert.match(code, /^[0-9A-F]{6}$/)
    assert.match(code, /[A-F]/, code)
    assert.equal(isPseudonym(`病历-${code}`), true)
  }
  assert.equal(vault.codeFor('病历号', 'MRN1'), vault.codeFor('病历号', 'MRN1'), 'stable')
})

await check('#18 端到端：「电话-手机号」在规则模式下被替换，不原样交付', async () => {
  const { out, run } = await batch('r18', { 'a.txt': '联系人：张三 电话-13800138000\n家属 证件-11010519491231002X\n' })
  const text = await readFile(outJoin(out, 'a.txt'), 'utf8')
  assert.ok(!text.includes('13800138000'), text)
  assert.ok(!text.includes('11010519491231002X'), text)
  assert.ok(run.files.length === 1)
})

/* ------------------------------------------------------------------ #19 */

await check('#19 带「·」的长姓名完整检出', async () => {
  assert.deepEqual(texts('姓名：买买提·艾力江 性别：男', '姓名'), ['买买提·艾力江'])
  assert.deepEqual(texts('患者：阿卜杜热依木·买买提明，男，45岁', '姓名'), ['阿卜杜热依木·买买提明'])
  assert.deepEqual(texts('姓名：爱新觉罗·溥仪', '姓名'), ['爱新觉罗·溥仪'])
})

await check('#19 中间有空格的姓名（表单对齐）被检出，范围精确', async () => {
  assert.deepEqual(texts('姓名：张 三', '姓名'), ['张 三'])
  assert.deepEqual(texts('姓  名：王  五  性别：女', '姓名'), ['王  五'])
  spansExact('姓  名：王  五  性别：女')
  // Sex/ethnicity after a space are not part of the name.
  assert.deepEqual(texts('姓名：张三 男 45岁', '姓名'), ['张三'])
  assert.deepEqual(texts('患者：女 汉族', '姓名'), [])
})

await check('#19 不吞并下一个标签', async () => {
  assert.deepEqual(texts('姓名:张三性别:男', '姓名'), ['张三'])
  assert.deepEqual(texts('姓名：李四年龄：45', '姓名'), ['李四'])
  assert.deepEqual(texts('联系人：赵六电话：13800138000', '姓名'), ['赵六'])
  assert.deepEqual(texts('医生：王强科室：内科', '医生'), ['王强'])
  // A 3-character name before a label cut in half by the length limit.
  assert.deepEqual(texts('患者：张三丰性别：男', '姓名'), ['张三丰'])
  // Names that happen to end in common characters stay whole.
  assert.deepEqual(texts('姓名：张亚男，女', '姓名'), ['张亚男'])
  assert.deepEqual(texts('姓名：欧阳娜娜', '姓名'), ['欧阳娜娜'])
})

await check('#19 Markdown 加粗标签', async () => {
  const text = '**姓名**：张三，**住址**：杭州市西湖区文三路100号'
  const found = scan(text)
  assert.ok(found.some((hit) => hit.type === '姓名' && hit.text === '张三'), JSON.stringify(found))
  assert.ok(found.some((hit) => hit.type === '地址' && hit.text === '杭州市西湖区文三路100号'), JSON.stringify(found))
  assert.deepEqual(texts('**病历号：**MRN20240301', '病历号'), ['MRN20240301'])
})

await check('#19 误报：标签后是字段名、性别、"无"时不当作姓名', async () => {
  assert.deepEqual(texts('姓名：性别：', '姓名'), [])
  assert.deepEqual(texts('家属：无', '姓名'), [])
  assert.deepEqual(texts('患者：男，45岁', '姓名'), [])
})

/* ------------------------------------------------------------------ #20 */

await check('#20 在/于/到/从 之后的医院名被检出（去掉前导介词，不整段丢弃）', async () => {
  assert.deepEqual(texts('2周前，在北京协和医院就诊', '医院'), ['北京协和医院'])
  assert.deepEqual(texts('，于浙江省人民医院行手术', '医院'), ['浙江省人民医院'])
  assert.deepEqual(texts('，到杭州市第一人民医院复查', '医院'), ['杭州市第一人民医院'])
  assert.deepEqual(texts('1月前从温州市中心医院转入', '医院'), ['温州市中心医院'])
  assert.deepEqual(texts('月余前患者家属至老年医院', '医院'), ['老年医院'])
})

await check('#20 「…附属」不被拆开，长院名完整', async () => {
  assert.deepEqual(texts('就诊于中山大学附属第一医院', '医院'), ['中山大学附属第一医院'])
  assert.deepEqual(texts('转浙江大学医学院附属邵逸夫医院', '医院'), ['浙江大学医学院附属邵逸夫医院'])
  assert.deepEqual(texts('曾于华中科技大学同济医学院附属同济医院手术', '医院'), ['华中科技大学同济医学院附属同济医院'])
  assert.deepEqual(texts('北京和睦家医院', '医院'), ['北京和睦家医院'])
  // Place names that start with a connective character stay whole.
  assert.deepEqual(texts('广州市从化区中医医院', '医院'), ['广州市从化区中医医院'])
  assert.deepEqual(texts('在于都县人民医院住院', '医院'), ['于都县人民医院'])
  assert.deepEqual(texts('在张氏诊所就诊', '医院'), ['张氏诊所'])
})

await check('#20 误报：通用机构名、本院/我院不检出', async () => {
  for (const text of ['到医院就诊', '区属医院', '中医院发热门诊', '在我院治疗', '转上级医院', '于本医院复查', '建议至专科医院就诊']) {
    assert.deepEqual(texts(text, '医院'), [], text)
  }
})

/* ------------------------------------------------------------------ #21 */

await check('#21 手机：+86/0086 前缀、空格/短横分组', async () => {
  assert.deepEqual(texts('手机：+8613800138000', '电话'), ['13800138000'])
  assert.deepEqual(texts('手机：+86 13800138000', '电话'), ['13800138000'])
  assert.deepEqual(texts('手机：0086-13800138000', '电话'), ['13800138000'])
  assert.deepEqual(texts('手机：138 0013 8000', '电话'), ['138 0013 8000'])
  assert.deepEqual(texts('Tel: 138-0013-8000', '电话'), ['138-0013-8000'])
  assert.deepEqual(texts('联系 138 0013 8000 2024年复诊', '电话'), ['138 0013 8000'])
  assert.deepEqual(texts('手机 86 13800138000', '电话'), ['13800138000'])
  assert.deepEqual(texts('手机：１３８－００１３－８０００', '电话'), ['１３８－００１３－８０００'])
})

await check('#21 座机：括号区号、空格、无分隔（标签后）', async () => {
  assert.deepEqual(texts('电话：(010)66809363', '电话'), ['(010)66809363'])
  assert.deepEqual(texts('电话：（0571）88888888', '电话'), ['（0571）88888888'])
  assert.deepEqual(texts('电话：010 66809363', '电话'), ['010 66809363'])
  assert.deepEqual(texts('电话：0571 88888888', '电话'), ['0571 88888888'])
  assert.deepEqual(texts('电话：01066809363', '电话'), ['01066809363'])
  assert.deepEqual(texts('电话：057188888888', '电话'), ['057188888888'])
  assert.deepEqual(texts('座机：0571-88888888', '电话'), ['0571-88888888'])
})

await check('#21 误报：长数字串、日期、检验值、无标签的 0 开头长数字不当作电话', async () => {
  for (const text of [
    '流水号 2013800138000123', // inside a longer digit run
    '12138 0013 8000', // spaced, but glued to a preceding digit
    '检验编号 0123456789012',
    '日期 2024-03-01 13:45',
    '白细胞 12.3 ×10^9/L，血小板 138 ×10^9/L',
    '剂量 0.5 mg 每日 3 次',
    '单号 01066809363', // 0-leading digits without a phone label
    '编号 010 0123456', // local number cannot start with 0
    '编号 8613800138000', // "86" glued without "+"/"00" is a longer number
    '138 0013-8000', // mixed separators
  ]) {
    assert.deepEqual(texts(text, '电话'), [], text)
  }
})

/* ------------------------------------------------------------------ #22 */

await check('#22 15 位旧身份证号（日期有效）', async () => {
  assert.deepEqual(texts('身份证：110105491231002', '身份证号'), ['110105491231002'])
  assert.deepEqual(texts('证件号 330102800101123，复查', '身份证号'), ['330102800101123'])
  // Invalid date / region, or part of a longer run: not an ID.
  assert.deepEqual(texts('编号 110105491331002', '身份证号'), [])
  assert.deepEqual(texts('编号 990105491231002', '身份证号'), [])
  assert.deepEqual(texts('编号 1101054912310021', '身份证号'), [])
})

await check('#22 全角数字：身份证号、手机号、银行卡按原文范围检出', async () => {
  const id = '身份证：１１０１０５１９４９１２３１００２Ｘ'
  assert.deepEqual(texts(id, '身份证号'), ['１１０１０５１９４９１２３１００２Ｘ'])
  spansExact(id)
  assert.deepEqual(texts('手机：１３８００１３８０００', '电话'), ['１３８００１３８０００'])
  assert.deepEqual(texts('卡号：６２２２０２０２００００１２３４５６２', '银行卡号'), ['６２２２０２０２００００１２３４５６２'])
  assert.deepEqual(texts('电话：０５７１－８８８８８８８８', '电话'), ['０５７１－８８８８８８８８'])
})

await check('#22 端到端：全角身份证号与 15 位身份证号不原样交付', async () => {
  const { out } = await batch('r22', { 'b.txt': '身份证：１１０１０５１９４９１２３１００２Ｘ\n旧证：110105491231002\n' })
  const text = await readFile(outJoin(out, 'b.txt'), 'utf8')
  assert.ok(!text.includes('１１０１０５１９４９１２３１００２Ｘ'), text)
  assert.ok(!text.includes('110105491231002'), text)
})

/* ------------------------------------------------------------------ #23 */

await check('#23 地址后隔一个空格跟电话/身份证：地址与号码都被检出', async () => {
  let found = scan('住址：杭州市西湖区文三路100号 13800138000')
  assert.ok(found.some((hit) => hit.type === '地址' && hit.text === '杭州市西湖区文三路100号'), JSON.stringify(found))
  assert.ok(found.some((hit) => hit.type === '电话' && hit.text === '13800138000'), JSON.stringify(found))
  found = scan('现住址：浙江省杭州市上城区解放路8号 11010519491231002X 联系人：李四')
  assert.ok(found.some((hit) => hit.type === '地址' && hit.text === '浙江省杭州市上城区解放路8号'), JSON.stringify(found))
  assert.ok(found.some((hit) => hit.type === '身份证号'), JSON.stringify(found))
  found = scan('家庭住址：北京市朝阳区幸福路1号 zhangsan@example.com')
  assert.ok(found.some((hit) => hit.type === '地址' && hit.text === '北京市朝阳区幸福路1号'), JSON.stringify(found))
  // Glued: the address keeps the part before the stronger identifier.
  found = scan('住址：杭州市西湖区文三路100号13800138000')
  assert.ok(found.some((hit) => hit.type === '地址' && hit.text === '杭州市西湖区文三路100号' && hit.end === 16), JSON.stringify(found))
  assert.ok(found.some((hit) => hit.type === '电话' && hit.text === '13800138000'), JSON.stringify(found))
  // A house number after one space is still part of the address.
  assert.deepEqual(texts('住址：杭州市西湖区文三路 100号', '地址'), ['杭州市西湖区文三路 100号'])
})

/* ------------------------------------------------------------------ #24 */

await check('#24 银行卡：后面跟数字不再整体漏检；4 位分组卡号检出', async () => {
  assert.deepEqual(texts('卡号 6222020200001234562 1张', '银行卡号'), ['6222020200001234562'])
  assert.deepEqual(texts('卡号 6222 0202 0000 1234 562', '银行卡号'), ['6222 0202 0000 1234 562'])
  assert.deepEqual(texts('卡号 6222-0202-0000-1234-562 已绑定', '银行卡号'), ['6222-0202-0000-1234-562'])
  assert.deepEqual(texts('卡号 4111 1111 1111 1111', '银行卡号'), ['4111 1111 1111 1111'])
  assert.deepEqual(texts('卡号 4111 1111 1111 1111 12张', '银行卡号'), ['4111 1111 1111 1111'])
})

await check('#24 误报：日期对、时间戳、长数字串不当作银行卡', async () => {
  for (const day of ['09', '17', '25', '01']) {
    const text = `入院日期 2024-03-01 2024-03-${day}`
    assert.deepEqual(texts(text, '银行卡号'), [], text)
  }
  assert.deepEqual(texts('时间 20240301123045120', '银行卡号'), [])
  assert.deepEqual(texts('编号 62220202000012345620', '银行卡号'), []) // 20 digits
  assert.deepEqual(texts('检验 1234 5678 9012 3', '银行卡号'), [])
})

/* ------------------------------------------------------------------ #25 */

await check('#25 掩码至少隐藏一半/4 位以上，短值全遮，地址不原样返回', async () => {
  const hidden = (value) => [...value].filter((ch) => ch === '*').length
  const shown = (original, masked) => [...masked].filter((ch, i) => ch !== '*' && /[0-9A-Za-z]/.test(ch) && ch === [...original][i]).length
  for (const [type, value] of [
    ['电话', '66809363'], ['电话', '6680936'], ['病历号', '123456'], ['住院号', 'ZY12345'],
    ['就诊号', '12345'], ['社保号', 'SB1101051949'], ['电话', '13800138000'], ['身份证号', '11010519491231002X'],
    ['银行卡号', '6222020200001234567'], ['电话', '0571-88888888'],
  ]) {
    const masked = maskValue(type, value)
    const classChars = [...value].filter((ch) => /[0-9A-Za-z]/.test(ch)).length
    assert.notEqual(masked, value, `${type} ${value}`)
    assert.ok(hidden(masked) >= Math.max(4, Math.ceil(classChars / 3)), `${type} ${value} -> ${masked}`)
    assert.ok(shown(value, masked) <= 7, `${type} ${value} -> ${masked}`)
    assert.ok(isProtectedText(masked, new Set()), masked)
  }
  assert.equal(maskValue('电话', '66809363'), '****9363')
  assert.equal(maskValue('病历号', '123456'), '****56')
  assert.equal(maskValue('就诊号', '1234'), '****')
  // Existing well-known shapes stay.
  assert.equal(maskValue('电话', '13800138000'), '138****8000')
  assert.equal(maskValue('身份证号', '11010519491231002X'), '110***********002X')
  // Addresses always hide at least their last component.
  for (const value of ['浙江省杭州市西湖区', '杭州市', '北京市朝阳区', '文三路100号', '内蒙古自治区呼和浩特市新城区']) {
    const masked = maskValue('地址', value)
    assert.notEqual(masked, value, value)
    assert.ok(masked.endsWith('****'), masked)
  }
  assert.equal(maskValue('地址', '浙江省杭州市西湖区'), '浙江省杭州市****')
  assert.equal(maskValue('地址', '北京市朝阳区幸福路1号'), '北京市朝阳区****')
  assert.equal(maskValue('地址', '杭州市'), '****')
  // No mask equals its input, whatever the type.
  for (const [type, value] of [['姓名', '张三'], ['医生', '李'], ['邮箱', 'a@b.cn'], ['医院', '北京协和医院'], ['社保号', 'ab']]) {
    assert.notEqual(maskValue(type, value), value, `${type} ${value}`)
  }
})

/* ------------------------------------------------------------------ #49 */

const apply = (text, replacements) => {
  let out = text
  for (const item of [...replacements].sort((a, b) => b.start - a.start)) out = out.slice(0, item.start) + item.replacement + out.slice(item.end)
  return out
}
const quasi = (text, strategies, extra = {}, days = 37) => apply(text, quasiReplacements({ text, ...extra }, strategies, days))

await check('#49 仅年月的日期与完整日期一起平移，不暴露真实月份', async () => {
  assert.equal(quasi('2024年3月起病，2024年3月15日入院', { 日期: 'shift' }), '2024年4月起病，2024年4月21日入院')
  assert.equal(quasi('2024-03 复查，2024-03-15 入院', { 日期: 'shift' }), '2024-04 复查，2024-04-21 入院')
  assert.equal(quasi('2024/03 复查', { 日期: 'shift' }), '2024/04 复查')
  assert.equal(quasi('2023年12月起病', { 日期: 'shift' }, {}, 37), '2024年1月起病')
  assert.equal(quasi('2024年1月起病', { 日期: 'shift' }, {}, -40), '2023年12月起病')
  assert.equal(quasi('202403', { 日期: 'shift' }, { quasi: '日期' }), '202404')
  // Other strategies treat year-month consistently.
  assert.equal(quasi('2024-03 复查', { 日期: 'year' }), '2024 复查')
  assert.equal(quasi('2024-03 复查', { 日期: 'redact' }), '[日期] 复查')
  assert.equal(quasi('2024年3月起病', { 日期: 'redact' }), '[日期]起病')
})

await check('#49 误报：无效日期、数值保持原样；日无后缀时按完整日期平移', async () => {
  assert.equal(quasi('2024-02-30', { 日期: 'shift' }), '2024-02-30')
  assert.equal(quasi('2024-13 号床', { 日期: 'shift' }), '2024-13 号床')
  assert.equal(quasi('编号 12024-03', { 日期: 'shift' }), '编号 12024-03')
  assert.equal(quasi('2024年3月15入院', { 日期: 'shift' }), '2024年4月21入院') // day without 日 is still a full date
  // "150" is not a day; the month before it still moves with the others.
  assert.equal(quasi('2024年3月150', { 日期: 'shift' }), '2024年4月150')
  assert.equal(quasi('血糖 2024.03', { 日期: 'shift' }), '血糖 2024.03')
  assert.equal(quasi('202403', { 日期: 'shift' }), '202403') // compact only in date fields
})

/* ------------------------------------------- review round 2 regressions */

await check('R1 号码紧挨 ASCII 字母时仍检出（手机、座机、银行卡）', async () => {
  for (const [text, want] of [
    ['TEL13800138000', '13800138000'],
    ['zhangsan13800138000', '13800138000'],
    ['13800138000a', '13800138000'],
    ['ID13912345678x', '13912345678'],
    ['tel0571-88888888', '0571-88888888'],
    ['Tel:0571-88888888ext', '0571-88888888'],
    ['tel+8613800138000', '13800138000'],
  ]) {
    assert.deepEqual(texts(text, '电话'), [want], text)
  }
  assert.deepEqual(texts('card6222020200001234562', '银行卡号'), ['6222020200001234562'])
  assert.deepEqual(texts('No6222020200001234562end', '银行卡号'), ['6222020200001234562'])
  assert.deepEqual(texts('电话：057188888888ext', '电话'), ['057188888888'])
  // Still not inside a longer digit run.
  assert.deepEqual(texts('A2013800138000123', '电话'), [])
})

await check('R1 端到端：字母旁的号码在规则模式下被替换（正文、文件名、CSV）', async () => {
  await batch('rr1', {
    'a.txt': '联系方式 TEL13800138000\n银行卡 card6222020200001234562\n',
    'zhangsan13700137000.txt': '无\n',
    'c.csv': '姓名,电话\n王五,TEL13800138000\n',
  })
  const out = join(tmp, 'out-rr1')
  const report = JSON.parse(await readFile(join(out, '_records', 'runs', 'rr1', 'report.json'), 'utf8'))
  const delivered = await outDirOf(out, 'rr1')
  const a = await readFile(join(delivered, 'a.txt'), 'utf8')
  assert.ok(!a.includes('13800138000') && !a.includes('6222020200001234562'), a)
  const c = await readFile(join(delivered, 'c.csv'), 'utf8')
  assert.ok(!c.includes('13800138000'), c)
  assert.ok(!JSON.stringify(report).includes('13700137000'), 'file name kept the phone')
})

await check('R2 「YYYY年M月」后的数字不是日（型、周、次、个……）', async () => {
  assert.equal(quasi('2019年5月2型糖尿病确诊', { 日期: 'shift' }), '2019年6月2型糖尿病确诊')
  assert.equal(quasi('2019年5月2型糖尿病确诊', { 日期: 'month' }), '2019年5月2型糖尿病确诊')
  assert.equal(quasi('2019年5月2型糖尿病确诊', { 日期: 'year' }), '2019年2型糖尿病确诊')
  assert.equal(quasi('2019年5月2型糖尿病确诊', { 日期: 'redact' }), '[日期]2型糖尿病确诊')
  assert.equal(quasi('2024年3月2周后复查', { 日期: 'shift' }), '2024年4月2周后复查')
  assert.equal(quasi('2024年3月3次化疗', { 日期: 'shift' }), '2024年4月3次化疗')
  assert.equal(quasi('2024年3月2个疗程', { 日期: 'shift' }), '2024年4月2个疗程')
  assert.equal(quasi('2024年3月5mg口服', { 日期: 'shift' }), '2024年4月5mg口服')
  assert.equal(quasi('2024年3月1.5cm结节', { 日期: 'shift' }), '2024年4月1.5cm结节')
  assert.equal(quasi('2024年3月10%', { 日期: 'shift' }), '2024年4月10%')
  // A day with 日/号, or a bare day before prose or punctuation, is still a day.
  assert.equal(quasi('2024年3月15日入院', { 日期: 'shift' }), '2024年4月21日入院')
  assert.equal(quasi('2024年3月15入院', { 日期: 'shift' }), '2024年4月21入院')
  assert.equal(quasi('2024年3月15，入院', { 日期: 'shift' }), '2024年4月21，入院')
  assert.equal(quasi('2024年3月15', { 日期: 'shift' }), '2024年4月21')
})

await check('R2 端到端：月份后的计数/分型在日期平移时不变', async () => {
  const input = join(tmp, 'in-rr2')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'a.txt'), '2019年5月2型糖尿病确诊，2024年3月2周后复查，2024年3月3次化疗。\n')
  const root = join(tmp, 'out-rr2')
  await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'rr2', maxRounds: 2, llm: null, policy: { quasiIdentifiers: true } } })
  const text = await readFile(outJoin(await outDirOf(root, 'rr2'), 'a.txt'), 'utf8')
  assert.match(text, /^\d{4}年\d{1,2}月2型糖尿病确诊，\d{4}年\d{1,2}月2周后复查，\d{4}年\d{1,2}月3次化疗。/, text)
  // The shift comes from the vault's random salt; a shift of a couple of
  // weeks can leave the month as it was, so check it against the shift.
  const { dateShiftDays } = await import('../lib/policy.js')
  const { Vault } = await import('../lib/pseudonym.js')
  const vault = new Vault(join(root, '_records', 'vault.json'))
  await vault.load()
  const moved = new Date(Date.UTC(2019, 4, 15) + dateShiftDays(vault.salt) * 86400000)
  assert.ok(text.startsWith(`${moved.getUTCFullYear()}年${moved.getUTCMonth() + 1}月2型糖尿病确诊`), `${text} (shift ${dateShiftDays(vault.salt)})`)
})

await check('R9 用 + 连接的编码列表（检验项目码）不当作无法解读的内容', async () => {
  const { isCodeList } = await import('../lib/layers.js')
  assert.ok(isCodeList('LIS10234+LIS567+LIS89012'))
  assert.ok(!isCodeList('Q3Jhc2g+dGVzdC9mb28xMjM0NTY3ODkw'))
  const input = join(tmp, 'in-r9')
  await mkdir(input, { recursive: true })
  const rows = Array.from({ length: 4 }, (_, i) => ({ TEST_ITM_CD: 'LIS10234+LIS56789+LIS90123+LIS445566+LIS77881+LIS3' + i, TEST_ITM_NM: '血常规' }))
  await writeFile(join(input, 'a.json'), JSON.stringify(rows))
  const root = join(tmp, 'out-r9')
  const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'r9', maxRounds: 1, llm: null } })
  const codes = run.files.flatMap((file) => (file.issues ?? []).map((issue) => issue.code))
  assert.ok(!codes.includes('unreadable') && !codes.includes('opaque-token'), codes.join(','))
})

await check('R3 路径：「标签-号码」中的号码被替换（文件名、目录名、报告）', async () => {
  const vault = new Vault(join(tmp, 'vault-paths.json'))
  await vault.load()
  const mapper = createPathAnonymizer({ vault, policy: resolvePolicy({}) })
  for (const path of ['电话-13800138000/a.txt', '证件-11010519491231002X.txt', '报告_电话-13800138000/a.txt', '病历-13912345678.txt']) {
    const mapped = mapper.map(path)
    for (const secret of ['13800138000', '11010519491231002X', '13912345678']) assert.ok(!mapped.includes(secret), `${path} -> ${mapped}`)
  }
  // Real pseudonyms in a path stay whole.
  assert.equal(mapper.map('化名-9F3A2C/患者-1A2B3C4D.txt'), '化名-9F3A2C/患者-1A2B3C4D.txt')
  await batch('rr3', {
    '电话-13800138000.txt': '无\n',
    '证件-11010519491231002X.txt': '无\n',
    '报告_电话-13900139000/a.txt': '无\n',
  })
  const report = await readFile(join(tmp, 'out-rr3', '_records', 'runs', 'rr3', 'report.json'), 'utf8')
  for (const secret of ['13800138000', '11010519491231002X', '13900139000']) assert.ok(!report.includes(secret), `report.json has ${secret}`)
})

await check('R4 误报：社区/市区/本市/附近/多家/老家/当地/上述/大 + 医院 不是院名', async () => {
  for (const text of [
    '在社区医院就诊', '到社区医院复查', '在市区医院', '在本市医院', '到市医院', '在附近诊所', '辗转多家医院',
    '在老家医院', '在当地县医院', '在上述医院', '在大医院', '于小区诊所', '从市区医院转来', '到县医院', '回当地医院',
    '在家附近诊所', '去过几家医院', '转至外地医院', '在省医院', '曾在私人诊所', '到乡镇卫生院', '在村卫生院',
  ]) {
    assert.deepEqual(texts(text, '医院'), [], text)
  }
  // Real names after the same connectives are still found, without the connective.
  assert.deepEqual(texts('在社区医院就诊，后转杭州市第一人民医院', '医院'), ['杭州市第一人民医院'])
  assert.deepEqual(texts('在大连医院就诊', '医院'), ['大连医院'])
  assert.deepEqual(texts('在于都县人民医院住院', '医院'), ['于都县人民医院'])
  assert.deepEqual(texts('1月前从化州市人民医院转入', '医院'), ['化州市人民医院'])
  assert.deepEqual(texts('广州市从化区中医医院', '医院'), ['广州市从化区中医医院'])
})

await check('R4 端到端：一般性就诊描述不被替换成医院化名', async () => {
  const sentence = '患者在社区医院就诊，后到市医院复查，在附近诊所取药，辗转多家医院。'
  const { out } = await batch('rr4', { 'a.txt': `${sentence}\n` })
  const text = await readFile(outJoin(out, 'a.txt'), 'utf8')
  assert.equal(text, `${sentence}\n`)
})

await check('R5 地址紧挨电话：两者都替换，且不误报「假名嵌在字母/数字串中」', async () => {
  const { run, out } = await batch('rr5', { 'a.txt': '住址：杭州市西湖区文三路100号13800138000\n' })
  const text = await readFile(outJoin(out, 'a.txt'), 'utf8')
  assert.ok(!text.includes('13800138000') && !text.includes('文三路'), text)
  const record = JSON.parse(await readFile(join(tmp, 'out-rr5', '_records', 'runs', 'rr5', 'report.json'), 'utf8'))
  const issues = record.files.flatMap((file) => file.issues ?? [])
  assert.ok(!issues.some((issue) => issue.code === 'embedded'), JSON.stringify(issues))
  assert.equal(run.status, 'completed', JSON.stringify(issues))
})

await check('R6 姓名后的「.」不是姓名连接符', async () => {
  assert.deepEqual(texts('姓名：张三.性别：男', '姓名'), ['张三'])
  assert.deepEqual(texts('患者：张三.男.45岁', '姓名'), ['张三'])
  assert.deepEqual(texts('姓名：李四．女', '姓名'), ['李四'])
  assert.ok(!texts('医生：查房.病情稳定', '医生').some((value) => value.includes('.')))
  // "·"-joined names stay whole.
  assert.deepEqual(texts('姓名：买买提·艾力江.男', '姓名'), ['买买提·艾力江'])
})

await check('R6 端到端：「姓名：张三.性别」后文中的张三也被替换', async () => {
  const { out } = await batch('rr6', { 'a.txt': '姓名：张三.性别：男\n主诉：张三自述头痛三天。\n' })
  const text = await readFile(outJoin(out, 'a.txt'), 'utf8')
  assert.ok(!text.includes('张三'), text)
  assert.ok(text.includes('性别：男'), text)
})

await check('R7 银行卡：卡号标签后的不规则分组仍检出', async () => {
  for (const value of ['6222 0202 0000 1234562', '622202 0200001234562', '62220202 00001234562', '6222 020200001234562', '6222-0202-0000-1234562']) {
    assert.deepEqual(texts(`卡号 ${value}`, '银行卡号'), [value], value)
    assert.deepEqual(texts(`银行卡：${value}，已绑定`, '银行卡号'), [value], value)
  }
  // Date pairs are never cards, labelled or not.
  assert.deepEqual(texts('入院日期 2024-03-01 2024-03-09', '银行卡号'), [])
  assert.deepEqual(texts('卡号 2024-03-01 2024-03-09', '银行卡号'), [])
})

await check('R8 Markdown 表格行中的标签值被检出', async () => {
  const found = scan('| 姓名 | 张三 |\n| 病历号 | 123456 |\n| 住址 | 杭州市西湖区文三路100号 |\n| **医生** | 王强 |')
  const pairs = found.map((hit) => `${hit.type}:${hit.text}`)
  for (const want of ['姓名:张三', '病历号:123456', '地址:杭州市西湖区文三路100号', '医生:王强']) assert.ok(pairs.includes(want), JSON.stringify(pairs))
  assert.deepEqual(texts('| 性别 | 男 |\n| 患者 | 女 |', '姓名'), [])
})

await check('R8 端到端：Markdown 表格中的姓名、病历号、住址在规则模式下被替换', async () => {
  const { out } = await batch('rr8', { 'a.md': '| 姓名 | 张三 |\n| --- | --- |\n| 病历号 | 123456 |\n| 住址 | 杭州市西湖区文三路100号 |\n\n**姓名**：李四\n' })
  const text = await readFile(outJoin(out, 'a.md'), 'utf8')
  for (const secret of ['张三', '123456', '文三路', '李四']) assert.ok(!text.includes(secret), text)
  assert.ok(text.startsWith('| 姓名 | '), text)
})

/* ------------------------------------------------- benchmark findings */

await check('分组书写的身份证号（6-8-4 / 4 位一组）被识别，校验位不对的不算', () => {
  assert.deepEqual(texts('身份证号：330106 19711001 4158  联系电话', '身份证号'), ['330106 19711001 4158'])
  assert.deepEqual(texts('证号 3301-0619-7110-0141-58 x', '身份证号'), ['3301-0619-7110-0141-58'])
  assert.deepEqual(texts('编号 330106 19711001 4159', '身份证号'), [])
  // Mixed separators are not one number.
  assert.deepEqual(texts('330106 19711001-4158', '身份证号'), [])
  spansExact('委托人身份证号：330106 19711001 4158，电话 152-7000-0000')
})

await check('医院名前的医护职称、"与/已"不并入医院名', () => {
  assert.deepEqual(texts('主治医师秦子芳已与绍兴市中心医院的叶萍华医生电话沟通', '医院'), ['绍兴市中心医院'])
  assert.deepEqual(texts('今日由主任医师联系浙江省立同德医院', '医院'), ['浙江省立同德医院'])
  assert.deepEqual(texts('既往在北京协和医院与浙江省人民医院就诊', '医院'), ['北京协和医院', '浙江省人民医院'])
})

await check('识别与核验都报出、只因格式不符未替换的值进入人工复核', async () => {
  const value = 'ABCD-1234-XYZ'
  const scripted = (both) => ({
    model: 'scripted',
    async chatJson(messages) {
      const prompt = messages.map((message) => message.content).join('\n')
      const segments = JSON.parse(prompt.slice(prompt.lastIndexOf('段落：') + 3))
      const holder = segments.find((segment) => segment.text.includes(value))
      if (prompt.includes('独立的数据安全审查员')) {
        return { json: { issues: both && holder ? [{ segment: holder.id, type: '身份证号', text: value, reason: '证件号' }] : [] } }
      }
      return { json: { entities: holder ? [{ segment: holder.id, type: '身份证号', text: value }] : [] } }
    },
  })
  for (const both of [true, false]) {
    const input = join(tmp, `in-agreed-${both}`)
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'note.txt'), `委托人证件：${value}，已签字。\n`)
    const run = await runBatch({ inputDir: input, outputRoot: join(tmp, `out-agreed-${both}`), options: { runId: `agreed-${both}`, maxRounds: 2, llm: scripted(both) } })
    const issues = run.files[0].issues
    const agreed = issues.filter((issue) => issue.code === 'implausible-agreed')
    if (both) {
      assert.equal(agreed.length, 1, JSON.stringify(issues))
      assert.equal(agreed[0].severity, 'error')
      assert.equal(agreed[0].review?.text, value)
      assert.ok(!agreed[0].detail.includes(value), 'value masked in report')
      assert.equal(run.files[0].status, 'review')
    } else {
      assert.equal(agreed.length, 0, JSON.stringify(issues))
      assert.ok(issues.some((issue) => issue.code === 'implausible' && issue.severity === 'warn'))
      assert.equal(run.files[0].status, 'clean')
    }
  }
})

/* --------------------------------------------------------------- helper */

async function batch(tag, files) {
  const input = join(tmp, `in-${tag}`)
  await mkdir(input, { recursive: true })
  for (const [name, data] of Object.entries(files)) {
    await mkdir(dirname(join(input, name)), { recursive: true })
    await writeFile(join(input, name), data)
  }
  const root = join(tmp, `out-${tag}`)
  const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: tag, maxRounds: 2, llm: null } })
  return { run, out: await outDirOf(root, tag) }
}

await rm(tmp, { recursive: true, force: true })
if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nFIX2-RULES PASS')
