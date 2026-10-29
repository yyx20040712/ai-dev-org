#!/usr/bin/env node
// taskbook-evidence.mjs — 任务书事实台账落盘与重验（L10，2026-10-22）
// record：解析 §4 F 条目 → 只读校验 → 逐条执行 → 落盘 JSON
// verify：按证据条目记录的 cwd 重跑命令，比对 exit 与规范化 stdout
// 退出码口径单源=references/06 §5.8（用法错 1／装载错 3／校验失败 1／通过 0）。
// 安全边界：只执行任务书声明且通过只读校验的 F 命令；不执行 E 条目与验收命令。

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SKILL_ROOT = resolve(SCRIPT_DIR, '..')
const SCHEMA = 'taskbook-evidence/v1'
const WRITE_PATTERNS = [
  ['rm', /\brm\b/], ['mv', /\bmv\b/], ['tee', /\btee\b/], ['dd', /\bdd\b/],
  ['sed -i', /\bsed\s+-i/], ['truncate', /\btruncate\b/], ['touch', /\btouch\b/],
  ['mkdir', /\bmkdir\b/], ['cp', /\bcp\b/],
]

/** 写入形态判定：命中返回片段名，否则 null（仅 2>/dev/null 重定向放行）。 */
export function writeHit(cmd) {
  const s = String(cmd ?? '')
  for (const [name, re] of WRITE_PATTERNS) if (re.test(s)) return name
  if (s.replace(/2>\/dev\/null/g, '').includes('>')) return '>'
  return null
}

/** §4 F 条目解析（全角竖线分隔五字段；字段不足忽略；围栏块内行跳过）。 */
export function parseFacts(text) {
  const out = []; let fence = null
  const lines = String(text ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const fm = /^\s*(```|~~~)/.exec(lines[i])
    if (fm) { fence = fence ? null : fm[1]; continue }
    if (fence) continue
    const ln = lines[i].trim()
    if (!/^F-\d{2}\s*｜/.test(ln)) continue
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

/** record：只读校验通过后逐条执行并落盘；任一 exit≠0 仍落盘但整体失败。
 *  B7 D-5：entry 新增 skill_head＝SKILL_ROOT git HEAD 实读（repo_head 仍取 --root 仓）；HEAD 不可读＝装载失败（code 3）——预检先于任何 F 命令执行且不落盘证据件。 */
export function recordTaskbook(taskbookPath, outPath, root = SKILL_ROOT) {
  if (!existsSync(taskbookPath)) return { code: 3, doc: null }
  const facts = parseFacts(readFileSync(taskbookPath, 'utf8'))
  for (const f of facts) {
    const hit = writeHit(f.cmd)
    if (hit) {
      console.error(`[用法错] ${f.id} 命令含写入形态「${hit}」：${f.cmd}`)
      return { code: 1, doc: null }
    }
  }
  const skillHead = repoHead(SKILL_ROOT)
  if (!skillHead) return { code: 3, doc: null }
  const cwd = resolve(root)
  const entries = []
  let bad = false
  for (const f of facts) {
    const r = run(f.cmd, cwd)
    if (r.exit !== 0) bad = true
    entries.push({
      id: f.id, label: f.label, cmd: f.cmd, cwd,
      exit: r.exit, stdout: r.stdout,
      stdout_sha256: createHash('sha256').update(r.stdout).digest('hex'),
      recorded_at: new Date().toISOString(), repo_head: repoHead(cwd), skill_head: skillHead,
      date: f.date, declared: f.declared,
    })
  }
  const doc = { schema: SCHEMA, taskbook: resolve(taskbookPath), generated_at: new Date().toISOString(), entries }
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  return { code: bad ? 1 : 0, doc }
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
  const norm = (s) => String(s ?? '').replace(/\r\n/g, '\n').replace(/\s+$/g, '')
  const results = []
  let bad = false
  for (const e of doc.entries) {
    const r = run(e.cmd, e.cwd)
    const sameExit = r.exit === e.exit
    const sameOut = norm(r.stdout) === norm(e.stdout)
    if (!sameExit || !sameOut) bad = true
    results.push({ id: e.id, ok: sameExit && sameOut, exit: e.exit, actualExit: r.exit, expected: norm(e.stdout), actual: norm(r.stdout) })
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
    const doc = JSON.parse(readFileSync(ev, 'utf8'))
    const e0 = doc.entries[0]
    add('record 落盘：schema 与字段齐全', rec.code === 1 && doc.schema === SCHEMA && ['id', 'label', 'cmd', 'cwd', 'exit', 'stdout', 'stdout_sha256', 'recorded_at', 'repo_head', 'date', 'declared'].every((k) => k in e0), JSON.stringify(doc).slice(0, 200))
    add('record 遇 exit≠0：仍落盘且整体退 1', doc.entries.length === 2 && doc.entries[1].exit === 4 && rec.code === 1, JSON.stringify(doc.entries[1]))
    add('record 只读校验拒绝整批：写入命令不落盘', (() => { const p = join(tmp, 'w.md'); writeFileSync(p, line('F-09', '写', 'rm -f x', '0'), 'utf8'); const o = join(tmp, 'w.json'); return recordTaskbook(p, o, tmp).code === 1 && !existsSync(o) })())
    add('verify 一致：exit 0', verifyTaskbook(tb, ev).code === 0)
    const badOut = JSON.parse(readFileSync(ev, 'utf8'))
    badOut.entries[0].stdout = 'b\n'
    writeFileSync(ev, JSON.stringify(badOut), 'utf8')
    add('verify stdout 不一致：exit 1', verifyTaskbook(tb, ev).code === 1)
    const badExit = JSON.parse(JSON.stringify(doc))
    badExit.entries[1].exit = 0
    writeFileSync(ev, JSON.stringify(badExit), 'utf8')
    add('verify exit 不一致：exit 1', verifyTaskbook(tb, ev).code === 1)
    add('verify 证据缺失：exit 3', verifyTaskbook(tb, join(tmp, 'nope.json')).code === 3)
    writeFileSync(ev, JSON.stringify({ schema: 'x', entries: [] }), 'utf8')
    add('verify schema 不符：exit 3', verifyTaskbook(tb, ev).code === 3)
    const crlf = JSON.parse(JSON.stringify(doc))
    crlf.entries[0].stdout = crlf.entries[0].stdout.replace(/\n/g, '\r\n')
    writeFileSync(ev, JSON.stringify(crlf), 'utf8')
    add('stdout 规范化：CRLF 与 LF 等价', verifyTaskbook(tb, ev).code === 0)
    const pwn = join(tmp, 'pwn.txt'), evWith = (o) => writeFileSync(ev, JSON.stringify({ ...doc, entries: [{ ...doc.entries[0], ...o }] }), 'utf8')
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
        return r.status === 3 && absent && r2.status === 1 && head !== '' && existsSync(ovx) && JSON.parse(readFileSync(ovx, 'utf8')).entries[0].skill_head === head
      } finally { rmSync(iso, { recursive: true, force: true }) }
    })())
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
    const { code } = recordTaskbook(opt.taskbook, opt.out, opt.root ? resolve(opt.root) : SKILL_ROOT)
    if (code === 3) console.error(`[装载错] 任务书不存在：${opt.taskbook}`)
    process.exit(code)
  }
  const { code, results, reason } = verifyTaskbook(opt.taskbook, opt.evidence)
  if (code === 3) console.error(`[装载错] ${reason || '任务书或证据文件不可读/schema 不符'}`)
  if (code === 1) for (const r of results) if (!r.ok) console.log(`[不一致] ${r.id} exit 期望 ${r.exit} 实际 ${r.actualExit}；stdout 期望 ${JSON.stringify(r.expected)} 实际 ${JSON.stringify(r.actual)}`)
  if (code === 0 && results.length) console.log(`verify 全一致（${results.length} 条）`)
  process.exit(code)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
