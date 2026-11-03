/**
 * 组织健康扫描（ai-dev-org 强制检查机关——W4；2026-09-14 优化批扩 ④⑤+重构为可测）。
 * 扫流水+账本，输出告警，纯本地零派发。结项前必跑（SKILL.md 对抗链触发表）。
 *   RED（阻断——exit 1）：
 *     ①未清事项（exhaust 后同项目无补还 ok；跳过 mocked 行与临时演练项目）
 *     ④审计产出截断（audit_surface 岗 ok 行 truncated=true——假成功，P0-2/W-3）
 *     ②连续同源（窗口内审计 ok 全同源且跨≥3 日期批）
 *     ③预算超限（给了阈值且超）
 *   WARN（不阻断，但摘要强制回显计数——W-1 升格条件）：
 *     ⑤设计链同源（drafter 与 auditor 同源——02 §8.6；W-8 降级待归因）
 *     cfg 漂移；ok 缺 usage / in=0 而 out>0（缓存未计）；单源占比超阈（配给禁止项）；
 *     漏网缺陷登记（escaped-defect 人工行——selfiter 批 manual-event-consumers 接线）
 *   INFO：各源用量汇总；审计 findings verdict 分布（selfiter 批 findings-parser）；
 *     人工事件计数（ruling/doc-health 等 R4 MANUAL_EVENTS 同集）
 * 用法：node scripts/health-scan.mjs [--project <dir>] [--ledger <path>]
 *       [--window N] [--budget <alias>:<maxOutTokens>[,…]] [--self-test]
 * 退出码口径单源=references/06 §5.8（此处不复写数字=语义映射，防双源漂移
 * ——evolve 批 b8 指针化）。
 */
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { SKILL_ROOT, loadOrgConfig, cfgHash, readJsonlFile, cliFlag, UsageError, ledgerPathFor, familyOf, parseHistoricalImplreviewSlot } from './org-config.mjs'

const normPath = (p) => {
  let s = String(p || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  try { s = realpathSync(s).replace(/[\\/]+/g, '/') } catch { /* 路径不存在（历史项目）→ 用字面值 */ }
  return s.toLowerCase()
}
const TMP_NORM = normPath(tmpdir())
const isDrillProject = (p) => !!p && normPath(p).startsWith(TMP_NORM)

/** 主控人工补记事件词表（单源导出——regression R4 账本 schema 校验同集消费；
 *  v2.0.1 修复批 L14：原两文件逐字复制=新增事件类型漏改一侧即漂移）。 */
export const MANUAL_EVENTS = new Set(['porting-delta', 'doc-health', 'ruling', 'constitution-overrun', 'escaped-defect', 'stopped']) // stopped=接续演练/被杀岗手记

/**
 * 纯函数扫描核心（可注入 fixtures——B-1 要求的回归用例挂此）。
 * @returns {{RED:string[],WARN:string[],INFO:string[]}}
 */
export function scan({ ledger, merged, windowN = 20, budgetSpec = null, liveCfg = null }) {
  const auditRoles = new Set(Object.entries(merged.roles || {}).filter(([, c]) => c.audit_surface).map(([id]) => id))
  // ⑥ FINDINGS 执法面独立派生（escaped-defect ② 修复批 2026-09-19）：原挂
  // audit_surface 一标志双语义——④截断执法要覆盖长推理拟定岗、⑥尾栏执法
  // 只该管 DoD 含 FINDINGS 尾栏的岗，误把无尾栏 DoD 的 drafter 拉进 ⑥=永久误 RED
  const findingsRoles = new Set(Object.entries(merged.roles || {}).filter(([, c]) => c.findings_surface).map(([id]) => id))
  const thresholds = merged.thresholds || {}
  const RED = [], WARN = [], INFO = []
  // ── implreview-split 批 D-4：双审默认族 tripwire（推荐项执法面——validate 结构校验不拦同族）──
  // 一号默认族 × 二号默认族同族＝RED；任一侧 slot/provider/family 不可解析＝fail-closed RED。
  {
    const famOfDefaultRole = (role) => {
      const name = merged?.agent_defaults?.[role]
      const def = typeof name === 'string' ? merged?.agent_slots?.[name] : null
      const prov = def && typeof def.provider === 'string' ? merged?.providers?.[def.provider] : null
      return prov ? (familyOf(prov) || '') : ''
    }
    const fRev1 = famOfDefaultRole('implreview1')
    const fRev2 = famOfDefaultRole('implreview2')
    if (!fRev1 || !fRev2)
      RED.push(`双审默认族不可解析（implreview1=${fRev1 || '?'} implreview2=${fRev2 || '?'}）——两键默认档位或其 provider/family 缺失，fail-closed 不放行（拆席 D-4）`)
    else if (fRev1 === fRev2)
      RED.push(`双审默认同族（implreview1=${fRev1} implreview2=${fRev2}）——执行者审核两席须不同模型族（拆席 D-4；agent-slots doctor D6 同款推荐项面）`)
  }
  // ── implreview-split 批 D-6：历史 role 读侧归一——旧合并键 implreview 行只作历史审核域
  //    计数披露（INFO），不参与现役岗计数/执法；旧槽名识别单源=parseHistoricalImplreviewSlot。 ──
  {
    const histReviewRows = ledger.filter((e) => e.role === 'implreview').length
    if (histReviewRows)
      INFO.push(`历史审核域行 ×${histReviewRows}（role=implreview 旧合并键——读侧归一为历史审核域，不参与现役岗计数；旧槽名 ops-implreview-<provider>-<level> 由 log-triage/--slots 识别为历史审核席并保留 provider/level）`)
  }
  const fmt = (n) => (n == null ? '?' : n.toLocaleString('en-US'))

  // ── ① 未清事项（跳过 mocked 行与临时演练项目——W-2 / P0-1）──
  // 分组键归一化（selfiter B4 project-id-migration）：project_id || project
  // （v3 行携归一化 id；v2 历史行/手工行 raw 名——跨名同项目自 v3 起并账。
  // 代码审查（岗）返工 N1：注释算子与代码对齐——①④两处同用 ||，project_id 空串按回退处理）
  const byProject = {}
  let unnamed = 0, mockedRows = 0
  const drillProjects = new Set()
  for (const e of ledger) {
    if (e.event !== 'ok' && e.event !== 'switch' && e.event !== 'exhaust') continue
    if (e.mocked === true) { mockedRows++; continue }
    const p = e.project_id || e.project
    if (!p) { unnamed++; continue }
    if (isDrillProject(p)) { drillProjects.add(p); continue }
    ;(byProject[p] ||= []).push(e)
  }
  if (unnamed) WARN.push(`账本存在 ${unnamed} 行无 project 字段——已排除出未清事项判定（防串项目）；补齐 project 后重扫`)
  if (mockedRows) INFO.push(`账本跳过 ${mockedRows} 行 mocked=true（演练行——源头甄别，不参与未清事项/同源判定）`)
  if (drillProjects.size) INFO.push(`账本跳过 ${drillProjects.size} 个临时演练项目（os.tmpdir() 前缀——P0-1 判据）：${[...drillProjects].join(' / ')}`)
  for (const [p, rows] of Object.entries(byProject)) {
    rows.sort((a, b) => (a.ts < b.ts ? -1 : 1))
    const lastExhaustIdx = rows.map((e) => e.event).lastIndexOf('exhaust')
    if (lastExhaustIdx === -1) continue
    const repaid = rows.slice(lastExhaustIdx + 1).some((e) => e.event === 'ok')
    if (!repaid) RED.push(`未清事项：项目 ${p} 存在 exhaust（${rows[lastExhaustIdx].ts.slice(0, 10)}）且其后无补还 ok 行——按 06 §4 回退只读审并计划补还，连续两个关键批未补还=升级用户`)
    else INFO.push(`项目 ${p}：exhaust 后已补还（ok ${rows.slice(lastExhaustIdx + 1).find((e) => e.event === 'ok').ts.slice(0, 10)}）`)
  }

  // ── ④ 审计产出截断（P0-2/W-3）——仅判含 truncated 字段的行，历史行豁免（08 §3）──
  // 不继承 tmpdir 豁免（W-5）：截断判定与 project 位置无关。auditRoles 从 org-config 派生（W-4）。
  // 分组键归一化=project_id ?? project（v2.0.1 修复批 L11：对齐 ① 的 B4 归一化口径——
  // 原只按 raw project 分组，v3 迁移期跨 raw 名同 id 项目的截断告警会拆组失真）。
  const truncRows = ledger.filter((e) => e.event === 'ok' && e.truncated === true && auditRoles.has(e.role))
  const truncByProject = {}
  for (const e of truncRows) { const p = e.project_id || e.project || '(无名)'; (truncByProject[p] ||= []).push(e) }
  for (const [p, rows] of Object.entries(truncByProject)) {
    const roles = [...new Set(rows.map((r) => r.role))].join('/')
    RED.push(`审计产出截断：项目 ${p} 存在 ${rows.length} 笔 ok-truncated（角色 ${roles}，来源 ${[...new Set(rows.map((r) => r.source))].join('/')}）——非完整终态被当合格审计收下（假成功）；按 02 §5 返工/切换承载源重审，勿据截断报告下结论`)
  }
  const schema1Rows = ledger.filter((e) => e.event === 'ok' && e.truncated === undefined).length
  if (schema1Rows) INFO.push(`账本 ${schema1Rows} 行无 truncated 字段（schema v1 历史行）——④ 对历史行豁免，其覆盖率为已知未清事项`)

  // ── ② 连续同源 ──
  const oks = ledger.filter((e) => e.event === 'ok').slice(-windowN)
  if (oks.length >= 3) {
    const sources = [...new Set(oks.map((e) => String(e.source).split('→').pop()))]
    const runs = new Set(oks.map((e) => e.ts.slice(0, 10))).size
    if (sources.length === 1 && runs >= 3) {
      RED.push(`连续同源：尾窗 ${oks.length} 次 ok 全部落 ${sources[0]}（跨 ${runs} 个日期批）——不同模型族对抗退化；关键批（受锁/安全/数据/返工二轮起）须换异源或记未清事项汇报`)
    } else if (sources.length === 1 && runs < 3) {
      INFO.push(`尾窗 ${oks.length} 次 ok 全同源（${sources[0]}）但仅跨 ${runs} 个日期批——未达退化线，关注后续批次源多样性`)
    } else {
      const share = thresholds.source_share_warn ?? 0.8
      const counts = sources.map((s) => [s, oks.filter((e) => String(e.source).split('→').pop() === s).length]).sort((a, b) => b[1] - a[1])
      if (oks.length >= 5 && counts[0][1] / oks.length > share) WARN.push(`单源占比：尾窗 ${oks.length} 次 ok 中 ${counts[0][0]} 占 ${counts[0][1]} 次（>${Math.round(share * 100)}%）——异源仅点缀，配给禁止项可能失守；重盘投放面（06 §3）`)
      else INFO.push(`尾窗 ok 源分布：${sources.join('/')}`)
    }
  }

  // ── ⑤ 设计链同源（W-8：降 WARN 待归因） ──
  const sameChain = {}
  for (const e of ledger) {
    if (e.event !== 'ok') continue
    if (e.role !== 'drafter' && e.role !== 'auditor-readonly') continue
    const k = `${e.ts.slice(0, 10)}|${e.project || ''}`
    ;(sameChain[k] ||= {})[e.role] = String(e.source).split('→').pop()
  }
  for (const [k, v] of Object.entries(sameChain)) {
    if (v.drafter && v['auditor-readonly'] && v.drafter === v['auditor-readonly'])
      WARN.push(`设计链同源：${k} 的 drafter 与 auditor-readonly 同落 ${v.drafter}——02 §8.6 要求不同模型族对抗（Kimi 拟定/deepseek 审核）；须切换承载源或记未清事项（W-8 降级：待归因完成再议 RED）`)
  }

  // ── ②b 数据质量 ──
  const noUsage = ledger.filter((e) => e.event === 'ok' && !e.usage).length
  if (noUsage) WARN.push(`账本存在 ${noUsage} 行 ok 缺 usage 字段——预算累计会低估，修复记账后重扫`)
  const zeroIn = ledger.filter((e) => e.event === 'ok' && e.usage && (e.usage.in === 0 || e.usage.in == null) && (e.usage.out || 0) > 0).length
  if (zeroIn) WARN.push(`账本存在 ${zeroIn} 行 in=0 而 out>0——疑缓存命中未计（cache_read_input_tokens 未并），预算累计低估（P2-5）`)

  // ── ③ 预算 ──
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
      if (!m) throw new UsageError(`--budget 形态 <alias>:<maxOutTokens>，收到 ${part}（v2.0.1 修复批 L10：用法/参数错族——CLI 按 1 退，原普通 Error 落 FAIL+3 与家族口径不一致）`)
      const [, alias, cap] = m
      const u = usage[alias]
      if (u && u.out > Number(cap)) RED.push(`预算超限：${alias} 累计 out=${fmt(u.out)} > 阈值 ${fmt(Number(cap))}——停止该源投放，按切换承载源状态机（06 §4）处置并如实记账`)
      else INFO.push(`预算 ${alias}：out=${fmt(u?.out || 0)}/${fmt(Number(cap))}${u ? '' : '（未使用该源）'}`)
    }
  }

  // ── P2-6 cfg 漂移 ──
  const lastCfg = [...ledger].reverse().find((e) => e.cfg_hash)?.cfg_hash
  if (liveCfg && lastCfg && lastCfg !== liveCfg) WARN.push(`cfg 漂移：账本末行 cfg_hash=${lastCfg} ≠ 当前 ${liveCfg}——供应商事实已变（源序/套餐/配给），需重盘投放面并核对旧批次结论（P2-6）`)

  // ── ⑥ FINDINGS 机读尾栏执法+汇总（selfiter 批 findings-parser 接线；
  // 修复批 2026-09-19 执法面拆挂 findings_surface——见 scan() 头注） ──
  // 截止时点后 findings_surface 岗（DoD 含 FINDINGS 尾栏契约——gate1-reviewer
  // PASS|FAIL / auditor-readonly 放行|有条件放行|返工）真实 ok 行（非 mocked）
  // 缺 findings 字段=DoD 机读尾栏契约失守（RED——防「无尾栏假审计」与解析
  // 失配静默）；截止前存量行豁免（08 §3 不追认）；带 findings 行汇总 verdict
  // 分布与 B/W/N 累计（INFO——verdict 词表含中文，分布键原样计数不归一拼写）。
  // 返工 W3 修正：时点比较=Date.parse 数值（原字符串比较对带毫秒 ts 存在
  // '.'<'Z' 边界——截止整秒内行被静默豁免）；不可解析/缺失 ts=保守豁免
  const FINDINGS_CUTOFF_MS = Date.parse('2026-09-17T12:00:00Z')
  let auditRows = 0, auditNoFindings = 0
  const verdictDist = {}, findingsSum = { B: 0, W: 0, N: 0 }
  for (const e of ledger) {
    if (e.event !== 'ok' || e.mocked === true) continue
    if (!findingsRoles.has(e.role)) continue
    const tMs = Date.parse(e.ts)
    if (Number.isNaN(tMs) || tMs < FINDINGS_CUTOFF_MS) continue
    auditRows++
    const f = e.findings
    if (!f || typeof f !== 'object') { auditNoFindings++; continue }
    verdictDist[f.verdict] = (verdictDist[f.verdict] || 0) + 1
    findingsSum.B += f.B || 0; findingsSum.W += f.W || 0; findingsSum.N += f.N || 0
  }
  if (auditNoFindings) RED.push(`审计行缺机读 FINDINGS 解析字段 ×${auditNoFindings}/${auditRows}（DoD 契约：审出件末栏「FINDINGS: B= W= N= VERDICT=」——findings-parser 执法；缺=尾栏未带或解析失配，人工核对审出件）`)
  else if (auditRows) INFO.push(`审计 findings 汇总：${auditRows} 行，verdict 分布=${JSON.stringify(verdictDist)}，累计 B=${findingsSum.B}/W=${findingsSum.W}/N=${findingsSum.N}`)

  // ── ⑦ 人工事件消费+漏网缺陷率（selfiter 批 manual-event-consumers 接线） ──
  // 写入面=主控手工行（R4 MANUAL_EVENTS 同集）；escaped-defect=门禁放行后缺陷
  // 登记（WARN 如实点名）+漏网缺陷率粗口径（INFO——批次级归因仍人工）。
  // v2.0.1 修复批 L14：集合单源从本件导出（regression R4 消费——原两处逐字
  // 复制，新增人工事件类型漏改一侧即规范↔实现矛盾，本文件注释里登记过一次前科）。
  const manualCount = {}
  for (const e of ledger) { if (MANUAL_EVENTS.has(e.event)) manualCount[e.event] = (manualCount[e.event] || 0) + 1 }
  const manualKeys = Object.keys(manualCount)
  if (manualKeys.length) INFO.push(`人工事件计数：${manualKeys.map((k) => `${k}×${manualCount[k]}`).join(' ')}`)
  const escaped = ledger.filter((e) => e.event === 'escaped-defect')
  if (escaped.length) {
    WARN.push(`漏网缺陷登记 ×${escaped.length}（escaped-defect——门禁放行后发现的缺陷，主控手工入账）：${escaped.slice(-3).map((e) => `${String(e.ts || '').slice(0, 10)} ${String(e.outcome || '').slice(0, 60)}`).join('；')}${escaped.length > 3 ? '…' : ''}`)
    const realOk = ledger.filter((e) => e.event === 'ok' && e.mocked !== true).length
    INFO.push(`漏网缺陷率粗口径=${realOk ? (escaped.length / realOk).toFixed(3) : '?'}（escaped ${escaped.length}/真实 ok ${realOk}——批次级归因仍人工）`)
  }

  return { RED, WARN, INFO }
}

// ── 自检（B-1 要求配回归用例；纯 fixture 注入，不读真实文件） ──
function selfTest(merged) {
  const cases = []
  const t = (name, cond, detail = '') => cases.push({ name, pass: !!cond, detail })
  const base = { event: 'ok', role: 'gate1-reviewer', source: 'kimi-main', tier: 'audit', cfg_hash: 'X', usage: { in: 1, out: 1 }, truncated: false }
  // ①a mocked 行跳过：exhaust+mocked 不触发 RED
  const a1 = scan({ ledger: [{ ...base, ts: '2026-01-01T00:00:00Z', project: '/real/p', event: 'exhaust' }, { ...base, ts: '2026-01-02T00:00:00Z', project: '/real/p', mocked: true }], merged })
  t('mocked 行不参与未清事项（仍 RED，因无真补还）', a1.RED.some((r) => r.includes('未清事项')))
  const a2 = scan({ ledger: [{ ...base, ts: '2026-01-01T00:00:00Z', project: '/real/p', event: 'exhaust' }, { ...base, ts: '2026-01-02T00:00:00Z', project: '/real/p' }], merged })
  t('真补还 ok → 无未清事项 RED', !a2.RED.some((r) => r.includes('未清事项')))
  // ①b 临时演练项目跳过（P0-1 核心：这是原 RED 的成因）
  const drill = join(tmpdir(), 'r5-abc123')
  const a3 = scan({ ledger: [{ ...base, ts: '2026-01-01T00:00:00Z', project: drill, event: 'exhaust' }], merged })
  t('临时目录演练项目跳过（无未清事项 RED）', !a3.RED.some((r) => r.includes('未清事项')), drill)
  t('临时项目跳过有 INFO 留痕', a3.INFO.some((i) => i.includes('临时演练项目')))
  // ④ 截断 → RED；历史行（无字段）豁免
  const a4 = scan({ ledger: [{ ...base, ts: '2026-02-01T00:00:00Z', project: '/real/p', truncated: true }], merged })
  t('审计岗 truncated=true → RED', a4.RED.some((r) => r.includes('审计产出截断')))
  const a5 = scan({ ledger: [{ ...base, ts: '2026-02-01T00:00:00Z', project: '/real/p', truncated: undefined }], merged })
  t('无 truncated 字段历史行 → ④ 豁免', !a5.RED.some((r) => r.includes('审计产出截断')))
  const a6 = scan({ ledger: [{ ...base, ts: '2026-02-01T00:00:00Z', project: '/real/p', truncated: true, role: 'design-reviewer' }], merged })
  t('非 audit_surface 岗截断 → 不 RED（W-4 派生清单生效）', !a6.RED.some((r) => r.includes('审计产出截断')))
  // 修复批（2026-09-19 findings-surface 拆分）向量：④⑥ 两执法面各归各标志
  const a6b = scan({ ledger: [{ ...base, ts: '2026-02-01T00:00:00Z', project: '/real/p', truncated: true, role: 'drafter' }], merged })
  t('drafter 截断（④ audit_surface 面）→ 仍 RED（拆标志不弱化截断执法）', a6b.RED.some((r) => r.includes('审计产出截断')))
  // ⑤ 设计链同源 → WARN
  const a7 = scan({ ledger: [{ ...base, ts: '2026-03-01T00:00:00Z', project: '/real/p', role: 'drafter', source: 'deepseek' }, { ...base, ts: '2026-03-01T00:01:00Z', project: '/real/p', role: 'auditor-readonly', source: 'deepseek' }], merged })
  t('设计链同源 → WARN', a7.WARN.some((w) => w.includes('设计链同源')))
  // cfg 漂移 → WARN
  const a8 = scan({ ledger: [{ ...base, ts: '2026-04-01T00:00:00Z', project: '/real/p' }], merged, liveCfg: 'NEWHASH' })
  t('cfg 漂移 → WARN', a8.WARN.some((w) => w.includes('cfg 漂移')))
  // selfiter 批（findings-parser/manual-event-consumers）向量
  const f1 = scan({ ledger: [{ ...base, ts: '2026-09-18T00:00:00Z', project: '/real/p', findings: { B: 1, W: 2, N: 3, verdict: 'PASS' } }], merged })
  t('审计行带 findings → 无缺栏 RED+INFO 汇总', !f1.RED.some((r) => r.includes('缺机读 FINDINGS')) && f1.INFO.some((i) => i.includes('verdict 分布')))
  const f2 = scan({ ledger: [{ ...base, ts: '2026-09-18T00:00:00Z', project: '/real/p' }], merged })
  t('截止后审计行缺 findings → RED（DoD 机读尾栏执法）', f2.RED.some((r) => r.includes('缺机读 FINDINGS')))
  // 修复批（2026-09-19 findings-surface 拆分）向量：⑥ 只挂 findings_surface 岗
  const f2d = scan({ ledger: [{ ...base, ts: '2026-09-18T00:00:00Z', project: '/real/p', role: 'drafter' }], merged })
  t('drafter（audit_surface 但 DoD 无尾栏）缺 findings → 不 RED（escaped-defect ② 回归）', !f2d.RED.some((r) => r.includes('缺机读 FINDINGS')))
  const f2e = scan({ ledger: [{ ...base, ts: '2026-09-18T00:00:00Z', project: '/real/p', role: 'auditor-readonly' }], merged })
  t('auditor-readonly（findings_surface）缺 findings → RED（执法不松）', f2e.RED.some((r) => r.includes('缺机读 FINDINGS')))
  const f2f = scan({ ledger: [{ ...base, ts: '2026-09-18T00:00:00Z', project: '/real/p', role: 'auditor-readonly', findings: { B: 0, W: 0, N: 1, verdict: '返工' } }], merged })
  t('中文 verdict（返工）行正常汇总不触发缺栏', !f2f.RED.some((r) => r.includes('缺机读 FINDINGS')) && f2f.INFO.some((i) => i.includes('返工')))
  const f3 = scan({ ledger: [{ ...base, ts: '2026-09-01T00:00:00Z', project: '/real/p' }], merged })
  t('截止前存量审计行豁免（08 §3 不追认）', !f3.RED.some((r) => r.includes('FINDINGS')))
  // 返工 W3 向量：截止整秒内带毫秒行（字符串比较会因 '.'<'Z' 误豁免——数值比较纠正）
  const f3b = scan({ ledger: [{ ...base, ts: '2026-09-17T12:00:00.500Z', project: '/real/p' }], merged })
  t('W3 截止整秒内带毫秒行=截止后（执法不漏）', f3b.RED.some((r) => r.includes('缺机读 FINDINGS')))
  const f4 = scan({ ledger: [{ ...base, ts: '2026-09-18T00:00:00Z', project: '/real/p', mocked: true }], merged })
  t('mocked 演练行不触发 findings 执法', !f4.RED.some((r) => r.includes('FINDINGS')))
  const f5 = scan({ ledger: [{ ...base, ts: '2026-09-18T00:00:00Z', project: '/real/p', event: 'escaped-defect', outcome: 'W 批漏网样例', usage: undefined }], merged })
  t('escaped-defect 行 → WARN 漏网缺陷登记+人工事件 INFO', f5.WARN.some((w) => w.includes('漏网缺陷登记')) && f5.INFO.some((i) => i.includes('人工事件计数')))
  // selfiter 批（B4 project-id-migration）向量：归一化分组
  const f6 = scan({ ledger: [
    { ...base, ts: '2026-05-01T00:00:00Z', project: 'raw-a', project_id: 'pid-1', event: 'exhaust' },
    { ...base, ts: '2026-05-02T00:00:00Z', project: 'raw-b', project_id: 'pid-1' },
  ], merged })
  t('B4 project_id 归一化：跨 raw 名同 id 并账=已补还（无未清事项 RED）', !f6.RED.some((r) => r.includes('未清事项')))
    // ── implreview-split 批 D-4/D-6 向量：双审默认族 RED＋历史读侧归一（合成 merged 夹具：
    //    roles 分区注入 audit_surface/findings_surface 覆盖两新审核键；不改既有 20 向量） ──
    const irMerged = (rev2Prov) => ({
      roles: { 'gate1-reviewer': { audit_surface: true }, 'auditor-readonly': { findings_surface: true }, implreview1: { audit_surface: true }, implreview2: { findings_surface: true } },
      providers: { kimisyn: { model_family: 'kimi' }, kimi2syn: { model_family: 'kimi' }, deepsyn: { model_family: 'deepseek' } },
      agent_slots: {
        'ops-executor-kimisyn-high': { provider: 'kimisyn', model: 'm', level: 'high' },
        'ops-implreview1-kimi2syn-max': { provider: 'kimi2syn', model: 'm', level: 'max' },
        'ops-implreview2-deepsyn-max': { provider: 'deepsyn', model: 'm', level: 'max' },
        'ops-implreview2-kimi2syn-max': { provider: 'kimi2syn', model: 'm', level: 'max' },
        'ops-adjudicator-deepsyn-max': { provider: 'deepsyn', model: 'm', level: 'max' },
      },
      agent_defaults: {
        executor: 'ops-executor-kimisyn-high',
        implreview1: 'ops-implreview1-kimi2syn-max',
        implreview2: rev2Prov === 'deep' ? 'ops-implreview2-deepsyn-max' : 'ops-implreview2-kimi2syn-max',
        adjudicator: 'ops-adjudicator-deepsyn-max',
      },
    })
    const hDsame = scan({ ledger: [], merged: irMerged('kimi') })
    const hDdiff = scan({ ledger: [], merged: irMerged('deep') })
    t('D-4 双审默认族：合成 roles 覆盖两新键＋二号默认与一号同族→恰一条 RED 点名两键', hDsame.RED.length === 1 && hDsame.RED[0].includes('双审默认同族') && hDsame.RED[0].includes('implreview1') && hDsame.RED[0].includes('implreview2'))
    t('D-4 双审默认族：两键异族（kimi vs deepseek）→零 RED（推荐项面不误报）', hDdiff.RED.length === 0)
    const hDfc = irMerged('deep')
    delete hDfc.agent_defaults.implreview2
    const hDfcOut = scan({ ledger: [], merged: hDfc })
    t('D-4 双审默认族：二号默认缺失→fail-closed RED（不静默通过）', hDfcOut.RED.length === 1 && hDfcOut.RED[0].includes('双审默认族不可解析') && hDfcOut.RED[0].includes('implreview2'))
    const hHist = scan({ ledger: [{ ...base, ts: '2026-10-01T00:00:00Z', project: '/real/p', role: 'implreview' }, { ...base, ts: '2026-10-02T00:00:00Z', project: '/real/p', role: 'implreview' }], merged })
    t('D-6 历史读侧归一：旧合并键 role=implreview 行→INFO 历史审核域（不参与现役岗计数）', hHist.INFO.some((i) => i.includes('历史审核域') && i.includes('×2')) && hHist.RED.length === 0)
    t('D-6 历史审核席识别：旧槽名单源识别 provider/level 保留、新键不误判', parseHistoricalImplreviewSlot('ops-implreview-ds-max')?.seat === '历史审核席' && parseHistoricalImplreviewSlot('ops-implreview-ds-max')?.provider === 'ds' && parseHistoricalImplreviewSlot('ops-implreview-ds-max')?.level === 'max' && parseHistoricalImplreviewSlot('ops-implreview1-ds-max') === null && parseHistoricalImplreviewSlot('ops-implreview2-ds-max') === null)
  const fail = cases.filter((c) => !c.pass)
  for (const c of cases) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`)
  console.log(`health-scan 自检：${cases.length - fail.length}/${cases.length} 过`)
  return fail.length === 0
}

// ── CLI（isMain guard=v2.0.1 修复批：MANUAL_EVENTS 导出供 regression 消费，
//     import 零副作用——范式 ds-call-v2/glm-look；flag 解析收编 org-config cliFlag
//     单源=修复批 M4：原裸 argv[i+1] 误吃下一 flag（如 --project --ledger →
//     projectDir='--ledger'），家族 g3 批已定性缺陷的漏网副本） ──
function cliMain() {
  const argv = process.argv.slice(2)
  let projectDir, windowRaw, budgetSpec, ledgerFlag
  try {
    projectDir = cliFlag(argv, '--project') || process.cwd()
    windowRaw = cliFlag(argv, '--window')
    budgetSpec = cliFlag(argv, '--budget')
    ledgerFlag = cliFlag(argv, '--ledger')
  } catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
    throw e
  }
  const windowN = Number(windowRaw || 20)
  if (!Number.isInteger(windowN) || windowN <= 0) { console.error(`[用法错] --window 须为正整数（收到 ${windowRaw}）`); process.exit(1) } // 用法错=1（06 §5.8 行 1——修复批 L10：原退 3 与家族口径不一致）
  // B1/D-8 账本路径三层单源（ledgerPathFor）：--ledger 显式参 > merged ledger_path 相对项目根 > join 兜底
  const { merged } = loadOrgConfig(projectDir)
  const ledgerPath = ledgerPathFor(projectDir, ledgerFlag, merged)
  if (argv.includes('--self-test')) { process.exitCode = selfTest(merged) ? 0 : 1; return } // 自然退出（代码审查（岗）返工 W1：自检 PASS/FAIL 行亦 stdout 产物——急退同形禁）

  // R3 常设双审对同族 tripwire（2026-09-22 三岗批；返工 W5a/W2 收紧）：
  // standing_pair 两源 model_family 必须异族——同族=不同模型族对抗静默退化（已登记事故：
  // 代码审查（岗）双审同为 Kimi K3 双配额数周，无人报警烧额度）。缺失 standing_pair 键
  // =绊线被静默拆除（默认件深合并只增不减，缺席即人为删除）——同样 FAIL；
  // 任一源缺 model_family=校验不可构成，fail-closed 不放行（返工 W2：原双条件
  // 短路=静默通过）。配置面校验在账本检查之前；绑定实况面=log-triage --health ⑧。
  {
    const sp = merged.source_health?.standing_pair
    const famRaw = (a) => merged.providers?.[a]?.model_family
    const fam = (a) => (famRaw(a) == null ? undefined : String(famRaw(a)).trim().toLowerCase() || undefined) // 返工 N8：归一化比较
    if (!Array.isArray(sp) || sp.length !== 2) { console.error('FAIL source_health.standing_pair 缺失或非二元数组（常设双审对 tripwire 被移除=静默退化通道，R3）——修 org-config'); process.exit(3) }
    const unknown = sp.filter((a) => !merged.providers?.[a])
    if (unknown.length) { console.error(`FAIL source_health.standing_pair 引用未声明 provider：${unknown.join(',')}——修 org-config`); process.exit(3) }
    if (!fam(sp[0]) || !fam(sp[1])) { console.error(`FAIL 常设双审对任一源缺 model_family（${sp[0]}=${famRaw(sp[0]) ?? '缺'}，${sp[1]}=${famRaw(sp[1]) ?? '缺'}）——异族校验不可构成，fail-closed（R3 返工 W2）`); process.exit(3) }
    if (fam(sp[0]) === fam(sp[1])) { console.error(`FAIL 常设双审对同模型族（${sp[0]}=${fam(sp[0])}，${sp[1]}=${fam(sp[1])}）——不同模型族对抗已退化，改绑定或修 org-config（R3）`); process.exit(3) }
  }

  const LOG_PATH = join(SKILL_ROOT, 'scripts', 'model-routing-log.jsonl')
  // 读行器收敛=org-config readJsonlFile 单源（v1.6 批 P2-3）；保留原「缺失=null」语义（下游 FAIL 分支依赖）
  const readLines = (p) => (existsSync(p) ? readJsonlFile(p) : null)
  const ledger = readLines(ledgerPath)
  if (!existsSync(LOG_PATH)) { console.error(`FAIL 流水不存在 ${LOG_PATH}——先跑一次派发或回归演练`); process.exit(3) }
  if (!ledger) { console.error(`FAIL 账本不存在 ${ledgerPath}（--project/--ledger 指定）`); process.exit(3) }
  for (const e of ledger) if (e.unparseable) { console.error(`FAIL 数据行解析失败 ${e.unparseable}`); process.exit(3) }
  const routingLines = readLines(LOG_PATH).length

  let out
  try { out = scan({ ledger, merged, windowN, budgetSpec, liveCfg: cfgHash(merged) }) }
  catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) } // --budget 形态错=用法错（修复批 L10：原 FAIL+3）
    console.error(`FAIL ${e.message}`); process.exit(3)
  }
  const W = process.stdout.write.bind(process.stdout)
  for (const r of out.RED) W(`[RED] ${r}\n`)
  for (const w of out.WARN) W(`[WARN] ${w}\n`)
  for (const i of out.INFO) W(`[info] ${i}\n`)
  const auditRoles = Object.entries(merged.roles || {}).filter(([, c]) => c.audit_surface).map(([id]) => id)
  const findingsRoles = Object.entries(merged.roles || {}).filter(([, c]) => c.findings_surface).map(([id]) => id)
  console.log(`health-scan 汇总：RED ×${out.RED.length} / WARN ×${out.WARN.length}（WARN 不阻断但须回显计数，累计出现即按升格条件处置，W-1）（账本行 ${ledger.length}/流水行 ${routingLines}/窗口 ${windowN}/截断执法岗 ${auditRoles.join(',')}/findings 执法岗 ${findingsRoles.join(',')}）${out.RED.length ? '——有 RED 不得结项' : '——可结项'}`)
  process.exitCode = out.RED.length ? 1 : 0 // 自然退出（代码审查（岗）返工 W1 双源收敛：RED/WARN 行经 W() 在途即急退=M1 同族漏网——大账本下告警行可达数十条）
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) cliMain()
