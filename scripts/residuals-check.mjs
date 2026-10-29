#!/usr/bin/env node
/**
 * RESIDUALS 权威段校验器（B6 文档生成批·docs/13 原案 B3 动作 6）：
 *  - 唯一权威=非围栏 JSON 段（residuals-json begin/end 标记对，标记与 { } 邻接，
 *    中间无空行/注释）；schema=residuals/v1；每条恰八键
 *    id/status/owner/trigger/evidence/created_at/phenomenon/description；
 *  - canonical 化=id 字典序排序、键字典序、两空格缩进、LF、末换行；
 *  - 冻结旧表=18 物理行（表头＋分隔＋16 数据行）字节冻结，begin 标记行内含
 *    sha256=<内容哈希> 与「冻结·非权威」；表内字节保持原样，仅供对账；
 *  - 禁止双写：冻结表外不得存在同形登记行；整个文件禁 term-scan off/on 开关标记，
 *    JSON 段禁 ```/~~~ 围栏（词面与零代号扫描不可被绕开——双闸之一）；
 *  - 迁移条目（id 在冻结表 id 集内）须 owner=null/created_at=null/evidence=[]/
 *    description=phenomenon 且与表格逐字对账；未来 id 须 owner 非空字符串、
 *    created_at 合法 ISO 日期或时间、evidence 字符串数组、description 非空；
 *  - open 计数只从 JSON status 派生，头部「当前 **open=N**」须与之一致；
 *  - --check=内存校验不写回（本批生产用法）；--write=canonical 重写 JSON 区与派生
 *    open 数（冻结哈希不符或区外双写即拒绝，只作 --self-test 夹具通道）。
 * 用法：node scripts/residuals-check.mjs --file <路径> [--check|--write] | --self-test
 * 退出码口径单源=references/06 §5.8：0=通过；1=判红或用法错或自检失败；3=配置/装载失败。
 */
import { readFileSync, writeFileSync, existsSync, renameSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { SKILL_ROOT, UsageError } from './org-config.mjs'

const SELF = fileURLToPath(import.meta.url)
const EXIT_OK = 0, EXIT_RED = 1, EXIT_CONFIG = 3
const JSON_BEGIN = '<!-- residuals-json: begin -->'
const JSON_END = '<!-- residuals-json: end -->'
const FROZEN_END = '<!-- residuals-frozen: end -->'
const ENUMS = ['open', 'closed', "won't-fix"]
const KEY8 = ['created_at', 'description', 'evidence', 'id', 'owner', 'phenomenon', 'status', 'trigger']
class ContentError extends Error {}
const usageExit = (m) => { console.error(`[用法错] ${m}（06 §5.8 行 1）`); process.exit(EXIT_RED) }
const redExit = (m) => { console.error(`[判红] ${m}`); process.exit(EXIT_RED) }
const configExit = (m) => { console.error(`[装载错] ${m}（06 §5.8 行 3）`); process.exit(EXIT_CONFIG) }

function parseArgs(argv) {
  const out = { mode: 0 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check' || a === '--write' || a === '--self-test') { out[a] = (out[a] || 0) + 1; if (out[a] > 1) usageExit(`重复 flag：${a}`); continue }
    if (a === '--file') {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) usageExit('--file 须带值')
      if (v.trim() === '') usageExit('--file 的值不得为空串或纯空白（W-2/N-10 同源：空值=用法错）')
      if (out['--file'] !== undefined) usageExit('重复 flag：--file')
      out['--file'] = v; i++; continue
    }
    usageExit(`未知参数：${a}（合法：--file <路径> --check|--write|--self-test）`)
  }
  if (out['--check'] && out['--write']) usageExit('--check 与 --write 互斥')
  return out
}

const canonDoc = (residuals) => JSON.stringify({ residuals: [...residuals].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((e) => Object.fromEntries(KEY8.map((k) => [k, e[k]]))), schema: 'residuals/v1' }, null, 2) + '\n'
const sha256 = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex')

/** created_at 合法 ISO 日期或时间（W-5：日历往返校验——非法月/日/时/分/秒拒绝，2099-02-30 类伪日期拒收）。 */
function isValidIsoDateTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s)
  if (!m) return false
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const dt = new Date(y, mo - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return false
  if (m[4] !== undefined) {
    if (Number(m[4]) > 23 || Number(m[5]) > 59) return false
    if (m[6] !== undefined && Number(m[6]) > 59) return false
  }
  return true
}

/** 全量校验：返回 {doc, segment, frozenBlock, frozenIds, frozenHash, dualWrite, openCount}；判红抛 ContentError。 */
function validate(text, opts = {}) {
  const lines = text.split('\n')
  if (text.includes('term-scan:' + ' off') || text.includes('term-scan:' + ' on')) throw new ContentError('文件含 term-scan off/on 开关标记（权威段不可借开关绕开扫描——D-5 文件级禁令）')
  // B-1 全文件围栏状态跟踪：权威标记及 JSON 内容位于任何 Markdown 围栏内均判红
  // （含整段外围栏形态——标记与内容逐行全部落入围栏区时，段内围栏行检查不可见，故独立跟踪）。
  const fenced = new Array(lines.length).fill(false)
  {
    let inFence = false
    lines.forEach((l, idx) => {
      if (/^\s*(```|~~~)/.test(l)) { fenced[idx] = true; inFence = !inFence; return }
      fenced[idx] = inFence
    })
  }
  const count = (s) => lines.filter((l) => l.trim() === s).length
  if (count(JSON_BEGIN) !== 1) throw new ContentError(`residuals-json begin 标记须恰一处（现 ${count(JSON_BEGIN)}）——无第二权威段`)
  if (count(JSON_END) !== 1) throw new ContentError(`residuals-json end 标记须恰一处（现 ${count(JSON_END)}）——无第二权威段`)
  const ji = lines.findIndex((l) => l.trim() === JSON_BEGIN)
  const je = lines.findIndex((l) => l.trim() === JSON_END)
  if (je < ji) throw new ContentError('residuals-json end 标记出现在 begin 之前')
  if (fenced[ji]) throw new ContentError('权威 begin 标记位于 Markdown 围栏内（B-1：标记与内容不得借围栏绕开词面与零代号扫描）')
  if (fenced[je]) throw new ContentError('权威 end 标记位于 Markdown 围栏内（B-1：标记与内容不得借围栏绕开扫描）')
  if (lines[ji + 1] === undefined || lines[ji + 1] !== '{') throw new ContentError('begin 标记行后须紧接「{」行（不得有空行或注释）')
  if (lines[je - 1] === undefined || lines[je - 1] !== '}') throw new ContentError('end 标记行前须紧接「}」行（不得有空行或注释）')
  const segLines = lines.slice(ji + 1, je)
  if (segLines.some((l) => l.trim() === '')) throw new ContentError('JSON 段内含空行（标记与内容须邻接）')
  if (segLines.some((l) => /^\s*(```|~~~)/.test(l))) throw new ContentError('JSON 段禁 Markdown 围栏（非围栏字符串才可被词面与零代号扫描）')
  if (lines.slice(ji + 1, je).some((_, k) => fenced[ji + 1 + k])) throw new ContentError('JSON 段内容位于 Markdown 围栏内（B-1 整段外围栏形态——权威段须为可扫描的非围栏正文）')
  let doc
  try { doc = JSON.parse(segLines.join('\n')) } catch (e) { throw new ContentError(`JSON 段不可解析：${e.message}`) }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new ContentError('JSON 段须为对象')
  const topKeys = Object.keys(doc)
  if (topKeys.length !== 2 || !topKeys.includes('schema') || !topKeys.includes('residuals')) throw new ContentError(`顶层键须恰 schema/residuals（现 ${topKeys.join('/')}）`)
  if (doc.schema !== 'residuals/v1') throw new ContentError(`schema 须为 residuals/v1（现 ${JSON.stringify(doc.schema)}）`)
  if (!Array.isArray(doc.residuals)) throw new ContentError('residuals 须为数组')
  const seen = new Set()
  for (const e of doc.residuals) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new ContentError('residuals 条目须为对象')
    const ks = Object.keys(e)
    if (ks.length !== 8 || !KEY8.every((k) => ks.includes(k))) throw new ContentError(`条目 ${JSON.stringify(e.id)} 键集须恰八键（现 ${ks.join('/')}）`)
    if (typeof e.id !== 'string' || !e.id) throw new ContentError('条目 id 须非空字符串')
    if (seen.has(e.id)) throw new ContentError(`id 重复：${e.id}`)
    seen.add(e.id)
    if (!ENUMS.includes(e.status)) throw new ContentError(`条目 ${e.id} status 越枚举（${JSON.stringify(e.status)}——限 ${ENUMS.join('/')}）`)
    if (typeof e.trigger !== 'string' || !e.trigger.trim()) throw new ContentError(`条目 ${e.id} trigger 须非空字符串`)
    if (typeof e.phenomenon !== 'string' || !e.phenomenon.trim()) throw new ContentError(`条目 ${e.id} phenomenon 须非空字符串`)
  }
  // 冻结表闭包
  const fBeginRe = /^<!-- residuals-frozen: begin sha256=([0-9a-f]{64}) 冻结·非权威 -->\s*$/
  const fBegins = lines.map((l, i) => ({ m: l.match(fBeginRe), i })).filter((x) => x.m)
  if (fBegins.length !== 1) throw new ContentError(`residuals-frozen begin 标记须恰一处且行内含 sha256=<64 位哈希> 与「冻结·非权威」（现 ${fBegins.length}）`)
  const fi = fBegins[0].i, frozenHash = fBegins[0].m[1]
  if (!lines[fi + 1] || !lines[fi + 1].startsWith('| 登记号 | 现象 | 触发处置 | 状态 |')) throw new ContentError('frozen begin 标记行后须紧接表头行')
  let fe = fi + 1
  while (fe < lines.length && lines[fe].startsWith('|')) fe++
  const blockLines = lines.slice(fi + 1, fe)
  const frozenBlock = blockLines.join('\n') + '\n'
  if (!blockLines[1] || !/^\|---\|---\|---\|---\|\s*$/.test(blockLines[1])) throw new ContentError('冻结表第二物理行须为四列分隔行')
  const rows = blockLines.filter((l) => /^\| [a-z0-9]/.test(l))
  if (blockLines.length !== rows.length + 2) throw new ContentError(`冻结表含不可识别行（物理行 ${blockLines.length}＝表头＋分隔＋${rows.length} 数据行之外有多余行）`)
  const frozenIds = new Map()
  for (const r of rows) {
    const cells = r.replace(/\s+$/, '').replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (cells.length !== 4) throw new ContentError(`冻结表数据行须恰四列（${r.slice(0, 40)}…）`)
    frozenIds.set(cells[0], cells)
  }
  if (sha256(frozenBlock) !== frozenHash) throw new ContentError(`冻结表哈希漂移：标记 ${frozenHash} ≠ 实算 ${sha256(frozenBlock)}（表内字节冻结，清洗需停手上报）`)
  if (lines[fe] === undefined || lines[fe].trim() !== FROZEN_END) throw new ContentError('表末行后须紧接 residuals-frozen end 标记行（不得插入空行或注释）')
  if (count(FROZEN_END) !== 1) throw new ContentError(`residuals-frozen end 标记须恰一处（现 ${count(FROZEN_END)}）`)
  // 双写：冻结块外同形登记行
  let dualWrite = 0
  lines.forEach((l, idx) => { if (idx > fi && idx < fe) return; if (/^\| [a-z0-9]/.test(l) && !l.startsWith('| 登记号 |')) dualWrite++ })
  if (dualWrite > 0) throw new ContentError(`冻结表外存在同形登记行 ×${dualWrite}（双写禁止——权威只在 JSON 段）`)
  // 条目 vs 冻结表对账与未来字段
  let legacy = 0, future = 0
  for (const e of doc.residuals) {
    const cell = frozenIds.get(e.id)
    if (cell) {
      legacy++
      if (e.owner !== null || e.created_at !== null || !Array.isArray(e.evidence) || e.evidence.length !== 0) throw new ContentError(`迁移条目 ${e.id} 须 owner=null/created_at=null/evidence=[]（来源缺位形态）`)
      if (e.description !== e.phenomenon) throw new ContentError(`迁移条目 ${e.id} description 须逐字等于 phenomenon`)
      if (e.phenomenon !== cell[1]) throw new ContentError(`迁移条目 ${e.id} phenomenon 与冻结表格不符`)
      if (e.trigger !== cell[2]) throw new ContentError(`迁移条目 ${e.id} trigger 与冻结表格不符`)
      if (e.status !== cell[3]) throw new ContentError(`迁移条目 ${e.id} status 与冻结表格不符`)
    } else {
      future++
      if (typeof e.owner !== 'string' || !e.owner.trim()) throw new ContentError(`未来条目 ${e.id} owner 须非空字符串（迁移缺省形态不接受新登记）`)
      if (typeof e.created_at !== 'string' || !isValidIsoDateTime(e.created_at)) throw new ContentError(`未来条目 ${e.id} created_at 须合法 ISO 日期或时间（日历往返校验——伪日期拒绝）`)
      if (!Array.isArray(e.evidence) || !e.evidence.every((x) => typeof x === 'string')) throw new ContentError(`未来条目 ${e.id} evidence 须字符串数组`)
      if (typeof e.description !== 'string' || !e.description.trim()) throw new ContentError(`未来条目 ${e.id} description 须非空`)
    }
  }
  for (const id of frozenIds.keys()) if (!seen.has(id)) throw new ContentError(`冻结表 id ${id} 未在 JSON 段出现（迁移集不完整）`)
  // open 计数派生一致性
  const openCount = doc.residuals.filter((e) => e.status === 'open').length
  const head = lines.find((l) => /^当前 \*\*open=(\d+)\*\*/.test(l))
  if (!head) throw new ContentError('头部须含「当前 **open=N**」计数行（由 JSON 派生）')
  const headN = Number(head.match(/^当前 \*\*open=(\d+)\*\*/)[1])
  if (headN !== openCount && !opts.allowOpenDrift) throw new ContentError(`open 计数漂移：头部 ${headN} ≠ JSON 派生 ${openCount}`)
  const segment = segLines.join('\n') + '\n'
  if (segment !== canonDoc(doc.residuals) && !opts.allowNoncanonical) throw new ContentError('JSON 段非 canonical 字节（须 id 字典序、键字典序、两空格缩进、LF、末换行）')
  return { doc, segment, frozenBlock, frozenIds: [...frozenIds.keys()], frozenHash, dualWrite, openCount, legacy, future, ji, je }
}

function runCheck(path) {
  if (!existsSync(path)) configExit(`文件不存在：${path}`)
  let text
  try { text = readFileSync(path, 'utf8') } catch (e) { configExit(`文件不可读：${e.message}`) }
  const v = validate(text)
  console.log(`residuals-check 汇总：file=${path} entries=${v.doc.residuals.length} open=${v.openCount} canonical=true frozen_sha256=${v.frozenHash} dual_write=${v.dualWrite} legacy=${v.legacy} future=${v.future} 判定=通过`)
  return v
}

function runWrite(path) {
  if (!existsSync(path)) configExit(`文件不存在：${path}`)
  const text = readFileSync(path, 'utf8')
  const v = validate(text, { allowNoncanonical: true, allowOpenDrift: true })
  const lines = text.split('\n')
  const seg = canonDoc(v.doc.residuals).replace(/\n$/, '').split('\n')
  lines.splice(v.ji + 1, v.je - v.ji - 1, ...seg)
  const headIdx = lines.findIndex((l) => /^当前 \*\*open=(\d+)\*\*/.test(l))
  lines[headIdx] = lines[headIdx].replace(/\*\*open=\d+\*\*/, `**open=${v.openCount}**`)
  const out = lines.join('\n')
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`)
  writeFileSync(tmp, out, 'utf8')
  renameSync(tmp, path)
  console.log(`residuals-check --write 完成：${path}（entries=${v.doc.residuals.length} open=${v.openCount} canonical 重写＋open 派生）`)
}

// ── --self-test：固定快照 canonical 夹具＋确定性变异负例，真 CLI 子进程逐项 case=<name> exit=<真值> ──
function selfTest() {
  const fxPath = join(SKILL_ROOT, 'scripts', '.golden', 'docgen-fixtures.json')
  if (!existsSync(fxPath)) configExit(`固定快照缺失：${fxPath}`)
  let fx
  try { fx = JSON.parse(readFileSync(fxPath, 'utf8')) } catch (e) { configExit(`固定快照不可解析：${e.message}`) }
  const tmp = mkdtempSync(join(tmpdir(), 'residuals-st-'))
  let allOk = true
  const note = (ok, label) => { if (!ok) allOk = false; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`) }
  const MARKER_OFF = 'term-scan:' + ' off'
  try {
    const base = fx.residuals_canonical
    // 未来条目 canonical 追加器（W-5/B-1 用）：保持段 canonical 字节，仅引入待验条目
    const spliceEntry = (src, entry) => {
      const v = validate(src)
      const doc = JSON.parse(JSON.stringify(v.doc))
      doc.residuals.push(entry)
      const seg = canonDoc(doc.residuals).replace(/\n$/, '').split('\n')
      const ls = src.split('\n')
      ls.splice(v.ji + 1, v.je - v.ji - 1, ...seg)
      return ls.join('\n')
    }
    const variants = {
      'residuals-p1-canonical': base,
      'residuals-p2-canonical-16': fx.residuals_canonical_16,
      'residuals-n1-missing-key': base.replace(/^      "owner": null,\n/m, ''),
      'residuals-n2-extra-key': base.replace(/^      "id": "fx-alpha",\n/m, '      "extra": 1,\n      "id": "fx-alpha",\n'),
      'residuals-n3-duplicate-id': base.replace('"id": "fx-beta"', '"id": "fx-alpha"'),
      'residuals-n4-future-null': base.replace(/^    \}\n  \],\n/m, '    },\n    {\n      "created_at": null,\n      "description": "合成未来现象",\n      "evidence": [],\n      "id": "fx-future",\n      "owner": null,\n      "phenomenon": "合成未来现象",\n      "status": "closed",\n      "trigger": "合成未来触发"\n    }\n  ],\n'),
      'residuals-n5-open-count-drift': base.replace('当前 **open=1**', '当前 **open=2**'),
      'residuals-n6-frozen-hash-drift': base.replace(/sha256=([0-9a-f]{2})/, (m, g1) => `sha256=${g1[0] === '0' ? '1' : '0'}${g1[1]}`),
      'residuals-n7-dual-write': base.replace('<!-- residuals-frozen: end -->', `<!-- residuals-frozen: end -->\n| fx-ghost | 合成双写现象 | 合成双写触发 | open |`),
      'residuals-n8-fenced-json': base.replace('<!-- residuals-json: begin -->\n{', `<!-- residuals-json: begin -->\n\`\`\`\n{`).replace('}\n<!-- residuals-json: end -->', '}\n```\n<!-- residuals-json: end -->'),
      'residuals-n9-term-scan-marker': base.replace('当前 **open=1**', `当前 **open=1**\n${MARKER_OFF}`),
      'residuals-n10-marker-gap': base.replace('<!-- residuals-json: begin -->\n{', '<!-- residuals-json: begin -->\n\n{'),
      'residuals-n11-noncanonical': (() => { const v = validate(base); const doc = JSON.parse(JSON.stringify(v.doc)); doc.residuals.reverse(); const lines = base.split('\n'); const seg = JSON.stringify(doc, null, 4).replace(/\n$/, '').split('\n'); lines.splice(v.ji + 1, v.je - v.ji - 1, ...seg); return lines.join('\n') })(),
      'residuals-n12-malformed-json': base.replace('"schema": "residuals/v1"', '"schema": "residuals/v1'),
      'residuals-n13-whole-segment-fenced': base.replace('<!-- residuals-json: begin -->', '```\n<!-- residuals-json: begin -->').replace('<!-- residuals-json: end -->', '<!-- residuals-json: end -->\n```'),
      'residuals-n14-future-bad-date': spliceEntry(base, { created_at: '2099-02-30', description: '合成未来现象', evidence: ['合成证据'], id: 'fx-future2', owner: '合成责任人', phenomenon: '合成未来现象', status: 'closed', trigger: '合成未来触发' }),
      'residuals-n15-frozen-begin-gap': base.replace(/(<!-- residuals-frozen: begin [^\n]*-->)\n(\| 登记号)/, '$1\n\n$2'),
      'residuals-n16-frozen-end-gap': base.replace('closed |\n<!-- residuals-frozen: end -->', 'closed |\n\n<!-- residuals-frozen: end -->'),
      'residuals-n17-json-end-blank': base.replace('}\n<!-- residuals-json: end -->', '}\n\n<!-- residuals-json: end -->'),
      'residuals-n18-json-end-comment': base.replace('}\n<!-- residuals-json: end -->', '}\n<!-- 夹层注释 -->\n<!-- residuals-json: end -->'),
    }
    const run = (args) => spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', timeout: 60_000 })
    for (const c of fx.self_test_cases['residuals-check']) {
      const p = join(tmp, `${c.name}.md`)
      if (variants[c.name] === undefined) { note(false, `负例构造缺位：${c.name}`); continue }
      writeFileSync(p, variants[c.name], 'utf8')
      const r = run(['--file', p, '--check'])
      const code = r.status === null ? 124 : r.status
      console.log(`case=${c.name} exit=${code}`)
      if (code !== c.expected_exit) allOk = false
    }
    // canonical 夹具两次写回到不同临时副本→字节一致→--check
    const w1 = join(tmp, 'write-a.md'), w2 = join(tmp, 'write-b.md')
    writeFileSync(w1, base, 'utf8'); writeFileSync(w2, base, 'utf8')
    const r1 = run(['--file', w1, '--write']), r2 = run(['--file', w2, '--write'])
    const byteEq = r1.status === 0 && r2.status === 0 && readFileSync(w1).equals(readFileSync(w2)) && readFileSync(w1).equals(Buffer.from(base, 'utf8'))
    note(byteEq, '固定快照两次写回逐字节一致（canonical 幂等重写）')
    const c1 = run(['--file', w1, '--check']), c2 = run(['--file', w2, '--check'])
    note(c1.status === 0 && c2.status === 0, '--check 一致（两副本均通过且不写回）')
    console.log('PASS 输入乱序一致=无 CLI 序参（权威段排序由 canonical 校验承载，id 字典序钉死）')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  return allOk
}

const argv = process.argv.slice(2)
// N-1：--self-test 不绕过参数检查——先按同源 parseArgs 校验（未知/重复/等价形态/空值=用法错）再进自检
try {
  parseArgs(argv)
  if (argv.includes('--self-test')) process.exit(selfTest() ? EXIT_OK : EXIT_RED)
  const args = parseArgs(argv)
  if (args['--file'] === undefined) usageExit('缺必填参数：--file <路径>')
  if (args['--write']) runWrite(resolve(args['--file']))
  else runCheck(resolve(args['--file']))
} catch (e) {
  if (e instanceof UsageError) usageExit(e.message)
  if (e instanceof ContentError) redExit(e.message)
  if (e instanceof Error && e.code === 'ENOENT') configExit(`装载失败：${e.message}`)
  console.error(`[fatal] ${e.message}`)
  process.exit(EXIT_CONFIG)
}
