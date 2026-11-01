/**
 * Policy unit checks: defaults, validation, masks, and quasi-identifier transforms.
 */
import assert from 'node:assert/strict'
import {
  resolvePolicy, normalizePolicyPatch, maskValue, quasiReplacements, dateShiftDays, isProtectedText,
} from '../lib/policy.js'

const apply = (text, replacements) => {
  let out = text
  for (const item of [...replacements].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, item.start) + item.replacement + out.slice(item.end)
  }
  return out
}

// Defaults reproduce the original behaviour.
const defaults = resolvePolicy({})
assert.ok(Object.values(defaults.identifiers).every((strategy) => strategy === 'pseudonym'))
assert.equal(defaults.quasiEnabled, false)
// Unknown values fall back instead of breaking a run.
assert.equal(resolvePolicy({ identifierPolicy: { name: 'bogus' } }).identifiers['姓名'], 'pseudonym')
// Saving validates strictly.
assert.throws(() => normalizePolicyPatch({ identifierPolicy: { name: 'bogus' } }), /无效/)
assert.throws(() => normalizePolicyPatch({ quasiPolicy: { sex: 'band10' } }), /无效/)
assert.throws(() => normalizePolicyPatch({ identifierPolicy: { nope: 'mask' } }), /未知/)
assert.equal(normalizePolicyPatch({ identifierPolicy: { name: 'mask' } }).identifierPolicy.phone, 'pseudonym')

// Masks.
assert.equal(maskValue('姓名', '张三'), '张*')
assert.equal(maskValue('电话', '13800138000'), '138****8000')
assert.equal(maskValue('电话', '010-12345678'), '010-****5678')
assert.equal(maskValue('身份证号', '11010519491231002X'), '110***********002X')
assert.equal(maskValue('地址', '北京市朝阳区幸福路1号'), '北京市朝阳区****')
assert.equal(maskValue('邮箱', 'zhangsan@example.com'), 'z***@example.com')
assert.ok(isProtectedText('张*', new Set()))
assert.ok(isProtectedText('[姓名]', new Set()))
assert.ok(!isProtectedText('张三', new Set()))

// Dates.
const quasi = (text, strategies, extra = {}) => apply(text, quasiReplacements({ text, ...extra }, strategies, 37))
assert.equal(quasi('入院日期：2024-03-01，出院 2024-03-11 09:30', { 日期: 'shift' }), '入院日期：2024-04-07，出院 2024-04-17 09:30')
assert.equal(quasi('2024年3月1日入院', { 日期: 'shift' }), '2024年4月7日入院')
assert.equal(quasi('2024/03/01', { 日期: 'month' }), '2024/03')
assert.equal(quasi('2024年3月1日', { 日期: 'year' }), '2024年')
assert.equal(quasi('19491231', { 日期: 'shift' }, { quasi: '日期' }), '19500206')
assert.equal(quasi('19491231', { 日期: 'shift' }), '19491231') // compact only in date fields
assert.equal(quasi('2024-02-30', { 日期: 'shift' }), '2024-02-30') // invalid dates untouched
// Ages.
assert.equal(quasi('年龄：45岁，其子 12 岁', { 年龄: 'band10' }), '年龄：40-49岁，其子 10-19岁')
assert.equal(quasi('年龄：93', { 年龄: 'band5' }), '年龄：≥90')
assert.equal(quasi('45', { 年龄: 'band10' }, { quasi: '年龄' }), '40-49')
// Sex and postal code.
assert.equal(quasi('性别：男', { 性别: 'redact' }), '性别：[性别]')
assert.equal(quasi('女', { 性别: 'redact' }, { quasi: '性别' }), '[性别]')
assert.equal(quasi('邮编：100020', { 邮编: 'prefix3' }), '邮编：100***')
// Keep means untouched.
assert.equal(quasi('2024-03-01 年龄：45岁 性别：男', { 日期: 'keep', 年龄: 'keep', 性别: 'keep' }), '2024-03-01 年龄：45岁 性别：男')

// One stable non-zero shift per salt.
assert.equal(dateShiftDays('a'), dateShiftDays('a'))
assert.notEqual(dateShiftDays('a'), 0)
assert.ok(Math.abs(dateShiftDays('b')) <= 365)

// False-positive exclusions.
assert.deepEqual(defaults.allowValues, [])
assert.deepEqual(defaults.skipFields, [])
assert.deepEqual(resolvePolicy({ allowValues: ['01', ' 01 ', '', '居民身份证'] }).allowValues, ['01', '居民身份证'])
assert.deepEqual(normalizePolicyPatch({ skipFields: 'ADMN_BED_NO\n\nDCT_GRP_NO\n' }).skipFields, ['ADMN_BED_NO', 'DCT_GRP_NO'])
assert.throws(() => normalizePolicyPatch({ allowValues: 5 }), /格式不正确/)
assert.throws(() => normalizePolicyPatch({ allowValues: ['x'.repeat(201)] }), /200/)

// Format plausibility of detections.
{
  const { plausible } = await import('../lib/rules.js')
  assert.ok(plausible('身份证号', '01', 'header'), 'a category code is not an ID')
  assert.ok(plausible('身份证号', '居民身份证', 'header'))
  assert.equal(plausible('身份证号', '11010519491231002X', 'header'), null)
  assert.equal(plausible('身份证号', 'E12345678', 'llm'), null)
  assert.ok(plausible('医院', '内一科(肾脏病科)(11病区)', 'llm'), 'a ward is not a hospital')
  assert.equal(plausible('医院', '北京示范第一人民医院', 'llm'), null)
  assert.equal(plausible('医院', '某某医院心内科', 'llm'), null)
  assert.ok(plausible('住院号', '12S', 'llm'))
  assert.equal(plausible('住院号', '20230045', 'llm'), null)
  assert.ok(plausible('医生', 'AUTO', 'header'))
  assert.ok(plausible('姓名', '1234', 'llm'))
  assert.equal(plausible('医生', '1234', 'header'), null, 'a staff code in a doctor column is still replaced')
}

console.log('POLICY PASS')
