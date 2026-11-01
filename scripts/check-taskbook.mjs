#!/usr/bin/env node
// check-taskbook.mjs — 任务书派发前自检（L5 批，2026-10-22）
// 检查面（编号固定）：
//   T1  路径存在性（WARN）
//   T2  行号引用（FAIL）
//   T2b 逐字引用核对（FAIL）
//   T3  白名单与禁改互斥（FAIL）
//   T4  命令脚本存在性（WARN）
//   T5  零命中判据与逐字块互斥（WARN）
//   T6  任务书退出码契约冲突（FAIL）
//   T0  结构（WARN）
//   T13 词面扫描（FAIL——BANNED 22＋规则二两模式，词表单源跨仓读不复制；装载错统一退 3）
//   T14 事实台账形态漏检（WARN——表格形态漏网＋无章全局补位；--strict 使其退 1）
//   T15 机检命令转义管道 lint（FAIL——F 条目命令域 grep -E/-P 模式串含转义管道 \| 即红，
//      ERE/PCRE 下=字面管道符判据恒空跑（Y4 #12b 教训）；普通管道与 BRE 形态不受影响。R-Y5-2①）
//   T16 术语重定义（FAIL——仅 --semantic-lint；W6 R2-T1 D-3。正文以「是指/定义为/即」本地重定义
//      公共术语即红，「即可/即停」等非系词用法豁免；围栏与源文引用区不扫描；单源指针形态不报）
//   T17 断言缺术语（FAIL——仅 --semantic-lint。D 项行、V 标题及显式 ASSERT: 行含必须/须/不得/禁
//      而无规范对象词即红）
//   T18 双锚缺失（FAIL——仅 --semantic-lint。D 项缺规范锚（有效文件路径:行号＋非空逐字片段）
//      或缺 V 映射、V 标题缺 D 回锚即红）
//   T19 D/V 集合不一致（FAIL——仅 --semantic-lint。D/V id 重复声明、悬空引用、D→V 与 V→D 边
//      不互认即红；D 完全缺 V 映射归 T18）
//   T20 修入映射缺失（FAIL——仅 --semantic-lint。编号 §4（## 4.）纪律段含下级子标题整个子树缺
//      逐字「finding→定点 diff→机检/探针映射」即红）
// 退出码口径单源=references/06 §5.8（此处不复写映射）
// 用法：node scripts/check-taskbook.mjs <任务书.md> [--root <dir>]... [--evidence <证据.json>] [--semantic-lint] [--json] [--strict] [--self-test]
// 豁免：任一物理行含 tb-ignore → 该行跳过全部检查并计入跳过数（只对该行生效，不跨行继承）。
// 供应商事实零硬编码：本脚本不含端点/模型名；夹具一律落 os.tmpdir()，不写技能仓。
// golden 例外（W5b）：scripts/.golden/taskbook/ 下的参照件为例外——落仓供 R2-T1 消费；self-test 夹具仍一律落 os.tmpdir()。

import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SKILL_ROOT = resolve(SCRIPT_DIR, '..')
const SELF = fileURLToPath(import.meta.url)
const MSG_MISSING_E = (k) => `判据 #${k} 缺 E 条目`

// ── 路径型 token 口径（T1/T2/T3/T5 共用，避免口径漂移） ──
const EXT_RE = /\.(md|mjs|js|json|jsonl|txt|py|sh|yml|yaml|snippet)$/i
const PLACEHOLDER_RE = /[<>{}*…]/
const CITATION_RE = /^(.+):(\d+)「.*」$/

// ── 解析与判定纯函数（主入口只做 IO 与汇总） ──
function inlineSpans(line) {
  const out = []
  for (const m of String(line ?? '').matchAll(/`([^`\n]+)`/g)) out.push(m[1])
  return out
}

/** 路径型判定（T1/T2/T3/T5 共用单口径）：含扩展名、无空白、无占位符/通配符。 */
export function isPathLikeToken(v) {
  if (typeof v !== 'string' || v.length === 0) return false
  if (/\s/.test(v)) return false
  if (PLACEHOLDER_RE.test(v)) return false
  return EXT_RE.test(v)
}

/** T1 的额外跳过面：Unix/Windows 绝对路径与 path:NN「…」引用 token。 */
function isT1Skipped(v) {
  return v.startsWith('/') || /^[A-Za-z]:[\\/]/.test(v) || CITATION_RE.test(v)
}

/** r1 豁免标记：含 tb-ignore 的物理行整行置空（行号不变），返回计数。 */
export function maskIgnoredLines(lines) {
  let ignored = 0
  const masked = (Array.isArray(lines) ? lines : []).map((ln) => {
    if (String(ln).includes('tb-ignore')) { ignored++; return '' }
    return ln
  })
  return { lines: masked, ignored }
}

/** 围栏代码块所占物理行（含围栏标记行），T1 跳过其内部。 */
export function fencedLines(blocks) {
  const set = new Set()
  for (const b of blocks || []) for (let i = b.startLine; i <= b.endLine; i++) set.add(i)
  return set
}

export function findPathTokens(line) {
  const out = []
  for (const v of inlineSpans(line)) {
    if (isPathLikeToken(v) && !isT1Skipped(v) && !out.includes(v)) out.push(v)
  }
  return out
}

export function findSkippedPathTokens(line) {
  const out = []
  for (const v of inlineSpans(line)) {
    if (isPathLikeToken(v) && isT1Skipped(v) && !out.includes(v)) out.push(v)
  }
  return out
}

/** 章节 + 围栏代码块解析（行号均 1-based）。 */
export function parseTaskbook(text) {
  const lines = String(text ?? '').split('\n')
  const headings = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i])
    if (m) headings.push({ line: i + 1, level: m[1].length, title: m[2] })
  }
  const sections = headings.map((h, idx) => {
    let endLine = lines.length
    for (let j = idx + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) { endLine = headings[j].line - 1; break }
    }
    return { ...h, endLine, text: lines.slice(h.line, endLine).join('\n') }
  })
  const secByLine = new Map(sections.map((s) => [s.line, s]))
  const blocks = []
  let open = null
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(```|~~~)/.exec(lines[i])
    if (m) {
      if (!open) open = { startLine: i + 1, marker: m[1], content: [] }
      else if (m[1] === open.marker) {
        blocks.push({ startLine: open.startLine, endLine: i + 1, content: open.content.join('\n') })
        open = null
      }
      continue
    }
    if (open) open.content.push(lines[i])
  }
  if (open) blocks.push({ startLine: open.startLine, endLine: lines.length, content: open.content.join('\n') })
  for (const b of blocks) {
    for (let j = headings.length - 1; j >= 0; j--) {
      if (headings[j].line < b.startLine) {
        const sec = secByLine.get(headings[j].line)
        b.headingLine = headings[j].line
        b.headingLevel = headings[j].level
        b.headingTitle = headings[j].title
        b.sectionEnd = sec ? sec.endLine : lines.length
        break
      }
    }
  }
  return { lines, headings, sections, blocks }
}

function resolveCandidates(token, roots) {
  if (token.startsWith('~/')) return [resolve(homedir(), token.slice(2))]
  if (/^[A-Za-z]:[\\/]/.test(token)) return [token]
  if (token.startsWith('/') || token.startsWith('\\')) return [token]
  if (/[\\/]/.test(token)) {
    return roots.map((r) => join(r, ...token.split(/[\\/]/).filter(Boolean)))
  }
  const out = []
  for (const r of roots) { out.push(join(r, 'scripts', token)); out.push(join(r, token)) }
  return out
}

/** reader(token) → { exists, path, lines, total }；total 按文件实际行数（不把末尾换行算一行）。 */
export function makeReader(roots) {
  return (token) => {
    const cands = resolveCandidates(token, roots)
    for (const p of cands) {
      if (existsSync(p)) {
        let lines = []
        let total = 0
        try {
          const raw = readFileSync(p, 'utf8')
          lines = raw.split('\n')
          total = raw === '' ? 0 : lines.length - (raw.endsWith('\n') ? 1 : 0)
        } catch { lines = []; total = 0 }
        return { exists: true, path: p, lines, total }
      }
    }
    return { exists: false, path: cands[0] || token, lines: [], total: 0 }
  }
}

/** 提取 T2（path:N / path 第 N 行）与 T2b（path:NN「片段」）引用；W-17 D-2a：同物理行内裸 `:NN「frag」` span
 *  按 span 顺序继承最近显式路径（口径=isPathLikeToken）生成 quote token；跨行不继承、行内无前行显式路径不生成（D-2c）。 */
export function extractCitationTokens(lines) {
  const out = []
  const seen = new Set()
  const push = (t) => {
    const k = `${t.kind}|${t.path}|${t.n}|${t.fragment ?? ''}|${t.spanLine}`
    if (!seen.has(k)) { seen.add(k); out.push(t) }
  }
  for (let i = 0; i < lines.length; i++) {
    const ln = String(lines[i] ?? '')
    let lastPath = null // D-2a：本物理行内最近显式路径（显式路径 span 或显式引用 token 路径部）
    for (const v of inlineSpans(ln)) {
      let m = /^(.+?):(\d+)「(.*)」$/.exec(v)
      if (m && isPathLikeToken(m[1])) { push({ kind: 'quote', path: m[1], n: Number(m[2]), fragment: m[3], spanLine: i + 1 }); lastPath = m[1]; continue }
      if ((m = /^:(\d+)「(.*)」$/.exec(v))) { if (lastPath !== null && isPathLikeToken(lastPath)) push({ kind: 'quote', path: lastPath, n: Number(m[1]), fragment: m[2], spanLine: i + 1 }); continue } // D-2a 继承·D-2c：lastPath 逐行重置故跨行不继承
      m = /^(.+?):(\d+)$/.exec(v)
      if (m && isPathLikeToken(m[1])) { push({ kind: 'line', path: m[1], n: Number(m[2]), spanLine: i + 1 }); lastPath = m[1]; continue }
      if (isPathLikeToken(v)) lastPath = v // 显式路径 span（D-2a 继承源·与 T1 同口径）
    }
    // 行内 prose 形态：`path` 第 N 行 / 第 N–M 行（区间取 M）
    const plain = ln.replace(/`/g, '')
    const re = /([^\s，。；：、「」]+\.(?:md|mjs|js|json|jsonl|txt|py|sh|yml|yaml|snippet))\s*第\s*(\d+)(?:\s*[–—-]\s*(\d+))?\s*行/gi
    for (const m of plain.matchAll(re)) {
      if (!isPathLikeToken(m[1])) continue
      push({ kind: 'range', path: m[1], n: m[3] ? Number(m[3]) : Number(m[2]), spanLine: i + 1 })
    }
  }
  return out
}

export function checkCitations(tokens, reader) {
  const findings = []
  for (const t of tokens) {
    const r = reader(t.path)
    // 行号越界/目标缺失归 T2（行号引用面）；逐字片段不符归 T2b。
    if (!r.exists) {
      findings.push({ level: 'FAIL', check: 'T2', line: t.spanLine, message: `行号引用目标不存在：${t.path}` })
      continue
    }
    const total = r.total ?? r.lines.length
    if (t.n > total) {
      findings.push({ level: 'FAIL', check: 'T2', line: t.spanLine, message: `行号越界：${t.path} 共 ${total} 行，引用第 ${t.n} 行` })
      continue
    }
    if (t.kind === 'quote' && !(r.lines[t.n - 1] ?? '').includes(t.fragment)) {
      findings.push({ level: 'FAIL', check: 'T2b', line: t.spanLine, message: `第 ${t.n} 行不含引用的原文片段` })
    }
  }
  return findings
}

/** W5b D-5（T2c·W-21 畸形 span 显式化）：围栏外物理行 span 完整性——①反引号计数为奇数＝未闭合
 *  span；②路径型或 :NN 简写的引用候选未完整落在任一 inline span 内＝畸形（原 checker 现行实现
 *  对该形态静默跳过——本检查将其显式化）；③引用 span 片段为空「」＝畸形。纯函数：只判形态不做
 *  文件读取（内容核对仍归 T2/T2b，checkCitations 纯函数契约零改动）；主入口在 T2/T2b 后汇总。 */
export function checkSpanIntegrity(lines, fenced) {
  const findings = []
  const fset = fenced instanceof Set ? fenced : new Set(fenced ?? [])
  const CAND_RE = /([^\s「」`]*):\d+「[^」]*」/g
  for (let i = 0; i < lines.length; i++) {
    if (fset.has(i + 1)) continue
    const ln = String(lines[i] ?? '')
    // ① 未闭合 span：围栏外物理行反引号计数为奇数（含嵌套残段形态）
    const bt = (ln.match(/`/g) ?? []).length
    if (bt % 2 === 1) {
      findings.push({ level: 'FAIL', check: 'T2c', line: i + 1, message: 'span 未闭合（反引号计数为奇数·畸形 span 不再静默跳过）' })
    }
    const spans = []
    for (const m of ln.matchAll(/`[^`\n]*`/g)) spans.push([m.index, m.index + m[0].length])
    const inSpan = (a, b) => spans.some(([s, e]) => a >= s && b <= e)
    for (const m of ln.matchAll(CAND_RE)) {
      const whole = m[0]
      const prefix = m[1]
      const a = m.index, b = m.index + whole.length
      // ③ 空片段「」＝畸形（无论是否在 span 内）
      if (whole.endsWith('「」')) {
        findings.push({ level: 'FAIL', check: 'T2c', line: i + 1, message: '引用 span 片段为空（「」·畸形）' })
        continue
      }
      // ② 路径型或 :NN 简写候选未完整落在任一 inline span 内＝畸形
      if ((prefix === '' || isPathLikeToken(prefix)) && !inSpan(a, b)) {
        findings.push({ level: 'FAIL', check: 'T2c', line: i + 1, message: '引用候选未完整落在 inline span 内（畸形 span·原静默跳过面已显式化）' })
      }
    }
  }
  return findings
}

/** 白名单章节 A ∩（禁止章节 + 正文「禁止改动：/禁止改：」段）B。
 *  r2 修正（§7.1）：按**行**排除被禁改段覆盖的行（bLines），不做 token 差集。
 *  r4 不变式（§9.2，审核 W2 澄清）：同一路径分别出现在白名单表行（未覆盖）与
 *  禁改段行（被覆盖）时，A（来自白名单行）与 B（来自禁改行）均含该路径，
 *  T3 必报 FAIL，且行号指向白名单行。另：两侧均跳过围栏代码块内部。 */
export function checkWhitelistConflict(parsed) {
  const sections = Array.isArray(parsed) ? parsed : (parsed.sections || [])
  const lines = Array.isArray(parsed) ? null : (parsed.lines || [])
  const blocks = Array.isArray(parsed) ? [] : (parsed.blocks || [])
  const fenced = fencedLines(blocks)
  const A = new Map()
  const B = new Map()
  const bLines = new Set()
  const addTokens = (map, text, lineNo) => {
    for (const v of findPathTokens(text)) if (!map.has(v)) map.set(v, lineNo)
  }
  const lineAt = (ln) => {
    if (lines) return lines[ln - 1] ?? ''
    const s = sections.find((x) => ln >= x.line && ln <= x.endLine)
    return s ? (String(s.text ?? '').split('\n')[ln - s.line - 1] ?? '') : ''
  }

  // 1) B 与其覆盖行（标题含「禁止」的章节）
  for (const s of sections) {
    if (!/禁止/.test(s.title)) continue
    for (let ln = s.line + 1; ln <= s.endLine; ln++) {
      if (fenced.has(ln)) continue
      bLines.add(ln)
      addTokens(B, lineAt(ln) ?? '', ln)
    }
  }
  // 2) B 与其覆盖行（正文「禁止改动：/禁止改：」起至段落结束）
  if (lines && lines.length) {
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]
      const a = ln.indexOf('禁止改动：')
      const b = ln.indexOf('禁止改：')
      const idx = a >= 0 && b >= 0 ? Math.min(a, b) : (a >= 0 ? a : b)
      if (idx < 0) continue
      for (let j = i; j < lines.length; j++) {
        const cur = j === i ? ln.slice(idx) : lines[j]
        if (j > i && (cur.trim() === '' || /^#{1,6}\s/.test(cur))) break
        if (fenced.has(j + 1)) continue
        bLines.add(j + 1)
        addTokens(B, cur, j + 1)
      }
    }
  }
  // 3) A：白名单章节内未被禁改段覆盖的行的 token（按行排除，非 token 差集）；仍跳过围栏
  for (const s of sections) {
    if (!/白名单/.test(s.title)) continue
    for (let ln = s.line + 1; ln <= s.endLine; ln++) {
      if (fenced.has(ln) || bLines.has(ln)) continue
      addTokens(A, lineAt(ln) ?? '', ln)
    }
  }
  return [...A.entries()]
    .filter(([p]) => B.has(p))
    .map(([p, line]) => ({ level: 'FAIL', check: 'T3', line, message: `同时出现在白名单与禁改面：${p}` }))
}

/** T4：node scripts/<name> 的脚本存在性。 */
export function checkCommandScripts(lines, roots) {
  const findings = []
  const seen = new Set()
  for (let i = 0; i < lines.length; i++) {
    for (const m of String(lines[i] ?? '').matchAll(/node\s+scripts\/([A-Za-z0-9._-]+)/g)) {
      const name = m[1]
      if (PLACEHOLDER_RE.test(name) || name.startsWith('$')) continue
      if (roots.some((r) => existsSync(join(r, 'scripts', name)))) continue
      const key = `${i + 1}|${name}`
      if (!seen.has(key)) {
        seen.add(key)
        findings.push({ level: 'WARN', check: 'T4', line: i + 1, message: `命令脚本不存在：\`scripts/${name}\`` })
      }
    }
  }
  return findings
}

/** T5：零命中判据行与 P 的逐字块互斥。
 *  r2 修正（§7.2）：P=该行第一个路径型 token；T=该行其余全部反引号 token（不限扩展名）；
 *  块归属=内容含 P 的 basename 的围栏块（不依赖标题点名）；比对前归一反斜杠加倍形态。 */
export function checkZeroHit(lines, blocks) {
  const findings = []
  let skipped = 0
  const KW = /不得再出现|须为 0|须为0|无命中|零命中/
  const list = Array.isArray(blocks) ? blocks : []
  const norm = (s) => String(s).replace(/\\\\/g, '\\') // 反斜杠加倍形态 → 单斜杠
  const seen = new Set()
  for (let i = 0; i < lines.length; i++) {
    const ln = String(lines[i] ?? '')
    if (!KW.test(ln)) continue
    const paths = findPathTokens(ln)
    if (paths.length === 0) { skipped++; continue }
    const P = paths[0]
    const base = basename(P.replace(/\\/g, '/'))
    const Ts = inlineSpans(ln).filter((v) => v !== P)
    const owned = list.filter((b) => norm(b.content).includes(norm(base)))
    if (!owned.length) continue
    for (const T of Ts) {
      if (!owned.some((b) => norm(b.content).includes(norm(T)))) continue
      const key = `${i + 1}|${P}|${T}`
      if (seen.has(key)) continue
      seen.add(key)
      findings.push({ level: 'WARN', check: 'T5', line: i + 1, message: `零命中判据与逐字规格可能互斥：\`${T}\` 出现在 ${P} 的逐字块` })
    }
  }
  return { findings, skipped }
}

/** T0：白名单段与验收命令段结构存在性。 */
export function checkStructure(parsed) {
  const findings = []
  const hasWhitelist = (parsed.sections || []).some((s) => /白名单/.test(s.title))
  if (!hasWhitelist) findings.push({ level: 'WARN', check: 'T0', line: 0, message: '缺白名单段' })
  const hasFence = (parsed.blocks || []).length > 0
  const hasExit = (parsed.lines || []).some((l) => String(l).includes('exit='))
  if (!hasFence && !hasExit) findings.push({ level: 'WARN', check: 'T0', line: 0, message: '缺验收命令段' })
  return findings
}

/** T6：任务书退出码契约冲突（FAIL，围栏块外）。
 *  r3 增补（§8.2）；r4 收紧（§9.3 审核 W3）：
 *   - exit 2/退出码 2 与「用法」同/邻行 → FAIL（exit 2 为派发器专用）；
 *   - exit 4/5（退出码 4/5）须**同行**含具体脚本名才豁免，不再接受「适用面」泛指；
 *   - 唯一通用豁免=上下文含「派发器专用」（同/邻行），仅此一词。
 *  脚本名来源：同行 `scripts/<name>` 或调用方传入的现有脚本 basename 集（动态派生，零硬编码）。 */
export function checkExitContract(lines, blocks, scriptNames = []) {
  const findings = []
  const fenced = fencedLines(blocks)
  const EXEMPT = /派发器专用/
  const names = scriptNames.map((n) => String(n).replace(/\.mjs$/, '')).filter(Boolean)
  const near = (i) => [lines[i - 1], lines[i], lines[i + 1]].filter((v) => v !== undefined).join('\n')
  const push = (i, message) => findings.push({ level: 'FAIL', check: 'T6', line: i + 1, message })
  const hasScriptName = (ln) => {
    if (/scripts\/[A-Za-z0-9._-]+/.test(ln)) return true
    return names.some((n) => new RegExp(`(^|[^A-Za-z0-9._-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9._-])`).test(ln))
  }
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i + 1)) continue
    const ln = String(lines[i] ?? '')
    const ctx = near(i)
    if (EXEMPT.test(ctx)) continue
    if (/exit\s*=?\s*2\b|退出码\s*=?\s*2\b/.test(ln) && /用法/.test(ctx)) {
      push(i, '退出码 2 与 06 §5.8 契约冲突（exit 2 为派发器专用）')
      continue
    }
    if (hasScriptName(ln)) continue
    for (const m of ln.matchAll(/exit\s*=?\s*([45])\b|退出码\s*=?\s*([45])\b/g)) {
      push(i, `退出码 ${m[1] || m[2]} 缺适用面说明（06 §5.8 契约）`)
    }
  }
  return findings
}

/** L10 T9：§4 F 条目解析（全角竖线分隔五字段；围栏块内行跳过）。 */
export function parseFactEntries(parsed) {
  const lines = Array.isArray(parsed) ? parsed : (parsed.lines || [])
  const fenced = Array.isArray(parsed) ? new Set() : fencedLines(parsed.blocks || [])
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i + 1)) continue
    const ln = String(lines[i] ?? '').trim()
    if (!/^F-\d{2}\s*｜/.test(ln)) continue
    const p = ln.split('｜').map((s) => s.trim())
    if (p.length < 5) continue
    out.push({ id: p[0], label: p[1], cmd: p[2].replace(/^`+|`+$/g, '').trim(), declared: p[3], date: p[4], line: i + 1 })
  }
  return out
}

/** L10 T9：§6.1 E 条目解析（判据 #k / 基线 ← F / 增量 / 期望 / 算式；围栏块内跳过）。 */
export function parseExpectations(parsed) {
  const lines = Array.isArray(parsed) ? parsed : (parsed.lines || [])
  const fenced = Array.isArray(parsed) ? new Set() : fencedLines(parsed.blocks || [])
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i + 1)) continue
    const ln = String(lines[i] ?? '').trim()
    // L22 T14 E 兼容：E1/E-1/- E1/- E-1 四形态（列表前缀仅 ASCII 连字符后至少一个空白）；先剥前缀再按全角竖线切分，id=剥前缀后行首形态（终裁 11/N-5）。
    if (!/^(?:-\s+)?E-?\d+\s*｜/.test(ln)) continue
    const p = ln.replace(/^(?:-\s+)?/, '').split('｜').map((s) => s.trim())
    if (p.length < 6) continue
    const j = /判据\s*#\s*(\d+)/.exec(p[1])
    const b = /基线\s*(-?\d+)\s*←\s*(F-\d+)/.exec(p[2])
    const d = /增量\s*([+-]?\d+)/.exec(p[3])
    const x = /期望\s*(-?\d+)/.exec(p[4])
    if (!j || !b || !d || !x) continue
    const ex = /算式\s*(.+)$/.exec(p[5])
    out.push({ id: p[0], judge: Number(j[1]), base: Number(b[1]), delta: Number(d[1]), expect: Number(x[1]), expr: ex ? ex[1].trim() : '', factRef: b[2], line: i + 1 })
  }
  return out
}

/** L10 T9：验收表中计数型判据行（期望为整数/「N 行」，判据含计数命令且不含 exit；围栏块内跳过）。 */
export function parseNumericJudgeRows(parsed) {
  const lines = Array.isArray(parsed) ? parsed : (parsed.lines || [])
  const fenced = Array.isArray(parsed) ? new Set() : fencedLines(parsed.blocks || [])
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i + 1)) continue
    const c = String(lines[i] ?? '').split(/(?<!\\)\|/)
    if (c.length < 4 || !/^\d+$/.test(c[1].trim())) continue
    const judge = c[2]
    const want = c[3].replace(/\*\*|`/g, '').trim()
    if (!/^\d+$/.test(want) && !/^\d+\s*(行|条|个|项)$/.test(want)) continue
    if (judge.includes('exit')) continue
    if (!/grep\s+-c|wc\s+-l|\|\s*wc/.test(judge)) continue
    out.push({ judgeNo: Number(c[1].trim()), hasCmd: true, line: i + 1 })
  }
  return out
}

/** L10 T9：集合相等 + 基线±增量=期望 + 基线=F 声明值。 */
export function checkExpectations(eRows, numericRows, factEntries, evidence) {
  const findings = []
  const push = (line, message) => findings.push({ level: 'FAIL', check: 'T9', line, message })
  const S = new Set((numericRows || []).filter((r) => r.hasCmd).map((r) => r.judgeNo))
  const E = new Set((eRows || []).map((e) => e.judge))
  for (const k of S) if (!E.has(k)) push(0, MSG_MISSING_E(k))
  for (const k of E) if (!S.has(k)) push(0, `判据 #${k} 无对应计数型判据`)
  const facts = new Map((factEntries || []).map((f) => [f.id, f]))
  for (const e of eRows || []) {
    if (e.base + e.delta !== e.expect) push(e.line, `${e.id} 算式不成立：${e.base} ${e.delta >= 0 ? '+' : '-'} ${Math.abs(e.delta)} ≠ ${e.expect}`)
    const f = facts.get(e.factRef)
    if (!f) push(e.line, `${e.id} 引用的 ${e.factRef} 不存在`)
    else if (Number(f.declared) !== e.base) push(e.line, `${e.id} 基线 ${e.base} ≠ ${e.factRef} 声明值 ${f.declared}`)
  }
  return findings
}

/** 声明值按独立 token 匹配（数字需前后非数字边界）。 */
function tokenIn(s, v) {
  if (!/^\d+$/.test(v)) return s.includes(v)
  return new RegExp(`(?<!\\d)${v}(?!\\d)`).test(s)
}

/** L10 T12：F 条目与证据 JSON 的一致性（只读，不执行命令）。 */
export function verifyEvidence(factEntries, evidencePath) {
  const facts = Array.isArray(factEntries) ? factEntries : []
  const findings = []
  const push = (line, message) => findings.push({ level: 'FAIL', check: 'T12', line, message })
  if (!evidencePath) {
    if (facts.length) push(facts[0].line, '含 F 条目但未提供 --evidence')
    return { findings, entries: [] }
  }
  let doc
  try { doc = JSON.parse(readFileSync(evidencePath, 'utf8')) }
  catch { push(0, `证据文件不可读或不可解析：${evidencePath}`); return { findings, entries: [] } }
  if (!doc || doc.schema !== 'taskbook-evidence/v1' || !Array.isArray(doc.entries)) {
    push(0, '证据 schema 不符（需 taskbook-evidence/v1 且 entries 为数组）')
    return { findings, entries: [] }
  }
  const byId = new Map(doc.entries.map((e) => [e.id, e]))
  for (const f of facts) {
    const e = byId.get(f.id)
    if (!e) { push(f.line, `${f.id} 在证据中无同 id 条目`); continue }
    if (e.exit !== 0) push(f.line, `${f.id} 证据退出码为 ${e.exit}`)
    if (String(e.declared) !== String(f.declared)) push(f.line, `${f.id} 证据声明值与任务书不符`)
    else if (!tokenIn(String(e.stdout ?? ''), String(f.declared))) push(f.line, `${f.id} 声明值未在 stdout 独立 token 位出现`)
    if (String(e.date) !== String(f.date)) push(f.line, `${f.id} 证据日期与任务书不符`)
  }
  return { findings, entries: doc.entries }
}

// ── L22 T13/T14：门禁前移（词面扫描＋事实台账形态漏检） ──
/** T13 装载异常：词表/规则二不可得、不可解析或歧义；主入口映射 06 §5.8 行 3 退 3。 */
export class T13LoadError extends Error {}

/** 剥离 JS 行/块注释（字符串感知——引号/模板串/转义内注释起始对不剥离防误吞〔双审 W-2〕）；字符串态至文件尾未闭合=装载错（fail-loud，ds N2）；正则字面量状态不实现（division/regex 歧义需完整 lexer，超出本批）——DECL=1/恰 22 词断言兜底（对现行冻结词表源〔无引号正则形态〕与常见误剥形态必触发装载错；一般对抗构造下不成立——见实现报告 §18，RESIDUALS 候选）；块注释内同形声明不得装载（终裁 3）。 */
function stripJsComments(src) {
  let out = '', q = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) { out += c; if (c === '\\') { out += src[i + 1] ?? ''; i++ } else if (c === q) q = null; continue }
    if (c === '\'' || c === '"' || c === '\`') { q = c; out += c; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && src[i] + (src[i + 1] ?? '') !== '*/') { if (src[i] === '\n') out += '\n'; i++ } i++; continue }
    out += c
  }
  if (q) throw new T13LoadError('词表源字符串/模板字面量至文件尾未闭合——fail-loud（ds N2）'); return out
}

const BANNED_DECL_RE = /(?:^|\n)[ \t]*const[ \t]+BANNED[ \t]*=[ \t]*\[([\s\S]*?)\]/g, BANNED_ITEM_RE = /'([^'\n]+)'/g

/** 提取 BANNED：声明恰 1 份、词数恰 22、非空、去重仍 22；词序与源数组一致（报「第 N 词」）。 */
export function extractBannedFromSource(src) {
  const decls = [...stripJsComments(String(src ?? '')).matchAll(BANNED_DECL_RE)]
  if (decls.length !== 1) throw new T13LoadError(`BANNED 数组声明数=${decls.length}（须恰为 1）`)
  const words = [...decls[0][1].matchAll(BANNED_ITEM_RE)].map((m) => m[1])
  if (words.length !== 22) throw new T13LoadError(`词数=${words.length}（须恰为 22）`)
  if (words.some((w) => !w)) throw new T13LoadError('存在空词项'); if (new Set(words).size !== words.length) throw new T13LoadError('存在重复词项')
  return words
}

/** 词表单源装载：每 root 只探 scripts/verify-docs.mjs；规范化绝对路径去重后须恰一个存在文件。 */
export function loadBannedVocab(roots) {
  const seen = new Set(), cands = []
  for (const r of roots || []) { const p = resolve(join(String(r ?? ''), 'scripts', 'verify-docs.mjs')); if (!seen.has(p)) { seen.add(p); cands.push(p) } }
  const present = cands.filter((p) => existsSync(p))
  if (present.length === 0) throw new T13LoadError('词表源不可得（各 root 下无 scripts/verify-docs.mjs）')
  if (present.length > 1) throw new T13LoadError(`词表来源歧义：${present.length} 个不同源文件（不自行选择）`)
  let buf
  try { buf = readFileSync(present[0]) } catch (e) { throw new T13LoadError(`词表源读取失败：${present[0]}（${e.message}）`) }
  return { words: extractBannedFromSource(decodeUtf8Fatal(buf, '词表源')), path: present[0] }
}

const RULE2_KIND_RE = /\bkind\s*:\s*'rule2'/, RULE2_RE_LITERAL_RE = /\bre\s*:\s*\/((?:\\.|[^\\/\n])+)\/([a-z]*)\s*,?\s*\}/

const decodeUtf8Fatal = (buf, what) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { throw new T13LoadError(`${what}编码异常（非法 UTF-8 字节）`) } } // fatal UTF-8 解码：非法字节=装载错（§5.1 编码异常面＋双审 ds W-2）
const readSkillTerms = () => { let buf; try { buf = readFileSync(join(SKILL_ROOT, 'scripts', 'check-terms.mjs')) } catch (e) { throw new T13LoadError(`规则二源件不可读（${e.message}）`) } return decodeUtf8Fatal(buf, '规则二源件') } // 规则二生产源读取（缺省路径；Buffer＋fatal 解码）
/** 规则二两模式装载：物理行文本提取（不 import——源件无主流程守卫）；缺省参数=生产路径（双审 W-1），畸形夹具经参数注入（终裁 6）。 */
export function loadRule2Patterns(src) {
  if (src == null) src = readSkillTerms()
  const lines = String(src ?? '').split('\n'), idx = []
  for (let i = 0; i < lines.length; i++) if (RULE2_KIND_RE.test(lines[i])) idx.push(i)
  if (idx.length !== 2) throw new T13LoadError(`规则二对象行数=${idx.length}（须恰为 2）`)
  return idx.map((i, k) => {
    const m = RULE2_RE_LITERAL_RE.exec(lines[i])
    if (!m) throw new T13LoadError(`规则二模式${k === 0 ? '一' : '二'}正则字面量不可提取`)
    try { return new RegExp(m[1], m[2]) } catch (e) { throw new T13LoadError(`规则二模式${k === 0 ? '一' : '二'}正则重建失败（${e.message}）`) }
  })
}

// 整行注释豁免标记判定（\x2d 只表示连字符，防本件复写标记字样）：
const TERM_MARK_RE = /^\s*<!--\s*term\x2dscan:\s*(off|on)\s*-->\s*$/

/** T13 扫描面：掩蔽后全行扫描（围栏/历史小节不跳过）；整行 off/on 状态机——标记行自身不扫、未闭合 off 区
 *  静默持续到文件尾（终裁 12 锁定）、行内标记不豁免；同行同词一次异词分报；顺序=行升序、行内先源序后模式序。 */
export function scanTermLines(lines, banned, rule2Patterns) {
  const findings = []; let inOff = false
  for (let i = 0; i < lines.length; i++) {
    const ln = String(lines[i] ?? '')
    const m = TERM_MARK_RE.exec(ln)
    if (m) { inOff = m[1] === 'off'; continue }
    if (inOff) continue
    for (let w = 0; w < banned.length; w++) if (ln.includes(banned[w])) findings.push({ level: 'FAIL', check: 'T13', line: i + 1, message: `BANNED 表第 ${w + 1} 词命中` })
    rule2Patterns.forEach((re, p) => { re.lastIndex = 0; if (re.test(ln)) findings.push({ level: 'FAIL', check: 'T13', line: i + 1, message: `规则二模式${p === 0 ? '一' : '二'}命中` }) })
  }
  return findings
}

const FACT_REF_RE = /F-\d{2}/

/** T14 形态漏检（输入均为掩蔽后解析结果）：实名台账章内机读 F=0 且章内有 F 编号字样（表格形态漏网）→ WARN
 *  行号=首处；无台账章时全局补位一条 WARN。F 字样不因围栏跳过；tb-ignore 行已掩蔽；不升格 FAIL。 */
export function checkFactShape(parsed, factEntries) {
  const findings = [], lines = parsed?.lines || [], facts = Array.isArray(factEntries) ? factEntries : []
  const push = (line) => findings.push({ level: 'WARN', check: 'T14', line, message: '事实台账机读 F 为 0，但存在 F 编号字样' })
  const firstRefIn = (from, to) => { for (let ln = from; ln <= to; ln++) if (FACT_REF_RE.test(String(lines[ln - 1] ?? ''))) return ln; return 0 }
  const factSections = (parsed?.sections || []).filter((s) => String(s.title ?? '').includes('事实台账'))
  for (const s of factSections) if (!facts.some((f) => f.line > s.line && f.line <= s.endLine)) { const hit = firstRefIn(s.line + 1, s.endLine); if (hit) push(hit) }
  if (factSections.length === 0 && facts.length === 0) { const hit = firstRefIn(1, lines.length); if (hit) push(hit) }
  return findings
}

/** R-Y5-2①（T15）：机检命令记录（F 条目命令域）lint——grep -E/-P 模式串含转义管道
 *  `\|` 即 FAIL（Y4 #12b 教训：ERE/PCRE 语义下 `\|`=字面管道符，判据恒空跑）；普通
 *  管道（裸 `|` 或运算/管道衔接）与 BRE 形态（无 -E/-P，`\|`=或运算合法形态）不受
 *  影响。判定面=命令串整体含 grep 带 E/P 旗标且含 `\|` 字面。 */
export function checkEscapePipe(factEntries) {
  const findings = []
  const GREP_EP_RE = /grep\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*[EP][A-Za-z]*(?:\s|$)/
  for (const f of factEntries || []) {
    const cmd = String(f.cmd ?? '')
    if (GREP_EP_RE.test(cmd) && cmd.includes('\\|'))
      findings.push({ level: 'FAIL', check: 'T15', line: f.line, message: `${f.id} 机检命令 grep -E/-P 模式串含转义管道 \\|——ERE/PCRE 下=字面管道符（判据恒空跑，Y4 #12b）；或运算用裸 |` })
  }
  return findings
}

// ── W6 R2-T1 D-3：opt-in 语义 lint（T16～T20）──
// 仅 --semantic-lint 启用（assumption 5：缺省不改变 R1 fixture 与既有任务书的默认检查面）。
// 规则只读任务书文本，不执行验收命令；正反样在 self-test 的 /tmp 合成。
const T16_TERMS = ['公共七段', '白名单机制', '任务书事实台账', '期望值推导', '源文引用区', 'N=2', '白名单', '事实台账']
const T16_GAP_CLS = '[\\s「」『』《》（）()·—，,：:；;-]' // 连字符置于类尾：防「—-，」构成 U+2014–U+FF0C 字符范围误吞 CJK（M8 根因）
const T16_DEF_VERB_RE = new RegExp(`^(?:${T16_GAP_CLS}*)(是指|系指|定义为)`)
const T16_JI_RE = new RegExp(`^(?:${T16_GAP_CLS}*)即(?![可将使便时刻之停行用改归])`) // W-3/W-8/W-16：「即可/即停/即行」等非系词用法豁免
const T17_MODAL_RE = /必须|须|不得|(?<!门)禁/ // D-6（W-18）：负向断言仅排除名词「门禁」词形；禁止语义 禁改/禁推/禁止/严禁 保持命中
const T17_OBJECT_RES = [/D[\/↔]V/i, /F[\/↔]E/i, /fixture/i, /scaffold/i, /lint/i, /evidence/i, /\bCI\b/, /退出码/, /双审/, /实证/, /提交/]
const D_DECL_RE = /^\s*(?:[-*]\s*)?(?:\*\*)?\|?\s*D-(\d{1,2})\b/
const V_HEAD_RE = /^V-(\d{1,2})\b/
// W-2（席一）：规范锚=有效文件路径（扩展名判定）＋行号＋非空逐字片段
const SEMANTIC_CITE_PATH_RE = /\.(?:md|mjs|js|json|jsonl|txt|py|sh|yml|yaml|snippet)$/i
const SEMANTIC_CITE_RE = /`([^`\s:]+):(\d+)「([^「」\n]+)」`/g
const SEMANTIC_LITERAL = 'finding→定点 diff→机检/探针映射'

/** 规范锚有效性：反引号内「路径:行号「非空片段」」且路径带受支持扩展名；多命中取其一即真。 */
export function hasSemanticCite(text) {
  for (const m of String(text ?? '').matchAll(SEMANTIC_CITE_RE)) {
    if (SEMANTIC_CITE_PATH_RE.test(m[1])) return true
  }
  return false
}

/** T16 术语重定义：正文（围栏与源文引用区除外）以定义动词本地重解释受保护术语即 FAIL；每行至多一条。 */
export function checkTermRedefinition(parsed) {
  const findings = []
  const lines = parsed?.lines || []
  const fenced = fencedLines(parsed.blocks || [])
  const quoted = new Set()
  for (const s of parsed?.sections || []) {
    if (/源文引用区/.test(String(s.title ?? ''))) for (let i = s.line; i <= s.endLine; i++) quoted.add(i)
  }
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i + 1) || quoted.has(i + 1)) continue
    const ln = String(lines[i] ?? '')
    let hit = null
    for (const term of T16_TERMS) {
      let idx = ln.indexOf(term)
      while (idx >= 0 && !hit) {
        const rest = ln.slice(idx + term.length)
        if (T16_DEF_VERB_RE.test(rest) || T16_JI_RE.test(rest)) hit = term
        else idx = ln.indexOf(term, idx + 1)
      }
      if (hit) break
    }
    if (hit) findings.push({ level: 'FAIL', check: 'T16', line: i + 1, message: `术语本地定义：「${hit}」+定义动词——正文以单源指针承载，禁本地重定义` })
  }
  return findings
}

/** D 项声明行与 V 标题行提取（T17/T18/T19 共用单口径；围栏行不参与 D 项声明）。 */
export function dItemRows(parsed) {
  const out = []
  const lines = parsed?.lines || []
  const fenced = fencedLines(parsed.blocks || [])
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i + 1)) continue
    const m = D_DECL_RE.exec(String(lines[i] ?? ''))
    if (m) out.push({ id: `D-${m[1]}`, line: i + 1, text: String(lines[i] ?? '') })
  }
  return out
}

export function vHeadingRows(parsed) {
  const out = []
  for (const h of parsed?.headings || []) {
    const m = V_HEAD_RE.exec(String(h.title ?? ''))
    if (m) out.push({ id: `V-${m[1]}`, line: h.line, text: String(h.title ?? '') })
  }
  return out
}

/** A1（席二 W-2）：标准任务书形态下同 id 的 D 行同时出现在 §3.1 汇总表与 §3.4 带锚明细——
 *  声明主行=带规范锚的行（无带锚行时取首行），其余同 id 行为镜像行不参与 T18/T19；
 *  W-17 D-2b（r5 终稿）：重复计数与选带锚主行解耦——多行均带锚/均无锚均计 dupCount
 *  （汇总＋带锚明细不重复；无锚镜像行不计入带锚主行的 dup），T19 据此报重复声明。 */
export function dDeclRows(parsed) {
  const byId = new Map()
  for (const d of dItemRows(parsed)) {
    const cited = hasSemanticCite(d.text)
    const cur = byId.get(d.id)
    if (!cur) { byId.set(d.id, { ...d, cited, dupCount: 0 }); continue }
    if (cited && !cur.cited) byId.set(d.id, { ...d, cited, dupCount: cur.dupCount })
    else if (cited && cur.cited) cur.dupCount++
    else if (!cited && !cur.cited) cur.dupCount++ // W-17 D-2b：双侧均无锚同样计重复
  }
  return [...byId.values()]
}

/** T17 断言缺术语：D 项行、V 标题及显式 ASSERT: 行含模态词而无任一规范对象词即 FAIL。 */
export function checkAssertionObjects(parsed) {
  const findings = []
  const push = (line, message) => findings.push({ level: 'FAIL', check: 'T17', line, message })
  const scan = (text, line) => {
    if (!T17_MODAL_RE.test(text)) return
    if (!T17_OBJECT_RES.some((re) => re.test(text))) push(line, '断言缺规范对象词（须含 D/V、F/E、fixture、scaffold、lint、evidence、CI、退出码、双审、实证、提交之一）')
  }
  for (const d of dItemRows(parsed)) scan(d.text, d.line)
  for (const v of vHeadingRows(parsed)) scan(v.text, v.line)
  const lines = parsed?.lines || []
  const fenced = fencedLines(parsed.blocks || [])
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i + 1)) continue
    if (/ASSERT:/.test(String(lines[i] ?? ''))) scan(String(lines[i] ?? ''), i + 1)
  }
  return findings
}

/** T18 双锚缺失：D 项（声明主行）须有规范锚（有效文件路径:行号＋非空逐字片段）与至少一个 V 映射；
 *  V 标题须有至少一个 D 回锚。 */
export function checkDualAnchors(parsed) {
  const findings = []
  for (const d of dDeclRows(parsed)) {
    if (!hasSemanticCite(d.text)) findings.push({ level: 'FAIL', check: 'T18', line: d.line, message: `${d.id} 缺规范锚（有效文件路径:行号＋非空逐字片段）` })
    if (!/V-\d{1,2}(?!\d)/.test(d.text)) findings.push({ level: 'FAIL', check: 'T18', line: d.line, message: `${d.id} 缺 V 映射` })
  }
  for (const v of vHeadingRows(parsed)) {
    if (!/D-\d{1,2}(?!\d)/.test(v.text)) findings.push({ level: 'FAIL', check: 'T18', line: v.line, message: `${v.id} 标题缺 D 回锚` })
  }
  return findings
}

/** T19 D/V 集合不一致：D/V id 分别唯一（D 按 dDeclRows 去重口径，多行带锚才计重复）；
 *  D→V、V→D 引用须指向已声明 id（悬空）；W-13 双向边闭包——每条 D→V 边须有互认的 V→D 回边、
 *  反之亦然（交叉错配但无悬空 id=T19 红）。D 完全缺 V 映射归 T18（存在性锚），此处不重复报。 */
export function checkDVGraph(parsed) {
  const findings = []
  const dDecls = dDeclRows(parsed)
  const dDecl = new Map(dDecls.map((d) => [d.id, d]))
  const vDecl = new Map()
  for (const v of vHeadingRows(parsed)) {
    if (vDecl.has(v.id)) findings.push({ level: 'FAIL', check: 'T19', line: v.line, message: `V id 重复声明：${v.id}` })
    else vDecl.set(v.id, v)
  }
  for (const d of dDecls) {
    if (d.dupCount > 0) findings.push({ level: 'FAIL', check: 'T19', line: d.line, message: `D id 重复声明：${d.id}` })
  }
  const dToV = new Set(), vToD = new Set(), dHasV = new Set(), vHasD = new Set()
  for (const d of dDecls) {
    for (const m of d.text.matchAll(/V-(\d{1,2})(?!\d)/g)) {
      const id = `V-${m[1]}`
      if (!vDecl.has(id)) findings.push({ level: 'FAIL', check: 'T19', line: d.line, message: `悬空引用：${d.id} → ${id}（V 标题未声明）` })
      else { dToV.add(`${d.id}|${id}`); dHasV.add(d.id) }
    }
  }
  for (const v of vDecl.values()) {
    for (const m of v.text.matchAll(/D-(\d{1,2})(?!\d)/g)) {
      const id = `D-${m[1]}`
      if (!dDecl.has(id)) findings.push({ level: 'FAIL', check: 'T19', line: v.line, message: `悬空引用：${v.id} → ${id}（D 项未声明）` })
      else { vToD.add(`${id}|${v.id}`); vHasD.add(v.id) }
    }
  }
  // 双向边闭包（W-13）：仅对两侧均有引用的边判互认；一侧零引用=存在性缺陷归 T18，T19 沉默保单缺陷单 id。
  for (const key of dToV) {
    const [dId, vId] = key.split('|')
    if (!vHasD.has(vId)) continue
    if (!vToD.has(key)) findings.push({ level: 'FAIL', check: 'T19', line: dDecl.get(dId).line, message: `边不互认：${dId}→${vId} 无 ${vId}→${dId} 回边` })
  }
  for (const key of vToD) {
    const [dId, vId] = key.split('|')
    if (!dHasV.has(dId)) continue
    if (!dToV.has(key)) findings.push({ level: 'FAIL', check: 'T19', line: vDecl.get(vId).line, message: `边不互认：${vId}→${dId} 无 ${dId}→${vId} 回边` })
  }
  return findings
}

/** T20 修入映射缺失：只认编号 §4 纪律段（2 级「## 4.」标题，W-1/N-3），扫描含下级子标题的
 *  整个子树；段内（围栏外）须逐字含修入映射字面；报告模板提及不算。 */
export function checkAmendMapping(parsed) {
  const findings = []
  const sec = (parsed?.sections || []).find((s) => s.level === 2 && /^4\.\s/.test(String(s.title ?? '')))
  if (!sec) {
    findings.push({ level: 'FAIL', check: 'T20', line: 0, message: '缺编号纪律段（## 4.），修入映射无从承载' })
    return findings
  }
  const fenced = fencedLines(parsed.blocks || [])
  const body = []
  for (let ln = sec.line + 1; ln <= sec.endLine; ln++) if (!fenced.has(ln)) body.push(parsed.lines[ln - 1] ?? '')
  if (!body.join('\n').includes(SEMANTIC_LITERAL)) {
    findings.push({ level: 'FAIL', check: 'T20', line: sec.line, message: '§4 纪律段缺逐字「finding→定点 diff→机检/探针映射」修入映射（近义句或仅报告模板提及不算）' })
  }
  return findings
}

/** 语义 lint 汇总入口（仅 --semantic-lint 调用；返回 T16～T20 全部 findings）。 */
export function checkSemanticLint(parsed) {
  return [
    ...checkTermRedefinition(parsed),
    ...checkAssertionObjects(parsed),
    ...checkDualAnchors(parsed),
    ...checkDVGraph(parsed),
    ...checkAmendMapping(parsed),
  ]
}

// ── 自检（夹具落 os.tmpdir()，向量 ≥40） ──
function selfTest(extraRoots = []) {
  const cases = []
  const add = (name, ok, detail = '') => cases.push({ name, ok: !!ok, detail })
  // r5 §10.1：盘符样例一律运行时拼接——源码不出现「盘符字母+冒号+斜杠」连续字面量
  // （分享面 DRIVE_RE 扫的是该形态；此构造不削弱检测能力，正则判定面原样保留）
  const DRV = 'E' + ':'
  const DRV_F = 'F' + ':'
  const tmp = mkdtempSync(join(tmpdir(), 'check-taskbook-'))
  try {
    mkdirSync(join(tmp, 'scripts'), { recursive: true })
    mkdirSync(join(tmp, 'docs'), { recursive: true })
    // L22 隔离态合成词表源（终裁 5）：22 个等宽互异且互不为子串的定宽 token；既有向量子进程统一注入合成源保持原退出码语义，正常任务书扫描绝不使用合成词表。
    const SYN_TOKENS = Array.from({ length: 22 }, (_, i) => 'tk' + String(i + 1).padStart(2, '0'))
    const vocabSrc = (arr) => 'const BANNED = [\n' + arr.map((t) => "  '" + t + "',").join('\n') + '\n]\n'
    writeFileSync(join(tmp, 'scripts', 'verify-docs.mjs'), vocabSrc(SYN_TOKENS), 'utf8')
    writeFileSync(join(tmp, 'SKILL.md'), 'line one\nline two target-fragment\nline three\n', 'utf8')
    writeFileSync(join(tmp, 'docs', 'note.md'), 'line one\nline two target-fragment\nline three\n', 'utf8')
    writeFileSync(join(tmp, 'scripts', 'present.mjs'), '// present\n', 'utf8')
    writeFileSync(join(tmp, 'scripts', 'agent-slots.mjs'), '// slots\n', 'utf8')
    const reader = makeReader([tmp])

    // T1 正例
    const t1ok = findPathTokens('见 `SKILL.md` 与 `scripts/present.mjs`')
    add('T1 正例：裸文件名+相对路径均提取且存在', t1ok.length === 2 && reader('SKILL.md').exists && reader('scripts/present.mjs').exists, JSON.stringify(t1ok))
    // T1 负例
    const t1bad = findPathTokens('见 `scripts/missing.mjs`')
    add('T1 负例：缺失路径被提取且 reader 判不存在', t1bad.length === 1 && !reader(t1bad[0]).exists, JSON.stringify(t1bad))
    // T1 跳过：绝对路径
    add('T1 跳过：以 / 开头的绝对路径不计入且计入跳过', findPathTokens('`/tmp/x.md`').length === 0 && findSkippedPathTokens('`/tmp/x.md`').length === 1)
    // T1 跳过：占位符
    add('T1 跳过：含通配/占位符的串不计入', findPathTokens('`scripts/*.mjs`').length === 0 && findPathTokens('`docs/<name>.md`').length === 0)

    // T2 越界
    const t2bad = checkCitations(extractCitationTokens(['`SKILL.md:9999`']), reader)
    add('T2 越界：行号 > 总行数判 FAIL', t2bad.some((f) => f.check === 'T2' && f.level === 'FAIL' && f.message.includes('行号越界')), JSON.stringify(t2bad))
    // T2 未越界
    add('T2 未越界：行号在范围内不报', checkCitations(extractCitationTokens(['`SKILL.md:2`']), reader).length === 0)
    // T2b 命中
    add('T2b 命中：第 2 行含原文片段不报', checkCitations(extractCitationTokens(['`SKILL.md:2「line two」`']), reader).length === 0)
    // T2b 不命中
    const t2bMiss = checkCitations(extractCitationTokens(['`SKILL.md:2「no such text」`']), reader)
    add('T2b 不命中：片段不在第 2 行判 FAIL', t2bMiss.some((f) => f.check === 'T2b' && f.message.includes('不含引用的原文片段')), JSON.stringify(t2bMiss))
    // ── W5b D-5 T2c 畸形 span 显式化（恰 2 向量·112→114）──
    add('T2c 未闭合/嵌套反引号行判 FAIL：围栏外物理行反引号计数为奇数→T2c FAIL（畸形 span 不再静默跳过）', (() => {
      if (typeof checkSpanIntegrity !== 'function') return false
      const f1 = checkSpanIntegrity(['行 `a` 与 `b 未闭合收尾'], new Set())
      const f2 = checkSpanIntegrity(['`docs/note.md:2「line two」` 与 `尾残'], new Set())
      return f1.some((x) => x.check === 'T2c' && x.level === 'FAIL' && x.message.includes('未闭合'))
        && f2.some((x) => x.check === 'T2c' && x.level === 'FAIL')
    })(), '')
    add('T2c 引用候选未完整成 span／空片段判 FAIL：路径型候选裸露 span 外→FAIL；引用 span 片段为空「」→FAIL', (() => {
      if (typeof checkSpanIntegrity !== 'function') return false
      const f1 = checkSpanIntegrity(['见 docs/note.md:2「line two」无 span 包裹'], new Set())
      const f2 = checkSpanIntegrity(['`docs/note.md:2「」` 空片段'], new Set())
      return f1.some((x) => x.check === 'T2c' && x.level === 'FAIL' && x.message.includes('span'))
        && f2.some((x) => x.check === 'T2c' && x.level === 'FAIL' && x.message.includes('空'))
    })(), '')
    // ── W-17 D-2a 简写锚：同物理行按 span 顺序继承最近显式路径（恰 1 向量·三子断言） ──
    add('W-17 D-2a 简写锚：同线裸 `:NN「frag」` 继承最近显式路径生成 quote token——同线正确 0 finding＋错误片段 T2b＋双显式路径取最近路径而非恒取首路径',
      (() => {
        const okTokens = extractCitationTokens(['`docs/note.md:2「line two」`、`:3「line three」`'])
        const okRun = checkCitations(okTokens, reader)
        const badRun = checkCitations(extractCitationTokens(['`docs/note.md:2「line two」`、`:2「no such text」`']), reader)
        const nearTokens = extractCitationTokens(['`docs/note.md` 与 `scripts/present.mjs` 与 `:1「// present」`'])
        const okOk = okTokens.length === 2 && okTokens[1].kind === 'quote' && okTokens[1].path === 'docs/note.md' && okTokens[1].n === 3 && okRun.length === 0
        const badOk = badRun.some((f) => f.check === 'T2b' && f.message.includes('不含引用的原文片段'))
        const nearOk = nearTokens.length === 1 && nearTokens[0].path === 'scripts/present.mjs' && nearTokens[0].n === 1 && checkCitations(nearTokens, reader).length === 0
        return okOk && badOk && nearOk
      })(), '')
    // ── W-17 D-2b 无锚重复：重复计数与带锚主行解耦（恰 1 向量·两子断言） ──
    add('W-17 D-2b 无锚重复：双侧均无锚的重复 D 行计 dupCount 且报 T19；多行均带锚分支同样计 dupCount 且汇总明细不重复',
      (() => {
        const bare = parseTaskbook('### V-1 探针（D-9）\n\n| D-9 探针 | 无锚 | V-1 |\n| D-9 探针 | 无锚 | V-1 |\n')
        const bareRows = dDeclRows(bare)
        const bareRed = checkDVGraph(bare)
        const anchored = parseTaskbook('### V-1 探针（D-9）\n\n| D-9 探针 | 规范锚=`docs/note.md:1「line one」` | V-1 |\n| D-9 探针 | 规范锚=`docs/note.md:2「line two」` | V-1 |\n')
        const anchRows = dDeclRows(anchored)
        const anchRed = checkDVGraph(anchored)
        const dupMsgs = (f) => f.filter((x) => x.check === 'T19' && x.message.includes('D id 重复声明'))
        return bareRows.length === 1 && bareRows[0].dupCount === 1 && dupMsgs(bareRed).length === 1
          && anchRows.length === 1 && anchRows[0].dupCount === 1 && anchRows[0].line === 3 && dupMsgs(anchRed).length === 1
      })(), '')
    // ── W-17 D-2c 简写边界：跨行不继承＋无前行显式路径无假锚＋夹具钉死「前行有显式路径＋本行裸 :NN」（恰 1 向量） ──
    add('W-17 D-2c 简写边界：前行有显式路径＋本行裸 `:NN「frag」` 不跨行继承（无 quote token）；孤行裸 :NN 无前行路径不产生 T2b/T2 假锚',
      (() => {
        const cross = extractCitationTokens(['`docs/note.md`', '`:2「line two」`'])
        const lone = extractCitationTokens(['`:2「line two」`'])
        const loneCited = checkCitations(lone, reader)
        return cross.length === 0 && lone.length === 0 && loneCited.length === 0
      })(), '')

    // T3 交集
    const t3yes = parseTaskbook('## 2. 白名单\n\n`scripts/present.mjs`\n\n## 3. 禁止改动\n\n`scripts/present.mjs`\n')
    add('T3 交集：同一路径同时出现判冲突', checkWhitelistConflict(t3yes).length === 1, JSON.stringify(checkWhitelistConflict(t3yes)))
    // T3 无交集
    const t3no = parseTaskbook('## 2. 白名单\n\n`scripts/present.mjs`\n\n## 3. 禁止改动\n\n`scripts/agent-slots.mjs`\n')
    add('T3 无交集：不同路径不报', checkWhitelistConflict(t3no).length === 0)
    // T3 正文「禁止改动：」段落
    const t3body = parseTaskbook('## 2. 白名单\n\n`scripts/present.mjs`\n\n禁止改动：\n`scripts/present.mjs`\n')
    add('T3 正文段落：禁止改动：起段亦参与交集', checkWhitelistConflict(t3body).length === 1)

    // T4 命中/缺失
    add('T4 命中：node scripts/present.mjs 存在不报', checkCommandScripts(['node scripts/present.mjs'], [tmp]).length === 0)
    const t4miss = checkCommandScripts(['node scripts/absent.mjs'], [tmp])
    add('T4 缺失：命令引用不存在脚本判 WARN', t4miss.length === 1 && t4miss[0].level === 'WARN', JSON.stringify(t4miss))

    // T5 互斥/不互斥（r2：块归属按内容含 P basename，故块内须出现 P）
    const t5text = (blockBody) => [
      '### 3.1',
      '',
      '```',
      blockBody,
      '```',
      '',
      '该文件不得再出现 `docs/note.md` 与 `docs/snippet.txt`（须为 0）。',
      '',
    ].join('\n')
    const t5yes = parseTaskbook(t5text('docs/note.md\nsnippet: docs/snippet.txt'))
    const z5yes = checkZeroHit(t5yes.lines, t5yes.blocks)
    add('T5 互斥：被测串出现在 P 的逐字块判 WARN', z5yes.findings.length === 1 && z5yes.findings[0].check === 'T5', JSON.stringify(z5yes.findings))
    const t5no = parseTaskbook(t5text('docs/note.md\nclean content'))
    add('T5 不互斥：逐字块不含被测串不报', checkZeroHit(t5no.lines, t5no.blocks).findings.length === 0)

    // r2 §7.1 回归：白名单表 + 紧邻禁改段（同节布局）
    const t3adjacentNo = parseTaskbook('## 2. 白名单\n\n| `docs/a.md` | 改 |\n\n禁止改动：`scripts/other.mjs`。\n\n## 3. 规格\n')
    add('r2 T3 回归负例：白名单表+紧邻禁改段（不同路径）→ 0 finding',
      checkWhitelistConflict(t3adjacentNo).length === 0, JSON.stringify(checkWhitelistConflict(t3adjacentNo)))
    const t3adjacentYes = parseTaskbook('## 2. 白名单\n\n| `docs/a.md` | 改 |\n\n禁止改动：`docs/a.md`。\n\n## 3. 规格\n')
    add('r2 T3 回归正例：禁改段与白名单表同路径 → 1 finding（取自白名单行）',
      (() => { const r = checkWhitelistConflict(t3adjacentYes); return r.length === 1 && r[0].line === 3 })())
    // r2 §7.1：围栏块内部不参与交集
    const t3fence = parseTaskbook('## 2. 白名单\n\n`docs/a.md`\n\n## 3. 禁止改动\n\n```\n`docs/a.md`\n```\n')
    add('r2 T3 跳过围栏块：禁改章节的围栏块内 token 不入 B',
      checkWhitelistConflict(t3fence).length === 0, JSON.stringify(checkWhitelistConflict(t3fence)))

    // r2 §7.2 回归：P7 真实形态（盘符前缀 + 无扩展名被测串 + 反斜杠加倍归一）
    const t5p7 = parseTaskbook('## 3. 规格\n\n```\n- 见 `docs/a.md` 与 `' + DRV + '\\legacy\\snap.md`\n```\n\n## 4. 验收\n\n`docs/a.md` 中 `' + DRV + '\\` 须为 0。\n')
    const z5p7 = checkZeroHit(t5p7.lines, t5p7.blocks)
    add('r2 T5 回归正例：无扩展名盘符前缀被测串命中逐字块 → WARN',
      z5p7.findings.length === 1 && z5p7.findings[0].message.includes(DRV), JSON.stringify(z5p7.findings))
    const t5p7no = parseTaskbook('## 3. 规格\n\n```\n- 见 `docs/a.md` 与 `' + DRV + '\\legacy\\snap.md`\n```\n\n## 4. 验收\n\n`docs/a.md` 中 `' + DRV_F + '\\` 须为 0。\n')
    add('r2 T5 回归负例：块内无该被测串 → 0 finding',
      checkZeroHit(t5p7no.lines, t5p7no.blocks).findings.length === 0,
      JSON.stringify(checkZeroHit(t5p7no.lines, t5p7no.blocks).findings))

    // r4 §9.2：双侧形态不变式（白名单表行 + 禁改段行 同路径）
    const t3both = parseTaskbook('## 2. 白名单\n\n| `docs/a.md` | 改 |\n\n禁止改动：`docs/a.md`。\n')
    const z3both = checkWhitelistConflict(t3both)
    add('r4 T3 双侧形态：同一路径在表行与禁改段行 → 1 finding 且行号指向白名单行',
      z3both.length === 1 && z3both[0].line === 3, JSON.stringify(z3both))

    // T0 两段缺失/齐备
    const t0bad = checkStructure(parseTaskbook('hello\n'))
    add('T0 两段缺失：缺白名单段+缺验收命令段', t0bad.length === 2, JSON.stringify(t0bad))
    const t0ok = checkStructure(parseTaskbook('## 2. 白名单\n\n```bash\necho "exit=$?"\n```\n'))
    add('T0 齐备：白名单+验收命令均在位不报', t0ok.length === 0, JSON.stringify(t0ok))

    // r1 豁免标记：tb-ignore 行跳过全部检查并计入跳过数
    const ignoreFixture = join(tmp, 'ignore.md')
    writeFileSync(ignoreFixture, [
      '# 豁免夹具',
      '',
      '## 2. 白名单',
      '',
      '`scripts/ignored-missing.mjs` <!-- tb-ignore -->',
      '',
      '`scripts/reported-missing.mjs`',
      '',
      '## 4. 验收命令',
      '',
      '```bash',
      'echo "exit=$?"',
      '```',
      '',
    ].join('\n'), 'utf8')
    const runIgnore = spawnSync(process.execPath, [SELF, ignoreFixture, '--root', tmp, '--json'], { encoding: 'utf8' })
    let ig = null
    try { ig = JSON.parse(runIgnore.stdout) } catch { ig = null }
    const msgs = ig?.findings?.map((f) => f.message) || []
    add('r1 tb-ignore：标记行不产生 finding 且计入跳过',
      ig !== null && msgs.some((m) => m.includes('reported-missing.mjs')) && !msgs.some((m) => m.includes('ignored-missing.mjs')) && ig.summary.skipped >= 1,
      runIgnore.stdout.slice(0, 240))
    add('r1 tb-ignore 行级生效：同文件未标记行仍正常报告',
      ig !== null && ig.findings.length === 1 && ig.findings[0].check === 'T1' && ig.findings[0].line === 7,
      JSON.stringify(ig?.findings ?? null))

    // r1 同步规格：T1 跳过围栏内部 / Windows 盘符绝对路径
    const fenceParsed = parseTaskbook('text\n```\n`scripts/in-fence.mjs`\n```\n')
    add('T1 跳过：围栏代码块内部行被 fencedLines 覆盖',
      fencedLines(fenceParsed.blocks).has(3) && !fencedLines(fenceParsed.blocks).has(1))
    const drvWin = '`' + DRV + '\\zcode_md\\x.md`'
    add('T1 跳过：Windows 盘符绝对路径计入跳过', findPathTokens(drvWin).length === 0 && findSkippedPathTokens(drvWin).length === 1)

    // r3 §8.2：T6 退出码契约
    const t6bad = parseTaskbook('无位置参数 → 用法错，exit 2。\n')
    const z6bad = checkExitContract(t6bad.lines, t6bad.blocks)
    add('r3 T6 命中：用法错 exit 2 → FAIL（exit 2 派发器专用）',
      z6bad.length === 1 && z6bad[0].check === 'T6' && z6bad[0].message.includes('契约冲突'), JSON.stringify(z6bad))
    const t6exempt = parseTaskbook('派发器专用：源链耗尽 exhaust exit 2。\n')
    add('r3 T6 豁免：exit 2 同行说明派发器专用 → 不报',
      checkExitContract(t6exempt.lines, t6exempt.blocks).length === 0)
    const t6load = parseTaskbook('任务书不存在 → 装载错 exit 3。\n')
    add('r3 T6 不误报：装载错 exit 3 → 不报',
      checkExitContract(t6load.lines, t6load.blocks).length === 0)
    const t6degrade = parseTaskbook('扫描面不可用 → exit 5。\n')
    add('r3 T6 补：exit 5 无适用面说明 → FAIL',
      checkExitContract(t6degrade.lines, t6degrade.blocks).length === 1)
    const t6fence = parseTaskbook('```\n用法错 exit 2\n```\n')
    add('r3 T6 围栏外限定：围栏块内的 exit 2 不报',
      checkExitContract(t6fence.lines, t6fence.blocks).length === 0)

    // r4 §9.3：T6 升 FAIL + 豁免收紧（W3）
    add('r4 T6 级别：契约冲突为 FAIL（不再 WARN）',
      z6bad.length === 1 && z6bad[0].level === 'FAIL', JSON.stringify(z6bad))
    const t6kinds = parseTaskbook('扫描面不可用 → exit 5。\n')
    add('r4 T6 exit 5 无脚本名 → FAIL（原 WARN 升格）',
      (() => { const r = checkExitContract(t6kinds.lines, t6kinds.blocks, ['check-hardcode']); return r.length === 1 && r[0].level === 'FAIL' })())
    const t6broad = parseTaskbook('仅作适用面举例 → exit 5。\n')
    add('r4 T6 收紧：「适用面」不再豁免（无脚本名）→ FAIL',
      checkExitContract(t6broad.lines, t6broad.blocks, ['check-hardcode']).length === 1,
      JSON.stringify(checkExitContract(t6broad.lines, t6broad.blocks, ['check-hardcode'])))
    const t6script = parseTaskbook('exit 5（check-hardcode 降级运行）\n')
    add('r4 T6 豁免收紧：同行含 exit 5 + check-hardcode → 不报',
      checkExitContract(t6script.lines, t6script.blocks, ['check-hardcode']).length === 0)
    const t6script4 = parseTaskbook('exit 4（ds-call-v2 本地 IO 错）\n')
    add('r4 T6 豁免：同行含 exit 4 + 裸脚本名 ds-call-v2 → 不报',
      checkExitContract(t6script4.lines, t6script4.blocks, ['ds-call-v2']).length === 0)

    // 夹具任务书
    const valid = join(tmp, 'valid.md')
    writeFileSync(valid, [
      '# 自检夹具',
      '',
      '## 2. 白名单',
      '',
      '| `scripts/present.mjs` | 新建 |',
      '',
      '## 4. 验收命令',
      '',
      '```bash',
      'node scripts/present.mjs',
      'echo "exit=$?"',
      '```',
      '',
      '引用 `docs/note.md:2「line two」` 与 `docs/note.md` 第 2 行。',
      '',
    ].join('\n'), 'utf8')
    const bad = join(tmp, 'bad.md')
    writeFileSync(bad, [
      '# 坏夹具',
      '',
      '## 2. 白名单',
      '',
      '| `scripts/present.mjs` | 改 |',
      '',
      '## 3. 禁止改动',
      '',
      '`scripts/present.mjs`',
      '',
      '`docs/note.md:9999「不存在」`',
      '',
    ].join('\n'), 'utf8')
    const run = (args, withRoot = true) => spawnSync(process.execPath, [SELF, ...args, ...(withRoot ? ['--root', tmp] : [])], { encoding: 'utf8' })
    const r0 = run([valid])
    add('退出码映射 0：合规夹具 exit 0', r0.status === 0, `status=${r0.status} out=${r0.stdout}`)
    const r1 = run([bad])
    add('退出码映射 1：T2/T3 FAIL exit 1', r1.status === 1 && /FAIL ×[1-9]/.test(r1.stdout), `status=${r1.status} out=${r1.stdout}`)
    const r2 = spawnSync(process.execPath, [SELF], { encoding: 'utf8' })
    add('退出码映射 1（用法错）：无位置参数按 06 §5.8 用法/参数错退 1', r2.status === 1, `status=${r2.status}`)
    const r3 = run([join(tmp, 'no-such-taskbook.md')])
    add('退出码映射 3：任务书不存在 exit 3', r3.status === 3 && r3.stderr.includes('[装载错]'), `status=${r3.status}`)
    const rj = run([valid, '--json'])
    let jsonOk = false
    let jsonDetail = ''
    try {
      const o = JSON.parse(rj.stdout)
      jsonOk = o.taskbook === valid && Array.isArray(o.findings) && o.summary && typeof o.summary.warn === 'number' && typeof o.summary.fail === 'number' && typeof o.summary.skipped === 'number'
      jsonDetail = rj.stdout.slice(0, 160)
    } catch (e) { jsonDetail = e.message }
    add('--json 形态：taskbook/findings/summary 单对象', jsonOk, jsonDetail)

    // ── L10 T9/T12 自检（12 向量；夹具落 tmp） ──
    const t9Facts = [{ id: 'F-01', declared: '0', line: 1, date: '2026-10-22' }]
    const t9Good = [{ id: 'E1', judge: 7, base: 0, delta: 1, expect: 1, expr: '0 + 1 = 1', factRef: 'F-01', line: 2 }]
    const t9Num = [{ judgeNo: 7, hasCmd: true, line: 3 }]
    add('L10 T9 正例：算式与集合均成立不报', checkExpectations(t9Good, t9Num, t9Facts, null).length === 0)
    const t9Calc = checkExpectations([{ ...t9Good[0], delta: 2, expect: 1 }], t9Num, t9Facts, null)
    add('L10 T9 算式错：基线±增量≠期望判 FAIL', t9Calc.some((f) => f.check === 'T9' && f.message.includes('算式')), JSON.stringify(t9Calc))
    const t9Miss = checkExpectations([], t9Num, t9Facts, null)
    add('L10 T9 集合缺项：消息取 MSG_MISSING_E 常量', t9Miss.some((f) => f.message === MSG_MISSING_E(7)), JSON.stringify(t9Miss))
    const t9Extra = checkExpectations(t9Good, [], t9Facts, null)
    add('L10 T9 集合多项：E 判据无对应计数型行判 FAIL', t9Extra.some((f) => f.check === 'T9' && f.message.includes('无对应')), JSON.stringify(t9Extra))
    const t9Base = checkExpectations(t9Good, t9Num, [{ ...t9Facts[0], declared: '5' }], null)
    add('L10 T9 基线≠F 声明值：判 FAIL', t9Base.some((f) => f.message.includes('基线')), JSON.stringify(t9Base))
    const t9Table = parseTaskbook('| # | 判据（含取证命令） | 期望 | 依据 |\n|---|---|---|---|\n| 1 | `node scripts/x.mjs --self-test` | 0 | 证 |\n| 7 | `grep -c x a.md` | 1 | 证 |\n')
    const t9Rows = parseNumericJudgeRows(t9Table)
    add('L10 T9 退出码判据不误判：--self-test 行不入 S，grep -c 行入 S', t9Rows.length === 1 && t9Rows[0].judgeNo === 7, JSON.stringify(t9Rows))
    const evPath = join(tmp, 'evidence.json')
    const evGood = { schema: 'taskbook-evidence/v1', entries: [{ id: 'F-01', exit: 0, stdout: '0\n', declared: '0', date: '2026-10-22' }] }
    const writeEv = (o) => { writeFileSync(evPath, JSON.stringify(o), 'utf8'); return evPath }
    const t12NoEv = verifyEvidence(t9Facts, null).findings
    add('L10 T12 F 条目缺 --evidence：判 FAIL', t12NoEv.some((f) => f.check === 'T12' && f.message.includes('未提供 --evidence')), JSON.stringify(t12NoEv))
    const t12Schema = verifyEvidence(t9Facts, writeEv({ schema: 'bad', entries: [] })).findings
    add('L10 T12 schema 不符：判 FAIL（合规 schema 不报）', t12Schema.length === 1 && t12Schema[0].message.includes('schema') && verifyEvidence(t9Facts, writeEv(evGood)).findings.length === 0, JSON.stringify(t12Schema))
    const t12Id = verifyEvidence(t9Facts, writeEv({ schema: 'taskbook-evidence/v1', entries: [] })).findings
    add('L10 T12 无同 id：判 FAIL', t12Id.some((f) => f.message.includes('无同 id')), JSON.stringify(t12Id))
    const t12Exit = verifyEvidence(t9Facts, writeEv({ ...evGood, entries: [{ ...evGood.entries[0], exit: 1 }] })).findings
    add('L10 T12 证据 exit≠0：判 FAIL', t12Exit.some((f) => f.message.includes('退出码')), JSON.stringify(t12Exit))
    const t12Tok = verifyEvidence(t9Facts, writeEv({ ...evGood, entries: [{ ...evGood.entries[0], stdout: '10\n' }] })).findings
    add('L10 T12 声明值非独立 token：判 FAIL', t12Tok.some((f) => f.message.includes('独立 token')), JSON.stringify(t12Tok))
    const t12Date = verifyEvidence(t9Facts, writeEv({ ...evGood, entries: [{ ...evGood.entries[0], date: '2026-10-23' }] })).findings
    add('L10 T12 证据日期不符：判 FAIL', t12Date.some((f) => f.message.includes('日期')), JSON.stringify(t12Date))
    // ── R-Y5-2① T15 向量：机检命令转义管道 lint ──
    const t15Red = checkEscapePipe([{ id: 'F-01', cmd: 'grep -cE "a\\|b" x.md', line: 5 }, { id: 'F-02', cmd: 'grep -P "x\\|y" y.md', line: 6 }])
    add('T15 红：grep -E/-P 模式串含转义管道 \\| 判 FAIL', t15Red.length === 2 && t15Red[0].check === 'T15' && t15Red[0].level === 'FAIL' && t15Red[0].line === 5 && t15Red[1].line === 6, JSON.stringify(t15Red))
    add('T15 过：裸 | 或运算/普通管道/BRE \\| 形态均不报', checkEscapePipe([{ id: 'F-01', cmd: 'grep -cE "a|b" x.md | wc -l', line: 7 }, { id: 'F-02', cmd: 'grep -c "a\\|b" y.md', line: 8 }, { id: 'F-03', cmd: 'node scripts/x.mjs --self-test', line: 9 }]).length === 0)
    // ── r1 §10.2/§10.3 反例向量（6 条） ──
    add('r1 W2 exitCode 判据按子串口径排除', parseNumericJudgeRows(parseTaskbook('| 7 | `grep -c x a.md --exitCode` | 1 | 证 |\n')).length === 0)
    add('r1 W2 判据含 exit 字面量排除', parseNumericJudgeRows(parseTaskbook('| 7 | `grep -c x a.md; echo exit=$?` | 1 | 证 |\n')).length === 0)
    add('r1 W3 围栏内 F 条目不生效', parseFactEntries(parseTaskbook('```\nF-01 ｜ 围栏内 ｜ `true` ｜ 0 ｜ 2026-10-22\n```\n')).length === 0)
    add('r1 W3 围栏内 E 条目不生效', parseExpectations(parseTaskbook('```\nE1 ｜ 判据 #7 ｜ 基线 0 ← F-01 ｜ 增量 +1 ｜ 期望 1 ｜ 算式 0 + 1 = 1\n```\n')).length === 0)
    add('r1 W3 围栏内判据行不生效', parseNumericJudgeRows(parseTaskbook('```\n| 7 | `grep -c x a.md` | 1 | 证 |\n```\n')).length === 0)
    const w3o = parseTaskbook('F-02 ｜ 外 ｜ `true` ｜ 0 ｜ 2026-10-22\nE1 ｜ 判据 #7 ｜ 基线 0 ← F-02 ｜ 增量 +1 ｜ 期望 1 ｜ 算式 0 + 1 = 1\n| 7 | `grep -c x a.md` | 1 | 证 |\n')
    add('r1 W3 围栏外同类行仍生效', parseFactEntries(w3o).length === 1 && parseExpectations(w3o).length === 1 && parseNumericJudgeRows(w3o).length === 1, JSON.stringify([parseFactEntries(w3o), parseExpectations(w3o), parseNumericJudgeRows(w3o)]))

    // ── L22 T13/T14 自检（9 向量；隔离态=tmp 合成词表源，集成态=extraRoots 真实源——终裁 5） ──
    let integWords = null
    if (extraRoots.length) { try { integWords = loadBannedVocab(extraRoots).words } catch { integWords = null } }
    const isoWords = loadBannedVocab([tmp]).words, actWords = integWords || isoWords // 活动源＝集成态真实 22 词 / 隔离态合成 token
    const prodRule2 = loadRule2Patterns(), selfSrc = readFileSync(SELF, 'utf8')
    const runVocab = (args) => spawnSync(process.execPath, [SELF, ...args, ...(extraRoots.length ? extraRoots.flatMap((r) => ['--root', r]) : ['--root', tmp])], { encoding: 'utf8' })
    const subScan = (args) => { const r = runVocab(args); const f = (() => { try { return (JSON.parse(r.stdout).findings || []).filter((x) => x.check === 'T13') } catch { return [] } })(); return { status: r.status, f } }
    writeFileSync(join(tmp, 't13-01.md'), '# T13 正例夹具\n\n正文样本：' + actWords[19] + ' 与 ' + actWords[19] + ' 及 ' + actWords[0] + '。\n', 'utf8')
    const s13a = subScan([join(tmp, 't13-01.md'), '--json'])
    add('L22 T13-01 正例：活动词表第 20 词同行去重 1 条＋第 1 词 1 条=恰 2 条且词序正确（被测进程退 1）', s13a.status === 1 && s13a.f.length === 2 && s13a.f[0].line === s13a.f[1].line && s13a.f[0].message === 'BANNED 表第 1 词命中' && s13a.f[1].message === 'BANNED 表第 20 词命中', JSON.stringify(s13a.f))
    const m1 = String.fromCodePoint(0x4fee, 0x8ba2, 0x4e00), m2 = '\uFF08' + '2026-10-25 ' + String.fromCodePoint(0x7528, 0x6237, 0x88c1, 0x51b3)
    writeFileSync(join(tmp, 't13-02.md'), '# T13 规则二夹具\n\n样本一行：' + m1 + '\n样本二行：' + m2 + '\n', 'utf8')
    const s13b = subScan([join(tmp, 't13-02.md'), '--json'])
    add('L22 T13-02 规则二：两行分别命中模式一/二共 2 条 FAIL；检查器源码不含模式字面量', s13b.status === 1 && s13b.f.length === 2 && s13b.f[0].message === '规则二模式一命中' && s13b.f[1].message === '规则二模式二命中' && !selfSrc.includes(m1) && !selfSrc.includes(m2), JSON.stringify(s13b.f))
    const OFF_MARK = '<!-- term\x2dscan: off -->', ON_MARK = '<!-- term\x2dscan: on -->', w0 = actWords[0]
    writeFileSync(join(tmp, 't13-03.md'), ['# T13 豁免夹具', OFF_MARK, w0 + ' 整行 off 区段内不报', ON_MARK, w0 + ' ' + OFF_MARK + ' 行内标记不豁免', '```', w0 + ' 围栏内仍命中', '```', '## 历史小节', w0 + ' 历史小节仍命中', w0 + ' tb-ignore 行掩蔽 <!-- tb-ignore -->', OFF_MARK, w0 + ' 未闭合 off 区持续到文件尾', ''].join('\n'), 'utf8')
    const s13c = subScan([join(tmp, 't13-03.md'), '--json'])
    add('L22 T13-03 豁免状态机：整行 off 区段与 tb-ignore 行零报告；行内标记/围栏/历史小节命中；未闭合 off 区到文件尾不恢复（恰 3 条）', s13c.status === 1 && s13c.f.length === 3 && JSON.stringify(s13c.f.map((f) => f.line)) === JSON.stringify([5, 7, 10]) && s13c.f.every((f) => f.level === 'FAIL'), JSON.stringify(s13c.f))
    const rootA = join(tmp, 'vocab-a'), rootB = join(tmp, 'vocab-b')
    mkdirSync(join(rootA, 'scripts'), { recursive: true }); mkdirSync(join(rootB, 'scripts'), { recursive: true })
    writeFileSync(join(rootA, 'scripts', 'verify-docs.mjs'), vocabSrc(SYN_TOKENS), 'utf8')
    writeFileSync(join(rootB, 'scripts', 'verify-docs.mjs'), vocabSrc(SYN_TOKENS.slice(1).concat(SYN_TOKENS[0])), 'utf8')
    const badEnc = join(tmp, 'bad-enc'); mkdirSync(join(badEnc, 'scripts'), { recursive: true }); writeFileSync(join(badEnc, 'scripts', 'verify-docs.mjs'), Buffer.concat([Buffer.from(vocabSrc(SYN_TOKENS), 'utf8'), Buffer.from([0xff])])) // 合法 22 词声明＋尾随非法字节：非 fatal 即装载成功→向量红
    const tryLoad = (fn) => { try { fn(); return false } catch (e) { return e instanceof T13LoadError } }, t1304 = loadBannedVocab([tmp, tmp]) // 同一路径重复 roots 去重后仍单源
    add('L22 T13-04 装载器：活动 BANNED=22 与规则二=2；空数组/无源/多源歧义/规则二畸形/块注释同形假声明/23 个互异词/含重复 22 项/合法声明＋非法字节全抛装载异常；活动声明＋块注释假声明与数组内行注释（含闭括号）两正例均装载成功；字符串内注释起始对不误吞；重复 roots 去重通过',
      t1304.words.length === 22 && t1304.words[0] === SYN_TOKENS[0] && prodRule2.length === 2
      && tryLoad(() => extractBannedFromSource('const BANNED = [\n]')) && tryLoad(() => loadBannedVocab([join(tmp, 'empty-root')]))
      && tryLoad(() => loadBannedVocab([rootA, rootB]))
      && tryLoad(() => loadRule2Patterns("{ kind: 'rule2', no re here }\n{ kind: 'rule2', re: /b/g }"))
      && tryLoad(() => extractBannedFromSource('/*\n' + vocabSrc(SYN_TOKENS) + '*/\nconst OTHER = 1\n')) // 块注释假声明：不剥离即恰 22 词装载成功→向量红（双审 W-3）
      && extractBannedFromSource(vocabSrc(SYN_TOKENS) + '/*\n' + vocabSrc(SYN_TOKENS.slice(1).concat(SYN_TOKENS[0])) + '*/\n').length === 22 // 活动声明＋块注释同形假声明→装载成功：不剥离即 DECL=2 报错→向量红（ds N1①）
      && tryLoad(() => extractBannedFromSource(vocabSrc(SYN_TOKENS.concat('tk23')))) && tryLoad(() => extractBannedFromSource(vocabSrc([SYN_TOKENS[0], SYN_TOKENS[0]].concat(SYN_TOKENS.slice(1, 21))))) // 23 个互异词→词数断言／恰 22 项含重复→去重断言（双审 ds W-1，两分支独立触达）
      && tryLoad(() => loadBannedVocab([badEnc])) && extractBannedFromSource("const P = 'a/*b'\n" + vocabSrc(SYN_TOKENS)).length === 22 && extractBannedFromSource('const BANNED = [ \'' + SYN_TOKENS[0] + '\', // ]\n' + SYN_TOKENS.slice(1).map((t) => '\'' + t + '\',').join(' ') + ' ]\n').length === 22 // 非法 UTF-8 字节→装载错（ds W2 轮2）／字符串内注释起始对不误吞／数组内行注释（含闭括号）剥离生效才完整闭合（ds N1②）
      && (integWords === null || integWords.length === 22),
      JSON.stringify({ iso: t1304.words.length, rule2: prodRule2.length, integ: integWords ? integWords.length : 'isolated' }))
    const hitWords = actWords.filter((w) => selfSrc.includes(w)), hitR2 = prodRule2.filter((re) => selfSrc.includes(re.source))
    add('L22 T13-05 零复制：活动词表 22 词与规则二两 source 均未以字面量出现在检查器源码', actWords.length === 22 && hitWords.length === 0 && hitR2.length === 0, JSON.stringify({ hitWords, hitR2: hitR2.map((r) => r.source) }))
    const t14a = parseTaskbook('## 4. 事实台账\n\n| F-01 | 甲 | 乙 | 丙 | 丁 |\n')
    const z14a = checkFactShape(t14a, parseFactEntries(t14a)), z14b = checkFactShape(parseTaskbook('正文仅散文引用 F-01 编号。\n'), [])
    add('L22 T14-01 漏检：实名台账章表格形态漏网与无章全局补位各 1 条 WARN（行号=首个 F 字样行，不升格 FAIL）',
      z14a.length === 1 && z14a[0].level === 'WARN' && z14a[0].check === 'T14' && z14a[0].line === 3 && z14a[0].message.includes('机读 F 为 0') && z14b.length === 1 && z14b[0].level === 'WARN' && z14b[0].check === 'T14' && z14b[0].line === 1, JSON.stringify([z14a, z14b]))
    const t14c = parseTaskbook([
      'F-01 ｜ 基线甲 ｜ `echo 0` ｜ 0 ｜ 2026-10-25', 'F-02 ｜ 基线乙 ｜ `echo 1` ｜ 1 ｜ 2026-10-25', 'F-03 ｜ 基线丙 ｜ `echo 2` ｜ 2 ｜ 2026-10-25', 'F-04 ｜ 基线丁 ｜ `echo 3` ｜ 3 ｜ 2026-10-25',
      'E1 ｜ 判据 #5 ｜ 基线 0 ← F-01 ｜ 增量 +1 ｜ 期望 1 ｜ 算式 0 + 1 = 1', 'E-2 ｜ 判据 #6 ｜ 基线 1 ← F-02 ｜ 增量 +1 ｜ 期望 2 ｜ 算式 1 + 1 = 2',
      '- E3 ｜ 判据 #7 ｜ 基线 2 ← F-03 ｜ 增量 +1 ｜ 期望 3 ｜ 算式 2 + 1 = 3', '- E-4 ｜ 判据 #8 ｜ 基线 3 ← F-04 ｜ 增量 +1 ｜ 期望 4 ｜ 算式 3 + 1 = 4',
      '| 5 | `grep -c x a.md` | 1 | 证 |', '| 6 | `grep -c x a.md` | 1 | 证 |', '| 7 | `grep -c x a.md` | 1 | 证 |', '| 8 | `grep -c x a.md` | 1 | 证 |'].join('\n') + '\n')
    const e14c = parseExpectations(t14c), z14c = checkExpectations(e14c, parseNumericJudgeRows(t14c), parseFactEntries(t14c), null)
    add('L22 T14-02 E 兼容：四种形态全进 eRows 且 id=剥前缀行首形态，T9 finding=0', e14c.length === 4 && JSON.stringify(e14c.map((e) => e.id)) === JSON.stringify(['E1', 'E-2', 'E3', 'E-4']) && z14c.length === 0, JSON.stringify({ ids: e14c.map((e) => e.id), z: z14c }))
    const f14d = parseFactEntries(parseTaskbook('F-01 ｜ 命令保值 ｜ `grep -c \'\\|\' f.md` ｜ 5 ｜ 2026-10-25\n'))
    add('L22 T14-03 命令保值：恰 1 条 F、五字段位置不漂、命令字段仍含反斜杠与竖线两字符', f14d.length === 1 && f14d[0].id === 'F-01' && f14d[0].label === '命令保值' && f14d[0].declared === '5' && f14d[0].date === '2026-10-25' && f14d[0].cmd === "grep -c '\\|' f.md", JSON.stringify(f14d))
    const t14e = parseTaskbook('## 4. 事实台账\n\nF-01 ｜ 合法台账 ｜ `echo ok` ｜ 0 ｜ 2026-10-25\n')
    add('L22 T14-04 两负例：合法机读 F 在章与无章无字样均 0 条 T14，且原解析器仍可读取合法 F',
      checkFactShape(t14e, parseFactEntries(t14e)).length === 0 && parseFactEntries(t14e).length === 1 && checkFactShape(parseTaskbook('普通正文，无任何编号字样。\n'), []).length === 0)

    // ── W6 R2-T1 D-3：T16～T20 语义 lint 向量（正反样 /tmp 合成；十件 R1 fixture 不变） ──
    const T16P = '白名单机制以「单源=references/02 §4」指针承载\n'
    const T16N = '白名单机制是指白名单与禁改面的交集机制\n'
    add('D3 T16 正例：单源指针形态不报', checkTermRedefinition(parseTaskbook(T16P)).length === 0)
    const t16red = checkTermRedefinition(parseTaskbook(T16N))
    add('D3 T16 反例：本地定义判 FAIL 恰 1 条', t16red.length === 1 && t16red[0].check === 'T16', JSON.stringify(t16red))
    add('D3 T16 围栏豁免：围栏内定义不报', checkTermRedefinition(parseTaskbook('```\n' + T16N + '```\n')).length === 0)
    add('D3 T16 源文引用区豁免：引用区定义不报', checkTermRedefinition(parseTaskbook('## 2. 源文引用区\n\n' + T16N)).length === 0)
    const T17P = '| D-1 探针 | 必须具 D↔V 双锚 | V-1 |'
    const T17N = '| D-1 探针 | 必须正确 | V-1 |'
    add('D3 T17 正例：断言具 D↔V 对象词不报', checkAssertionObjects(parseTaskbook(T17P)).length === 0, JSON.stringify(checkAssertionObjects(parseTaskbook(T17P))))
    const t17red = checkAssertionObjects(parseTaskbook(T17N))
    add('D3 T17 反例：断言缺对象词判 FAIL 恰 1 条', t17red.length === 1 && t17red[0].check === 'T17', JSON.stringify(t17red))
    add('D3 T17 ASSERT 行：含对象词不报／缺对象词报',
      checkAssertionObjects(parseTaskbook('ASSERT: 提交前须全绿\n')).length === 0 && checkAssertionObjects(parseTaskbook('ASSERT: 必须全绿\n')).length === 1,
      JSON.stringify(checkAssertionObjects(parseTaskbook('ASSERT: 必须全绿\n'))))
    // W5b R2-T2 D-6（W-18 裁定）：T17 模态正则「门禁」词形对抗恰 2 条（107→109）。
    const t17menjin = '| D-1 探针 | 门禁常开 | V-1 |'
    add('D6 T17 对抗 1：含「门禁」无对象词的 D 行=不触发（名词门禁的禁不作模态·负向断言排除；禁止语义 禁改/禁推/禁止/严禁 保持命中）',
      checkAssertionObjects(parseTaskbook(t17menjin)).length === 0, JSON.stringify(checkAssertionObjects(parseTaskbook(t17menjin))))
    const t17jgai = '| D-1 探针 | 禁改落实 | V-1 |'
    const t17jgaiHits = checkAssertionObjects(parseTaskbook(t17jgai))
    add('D6 T17 对抗 2：含「禁改」无对象词的 D 行=仍触发（禁止语义保持命中·防排除过宽）',
      t17jgaiHits.length === 1 && t17jgaiHits[0].check === 'T17', JSON.stringify(t17jgaiHits))
    const T18ROW = '| D-1 探针 | 规范锚=`docs/note.md:2「line two」` | V-1 |'
    const t18ok = checkDualAnchors(parseTaskbook('### V-1 探针（D-1）\n\n' + T18ROW + '\n'))
    add('D3 T18 正例：D 具规范锚＋V 映射、V 具 D 回锚不报', t18ok.length === 0, JSON.stringify(t18ok))
    const t18noCite = checkDualAnchors(parseTaskbook(T18ROW.replace('规范锚=`docs/note.md:2「line two」`', '规范锚待补')))
    add('D3 T18 反例 1：D 缺规范锚判 FAIL', t18noCite.length === 1 && t18noCite[0].check === 'T18' && t18noCite[0].message.includes('规范锚'), JSON.stringify(t18noCite))
    const t18noV = checkDualAnchors(parseTaskbook(T18ROW.replace('| V-1 |', '待映射 |')))
    add('D3 T18 反例 2：D 缺 V 映射判 FAIL', t18noV.length === 1 && t18noV[0].message.includes('V 映射'), JSON.stringify(t18noV))
    const t18vHead = checkDualAnchors(parseTaskbook('### V-1 探针\n\n' + T18ROW + '\n'))
    add('D3 T18 反例 3：V 标题缺 D 回锚判 FAIL', t18vHead.length === 1 && t18vHead[0].message.includes('D 回锚'), JSON.stringify(t18vHead))
    const T19OK = '### V-1 探针（D-1）\n\n| D-1 探针 | 规范锚=`docs/note.md:2「line two」` | V-1 |\n'
    add('D3 T19 正例：闭合映射 0 findings', checkDVGraph(parseTaskbook(T19OK)).length === 0, JSON.stringify(checkDVGraph(parseTaskbook(T19OK))))
    const t19dup = checkDVGraph(parseTaskbook(T19OK + '| D-1 探针 | 规范锚=`docs/note.md:2「line two」` | V-1 |\n'))
    add('D3 T19 反例 1：D id 重复声明判 FAIL', t19dup.some((f) => f.check === 'T19' && f.message.includes('D id 重复声明')), JSON.stringify(t19dup))
    const t19dangling = checkDVGraph(parseTaskbook('### V-1 探针（D-1）\n\n| D-1 探针 | 规范锚=`docs/note.md:2「line two」` | V-1、V-9 |\n'))
    add('D3 T19 反例 2：D→V 悬空引用判 FAIL', t19dangling.length === 1 && t19dangling[0].message.includes('悬空引用'), JSON.stringify(t19dangling))
    const t19dangV = checkDVGraph(parseTaskbook('### V-1 探针（D-1、D-9）\n\n| D-1 探针 | 规范锚=`docs/note.md:2「line two」` | V-1 |\n'))
    add('D3 T19 反例 3：V→D 悬空引用判 FAIL', t19dangV.length === 1 && t19dangV[0].message.includes('D-9'), JSON.stringify(t19dangV))
    const t19extra = checkDVGraph(parseTaskbook('### V-1 探针（D-1）\n\n### V-2 附加（D-1）\n\n| D-1 探针 | 规范锚=`docs/note.md:2「line two」` | V-1 |\n'))
    add('D3 T19 反例 4：V→D 边无 D→V 回边（边不互认）判 FAIL', t19extra.length === 1 && t19extra[0].message.includes('边不互认'), JSON.stringify(t19extra))
    add('D3 T20 正例：§4 具逐字映射不报', checkAmendMapping(parseTaskbook('## 4. 纪律\n\n- 每轮呈 finding→定点 diff→机检/探针映射\n')).length === 0)
    const t20miss = checkAmendMapping(parseTaskbook('## 4. 纪律\n\n- finding、定点 diff 与映射逐轮留痕\n'))
    add('D3 T20 反例 1：近义句判 FAIL', t20miss.length === 1 && t20miss[0].check === 'T20', JSON.stringify(t20miss))
    const t20elsewhere = checkAmendMapping(parseTaskbook('## 6. 报告契约\n\n- 报告含 finding→定点 diff→机检/探针映射\n'))
    add('D3 T20 反例 2：无纪律段判 FAIL（仅他段提及不算）', t20elsewhere.length === 1 && t20elsewhere[0].message.includes('纪律段'), JSON.stringify(t20elsewhere))
    const t20fence = checkAmendMapping(parseTaskbook('## 4. 纪律\n\n```\nfinding→定点 diff→机检/探针映射\n```\n'))
    add('D3 T20 反例 3：字面在逐字块内不算', t20fence.length === 1 && t20fence[0].message.includes('缺逐字'), JSON.stringify(t20fence))
    // 双审修入向量（W-2/W-13/W-1·N-3/W-2席一/W-3·W-8/N-2）
    const stdForm = [
      '## 3.1 目标、批型与双锚', '',
      '| D 项 | 规范锚 | 验收锚 |', '|---|---|---|',
      '| D-1 探针与夹具 | 规范面 §5.3 | V-1、V-2 |',
      '| D-2 生成器 | 规范面 §5.3 | V-3 |', '',
      '## 3.4 D 项', '',
      '- **D-1 探针与夹具（V-1、V-2）**：规范锚=`docs/note.md:2「line two target-fragment」`。要求 fixture 全绿。',
      '- **D-2 生成器（V-3）**：规范锚=`docs/note.md:3「line three」`。生成确定性。', '',
      '### V-1 探针（D-1）', '', '### V-2 夹具（D-1）', '', '### V-3 生成器（D-2）', '',
      '## 4. 纪律', '', '- 每轮呈 finding→定点 diff→机检/探针映射', '',
    ].join('\n')
    const zStd = checkSemanticLint(parseTaskbook(stdForm))
    add('D3 A1 标准形态正例：§3.1 汇总表＋§3.4 带锚明细→语义 findings=0（D 行按 id 去重优先带锚行）', zStd.length === 0, JSON.stringify(zStd))
    const a2noV18 = checkDualAnchors(parseTaskbook('### V-1 探针（D-1）\n\n| D-1 探针 | 规范锚=`docs/note.md:2「line two」` | 待映射 |\n'))
    const a2noV19 = checkDVGraph(parseTaskbook('### V-1 探针（D-1）\n\n| D-1 探针 | 规范锚=`docs/note.md:2「line two」` | 待映射 |\n'))
    add('D3 A2 负例 1：D 缺 V 回引归 T18（存在性锚·规格 :136）且 T19 零 finding', a2noV18.length === 1 && a2noV18[0].message.includes('V 映射') && a2noV19.length === 0, JSON.stringify([a2noV18, a2noV19]))
    const a2cross = checkDVGraph(parseTaskbook('### V-1 探针（D-2）\n\n### V-2 附加（D-1）\n\n| D-1 探针 | 规范锚=`docs/note.md:2「line two」` | V-1 |\n| D-2 生成 | 规范锚=`docs/note.md:3「line three」` | V-2 |\n'))
    add('D3 A2 负例 2：D→V 与 V→D 边不互认（交叉错配无悬空 id）判 T19', a2cross.length >= 1 && a2cross.every((f) => f.check === 'T19' && f.message.includes('边不互认')), JSON.stringify(a2cross))
    const t18empty = checkDualAnchors(parseTaskbook('### V-1 探针（D-1）\n\n| D-1 探针 | 规范锚=`docs/note.md:2「」` | V-1 |\n'))
    add('D3 A4 反例 1：规范锚空片段判 FAIL', t18empty.length === 1 && t18empty[0].message.includes('规范锚'), JSON.stringify(t18empty))
    const t18nopath = checkDualAnchors(parseTaskbook('### V-1 探针（D-1）\n\n| D-1 探针 | 规范锚=`附注:2「锚行原文」` | V-1 |\n'))
    add('D3 A4 反例 2：规范锚非文件路径（无扩展名）判 FAIL', t18nopath.length === 1 && t18nopath[0].message.includes('规范锚'), JSON.stringify(t18nopath))
    const t16keji = checkTermRedefinition(parseTaskbook('白名单机制即可通过单源指针承载\n'))
    add('D3 A5 正例：非定义「即可」不报', t16keji.length === 0, JSON.stringify(t16keji))
    const t16comma = checkTermRedefinition(parseTaskbook('白名单机制，是指白名单与禁改面的交集机制\n'))
    add('D3 A5 反例：「，是指」前导逗号判 FAIL', t16comma.length === 1 && t16comma[0].check === 'T16', JSON.stringify(t16comma))
    const w16pos = checkTermRedefinition(parseTaskbook('所有 B/W 修入后由原审复核对应 diff，N=2 触发即停。\n'))
    add('W-16 正例：「N=2 触发即停」副词用法不报（含 M8 误伤样本原文）', w16pos.length === 0, JSON.stringify(w16pos))
    const w16neg = checkTermRedefinition(parseTaskbook('N=2 即连续两个不收敛修入轮的停止条件\n'))
    add('W-16 反例：「N=2 即<定义内容>」判 FAIL 恰 1 条', w16neg.length === 1 && w16neg[0].check === 'T16', JSON.stringify(w16neg))
    // CLI 集成：全绿正例＋五种单缺陷变异＋缺省不启用
    const semPos = [
      '# 自检语义正例（T16～T20 全绿夹具）', '',
      '## 1. 身份与禁令', '', '- 领单号=自检', '',
      '## 2. 必读序', '', '1. 本任务书全文', '',
      '## 3. 预裁决', '', '- 术语以单源=references/02 §4 指针承载', '',
      '## 3.2 白名单', '', '| `scripts/present.mjs` | 修改 |', '',
      '## 4. 纪律', '', '- 逐单元 TDD', '- 每轮呈 finding→定点 diff→机检/探针映射', '',
      '## 5. 基线数字', '', '- 无', '',
      '## 6. 报告契约', '', '- 全文落审计档', '',
      '## 7. 运行时可观察性', '', '- findings 集合可机读', '',
      '### V-1 探针（D-1）', '', '- ASSERT: 提交前须全绿', '',
      '| D-1 探针 | 规范锚=`docs/note.md:2「line two target-fragment」` | V-1 |', '',
      '## 验收命令', '', '```bash', 'echo "exit=$?"', '```', '',
    ].join('\n')
    const semPosPath = join(tmp, 'sem-pos.md')
    writeFileSync(semPosPath, semPos + '\n', 'utf8')
    const rSemPos = spawnSync(process.execPath, [SELF, semPosPath, '--semantic-lint', '--strict', '--json', '--root', tmp], { encoding: 'utf8' })
    let semPosJson = null
    try { semPosJson = JSON.parse(rSemPos.stdout) } catch {}
    add('D3 CLI 正例：--semantic-lint --strict exit 0 且 T16～T20 为零',
      rSemPos.status === 0 && semPosJson && semPosJson.findings.every((f) => !/^T1[6-9]$|^T20$/.test(f.check)),
      `status=${rSemPos.status} out=${rSemPos.stdout.slice(0, 240)}`)
    const semCases = [
      ['T16', (s) => s.replace('- 术语以单源=references/02 §4 指针承载', '- 术语以单源=references/02 §4 指针承载\n- 白名单机制是指白名单与禁改面的交集')],
      ['T17', (s) => s.replace('| D-1 探针 | 规范锚=`docs/note.md:2「line two target-fragment」` | V-1 |', '| D-1 探针 | 规范锚=`docs/note.md:2「line two target-fragment」` 必须正确 | V-1 |')],
      ['T18', (s) => s.replace('规范锚=`docs/note.md:2「line two target-fragment」`', '规范锚待补')],
      ['T19', (s) => s.replace('| V-1 |', '| V-1、V-9 |')],
      ['T20', (s) => s.replace('- 每轮呈 finding→定点 diff→机检/探针映射', '- 修入映射逐轮留痕')],
    ]
    for (const [id, fn] of semCases) {
      const p = join(tmp, `sem-${id}.md`)
      writeFileSync(p, fn(semPos) + '\n', 'utf8')
      const r = spawnSync(process.execPath, [SELF, p, '--semantic-lint', '--strict', '--json', '--root', tmp], { encoding: 'utf8' })
      let j = null
      try { j = JSON.parse(r.stdout) } catch {}
      const semIds = (j?.findings || []).filter((f) => /^T1[6-9]$|^T20$/.test(f.check)).map((f) => f.check)
      add(`D3 CLI 变异 ${id}：exit 1 且语义 id 恰为 [${id}]`, r.status === 1 && JSON.stringify(semIds) === JSON.stringify([id]), `status=${r.status} ids=${JSON.stringify(semIds)}`)
    }
    let offOk = true; const offIds = {}
    for (const [id, fn] of semCases) {
      const p = join(tmp, `sem-off-${id}.md`)
      writeFileSync(p, fn(semPos) + '\n', 'utf8')
      const rOff = spawnSync(process.execPath, [SELF, p, '--strict', '--json', '--root', tmp], { encoding: 'utf8' })
      let jOff = null
      try { jOff = JSON.parse(rOff.stdout) } catch {}
      offIds[id] = (jOff?.findings || []).filter((f) => /^T1[6-9]$|^T20$/.test(f.check)).length
      if (rOff.status !== 0 || offIds[id] !== 0) offOk = false
    }
    add('D3 缺省不启用：五件语义变异全部无旗标运行均无 T16～T20 findings 且 exit 0', offOk, JSON.stringify(offIds))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  const pass = cases.filter((c) => c.ok).length
  const fail = cases.length - pass
  return { cases, pass, fail }
}

// ── 主入口（只做 IO 与汇总） ──
function usage() {
  console.error('用法：node scripts/check-taskbook.mjs <任务书.md> [--root <dir>]... [--evidence <证据.json>] [--semantic-lint] [--json] [--strict] [--self-test]')
}

function expandRoot(v) {
  return v.startsWith('~/') ? resolve(homedir(), v.slice(2)) : resolve(v)
}

function main() {
  const argv = process.argv.slice(2)
  const flags = { json: false, strict: false, selfTest: false, semanticLint: false }
  const extraRoots = []
  let taskbook = null
  let evidencePath = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') flags.json = true
    else if (a === '--strict') flags.strict = true
    else if (a === '--self-test') flags.selfTest = true
    else if (a === '--semantic-lint') flags.semanticLint = true
    else if (a === '--root') {
      const v = argv[++i]
      if (!v) { usage(); process.exit(1) }
      extraRoots.push(expandRoot(v))
    } else if (a === '--evidence') {
      const v = argv[++i]
      if (!v) { usage(); process.exit(1) }
      evidencePath = expandRoot(v)
    } else if (a.startsWith('--')) { usage(); process.exit(1) }
    else if (taskbook === null) taskbook = a
    else { usage(); process.exit(1) }
  }

  if (flags.selfTest) {
    const { cases, pass, fail } = selfTest(extraRoots)
    if (flags.json) {
      process.stdout.write(JSON.stringify({ selfTest: true, pass, fail, cases }, null, 2) + '\n')
    } else {
      for (const c of cases) if (!c.ok) console.log(`[self-test] FAIL ${c.name}${c.detail ? `（${c.detail}）` : ''}`)
      if (fail === 0) console.log(`self-test 全过（${cases.length} 向量）`)
      else console.log(`[self-test] FAIL ×${fail}`)
    }
    process.exit(fail === 0 ? 0 : 1)
  }

  if (!taskbook) { usage(); process.exit(1) }
  if (!existsSync(taskbook)) {
    console.error(`[装载错] 任务书不存在：${taskbook}`)
    process.exit(3)
  }

  let text
  try { text = readFileSync(taskbook, 'utf8') }
  catch (e) { console.error(`[装载错] 任务书读取失败：${taskbook}（${e.message}）`); process.exit(3) }

  const roots = [SKILL_ROOT, ...extraRoots]
  // r1：先按物理行做 tb-ignore 掩蔽（行号不变），所有检查面统一基于掩蔽后的文本。
  const rawParsed = parseTaskbook(text)
  const { lines: activeLines, ignored } = maskIgnoredLines(rawParsed.lines)
  const parsed = parseTaskbook(activeLines.join('\n'))
  const fenced = fencedLines(parsed.blocks)
  const reader = makeReader(roots)
  const findings = []
  let skipped = ignored

  // T1 路径存在性（跳过围栏代码块内部——其中命令由 T4 负责）
  for (let i = 0; i < parsed.lines.length; i++) {
    if (fenced.has(i + 1)) continue
    for (const v of findPathTokens(parsed.lines[i])) {
      if (!reader(v).exists) findings.push({ level: 'WARN', check: 'T1', line: i + 1, message: `路径不存在 \`${v}\`` })
    }
    skipped += findSkippedPathTokens(parsed.lines[i]).length
  }
  // T2 / T2b
  findings.push(...checkCitations(extractCitationTokens(parsed.lines), reader))
  // T2c（W5b D-5）：畸形 span 显式化——未闭合/候选未成 span/空片段（围栏外），在 T2/T2b 后汇总
  findings.push(...checkSpanIntegrity(parsed.lines, fenced))
  // T3
  findings.push(...checkWhitelistConflict(parsed))
  // T4
  findings.push(...checkCommandScripts(parsed.lines, roots))
  // T5
  const z = checkZeroHit(parsed.lines, parsed.blocks)
  findings.push(...z.findings)
  skipped += z.skipped
  // T6
  const scriptNames = readdirSync(SCRIPT_DIR).filter((f) => f.endsWith('.mjs'))
  findings.push(...checkExitContract(parsed.lines, parsed.blocks, scriptNames))
  // T0
  findings.push(...checkStructure(parsed))
  // T9 期望值算术 / T12 证据一致性（L10）
  const factEntries = parseFactEntries(parsed)
  const eRows = parseExpectations(parsed)
  const numericRows = parseNumericJudgeRows(parsed)
  findings.push(...checkExpectations(eRows, numericRows, factEntries, null))
  const ev = verifyEvidence(factEntries, evidencePath)
  findings.push(...ev.findings)
  // T15 机检命令转义管道 lint（R-Y5-2①）：F 条目命令域 grep -E/-P 含 \| 即 FAIL。
  findings.push(...checkEscapePipe(factEntries))
  // T13 词面扫描（L22）：词表单源跨仓读＋规则二文本提取，命中即 FAIL；装载失败统一 [装载错] 退 3（06 §5.8 行 3 词表缺失类）——不降级、不静默空扫、不用替代词表。
  let t13Words, t13Rule2
  try {
    t13Words = loadBannedVocab(roots).words
    t13Rule2 = loadRule2Patterns()
  } catch (e) { if (e instanceof T13LoadError) { console.error(`[装载错] T13 ${e.message}`); process.exit(3) } throw e }
  findings.push(...scanTermLines(parsed.lines, t13Words, t13Rule2))
  findings.push(...checkFactShape(parsed, factEntries)) // T14 事实台账形态漏检（L22）：默认仅 WARN，--strict 使其退 1；不把表格形态收编为合法 F。
  // T16～T20 语义 lint（W6 R2-T1 D-3）：仅 --semantic-lint 启用；缺省零改动既有检查面。
  if (flags.semanticLint) findings.push(...checkSemanticLint(parsed))

  const warn = findings.filter((f) => f.level === 'WARN').length
  const fail = findings.filter((f) => f.level === 'FAIL').length

  if (flags.json) {
    process.stdout.write(JSON.stringify({ taskbook, findings, summary: { warn, fail, skipped, parsedExpectations: eRows.length, numericRows: numericRows.length, evidenceEntries: ev.entries.length } }, null, 2) + '\n')
  } else {
    for (const f of findings) {
      if (f.check === 'T0') console.log(`[${f.level}] ${f.message}`)
      else console.log(`[${f.level}] ${taskbook}:${f.line} ${f.message}`)
    }
    console.log(`check-taskbook 汇总：WARN ×${warn} / FAIL ×${fail}（任务书=${taskbook}；跳过路径 ×${skipped}）`)
  }
  process.exit(fail > 0 || (flags.strict && warn > 0) ? 1 : 0)
}

// 仅在直接执行时进入主流程，便于测试/复核导入纯函数。
if (process.argv[1] && resolve(process.argv[1]) === SELF) main()
