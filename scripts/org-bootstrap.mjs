#!/usr/bin/env node
// org-bootstrap.mjs —— 两态引导模块（INFRA1 批 D-3·规范锚=账本 1127「模块幂等续配不重初始化」）。
// 职责：收编散置引导（install/validate/sync/DEPLOY §7——deploy-check --install 委托本件），
// 调用面保留（deploy-check --install／org-config validate／--sync-agents 入口不变）。
// 两态契约（任务书 §3.3）：
//   ready 且非显式请求 → 休眠零写（任何命令不落任何文件）；
//   needs_bootstrap 或用户显式要求（guide/resume/freeze/install）→ 才允许最小骨架、
//   缺失 bindings 渲染、sync、validate。
// freeze（D-1 冻结迁移）：--dry-run 逐角色 before/after（action=unchanged/fill/reject）；
//   正式 freeze 只补 local 缺失键（已有键逐值不同即拒绝、不覆盖），完成后再剥 default
//   的 agent_defaults/role_fallbacks/role_order_note（顺序单源=本机件·账本 1126）。
// 续配（resume）只补缺、不改已有值；初始空面不得臆造排序——打印后台面板配置指令，
// 待用户面板写序后幂等续跑至全绿。
// 退出码口径单源=references/06 §5.8（0=成功／1=业务红·freeze 拒绝／3=配置·装载错）。
// 用法：node scripts/org-bootstrap.mjs status|freeze|guide|resume|install [--project <dir>] [--dry-run] [--json]
//      node scripts/org-bootstrap.mjs --self-test
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, cpSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { SKILL_ROOT, loadOrgConfig, cfgHash, readJson, cliFlag, UsageError, validateOrderSourceWall, ORDER_SOURCE_KEYS, DEFAULT_ONLY_ORDER_KEYS, readHostConfig } from './org-config.mjs'
import { MATRIX_PATH, ROLE_ORDER, loadMatrix, slotsFromMatrix } from './gen-agents.mjs'
import { installLocalConfig, installAgents, installHook, installHostFacts } from './deploy-check.mjs'

const SELF = fileURLToPath(import.meta.url)
const DEFAULT_CFG = join(SKILL_ROOT, 'org-config.default.json')
const LOCAL_CFG = join(SKILL_ROOT, 'org-config.local.json')
const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

/** 顺序来源门完整谓词（INFRA1 返工 R1·B1 单源导出——agent-slots/org-dispatch/log-triage
 *  import 共用，禁两处复制）：local 缺失／agent_defaults·role_fallbacks 序完整（十岗键在
 *  场且非空）／矩阵绑定槽全覆盖（每角色矩阵 slot ⊆ local role_fallbacks）／agent_defaults
 *  =fallback 首元／矩阵绑定槽绑定齐备／来源墙（default/project 层携带顺序键）。直读 local
 *  层对象（不读合并结果——默认件/项目残键不得补出假完整序）。返回问题数组（空=通过）。 */
export function orderGateProblems({ matrix, localCfg, hasLocal, localPath = null, overPath = null, defaultCfg = null } = {}) {
  const problems = []
  const slots = slotsFromMatrix(matrix)
  const byRole = new Map(ROLE_ORDER.map((r) => [r, []]))
  for (const s of slots) if (byRole.has(s.role)) byRole.get(s.role).push(s.slot)
  if (hasLocal === false) problems.push(`本机件缺失：${localPath || join(SKILL_ROOT, 'org-config.local.json')}（顺序单源=本机件，禁出厂默认/矩阵静默代位；guide/resume 可脚手架最小骨架）`)
  const defaults = isPlainObject(localCfg?.agent_defaults) ? localCfg.agent_defaults : null
  const fallbacks = isPlainObject(localCfg?.role_fallbacks) ? localCfg.role_fallbacks : null
  const bindings = isPlainObject(localCfg?.agent_bindings) ? localCfg.agent_bindings : null
  if (hasLocal !== false) {
    if (!defaults) problems.push('local agent_defaults 分区缺失/非对象（顺序单源=本机件——面板写序后复跑）')
    if (!fallbacks) problems.push('local role_fallbacks 分区缺失/非对象（顺序单源=本机件——面板写序后复跑）')
    for (const role of ROLE_ORDER) {
      if (defaults && !own(defaults, role)) problems.push(`agent_defaults 缺角色 ${role}（面板写序后复跑）`)
      if (fallbacks && own(fallbacks, role)) {
        const seq = Array.isArray(fallbacks[role]) ? fallbacks[role] : []
        if (!seq.length) problems.push(`role_fallbacks.${role} 为空数组（面板写序后复跑）`)
        else {
          const uncovered = byRole.get(role).filter((slot) => !seq.includes(slot))
          if (uncovered.length) problems.push(`已绑定待位序不全：role_fallbacks.${role} 未覆盖矩阵绑定槽 ${uncovered.length} 个：${uncovered.slice(0, 3).join('、')}${uncovered.length > 3 ? '…' : ''}`)
          if (defaults && own(defaults, role) && seq[0] !== defaults[role]) problems.push(`agent_defaults.${role}≠role_fallbacks.${role} 首元（${defaults[role]} vs ${seq[0] ?? '缺失'}）`)
        }
      } else if (fallbacks) problems.push(`role_fallbacks 缺角色 ${role}（面板写序后复跑）`)
    }
    if (bindings) {
      // R1·W2：绑定值 TODO/空串占位=未就绪（resume 补键后仍非 ready——sync/validate 链按未就绪传播）
      const unbound = slots.filter((s) => !own(bindings, s.slot) || bindings[s.slot] === 'TODO' || bindings[s.slot] === '')
      if (unbound.length) problems.push(`agent_bindings 缺矩阵绑定槽/占位未填 ${unbound.length} 个（首例 ${unbound[0].slot}）`)
    } else problems.push('agent_bindings 分区缺失（guide/resume 可渲染缺失键）')
  }
  let projectCfg = null
  if (overPath && existsSync(overPath)) { try { projectCfg = readJson(overPath) } catch { projectCfg = {} } }
  const defCfg = defaultCfg !== null ? defaultCfg : (() => { try { return readJson(DEFAULT_CFG) } catch { return {} } })()
  problems.push(...validateOrderSourceWall({ defaultCfg: defCfg, projectCfg }))
  return problems
}

/** 就绪谓词（运行时与向导共用·任务书 §3.3.1）——委托 orderGateProblems 单源（R1·B1）。
 *  返回 {ready, missing:[...], detail:{...}}（纯读·零写）。 */
export function bootstrapState({ matrix, localCfg, hasLocal, localPath, overPath = null, defaultCfg = null }) {
  const missing = orderGateProblems({ matrix, localCfg, hasLocal, localPath, overPath, defaultCfg })
  return { ready: missing.length === 0, missing, detail: { slots: slotsFromMatrix(matrix).length, roles: ROLE_ORDER.length } }
}

/** 装载三层与矩阵（装载失败抛——调用侧按 exit 3 承接）。 */
function loadAll(projectDir) {
  const loaded = loadOrgConfig(projectDir)
  const matrix = loadMatrix(MATRIX_PATH)
  const defaultCfg = readJson(DEFAULT_CFG)
  const localCfg = loaded.hasLocal ? readJson(LOCAL_CFG) : null
  const projectCfg = loaded.hasOverride ? readJson(loaded.overPath) : null
  return { loaded, matrix, defaultCfg, localCfg, projectCfg }
}

/** freeze 计划（纯函数）：逐角色 action=unchanged/fill/reject＋default 剥离面。
 *  依据=迁移前 merged（default 出厂序仍承载顺序的旧形态）——本批授权迁移=冻结
 *  merged 语义到 local（账本 1126：此后无出厂排序概念）。 */
export function planFreeze({ defaultCfg, localCfg, projectCfg, merged }) {
  const rows = []
  const factoryDefaults = isPlainObject(merged?.agent_defaults) ? merged.agent_defaults : null
  const factoryFallbacks = isPlainObject(merged?.role_fallbacks) ? merged.role_fallbacks : null
  const localDefaults = isPlainObject(localCfg?.agent_defaults) ? localCfg.agent_defaults : {}
  const localFallbacks = isPlainObject(localCfg?.role_fallbacks) ? localCfg.role_fallbacks : {}
  for (const role of ROLE_ORDER) {
    const before = own(localDefaults, role) ? localDefaults[role] : null
    const after = factoryDefaults ? factoryDefaults[role] : null
    const localSeq = own(localFallbacks, role) && Array.isArray(localFallbacks[role]) ? localFallbacks[role] : null
    let action
    if (before !== null && localSeq && localSeq.length && localSeq[0] === before && before === after) action = 'unchanged'
    else if (before === null && !localSeq && after) action = 'fill'
    else action = 'reject' // 已有键与迁移前 merged 逐值不同（或键面半缺/内部不一致）——fail-closed 拒绝，不覆盖
    rows.push({ role, action, before: before ?? '(缺失)', after: after ?? '(缺失)' })
  }
  // 来源墙在 freeze 语境只拦 project 侧：default 携带顺序键正是 freeze 要剥离的迁移前面
  // （不构成拒绝）；项目覆盖件携带顺序键则冻结后仍无法闭墙 → 拒绝冻结。
  const wall = validateOrderSourceWall({ defaultCfg: null, projectCfg })
  const stripKeys = [...ORDER_SOURCE_KEYS, ...DEFAULT_ONLY_ORDER_KEYS].filter((k) => isPlainObject(defaultCfg) && own(defaultCfg, k))
  return { rows, wall, stripKeys, fill: rows.filter((r) => r.action === 'fill').length, unchanged: rows.filter((r) => r.action === 'unchanged').length, reject: rows.filter((r) => r.action === 'reject').length }
}

// ── CLI ──
const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === SELF.toLowerCase()
if (isMain) {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) { selfTest() }
  let cmd = null
  let projectDir = process.cwd()
  try {
    const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--project')
    cmd = positional[0] || null
    const p = cliFlag(argv, '--project')
    if (p !== null) projectDir = resolve(p)
  } catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
    throw e
  }
  if (!cmd || !['status', 'freeze', 'guide', 'resume', 'install'].includes(cmd)) {
    console.error('[用法错] 命令须为 status|freeze|guide|resume|install（或 --self-test）——ready 且非显式请求一律休眠零写')
    process.exit(1)
  }
  let all
  try {
    all = loadAll(projectDir)
  } catch (e) {
    console.error(`[装载错] ${e.message}（06 §5.8 行 3=配置/装载错）`)
    process.exit(3)
  }
  const { loaded, matrix, defaultCfg, localCfg, projectCfg } = all
  const json = argv.includes('--json')

  if (cmd === 'status') {
    const st = bootstrapState({ matrix, localCfg, hasLocal: loaded.hasLocal, localPath: LOCAL_CFG })
    if (json) console.log(JSON.stringify({ status: st.ready ? 'ready' : 'needs_bootstrap', missing: st.missing, ...st.detail }))
    else {
      console.log(`status=${st.ready ? 'ready' : 'needs_bootstrap'}`)
      for (const m of st.missing) console.log(`missing: ${m}`)
      if (st.ready) console.log('零写休眠：ready 态 status 只读零写（显式 guide/resume/freeze/install 才有写面）')
    }
    process.exit(0)
  }

  if (cmd === 'freeze') {
    const plan = planFreeze({ defaultCfg, localCfg, projectCfg, merged: loaded.merged })
    const beforeHash = `cfg:${cfgHash(loaded.merged)}`
    if (argv.includes('--dry-run')) {
      for (const r of plan.rows) console.log(`role=${r.role} action=${r.action} before=${r.before} after=${r.after}`)
      for (const w of plan.wall) console.log(`[拒绝] ${w}`)
      console.log(`freeze dry-run：fill=${plan.fill} unchanged=${plan.unchanged} reject=${plan.reject} strip_keys=${plan.stripKeys.join(',') || '无'} before_cfg=${beforeHash}`)
      process.exit(plan.reject > 0 || plan.wall.length ? 1 : 0)
    }
    if (plan.reject > 0 || plan.wall.length) {
      for (const r of plan.rows.filter((x) => x.action === 'reject')) console.error(`[拒绝] role=${r.role} 已有键逐值不同（before=${r.before} after=${r.after}）——freeze 只补缺失键，不覆盖`)
      for (const w of plan.wall) console.error(`[拒绝] ${w}`)
      process.exit(1)
    }
    // local 补缺（值=迁移前 merged 现序）
    let nextLocal = localCfg && isPlainObject(localCfg) ? localCfg : {}
    let wroteLocal = false
    if (plan.fill > 0 || !loaded.hasLocal) {
      const factoryDefaults = isPlainObject(loaded.merged.agent_defaults) ? loaded.merged.agent_defaults : {}
      const factoryFallbacks = isPlainObject(loaded.merged.role_fallbacks) ? loaded.merged.role_fallbacks : {}
      nextLocal = {
        ...nextLocal,
        agent_defaults: { ...(isPlainObject(nextLocal.agent_defaults) ? nextLocal.agent_defaults : {}), ...Object.fromEntries(plan.rows.filter((r) => r.action === 'fill').map((r) => [r.role, factoryDefaults[r.role]])) },
        role_fallbacks: { ...(isPlainObject(nextLocal.role_fallbacks) ? nextLocal.role_fallbacks : {}), ...Object.fromEntries(plan.rows.filter((r) => r.action === 'fill').map((r) => [r.role, factoryFallbacks[r.role]])) },
      }
      writeFileSync(LOCAL_CFG, JSON.stringify(nextLocal, null, 2) + '\n')
      wroteLocal = true
    }
    // default 剥三键（零差=零写）
    let wroteDefault = false
    if (plan.stripKeys.length) {
      const nextDefault = { ...defaultCfg }
      for (const k of plan.stripKeys) delete nextDefault[k]
      writeFileSync(DEFAULT_CFG, JSON.stringify(nextDefault, null, 2) + '\n')
      wroteDefault = true
    }
    const afterLoaded = loadOrgConfig(projectDir)
    const afterHash = `cfg:${cfgHash(afterLoaded.merged)}`
    console.log(`freeze 完成：fill=${plan.fill} unchanged=${plan.unchanged} reject=0 wrote_local=${wroteLocal} wrote_default=${wroteDefault}（剥离 ${plan.stripKeys.join('/') || '无'}）`)
    console.log(`cfg before=${beforeHash} after=${afterHash}`)
    const wall = validateOrderSourceWall({ defaultCfg: readJson(DEFAULT_CFG), projectCfg: null })
    if (wall.length) { console.error(`[FAIL] 迁移后来源墙仍红：${wall.join('；')}`); process.exit(1) }
    process.exit(0)
  }

  // guide/resume：显式唤醒；ready 态零写休眠
  if (cmd === 'guide' || cmd === 'resume') {
    const st = bootstrapState({ matrix, localCfg, hasLocal: loaded.hasLocal, localPath: LOCAL_CFG })
    const beforeHashes = snapshotTree(SKILL_ROOT)
    const writes = []
    if (!loaded.hasLocal) {
      const r = installLocalConfig(defaultCfg, LOCAL_CFG)
      console.log(`[${cmd}] ${r.line}`)
      writes.push('local-skeleton')
    }
    const curLocal = existsSync(LOCAL_CFG) ? readJson(LOCAL_CFG) : null
    if (curLocal && isPlainObject(curLocal)) {
      const slots = slotsFromMatrix(matrix)
      const bindings = { ...(isPlainObject(curLocal.agent_bindings) ? curLocal.agent_bindings : {}) }
      const missing = slots.filter((s) => !own(bindings, s.slot))
      if (missing.length) {
        for (const s of missing) bindings[s.slot] = 'TODO'
        writeFileSync(LOCAL_CFG, JSON.stringify({ ...curLocal, agent_bindings: bindings }, null, 2) + '\n')
        console.log(`[${cmd}] 补缺失绑定键 ${missing.length} 个（TODO 占位——填实值后复跑 validate；实值单源=本机件 agent_bindings）`)
        writes.push(`bindings+${missing.length}`)
      }
    }
    // 初始空面不得臆造排序：local 无顺序键时打印面板配置指令，不写顺序
    const curLocal2 = existsSync(LOCAL_CFG) ? readJson(LOCAL_CFG) : null
    const orderMissing = !isPlainObject(curLocal2?.agent_defaults) || !isPlainObject(curLocal2?.role_fallbacks) || ROLE_ORDER.some((r) => !own(curLocal2.agent_defaults, r) || !own(curLocal2.role_fallbacks, r))
    if (orderMissing) {
      console.log(`[${cmd}] 顺序面不全——不臆造排序；面板写序指令：启动 panel（bash panel/start.sh）→ 拖拽排序保存（原子写本机件 role_fallbacks＋agent_defaults，validate 不过即回滚）→ 复跑本命令至 ready`)
      writes.push('order=deferred-to-panel')
    }
    // R1·W2：rc 传播——ready 才编排 deploy-check --sync-agents（唯一 sync 入口；未就绪不触发，
    // 防 TODO 绑定全或无失败噪声）；validate rc 透传；未就绪 exit 非零。
    const stAfter = bootstrapState({ matrix, localCfg: existsSync(LOCAL_CFG) ? readJson(LOCAL_CFG) : null, hasLocal: existsSync(LOCAL_CFG), localPath: LOCAL_CFG })
    let syncExit = null
    if (stAfter.ready) {
      const sync = spawnSync(process.execPath, [join(SKILL_ROOT, 'scripts', 'deploy-check.mjs'), '--sync-agents'], { cwd: SKILL_ROOT, encoding: 'utf8' })
      for (const l of String(sync.stdout || '').split('\n')) if (l.trim()) console.log(l)
      for (const l of String(sync.stderr || '').split('\n')) if (l.trim()) console.error(l)
      syncExit = sync.status
      console.log(`[${cmd}] sync-agents exit=${syncExit}`)
    } else {
      console.log(`[${cmd}] sync-agents 跳过（未就绪——补齐后本命令自动编排，唯一 sync 入口=deploy-check --sync-agents）`)
    }
    const v = spawnSync(process.execPath, [join(SKILL_ROOT, 'scripts', 'org-config.mjs'), 'validate'], { cwd: SKILL_ROOT, encoding: 'utf8' })
    console.log(`[${cmd}] validate exit=${v.status}${v.status !== 0 ? '（顺序/绑定补齐前按 fail-closed 预期红）' : ''}`)
    const afterHashes = snapshotTree(SKILL_ROOT)
    const changed = beforeHashes.filter((h, i) => h !== afterHashes[i])
    console.log(`${cmd} 完成：ready=${stAfter.ready} writes=[${writes.join(', ') || '零写'}] tree_changed=${changed.length ? changed.join(',') : '0'}`)
    let exitCode = syncExit !== null && syncExit !== 0 ? syncExit : v.status
    if (exitCode === 0 && !stAfter.ready) exitCode = 1 // 未就绪＝exit 非零（R1·W2）
    process.exit(exitCode)
  }

  if (cmd === 'install') {
    // deploy-check --install 委托面（调用面保留）：四动作收编（③a/④/⑤/③）
    let failCount = 0
    let lc
    try { lc = installLocalConfig(readJson(DEFAULT_CFG), LOCAL_CFG) } catch (e) { lc = { wrote: false, level: 'FAIL', line: `install-localconfig——跳过：默认件装载失败（${e.message}）` } }
    console.log(`[install] ${lc.line}`)
    if (lc.level === 'FAIL') failCount++
    let tplBindings = {}
    let tplOverrides = null
    try { const m = loadOrgConfig(SKILL_ROOT).merged; tplBindings = m.agent_bindings || {}; tplOverrides = m.thought_level_overrides ?? null } catch (e) { console.log(`[warn] agent_bindings 装载失败（${e.message}）`) }
    const ia = installAgents(join(process.env.HOME || '', '.zcode', 'agents'), tplBindings, tplOverrides)
    console.log(`[install] ${ia.line}`)
    if (ia.level === 'FAIL') failCount++
    console.log(`[install] ${installHook()}`)
    let hf
    try {
      const oc = loadOrgConfig(SKILL_ROOT)
      const hostCfg = readHostConfig()
      hf = hostCfg ? installHostFacts(oc.merged, hostCfg, oc.overPath) : { wrote: false, level: 'warn', line: 'install-hostfacts——跳过：宿主配置装载失败——手工路径=DEPLOY §3' }
    } catch (e) { hf = { wrote: false, level: 'warn', line: `install-hostfacts——跳过：${e.message}——手工路径=DEPLOY §3` } }
    if (hf.level === 'FAIL') failCount++
    console.log(hf.level === 'FAIL' ? `[FAIL] ${hf.line}` : `[install] ${hf.line}`)
    process.exit(failCount > 0 ? 1 : 0)
  }
}

/** 技能根关键件树哈希（零写断言用）：org-config 双件＋矩阵。 */
function snapshotTree(root) {
  return ['org-config.default.json', 'org-config.local.json', 'templates/agents.matrix.json'].map((f) => {
    const p = join(root, f)
    return existsSync(p) ? sha256File(p) : 'ABSENT'
  })
}

// ── --self-test（夹具落 /tmp/infra1-executor-bootstrap-*；零真实面写）──
function selfTest() {
  let fails = 0
  let n = 0
  const tt = (name, cond) => { n++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) fails++ }
  const tmpRoot = mkdtempSync(join(tmpdir(), 'infra1-executor-bootstrap-'))
  try {
    const mkStage = (name) => {
      const dir = join(tmpRoot, name)
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      mkdirSync(join(dir, 'templates'), { recursive: true })
      cpSync(join(SKILL_ROOT, 'scripts'), join(dir, 'scripts'), { recursive: true })
      copyFileSync(join(SKILL_ROOT, 'templates', 'agents.matrix.json'), join(dir, 'templates', 'agents.matrix.json'))
      copyFileSync(DEFAULT_CFG, join(dir, 'org-config.default.json'))
      return dir
    }
    const realLocal = readJson(LOCAL_CFG)
    const runAt = (dir, args, cwd = dir) => spawnSync(process.execPath, [join(dir, 'scripts', 'org-bootstrap.mjs'), ...args], { encoding: 'utf8', cwd })
    const runSlots = (dir, args) => spawnSync(process.execPath, [join(dir, 'scripts', 'agent-slots.mjs'), ...args], { encoding: 'utf8', cwd: dir })
    const outOf = (r) => `${r.stdout || ''}${r.stderr || ''}`
    const hashTree = (dir) => ['org-config.default.json', 'org-config.local.json', 'templates/agents.matrix.json'].map((f) => { const p = join(dir, f); return existsSync(p) ? sha256File(p) : 'ABSENT' })

    // 负例①：local 缺失 → pick/resolve deny 3＋零 seat stdout；status=needs_bootstrap
    const s1 = mkStage('no-local')
    const p1 = runSlots(s1, ['pick', 'executor'])
    const r1 = runAt(s1, ['status'])
    tt('负例 local_missing=deny：staging 无本机件 → pick exit 3＋零 seat stdout＋status=needs_bootstrap',
      p1.status === 3 && (p1.stdout || '').trim() === '' && outOf(p1).includes('顺序来源门') &&
      r1.status === 0 && outOf(r1).includes('needs_bootstrap'))

    // 负例②：已绑定待位序不全（单删一角色）→ deny 3（default 先剥序键=迁移后形态，
    // 缺角只能来自 local——merged 补不齐）
    const s2 = mkStage('incomplete')
    const def2 = readJson(join(s2, 'org-config.default.json'))
    for (const k of [...ORDER_SOURCE_KEYS, ...DEFAULT_ONLY_ORDER_KEYS]) delete def2[k]
    writeFileSync(join(s2, 'org-config.default.json'), JSON.stringify(def2, null, 2) + '\n')
    const l2 = JSON.parse(JSON.stringify(realLocal))
    delete l2.role_fallbacks.implreview2
    writeFileSync(join(s2, 'org-config.local.json'), JSON.stringify(l2))
    const p2 = runSlots(s2, ['pick', 'implreview2'])
    tt('负例 incomplete_order=deny：role_fallbacks 缺 implreview2 → pick exit 3＋点名缺角',
      p2.status === 3 && (p2.stdout || '').trim() === '' && outOf(p2).includes('implreview2'))

    // 负例③：默认件物理删除 → deny 3（不得改用矩阵）
    const s3 = mkStage('no-default')
    writeFileSync(join(s3, 'org-config.local.json'), JSON.stringify(realLocal))
    rmSync(join(s3, 'org-config.default.json'))
    const p3 = runSlots(s3, ['pick', 'executor'])
    tt('负例 default_absent=deny：默认件物理删除 → pick exit 3（禁矩阵代位）',
      p3.status === 3 && (p3.stdout || '').trim() === '' && outOf(p3).includes('装载'))

    // 负例④：矩阵序不可代位——矩阵（迁移前形态）携带与 local 不同的出厂序时，pick 仍取
    // local 首选；D-2 起矩阵携带顺序键即装载拒（两种形态均=矩阵代位 0）。
    const s4 = mkStage('matrix-no-sub')
    const def4 = readJson(join(s4, 'org-config.default.json'))
    for (const k of [...ORDER_SOURCE_KEYS, ...DEFAULT_ONLY_ORDER_KEYS]) delete def4[k]
    writeFileSync(join(s4, 'org-config.default.json'), JSON.stringify(def4, null, 2) + '\n')
    writeFileSync(join(s4, 'org-config.local.json'), JSON.stringify(realLocal, null, 2) + '\n')
    const m4 = readJson(join(s4, 'templates', 'agents.matrix.json'))
    if (m4.roles && m4.roles.executor) m4.roles.executor.default = 'ds'
    writeFileSync(join(s4, 'templates', 'agents.matrix.json'), JSON.stringify(m4))
    const p4 = runSlots(s4, ['pick', 'executor'])
    tt('负例 matrix_fallback=0：矩阵序与 local 不一致 → pick=local 首选（矩阵代位=0）',
      (p4.status === 0 && (p4.stdout || '').trim() === realLocal.agent_defaults.executor) || p4.status === 3)

    // 负例⑤：项目覆盖件携带顺序键 → deny 3
    const s5 = mkStage('proj-override')
    writeFileSync(join(s5, 'org-config.local.json'), JSON.stringify(realLocal))
    const proj5 = join(tmpRoot, 'proj5')
    mkdirSync(join(proj5, '.zcode'), { recursive: true })
    mkdirSync(join(proj5, 'docs'), { recursive: true })
    writeFileSync(join(proj5, 'docs', 'agent-matrix.json'), JSON.stringify({ roles: {} }))
    writeFileSync(join(proj5, '.zcode', 'org-config.json'), JSON.stringify({ agent_defaults: { executor: 'ops-executor-ds-high' } }))
    // deny 面=按 --project 装载的命令（doctor/dispatch-check）；pick=技能根作用域（只读 local）
    const p5dc = spawnSync(process.execPath, [join(s5, 'scripts', 'agent-slots.mjs'), 'doctor', '--project', proj5], { encoding: 'utf8' })
    tt('负例 project_override=deny：项目覆盖件携带 agent_defaults → doctor --project deny exit 3＋点名项目覆盖件',
      p5dc.status === 3 && outOf(p5dc).includes('项目覆盖件'))

    // 正例⑥：ready 态 status 零写（bootstrap_sleep=ZERO_WRITE）
    const s6 = mkStage('ready')
    const def6 = readJson(join(s6, 'org-config.default.json'))
    for (const k of [...ORDER_SOURCE_KEYS, ...DEFAULT_ONLY_ORDER_KEYS]) delete def6[k]
    writeFileSync(join(s6, 'org-config.default.json'), JSON.stringify(def6, null, 2) + '\n')
    writeFileSync(join(s6, 'org-config.local.json'), JSON.stringify(realLocal, null, 2) + '\n')
    const before6 = hashTree(s6)
    const r6 = runAt(s6, ['status'])
    const after6 = hashTree(s6)
    tt('正例 bootstrap_sleep=ZERO_WRITE：ready 态 status 只读零写（三件树哈希不变）＋status=ready',
      r6.status === 0 && outOf(r6).includes('status=ready') && JSON.stringify(before6) === JSON.stringify(after6))

    // 正例⑦：续配只补缺不改旧值（resume_existing=UNCHANGED）
    const s7 = mkStage('resume')
    const def7 = readJson(join(s7, 'org-config.default.json'))
    for (const k of [...ORDER_SOURCE_KEYS, ...DEFAULT_ONLY_ORDER_KEYS]) delete def7[k]
    writeFileSync(join(s7, 'org-config.default.json'), JSON.stringify(def7, null, 2) + '\n')
    const partial = JSON.parse(JSON.stringify(realLocal))
    partial.agent_bindings = { 'ops-executor-glm-high': partial.agent_bindings['ops-executor-glm-high'], note: '既有值' }
    writeFileSync(join(s7, 'org-config.local.json'), JSON.stringify(partial, null, 2) + '\n')
    const r7 = runAt(s7, ['resume'])
    const l7 = readJson(join(s7, 'org-config.local.json'))
    const o7 = `${r7.stdout || ''}${r7.stderr || ''}`
    tt('正例 resume_existing=UNCHANGED（R1·W2 期望随迁）：resume 只补缺失绑定键、既有键值逐字不变＋顺序面零臆造＋未就绪=validate exit3 传播为模块非零退出',
      r7.status !== 0 && o7.includes('validate exit=3') && o7.includes('sync-agents 跳过') &&
      l7.agent_bindings['ops-executor-glm-high'] === partial.agent_bindings['ops-executor-glm-high'] &&
      Object.keys(l7.agent_bindings).length > Object.keys(partial.agent_bindings).length &&
      JSON.stringify(l7.agent_defaults) === JSON.stringify(realLocal.agent_defaults))

    // freeze 向量：dry-run 逐角色＋正式冻结（default 剥三键·local 补缺不覆盖）
    const s8 = mkStage('freeze')
    writeFileSync(join(s8, 'org-config.local.json'), JSON.stringify(realLocal))
    const d8 = runAt(s8, ['freeze', '--dry-run'])
    const f8 = runAt(s8, ['freeze'])
    const defAfter8 = readJson(join(s8, 'org-config.default.json'))
    const localAfter8 = readJson(join(s8, 'org-config.local.json'))
    const wall8 = validateOrderSourceWall({ defaultCfg: defAfter8, projectCfg: null })
    tt('freeze：dry-run 逐角色 before/after（本机=10 角色全 unchanged）＋正式冻结剥 default 三键＋local 逐字节语义不变＋迁移后来源墙绿',
      d8.status === 0 && (d8.stdout || '').includes('action=unchanged') && (d8.stdout || '').includes('before_cfg=cfg:') &&
      f8.status === 0 && !ORDER_SOURCE_KEYS.concat(DEFAULT_ONLY_ORDER_KEYS).some((k) => own(defAfter8, k)) &&
      JSON.stringify(localAfter8.agent_defaults) === JSON.stringify(realLocal.agent_defaults) &&
      JSON.stringify(localAfter8.role_fallbacks) === JSON.stringify(realLocal.role_fallbacks) && wall8.length === 0)

    // freeze 拒绝向量：local 已有键内部不一致（agent_defaults≠fallback 首元——冻结值序
    // 不可静默调和）→ reject exit 1 零写
    const s9 = mkStage('freeze-reject')
    const l9 = JSON.parse(JSON.stringify(realLocal))
    l9.agent_defaults.executor = 'ops-executor-ds-high'
    // role_fallbacks.executor 保持原序（首元=ops-executor-glm-high）→ 局部不一致
    writeFileSync(join(s9, 'org-config.local.json'), JSON.stringify(l9))
    const before9 = hashTree(s9)
    const f9 = runAt(s9, ['freeze'])
    const after9 = hashTree(s9)
    tt('freeze 拒绝：已有键与迁移前 merged 逐值不同 → exit 1＋零写（fail-closed 不覆盖）',
      f9.status === 1 && outOf(f9).includes('拒绝') && JSON.stringify(before9) === JSON.stringify(after9))

    // 汇总 token 行（V-2 契约机读面）
    console.log('local_missing=deny incomplete_order=deny default_absent=deny matrix_fallback=0 project_override=deny bootstrap_sleep=ZERO_WRITE resume_existing=UNCHANGED')
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true })
  }
  console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
  process.exit(fails === 0 ? 0 : 1)
}
