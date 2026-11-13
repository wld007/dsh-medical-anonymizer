/**
 * Synthetic, labelled medical corpus for the anonymization benchmark.
 * Every planted identifier is recorded with its exact character span, so a
 * scorer can tell leaks from over-redaction. Deterministic (seeded).
 *
 *   node eval/bench/gen.mjs <outDir> [seed]
 *
 * Writes <outDir>/corpus/<files> and <outDir>/gold.json.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'eval/bench/.work'
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
const digits = (n) => Array.from({ length: n }, () => int(0, 9)).join('')
const chance = (p) => rand() < p

// ---------------------------------------------------------------- pools
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗郑梁谢宋唐许韩冯邓曹彭曾田董潘袁蔡蒋余杜叶程魏苏吕丁任沈姚卢姜崔谭陆汪范金廖贾夏韦付方邹孟熊秦邱江尹薛闫段雷侯龙陶黎贺顾毛郝龚邵万钱严覃武戴莫孔汤'
const GIVEN = '伟芳娜秀英敏静丽强磊军洋勇艳杰娟涛明超兰霞平刚桂华建国志红玉萍文辉鹏飞海燕晓东宇浩然欣怡子轩梓涵俊熙雨桐博文慧琳德胜春梅凤兰振华立新秋菊淑珍永福佳琪'
const usedNames = new Set()
function personName() {
  for (;;) {
    const name = pick(SURNAMES) + pick(GIVEN) + (chance(0.7) ? pick(GIVEN) : '')
    if (usedNames.has(name) || DECOY_TEXT.some((d) => d.includes(name) || name.includes(d))) continue
    usedNames.add(name)
    return name
  }
}
const REGIONS = ['330106', '330102', '330205', '330602', '330302', '110105', '320102', '440304']
function idCard(birth) {
  const body = pick(REGIONS) + birth + digits(3)
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const sum = [...body].reduce((acc, ch, i) => acc + Number(ch) * w[i], 0)
  return body + '10X98765432'[sum % 11]
}
function luhn(prefix, length) {
  let body = prefix + digits(length - prefix.length - 1)
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
const mobile = () => pick(['138', '139', '137', '136', '159', '158', '188', '187', '135', '152', '177', '199']) + digits(8)
const fmtMobile = (m, style) => style === 'dash' ? `${m.slice(0, 3)}-${m.slice(3, 7)}-${m.slice(7)}`
  : style === 'space' ? `${m.slice(0, 3)} ${m.slice(3, 7)} ${m.slice(7)}`
    : style === 'cc' ? `+86 ${m}` : m
const landline = () => `0571-${pick(['8', '5', '2'])}${digits(7)}`
const CITIES = [
  ['浙江省', '杭州市', ['西湖区', '拱墅区', '上城区', '滨江区', '余杭区']],
  ['浙江省', '宁波市', ['鄞州区', '海曙区', '江北区']],
  ['浙江省', '绍兴市', ['越城区', '柯桥区', '上虞区']],
  ['浙江省', '温州市', ['鹿城区', '瓯海区']],
]
const ROADS = ['文三路', '莫干山路', '庆春路', '解放路', '中山北路', '天目山路', '秋涛路', '学院路', '四明中路', '人民东路', '胜利路', '凤起东路']
function address(withProvince = chance(0.5)) {
  const [prov, city, districts] = pick(CITIES)
  const tail = chance(0.6) ? `${int(1, 30)}幢${int(1, 3)}单元${int(1, 25)}0${int(1, 4)}室` : `${pick(['和睦', '翠苑', '朝晖', '采荷', '景芳', '古荡'])}${pick(['新村', '小区', '花园'])}${int(1, 40)}-${int(1, 6)}-${int(101, 702)}`
  return `${withProvince ? prov : ''}${city}${pick(districts)}${pick(ROADS)}${int(1, 899)}号${tail}`
}
const HOSPITALS = ['杭州市第三人民医院', '浙江省人民医院', '绍兴市中心医院', '温州医科大学附属第二医院', '宁波市鄞州区第二医院', '浙江大学医学院附属邵逸夫医院', '杭州市中医院', '浙江省立同德医院', '余杭区第一人民医院', '台州恩泽医院']
const OUR_HOSPITAL = '杭州市第三人民医院'
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const email = () => `${Array.from({ length: int(4, 8) }, () => pick(LETTERS)).join('')}${int(10, 999)}@${pick(['163.com', 'qq.com', '126.com', 'sina.com'])}`
const RELATIONS = ['女儿', '儿子', '配偶', '妻子', '丈夫', '侄子', '儿媳']

// Non-identifiers that look like identifiers to a careless system. Each must
// survive anonymization unchanged.
const DECOYS = {
  eponym: ['帕金森病', '桥本甲状腺炎', '格林-巴利综合征', '史蒂文斯-约翰逊综合征', '克罗恩病', '川崎病', '阿尔茨海默病'],
  surnameLike: ['张力性气胸', '高血压病3级', '金黄色葡萄球菌', '白细胞', '马来酸依那普利', '石淋'],
  herb: ['黄芪30g', '当归10g', '白芍15g', '王不留行10g', '陈皮6g', '白术12g', '柴胡9g'],
  drug: ['阿司匹林肠溶片', '华法林钠片', '碳酸司维拉姆', '骨化三醇', '重组人促红素', '左旋氨氯地平'],
  ward: ['肾内科（11病区）', '内一科(肾脏病科)(11病区)', '血液净化中心'],
  code: ['N18.5', 'I12.0', 'D63.8', '批号B20240315', 'HD-3床', '12床'],
  title: ['主任医师', '副主任护师', '主治医师'],
}
const DECOY_TEXT = Object.values(DECOYS).flat()

// ---------------------------------------------------------------- builder
class Doc {
  constructor() { this.parts = []; this.gold = []; this.length = 0; this.decoys = [] }
  t(text) { this.parts.push(text); this.length += text.length; return this }
  id(type, text) { this.gold.push({ type, text, start: this.length, end: this.length + text.length }); return this.t(text) }
  d(text) { this.decoys.push(text); return this.t(text) }
  /** Tagged template: ${[type, value]} plants an identifier, ${{ d: text }} a decoy. */
  w(strings, ...values) {
    strings.forEach((s, i) => {
      this.t(s)
      if (i >= values.length) return
      const v = values[i]
      if (Array.isArray(v)) this.id(v[0], v[1])
      else if (v && typeof v === 'object' && 'd' in v) this.d(v.d)
      else this.t(String(v))
    })
    return this
  }
  get text() { return this.parts.join('') }
}

// ---------------------------------------------------------------- patients
function patient() {
  const sex = chance(0.5) ? '男' : '女'
  const year = int(1940, 1990)
  const birth = `${year}${String(int(1, 12)).padStart(2, '0')}${String(int(1, 28)).padStart(2, '0')}`
  const familyBirth = `${int(1965, 2000)}${String(int(1, 12)).padStart(2, '0')}${String(int(1, 28)).padStart(2, '0')}`
  return {
    name: personName(), sex, age: 2024 - year, id: idCard(birth),
    phone: mobile(), phoneStyle: pick(['plain', 'plain', 'dash', 'space', 'cc']),
    address: address(), address2: address(false), email: email(),
    mrn: `${pick(['', 'MRN'])}${digits(2) === '00' ? '1' : ''}00${digits(8)}`,
    zy: `ZY${2024}${digits(6)}`, mz: `MZ${digits(9)}`,
    ss: `${digits(3)}${pick(['A', 'B', ''])}${digits(9)}`,
    bank: luhn(pick(['622202', '621700', '622848', '623058']), pick([16, 19])),
    family: { rel: pick(RELATIONS), name: personName(), phone: mobile(), id: idCard(familyBirth) },
    spouse: personName(),
    outside: pick(HOSPITALS.filter((h) => h !== OUR_HOSPITAL)),
    doctor: personName(), senior: personName(), nurse: personName(), extDoctor: personName(),
  }
}
const patients = Array.from({ length: 14 }, patient)
const staffLab = [personName(), personName(), personName()]

// ---------------------------------------------------------------- free-text templates
const T = {
  admission(p) {
    const d = new Doc()
    d.w`入院记录\n\n姓名：${['姓名', p.name]}    性别：${p.sex}    年龄：${p.age}岁\n`
    d.w`身份证号：${['身份证号', p.id]}\n联系电话：${['电话', fmtMobile(p.phone, p.phoneStyle)]}\n现住址：${['地址', p.address]}\n`
    d.w`住院号：${['住院号', p.zy]}    病历号：${['病历号', p.mrn]}\n入院科室：${{ d: pick(DECOYS.ward) }}  床号：${{ d: '12床' }}\n入院日期：2024-03-0${int(1, 9)} 10:2${int(0, 9)}\n`
    d.w`病史陈述者：患者本人及其${p.family.rel}${['姓名', p.family.name]}\n\n`
    d.w`主诉：反复双下肢水肿2年，加重伴乏力1周。\n`
    d.w`现病史：患者于2年前无明显诱因出现双下肢凹陷性水肿，于${['医院', p.outside]}就诊，查肌酐 312 μmol/L，诊断为"慢性肾脏病"，予${{ d: pick(DECOYS.drug) }}、${{ d: pick(DECOYS.drug) }}等治疗。1周前上述症状加重，伴乏力、纳差，为进一步诊治来我院。\n`
    d.w`既往史：${{ d: '高血压病3级' }}病史10年，口服${{ d: '马来酸依那普利' }}；否认${{ d: pick(DECOYS.eponym) }}、${{ d: pick(DECOYS.eponym) }}病史。\n`
    d.w`婚育史：已婚，配偶${['姓名', p.spouse]}体健。\n家族史：父亲患2型糖尿病。\n`
    d.w`初步诊断：1.慢性肾脏病5期（${{ d: 'N18.5' }}） 2.肾性贫血（${{ d: 'D63.8' }}） 3.高血压性心脏病（${{ d: 'I12.0' }}）\n`
    d.w`记录医生：${['医生', p.doctor]}    上级医师：${['医生', p.senior]} ${{ d: '主任医师' }}\n`
    return d
  },
  progress(p) {
    const d = new Doc()
    d.w`日常病程记录\n\n2024-03-05 09:30 ${['医生', p.senior]}${{ d: '主任医师' }}查房记录\n`
    d.w`今日${['医生', p.senior]}主任查房，患者${['姓名', p.name]}诉乏力较前好转，夜间可平卧，尿量约 400ml/d。查体：BP 152/88mmHg，双下肢轻度水肿。`
    d.w`${['医生', p.senior]}主任指示：继续予${{ d: '碳酸司维拉姆' }}、${{ d: '骨化三醇' }}治疗，下周复查肌酐、血钾，警惕${{ d: '张力性气胸' }}等置管并发症。`
    d.w`已向患者${p.family.rel}${['姓名', p.family.name]}（电话 ${['电话', fmtMobile(p.family.phone, 'space')]}）交代病情，其表示理解。\n`
    d.w`主治医师${['医生', p.doctor]}已与${['医院', p.outside]}的${['医生', p.extDoctor]}医生电话沟通，调阅既往影像资料，提示双肾萎缩。\n`
    d.w`2024-03-06 14:10 病程记录\n患者今日行颈内静脉置管术，术中顺利，置管后血培养回报${{ d: '金黄色葡萄球菌' }}阴性。${['姓名', p.name]}情绪稳定，由${p.family.rel}陪护。\n记录者：${['医生', p.doctor]}\n`
    return d
  },
  discharge(p) {
    const d = new Doc()
    d.w`出院小结\n\n患者${['姓名', p.name]}，${p.sex}，${p.age}岁，因"反复水肿2年"于2024-03-01入住我院（${['医院', OUR_HOSPITAL]}）${{ d: '肾内科（11病区）' }}，住院号${['住院号', p.zy]}，住院 16 天。\n`
    d.w`诊疗经过：入院后予规律血液透析，${{ d: '重组人促红素' }}纠正贫血，${{ d: '左旋氨氯地平' }}控制血压。\n`
    d.w`出院诊断：慢性肾脏病5期；肾性贫血；${{ d: '高血压病3级' }}。\n`
    d.w`出院医嘱：1. 规律血液透析，每周3次（${{ d: '血液净化中心' }}）。2. 继续口服${{ d: '阿司匹林肠溶片' }} 100mg qd。3. 定期复查血常规、肾功能。\n`
    d.w`如有不适请联系${['医生', p.doctor]}医生（科室电话 ${['电话', landline()]}）。患者已留邮箱 ${['邮箱', p.email]} 用于接收复查提醒。\n`
    d.w`随访联系人：${['姓名', p.family.name]}（${p.family.rel}），手机${['电话', p.family.phone]}，家住${['地址', p.address2]}。\n`
    d.w`主治医师：${['医生', p.doctor]}    ${{ d: '主任医师' }}：${['医生', p.senior]}\n`
    return d
  },
  consent(p) {
    const d = new Doc()
    const fid = p.family.id
    const spaced = `${fid.slice(0, 6)} ${fid.slice(6, 14)} ${fid.slice(14)}`
    d.w`血液透析治疗知情同意书\n\n患者姓名：${['姓名', p.name]}  性别：${p.sex}  年龄：${p.age}  住院号：${['住院号', p.zy]}\n`
    d.w`治疗风险告知：透析过程中可能出现低血压、心律失常、首次使用综合征、导管相关感染（如${{ d: '金黄色葡萄球菌' }}）、出血等；抗凝使用${{ d: '华法林钠片' }}者出血风险增加。\n`
    d.w`患者签名：${['姓名', p.name]}    日期：2024-03-02\n`
    d.w`患者授权委托人签名：${['姓名', p.family.name]}  与患者关系：${p.family.rel}  身份证号：${['身份证号', spaced]}  联系电话：${['电话', fmtMobile(p.family.phone, 'dash')]}\n`
    d.w`谈话医师签名：${['医生', p.doctor]}    见证护士：${['医生', p.nurse]}\n`
    return d
  },
  followup(p) {
    const d = new Doc()
    d.w`随访记录\n\n2024-05-10 电话随访。接电话的是患者${p.family.rel}${['姓名', p.family.name]}，说${['姓名', p.name]}最近在${['医院', p.outside]}做透析，费用走医保，社保卡号${['社保号', p.ss]}。`
    d.w`家里搬到了${['地址', p.address2]}，新手机号${['电话', fmtMobile(p.phone, 'dash')]}。`
    d.w`患者自述在外服用中药（${{ d: pick(DECOYS.herb) }}、${{ d: pick(DECOYS.herb) }}、${{ d: '王不留行10g' }}），已嘱停用并告知${{ d: '石淋' }}相关风险。`
    d.w`下次随访时间：2024-06-10。\n随访护士：${['医生', p.nurse]}\n`
    return d
  },
  transfer(p) {
    const d = new Doc()
    const target = pick(HOSPITALS.filter((h) => h !== OUR_HOSPITAL && h !== p.outside))
    d.w`转院介绍信\n\n${['医院', target]}：\n`
    d.w`兹有我院患者${['姓名', p.name]}（身份证号：${['身份证号', p.id]}，门诊号：${['就诊号', p.mz]}），因慢性肾脏病5期合并${{ d: pick(DECOYS.eponym) }}，需转贵院进一步诊治。`
    d.w`患者自费部分已由银行卡${['银行卡号', p.bank]}结清。\n`
    d.w`联系人：${['医生', p.doctor]}，${['医院', OUR_HOSPITAL]}${{ d: '肾内科（11病区）' }}，电话：${['电话', landline()]}\n`
    return d
  },
  lab(p) {
    const d = new Doc()
    d.w`检验报告单\n${['医院', OUR_HOSPITAL]} 检验科\n\n`
    d.w`姓名：${['姓名', p.name]}  病历号：${['病历号', p.mrn]}  科别：${{ d: pick(DECOYS.ward) }}  床号：${{ d: 'HD-3床' }}  标本：静脉血\n\n`
    d.w`项目        结果    单位      参考范围\n肌酐        ${int(400, 980)}     μmol/L    57-111\n尿素氮      ${int(15, 38)}.${int(0, 9)}    mmol/L    3.1-8.0\n血钾        ${int(4, 6)}.${int(0, 9)}     mmol/L    3.5-5.3\n${{ d: '白细胞' }}      ${int(4, 9)}.${int(0, 9)}     10^9/L    3.5-9.5\n血红蛋白    ${int(70, 110)}      g/L       130-175\n\n`
    d.w`试剂${{ d: '批号B20240315' }}\n送检医生：${['医生', p.doctor]}  检验者：${['医生', staffLab[0]]}  审核者：${['医生', staffLab[1]]}\n`
    return d
  },
}

// ---------------------------------------------------------------- structured files
function csv(rows) {
  const d = new Doc()
  d.t('患者姓名,性别,年龄,住院号,检验项目,结果,单位,送检医生,备注\n')
  for (let i = 0; i < rows; i += 1) {
    const p = pick(patients)
    const [item, unit] = pick([['肌酐', 'μmol/L'], ['血钾', 'mmol/L'], ['血红蛋白', 'g/L'], ['全段甲状旁腺素', 'pg/mL'], ['白蛋白', 'g/L']])
    d.w`${['姓名', p.name]},${p.sex},${p.age},${['住院号', p.zy]},${item},${int(3, 900)},${unit},${['医生', p.doctor]},`
    const r = rand()
    if (r < 0.15) d.w`家属${['姓名', p.family.name]}代取报告`
    else if (r < 0.25) d.w`危急值已电话通知${['医生', p.senior]}`
    else if (r < 0.32) d.w`复查请联系${['电话', p.family.phone]}`
    else if (r < 0.40) d.w`标本溶血 ${{ d: '批号B20240315' }}`
    d.t('\n')
  }
  return d
}

/** Pretty JSON written by hand so spans of string values are exact. */
class JsonDoc extends Doc {
  value(v) {
    if (Array.isArray(v) && typeof v[0] === 'string' && v.length === 2 && v.tag) return this.t('"').id(v[0], v[1]).t('"')
    if (v && v.decoy) return this.t('"').d(v.decoy).t('"')
    if (v && v.parts) { this.t('"'); for (const part of v.parts) { if (typeof part === 'string') this.t(part); else if (part.d) this.d(part.d); else this.id(part[0], part[1]) } return this.t('"') }
    return this.t(JSON.stringify(v))
  }
  record(obj, indent = '    ') {
    const keys = Object.keys(obj)
    this.t('{\n')
    keys.forEach((key, i) => {
      this.t(`${indent}${JSON.stringify(key)}: `)
      this.value(obj[key])
      this.t(i < keys.length - 1 ? ',\n' : '\n')
    })
    this.t(`${indent.slice(2)}}`)
  }
}
const ID = (type, text) => Object.assign([type, text], { tag: true })
const P = (...parts) => ({ parts }) // prose: strings, [type, text], { d }

function exportJson(count) {
  const d = new JsonDoc()
  d.t('[\n')
  for (let i = 0; i < count; i += 1) {
    const p = patients[i % patients.length]
    const remark = pick([
      P('陪同人', ['姓名', p.family.name], '已告知注意事项'),
      P('患者既往在', ['医院', p.outside], '行动静脉内瘘术'),
      P('联系电话变更为', ['电话', fmtMobile(p.family.phone, 'space')]),
      P('无'),
      P('拒绝使用', { d: pick(DECOYS.drug) }),
    ])
    d.t('  ')
    d.record({
      PTT_NM: ID('姓名', p.name),
      GDR_NM: p.sex,
      ID_CRD_CGY_NM: '居民身份证',
      ID_CRD_NO: ID('身份证号', p.id),
      MOB_TEL: ID('电话', p.phone),
      HOME_ADDR: ID('地址', p.address),
      INHOS_NO: ID('住院号', p.zy),
      MDC_ORG_NM: ID('医院', OUR_HOSPITAL),
      ADMN_DPT_NM: { decoy: '内一科(肾脏病科)(11病区)' },
      ADMN_DCT_NM: ID('医生', p.doctor),
      DIAG_CD: { decoy: 'N18.5' },
      DIAG_NM: '慢性肾脏病5期',
      ADMN_DT_TM: `2024-0${int(1, 9)}-1${int(0, 9)} 08:0${int(0, 9)}:00`,
      REMARK: remark,
    }, '    ')
    d.t(i < count - 1 ? ',\n' : '\n')
  }
  d.t(']\n')
  return d
}

/** Regional-platform style: item name / item value pairs, prose in 文本主体. */
function emrItems(p) {
  const d = new JsonDoc()
  const items = [
    ['姓名', ID('姓名', p.name)],
    ['性别', p.sex],
    ['联系地址', ID('地址', p.address)],
    ['联系电话', ID('电话', p.phone)],
    ['主诉', '规律透析3年，内瘘震颤减弱2天'],
    ['文本主体', P('患者', ['姓名', p.name], '，由其', p.family.rel, ['姓名', p.family.name], '陪同就诊。3年前在', ['医院', p.outside], '确诊尿毒症，此后于', { d: '血液净化中心' }, '规律透析，主管医生', ['医生', p.doctor], '。既往', { d: pick(DECOYS.eponym) }, '病史。今日超声示内瘘狭窄，拟行PTA。')],
    ['诊断', { decoy: pick(DECOYS.eponym) }],
    ['签名医生', ID('医生', p.senior)],
  ]
  d.t('[\n')
  items.forEach(([name, value], i) => {
    d.t('  ')
    d.record({ ITM_NM: name, ITM_VLU: value }, '    ')
    d.t(i < items.length - 1 ? ',\n' : '\n')
  })
  d.t(']\n')
  return d
}

// ---------------------------------------------------------------- write
const files = []
const kinds = Object.keys(T)
patients.forEach((p, i) => {
  // Two or three documents per patient, different kinds.
  const chosen = new Set([kinds[i % kinds.length], kinds[(i + 3) % kinds.length]])
  if (i % 3 === 0) chosen.add(kinds[(i + 5) % kinds.length])
  for (const kind of chosen) files.push({ name: `notes/pt${String(i + 1).padStart(2, '0')}_${kind}.txt`, kind, doc: T[kind](p) })
  if (i % 4 === 0) files.push({ name: `emr/pt${String(i + 1).padStart(2, '0')}_emr_items.json`, kind: 'emr-json', doc: emrItems(p) })
})
files.push({ name: 'tables/lab_results.csv', kind: 'csv', doc: csv(45) })
files.push({ name: 'tables/admissions_export.json', kind: 'export-json', doc: exportJson(20) })

await rm(join(outDir, 'corpus'), { recursive: true, force: true })
const gold = { seed, files: [] }
for (const file of files) {
  const text = file.doc.text
  for (const g of file.doc.gold) if (text.slice(g.start, g.end) !== g.text) throw new Error(`span mismatch in ${file.name}`)
  const path = join(outDir, 'corpus', file.name)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
  gold.files.push({ name: file.name, kind: file.kind, chars: text.length, identifiers: file.doc.gold, decoys: file.doc.decoys })
}
await writeFile(join(outDir, 'gold.json'), JSON.stringify(gold, null, 1))
const n = gold.files.reduce((acc, f) => acc + f.identifiers.length, 0)
const byType = {}
for (const f of gold.files) for (const g of f.identifiers) byType[g.type] = (byType[g.type] ?? 0) + 1
console.log(`${gold.files.length} files, ${n} identifier occurrences, ${gold.files.reduce((a, f) => a + f.decoys.length, 0)} decoys`)
console.log(byType)
