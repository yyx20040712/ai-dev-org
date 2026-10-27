/**
 * agent-slots —— 待位只读命令面（P4）。
 * 职责：
 *   ① list/show/resolve/doctor 四条只读命令：列 slot、看定义、按 ROUTE 解析、
 *      体检矩阵×配置一致性；
 *   ② ROUTE 解析（`ROUTE:` 前缀，`;`/`,`/空白分隔，两空格缩进续行；同角色重复
 *      取最后一次并留 note）；旧名解析（`resolve --agent <旧名>`，10 条登记表，
 *      角色默认型按 effectiveDefaults 生效档、固定 provider 型按 ops-<role>-<provider>-<level>）；
 *   ③ doctor 八项检查 D1–D8（矩阵完整性/键集/键值一致/绑定可解析/vision 多模态/
 *      实现与审核裁决跨族/族可解析/默认与回退覆盖）+ D9 旧名提示（WARN）；
 *   ④ 写侧命令（select/gen/enable/disable/preset/sync）本版不实现，命中即提示并
 *      非零退出，不静默成功、不伪造写盘。
 * 退出码口径单源=references/06 §5.8（此处不复写数字——语义映射，防双源漂移）。
 * 用法：
 *   node scripts/agent-slots.mjs list [--role <role>] [--json]
 *   node scripts/agent-slots.mjs show <slot> [--json]
 *   node scripts/agent-slots.mjs resolve --route "<route>" [--json]
 *   node scripts/agent-slots.mjs doctor [--json]
 *   node scripts/agent-slots.mjs --self-test
 *   （flag 取值一律空格分隔，--x=y 等号形态=用法错拒收——cliFlag 单源立场）
 * 可 import 纯函数零副作用（isMain guard 惯例；自检向量禁动真实 templates/agents/）。
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { SKILL_ROOT, loadOrgConfig, cliFlag, UsageError, familyOf, effectiveDefaults, localDateStr } from './org-config.mjs'
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
    if (item.role === 'vision' && providers[item.provider]?.multimodal !== true)
      errors.push(`vision 岗 provider「${item.provider}」非多模态（multimodal≠true）——视觉岗只允许多模态 provider`)
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
 *  角色默认型（provider=null）经 effectiveDefaults(cfg,today) 取生效默认档——窗口覆盖
 *  生效，不得只读 cfg.agent_defaults；固定 provider 型用 ops-<role>-<provider>-<level>。 */
function aliasCandidate(name, matrix, cfg, today) {
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
    const defaults = effectiveDefaults(cfg, today ?? localDateStr())
    const d = defaults?.[def.role]
    if (typeof d === 'string' && d) slot = d
  }
  return slot ? { alias: name, role: def.role, slot, level, provider } : null
}

/** 旧名解析（L4）：纯函数、零副作用、不读环境变量/文件；today 可注入。
 *  返回 { alias, role, slot, provider, model, level, family, route_source:'alias' }，
 *  未登记名或解析到的 slot 不在 agent_slots 时返回 null（调用侧负责 exit 1 点名）。 */
export function resolveAlias(name, matrix, cfg, today = localDateStr()) {
  const cand = aliasCandidate(name, matrix, cfg, today)
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

/** agent_slots 全量行：按 role（固定七岗序）→ level（low<high<max）→ provider 排序。 */
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

  // D1：矩阵七岗齐全、slot 数=独立算式期望、命名合法。
  // 期望值=Σ roles[role].providers.length（verify-docs 矩阵计数检查既有口径，L19 派生化
  // ——禁用 slotsFromMatrix 输出长度作期望值：自指恒真=计数检查静默失效，r1-W1）。
  const expectedSlots = ROLE_ORDER.reduce((n, r) => n + (Array.isArray(roles[r]?.providers) ? roles[r].providers.length : 0), 0)
  for (const role of ROLE_ORDER) if (!own(roles, role)) add('FAIL', 'D1', `矩阵缺角色「${role}」——七岗须齐全（${ROLE_ORDER.join(', ')}）`)
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

  // D4：每个矩阵 slot 有绑定、可解析、档位与 slot level 一致
  for (const s of slots) {
    if (!own(bindings, s.slot)) { add('FAIL', 'D4', `slot ${s.slot} 无绑定（agent_bindings 缺键）`); continue }
    const parsed = parseBindingValue(bindings[s.slot])
    if (!parsed) { add('FAIL', 'D4', `slot ${s.slot} 绑定值无法解析（${JSON.stringify(bindings[s.slot])}）——须为 provider/model$level 或 {model,level}`); continue }
    if (parsed.level !== s.level) add('FAIL', 'D4', `slot ${s.slot} 绑定档位=${parsed.level ?? '缺失'} ≠ slot level=${s.level}`)
  }

  // D5：vision 岗每个 slot 的 provider multimodal=true（矩阵与本机 providers 双源核对）
  for (const s of slots.filter((x) => x.role === 'vision')) {
    if (matrixProviders[s.provider]?.multimodal !== true) add('FAIL', 'D5', `vision slot ${s.slot} 的 provider「${s.provider}」在矩阵中 multimodal≠true`)
    if (cfgProviders[s.provider] && cfgProviders[s.provider].multimodal === false) add('FAIL', 'D5', `vision slot ${s.slot} 的 provider「${s.provider}」在本机 providers 中 multimodal=false`)
  }

  // D6：默认实现族 ≠ 默认审核族、≠ 默认裁决族
  const familyOfDefault = (role) => {
    const name = defaults[role]
    const def = typeof name === 'string' ? cfgSlots[name] : null
    const provider = def && typeof def.provider === 'string' ? def.provider : null
    return provider ? (familyOf(cfgProviders[provider]) || '') : ''
  }
  const fExec = familyOfDefault('executor')
  const fRev = familyOfDefault('reviewer')
  const fAdj = familyOfDefault('adjudicator')
  if (!fExec || !fRev || !fAdj) add('FAIL', 'D6', `无法解析默认实现/审核/裁决族（executor=${fExec || '?'} reviewer=${fRev || '?'} adjudicator=${fAdj || '?'}）——明细见 D7/D8`)
  else {
    if (fExec === fRev) add('FAIL', 'D6', `默认实现族=审核族「${fExec}」——须异构（05 §5）`)
    if (fExec === fAdj) add('FAIL', 'D6', `默认实现族=裁决族「${fExec}」——须异构（05 §5）`)
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

  // D8：agent_defaults / role_fallbacks 覆盖七角色且指向存在的 slot
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
    // 建议值须按窗口推算：复制 cfg、剔除命中旧名，再对副本调 effectiveDefaults。
    // 若直接读 matrix.roles[role].default，窗口生效期会给出错误建议档。
    const suggestionCfg = () => {
      const copy = isPlainObject(cfg) ? { ...cfg } : {}
      const d = isPlainObject(cfg?.agent_defaults) ? { ...cfg.agent_defaults } : {}
      for (const [role, name] of Object.entries(d)) {
        if (typeof name !== 'string' || !own(aliasTable, name)) continue
        const level = matrix?.roles?.[role]?.level
        const provider = matrix?.roles?.[role]?.default
        if (typeof level === 'string' && typeof provider === 'string') d[role] = `ops-${role}-${provider}-${level}`
        else delete d[role]
      }
      copy.agent_defaults = d
      const f = isPlainObject(cfg?.role_fallbacks) ? cfg.role_fallbacks : {}
      copy.role_fallbacks = Object.fromEntries(Object.entries(f).map(([role, seq]) => [
        role,
        Array.isArray(seq) ? seq.filter((x) => !(typeof x === 'string' && own(aliasTable, x))) : seq,
      ]))
      const b = isPlainObject(cfg?.agent_bindings) ? cfg.agent_bindings : {}
      copy.agent_bindings = Object.fromEntries(Object.entries(b).filter(([k]) => !own(aliasTable, k)))
      return copy
    }
    const reportAlias = (name, where, role) => {
      const cand = aliasCandidate(name, matrix, cfg, opts?.today)
      let suggest = cand?.slot
      if (!suggest || own(aliasTable, suggest)) {
        const today = opts?.today ?? localDateStr()
        const view = effectiveDefaults(suggestionCfg(), today)
        const s = role ? view[role] : null
        if (typeof s === 'string' && s && !own(aliasTable, s)) suggest = s
        else {
          // r2 W1：兜底建议值同样必须经 effectiveDefaults 的窗口推算。
          // 以 matrix.roles[def.role].default 构造基底放进副本，再取该角色的生效档；
          // 不得直接拼接 matrix default（窗口生效期会给出错档）。
          const def = aliasTable[name]
          const lvl = matrix?.roles?.[def?.role]?.level
          const prov = matrix?.roles?.[def?.role]?.default
          suggest = null
          if (typeof lvl === 'string' && typeof prov === 'string') {
            const seeded = suggestionCfg()
            seeded.agent_defaults = {
              ...(isPlainObject(seeded.agent_defaults) ? seeded.agent_defaults : {}),
              [def.role]: `ops-${def.role}-${prov}-${lvl}`,
            }
            const v = effectiveDefaults(seeded, today)[def.role]
            if (typeof v === 'string' && v && !own(aliasTable, v)) suggest = v
          }
        }
      }
      // N2：建议值必须真实存在，禁推荐不存在的档。
      if (suggest && !own(cfgSlots, suggest)) suggest = null
      add('WARN', 'D9', `旧名「${name}」出现在 ${where}——建议替换为「${suggest || `${name} 对应角色的生效默认档`}」`)
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

// ── CLI 辅助 ──
const VALUE_FLAGS = new Set(['--role', '--route', '--agent'])

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
    const cfg = loaded.effective ?? loaded.merged
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

function usage() {
  return [
    '用法：',
    '  node scripts/agent-slots.mjs list [--role <role>] [--json]',
    '  node scripts/agent-slots.mjs show <slot> [--json]',
    '  node scripts/agent-slots.mjs resolve --route "<route>" [--json]',
    '  node scripts/agent-slots.mjs resolve --agent <旧名> [--json]',
    '  node scripts/agent-slots.mjs doctor [--json]',
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
  const r3 = parseRoute('ROUTE: research-glmflash;planner-699;\n  executor-ds;reviewer-699')
  t('向量3 两空格缩进续行合并解析', r3.items.length === 4 && r3.items[2].role === 'executor' && r3.items[2].provider === 'ds')
  // 向量4：无前缀
  const r4 = (() => { try { parseRoute('research-glm'); return null } catch (e) { return e } })()
  t('向量4 无 ROUTE: 前缀→UsageError', r4?.name === 'UsageError')
  // 向量5：同角色重复取最后一次并记 note
  const r5 = parseRoute('ROUTE: executor-glm;reviewer-699;executor-ds')
  t('向量5 同角色重复→取最后一次并写入 notes', r5.items.length === 2 && r5.items[0].role === 'executor' && r5.items[0].provider === 'ds' && r5.notes.length === 1 && r5.notes[0].includes('executor'))
  // 向量6：未知角色错误含合法角色列表
  const e6 = validateRoute(parseRoute('ROUTE: wizard-glm'), matrix).join('\n')
  t('向量6 未知角色→错误含合法角色列表', e6.includes('wizard') && ROLE_ORDER.every((r) => e6.includes(r)))
  // 向量7：角色不支持 provider 错误含可用 provider
  const e7 = validateRoute(parseRoute('ROUTE: vision-699'), matrix).join('\n')
  t('向量7 角色不支持 provider→错误含该角色可用 provider', e7.includes('699') && e7.includes('glmflash') && e7.includes('ds'))
  // 向量8：vision + 非多模态 provider
  const mNoVisionGlm = clone(matrix)
  mNoVisionGlm.roles.vision.providers = ['glm', 'glmflash']
  const e8 = validateRoute(parseRoute('ROUTE: vision-glm'), mNoVisionGlm).join('\n')
  t('向量8 vision+非多模态 glm→错误（多模态断言）', e8.includes('glm') && e8.includes('多模态'))
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
  // 向量11：D6 同族
  const cfg11 = compliantCfg()
  cfg11.agent_defaults.reviewer = 'ops-reviewer-glm-max'
  const f11 = doctorFindings(matrix, cfg11)
  t('向量11 doctor D6 实现/审核同族→FAIL', f11.some((f) => f.code === 'D6' && f.level === 'FAIL' && f.line.includes('审核族')))
  // 向量12：D5 vision 绑非多模态
  const cfg12 = compliantCfg()
  cfg12.providers.glmflash.multimodal = false
  const f12 = doctorFindings(matrix, cfg12)
  t('向量12 doctor D5 vision 绑非多模态→FAIL', f12.some((f) => f.code === 'D5' && f.level === 'FAIL' && f.line.includes('glmflash')))
  // 向量13：D4 缺绑定
  const cfg13 = compliantCfg()
  delete cfg13.agent_bindings['ops-executor-glm-high']
  const f13 = doctorFindings(matrix, cfg13)
  t('向量13 doctor D4 缺绑定→FAIL 且点名 slot', f13.some((f) => f.code === 'D4' && f.level === 'FAIL' && f.line.includes('ops-executor-glm-high')))
  // 向量14：全合规合成配置 → 零 finding
  const f14 = doctorFindings(matrix, compliantCfg())
  t('向量14 doctor 全合规合成配置→零 finding', f14.length === 0)
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

  // ── L4 新增向量（28–43）：旧名解析、窗口感知、未登记/假绿防线、doctor D9 ──
  const aliasMatrix = loadMatrix(MATRIX_PATH)
  const aliasCfg = () => {
    const c = compliantCfg()
    c.agent_defaults.executor = 'ops-executor-glm-high'
    c.temporary_windows = [{ id: 'tw-l4', reason: 'L4 自检窗', start: '2026-10-21', end: '2026-10-23', default_slots: { executor: 'ops-executor-ds-high' } }]
    return c
  }
  const aliasCfg22 = aliasCfg()
  const a28 = resolveAlias('ops-executor', aliasMatrix, aliasCfg22, '2026-10-22')
  t('向量28 ops-executor（2026-10-22 窗内）→ ops-executor-ds-high 且字段同构',
    a28?.alias === 'ops-executor' && a28?.role === 'executor' && a28?.slot === 'ops-executor-ds-high' && a28?.provider === 'ds' && a28?.model === 'model-of-ds' && a28?.level === 'high' && a28?.family === 'deepseek' && a28?.route_source === 'alias')
  const a29 = resolveAlias('ops-drafter', aliasMatrix, aliasCfg22, '2026-10-22')
  t('向量29 ops-drafter → ops-planner-699-max', a29?.slot === 'ops-planner-699-max' && a29?.role === 'planner')
  const a30 = resolveAlias('ops-auditor', aliasMatrix, aliasCfg22, '2026-10-22')
  t('向量30 ops-auditor → ops-reviewer-699-max', a30?.slot === 'ops-reviewer-699-max' && a30?.role === 'reviewer')
  const a31 = resolveAlias('ops-adjudicator', aliasMatrix, aliasCfg22, '2026-10-22')
  const exp31 = `ops-adjudicator-${aliasMatrix.roles.adjudicator.default}-${aliasMatrix.roles.adjudicator.level}`
  t('向量31 ops-adjudicator → 矩阵 default 派生槽名', a31?.slot === exp31 && a31?.role === 'adjudicator')
  const a32 = resolveAlias('ops-probe', aliasMatrix, aliasCfg22, '2026-10-22')
  t('向量32 ops-probe → ops-diagnostics-ds-max', a32?.slot === 'ops-diagnostics-ds-max' && a32?.role === 'diagnostics')
  const a33 = resolveAlias('ops-diagnostics', aliasMatrix, aliasCfg22, '2026-10-22')
  t('向量33 ops-diagnostics → ops-diagnostics-ds-max', a33?.slot === 'ops-diagnostics-ds-max' && a33?.role === 'diagnostics')
  const a34 = resolveAlias('ops-executor', aliasMatrix, aliasCfg22, '2026-10-25')
  t('向量34 ops-executor（2026-10-25 窗口后）→ ops-executor-glm-high（窗口感知）', a34?.slot === 'ops-executor-glm-high' && a34?.provider === 'glm')
  const a35 = resolveAlias('ops-gate1-k1', aliasMatrix, aliasCfg22, '2026-10-22')
  t('向量35 ops-gate1-k1 → ops-reviewer-699-max', a35?.slot === 'ops-reviewer-699-max')
  const a36 = resolveAlias('ops-gate1-k2', aliasMatrix, aliasCfg22, '2026-10-22')
  t('向量36 ops-gate1-k2 → ops-reviewer-zipoo-max', a36?.slot === 'ops-reviewer-zipoo-max')
  const a37 = resolveAlias('ops-gate1-k3', aliasMatrix, aliasCfg22, '2026-10-22')
  t('向量37 ops-gate1-k3 → ops-reviewer-yyx-max', a37?.slot === 'ops-reviewer-yyx-max')
  const a38 = resolveAlias('ops-gate1-d1', aliasMatrix, aliasCfg22, '2026-10-22')
  t('向量38 ops-gate1-d1 → ops-reviewer-ds-max', a38?.slot === 'ops-reviewer-ds-max')
  const a39 = resolveAlias('ops-nosuch', aliasMatrix, aliasCfg22, '2026-10-22')
  t('向量39 未登记旧名 ops-nosuch → null（不静默回落）', a39 === null)
  const cfg40 = aliasCfg()
  delete cfg40.agent_slots['ops-executor-ds-high']
  const a40 = resolveAlias('ops-executor', aliasMatrix, cfg40, '2026-10-22')
  t('向量40 解析到的 slot 不在 agent_slots → null（防假绿）', a40 === null)
  const cfg41 = aliasCfg()
  cfg41.agent_defaults.executor = 'ops-executor'
  const d9At = (today) => doctorFindings(aliasMatrix, cfg41, { today }).filter((f) => f.code === 'D9')
  const d41win = d9At('2026-10-22')
  const d41post = d9At('2026-10-25')
  t('向量41 doctor 旧名污染：窗口内(2026-10-22)建议 ops-executor-ds-high，窗口后(2026-10-25)建议 ops-executor-glmflash-high（矩阵 default 现为 glmflash，2026-10-26 裁决切换）',
    d41win.length === 1 && d41win[0].level === 'WARN' && d41win[0].line.includes('ops-executor-ds-high') &&
    d41post.length === 1 && d41post[0].level === 'WARN' && d41post[0].line.includes('ops-executor-glmflash-high'))
  const expectAliases = ['ops-executor', 'ops-drafter', 'ops-auditor', 'ops-adjudicator', 'ops-probe', 'ops-diagnostics', 'ops-gate1-k1', 'ops-gate1-k2', 'ops-gate1-k3', 'ops-gate1-d1']
  const actualAliases = Object.keys(aliasMatrix.aliases || {})
  t('向量42 真实矩阵 aliases 键集恰为 10 个旧名（逐字比对）',
    JSON.stringify(actualAliases) === JSON.stringify(expectAliases))
  const noAliasMatrix = clone(aliasMatrix)
  delete noAliasMatrix.aliases
  const a43 = resolveAlias('ops-executor', noAliasMatrix, aliasCfg(), '2026-10-22')
  const d9a = doctorFindings(noAliasMatrix, aliasCfg(), { today: '2026-10-22' }).filter((f) => f.code === 'D9a')
  t('向量43 矩阵缺 aliases → resolveAlias null 且 doctor 1 条 FAIL（D9a）',
    a43 === null && d9a.length === 1 && d9a[0].level === 'FAIL' && d9a[0].line.includes('aliases'))
  // 向量44（r2 W1）：兜底分支也必须按窗口推算；且建议值须真实存在（N2）。
  const d9fallback = (today, mutate) => {
    const c = aliasCfg()
    c.role_fallbacks.wizard = ['ops-executor'] // wizard 非真实角色 → view['wizard'] 缺失，走到 role 兜底
    if (mutate) mutate(c)
    return doctorFindings(aliasMatrix, c, { today }).filter((f) => f.code === 'D9' && f.line.includes('role_fallbacks.wizard'))
  }
  const d44win = d9fallback('2026-10-22')
  const slots44 = aliasCfg().agent_slots
  const d44miss = d9fallback('2026-10-25', (c) => { delete c.agent_slots['ops-executor-glm-high'] })
  // 直击兜底分支：窗口值本身是旧名 → cand 命中旧名 → role 视图缺失 → else 分支
  const d44else = d9fallback('2026-10-22', (c) => {
    c.agent_defaults.executor = 'ops-executor'
    c.temporary_windows = [{ id: 'tw-alias', reason: 'x', start: '2026-10-21', end: '2026-10-23', default_slots: { executor: 'ops-executor' } }]
  })
  t('向量44 D9 兜底分支：窗口内建议=窗口生效档且存在于 agent_slots；窗口值为旧名或 matrix default 指向不存在 slot → 不拼 matrix default、落通用措辞',
    d44win.length === 1 && d44win[0].line.includes('ops-executor-ds-high') && own(slots44, 'ops-executor-ds-high') &&
    !d44win[0].line.includes('ops-executor-glm-high') &&
    d44miss.length === 1 && !d44miss[0].line.includes('ops-executor-glm-high') && d44miss[0].line.includes('对应角色的生效默认档') &&
    d44else.length === 1 && !d44else[0].line.includes('ops-executor-glm-high') && d44else[0].line.includes('对应角色的生效默认档'))

  // 向量45/46（L26·账本 L636 ③）：resolve 现状特征固化（行为已存在，无新行为）。
  const e45 = validateRoute(parseRoute('ROUTE: reviewer2-ds'), matrix).join('\n')
  t('向量45 resolve 拒绝语义：ROUTE: reviewer2-ds → 错误含未知角色 reviewer2 与合法角色列表（现状固化，不新增解析支持）',
    e45.includes('未知角色「reviewer2」') && ROLE_ORDER.every((r) => e45.includes(r)))
  const s46 = resolveRoute(parseRoute('ROUTE: diagnostics-ds'), matrix, { providers: {}, agent_slots: {} })
  t('向量46 resolve 正常解析：ROUTE: diagnostics-ds → 校验零错误且解析到 ops-diagnostics-ds-max（现状固化）',
    validateRoute(parseRoute('ROUTE: diagnostics-ds'), matrix).length === 0 && s46.length === 1 && s46[0].slot === 'ops-diagnostics-ds-max')

  console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
  process.exit(fails === 0 ? 0 : 1)
}

// ── CLI ──
/** 命令级 flag 集合（W-new2 R2-5）：每个命令只接受自己那几面，跨命令误传即用法错。 */
const COMMAND_FLAGS = {
  list: new Set(['--role', '--json', '--self-test']),
  show: new Set(['--json', '--self-test']),
  resolve: new Set(['--route', '--agent', '--json', '--self-test']),
  doctor: new Set(['--json', '--self-test']),
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
    if (cmd === 'doctor') {
      const cfg = loadCfgOrExit()
      const matrix = loadMatrixOrExit()
      const findings = doctorFindings(matrix, cfg)
      if (json) {
        console.log(JSON.stringify(findings, null, 2))
        process.exit(findings.length ? 1 : 0)
      }
      for (const f of findings) console.log(`[${f.level}] ${f.code} ${f.line}`)
      const fail = findings.filter((f) => f.level === 'FAIL').length
      const warn = findings.filter((f) => f.level === 'WARN').length
      console.log(`doctor 汇总：FAIL ${fail}/WARN ${warn}/共 ${findings.length}——${findings.length ? '阻断（逐条点名见上）' : '通过'}`)
      process.exit(findings.length ? 1 : 0)
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
