#!/usr/bin/env node
// check-anchors.mjs — 08 §4「文档腐化体检」的机检化（v1.6 批 P1-A；裁决档 ds-W6/kimi-W2）
// 检查面：
//   ① 「NN §M[.K]」引用 → 目标 references/NN-*.md 对应章节标题存在性（断锚检测）
//   ② 反引号相对路径存在性（技能根解析；~/ 与盘符绝对路径按系统解析）
//   ③ 01 原理/04 教训库条目计数 vs scripts/.golden/doc-counts.json（kimi-W3 生成式对账——
//      正文不落数字，golden 为唯一计数锚）
// 级别：断锚/路径缺失=WARN（试点校准期——按裁决档 W6：全量 WARN 基线→误报分类，
//   连续两轮零误报再议升 --strict）；计数不一致=FAIL（golden 冻结面失守，须 --update 重冻结随批提交）。
// 退出码：0=通过（可有 WARN，回显计数）；1=计数 FAIL 或自检 FAIL；3=配置错（golden 缺失）。
// 用法：node scripts/check-anchors.mjs [--update] [--strict] [--self-test]
//   --update    重生成 doc-counts.json（冻结动作：随工作单元提交+修订记登记，08 §7）
//   --strict    WARN 亦退 1（升格开关，试点期不用）
// 供应商事实零硬编码：本脚本不含任何端点/模型名（06 §0）；文件清单从目录实扫派生。

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url)) // 规范路径解析（勿用 URL pathname 手拼——v1.6 批 P0-B 教训）
const SKILL_ROOT = resolve(SCRIPT_DIR, '..')
const REF_DIR = join(SKILL_ROOT, 'references')
const GOLDEN = join(SCRIPT_DIR, '.golden', 'doc-counts.json')

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)

// ── 扫描面 ──
const docFiles = [
  join(SKILL_ROOT, 'SKILL.md'),
  join(SKILL_ROOT, 'RESIDUALS.md'),
  ...readdirSync(REF_DIR).filter((f) => f.endsWith('.md')).map((f) => join(REF_DIR, f)),
]
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

// 项目侧路径（项目仓/项目覆盖件/项目脚本示例）不属技能根存在性检查域——按前缀+点名跳过（试点基线分类：均为 WP/Synapse 项目侧文件）
const PROJECT_PREFIX = /^(\.zcode\/|reports\/|briefs\/|docs\/)/
const PROJECT_NAMES = new Set(['scripts/run_gates.py', 'scripts/check_model_names.py', 'scripts/check-model-names.mjs', 'scripts/check-locks.mjs', 'check-tickets.mjs', '__init__.py'])

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
  const t = (name, got, want) => { if (got !== want) fails.push(`${name}:got=${got} want=${want}`) }
  const heads = new Set(['8', '8.6', '5.7'])
  t('head-8.6', heads.has('8.6'), true)
  const refOk = (v) => { const p = resolveRef(v); return typeof p === 'string' && p.length > 0 }
  t('resolve-home', refOk('~/.zcode/skills/_archive/x.md'), true)
  t('path-like-reject-space', PATH_LIKE.test('Synapse 项目仓 scripts/audits/x.md'), false)
  t('placeholder-reject', PLACEHOLDER.test('scripts/audits/2026-09-10_org-skill-*'), true)
  if (fails.length) console.error(`[self-test] FAIL ×${fails.length}: ${fails.join('; ')}`)
  else console.error('[self-test] 4/4 过')
  return fails.length === 0
}

// ── 主流程 ──
if (flag('--self-test')) process.exit(selfTest() ? 0 : 1)

const idx = buildHeadingIndex()
let warn = 0, fail = 0
const notes = []

for (const file of docFiles) {
  const rel = file.slice(SKILL_ROOT.length + 1).replace(/\\/g, '/')
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    for (const m of ln.matchAll(/0([1-9])\s*§\s*(\d+(?:\.\d+)?)/g)) {
      // 「」内的编号=叙述性提及（如「旧引『08 §0』为断锚」），非活引用——跳过
      if (ln.lastIndexOf('「', m.index) > ln.lastIndexOf('」', m.index)) continue
      const [no, sec] = [m[1], m[2]]
      const heads = idx['0' + no]
      if (!heads) { warn++; notes.push(`[WARN] ${rel}:${i + 1} 引 0${no} §${sec}——目标文件不在 references/`); continue }
      if (!heads.has(sec)) { warn++; notes.push(`[WARN] ${rel}:${i + 1} 引 0${no} §${sec}——目标无此章节（现有：${[...heads].join(',')}）`) }
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
