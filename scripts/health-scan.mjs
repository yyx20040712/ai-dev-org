/**
 * 组织健康扫描（ai-dev-org 烤验机关——W4）：扫流水+账本，输出三类告警，
 * 纯本地零派发。收口前必跑（SKILL.md 烤验触发表；未过不得收口）。
 *   RED（阻断——exit 1）：①欠账未还（exhaust 后同项目无补还 ok 行）
 *     ②预算超限（给了阈值且超）；③连续同源（窗口内审计成功全部同源
 *     且批数 ≥3——异构对抗退化，关键批语义下升级）
 *   INFO：各源用量汇总（in/out 累计+最近 7 天）——无阈值时的配给判断输入
 * 用法：node scripts/health-scan.mjs [--project <dir>] [--ledger <path>]
 *       [--window N] [--budget <alias>:<maxOutTokens>[,…]]
 * 退出码：0=无 RED；1=有 RED；3=配置错误（文件缺失/格式坏）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { SKILL_ROOT } from './org-config.mjs'

const LOG_PATH = join(SKILL_ROOT, 'scripts', 'model-routing-log.jsonl')
const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const projectDir = flag('--project') || process.cwd()
const windowN = Number(flag('--window') || 20)
if (!Number.isInteger(windowN) || windowN <= 0) { console.error(`FAIL --window 须为正整数（收到 ${flag('--window')}）`); process.exit(3) }
const budgetSpec = flag('--budget')
let ledgerPath = flag('--ledger') || join(projectDir, '.zcode', 'org-ledger.jsonl')

const readLines = (path) => {
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean).map((l, i) => { try { return JSON.parse(l) } catch { return { unparseable: `行${i + 1}: ${l.slice(0, 80)}` } } })
}
const routing = readLines(LOG_PATH)
const ledger = readLines(ledgerPath)
if (!routing) { console.error(`FAIL 流水不存在 ${LOG_PATH}——先跑一次派发或回归演练`); process.exit(3) }
if (!ledger) { console.error(`FAIL 账本不存在 ${ledgerPath}（--project/--ledger 指定）`); process.exit(3) }
for (const e of [...routing, ...ledger]) if (e.unparseable) { console.error(`FAIL 数据行解析失败 ${e.unparseable}`); process.exit(3) }

const RED = [], WARN = [], INFO = []
const fmt = (n) => (n == null ? '?' : n.toLocaleString('en-US'))

// ── ① 欠账未还：exhaust 行后同 project 是否存在补还 ok ──
// project 匹配=账本行 project 字段**同名精确匹配**（调用方异名/缺名会分裂
// 分组——W5 审 ds-N2：约束文档化于此，不做 basename 归一以防过度合并）
const byProject = {}
let unnamed = 0
for (const e of ledger) {
  if (e.event !== 'ok' && e.event !== 'switch' && e.event !== 'exhaust') continue
  const p = e.project
  if (!p) { unnamed++; continue } // 无名行不参与欠账判定（防跨项目假补还——Kimi-B3）
  ;(byProject[p] ||= []).push(e)
}
if (unnamed) WARN.push(`账本存在 ${unnamed} 行无 project 字段——已排除出欠账判定（防串项目）；补齐 project 后重扫`)
for (const [p, rows] of Object.entries(byProject)) {
  rows.sort((a, b) => (a.ts < b.ts ? -1 : 1))
  const lastExhaustIdx = rows.map((e) => e.event).lastIndexOf('exhaust')
  if (lastExhaustIdx === -1) continue
  const repaid = rows.slice(lastExhaustIdx + 1).some((e) => e.event === 'ok')
  if (!repaid) RED.push(`欠账未还：项目 ${p} 存在 exhaust（${rows[lastExhaustIdx].ts.slice(0, 10)}）且其后无补还 ok 行——按 06 §4 回退只读审并计划补还，连续两个关键批未补还=升级用户`)
  else INFO.push(`项目 ${p}：exhaust 后已补还（ok ${rows.slice(lastExhaustIdx + 1).find((e) => e.event === 'ok').ts.slice(0, 10)}）`)
}

// ── ② 连续同源：窗口内 ok 行（账本）的 source 单一化 ──
// RED 判据=窗口全同源 且 ok≥3 且 跨≥3 个日期批（同日多次=单批多次调用，
// 非多批退化——W5 审 Kimi-B2 名实对齐）；同源高占比=绕过形态前兆（Kimi-W1/ds-N1）
const oks = ledger.filter((e) => e.event === 'ok').slice(-windowN)
if (oks.length >= 3) {
  const sources = [...new Set(oks.map((e) => String(e.source).split('→').pop()))]
  const runs = new Set(oks.map((e) => e.ts.slice(0, 10))).size
  if (sources.length === 1 && runs >= 3) {
    RED.push(`连续同源：尾窗 ${oks.length} 次 ok 全部落 ${sources[0]}（跨 ${runs} 个日期批）——异构对抗退化；关键批（受锁/安全/数据/回炉二轮起）须换异源或记欠账呈报`)
  } else if (sources.length === 1 && runs < 3) {
    INFO.push(`尾窗 ${oks.length} 次 ok 全同源（${sources[0]}）但仅跨 ${runs} 个日期批——未达退化线，关注后续批次源多样性`)
  } else {
    const counts = sources.map((s) => [s, oks.filter((e) => String(e.source).split('→').pop() === s).length]).sort((a, b) => b[1] - a[1])
    if (oks.length >= 5 && counts[0][1] / oks.length > 0.8) WARN.push(`尾窗 ${oks.length} 次 ok 中 ${counts[0][0]} 占 ${counts[0][1]} 次（>${Math.round((counts[0][1] / oks.length) * 100)}%）——异源仅点缀存在，多样性可能是绕过形态`)
    else INFO.push(`尾窗 ok 源分布：${sources.join('/')}`)
  }
}

// ── ②b ok 行缺 usage=数据质量缺陷（不静默——W5 审 ds-W7） ──
const noUsage = ledger.filter((e) => e.event === 'ok' && !e.usage).length
if (noUsage) WARN.push(`账本存在 ${noUsage} 行 ok 缺 usage 字段——预算累计会低估，修复记账后重扫`)

// ── ③ 预算：--budget alias:maxOutTokens（无阈值=仅 INFO 汇总） ──
const usage = {}
for (const e of ledger) {
  if (e.event !== 'ok' || !e.usage) continue
  const src = String(e.source).split('→').pop()
  usage[src] ||= { in: 0, out: 0, calls: 0 }
  usage[src].in += e.usage.in || 0
  usage[src].out += e.usage.out || 0
  usage[src].calls++
}
for (const [src, u] of Object.entries(usage)) INFO.push(`用量 ${src}：${u.calls} 次 ok，累计 in=${fmt(u.in)} out=${fmt(u.out)}`)
if (budgetSpec) {
  for (const part of budgetSpec.split(',')) {
    const m = /^([^:]+):(\d+)$/.exec(part.trim())
    if (!m) { console.error(`FAIL --budget 形态 <alias>:<maxOutTokens>，收到 ${part}`); process.exit(3) }
    const [, alias, cap] = m
    const u = usage[alias]
    if (u && u.out > Number(cap)) RED.push(`预算超限：${alias} 累计 out=${fmt(u.out)} > 阈值 ${fmt(Number(cap))}——停止该源投放，按换源状态机（06 §4）处置并如实记账`)
    else INFO.push(`预算 ${alias}：out=${fmt(u?.out || 0)}/${fmt(Number(cap))}${u ? '' : '（未使用该源）'}`)
  }
}

// ── 输出 ──
const W = process.stdout.write.bind(process.stdout)
for (const r of RED) W(`[RED] ${r}\n`)
for (const w of WARN) W(`[WARN] ${w}\n`)
for (const i of INFO) W(`[info] ${i}\n`)
console.log(`health-scan 汇总：RED ×${RED.length}（项目 ${Object.keys(byProject).length} 个/账本行 ${ledger.length}/流水行 ${routing.length}/窗口 ${windowN}）${RED.length ? '——有 RED 不得收口' : '——可收口'}`)
process.exit(RED.length ? 1 : 0)
