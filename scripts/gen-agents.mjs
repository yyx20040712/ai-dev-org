/**
 * gen-agents —— 按逻辑矩阵生成待位代理模板（P4）。
 * 职责：
 *   ① templates/agents.matrix.json 装载与契约校验（九岗/七源/键序全等/默认与回退序/工具面/
 *      vision 多模态约束——startplan 文本应急例外见 B2 批 D-7a）；
 *   ② 由 role × provider 派生 slot（ops-<role>-<provider>-<level>；总数=矩阵派生，
 *      L19 起自检期望以独立算式 Σ roles[role].providers.length 复算，不写死）；
 *   ③ 以 templates/agents/_roles/<role>.md 为正文母本生成待位模板——frontmatter
 *      只写 `model: {{binding:<slot>}}` 占位与 `thoughtLevel`，不写真实模型值
 *      （03 §2 唯一来源规则；部署期由 deploy-check --sync-agents 按本机件渲染）；
 *   ④ 生成 templates/agents/.manifest.json（slot → sha256），写入后逐件回读核对；
 *      校验全过才落盘（全或无），既有 legacy 模板不覆盖、不删除。
 * 退出码口径单源=references/06 §5.8（此处不复写数字——语义映射，防双源漂移）。
 * 用法：node scripts/gen-agents.mjs [--dry-run] [--out <dir>] [--self-test] [--json]
 *       （flag 取值一律空格分隔，--x=y 等号形态=用法错拒收——cliFlag 单源立场）
 * 可 import 纯函数零副作用（isMain guard 惯例；自检向量禁动真实 templates/agents/）。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, mkdtempSync, rmSync, copyFileSync, appendFileSync, existsSync, renameSync, unlinkSync, chmodSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { SKILL_ROOT, readJson, cliFlag, UsageError } from './org-config.mjs'
import { readFrontmatterFields, sha256Text } from './deploy-check.mjs'

export const MATRIX_PATH = join(SKILL_ROOT, 'templates', 'agents.matrix.json')
export const ROLES_DIR = join(SKILL_ROOT, 'templates', 'agents', '_roles')
export const DEFAULT_OUT_DIR = join(SKILL_ROOT, 'templates', 'agents')
export const MANIFEST_NAME = '.manifest.json'
export const STAGING_PREFIX = '.staging-'

/** 固定九岗（顺序=矩阵声明序=slot 派生序；D1/自检共用；三审拆岗与键序重排=B2 批 D-1/D-2，
 *  键序与 loadMatrix 全等断言共用本常量——乱序矩阵在装载期即拒）。 */
export const ROLE_ORDER = ['research', 'planner', 'assembler', 'executor', 'tbreview', 'planreview', 'implreview', 'adjudicator', 'vision']
export const REQUIRED_LEVELS = ['low', 'high', 'max']
export const SLOT_NAME_RE = /^ops-(research|planner|assembler|executor|tbreview|planreview|implreview|adjudicator|vision)-([a-z0-9]+)-(low|high|max)$/

/** 角色→color 固定映射（§4.2：不得随机；与宿主子智能体列表配色一致）。 */
export const ROLE_COLORS = {
  research: 'cyan',
  planner: 'blue',
  assembler: 'orange',
  executor: 'green',
  tbreview: 'purple',
  planreview: 'yellow',
  implreview: 'purple',
  adjudicator: 'red',
  vision: 'magenta',
}

/** 角色→职责短语（description 用；只描述职责，不写模型显示名）。 */
export const ROLE_PURPOSES = {
  research: '只读检索与来源取证',
  planner: '只读方案权衡与推荐',
  assembler: '任务书装配与修入循环承接',
  executor: '按任务书实现、自验与诊断取证',
  tbreview: '派发前任务书审包只读审核',
  planreview: '只读规划审包对抗审核',
  implreview: '只读按包隔离一审与分级',
  adjudicator: '只读独立裁决与复算',
  vision: '只读视觉判据核对',
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

/** 矩阵装载 + 契约校验。任一不满足 → 抛错并点名（角色/provider/键路径）。 */
export function loadMatrix(path = MATRIX_PATH) {
  const m = readJson(path)
  if (!isPlainObject(m)) throw new Error(`矩阵 ${path} 须为 JSON 对象`)
  if (m.schemaVersion !== 1) throw new Error(`矩阵 ${path} schemaVersion 须为 1（收到 ${JSON.stringify(m.schemaVersion)}）`)
  if (!Array.isArray(m.levels) || m.levels.length !== REQUIRED_LEVELS.length || REQUIRED_LEVELS.some((l, i) => m.levels[i] !== l))
    throw new Error(`矩阵 ${path} levels 须恰为 ${REQUIRED_LEVELS.join('/')}（收到 ${JSON.stringify(m.levels)}）`)
  const providers = m.providers
  if (!isPlainObject(providers) || !Object.keys(providers).length) throw new Error(`矩阵 ${path} providers 须为非空对象`)
  for (const [name, p] of Object.entries(providers)) {
    // W4：短名参与 slot 名与写盘路径——形态收紧到 ^[a-z0-9]+$，禁点号/斜杠/反斜杠等路径字符
    if (!/^[a-z0-9]+$/.test(name)) throw new Error(`矩阵 providers 短名「${name}」不合形态 ^[a-z0-9]+$（短名参与 slot 名与写盘路径，禁含点号/斜杠/反斜杠等字符）`)
    if (!isPlainObject(p)) throw new Error(`矩阵 providers.${name} 须为对象`)
    if (typeof p.family !== 'string' || !p.family.trim()) throw new Error(`矩阵 providers.${name}.family 须为非空字符串`)
    if (typeof p.multimodal !== 'boolean') throw new Error(`矩阵 providers.${name}.multimodal 须为布尔值`)
  }
  const roles = m.roles
  if (!isPlainObject(roles)) throw new Error(`矩阵 ${path} roles 须为对象`)
  for (const role of ROLE_ORDER) if (!own(roles, role)) throw new Error(`矩阵 roles 缺角色「${role}」——${ROLE_ORDER.length} 岗须齐全（${ROLE_ORDER.join(', ')}）`)
  for (const role of Object.keys(roles)) if (!ROLE_ORDER.includes(role)) throw new Error(`矩阵 roles 含未知角色「${role}」——只允许 ${ROLE_ORDER.join(', ')}`)
  // B2 批 D-2 键序全等断言：roles 键声明序须与 ROLE_ORDER 逐键全等（乱序=装载期拒，
  // slot 派生序/面板卡序/constraint 面共用本序——防两序并存回潮；缺角色/未知角色先行点名）。
  if (JSON.stringify(Object.keys(roles)) !== JSON.stringify(ROLE_ORDER))
    throw new Error(`矩阵 ${path} roles 键序须与固定九岗序全等（期望 ${ROLE_ORDER.join('→')}，实际 ${Object.keys(roles).join('→')}）`)
  for (const [role, def] of Object.entries(roles)) {
    if (!isPlainObject(def)) throw new Error(`矩阵 roles.${role} 须为对象`)
    if (typeof def.title !== 'string' || !def.title.trim()) throw new Error(`矩阵 roles.${role}.title 须为非空字符串`)
    if (!REQUIRED_LEVELS.includes(def.level)) throw new Error(`矩阵 roles.${role}.level=${JSON.stringify(def.level)} 非法——须为 ${REQUIRED_LEVELS.join('/')}`)
    if (!Array.isArray(def.providers) || !def.providers.length) throw new Error(`矩阵 roles.${role}.providers 须为非空数组`)
    for (const p of def.providers) if (!own(providers, p)) throw new Error(`矩阵 roles.${role}.providers 引用未声明 provider「${p}」`)
    if (typeof def.default !== 'string' || !own(providers, def.default))
      throw new Error(`矩阵 roles.${role}.default「${def.default}」不在 providers 内`)
    if (!def.providers.includes(def.default)) throw new Error(`矩阵 roles.${role}.default「${def.default}」不在该角色 providers 内`)
    if (!Array.isArray(def.fallback) || !def.fallback.length) throw new Error(`矩阵 roles.${role}.fallback 须为非空数组`)
    if (def.fallback[0] !== def.default) throw new Error(`矩阵 roles.${role}.fallback 首元须为 default「${def.default}」（收到 ${JSON.stringify(def.fallback[0])}）`)
    for (const p of def.fallback) {
      if (!own(providers, p)) throw new Error(`矩阵 roles.${role}.fallback 引用未声明 provider「${p}」`)
      // B1：回退序只能落在该角色自己的候选 provider 内（全局表内有≠该角色可用）
      if (!def.providers.includes(p))
        throw new Error(`矩阵 roles.${role}.fallback 引用「${p}」不在该角色 providers 内（${role} 可用：${def.providers.join(', ')}）`)
    }
    if (!Array.isArray(def.tools) || !def.tools.length || def.tools.some((t) => typeof t !== 'string' || !t.trim()))
      throw new Error(`矩阵 roles.${role}.tools 须为非空字符串数组`)
    if (typeof def.readonly !== 'boolean') throw new Error(`矩阵 roles.${role}.readonly 须为布尔值`)
  }
  // B2 批 D-7a：vision 候选谓词=multimodal===true 或 provider 恰为 startplan（文本应急
  // 候选——multimodal:false 是实测事实不改；与 verify-docs/agent-slots/org-config 四面同款）。
  for (const p of roles.vision.providers)
    if (p !== 'startplan' && providers[p].multimodal !== true)
      throw new Error(`矩阵 roles.vision 的 provider「${p}」multimodal≠true——视觉岗只允许多模态源（startplan 例外=文本应急候选，不得承载图像判读）`)
  return m
}

/** 派生 slot 清单：按 role 声明序、provider 在角色 providers 中的顺序；level 取角色 level。 */
export function slotsFromMatrix(matrix) {
  const out = []
  for (const [role, def] of Object.entries(matrix?.roles || {})) {
    for (const provider of def.providers || []) {
      out.push({
        slot: `ops-${role}-${provider}-${def.level}`,
        role,
        provider,
        level: def.level,
        title: def.title,
        tools: [...(def.tools || [])],
        readonly: def.readonly === true,
      })
    }
  }
  return out
}

/** frontmatter 字段读取（name/description/tools/color 等非两字段项；model/thoughtLevel
 *  走 deploy-check 的 readFrontmatterFields 单源）。 */
function frontmatterBlock(text) {
  const lines = String(text).split('\n')
  const start = lines.findIndex((l) => l.trim() === '---')
  const end = start >= 0 ? lines.findIndex((l, i) => i > start && l.trim() === '---') : -1
  if (start < 0 || end < 0) return null
  return lines.slice(start + 1, end)
}

function frontmatterValue(text, key) {
  const block = frontmatterBlock(text)
  if (!block) return null
  const re = new RegExp(`^${key}:\\s*(.*?)\\s*$`)
  for (const line of block) {
    const m = re.exec(line)
    if (m) return m[1].replace(/^['"]|['"]$/g, '')
  }
  return null
}

/** 由角色正文生成待位模板：frontmatter（占位 model + thoughtLevel）+ 替换后的正文。
 *  占位替换：{{title}}/{{role}}/{{slot}} 直填；正文 {{binding}} → {{binding:<slot>}}，
 *  供 deploy-check 部署期按本机件渲染。残留任何非本 slot 的 {{…}} 占位 → 抛错。 */
export function buildSlotTemplate(matrix, slotDef, roleBody) {
  const roleDef = matrix?.roles?.[slotDef?.role]
  if (!roleDef) throw new Error(`角色「${slotDef?.role}」未在矩阵声明`)
  const color = ROLE_COLORS[slotDef.role]
  if (!color) throw new Error(`角色「${slotDef.role}」无固定 color 映射`)
  const purpose = ROLE_PURPOSES[slotDef.role]
  if (!purpose) throw new Error(`角色「${slotDef.role}」无职责短语映射`)
  const description = `${slotDef.title} ${slotDef.slot}——${purpose}`
  if (/[\r\n]/.test(description)) throw new Error(`description 须为单行（${slotDef.slot}）`)
  if ([...description].length > 60) throw new Error(`description 超 60 字符（${[...description].length}：${description}）`)
  const tools = (slotDef.tools || []).join(', ')
  const binding = `{{binding:${slotDef.slot}}}`
  const head = [
    '---',
    `name: ${slotDef.slot}`,
    `description: ${description}`,
    `tools: ${tools}`,
    `color: ${color}`,
    `model: ${binding}`,
    `thoughtLevel: ${slotDef.level}`,
    '---',
    '',
    '',
  ].join('\n')
  let body = String(roleBody ?? '').replace(/\r\n/g, '\n')
  body = body.replace(/\{\{title\}\}/g, slotDef.title)
  body = body.replace(/\{\{role\}\}/g, slotDef.role)
  body = body.replace(/\{\{slot\}\}/g, slotDef.slot)
  body = body.replace(/\{\{binding\}\}/g, binding)
  for (const m of body.matchAll(/\{\{[^{}]*\}\}/g))
    if (m[0] !== binding) throw new Error(`角色正文残留未替换占位 ${m[0]}（${slotDef.slot}）`)
  const out = head + body
  return out.endsWith('\n') ? out : out + '\n'
}

/** 生成物断言：返回错误数组（空=通过）。 */
export function validateGenerated(templateText, slotDef) {
  const errors = []
  const text = String(templateText ?? '')
  const block = frontmatterBlock(text)
  if (!block) return ['缺 frontmatter（首个 --- 到下一个 ---）']
  const fm = readFrontmatterFields(text)
  const name = frontmatterValue(text, 'name')
  if (name !== slotDef.slot) errors.push(`frontmatter name=${JSON.stringify(name)} ≠ slot=${slotDef.slot}`)
  if (block.join('\n').includes('$')) errors.push('frontmatter 含 $（绑定值只允许占位形态）')
  const expectedModel = `{{binding:${slotDef.slot}}}`
  if (!fm.hasModel) errors.push('frontmatter 缺 model 行')
  else if (fm.model !== expectedModel) errors.push(`frontmatter model=${JSON.stringify(fm.model)} 须为 ${expectedModel}`)
  if (fm.thoughtLevel !== slotDef.level) errors.push(`thoughtLevel=${JSON.stringify(fm.thoughtLevel)} ≠ 角色 level=${slotDef.level}`)
  const toolsRaw = frontmatterValue(text, 'tools')
  const tools = toolsRaw ? toolsRaw.split(',').map((s) => s.trim()).filter(Boolean) : []
  if (JSON.stringify(tools) !== JSON.stringify(slotDef.tools)) errors.push(`tools 与矩阵不一致（生成 ${JSON.stringify(tools)} ≠ 矩阵 ${JSON.stringify(slotDef.tools)}）`)
  // W2：frontmatter 闭合 --- 之后须空一行再起正文标题
  const raw = text.split('\n')
  const fmStart = raw.findIndex((l) => l.trim() === '---')
  const fmEnd = fmStart >= 0 ? raw.findIndex((l, i) => i > fmStart && l.trim() === '---') : -1
  if (fmEnd >= 0) {
    if (String(raw[fmEnd + 1] ?? '').trim() !== '') errors.push('frontmatter 闭合 --- 后须有空行（缺空行）')
    else if (!String(raw[fmEnd + 2] ?? '').startsWith('# ')) errors.push('frontmatter 空行后须紧跟 # 标题行')
  }
  const desc = frontmatterValue(text, 'description')
  if (!desc) errors.push('frontmatter 缺 description')
  else {
    if ([...desc].length > 60) errors.push(`description 长度 ${[...desc].length} > 60`)
    if (!desc.includes(slotDef.slot)) errors.push('description 未含 slot 名')
  }
  const lines = text.split('\n')
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  const last2 = lines.slice(-2)
  if (!String(last2[0] || '').startsWith('MODEL-SELF:')) errors.push('正文倒数第二行须为 MODEL-SELF:')
  if (!String(last2[1] || '').startsWith('LEDGER-CLAIM:')) errors.push('正文最后一行须为 LEDGER-CLAIM:')
  for (const m of text.matchAll(/\{\{[^{}]*\}\}/g))
    if (m[0] !== expectedModel) errors.push(`残留占位 ${m[0]}`)
  return [...new Set(errors)]
}

/** 清单构建：files 按 slot 名排序。`generatedAt` 必填且须为非空字符串（时间戳由调用方
 *  在调用点算一次后显式传入，本函数不读时钟）；缺失/null/非字符串/空串/纯空白 → 抛错并
 *  点名 generatedAt（一参调用属用法错误，不返回 null、不省略字段）。 */
const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function buildManifest(entries, generatedAt) {
  if (typeof generatedAt !== 'string' || !generatedAt.trim())
    throw new Error('buildManifest 的 generatedAt 必填且须为非空字符串（时间戳由调用方在调用点计算一次后传入，本函数不读时钟）')
  const seen = new Set()
  const files = {}
  const sorted = [...(entries || [])].sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0))
  for (const e of sorted) {
    if (!e || typeof e.slot !== 'string' || !e.slot) throw new Error('buildManifest 条目须含非空 slot')
    if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) throw new Error(`buildManifest 条目 ${e.slot} 的 sha256 非法`)
    if (seen.has(e.slot)) throw new Error(`buildManifest 条目重复：${e.slot}`)
    seen.add(e.slot)
    files[`${e.slot}.md`] = e.sha256
  }
  return { schemaVersion: 1, generatedAt, files }
}

/** 目标路径包含性判定（纯函数；W-new4：从 generateAgents 内联逻辑抽出以便直测）：
 *  `{ ok, path, reason }`——name 解析后必须落在 base 之内（不等于 base 本身）。
 *  越界（含 `../`、绝对路径、空名）一律 ok=false，reason 点名解析后的路径。 */
export function safeTargetPath(base, name) {
  const root = resolve(String(base))
  const target = resolve(join(root, String(name)))
  const ok = target !== root && target.startsWith(root + sep)
  return {
    ok,
    path: target,
    reason: ok ? '' : `目标路径越界（${target}）——须位于 ${root} 之内`,
  }
}

/** 生成全量模板（可注入目录；dryRun 不落盘）。三段式（W1）：
 *   ① 构建+校验：任一失败 → 0 件写入（phase=validate）；
 *   ② 暂存：全部写入 outDir 下的 `.staging-*` 子目录并回读核对 sha256——任一不符
 *      → 清理暂存、最终目录未动（phase=readback）；
 *   ③ 提交：逐件 rename 到最终路径（同盘原子），提交前逐件留存原内容备份，任一
 *      失败按备份回滚已提交件（phase=commit；回滚失败 phase=commit-rollback-failed，
 *      此时 rolledBack=false 并逐路径点名恢复失败项）。
 *   fault* 参数仅供自检做故障注入，生产 CLI 不传：
 *     faultAfterStage(staging)          暂存写完、回读前
 *     faultCommitAt(index)              提交循环到第 index 件时抛错
 *     faultBeforeRollback(committed)    提交失败后、回滚前（可对路径改权限造恢复失败）
 *     faultStagingCleanup               暂存清理强制失败（验 stagingLeftover 披露）
 *   写盘前对每个目标路径走 safeTargetPath 包含性判定（W4/W-new4）。 */
export function generateAgents({ matrix, roleDir = ROLES_DIR, outDir = DEFAULT_OUT_DIR, dryRun = false, generatedAt, faultAfterStage, faultCommitAt, faultBeforeRollback, faultStagingCleanup } = {}) {
  const stamp = generatedAt ?? todayLocal() // B2：日期只在调用点算一次，构建字节只由入参决定
  const slots = slotsFromMatrix(matrix)
  const errors = []
  // W4：生产路径复验 slot 名形态（不只依赖 loadMatrix 的声明期校验）
  for (const def of slots)
    if (!SLOT_NAME_RE.test(def.slot)) errors.push(`slot 名「${def.slot}」不合命名契约 ops-<role>-<provider>-<level>——拒绝进入写盘路径`)
  const bodies = new Map()
  const bodyErrors = new Map()
  for (const role of Object.keys(matrix?.roles || {})) {
    const p = join(roleDir, `${role}.md`)
    try {
      bodies.set(role, readFileSync(p, 'utf8'))
    } catch (e) {
      bodyErrors.set(role, `角色正文缺失 roles/${role}.md（${p}：${e.code || e.message}）`)
    }
  }
  const built = []
  for (const def of slots) {
    if (!bodies.has(def.role)) {
      errors.push(`${def.slot}.md 生成失败：${bodyErrors.get(def.role) || `角色正文缺失 roles/${def.role}.md`}`)
      continue
    }
    const roleBody = bodies.get(def.role)
    try {
      const text = buildSlotTemplate(matrix, def, roleBody)
      const vErrors = validateGenerated(text, def)
      if (vErrors.length) errors.push(`${def.slot}.md 校验失败：${vErrors.join('；')}`)
      else built.push({ ...def, text, sha256: sha256Text(text) })
    } catch (e) {
      errors.push(`${def.slot}.md 生成失败：${e.message}`)
    }
  }
  if (errors.length) return { slots, written: 0, errors, files: [], dryRun, phase: 'validate', staged: false, rolledBack: false, warnings: [] }
  const manifest = buildManifest(built.map((b) => ({ slot: b.slot, sha256: b.sha256 })), stamp)
  const manifestText = JSON.stringify(manifest, null, 2) + '\n'
  if (dryRun) return { slots, written: 0, errors: [], files: built.map((b) => `${b.slot}.md`), manifest, dryRun: true, phase: 'dry-run', staged: false, rolledBack: false, warnings: [] }

  // 写盘前包含性判定（W4/W-new4）：目标路径必须在 outDir 之内
  const base = resolve(outDir)
  const targets = []
  for (const b of built) {
    const name = `${b.slot}.md`
    const safe = safeTargetPath(base, name)
    if (!safe.ok) {
      errors.push(`slot ${b.slot} ${safe.reason}——拒绝写盘`)
      continue
    }
    targets.push({ name, finalPath: safe.path, text: b.text, sha256: b.sha256 })
  }
  const manifestSafe = safeTargetPath(base, MANIFEST_NAME)
  if (!manifestSafe.ok) errors.push(`清单 ${manifestSafe.reason}——拒绝写盘`)
  const manifestPath = manifestSafe.path
  if (errors.length) return { slots, written: 0, errors, files: [], manifest, dryRun, phase: 'validate', staged: false, rolledBack: false, warnings: [] }

  let staging = null
  /** 暂存清理（W-new1b）：返回 `{ ok, path, error }`；先记录路径再清句柄——失败时
   *  保留句柄（可重试）并由调用方写入 stagingLeftover 与 warn 级说明，禁静默。 */
  const dropStaging = () => {
    if (!staging) return { ok: true, path: null, error: null }
    const path = staging // 清句柄前先记录路径（失败披露与重试皆需要）
    let error = null
    if (faultStagingCleanup) error = new Error('faultStagingCleanup：注入的暂存清理失败')
    else {
      try { rmSync(path, { recursive: true, force: true }) } catch (e) { error = e }
    }
    if (error) return { ok: false, path, error } // 不清理 staging 句柄=可重试
    staging = null
    return { ok: true, path, error: null }
  }
  /** 清理结果→返回字段：失败时带 stagingLeftover 与 warn 级说明。 */
  const withCleanup = (result, cleanup) => {
    if (cleanup.ok) return result
    return {
      ...result,
      stagingLeftover: cleanup.path,
      warnings: [...(result.warnings || []), `[warn] 暂存目录清理失败（可人工删除后复跑）：${cleanup.path}：${cleanup.error.message}`],
    }
  }
  try {
    mkdirSync(base, { recursive: true })
    staging = mkdtempSync(join(base, STAGING_PREFIX))
    for (const t of targets) writeFileSync(join(staging, t.name), t.text)
    writeFileSync(join(staging, MANIFEST_NAME), manifestText)
    if (typeof faultAfterStage === 'function') faultAfterStage(staging)
    // ② 暂存回读核对（未提交，最终目录零改动）
    const readbackErrors = []
    for (const t of targets) {
      let got
      try {
        got = sha256Text(readFileSync(join(staging, t.name), 'utf8'))
      } catch (e) {
        readbackErrors.push(`${t.name} 暂存回读失败：${e.message}`)
        continue
      }
      if (got !== t.sha256) readbackErrors.push(`${t.name} 暂存回读 sha256 不符（期望 ${t.sha256}，实际 ${got}）`)
      else if (manifest.files[t.name] !== got) readbackErrors.push(`${t.name} 与 manifest 记录的 sha256 不一致`)
    }
    try {
      const back = JSON.parse(readFileSync(join(staging, MANIFEST_NAME), 'utf8'))
      if (JSON.stringify(back) !== JSON.stringify(manifest)) readbackErrors.push(`${MANIFEST_NAME} 暂存回读内容与生成物不一致`)
    } catch (e) {
      readbackErrors.push(`${MANIFEST_NAME} 暂存回读失败：${e.message}`)
    }
    if (readbackErrors.length)
      return withCleanup({ slots, written: 0, errors: readbackErrors, files: [], manifest, dryRun: false, phase: 'readback', staged: true, rolledBack: false, warnings: [] }, dropStaging())
    // ③ 提交段：逐件 rename；提交前留备份，失败回滚
    const backups = new Map()
    const committed = []
    try {
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i]
        if (typeof faultCommitAt === 'number' && i === faultCommitAt)
          throw new Error(`faultCommitAt：注入的提交失败（index=${i}，${t.name}）`)
        backups.set(t.finalPath, existsSync(t.finalPath) ? readFileSync(t.finalPath) : null)
        renameSync(join(staging, t.name), t.finalPath)
        committed.push(t.finalPath)
      }
      backups.set(manifestPath, existsSync(manifestPath) ? readFileSync(manifestPath) : null)
      renameSync(join(staging, MANIFEST_NAME), manifestPath)
      committed.push(manifestPath)
    } catch (e) {
      // W-new1a：回滚结果如实分类——全部恢复成功才 rolledBack=true
      if (typeof faultBeforeRollback === 'function') faultBeforeRollback(committed)
      const restoreErrors = []
      for (const p of [...committed].reverse()) {
        const bak = backups.get(p)
        try {
          if (bak === null) unlinkSync(p)
          else writeFileSync(p, bak)
        } catch (e2) {
          restoreErrors.push(`${p}：${e2.message}`)
        }
      }
      const rollbackOk = restoreErrors.length === 0
      const phase = rollbackOk ? 'commit' : 'commit-rollback-failed'
      const errors2 = [
        rollbackOk
          ? `提交段失败（已回滚 ${committed.length} 件）：${e.message}`
          : `提交段失败且回滚未完成（${restoreErrors.length}/${committed.length} 件恢复失败——最终目录可能残留半成品，须人工核查）：${e.message}`,
        ...restoreErrors.map((x) => `回滚恢复失败 ${x}`),
      ]
      return withCleanup({
        slots,
        written: 0,
        errors: errors2,
        files: [],
        manifest,
        dryRun: false,
        phase,
        staged: true,
        rolledBack: rollbackOk,
        warnings: [],
      }, dropStaging())
    }
    const cleanup = dropStaging()
    return withCleanup({
      slots,
      written: targets.length,
      errors: [],
      files: targets.map((t) => t.name),
      manifest,
      dryRun: false,
      phase: 'done',
      staged: true,
      rolledBack: false,
      warnings: [],
    }, cleanup)
  } catch (e) {
    return withCleanup({ slots, written: 0, errors: [`写盘暂存失败（最终目录未动）：${e.message}`], files: [], manifest, dryRun: false, phase: 'stage', staged: false, rolledBack: false, warnings: [] }, dropStaging())
  }
}

// ── --self-test（纯函数+临时目录 fixture；禁动真实 templates/agents/）──
function selfTest() {
  let fails = 0
  let n = 0
  const t = (name, cond) => (n++, console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`), cond || fails++)
  let matrix
  try {
    matrix = loadMatrix(MATRIX_PATH)
  } catch (e) {
    console.log(`FAIL 矩阵装载失败：${e.message}`)
    console.log('self-test 1 项失败')
    process.exit(1)
  }
  const slots = slotsFromMatrix(matrix)
  const bodies = new Map()
  try {
    for (const role of ROLE_ORDER) bodies.set(role, readFileSync(join(ROLES_DIR, `${role}.md`), 'utf8'))
  } catch (e) {
    console.log(`FAIL 角色正文装载失败：${e.message}`)
    console.log('self-test 1 项失败')
    process.exit(1)
  }
  const built = slots.map((def) => ({ def, text: buildSlotTemplate(matrix, def, bodies.get(def.role)) }))

  // L19 派生化：期望 slot 总数=独立算式复算（Σ roles[role].providers.length——verify-docs
  // 矩阵计数检查既有口径；禁用 slotsFromMatrix 输出长度作期望值：自指恒真=计数检查
  // 静默失效，r1-W1）。
  const expectedSlots = ROLE_ORDER.reduce((n, r) => n + (Array.isArray(matrix.roles[r]?.providers) ? matrix.roles[r].providers.length : 0), 0)

  // 向量1：slot 总数=独立算式期望
  t('向量1 slotsFromMatrix 总数=独立算式期望（Σ roles[role].providers.length）', slots.length === expectedSlots)
  // 向量2：各角色 slot 数=该角色矩阵候选数
  t('向量2 各角色 slot 数=矩阵分角色候选数', ROLE_ORDER.every((role) => {
    const want = Array.isArray(matrix.roles[role]?.providers) ? matrix.roles[role].providers.length : -1
    return slots.filter((s) => s.role === role).length === want
  }))
  // 向量3：命名合法
  t('向量3 slot 名全部匹配命名契约', slots.every((s) => SLOT_NAME_RE.test(s.slot)))
  // 向量4：model 占位且不含 $
  t('向量4 frontmatter model={{binding:<slot>}} 且不含 $', built.every(({ def, text }) => {
    const fm = readFrontmatterFields(text)
    const block = frontmatterBlock(text).join('\n')
    return fm.hasModel && fm.model === `{{binding:${def.slot}}}` && !block.includes('$')
  }))
  // 向量5：thoughtLevel/tools 与矩阵一致
  t('向量5 thoughtLevel 与 tools 逐字取自矩阵', built.every(({ def, text }) => {
    const fm = readFrontmatterFields(text)
    const tools = (frontmatterValue(text, 'tools') || '').split(',').map((s) => s.trim()).filter(Boolean)
    return fm.thoughtLevel === def.level && JSON.stringify(tools) === JSON.stringify(def.tools)
  }))
  // 向量6：正文无残留 title/role/slot 占位（binding:<slot> 除外）
  t('向量6 正文无残留占位（仅允许 {{binding:<slot>}}）', built.every(({ def, text }) => {
    const allowed = `{{binding:${def.slot}}}`
    return [...text.matchAll(/\{\{[^{}]*\}\}/g)].every((m) => m[0] === allowed)
  }))
  // 向量7：正文最后两行锚定
  t('向量7 正文最后两行为 MODEL-SELF/LEDGER-CLAIM', built.every(({ text }) => {
    const lines = text.split('\n')
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
    return lines.slice(-2)[0].startsWith('MODEL-SELF:') && lines.slice(-2)[1].startsWith('LEDGER-CLAIM:')
  }))
  // 向量8：description 单行 ≤60 字符且含 slot 名
  t('向量8 description 单行 ≤60 字符且含 slot 名', built.every(({ def, text }) => {
    const desc = frontmatterValue(text, 'description')
    return !!desc && !/[\r\n]/.test(desc) && [...desc].length <= 60 && desc.includes(def.slot)
  }))
  // 向量9：manifest 确定性与排序
  const entries = built.map(({ def, text }) => ({ slot: def.slot, sha256: sha256Text(text) })).reverse()
  const m1 = buildManifest(entries, '2026-10-22')
  const m2 = buildManifest(entries, '2026-10-22')
  const keys = Object.keys(m1.files)
  t('向量9 buildManifest 两次字节相同且条目按 slot 排序', JSON.stringify(m1) === JSON.stringify(m2) && keys.length === expectedSlots && keys.every((k, i) => i === 0 || keys[i - 1] < k))
  // 向量10：非法矩阵逐项抛错并点名
  const base = JSON.parse(JSON.stringify(matrix))
  const badCases = []
  const c1 = JSON.parse(JSON.stringify(base)); c1.roles.bogus = JSON.parse(JSON.stringify(c1.roles.research)); badCases.push(['未知角色', c1, 'bogus'])
  const c2 = JSON.parse(JSON.stringify(base)); c2.roles.executor.providers.push('ghost'); badCases.push(['未声明 provider', c2, 'ghost'])
  const c3 = JSON.parse(JSON.stringify(base)); c3.roles.planner.default = 'ghost'; badCases.push(['default 不在 providers', c3, 'ghost'])
  const c4 = JSON.parse(JSON.stringify(base)); c4.roles.vision.providers.push('glm'); badCases.push(['vision 含非多模态', c4, 'glm'])
  let badOk = true
  for (const [label, obj, needle] of badCases) {
    const fx = mkdtempSync(join(tmpdir(), 'gen-agents-bad-'))
    try {
      const p = join(fx, 'matrix.json')
      writeFileSync(p, JSON.stringify(obj))
      let err = null
      try { loadMatrix(p) } catch (e) { err = e }
      if (!err || !String(err.message).includes(needle)) { badOk = false; console.log(`FAIL 向量10 子项「${label}」未按预期抛错点名「${needle}」（实际：${err ? err.message : '未抛'}）`) }
    } finally { rmSync(fx, { recursive: true, force: true }) }
  }
  t('向量10 非法矩阵（未知角色/未声明 provider/default 不在 providers/vision 非多模态）→ 抛错点名', badOk)
  // 向量10b（B2 批 D-2）：roles 键序全等断言——合法九岗集但键序颠倒两位的夹具，装载期
  // 抛错并点名「键序」（乱序负例；正例=真实矩阵装载在本函数入口已覆盖）。
  {
    const cOrder = JSON.parse(JSON.stringify(matrix))
    const ks = Object.keys(cOrder.roles)
    ;[ks[3], ks[4]] = [ks[4], ks[3]]
    cOrder.roles = Object.fromEntries(ks.map((k) => [k, cOrder.roles[k]]))
    const fxOrder = mkdtempSync(join(tmpdir(), 'gen-agents-order-'))
    try {
      const pOrd = join(fxOrder, 'matrix.json')
      writeFileSync(pOrd, JSON.stringify(cOrder))
      let eOrd = null
      try { loadMatrix(pOrd) } catch (e) { eOrd = e }
      t('向量10b roles 键序乱序（合法岗集·两位颠倒）→ loadMatrix 抛错并点名键序全等',
        !!eOrd && String(eOrd.message).includes('键序') && String(eOrd.message).includes('research'))
    } finally { rmSync(fxOrder, { recursive: true, force: true }) }
  }
  // 向量11：dry-run 不产生文件
  const fxDry = mkdtempSync(join(tmpdir(), 'gen-agents-dry-'))
  try {
    const r = generateAgents({ matrix, roleDir: ROLES_DIR, outDir: fxDry, dryRun: true, generatedAt: '2026-10-22' })
    t('向量11 --dry-run 在临时目录不产生任何文件', r.written === 0 && r.errors.length === 0 && readdirSync(fxDry).length === 0)
  } finally { rmSync(fxDry, { recursive: true, force: true }) }
  // 向量12：写入 N=期望+1 件（含 manifest）并回读 hash
  const fxWrite = mkdtempSync(join(tmpdir(), 'gen-agents-write-'))
  try {
    const r = generateAgents({ matrix, roleDir: ROLES_DIR, outDir: fxWrite, generatedAt: '2026-10-22' })
    const files = readdirSync(fxWrite)
    const manifest = JSON.parse(readFileSync(join(fxWrite, '.manifest.json'), 'utf8'))
    const hashOk = Object.entries(manifest.files).every(([name, hash]) => sha256Text(readFileSync(join(fxWrite, name), 'utf8')) === hash)
    t('向量12 写入 fixture=期望+1 件且每件回读 sha256=manifest', r.written === expectedSlots && r.errors.length === 0 && files.length === expectedSlots + 1 && hashOk)
  } finally { rmSync(fxWrite, { recursive: true, force: true }) }
  // 向量13：全或无（注入未替换占位 → 0 件写入）
  const fxRole = mkdtempSync(join(tmpdir(), 'gen-agents-role-'))
  const fxOut = mkdtempSync(join(tmpdir(), 'gen-agents-out-'))
  try {
    for (const role of ROLE_ORDER) copyFileSync(join(ROLES_DIR, `${role}.md`), join(fxRole, `${role}.md`))
    appendFileSync(join(fxRole, 'executor.md'), '\n{{missing}}\n')
    const r = generateAgents({ matrix, roleDir: fxRole, outDir: fxOut, generatedAt: '2026-10-22' })
    t('向量13 角色正文残留占位 → 0 件写入且返回非零语义（errors 非空）', r.written === 0 && r.errors.length > 0 && readdirSync(fxOut).length === 0)
  } finally {
    rmSync(fxRole, { recursive: true, force: true })
    rmSync(fxOut, { recursive: true, force: true })
  }
  // 向量14：legacy 模板保护（既有同名非新式文件不动）
  const fxLegacy = mkdtempSync(join(tmpdir(), 'gen-agents-legacy-'))
  try {
    writeFileSync(join(fxLegacy, 'ops-executor.md'), 'LEGACY-CONTENT\n')
    const r = generateAgents({ matrix, roleDir: ROLES_DIR, outDir: fxLegacy, generatedAt: '2026-10-22' })
    t('向量14 既有 legacy 模板不覆盖/不删除（生成后原内容不变）', r.errors.length === 0 && readFileSync(join(fxLegacy, 'ops-executor.md'), 'utf8') === 'LEGACY-CONTENT\n' && readdirSync(fxLegacy).length === expectedSlots + 2)
  } finally { rmSync(fxLegacy, { recursive: true, force: true }) }
  // 向量15：color 固定映射
  t('向量15 color 按角色固定映射', built.every(({ def, text }) => frontmatterValue(text, 'color') === ROLE_COLORS[def.role]))

  // ── 返工轮 1 新增向量（16–26）──
  const loadFail = (obj) => {
    const fx = mkdtempSync(join(tmpdir(), 'gen-agents-load-'))
    try {
      const p = join(fx, 'matrix.json')
      writeFileSync(p, JSON.stringify(obj))
      try { loadMatrix(p); return null } catch (e) { return e }
    } finally { rmSync(fx, { recursive: true, force: true }) }
  }
  // 向量16（B1）：fallback 元素须属于该角色 providers（全局表内有≠该角色可用）
  const c16 = JSON.parse(JSON.stringify(matrix))
  c16.roles.vision.fallback = ['glmflash', 'glm']
  const e16 = loadFail(c16)
  t('向量16 vision.fallback 含角色外 provider「glm」→ loadMatrix 抛错并点名角色与 provider',
    !!e16 && String(e16.message).includes('roles.vision.fallback') && String(e16.message).includes('「glm」'))
  // 向量17（W-A R3）：generatedAt 必填且须为非空字符串——一参/显式 undefined/null/非字符串/
  //  空串/纯空白一律抛错并点名 generatedAt；不返回 null、不读时钟（Date 被替换为抛错实现后，
  //  仍须得到 generatedAt 校验错而非时钟错）
  const RealDate17 = globalThis.Date
  const invalid17 = [
    ['一参调用', undefined, false],
    ['显式 undefined', undefined, true],
    ['null', null, true],
    ['数字', 123, true],
    ['空串', '', true],
    ['纯空白', '   ', true],
  ]
  let ok17 = true
  try {
    globalThis.Date = function () { throw new Error('buildManifest 不得读时钟') }
    for (const [label, value, passArg] of invalid17) {
      let err = null
      let ret
      try {
        ret = passArg ? buildManifest(entries, value) : buildManifest(entries)
      } catch (e) { err = e }
      const reason = err
        ? (String(err.message).includes('generatedAt') ? '' : `错误未点名 generatedAt（${err.message}）`)
        : `未抛错（返回 ${JSON.stringify(ret)}）`
      if (reason) { ok17 = false; console.log(`FAIL 向量17 子项「${label}」：${reason}`) }
    }
  } finally { globalThis.Date = RealDate17 }
  t('向量17 buildManifest 一参/null/非字符串/空串/纯空白 → 抛错点名 generatedAt（不返回 null、不读时钟）', ok17)
  // 向量18（B2）：同一 generatedAt 两次构建字节相同（含 generatedAt 落位）
  const b18a = JSON.stringify(buildManifest(entries, '2026-10-22'))
  const b18b = JSON.stringify(buildManifest(entries, '2026-10-22'))
  t('向量18 buildManifest 同一 generatedAt 两次构建字节相同', b18a === b18b && b18a.includes('"generatedAt":"2026-10-22"'))
  // 向量19（W2）：frontmatter 与正文之间有空行（--- 空行 # 标题）
  const broken19 = built[0].text.replace('---\n\n# ', '---\n# ')
  t('向量19 生成物含 ---\\n\\n# 空行分隔（缺空行被 validateGenerated 拦下）',
    built.every(({ text }) => text.includes('---\n\n# '))
    && validateGenerated(broken19, built[0].def).some((x) => x.includes('空行')))
  // 向量20（W4）：provider 短名形态 ^[a-z0-9]+$（路径字符一律拒）
  const shapeBad = ['../evil', 'ds/x', 'a.b'].map((name) => {
    const c = JSON.parse(JSON.stringify(matrix))
    c.providers[name] = { display: 'x', family: 'x', multimodal: false }
    const err = loadFail(c)
    return { name, ok: !!err && String(err.message).includes(name) }
  })
  t('向量20 provider 短名含 ../ 或 / 或 . → loadMatrix 抛错并点名',
    shapeBad.every((x) => x.ok))
  // 向量21（W4）：非法 provider/slot 名被命名契约拒绝（不落任何件；注意：本向量只证
  //  命名契约拒绝，不含性拦截由向量27 的 safeTargetPath 直测负责，不再声称已实测越界拦截）
  const evilMatrix = {
    schemaVersion: 1,
    levels: REQUIRED_LEVELS,
    providers: { evil: { display: 'e', family: 'e', multimodal: false } },
    roles: { research: { title: '调研岗', level: 'high', providers: ['../evil'], default: '../evil', fallback: ['../evil'], tools: ['Read'], readonly: true } },
  }
  const fxEvil = mkdtempSync(join(tmpdir(), 'gen-agents-evil-'))
  let r21
  try {
    r21 = generateAgents({ matrix: evilMatrix, roleDir: ROLES_DIR, outDir: fxEvil, generatedAt: '2026-10-22' })
    t('向量21 非法 provider/slot 名被命名契约拒绝（0 件写入，fixture 目录空）',
      r21.written === 0 && r21.phase === 'validate' && r21.errors.some((e) => e.includes('不合命名契约')) && readdirSync(fxEvil).length === 0)
  } finally { rmSync(fxEvil, { recursive: true, force: true }) }
  // 向量22（W1/W5）：写盘失败（父级是文件）→ errors 非空、written=0、无新增半成品
  const fxBlock = mkdtempSync(join(tmpdir(), 'gen-agents-block-'))
  try {
    const blocker = join(fxBlock, 'blocker')
    writeFileSync(blocker, 'x')
    const blockedOut = join(blocker, 'nested')
    const r22 = generateAgents({ matrix, roleDir: ROLES_DIR, outDir: blockedOut, generatedAt: '2026-10-22' })
    t('向量22 目标不可建（父级是文件）→ errors 非空/written=0/未产生最终目录',
      r22.written === 0 && r22.errors.length > 0 && r22.phase === 'stage' && !existsSync(blockedOut))
  } finally { rmSync(fxBlock, { recursive: true, force: true }) }
  // 向量23（W1）：暂存回读 sha256 不符（故障注入）→ 0 件提交、最终目录零新增、暂存清理
  const fxFault = mkdtempSync(join(tmpdir(), 'gen-agents-fault-'))
  try {
    const r23 = generateAgents({
      matrix,
      roleDir: ROLES_DIR,
      outDir: fxFault,
      generatedAt: '2026-10-22',
      faultAfterStage: (staging) => {
        const victim = readdirSync(staging).find((n) => n.endsWith('.md'))
        writeFileSync(join(staging, victim), 'CORRUPTED\n')
      },
    })
    t('向量23 暂存回读 sha256 不符 → errors 非空/written=0/最终目录零新增/暂存已清理',
      r23.written === 0 && r23.errors.length > 0 && r23.phase === 'readback' && readdirSync(fxFault).length === 0)
  } finally { rmSync(fxFault, { recursive: true, force: true }) }
  // 向量24（W5）：CLI 失败场景的真实进程退出码（spawnSync）
  const scriptPath = fileURLToPath(import.meta.url) // ESM 无 __filename，fileURLToPath 等价于 __filename
  const fxCliFail = mkdtempSync(join(tmpdir(), 'gen-agents-cli-fail-'))
  try {
    const cliBlocker = join(fxCliFail, 'blocker')
    writeFileSync(cliBlocker, 'x')
    const s24 = spawnSync(process.execPath, [scriptPath, '--out', join(cliBlocker, 'nested')], { cwd: SKILL_ROOT, encoding: 'utf8' })
    const out24 = `${s24.stdout || ''}${s24.stderr || ''}`
    t('向量24 CLI 写盘失败（--out 父级为文件）→ 进程 status≠0 且输出含 [FAIL] 与暂存失败语义',
      s24.status !== 0 && out24.includes('[FAIL]') && out24.includes('最终目录未动'))
  } finally { rmSync(fxCliFail, { recursive: true, force: true }) }
  // 向量25（W5）：CLI 正常写入 → status=0 且 fixture 期望+1 件（暂存目录已清理）
  const fxCliOk = mkdtempSync(join(tmpdir(), 'gen-agents-cli-ok-'))
  try {
    const s25 = spawnSync(process.execPath, [scriptPath, '--out', fxCliOk], { cwd: SKILL_ROOT, encoding: 'utf8' })
    t('向量25 CLI 正常写入 → status=0 且 fixture 期望+1 件', s25.status === 0 && readdirSync(fxCliOk).length === expectedSlots + 1)
  } finally { rmSync(fxCliOk, { recursive: true, force: true }) }
  // 向量26（W3/W-new3 R2-8）：未识别 flag 拒收——spawn 追加 --out 临时 fixture 与
  //  --dry-run，确保拒收若回归也只会落临时目录，不会碰真实 templates/agents/
  const fxBogus = mkdtempSync(join(tmpdir(), 'gen-agents-bogus-'))
  try {
    const s26 = spawnSync(process.execPath, [scriptPath, '--out', fxBogus, '--dry-run', '--bogus'], { cwd: SKILL_ROOT, encoding: 'utf8' })
    const out26 = `${s26.stdout || ''}${s26.stderr || ''}`
    t('向量26 CLI 未知 flag --bogus（--out 临时目录 + --dry-run 隔离）→ status=1 且输出 [用法错] 并点名',
      s26.status === 1 && out26.includes('[用法错]') && out26.includes('--bogus') && readdirSync(fxBogus).length === 0)
  } finally { rmSync(fxBogus, { recursive: true, force: true }) }
  // 向量27（W-new4 R2-9）：safeTargetPath 包含性直测（真正的 .. 路径段）
  const safeBase = join(tmpdir(), 'gen-agents-safe-base')
  const safeOk = safeTargetPath(safeBase, 'ops-executor-glm-high.md')
  t('向量27 safeTargetPath：../evil.md 与 a/../../b.md → ok=false；正常 slot 名 → ok=true 且 path 在 base 内',
    safeTargetPath(safeBase, '../evil.md').ok === false
    && safeTargetPath(safeBase, 'a/../../b.md').ok === false
    && safeOk.ok === true
    && safeOk.path === join(safeBase, 'ops-executor-glm-high.md')
    && safeTargetPath(safeBase, '../evil.md').reason.includes('越界'))
  // 向量28（W-new1a）：提交失败注入（faultCommitAt）→ 已提交件按备份回滚成功、最终目录还原
  const fxCommit = mkdtempSync(join(tmpdir(), 'gen-agents-commit-'))
  try {
    writeFileSync(join(fxCommit, 'ops-executor-glm-high.md'), 'PRE-EXISTING\n')
    writeFileSync(join(fxCommit, '.manifest.json'), '{"pre":1}\n')
    const r28 = generateAgents({ matrix, roleDir: ROLES_DIR, outDir: fxCommit, generatedAt: '2026-10-22', faultCommitAt: 5 })
    const files28 = readdirSync(fxCommit).sort()
    t('向量28 提交中途失败注入 → rolledBack=true/phase=commit/written=0，最终目录还原为原两件',
      r28.written === 0 && r28.errors.length > 0 && r28.phase === 'commit' && r28.rolledBack === true
      && JSON.stringify(files28) === JSON.stringify(['.manifest.json', 'ops-executor-glm-high.md'])
      && readFileSync(join(fxCommit, 'ops-executor-glm-high.md'), 'utf8') === 'PRE-EXISTING\n'
      && readFileSync(join(fxCommit, '.manifest.json'), 'utf8') === '{"pre":1}\n')
  } finally { rmSync(fxCommit, { recursive: true, force: true }) }
  // 向量29（W-new1a）：回滚失败注入（faultBeforeRollback 把恢复目标改成 0444——真实
  //  EACCES，非布尔假动作）→ rolledBack=false 且 errors 逐路径点名恢复失败项
  const fxRbFail = mkdtempSync(join(tmpdir(), 'gen-agents-rb-fail-'))
  try {
    const victimPath = join(fxRbFail, 'ops-executor-glm-high.md')
    writeFileSync(victimPath, 'PRE-EXISTING-RO\n')
    const r29 = generateAgents({
      matrix,
      roleDir: ROLES_DIR,
      outDir: fxRbFail,
      generatedAt: '2026-10-22',
      faultCommitAt: 20,
      faultBeforeRollback: (committed) => {
        const victim = committed.find((p) => p === victimPath)
        if (victim) chmodSync(victim, 0o444) // 恢复路径不可写=回滚必失败（真实权限错误）
      },
    })
    try { chmodSync(victimPath, 0o644) } catch { /* 目录可写时删除不受影响 */ }
    t('向量29 回滚失败注入（恢复路径 0444）→ rolledBack=false/phase=commit-rollback-failed/errors 点名恢复失败路径',
      r29.written === 0 && r29.rolledBack === false && r29.phase === 'commit-rollback-failed'
      && r29.errors.some((e) => e.includes('回滚未完成'))
      && r29.errors.some((e) => e.includes('回滚恢复失败') && e.includes(victimPath)))
  } finally { rmSync(fxRbFail, { recursive: true, force: true }) }
  // 向量30（W-new1b）：暂存清理失败注入 → 提交成功但返回 stagingLeftover 与 warn 级说明
  const fxClean = mkdtempSync(join(tmpdir(), 'gen-agents-clean-fail-'))
  let leftoverPath = null
  try {
    const r30 = generateAgents({ matrix, roleDir: ROLES_DIR, outDir: fxClean, generatedAt: '2026-10-22', faultStagingCleanup: true })
    leftoverPath = r30.stagingLeftover || null
    t('向量30 暂存清理失败注入 → 提交成功仍带 stagingLeftover 与 warn 级说明（禁静默）',
      r30.written === expectedSlots && r30.errors.length === 0 && typeof r30.stagingLeftover === 'string'
      && r30.stagingLeftover.includes('.staging-') && (r30.warnings || []).some((w) => w.startsWith('[warn]') && w.includes('清理失败')))
  } finally {
    if (leftoverPath) rmSync(leftoverPath, { recursive: true, force: true })
    rmSync(fxClean, { recursive: true, force: true })
  }

  // 向量31（W-B R3）：回读失败 + 暂存清理失败双重故障注入 → errors 非空、written=0、
  //  stagingLeftover 在场、warnings 含清理失败说明；CLI 汇总措辞按残留状态分派，
  //  同一输出禁同时出现「暂存已清理」与清理失败
  const fxDouble = mkdtempSync(join(tmpdir(), 'gen-agents-double-fail-'))
  let leftover31 = null
  try {
    const r31 = generateAgents({
      matrix,
      roleDir: ROLES_DIR,
      outDir: fxDouble,
      generatedAt: '2026-10-22',
      faultAfterStage: (staging) => {
        const victim = readdirSync(staging).find((n) => n.endsWith('.md'))
        writeFileSync(join(staging, victim), 'CORRUPTED\n')
      },
      faultStagingCleanup: true,
    })
    leftover31 = r31.stagingLeftover || null
    const note31 = typeof readbackFailureSummary === 'function' ? readbackFailureSummary(r31) : ''
    const noteClean31 = typeof readbackFailureSummary === 'function' ? readbackFailureSummary({ stagingLeftover: null }) : ''
    const bodyOk31 = r31.errors.length > 0 && r31.written === 0 && r31.phase === 'readback'
      && typeof r31.stagingLeftover === 'string' && r31.stagingLeftover.includes('.staging-')
      && (r31.warnings || []).some((w) => w.startsWith('[warn]') && w.includes('清理失败'))
    const wordingOk31 = note31.includes('暂存目录残留') && !note31.includes('暂存已清理')
      && noteClean31.includes('暂存已清理') && !noteClean31.includes('暂存目录残留')
      && !(`${note31}\n${(r31.warnings || []).join('\n')}`.includes('暂存已清理') && (r31.warnings || []).some((w) => w.includes('清理失败')))
    if (!wordingOk31) console.log(`FAIL 向量31 措辞子项：有残留=${JSON.stringify(note31)}，无残留=${JSON.stringify(noteClean31)}`)
    t('向量31 回读失败+暂存清理失败双重注入 → errors 非空/written=0/stagingLeftover 在场/warnings 含清理失败；汇总措辞按残留状态分派且禁互斥并存',
      bodyOk31 && wordingOk31)
  } finally {
    if (leftover31) rmSync(leftover31, { recursive: true, force: true })
    rmSync(fxDouble, { recursive: true, force: true })
  }

  // 向量32/33（装配岗批 D-3）：assembler 角色缺席/在场两向量——夹具矩阵派生自真实矩阵
  // 深拷贝，禁动真实 templates/agents.matrix.json。缺席=loadMatrix 抛错点名缺角色与
  // assembler（语义=ROLE_ORDER 全在场，错误消息按常量派生）；在场（合成 Kimi 三源条目）=
  // loadMatrix 通过（返回 null）。
  const cAsmAbsent = JSON.parse(JSON.stringify(matrix))
  delete cAsmAbsent.roles.assembler
  const eAsmAbsent = loadFail(cAsmAbsent)
  t('向量32 夹具矩阵缺 assembler → loadMatrix 抛错并点名缺角色 assembler',
    !!eAsmAbsent && String(eAsmAbsent.message).includes('缺角色') && String(eAsmAbsent.message).includes('assembler'))
  const cAsmPresent = JSON.parse(JSON.stringify(matrix))
  cAsmPresent.roles.assembler = {
    title: '任务书装配岗',
    level: 'max',
    providers: ['kimia', 'kimib', 'kimic'],
    default: 'kimia',
    fallback: ['kimia', 'kimib', 'kimic'],
    tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'BashOutput', 'KillShell'],
    readonly: false,
  }
  const eAsmPresent = loadFail(cAsmPresent)
  t('向量33 夹具矩阵含 assembler（Kimi 三源合成条目）→ loadMatrix 通过', eAsmPresent === null)

  console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
  process.exit(fails === 0 ? 0 : 1)
}

// ── CLI ──
const ALLOWED_FLAGS = new Set(['--dry-run', '--out', '--self-test', '--json'])

/** W-B：readback 失败汇总措辞按 stagingLeftover 分派——有残留说「暂存目录残留（见下）」，
 *  无残留才说「暂存已清理」；禁同一输出里既说已清理又说清理失败。 */
function readbackFailureSummary(result) {
  return result?.stagingLeftover
    ? '暂存回读核对失败：暂存目录残留（见下），最终目录未动（0 件写入）'
    : '暂存回读核对失败：暂存已清理，最终目录未动（0 件写入）'
}

/** W3：未识别 flag 一律拒收（白名单外的 --* token 不得静默丢弃）。等号形态仍走
 *  cliFlag 单源拒收。 */
function rejectUnknownFlags(argv) {
  for (const token of argv) {
    if (!token.startsWith('--')) continue
    const eq = token.indexOf('=')
    const name = eq >= 0 ? token.slice(0, eq) : token
    if (!ALLOWED_FLAGS.has(name))
      throw new UsageError(`未识别的 flag「${token}」——本命令合法 flag：${[...ALLOWED_FLAGS].join(', ')}（flag 取值一律空格分隔）`)
    if (eq >= 0) cliFlag(argv, name) // 等号形态拒收
  }
}

const isMain =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) {
  const argv = process.argv.slice(2)
  try {
    rejectUnknownFlags(argv)
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`[用法错] ${e.message}`)
      process.exit(1)
    }
    throw e
  }
  if (argv.includes('--self-test')) selfTest()
  const dryRun = argv.includes('--dry-run')
  const json = argv.includes('--json')
  try {
    const outArg = cliFlag(argv, '--out')
    const outDir = outArg ? resolve(outArg) : DEFAULT_OUT_DIR
    let matrix
    try {
      matrix = loadMatrix(MATRIX_PATH)
    } catch (e) {
      console.error(`[装载错] 逻辑矩阵装载失败：${e.message}`)
      process.exit(3)
    }
    const result = generateAgents({ matrix, roleDir: ROLES_DIR, outDir, dryRun })
    if (json) {
      const payload = { slots: result.slots, written: result.written, errors: result.errors }
      if ((result.warnings || []).length) payload.warnings = result.warnings
      if (result.stagingLeftover) payload.stagingLeftover = result.stagingLeftover
      console.log(JSON.stringify(payload, null, 2))
      process.exit(result.errors.length ? 1 : 0)
    }
    if (dryRun) {
      if (result.errors.length) {
        for (const e of result.errors) console.error(`[FAIL] ${e}`)
        console.error(`[gen-agents] dry-run 汇总：${result.slots.length} 个 slot 预检失败（未写盘）`)
        process.exit(1)
      }
      for (const def of result.slots) console.log(`[dry-run] ${def.slot}.md`)
      console.log(`[gen-agents] dry-run 汇总：${result.slots.length} 个 slot 模板将写入 ${outDir}（未写盘）`)
      process.exit(0)
    }
    if (result.errors.length) {
      for (const e of result.errors) console.error(`[FAIL] ${e}`)
      // W1/W-new1a：汇总措辞与实际语义对齐（回滚失败绝不打印「已按备份回滚」）
      const why = result.phase === 'validate'
        ? '前置校验失败：0 件写入（未写盘）'
        : result.phase === 'stage'
          ? '写盘暂存失败：最终目录未动（0 件写入）'
          : result.phase === 'readback'
            ? readbackFailureSummary(result)
            : result.phase === 'commit'
              ? `提交段失败：已按备份回滚（0 件生效${result.stagingLeftover ? '；暂存目录残留见上' : ''}）`
              : '提交段失败且回滚未完成：最终目录可能残留半成品，须人工核查（0 件生效）'
      console.error(`[gen-agents] 汇总：写入 0/${result.slots.length}——${why}`)
      for (const w of result.warnings || []) console.error(w)
      process.exit(1)
    }
    console.log(`[gen-agents] 已写入 ${result.written}/${result.slots.length} 个模板与 .manifest.json → ${outDir}`)
    // W-new1b：成功提交但暂存清理失败必须披露（禁报成成功无提示）
    for (const w of result.warnings || []) console.error(w)
    process.exit(0)
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`[用法错] ${e.message}`)
      process.exit(1)
    }
    throw e
  }
}
