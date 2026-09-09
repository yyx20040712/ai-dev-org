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
 *  - 退出码：3=配置级错误（uuid/name 校验、registry↔org-config 角色交叉失败、
 *    配置 JSON 损坏）；2=源尽 exhaust；4=本地 IO 错误（输出写失败——响应已
 *    成功已落账，主控禁重试）；1=用法错误。
 *  - --mock-source 支持逗号并列多点（如 kimi-main:429,deepseek:500）——
 *    全链注入=零成本 exhaust 演练；部分注入则后续源为真实调用（成本自担）。
 *  - v1/v2 禁混用于同一工单=主控流程纪律（单一调用者+事件字段 dispatcher_version
 *    可审计），不做代码级拦截（ds-W1 终裁）。
 * v1 母本=Synapse scripts/audits/ds-call.mjs（受锁件独立服役）。请求构造/响应解析/
 * 退避策略与 v1 一致（429/5xx/网络错指数退避 3 次换源；400/401/403/404 立即换源；
 * 末次守卫抛真实状态码）。
 * 用法：
 *   node ds-call-v2.mjs --role <id> [--source <alias>] [--project <名>]
 *        [--dry-run] [--mock-source <alias>:<status>] <prompt文件> [输出文件]
 *   node ds-call-v2.mjs --list-roles | --list-sources
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve, isAbsolute, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { SKILL_ROOT, loadOrgConfig, cfgHash, validateProviders, readHostConfig, readJson } from './org-config.mjs'

const DISPATCHER_VERSION = '2.1.0'
const LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'model-routing-log.jsonl')
const REGISTRY_PATH = join(SKILL_ROOT, 'scripts', 'roles', 'registry.json')
const RETRYABLE = (s) => s === 429 || s >= 500
const NO_RETRY = (s) => s === 400 || s === 401 || s === 403 || s === 404
const SCRUB_RE = /(Bearer\s+)?[A-Za-z0-9_-]{24,}/g // 日志脱敏：长 token 形态一律掩码（K-N2）
const scrub = (s) => String(s).replace(SCRUB_RE, '<redacted>')

// 顶层兜底（ds-N3）：未捕获异常→一行错误（无堆栈噪声）；JSON/配置类=exit 3，其余=exit 1
process.on('uncaughtException', (e) => {
  console.error(`[fatal] ${scrub(e.message)}`)
  process.exit(/JSON|配置|registry|org-config/.test(e.message) ? 3 : 1)
})

const exitConfig = (msg) => {
  console.error(msg)
  process.exit(3)
}

// ── 本地落账安全封装：目录自动建+IO 失败降级警告（不抛入远程重试语义） ──
function makeSafeAppend() {
  let warned = false
  return (path, line) => {
    try {
      appendFileSync(path, line, 'utf8')
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
  const registry = readJson(REGISTRY_PATH)
  const def = registry.roles[roleId]
  if (!def) throw new Error(`未知角色: ${roleId}（可用角色见 --list-roles）`)
  for (const key of Object.keys(merged.roles || {})) {
    if (!registry.roles[key]) exitConfig(`配置错误：org-config 声明了注册表不存在的角色 ${key}（死配置守卫）`)
  }
  const sysPrompt = readFileSync(join(SKILL_ROOT, def.sys_prompt_file), 'utf8')
  const dod = def.dod_file ? readFileSync(join(SKILL_ROOT, def.dod_file), 'utf8') : ''
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

function buildRequest(src, prompt, system) {
  if (src.kind === 'anthropic') {
    const base = src.baseURL.replace(/\/v1$/, '')
    return {
      url: `${base}/v1/messages`,
      method: 'POST',
      headersReal: { 'content-type': 'application/json', 'x-api-key': src.apiKey, 'anthropic-version': '2023-06-01' },
      body: { model: src.modelName, max_tokens: 32768, temperature: 0.2, system, messages: [{ role: 'user', content: prompt }] },
    }
  }
  return {
    url: `${src.baseURL}/chat/completions`,
    method: 'POST',
    headersReal: { 'Content-Type': 'application/json', Authorization: `Bearer ${src.apiKey}` },
    body: { model: src.modelName, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.2, max_tokens: 32768 },
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

// ── 双落账：运行流水（含 attempt）+ 项目账本（仅 ok/switch/exhaust）；本地 IO 降级 ──
const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6)
function makeLogger(role, merged, project, ledgerPath) {
  const safeAppend = makeSafeAppend()
  const ctx = { role_id: role.id, role_version: role.version, role_sig: role.sig, dispatcher_version: DISPATCHER_VERSION, org_config_hash: cfgHash(merged) }
  return {
    ctx,
    routing: (event, fields) => safeAppend(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), runId, event, ...ctx, ...fields }) + '\n'),
    ledger: (event, fields) => {
      if (!['ok', 'switch', 'exhaust'].includes(event)) return
      const roleCfg = merged.roles?.[role.id] || {}
      safeAppend(ledgerPath, JSON.stringify({ ts: new Date().toISOString(), project, event, role: role.id, tier: roleCfg.tier || 'unspecified', source: fields.source, cfg_hash: ctx.org_config_hash, usage: fields.usage, outcome: scrub(fields.outcome) }) + '\n')
    },
  }
}

// ── 单源调用：源内退避 3 次；attempt/ok 落账；switch/exhaust 由外层链记（互斥） ──
async function callSource(src, prompt, system, logger, mock) {
  const mockedStatus = mock ? mock[src.alias] : undefined
  const mocked = mockedStatus !== undefined
  const req = buildRequest(src, prompt, system)
  const t0 = Date.now()
  for (let attempt = 0; attempt < 4; attempt++) {
    logger.routing('attempt', { source: src.alias, model: src.modelName, attempt: attempt + 1, promptBytes: Buffer.byteLength(prompt, 'utf8'), mocked: !!mocked })
    try {
      const res = mocked
        ? { status: mockedStatus, ok: mockedStatus < 400, text: async () => '[mock-source 故障注入]' }
        : await fetch(req.url, { method: req.method, headers: req.headersReal, body: JSON.stringify(req.body), signal: AbortSignal.timeout(600_000) })
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
      logger.routing('ok', { source: src.alias, model: src.modelName, usage, latencyMs: Date.now() - t0, finish })
      logger.ledger('ok', { source: src.alias, usage, outcome: 'ok' })
      return { text, usage, latencyMs: Date.now() - t0 }
    } catch (e) {
      if (e.fatal || attempt === 3) throw e // switch/exhaust 由外层按「是否真换源」记（互斥语义）
      const wait = mocked ? 0 : 5000 * 2 ** attempt
      if (wait) console.error(`[${src.alias}] ${scrub(e.message)},退避 ${wait}ms`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw new Error('unreachable')
}

// ── CLI ──
const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}
const roleId = flag('--role')
const onlyAlias = flag('--source')
const projectName = flag('--project') || basename(process.cwd())
const mockSpec = flag('--mock-source')
const listRoles = argv.includes('--list-roles')
const listSources = argv.includes('--list-sources')
const dryRun = argv.includes('--dry-run')
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--role' && argv[i - 1] !== '--source' && argv[i - 1] !== '--project' && argv[i - 1] !== '--mock-source')

const registry = readJson(REGISTRY_PATH)
const { merged } = loadOrgConfig(process.cwd())
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

const hostCfg = readHostConfig()
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

const logger = makeLogger(role, merged, projectName, ledgerPath)
if (dryRun) {
  console.log(
    JSON.stringify(
      {
        runId,
        role: { id: role.id, version: role.version, sig: role.sig, sys_prompt: role.sysPrompt, dod: role.dod, assembled_system: system },
        chain: chain.map((s) => s.alias),
        route_source: routeSource,
        sources: chain.map((s) => ({ alias: s.alias, url: buildRequest(s, prompt, system).url, model: s.modelName, kind: s.kind })),
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
for (let i = 0; i < chain.length; i++) {
  const s = chain[i]
  console.error(`[routing] run=${runId} role=${role.id}@${role.sig} cfg=${cfgHash(merged)} 尝试源 ${i + 1}/${chain.length}: ${s.alias}(${s.modelName})`)
  let result
  try {
    result = await callSource(s, prompt, system, logger, mock)
  } catch (e) {
    const statusCode = e.statusCode
    if (i === chain.length - 1) {
      logger.routing('exhaust', { chain: chain.map((x) => x.alias).join('→'), error: scrub(e.message).slice(0, 300), statusCode })
      logger.ledger('exhaust', { source: chain.map((x) => x.alias).join('→'), outcome: 'exhaust-debt（同源审计欠账，主控回退只读审）' })
      console.error(`[routing] 全源尽(${chain.map((x) => x.alias).join('→')}): ${scrub(e.message)}——主控按「同源审计欠账」处置`)
      process.exit(2)
    }
    switches++
    logger.routing('switch', { from: s.alias, to: chain[i + 1].alias, error: scrub(e.message).slice(0, 300), statusCode })
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
