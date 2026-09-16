/**
 * 硬编码事实扫描（P0-3）：扫 .md 正文中的**供应商 live 事实**（端点 URL / 供应商
 * 主机名 / 实配模型名），落实 06 §0「零硬编码声明」与 08 §1 寻址表
 * 「供应商路由事实禁止出现在任何 .md 正文」——把声明变成机检（A2）。
 *
 * 设计（W-6 终裁）：
 *  - 名单**从 org-config 派生**（hardcode_scan.*），脚本禁硬编码供应商事实（A3）。
 *    通用语法形态（http(s):// 与 api.<host>）属语法非事实，留脚本内。
 *  - 白名单独立 JSON 文件（not .md——避免 .md 白名单被自身扫中）。
 *  - WARN 起步（升格判据未定，W-6）；`--strict` 时按 RED 退出。
 *  - 安排性提及边界（08 §1）：岗位×供应商分工链**描述**可写；端点/实配名不可。
 *
 * B-1 扩展（2026-09-16，05 §五+W-1/W-6 终裁+B-2 裁决②③）：
 *  - 实配模型名词表：从宿主供应商注册表（~/.zcode/v2/config.json）派生模型键，
 *    大小写+分隔符归一变体（GLM-5.3-Flash / glm-5.3 / GLM5.3flash 同一命中）。
 *  - agents 目录扫描：`--agents`（缺省 ~/.zcode/agents），范围限 ops-*.md（N-1），
 *    **剥离 frontmatter 只扫正文**（B-2 裁决②——frontmatter model 值=配置面合法形态）。
 *
 * 用法：node scripts/check-hardcode.mjs [--root <技能根>] [--strict] [--agents <dir>]
 *       [--whitelist <path>] [--self-test]
 * 退出码：0=无命中/WARN；1=有命中且 --strict；3=配置错误/自检失败。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { homedir } from 'node:os'
import { SKILL_ROOT, loadOrgConfig } from './org-config.mjs'

const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const root = flag('--root') || SKILL_ROOT
const strict = argv.includes('--strict')
const agentsDir = argv.includes('--agents') ? (flag('--agents') || join(homedir(), '.zcode', 'agents')) : null
const whitelistPath = flag('--whitelist') || join(SKILL_ROOT, 'scripts', 'hardcode-whitelist.json')
const HOST_CFG = join(homedir(), '.zcode', 'v2', 'config.json')

const GENERIC = [
  { name: 'URL', re: /https?:\/\/[^\s`"')\]]+/g },
  { name: 'API主机', re: /\bapi\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi },
]

/** 从 org-config 派生供应商事实名单（禁脚本硬编码——W-6/A3）。 */
export function deriveTerms(merged) {
  const terms = []
  for (const t of merged?.hardcode_scan?.forbidden_terms || []) terms.push({ name: '配置名单', re: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') })
  return terms
}

/** 模型名→归一变体正则（大小写归一+分隔符可省：glm-5.3/glm5.3/GLM 5.3 同一命中，W-6）。 */
export function modelVariants(name) {
  const parts = name.split(/[-_.\s]+/).filter(Boolean)
  if (!parts.length) return null
  const body = parts.map((p, i) => (i ? '[-_.\\s ]?' : '') + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')
  return new RegExp(`(?<![\\w-])${body}(?![\\w-])`, 'gi')
}

/** 从宿主供应商注册表派生实配模型名词表（B-1；词表数据源=host config，脚本零硬编码）。 */
export function deriveHostModelTerms(hostCfgPath = HOST_CFG) {
  const terms = []
  if (!existsSync(hostCfgPath)) return terms
  let cfg
  try { cfg = JSON.parse(readFileSync(hostCfgPath, 'utf8')) } catch { return terms }
  const seen = new Set()
  for (const p of Object.values(cfg.provider || {})) {
    for (const mk of Object.keys(p.models || {})) {
      if (seen.has(mk)) continue
      seen.add(mk)
      const re = modelVariants(mk)
      if (re) terms.push({ name: `实配模型名(${mk})`, re })
    }
  }
  return terms
}

/** 剥离 YAML frontmatter（--- … ---），只留正文（B-2 裁决②）。 */
export function stripFrontmatter(text) {
  const t = text.replace(/^\uFEFF/, '')
  if (!t.startsWith('---')) return t
  const end = t.indexOf('\n---', 3)
  return end < 0 ? t : t.slice(end + 4)
}

export function loadWhitelist(path = whitelistPath) {
  if (!existsSync(path)) return []
  try { return JSON.parse(readFileSync(path, 'utf8')).entries || [] } catch { return [] }
}

/** 白名单规则匹配（B-1 修复：增 file_prefix 锚定——契约行豁免不得外溢到普通行）。 */
export function ruleMatches(w, relPath, line) {
  if (w.file && !relPath.endsWith(w.file)) return false
  if (w.file_prefix && !relPath.startsWith(w.file_prefix)) return false
  if (w.contains && !line.includes(w.contains)) return false
  return true
}

/** 纯函数扫描（可注入 fixtures——自检用；extraTerms=B-1 宿主词表注入位）。 */
export function scanText({ relPath, text, merged, whitelist = [], extraTerms = [] }) {
  const hits = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const patterns = [...GENERIC, ...deriveTerms(merged), ...extraTerms]
  lines.forEach((line, i) => {
    for (const p of patterns) {
      const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g')
      for (const m of line.matchAll(re)) {
        const wl = whitelist.some((w) => ruleMatches(w, relPath, line))
        hits.push({ file: relPath, line: i + 1, kind: p.name, match: m[0], whitelisted: wl })
      }
    }
  })
  return hits
}

function listMd(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === '_archive' || e.name === 'scripts' || e.name === 'templates') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...listMd(p))
    else if (e.name.endsWith('.md') && !e.name.startsWith('2026-')) out.push(p) // 排除审计档（历史件）
  }
  return out
}

function selfTest() {
  const merged = { hardcode_scan: { forbidden_terms: ['api.deepseek.com', 'bigmodel'] } }
  const cases = []
  const t = (n, c, d = '') => cases.push({ n, c: !!c, d })
  const wl = [{ file: 'audits.md', contains: '事故叙述' }]
  t('端点 URL 命中', scanText({ relPath: 'references/x.md', text: '见 https://api.foo.com/v1 说明', merged }).some((h) => h.kind === 'URL'))
  t('api 主机命中', scanText({ relPath: 'references/x.md', text: '调用 api.deepseek.com 接口', merged }).some((h) => h.kind === 'API主机'))
  t('配置名单命中', scanText({ relPath: 'references/x.md', text: 'bigmodel 直连', merged }).some((h) => h.kind === '配置名单'))
  t('白名单行豁免', scanText({ relPath: 'audits.md', text: 'api.deepseek.com 事故叙述', merged, whitelist: wl }).every((h) => h.whitelisted))
  t('干净文本零命中', scanText({ relPath: 'references/x.md', text: '主源拟定、备源兜底（无端点）', merged }).length === 0)
  // B-1：宿主模型词表变体（W-6 三形态负向用例）
  const terms = [{ name: '实配模型名(GLM-5.3-Flash)', re: modelVariants('GLM-5.3-Flash') }, { name: '实配模型名(k3)', re: modelVariants('k3') }]
  t('变体1 全称命中', scanText({ relPath: 'references/x.md', text: '通道走 GLM-5.3-Flash 判读', merged, extraTerms: terms }).some((h) => h.kind.startsWith('实配模型名')))
  t('变体2 小写带点命中（glm-5.3-flash）', scanText({ relPath: 'references/x.md', text: '通道写 glm-5.3-flash 也命中', merged, extraTerms: terms }).some((h) => h.kind.startsWith('实配模型名') && h.match.toLowerCase().includes('glm')))
  t('变体3 紧邻形态命中（glm5.3flash）', scanText({ relPath: 'references/x.md', text: '写成 glm5.3flash 也算', merged, extraTerms: terms }).some((h) => h.kind.startsWith('实配模型名')))
  t('短名误报防护（k3 不误伤 k30/k3x）', scanText({ relPath: 'references/x.md', text: '编号 k30 与 k3x 不命中', merged, extraTerms: terms }).filter((h) => h.kind === '实配模型名(k3)').length === 0)
  // B-2 裁决②：frontmatter 剥离
  const withFm = '---\nname: ops-x\nmodel: builtin:some/Model-X\n---\n正文提及 Model-X 直连'
  const stripped = stripFrontmatter(withFm)
  t('frontmatter 剥离（模型值不残留）', !stripped.includes('model:') && stripped.includes('正文提及'))
  t('无 frontmatter 原样返回', stripFrontmatter('普通正文') === '普通正文')
  // B-1 修复（审核 W-8）：契约行豁免须锚定——正例（契约行豁免）+反例（普通行同名仍命中）
  const wlAg = [{ file_prefix: 'agents/ops-', contains: 'MODEL-SELF: model-field:' }]
  const termsG = [{ name: '实配模型名(GLM-5.3)', re: modelVariants('GLM-5.3') }]
  t('契约行豁免（agents ops-* 的 MODEL-SELF 行）', scanText({ relPath: 'agents/ops-executor.md', text: 'MODEL-SELF: model-field:builtin:bigmodel-coding-plan/GLM-5.3', merged, whitelist: wlAg, extraTerms: termsG }).every((h) => h.whitelisted))
  t('反例：agents 普通行模型名仍命中（豁免不外溢）', scanText({ relPath: 'agents/ops-executor.md', text: '本岗跑 GLM-5.3 模型', merged, whitelist: wlAg, extraTerms: termsG }).some((h) => !h.whitelisted))
  t('反例：非 agents 文件含契约串不豁免', scanText({ relPath: 'references/x.md', text: 'MODEL-SELF: model-field:builtin:bigmodel-coding-plan/GLM-5.3', merged, whitelist: wlAg, extraTerms: termsG }).every((h) => !h.whitelisted))
  // W-8 补遗（r2 审核 W①）：file 后缀规则正反例
  const wlSuffix = [{ file: 'audits.md', contains: 'api.deepseek.com' }]
  const termsDs = [{ name: '配置名单', re: /api\.deepseek\.com/g }]
  t('file 后缀规则正例（指定文件+含串行豁免）', scanText({ relPath: 'audits.md', text: '调用 api.deepseek.com 事故叙述', merged, whitelist: wlSuffix, extraTerms: termsDs }).every((h) => h.whitelisted))
  t('file 后缀规则反例（他文件同串不豁免）', scanText({ relPath: 'references/y.md', text: '调用 api.deepseek.com', merged, whitelist: wlSuffix, extraTerms: termsDs }).every((h) => !h.whitelisted))
  // r3 审核 W 终项：contains-only 规则专用负例（不含串的行不获豁免）
  const wlCo = [{ contains: '事故叙述' }]
  t('contains-only 规则反例（不含串行不豁免）', scanText({ relPath: 'references/z.md', text: '调用 api.deepseek.com', merged, whitelist: wlCo, extraTerms: termsDs }).every((h) => !h.whitelisted))
  // r4 审核 W 终项：contains-only 规则专用正例（含串行豁免·任意文件）
  t('contains-only 规则正例（含串行豁免·任意文件）', scanText({ relPath: 'references/z.md', text: 'api.deepseek.com 事故叙述', merged, whitelist: wlCo, extraTerms: termsDs }).every((h) => h.whitelisted))
  const fail = cases.filter((x) => !x.c)
  for (const x of cases) console.log(`${x.c ? 'PASS' : 'FAIL'} ${x.n}${x.d ? ' — ' + x.d : ''}`)
  console.log(`check-hardcode 自检：${cases.length - fail.length}/${cases.length} 过`)
  return fail.length === 0
}

const { merged } = loadOrgConfig(process.cwd())
if (argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1)

const whitelist = loadWhitelist()
const hostTerms = deriveHostModelTerms()
const files = listMd(root)
const all = []
for (const f of files) all.push(...scanText({ relPath: relative(root, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8'), merged, whitelist, extraTerms: hostTerms }))
// agents 目录（--agents 时启用）：限 ops-*.md，剥离 frontmatter 只扫正文（B-2 裁决②③）
let agentsFiles = 0
if (agentsDir && existsSync(agentsDir)) {
  for (const e of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!e.isFile() || !/^ops-.*\.md$/.test(e.name)) continue // 限 ops-*.md（N-1：内置/插件代理不扫）
    agentsFiles++
    all.push(...scanText({ relPath: `agents/${e.name}`, text: stripFrontmatter(readFileSync(join(agentsDir, e.name), 'utf8')), merged, whitelist, extraTerms: hostTerms }))
  }
}
const effective = all.filter((h) => !h.whitelisted)
const W = process.stdout.write.bind(process.stdout)
for (const h of effective) W(`[WARN] ${h.file}:${h.line} ${h.kind} 命中「${h.match}」——供应商 live 事实不得写入 .md 正文（06 §0/08 §1）；改指针化（指向 org-config）或登记白名单（scripts/hardcode-whitelist.json）\n`)
if (all.length - effective.length) W(`[info] 白名单豁免 ${all.length - effective.length} 处（${whitelist.length} 条规则）\n`)
console.log(`check-hardcode 汇总：扫 ${files.length} 个 .md${agentsFiles ? ` + agents 目录 ${agentsFiles} 个 ops-*.md（frontmatter 已剥离）` : ''}，命中 ${effective.length} 处（白名单豁免 ${all.length - effective.length}；词表=org-config ${deriveTerms(merged).length} 条+宿主注册表 ${hostTerms.length} 条）${strict && effective.length ? '——strict：按 RED 处置，不得收口' : '（WARN 级——升格判据待定，W-6）'}`)
process.exit(strict && effective.length ? 1 : 0)
