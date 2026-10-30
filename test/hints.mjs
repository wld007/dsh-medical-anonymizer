/**
 * Field-policy regression checks. These keys come from common hospital export
 * schemas; a missing mapping silently leaves identifiers in the output.
 */
import assert from 'node:assert/strict'
import { hintForKey } from '../lib/formats.js'

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
  // non-identifiers that must stay untouched
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
}

let failed = 0
for (const [key, expected] of Object.entries(cases)) {
  const actual = hintForKey(key)
  if (actual !== expected) {
    failed += 1
    console.error(`FAIL ${key}: expected ${expected}, got ${actual}`)
  }
}

assert.equal(failed, 0, `${failed} field-policy case(s) failed`)
console.log(`HINTS PASS (${Object.keys(cases).length} cases)`)
