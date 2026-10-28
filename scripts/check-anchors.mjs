#!/usr/bin/env node
// check-anchors.mjs — 08 §4「文档腐化体检」的机检化（v1.6 批 P1-A；裁决档 ds-W6/kimi-W2）
// 检查面：
//   ① 「NN §M[.K]」引用 → 目标 references/NN-*.md 对应章节标题存在性（断锚检测；
//      文档号两位数形态（10+ 号文档）与单数字去前导零形态——evolve-E2 b7）
//   ①b 「NN·XN」条目型引用（大写条目组 1-4 字母、可带 -数字，如 01·E2/04·SY-1）
//      → 目标文档条目登记表存在性（登记表仅从 01（A-E 系）与 04（WP/SY/MG/ORG 系）
//      正文条目标记解析——不从 golden 反推；小写版本串如 06·v1.1 天然不命中；
//      「」叙述跳过延续；断锚=WARN 试点口径——evolve-E2 b7）
//   ② 反引号相对路径存在性（技能根解析；~/ 与盘符绝对路径按系统解析）
//   ③ 01 原理/04 教训库条目计数 vs scripts/.golden/doc-counts.json（kimi-W3 生成式对账——
//      正文不落数字，golden 为唯一计数锚）
// 级别：断锚/路径缺失=WARN（试点校准期——按裁决档 W6：全量 WARN 基线→误报分类，
//   连续两轮零误报再议升 --strict）；计数不一致=FAIL（golden 冻结面失守，须 --update 重冻结随批提交）。
// 退出码口径单源=references/06 §5.8（此处不复写映射——evolve 批 b8
// 指针化；回炉 r2 削 b8 残留碎片，golden 缺失语义总表已载）。
// 用法：node scripts/check-anchors.mjs [--update] [--strict] [--self-test]
//   --update    重生成 doc-counts.json（冻结动作：随工作单元提交+修订记登记，08 §7）
//   --strict    WARN 亦退 1（升格开关，试点期不用）
// 供应商事实零硬编码：本脚本不含任何端点/模型名（06 §0）；文件清单从目录实扫派生。

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { loadOrgConfig } from './org-config.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url)) // 规范路径解析（勿用 URL pathname 手拼——v1.6 批 P0-B 教训）
const SKILL_ROOT = resolve(SCRIPT_DIR, '..')
const REF_DIR = join(SKILL_ROOT, 'references')
const GOLDEN = join(SCRIPT_DIR, '.golden', 'doc-counts.json')

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)

// ── 扫描面 ──
// 依赖面预检（v2.0.1 修复批 L13）：references 目录与 01/04 登记表源缺失
// =配置/装载错族（06 §5.8 行 3）——[fatal] 一行退 3，防裸 readFileSync 抛堆栈
// （对齐本件 org-config 装载守卫与 ds-call-v2 ConfigError 惯例，风格割裂收口）
if (!existsSync(REF_DIR)) { console.error(`[fatal] references 目录缺失: ${REF_DIR}（check-anchors 扫描面依赖——06 §5.8 行 3）`); process.exit(3) }
for (const f of ['01-org-principles.md', '04-lessons.md']) {
  if (!existsSync(join(REF_DIR, f))) { console.error(`[fatal] 登记表源缺失: ${join(REF_DIR, f)}（条目索引/计数对账依赖——06 §5.8 行 3）`); process.exit(3) }
}
// references 清单确定性排序（selfiter 批 evolve-l3-sort 清偿）：readdirSync
// 枚举序跨平台/目录序不稳定——WARN/FAIL 报告行序与 diff 对账噪声面
const docFiles = [
  join(SKILL_ROOT, 'SKILL.md'),
  join(SKILL_ROOT, 'RESIDUALS.md'),
  ...readdirSync(REF_DIR).filter((f) => f.endsWith('.md')).sort().map((f) => join(REF_DIR, f)),
]
for (const f of docFiles) {
  if (!existsSync(f)) { console.error(`[fatal] 扫描面文件缺失: ${f}（06 §5.8 行 3）`); process.exit(3) }
}
// 章节标题索引：fileNo → Set("M", "M.K")
function buildHeadingIndex() {
  const idx = {}
  for (const f of readdirSync(REF_DIR).filter((x) => x.endsWith('.md'))) {
    const no = f.slice(0, 2)
    if (!/^\d{2}$/.test(no)) continue
    const raw = readFileSync(join(REF_DIR, f), 'utf8')
    const heads = new Set()
    for (const m of raw.matchAll(/^#{2,4}\s+(\d+(?:\.\d+)?)[.、:\s]/gm)) heads.add(m[1])
    // §0=文件前导块约定（如 06 的零硬编码声明引言）：首于 §1 之前有实质内容即认 §0 锚
    const preamble = raw.split(/^## /m)[0].split('\n').slice(1).join('').trim()
    if (preamble) heads.add('0')
    idx[no] = heads
  }
  return idx
}

// 路径候选：反引号内、无空格/中文/占位符/通配、像路径的串
const PATH_LIKE = /^[\w~./\\:-]+$/
const PATH_EXT = /\.(md|mjs|js|json|txt|py|sh|yml|snippet|jsonl)$/
const PLACEHOLDER = /[<>{…*]|\.\.\.|…/

// ── 引用正则（evolve-E2 b7）：文档号两位数形态（[01]\d=\d=支持 10+ 号与单数字去前导零；
//    前后禁数字/连字符邻接=防日期串（2026-09-16）与长数字误配） ──
const SEC_REF_RE = /(?<![\d-])([01]\d|\d)(?!\d)\s*§\s*(\d+(?:\.\d+)?)/g
// NN·XN 条目型：·后大写字母组 1-4 字母+可选（可带 -）数字；小写（v1.1 版本串）天然不命中
const ENTRY_REF_RE = /(?<![\w·-])([01]\d|\d)·([A-Z]{1,4}(?:-?\d+)?)(?![\w-])/g

// 「」内编号=叙述性提及（如「旧引『08 §0』为断锚」），非活引用——跳过（§ 族与 ·XN 族共用）
const inQuote = (ln, idx) => ln.lastIndexOf('「', idx) > ln.lastIndexOf('」', idx)

// ── 条目登记表：仅从 01（^### X N 标记）与 04（表行 | XN-n | 标记）正文解析（P-3） ──
function buildEntryIndex() {
  const idx = {}
  const s01 = new Set()
  for (const m of readFileSync(join(REF_DIR, '01-org-principles.md'), 'utf8').matchAll(/^### ([A-E])(\d+)\s/gm)) s01.add(`${m[1]}${m[2]}`)
  const s04 = new Set()
  for (const m of readFileSync(join(REF_DIR, '04-lessons.md'), 'utf8').matchAll(/^\|\s*(WP|SY|MG|ORG)-(\d+)/gm)) s04.add(`${m[1]}-${m[2]}`)
  idx['01'] = s01
  idx['04'] = s04
  return idx
}

/** 行级条目引用检查（纯函数，主扫描与 --self-test 共用）：
 *  返回 [{no（两位化文档号）, entry（条目键）, ok（登记表命中）}]；「」内跳过。 */
function checkEntryRefs(ln, entIdx) {
  const out = []
  for (const m of ln.matchAll(ENTRY_REF_RE)) {
    if (inQuote(ln, m.index)) continue
    const no = m[1].padStart(2, '0')
    out.push({ no, entry: m[2], ok: entIdx[no]?.has(m[2]) === true })
  }
  return out
}

// 项目侧路径（项目仓/项目覆盖件/项目脚本示例）不属技能根存在性检查域——按前缀+点名跳过（试点基线分类：均为 WP/Synapse 项目侧文件）
const PROJECT_PREFIX = /^(\.zcode\/|reports\/|briefs\/|docs\/)/

// 点名单单源=org-config anchors_exempt.project_names（v1.7.4 m4 清偿，残留册
// evolve-m4-hardcode 承接）：deriveProjectNames 派生纯函数（主扫描真实装载+
// --self-test fixture 共用）；缺段/非数组=exit 3（词表缺失族——同 finish_vocab
// 口径：无兜底名单，缺=配置错即拒跑，无静默回退）。PROJECT_PREFIX 正则=
// 语法形态，留脚本内（org-config 同段 note 明示）。
function deriveProjectNames(merged) {
  const list = merged?.anchors_exempt?.project_names
  if (!Array.isArray(list))
    return {
      names: null,
      error: `org-config anchors_exempt.project_names 缺段或非数组（现=${list === undefined ? 'undefined' : JSON.stringify(list) ?? String(list)}）——项目侧点名单单源（v1.7.4 m4 清偿），缺段=exit 3 无静默回退`,
    }
  return { names: new Set(list), error: null }
}

function resolveRef(v) {
  if (v.startsWith('~/')) return resolve(homedir(), v.slice(2))
  if (/^[A-Za-z]:[\\/]/.test(v)) return v
  if (v.startsWith('/') || v.startsWith('\\')) return v
  return join(SKILL_ROOT, ...v.split('/'))
}

// 裸文件名（无目录段）：技能侧实际位于 scripts/ 或 templates/ ——两处解析
function resolveBare(name) {
  for (const d of ['scripts', 'templates']) {
    const p = join(SKILL_ROOT, d, name)
    if (existsSync(p)) return p
  }
  return join(SKILL_ROOT, name)
}

// ── 计数（生成式——kimi-W3：机检锚=golden 文件，非散文数字） ──
function countDocs() {
  const c01 = {}
  for (const m of readFileSync(join(REF_DIR, '01-org-principles.md'), 'utf8').matchAll(/^### ([A-E])(\d+)\s/gm)) {
    c01[m[1]] = (c01[m[1]] || 0) + 1
  }
  c01.total = Object.entries(c01).reduce((s, [k, v]) => (k === 'total' ? s : s + v), 0)
  const c04 = {}
  for (const m of readFileSync(join(REF_DIR, '04-lessons.md'), 'utf8').matchAll(/^\|\s*(WP|SY|MG|ORG)-\d+/gm)) {
    c04[m[1]] = (c04[m[1]] || 0) + 1
  }
  c04.total = Object.values(c04).reduce((s, v) => s + v, 0)
  return { '01': c01, '04': c04 }
}

// ── 自检（聚合退出——v1.6 批 B2 教训：全 fixture 计入结果，禁只看末个） ──
function selfTest() {
  const fails = []
  let n = 0
  const t = (name, got, want) => { n++; if (got !== want) fails.push(`${name}:got=${got} want=${want}`) }
  // 真实文件索引断言（evolve-E2 b7 强化——原 head 断言对自建 Set 恒真=在册盲点，
  // 残留册登记行之一）：拷打真实解析而非合成恒真
  const heads = buildHeadingIndex()
  t('head-06 含 5.8（真实文件解析）', heads['06']?.has('5.8') === true, true)
  t('head-06 不含 8.6（8.6 系 02 章节——负例防恒真，原恒真断言掩蔽的盲点）', heads['06']?.has('8.6') === false, true)
  t('head-02 含 8.6（真实文件解析）', heads['02']?.has('8.6') === true, true)
  const refOk = (v) => { const p = resolveRef(v); return typeof p === 'string' && p.length > 0 }
  t('resolve-home', refOk('~/.zcode/skills/_archive/x.md'), true)
  t('path-like-reject-space', PATH_LIKE.test('Synapse 项目仓 scripts/audits/x.md'), false)
  t('placeholder-reject', PLACEHOLDER.test('scripts/audits/2026-09-10_org-skill-*'), true)
  // b7：文档号两位数（10+ 号文档）+单数字（去前导 0 形态）解析（红态=正则常量未落→FAIL 不崩）
  const secRefs = typeof SEC_REF_RE === 'undefined' ? [] : [...'见 10 §3 与 01 §5 与 6 §4'.matchAll(SEC_REF_RE)]
  t('§引用两位文档号解析（10→10/01→01）', secRefs.length === 3 && secRefs[0][1] === '10' && secRefs[0][2] === '3' && secRefs[1][1] === '01', true)
  t('§引用单数字去前导零形态解析（6→查 06）', secRefs.length === 3 && secRefs[2][1] === '6' && secRefs[2][1].padStart(2, '0') === '06', true)
  // b7：NN·XN 条目型引用（登记表仅从 01/04 正文解析；断锚=WARN 试点口径）
  const ent = typeof buildEntryIndex === 'function' ? buildEntryIndex() : null
  t('条目登记表实析：01 含 E2/C2、04 含 SY-1', ent?.['01']?.has('E2') === true && ent?.['01']?.has('C2') === true && ent?.['04']?.has('SY-1') === true, true)
  const refsOf = (ln) => (typeof checkEntryRefs === 'function' && ent ? checkEntryRefs(ln, ent) : null)
  t('条目正例：01·E2/04·SY-1 合法命中', (() => { const r = refsOf('锚 01·E2 与 04·SY-1'); return Array.isArray(r) && r.length === 2 && r.every((x) => x.ok) })(), true)
  t('条目负例（合成串，裁决 C3 要求自检保留）：02·C2→WARN', (() => { const r = refsOf('合成 02·C2'); return Array.isArray(r) && r.length === 1 && r[0].no === '02' && r[0].entry === 'C2' && r[0].ok === false })(), true)
  t('P-4 改指目标存在：01·C2 合法（改指终裁的机检前置）', (() => { const r = refsOf('改指后 01·C2'); return Array.isArray(r) && r.length === 1 && r[0].ok === true })(), true)
  t('免误伤：06·v1.1（小写版本串）不命中', refsOf('对齐 06·v1.1 版本')?.length === 0, true)
  t('免误伤：K3 编号短语（无文档号·前缀）不命中', refsOf('K3 编号短语不命中')?.length === 0, true)
  t('「」叙述跳过延续 ·XN 族', refsOf('「旧引 02·C2 为断锚」叙述')?.length === 0, true)
  t('两位文档号条目形：10·A1 解析 no=10（现无该号文档=断锚方向）', (() => { const r = refsOf('10·A1'); return Array.isArray(r) && r.length === 1 && r[0].no === '10' && r[0].ok === false })(), true)
  // m4 清偿向量（v1.7.4）：点名单从 fixture 配置派生正例（名单内路径被豁免）+缺段 exit 3 语义
  const dOk = typeof deriveProjectNames === 'function' ? deriveProjectNames({ anchors_exempt: { project_names: ['scripts/x.py', 'y.md'] } }) : null
  t('m4 点名单 fixture 派生正例：名单内命中被豁免/名单外不命中（豁免不外溢）', dOk?.error == null && dOk?.names?.has?.('scripts/x.py') === true && dOk?.names?.has?.('scripts/other.py') === false, true)
  const dBad = typeof deriveProjectNames === 'function' ? deriveProjectNames({}) : null
  t('m4 缺段→exit 3 语义：deriveProjectNames 返回错误形态+stderr 点名 anchors_exempt', dBad?.error != null && dBad?.names === null && dBad.error.includes('anchors_exempt'), true)
  // selfiter 批（evolve-l3-sort）向量：扫描面确定性排序不变式——头部两件为
  // 固定序（SKILL/RESIDUALS），references 段须按名排序（构造处 .sort() 回归守卫）
  const refsPortion = docFiles.slice(2)
  t('l3 扫描面确定性排序（references 段按名排序）', refsPortion.length > 0 && refsPortion.join('\n') === [...refsPortion].sort().join('\n'), true)
  if (fails.length) console.error(`[self-test] FAIL ×${fails.length}: ${fails.join('; ')}`)
  else console.error(`[self-test] ${n}/${n} 过`)
  return fails.length === 0
}

// ── 主流程 ──
if (flag('--self-test')) process.exit(selfTest() ? 0 : 1)

// 点名单装载（主流程真实配置；--self-test 用 fixture 不触真实装载）——
// 缺段/非数组=exit 3（词表缺失族），stderr 点名；装载失败（坏 JSON 等）
// =06 §5.8 行 3（配置/装载错）：[fatal] 一行+exit 3（门一 N-1，回炉 1 轮——
// 对齐 ds-call-v2 ConfigError 惯例，防裸抛堆栈噪声/误退出码）
let mergedCfg
try {
  mergedCfg = loadOrgConfig(process.cwd()).merged
} catch (e) {
  console.error(`[fatal] org-config 装载失败（check-anchors 主流程）: ${e.message}（06 §5.8 行 3=配置/装载错）`)
  process.exit(3)
}
const { names: PROJECT_NAMES, error: namesErr } = deriveProjectNames(mergedCfg)
if (namesErr) { console.error(namesErr); process.exit(3) }

const idx = buildHeadingIndex()
const entryIdx = buildEntryIndex()
let warn = 0, fail = 0
const notes = []

for (const file of docFiles) {
  const rel = file.slice(SKILL_ROOT.length + 1).replace(/\\/g, '/')
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    for (const m of ln.matchAll(SEC_REF_RE)) {
      // 「」内的编号=叙述性提及（如「旧引『08 §0』为断锚」），非活引用——跳过
      if (inQuote(ln, m.index)) continue
      const [no, sec] = [m[1].padStart(2, '0'), m[2]]
      const heads = idx[no]
      if (!heads) { warn++; notes.push(`[WARN] ${rel}:${i + 1} 引 ${m[1]} §${sec}——目标文件不在 references/`); continue }
      if (!heads.has(sec)) { warn++; notes.push(`[WARN] ${rel}:${i + 1} 引 ${m[1]} §${sec}——目标无此章节（现有：${[...heads].join(',')}）`) }
    }
    // ①b NN·XN 条目型引用断锚（evolve-E2 b7——WARN 试点口径不变）
    for (const ref of checkEntryRefs(ln, entryIdx)) {
      if (!ref.ok) { warn++; notes.push(`[WARN] ${rel}:${i + 1} 条目断锚 ${ref.no}·${ref.entry}——目标文档无此条目（登记表=01 A-E 系+04 WP/SY/MG/ORG 系正文条目）`) }
    }
    for (const m of ln.matchAll(/`([^`\n]+)`/g)) {
      const v = m[1]
      if (!PATH_LIKE.test(v) || !PATH_EXT.test(v) || PLACEHOLDER.test(v) || /^https?:/.test(v)) continue
      if (PROJECT_PREFIX.test(v) || PROJECT_NAMES.has(v)) continue
      // 裸文件名=不含任何分隔符（正斜杠与反斜杠都算——Windows 盘符绝对路径含 \ 不算裸名）
      const p = /^[^/\\]+$/.test(v) ? resolveBare(v) : resolveRef(v)
      if (!existsSync(p)) { warn++; notes.push(`[WARN] ${rel}:${i + 1} 路径缺失 \`${v}\``) }
    }
  }
}

// 计数对账
const live = countDocs()
if (flag('--update')) {
  mkdirSync(dirname(GOLDEN), { recursive: true })
  writeFileSync(GOLDEN, JSON.stringify({ ...live, frozen: new Date().toISOString().slice(0, 10), note: '01 原理分组计数+04 教训库分系计数——check-anchors --update 冻结；正文不落数字（A3）' }, null, 2) + '\n', 'utf8')
  console.log(`[golden] doc-counts.json 已重冻结（随工作单元提交+修订记登记，08 §7）：01 total=${live['01'].total} 04 total=${live['04'].total}`)
} else {
  if (!existsSync(GOLDEN)) { console.error('[FAIL] golden 缺失——先 --update 冻结（08 §7 冻结纪律）'); process.exit(3) }
  const gold = JSON.parse(readFileSync(GOLDEN, 'utf8').replace(/^\uFEFF/, ''))
  for (const doc of ['01', '04']) {
    const keys = [...new Set([...Object.keys(gold[doc]), ...Object.keys(live[doc])])]
    for (const k of keys) {
      if ((gold[doc][k] ?? 0) !== (live[doc][k] ?? 0)) { fail++; notes.push(`[FAIL] 计数失守 ${doc}.${k}:golden=${gold[doc][k] ?? 0} 实际=${live[doc][k] ?? 0}——文档增删条目后须 --update 重冻结，或回滚文档`) }
    }
  }
}

for (const n of notes) console.log(n)
const strict = flag('--strict')
const exitCode = fail > 0 || (strict && warn > 0) ? 1 : 0
console.log(`check-anchors 汇总：WARN ×${warn}（试点校准期）/ FAIL ×${fail}（扫描面=${docFiles.length} 件）${strict ? ' [strict]' : ''}`)
process.exit(exitCode)
