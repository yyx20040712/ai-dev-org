/**
 * 技能自包含回归（ai-dev-org v1.0 冻结前置——06 §5 的内化执行件；
 * R 清单单源=本脚本 --only 可选项集合，此处不复写清单——evolve-E2 b5 指针化）：
 *   R2'=系统提示 golden 字节自比对（golden 冻结于 scripts/roles/.golden/，
 *       双路验证：档案文件装载 vs golden、派发器 --dry-run assembled_system
 *       vs golden——勾连真实装载路径，防 regression 自身装载逻辑漂移）；
 *   R5'=mock 全链 exhaust 演练（--mock-source 三源全注入=零成本，校验
 *       exit 2/attempt 12/switch 2/exhaust 1 互斥落账）；
 *   R4'=流水与账本字段完整性（两类行 schema 逐字段校验，见 06 §5）；
 *   R1'3=语义抽样（3 个锚定样例双源跑，判定方向一致性；真实派发
 *       ~9k Kimi tokens，须 --r1 显式触发=配给保护）。
 * 用法：node scripts/regression.mjs [--only R2,R5,R4] [--r1] [--update-golden]
 *       [--project <账本目录>] [--keep-tmp]
 *       （flag 取值一律空格分隔，--x=y 等号形态=用法错拒收——cliFlag 单源立场）
 * 退出码口径单源=references/06 §5.8；本件特有一句（R2b 派发器装载路异常
 *       计入 FAIL 汇总、不单独退配置错——总表对回归件未载此聚合口径，
 *       回炉 r2 保留呈终审）。
 * golden 更新=冻结动作：--update-golden 重生成后应随工作单元提交并在
 * 修订记登记（改系统提示≠错，错在未登记的静默漂移）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { SKILL_ROOT, readJson, loadOrgConfig, cliFlag, UsageError } from './org-config.mjs'
import { ensureWithinRoot } from './ds-call-v2.mjs' // b6：包含性校验单源消费（另一落点=ds-call-v2 loadRole，同步演进）

const SCRIPTS = join(SKILL_ROOT, 'scripts')
const GOLDEN_DIR = join(SCRIPTS, 'roles', '.golden')
const LOG_PATH = join(SCRIPTS, 'model-routing-log.jsonl')
const argv = process.argv.slice(2)
const flag = (n) => cliFlag(argv, n) // 单源（org-config 导出——v1.6 批 P2-3 收敛；g3 批起三校验抛 UsageError）
// g3 批（evolve-l4-flags/P9 收敛）：--only/--project 缺值不再按 null/cwd 静默
let only = null
let projectDir = process.cwd()
try {
  const onlyArg = flag('--only')
  if (onlyArg) only = onlyArg.split(',').map((s) => s.trim().toUpperCase())
  projectDir = flag('--project') || process.cwd()
} catch (e) {
  if (e instanceof UsageError) {
    console.error(`[用法错] ${e.message}`)
    process.exit(1)
  }
  throw e
}
const wantR1 = argv.includes('--r1')
const updateGolden = argv.includes('--update-golden')
const keepTmp = argv.includes('--keep-tmp')
const want = (id) => !only || only.includes(id)
const results = []
const record = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${detail}`) }
const recordSkip = (id, detail) => { results.push({ id, pass: true, notrun: true, detail }); console.log(`SKIP ${id} ${detail}`) }
const node = () => [process.execPath]

// ── 角色装载（与 ds-call-v2.mjs loadRole 同构——锚定注释：两处须同步演进；
//    交叉验证路（R2'b）用派发器 --dry-run 真实装载兜住此处复制件的漂移；
//    b6（2026-09-16）：sys_prompt_file 包含性校验两落点同步演进——本处消费
//    ds-call-v2 ensureWithinRoot 单源（越界抛 ConfigError→exit 3，兜底经
//    import 链 uncaughtException handler 生效：[fatal] 一行+classifyExitCode） ──
function loadRoleAssembled(roleId) {
  const registry = readJson(join(SCRIPTS, 'roles', 'registry.json'))
  const def = registry.roles[roleId]
  if (!def) throw new Error(`未知角色: ${roleId}`)
  ensureWithinRoot(SKILL_ROOT, join(SKILL_ROOT, def.sys_prompt_file))
  const sysPrompt = readFileSync(join(SKILL_ROOT, def.sys_prompt_file), 'utf8')
  const dod = def.dod_file ? readFileSync(join(SKILL_ROOT, def.dod_file), 'utf8') : ''
  const assembled = (def.dod_file ? sysPrompt.trimEnd() + '\n\n' + dod.trim() : sysPrompt.trimEnd()) + '\n'
  return { assembled, sig: createHash('sha256').update(sysPrompt + '\n---DOD---\n' + dod).digest('hex').slice(0, 8), version: def.role_version }
}

// ═══ R2'：golden 字节自比对（a 档案装载路 / b 派发器 dry-run 路） ═══
if (want('R2')) {
  const registry = readJson(join(SCRIPTS, 'roles', 'registry.json'))
  const roleIds = Object.keys(registry.roles)
  if (updateGolden) {
    mkdirSync(GOLDEN_DIR, { recursive: true })
    for (const id of roleIds) writeFileSync(join(GOLDEN_DIR, `${id}.system.txt`), loadRoleAssembled(id).assembled, 'utf8')
    writeFileSync(join(GOLDEN_DIR, 'MANIFEST.txt'), roleIds.map((id) => { const r = loadRoleAssembled(id); return `${id} v${r.version} sig=${r.sig} sha256=${createHash('sha256').update(r.assembled).digest('hex')}` }).join('\n') + '\n', 'utf8')
    console.log(`[golden] 已重生成 ${roleIds.length} 角色冻结副本（随工作单元提交+修订记登记）`)
  }
  if (!existsSync(join(GOLDEN_DIR, 'MANIFEST.txt'))) { console.error('FAIL R2 golden 缺失——先 --update-golden 冻结'); process.exit(3) }
  let allOk = true, detail = []
  const manifestOk = { ok: true, bad: [] }
  for (const id of roleIds) {
    const goldPath = join(GOLDEN_DIR, `${id}.system.txt`)
    if (!existsSync(goldPath)) { detail.push(`${id}:golden 缺文件`); allOk = false; continue }
    const cur = Buffer.from(loadRoleAssembled(id).assembled, 'utf8')
    const gold = readFileSync(goldPath)
    if (cur.equals(gold)) detail.push(`${id}:=`)
    else { detail.push(`${id}:≠(cur ${cur.length}B/gold ${gold.length}B)`); allOk = false }
    // MANIFEST 自身也校验（防其与副本脱节=可撒谎的索引——W5 审 Kimi-W2）
    const sha = createHash('sha256').update(gold).digest('hex')
    if (!readFileSync(join(GOLDEN_DIR, 'MANIFEST.txt'), 'utf8').includes(sha)) { manifestOk.ok = false; manifestOk.bad.push(id) }
  }
  if (!manifestOk.ok) { detail.push(`MANIFEST 哈希不匹配:${manifestOk.bad.join(',')}`); allOk = false }
  record('R2a', allOk, `档案装载 vs golden 字节比对+MANIFEST 一致 ${detail.join(' ')}`)
  // R2'b：派发器真实装载路交叉验证（--dry-run 零副作用：读文件+打印即退）
  const tmp = mkdtempSync(join(tmpdir(), 'r2b-'))
  const promptFile = join(tmp, 'p.txt')
  writeFileSync(promptFile, 'noop', 'utf8')
  let bOk = true, bDetail = []
  for (const id of roleIds) {
    // 秒级 mock 路径超时=实测 max×5 取整 5s（evolve-E2 b5 实测推导表见 audits/evolve-e2-log；下同）
    const r = spawnSync(node()[0], [join(SCRIPTS, 'ds-call-v2.mjs'), '--role', id, '--dry-run', promptFile], { encoding: 'utf8', cwd: tmp, timeout: 5_000, killSignal: 'SIGKILL' })
    if (r.status !== 0) { bOk = false; bDetail.push(`${id}:dry-run exit=${r.status}`); continue }
    let dry
    try { dry = JSON.parse(r.stdout) } catch { bOk = false; bDetail.push(`${id}:dry-run stdout 非 JSON`); continue }
    const gold = readFileSync(join(GOLDEN_DIR, `${id}.system.txt`), 'utf8')
    if (dry.role.assembled_system + '\n' === gold) bDetail.push(`${id}:=`)
    else { bOk = false; bDetail.push(`${id}:≠`) }
  }
  if (!keepTmp) rmSync(tmp, { recursive: true, force: true })
  if (!bOk) { console.error('FAIL R2b dry-run 路异常（宿主配置不可用或派发器装载漂移）——配置级'); }
  record('R2b', bOk, `派发器 dry-run assembled_system vs golden ${bDetail.join(' ')}`)
}

// ═══ R5'：mock 全链 exhaust 演练（零成本） ═══
if (want('R5')) {
  const tmp = mkdtempSync(join(tmpdir(), 'r5-'))
  const promptFile = join(tmp, 'p.txt')
  writeFileSync(promptFile, 'exhaust 演练（mock 全链注入，零成本）', 'utf8')
  const logBefore = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean).length : 0
  // 期望计数从 org-config 链长推导（防过拟合重试常量——W5 审 Kimi-W4）：
  // 每源 4 attempt（退避 3 次后第 4 抛）、链内换源=链长-1、末源 exhaust=1
  const { merged } = loadOrgConfig(process.cwd())
  const chainLen = (merged.source_chain || []).length
  const expAttempt = 4 * chainLen, expSwitch = chainLen - 1
  // cwd=tmp：账本随派发器 cwd 落 tmp/.zcode/（--project 仅是条目名，不改变落点）
  const r = spawnSync(node()[0], [join(SCRIPTS, 'ds-call-v2.mjs'), '--role', 'gate1-reviewer', '--mock-source', (merged.source_chain || []).map((a) => `${a}:429`).join(','), '--project', 'r5-drill', promptFile], { encoding: 'utf8', cwd: tmp, timeout: 5_000, killSignal: 'SIGKILL' })
  const exitOk = r.status === 2
  const stderrOk = (r.stderr || '').includes('全源尽')
  const lines = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean) : []
  const fresh = lines.slice(logBefore).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  // runId 锚定=本次新增行中 exhaust 事件的 runId（演练必产生唯一 exhaust；不锚 fresh[0] 防并发混入——Kimi-W4）
  const exhaustEvts = fresh.filter((e) => e.event === 'exhaust')
  const runId = exhaustEvts[0]?.runId
  const mine = fresh.filter((e) => e.runId === runId)
  const attempts = mine.filter((e) => e.event === 'attempt').length
  const switches = mine.filter((e) => e.event === 'switch').length
  const ledgerPath = join(tmp, '.zcode', 'org-ledger.jsonl')
  const ledgerOk = existsSync(ledgerPath) && readFileSync(ledgerPath, 'utf8').includes('"event":"exhaust"')
  const countsOk = attempts === expAttempt && switches === expSwitch && exhaustEvts.length === 1
  record('R5', exitOk && stderrOk && countsOk && ledgerOk,
    `exit=${r.status}(期2) stderr全源尽=${stderrOk} 事件计数 attempt=${attempts}/${expAttempt} switch=${switches}/${expSwitch} exhaust=${exhaustEvts.length}/1（链长${chainLen}推导）chain=${exhaustEvts[0]?.chain ?? '—'} 账本exhaust=${ledgerOk}`)
  if (!keepTmp) rmSync(tmp, { recursive: true, force: true })
}

// ═══ R4'：流水与账本字段完整性 ═══
if (want('R4')) {
  // 版本真值从 ds-call-v2.mjs 源码提取（复制常量会随升版漂移自我掩蔽——W5 审 Kimi-B1/ds-W4）
  const VERSION_RE = /DISPATCHER_VERSION = '([^']+)'/
  const versionMatch = VERSION_RE.exec(readFileSync(join(SCRIPTS, 'ds-call-v2.mjs'), 'utf8'))
  if (!versionMatch) { console.error('FAIL R4 无法从 ds-call-v2.mjs 提取 DISPATCHER_VERSION（源码变更？）'); process.exit(3) }
  const CURRENT_DISPATCHER = versionMatch[1]
  const ROUTING_REQUIRED = { attempt: ['ts', 'runId', 'event', 'source', 'model', 'attempt', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'], ok: ['ts', 'runId', 'event', 'source', 'model', 'usage', 'latencyMs', 'finish', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'], switch: ['ts', 'runId', 'event', 'from', 'to', 'error', 'statusCode', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'], exhaust: ['ts', 'runId', 'event', 'chain', 'error', 'statusCode', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'] }
  // 账本 schema v2（2026-09-14）：增 schema_version/runId（行级关联键）/mocked；
  // truncated 仅 ok 行有 → 列入 ok 必填（P0-2 截断假成功的机检前置）。
  const LEDGER_REQUIRED = ['ts', 'project', 'event', 'role', 'tier', 'source', 'cfg_hash', 'outcome']
  const LEDGER_V2 = { ok: ['schema_version', 'runId', 'truncated'], switch: ['schema_version', 'runId'], exhaust: ['schema_version', 'runId'] }
  // 主控人工补记事件（ORG-11）：02 §9/05 §6/08 §4 要求入账的人工事件类型——
  // 旧 ledgerReq 仅认派发器三事件，致"照规范记账=R4 FAIL"的规范↔实现矛盾
  // （P0-4 同类病）。人工事件恒用 LEDGER_REQUIRED 基字段（无 usage，非派发产出）。
  const MANUAL_EVENTS = ['porting-delta', 'doc-health', 'ruling', 'constitution-overrun', 'escaped-defect', 'stopped'] // stopped=接续演练/被杀岗手记（v1.6 批补登——原未登记致坏行误报）
  const checkLines = (label, path, required, tailN, opts = {}) => {
    if (!existsSync(path)) return { pass: false, detail: `${label}:文件不存在 ${path}` }
    const ls = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean).slice(-tailN)
    let bad = 0, skipped = 0, unknown = 0, foreign = 0, kinds = {}
    for (const l of ls) {
      let e; try { e = JSON.parse(l) } catch { bad++; continue }
      if (opts.skipIf && opts.skipIf(e)) { skipped++; continue }
      // 他源写入行（P0-4 真因 1）：glm-look.mjs 等非派发器写入者落同流水，行 schema
      // 自带 channel 标记且无 dispatcher_version——按他源 schema 计「外来行」而非坏行
      // （写入者 glm-look.mjs 属 WIP 锁定集，统一 schema 登记残留，见 RESIDUALS）。
      if (e.channel !== undefined && e.dispatcher_version === undefined) { foreign++; continue }
      // selfiter 批（glm-look-schema 清偿）：对齐行=channel+dispatcher_version 双标记
      // ——按 glm-look 通道 schema（attempt/ok/fail 三形）作第一类行校验；legacy 行
      // （channel 无 dispatcher_version）维持上方外来跳过（历史行禁改写，08 §3）
      if (e.channel !== undefined && e.dispatcher_version !== undefined) {
        const GLM_REQUIRED = {
          attempt: ['ts', 'runId', 'event', 'source', 'model', 'attempt', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'],
          ok: ['ts', 'runId', 'event', 'source', 'model', 'usage', 'latencyMs', 'finish', 'finish_class', 'truncated', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'],
          fail: ['ts', 'runId', 'event', 'source', 'model', 'error', 'statusCode', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'],
        }
        const gr = GLM_REQUIRED[e.event]
        if (!gr) { unknown++; bad++; continue }
        for (const k of gr) if (e[k] === undefined) { bad++; break }
        kinds[e.event] = (kinds[e.event] || 0) + 1
        continue
      }
      // 流水行：未知事件类型=坏行（schema 未登记即弱校验——ds-W5）；历史版本行按当时 schema 跳过=合法历史（禁改写）
      if (e.dispatcher_version !== undefined && e.dispatcher_version !== CURRENT_DISPATCHER) { skipped++; continue }
      const req = typeof required === 'function' ? required(e) : required
      if (e.event !== undefined && e.dispatcher_version !== undefined && !ROUTING_REQUIRED[e.event]) { unknown++; bad++; continue }
      for (const k of req) if (e[k] === undefined) { bad++; break }
      if (e.event) kinds[e.event] = (kinds[e.event] || 0) + 1
    }
    // 全部行被跳过=校验域真空（升版后常量未提取成功即此形态）——显式 FAIL 防假 PASS（Kimi-B1 修法二）
    if (skipped + foreign === ls.length && ls.length > 0) return { pass: false, detail: `${label}:尾${ls.length}行全部为旧版本/外来行（校验域真空——若派发器已升版，先更新本脚本 schema）` }
    return { pass: bad === 0, detail: `${label}:尾${ls.length}行坏${bad}行（含未知事件${unknown}）跳${skipped}行(旧版本)外来${foreign}行(他源channel标记) 事件分布=${JSON.stringify(kinds)}` }
  }
  const routingReq = (e) => ROUTING_REQUIRED[e.event] || ['ts', 'runId', 'event']
  const a = checkLines('流水', LOG_PATH, routingReq, 100)
  // 原件 R4 第二要素（W5 等价矩阵复核补齐）：流水 org_config_hash 与
  // org-config.mjs hash 输出一致性——防「换环境后按旧供应商事实硬闯」。
  // 守卫（终轮 A'-Kimi/ds 复审）：流水缺失=保持 R4 FAIL 不崩（ENOENT 不中断汇总）
  let cfgOk = false, cfgDetail = 'cfg哈希=流水缺失（R4 FAIL）'
  if (existsSync(LOG_PATH)) {
    const latestCfgHash = [...readFileSync(LOG_PATH, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean)].reverse().find((l) => { try { return JSON.parse(l).org_config_hash } catch { return false } })
    const h = spawnSync(node()[0], [join(SCRIPTS, 'org-config.mjs'), 'hash'], { encoding: 'utf8', cwd: process.cwd(), timeout: 5_000, killSignal: 'SIGKILL' })
    if (h.status !== 0 || !h.stdout.trim()) cfgDetail = `cfg哈希=org-config hash 子进程失败（exit=${h.status}）`
    else {
      const live = h.stdout.trim()
      cfgOk = latestCfgHash && JSON.parse(latestCfgHash).org_config_hash === live.replace('cfg:', '')
      cfgDetail = `cfg哈希一致=${cfgOk}（流水 ${JSON.parse(latestCfgHash || '{}').org_config_hash ?? '?'} vs live ${live}）`
    }
  }
  a.detail += `；${cfgDetail}`
  const passA = a.pass && cfgOk
  const ledgerPath = flag('--ledger') || join(projectDir, '.zcode', 'org-ledger.jsonl')
  const ledgerReq = (e) => {
    if (!['ok', 'switch', 'exhaust', ...MANUAL_EVENTS].includes(e.event)) return ['__unknown_event__'] // 账本侧未知 event 同样计坏行（终轮 A'-Kimi：防新增记账事件未同步 schema 即弱校验通过）。返回数组——checkLines 以 for...of 逐字段消费，对象形态会 TypeError（终轮复核修正）
    if (MANUAL_EVENTS.includes(e.event)) return LEDGER_REQUIRED // 主控人工补记（无 usage/mocked/truncated——非派发产出）
    const base = e.event === 'ok' ? [...LEDGER_REQUIRED, 'usage'] : LEDGER_REQUIRED
    // v1.6 终审 W1：v2 字段恒要求——无 schema_version 的新行（截止时点后）会因缺字段直接计坏；
    // 截止前存量行由 checkLines 的 skipIf 跳过（原条件分支成死代码，已删）
    const v2 = [...base, ...(LEDGER_V2[e.event] || [])]
    // selfiter B4 分代：schema_version 3 的派发行增 project_id 必填（归一化 id；
    // v2 存量行按 v2 契约——历史行禁改写，08 §3）
    return e.schema_version === 3 ? [...v2, 'project_id'] : v2
  }
  const b = checkLines('账本', ledgerPath, ledgerReq, 50, {
    // 无 schema_version 且早于纪律生效时点（2026-09-16T12:00Z）的存量行=旧版本形态——跳过计数
    // （不追认不改写，08 §3）；时点后新增行漏带 schema_version 不再跳过=因缺字段计坏 FAIL（终审 W1 闸门）
    skipIf: (e) => e.schema_version === undefined && String(e.ts || '') < '2026-09-16T12:00:00Z',
  })
  record('R4', passA && b.pass, `${a.detail}；${b.detail}`)
}

// ═══ R7：账本 schema 指针正向校验（A3——SKILL.md/snippet 禁内联字段清单；v1.6 批 kimi-W1） ═══
if (want('R7')) {
  let ok = true; const det = []
  const targets = [
    ['SKILL.md', join(SKILL_ROOT, 'SKILL.md')],
    ['org-seg.snippet', join(SKILL_ROOT, 'templates', 'org-seg.snippet.md')],
  ]
  for (const [name, p] of targets) {
    const txt = readFileSync(p, 'utf8')
    // 正向判据：存在「单源=…02 §9」指针（允许加粗/等号变体）
    const hasPtr = /行 schema\s*\*{0,2}单源=?\*{0,2}[^。]*02\s*§9/.test(txt)
    // 反例判据（内联枚举串出现即指针化失守；终审 N4 扩形态：顿号/逗号/空白枚举均命中）
    const inline = /ts[\/、,，\s]+project[\/、,，\s]+event/.test(txt)
    if (!hasPtr || inline) { ok = false; det.push(`${name}:指针${hasPtr ? '✓' : '✗'}${inline ? '/内联清单✗' : ''}`) } else det.push(`${name}:✓`)
  }
  record('R7', ok, `账本 schema 指针唯一指向 02 §9 ${det.join(' ')}`)
}

// ═══ R8：三脚本自检套件聚合（g3 批 P8 扩——原 v1.6 批 C2 单点）：
//     org-config/deploy-check/log-triage 各自 exit 0 且输出含「全过」；
//     log-triage 另持 --health 验收断言（mock 过滤假信号回归钉，C2 沿袭） ═══
if (want('R8')) {
  const specs = [
    ['log-triage', join(SCRIPTS, 'log-triage.mjs'), true], // 验收断言（C2）=log-triage 专有
    ['org-config', join(SCRIPTS, 'org-config.mjs'), false],
    ['deploy-check', join(SCRIPTS, 'deploy-check.mjs'), false],
  ]
  const det = []
  let okAll = true
  for (const [name, script, wantAcc] of specs) {
    const r = spawnSync(node()[0], [script, '--self-test'], { encoding: 'utf8', cwd: SKILL_ROOT, timeout: 30_000, killSignal: 'SIGKILL' })
    const out = (r.stdout || '') + (r.stderr || '')
    const allPass = out.includes('全过')
    const accOk = !wantAcc || out.includes('验收断言')
    const thisOk = r.status === 0 && allPass && accOk
    if (!thisOk) okAll = false
    det.push(`${name}:exit=${r.status}/全过=${allPass}${wantAcc ? `/验收断言=${accOk}` : ''}${!thisOk ? `（输出尾：${out.slice(-160)}）` : ''}`)
  }
  record('R8', okAll, det.join(' '))
}

// ═══ R9：scrub 受控复制对账（A3 受控双源——glm-look 复制体须与 ds-call-v2 源字面量一致；v1.6 批 P0-B b②/W7 判据②） ═══
if (want('R9')) {
  const re = /const SCRUB_RE = (.+?) \/\/ [^\n]*\nconst scrub = (.+?);?\n/ // 分号可选（源体 ASI 风格无尾分号——对账对象=正则与函数体字面量）
  const a = re.exec(readFileSync(join(SCRIPTS, 'ds-call-v2.mjs'), 'utf8'))
  const b = re.exec(readFileSync(join(SCRIPTS, 'glm-look.mjs'), 'utf8'))
  const ok = !!a && !!b && a[1] === b[1] && a[2] === b[2]
  record('R9', ok, `scrub 复制体与源字面量一致=${ok}${!ok ? '（改其一须同步另一——受控复制纪律，裁决档 W7）' : ''}`)
}

// ═══ R10：b1/b2/b6 回归面汇总（evolve 批 E1 2026-09-16——R10 归属 b1，P-4 预裁决） ═══
//   ①结构断言：glm-look.mjs 非注释行无 fetch( 调用形态+存在 node:http(s) import
//     （注释剥离口径钉死：先剥 /*…*/ 块注释再跳过 // 整行注释；行内尾注不剔——
//      代码半行仍在非注释行内受检）；
//   ②本地 mock 双通道往返：起 node:http 本地 server 拟真双形（glm=/anthropic
//     /v1/messages anthropic 形、ds=/deepseek /chat/completions openai 形各一轮），
//     子进程驱动 glm-look，env 重定向钩子 GLM_LOOK_HOST_CONFIG/GLM_LOOK_LOG_DIR
//     （内部测试设施，缺省行为不变）隔离宿主配置与真实流水落点——零真实外呼、
//     零真实落账；断言 stdout 正文+流水 attempt/ok 行（ok 行含 truncated 派生布尔）；
//   ③纯函数向量（子进程向量脚本承载 import——未实现态 CLI 副作用不触主进程）：
//     splitEndpoint≥3 例 / classifyExitCode 三类（配置→3/用法→1/未知→1）≥3 例 /
//     ensureWithinRoot 三负例（恰 ..、..\、../ 三输入形态）+2 正例。
//   ④ B1 回炉向量（evolve-rework r1，2026-09-16）：registry 装载错误面端到端——
//     坏 JSON 与 roles:null 两形态均须 exit 3（06 §5.8 配置/装载错类；红态=
//     裸 readJson/裸取 registry.roles[roleId] 抛普通异常→classifyExitCode 对
//     无 exitCode 属性按用法/未知类退——未申报回退面，门一出件 B1）。
//   本块一切 spawnSync 带 timeout+killSignal（秒级 mock 路径 60s 量级）。
if (want('R10')) {
  let ok = true
  const det = []
  const r10Spawn = (args, opts = {}) => spawnSync(node()[0], args, { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL', ...opts })
  // 异步 spawn+超时看护（60s 量级+SIGKILL，与 spawnSync 看护等价）：mock 往返必须
  // 异步——spawnSync 会冻结父进程事件循环，本进程内 mock server 无法应答
  // （实测：子进程 TCP 已连而父进程 server 请求永不处理=挂到被杀）。
  const r10SpawnAsync = (args, opts = {}) => new Promise((resolve) => {
    const child = spawn(node()[0], args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...opts })
    let stdout = '', stderr = ''
    child.stdout.on('data', (c) => { stdout += c })
    child.stderr.on('data', (c) => { stderr += c })
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
    child.on('error', () => { clearTimeout(timer); resolve({ status: null, signal: null, stdout, stderr }) })
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ status: code, signal, stdout, stderr }) })
  })
  // ① 结构断言
  {
    const src = readFileSync(join(SCRIPTS, 'glm-look.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('//'))
    const fetchHit = codeLines.filter((l) => /\bfetch\s*\(/.test(l))
    const hasHttpImport = /from\s+["']node:https?["']/.test(src)
    if (fetchHit.length || !hasHttpImport) ok = false
    det.push(`①结构断言:非注释行fetch命中=${fetchHit.length}${fetchHit.length ? `「${fetchHit[0].trim().slice(0, 50)}」` : ''} node:http(s)import=${hasHttpImport ? '✓' : '✗'}`)
  }
  // ③ 纯函数向量（两份向量脚本；红态函数未导出→FAIL 不崩）
  const r10tmp = mkdtempSync(join(tmpdir(), 'r10-'))
  const vecUrl = (f) => pathToFileURL(join(SCRIPTS, f)).href
  const vecGlm = join(r10tmp, 'vec-glm.mjs')
  writeFileSync(vecGlm, `import * as glmLook from ${JSON.stringify(vecUrl('glm-look.mjs'))}
const { splitEndpoint } = glmLook
let fails = 0
const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++ }
if (typeof splitEndpoint !== 'function') { console.log('FAIL splitEndpoint 未导出（b1 待实现）'); process.exit(1) }
t('http 缺省端口 80', JSON.stringify(splitEndpoint('http://h.example/p')) === JSON.stringify({ protocol: 'http:', hostname: 'h.example', port: 80, path: '/p' }))
t('https 显式端口 8443', splitEndpoint('https://h.example:8443/a?b=1').port === 8443)
t('path 含 search 串', splitEndpoint('https://h.example/a?x=1&y=2').path === '/a?x=1&y=2')
t('http 显式端口 3000', splitEndpoint('http://h:3000/x').port === 3000)
console.log(fails === 0 ? 'R10VEC-ALL-PASS' : 'R10VEC-FAILS:' + fails)
process.exit(fails === 0 ? 0 : 1)
`, 'utf8')
  const vecDs = join(r10tmp, 'vec-ds.mjs')
  writeFileSync(vecDs, `import * as dsCall from ${JSON.stringify(vecUrl('ds-call-v2.mjs'))}
import { join, dirname, resolve } from 'node:path'
const { classifyExitCode, ConfigError, ensureWithinRoot, parseFindings, parseResponseBody } = dsCall
let fails = 0
const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++ }
if (typeof classifyExitCode !== 'function' || typeof ConfigError !== 'function' || typeof ensureWithinRoot !== 'function') { console.log('FAIL 纯函数未导出（b2/b6 待实现）'); process.exit(1) }
if (typeof parseFindings !== 'function') { console.log('FAIL parseFindings 未导出（selfiter findings-parser 待实现）'); process.exit(1) }
if (typeof parseResponseBody !== 'function') { console.log('FAIL parseResponseBody 未导出（selfiter B5 流式化待实现）'); process.exit(1) }
t('分类:配置 ConfigError→3', classifyExitCode(new ConfigError('配置错')) === 3)
t('分类:用法 普通 Error→1', classifyExitCode(new Error('用法错')) === 1)
t('分类:未知 非 Error 值→1', classifyExitCode('boom') === 1)
t('分类:exitCode 属性直通(2)', classifyExitCode(Object.assign(new Error('x'), { exitCode: 2 })) === 2)
t('ConfigError 实例 exitCode=3', new ConfigError('x').exitCode === 3)
const root = resolve('r10-root-fixture')
const throws3 = (fn) => { try { fn(); return false } catch (e) { return e.exitCode === 3 } }
t('越界负例:恰 ..（root 兄弟）', throws3(() => ensureWithinRoot(root, dirname(root))))
t('越界负例:..\\\\ 深层逃逸', throws3(() => ensureWithinRoot(root, join(root, '..', 'evil', 'x.txt'))))
t('越界负例:../ 形态（混合分隔输入）', throws3(() => ensureWithinRoot(root, root + '/../evil/x.txt')))
t('正例:root 内深层文件', ensureWithinRoot(root, join(root, 'roles', 'a.md')) === join(root, 'roles', 'a.md'))
t('正例:root 自身', ensureWithinRoot(root, root) === root)
// selfiter 批（findings-parser）向量：机读尾栏解析
t('findings:标准尾栏解析', JSON.stringify(parseFindings('报告正文\\nFINDINGS: B=1 W=2 N=3 VERDICT=PASS')) === JSON.stringify({ B: 1, W: 2, N: 3, verdict: 'PASS' }))
t('findings:无尾栏→null（不伪造）', parseFindings('普通产出无尾栏') === null)
t('findings:尾栏后有杂行（末5行回扫窗）仍命中', parseFindings('FINDINGS: B=0 W=1 N=0 VERDICT=FAIL\\n\\n备注行') !== null)
t('findings:verdict 归一大写+零值形态', parseFindings('FINDINGS: B=0 W=0 N=2 VERDICT=pass').verdict === 'PASS' && parseFindings('FINDINGS: B=0 W=0 N=2 VERDICT=pass').N === 2)
// 回炉 N1 向量：verdict 尾随标点不污染（字母集捕获）+第 6 行前不命中（5 行窗）
t('N1 findings：尾随全角句号不并入 verdict', parseFindings('FINDINGS: B=0 W=0 N=1 VERDICT=PASS。').verdict === 'PASS')
t('N1 findings：5 行回扫窗外（第 6 行）不命中', parseFindings('FINDINGS: B=0 W=0 N=1 VERDICT=PASS\\n一\\n二\\n三\\n四\\n五\\n六') === null)
// selfiter 批（B5 流式化）向量：响应体双形态解析
t('B5 parseResponseBody：anthropic SSE 文本→同构最终对象', (() => { const o = parseResponseBody({ kind: 'anthropic' }, 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"VEC"}}\\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\\ndata: [DONE]'); return o.content?.[0]?.text === 'VEC' && o.stop_reason === 'end_turn' })())
t('B5 parseResponseBody：非 SSE JSON 原语义回退', parseResponseBody({ kind: 'anthropic' }, '{"content":[{"type":"text","text":"J"}],"stop_reason":"end_turn"}').content[0].text === 'J')
t('B5 parseResponseBody：openai SSE 累积+usage 末块', (() => { const o = parseResponseBody({ kind: 'openai' }, 'data: {"choices":[{"delta":{"content":"X"}}]}\\ndata: {"choices":[{"delta":{"content":"Y"}}]}\\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2}}\\ndata: [DONE]'); return o.choices[0].message.content === 'XY' && o.usage.completion_tokens === 2 })())
console.log(fails === 0 ? 'R10VEC-ALL-PASS' : 'R10VEC-FAILS:' + fails)
process.exit(fails === 0 ? 0 : 1)
`, 'utf8')
  const rGlm = r10Spawn([vecGlm])
  const rDs = r10Spawn([vecDs])
  const vecOk = rGlm.status === 0 && (rGlm.stdout || '').includes('R10VEC-ALL-PASS')
  const vecDsOk = rDs.status === 0 && (rDs.stdout || '').includes('R10VEC-ALL-PASS')
  if (!vecOk || !vecDsOk) ok = false
  const vecFail = (r) => `FAIL(exit=${r.status} 「${((r.stdout || '') + '\n' + (r.stderr || '')).split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 2).join('|')}」)`
  det.push(`③向量:splitEndpoint=${vecOk ? '全过' : vecFail(rGlm)}/classify+ensure=${vecDsOk ? '全过' : vecFail(rDs)}`)
  // ② 本地 mock 双通道往返（b1 传输层+env 钩子就位才跑——红态跳过防触真实宿主源发现）
  if (vecOk) {
    const { createServer } = await import('node:http')
    const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const server = createServer((req, res) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const glmForm = req.url.includes('/anthropic') // 通道甄别=org-config endpoint_contains 同串拟真
        // selfiter 批（B5）拟真扩展：请求体带 stream:true → 应答 SSE 流（首字节早达
        // 语义拟真；收割器/同构断言经 glm-look 端到端走通）
        let streamReq = false
        try { streamReq = JSON.parse(Buffer.concat(chunks).toString('utf8')).stream === true } catch { /* 坏体走 JSON 路径 */ }
        if (streamReq) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          const sse = glmForm
            ? ['event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
               'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"MOCK-GLM-OK"}}',
               'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
               'data: [DONE]']
            : ['data: {"choices":[{"delta":{"content":"MOCK-DS-OK"}}]}',
               'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
               'data: [DONE]']
          res.end(sse.join('\n\n') + '\n\n')
          return
        }
        const body = glmForm
          ? { content: [{ type: 'text', text: 'MOCK-GLM-OK' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }
          : { choices: [{ message: { content: 'MOCK-DS-OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      })
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const port = server.address().port
    const logDir = join(r10tmp, 'log')
    mkdirSync(logDir, { recursive: true })
    const hostCfgFile = join(r10tmp, 'host-config.json') // 拟真宿主配置（模型键/端点甄别子串与 org-config vision_channels 对齐）
    writeFileSync(hostCfgFile, JSON.stringify({
      provider: {
        'mock-glm': { options: { baseURL: `http://127.0.0.1:${port}/anthropic`, apiKey: 'r10-mock-key-aaaaaaaaaaaaaaaaaaaa' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
        'mock-ds': { options: { baseURL: `http://127.0.0.1:${port}/deepseek`, apiKey: 'r10-mock-key-bbbbbbbbbbbbbbbbbbbb' }, models: { 'deepseek-flash': { name: 'deepseek-flash' } } },
      },
    }), 'utf8')
    const promptFile = join(r10tmp, 'prompt.md')
    writeFileSync(promptFile, 'R10 mock 往返（本地拟真，零外部调用）', 'utf8')
    const imgFile = join(r10tmp, 'img.png')
    writeFileSync(imgFile, PNG_1PX)
    const runLook = (channel) => r10SpawnAsync([join(SCRIPTS, 'glm-look.mjs'), '--prompt', promptFile, imgFile, '--channel', channel], {
      env: { ...process.env, GLM_LOOK_HOST_CONFIG: hostCfgFile, GLM_LOOK_LOG_DIR: logDir },
    })
    const rg = await runLook('glm')
    const rd = await runLook('ds')
    const logFile = join(logDir, 'model-routing-log.jsonl')
    const logLines = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []
    const chOf = (ch) => logLines.filter((e) => e.channel === ch)
    // selfiter 批（glm-look-schema）断言扩面：mock 流水行=对齐 schema（ctx 五字段
    // +attempt 序号+ok 行 finish_class/truncated）——红态=旧 logEvent 缺 ctx 字段
    const ctxOk = (e) => e.role_id === 'design-reviewer' && e.dispatcher_version !== undefined && e.org_config_hash !== undefined && e.role_version !== undefined && 'role_sig' in e
    const alignedOk = logLines.filter((e) => e.event === 'attempt').every((e) => typeof e.attempt === 'number' && ctxOk(e)) &&
      logLines.filter((e) => e.event === 'ok').every((e) => ctxOk(e) && typeof e.finish_class === 'string' && typeof e.truncated === 'boolean')
    const lookOk = (r, ch, text) => r.status === 0 && (r.stdout || '').includes(text) && chOf(ch).some((e) => e.event === 'attempt') && chOf(ch).some((e) => e.event === 'ok' && e.truncated === false) && alignedOk
    const glmOk = lookOk(rg, 'glm-look', 'MOCK-GLM-OK')
    const dsOk = lookOk(rd, 'ds-look', 'MOCK-DS-OK')
    if (!glmOk || !dsOk) ok = false
    const lookFail = (r) => `✗(exit=${r.status} stderr尾=${(r.stderr || '').slice(-140).replace(/\n/g, ' ')})`
    det.push(`②mock往返:glm=${glmOk ? `✓(exit=${rg.status} 正文+流水attempt/ok行)` : lookFail(rg)}/ds=${dsOk ? `✓(exit=${rd.status})` : lookFail(rd)}`)
    // selfiter 批（evolve-glmlook-150-null）向量：宿主 provider null 条目→降级行
    // +跳过其余源+exit 5（env 钩子隔离零外呼；红态=旧 discoverSources 裸取 TypeError 崩溃）
    const hostCfgNull = join(r10tmp, 'host-config-null.json')
    writeFileSync(hostCfgNull, JSON.stringify({ provider: { dead: null, 'mock-glm': { options: { baseURL: `http://127.0.0.1:${port}/anthropic`, apiKey: 'r10-null-key-cccccccccccccccc' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } } } }), 'utf8')
    const rNull5 = r10Spawn([join(SCRIPTS, 'glm-look.mjs'), '--list-sources'], { env: { ...process.env, GLM_LOOK_HOST_CONFIG: hostCfgNull } })
    const nullOk = rNull5.status === 5 && (rNull5.stderr || '').includes('[degraded]') && (rNull5.stdout || '').includes('mock-glm')
    if (!nullOk) ok = false
    det.push(`⑤null守卫(mock发现面):${nullOk ? `✓(exit=5 降级行+其余源续列)` : `✗(exit=${rNull5.status} stderr尾=${(rNull5.stderr || '').slice(-120).replace(/\n/g, ' ')})`}`)
    server.close()
  } else {
    ok = false
    det.push('②mock往返:跳过（splitEndpoint 未导出=b1 传输层未落，env 钩子未就位——跑则触真实宿主源发现）')
  }
  // ④ B1 回炉向量：registry 装载错误面端到端（备份-注入-跑-还原，try/finally
  //   保还原；注入窗内本进程顺序执行无并发读者——R2/R5 等已跑毕，R1 默认 SKIP）。
  {
    const REG = join(SCRIPTS, 'roles', 'registry.json')
    const backup = readFileSync(REG, 'utf8')
    const b1Prompt = join(r10tmp, 'b1-prompt.txt')
    writeFileSync(b1Prompt, 'B1 vector: registry load-error face', 'utf8')
    let b1Ok = true
    const b1Det = []
    try {
      writeFileSync(REG, '{ 坏 JSON（B1 注入）', 'utf8')
      const rBad = r10Spawn([join(SCRIPTS, 'ds-call-v2.mjs'), '--list-roles'], { cwd: SKILL_ROOT })
      const badFatal = (rBad.stderr || '').includes('[fatal]')
      b1Ok &&= rBad.status === 3 && badFatal
      b1Det.push(`坏JSON→exit=${rBad.status}(期3)/[fatal]=${badFatal}`)
      writeFileSync(REG, JSON.stringify({ registry_version: 'rework-b1', roles: null }), 'utf8')
      const rNull = r10Spawn([join(SCRIPTS, 'ds-call-v2.mjs'), '--role', 'gate1-reviewer', '--dry-run', b1Prompt], { cwd: SKILL_ROOT })
      const nullFatal = (rNull.stderr || '').includes('[fatal]')
      b1Ok &&= rNull.status === 3 && nullFatal
      b1Det.push(`roles:null→exit=${rNull.status}(期3)/[fatal]=${nullFatal}`)
    } finally {
      writeFileSync(REG, backup, 'utf8')
    }
    if (!b1Ok) ok = false
    det.push(`④B1向量(registry错误面):${b1Ok ? '全过' : '✗'} ${b1Det.join('；')}`)
  }
  if (!keepTmp) rmSync(r10tmp, { recursive: true, force: true })
  record('R10', ok, `b1/b2/b6 回归面——${det.join('；')}`)
}

// ═══ R1'3：语义抽样（真实派发，--r1 显式触发） ═══
if (wantR1) {
  const CASES = [
    { id: 'S1-断言弱化', expect: 'FAIL', prompt: '审查以下测试改动并只回答一行「判定:PASS」或「判定:FAIL:原因」：\n```diff\n- assert saved.tags.length === 3\n+ assert saved.tags.length >= 1\n```\n（末行固定输出机读尾栏：FINDINGS: B=<数> W=<数> N=<数> VERDICT=PASS 或 FAIL）' },
    { id: 'S2-干净样例', expect: 'PASS', prompt: '审查以下测试改动并只回答一行「判定:PASS」或「判定:FAIL:原因」：\n```diff\n- const n = items.filter(x => x.ok).length\n+ const n = items.filter((x) => x.ok).length\n```\n（末行固定输出机读尾栏：FINDINGS: B=<数> W=<数> N=<数> VERDICT=PASS 或 FAIL）' },
    { id: 'S3-占位残留', expect: 'FAIL', prompt: '审查以下测试改动并只回答一行「判定:PASS」或「判定:FAIL:原因」：\n```diff\n+ // TODO: 补充断言\n+ it("works", () => { expect(true).toBe(true) })\n```\n（末行固定输出机读尾栏：FINDINGS: B=<数> W=<数> N=<数> VERDICT=PASS 或 FAIL）' },
  ]
  // R1 双源抽样源名单单源=org-config regression_cfg.r1_sources（v1.7.4 m4 清偿，
  // 残留册 evolve-m4-hardcode 承接）：缺段/空数组/别名∉providers → record('R1', false,
  // 明确原因)——不静默跳过（守卫先于派发循环=零真实调用即 FAIL）；名单语义=前两源
  // 成对比较方向一致性；改名单=R1 语义变更须重验。
  const { merged } = loadOrgConfig(process.cwd())
  const SOURCES = Array.isArray(merged.regression_cfg?.r1_sources) ? merged.regression_cfg.r1_sources : null
  const badSources = SOURCES === null
    ? 'regression_cfg.r1_sources 缺段或非数组（org-config 单源，v1.7.4 m4 清偿）'
    : SOURCES.length === 0
      ? 'regression_cfg.r1_sources 为空数组（org-config 单源，v1.7.4 m4 清偿）'
      : SOURCES.length < 2
        ? `regression_cfg.r1_sources 少于 2 源（现=[${SOURCES.join(',')}]）——双源方向一致性判定不可构成`
      : new Set(SOURCES).size !== SOURCES.length
        ? `r1_sources 含重复别名（现=[${SOURCES.join(',')}]）——双源一致性退化为同源自比（门一 W-2）`
        : SOURCES.some((a) => !(merged.providers || {})[a])
          ? `regression_cfg.r1_sources 含 providers 外别名（现=[${SOURCES.join(',')}]——源别名须∈providers）`
          : null
  if (badSources) {
    record('R1', false, `${badSources}——R1 语义面失效，显式 FAIL 不静默跳过`)
  } else {
  const tmp = mkdtempSync(join(tmpdir(), 'r1-'))
  let allPass = true, detail = []
  const [srcA, srcB] = SOURCES
  for (const c of CASES) {
    const verdicts = {}
    for (const src of [srcA, srcB]) {
      const pf = join(tmp, c.id + '.txt')
      writeFileSync(pf, c.prompt, 'utf8')
      const r = spawnSync(node()[0], [join(SCRIPTS, 'ds-call-v2.mjs'), '--role', 'gate1-reviewer', '--source', src, '--project', tmp, pf, pf + '.' + src + '.out'], { encoding: 'utf8', cwd: tmp, timeout: 5_400_000, killSignal: 'SIGKILL' }) // R1 超时=单源推导 4×20min（链长 4×派发器 CALL_TIMEOUT_MS）+35s 开销=4,835,000ms，+裕量取 90min（5,400,000ms∈C5 机检窗 [4,835,000, 7,200,000]；evolve-E2 b5——原 1,260,000 低于派生值，合法最坏链会被先杀误报 FAIL；v1.6 批史：原 10min 同病）
      const out = r.status === 0 ? readFileSync(pf + '.' + src + '.out', 'utf8') : ''
      // 格式容错解析（v1.6 批：deepseek 偶发把「判定:」耗在推理通道、可见正文用 Verdict:/裸 PASS-FAIL——
      // 语义不变仍取方向；S2 干净样例不会被 FAIL 误配（模型方向错才会）
      const vm = /(?:判定|verdict)\s*[:：]\s*(PASS|FAIL)/i.exec(out) || /^\s*\*{0,2}(PASS|FAIL)\b/im.exec(out)
      verdicts[src] = vm ? vm[1].toUpperCase() : `UNPARSEABLE(exit=${r.status})`
      if (verdicts[src] === 'UNPARSEABLE') allPass = false
    }
    const agree = verdicts[srcA] === verdicts[srcB] && verdicts[srcA] === c.expect
    if (!agree) allPass = false
    detail.push(`${c.id}:${verdicts[srcA]}/${verdicts[srcB]}(期${c.expect})${agree ? '✓' : '✗'}`)
  }
  if (!keepTmp) rmSync(tmp, { recursive: true, force: true })
  record('R1', allPass, `双源判定方向一致性 ${detail.join(' ')}`)
  }
} else if (want('R1')) {
  recordSkip('R1', '未给 --r1——真实派发配给保护，~9k Kimi tokens；冻结裁决前须跑或显式登记欠账（SKIP 不计入通过数——ds-W6）')
}

const fails = results.filter((r) => !r.pass).length
const notruns = results.filter((r) => r.notrun).length
const passed = results.filter((r) => r.pass && !r.notrun).length
console.log(`\nregression 汇总：${passed}/${results.length - notruns} 过${fails ? `，FAIL ×${fails}` : ''}${notruns ? `，SKIP ×${notruns}（未跑项不计入通过数）` : ''}（项=${results.map((r) => r.id).join('/')}）`)
process.exit(fails ? 1 : 0)
