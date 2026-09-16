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
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_CFG = join(SKILL_ROOT, 'org-config.default.json')

/** JSON 读取（剥 UTF-8 BOM——Windows 编辑器常见，审核链 ds-N2；语法错误带路径上下文）。 */
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

/** 跨脚本共享小件（v1.6 批 P2-3 收敛：多份逐字复制→单源导出；
 * ds-call-v2 依「分发单元自包含」判据豁免（裁决档 W7）——其内副本注释指向此处）。 */
export function cliFlag(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
export function readJsonlFile(p) {
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean)
    .map((l, i) => { try { return JSON.parse(l) } catch { return { unparseable: `行${i + 1}: ${l.slice(0, 60)}` } } })
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
  const projIdx = argv.indexOf('--project')
  const projectDir = projIdx >= 0 ? argv[projIdx + 1] : process.cwd()
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
    console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
    process.exit(fails === 0 ? 0 : 1)
  }

  const { merged, hasOverride } = loadOrgConfig(projectDir)
  if (cmd === 'resolve') {
    console.log(JSON.stringify(merged, null, 2))
    console.error(`[override] ${hasOverride ? '项目覆盖件已合并' : '无项目覆盖件（纯默认件）'}`)
  } else if (cmd === 'hash') {
    console.log(`cfg:${cfgHash(merged)}`)
  } else if (cmd === 'validate') {
    const errors = validateProviders(merged)
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
