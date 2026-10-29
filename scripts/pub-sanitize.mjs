#!/usr/bin/env node
// pub-sanitize.mjs — 分发净化流水线（R-PUB-1·r5）：把技能仓导出面变换成「对外分发最小集」——
//   导出(checkout-index)→剔除(dropFiles)→骨架换件(RESIDUALS)→精确清洗(X1/X2/X4)→族清洗(X3/X5)
//   →精确清洗(X7)→全局改名(T·内容＋文件名)→.manifest 重哈希→terms-baseline 重算→四维门禁→MANIFEST。
// 规格=scripts/pub-sanitize.spec.json（数据非逻辑；第 4 维词表单源派生：codenameMap 键＋
//   exactRules.gateRegex＋familyRules.regex/gateWord——spec 不双写词表）。第 1-3 维复用
//   package-skill 纯函数四 import（buildSharePatterns/lineExempt/validateWhitelist/scanTree；
//   scanLine 经 scanTree 间接复用——六观测④订正：原「六纯函数」表述与现行 import 面不符）；
//   buildManifest 因头注嵌时间戳违 D3 幂等逐字节稳定不引入，本件以确定性清单代之，行格式同源。
// 与 package-skill 常规 --out 通道关系：本管线是「先变换后门禁」的发布通道，常规通道契约
//   零改动（活树含代号是组织在用常态）；本件门禁扫描对象=净化产物，不扫活树导出面。
// 用法：node scripts/pub-sanitize.mjs --out <空目录> | --gate-only <目录> | --self-test
//   （flag 空格分隔，--x=y=用法错——cliFlag 单源立场）
// 退出码口径单源=references/06 §5.8：0 成功／1 用法错或门禁命中／3 装载错
//   （脏树·导出失败·目录非法或仓内·规则计数失配·规格装载失败）。
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync, renameSync, mkdtempSync, copyFileSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { SKILL_ROOT, loadOrgConfig, cliFlag, UsageError } from './org-config.mjs'
import { buildSharePatterns, lineExempt, validateWhitelist, scanTree } from './package-skill.mjs'

const SPEC_PATH = join(SKILL_ROOT, 'scripts', 'pub-sanitize.spec.json')
const MANIFEST_REL = 'MANIFEST.txt'
const SKIP_WL = ['scripts/share-whitelist.json'] // 自指性注册件（豁免串在案）——同 package-skill
const STEP_EXACT = ['X1', 'X2', 'X4', 'X7'] // 执行序 §3.3：X1→X2→X4→X3(族)→X5(族)→X7→T
const STEP_FAMILY = { X3: 'X3', X5: 'X5' }
const FROZEN_DATE = '2026-10-27' // 骨架与 terms-baseline frozen 的归一常量（分发面初版日期——跨日幂等）
class SanitizeError extends Error {}
const fail = (m) => { throw new SanitizeError(m) }
const isPlain = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const cnt = (text, find) => text.split(find).length - 1

/** 规格装载校验：非对象首拒＋键域封闭＋逐元素形状＋必需族齐全＋族总量内部自洽（load 期失配即 exit 3）。 */
export function validateSpec(spec) {
  if (!isPlain(spec)) fail(`spec 须为普通对象（收到 ${spec === null ? 'null' : Array.isArray(spec) ? '数组' : typeof spec}——装载错）`)
  const KEYS = new Set(['schemaVersion', 'codenameMap', 'dropFiles', 'residualsSkeleton', 'exactRules', 'familyRules', 'shareWhitelist', 'note'])
  const unknown = Object.keys(spec).filter((k) => !KEYS.has(k))
  if (unknown.length) fail(`spec 含未声明键 ${unknown.join(',')}（键域封闭）`)
  if (!isPlain(spec.codenameMap) || !Object.keys(spec.codenameMap).length) fail('codenameMap 须非空对象')
  for (const [k, v] of Object.entries(spec.codenameMap)) if (typeof v !== 'string' || !v) fail(`codenameMap[${k}] 值须非空串`)
  if (!Array.isArray(spec.dropFiles) || !spec.dropFiles.every((x) => typeof x === 'string')) fail('dropFiles 须字符串数组')
  if (!Array.isArray(spec.residualsSkeleton) || !spec.residualsSkeleton.every((x) => typeof x === 'string')) fail('residualsSkeleton 须字符串数组')
  if (!Array.isArray(spec.shareWhitelist) || spec.shareWhitelist.length) fail('shareWhitelist 须空数组（D4 净化面零豁免——确需豁免须逐条理由并过审）')
  if (!Array.isArray(spec.exactRules) || !Array.isArray(spec.familyRules)) fail('exactRules/familyRules 须数组')
  const famSum = {}
  for (const r of spec.exactRules) {
    if (!isPlain(r) || !r.id || !r.family || !Array.isArray(r.files) || !r.files.length || typeof r.find !== 'string' || typeof r.replace !== 'string') fail(`exactRule 形状缺字段或非对象（${r && r.id}）`)
    if (!Number.isInteger(r.perFile) || r.perFile < 1) fail(`exactRule ${r.id} perFile 须正整数`)
    if (typeof r.familyTotal !== 'number') fail(`exactRule ${r.id} 缺 familyTotal`)
    if (r.gateRegex) { try { new RegExp(r.gateRegex) } catch (e) { fail(`exactRule ${r.id} gateRegex 不可编译：${e.message}`) } }
    famSum[r.family] = (famSum[r.family] || 0) + r.perFile * r.files.length
  }
  for (const fam of Object.keys(famSum)) {
    const totals = [...new Set(spec.exactRules.filter((r) => r.family === fam).map((r) => r.familyTotal))]
    if (totals.length !== 1 || totals[0] !== famSum[fam]) fail(`族 ${fam} 规则计数合计 ${famSum[fam]}≠familyTotal ${totals.join('/')}——漏配或规格失配`)
  }
  for (const f of spec.familyRules) {
    if (!isPlain(f) || !f.id || typeof f.familyTotal !== 'number') fail(`familyRule 形状缺字段或非对象（${f && f.id}）`)
    // A2 装载加固（六观测④）：声明了 gateLabel（第 4 维门禁面标签）的规则，其门禁正则键
    // gateRegex 必填——缺失=装载错，错误行点名规则 id 与键名（禁标签悬空无门禁式）。
    if (f.gateLabel) {
      if (typeof f.gateRegex !== 'string' || !f.gateRegex) fail(`familyRule ${f.id} 声明 gateLabel 而门禁正则键 gateRegex 缺失——装载拒（键名=gateRegex）`)
      try { new RegExp(f.gateRegex, f.flags || 'g') } catch (e) { fail(`familyRule ${f.id} gateRegex 不可编译：${e.message}`) }
    }
    if (f.mode === 'regex') {
      if (typeof f.regex !== 'string' || typeof f.replace !== 'string' || !isPlain(f.counts)) fail(`familyRule ${f.id} regex 形态须 regex+replace+counts`)
      try { new RegExp(f.regex, f.flags || 'g') } catch (e) { fail(`familyRule ${f.id} regex 不可编译：${e.message}`) }
      const sum = Object.values(f.counts).reduce((s, x) => s + x, 0)
      if (sum !== f.familyTotal) fail(`族 ${f.id} counts 合计 ${sum}≠familyTotal ${f.familyTotal}`)
    } else if (f.mode === 'rename') {
      const ks = Object.keys(f.counts || {}).sort()
      if (JSON.stringify(ks) !== JSON.stringify(['content', 'filename']) || Object.values(f.counts).some((x) => !Number.isInteger(x) || x < 1)) fail(`族 ${f.id} rename 形态须 counts={content,filename}`)
      if (f.counts.content + f.counts.filename !== f.familyTotal) fail(`族 ${f.id} rename 合计≠familyTotal`)
    } else if (f.mode === 'exact') {
      if (typeof f.regex !== 'string' || !f.regex) fail(`族 ${f.id} exact 形态必填 regex（门禁式缺位即拒——禁静默跳过）`)
      try { new RegExp(f.regex, f.flags || 'g') } catch (e) { fail(`族 ${f.id} regex 不可编译：${e.message}`) }
      const sum = spec.exactRules.filter((r) => r.family === f.id).reduce((s, r) => s + r.perFile * r.files.length, 0)
      if (sum !== f.familyTotal) fail(`族 ${f.id} exact 合计 ${sum}≠familyTotal ${f.familyTotal}`)
    } else fail(`familyRule ${f.id} mode 非法（regex|exact|rename）`)
  }
  const hasExact = (fam) => spec.exactRules.some((r) => r.family === fam)
  const hasFamily = (id) => spec.familyRules.some((f) => f.id === id)
  // X7 例外（v3.2.1 起源头已净）：exact 族可全缺席，须 familyRules 仍持 X7 门禁（regex）且 familyTotal=0 声明零残留
  for (const fam of ['X1', 'X2', 'X4']) if (!hasExact(fam)) fail(`必需清洗族 ${fam} 缺失（exactRules 无一族规则）`)
  if (!hasExact('X7')) {
    const x7 = spec.familyRules.find((f) => f.id === 'X7')
    if (!x7 || x7.familyTotal !== 0) fail('必需清洗族 X7 缺失（exactRules 无一族规则，且未按零残留形态声明：familyRules X7 familyTotal=0）')
  }
  for (const fam of ['X3', 'X5']) if (!hasFamily(fam)) fail(`必需清洗族 ${fam} 缺失（familyRules 无一族规则）`)
  if (!spec.familyRules.some((f) => f.id === 'T' && f.mode === 'rename')) fail('T 族改名声明缺失（familyRules 无 mode=rename 的 T）')
  return spec
}
export function loadSpec(path = SPEC_PATH) {
  let raw
  try { raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '') } catch (e) { fail(`规格件读取失败（${path}）：${e.message}`) }
  let spec
  try { spec = JSON.parse(raw) } catch (e) { fail(`规格件不可解析（${path}）：${e.message}`) }
  try { return validateSpec(spec) } catch (e) { if (e instanceof SanitizeError) throw e; fail(`规格校验异常：${e.message}`) }
}

/** 精确规则族：逐文件命中数===perFile 才替换（漂移即 exit 3），返回实计数。 */
export function applyExactRules(tree, spec, family) {
  let applied = 0
  for (const r of spec.exactRules.filter((x) => x.family === family)) {
    for (const f of r.files) {
      const p = join(tree, f)
      if (!existsSync(p)) fail(`规则 ${r.id} 目标缺失 ${f}`)
      const t = readFileSync(p, 'utf8')
      const n = cnt(t, r.find)
      if (n !== r.perFile) fail(`规则 ${r.id} 计数失配：${f} 实际 ${n}≠声明 ${r.perFile}`)
      writeFileSync(p, t.split(r.find).join(r.replace))
      applied += n
    }
  }
  return applied
}

/** 族正则规则：逐文件命中数===声明才替换。 */
export function applyFamilyRule(tree, rule) {
  let applied = 0
  const re = new RegExp(rule.regex, rule.flags || 'g')
  for (const [f, declared] of Object.entries(rule.counts)) {
    const p = join(tree, f)
    if (!existsSync(p)) fail(`族规则 ${rule.id} 目标缺失 ${f}`)
    const t = readFileSync(p, 'utf8')
    const m = t.match(re)
    if ((m ? m.length : 0) !== declared) fail(`族规则 ${rule.id} 计数失配：${f} 实际 ${m ? m.length : 0}≠声明 ${declared}`)
    writeFileSync(p, t.replace(re, () => rule.replace))
    applied += declared
  }
  return applied
}

/** T 全局改名：内容＋文件名双通道，词边界替换（sha256 十六进制串等嵌形态不伤——向量①）。 */
export function tContent(text, map) {
  let n = 0
  for (const [k, v] of Object.entries(map)) text = text.replace(new RegExp('\\b' + escRe(k) + '\\b', 'g'), () => (n++, v))
  return { text, n }
}
export function tName(name, map) {
  let out = name
  for (const [k, v] of Object.entries(map)) out = out.replace(new RegExp('\\b' + escRe(k) + '\\b', 'g'), v)
  return out
}
function applyT(tree, map) {
  let content = 0
  const walk = (d) => { for (const name of readdirSync(d).sort()) { if (name === '.git') continue; const p = join(d, name); if (statSync(p).isDirectory()) { walk(p); continue } const r = tContent(readFileSync(p, 'utf8'), map); if (r.n) writeFileSync(p, r.text); content += r.n } }
  walk(tree)
  let files = 0
  const rename = (d) => { for (const name of [...readdirSync(d)]) { const p = join(d, name); if (statSync(p).isDirectory()) { rename(p); continue } const nn = tName(name, map); if (nn !== name) { renameSync(p, join(d, nn)); files++ } } }
  rename(tree)
  return { content, files }
}

/** .manifest 重哈希：键限 .md 且↔templates/agents/*.md 双向断言＋逐键重算（内容变→值变——向量⑩⑯）。 */
function rehashManifest(tree) {
  const dir = join(tree, 'templates', 'agents')
  const mp = join(dir, '.manifest.json')
  let obj
  try { obj = JSON.parse(readFileSync(mp, 'utf8')) } catch (e) { fail(`.manifest.json 不可解析：${e.message}`) }
  if (!isPlain(obj) || !isPlain(obj.files)) fail('.manifest.json 缺 files 对象')
  const keys = Object.keys(obj.files)
  const bad = keys.filter((k) => !k.endsWith('.md'))
  if (bad.length) fail('.manifest.json 键非 .md 形态：' + bad.join(','))
  const actual = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort()
  for (const k of keys) if (!existsSync(join(dir, k))) fail(`.manifest.json 键「${k}」无对应文件`)
  const missing = actual.filter((n) => !keys.includes(n))
  if (missing.length) fail('.manifest.json 缺键：' + missing.join(','))
  let changed = 0
  for (const k of keys) { const h = createHash('sha256').update(readFileSync(join(dir, k))).digest('hex'); if (obj.files[k] !== h) { obj.files[k] = h; changed++ } }
  writeFileSync(mp, JSON.stringify(obj, null, 2) + '\n')
  return changed
}

/** terms-baseline 重算（D-16a）：树内临时旗标状态件经子进程 env ORG_FLAGS_STATE 驱动（零触生产 flag），显式 on＋
 *  --surface historical --update（cwd/--project=tree）→ 同态 strict both 复核 → finally 清 .zcode 断言缺席；frozen 双层归一回读断言（跨日幂等——首席 B2/二席 W3）。 */
function recomputeBaseline(tree) {
  const zdir = join(tree, '.zcode'), fp = join(zdir, 'org-flags.json'); mkdirSync(zdir, { recursive: true }); writeFileSync(fp, JSON.stringify({ b2_terms_v2: true }), 'utf8')
  const env = { ...process.env, ORG_FLAGS_STATE: fp }, run = (a) => spawnSync(process.execPath, [join(tree, 'scripts', 'check-terms.mjs'), ...a], { encoding: 'utf8', cwd: tree, env })
  let baseline = ''
  try {
    const u = run(['--surface', 'historical', '--update', '--project', tree]); if (u.error || u.status !== 0) fail(`terms-baseline 重算被拒（historical update exit=${u.status}）：${String(u.stderr || u.stdout || '').trim().slice(0, 200)}`)
    baseline = String(u.stdout || '').trim()
    const g = run(['--strict', '--surface', 'both', '--project', tree]); if (g.error || g.status !== 0) fail(`terms-baseline 重算复核未过（strict both exit=${g.status}）：${String(g.stderr || g.stdout || '').trim().slice(0, 200)}`)
  } finally { rmSync(zdir, { recursive: true, force: true }); if (existsSync(zdir)) fail('树内临时状态清理失败（.zcode 残留）') }
  const bp = join(tree, 'scripts', '.golden', 'terms-baseline.json'), base = (() => { try { return JSON.parse(readFileSync(bp, 'utf8')) } catch (e) { return fail(`terms-baseline 重读失败：${e.message}`) } })()
  base.frozen = FROZEN_DATE; if (isPlain(base.historical)) base.historical.frozen = FROZEN_DATE
  writeFileSync(bp, JSON.stringify(base, null, 2) + '\n'); const back = JSON.parse(readFileSync(bp, 'utf8'))
  if (back.frozen !== FROZEN_DATE || (isPlain(base.historical) && back.historical.frozen !== FROZEN_DATE)) fail('frozen 归一断言失败')
  return baseline
}

/** 确定性清单：行=sha256␠␠相对路径（排序稳定·无时间戳·头注零 git sha——孤儿 sha↔基 sha 对应由主控结项件承载）。 */
export function buildDistManifest(tree) {
  const rels = []
  const walk = (d) => { for (const name of readdirSync(d).sort()) { if (name === '.git') continue; const p = join(d, name); if (statSync(p).isDirectory()) { walk(p); continue } const rel = relative(tree, p).replaceAll('\\', '/'); if (rel === MANIFEST_REL) continue; rels.push(rel) } }
  walk(tree)
  rels.sort()
  return `# ai-dev-org 分发面清单（MANIFEST 生成物——09 §1 语义；行=sha256双空格相对路径）\n${rels.map((rel) => `${createHash('sha256').update(readFileSync(join(tree, rel))).digest('hex')}  ${rel}`).join('\n')}\n`
}

/** RESIDUALS 骨架换件（向量⑤端到端通道）。 */
export function writeSkeleton(tree, spec) {
  writeFileSync(join(tree, 'RESIDUALS.md'), spec.residualsSkeleton.join('\n'), 'utf8')
}

/** 第 4 维词表派生（单源=spec）：代号键＋exactRules.gateRegex＋familyRules.regex/gateWord。 */
export function dim4Patterns(spec) {
  const pats = []
  const toks = Object.keys(spec.codenameMap)
  pats.push({ re: new RegExp('\\b(?:' + toks.map(escRe).join('|') + ')\\b', 'g'), label: `代号(${toks.join('/')})`, fname: true })
  for (const r of spec.exactRules) if (r.gateRegex) pats.push({ re: new RegExp(r.gateRegex, 'g'), label: r.gateLabel || r.id, fname: true })
  for (const f of spec.familyRules) {
    if (f.regex) pats.push({ re: new RegExp(f.regex, f.flags || 'g'), label: f.id, fname: !f.scope, scope: f.scope || null })
    if (f.gateWord) pats.push({ re: new RegExp(escRe(f.gateWord), 'g'), label: f.gateLabel || '归档路径词', fname: true })
  }
  return pats
}
const hitOn = (re, s) => { re.lastIndex = 0; const r = re.test(s); re.lastIndex = 0; return r }

/** 四维门禁：第 1-3 维=package-skill 同源装载（本机 cfg＋share-whitelist 原样）；第 4 维=spec 派生。 */
export function runGate(tree, spec) {
  let cfg, wl
  try { cfg = loadOrgConfig(SKILL_ROOT).merged } catch (e) { fail(`org-config 装载失败：${e.message}`) }
  try { wl = JSON.parse(readFileSync(join(SKILL_ROOT, 'scripts', 'share-whitelist.json'), 'utf8').replace(/^\uFEFF/, '')) } catch (e) { fail(`share-whitelist 读取失败：${e.message}`) }
  const p123 = buildSharePatterns(cfg, wl.term_exemptions || [])
  const wlErr = validateWhitelist(wl, p123)
  if (wlErr.length) fail('share-whitelist 校验未过（fail-closed）：' + wlErr[0])
  const hits = []
  for (const h of scanTree(tree, p123, wl.entries || [], SKIP_WL)) {
    const dim = h.hits.some((x) => x.startsWith('uuid')) ? 1 : h.hits.some((x) => x.startsWith('盘符')) ? 2 : 3
    hits.push({ file: h.file, no: h.no, dim, desc: h.hits.join('|'), line: h.line })
  }
  const pats = dim4Patterns(spec)
  const walk = (d) => { for (const name of readdirSync(d).sort()) { if (name === '.git') continue; const p = join(d, name); if (statSync(p).isDirectory()) { walk(p); continue } const rel = relative(tree, p).replaceAll('\\', '/')
    const fname = pats.filter((pt) => pt.fname && (!pt.scope || rel.endsWith(pt.scope.replace('*', ''))))
    if (fname.some((pt) => hitOn(pt.re, rel))) { hits.push({ file: rel, no: 0, dim: 4, desc: '内部标识:' + fname.filter((pt) => hitOn(pt.re, rel)).map((pt) => pt.label).join('|'), line: `(文件名) ${rel}` }); continue }
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (lineExempt(rel, line, spec.shareWhitelist || [])) return
      const active = pats.filter((pt) => !pt.scope || rel.endsWith(pt.scope.replace('*', '')))
      const got = active.filter((pt) => hitOn(pt.re, line))
      if (got.length) hits.push({ file: rel, no: i + 1, dim: 4, desc: '内部标识:' + got.map((pt) => pt.label).join('|'), line: line.trim().slice(0, 120) })
    })
  } }
  walk(tree)
  return hits
}
const printGate = (hits) => { console.error(`[RED] 净化门禁未过（${hits.length} 命中——第 1-3 维=share-whitelist 装载·第 4 维=spec 词表；输出目录留存供排查）：`); for (const h of hits) console.error(`[HIT] ${h.file}:${h.no} [${h.dim}] ${h.desc} ${h.line}`) }

/** --out 全链（§5.1 行为序；装载错=exit 3）。 */
function pipeline(outArg) {
  const outDir = resolve(outArg)
  if (existsSync(outDir) && !statSync(outDir).isDirectory()) fail(`输出目录形态非法（普通文件）：${outDir}`)
  const st = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: SKILL_ROOT, encoding: 'utf8' })
  if (st.error || st.status !== 0) fail('git 不可用——净化基线无法核验')
  if (String(st.stdout || '').trim()) fail(`工作树 tracked 面非净（--untracked-files=no 口径）——先 commit 后复跑：\n${String(st.stdout).trim().slice(0, 300)}`)
  if (existsSync(outDir) && readdirSync(outDir).length) fail(`输出目录非空（${outDir}）——拒绝覆盖既有内容`)
  const relOut = relative(SKILL_ROOT, outDir)
  if (!isAbsolute(relOut) && (relOut === '' || !relOut.startsWith('..'))) fail(`输出目录在技能仓内（${outDir}）——导出副本会污染工作树`)
  const head = String(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: SKILL_ROOT, encoding: 'utf8' }).stdout || '').trim()
  if (!head) fail('git rev-parse HEAD 失败——导出基线不可定')
  try { mkdirSync(outDir, { recursive: true }) } catch (e) { fail(`输出目录不可创建（${outDir}）：${e.message}`) }
  const exp = spawnSync('git', ['checkout-index', '-a', `--prefix=${outDir.replaceAll('\\', '/')}/`], { cwd: SKILL_ROOT, encoding: 'utf8' })
  if (exp.error || exp.status !== 0) fail(`checkout-index 导出失败：${String(exp.stderr || exp.error || '').trim()}`)
  for (const mustAbsent of ['org-config.local.json', '.zcode', join('scripts', 'model-routing-log.jsonl')]) if (existsSync(join(outDir, mustAbsent))) fail(`导出面含不应存在件 ${mustAbsent}——gitignore 面失守`)
  const spec = loadSpec()
  for (const f of spec.dropFiles) { const p = join(outDir, f); if (!existsSync(p)) fail(`dropFiles 缺件 ${f}`); rmSync(p) }
  writeSkeleton(outDir, spec)
  const c = {}
  c.X1 = applyExactRules(outDir, spec, 'X1')
  c.X2 = applyExactRules(outDir, spec, 'X2')
  c.X4 = applyExactRules(outDir, spec, 'X4')
  const x3 = spec.familyRules.find((f) => f.id === STEP_FAMILY.X3 && f.mode === 'regex')
  const x3re = new RegExp(x3.regex, x3.flags || 'g'); const x3src = readFileSync(join(outDir, 'scripts', 'check-terms.mjs'), 'utf8')
  x3.counts['scripts/check-terms.mjs'] = x3src.match(x3re) ? x3src.match(x3re).length : 0 // D-16b：X3 对导出树实值 matchAll 覆写（防漂移常量）
  x3.familyTotal = Object.values(x3.counts).reduce((sx, x) => sx + x, 0)
  c.X3 = applyFamilyRule(outDir, x3)
  c.X5 = applyFamilyRule(outDir, spec.familyRules.find((f) => f.id === STEP_FAMILY.X5 && f.mode === 'regex'))
  c.X7 = applyExactRules(outDir, spec, 'X7')
  const t = applyT(outDir, spec.codenameMap)
  const tDecl = spec.familyRules.find((f) => f.mode === 'rename')
  if (!tDecl || t.content !== tDecl.counts.content || t.files !== tDecl.counts.filename) fail(`T 族计数失配：实 ${t.content}/${t.files}≠声明 ${tDecl ? tDecl.counts.content + '/' + tDecl.counts.filename : '缺声明'}`)
  const rehash = rehashManifest(outDir)
  const baseline = recomputeBaseline(outDir)
  const hits = runGate(outDir, spec)
  if (hits.length) { printGate(hits); process.exit(1) }
  const mf = buildDistManifest(outDir)
  const rows = mf.split('\n').length - 2
  writeFileSync(join(outDir, MANIFEST_REL), mf, 'utf8')
  console.log(`净化分发面就绪：${outDir}（X1=${c.X1} X2=${c.X2} X3=${c.X3} X4=${c.X4} X5=${c.X5} X7=${c.X7} T内容=${t.content} T文件名=${t.files} 重哈希=${rehash}项 MANIFEST=${rows}件；terms-baseline：${baseline}；四维零命中——词表源=spec〔第 4 维〕＋share-whitelist 装载〔第 1-3 维〕）`)
  process.exit(0)
}

/** --gate-only：对既有目录跑四维门禁（B#23/C2/红证通道）。 */
function gateOnly(dirArg) {
  const dir = resolve(dirArg)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`门禁目标目录非法：${dir}`)
  const spec = loadSpec()
  const hits = runGate(dir, spec)
  if (hits.length) { printGate(hits); process.exit(1) }
  console.log(`净化门禁通过：${dir}（四维零命中——词表源=spec〔第 4 维〕＋share-whitelist 装载〔第 1-3 维〕）`)
  process.exit(0)
}

// ── --self-test（≥11 向量；夹具全落 os.tmpdir 并 finally 清理，禁动真实状态）──
function selfTest() {
  const self = fileURLToPath(import.meta.url)
  const run = (args) => spawnSync(process.execPath, [self, ...args], { encoding: 'utf8' })
  const runRaw = (args) => spawnSync(process.execPath, args, { encoding: 'utf8' }) // 不前置 self——被测命令自带脚本路径（向量⑭⑮）
  let fails = 0, n = 0
  const t = (name, cond) => (n++, console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`), void (cond || fails++))
  const spec = loadSpec()
  const MAP = spec.codenameMap
  const withFx = (fn) => { const d = mkdtempSync(join(tmpdir(), 'pub-st-')); try { return fn(d) } finally { rmSync(d, { recursive: true, force: true }) } }
  const w = (d, rel, text) => { const p = join(d, rel); mkdirSync(resolve(p, '..'), { recursive: true }); writeFileSync(p, text) }
  const r1 = tContent('sha256=16997a7d 与 699 独立串', MAP)
  t('①词边界安全：sha256 串内嵌 699 不替换、独立 699 替换', r1.text === 'sha256=16997a7d 与 kimia 独立串' && r1.n === 1)
  t('②改名映射文件名通道：ops-executor-699-high→ops-executor-kimia-high·无代号名不动', tName('ops-executor-699-high.md', MAP) === 'ops-executor-kimia-high.md' && tName('ops-reviewer-glmflash-max.md', MAP) === 'ops-reviewer-glmflash-max.md')
  t('③精确规则漏配即红：去一条 X2 规则→族合计≠familyTotal→validateSpec 拒', (() => { const m = JSON.parse(JSON.stringify(spec)); m.exactRules.splice(m.exactRules.findIndex((x) => x.id === 'X2-1'), 1); try { validateSpec(m); return false } catch (e) { return String(e.message).includes('familyTotal') } })())
  t('④族规则计数：D12 命中数对账＋替换生效', (() => { const x3 = spec.familyRules.find((f) => f.id === 'X3'); const re = new RegExp(x3.regex, x3.flags); const s = 'a D12 b D12 c'; const m = s.match(re); return m && m.length === 2 && s.replace(re, () => x3.replace) === 'a 决策项 b 决策项 c' })())
  t('⑤骨架逐字（端到端）：writeSkeleton 落盘后文件字节===数组 join', withFx((d) => { writeSkeleton(d, spec); const onDisk = readFileSync(join(d, 'RESIDUALS.md')); return Buffer.compare(Buffer.from(spec.residualsSkeleton.join('\n'), 'utf8'), onDisk) === 0 && spec.residualsSkeleton.join('\n').endsWith('## 新登记\n') }))
  t('⑥门禁单命中隔离：两行夹具恰一 [HIT]', withFx((d) => { w(d, 'a.md', 'clean line\ninject ops-reviewer-699-max here\n'); const r = run(['--gate-only', d]); const out = String(r.stdout || '') + String(r.stderr || ''); return r.status === 1 && (out.match(/\[HIT\]/g) || []).length === 1 && out.includes('[4]') }))
  t('⑦门禁文件名通道：代号名文件即红（文件名标注）', withFx((d) => { w(d, 'ops-x-699-high.md', 'x\n'); const r = run(['--gate-only', d]); const out = String(r.stdout || '') + String(r.stderr || ''); return r.status === 1 && out.includes('(文件名)') && out.includes('[4]') }))
  t('⑧词表派生单源：改 codenameMap 键→派生式随动（spec 无第二词表）', (() => { const m = JSON.parse(JSON.stringify(spec)); m.codenameMap = { '777': 'kimia' }; return dim4Patterns(m)[0].re.source.includes('777') && dim4Patterns(spec)[0].re.source.includes('699') })())
  t('⑨MANIFEST 行数与自排除：预置旧清单亦被排除·头注零 git sha', withFx((d) => { w(d, 'a.md', 'x\n'); w(d, 'sub/b.md', 'y\n'); w(d, 'MANIFEST.txt', 'stale\n'); const mf = buildDistManifest(d); const rows = mf.split('\n').filter((x) => /^[0-9a-f]{64}  /.test(x)); return rows.length === 2 && !mf.includes(MANIFEST_REL) && !/[0-9a-f]{40,64}/.test(mf.split('\n')[0]) && mf.startsWith('# ai-dev-org 分发面清单') && mf.endsWith('\n') }))
  t('⑩重哈希正确性：内容变→值变且等于实算 sha256', withFx((d) => { const dir = join(d, 'templates', 'agents'); mkdirSync(dir, { recursive: true }); w(d, 'templates/agents/a.md', 'hello\n'); writeFileSync(join(dir, '.manifest.json'), JSON.stringify({ schemaVersion: 1, files: { 'a.md': 'old' } })); rehashManifest(d); const v1 = JSON.parse(readFileSync(join(dir, '.manifest.json'), 'utf8')).files['a.md']; w(d, 'templates/agents/a.md', 'world\n'); rehashManifest(d); const v2 = JSON.parse(readFileSync(join(dir, '.manifest.json'), 'utf8')).files['a.md']; return v1 !== 'old' && v1 !== v2 && v2 === createHash('sha256').update(readFileSync(join(dir, 'a.md'))).digest('hex') }))
  t('⑪第 1-3 维复用实证：uuid 形态夹具经 --gate-only 恰一 [HIT] 且维度标注=1', withFx((d) => { w(d, 'u.md', '见 aaaaaaaa-0000-4000-8000-000000000001 条目\n'); const r = run(['--gate-only', d]); const out = String(r.stdout || '') + String(r.stderr || ''); return r.status === 1 && (out.match(/\[HIT\]/g) || []).length === 1 && out.includes('[1]') && out.includes('uuid形态') }))
  t('⑫X7 保护面不误伤：§N LNN／SY 前缀出处／L3 分层／日期批立形态零命中·真阳性仍命中', (() => { const x7 = spec.familyRules.find((f) => f.id === 'X7'); const fresh = () => new RegExp(x7.regex, x7.flags); const safe = ['§1 L15', 'SY-1 教训先例', 'L3 分层术语', '（2026-10-22 批立）', '变更锚：L〈批〉·L〈行〉']; const hit = ['L26 批立', '（P14）', '来源=P0-3']; return safe.every((s) => !fresh().test(s)) && hit.every((s) => fresh().test(s)) })())
  t('⑬键域封闭：spec 混入未声明键→validateSpec 拒', (() => { const m = JSON.parse(JSON.stringify(spec)); m.rogue = 1; try { validateSpec(m); return false } catch (e) { return String(e.message).includes('未声明键') } })())
  t('⑭退出码契约：损坏 spec 夹具 spawn→exit 3', withFx((d) => { mkdirSync(join(d, 'scripts'), { recursive: true }); for (const f of ['org-config.mjs', 'package-skill.mjs', 'pub-sanitize.mjs']) copyFileSync(join(SKILL_ROOT, 'scripts', f), join(d, 'scripts', f)); writeFileSync(join(d, 'scripts', 'pub-sanitize.spec.json'), '{ 错误 JSON', 'utf8'); const r = runRaw([join(d, 'scripts', 'pub-sanitize.mjs'), '--gate-only', d]); return r.status === 3 && String(r.stderr || '').includes('规格件不可解析') }))
  t('⑮退出码契约：--out 指向普通文件→exit 3', withFx((d) => { const f = join(d, 'afile'); writeFileSync(f, 'x'); const r = runRaw([self, '--out', f]); return r.status === 3 && String(r.stderr || '').includes('普通文件') }))
  t('⑯load 期 fail-closed：白名单非空/rename 合计/regex counts 合计/gateRegex 编译/gateLabel 缺门禁正则键五拒', (() => { const mk = (fn) => { const m = JSON.parse(JSON.stringify(spec)); fn(m); try { validateSpec(m); return false } catch (e) { return true } }; return mk((m) => { m.shareWhitelist = [{ file: 'a.md', contains: 'x', reason: 'r' }] }) && mk((m) => { m.familyRules.find((f) => f.id === 'T').counts.filename = 99 }) && mk((m) => { m.familyRules.find((f) => f.id === 'X3').counts['SKILL.md'] = 99 }) && mk((m) => { m.exactRules.find((x) => x.id === 'X2-1').gateRegex = '([' }) && (() => { const m = JSON.parse(JSON.stringify(spec)); const x5 = m.familyRules.find((f) => f.id === 'X5'); delete x5.gateRegex; try { validateSpec(m); return false } catch (e) { return String(e.message).includes('X5') && String(e.message).includes('gateRegex') } })() })())
  t('⑰manifest 键限 .md：非 .md 键→rehashManifest 拒', withFx((d) => { const dir = join(d, 'templates', 'agents'); mkdirSync(dir, { recursive: true }); w(d, 'templates/agents/a.md', 'x\n'); writeFileSync(join(dir, '.manifest.json'), JSON.stringify({ schemaVersion: 1, files: { 'a.json': 'old' } })); try { rehashManifest(d); return false } catch (e) { return String(e.message).includes('.md') } }))
  const cloneSpec = (d, mutate) => { const repo = join(d, 'repo'); if (spawnSync('git', ['clone', '-q', SKILL_ROOT, repo], { encoding: 'utf8' }).status !== 0) return null; const m = JSON.parse(readFileSync(join(repo, 'scripts', 'pub-sanitize.spec.json'), 'utf8')); mutate(m); writeFileSync(join(repo, 'scripts', 'pub-sanitize.spec.json'), JSON.stringify(m, null, 2) + '\n'); spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-aqm', 'x'], { encoding: 'utf8' }); return repo }
  t('⑱CLI 端到端：临时 spec 去一条 X2 规则→--out 真管线 exit 3（familyTotal 拒）', withFx((d) => { const repo = cloneSpec(d, (m) => m.exactRules.splice(m.exactRules.findIndex((x) => x.id === 'X2-1'), 1)); if (!repo) return false; const r = runRaw([join(repo, 'scripts', 'pub-sanitize.mjs'), '--out', join(d, 'out')]); return r.status === 3 && String(r.stderr || '').includes('familyTotal') }))
  t('⑲CLI 端到端：X3 声明计数与树不符（合计守恒置换）→管线 exit 3（计数失配）', withFx((d) => {
    const repo = cloneSpec(d, (m) => {
      const x3 = m.familyRules.find((f) => f.id === 'X3')
      const ks = Object.keys(x3.counts)
      const ka = ks.find((k) => ks.some((j) => j !== k && x3.counts[j] !== x3.counts[k]))
      const kb = ks.find((k) => k !== ka && x3.counts[k] !== x3.counts[ka])
      if (ka === undefined || kb === undefined) { x3.counts[ks[0]] += 1; x3.counts[ks[ks.length - 1]] -= 1 } // 全等值兜底：±1 置换仍合计守恒
      else { const tmp = x3.counts[ka]; x3.counts[ka] = x3.counts[kb]; x3.counts[kb] = tmp } // A9：从现行 counts 取计数值不等的两键互换（合计不变、树计数失配——措辞不硬编码文件名与计数，防重算再漂）
    })
    if (!repo) return false
    const r = runRaw([join(repo, 'scripts', 'pub-sanitize.mjs'), '--out', join(d, 'out')])
    return r.status === 3 && String(r.stderr || '').includes('计数失配')
  }))
  t('⑳装载链首拒：spec=null 夹具→exit 3（普通对象拒）', withFx((d) => { mkdirSync(join(d, 'scripts'), { recursive: true }); for (const f of ['org-config.mjs', 'package-skill.mjs', 'pub-sanitize.mjs']) copyFileSync(join(SKILL_ROOT, 'scripts', f), join(d, 'scripts', f)); writeFileSync(join(d, 'scripts', 'pub-sanitize.spec.json'), 'null', 'utf8'); const r = runRaw([join(d, 'scripts', 'pub-sanitize.mjs'), '--gate-only', d]); return r.status === 3 && String(r.stderr || '').includes('普通对象') }))
  t('㉑exact 族 regex 必填：去 X7 门禁式→exit 3（禁静默跳过）', withFx((d) => { mkdirSync(join(d, 'scripts'), { recursive: true }); for (const f of ['org-config.mjs', 'package-skill.mjs', 'pub-sanitize.mjs']) copyFileSync(join(SKILL_ROOT, 'scripts', f), join(d, 'scripts', f)); const m = JSON.parse(readFileSync(SPEC_PATH, 'utf8')); delete m.familyRules.find((f) => f.id === 'X7').regex; writeFileSync(join(d, 'scripts', 'pub-sanitize.spec.json'), JSON.stringify(m, null, 2), 'utf8'); const r = runRaw([join(d, 'scripts', 'pub-sanitize.mjs'), '--gate-only', d]); return r.status === 3 && String(r.stderr || '').includes('必填 regex') }))
  console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
  process.exit(fails === 0 ? 0 : 1)
}

// ── CLI ──
const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) {
  const argv = process.argv.slice(2)
  try {
    if (argv.includes('--self-test')) selfTest()
    if (argv.includes('--gate-only')) { const d = cliFlag(argv, '--gate-only'); if (!d) { console.error('用法: node scripts/pub-sanitize.mjs --gate-only <目录>'); process.exit(1) } gateOnly(d) }
    const out = cliFlag(argv, '--out')
    if (!out) { console.error('用法: node scripts/pub-sanitize.mjs --out <空目录> | --gate-only <目录> | --self-test'); process.exit(1) }
    pipeline(out)
  } catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
    console.error(`[装载错] ${e instanceof SanitizeError ? e.message : `未归类异常（统一装载错 exit 3——禁 rethrow 落 1）：${e.message}`}`)
    process.exit(3)
  }
}
