#!/usr/bin/env node
// check-terms.mjs — 词表执法器（Y1 批，D29 ①④＋campaign §9 阀①③）：技能仓活动文档
// A 类禁用词棘轮执法——门禁=「不得新增＋基线只降不升」；基线=工作根下
// scripts/.golden/terms-baseline.json（--update 冻结，禁手改，D22 生成物豁免先例=
// constraints/index.json；清理批 Y2–Y5 完成后重冻随批提交，docs/07 §5）。
// --strict=绝对零命中模式（2026-10-28 d6 批清零 353 后启用，挂 pre-commit 快扫与门禁面）。词表=docs/07 §2.1 23 词＋
// campaign §7.1 扩展 10 词（「座」两源合一，23+10-1=32）＋规则二（正文裁决史括注
// lint）；词表以本脚本数组字面量为唯一实现载体，两源表为规格源（本批不改）。
// 用法：node scripts/check-terms.mjs [--strict] [--json] [--update] [--self-test] [--root <dir>]
// 退出码口径单源=references/06 §5.8（此处不复写映射）。
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync, mkdtempSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { SKILL_ROOT, cliFlag, UsageError, localDateStr } from './org-config.mjs'

// ── 词表（唯一实现载体；plain=子串包含/combo=显式正则/rule2=裁决史括注两模式）──
// combo 守护理由（防误伤，向量 3 逐例锁定）：座=docs/07 §2.1 表后注（单字误伤率高只扫组合）；
// 档=「档位」宿主术语保留；册=「手册」普通义保留；档案=「角色档案」「代理档案」宿主概念保留。
const TERMS = [
  // plain 28＝docs/07 §2.1 22 词（除「座」）＋扩展表 6 词；替换串照抄两源表右列（薄册行已按裁决一订正，以 docs/07 现行文本为准）
  { term: '战役', replace: '项目阶段 / 批次组', kind: 'plain' },
  { term: '烤验', replace: '强制检查', kind: 'plain' },
  { term: '回炉', replace: '返工', kind: 'plain' },
  { term: '编制', replace: '岗位清单', kind: 'plain' },
  { term: '部门墙', replace: '输入边界', kind: 'plain' },
  { term: '席位', replace: '岗位实例 / 待位', kind: 'plain' },
  { term: '兜底位', replace: '备用位', kind: 'plain' },
  { term: '深备位', replace: '第三备用位', kind: 'plain' },
  { term: '薄册', replace: '待办清单', kind: 'plain' },
  { term: '纯净化批', replace: '清理批次', kind: 'plain' },
  { term: '三屋模式', replace: '三角色协作（仅历史叙述）', kind: 'plain' },
  { term: '收口', replace: '结项', kind: 'plain' },
  { term: '立案', replace: '建单', kind: 'plain' },
  { term: '呈报', replace: '汇报', kind: 'plain' },
  { term: '门一', replace: '代码审查（岗）', kind: 'plain' },
  { term: '门二', replace: '实证裁决（岗）', kind: 'plain' },
  { term: '拟定者', replace: '规划岗', kind: 'plain' },
  { term: '审核者', replace: '审核岗', kind: 'plain' },
  { term: '裁决者', replace: '裁决岗', kind: 'plain' },
  { term: '异构', replace: '不同模型族', kind: 'plain' },
  { term: '换源', replace: '切换承载源', kind: 'plain' },
  { term: '红线', replace: '禁止项', kind: 'plain' },
  { term: '欠账', replace: '待补登记 / 未清事项', kind: 'plain' },
  { term: '清偿', replace: '补还', kind: 'plain' },
  { term: '逃逸', replace: '漏网缺陷', kind: 'plain' },
  { term: '排程', replace: '排期', kind: 'plain' },
  { term: '在册', replace: '已登记', kind: 'plain' },
  { term: '归档区', replace: '历史区', kind: 'plain' },
  // combo 4（一词一显式正则，只扫裁决组合形态）
  { term: '座', replace: '承载源', kind: 'combo', re: /(一座|k1 座|k2 座|k3 座|d1 座|承载座)/g },
  { term: '档', replace: '默认档位', kind: 'combo', re: /默认档(?!位)/g },
  { term: '册', replace: '单源文档／事实文档', kind: 'combo', re: /(单源册|事实册)/g },
  { term: '档案', replace: '历史区文件', kind: 'combo', re: /(?<!角色)(?<!代理)档案/g },
  // rule2 2（正文裁决史括注：史实出正文，住历史区——campaign §2 Y4 口径）
  { term: '裁决史括注-修订序数', replace: '出正文，住历史区', kind: 'rule2', re: /修订[一二三四]/g },
  { term: '裁决史括注-日期裁决', replace: '出正文，住历史区', kind: 'rule2', re: /（\d{4}-\d{2}-\d{2} 用户裁决/g },
]
const TERM_TOTAL = 32 // 词表总数断言=两源表 23+10-1 去重（rule2 两模式不计入）
const SURFACE_DOC = ['SKILL.md', 'references/*.md', 'RESIDUALS.md', 'constraints/*.md', 'DEPLOY.md', 'templates/_roles/*.md', 'templates/agents/*.md']

/** 词表装载断言（纯函数，自检可注入）：总数=plain+combo=32、combo=4、rule2=2、替换串全非空。 */
export function assertVocab() {
  const k = { plain: 0, combo: 0, rule2: 0, empty: 0 }
  for (const t of TERMS) { k[t.kind]++; if (!t.replace) k.empty++ }
  const total = k.plain + k.combo
  return { ...k, total, ok: total === TERM_TOTAL && k.combo === 4 && k.rule2 === 2 && k.empty === 0 }
}

/** 扫描面清单（确定性排序；constraints/PROVENANCE.md 整件排除；缺失顶层件计入 missing）。
 *  A5 扩面：templates/_roles/*.md 与 templates/agents/*.md（生成物）纳入——缺失目录跳过
 *  （自检夹具根无 templates 不受扰）。 */
export function listSurface(root) {
  const files = []
  let missing = 0
  for (const n of ['SKILL.md', 'DEPLOY.md', 'RESIDUALS.md']) existsSync(join(root, n)) ? files.push(join(root, n)) : missing++
  for (const d of ['constraints', 'references', 'templates/_roles', 'templates/agents']) {
    const dp = join(root, d)
    if (!existsSync(dp)) continue
    files.push(...readdirSync(dp, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md') && !(d === 'constraints' && e.name === 'PROVENANCE.md')).map((e) => join(dp, e.name)))
  }
  return { files: files.sort(), missing }
}

/** 单文件扫描（排除区先于词匹配：围栏块/term-scan off-on/历史小节，off-on 口径同项目仓 verify-docs 同名机关）。 */
export function scanFile(rel, text) {
  const hits = []
  let inFence = false, inOff = false, histLevel = null
  text.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return } // 围栏开关行与围栏内不扫
    if (inFence) return
    if (line.includes('term-scan: off')) inOff = true
    if (line.includes('term-scan: on')) inOff = false
    if (inOff) return
    const h = line.match(/^(#+)\s*(.*)$/)
    if (h) {
      if (histLevel !== null && h[1].length <= histLevel) histLevel = null // 同级或更高级标题出历史小节
      if (histLevel === null && (h[2].startsWith('修订记') || h[2].startsWith('历史'))) { histLevel = h[1].length; return }
    }
    if (histLevel !== null) return
    for (const t of TERMS) {
      const hit = t.kind === 'plain' ? line.includes(t.term) : [...line.matchAll(t.re)].length > 0
      if (hit) hits.push({ file: rel, line: i + 1, term: t.term, replace: t.replace }) // 一行一词计 1（次=命中行数）
    }
  })
  return hits
}

/** 棘轮分类：基线外 (file,term) 与计数超基线的溢出行=新增，其余=存量（计数口径，假设 4）。 */
export function classify(hits, baseFiles) {
  const seen = {}
  return hits.map((h) => {
    const key = `${h.file}\u0000${h.term}`
    seen[key] = (seen[key] || 0) + 1
    const allow = baseFiles?.[h.file]?.[h.term]
    return { ...h, status: allow === undefined || seen[key] > allow ? '新增' : '存量' }
  })
}

// ── self-test（八向量；夹具全落 os.tmpdir() 并 finally 清理，CLI 一律 --root 指向夹具根）──
function selfTest() {
  const self = fileURLToPath(import.meta.url)
  const run = (args) => spawnSync(process.execPath, [self, ...args], { encoding: 'utf8' })
  const withRoot = (fn) => {
    const d = mkdtempSync(join(tmpdir(), 'terms-st-'))
    try { return fn(d) } finally { rmSync(d, { recursive: true, force: true }) }
  }
  const mkBase = (d, files) => {
    mkdirSync(join(d, 'scripts', '.golden'), { recursive: true })
    writeFileSync(join(d, 'scripts', '.golden', 'terms-baseline.json'), JSON.stringify({ schemaVersion: 1, files }), 'utf8')
  }
  const frozenZero = (build) => withRoot((d) => { build(d); const u = run(['--root', d, '--update']); return u.status === 0 && u.stdout.includes('基线已冻结：0 组 / 0 次（旧 0→新 0）') })
  const cases = []
  const t = (n, c) => cases.push({ n, c: !!c })
  const v = assertVocab()
  t('v1 词表装载：plain28+combo4=32、rule2=2、替换串全非空（总数断言自证）', v.ok)
  t('v2 plain 命中与明细格式（存量前缀＋禁用词→建议）', withRoot((d) => {
    mkBase(d, { 'SKILL.md': { 烤验: 1 } })
    writeFileSync(join(d, 'SKILL.md'), '这是烤验现场\n', 'utf8')
    const r = run(['--root', d])
    return r.status === 0 && r.stdout.includes('存量 SKILL.md:1 禁用词「烤验」→ 建议「强制检查」')
  }))
  t('v3 combo 守护逐例：不中=角色档案/代理档案/手册/默认档位/座位/档位；中=历史档案/单源册/事实册/默认档/一座/k1 座/承载座', withRoot((d) => {
    writeFileSync(join(d, 'SKILL.md'), ['角色档案', '代理档案', '手册', '默认档位', '座位', '档位', '历史档案', '单源册', '事实册', '默认档', '一座', 'k1 座', '承载座'].join('\n') + '\n', 'utf8')
    const u = run(['--root', d, '--update'])
    if (u.status !== 0 || !u.stdout.includes('基线已冻结：4 组 / 7 次（旧 0→新 4）')) return false
    const r = run(['--root', d])
    const per = {}
    for (const m of r.stdout.matchAll(/存量 SKILL\.md:(\d+) 禁用词「([^」]+)」/g)) per[m[1]] = m[2]
    return r.status === 0 && JSON.stringify(per) === JSON.stringify({ 7: '档案', 8: '册', 9: '册', 10: '档', 11: '座', 12: '座', 13: '座' })
  }))
  const v4 = frozenZero((d) => { mkdirSync(join(d, 'constraints'), { recursive: true }); writeFileSync(join(d, 'constraints', 'PROVENANCE.md'), '烤验原文\n', 'utf8') })
    && frozenZero((d) => writeFileSync(join(d, 'SKILL.md'), '<!-- term-scan: off -->\n烤验引用原文\n<!-- term-scan: on -->\n', 'utf8'))
    && frozenZero((d) => writeFileSync(join(d, 'SKILL.md'), '## 修订记\n烤验旧事\n', 'utf8'))
    && frozenZero((d) => writeFileSync(join(d, 'SKILL.md'), '前言\n```\n烤验示例\n```\n后记\n', 'utf8'))
  t('v4 排除区四面（四夹具各证一面）：PROVENANCE 整件/off-on 区段/修订记小节/围栏块', v4)
  t('v5 规则二：修订序数与日期裁决各中一次＋普通正文不中', withRoot((d) => {
    writeFileSync(join(d, 'SKILL.md'), '修订二补记\n（2026-01-01 用户裁决：照旧）\n普通正文行\n', 'utf8')
    const u = run(['--root', d, '--update'])
    const r = run(['--root', d])
    return u.status === 0 && u.stdout.includes('基线已冻结：2 组 / 2 次（旧 0→新 2）') && r.status === 0
      && r.stdout.includes('存量 SKILL.md:1 禁用词「裁决史括注-修订序数」') && r.stdout.includes('存量 SKILL.md:2 禁用词「裁决史括注-日期裁决」') && !r.stdout.includes('SKILL.md:3')
  }))
  t('v6 棘轮通过态：基线=现态→过且汇总「新增 ×0」', withRoot((d) => {
    writeFileSync(join(d, 'SKILL.md'), '烤验现场\n', 'utf8')
    run(['--root', d, '--update'])
    const r = run(['--root', d])
    return r.status === 0 && r.stdout.includes('新增 ×0 次 / 存量 1 次 / 基线 1 组')
  }))
  t('v7 棘轮新增态：现态比基线多一组→红且汇总「新增 ×1」', withRoot((d) => {
    mkBase(d, { 'SKILL.md': { 烤验: 1 } })
    writeFileSync(join(d, 'SKILL.md'), '烤验现场\n回炉现场\n', 'utf8')
    const r = run(['--root', d])
    return r.status !== 0 && r.stdout.includes('新增 ×1 次 / 存量 1 次 / 基线 1 组')
  }))
  t('v8 --update 收缩态：基线 2 组现态 1 组→收缩重冻＋复跑过', withRoot((d) => {
    mkBase(d, { 'SKILL.md': { 烤验: 1, 回炉: 1 } })
    writeFileSync(join(d, 'SKILL.md'), '烤验现场\n', 'utf8')
    const u = run(['--root', d, '--update'])
    const files = u.status === 0 ? JSON.parse(readFileSync(join(d, 'scripts', '.golden', 'terms-baseline.json'), 'utf8')).files['SKILL.md'] : null
    const r = run(['--root', d])
    return u.status === 0 && u.stdout.includes('基线已冻结：1 组 / 1 次（旧 2→新 1）') && files && Object.keys(files).length === 1 && r.status === 0 && r.stdout.includes('基线 1 组')
  }))
  const fail = cases.filter((x) => !x.c)
  for (const x of cases) console.log(`${x.c ? 'PASS' : 'FAIL'} ${x.n}`)
  console.log(fail.length ? `self-test 未全过：FAIL ×${fail.length}` : 'self-test 全过（8 向量）')
  return fail.length === 0
}

// ── 主流程 ──
const argv = process.argv.slice(2)
const KNOWN_FLAGS = ['--strict', '--json', '--update', '--self-test', '--root']
const bad = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') { i++; continue }
  if (!KNOWN_FLAGS.includes(argv[i])) bad.push(argv[i])
}
if (bad.length) { console.error(`[用法错] 未知参数：${bad.join(' ')}（合法：${KNOWN_FLAGS.join(' ')}）`); process.exit(1) }
let root = null
try { root = cliFlag(argv, '--root') } catch (e) {
  if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
  throw e
}
root = root || SKILL_ROOT
if (!existsSync(root) || !statSync(root).isDirectory()) { console.error(`[用法错] --root 指向不存在目录：${root}`); process.exit(1) }
if (argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1)
const vc = assertVocab()
if (!vc.ok) { console.error(`[配置/装载错] 词表总数断言失败：plain${vc.plain}+combo${vc.combo}=${vc.total}（期望 ${TERM_TOTAL}）rule2=${vc.rule2} 空替换=${vc.empty}——两源表与规格失配`); process.exit(3) }
const BASE = join(root, 'scripts', '.golden', 'terms-baseline.json') // 恒=工作根下（--root 只换工作根，不改解析规则）
let base = null
if (existsSync(BASE)) {
  try {
    base = JSON.parse(readFileSync(BASE, 'utf8').replace(/^\uFEFF/, ''))
    if (!base || typeof base !== 'object' || typeof base.files !== 'object' || base.files === null) throw new Error('files 键缺失或非对象')
  } catch (e) { console.error(`[配置/装载错] 基线件不可解析：${BASE}（${e.message}）`); process.exit(3) }
}
if (!base && !argv.includes('--update')) { console.error(`[配置/装载错] 基线件缺失：${BASE}——先跑 --update 首冻（棘轮基线）`); process.exit(3) }
const oldGroups = base ? Object.values(base.files).reduce((s, t) => s + Object.keys(t).length, 0) : 0
const { files, missing } = listSurface(root)
const hits = []
for (const f of files) {
  const rel = relative(root, f).replace(/\\/g, '/')
  hits.push(...scanFile(rel, readFileSync(f, 'utf8')))
}
if (argv.includes('--update')) {
  const newHits = base ? classify(hits, base.files).filter((h) => h.status === '新增').length : 0
  if (newHits > 0) { console.error(`[用法错] 当前新增 ×${newHits}——--update 拒绝执行（防把违例洗进基线）；先清理新增命中`); process.exit(1) }
  const cur = {}
  for (const h of hits) (cur[h.file] ??= {})[h.term] = (cur[h.file][h.term] || 0) + 1
  const k = Object.keys(cur).reduce((s, f) => s + Object.keys(cur[f]).length, 0)
  mkdirSync(dirname(BASE), { recursive: true })
  writeFileSync(BASE, JSON.stringify({ schemaVersion: 1, frozen: localDateStr(), surface: SURFACE_DOC, note: 'check-terms 棘轮基线：file→term→命中行计数——--update 冻结禁手改（D22 生成物豁免）；清理批完成后重冻随批提交（docs/07 §5）', files: cur }, null, 2) + '\n', 'utf8')
  console.log(`基线已冻结：${k} 组 / ${hits.length} 次（旧 ${oldGroups}→新 ${k}）`)
  process.exit(0)
}
const strict = argv.includes('--strict')
const marked = strict ? hits.map((h) => ({ ...h, status: '命中' })) : classify(hits, base.files)
const newHits = marked.filter((h) => h.status === '新增').length
const keptHits = marked.length - newHits
const groups = Object.values(base.files).reduce((s, t) => s + Object.keys(t).length, 0)
const missNote = missing ? `（跳过缺失 ${missing} 件）` : ''
const summary = strict
  ? `check-terms 汇总：命中 ${marked.length}（--strict 绝对零模式）${missNote}`
  : `check-terms 汇总：新增 ×${newHits} 次 / 存量 ${keptHits} 次 / 基线 ${groups} 组（棘轮：新增即红）${missNote}`
if (argv.includes('--json')) {
  console.log(JSON.stringify({ summary, newHits, baselineHits: keptHits, hits: marked }))
} else {
  for (const h of marked) console.log(`${strict ? '' : h.status + ' '}${h.file}:${h.line} 禁用词「${h.term}」→ 建议「${h.replace}」`)
  const baseTotal = Object.values(base.files).reduce((s, t) => s + Object.values(t).reduce((a, b) => a + b, 0), 0)
  if (!strict && newHits === 0 && hits.length < baseTotal) console.log(`[info] 现态命中 ${hits.length} < 基线 ${baseTotal} 次——可 --update 重冻收缩基线`)
  console.log(summary)
}
process.exit(strict ? (marked.length ? 1 : 0) : newHits > 0 ? 1 : 0)
