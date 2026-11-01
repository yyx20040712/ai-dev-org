#!/usr/bin/env node
/** dispatch-pack——最终派发审包只读计量与门禁工具（W5b R2-T2 D-1；plan-b8plus §5.3:139-140）。
 *
 *  职责边界：只对给定审包文件做①全文 token 计量（UTF-8 bytes÷4 向上取整，上限 8192，
 *  不做 trim/规范化/剔除）；②无显式授权时的未授权仓库访问扫描（元数据＋正文逐行，
 *  越权四面：仓库绝对根／命令形或授权语义 Read/Bash／命令形 git <子命令>／file:// URI；
 *  仅 `源标签:行号「片段」` 形态的引用行可豁免②③词汇命中，①④无豁免）；③审包恰含一条
 *  ROUTE 行时的三方对账（复用 agent-slots dispatch-check 子进程契约：--route=该整行、
 *  --plan=oracle、--project=项目根；禁复制第二套对账逻辑）。不生成、不瘦身、不派发、
 *  不改写审包；token 是规定计量值，不宣称等于任一模型分词器结果。
 *
 *  用法：node scripts/dispatch-pack.mjs --pack <审包文件> [--plan <dispatch-plan.md>] [--project <dir>] [--repo-access]
 *        [--face <full|repo-access>] [--redact]
 *        node scripts/dispatch-pack.mjs --self-test
 *  --face 感知预算（W5b D-7）：缺省 full=8192；repo-access=4096 且须同时显式 --repo-access；
 *  --redact 诊断脱敏（opt-in）：三类可证词法命中逐条只给类别/行号/sha8（禁回显原文），
 *  命中 exit 1／零命中 exit 0；无 --face 且无 --redact 时摘要逐字节保持现行形态。
 *  --repo-access 是显式 repo_access=true 的唯一来源，只豁免越权扫描，不豁免计量、
 *  ROUTE 对账、输入装载或用法检查；等号旗标、未知旗标、缺值、额外位置参数均为用法错；
 *  --self-test 须独立运行，不得与其他参数混用。
 *  退出码 0/1/3（禁复用 2），唯一真相源=references/06-model-routing.md §5.8：
 *  0=通过；1=用法错或门禁未过（超限/越权/ROUTE 对账失败）；3=必需输入不可读。
 */
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { SKILL_ROOT, loadOrgConfig, UsageError } from './org-config.mjs'
import { ROLE_ORDER } from './gen-agents.mjs'

const SELF = fileURLToPath(import.meta.url)
const AGENT_SLOTS = join(dirname(SELF), 'agent-slots.mjs')
const TOKEN_LIMIT = 8192
const LIMIT_BYTES = TOKEN_LIMIT * 4
/** 越权①仓库绝对根（本仓＋技能仓；引用行亦不豁免）。 */
const REPO_ROOTS = ['/home/yyx/work/aidevorg', '/home/yyx/.zcode/skills/ai-dev-org']
/** 越权④ file:// URI（引用行亦不豁免）。 */
const FILE_URI_RE = /file:\/\//
/** 越权②命令形或授权语义的 Read/Bash：工具调用形态 `Read(`/`Bash(`、双词形态
 *  `Read/Bash`、授权语义（授权使用/授权/允许/许可/可使用/启用＋Read|Bash、Read|Bash＋授权/权限/工具）、
 *  无括号命令形（`Read /tmp/x`＝Read＋路径形 token、`Bash ls -la`＝Bash＋ASCII 命令词）——r5 B-1 补面。 */
const READBASH_RE = /\b(?:Read|Bash)\s*\(|\bRead\/Bash\b|(?:授权使用|授权|允许|许可|可使用|启用)\s*(?:Read|Bash)\b|(?:Read|Bash)\s*(?:授权|权限|工具)|\bRead\s+(?:\/|~|[A-Za-z]:[\\/])|\bBash\s+[A-Za-z][A-Za-z0-9_.-]*(?:\s|$)/
/** 越权③命令形 git <子命令>（含全局选项位于 git 与子命令之间的 `git -C <dir> <子>`、
 *  `git -c k=v <子>` 形态——选项 token 及其取值逐个跳过后仍须落到 ASCII 子命令词；r5 B-1 补面）。 */
const GIT_RE = /\bgit\s+(?:-{1,2}[A-Za-z][\w.-]*(?:\s+[^\s;、。)「」]+)?\s+)*[A-Za-z][A-Za-z-]*/
/** 引用行形态：`源标签:行号「片段」`——仅该形态所在行可豁免②③词汇命中。 */
const CITE_RE = /[^\s「」`]+:\d+「[^」]*」/g
const ROUTE_LINE_RE = /^\s*ROUTE\s*:/i
/** face 感知预算（W5b D-7）：full=8192（缺省·维持现行形态）；repo-access=4096（须同时显式 --repo-access）。
 *  repo-access 面真实最大包=456T（W8 证据档 :13 授权面包·同为 --repo-access 旗标面），4096/456≈9.0 倍余量。 */
const FACE_LIMITS = { full: TOKEN_LIMIT, 'repo-access': 4096 }
/** 诊断脱敏（W5b D-7·--redact opt-in）三类可证词法：uuid 8-4-4-4-12 十六进制／Bearer＋长度 ≥24 令牌／
 *  键名含 token|key|secret（大小写不敏感）的赋值（值 ≥8 字符）。哈希输入=命中片段去首尾空白后的
 *  UTF-8 字节，取 sha256 十六进制前 8 位。输出只含类别/行号/sha8，禁回显原文；命中态下越权片段
 *  回显同样掩蔽（r5·组合态闭合——同输出内不得出现任何命中片段原文）。词法残余登记（r5·本批不扩）：
 *  bearer 大小写敏感、引号包裹值、冒号形 token: value 为规格内已知漏检形态。 */
const REDACT_RES = [
  ['uuid-binding', /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g],
  ['bearer', /Bearer[ \t]+[A-Za-z0-9._~+/=-]{24,}/g],
  ['key-assign', /[A-Za-z0-9_.-]*(?:token|key|secret)[A-Za-z0-9_.-]*[ \t]*=[ \t]*[A-Za-z0-9._~+/-]{8,}/gi],
]

/** 逐行越权扫描：①④对整行判（引用不豁免）；②③先掩蔽引用 span 再判。 */
export function scanLine(line) {
  const cats = []
  for (const root of REPO_ROOTS) if (String(line).includes(root)) { cats.push('repo-root'); break }
  if (FILE_URI_RE.test(line)) cats.push('file-uri')
  const masked = String(line).replace(CITE_RE, (m) => ' '.repeat(m.length))
  if (READBASH_RE.test(masked)) cats.push('readbash')
  if (GIT_RE.test(masked)) cats.push('git')
  return cats
}

function parseArgs(argv) {
  const flags = { pack: null, plan: null, project: null, repoAccess: false, selfTest: false, face: null, redact: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--repo-access') { flags.repoAccess = true; continue }
    if (a === '--self-test') { flags.selfTest = true; continue }
    if (a === '--redact') { flags.redact = true; continue }
    if (a === '--face') {
      if (flags.face !== null) throw new UsageError('flag --face 重复给值（用法错）')
      const val = argv[i + 1]
      if (val === undefined) throw new UsageError('flag --face 居末位无值（缺值=用法错）')
      if (val.startsWith('--')) throw new UsageError(`flag --face 的值形如 flag（「${val}」——误吃下一 flag=用法错）`)
      if (val !== 'full' && val !== 'repo-access') throw new UsageError(`flag --face 非法值「${val}」（须 full|repo-access）`)
      flags.face = val
      i++
      continue
    }
    if (a === '--pack' || a === '--plan' || a === '--project') {
      const val = argv[i + 1]
      if (val === undefined) throw new UsageError(`flag ${a} 居末位无值（缺值=用法错）`)
      if (val.startsWith('--')) throw new UsageError(`flag ${a} 的值形如 flag（「${val}」——误吃下一 flag=用法错）`)
      flags[a.slice(2)] = val
      i++
      continue
    }
    if (a.startsWith('--')) {
      if (a.includes('=')) throw new UsageError(`flag 等号形态「${a}」不支持——flag 一律空格分隔取值`)
      throw new UsageError(`未识别的 flag「${a}」——合法 flag：--pack, --plan, --project, --repo-access, --face, --redact, --self-test`)
    }
    throw new UsageError(`额外位置参数「${a}」——本命令只接受 flag`)
  }
  return flags
}

function main() {
  const argv = process.argv.slice(2)
  const flags = parseArgs(argv)
  if (flags.selfTest) {
    if (argv.length > 1) throw new UsageError('--self-test 须独立运行，不得与其他参数混用')
    selfTest()
    return
  }
  if (!flags.pack) throw new UsageError('缺少必需 flag --pack <审包文件>')
  if (flags.face === 'repo-access' && !flags.repoAccess) throw new UsageError('--face repo-access 须同时显式给 --repo-access（用法错）')

  let raw
  try {
    raw = readFileSync(resolve(flags.pack))
  } catch (e) {
    console.error(`[装载错] 审包文件不可读（${flags.pack}）：${e.message}`)
    process.exit(3)
  }
  const bytes = Buffer.byteLength(raw, 'utf8')
  const tokens = Math.ceil(bytes / 4)
  const limit = flags.face !== null ? FACE_LIMITS[flags.face] : TOKEN_LIMIT
  const overLimit = tokens > limit
  const text = raw.toString('utf8')
  const lines = text.split(/\r?\n/)

  const violations = []
  if (!flags.repoAccess) {
    lines.forEach((ln, idx) => {
      const cats = scanLine(ln)
      if (cats.length) violations.push({ line: idx + 1, cats, text: ln.trim().slice(0, 80) })
    })
  }

  // 诊断脱敏（W5b D-7·--redact opt-in）：逐行三类词法命中，逐条只给类别/行号/sha8，禁回显原文；
  // 命中→exit 1（fail-closed）；零命中→exit 0；无 --redact 时摘要不含任何 redact 字段。
  let redactHits = 0
  const redactFrags = []
  if (flags.redact) {
    lines.forEach((ln, idx) => {
      for (const [cat, re] of REDACT_RES) {
        for (const m of String(ln).matchAll(re)) {
          const frag = String(m[0])
          const sha8 = createHash('sha256').update(frag.trim(), 'utf8').digest('hex').slice(0, 8)
          console.error(`[redact] 类别=${cat} 行=${idx + 1} sha8=${sha8}`)
          redactFrags.push(frag)
          redactHits++
        }
      }
    })
  }

  const routeLines = []
  lines.forEach((ln, idx) => { if (ROUTE_LINE_RE.test(ln)) routeLines.push({ line: idx + 1, text: ln.replace(/\r$/, '') }) })
  let routeCheck = 'SKIP'
  const routeReasons = []
  if (routeLines.length > 1) {
    routeCheck = 'FAIL'
    routeReasons.push(`审包含 ${routeLines.length} 条 ROUTE 行（行号 ${routeLines.map((r) => r.line).join(',')}）——恰一条才可对账`)
  } else if (routeLines.length === 1) {
    if (!flags.plan) throw new UsageError('审包含 ROUTE 行而缺 --plan <dispatch-plan.md>——ROUTE 三方对账必需（用法错）')
    if (!flags.project) {
      console.error('[装载错] 审包含 ROUTE 行而缺 --project <dir>——ROUTE 对账必需输入（项目根须含 docs/agent-matrix.json）')
      printSummary(flags, bytes, tokens, 'FAIL', redactHits)
      process.exit(3)
    }
    const r = spawnSync(process.execPath, [AGENT_SLOTS, 'dispatch-check', '--plan', resolve(flags.plan), '--route', routeLines[0].text, '--project', resolve(flags.project)], { encoding: 'utf8' })
    if (r.error) {
      console.error(`[装载错] ROUTE 对账子进程启动失败：${r.error.message}`)
      printSummary(flags, bytes, tokens, 'FAIL', redactHits)
      process.exit(3)
    }
    if (r.status === 0) {
      routeCheck = 'PASS'
    } else if (r.status === 1) {
      routeCheck = 'FAIL'
      routeReasons.push('ROUTE 三方对账失败（dispatch-check 契约·逐岗 diff 如下）：')
      if ((r.stderr || '').trim()) routeReasons.push(r.stderr.trim())
    } else {
      console.error('[装载错] ROUTE 对账必需输入不可读（dispatch-check 装载错回显如下）：')
      if ((r.stderr || '').trim()) console.error(r.stderr.trim())
      printSummary(flags, bytes, tokens, 'FAIL', redactHits)
      process.exit(3)
    }
  }

  const code = (overLimit || violations.length || routeCheck === 'FAIL' || redactHits > 0) ? 1 : 0
  if (overLimit) console.error(`[FAIL] 计量超限：tokens=${tokens} > limit ${limit}（bytes=${bytes}）——阻断派发，须瘦身重包`)
  for (const v of violations) {
    // r5 组合态闭合：--redact 命中态下越权回显片段中的命中原文一律掩蔽（同输出零原文）
    let vText = v.text
    if (flags.redact) for (const frag of redactFrags) if (vText.includes(frag)) vText = vText.split(frag).join('[REDACTED]')
    console.error(`[越权] 第 ${v.line} 行 类别=${v.cats.join('/')} 片段=${JSON.stringify(vText)}`)
  }
  for (const msg of routeReasons) console.error(`[FAIL] ${msg}`)
  printSummary(flags, bytes, tokens, routeCheck, redactHits)
  console.log(`dispatch-pack 判定：${code === 0 ? 'PASS' : 'FAIL'}`)
  process.exit(code)
}

function printSummary(flags, bytes, tokens, routeCheck, redactHits = 0) {
  // 摘要形态（W5b D-7）：无 --face 且无 --redact 时逐字节保持现行形态（不含 face/redact 字段）；
  // --face 时附 face=<f> limit_full=8192 limit_repo_access=4096；--redact 时附 redact=true redact_hits=N。
  const limit = flags.face !== null ? FACE_LIMITS[flags.face] : TOKEN_LIMIT
  let line = `dispatch-pack 摘要：bytes=${bytes} tokens=${tokens} limit=${limit} repo_access=${flags.repoAccess} route_check=${routeCheck}`
  if (flags.face !== null) line += ` face=${flags.face} limit_full=${TOKEN_LIMIT} limit_repo_access=${FACE_LIMITS['repo-access']}`
  if (flags.redact) line += ` redact=true redact_hits=${redactHits}`
  console.log(line)
}

// ── --self-test（≥18 向量；夹具落 os.tmpdir()/w5b-t2-dispatch-doctor-dp-*，用毕清理）──
function selfTest() {
  let fails = 0
  let n = 0
  const t = (name, cond) => (n++, console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`), cond || fails++)
  const runPack = (args) => spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8' })
  const outOf = (r) => `${r.stdout || ''}${r.stderr || ''}`
  const sumOf = (r) => /dispatch-pack 摘要：([^\n]+)/.exec(outOf(r))?.[1] || ''
  const codes = new Set()
  const tmp = mkdtempSync(join(tmpdir(), 'w5b-t2-dispatch-doctor-dp-'))
  try {
    const write = (name, content) => { const p = join(tmp, name); writeFileSync(p, content); return p }
    const okBody = '# 审包正例\n\n正文片段，不含越权词汇。\n'
    const noRoute = write('no-route.md', okBody)
    const sum1 = (r, want) => sumOf(r) === `bytes=${Buffer.byteLength(okBody)} tokens=${Math.ceil(Buffer.byteLength(okBody) / 4)} limit=8192 repo_access=false route_check=${want}`

    // 对账夹具：真实技能配置派生九岗 plan＋合成项目根（同 agent-slots 向量 53 形态）
    const mergedNow = loadOrgConfig(SKILL_ROOT).merged
    const defaultsNow = mergedNow.agent_defaults
    const providerOf = (slot) => { const m = /^ops-([a-z]+)-(.+)-([a-z]+)$/.exec(String(slot)); return m ? m[2] : '?' }
    const R0_ENABLED = ['assembler', 'executor', 'tbreview', 'implreview', 'adjudicator', 'vision']
    const routeNow = `ROUTE: ${R0_ENABLED.map((r) => `${r}-${providerOf(defaultsNow[r])}`).join(';')}`
    const secondSlot = 'ops-implreview-ds-max'
    const planText = (routeLine) => {
      const enOf = (r) => (R0_ENABLED.includes(r) ? '是' : '否')
      const rowOf = (label, r) => `| ${label} | ${defaultsNow[r]} | 本机件 agent_defaults（S4） | ${enOf(r)} | 理由-${r} |`
      return ['# 合成 dispatch-plan（dispatch-pack 自检夹具）', '', '## 1. 九岗实选表', '',
        '| 岗位 | 实际 slot | route_source | 启用 | 理由 |', '|---|---|---|---|---|',
        rowOf('research', 'research'), rowOf('planner', 'planner'), rowOf('assembler', 'assembler'),
        rowOf('executor', 'executor'), rowOf('tbreview', 'tbreview'), rowOf('planreview', 'planreview'),
        rowOf('implreview（第一席）', 'implreview'),
        `| implreview（第二席·常设） | ${secondSlot} | S1 series_process.reviewer_second（常设第二审） | 是 | 理由-第二席 |`,
        rowOf('adjudicator', 'adjudicator'), rowOf('vision', 'vision'), '',
        '## 2. 批 ROUTE', '', '```', routeLine, '```', ''].join('\n')
    }
    const planPath = write('plan.md', planText(routeNow))
    const proj = join(tmp, 'proj')
    mkdirSync(join(proj, 'docs'), { recursive: true })
    writeFileSync(join(proj, 'docs', 'agent-matrix.json'), JSON.stringify({ roles: {}, series_process: { reviewer_second: secondSlot } }))

    // 向量1：无 ROUTE 正例——exit 0＋摘要 tokens=ceil(bytes/4)＋route_check=SKIP
    const r1 = runPack(['--pack', noRoute])
    codes.add(r1.status)
    t('向量1 无 ROUTE 正例：exit 0＋摘要 bytes/tokens=ceil(bytes/4)/limit=8192/repo_access=false/route_check=SKIP',
      r1.status === 0 && sum1(r1, 'SKIP'), sumOf(r1))

    // 向量2：ROUTE 正例对账——exit 0＋route_check=PASS
    const routePack = write('route-ok.md', `# 审包（含正例 ROUTE）\n\n${routeNow}\n`)
    const r2 = runPack(['--pack', routePack, '--plan', planPath, '--project', proj])
    codes.add(r2.status)
    t('向量2 ROUTE 正例：exit 0＋route_check=PASS（dispatch-check 三方对账复用）',
      r2.status === 0 && sumOf(r2).endsWith('route_check=PASS'), `${r2.status} ${sumOf(r2)} ${outOf(r2).slice(-160)}`)

    // 向量3/4：8192/8193 边界（ASCII 逐字节）
    const b8192 = write('b8192.md', 'x'.repeat(32768))
    const b8193 = write('b8193.md', 'x'.repeat(32769))
    const r3 = runPack(['--pack', b8192])
    const r4 = runPack(['--pack', b8193])
    codes.add(r3.status); codes.add(r4.status)
    t('向量3 8192 边界：32768 字节→exit 0＋tokens=8192', r3.status === 0 && sumOf(r3).includes('bytes=32768 tokens=8192'), sumOf(r3))
    t('向量4 8193 边界：32769 字节→exit 1＋tokens=8193（上限阻断）', r4.status === 1 && sumOf(r4).includes('bytes=32769 tokens=8193'), sumOf(r4))

    // 向量5：多字节 UTF-8 按字节而非字符计量：'中'×10922＋'ab'=32768 字节（字符 10924）
    const mb = write('mb.md', '中'.repeat(10922) + 'ab')
    const r5 = runPack(['--pack', mb])
    codes.add(r5.status)
    t('向量5 多字节计量：10924 字符=32768 字节→exit 0＋bytes=32768/tokens=8192（÷4 按字节）',
      r5.status === 0 && sumOf(r5).includes('bytes=32768 tokens=8192'), sumOf(r5))

    // 向量6-10：越权四面（无授权逐件 exit 1＋类别与行号点名）
    const vRootMain = write('v-root-main.md', '# 元数据\n\nowner: /home/yyx/work/aidevorg 相关\n')
    const vRootSkill = write('v-root-skill.md', '# 元数据\n\nroot: /home/yyx/.zcode/skills/ai-dev-org 在案\n')
    const vBash = write('v-bash.md', '# 正文\n\n可执行 Bash(ls -la) 巡检。\n')
    const vGit = write('v-git.md', '# 正文\n\n随后执行 git commit 提交。\n')
    const vUri = write('v-uri.md', '# 正文\n\n附件见 file:///tmp/x.md。\n')
    const x6 = runPack(['--pack', vRootMain])
    const x7 = runPack(['--pack', vRootSkill])
    const x8 = runPack(['--pack', vBash])
    const x9 = runPack(['--pack', vGit])
    const x10 = runPack(['--pack', vUri])
    codes.add(x6.status); codes.add(x7.status); codes.add(x8.status); codes.add(x9.status); codes.add(x10.status)
    const out6 = outOf(x6); const out7 = outOf(x7); const out8 = outOf(x8); const out9 = outOf(x9); const out10 = outOf(x10)
    t('向量6 越权①主仓绝对根：exit 1＋类别 repo-root＋行号点名', x6.status === 1 && out6.includes('repo-root') && /第 3 行/.test(out6), out6.slice(-200))
    t('向量7 越权①技能仓绝对根：exit 1＋repo-root（双根覆盖）', x7.status === 1 && out7.includes('repo-root') && out7.includes('/home/yyx/.zcode/skills/ai-dev-org'), out7.slice(-200))
    t('向量8 越权②命令形 Bash：exit 1＋类别 readbash＋行号点名', x8.status === 1 && out8.includes('readbash') && /第 3 行/.test(out8), out8.slice(-200))
    t('向量9 越权③命令形 git：exit 1＋类别 git＋行号点名', x9.status === 1 && out9.includes('git') && /第 3 行/.test(out9), out9.slice(-200))
    t('向量10 越权④file:// URI：exit 1＋类别 file-uri＋行号点名', x10.status === 1 && out10.includes('file-uri') && /第 3 行/.test(out10), out10.slice(-200))

    // 向量11：合法引用豁免对照——引用行 Read/Bash/git 词汇豁免；绝对根/file URI 引用行亦不豁免
    const citeOk = write('cite-ok.md', '# 审包\n\nhandoff-36:13「CI 基线常量随批更新，用 Bash 授权脚本与 git commit 前置检查」\n\n正文收尾。\n')
    const citeRoot = write('cite-root.md', '# 审包\n\nhandoff-36:13「主仓根 /home/yyx/work/aidevorg 在案」\n')
    const citeUri = write('cite-uri.md', '# 审包\n\nhandoff-36:13「用 file:// 协议取附件」\n')
    const c1 = runPack(['--pack', citeOk])
    const c2 = runPack(['--pack', citeRoot])
    const c3 = runPack(['--pack', citeUri])
    codes.add(c1.status); codes.add(c2.status); codes.add(c3.status)
    t('向量11 引用豁免对照：合法 源标签:行号「片段」引用行 Read/Bash/git 词汇过（exit 0）；绝对根与 file:// 在引用行也不过（各 exit 1）',
      c1.status === 0 && c2.status === 1 && outOf(c2).includes('repo-root') && c3.status === 1 && outOf(c3).includes('file-uri'),
      `${c1.status}/${c2.status}/${c3.status} ${outOf(c2).slice(-120)}`)

    // 向量12/13：--repo-access 放行扫描但不豁免计量
    const violBody = '# 审包\n\nowner: /home/yyx/work/aidevorg\n可用 Read(/tmp/x) 与 Bash(ls) 巡检；git status 只读；file:///tmp/y 备查。\n'
    const violPack = write('viol.md', violBody)
    const a1 = runPack(['--pack', violPack, '--repo-access'])
    const padTo = (n) => violBody + ('# padding\n' + 'p'.repeat(Math.max(0, n - Buffer.byteLength(violBody) - 11)) + '\n')
    const a2 = runPack(['--pack', write('viol-big.md', padTo(32769)), '--repo-access'])
    codes.add(a1.status); codes.add(a2.status)
    t('向量12 显式授权放行：越权包＋--repo-access → exit 0＋repo_access=true',
      a1.status === 0 && sumOf(a1).includes('repo_access=true'), `${a1.status} ${sumOf(a1)}`)
    t('向量13 授权不豁免计量：授权包扩至 32769 字节→exit 1＋tokens=8193',
      a2.status === 1 && sumOf(a2).includes('bytes=32769 tokens=8193'), `${a2.status} ${sumOf(a2)}`)

    // 向量14：多 ROUTE 行 → 对账失败 exit 1
    const multi = write('multi-route.md', `# 审包\n\n${routeNow}\n${routeNow}\n`)
    const m1 = runPack(['--pack', multi, '--plan', planPath, '--project', proj])
    codes.add(m1.status)
    t('向量14 多 ROUTE 行：exit 1＋route_check=FAIL＋行号点名', m1.status === 1 && sumOf(m1).endsWith('route_check=FAIL') && outOf(m1).includes('2 条 ROUTE 行'), `${m1.status} ${outOf(m1).slice(-160)}`)

    // 向量15：stale ROUTE（R0 反例 fixture）→ exit 1＋route_check=FAIL＋逐岗 diff 来自 dispatch-check
    const stale = write('stale.md', `# 审包\n\nROUTE: executor-startplan;implreview-699;adjudicator-zipoo\n`)
    const s1 = runPack(['--pack', stale, '--plan', planPath, '--project', proj])
    codes.add(s1.status)
    t('向量15 stale ROUTE：exit 1＋route_check=FAIL＋dispatch-check 逐岗 diff 回显（陈旧/未列入）',
      s1.status === 1 && sumOf(s1).endsWith('route_check=FAIL') && outOf(s1).includes('陈旧') && outOf(s1).includes('未列入 ROUTE'), `${s1.status} ${outOf(s1).slice(-240)}`)

    // 向量16：畸形 ROUTE（未知角色）→ exit 1＋route_check=FAIL
    const bad = write('bad-route.md', '# 审包\n\nROUTE: nosuchrole-glm\n')
    const b1 = runPack(['--pack', bad, '--plan', planPath, '--project', proj])
    codes.add(b1.status)
    t('向量16 畸形 ROUTE：exit 1＋route_check=FAIL（dispatch-check 校验拒绝）',
      b1.status === 1 && sumOf(b1).endsWith('route_check=FAIL'), `${b1.status} ${outOf(b1).slice(-160)}`)

    // 向量17-19：缺输入=3（--pack 不存在／--plan 不可读／缺 --project 必需矩阵）
    const l1 = runPack(['--pack', join(tmp, 'no-such-pack.md')])
    const l2 = runPack(['--pack', routePack, '--plan', join(tmp, 'no-such-plan.md'), '--project', proj])
    const l3 = runPack(['--pack', routePack, '--plan', planPath])
    codes.add(l1.status); codes.add(l2.status); codes.add(l3.status)
    t('向量17 缺输入：--pack 不存在→exit 3＋[装载错]', l1.status === 3 && outOf(l1).includes('[装载错]'), `${l1.status} ${outOf(l1).slice(-120)}`)
    t('向量18 缺输入：--plan 不可读→exit 3＋[装载错]', l2.status === 3 && outOf(l2).includes('[装载错]'), `${l2.status} ${outOf(l2).slice(-120)}`)
    t('向量19 缺输入：含 ROUTE 而缺 --project 必需矩阵→exit 3＋[装载错]', l3.status === 3 && outOf(l3).includes('[装载错]'), `${l3.status} ${outOf(l3).slice(-120)}`)

    // 向量20-22：用法错=1（缺 --pack／未知·等号·缺值·额外参数／ROUTE 缺 --plan／--self-test 混用）
    const u1 = runPack([])
    const u2a = runPack(['--pack', noRoute, '--bogus'])
    const u2b = runPack([`--pack=${noRoute}`])
    const u2c = runPack(['--pack'])
    const u2d = runPack(['--pack', noRoute, 'extra-pos'])
    const u3 = runPack(['--pack', write('route-noplan.md', `# 审包\n\n${routeNow}\n`)])
    const u4 = runPack(['--self-test', '--pack', noRoute])
    codes.add(u1.status); codes.add(u2a.status); codes.add(u2b.status); codes.add(u2c.status); codes.add(u2d.status); codes.add(u3.status); codes.add(u4.status)
    t('向量20 用法错：缺 --pack flag→exit 1＋[用法错]', u1.status === 1 && outOf(u1).includes('[用法错]'), `${u1.status}`)
    t('向量21 用法错：未知 flag／等号形态／缺值居末位／额外位置参数均 exit 1',
      u2a.status === 1 && outOf(u2a).includes('未识别的 flag') && u2b.status === 1 && outOf(u2b).includes('等号形态') &&
      u2c.status === 1 && outOf(u2c).includes('居末位') && u2d.status === 1 && outOf(u2d).includes('额外位置参数'),
      `${u2a.status}/${u2b.status}/${u2c.status}/${u2d.status}`)
    t('向量22 用法错：含 ROUTE 而缺 --plan→exit 1；--self-test 与其他参数混用→exit 1',
      u3.status === 1 && outOf(u3).includes('--plan') && u4.status === 1 && outOf(u4).includes('混用'), `${u3.status}/${u4.status}`)

    // 向量25-31（r5 B-1 补面·插于 23/24 前）：无括号命令形/授权语义 Read/Bash 与
    // git 全局选项形态负例＋合法引用行豁免保持＋散文词形防假阳性。
    const rB1 = (name, body) => runPack(['--pack', write(`b1-${name}.md`, body)])
    const b25 = rB1('auth-use', '# 审包\n\n授权使用 Bash 执行巡检。\n')
    const b26 = rB1('read-path', '# 审包\n\n读取面：Read /tmp/x.md 摘要。\n')
    const b27 = rB1('bash-cmd', '# 审包\n\n执行形：Bash ls -la /tmp。\n')
    const b28 = rB1('git-C', '# 审包\n\n随后 git -C /tmp/wk status。\n')
    const b29 = rB1('git-c', '# 审包\n\n随后 git -c core.hooksPath=/x commit -m x。\n')
    const b30 = rB1('cite-new', '# 审包\n\nR0-impl:3「用 git -C /tmp/wk status 与 Read /tmp/x.md 核对补面」\n')
    const b31 = rB1('prose', '# 审包\n\n正文提及 Readme 文件与 gitea 仓库名词（非命令形）。\n')
    codes.add(b25.status); codes.add(b26.status); codes.add(b27.status); codes.add(b28.status); codes.add(b29.status); codes.add(b30.status); codes.add(b31.status)
    t('向量25 越权②补面：授权使用 Bash→exit 1＋readbash', b25.status === 1 && outOf(b25).includes('readbash'), `${b25.status}`)
    t('向量26 越权②补面：无括号命令形 Read /tmp/x→exit 1＋readbash', b26.status === 1 && outOf(b26).includes('readbash'), `${b26.status}`)
    t('向量27 越权②补面：无括号命令形 Bash ls -la→exit 1＋readbash', b27.status === 1 && outOf(b27).includes('readbash'), `${b27.status}`)
    t('向量28 越权③补面：git -C <dir> <子命令>（非仓库根）→exit 1＋git', b28.status === 1 && outOf(b28).includes('git') && !outOf(b28).includes('repo-root'), `${b28.status}`)
    t('向量29 越权③补面：git -c k=v <子命令>→exit 1＋git', b29.status === 1 && outOf(b29).includes('git'), `${b29.status}`)
    t('向量30 引用豁免保持：合法引用行内 git -C／Read 路径形（r5 新形态）→exit 0', b30.status === 0, `${b30.status} ${outOf(b30).slice(-80)}`)
    t('向量31 防假阳性：散文词形 Readme/gitea（无空格命令形）→exit 0', b31.status === 0, `${b31.status}`)

    // ── W5b D-7 face 感知预算＋诊断脱敏（恰 6 向量·31→37）──
    const facePack = write('face-pack.md', okBody)
    const f1 = runPack(['--pack', facePack, '--face', 'repo-access', '--repo-access'])
    codes.add(f1.status)
    t('向量32 --face repo-access 正例：exit 0＋摘要含 face=repo-access limit_full=8192 limit_repo_access=4096',
      f1.status === 0 && sumOf(f1).includes('face=repo-access limit_full=8192 limit_repo_access=4096'), `${f1.status} ${sumOf(f1)}`)
    const f2 = runPack(['--pack', facePack, '--face', 'full'])
    codes.add(f2.status)
    t('向量33 --face full 正例：exit 0＋摘要含 face=full limit_full=8192 limit_repo_access=4096',
      f2.status === 0 && sumOf(f2).includes('face=full limit_full=8192 limit_repo_access=4096'), `${f2.status} ${sumOf(f2)}`)
    const f3a = runPack(['--pack', facePack, '--face', 'repo-access'])
    const f3b = runPack(['--pack', facePack, '--face', 'bogus'])
    const f3c = runPack(['--pack', facePack, '--face=repo-access', '--repo-access'])
    const f3d = runPack(['--pack', facePack, '--face', 'full', '--face', 'repo-access', '--repo-access'])
    codes.add(f3a.status); codes.add(f3b.status); codes.add(f3c.status); codes.add(f3d.status)
    t('向量34 --face 用法错四面：缺 --repo-access／非法值／等号形态／重复给值均 exit 1',
      f3a.status === 1 && f3b.status === 1 && f3c.status === 1 && f3d.status === 1, `${f3a.status}/${f3b.status}/${f3c.status}/${f3d.status}`)
    const redBody = '# 审包 redact\n\nuuid=deadbeef-cafe-babe-1234-567890abcdef 与 Bearer tok-abcdefghijklmnopqrstuvwxyz 与 secret_key=SuperSecretValue123 结尾。\n'
    const redPack = write('redact-pack.md', redBody)
    const redBefore = createHash('sha256').update(readFileSync(redPack)).digest('hex')
    const rd1 = runPack(['--pack', redPack, '--redact'])
    codes.add(rd1.status)
    const redAfter = createHash('sha256').update(readFileSync(redPack)).digest('hex')
    const rd1Out = outOf(rd1)
    t('向量35 --redact 三类命中：exit 1＋摘要 redact=true redact_hits=3＋逐条类别/行号/sha8＋不含原文＋审包零改动',
      rd1.status === 1 && sumOf(rd1).includes('redact=true redact_hits=3')
        && (rd1Out.match(/sha8=[0-9a-f]{8}/g) || []).length === 3
        && rd1Out.includes('uuid-binding') && rd1Out.includes('bearer') && rd1Out.includes('key-assign')
        && !rd1Out.includes('deadbeef-cafe-babe-1234-567890abcdef') && !rd1Out.includes('tok-abcdefghijklmnopqrstuvwxyz') && !rd1Out.includes('SuperSecretValue123')
        && redBefore === redAfter,
      `${rd1.status} ${rd1Out.slice(-300)}`)
    const rd2 = runPack(['--pack', facePack, '--redact'])
    codes.add(rd2.status)
    t('向量36 --redact 零命中：exit 0＋摘要 redact=true redact_hits=0',
      rd2.status === 0 && sumOf(rd2).includes('redact=true redact_hits=0'), `${rd2.status} ${sumOf(rd2)}`)
    t('向量37 sha8 复算核对（去首尾空白 UTF-8 sha256 前 8 位）＋缺省摘要不含 face/redact 字段', (() => {
      const sha8 = createHash('sha256').update('secret_key=SuperSecretValue123', 'utf8').digest('hex').slice(0, 8)
      const rdLine = rd1Out.split('\n').find((l) => l.includes('key-assign')) ?? ''
      return rdLine.includes('sha8=' + sha8) && !sumOf(r1).includes('face=') && !sumOf(r1).includes('redact')
    })(), `rdLine=${rd1Out.split('\n').find((l) => l.includes('key-assign')) ?? ''} sha8want=${createHash('sha256').update('secret_key=SuperSecretValue123', 'utf8').digest('hex').slice(0, 8)}`)
    // ── W5b r5 增补（D-7 组合态闭合·恰 1 向量·37→38）──
    const comboPack = write('combo.md', '# 审包组合\n\nowner: /home/yyx/work/aidevorg 且 secret_key=ComboSecretValue77 在案\n')
    const cb1 = runPack(['--pack', comboPack, '--redact'])
    codes.add(cb1.status)
    const cb1Out = outOf(cb1)
    t('向量38 redact×越权组合掩蔽（r5）：命中态下全输出无任何命中片段原文（[越权] 回显掩蔽/省略）＋exit 1＋redact_hits=1＋越权类别与脱敏类别仍可观测',
      cb1.status === 1 && sumOf(cb1).includes('redact=true redact_hits=1') && !cb1Out.includes('ComboSecretValue77')
        && cb1Out.includes('repo-root') && cb1Out.includes('key-assign'), `${cb1.status} ${cb1Out.slice(-260)}`)

    // 向量23：退出码域——全部实测退出码 ∈ {0,1,3}（禁复用 2）
    t('向量23 退出码域：全部自检运行退出码恰为 0/1/3 集合（无 2 或其他值）',
      [...codes].every((c) => c === 0 || c === 1 || c === 3), JSON.stringify([...codes].sort()))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  // 向量24：清理——夹具目录已删除
  t('向量24 自检夹具清理：w5b-t2-dispatch-doctor-dp-* 临时目录已删除', !existsSync(tmp))

  console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
  process.exit(fails === 0 ? 0 : 1)
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === SELF.toLowerCase()
if (isMain) {
  try {
    main()
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`[用法错] ${e.message}`)
      process.exit(1)
    }
    throw e
  }
}
