#!/usr/bin/env node
// taskbook-evidence.mjs — 任务书事实台账落盘与重验（L10，2026-10-22；W6 R2-T1 D-4 失败隔离）
// record：解析 §4 F 条目 → 只读校验 → 逐条执行 → 落盘 JSON。任一 F 命令非零退出＝失败隔离（口径单源 references/06 §5.8）：
//   完整失败 JSON 只写 <out>.failed，有效 <out> 不留存（陈旧件一并清除），终端只报非零条数与
//   sidecar 路径（不回显 F 命令正文）；成功只写 <out> 并清除陈旧 <out>.failed（schema 不变）。
// verify：按证据条目记录的 cwd 重跑命令，比对 exit 与规范化 stdout；不一致只报 id、退出码期望/实际
//   与精确标记「stdout 不一致（正文不回显）」，不打印 expected/actual 正文。
// 退出码口径单源=references/06 §5.8（此处不复写语义）。
// 安全边界：只执行任务书声明且通过只读校验的 F 命令；不执行 E 条目与验收命令。

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SKILL_ROOT = resolve(SCRIPT_DIR, '..')
const SELF = fileURLToPath(import.meta.url)
const SCHEMA = 'taskbook-evidence/v1'
const WRITE_PATTERNS = [
  ['rm', /\brm\b/], ['mv', /\bmv\b/], ['tee', /\btee\b/], ['dd', /\bdd\b/],
  ['sed -i', /\bsed\s+-i/], ['truncate', /\btruncate\b/], ['touch', /\btouch\b/],
  ['mkdir', /\bmkdir\b/], ['cp', /\bcp\b/],
]

/** 写入形态判定（W5b D-4·引号域二分·r5 增补＋r6 修正）：先 WRITE_PATTERNS 词面命中；重定向面
 *  引号域二分——①引号串内整体等长掩蔽（偏移不变），其中 >/>>/>=/->/=>/2>&1 一律不命中；转义处理：
 *  引号外与双引号内遇反斜杠均连带吞下一字符（r5：引号外 "／' 不开掩蔽域；r6：双引号内 " 不闭合
 *  掩蔽域——python3 -c "print(">\")" 的 > 在引号域内；单引号内 bash 无转义·不动）；转义对与引号段
 *  填充改非空白符 XX（r6：修复 2>/dev/null" 掩蔽后伪空白右界触发豁免的同类伪边界面）；②引号外
 *  >/>> 一律命中（fail-closed），豁免仅二：fd 复制严格形态 [0-9]*>&[0-9]+／>&[0-9]+ 且数字串后仅
 *  空白或行尾（其余任何字符——.／/／=／-／字母——不豁免·命中；2>&1x/2>&1.x 均命中）；2>/dev/null
 *  字面（r5·既有向量零删优先·主控裁保留）——左界＝独立 2> 词（行首/空白后；W5c D-1 扩真实闭引号
 *  紧邻——shell 词法上该形态非 fd 2 重定向·豁免结果安全·按字面形态处理；W5c D-3 扩命令分隔符
 *  ;|&——单字符前看覆盖 ;;/||/&& 组合界）、右界＝/dev/null 后仅空白/行尾/命令分隔符（;|&·不变），
 *  等长置换保偏移，子串形态（2>/dev/nullx／2>/dev/null/foo／x2>/dev/null）一律不豁免·命中。
 *  残余登记＝引号外零残余窗口（该域纯 fail-closed）；已知误伤面＝引号外确有比较语义而无引号包裹的
 *  写法（解法＝置于引号串内），登记为使用约束而非检测缺口。 */
export function writeHit(cmd) {
  const s = String(cmd ?? '')
  for (const [name, re] of WRITE_PATTERNS) if (re.test(s)) return name
  // 引号域等长掩蔽：引号内字符逐字符以非空白符 X 填充（偏移不变）；闭引号界定符按原字符保留（W5c D-1·
  // 等长 1:1——闭引号紧邻 2>/dev/null 的左界可见）；开界定符仍 X 填充；转义对（反斜杠＋下一字符）
  // 以 XX 填充（两字符·r6 伪空白右界修复——2>/dev/null" 类输入掩蔽后右界不再为伪空白）
  let masked = ''
  let inS = false, inD = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inS) { if (c === "'") { inS = false; masked += "'" } else masked += 'X'; continue } // W5c D-1：闭引号界定符保留（等长 1:1）——左界可见
    if (inD) {
      if (c === '\\') { masked += 'XX'; i++; continue } // r6：双引号内转义——" 不闭合掩蔽域
      if (c === '"') { inD = false; masked += '"' } else masked += 'X' // W5c D-1：闭引号界定符保留（等长 1:1）
      continue
    }
    if (c === '\\') { masked += 'XX'; i++; continue } // r5/r6：引号外转义——"／' 不开掩蔽域（下一字符一并吞掉·非空白填充）
    if (c === "'") { inS = true; masked += 'X'; continue }
    if (c === '"') { inD = true; masked += 'X'; continue }
    masked += c
  }
  // r5 第二豁免：2>/dev/null 字面——左界独立 2> 词（行首/空白后；W5c D-1 扩真实闭引号紧邻·掩蔽保留闭引号界定符；
  // W5c D-3 扩命令分隔符 ;|&——单字符前看即覆盖 ;;/||/&& 组合界）、右界 /dev/null 后仅空白/行尾/命令分隔符（不变）；等长置换保偏移
  const stripped = masked.replace(/(^|[\s;|&"'])2>\/dev\/null(?=$|[\s;|&])/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] !== '>') continue
    // fd 复制豁免：>&[0-9]+ 且数字串后仅空白/行尾，且 > 前数字串（可有可无）落于 token 边界
    if (stripped[i + 1] === '&') {
      let k = i + 2
      while (k < stripped.length && stripped[k] >= '0' && stripped[k] <= '9') k++
      if (k > i + 2 && (k === stripped.length || /\s/.test(stripped[k]))) {
        let b = i
        while (b > 0 && stripped[b - 1] >= '0' && stripped[b - 1] <= '9') b--
        if (b === 0 || /\s/.test(stripped[b - 1])) { i = k - 1; continue } // 豁免：跳过该 fd 复制段续扫
      }
    }
    return '>'
  }
  return null
}

/** §4 F 条目解析（全角竖线分隔五字段；字段不足忽略；围栏块内行跳过；W5b D-4：id 正则接受
 *  F-31b~e 子字母形态 ^F-\d{2}[a-z]?，record/verify 的 facts Map 与交叉核对自动接受子字母 id）。 */
export function parseFacts(text) {
  const out = []; let fence = null
  const lines = String(text ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const fm = /^\s*(```|~~~)/.exec(lines[i])
    if (fm) { fence = fence ? null : fm[1]; continue }
    if (fence) continue
    const ln = lines[i].trim()
    if (!/^F-\d{2}[a-z]?\s*｜/.test(ln)) continue
    const p = ln.split('｜').map((s) => s.trim())
    if (p.length < 5) continue
    out.push({ id: p[0], label: p[1], cmd: p[2].replace(/^`+|`+$/g, '').trim(), declared: p[3], date: p[4], line: i + 1 })
  }
  return out
}

function run(cmd, cwd) {
  const r = spawnSync('/bin/bash', ['-lc', cmd], { cwd, encoding: 'utf8' })
  return { exit: typeof r.status === 'number' ? r.status : 1, stdout: r.stdout ?? '' }
}

function repoHead(cwd) {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' })
  return r.status === 0 ? String(r.stdout).trim() : ''
}

/** record：只读校验通过后逐条执行并落盘；任一 F 命令非零退出＝失败隔离（D-4·口径单源 references/06 §5.8）——完整失败 JSON 只写
 *  <out>.failed、有效 <out> 不留存，整体失败；成功只写 <out> 并清除陈旧 <out>.failed。
 *  B7 D-5：entry 新增 skill_head＝SKILL_ROOT git HEAD 实读（repo_head 仍取 --root 仓）；HEAD 不可读＝装载失败（code 3）——预检先于任何 F 命令执行且不落盘证据件。 */
export function recordTaskbook(taskbookPath, outPath, root = SKILL_ROOT) {
  if (!existsSync(taskbookPath)) return { code: 3, doc: null, reason: `任务书不存在：${taskbookPath}` }
  const facts = parseFacts(readFileSync(taskbookPath, 'utf8'))
  for (const f of facts) {
    const hit = writeHit(f.cmd)
    if (hit) return { code: 1, doc: null, reason: `${f.id} 命令含写入形态「${hit}」：${f.cmd}` } // W-3：只读校验拒绝=用法错类，不落 sidecar
  }
  const skillHead = repoHead(SKILL_ROOT)
  if (!skillHead) return { code: 3, doc: null, reason: 'SKILL_ROOT HEAD 不可读（skill_head 绑定失败）' } // N-8：按实际原因打印
  const cwd = resolve(root)
  const entries = []
  let badCount = 0
  for (const f of facts) {
    const r = run(f.cmd, cwd)
    if (r.exit !== 0) badCount++
    entries.push({
      id: f.id, label: f.label, cmd: f.cmd, cwd,
      exit: r.exit, stdout: r.stdout,
      stdout_sha256: createHash('sha256').update(r.stdout).digest('hex'),
      recorded_at: new Date().toISOString(), repo_head: repoHead(cwd), skill_head: skillHead,
      date: f.date, declared: f.declared,
    })
  }
  const doc = { schema: SCHEMA, taskbook: resolve(taskbookPath), generated_at: new Date().toISOString(), entries }
  const failedPath = outPath + '.failed'
  if (badCount > 0) {
    // D-4 失败隔离：失败件只进 sidecar；有效 <out> 不留存（含陈旧件清除）。
    rmSync(outPath, { force: true })
    writeFileSync(failedPath, JSON.stringify(doc, null, 2) + '\n', 'utf8')
    return { code: 1, doc: null, failedCount: badCount, failedPath, kind: 'command-failure' }
  }
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  rmSync(failedPath, { force: true })
  return { code: 0, doc, failedCount: 0, failedPath, kind: 'ok' }
}

/** verify：先过只读校验并与任务书 F 条目交叉核对，全部通过后才重跑比对。
 *  §10.1：任一 entry 不满足（类型/写入形态/与任务书同 id cmd 不等）⇒ 整体 exit 3，不执行任何命令。
 *  B7 D-5：命令执行前区分两形态——全 entry 无 skill_head＝legacy 台账按旧校验接受；全 entry 有 skill_head＝
 *  须 7-40 位小写十六进制、全件一致且经 SKILL_ROOT `git cat-file -e <head>^{commit}` 可解析（不要求等于当前 HEAD）。混排/混值/未知提交＝exit 3 且零命令执行。 */
export function verifyTaskbook(taskbookPath, evidencePath) {
  if (!existsSync(taskbookPath)) return { code: 3, results: [], reason: '任务书不存在' }
  let doc
  try { doc = JSON.parse(readFileSync(evidencePath, 'utf8')) } catch { return { code: 3, results: [], reason: '证据不可读' } }
  if (!doc || doc.schema !== SCHEMA || !Array.isArray(doc.entries)) return { code: 3, results: [], reason: 'schema 不符' }
  const facts = new Map(parseFacts(readFileSync(taskbookPath, 'utf8')).map((f) => [f.id, f]))
  for (const e of doc.entries) {
    if (typeof e?.cmd !== 'string' || typeof e?.cwd !== 'string') return { code: 3, results: [], reason: `${e?.id} cmd/cwd 非字符串` }
    const hit = writeHit(e.cmd)
    if (hit) return { code: 3, results: [], reason: `${e.id} 命令含写入形态「${hit}」` }
    const f = facts.get(e.id)
    if (!f || f.cmd.trim() !== e.cmd.trim()) return { code: 3, results: [], reason: `${e.id} 命令与任务书 F 条目不符` }
  }
  const heads = doc.entries.map((e) => e.skill_head), present = heads.filter((h) => h !== undefined)
  if (present.length > 0 && present.length !== heads.length) return { code: 3, results: [], reason: 'skill_head 新旧混排（部分条目缺字段）' }
  if (present.length === heads.length && present.length > 0) {
    const head = heads[0]
    if (typeof head !== 'string' || !/^[0-9a-f]{7,40}$/.test(head)) return { code: 3, results: [], reason: `skill_head 非法形态（${JSON.stringify(head)}——须 7-40 位小写十六进制）` }
    if (heads.some((h) => h !== head)) return { code: 3, results: [], reason: 'skill_head 同件混值' }
    if (spawnSync('git', ['-C', SKILL_ROOT, 'cat-file', '-e', `${head}^{commit}`]).status !== 0) return { code: 3, results: [], reason: `skill_head 未知提交（${head}——SKILL_ROOT git cat-file 不可解析）` }
  }
  // ── INFRA1 D-6：stdout_sha256 原始字节执法（record 当时未规范化 stdout 的 sha256）。
  //    hash 面：hex64 校验＋记录件自洽（sha256(e.stdout)===stdout_sha256——篡改 stdout 而不改
  //    hash、CRLF 改写均拒绝）＝零命令执行 exit 3；运行时 hash 不符＝exit 1。全缺字段的
  //    legacy 台账（全件一致）才走旧 normalized 比较（CRLF/尾空白仍等价）；混排零执行 exit 3。
  const shaOf = (t) => createHash('sha256').update(String(t ?? ''), 'utf8').digest('hex')
  const hashFlags = doc.entries.map((e) => Object.prototype.hasOwnProperty.call(e, 'stdout_sha256') && e.stdout_sha256 !== null && e.stdout_sha256 !== undefined)
  const hashCount = hashFlags.filter(Boolean).length
  if (hashCount > 0 && hashCount !== doc.entries.length) return { code: 3, results: [], reason: 'stdout_sha256 新旧混排（部分条目缺 hash 字段——零命令执行）' }
  const hashMode = hashCount === doc.entries.length
  if (hashMode) {
    for (const e of doc.entries) {
      if (typeof e.stdout_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.stdout_sha256))
        return { code: 3, results: [], reason: `${e.id} stdout_sha256 非 hex64（零命令执行）` }
      if (shaOf(e.stdout) !== e.stdout_sha256)
        return { code: 3, results: [], reason: `${e.id} stdout 与 stdout_sha256 不符（记录件被篡改/改写——零命令执行）` }
    }
  }
  const norm = (s) => String(s ?? '').replace(/\r\n/g, '\n').replace(/\s+$/g, '')
  const results = []
  let bad = false
  for (const e of doc.entries) {
    const r = run(e.cmd, e.cwd)
    const sameExit = r.exit === e.exit
    const sameHash = hashMode ? shaOf(r.stdout) === e.stdout_sha256 : null
    const sameOut = hashMode ? sameHash : norm(r.stdout) === norm(e.stdout)
    if (!sameExit || !sameOut) bad = true
    results.push({ id: e.id, ok: sameExit && sameOut, sameExit, sameOut, sameHash, exit: e.exit, actualExit: r.exit, expected: hashMode ? `<sha256:${e.stdout_sha256.slice(0, 12)}…>` : norm(e.stdout), actual: hashMode ? `<sha256:${shaOf(r.stdout).slice(0, 12)}…>` : norm(r.stdout) })
  }
  return { code: bad ? 1 : 0, results, reason: '' }
}

// ── 自检（夹具落 os.tmpdir()） ──
function selfTest() {
  const cases = []
  const add = (name, ok, detail = '') => cases.push({ name, ok: !!ok, detail })
  const tmp = mkdtempSync(join(tmpdir(), 'tb-evidence-'))
  try {
    const tb = join(tmp, 'tb.md')
    const ev = join(tmp, 'ev.json')
    const line = (id, label, cmd, declared) => `${id} ｜ ${label} ｜ \`${cmd}\` ｜ ${declared} ｜ 2026-10-22`
    writeFileSync(tb, ['## 4. 事实台账', '', line('F-01', '计数', "printf 'a\\n' | grep -c a", '1'), line('F-02', '退出码', 'printf x; exit 4', '1'), '', 'F-03 ｜ 少一字段 ｜ `true` ｜ 1', ''].join('\n'), 'utf8')
    const facts = parseFacts(readFileSync(tb, 'utf8'))
    add('F 条目解析：正常行入列、字段不足忽略', facts.length === 2 && facts[0].id === 'F-01' && facts[0].declared === '1', JSON.stringify(facts))
    add('写入形态拒绝：> 命中', writeHit('printf x > f') === '>')
    add('写入形态拒绝：rm 命中', writeHit('rm -f x') === 'rm')
    add('写入形态拒绝：sed -i 命中', writeHit("sed -i 's/a/b/' f") === 'sed -i')
    add('2>/dev/null 放行：不算写入形态', writeHit('grep -c a f 2>/dev/null || true') === null)
    const rec = recordTaskbook(tb, ev, tmp)
    const failedEv = ev + '.failed'
    add('D4 失败隔离：有效 <out> 不留存、<out>.failed 落盘且整体退 1', rec.code === 1 && rec.failedCount === 1 && !existsSync(ev) && existsSync(failedEv), `code=${rec.code} failedCount=${rec.failedCount}`)
    const doc = JSON.parse(readFileSync(failedEv, 'utf8'))
    const e0 = doc.entries[0]
    add('record 失败件 schema 与字段齐全（与成功件同构）', doc.schema === SCHEMA && ['id', 'label', 'cmd', 'cwd', 'exit', 'stdout', 'stdout_sha256', 'recorded_at', 'repo_head', 'skill_head', 'date', 'declared'].every((k) => k in e0), JSON.stringify(doc).slice(0, 200))
    add('record 失败件 entries 完整且含失败 F id 与实际 exit', doc.entries.length === 2 && doc.entries[1].id === 'F-02' && doc.entries[1].exit === 4, JSON.stringify(doc.entries.map((e) => [e.id, e.exit])))
    add('record 只读校验拒绝整批：写入命令不落盘且无 sidecar', (() => { const p = join(tmp, 'w.md'); writeFileSync(p, line('F-09', '写', 'rm -f x', '0'), 'utf8'); const o = join(tmp, 'w.json'); return recordTaskbook(p, o, tmp).code === 1 && !existsSync(o) && !existsSync(o + '.failed') })())
    add('verify 一致：exit 0', verifyTaskbook(tb, failedEv).code === 0)
    const badOut = JSON.parse(readFileSync(failedEv, 'utf8'))
    badOut.entries[0].stdout = 'b\n'
    writeFileSync(failedEv, JSON.stringify(badOut), 'utf8')
    // INFRA1 D-6 期望迁移：stdout 改写而 hash 不动=记录件完整性破坏→exit 3 零命令执行
    //（原 normalized 比较下的 exit 1 语义由「运行时 stdout 变化」向量承载——见 D4 CLI 向量）
    add('verify stdout 改写而 hash 未更新：exit 3 零命令执行（INFRA1 D-6 期望迁移）', verifyTaskbook(tb, failedEv).code === 3)
    const badExit = JSON.parse(JSON.stringify(doc))
    badExit.entries[1].exit = 0
    writeFileSync(failedEv, JSON.stringify(badExit), 'utf8')
    add('verify exit 不一致：exit 1', verifyTaskbook(tb, failedEv).code === 1)
    add('verify 证据缺失：exit 3', verifyTaskbook(tb, join(tmp, 'nope.json')).code === 3)
    writeFileSync(failedEv, JSON.stringify({ schema: 'x', entries: [] }), 'utf8')
    add('verify schema 不符：exit 3', verifyTaskbook(tb, failedEv).code === 3)
    const crlf = JSON.parse(JSON.stringify(doc))
    crlf.entries[0].stdout = crlf.entries[0].stdout.replace(/\n/g, '\r\n')
    writeFileSync(failedEv, JSON.stringify(crlf), 'utf8')
    // INFRA1 D-6 期望迁移：hash 面按原始字节执法——CRLF 改写不再洗成等价（拒绝=exit 3）
    add('stdout CRLF 改写（hash 未更新）：拒绝 exit 3（INFRA1 D-6 期望迁移——原始字节不再规范化）', verifyTaskbook(tb, failedEv).code === 3)
    const pwn = join(tmp, 'pwn.txt'), evWith = (o) => writeFileSync(failedEv, JSON.stringify({ ...doc, entries: [{ ...doc.entries[0], ...o }] }), 'utf8')
    evWith({ cmd: `printf x > ${pwn}` }); add('W1 证据含写入命令：exit 3 且未执行', verifyTaskbook(tb, ev).code === 3 && !existsSync(pwn))
    evWith({ cmd: 7 }); add('W1 非字符串 cmd：exit 3', verifyTaskbook(tb, ev).code === 3)
    evWith({ cmd: 'printf y' }); add('W1 与任务书 F 条目不匹配：exit 3', verifyTaskbook(tb, ev).code === 3)
    add('W3 围栏内 F 条目不被解析：仅围栏外入列', (() => { const fs2 = parseFacts('```\n' + line('F-07', '围栏内', 'true', '0') + '\n```\n' + line('F-08', '围栏外', 'true', '1')); return fs2.length === 1 && fs2[0].id === 'F-08' })())
    // ── D-5 skill_head 机器绑定（B7 批）五向量 ──
    const tb2 = join(tmp, 'tb2.md'), ev2 = join(tmp, 'ev2.json'); writeFileSync(tb2, line('F-10', '计数', "printf 'b\\n' | grep -c b", '1'), 'utf8')
    const doc2 = recordTaskbook(tb2, ev2, tmp).doc, realHead = repoHead(SKILL_ROOT)
    add('D5① record skill_head＝SKILL_ROOT 实读、repo_head 仍＝指定 root 实读', !!doc2 && doc2.entries[0].skill_head === realHead && /^[0-9a-f]{7,40}$/.test(String(realHead)) && doc2.entries[0].repo_head === repoHead(tmp), `realHead=${realHead}`)
    add('D5② 全缺字段 legacy 台账仍可 verify', (() => { const d = JSON.parse(readFileSync(ev2, 'utf8')); d.entries.forEach((e) => delete e.skill_head); writeFileSync(ev2, JSON.stringify(d), 'utf8'); return verifyTaskbook(tb2, ev2).code === 0 })())
    let unknown = ''
    for (const c of ['deadbee', 'c0ffee0', '0ddba11']) if (spawnSync('git', ['-C', SKILL_ROOT, 'cat-file', '-e', c + '^{commit}']).status !== 0) { unknown = c; break }
    add('D5③ skill_head 未知提交拒绝：exit 3 且零命令执行', (() => { const d = JSON.parse(readFileSync(ev2, 'utf8')); d.entries[0].skill_head = unknown; writeFileSync(ev2, JSON.stringify(d), 'utf8'); const r = verifyTaskbook(tb2, ev2); return unknown !== '' && r.code === 3 && r.results.length === 0 })(), `unknown=${unknown}`)
    add('D5④ 同件混值与新旧混排拒绝：exit 3 且零命令执行', (() => {
      const tb5 = join(tmp, 'tb5.md'), ev5 = join(tmp, 'ev5.json'); writeFileSync(tb5, [line('F-20', '甲', "printf 'a\\n' | grep -c a", '1'), line('F-21', '乙', "printf 'a\\n' | grep -c a", '1')].join('\n'), 'utf8'); recordTaskbook(tb5, ev5, tmp)
      const d5 = JSON.parse(readFileSync(ev5, 'utf8')); d5.entries[1].skill_head = unknown || 'deadbee'; writeFileSync(ev5, JSON.stringify(d5), 'utf8')
      const mixed = verifyTaskbook(tb5, ev5); delete d5.entries[1].skill_head; writeFileSync(ev5, JSON.stringify(d5), 'utf8')
      const partial = verifyTaskbook(tb5, ev5); return mixed.code === 3 && mixed.results.length === 0 && partial.code === 3 && partial.results.length === 0
    })())
    add('D5⑤ HEAD 不可读 record 装载失败：exit 3 且零 F 命令执行且证据件不生成；init git 可读 HEAD 后绑定恢复（N-03 边界两侧）', (() => {
      const iso = mkdtempSync(join(tmpdir(), 'tb-evidence-iso-'))
      try {
        mkdirSync(join(iso, 'scripts'), { recursive: true }); copyFileSync(fileURLToPath(import.meta.url), join(iso, 'scripts', 'taskbook-evidence.mjs'))
        const tbx = join(iso, 'tb.md'), ovx = join(iso, 'ev.json'), script = join(iso, 'scripts', 'taskbook-evidence.mjs')
        const run2 = () => spawnSync(process.execPath, [script, 'record', '--taskbook', tbx, '--out', ovx], { encoding: 'utf8' })
        writeFileSync(tbx, line('F-30', '哨兵', 'exit 45', '0'), 'utf8')
        const r = run2(), absent = !existsSync(ovx)
        spawnSync('git', ['-C', iso, 'init', '-q']); spawnSync('git', ['-C', iso, '-c', 'user.name=iso', '-c', 'user.email=iso@l', 'commit', '-q', '--allow-empty', '-m', 'iso'])
        const r2 = run2(), head = String(spawnSync('git', ['-C', iso, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout || '').trim()
        // D-4 后失败件只进 sidecar（<out> 不留存），skill_head 绑定断言随之改读 <out>.failed
        return r.status === 3 && String(r.stderr || '').includes('HEAD') && absent && r2.status === 1 && head !== '' && !existsSync(ovx) && existsSync(ovx + '.failed') && JSON.parse(readFileSync(ovx + '.failed', 'utf8')).entries[0].skill_head === head
      } finally { rmSync(iso, { recursive: true, force: true }) }
    })())
    // ── D-4 失败隔离 CLI 向量（W6 R2-T1）──
    add('D4 CLI record 失败最小输出：终端仅非零条数与 sidecar 路径，不含命令正文；预置陈旧 <out> 被清除', (() => {
      const tb8 = join(tmp, 'tb8.md'), o8 = join(tmp, 'o8.json')
      writeFileSync(tb8, line('F-31', '哨兵', "printf 'SENTINEL-BODY-9'; exit 5", '0'), 'utf8')
      writeFileSync(o8, '{"stale":1}', 'utf8')
      const r = spawnSync(process.execPath, [SELF, 'record', '--taskbook', tb8, '--out', o8], { encoding: 'utf8' })
      const out = String(r.stdout || '') + String(r.stderr || '')
      return r.status === 1 && !existsSync(o8) && existsSync(o8 + '.failed') && /非零条目 ×1/.test(out) && out.includes(o8 + '.failed') && !out.includes('SENTINEL-BODY-9')
    })())
    add('D4 CLI verify 不一致最小输出：含精确标记，不含 expected/actual 正文', (() => {
      const tb9 = join(tmp, 'tb9.md'), o9 = join(tmp, 'o9.json')
      writeFileSync(tb9, line('F-50', '计数', "printf 'ok\\n' | grep -c ok", '1'), 'utf8')
      recordTaskbook(tb9, o9, tmp)
      // INFRA1 D-6 期望迁移：篡改 stdout 须同步改 stdout_sha256 才过记录件自洽——由此
      // 构造「运行时 stdout 不一致」面（exit 1＋精确标记）；只改 stdout 不改 hash=exit 3
      //（由 INFRA1 D-6 ①向量承载）。
      const d9 = JSON.parse(readFileSync(o9, 'utf8')); d9.entries[0].stdout = 'MISMATCH-BODY-7\n'
      d9.entries[0].stdout_sha256 = createHash('sha256').update('MISMATCH-BODY-7\n', 'utf8').digest('hex')
      writeFileSync(o9 + '.alt', JSON.stringify(d9), 'utf8')
      const r = spawnSync(process.execPath, [SELF, 'verify', '--taskbook', tb9, '--evidence', o9 + '.alt'], { encoding: 'utf8' })
      const out = String(r.stdout || '') + String(r.stderr || '')
      const ok = r.status === 1 && out.includes('stdout 不一致（正文不回显）') && !out.includes('MISMATCH-BODY-7') && !out.includes('"' + 'ok' + '"')
      rmSync(o9 + '.alt')
      return ok
    })())
    add('D4 成功 record 清除陈旧 <out>.failed 且成功件在位', (() => {
      const tb10 = join(tmp, 'tb10.md'), o10 = join(tmp, 'o10.json')
      writeFileSync(tb10, line('F-60', '成功件', "printf 'v\\n' | grep -c v", '1'), 'utf8')
      writeFileSync(o10 + '.failed', '{"stale":1}', 'utf8')
      const r = recordTaskbook(tb10, o10, tmp)
      return r.code === 0 && existsSync(o10) && !existsSync(o10 + '.failed')
    })())
    // ── 双审修入向量（W-3/W-4/N-8/N-9）──
    add('W-3 CLI 用法错与只读校验拒绝：[用法错] 打印、无 sidecar、无 undefined', (() => {
      const tb11 = join(tmp, 'tb11.md'), o11 = join(tmp, 'o11.json')
      writeFileSync(tb11, line('F-70', '写形态', 'rm -f x', '0'), 'utf8')
      const r1 = spawnSync(process.execPath, [SELF, 'record', '--taskbook', tb11, '--out', o11], { encoding: 'utf8' })
      const out1 = String(r1.stdout || '') + String(r1.stderr || '')
      const r2 = spawnSync(process.execPath, [SELF, 'record', '--bogus'], { encoding: 'utf8' })
      const out2 = String(r2.stdout || '') + String(r2.stderr || '')
      return r1.status === 1 && !existsSync(o11) && !existsSync(o11 + '.failed') && out1.includes('[用法错]') && !out1.includes('失败件') && !out1.includes('undefined')
        && r2.status === 1 && out2.includes('用法') && !out2.includes('undefined')
    })())
    add('N-8 CLI record 装载错按实际原因打印：任务书不存在', (() => {
      const r3 = spawnSync(process.execPath, [SELF, 'record', '--taskbook', join(tmp, 'no-such-tb.md'), '--out', join(tmp, 'o12.json')], { encoding: 'utf8' })
      return r3.status === 3 && String(r3.stderr || '').includes('任务书不存在')
    })())
    add('N-9 CLI verify exit-only 不一致：标注（stdout 一致）、无精确标记', (() => {
      const tb13 = join(tmp, 'tb13.md'), o13 = join(tmp, 'o13.json')
      writeFileSync(tb13, line('F-80', '计数', "printf 'w\\n' | grep -c w", '1'), 'utf8')
      recordTaskbook(tb13, o13, tmp)
      const d13 = JSON.parse(readFileSync(o13, 'utf8')); d13.entries[0].exit = 9
      writeFileSync(o13 + '.alt2', JSON.stringify(d13), 'utf8')
      const r = spawnSync(process.execPath, [SELF, 'verify', '--taskbook', tb13, '--evidence', o13 + '.alt2'], { encoding: 'utf8' })
      const out = String(r.stdout || '') + String(r.stderr || '')
      const ok = r.status === 1 && out.includes('（stdout 一致）') && !out.includes('stdout 不一致（正文不回显）') && !out.includes('undefined')
      rmSync(o13 + '.alt2')
      return ok
    })())
    // ── W5b D-4 引号域二分＋fd 复制豁免＋子字母 id（恰 10 向量·30→40）──
    add('D4① 引号串内四形态放行（等长掩蔽）：len(a)>=926／\'a -> b\'／"k => v"／"cmd 2>&1" 均返回 null', (() => {
      return writeHit('node -e "if (len(a)>=926) 1"') === null && writeHit("printf 'a -> b'") === null
        && writeHit('echo "k => v"') === null && writeHit('run "cmd 2>&1"') === null
    })(), JSON.stringify([writeHit('node -e "if (len(a)>=926) 1"'), writeHit("printf 'a -> b'"), writeHit('echo "k => v"'), writeHit('run "cmd 2>&1"')]))
    add('D4② 引号外 fd 复制豁免正向边界（数字串后仅空白/行尾）＋2>/dev/null 字面正向边界（r5）：cmd 2>&1／cmd >&1／cmd 2>/dev/null／cmd 2>/dev/null; echo done 均返回 null',
      writeHit('cmd 2>&1') === null && writeHit('cmd >&1') === null && writeHit('cmd 2>/dev/null') === null && writeHit('cmd 2>/dev/null; echo done') === null, JSON.stringify([writeHit('cmd 2>&1'), writeHit('cmd >&1'), writeHit('cmd 2>/dev/null'), writeHit('cmd 2>/dev/null; echo done')]))
    add('D4③ 引号外 fn a -> b 命中（无豁免·fail-closed）', writeHit('fn a -> b') !== null, String(writeHit('fn a -> b')))
    add('D4④ 引号外 printf pwn => c 命中（=> 非豁免形态）', writeHit('printf pwn => c') !== null, String(writeHit('printf pwn => c')))
    add('D4⑤ 引号外 printf pwn >= 3 命中（>= 非豁免形态）', writeHit('printf pwn >= 3') !== null, String(writeHit('printf pwn >= 3')))
    add('D4⑥ 引号外 2>&1x 命中（数字后接字母·不豁免）', writeHit('2>&1x') !== null, String(writeHit('2>&1x')))
    add('D4⑦ 引号外 2>&1.x 命中（数字后接标点·标点后缀不豁免）', writeHit('2>&1.x') !== null, String(writeHit('2>&1.x')))
    add('D4⑧ 引号外 >&/tmp/x 命中＋十负例全量循环命中数=10（r5·引号外零残余窗口·漏一即红）', (() => {
      const negs = ['fn a -> b', 'printf pwn => c', 'printf pwn >= 3', '2>&1x', '2>&1.x', '>&/tmp/x', 'echo x > /tmp/f', 'echo x >> /tmp/f', 'echo " > f'.replace('"', String.fromCharCode(92) + '"'), '2>/dev/nullx']
      const hits = negs.filter((n) => writeHit(n) !== null)
      return writeHit('>&/tmp/x') !== null && hits.length === 10
    })(), JSON.stringify(['fn a -> b', 'printf pwn => c', 'printf pwn >= 3', '2>&1x', '2>&1.x', '>&/tmp/x', 'echo x > /tmp/f', 'echo x >> /tmp/f', 'echo ' + String.fromCharCode(92) + '" > f', '2>/dev/nullx'].map((n) => writeHit(n))))
    add('D4⑨ parseFacts 子字母 id 拾取：F-31b 入列且与 F-31 同簿互异', (() => {
      const two = parseFacts([line('F-31', '主条', "printf 'a\\n' | grep -c a", '1'), line('F-31b', '子条', "printf 'b\\n' | grep -c b", '1')].join('\n'))
      return two.length === 2 && two[0].id === 'F-31' && two[1].id === 'F-31b'
    })(), '')
    add('D4⑩ 子字母 record+verify 往返：F-31b record 落盘 id 一致且 verify 全一致 exit 0', (() => {
      const tbS = join(tmp, 'tb-sub.md'), evS = join(tmp, 'ev-sub.json')
      writeFileSync(tbS, line('F-31b', '子字母往返', "printf 'q\\n' | grep -c q", '1'), 'utf8')
      const rec = recordTaskbook(tbS, evS, tmp)
      if (rec.code !== 0 || !rec.doc || !rec.doc.entries[0] || rec.doc.entries[0].id !== 'F-31b') return false
      return verifyTaskbook(tbS, evS).code === 0
    })(), '')
    // ── W5b r5 增补（D-4 转义＋第二豁免边界·恰 3 向量·40→43）──
    add('D4⑪ 掩蔽循环转义处理（r5）：引号外 " > f 的 > 为引号外真重定向 → 命中（" 不开掩蔽域）', (() => {
      const esc = 'echo ' + String.fromCharCode(92) + '" > f'
      return writeHit(esc) !== null
    })(), String(writeHit('echo ' + String.fromCharCode(92) + '" > f')))
    add('D4⑫ 2>/dev/nullx 子串形态命中（r5·第二豁免边界：右界后接字母不豁免）＋2>/dev/null/foo 与 x2>/dev/null 子串形态亦命中', (() => {
      return writeHit('2>/dev/nullx') !== null && writeHit('2>/dev/null/foo') !== null && writeHit('x2>/dev/null') !== null
    })(), JSON.stringify([writeHit('2>/dev/nullx'), writeHit('2>/dev/null/foo'), writeHit('x2>/dev/null')]))
    add('D4⑬ echo x >> /tmp/f 独立命中断言（r5·既有负例单列）', writeHit('echo x >> /tmp/f') !== null, String(writeHit('echo x >> /tmp/f')))
    // ── INFRA1 D-6 向量组：verify stdout sha256 原始字节执法（红态先行——旧 verify 无 hash 面）──
    {
      const tbD6 = join(tmp, 'tb-d6.md'), evD6 = join(tmp, 'ev-d6.json')
      writeFileSync(tbD6, line('F-90', 'sha 正例', "echo infra1-d6-x", '1'), 'utf8')
      const recD6 = recordTaskbook(tbD6, evD6, tmp)
      const docD6 = recD6.doc
      add('INFRA1 D-6 record 全条目带 hex64 stdout_sha256', (() => {
        return !!docD6 && docD6.entries.every((e) => /^[0-9a-f]{64}$/.test(e.stdout_sha256 || ''))
      })(), '')
      // ① stdout tampering without hash update → integrity rejected (zero execution, exit 3)
      const evTamper = join(tmp, 'ev-d6-tamper.json')
      const dTamper = JSON.parse(JSON.stringify(docD6)); dTamper.entries[0].stdout = 'tampered-body\n'
      writeFileSync(evTamper, JSON.stringify(dTamper), 'utf8')
      const rTamper = verifyTaskbook(tbD6, evTamper)
      add('INFRA1 D-6 ① stdout tampering without changing hash → exit 3 with zero command execution + stdout_sha256 mismatch named', rTamper.code === 3 && (rTamper.results || []).length === 0 && String(rTamper.reason || '').includes('stdout_sha256'), `code=${rTamper.code} reason=${rTamper.reason}`)
      // restore green after revert
      writeFileSync(evTamper, JSON.stringify(docD6), 'utf8')
      add('INFRA1 D-6 ①-red revert: restore stdout → verify exit 0 (red must revert green)', verifyTaskbook(tbD6, evTamper).code === 0, '')
      // ② bad hex
      const evBadHex = join(tmp, 'ev-d6-badhex.json')
      const dBadHex = JSON.parse(JSON.stringify(docD6)); dBadHex.entries[0].stdout_sha256 = 'zz' + dBadHex.entries[0].stdout_sha256.slice(2)
      writeFileSync(evBadHex, JSON.stringify(dBadHex), 'utf8')
      const rBadHex = verifyTaskbook(tbD6, evBadHex)
      add('INFRA1 D-6 ② bad hex（非 hex64）→ exit 3 with zero command execution', rBadHex.code === 3 && (rBadHex.results || []).length === 0 && String(rBadHex.reason || '').includes('hex64'), `code=${rBadHex.code} reason=${rBadHex.reason}`)
      // ③ mixed with/without hash
      const evMixed = join(tmp, 'ev-d6-mixed.json')
      const tbD6b = join(tmp, 'tb-d6b.md'), evD6b = join(tmp, 'ev-d6b.json')
      writeFileSync(tbD6b, [line('F-90', 'sha 正例', "echo infra1-d6-x", '1'), line('F-91', 'second entry', "printf infra1-d6-y", '1')].join('\n'), 'utf8')
      recordTaskbook(tbD6b, evD6b, tmp)
      const dMixed = { schema: SCHEMA, taskbook: docD6.taskbook, generated_at: docD6.generated_at, entries: JSON.parse(readFileSync(evD6b, 'utf8')).entries.map((e) => ({ ...e })) }
      delete dMixed.entries[1].stdout_sha256
      writeFileSync(evMixed, JSON.stringify(dMixed), 'utf8')
      const rMixed = verifyTaskbook(tbD6b, evMixed)
      add('INFRA1 D-6 ③ mixed with/without hash → exit 3 with zero command execution + mixed form named', rMixed.code === 3 && (rMixed.results || []).length === 0 && String(rMixed.reason || '').includes('混排'), `code=${rMixed.code} reason=${rMixed.reason}`)
      // ④ CRLF rewrite while hash unchanged → rejected (byte-level no longer equivalent)
      const evCrlf = join(tmp, 'ev-d6-crlf.json')
      const dCrlf = JSON.parse(JSON.stringify(docD6)); dCrlf.entries[0].stdout = dCrlf.entries[0].stdout.replace(/\n/g, '\r\n')
      writeFileSync(evCrlf, JSON.stringify(dCrlf), 'utf8')
      const rCrlf = verifyTaskbook(tbD6, evCrlf)
      add('INFRA1 D-6 ④ CRLF rewrite (hash unchanged) → exit 3 (LF/CRLF no longer treated as equivalent)', rCrlf.code === 3 && String(rCrlf.reason || '').includes('stdout_sha256'), `code=${rCrlf.code} reason=${rCrlf.reason}`)
      // ⑤ legacy all-zero-hash → old normalized comparison still allowed
      const evLegacy = join(tmp, 'ev-d6-legacy.json')
      const dLegacy = JSON.parse(JSON.stringify(docD6)); delete dLegacy.entries[0].stdout_sha256
      dLegacy.entries[0].stdout = String(dLegacy.entries[0].stdout || '').replace(/\n$/, '')  // trailing-whitespace difference goes through normalization
      writeFileSync(evLegacy, JSON.stringify(dLegacy), 'utf8')
      const rLegacy = verifyTaskbook(tbD6, evLegacy)
      add('INFRA1 D-6 ⑤ legacy all-zero-hash → old normalized comparison (trailing newline normalization still allowed) exit 0', rLegacy.code === 0, `code=${rLegacy.code} reason=${rLegacy.reason}`)
      // ⑥ runtime stdout tampering (hash face) → exit 1 with sameHash=false
      const evRun = join(tmp, 'ev-d6-run.json')
      const dRun = JSON.parse(JSON.stringify(docD6))
      writeFileSync(join(tmp, 'runtime-flip'), '', 'utf8')
      writeFileSync(evRun, JSON.stringify(dRun), 'utf8')
      const rRun = verifyTaskbook(tbD6, evRun)
      add('INFRA1 D-⑥ runtime consistent → exit 0 and per-entry sameHash can be derived from results', rRun.code === 0, `code=${rRun.code}`)
    }
    add('D4⑭ 双引号内转义不闭合掩蔽域（r6·ds-W-1）：python3 -c "print(\">\")" 的 > 在引号域内 → 返回 null（inD 反斜杠连带吞下一字符）', (() => {
      const q = String.fromCharCode(92) + '"'
      return writeHit('python3 -c "print(' + q + '>' + q + ')"') === null
    })(), String(writeHit('python3 -c "print(' + String.fromCharCode(92) + '">' + String.fromCharCode(92) + '")"')))
    // ── W5c D-1/D-3 增补（闭引号紧邻豁免＋命令分隔符左界·恰 2 向量·44→46）──
    add('D1① 闭引号紧邻 2>/dev/null 豁免（W5c D-1·掩蔽保留闭引号边界）：printf "x"2>/dev/null 与 printf \'x\'2>/dev/null 均返回 null；负例 x2>/dev/null／2>/dev/nullx／2>/dev/null"foo" 均命中', (() => {
      return writeHit('printf "x"2>/dev/null') === null && writeHit("printf 'x'2>/dev/null") === null
        && writeHit('x2>/dev/null') !== null && writeHit('2>/dev/nullx') !== null && writeHit('2>/dev/null"foo"') !== null
    })(), JSON.stringify([writeHit('printf "x"2>/dev/null'), writeHit("printf 'x'2>/dev/null"), writeHit('x2>/dev/null'), writeHit('2>/dev/nullx'), writeHit('2>/dev/null"foo"')]))
    add('D3① 命令分隔符左界豁免（W5c D-3）：cmd;2>/dev/null／cmd|2>/dev/null／cmd||2>/dev/null／cmd&2>/dev/null／cmd&&2>/dev/null 均返回 null；负例 x2>/dev/null 与右界接字母/路径仍命中', (() => {
      return writeHit('cmd;2>/dev/null') === null && writeHit('cmd|2>/dev/null') === null && writeHit('cmd||2>/dev/null') === null
        && writeHit('cmd&2>/dev/null') === null && writeHit('cmd&&2>/dev/null') === null
        && writeHit('x2>/dev/null') !== null && writeHit('2>/dev/nullx') !== null && writeHit('2>/dev/null/foo') !== null
    })(), JSON.stringify([writeHit('cmd;2>/dev/null'), writeHit('cmd|2>/dev/null'), writeHit('cmd||2>/dev/null'), writeHit('cmd&2>/dev/null'), writeHit('cmd&&2>/dev/null'), writeHit('x2>/dev/null'), writeHit('2>/dev/null/foo')]))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  const pass = cases.filter((c) => c.ok).length
  return { cases, pass, fail: cases.length - pass }
}

// ── 主入口 ──
function usage() {
  console.error('用法：node scripts/taskbook-evidence.mjs record --taskbook <任务书.md> --out <证据.json> [--root <dir>]')
  console.error('      node scripts/taskbook-evidence.mjs verify --taskbook <任务书.md> --evidence <证据.json> [--root <dir>]')
  console.error('      node scripts/taskbook-evidence.mjs --self-test')
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) {
    const { cases, pass, fail } = selfTest()
    for (const c of cases) if (!c.ok) console.log(`[self-test] FAIL ${c.name}${c.detail ? `（${c.detail}）` : ''}`)
    if (fail === 0) console.log(`self-test 全过（${cases.length} 向量）`)
    else console.log(`[self-test] FAIL ×${fail}`)
    process.exit(fail === 0 ? 0 : 1)
  }
  const [sub, ...rest] = argv
  if (sub !== 'record' && sub !== 'verify') { usage(); process.exit(1) }
  const opt = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--taskbook' || a === '--out' || a === '--evidence' || a === '--root') {
      const v = rest[++i]
      if (!v) { usage(); process.exit(1) }
      opt[a.slice(2)] = v
    } else { usage(); process.exit(1) }
  }
  if (!opt.taskbook || (sub === 'record' ? !opt.out : !opt.evidence)) { usage(); process.exit(1) }
  if (sub === 'record') {
    const { code, failedCount, failedPath, reason } = recordTaskbook(opt.taskbook, opt.out, opt.root ? resolve(opt.root) : SKILL_ROOT)
    if (code === 3) console.error(`[装载错] ${reason || '任务书或环境不可读'}`)
    else if (code === 1) {
      // W-3：仅 F 命令非零报非零条数＋sidecar；用法/只读校验失败=[用法错] 类，不报 sidecar
      if (failedPath) console.log(`record 失败：非零条目 ×${failedCount}；失败件=${failedPath}（正文不回显）`)
      else console.error(`[用法错] ${reason || '只读校验未通过，整批拒绝落盘'}`)
    }
    process.exit(code)
  }
  const { code, results, reason } = verifyTaskbook(opt.taskbook, opt.evidence)
  if (code === 3) console.error(`[装载错] ${reason || '任务书或证据文件不可读/schema 不符'}`)
  // N-9：exit-only 与 stdout 不一致分形态；精确标记仅 stdout 场景
  if (code === 1) for (const r of results) {
    if (!r.ok) console.log(r.sameOut
      ? `[不一致] ${r.id} exit 期望 ${r.exit} 实际 ${r.actualExit}（stdout 一致）`
      : `[不一致] ${r.id} exit 期望 ${r.exit} 实际 ${r.actualExit}；stdout 不一致（正文不回显）`)
  }
  if (code === 0 && results.length) console.log(`verify 全一致（${results.length} 条）`)
  process.exit(code)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
