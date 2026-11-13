/**
 * Vault in SQLite (lib/pseudonym.js): rows, per-row encryption, import of
 * vault.json, passphrase changes, withdrawal, incremental saves, fallback.
 * Run: node test/vault.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Vault } from '../lib/pseudonym.js'
import { sqliteAvailable, useFileRecords } from '../lib/records.js'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'vault')

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
const bytes = async (file) => Buffer.concat([await readFile(file).catch(() => Buffer.alloc(0)), await readFile(`${file}-wal`).catch(() => Buffer.alloc(0))])
const exists = (file) => stat(file).then(() => true, () => false)
const loaded = (file, passphrase = '', options) => new Vault(file, passphrase, options).load()

await rm(tmp, { recursive: true, force: true })
await mkdir(tmp, { recursive: true })

if (await sqliteAvailable()) {
  const file = join(tmp, 'a', 'vault.json')
  const db = join(tmp, 'a', 'vault.sqlite')
  await check('新映射库：vault.sqlite（权限 600），不再写 vault.json；假名跨实例一致', async () => {
    const vault = await loaded(file)
    vault.runId = 'r1'
    const zhang = vault.token('姓名', '张三')
    vault.token('电话', '13800138000')
    await vault.save()
    assert.equal(vault.path, db)
    assert.equal((await stat(db)).mode & 0o777, 0o600)
    assert.equal(await exists(file), false)
    const again = await loaded(file)
    assert.equal(again.salt, vault.salt)
    assert.equal(again.token('姓名', '张三'), zhang)
    assert.equal(again.countRun('r1'), 2)
    assert.ok(again.pseudonyms.has(zhang))
  })

  await check('只写新增的行：大库里加一条也很快，发假名查重不随库大小变慢', async () => {
    const big = await loaded(join(tmp, 'big', 'vault.json'))
    const started = Date.now()
    for (let i = 0; i < 60000; i += 1) big.token('病历号', `MR${String(i).padStart(8, '0')}`)
    const issued = Date.now() - started
    await big.save()
    assert.ok(issued < 4000, `issuing 60000 took ${issued} ms`)
    const reread = await loaded(join(tmp, 'big', 'vault.json'))
    assert.equal(reread.size(), 60000)
    reread.token('姓名', '新来的')
    const at = Date.now()
    await reread.save()
    assert.ok(Date.now() - at < 1500, `saving one new mapping took ${Date.now() - at} ms`)
    assert.equal((await loaded(join(tmp, 'big', 'vault.json'))).size(), 60001)
  })

  await check('旧 vault.json（明文）第一次使用时并入，假名与盐不变，原文件保留', async () => {
    const legacy = join(tmp, 'b', 'vault.json')
    const old = await loaded(legacy, '', { format: 'json' })
    old.runId = 'old'
    const token = old.token('姓名', '李四')
    await old.save()
    const before = await readFile(legacy, 'utf8')
    const vault = await loaded(legacy)
    assert.equal(vault.path, join(tmp, 'b', 'vault.sqlite'))
    assert.equal(vault.salt, old.salt)
    assert.equal(vault.token('姓名', '李四'), token)
    assert.equal(vault.countRun('old'), 1)
    assert.equal(await readFile(legacy, 'utf8'), before)
  })

  await check('旧 vault.json（加密）用口令并入；口令不对时拒绝', async () => {
    const legacy = join(tmp, 'c', 'vault.json')
    const old = await loaded(legacy, 'pass-1', { format: 'json' })
    const token = old.token('姓名', '王五')
    await old.save()
    await assert.rejects(loaded(legacy, 'wrong'), /口令不匹配/)
    assert.equal(await exists(join(tmp, 'c', 'vault.sqlite')), false, 'nothing created on a failed import')
    const vault = await loaded(legacy, 'pass-1')
    assert.equal(vault.token('姓名', '王五'), token)
  })

  const encFile = join(tmp, 'd', 'vault.json')
  const encDb = join(tmp, 'd', 'vault.sqlite')
  await check('设了口令：每条原值单独加密，库文件里读不到原值；无口令或口令不对时拒绝', async () => {
    const vault = await loaded(encFile, 'secret-1')
    vault.token('姓名', '赵六')
    vault.token('身份证号', '11010519491231002X')
    await vault.save()
    const raw = await bytes(encDb)
    assert.ok(!raw.includes(Buffer.from('赵六')) && !raw.includes(Buffer.from('11010519491231002X')))
    await assert.rejects(loaded(encFile), /已加密/)
    await assert.rejects(loaded(encFile, 'secret-x'), /口令不匹配/)
    const reread = await loaded(encFile, 'secret-1')
    assert.ok([...reread.entries.values()].some((entry) => entry.original === '赵六'))
  })

  await check('更换口令、清除口令：全部行重新加密 / 恢复明文', async () => {
    const vault = await loaded(encFile, 'secret-1')
    vault.rekey('secret-2')
    await vault.save()
    await assert.rejects(loaded(encFile, 'secret-1'), /口令不匹配/)
    const second = await loaded(encFile, 'secret-2')
    assert.equal(second.size(), 2)
    second.rekey('')
    await second.save()
    assert.ok((await bytes(encDb)).includes(Buffer.from('赵六')))
    const plain = await loaded(encFile)
    assert.equal(plain.size(), 2)
  })

  await check('明文库配置口令后，下次保存即加密（无新增也是）', async () => {
    const vault = await loaded(encFile, 'secret-3')
    await vault.save()
    assert.ok(!(await bytes(encDb)).includes(Buffer.from('赵六')))
    assert.equal((await loaded(encFile, 'secret-3')).size(), 2)
  })

  await check('撤销某批次的映射：行被删除，库文件里不留原值', async () => {
    const f = join(tmp, 'e', 'vault.json')
    const vault = await loaded(f)
    vault.runId = 'keep'
    vault.token('姓名', '保留者')
    vault.runId = 'drop'
    vault.token('姓名', '撤销者甲')
    await vault.save()
    const undo = await loaded(f)
    assert.equal(undo.forgetRun('drop'), 1)
    assert.equal(undo.countRun('drop'), 0)
    await undo.save()
    const after = await loaded(f)
    assert.deepEqual([...after.entries.values()].map((entry) => entry.original), ['保留者'])
    assert.ok(!(await bytes(join(tmp, 'e', 'vault.sqlite'))).includes(Buffer.from('撤销者甲')))
  })

  await check('两个实例交替保存：彼此新增的都在，撤销的不回来（加密库也一样）', async () => {
    for (const passphrase of ['', 'pw']) {
      const f = join(tmp, `m${passphrase ? 'e' : 'p'}`, 'vault.json')
      const seed = await loaded(f, passphrase)
      seed.runId = 'old'
      seed.token('姓名', '甲')
      await seed.save()
      const a = await loaded(f, passphrase)
      const b = await loaded(f, passphrase)
      b.token('姓名', '乙')
      await b.save()
      a.forgetRun('old')
      a.token('姓名', '丙')
      await a.save()
      const names = [...(await loaded(f, passphrase)).entries.values()].map((entry) => entry.original).sort()
      assert.deepEqual(names, ['丙', '乙'].sort(), passphrase)
    }
  })
}

useFileRecords(true)
await check('没有 node:sqlite 时仍写 vault.json', async () => {
  const f = join(tmp, 'files', 'vault.json')
  const vault = await loaded(f)
  vault.token('姓名', '张三')
  await vault.save()
  assert.equal(vault.path, f)
  assert.ok(JSON.parse(await readFile(f, 'utf8')).entries.some((entry) => entry.original === '张三'))
  assert.equal(await exists(join(tmp, 'files', 'vault.sqlite')), false)
})
useFileRecords(false)

await rm(tmp, { recursive: true, force: true })
if (failures) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nVAULT PASS')
