#!/usr/bin/env node
// check-terms.mjs — 词表执法器（Y1 批建面；B3 批 b2_terms_v2 改造＝多根 terms_scan＋
// active/historical/both 三面＋JS/shell/JSON 启发式 lexer＋双基线棘轮）：
// - off（b2_terms_v2 非 on，缺省）：legacy 路径——原扫描面/输出/退出逐字节保留；
//   hook 的 --strict --surface both 同走 legacy；--update 拒用（防写回丢 historical）。
// - on：读 org-config.default.json 顶层 terms_scan（五键固定）执行新面：
//   active 任一命中即红（严格零命中）；historical 对 scripts/.golden/terms-baseline.json
//   的 historical 分区做只降不升棘轮（首冻=--update --surface historical，禁手编）。
// 词表=docs/07 §2.1 23 词＋campaign §7.1 扩展 10 词（「座」两源合一，23+10-1=32）＋
// 规则二（正文裁决史括注 lint）；词表以本脚本数组字面量为唯一实现载体，两源表为规格源。
// 本文件仅两段受控豁免（词表声明区＋selfTest 夹具区，见 D-9），生产代码/文案不得借标记藏词。
// 用法：node scripts/check-terms.mjs [--strict] [--json] [--update] [--self-test]
//                  [--root <dir>] [--surface active|historical|both] [--project <dir>]
// 退出码口径单源=references/06 §5.8（此处不复写映射）。
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync, mkdtempSync, statSync, chmodSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { SKILL_ROOT, cliFlag, UsageError, localDateStr, loadOrgConfig, resolveFlagValue, flagsStatePath } from './org-config.mjs'
// R2：ledger-migrate 移除顶层静态依赖——resolveProjectRoot 仅在 on＋选中 project 历史规则时动态导入

// ── 词表（唯一实现载体；plain=子串包含/combo=显式正则/rule2=裁决史括注两模式）──
// （下方至 on 标记=词表声明区，本脚本仅有的两段受控豁免之一——D-9：最小两行区间，
// 豁免只护词表字面量与自检夹具，生产代码与文案不得借此隐藏禁用词。）
// term-scan: off
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
// term-scan: on
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

// ═══ B3 新面（b2_terms_v2=on）：配置化 terms_scan＋三面＋启发式 lexer＋双基线 ═══
// 口径指针：退出码=references/06 §5.8；surface/selector/lexer 语义=任务书 B3 D-2/D-5/D-6/D-7/D-8。
const LEXERS = ['markdown', 'javascript', 'shell', 'json', 'jsonl', 'plain']
const SELECTORS = ['active-text', 'history-sections', 'term-scan-off']
const MARKER_TEXT_OFF = 'term-scan: off'
const MARKER_TEXT_ON = 'term-scan: on'
const LEGACY_NOTE = 'check-terms 棘轮基线：file→term→命中行计数——--update 冻结禁手改（D22 生成物豁免）；清理批完成后重冻随批提交（docs/07 §5）'

/** glob→正则（D-2：仅 `*` 段内匹配与 `**` 跨段匹配，零依赖）。 */
export function globToRe(glob) {
  const segs = String(glob).split('/')
  let re = '^'
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const last = i === segs.length - 1
    if (s === '**') re += last ? '(?:[^/]+(?:/[^/]+)*)?' : '(?:[^/]+/)*'
    else re += s.replace(/[.+^${}()|[\]\\*]/g, (c) => (c === '*' ? '[^/]*' : '\\' + c))
    if (!last) re += '/'
  }
  return new RegExp(re + '$')
}

/** terms_scan 配置校验（D-2/D-14：缺段/形态错=装载失败族，调用方承接退出）。返回错误串数组。 */
export function validateTermsScan(ts) {
  const errs = []
  if (!ts || typeof ts !== 'object' || Array.isArray(ts)) return ['terms_scan 缺段或非对象——on 态新执法面必需（org-config.default.json 顶层五键）']
  for (const k of ['baseline', 'suffix_lexer', 'exclude', 'active', 'historical']) if (!(k in ts)) errs.push(`terms_scan.${k} 缺键（五键固定：baseline/suffix_lexer/exclude/active/historical）`)
  if (errs.length) return errs
  if (typeof ts.baseline !== 'string' || !ts.baseline.trim()) errs.push('terms_scan.baseline 须为相对技能工作根的路径字符串')
  else if (/^([/\\]|[A-Za-z]:)/.test(ts.baseline)) errs.push('terms_scan.baseline 禁绝对路径（相对技能工作根解析）')
  if (!ts.suffix_lexer || typeof ts.suffix_lexer !== 'object' || Array.isArray(ts.suffix_lexer)) errs.push('terms_scan.suffix_lexer 须为后缀→lexer 映射对象')
  else for (const [sfx, lx] of Object.entries(ts.suffix_lexer)) {
    if (!/^\.[^/]+$/.test(sfx)) errs.push(`terms_scan.suffix_lexer 键「${sfx}」须为点起始且无斜杠的后缀（空串/无点=配置错——R9）`)
    if (!LEXERS.includes(lx)) errs.push(`terms_scan.suffix_lexer.${sfx}=${lx} 非法——合法：${LEXERS.join('/')}`)
  }
  if (!Array.isArray(ts.exclude)) errs.push('terms_scan.exclude 须为 glob 数组')
  else if (!ts.exclude.every((g) => typeof g === 'string' && g)) errs.push('terms_scan.exclude 元素须非空字符串（空串/非字符串=配置错——R9）')
  for (const sf of ['active', 'historical']) {
    if (!Array.isArray(ts[sf])) { errs.push(`terms_scan.${sf} 须为规则数组`); continue }
    ts[sf].forEach((r, i) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) { errs.push(`terms_scan.${sf}[${i}] 须为规则对象`); return }
      if (!['skill', 'project'].includes(r.root)) errs.push(`terms_scan.${sf}[${i}].root 须为 skill|project`)
      if (sf === 'active' && r.root === 'project') errs.push(`terms_scan.${sf}[${i}] active 规则 root 须为 skill（项目根解析器仅历史面装载）`)
      if (!Array.isArray(r.include) || !r.include.length || !r.include.every((g) => typeof g === 'string' && g)) errs.push(`terms_scan.${sf}[${i}].include 须为非空 glob 字符串数组`)
      if (r.lexer !== undefined && !LEXERS.includes(r.lexer)) errs.push(`terms_scan.${sf}[${i}].lexer=${r.lexer} 非法——合法：${LEXERS.join('/')}`)
      if (r.selector !== undefined) {
        if (!SELECTORS.includes(r.selector)) errs.push(`terms_scan.${sf}[${i}].selector=${r.selector} 非法——闭集：${SELECTORS.join('/')}`)
        if (sf === 'active') errs.push(`terms_scan.${sf}[${i}] active 规则不得携带 selector（active 固定 active-text 语义）`)
      }
      if (sf === 'historical' && r.root === 'skill' && Array.isArray(r.include) && r.include.some((g) => String(g).startsWith('references/')) && r.selector === undefined)
        errs.push(`terms_scan.${sf}[${i}] skill references 历史规则须显式 selector（history-sections|term-scan-off），不得整件纳入`)
    })
  }
  return errs
}

// ── 文本单元（D-6）：{ line, text, kind, solo }——kind: text|comment|heading|fence；
// solo=注释独占整行（唯一可作 off/on 开关的形态；字符串值里的标记字样不切换状态）。──
const splitLines = (text) => text.replace(/\r\n/g, '\n').split('\n')

/** Markdown 行级抽取：围栏开关行与围栏内不产可扫单元；整行 HTML 注释=独立注释单元；标题行保层级。 */
function lexMarkdown(text) {
  const units = []
  let fence = false
  splitLines(text).forEach((line, idx) => {
    const ln = idx + 1
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; units.push({ line: ln, text: '', kind: 'fence', solo: false }); return }
    if (fence) return
    const hcm = line.match(/^\s*<!--\s*(.*?)\s*-->\s*$/)
    if (hcm) { units.push({ line: ln, text: hcm[1], kind: 'comment', solo: true }); return }
    const h = line.match(/^(#+)\s*(.*)$/)
    if (h) { units.push({ line: ln, text: line, kind: 'heading', solo: false, level: h[1].length, title: h[2] }); return }
    units.push({ line: ln, text: line, kind: 'text', solo: false })
  })
  return units
}

/** plain 行级抽取（HTML 等历史面按 plain 处理——D-8，不新增解析器）。 */
function lexPlain(text) {
  return splitLines(text).map((line, idx) => ({ line: idx + 1, text: line, kind: 'text', solo: false }))
}

/** JS 启发式 lexer（D-7）：// 与块注释、单双引号串、模板串原文（${} 内递归）；
 *  正则字面量按前一有效 token 启发式判定、体不作字符串扫描；`#` 非注释；
 *  未闭合串/模板/正则告警并自安全换行点继续。多行片段按物理行拆为独立单元。 */
function lexJavaScript(text, warns, rel) {
  const units = []
  const src = text.replace(/\r\n/g, '\n')
  const n = src.length
  const isWS = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v'
  const wsOnly = (a, b) => { for (let k = a; k < b; k++) if (!isWS(src[k]) && src[k] !== '\n') return false; return true }
  const REGEX_PREV_OK = new Set(['', '(', '{', '}', '[', ';', ',', '=', ':', '!', '?', '&', '|', '+', '-', '*', '%', '<', '>', '~', '^', '=>', '&&', '||', '??', '...'])
  const REGEX_KEYWORDS = new Set(['return', 'case', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await', 'throw'])
  let i = 0, line = 1, ls = 0, prev = ''
  const emitText = (startLine, seg) => {
    String(seg).split('\n').forEach((p, k) => { if (p) units.push({ line: startLine + k, text: p, kind: 'text', solo: false }) })
  }
  const regexAllowed = () => prev === '' || REGEX_KEYWORDS.has(prev) || REGEX_PREV_OK.has(prev)
  // 代码态扫描；stopBrace=true 时在配对「}」处消费并返回（模板 ${…} 递归用）。
  const scanCode = (stopBrace) => {
    let depth = 0
    while (i < n) {
      const ch = src[i]
      if (ch === '\n') { i++; line++; ls = i; continue }
      if (isWS(ch)) { i++; continue }
      if (stopBrace && ch === '}' && depth === 0) { i++; prev = '}'; return 'brace' }
      // 行注释
      if (ch === '/' && src[i + 1] === '/') {
        const startLine = line
        let j = src.indexOf('\n', i)
        if (j === -1) j = n
        const solo = wsOnly(ls, i)
        if (j > i + 2) units.push({ line: startLine, text: src.slice(i + 2, j), kind: 'comment', solo })
        prev = ''
        i = j
        continue
      }
      // 块注释
      if (ch === '/' && src[i + 1] === '*') {
        const startLine = line
        const j = src.indexOf('*/', i + 2)
        if (j === -1) {
          warns.push({ file: rel, msg: `行 ${startLine} 未闭合的块注释——按注释延续至文件尾` })
          let k = startLine
          for (const p of src.slice(i + 2).split('\n')) { if (p) units.push({ line: k, text: p, kind: 'comment', solo: k === startLine && wsOnly(ls, i) }); k++ }
          i = n
          continue
        }
        const seg = src.slice(i + 2, j)
        const eol = src.indexOf('\n', j + 2)
        const tail = src.slice(j + 2, eol === -1 ? n : eol)
        const solo = wsOnly(ls, i) && /^\s*$/.test(tail)
        let k = startLine
        for (const p of seg.split('\n')) { if (p) units.push({ line: k, text: p, kind: 'comment', solo: k === startLine && solo }); k++ }
        prev = ''
        i = j + 2
        continue
      }
      // 单双引号字符串
      if (ch === '"' || ch === "'") {
        const startLine = line
        let j = i + 1, buf = ''
        while (j < n) {
          const c = src[j]
          if (c === '\\') { buf += src.slice(j, j + 2); j += 2; continue }
          if (c === ch) break
          if (c === '\n') break
          buf += c
          j++
        }
        if (j < n && src[j] === ch) { emitText(startLine, buf); prev = ch; i = j + 1 }
        else {
          warns.push({ file: rel, msg: `行 ${startLine} 未闭合的字符串字面量——自安全换行点继续` })
          emitText(startLine, buf)
          const eol = src.indexOf('\n', i)
          i = eol === -1 ? n : eol
          prev = ''
        }
        continue
      }
      // 模板串：静态文本按行发单元；${ 推入代码态递归
      if (ch === '`') {
        i++
        let buf = '', bufLine = line
        for (;;) {
          if (i >= n) {
            warns.push({ file: rel, msg: `行 ${bufLine} 未闭合的模板串——自安全换行点继续` })
            emitText(bufLine, buf)
            prev = ''
            return stopBrace ? 'eof' : 'eof'
          }
          const c = src[i]
          if (c === '\\') { buf += src.slice(i, i + 2); i += 2; continue }
          if (c === '`') { i++; emitText(bufLine, buf); prev = '`'; break }
          if (c === '$' && src[i + 1] === '{') {
            emitText(bufLine, buf)
            buf = ''
            i += 2
            if (scanCode(true) === 'eof') {
              warns.push({ file: rel, msg: `行 ${bufLine} 模板串内 ${'$'}{} 未闭合——自安全换行点继续` })
              emitText(bufLine, buf)
              prev = ''
              return 'eof'
            }
            bufLine = line
            buf = ''
            continue
          }
          if (c === '\n') { buf += '\n'; i++; line++; ls = i; continue }
          buf += c
          i++
        }
        continue
      }
      // 正则字面量（体不扫描；字符类内斜杠不截断）
      if (ch === '/' && regexAllowed()) {
        const startLine = line
        let j = i + 1, inClass = false, closed = false
        while (j < n) {
          const c = src[j]
          if (c === '\\') { j += 2; continue }
          if (c === '\n') break
          if (c === '[') inClass = true
          else if (c === ']') inClass = false
          else if (c === '/' && !inClass) { closed = true; break }
          j++
        }
        if (closed) {
          j++
          while (j < n && /[a-z]/.test(src[j])) j++
          prev = '/'
          i = j
        } else {
          warns.push({ file: rel, msg: `行 ${startLine} 未闭合或歧义的正则字面量——自安全换行点继续` })
          const eol = src.indexOf('\n', i)
          i = eol === -1 ? n : eol
          prev = ''
        }
        continue
      }
      if (ch === '/') { prev = '/'; i++; continue } // 除法
      if (ch === '{') { prev = '{'; i++; if (stopBrace) depth++; continue }
      if (ch === '}') { if (stopBrace) depth--; prev = '}'; i++; continue }
      if (/[A-Za-z_$0-9]/.test(ch)) {
        let j = i
        while (j < n && /[A-Za-z_$0-9]/.test(src[j])) j++
        prev = src.slice(i, j)
        i = j
        continue
      }
      const three = src.slice(i, i + 3)
      const two = src.slice(i, i + 2)
      if (['===', '!==', '...', '**=', '<<=', '>>=', '&&=', '||=', '??='].includes(three)) { prev = three; i += 3; continue }
      if (['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '++', '--', '+=', '-=', '*=', '/=', '%=', '**'].includes(two)) { prev = two; i += 2; continue }
      prev = ch
      i++
    }
    return 'eof'
  }
  scanCode(false)
  return units
}

/** shell lexer（D-8）：词首/空白后 `#` 且不在引号、参数展开内=注释；单双引号串与
 *  here-doc 正文均扫；定界符单双引号形态都识别；未闭合告警并继续。 */
function lexShell(text, warns, rel) {
  const units = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let pending = null
  lines.forEach((line, idx) => {
    const ln = idx + 1
    if (pending) {
      const cand = (pending.tabs ? line.replace(/^\t+/, '') : line).replace(/\r$/, '')
      if (cand === pending.delim) { pending = null; return }
      if (line) units.push({ line: ln, text: line, kind: 'text', solo: false })
      return
    }
    const n = line.length
    let i = 0, depth = 0
    while (i < n) {
      const c = line[i]
      if (c === '\\' && i + 1 < n) { i += 2; continue }
      if (c === '#' && depth === 0) {
        const prevC = i === 0 ? ' ' : line[i - 1]
        if (prevC === ' ' || prevC === '\t' || prevC === ';' || prevC === '|' || prevC === '&' || prevC === '(' || prevC === '<') { // R10：词边界=行首/空白/;|&(< 之后（引号与参数展开内不变）
          units.push({ line: ln, text: line.slice(i + 1), kind: 'comment', solo: /^\s*$/.test(line.slice(0, i)) })
          i = n
          continue
        }
      }
      if (c === '"' || c === '\'') {
        const q = c
        const start = i + 1
        let j = i + 1, closed = false
        while (j < n) {
          if (q === '"' && line[j] === '\\') { j += 2; continue }
          if (line[j] === q) { closed = true; break }
          j++
        }
        if (closed) { units.push({ line: ln, text: line.slice(start, j), kind: 'text', solo: false }); i = j + 1 }
        else {
          warns.push({ file: rel, msg: `行 ${ln} 未闭合的引号串——告警后继续` })
          units.push({ line: ln, text: line.slice(start), kind: 'text', solo: false })
          i = n
        }
        continue
      }
      if (c === '$' && (line[i + 1] === '(' || line[i + 1] === '{')) { depth++; i += 2; continue }
      if ((c === ')' || c === '}') && depth > 0) { depth--; i++; continue }
      if (c === '<' && line[i + 1] === '<') {
        let j = i + 2
        const tabs = line[j] === '-'
        if (tabs) j++
        let q = null
        if (line[j] === '"' || line[j] === '\'') { q = line[j]; j++ }
        let d = ''
        while (j < n && (q ? line[j] !== q : !/[\s<>|&;]/.test(line[j]))) { d += line[j]; j++ }
        if (q && line[j] === q) j++
        if (d) pending = { delim: d, tabs }
        i = j
        continue
      }
      i++
    }
  })
  if (pending) warns.push({ file: rel, msg: `here-doc ${pending.delim} 未闭合——延续至文件尾` })
  return units
}

/** JSON/JSONL（D-8）：只扫字符串值（键名/数字/布尔/null 不扫）；JSONL 逐非空行、坏行告警后续行。 */
function lexJson(text, warns, rel, jsonl) {
  const units = []
  const emit = (startLine, seg) => {
    String(seg).split('\n').forEach((p, k) => { if (p) units.push({ line: startLine + k, text: p, kind: 'text', solo: false }) })
  }
  const scanChunk = (s, baseLine) => {
    let i = 0, line = baseLine
    const n = s.length
    while (i < n) {
      if (s[i] !== '"') { if (s[i] === '\n') line++; i++; continue }
      const startLine = line
      let j = i + 1
      while (j < n) {
        const d = s[j]
        if (d === '\\') { j += 2; continue }
        if (d === '"') break
        if (d === '\n') break
        j++
      }
      if (j >= n || s[j] === '\n') {
        warns.push({ file: rel, msg: `行 ${startLine} 字符串未闭合——告警后继续` })
        String(s.slice(i + 1, Math.min(j, n))).split('\n').forEach((p, k) => { if (p) units.push({ line: startLine + k, text: p, kind: 'text', solo: false }) })
        if (j >= n) { i = n; continue }
        line++
        i = j + 1
        continue
      }
      let k = j + 1
      while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\r' || s[k] === '\n')) { if (s[k] === '\n') line++; k++ }
      if (s[k] === ':') { i = k + 1; continue } // 键名不扫（含转义键）
      const rawTok = s.slice(i, j + 1)
      let decoded
      try { decoded = String(JSON.parse(rawTok)) } catch { decoded = rawTok.slice(1, -1) }
      units.push({ line: startLine, text: decoded, kind: 'text', solo: false }) // R4：解码值整体归 token 起始物理行——逻辑换行不虚构物理行
      i = k
    }
  }
  if (jsonl) {
    splitLines(text).forEach((raw, idx) => {
      const ln = idx + 1
      if (!raw.trim()) return
      try { JSON.parse(raw) } catch { warns.push({ file: rel, msg: `行 ${ln} 非法 JSON 行——告警后跳过该行` }); return }
      scanChunk(raw, ln)
    })
    return units
  }
  try { JSON.parse(text.replace(/^\uFEFF/, '')) } catch { warns.push({ file: rel, msg: '文件非合法 JSON——按字符串值启发式继续' }) }
  scanChunk(text.replace(/\r\n/g, '\n'), 1)
  return units
}

const LEX_TEXT = { markdown: lexMarkdown, javascript: lexJavaScript, shell: lexShell, json: (t, w, r) => lexJson(t, w, r, false), jsonl: (t, w, r) => lexJson(t, w, r, true), plain: lexPlain }

// ── 区段标注与选择（D-2/D-6）：off/on 只认独立注释单元；selector 语义互斥、行集可重叠并去重。──
function annotateRegions(units, warns, rel) {
  const offFlags = new Array(units.length).fill(false)
  const histFlags = new Array(units.length).fill(false)
  let inOff = false
  units.forEach((u, k) => {
    const isMarker = u.kind === 'comment' && u.solo && (u.text.trim() === MARKER_TEXT_OFF || u.text.trim() === MARKER_TEXT_ON)
    if (!isMarker) { if (inOff) offFlags[k] = true; return }
    if (u.text.trim() === MARKER_TEXT_OFF) {
      if (inOff) warns.push({ file: rel, msg: `行 ${u.line} 嵌套的 off 标记——按第一个 off 区继续` })
      inOff = true
    } else if (inOff) inOff = false
    else warns.push({ file: rel, msg: `行 ${u.line} 无配对 off 区的 on 标记——忽略` })
    offFlags[k] = true
  })
  if (inOff) warns.push({ file: rel, msg: 'off 区未闭合——延续至文件尾' })
  let histLevel = null
  units.forEach((u, k) => {
    if (u.kind !== 'heading') { if (histLevel !== null) histFlags[k] = true; return }
    if (histLevel !== null && u.level <= histLevel) histLevel = null
    if (histLevel === null && (u.title.startsWith('修订记') || u.title.startsWith('历史'))) { histLevel = u.level; histFlags[k] = true; return }
    if (histLevel !== null) histFlags[k] = true
  })
  return { offFlags, histFlags }
}

function selectUnits(units, regions, selector) {
  const sel = selector || 'active-text'
  const picked = []
  units.forEach((u, k) => {
    if (u.kind === 'fence') return
    if (sel === 'active-text') { if (!regions.offFlags[k] && !regions.histFlags[k]) picked.push(k) }
    else if (sel === 'history-sections') { if (regions.histFlags[k]) picked.push(k) }
    else if (regions.offFlags[k]) picked.push(k)
  })
  return picked
}

/** 单元词匹配（TERMS 声明序确定；同行同词计一次——含多规则重叠单元去重后的行级归并）。 */
function scanUnits(rel, units, terms) {
  const seen = new Set()
  const hits = []
  for (const u of units) {
    for (const t of terms) {
      const hit = t.kind === 'plain' ? u.text.includes(t.term) : [...u.text.matchAll(t.re)].length > 0
      if (!hit) continue
      const key = u.line + '\u0000' + t.term
      if (seen.has(key)) continue
      seen.add(key)
      hits.push({ file: rel, line: u.line, term: t.term, replace: t.replace })
    }
  }
  return hits
}

/** 文件遍历（exclude 固定五类目录剪枝；确定性排序；仓外根不递归——调用方只传仓内根）。 */
export function walkFiles(rootPath, exclude) {
  const out = []
  const prune = new Set(exclude.filter((g) => /\*\*$/.test(g)).map((g) => g.replace(/\/\*\*$/, '')))
  const exclRes = exclude.map(globToRe)
  const walk = (dir, relBase) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch (e) { throw new Error(`目录不可读：${dir}（${e.message}）`) }
    for (const e of entries) {
      const rel = relBase ? relBase + '/' + e.name : e.name
      if (e.isDirectory()) {
        if (prune.has(e.name) || exclRes.some((r) => r.test(rel))) continue
        walk(join(dir, e.name), rel)
      } else if (e.isFile()) {
        if (exclRes.some((r) => r.test(rel))) continue
        out.push({ rel, abs: join(dir, e.name) })
      }
    }
  }
  walk(rootPath, '')
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
}

/** 历史面棘轮分类（双基线 historical 分区；只降不升——D-3）。 */
export function classifyHist(hits, baseFiles) {
  const budget = {}
  return hits.map((h) => {
    const k = h.file + '\u0000' + h.term
    budget[k] = (budget[k] || 0) + 1
    const allow = baseFiles ? baseFiles[h.file]?.[h.term] : undefined
    return { ...h, status: allow === undefined || budget[k] > allow ? '新增' : '存量' }
  })
}

// ── self-test（24 向量；夹具全落 os.tmpdir() 并 finally 清理，CLI 一律 --root 指向夹具根）──
// （下方至 on 标记=selfTest 夹具区，本脚本仅有的两段受控豁免之二——D-9。）
// term-scan: off
function selfTest() {
  const self = fileURLToPath(import.meta.url)
  const run = (args) => spawnSync(process.execPath, [self, ...args], { encoding: 'utf8' }) // v2/v7 只读 CLI——继承外部 ORG_FLAGS_STATE（V-02 与 R12① 均显式 off 隔离）
  const withRoot = (fn) => {
    const d = mkdtempSync(join(tmpdir(), 'terms-st-'))
    try { return fn(d) } finally { rmSync(d, { recursive: true, force: true }) }
  }
  const mkBase = (d, files) => {
    mkdirSync(join(d, 'scripts', '.golden'), { recursive: true })
    writeFileSync(join(d, 'scripts', '.golden', 'terms-baseline.json'), JSON.stringify({ schemaVersion: 1, files }), 'utf8')
  }
  // 旧版公开 --update 的冻结等价体（D-13/W-8：仅本函数词法域可达、只写传入夹具根；
  // 返回旧 status/stdout 形态供 v3/v4/v5/v6/v8 原断言使用——不是 CLI 旁路）。
  const selfTestLegacyUpdate = (root) => {
    const BASE = join(root, 'scripts', '.golden', 'terms-baseline.json')
    let base = null
    if (existsSync(BASE)) {
      try {
        base = JSON.parse(readFileSync(BASE, 'utf8').replace(/^\uFEFF/, ''))
        if (!base || typeof base !== 'object' || typeof base.files !== 'object' || base.files === null) return { status: 3, stdout: '', stderr: '[配置/装载错] 基线件形态错' }
      } catch { return { status: 3, stdout: '', stderr: '[配置/装载错] 基线件不可解析' } }
    }
    const oldGroups = base ? Object.values(base.files).reduce((s, t) => s + Object.keys(t).length, 0) : 0
    const { files } = listSurface(root)
    const hits = []
    for (const f of files) {
      const rel = relative(root, f).replace(/\\/g, '/')
      hits.push(...scanFile(rel, readFileSync(f, 'utf8')))
    }
    const newHits = base ? classify(hits, base.files).filter((h) => h.status === '新增').length : 0
    if (newHits > 0) return { status: 1, stdout: '', stderr: `[用法错] 当前新增 ×${newHits}——--update 拒绝执行（防把违例洗进基线）；先清理新增命中` }
    const cur = {}
    for (const h of hits) (cur[h.file] ??= {})[h.term] = (cur[h.file][h.term] || 0) + 1
    const k = Object.keys(cur).reduce((s, f) => s + Object.keys(cur[f]).length, 0)
    mkdirSync(dirname(BASE), { recursive: true })
    writeFileSync(BASE, JSON.stringify({ schemaVersion: 1, frozen: localDateStr(), surface: SURFACE_DOC, note: 'check-terms 棘轮基线：file→term→命中行计数——--update 冻结禁手改（D22 生成物豁免）；清理批完成后重冻随批提交（docs/07 §5）', files: cur }, null, 2) + '\n', 'utf8')
    return { status: 0, stdout: `基线已冻结：${k} 组 / ${hits.length} 次（旧 ${oldGroups}→新 ${k}）\n`, stderr: '' }
  }
  // B3 新面向量助手（引擎无关）：flag 状态件＋terms_scan 项目覆盖件＋v2 历史基线预置。
  const stWrite = (d, val) => { const p = join(d, 'flags-state.json'); writeFileSync(p, JSON.stringify(val), 'utf8'); return p }
  const onSt = (d) => stWrite(d, { b2_terms_v2: true })
  const offSt = (d) => stWrite(d, { b2_terms_v2: false })
  const runEnv = (args, state) => spawnSync(process.execPath, [self, ...args], { encoding: 'utf8', env: { ...process.env, ORG_FLAGS_STATE: state } })
  const mkOverlay = (d, patch) => { mkdirSync(join(d, '.zcode'), { recursive: true }); writeFileSync(join(d, '.zcode', 'org-config.json'), JSON.stringify(patch), 'utf8') }
  const mkHistBase = (d, files, frozen = '2026-10-28') => {
    mkdirSync(join(d, 'scripts', '.golden'), { recursive: true })
    writeFileSync(join(d, 'scripts', '.golden', 'terms-baseline.json'), JSON.stringify({ schemaVersion: 2, frozen: frozen || '2026-10-28', surface: [], files: {}, historical: { frozen, files } }), 'utf8')
  }
  const readHist = (d) => JSON.parse(readFileSync(join(d, 'scripts', '.golden', 'terms-baseline.json'), 'utf8')).historical
  const frozenZero = (build) => withRoot((d) => { build(d); const u = selfTestLegacyUpdate(d); return u.status === 0 && u.stdout.includes('基线已冻结：0 组 / 0 次（旧 0→新 0）') })
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
    const u = selfTestLegacyUpdate(d)
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
    const u = selfTestLegacyUpdate(d)
    const r = run(['--root', d])
    return u.status === 0 && u.stdout.includes('基线已冻结：2 组 / 2 次（旧 0→新 2）') && r.status === 0
      && r.stdout.includes('存量 SKILL.md:1 禁用词「裁决史括注-修订序数」') && r.stdout.includes('存量 SKILL.md:2 禁用词「裁决史括注-日期裁决」') && !r.stdout.includes('SKILL.md:3')
  }))
  t('v6 棘轮通过态：基线=现态→过且汇总「新增 ×0」', withRoot((d) => {
    writeFileSync(join(d, 'SKILL.md'), '烤验现场\n', 'utf8')
    selfTestLegacyUpdate(d)
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
    const u = selfTestLegacyUpdate(d)
    const files = u.status === 0 ? JSON.parse(readFileSync(join(d, 'scripts', '.golden', 'terms-baseline.json'), 'utf8')).files['SKILL.md'] : null
    const r = run(['--root', d])
    return u.status === 0 && u.stdout.includes('基线已冻结：1 组 / 1 次（旧 2→新 1）') && files && Object.keys(files).length === 1 && r.status === 0 && r.stdout.includes('基线 1 组')
  }))
  // ── v9–v24（B3 新面 16 向量；自带 on/off 状态件与最小 terms_scan 覆盖件）──
  t('v9 JS 词法：标识符/右括号后 `/`=除法、表达式起始 `/`=正则；正则体不作字符串扫描', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [{ root: 'skill', include: ['scripts/*.mjs'] }], historical: [] } })
    mkdirSync(join(d, 'scripts'), { recursive: true })
    writeFileSync(join(d, 'scripts', 'a.mjs'), [
      'const n = m/2; // 烤验div1',
      'const re = /^烤验rx回炉$/; // 烤验cmt2',
      'const q = n/re.source.length; // 烤验div3',
    ].join('\n') + '\n', 'utf8')
    const r = runEnv(['--root', d, '--strict', '--surface', 'active'], onSt(d))
    const hitLines = [...r.stdout.matchAll(/a\.mjs:(\d+)/g)].map((m) => m[1])
    return r.status === 1 && JSON.stringify(hitLines) === JSON.stringify(['1', '2', '3'])
      && !r.stdout.includes('回炉」') && !(r.stdout + r.stderr).includes('歧义告警')
  }))
  t('v10 JS 正则含 `//` 与字符类斜杠：正则体不截断、其内注释起始符不误判、尾注仍抽取', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [{ root: 'skill', include: ['scripts/*.mjs'] }], historical: [] } })
    mkdirSync(join(d, 'scripts'), { recursive: true })
    writeFileSync(join(d, 'scripts', 'b.mjs'), [
      'const re1 = /a\\/\\/b烤验/; // 烤验tail1',
      'const re2 = /[/]烤验x[/]/; // 烤验tail2',
      'const s = "done"; // 烤验tail3',
    ].join('\n') + '\n', 'utf8')
    const r = runEnv(['--root', d, '--strict', '--surface', 'active'], onSt(d))
    const hitLines = [...r.stdout.matchAll(/b\.mjs:(\d+)/g)].map((m) => m[1])
    return r.status === 1 && JSON.stringify(hitLines) === JSON.stringify(['1', '2', '3']) && !(r.stdout + r.stderr).includes('歧义告警')
  }))
  t('v11 模板原文与 ${} 内注释递归识别；多行模板按物理行归位；同行同词计一次', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [{ root: 'skill', include: ['scripts/*.mjs'] }], historical: [] } })
    mkdirSync(join(d, 'scripts'), { recursive: true })
    writeFileSync(join(d, 'scripts', 'c.mjs'), [
      'const tag = `头${/* 烤验inner */ x}尾烤验尾`; // 烤验cmt',
      'const ml = `第一行烤验',
      '第二行回炉`;',
    ].join('\n') + '\n', 'utf8')
    const r = runEnv(['--root', d, '--strict', '--surface', 'active'], onSt(d))
    const hitLines = [...r.stdout.matchAll(/c\.mjs:(\d+)/g)].map((m) => m[1])
    return r.status === 1 && JSON.stringify(hitLines) === JSON.stringify(['1', '2', '3'])
      && (r.stdout.match(/c\.mjs:1 禁用词「烤验」/g) || []).length === 1 && r.stdout.includes('c.mjs:3 禁用词「回炉」')
  }))
  t('v12 JS `#` 非注释：裸 # 行不抽取；字符串内 # 不影响扫描', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [{ root: 'skill', include: ['scripts/*.mjs'] }], historical: [] } })
    mkdirSync(join(d, 'scripts'), { recursive: true })
    writeFileSync(join(d, 'scripts', 'e.mjs'), [
      '# 烤验hash',
      'const s = "# 烤验str";',
      'const u = v#w; // 烤验cmt',
    ].join('\n') + '\n', 'utf8')
    const r = runEnv(['--root', d, '--strict', '--surface', 'active'], onSt(d))
    const hitLines = [...r.stdout.matchAll(/e\.mjs:(\d+)/g)].map((m) => m[1])
    return r.status === 1 && JSON.stringify(hitLines) === JSON.stringify(['2', '3'])
  }))
  t('v13 shell：词首 # 注释、单双引号串、here-doc 正文（引号定界符两形态）、参数展开内 # 不误判', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [{ root: 'skill', include: ['run.sh'] }], historical: [] } })
    writeFileSync(join(d, 'run.sh'), [
      '# 烤验cmt',
      'echo "烤验dq"',
      "echo '烤验sq'",
      "cat <<'EOF'",
      '烤验heredoc',
      'EOF',
      'v=${u#pre} # 烤验tail',
      'cmd; # 烤验semi',
      'echo a|# 烤验pipe',
      'echo "# 烤验q"',
      'echo "a#b 烤验s" # 烤验t2',
    ].join('\n') + '\n', 'utf8')
    const r = runEnv(['--root', d, '--strict', '--surface', 'active'], onSt(d))
    const hitLines = [...r.stdout.matchAll(/run\.sh:(\d+)/g)].map((m) => m[1])
    return r.status === 1 && JSON.stringify(hitLines) === JSON.stringify(['1', '2', '3', '5', '7', '8', '9', '10', '11']) && !(r.stdout + r.stderr).includes('歧义告警')
  }))
  t('v14 JSON 只扫字符串值：键名/数字/布尔/null 不扫不误报', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [{ root: 'skill', include: ['cfg.json'] }], historical: [] } })
    writeFileSync(join(d, 'cfg.json'), [
      '{',
      '  "a": "\\u70e4\\u9a8cval",',
      '  "\\u70e4\\u9a8ckey": "plain",',
      '  "ml": "x\\n烤验nl",',
      '  "n": 5, "b": true, "z": null,',
      '  "arr": ["烤验arr", "回炉arr"]',
      '}',
    ].join('\n') + '\n', 'utf8')
    const r = runEnv(['--root', d, '--strict', '--surface', 'active'], onSt(d))
    const hitLines = [...r.stdout.matchAll(/cfg\.json:(\d+)/g)].map((m) => m[1])
    return r.status === 1 && JSON.stringify(hitLines) === JSON.stringify(['2', '4', '6', '6']) && !r.stdout.includes('cfg.json:3')
  }))
  t('v14b JSONL 逐行只扫字符串值：转义值命中、键名不误报、坏行告警后继续扫描（回审 JSONL 缺位补例·复核一审②坏行居中+告警断言）', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [{ root: 'skill', include: ['cfg.jsonl'] }], historical: [] } })
    writeFileSync(join(d, 'cfg.jsonl'), [
      '{"\\u70e4\\u9a8ckey": "plainval"}',
      'not json line',
      '{"a": "\\u70e4\\u9a8cval"}',
    ].join('\n') + '\n', 'utf8')
    const r = runEnv(['--root', d, '--strict', '--surface', 'active'], onSt(d))
    const hitLines = [...r.stdout.matchAll(/cfg\.jsonl:(\d+)/g)].map((m) => m[1])
    return r.status === 1 && JSON.stringify(hitLines) === JSON.stringify(['3']) && !r.stdout.includes('cfg.jsonl:1') && r.stdout.includes('歧义告警')
  }))
  t('v15 active 单面：历史小节不进 active；缺省 surface=active；历史面不并入 active 计数；解析器缺席不阻 active（R2）', withRoot((d) => {
    mkOverlay(d, { terms_scan: {
      active: [{ root: 'skill', include: ['a.md'] }],
      historical: [{ root: 'skill', include: ['h.md'], selector: 'history-sections' }],
    } })
    writeFileSync(join(d, 'a.md'), '烤验active\n', 'utf8')
    writeFileSync(join(d, 'h.md'), '前言\n## 历史\n烤验史话\n', 'utf8')
    const r = runEnv(['--root', d, '--strict'], onSt(d))
    const solo = r.status === 1 && r.stdout.includes('a.md:1') && !r.stdout.includes('h.md')
    const noMig = withRoot((d2) => { // R2：最小 scripts 根（无 ledger-migrate.mjs）——active-only 不装载解析器
      mkdirSync(join(d2, 'scripts'), { recursive: true })
      writeFileSync(join(d2, 'scripts', 'check-terms.mjs'), readFileSync(self))
      writeFileSync(join(d2, 'scripts', 'org-config.mjs'), readFileSync(join(dirname(self), 'org-config.mjs')))
      writeFileSync(join(d2, 'org-config.default.json'), JSON.stringify({ flags: { b2_terms_v2: { description: 'r2', owner_batch: 'B2', default: false } } }), 'utf8')
      mkOverlay(d2, { terms_scan: { baseline: 'scripts/.golden/terms-baseline.json', suffix_lexer: { '.md': 'markdown', '.mjs': 'javascript' }, exclude: ['.git/**', 'node_modules/**', 'vendor/**', '.venv/**', 'venv/**'], active: [{ root: 'skill', include: ['a.md'] }], historical: [] } })
      writeFileSync(join(d2, 'a.md'), '烤验solo\n', 'utf8')
      const r2 = spawnSync(process.execPath, [join(d2, 'scripts', 'check-terms.mjs'), '--strict', '--surface', 'active'], { encoding: 'utf8', env: { ...process.env, ORG_FLAGS_STATE: onSt(d2) } })
      return r2.status === 1 && (r2.stdout || '').includes('a.md:1') && !(r2.stderr || '').includes('Cannot find')
    })
    return solo && noMig
  }))
  t('v16 historical 单面＋同文件多规则重叠行去重（history-sections×term-scan-off 命中只计一次）', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [], historical: [
      { root: 'skill', include: ['refs.md'], selector: 'history-sections' },
      { root: 'skill', include: ['refs.md'], selector: 'term-scan-off' },
    ] } })
    writeFileSync(join(d, 'refs.md'), [
      '<!-- term-scan: off -->',
      '## 修订记',
      '烤验overlap',
      '<!-- term-scan: on -->',
      '烤验tail',
    ].join('\n') + '\n', 'utf8')
    const u = runEnv(['--root', d, '--update', '--surface', 'historical'], onSt(d))
    const h = u.status === 0 ? readHist(d) : null
    const r = runEnv(['--root', d, '--strict', '--surface', 'historical'], onSt(d))
    return !!h && !!h.frozen && JSON.stringify(h.files['skill:refs.md']) === JSON.stringify({ 烤验: 2 }) && r.status === 0
  }))
  t('v17 both 聚合：两面分别计数、历史存量不计入 active、严重度取最高', withRoot((d) => {
    const one = withRoot((d1) => {
      mkOverlay(d1, { terms_scan: { active: [{ root: 'skill', include: ['a.md'] }], historical: [{ root: 'skill', include: ['h.md'] }] } })
      writeFileSync(join(d1, 'a.md'), '烤验a\n', 'utf8')
      writeFileSync(join(d1, 'h.md'), '烤验h\n', 'utf8')
      mkHistBase(d1, { 'skill:h.md': { 烤验: 1 } })
      const r = runEnv(['--root', d1, '--strict', '--surface', 'both'], onSt(d1))
      return r.status === 1 && r.stdout.includes('active 汇总：命中 1') && r.stdout.includes('historical 汇总：新增 ×0')
    })
    const two = withRoot((d2) => {
      mkOverlay(d2, { terms_scan: { active: [{ root: 'skill', include: ['a.md'] }], historical: [{ root: 'skill', include: ['h.md'] }] } })
      writeFileSync(join(d2, 'a.md'), '干净无词\n', 'utf8')
      writeFileSync(join(d2, 'h.md'), '烤验h\n烤验h2\n', 'utf8')
      mkHistBase(d2, { 'skill:h.md': { 烤验: 1 } })
      const r = runEnv(['--root', d2, '--strict', '--surface', 'both'], onSt(d2))
      return r.status === 1 && r.stdout.includes('active 汇总：命中 0') && r.stdout.includes('historical 汇总：新增 ×1')
    })
    return one && two
  }))
  t('v18 历史首冻：未首冻→首冻；空白未冻＋现值非空→首冻成功；非空未冻→拒；update 缺 surface 拒（R1）', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [], historical: [{ root: 'skill', include: ['h.md'] }] } })
    writeFileSync(join(d, 'h.md'), '烤验one\n', 'utf8')
    const u1 = runEnv(['--root', d, '--update', '--surface', 'historical'], onSt(d))
    const h1 = u1.status === 0 ? readHist(d) : null
    const u2 = runEnv(['--root', d, '--update', '--surface', 'historical'], onSt(d))
    const uBad = runEnv(['--root', d, '--update'], onSt(d))
    const base = u1.status === 0 && !!h1 && !!h1.frozen && JSON.stringify(h1.files['skill:h.md']) === JSON.stringify({ 烤验: 1 })
      && u2.status === 0 && uBad.status === 1
    const blank = withRoot((dA) => { // R1：frozen=null 且 files={} ＝合法空白首冻态（现值非空也放行）
      mkOverlay(dA, { terms_scan: { active: [], historical: [{ root: 'skill', include: ['h.md'] }] } })
      writeFileSync(join(dA, 'h.md'), '烤验blank\n', 'utf8')
      mkHistBase(dA, {}, null)
      const u = runEnv(['--root', dA, '--update', '--surface', 'historical'], onSt(dA))
      return u.status === 0 && !!readHist(dA).frozen
    })
    const stale = withRoot((dB) => { // R1：frozen=null 且 files 非空 ＝畸形未冻态 → 装载失败族
      mkOverlay(dB, { terms_scan: { active: [], historical: [{ root: 'skill', include: ['h.md'] }] } })
      writeFileSync(join(dB, 'h.md'), '烤验x\n', 'utf8')
      mkHistBase(dB, { 'skill:h.md': { 烤验: 1 } }, null)
      const u = runEnv(['--root', dB, '--update', '--surface', 'historical'], onSt(dB))
      return u.status === 3
    })
    return base && blank && stale
  }))
  t('v19 基线收缩：现值低于基线→更新收缩、复跑过', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [], historical: [{ root: 'skill', include: ['h.md'] }] } })
    writeFileSync(join(d, 'h.md'), '烤验only\n', 'utf8')
    mkHistBase(d, { 'skill:h.md': { 烤验: 1, 回炉: 1 } })
    const u = runEnv(['--root', d, '--update', '--surface', 'historical'], onSt(d))
    const h = u.status === 0 ? readHist(d) : null
    const r = runEnv(['--root', d, '--strict', '--surface', 'historical'], onSt(d))
    return u.status === 0 && !!h && JSON.stringify(h.files['skill:h.md']) === JSON.stringify({ 烤验: 1 }) && r.status === 0
  }))
  t('v20 历史新增红：现值超基线→strict historical 退 1 且汇总新增 ×1', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [], historical: [{ root: 'skill', include: ['h.md'] }] } })
    writeFileSync(join(d, 'h.md'), '烤验one\n回炉two\n', 'utf8')
    mkHistBase(d, { 'skill:h.md': { 烤验: 1 } })
    const r = runEnv(['--root', d, '--strict', '--surface', 'historical'], onSt(d))
    return r.status === 1 && r.stdout.includes('新增 ×1')
  }))
  t('v21 拒绝把新增洗入基线：--update 退 1 且基线件字节不变', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [], historical: [{ root: 'skill', include: ['h.md'] }] } })
    writeFileSync(join(d, 'h.md'), '烤验one\n回炉two\n', 'utf8')
    mkHistBase(d, { 'skill:h.md': { 烤验: 1 } })
    const bp = join(d, 'scripts', '.golden', 'terms-baseline.json')
    const before = readFileSync(bp, 'utf8')
    const u = runEnv(['--root', d, '--update', '--surface', 'historical'], onSt(d))
    return u.status === 1 && u.stderr.includes('新增拒绝') && readFileSync(bp, 'utf8') === before
  }))
  t('v22 歧义告警计数并继续：未闭合字符串与未知后缀各计一次、命中不漏、重复运行确定', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [{ root: 'skill', include: ['broken.mjs'] }, { root: 'skill', include: ['data.xyz'] }], historical: [] } })
    writeFileSync(join(d, 'broken.mjs'), 'const s = "未闭合烤验\n', 'utf8')
    writeFileSync(join(d, 'data.xyz'), '烤验plain\n', 'utf8')
    const r1 = runEnv(['--root', d, '--strict', '--surface', 'active'], onSt(d))
    const r2 = runEnv(['--root', d, '--strict', '--surface', 'active'], onSt(d))
    const strictOk = r1.status === 1 && r1.stdout.includes('歧义告警汇总：2 件 / 2 次')
      && r1.stdout.includes('broken.mjs:1') && r1.stdout.includes('data.xyz:1')
      && r1.stdout === r2.stdout && r1.stderr === r2.stderr
    const upd = withRoot((d3) => { // R7：update 与 strict 共用歧义计数——告警汇总照出且基线写面不静默跳过
      mkOverlay(d3, { terms_scan: { active: [], historical: [{ root: 'skill', include: ['broken2.mjs'] }] } })
      writeFileSync(join(d3, 'broken2.mjs'), 'const s = "未闭合烤验\n', 'utf8')
      const u = runEnv(['--root', d3, '--update', '--surface', 'historical'], onSt(d3))
      const h = u.status === 0 ? readHist(d3) : null
      return u.status === 0 && (u.stdout || '').includes('歧义告警汇总：1 件 / 1 次') && !!h && !!h.files['skill:broken2.mjs']
    })
    return strictOk && upd
  }))
  t('v23 装载失败三面：terms_scan 缺段／基线不可解析／已选文件不可读 各退 3', withRoot((d) => {
    const a = withRoot((d1) => {
      mkOverlay(d1, { terms_scan: null })
      const r = runEnv(['--root', d1, '--strict'], onSt(d1))
      return r.status === 3 && r.stderr.includes('[配置/装载错]')
    })
    const b = withRoot((d2) => {
      mkOverlay(d2, { terms_scan: { active: [], historical: [{ root: 'skill', include: ['h.md'] }] } })
      writeFileSync(join(d2, 'h.md'), '烤验one\n', 'utf8')
      mkdirSync(join(d2, 'scripts', '.golden'), { recursive: true })
      writeFileSync(join(d2, 'scripts', '.golden', 'terms-baseline.json'), '{oops', 'utf8')
      const r = runEnv(['--root', d2, '--strict', '--surface', 'historical'], onSt(d2))
      return r.status === 3 && r.stderr.includes('[配置/装载错]')
    })
    const c = withRoot((d3) => {
      mkOverlay(d3, { terms_scan: { active: [{ root: 'skill', include: ['scripts/*.mjs'] }], historical: [] } })
      mkdirSync(join(d3, 'scripts'), { recursive: true })
      const f = join(d3, 'scripts', 'x.mjs')
      writeFileSync(f, '烤验x\n', 'utf8')
      chmodSync(f, 0o000)
      try {
        const r = runEnv(['--root', d3, '--strict', '--surface', 'active'], onSt(d3))
        return r.status === 3 && r.stderr.includes('[配置/装载错]')
      } finally { chmodSync(f, 0o644) }
    })
    const st = withRoot((d4) => { // R3：状态件不可解析/非对象 → 装载失败族（先于扫描与写盘，禁静默降 off）
      mkOverlay(d4, { terms_scan: { active: [{ root: 'skill', include: ['a.md'] }], historical: [] } })
      writeFileSync(join(d4, 'a.md'), '烤验st\n', 'utf8')
      const sp = join(d4, 'flags-state.json')
      const probe = (raw) => { writeFileSync(sp, raw, 'utf8'); const r = runEnv(['--root', d4, '--strict', '--surface', 'active'], sp); return r.status === 3 && (r.stderr || '').includes('状态件') }
      return probe('{broken') && probe('[1]') && probe('"x"')
    })
    const u8 = withRoot((d5) => { // R5：非法 UTF-8 → fatal 解码按文件不可读（禁降级 plain 放行）
      mkOverlay(d5, { terms_scan: { active: [{ root: 'skill', include: ['scripts/*.mjs'] }], historical: [] } })
      mkdirSync(join(d5, 'scripts'), { recursive: true })
      writeFileSync(join(d5, 'scripts', 'bin.mjs'), Buffer.from([0x27, 0x81, 0x0a]))
      const r = runEnv(['--root', d5, '--strict', '--surface', 'active'], onSt(d5))
      return r.status === 3 && (r.stderr || '').includes('不可读')
    })
    const ex = withRoot((d6) => { // R9：exclude 非字符串/空串元素与无点后缀键 → 装载失败族
      mkOverlay(d6, { terms_scan: { active: [{ root: 'skill', include: ['a.md'] }], historical: [], exclude: [''] } })
      writeFileSync(join(d6, 'a.md'), '烤验ex\n', 'utf8')
      const r1 = runEnv(['--root', d6, '--strict', '--surface', 'active'], onSt(d6))
      mkOverlay(d6, { terms_scan: { active: [{ root: 'skill', include: ['a.md'] }], historical: [], exclude: [123] } })
      const r2 = runEnv(['--root', d6, '--strict', '--surface', 'active'], onSt(d6))
      mkOverlay(d6, { terms_scan: { active: [{ root: 'skill', include: ['a.md'] }], historical: [], suffix_lexer: { txt: 'plain' } } })
      const r3 = runEnv(['--root', d6, '--strict', '--surface', 'active'], onSt(d6))
      return r1.status === 3 && r2.status === 3 && r3.status === 3
    })
    return a && b && c && st && u8 && ex
  }))
  t('v23b 配置装载失败分流（R3b·回审 B-4 补全）：flag=on→退 3；flag 可确证 off→legacy 可用不阻断', withRoot((d) => {
    mkdirSync(join(d, '.zcode'), { recursive: true })
    writeFileSync(join(d, '.zcode', 'org-config.json'), '{oops', 'utf8') // 项目覆盖层损坏→loadOrgConfig 抛错
    writeFileSync(join(d, 'SKILL.md'), 'clean line\n', 'utf8')
    mkdirSync(join(d, 'scripts', '.golden'), { recursive: true })
    writeFileSync(join(d, 'scripts', '.golden', 'terms-baseline.json'), JSON.stringify({ schemaVersion: 1, files: {} }), 'utf8')
    const rOn = runEnv(['--root', d, '--strict'], onSt(d))
    const a = rOn.status === 3 && (rOn.stderr || '').includes('org-config 装载失败')
    const rOff = runEnv(['--root', d, '--strict'], stWrite(d, { b2_terms_v2: false }))
    const b = rOff.status === 0 && (rOff.stdout || '').includes('绝对零模式')
    // 复核一审①补：状态件可解析但形态非法（数组）+配置坏→fail-closed 退 3（与 R3 主路径同律，禁绕开）
    const rArr = runEnv(['--root', d, '--strict'], stWrite(d, ['arr']))
    const c = rArr.status === 3 && (rArr.stderr || '').includes('形态非法')
    return a && b && c
  }))
  t('v23c historical 分区 shape 错→退 3 不静默回落（R6b·回审 W-1：防「未首冻」引导覆盖洗基线）', withRoot((d) => {
    mkOverlay(d, { terms_scan: { active: [], historical: [{ root: 'skill', include: ['h.md'] }] } })
    writeFileSync(join(d, 'h.md'), '烤验h\n', 'utf8')
    mkdirSync(join(d, 'scripts', '.golden'), { recursive: true })
    writeFileSync(join(d, 'scripts', '.golden', 'terms-baseline.json'), JSON.stringify({ schemaVersion: 2, files: {}, historical: { frozen: 'x', files: ['arr'] } }), 'utf8')
    const r = runEnv(['--root', d, '--strict', '--surface', 'historical'], onSt(d))
    return r.status === 3 && (r.stderr || '').includes('historical 分区形态非法')
  }))
  t('v24 off legacy 等价＋off --update 拒用且哨兵基线零写入＋两段自指标记元断言（恰两对/零嵌套/区外零命中）', withRoot((d) => {
    mkdirSync(join(d, 'scripts', '.golden'), { recursive: true })
    writeFileSync(join(d, 'scripts', '.golden', 'terms-baseline.json'), JSON.stringify({ schemaVersion: 1, files: {} }), 'utf8')
    writeFileSync(join(d, 'SKILL.md'), '烤验legacy\n', 'utf8')
    const r1 = runEnv(['--root', d, '--strict'], offSt(d))
    const r2 = runEnv(['--root', d, '--strict', '--surface', 'both'], offSt(d))
    const eq = r1.status === 1 && r2.status === r1.status && r1.stdout === r2.stdout && r1.stderr === r2.stderr && r1.stdout.includes('命中 1')
    const eq2 = withRoot((d2) => {
      mkOverlay(d2, { terms_scan: { active: [], historical: [{ root: 'skill', include: ['h.md'] }] } })
      writeFileSync(join(d2, 'h.md'), '烤验one\n', 'utf8')
      mkHistBase(d2, { 'skill:h.md': { 烤验: 1 } })
      const bp = join(d2, 'scripts', '.golden', 'terms-baseline.json')
      const before = readFileSync(bp, 'utf8')
      const u1 = runEnv(['--root', d2, '--update', '--surface', 'historical'], offSt(d2))
      const u2 = runEnv(['--root', d2, '--update'], offSt(d2))
      return u1.status === 1 && u1.stderr.includes('[用法错]') && u2.status === 1 && readFileSync(bp, 'utf8') === before
    })
    const srcLines = readFileSync(self, 'utf8').split('\n')
    const M_OFF = 'term-scan:' + ' off'
    const M_ON = 'term-scan:' + ' on'
    let state = 'clean', pairs = 0, nestBad = false
    const outside = []
    for (const ln of srcLines) {
      const t = ln.trim()
      const isOff = t === '// ' + M_OFF
      const isOn = t === '// ' + M_ON
      if (state === 'clean' && isOff) { state = 'off'; pairs++; continue }
      if (state === 'off' && isOn) { state = 'clean'; continue }
      if ((state === 'clean' && isOn) || (state === 'off' && isOff)) nestBad = true
      if (state === 'clean') outside.push(ln)
    }
    const noMig = withRoot((d6) => { // R2：解析器缺席下 off legacy 路径照常（零触动态导入）
      mkdirSync(join(d6, 'scripts', '.golden'), { recursive: true })
      writeFileSync(join(d6, 'scripts', 'check-terms.mjs'), readFileSync(self))
      writeFileSync(join(d6, 'scripts', 'org-config.mjs'), readFileSync(join(dirname(self), 'org-config.mjs')))
      writeFileSync(join(d6, 'scripts', '.golden', 'terms-baseline.json'), JSON.stringify({ schemaVersion: 1, files: {} }), 'utf8')
      writeFileSync(join(d6, 'SKILL.md'), '烤验nomig\n', 'utf8')
      const r = spawnSync(process.execPath, [join(d6, 'scripts', 'check-terms.mjs'), '--strict'], { encoding: 'utf8', env: { ...process.env, ORG_FLAGS_STATE: offSt(d6) } })
      return r.status === 1 && (r.stdout || '').includes('命中 1') && !(r.stderr || '').includes('Cannot find')
    })
    const clean = state === 'clean' && pairs === 2 && !nestBad
      && outside.every((ln) => !TERMS.some((x) => (x.kind === 'plain' ? ln.includes(x.term) : [...ln.matchAll(x.re)].length > 0)))
    return eq && eq2 && noMig && clean
  }))
  // ── v25–v29（TG-1 独立单文件快检 --file 五向量；always-active，runEnv 显式控 flag）──
  t('v25 快检命中：exit 1 且 stdout 含 D-1 固定形态整行（term/replace 逐字）', withRoot((d) => {
    writeFileSync(join(d, 'hit.md'), '这是烤验现场\n', 'utf8')
    const p = join(d, 'hit.md')
    const r = runEnv(['--file', p], onSt(d))
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^\\[terms\\] ${esc}:1 「烤验」→ 建议「强制检查」$`, 'm')
    return r.status === 1 && re.test(r.stdout)
  }))
  t('v26 快检干净：exit 0＋汇总计数 0＋无明细行；--strict 同用同绿；命中夹具带/不带 --strict 两次完整 stdout 全等且 exit 均 1', withRoot((d) => {
    writeFileSync(join(d, 'clean.md'), '干净正文样例。\n', 'utf8')
    const detailForm = /^\[terms\] \S+:\d+ 「/m // 明细形态级：行首 [terms]＋路径:行号＋空格＋「（汇总行不含该形态）
    const rc = runEnv(['--file', join(d, 'clean.md')], onSt(d))
    const rs = runEnv(['--strict', '--file', join(d, 'clean.md')], offSt(d))
    const cleanOk = rc.status === 0 && rs.status === 0 && rc.stdout.includes('命中 0 处') && !detailForm.test(rc.stdout)
      && rs.stdout.includes('命中 0 处') && !detailForm.test(rs.stdout)
    writeFileSync(join(d, 'hit.md'), '这是烤验现场\n', 'utf8')
    const hp = join(d, 'hit.md')
    const hpEsc = hp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const hitLine = new RegExp(`^\\[terms\\] ${hpEsc}:1 「烤验」→ 建议「强制检查」$`, 'm') // D-1 固定形态完整命中行（整行正则）
    const a = runEnv(['--file', hp], onSt(d))
    const b = runEnv(['--strict', '--file', hp], onSt(d))
    return cleanOk && a.status === 1 && b.status === 1 && a.stdout === b.stdout && hitLine.test(a.stdout)
  }))
  t('v27 快检文件错误族：不存在/目录/不可读（chmod 000·非 root）/UTF-8 无效字节均 exit 3＋stderr 非空＋stdout 无明细（通道分离）', withRoot((d) => {
    writeFileSync(join(d, 'bin.md'), Buffer.from([0xff, 0xfe, 0x0a]))
    writeFileSync(join(d, 'lock.md'), '占位\n', 'utf8')
    chmodSync(join(d, 'lock.md'), 0o000)
    try {
      const probes = [
        runEnv(['--file', join(d, 'nope.md')], onSt(d)),
        runEnv(['--file', d], onSt(d)),
        runEnv(['--file', join(d, 'lock.md')], onSt(d)),
        runEnv(['--file', join(d, 'bin.md')], onSt(d)),
      ]
      const detailPrefix = /^\[terms\] \S+:\d+ /m // 明细形态级：行首 [terms]＋路径:行号＋空格（stdout 不得含任何明细形态行）
      return probes.every((r) => r.status === 3 && (r.stderr || '').length > 0 && !detailPrefix.test(r.stdout || ''))
    } finally { try { chmodSync(join(d, 'lock.md'), 0o644) } catch { /* 夹具清理兜底 */ } }
  }))
  t('v28 --file 互斥与取值校验：与 --update/--surface/--project/--root/--self-test 逐个组合＋缺值＋重复＋值形如 flag 均 exit 1，互斥语义在 stderr', withRoot((d) => {
    const p = join(d, 'x.md')
    const st = offSt(d)
    const mut = runEnv(['--file', p, '--update'], st)
    const mutexOk = mut.status === 1 && (mut.stderr || '').includes('互斥')
    const rest = [
      ['--file', p, '--surface', 'active'],
      ['--file', p, '--project', d],
      ['--file', p, '--root', d],
      ['--file', p, '--self-test'],
      ['--file'],
      ['--file', p, '--file', p],
      ['--file', '--json'],
    ].map((args) => runEnv(args, st))
    return mutexOk && rest.every((r) => r.status === 1)
  }))
  t('v29 快检围栏豁免：围栏外词计入、围栏内同词不计（整行前缀断言·汇总计数=1）；on/off 两态 stdout 逐字节一致', withRoot((d) => {
    const p = join(d, 'fence.md')
    writeFileSync(p, ['围栏外烤验现场', '```', '围栏内烤验藏词', '```'].join('\n') + '\n', 'utf8')
    const a = runEnv(['--file', p], onSt(d))
    const b = runEnv(['--file', p], offSt(d))
    const outside = a.stdout.includes(`[terms] ${p}:1 「烤验」→ 建议「强制检查」`)
    const inside = a.stdout.split('\n').some((ln) => ln.startsWith(`[terms] ${p}:3 `))
    return a.status === 1 && b.status === 1 && a.stdout === b.stdout && outside && !inside && a.stdout.includes('命中 1 处')
  }))
  const fail = cases.filter((x) => !x.c)
  for (const x of cases) console.log(`${x.c ? 'PASS' : 'FAIL'} ${x.n}`)
  console.log(fail.length ? `self-test 未全过：FAIL ×${fail.length}` : `self-test 全过（${cases.length} 向量）`) // 动态计数——回审补例后 27（v14b/v23b/v23c 随回审处置入列·R12 断言随动）
  return fail.length === 0
}
// term-scan: on

// ── 主流程 ──
const argv = process.argv.slice(2)
const KNOWN_FLAGS = ['--strict', '--json', '--update', '--self-test', '--root', '--surface', '--project', '--file']
const bad = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root' || argv[i] === '--surface' || argv[i] === '--project' || argv[i] === '--file') { i++; continue }
  if (!KNOWN_FLAGS.includes(argv[i])) bad.push(argv[i])
}
if (bad.length) { console.error(`[用法错] 未知参数：${bad.join(' ')}（合法：${KNOWN_FLAGS.join(' ')}）`); process.exit(1) }
// ── TG-1 独立单文件快检（--file <path>）：入口层分流——先于 off/on 两路径与任何 baseline/配置装载（D-1；
//    词表与豁免机关复用 scanFile 单源，不读不写 baseline，不改不带 --file 的两条主路径）。──
import { normalize as pNormalize, isAbsolute as pIsAbsolute } from 'node:path'
if (argv.includes('--file')) {
  let fp = null
  try { fp = cliFlag(argv, '--file') } catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
    throw e
  }
  for (const m of ['--update', '--surface', '--project', '--root', '--self-test']) {
    if (argv.includes(m)) { console.error(`[用法错] --file 与 ${m} 互斥（单文件快检独立于 ${m}，不共用出口）`); process.exit(1) }
  }
  if (!existsSync(fp)) { console.error(`[配置/装载错] 快检文件不存在：${fp}`); process.exit(3) }
  if (statSync(fp).isDirectory()) { console.error(`[配置/装载错] 快检目标是目录而非文件：${fp}`); process.exit(3) }
  let text = null
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(fp)) } catch (e) {
    console.error(`[配置/装载错] 快检文件装载失败：${fp}（${e.message}）`); process.exit(3)
  }
  const shown = pIsAbsolute(fp) ? fp : pNormalize(fp) // 归一化（§3.4.1）：绝对输入三处原样；相对输入三处=path.normalize 相对串
  const hits = scanFile(shown, text)
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ file: shown, count: hits.length, hits }))
  } else {
    for (const h of hits) console.log(`[terms] ${h.file}:${h.line} 「${h.term}」→ 建议「${h.replace}」`)
    console.log(`[terms] 单文件快检汇总：文件 ${shown} 命中 ${hits.length} 处`)
  }
  process.exit(hits.length ? 1 : 0)
}
let root = null
try { root = cliFlag(argv, '--root') } catch (e) {
  if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
  throw e
}
root = root || SKILL_ROOT
if (!existsSync(root) || !statSync(root).isDirectory()) { console.error(`[用法错] --root 指向不存在目录：${root}`); process.exit(1) }
if (argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1)
// flag 装载（D-4：off 在装载 terms_scan 前分流；装载异常=回退 legacy 安全面，不阻断旧调用）
let on = false, mergedCfg = null
try {
  mergedCfg = loadOrgConfig(root).merged
} catch (e) {
  // R3b（双审回审 B-4 补全＋复核一审①）：配置装载失败按 flag 状态件分流——显式 on、状态件不可读、
  // 或状态件形态非法（null/数组/标量——与 R3 主路径 :1070 同律，禁绕开）=fail-closed 退 3；
  // 状态件缺席=flag 未登记（缺省 false）或显式 false=可确证 off，保 legacy 可用性（D-4 前提）。
  let stOn = false, stShapeOk = true, stErr = null
  try {
    const sp = flagsStatePath()
    if (existsSync(sp)) {
      const st = JSON.parse(readFileSync(sp, 'utf8').replace(/^\uFEFF/, ''))
      if (st == null || typeof st !== 'object' || Array.isArray(st)) stShapeOk = false
      else stOn = st.b2_terms_v2 === true
    }
  } catch (se) { stErr = se }
  if (stErr || !stShapeOk || stOn) {
    const why = stErr ? `件不可读（${stErr.message}）` : stOn ? '=on' : '件形态非法（须普通对象——与 R3 主路径同律）'
    console.error(`[配置/装载错] org-config 装载失败（${e.message}）且 flag 状态${why}——fail-closed（06 §5.8 行 3）`)
    process.exit(3)
  }
} // 其余装载异常（flag 可确证非 on）=回退 legacy 安全面（D-4）；terms_scan 形态错在 on 分支承接
if (mergedCfg != null) {
  // R3：状态件 fail-closed——存在即须可读、可解析且为普通对象；否则装载失败族退出（先于任何扫描/写盘），禁静默降 off
  const stPath = flagsStatePath()
  let state = {}
  if (existsSync(stPath)) {
    let parsed = null
    try { parsed = JSON.parse(readFileSync(stPath, 'utf8').replace(/^\uFEFF/, '')) } catch (e) { console.error(`[配置/装载错] flag 状态件不可解析：${stPath}（${e.message}）`); process.exit(3) }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { console.error(`[配置/装载错] flag 状态件形态非法：${stPath}（须普通对象，收到 ${Array.isArray(parsed) ? '数组' : parsed === null ? 'null' : typeof parsed}）`); process.exit(3) }
    state = parsed
  }
  on = resolveFlagValue(mergedCfg, 'b2_terms_v2', state) === true
}
if (!on) {
  if (argv.includes('--update')) {
    console.error('[用法错] off 态 --update 已拒用（防 legacy 写回 schemaVersion=1 丢失基线 historical 分区）——on 态且显式 --surface historical|both 才可冻结')
    process.exit(1)
  }
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
  if (!base) { console.error(`[配置/装载错] 基线件缺失：${BASE}——先跑 --update 首冻（棘轮基线）`); process.exit(3) }
  const { files, missing } = listSurface(root)
  const hits = []
  for (const f of files) {
    const rel = relative(root, f).replace(/\\/g, '/')
    hits.push(...scanFile(rel, readFileSync(f, 'utf8')))
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
}
// ── on 态（b2_terms_v2）：terms_scan 三面执法（surface/selector 语义=任务书 D-2/D-5）──
const vcOn = assertVocab()
if (!vcOn.ok) { console.error(`[配置/装载错] 词表总数断言失败：plain${vcOn.plain}+combo${vcOn.combo}=${vcOn.total}（期望 ${TERM_TOTAL}）rule2=${vcOn.rule2} 空替换=${vcOn.empty}——两源表与规格失配`); process.exit(3) }
const termsScan = mergedCfg.terms_scan
const tsErrs = validateTermsScan(termsScan)
if (tsErrs.length) { console.error(`[配置/装载错] terms_scan 形态错：${tsErrs.join('；')}`); process.exit(3) }
let surfaceArg = null
try { surfaceArg = cliFlag(argv, '--surface') } catch (e) {
  if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
  throw e
}
const surface = surfaceArg || 'active'
if (!['active', 'historical', 'both'].includes(surface)) { console.error(`[用法错] --surface 取值须 active|historical|both（收到「${surfaceArg}」）`); process.exit(1) }
const isUpdate = argv.includes('--update')
if (isUpdate && surface === 'active') { console.error('[用法错] on 态 --update 须显式 --surface historical|both（active 面无可冻结基线）'); process.exit(1) }
const wantHist = surface !== 'historical' ? surface === 'both' : true
const BASE_PATH = join(root, termsScan.baseline)
let baseDoc = null, histBase = null
if (existsSync(BASE_PATH)) {
  try {
    baseDoc = JSON.parse(readFileSync(BASE_PATH, 'utf8').replace(/^\uFEFF/, ''))
    if (!baseDoc || typeof baseDoc !== 'object' || typeof baseDoc.files !== 'object' || baseDoc.files === null) throw new Error('files 键缺失或非对象')
  } catch (e) { console.error(`[配置/装载错] 基线件不可解析：${BASE_PATH}（${e.message}）`); process.exit(3) }
  // R6b（回审 W-1）：historical 分区存在即验 shape——错形态退 3，禁静默回落 blank（否则 strict 报「未首冻」
  // 引导 --update 首冻覆盖，可洗掉原基线——D-3 仅允许 frozen=null 且 files={} 的合法未首冻态）。
  if ('historical' in baseDoc) {
    const h = baseDoc.historical
    const shapeOk = h != null && typeof h === 'object' && !Array.isArray(h)
      && h.files != null && typeof h.files === 'object' && !Array.isArray(h.files)
      && (typeof h.frozen === 'string' || h.frozen === null || h.frozen === undefined)
    if (!shapeOk) { console.error(`[配置/装载错] 基线件 historical 分区形态非法：${BASE_PATH}（须对象且 files 为非数组对象、frozen 为 string|null/缺席——防 shape 错静默回落 blank 洗掉原基线）`); process.exit(3) }
    histBase = h
  } else histBase = { frozen: null, files: {} }
} else {
  if (wantHist && !isUpdate) { console.error(`[配置/装载错] 基线件缺失：${BASE_PATH}——historical 面未首冻，先跑 --update --surface historical`); process.exit(3) }
  histBase = { frozen: null, files: {} }
}
if (wantHist && !isUpdate && !histBase.frozen) { console.error(`[配置/装载错] 历史基线未首冻：${BASE_PATH}——先跑 --update --surface historical 首冻`); process.exit(3) }
// 项目根解析器只在 on 且选中 project 历史规则时装载（D-2；单源=ledger-migrate resolveProjectRoot，禁内联复制）
const needProject = wantHist && termsScan.historical.some((r) => r.root === 'project')
const roots = { skill: root, project: null }
if (needProject) {
  let explicit = null
  try { explicit = cliFlag(argv, '--project') } catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
    throw e
  }
  // R2：解析器动态装载（仅 on＋project 历史规则到达此处；off／active-only 零依赖该文件）
  let resolveProjectRoot = null
  try { ({ resolveProjectRoot } = await import('./ledger-migrate.mjs')) } catch { resolveProjectRoot = null }
  if (typeof resolveProjectRoot !== 'function') { console.error('[配置/装载错] 解析器模块不可装载：scripts/ledger-migrate.mjs（project 历史规则必需）'); process.exit(3) }
  const rr = resolveProjectRoot(explicit, mergedCfg.projects)
  if (!rr || !rr.root) { console.error('[配置/装载错] 项目根不可解析——--project 显式参／projects ai-dev-org {root} 注册／homedir 约定回退均未命中'); process.exit(3) }
  roots.project = rr.root
}
const warns = []
const walkCache = new Map()
const getWalk = (rid) => {
  if (!walkCache.has(rid)) {
    try { walkCache.set(rid, walkFiles(roots[rid], termsScan.exclude)) } catch (e) { console.error(`[配置/装载错] ${e.message}`); process.exit(3) }
  }
  return walkCache.get(rid)
}
const lexCache = new Map()
const getLex = (ent) => {
  const k = ent.rootId + '\u0000' + ent.rel
  if (!lexCache.has(k)) {
    let buf, text
    try { buf = readFileSync(ent.abs) } catch (e) { console.error(`[配置/装载错] 已选文件不可读：${ent.rootId}:${ent.rel}（${e.message}）`); process.exit(3) }
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch (e) { console.error(`[配置/装载错] 已选文件不可读（非法 UTF-8）：${ent.rootId}:${ent.rel}（${e.message}）`); process.exit(3) } // R5：fatal 严格解码，非法字节=文件不可读
    const lexer = ent.rule.lexer || (() => {
      const dot = ent.rel.lastIndexOf('.')
      const ext = dot > -1 && dot > ent.rel.lastIndexOf('/') ? ent.rel.slice(dot).toLowerCase() : ''
      if (ext && termsScan.suffix_lexer[ext]) return termsScan.suffix_lexer[ext]
      if (/^#!.*\b(sh|bash|dash|zsh|ksh)\b/.test(text.slice(0, 64))) return 'shell'
      warns.push({ file: ent.rootId + ':' + ent.rel, msg: `未知后缀「${ext || '(无)'}」——按 plain 文本尝试` })
      return 'plain'
    })()
    const units = LEX_TEXT[lexer](text, warns, ent.rootId + ':' + ent.rel)
    lexCache.set(k, { units, regions: annotateRegions(units, warns, ent.rootId + ':' + ent.rel) })
  }
  return lexCache.get(k)
}
const runSurface = (sf) => {
  const perFile = new Map()
  for (const rule of termsScan[sf]) {
    if (roots[rule.root] == null) continue // 装载校验已禁 active/project；historical project 未选中时不得静默
    const res = rule.include.map(globToRe)
    for (const f of getWalk(rule.root)) {
      if (rule.root === 'skill' && f.rel === 'constraints/PROVENANCE.md') continue // 整件豁免沿用（Y1 先例）
      if (!res.some((r) => r.test(f.rel))) continue
      const key = rule.root + '\u0000' + f.rel
      if (!perFile.has(key)) perFile.set(key, { rootId: rule.root, rel: f.rel, abs: f.abs, rule: [] })
      perFile.get(key).rule.push(rule)
    }
  }
  const hits = []
  for (const key of [...perFile.keys()].sort()) {
    const ent = perFile.get(key)
    const { units, regions } = getLex({ ...ent, rule: ent.rule[0] })
    const chosen = new Set()
    for (const r of ent.rule) for (const k of selectUnits(units, regions, r.selector)) chosen.add(k)
    hits.push(...scanUnits(ent.rootId + ':' + ent.rel, [...chosen].sort((a, b) => a - b).map((k) => units[k]), TERMS))
  }
  return hits
}
const activeHits = surface === 'historical' ? [] : runSurface('active')
const histHits = wantHist ? runSurface('historical') : []
if (isUpdate) {
  if (surface === 'both' && activeHits.length > 0) { console.error(`[新增拒绝] active 仍有命中 ×${activeHits.length}——--surface both 更新须 active 面先零`); process.exit(1) }
  // R1：frozen=null 且 files={} ＝合法空白首冻态（现值非空也放行）；仅 frozen=null 且 files 非空＝畸形未冻态 → 装载失败族
  const baseKeyN = Object.keys(histBase.files || {}).length
  if (!histBase.frozen && baseKeyN > 0) { console.error(`[配置/装载错] historical 分区未首冻且基线非空——畸形未冻态（frozen=null 且 files={} 才是合法空白首冻态）`); process.exit(3) }
  const newN = histBase.frozen ? classifyHist(histHits, histBase.files).filter((h) => h.status === '新增').length : 0
  if (newN > 0) { console.error(`[新增拒绝] historical 现值超基线（新增 ×${newN}）——已保持基线件字节不变；先清理新增命中`); process.exit(1) }
  const cur = {}
  for (const h of histHits) (cur[h.file] ??= {})[h.term] = (cur[h.file][h.term] || 0) + 1
  const firstFreeze = !histBase.frozen
  const doc = {
    schemaVersion: 2,
    frozen: baseDoc?.frozen || localDateStr(),
    surface: baseDoc?.surface || SURFACE_DOC,
    note: baseDoc?.note || LEGACY_NOTE,
    files: baseDoc?.files || {},
    historical: {
      frozen: firstFreeze ? localDateStr() : histBase.frozen,
      surface: termsScan.historical.map((r) => `${r.root}:${[r.include.join(','), r.selector].filter(Boolean).join(':')}`),
      files: cur,
    },
  }
  mkdirSync(dirname(BASE_PATH), { recursive: true })
  writeFileSync(BASE_PATH, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  const files = Object.keys(cur).length // R6：三层=文件键数／逐文件 term 键数和／各 term 计数和
  const groups = Object.values(cur).reduce((sx, t) => sx + Object.keys(t).length, 0)
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ update: true, firstFreeze, files, groups, hits: histHits.length, frozen: doc.historical.frozen, warnings: { files: new Set(warns.map((w) => w.file)).size, times: warns.length, detail: warns } })) // R7：update JSON 落 warnings
  } else {
    console.log(firstFreeze
      ? `基线已首冻（historical）：文件 ${files} 件 / ${groups} 组 / ${histHits.length} 次（frozen=${doc.historical.frozen}）`
      : `基线已更新（historical）：文件 ${files} 件 / ${groups} 组 / ${histHits.length} 次（只降不升棘轮维持）`)
    if (warns.length) console.log(`check-terms 歧义告警汇总：${new Set(warns.map((w) => w.file)).size} 件 / ${warns.length} 次`) // R7：update 与 strict 共用歧义计数
  }
  process.exit(0)
}
const out = []
let exitCode = 0
if (surface !== 'historical') {
  for (const h of activeHits) out.push(`命中 ${h.file}:${h.line} 禁用词「${h.term}」→ 建议「${h.replace}」`)
  const groups = new Set(activeHits.map((h) => h.file + '\u0000' + h.term)).size
  out.push(`check-terms active 汇总：命中 ${activeHits.length} 次 / ${groups} 组（active 面严格零命中执法）`)
  if (activeHits.length) exitCode = 1
}
let histNewN = 0, histKept = 0, histGroups = 0, histTotal = 0
if (wantHist) {
  const marked = classifyHist(histHits, histBase.files)
  const news = marked.filter((h) => h.status === '新增')
  for (const h of news) out.push(`新增 ${h.file}:${h.line} 禁用词「${h.term}」→ 建议「${h.replace}」`)
  histNewN = news.length
  histKept = marked.length - histNewN
  const baseFiles = histBase.files || {}
  histGroups = Object.values(baseFiles).reduce((sx, t) => sx + Object.keys(t).length, 0) // R6：组数=逐文件 term 键数和
  histTotal = marked.length
  const baseHits = Object.values(baseFiles).reduce((sx, t) => sx + Object.values(t).reduce((a, b) => a + b, 0), 0)
  out.push(`check-terms historical 汇总：新增 ×${histNewN} 次 / 存量 ${histKept} 次 / 基线 ${Object.keys(baseFiles).length} 件 / ${histGroups} 组 / ${baseHits} 次 / 命中 ${histTotal} 次（首冻 ${histBase.frozen || '未首冻'}；只降不升）`)
  if (histNewN > 0) exitCode = 1
}
if (warns.length) out.push(`check-terms 歧义告警汇总：${new Set(warns.map((w) => w.file)).size} 件 / ${warns.length} 次`)
if (argv.includes('--json')) {
  console.log(JSON.stringify({
    surface, exit: exitCode,
    active: { hits: activeHits.length, groups: new Set(activeHits.map((h) => h.file + '\u0000' + h.term)).size },
    historical: { hits: histTotal, new: histNewN, kept: histKept, baselineFiles: Object.keys(histBase.files || {}).length, baselineGroups: histGroups, baselineHits: Object.values(histBase.files || {}).reduce((sx, t) => sx + Object.values(t).reduce((a, b) => a + b, 0), 0) },
    warnings: { files: new Set(warns.map((w) => w.file)).size, times: warns.length, detail: warns },
    summaries: out.filter((l) => l.startsWith('check-terms')),
  }))
} else {
  for (const l of out) console.log(l)
}
process.exit(exitCode)
