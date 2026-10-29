#!/usr/bin/env node
// constraint-index.mjs — 约束树索引器（P8a）。
// gen 重建 constraints/index.json；check 跑七条并逐字节比对；query 读索引过滤排序。
// --self-test 十四向量（夹具落 os.tmpdir()，finally 清理，不写技能仓）。
// frontmatter 子集解析自写（零新依赖）：仅支持任务书 §5.2 形态，其余一律带 file:line 报错。
// 退出码口径单源=references/06 §5.8（此处不复写映射）。
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SKILL_ROOT = resolve(SCRIPT_DIR, '..')
const BOOK_RE = /^0([1-7])-([a-z]+)\.md$/
const STEM_RE = /^0[1-7]-([a-z]+)$/
const ID_RE = /^C-[A-Z]{3}-\d{2}$/
const SLUGS = { context: 'CTX', verification: 'VER', architecture: 'ARC', collaboration: 'COL', documentation: 'DOC', environment: 'ENV', orchestration: 'ORC' }
const ROLES = new Set(['research', 'planner', 'assembler', 'executor', 'tbreview', 'planreview', 'implreview', 'adjudicator', 'vision'])
const PHASES = new Set(['design', 'implement', 'review', 'adjudicate', 'close'])
const SEVERITY = { blocking: 0, warning: 1, info: 2 }
const ENFORCEMENTS = new Set(['machine', 'review', 'checklist'])
const ROUTES = {
  fix: ['01-context', '02-verification', '03-architecture', '04-collaboration', '06-environment'], refactor: ['03-architecture', '02-verification', '01-context', '06-environment', '04-collaboration'], review: ['02-verification', '04-collaboration', '03-architecture', '05-documentation'],
  design: ['01-context', '03-architecture', '04-collaboration', '05-documentation'], doc: ['05-documentation', '01-context', '03-architecture'], data: ['02-verification', '03-architecture', '06-environment', '05-documentation'],
  env: ['06-environment', '07-orchestration', '02-verification'], orchestrate: ['07-orchestration', '04-collaboration', '01-context'], close: ['01-context', '02-verification', '03-architecture', '04-collaboration', '05-documentation', '06-environment', '07-orchestration'],
}
class UsageError extends Error {} class LoadError extends Error {}
export function arityError(cmd, argv) {
  if ((cmd === 'gen' || cmd === 'check' || cmd === '--self-test') && Array.isArray(argv) && argv.length > 1) return `${cmd} 不接受参数`
  return null
}
class ParseError extends Error { constructor(file, line, msg, id) { super(`${file}:${line} ${msg}`); this.file = file; this.line = line; this.id = id } }
const val = (raw, file, line, whole) => {
  const v = raw.trim()
  if (v === '') return ''
  if (v.startsWith('{')) throw new ParseError(file, line, `不支持流式对象：${whole}`)
  if (v.startsWith("'")) throw new ParseError(file, line, `不支持单引号值：${whole}`)
  if (/^[|>][+-]?$/.test(v)) throw new ParseError(file, line, `不支持块标量：${whole}`)
  if (/^[&*!]/.test(v)) throw new ParseError(file, line, `不支持锚点/别名/标签：${whole}`)
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) throw new ParseError(file, line, `行内数组未闭合：${whole}`)
    const body = v.slice(1, -1).trim()
    return body ? body.split(',').map((x) => val(x, file, line, whole)) : []
  }
  if (v.startsWith('"')) {
    if (v.length < 2 || !v.endsWith('"')) throw new ParseError(file, line, `双引号值未闭合：${whole}`)
    return v.slice(1, -1)
  }
  return v
}
// frontmatter 子集：key: value / 行内数组 / 块列表（含对象列表）；无法归类的行一律报错。
export function parseFrontmatter(lines, file) {
  const out = {}
  for (let i = 0; i < lines.length; i++) {
    const { text, no } = lines[i]
    if (/^\s*$/.test(text) || /^\s*#/.test(text)) continue
    if (/^[ \t]*\t/.test(text)) throw new ParseError(file, no, `不支持制表符缩进：${text}`)
    const km = /^([a-z]+):(.*)$/.exec(text)
    if (!km) throw new ParseError(file, no, `无法识别的行：${text}`)
    if (km[2].trim() !== '') { out[km[1]] = val(km[2], file, no, text); continue }
    const items = []; let last = null; let j = i + 1
    for (; j < lines.length; j++) {
      const t = lines[j].text
      if (/^\s*$/.test(t) || /^\s*#/.test(t)) continue
      if (/^[ \t]*\t/.test(t)) throw new ParseError(file, lines[j].no, `不支持制表符缩进：${t}`)
      const lm = /^\s*-\s+(.*)$/.exec(t)
      if (lm) {
        const body = lm[1].trim(), om = /^([a-z]+):(.*)$/.exec(body)
        if (om) { last = { [om[1]]: val(om[2], file, lines[j].no, t), __line: lines[j].no }; items.push(last) }
        else { last = null; items.push(val(body, file, lines[j].no, t)) }
        continue
      }
      const cm = /^\s{2,}([a-z]+):(.*)$/.exec(t)
      if (cm && last && typeof last === 'object' && !Array.isArray(last)) { last[cm[1]] = val(cm[2], file, lines[j].no, t); continue }
      break
    }
    out[km[1]] = items; i = j - 1
  }
  return out
}
// 卡片切分状态机（围栏感知）：H2 → 首个非空行 --- → 闭合 --- → 正文首行=规则句。
export function splitCards(text, file) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const starts = []; let fence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fence = !fence; continue }
    if (fence) continue
    const m = /^## (C-[A-Z]{3}-\d{2})\s+(\S.*)$/.exec(lines[i])
    if (m) starts.push({ id: m[1], title: m[2].trim(), idx: i, line: i + 1 })
  }
  const cards = []
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k], end = k + 1 < starts.length ? starts[k + 1].idx : lines.length
    let j = s.idx + 1
    while (j < end && lines[j].trim() === '') j++
    if (j >= end || lines[j].trim() !== '---') throw new ParseError(file, s.line, `卡 ${s.id} 起始后首个非空行不是 ---`, s.id)
    let close = -1
    for (let x = j + 1; x < end; x++) if (lines[x].trim() === '---') { close = x; break }
    if (close < 0) throw new ParseError(file, s.line, `卡 ${s.id} 缺少闭合 ---`, s.id)
    const fm = parseFrontmatter(lines.slice(j + 1, close).map((t, ix) => ({ text: t, no: j + ix + 2 })), file)
    if (fm.id !== s.id) throw new ParseError(file, s.line, `frontmatter id「${fm.id ?? ''}」与标题 ID「${s.id}」不一致`, s.id)
    if (String(fm.title ?? '').trim() !== s.title) throw new ParseError(file, s.line, `H2 标题「${s.title}」与 frontmatter title「${fm.title ?? ''}」不一致`, s.id)
    let b = close + 1
    while (b < end && lines[b].trim() === '') b++
    if (b >= end) throw new ParseError(file, s.line, `卡 ${s.id} 正文为空`, s.id)
    cards.push({ id: s.id, title: s.title, rule: lines[b].trim(), line: s.line, file, fm })
  }
  return cards
}
function cardFiles(root) {
  const dir = join(root, 'constraints')
  if (!existsSync(dir)) throw new LoadError(`卡片目录不存在：${dir}`)
  return readdirSync(dir).filter((f) => BOOK_RE.test(f)).sort()
}
export function loadCardsSafe(root) {
  const files = cardFiles(root), cards = [], findings = []
  for (const f of files) {
    const rel = `constraints/${f}`
    try { cards.push(...splitCards(readFileSync(join(root, 'constraints', f), 'utf8'), rel)) }
    catch (e) { if (e instanceof ParseError) findings.push({ check: 1, file: e.file, line: e.line, id: e.id || '?', msg: `解析失败：${e.message}` }); else throw e }
  }
  return { files, cards, findings }
}
const scalar = (v) => (v === undefined || v === '' ? null : v)
export function buildIndex(cards) {
  const sorted = [...cards].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))
  return {
    schemaVersion: 1,
    cards: sorted.map((c) => ({
      id: c.id, title: scalar(c.fm.title), category: scalar(c.fm.category),
      triggers: c.fm.triggers ?? [], paths: c.fm.paths ?? [], roles: c.fm.roles ?? [], phases: c.fm.phases ?? [],
      severity: scalar(c.fm.severity), enforcement: scalar(c.fm.enforcement), rule: c.rule, file: c.file, line: c.line,
    })),
    routes: ROUTES,
  }
}
export const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n'
// check 七条（编号固定）；每条 finding 带 file:line 与卡 ID。6(a) 面由 check#5 传递覆盖，不单独实现。
export function runChecks(root, files, cards, parseFindings) {
  const findings = [...parseFindings]
  const add = (check, c, msg, file, line, id) => findings.push({ check, file: file || c?.file || 'constraints', line: line ?? c?.line ?? 0, id: id || c?.id || '?', msg })
  for (const c of cards) {
    const fm = c.fm
    if (typeof fm.title !== 'string' || !fm.title.trim() || [...fm.title].length > 20) add(1, c, 'title 缺失、为空或超过 20 个码点')
    if (!Array.isArray(fm.triggers) || fm.triggers.length < 2 || fm.triggers.length > 5) add(1, c, 'triggers 须为 2–5 项')
    if (!Array.isArray(fm.roles) || !fm.roles.length || !fm.roles.every((r) => ROLES.has(r))) add(1, c, 'roles 须非空且每项属于既定枚举')
    if (!Array.isArray(fm.phases) || !fm.phases.length || !fm.phases.every((p) => PHASES.has(p))) add(1, c, 'phases 须非空且每项属于既定枚举')
    if (!Object.hasOwn(SEVERITY, fm.severity)) add(1, c, 'severity 须属于 blocking/warning/info')
    if (!ENFORCEMENTS.has(fm.enforcement)) add(1, c, 'enforcement 须属于 machine/review/checklist')
    if (!Array.isArray(fm.evidence) || !fm.evidence.length) add(1, c, 'evidence 至少 1 项')
    if (fm.enforcement === 'machine' && !(typeof fm.check === 'string' && fm.check.trim())) add(1, c, 'enforcement=machine 时 check 必须非空')
    const bookName = BOOK_RE.exec(c.file.split('/').pop())[2], slug = SLUGS[bookName]
    if (!ID_RE.test(c.id)) add(2, c, 'ID 格式不符')
    else if (c.id.slice(2, 5) !== slug) add(2, c, `ID ${c.id} 中段 ${c.id.slice(2, 5)} 与所在册「${c.file}」期望代号 ${slug} 不一致`)
    if (fm.category !== bookName.replace(/-/g, '')) add(3, c, `category「${fm.category ?? ''}」与所在册「${bookName}」不一致`)
  }
  const seen = new Map()
  for (const c of cards) { if (seen.has(c.id)) add(2, c, `ID 重复（另见 ${seen.get(c.id).file}:${seen.get(c.id).line}）`); else seen.set(c.id, c) }
  const per = new Map()
  for (const c of cards) per.set(c.file, (per.get(c.file) || 0) + 1)
  for (const [f, n] of per) if (n > 12) add(4, cards.find((c) => c.file === f), `册 ${f} 有 ${n} 张卡（上限 12）`)
  const idxPath = join(root, 'constraints', 'index.json')
  if (!existsSync(idxPath)) add(5, null, '索引文件不存在，请先跑 gen', 'constraints/index.json', 0)
  else {
    const actual = readFileSync(idxPath, 'utf8'), want = serialize(buildIndex(cards))
    if (actual !== want) {
      const a = actual.replace(/^\uFEFF/, '').split('\n'), b = want.split('\n')
      let d = 0
      while (d < a.length && d < b.length && a[d] === b[d]) d++
      add(5, null, `索引与卡片源不一致（首个差异在第 ${d + 1} 行），请跑 gen`, 'constraints/index.json', d + 1)
    }
  }
  const ids = new Set(cards.map((c) => c.id)), scan = readdirSync(join(root, 'constraints')).filter((f) => f.endsWith('.md')).sort().map((f) => `constraints/${f}`)
  for (const rel of scan) {
    const text = readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n').split('\n')
    text.forEach((ln, i) => { for (const m of ln.matchAll(/C-[A-Z]{3}-\d{2}/g)) if (!ids.has(m[0])) add(6, null, `token ${m[0]} 未解析到已定义 ID`, rel, i + 1) })
  }
  for (const c of cards) for (const ev of Array.isArray(c.fm.evidence) ? c.fm.evidence : []) {
    const ref = ev && typeof ev === 'object' ? ev.ref : ''
    if (typeof ref !== 'string') continue
    const m = /[A-Za-z0-9_.\-/]+\.(?:md|markdown)(?=$|[\s，。、；：！？（）()「」【】"'`])/.exec(ref)
    if (!m || !m[0].includes('/')) continue
    if (!existsSync(join(root, m[0]))) add(6, c, `evidence.ref 路径不存在：${m[0]}`, c.file, ev.__line ?? c.line)
  }
  for (const c of cards) {
    if (c.fm.severity !== 'blocking') continue
    const check = typeof c.fm.check === 'string' ? c.fm.check.trim() : ''
    if (!check) add(7, c, 'blocking 卡的 check 必须非空')
    else if (/^(?:todo|tbd|待定|待补|待填|占位|n\/a|—+|-+|\.{3}|…)$/i.test(check)) add(7, c, 'blocking 卡的 check 为占位')
    else if (c.fm.enforcement === 'machine' && !/(?:^|[\s;|&])(?:node|npm|pnpm|yarn|git|grep|cat|bash|sh|make|python3?|\.\/)|&&|\|\||判据|判定|须|必须|检查|确认/.test(check)) add(7, c, 'blocking+machine 卡的 check 须形似可执行命令或明确判据')
  }
  return findings
}
const segRe = (p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
export function globMatch(pattern, target) {
  const ps = pattern.split('/'), xs = target.split('/')
  const rec = (i, j) => {
    if (i === ps.length) return j === xs.length
    if (ps[i] === '**') return rec(i + 1, j) || (j < xs.length && rec(i, j + 1))
    return j < xs.length && segRe(ps[i]).test(xs[j]) && rec(i + 1, j + 1)
  }
  return rec(0, 0)
}
function parseQueryArgs(argv) {
  const flags = { paths: [], limit: 3 }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1]
    if (!a.startsWith('--')) throw new UsageError(`未知参数「${a}」`)
    if (v === undefined || v.startsWith('--')) throw new UsageError(`参数 ${a} 缺值`)
    i++
    if (a === '--task') flags.task = v
    else if (a === '--role') flags.role = v
    else if (a === '--phase') flags.phase = v
    else if (a === '--path') flags.paths.push(v)
    else if (a === '--desc') flags.desc = v
    else if (a === '--limit') flags.limitRaw = v
    else throw new UsageError(`未知参数「${a}」`)
  }
  if (!flags.task) throw new UsageError('query 缺少 --task')
  if (!Object.hasOwn(ROUTES, flags.task)) throw new UsageError(`未知任务类型「${flags.task}」`)
  if (flags.limitRaw !== undefined) {
    const n = Number(flags.limitRaw)
    if (!/^\d+$/.test(flags.limitRaw) || n < 1) throw new UsageError('--limit 须为正整数')
    if (n > 5 && flags.task !== 'close') throw new UsageError('--limit 不能大于 5')
    flags.limit = n
  }
  return flags
}
export function queryLines(root, o) {
  const idxPath = join(root, 'constraints', 'index.json')
  if (!existsSync(idxPath)) throw new LoadError('索引文件不存在：constraints/index.json（先跑 gen）')
  let doc
  try { doc = JSON.parse(readFileSync(idxPath, 'utf8')) } catch { throw new LoadError('索引文件不可解析：constraints/index.json') }
  if (!doc || doc.schemaVersion !== 1 || !Array.isArray(doc.cards) || !doc.routes || typeof doc.routes !== 'object') throw new LoadError('索引 schema 不符（schemaVersion/cards/routes）')
  const route = doc.routes[o.task]
  if (!Array.isArray(route)) throw new LoadError(`索引 routes 缺少任务类型 ${o.task}`)
  const cats = new Set(route.map((s) => STEM_RE.exec(s)?.[1]).filter((n) => n && SLUGS[n]))
  const candidates = doc.cards.filter((c) => cats.has(c.category))
  const afterClose = o.task === 'close' ? candidates.filter((c) => c.severity === 'blocking') : candidates
  const hit = afterClose.filter((c) => (!o.role || (c.roles || []).includes(o.role)) && (!o.phase || (c.phases || []).includes(o.phase)))
  const rows = hit.map((c) => ({ c, ph: o.paths.length ? (c.paths || []).filter((p) => o.paths.some((x) => globMatch(p, x))).length : 0, dh: o.desc ? (c.triggers || []).filter((t) => o.desc.includes(t)).length : 0 }))
  const bookOrder = (c) => route.indexOf(c.file.slice('constraints/'.length, -'.md'.length))
  rows.sort((x, y) => y.ph - x.ph || y.dh - x.dh || SEVERITY[x.c.severity] - SEVERITY[y.c.severity] || bookOrder(x.c) - bookOrder(y.c) || (x.c.id < y.c.id ? -1 : x.c.id > y.c.id ? 1 : 0))
  const out = o.task === 'close' ? rows : rows.slice(0, o.limit)
  return [`候选=${candidates.length} 命中=${hit.length} 输出=${out.length}`, 'ID ｜ 标题 ｜ 规则句 ｜ 执行方式 ｜ 位置',
    ...out.map(({ c }) => `${c.id} ｜ ${c.title} ｜ ${c.rule} ｜ ${c.enforcement} ｜ ${c.file}:${c.line}`)]
}
const CARD_HEAD = (id, title, cat, roles, phases, sev, enf, check, rule, extra = '') => `## ${id} ${title}\n\n---\nid: ${id}\ntitle: ${title}\ncategory: ${cat}\ntriggers: [开工, 基线]\n${extra}roles: [${roles}]\nphases: [${phases}]\nseverity: ${sev}\nenforcement: ${enf}\ncheck: ${check}\nevidence:\n  - project: Synapse\n    event: 事件\n    ref: 事故复盘 §1\n    date: 2026-08-21\n---\n\n${rule}\n`
function selfTest() {
  const cases = []
  const add = (name, ok, detail = '') => cases.push({ name, ok: !!ok, detail })
  const tmp = mkdtempSync(join(tmpdir(), 'constraint-index-'))
  try {
    const write = (rel, text) => writeFileSync(join(tmp, rel), text, 'utf8')
    mkdirSync(join(tmp, 'constraints'), { recursive: true })
    // 向量 1：解析器正例（含 evidence 对象列表）
    write('constraints/01-context.md', '# T\n\n' + CARD_HEAD('C-CTX-01', '基线先行', 'context', 'planner, executor', 'design, implement', 'blocking', 'checklist', '三项打勾', '先建基线再写代码。'))
    const one = loadCardsSafe(tmp).cards
    add('1 解析器正例：合法卡完整解析（含 evidence 对象列表）', one.length === 1 && one[0].id === 'C-CTX-01' && one[0].fm.title === '基线先行' && one[0].fm.evidence[0].project === 'Synapse' && one[0].fm.evidence[0].date === '2026-08-21' && one[0].line === 3 && one[0].rule === '先建基线再写代码。', JSON.stringify(one))
    // 向量 2：解析器负例（缺闭合 --- / 单引号值），消息带行号
    let e1 = null, e2 = null
    try { splitCards('## C-CTX-01 标题\n\n---\nid: C-CTX-01\ntitle: 标题\n', 'constraints/x.md') } catch (e) { e1 = e }
    try { splitCards(CARD_HEAD('C-CTX-01', '标题', 'context', 'planner', 'design', 'blocking', 'checklist', '打勾', '规则。').replace('title: 标题', "title: '标题'"), 'constraints/x.md') } catch (e) { e2 = e }
    add('2 解析器负例：缺闭合 --- 与单引号值均报错且消息含行号', e1 instanceof ParseError && /:\d+/.test(e1.message) && e2 instanceof ParseError && e2.message.includes(':5'), `${e1?.message} ｜ ${e2?.message}`)
    // 向量 3：check#2 负例（两册重复 ID + ID 中段与册不符）
    write('constraints/01-context.md', CARD_HEAD('C-CTX-01', '甲', 'context', 'planner', 'design', 'warning', 'checklist', '打勾', '规则甲。'))
    write('constraints/02-verification.md', CARD_HEAD('C-CTX-01', '乙', 'verification', 'planner', 'review', 'warning', 'checklist', '打勾', '规则乙。'))
    write('constraints/03-architecture.md', CARD_HEAD('C-VER-09', '丁', 'architecture', 'planner', 'review', 'warning', 'checklist', '打勾', '规则丁。'))
    let safe = loadCardsSafe(tmp), f3 = runChecks(tmp, safe.files, safe.cards, safe.findings)
    add('3 check#2 负例：两册重复 ID 与 ID 中段与册不符均判 FAIL', f3.some((f) => f.check === 2 && f.msg.includes('ID 重复')) && f3.some((f) => f.check === 2 && f.msg.includes('期望代号 ARC') && f.msg.includes('VER')), JSON.stringify(f3))
    // 向量 4：check#3 负例（category 与册名不一致）
    write('constraints/02-verification.md', CARD_HEAD('C-CTX-02', '丙', 'context', 'planner', 'review', 'warning', 'checklist', '打勾', '规则丙。'))
    safe = loadCardsSafe(tmp), f3 = runChecks(tmp, safe.files, safe.cards, safe.findings)
    add('4 check#3 负例：category 与册名不一致判 FAIL', f3.some((f) => f.check === 3), JSON.stringify(f3))
    // 共享正例夹具：两册三卡（B2 批 D-8：夹具审核键 reviewer→implreview 与 ROLES 同步）
    write('constraints/01-context.md', '# T\n\n' + CARD_HEAD('C-CTX-01', '甲', 'context', 'planner, executor', 'design', 'blocking', 'checklist', '打勾', '规则甲。') + '\n' + CARD_HEAD('C-CTX-02', '乙', 'context', 'implreview', 'review', 'warning', 'checklist', '打勾', '规则乙。')); rmSync(join(tmp, 'constraints', '03-architecture.md'))
    write('constraints/02-verification.md', '# T\n\n' + CARD_HEAD('C-VER-01', '丙', 'verification', 'implreview', 'review', 'warning', 'checklist', '打勾', '规则丙。'))
    const genIdx = () => write('constraints/index.json', serialize(buildIndex(loadCardsSafe(tmp).cards)))
    // 向量 5：check#5 正例（gen 后通过）与反例（手改一字节后 FAIL）
    genIdx()
    safe = loadCardsSafe(tmp)
    const ok5 = runChecks(tmp, safe.files, safe.cards, safe.findings).length === 0
    write('constraints/index.json', readFileSync(join(tmp, 'constraints', 'index.json'), 'utf8').replace('"schemaVersion": 1', '"schemaVersion": 2'))
    safe = loadCardsSafe(tmp)
    const bad5 = runChecks(tmp, safe.files, safe.cards, safe.findings).some((f) => f.check === 5)
    add('5 check#5 正例与反例：gen 后 check 通过；手改一字节后 FAIL', ok5 && bad5, `正例=${ok5} 反例=${bad5}`)
    // 向量 6：query 过滤负例（executor 过滤生效；无命中角色输出=0）
    genIdx()
    const all6 = queryLines(tmp, { task: 'doc', paths: [], limit: 3 }), one6 = queryLines(tmp, { task: 'doc', role: 'executor', paths: [], limit: 3 }), none6 = queryLines(tmp, { task: 'doc', role: 'vision', paths: [], limit: 3 })
    add('6 query 过滤负例：--role executor 输出由 2 降到 1 且命中含 executor 的卡；无命中角色输出=0',
      all6[0] === '候选=2 命中=2 输出=2' && one6[0] === '候选=2 命中=1 输出=1' && one6.length === 3 && one6[2].includes('C-CTX-01') && none6[0] === '候选=2 命中=0 输出=0' && none6.length === 2,
      JSON.stringify([all6[0], one6[0], none6[0]]))
    // 向量 7–13：check#4 册上限、check#1 字段子分支（缺必填/title/triggers/枚举/evidence）、多余参数
    const vroot = (text) => { const r = mkdtempSync(join(tmp, 'v-')); mkdirSync(join(r, 'constraints')); writeFileSync(join(r, 'constraints', '01-context.md'), text, 'utf8'); const x = loadCardsSafe(r); return runChecks(r, x.files, x.cards, x.findings) }
    const card7 = (title = '甲') => CARD_HEAD('C-CTX-01', title, 'context', 'planner', 'design', 'warning', 'checklist', '打勾', '规则甲。')
    const base7 = card7(), n1 = (text, n = 1) => vroot(text).filter((f) => f.check === n).length
    const drop = (k) => base7.replace(new RegExp(`^${k}:.*\\n`, 'm'), ''), set = (a, b) => base7.replace(a, b)
    const many = (n) => Array.from({ length: n }, (_, i) => CARD_HEAD(`C-CTX-${String(i + 1).padStart(2, '0')}`, `卡${i + 1}`, 'context', 'planner', 'design', 'warning', 'checklist', '打勾', '规则。')).join('\n')
    add('7 check#4 册上限：13 张判 FAIL、12 张不报', n1(many(13), 4) === 1 && n1(many(12), 4) === 0)
    add('8 缺必填：roles/phases/severity 各缺一条各报 check#1', n1(drop('roles')) === 1 && n1(drop('phases')) === 1 && n1(drop('severity')) === 1)
    add('9 title 超长：21 码点判 FAIL、20 码点不报', n1(card7('甲'.repeat(21))) === 1 && n1(card7('甲'.repeat(20))) === 0)
    add('10 triggers 越界：1 项与 6 项各判 FAIL、2 项不报', n1(set('triggers: [开工, 基线]', 'triggers: [开工]')) === 1 && n1(set('triggers: [开工, 基线]', 'triggers: [开工, 基线, 甲, 乙, 丙, 丁]')) === 1 && n1(base7) === 0)
    add('11 枚举非法：roles/phases/severity/enforcement 各报 check#1', [['roles: [planner]', 'roles: [wizard]'], ['phases: [design]', 'phases: [launch]'], ['severity: warning', 'severity: critical'], ['enforcement: checklist', 'enforcement: auto']].every(([a, b]) => n1(set(a, b)) === 1))
    add('12 evidence 为空：数组空判 FAIL、完整卡不报', n1(base7.replace(/^evidence:\n(?: {2,}.*\n)+/m, 'evidence: []\n')) === 1 && n1(base7) === 0)
    add('13 多余参数：arityError 判定 + 子进程 check 带多余参数报用法错', arityError('--self-test', ['--self-test', 'foo']) === '--self-test 不接受参数' && arityError('gen', ['gen', 'x']) === 'gen 不接受参数' && arityError('query', ['query', '--task', 'fix']) === null && spawnSync(process.execPath, [process.argv[1], 'check', 'x'], { encoding: 'utf8' }).status === 1)
    // 向量 14：排序平局决胜键序（路由册序）——刻意不带 role 过滤以保全 blocking 卡在候选内（有意设计非遗漏）
    const ids14 = queryLines(tmp, { task: 'refactor', paths: [], limit: 3 }).map((l) => l.split(' ｜ ')[0])
    add('14 排序键序：refactor 前三=C-CTX-01→C-VER-01→C-CTX-02（blocking 绝对优先；同 severity 平局按路由册序 02-verification 先于 01-context 决胜、与卡 ID 字典序反序，证伪旧键序）——刻意不带 role 过滤以保全 blocking 卡在候选内',
      ids14[0] === '候选=3 命中=3 输出=3' && ids14[2] === 'C-CTX-01' && ids14[3] === 'C-VER-01' && ids14[4] === 'C-CTX-02',
      JSON.stringify(ids14.slice(0, 5)))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  const fail = cases.filter((c) => !c.ok).length
  return { cases, fail }
}

function usage() { console.error('用法：node scripts/constraint-index.mjs gen|check|query --task <类型> [--role <角色>] [--phase <阶段>] [--path <路径>]... [--desc <文本>] [--limit <n>] | --self-test') }

function main() {
  const argv = process.argv.slice(2), cmd = argv[0]
  try {
    const arity = arityError(cmd, argv)
    if (arity) throw new UsageError(arity)
    if (cmd === '--self-test') {
      const { cases, fail } = selfTest()
      for (const c of cases) if (!c.ok) console.log(`[self-test] FAIL ${c.name}${c.detail ? `（${c.detail}）` : ''}`)
      console.log(fail === 0 ? `self-test 全过（${cases.length} 向量）` : `[self-test] FAIL ×${fail}`)
      process.exit(fail === 0 ? 0 : 1)
    }
    if (cmd === 'gen') {
      const { files, cards, findings } = loadCardsSafe(SKILL_ROOT)
      if (findings.length) { for (const f of findings) console.error(`[FAIL] check#${f.check} ${f.file}:${f.line} ${f.id} ${f.msg}`); process.exit(1) }
      writeFileSync(join(SKILL_ROOT, 'constraints', 'index.json'), serialize(buildIndex(cards)), 'utf8')
      console.log(`index.json 就绪：${cards.length} 张卡 / ${files.length} 册`)
      process.exit(0)
    }
    if (cmd === 'check') {
      const { files, cards, findings } = loadCardsSafe(SKILL_ROOT)
      const all = runChecks(SKILL_ROOT, files, cards, findings)
      for (const f of all) console.error(`[FAIL] check#${f.check} ${f.file}:${f.line} 卡 ${f.id} — ${f.msg}`)
      console.log(`check 汇总：FAIL ×${all.length}（册=${files.length} 卡=${cards.length}）`)
      process.exit(all.length ? 1 : 0)
    }
    if (cmd === 'query') { console.log(queryLines(SKILL_ROOT, parseQueryArgs(argv)).join('\n')); process.exit(0) }
    throw new UsageError(cmd ? `未知子命令「${cmd}」` : '缺少子命令')
  } catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); usage(); process.exit(1) }
    if (e instanceof LoadError) { console.error(`[装载错] ${e.message}`); process.exit(3) }
    throw e
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
