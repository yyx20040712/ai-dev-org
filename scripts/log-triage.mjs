#!/usr/bin/env node
/**
 * log-triage —— 观测面分诊工具（B-0 批，2026-09-16；A'③ source-health=--health 子命令）。
 * 两账并呈（05 §七增补二）：zcode 客户端日志 ~/.zcode/cli/log/zcode-*.jsonl（内链路）
 * + 派发器流水 scripts/model-routing-log.jsonl（外链路）。
 * 功能：
 *   ①五类分诊：配额限流(429/403)/服务端过载(5xx)/网关窗口(504+超长时延)/传输层(网络错)/配置错(400/401/404)
 *   ②attempt 分布（客户端重试放大统计——maxAttempts=11 噪声源）
 *   ③静默回退检测：~/.zcode/cli/agents/＜会话＞/＜代理＞/metadata.json 声明绑定 vs 日志实际 model 归因
 *     （声明值非 <uuid|builtin:…|account:…>/<model> 形态=疑似枚举假绑定——按流量分级：窗口内有请求=RED/
 *     无请求=WARN 档案面问题；声明≠实际=RED 静默回退；已知键形态异常=WARN 格式漂移疑似 tripwire）
 *     比较口径=精确串匹配（保守方向：假 RED 优于假绿，承 W-3 白名单反转哲学）——版本化
 *     别名形态（如 <model>-YYYYMMDD 快照）暂不支持，出现即按回退上报人工复核（审核 W-2）。
 *   ⑥岗×源用量汇总（含 Kimi 双源分列——org-ledger 补记数据源）
 *   ⑦finish 终态派生（子代理通道截断信号——保守口径，词表读 org-config finish_vocab）
 *   --health：源健康检查（A'③）——按供应商五类分诊 → k1/k2 推荐+分类处置建议
 *     （额度类→换源；504 窗口类→不换源、瘦身——第二配额备源同端点共模，05 §九纠偏②）
 * 用法：node scripts/log-triage.mjs [--date YYYY-MM-DD | --hours N] [--health] [--self-test]
 *       （flag 取值一律空格分隔，--x=y 等号形态=用法错拒收——cliFlag 单源立场）
 * 退出码口径单源=references/06 §5.8（此处不复写映射——evolve 批 b8
 * 指针化；回炉 r2 削 b8 残留碎片，本件各类退出均属总表既有类目）。
 * 纪律：finish 词表与供应商别名住 org-config（禁硬编码，A3/06 §0）；自然退出（HOST-node25 规避）。
 * 缺输入显式留痕（selfiter 批 evolve-l9-degrade 清偿）：CLI 日志/派发器流水/
 *   metadata 目录缺失=stderr [info] 行点名后继续——info 级非降级（新机/未派发
 *   =正常态，与 check-hardcode 词表缺失降级 exit 5 分界：彼为扫描能力受损）。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { loadOrgConfig, cfgHash, cliFlag, readJsonlFile, UsageError } from './org-config.mjs'

const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI_LOG_DIR = join(homedir(), '.zcode', 'cli', 'log')
const AGENTS_DIR = join(homedir(), '.zcode', 'cli', 'agents')
const ROUTING_LOG = join(SKILL_ROOT, 'scripts', 'model-routing-log.jsonl')

const readJsonl = readJsonlFile // 行读取器单源（org-config 导出——v1.6 批 P2-3 收敛）

// ── b3（evolve-E2）：--date 校验+窗口 epoch 化（日界口径=UTC，与 CLI 日志文件名现状同口径） ──
export const DATE_FMT_RE = /^\d{4}-\d{2}-\d{2}$/
/** --date 合法性=格式+语义（真实存在的日期）。语义判据=UTC 分量回环：本机 V8
 *  （Node 25）ISO 解析对日溢出回卷（2026-02-30→03-02）而非 NaN，仅判 Invalid/NaN
 *  拒不住坏日向量——须回环比对年/月/日三分量（P-1 向量全过的必要实现）。 */
export function isValidDateStr(s) {
  if (typeof s !== 'string' || !DATE_FMT_RE.test(s)) return false
  const [y, mo, d] = s.split('-').map(Number)
  const t = new Date(`${s}T00:00:00Z`).getTime()
  if (Number.isNaN(t)) return false
  const dt = new Date(t)
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}
/** 窗口解析（纯函数，自检可注入）：--hours 与 --date 同走 epoch ms；
 *  --date 窗=[UTC 零点, 次 UTC 零点)（撤回「本地零点」预案）；--hours 窗=[now−Nh, ∞) 无上界（原状）。
 *  v2.0.1 修复批 M3：--date 与 --hours 互斥（同给=UsageError——原 hours 分支胜出
 *  而展示走 dateStr=假窗、取数走 date 单文件漏跨午夜行，窗口/展示/取数三处互相
 *  矛盾）；--hours 须为正有限数（原 NaN/负数静默退化为「今天」date 窗=与 --date
 *  fail-fast 立场不一致的静默回退面）。 */
export function resolveWindow({ argv, now = new Date() }) {
  const hoursRaw = cliFlag(argv, '--hours')
  const dateArg = cliFlag(argv, '--date') || null
  if (hoursRaw != null && dateArg != null) throw new UsageError('--date 与 --hours 互斥（同给时窗口/展示/取数三处口径分裂——请单选；v2.0.1 修复批 M3）')
  let hours = 0
  if (hoursRaw != null) {
    hours = Number(hoursRaw)
    if (!Number.isFinite(hours) || hours <= 0) throw new UsageError(`--hours 非法值「${hoursRaw}」——须为正数（如 --hours 24；v2.0.1 修复批 M3：原静默退化为当天日期窗）`)
  }
  const dateStr = dateArg || (hours > 0 ? null : now.toISOString().slice(0, 10))
  const dayStart = dateStr ? Date.parse(`${dateStr}T00:00:00Z`) : null
  const sinceMs = hours > 0 ? now.getTime() - hours * 3600_000 : dayStart
  const untilMs = hours > 0 || dayStart === null ? null : dayStart + 86_400_000
  return { hours, dateStr, sinceMs, untilMs }
}
const tsMs = (x) => { const t = Date.parse(x); return Number.isNaN(t) ? null : t }
/** 窗口过滤（epoch ms；不可解析/缺失时间戳行=保留，与原字符串比较口径的保守方向一致）。 */
const inWindow = (t, sinceMs, untilMs) => t === null ? true : !((sinceMs != null && t < sinceMs) || (untilMs != null && t >= untilMs))

/** 缺输入显式留痕（selfiter 批 evolve-l9-degrade 清偿——纯函数，自检可注入 exists）：
 *  CLI 面双形态：date 模式=具体文件（多点全缺才记）；hours 模式=目录级（cliDir
 *  缺失即记——回炉 W1：原 hours 分支 logFiles=[] 致 cliLogPaths 空数组漏留痕，
 *  恰为目标场景）；routing/agents 两面同前。级别=info 非 degraded（新机/未派发
 *  属正常态，退出码不动）。 */
export function missingInputNotes({ cliLogPaths = [], cliDir = null, routingLog = null, agentsDir = null, exists = existsSync }) {
  const notes = []
  if (cliDir && !exists(cliDir)) notes.push(`[info] 输入缺失：${cliDir}（CLI 日志目录——内链路面无数据）`)
  else if (cliLogPaths.length && cliLogPaths.every((p) => !exists(p)))
    notes.push(`[info] 输入缺失：${cliLogPaths[0]}${cliLogPaths.length > 1 ? ` 等 ${cliLogPaths.length} 件` : ''}（CLI 日志——内链路面无数据）`)
  if (routingLog && !exists(routingLog)) notes.push(`[info] 输入缺失：${routingLog}（派发器流水——外链路面无数据）`)
  if (agentsDir && !exists(agentsDir)) notes.push(`[info] 输入缺失：${agentsDir}（子代理 metadata——③⑥⑦ 面无数据）`)
  return notes
}

// ── 供应商别名解析：providerId(或 uuid) → org-config alias ──
const buildAliasMap = (providers) => {
  const m = new Map()
  for (const [alias, p] of Object.entries(providers || {})) {
    if (p?.uuid_prefix) m.set(p.uuid_prefix, alias) // null provider 条目跳过（evolve-E2 b4 守卫——原裸取即 TypeError 崩溃）
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
  // 403=配额族（v2.0.1 修复批 L4：与类目标签「配额限流(429/403)」及派发器 exhaust
  // 实录口径对齐——原代码落 config 分支=标签撒谎；换源处置对坏 key 403 亦为合理解）
  if (code === 429 || code === 403 || /rate.?limit|quota|配额|too many requests/.test(msg)) return 'quota' // 配额限流
  if (code === 504 || (code === 0 && /timeout|timed? ?out/.test(msg) && (durationMs || 0) > 240_000)) return 'window' // 网关窗口
  if (code >= 500 || /overload|internal server|bad gateway|service unavailable/.test(msg)) return 'server'           // 服务端过载
  if (/econnreset|econnrefused|fetch failed|socket|network|dns|tls/.test(msg)) return 'transport' // 传输层
  if (code === 400 || code === 401 || code === 404 || /invalid.*key|not found|unauthorized|forbidden/.test(msg)) return 'config' // 配置错
  return 'other'
}
const CLASS_NAMES = { quota: '配额限流(429/403)', window: '网关窗口(504/超长时延)', server: '服务端过载(5xx)', transport: '传输层(网络错)', config: '配置错(400/401/404)', other: '未分类' }

// ── 内链路（cli/log）事件收割 ──
function harvestCliLog(lines, aliasMap, sinceMs, untilMs) {
  const perProvider = {}   // alias -> {ok, err:{class:n}, lat:[], attempts:{}}
  const subagentNet = {}   // sessionId -> {alias, modelId, lastFinish, fails}
  const netFailRaw = []    // network.failed 原行（同秒判重键用——v1.6 批）
  const reqFailed = []     // request.failed 候选（补一腿，同秒去重后计数——v1.6 批）
  const bump = (alias) => (perProvider[alias] ||= { ok: 0, err: {}, lat: [], attempts: {} })
  for (const d of lines) {
    if (d.unparseable || !d.context) continue
    if (!inWindow(tsMs(d.timestamp), sinceMs, untilMs)) continue
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
        netFailRaw.push(d)
        const cls = classifyError({ statusCode: c.providerCode, reason: c.reason, statusMessage: c.statusMessage || d.message, providerMessage: c.providerMessage, durationMs: d.durationMs })
        bump(alias).err[cls] = (bump(alias).err[cls] || 0) + 1
      }
    }
    // request.failed 兜底（network 事件缺码时补一腿）——原 _dup 标志从未赋值（空设计，A4 删除）；
    // 判重键=sid|iso秒：同秒已有 network.failed 则不重复计数（v1.6 批 C2，防双计污染分诊/推荐）
    if (ev === 'model.request.failed') reqFailed.push({ key: `${d.sessionId || ''}|${(d.timestamp || '').slice(0, 19)}`, d })
  }
  const netFailKeys = new Set(netFailRaw.map((d) => `${d.sessionId || ''}|${(d.timestamp || '').slice(0, 19)}`))
  let deduped = 0
  for (const { key, d } of reqFailed) {
    if (netFailKeys.has(key)) { deduped++; continue }
    const c = d.context
    const alias = aliasOf(c.providerId, aliasMap)
    const cls = classifyError({ statusCode: c.providerCode, reason: c.reason, statusMessage: c.statusMessage, providerMessage: c.providerMessage, durationMs: d.durationMs })
    bump(alias).err[cls] = (bump(alias).err[cls] || 0) + 1
  }
  return { perProvider, subagentNet, deduped }
}

// ── 外链路（model-routing-log）收割 ──
function harvestRouting(rows, sinceMs, untilMs) {
  const out = { attempts: {}, ok: {}, exhaust: {}, switch: {} }
  for (const r of rows) {
    if (r.unparseable) continue
    if (!inWindow(tsMs(r.ts), sinceMs, untilMs)) continue
    const src = r.source || r.chain || '(链尽)'
    if (r.event === 'attempt') out.attempts[src] = (out.attempts[src] || 0) + 1
    if (r.event === 'ok') out.ok[src] = (out.ok[src] || 0) + 1
    if (r.event === 'exhaust') {
      const cls = classifyError({ statusCode: r.statusCode, statusMessage: r.error, durationMs: r.latencyMs })
      const isMock = r.mocked === true || /[(（]\s*mock\s*[)）]/i.test(String(r.error || '')) // 首选 dispatcher mocked 标志位（v1.6 批起 switch/exhaust 行亦携带）；括号串兜底=半角/全角兼容（实陷：全角（mock）漏配致 --health 假信号）
      out.exhaust[src] = out.exhaust[src] || []
      out.exhaust[src].push({ ts: r.ts, statusCode: r.statusCode, cls, error: r.error, runId: r.runId, role: r.role_id, isMock })
    }
    if (r.event === 'switch') {
      // 累积形态（selfiter B4 evolve-m6-runid 清偿——原单值覆盖：同 runId 多次
      // switch 只记末值=换源轨迹截断）。v2.0.1 修复批 M2：收割字段对齐派发器
      // switch 行实况（from/to——原读 r.source 恒 undefined），并补 to 字段供
      // ②段换源轨迹聚合（原「消费面按数组聚合」为未兑现声明=死数据）。
      const rec = { ts: r.ts, from: r.from ?? r.source, to: r.to, error: r.error }
      if (out.switch[r.runId]) out.switch[r.runId].push(rec)
      else out.switch[r.runId] = [rec]
    }
  }
  return out
}

// ── --health 推荐面（纯函数，自检可注入——验收断言=裁决档 C2：mock429×4+真实504 ⇒ 不换源） ──
export function countRealFailures(exhaustLists) {
  let quota = 0, window504 = 0, mockN = 0
  for (const list of Object.values(exhaustLists)) {
    for (const e of list) {
      if (e.isMock) { mockN++; continue }
      if (e.cls === 'window') window504++
      if (e.cls === 'quota') quota++
    }
  }
  return { quota, window504, mockN }
}
export function recommendHealth(cnt, sh = {}) {
  const K1 = sh.primary || '链首选源'
  const K2 = sh.secondary || '备源'
  if (cnt.quota > 0) return { rec: K2, why: `窗口内检出额度类失效 ×${cnt.quota}——换源有效（备源=不同配额池）` }
  if (cnt.window504 > 0) return { rec: `${K1}（不换源）`, why: `窗口内检出 504 窗口类 ×${cnt.window504}——双源同端点共模换源无效；处置=审包瘦身/流式化（批档 subagent-plan 05 §九纠偏②）` }
  return { rec: K1, why: '窗口内双源零额度/窗口类失效——按链首选源' }
}

// ── ③③ 静默回退检测：metadata 声明 vs 日志实际 ──
// 形态：`provider/model` 或 `provider/model$档位`（`$` 后缀=宿主 model 串扩展语法，
// 显式思考档位声明——2026-09-17 宿主 zcode.cjs 实证 parseModelPickerValue；档位段
// 仅格式校验不参与回退比对）；provider 段=uuid / builtin: / account: 三前缀族。
const VALID_MODEL_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|builtin:[^\s/]+|account:[^\s/]+)\/[^\s/]+(?:\$[\w-]+)?$/

/** 代理档案目录（v2.1.0 回炉 W12：⑧/⑧前哨的 agents 目录单源——env ZCODE_AGENTS_DIR
 *  可覆写，与 deploy-check --agents-dir 的定制部署面同构，缺省=宿主惯例路径）。 */
export function agentsDirOf() {
  return process.env.ZCODE_AGENTS_DIR ? resolve(process.env.ZCODE_AGENTS_DIR) : join(homedir(), '.zcode', 'agents')
}

/** 跨门岗对终判纯函数（v2.1.0 回炉 W8：三态单源——'?' 任一侧未解析（不构成异构性
 *  证据，人工核）/ 'WARN' 同族=异构对抗退化形态（07 §4 纪律⑤，申报入档禁静默）/
 *  'ok' 异族成立）。自检可注入向量。 */
export function crossGateVerdict(fa, fb) {
  if (fa === '?' || fb === '?') return '?'
  return fa === fb ? 'WARN' : 'ok'
}
/** 声明绑定值归一（纯函数，自检可注入）：旧格式 profileSnapshot.model 字符串原样
 *  透传；新格式 profileSnapshot.modelSelection 结构体（宿主把 `provider/model$档位`
 *  解析后落 providerId/modelId/options.reasoningLevel——2026-09-17 档位批新会话首验
 *  实证）合成同构字符串。两格式归一后走同一校验/比对路径，勿按格式分叉比较口径。
 *  （盲区根因：③ 原只读 model 字符串——新格式绑定岗被静默跳过=检测面恰好漏掉
 *  自己要盯的对象，本会话 k1 真实派发暴露，随批清偿。） */
export function declaredModelOf(profileSnapshot) {
  if (!profileSnapshot) return null
  const m = profileSnapshot.model
  if (typeof m === 'string' && m) return m
  const sel = profileSnapshot.modelSelection
  if (sel && typeof sel === 'object' && typeof sel.providerId === 'string' && typeof sel.modelId === 'string' && sel.providerId && sel.modelId) {
    const lvl = sel?.options?.reasoningLevel
    return typeof lvl === 'string' && lvl ? `${sel.providerId}/${sel.modelId}$${lvl}` : `${sel.providerId}/${sel.modelId}`
  }
  return null
}
/** 已知键形态巡检（tripwire，纯函数）：model 键非字符串 / modelSelection 键非
 *  预期结构=宿主 metadata 格式漂移疑似——③ 对未识形态会当非绑定岗静默跳过
 *  （=检测面失明；2026-09-17 在册实例：model 字符串→modelSelection 结构体漂移
 *  即此族风险），显式 WARN 请人工核对 declaredModelOf。触发器行=RESIDUALS
 *  host-metadata-schema-drift。 */
export function detectMetadataShapeDrift(profileSnapshot) {
  if (!profileSnapshot || typeof profileSnapshot !== 'object') return false
  const m = profileSnapshot.model
  if (m !== undefined && typeof m !== 'string') return true
  const sel = profileSnapshot.modelSelection
  if (sel !== undefined && !(sel && typeof sel === 'object' && typeof sel.providerId === 'string' && typeof sel.modelId === 'string')) return true
  return false
}
export function detectSilentFallback({ metas, subagentNet }) {
  const findings = []
  for (const m of metas) {
    const ps = m?.profileSnapshot
    const declared = declaredModelOf(ps)
    const sid = m?.childSessionId
    const act = subagentNet[sid]
    // tripwire 无条件先行（门一 W-1 回炉：原门控在 !declared 内——双键同场且一键
    // 可解析时另一键畸形漏报；漂移留痕不替代绑定核对，两者并行不互斥）
    if (detectMetadataShapeDrift(ps)) findings.push({ level: 'WARN', profile: m.profileId, sid, declared: '(未识形态)', actual: act ? `${act.alias}/${act.modelId}` : '(窗口内无请求记录)', kind: '宿主 metadata 格式漂移疑似——③ 检测面可能失明，请核对 declaredModelOf（触发器行 host-metadata-schema-drift）' })
    if (!declared) continue // 无 model/modelSelection=宿主默认，非绑定岗
    if (!VALID_MODEL_RE.test(declared)) {
      // 枚举/伪值按流量分级（评估批修正：原一律 RED——历史测试探针零流量也永久
      // 污染退出码，全时段 metadata 扫描窗口化流量天然错位）：窗口内有实际请求=
      // RED（声明形态非法，路由不可信）；无请求=WARN（档案面问题非窗口内路由
      // 失效，留痕不阻断——覆盖其流量窗口再跑即升 RED，保守方向不放松）
      findings.push(act
        ? { level: 'RED', profile: m.profileId, sid, declared, actual: `${act.alias}/${act.modelId}`, kind: '疑似枚举/伪值且窗口内有实际请求（路由不可信）' }
        : { level: 'WARN', profile: m.profileId, sid, declared, actual: '(窗口内无请求记录)', kind: '疑似枚举/伪值（无可核对请求）——档案面问题，非窗口内路由失效' })
      continue
    }
    if (!act) { findings.push({ level: 'WARN', profile: m.profileId, sid, declared, actual: '(窗口内无请求记录)', kind: '无可核对请求' }); continue }
    // 声明的供应商段（uuid/builtin:/account:）须与实际 providerId 一致；模型段剥除
    // `$档位` 后缀后须与 modelId 一致（档位不参与回退判定——网络日志无档位维度）
    const [declaredProv, declaredModelRaw] = declared.split('/')
    const declaredModel = declaredModelRaw.split('$')[0]
    const match = (act.providerId === declaredProv || act.alias === declaredProv) && act.modelId === declaredModel
    if (!match) findings.push({ level: 'RED', profile: m.profileId, sid, declared, actual: `${act.alias}/${act.modelId}`, kind: '静默回退（声明≠实际路由）' })
  }
  return findings
}

// ── ⑥⑦ 子代理面：metadata（用量+终态）──
function harvestAgents(sinceMs, untilMs) {
  const metas = []
  if (!existsSync(AGENTS_DIR)) return metas
  for (const sess of readdirSync(AGENTS_DIR)) {
    const sdir = join(AGENTS_DIR, sess)
    try {
      for (const ag of readdirSync(sdir)) {
        const mf = join(sdir, ag, 'metadata.json')
        if (!existsSync(mf)) continue
      const m = JSON.parse(readFileSync(mf, 'utf8'))
      if (!inWindow(tsMs(m.createdAt), sinceMs, untilMs)) continue
        metas.push(m)
      }
    } catch { /* 目录竞争态：跳过 */ }
  }
  return metas
}

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }

// ── 主流程（N1 回炉 r2：包进 run()——--date 校验路径改 process.exitCode=1+return
//    自然退出形态，对齐本件「自然退出（HOST-node25 规避）」纪律；return 须
//    函数体承载，缩进重排语义零变化=ds-call-v2 cliMain 先例） ──
const argv = process.argv.slice(2)
const flag = (n) => cliFlag(argv, n) // 单源（org-config 导出——v1.6 批 P2-3；g3 批起三校验抛 UsageError）
const now = new Date()
// g3 批（evolve-l4-flags/P9 收敛）：--date/--hours 缺值不再按 null/0 静默——
// cliFlag 三校验抛 UsageError→[用法错]+exitCode=1 自然退出（本件纪律不强杀）
let rawDate = null
let g3UsageErr = null
try {
  rawDate = flag('--date') || null
} catch (e) {
  g3UsageErr = e
}
function run() {
  if (rawDate && !isValidDateStr(rawDate)) {
    console.error(`[usage] --date 非法值「${rawDate}」——须为真实存在的日期（YYYY-MM-DD，如 2026-09-16）；格式/语义校验拒，窗口日界=UTC（evolve-E2 b3——原静默空窗=假绿面）`)
    process.exitCode = 1 // 用法错（口径单源=06 §5.8）——自然退出不强杀（N1 回炉）
    return
  }
  const { hours, dateStr, sinceMs, untilMs } = resolveWindow({ argv, now }) // 窗口 epoch ms（--hours/--date 同路径；--date 日界=UTC）

  const { merged } = loadOrgConfig(SKILL_ROOT)
  const aliasMap = buildAliasMap(merged.providers)
  if (!merged.finish_vocab?.complete?.length || !merged.finish_vocab?.truncation?.length) {
    console.error('[config] org-config finish_vocab 缺 complete/truncation 词表（词表单源纪律 06 §0——v1.6 批收紧，无脚本内兜底）')
    process.exitCode = 3 // 配置错（06 §5.8 行 3）——自然退出不强杀（v2.0.1 修复批 L3：原 process.exit(3) 自破本件「自然退出（HOST-node25 规避）」纪律，同文件两种退出哲学并存）
    return
  }

  // 自检（--self-test）：fixture 级断言，全量聚合计入退出码（v1.6 批——原仅末 fixture 计=假 PASS 面）
  if (argv.includes('--self-test')) {
    let stFails = 0
    const t = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) stFails++ }
    t('429→quota', classifyError({ statusCode: 429 }) === 'quota')
    t('504→window', classifyError({ statusCode: 504 }) === 'window')
    t('500→server', classifyError({ statusCode: 500 }) === 'server')
    t('401→config', classifyError({ statusCode: 401 }) === 'config')
    t('403→quota（v2.0.1 修复批 L4：对齐类目标签「配额限流(429/403)」——原落 config 分支=标签撒谎）', classifyError({ statusCode: 403 }) === 'quota')
    t('ECONNRESET→transport', classifyError({ statusMessage: 'fetch failed: ECONNRESET' }) === 'transport')
    t('枚举值判定（sonnet 非 <uuid>/<model> 形态）', !VALID_MODEL_RE.test('sonnet'))
    // v2.1.0 回炉（W8/W12）：跨门终判三态纯函数+agents 目录覆写
    t('跨门终判：同族→WARN', crossGateVerdict('deepseek', 'deepseek') === 'WARN')
    t('跨门终判：异族→ok', crossGateVerdict('kimi', 'deepseek') === 'ok')
    t('跨门终判：任一侧未解析→?（不构成异构性证据）', crossGateVerdict('?', 'deepseek') === '?' && crossGateVerdict('kimi', '?') === '?')
    t('agents 目录覆写：env ZCODE_AGENTS_DIR 优先（缺省=宿主惯例路径）', (() => { const saved = process.env.ZCODE_AGENTS_DIR; process.env.ZCODE_AGENTS_DIR = 'demo-agents-rel'; const a = agentsDirOf(); process.env.ZCODE_AGENTS_DIR = saved; return resolve(a).endsWith(join('demo-agents-rel')) })())
    t('合法绑定形态（uuid/model）', VALID_MODEL_RE.test('aaaaaaaa-0000-4000-8000-000000000001/deepseek-flash'))
    t('合法绑定形态（builtin:model/key）', VALID_MODEL_RE.test('builtin:bigmodel-coding-plan/GLM-5.3'))
    // 2026-09-17 档位批向量：`$档位` 后缀（宿主 model 串扩展语法）与 account: 前缀族
    t('合法绑定形态（uuid/model$档位——宿主 $ 后缀语法）', VALID_MODEL_RE.test('bbbbbbbb-0000-4000-8000-000000000002/k3$max'))
    t('合法绑定形态（account: 前缀族）', VALID_MODEL_RE.test('account:bigmodel-individual-coding-plan/GLM-5.3$max'))
    const fbLvl = detectSilentFallback({
      metas: [{ profileId: 'probe-lvl-x', childSessionId: 's3', profileSnapshot: { model: 'bbbbbbbb-0000-4000-8000-000000000002/k3$max' } }],
      subagentNet: { s3: { alias: 'kimi-main', providerId: 'bbbbbbbb-0000-4000-8000-000000000002', modelId: 'k3', lastFinish: 'end_turn', fails: 0 } },
    })
    t('$档位后缀不误报回退（声明 k3$max/实际 k3=剥档位后一致）', fbLvl.length === 0)
    // 2026-09-17 档位批新会话首验暴露的检测盲区向量：宿主 metadata 新格式
    // profileSnapshot.modelSelection 结构体（$档位 解析落 options.reasoningLevel）
    // ——③ 原只读 model 字符串=新格式绑定岗静默跳过（恰好漏掉要盯的对象）
    t('sel 新格式（含档位）合成串可比对且不误报（provider/model$level）', detectSilentFallback({
      metas: [{ profileId: 'probe-sel-ok', childSessionId: 's5', profileSnapshot: { modelSelection: { providerId: 'bbbbbbbb-0000-4000-8000-000000000002', modelId: 'k3', options: { reasoningLevel: 'max' } } } }],
      subagentNet: { s5: { alias: 'kimi-main', providerId: 'bbbbbbbb-0000-4000-8000-000000000002', modelId: 'k3', lastFinish: 'end_turn', fails: 0 } },
    }).length === 0)
    t('sel 新格式回退可抓（声明 k3/实际宿主他模=RED 静默回退）', (() => {
      const r = detectSilentFallback({
        metas: [{ profileId: 'probe-sel-bad', childSessionId: 's6', profileSnapshot: { modelSelection: { providerId: 'bbbbbbbb-0000-4000-8000-000000000002', modelId: 'k3' } } }],
        subagentNet: { s6: { alias: '(宿主)', providerId: 'builtin:bigmodel-coding-plan', modelId: 'GLM-5.3', lastFinish: 'end_turn', fails: 0 } },
      })
      return r.length === 1 && r[0].level === 'RED' && r[0].kind.includes('静默回退')
    })())
    t('sel account: 前缀形态（probe 岗 GLM 绑定）合成串合法', (() => {
      const d = declaredModelOf({ modelSelection: { providerId: 'account:bigmodel-individual-coding-plan', modelId: 'GLM-5.3' } })
      return d === 'account:bigmodel-individual-coding-plan/GLM-5.3' && VALID_MODEL_RE.test(d)
    })())
    t('sel 残缺形态（缺 modelId）=null 非绑定岗跳过，不合成伪值', declaredModelOf({ modelSelection: { providerId: 'bbbbbbbb-0000-4000-8000-000000000002' } }) === null && declaredModelOf(null) === null)
    const fb = detectSilentFallback({
      metas: [{ profileId: 'probe-b-x', childSessionId: 's1', profileSnapshot: { model: 'sonnet' } },
              { profileId: 'probe-c-x', childSessionId: 's2', profileSnapshot: { model: 'aaaaaaaa-0000-4000-8000-000000000001/deepseek-flash' } }],
      subagentNet: { s2: { alias: 'deepseek', providerId: 'aaaaaaaa-0000-4000-8000-000000000001', modelId: 'deepseek-flash', lastFinish: 'end_turn', fails: 0 } },
    })
    t('probe-b 假绑定零流量=WARN（档案面问题不污染退出码——评估批修正：原一律 RED 致历史探针永久阻断）', fb.length === 1 && fb[0].level === 'WARN' && fb[0].kind.includes('枚举'))
    t('probe-b 假绑定有流量=RED（枚举+窗口内实际请求=路由不可信）', detectSilentFallback({
      metas: [{ profileId: 'probe-b-live', childSessionId: 's7', profileSnapshot: { model: 'sonnet' } }],
      subagentNet: { s7: { alias: 'kimi-main', providerId: 'bbbbbbbb-0000-4000-8000-000000000002', modelId: 'k3', lastFinish: 'end_turn', fails: 0 } },
    })[0]?.level === 'RED')
    t('metadata 形态漂移 tripwire：model 键成对象→WARN 未识形态', detectSilentFallback({
      metas: [{ profileId: 'probe-drift', childSessionId: 's8', profileSnapshot: { model: { providerId: 'x', modelId: 'y' } } }],
      subagentNet: {},
    })[0]?.kind.includes('漂移') === true)
    t('metadata 形态漂移 tripwire：modelSelection 残缺结构→WARN（检测面失明前哨）', detectSilentFallback({
      metas: [{ profileId: 'probe-drift2', childSessionId: 's9', profileSnapshot: { modelSelection: { providerId: 'bbbbbbbb-0000-4000-8000-000000000002' } } }],
      subagentNet: {},
    })[0]?.kind.includes('漂移') === true)
    t('tripwire 双键同场不漏报（门一 W-1 回炉：合法 model+畸形 modelSelection→漂移 WARN 且绑定核对照走）', (() => {
      const r = detectSilentFallback({
        metas: [{ profileId: 'probe-dual', childSessionId: 's10', profileSnapshot: { model: 'aaaaaaaa-0000-4000-8000-000000000001/deepseek-flash', modelSelection: { providerId: 123 } } }],
        subagentNet: { s10: { alias: 'deepseek', providerId: 'aaaaaaaa-0000-4000-8000-000000000001', modelId: 'deepseek-flash', lastFinish: 'end_turn', fails: 0 } },
      })
      return r.length === 1 && r[0].kind.includes('漂移') // 漂移 WARN 留痕+声明=实际无回退发现=绑定核对未被漂移顶替
    })())
    t('tripwire 与比对并行（门二裁决 P3-②：合法声明+漂移+声明≠实际→漂移 WARN+回退 RED 双条——漂移留痕不替代绑定核对）', (() => {
      const r = detectSilentFallback({
        metas: [{ profileId: 'probe-drift-mismatch', childSessionId: 's11', profileSnapshot: { model: 'aaaaaaaa-0000-4000-8000-000000000001/deepseek-flash', modelSelection: { providerId: 123 } } }],
        subagentNet: { s11: { alias: 'kimi-main', providerId: 'bbbbbbbb-0000-4000-8000-000000000002', modelId: 'k3', lastFinish: 'end_turn', fails: 0 } },
      })
      return r.length === 2 && r.some((f) => f.kind.includes('漂移') && f.level === 'WARN') && r.some((f) => f.kind.includes('静默回退') && f.level === 'RED')
    })())
    t('tripwire 零噪声面：无绑定键/合法旧格式/合法新格式均不误报', detectSilentFallback({
      metas: [
        { profileId: 'p-plain', childSessionId: 'sa', profileSnapshot: { name: 'x' } },
        { profileId: 'p-old', childSessionId: 'sb', profileSnapshot: { model: 'sonnet' } },
      ],
      subagentNet: {},
    }).every((f) => !f.kind.includes('漂移')) && detectMetadataShapeDrift({ modelSelection: { providerId: 'account:bigmodel-individual-coding-plan', modelId: 'GLM-5.3' } }) === false && detectMetadataShapeDrift({ model: 'a/b' }) === false && detectMetadataShapeDrift({}) === false)
    // 验收断言（裁决档 C2）：mock429×4 + 真实504×1 ⇒ 推荐=不换源
    const accRows = [
      ...[1, 2, 3, 4].map((i) => ({ ts: `2026-09-16T0${i}:00:00Z`, runId: `m${i}`, event: 'exhaust', statusCode: 429, error: 'HTTP 429 退避 3 次耗尽', mocked: true })),
      { ts: '2026-09-16T09:00:00Z', runId: 'r1', event: 'exhaust', statusCode: 504, error: 'HTTP 504' },
    ]
    const accCnt = countRealFailures(harvestRouting(accRows, null).exhaust)
    const accRec = recommendHealth(accCnt, { primary: 'k1', secondary: 'k2' })
    t('验收断言：mock429×4 不计入（mockN=4/quota=0/window=1）', accCnt.mockN === 4 && accCnt.quota === 0 && accCnt.window504 === 1)
    t('验收断言：推荐=k1 不换源（当日实陷回归——原输出假推荐 k2）', accRec.rec.includes('k1') && accRec.rec.includes('不换源'))
    // 全角括号兜底回归（实陷：全角（mock）漏配）
    const fw = harvestRouting([{ ts: '2026-09-16T10:00:00Z', runId: 'fw', event: 'exhaust', statusCode: 429, error: 'HTTP 429 退避 3 次耗尽（mock）' }], null).exhaust
    t('全角（mock）兜底命中（不计入推荐）', Object.values(fw)[0][0].isMock === true)
    // b3 向量（evolve-E2）：--date 格式+语义校验+窗口 epoch 化 UTC 日界（红态=函数未落→FAIL 行不崩）
    t('b3 格式校验：非 YYYY-MM-DD 拒（foo/2026-9-16/空串）', typeof isValidDateStr === 'function' && !isValidDateStr('foo') && !isValidDateStr('2026-9-16') && !isValidDateStr(''))
    t('b3 语义校验：坏月日拒（2026-13-45）', typeof isValidDateStr === 'function' && !isValidDateStr('2026-13-45'))
    t('b3 语义校验：坏日拒（2026-02-30——本机 V8 ISO 解析日溢出回卷非 NaN，须分量回环判）', typeof isValidDateStr === 'function' && !isValidDateStr('2026-02-30'))
    t('b3 语义校验：平年 2 月 29 拒（2025-02-29）', typeof isValidDateStr === 'function' && !isValidDateStr('2025-02-29'))
    t('b3 语义校验：合法值过（2026-09-16/闰 2024-02-29/平年 2025-02-28）', typeof isValidDateStr === 'function' && isValidDateStr('2026-09-16') && isValidDateStr('2024-02-29') && isValidDateStr('2025-02-28'))
    const wB3 = typeof resolveWindow === 'function' ? resolveWindow({ argv: ['--date', '2026-09-16'] }) : null
    t('b3 窗口 epoch 化+UTC 日界（since=UTC 零点/until=次 UTC 零点）', !!wB3 && wB3.sinceMs === Date.UTC(2026, 8, 16) && wB3.untilMs === Date.UTC(2026, 8, 17))
    const tSh0917 = Date.UTC(2026, 8, 16, 18) // =Asia/Shanghai（UTC+8）本地 2026-09-17 02:00
    t('b3 UTC 日界：上海本地 09-17 02:00 行（=UTC 09-16 18:00）归 09-16 窗', !!wB3 && wB3.sinceMs <= tSh0917 && tSh0917 < wB3.untilMs)
    const tSh0916 = Date.UTC(2026, 8, 15, 20) // =Asia/Shanghai 本地 2026-09-16 04:00
    t('b3 UTC 日界（非本地零点）：上海本地 09-16 04:00 行（=UTC 09-15 20:00）不入 09-16 窗', !!wB3 && tSh0916 < wB3.sinceMs)
    t('b3 --hours 同路径：epoch ms 回推（now 定锚 12:00Z−2h=10:00Z）', typeof resolveWindow === 'function' && resolveWindow({ argv: ['--hours', '2'], now: new Date(Date.UTC(2026, 8, 16, 12)) }).sinceMs === Date.UTC(2026, 8, 16, 10))
    // v2.0.1 修复批 M3 向量：--date/--hours 互斥 + --hours 值校验（红态=旧实现三处口径分裂/静默退化）
    t('M3 --date 与 --hours 同给→UsageError', (() => { try { resolveWindow({ argv: ['--date', '2026-09-16', '--hours', '2'] }); return false } catch (e) { return e instanceof UsageError } })())
    t('M3 --hours 非法值（abc/0/-3）→UsageError（原静默退化为当天日期窗）', (() => { for (const v of ['abc', '0', '-3']) { try { resolveWindow({ argv: ['--hours', v] }); return false } catch (e) { if (!(e instanceof UsageError)) return false } } return true })())
    // v2.0.1 修复批 M2 向量：switch 收割字段对齐派发器行实况（from/to——原读 r.source 恒 undefined）
    const swOut = harvestRouting([{ ts: '2026-09-16T10:00:00Z', runId: 'sw1', event: 'switch', from: 'a', to: 'b', error: 'x' }], null).switch
    t('M2 switch 收割：from/to 透传（供 ②段换源轨迹聚合）', swOut.sw1?.[0]?.from === 'a' && swOut.sw1?.[0]?.to === 'b')
    const rtRowsB3 = [
      { ts: '2026-09-16T18:00:00.000Z', runId: 'sh-local-0917-0200', event: 'exhaust', statusCode: 504, error: 'x' },
      { ts: '2026-09-16T23:59:59.999Z', runId: 'in-tail', event: 'exhaust', statusCode: 504, error: 'x' },
      { ts: '2026-09-17T00:00:00.000Z', runId: 'out-next-day', event: 'exhaust', statusCode: 504, error: 'x' },
    ]
    const rtOutB3 = wB3 ? harvestRouting(rtRowsB3, wB3.sinceMs, wB3.untilMs) : null
    t('b3 窗口行过滤：UTC 09-16 窗内两行留（含上海 09-17 02:00 行）/次 UTC 零点起弃', !!rtOutB3 && Object.values(rtOutB3.exhaust).flat().length === 2 && !Object.values(rtOutB3.exhaust).flat().some((e) => e.runId === 'out-next-day'))
    // b4 向量（evolve-E2）：null provider→buildAliasMap 不崩（null 条目跳过、其余映射保留）
    let amMap = null, amErr = null
    try { amMap = buildAliasMap({ dead: null, live: { uuid_prefix: 'b4-live-' } }) } catch (e) { amErr = e.message }
    t('b4 null provider→buildAliasMap 不崩（null 条目跳过/其余映射保留）', amErr === null && amMap instanceof Map && amMap.size === 1 && amMap.get('b4-live-') === 'live')
    // selfiter 批（evolve-l9-degrade）向量：缺输入显式留痕——红态=旧实现三面静默零提示
    t('l9 全缺输入→三面各一行留痕', typeof missingInputNotes === 'function' && missingInputNotes({ cliLogPaths: ['/x/a.jsonl'], routingLog: '/x/r.jsonl', agentsDir: '/x/ag', exists: () => false }).length === 3)
    t('l9 全在场→零留痕', typeof missingInputNotes === 'function' && missingInputNotes({ cliLogPaths: ['/x/a.jsonl'], routingLog: '/x/r.jsonl', agentsDir: '/x/ag', exists: () => true }).length === 0)
    t('l9 CLI 面半缺不噪声化（两点仅一点缺=不记该面，他面在场零留痕）', typeof missingInputNotes === 'function' && missingInputNotes({ cliLogPaths: ['/x/a.jsonl', '/x/b.jsonl'], routingLog: '/x/r.jsonl', agentsDir: '/x/ag', exists: (p) => p !== '/x/b.jsonl' }).length === 0)
    // 回炉 W1 向量：hours 模式目录缺失（cliDir 形态）+目录在场零留痕——红态=旧接线
    // 空数组漏留痕（目标场景零提示）
    t('l9-W1 hours 模式目录缺失→目录级留痕（非空数组静默）', typeof missingInputNotes === 'function' && missingInputNotes({ cliDir: '/x/clilog', routingLog: '/x/r.jsonl', agentsDir: '/x/ag', exists: (p) => p === '/x/r.jsonl' }).length === 2 && missingInputNotes({ cliDir: '/x/clilog', routingLog: '/x/r.jsonl', agentsDir: '/x/ag', exists: (p) => p === '/x/r.jsonl' })[0].includes('clilog'))
    t('l9-W1 目录在场→零留痕', typeof missingInputNotes === 'function' && missingInputNotes({ cliDir: '/x/clilog', routingLog: '/x/r.jsonl', agentsDir: '/x/ag', exists: () => true }).length === 0)
    console.log(stFails === 0 ? 'self-test 全过' : `self-test ${stFails} 项失败`)
    process.exitCode = stFails === 0 ? 0 : 1
  } else {
    // 收割两账（--hours 无日期时目录守卫：CLI 日志目录缺失=空集不崩——v1.6 批）。
    // v2.0.1 修复批 L5：hours 模式取数文件数按窗长推导（ceil(N/24)+1）——原恒
    // slice(-2) 使 --hours≥48 跨天统计静默低估且无留痕（窗口注释称「无上界」与
    // 取数面矛盾）。
    const logFiles = dateStr ? [`zcode-${dateStr}.jsonl`] : (existsSync(CLI_LOG_DIR) ? readdirSync(CLI_LOG_DIR).filter(f => /^zcode-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-(Math.ceil(hours / 24) + 1)) : [])
    // 缺输入显式留痕（evolve-l9-degrade：原三面静默空输出与 M1 静默空窗同族——红态=缺目录零提示）。
    // 回炉 W1：hours 模式目录缺失走 cliDir 形态（原空数组漏留痕=目标场景零提示）
    for (const n of missingInputNotes(dateStr
      ? { cliLogPaths: [join(CLI_LOG_DIR, `zcode-${dateStr}.jsonl`)], routingLog: ROUTING_LOG, agentsDir: AGENTS_DIR }
      : { cliDir: CLI_LOG_DIR, routingLog: ROUTING_LOG, agentsDir: AGENTS_DIR })) console.error(n)
    const cliLines = logFiles.flatMap(f => readJsonl(join(CLI_LOG_DIR, f)))
    const { perProvider, subagentNet, deduped } = harvestCliLog(cliLines, aliasMap, sinceMs, untilMs)
    const routing = harvestRouting(readJsonl(ROUTING_LOG), sinceMs, untilMs)
    const metas = harvestAgents(sinceMs, untilMs)
    const metasAll = harvestAgents(null) // 全时段 metadata 单次收割复用（原三重全量遍历——v1.6 批收敛）
    const W = process.stdout.write.bind(process.stdout)

    // ③ 静默回退检测（全时段 metadata——历史探针也要盯）
    const fallbacks = detectSilentFallback({ metas: metasAll, subagentNet })

    if (argv.includes('--health')) {
      // ── A'③ 源健康检查：分诊 + 推荐（结构参数=org-config source_health，v1.6 批去硬编码别名） ──
      const sh = merged.source_health || {}
      const dual = (sh.dual_groups && sh.dual_groups[0]) || []
      const subOf = sh.gate1_subagent_of || {}
      // 启动校验（终审 auditor-W2）：dual 组别名不在 providers 声明面=配置漂移，显式报错勿静默
      const unknownAliases = dual.filter((a) => !merged.providers?.[a])
      if (unknownAliases.length) console.error(`[config] source_health.dual_groups 引用了 providers 未声明的别名：${unknownAliases.join(', ')}——推荐将按未映射回退，请修 org-config`)
      W(`== 源健康检查（窗口=${dateStr || `近 ${hours}h`}，cfg:${cfgHash(merged)}）==\n`)
      if (deduped) W(`（request.failed 同秒剔重 ×${deduped}——终审 N2 暴露面，人工判读置信度用）\n`)
      for (const [alias, st] of Object.entries(perProvider)) {
        W(`[${alias}] ok=${st.ok} err=${JSON.stringify(st.err)} lat p50/p95=${pct(st.lat, .5)}/${pct(st.lat, .95)}ms attempts=${JSON.stringify(st.attempts)}\n`)
      }
      W(`-- 外链路（派发器）exhaust 明细：\n`)
      for (const [src, list] of Object.entries(routing.exhaust)) {
        for (const e of list) W(`   ${e.ts} ${src} statusCode=${e.statusCode} [${CLASS_NAMES[e.cls] || e.cls}] ${e.error}（run=${e.runId} role=${e.role}）${e.isMock ? '【mock 演练行，不计入推荐】' : ''}\n`)
      }
      const cnt = countRealFailures(routing.exhaust)
      if (cnt.mockN) W(`   （另检出 mock 演练行 ×${cnt.mockN}——R5 换源演练注入，不构成真实源健康信号）\n`)
      if (!Object.keys(routing.exhaust).length) W(`   （窗口内无 exhaust 事件）\n`)
      const { rec, why } = recommendHealth(cnt, { primary: subOf[dual[0]], secondary: subOf[dual[1]] })
      W(`\n>> 门一派发推荐：${rec}\n>> 依据：${why}（双源组=${dual.join('↔') || '未配置'}）\n`)
      // R2 干涸窗现状（全局标记文件直读——ds-call-v2 跳过面；DS_DRY_FILE 同源重定向）
      try {
        const dryPath = process.env.DS_DRY_FILE || join(SKILL_ROOT, '.zcode', 'source-dry.json')
        const dm = JSON.parse(readFileSync(dryPath, 'utf8'))
        const act = Object.entries(dm).filter(([, v]) => v && Number(v.until) > Date.now())
        W(`-- 干涸窗标记（R2，时长=${merged.source_health?.dry_minutes ?? 60}min）：${act.length ? act.map(([a, v]) => `${a} 至 ${new Date(v.until).toISOString()}（${v.reason}）`).join('；') : '无活跃标记'}\n`)
      } catch { W(`-- 干涸窗标记（R2）：无（标记文件缺失=从未触发）\n`) }
      // R3 ⑧ 常设双审对绑定实况核对（agent frontmatter model → uuid 前缀 → provider → model_family；
      //    配置面同族 RED=health-scan 启动校验，此处查实际绑定漂移——两读不混）。
      //    回炉 B-1：终判三分支——已核对异族=ok／同族=WARN／任一侧未解析=[?] 无法核对
      //    （原 else 分支把「?」吞成「[ok] 异构成立」=无证据打正向结论的假绿）。
      {
        const sp = sh.standing_pair || []
        if (sp.length === 2) {
          const norm = (v) => (v == null ? undefined : String(v).trim().toLowerCase() || undefined)
          const famOfCfg = (a) => norm(merged.providers?.[a]?.model_family)
          const rows = sp.map((alias) => {
            const agent = subOf[alias]
            let front = '(未映射子代理)'
            if (agent) {
              try {
                const fm = readFileSync(join(agentsDirOf(), `${agent}.md`), 'utf8')
                const mv = /^model:\s*(\S+)/m.exec(fm)
                front = mv ? mv[1].replace(/^['"]|['"]$/g, '') : '(无 model 字段)' // 回炉 N6：剥离包裹引号防前缀匹配假失败
              } catch { front = '(档案缺失)' }
            }
            const prefix = /^([0-9a-f]{8})/i.exec((front.split('/')[0] || '').trim())
            const prov = prefix ? Object.entries(merged.providers || {}).find(([, p]) => String(p.uuid_prefix || '').toLowerCase() === prefix[1].toLowerCase()) : null
            return { alias, agent, front, family: prov ? (norm(prov[1].model_family) || '?') : '?' }
          })
          for (const r of rows) W(`   [${r.alias}] 子代理=${r.agent || '?'} family=${r.family}（配置期望=${famOfCfg(r.alias) ?? '?'}）front=${r.front.slice(0, 40)}\n`)
          const fams = rows.map((r) => r.family)
          W(fams.includes('?')
            ? `   [?] 常设双审对无法核对（${fams.map((f, i) => (f === '?' ? sp[i] : null)).filter(Boolean).join(',')} 侧档案缺失/未映射/前缀漂移）——不构成异构性证据，人工核绑定（R3 回炉 B-1：旧版此态误打 [ok]）\n`
            : fams[0] === fams[1]
              ? `   [WARN] 常设双审对绑定同族（${fams[0]}）——异构对抗已退化（R3 tripwire；health-scan 收口位配置面同款 RED）\n`
              : `   [ok] 常设双审对异族（${fams[0]} vs ${fams[1]}）——异构成立（R3）\n`)
        }
      }
      // v2.1.0 批（07 §4 纪律⑤）+回炉（W8：畸形对不静默+计数行；W12：目录可覆写）：
      // 跨门岗对同族核对——门一常设双审 vs 门二裁决部同族=异构对抗退化形态。
      {
        const cgCount = { ok: 0, WARN: 0, '?': 0 }
        for (const pair of Array.isArray(sh.cross_gate_pairs) ? sh.cross_gate_pairs : []) {
          if (!Array.isArray(pair) || pair.length !== 2 || pair.some((x) => typeof x !== 'string')) {
            W(`   [?] 跨门岗对配置畸形（${JSON.stringify(pair)}）——org-config validate 应拦（纪律⑤），此处不静默跳过（回炉 W8）\n`)
            cgCount['?']++
            continue
          }
          const famOfAgent = (agent) => {
            try {
              const fm = readFileSync(join(agentsDirOf(), `${agent}.md`), 'utf8')
              const mv = /^model:\s*(\S+)/m.exec(fm)
              const front = mv ? mv[1].replace(/^['"]|['"]$/g, '') : ''
              const prefix = /^([0-9a-f]{8})/i.exec((front.split('/')[0] || '').trim())
              const prov = prefix ? Object.entries(merged.providers || {}).find(([, p]) => String(p.uuid_prefix || '').toLowerCase() === prefix[1].toLowerCase()) : null
              return prov ? String(prov[1].model_family || '?').toLowerCase() : '?'
            } catch { return '?' }
          }
          const fa = famOfAgent(pair[0]), fb = famOfAgent(pair[1])
          const v = crossGateVerdict(fa, fb)
          cgCount[v]++
          W(
            v === '?'
              ? `   [?] 跨门岗对无法核对（${pair.join('↔')}——${fa === '?' ? pair[0] : pair[1]} 侧档案缺失/未解析）——不构成异构性证据，人工核绑定（纪律⑤）\n`
              : v === 'WARN'
                ? `   [WARN] 跨门岗对同族（${pair.join('↔')} family=${fa}）——异构对抗退化形态：WARN+申报入档，禁静默（07 §4 纪律⑤；升格 RED=跨门护栏落地或裁决部改绑异族源=用户裁决位）\n`
                : `   [ok] 跨门岗对异族（${pair.join('↔')} ${fa} vs ${fb}）——跨门异构成立（纪律⑤）\n`)
        }
        if (Array.isArray(sh.cross_gate_pairs) && sh.cross_gate_pairs.length)
          W(`   -- 跨门核对汇总：ok ${cgCount.ok} / WARN ${cgCount.WARN} / ? ${cgCount['?']}（纪律⑤；WARN≠阻断，申报面=收口呈报包）\n`)
      }
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
      // switch 聚合输出（v2.0.1 修复批 M2：原头注声明 switch 计数而收割恒空+零消费
      // =「声称提供但实际坏掉」面——现按 from→to 对计数+涉及 runId 数并呈）
      {
        const swRecs = Object.values(routing.switch).flat()
        if (swRecs.length) {
          const pairs = {}
          for (const s of swRecs) { const k = `${s.from ?? '?'}→${s.to ?? '?'}`; pairs[k] = (pairs[k] || 0) + 1 }
          W(`   switch 总数=${swRecs.length}（涉及 runId ${Object.keys(routing.switch).length} 个）from→to=${JSON.stringify(pairs)}\n`)
        } else W(`   switch=0\n`)
      }
      for (const [src, list] of Object.entries(routing.exhaust)) for (const e of list) W(`   exhaust ${e.ts} ${src} ${e.statusCode}[${CLASS_NAMES[e.cls]}] ${e.error} run=${e.runId} role=${e.role}\n`)
      // ③ 静默回退检测
      W(`-- ③③ 静默回退检测（子代理声明绑定 vs 实际路由，metadata×${metasAll.length} 份）：\n`)
      if (!fallbacks.length) W('   零检出（全部声明=实际，或无绑定岗）\n')
      for (const f of fallbacks) W(`   [${f.level}] ${f.profile} ${f.sid?.slice(0, 30)}… 声明=${f.declared} 实际=${f.actual} —— ${f.kind}\n`)
      // ⑥ 岗×源用量（双源分列——组定义=org-config source_health.dual_groups）
      W(`-- ⑥ 岗×源用量汇总（子代理 metadata，org-ledger 补记数据源；双源分列）：\n`)
      const byRoleSource = {} // 复合键 role|source（A4：原 byRole[role] 一级赋值从未被读，已删）
      for (const m of metas) {
        const role = m.profileId || '?'
        const alias = subagentNet[m.childSessionId]?.alias || '(宿主默认)'
        const u = m.usage || {}
        const k = `${role}|${alias}`
        byRoleSource[k] = byRoleSource[k] || { calls: 0, in: 0, out: 0 }
        byRoleSource[k].calls++; byRoleSource[k].in += u.inputTokens || 0; byRoleSource[k].out += u.outputTokens || 0
      }
      for (const [k, v] of Object.entries(byRoleSource).sort()) W(`   ${k.replace('|', ' @ ')}: calls=${v.calls} in=${v.in} out=${v.out}\n`)
      // ⑦ finish 终态派生（保守口径——词表已装载守卫，无兜底数组）
      const completeSet = new Set(merged.finish_vocab.complete)
      const truncSet = new Set(merged.finish_vocab.truncation)
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
}
// g3 批：flag 解析用法错（--date 此处/--hours 在 run() 内 resolveWindow 抛）
// →[用法错]+exitCode=1 自然退出（HOST-node25 规避——本件纪律）
if (g3UsageErr) {
  console.error(`[用法错] ${g3UsageErr.message}`)
  process.exitCode = 1
} else {
  try {
    run()
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`[用法错] ${e.message}`)
      process.exitCode = 1
    } else throw e
  }
}
