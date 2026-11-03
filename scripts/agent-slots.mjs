/**
 * agent-slots —— 待位只读命令面（P4）。
 * 职责：
 *   ① list/show/resolve/doctor 四条只读命令：列 slot、看定义、按 ROUTE 解析、
 *      体检矩阵×配置一致性；
 *   ② ROUTE 解析（`ROUTE:` 前缀，`;`/`,`/空白分隔，两空格缩进续行；同角色重复
 *      取最后一次并留 note）；旧名解析（`resolve --agent <旧名>`，8 条登记表，
 *      角色默认型按 agent_defaults 当前默认档位、固定 provider 型按 ops-<role>-<provider>-<level>）；
 *   ③ doctor 八项检查 D1–D8（矩阵完整性/键集/键值一致/绑定可解析/vision 多模态/
 *      实现与审核裁决跨族/族可解析/默认与回退覆盖）+ D9 旧名提示（WARN）；
 *   ④ 写侧命令（select/gen/enable/disable/preset/sync）本版不实现，命中即提示并
 *      非零退出，不静默成功、不伪造写盘。
 *   ⑤ R0 执法面（全部只读）：dispatch-check＝十岗 dispatch-plan × resolve 结果 ×
 *      拟派名单（plan §1 slot 列）三方对账，陈旧 ROUTE/启用集不符即 FAIL；
 *      snapshots＝S1-S4 四源六比较＋S2→S1 单向派生逐字节（出厂滞后=WARN 不阻断、
 *      出厂互恰破坏或派生漂移=FAIL；S1 providers/series_process 不入比较，
 *      常设第二审仅 dispatch-check 读 series_process.reviewer_second）。
 * 退出码口径单源=references/06 §5.8（此处不复写数字——语义映射，防双源漂移）。
 * 用法：
 *   node scripts/agent-slots.mjs list [--role <role>] [--json]
 *   node scripts/agent-slots.mjs show <slot> [--json]
 *   node scripts/agent-slots.mjs resolve --route "<route>" [--json]
 *   node scripts/agent-slots.mjs doctor [--project <dir>] [--json] [--degrade <D7|snapshot-lag>]
 *   node scripts/agent-slots.mjs dispatch-check --plan <dispatch-plan.md> --route "<ROUTE>" [--project <dir>]
 *   node scripts/agent-slots.mjs snapshots [--project <dir>] [--json]
 *   node scripts/agent-slots.mjs pick <role> [--json]
 *   node scripts/agent-slots.mjs --self-test
 *   （flag 取值一律空格分隔，--x=y 等号形态=用法错拒收——cliFlag 单源立场）
 * 可 import 纯函数零副作用（isMain guard 惯例；自检向量禁动真实 templates/agents/）。
 */
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { SKILL_ROOT, loadOrgConfig, cliFlag, UsageError, familyOf, readJson } from './org-config.mjs'
import { parseBindingValue } from './deploy-check.mjs'
import { MATRIX_PATH, ROLE_ORDER, SLOT_NAME_RE, loadMatrix, slotsFromMatrix } from './gen-agents.mjs'

export const LEVEL_ORDER = { low: 0, high: 1, max: 2 }
export const WRITE_COMMANDS = ['select', 'gen', 'enable', 'disable', 'preset', 'sync']

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

/** slot 名解析：ops-<role>-<provider>-<level> → {role,provider,level}；不合形态 → null。
 *  说明：log-triage 的 parseSlotName 语义同构，但该脚本当前无 isMain guard（import 即
 *  执行 run 产生副作用），故本件保留最小解析器，不复制其业务逻辑。 */
function parseSlotKey(name) {
  const m = SLOT_NAME_RE.exec(String(name ?? ''))
  return m ? { role: m[1], provider: m[2], level: m[3] } : null
}

/** ROUTE 文本解析：前缀大小写不敏感；`;`/`,`/空白分隔；续行须两空格缩进。
 *  同角色重复 → 取最后一次并写 notes。无前缀/空路由/坏续行 → UsageError。 */
export function parseRoute(text) {
  const src = String(text ?? '').replace(/\r\n/g, '\n')
  if (!src.trim()) throw new UsageError('ROUTE 为空——须形如 ROUTE: research-glmflash;planner-699')
  const lines = src.split('\n')
  const m = /^\s*ROUTE\s*:\s*(.*)$/i.exec(lines[0])
  if (!m) throw new UsageError('缺 ROUTE: 前缀（大小写不敏感）——须以 ROUTE: 开头')
  const parts = [m[1]]
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (!/^\s{2,}/.test(line)) throw new UsageError(`ROUTE 续行须以两个空格缩进：第 ${i + 1} 行「${line.trim()}」`)
    parts.push(line.trim())
  }
  const tokens = parts.join(' ').split(/[;,\s]+/).filter(Boolean)
  if (!tokens.length) throw new UsageError('ROUTE 未包含任何 <role>-<provider> 项')
  const items = []
  const notes = []
  const index = new Map()
  for (const token of tokens) {
    const cut = token.indexOf('-')
    if (cut <= 0 || cut === token.length - 1) throw new UsageError(`ROUTE 项「${token}」不是 <role>-<provider> 形态`)
    const role = token.slice(0, cut)
    const provider = token.slice(cut + 1)
    if (index.has(role)) {
      const prev = items[index.get(role)]
      notes.push(`角色 ${role} 重复声明（${prev.provider} → ${provider}），取最后一次`)
      items[index.get(role)] = { role, provider }
    } else {
      index.set(role, items.length)
      items.push({ role, provider })
    }
  }
  return { items, notes }
}

/** ROUTE 逐项校验：未知角色 / 角色不支持 provider / vision 非多模态。
 *  vision 谓词（B2 批 D-7a）=multimodal===true 或 provider 恰为 startplan（文本应急
 *  候选，不承载图像判读）——与 verify-docs/gen-agents/org-config 四面同款。
 *  返回错误数组（空=通过）；错误行内携带合法值。 */
export function validateRoute(route, matrix) {
  const errors = []
  const roles = matrix?.roles || {}
  const providers = matrix?.providers || {}
  const legalRoles = Object.keys(roles).length ? Object.keys(roles) : [...ROLE_ORDER]
  for (const item of route?.items || []) {
    if (!own(roles, item.role)) {
      errors.push(`未知角色「${item.role}」——合法角色：${legalRoles.join(', ')}`)
      continue
    }
    const roleDef = roles[item.role]
    const available = Array.isArray(roleDef.providers) ? roleDef.providers : []
    if (!available.includes(item.provider)) {
      errors.push(`角色「${item.role}」不支持 provider「${item.provider}」——可用 provider：${available.join(', ')}`)
      continue
    }
    if (item.role === 'vision' && item.provider !== 'startplan' && providers[item.provider]?.multimodal !== true)
      errors.push(`vision 岗 provider「${item.provider}」非多模态（multimodal≠true）——视觉岗只允许多模态 provider（startplan 例外=文本应急候选）`)
  }
  return errors
}

/** ROUTE 解析结果：逐项给 slot/model/level/family/route_source。
 *  family 取 cfg.providers[provider] 的 family||model_family（familyOf 单源）；
 *  model 取 cfg.agent_slots[slot].model；解析不到写 '?'。 */
export function resolveRoute(route, matrix, cfg) {
  return (route?.items || []).map(({ role, provider }) => {
    const level = matrix?.roles?.[role]?.level || '?'
    const slot = level === '?' ? '?' : `ops-${role}-${provider}-${level}`
    const model = slot === '?' ? '?' : (cfg?.agent_slots?.[slot]?.model || '?')
    return {
      role,
      slot,
      provider,
      model: typeof model === 'string' && model ? model : '?',
      level,
      family: familyOf(cfg?.providers?.[provider]) || '?',
      route_source: 'prompt',
    }
  })
}

/** 旧名登记表取值：只认矩阵 aliases 分区（唯一登记源）；缺失/非普通对象 → null。
 *  不设内嵌兜底——缺分区按配置错处理（resolve exit 3 / doctor D9a FAIL）。 */
function aliasTableOf(matrix) {
  const a = matrix?.aliases
  return isPlainObject(a) ? a : null
}

/** 旧名解析候选（不校验 slot 是否已登记）：返回 {alias,role,slot,level,provider} 或 null。
 *  角色默认型（provider=null）取 cfg.agent_defaults 当前默认档位（=角色顺序首元素；
 *  临时窗机制已退役，无第二视图）；固定 provider 型用 ops-<role>-<provider>-<level>。 */
function aliasCandidate(name, matrix, cfg) {
  const table = aliasTableOf(matrix)
  if (!table || !own(table, name)) return null
  const def = table[name]
  if (!isPlainObject(def) || typeof def.role !== 'string' || !def.role) return null
  const level = matrix?.roles?.[def.role]?.level
  if (typeof level !== 'string' || !level) return null
  let slot = null
  let provider = null
  if (typeof def.provider === 'string' && def.provider) {
    provider = def.provider
    slot = `ops-${def.role}-${provider}-${level}`
  } else {
    const d = isPlainObject(cfg?.agent_defaults) ? cfg.agent_defaults[def.role] : undefined
    if (typeof d === 'string' && d) slot = d
  }
  return slot ? { alias: name, role: def.role, slot, level, provider } : null
}

/** 旧名解析（L4）：纯函数、零副作用、不读环境变量/文件。
 *  返回 { alias, role, slot, provider, model, level, family, route_source:'alias' }，
 *  未登记名或解析到的 slot 不在 agent_slots 时返回 null（调用侧负责 exit 1 点名）。 */
export function resolveAlias(name, matrix, cfg) {
  const cand = aliasCandidate(name, matrix, cfg)
  if (!cand) return null
  const slots = isPlainObject(cfg?.agent_slots) ? cfg.agent_slots : {}
  if (!own(slots, cand.slot)) return null
  const parsed = parseSlotKey(cand.slot)
  const provider = parsed?.provider || cand.provider || '?'
  const def = slots[cand.slot]
  const model = def && typeof def.model === 'string' ? def.model : '?'
  return {
    alias: name,
    role: cand.role,
    slot: cand.slot,
    provider,
    model: model || '?',
    level: cand.level,
    family: familyOf(cfg?.providers?.[provider]) || '?',
    route_source: 'alias',
  }
}

/** 已知旧名清单（矩阵登记表声明序）；矩阵缺 aliases 分区 → 空数组（由调用侧判配置错）。 */
export function aliasNames(matrix) {
  const table = aliasTableOf(matrix)
  return table ? Object.keys(table) : []
}

/** agent_slots 全量行：按 role（ROLE_ORDER 派生岗序）→ level（low<high<max）→ provider 排序。 */
export function slotRows(cfg) {
  const rows = []
  for (const [slot, def] of Object.entries(cfg?.agent_slots || {})) {
    const parsed = parseSlotKey(slot)
    const role = parsed?.role || '?'
    const level = parsed?.level || (def && typeof def.level === 'string' ? def.level : '?')
    const provider = def && typeof def.provider === 'string' ? def.provider : (parsed?.provider || '?')
    const model = def && typeof def.model === 'string' ? def.model : '?'
    rows.push({ slot, role, provider, model, level, family: familyOf(cfg?.providers?.[provider]) || '?' })
  }
  const rank = (v, list) => { const i = list.indexOf(v); return i < 0 ? 99 : i }
  rows.sort((a, b) =>
    rank(a.role, ROLE_ORDER) - rank(b.role, ROLE_ORDER) ||
    (LEVEL_ORDER[a.level] ?? 99) - (LEVEL_ORDER[b.level] ?? 99) ||
    (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0) ||
    (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0),
  )
  return rows
}

/** doctor 八项检查：返回 [{level, code, line}]（空=通过）。
 *  D4 在 P4 阶段预期红色（矩阵派生的全部新 slot 尚无绑定，P5 补）；本函数如实报出，不放宽。 */
export function doctorFindings(matrix, cfg, opts = {}) {
  const findings = []
  const add = (level, code, line) => findings.push({ level, code, line })
  const maxList = Number.isFinite(opts?.maxList) ? opts.maxList : Infinity
  const names = (arr) => (arr.length > maxList ? `${arr.slice(0, maxList).join('、')}…（另 ${arr.length - maxList} 项）` : arr.join('、'))
  const roles = isPlainObject(matrix?.roles) ? matrix.roles : {}
  const matrixProviders = isPlainObject(matrix?.providers) ? matrix.providers : {}
  const cfgSlots = isPlainObject(cfg?.agent_slots) ? cfg.agent_slots : {}
  const cfgProviders = isPlainObject(cfg?.providers) ? cfg.providers : {}
  const bindings = isPlainObject(cfg?.agent_bindings) ? cfg.agent_bindings : {}
  const defaults = isPlainObject(cfg?.agent_defaults) ? cfg.agent_defaults : {}
  const fallbacks = isPlainObject(cfg?.role_fallbacks) ? cfg.role_fallbacks : {}

  // D1：矩阵十岗齐全、slot 数=独立算式期望、命名合法。
  // 期望值=Σ roles[role].providers.length（verify-docs 矩阵计数检查既有口径，L19 派生化
  // ——禁用 slotsFromMatrix 输出长度作期望值：自指恒真=计数检查静默失效，r1-W1）。
  const expectedSlots = ROLE_ORDER.reduce((n, r) => n + (Array.isArray(roles[r]?.providers) ? roles[r].providers.length : 0), 0)
  for (const role of ROLE_ORDER) if (!own(roles, role)) add('FAIL', 'D1', `矩阵缺角色「${role}」——${ROLE_ORDER.length} 岗须齐全（${ROLE_ORDER.join(', ')}）`)
  for (const role of Object.keys(roles)) if (!ROLE_ORDER.includes(role)) add('FAIL', 'D1', `矩阵含未知角色「${role}」——只允许 ${ROLE_ORDER.join(', ')}`)
  let slots = []
  try { slots = slotsFromMatrix(matrix) } catch (e) { add('FAIL', 'D1', `矩阵无法派生 slot：${e.message}`) }
  for (const s of slots.filter((x) => !SLOT_NAME_RE.test(x.slot))) add('FAIL', 'D1', `slot 名「${s.slot}」不合命名契约 ops-<role>-<provider>-<level>`)
  if (slots.length !== expectedSlots) add('FAIL', 'D1', `slot 数=${slots.length}≠独立算式期望 ${expectedSlots}（Σ roles[role].providers.length）`)

  // D2：cfg.agent_slots 键集与矩阵派生 slot 集相等（无孤儿、无缺失）
  const matrixSet = new Set(slots.map((s) => s.slot))
  const missingSlots = [...matrixSet].filter((x) => !own(cfgSlots, x))
  const orphanSlots = Object.keys(cfgSlots).filter((x) => !matrixSet.has(x))
  if (missingSlots.length) add('FAIL', 'D2', `agent_slots 缺 ${missingSlots.length} 个矩阵 slot：${names(missingSlots)}`)
  if (orphanSlots.length) add('FAIL', 'D2', `agent_slots 含 ${orphanSlots.length} 个孤儿 slot（矩阵未派生）：${names(orphanSlots)}`)

  // D3：每个 slot 的 provider/level 与 slot 名一致、model 非空
  for (const [name, def] of Object.entries(cfgSlots)) {
    const parsed = parseSlotKey(name)
    if (!parsed) { add('FAIL', 'D3', `agent_slots 键「${name}」不合命名契约 ops-<role>-<provider>-<level>`); continue }
    if (!isPlainObject(def)) { add('FAIL', 'D3', `agent_slots.${name} 须为对象 {provider,model,level}`); continue }
    if (def.provider !== parsed.provider) add('FAIL', 'D3', `agent_slots.${name}.provider=${JSON.stringify(def.provider)} 与键名 provider 段「${parsed.provider}」不一致`)
    if (def.level !== parsed.level) add('FAIL', 'D3', `agent_slots.${name}.level=${JSON.stringify(def.level)} 与键名 level 段「${parsed.level}」不一致`)
    if (typeof def.model !== 'string' || !def.model.trim()) add('FAIL', 'D3', `agent_slots.${name}.model 须为非空字符串`)
  }

  // D4：每个矩阵 slot 有绑定、可解析、档位与有效档位一致（B4 D-4 覆盖感知：
  // thought_level_overrides 在案时以覆盖档为基准——overrides[s.role] ?? s.level；
  // 无覆盖文案与行为逐字不变。ROUTE/别名 level 仍是槽位定址结构标识，此处零涉。）
  const levelOverrides = isPlainObject(cfg?.thought_level_overrides) ? cfg.thought_level_overrides : {}
  for (const s of slots) {
    if (!own(bindings, s.slot)) { add('FAIL', 'D4', `slot ${s.slot} 无绑定（agent_bindings 缺键）`); continue }
    const parsed = parseBindingValue(bindings[s.slot])
    if (!parsed) { add('FAIL', 'D4', `slot ${s.slot} 绑定值无法解析（${JSON.stringify(bindings[s.slot])}）——须为 provider/model$level 或 {model,level}`); continue }
    const eff = levelOverrides[s.role] ?? s.level
    if (parsed.level !== eff) add('FAIL', 'D4', `slot ${s.slot} 绑定档位=${parsed.level ?? '缺失'} ≠ ${levelOverrides[s.role] != null ? `有效档位=${eff}（thought_level_overrides.${s.role}=${eff} 在案·以覆盖为准）` : `slot level=${s.level}`}`)
  }

  // D5：vision 岗每个 slot 的 provider 谓词（矩阵与本机 providers 双源核对；B2 批 D-7a、
  // 返工 R1 本机侧统一）：multimodal===true 或 provider 恰为 startplan（文本应急例外）
  // 才过——两侧缺键或非 true 均拒（fail-closed）。
  for (const s of slots.filter((x) => x.role === 'vision')) {
    if (s.provider !== 'startplan' && matrixProviders[s.provider]?.multimodal !== true) add('FAIL', 'D5', `vision slot ${s.slot} 的 provider「${s.provider}」在矩阵中 multimodal≠true（缺键或非 true 均拒）`)
    if (s.provider !== 'startplan' && cfgProviders[s.provider] && cfgProviders[s.provider].multimodal !== true) add('FAIL', 'D5', `vision slot ${s.slot} 的 provider「${s.provider}」在本机 providers 中 multimodal≠true（multimodal===true 或 startplan 例外才过——缺键或非 true 均拒）`)
  }

  // D6：默认实现族 ≠ 默认一号审核族、≠ 默认裁决族（implreview-split 批 D-4：首席键迁一号）；
  //     新增一号默认族 × 二号默认族同族＝FAIL（执行者审核两席须不同模型族，推荐项面——
  //     validate 结构校验不拦同族，负例夹具仍可通过结构校验）。缺任一族=fail-closed。
  const familyOfDefault = (role) => {
    const name = defaults[role]
    const def = typeof name === 'string' ? cfgSlots[name] : null
    const provider = def && typeof def.provider === 'string' ? def.provider : null
    return provider ? (familyOf(cfgProviders[provider]) || '') : ''
  }
  const fExec = familyOfDefault('executor')
  const fRev1 = familyOfDefault('implreview1')
  const fRev2 = familyOfDefault('implreview2')
  const fAdj = familyOfDefault('adjudicator')
  if (!fExec || !fRev1 || !fRev2 || !fAdj) add('FAIL', 'D6', `无法解析默认实现/审核/裁决族（executor=${fExec || '?'} implreview1=${fRev1 || '?'} implreview2=${fRev2 || '?'} adjudicator=${fAdj || '?'}）——明细见 D7/D8`)
  else {
    if (fExec === fRev1) add('FAIL', 'D6', `默认实现族=一号审核族「${fExec}」——须不同模型族（05 §5）`)
    if (fExec === fAdj) add('FAIL', 'D6', `默认实现族=裁决族「${fExec}」——须不同模型族（05 §5）`)
    if (fRev1 === fRev2) add('FAIL', 'D6', `默认一号审核族=二号审核族「${fRev1}」——执行者审核两席须不同模型族（拆席 D-4 推荐项执法面）`)
  }

  // D7：每个 slot 的 provider 能在 cfg.providers 解析出 family（WARN）
  const missingFamily = new Map()
  for (const s of slots) {
    if (familyOf(cfgProviders[s.provider])) continue
    if (!missingFamily.has(s.provider)) missingFamily.set(s.provider, [])
    missingFamily.get(s.provider).push(s.slot)
  }
  for (const [provider, affected] of missingFamily)
    add('WARN', 'D7', `provider「${provider}」在 cfg.providers 解析不到 family/model_family（影响 ${affected.length} 个 slot：${names(affected)}）`)

  // D8：agent_defaults / role_fallbacks 覆盖 ROLE_ORDER 全部角色（现十角色）且指向存在的 slot
  for (const role of ROLE_ORDER) {
    if (!own(defaults, role)) add('FAIL', 'D8', `agent_defaults 缺角色「${role}」`)
    else {
      const name = defaults[role]
      if (typeof name !== 'string' || !own(cfgSlots, name)) add('FAIL', 'D8', `agent_defaults.${role} 指向不存在的 slot「${name}」`)
      else if (parseSlotKey(name)?.role !== role) add('FAIL', 'D8', `agent_defaults.${role} 指向 slot「${name}」但角色不符`)
    }
    if (!own(fallbacks, role)) add('FAIL', 'D8', `role_fallbacks 缺角色「${role}」`)
    else {
      const seq = fallbacks[role]
      if (!Array.isArray(seq) || seq.length === 0) add('FAIL', 'D8', `role_fallbacks.${role} 须为非空数组`)
      else for (const name of seq) {
        if (typeof name !== 'string' || !own(cfgSlots, name)) add('FAIL', 'D8', `role_fallbacks.${role} 指向不存在的 slot「${name}」`)
        else if (parseSlotKey(name)?.role !== role) add('FAIL', 'D8', `role_fallbacks.${role} 指向 slot「${name}」但角色不符`)
      }
    }
  }
  for (const role of Object.keys(defaults)) if (!ROLE_ORDER.includes(role)) add('FAIL', 'D8', `agent_defaults 含多余角色「${role}」`)
  for (const role of Object.keys(fallbacks)) if (!ROLE_ORDER.includes(role)) add('FAIL', 'D8', `role_fallbacks 含多余角色「${role}」`)

  // D9（L4，WARN 不阻断）：配置面命中旧名 → 提示替换为解析后的新档名。
  // 扫描 agent_defaults 值、role_fallbacks 全部元素、agent_bindings 键；D1–D8 判据面不动（D1 计数期望已 L19 派生化）。
  // D9a（L4 r1，FAIL）：矩阵缺 aliases 分区=配置错（检测面不得静默失明）。
  const aliasTable = aliasTableOf(matrix)
  if (!aliasTable) {
    add('FAIL', 'D9a', 'templates/agents.matrix.json 缺 aliases 分区——旧名解析入口无登记表（唯一登记源=矩阵）')
  } else {
    // 建议值序（临时窗机制退役后无第二视图，直接读合并结果）：
    // ①候选解析档＝旧名角色当前默认档位（agent_defaults）；②该档仍是旧名→
    //   取该角色矩阵默认派生档；③N2：建议档必须真实存在于 agent_slots，禁推荐不存在档。
    const reportAlias = (name, where, role) => {
      const cand = aliasCandidate(name, matrix, cfg)
      let suggest = cand?.slot
      if (!suggest || own(aliasTable, suggest)) {
        const aliasDef = aliasTable[name]
        const r = aliasDef?.role ?? role
        const live = isPlainObject(cfg?.agent_defaults) ? cfg.agent_defaults[r] : undefined
        if (typeof live === 'string' && live && !own(aliasTable, live)) suggest = live
        else {
          const lvl = matrix?.roles?.[r]?.level
          const prov = matrix?.roles?.[r]?.default
          suggest = typeof lvl === 'string' && typeof prov === 'string' ? `ops-${r}-${prov}-${lvl}` : null
        }
      }
      // N2：建议值必须真实存在，禁推荐不存在的档。
      if (suggest && !own(cfgSlots, suggest)) suggest = null
      add('WARN', 'D9', `旧名「${name}」出现在 ${where}——建议替换为「${suggest || `${name} 对应角色的生效默认档位`}」`)
    }
    for (const [role, name] of Object.entries(defaults))
      if (typeof name === 'string' && own(aliasTable, name)) reportAlias(name, `agent_defaults.${role}`, role)
    for (const [role, seq] of Object.entries(fallbacks)) {
      if (!Array.isArray(seq)) continue
      seq.forEach((name, i) => { if (typeof name === 'string' && own(aliasTable, name)) reportAlias(name, `role_fallbacks.${role}[${i}]`, role) })
    }
    for (const key of Object.keys(bindings))
      if (own(aliasTable, key)) reportAlias(key, `agent_bindings.${key}`, aliasTable[key]?.role)
  }

  return findings
}

// ── R0 执法面（A1/A2）纯函数：snapshots 六比较＋S2→S1 派生＋dispatch-check 三方对账 ──
// 全部只读；S1=<project>/docs/agent-matrix.json（主仓矩阵）、S2=templates/agents.matrix.json、
// S3/S4=org-config.default.json / org-config.local.json 的 agent_defaults/role_fallbacks。
// S1 providers/series_process 与其他键明确排除在快照比较外（series_process.reviewer_second
// 仅由 dispatch-check 第二席对账消费）。

/** slot→provider 短名规范化（D-A2）：严格解析 ops-<role>-<provider>-<low|high|max>，
 *  去 ops-<role>- 前缀与档位后缀并校验角色段与所列岗位一致；不合形态/角色不符 → null。
 *  （非模糊字符串替换——slot 名不可规范化属装载错面，由调用侧 exit 3。） */
export function slotProviderOf(slot, role) {
  const parsed = parseSlotKey(slot)
  if (!parsed || parsed.role !== role) return null
  return parsed.provider
}

/** 出厂矩阵投影（S1/S2）：仅十岗 roles.*.default/fallback，按声明序保序拷贝；
 *  order 可注入（S2→S1 派生固定以 S2 声明序为准）；额外 role 一律不入 projection
 *  （d-N12：恰十岗，roles/bytes 口径固定）；schema 不符抛错（装载错面）。 */
export function matrixProjection(matrix, order = null) {
  const roles = isPlainObject(matrix?.roles) ? matrix.roles : null
  if (!roles) throw new Error('矩阵缺 roles 分区——快照投影仅取 roles.*.default/fallback')
  const keys = (order || Object.keys(roles)).filter((r) => ROLE_ORDER.includes(r))
  for (const role of ROLE_ORDER) if (!own(roles, role)) throw new Error(`矩阵 roles 缺角色「${role}」——十岗投影须齐全`)
  const out = {}
  for (const role of keys) {
    if (!own(roles, role)) throw new Error(`投影序含矩阵没有的角色「${role}」`)
    const def = roles[role].default
    const fb = roles[role].fallback
    if (typeof def !== 'string' || !def) throw new Error(`矩阵 roles.${role}.default 须为非空字符串`)
    if (!Array.isArray(fb) || !fb.length || fb.some((x) => typeof x !== 'string' || !x)) throw new Error(`矩阵 roles.${role}.fallback 须为非空字符串数组`)
    out[role] = { default: def, fallback: [...fb] }
  }
  return out
}

/** 配置投影（S3/S4）：agent_defaults/role_fallbacks 逐 slot 严格规范化成 provider 短名；
 *  slot 不可规范化/角色不符/十岗缺失 → 抛错（装载错面）。 */
export function configProjection(cfg) {
  const defaults = isPlainObject(cfg?.agent_defaults) ? cfg.agent_defaults : null
  const fallbacks = isPlainObject(cfg?.role_fallbacks) ? cfg.role_fallbacks : null
  if (!defaults || !fallbacks) throw new Error('配置缺 agent_defaults/role_fallbacks 分区——S3/S4 投影依赖')
  const out = {}
  for (const role of ROLE_ORDER) {
    if (!own(defaults, role)) throw new Error(`agent_defaults 缺角色「${role}」`)
    if (!own(fallbacks, role)) throw new Error(`role_fallbacks 缺角色「${role}」`)
    const d = slotProviderOf(defaults[role], role)
    if (d === null) throw new Error(`agent_defaults.${role} 的 slot「${defaults[role]}」不可规范化为 ops-${role}-<provider>-<low|high|max>`)
    const seq = fallbacks[role]
    if (!Array.isArray(seq) || !seq.length) throw new Error(`role_fallbacks.${role} 须为非空数组`)
    const fb = seq.map((s) => {
      const p = slotProviderOf(s, role)
      if (p === null) throw new Error(`role_fallbacks.${role} 的 slot「${s}」不可规范化`)
      return p
    })
    out[role] = { default: d, fallback: fb }
  }
  return out
}

/** 规范化投影文本：JSON.stringify(projection,null,2)+'\n'（S2→S1 派生逐字节比较载体）。 */
export function projectionText(projection) {
  return JSON.stringify(projection, null, 2) + '\n'
}

/** S2→S1 单向派生（D-A2）：以 S2 roles 声明序生成仅含 default/fallback 的规范化 JSON
 *  投影，对 S1 做同序投影后逐字节比较；禁止反向写（本函数与全部调用链零写盘）。 */
export function deriveS2ToS1(s1, s2) {
  const order = Object.keys(isPlainObject(s2?.roles) ? s2.roles : {}).filter((r) => ROLE_ORDER.includes(r)) // d-N12：恰十岗·额外 role 不入派生序
  const p2 = { roles: matrixProjection(s2, order) }
  const p1 = { roles: matrixProjection(s1, order) }
  const s2Text = projectionText(p2)
  const s1Text = projectionText(p1)
  return { equal: s1Text === s2Text, roles: order.length, bytes: Buffer.byteLength(s2Text), s1_text: s1Text, s2_text: s2Text, order }
}

const SNAPSHOT_FIELDS = ['default', 'fallback']
const SNAPSHOT_NAMES = ['S1', 'S2', 'S3', 'S4']
const FACTORY_PAIRS = [[0, 1], [0, 2], [1, 2]] // S1×S2/S1×S3/S2×S3＝出厂互恰（FAIL 面）
const LIVE_PAIRS = [[0, 3], [1, 3], [2, 3]]    // S1×S4/S2×S4/S3×S4＝出厂/现役滞后（WARN 面）

function snapshotFieldEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i])
  return a === b
}

/** snapshots 六比较引擎（纯函数·零写盘）：出厂互恰任一字段不一致计 factory_diff；
 *  现役比较全算并按岗位去重聚合（WARN 行数＝差异岗位数，另计字段差总数）；
 *  S2→S1 派生逐字节；返回含 ISO inspected_at。 */
export function snapshotReport({ s1, s2, s3, s4 }) {
  const proj = [matrixProjection(s1), matrixProjection(s2), configProjection(s3), configProjection(s4)]
  const factoryDiffs = []
  for (const [a, b] of FACTORY_PAIRS)
    for (const role of ROLE_ORDER)
      for (const field of SNAPSHOT_FIELDS)
        if (!snapshotFieldEqual(proj[a][role][field], proj[b][role][field]))
          factoryDiffs.push({ pair: `${SNAPSHOT_NAMES[a]}×${SNAPSHOT_NAMES[b]}`, role, field, [SNAPSHOT_NAMES[a]]: proj[a][role][field], [SNAPSHOT_NAMES[b]]: proj[b][role][field] })
  const warns = []
  for (const role of ROLE_ORDER) {
    const fields = SNAPSHOT_FIELDS.filter((f) => LIVE_PAIRS.some(([a, b]) => !snapshotFieldEqual(proj[a][role][f], proj[b][role][f])))
    if (fields.length)
      warns.push({ role, fields, values: Object.fromEntries(SNAPSHOT_NAMES.map((n, i) => [n, proj[i][role]])) })
  }
  const derived = deriveS2ToS1(s1, s2)
  return {
    inspected_at: new Date().toISOString(),
    factory_fail: factoryDiffs.length,
    factory_diffs: factoryDiffs,
    warn_roles: warns.length,
    warn_field_diffs: warns.reduce((n, w) => n + w.fields.length, 0),
    warns,
    derived_fail: derived.equal ? 0 : 1,
    derived: { equal: derived.equal, roles: derived.roles, bytes: derived.bytes },
  }
}

/** dispatch-plan §1 十岗表行解析（implreview-split 批 D-5）：岗位列=裸角色，implreview1/
 *  implreview2 各自一行；第一席/第二席限定词随拆席退役——任何角色带限定＝坏列；旧合并键
 *  implreview＝具名拒绝（指向两新键）。seat 字段保留恒 0（消费面已全部按裸角色对账）。 */
function parseRoleCell(text) {
  const t = String(text ?? '').trim()
  const m = /^([a-z0-9]+)\s*(?:（([^）]*)）|\(([^)]*)\))?$/.exec(t)
  const role = m ? m[1] : null
  if (role === 'implreview')
    throw new Error(`§1 岗位列「${t}」——旧合并审核键 implreview 已拆为 implreview1/implreview2 两独立注册行（各裸角色一行）`)
  if (!m || !ROLE_ORDER.includes(role)) {
    if (/^implreview(?![0-9])/.test(t))
      throw new Error(`§1 岗位列「${t}」——旧合并审核键 implreview 已拆为 implreview1/implreview2 两独立注册行（各裸角色一行）`)
    throw new Error(`§1 岗位列「${t}」不是十岗角色或形态不符`)
  }
  const qual = m[2] ?? m[3] ?? ''
  if (qual) throw new Error(`§1 岗位「${t}」带限定词「${qual}」——限定词已随拆席退役，须裸角色行`)
  return { role, seat: 0 }
}

/** dispatch-plan 解析（D-A1·拆席随动 D-5）：§1 十岗表（十角色齐全、各恰一行，
 *  slot/route_source/启用必填）＋§2 ROUTE 恰一行；任一畸形抛错（CLI 映射装载错）。 */
export function parseDispatchPlan(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const sectionIdx = (n) => lines.findIndex((l) => new RegExp(`^##\\s*${n}[.、)]`).test(l))
  const i1 = sectionIdx(1)
  const i2 = sectionIdx(2)
  if (i1 < 0) throw new Error('plan 缺 §1 段（须「## 1.」十岗实选表标题）')
  if (i2 < 0) throw new Error('plan 缺 §2 段（须「## 2.」ROUTE 标题）')
  if (i2 <= i1) throw new Error('plan §2 须位于 §1 之后')
  const body = lines.slice(i1 + 1, i2)
  const first = body.findIndex((l) => l.trim().startsWith('|'))
  if (first < 0) throw new Error('§1 缺十岗表（须 | 岗位 | 实际 slot | route_source | 启用 | … | 表）')
  const tableLines = []
  for (let i = first; i < body.length && body[i].trim().startsWith('|'); i++) tableLines.push(body[i])
  const cellsOf = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  const header = cellsOf(tableLines[0])
  const idxRole = header.findIndex((h) => /岗\s*位/.test(h))
  const idxSlot = header.findIndex((h) => /slot/i.test(h))
  const idxSrc = header.findIndex((h) => h.includes('route_source'))
  const idxEn = header.findIndex((h) => h.includes('启用'))
  if (idxRole < 0 || idxSlot < 0 || idxSrc < 0 || idxEn < 0) throw new Error(`§1 表列缺失（须含 岗位/slot/route_source/启用 列），表头=${JSON.stringify(header)}`)
  const rows = []
  for (let i = 1; i < tableLines.length; i++) {
    const c = cellsOf(tableLines[i])
    if (c.every((x) => /^:?-{3,}:?$/.test(x))) continue // 分隔行
    if (c.length < header.length) throw new Error(`§1 表行列数=${c.length}＜表头 ${header.length}（坏列）：${tableLines[i].slice(0, 60)}`)
    const { role, seat } = parseRoleCell(c[idxRole])
    const slot = c[idxSlot]
    if (!SLOT_NAME_RE.test(slot)) throw new Error(`§1 行 slot「${slot}」不合 ops-<role>-<provider>-<level>`)
    if (parseSlotKey(slot).role !== role) throw new Error(`§1 行 slot「${slot}」角色段与岗位列「${c[idxRole]}」不符`)
    if (!c[idxSrc]) throw new Error(`§1 行（${c[idxRole]}）route_source 列为空`)
    const enabled = c[idxEn] === '是' ? true : c[idxEn] === '否' ? false : null
    if (enabled === null) throw new Error(`§1 行（${c[idxRole]}）启用列须为 是/否，实得「${c[idxEn]}」`)
    rows.push({ role, seat, slot, route_source_text: c[idxSrc], enabled })
  }
  for (const role of ROLE_ORDER) {
    const n = rows.filter((r) => r.role === role).length
    if (n !== 1) throw new Error(`§1 岗位「${role}」须恰一行，实得 ${n} 行（十岗各一行——重复/缺行=畸形）`)
  }
  const sec2 = lines.slice(i2 + 1)
  const end2 = sec2.findIndex((l) => /^##\s/.test(l))
  const scope = end2 < 0 ? sec2 : sec2.slice(0, end2)
  const routeLines = scope.filter((l) => /^\s*ROUTE\s*:/i.test(l)) // 保留原行原样（逐字比对载体·禁 trim）
  if (!routeLines.length) throw new Error('§2 缺 ROUTE 行')
  if (routeLines.length > 1) throw new Error(`§2 ROUTE 多值（${routeLines.length} 行）`)
  try { parseRoute(routeLines[0]) } catch (e) { throw new Error(`§2 ROUTE 畸形：${e.message}`) }
  return { rows, route_text: routeLines[0] }
}

/** dispatch-check 三方对账引擎（纯函数）：plan §1 拟派名单 × resolve(ROUTE)/三层默认 ×
 *  启用集；ROUTE＞项目覆盖＞本机件＞矩阵默认（未列岗由 loadOrgConfig(projectDir) 合并
 *  agent_defaults 补全并标 defaults——本批即 S4 现役值，禁读出厂替代）；implreview-split
 *  批 D-3/D-5：十岗各一行统一对账，第二审键=implreview2——S1 series_process.reviewer_second
 *  只做派生一致性复核（=merged role_fallbacks.implreview2[0]=agent_defaults.implreview2=plan 行），
 *  不再凭限定词排除该行、不另设第二套人工排序。返回 diffs/route_errors/计数。 */
export function dispatchCheck({ plan, routeText, matrix, cfg, s1 }) {
  const route = parseRoute(routeText) // 语法错→UsageError（exit 1 面）
  const routeErrors = validateRoute(route, matrix)
  const byRole = new Map(resolveRoute(route, matrix, cfg).map((r) => [r.role, r]))
  const defaults = isPlainObject(cfg?.agent_defaults) ? cfg.agent_defaults : {}
  for (const role of ROLE_ORDER) {
    const d = defaults[role]
    if (typeof d !== 'string' || slotProviderOf(d, role) === null)
      throw new Error(`agent_defaults.${role} 缺失或不可规范化（${String(d)}）——未列岗默认补全依赖三层装载现役值`)
  }
  const slots = isPlainObject(cfg?.agent_slots) ? cfg.agent_slots : {}
  const diffs = []
  if (String(routeText) !== plan.route_text) // z-W03/d-N11：去 trim·逐字比对（前导/尾随空白亦判不一致）
    diffs.push(`--route 与 plan §2 ROUTE 不一致（须逐字一致·前导/尾随空白亦判不一致）：--route=「${JSON.stringify(String(routeText))}」 plan §2=「${JSON.stringify(plan.route_text)}」`)
  const rows = []
  let enabled = 0
  for (const pr of plan.rows) {
    const viaRoute = byRole.has(pr.role)
    const resolved = viaRoute ? byRole.get(pr.role).slot : defaults[pr.role]
    const source = viaRoute ? 'prompt' : 'defaults'
    if (pr.enabled) enabled++
    if (viaRoute && !pr.enabled) diffs.push(`ROUTE 列禁用岗「${pr.role}」（plan §1 启用=否）`)
    if (!viaRoute && pr.enabled) diffs.push(`启用岗「${pr.role}」未列入 ROUTE（plan §1 启用=是）`)
    if (!viaRoute && !own(slots, resolved)) // d-N10：S4 补全 slot 须在 cfg.agent_slots 注册
      throw new Error(`agent_defaults.${pr.role} 指向的补全 slot「${resolved}」未在 cfg.agent_slots 注册——现役默认补全禁用未注册档（装载错）`)
    if (resolved !== pr.slot) diffs.push(`${pr.role}: 解析=${resolved}（${source}）≠ plan 拟派=${pr.slot}${viaRoute ? '——ROUTE 值陈旧' : '——与现役默认不符'}`)
    rows.push({ role: pr.role, plan_slot: pr.slot, resolved_slot: resolved, route_source: source, enabled: pr.enabled })
  }
  // D-3 派生一致性（二号三方相等）：S1 reviewer_second = merged agent_defaults.implreview2
  // = merged role_fallbacks.implreview2[0] = plan implreview2 行；单方改值=diff 点名字段。
  const second = plan.rows.find((r) => r.role === 'implreview2')
  const reviewerSecond = s1?.series_process?.reviewer_second
  if (typeof reviewerSecond !== 'string' || !reviewerSecond)
    throw new Error('S1 docs/agent-matrix.json 缺 series_process.reviewer_second——常设第二审对账依赖（装载错）')
  if (second.slot !== reviewerSecond)
    diffs.push(`implreview2: plan=${second.slot} ≠ S1 series_process.reviewer_second=${reviewerSecond}`)
  if (defaults.implreview2 !== reviewerSecond)
    diffs.push(`implreview2 派生不一致：S1 series_process.reviewer_second=${reviewerSecond} ≠ agent_defaults.implreview2=${defaults.implreview2}（三方须相等）`)
  const fallbacks = isPlainObject(cfg?.role_fallbacks) ? cfg.role_fallbacks : {}
  const fb2 = Array.isArray(fallbacks.implreview2) ? fallbacks.implreview2 : []
  if (fb2[0] !== reviewerSecond)
    diffs.push(`implreview2 派生不一致：S1 series_process.reviewer_second=${reviewerSecond} ≠ role_fallbacks.implreview2[0]=${fb2[0] ?? '缺失'}（三方须相等）`)
  return {
    ok: routeErrors.length === 0 && diffs.length === 0,
    roles: new Set(rows.map((r) => r.role)).size,
    enabled,
    route_items: route.items.length,
    second_reviewer: reviewerSecond,
    second_plan_slot: second.slot,
    second_default: defaults.implreview2,
    second_fallback_head: fb2[0],
    rows,
    diffs,
    route_errors: routeErrors,
    notes: route.notes,
  }
}


// ── CLI 辅助 ──
const VALUE_FLAGS = new Set(['--role', '--route', '--agent', '--plan', '--project', '--degrade'])

function positionals(argv) {
  const out = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (VALUE_FLAGS.has(a)) { i++; continue }
    if (a.startsWith('--')) continue
    out.push(a)
  }
  return out
}

function loadCfgOrExit() {
  try {
    const loaded = loadOrgConfig(SKILL_ROOT)
    const cfg = loaded.merged
    if (!isPlainObject(cfg)) {
      console.error('[装载错] org-config 合并结果为空/非对象——按装载错处理（检查 org-config.default.json/local.json）')
      process.exit(3)
    }
    return cfg
  } catch (e) {
    console.error(`[装载错] org-config 装载失败：${e.message}`)
    process.exit(3)
  }
}

function loadMatrixOrExit() {
  try {
    return loadMatrix(MATRIX_PATH)
  } catch (e) {
    console.error(`[装载错] 逻辑矩阵装载失败：${e.message}`)
    process.exit(3)
  }
}

/** R0 命令的 S1 主仓矩阵项目目录解析（D-A1/D-A2）：--project 显式给值则校验其下
 *  docs/agent-matrix.json 在场；缺省自 cwd 向上找 docs/agent-matrix.json；
 *  任一失败＝装载错（S1 是 snapshots 六比较与 dispatch-check 第二席的必需源）。 */
function resolveProjectDirOrExit(flagVal) {
  if (flagVal !== null) {
    const dir = resolve(flagVal)
    if (!existsSync(join(dir, 'docs', 'agent-matrix.json'))) {
      console.error(`[装载错] --project 目录缺 docs/agent-matrix.json（S1 主仓矩阵·必需源）：${dir}`)
      process.exit(3)
    }
    return dir
  }
  let dir = process.cwd()
  for (;;) {
    if (existsSync(join(dir, 'docs', 'agent-matrix.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) {
      console.error(`[装载错] 未指定 --project 且自 ${process.cwd()} 向上未找到 docs/agent-matrix.json（S1 主仓矩阵·必需源）`)
      process.exit(3)
    }
    dir = parent
  }
}

function usage() {
  return [
    '用法：',
    '  node scripts/agent-slots.mjs list [--role <role>] [--json]',
    '  node scripts/agent-slots.mjs show <slot> [--json]',
    '  node scripts/agent-slots.mjs resolve --route "<route>" [--json]',
    '  node scripts/agent-slots.mjs resolve --agent <旧名> [--json]',
    '  node scripts/agent-slots.mjs doctor [--project <dir>] [--json] [--degrade <D7|snapshot-lag>]',
    '  node scripts/agent-slots.mjs dispatch-check --plan <dispatch-plan.md> --route "<ROUTE>" [--project <dir>]',
    '  node scripts/agent-slots.mjs snapshots [--project <dir>] [--json]',
    '  node scripts/agent-slots.mjs pick <role> [--json]',
    '  node scripts/agent-slots.mjs --self-test',
  ].join('\n')
}

function printTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i]).length)))
  const line = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join('  ').trimEnd()
  console.log(line(headers))
  for (const r of rows) console.log(line(r))
}

function editDistance(a, b) {
  const s = String(a)
  const t = String(b)
  const dp = Array.from({ length: s.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= t.length; j++) dp[0][j] = j
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1))
    }
  }
  return dp[s.length][t.length]
}

function nearestSlots(target, names, limit = 5) {
  const threshold = Math.max(2, Math.floor(String(target).length / 4))
  return names
    .map((n) => ({ n, d: editDistance(target, n) }))
    .filter((x) => x.d <= threshold)
    .sort((a, b) => a.d - b.d || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0))
    .slice(0, limit)
    .map((x) => x.n)
}

// ── --self-test（纯函数+临时目录/none 写盘；禁动真实 templates/agents/）──
function selfTest() {
  let fails = 0
  let n = 0
  const t = (name, cond) => (n++, console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`), cond || fails++)
  const clone = (v) => JSON.parse(JSON.stringify(v))
  let matrix
  try {
    matrix = loadMatrix(MATRIX_PATH)
  } catch (e) {
    console.log(`FAIL 矩阵装载失败：${e.message}`)
    console.log('self-test 1 项失败')
    process.exit(1)
  }

  // 合成合规配置：矩阵派生 slot + 全绑定 + 默认/回退全覆盖
  const compliantCfg = () => {
    const cfg = { providers: {}, agent_slots: {}, agent_bindings: {}, agent_defaults: {}, role_fallbacks: {} }
    for (const [name, p] of Object.entries(matrix.providers)) cfg.providers[name] = { family: p.family, multimodal: p.multimodal }
    for (const s of slotsFromMatrix(matrix)) {
      cfg.agent_slots[s.slot] = { provider: s.provider, model: `model-of-${s.provider}`, level: s.level }
      cfg.agent_bindings[s.slot] = `provider-${s.provider}/model-of-${s.provider}$${s.level}`
    }
    for (const [role, def] of Object.entries(matrix.roles)) {
      cfg.agent_defaults[role] = `ops-${role}-${def.default}-${def.level}`
      cfg.role_fallbacks[role] = def.fallback.map((p) => `ops-${role}-${p}-${def.level}`)
    }
    return cfg
  }

  // 向量1：基本解析
  const r1 = parseRoute('ROUTE: research-zipoo;executor-ds')
  t('向量1 parseRoute 基本两项 role/provider 正确', r1.items.length === 2 && r1.items[0].role === 'research' && r1.items[0].provider === 'zipoo' && r1.items[1].role === 'executor' && r1.items[1].provider === 'ds')
  // 向量2：逗号/空白分隔 + 前缀大小写不敏感
  const r2 = parseRoute('rOuTe: research-glm,executor-ds planner-699')
  t('向量2 逗号/空白分隔可用且 ROUTE 前缀大小写不敏感', r2.items.length === 3 && r2.items.every((x, i) => x.role === ['research', 'executor', 'planner'][i]))
  // 向量3：两空格缩进续行
  const r3 = parseRoute('ROUTE: research-glmflash;planner-699;\n  executor-ds;implreview-699')
  t('向量3 两空格缩进续行合并解析', r3.items.length === 4 && r3.items[2].role === 'executor' && r3.items[2].provider === 'ds')
  // 向量4：无前缀
  const r4 = (() => { try { parseRoute('research-glm'); return null } catch (e) { return e } })()
  t('向量4 无 ROUTE: 前缀→UsageError', r4?.name === 'UsageError')
  // 向量5：同角色重复取最后一次并记 note
  const r5 = parseRoute('ROUTE: executor-glm;implreview-699;executor-ds')
  t('向量5 同角色重复→取最后一次并写入 notes', r5.items.length === 2 && r5.items[0].role === 'executor' && r5.items[0].provider === 'ds' && r5.notes.length === 1 && r5.notes[0].includes('executor'))
  // 向量6：未知角色错误含合法角色列表
  const e6 = validateRoute(parseRoute('ROUTE: wizard-glm'), matrix).join('\n')
  t('向量6 未知角色→错误含合法角色列表', e6.includes('wizard') && ROLE_ORDER.every((r) => e6.includes(r)))
  // 向量7：角色不支持 provider 错误含可用 provider（装配岗批 D-1 起 699 为 vision 合法
  // 候选——断言载体改 vision-glm：glm 非多模态且不在 vision 候选，红绿两态语义等价）
  const e7 = validateRoute(parseRoute('ROUTE: vision-glm'), matrix).join('\n')
  t('向量7 角色不支持 provider→错误含该角色可用 provider', e7.includes('glm') && e7.includes('glmflash') && e7.includes('ds'))
  // 向量8：vision + 非多模态 provider
  const mNoVisionGlm = clone(matrix)
  mNoVisionGlm.roles.vision.providers = ['glm', 'glmflash']
  const e8 = validateRoute(parseRoute('ROUTE: vision-glm'), mNoVisionGlm).join('\n')
  t('向量8 vision+非多模态 glm→错误（多模态断言）', e8.includes('glm') && e8.includes('多模态'))
  // 向量8b（B2 批 D-7a）：startplan 文本应急例外在场正例（multimodal:false 仍在 vision
  // 候选亦零错误——谓词=multimodal===true 或 provider 恰为 startplan，四面同款）。
  const e8b = validateRoute(parseRoute('ROUTE: vision-startplan'), matrix)
  t('向量8b vision+startplan（文本应急例外）→零错误', e8b.length === 0)
  // 向量9：resolveRoute 五字段取值
  const cfg9 = compliantCfg()
  const rr = resolveRoute(parseRoute('ROUTE: executor-glm'), matrix, cfg9)[0]
  t('向量9 resolveRoute 含 slot/model/level/family/route_source 且取自注入配置', rr.slot === 'ops-executor-glm-high' && rr.model === 'model-of-glm' && rr.level === 'high' && rr.family === 'glm' && rr.route_source === 'prompt')
  // 向量10：slotRows 排序稳定 role→level→provider
  const cfg10 = {
    providers: { ds: { family: 'deepseek' }, glm: { family: 'glm' } },
    agent_slots: {
      'ops-planner-glm-max': { provider: 'glm', model: 'm', level: 'max' },
      'ops-executor-glm-high': { provider: 'glm', model: 'm', level: 'high' },
      'ops-research-glm-max': { provider: 'glm', model: 'm', level: 'max' },
      'ops-research-glm-high': { provider: 'glm', model: 'm', level: 'high' },
      'ops-research-ds-high': { provider: 'ds', model: 'm', level: 'high' },
    },
  }
  const order10 = slotRows(cfg10).map((r) => r.slot)
  t('向量10 slotRows 排序稳定（role→level→provider）', JSON.stringify(order10) === JSON.stringify(['ops-research-ds-high', 'ops-research-glm-high', 'ops-research-glm-max', 'ops-planner-glm-max', 'ops-executor-glm-high']))
  // 向量11（implreview-split D-4）：D6 两面——executor×一号同族 FAIL＋一号×二号同族恰一条 FAIL
  //（二号同族=推荐项执法面，validate 结构校验不拦；负例夹具二号同族时其余 D6 面均绿）。
  const cfg11 = compliantCfg()
  cfg11.agent_defaults.implreview1 = 'ops-implreview1-glm-max'
  const f11 = doctorFindings(matrix, cfg11)
  const cfg11b = compliantCfg()
  cfg11b.agent_defaults.implreview2 = 'ops-implreview2-yyx-max'
  const f11b = doctorFindings(matrix, cfg11b)
  t('向量11 doctor D6 实现×一号审核同族→FAIL；一号×二号同族→恰一条 FAIL（两席须不同模型族）',
    f11.some((f) => f.code === 'D6' && f.level === 'FAIL' && f.line.includes('一号审核族')) &&
    f11b.filter((f) => f.code === 'D6' && f.level === 'FAIL').length === 1 &&
    f11b.some((f) => f.code === 'D6' && f.level === 'FAIL' && f.line.includes('审核两席须不同模型族')))
  // 向量12：D5 vision 绑非多模态
  const cfg12 = compliantCfg()
  cfg12.providers.glmflash.multimodal = false
  const f12 = doctorFindings(matrix, cfg12)
  t('向量12 doctor D5 vision 绑非多模态→FAIL', f12.some((f) => f.code === 'D5' && f.level === 'FAIL' && f.line.includes('glmflash')))
  // 向量12b（返工 R1）：本机 provider 缺 multimodal 键但有 family → D5 仍拒（缺键≠通过，
  // fail-closed——原实现只查 ===false 的漏判面）。
  const cfg12b = compliantCfg()
  delete cfg12b.providers.ds.multimodal
  const f12b = doctorFindings(matrix, cfg12b)
  t('向量12b doctor D5 本机 provider 缺 multimodal 键（有 family）→FAIL（fail-closed）',
    f12b.some((f) => f.code === 'D5' && f.level === 'FAIL' && f.line.includes('ds') && f.line.includes('multimodal')))
  // 向量13：D4 缺绑定
  const cfg13 = compliantCfg()
  delete cfg13.agent_bindings['ops-executor-glm-high']
  const f13 = doctorFindings(matrix, cfg13)
  t('向量13 doctor D4 缺绑定→FAIL 且点名 slot', f13.some((f) => f.code === 'D4' && f.level === 'FAIL' && f.line.includes('ops-executor-glm-high')))
  // 向量14：全合规合成配置 → 零 finding
  const f14 = doctorFindings(matrix, compliantCfg())
  t('向量14 doctor 全合规合成配置→零 finding', f14.length === 0)
  // B4 面板批（D-4）向量：doctor D4 覆盖感知三态（无覆盖旧语义锁＋覆盖两态）
  const fB4a = doctorFindings(matrix, (() => { const c = compliantCfg(); c.agent_bindings['ops-executor-glm-high'] = 'provider-glm/model-of-glm$max'; return c })())
  t('向量14b D4 无覆盖不符=FAIL（旧文案·无覆盖字样）', fB4a.some((f) => f.code === 'D4' && f.level === 'FAIL' && f.line.includes('ops-executor-glm-high') && f.line.includes('≠ slot level=high') && !f.line.includes('thought_level_overrides')))
  const fB4b = doctorFindings(matrix, (() => { const c = compliantCfg(); c.thought_level_overrides = { executor: 'max' }; for (const k of Object.keys(c.agent_bindings)) if (k.startsWith('ops-executor-')) c.agent_bindings[k] = c.agent_bindings[k].replace(/\$high$/, '$max'); return c })())
  t('向量14c D4 覆盖且绑定=覆盖→零 D4 finding', !fB4b.some((f) => f.code === 'D4'))
  const fB4c = doctorFindings(matrix, (() => { const c = compliantCfg(); c.thought_level_overrides = { executor: 'max' }; return c })())
  t('向量14d D4 覆盖但绑定≠覆盖=FAIL 含覆盖文案', fB4c.some((f) => f.code === 'D4' && f.level === 'FAIL' && f.line.includes('ops-executor-') && f.line.includes('thought_level_overrides.executor=max 在案·以覆盖为准')))
  // 向量15：写侧六命令提示未实现并非零退出
  const scriptPath = fileURLToPath(import.meta.url)
  let writeOk = true
  for (const cmd of WRITE_COMMANDS) {
    const r = spawnSync(process.execPath, [scriptPath, cmd], { cwd: SKILL_ROOT, encoding: 'utf8' })
    const out = `${r.stdout || ''}${r.stderr || ''}`
    if (r.status === 0 || !out.includes('该命令属阶段 4（P14）范围，本版未实现')) {
      writeOk = false
      console.log(`FAIL 向量15 子项「${cmd}」status=${r.status} 输出缺未实现提示`)
    }
  }
  t('向量15 写侧六命令→打印未实现提示且非零退出（不写盘）', writeOk)
  // 向量16：空路由
  const r16 = (() => { try { parseRoute('ROUTE:'); return null } catch (e) { return e } })()
  t('向量16 空 ROUTE→UsageError', r16?.name === 'UsageError')
  // 向量17：坏续行缩进
  const r17 = (() => { try { parseRoute('ROUTE: research-glm\nplanner-699'); return null } catch (e) { return e } })()
  t('向量17 续行未两空格缩进→UsageError', r17?.name === 'UsageError')
  // 向量18：D2 缺失+孤儿
  const cfg18 = compliantCfg()
  delete cfg18.agent_slots['ops-executor-ds-high']
  cfg18.agent_slots['ops-executor-ghost-high'] = { provider: 'ghost', model: 'm', level: 'high' }
  const f18 = doctorFindings(matrix, cfg18)
  t('向量18 doctor D2 缺 slot+孤儿 slot→FAIL 双点名', f18.some((f) => f.code === 'D2' && f.line.includes('ops-executor-ds-high')) && f18.some((f) => f.code === 'D2' && f.line.includes('ops-executor-ghost-high')))
  // 向量19：D1 缺角色
  const m19 = clone(matrix)
  delete m19.roles.vision
  const f19 = doctorFindings(m19, compliantCfg())
  t('向量19 doctor D1 矩阵缺角色→FAIL 点名 vision', f19.some((f) => f.code === 'D1' && f.level === 'FAIL' && f.line.includes('vision')))
  // 向量20：D3 键值与键名不一致
  const cfg20 = compliantCfg()
  cfg20.agent_slots['ops-executor-glm-high'].provider = 'ds'
  const f20 = doctorFindings(matrix, cfg20)
  t('向量20 doctor D3 provider 与键名不一致→FAIL', f20.some((f) => f.code === 'D3' && f.level === 'FAIL' && f.line.includes('ops-executor-glm-high')))
  // 向量21：D7 族解析不到
  const cfg21 = compliantCfg()
  delete cfg21.providers.glm
  const f21 = doctorFindings(matrix, cfg21)
  t('向量21 doctor D7 provider 解析不到 family→WARN', f21.some((f) => f.code === 'D7' && f.level === 'WARN' && f.line.includes('glm')))
  // 向量22：D8 默认/回退缺角色
  const cfg22 = compliantCfg()
  delete cfg22.agent_defaults.vision
  const f22 = doctorFindings(matrix, cfg22)
  t('向量22 doctor D8 agent_defaults 缺角色→FAIL', f22.some((f) => f.code === 'D8' && f.level === 'FAIL' && f.line.includes('vision')))

  // ── 返工轮 1 新增向量（23–24）：W3 未识别 flag 拒收（真实进程退出码）──
  const runCli = (args) => spawnSync(process.execPath, [scriptPath, ...args], { cwd: SKILL_ROOT, encoding: 'utf8' })
  const s23 = runCli(['show', 'ops-executor-glm-high', '--bogus'])
  const out23 = `${s23.stdout || ''}${s23.stderr || ''}`
  t('向量23 show <有效 slot> --bogus → status=1 且输出 [用法错] 并点名',
    s23.status === 1 && out23.includes('[用法错]') && out23.includes('--bogus'))
  const s24 = runCli(['list', '--bogus'])
  const out24 = `${s24.stdout || ''}${s24.stderr || ''}`
  t('向量24 list --bogus → status=1 且输出 [用法错]（未识别 flag 不静默丢弃）',
    s24.status === 1 && out24.includes('[用法错]') && out24.includes('--bogus'))

  // ── 返工轮 2 新增向量（25–27）：W-new2 命令级 flag 子集 ──
  const s25 = runCli(['show', 'ops-executor-glm-high', '--role', 'research'])
  const out25 = `${s25.stdout || ''}${s25.stderr || ''}`
  t('向量25 show <有效slot> --role research → status=1 且 [用法错]（show 不接受 --role）',
    s25.status === 1 && out25.includes('[用法错]') && out25.includes('--role'))
  const s26 = runCli(['list', '--route', 'x'])
  const out26 = `${s26.stdout || ''}${s26.stderr || ''}`
  t('向量26 list --route x → status=1 且 [用法错]（list 不接受 --route）',
    s26.status === 1 && out26.includes('[用法错]') && out26.includes('--route'))
  const s27 = runCli(['doctor', '--role', 'research'])
  const out27 = `${s27.stdout || ''}${s27.stderr || ''}`
  t('向量27 doctor --role research → status=1 且 [用法错]（doctor 不接受 --role）',
    s27.status === 1 && out27.includes('[用法错]') && out27.includes('--role'))

  // ── L4 新增向量（28–44）：旧名解析随当前默认档位、未登记/假绿防线、doctor D9 ──
  // （2026-10-27 临时窗机制退役：旧「窗口感知」向量改为 agent_defaults 直读语义）
  const aliasMatrix = loadMatrix(MATRIX_PATH)
  const aliasCfg = () => {
    const c = compliantCfg()
    // 模拟现役默认档位已切 ds（原窗覆盖的等价形态：直改 agent_defaults＝顺序首元素）
    c.agent_defaults.executor = 'ops-executor-ds-high'
    return c
  }
  const aliasCfgLive = aliasCfg()
  const a28 = resolveAlias('ops-executor', aliasMatrix, aliasCfgLive)
  t('向量28 ops-executor → 随 agent_defaults 当前默认档位 ops-executor-ds-high 且字段同构',
    a28?.alias === 'ops-executor' && a28?.role === 'executor' && a28?.slot === 'ops-executor-ds-high' && a28?.provider === 'ds' && a28?.model === 'model-of-ds' && a28?.level === 'high' && a28?.family === 'deepseek' && a28?.route_source === 'alias')
  const a29 = resolveAlias('ops-drafter', aliasMatrix, aliasCfgLive)
  t('向量29 ops-drafter → ops-planner-699-max', a29?.slot === 'ops-planner-699-max' && a29?.role === 'planner')
  const a30 = resolveAlias('ops-auditor', aliasMatrix, aliasCfgLive)
  t('向量30 ops-auditor → ops-implreview2-ds-max（D-7：旧代码审查名迁二号 ds 承载）', a30?.slot === 'ops-implreview2-ds-max' && a30?.role === 'implreview2' && a30?.provider === 'ds')
  const a31 = resolveAlias('ops-adjudicator', aliasMatrix, aliasCfgLive)
  const exp31 = `ops-adjudicator-${aliasMatrix.roles.adjudicator.default}-${aliasMatrix.roles.adjudicator.level}`
  t('向量31 ops-adjudicator → 矩阵 default 派生槽名', a31?.slot === exp31 && a31?.role === 'adjudicator')
  const exp41 = `ops-executor-${aliasMatrix.roles.executor.default}-${aliasMatrix.roles.executor.level}`
  const a32 = resolveAlias('ops-probe', aliasMatrix, aliasCfgLive)
  t('向量32 退役别名 ops-probe → null（B2 批 D-3/D-5：诊断整链退役，登记表已除名不静默回落）', a32 === null)
  const a33 = resolveAlias('ops-diagnostics', aliasMatrix, aliasCfgLive)
  t('向量33 退役别名 ops-diagnostics → null（同上——两退役别名解析为 null）', a33 === null)
  const a34 = resolveAlias('ops-executor', aliasMatrix, (() => { const c = aliasCfg(); c.agent_defaults.executor = 'ops-executor-glm-high'; return c })())
  t('向量34 默认档位切回 ops-executor-glm-high 后旧名解析随动（单源直读，无第二视图）', a34?.slot === 'ops-executor-glm-high' && a34?.provider === 'glm')
  const a35 = resolveAlias('ops-gate1-k1', aliasMatrix, aliasCfgLive)
  t('向量35 ops-gate1-k1 → ops-implreview1-699-max（D-7：gate 审核域迁一号·固定 699 不变）', a35?.slot === 'ops-implreview1-699-max')
  const a36 = resolveAlias('ops-gate1-k2', aliasMatrix, aliasCfgLive)
  t('向量36 ops-gate1-k2 → ops-implreview1-zipoo-max', a36?.slot === 'ops-implreview1-zipoo-max')
  const a37 = resolveAlias('ops-gate1-k3', aliasMatrix, aliasCfgLive)
  t('向量37 ops-gate1-k3 → ops-implreview1-yyx-max', a37?.slot === 'ops-implreview1-yyx-max')
  const a38 = resolveAlias('ops-gate1-d1', aliasMatrix, aliasCfgLive)
  t('向量38 ops-gate1-d1 → ops-implreview1-ds-max（gate 域 ds 固定位随一号·与 auditor→二号分记）', a38?.slot === 'ops-implreview1-ds-max')
  const a39 = resolveAlias('ops-nosuch', aliasMatrix, aliasCfgLive)
  t('向量39 未登记旧名 ops-nosuch → null（不静默回落）', a39 === null)
  const cfg40 = aliasCfg()
  delete cfg40.agent_slots['ops-executor-ds-high']
  const a40 = resolveAlias('ops-executor', aliasMatrix, cfg40)
  t('向量40 解析到的 slot 不在 agent_slots → null（防假绿）', a40 === null)
  const cfg41 = aliasCfg()
  cfg41.agent_defaults.executor = 'ops-executor'
  const d41 = doctorFindings(aliasMatrix, cfg41).filter((f) => f.code === 'D9')
  t('向量41 doctor 旧名污染：agent_defaults 为旧名→建议矩阵默认派生档（期望值随矩阵派生）',
    d41.length === 1 && d41[0].level === 'WARN' && d41[0].line.includes(exp41))
  const cfg41b = aliasCfg()
  cfg41b.role_fallbacks.executor = ['ops-executor', 'ops-executor-glm-high']
  const d41b = doctorFindings(aliasMatrix, cfg41b).filter((f) => f.code === 'D9')
  t('向量41b D9 建议＝当前默认档位（agent_defaults 直读——默认档位非旧名时不落矩阵兜底）',
    d41b.length === 1 && d41b[0].level === 'WARN' && d41b[0].line.includes('ops-executor-ds-high') && !d41b[0].line.includes(exp41))
  const expectAliases = ['ops-executor', 'ops-drafter', 'ops-auditor', 'ops-adjudicator', 'ops-gate1-k1', 'ops-gate1-k2', 'ops-gate1-k3', 'ops-gate1-d1']
  const actualAliases = Object.keys(aliasMatrix.aliases || {})
  t('向量42 真实矩阵 aliases 键集恰为 8 个旧名（逐字比对——ops-probe/ops-diagnostics 两退役别名已除名）',
    JSON.stringify(actualAliases) === JSON.stringify(expectAliases))
  const noAliasMatrix = clone(aliasMatrix)
  delete noAliasMatrix.aliases
  const a43 = resolveAlias('ops-executor', noAliasMatrix, aliasCfg())
  const d9a = doctorFindings(noAliasMatrix, aliasCfg()).filter((f) => f.code === 'D9a')
  t('向量43 矩阵缺 aliases → resolveAlias null 且 doctor 1 条 FAIL（D9a）',
    a43 === null && d9a.length === 1 && d9a[0].level === 'FAIL' && d9a[0].line.includes('aliases'))
  // 向量44：兜底分支——候选解析档与当前默认档位均为旧名时走矩阵默认派生档，
  // 且建议值须真实存在（N2）。
  const d9fallback = (mutate) => {
    const c = aliasCfg()
    c.role_fallbacks.wizard = ['ops-executor'] // wizard 非真实角色 → live 取 executor 当前默认档位
    if (mutate) mutate(c)
    return doctorFindings(aliasMatrix, c).filter((f) => f.code === 'D9' && f.line.includes('role_fallbacks.wizard'))
  }
  const d44live = d9fallback()
  const d44else = d9fallback((c) => { c.agent_defaults.executor = 'ops-executor' })
  const d44miss = d9fallback((c) => { c.agent_defaults.executor = 'ops-executor'; delete c.agent_slots[exp41] })
  t('向量44 D9 兜底分支：当前默认档位可读→建议=当前默认档位；默认档位为旧名→矩阵默认派生档且存在于 agent_slots；派生档不存在→不拼默认、落通用措辞',
    d44live.length === 1 && d44live[0].line.includes('ops-executor-ds-high') && own(aliasCfg().agent_slots, 'ops-executor-ds-high') &&
    d44else.length === 1 && d44else[0].line.includes(exp41) &&
    d44miss.length === 1 && !d44miss[0].line.includes(exp41) && d44miss[0].line.includes('对应角色的生效默认档位'))

  // 向量45/46（L26·账本 L636 ③；46 反转=B2 批 D-5/D-8）：resolve 现状特征固化。
  const e45 = validateRoute(parseRoute('ROUTE: reviewer2-ds'), matrix).join('\n')
  t('向量45 resolve 拒绝语义：ROUTE: reviewer2-ds → 错误含未知角色 reviewer2 与合法角色列表（现状固化，不新增解析支持）',
    e45.includes('未知角色「reviewer2」') && ROLE_ORDER.every((r) => e45.includes(r)))
  const e46 = validateRoute(parseRoute('ROUTE: diagnostics-ds'), matrix).join('\n')
  const s46 = resolveRoute(parseRoute('ROUTE: diagnostics-ds'), matrix, { providers: {}, agent_slots: {} })
  t('向量46 退役角色拒绝语义：ROUTE: diagnostics-ds → validateRoute 报未知角色且解析结果无有效注册槽（B2 批诊断整链退役反转——原正向解析向量作废）',
    e46.includes('未知角色「diagnostics」') && s46.length === 1 && s46[0].slot === '?')

  // ── R0 新增向量（53–60）：dispatch-check 三方对账＋snapshots 六比较/派生＋新 CLI 退出族 ──
  // 夹具全部落在 mkdtemp('R0-a-st-') 一层临时目录，finally 清理（一次性台架；staging
  // 副本由本进程直接 spawnSync 运行、不注入哨兵、不嵌套自拷贝——§1 资源纪律注记）。
  const r0tmp = mkdtempSync(join(tmpdir(), 'R0-a-st-'))
  try {
    const mergedCfgR0 = loadOrgConfig(SKILL_ROOT).merged
    const defaultsNow = isPlainObject(mergedCfgR0.agent_defaults) ? mergedCfgR0.agent_defaults : {}
    const providerOf = (slot) => parseSlotKey(slot)?.provider || '?'
    const R0_ENABLED = ['assembler', 'executor', 'tbreview', 'implreview1', 'implreview2', 'adjudicator', 'vision']
    const routeNow = `ROUTE: ${R0_ENABLED.map((r) => `${r}-${providerOf(defaultsNow[r])}`).join(';')}`
    const secondSlot = defaultsNow.implreview2 // = merged role_fallbacks.implreview2[0]（D-3 三方相等）
    const planText = (routeLine, opts = {}) => {
      const enOf = (r) => (opts.en && opts.en[r] !== undefined ? opts.en[r] : R0_ENABLED.includes(r) ? '是' : '否')
      const slotOf = (r) => (opts.slot && opts.slot[r] !== undefined ? opts.slot[r] : r === 'implreview2' && opts.second !== undefined ? opts.second : defaultsNow[r])
      const rowOf = (r) => `| ${r} | ${slotOf(r)} | ${r === 'implreview2' ? 'S1 series_process.reviewer_second（常设第二审）' : '本机件 agent_defaults（S4）'} | ${enOf(r)} | 理由-${r} |`
      const body = [
        '| 岗位 | 实际 slot | route_source | 启用 | 理由 |',
        '|---|---|---|---|---|',
        rowOf('research'),
        rowOf('planner'),
        rowOf('assembler'),
        rowOf('executor'),
        rowOf('tbreview'),
        rowOf('planreview'),
        rowOf('implreview1'),
        rowOf('implreview2'),
        rowOf('adjudicator'),
        rowOf('vision'),
      ]
      return ['# 合成 dispatch-plan（self-test 夹具）', '', '## 1. 十岗实选表', '', ...body, '', '## 2. 批 ROUTE', '', '```', routeLine, '```', ''].join('\n')
    }
    const fallbacksNow = isPlainObject(mergedCfgR0.role_fallbacks) ? mergedCfgR0.role_fallbacks : {}
    const cfgR0 = { providers: {}, agent_slots: {}, agent_defaults: { ...defaultsNow }, role_fallbacks: JSON.parse(JSON.stringify(fallbacksNow)) }
    for (const r of ROLE_ORDER) { // d-N10：S4 补全 slot 须在 cfg.agent_slots 注册——夹具同步登记
      const p = parseSlotKey(defaultsNow[r])
      cfgR0.agent_slots[defaultsNow[r]] = { provider: p.provider, model: `model-of-${p.provider}`, level: p.level }
    }
    const s1R0 = { series_process: { reviewer_second: secondSlot } }

    // 向量53（implreview-split D-3/D-5）：十岗正例＋implreview2 派生三方相等＋未启用默认补全
    //（纯函数＋CLI 双形态）；负例一（D-3 具名向量）：保持 S1 不变、单改 S4 role_fallbacks.implreview2[0]
    // → dispatch-check FAIL 且 diff 点名 reviewer_second 与 role_fallbacks.implreview2[0]。
    const planObj53 = parseDispatchPlan(planText(routeNow))
    const dc53 = dispatchCheck({ plan: planObj53, routeText: routeNow, matrix, cfg: cfgR0, s1: s1R0 })
    const proj53 = join(r0tmp, 'proj53')
    mkdirSync(join(proj53, 'docs'), { recursive: true })
    writeFileSync(join(proj53, 'docs', 'agent-matrix.json'), JSON.stringify({ roles: {}, series_process: { reviewer_second: secondSlot } }))
    const planPath53 = join(r0tmp, 'plan53.md')
    writeFileSync(planPath53, planText(routeNow))
    const s53a = runCli(['dispatch-check', '--plan', planPath53, '--route', routeNow, '--project', proj53])
    const s53b = spawnSync(process.execPath, [scriptPath, 'dispatch-check', '--plan', planPath53, '--route', routeNow], { cwd: proj53, encoding: 'utf8' })
    const sum53 = `dispatch_check=PASS roles=10 enabled=7 route_items=7 second_reviewer=${secondSlot}`
    const cfg53fb = JSON.parse(JSON.stringify(cfgR0))
    cfg53fb.role_fallbacks.implreview2 = [cfg53fb.agent_defaults.implreview2 === secondSlot ? 'ops-implreview2-699-max' : secondSlot, ...cfg53fb.role_fallbacks.implreview2.slice(1)]
    const dc53fb = dispatchCheck({ plan: planObj53, routeText: routeNow, matrix, cfg: cfg53fb, s1: s1R0 })
    const d53fb = dc53fb.diffs.join('\n')
    t('向量53 dispatch-check 正例：十岗全过＋implreview2 派生三方相等＋未启用默认补全（--project 显式与缺省发现均 exit 0）＋S4 二号 fallback 首元单改→FAIL 点名派生字段',
      dc53.ok === true && dc53.roles === 10 && dc53.enabled === 7 && dc53.route_items === 7 && dc53.second_reviewer === secondSlot &&
      dc53.second_default === secondSlot && dc53.second_fallback_head === secondSlot &&
      dc53.rows.find((r) => r.role === 'planner').route_source === 'defaults' && dc53.rows.find((r) => r.role === 'planner').resolved_slot === defaultsNow.planner &&
      dc53.rows.find((r) => r.role === 'executor').route_source === 'prompt' && dc53.rows.find((r) => r.role === 'executor').resolved_slot === defaultsNow.executor &&
      dc53.rows.find((r) => r.role === 'implreview2').route_source === 'prompt' && dc53.rows.find((r) => r.role === 'implreview2').resolved_slot === defaultsNow.implreview2 &&
      s53a.status === 0 && `${s53a.stdout || ''}${s53a.stderr || ''}`.includes(sum53) &&
      s53b.status === 0 && `${s53b.stdout || ''}${s53b.stderr || ''}`.includes(sum53) &&
      dc53fb.ok === false && d53fb.includes('reviewer_second') && d53fb.includes('role_fallbacks.implreview2[0]'))

    // 向量54：B8 r7 陈旧 ROUTE→对账 FAIL＋逐岗 diff（executor/implreview/adjudicator 陈旧＋启用岗未列）
    // ＋z-W03/d-N11：--route 前导/尾随空白负例各 exit 1（去 trim·逐字比对·CLI 实跑）
    const STALE = 'ROUTE: executor-startplan;implreview1-699;adjudicator-zipoo'
    const dc54 = dispatchCheck({ plan: planObj53, routeText: STALE, matrix, cfg: cfgR0, s1: s1R0 })
    const d54 = dc54.diffs.join('\n')
    const s54 = runCli(['dispatch-check', '--plan', planPath53, '--route', STALE, '--project', proj53])
    const out54 = `${s54.stdout || ''}${s54.stderr || ''}`
    const s54w1 = runCli(['dispatch-check', '--plan', planPath53, '--route', ` ${routeNow}`, '--project', proj53])
    const out54w1 = `${s54w1.stdout || ''}${s54w1.stderr || ''}`
    const s54w2 = runCli(['dispatch-check', '--plan', planPath53, '--route', `${routeNow} `, '--project', proj53])
    const out54w2 = `${s54w2.stdout || ''}${s54w2.stderr || ''}`
    const cfg54def = JSON.parse(JSON.stringify(cfgR0))
    cfg54def.agent_defaults.implreview2 = 'ops-implreview2-699-max' // 保持 S1 不变、单改 S4 二号默认
    const dc54def = dispatchCheck({ plan: planObj53, routeText: routeNow, matrix, cfg: cfg54def, s1: s1R0 })
    const d54def = dc54def.diffs.join('\n')
    t('向量54 B8 r7 陈旧 ROUTE→exit 1＋逐岗 diff＋前导/尾随空白 --route 负例各 exit 1（逐字比对）＋S4 二号默认单改→FAIL 点名 agent_defaults.implreview2',
      dc54.ok === false && d54.includes('executor') && d54.includes('startplan') && d54.includes('implreview1') && d54.includes('699') &&
      d54.includes('adjudicator') && d54.includes('zipoo') && d54.includes('未列入 ROUTE') &&
      dc54def.ok === false && d54def.includes('reviewer_second') && d54def.includes('agent_defaults.implreview2') &&
      s54.status === 1 && out54.includes('dispatch_check=FAIL') && out54.includes('陈旧') && out54.includes('未列入 ROUTE') && out54.includes('plan §2') &&
      s54w1.status === 1 && out54w1.includes('逐字一致') && out54w1.includes('dispatch_check=FAIL') &&
      s54w2.status === 1 && out54w2.includes('逐字一致') && out54w2.includes('dispatch_check=FAIL'))

    // staging 技能根副本（一层·外部探针直接运行）：可控 S2/S3/S4 注入面（55/56/57/59 共用）
    const stage = join(r0tmp, 'stage')
    mkdirSync(join(stage, 'scripts'), { recursive: true })
    mkdirSync(join(stage, 'templates'), { recursive: true })
    cpSync(join(SKILL_ROOT, 'scripts'), join(stage, 'scripts'), { recursive: true })
    copyFileSync(join(SKILL_ROOT, 'templates', 'agents.matrix.json'), join(stage, 'templates', 'agents.matrix.json'))
    copyFileSync(join(SKILL_ROOT, 'org-config.default.json'), join(stage, 'org-config.default.json'))
    copyFileSync(join(SKILL_ROOT, 'org-config.local.json'), join(stage, 'org-config.local.json'))
    const stageScript = join(stage, 'scripts', 'agent-slots.mjs')
    const runStage = (args) => spawnSync(process.execPath, [stageScript, ...args], { encoding: 'utf8' })
    const s1Synth = { roles: Object.fromEntries(ROLE_ORDER.map((r) => [r, { default: matrix.roles[r].default, fallback: [...matrix.roles[r].fallback] }])) }
    const mkProj = (name, s1obj) => {
      const p = join(r0tmp, name)
      mkdirSync(join(p, 'docs'), { recursive: true })
      writeFileSync(join(p, 'docs', 'agent-matrix.json'), JSON.stringify(s1obj))
      return p
    }
    const hashOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

    // 向量55：缺/畸形 plan→装载错；缺件 exit 3；启用集两方向（ROUTE 列禁用岗/启用岗未列）
    // ＋z-W04：CLI 子进程三态实跑；＋d-N10：本机件缺席 exit 3＋补全 slot 未注册报错
    const malformed55 = [
      ['缺§1§2合一', '# 只有前言\n\n无编号段落的合成件\n'],
      ['坏表·列缺失', '# x\n## 1. 十岗实选表\n\n| 岗位 | 实际 slot |\n|---|---|\n| planner | ops-planner-zipoo-max |\n\n## 2. 批 ROUTE\n\n```\nROUTE: executor-glm\n```\n'],
      ['坏表·启用列值', planText(routeNow).replace('| 否 | 理由-planner |', '| 也许 | 理由-planner |')],
      ['implreview2 缺行', planText(routeNow).replace(/^\| implreview2 \|[^\n]*\n/m, '')],
      ['implreview1 重复行', planText(routeNow).replace(/^(\| implreview1 \|[^\n]*\n)/m, '$1$1')],
      ['旧限定词', planText(routeNow).replace(/^\| implreview1 \|/m, '| implreview1（第一席） |')],
      ['旧合并 role 行', planText(routeNow).replace(/^\| implreview1 \|/m, '| implreview |')],
    ]
    let malformedOk = true
    for (const [name, text] of malformed55) {
      const r = (() => { try { parseDispatchPlan(text); return null } catch (e) { return e } })()
      if (!r) { malformedOk = false; console.log(`FAIL 向量55 子项「${name}」未拒收`) }
    }
    const routeWithDisabled = `ROUTE: research-${providerOf(defaultsNow.research)};${routeNow.replace('ROUTE: ', '')}`
    const routeNoVision = `ROUTE: ${R0_ENABLED.filter((r) => r !== 'vision').map((r) => `${r}-${providerOf(defaultsNow[r])}`).join(';')}`
    const dc55a = dispatchCheck({ plan: parseDispatchPlan(planText(routeWithDisabled)), routeText: routeWithDisabled, matrix, cfg: cfgR0, s1: s1R0 })
    const dc55b = dispatchCheck({ plan: planObj53, routeText: routeNoVision, matrix, cfg: cfgR0, s1: s1R0 })
    const planPath55bad = join(r0tmp, 'plan55-bad.md')
    writeFileSync(planPath55bad, malformed55[1][1])
    const planPath55dis = join(r0tmp, 'plan55-dis.md')
    writeFileSync(planPath55dis, planText(routeWithDisabled))
    const planPath55unl = join(r0tmp, 'plan55-unl.md')
    writeFileSync(planPath55unl, planText(routeNoVision))
    const s55 = runCli(['dispatch-check', '--plan', join(r0tmp, 'R0-a-missing.md'), '--route', routeNow, '--project', proj53])
    const s55m = runCli(['dispatch-check', '--plan', planPath55bad, '--route', 'ROUTE: executor-glm', '--project', proj53])
    const out55m = `${s55m.stdout || ''}${s55m.stderr || ''}`
    const s55d = runCli(['dispatch-check', '--plan', planPath55dis, '--route', routeWithDisabled, '--project', proj53])
    const out55d = `${s55d.stdout || ''}${s55d.stderr || ''}`
    const s55u = runCli(['dispatch-check', '--plan', planPath55unl, '--route', routeNoVision, '--project', proj53])
    const out55u = `${s55u.stdout || ''}${s55u.stderr || ''}`
    const stageNL = join(r0tmp, 'stageNL')
    cpSync(stage, stageNL, { recursive: true })
    rmSync(join(stageNL, 'org-config.local.json')) // d-N10：S4 本机件缺席＝禁出厂默认静默代位
    const s55nl = spawnSync(process.execPath, [join(stageNL, 'scripts', 'agent-slots.mjs'), 'dispatch-check', '--plan', planPath53, '--route', routeNow, '--project', proj53], { encoding: 'utf8' })
    const out55nl = `${s55nl.stdout || ''}${s55nl.stderr || ''}`
    // D-5 第五负例：S1 第二审漂移（plan implreview2 行 slot≠S1 reviewer_second）→ FAIL 点名
    const plan55s1 = parseDispatchPlan(planText(routeNow, { second: 'ops-implreview2-699-max' }))
    const dc55s1 = dispatchCheck({ plan: plan55s1, routeText: routeNow, matrix, cfg: cfgR0, s1: s1R0 })
    const d55s1 = dc55s1.diffs.join('\n')
    // 返工轮 1 修入②：V-3/V-4 负例 CLI 级实跑（staging 技能根真进程）——S4 单改
    // role_fallbacks.implreview2[0]／agent_defaults.implreview2／S1 reviewer_second 漂移三类
    // 各 exit 1＋具名诊断；还原后复跑 exit 0（并入本向量，总数保持 78）。
    const localStage55 = JSON.parse(readFileSync(join(stage, 'org-config.local.json'), 'utf8'))
    const writeStage55 = (c) => writeFileSync(join(stage, 'org-config.local.json'), JSON.stringify(c))
    const runDcStage55 = (projDir) => runStage(['dispatch-check', '--plan', planPath53, '--route', routeNow, '--project', projDir])
    const outOf55 = (r) => `${r.stdout || ''}${r.stderr || ''}`
    const c55n1 = JSON.parse(JSON.stringify(localStage55))
    c55n1.role_fallbacks.implreview2 = ['ops-implreview2-699-max', ...c55n1.role_fallbacks.implreview2.slice(1)]
    writeStage55(c55n1)
    const s55n1 = runDcStage55(proj53)
    const o55n1 = outOf55(s55n1)
    const c55n2 = JSON.parse(JSON.stringify(localStage55))
    c55n2.agent_defaults.implreview2 = 'ops-implreview2-699-max'
    writeStage55(c55n2)
    const s55n2 = runDcStage55(proj53)
    const o55n2 = outOf55(s55n2)
    writeStage55(localStage55) // 还原（后续向量共用 stage）
    const proj55s1 = mkProj('proj55s1', { roles: {}, series_process: { reviewer_second: 'ops-implreview2-699-max' } })
    const s55n3 = runDcStage55(proj55s1)
    const o55n3 = outOf55(s55n3)
    const s55ok = runDcStage55(proj53)
    const o55ok = outOf55(s55ok)
    const cfgUnreg = clone(cfgR0)
    delete cfgUnreg.agent_slots[defaultsNow.planner]
    const e55reg = (() => { try { dispatchCheck({ plan: planObj53, routeText: routeNow, matrix, cfg: cfgUnreg, s1: s1R0 }); return null } catch (e) { return e } })()
    t('向量55 缺/畸形 plan（缺行/重复/旧限定词/旧 role）→装载错拒收＋S1 第二审漂移→FAIL 点名＋S4 单改值/S1 漂移三类 CLI 级实跑（各 exit 1 具名·还原复跑 exit 0）＋CLI 三态实跑（畸形 exit 3/禁用岗 exit 1/启用岗未列 exit 1）＋缺件 exit 3＋S4 本机件缺席 exit 3＋补全 slot 未注册报错',
      malformedOk &&
      dc55a.ok === false && dc55a.diffs.join('\n').includes('禁用岗') &&
      dc55b.ok === false && dc55b.diffs.join('\n').includes('未列入 ROUTE') && dc55b.diffs.join('\n').includes('vision') &&
      s55.status === 3 && `${s55.stdout || ''}${s55.stderr || ''}`.includes('[装载错]') &&
      s55m.status === 3 && out55m.includes('[装载错]') && out55m.includes('表列缺失') &&
      s55d.status === 1 && out55d.includes('禁用岗') && out55d.includes('dispatch_check=FAIL') &&
      s55u.status === 1 && out55u.includes('未列入 ROUTE') && out55u.includes('dispatch_check=FAIL') &&
      s55nl.status === 3 && out55nl.includes('[装载错]') && out55nl.includes('S4 本机件') && out55nl.includes('静默代位') &&
      e55reg !== null && e55reg.message.includes('未在 cfg.agent_slots 注册') && e55reg.message.includes('planner') &&
      dc55s1.ok === false && d55s1.includes('implreview2: plan=') && d55s1.includes('S1 series_process.reviewer_second') &&
      s55n1.status === 1 && o55n1.includes('dispatch_check=FAIL') && o55n1.includes('role_fallbacks.implreview2[0]') && o55n1.includes('reviewer_second') &&
      s55n2.status === 1 && o55n2.includes('dispatch_check=FAIL') && o55n2.includes('agent_defaults.implreview2=ops-implreview2-699-max') &&
      s55n3.status === 1 && o55n3.includes('dispatch_check=FAIL') && o55n3.includes('implreview2: plan=') && o55n3.includes('S1 series_process.reviewer_second=ops-implreview2-699-max') &&
      s55ok.status === 0 && o55ok.includes('dispatch_check=PASS roles=10'))

    // 向量56：S4 滞后＝WARN 不阻断（exit 0）＋岗位去重计数＋ISO inspected_at（纯函数＋staging CLI）
    const lagCfg = { s3: { agent_defaults: {}, role_fallbacks: {} }, s4: { agent_defaults: {}, role_fallbacks: {} } }
    for (const r of ROLE_ORDER) {
      lagCfg.s3.agent_defaults[r] = `ops-${r}-${matrix.roles[r].default}-${matrix.roles[r].level}`
      lagCfg.s3.role_fallbacks[r] = matrix.roles[r].fallback.map((p) => `ops-${r}-${p}-${matrix.roles[r].level}`)
      lagCfg.s4.agent_defaults[r] = lagCfg.s3.agent_defaults[r]
      lagCfg.s4.role_fallbacks[r] = [...lagCfg.s3.role_fallbacks[r]]
    }
    lagCfg.s4.agent_defaults.research = `ops-research-glm-${matrix.roles.research.level}`
    lagCfg.s4.role_fallbacks.research = [...lagCfg.s4.role_fallbacks.research].reverse()
    lagCfg.s4.agent_defaults.planner = `ops-planner-yyx-${matrix.roles.planner.level}`
    lagCfg.s4.role_fallbacks.planner = [...lagCfg.s4.role_fallbacks.planner].reverse()
    const rep56 = snapshotReport({ s1: s1Synth, s2: matrix, s3: lagCfg.s3, s4: lagCfg.s4 })
    const stageLocal = JSON.parse(readFileSync(join(stage, 'org-config.local.json'), 'utf8'))
    stageLocal.agent_defaults.research = `ops-research-glm-${matrix.roles.research.level}`
    writeFileSync(join(stage, 'org-config.local.json'), JSON.stringify(stageLocal))
    const s56 = runStage(['snapshots', '--project', mkProj('proj56', s1Synth)])
    const out56 = `${s56.stdout || ''}${s56.stderr || ''}`
    t('向量56 快照 S4 滞后＝WARN 不阻断（exit 0）＋岗位去重计数＋ISO inspected_at',
      rep56.factory_fail === 0 && rep56.warn_roles === 2 && rep56.warn_field_diffs === 4 && rep56.derived_fail === 0 &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(rep56.inspected_at) &&
      rep56.warns.map((w) => w.role).join(',') === 'research,planner' &&
      s56.status === 0 && out56.includes('[WARN] research') && out56.includes('inspected_at=') && out56.includes('warn_field_diffs='))

    // 向量57：出厂互恰 tmp 反例→FAIL exit 1（S1×S2 逐字段点名）
    const s1Factory = clone(s1Synth)
    s1Factory.roles.planner.default = 'yyx'
    const s57 = runStage(['snapshots', '--project', mkProj('proj57', s1Factory)])
    const out57 = `${s57.stdout || ''}${s57.stderr || ''}`
    t('向量57 出厂互恰 tmp 反例→exit 1（出厂互恰破坏·S1×S2·planner 点名）',
      s57.status === 1 && out57.includes('[FAIL]') && out57.includes('出厂互恰') && out57.includes('S1×S2') && out57.includes('planner'))

    // 向量58：S2→S1 派生正例逐字节（十岗·规范化投影 Buffer 全等）
    // ＋d-N12：投影/派生恰十岗——矩阵含第十一岗（wizard）时额外 role 不入 projection，
    // roles=10 且投影文本/bytes 口径与十岗基准完全一致（纯函数＋CLI tmp 反例双面）
    const der58 = deriveS2ToS1(s1Synth, matrix)
    const b58 = Buffer.from(der58.s2_text)
    const mTen = clone(matrix)
    mTen.roles.wizard = { ...clone(matrix.roles.planner), default: 'zipoo', fallback: ['zipoo'] }
    const projTen = matrixProjection(mTen)
    const derTen = deriveS2ToS1(mTen, mTen)
    const s1Ten = clone(s1Synth)
    s1Ten.roles.wizard = { default: 'zipoo', fallback: ['zipoo'] }
    const s58 = runCli(['snapshots', '--json', '--project', mkProj('proj58', s1Ten)])
    let j58 = null
    try { j58 = JSON.parse(s58.stdout || '') } catch { j58 = null }
    t('向量58 S2→S1 派生正例：逐字节一致＋恰十岗＋矩阵含第十一岗投影仍十岗（roles/bytes 口径固定）',
      der58.equal === true && der58.roles === 10 && Buffer.compare(Buffer.from(der58.s1_text), b58) === 0 &&
      b58.length > 0 && der58.s2_text.endsWith('}\n') && Object.keys(JSON.parse(der58.s2_text).roles).length === 10 &&
      Object.keys(projTen).length === 10 && !('wizard' in projTen) && Object.keys(projTen).join(',') === ROLE_ORDER.join(',') &&
      derTen.roles === 10 && derTen.equal === true && derTen.s2_text === der58.s2_text && derTen.bytes === der58.bytes &&
      s58.status === 0 && j58 !== null && j58.derived.roles === 10 && j58.derived.bytes === der58.bytes &&
      !JSON.stringify(j58.warns || []).includes('wizard'))

    // 向量59：派生反例→FAIL exit 1＋四源零写（运行前后哈希不变）
    const s1Mut = clone(s1Synth)
    s1Mut.roles.planner.fallback = [...s1Mut.roles.planner.fallback].reverse()
    const proj59 = mkProj('proj59', s1Mut)
    const files59 = [join(stage, 'templates', 'agents.matrix.json'), join(stage, 'org-config.default.json'), join(stage, 'org-config.local.json'), join(proj59, 'docs', 'agent-matrix.json')]
    const before59 = files59.map(hashOf)
    const s59 = runStage(['snapshots', '--project', proj59])
    const after59 = files59.map(hashOf)
    const out59 = `${s59.stdout || ''}${s59.stderr || ''}`
    t('向量59 派生反例→exit 1＋四源零写（fallback 保序破环＝派生漂移·运行前后哈希不变）',
      s59.status === 1 && out59.includes('派生') && out59.includes('derived_fail=1') && JSON.stringify(before59) === JSON.stringify(after59))

    // 向量60：新 CLI 用法/退出族——未知/等号/缺值/额外参数=1；缺件/缺 project=3
    const cases60 = [
      [['dispatch-check', '--bogus'], 1, '[用法错]'],
      [['dispatch-check', `--plan=${planPath53}`, '--route', routeNow], 1, '等号形态'],
      [['dispatch-check', '--route', routeNow], 1, '--plan'],
      [['dispatch-check', '--plan'], 1, '居末位'],
      [['dispatch-check', '--plan', planPath53, '--route', routeNow, 'R0-a-extra'], 1, '额外参数'],
      [['dispatch-check', '--json', '--plan', planPath53, '--route', routeNow], 1, '未识别的 flag'],
      [['dispatch-check', '--plan', join(r0tmp, 'R0-a-missing.md'), '--route', routeNow, '--project', proj53], 3, '[装载错]'],
      [['snapshots', '--bogus'], 1, '[用法错]'],
      [['snapshots', 'R0-a-pos'], 1, '额外参数'],
      [['snapshots', '--plan', 'x'], 1, '未识别的 flag'],
      [['snapshots', '--project', join(r0tmp, 'R0-a-nodir')], 3, '[装载错]'],
      [['snapshots', '--project'], 1, '居末位'],
    ]
    let ok60 = true
    for (const [args, want, marker] of cases60) {
      const r = runCli(args)
      const out = `${r.stdout || ''}${r.stderr || ''}`
      if (r.status !== want || !out.includes(marker)) {
        ok60 = false
        console.log(`FAIL 向量60 子项 ${JSON.stringify(args)} status=${r.status}(期望 ${want}) marker=${marker}`)
      }
    }
    t('向量60 新 CLI 用法/退出族：未知/等号/缺值/额外参数=用法错，缺件/缺 project=装载错', ok60)
  } finally {
    rmSync(r0tmp, { recursive: true, force: true })
  }

  // ── W5b0 新增向量（61–67）：pick 只读取值命令（活性槽全名单源=cfg.agent_defaults，
  // 与 list 星标同源；S4 本机件优先序由既有 loader 承载，不另读矩阵出厂默认）──
  // 各向量独立断言，不依赖前序向量执行顺序或可变状态。
  const p61cfg = loadOrgConfig(SKILL_ROOT).merged
  const p61defaults = isPlainObject(p61cfg.agent_defaults) ? p61cfg.agent_defaults : {}
  const s61 = runCli(['pick', 'assembler'])
  const list61 = (() => { try { return JSON.parse(runCli(['list', '--json']).stdout || 'null') } catch { return null } })()
  const star61 = Array.isArray(list61) ? list61.find((x) => x.role === 'assembler' && x.default) : null
  t('向量61 pick <已知角色> 普通输出=合并配置活性 slot 全名且与 list 星标同源（exit 0·输出与活性槽名+换行严格相等）',
    s61.status === 0 && s61.stdout === p61defaults.assembler + '\n' && star61 != null && p61defaults.assembler === star61.slot)
  const s62 = runCli(['pick', 'not-a-role'])
  const out62 = `${s62.stdout || ''}${s62.stderr || ''}`.trim()
  const expected62 = `[FAIL] 角色不存在：not-a-role（合法角色：${ROLE_ORDER.join(', ')}）`
  t('向量62 pick <未知角色> → exit 1 且诊断与期望模板串整行严格相等（锁死顺序与分隔符·沿 resolve 拒绝形态）',
    s62.status === 1 && out62 === expected62)
  const s63 = runCli(['pick', 'assembler', '--json'])
  let j63 = null
  try { j63 = JSON.parse(s63.stdout || 'null') } catch { j63 = null }
  const cfg63 = loadOrgConfig(SKILL_ROOT).merged
  const defaults63 = isPlainObject(cfg63.agent_defaults) ? cfg63.agent_defaults : {}
  const list63 = (() => { try { return JSON.parse(runCli(['list', '--json']).stdout || 'null') } catch { return null } })()
  const star63 = Array.isArray(list63) ? list63.find((x) => x.role === 'assembler' && x.default) : null
  t('向量63 pick --json 六键齐全且键序恰为 role,slot,route_source,fallback_from,family,level（route_source=pick·fallback_from=null·family/level 与 list 星标活性槽一致·setup 自包含）',
    s63.status === 0 && j63 != null && star63 != null &&
    JSON.stringify(Object.keys(j63)) === JSON.stringify(['role', 'slot', 'route_source', 'fallback_from', 'family', 'level']) &&
    j63.role === 'assembler' && j63.slot === defaults63.assembler && j63.route_source === 'pick' &&
    j63.fallback_from === null && j63.family === star63.family && j63.level === star63.level)
  const s64 = runCli(['pick'])
  const out64 = `${s64.stdout || ''}${s64.stderr || ''}`
  t('向量64 pick 缺 <role> → 用法错 exit 1（不落装载、不静默代位）',
    s64.status === 1 && out64.includes('[用法错]') && out64.includes('pick') && out64.includes('<role>') && !out64.includes('未知命令'))
  const s65 = runCli(['pick', 'assembler', 'extra'])
  const out65 = `${s65.stdout || ''}${s65.stderr || ''}`
  t('向量65 pick 额外位置参数 → 用法错 exit 1',
    s65.status === 1 && out65.includes('[用法错]') && out65.includes('额外参数') && !out65.includes('未知命令'))
  const s66 = runCli(['pick', 'assembler', '--role', 'research'])
  const out66 = `${s66.stdout || ''}${s66.stderr || ''}`
  t('向量66 pick 跨命令 flag（COMMAND_FLAGS 闭集）→ 用法错 exit 1（先 flag 闭集后位置参数、均先于装载）',
    s66.status === 1 && out66.includes('[用法错]') && out66.includes('命令 pick 的合法 flag') && out66.includes('--role'))
  const s67a = runCli(['pick', 'assembler', '--json=1'])
  const out67a = `${s67a.stdout || ''}${s67a.stderr || ''}`
  const s67b = runCli(['pick', 'assembler', '--bogus'])
  const out67b = `${s67b.stdout || ''}${s67b.stderr || ''}`
  t('向量67 pick 等号 flag（--json=1）与完全未知 flag（--bogus）均用法错 exit 1（等号形态拒收点名＋命令闭集点名）',
    s67a.status === 1 && out67a.includes('[用法错]') && out67a.includes('等号形态') && out67a.includes('--json=1') &&
    s67b.status === 1 && out67b.includes('[用法错]') && out67b.includes('未识别的 flag「--bogus」') && out67b.includes('命令 pick 的合法 flag'))

  // ── W5b R2-T2 新增向量（68–78）：doctor 三面聚合新契约（D-2/D-2a·plan-b8plus §5.3:141）──
  // 夹具前缀=os.tmpdir()/w5b-t2-dispatch-doctor-dt-*（D-3 纪律），用毕清理；staging 技能根
  // 副本（一层·不递归自调用本台架）可控注入 S1-S4 与矩阵；既有 67 向量零删零改。
  const dttmp = mkdtempSync(join(tmpdir(), 'w5b-t2-dispatch-doctor-dt-'))
  try {
    const s1Dt = { roles: Object.fromEntries(ROLE_ORDER.map((r) => [r, { default: matrix.roles[r].default, fallback: [...matrix.roles[r].fallback] }])) }
    const mkProjDt = (name, s1obj) => {
      const p = join(dttmp, name)
      mkdirSync(join(p, 'docs'), { recursive: true })
      writeFileSync(join(p, 'docs', 'agent-matrix.json'), JSON.stringify(s1obj))
      return p
    }
    const dtProj = mkProjDt('proj68', s1Dt)
    const mkStage = (name) => {
      const dir = join(dttmp, name)
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      mkdirSync(join(dir, 'templates'), { recursive: true })
      cpSync(join(SKILL_ROOT, 'scripts'), join(dir, 'scripts'), { recursive: true })
      copyFileSync(join(SKILL_ROOT, 'templates', 'agents.matrix.json'), join(dir, 'templates', 'agents.matrix.json'))
      copyFileSync(join(SKILL_ROOT, 'org-config.default.json'), join(dir, 'org-config.default.json'))
      copyFileSync(join(SKILL_ROOT, 'org-config.local.json'), join(dir, 'org-config.local.json'))
      return dir
    }
    const dtStage = mkStage('stage')
    const runDt = (stageDir, args) => spawnSync(process.execPath, [join(stageDir, 'scripts', 'agent-slots.mjs'), ...args], { encoding: 'utf8' })
    const parseDtJson = (r) => { try { return JSON.parse(r.stdout || '') } catch { return null } }

    // 向量68：三面聚合正例（staging 真实四源）——exit 0＋摘要强制回显八字段＋snapshots 计数与纯函数一致
    const dt68 = runDt(dtStage, ['doctor', '--project', dtProj])
    const out68 = `${dt68.stdout || ''}${dt68.stderr || ''}`
    const rep68 = snapshotReport({ s1: s1Dt, s2: matrix, s3: readJson(join(SKILL_ROOT, 'org-config.default.json')), s4: readJson(join(SKILL_ROOT, 'org-config.local.json')) })
    t('向量68 doctor 三面聚合正例：exit 0＋摘要 red=0/factory_fail=0/degraded=false/clean=true 且 snapshots 计数与 snapshotReport 纯函数一致＋S4 finding 行保留',
      dt68.status === 0 &&
      out68.includes(`doctor 汇总：red=0 warn=${rep68.warn_roles} factory_fail=${rep68.factory_fail} warn_roles=${rep68.warn_roles} warn_field_diffs=${rep68.warn_field_diffs} derived_fail=${rep68.derived_fail} degraded=false clean=true`) &&
      out68.includes('inspected_at') === false && out68.includes('[WARN] snapshot-lag'))

    // 向量69：--json 对象形态（不得只回旧数组）——四键 findings/resolve/snapshots/summary＋八字段布尔
    const j69 = parseDtJson(runDt(dtStage, ['doctor', '--json', '--project', dtProj]))
    t('向量69 doctor --json 对象形态：键序恰为 findings,resolve,snapshots,summary＋summary 八字段＋degraded/clean 布尔机读区分＋旧面 findings 数组保留',
      j69 && JSON.stringify(Object.keys(j69)) === JSON.stringify(['findings', 'resolve', 'snapshots', 'summary']) &&
      Array.isArray(j69.findings) && Array.isArray(j69.resolve) && isPlainObject(j69.snapshots) && isPlainObject(j69.summary) &&
      JSON.stringify(Object.keys(j69.summary)) === JSON.stringify(['red', 'warn', 'factory_fail', 'warn_roles', 'warn_field_diffs', 'derived_fail', 'degraded', 'clean']) &&
      j69.summary.degraded === false && j69.summary.clean === true)

    // 向量70：装载错=3（缺 S1 矩阵／S4 本机件缺席）
    const dtProjNone = join(dttmp, 'proj-none')
    mkdirSync(dtProjNone, { recursive: true })
    const dt70a = runDt(dtStage, ['doctor', '--project', dtProjNone])
    const dtStageNL = mkStage('stageNL')
    rmSync(join(dtStageNL, 'org-config.local.json'))
    const dt70b = runDt(dtStageNL, ['doctor', '--project', dtProj])
    t('向量70 doctor 装载错=3：--project 缺 docs/agent-matrix.json 与 S4 本机件缺席均 exit 3 且 [装载错]',
      dt70a.status === 3 && `${dt70a.stdout || ''}${dt70a.stderr || ''}`.includes('[装载错]') &&
      dt70b.status === 3 && `${dt70b.stdout || ''}${dt70b.stderr || ''}`.includes('[装载错]'))

    // 向量71：S4 RED（D8 指向不存在 slot）→ exit 1＋red≥1＋既有 [FAIL] finding 行保留
    const dtStageR = mkStage('stageR')
    const localR = JSON.parse(readFileSync(join(dtStageR, 'org-config.local.json'), 'utf8'))
    localR.agent_defaults.vision = 'ops-vision-ghost-high'
    writeFileSync(join(dtStageR, 'org-config.local.json'), JSON.stringify(localR))
    const dt71 = runDt(dtStageR, ['doctor', '--project', dtProj])
    const out71 = `${dt71.stdout || ''}${dt71.stderr || ''}`
    t('向量71 doctor S4 RED（D8 默认指向不存在 slot）→ exit 1＋red≥1＋[FAIL] D8 行保留＋degraded=false/clean=false',
      dt71.status === 1 && out71.includes('[FAIL] D8') && /doctor 汇总：red=[1-9]/.test(out71) && out71.includes('clean=false'))

    // 向量72：resolve RED（矩阵 research 档位改 max→S4 默认 -high slot 回解失配）→ exit 1＋resolve 面点名
    const dtStageV = mkStage('stageV')
    const mV = JSON.parse(readFileSync(join(dtStageV, 'templates', 'agents.matrix.json'), 'utf8'))
    mV.roles.research.level = 'max'
    writeFileSync(join(dtStageV, 'templates', 'agents.matrix.json'), JSON.stringify(mV))
    const dt72 = runDt(dtStageV, ['doctor', '--json', '--project', dtProj])
    const j72 = parseDtJson(dt72)
    t('向量72 doctor resolve RED（回解 slot 档位与 S4 默认不符）→ exit 1＋resolve findings≥1（code=resolve）＋factory_fail=0/derived_fail=0',
      dt72.status === 1 && j72 && j72.resolve.length >= 1 && j72.resolve.every((f) => f.level === 'FAIL' && f.code === 'resolve') &&
      j72.summary.red >= 1 && j72.snapshots.factory_fail === 0 && j72.snapshots.derived_fail === 0)

    // 向量73：出厂互恰 RED（S1×S2 planner.default 破坏）→ exit 1＋factory_fail≥1＋人类 [FAIL] 行
    const s1FactoryDt = clone(s1Dt)
    s1FactoryDt.roles.planner.default = 'yyx'
    const dt73 = runDt(dtStage, ['doctor', '--json', '--project', mkProjDt('proj73', s1FactoryDt)])
    const j73 = parseDtJson(dt73)
    const dt73h = runDt(dtStage, ['doctor', '--project', mkProjDt('proj73h', s1FactoryDt)])
    const out73h = `${dt73h.stdout || ''}${dt73h.stderr || ''}`
    t('向量73 doctor 出厂互恰 RED（S1×S2 planner）→ exit 1＋factory_fail≥1＋[FAIL] 出厂互恰行＋derived_fail 面独立可读',
      dt73.status === 1 && j73 && j73.snapshots.factory_fail >= 1 &&
      typeof j73.snapshots.derived_fail === 'number' && typeof j73.summary.derived_fail === 'number' &&
      dt73h.status === 1 && out73h.includes('出厂互恰'))

    // 向量74：仅出厂×现役滞后 WARN → exit 0＋clean=true（WARN 不隐藏）＋岗位/字段/来源回显
    t('向量74 doctor 仅滞后 WARN → exit 0＋[WARN] snapshot-lag 岗位 fields= 列表＋warn_roles≥1 且 clean=true（未降级）',
      dt68.status === 0 && rep68.warn_roles >= 1 && /\[WARN\] snapshot-lag \w+ fields=\w+(,\w+)* /.test(out68) &&
      out68.includes(`warn_roles=${rep68.warn_roles}`) && out68.includes('clean=true'))

    // 向量75：--degrade snapshot-lag 有对应 WARN → exit 0＋degraded=true/clean=false＋WARN 不隐藏
    const dt75 = runDt(dtStage, ['doctor', '--json', '--project', dtProj, '--degrade', 'snapshot-lag'])
    const j75 = parseDtJson(dt75)
    t('向量75 doctor --degrade snapshot-lag 有对应滞后 WARN → exit 0＋degraded=true＋clean=false＋warn_roles≥1（WARN 不隐藏）',
      dt75.status === 0 && j75 && j75.summary.degraded === true && j75.summary.clean === false && j75.summary.warn_roles >= 1 && j75.snapshots.warns.length >= 1)

    // 向量76：--degrade 落空=用法错（S3=S4=合成合规配置→无滞后 WARN 无 D7 WARN；非法值）
    const dtStageEq = mkStage('stageEq')
    for (const f of ['org-config.default.json', 'org-config.local.json'])
      writeFileSync(join(dtStageEq, f), JSON.stringify(compliantCfg()))
    const dt76a = runDt(dtStageEq, ['doctor', '--project', dtProj, '--degrade', 'snapshot-lag'])
    const dt76b = runDt(dtStageEq, ['doctor', '--project', dtProj, '--degrade', 'D7'])
    const dt76c = runDt(dtStageEq, ['doctor', '--project', dtProj, '--degrade', 'bogus'])
    t('向量76 doctor --degrade 落空=用法错 exit 1（snapshot-lag 无对应 WARN／D7 无对应 WARN／非法降级目标）',
      dt76a.status === 1 && `${dt76a.stdout || ''}${dt76a.stderr || ''}`.includes('[用法错]') &&
      dt76b.status === 1 && `${dt76b.stdout || ''}${dt76b.stderr || ''}`.includes('[用法错]') &&
      dt76c.status === 1 && `${dt76c.stdout || ''}${dt76c.stderr || ''}`.includes('[用法错]'))

    // 向量77（implreview-split D-16 修夹具）：D7 WARN 注入＝删 providers.glm 前先把 D6 四岗
    //（executor/implreview1/implreview2/adjudicator）默认钉到非 glm 合成槽，使夹具与宿主现值
    // 解耦（根因=宿主 executor 默认 glm 时删 glm 连带 D6 RED——批前既发失败）；同一夹具在
    // ①宿主现值层（真实 S3/S4 复制＋钉值删源）与②合成基线层（compliantCfg 派生 S3/S4＋同钉值
    // 删源）双跑，结果一致（exit 0/clean=true/D7 WARN/零 D6 RED）——旧断言（未降级 exit 0、
    // D7 WARN、降级后 degraded=true/clean=false）逐项保留。
    const PIN_D6 = { executor: 'ops-executor-ds-high', implreview1: 'ops-implreview1-699-max', implreview2: 'ops-implreview2-ds-max', adjudicator: 'ops-adjudicator-699-max' }
    const dtStageG = mkStage('stageG')
    for (const [f, pin] of [['org-config.default.json', false], ['org-config.local.json', true]]) {
      const c = JSON.parse(readFileSync(join(dtStageG, f), 'utf8'))
      if (pin) Object.assign(c.agent_defaults, PIN_D6) // 只钉 S4：S3 保持出厂（factory 面不动）
      delete c.providers.glm
      writeFileSync(join(dtStageG, f), JSON.stringify(c))
    }
    const dtStageS = mkStage('stageS') // 合成基线层：compliantCfg 派生（与宿主现值解耦）
    const synthPinned = compliantCfg()
    Object.assign(synthPinned.agent_defaults, PIN_D6)
    const synthNoGlm = JSON.parse(JSON.stringify(synthPinned))
    delete synthNoGlm.providers.glm
    writeFileSync(join(dtStageS, 'org-config.default.json'), JSON.stringify({ ...compliantCfg(), providers: Object.fromEntries(Object.entries(compliantCfg().providers).filter(([k]) => k !== 'glm')) }))
    writeFileSync(join(dtStageS, 'org-config.local.json'), JSON.stringify(synthNoGlm))
    const dt77a = runDt(dtStageG, ['doctor', '--project', dtProj])
    const out77a = `${dt77a.stdout || ''}${dt77a.stderr || ''}`
    const dt77s = runDt(dtStageS, ['doctor', '--project', dtProj])
    const out77s = `${dt77s.stdout || ''}${dt77s.stderr || ''}`
    const dt77b = runDt(dtStageG, ['doctor', '--json', '--project', dtProj, '--degrade', 'D7'])
    const j77b = parseDtJson(dt77b)
    t('向量77 doctor D7 WARN：钉 D6 四岗默认后删 glm——宿主现值层与合成基线层双跑一致（exit 0/clean=true/[WARN] D7/零 D6 RED）；--degrade D7 → exit 0＋degraded=true/clean=false',
      dt77a.status === 0 && out77a.includes('[WARN] D7') && out77a.includes('clean=true') && !out77a.includes('[FAIL] D6') &&
      dt77s.status === 0 && out77s.includes('[WARN] D7') && out77s.includes('clean=true') && !out77s.includes('[FAIL] D6') &&
      dt77b.status === 0 && j77b && j77b.summary.degraded === true && j77b.summary.clean === false &&
      j77b.findings.some((f) => f.level === 'WARN' && f.code === 'D7') && !j77b.findings.some((f) => f.code === 'D6' && f.level === 'FAIL'))

    // 向量78：RED 配 --degrade 不降级——D8 RED 与 D7 WARN 同场，--degrade D7 仍 exit 1
    const localG = JSON.parse(readFileSync(join(dtStageG, 'org-config.local.json'), 'utf8'))
    localG.agent_defaults.vision = 'ops-vision-ghost-high'
    writeFileSync(join(dtStageG, 'org-config.local.json'), JSON.stringify(localG))
    const dt78 = runDt(dtStageG, ['doctor', '--json', '--project', dtProj, '--degrade', 'D7'])
    const j78 = parseDtJson(dt78)
    t('向量78 doctor RED 配 --degrade 不降级：D8 RED 在场时 --degrade D7 仍 exit 1＋red≥1＋degraded=true/clean=false（声明不豁免 RED）',
      dt78.status === 1 && j78 && j78.summary.red >= 1 && j78.summary.degraded === true && j78.summary.clean === false)
  } finally {
    rmSync(dttmp, { recursive: true, force: true })
  }

  console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
  process.exit(fails === 0 ? 0 : 1)
}

// ── CLI ──
/** 命令级 flag 集合（W-new2 R2-5）：每个命令只接受自己那几面，跨命令误传即用法错。 */
const COMMAND_FLAGS = {
  list: new Set(['--role', '--json', '--self-test']),
  show: new Set(['--json', '--self-test']),
  resolve: new Set(['--route', '--agent', '--json', '--self-test']),
  doctor: new Set(['--project', '--json', '--degrade', '--self-test']),
  'dispatch-check': new Set(['--plan', '--route', '--project', '--self-test']),
  snapshots: new Set(['--project', '--json', '--self-test']),
  pick: new Set(['--json', '--self-test']),
}
/** 全局闭集=四命令并集（先拦完全陌生的 flag，再按命令拦跨命令 flag）。 */
const ALLOWED_FLAGS = new Set(Object.values(COMMAND_FLAGS).flatMap((s) => [...s]))

/** W3：未识别 flag 一律拒收（白名单外的 --* token 不得静默丢弃——`show <slot> --bogus`
 *  原先静默退出 0，属假绿面）。等号形态仍走 cliFlag 单源拒收。
 *  W-new2：`scope` 为命令名时按该命令集合复核（`show <slot> --role research` 拒收）。 */
function rejectUnknownFlags(argv, scope = null) {
  const allowed = scope ? COMMAND_FLAGS[scope] : ALLOWED_FLAGS
  const label = scope ? `命令 ${scope} 的合法 flag` : '本命令合法 flag'
  for (const token of argv) {
    if (!token.startsWith('--')) continue
    const eq = token.indexOf('=')
    const name = eq >= 0 ? token.slice(0, eq) : token
    if (!allowed.has(name))
      throw new UsageError(`未识别的 flag「${token}」——${label}：${[...allowed].join(', ')}（flag 取值一律空格分隔）`)
    if (eq >= 0) cliFlag(argv, name) // 等号形态拒收
  }
}

const isMain =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) {
  const argv = process.argv.slice(2)
  try {
    const scope = positionals(argv)[0]
    // 已知命令先按命令子集复核（错误信息给该命令的合法集合）；未知命令/无命令走全局闭集
    if (scope && COMMAND_FLAGS[scope]) rejectUnknownFlags(argv, scope)
    else rejectUnknownFlags(argv)
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`[用法错] ${e.message}`)
      process.exit(1)
    }
    throw e
  }
  if (argv.includes('--self-test')) selfTest()
  try {
    const pos = positionals(argv)
    const cmd = pos[0]
    if (!cmd) {
      console.error(`[用法错] 缺命令\n${usage()}`)
      process.exit(1)
    }
    if (WRITE_COMMANDS.includes(cmd)) {
      console.error(`[未实现] 该命令属阶段 4（P14）范围，本版未实现：${cmd}`)
      console.error(`[未实现] 命令原文：node scripts/agent-slots.mjs ${argv.join(' ')}`)
      process.exit(1)
    }
    const json = argv.includes('--json')
    if (cmd === 'list') {
      const role = cliFlag(argv, '--role')
      if (role !== null && !ROLE_ORDER.includes(role)) throw new UsageError(`--role 未知角色「${role}」——合法角色：${ROLE_ORDER.join(', ')}`)
      const cfg = loadCfgOrExit()
      const defaults = isPlainObject(cfg.agent_defaults) ? cfg.agent_defaults : {}
      const rows = slotRows(cfg)
        .filter((r) => role === null || r.role === role)
        .map((r) => ({ ...r, default: defaults[r.role] === r.slot }))
      if (json) {
        console.log(JSON.stringify(rows, null, 2))
        process.exit(0)
      }
      printTable(['slot', 'provider', 'model', 'level', 'family', 'default'], rows.map((r) => [r.slot, r.provider, r.model, r.level, r.family, r.default ? '*' : '']))
      process.exit(0)
    }
    if (cmd === 'show') {
      const slot = pos[1]
      if (!slot) throw new UsageError('show 需要 <slot> 参数')
      const cfg = loadCfgOrExit()
      const matrix = loadMatrixOrExit()
      const def = isPlainObject(cfg.agent_slots) ? cfg.agent_slots[slot] : null
      if (!def) {
        const names = Object.keys(cfg.agent_slots || {})
        const near = nearestSlots(slot, names)
        console.error(`[FAIL] slot 不存在：${slot}`)
        console.error(near.length ? `近似名：${near.join('、')}` : `近似名：无（用 list 查看全部 ${names.length} 个 slot）`)
        process.exit(1)
      }
      const parsed = parseSlotKey(slot)
      const roleDef = (matrix.roles && matrix.roles[parsed?.role]) || {}
      const bindingValue = own(cfg.agent_bindings || {}, slot) ? cfg.agent_bindings[slot] : null
      const out = {
        slot,
        role: parsed?.role || '?',
        provider: typeof def.provider === 'string' ? def.provider : (parsed?.provider || '?'),
        model: typeof def.model === 'string' ? def.model : '?',
        level: typeof def.level === 'string' ? def.level : (parsed?.level || '?'),
        family: familyOf(cfg.providers?.[def.provider]) || '?',
        title: roleDef.title || '?',
        tools: roleDef.tools || [],
        readonly: typeof roleDef.readonly === 'boolean' ? roleDef.readonly : null,
        default: isPlainObject(cfg.agent_defaults) && cfg.agent_defaults[parsed?.role] === slot,
        binding: bindingValue,
      }
      if (json) {
        console.log(JSON.stringify(out, null, 2))
        process.exit(0)
      }
      console.log(`slot: ${out.slot}`)
      console.log(`role: ${out.role}`)
      console.log(`provider: ${out.provider}`)
      console.log(`model: ${out.model}`)
      console.log(`level: ${out.level}`)
      console.log(`family: ${out.family}`)
      console.log(`title: ${out.title}`)
      console.log(`tools: ${out.tools.join(', ')}`)
      console.log(`readonly: ${out.readonly}`)
      console.log(`default: ${out.default}`)
      console.log(`binding: ${out.binding === null ? '(未绑定)' : typeof out.binding === 'string' ? out.binding : JSON.stringify(out.binding)}`)
      process.exit(0)
    }
    if (cmd === 'resolve') {
      const routeText = cliFlag(argv, '--route')
      const agentName = cliFlag(argv, '--agent')
      if (routeText !== null && agentName !== null)
        throw new UsageError('resolve 的 --agent 与 --route 互斥——同给=用法错，只给其一')
      if (routeText === null && agentName === null)
        throw new UsageError('resolve 需要 --route "<route>" 或 --agent <旧名>')
      const cfg = loadCfgOrExit()
      const matrix = loadMatrixOrExit()
      if (agentName !== null) {
        if (!aliasTableOf(matrix)) {
          console.error('[装载错] 逻辑矩阵 templates/agents.matrix.json 缺 aliases 分区——resolve --agent 无旧名登记表（唯一登记源=矩阵）')
          process.exit(3)
        }
        const row = resolveAlias(agentName, matrix, cfg)
        if (!row) {
          const known = aliasNames(matrix)
          const cand = aliasCandidate(agentName, matrix, cfg)
          if (known.includes(agentName))
            console.error(`[FAIL] 旧名「${agentName}」解析到 slot「${cand?.slot || '?'}」，但该 slot 不在 agent_slots 中（防假绿）`)
          else
            console.error(`[FAIL] 未登记的旧名「${agentName}」——已知旧名：${known.join(', ')}`)
          process.exit(1)
        }
        const rows = [row]
        if (json) {
          console.log(JSON.stringify(rows, null, 2))
          process.exit(0)
        }
        printTable(['role', 'slot', 'provider', 'model', 'level', 'family', 'route_source'], rows.map((r) => [r.role, r.slot, r.provider, r.model, r.level, r.family, r.route_source]))
        process.exit(0)
      }
      let route
      try {
        route = parseRoute(routeText)
      } catch (e) {
        if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
        throw e
      }
      const errors = validateRoute(route, matrix)
      if (errors.length) {
        console.error('[FAIL] ROUTE 校验失败：')
        for (const e of errors) console.error(`  - ${e}`)
        console.error(`合法角色：${ROLE_ORDER.join(', ')}`)
        process.exit(1)
      }
      for (const note of route.notes) console.error(`[note] ${note}`)
      const rows = resolveRoute(route, matrix, cfg)
      if (json) {
        console.log(JSON.stringify(rows, null, 2))
        process.exit(0)
      }
      printTable(['role', 'slot', 'provider', 'model', 'level', 'family', 'route_source'], rows.map((r) => [r.role, r.slot, r.provider, r.model, r.level, r.family, r.route_source]))
      process.exit(0)
    }
    if (cmd === 'pick') {
      // W5b0：单岗派发只读取值（02 §8.1 SOP 承载面）。活性槽全名=cfg.agent_defaults[role]
      // （与 list 星标判定同源，S4 本机件优先序由既有 loader 承载）；不读 ROUTE、不切槽、
      // 不自动走回退链（fallback_from 恒 null）、禁写配置。用法错次序=先 flag 闭集复核
      //（全局分支）后本分支位置参数/角色校验，两者均先于 loadCfgOrExit 装载。
      const extra = pos.slice(1)
      if (!extra.length) throw new UsageError('pick 需要 <role> 参数——用法：node scripts/agent-slots.mjs pick <role> [--json]')
      if (extra.length > 1) throw new UsageError(`pick 只接受恰一个位置参数 <role>，收到额外参数：${extra.slice(1).join(' ')}`)
      const role = extra[0]
      if (!ROLE_ORDER.includes(role)) {
        console.error(`[FAIL] 角色不存在：${role}（合法角色：${ROLE_ORDER.join(', ')}）`)
        process.exit(1)
      }
      const cfg = loadCfgOrExit()
      const defaults = isPlainObject(cfg.agent_defaults) ? cfg.agent_defaults : {}
      const slot = defaults[role]
      if (typeof slot !== 'string' || !slot) {
        console.error(`[装载错] cfg.agent_defaults.${role} 缺失或非字符串——活性槽权威=org-config 合并结果，禁出厂默认静默代位`)
        process.exit(3)
      }
      if (json) {
        const def = isPlainObject(cfg.agent_slots) ? cfg.agent_slots[slot] : null
        const out = {
          role,
          slot,
          route_source: 'pick',
          fallback_from: null,
          family: familyOf(cfg.providers?.[def?.provider]),
          level: parseSlotKey(slot)?.level || '?',
        }
        console.log(JSON.stringify(out, null, 2))
        process.exit(0)
      }
      console.log(slot)
      process.exit(0)
    }
    if (cmd === 'doctor') {
      // W5b R2-T2 D-2/D-2a（plan-b8plus §5.3:141）：doctor 升级为三面聚合——①既有 doctorFindings
      // S4 内部检查（id/语义保留）；②resolve 面：S4 十岗默认 slot 规范化 provider，按 ROLE_ORDER
      // 构造十岗 ROUTE，复用 parseRoute/validateRoute/resolveRoute 回解（解析失败/provider 不支持/
      // 回解 slot 与 S4 默认不符=RED）；③snapshots 面：复用 snapshotReport 与同一 S1-S4 装载路径
      // （factory_fail/derived_fail=RED，出厂×现役滞后=WARN）。缺省项目发现与 snapshots 一致。
      // 退出码 0/1/3 唯一真相源=references/06-model-routing.md §5.8；--degrade 仅可对 D7 或
      // snapshot-lag 的既有 WARN 显式声明（落空=用法错），RED/装载错/其他检查不得降级。
      const projectDir = resolveProjectDirOrExit(cliFlag(argv, '--project'))
      const degradeTargets = []
      for (let i = 0; i < argv.length; i++) {
        if (argv[i] !== '--degrade') continue
        const val = argv[i + 1]
        if (val === undefined) throw new UsageError('flag --degrade 居末位无值（缺值=用法错）')
        if (val.startsWith('--')) throw new UsageError(`flag --degrade 的值形如 flag（「${val}」——误吃下一 flag=用法错）`)
        if (val !== 'D7' && val !== 'snapshot-lag') throw new UsageError(`--degrade 非法目标「${val}」——仅可 D7 或 snapshot-lag（RED、装载错与其他检查不得降级）`)
        if (!degradeTargets.includes(val)) degradeTargets.push(val)
      }
      const cfg = loadCfgOrExit()
      const matrix = loadMatrixOrExit()
      const paths = {
        s1: join(projectDir, 'docs', 'agent-matrix.json'),
        s2: MATRIX_PATH,
        s3: join(SKILL_ROOT, 'org-config.default.json'),
        s4: join(SKILL_ROOT, 'org-config.local.json'),
      }
      const sources = {}
      for (const [k, p] of Object.entries(paths)) {
        try {
          sources[k] = readJson(p)
        } catch (e) {
          console.error(`[装载错] ${k.toUpperCase()} 装载失败（${p}）：${e.message}`)
          process.exit(3)
        }
      }
      const findings = doctorFindings(matrix, cfg)
      const resolveFindings = []
      const defaults = isPlainObject(cfg.agent_defaults) ? cfg.agent_defaults : {}
      const cfgSlots = isPlainObject(cfg.agent_slots) ? cfg.agent_slots : {}
      const resolveItems = []
      let resolveOk = true
      for (const role of ROLE_ORDER) {
        const slot = defaults[role]
        const parsed = typeof slot === 'string' ? parseSlotKey(slot) : null
        if (!parsed || !own(cfgSlots, slot)) {
          resolveOk = false
          resolveFindings.push({ level: 'FAIL', code: 'resolve', line: `agent_defaults.${role} 默认 slot「${String(slot)}」不可规范化或未在 agent_slots 注册——resolve 面无法构造十岗 ROUTE` })
          continue
        }
        resolveItems.push(`${role}-${parsed.provider}`)
      }
      if (resolveOk && resolveItems.length === ROLE_ORDER.length) {
        try {
          const route = parseRoute(`ROUTE: ${resolveItems.join(';')}`)
          for (const e of validateRoute(route, matrix))
            resolveFindings.push({ level: 'FAIL', code: 'resolve', line: `resolve 面 ROUTE 校验失败：${e}` })
          for (const r of resolveRoute(route, matrix, cfg))
            if (r.slot !== defaults[r.role])
              resolveFindings.push({ level: 'FAIL', code: 'resolve', line: `resolve 面回解 slot=${r.slot} ≠ S4 默认=${defaults[r.role]}（${r.role}）` })
        } catch (e) {
          resolveFindings.push({ level: 'FAIL', code: 'resolve', line: `resolve 面 ROUTE 解析失败：${e.message}` })
        }
      }
      let report
      try {
        report = snapshotReport(sources)
      } catch (e) {
        console.error(`[装载错] 快照投影/比较失败：${e.message}`)
        process.exit(3)
      }
      const s4Warn = findings.filter((f) => f.level === 'WARN').length
      const red = findings.filter((f) => f.level === 'FAIL').length + resolveFindings.length + report.factory_fail + report.derived_fail
      const warn = s4Warn + report.warn_roles
      for (const tg of degradeTargets) {
        const present = tg === 'D7' ? findings.some((f) => f.level === 'WARN' && f.code === 'D7') : report.warn_roles > 0
        if (!present) throw new UsageError(`--degrade ${tg} 无对应既有 WARN（声明落空=用法错——RED、装载错与其他检查不得降级）`)
      }
      const degraded = degradeTargets.length > 0
      const clean = !degraded && red === 0
      const fmtW = (v) => `default=${v.default} fallback=${JSON.stringify(v.fallback)}`
      if (json) {
        console.log(JSON.stringify({
          findings,
          resolve: resolveFindings,
          snapshots: { ...report, sources: paths },
          summary: { red, warn, factory_fail: report.factory_fail, warn_roles: report.warn_roles, warn_field_diffs: report.warn_field_diffs, derived_fail: report.derived_fail, degraded, clean },
        }, null, 2))
      } else {
        for (const f of findings) console.log(`[${f.level}] ${f.code} ${f.line}`)
        for (const f of resolveFindings) console.log(`[${f.level}] ${f.code} ${f.line}`)
        for (const d of report.factory_diffs) {
          const [fa, fb] = d.pair.split('×')
          console.error(`[FAIL] 出厂互恰破坏 ${d.pair} ${d.role}.${d.field}: ${fa}=${JSON.stringify(d[fa])} ≠ ${fb}=${JSON.stringify(d[fb])}`)
        }
        if (report.derived_fail)
          console.error(`[FAIL] S2→S1 单向派生漂移：共有 default/fallback 子面规范化投影逐字节不一致（roles=${report.derived.roles} bytes=${report.derived.bytes}）——禁反向写修复`)
        for (const w of report.warns) console.log(`[WARN] snapshot-lag ${w.role} fields=${w.fields.join(',')} | S1 ${fmtW(w.values.S1)} | S2 ${fmtW(w.values.S2)} | S3 ${fmtW(w.values.S3)} | S4 ${fmtW(w.values.S4)}`)
        if (degraded) console.log(`[degraded] ${degradeTargets.join(',')}——仅声明性降级（对应既有 WARN 在场）；RED 未降级，不得充当结项全绿证明`)
        console.log(`doctor 汇总：red=${red} warn=${warn} factory_fail=${report.factory_fail} warn_roles=${report.warn_roles} warn_field_diffs=${report.warn_field_diffs} derived_fail=${report.derived_fail} degraded=${degraded} clean=${clean}`)
      }
      process.exit(red > 0 ? 1 : 0)
    }
    if (cmd === 'dispatch-check') {
      const extra = pos.slice(1)
      if (extra.length) throw new UsageError(`dispatch-check 不接受额外参数：${extra.join(' ')}`)
      const planPath = cliFlag(argv, '--plan')
      const routeText = cliFlag(argv, '--route')
      if (planPath === null) throw new UsageError('dispatch-check 需要 --plan <dispatch-plan.md>')
      if (routeText === null) throw new UsageError('dispatch-check 需要 --route "<ROUTE>"')
      const projectDir = resolveProjectDirOrExit(cliFlag(argv, '--project'))
      const s1Path = join(projectDir, 'docs', 'agent-matrix.json')
      let plan
      let s1
      try {
        plan = parseDispatchPlan(readFileSync(planPath, 'utf8'))
      } catch (e) {
        console.error(`[装载错] dispatch-plan 解析失败（${planPath}）：${e.message}`)
        process.exit(3)
      }
      try {
        s1 = readJson(s1Path)
      } catch (e) {
        console.error(`[装载错] S1 主仓矩阵装载失败（${s1Path}）：${e.message}`)
        process.exit(3)
      }
      const matrix = loadMatrixOrExit()
      let cfg
      try {
        const loaded = loadOrgConfig(projectDir)
        cfg = loaded.merged
        if (!isPlainObject(cfg)) throw new Error('合并结果为空/非对象')
        if (loaded.hasLocal !== true) // d-N10：S4 本机件缺席＝装载错，禁出厂默认静默代位
          throw new Error('S4 本机件 org-config.local.json 缺席——dispatch-check 禁以出厂默认（S3）静默代位（现役默认权威=S4）')
      } catch (e) {
        console.error(`[装载错] org-config 装载失败：${e.message}`)
        process.exit(3)
      }
      let result
      try {
        result = dispatchCheck({ plan, routeText, matrix, cfg, s1 })
      } catch (e) {
        if (e instanceof UsageError) {
          console.error(`[用法错] ${e.message}`)
          process.exit(1)
        }
        console.error(`[装载错] ${e.message}`)
        process.exit(3)
      }
      console.log(`plan: ${planPath}（§1 十岗实选表＋§2 ROUTE）`)
      printTable(['岗位', 'plan_slot', 'resolved_slot', 'route_source', '启用'],
        result.rows.map((r) => [r.role, r.plan_slot, r.resolved_slot, r.route_source, r.enabled ? '是' : '否']))
      console.log(`implreview2 派生一致性（S1 series_process.reviewer_second）: plan=${result.second_plan_slot} s1=${result.second_reviewer} defaults=${result.second_default} fallback0=${result.second_fallback_head ?? '?'}`)
      for (const note of result.notes || []) console.error(`[note] ${note}`)
      for (const e of result.route_errors) console.error(`[FAIL] ROUTE 校验：${e}`)
      for (const d of result.diffs) console.error(`[FAIL] ${d}`)
      console.log(`dispatch_check=${result.ok ? 'PASS' : 'FAIL'} roles=${result.roles} enabled=${result.enabled} route_items=${result.route_items} second_reviewer=${result.second_reviewer}`)
      process.exit(result.ok ? 0 : 1)
    }
    if (cmd === 'snapshots') {
      const extra = pos.slice(1)
      if (extra.length) throw new UsageError(`snapshots 不接受额外参数：${extra.join(' ')}`)
      const projectDir = resolveProjectDirOrExit(cliFlag(argv, '--project'))
      const paths = {
        s1: join(projectDir, 'docs', 'agent-matrix.json'),
        s2: MATRIX_PATH,
        s3: join(SKILL_ROOT, 'org-config.default.json'),
        s4: join(SKILL_ROOT, 'org-config.local.json'),
      }
      const sources = {}
      for (const [k, p] of Object.entries(paths)) {
        try {
          sources[k] = readJson(p)
        } catch (e) {
          console.error(`[装载错] ${k.toUpperCase()} 装载失败（${p}）：${e.message}`)
          process.exit(3)
        }
      }
      let report
      try {
        report = snapshotReport(sources)
      } catch (e) {
        console.error(`[装载错] 快照投影/比较失败：${e.message}`)
        process.exit(3)
      }
      const fmt = (v) => `default=${v.default} fallback=${JSON.stringify(v.fallback)}`
      if (!json) {
        console.log(`[S1] ${paths.s1}（主仓矩阵·出厂快照）`)
        console.log(`[S2] ${paths.s2}（技能仓矩阵·出厂快照）`)
        console.log(`[S3] ${paths.s3}（出厂 agent_defaults/role_fallbacks）`)
        console.log(`[S4] ${paths.s4}（现役默认权威）`)
        for (const w of report.warns) console.log(`[WARN] ${w.role} fields=${w.fields.join(',')} | S1 ${fmt(w.values.S1)} | S2 ${fmt(w.values.S2)} | S3 ${fmt(w.values.S3)} | S4 ${fmt(w.values.S4)}`)
      }
      for (const d of report.factory_diffs) {
        const [fa, fb] = d.pair.split('×')
        console.error(`[FAIL] 出厂互恰破坏 ${d.pair} ${d.role}.${d.field}: ${fa}=${JSON.stringify(d[fa])} ≠ ${fb}=${JSON.stringify(d[fb])}`)
      }
      if (report.derived_fail)
        console.error(`[FAIL] S2→S1 单向派生漂移：共有 default/fallback 子面规范化投影逐字节不一致（roles=${report.derived.roles} bytes=${report.derived.bytes}）——禁反向写修复`)
      if (json) {
        console.log(JSON.stringify({ ...report, sources: paths }, null, 2))
      } else {
        console.log(`snapshots 汇总：factory_fail=${report.factory_fail} warn_roles=${report.warn_roles} warn_field_diffs=${report.warn_field_diffs} derived_fail=${report.derived_fail} inspected_at=${report.inspected_at}`)
      }
      process.exit(report.factory_fail || report.derived_fail ? 1 : 0)
    }
    throw new UsageError(`未知命令「${cmd}」\n${usage()}`)
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`[用法错] ${e.message}`)
      process.exit(1)
    }
    throw e
  }
}
