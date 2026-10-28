/**
 * 部署自检/首装（v1.7.3 部署能力批）——新机一键体检+可安全自动化项的安装。
 * 退出码口径单源=references/06 §5.8（不复写）。
 * 七项检查（逐项输出 [ok]/[warn]/[FAIL] 主题——处置指引）：
 *   ① node-major   process 主版本 ∈ org-config supported_node.forbid_major → FAIL
 *                  （判据读配置禁硬编码，W-12 同律）
 *   ② skill-files  必备三件存在（SKILL.md/org-config.default.json/
 *                  scripts/org-config.mjs——registry 已随派发器退役删除 2026-10-03）
 *   ③ org-config   spawn org-config.mjs validate（cwd=SKILL_ROOT）rc≠0 → FAIL
 *                  并透传其末行
 *   ④ agents       清单单源=templates/agents/ops-*.md 枚举；绑定模板按本机件
 *                  org-config agent_bindings 渲染（{{binding:岗}}→实值，v2.1.0 批4）
 *                  后逐件对 --agents-dir（缺省 ~/.zcode/agents）：缺失=FAIL
 *                  （--install 可补）；存在但渲染后 sha256 不等=[warn] 漂移
 *                  （人工比对，--install 不覆盖——保护本机定制）
 *   ⑤ hook         git config core.hooksPath：.githooks→ok；未设=FAIL
 *                  （--install 可补）；自定义值=[warn]（不改只提示）；
 *                  git 不可用/非 git 仓=[warn]（zip 安装形态，跳过）
 *   ⑥ remote       git remote 非空=ok；空=[warn]（备份面）；非 git 仓=[warn]
 *   ⑦ ledger-dir   SKILL_ROOT/.zcode/ 试写临时文件后删 → ok/FAIL
 *                  （--project 语境改试写项目账本目录——ledgerPathFor 三层解析派生，B1/D-8）
 *   ⑧ project-gate --project <dir> 语境追加：spawn node scripts/verify-docs.mjs（cwd=项目根，
 *                  与本地 pre-commit/CI 三面同款命令，B1/D-4）——rc≠0 或脚本缺件=FAIL
 * 汇总行：deploy-check 汇总：ok X/warn Y/FAIL Z——<可部署/处置后复跑/阻断>
 * --install 四动作（v2.1.0 三层化批起）：③a本机件 org-config.local.json
 *   缺失时脚手架（默认件占位复制+note 声明用户配置域；已存在绝不覆盖）；
 *   ④缺失清单逐件复制 templates→agents-dir+sha256 复核；
 *   ⑤hooksPath 未设时 git config core.hooksPath .githooks；③宿主事实派生
 *   项目覆盖件 .zcode/org-config.json（g3 批 deploy-hostfacts-split 清偿
 *   ——按 entry_name 唯一命中派生 uuid_prefix；已存在绝不覆盖/有零命中或
 *   歧义不写+指引 DEPLOY §3/与默认件一致不写）。绝不改 org-config.default.json
 *   /宿主配置/已存在漂移件；完成后自动复跑七项按同口径退出（写盘后 ③项
 *   spawn org-config validate 自然复跑=派生落盘回读真退出码面）。
 *   错误处置（回炉轮 1，门一 W2/W3）：③ 装载失败（org-config/宿主）分行
 *   干净跳过（warn+指引）；写盘/回读抛错=[FAIL] 行带真因计入阻断（exit 1）。
 * --sync-agents（P2）显式重渲染全部模板→agents 目录（全或无覆盖写入+sha256 回读；
 *   唯一允许覆盖漂移件的路径；--install 语义不变=只补缺失不覆盖）。
 * 用法：node scripts/deploy-check.mjs [--install] [--sync-agents] [--self-test] [--agents-dir <dir>]
 *       [--project <dir>]（B1：项目语境——⑦ 项目账本目录＋⑧ project-gate 同款检查）
 *       （flag 取值一律空格分隔，--x=y 等号形态=用法错拒收——cliFlag 单源立场）
 * 可 import 纯函数零副作用（isMain guard 惯例；自检向量禁动真实状态）。
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, unlinkSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { SKILL_ROOT, loadOrgConfig, cliFlag, UsageError, readHostConfig, readJson, ledgerPathFor } from './org-config.mjs'

const SCRIPTS = join(SKILL_ROOT, 'scripts')
export const TEMPLATES_AGENTS = join(SKILL_ROOT, 'templates', 'agents')
export const DEFAULT_AGENTS_DIR = join(homedir(), '.zcode', 'agents')
export const EXIT_SELF_ERROR = 3 // 自身装载错（口径单源=06 §5.8 行 3）

/** 自身装载错信号（main 捕获→exit 3；判定/业务 FAIL 不走此类）。 */
export class SelfLoadError extends Error {}

/** 文件 sha256（双侧对账/漂移判定单源）。 */
export function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}

/** 文本 sha256（渲染后对账用——v2.1.0 批4）。 */
export function sha256Text(s) {
  return createHash('sha256').update(String(s)).digest('hex')
}

/** frontmatter 字段读取（P2；首个 `---` 到下一个 `---`）：model/thoughtLevel 两字段
 *  （值剥包裹引号）；无 frontmatter / 无 model 行时 hasModel=false（未绑定模板形态）。 */
export function readFrontmatterFields(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split('\n')
  const start = lines.findIndex((l) => l.trim() === '---')
  const end = start >= 0 ? lines.findIndex((l, i) => i > start && l.trim() === '---') : -1
  if (start < 0 || end < 0) return { hasFrontmatter: false, hasModel: false, model: null, thoughtLevel: null }
  const unquote = (v) => String(v).trim().replace(/^['"]|['"]$/g, '')
  let model = null
  let thoughtLevel = null
  for (let i = start + 1; i < end; i++) {
    const mm = /^model:\s*(.*?)\s*$/.exec(lines[i])
    if (mm) model = unquote(mm[1])
    const tm = /^thoughtLevel:\s*(.*?)\s*$/.exec(lines[i])
    if (tm) thoughtLevel = unquote(tm[1])
  }
  return { hasFrontmatter: true, hasModel: model !== null, model, thoughtLevel }
}

/** 绑定值解析（P2 纯函数）：字符串 `provider/model$level`（旧格式兼容）/
 *  `provider/model`（无档位）/ 对象 `{model,level}` → `{model,level,full}`；
 *  对象 model 非空、level∈low|high|max 才有效；其余形态=null（调用方计入 missing）。 */
export function parseBindingValue(v) {
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    const i = s.lastIndexOf('$')
    if (i >= 0) {
      const model = s.slice(0, i)
      const level = s.slice(i + 1)
      if (!model || !level) return null
      return { model, level, full: s }
    }
    return { model: s, level: null, full: s }
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const m = v.model
    if (typeof m !== 'string' || !m.trim()) return null
    if (!['low', 'high', 'max'].includes(v.level)) return null
    return { model: m.trim(), level: v.level, full: `${m.trim()}$${v.level}` }
  }
  return null
}

/** ④渲染（v2.1.0 批4；回炉 k1 W-2 强化石；P2 批两字段化）：模板占位
 *  `{{binding:<岗>}}` → 本机件 agent_bindings 实值。正文替换保留完整声明
 *  （`provider/model$level`，供 MODEL-SELF 自报行）；frontmatter 的 `model:` 行
 *  改写为不含 `$` 的 model 段，并在其后插入/核对独立 `thoughtLevel:` 行。
 *  已声明占位一次替换，缺绑定保留+点名；**渲染后残留任何 `{{…binding…` 形态
 *  （空格/点号等畸形占位，正则未认=按无占位直装的逃逸面）一并计入 missing
 *  （malformed: 前缀）——禁静默带占位部署**。无占位模板=恒等；无 model 行模板
 *  （ops-probe/ops-diagnostics 未绑定形态）=恒等且不算缺失。 */
export function renderAgentTemplate(text, bindings) {
  const missing = []
  const src = String(text)
  const out = src.replace(/\{\{binding:([A-Za-z0-9_-]+)\}\}/g, (m, agent) => {
    const v = bindings?.[agent]
    if (v == null) { missing.push(agent); return m }
    const parsed = parseBindingValue(v)
    if (!parsed) { missing.push(agent); return m }
    return parsed.full
  })
  // 畸形占位=非标准形态的 binding 残留（空格/点号等——替换正则未认=按无占位直装的
  // 逃逸面）；标准形态的「缺绑定保留占位」已在上一段点名，不重复计；
  // 未闭合形态（漏 }}）二次检测（回炉轮2 d1 W-2）
  const closed = out.replace(/\{\{binding:[A-Za-z0-9_-]+\}\}/g, '').replace(/\{\{[^}]*binding[^}]*\}\}/gi, '')
  if (/\{\{[^}]*binding/i.test(closed)) missing.push('malformed:未闭合占位')
  for (const residue of out.match(/\{\{[^}]*binding[^}]*\}\}/gi) || [])
    if (!/^\{\{binding:[A-Za-z0-9_-]+\}\}$/.test(residue)) missing.push(`malformed:${residue}`)

  // P2：frontmatter 两字段化（首个 --- 到下一个 ---）。绑定名=原始 model 行占位名
  // （冲突/缺档位标记点名用；无占位时回落 'model'）。
  const srcLines = src.split('\n')
  const srcStart = srcLines.findIndex((l) => l.trim() === '---')
  const srcEnd = srcStart >= 0 ? srcLines.findIndex((l, i) => i > srcStart && l.trim() === '---') : -1
  let bindingName = null
  if (srcStart >= 0 && srcEnd > srcStart) {
    const srcModel = srcLines.slice(srcStart + 1, srcEnd).find((l) => /^model:\s*/.test(l))
    const nm = srcModel && /\{\{binding:([A-Za-z0-9_-]+)\}\}/.exec(srcModel)
    if (nm) bindingName = nm[1]
  }
  const lines = out.split('\n')
  const start = lines.findIndex((l) => l.trim() === '---')
  const end = start >= 0 ? lines.findIndex((l, i) => i > start && l.trim() === '---') : -1
  if (start < 0 || end <= start) return { text: out, missing }
  const mi = lines.findIndex((l, i) => i > start && i < end && /^model:\s*/.test(l))
  if (mi < 0) return { text: out, missing }
  const raw = /^model:\s*(.*?)\s*$/.exec(lines[mi])[1].replace(/^['"]|['"]$/g, '')
  // 未解析的占位（缺绑定保留形态）不参与两字段化——沿用既有 warn/FAIL 路径
  if (raw.includes('{{')) return { text: out, missing }
  const di = raw.lastIndexOf('$')
  const modelPart = di >= 0 ? raw.slice(0, di) : raw
  const levelPart = di >= 0 ? raw.slice(di + 1).trim() : null
  lines[mi] = `model: ${modelPart}`
  const ti = lines.findIndex((l, i) => i > start && i < end && /^thoughtLevel:\s*/.test(l))
  if (levelPart) {
    if (ti >= 0) {
      const tv = /^thoughtLevel:\s*(.*?)\s*$/.exec(lines[ti])[1].replace(/^['"]|['"]$/g, '')
      if (tv !== levelPart) missing.push(`conflict:thoughtLevel:${bindingName || 'model'}`)
    } else {
      lines.splice(mi + 1, 0, `thoughtLevel: ${levelPart}`)
    }
  } else if (ti < 0) {
    missing.push(`missing-level:${bindingName || 'model'}`)
  }
  return { text: lines.join('\n'), missing }
}

/** P2 检查①：frontmatter `model:` 值含 `$` → FAIL（行文本点名值；调用方补文件名）。
 *  无 model 行=未绑定模板，跳过（ok/skipped）。 */
export function checkModelNoDollar(rendered) {
  const fm = readFrontmatterFields(rendered)
  if (!fm.hasModel) return { level: 'ok', skipped: true, line: 'model 字段缺失（未绑定模板）' }
  if (String(fm.model).includes('$')) return { level: 'FAIL', line: `model 字段含 $（${fm.model}）`, value: fm.model }
  return { level: 'ok', line: `model 字段无 $（${fm.model}）`, value: fm.model }
}

/** P2 检查②：thoughtLevel 须为 low|high|max；缺失/非法=FAIL（调用方仅对有 model
 *  行的渲染结果调用；未绑定模板跳过并汇总提示）。 */
export function checkThoughtLevel(level) {
  const v = level == null ? '' : String(level).trim()
  if (!v) return { level: 'FAIL', line: 'thoughtLevel 缺失' }
  if (!['low', 'high', 'max'].includes(v)) return { level: 'FAIL', line: `thoughtLevel 非法（${v}）` }
  return { level: 'ok', line: `thoughtLevel=${v}` }
}

/** P2 检查③：新式名 `ops-<role>-<provider>-<level>.md` → 核对 agent_slots 存在、
 *  provider 与文件名中段一致、slot.model/level 与渲染值一致；legacy 名=skip
 *  （调用方汇总 legacy 件数，不计 warn）。 */
export function checkAgentName(name, slotDef, rendered = {}) {
  const m = /^ops-(research|planner|executor|reviewer|adjudicator|vision|diagnostics|assembler)-([a-z0-9]+)-(low|high|max)\.md$/.exec(String(name))
  if (!m) return { level: 'skip', skipped: true, line: '' }
  const [, , provider, level] = m
  const base = String(name).replace(/\.md$/, '')
  if (!slotDef || typeof slotDef !== 'object') return { level: 'FAIL', line: `${name}：agent_slots 缺「${base}」` }
  const errors = []
  if (slotDef.provider !== provider) errors.push(`文件名 provider 段=${provider} ≠ slot.provider=${slotDef.provider}`)
  if (slotDef.level !== level) errors.push(`文件名档位段=${level} ≠ slot.level=${slotDef.level}`)
  // 渲染值可由第三参注入；亦可由 slotDef.renderedModel/renderedLevel 携带（两参调用面）。
  // 未提供=只核对命名与 slot 定义（生产调用恒提供渲染值）。
  const hasRenderedModel = rendered && Object.prototype.hasOwnProperty.call(rendered, 'model')
  const hasRenderedLevel = rendered && Object.prototype.hasOwnProperty.call(rendered, 'level')
  const renderedModel = hasRenderedModel ? rendered.model : (slotDef.renderedModel ?? null)
  const renderedLevel = hasRenderedLevel ? rendered.level : (slotDef.renderedLevel ?? null)
  if (hasRenderedModel || slotDef.renderedModel !== undefined) {
    if (renderedModel == null || String(renderedModel) === '') errors.push('渲染 model 缺失')
    else {
      const rm = String(renderedModel)
      const renderedModelName = rm.includes('/') ? rm.slice(rm.indexOf('/') + 1) : rm
      if (slotDef.model !== renderedModelName) errors.push(`slot.model=${slotDef.model} ≠ 渲染 model=${renderedModelName}`)
    }
  }
  if (hasRenderedLevel || slotDef.renderedLevel !== undefined) {
    const lv = renderedLevel == null ? '' : String(renderedLevel)
    if (!lv) errors.push('渲染 thoughtLevel 缺失')
    else if (slotDef.level !== lv) errors.push(`slot.level=${slotDef.level} ≠ 渲染 thoughtLevel=${lv}`)
  }
  return errors.length ? { level: 'FAIL', line: `${name}：${errors.join('；')}` } : { level: 'ok', line: `${name}：新式命名/slot/渲染值一致` }
}

/** P2 检查④：宿主版本下限 3.15.1（忽略 `-` 后缀）；解析失败/空=warn（无法核对，
 *  不假绿）。 */
export function checkHostVersion(rawVersion) {
  const s = String(rawVersion ?? '').trim()
  const core = s.split('-')[0].trim()
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(core)
  if (!m) return { level: 'warn', line: `host-version——宿主版本无法解析（${s || '空'}）——无法核对 ≥3.15.1（不假绿）` }
  const [maj, min, pat] = m.slice(1).map(Number)
  const cmp = maj - 3 || min - 15 || pat - 1
  if (cmp < 0) return { level: 'FAIL', line: `host-version——宿主 ${s} < 3.15.1——升级宿主后复跑` }
  return { level: 'ok', line: `host-version——宿主 ${s} ≥ 3.15.1` }
}

/** 多行输出的末行（透传 org-config validate 尾行用）。 */
export const lastLine = (s) => String(s || '').trim().split('\n').filter(Boolean).pop() || ''

// ── 纯函数（--self-test 向量注入位）──

/** ① 主版本判禁：major ∈ forbid_major → FAIL；配置缺省/空=**warn**（回炉轮2 W-5：
 *  守卫值缺失=恒通过属静默降级——如实告警指引填本机件，判据读配置禁硬编码）。 */
export function checkNodeMajor(nodeVersion, forbidMajor) {
  const major = Number.parseInt(String(nodeVersion).replace(/^v/, '').split('.')[0], 10)
  const list = Array.isArray(forbidMajor) ? forbidMajor : []
  if (!list.length)
    return { level: 'warn', line: `node-major——supported_node.forbid_major 未配置（本机件）——守卫此态恒通过（填值守值后复跑；语义与经验=references/10 §1）` }
  const hit = list.includes(major)
  return {
    level: hit ? 'FAIL' : 'ok',
    line: hit
      ? `node-major——当前 ${nodeVersion}（主版本 ${major}）∈ 受禁系（org-config supported_node.forbid_major）——改装受支持主版本后复跑`
      : `node-major——${nodeVersion}（主版本 ${major}）不在受禁系`,
  }
}

/** ② 必备三件（技能装载链：入口/默认配置/配置装载器——岗位注册表已随派发器退役删除 2026-10-03）。 */
export const REQUIRED_FILES = ['SKILL.md', 'org-config.default.json', 'scripts/org-config.mjs']
export function checkRequiredFiles(root, files = REQUIRED_FILES) {
  const missing = files.filter((f) => !existsSync(join(root, f)))
  return {
    level: missing.length ? 'FAIL' : 'ok',
    line: missing.length
      ? `skill-files——缺 ${missing.join('、')}（装载错——重克隆/重装本仓后复跑）`
      : `skill-files——必备 ${files.length} 件齐（${files.join('、')}）`,
  }
}

/** ④ 代理清单单源派生：templates/agents/ops-*.md 枚举（显式排序，evolve-l3 同律）。 */
export function listAgentTemplates(dir = TEMPLATES_AGENTS) {
  return readdirSync(dir).filter((f) => /^ops-.*\.md$/.test(f)).sort()
}

/** ④ 漂移分类（哈希相等性由调用方注入=自检位）：缺失→FAIL/不等→warn/相等→ok。 */
export function classifyAgent({ exists, hashEqual }) {
  if (!exists) return { level: 'FAIL', reason: 'missing', line: '缺失（--install 可补：templates/agents/ 单源复制）' }
  if (!hashEqual) return { level: 'warn', reason: 'drift', line: '存在但 sha256 漂移（人工比对；--install 不覆盖——保护本机定制）' }
  return { level: 'ok', reason: 'match', line: 'sha256 相符' }
}

/** ⑤ hooksPath 值分类（纯值判，spawn 由调用方承担）。 */
export function classifyHookValue(value) {
  const v = String(value || '').trim()
  if (v === '.githooks') return { level: 'ok', line: 'hook——core.hooksPath=.githooks（提交门禁已挂）' }
  if (v === '') return { level: 'FAIL', line: 'hook——core.hooksPath 未设（提交门禁未挂）——可 --install 补，或手跑 git config core.hooksPath .githooks' }
  return { level: 'warn', line: `hook——core.hooksPath=${v}（用户自定义，不改只提示命令：git config core.hooksPath .githooks）` }
}

/** 汇总行+终判（FAIL>0→阻断；warn>0→处置后复跑；否则可部署）。 */
export function summarize(results) {
  const ok = results.filter((r) => r.level === 'ok').length
  const warn = results.filter((r) => r.level === 'warn').length
  const fail = results.filter((r) => r.level === 'FAIL').length
  const verdict = fail > 0 ? '阻断' : warn > 0 ? '处置后复跑' : '可部署'
  return { ok, warn, fail, verdict, line: `deploy-check 汇总：ok ${ok}/warn ${warn}/FAIL ${fail}——${verdict}` }
}

/** 退出码映射（warn 不阻断；自身装载错=3 由 SelfLoadError 路径承载）。 */
export function exitCodeFrom({ failCount = 0, selfTestFailed = false } = {}) {
  return failCount > 0 || selfTestFailed ? 1 : 0
}

// ── 运行态探针（仅 isMain 路径触达；纯函数禁调）──

/** git 仓判定：不可用/非仓→跳过语义；异常→SelfLoadError（exit 3 族）。 */
export function gitState(cwd = SKILL_ROOT) {
  const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8' })
  if (probe.error) return { repo: false, reason: 'git 不可用' }
  if (probe.status !== 0) {
    const err = `${probe.stderr || ''}`
    if (/not a git repository/i.test(err)) return { repo: false, reason: '非 git 仓' }
    throw new SelfLoadError(`git 仓判定异常（exit ${probe.status}：${err.trim()}）`)
  }
  return { repo: true }
}

/** ⑦ 账本目录可写性（试写临时文件后删；目录缺省顺带创建）。
 *  root 形=SKILL_ROOT（现行）；ledgerPath 形=项目语境按 ledgerPathFor 三层解析派生（B1/D-8）。 */
export function checkLedgerDir(root = SKILL_ROOT) {
  return checkLedgerDirPath(join(root, '.zcode'), 'SKILL_ROOT/.zcode/')
}
export function checkLedgerDirPath(dir, label) {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, `.deploy-check-probe-${process.pid}`)
    writeFileSync(probe, 'ok')
    unlinkSync(probe)
    return { level: 'ok', line: `ledger-dir——${label} 可写（账本目录就绪）` }
  } catch (e) {
    return { level: 'FAIL', line: `ledger-dir——${label} 不可写（${e.message}）——检查目录权限后复跑` }
  }
}

/** ⑧ project-gate（B1/D-4 三面同款）：spawn node scripts/verify-docs.mjs（cwd=项目根）。
 *  判定纯函数（自检注入位）＋运行探针分离。 */
export function projectGateVerdict({ scriptExists, rc, errMsg = null }) {
  if (!scriptExists) return { level: 'FAIL', line: 'project-gate FAIL——缺 scripts/verify-docs.mjs（同款检查脚本缺件——项目未铺门禁面）' }
  if (errMsg) return { level: 'FAIL', line: `project-gate FAIL——spawn 失败（${errMsg}）` }
  return rc === 0
    ? { level: 'ok', line: 'project-gate ok——node scripts/verify-docs.mjs（三面同款·cwd=项目根）' }
    : { level: 'FAIL', line: `project-gate FAIL——node scripts/verify-docs.mjs exit ${rc}（三面同款·cwd=项目根——修项目门禁后复跑）` }
}
export function runProjectGate(projectDir) {
  const script = join(projectDir, 'scripts', 'verify-docs.mjs')
  if (!existsSync(script)) return projectGateVerdict({ scriptExists: false })
  const r = spawnSync(process.execPath, [script], { cwd: projectDir, encoding: 'utf8', timeout: 180_000, killSignal: 'SIGKILL' })
  if (r.error) return projectGateVerdict({ scriptExists: true, rc: null, errMsg: r.error.message })
  return projectGateVerdict({ scriptExists: true, rc: r.status })
}

/** 七项检查主体（打印逐项行并返回结果集；org-config 装载失败/git 判定异常→throw=exit 3）。
 *  projectDir 非空=--project 项目语境：⑦ 改试写项目账本目录（ledgerPathFor 三层解析）＋⑧ 追加
 *  project-gate 同款检查（B1/D-4/D-8）；非项目语境行为零变化。 */
export function runChecks(agentsDir, cfg, projectDir = null) {
  const results = []
  const push = (r) => { results.push(r); console.log(`[${r.level}] ${r.line}`) }

  push(checkNodeMajor(process.version, cfg?.supported_node?.forbid_major))
  push(checkRequiredFiles(SKILL_ROOT))

  const oc = spawnSync(process.execPath, [join(SCRIPTS, 'org-config.mjs'), 'validate'], { cwd: SKILL_ROOT, encoding: 'utf8' })
  if (oc.status === 0) push({ level: 'ok', line: `org-config——validate 通过（${lastLine(oc.stdout)}）` })
  else
    push({
      level: 'FAIL',
      line: `org-config——validate exit ${oc.status}：${lastLine(oc.stderr || oc.stdout)}｜新机最常见断点=providers 占位未本机化或 uuid_prefix/entry_name 与宿主注册表双校验不符——处置=填 org-config.local.json 本机实值（deploy-check --install 可脚手架；uuid 前缀=宿主注册表条目 id 前 8 字符）或建项目覆盖件 .zcode/org-config.json（深合并覆盖）；宿主 config（key/端点事实）永不改、不入库`,
    })

  let legacyNameSkipped = 0
  let unboundThoughtSkipped = 0
  for (const name of listAgentTemplates()) {
    const dst = join(agentsDir, name)
    const { text: rendered, missing } = renderAgentTemplate(readFileSync(join(TEMPLATES_AGENTS, name), 'utf8'), cfg?.agent_bindings || {})
    // 回炉 W7b：对账前内容归一化（剥 BOM+CRLF→LF——WP-4 行尾哈希地雷同律；部署件被
    // 记事本改写不再永久假漂移）；回炉 k1 N-8：缺绑定=独立的「占位缺绑定」warn 位，
    // 不混入真漂移计数
    const norm = (s) => String(s).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
    const hashEqual = existsSync(dst) && sha256Text(norm(rendered)) === sha256Text(norm(readFileSync(dst, 'utf8')))
    const cls = classifyAgent({ exists: existsSync(dst), hashEqual })
    // P2 四项检查（每件一行合并）：有 model 行即检查 thoughtLevel（未解析占位不构成
    // 豁免——只有「无 model 行」的未绑定模板才跳过并汇总）；缺绑定/畸形另走下方
    // warn/FAIL 部署状态分支，不吞四项检查的 FAIL。
    const fm = readFrontmatterFields(rendered)
    const modelCheck = checkModelNoDollar(rendered)
    const thoughtCheck = fm.hasModel ? checkThoughtLevel(fm.thoughtLevel) : null
    if (!fm.hasModel) unboundThoughtSkipped++
    const nameCheck = checkAgentName(name, cfg?.agent_slots?.[name.replace(/\.md$/, '')], { model: fm.model, level: fm.thoughtLevel })
    if (nameCheck.level === 'skip') legacyNameSkipped++
    const checkFails = []
    if (modelCheck.level === 'FAIL') checkFails.push(modelCheck.line)
    if (thoughtCheck?.level === 'FAIL') checkFails.push(thoughtCheck.line)
    if (nameCheck.level === 'FAIL') checkFails.push(nameCheck.line)
    const conflicts = missing.filter((m) => m.startsWith('conflict:thoughtLevel:'))
    if (conflicts.length) checkFails.push(`thoughtLevel 与绑定档位冲突（${conflicts.join('、')}）`)
    if (checkFails.length) {
      push({ level: 'FAIL', line: `agents——${name}（${agentsDir}）四项检查未过：${checkFails.join('；')}${missing.length ? `；缺绑定/畸形：${[...new Set(missing)].join('、')}` : ''}` })
      continue
    }
    if (missing.length) {
      // 回炉轮2 N-6：占位异常时部署件缺失仍 FAIL（装好≠绑定对——两害分报，不整项跳过）
      push({ level: existsSync(dst) ? 'warn' : 'FAIL', line: `agents——${name}（${agentsDir}）${existsSync(dst) ? '占位缺绑定/畸形' : '缺失'}（${[...new Set(missing)].join('、')}）——渲染对账此态不可信；填本机件 agent_bindings 后复跑` })
      continue
    }
    const checkNote = fm.hasModel ? `｜model 无 $｜thoughtLevel=${fm.thoughtLevel}` : '｜未绑定（无 model 行，thoughtLevel 跳过）'
    push({ level: cls.level, line: `agents——${name}（${agentsDir}）${cls.line}${checkNote}${cls.reason === 'drift' ? '——若为改绑后残留：删除该部署件后 --install 重装即按 agent_bindings 渲染（回炉 W7a）' : ''}（渲染后对账）` })
  }
  console.log(`thoughtLevel 检查——未绑定模板 ${unboundThoughtSkipped} 个跳过（无 model: 行，随宿主模型）`)
  console.log(`name-check——新式命名核对跳过 legacy 件 ${legacyNameSkipped} 个（P5 生成 34 档后启用）`)
  push(checkHostVersion(process.env.ZCODE_APP_VERSION))

  const git = gitState()
  if (!git.repo) push({ level: 'warn', line: `hook——${git.reason}（zip 安装形态，跳过；克隆本仓后复跑可核）` })
  else {
    const hp = spawnSync('git', ['config', 'core.hooksPath'], { cwd: SKILL_ROOT, encoding: 'utf8' })
    push(hp.status === 0 ? classifyHookValue(hp.stdout) : classifyHookValue(''))
  }
  if (!git.repo) push({ level: 'warn', line: `remote——${git.reason}（备份面：建议以克隆形态安装并挂远端备份）` })
  else {
    const remotes = (spawnSync('git', ['remote'], { cwd: SKILL_ROOT, encoding: 'utf8' }).stdout || '').trim()
    push(
      remotes
        ? { level: 'ok', line: `remote——已挂（${remotes.split(/\s+/).join('、')}）` }
        : { level: 'warn', line: 'remote——空（备份面：建议挂远端备份，防单机数据丢失）' },
    )
  }

  // ⑦（B1/D-8）：项目语境=按 ledgerPathFor 三层解析派生项目账本目录试写；否则维持 SKILL_ROOT 现行为
  if (projectDir) {
    let lp = null
    try { lp = ledgerPathFor(projectDir) } catch (e) { throw new SelfLoadError(`项目账本路径解析失败（${projectDir}）：${e.message}`) }
    push(checkLedgerDirPath(dirname(lp), `项目账本目录（${lp}）`))
    push(runProjectGate(projectDir)) // ⑧ project-gate（仅项目语境追加）
  } else {
    push(checkLedgerDir())
  }
  return results
}

/** --install 动作一：补缺失代理件（渲染部署+sha256 复核；漂移件不覆盖；v2.1.0 批4
 *  起绑定模板按 agent_bindings 渲染——缺绑定的占位模板不装=FAIL 指引）。 */
export function installAgents(agentsDir, bindings = {}) {
  const missing = listAgentTemplates().filter((n) => !existsSync(join(agentsDir, n)))
  if (!missing.length) return { level: 'ok', line: 'install-agents——无缺失件（已存在漂移件不覆盖——保护本机定制）' }
  mkdirSync(agentsDir, { recursive: true })
  const bad = []
  const unbound = []
  for (const n of missing) {
    const { text, missing: miss } = renderAgentTemplate(readFileSync(join(TEMPLATES_AGENTS, n), 'utf8'), bindings)
    if (miss.length) { unbound.push(n); continue }
    writeFileSync(join(agentsDir, n), text, 'utf8')
    if (sha256Text(text) !== sha256File(join(agentsDir, n))) bad.push(n)
  }
  return bad.length || unbound.length
    ? { level: 'FAIL', line: `install-agents——${bad.length ? `部署后 sha256 复核不符：${bad.join('、')}` : ''}${bad.length && unbound.length ? '；' : ''}${unbound.length ? `占位缺绑定未装：${unbound.join('、')}（填本机件 agent_bindings 实值后复跑）` : ''}` }
    : { level: 'ok', line: `install-agents——补齐 ${missing.length} 件（${missing.join('、')}，渲染部署+sha256 复核相等）` }
}

/** --sync-agents（P2）：显式重渲染全部模板到 agents 目录。全或无——任一模板缺绑定/
 *  畸形/档位冲突=全部不写并逐件打印原因；全部可渲染则逐件覆盖写入（含漂移件）并
 *  回读 sha256 复核。该开关是唯一允许覆盖漂移件的路径；--install 语义不变（只补
 *  缺失、不覆盖漂移）。退出码口径=references/06 §5.8。 */
export function syncAgents(agentsDir, bindings = {}) {
  const entries = []
  const bad = []
  for (const name of listAgentTemplates()) {
    const { text, missing } = renderAgentTemplate(readFileSync(join(TEMPLATES_AGENTS, name), 'utf8'), bindings)
    if (missing.length) bad.push({ name, missing: [...new Set(missing)] })
    else entries.push({ name, text })
  }
  if (bad.length) {
    for (const b of bad) console.log(`[sync] 不写 ${b.name}：${b.missing.join('、')}`)
    console.log(`[sync] 中止：${bad.length} 件不可渲染（全或无——本次 0 件写入）`)
    return { level: 'FAIL', wrote: 0 }
  }
  mkdirSync(agentsDir, { recursive: true })
  let wrote = 0
  const mismatched = []
  for (const { name, text } of entries) {
    const dst = join(agentsDir, name)
    writeFileSync(dst, text, 'utf8')
    const hash = sha256Text(text)
    console.log(`[sync] 写入 ${name} sha256=${hash.slice(0, 12)}`)
    wrote++
    if (sha256File(dst) !== hash) mismatched.push(name)
  }
  if (mismatched.length) {
    console.log(`[FAIL] sync-agents——回读 sha256 不等：${mismatched.join('、')}`)
    return { level: 'FAIL', wrote }
  }
  console.log(`[sync] 完成：写入 ${wrote} 件，回读 sha256 全部相等`)
  return { level: 'ok', wrote }
}

/** --install 动作二：hooksPath 未设时补设（已设含自定义=不动）。 */
export function installHook() {
  const git = gitState()
  if (!git.repo) return `install-hook——跳过（${git.reason}——zip 形态无提交流，克隆本仓后复跑 --install）`
  const hp = spawnSync('git', ['config', 'core.hooksPath'], { cwd: SKILL_ROOT, encoding: 'utf8' })
  if (hp.status === 0 && String(hp.stdout || '').trim()) return `install-hook——core.hooksPath 已设=${String(hp.stdout).trim()}（不重复设置；自定义值属用户裁决面）`
  const r = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: SKILL_ROOT, encoding: 'utf8' })
  return r.status === 0
    ? 'install-hook——已设 core.hooksPath=.githooks（提交门禁挂入）'
    : `install-hook——设置失败（exit ${r.status}：${String(r.stderr || '').trim()}）——手跑 git config core.hooksPath .githooks`
}

// ── v2.1.0 三层化批：本机件脚手架（动作③a）──
// org-config.local.json（本机个人事实层，gitignore）缺失时从默认件复制一份
// 供用户填实值（providers/vision_channels/projects 的 TODO 占位）；已存在=
// 绝不覆盖（用户配置域）。写盘段自包 try/catch（同 installHostFacts 处置纪律）。

/** ③a 纯写盘：脚手架本机件（回炉 W6：**最小骨架**——只落个人事实分区占位
 *  （providers TODO/agent_bindings/vision_channels/projects 域声明），不复制的
 *  finish_vocab/thresholds/source_health 等通用分区——防本机件陈旧快照静默压住
 *  默认件后续演进=铁律1「静默继承」形态）。已存在=绝不覆盖+可解析性核对
 *  （回炉 W10c：坏 JSON 报 warn 非假 ok）。 */
export function installLocalConfig(defaultCfg, localPath) {
  if (existsSync(localPath)) {
    try {
      readJson(localPath)
      return { wrote: false, level: 'ok', line: `install-localconfig——本机件已存在且可解析（${localPath}）——绝不覆盖（用户配置域）` }
    } catch (e) {
      return { wrote: false, level: 'warn', line: `install-localconfig——本机件存在但不可解析（${e.message}）——修复 JSON 后复跑（此态下 providers 占位将拒派）` }
    }
  }
  const providerAliases = Object.keys(defaultCfg?.providers || {})
  const payload = {
    note: '本机个人事实层（deploy-check --install 脚手架，v2.1.0 三层化批·最小骨架）——用户配置域，装后自由改写。填法：①providers 各源（uuid_prefix=宿主注册表条目 id 前 8 字符/entry_name=条目名/kind/billing/model_family——五键全填，model_family 缺=validate 拒；uuid_prefix 第二形态=账户计划源 `account:<计划名>`，计划名须列入顶层 account_plan_allowlist 本机允许清单，不走宿主注册表双命中）；②agent_bindings（绑定岗实值，键=代理名=templates/agents 文件名，值=<uuid>/<model>$<档位>——四绑定模板渲染消费）；③vision_channels 通道实值；④projects 映射。填后复跑 deploy-check；指引=DEPLOY.md §3/PACKAGING.md',
    providers: Object.fromEntries(providerAliases.map((a) => [a, { uuid_prefix: 'TODO', entry_name: 'TODO', note: '填本机实值（五键）' }])),
    agent_bindings: { note: '绑定岗实值（键=代理名）' },
    vision_channels: { note: '通道实值（model/endpoint_contains/prefer_hosts/stream）' },
    projects: { note: 'project_id 映射' },
  }
  try {
    writeFileSync(localPath, JSON.stringify(payload, null, 2) + '\n')
    const back = readJson(localPath)
    return back && typeof back === 'object' && back.providers
      ? { wrote: true, level: 'ok', line: `install-localconfig——已脚手架本机件 ${localPath}（最小骨架：仅个人事实分区，通用分区随默认件演进；填 TODO 实值后复跑 deploy-check）` }
      : { wrote: true, level: 'FAIL', line: `install-localconfig——本机件写盘回读不符（${localPath}）——重跑 --install 或人工核查` }
  } catch (e) {
    return { wrote: false, level: 'FAIL', line: `install-localconfig——本机件写盘/回读失败（${localPath}：${e.message}）——重跑 --install 或人工核查磁盘/权限` }
  }
}

// ── g3 批（deploy-hostfacts-split 残留清偿）：宿主事实派生项目覆盖件 ──
// 授权形态=仅 --install 显式调用（P4）；供应商事实属用户配置域——派生只读
// 宿主注册表、只写机局部 .zcode/org-config.json（gitignore 不入库），绝不改
// org-config.default.json 与宿主 config（key/端点事实永不改、不入库）。

/** 派生纯函数（P5）：对 defaultCfg.providers 每别名按 entry_name 在宿主
 *  provider 注册表找命中（命中语义与 validateProviders 的 name 判据同源）——
 *  唯一命中→{uuid_prefix: id 前 8 字符, entry_name}；零命中→unmatched；
 *  ≥2 命中→ambiguous（歧义不猜，列入指引）。附带 hostUnconsumed（宿主有
 *  而默认件未用的条目名=候选信息）。 */
export function deriveHostFacts(defaultCfg, hostCfg) {
  const hostEntries = Object.entries(hostCfg?.provider || {})
  const providers = {}
  const unmatched = []
  const ambiguous = []
  for (const [alias, def] of Object.entries(defaultCfg?.providers || {})) {
    const name = def?.entry_name
    const hits = name == null ? [] : hostEntries.filter(([id, p]) => p && p.name === name)
    if (hits.length === 1) providers[alias] = { uuid_prefix: hits[0][0].slice(0, 8), entry_name: name }
    else if (hits.length === 0) unmatched.push(alias)
    else ambiguous.push(alias)
  }
  const usedNames = new Set(
    Object.values(defaultCfg?.providers || {}).map((d) => (d && typeof d === 'object' ? d.entry_name : null)).filter((v) => v != null),
  )
  const hostUnconsumed = hostEntries
    .filter(([, p]) => p && p.name && !usedNames.has(p.name))
    .map(([id, p]) => `${p.name}(${id.slice(0, 8)})`)
  return { providers, unmatched, ambiguous, hostUnconsumed }
}

/** 写盘判定纯函数（P4）：全命中（无 unmatched/ambiguous 由调用方先判）且派生
 *  值与默认件完全一致→false（不写，防本机冗余件——cfg 哈希不变）；任一漂移
 *  →true（须派生覆盖件）。 */
export function hostFactsDiffer(derived, defaultCfg) {
  return Object.entries(defaultCfg?.providers || {}).some(([alias, def]) => {
    const d = derived?.providers?.[alias]
    return !d || d.uuid_prefix !== def?.uuid_prefix || d.entry_name !== def?.entry_name
  })
}

/** --install 动作三（P4/P5）：派生宿主事实写项目覆盖件。
 *  已存在→绝不覆盖；有 unmatched/ambiguous→不写文件+明确指引行（指向 DEPLOY
 *  §3 手工路径，歧义不猜）；全命中且与默认件完全一致→不写文件；否则写盘
 *  （note 字段声明用户配置域+派生规则一句）并回读复核。写盘后 runChecks ③
 *  （spawn org-config validate）自然复跑=落盘回读真退出码面。 */
export function installHostFacts(defaultCfg, hostCfg, overPath) {
  if (existsSync(overPath))
    return { wrote: false, level: 'ok', line: `install-hostfacts——覆盖件已存在（${overPath}）——绝不覆盖（用户配置域；改写走 DEPLOY §3 手工路径）` }
  const d = deriveHostFacts(defaultCfg, hostCfg)
  if (d.unmatched.length || d.ambiguous.length)
    return {
      wrote: false,
      level: 'warn',
      line:
        `install-hostfacts——不派生：无宿主命中 alias=${d.unmatched.join('、') || '无'} / 歧义（同 entry_name≥2）=${d.ambiguous.join('、') || '无'}` +
        `${d.hostUnconsumed.length ? ` / 宿主未消费候选=${d.hostUnconsumed.join('、')}` : ''}` +
        `——歧义不猜，手工路径=DEPLOY §3（按三元组对齐或手写 .zcode/org-config.json）`,
    }
  if (!hostFactsDiffer(d, defaultCfg))
    return { wrote: false, level: 'ok', line: 'install-hostfacts——宿主事实与默认件一致——无需覆盖件（不写，防本机冗余件）' }
  const payload = {
    note: 'deploy-check --install 派生件——用户配置域，装后可自由改写；派生规则=按 entry_name 在宿主供应商注册表找唯一命中，uuid_prefix 取其 id 前 8 字符（DEPLOY §3）',
    providers: d.providers,
  }
  // 回炉轮 1 R1（W2）：写盘段自包 try/catch——IO/回读抛错返回 FAIL 结果带
  // 真因（计入 summarize fail→exit 1），不再由调用方笼统报「宿主配置装载失败」
  // warn（真因掩盖+静默失败面——门一 W2）
  try {
    mkdirSync(dirname(overPath), { recursive: true })
    writeFileSync(overPath, JSON.stringify(payload, null, 2) + '\n')
    const back = readJson(overPath) // 落盘回读复核（写坏=FAIL 行，validate 复跑另有 ③ 兜底）
    const ok = JSON.stringify(back.providers) === JSON.stringify(payload.providers)
    return ok
      ? { wrote: true, level: 'ok', line: `install-hostfacts——已派生覆盖件 ${overPath}（${Object.keys(d.providers).length} 源，逐别名唯一命中；回读一致）` }
      : { wrote: true, level: 'FAIL', line: `install-hostfacts——覆盖件写盘回读不符（${overPath}）——重跑 --install 或人工核查磁盘/权限` }
  } catch (e) {
    return { wrote: false, level: 'FAIL', line: `install-hostfacts——覆盖件写盘/回读失败（${overPath}：${e.message}）——重跑 --install 或人工核查磁盘/权限/占用（真因如上，非装载失败）` }
  }
}

// ── --self-test（纯函数为主，禁动真实状态；fixture 用临时目录）──
function selfTest() {
  let fails = 0
  let n = 0
  const t = (name, cond) => (n++, console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`), cond || fails++)

  // 向量1：forbid 判定正反例（注入配置对象）
  t('forbid 正例（v25.2.1 ∈ [25] → FAIL）', checkNodeMajor('v25.2.1', [25]).level === 'FAIL')
  t('forbid 反例（v24.21.0 ∉ [25] → ok）', checkNodeMajor('v24.21.0', [25]).level === 'ok')
  t('forbid 配置缺省（无 forbid_major → warn 静默降级如实告警——回炉轮2 W-5）', checkNodeMajor('v25.2.1', undefined).level === 'warn' && checkNodeMajor('v25.2.1', undefined).line.includes('未配置'))

  // 向量2：agents 清单派生（fixture 目录）
  const fx = mkdtempSync(join(tmpdir(), 'deploy-check-fx-'))
  try {
    for (const f of ['ops-b.md', 'ops-a.md', 'ops-c.txt', 'readme.md', 'ops-d.md']) writeFileSync(join(fx, f), 'x')
    t('清单派生（ops-*.md 全收+排序+他件剔除）', JSON.stringify(listAgentTemplates(fx)) === JSON.stringify(['ops-a.md', 'ops-b.md', 'ops-d.md']))
  } finally {
    rmSync(fx, { recursive: true, force: true })
  }

  // 向量3：漂移分类（注入哈希相等性）
  t('漂移分类：缺失→FAIL（--install 可补）', classifyAgent({ exists: false }).level === 'FAIL' && classifyAgent({ exists: false }).reason === 'missing')
  t('漂移分类：存在但哈希不等→warn（不覆盖）', classifyAgent({ exists: true, hashEqual: false }).level === 'warn' && classifyAgent({ exists: true, hashEqual: false }).reason === 'drift')
  t('漂移分类：存在且相等→ok', classifyAgent({ exists: true, hashEqual: true }).level === 'ok' && classifyAgent({ exists: true, hashEqual: true }).reason === 'match')

  // 向量4：退出码映射（含 3 类）
  t('退出码：无 FAIL → 0（warn 不阻断由汇总向量另证）', exitCodeFrom({ failCount: 0 }) === 0)
  t('退出码：有 FAIL → 1', exitCodeFrom({ failCount: 1 }) === 1)
  t('退出码：--self-test 失败 → 1', exitCodeFrom({ selfTestFailed: true }) === 1)
  t('退出码：自身装载错 → 3（SelfLoadError 常量）', EXIT_SELF_ERROR === 3 && new SelfLoadError('x') instanceof Error)

  // 加测：hook 值分类（纯值判）
  t('hook 值：.githooks → ok', classifyHookValue('.githooks').level === 'ok')
  t('hook 值：未设 → FAIL（--install 可补）', classifyHookValue('').level === 'FAIL')
  t('hook 值：自定义 → warn（只提示）', classifyHookValue('my-hooks').level === 'warn')

  // 加测：汇总行映射
  const s = summarize([{ level: 'ok' }, { level: 'ok' }, { level: 'warn' }, { level: 'FAIL' }])
  t('汇总行：计数+终判（FAIL→阻断）', s.ok === 2 && s.warn === 1 && s.fail === 1 && s.verdict === '阻断')
  const s2 = summarize([{ level: 'ok' }, { level: 'ok' }, { level: 'warn' }])
  t('汇总行：warn 不阻断（→处置后复跑，exit 仍 0）', s2.verdict === '处置后复跑' && exitCodeFrom({ failCount: s2.fail }) === 0)

  // 向量5：g3 批（deploy-hostfacts-split 清偿）宿主事实派生纯函数——红态=函数
  // 未落→FAIL 不崩（typeof 守卫惯例，同本件向量2 风格）
  const g3Def = typeof deriveHostFacts === 'function' ? deriveHostFacts : null
  const g3Differ = typeof hostFactsDiffer === 'function' ? hostFactsDiffer : null
  const fxDef = { providers: {
    uniq: { uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' },
    none: { uuid_prefix: 'bbbbbbbb', entry_name: 'E-B' },
    ambi: { uuid_prefix: 'cccccccc', entry_name: 'E-Y1' },
    same: { uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' },
  } }
  const fxHost = { provider: {
    'aaaaaaaa-1111': { name: 'E-A' },
    'yyyyyyyy-3333': { name: 'E-Y1' },
    'yyyyyyyy-4444': { name: 'E-Y1' },
    'zzzzzzzz-5555': { name: 'E-Z' },
  } }
  const dfx = g3Def ? deriveHostFacts(fxDef, fxHost) : null
  t('g3 派生：唯一命中→{uuid_prefix:id 前 8 字符, entry_name}', !!dfx && JSON.stringify(dfx.providers.uniq) === JSON.stringify({ uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' }))
  t('g3 派生：零命中→unmatched（不猜）', !!dfx && JSON.stringify(dfx.unmatched) === JSON.stringify(['none']))
  t('g3 派生：同 entry_name≥2 命中→ambiguous（歧义不猜）', !!dfx && JSON.stringify(dfx.ambiguous) === JSON.stringify(['ambi']))
  t('g3 派生：hostUnconsumed 归集（宿主有而默认件未用的条目名=候选信息）', !!dfx && JSON.stringify(dfx.hostUnconsumed) === JSON.stringify(['E-Z(zzzzzzzz)']))
  const fxDef2 = { providers: { a: { uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' }, b: { uuid_prefix: 'zzzzzzzz', entry_name: 'E-Z' } } }
  const fxHost2 = { provider: { 'aaaaaaaa-9999': { name: 'E-A' }, 'zzzzzzzz-8888': { name: 'E-Z' } } }
  const d2 = g3Def ? deriveHostFacts(fxDef2, fxHost2) : null
  t('g3 判定：全命中且值与默认件完全一致→hostFactsDiffer=false（不写盘）', !!d2 && !d2.unmatched.length && !d2.ambiguous.length && g3Differ(d2, fxDef2) === false)
  const d3 = g3Def ? deriveHostFacts({ providers: { a: { uuid_prefix: 'deadbeef', entry_name: 'E-A' } } }, { provider: { 'aaaaaaaa-1111': { name: 'E-A' } } }) : null
  t('g3 判定：uuid 前缀漂移→hostFactsDiffer=true（须派生覆盖件）', !!d3 && g3Differ(d3, { providers: { a: { uuid_prefix: 'deadbeef', entry_name: 'E-A' } } }) === true)

  // 向量6：installHostFacts 写盘决策（fixture=临时目录，禁动真实状态）
  if (typeof installHostFacts === 'function') {
    const fxDir = mkdtempSync(join(tmpdir(), 'deploy-check-g3-'))
    try {
      const p1 = join(fxDir, 'case1.json')
      writeFileSync(p1, '{"providers":{"keep":1}}')
      const r1 = installHostFacts(fxDef, fxHost, p1)
      t('g3 install：覆盖件已存在→绝不覆盖（原内容不动）', r1.wrote === false && readFileSync(p1, 'utf8').includes('"keep"'))
      const p2 = join(fxDir, 'case2.json')
      const r2 = installHostFacts(fxDef, fxHost, p2)
      t('g3 install：有 unmatched/ambiguous→不写文件（指引手工路径）', r2.wrote === false && r2.line.includes('DEPLOY §3') && !existsSync(p2))
      const p3 = join(fxDir, 'case3.json')
      const r3 = installHostFacts(fxDef2, fxHost2, p3)
      t('g3 install：全命中且与默认件一致→不写文件（无冗余件）', r3.wrote === false && r3.line.includes('无需覆盖件') && !existsSync(p3))
      const p4 = join(fxDir, 'case4.json')
      const r4 = installHostFacts({ providers: { a: { uuid_prefix: 'deadbeef', entry_name: 'E-A' } } }, { provider: { 'aaaaaaaa-1111': { name: 'E-A' } } }, p4)
      const back4 = existsSync(p4) ? JSON.parse(readFileSync(p4, 'utf8')) : null
      t('g3 install：漂移→写覆盖件（note 声明+派生 providers+落盘回读一致）', r4.wrote === true && !!back4 && typeof back4.note === 'string' && back4.note.includes('deploy-check --install') && JSON.stringify(back4.providers) === JSON.stringify({ a: { uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' } }))
      // 回炉轮 1 R1：写盘 IO 抛错→FAIL 结果带真因（红态=裸抛不入结果集——
      // 旧结构下该错会被调用方笼统报成「宿主配置装载失败」warn=真因掩盖）
      const blocker = join(fxDir, 'blocker-file')
      writeFileSync(blocker, 'x')
      const p5 = join(blocker, 'nested', 'case5.json') // 父级是文件→mkdir/write 必抛 IO 错
      const r5run = (() => { try { return { r: installHostFacts({ providers: { a: { uuid_prefix: 'deadbeef', entry_name: 'E-A' } } }, { provider: { 'aaaaaaaa-1111': { name: 'E-A' } } }, p5) } } catch (e) { return { e } } })()
      t('g3 install：写盘 IO 抛错→FAIL 结果带真因（不裸抛/不误归因装载失败）', r5run.r?.level === 'FAIL' && r5run.r.line.includes('写盘/回读失败') && r5run.r.line.includes(blocker))
      // 回炉轮 1 R4（门一 N5）：仅 unmatched / 仅 ambiguous 两分支单独钉
      const fxOnlyU = { providers: { uniq: { uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' }, none: { uuid_prefix: 'bbbbbbbb', entry_name: 'E-B' } } }
      const pU = join(fxDir, 'onlyU.json')
      const rU = installHostFacts(fxOnlyU, fxHost, pU)
      t('g3 install：仅 unmatched（无 ambiguous）→不写+指引（行含 none/歧义槽=无）', rU.wrote === false && !existsSync(pU) && rU.line.includes('none') && rU.line.includes('歧义（同 entry_name≥2）=无') && rU.line.includes('DEPLOY §3'))
      const fxOnlyA = { providers: { uniq: { uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' }, ambi: { uuid_prefix: 'cccccccc', entry_name: 'E-Y1' } } }
      const pA = join(fxDir, 'onlyA.json')
      const rA = installHostFacts(fxOnlyA, fxHost, pA)
      t('g3 install：仅 ambiguous（无 unmatched）→不写+指引（行含 ambi/零命中槽=无）', rA.wrote === false && !existsSync(pA) && rA.line.includes('ambi') && rA.line.includes('无宿主命中 alias=无') && rA.line.includes('DEPLOY §3'))
      // 回炉轮 2 R5（W1-r1）：hostCfg=null 注入——不裸抛+不写+指引行（全别名
      // 入 unmatched；理论形态纵深防御面，实装缺席必抛 ENOENT——主控定性）
      const pN = join(fxDir, 'nullhost.json')
      const rN = (() => { try { return { r: installHostFacts(fxOnlyU, null, pN) } } catch (e) { return { e } } })()
      t('g3 install：hostCfg=null 注入→不裸抛+不写+指引（全别名入 unmatched）', rN.r?.wrote === false && rN.r.level === 'warn' && !existsSync(pN) && rN.r.line.includes('alias=uniq、none') && rN.r.line.includes('DEPLOY §3'))
    } finally {
      rmSync(fxDir, { recursive: true, force: true })
    }
  } else {
    t('g3 install：installHostFacts 已导出（红态=函数未落）', false)
  }

  // 向量7：v2.1.0 三层化批 installLocalConfig（fixture=临时目录，禁动真实状态）
  {
    const fxDir = mkdtempSync(join(tmpdir(), 'deploy-check-lc-'))
    try {
      const def = { providers: { a: { uuid_prefix: 'TODO', entry_name: 'TODO', note: 'x' } } }
      const p1 = join(fxDir, 'case1.json')
      writeFileSync(p1, '{"providers":{"keep":1}}')
      const r1 = installLocalConfig(def, p1)
      t('v2.1.0 ③a：本机件已存在→绝不覆盖（原内容不动）', r1.wrote === false && r1.level === 'ok' && readFileSync(p1, 'utf8').includes('"keep"'))
      const p2 = join(fxDir, 'case2.json')
      const r2 = installLocalConfig(def, p2)
      const back2 = existsSync(p2) ? JSON.parse(readFileSync(p2, 'utf8')) : null
      t('v2.1.0 ③a：缺失→最小骨架脚手架（个人分区占位+域声明；不含通用分区——回炉 W6）', r2.wrote === true && r2.level === 'ok' && !!back2 && typeof back2.note === 'string' && back2.note.includes('用户配置域') && back2.providers?.a?.uuid_prefix === 'TODO' && 'agent_bindings' in back2 && !('finish_vocab' in back2) && !('thresholds' in back2))
      const p2b = join(fxDir, 'case2b.json')
      writeFileSync(p2b, '{broken json')
      const r2b = installLocalConfig(def, p2b)
      t('v2.1.0 ③a：本机件存在但坏 JSON→warn 非假 ok（回炉 W10c）', r2b.wrote === false && r2b.level === 'warn' && r2b.line.includes('不可解析'))
      const blocker = join(fxDir, 'blocker-file')
      writeFileSync(blocker, 'x')
      const p3 = join(blocker, 'nested', 'case3.json') // 父级是文件→写盘必抛 IO 错
      const r3 = (() => { try { return { r: installLocalConfig(def, p3) } } catch (e) { return { e } } })()
      t('v2.1.0 ③a：写盘 IO 抛错→FAIL 结果带真因（不裸抛）', r3.r?.level === 'FAIL' && r3.r.line.includes('写盘/回读失败'))
    } finally {
      rmSync(fxDir, { recursive: true, force: true })
    }
  }

  // 向量8：v2.1.0 批4 渲染（占位→实值全替换；缺绑定保留+点名；无占位恒等）
  t('v2.1.0 渲染：全部占位一次替换（frontmatter+尾栏同串）', (() => { const r = renderAgentTemplate('model: {{binding:ops-x}}\nSELF: model-field:{{binding:ops-x}}', { 'ops-x': 'aaaa/k3$max' }); return r.text === 'model: aaaa/k3$max\nSELF: model-field:aaaa/k3$max' && r.missing.length === 0 })())
  t('v2.1.0 渲染：缺绑定→占位保留+点名（禁静默带占位部署）', (() => { const r = renderAgentTemplate('model: {{binding:ops-y}}', { 'ops-x': 'v' }); return r.text === 'model: {{binding:ops-y}}' && r.missing.join() === 'ops-y' })())
  t('v2.1.0 渲染：无占位模板恒等（未绑定岗模板不受影响）', (() => { const r = renderAgentTemplate('无占位模板正文', {}); return r.text === '无占位模板正文' && r.missing.length === 0 })())
  t('v2.1.0 回炉：畸形占位（空格/点号/未闭合形态）→渲染后残留 tripwire 计入 missing（k1 W-2/轮2 W-2）', (() => { const r1 = renderAgentTemplate('model: {{binding: ops-x}}', {}); const r2 = renderAgentTemplate('model: {{binding:ops.x}}', {}); const r3 = renderAgentTemplate('model: {{binding:ops-x', {}); return r1.missing.some((m) => m.startsWith('malformed:')) && r2.missing.some((m) => m.startsWith('malformed:')) && r3.missing.some((m) => m.includes('未闭合')) && r1.text.includes('{{binding: ops-x}}') })())
  t('v2.1.0 渲染：sha256Text 稳定（64 hex）', /^[0-9a-f]{64}$/.test(sha256Text('x')) && sha256Text('x') === sha256Text('x'))

  // ── P2 批（2026-10-22）：两字段渲染 parseBindingValue/thoughtLevel + 四项检查 ──
  const pbv = typeof parseBindingValue === 'function' ? parseBindingValue : null
  t('P2 parseBindingValue：旧格式字符串 provider/model$level 拆分（full 保留 $ 档位）', (() => {
    const r = pbv && pbv('prov-x/model-a$max')
    return !!r && r.model === 'prov-x/model-a' && r.level === 'max' && r.full === 'prov-x/model-a$max'
  })())
  t('P2 parseBindingValue：无档位字符串 level=null；对象形态合成 full；非法形态 null', (() => {
    if (!pbv) return false
    const a = pbv('prov-x/model-a')
    const b = pbv({ model: 'prov-x/model-b', level: 'high' })
    const bad = [pbv({ model: '', level: 'max' }), pbv({ model: 'x/y', level: 'ultra' }), pbv(null), pbv(42)]
    return a?.level === null && a?.full === 'prov-x/model-a' && b?.full === 'prov-x/model-b$high' && b?.level === 'high' && bad.every((x) => x === null)
  })())
  const p2Tpl = (extra = '') => `---\nname: ops-x\nmodel: {{binding:ops-x}}\n${extra}---\n\n正文 model-field:{{binding:ops-x}}\n`
  t('P2 渲染：旧格式字符串绑定→frontmatter model 无 $ 且 thoughtLevel 插入', (() => {
    const r = renderAgentTemplate(p2Tpl(), { 'ops-x': 'prov-a/model-a$max' })
    const ls = r.text.split('\n')
    const mi = ls.findIndex((l) => l.startsWith('model: '))
    return r.missing.length === 0 && ls[mi] === 'model: prov-a/model-a' && ls[mi + 1] === 'thoughtLevel: max'
  })())
  t('P2 渲染：对象绑定 {model,level}→同规则（model 无 $ + thoughtLevel）', (() => {
    const r = renderAgentTemplate(p2Tpl(), { 'ops-x': { model: 'prov-b/model-b', level: 'high' } })
    const ls = r.text.split('\n')
    const mi = ls.findIndex((l) => l.startsWith('model: '))
    return r.missing.length === 0 && ls[mi] === 'model: prov-b/model-b' && ls[mi + 1] === 'thoughtLevel: high'
  })())
  t('P2 渲染：正文占位保留完整声明 provider/model$level（供 MODEL-SELF 自报行）', (() => {
    const r = renderAgentTemplate(p2Tpl(), { 'ops-x': 'prov-a/model-a$max' })
    return r.text.includes('正文 model-field:prov-a/model-a$max') && !/^model: .*\$/.test(r.text)
  })())
  t('P2 渲染：模板已有 thoughtLevel 且等于绑定档位→不重复插入/不报错', (() => {
    const r = renderAgentTemplate(p2Tpl('thoughtLevel: max\n'), { 'ops-x': 'prov-a/model-a$max' })
    return r.missing.length === 0 && (r.text.match(/^thoughtLevel:/gm) || []).length === 1
  })())
  t('P2 渲染：thoughtLevel 冲突→missing 含 conflict:thoughtLevel 点名', (() => {
    const r = renderAgentTemplate(p2Tpl('thoughtLevel: low\n'), { 'ops-x': 'prov-a/model-a$max' })
    return r.missing.some((m) => m.startsWith('conflict:thoughtLevel:')) && r.missing.some((m) => m.includes('ops-x'))
  })())
  t('P2 渲染：无档位绑定且模板无 thoughtLevel→missing 含 missing-level 点名', (() => {
    const r = renderAgentTemplate(p2Tpl(), { 'ops-x': 'prov-a/model-a' })
    return r.missing.some((m) => m.startsWith('missing-level:')) && r.missing.some((m) => m.includes('ops-x'))
  })())
  t('P2 渲染：未绑定模板（frontmatter 无 model 行）→恒等且零缺失', (() => {
    const tpl = '---\nname: ops-probe\n---\n\n正文无占位\n'
    const r = renderAgentTemplate(tpl, {})
    return r.text === tpl && r.missing.length === 0
  })())
  const mnd = typeof checkModelNoDollar === 'function' ? checkModelNoDollar : null
  t('P2 检查 model-no-dollar：含 $→FAIL / 不含→ok / 无 model 行→跳过', (() => {
    return !!mnd && mnd('---\nmodel: a/b$max\n---\n').level === 'FAIL' && mnd('---\nmodel: a/b\n---\n').level === 'ok' && mnd('---\nname: x\n---\n').level === 'ok'
  })())
  const ctl = typeof checkThoughtLevel === 'function' ? checkThoughtLevel : null
  t('P2 检查 thoughtLevel：low/high/max→ok；缺失/非法→FAIL', (() => {
    return !!ctl && ctl('max').level === 'ok' && ctl('low').level === 'ok' && ctl('high').level === 'ok' && ctl(null).level === 'FAIL' && ctl('ultra').level === 'FAIL'
  })())
  const chv = typeof checkHostVersion === 'function' ? checkHostVersion : null
  t('P2 检查 host-version：3.15.1/3.16.2→ok；3.15.0→FAIL；abc/空→warn', (() => {
    return !!chv && chv('3.15.1').level === 'ok' && chv('3.16.2').level === 'ok' && chv('3.16.2-beta.1').level === 'ok' && chv('3.15.0').level === 'FAIL' && chv('abc').level === 'warn' && chv('').level === 'warn'
  })())
  const can = typeof checkAgentName === 'function' ? checkAgentName : null
  t('P2 检查 agent-name：新式名与 slot/渲染值一致→ok', (() => {
    const r = can && can('ops-executor-ds-max.md', { provider: 'ds', model: 'deepseek-flash', level: 'max' }, { model: 'syn-uuid-ops-1/deepseek-flash', level: 'max' })
    return !!r && r.level === 'ok'
  })())
  t('P2 检查 agent-name：文件中段 provider 不符→FAIL', (() => {
    const r = can && can('ops-executor-glm-max.md', { provider: 'ds', model: 'deepseek-flash', level: 'max' }, { model: 'syn-uuid-ops-1/deepseek-flash', level: 'max' })
    return !!r && r.level === 'FAIL'
  })())
  t('P2 检查 agent-name：legacy 名→跳过（不计 warn）', (() => {
    const r = can && can('ops-gate1-k1.md', undefined, { model: 'x/y', level: 'max' })
    return !!r && r.level === 'skip' && r.skipped === true
  })())
  t('P2 检查 agent-name：两参调用只核名/slot；renderedModel/Level 携带渲染值参与核对', (() => {
    const a = can && can('ops-executor-ds-max.md', { provider: 'ds', model: 'deepseek-flash', level: 'max' })
    const b = can && can('ops-executor-ds-max.md', { provider: 'ds', model: 'deepseek-flash', level: 'max', renderedModel: 'uuid/deepseek-flash', renderedLevel: 'max' })
    const c = can && can('ops-executor-ds-max.md', { provider: 'ds', model: 'deepseek-flash', level: 'max', renderedModel: 'uuid/other', renderedLevel: 'max' })
    return a?.level === 'ok' && b?.level === 'ok' && c?.level === 'FAIL'
  })())
  // 装配岗批（D-2/D-3）：checkAgentName assembler 正负例——正例带 .md 后缀命中去后缀正则；
  // 负例按现行不匹配 skip 语义断言（不新增 FAIL 语义）。
  t('装配岗批 agent-name：ops-assembler-699-max.md 与 slot/渲染值一致→ok', (() => {
    const r = can && can('ops-assembler-699-max.md', { provider: '699', model: 'k3.1-pro', level: 'max' }, { model: 'new-provider/k3.1-pro', level: 'max' })
    return !!r && r.level === 'ok'
  })())
  t('装配岗批 agent-name：assembler 非法档位形态→skip（现行不匹配语义，不新增 FAIL）', (() => {
    const r = can && can('ops-assembler-699-ultra.md', { provider: '699', model: 'k3.1-pro', level: 'max' })
    return !!r && r.level === 'skip' && r.skipped === true
  })())
  // 返工轮 1 B1：未解析占位不豁免 thoughtLevel 检查——有 model 行即检查，缺档位=FAIL
  t('P2 检查：未解析占位+thoughtLevel 缺失→组合结果 FAIL（占位不构成豁免）', (() => {
    const r = renderAgentTemplate(p2Tpl(), {})
    const fm = readFrontmatterFields(r.text)
    const combined = fm.hasModel ? checkThoughtLevel(fm.thoughtLevel) : null
    return r.missing.length > 0 && r.text.includes('{{binding:ops-x}}') && fm.hasModel === true && fm.thoughtLevel === null && checkThoughtLevel(null).level === 'FAIL' && combined?.level === 'FAIL'
  })())

  // ── B1 批（D-4/D-8）向量：⑧ project-gate 判定三态＋⑦ 项目账本目录试写（tmp 夹具） ──
  t('B1 project-gate：rc=0→ok（行含 project-gate ok）', projectGateVerdict({ scriptExists: true, rc: 0 }).level === 'ok' && projectGateVerdict({ scriptExists: true, rc: 0 }).line.includes('project-gate ok'))
  t('B1 project-gate：rc≠0→FAIL（行含同款命令与 exit 码）', projectGateVerdict({ scriptExists: true, rc: 1 }).level === 'FAIL' && projectGateVerdict({ scriptExists: true, rc: 1 }).line.includes('exit 1'))
  t('B1 project-gate：脚本缺件→FAIL（不静默跳过）', projectGateVerdict({ scriptExists: false }).level === 'FAIL' && projectGateVerdict({ scriptExists: false }).line.includes('缺 scripts'))
  {
    const fx = mkdtempSync(join(tmpdir(), 'deploy-check-pg-'))
    try {
      const r1 = checkLedgerDirPath(join(fx, 'led'), 'tmp 账本目录') // 目录缺省顺带创建
      const probeLeft = existsSync(join(fx, 'led', `.deploy-check-probe-${process.pid}`))
      t('B1 ledger-dir：tmp 目录试写→ok＋探针随删＋目录顺带创建', r1.level === 'ok' && !probeLeft && existsSync(join(fx, 'led')))
      const blocker = join(fx, 'blocker')
      writeFileSync(blocker, 'x')
      const r2 = checkLedgerDirPath(join(blocker, 'nested'), '阻断目录')
      t('B1 ledger-dir：父级是文件→FAIL（不裸抛）', r2.level === 'FAIL' && r2.line.includes('不可写'))
    } finally {
      rmSync(fx, { recursive: true, force: true })
    }
  }

  console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
  process.exit(fails === 0 ? 0 : 1)
}

// ── CLI ──
const isMain =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) selfTest()

  // 自身装载错守卫（exit 3 族）：templates/agents 缺失（清单单源不可用）
  if (!existsSync(TEMPLATES_AGENTS)) {
    console.error('[装载错] templates/agents/ 缺失——代理清单单源不可用（重装本仓后复跑）')
    process.exit(EXIT_SELF_ERROR)
  }

  // g3 批（evolve-l4-flags/P9 收敛）：--agents-dir 缺值/值形如 flag/重复→
  // [用法错] exit 1——原 `|| DEFAULT_AGENTS_DIR` 对缺值静默回退默认目录（假动作面）
  let agentsDir = DEFAULT_AGENTS_DIR
  let projectDir = null
  try {
    if (argv.includes('--agents-dir')) agentsDir = cliFlag(argv, '--agents-dir')
    if (argv.includes('--project')) {
      projectDir = cliFlag(argv, '--project')
      if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) { console.error(`[用法错] --project 不是存在目录：${projectDir}`); process.exit(1) }
    }
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`[用法错] ${e.message}`)
      process.exit(1)
    }
    throw e
  }

  let installFailCount = 0
  if (argv.includes('--install')) {
    console.log('[install] 首装模式——四动作：③a本机件脚手架（org-config.local.json，v2.1.0 三层化批）/ ④补缺失代理件 / ⑤hooksPath 未设时补设 / ③宿主事实派生项目覆盖件（护栏：不覆盖已存在件/不改 org-config.default.json 与宿主配置）')
    // ③a 先行：本机件就位后，后续 loadOrgConfig 的合并结果才含本机实值
    let lcLine = 'install-localconfig——跳过：默认件装载失败'
    try {
      lcLine = installLocalConfig(readJson(join(SKILL_ROOT, 'org-config.default.json')), join(SKILL_ROOT, 'org-config.local.json')).line
    } catch (e) {
      lcLine = `install-localconfig——跳过：默认件装载失败（${e.message}）——处置=核对 org-config.default.json 后复跑`
    }
    console.log(`[install] ${lcLine}`)
    let tplBindings = {}
    let tplLoadErr = null
    try { tplBindings = loadOrgConfig(SKILL_ROOT).merged.agent_bindings || {} } catch (e) { tplLoadErr = e.message /* 回炉 W10a：真因分行呈现，不并入「缺绑定」误归因 */ }
    if (tplLoadErr) console.log(`[warn] agent_bindings 装载失败（${tplLoadErr}）——下行如报「占位缺绑定」可能为误归因，先修本机件 JSON`)
    console.log(`[install] ${installAgents(agentsDir, tplBindings).line}`)
    console.log(`[install] ${installHook()}`)
    // g3 动作③（回炉轮 1 R1/R2 重构错误处置——门一 W2/W3）：三源分行归因——
    // ① org-config 装载失败（默认件/覆盖件坏）→干净跳过（warn+指引，不裸崩
    //    不硬停 install 其余动作；覆盖件=用户手改域，note 明示装后可自由改写）；
    // ② 宿主配置装载失败→跳过+指引（现语义维持）；
    // ③ installHostFacts 自包写盘段 try/catch——IO/回读抛错=FAIL 结果带真因，
    //    [FAIL] 行计入阻断（exit 1），不再笼统误报「宿主配置装载失败」。
    let hf
    let oc = null
    try {
      oc = loadOrgConfig(SKILL_ROOT)
    } catch (e) {
      hf = { wrote: false, level: 'warn', line: `install-hostfacts——跳过：org-config 装载失败（${e.message}）——处置=修复或移除 .zcode/org-config.json（用户域件）/核对默认件后复跑；手工路径=DEPLOY §3` }
    }
    if (oc) {
      let hostCfg = null
      try {
        hostCfg = readHostConfig()
      } catch (e) {
        hf = { wrote: false, level: 'warn', line: `install-hostfacts——跳过：宿主配置装载失败（${e.message}）——手工路径=DEPLOY §3` }
      }
      if (hostCfg) hf = installHostFacts(oc.merged, hostCfg, oc.overPath)
      // 回炉轮 2 R5（W1-r1，纵深防御——evolve-b6 同族）：readHostConfig 返
      // falsy 的兜底（改述 g3-w1r1：宿主 config 内容为字面 null=合法 JSON，
      // readJson 不抛错、readHostConfig 返 null——极端罕见但可达，非「不可达」；
      // 缺席文件形态实装必抛 ENOENT 走上行 catch——补 else 消 hf 未定义暴露面，
      // 非修活缺陷）
      else
        hf = { wrote: false, level: 'warn', line: `install-hostfacts——跳过：宿主配置不可读/缺席（readHostConfig 返回 ${hostCfg === null ? 'null' : typeof hostCfg}——理论形态，实装缺席必抛 ENOENT 由装载失败行承接）——手工路径=DEPLOY §3` }
    }
    if (hf.level === 'FAIL') installFailCount++
    console.log(hf.level === 'FAIL' ? `[FAIL] ${hf.line}` : `[install] ${hf.line}`)
  }

  // --sync-agents（P2）：显式重渲染模式——只做同步即退出（不与检查面混跑；
  // 与 --install 并列：同给时先执行 install 三动作再全量同步覆盖，各自语义不动）。
  if (argv.includes('--sync-agents')) {
    let syncCfg
    try {
      syncCfg = loadOrgConfig(SKILL_ROOT).merged
    } catch (e) {
      console.error(`[装载错] org-config 装载失败：${e.message}`)
      process.exit(EXIT_SELF_ERROR)
    }
    const sync = syncAgents(agentsDir, syncCfg.agent_bindings || {})
    process.exit(sync.level === 'ok' ? 0 : 1)
  }

  // 自身装载错守卫（exit 3 族）：org-config 装载失败（检查主体消费 cfg——
  // 回炉轮 1 R2 后移至 install 块后：坏覆盖件时 install 三动作先执行、③ 打印
  // 干净跳过行，再到此处按装载错退 3，不再整场前置短路）
  let cfg
  try {
    cfg = loadOrgConfig(SKILL_ROOT).merged
  } catch (e) {
    console.error(`[装载错] org-config 装载失败：${e.message}`)
    process.exit(EXIT_SELF_ERROR)
  }

  let results
  try {
    results = runChecks(agentsDir, cfg, projectDir)
  } catch (e) {
    if (e instanceof SelfLoadError) {
      console.error(`[装载错] ${e.message}`)
      process.exit(EXIT_SELF_ERROR)
    }
    throw e
  }
  const sum = summarize(results)
  // 回炉轮 1 R1：install 动作③ 的 FAIL 计入阻断口径（sum 口径本身不动——
  // 门一 W2：写盘真因 FAIL 静默 warn=失败面掩盖）
  console.log(sum.line + (installFailCount ? `——另含 install 动作 FAIL ×${installFailCount}（计入阻断）` : ''))
  process.exit(exitCodeFrom({ failCount: sum.fail + installFailCount }))
}
