/**
 * Synthetic, labelled medical corpus for the anonymization benchmark.
 *
 *   node eval/bench/gen.mjs <workDir> [seed]
 *
 * Writes <workDir>/corpus/** and <workDir>/gold.json. Deterministic (seeded).
 * Everything is invented: people, numbers, places and institutions (fictional
 * cities such as 东江市, 云溪县); identity numbers only have the right shape
 * and checksum.
 *
 * gold.json, per file:
 *   identifiers  [{ type, text, start, end, case }] — must be replaced.
 *                `case` names the difficulty (labelled field, name in prose,
 *                grouped number, coded field name, template markup …).
 *   decoys       [{ text, cat }] — must survive unchanged (eponymous
 *                diseases and signs, herbs that read like names, wards,
 *                codes, approval numbers, timestamps, masked values …).
 *   neutral      [{ text, start, end, why }] — debatable values (organisation
 *                codes, specimen barcodes, a birthplace county): neither a
 *                leak when kept nor over-redaction when replaced.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'

const outDir = process.argv[2] ?? 'eval/bench/.tmp'
const seed = Number(process.argv[3] ?? 20261113)

let state = seed >>> 0
const rand = () => {
  state = (state + 0x6D2B79F5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (list) => list[Math.floor(rand() * list.length)]
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
const digits = (n) => Array.from({ length: n }, (_, i) => (i === 0 ? int(1, 9) : int(0, 9))).join('')
const chance = (p) => rand() < p
const pad = (n, w = 2) => String(n).padStart(w, '0')
const shuffle = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

// ---------------------------------------------------------------- traps
// Non-identifiers that look like identifiers to a careless system. Each must
// survive unchanged; the category is reported.
const TRAPS = {
  '人名病名': ['帕金森病', '桥本甲状腺炎', '克罗恩病', '霍奇金淋巴瘤', '唐氏综合征', '梅尼埃病', '雷诺现象', '格林-巴利综合征', '史蒂文斯-约翰逊综合征', '阿尔茨海默病', 'Wilson病', 'Cushing综合征'],
  '人名体征/评分': ['巴宾斯基征阴性', 'Murphy征阴性', '克尼格征阴性', '麦氏点无压痛', 'Glasgow评分15分', 'Child-Pugh A级', 'NYHA心功能Ⅱ级', 'Wells评分2分'],
  '像人名的中药': ['徐长卿10g', '刘寄奴12g', '何首乌15g', '王不留行10g', '白头翁15g', '使君子9g', '杜仲12g', '白芍15g'],
  '姓氏开头的词': ['高血压病3级', '张力性气胸', '白细胞', '马来酸依那普利片', '金黄色葡萄球菌', '石淋', '黄疸', '常规透析', '陈旧性心肌梗死', '汤剂'],
  '地名病名': ['克山病', '地中海贫血', '日本血吸虫病', '新疆出血热'],
  '科室/病区': ['肾内科（11病区）', '内一科(肾脏病科)(11病区)', '血液净化中心', '重症医学科(ICU)', '急诊科', '心血管内科二病区'],
  '泛指机构': ['上级医院', '当地医院', '我院', '外院', '社区卫生服务站'],
  '药品': ['碳酸司维拉姆', '重组人促红素', '华法林钠片', '骨化三醇'],
  '职称': ['主任医师', '副主任护师', '主治医师'],
  '药企/器械': ['扬子江药业集团有限公司', '恒瑞医药股份有限公司', 'GE Revolution CT', 'Cobas c702 生化分析仪', '费森尤斯4008S透析机'],
  '批准文号/批号': ['国药准字H20013062', '国药准字J20180027', '国械注准20153100906', '批号B20240315', '批号231102A'],
  '编码': ['N18.500', 'D63.801', 'I12.000', '39.9501', '250310011', '86900123000017', 'XB01AC06A001010101445', 'LIS-CR01'],
  '时间戳/数值': ['20240301083015', '20240305141022', '152/88mmHg', '13811.50元', '0.1g*30片'],
  '已遮盖值': ['张*', '李**', '138****6612', '3301**********1234'],
}
const TRAP_TEXT = Object.values(TRAPS).flat()
const trap = (cat) => ({ d: pick(TRAPS[cat]), c: cat })

// ---------------------------------------------------------------- people
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗郑梁谢宋唐许韩冯邓曹彭曾田董潘袁蔡蒋余杜叶程魏苏吕丁任沈姚卢姜崔谭陆汪范金廖贾夏韦付方邹孟熊秦邱江尹薛闫段雷侯龙陶黎贺顾毛郝龚邵万钱严覃武戴莫孔汤'
const COMPOUND = ['欧阳', '司马', '上官', '诸葛', '东方', '皇甫', '慕容', '尉迟']
const GIVEN_F = '芳娜秀英敏静丽艳娟霞玉萍燕慧琳梅凤兰菊珍琪婷雪颖洁倩莉薇岚'
const GIVEN_M = '伟强磊军洋勇杰涛明超刚华建国志辉鹏飞东宇浩博文德胜振立新永福斌峰俊'
const MINORITY = ['阿依古丽·买买提', '艾力·吐尔逊', '古丽娜尔·艾山', '买买提·阿不都', '热依拉·托合提', '迪丽娜·吾守尔']
const TIBETAN = ['扎西多吉', '次仁卓玛', '格桑旺姆', '洛桑丹增']
const used = new Set()
const clashes = (name) => used.has(name) || [...used].some((other) => other.includes(name) || name.includes(other)) || TRAP_TEXT.some((t) => t.includes(name) || name.includes(t))
function personName(kind = 'plain', sex = chance(0.5) ? '男' : '女') {
  for (let tries = 0; tries < 1000; tries += 1) {
    const pool = sex === '女' ? GIVEN_F : GIVEN_M
    let name
    if (kind === 'compound') name = pick(COMPOUND) + pick(pool) + (chance(0.5) ? pick(pool) : '')
    else if (kind === 'minority') name = pick(MINORITY)
    else if (kind === 'tibetan') name = pick(TIBETAN)
    else name = pick(SURNAMES) + pick(pool) + (chance(0.7) ? pick(pool) : '')
    if (clashes(name)) continue
    used.add(name)
    return name
  }
  throw new Error('name pool exhausted')
}

// ---------------------------------------------------------------- numbers
const REGIONS = ['330106', '330102', '330205', '330602', '330302', '331102', '330781', '532101']
function idCard(birth) {
  const body = pick(REGIONS) + birth + pad(int(0, 999), 3)
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const sum = [...body].reduce((acc, ch, i) => acc + Number(ch) * w[i], 0)
  return body + '10X98765432'[sum % 11]
}
const idCard15 = (birth) => pick(REGIONS) + birth.slice(2) + pad(int(0, 999), 3)
function luhn(prefix, length) {
  const body = prefix + Array.from({ length: length - prefix.length - 1 }, () => int(0, 9)).join('')
  for (let d = 0; d <= 9; d += 1) {
    const s = body + d
    let sum = 0
    for (let i = 0; i < s.length; i += 1) {
      let n = Number(s[s.length - 1 - i])
      if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9 }
      sum += n
    }
    if (sum % 10 === 0) return s
  }
  return body + '0'
}
const mobile = () => pick(['138', '139', '137', '136', '159', '158', '188', '187', '135', '152', '177', '199', '181', '133']) + Array.from({ length: 8 }, () => int(0, 9)).join('')
const groupMobile = (m, sep) => `${m.slice(0, 3)}${sep}${m.slice(3, 7)}${sep}${m.slice(7)}`
const groupId = (id) => (chance(0.5) ? `${id.slice(0, 6)} ${id.slice(6, 14)} ${id.slice(14)}` : `${id.slice(0, 6)}-${id.slice(6, 14)}-${id.slice(14)}`)
const groupCard = (c) => c.match(/.{1,4}/g).join(' ')
const landline = () => `0${pick(['571', '574', '577', '575', '578'])}-${int(5, 8)}${Array.from({ length: 7 }, () => int(0, 9)).join('')}`

// ---------------------------------------------------------------- places
const CITIES = [
  ['浙江省', '东江市', ['临湖区', '江滨区', '望海区'], ['云溪县', '青田湾镇']],
  ['浙江省', '明州市', ['鄞东区', '海宁湾区'], ['象山岭镇', '石浦乡']],
  ['浙江省', '越城市', ['柯湖区', '上虞区'], ['新昌岭镇']],
]
const ROADS = ['文三路', '学院路', '凤起东路', '解放路', '庆春路', '中山北路', '天目山路', '秋涛路', '四明中路', '人民东路', '胜利路', '环城西路']
const ESTATES = ['翠苑', '和睦', '采荷', '景芳', '古荡', '朝晖', '湖畔', '金色家园']
function address({ province = chance(0.5), rural = false } = {}) {
  const [prov, city, districts, towns] = pick(CITIES)
  const head = `${province ? prov : ''}${city}`
  if (rural) return `${head}${pick(towns)}${pick(['岭下', '溪口', '上塘', '后山'])}村${int(1, 9)}组${int(1, 60)}号`
  const tail = chance(0.5) ? `${int(1, 30)}幢${int(1, 3)}单元${int(1, 25)}0${int(1, 4)}室` : `${pick(ESTATES)}${pick(['新村', '小区', '花园'])}${int(1, 40)}-${int(1, 6)}-${int(101, 702)}`
  return `${head}${pick(districts)}${pick(ROADS)}${int(1, 899)}号${tail}`
}
const HOSPITALS = ['东江市第一人民医院', '东江市中医院', '江滨大学附属第二医院', '明州市妇幼保健院', '云溪县人民医院', '越城市中心医院', '临湖区第三人民医院', '东江市肿瘤医院', '青田湾镇卫生院', '明州医科大学附属第一医院']
const OUR_HOSPITAL = '东江市第一人民医院'
const COMPANIES = ['东江云帆科技有限公司', '明州海运物流有限公司', '越城纺织印染厂', '东江市临湖区实验小学', '江滨机械制造有限公司']
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const email = () => `${Array.from({ length: int(4, 8) }, () => pick(LETTERS)).join('')}${int(10, 999)}@${pick(['163.com', 'qq.com', '126.com', 'foxmail.com'])}`
const RELATIONS = ['女儿', '儿子', '配偶', '侄子', '儿媳', '女婿', '孙女']
const RELATION_SEX = { 女儿: '女', 儿媳: '女', 孙女: '女', 儿子: '男', 侄子: '男', 女婿: '男' }

// ---------------------------------------------------------------- builder
class Doc {
  constructor() { this.parts = []; this.gold = []; this.neutral = []; this.decoys = []; this.length = 0 }
  t(text) { this.parts.push(text); this.length += text.length; return this }
  id(type, text, kase) { this.gold.push({ type, text, start: this.length, end: this.length + text.length, case: kase }); return this.t(text) }
  n(text, why) { this.neutral.push({ text, start: this.length, end: this.length + text.length, why }); return this.t(text) }
  d(text, cat) { this.decoys.push({ text, cat }); return this.t(text) }
  /** Tagged template: ${[type, value, case]} identifier, ${{ d, c }} decoy, ${{ n, why }} neutral. */
  w(strings, ...values) {
    strings.forEach((s, i) => {
      this.t(s)
      if (i >= values.length) return
      this.put(values[i])
    })
    return this
  }
  put(v) {
    if (Array.isArray(v)) return this.id(v[0], v[1], v[2] ?? '标注字段')
    if (v && typeof v === 'object' && 'd' in v) return this.d(v.d, v.c)
    if (v && typeof v === 'object' && 'n' in v) return this.n(v.n, v.why)
    if (v && typeof v === 'object' && 'parts' in v) { for (const part of v.parts) typeof part === 'string' ? this.t(part) : this.put(part); return this }
    return this.t(String(v))
  }
  get text() { return this.parts.join('') }
}
const P = (...parts) => ({ parts })
const I = (type, text, kase) => [type, text, kase]

/** Pretty JSON written by hand (2-space, like JSON.stringify) so spans are exact. */
class JsonDoc extends Doc {
  value(v) {
    if (typeof v === 'string' || typeof v === 'number' || v === null) return this.t(JSON.stringify(v))
    if (Array.isArray(v) && typeof v[0] === 'string' && v.length === 3) { this.t('"'); this.put(v); return this.t('"') }
    this.t('"'); this.put(v); return this.t('"')
  }
  record(obj, indent) {
    const keys = Object.keys(obj)
    this.t('{\n')
    keys.forEach((key, i) => {
      this.t(`${indent}  ${JSON.stringify(key)}: `)
      this.value(obj[key])
      this.t(i < keys.length - 1 ? ',\n' : '\n')
    })
    this.t(`${indent}}`)
  }
  list(records) {
    this.t('[\n')
    records.forEach((record, i) => {
      this.t('  ')
      this.record(record, '  ')
      this.t(i < records.length - 1 ? ',\n' : '\n')
    })
    return this.t(']\n')
  }
}

// ---------------------------------------------------------------- patients
function patient(index) {
  const sex = chance(0.5) ? '男' : '女'
  const kind = index % 9 === 4 ? 'compound' : index % 9 === 7 ? 'minority' : index % 13 === 11 ? 'tibetan' : 'plain'
  const year = int(1938, 1992)
  const birth = `${year}${pad(int(1, 12))}${pad(int(1, 28))}`
  const familyBirth = `${int(1962, 2001)}${pad(int(1, 12))}${pad(int(1, 28))}`
  const rel = pick(RELATIONS)
  return {
    index, sex, age: 2024 - year, name: personName(kind, sex), nameKind: kind,
    id: year < 1960 && chance(0.4) ? idCard15(birth) : idCard(birth),
    phone: mobile(), address: address(), address2: address({ province: false, rural: chance(0.4) }),
    birthplace: pick(CITIES)[3][0], workplace: pick(COMPANIES), email: email(),
    mrn: digits(8), zy: digits(7), mz: digits(10), ss: `${pick(['A', 'B', 'C'])}${digits(8)}`,
    bank: luhn(pick(['622202', '621700', '622848', '623058']), pick([16, 19])),
    family: { rel, name: personName(chance(0.15) ? 'compound' : 'plain', RELATION_SEX[rel] ?? (sex === '男' ? '女' : '男')), phone: mobile(), id: idCard(familyBirth) },
    spouse: personName('plain', sex === '男' ? '女' : '男'),
    outside: pick(HOSPITALS.filter((h) => h !== OUR_HOSPITAL)),
    doctor: personName(), senior: personName(), nurse: personName('plain', '女'), nurse2: personName('plain', '女'),
    extDoctor: personName(), surgeon: personName(), anesth: personName(),
    admit: `2024-0${int(1, 9)}-${pad(int(1, 28))}`,
  }
}
const patients = Array.from({ length: 18 }, (_, i) => patient(i))
const labStaff = [personName(), personName(), personName()]
const pharmacists = [personName(), personName()]
const consultant = personName()

// ---------------------------------------------------------------- free-text documents
const T = {
  admission(p) {
    const d = new Doc()
    const name = I('姓名', p.name)
    d.w`入 院 记 录\n\n姓名：${name}　　性别：${p.sex}　　年龄：${p.age}岁　　民族：${p.nameKind === 'minority' ? '维吾尔族' : p.nameKind === 'tibetan' ? '藏族' : '汉族'}\n`
    d.w`出生地：${{ n: p.birthplace, why: '出生地仅到县' }}　　婚姻：已婚　　职业：职员\n`
    d.w`工作单位：${I('地址', p.workplace, '工作单位')}\n`
    d.w`身份证号：${I('身份证号', p.id, p.id.length === 15 ? '15 位旧证号' : '标注字段')}\n`
    d.w`现住址：${I('地址', p.address)}\n联系电话：${I('电话', p.phone)}\n`
    d.w`联系人：${I('姓名', p.family.name, '家属')}（${p.family.rel}）　联系人电话：${I('电话', groupMobile(p.family.phone, ' '), '分组号码')}\n`
    d.w`住院号：${I('住院号', p.zy)}　　病案号：${I('病历号', p.mrn)}\n`
    d.w`入院科室：${trap('科室/病区')}　床号：${{ d: '12床', c: '编码' }}　入院时间：${p.admit} 10:2${int(0, 9)}\n`
    d.w`病史陈述者：患者本人及其${p.family.rel}，可靠\n\n`
    d.w`主　诉：反复双下肢水肿2年，加重伴乏力1周。\n`
    d.w`现病史：患者2年前无明显诱因出现双下肢凹陷性水肿，晨轻暮重，就诊于${I('医院', p.outside, '外院（叙述中）')}，查血肌酐312μmol/L，诊断"慢性肾脏病"，予${trap('姓氏开头的词')}及${pick(TRAPS['像人名的中药'].map((h) => ({ d: h, c: '像人名的中药' })))}等中药汤剂治疗，症状反复。`
    d.w`1周前受凉后上述症状加重，伴乏力、纳差，尿量减少，由${p.family.rel}${I('姓名', p.family.name, '家属')}陪同来我院就诊，门诊拟"${trap('人名病名')}待排；慢性肾脏病5期"收入院。\n`
    d.w`既往史：${{ d: '高血压病3级', c: '姓氏开头的词' }}病史10年，长期口服${{ d: '马来酸依那普利片', c: '姓氏开头的词' }}；否认${trap('地名病名')}、${trap('人名病名')}病史。\n`
    d.w`个人史：生于原籍，久居本地，无疫区居留史。\n`
    d.w`婚育史：已婚，配偶${I('姓名', p.spouse, '叙述中姓名')}体健，育有一女。\n家族史：父亲患2型糖尿病。\n\n`
    d.w`体格检查：T 36.8℃，P 88次/分，R 20次/分，BP ${{ d: '152/88mmHg', c: '时间戳/数值' }}。神志清，${trap('人名体征/评分')}，${trap('人名体征/评分')}。双下肢中度凹陷性水肿。\n`
    d.w`辅助检查：${pick(['2024-02-10', '2024-01-22'])}${I('医院', p.outside, '外院（叙述中）')}肾脏B超示双肾萎缩。\n\n`
    d.w`初步诊断：1.慢性肾脏病5期（${{ d: 'N18.500', c: '编码' }}） 2.肾性贫血（${{ d: 'D63.801', c: '编码' }}） 3.高血压性心脏病（${{ d: 'I12.000', c: '编码' }}）\n\n`
    d.w`记录医师：${I('医生', p.doctor, '签名')}　　上级医师：${I('医生', p.senior, '签名')}（${{ d: '主任医师', c: '职称' }}）\n`
    return d
  },
  firstCourse(p) {
    const d = new Doc()
    d.w`首次病程记录\n${p.admit} 11:40\n\n`
    d.w`患者${I('姓名', p.name, '叙述中姓名')}，${p.sex}，${p.age}岁，因"反复双下肢水肿2年，加重1周"入院。\n`
    d.w`病例特点：1.老年患者，慢性病程。2.既往${{ d: '高血压病3级', c: '姓氏开头的词' }}10年。3.查体：${trap('人名体征/评分')}，双下肢水肿。4.辅助检查：外院Scr 312μmol/L。\n`
    d.w`鉴别诊断：1.${trap('人名病名')}：可有蛋白尿，但多伴特征性表现，暂不支持。2.${trap('地名病名')}：无相关流行病学史，可排除。\n`
    d.w`诊疗计划：完善血常规、肾功能、电解质、${{ d: '白细胞', c: '姓氏开头的词' }}分类；必要时行${{ d: '常规透析', c: '姓氏开头的词' }}；已向患者${p.family.rel}交代病情。\n`
    d.w`\n医师签名：${I('医生', p.doctor, '签名')}\n`
    return d
  },
  rounds(p) {
    const d = new Doc()
    d.w`上级医师查房记录\n${p.admit.replace(/\d\d$/, (x) => pad(Math.min(28, Number(x) + 2)))} 09:30\n\n`
    d.w`今日${I('医生', p.senior, '医护（叙述中）')}${{ d: '主任医师', c: '职称' }}查房，听取病史汇报后指出：患者${I('姓名', p.name, '叙述中姓名')}目前诊断明确，需警惕${{ d: '张力性气胸', c: '姓氏开头的词' }}等置管并发症。`
    d.w`${I('医生', p.senior, '医护（叙述中）')}主任指示：继续予${{ d: '碳酸司维拉姆', c: '药品' }}、骨化三醇治疗。已向家属${{ d: pick(['张*', '李**']), c: '已遮盖值' }}及患者${p.family.rel}${I('姓名', p.family.name, '家属')}（电话 ${I('电话', groupMobile(p.family.phone, '-'), '分组号码')}）交代，表示理解。\n`
    d.w`主治医师${I('医生', p.doctor, '医护（叙述中）')}已与${I('医院', p.outside, '外院（叙述中）')}的${I('医生', p.extDoctor, '医护（叙述中）')}医生电话沟通，调阅既往影像资料。\n`
    d.w`\n记录者：${I('医生', p.doctor, '签名')}\n`
    return d
  },
  surgery(p) {
    const d = new Doc()
    d.w`手术记录\n\n患者姓名：${I('姓名', p.name)}　住院号：${I('住院号', p.zy)}　科室：${{ d: '肾内科（11病区）', c: '科室/病区' }}\n`
    d.w`手术日期：${p.admit}　手术名称：左前臂动静脉内瘘成形术（${{ d: '39.9501', c: '编码' }}）\n`
    d.w`手术者：${I('医生', p.surgeon, '签名')}　一助：${I('医生', p.doctor, '签名')}　麻醉医师：${I('医生', p.anesth, '签名')}　器械护士：${I('医生', p.nurse, '签名')}　巡回护士：${I('医生', p.nurse2, '签名')}\n`
    d.w`手术经过：臂丛麻醉成功后，常规消毒铺巾，于左腕部做纵行切口约3cm，游离头静脉及桡动脉，行端侧吻合，术中使用${{ d: '费森尤斯4008S透析机', c: '药企/器械' }}配套耗材（${trap('批准文号/批号')}），吻合口可触及震颤。手术顺利，术中出血约5ml。\n`
    d.w`\n术者签名：${I('医生', p.surgeon, '签名')}\n`
    return d
  },
  consult(p) {
    const d = new Doc()
    d.w`# 会诊记录\n\n| 项目 | 内容 |\n|---|---|\n| 姓名 | ${I('姓名', p.name, 'Markdown 表格')} |\n| 住院号 | ${I('住院号', p.zy, 'Markdown 表格')} |\n| 申请科室 | ${{ d: '肾内科（11病区）', c: '科室/病区' }} |\n| 会诊科室 | ${{ d: '心血管内科二病区', c: '科室/病区' }} |\n\n`
    d.w`**会诊意见**：患者${{ d: 'NYHA心功能Ⅱ级', c: '人名体征/评分' }}，建议控制容量负荷。因病情复杂，已邀请${I('医院', p.outside, '外院（叙述中）')}心内科${I('医生', consultant, '医护（叙述中）')}教授远程会诊，同意上述意见。\n\n`
    d.w`**会诊医师**：${I('医生', p.extDoctor, '签名')}\n`
    return d
  },
  discharge(p) {
    const d = new Doc()
    d.w`出院小结\n\n患者${I('姓名', p.name, '叙述中姓名')}，${p.sex}，${p.age}岁，因"反复水肿2年"于${p.admit}入住我院（${I('医院', OUR_HOSPITAL, '本院名称（叙述中）')}）${{ d: '肾内科（11病区）', c: '科室/病区' }}，住院号${I('住院号', p.zy, '叙述中编号')}，住院16天。\n`
    d.w`诊疗经过：予规律血液透析（${{ d: '费森尤斯4008S透析机', c: '药企/器械' }}），${{ d: '重组人促红素', c: '药品' }}纠正贫血。\n`
    d.w`出院诊断：慢性肾脏病5期；肾性贫血；${{ d: '高血压病3级', c: '姓氏开头的词' }}。\n`
    d.w`出院医嘱：1.每周3次血液透析（${{ d: '血液净化中心', c: '科室/病区' }}）。2.口服${{ d: '马来酸依那普利片', c: '姓氏开头的词' }}，如出现${{ d: '黄疸', c: '姓氏开头的词' }}及时就诊于${{ d: '当地医院', c: '泛指机构' }}。\n`
    d.w`如有不适请联系${I('医生', p.doctor, '医护（叙述中）')}医生（科室电话 ${I('电话', `${landline()}转${int(8000, 8999)}`, '座机带分机')}）；复查提醒发送至 ${I('邮箱', p.email, '邮箱')}。\n`
    d.w`随访联系人：${I('姓名', p.family.name, '家属')}（${p.family.rel}），手机${I('电话', p.family.phone, '叙述中号码')}，家住${I('地址', p.address2, p.address2.includes('村') ? '农村地址' : '叙述中地址')}。\n`
    d.w`\n主治医师：${I('医生', p.doctor, '签名')}　　主任医师：${I('医生', p.senior, '签名')}\n`
    return d
  },
  consent(p) {
    const d = new Doc()
    const spaced = p.name.length === 2 && !p.name.includes('·') ? `${p.name[0]}  ${p.name[1]}` : p.name
    d.w`血液透析治疗知情同意书\n\n患者姓名：${I('姓名', p.name)}　性别：${p.sex}　年龄：${p.age}　住院号：${I('住院号', p.zy)}\n`
    d.w`治疗风险：低血压、心律失常、首次使用综合征、导管相关感染（如${{ d: '金黄色葡萄球菌', c: '姓氏开头的词' }}）；抗凝使用${{ d: '华法林钠片', c: '药品' }}者出血风险增加。\n`
    d.w`患者签名：${I('姓名', spaced, spaced === p.name ? '签名' : '签名（字间空格）')}　　日期：${p.admit}\n`
    d.w`患者授权委托人：${I('姓名', p.family.name, '家属')}　与患者关系：${p.family.rel}\n委托人身份证号：${I('身份证号', groupId(p.family.id), '分组号码')}　联系电话：${I('电话', groupMobile(p.family.phone, '-'), '分组号码')}\n`
    d.w`谈话医师：${I('医生', p.doctor, '签名')}　　见证护士：${I('医生', p.nurse, '签名')}\n`
    return d
  },
  nursing(p) {
    const d = new Doc()
    d.w`护理记录单\n姓名：${I('姓名', p.name)}　床号：${{ d: 'HD-3床', c: '编码' }}　住院号：${I('住院号', p.zy)}\n\n`
    d.w`${p.admit} 08:00　T 36.6℃，BP 148/86mmHg。患者神志清，精神可，${{ d: 'Glasgow评分15分', c: '人名体征/评分' }}。透析前评估内瘘震颤良好。签名：${I('医生', p.nurse, '签名')}\n`
    d.w`${p.admit} 14:30　透析顺利结束，超滤2.5L。家属（${p.family.rel}）在旁陪护，已宣教低盐饮食。签名：${I('医生', p.nurse2, '签名')}\n`
    d.w`${p.admit} 20:00　夜间巡视，患者睡眠可。${I('医生', p.nurse, '医护（叙述中）')}护士已交班给${I('医生', p.nurse2, '医护（叙述中）')}。签名：${I('医生', p.nurse, '签名')}\n`
    return d
  },
  followup(p) {
    const d = new Doc()
    d.w`电话随访记录\n\n2024-05-10 电话随访。接电话的是患者${p.family.rel}${I('姓名', p.family.name, '家属')}，说${I('姓名', p.name, '叙述中姓名')}最近在${I('医院', p.outside, '外院（叙述中）')}做透析，费用走医保，社保卡号${I('社保号', p.ss, '叙述中编号')}。`
    d.w`家里搬到了${I('地址', p.address2, p.address2.includes('村') ? '农村地址' : '叙述中地址')}，新手机号${I('电话', groupMobile(p.phone, ' '), '分组号码')}。`
    d.w`退费请打到银行卡${I('银行卡号', groupCard(p.bank), '分组号码')}。患者自述在外服用中药（${trap('像人名的中药')}、${trap('像人名的中药')}），已嘱停用并告知${{ d: '石淋', c: '姓氏开头的词' }}相关风险。\n`
    d.w`随访护士：${I('医生', p.nurse, '签名')}\n`
    return d
  },
  transfer(p) {
    const d = new Doc()
    const target = pick(HOSPITALS.filter((h) => h !== OUR_HOSPITAL && h !== p.outside))
    d.w`转院介绍信\n\n${I('医院', target, '抬头医院')}：\n`
    d.w`　　兹有我院患者${I('姓名', p.name, '叙述中姓名')}（身份证号：${I('身份证号', p.id)}，门诊号：${I('就诊号', p.mz)}），因慢性肾脏病5期合并${trap('人名病名')}，经${{ d: '上级医院', c: '泛指机构' }}专家建议，需转贵院进一步诊治。`
    d.w`住院期间自费部分已由银行卡${I('银行卡号', p.bank, '叙述中编号')}结清。\n`
    d.w`联系人：${I('医生', p.doctor, '签名')}，${I('医院', OUR_HOSPITAL, '本院名称（叙述中）')}${{ d: '肾内科（11病区）', c: '科室/病区' }}，电话：${I('电话', landline(), '座机')}\n`
    return d
  },
  lab(p) {
    const d = new Doc()
    d.w`${I('医院', OUR_HOSPITAL, '抬头医院')}检验报告单\n\n`
    d.w`姓名：${I('姓名', p.name)}　病案号：${I('病历号', p.mrn)}　科别：${trap('科室/病区')}　标本条码：${{ n: digits(12), why: '标本条码' }}\n`
    d.w`仪器：${{ d: 'Cobas c702 生化分析仪', c: '药企/器械' }}　试剂${trap('批准文号/批号')}　项目代码：${{ d: 'LIS-CR01', c: '编码' }}\n\n`
    d.w`项目　　　结果　　单位　　参考范围\n肌酐　　　${int(400, 980)}　　μmol/L　57-111\n尿素氮　　${int(15, 38)}.${int(0, 9)}　mmol/L　3.1-8.0\n血钾　　　${int(4, 6)}.${int(0, 9)}　mmol/L　3.5-5.3\n${{ d: '白细胞', c: '姓氏开头的词' }}　　${int(4, 9)}.${int(0, 9)}　10^9/L　3.5-9.5\n\n`
    d.w`送检医生：${I('医生', p.doctor, '签名')}　检验者：${I('医生', labStaff[0], '签名')}　审核者：${I('医生', labStaff[1], '签名')}　报告时间：${{ d: pick(TRAPS['时间戳/数值'].slice(0, 2)), c: '时间戳/数值' }}\n`
    return d
  },
  imaging(p) {
    const d = new Doc()
    d.w`CT检查报告\n\n姓名：${I('姓名', p.name)}　检查号：${I('就诊号', `CT${digits(8)}`)}　设备：${{ d: 'GE Revolution CT', c: '药企/器械' }}\n\n`
    d.w`检查所见：双肾体积缩小，皮髓质分界不清。左侧少量胸腔积液，未见${{ d: '张力性气胸', c: '姓氏开头的词' }}征象。\n`
    d.w`诊断意见：双肾萎缩，符合慢性肾病改变；建议结合临床，必要时至${{ d: '上级医院', c: '泛指机构' }}进一步检查。\n`
    d.w`\n报告医师：${I('医生', labStaff[2], '签名')}　审核医师：${I('医生', p.senior, '签名')}\n`
    return d
  },
}

// ---------------------------------------------------------------- structured files
function labCsv(rows) {
  const d = new Doc()
  d.t('姓名,性别,年龄,住院号,标本条码,检验项目,项目代码,结果,单位,送检医生,备注\n')
  for (let i = 0; i < rows; i += 1) {
    const p = pick(patients)
    const [item, unit] = pick([['肌酐', 'μmol/L'], ['血钾', 'mmol/L'], ['血红蛋白', 'g/L'], ['全段甲状旁腺素', 'pg/mL'], ['白蛋白', 'g/L']])
    d.w`${I('姓名', p.name, '表格列')},${p.sex},${p.age},${I('住院号', p.zy, '表格列')},${{ n: digits(12), why: '标本条码' }},${item},${{ d: 'LIS-CR01', c: '编码' }},${int(3, 900)},${unit},${I('医生', p.doctor, '表格列')},`
    const r = rand()
    if (r < 0.14) d.w`家属${I('姓名', p.family.name, '表格备注中的姓名')}代取报告`
    else if (r < 0.24) d.w`危急值已电话通知${I('医生', p.senior, '表格备注中的姓名')}`
    else if (r < 0.32) d.w`复查请联系${I('电话', p.family.phone, '表格备注中的号码')}`
    else if (r < 0.42) d.w`标本溶血 ${{ d: '批号231102A', c: '批准文号/批号' }}`
    d.t('\n')
  }
  return d
}

function prescriptionCsv(rows) {
  const d = new Doc()
  d.t('处方号,门诊号,患者姓名,药品编码,药品名称,规格,生产厂家,批准文号,用法,开方医生,审核药师\n')
  const drugs = [
    ['马来酸依那普利片', '姓氏开头的词', '10mg*16片'], ['碳酸司维拉姆片', null, '0.8g*30片'], ['骨化三醇软胶囊', null, '0.25μg*10粒'],
    ['阿司匹林肠溶片', null, '0.1g*30片'], ['左旋氨氯地平片', null, '2.5mg*14片'],
  ]
  for (let i = 0; i < rows; i += 1) {
    const p = pick(patients)
    const [drug, cat, spec] = pick(drugs)
    d.w`${{ n: `CF${digits(9)}`, why: '处方号' }},${I('就诊号', p.mz, '表格列')},${I('姓名', p.name, '表格列')},${{ d: '86900123000017', c: '编码' }},`
    d.put(cat ? { d: drug, c: cat } : drug)
    d.w`,${spec === '0.1g*30片' ? { d: spec, c: '时间戳/数值' } : spec},${{ d: pick(['扬子江药业集团有限公司', '恒瑞医药股份有限公司']), c: '药企/器械' }},${{ d: pick(['国药准字H20013062', '国药准字J20180027']), c: '批准文号/批号' }},口服 qd,${I('医生', p.doctor, '表格列')},${I('医生', pick(pharmacists), '表格列')}\n`
  }
  return d
}

/** Regional-platform export: data-element codes as field names (meaning not in the name). */
function platformExport(count, kind) {
  const d = new JsonDoc()
  const records = []
  for (let i = 0; i < count; i += 1) {
    const p = patients[(i * 7 + (kind === 'inpatient' ? 3 : 0)) % patients.length]
    const note = pick([
      P('患者', I('姓名', p.name, '编码字段中的叙述'), '由', p.family.rel, I('姓名', p.family.name, '编码字段中的叙述'), '陪同就诊，既往在', I('医院', p.outside, '编码字段中的叙述'), '行内瘘手术。'),
      P('联系电话变更为', I('电话', groupMobile(p.family.phone, ' '), '编码字段中的叙述'), '。'),
      P('诊断', { d: pick(TRAPS['人名病名']), c: '人名病名' }, '待排，建议', { d: '上级医院', c: '泛指机构' }, '就诊。'),
      P('无特殊。'),
    ])
    records.push({
      'DE01.00.010.00': I('就诊号', p.mz, '编码字段（裸编号）'),
      ...(kind === 'inpatient' ? { 'DE01.00.014.00': I('住院号', p.zy, '编码字段（裸编号）'), 'DE01.00.004.00': I('病历号', p.mrn, '编码字段（裸编号）') } : {}),
      'DE02.01.039.00': I('姓名', p.name, '编码字段'),
      'DE02.01.040.00': p.sex === '男' ? '1' : '2',
      'DE02.01.026.00': String(p.age),
      'DE02.01.031.00': '01',
      'DE02.01.030.00': I('身份证号', p.id, '编码字段'),
      'DE02.01.010.00': I('电话', p.phone, '编码字段'),
      'DE02.01.009.00': I('地址', p.address, '编码字段'),
      'DE08.10.052.00': { n: '47011661-3', why: '机构代码' },
      'DE08.10.054.00': I('医院', OUR_HOSPITAL, '编码字段'),
      'DE08.10.025.00': { d: '0301', c: '编码' },
      'DE08.10.026.00': { d: '内一科(肾脏病科)(11病区)', c: '科室/病区' },
      'DE02.01.039.00_YS': I('医生', p.doctor, '编码字段'),
      'DE05.01.024.00': { d: pick(['N18.500', 'D63.801', 'I12.000']), c: '编码' },
      'DE05.01.025.00': '慢性肾脏病5期',
      'DE06.00.218.00': { d: pick(['20240301083015', '20240305141022']), c: '时间戳/数值' },
      'DE06.00.179.00': note,
    })
  }
  return d.list(records)
}

/** Item name / item value pairs; the free text keeps EMR template markup. */
function emrItems(p) {
  const d = new JsonDoc()
  const markup = (label, value) => P(`<cell>${label}<fontbold 0>:<baseele I=1 N=文本型 F=[引用值:${label}><isele 1>[<isele 0>`, value, `<isele 1>]<isele 0></cell>`)
  const items = [
    { ITM_NM: '姓名', ITM_VLU: I('姓名', p.name, '条目名/条目值') },
    { ITM_NM: '性别', ITM_VLU: p.sex },
    { ITM_NM: '联系地址', ITM_VLU: I('地址', p.address, '条目名/条目值') },
    { ITM_NM: '联系电话', ITM_VLU: I('电话', p.phone, '条目名/条目值') },
    { ITM_NM: '主诉', ITM_VLU: '规律透析3年，内瘘震颤减弱2天' },
    { ITM_NM: '文本主体', ITM_VLU: P(markup('姓名', I('姓名', p.name, '病历模板标记')), markup('联系地址', I('地址', p.address2, '病历模板标记'))) },
    { ITM_NM: '病史', ITM_VLU: P('患者由其', p.family.rel, I('姓名', p.family.name, '家属'), '陪同就诊。3年前在', I('医院', p.outside, '外院（叙述中）'), '确诊尿毒症，此后于', { d: '血液净化中心', c: '科室/病区' }, '规律透析，主管医生', I('医生', p.doctor, '医护（叙述中）'), '。既往', { d: pick(TRAPS['人名病名']), c: '人名病名' }, '病史。') },
    { ITM_NM: '诊断', ITM_VLU: { d: pick(TRAPS['人名病名']), c: '人名病名' } },
    { ITM_NM: '签名医生', ITM_VLU: I('医生', p.senior, '条目名/条目值') },
  ]
  return d.list(items)
}

// ---------------------------------------------------------------- assemble
const KIND_ZH = {
  admission: '入院记录', firstCourse: '首次病程记录', rounds: '上级医师查房', surgery: '手术记录', consult: '会诊记录（Markdown）',
  discharge: '出院小结', consent: '知情同意书', nursing: '护理记录', followup: '电话随访', transfer: '转院介绍信', lab: '检验报告单', imaging: '影像检查报告',
  'lab-csv': '检验结果表（CSV）', 'rx-csv': '处方明细（CSV）', 'export-json': '平台导出（编码字段 JSON）', 'emr-json': '条目名/条目值（JSON）',
}
const files = []
const kinds = Object.keys(T)
patients.forEach((p, i) => {
  const chosen = shuffle(kinds).slice(0, 5)
  if (!chosen.includes('admission') && i % 2 === 0) chosen[0] = 'admission'
  for (const kind of chosen) {
    const ext = kind === 'consult' ? 'md' : 'txt'
    files.push({ name: `患者${pad(i + 1)}/${KIND_ZH[kind].replace(/（.*）/, '')}.${ext}`, kind, doc: T[kind](p) })
  }
  if (i % 3 === 0) files.push({ name: `患者${pad(i + 1)}/病历条目.json`, kind: 'emr-json', doc: emrItems(p) })
})
files.push({ name: '平台导出/门诊就诊记录.json', kind: 'export-json', doc: platformExport(18, 'outpatient') })
files.push({ name: '平台导出/住院就诊记录.json', kind: 'export-json', doc: platformExport(14, 'inpatient') })
files.push({ name: '报表/检验结果.csv', kind: 'lab-csv', doc: labCsv(60) })
files.push({ name: '报表/处方明细.csv', kind: 'rx-csv', doc: prescriptionCsv(40) })

// Unusual name forms are a difficulty wherever the name appears.
const NAME_CASE = { compound: '复姓', minority: '少数民族姓名（含间隔号）', tibetan: '藏族姓名' }
const nameKinds = new Map(patients.filter((p) => p.nameKind !== 'plain').map((p) => [p.name, NAME_CASE[p.nameKind]]))
for (const p of patients) if (/^(?:欧阳|司马|上官|诸葛|东方|皇甫|慕容|尉迟)/.test(p.family.name)) nameKinds.set(p.family.name, '复姓')
for (const file of files) for (const g of file.doc.gold) if (g.type === '姓名' && nameKinds.has(g.text)) g.case = nameKinds.get(g.text)

// Every occurrence of an identifier's text must be labelled (otherwise the
// scorer would call its replacement over-redaction), and no decoy may contain
// an identifier.
for (const file of files) {
  const text = file.doc.text
  const covered = (start, end) => [...file.doc.gold, ...file.doc.neutral].some((g) => g.start <= start && end <= g.end)
  for (const g of file.doc.gold) {
    if (text.slice(g.start, g.end) !== g.text) throw new Error(`span mismatch in ${file.name}`)
    for (let at = text.indexOf(g.text); at >= 0; at = text.indexOf(g.text, at + 1)) {
      if (!covered(at, at + g.text.length)) throw new Error(`unlabelled occurrence of an identifier in ${file.name} (${g.type})`)
    }
  }
}

await rm(join(outDir, 'corpus'), { recursive: true, force: true })
const gold = { seed, kinds: KIND_ZH, files: [] }
for (const file of files) {
  const path = join(outDir, 'corpus', file.name)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, file.doc.text)
  gold.files.push({ name: file.name, kind: file.kind, chars: file.doc.text.length, identifiers: file.doc.gold, decoys: file.doc.decoys, neutral: file.doc.neutral })
}
await writeFile(join(outDir, 'gold.json'), JSON.stringify(gold, null, 1))
const count = (key) => gold.files.reduce((acc, f) => acc + f[key].length, 0)
const by = (key, field) => { const o = {}; for (const f of gold.files) for (const g of f[key]) o[g[field]] = (o[g[field]] ?? 0) + 1; return o }
console.log(`${gold.files.length} files, ${count('identifiers')} identifiers, ${count('decoys')} decoys, ${count('neutral')} neutral`)
console.log('types', by('identifiers', 'type'))
console.log('cases', by('identifiers', 'case'))
console.log('traps', by('decoys', 'cat'))
