/**
 * 部署自检/首装（v1.7.3 部署能力批）——新机一键体检+可安全自动化项的安装。
 * 退出码口径单源=references/06 §5.8（不复写）。
 * 七项检查（逐项输出 [ok]/[warn]/[FAIL] 主题——处置指引）：
 *   ① node-major   process 主版本 ∈ org-config supported_node.forbid_major → FAIL
 *                  （判据读配置禁硬编码，W-12 同律）
 *   ② skill-files  必备四件存在（SKILL.md/org-config.default.json/
 *                  scripts/org-config.mjs/scripts/roles/registry.json）
 *   ③ org-config   spawn org-config.mjs validate（cwd=SKILL_ROOT）rc≠0 → FAIL
 *                  并透传其末行
 *   ④ agents       清单单源=templates/agents/ops-*.md 枚举；逐件对 --agents-dir
 *                  （缺省 ~/.zcode/agents）：缺失=FAIL（--install 可补）；
 *                  存在但 sha256 不等=[warn] 漂移（人工比对，--install 不覆盖
 *                  ——保护本机定制）
 *   ⑤ hook         git config core.hooksPath：.githooks→ok；未设=FAIL
 *                  （--install 可补）；自定义值=[warn]（不改只提示）；
 *                  git 不可用/非 git 仓=[warn]（zip 安装形态，跳过）
 *   ⑥ remote       git remote 非空=ok；空=[warn]（备份面）；非 git 仓=[warn]
 *   ⑦ ledger-dir   SKILL_ROOT/.zcode/ 试写临时文件后删 → ok/FAIL
 * 汇总行：deploy-check 汇总：ok X/warn Y/FAIL Z——<可部署/处置后复跑/阻断>
 * --install 仅两动作：④缺失清单逐件复制 templates→agents-dir+sha256 复核；
 *   ⑤hooksPath 未设时 git config core.hooksPath .githooks。绝不改
 *   org-config/宿主配置/已存在漂移件；完成后自动复跑七项按同口径退出。
 * 用法：node scripts/deploy-check.mjs [--install] [--self-test] [--agents-dir <dir>]
 * 可 import 纯函数零副作用（isMain guard 惯例；自检向量禁动真实状态）。
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, unlinkSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { SKILL_ROOT, loadOrgConfig, cliFlag } from './org-config.mjs'

const SCRIPTS = join(SKILL_ROOT, 'scripts')
export const TEMPLATES_AGENTS = join(SKILL_ROOT, 'templates', 'agents')
export const DEFAULT_AGENTS_DIR = join(homedir(), '.zcode', 'agents')
export const EXIT_SELF_ERROR = 3 // 自身装载错（口径单源=06 §5.8 行 3）

/** 自身装载错信号（main 捕获→exit 3；判定/业务 FAIL 不走此类）。 */
export class SelfLoadError extends Error {}

/** 文件 sha256（双侧对账/漂移判定单源）。 */
export function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}

/** 多行输出的末行（透传 org-config validate 尾行用）。 */
export const lastLine = (s) => String(s || '').trim().split('\n').filter(Boolean).pop() || ''

// ── 纯函数（--self-test 向量注入位）──

/** ① 主版本判禁：major ∈ forbid_major → FAIL；配置缺省/空=恒 ok（判据读配置禁硬编码）。 */
export function checkNodeMajor(nodeVersion, forbidMajor) {
  const major = Number.parseInt(String(nodeVersion).replace(/^v/, '').split('.')[0], 10)
  const list = Array.isArray(forbidMajor) ? forbidMajor : []
  const hit = list.includes(major)
  return {
    level: hit ? 'FAIL' : 'ok',
    line: hit
      ? `node-major——当前 ${nodeVersion}（主版本 ${major}）∈ 受禁系（org-config supported_node.forbid_major）——改装受支持主版本后复跑`
      : `node-major——${nodeVersion}（主版本 ${major}）不在受禁系`,
  }
}

/** ② 必备四件（技能装载链：入口/默认配置/配置装载器/岗位注册表）。 */
export const REQUIRED_FILES = ['SKILL.md', 'org-config.default.json', 'scripts/org-config.mjs', 'scripts/roles/registry.json']
export function checkRequiredFiles(root, files = REQUIRED_FILES) {
  const missing = files.filter((f) => !existsSync(join(root, f)))
  return {
    level: missing.length ? 'FAIL' : 'ok',
    line: missing.length
      ? `skill-files——缺 ${missing.join('、')}（装载错——重克隆/重装本仓后复跑）`
      : `skill-files——必备 ${files.length} 件齐（${files.join('、')}）`,
  }
}

/** ④ 代理清单单源派生：templates/agents/ops-*.md 枚举（显式排序，evolve-l3 同律）。 */
export function listAgentTemplates(dir = TEMPLATES_AGENTS) {
  return readdirSync(dir).filter((f) => /^ops-.*\.md$/.test(f)).sort()
}

/** ④ 漂移分类（哈希相等性由调用方注入=自检位）：缺失→FAIL/不等→warn/相等→ok。 */
export function classifyAgent({ exists, hashEqual }) {
  if (!exists) return { level: 'FAIL', reason: 'missing', line: '缺失（--install 可补：templates/agents/ 单源复制）' }
  if (!hashEqual) return { level: 'warn', reason: 'drift', line: '存在但 sha256 漂移（人工比对；--install 不覆盖——保护本机定制）' }
  return { level: 'ok', reason: 'match', line: 'sha256 相符' }
}

/** ⑤ hooksPath 值分类（纯值判，spawn 由调用方承担）。 */
export function classifyHookValue(value) {
  const v = String(value || '').trim()
  if (v === '.githooks') return { level: 'ok', line: 'hook——core.hooksPath=.githooks（提交门禁已挂）' }
  if (v === '') return { level: 'FAIL', line: 'hook——core.hooksPath 未设（提交门禁未挂）——可 --install 补，或手跑 git config core.hooksPath .githooks' }
  return { level: 'warn', line: `hook——core.hooksPath=${v}（用户自定义，不改只提示命令：git config core.hooksPath .githooks）` }
}

/** 汇总行+终判（FAIL>0→阻断；warn>0→处置后复跑；否则可部署）。 */
export function summarize(results) {
  const ok = results.filter((r) => r.level === 'ok').length
  const warn = results.filter((r) => r.level === 'warn').length
  const fail = results.filter((r) => r.level === 'FAIL').length
  const verdict = fail > 0 ? '阻断' : warn > 0 ? '处置后复跑' : '可部署'
  return { ok, warn, fail, verdict, line: `deploy-check 汇总：ok ${ok}/warn ${warn}/FAIL ${fail}——${verdict}` }
}

/** 退出码映射（warn 不阻断；自身装载错=3 由 SelfLoadError 路径承载）。 */
export function exitCodeFrom({ failCount = 0, selfTestFailed = false } = {}) {
  return failCount > 0 || selfTestFailed ? 1 : 0
}

// ── 运行态探针（仅 isMain 路径触达；纯函数禁调）──

/** git 仓判定：不可用/非仓→跳过语义；异常→SelfLoadError（exit 3 族）。 */
export function gitState(cwd = SKILL_ROOT) {
  const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8' })
  if (probe.error) return { repo: false, reason: 'git 不可用' }
  if (probe.status !== 0) {
    const err = `${probe.stderr || ''}`
    if (/not a git repository/i.test(err)) return { repo: false, reason: '非 git 仓' }
    throw new SelfLoadError(`git 仓判定异常（exit ${probe.status}：${err.trim()}）`)
  }
  return { repo: true }
}

/** ⑦ 账本目录可写性（试写临时文件后删；目录缺省顺带创建）。 */
export function checkLedgerDir(root = SKILL_ROOT) {
  try {
    const dir = join(root, '.zcode')
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, `.deploy-check-probe-${process.pid}`)
    writeFileSync(probe, 'ok')
    unlinkSync(probe)
    return { level: 'ok', line: 'ledger-dir——SKILL_ROOT/.zcode/ 可写（账本目录就绪）' }
  } catch (e) {
    return { level: 'FAIL', line: `ledger-dir——.zcode/ 不可写（${e.message}）——检查目录权限后复跑` }
  }
}

/** 七项检查主体（打印逐项行并返回结果集；org-config 装载失败/git 判定异常→throw=exit 3）。 */
export function runChecks(agentsDir, cfg) {
  const results = []
  const push = (r) => { results.push(r); console.log(`[${r.level}] ${r.line}`) }

  push(checkNodeMajor(process.version, cfg?.supported_node?.forbid_major))
  push(checkRequiredFiles(SKILL_ROOT))

  const oc = spawnSync(process.execPath, [join(SCRIPTS, 'org-config.mjs'), 'validate'], { cwd: SKILL_ROOT, encoding: 'utf8' })
  if (oc.status === 0) push({ level: 'ok', line: `org-config——validate 通过（${lastLine(oc.stdout)}）` })
  else
    push({
      level: 'FAIL',
      line: `org-config——validate exit ${oc.status}：${lastLine(oc.stderr || oc.stdout)}｜新机最常见断点=providers uuid_prefix/entry_name 与宿主注册表双校验不符——处置=按三元组（alias/期望/实际）对齐 org-config.default.json，或建项目覆盖件 .zcode/org-config.json（深合并覆盖）；宿主 config（key/端点事实）永不改、不入库`,
    })

  for (const name of listAgentTemplates()) {
    const dst = join(agentsDir, name)
    const cls = classifyAgent({ exists: existsSync(dst), hashEqual: existsSync(dst) && sha256File(dst) === sha256File(join(TEMPLATES_AGENTS, name)) })
    push({ level: cls.level, line: `agents——${name}（${agentsDir}）${cls.line}` })
  }

  const git = gitState()
  if (!git.repo) push({ level: 'warn', line: `hook——${git.reason}（zip 安装形态，跳过；克隆本仓后复跑可核）` })
  else {
    const hp = spawnSync('git', ['config', 'core.hooksPath'], { cwd: SKILL_ROOT, encoding: 'utf8' })
    push(hp.status === 0 ? classifyHookValue(hp.stdout) : classifyHookValue(''))
  }
  if (!git.repo) push({ level: 'warn', line: `remote——${git.reason}（备份面：建议以克隆形态安装并挂远端备份）` })
  else {
    const remotes = (spawnSync('git', ['remote'], { cwd: SKILL_ROOT, encoding: 'utf8' }).stdout || '').trim()
    push(
      remotes
        ? { level: 'ok', line: `remote——已挂（${remotes.split(/\s+/).join('、')}）` }
        : { level: 'warn', line: 'remote——空（备份面：建议挂远端备份，防单机数据丢失）' },
    )
  }

  push(checkLedgerDir())
  return results
}

/** --install 动作一：补缺失代理件（逐件复制+sha256 复核；漂移件不覆盖）。 */
export function installAgents(agentsDir) {
  const missing = listAgentTemplates().filter((n) => !existsSync(join(agentsDir, n)))
  if (!missing.length) return { level: 'ok', line: 'install-agents——无缺失件（已存在漂移件不覆盖——保护本机定制）' }
  mkdirSync(agentsDir, { recursive: true })
  const bad = []
  for (const n of missing) {
    copyFileSync(join(TEMPLATES_AGENTS, n), join(agentsDir, n))
    if (sha256File(join(TEMPLATES_AGENTS, n)) !== sha256File(join(agentsDir, n))) bad.push(n)
  }
  return bad.length
    ? { level: 'FAIL', line: `install-agents——复制后 sha256 复核不符：${bad.join('、')}（重试或人工核查磁盘/权限）` }
    : { level: 'ok', line: `install-agents——补齐 ${missing.length} 件（${missing.join('、')}，逐件 sha256 复核相等）` }
}

/** --install 动作二：hooksPath 未设时补设（已设含自定义=不动）。 */
export function installHook() {
  const git = gitState()
  if (!git.repo) return `install-hook——跳过（${git.reason}——zip 形态无提交流，克隆本仓后复跑 --install）`
  const hp = spawnSync('git', ['config', 'core.hooksPath'], { cwd: SKILL_ROOT, encoding: 'utf8' })
  if (hp.status === 0 && String(hp.stdout || '').trim()) return `install-hook——core.hooksPath 已设=${String(hp.stdout).trim()}（不重复设置；自定义值属用户裁决面）`
  const r = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: SKILL_ROOT, encoding: 'utf8' })
  return r.status === 0
    ? 'install-hook——已设 core.hooksPath=.githooks（提交门禁挂入）'
    : `install-hook——设置失败（exit ${r.status}：${String(r.stderr || '').trim()}）——手跑 git config core.hooksPath .githooks`
}

// ── --self-test（纯函数为主，禁动真实状态；fixture 用临时目录）──
function selfTest() {
  let fails = 0
  let n = 0
  const t = (name, cond) => (n++, console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`), cond || fails++)

  // 向量1：forbid 判定正反例（注入配置对象）
  t('forbid 正例（v25.2.1 ∈ [25] → FAIL）', checkNodeMajor('v25.2.1', [25]).level === 'FAIL')
  t('forbid 反例（v24.21.0 ∉ [25] → ok）', checkNodeMajor('v24.21.0', [25]).level === 'ok')
  t('forbid 配置缺省（无 forbid_major → 恒 ok）', checkNodeMajor('v25.2.1', undefined).level === 'ok')

  // 向量2：agents 清单派生（fixture 目录）
  const fx = mkdtempSync(join(tmpdir(), 'deploy-check-fx-'))
  try {
    for (const f of ['ops-b.md', 'ops-a.md', 'ops-c.txt', 'readme.md', 'ops-d.md']) writeFileSync(join(fx, f), 'x')
    t('清单派生（ops-*.md 全收+排序+他件剔除）', JSON.stringify(listAgentTemplates(fx)) === JSON.stringify(['ops-a.md', 'ops-b.md', 'ops-d.md']))
  } finally {
    rmSync(fx, { recursive: true, force: true })
  }

  // 向量3：漂移分类（注入哈希相等性）
  t('漂移分类：缺失→FAIL（--install 可补）', classifyAgent({ exists: false }).level === 'FAIL' && classifyAgent({ exists: false }).reason === 'missing')
  t('漂移分类：存在但哈希不等→warn（不覆盖）', classifyAgent({ exists: true, hashEqual: false }).level === 'warn' && classifyAgent({ exists: true, hashEqual: false }).reason === 'drift')
  t('漂移分类：存在且相等→ok', classifyAgent({ exists: true, hashEqual: true }).level === 'ok' && classifyAgent({ exists: true, hashEqual: true }).reason === 'match')

  // 向量4：退出码映射（含 3 类）
  t('退出码：无 FAIL → 0（warn 不阻断由汇总向量另证）', exitCodeFrom({ failCount: 0 }) === 0)
  t('退出码：有 FAIL → 1', exitCodeFrom({ failCount: 1 }) === 1)
  t('退出码：--self-test 失败 → 1', exitCodeFrom({ selfTestFailed: true }) === 1)
  t('退出码：自身装载错 → 3（SelfLoadError 常量）', EXIT_SELF_ERROR === 3 && new SelfLoadError('x') instanceof Error)

  // 加测：hook 值分类（纯值判）
  t('hook 值：.githooks → ok', classifyHookValue('.githooks').level === 'ok')
  t('hook 值：未设 → FAIL（--install 可补）', classifyHookValue('').level === 'FAIL')
  t('hook 值：自定义 → warn（只提示）', classifyHookValue('my-hooks').level === 'warn')

  // 加测：汇总行映射
  const s = summarize([{ level: 'ok' }, { level: 'ok' }, { level: 'warn' }, { level: 'FAIL' }])
  t('汇总行：计数+终判（FAIL→阻断）', s.ok === 2 && s.warn === 1 && s.fail === 1 && s.verdict === '阻断')
  const s2 = summarize([{ level: 'ok' }, { level: 'ok' }, { level: 'warn' }])
  t('汇总行：warn 不阻断（→处置后复跑，exit 仍 0）', s2.verdict === '处置后复跑' && exitCodeFrom({ failCount: s2.fail }) === 0)

  console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
  process.exit(fails === 0 ? 0 : 1)
}

// ── CLI ──
const isMain =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) selfTest()

  // 自身装载错守卫（exit 3 族）：templates/agents 缺失（清单单源不可用）/org-config 装载失败
  if (!existsSync(TEMPLATES_AGENTS)) {
    console.error('[装载错] templates/agents/ 缺失——代理清单单源不可用（重装本仓后复跑）')
    process.exit(EXIT_SELF_ERROR)
  }
  let cfg
  try {
    cfg = loadOrgConfig(SKILL_ROOT).merged
  } catch (e) {
    console.error(`[装载错] org-config 装载失败：${e.message}`)
    process.exit(EXIT_SELF_ERROR)
  }

  const agentsDir = argv.includes('--agents-dir') ? cliFlag(argv, '--agents-dir') || DEFAULT_AGENTS_DIR : DEFAULT_AGENTS_DIR

  if (argv.includes('--install')) {
    console.log('[install] 首装模式——仅补缺失代理件与未设 hooksPath（不覆盖漂移件/不改 org-config/宿主配置）')
    console.log(`[install] ${installAgents(agentsDir).line}`)
    console.log(`[install] ${installHook()}`)
  }

  let results
  try {
    results = runChecks(agentsDir, cfg)
  } catch (e) {
    if (e instanceof SelfLoadError) {
      console.error(`[装载错] ${e.message}`)
      process.exit(EXIT_SELF_ERROR)
    }
    throw e
  }
  const sum = summarize(results)
  console.log(sum.line)
  process.exit(exitCodeFrom({ failCount: sum.fail }))
}
