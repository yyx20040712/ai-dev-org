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

/** 装载合并配置：默认件 + <projectDir>/.zcode/org-config.json（存在时）。 */
export function loadOrgConfig(projectDir) {
  const base = readJson(DEFAULT_CFG)
  const overPath = join(projectDir, '.zcode', 'org-config.json')
  const merged = existsSync(overPath) ? deepMerge(base, readJson(overPath)) : base
  return { merged, hasOverride: existsSync(overPath), overPath }
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
  const { merged, hasOverride } = loaded
  if (cmd === 'resolve') {
    console.log(JSON.stringify(merged, null, 2))
    console.error(`[override] ${hasOverride ? '项目覆盖件已合并' : '无项目覆盖件（纯默认件）'}`)
  } else if (cmd === 'hash') {
    console.log(`cfg:${cfgHash(merged)}`)
  } else if (cmd === 'validate') {
    let errors
    try {
      errors = validateProviders(merged)
    } catch (e) {
      console.error(`[fatal] validate 途中宿主配置装载失败: ${e.message}（06 §5.8 行 3=配置/装载错）`)
      process.exit(3)
    }
    if (errors.length) {
      errors.forEach((e) => console.error(e))
      process.exit(3)
    }
    console.log(`validate PASS（${Object.keys(merged.providers || {}).length} 源双校验通过，cfg:${cfgHash(merged)}）`)
  } else {
    console.error('用法: node org-config.mjs [--project <dir>] resolve|hash|validate|--self-test')
    process.exit(1)
  }
}
