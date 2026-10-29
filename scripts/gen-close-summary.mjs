#!/usr/bin/env node
/**
 * close/gates 摘要生成器（B6 文档生成批·docs/13 原案 B3 动作 1/4/5）：
 *  - kind=close → templates/close-summary.md（状态固定 closed；槽位闭集 summary/details/gates/revert）；
 *  - kind=gates → templates/gates-summary.md（状态固定 active；槽位闭集 summary/details/gates）；
 *  - 摘要槽只逐字汇总源报告原文和指针：summary 抽取文本含结论机读行
 *    （多行模式 ^\s*(FINDINGS|VERDICT|审批结论)\s*[:：]）即判红；
 *  - details/gates/revert 保留源报告原文，生成器不重新分级、不合并结论、
 *    不计算通过与否、不新写审批词；审核与裁决原文只来自对应岗位报告；
 *  - 五字段引块（状态/权威/更新/替代/变更锚）＋摘要段＋详述结构（08 §8.3）；
 *  - 重复输入按槽位 id、规范化路径、标题稳定排序；生成只创建新文件；--check 内存重算。
 * 用法：node scripts/gen-close-summary.mjs --kind <close|gates> --project <dir> --date <YYYY-MM-DD>
 *       --batch <id> --authority <指针> --change-anchor <批次与账本指针>
 *       --supersedes <路径|无> --section <slot>=<报告路径>#<标题> ...
 *       --output <新路径> [--check] | --self-test
 * 退出码口径单源=references/06 §5.8：0=成功；1=用法/参数错或内容判红或自检失败；3=配置/装载失败。
 * 模板根：生产恒=SKILL_ROOT/templates；DOCGEN_TEMPLATE_ROOT/DOCGEN_TEMPLATE_FIXTURE 两 env
 * 无条件忽略（齐全也不生效——返工轮 2 主控裁决内部参数制）；唯一夹具注入面=
 * --__selftest-template-root 内部专用参数（--self-test 私有通道，外部慎用）。
 */
import { readFileSync, writeFileSync, existsSync, renameSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { SKILL_ROOT, UsageError } from './org-config.mjs'

const SELF = fileURLToPath(import.meta.url)
const KIND_SLOTS = { close: ['summary', 'details', 'gates', 'revert'], gates: ['summary', 'details', 'gates'] }
const EXIT_OK = 0, EXIT_RED = 1, EXIT_CONFIG = 3
class ContentError extends Error {}
const usageExit = (m) => { console.error(`[用法错] ${m}（06 §5.8 行 1）`); process.exit(EXIT_RED) }
const redExit = (m) => { console.error(`[判红] ${m}`); process.exit(EXIT_RED) }
const configExit = (m) => { console.error(`[装载错] ${m}（06 §5.8 行 3）`); process.exit(EXIT_CONFIG) }

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
    if (v.trim() === '') usageExit(`flag ${a} 的值不得为空串或纯空白（W-2/N-10 同源：空值=用法错）`)
    i++
    if (isValue) { if (out[a] !== undefined) usageExit(`重复 flag：${a}`); out[a] = v } else (out[a] ??= []).push(v)
  }
  return out
}

function checkDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

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

/** 模板渲染（W-6 源文隔离）：①槽位占位先换哨兵＋标量替换（骨架渲染）→②骨架残留占位判红
 *  →③源文经哨兵原样插入——源文字面量（含 {{slot}} 形）不参与占位替换与未消解判定。 */
function render(tpl, scalars, sources) {
  let skeleton = tpl.replace(/\r\n/g, '\n')
  const tokens = new Map()
  for (const k of Object.keys(sources)) {
    const tok = `\u0000b6:${k}\u0000`
    skeleton = skeleton.split(`{{${k}}}`).join(tok)
    tokens.set(k, tok)
  }
  for (const [k, v] of Object.entries(scalars)) skeleton = skeleton.split(`{{${k}}}`).join(v)
  const leftover = skeleton.match(/\{\{[^}]+\}\}/)
  if (leftover) throw new ContentError(`模板占位未消解：${leftover[0]}（槽位集与模板失配）`)
  for (const [k, v] of Object.entries(sources)) skeleton = skeleton.split(tokens.get(k)).join(v)
  return skeleton.replace(/\n+$/, '\n')
}

function atomicNewWrite(p, content) {
  if (existsSync(p)) throw new ContentError(`目标已存在，生成模式禁覆盖：${p}`)
  const tmp = join(dirname(p), `.${basename(p)}.tmp-${process.pid}`)
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, p)
}

/** 结论机读行拒入摘要（多行模式·N-2 tolerant 形态：行首空白可有可无、全半角冒号皆拦）。 */
function assertNoVerdictLine(text, slot) {
  const re = /^\s*(FINDINGS|VERDICT|审批结论)\s*[:：]/m
  if (re.test(text)) throw new ContentError(`摘要槽（${slot}）抽取文本含结论机读行（FINDINGS/VERDICT/审批结论）——须改传不含结论机读行的原文段`)
}

function templatePath(kind, internalRoot) {
  // W-1（返工轮 2·主控裁决内部参数制）：DOCGEN_TEMPLATE_ROOT/DOCGEN_TEMPLATE_FIXTURE 两 env
  // 无条件忽略（齐全也不生效）；唯一注入面=--__selftest-template-root 内部专用参数
  const name = kind === 'close' ? 'close-summary.md' : 'gates-summary.md'
  if (internalRoot) return join(internalRoot, name)
  return join(SKILL_ROOT, 'templates', name)
}

function buildSections(kind, projectDir, rawSections) {
  const slots = KIND_SLOTS[kind]
  const parsed = []
  for (const raw of rawSections) {
    const eq = raw.indexOf('=')
    if (eq <= 0) throw new ContentError(`--section 形态须 <slot>=<报告路径>#<标题>：${raw}`)
    const slot = raw.slice(0, eq)
    if (!slots.includes(slot)) throw new ContentError(`未知/越类槽位：${slot}（kind=${kind} 闭集=${slots.join('/')}）`)
    const rest = raw.slice(eq + 1)
    const hash = rest.lastIndexOf('#')
    if (hash <= 0 || hash === rest.length - 1) throw new ContentError(`--section 缺路径或标题：${raw}`)
    const path = rest.slice(0, hash), title = rest.slice(hash + 1)
    parsed.push({ slot, normPath: resolve(projectDir, path), path: resolve(projectDir, path), title })
  }
  const bySlot = new Map()
  for (const s of parsed) {
    if (bySlot.has(s.slot)) throw new ContentError(`槽位重复：${s.slot}（各槽恰一次）`)
    bySlot.set(s.slot, s)
  }
  for (const slot of slots) if (!bySlot.has(slot)) throw new ContentError(`槽位缺位：${slot}（kind=${kind} 闭集=${slots.join('/')} 各恰一次）`)
  return [...bySlot.values()].sort((a, b) => a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : a.normPath < b.normPath ? -1 : a.normPath > b.normPath ? 1 : a.title < b.title ? -1 : a.title > b.title ? 1 : 0)
}

function runGenerate(args, check) {
  const kind = args['--kind']
  // N-4（返工轮 2）：原型键守卫——Object.hasOwn 拒 constructor 等原型链键（防越检后崩溃退 3）
  if (kind === undefined || !Object.hasOwn(KIND_SLOTS, kind)) usageExit(`--kind 取值须 close|gates（收到「${kind}」——原型链键同拒）`)
  const projectDir = resolve(args['--project'])
  if (!existsSync(projectDir)) redExit(`项目目录不存在：${projectDir}`)
  const date = args['--date']
  if (!checkDate(date)) redExit(`日期非法或缺失（须 YYYY-MM-DD 且本地往返一致）：${date ?? '(缺)'}`)
  const output = resolve(args['--output'])
  const sections = buildSections(kind, projectDir, args['--section'])
  const tp = templatePath(kind, args['--__selftest-template-root'])
  if (!existsSync(tp)) configExit(`模板缺失：${tp}`)
  const tpl = readFileSync(tp, 'utf8')
  const extracted = {}
  for (const s of sections) {
    if (!existsSync(s.path)) throw new ContentError(`源报告路径缺位：${s.path}`)
    extracted[s.slot] = extractSection(readFileSync(s.path, 'utf8'), s.title)
    if (s.slot === 'summary') assertNoVerdictLine(extracted[s.slot], s.slot)
  }
  const body = render(tpl, {
    batch: args['--batch'], authority: args['--authority'], date,
    supersedes: args['--supersedes'], change_anchor: args['--change-anchor'],
  }, extracted)
  if (check) {
    if (!existsSync(output)) redExit(`--check 目标不存在：${output}`)
    const cur = readFileSync(output)
    if (!cur.equals(Buffer.from(body, 'utf8'))) { console.error('[判红] --check 重算与现有文件不一致（正文手改/模板未再生成/源抽取变化之一）'); process.exit(EXIT_RED) }
    console.log(`close-summary --check 一致：${output}（kind=${kind}）`)
    return
  }
  if (existsSync(output)) throw new ContentError(`目标已存在，生成模式禁覆盖：${output}`)
  atomicNewWrite(output, body)
  console.log(`close-summary 已生成：${output}（kind=${kind} 槽位=${KIND_SLOTS[kind].join('/')}）`)
}

// ── --self-test：固定快照驱动，真 CLI 子进程，逐项打印 case=<name> exit=<真值> ──
function selfTest() {
  const fxPath = join(SKILL_ROOT, 'scripts', '.golden', 'docgen-fixtures.json')
  if (!existsSync(fxPath)) configExit(`固定快照缺失：${fxPath}`)
  let fx
  try { fx = JSON.parse(readFileSync(fxPath, 'utf8')) } catch (e) { configExit(`固定快照不可解析：${e.message}`) }
  const tmp = mkdtempSync(join(tmpdir(), 'gen-close-st-'))
  let allOk = true
  const note = (ok, label) => { if (!ok) allOk = false; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`) }
  try {
    const proj = join(tmp, 'proj')
    mkdirSync(join(proj, 'docs', 'evidence'), { recursive: true })
    for (const [rel, content] of Object.entries(fx.sources)) {
      const p = join(proj, rel)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, content, 'utf8')
    }
    const outA = join(tmp, 'close-out'), outB = join(tmp, 'gates-out'), outC = join(tmp, 'shuffle-out'), negOut = join(tmp, 'neg-out'), outP = join(tmp, 'plit-out')
    for (const d of [outA, outB, outC, negOut, outP]) mkdirSync(d, { recursive: true })
    // W-1：非变异子进程显式清除外来继承的模板根/配对键——私有夹具通道仅变异用例可携带
    const baseEnv = { ...process.env }
    delete baseEnv.DOCGEN_TEMPLATE_ROOT
    delete baseEnv.DOCGEN_TEMPLATE_FIXTURE
    const run = (args, env = baseEnv) => spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', env, timeout: 60_000 })
    const subst = (args) => args.map((a) => a.replace(/@PROJECT@/g, proj).replace(/@OUT_CLOSE@/g, join(outA, 'fx-close.md')).replace(/@OUT_GATES@/g, join(outB, 'fx-gates.md')).replace(/@OUT_SHUFFLE@/g, join(outC, 'fx-close.md')).replace(/@OUT_NEG@/g, negOut).replace(/@OUT_PLIT@/g, join(outP, 'fx-plit.md')))
    let mutRootClose = null
    for (const c of fx.self_test_cases['gen-close-summary']) {
      let extraArgs = []
      if (c.mutate_template) {
        const dir = join(tmp, 'mut-templates')
        mkdirSync(dir, { recursive: true })
        const name = c.mutate_template.file
        const prod = readFileSync(join(SKILL_ROOT, 'templates', name), 'utf8')
        if (!prod.includes(c.mutate_template.from)) { note(false, `夹具变异锚缺失：${name}:${c.mutate_template.from}`); continue }
        writeFileSync(join(dir, name), prod.replace(c.mutate_template.from, c.mutate_template.to), 'utf8')
        if (mutRootClose === null) mutRootClose = dir
        extraArgs = ['--__selftest-template-root', dir]
      }
      const r = run([...subst(c.args), ...extraArgs], baseEnv)
      const code = r.status === null ? 124 : r.status
      console.log(`case=${c.name} exit=${code}`)
      if (code !== c.expected_exit) allOk = false
    }
    // W-1（返工轮 2）env 双键负例：外部设两 env 跑普通生成仍用生产模板根（字节=生产期望）
    {
      const outE = join(tmp, 'envneg-out')
      mkdirSync(outE, { recursive: true })
      const rEnv = run(subst(fx.self_test_cases['gen-close-summary'].find((c) => c.name === 'close-p1-close-generate').args).map((a) => a.replace(join(outA, 'fx-close.md'), join(outE, 'fx-close.md'))), { ...baseEnv, DOCGEN_TEMPLATE_ROOT: mutRootClose, DOCGEN_TEMPLATE_FIXTURE: '1' })
      note(rEnv.status === 0 && readFileSync(join(outE, 'fx-close.md')).equals(Buffer.from(fx.expected.close, 'utf8')) && mutRootClose !== null, 'W-1 env 双键负例（两 env 齐全仍用生产模板根，产物=生产期望字节）')
    }
    const closeOut = join(outA, 'fx-close.md'), gatesOut = join(outB, 'fx-gates.md'), shuffleOut = join(outC, 'fx-close.md'), plitOut = join(outP, 'fx-plit.md')
    if (!existsSync(closeOut) || !existsSync(gatesOut) || !existsSync(shuffleOut) || !existsSync(plitOut)) { note(false, '正例产物缺席（先修正例再跑对照）'); return allOk }
    note(readFileSync(closeOut).equals(Buffer.from(fx.expected.close, 'utf8')), '快照期望字节一致（fixture.expected.close）')
    note(readFileSync(gatesOut).equals(Buffer.from(fx.expected.gates, 'utf8')), '快照期望字节一致（fixture.expected.gates）')
    note(readFileSync(closeOut).equals(readFileSync(shuffleOut)), '输入乱序一致（正序 ↔ 逆序逐字节相同）')
    // W-6 源文隔离断言：details 源文字面量 {{summary}} 原样保留、未被占位替换
    note(readFileSync(plitOut, 'utf8').includes('{{summary}}'), '源文隔离（W-6）：源文字面量占位形原样保留')
    const before = readFileSync(closeOut)
    const rc = run(subst(fx.self_test_cases['gen-close-summary'].find((c) => c.name === 'close-p1-close-generate').args).concat(['--check']))
    note(rc.status === 0 && readFileSync(closeOut).equals(before), '--check 一致（close 内存重算逐字节相同且未写回）')
    // W-3：gates 正例 --check 补入（断言未写回）
    const beforeG = readFileSync(gatesOut)
    const rg = run(subst(fx.self_test_cases['gen-close-summary'].find((c) => c.name === 'close-p2-gates-generate').args).concat(['--check']))
    note(rg.status === 0 && readFileSync(gatesOut).equals(beforeG), 'gates --check 一致（W-3：内存重算逐字节相同且未写回）')
    // 固定快照两次生成逐字节一致：干净目录重跑 close 正例比对
    const outD = join(tmp, 'rerun-out')
    mkdirSync(outD, { recursive: true })
    const rerun = run(subst(fx.self_test_cases['gen-close-summary'].find((c) => c.name === 'close-p1-close-generate').args).map((a) => a.replace(join(outA, 'fx-close.md'), join(outD, 'fx-close.md'))))
    note(rerun.status === 0 && readFileSync(join(outD, 'fx-close.md')).equals(readFileSync(closeOut)), '固定快照两次生成逐字节一致（outA↔outD）')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  return allOk
}

const argv = process.argv.slice(2)
const ARG_SPEC = { value: ['--kind', '--project', '--date', '--batch', '--authority', '--change-anchor', '--supersedes', '--output', '--__selftest-template-root'], bool: ['--check', '--self-test'], multi: ['--section'] }
// N-1：--self-test 不绕过参数检查——先按同源 parseArgs 校验（未知/重复/等号/空值=用法错）再进自检
try {
  parseArgs(argv, ARG_SPEC)
  if (argv.includes('--self-test')) process.exit(selfTest() ? EXIT_OK : EXIT_RED)
  const args = parseArgs(argv, ARG_SPEC)
  // W-2：--section 纳入必填（完全缺失=exit 1）
  for (const req of ['--kind', '--project', '--date', '--batch', '--authority', '--change-anchor', '--supersedes', '--output', '--section']) if (args[req] === undefined) usageExit(`缺必填参数：${req}`)
  runGenerate(args, args['--check'] === 1)
} catch (e) {
  if (e instanceof UsageError) usageExit(e.message)
  if (e instanceof ContentError) redExit(e.message)
  if (e instanceof Error && e.code === 'ENOENT') configExit(`装载失败：${e.message}`)
  console.error(`[fatal] ${e.message}`)
  process.exit(EXIT_CONFIG)
}
