/**
 * Field-policy regression checks. These keys come from common hospital export
 * schemas; a missing mapping silently leaves identifiers in the output.
 */
import assert from 'node:assert/strict'
import { hintForKey, hintForSibling } from '../lib/formats.js'
import { scan, genericInstitution } from '../lib/rules.js'

const cases = {
  // patient / contact names
  PTT_NM: '姓名',
  PT_NM: '姓名',
  PATIENT_NM: '姓名',
  CTCT_NM: '姓名',
  CONTACT_NM: '姓名',
  NAME: '姓名',
  // identifiers
  ID_CRD_NO: '身份证号',
  ID_CARD_NO: '身份证号',
  CERT_NO: '身份证号',
  CTCT_TEL_NO: '电话',
  TEL_NO: '电话',
  PHONE_NO: '电话',
  // addresses and regions
  CURR_ADDR: '地址',
  CURR_ADDR_PRV_NM: '地址',
  CURR_ADDR_CTY_NM: '地址',
  CURR_ADDR_CNTY_NM: '地址',
  HRGST_ADDR: '地址',
  WRK_UNT_ADDR: '地址',
  // visit identifiers
  INHOS_NO: '住院号',
  PID: '病历号',
  // staff names
  ODR_OPN_DCT_NM: '医生',
  ODR_ADT_STFF_NM: '医生',
  ODR_CHK_NUS_NM: '医生',
  CRT_STFF_NM: '医生',
  // organizations
  MDC_ORG_NM: '医院',
  SOURCE_ORG_NM: '医院',
  // record/linkage keys: masked as record identifiers
  PRM_KEY: '病历号',
  RCD_NO: '病历号',
  // staff codes and signatures
  ADMN_DCT_CD: '医生',
  RSPSBLT_NUS_CD: '医生',
  RSPSBLT_NUS_SGNT: '医生',
  // non-identifiers that must stay untouched
  ID_CRD_CGY_CD: null,
  ID_CRD_CGY_NM: null,
  CRD_TP_CD: null,
  CRD_TP_NM: null,
  INHOS_CGY_CD: null,
  INHOS_STTS_CD: null,
  ADMN_BED_NO: null,
  DCT_GRP_NO: null,
  ADMN_DPT_CD: null,
  _id: null,
  DPT_NM: null,
  WRD_NM: null,
  ODR_ITM_NM: null,
  BTH_DT: null,
  DCMT_NM_CN: null,
  GDR_NM: null,
  HOTEL: null,
  VALID_NO: null,
  PADDR: null,
  // regional platform (GEHR) exports
  SLF_NM: '姓名',
  CNTCT_PSN_NM: '姓名',
  GRDN_NM: '姓名',
  CLLT_SPCM_PSN_NM: '医生',
  VRF_RCPT_PSN_NM: '医生',
  DLVR_EXAM_PSN_NM: '医生',
  WRK_UNT_NM: '地址',
  USER_ID: '病历号',
  VST_UNQ_ID: '就诊号',
  OTPT_EMG_NO: '就诊号',
  OTPT_EMG_NO_DSPLY: '就诊号',
  RGST_NO: '就诊号',
  MDC_ORG_CD: '医院',
  CRT_RCD_MDC_ORG_CD: '医院',
  RCD_MNG_ORG_NM: '医院',
  ORG_ATRBT_NM: null,
  ORG_ATRBT_CD: null,
  ORG_ADMNSTRT_RGN_LVL_NM: null,
  MDC_ORG_LVL_CD: null,
  MDC_ORG_RKG_NM: null,
  VST_SRL_NO: null,
  VST_DPT_NM: null,
  DLVR_EXAM_DPT_NM: null,
  ITM_NM: null,
  ITM_VLU: null,
}

let failed = 0
for (const [key, expected] of Object.entries(cases)) {
  const actual = hintForKey(key)
  if (actual !== expected) {
    failed += 1
    console.error(`FAIL ${key}: expected ${expected}, got ${actual}`)
  }
}

// Entity-attribute-value records: the label sits in a sibling key.
const siblingCases = [
  [{ ITM_NM: '姓名', ITM_VLU: 'x' }, 'ITM_VLU', '姓名'],
  [{ ITM_NM: '地址', ITM_VLU: 'x' }, 'ITM_VLU', '地址'],
  [{ ITM_NM: '联系电话', ITM_VLU: 'x' }, 'ITM_VLU', '电话'],
  [{ ITM_NM: '文本主体', ITM_VLU: 'x' }, 'ITM_VLU', null],
  [{ ITM_NM: '姓名', ITM_VLU: 'x' }, 'ITM_NM', null],
  [{ name: '身份证号', value: 'x' }, 'value', '身份证号'],
]
for (const [parent, key, expected] of siblingCases) {
  const actual = hintForSibling(parent, key)
  if (actual !== expected) {
    failed += 1
    console.error(`FAIL sibling ${JSON.stringify(parent)}.${key}: expected ${expected}, got ${actual}`)
  }
}

// Institution categories are not names.
const institutionCases = {
  医院: true, 中医院: true, 综合医院: true, 区属医院: true, 市属医院: true, 省属医院: true,
  妇幼保健院: true, 专科医院: true, 人民医院: true, 三级甲等医院: true, 中心卫生院: true,
  东江市人民医院: false, 东江市中医院: false, 南海县妇幼保健院: false, 崖城镇中心卫生院: false,
}
for (const [value, expected] of Object.entries(institutionCases)) {
  if (genericInstitution(value) !== expected) {
    failed += 1
    console.error(`FAIL genericInstitution(${value}): expected ${expected}`)
  }
}
for (const text of ['到医院就诊', '区属医院', '中医院发热门诊', 'ORG:综合医院']) {
  const hits = scan(text).filter((entity) => entity.type === '医院')
  if (hits.length > 0) {
    failed += 1
    console.error(`FAIL scan(${text}) found hospital ${hits.map((hit) => hit.text)}`)
  }
}
{
  const hits = scan('住址：东江市万城镇市委党校\t\t电话号码：13800138000')
  const address = hits.find((hit) => hit.type === '地址')
  if (address?.text !== '东江市万城镇市委党校' || !hits.some((hit) => hit.type === '电话')) {
    failed += 1
    console.error(`FAIL address before phone: ${JSON.stringify(hits)}`)
  }
  const markup = scan('F=[引用值:姓名><isele 1>[<isele 0>赵小明<isele 1>]<isele 0> F=[引用值:联系地址><isele 1>[<isele 0>海南省东江市党校<isele 1>]')
  if (!markup.some((hit) => hit.type === '姓名' && hit.text === '赵小明') || !markup.some((hit) => hit.type === '地址' && hit.text === '海南省东江市党校')) {
    failed += 1
    console.error(`FAIL EMR markup: ${JSON.stringify(markup)}`)
  }
}

assert.equal(failed, 0, `${failed} field-policy case(s) failed`)
console.log(`HINTS PASS (${Object.keys(cases).length + siblingCases.length + Object.keys(institutionCases).length + 6} cases)`)
