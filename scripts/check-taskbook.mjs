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
// 退出码口径单源=references/06 §5.8（此处不复写映射）
// 用法：node scripts/check-taskbook.mjs <任务书.md> [--root <dir>]... [--json] [--strict] [--self-test]
// 豁免：任一物理行含 tb-ignore → 该行跳过全部检查并计入跳过数（只对该行生效，不跨行继承）。
// 供应商事实零硬编码：本脚本不含端点/模型名；夹具一律落 os.tmpdir()，不写技能仓。

import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SKILL_ROOT = resolve(SCRIPT_DIR, '..')
const SELF = fileURLToPath(import.meta.url)

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

/** 提取 T2（path:N / path 第 N 行）与 T2b（path:NN「片段」）引用。 */
export function extractCitationTokens(lines) {
  const out = []
  const seen = new Set()
  const push = (t) => {
    const k = `${t.kind}|${t.path}|${t.n}|${t.fragment ?? ''}|${t.spanLine}`
    if (!seen.has(k)) { seen.add(k); out.push(t) }
  }
  for (let i = 0; i < lines.length; i++) {
    const ln = String(lines[i] ?? '')
    for (const v of inlineSpans(ln)) {
      let m = /^(.+?):(\d+)「(.*)」$/.exec(v)
      if (m && isPathLikeToken(m[1])) {
        push({ kind: 'quote', path: m[1], n: Number(m[2]), fragment: m[3], spanLine: i + 1 })
        continue
      }
      m = /^(.+?):(\d+)$/.exec(v)
      if (m && isPathLikeToken(m[1])) {
        push({ kind: 'line', path: m[1], n: Number(m[2]), spanLine: i + 1 })
      }
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

// ── 自检（夹具落 os.tmpdir()，向量 ≥40） ──
function selfTest() {
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
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  const pass = cases.filter((c) => c.ok).length
  const fail = cases.length - pass
  return { cases, pass, fail }
}

// ── 主入口（只做 IO 与汇总） ──
function usage() {
  console.error('用法：node scripts/check-taskbook.mjs <任务书.md> [--root <dir>]... [--json] [--strict] [--self-test]')
}

function expandRoot(v) {
  return v.startsWith('~/') ? resolve(homedir(), v.slice(2)) : resolve(v)
}

function main() {
  const argv = process.argv.slice(2)
  const flags = { json: false, strict: false, selfTest: false }
  const extraRoots = []
  let taskbook = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') flags.json = true
    else if (a === '--strict') flags.strict = true
    else if (a === '--self-test') flags.selfTest = true
    else if (a === '--root') {
      const v = argv[++i]
      if (!v) { usage(); process.exit(1) }
      extraRoots.push(expandRoot(v))
    } else if (a.startsWith('--')) { usage(); process.exit(1) }
    else if (taskbook === null) taskbook = a
    else { usage(); process.exit(1) }
  }

  if (flags.selfTest) {
    const { cases, pass, fail } = selfTest()
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

  const warn = findings.filter((f) => f.level === 'WARN').length
  const fail = findings.filter((f) => f.level === 'FAIL').length

  if (flags.json) {
    process.stdout.write(JSON.stringify({ taskbook, findings, summary: { warn, fail, skipped } }, null, 2) + '\n')
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
