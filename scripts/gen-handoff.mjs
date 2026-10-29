#!/usr/bin/env node
/**
 * 交接件生成器（B6 文档生成批·docs/13 原案 B3 动作 1/2/3/4）：
 *  - 模板=templates/handoff.md（唯一人工编辑源，正文为派生物并挂 --check）；
 *  - 八槽闭集 summary/health/session/final/residuals/candidates/first_action/index 各恰一次；
 *  - 槽位内容=源文件指定标题下至同级或更高一级标题前的原文（不改字、不摘要、不补句）；
 *  - 序号跨日单调：全局最大序号＋1；显式序号≤现最大值/目标已存在/文件名不一致=失败；
 *  - 日期显式 YYYY-MM-DD 且本地往返校验；重复输入按槽位 id、规范化路径、标题稳定排序；
 *  - 生成模式只创建新文件（同目录临时文件＋rename），--check 只在内存重算逐字节比对。
 * 用法：node scripts/gen-handoff.mjs --project <dir> --date <YYYY-MM-DD> [--sequence NN]
 *       --batch <id> --authority <指针> --change-anchor <批次与账本指针>
 *       --supersedes <路径|无> --section <slot>=<报告路径>#<标题> ...
 *       --output <新路径> [--check] | --self-test
 * 退出码口径单源=references/06 §5.8：0=成功；1=用法/参数错或内容判红或自检失败；3=配置/装载失败。
 * 模板根：生产恒=SKILL_ROOT/templates（CLI 无模板根参数——D-1）；env DOCGEN_TEMPLATE_ROOT
 * 仅作 --self-test 内部私有夹具通道（同 verify-docs ORG_SKILL_ROOT 内部测试设施先例），
 * 生产调用不得设置。固定快照=scripts/.golden/docgen-fixtures.json（--self-test 单源输入）。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { SKILL_ROOT, UsageError } from './org-config.mjs'

const SELF = fileURLToPath(import.meta.url)
const SLOTS = ['summary', 'health', 'session', 'final', 'residuals', 'candidates', 'first_action', 'index']
const EXIT_OK = 0, EXIT_RED = 1, EXIT_CONFIG = 3
class ContentError extends Error {}
const usageExit = (m) => { console.error(`[用法错] ${m}（06 §5.8 行 1）`); process.exit(EXIT_RED) }
const redExit = (m) => { console.error(`[判红] ${m}`); process.exit(EXIT_RED) }
const configExit = (m) => { console.error(`[装载错] ${m}（06 §5.8 行 3）`); process.exit(EXIT_CONFIG) }

/** CLI 解析：未知参数/缺值/重复值参/等号形态=用法错（D-1；multi 名单允许多值）。 */
function parseArgs(argv, spec) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) usageExit(`多余位置参数：${a}`)
    if (a.includes('=')) usageExit(`等号形态「${a}」不支持——flag 一律空格分隔取值`)
    if (spec.bool.includes(a)) { out[a] = (out[a] || 0) + 1; if (out[a] > 1) usageExit(`重复 flag：${a}`); continue }
    const isValue = spec.value.includes(a), isMulti = spec.multi.includes(a)
    if (!isValue && !isMulti) usageExit(`未知参数：${a}（本脚本仅提供点名模式与 --self-test）`)
    const v = argv[i + 1]
    if (v === undefined) usageExit(`flag ${a} 居末位无值`)
    if (v.startsWith('--')) usageExit(`flag ${a} 的值形如 flag（「${v}」）`)
    i++
    if (isValue) { if (out[a] !== undefined) usageExit(`重复 flag：${a}`); out[a] = v } else (out[a] ??= []).push(v)
  }
  return out
}

/** 日期显式校验：YYYY-MM-DD 且本地构造往返一致（拒绝伪日期）。 */
function checkDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/** 源文件标题段抽取：该标题下至同级或更高一级标题前的原文，去首尾空行。 */
function extractSection(text, title) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const hits = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s+(.*?)\s*$/)
    if (m && m[2] === title) hits.push({ level: m[1].length, line: i })
  }
  if (hits.length === 0) throw new ContentError(`源标题缺位：「${title}」`)
  if (hits.length > 1) throw new ContentError(`源标题不唯一（${hits.length} 处）：「${title}」`)
  let end = lines.length
  for (let i = hits[0].line + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s+/)
    if (m && m[1].length <= hits[0].level) { end = i; break }
  }
  const seg = lines.slice(hits[0].line + 1, end)
  while (seg.length && seg[0].trim() === '') seg.shift()
  while (seg.length && seg[seg.length - 1].trim() === '') seg.pop()
  if (!seg.length) throw new ContentError(`抽取为空：「${title}」`)
  return seg.join('\n')
}

/** 模板渲染：占位全消解（残留占位=判红），LF、文件末恰一个换行。 */
function render(tpl, map) {
  let out = tpl.replace(/\r\n/g, '\n')
  for (const [k, v] of Object.entries(map)) out = out.split(`{{${k}}}`).join(v)
  const leftover = out.match(/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/)
  if (leftover) throw new ContentError(`模板占位未消解：${leftover[0]}（槽位集与模板失配）`)
  return out.replace(/\n+$/, '\n')
}

/** 只创建新文件：同目录临时文件＋rename；目标已存在即失败（禁覆盖历史件）。 */
function atomicNewWrite(p, content) {
  if (existsSync(p)) throw new ContentError(`目标已存在，生成模式禁覆盖：${p}`)
  const tmp = join(dirname(p), `.${basename(p)}.tmp-${process.pid}`)
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, p)
}

/** 全局最大序号扫描（跨日单调：取全部 NN 最大值，不按日归零）。 */
function scanMaxSequence(projectDir) {
  const dir = join(projectDir, 'docs', 'evidence')
  let max = 0
  if (!existsSync(dir)) return max
  for (const f of readdirSync(dir)) {
    const m = f.match(/^handoff-\d{4}-\d{2}-\d{2}-(\d{2})\.md$/)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

function templatePath() {
  const rootOverride = process.env.DOCGEN_TEMPLATE_ROOT
  return rootOverride ? join(rootOverride, 'handoff.md') : join(SKILL_ROOT, 'templates', 'handoff.md')
}

function buildSections(projectDir, rawSections) {
  const parsed = []
  for (const raw of rawSections) {
    const eq = raw.indexOf('=')
    if (eq <= 0) throw new ContentError(`--section 形态须 <slot>=<报告路径>#<标题>：${raw}`)
    const slot = raw.slice(0, eq)
    if (!SLOTS.includes(slot)) usageExit(`未知槽位：${slot}（闭集=${SLOTS.join('/')}）`)
    const rest = raw.slice(eq + 1)
    const hash = rest.lastIndexOf('#')
    if (hash <= 0 || hash === rest.length - 1) throw new ContentError(`--section 缺路径或标题：${raw}`)
    const path = rest.slice(0, hash), title = rest.slice(hash + 1)
    parsed.push({ slot, path: resolve(projectDir, path), normPath: resolve(projectDir, path), title })
  }
  const bySlot = new Map()
  for (const s of parsed) {
    if (bySlot.has(s.slot)) throw new ContentError(`槽位重复：${s.slot}（八槽各恰一次）`)
    bySlot.set(s.slot, s)
  }
  for (const slot of SLOTS) if (!bySlot.has(slot)) throw new ContentError(`槽位缺位：${slot}（八槽各恰一次）`)
  return [...bySlot.values()].sort((a, b) => a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : a.normPath < b.normPath ? -1 : a.normPath > b.normPath ? 1 : a.title < b.title ? -1 : a.title > b.title ? 1 : 0)
}

function runGenerate(args, check) {
  const projectDir = resolve(args['--project'])
  if (!existsSync(projectDir)) redExit(`项目目录不存在：${projectDir}`)
  const date = args['--date']
  if (!checkDate(date)) redExit(`日期非法或缺失（须 YYYY-MM-DD 且本地往返一致）：${date ?? '(缺)'}`)
  const explicitSeq = args['--sequence'] !== undefined ? args['--sequence'] : null
  if (explicitSeq !== null && !/^\d{2}$/.test(explicitSeq)) usageExit(`--sequence 须两位十进制字符串：${explicitSeq}`)
  const output = resolve(args['--output'])
  const maxSeq = scanMaxSequence(projectDir)
  let seq
  if (check) {
    if (explicitSeq !== null) seq = explicitSeq
    else {
      const m = basename(output).match(/^handoff-\d{4}-\d{2}-\d{2}-(\d{2})\.md$/)
      if (!m) redExit(`--check 未给 --sequence 时 --output 须形如 handoff-<date>-<NN>.md：${basename(output)}`)
      seq = m[1]
      if (Number(seq) !== maxSeq) throw new ContentError(`序号漂移：文件名 NN=${seq} ≠ 当前最大值 ${maxSeq}（--check 校验既有件，不再＋1）`)
    }
    if (basename(output) !== `handoff-${date}-${seq}.md`) throw new ContentError(`目标文件名与 date/NN 不一致：${basename(output)} ≠ handoff-${date}-${seq}.md`)
  } else {
    if (explicitSeq !== null) {
      if (Number(explicitSeq) <= maxSeq) throw new ContentError(`序号冲突：显式 ${explicitSeq} ≤ 现最大值 ${maxSeq}`)
      seq = explicitSeq
    } else seq = String(maxSeq + 1).padStart(2, '0')
    if (basename(output) !== `handoff-${date}-${seq}.md`) throw new ContentError(`目标文件名与 date/NN 不一致：${basename(output)} ≠ handoff-${date}-${seq}.md`)
    const outDir = dirname(output), evidenceDir = resolve(projectDir, 'docs', 'evidence')
    if (outDir !== evidenceDir && !outDir.startsWith(resolve(tmpdir()) + '/')) throw new ContentError(`输出目录只能是项目 docs/evidence 或 /tmp 夹具：${outDir}`)
    if (existsSync(output)) throw new ContentError(`目标已存在，生成模式禁覆盖：${output}`)
  }
  const sections = buildSections(projectDir, args['--section'])
  const tp = templatePath()
  if (!existsSync(tp)) configExit(`模板缺失：${tp}`)
  const tpl = readFileSync(tp, 'utf8')
  const extracted = {}
  for (const s of sections) {
    if (!existsSync(s.path)) throw new ContentError(`源报告路径缺位：${s.path}`)
    extracted[s.slot] = extractSection(readFileSync(s.path, 'utf8'), s.title)
  }
  const body = render(tpl, {
    sequence: seq, batch: args['--batch'], authority: args['--authority'], date,
    supersedes: args['--supersedes'], change_anchor: args['--change-anchor'], ...extracted,
  })
  if (check) {
    if (!existsSync(output)) redExit(`--check 目标不存在：${output}`)
    const cur = readFileSync(output)
    if (!cur.equals(Buffer.from(body, 'utf8'))) { console.error('[判红] --check 重算与现有文件不一致（正文手改/模板未再生成/源抽取变化/序号漂移之一）'); process.exit(EXIT_RED) }
    console.log(`handoff --check 一致：${output}（序号=${seq} 全局最大=${maxSeq}）`)
    return
  }
  atomicNewWrite(output, body)
  console.log(`handoff 已生成：${output}（序号=${seq} 全局最大=${maxSeq}→跨日单调）`)
}

// ── --self-test：固定快照驱动，真 CLI 子进程，逐项打印 case=<name> exit=<真值> ──
function selfTest() {
  const fxPath = join(SKILL_ROOT, 'scripts', '.golden', 'docgen-fixtures.json')
  if (!existsSync(fxPath)) configExit(`固定快照缺失：${fxPath}`)
  let fx
  try { fx = JSON.parse(readFileSync(fxPath, 'utf8')) } catch (e) { configExit(`固定快照不可解析：${e.message}`) }
  const tmp = mkdtempSync(join(tmpdir(), 'gen-handoff-st-'))
  let allOk = true
  const note = (ok, label) => { if (!ok) allOk = false; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`) }
  try {
    const mkProject = (name) => {
      const proj = join(tmp, name)
      mkdirSync(join(proj, 'docs', 'evidence'), { recursive: true })
      for (const [rel, content] of Object.entries(fx.sources)) {
        const p = join(proj, rel)
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(p, content, 'utf8')
      }
      for (const f of fx.handoff_existing) writeFileSync(join(proj, 'docs', 'evidence', f), '(合成历史件)\n', 'utf8')
      return proj
    }
    const proj1 = mkProject('proj1'), proj2 = mkProject('proj2')
    const negOut = join(tmp, 'neg-out')
    mkdirSync(negOut, { recursive: true })
    const run = (args, env = {}) => spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 })
    const subst = (args) => args.map((a) => a.replace(/@PROJECT@/g, proj1).replace(/@PROJECT2@/g, proj2).replace(/@OUT_NEG@/g, negOut))
    let mutatedRoot = null
    for (const c of fx.self_test_cases['gen-handoff']) {
      const env = {}
      if (c.mutate_template) {
        const dir = join(tmp, 'mut-templates')
        mkdirSync(dir, { recursive: true })
        const prod = readFileSync(join(SKILL_ROOT, 'templates', 'handoff.md'), 'utf8')
        if (!prod.includes(c.mutate_template.from)) { note(false, `夹具变异锚缺失：${c.mutate_template.from}`); continue }
        writeFileSync(join(dir, 'handoff.md'), prod.replace(c.mutate_template.from, c.mutate_template.to), 'utf8')
        mutatedRoot = dir
        env.DOCGEN_TEMPLATE_ROOT = dir
      }
      const r = run(subst(c.args), env)
      const code = r.status === null ? 124 : r.status
      console.log(`case=${c.name} exit=${code}`)
      if (code !== c.expected_exit) allOk = false
    }
    const p1 = join(proj1, 'docs', 'evidence', 'handoff-2099-01-02-21.md')
    const p2 = join(proj2, 'docs', 'evidence', 'handoff-2099-01-02-21.md')
    if (!existsSync(p1) || !existsSync(p2)) { note(false, '正例产物缺席（先修正例再跑对照）'); return allOk }
    // 固定快照两次生成逐字节一致：第三个干净项目重生成与 proj1 产物比对
    const proj3 = mkProject('proj3')
    const p1Args = subst(fx.self_test_cases['gen-handoff'].find((c) => c.name === 'handoff-p1-cross-day').args).map((a) => a.replace(proj1, proj3))
    const r3 = run(p1Args)
    const p3 = join(proj3, 'docs', 'evidence', 'handoff-2099-01-02-21.md')
    note(r3.status === 0 && existsSync(p3) && readFileSync(p1).equals(readFileSync(p3)), '固定快照两次生成逐字节一致（proj1↔proj3）')
    note(readFileSync(p1).equals(Buffer.from(fx.expected.handoff, 'utf8')), '快照期望字节一致（fixture.expected.handoff）')
    note(readFileSync(p1).equals(readFileSync(p2)), '输入乱序一致（proj1 正序 ↔ proj2 逆序逐字节相同）')
    // --check 一致（生产模板根，内存重算不写回）
    const before = readFileSync(p1)
    const rc = run(subst(['--project', '@PROJECT@', '--date', '2099-01-02', '--batch', 'FX-01', '--authority', '账本 fx-dispatch-2099 行', '--change-anchor', 'FX-01·账本 fx-dispatch-2099', '--supersedes', '无', '--section', 'summary=docs/evidence/fx-report-alpha.md#概览', '--section', 'health=docs/evidence/fx-report-alpha.md#明细', '--section', 'session=docs/evidence/fx-report-beta.md#会话记录', '--section', 'final=docs/evidence/fx-report-beta.md#终态记录', '--section', 'residuals=docs/evidence/fx-report-beta.md#挂账记录', '--section', 'candidates=docs/evidence/fx-report-beta.md#候选记录', '--section', 'first_action=docs/evidence/fx-report-beta.md#第一句', '--section', 'index=docs/evidence/fx-report-beta.md#索引记录', '--output', '@PROJECT@/docs/evidence/handoff-2099-01-02-21.md', '--check']))
    note(rc.status === 0 && readFileSync(p1).equals(before) && mutatedRoot !== null, '--check 一致（内存重算逐字节相同且未写回）')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  return allOk
}

const argv = process.argv.slice(2)
if (argv.includes('--self-test')) process.exit(selfTest() ? EXIT_OK : EXIT_RED)
try {
  const args = parseArgs(argv, { value: ['--project', '--date', '--sequence', '--batch', '--authority', '--change-anchor', '--supersedes', '--output'], bool: ['--check'], multi: ['--section'] })
  for (const req of ['--project', '--date', '--batch', '--authority', '--change-anchor', '--supersedes', '--output']) if (args[req] === undefined) usageExit(`缺必填参数：${req}`)
  runGenerate(args, args['--check'] === 1)
} catch (e) {
  if (e instanceof UsageError) usageExit(e.message)
  if (e instanceof ContentError) redExit(e.message)
  if (e instanceof Error && e.code === 'ENOENT') configExit(`装载失败：${e.message}`)
  console.error(`[fatal] ${e.message}`)
  process.exit(EXIT_CONFIG)
}
