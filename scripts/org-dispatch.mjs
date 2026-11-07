#!/usr/bin/env node
// org-dispatch.mjs —— 派发组合面（INFRA1 批 D-4·规范锚=账本 1122「面板 order 正牌消费入口=
// agent-slots pick」）。三职责：
//   pick <role> [--json]：单岗取位——seat=panel_order_head（同一 local agent_defaults 值）＋
//     cfg_hash＋谓词结果；主控把输出粘账本（本模块零账本写）。
//   preflight --taskbook <md> [--project <dir>] [--json]：组合 dispatch-pack／check-taskbook／
//     taskbook-evidence verify／本模块 pick 四工具，保存输入 sha256 与真实 rc；绝不写账本。
//   hook（PreToolUse Agent 匹配器·process argv 形态）：读 stdin 载荷判目标槽——目标≠同刻 pick、
//     载荷不明、配置不完备（顺序来源门红）均 exit 2 deny；允许=空 stdout exit 0；拒绝输出仅
//     目标/期望/原因（不记录 prompt/密钥）。宿主 stdin 契约未实探确认前禁启用（INFRA1 环境限制
//     降级：宿主 config.json 保持缺席，本子命令仅供主控探针后启用——实现报告已如实申报）。
// 退出码口径单源=references/06 §5.8（0=成功/1=业务红/3=配置·装载错；2=hook deny 专用）。
// 用法：node scripts/org-dispatch.mjs pick <role> [--json]
//      node scripts/org-dispatch.mjs preflight --taskbook <任务书.md> [--project <dir>] [--json]
//      node scripts/org-dispatch.mjs hook
//      node scripts/org-dispatch.mjs --self-test
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync, cpSync } from 'node:fs'
import { join, resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { SKILL_ROOT, DEFAULT_CFG, LOCAL_CFG, loadOrgConfig, cfgHash, cliFlag, UsageError } from './org-config.mjs'
import { MATRIX_PATH, ROLE_ORDER, loadMatrix, slotsFromMatrix } from './gen-agents.mjs'
import { orderGateProblems } from './org-bootstrap.mjs' // R1·B1：顺序来源门完整谓词单源（org-bootstrap 导出，与 agent-slots 共用）

const SELF = fileURLToPath(import.meta.url)
const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
const sha256Text = (t) => createHash('sha256').update(String(t ?? ''), 'utf8').digest('hex')
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const SLOT_RE = /^ops-(research|planner|assembler|executor|tbreview|planreview|implreview1|implreview2|adjudicator|vision)-([a-z0-9]+)-(low|high|max)$/

/** 装载顺序面（R1·B1：完整谓词单源=org-bootstrap.orderGateProblems——绑定槽覆盖＋首元
 *  一致＋序完整＋绑定齐备＋来源墙，直读 local 层）：门红→Error（CLI exit 3）。 */
function loadOrderOrThrow(projectDir = SKILL_ROOT) {
  const loaded = loadOrgConfig(projectDir)
  const matrix = loadMatrix(MATRIX_PATH)
  const localCfg = loaded.hasLocal ? JSON.parse(readFileSync(LOCAL_CFG, 'utf8')) : null
  const gate = orderGateProblems({ matrix, localCfg, hasLocal: loaded.hasLocal, localPath: LOCAL_CFG, overPath: loaded.hasOverride ? loaded.overPath : null })
  if (gate.length) throw new Error(`顺序来源门：${gate.join('；')}`)
  return { loaded, cfg: loaded.merged }
}

/** pick 谓词（纯读）：seat=panel_order_head=cfg.agent_defaults[role]；附 cfg_hash/family/level。 */
export function pickRole(role, { projectDir = SKILL_ROOT } = {}) {
  if (!ROLE_ORDER.includes(role)) {
    const e = new Error(`角色不存在：${role}（合法角色：${ROLE_ORDER.join(', ')}）`)
    e.code = 'UNKNOWN_ROLE'
    throw e
  }
  const { cfg } = loadOrderOrThrow(projectDir)
  const seat = cfg.agent_defaults[role]
  if (typeof seat !== 'string' || !seat) {
    const e = new Error(`agent_defaults.${role} 缺失——顺序单源=org-config.local.json，禁矩阵/出厂代位`)
    e.code = 'ORDER_INCOMPLETE'
    throw e
  }
  const slotDef = isPlainObject(cfg.agent_slots) ? cfg.agent_slots[seat] : null
  const provider = slotDef && typeof slotDef.provider === 'string' ? slotDef.provider : (SLOT_RE.exec(seat) || [])[2]
  const fam = isPlainObject(cfg.providers) && provider ? (cfg.providers[provider].family || cfg.providers[provider].model_family || '?') : '?'
  const level = (SLOT_RE.exec(seat) || [])[3] || (slotDef && slotDef.level) || '?'
  return {
    role,
    seat,
    panel_order_head: seat,
    route_source: 'pick',
    cfg_hash: `cfg:${cfgHash(cfg)}`,
    family: fam,
    level,
  }
}

/** Agent 载荷目标槽提取（INFRA1 D-4）：已知形态 tool_input.{agent,subagent_type,name/description
 *  承载槽名}——载荷不含任何 ops-* 槽名=载荷不明；非 ops 目标=不属本 matcher 执法面（allow）。
 *  返回 {kind:'ops', target}｜{kind:'non-ops'}｜{kind:'unclear'}。 */
export function hookTargetOf(payload) {
  const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name : (typeof payload?.toolName === 'string' ? payload.toolName : '')
  if (toolName && toolName !== 'Agent' && toolName !== 'Task') return { kind: 'non-ops', toolName }
  const input = isPlainObject(payload?.tool_input) ? payload.tool_input : (isPlainObject(payload?.toolInput) ? payload.toolInput : null)
  const candidates = input ? [input.agent, input.subagent_type, input.subagentType, input.name, input.agent_name] : []
  const target = candidates.find((v) => typeof v === 'string' && SLOT_RE.test(v))
  if (target) return { kind: 'ops', target, toolName }
  const anyAgentField = candidates.some((v) => typeof v === 'string' && v)
  if (anyAgentField) return { kind: 'non-ops', toolName }
  return { kind: 'unclear', toolName }
}

/** hook 决策（纯函数·无 IO）：ops 目标→与同刻 pick 比对；非 ops→allow；unclear/门红→deny。
 *  返回 {decision:'allow'}｜{decision:'deny', target, expected, reason}。 */
export function hookDecide(payload, { projectDir = SKILL_ROOT } = {}) {
  const hit = hookTargetOf(payload)
  if (hit.kind === 'non-ops') return { decision: 'allow', reason: `非 ops 目标承载（${hit.toolName || '?'}）——不属本 matcher 执法面` }
  if (hit.kind === 'unclear') return { decision: 'deny', target: null, expected: null, reason: '载荷不明：未识别 Agent 目标槽字段（stdin 契约外形态）' }
  let pick
  try {
    pick = pickRole((SLOT_RE.exec(hit.target) || [])[1], { projectDir })
  } catch (e) {
    return { decision: 'deny', target: hit.target, expected: null, reason: `配置不完备：${e.message}` }
  }
  if (pick.seat !== hit.target) return { decision: 'deny', target: hit.target, expected: pick.seat, reason: `目标≠同刻 pick（cfg=${pick.cfg_hash}）` }
  return { decision: 'allow', target: hit.target, expected: pick.seat, reason: `目标=同刻 pick（cfg=${pick.cfg_hash}）` }
}

/** 任务书 ROUTE 行提取（首个非围栏 ROUTE: 行；无→null）。 */
export function routeLineOf(text) {
  const lines = String(text ?? '').split('\n')
  let fence = false
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue }
    if (fence) continue
    if (/^\s*ROUTE\s*:/i.test(l)) return l
  }
  return null
}

/** 由任务书 ROUTE＋local 十岗 pick 合成 dispatch-plan §1 表（dispatch-check 三方对账载体）。 */
export function synthDispatchPlan(routeLine, picks) {
  const items = String(routeLine).replace(/^\s*ROUTE\s*:/i, '').split(/[;,\s]+/).filter(Boolean)
  const routed = new Map(items.map((it) => {
    const cut = it.indexOf('-')
    return [it.slice(0, cut), it.slice(cut + 1)]
  }))
  const rows = ROLE_ORDER.map((role) => {
    const viaRoute = routed.has(role)
    const slot = picks[role] && !String(picks[role]).startsWith('DENY:') ? picks[role] : '(缺)'
    return `| ${role} | ${slot} | ${viaRoute ? '任务书 ROUTE（prompt）' : '本机件 agent_defaults（local pick）'} | ${viaRoute ? '是' : '否'} | preflight 合成 |`
  })
  return ['# preflight 合成 dispatch-plan（org-dispatch·零账本写）', '', '## 1. 十岗实选表', '',
    '| 岗位 | 实际 slot | route_source | 启用 | 理由 |', '|---|---|---|---|---|', ...rows, '',
    '## 2. 批 ROUTE', '', '```', routeLine, '```', ''].join('\n')
}

/** preflight：四工具组合（输入 sha256＋真实 rc）；绝不写账本。 */
export function runPreflight({ taskbookPath, projectDir, evidencePath = null }) {
  if (!existsSync(taskbookPath)) return { code: 3, reason: `任务书不存在：${taskbookPath}` }
  const tbSha = sha256File(taskbookPath)
  const tbText = readFileSync(taskbookPath, 'utf8')
  const stem = basename(taskbookPath).replace(/\.md$/, '')
  const evCandidates = evidencePath ? [evidencePath] : [
    join(projectDir, 'docs', 'evidence', `${stem}-tb-facts.json`),
    join(projectDir, 'docs', 'evidence', `${stem.split('-')[0]}-tb-facts.json`),
  ]
  const evFound = evCandidates.find((p) => existsSync(p)) || null
  const run = (name, args, cwd) => {
    const r = spawnSync(process.execPath, [join(SKILL_ROOT, 'scripts', name), ...args], { encoding: 'utf8', cwd, timeout: 120_000 })
    return { name, cmd: `node scripts/${name} ${args.join(' ')}`, input_sha256: tbSha, exit: typeof r.status === 'number' ? r.status : -1, stdout_tail: String(r.stdout || '').trim().split('\n').slice(-2).join(' | '), stderr_tail: String(r.stderr || '').trim().split('\n').slice(-2).join(' | ') }
  }
  // 十岗 pick（本模块·合成 plan 的拟派面）
  const picks = {}
  let pickExit = 0
  for (const role of ROLE_ORDER) {
    try { picks[role] = pickRole(role, { projectDir }).seat } catch (e) { picks[role] = `DENY:${e.code || 'ERROR'}`; pickExit = 3 }
  }
  const tools = []
  // ① dispatch-plan 对账（agent-slots dispatch-check × 合成十岗表——ROUTE 行来自任务书）
  const routeLine = routeLineOf(tbText)
  if (routeLine) {
    const planPath = join(tmpdir(), `infra1-executor-preflight-plan-${process.pid}.md`)
    writeFileSync(planPath, synthDispatchPlan(routeLine, picks), 'utf8')
    const t = run('agent-slots.mjs', ['dispatch-check', '--plan', planPath, '--route', routeLine, '--project', projectDir], SKILL_ROOT)
    rmSync(planPath, { force: true })
    tools.push({ ...t, name: 'agent-slots dispatch-check（dispatch-plan 合成）' })
  } else {
    tools.push({ name: 'agent-slots dispatch-check（dispatch-plan 合成）', cmd: 'dispatch-check', input_sha256: tbSha, exit: null, note: '任务书无 ROUTE 行——dispatch-plan 对账跳过' })
  }
  tools.push(run('check-taskbook.mjs', [taskbookPath, '--root', projectDir, '--root', SKILL_ROOT, ...(evFound ? ['--evidence', evFound] : []), '--semantic-lint', '--strict'], SKILL_ROOT))
  tools.push(evFound
    ? run('taskbook-evidence.mjs', ['verify', '--taskbook', taskbookPath, '--evidence', evFound], SKILL_ROOT)
    : { name: 'taskbook-evidence.mjs', cmd: 'verify', input_sha256: tbSha, exit: null, note: `证据件缺席（候选：${evCandidates.join('；')}）——verify 跳过` })
  tools.push({ name: 'org-dispatch pick ×10', cmd: 'pick（本模块·十岗）', input_sha256: tbSha, exit: pickExit, picks })
  const bad = tools.filter((t) => t.exit !== 0)
  return { code: bad.length ? 1 : 0, taskbook: taskbookPath, taskbook_sha256: tbSha, evidence: evFound || '(缺席)', tools, bad: bad.map((t) => `${t.name}:${t.exit}`) }
}

// ── CLI ──
const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === SELF.toLowerCase()
if (isMain) {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) selfTest()
  const cmd = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--project' && argv[i - 1] !== '--taskbook' && argv[i - 1] !== '--evidence')[0] || null
  const projectDir = cliFlag(argv, '--project') ? resolve(cliFlag(argv, '--project')) : SKILL_ROOT
  const json = argv.includes('--json')
  try {
    if (cmd === 'pick') {
      const role = argv.filter((a) => !a.startsWith('--'))[1]
      if (!role) { console.error('[用法错] pick 需要 <role>'); process.exit(1) }
      const out = pickRole(role, { projectDir })
      if (json) console.log(JSON.stringify(out, null, 2))
      else console.log(out.seat)
      process.exit(0)
    }
    if (cmd === 'preflight') {
      const tb = cliFlag(argv, '--taskbook')
      if (!tb) { console.error('[用法错] preflight 需要 --taskbook <任务书.md>'); process.exit(1) }
      const ev = cliFlag(argv, '--evidence')
      const r = runPreflight({ taskbookPath: resolve(tb), projectDir: cliFlag(argv, '--project') ? projectDir : dirname(resolve(tb)), evidencePath: ev ? resolve(ev) : null })
      if (json) console.log(JSON.stringify(r, null, 2))
      else {
        console.log(`preflight：taskbook=${r.taskbook} sha256=${r.taskbook_sha256}`)
        console.log(`evidence=${r.evidence}`)
        for (const t of r.tools) console.log(`  ${t.exit === 0 ? 'PASS' : 'FAIL'} ${t.name} exit=${t.exit}${t.note ? ' ' + t.note : ''}`)
        console.log(`preflight=${r.code === 0 ? 'PASS' : 'FAIL'}（${r.bad.length ? r.bad.join(' ') : '四工具全过'}）`)
      }
      process.exit(r.code === 3 ? 3 : r.code)
    }
    if (cmd === 'hook') {
      // stdin 载荷（宿主 hook 契约）；决策输出仅目标/期望/原因——不回显载荷其余字段
      let raw = ''
      try { raw = readFileSync(0, 'utf8') } catch { /* stdin 缺席=载荷不明 */ }
      let payload = null
      try { payload = JSON.parse(raw) } catch { payload = null }
      const d = hookDecide(payload, { projectDir })
      if (d.decision === 'allow') {
        if (d.target) console.error(`[hook] allow：target=${d.target} ${d.reason}`)
        process.exit(0)
      }
      console.error(`[hook] deny：target=${d.target ?? '(不明)'} expected=${d.expected ?? '(不可得)'} reason=${d.reason}`)
      process.exit(2)
    }
    console.error('[用法错] 命令须为 pick|preflight|hook（或 --self-test）')
    process.exit(1)
  } catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
    console.error(`[装载错] ${e.message}（06 §5.8 行 3=配置/装载错）`)
    process.exit(3)
  }
}

// ── --self-test（夹具落 /tmp/infra1-executor-dispatch-*；hook 向量=合成载荷的匹配器单元
//    测试——非宿主 live fire（环境限制申报见实现报告）；零真实面写、零账本写）──
function selfTest() {
  let fails = 0
  let n = 0
  const tt = (name, cond) => { n++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) fails++ }
  const tmpRoot = mkdtempSync(join(tmpdir(), 'infra1-executor-dispatch-'))
  try {
    const realLocal = JSON.parse(readFileSync(LOCAL_CFG, 'utf8'))
    const strippedDefault = (() => { const d = JSON.parse(readFileSync(DEFAULT_CFG, 'utf8')); for (const k of ['agent_defaults', 'role_fallbacks', 'role_order_note']) delete d[k]; return d })()
    const mkStage = (name, { noLocal = false, dropRole = null } = {}) => {
      const dir = join(tmpRoot, name)
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      mkdirSync(join(dir, 'templates'), { recursive: true })
      cpSync(join(SKILL_ROOT, 'scripts'), join(dir, 'scripts'), { recursive: true })
      copyFileSync(MATRIX_PATH, join(dir, 'templates', 'agents.matrix.json'))
      writeFileSync(join(dir, basename(DEFAULT_CFG)), JSON.stringify(strippedDefault, null, 2) + '\n')
      if (!noLocal) {
        const l = JSON.parse(JSON.stringify(realLocal))
        if (dropRole) { delete l.agent_defaults[dropRole]; delete l.role_fallbacks[dropRole] }
        writeFileSync(join(dir, basename(LOCAL_CFG)), JSON.stringify(l, null, 2) + '\n')
      }
      return dir
    }
    const runAt = (dir, args) => spawnSync(process.execPath, [join(dir, 'scripts', 'org-dispatch.mjs'), ...args], { encoding: 'utf8', cwd: dir })
    const outOf = (r) => `${r.stdout || ''}${r.stderr || ''}`

    // pick 契约
    const pOk = pickRole('implreview1')
    tt('pick 契约：seat=panel_order_head＋route_source=pick＋cfg_hash 前缀 cfg:＋family/level 可解析',
      pOk.seat === pOk.panel_order_head && pOk.route_source === 'pick' && /^cfg:[0-9a-f]{12}$/.test(pOk.cfg_hash) && !!pOk.family && !!pOk.level)
    const pJson = runAt(SKILL_ROOT, ['pick', 'implreview1', '--json'])
    let j = null
    try { j = JSON.parse(pJson.stdout || '') } catch { j = null }
    tt('pick CLI --json：键序恰为 role,seat,panel_order_head,route_source,cfg_hash,family,level 且与真实 local 首选一致',
      pJson.status === 0 && j && JSON.stringify(Object.keys(j)) === JSON.stringify(['role', 'seat', 'panel_order_head', 'route_source', 'cfg_hash', 'family', 'level']) && j.seat === realLocal.agent_defaults.implreview1)
    const pBad = runAt(SKILL_ROOT, ['pick', 'wizard'])
    tt('pick 未知角色：exit 3（装载错族承载未知角色）', pBad.status === 3 && outOf(pBad).includes('角色不存在'))

    // 子进程负例（V-2 token 面）
    const sNL = mkStage('no-local', { noLocal: true })
    const rNL = runAt(sNL, ['pick', 'executor'])
    const sInc = mkStage('incomplete', { dropRole: 'implreview2' })
    const rInc = runAt(sInc, ['pick', 'implreview2'])
    const sDD = mkStage('no-default', { noLocal: false })
    rmSync(join(sDD, basename(DEFAULT_CFG)))
    const rDD = runAt(sDD, ['pick', 'executor'])
    const sMX = mkStage('matrix-x')
    tt('local_missing=deny：无本机件 → pick exit 3＋零 seat stdout',
      rNL.status === 3 && (rNL.stdout || '').trim() === '' && outOf(rNL).includes('顺序来源门'))
    tt('incomplete_order=deny：role_fallbacks 缺 implreview2 → pick exit 3＋零 seat stdout',
      rInc.status === 3 && (rInc.stdout || '').trim() === '' && outOf(rInc).includes('implreview2'))
    tt('default_absent=deny：默认件物理删除 → pick exit 3（禁矩阵代位）',
      rDD.status === 3 && (rDD.stdout || '').trim() === '' && outOf(rDD).includes('装载'))
    tt('matrix_fallback=0：矩阵零序键（staging 模板=现役无序形态）＋pick 仍取 local 首选',
      (() => {
        const m = JSON.parse(readFileSync(join(sMX, 'templates', 'agents.matrix.json'), 'utf8'))
        const noOrder = Object.values(m.roles).every((r) => !own(r, 'default') && !own(r, 'fallback'))
        const r = runAt(sMX, ['pick', 'executor'])
        return noOrder && r.status === 0 && (r.stdout || '').trim() === realLocal.agent_defaults.executor
      })())
    const sPO = mkStage('proj-override')
    const projPO = join(tmpRoot, 'proj-po')
    mkdirSync(join(projPO, '.zcode'), { recursive: true })
    writeFileSync(join(projPO, '.zcode', 'org-config.json'), JSON.stringify({ agent_defaults: { executor: 'ops-executor-ds-high' } }))
    const rPO = runAt(sPO, ['pick', 'executor', '--project', projPO])
    tt('project_override=deny：项目覆盖件携带顺序键 → pick exit 3',
      rPO.status === 3 && outOf(rPO).includes('项目覆盖件'))

    // R1·B1 对抗夹具负例②：agent_defaults.executor=ds 而 fallback 首元=glm → pick exit 3
    //（一审实证红态：rc0 且输出 seat=ds——完整谓词首元一致断言补位）
    const sHead = mkStage('head-mismatch')
    {
      const l = JSON.parse(readFileSync(join(sHead, basename(LOCAL_CFG)), 'utf8'))
      l.agent_defaults.executor = 'ops-executor-ds-high'
      writeFileSync(join(sHead, basename(LOCAL_CFG)), JSON.stringify(l))
    }
    const rHead = runAt(sHead, ['pick', 'executor'])
    tt('R1·B1 负例②：agent_defaults=ds 而 fallback 首元=glm → pick exit 3＋零 seat stdout＋点名首元不一致',
      rHead.status === 3 && (rHead.stdout || '').trim() === '' && outOf(rHead).includes('首元'))

    // hook 匹配器单元向量（合成载荷——非宿主 live fire；环境限制如实申报）
    const hAllow = hookDecide({ tool_name: 'Agent', tool_input: { agent: realLocal.agent_defaults.executor } })
    const hDeny = hookDecide({ tool_name: 'Agent', tool_input: { agent: 'ops-executor-ds-high' } })
    const hUnclear = hookDecide({ tool_name: 'Agent', tool_input: { prompt: '随便一段指令文本' } })
    const hNonOps = hookDecide({ tool_name: 'Agent', tool_input: { agent: 'general-purpose' } })
    const hOther = hookDecide({ tool_name: 'Bash', tool_input: { command: 'ls' } })
    tt('hook 匹配器（合成载荷单元）：目标=同刻 pick→allow；目标≠pick→deny 带 target/expected；载荷不明→deny；非 ops 承载→allow；非 Agent 工具→allow',
      hAllow.decision === 'allow' && hDeny.decision === 'deny' && hDeny.target === 'ops-executor-ds-high' && hDeny.expected === realLocal.agent_defaults.executor &&
      hUnclear.decision === 'deny' && hUnclear.reason.includes('载荷不明') && hNonOps.decision === 'allow' && hOther.decision === 'allow')
    const hProc = runAt(SKILL_ROOT, ['hook'])
    const hProc2 = spawnSync(process.execPath, [join(SKILL_ROOT, 'scripts', 'org-dispatch.mjs'), 'hook'], { input: JSON.stringify({ tool_name: 'Agent', tool_input: { agent: 'ops-executor-ds-high' } }), encoding: 'utf8' })
    tt('hook CLI：stdin 缺席/不可解析 → exit 2；目标≠pick → exit 2 且 stderr 仅含目标/期望/原因（不含 prompt 字段）',
      hProc.status === 2 && hProc2.status === 2 && String(hProc2.stderr || '').includes('target=ops-executor-ds-high') && String(hProc2.stderr || '').includes('expected=') && !String(hProc2.stderr || '').includes('随便'))
    const hAllowProc = spawnSync(process.execPath, [join(SKILL_ROOT, 'scripts', 'org-dispatch.mjs'), 'hook'], { input: JSON.stringify({ tool_name: 'Agent', tool_input: { agent: realLocal.agent_defaults.implreview1 } }), encoding: 'utf8' })
    tt('hook CLI：目标=同刻 pick → exit 0＋空 stdout', hAllowProc.status === 0 && (hAllowProc.stdout || '').trim() === '')

    // preflight：合成任务书（/tmp 夹具——四工具真 rc 捕获；零账本写）
    const pfProj = join(tmpRoot, 'pfproj')
    mkdirSync(join(pfProj, 'docs', 'evidence'), { recursive: true })
    const pfTb = join(pfProj, 'docs', 'tasks', 'pf.md')
    mkdirSync(dirname(pfTb), { recursive: true })
    writeFileSync(pfTb, ['# pf 夹具', '', 'ROUTE: executor-glm;implreview1-yyx', '', '## 2. 白名单', '', '| `SKILL.md` | 只读 |', '', '## 4. 验收命令', '', '```bash', 'echo "exit=$?"', '```', ''].join('\n'))
    const pf = runPreflight({ taskbookPath: pfTb, projectDir: pfProj })
    tt('preflight：四工具组合＋任务书 sha256＋逐工具真 rc 捕获（dispatch-plan 合成对账＋evidence 缺席如实 SKIP 标注）',
      pf.taskbook_sha256.length === 64 && pf.tools.length === 4 &&
      pf.tools.some((t) => t.name.startsWith('agent-slots dispatch-check') && typeof t.exit === 'number') &&
      pf.tools.some((t) => t.name === 'check-taskbook.mjs' && typeof t.exit === 'number') &&
      pf.tools.some((t) => t.name === 'taskbook-evidence.mjs' && (t.exit === null || typeof t.exit === 'number')) &&
      pf.tools.some((t) => t.name.startsWith('org-dispatch pick') && t.exit === 0 && t.picks.executor === realLocal.agent_defaults.executor))
    const pfCli = runAt(SKILL_ROOT, ['preflight', '--taskbook', pfTb, '--project', pfProj, '--json'])
    let pfJ = null
    try { pfJ = JSON.parse(pfCli.stdout || '') } catch { pfJ = null }
    tt('preflight CLI --json：taskbook_sha256 与工具 exit 透传（绝不写账本——输出仅 stdout）',
      pfCli.status === (pfJ && pfJ.code === 0 ? 0 : pfJ && pfJ.code === 3 ? 3 : 1) && !!pfJ && pfJ.tools.length === 4)
    console.log('local_missing=deny incomplete_order=deny default_absent=deny matrix_fallback=0 project_override=deny bootstrap_sleep=ZERO_WRITE resume_existing=UNCHANGED')
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true })
  }
  console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
  process.exit(fails === 0 ? 0 : 1)
}
