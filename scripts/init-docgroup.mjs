#!/usr/bin/env node
/**
 * 新项目文档群初始化脚手架（ai-dev-org·W10 批）——一条命令铺设新项目文档群底座：
 *   机读索引 docs/doc-index.json（docgroup-index/v1）＋分诊规则件 docs/doc-triage.md
 *   ＋新文档模板 docs/templates/document.md＋evidence/ 三子目录骨架（references/08 §8.4·c-4）。
 * 用法：
 *   node scripts/init-docgroup.mjs --target <项目根> [--write]
 *   node scripts/init-docgroup.mjs --self-test
 * 缺省即 dry-run（零写入）；只有 --write 才落盘；存在即 [SKIP] 逐字节不覆盖；重跑幂等
 *   （written 可收敛为 0）。逐件 createIfAbsent 独立、无跨件事务：任一件写入失败即停，
 *   已建成件保留，重跑只补缺失件。
 * 分诊只登记不搬迁：路径规则决定唯一类别与登记元数据；未知或同优先级歧义文档停留
 *   pending_triage 待人工分诊，全程无 mv/rename/unlink。
 * 防线（B-1 三面）：--target 以真实路径比较技能根（realpath 两侧，别名链不得绕过）；
 *   逐件写入路径按父链 realpath 做 containment 断言（target 内 symlink 越出真实根=装载错拒写）；
 *   叶子 symlink（含断裂）按已存在 SKIP，绝不写穿。
 * 输入侧失败语义（轮 2 细分·承接 D-1）：①扫描 target 文档树读失败=3；②模板装载失败=3；
 *   ③既有目标索引一律 SKIP、内容不作门禁——读取仅作 pending 汇总、best-effort 不阻断
 *   （任一步失败打一行 [SKIP] 汇总不可用后继续，汇总回退本次构建计数；篡改检出面=self-test ⑱，
 *   §7「pending target 偏离即校验失败」=可观察性条件而非 CLI 门禁授权）；④本次生成件写入失败=3。
 * 索引校验（validateIndex）以 export 供独立进程复用：self-test ⑮-⑱ 以
 *   `node --input-type=module -e` 经 file:// 导入本件，按 finding 映射退出码（pass 形=0/fail 形=1）。
 * 退出码口径单源=references/06 §5.8（此处不复写映射）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, mkdtempSync, rmSync, chmodSync, realpathSync, lstatSync, copyFileSync } from 'node:fs'
import { join, resolve, dirname, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SKILL_ROOT, cliFlag, UsageError } from './org-config.mjs'

// ── 常量（schema/枚举单源）──
const INDEX_SCHEMA = 'docgroup-index/v1'
const FIXTURE_SCHEMA = 'docgroup-fixture/v1'
const OWNER_INIT = 'docgroup-init'
const CATEGORIES = ['project-constitution', 'changelog', 'adr', 'product-spec', 'product-manual', 'doc-template', 'taskbook', 'handoff', 'close', 'session-log', 'evidence', 'triage-rule', 'doc-index']
const AUTHORITIES = ['project-constitution', 'project-adr', 'product-document', 'historical-record', 'task-record', 'doc-template', 'triage-rule', 'doc-index', 'evidence-record']
const STATUSES = ['registered', 'active', 'superseded']
const RECORD_KEYS = ['path', 'category', 'target', 'owner', 'status', 'authority', 'supersedes', 'index']

// 精确规则（路径全等）——三条内置自记录，target==path、owner=docgroup-init、status=registered
const EXACT_RULES = new Map([
  ['docs/doc-index.json', 'doc-index'],
  ['docs/doc-triage.md', 'triage-rule'],
  ['docs/templates/document.md', 'doc-template'],
])
// 文件名规则（任意目录层命中，按命中键长度参与最长唯一前缀竞争）
const BASENAME_RULES = new Map([
  ['AGENTS.md', 'project-constitution'],
  ['CHANGELOG.md', 'changelog'],
])
// 目录前缀规则（段对齐：path===prefix 或 path 以 prefix/ 起）
const PREFIX_RULES = [
  ['docs/adr', 'adr'],
  ['docs/spec', 'product-spec'],
  ['docs/manual', 'product-manual'],
  ['docs/templates', 'doc-template'],
  ['docs/tasks', 'taskbook'],
  ['evidence/handoffs', 'handoff'],
  ['evidence/close', 'close'],
  ['evidence/session-logs', 'session-log'],
  ['evidence', 'evidence'],
]
const AUTHORITY_BY_CATEGORY = {
  'project-constitution': 'project-constitution',
  changelog: 'product-document',
  adr: 'project-adr',
  'product-spec': 'product-document',
  'product-manual': 'product-document',
  'doc-template': 'doc-template',
  taskbook: 'task-record',
  handoff: 'evidence-record',
  close: 'evidence-record',
  'session-log': 'evidence-record',
  evidence: 'evidence-record',
  'triage-rule': 'triage-rule',
  'doc-index': 'doc-index',
}

const byteCompare = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))

/** 装载错（06 §5.8 行 3 族）：模板/必需输入缺失或形态错。 */
class ConfigError extends Error {
  constructor(m) { super(m); this.name = 'ConfigError'; this.kind = 'config' }
}

/** 输入 I/O 读失败单源判定（W-5 fail-closed）：扫描/装载/索引读取期间的文件系统错误
 *  一律收敛装载错族；内容/形态问题走 RED 检出（06 §5.8 行 1），二者不混。 */
const IO_CODES = new Set(['EACCES', 'EPERM', 'ENOENT', 'EIO', 'EISDIR', 'ENOTDIR', 'ELOOP', 'EMFILE', 'ENFILE', 'ENAMETOOLONG'])
const isIoError = (e) => !!(e && typeof e === 'object' && typeof e.code === 'string' && IO_CODES.has(e.code))

/** 写入 containment（B-1②）：沿待写相对路径逐段 realpath，任一段解析出真实路径越出
 *  目标真实根（含 symlink 指向仓外）即 ConfigError；余段不存在则其后无 symlink 可绕。 */
function assertWriteContained(rootReal, rel) {
  let cur = rootReal
  const parts = rel.split('/')
  for (let i = 0; i < parts.length; i++) {
    const next = join(cur, parts[i])
    let rp = null
    try { rp = realpathSync(next) } catch (e) {
      if (e && e.code === 'ENOENT') return
      if (isIoError(e)) throw new ConfigError(`写入路径解析失败: ${rel}（${e.message}）`)
      throw e
    }
    const inside = relative(rootReal, rp)
    if (inside === '' || inside === '..' || inside.startsWith('../') || isAbsolute(inside)) throw new ConfigError(`写入路径越出目标真实根（symlink 越界）: ${rel} → ${rp}`)
    cur = rp
  }
}

/** 模板装载：三源齐备且索引模板形态合法；任一缺失/不可读/不可解析=ConfigError。 */
function loadTemplates(tplDir) {
  const need = (f) => {
    const p = join(tplDir, f)
    if (!existsSync(p)) throw new ConfigError(`技能模板缺失: ${f}（目录 ${tplDir}）`)
    return p
  }
  let idx = null
  try { idx = JSON.parse(readFileSync(need('docgroup-index.json'), 'utf8')) } catch (e) { if (e instanceof ConfigError) throw e; throw new ConfigError(`技能模板不可解析: docgroup-index.json（${e.message}）`) }
  if (idx === null || typeof idx !== 'object' || Array.isArray(idx) || idx.schema !== INDEX_SCHEMA || !Array.isArray(idx.documents) || !Array.isArray(idx.pending_triage)) throw new ConfigError(`技能模板形态错: docgroup-index.json（须 schema=${INDEX_SCHEMA}＋documents/pending_triage 数组）`)
  const readMd = (f) => { try { return readFileSync(need(f), 'utf8') } catch (e) { if (e instanceof ConfigError) throw e; throw new ConfigError(`技能模板不可读: ${f}（${e.message}）`) } }
  return { indexSchema: idx.schema, triageMd: readMd('docgroup-triage.md'), documentMd: readMd('docgroup-document.md') }
}

/** 递归扫描目标根 *.md（POSIX 相对路径）；跳过 .git/node_modules 与符号链接。 */
function scanMarkdown(root) {
  const out = []
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory() && !e.isSymbolicLink()) walk(join(d, e.name), r)
      else if (e.isFile() && e.name.endsWith('.md')) out.push(r)
    }
  }
  walk(root, '')
  return out
}

/** 单路径分诊：精确规则优先；否则文件名规则与目录前缀规则同优先级按命中键长度取
 *  最长唯一命中——同长度多命中或无命中=unknown（停留待分诊）。 */
function triagePath(path, exactRules = EXACT_RULES, basenameRules = BASENAME_RULES, prefixRules = PREFIX_RULES) {
  const ex = exactRules.get(path)
  if (ex !== undefined) return { known: true, category: ex }
  const hits = []
  const base = basenameRules.get(path.split('/').pop())
  if (base !== undefined) hits.push([path.split('/').pop().length, base])
  for (const [p, c] of prefixRules) if (path === p || path.startsWith(p + '/')) hits.push([p.length, c])
  if (hits.length === 0) return { known: false, reason: 'no-hit' }
  const maxLen = Math.max(...hits.map((h) => h[0]))
  const top = hits.filter((h) => h[0] === maxLen)
  if (top.length !== 1) return { known: false, reason: 'ambiguous' }
  return { known: true, category: top[0][1] }
}

const knownRecord = (p, category) => ({ path: p, category, target: p, owner: OWNER_INIT, status: 'registered', authority: AUTHORITY_BY_CATEGORY[category], supersedes: null })
const pendingRecord = (p) => ({ path: p, category: 'unknown', target: p, owner: 'unassigned', status: 'pending-triage', authority: 'unresolved', supersedes: null })

/** 组索引：三条自记录恒在且已分诊；其余扫描件按分诊落 documents/pending_triage；
 *  两数组按 path 的 UTF-8 字节序排列；index=回指自身 JSON Pointer（后置赋值）。 */
function buildIndex(mdPaths, schema) {
  const documents = []
  const pending = []
  const seen = new Set()
  for (const [p, cat] of EXACT_RULES) { documents.push(knownRecord(p, cat)); seen.add(p) }
  for (const p of mdPaths) {
    if (seen.has(p)) continue
    seen.add(p)
    const t = triagePath(p)
    if (t.known) documents.push(knownRecord(p, t.category))
    else pending.push(pendingRecord(p))
  }
  documents.sort((a, b) => byteCompare(a.path, b.path))
  pending.sort((a, b) => byteCompare(a.path, b.path))
  documents.forEach((r, i) => { r.index = `/documents/${i}` })
  pending.forEach((r, i) => { r.index = `/pending_triage/${i}` })
  return { schema, documents, pending_triage: pending }
}

const renderIndex = (index) => JSON.stringify(index, null, 2) + '\n'

/** 索引结构校验（fixture 判定与 V-2 断言共用单源；export 供 self-test ⑮-⑱ 以独立进程导入复用）：返回 finding 数组（空=合法）。 */
export function validateIndex(index) {
  const f = []
  if (index === null || typeof index !== 'object' || Array.isArray(index)) return ['bad-schema']
  if (Object.keys(index).sort().join(',') !== ['documents', 'pending_triage', 'schema'].join(',')) f.push('bad-topology')
  if (index.schema !== INDEX_SCHEMA) f.push('bad-schema')
  if (!Array.isArray(index.documents) || !Array.isArray(index.pending_triage)) return f.concat(['bad-topology'])
  const seen = new Map()
  const checkPath = (r, f) => {
    if (typeof r.path !== 'string' || !r.path || r.path.startsWith('/') || r.path.includes('\\') || r.path.split('/').includes('..')) f.push('bad-path')
    if (seen.get(r.path) !== undefined) f.push('duplicate-path')
  }
  index.documents.forEach((r, i) => {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) { f.push('bad-record'); return }
    for (const k of RECORD_KEYS) if (!(k in r)) f.push(`missing-${k}`)
    for (const k of Object.keys(r)) if (!RECORD_KEYS.includes(k)) f.push('extra-record-key')
    if ('path' in r) { checkPath(r, f); seen.set(r.path, 'documents') }
    if ('category' in r && !CATEGORIES.includes(r.category)) f.push('bad-category')
    if ('owner' in r && (typeof r.owner !== 'string' || !r.owner || r.owner === 'unassigned')) f.push('bad-owner')
    if ('status' in r && !STATUSES.includes(r.status)) f.push('bad-status')
    if ('authority' in r && !AUTHORITIES.includes(r.authority)) f.push('bad-authority')
    if ('supersedes' in r && !(r.supersedes === null || typeof r.supersedes === 'string')) f.push('bad-supersedes')
    if ('target' in r && (typeof r.target !== 'string' || !r.target)) f.push('bad-target')
    if ('index' in r && r.index !== `/documents/${i}`) f.push('bad-index-pointer')
  })
  index.pending_triage.forEach((r, i) => {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) { f.push('bad-record'); return }
    for (const k of RECORD_KEYS) if (!(k in r)) f.push(`missing-${k}`)
    for (const k of Object.keys(r)) if (!RECORD_KEYS.includes(k)) f.push('extra-record-key')
    if ('path' in r) { checkPath(r, f); seen.set(r.path, 'pending_triage') }
    if ('category' in r && r.category !== 'unknown') f.push('bad-pending-shape')
    if ('owner' in r && r.owner !== 'unassigned') f.push('bad-pending-shape')
    if ('status' in r && r.status !== 'pending-triage') f.push('bad-pending-shape')
    if ('authority' in r && r.authority !== 'unresolved') f.push('bad-pending-shape')
    if ('supersedes' in r && r.supersedes !== null) f.push('bad-pending-shape')
    if ('target' in r && typeof r.target === 'string' && r.target && 'path' in r && typeof r.path === 'string' && r.path && r.target !== r.path) f.push('pending-target-moved')
    if ('target' in r && (typeof r.target !== 'string' || !r.target)) f.push('bad-target')
    if ('index' in r && r.index !== `/pending_triage/${i}`) f.push('bad-index-pointer')
  })
  for (const arr of [index.documents, index.pending_triage]) {
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1], b = arr[i]
      if (a && b && typeof a.path === 'string' && typeof b.path === 'string' && byteCompare(a.path, b.path) >= 0) { f.push('path-order'); break }
    }
  }
  return f
}

// ── CLI 入口（仅作为主模块运行时执行；被 `node --input-type=module -e` 以 file:// 导入
//    复用 validateIndex 时不触发——⑮-⑱ 真进程承载的前提。守卫两侧 realpath 比较：
//    经 symlink 别名调用脚本时 import.meta.url（真实路径）与 argv[1]（原样路径）字面不等，
//    须确定性放行而非静默跳过 CLI。块内不重排缩进=最小 diff）──
const isMainModule = (() => { try { return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1])) } catch { return false } })()
if (isMainModule) {
const argv = process.argv.slice(2)
const usageError = (m) => { console.error(`[用法错] ${m}`); process.exit(1) }
const configError = (m) => { console.error(`[装载错] ${m}`); process.exit(3) }
const KNOWN_FLAGS = new Set(['--target', '--write', '--self-test'])
let target = null
try { target = cliFlag(argv, '--target') } catch (e) { if (e instanceof UsageError) usageError(e.message); throw e }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--target') { i++; continue } // --target 的值已由 cliFlag 三校验承接
  if (!a.startsWith('--')) usageError(`多余位置参数「${a}」`)
  if (!KNOWN_FLAGS.has(a)) usageError(`未知旗标「${a}」（可用：--target/--write/--self-test）`)
}
if (argv.includes('--self-test')) {
  if (argv.length !== 1) usageError('--self-test 独占运行（与其他参数并存均为用法错）')
  selfTest()
  process.exit(0) // 不可达——selfTest 内部必退
}
const write = argv.includes('--write')
if (!target) usageError('未给 --target（node scripts/init-docgroup.mjs --target <项目根> [--write]｜--self-test）')

const dir = resolve(target)
let st = null
try { st = statSync(dir) } catch { configError(`--target 目录不存在或不可达: ${dir}`) }
if (!st.isDirectory()) configError(`--target 不是目录: ${dir}`)
// B-1①：防呆用真实路径比较——--target 经任意层 symlink 别名解析到技能根同样拒（零写入）
let dirReal = null
let skillReal = null
try { dirReal = realpathSync(dir) } catch (e) { if (isIoError(e)) configError(`--target 真实路径解析失败: ${dir}`); throw e }
try { skillReal = realpathSync(SKILL_ROOT) } catch (e) { if (isIoError(e)) configError(`技能根真实路径解析失败: ${SKILL_ROOT}`); throw e }
if (dirReal === skillReal) configError(`--target 指向技能根本身（防呆·真实路径比较）: ${dir} → ${dirReal}`)
let templates = null
try { templates = loadTemplates(join(SKILL_ROOT, 'templates')) } catch (e) { if (e instanceof ConfigError) configError(e.message); throw e }
let mdPaths = null
try { mdPaths = scanMarkdown(dir) } catch (e) { if (isIoError(e)) configError(`--target 目录不可读: ${dir}（${e.code}）`); throw e }
const index = buildIndex(mdPaths, templates.indexSchema)
// 既有目标索引＝不可触碰面（轮 2 B-1 主控裁决＝纯 SKIP 语义）：一律 SKIP、内容不作门禁。
//   读取仅作 pending 汇总、best-effort 不阻断：读/解析/校验任一步失败打一行 [SKIP] 汇总不可用后继续，
//   汇总回退本次构建计数；篡改检出面=self-test ⑱（§7 该句=可观察性条件非 CLI 门禁授权）。
let pendingReport = index.pending_triage.length
let pendingNote = '' // 既有索引不可用时显式区分：汇总=构建计数·非磁盘实数
const existingIdxPath = join(dir, 'docs/doc-index.json')
if (existsSync(existingIdxPath)) {
  try {
    const parsed = JSON.parse(readFileSync(existingIdxPath, 'utf8'))
    const findings = validateIndex(parsed)
    if (findings.length) throw new Error(`index-findings:${findings.join(',').slice(0, 80)}`)
    pendingReport = parsed.pending_triage.length
  } catch (e) {
    console.log(`[SKIP] 目标索引汇总不可用（不阻断·继续）: docs/doc-index.json（${e && e.message ? e.message : e}）`)
    pendingNote = '（既有索引不可用·构建计数·非磁盘实数）'
  }
}
const files = [
  { rel: 'docs/doc-index.json', content: renderIndex(index) },
  { rel: 'docs/doc-triage.md', content: templates.triageMd },
  { rel: 'docs/templates/document.md', content: templates.documentMd },
  { rel: 'evidence/handoffs/.gitkeep', content: '' },
  { rel: 'evidence/close/.gitkeep', content: '' },
  { rel: 'evidence/session-logs/.gitkeep', content: '' },
]
console.log(`mode=${write ? 'write' : 'dry-run（缺省零写入）'} target=${dir}`)
let written = 0
for (const f of files) {
  const abs = join(dir, f.rel)
  let leafExists = false
  try { lstatSync(abs); leafExists = true } catch { /* 不存在→可建 */ }
  if (leafExists) { console.log(`[SKIP] ${f.rel}（已存在，不覆盖）`); continue } // B-1③：lstat 命中含 symlink（断裂亦然）——按已存在处理，绝不写穿
  try { assertWriteContained(dirReal, f.rel) } catch (e) { if (e instanceof ConfigError) configError(e.message); throw e } // B-1②：dry-run 同样执法（拒写先于任何落盘）
  if (!write) { console.log(`[PLAN] ${f.rel}`); continue }
  try { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, f.content, 'utf8') } catch (e) { console.error(`FAIL 写入失败: ${f.rel}（${e.message}）`); process.exit(3) }
  console.log(`[OK] ${f.rel}`)
  written++
}
console.log(`pending=${pendingReport}${pendingNote} written=${written}${write ? '' : '（dry-run 零写入）'}`)
process.exit(0)
} // CLI 入口守卫结束

/** self-test：恰 18 具名向量；临时树全部 /tmp/w10-docgroup-selftest-*，用毕清理。 */
function selfTest() {
  let fails = 0
  let n = 0
  const t = (name, cond) => { n++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) fails++ }
  const SELF = fileURLToPath(import.meta.url)
  const run = (args) => spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8' })
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
  const snapshot = (root) => {
    const out = []
    const walk = (d, rel) => {
      for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) walk(join(d, e.name), r)
        else if (e.isFile()) out.push({ rel: r, sha: sha(join(d, e.name)) })
      }
    }
    walk(root, '')
    return out
  }
  const fxRoot = mkdtempSync(join(tmpdir(), 'w10-docgroup-selftest-'))
  try {
    const SIX = ['docs/doc-index.json', 'docs/doc-triage.md', 'docs/templates/document.md', 'evidence/handoffs/.gitkeep', 'evidence/close/.gitkeep', 'evidence/session-logs/.gitkeep']
    // ① 缺省 dry-run 零写入＋两次计划逐字节一致
    {
      const d = join(fxRoot, 'v1'); mkdirSync(d)
      const before = JSON.stringify(snapshot(d))
      const r1 = run(['--target', d])
      const after = JSON.stringify(snapshot(d))
      const r2 = run(['--target', d])
      t('① 缺省零写入（mode=dry-run/written=0/前后快照逐字节同/两次计划逐字节一致）', r1.status === 0 && r2.status === 0 && before === after && after === '[]' && r1.stdout.includes('mode=dry-run') && r1.stdout.includes('written=0') && r1.stdout === r2.stdout)
    }
    // ② --write 恰建六文件
    {
      const d = join(fxRoot, 'v2'); mkdirSync(d)
      const r = run(['--target', d, '--write'])
      const snap = snapshot(d)
      t('② --write 六文件（exit=0/written=6/文件集恰六件/pending=0）', r.status === 0 && r.stdout.includes('written=6') && r.stdout.includes('pending=0') && SIX.every((p) => existsSync(join(d, p))) && snap.length === 6 && snap.every((x) => SIX.includes(x.rel)))
    }
    // ③ 存在不覆盖（哨兵保留＋全树哈希不变；自建前置目录保证红态可完整跑完）
    {
      const d = join(fxRoot, 'v2')
      mkdirSync(join(d, 'docs'), { recursive: true })
      writeFileSync(join(d, 'docs', 'doc-triage.md'), 'SENTINEL-STAY\n')
      const before = JSON.stringify(snapshot(d))
      const r = run(['--target', d, '--write'])
      const after = JSON.stringify(snapshot(d))
      t('③ 存在不覆盖（哨兵保留/全树哈希不变/SKIP 该件/written=0）', r.status === 0 && readFileSync(join(d, 'docs', 'doc-triage.md'), 'utf8') === 'SENTINEL-STAY\n' && before === after && r.stdout.includes('[SKIP] docs/doc-triage.md') && r.stdout.includes('written=0'))
    }
    // ④ 重跑零写入（幂等）
    {
      const r = run(['--target', join(fxRoot, 'v2'), '--write'])
      t('④ 重跑零写入（六件全 SKIP）', r.status === 0 && r.stdout.includes('written=0') && (r.stdout.match(/\[SKIP\]/g) || []).length === 6)
    }
    // ⑤ known 六字段组＋唯一类别（v2 生成索引）
    {
      const d = join(fxRoot, 'v2')
      const idxPath = join(d, 'docs', 'doc-index.json')
      let ok = false
      if (existsSync(idxPath)) {
        const idx = JSON.parse(readFileSync(idxPath, 'utf8'))
        ok = idx.schema === 'docgroup-index/v1' && Array.isArray(idx.documents) && idx.documents.every((r) => RECORD_KEYS.every((k) => k in r) && Object.keys(r).length === RECORD_KEYS.length && CATEGORIES.includes(r.category) && typeof r.owner === 'string' && r.owner && r.owner !== 'unassigned' && STATUSES.includes(r.status) && AUTHORITIES.includes(r.authority) && (r.supersedes === null || typeof r.supersedes === 'string') && typeof r.target === 'string' && !!r.target && typeof r.index === 'string') && validateIndex(idx).length === 0
      }
      t('⑤ known 六字段组与唯一类别（八键/枚举/validateIndex 零 finding）', ok)
    }
    // ⑥ unknown 原地停留 pending（八键全值＋原文哈希不变）
    {
      const d = join(fxRoot, 'v6'); mkdirSync(d)
      writeFileSync(join(d, 'NOTES-unknown.md'), 'keep me untouched\n')
      const h0 = sha(join(d, 'NOTES-unknown.md'))
      const r = run(['--target', d, '--write'])
      let ok = false
      const idxPath = join(d, 'docs', 'doc-index.json')
      if (r.status === 0 && existsSync(idxPath)) {
        const idx = JSON.parse(readFileSync(idxPath, 'utf8'))
        const i = idx.pending_triage.findIndex((x) => x.path === 'NOTES-unknown.md')
        const p = i >= 0 ? idx.pending_triage[i] : null
        ok = !!p && p.category === 'unknown' && p.target === 'NOTES-unknown.md' && p.owner === 'unassigned' && p.status === 'pending-triage' && p.authority === 'unresolved' && p.supersedes === null && p.index === `/pending_triage/${i}` && !idx.documents.some((x) => x.path === 'NOTES-unknown.md') && sha(join(d, 'NOTES-unknown.md')) === h0
      }
      t('⑥ unknown 原地 pending（八键全值/原文不动/不落 documents）', r.status === 0 && ok)
    }
    // ⑦ 同优先级歧义停留 pending（basename AGENTS.md 与前缀 docs/spec 同长多命中）
    {
      const d = join(fxRoot, 'v7'); mkdirSync(join(d, 'docs', 'spec'), { recursive: true })
      writeFileSync(join(d, 'docs', 'spec', 'AGENTS.md'), 'ambiguous sample\n')
      const r = run(['--target', d, '--write'])
      let ok = false
      const idxPath = join(d, 'docs', 'doc-index.json')
      if (r.status === 0 && existsSync(idxPath)) {
        const idx = JSON.parse(readFileSync(idxPath, 'utf8'))
        ok = idx.pending_triage.some((x) => x.path === 'docs/spec/AGENTS.md') && !idx.documents.some((x) => x.path === 'docs/spec/AGENTS.md')
      }
      t('⑦ 同优先级歧义 pending（同长度多命中=unknown）', r.status === 0 && ok)
    }
    // ⑧ index 指针回指自身（v2/v6/v7 三份生成索引）
    {
      const ok = ['v2', 'v6', 'v7'].every((v) => {
        const idxPath = join(fxRoot, v, 'docs', 'doc-index.json')
        if (!existsSync(idxPath)) return false
        const idx = JSON.parse(readFileSync(idxPath, 'utf8'))
        return idx.documents.every((r, i) => r.index === `/documents/${i}`) && idx.pending_triage.every((r, i) => r.index === `/pending_triage/${i}`)
      })
      t('⑧ index 指针回指自身（JSON Pointer 与数组位一致）', ok)
    }
    // ⑨ 路径稳定排序（UTF-8 无符号字节序·禁 locale；含 CJK 样本）
    {
      const d = join(fxRoot, 'v9')
      const inputs = ['AGENTS.md', 'CHANGELOG.md', 'docs/zz.md', 'docs/b.md', 'docs/adr/0002-b.md', 'docs/adr/0001-a.md', 'evidence/z.md', 'evidence/handoffs/h1.md', 'docs/中文.md']
      for (const f of inputs) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), 'x\n') }
      const r = run(['--target', d, '--write'])
      let ok = false
      const idxPath = join(d, 'docs', 'doc-index.json')
      if (r.status === 0 && existsSync(idxPath)) {
        const idx = JSON.parse(readFileSync(idxPath, 'utf8'))
        const sorted = (arr) => arr.every((p, i) => i === 0 || byteCompare(arr[i - 1], p) < 0)
        const docPaths = idx.documents.map((x) => x.path)
        const pendPaths = idx.pending_triage.map((x) => x.path)
        const adrA = docPaths.indexOf('docs/adr/0001-a.md')
        const adrB = docPaths.indexOf('docs/adr/0002-b.md')
        ok = sorted(docPaths) && sorted(pendPaths) && adrA >= 0 && adrB >= 0 && adrA < adrB && pendPaths.includes('docs/中文.md') && pendPaths.indexOf('docs/中文.md') > pendPaths.indexOf('docs/zz.md') && docPaths.includes('AGENTS.md') && docPaths.includes('CHANGELOG.md') && docPaths.includes('evidence/handoffs/h1.md') && docPaths.includes('evidence/z.md')
      }
      t('⑨ 路径稳定排序（两数组字节序/adr 序/CJK 后置于 ASCII）', r.status === 0 && ok)
    }
    // ⑩ target 目录不存在/非目录/不可读（装载错族；不可读在 root 可读环境降为 isIoError 单元注入——N-5 root 确定性）
    {
      const r1 = run(['--target', join(fxRoot, 'no-such-dir')])
      const f = join(fxRoot, 'afile'); writeFileSync(f, 'x')
      const r2 = run(['--target', f])
      const locked = join(fxRoot, 'locked'); mkdirSync(locked); chmodSync(locked, 0o000)
      let lockedOk = false
      let rootReadable = true
      try { readdirSync(locked) } catch { rootReadable = false }
      if (rootReadable) lockedOk = isIoError(Object.assign(new Error('injected'), { code: 'EACCES' })) && !isIoError(new Error('plain'))
      else lockedOk = run(['--target', locked]).status === 3
      chmodSync(locked, 0o755)
      t('⑩ target 目录不存在/不可读=3（含非目录；chmod 000 实测或 root 下单元注入）', r1.status === 3 && r2.status === 3 && lockedOk)
    }
    // ⑪ 缺模板=3（W-1 真实子进程：脚本＋org-config 副本置 /tmp，SKILL_ROOT 解析到无模板目录）
    {
      const home = join(fxRoot, 'v11'); mkdirSync(join(home, 'scripts'), { recursive: true })
      copyFileSync(SELF, join(home, 'scripts', 'init-docgroup.mjs'))
      copyFileSync(join(SKILL_ROOT, 'scripts', 'org-config.mjs'), join(home, 'scripts', 'org-config.mjs'))
      const d = join(fxRoot, 'v11t'); mkdirSync(d)
      const r = spawnSync(process.execPath, [join(home, 'scripts', 'init-docgroup.mjs'), '--target', d], { encoding: 'utf8' })
      t('⑪ 缺模板=3（真实子进程·装载错族）', r.status === 3 && String(r.stderr).includes('技能模板缺失'))
    }
    // ⑫ 未给 --target/用法错
    {
      const r1 = run([])
      const r2 = run(['--write'])
      t('⑫ 未给 --target=1（含只给 --write）', r1.status === 1 && r2.status === 1)
    }
    // ⑬ 未知旗标
    {
      const d = join(fxRoot, 'v13'); mkdirSync(d)
      t('⑬ 未知旗标=1', run(['--target', d, '--bogus']).status === 1)
    }
    // ⑭ --self-test 与其他参数并存
    {
      const d = join(fxRoot, 'v14'); mkdirSync(d)
      t('⑭ --self-test 参数互斥=1', run(['--self-test', '--target', d]).status === 1)
    }
    // ⑮-⑱ 四件 golden fixture（docgroup-fixture/v1；轮 2 B-1 承载＝独立新进程经 file:// 导入
    // shipped validateIndex，按 finding 映射退出码：pass 形=0/fail 形=1；进程内断言保留）
    {
      const gd = join(SKILL_ROOT, 'scripts', '.golden', 'docgroup')
      const load = (nm) => {
        const p = join(gd, `${nm}.json`)
        if (!existsSync(p)) return null
        return JSON.parse(readFileSync(p, 'utf8'))
      }
      const runValidateProc = (fxFile) => {
        const code = [
          "import { readFileSync } from 'node:fs'",
          `import { validateIndex } from ${JSON.stringify(pathToFileURL(SELF).href)}`,
          `const fx = JSON.parse(readFileSync(${JSON.stringify(fxFile)}, 'utf8'))`,
          'const findings = validateIndex(fx.index)',
          'console.log(JSON.stringify({ name: fx.name, findings }))',
          'process.exit(findings.length === 0 ? 0 : 1)',
        ].join('\n')
        return spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' })
      }
      const procFindings = (r) => { try { return JSON.parse(String(r.stdout).trim().split('\n').pop()).findings } catch { return ['unparsable-proc-stdout'] } }
      const kp = load('known-pass'), kf = load('known-fail'), up = load('unknown-pass'), uf = load('unknown-fail')
      const rkp = kp ? runValidateProc(join(gd, 'known-pass.json')) : null
      t('⑮ known-pass 通过（独立进程导入 shipped validateIndex→status=0＋零 finding）', !!kp && kp.schema === FIXTURE_SCHEMA && kp.name === 'known-minimal-index' && validateIndex(kp.index).length === 0 && kp.expected.valid === true && kp.expected.finding === null && !!rkp && rkp.status === 0 && procFindings(rkp).length === 0)
      const kfF = kf ? validateIndex(kf.index) : ['absent']
      const rkf = kf ? runValidateProc(join(gd, 'known-fail.json')) : null
      t('⑯ known-fail 检出（独立进程→status=1＋恰 missing-owner）', !!kf && kf.schema === FIXTURE_SCHEMA && kf.name === 'known-minimal-index' && kf.expected.valid === false && kf.expected.finding === 'missing-owner' && kfF.length === 1 && kfF[0] === 'missing-owner' && !!rkf && rkf.status === 1 && JSON.stringify(procFindings(rkf)) === JSON.stringify(['missing-owner']))
      const rup = up ? runValidateProc(join(gd, 'unknown-pass.json')) : null
      t('⑰ unknown-pass 通过（独立进程→status=0＋零 finding）', !!up && up.schema === FIXTURE_SCHEMA && up.name === 'unknown-minimal-index' && validateIndex(up.index).length === 0 && up.expected.valid === true && up.expected.finding === null && !!rup && rup.status === 0 && procFindings(rup).length === 0)
      const ufF = uf ? validateIndex(uf.index) : ['absent']
      const ruf = uf ? runValidateProc(join(gd, 'unknown-fail.json')) : null
      t('⑱ unknown-fail 检出（独立进程→status=1＋恰 pending-target-moved）', !!uf && uf.schema === FIXTURE_SCHEMA && uf.name === 'unknown-minimal-index' && uf.expected.valid === false && uf.expected.finding === 'pending-target-moved' && ufF.length === 1 && ufF[0] === 'pending-target-moved' && !!ruf && ruf.status === 1 && JSON.stringify(procFindings(ruf)) === JSON.stringify(['pending-target-moved']))
    }
  } finally {
    rmSync(fxRoot, { recursive: true, force: true })
  }
  console.log(fails === 0 ? `init-docgroup self-test 全过（${n} 向量）` : `init-docgroup self-test ${fails} 项失败（共 ${n} 向量）`)
  process.exit(fails === 0 ? 0 : 1)
}
