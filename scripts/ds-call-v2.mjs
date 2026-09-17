/**
 * 外部 API 派发器 v2（角色档案化）——ai-dev-org 技能件。修订=审查链回炉轮 1
 *（Kimi 2B/3W/4N + deepseek 1B(REJECTED 误读)/4W/4N，处置档=
 * Synapse scripts/audits/2026-09-10_skill-audit-a-*-out.md）：
 *  - 角色源路由=org-config roles.<role>.source 优先，registry default_source 兜底（K-B1）。
 *  - 账本目录自动创建；本地 IO 失败降级 stderr 警告不中断、不入远程重试语义（K-B2/ds-B2——
 *    防「成功响应因落账 ENOENT 被当网络错重试=重复计费」）。
 *  - switch/exhaust 互斥：switch 仅在实际换源时记（外层链），末源失败只记 exhaust（ds-W3）。
 *  - HTTP 错误附结构化 statusCode（ds-W2）；输出文件写失败不再触发换源（ds-W5）。
 *  - mock 校验：alias 必须 ∈ 本次链、status ∈ [400,599]（K-W1/W2）。
 *  - 宿主配置单次读入共用；find 未命中/字段缺失给 alias 级错误（K-W3）。
 *  - JSON 读取剥 BOM（ds-N2）；日志 error 文本脱敏 Bearer/api-key 形态（K-N2）；
 *    ledger_path 支持绝对路径（K-N3）。
 *  - 退出码口径单源=references/06 §5.8；本件特有一句（输出写失败时
 *    响应已落账、主控禁重试——防重复计费；总表该行未载禁重试指令，
 *    回炉 r2 保留呈终审；selfiter 批 p2-③ 削「数字=语义」半句）。
 *  - --mock-source 支持逗号并列多点（如 kimi-main:429,deepseek:500）——
 *    全链注入=零成本 exhaust 演练；部分注入则后续源为真实调用（成本自担）。
 *  - v1/v2 禁混用于同一工单=主控流程纪律（单一调用者+事件字段 dispatcher_version
 *    可审计），不做代码级拦截（ds-W1 终裁）。
 *  - v2.2.0（2026-09-14 优化批，Kimi 异源对抗审核后）：
 *    ①账本 schema v2——增 runId（账本↔流水行级关联键，W-B2）/schema_version/
 *      mocked（演练行源头甄别，W-2）/truncated（**派生布尔**，finish 唯一真相
 *      源在流水，W-B2 裁决）；②截断判定=白名单反转（仅 finish_vocab.complete
 *      完整，未知终态按非完整，W-3），词表住 org-config（脚本零硬编码）；
 *    ③网络级失败显式写 statusCode:null（P0-4 真因 2，R4 schema）；
 *    ④Node 版本守卫（P3-1/W-12，受禁主版本住 org-config）。
 *  - v2.2.1（2026-09-16 用户指令：后台调用上限 10 分钟→20 分钟）：
 *    ①CALL_TIMEOUT_MS=1_200_000；②传输层弃 global fetch（undici）——其内建
 *    headersTimeout/bodyTimeout 默认 300s，非流式长推理（响应头到达前零字节）
 *    会被它先于 AbortSignal 掐断（客户端侧中断=服务端记 499 家族）；改
 *    node:http(s) 直连，唯一超时=CALL_TIMEOUT_MS（undici 包在技能目录亦不可
 *    解析，故不采 setGlobalDispatcher 方案）。退避/重试/解析语义零变化。
 * v1 母本=Synapse scripts/audits/ds-call.mjs（受锁件独立服役）。请求构造/响应解析/
 * 退避策略与 v1 一致（429/5xx/网络错指数退避 3 次换源；400/401/403/404 立即换源；
 * 末次守卫抛真实状态码）。
 * 用法：
 *   node ds-call-v2.mjs --role <id> [--source <alias>] [--project <名>]
 *        [--dry-run] [--mock-source <alias>:<status>] <prompt文件> [输出文件]
 *   node ds-call-v2.mjs --list-roles | --list-sources
 * flag 取值一律空格分隔（--x=y 等号形态=用法错拒收——cliFlag 单源立场）。
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve, isAbsolute, relative, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { SKILL_ROOT, loadOrgConfig, cfgHash, validateProviders, readHostConfig, readJson, cliFlag, UsageError, withFileLock } from './org-config.mjs'

const DISPATCHER_VERSION = '2.3.0'
const LEDGER_SCHEMA_VERSION = 3 // v3（selfiter 批 B4）：增 project_id（归一化 id——映射单源=org-config projects，缺映射 raw 透传）
const LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'model-routing-log.jsonl')
const REGISTRY_PATH = join(SKILL_ROOT, 'scripts', 'roles', 'registry.json')
const RETRYABLE = (s) => s === 429 || s >= 500
const NO_RETRY = (s) => s === 400 || s === 401 || s === 403 || s === 404
const SCRUB_RE = /(Bearer\s+)?[A-Za-z0-9_-]{24,}/g // 日志脱敏：长 token 形态一律掩码（K-N2）
const scrub = (s) => String(s).replace(SCRUB_RE, '<redacted>')

// ── 退出码分类（evolve 批 b2，2026-09-16）：类型化错误带 exitCode 属性替换
// 消息正则兜底（英文 locale 下 fs/系统错误消息不含中文关键词致配置装载类
// 误判的修误分类面；判据源=06 §5.8 退出码总表——配置/装载错、用法/未知、
// exhaust 链内专用、输出写失败显式路径四类，行号见总表） ──
export class ConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigError'
    this.exitCode = 3
  }
}
/** 未捕获错误的退出码判定：有 exitCode 属性用属性，无=1（用法/未知）。
 *  export 纯函数供 R10 向量。 */
export function classifyExitCode(e) {
  return typeof e?.exitCode === 'number' && Number.isInteger(e.exitCode) && e.exitCode >= 1 && e.exitCode <= 255 ? e.exitCode : 1
}

/** sys_prompt_file 包含性校验（evolve 批 b6，2026-09-16，P-2 预裁决）：
 *  registry 声明路径 resolve 后须落在 root 内——path.relative 结果恰 '..' 或
 *  首段 '..'（涵盖 ..\ 与 ../ 两种分隔形态）或绝对路径形态（跨盘符时
 *  path.relative 产绝对串）=越界拒绝抛 ConfigError（exit 3+stderr 点名越界
 *  路径）——纵深防御定性维持，当前 registry 无越界=不可达守卫（行为变化
 *  申报 P-6③）。export 纯函数供 R10 向量。
 *  两落点同步演进纪律：本函数+regression.mjs loadRoleAssembled（两处注释互指）。 */
export function ensureWithinRoot(root, abs) {
  const rel = relative(resolve(root), resolve(abs))
  if (rel !== '' && (isAbsolute(rel) || rel.split(/[\\/]/)[0] === '..')) {
    throw new ConfigError(`路径越界: ${abs}（registry 声明路径须在 ${root} 内——包含性校验拒绝，exit 3）`)
  }
  return resolve(abs)
}

// 顶层兜底（ds-N3）：未捕获异常→一行错误（无堆栈噪声）；退出码=classifyExitCode
// 类型化判定（b2：消息正则兜底已删——ConfigError=3，其余=1）
process.on('uncaughtException', (e) => {
  console.error(`[fatal] ${scrub(e.message)}`)
  process.exit(classifyExitCode(e))
})

// ── Node 版本守卫（P3-1/W-12）：HOST-node25 libuv 退出阶段崩溃面 ──
// 受支持版本区间与禁用主版本住 org-config（supported_node），脚本禁硬编码路径。
function nodeVersionGuard(merged) {
  const forbid = merged?.supported_node?.forbid_major
  if (!Array.isArray(forbid) || forbid.length === 0) return
  const major = Number(process.versions.node.split('.')[0])
  if (forbid.includes(major)) {
    console.error(`[node-guard] 当前 Node ${process.version} 主版本 ${major} 在 org-config supported_node.forbid_major 内——` +
      `已知退出阶段 libuv 断言崩溃面（残留册 HOST-node25）。外部派发请改用受支持版本（如 Node 24）。本次继续执行，运行结果与落账已完成，崩溃仅发生在退出阶段。`)
  }
}

const exitConfig = (msg) => {
  console.error(msg)
  process.exit(3)
}

// ── 派发器请求参数单源（v1.7.4 m4 清偿）：org-config dispatch_request ──
// 两载荷形态（anthropic/openai）共用；缺段/非有限数值=ConfigError（exit 3，
// stderr 点名分区与字段）——无静默回退，禁脚本内字面量。
function loadDispatchRequest(merged) {
  const d = merged?.dispatch_request
  if (d == null || typeof d !== 'object')
    throw new ConfigError(`org-config dispatch_request 分区缺失或非对象（现=${d === undefined ? 'undefined' : String(d)}）——派发器请求参数单源（v1.7.4 m4 清偿），缺段=exit 3 无静默回退`)
  const bad = (k, v) =>
    new ConfigError(`org-config dispatch_request.${k} 缺失或非有限数值（现=${typeof v === 'number' ? String(v) : JSON.stringify(v) ?? String(v)}）——派发器请求参数单源（v1.7.4 m4 清偿），缺段/非数值=exit 3 无静默回退`)
  const mt = d.max_tokens
  const tp = d.temperature
  if (typeof mt !== 'number' || !Number.isFinite(mt)) throw bad('max_tokens', mt)
  if (typeof tp !== 'number' || !Number.isFinite(tp)) throw bad('temperature', tp)
  return { maxTokens: mt, temperature: tp }
}

// ── 本地落账安全封装：目录自动建+IO 失败降级警告（不抛入远程重试语义）
// ＋跨进程建议锁（selfiter 批 B4 evolve-m6-runid：账本/流水多写入者行交错面
// ——锁=纵深防御，获锁失败降级留痕不阻断派发） ──
function makeSafeAppend() {
  let warned = false
  return (path, line) => {
    try {
      withFileLock(path + '.lock', () => { appendFileSync(path, line, 'utf8') })
    } catch (e) {
      if (!warned) {
        warned = true
        console.error(`[ledger-warn] 本地落账失败（后续仅警告一次，不影响派发与远程语义）：${path}: ${e.message}`)
      }
    }
  }
}

// ── 角色装载（注册表路径相对技能根）+ org-config 角色键交叉校验 ──
function loadRole(roleId, merged) {
  // b2：装载类失败抛 ConfigError（exit 3，06 §5.8）——英文 locale 系统消息
  // 不含中文关键词，原正则兜底会误判 exit 1
  let registry
  try { registry = readJson(REGISTRY_PATH) } catch (e) { throw new ConfigError(`registry 装载失败（${REGISTRY_PATH}）: ${e.message}`) }
  // 回炉 B1：roles 为 null/非对象形态时裸取 registry.roles[roleId]=TypeError→
  // uncaughtException 无 exitCode 属性=exit 1（未申报回退）——改校验 ConfigError
  if (registry.roles === null || typeof registry.roles !== 'object')
    throw new ConfigError(`registry.roles 形态损坏（${REGISTRY_PATH}）: 须为对象，现=${registry.roles === null ? 'null' : typeof registry.roles}`)
  const def = registry.roles[roleId]
  if (!def) throw new Error(`未知角色: ${roleId}（可用角色见 --list-roles）`) // 用法错=1（06 §5.8）
  for (const key of Object.keys(merged.roles || {})) {
    if (!registry.roles[key]) exitConfig(`配置错误：org-config 声明了注册表不存在的角色 ${key}（死配置守卫）`)
  }
  let sysPrompt, dod
  try {
    ensureWithinRoot(SKILL_ROOT, join(SKILL_ROOT, def.sys_prompt_file)) // b6：包含性校验（越界=ConfigError exit 3；另一落点=regression loadRoleAssembled，同步演进）
    sysPrompt = readFileSync(join(SKILL_ROOT, def.sys_prompt_file), 'utf8')
    dod = def.dod_file ? readFileSync(join(SKILL_ROOT, def.dod_file), 'utf8') : ''
  } catch (e) {
    if (e instanceof ConfigError) throw e // 校验错直抛（不吞成装载失败文案）
    throw new ConfigError(`角色档案装载失败（registry 声明 ${def.sys_prompt_file}${def.dod_file ? '/' + def.dod_file : ''}）: ${e.message}`)
  }
  const sig = createHash('sha256').update(sysPrompt + '\n---DOD---\n' + dod).digest('hex').slice(0, 8)
  return { id: roleId, def, sysPrompt: sysPrompt.trimEnd(), dod: dod.trim(), sig, version: def.role_version }
}

// ── 源装载（org-config 驱动；宿主配置单次读入；双校验 fail-fast=exit 3） ──
function loadSources(merged, hostCfg) {
  const errors = validateProviders(merged, hostCfg)
  if (errors.length) errors.forEach((e) => console.error(e)), process.exit(3)
  return (merged.source_chain || []).map((alias) => {
    const def = merged.providers[alias]
    const hit = Object.entries(hostCfg.provider || {}).find(([id, p]) => id.startsWith(def.uuid_prefix) && p && p.name === def.entry_name)
    if (!hit) exitConfig(`源装载失败 alias=${alias}（双校验在 validate 应已拦截——此处为不可达守卫）`)
    const [, prov] = hit
    if (!prov.options?.baseURL || !prov.models || Object.keys(prov.models).length === 0)
      exitConfig(`源装载失败 alias=${alias}：宿主条目缺 options.baseURL 或 models 字段`)
    return {
      alias,
      kind: def.kind,
      note: def.note || '',
      baseURL: prov.options.baseURL.replace(/\/$/, ''),
      apiKey: prov.options.apiKey,
      model: Object.keys(prov.models)[0],
      modelName: Object.values(prov.models)[0]?.name || Object.keys(prov.models)[0],
    }
  })
}

function buildRequest(src, prompt, system, reqParams) {
  if (src.kind === 'anthropic') {
    const base = src.baseURL.replace(/\/v1$/, '')
    return {
      url: `${base}/v1/messages`,
      method: 'POST',
      headersReal: { 'content-type': 'application/json', 'x-api-key': src.apiKey, 'anthropic-version': '2023-06-01' },
      body: { model: src.modelName, max_tokens: reqParams.maxTokens, temperature: reqParams.temperature, system, messages: [{ role: 'user', content: prompt }] },
    }
  }
  return {
    url: `${src.baseURL}/chat/completions`,
    method: 'POST',
    headersReal: { 'Content-Type': 'application/json', Authorization: `Bearer ${src.apiKey}` },
    body: { model: src.modelName, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: reqParams.temperature, max_tokens: reqParams.maxTokens },
  }
}

function parseResponse(src, data) {
  if (src.kind === 'anthropic') {
    const text = Array.isArray(data.content) ? data.content.filter((b) => b.type === 'text').map((b) => b.text).join('') : ''
    return { text, usage: { in: data.usage?.input_tokens, out: data.usage?.output_tokens }, finish: data.stop_reason }
  }
  const msg = data.choices?.[0].message || {}
  let text = msg.content || ''
  if (!text && msg.reasoning_content) text = '[仅推理无正文,finish=' + data.choices?.[0].finish_reason + ']\n' + msg.reasoning_content
  return { text, usage: { in: data.usage?.prompt_tokens, out: data.usage?.completion_tokens }, finish: data.choices?.[0]?.finish_reason }
}

// ── 截断判定（W-3 白名单反转 + W-4 词表住 org-config，脚本零硬编码） ──
// 仅 complete 词表内视为完整终态；truncation 及一切未知终态=非完整（审计岗按假成功处置）。
function makeFinishClassifier(vocab) {
  // 词表单源=org-config finish_vocab（v1.6 批 P2-4 收紧：无兜底数组——缺表=配置错即拒跑，
  // 原「脚本内硬编码兜底」与 06 §0 自我声明相悖）
  const complete = new Set(vocab?.complete || [])
  const truncation = new Set(vocab?.truncation || [])
  if (complete.size === 0 || truncation.size === 0) { console.error('[config] org-config finish_vocab 缺 complete/truncation 词表（词表单源纪律，06 §0）'); process.exit(3) }
  return (finish) => {
    if (finish == null) return { cls: 'unknown', truncated: true } // 无终态信息=不可判为完整（保守）
    if (complete.has(finish)) return { cls: 'complete', truncated: false }
    if (truncation.has(finish)) return { cls: 'truncation', truncated: true }
    return { cls: 'unknown', truncated: true } // 未知终态词=按非完整（W-3：防未知截断静默通过）
  }
}

/** FINDINGS 机读尾栏解析（selfiter 批 findings-parser 清偿——DoD 契约机读面）：
 *  审出件末栏形如「FINDINGS: B=1 W=2 N=3 VERDICT=PASS」（末 5 行回扫窗，空格容错，
 *  verdict 归一大写）；未命中返回 null（非审计产出/未带尾栏=不伪造）。纯函数
 *  export 供 R10 向量。 */
export function parseFindings(text) {
  if (typeof text !== 'string') return null
  const lines = text.trimEnd().split('\n')
  for (let i = lines.length - 1, back = 0; i >= 0 && back <= 5; i--, back++) {
    const m = /^FINDINGS:\s*B=(\d+)\s+W=(\d+)\s+N=(\d+)\s+VERDICT=(\S+)/.exec(lines[i].trim())
    if (m) return { B: Number(m[1]), W: Number(m[2]), N: Number(m[3]), verdict: m[4].toUpperCase() }
  }
  return null
}

// ── 双落账：运行流水（含 attempt）+ 项目账本（仅 ok/switch/exhaust）；本地 IO 降级 ──
// 账本 schema v2（W-N5）：增 runId（账本↔流水行级关联键，W-B2）/schema_version/
// mocked（源头侧甄别演练行，W-2）/truncated（**派生布尔**——finish 唯一真相源在
// 流水，账本只存判定结果，非双源，W-B2 明文裁决）。
const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 10) // 后缀 8 字符（selfiter B4：原 4 字符同秒并发碰撞窗）
function makeLogger(role, merged, project, ledgerPath, isMock, classifyFinish) {
  const safeAppend = makeSafeAppend()
  const ctx = { role_id: role.id, role_version: role.version, role_sig: role.sig, dispatcher_version: DISPATCHER_VERSION, org_config_hash: cfgHash(merged) }
  // project_id 归一化（selfiter B4 project-id-migration）：映射单源=org-config
  // projects 分区，缺映射=raw 名透传（v3 行恒携带 project_id）
  const projectId = merged.projects && merged.projects[project] !== undefined ? merged.projects[project] : project
  return {
    ctx,
    classifyFinish,
    routing: (event, fields) => safeAppend(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), runId, event, ...ctx, ...fields }) + '\n'),
    ledger: (event, fields) => {
      if (!['ok', 'switch', 'exhaust'].includes(event)) return
      const roleCfg = merged.roles?.[role.id] || {}
      // truncated 仅对 ok 行有意义（switch/exhaust 无产出，不记——防语义噪声）
      const truncated = event === 'ok' ? classifyFinish(fields.finish).truncated : undefined
      // findings=ok 行可选字段（selfiter 批 findings-parser）：parseFindings(text)
      // 产物，仅审计岗产出携带（非审计岗/未带尾栏=undefined 不落键）
      const findings = event === 'ok' ? (fields.findings || undefined) : undefined
      safeAppend(ledgerPath, JSON.stringify({ ts: new Date().toISOString(), schema_version: LEDGER_SCHEMA_VERSION, runId, project, project_id: projectId, event, role: role.id, tier: roleCfg.tier || 'unspecified', source: fields.source, cfg_hash: ctx.org_config_hash, usage: fields.usage, mocked: isMock || undefined, truncated, findings, outcome: scrub(fields.outcome) }) + '\n')
    },
  }
}

// ── 单源调用：源内退避 3 次；attempt/ok 落账；switch/exhaust 由外层链记（互斥） ──

// 客户端调用上限（v2.2.1 用户指令 2026-09-16）：10 分钟 → 20 分钟。
const CALL_TIMEOUT_MS = 1_200_000

// POST 传输层=node:http(s) 直连（弃 global fetch——undici 内建 headers/body
// 300s 默认会在非流式长推理期先掐；见头注 v2.2.1）。signal 是唯一超时来源。
function postJson(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'http:' ? httpRequest : httpsRequest
    const req = lib(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('error', reject) // 响应中途断流防挂起（v1.6 批 P2-4：原仅挂 req 侧，断流要等 20min 超时）
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text: async () => text, json: async () => JSON.parse(text) })
        })
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

async function callSource(src, prompt, system, logger, mock, reqParams) {
  // 门一 W-1（v1.7.4 回炉 1 轮）：--mock-source 给出但链内某源未注射=拒跑——
  // 防「漏注射=静默真实调用」（本批自裁 1 前科：两点注入漏链内第三源致一次真实调用）。
  if (mock && !(src.alias in mock))
    throw new ConfigError(`--mock-source 漏注射 ${src.alias}——mock 模式缺注射即拒跑，防静默真实调用（门一 W-1，本批自裁 1 前科）`)
  const mockedStatus = mock ? mock[src.alias] : undefined
  const mocked = mockedStatus !== undefined
  const req = buildRequest(src, prompt, system, reqParams)
  const t0 = Date.now()
  for (let attempt = 0; attempt < 4; attempt++) {
    logger.routing('attempt', { source: src.alias, model: src.modelName, attempt: attempt + 1, promptBytes: Buffer.byteLength(prompt, 'utf8'), mocked: !!mocked })
    try {
      const res = mocked
        ? { status: mockedStatus, ok: mockedStatus < 400, text: async () => '[mock-source 故障注入]' }
        : await postJson(req.url, req.headersReal, JSON.stringify(req.body), CALL_TIMEOUT_MS)
      if (RETRYABLE(res.status)) {
        if (attempt === 3) throw Object.assign(new Error(`HTTP ${res.status} 退避 3 次耗尽${mocked ? '（mock）' : ''}`), { statusCode: res.status })
        const wait = mocked ? 0 : 5000 * 2 ** attempt
        if (wait) console.error(`[${src.alias}] HTTP ${res.status},退避 ${wait}ms(第 ${attempt + 1} 次)`)
        await new Promise((r) => setTimeout(r, wait))
        continue
      }
      if (!res.ok) {
        const detail = scrub((await res.text()).slice(0, 300))
        if (NO_RETRY(res.status)) throw Object.assign(new Error(`HTTP ${res.status}: ${detail}`), { fatal: true, statusCode: res.status })
        if (attempt === 3) throw Object.assign(new Error(`HTTP ${res.status}: ${detail}`), { statusCode: res.status })
        const wait = mocked ? 0 : 5000 * 2 ** attempt
        if (wait) console.error(`[${src.alias}] HTTP ${res.status},退避 ${wait}ms`)
        await new Promise((r) => setTimeout(r, wait))
        continue
      }
      const data = await res.json()
      const { text, usage, finish } = parseResponse(src, data)
      if (!text) throw Object.assign(new Error('空响应 finish=' + finish + ' usage=' + JSON.stringify(usage)), { fatal: true })
      const { cls, truncated } = logger.classifyFinish(finish)
      // FINDINGS 机读尾栏解析（selfiter 批 findings-parser）：审计岗产出按 DoD 带
      // 尾栏——解析产物入账本 ok 行 findings 字段；未带=undefined 不伪造
      const findings = parseFindings(text)
      // 截断=假成功（P0-2）：报告可能不完整而被当 ok 收下。显式告警，交收口 RED 处置。
      if (truncated) console.error(`[truncation-warn] ${src.alias} 产出非完整终态 finish=${finish}（${cls}）——审计产出按假成功处置（回炉/换源），账本已记 truncated=true`)
      logger.routing('ok', { source: src.alias, model: src.modelName, usage, latencyMs: Date.now() - t0, finish, finish_class: cls, truncated })
      logger.ledger('ok', { source: src.alias, usage, finish, findings, outcome: truncated ? `ok-truncated（finish=${finish}）` : 'ok' })
      return { text, usage, latencyMs: Date.now() - t0, truncated }
    } catch (e) {
      if (e.fatal || attempt === 3) throw e // switch/exhaust 由外层按「是否真换源」记（互斥语义）
      const wait = mocked ? 0 : 5000 * 2 ** attempt
      if (wait) console.error(`[${src.alias}] ${scrub(e.message)},退避 ${wait}ms`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw new Error('unreachable')
}

// ── CLI（isMain guard=evolve 批 b2，范式 org-config.mjs：import 消费纯函数
//     （classifyExitCode/ensureWithinRoot，R10 向量）时零副作用） ──
async function cliMain() {
  const argv = process.argv.slice(2)
  // g3 批（evolve-l4-flags 清偿，主控预裁 P1）：本地 flag 副本收编为 org-config
  // cliFlag 单源 import——W7「分发单元自包含」豁免前提已过时（本件 import 行已
  // 引 org-config 多标识符，副本=纯双源面）；三校验（重复/末位缺值/值形如
  // flag）→[用法错] exit 1（P9 收敛：--mock-source 多点重复注射不再仅首点生效）
  let roleId, onlyAlias, projectName, mockSpec
  try {
    roleId = cliFlag(argv, '--role')
    onlyAlias = cliFlag(argv, '--source')
    projectName = cliFlag(argv, '--project') || basename(process.cwd())
    mockSpec = cliFlag(argv, '--mock-source')
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`[用法错] ${e.message}`)
      process.exit(1)
    }
    throw e
  }
  const listRoles = argv.includes('--list-roles')
  const listSources = argv.includes('--list-sources')
  const dryRun = argv.includes('--dry-run')
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--role' && argv[i - 1] !== '--source' && argv[i - 1] !== '--project' && argv[i - 1] !== '--mock-source')

  // 回炉 B1：顶层装载点同律包 ConfigError（与 loadRole 内包装同型）——原裸调用
  // 在一切路径先执行，坏/缺 registry.json 抛普通 SyntaxError→uncaughtException
  // 无 exitCode 属性=exit 1，而 06 §5.8 判配置/装载错=3（未申报回退；E1 §4 表
  // 漏此 throw 点，勘误见回炉报告）。
  let registry
  try { registry = readJson(REGISTRY_PATH) } catch (e) { throw new ConfigError(`registry 装载失败（${REGISTRY_PATH}）: ${e.message}`) }
  let merged // b2：配置装载类失败抛 ConfigError（exit 3）——英文 locale 消息不含关键词，原正则兜底误判 exit 1
  try { ({ merged } = loadOrgConfig(process.cwd())) } catch (e) { throw new ConfigError(`org-config 装载失败: ${e.message}`) }
  nodeVersionGuard(merged)
  const dispatchReq = loadDispatchRequest(merged) // m4 清偿：请求参数单源（缺段/非数值=exit 3，两载荷形态共用）
  const rawLedger = merged.ledger_path || '.zcode/org-ledger.jsonl'
  const ledgerPath = isAbsolute(rawLedger) ? rawLedger : join(process.cwd(), rawLedger)
  // 注：--project=账本条目名；配置装载恒从 cwd。死配置守卫（org-config 角色↔registry
  // 交叉）仅在派发路径 loadRole 生效，org-config validate 不做注册表交叉。

  if (listRoles) {
    console.log('角色注册表（registry_version=' + registry.registry_version + '；路径相对技能根；源路由=org-config 优先/registry 兜底）：')
    for (const [id, def] of Object.entries(registry.roles)) {
      const rc = merged.roles?.[id] || {}
      console.log(`  ${id} | source=${rc.source ?? def.default_source}${rc.source ? '（org-config）' : '（registry 兜底）'} tier=${rc.tier || '?'} | ${def.sys_prompt_file}`)
    }
    process.exit(0)
  }

  let hostCfg // b2：宿主配置装载失败=配置类 ConfigError（exit 3）
  try { hostCfg = readHostConfig() } catch (e) { throw new ConfigError(`宿主配置装载失败（~/.zcode/v2/config.json）: ${e.message}`) }
  const sources = loadSources(merged, hostCfg)
  if (listSources) {
    console.log(`源序（org-config source_chain；cfg:${cfgHash(merged)}）：`)
    sources.forEach((s, i) => console.log(`  ${i + 1}. ${s.alias} | ${s.modelName} | ${s.kind} @ ${s.baseURL} | ${s.note}`))
    process.exit(0)
  }

  if (!roleId) {
    console.error('错误：--role 必填（v1 内嵌系统提示已废止）。可用角色：')
    Object.keys(registry.roles).forEach((id) => console.error('  ' + id))
    console.error('用法: node ds-call-v2.mjs --role <id> [--source <alias>] [--project <名>] [--dry-run] [--mock-source <alias>:<status>] <prompt文件> [输出文件]')
    process.exit(1)
  }
  const role = loadRole(roleId, merged)
  const system = role.dod ? role.sysPrompt + '\n\n' + role.dod : role.sysPrompt
  const routeSource = merged.roles?.[roleId]?.source ?? role.def.default_source // org-config 优先（K-B1）

  const promptPath = positional[0]
  const outPath = positional[1]
  if (!promptPath) {
    console.error('用法: node ds-call-v2.mjs --role <id> [...] <prompt文件> [输出文件]')
    process.exit(1)
  }
  const prompt = readFileSync(promptPath, 'utf8')

  const chain = onlyAlias ? sources.filter((s) => s.alias === onlyAlias) : routeSource === 'chain' ? sources : sources.filter((s) => s.alias === routeSource)
  if (chain.length === 0) {
    console.error(onlyAlias ? `未知或不可用源: ${onlyAlias}` : `角色 ${roleId} 路由源 ${routeSource} 不可用`)
    process.exit(1)
  }

  const mock = mockSpec
    ? Object.fromEntries(
        (mockSpec || '')
          .split(',')
          .map((part) => /^([^:]+):(\d+)$/.exec(part?.trim()))
          .filter(Boolean)
          .map((m) => [m[1], Number(m[2])]),
      )
    : null
  if (mockSpec && (!mock || Object.keys(mock).length === 0)) throw new Error('--mock-source 需要 <alias>:<status>（可逗号并列多点，形如 kimi-main:429,deepseek:500）')
  if (mock)
    for (const [alias, status] of Object.entries(mock)) {
      if (!chain.some((s) => s.alias === alias)) exitConfig(`--mock-source 的 alias ${alias} 不在本次链 ${chain.map((s) => s.alias).join('→')} 内（防演练静默真调）`)
      if (status < 400 || status > 599) exitConfig(`--mock-source 的 status 须在 [400,599]（故障注入语义；无成功路径）`)
    }

  const logger = makeLogger(role, merged, projectName, ledgerPath, !!mock, makeFinishClassifier(merged.finish_vocab))
  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          runId,
          role: { id: role.id, version: role.version, sig: role.sig, sys_prompt: role.sysPrompt, dod: role.dod, assembled_system: system },
          chain: chain.map((s) => s.alias),
          route_source: routeSource,
          sources: chain.map((s) => ({ alias: s.alias, url: buildRequest(s, prompt, system, dispatchReq).url, model: s.modelName, kind: s.kind })),
          routing_log: LOG_PATH,
          ledger: ledgerPath,
          cfg_hash: cfgHash(merged),
          mock: mock,
        },
        null,
        2,
      ),
    )
    process.exit(0)
  }

  // 账本目录先建（K-B2/ds-B2）——置于只读分支之后，零副作用命令不建目录（W-1）
  try {
    mkdirSync(dirname(ledgerPath), { recursive: true })
  } catch (e) {
    exitConfig(`账本目录创建失败 ${dirname(ledgerPath)}: ${e.message}`)
  }

  let switches = 0
  const paygOf = (alias) => merged.providers?.[alias]?.billing === 'payg'
  if (paygOf(chain[0].alias)) console.error(`[payg] 首源 ${chain[0].alias}=套餐外按量计费（payg）——本次调用将产生费用（费用面显式留痕，v1.6 批预裁：换源不放宽任务书，但禁止静默烧钱）`)
  for (let i = 0; i < chain.length; i++) {
    const s = chain[i]
    const srcMocked = !!(mock && mock[s.alias] !== undefined) // mock 标志贯穿 switch/exhaust 行（v1.6 批 C2：attempt 行有而 exhaust 行漏——log-triage --health 曾把演练 429 计入真实失效出假换源推荐）
    console.error(`[routing] run=${runId} role=${role.id}@${role.sig} cfg=${cfgHash(merged)} 尝试源 ${i + 1}/${chain.length}: ${s.alias}(${s.modelName})`)
    let result
    try {
      result = await callSource(s, prompt, system, logger, mock, dispatchReq)
    } catch (e) {
      if (e instanceof ConfigError) throw e // W-1（回炉 1 轮）：漏注射=配置类错直通 exit 3，不进换源/exhaust 链语义
      // P0-4 真因 2：网络级失败（fetch failed）无 HTTP 状态码——显式写 null，
      // 保字段存在（R4 schema 要求 statusCode；缺字段=坏行）。
      const statusCode = e.statusCode ?? null
      if (i === chain.length - 1) {
        logger.routing('exhaust', { chain: chain.map((x) => x.alias).join('→'), error: scrub(e.message).slice(0, 300), statusCode, mocked: srcMocked })
        logger.ledger('exhaust', { source: chain.map((x) => x.alias).join('→'), outcome: 'exhaust-debt（同源审计欠账，主控回退只读审）' })
        console.error(`[routing] 全源尽(${chain.map((x) => x.alias).join('→')}): ${scrub(e.message)}——主控按「同源审计欠账」处置`)
        process.exit(2)
      }
      switches++
      if (paygOf(chain[i + 1].alias)) console.error(`[payg] 换源至 ${chain[i + 1].alias}=套餐外按量计费（payg）——本次调用将产生费用（费用面显式留痕，v1.6 批预裁）`)
      logger.routing('switch', { from: s.alias, to: chain[i + 1].alias, error: scrub(e.message).slice(0, 300), statusCode, mocked: srcMocked, payg: paygOf(chain[i + 1].alias) || undefined })
      logger.ledger('switch', { source: s.alias, outcome: scrub(e.message).slice(0, 200) })
      console.error(`[routing] 换源 ${s.alias} → ${chain[i + 1].alias}: ${scrub(e.message).slice(0, 200)}`)
      continue
    }
    // 输出写入在远程调用与重试语义之外（ds-W5：本地 IO 失败不触发换源/重复调用）
    const header = `[routing]: run=${runId} source=${s.alias} model=${s.modelName} role=${role.id}@${role.sig} cfg=${cfgHash(merged)} switches=${switches} usage=in=${result.usage.in ?? '?'},out=${result.usage.out ?? '?'} latency=${result.latencyMs}ms (by ds-call-v2 链)\n\n`
    const body = header + result.text
    console.log(body) // 先出 stdout（W-2：输出文件写失败时正文已在标准流，产物不丢）
    if (outPath) {
      try {
        writeFileSync(outPath, body, 'utf8')
      } catch (e) {
        console.error(`[out-warn] 输出文件写失败（正文已输出 stdout，可手工重定向保全；**响应已成功且已落账——主控禁据本码重试，防重复计费**）: ${e.message}`)
        process.exit(4) // 4=本地 IO 错误（区别于 1=用法错误；stdout 已出正文即不得重试——ds-W1 终裁）
      }
    }
    process.exit(0)
  }
}
const isMain =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) await cliMain()
