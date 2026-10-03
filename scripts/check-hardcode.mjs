/**
 * 硬编码事实扫描（P0-3）：扫 .md 正文中的**供应商 live 事实**（端点 URL / 供应商
 * 主机名 / 实配模型名），落实 06 §0「零硬编码声明」与 08 §1 寻址表
 * 「供应商路由事实禁止出现在任何 .md 正文」——把声明变成机检（A2）。
 *
 * 设计（W-6 终裁）：
 *  - 名单**从 org-config 派生**（hardcode_scan.*），脚本禁硬编码供应商事实（A3）。
 *    通用语法形态（http(s):// 与 api.<host>）属语法非事实，留脚本内。
 *  - 白名单独立 JSON 文件（not .md——避免 .md 白名单被自身扫中）。
 *  - 升格 RED 已生效（selfiter 批 B6 清偿 W-6 愿望式升档）：配置位
 *    hardcode_scan.strict（缺省 true）+`--strict` 双入口，命中=RED 退出；
 *    `--warn`=试点校准期显式降级逃生口。
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
 * （--agents 须带值——裸 flag=用法错，v2.0.1 修复批 M4 收紧：原缺值静默回退
 *   默认 agents 目录=假动作面；扫描范围限 ops-*.md 剥 frontmatter）
 * 退出码口径单源=references/06 §5.8（此处不复写映射——evolve 批 b8
 * 指针化；回炉 r2 削 b8 残留碎片，降级行语义总表已载）。
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { SKILL_ROOT, loadOrgConfig, cliFlag, UsageError, readHostConfig, mergeHostRegistries } from './org-config.mjs'

const argv = process.argv.slice(2)
// flag 解析收编 cliFlag 单源（v2.0.1 修复批 M4：原裸 argv[i+1] 误吃下一 flag——
// 如 --agents --strict 会静默回退默认目录=g3 批自裁的「假动作面」漏网副本）
let root, agentsFlag, whitelistFlag
try {
  root = cliFlag(argv, '--root') || SKILL_ROOT
  agentsFlag = cliFlag(argv, '--agents')
  whitelistFlag = cliFlag(argv, '--whitelist')
} catch (e) {
  if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
  throw e
}
// 升格位（selfiter 批 B6 清偿 check-hardcode-promotion）：org-config
// hardcode_scan.strict（缺省 true）=命中即 RED 退出；--warn=显式降回 WARN
// （试点校准期逃生口——升格判据=B3 白名单收缩后连续 B4/B5 两批零误报零命中，
// 已满足）。effective strict 在配置装载后合流（见主流程尾）。
const warnMode = argv.includes('--warn')
let DEGRADED = false // 降级运行位（宿主配置/白名单损坏——显式留痕退出码 5，v1.6 批 P2-2：原静默吞错=strict 下假 RED/非 strict 假绿）
const agentsDir = argv.includes('--agents') ? agentsFlag : null // 门一回炉 W3：cliFlag 缺值即抛=裸 --agents 不可达回退（原「|| 默认目录」死代码已删——行为收紧申报：旧版裸 flag 静默扫默认目录，现=用法错 exit 1，g3「假动作面」立场一致）
const whitelistPath = whitelistFlag || join(SKILL_ROOT, 'scripts', 'hardcode-whitelist.json')

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

/** 从宿主供应商注册表派生实配模型名词表（B-1；词表数据源=host config，脚本零硬编码）。
 *  B3（2026-10-03 k1default 批）：读取面改单源复用 org-config readHostConfig（双注册表
 *  合并=mergeHostRegistries——旧件打底+新件 personalModelIds 物化为 models 键；宿主
 *  新供应商只落 v2/provider_config.json，单读旧件=新源模型键漏检面，禁写第三份读取）。
 *  降级语义同面：两件全缺/不可读=DEGRADED 退出码 5（readHostConfig 两件全缺显式抛→
 *  此处捕获降级；BOM 剥离由 readJson 承接）。cfg 参数=自检注入宿主合并配置对象
 *  （缺省=真实读取）。 */
export function deriveHostModelTerms(cfg = null) {
  const terms = []
  let hostCfg = cfg
  // 回炉 d1-W-4：入参类型守卫——旧路径串契约已随 B3 退役，字符串/数组入参会静默
  // 得空词表（'str'.provider=undefined）无 DEGRADED=终审 W4 消除过的静默漏检面
  // 复活，显式降级留痕（exit 5）拒静默。回炉 k2-N-3'：null=出合约哨兵（缺省
  // 真实读取的唯一下游=readHostConfig，其双缺=throw 不返 null），非静默豁免。
  if (hostCfg !== null && (typeof hostCfg !== 'object' || Array.isArray(hostCfg))) {
    console.error('[degraded] deriveHostModelTerms 入参形态非宿主合并配置对象（旧路径串契约已随 B3 退役——须传 mergeHostRegistries 返回形态或缺省真实读取）——按不可读降级为通用语法形态，退出码 5')
    DEGRADED = true; return terms
  }
  if (hostCfg === null) {
    try { hostCfg = readHostConfig() } catch (e) { console.error(`[degraded] 宿主配置不可读（${e.message}）——扫描降级为通用语法形态（漏检面=供应商词表），退出码 5`); DEGRADED = true; return terms }
  }
  const seen = new Set()
  for (const p of Object.values(hostCfg.provider || {})) {
    if (!p || typeof p !== 'object') { console.error('[degraded] 宿主配置 provider 含 null/非对象条目——该条目词表跳过、其余源继续扫（漏检面=该条目模型名），退出码 5（evolve-E2 b4：原 null 条目 TypeError 崩溃）'); DEGRADED = true; continue }
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
  let entries
  try { entries = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')).entries || [] } catch (e) { console.error(`[degraded] 白名单件不可读（${e.message}）——按零豁免执行（可能假 WARN），退出码 5`); DEGRADED = true; return [] }
  const { valid, invalid } = validateWhitelistRules(entries)
  // v2.0.1 修复批 L12：空条件规则（无 file/file_prefix/contains 任一）经
  // ruleMatches 恒真=对全部文件全部行全局放行，整个扫描静默失效——按无效
  // 丢弃+降级留痕（exit 5），禁静默执行
  if (invalid.length) {
    console.error(`[degraded] 白名单第 ${invalid.map((i) => `#${i + 1}`).join('/')} 号规则无任何条件字段（file/file_prefix/contains）——空条件=全放行面，该规则按无效丢弃，退出码 5（修复批 L12）`)
    DEGRADED = true
  }
  return valid
}

/** 白名单规则形态校验（纯函数，自检可注入——修复批 L12）：每条须含
 *  file/file_prefix/contains 至少一个非空字符串条件，否则=全局放行的空规则。 */
export function validateWhitelistRules(entries) {
  const valid = [], invalid = []
  entries.forEach((w, i) => {
    const hasCond = !!w && typeof w === 'object' &&
      ['file', 'file_prefix', 'contains'].some((k) => typeof w[k] === 'string' && w[k].length > 0)
    if (hasCond) valid.push(w); else invalid.push(i)
  })
  return { valid, invalid }
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
  // 确定性排序（selfiter 批 evolve-l3-sort 清偿）：readdirSync 枚举序跨平台/
  // 目录序不稳定——diff 对账与报告输出噪声面；一律按名排序后遍历
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === '_archive' || e.name === 'scripts' || e.name === 'templates') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...listMd(p))
    else if (e.name.endsWith('.md') && !/^\d{4}-\d{2}-\d{2}_/.test(e.name)) out.push(p) // 排除日期前缀审计档（历史件——形态判定；v1.6 批：原 '2026-' 年份硬编码 2027 即失效）
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
  // v2.0.1 修复批 L12 向量：空条件规则=全局放行面，形态校验须拒（红态=旧实现无校验静默收）
  const vw = typeof validateWhitelistRules === 'function' ? validateWhitelistRules([{ contains: 'x' }, {}, { file: '' }, null, { file_prefix: 'agents/' }]) : null
  t('L12 空条件规则（{}/空串/null）判无效、有条件规则放行', vw != null && vw.valid.length === 2 && vw.invalid.length === 3)
  // b4 向量（evolve-E2）：null provider 宿主条目→降级行（stderr 留痕）+其余源词表继续派生（exit 5 语义族，不崩溃）
  // B3（k1default 批 2026-10-03）起注入形态=宿主合并配置对象（原临时文件路径参数随读取面双注册表化退役）
  let hmTerms = null, hmErr = null, hmDegraded = false
  const hmBuf = []
  const hmOrigErr = console.error
  try {
    console.error = (...a) => hmBuf.push(a.join(' '))
    hmTerms = deriveHostModelTerms({ provider: { dead: null, live: { models: { 'B4Guard-Model': {} } } } })
  } catch (e) { hmErr = e.message } finally { console.error = hmOrigErr }
  hmDegraded = hmBuf.some((s) => s.includes('[degraded]') && s.includes('null'))
  t('b4 null provider→降级行+其余源词表继续派生（不崩）', hmErr === null && Array.isArray(hmTerms) && hmTerms.length === 1 && hmTerms[0].name.includes('B4Guard-Model') && hmDegraded)
  // B3 向量（k1default 批）：宿主新注册表独有模型键（personalModelIds 经
  // mergeHostRegistries 物化为 models 键）进词表——红态=单读旧件时该键漏检
  t('B3 新注册表独有模型键进词表（mergeHostRegistries 物化→变体正则派生）', (() => {
    const merged = mergeHostRegistries(null, { config: { providerConfigRules: { providerRules: [{ providerId: 'nonuuid-prov-b3', providerName: 'B3-N', config: { api: { baseUrl: 'https://new/n' }, personalModelIds: ['B3OnlyModel'] } }] } } })
    const terms = deriveHostModelTerms(merged)
    return terms.length === 1 && terms[0].name.includes('B3OnlyModel')
  })())
  // 回炉 d1-W-4 向量：旧路径串入参（退役契约误用）→ 显式降级非静默空词表
  t('B3 退役路径串入参=降级留痕非静默空词表（d1-W-4）', (() => {
    let degraded = false
    const orig = console.error, buf = []
    console.error = (...a) => buf.push(a.join(' '))
    let terms = null
    try { terms = deriveHostModelTerms('syn-fake-host.json') } finally { console.error = orig }
    degraded = buf.some((s) => s.includes('[degraded]') && s.includes('B3'))
    return Array.isArray(terms) && terms.length === 0 && degraded
  })())
  // selfiter 批（evolve-l3-sort）向量：清单确定性排序——红态=排序缺位时目录序
  // 原样透出（NTFS 常按建盘序非字典序），乱序建盘 fixture 拷打
  let l3ok = null
  try {
    const d = mkdtempSync(join(tmpdir(), 'hc-l3-'))
    try {
      for (const n of ['c.md', 'a.md', 'b.md']) writeFileSync(join(d, n), 'x', 'utf8')
      const got = listMd(d).map((p) => basename(p))
      l3ok = got.join(',') === 'a.md,b.md,c.md'
    } finally { rmSync(d, { recursive: true, force: true }) }
  } catch { l3ok = false }
  t('l3 清单确定性排序（乱序建盘 fixture）', l3ok === true)
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
  for (const e of readdirSync(agentsDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) { // 确定性排序（evolve-l3-sort）
    if (!e.isFile() || !/^ops-.*\.md$/.test(e.name)) continue // 限 ops-*.md（N-1：内置/插件代理不扫）
    agentsFiles++
    all.push(...scanText({ relPath: `agents/${e.name}`, text: stripFrontmatter(readFileSync(join(agentsDir, e.name), 'utf8')), merged, whitelist, extraTerms: hostTerms }))
  }
}
const effective = all.filter((h) => !h.whitelisted)
const strict = !warnMode && (argv.includes('--strict') || merged?.hardcode_scan?.strict === true)
const W = process.stdout.write.bind(process.stdout)
for (const h of effective) W(`[WARN] ${h.file}:${h.line} ${h.kind} 命中「${h.match}」——供应商 live 事实不得写入 .md 正文（06 §0/08 §1）；改指针化（指向 org-config）或登记白名单（scripts/hardcode-whitelist.json）\n`)
if (all.length - effective.length) W(`[info] 白名单豁免 ${all.length - effective.length} 处（${whitelist.length} 条规则）\n`)
console.log(`check-hardcode 汇总：扫 ${files.length} 个 .md${agentsFiles ? ` + agents 目录 ${agentsFiles} 个 ops-*.md（frontmatter 已剥离）` : ''}，命中 ${effective.length} 处（白名单豁免 ${all.length - effective.length}；词表=org-config ${deriveTerms(merged).length} 条+宿主注册表 ${hostTerms.length} 条）${strict && effective.length ? '——strict：按 RED 处置，不得收口' : strict ? '（strict 已生效，零命中）' : '（WARN 级——--warn 显式降级：校准期逃生口）'}`)
process.exit(strict && effective.length ? (DEGRADED ? 5 : 1) : DEGRADED ? 5 : 0) // 降级信号优先于 strict 命中（终审 W4：勿让 1 吞 5）；总表=references/06 §5.8
