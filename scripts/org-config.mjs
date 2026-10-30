/**
 * org-config 工具（ai-dev-org）：装载/深合并/规范化哈希/源交叉校验/自测。
 * 深合并语义（审核链 B2 终裁）：对象逐字段递归覆盖，未提及字段沿用默认件；
 * 数组整体替换；显式 null=删除该键。
 * 规范化哈希：递归键排序+剔除 null/undefined（对象键值与数组元素皆剔，
 * 顺序保留）+紧凑 JSON.stringify 后 sha256 前 12 位——与键序/空白无关。
 * 退出码口径单源=references/06 §5.8（此处不复写数字=语义映射，防双源漂移
 * ——evolve 批 b8 指针化）。
 * 用法：
 *   node org-config.mjs [--project <dir>] resolve   # 打印合并后配置
 *   node org-config.mjs [--project <dir>] hash      # 打印 cfg:<hash12>
 *   node org-config.mjs [--project <dir>] validate  # 与宿主 config.json 交叉校验（不符 exit 3）
 *   node org-config.mjs [--project <dir>] flags                        # 列出 flags（注册值＋状态件覆盖）
 *   node org-config.mjs [--project <dir>] flags get <name>             # 读单值（未登记=1）
 *   node org-config.mjs [--project <dir>] flags set <name> on|off      # 写状态件（未登记/非法值=1）
 *   node org-config.mjs --self-test                 # 合并/哈希/flags 语义自测向量
 * flag 取值一律空格分隔（--x=y 等号形态=用法错拒收——cliFlag 单源立场）。
 * flags（B1/D-6）：登记单源=org-config.default.json flags 分区（本机件/项目覆盖件可增新
 * flag——schema 同源）；状态件=SKILL_ROOT/.zcode/org-flags.json（仅 flags set 可写，读写走
 * 同一装载＋withFileLock，锁=状态件同目录派生）；测试重定向钩子=env ORG_FLAGS_STATE
 * （内部测试设施，同 GLM_LOOK_HOST_CONFIG 先例——缺省行为不变）。
 * B8 D-4 notice：CLI 预检通过后、业务装载前向 stderr 打 ORG_FLAGS_STATE default/override
 * 单行（只显示路径与来源，不读取/打印状态内容；stdout 机器格式不变）。
 * B8 D-5 CLI 预检：参数组合闭集前置校验（15 非法例族）——未知命令/flag、位置参数、等号
 * 形态、重复/缺值、flags 子命令形态错在任何装载与写入之前 exit 1；--self-test 与一切其他
 * 参数互斥；合法命令装载失败=3；业务判红=1；2 永不发（06 §5.8）。
 * B8 r4 哨兵：--self-test 入口检测 env ORG_B8_TEST_DEPTH 即固定 exit 1 并输出逐字标记行
 * （防自检副本递归放大）；自检内部 spawn 一律显式 env、不携带该键。
 * ledgerPathFor（B1/D-8 路径随动单源）：--ledger 显式参 > merged ledger_path 相对项目根
 * 解析 > join(projectDir,'.zcode','org-ledger.jsonl') 兜底——health-scan/regression/deploy-check
 * 消费同一导出，禁各自复写三层序。
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, openSync, writeSync, closeSync, statSync, rmSync, utimesSync, mkdtempSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

export const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_CFG = join(SKILL_ROOT, 'org-config.default.json')
const LOCAL_CFG = join(SKILL_ROOT, 'org-config.local.json')

/** JSON 读取（剥 UTF-8 BOM——Windows 编辑器常见，审核链 ds-N2；语法错误带路径上下文）。
 *  返回值语义归档（g3-w1r1）：合法 JSON 字面 null → 返 null 非 throw——
 *  消费点须对 null 守卫（宿主 config 内容为 null 时 readHostConfig 即此形态）。 */
export function readJson(path) {
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`JSON 解析失败 ${path}: ${e.message}`)
  }
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

/** 深合并（B2 语义）。over 中显式 null=删除；undefined=不动用 base。 */
export function deepMerge(base, over) {
  const out = {}
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(over || {})])
  for (const k of keys) {
    const b = base ? base[k] : undefined
    const o = over ? over[k] : undefined
    if (o === null) continue // 显式 null=删除（base 侧 null 视同缺失）
    if (o === undefined) {
      if (b !== undefined && b !== null) out[k] = b
      continue
    }
    if (isPlainObject(o) && isPlainObject(b)) out[k] = deepMerge(b, o)
    else out[k] = o // 标量覆盖；数组整体替换
  }
  return out
}

/** 规范化：递归键排序+剔除 null/undefined（对象键值与数组元素，顺序保留）。 */
export function canonicalize(v) {
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).map(canonicalize)
  if (isPlainObject(v)) {
    const o = {}
    for (const k of Object.keys(v).sort()) {
      if (v[k] === null || v[k] === undefined) continue
      o[k] = canonicalize(v[k])
    }
    return o
  }
  return v
}

/** 规范化哈希：sha256 前 12 位。 */
export function cfgHash(cfg) {
  return createHash('sha256').update(JSON.stringify(canonicalize(cfg))).digest('hex').slice(0, 12)
}

/** 三层合并纯函数（v2.1.0 返工 W11：可向量化的层序/优先级单源——loadOrgConfig
 *  的核心语义抽离，自检可注入合成层验证 project>local>default 优先级、
 *  数组整体替换、显式 null 删除跨层语义）。 */
export function mergeOrgLayers(defaultCfg, localCfg, projectCfg) {
  let out = defaultCfg
  for (const over of [localCfg, projectCfg]) {
    if (over == null) continue
    out = deepMerge(out, over)
  }
  return out
}

/** 装载合并配置（三层，v2.1.0 批）：默认件（通用/随包）← 本机件
 *  org-config.local.json（个人实值，gitignore 不随分享包，缺席=仅默认件）
 *  ← <projectDir>/.zcode/org-config.json（存在时）。深合并语义层内不变。
 *  带日期的临时默认窗机制已退役（裁决时点 2026-10-27：顺序常驻、无到期语义，
 *  顺序日常调整唯一写者=org-panel 面板）——生效配置=合并结果本身，无第二视图。 */
export function loadOrgConfig(projectDir) {
  const base = readJson(DEFAULT_CFG)
  const hasLocal = existsSync(LOCAL_CFG)
  const localCfg = hasLocal ? readJson(LOCAL_CFG) : null
  const overPath = join(projectDir, '.zcode', 'org-config.json')
  const hasOverride = existsSync(overPath)
  const projectCfg = hasOverride ? readJson(overPath) : null
  const merged = mergeOrgLayers(base, localCfg, projectCfg)
  return { merged, hasOverride, overPath, hasLocal, localPath: LOCAL_CFG }
}

/** 本地日期字符串（月/日补零；禁 toISOString——UTC 偏移会把本地日期切错天）。 */
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 账本路径三层解析（B1/D-8 单源导出）：显式参 > merged ledger_path（相对项目根）>
 *  join(projectDir,'.zcode','org-ledger.jsonl') 兜底。merged 可由调用方注入（已装载场景
 *  零二次读盘）；未注入时内部装载（装载失败向上抛——配置破损不得静默落兜底）。 */
export function ledgerPathFor(projectDir, ledgerFlag = null, merged = null) {
  if (ledgerFlag) return resolve(String(ledgerFlag))
  const cfg = merged || loadOrgConfig(projectDir).merged
  const rel = cfg && typeof cfg.ledger_path === 'string' && cfg.ledger_path.trim() ? cfg.ledger_path.trim() : null
  return rel ? resolve(projectDir, rel) : join(projectDir, '.zcode', 'org-ledger.jsonl')
}

// ── flags 能力（B1/D-6）：合法 flag 登记单源=org-config.default.json flags 分区；
//    revert_manifest_schema 为分区内 schema 声明键（非开关）；状态件布尔覆盖注册默认。 ──
export const FLAGS_RESERVED_KEYS = new Set(['revert_manifest_schema'])
export const REVERT_MANIFEST_COLUMNS = ['path', 'commit', 'baseline_sha256']
export function flagsStatePath() {
  return process.env.ORG_FLAGS_STATE || join(SKILL_ROOT, '.zcode', 'org-flags.json')
}
export function isToggleFlagDef(entry) {
  return entry != null && typeof entry === 'object' && !Array.isArray(entry)
    && typeof entry.description === 'string' && typeof entry.owner_batch === 'string' && typeof entry.default === 'boolean'
}
export function readFlagsState() {
  const p = flagsStatePath()
  if (!existsSync(p)) return {}
  const v = readJson(p) // 破损=抛（CLI 侧按装载错承接）
  return v != null && typeof v === 'object' && !Array.isArray(v) ? v : {}
}
export function resolveFlagValue(merged, name, state = null) {
  const flags = merged && typeof merged.flags === 'object' && merged.flags ? merged.flags : {}
  if (!(name in flags) || !isToggleFlagDef(flags[name])) return null // 未登记
  if (state && typeof state[name] === 'boolean') return state[name]
  return flags[name].default
}
export function validateFlagsPartition(cfg) { // D-6 validate 增断言：分区在位且每个 flag 含三键
  const errors = []
  const flags = cfg?.flags
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) {
    errors.push('flags 分区缺失/非对象——合法 flag 登记单源（B1 D-6）：本批须含 b1_gates_v2{description,owner_batch,default}')
    return errors
  }
  for (const [name, entry] of Object.entries(flags)) {
    if (FLAGS_RESERVED_KEYS.has(name)) {
      const okShape = entry != null && typeof entry === 'object' && !Array.isArray(entry)
        && Array.isArray(entry.columns) && entry.columns.join() === REVERT_MANIFEST_COLUMNS.join()
        && typeof entry.note === 'string' && entry.note.trim()
      if (!okShape) errors.push(`flags.${name} 形态不符——须 {columns:[${REVERT_MANIFEST_COLUMNS.join(',')}], note 非空}`)
      continue
    }
    if (!isToggleFlagDef(entry))
      errors.push(`flags.${name} 须含三键 {description, owner_batch, default:boolean}（本机件可增新 flag——schema 同源）`)
  }
  return errors
}
export function setFlag(merged, name, value) { // 写状态件（唯一写者=flags set）；未登记/非法值=UsageError
  const cur = resolveFlagValue(merged, name, null)
  if (cur === null) throw new UsageError(`flag「${name}」未登记——合法 flag 单源=org-config flags 分区（本机件可增）`)
  if (value !== 'on' && value !== 'off') throw new UsageError(`flag 取值须 on|off（收到「${value}」）`)
  const p = flagsStatePath()
  mkdirSync(dirname(p), { recursive: true })
  return withFileLock(p + '.lock', () => {
    const prev = existsSync(p) ? readJson(p) : {}
    const next = { ...(prev && typeof prev === 'object' && !Array.isArray(prev) ? prev : {}), [name]: value === 'on' }
    writeFileSync(p, JSON.stringify(next, null, 2) + '\n')
    return { path: p, name, value: next[name] }
  })
}

/** 宿主双注册表合并（2026-10-03 kimi-third 改绑批；事实单源=references/10 §2）：
 *  宿主供应商注册表迁移双文件形态——新条目只落 v2/provider_config.json
 *  （providerRules），旧 config.json provider 段不再收新条目；单读旧件则
 *  新源双校验必败。合并=旧件 provider 段打底+新件 rules 映射覆盖（同 id
 *  新件为准——三种粒度成文：name=缺省回退；options=键级合并；models=
 *  整体替换（personalModelIds=该 id 模型清单的更新事实，旧键残留=死模型，
 *  替换分支自测向量钉住）。无 config 的模板行（templateId 形）跳过不物化
 *  ——仅 id 无身份/连接事实，物化=name=undefined 幽灵条目（返工 k2-W1/d1-W2）。
 *  映射形态与旧件消费面同构：name/options.baseURL/options.apiKey/models
 *  ——纯函数供自测注入。 */
export function mergeHostRegistries(legacyCfg, v2Cfg) {
  const provider = {}
  for (const [id, p] of Object.entries(legacyCfg?.provider || {})) provider[id] = p
  const rules = v2Cfg?.config?.providerConfigRules?.providerRules
  if (Array.isArray(rules)) {
    for (const r of rules) {
      if (!r || typeof r.providerId !== 'string' || !r.providerId || !r.config) continue
      const c = r.config
      const prev = provider[r.providerId] || {}
      provider[r.providerId] = {
        ...prev,
        name: typeof r.providerName === 'string' && r.providerName ? r.providerName : prev.name,
        options: {
          ...prev.options,
          ...(c.api?.baseUrl ? { baseURL: c.api.baseUrl } : {}),
          ...(c.access?.apiKey ? { apiKey: c.access.apiKey } : {}),
        },
        models: Array.isArray(c.personalModelIds) && c.personalModelIds.length
          ? Object.fromEntries(c.personalModelIds.map((m) => [m, { name: m }]))
          : prev.models,
      }
    }
  }
  return { ...(legacyCfg || {}), provider }
}

/** 读宿主配置（单点封装，供派发器与校验共用——K-W3 单次读入）。双注册表
 *  合并见 mergeHostRegistries 头注；两件全缺=显式抛（保持原 fatal 语义），
 *  单件缺席=以在场件打底。 */
export function readHostConfig() {
  const v2Dir = join(homedir(), '.zcode', 'v2')
  const legacyPath = join(v2Dir, 'config.json')
  const v2Path = join(v2Dir, 'provider_config.json')
  const legacy = existsSync(legacyPath) ? readJson(legacyPath) : null
  const v2 = existsSync(v2Path) ? readJson(v2Path) : null
  if (legacy == null && v2 == null) throw new Error(`宿主供应商注册表缺失（${legacyPath} 与 ${v2Path} 均缺席/为空）`)
  return mergeHostRegistries(legacy, v2)
}

/** 跨脚本共享小件（v1.6 批 P2-3 收敛：多份逐字复制→单源导出；ds-call-v2
 *  副本已收编（g3 批，W7 前提过时——其 import 行已引本件多标识符，自包含
 *  既破，副本=纯双源面））。 */
/** 用法错（g3 批 2026-09-17，evolve-l4-flags 补还）：flag 重复/末位缺值/值形如
 *  flag。Error 子类且**不带 exitCode 属性**——消费点显式 catch 后
 *  `[用法错] …`+exit 1（口径单源=references/06 §5.8 行 1）；不 catch 则 Node
 *  自然退 1，同为契约内。 */
export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
  }
}

/** CLI flag 取值单源（g3 批三校验+selfiter 批等号立场）：①同名 flag 出现≥2 次
 *  =用法错；②flag 居末位（无值）=用法错；③下一 token 以 -- 开头（值形如
 *  flag）=用法错；④等号形态 `--name=value`=用法错拒收（g3-cliflag-equals
 *  立场：本工具族 flag 一律空格分隔取值，禁静默判缺席回退——fail-fast）。
 *  缺席仍返回 null=现语义不变；单 - 开头值（如负数）不算 flag 形态，放行。 */
export function cliFlag(argv, name) {
  const eqForm = argv.find((t) => typeof t === 'string' && t.startsWith(name + '='))
  if (eqForm !== undefined) throw new UsageError(`flag ${name} 的等号形态「${eqForm}」不支持——flag 一律空格分隔取值（g3-cliflag-equals 立场：拒收并点名，防静默缺席回退）`)
  const hits = []
  for (let i = 0; i < argv.length; i++) if (argv[i] === name) hits.push(i)
  if (hits.length === 0) return null
  if (hits.length >= 2) throw new UsageError(`flag ${name} 出现 ${hits.length} 次（重复=用法错——原仅解析首个，g3 批 evolve-l4-flags 补还）`)
  const val = argv[hits[0] + 1]
  if (val === undefined) throw new UsageError(`flag ${name} 居末位无值（缺值=用法错——原取 undefined 静默，g3 批 evolve-l4-flags 补还）`)
  if (typeof val === 'string' && val.startsWith('--')) throw new UsageError(`flag ${name} 的值形如 flag（「${val}」——误吃下一 flag=用法错，g3 批 evolve-l4-flags 补还）`)
  return val
}
export function readJsonlFile(p) {
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean)
    .map((l, i) => { try { return JSON.parse(l) } catch { return { unparseable: `行${i + 1}: ${l.slice(0, 60)}` } } })
}

/** 跨进程建议锁（selfiter 批 B4 evolve-m6-runid 补还——账本/流水多写入者行交错面）：
 *  lockfile 兄弟文件 + 'wx' 独占建；陈旧锁（>staleMs）破锁续行；tries 耗尽=降级
 *  无锁执行+stderr 留痕（单行 append 本就近原子，锁=纵深防御不阻断派发主流程）。
 *  同步睡眠=Atomics.wait（Node 主线程合法）。 */
/** SSE 文本→事件载荷数组（selfiter 批 B5 流式化——纯函数，双脚本共用）：
 *  只认 data: 行；[DONE] 哨兵与非 JSON 行（注释/心跳）跳过。 */
export function parseSseText(text) {
  const events = []
  for (const line of String(text).split('\n')) {
    const l = line.trim()
    if (!l.startsWith('data:')) continue
    const payload = l.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try { events.push(JSON.parse(payload)) } catch { /* 非 JSON 数据行（注释/心跳）跳过 */ }
  }
  return events
}

/** SSE 事件流收割器（B5——根治网关非流式窗口截断 504 族）：产出与各自非流式
 *  形态**同构**的最终响应对象——消费方 normalizeResponse/parseResponse 零改动。
 *  anthropic 形：message_start(input usage)/content_block_delta(text_delta 累积)/
 *  message_delta(stop_reason+output usage)。openai 形：choices[].delta.content
 *  累积/finish_reason/末块 usage（请求侧配 stream_options.include_usage）。 */
export function collectAnthropicSse(events) {
  let text = '', stopReason = null, usage = {}
  for (const ev of events) {
    if (ev?.type === 'message_start') usage = { ...usage, ...ev.message?.usage }
    else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') text += ev.delta.text || ''
    else if (ev?.type === 'message_delta') {
      if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason
      if (ev.usage && typeof ev.usage.output_tokens === 'number') usage = { ...usage, output_tokens: ev.usage.output_tokens }
    }
  }
  return { content: text ? [{ type: 'text', text }] : [], stop_reason: stopReason, usage }
}
export function collectOpenaiSse(events) {
  let text = '', finish = null, usage = null
  for (const ev of events) {
    const ch = ev?.choices?.[0]
    if (ch?.delta?.content) text += ch.delta.content
    if (ch?.finish_reason) finish = ch.finish_reason
    if (ev?.usage) usage = ev.usage
  }
  return { choices: [{ message: { content: text }, finish_reason: finish }], usage: usage || {} }
}

const sleepSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }
export function withFileLock(lockPath, fn, { staleMs = 10_000, tries = 60, waitMs = 20 } = {}) {
  let fd = -1
  let degraded = false
  for (let i = 0; i < tries; i++) {
    try { fd = openSync(lockPath, 'wx'); break } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try { const st = statSync(lockPath); if (Date.now() - st.mtimeMs > staleMs) { rmSync(lockPath, { force: true }); continue } } catch { /* 竞态消亡=续抢 */ }
      sleepSync(waitMs)
    }
  }
  if (fd < 0) { degraded = true; console.error(`[lock-degraded] ${lockPath} ${tries} 次未获锁（持锁者异常？）——降级无锁执行（单行 append 近原子，纵深防御层失效留痕）`) }
  try {
    if (fd >= 0) writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`)
    return fn()
  } finally {
    if (fd >= 0) { try { closeSync(fd) } catch { /* already closed */ } try { rmSync(lockPath, { force: true }) } catch { /* 竞态破锁=对方已清 */ } }
    void degraded
  }
}

/** 族统一读取（P1 批）：新配置用 family，旧配置沿用 model_family——
 *  返回 def.family || def.model_family（去空白、小写）；非字符串/缺失=空串
 *  （消费点按空值 fail-closed）。providers 族校验与 slot 跨族检查同走此单源。 */
export function familyOf(def) {
  const raw = def && typeof def === 'object' ? (def.family || def.model_family) : undefined
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

/** 与宿主 config.json 交叉校验：uuid 前缀+条目名双命中。返回错误数组（空=通过）。
 *  校验 providers 全集（未入链的已声明源亦须通过——防漂移，审核链 K-N4 口径）。
 *  L19 账户计划源分支：uuid_prefix 以 `account:` 开头（小写化）＝计划源，不走宿主
 *  注册表双命中，改走顶层 account_plan_allowlist 本机允许清单（计划名=冒号后段，
 *  trim 后与清单精确比对）；借道宿主注册表 builtin 同名残条＝归因造假，禁止。 */
export function validateProviders(cfg, hostCfg) {
  const hc = hostCfg || readHostConfig()
  const entries = Object.entries(hc.provider || {})
  const errors = []
  const allowlist = cfg?.account_plan_allowlist
  const isPlanPrefix = (v) => typeof v === 'string' && v.trim().toLowerCase().startsWith('account:')
  // 形态守卫：声明了 account: 源而允许清单缺失/非数组/空数组＝配置不完整（fail-closed）
  if (Object.values(cfg?.providers || {}).some((def) => def != null && typeof def === 'object' && isPlanPrefix(def.uuid_prefix))
    && (!Array.isArray(allowlist) || allowlist.length === 0))
    errors.push('account_plan_allowlist 缺失/非数组/空数组——providers 存在 account: 账户计划源时本机允许清单必填（顶层键，默认件空数组由本机件覆盖）')
  for (const [alias, def] of Object.entries(cfg.providers || {})) {
    if (def == null || typeof def !== 'object') {
      errors.push(`providers.${alias} 值为 ${def === null ? 'null' : typeof def}——须为对象（uuid_prefix/entry_name）；null/非对象条目=配置损坏（evolve-E2 b4 守卫：原裸取 uuid_prefix 即 TypeError 崩溃）`)
      continue
    }
    if (def.uuid_prefix === 'TODO' || def.entry_name === 'TODO') {
      errors.push(`providers.${alias} 仍为模板占位（uuid_prefix/entry_name=TODO）——org-config 尚未本机化：填 org-config.local.json（本机件，gitignore；deploy-check --install 可脚手架）同名键实值（uuid_prefix=宿主注册表条目 id 前 8 字符/entry_name=条目名），指引=DEPLOY.md §3（06 §0 三层）`)
      continue
    }
    // 返工（代码审查（岗）W-3）：非占位源须带族字段——standing_pair/跨门同族核对的消费面，
    // 缺键=异族校验静默降级为 [?]（k1 W-3/d1 W9a 同族面）。P1 批起统一读
    // family || model_family（familyOf 单源；旧键沿用 model_family 不破）。
    if (!familyOf(def))
      errors.push(`providers.${alias} 缺 model_family（family/model_family 二者之一须为非空字符串）——standing_pair/跨门同族核对消费此键（org-config source_health），缺键=不同模型族校验静默降级；本机件补填`)
    // L19 计划源分支（先于注册表双命中）：account:<计划名> 走本机允许清单，
    // 通过即跳过双命中；既有注册表源路径行为零变化。
    if (isPlanPrefix(def.uuid_prefix)) {
      const plan = def.uuid_prefix.trim().toLowerCase().slice('account:'.length).trim()
      const planOk = !!plan && Array.isArray(allowlist)
        && allowlist.some((x) => typeof x === 'string' && x.trim().toLowerCase() === plan)
      if (!planOk)
        errors.push(
          `账户计划源 alias=${alias}（uuid_prefix=${def.uuid_prefix}）未通过本机允许清单校验——` +
            `account:<计划名> 前缀类不走宿主注册表双命中，计划名须列入顶层 account_plan_allowlist（本机件）后重跑 validate；` +
            `借道宿主注册表 builtin 同名残条＝归因造假，禁止`,
        )
      continue
    }
    const hit = entries.find(([id, p]) => id.startsWith(def.uuid_prefix) && p && p.name === def.entry_name)
    if (!hit) {
      const near = entries.find(([id]) => id.startsWith(def.uuid_prefix))
      errors.push(
        `源校验失败 alias=${alias} 期望 uuid前缀=${def.uuid_prefix} name=${def.entry_name} ` +
          `实际=${near ? near[0] + '(name=' + (near[1]?.name ?? 'null') + ')' : '无该前缀条目'}（未入链的声明源亦须双校验通过）`,
      )
    }
  }
  // 2026-10-03 清理批次：source_chain/roles.source 校验随派发器删除而删
  // （源序与岗位选源语义=派发器时代概念；现役承载=绑定子代理，详见 git 历史）。
  return errors
}

/** 跨门岗对结构校验（v2.1.0 批，07 §4 纪律⑤；返工 W8 强化）：二元代理名对数组；
 *  命名空间=代理名（须存在 templates/agents/<名>.md 模板——防与 gate1_subagent_of
 *  的**别名**命名空间混写）；拒自配对与重复对。绑定实况同族核对=log-triage
 *  --health ⑧ 的职责（读部署面 frontmatter）。缺席=合法（可选项）。返回错误数组。 */
export function validateCrossGatePairs(cfg) {
  const errors = []
  const pairs = cfg?.source_health?.cross_gate_pairs
  if (pairs === undefined) return errors
  if (!Array.isArray(pairs)) {
    errors.push('source_health.cross_gate_pairs 须为数组（[["代理A","代理B"],…] 二元代理名对）')
    return errors
  }
  const seen = new Set()
  pairs.forEach((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || p.some((x) => typeof x !== 'string' || !x.trim())) {
      errors.push(`source_health.cross_gate_pairs[${i}] 须为二元代理名对（收到 ${JSON.stringify(p)}）`)
      return
    }
    if (p[0] === p[1]) errors.push(`source_health.cross_gate_pairs[${i}] 自配对（${p[0]}↔${p[1]}）——无意义形态，拒收`)
    const key = [...p].sort().join('↔')
    if (seen.has(key)) errors.push(`source_health.cross_gate_pairs[${i}] 重复对（${key}）`)
    seen.add(key)
    for (const agent of p) {
      if (!existsSync(join(SKILL_ROOT, 'templates', 'agents', `${agent}.md`)))
        errors.push(`source_health.cross_gate_pairs[${i}] 成员「${agent}」无对应模板（templates/agents/${agent}.md）——命名空间=代理名，勿用源别名（别名域=gate1_subagent_of）`)
    }
  })
  return errors
}

/** 本机事实占位校验（v2.1.0 返工 W9a）：vision_channels 通道与 agent_bindings 值
 *  的 TODO 占位=新机静默降级面（看图通道/绑定渲染失效），validate 拒收。
 *  R-L19-1 绑定源一致性增查：绑定键经 slot 表解析出计划源 provider（uuid_prefix 以
 *  `account:` 开头）时，绑定值斜杠前段须与该 uuid_prefix 全串一致——计划源绑定不认
 *  宿主短前缀形态；错误行点名 slot＋期望＋实际。注册表源与无 slot 键不查（不扩面）。 */
export function validateLocalFacts(cfg) {
  const errors = []
  for (const [ch, def] of Object.entries(cfg?.vision_channels || {})) {
    if (def && typeof def === 'object' && def.model === 'TODO')
      errors.push(`vision_channels.${ch}.model=TODO 占位——填本机件实值（glm-look 通道甄别消费）`)
  }
  for (const [agent, v] of Object.entries(cfg?.agent_bindings || {})) {
    if (v === 'TODO' || v === '') {
      errors.push(`agent_bindings.${agent} 为占位/空——绑定模板渲染消费（deploy-check ④）`)
      continue
    }
    const slotDef = cfg?.agent_slots?.[agent]
    const alias = slotDef && typeof slotDef === 'object' ? slotDef.provider : null
    const provDef = alias && cfg?.providers?.[alias]
    const up = provDef && typeof provDef === 'object' && typeof provDef.uuid_prefix === 'string' ? provDef.uuid_prefix.trim() : ''
    if (up.toLowerCase().startsWith('account:') && typeof v === 'string' && v.includes('/')) {
      const front = v.slice(0, v.indexOf('/')).trim()
      if (front !== up)
        errors.push(`agent_bindings.${agent}（slot=${agent}）绑定值斜杠前段与计划源 uuid_prefix 全串不一致——期望=${up} 实际=${front}（计划源绑定值须以 account:<计划名> 全串开头，R-L19-1）`)
    }
  }
  // 装配岗批（D-3/D-4 配置面护栏）：agent_bindings 中符合 SLOT_NAME_RE 的键须 ⊆ agent_slots
  // （先槽后绑的时序护栏——default 件与本机件槽/绑两面对账）；note 等非槽形元数据键
  // （不合命名契约者）天然豁免不报，ops-free-x 既有正例期望零错误不变。
  for (const agent of Object.keys(cfg?.agent_bindings || {})) {
    if (!SLOT_NAME_RE.test(agent)) continue
    const hasSlot = cfg?.agent_slots != null && typeof cfg.agent_slots === 'object'
      && Object.prototype.hasOwnProperty.call(cfg.agent_slots, agent)
    if (!hasSlot)
      errors.push(`agent_bindings.${agent} 绑定键无对应 agent_slots 槽——合命名契约的绑定键须 ⊆ agent_slots（default 件先落槽、本机件后落绑）`)
  }
  // B4 面板批（D-1）：thought_level_overrides 覆盖层校验——非对象/未知角色/非法档位
  // 逐条错误行（fail-closed）；键缺席与空对象均合法。default 件不加此键。
  if (cfg?.thought_level_overrides !== undefined) {
    const tlo = cfg.thought_level_overrides
    if (!isPlainObject(tlo))
      errors.push('thought_level_overrides 须为 plain object（角色→low|high|max 映射）')
    else
      for (const [role, lv] of Object.entries(tlo)) {
        if (!REQUIRED_AGENT_ROLES.includes(role))
          errors.push(`thought_level_overrides.${role} 未知角色——仅允许 ${REQUIRED_AGENT_ROLES.join(', ')}`)
        if (!['low', 'high', 'max'].includes(lv))
          errors.push(`thought_level_overrides.${role}=${JSON.stringify(lv)} 非法档位——仅允许 low|high|max`)
      }
  }
  return errors
}

/** slot schema 校验（P1 批，09-migration-plan §4.1）：agent_slots/agent_defaults/
 *  role_fallbacks 结构与语义。返回错误数组（空=通过），不抛（CLI 汇总并列）。
 *  唯一事实源=docs/agent-matrix.json（生成期）；本函数只校结构一致性与跨族/视觉约束：
 *  ① slot 键=ops-<role>-<provider>-<level> 且与值三字段完全一致；角色集须等于固定
 *     九角色集（不由现存 slot 反推——缺任一角色=错误；B2 批 D-8：三审拆岗＋诊断退役）；
 *  ② provider 须在 cfg.providers 以**自有键**声明且为普通对象，禁 legacy:true
 *     （只允许短名；own-property 判定防 constructor/toString 等原型链键冒充）；
 *  ③ level∈low/high/max、model 非空字符串；
 *  ④ agent_defaults 键集=固定九角色集（全覆盖、无多余键），默认档位存在且角色一致；
 *  ⑤ role_fallbacks 键集=固定九角色集、非空、无重复、首元素=默认档位、成员存在且角色一致；
 *  ⑥ 默认 executor 与 implreview/adjudicator 跨族（familyOf；slot/provider/family
 *     任一不可解析=显式错误，fail-closed）；
 *  ⑦ 默认 vision 的 slot/provider 必须可解析且 provider.multimodal===true，
 *     或 provider 恰为 startplan（B2 批 D-7a 文本应急例外——与 verify-docs/
 *     gen-agents/agent-slots 四面同款谓词；解析失败、缺键、其余非 true 均报错）。
 *  返工轮 1（审核 B-1/B-2）：必需角色集固定为模块常量；所有 providers/slots/
 *  defaults/fallbacks 的成员判定一律 own-property 限定——解析失败返回**显式失败
 *  标记**（{ok:false,reason}），不再以 null 表示并由调用方静默跳过。 */
const SLOT_NAME_RE = /^ops-(research|planner|assembler|executor|tbreview|planreview|implreview|adjudicator|vision)-([a-z0-9]+)-(low|high|max)$/
const SLOT_LEVELS = new Set(['low', 'high', 'max'])
const REQUIRED_AGENT_ROLES = ['research', 'planner', 'assembler', 'executor', 'tbreview', 'planreview', 'implreview', 'adjudicator', 'vision']
const REQUIRED_AGENT_ROLE_SET = new Set(REQUIRED_AGENT_ROLES)
export function validateAgentSlots(cfg) {
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
  const errors = []
  const slots = cfg?.agent_slots
  if (!isPlainObject(slots) || Object.keys(slots).length === 0) {
    errors.push('agent_slots 缺失/非对象/为空——slot schema 必填（P1：ops-<role>-<provider>-<level> → {provider,model,level}）')
    return errors
  }
  const providers = isPlainObject(cfg?.providers) ? cfg.providers : {}
  const roleOf = new Map() // slot 名 → 角色（仅键名合法者可推导）
  for (const [name, def] of Object.entries(slots)) {
    const m = SLOT_NAME_RE.exec(name)
    if (!m) {
      errors.push(`agent_slots 键「${name}」不合命名契约 ops-<role>-<provider>-<level>（role∈${REQUIRED_AGENT_ROLES.join('|')}；provider=[a-z0-9]+；level∈low|high|max）`)
      continue
    }
    const [, role, provider, level] = m
    roleOf.set(name, role)
    if (!isPlainObject(def)) {
      errors.push(`agent_slots.${name} 须为对象 {provider,model,level}（收到 ${def === null ? 'null' : typeof def}）`)
      continue
    }
    if (def.provider !== provider) errors.push(`agent_slots.${name} 的 provider 段=「${provider}」但值对象 provider=「${def.provider}」——键名与值须完全一致`)
    if (def.level !== level) errors.push(`agent_slots.${name} 的 level 段=「${level}」但值对象 level=「${def.level}」——键名与值须完全一致`)
    if (!SLOT_LEVELS.has(def.level)) errors.push(`agent_slots.${name}.level=${JSON.stringify(def.level)} 非法——须为 low/high/max`)
    if (typeof def.model !== 'string' || !def.model.trim()) errors.push(`agent_slots.${name}.model 须为非空字符串（收到 ${JSON.stringify(def.model)}）`)
    // B-2：own + isPlainObject 双判——providers.constructor 等原型链键不得冒充 provider
    if (typeof def.provider !== 'string' || !own(providers, def.provider) || !isPlainObject(providers[def.provider])) {
      errors.push(`agent_slots.${name} 引用未声明/非对象的 provider「${def.provider}」——须在 providers 以短名键（own-property）声明且为对象`)
    } else if (providers[def.provider].legacy === true) {
      errors.push(`agent_slots.${name} 引用 legacy provider「${def.provider}」（legacy:true）——slot 只允许短名键，旧键仅供 P2 前脚本兼容`)
    }
  }
  // ① B-1：角色集必须等于固定九角色集（不能只看 slot/default/fallback 自洽）
  const slotRoles = new Set(roleOf.values())
  for (const role of REQUIRED_AGENT_ROLES)
    if (!slotRoles.has(role)) errors.push(`agent_slots 缺必需角色「${role}」——角色集须等于固定九角色集（${REQUIRED_AGENT_ROLES.join(', ')}），不由现存 slot 反推`)
  const defaults = cfg?.agent_defaults
  if (!isPlainObject(defaults)) {
    errors.push('agent_defaults 缺失/非对象——须为 角色→默认 slot 名 映射（固定九角色全覆盖）')
  } else {
    for (const role of REQUIRED_AGENT_ROLES)
      if (!own(defaults, role)) errors.push(`agent_defaults 缺必需角色「${role}」——固定九角色须全覆盖`)
    for (const role of Object.keys(defaults))
      if (!REQUIRED_AGENT_ROLE_SET.has(role)) errors.push(`agent_defaults 多余键「${role}」——只允许固定九角色键（${REQUIRED_AGENT_ROLES.join(', ')}）`)
    for (const [role, slotName] of Object.entries(defaults)) {
      if (typeof slotName !== 'string' || !own(slots, slotName)) {
        errors.push(`agent_defaults.${role} 指向不存在的 slot「${slotName}」——须引用 agent_slots 已声明键`)
        continue
      }
      if (!isPlainObject(slots[slotName])) {
        errors.push(`agent_defaults.${role} 指向的 slot「${slotName}」非对象——默认档位无法解析（fail-closed）`)
        continue
      }
      if (roleOf.get(slotName) !== role) errors.push(`agent_defaults.${role} 指向 slot「${slotName}」但该 slot 角色=${roleOf.get(slotName) ?? '?'}——角色不一致（默认档位不许跨角色）`)
    }
  }
  const fallbacks = cfg?.role_fallbacks
  if (!isPlainObject(fallbacks)) {
    errors.push('role_fallbacks 缺失/非对象——须为 角色→slot 名数组 映射（固定九角色全覆盖）')
  } else {
    for (const role of REQUIRED_AGENT_ROLES)
      if (!own(fallbacks, role)) errors.push(`role_fallbacks 缺必需角色「${role}」——固定九角色须全覆盖`)
    for (const role of Object.keys(fallbacks))
      if (!REQUIRED_AGENT_ROLE_SET.has(role)) errors.push(`role_fallbacks 多余键「${role}」——只允许固定九角色键（${REQUIRED_AGENT_ROLES.join(', ')}）`)
    for (const [role, seq] of Object.entries(fallbacks)) {
      if (!Array.isArray(seq) || seq.length === 0) {
        errors.push(`role_fallbacks.${role} 须为非空数组（回退序不能为空）`)
        continue
      }
      const seen = new Set()
      for (const slotName of seq) {
        if (seen.has(slotName)) errors.push(`role_fallbacks.${role} 重复项「${slotName}」——回退序须无重复`)
        seen.add(slotName)
      }
      if (isPlainObject(defaults) && own(defaults, role) && seq[0] !== defaults[role])
        errors.push(`role_fallbacks.${role} 首元素「${seq[0]}」≠ agent_defaults.${role}「${defaults[role]}」——首元素须等于默认档位`)
      for (const slotName of seq) {
        if (typeof slotName !== 'string' || !own(slots, slotName)) {
          errors.push(`role_fallbacks.${role} 成员「${slotName}」不存在于 agent_slots——回退序须引用已声明 slot`)
          continue
        }
        if (!isPlainObject(slots[slotName])) {
          errors.push(`role_fallbacks.${role} 成员「${slotName}」非对象——回退序无法解析（fail-closed）`)
          continue
        }
        if (roleOf.get(slotName) !== role) errors.push(`role_fallbacks.${role} 成员「${slotName}」角色=${roleOf.get(slotName) ?? '?'}——角色不一致`)
      }
    }
  }
  // ⑥ B-1/B-2：默认档位解析器——own + isPlainObject，任何一步失败返回显式失败标记
  // （调用方对 executor/implreview/adjudicator 分别生成错误行，不再 null 静默跳过）。
  const resolveDefault = (role) => {
    if (!isPlainObject(defaults)) return { ok: false, reason: 'agent_defaults 缺失/非对象' }
    if (!own(defaults, role)) return { ok: false, reason: `agent_defaults 缺角色「${role}」` }
    const slotName = defaults[role]
    if (typeof slotName !== 'string' || !slotName) return { ok: false, reason: `默认值不是非空字符串（收到 ${JSON.stringify(slotName)}）` }
    if (!own(slots, slotName)) return { ok: false, reason: `slot「${slotName}」不存在` }
    const slot = slots[slotName]
    if (!isPlainObject(slot)) return { ok: false, reason: `slot「${slotName}」不是对象` }
    if (typeof slot.provider !== 'string' || !slot.provider) return { ok: false, reason: `slot「${slotName}」缺 provider 字段` }
    if (!own(providers, slot.provider) || !isPlainObject(providers[slot.provider])) return { ok: false, reason: `provider「${slot.provider}」未声明/非对象` }
    const prov = providers[slot.provider]
    return { ok: true, slot: slotName, provider: slot.provider, family: familyOf(prov) }
  }
  const resolved = {}
  for (const role of ['executor', 'implreview', 'adjudicator']) {
    const hit = resolveDefault(role)
    resolved[role] = hit
    if (!hit.ok) errors.push(`agent 默认档位无法解析（agent_defaults.${role}）：${hit.reason}——须指向已声明 slot 与 provider（fail-closed）`)
    else if (!hit.family) errors.push(`agent 跨族校验不可构成：agent_defaults.${role}（slot=${hit.slot}, provider=${hit.provider}）的 family/model_family 无法解析——fail-closed（不同模型族不可证明=不通过）`)
  }
  const sameFamily = (a, b) => !!(resolved[a].ok && resolved[a].family && resolved[b].ok && resolved[b].family && resolved[a].family === resolved[b].family)
  if (sameFamily('executor', 'implreview'))
    errors.push(`agent 跨族校验失败：默认 executor 与 implreview 同族（family=${resolved.executor.family}）——不同模型族对抗退化（executor=${resolved.executor.slot}, implreview=${resolved.implreview.slot}）`)
  if (sameFamily('executor', 'adjudicator'))
    errors.push(`agent 跨族校验失败：默认 executor 与 adjudicator 同族（family=${resolved.executor.family}）——不同模型族对抗退化（executor=${resolved.executor.slot}, adjudicator=${resolved.adjudicator.slot}）`)
  // ⑦ vision：解析失败（slot/provider 缺失或非对象）必须显式报错，不得跳过 multimodal
  // 检查；谓词=multimodal===true 或 provider 恰为 startplan（B2 批 D-7a 文本应急例外——
  // multimodal:false 是实测事实，不承载图像判读）。
  if (isPlainObject(defaults)) {
    const vHit = resolveDefault('vision')
    if (!vHit.ok) errors.push(`agent_defaults.vision 默认档位无法解析：${vHit.reason}——vision 须指向已声明 slot 与 provider（fail-closed）`)
    else {
      const vProv = providers[vHit.provider] // vHit.ok 保证 own + isPlainObject
      if (vHit.provider !== 'startplan' && vProv.multimodal !== true)
        errors.push(`agent_defaults.vision 指向 slot「${vHit.slot}」的 provider「${vHit.provider}」multimodal=${JSON.stringify(vProv.multimodal)}——vision 只收 multimodal===true 的源（缺键或非 true 均拒；startplan 例外=文本应急候选）`)
    }
  }
  // ⑧ 同一 provider 的岗位归属由 ① 键名一致性覆盖，不额外实现（任务书 §4.2-8）。
  return errors
}

// ── CLI（B8 D-5 预检闭集→B8 r4 哨兵→B8 D-4 notice→self-test→装载→分派）──
const isMain =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
/** B8 D-5：参数组合闭集前置校验（先于 notice/装载/任何写入；用法错=UsageError→exit 1）。
 *  合法形态闭集：--self-test 单独｜[--project D] resolve|hash|validate｜flags｜flags get NAME｜
 *  flags set NAME on|off。返回 {projectDir, cmd, rest}（cmd='--self-test' 为单独自检态）。 */
export function precheckOrgCli(argv, cwd = process.cwd()) {
  const usage = (m) => { throw new UsageError(m) }
  const eq = argv.find((a) => typeof a === 'string' && a.startsWith('--') && a.includes('='))
  if (eq !== undefined) usage(`等号形态「${eq}」不支持——flag 一律空格分隔取值`)
  if (argv.includes('--self-test')) {
    if (argv.length !== 1) usage('--self-test 须单独使用（与命令/其他参数互斥——B8 D-5）')
    return { projectDir: cwd, cmd: '--self-test', rest: [] }
  }
  const unknownFlag = argv.find((a) => typeof a === 'string' && a.startsWith('--') && a !== '--project')
  if (unknownFlag !== undefined) usage(`未知参数：${unknownFlag}（本脚本仅提供 --project 取值参与命令词）`)
  const projectDir = cliFlag(argv, '--project') || cwd // cliFlag 三校验（重复/末位缺值/值形如 flag）→UsageError
  const positional = argv.filter((a, i) => typeof a === 'string' && !a.startsWith('--') && argv[i - 1] !== '--project')
  const cmd = positional[0]
  if (cmd === undefined) usage('缺命令：resolve|hash|validate|flags（或 --self-test 单独使用）')
  if (!['resolve', 'hash', 'validate', 'flags'].includes(cmd)) usage(`未知命令「${cmd}」（可用：resolve|hash|validate|flags）`)
  const rest = positional.slice(1)
  if (cmd !== 'flags' && rest.length) usage(`${cmd} 不收额外位置参数（收到：${rest.join(',')}）`)
  if (cmd === 'flags') {
    const sub = rest[0] === undefined ? 'list' : rest[0]
    if (!['list', 'get', 'set'].includes(sub)) usage(`未知 flags 子命令「${sub}」（可用：list/get/set）`)
    if (sub === 'list' && rest.length > 1) usage(`flags list 不收额外位置参数（收到：${rest.slice(1).join(',')}）`)
    if (sub === 'get') {
      if (rest.length < 2) usage('flags get 缺 name（形态：flags get <name>）')
      if (rest.length > 2) usage(`flags get 不收额外位置参数（收到：${rest.slice(2).join(',')}）`)
    }
    if (sub === 'set') {
      if (rest.length < 2) usage('flags set 缺 name（形态：flags set <name> on|off）')
      if (rest.length < 3) usage('flags set 缺 value（形态：flags set <name> on|off）')
      if (rest[2] !== 'on' && rest[2] !== 'off') usage(`flag 取值须 on|off（收到「${rest[2]}」）`)
      if (rest.length > 3) usage(`flags set 不收额外位置参数（收到：${rest.slice(3).join(',')}）`)
    }
  }
  return { projectDir, cmd, rest }
}
if (isMain) {
  const argv = process.argv.slice(2)
  // g3 批（evolve-l4-flags）：--project 裸 indexOf 改走单源 cliFlag（重复/末位
  // 缺值/值形如 flag→[用法错] exit 1——原裸取 argv[i+1] 缺值时 undefined 崩装载）
  let projectDir = process.cwd(), cmd = null, rest = []
  try {
    ({ projectDir, cmd, rest } = precheckOrgCli(argv)) // B8 D-5：闭集前置校验（先于 notice/装载/任何写入）
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`[用法错] ${e.message}`)
      process.exit(1)
    }
    throw e
  }
  if (cmd === '--self-test' && process.env.ORG_B8_TEST_DEPTH) { console.error('[sentinel] self-test rejected（ORG_B8_TEST_DEPTH 在环境——自检副本递归守卫·B8 r4）'); process.exit(1) }
  const fsEnv = process.env.ORG_FLAGS_STATE // B8 D-4：env notice（stderr 单行·预检后装载前·只显示路径与来源，不读不印状态内容）
  if (cmd !== '--self-test') console.error(fsEnv ? `[notice] ORG_FLAGS_STATE=override:${resolve(fsEnv)}（显式覆盖）` : `[notice] ORG_FLAGS_STATE=default:${join(SKILL_ROOT, '.zcode', 'org-flags.json')}（未设置，使用缺省）`)

  if (cmd === '--self-test') {
    let fails = 0, n = 0
    const t = (name, cond) => (n++, console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`), cond || fails++)
    const base = { a: { x: 1, y: 2 }, b: [1, 2], c: 3 }
    t('对象逐字段覆盖+未提及沿用', JSON.stringify(deepMerge(base, { a: { x: 9 } })) === JSON.stringify({ a: { x: 9, y: 2 }, b: [1, 2], c: 3 }))
    t('数组整体替换', JSON.stringify(deepMerge(base, { b: [3] }).b) === '[3]')
    t('显式 null=删除', deepMerge(base, { a: null }).a === undefined)
    t('null 于新增键=不新增', deepMerge(base, { d: null }).d === undefined)
    t('哈希键序无关', cfgHash({ x: 1, y: { b: 2, a: 3 } }) === cfgHash({ y: { a: 3, b: 2 }, x: 1 }))
    t('哈希剔 null（对象键）', cfgHash({ x: 1, y: null }) === cfgHash({ x: 1 }))
    t('哈希剔 null（数组元素，顺序保留）', cfgHash({ s: ['a', null, 'b'] }) === cfgHash({ s: ['a', 'b'] }) && cfgHash({ s: ['b', 'a'] }) !== cfgHash({ s: ['a', 'b'] }))
    // b4 向量（evolve-E2）：null provider 守卫——validateProviders 不崩+明确校验错误行+近邻提示 null 宿主条目安全
    const vpHost = { provider: { 'b4null-0000': null, 'b4live-9999': { name: 'LIVE-ENTRY' } } }
    let vpErr = null
    try { vpErr = validateProviders({ providers: { dead: null, live: { uuid_prefix: 'b4live', entry_name: 'LIVE-ENTRY' }, nearnull: { uuid_prefix: 'b4null', entry_name: 'X' } } }, vpHost) } catch (e) { vpErr = `THREW:${e.message}` }
    t('b4 null provider→校验错误行（不崩）', Array.isArray(vpErr) && vpErr.some((e) => e.includes('providers.dead') && e.includes('null')))
    t('b4 近邻提示 null 宿主条目不崩（near?.[1]?.name）', Array.isArray(vpErr) && vpErr.some((e) => e.includes('alias=nearnull') && e.includes('name=null')))
    t('b4 健康源不受 null 条目影响（live 双校验通过不出错行）', Array.isArray(vpErr) && !vpErr.some((e) => e.includes('alias=live 期望')))
    // 2026-10-03 清理批次：validateRoleSurfaces 五向量随 registry/DoD 删除而删
    // （执法面⇔DoD 同构机检退役；⑥ 执法面仍由 findings_surface 标志承载，
    //   标志与代理档案尾栏的同构重建=下场批候选）。
    // g3 批（evolve-l4-flags 补还）向量：cliFlag 三校验——红态=旧实现不抛
    // （重复返回首值/末位取 undefined/值形如 flag 原样返回）→向量 FAIL 不崩
    const g3run = (fn) => { try { return { v: fn() } } catch (e) { return { e } } }
    t('g3 cliFlag：缺席→null（现语义不变）', (() => { const r = g3run(() => cliFlag(['--b', 'x'], '--a')); return r.e === undefined && r.v === null })())
    t('g3 cliFlag：正常取值', (() => { const r = g3run(() => cliFlag(['--b', 'v1'], '--b')); return r.e === undefined && r.v === 'v1' })())
    t('g3 cliFlag：同名 flag 出现≥2 次→UsageError', (() => { const r = g3run(() => cliFlag(['--b', '1', '--b', '2'], '--b')); return r.e?.constructor?.name === 'UsageError' })())
    t('g3 cliFlag：flag 居末位（无值）→UsageError', (() => { const r = g3run(() => cliFlag(['--b'], '--b')); return r.e?.constructor?.name === 'UsageError' })())
    t('g3 cliFlag：下一 token 以 -- 开头（值形如 flag）→UsageError', (() => { const r = g3run(() => cliFlag(['--b', '--c'], '--b')); return r.e?.constructor?.name === 'UsageError' })())
    t('g3 cliFlag：单 - 开头值（负数）放行', (() => { const r = g3run(() => cliFlag(['--hours', '-3'], '--hours')); return r.e === undefined && r.v === '-3' })())
    t('g3 cliFlag：UsageError 不带 exitCode 属性（消费点显式 exit 1）', (() => { const r = g3run(() => cliFlag(['--b'], '--b')); return r.e?.constructor?.name === 'UsageError' && r.e.exitCode === undefined })())
    // selfiter 批（g3-cliflag-equals 立场）向量：等号形态拒收——红态=旧实现
    // 不识别该形态、静默判缺席返 null（fail-fast 相左面）
    t('selfiter cliFlag：等号形态 --b=v →UsageError（拒收并点名）', (() => { const r = g3run(() => cliFlag(['--b=v'], '--b')); return r.e?.constructor?.name === 'UsageError' && String(r.e.message).includes('--b=v') })())
    t('selfiter cliFlag：等号形态仅对被查询 flag 判拒（查 --c 拒并点名/--b 正常取值不受累）', (() => { const r1 = g3run(() => cliFlag(['--b', 'v1', '--c=v'], '--c')); const r2 = g3run(() => cliFlag(['--b', 'v1', '--c=v'], '--b')); return r1.e?.constructor?.name === 'UsageError' && String(r1.e.message).includes('--c=v') && r2.e === undefined && r2.v === 'v1' })())
    // selfiter 批（B4 evolve-m6-runid）向量：跨进程建议锁——正常获锁/陈旧破锁/结果直通
    let lockDir = null
    try {
      lockDir = mkdtempSync(join(tmpdir(), 'oc-lock-'))
      const lk1 = join(lockDir, 'a.lock')
      const v1r = withFileLock(lk1, () => 'RAN')
      t('B4 锁：获锁执行+fn 结果直通+锁件随释清除', v1r === 'RAN' && !existsSync(lk1))
      const lk2 = join(lockDir, 'b.lock')
      writeFileSync(lk2, 'stale-holder\n', 'utf8')
      const old = new Date(Date.now() - 60_000)
      utimesSync(lk2, old, old)
      const v2r = withFileLock(lk2, () => 'STALE-BROKE')
      t('B4 锁：陈旧锁（>staleMs）破锁续行', v2r === 'STALE-BROKE' && !existsSync(lk2))
    } catch { t('B4 锁：临时目录异常', false) }
    finally { if (lockDir) rmSync(lockDir, { recursive: true, force: true }) }
    // selfiter 批（B5 流式化）向量：SSE 解析与收割（纯函数）
    const sseRaw = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"SSE-"}}\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"OK"}}\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\ndata: [DONE]\n'
    const sseEv = parseSseText(sseRaw)
    t('B5 parseSseText：event:/空行/[DONE] 滤除，data 载荷按序 4 件', sseEv.length === 4 && sseEv[0].type === 'message_start')
    const aCol = collectAnthropicSse(sseEv)
    t('B5 anthropic 收割：文本拼接+stop_reason+双侧 usage', aCol.content[0]?.text === 'SSE-OK' && aCol.stop_reason === 'end_turn' && aCol.usage.input_tokens === 11 && aCol.usage.output_tokens === 7)
    const oCol = collectOpenaiSse([{ choices: [{ delta: { content: 'A' } }] }, { choices: [{ delta: { content: 'B' }, finish_reason: 'stop' }] }, { choices: [{ delta: {} }], usage: { prompt_tokens: 3, completion_tokens: 4 } }])
    t('B5 openai 收割：delta 累积+finish+末块 usage', oCol.choices[0].message.content === 'AB' && oCol.choices[0].finish_reason === 'stop' && oCol.usage.prompt_tokens === 3)
    t('B5 空事件流→空形态不崩（保守）', collectAnthropicSse([]).content.length === 0 && collectOpenaiSse([]).choices[0].message.content === '' && collectOpenaiSse([]).choices[0].finish_reason === null)
    // v2.1.0 三层化批向量：占位源 fail-fast 指引+跨门岗对结构校验
    const vpTodo = validateProviders({ providers: { demo: { uuid_prefix: 'TODO', entry_name: 'TODO' } } }, { provider: {} })
    t('v2.1.0 占位源→尚未本机化指引错误行（不进双校验）', vpTodo.some((e) => e.includes('providers.demo') && e.includes('尚未本机化') && e.includes('org-config.local.json')))
    const vpNoFam = validateProviders({ providers: { demo: { uuid_prefix: 'aaaaaaaa', entry_name: 'E-A', model_family: undefined } } }, { provider: { 'aaaaaaaa-1111': { name: 'E-A' } } })
    t('v2.1.0 返工：非占位源缺 model_family→错误行（异族校验消费面）', vpNoFam.some((e) => e.includes('providers.demo 缺 model_family')))
    // L19 账户计划源向量：account:<计划名> 前缀走本机允许清单（不走宿主注册表双命中）；
    // 夹具全合成计划名/空宿主注册表（计划源不消费注册表——空注册表也应命中通过）。
    const planHost = { provider: {} }
    t('L19 计划源①：account: 前缀＋清单命中→零错误（空注册表通过＝跳过双命中）', validateProviders({ providers: { startplan: { uuid_prefix: 'account:demo-plan', entry_name: 'Demo Plan', family: 'glm' } }, account_plan_allowlist: ['demo-plan'] }, planHost).length === 0)
    t('L19 计划源②：allowlist 缺失→错误行（守卫点名键名）', (() => { const e = validateProviders({ providers: { startplan: { uuid_prefix: 'account:x-plan', entry_name: 'P', family: 'glm' } } }, planHost); return e.some((m) => m.includes('account_plan_allowlist')) })())
    t('L19 计划源③：计划名不在清单→错误行（点名 alias 与键名）', (() => { const e = validateProviders({ providers: { startplan: { uuid_prefix: 'account:x-plan', entry_name: 'P', family: 'glm' } }, account_plan_allowlist: ['other-plan'] }, planHost); return e.some((m) => m.includes('alias=startplan') && m.includes('account_plan_allowlist') && m.includes('归因造假')) })())
    t('L19 计划源④：allowlist 非数组→错误行（形态守卫 fail-closed）', (() => { const e = validateProviders({ providers: { startplan: { uuid_prefix: 'account:x-plan', entry_name: 'P', family: 'glm' } }, account_plan_allowlist: 'x-plan' }, planHost); return e.some((m) => m.includes('account_plan_allowlist')) })())
    t('L19 计划源⑤回归：注册表源既有行为不变（非 account: 前缀仍走双命中——命中零错/不命中报错）', validateProviders({ providers: { demo: { uuid_prefix: 'reg9999', entry_name: 'E-R', model_family: 'kimi' } } }, { provider: { 'reg9999-0000': { name: 'E-R' } } }).length === 0 && validateProviders({ providers: { demo: { uuid_prefix: 'reg9999', entry_name: 'E-R', model_family: 'kimi' } } }, { provider: {} }).length === 1)
    t('v2.1.0 跨门对：合法二元对（真模板名）→零错误', validateCrossGatePairs({ source_health: { cross_gate_pairs: [['ops-implreview-ds-max', 'ops-adjudicator-699-max']] } }).length === 0)
    t('v2.1.0 跨门对：三元对→结构错误行', validateCrossGatePairs({ source_health: { cross_gate_pairs: [['a', 'b', 'c']] } }).some((e) => e.includes('cross_gate_pairs[0]')))
    t('v2.1.0 跨门对：非字符串成员→结构错误行', validateCrossGatePairs({ source_health: { cross_gate_pairs: [['a', 1]] } }).length >= 1)
    t('v2.1.0 跨门对：非数组形态→结构错误行', validateCrossGatePairs({ source_health: { cross_gate_pairs: 'x' } }).some((e) => e.includes('须为数组')))
    t('v2.1.0 跨门对：缺席→零错误（可选项——轮2 N-5 回补契约向量）', validateCrossGatePairs({}).length === 0 && validateCrossGatePairs({ source_health: {} }).length === 0)
    t('v2.1.0 返工：跨门对成员无模板→命名空间错误行（防别名混写）', validateCrossGatePairs({ source_health: { cross_gate_pairs: [['kimi-main', 'ops-adjudicator-699-max']] } }).some((e) => e.includes('kimi-main」无对应模板')))
    t('v2.1.0 返工：跨门对自配对→拒收', validateCrossGatePairs({ source_health: { cross_gate_pairs: [['ops-implreview-699-max', 'ops-implreview-699-max']] } }).some((e) => e.includes('自配对')))
    t('v2.1.0 返工：跨门对重复对→拒收', validateCrossGatePairs({ source_health: { cross_gate_pairs: [['ops-implreview-699-max', 'ops-adjudicator-699-max'], ['ops-adjudicator-699-max', 'ops-implreview-699-max']] } }).some((e) => e.includes('重复对')))
    t('v2.1.0 返工：vision 通道 model=TODO→占位错误行', validateLocalFacts({ vision_channels: { glm: { model: 'TODO' } } }).some((e) => e.includes('vision_channels.glm.model=TODO')))
    t('v2.1.0 返工：agent_bindings 占位/空→错误行', validateLocalFacts({ agent_bindings: { 'ops-x': 'TODO' } }).some((e) => e.includes('agent_bindings.ops-x')))
    t('v2.1.0 返工：本机事实占位校验净配置→零错误', validateLocalFacts({}).length === 0 && validateLocalFacts({ vision_channels: { glm: { model: 'REAL' } }, agent_bindings: { x: 'v/k3$max' } }).length === 0)
    // B4 面板批（D-1）向量：thought_level_overrides 校验六态＋三层合并透传（loader 零改）
    t('B4 D-1：键缺席→零错误（回归锁）', validateLocalFacts({}).length === 0)
    t('B4 D-1：空对象→零错误（合法）', validateLocalFacts({ thought_level_overrides: {} }).length === 0)
    t('B4 D-1：合法正例（research=max·vision=low）→零错误', validateLocalFacts({ thought_level_overrides: { research: 'max', vision: 'low' } }).length === 0)
    t('B4 D-1：非 plain object（串/数组）→错误行', validateLocalFacts({ thought_level_overrides: 'max' }).some((e) => e.includes('thought_level_overrides')) && validateLocalFacts({ thought_level_overrides: ['max'] }).some((e) => e.includes('thought_level_overrides')))
    t('B4 D-1：未知角色 wizard→错误行点名', validateLocalFacts({ thought_level_overrides: { wizard: 'max' } }).some((e) => e.includes('wizard')))
    t('B4 D-1：非法档位 ultra→错误行点名 research', validateLocalFacts({ thought_level_overrides: { research: 'ultra' } }).some((e) => e.includes('research') && e.includes('ultra')))
    t('B4 D-1：local 层含 overrides→mergeOrgLayers 合并结果原样透传（loadOrgConfig 由此三读一合并组成）', (() => { const m = mergeOrgLayers({ a: 1 }, { thought_level_overrides: { research: 'max' } }, null); return JSON.stringify(m.thought_level_overrides) === '{"research":"max"}' })())
    // B4 返工 R2（699-W1/ds-N3）：真正走 loadOrgConfig 的透传向量——/tmp 夹具技能根（源复制＋default/local 两件），生产件零写。
    {
      const fxLoad = mkdtempSync(join(tmpdir(), 'orgcfg-load-'))
      try {
        mkdirSync(join(fxLoad, 'scripts'), { recursive: true })
        copyFileSync(fileURLToPath(import.meta.url), join(fxLoad, 'scripts', 'org-config.mjs'))
        writeFileSync(join(fxLoad, 'org-config.default.json'), '{"a":1}\n'); writeFileSync(join(fxLoad, 'org-config.local.json'), '{"b":2,"thought_level_overrides":{"research":"max"}}\n')
        const fxMod = await import(pathToFileURL(join(fxLoad, 'scripts', 'org-config.mjs')).href)
        const loadedFx = fxMod.loadOrgConfig(fxLoad)
        t('B4 D-1 装载：loadOrgConfig(/tmp 夹具根) 合并结果原样透传 local 层 thought_level_overrides', loadedFx.hasLocal === true && JSON.stringify(loadedFx.merged.thought_level_overrides) === '{"research":"max"}' && fxMod.validateLocalFacts(loadedFx.merged).length === 0)
      } finally { rmSync(fxLoad, { recursive: true, force: true }) }
    }
    // R-L19-1 绑定源一致性向量（计划源绑定值斜杠前段须=uuid_prefix 全串；全合成值）
    const rL19Cfg = (front) => ({
      providers: { plan: { uuid_prefix: 'account:demo-plan', entry_name: 'Demo Plan', family: 'glm' } },
      agent_slots: { 'ops-executor-plan-high': { provider: 'plan', model: 'GLM-5.3', level: 'high' } },
      agent_bindings: { 'ops-executor-plan-high': `${front}/GLM-5.3$max` },
    })
    t('R-L19-1 绑定源①：计划源绑定值斜杠前段=uuid_prefix 全串→零错误', validateLocalFacts(rL19Cfg('account:demo-plan')).length === 0)
    t('R-L19-1 绑定源②：斜杠前段≠uuid_prefix 全串→错误行点名 slot＋期望＋实际', (() => { const e = validateLocalFacts(rL19Cfg('account:other-plan')); return e.some((m) => m.includes('agent_bindings.ops-executor-plan-high') && m.includes('slot=ops-executor-plan-high') && m.includes('期望=account:demo-plan') && m.includes('实际=account:other-plan')) })())
    t('R-L19-1 绑定源③回归：注册表源（非 account:）与无 slot 键不受查', validateLocalFacts({ providers: { reg: { uuid_prefix: 'reg9999', entry_name: 'E-R', family: 'kimi' } }, agent_slots: { 'ops-executor-reg-high': { provider: 'reg', model: 'k3', level: 'high' } }, agent_bindings: { 'ops-executor-reg-high': 'reg9999/k3$max', 'ops-free-x': 'whatever/x' } }).length === 0)
    // v2.1.0 返工 W11：三层合并序/优先级向量（mergeOrgLayers 单源）
    {
      const d = { a: 1, arr: [1, 2], nest: { x: 1, keep: 'd' }, doomed: 'x' }
      const l = { b: 2, arr: [3], nest: { x: 2 } }
      const p = { c: 3, nest: null, doomed: null }
      const dSnap = JSON.stringify(d) // 合并前快照（k1 二过 N-6：恒真自比较修正）
      const m1 = mergeOrgLayers(d, l, p)
      const m2 = mergeOrgLayers(d, l, null)
      t('v2.1.0 三层：project>local>default 优先级（local 压 default、未提及沿用）', m2.a === 1 && m2.b === 2 && m2.nest.x === 2 && m2.nest.keep === 'd')
      t('v2.1.0 三层：数组整体替换（local [3] 压 default [1,2]）', JSON.stringify(m2.arr) === '[3]')
      t('v2.1.0 三层：显式 null 删除跨层生效（project 删 nest/doomed，其余 project 键在场）', m1.nest === undefined && m1.doomed === undefined && m1.c === 3)
      t('v2.1.0 三层：local/project 缺席=仅默认件（快照比对+首参无突变）', JSON.stringify(mergeOrgLayers(d, null, null)) === dSnap && JSON.stringify(d) === dSnap)
      t('v2.1.0 三层：local 缺席时 project 直压默认件', mergeOrgLayers(d, null, { a: 9 }).a === 9)
    }
    // 2026-10-03 kimi-third 改绑批向量：宿主双注册表合并（readHostConfig 单点改造；
    // 夹具全合成值——真实条目名/前缀/uuid 不入自检源码，返工 k2-W6）
    {
      const v2Rules = (rs) => ({ config: { providerConfigRules: { providerRules: rs } } })
      const mReg = mergeHostRegistries(
        { provider: { 'aaaaaaaa-1111': { name: 'E-A', options: { baseURL: 'https://old/a' }, models: { m1: { name: 'm1' }, m2: { name: 'm2' } } }, dead: null } },
        v2Rules([
          { providerId: 'nonuuid-prov-a', providerName: 'E-N', config: { api: { type: 'anthropic-messages', baseUrl: 'https://new/n' }, access: { apiKey: 'sk-x' }, personalModelIds: ['kx'] } },
          { providerId: 'aaaaaaaa-1111', providerName: 'E-A2', config: { access: { apiKey: 'sk-y' }, personalModelIds: ['m1'] } },
          { providerId: 'templ-only', templateId: 'bigmodel-api' },
          null,
        ]),
      )
      t('双注册表：新件独有条目映射入表（name/options.baseURL/apiKey/models 形态）', mReg.provider['nonuuid-prov-a']?.name === 'E-N' && mReg.provider['nonuuid-prov-a']?.options?.baseURL === 'https://new/n' && mReg.provider['nonuuid-prov-a']?.options?.apiKey === 'sk-x' && !!mReg.provider['nonuuid-prov-a']?.models?.kx)
      t('双注册表：同 id 覆盖（name 更新/options 键级合并沿用旧值）', mReg.provider['aaaaaaaa-1111']?.name === 'E-A2' && mReg.provider['aaaaaaaa-1111']?.options?.baseURL === 'https://old/a' && mReg.provider['aaaaaaaa-1111']?.options?.apiKey === 'sk-y')
      t('双注册表：models=整体替换非键级合并（新件 personalModelIds=更新事实，旧键 m2 不残留——返工 k2-W1）', Object.keys(mReg.provider['aaaaaaaa-1111']?.models || {}).join() === 'm1')
      t('双注册表：消费契约——源映射件齐 options.baseURL/apiKey 与顶层 models 键（glm-look 源发现契约面，返工 d1-W3；原 ds-call 消费面已随删除）', (() => { const e = mReg.provider['nonuuid-prov-a']; return typeof e?.options?.baseURL === 'string' && typeof e?.options?.apiKey === 'string' && Object.keys(e?.models || {}).length > 0 })())
      t('双注册表：无 config 模板条目与 null 行不物化（幽灵条目防护——返工 d1-W2）', mReg.provider['templ-only'] === undefined)
      t('双注册表：v2 缺席=旧件 provider 段原样等价', JSON.stringify(mergeHostRegistries({ provider: { x: { name: 'X' } } }, null).provider) === JSON.stringify({ x: { name: 'X' } }))
      t('双注册表：legacy 缺席=新件独立打底（新机纯迁移形态；顶层非 provider 键随之丢弃——返工 k2-W2）', (() => { const m = mergeHostRegistries(null, v2Rules([{ providerId: 'nonuuid-prov-a', providerName: 'E-N', config: { api: { baseUrl: 'https://new/n' }, personalModelIds: ['kx'] } }])); return m.provider['nonuuid-prov-a']?.name === 'E-N' && Object.keys(m).join() === 'provider' })())
      t('双注册表：双缺席=空 provider 段打底（readHostConfig 层显式抛）', Object.keys(mergeHostRegistries(null, null).provider).length === 0)
      t('双注册表：validateProviders 消费合并面——新件独有条目双校验通过（旧单读形态=必败面；前缀匹配对非 uuid 形态 id 同律）', validateProviders({ providers: { third: { uuid_prefix: 'nonuuid-', entry_name: 'E-N', model_family: 'kimi' } } }, mReg).length === 0)
    }
    // P1 批向量：agent_slots schema 校验 + family 统一读取（全部合成值，禁真实 UUID/账号名）
    {
      const slotCfg = () => ({
        providers: {
          alpha: { family: 'alpha', multimodal: false },
          beta: { family: 'beta', multimodal: true },
          gamma: { family: 'gamma', multimodal: false },
          startplan: { family: 'alpha', multimodal: false },
        },
        agent_slots: {
          'ops-research-alpha-high': { provider: 'alpha', model: 'm-alpha', level: 'high' },
          'ops-planner-alpha-max': { provider: 'alpha', model: 'm-alpha', level: 'max' },
          'ops-assembler-alpha-max': { provider: 'alpha', model: 'm-alpha', level: 'max' },
          'ops-executor-alpha-high': { provider: 'alpha', model: 'm-alpha', level: 'high' },
          'ops-tbreview-beta-max': { provider: 'beta', model: 'm-beta', level: 'max' },
          'ops-planreview-beta-max': { provider: 'beta', model: 'm-beta', level: 'max' },
          'ops-implreview-beta-max': { provider: 'beta', model: 'm-beta', level: 'max' },
          'ops-adjudicator-gamma-max': { provider: 'gamma', model: 'm-gamma', level: 'max' },
          'ops-vision-beta-max': { provider: 'beta', model: 'm-beta', level: 'max' },
        },
        agent_defaults: {
          research: 'ops-research-alpha-high',
          planner: 'ops-planner-alpha-max',
          assembler: 'ops-assembler-alpha-max',
          executor: 'ops-executor-alpha-high',
          tbreview: 'ops-tbreview-beta-max',
          planreview: 'ops-planreview-beta-max',
          implreview: 'ops-implreview-beta-max',
          adjudicator: 'ops-adjudicator-gamma-max',
          vision: 'ops-vision-beta-max',
        },
        role_fallbacks: {
          research: ['ops-research-alpha-high'],
          planner: ['ops-planner-alpha-max'],
          assembler: ['ops-assembler-alpha-max'],
          executor: ['ops-executor-alpha-high'],
          tbreview: ['ops-tbreview-beta-max'],
          planreview: ['ops-planreview-beta-max'],
          implreview: ['ops-implreview-beta-max'],
          adjudicator: ['ops-adjudicator-gamma-max'],
          vision: ['ops-vision-beta-max'],
        },
      })
      const vSlots = (c) => { try { return validateAgentSlots(c) } catch { return null } }
      const vErrs = (c) => vSlots(c) || []
      const e1 = vSlots(slotCfg())
      t('P1 slot：合法合成配置→零错误', Array.isArray(e1) && e1.length === 0)
      const c2 = slotCfg(); c2.agent_slots['ops-research-alpha-high'].provider = 'beta'
      t('P1 slot：键名 provider 段与值对象不一致→错误行', vErrs(c2).some((e) => e.includes('ops-research-alpha-high') && e.includes('provider')))
      const c3 = slotCfg(); c3.agent_slots['ops-research-zeta-high'] = { provider: 'zeta', model: 'm-zeta', level: 'high' }
      t('P1 slot：引用未声明 provider→错误行', vErrs(c3).some((e) => e.includes('ops-research-zeta-high') && e.includes('未声明')))
      const c4 = slotCfg(); c4.agent_defaults.executor = 'ops-implreview-beta-max'
      t('P1 slot：默认档位指向别的角色的 slot→错误行', vErrs(c4).some((e) => e.includes('agent_defaults.executor') && e.includes('角色不一致')))
      const c5 = slotCfg(); c5.agent_slots['ops-executor-gamma-high'] = { provider: 'gamma', model: 'm-gamma', level: 'high' }; c5.role_fallbacks.executor = ['ops-executor-gamma-high']
      t('P1 slot：fallback 首元素不等于默认档位→错误行', vErrs(c5).some((e) => e.includes('role_fallbacks.executor') && e.includes('首元素')))
      const c6 = slotCfg(); c6.role_fallbacks.executor = ['ops-executor-alpha-high', 'ops-executor-alpha-high']
      t('P1 slot：fallback 重复项→错误行', vErrs(c6).some((e) => e.includes('role_fallbacks.executor') && e.includes('重复')))
      const c7 = slotCfg(); c7.agent_slots['ops-implreview-alpha-max'] = { provider: 'alpha', model: 'm-alpha', level: 'max' }; c7.agent_defaults.implreview = 'ops-implreview-alpha-max'; c7.role_fallbacks.implreview = ['ops-implreview-alpha-max']
      t('P1 slot：默认 executor 与 implreview 同族→错误行', vErrs(c7).some((e) => e.includes('同族') && e.includes('executor') && e.includes('implreview')))
      const c8 = slotCfg(); c8.agent_slots['ops-vision-alpha-max'] = { provider: 'alpha', model: 'm-alpha', level: 'max' }; c8.agent_defaults.vision = 'ops-vision-alpha-max'; c8.role_fallbacks.vision = ['ops-vision-alpha-max']
      t('P1 slot：vision 默认档位 provider 非多模态→错误行', vErrs(c8).some((e) => e.includes('vision') && e.includes('multimodal')))
      // B2 批 D-7a：vision 默认档位谓词同款例外——startplan（multimodal:false）在场=零
      // vision 错误行；非 startplan 的非多模态 provider（上向量 alpha）继续拒。
      const c8s = slotCfg(); c8s.agent_slots['ops-vision-startplan-max'] = { provider: 'startplan', model: 'm-alpha', level: 'max' }; c8s.agent_defaults.vision = 'ops-vision-startplan-max'; c8s.role_fallbacks.vision = ['ops-vision-startplan-max']
      t('P1 slot：vision 默认档位 provider=startplan（文本应急例外）→零 vision multimodal 错误行', vErrs(c8s).every((e) => !(e.includes('vision') && e.includes('multimodal'))))
      const c9 = slotCfg(); c9.providers.legacyx = { family: 'alpha', multimodal: true, legacy: true }; c9.agent_slots['ops-research-legacyx-high'] = { provider: 'legacyx', model: 'm-alpha', level: 'high' }
      t('P1 slot：slot 引用 legacy:true provider→错误行', vErrs(c9).some((e) => e.includes('legacyx') && e.includes('legacy')))
      const c10 = slotCfg(); c10.providers.alpha = { model_family: 'alpha', multimodal: false }
      const e10 = vSlots(c10)
      t('P1 slot：仅 model_family 无 family 的合成 provider→不因族缺失报错', Array.isArray(e10) && e10.length === 0)
      t('P1 familyOf：family 优先/model_family 回退/缺失空串（去空白小写）', familyOf({ family: '  GLM ' }) === 'glm' && familyOf({ model_family: ' Kimi ' }) === 'kimi' && familyOf({}) === '')
      t('P1 slot：agent_slots 缺失/空→错误行（schema 必填）', vErrs({ providers: {} }).some((e) => e.includes('agent_slots')))
      t('P1 validateProviders：仅有 model_family 的合成 provider→不因族缺失报错', validateProviders({ providers: { demo: { uuid_prefix: 'fam5', entry_name: 'E-F', model_family: 'kimi' } } }, { provider: { 'fam5-0000': { name: 'E-F' } } }).length === 0)
      // 返工轮 1（审核 B-1）：必需角色集固定，不由现存 slot 反推
      const onlyResearch = {
        providers: { alpha: { family: 'alpha', multimodal: false } },
        agent_slots: { 'ops-research-alpha-high': { provider: 'alpha', model: 'm-alpha', level: 'high' } },
        agent_defaults: { research: 'ops-research-alpha-high' },
        role_fallbacks: { research: ['ops-research-alpha-high'] },
      }
      const onlyResearchErrs = vErrs(onlyResearch)
      t('P1 返工 B-1：agent_slots 仅 research 一角色→缺必需角色错误行', onlyResearchErrs.some((e) => e.includes('缺必需角色') && e.includes('executor')) && onlyResearchErrs.some((e) => e.includes('缺必需角色') && e.includes('implreview')))
      for (const role of ['executor', 'implreview', 'adjudicator', 'vision']) {
        const c = slotCfg()
        const defSlot = c.agent_defaults[role]
        delete c.agent_slots[defSlot]
        delete c.agent_defaults[role]
        delete c.role_fallbacks[role]
        t(`P1 返工 B-1：缺 ${role} 角色→缺必需角色错误行`, vErrs(c).some((e) => e.includes('缺必需角色') && e.includes(role)))
      }
      const cExtraDef = slotCfg(); cExtraDef.agent_defaults.bogus = 'ops-research-alpha-high'
      t('P1 返工 B-1：agent_defaults 多余键→错误行', vErrs(cExtraDef).some((e) => e.includes('agent_defaults 多余键') && e.includes('bogus')))
      const cExtraFb = slotCfg(); cExtraFb.role_fallbacks.bogus = ['ops-research-alpha-high']
      t('P1 返工 B-1：role_fallbacks 多余键→错误行', vErrs(cExtraFb).some((e) => e.includes('role_fallbacks 多余键') && e.includes('bogus')))
      // 返工轮 1（审核 B-2）：own-property 判定——原型链键不得冒充 provider
      const cCtor = slotCfg()
      cCtor.agent_slots['ops-research-constructor-high'] = { provider: 'constructor', model: 'm-ctor', level: 'high' }
      t('P1 返工 B-2：provider=constructor（原型链命中）→未声明/非对象错误行', vErrs(cCtor).some((e) => e.includes('ops-research-constructor-high') && e.includes('未声明') && e.includes('非对象')))
      for (const role of ['executor', 'implreview', 'adjudicator', 'vision']) {
        const lvl = role === 'executor' ? 'high' : 'max'
        const c = slotCfg()
        const slotName = `ops-${role}-constructor-${lvl}`
        c.agent_slots[slotName] = { provider: 'constructor', model: 'm-ctor', level: lvl }
        c.agent_defaults[role] = slotName
        c.role_fallbacks[role] = [slotName]
        t(`P1 返工 B-2：默认 ${role} 指向 constructor provider 槽→无法解析错误行`, vErrs(c).some((e) => e.includes(`agent_defaults.${role}`) && (e.includes('无法解析') || e.includes('未声明/非对象'))))
      }
      const cNoFam = slotCfg(); cNoFam.providers.alpha = { multimodal: false }
      t('P1 返工 B-2：provider 存在但缺 family→fail-closed 错误行', vErrs(cNoFam).some((e) => e.includes('executor') && e.includes('fail-closed')))
      // 装配岗批（D-3）assembler slot schema 两向量：缺席=validate errors；两键+槽在场=通过
      // （夹具=slotCfg() 九角色扩展形态；缺席负例三面齐删，只留缺角色一类错误）。
      const cNoAsm = slotCfg(); delete cNoAsm.agent_slots['ops-assembler-alpha-max']; delete cNoAsm.agent_defaults.assembler; delete cNoAsm.role_fallbacks.assembler
      t('装配岗批 slot：agent_slots 缺 assembler→缺必需角色错误行', vErrs(cNoAsm).some((e) => e.includes('缺必需角色') && e.includes('assembler')))
      t('装配岗批 slot：agent_slots/agent_defaults/role_fallbacks 含 assembler→零错误', vSlots(slotCfg()).length === 0)
      // 装配岗批（D-3/D-4 配置面护栏）agent_bindings ⊆ agent_slots 负例向量：槽形绑定键无对应
      // 槽→错误行点名；非槽形元数据键（ops-free-x 形态）天然豁免不报。
      t('装配岗批 绑定面：agent_bindings 槽形键无 agent_slots 槽→错误行（非槽形键豁免）', (() => {
        const e = validateLocalFacts({ agent_bindings: { 'ops-assembler-699-max': 'demo-prov/model-b$max', 'ops-free-x': 'whatever/x' } })
        return e.some((m) => m.includes('agent_bindings.ops-assembler-699-max')) && !e.some((m) => m.includes('ops-free-x'))
      })())
    }
    // B1 批（D-6）flags 向量组：首冻登记 schema／revert_manifest_schema 形态／未登记名与非法值拒／
    // 分区校验正负例／状态件覆盖序／两进程同刻 set 并发（env ORG_FLAGS_STATE 重定向——零触真实状态件）
    {
      const def = readJson(DEFAULT_CFG)
      const b1 = def.flags ? def.flags.b1_gates_v2 : undefined
      t('B1 flags：默认件 b1_gates_v2 首冻登记 schema（恰三键·default false·owner_batch B1）', b1 != null && typeof b1 === 'object' && JSON.stringify(Object.keys(b1)) === JSON.stringify(['description', 'owner_batch', 'default']) && b1.default === false && b1.owner_batch === 'B1' && typeof b1.description === 'string' && b1.description.trim())
      const rms = def.flags ? def.flags.revert_manifest_schema : undefined
      t('B1 flags：revert_manifest_schema 形态（columns 恰三列＋note 非空）', rms != null && typeof rms === 'object' && Array.isArray(rms.columns) && rms.columns.join() === REVERT_MANIFEST_COLUMNS.join() && typeof rms.note === 'string' && rms.note.trim())
      const oneFlag = () => ({ flags: { b1_gates_v2: { description: 'x', owner_batch: 'B1', default: false } } })
      const catchName = (fn) => { try { fn(); return 'no-throw' } catch (e) { return e.constructor.name } }
      t('B1 flags：未登记名 get/set 拒（resolveFlagValue=null＋setFlag UsageError）', resolveFlagValue(oneFlag(), 'nosuchflag', {}) === null && catchName(() => setFlag(oneFlag(), 'nosuchflag', 'on')) === 'UsageError')
      t('B1 flags：非法值拒（set 取值限 on|off）', catchName(() => setFlag(oneFlag(), 'b1_gates_v2', 'true')) === 'UsageError')
      t('B1 flags：validateFlagsPartition 正负例（合法零错／缺分区／坏 flag 各一错行）', (() => { const okc = validateFlagsPartition({ flags: { b1_gates_v2: { description: 'x', owner_batch: 'B1', default: false }, revert_manifest_schema: { columns: ['path', 'commit', 'baseline_sha256'], note: 'n' } } }); const miss = validateFlagsPartition({}); const bad = validateFlagsPartition({ flags: { x: { description: 'x' } } }); return okc.length === 0 && miss.length === 1 && bad.length === 1 })())
      t('B1 flags：状态件布尔覆盖注册默认（读序=状态件＞default）', resolveFlagValue(oneFlag(), 'b1_gates_v2', { b1_gates_v2: true }) === true && resolveFlagValue(oneFlag(), 'b1_gates_v2', {}) === false)
      // 并发：两子进程同刻 set 同一 flag（状态件经 env 重定向至 tmp——真实状态件零触碰）
      let fxLock = null
      try {
        fxLock = mkdtempSync(join(tmpdir(), 'oc-flags-'))
        const stPath = join(fxLock, 'org-flags.json')
        const { spawn } = await import('node:child_process')
        const self = fileURLToPath(import.meta.url)
        const p1 = spawn(process.execPath, [self, 'flags', 'set', 'b1_gates_v2', 'on'], { env: { ...process.env, ORG_FLAGS_STATE: stPath }, stdio: 'ignore' })
        const p2 = spawn(process.execPath, [self, 'flags', 'set', 'b1_gates_v2', 'off'], { env: { ...process.env, ORG_FLAGS_STATE: stPath }, stdio: 'ignore' })
        const codes = await Promise.all([new Promise((r) => p1.on('close', r)), new Promise((r) => p2.on('close', r))])
        let intact = false
        try { const st = readJson(stPath); intact = st != null && typeof st === 'object' && typeof st.b1_gates_v2 === 'boolean' } catch { intact = false }
        t('B1 flags：两进程同刻 set 并发→双 exit 0＋状态件合法 JSON 布尔（withFileLock 防交错损坏）', codes[0] === 0 && codes[1] === 0 && intact)
      } catch { t('B1 flags：两进程同刻 set 并发（临时目录异常）', false) }
      finally { if (fxLock) rmSync(fxLock, { recursive: true, force: true }) }
    }
    // B8 D-4/D-5 向量组：CLI 预检闭集＋装载顺序＋合法 flags/notice 回归（/tmp 隔离技能根·子进程真退出码·零真实面写）
    {
      const selfPath = fileURLToPath(import.meta.url)
      const mkIso = (defaultContent) => {
        const iso = mkdtempSync(join(tmpdir(), 'oc-b8-'))
        mkdirSync(join(iso, 'scripts'), { recursive: true })
        copyFileSync(selfPath, join(iso, 'scripts', 'org-config.mjs'))
        writeFileSync(join(iso, 'org-config.default.json'), defaultContent)
        return iso
      }
      const envOf = (iso, extra = {}) => { const e = { PATH: process.env.PATH, HOME: iso, ...extra }; if (!('ORG_FLAGS_STATE' in extra)) delete e.ORG_FLAGS_STATE; return e } // 外来 env 显式收敛（ORG_B8_TEST_DEPTH/ORG_FLAGS_STATE 不随宿主泄入；显式重定向优先——B8 D-4/r4）
      const runIso = (iso, args, env) => spawnSync(process.execPath, [join(iso, 'scripts', 'org-config.mjs'), ...args], { encoding: 'utf8', env, timeout: 60_000 })
      const isoBroken = mkIso('{ broken json')
      try {
        const invalids = [
          ['--self-test', 'resolve'],
          ['--self-test', '--wat'],
          ['frobnicate'],
          ['--wat', 'resolve'],
          ['--project=/tmp/x', 'resolve'],
          ['--project', '/a', '--project', '/b', 'resolve'],
          ['--project'],
          ['validate', 'extra'],
          ['flags', 'list', 'extra'],
          ['flags', 'get'],
          ['flags', 'get', 'a', 'b'],
          ['flags', 'set', 'a'],
          ['flags', 'set', 'a', 'maybe'],
          ['flags', 'set', 'a', 'on', 'b'],
          ['resolve', 'stray'],
        ]
        const codes = invalids.map((a) => { const r = runIso(isoBroken, a, envOf(isoBroken)); return { c: r.status, err: (r.stderr || '').includes('[用法错]') } })
        t('B8 D-5 预检：15 非法组合（self-test+resolve／self-test+未知 flag／未知命令／未知 flag／等号形态／重复 project／project 缺值／validate 额外参数／flags list 额外参数／get 缺 name／get 额外参数／set 缺 value／set 非 on/off／set 额外参数／额外位置参数）全真 exit 1', codes.length === 15 && codes.every((x) => x.c === 1 && x.err))
        const rResolve = runIso(isoBroken, ['resolve'], envOf(isoBroken))
        t('B8 D-5 装载顺序：同一破损 default 根下非法组合仍 1（预检先于装载）而合法 resolve 才 3（装载错族）', rResolve.status === 3 && (rResolve.stderr || '').includes('装载失败'))
      } finally { rmSync(isoBroken, { recursive: true, force: true }) }
      const isoOk = mkIso(JSON.stringify({ flags: { b1_gates_v2: { description: 'B8 合成测试旗标', owner_batch: 'B8', default: false } } }))
      try {
        const envDefault = envOf(isoOk)
        const rList = runIso(isoOk, ['flags'], envDefault)
        const noticeDefault = (rList.stderr || '').includes(`[notice] ORG_FLAGS_STATE=default:${join(isoOk, '.zcode', 'org-flags.json')}`) && (rList.stderr || '').includes('未设置，使用缺省')
        const rGet = runIso(isoOk, ['flags', 'get', 'b1_gates_v2'], envDefault)
        const stPath = join(isoOk, 'st-tmp.json')
        const rSet = runIso(isoOk, ['flags', 'set', 'b1_gates_v2', 'on'], envOf(isoOk, { ORG_FLAGS_STATE: stPath }))
        const noticeOverride = (rSet.stderr || '').includes(`[notice] ORG_FLAGS_STATE=override:${stPath}`) && (rSet.stderr || '').includes('显式覆盖')
        let setState = false
        try { setState = JSON.parse(readFileSync(stPath, 'utf8')).b1_gates_v2 === true } catch { setState = false }
        t('B8 D-4/D-5 合法回归：flags list/get（临时根零写）＋flags set 仅写临时状态件＋default/override notice 各一（stderr·stdout 机器格式不变）', rList.status === 0 && noticeDefault && rGet.status === 0 && (rGet.stdout || '').includes('b1_gates_v2=false') && rSet.status === 0 && setState && noticeOverride && !existsSync(join(isoOk, '.zcode', 'org-flags.json')) && !(rList.stdout || '').includes('[notice]'))
      } finally { rmSync(isoOk, { recursive: true, force: true }) }
    }
    // localDateStr 通用向量（临时窗机制退役后仅存通用日期助手）
    t('localDateStr：本地日期补零（2026-01-05）', localDateStr(new Date(2026, 0, 5)) === '2026-01-05')
    t('localDateStr：月/日双位补零（2026-12-09）', localDateStr(new Date(2026, 11, 9)) === '2026-12-09')
    console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
    process.exit(fails === 0 ? 0 : 1)
  }

  // v2.0.1 修复批 M7：CLI 命令路径的装载/宿主配置失败包 [fatal]+exit 3——
  // resolve/hash/validate 原裸抛完整堆栈退 1，与用法注宣称的「validate 不符
  // exit 3」及家族 ConfigError 纪律（配置/装载错=3、一行错误）相悖。
  let loaded
  try {
    loaded = loadOrgConfig(projectDir)
  } catch (e) {
    console.error(`[fatal] org-config 装载失败（${projectDir}）: ${e.message}（06 §5.8 行 3=配置/装载错）`)
    process.exit(3)
  }
  const { merged, hasOverride, hasLocal } = loaded
  if (cmd === 'resolve') {
    console.log(JSON.stringify(merged, null, 2))
    console.error(`[local] ${hasLocal ? '本机件已合并（org-config.local.json）' : '本机件缺失（默认件占位将拒派——deploy-check --install 可脚手架）'}`)
    console.error(`[override] ${hasOverride ? '项目覆盖件已合并' : '无项目覆盖件'}`)
  } else if (cmd === 'hash') {
    console.log(`cfg:${cfgHash(merged)}`)
  } else if (cmd === 'flags') {
    // B1/D-6：flags 列表/get/set（未登记名/非法值=用法错 1；状态件破损=装载错 3）；
    // B8 D-5：子命令形态已由 precheckOrgCli 前置校验（rest 为预检产物）
    const sub = rest[0] || 'list'
    try {
      if (sub === 'list') {
        const state = readFlagsState()
        const flags = merged.flags && typeof merged.flags === 'object' ? merged.flags : {}
        for (const [name, entry] of Object.entries(flags)) {
          if (FLAGS_RESERVED_KEYS.has(name)) { console.log(`${name}：schema 声明（columns=[${(entry.columns || []).join(',')}])——非开关`) ; continue }
          const v = resolveFlagValue(merged, name, state)
          console.log(`${name}=${v}${isToggleFlagDef(entry) ? `（owner_batch=${entry.owner_batch}）${entry.description}` : '〔形态不符——validate 会拒〕'}`)
        }
        console.error(`[state] ${existsSync(flagsStatePath()) ? `状态件已合并（${flagsStatePath()}）` : '状态件缺省（全部按注册默认）'}`)
      } else if (sub === 'get') {
        const name = rest[1]
        if (!name) { console.error('[用法错] flags get 缺 name'); process.exit(1) }
        const v = resolveFlagValue(merged, name, readFlagsState())
        if (v === null) { console.error(`[用法错] flag「${name}」未登记——合法 flag 单源=org-config flags 分区`); process.exit(1) }
        console.log(`${name}=${v}`)
      } else if (sub === 'set') {
        const name = rest[1], value = rest[2]
        if (!name || !value) { console.error('[用法错] flags set 形态：flags set <name> on|off'); process.exit(1) }
        const r = setFlag(merged, name, value)
        console.log(`flags set ${r.name}=${r.value}（状态件 ${r.path} 已写·锁随释清）`)
        console.log('回退总命令：node scripts/org-config.mjs flags set ' + r.name + ' off（docs/13 §3.3）')
      } else {
        console.error(`[用法错] 未知 flags 子命令「${sub}」（可用：list/get/set）`)
        process.exit(1)
      }
    } catch (e) {
      if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
      console.error(`[fatal] flags 状态件装载/写盘失败：${e.message}（06 §5.8 行 3=配置/装载错）`)
      process.exit(3)
    }
  } else if (cmd === 'validate') {
    let errors
    try {
      errors = [...validateProviders(merged), ...validateCrossGatePairs(merged), ...validateLocalFacts(merged), ...validateAgentSlots(merged), ...validateFlagsPartition(merged)]
    } catch (e) {
      console.error(`[fatal] validate 途中宿主配置装载失败: ${e.message}（06 §5.8 行 3=配置/装载错）`)
      process.exit(3)
    }
    if (errors.length) {
      errors.forEach((e) => console.error(e))
      process.exit(3)
    }
    // L19：注册表源与账户计划源分列计数——无计划源时维持原「N 源双校验通过」语义
    const provEntries = Object.entries(merged.providers || {})
    const planN = provEntries.filter(([, d]) => d != null && typeof d === 'object' && String(d.uuid_prefix ?? '').trim().toLowerCase().startsWith('account:')).length
    const regN = provEntries.length - planN
    const srcSummary = planN > 0 ? `${regN} 源注册表双校验＋${planN} 源计划清单校验通过` : `${provEntries.length} 源双校验通过`
    console.log(`validate PASS（${srcSummary}+跨门对/本机事实/slot schema/flags 分区校验通过，cfg:${cfgHash(merged)}）`)
  } else {
    console.error('用法: node org-config.mjs [--project <dir>] resolve|hash|validate|flags [get|set]|--self-test')
    process.exit(1)
  }
}
