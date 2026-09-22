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
 *   node org-config.mjs --self-test                 # 合并/哈希语义自测向量
 * flag 取值一律空格分隔（--x=y 等号形态=用法错拒收——cliFlag 单源立场）。
 */
import { readFileSync, writeFileSync, existsSync, openSync, writeSync, closeSync, statSync, rmSync, utimesSync, mkdtempSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

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

/** 三层合并纯函数（v2.1.0 回炉 W11：可向量化的层序/优先级单源——loadOrgConfig
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
 *  ← <projectDir>/.zcode/org-config.json（存在时）。深合并语义层内不变。 */
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

/** 读宿主配置（单点封装，供派发器与校验共用——K-W3 单次读入）。 */
export function readHostConfig() {
  return readJson(join(homedir(), '.zcode', 'v2', 'config.json'))
}

/** 跨脚本共享小件（v1.6 批 P2-3 收敛：多份逐字复制→单源导出；ds-call-v2
 *  副本已收编（g3 批，W7 前提过时——其 import 行已引本件多标识符，自包含
 *  既破，副本=纯双源面））。 */
/** 用法错（g3 批 2026-09-17，evolve-l4-flags 清偿）：flag 重复/末位缺值/值形如
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
  if (hits.length >= 2) throw new UsageError(`flag ${name} 出现 ${hits.length} 次（重复=用法错——原仅解析首个，g3 批 evolve-l4-flags 清偿）`)
  const val = argv[hits[0] + 1]
  if (val === undefined) throw new UsageError(`flag ${name} 居末位无值（缺值=用法错——原取 undefined 静默，g3 批 evolve-l4-flags 清偿）`)
  if (typeof val === 'string' && val.startsWith('--')) throw new UsageError(`flag ${name} 的值形如 flag（「${val}」——误吃下一 flag=用法错，g3 批 evolve-l4-flags 清偿）`)
  return val
}
export function readJsonlFile(p) {
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean)
    .map((l, i) => { try { return JSON.parse(l) } catch { return { unparseable: `行${i + 1}: ${l.slice(0, 60)}` } } })
}

/** 跨进程建议锁（selfiter 批 B4 evolve-m6-runid 清偿——账本/流水多写入者行交错面）：
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

/** 与宿主 config.json 交叉校验：uuid 前缀+条目名双命中。返回错误数组（空=通过）。
 *  校验 providers 全集（未入链的已声明源亦须通过——防漂移，审核链 K-N4 口径）。 */
export function validateProviders(cfg, hostCfg) {
  const hc = hostCfg || readHostConfig()
  const entries = Object.entries(hc.provider || {})
  const errors = []
  for (const [alias, def] of Object.entries(cfg.providers || {})) {
    if (def == null || typeof def !== 'object') {
      errors.push(`providers.${alias} 值为 ${def === null ? 'null' : typeof def}——须为对象（uuid_prefix/entry_name）；null/非对象条目=配置损坏（evolve-E2 b4 守卫：原裸取 uuid_prefix 即 TypeError 崩溃）`)
      continue
    }
    if (def.uuid_prefix === 'TODO' || def.entry_name === 'TODO') {
      errors.push(`providers.${alias} 仍为模板占位（uuid_prefix/entry_name=TODO）——org-config 尚未本机化：填 org-config.local.json（本机件，gitignore；deploy-check --install 可脚手架）同名键实值（uuid_prefix=宿主注册表条目 id 前 8 字符/entry_name=条目名），指引=DEPLOY.md §3（06 §0 三层）`)
      continue
    }
    // 回炉（门一 W-3）：非占位源须带 model_family——standing_pair/跨门同族核对的消费面，
    // 缺键=异族校验静默降级为 [?]（k1 W-3/d1 W9a 同族面）
    if (typeof def.model_family !== 'string' || !def.model_family.trim())
      errors.push(`providers.${alias} 缺 model_family（非空字符串）——standing_pair/跨门同族核对消费此键（org-config source_health），缺键=异构校验静默降级；本机件补填`)
    const hit = entries.find(([id, p]) => id.startsWith(def.uuid_prefix) && p && p.name === def.entry_name)
    if (!hit) {
      const near = entries.find(([id]) => id.startsWith(def.uuid_prefix))
      errors.push(
        `源校验失败 alias=${alias} 期望 uuid前缀=${def.uuid_prefix} name=${def.entry_name} ` +
          `实际=${near ? near[0] + '(name=' + (near[1]?.name ?? 'null') + ')' : '无该前缀条目'}（未入链的声明源亦须双校验通过）`,
      )
    }
  }
  for (const alias of cfg.source_chain || []) {
    if (!cfg.providers || !cfg.providers[alias]) errors.push(`source_chain 引用未知 alias=${alias}`)
  }
  if (!Array.isArray(cfg.source_chain) || (cfg.source_chain || []).length === 0)
    errors.push('source_chain 为空（覆盖件整体替换后链被清空——无可用派发链）')
  for (const [role, def] of Object.entries(cfg.roles || {})) {
    if (def.source === undefined) errors.push(`roles.${role}.source 字段缺失（应显式填 chain 或某 provider alias）`)
    else if (def.source !== 'chain' && (!cfg.providers || !cfg.providers[def.source]))
      errors.push(`roles.${role}.source 引用未知 alias=${def.source}`)
  }
  return errors
}

/** 角色执法面一致性校验（escaped-defect ② 修复批回炉 W-2/W-3 闭合，2026-09-19）：
 *  `findings_surface`（⑥ FINDINGS 缺栏执法面）与角色 DoD 尾栏要求必须双向一致——
 *  标志与 DoD 靠人记同步=缺陷②根因结构，本函数机检化：挂标志但 DoD 无尾栏=⑥ 误 RED
 *  形态；DoD 有尾栏但未挂=⑥ 漏执法（静默假绿）形态。DoD 路径真源=scripts/roles/
 *  registry.json dod_file；此处只探尾栏行形态（行首锚定 `FINDINGS: B=`——回炉 r2
 *  W-2：裸子串会把说明性提及误判），词表本身仍各岗 .dod 单源（防双源）。
 *  回炉 r2 W-1：registry 有岗而 org-config roles 未载的差集向亦查（其 DoD 有尾栏=
 *  执法面无配置承载的静默逃逸）。返回错误数组。运行期强制=ds-call-v2 loadSources
 *  前置同关卡（回炉 r2 W-4），validate 命令同检。 */
export function validateRoleSurfaces(cfg) {
  const errors = []
  let registry = null
  try { registry = readJson(join(SKILL_ROOT, 'scripts', 'roles', 'registry.json'))?.roles || null } catch { registry = null }
  const hasTail = (dodText) => dodText != null && /^\s*`?FINDINGS:\s*B=.*W=.*N=.*VERDICT=/m.test(dodText) // 全形代理（k1 二过 N1：前缀代理放行截断尾栏=②形态改道；与 parseFindings 实需字段同构，词表仍不复制）
  const dodOf = (role) => {
    const reg = registry?.[role]
    if (!reg) return { reg: null }
    if (!reg.dod_file) return { reg, dodText: null, reason: 'registry 无 dod_file 字段' }
    const p = join(SKILL_ROOT, reg.dod_file)
    if (!existsSync(p)) return { reg, dodText: null, reason: `DoD 文件不存在（${reg.dod_file}）` }
    try { return { reg, dodText: readFileSync(p, 'utf8') } } catch { return { reg, dodText: null, reason: `DoD 文件不可读（${reg.dod_file}）` } }
  }
  for (const [role, def] of Object.entries(cfg.roles || {})) {
    const { reg, dodText, reason } = dodOf(role)
    if (def?.findings_surface) {
      if (!reg) errors.push(`roles.${role}.findings_surface=true 但 registry 无此岗——DoD 尾栏要求无法核实（标志与 DoD 脱钩=escaped-defect ② 根因形态）`)
      else if (dodText == null) errors.push(`roles.${role}.findings_surface=true 但 ${reason}——⑥ 执法面声明无真源`)
      else if (!hasTail(dodText)) errors.push(`roles.${role}.findings_surface=true 但其 DoD 无 FINDINGS 尾栏要求（${reg.dod_file}）——⑥ 会对该岗每行真实 ok 误 RED（escaped-defect ② 形态）`)
    } else if (hasTail(dodText)) {
      errors.push(`roles.${role} 未挂 findings_surface 但其 DoD 有 FINDINGS 尾栏要求（${reg.dod_file}）——⑥ 漏执法（DoD 失守静默不 RED=W-3 反向逃逸）`)
    }
  }
  for (const role of Object.keys(registry || {})) {
    if (cfg.roles?.[role] !== undefined) continue
    const { dodText } = dodOf(role)
    if (hasTail(dodText)) errors.push(`registry 岗位 ${role} 未入 org-config roles 但其 DoD 有 FINDINGS 尾栏要求——⑥ 执法面无配置承载（回炉 r2 W-1 差集向逃逸）`)
  }
  return errors
}

/** 跨门岗对结构校验（v2.1.0 批，07 §4 纪律⑤；回炉 W8 强化）：二元代理名对数组；
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

/** 本机事实占位校验（v2.1.0 回炉 W9a）：vision_channels 通道与 agent_bindings 值
 *  的 TODO 占位=新机静默降级面（看图通道/绑定渲染失效），validate 拒收。 */
export function validateLocalFacts(cfg) {
  const errors = []
  for (const [ch, def] of Object.entries(cfg?.vision_channels || {})) {
    if (def && typeof def === 'object' && def.model === 'TODO')
      errors.push(`vision_channels.${ch}.model=TODO 占位——填本机件实值（glm-look 通道甄别消费）`)
  }
  for (const [agent, v] of Object.entries(cfg?.agent_bindings || {})) {
    if (v === 'TODO' || v === '') errors.push(`agent_bindings.${agent} 为占位/空——绑定模板渲染消费（deploy-check ④）`)
  }
  return errors
}

// ── CLI ──
const isMain =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) {
  const argv = process.argv.slice(2)
  const selfTest = argv.includes('--self-test')
  // g3 批（evolve-l4-flags）：--project 裸 indexOf 改走单源 cliFlag（重复/末位
  // 缺值/值形如 flag→[用法错] exit 1——原裸取 argv[i+1] 缺值时 undefined 崩装载）
  let projectDir = process.cwd()
  try {
    projectDir = cliFlag(argv, '--project') || process.cwd()
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`[用法错] ${e.message}`)
      process.exit(1)
    }
    throw e
  }
  const cmd = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--project')

  if (selfTest) {
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
    // escaped-defect ② 修复批回炉（W-2/W-3）向量：执法面↔DoD 双向一致性（读真实
    // registry+DoD 文件——守卫性质：现役档案漂移即红）
    t('执法面：挂 findings_surface 但 DoD 无尾栏（drafter）→ 错误行', (() => { const e = validateRoleSurfaces({ roles: { drafter: { findings_surface: true } } }); return Array.isArray(e) && e.some((x) => x.includes('roles.drafter.findings_surface=true') && x.includes('无 FINDINGS 尾栏要求')) })())
    t('执法面：DoD 有尾栏但未挂（gate1-reviewer）→ 错误行（W-3 反向）', (() => { const e = validateRoleSurfaces({ roles: { 'gate1-reviewer': {} } }); return Array.isArray(e) && e.some((x) => x.includes('未挂 findings_surface') && x.includes('漏执法')) })())
    t('执法面：真挂真有尾栏（auditor-readonly）→ 该岗零错误行', (() => { const e = validateRoleSurfaces({ roles: { 'auditor-readonly': { findings_surface: true } } }); return Array.isArray(e) && !e.some((x) => x.includes('auditor-readonly')) })())
    t('执法面：registry 无此岗且挂标志（ghost）→ 无法核实错误行', (() => { const e = validateRoleSurfaces({ roles: { ghost: { findings_surface: true } } }); return Array.isArray(e) && e.some((x) => x.includes('roles.ghost.findings_surface=true') && x.includes('registry 无此岗')) })())
    t('执法面：registry 岗未入 cfg roles 差集向（gate1-reviewer）→ 无承载错误行（回炉 r2 W-1）', (() => { const e = validateRoleSurfaces({ roles: {} }); return Array.isArray(e) && e.some((x) => x.includes('gate1-reviewer 未入 org-config roles') && x.includes('无配置承载')) })())
    // g3 批（evolve-l4-flags 清偿）向量：cliFlag 三校验——红态=旧实现不抛
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
    t('v2.1.0 回炉：非占位源缺 model_family→错误行（异族校验消费面）', vpNoFam.some((e) => e.includes('providers.demo 缺 model_family')))
    t('v2.1.0 跨门对：合法二元对（真模板名）→零错误', validateCrossGatePairs({ source_health: { cross_gate_pairs: [['ops-gate1-k1', 'ops-adjudicator']] } }).length === 0)
    t('v2.1.0 跨门对：三元对→结构错误行', validateCrossGatePairs({ source_health: { cross_gate_pairs: [['a', 'b', 'c']] } }).some((e) => e.includes('cross_gate_pairs[0]')))
    t('v2.1.0 跨门对：非字符串成员→结构错误行', validateCrossGatePairs({ source_health: { cross_gate_pairs: [['a', 1]] } }).length >= 1)
    t('v2.1.0 跨门对：非数组形态→结构错误行', validateCrossGatePairs({ source_health: { cross_gate_pairs: 'x' } }).some((e) => e.includes('须为数组')))
    t('v2.1.0 跨门对：缺席→零错误（可选项——轮2 N-5 回补契约向量）', validateCrossGatePairs({}).length === 0 && validateCrossGatePairs({ source_health: {} }).length === 0)
    t('v2.1.0 回炉：跨门对成员无模板→命名空间错误行（防别名混写）', validateCrossGatePairs({ source_health: { cross_gate_pairs: [['kimi-main', 'ops-adjudicator']] } }).some((e) => e.includes('kimi-main」无对应模板')))
    t('v2.1.0 回炉：跨门对自配对→拒收', validateCrossGatePairs({ source_health: { cross_gate_pairs: [['ops-gate1-k1', 'ops-gate1-k1']] } }).some((e) => e.includes('自配对')))
    t('v2.1.0 回炉：跨门对重复对→拒收', validateCrossGatePairs({ source_health: { cross_gate_pairs: [['ops-gate1-k1', 'ops-adjudicator'], ['ops-adjudicator', 'ops-gate1-k1']] } }).some((e) => e.includes('重复对')))
    t('v2.1.0 回炉：vision 通道 model=TODO→占位错误行', validateLocalFacts({ vision_channels: { glm: { model: 'TODO' } } }).some((e) => e.includes('vision_channels.glm.model=TODO')))
    t('v2.1.0 回炉：agent_bindings 占位/空→错误行', validateLocalFacts({ agent_bindings: { 'ops-x': 'TODO' } }).some((e) => e.includes('agent_bindings.ops-x')))
    t('v2.1.0 回炉：本机事实占位校验净配置→零错误', validateLocalFacts({}).length === 0 && validateLocalFacts({ vision_channels: { glm: { model: 'REAL' } }, agent_bindings: { x: 'v/k3$max' } }).length === 0)
    // v2.1.0 回炉 W11：三层合并序/优先级向量（mergeOrgLayers 单源）
    {
      const d = { a: 1, arr: [1, 2], nest: { x: 1, keep: 'd' }, doomed: 'x' }
      const l = { b: 2, arr: [3], nest: { x: 2 } }
      const p = { c: 3, nest: null, doomed: null }
      const m1 = mergeOrgLayers(d, l, p)
      const m2 = mergeOrgLayers(d, l, null)
      t('v2.1.0 三层：project>local>default 优先级（local 压 default、未提及沿用）', m2.a === 1 && m2.b === 2 && m2.nest.x === 2 && m2.nest.keep === 'd')
      t('v2.1.0 三层：数组整体替换（local [3] 压 default [1,2]）', JSON.stringify(m2.arr) === '[3]')
      t('v2.1.0 三层：显式 null 删除跨层生效（project 删 nest/doomed，其余 project 键在场）', m1.nest === undefined && m1.doomed === undefined && m1.c === 3)
      t('v2.1.0 三层：local/project 缺席=仅默认件', JSON.stringify(mergeOrgLayers(d, null, null)) === JSON.stringify(d))
      t('v2.1.0 三层：local 缺席时 project 直压默认件', mergeOrgLayers(d, null, { a: 9 }).a === 9)
    }
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
  } else if (cmd === 'validate') {
    let errors
    try {
      errors = [...validateProviders(merged), ...validateRoleSurfaces(merged), ...validateCrossGatePairs(merged), ...validateLocalFacts(merged)]
    } catch (e) {
      console.error(`[fatal] validate 途中宿主配置装载失败: ${e.message}（06 §5.8 行 3=配置/装载错）`)
      process.exit(3)
    }
    if (errors.length) {
      errors.forEach((e) => console.error(e))
      process.exit(3)
    }
    console.log(`validate PASS（${Object.keys(merged.providers || {}).length} 源双校验通过+角色执法面一致性 ${Object.keys(merged.roles || {}).length} 岗通过，cfg:${cfgHash(merged)}）`)
  } else {
    console.error('用法: node org-config.mjs [--project <dir>] resolve|hash|validate|--self-test')
    process.exit(1)
  }
}
