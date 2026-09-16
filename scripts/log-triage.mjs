#!/usr/bin/env node
/**
 * log-triage —— 观测面分诊工具（B-0 批，2026-09-16；A'③ source-health=--health 子命令）。
 * 两账并呈（05 §七增补二）：zcode 客户端日志 ~/.zcode/cli/log/zcode-*.jsonl（内链路）
 * + 派发器流水 scripts/model-routing-log.jsonl（外链路）。
 * 功能：
 *   ①五类分诊：配额限流(429/403)/服务端过载(5xx)/网关窗口(504+超长时延)/传输层(网络错)/配置错(400/401/404)
 *   ②attempt 分布（客户端重试放大统计——maxAttempts=11 噪声源）
 *   ③静默回退检测：~/.zcode/cli/agents/＜会话＞/＜代理＞/metadata.json 声明绑定 vs 日志实际 model 归因
 *     （声明值非 <uuid|builtin:…>/<model> 形态=疑似枚举假绑定；声明≠实际=静默回退）
 *     比较口径=精确串匹配（保守方向：假 RED 优于假绿，承 W-3 白名单反转哲学）——版本化
 *     别名形态（如 <model>-YYYYMMDD 快照）暂不支持，出现即按回退上报人工复核（审核 W-2）。
 *   ⑥岗×源用量汇总（含 Kimi 双源分列——org-ledger 补记数据源）
 *   ⑦finish 终态派生（子代理通道截断信号——保守口径，词表读 org-config finish_vocab）
 *   --health：源健康检查（A'③）——按供应商五类分诊 → k1/k2 推荐+分类处置建议
 *     （额度类→换源；504 窗口类→不换源、瘦身——zipoo 同端点共模，05 §九纠偏②）
 * 用法：node scripts/log-triage.mjs [--date YYYY-MM-DD | --hours N] [--health] [--self-test]
 * 退出码：0=正常；1=发现 RED 级事项（静默回退检出）；3=配置错/自检失败。
 * 纪律：finish 词表与供应商别名住 org-config（禁硬编码，A3/06 §0）；自然退出（HOST-node25 规避）。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { loadOrgConfig, cfgHash } from './org-config.mjs'

const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI_LOG_DIR = join(homedir(), '.zcode', 'cli', 'log')
const AGENTS_DIR = join(homedir(), '.zcode', 'cli', 'agents')
const ROUTING_LOG = join(SKILL_ROOT, 'scripts', 'model-routing-log.jsonl')

const readJsonl = (p) => {
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean)
    .map((l, i) => { try { return JSON.parse(l) } catch { return { unparseable: `行${i + 1}: ${l.slice(0, 60)}` } } })
}

// ── 供应商别名解析：providerId(或 uuid) → org-config alias ──
const buildAliasMap = (providers) => {
  const m = new Map()
  for (const [alias, p] of Object.entries(providers || {})) {
    if (p.uuid_prefix) m.set(p.uuid_prefix, alias)
  }
  return m
}
const aliasOf = (providerId, aliasMap) => {
  if (!providerId) return '(未知源)'
  for (const [prefix, alias] of aliasMap) if (providerId.startsWith(prefix)) return alias
  return providerId // builtin:… 等宿主源原样显示
}

// ── ① 五类分诊核心（纯函数，可注入 fixture） ──
export function classifyError({ statusCode, reason, statusMessage, providerMessage, durationMs }) {
  const code = Number(statusCode) || 0
  const msg = `${statusMessage || ''} ${providerMessage || ''} ${reason || ''}`.toLowerCase()
  if (code === 429 || /rate.?limit|quota|配额|too many requests/.test(msg)) return 'quota'      // 配额限流
  if (code === 504 || (code === 0 && /timeout|timed? ?out/.test(msg) && (durationMs || 0) > 240_000)) return 'window' // 网关窗口
  if (code >= 500 || /overload|internal server|bad gateway|service unavailable/.test(msg)) return 'server'           // 服务端过载
  if (/econnreset|econnrefused|fetch failed|socket|network|dns|tls/.test(msg)) return 'transport' // 传输层
  if (code === 400 || code === 401 || code === 403 || code === 404 || /invalid.*key|not found|unauthorized|forbidden/.test(msg)) return 'config' // 配置错
  return 'other'
}
const CLASS_NAMES = { quota: '配额限流(429/403)', window: '网关窗口(504/超长时延)', server: '服务端过载(5xx)', transport: '传输层(网络错)', config: '配置错(400/401/404)', other: '未分类' }

// ── 内链路（cli/log）事件收割 ──
function harvestCliLog(lines, aliasMap, sinceTs) {
  const perProvider = {}   // alias -> {ok, err:{class:n}, lat:[], attempts:{}}
  const subagentNet = {}   // sessionId -> {alias, modelId, lastFinish, fails}
  const bump = (alias) => (perProvider[alias] ||= { ok: 0, err: {}, lat: [], attempts: {} })
  for (const d of lines) {
    if (d.unparseable || !d.context) continue
    if (sinceTs && d.timestamp && d.timestamp < sinceTs) continue
    const c = d.context
    const ev = d.event
    if (ev === 'model.network.completed' || ev === 'model.network.failed') {
      const alias = aliasOf(c.providerId, aliasMap)
      const sid = d.sessionId || ''
      if (sid.startsWith('sess_subagent_agent_')) {
        const rec = (subagentNet[sid] ||= { alias, providerId: c.providerId, modelId: c.modelId, lastFinish: null, fails: 0 })
        rec.alias = alias; rec.providerId = c.providerId; rec.modelId = c.modelId
        if (ev === 'model.network.completed') rec.lastFinish = c.finishReason || null
        else rec.fails++
      }
      if (ev === 'model.network.completed') {
        bump(alias).ok++
        if (typeof d.durationMs === 'number') bump(alias).lat.push(d.durationMs)
        const a = c.attempt || 1
        bump(alias).attempts[a] = (bump(alias).attempts[a] || 0) + 1
      } else {
        const cls = classifyError({ statusCode: c.providerCode, reason: c.reason, statusMessage: c.statusMessage || d.message, providerMessage: c.providerMessage, durationMs: d.durationMs })
        bump(alias).err[cls] = (bump(alias).err[cls] || 0) + 1
      }
    }
    // request.failed 兜底（network 事件缺码时补一腿）
    if (ev === 'model.request.failed' && !d._dup) {
      const alias = aliasOf(c.providerId, aliasMap)
      const cls = classifyError({ statusCode: c.providerCode, reason: c.reason, statusMessage: c.statusMessage, providerMessage: c.providerMessage, durationMs: d.durationMs })
      bump(alias).err[cls] = (bump(alias).err[cls] || 0) + 1
    }
  }
  return { perProvider, subagentNet }
}

// ── 外链路（model-routing-log）收割 ──
function harvestRouting(rows, sinceTs) {
  const out = { attempts: {}, ok: {}, exhaust: {}, switch: {} }
  for (const r of rows) {
    if (r.unparseable) continue
    if (sinceTs && r.ts && r.ts < sinceTs) continue
    const src = r.source || r.chain || '(链尽)'
    if (r.event === 'attempt') out.attempts[src] = (out.attempts[src] || 0) + 1
    if (r.event === 'ok') out.ok[src] = (out.ok[src] || 0) + 1
    if (r.event === 'exhaust') {
      const cls = classifyError({ statusCode: r.statusCode, statusMessage: r.error, durationMs: r.latencyMs })
      const isMock = r.mocked === true || /\(mock\)/i.test(String(r.error || '')) // 首选 dispatcher mocked 标志位（N-1：真实 429 无该标志不会误剔）；括号串匹配仅兜旧版行
      out.exhaust[src] = out.exhaust[src] || []
      out.exhaust[src].push({ ts: r.ts, statusCode: r.statusCode, cls, error: r.error, runId: r.runId, role: r.role_id, isMock })
    }
    if (r.event === 'switch') out.switch[r.runId] = { ts: r.ts, from: r.source, error: r.error }
  }
  return out
}

// ── ③③ 静默回退检测：metadata 声明 vs 日志实际 ──
const VALID_MODEL_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|builtin:[^\s/]+)\/[^\s/]+$/
export function detectSilentFallback({ metas, subagentNet }) {
  const findings = []
  for (const m of metas) {
    const declared = m?.profileSnapshot?.model || null
    const sid = m?.childSessionId
    if (!declared) continue // 无 model 字段=宿主默认，非绑定岗
    if (!VALID_MODEL_RE.test(declared)) {
      findings.push({ level: 'RED', profile: m.profileId, sid, declared, actual: subagentNet[sid] ? `${subagentNet[sid].alias}/${subagentNet[sid].modelId}` : '(无请求)', kind: '疑似枚举/伪值（静默回退宿主）' })
      continue
    }
    const act = subagentNet[sid]
    if (!act) { findings.push({ level: 'WARN', profile: m.profileId, sid, declared, actual: '(窗口内无请求记录)', kind: '无可核对请求' }); continue }
    // 声明的供应商段（uuid 或 builtin:…）须与实际 providerId 一致；模型段须与 modelId 一致
    const [declaredProv, declaredModel] = declared.split('/')
    const match = (act.providerId === declaredProv || act.alias === declaredProv) && act.modelId === declaredModel
    if (!match) findings.push({ level: 'RED', profile: m.profileId, sid, declared, actual: `${act.alias}/${act.modelId}`, kind: '静默回退（声明≠实际路由）' })
  }
  return findings
}

// ── ⑥⑦ 子代理面：metadata（用量+终态）──
function harvestAgents(sinceTs) {
  const metas = []
  if (!existsSync(AGENTS_DIR)) return metas
  for (const sess of readdirSync(AGENTS_DIR)) {
    const sdir = join(AGENTS_DIR, sess)
    try {
      for (const ag of readdirSync(sdir)) {
        const mf = join(sdir, ag, 'metadata.json')
        if (!existsSync(mf)) continue
        const m = JSON.parse(readFileSync(mf, 'utf8'))
        if (sinceTs && m.createdAt && m.createdAt < sinceTs) continue
        metas.push(m)
      }
    } catch { /* 目录竞争态：跳过 */ }
  }
  return metas
}

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }

// ── 主流程 ──
const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const now = new Date()
const hours = Number(flag('--hours') || 0)
const dateStr = flag('--date') || (hours > 0 ? null : now.toISOString().slice(0, 10))
const sinceTs = hours > 0 ? new Date(now.getTime() - hours * 3600_000).toISOString() : (dateStr ? `${dateStr}T00:00:00` : null)

const { merged } = loadOrgConfig(SKILL_ROOT)
const aliasMap = buildAliasMap(merged.providers)

// 自检（--self-test）：fixture 级断言
if (argv.includes('--self-test')) {
  const t = (name, cond) => console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`)
  t('429→quota', classifyError({ statusCode: 429 }) === 'quota')
  t('504→window', classifyError({ statusCode: 504 }) === 'window')
  t('500→server', classifyError({ statusCode: 500 }) === 'server')
  t('401→config', classifyError({ statusCode: 401 }) === 'config')
  t('ECONNRESET→transport', classifyError({ statusMessage: 'fetch failed: ECONNRESET' }) === 'transport')
  t('枚举值判定（sonnet 非 <uuid>/<model> 形态）', !VALID_MODEL_RE.test('sonnet'))
  t('合法绑定形态（uuid/model）', VALID_MODEL_RE.test('8ad55776-2296-4f1a-bc46-05755c8f1300/deepseek-flash'))
  t('合法绑定形态（builtin:model/key）', VALID_MODEL_RE.test('builtin:bigmodel-coding-plan/GLM-5.3'))
  const fb = detectSilentFallback({
    metas: [{ profileId: 'probe-b-x', childSessionId: 's1', profileSnapshot: { model: 'sonnet' } },
            { profileId: 'probe-c-x', childSessionId: 's2', profileSnapshot: { model: '8ad55776-2296-4f1a-bc46-05755c8f1300/deepseek-flash' } }],
    subagentNet: { s2: { alias: 'deepseek', providerId: '8ad55776-2296-4f1a-bc46-05755c8f1300', modelId: 'deepseek-flash', lastFinish: 'end_turn', fails: 0 } },
  })
  t('probe-b 假绑定可被 ③ 抓出（RED+枚举）', fb.length === 1 && fb[0].level === 'RED' && fb[0].kind.includes('枚举'))
  process.exitCode = fb.length === 1 ? 0 : 1
} else {
  // 收割两账
  const logFiles = dateStr ? [`zcode-${dateStr}.jsonl`] : readdirSync(CLI_LOG_DIR).filter(f => /^zcode-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-2)
  const cliLines = logFiles.flatMap(f => readJsonl(join(CLI_LOG_DIR, f)))
  const { perProvider, subagentNet } = harvestCliLog(cliLines, aliasMap, sinceTs)
  const routing = harvestRouting(readJsonl(ROUTING_LOG), sinceTs)
  const metas = harvestAgents(sinceTs)
  const W = process.stdout.write.bind(process.stdout)

  // ③ 静默回退检测（全时段 metadata——历史探针也要盯）
  const fallbacks = detectSilentFallback({ metas: harvestAgents(null), subagentNet })

  if (argv.includes('--health')) {
    // ── A'③ 源健康检查：kimi 双源分诊 + k1/k2 推荐 ──
    W(`== 源健康检查（窗口=${dateStr || `近 ${hours}h`}，cfg:${cfgHash(merged)}）==\n`)
    const kimiClasses = { kimiMain: {}, kimiBackup: {} }
    for (const [alias, st] of Object.entries(perProvider)) {
      W(`[${alias}] ok=${st.ok} err=${JSON.stringify(st.err)} lat p50/p95=${pct(st.lat, .5)}/${pct(st.lat, .95)}ms attempts=${JSON.stringify(st.attempts)}\n`)
      if (alias === 'kimi-main') kimiClasses.kimiMain = st.err
      if (alias === 'kimi-backup') kimiClasses.kimiBackup = st.err
    }
    W(`-- 外链路（派发器）exhaust 明细：\n`)
    let window504 = 0, quotaCls = 0, mockN = 0
    for (const [src, list] of Object.entries(routing.exhaust)) {
      for (const e of list) {
        W(`   ${e.ts} ${src} statusCode=${e.statusCode} [${CLASS_NAMES[e.cls] || e.cls}] ${e.error}（run=${e.runId} role=${e.role}）${e.isMock ? '【mock 演练行，不计入推荐】' : ''}\n`)
        if (e.isMock) { mockN++; continue }
        if (e.cls === 'window') window504++
        if (e.cls === 'quota') quotaCls++
      }
    }
    if (mockN) W(`   （另检出 mock 演练行 ×${mockN}——R5 换源演练注入，不构成真实源健康信号）\n`)
    if (!Object.keys(routing.exhaust).length) W(`   （窗口内无 exhaust 事件）\n`)
    // 推荐（05 §九纠偏②：504=同端点共模不换源；额度类=换源）
    let rec, why
    if (quotaCls > 0) { rec = 'k2（ops-gate1-k2）'; why = `窗口内检出额度类失效 ×${quotaCls}——换源有效（zipoo=不同配额池）` }
    else if (window504 > 0) { rec = 'k1（ops-gate1-k1，不换源）'; why = `窗口内检出 504 窗口类 ×${window504}——zipoo 与 kimi-main 同端点共模，换源无效；处置=审包瘦身/流式化（05 §九纠偏②）` }
    else { rec = 'k1（ops-gate1-k1）'; why = '窗口内 kimi 双源零额度/窗口类失效——按链首选源' }
    W(`\n>> 门一派发推荐：${rec}\n>> 依据：${why}\n`)
  } else {
    // ── B-0 全量分诊 ──
    W(`== log-triage 分诊（内链路 ${logFiles.join(',')} ×${cliLines.length} 行 + 外链路流水；窗口=${dateStr || `近 ${hours}h`}）==\n`)
    W(`-- ①⑤ 按供应商：ok/错误五类/时延/attempt 分布\n`)
    for (const [alias, st] of Object.entries(perProvider)) {
      const errs = Object.entries(st.err).map(([k, v]) => `${CLASS_NAMES[k]}×${v}`).join(' ') || '零错误'
      W(`   [${alias}] ok=${st.ok} | ${errs} | lat p50/p95=${pct(st.lat, .5)}/${pct(st.lat, .95)}ms | attempts=${JSON.stringify(st.attempts)}\n`)
    }
    W(`-- ② 外链路（派发器流水）attempt/ok/exhaust/switch 计数：\n`)
    W(`   attempts=${JSON.stringify(routing.attempts)} ok=${JSON.stringify(routing.ok)}\n`)
    for (const [src, list] of Object.entries(routing.exhaust)) for (const e of list) W(`   exhaust ${e.ts} ${src} ${e.statusCode}[${CLASS_NAMES[e.cls]}] ${e.error} run=${e.runId} role=${e.role}\n`)
    // ③ 静默回退检测
    W(`-- ③③ 静默回退检测（子代理声明绑定 vs 实际路由，metadata×${harvestAgents(null).length} 份）：\n`)
    if (!fallbacks.length) W('   零检出（全部声明=实际，或无绑定岗）\n')
    for (const f of fallbacks) W(`   [${f.level}] ${f.profile} ${f.sid?.slice(0, 30)}… 声明=${f.declared} 实际=${f.actual} —— ${f.kind}\n`)
    // ⑥ 岗×源用量（Kimi 双源分列）
    W(`-- ⑥ 岗×源用量汇总（子代理 metadata，org-ledger 补记数据源；Kimi 双源分列）：\n`)
    const byRole = {}
    for (const m of metas) {
      const role = m.profileId || '?'
      const alias = subagentNet[m.childSessionId]?.alias || '(宿主默认)'
      const u = m.usage || {}
      byRole[role] ||= {}
      const k = `${role}|${alias}`
      byRole[k] = byRole[k] || { calls: 0, in: 0, out: 0 }
      byRole[k].calls++; byRole[k].in += u.inputTokens || 0; byRole[k].out += u.outputTokens || 0
    }
    for (const [k, v] of Object.entries(byRole).sort()) W(`   ${k.replace('|', ' @ ')}: calls=${v.calls} in=${v.in} out=${v.out}\n`)
    // ⑦ finish 终态派生（保守口径）
    const fv = (merged.finish_vocab || {})
    const completeSet = new Set(fv.complete || ['end_turn', 'stop', 'stop_sequence'])
    const truncSet = new Set(fv.truncation || ['max_tokens', 'length'])
    W(`-- ⑦ 子代理 finish 终态派生（词表=org-config finish_vocab；未知终态=非完整·保守口径）：\n`)
    for (const m of metas) {
      const net = subagentNet[m.childSessionId]
      const fin = net?.lastFinish
      const stat = m.status
      let verdict = '未知（无网络事件）'
      if (completeSet.has(fin)) verdict = '完整'
      else if (truncSet.has(fin)) verdict = '截断（truncation 词表命中）'
      else if (fin) verdict = `非完整（finish=${fin}，保守口径）`
      if (stat !== 'completed' || verdict !== '完整') W(`   [注意] ${m.profileId} status=${stat} finish=${fin ?? '-'} → ${verdict}\n`)
    }
    const clean = metas.filter(m => { const f = subagentNet[m.childSessionId]?.lastFinish; return m.status === 'completed' && completeSet.has(f) }).length
    W(`   完整终态 ${clean}/${metas.length}（未列出者=完整）\n`)
    // PostToolUse hook 机制验证（存在性口径）
    W(`-- PostToolUse hook 机制：zcode.cjs 含 PostToolUse/PostToolUseFailure 执行器与 workspace_hooks 信任面（存在性已验）；实弹触发验证=后续批次（登记 RESIDUALS）\n`)
    if (fallbacks.some(f => f.level === 'RED')) process.exitCode = 1
  }
}
