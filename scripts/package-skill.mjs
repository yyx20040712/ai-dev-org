/**
 * 分享打包（v2.1.0 批5）——产出可分发的净化副本，防个人/本机事实污染 skills：
 *   ①导出=git 跟踪面（checkout-index——天然排除 gitignore 运行产物与本机件
 *     org-config.local.json/.zcode//model-routing-log.jsonl）；
 *   ②分享面门禁=扫描 uuid 形态/盘符绝对路径/本机标识（org-config 本机件
 *     entry_name+绑定值，剔除供应商家族名）——零命中才出包，命中=exit 1（RED）；
 *   ③MANIFEST=文件清单+sha256（生成物，09 §1 语义）。
 * 白名单=scripts/share-whitelist.json（行级豁免 file/file_prefix/contains 同
 * hardcode-whitelist 语义+term_exemptions 供应商家族名；豁免须写理由）。
 * 退出码口径单源=references/06 §5.8：0 成功／1 用法错或门禁 RED／3 装载错
 * （脏树/导出失败/输出目录非空=拒绝打包，不覆盖既有内容）。
 * 用法：node scripts/package-skill.mjs --out <输出目录> [--self-test]
 *       （flag 取值一律空格分隔，--x=y 等号形态=用法错——cliFlag 单源立场）
 * 可 import 纯函数零副作用（isMain guard 惯例；自检向量禁动真实状态）。
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { SKILL_ROOT, loadOrgConfig, cliFlag, UsageError } from './org-config.mjs'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
// 盘符绝对路径（回炉 B1 修正：正则转义族排除仅对「转义字母后非词字符」形态生效
// ——`FINDINGS:\s*B=`（\s+量词）放过，`E:\src\x`（\s 后跟词字符=真路径）命中；
// 正斜杠形态无转义歧义恒命中）。v=\v 补入转义族。
const DRIVE_RE = /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![sdwbntrvSDWBNTRv](?![A-Za-z0-9]))/
const NEVER_RE = /$^/ // 永不命中（维度禁用形态）

/** 门禁词表（回炉 W1/W2/k1 W-4 修正）：①entry_name——剔 TODO 占位与供应商家族名
 *  **整词等值**剔除（子串剔除对「my-kimi-acct」类复合名构成逃逸面；分工链描述
 *  属安排性提及，08 §1 判例）；②uuid_prefix 裸 8-hex 前缀入词表（UUID_RE 只认
 *  36 字符全形，正文裸前缀形态需词表兜底）；③agent_bindings 值**不剔**——绑定串
 *  属机器事实，account:/builtin: 形态无 uuid 兜底，必须整串扫描。 */
export function buildSharePatterns(cfg, termExemptions = []) {
  const drop = (t) => termExemptions.some((x) => x && t.toLowerCase() === String(x).toLowerCase())
  const terms = []
  for (const def of Object.values(cfg?.providers || {})) {
    const n = def?.entry_name
    if (typeof n === 'string' && n && n !== 'TODO' && !drop(n)) terms.push(n)
    const u = def?.uuid_prefix
    if (typeof u === 'string' && /^[0-9a-f]{8}$/i.test(u)) terms.push(u)
  }
  for (const v of Object.values(cfg?.agent_bindings || {})) {
    if (typeof v === 'string' && v && v !== 'TODO') terms.push(v)
  }
  return { uuid: UUID_RE, drive: DRIVE_RE, terms: [...new Set(terms)] }
}

/** 单行扫描：返回命中描述数组（空=净）。terms 命中=大小写不敏感（与剔除侧对称——回炉 W1）。 */
export function scanLine(line, patterns) {
  const hits = []
  const l = String(line)
  if (patterns.uuid.test(l)) hits.push('uuid形态')
  if (patterns.drive.test(l)) hits.push('盘符绝对路径')
  const low = l.toLowerCase()
  for (const t of patterns.terms) if (low.includes(t.toLowerCase())) hits.push(`本机标识:${t}`)
  return hits
}

/** 行级豁免（回炉 B2 修正：零条件条目=fail-closed 不豁免；装载侧 validateWhitelist
 *  另行拒收——双闸）。语义同 hardcode-whitelist：全部已声明条件同时满足才豁免该行。 */
export function lineExempt(relPath, line, entries = []) {
  return entries.some((e) => {
    if (!(e.file || e.file_prefix || e.contains)) return false
    if (e.file && relPath !== e.file && !relPath.endsWith(e.file)) return false
    if (e.file_prefix && !relPath.startsWith(e.file_prefix)) return false
    if (e.contains && !line.includes(e.contains)) return false
    return true
  })
}

/** 白名单装载校验（回炉 B2/W3 修正——fail-closed 双闸之一 + 注册件自检）：
 *  ①每条目须 ≥1 条件（file/file_prefix/contains）且 reason 非空，键域封闭
 *  （未声明键=拼错即拒，防 contains_text 类 typo 静默 fail-open）；
 *  ②注册件自检：条目的 contains/reason 字段自身不得含 uuid 形态或本机标识词
 *  （合成样例须以 synthetic_ 前缀声明豁免）——防真实事实借注册面入库。 */
export function validateWhitelist(wl, patterns) {
  const errors = []
  const KNOWN = new Set(['file', 'file_prefix', 'contains', 'reason', 'synthetic_exempt'])
  const entries = Array.isArray(wl?.entries) ? wl.entries : null
  if (!entries) { errors.push('share-whitelist 缺 entries 数组'); return errors }
  entries.forEach((e, i) => {
    const unknown = Object.keys(e || {}).filter((k) => !KNOWN.has(k))
    if (unknown.length) errors.push(`entries[${i}] 含未声明键 ${unknown.join(',')}——疑似拼错（键域=file/file_prefix/contains/reason/synthetic_exempt）`)
    if (!(e.file || e.file_prefix || e.contains)) errors.push(`entries[${i}] 零条件条目=全局豁免 fail-open——拒收（回炉 B2）`)
    if (!e.reason || !String(e.reason).trim()) errors.push(`entries[${i}] 缺 reason（豁免须写理由）`)
    if (e.synthetic_exempt) return // 声明为合成样例的自检豁免（如门禁自检向量样例）
    const selfText = `${e.contains ?? ''} ${e.reason ?? ''}`
    if (patterns.uuid.test(selfText)) errors.push(`entries[${i}] 条件/理由含 uuid 形态——注册面禁真实标识（合成样例加 synthetic_exempt:true 声明）`)
    for (const t of patterns.terms) if (selfText.toLowerCase().includes(t.toLowerCase())) errors.push(`entries[${i}] 条件/理由含本机标识「${t}」——注册面禁真实标识`)
    if (patterns.drive.test(String(e.reason ?? ''))) errors.push(`entries[${i}] 理由含盘符绝对路径——注册面 reason 禁路径（contains 字段豁免串除外——回炉 W3a）`)
  })
  return errors
}

/** 目录树扫描：返回命中列表 [{file, line, no, hits}]（豁免行不计；skip=整文件
 *  跳过名单——自指性文件如白名单注册件本身存豁免串，代码级跳过防自咬）。 */
export function scanTree(root, patterns, entries = [], skip = []) {
  const found = []
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.git') continue
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      const rel = relative(root, p).replaceAll('\\', '/')
      if (skip.includes(rel)) continue
      // 回炉 k1 N-2：文件名通道——文件名自身含个人事实（uuid/本机标识）同等拦截
      const nameHits = scanLine(rel, patterns)
      if (nameHits.length) { found.push({ file: rel, no: 0, hits: nameHits, line: `(文件名) ${rel}` }); continue }
      const lines = readFileSync(p, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (lineExempt(rel, line, entries)) return
        const hits = scanLine(line, patterns)
        if (hits.length) found.push({ file: rel, no: i + 1, hits, line: line.trim().slice(0, 120) })
      })
    }
  }
  walk(root)
  return found
}

/** 清单：文件+sha256（excludeSelf=manifest 自身不列）。 */
export function buildManifest(root, headHash, excludeSelf) {
  const rows = []
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.git') continue
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      const rel = relative(root, p).replaceAll('\\', '/')
      if (excludeSelf && rel === excludeSelf) continue
      rows.push(`${createHash('sha256').update(readFileSync(p)).digest('hex')}  ${rel}`)
    }
  }
  walk(root)
  return `# ai-dev-org 分享包清单（生成物——09 §1；基线 git=${headHash}，${new Date().toISOString()}）\n${rows.join('\n')}\n`
}

// ── --self-test（fixture 为主，禁动真实状态）──
function selfTest() {
  let fails = 0
  let n = 0
  const t = (name, cond) => (n++, console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`), cond || fails++)
  const pats = buildSharePatterns(
    { providers: { a: { entry_name: 'acct-demo-x', uuid_prefix: 'aaaa1111' }, b: { entry_name: 'Kimi', uuid_prefix: 'TODO' }, c: { entry_name: 'TODO', uuid_prefix: 'TODO' }, d: { entry_name: 'my-kimi-acct', uuid_prefix: 'dddd2222' } }, agent_bindings: { x: 'bbbbbbbb-0000-4000-8000-000000000002/deepseek-flash$max' } },
    ['kimi', 'glm', 'deepseek'],
  )
  t('词表：本机 entry_name 收录', pats.terms.includes('acct-demo-x'))
  t('词表：供应商家族名整词等值剔除（Kimi）', !pats.terms.includes('Kimi'))
  t('词表：复合名不逃逸（my-kimi-acct 保留——回炉 k1 W-4a）', pats.terms.includes('my-kimi-acct'))
  t('词表：TODO 占位剔除（entry_name 与 uuid_prefix 双面）', !pats.terms.includes('TODO') && !pats.terms.some((x) => x === 'aaaa1111' ? false : /^TODO$/.test(x)))
  t('词表：裸 uuid 前缀 8-hex 入词表（回炉 k1 W-4b）', pats.terms.includes('aaaa1111') && pats.terms.includes('dddd2222'))
  t('词表：绑定值含家族名不剔（account/builtin 形态无 uuid 兜底——回炉 W1）', pats.terms.some((x) => x.includes('deepseek-flash$max')))
  t('扫描：uuid 形态命中', scanLine('见 aaaaaaaa-0000-4000-8000-000000000001/k3', pats).includes('uuid形态'))
  t('扫描：正则转义族不误伤（FINDINGS:\\s*B= / \\d+ 形态）', !scanLine('锚定 `/^\\s*`?FINDINGS:\\s*B=/m` 与 \\d+ 行', pats).length)
  t('扫描：盘符路径命中（正斜杠/反斜杠）', scanLine('先例 E:/x/a.md 与 C:\\y', pats).includes('盘符绝对路径'))
  t('扫描回炉 B1：排除族首字母真实路径仍命中（E:\\report/D:\\src/C:\\temp/C:\\Windows/E:\\work）', ['E:\\report\\a.md', 'D:\\src', 'C:\\temp/x', 'C:\\Windows\\sys', 'E:\\work'].every((s) => scanLine(`批档=${s}`, pats).includes('盘符绝对路径')))
  t('扫描回炉 B1：单字母目录形态（E:\\s\\foo）已知残留——登记不强求', scanLine('E:\\s\\foo', pats).length === 0)
  t('扫描：本机标识命中（entry_name，大小写不敏感——回炉 W1 对称）', scanLine('源=ACCT-DEMO-X 端点', pats).some((h) => h.startsWith('本机标识')))
  t('扫描：绑定值命中（含 uuid 前缀串）', scanLine('绑定=bbbbbbbb-0000-4000-8000-000000000002/deepseek-flash$max', pats).length >= 1)
  t('豁免：file_prefix+contains 同时满足才豁免', lineExempt('references/06-x.md', '批档=E:/zcode_md/a', [{ file_prefix: 'references/', contains: 'E:/zcode_md' }]) && !lineExempt('references/06-x.md', '其他行', [{ file_prefix: 'references/', contains: 'E:/zcode_md' }]) && !lineExempt('SKILL.md', '批档=E:/zcode_md/a', [{ file_prefix: 'references/', contains: 'E:/zcode_md' }]))
  t('豁免回炉 B2：零条件条目=fail-closed 不豁免', !lineExempt('a.md', '任意行', [{}]) && !lineExempt('a.md', '任意行', [{ reason: '只有理由' }]) && !lineExempt('a.md', '任意行', [{ contains_text: '拼错键' }]))
  t('校验回炉 B2：零条件/缺理由/拼错键→装载错误行', (() => { const e = validateWhitelist({ entries: [{}, { file: 'a.md' }, { file: 'a.md', contains: 'x', reason: '' }, { file: 'a.md', contains: 'x', reason: 'r', contains_text: 'y' }] }, pats); return e.some((x) => x.includes('entries[0] 零条件')) && e.some((x) => x.includes('entries[1] 缺 reason')) && e.some((x) => x.includes('entries[3] 含未声明键')) })())
  t('校验回炉 W3a：注册面理由含真实标识/uuid→错误行；synthetic_exempt 放行', (() => { const e1 = validateWhitelist({ entries: [{ file: 'a.md', contains: 'x', reason: '见 aaaaaaaa-0000-4000-8000-000000000001' }] }, pats); const e2 = validateWhitelist({ entries: [{ file: 'a.md', contains: 'aaaaaaaa-0000-4000-8000', reason: '合成样例', synthetic_exempt: true }] }, pats); return e1.some((x) => x.includes('uuid 形态')) && e2.length === 0 })())
  t('校验回炉 W3a：注册面理由含盘符路径→错误行', validateWhitelist({ entries: [{ file: 'a.md', contains: 'x', reason: '先例 E:/x/a.md' }] }, pats).some((x) => x.includes('理由含盘符绝对路径')))
  // scanTree+manifest 集成（fixture 临时目录）
  const fx = mkdtempSync(join(tmpdir(), 'pkg-fx-'))
  try {
    mkdirSync(join(fx, 'references'))
    writeFileSync(join(fx, 'references', 'a.md'), '干净行\n批档=E:/zcode_md/hist（历史指针）\nuuid=aaaaaaaa-0000-4000-8000-000000000001\n', 'utf8')
    writeFileSync(join(fx, 'b.md'), '本机账号=acct-demo-x\n', 'utf8')
    const hits = scanTree(fx, pats, [{ file_prefix: 'references/', contains: 'E:/zcode_md', reason: '历史' }])
    t('树扫：豁免行不计、命中行定位 file:行号', hits.length === 2 && hits.some((h) => h.file === 'references/a.md' && h.no === 3 && h.hits.includes('uuid形态')) && hits.some((h) => h.file === 'b.md' && h.hits.some((x) => x.includes('acct-demo-x'))))
    const hitsSk = scanTree(fx, pats, [], ['b.md'])
    t('树扫：skip 整文件跳过（自指性注册件形态）', hitsSk.length === 2 && hitsSk.every((h) => h.file === 'references/a.md') && !hitsSk.some((h) => h.file === 'b.md'))
    const mf = buildManifest(fx, 'deadbeef', 'MANIFEST.txt')
    t('清单：逐文件 sha256+豁免自身', mf.includes('references/a.md') && mf.includes('b.md') && /^[0-9a-f]{64}  references\/a\.md$/m.test(mf))
  } finally {
    rmSync(fx, { recursive: true, force: true })
  }
  console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
  process.exit(fails === 0 ? 0 : 1)
}

// ── CLI ──
const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) selfTest()

  let outDir
  try {
    outDir = cliFlag(argv, '--out')
  } catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
    throw e
  }
  if (!outDir) { console.error('用法: node scripts/package-skill.mjs --out <输出目录> [--self-test]（细则=PACKAGING.md）'); process.exit(1) }
  outDir = resolve(outDir)

  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: SKILL_ROOT, encoding: 'utf8' })
  if (dirty.error || dirty.status !== 0) { console.error('[装载错] git 不可用——打包基线无法核验（06 §5.8 行 3）'); process.exit(3) }
  if (String(dirty.stdout || '').trim()) { console.error(`[装载错] 工作树非净（打包基线须为已提交态——先 commit 或丢弃改动后复跑）：\n${String(dirty.stdout).trim().slice(0, 500)}`); process.exit(3) }
  if (existsSync(outDir) && readdirSync(outDir).length) { console.error(`[装载错] 输出目录非空（${outDir}）——拒绝覆盖既有内容，换空目录`); process.exit(3) }
  // 回炉 W4：导出副本落在仓库内=泄漏物残留面（git add -A 即入索引+脏树阻断后续打包）
  const relOut = relative(SKILL_ROOT, outDir)
  if (relOut !== '' && !relOut.startsWith('..')) { console.error(`[装载错] 输出目录在技能仓内（${outDir}）——导出副本会污染工作树，请指向仓外目录`); process.exit(3) }
  const head = String(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: SKILL_ROOT, encoding: 'utf8' }).stdout || '').trim()
  if (!head) { console.error('[装载错] git rev-parse HEAD 失败——打包基线不可定（06 §5.8 行 3）'); process.exit(3) }

  mkdirSync(outDir, { recursive: true })
  const exp = spawnSync('git', ['checkout-index', '-a', `--prefix=${outDir.replaceAll('\\', '/')}/`], { cwd: SKILL_ROOT, encoding: 'utf8' })
  if (exp.error || exp.status !== 0) { console.error(`[装载错] git checkout-index 导出失败（${String(exp.stderr || exp.error || '').trim()}）`); process.exit(3) }
  for (const mustAbsent of ['org-config.local.json', '.zcode', join('scripts', 'model-routing-log.jsonl')]) {
    if (existsSync(join(outDir, mustAbsent))) { console.error(`[装载错] 导出面含不应存在件 ${mustAbsent}——gitignore 面失守，中止`); process.exit(3) }
  }

  let wl
  try { wl = readJsonWL() } catch (e) { console.error(`[装载错] share-whitelist 读取失败: ${e.message}`); process.exit(3) }
  let cfg
  try { cfg = loadOrgConfig(SKILL_ROOT).merged } catch (e) { console.error(`[装载错] org-config 装载失败: ${e.message}`); process.exit(3) }
  const patterns = buildSharePatterns(cfg, wl.term_exemptions || [])
  // 回炉 B2：白名单 schema 校验+注册件自检（零条件/缺理由/拼错键/注册面混入真实标识=exit 3）
  const wlErr = validateWhitelist(wl, patterns)
  if (wlErr.length) { console.error('[装载错] share-whitelist 校验未过（fail-closed）：'); wlErr.forEach((e) => console.error(`  ${e}`)); process.exit(3) }
  // 回炉 W2：词表空=本机标识维度缺位——降级声明（不冒充三维门禁）
  const dims = patterns.terms.length ? 'uuid/盘符路径/本机标识' : 'uuid/盘符路径（本机标识词表为空——本机件 providers/agent_bindings 未就位，降级两维）'
  if (!patterns.terms.length) console.error('[warn] 本机标识词表为空——本包门禁实际两维（uuid/盘符）；在装好本机件的机器上重打包可得三维门禁')
  // skip=自指性文件：白名单注册件本身存豁免串（含盘符样例），扫则自咬——其 contains/reason
  // 已由 validateWhitelist 注册件自检覆盖（uuid/本机标识/理由盘符三项，回炉 W3a）
  const hits = scanTree(outDir, patterns, wl.entries || [], ['scripts/share-whitelist.json'])
  if (hits.length) {
    console.error(`[RED] 分享面门禁未过（${hits.length} 命中——个人/本机事实泄漏面；输出目录含导出副本：勿提交、排查后删除）：`)
    for (const h of hits) console.error(`  ${h.file}:${h.no} [${h.hits.join('|')}] ${h.line}`)
    console.error('处置=清源后重新打包；确属历史叙述的白名单登记（scripts/share-whitelist.json 逐条理由）')
    process.exit(1)
  }
  const manifestRel = 'MANIFEST.txt'
  writeFileSync(join(outDir, manifestRel), buildManifest(outDir, head, manifestRel), 'utf8')
  console.log(`分享包就绪：${outDir}（git=${head.slice(0, 12)}，含 MANIFEST；门禁零命中——${dims}）`)
  process.exit(0)
}

function readJsonWL() {
  return JSON.parse(readFileSync(join(SKILL_ROOT, 'scripts', 'share-whitelist.json'), 'utf8').replace(/^\uFEFF/, ''))
}
