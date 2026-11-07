/**
 * 技能自包含回归（ai-dev-org——06 §5 的内化执行件；R 清单单源=本脚本 --only
 * 可选项集合，此处不复写清单——evolve-E2 b5 指针化）。
 * 2026-10-03 清理批次（用户裁决「彻底删除死代码和文档」）：派发器族回归项
 * 随旧派发器与 scripts/roles 物理删除而删（R1 语义抽样/R2 golden 自比对/
 * R5 mock 全链演练/R11 干涸窗+同族负例/R9 scrub 受控复制对账/R10③vecDs
 * 纯函数向量/R10④B1 registry 错误面向量）——详见 git 历史（dispatch-retire
 * 批前提交）。现役项：
 *   R4'=流水与账本字段完整性（流水现役写入者=look 脚本；历史派发器行按
 *       08 §3 旧版本类跳过不改写；账本=主控补记单源 02 §9）；
 *   R7'=账本 schema 指针正向校验（A3——SKILL/snippet 禁内联字段清单）；
 *   R8'=三脚本自检套件聚合（org-config/deploy-check/log-triage）；
 *   R10'=look 回归面（结构断言+splitEndpoint 向量+本地 mock 双通道往返
 *       +null 守卫——evolve 批 b1 承载）；
 *   R13'=门禁前移回归面（check-taskbook T13 词面扫描＋T14 防漏网——L22 批：①隔离自检
 *       子进程 ②strict 通过态 ③表格漏网红态 ④词表缺失装载错）；
 *   R14'=账本迁移器自检（B1 批：SKILL_ROOT spawn ledger-migrate.mjs --self-test 断言
 *       exit 0——五向量〔dry-run 逐组计数/零漂移/隔离分组计数/manifest 哈希锚篡改检出/
 *       stale candidate〕＋fixture 全程两仓零写入断言在自检内部承载）；
 *   R15'=主仓门禁自检（B1 批：spawn <project>/scripts/verify-docs.mjs --self-test 断言
 *       exit 0——缺件=FAIL 不静默跳过，回归面收缩即绊线拆除）；
 *   R12'=词表棘轮回归面（check-terms 词表装载与棘轮执法向量——W3/B3 系）；
 *   R16'=文档生成与提交短句自检（B6 批：四脚本隔离自检＋快照确定性＋terms/residuals
 *       双闸探针＋hardcode 负例＋b3 影子对照）；
 *   R17'=α/β 门禁自检（W5a 批：spawn <project>/scripts/check-commit-msg.mjs --self-test
 *       与 <project>/scripts/verify-docs.mjs --self-test——α 全过标记＋β 0/1/3/spawn
 *       失败四类具名 PASS；仅在 --project <主仓> 语境成立，缺省 cwd=技能仓必 FAIL）；
 *   R18'=resource-sampler 自检接入（W5b 批：spawn resource-sampler.mjs --self-test 断言
 *       exit 0＋汇总形态 `self-test 汇总：过 X/skip Y/全 Z` 且 X+Y=Z、total>=70——skip
 *       不计 pass 的报告保真面）。
 *   R19'=run-recover 恢复自检接入（RT1C·Task 1C——spawn run-recover.mjs --self-test 断言 exit 0＋
 *       汇总形态 fixtures=42/vectors/failed=0/skip_ids=0 与矩阵 token；裸 --self-test 依赖脚本内默认
 *       fixture 绝对路径，恢复/并发测试只在 /tmp/rt1c-executor-* 隔离目录执行）。
 * 现役项=R4/R7/R8/R10/R12/R13/R14/R15/R16/R17/R18/R19/R22 十三项（W5a 补 R12/R16/R17 头注随动；W5b 补 R18；RT1C 补 R19；RT1AGG 补 R22）。
 *   R22=run-store 自检接入（RT1AGG——spawn run-store.mjs --self-test 断言 exit 0＋汇总形态
 *       ids=52/vectors=<实数>/failed=0 与 state/crash/command 矩阵 token；裸 --self-test 默认
 *       fixtures 绝对路径与 /tmp/rt1a-executor-selftest 隔离域承载，不携带 --fixtures/--temp-root）。
 * 用法：node scripts/regression.mjs [--only R4,R7,R8,R10] [--project <账本目录>]
 *       [--ledger <账本路径>] [--keep-tmp]
 *       （flag 取值一律空格分隔，--x=y 等号形态=用法错拒收——cliFlag 单源立场）
 * 退出码口径单源=references/06 §5.8。
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync, spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { SKILL_ROOT, cliFlag, UsageError, ledgerPathFor, loadOrgConfig, resolveFlagValue, readFlagsState, readHostConfig, flagsStatePath } from './org-config.mjs'
import { MANUAL_EVENTS } from './health-scan.mjs' // 人工事件词表单源消费（v2.0.1 修复批 L14——原两处逐字复制=漏改一侧即漂移；health-scan isMain 守卫后 import 零副作用）

const SCRIPTS = join(SKILL_ROOT, 'scripts')
const LOG_PATH = join(SCRIPTS, 'model-routing-log.jsonl')
const argv = process.argv.slice(2)
const flag = (n) => cliFlag(argv, n) // 单源（org-config 导出——v1.6 批 P2-3 收敛；g3 批起三校验抛 UsageError）
// g3 批（evolve-l4-flags/P9 收敛）：--only/--project 缺值不再按 null/cwd 静默
let only = null
let projectDir = process.cwd()
try {
  const onlyArg = flag('--only')
  if (onlyArg) only = [...new Set(onlyArg.split(',').map((s) => s.trim().toUpperCase()))] // 返工 N-①：集合语义去重（R4,R4 不再假红 R-META）
  projectDir = flag('--project') || process.cwd()
} catch (e) {
  if (e instanceof UsageError) {
    console.error(`[用法错] ${e.message}`)
    process.exit(1)
  }
  throw e
}
const keepTmp = argv.includes('--keep-tmp')
const KNOWN_ITEMS = ['R4', 'R7', 'R8', 'R10', 'R12', 'R13', 'R14', 'R15', 'R16', 'R17', 'R18', 'R19', 'R22'] // --only 合法项清单（与下方各 want 块双载——删项须同步两处；派发器族项 R1/R2/R5/R11/R9 已随清理批次删除；R16=B6 文档生成批；R17=W5a α/β 门禁自检；R18=W5b sampler 接入；R19=RT1C 恢复自检接入；R22=RT1AGG run-store 自检接入）
if (only && only.some((id) => !KNOWN_ITEMS.includes(id))) {
  console.error(`[用法错] 未知回归项：${only.filter((id) => !KNOWN_ITEMS.includes(id)).join(',')}（现役项=${KNOWN_ITEMS.join('/')}——派发器族项已随 2026-10-03 清理批次删除，详见 git 历史）`)
  process.exit(1)
}
const want = (id) => !only || only.includes(id)
const results = []
const record = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${detail}`) }
const node = () => [process.execPath]

// ═══ R4'：流水与账本字段完整性 ═══
// 流水行分类（2026-10-03 清理批次后口径）：channel+dispatcher_version=look
// 现役行（按 LOOK_REQUIRED 校验）；channel 无 dispatcher_version=外来 legacy 行；
// 无 channel 有 dispatcher_version=历史派发器行（按 08 §3 旧版本类跳过——
// 历史行禁改写，旧派发器已删除不再产新行）；两者皆无=极早期 legacy 行
// （最小三字段校验）。
if (want('R4')) {
  const LOOK_REQUIRED = {
    attempt: ['ts', 'runId', 'event', 'source', 'model', 'attempt', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'],
    ok: ['ts', 'runId', 'event', 'source', 'model', 'usage', 'latencyMs', 'finish', 'finish_class', 'truncated', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'],
    fail: ['ts', 'runId', 'event', 'source', 'model', 'error', 'statusCode', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'],
  }
  // 账本 schema v2/v3（02 §9 单源——此处仅执法）：truncated 仅 ok 行有 → 列入
  // ok 必填（P0-2 截断假成功的机检前置）。
  const LEDGER_REQUIRED = ['ts', 'project', 'event', 'role', 'tier', 'source', 'cfg_hash', 'outcome']
  const LEDGER_V2 = { ok: ['schema_version', 'runId', 'truncated'], switch: ['schema_version', 'runId'], exhaust: ['schema_version', 'runId'] }
  // 主控人工补记事件（ORG-11）：人工事件恒用基字段（无 usage，非派发产出）。
  // 词表单源=health-scan MANUAL_EVENTS 导出。
  // ── R4-v2（RT0B·Task 0B）：按物理行 sha256 的有界历史例外——例外装载与校验 ──
  // 契约单源=references/02 §9 R4-v2 条款；例外文件=join(dirname(ledgerPath),
  // 'ledger-exceptions.json')（与 ledgerPathFor 三层解析同源）；文件不存在=零例外
  // （现行为不变）。全部失效面 fail-closed：不可解析/顶层非数组/条目键闭集或键序
  // 错/owner·reason·source_ref 空值/line_hash 非 64 位十六进制/重复/expiry 缺失、
  // 不可解析或已过期——任一命中即整文件无效（R4 FAIL 不静默），不采用部分条目。
  const { createHash } = await import('node:crypto') // 块内动态引（锚点稳定约束：禁新增顶层 import）
  const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex')
  const R4V2_EXC_KEYS = ['line_hash', 'owner', 'reason', 'expiry', 'source_ref']
  const R4V2_ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
  const loadLedgerExceptions = (excPath, nowMs) => {
    if (!excPath || !existsSync(excPath)) return { ok: true, absent: true, entries: [] }
    let parsed
    try { parsed = JSON.parse(readFileSync(excPath, 'utf8')) } catch { return { ok: false, failKind: 'exception_unparseable', detail: '例外文件 JSON 不可解析' } }
    if (!Array.isArray(parsed)) return { ok: false, failKind: 'exception_invalid_structure', detail: '例外文件顶层非数组' }
    const seen = new Set()
    for (const ent of parsed) {
      if (typeof ent !== 'object' || ent === null || Array.isArray(ent)) return { ok: false, failKind: 'exception_invalid_entry', detail: '条目非对象' }
      const keys = Object.keys(ent)
      if (keys.length !== R4V2_EXC_KEYS.length || keys.some((k, i) => k !== R4V2_EXC_KEYS[i])) return { ok: false, failKind: 'exception_invalid_entry', detail: '条目五键闭集或键序不符（键序错=文件无效）' }
      if (typeof ent.line_hash !== 'string' || !/^[0-9a-f]{64}$/.test(ent.line_hash)) return { ok: false, failKind: 'hash_format_error', detail: 'line_hash 非 64 位十六进制' }
      for (const k of ['owner', 'reason', 'source_ref']) if (typeof ent[k] !== 'string' || ent[k] === '') return { ok: false, failKind: 'exception_invalid_entry', detail: `${k} 缺失或空值` }
      if (typeof ent.expiry !== 'string' || !R4V2_ISO_DT.test(ent.expiry) || !Number.isFinite(Date.parse(ent.expiry))) return { ok: false, failKind: 'exception_invalid_entry', detail: 'expiry 非 ISO 8601 日期时间' }
      // 返工2 N5：严格日历日回环比对——Y/M/D 经 Date.UTC 回读等值（2027-02-29 等
      // 非法日历日 V8 解析会静默滚动为有限值，形状与 parse 双过也须拒收）
      const cY = Number(ent.expiry.slice(0, 4)), cM = Number(ent.expiry.slice(5, 7)), cD = Number(ent.expiry.slice(8, 10))
      const calDate = new Date(Date.UTC(cY, cM - 1, cD))
      if (calDate.getUTCFullYear() !== cY || calDate.getUTCMonth() !== cM - 1 || calDate.getUTCDate() !== cD) return { ok: false, failKind: 'exception_invalid_entry', detail: 'expiry 非法日历日（严格回环比对拒收——如 02-29 非闰日/02-30）' }
      if (seen.has(ent.line_hash)) return { ok: false, failKind: 'exception_invalid_entry', detail: '文件内 line_hash 重复' }
      seen.add(ent.line_hash)
      if (nowMs > Date.parse(ent.expiry)) return { ok: false, failKind: 'exception_expired', detail: '例外已过期（到期重审=强制重审信号——主控复核后重登例外并重估期限，非永久豁免）' }
    }
    return { ok: true, absent: false, entries: parsed }
  }
  const checkLines = (label, path, required, tailN, opts = {}) => {
    if (!existsSync(path)) return { pass: false, detail: `${label}:文件不存在 ${path}` }
    // R4-v2 原始字节口径（返工2 B1/W1 单源化）：单次 Buffer 读取→按 LF(0x0A) 切物理行
    // →逐物理行 utf8 解码——文本行与 hash 行同源同滤（解码后空行滤除＋尾窗切片逐位
    // 对齐），禁二次 readFileSync（消读间漂移）。BOM 仅在首物理行解码后剥离——只影响
    // 解析与空行判定（BOM-only 首行解码为空按空行滤除、不参与 hash），hash 恒用原始
    // 行字节：首行含 BOM 时 hash 含 BOM、CRLF 行保留 CR，不做任何归一。
    const r4buf = readFileSync(path)
    const r4chunks = []
    let r4cs = 0
    for (let r4ci = 0; r4ci < r4buf.length; r4ci++) { if (r4buf[r4ci] === 0x0a) { r4chunks.push(r4buf.subarray(r4cs, r4ci)); r4cs = r4ci + 1 } }
    if (r4cs < r4buf.length) r4chunks.push(r4buf.subarray(r4cs))
    const r4entries = r4chunks
      .map((c, i) => ({ raw: c, text: i === 0 ? c.toString('utf8').replace(/^\uFEFF/, '') : c.toString('utf8') }))
      .filter((en) => en.text !== '')
      .slice(-tailN)
    const ls = r4entries.map((en) => en.text)
    let bad = 0, skipped = 0, foreign = 0, unknown = 0, kinds = {}
    const causes = [] // R4-v2（RT0B）台架取证：坏行行因序列（bad_json/unknown_event/missing_<field>）——只取证不改判定
    const badRowHashes = [] // 返工2 W1/W2：坏行物理行 hash 序列（与 causes 同序——hash_mismatch 覆盖判「目标行 hash 未命中注册」）
    // R4-v2 有界例外消费：仅显式传入 opts.exceptions 的调用面（账本）激活；流水与
    // 其他调用面零影响。例外文件无效（ok=false）＝不采用任何条目（fail-closed）。
    const excOn = !!(opts.exceptions && opts.exceptions.ok && opts.exceptions.entries.length)
    const excSet = excOn ? new Set(opts.exceptions.entries.map((x) => x.line_hash)) : null
    let exempt = 0
    const seenHashes = new Set() // 尾窗全部物理行 hash（含未豁免行——供台架判「注册 hash 未命中」）
    for (let li = 0; li < ls.length; li++) {
      const l = ls[li]
      const lh = excOn ? sha256hex(r4entries[li].raw) : null
      if (lh !== null) seenHashes.add(lh)
      let e; try { e = JSON.parse(l) } catch { bad++; causes.push('bad_json'); badRowHashes.push(lh); continue }
      if (opts.skipIf && opts.skipIf(e)) { skipped++; continue }
      // look 对齐行=channel+dispatcher_version 双标记（selfiter look-schema 批）
      if (e.channel !== undefined && e.dispatcher_version !== undefined) {
        const gr = LOOK_REQUIRED[e.event]
        if (!gr) { unknown++; bad++; causes.push('unknown_event'); badRowHashes.push(lh); continue }
        for (const k of gr) if (e[k] === undefined) { bad++; break }
        kinds[e.event] = (kinds[e.event] || 0) + 1
        continue
      }
      // 他源写入行（channel 标记无 dispatcher_version）——按外来行计数不改写（08 §3）
      if (e.channel !== undefined) { foreign++; continue }
      // 历史派发器行（dispatcher_version 无 channel）——08 §3 旧版本类跳过：
      // 写入者已删除，行自身为历史事实，禁改写禁追认
      if (e.dispatcher_version !== undefined) { skipped++; continue }
      // 极早期 legacy 行：最小字段校验
      const req = typeof required === 'function' ? required(e) : required
      // R4-v2 豁免（返工 N5 计数口径）：行在尾窗内、物理行 hash 命中已生效例外、
      // event 属已知词表、且该行确有缺必填字段时，仅跳过必填字段核对并计入豁免
      // 计数——字段齐全行命中 hash 不计数不计坏（照常走字段核对）；豁免≠整行跳过：
      // JSON 解析失败与未知事件不豁免、行分类与事件分布照常；LEDGER_REQUIRED 数组
      // 与未知事件计坏规则不因例外放宽。
      if (excOn && excSet.has(lh) && !req.includes('__unknown_event__') && req.some((k) => e[k] === undefined)) {
        exempt++
        if (e.event) kinds[e.event] = (kinds[e.event] || 0) + 1
        continue
      }
      // 返工 N1：账本侧未知事件计数自增（基线既有计数缺口随批消解——原仅流水侧
      // LOOK 分支计数，账本词表外事件行 detail「含未知事件N」恒 0）；判定语义不变。
      for (const k of req) if (e[k] === undefined) { bad++; if (req.includes('__unknown_event__')) { unknown++; causes.push('unknown_event') } else causes.push('missing_' + k); badRowHashes.push(lh); break }
      if (e.event) kinds[e.event] = (kinds[e.event] || 0) + 1
    }
    const excTag = opts.exceptions ? ` 豁免${exempt}行(有界例外)` : '' // 显式豁免计数——绿不得静默
    return { pass: bad === 0, kinds, bad, exempt, causes, badRowHashes, seenHashes: [...seenHashes], detail: `${label}:尾${ls.length}行坏${bad}行（含未知事件${unknown}）跳${skipped}行(历史/旧版本)外来${foreign}行(他源channel标记)${excTag} 事件分布=${JSON.stringify(kinds)}` }
  }
  const a = checkLines('流水', LOG_PATH, ['ts', 'runId', 'event'], 100)
  // 校验域真空显式呈现（k1-W1/d1-W3 返工：原「全跳过=FAIL」守卫按清理批次申报软化
  // ——派发器删除后低频写入窗口下尾行全历史=常态非假绿；真空态如实标注，不静默）
  if (a.kinds && !Object.keys(a.kinds).length) a.detail += '；⚠校验域真空：尾行全为历史/外来行（现役 look 行零——低频写入窗口常态，非校验失效）'
  // 2026-10-03 清理批次：流水 cfg 哈希一致性子核对退役——原语义=高频派发行
  // 的「换环境按旧供应商事实硬闯」防线；派发器删除后流水仅剩低频 look
  // 写入（旧行哈希=写入时点事实，配置变更后必然滞后=假红面）。现役配置漂移
  // 观测=health-scan cfg 漂移 WARN+账本行 cfg_hash 主控补记即时值（02 §9）。
  a.detail += '；cfg哈希子核对=退役（清理批次——低频写入面假红，观测移交 health-scan）'
  const passA = a.pass
  // B1 返工 R1：账本路径接三层单源（--ledger 显式参＞merged ledger_path 相对项目根＞join 兜底——与 health-scan 同源）
  const ledgerPath = ledgerPathFor(projectDir, flag('--ledger'))
  // R1 三层断言（tmp 夹具·零写两仓）：项目覆盖件 ledger_path 生效／无覆盖件走兜底／显式参恒胜
  let layerOk = false, layerDet = ''
  try {
    const fx4 = mkdtempSync(join(tmpdir(), 'r4-lp-'))
    try {
      mkdirSync(join(fx4, '.zcode'), { recursive: true })
      writeFileSync(join(fx4, '.zcode', 'org-config.json'), JSON.stringify({ ledger_path: 'custom/ledger.jsonl' }))
      const ov = ledgerPathFor(fx4, null)
      const fb = ledgerPathFor(join(fx4, 'p2'), null)
      const ex = ledgerPathFor(fx4, join(fx4, 'explicit.jsonl'))
      layerOk = ov === join(fx4, 'custom', 'ledger.jsonl') && fb === join(fx4, 'p2', '.zcode', 'org-ledger.jsonl') && ex === join(fx4, 'explicit.jsonl')
      layerDet = `三层断言:${layerOk ? '✓(覆盖件/兜底/显式参)' : `✗(ov=${ov} fb=${fb} ex=${ex})`}`
    } finally { rmSync(fx4, { recursive: true, force: true }) }
  } catch (e) { layerDet = `三层断言:✗(${e.message})` }
  const ledgerReq = (e) => {
    if (!['ok', 'switch', 'exhaust', ...MANUAL_EVENTS].includes(e.event)) return ['__unknown_event__'] // 账本侧未知 event 计坏行（终轮 A' 返工：防新增记账事件未同步 schema 即弱校验通过）
    if (MANUAL_EVENTS.has(e.event)) return LEDGER_REQUIRED // 主控人工补记
    const base = e.event === 'ok' ? [...LEDGER_REQUIRED, 'usage'] : LEDGER_REQUIRED
    const v2 = [...base, ...(LEDGER_V2[e.event] || [])]
    // selfiter B4 分代：schema_version 3 的派发行增 project_id 必填（v2 存量行按 v2 契约——历史行禁改写，08 §3）
    return e.schema_version === 3 ? [...v2, 'project_id'] : v2
  }
  const ledgerSkipIf = (e) => {
    // 无 schema_version 且早于纪律生效时点（2026-09-16T12:00Z）的存量行=旧版本
    // 形态——跳过计数（不追认不改写，08 §3）；时点后新增行漏带不再跳过=计坏。
    // R4-v2（RT0B）：由内联字面量提为共享常量（生产面与 fixtures 台架同一单源，语义逐字不变）。
    if (e.schema_version !== undefined) return false
    const t = Date.parse(e.ts || '')
    return Number.isNaN(t) ? true : t < Date.parse('2026-09-16T12:00:00Z')
  }
  // R4-v2：例外文件路径与解析后 ledgerPath 同目录派生（与 ledgerPathFor 三层解析
  // 同源；缺省配置下=项目根 .zcode/ledger-exceptions.json）；不存在=零例外。
  const excPath = join(dirname(ledgerPath), 'ledger-exceptions.json')
  const exc = loadLedgerExceptions(excPath, Date.now())
  const b = checkLines('账本', ledgerPath, ledgerReq, 50, { skipIf: ledgerSkipIf, exceptions: exc })
  // ── R4-v2 fixtures 数据驱动消费面（RT0B·Task 0B·D-1——常驻向量，always-active）──
  // 台架逐向量断言四元组（pass/坏行数/豁免计数/fail_kind）；向量与期望单源=
  // scripts/.golden/ledger-r4-v2-fixtures.json（只读消费不改写）。每例独立 tmp
  // 目录、结束即清；零写两仓、不读生产账本与生产例外文件。fail_kind 归因优先级：
  // 例外文件侧失效＞hash_mismatch 覆盖＞行因（bad_json/unknown_event/missing_outcome）。
  // hash_mismatch 仅当=坏行首因 missing_<field>＋存在孤儿注册（登记 hash 未命中任一
  // 尾窗行）＋该坏行物理行 hash 未命中注册，三者合取；bad_json/unknown_event 不参与
  // 覆盖（行因如实）；坏行仍按行因计数。预期 PASS 向量 fail_kind=null。预期 FAIL 的
  // 夹具被台架识别为「符合预期的失败」（断言通过）。
  const R4V2_FIXTURES = join(SCRIPTS, '.golden', 'ledger-r4-v2-fixtures.json')
  let r4v2Ok = true, r4v2PassN = 0, r4v2Total = 0
  const r4v2Red = []
  if (!existsSync(R4V2_FIXTURES)) {
    r4v2Ok = false
    console.log(`FAIL R4v2-fixtures 缺件 ${R4V2_FIXTURES}（常驻向量面——缺件即绊线，不静默跳过）`)
  } else {
    const fxv = JSON.parse(readFileSync(R4V2_FIXTURES, 'utf8')).vectors
    // 返工 W2：向量集守卫——ID 全集失配（空/缩水/多余/重复）即红，防夹具静默绿。
    const R4V2_IDS = [
      'v01-hist2-missing-outcome-noexc', 'v02-new-missing-outcome-noexc', 'v03-legal-exc-covers-hist2',
      'v04a-exc-expired', 'v04b-expiry-unparseable', 'v05a-owner-empty', 'v05b-reason-missing',
      'v06a-hash-not-hex64', 'v06b-hash-mismatch', 'v07-new-ruling-recorded-noexc',
      'v08a-exc-unparseable', 'v08b-exc-not-array', 'v09a-extra-key', 'v09b-duplicate-hash', 'v09c-key-order-wrong',
      'v10a-unknown-event-registered', 'v10b-bad-json-registered',
      'v11-bom-firstline-registered', 'v12-complete-rows-invalid-exc', 'v13-hash-mixedcase',
      'v14-hash-short63', 'v15-hash-long65', 'v16-expiry-no-tz', 'v17-expiry-missing',
      'v18-sourceref-missing', 'v19-sourceref-empty', 'v20-crlf-line-registered',
      'v21-utf8-multibyte-registered', 'v22-complete-row-registered',
      'v23-bomonly-firstline-misalign', 'v24-badjson-orphan-exc', 'v25-unknown-orphan-exc',
      'v26-expiry-invalid-calendar-day',
    ]
    const gotIds = fxv.map((v) => v && v.id)
    const missIds = R4V2_IDS.filter((i) => !gotIds.includes(i))
    const extraIds = gotIds.filter((i) => !R4V2_IDS.includes(i))
    const dupIds = [...new Set(gotIds.filter((i, ix) => gotIds.indexOf(i) !== ix))]
    if (missIds.length || extraIds.length || dupIds.length) {
      r4v2Ok = false
      console.log(`FAIL R4v2-fixtures 向量集失配：缺=${missIds.join(',') || '无'} 多=${extraIds.join(',') || '无'} 重=${dupIds.join(',') || '无'}（防夹具空/缩水静默绿——期望全集=${R4V2_IDS.length}）`)
    }
    r4v2Total = fxv.length
    for (const v of fxv) {
      const d = mkdtempSync(join(tmpdir(), 'r4v2-'))
      try {
        const lg = join(d, 'org-ledger.jsonl')
        writeFileSync(lg, v.input.ledger_lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n', 'utf8')
        const ef = join(d, 'ledger-exceptions.json')
        if (v.input.exceptions !== null) writeFileSync(ef, typeof v.input.exceptions === 'string' ? v.input.exceptions : JSON.stringify(v.input.exceptions, null, 2) + '\n', 'utf8')
        // 与生产同源核对：同一装载器＋同一 checkLines 消费面（含同一 ledgerReq/ledgerSkipIf）
        const excF = loadLedgerExceptions(existsSync(ef) ? ef : null, Date.now())
        const r = checkLines('账本', lg, ledgerReq, 50, { skipIf: ledgerSkipIf, exceptions: excF })
        let fk = null
        if (!excF.ok) fk = excF.failKind
        else if (r.bad > 0) {
          // 返工2 W1/W2 归因口径（合取三条件）：坏行首因=missing_<field>，且存在孤儿
          // 注册（注册 hash 未命中任一尾窗行——例外侧确有未生效登记），且该坏行物理行
          // hash 未命中注册——三者齐备才覆盖为 hash_mismatch；bad_json/unknown_event 行
          // 不参与覆盖（行因如实）；注册已命中他行的完整行不构成孤儿（v23 探针口径）。
          const c0 = r.causes[0]
          const h0 = r.badRowHashes[0]
          const orphan = excF.entries.some((x) => !r.seenHashes.includes(x.line_hash))
          const rowUnreg = h0 != null && !excF.entries.some((x) => x.line_hash === h0)
          fk = typeof c0 === 'string' && c0.startsWith('missing_') && excF.entries.length > 0 && orphan && rowUnreg ? 'hash_mismatch' : c0
        }
        // 返工 W1/W3：台架 pass 与生产 record 同口径——含例外文件有效性
        const actual = { pass: r.pass && excF.ok, bad: r.bad, exempt: r.exempt, fail_kind: fk }
        const x = v.expected
        const ok = actual.pass === x.pass && actual.bad === x.bad && actual.exempt === x.exempt && actual.fail_kind === x.fail_kind
        if (ok) r4v2PassN++
        else { r4v2Ok = false; r4v2Red.push(v.id) }
        console.log(`${ok ? 'PASS' : 'FAIL'} R4v2/${v.id} 期(过=${x.pass},坏=${x.bad},豁=${x.exempt},kind=${x.fail_kind}) 实(过=${actual.pass},坏=${actual.bad},豁=${actual.exempt},kind=${actual.fail_kind})`)
      } finally { rmSync(d, { recursive: true, force: true }) }
    }
  }
  const excDet = exc.absent ? '例外:文件不存在=零例外(现行为)' : exc.ok ? `例外:生效${exc.entries.length}条` : `例外:无效(${exc.failKind}·${exc.detail})`
  record('R4', passA && b.pass && layerOk && exc.ok && r4v2Ok, `${a.detail}；${b.detail}；${layerDet}；${excDet}；R4v2向量:${r4v2PassN}/${r4v2Total}过${r4v2Red.length ? '，红集=' + r4v2Red.join(',') : ''}`)
}

// ═══ R7：账本 schema 指针正向校验（A3——SKILL.md/snippet 禁内联字段清单；v1.6 批 W1） ═══
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

// ═══ R10：look 回归面（evolve 批 E1 2026-09-16——R10 归属 b1，P-4 预裁决；
//         2026-10-03 清理批次：③vecDs 纯函数向量与④B1 registry 错误面向量随
//         旧派发器/registry 删除而删，详见 git 历史） ═══
//   ①结构断言：被检 look 脚本非注释行无 fetch( 调用形态+存在 node:http(s) import
//     （注释剥离口径钉死：先剥 /*…*/ 块注释再跳过 // 整行注释；行内尾注不剔——
//      代码半行仍在非注释行内受检）；
//   ③纯函数向量（splitEndpoint——look 脚本自有导出）；
//   ②本地 mock 双通道往返：起 node:http 本地 server 拟真双形（anthropic 形=/anthropic
//     /v1/messages anthropic 形、/chat/completions openai 形各一轮），
//     子进程驱动 look 脚本，env 重定向钩子 HOST_CONFIG/LOG_DIR 实名见 ② 块 spawn 实参
//     （内部测试设施，缺省行为不变）隔离宿主配置与真实流水落点——零真实外呼、
//     零真实落账；断言 stdout 正文+流水 attempt/ok 行（ok 行含 truncated 派生布尔）；
//   ⑤null 守卫（宿主 provider null 条目→降级行+跳过其余源+exit 5）。
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
  // ③ 纯函数向量（splitEndpoint——look 脚本自有；红态函数未导出→FAIL 不崩）
  const r10tmp = mkdtempSync(join(tmpdir(), 'r10-'))
  const vecUrl = (f) => pathToFileURL(join(SCRIPTS, f)).href
  const vecProbe = join(r10tmp, 'vec-probe.mjs')
  writeFileSync(vecProbe, `import * as lookMod from ${JSON.stringify(vecUrl('glm-look.mjs'))}
const { splitEndpoint } = lookMod
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
  const rVec = r10Spawn([vecProbe])
  const vecOk = rVec.status === 0 && (rVec.stdout || '').includes('R10VEC-ALL-PASS')
  if (!vecOk) ok = false
  const vecFail = (r) => `FAIL(exit=${r.status} 「${((r.stdout || '') + '\n' + (r.stderr || '')).split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 2).join('|')}」)`
  det.push(`③向量:splitEndpoint=${vecOk ? '全过' : vecFail(rVec)}`)
  // ② 本地 mock 双通道往返（b1 传输层+env 钩子就位才跑——红态跳过防触真实宿主源发现）
  if (vecOk) {
    const { createServer } = await import('node:http')
    const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const server = createServer((req, res) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        // failover 批（2026-10-13）⑧向量：/anthropic-dead 恒 401（次序在通道甄别前
        // ——该路径含 /anthropic 子串，主通道源发现会命中它）
        if (req.url.includes('/anthropic-dead')) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"mock unauthorized"}'); return }
        const antForm = req.url.includes('/anthropic') // 通道甄别=org-config endpoint_contains 同串拟真
        // selfiter 批（B5）拟真扩展：请求体带 stream:true → 应答 SSE 流（首字节早达
        // 语义拟真；收割器/同构断言经 look 脚本端到端走通）
        let streamReq = false
        try { streamReq = JSON.parse(Buffer.concat(chunks).toString('utf8')).stream === true } catch { /* 坏体走 JSON 路径 */ }
        if (streamReq) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          const sse = antForm
            ? ['event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
               'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"MOCK-ANT-OK"}}',
               'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
               'data: [DONE]']
            : ['data: {"choices":[{"delta":{"content":"MOCK-DS-OK"}}]}',
               'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
               'data: [DONE]']
          res.end(sse.join('\n\n') + '\n\n')
          return
        }
        const body = antForm
          ? { content: [{ type: 'text', text: 'MOCK-ANT-OK' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }
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
        'mock-ant': { options: { baseURL: `http://127.0.0.1:${port}/anthropic`, apiKey: 'r10-mock-key-aaaaaaaaaaaaaaaaaaaa' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
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
    // selfiter 批（look-schema）断言扩面：mock 流水行=对齐 schema（ctx 五字段
    // +attempt 序号+ok 行 finish_class/truncated）——红态=旧 logEvent 缺 ctx 字段
    const ctxOk = (e) => e.role_id === 'design-reviewer' && e.dispatcher_version !== undefined && e.org_config_hash !== undefined && e.role_version !== undefined && 'role_sig' in e
    const alignedOk = logLines.filter((e) => e.event === 'attempt').every((e) => typeof e.attempt === 'number' && ctxOk(e)) &&
      logLines.filter((e) => e.event === 'ok').every((e) => ctxOk(e) && typeof e.finish_class === 'string' && typeof e.truncated === 'boolean')
    const lookOk = (r, ch, text) => r.status === 0 && (r.stdout || '').includes(text) && chOf(ch).some((e) => e.event === 'attempt') && chOf(ch).some((e) => e.event === 'ok' && e.truncated === false) && alignedOk
    const antOk = lookOk(rg, 'glm-look', 'MOCK-ANT-OK')
    const dsOk = lookOk(rd, 'ds-look', 'MOCK-DS-OK')
    if (!antOk || !dsOk) ok = false
    const lookFail = (r) => `✗(exit=${r.status} stderr尾=${(r.stderr || '').slice(-140).replace(/\n/g, ' ')})`
    det.push(`②mock往返:ant=${antOk ? `✓(exit=${rg.status} 正文+流水attempt/ok行)` : lookFail(rg)}/ds=${dsOk ? `✓(exit=${rd.status})` : lookFail(rd)}`)
    // selfiter 批（evolve null 守卫）向量：宿主 provider null 条件→降级行
    // +跳过其余源+exit 5（env 钩子隔离零外呼；红态=旧 discoverSources 裸取 TypeError 崩溃）
    const hostCfgNull = join(r10tmp, 'host-config-null.json')
    writeFileSync(hostCfgNull, JSON.stringify({ provider: { dead: null, 'mock-ant': { options: { baseURL: `http://127.0.0.1:${port}/anthropic`, apiKey: 'r10-null-key-cccccccccccccccc' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } } } }), 'utf8')
    const rNull5 = r10Spawn([join(SCRIPTS, 'glm-look.mjs'), '--list-sources'], { env: { ...process.env, GLM_LOOK_HOST_CONFIG: hostCfgNull } })
    const nullOk = rNull5.status === 5 && (rNull5.stderr || '').includes('[degraded]') && (rNull5.stdout || '').includes('mock-ant')
    if (!nullOk) ok = false
    det.push(`⑤null守卫(mock发现面):${nullOk ? `✓(exit=5 降级行+其余源续列)` : `✗(exit=${rNull5.status} stderr尾=${(rNull5.stderr || '').slice(-120).replace(/\n/g, ' ')})`}`)
    // vmware 迁移批（2026-10-13）向量：宿主真源路径（env 钩子缺席）readHostConfig 双注册表
    // 容错——⑥双件全缺=降级行+exit 5（红态=旧 legacy 直读 ENOENT 栈崩）；⑦v2-only 真源
    // 发现=新机纯装形态（mergeHostRegistries 物化 providerRules 后通道命中；代码审查（岗）双审
    // W1/W-1 测试盲区处置——HOME 重定向隔离，零外呼）
    const envNoHook = { ...process.env }
    delete envNoHook.GLM_LOOK_HOST_CONFIG
    const emptyHome = join(r10tmp, 'home-empty')
    mkdirSync(join(emptyHome, '.zcode', 'v2'), { recursive: true }) // 目录在而双件缺=纯装空形态
    const rDeg5 = r10Spawn([join(SCRIPTS, 'glm-look.mjs'), '--list-sources'], { env: { ...envNoHook, HOME: emptyHome, GLM_LOOK_LOG_DIR: logDir } })
    const degOk = rDeg5.status === 5 && (rDeg5.stderr || '').includes('[degraded] 宿主注册表读取失败')
    if (!degOk) ok = false
    det.push(`⑥双件全缺降级:${degOk ? `✓(exit=5 降级行)` : `✗(exit=${rDeg5.status} stderr尾=${(rDeg5.stderr || '').slice(-120).replace(/\n/g, ' ')})`}`)
    const v2Home = join(r10tmp, 'home-v2only')
    mkdirSync(join(v2Home, '.zcode', 'v2'), { recursive: true })
    writeFileSync(join(v2Home, '.zcode', 'v2', 'provider_config.json'), JSON.stringify({ config: { providerConfigRules: { providerRules: [
      { providerId: 'mock-v2-ds', providerName: 'mock-v2-ds', config: { api: { baseUrl: `http://127.0.0.1:${port}/deepseek` }, access: { apiKey: 'r10-v2-key-dddddddddddddddd' }, personalModelIds: ['deepseek-flash'] } },
    ] } } }), 'utf8')
    const rV2 = r10Spawn([join(SCRIPTS, 'glm-look.mjs'), '--list-sources'], { env: { ...envNoHook, HOME: v2Home, GLM_LOOK_LOG_DIR: logDir } })
    const v2Ok = rV2.status === 0 && (rV2.stdout || '').includes('mock-v2-ds') && (rV2.stdout || '').includes('deepseek-flash')
    if (!v2Ok) ok = false
    det.push(`⑦v2-only真源发现:${v2Ok ? `✓(exit=0 ds 通道命中 v2 物化源)` : `✗(exit=${rV2.status} stdout尾=${(rV2.stdout || '').slice(-120).replace(/\n/g, ' ')})`}`)
    // failover 批（2026-10-13）⑧向量：主通道双源——首源（pid 字典序 mock-ant-dead 排前）
    // 恒 401、次源正常。期望=exit 0+正文 MOCK-ANT-OK+流水 fail(mock-ant-dead,401)+
    // ok(mock-ant-live)。红态=旧码 sources[0] 立断 exit 1 无切换承载源。
    const hostCfgFailover = join(r10tmp, 'host-config-failover.json')
    writeFileSync(hostCfgFailover, JSON.stringify({
      provider: {
        'mock-ant-dead': { options: { baseURL: `http://127.0.0.1:${port}/anthropic-dead`, apiKey: 'r10-fo-key-eeeeeeeeeeeeeeeeee' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
        'mock-ant-live': { options: { baseURL: `http://127.0.0.1:${port}/anthropic`, apiKey: 'r10-fo-key-ffffffffffffff' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
      },
    }), 'utf8')
    const rFo = await r10SpawnAsync([join(SCRIPTS, 'glm-look.mjs'), '--prompt', promptFile, imgFile, '--channel', 'glm', '-o', join(r10tmp, 'fo-report.md')], { env: { ...process.env, GLM_LOOK_HOST_CONFIG: hostCfgFailover, GLM_LOOK_LOG_DIR: logDir } })
    const foLogLines = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []
    const foOk = rFo.status === 0 && (rFo.stdout || '').includes('MOCK-ANT-OK') &&
      foLogLines.some((e) => e.event === 'fail' && e.source === 'mock-ant-dead' && e.statusCode === 401) &&
      foLogLines.some((e) => e.event === 'ok' && e.source === 'mock-ant-live')
    if (!foOk) ok = false
    det.push(`⑧源级切换承载源:${foOk ? `✓(exit=0 首源401→次源出活+流水双行)` : `✗(exit=${rFo.status} stderr尾=${(rFo.stderr || '').slice(-120).replace(/\n/g, ' ')})`}`)
    // failover 批返工轮1（k1-W3/d1-W1 处置）：⑨全灭序列=双死源→exit 1+汇总行含
    // 全部 pid（序=偏好序）；⑩首源成活不触次源=活源 pid 排前（字典序 mock-ant-a<
    // mock-ant-z）→exit 0+ok 归 a+流水零行涉 z。红态=⑨循环尾汇总缺失或 exit≠1/
    // ⑩成活后误触次源。
    const hostCfgAllDead = join(r10tmp, 'host-config-alldead.json')
    writeFileSync(hostCfgAllDead, JSON.stringify({
      provider: {
        'mock-ant-dead1': { options: { baseURL: `http://127.0.0.1:${port}/anthropic-dead`, apiKey: 'r10-ad-key-1111111111111111' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
        'mock-ant-dead2': { options: { baseURL: `http://127.0.0.1:${port}/anthropic-dead`, apiKey: 'r10-ad-key-2222222222222222' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
      },
    }), 'utf8')
    const rAd = await r10SpawnAsync([join(SCRIPTS, 'glm-look.mjs'), '--prompt', promptFile, imgFile, '--channel', 'glm'], { env: { ...process.env, GLM_LOOK_HOST_CONFIG: hostCfgAllDead, GLM_LOOK_LOG_DIR: logDir } })
    const adLog = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []
    const adOk = rAd.status === 1 &&
      (rAd.stderr || '').includes('2 个源全穷尽（mock-ant-dead1 → mock-ant-dead2）') &&
      adLog.filter((e) => e.event === 'fail' && (e.source === 'mock-ant-dead1' || e.source === 'mock-ant-dead2')).length === 2
    if (!adOk) ok = false
    det.push(`⑨全源穷尽:${adOk ? `✓(exit=1 汇总行+双 fail 行)` : `✗(exit=${rAd.status} stderr尾=${(rAd.stderr || '').slice(-120).replace(/\n/g, ' ')})`}`)
    const hostCfgLiveFirst = join(r10tmp, 'host-config-livefirst.json')
    writeFileSync(hostCfgLiveFirst, JSON.stringify({
      provider: {
        'mock-ant-a': { options: { baseURL: `http://127.0.0.1:${port}/anthropic`, apiKey: 'r10-lf-key-3333333333333333' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
        'mock-ant-z': { options: { baseURL: `http://127.0.0.1:${port}/anthropic-dead`, apiKey: 'r10-lf-key-4444444444444444' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
      },
    }), 'utf8')
    const rLf = await r10SpawnAsync([join(SCRIPTS, 'glm-look.mjs'), '--prompt', promptFile, imgFile, '--channel', 'glm'], { env: { ...process.env, GLM_LOOK_HOST_CONFIG: hostCfgLiveFirst, GLM_LOOK_LOG_DIR: logDir } })
    const lfLog = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []
    const lfOk = rLf.status === 0 && (rLf.stdout || '').includes('MOCK-ANT-OK') &&
      lfLog.some((e) => e.event === 'ok' && e.source === 'mock-ant-a') &&
      !lfLog.some((e) => e.source === 'mock-ant-z')
    if (!lfOk) ok = false
    det.push(`⑩首源成活不触次源:${lfOk ? `✓(exit=0 ok 归首源+次源零流水行)` : `✗(exit=${rLf.status} stderr尾=${(rLf.stderr || '').slice(-120).replace(/\n/g, ' ')})`}`)
    server.close()
  } else {
    ok = false
    det.push('②mock往返:跳过（splitEndpoint 未导出=b1 传输层未落，env 钩子未就位——跑则触真实宿主源发现）')
  }
  if (!keepTmp) rmSync(r10tmp, { recursive: true, force: true })
  record('R10', ok, `look 回归面——${det.join('；')}`)
}

// ═══ 词表执法器棘轮面（Y1 批建面；B3 批改＝①27 向量自检＋①-④子进程统一显式 off 态隔离（ORG_FLAGS_STATE 指向本块临时目录状态件，外部生产 on/off 不得渗入——B3 任务书 D-13）＋负例词运行时合成（D-9：扫描面零字面命中））；夹具全落 os.tmpdir() finally 清理，不写技能仓、不依赖账本 ═══
if (want('R12')) {
  let ok = true; const det = []
  const termsCmd = join(SCRIPTS, 'check-terms.mjs') // 本块脚本字串唯一承载点（多处引用经变量，防复写计数）
  const fx = mkdtempSync(join(tmpdir(), 'r12-'))
  try {
    const r12State = join(fx, 'flags-off.json')
    writeFileSync(r12State, JSON.stringify({ b2_terms_v2: false }), 'utf8') // ①-④ 统一 off 态隔离（内容仅 b2_terms_v2=false）
    const r12Run = (args) => spawnSync(node()[0], args, { encoding: 'utf8', cwd: SKILL_ROOT, timeout: 60_000, killSignal: 'SIGKILL', env: { ...process.env, ORG_FLAGS_STATE: r12State } })
    const T_KAO = '\u70e4\u9a8c' // 负例词运行时合成（D-9：断言仍按原词运行时比较）
    const T_HUI = '\u56de\u7089' // 同上（第二负例词）
    const rSt = r12Run([termsCmd, '--self-test'])
    const stOk = rSt.status === 0 && (rSt.stdout || '').trimEnd().split('\n').pop().includes('32 向量')
    if (!stOk) ok = false
    det.push(`①self-test 32向量(off 隔离):${stOk ? '✓' : `✗(exit=${rSt.status} 尾=${((rSt.stdout || '') + (rSt.stderr || '')).slice(-100).replace(/\n/g, ' ')})`}`)
    mkdirSync(join(fx, 'scripts', '.golden'), { recursive: true })
    const baseFile = join(fx, 'scripts', '.golden', 'terms-baseline.json')
    writeFileSync(baseFile, JSON.stringify({ schemaVersion: 1, files: { 'SKILL.md': { [T_KAO]: 1 } } }), 'utf8') // 基线 1 组 1 次
    const surf = join(fx, 'SKILL.md'); writeFileSync(surf, T_KAO + '现场\n', 'utf8') // 面文件恰含该 1 次命中
    const rPass = r12Run([termsCmd, '--root', fx])
    const passOk = rPass.status === 0
    if (!passOk) ok = false
    det.push(`②棘轮通过(off):${passOk ? '✓' : `✗(exit=${rPass.status})`}`)
    writeFileSync(surf, T_KAO + '现场\n' + T_HUI + '现场\n', 'utf8') // 基线外新词命中（基线不变）
    const rNew = r12Run([termsCmd, '--root', fx])
    const newOk = rNew.status !== 0 && (rNew.stdout || '').includes('新增 ×1')
    if (!newOk) ok = false
    det.push(`③新增红(off):${newOk ? '✓(非0+汇总 新增 ×1)' : `✗(exit=${rNew.status})`}`)
    const before = readFileSync(baseFile, 'utf8')
    const rUpd = r12Run([termsCmd, '--root', fx, '--update']) // off 态 --update（拒用形态——防写回丢 historical 分区）
    const after = readFileSync(baseFile, 'utf8')
    const updOk = rUpd.status === 1 && before === after
    if (!updOk) ok = false
    det.push(`④防洗白(off 拒用):${updOk ? '✓(拒冻+基线件未改写)' : `✗(exit=${rUpd.status}/改写=${before !== after})`}`)
  } finally { rmSync(fx, { recursive: true, force: true }) }
  record('R12', ok, `词表棘轮——${det.join(' ')}`)
}

// ═══ L22 R13：门禁前移回归面（check-taskbook T13 词面扫描＋T14 防漏网——四向量；样式照 R12）：
//     脚本路径变量单点、统一 spawnSync 60s 超时 SIGKILL、tmp 夹具 finally 清理、四项 detail 一次
//     record；不依赖账本、不写 golden、不改真实任务书、不调外部服务。四子项 PASS 判据（L22 §5.4）：
//     ①自检子进程 status 0 且 pass=114/fail=0、T13-04 在场且过、词表提取计数 22（不得只凭 stdout「全过」）；
//     ②通过态 strict 扫描 status 0 且 WARN=0/FAIL=0、T13/T14 finding 均 0、F/T12 证据链有效；
//     ③漏检红态 strict status 1 且至少一条 check=T14 且 level=WARN（不得用无关 finding 凑红）；
//     ④词表缺失态 status 3 且 stderr 含 [装载错]（无合成词表回退或 status 0）。 ═══
if (want('R13')) {
  let ok = true; const det = []
  const tbScript = join(SCRIPTS, 'check-taskbook.mjs') // 本块脚本字串唯一承载点（R12 同款）
  // 统一子进程运行器（60s 超时 SIGKILL——与 R10/R12 同款看护；cwd=技能仓根）
  const r13Run = (args) => spawnSync(node()[0], args, { encoding: 'utf8', cwd: SKILL_ROOT, timeout: 60_000, killSignal: 'SIGKILL' })
  // 主夹具（①-③共用；finally 清理，--keep-tmp 不适用本块——与 R12 同款直接清理）
  const fx = mkdtempSync(join(tmpdir(), 'r13-'))
  try {
    // ①自检子进程（隔离态）：status 0、pass=114/fail=0、T13-04 在场且过、词表提取计数 22
    // （计数经 T13-04 向量名内 BANNED=22 断言承载——隔离态夹具=22 合成 token，见该向量）
    const rSt = r13Run([tbScript, '--self-test', '--json'])
    // --json 输出逐向量断言（不得只凭 stdout「全过」字样判定）
    let st = null
    try { st = JSON.parse(rSt.stdout || '') } catch { st = null }
    const v1304 = (st?.cases || []).find((c) => String(c.name).includes('T13-04'))
    const stOk = rSt.status === 0 && st?.pass === 114 && st?.fail === 0 && v1304?.ok === true && String(v1304?.name || '').includes('BANNED=22')
    if (!stOk) ok = false
    det.push(`①自检子进程:${stOk ? '✓(exit=0/pass=114/fail=0/T13-04 过且装载计数 22)' : `✗(exit=${rSt.status} pass=${st?.pass} fail=${st?.fail})`}`)
    // ②通过态：tmp 写 22 词源夹具（tk01..tk22 形态）＋最小合法任务书＋一条五字段 F 及匹配证据
    // （期望：strict 扫描 status 0、WARN=0/FAIL=0、T13/T14 finding 均 0——零误报钉）
    mkdirSync(join(fx, 'scripts'), { recursive: true })
    const tokens = Array.from({ length: 22 }, (_, i) => 'tk' + String(i + 1).padStart(2, '0'))
    writeFileSync(join(fx, 'scripts', 'verify-docs.mjs'), 'const BANNED = [\n' + tokens.map((t) => "  '" + t + "',").join('\n') + '\n]\n', 'utf8')
    const evFile = join(fx, 'ev.json')
    writeFileSync(evFile, JSON.stringify({ schema: 'taskbook-evidence/v1', entries: [{ id: 'F-01', exit: 0, stdout: '0\n', declared: '0', date: '2026-10-25' }] }), 'utf8')
    // 最小合法任务书构造器：白名单段＋验收命令段（过 T0）＋factLine 参数位（②五字段 F／③表格行）
    const mkTb = (factLine) => ['# R13 夹具', '', '## 2. 白名单', '', '| `scripts/verify-docs.mjs` | 词表源 |', '', '## 4. 验收命令', '', '```bash', 'echo 0', 'echo "exit=$?"', '```', '', factLine, ''].join('\n')
    const tbFile = join(fx, 'tb.md')
    writeFileSync(tbFile, mkTb('F-01 ｜ 通过态 ｜ `echo 0` ｜ 0 ｜ 2026-10-25'), 'utf8')
    const rPass = r13Run([tbScript, tbFile, '--root', fx, '--evidence', evFile, '--strict', '--json'])
    let jPass = null
    try { jPass = JSON.parse(rPass.stdout || '') } catch { jPass = null }
    const fs13 = jPass?.findings || []
    const passOk = rPass.status === 0 && jPass?.summary?.warn === 0 && jPass?.summary?.fail === 0 && !fs13.some((f) => f.check === 'T13' || f.check === 'T14')
    if (!passOk) ok = false
    det.push(`②通过态:${passOk ? '✓(strict exit=0/WARN=0/FAIL=0/T13·T14 零 finding/F·T12 证据链有效)' : `✗(exit=${rPass.status} findings=${JSON.stringify(fs13).slice(0, 120)})`}`)
    // ③漏检红态：合法 F 改 ASCII 表格 F 行（其余不变）→ 至少一条 T14 WARN 且 strict 退 1
    // （表格形态对解析器不可见=T14 目标漏网形态；修复方式=恢复全角五字段，非收编表格）
    writeFileSync(tbFile, mkTb('| F-01 | 通过态 | `echo 0` | 0 | 2026-10-25 |'), 'utf8')
    const rRed = r13Run([tbScript, tbFile, '--root', fx, '--evidence', evFile, '--strict', '--json'])
    let jRed = null
    try { jRed = JSON.parse(rRed.stdout || '') } catch { jRed = null }
    const redOk = rRed.status === 1 && (jRed?.findings || []).some((f) => f.check === 'T14' && f.level === 'WARN')
    if (!redOk) ok = false
    det.push(`③漏检红:${redOk ? '✓(strict exit=1/finding=T14 WARN)' : `✗(exit=${rRed.status} findings=${JSON.stringify(jRed?.findings || []).slice(0, 120)})`}`)
  } finally { rmSync(fx, { recursive: true, force: true }) }
  // ④词表缺失态：用不含词表源件的独立 root 扫合法任务书 → [装载错] 显式退 3（独立 tmp，不写技能仓）
  const fx2 = mkdtempSync(join(tmpdir(), 'r13-miss-'))
  try {
    const tb2 = join(fx2, 'tb.md')
    writeFileSync(tb2, '# 缺源夹具\n\n## 2. 白名单\n\n普通正文\n\n## 4. 验收命令\n\n```bash\necho "exit=$?"\n```\n', 'utf8')
    // 期望：status 3＋stderr 含 [装载错]（06 §5.8 行 3 词表缺失类；无部分扫描、无合成词表回退）
    const rMiss = r13Run([tbScript, tb2, '--root', fx2])
    const missOk = rMiss.status === 3 && (rMiss.stderr || '').includes('[装载错]')
    if (!missOk) ok = false
    det.push(`④词表缺失:${missOk ? '✓(exit=3/[装载错]/无合成词表回退)' : `✗(exit=${rMiss.status} stderr尾=${(rMiss.stderr || '').slice(-100)})`}`)
  } finally { rmSync(fx2, { recursive: true, force: true }) }
  // 四项 detail 一次 record（R12 同款）
  record('R13', ok, `门禁前移——${det.join(' ')}`)
}

// ═══ B1 R14：账本迁移器自检（spawn SKILL_ROOT ledger-migrate.mjs --self-test 断言 exit 0；
//     五向量＋fixture 两仓零写入断言由自检内部承载——本项只锚真退出码，不复制向量语义） ═══
if (want('R14')) {
  const migScript = join(SCRIPTS, 'ledger-migrate.mjs') // 本块脚本字串唯一承载点（R12/R13 同款）
  const r14Run = (args) => spawnSync(node()[0], args, { encoding: 'utf8', cwd: SKILL_ROOT, timeout: 120_000, killSignal: 'SIGKILL' })
  const r = r14Run([migScript, '--self-test'])
  const out = (r.stdout || '') + (r.stderr || '')
  const ok14 = r.status === 0 && out.includes('self-test 全过')
  record('R14', ok14, `迁移器自检:exit=${r.status}/全过=${out.includes('self-test 全过')}${!ok14 ? `（输出尾：${out.slice(-160)}）` : ''}`)
}

// ═══ B1 R15：主仓门禁自检（spawn <project>/scripts/verify-docs.mjs --self-test 断言 exit 0；
//     缺件=FAIL 不静默跳过——回归面收缩即绊线拆除；--project 缺省 cwd） ═══
if (want('R15')) {
  const vdScript = join(projectDir, 'scripts', 'verify-docs.mjs')
  if (!existsSync(vdScript)) {
    record('R15', false, `verify-docs 缺件 ${vdScript}（缺件=FAIL 不静默跳过——绊线在位）`)
  } else {
    const r = spawnSync(node()[0], [vdScript, '--self-test'], { encoding: 'utf8', cwd: projectDir, timeout: 120_000, killSignal: 'SIGKILL' })
    const out = (r.stdout || '') + (r.stderr || '')
    const ok15 = r.status === 0 && out.includes('self-test 全过')
    record('R15', ok15, `verify-docs 自检:exit=${r.status}/全过=${out.includes('self-test 全过')}${!ok15 ? `（输出尾：${out.slice(-160)}）` : ''}`)
  }
}

// ═══ B6 R16：文档生成与提交短句自检（flag=b3_docgen_v1——off 只跑隔离自检不读现役
//     RESIDUALS；on 追加现役 RESIDUALS --check 影子对照；生成器 CLI 纪律不随 flag 改变；
//     夹具全在 /tmp 且 finally 清理；子进程 60 秒超时；stdout 只记计数/类别不泄动态模型名）═══
if (want('R16')) {
  let ok16 = true
  const det16 = []
  const fx16 = mkdtempSync(join(tmpdir(), 'r16-docgen-'))
  try {
    const r16Run = (args, opts = {}) => spawnSync(node()[0], args, { encoding: 'utf8', cwd: SKILL_ROOT, timeout: 60_000, killSignal: 'SIGKILL', ...opts })
    // ① 四脚本隔离自检（--self-test 子进程真退出码＋确定性/乱序具体 PASS 行断言——W-4/N-03：
    //    断言以 PASS 起始的具体行承载，非松散字符串正则）
    const stOk = [], stMark = []
    for (const s of ['gen-handoff', 'gen-close-summary', 'gen-commit-summary', 'residuals-check']) {
      const r = r16Run([join(SCRIPTS, `${s}.mjs`), '--self-test'])
      const out = (r.stdout || '') + (r.stderr || '')
      const passLines = out.split('\n').filter((l) => l.startsWith('PASS '))
      const pass = r.status === 0
      const dbl = passLines.some((l) => l.includes('逐字节一致'))
      const shuf = passLines.some((l) => l.includes('乱序一致'))
      if (!pass || !dbl || !shuf) ok16 = false
      stOk.push(`${s}:${pass ? 'exit=0' : `exit=${r.status}`}`)
      stMark.push(`${s}${dbl ? '双生成✓' : '双生成✗'}${shuf ? '乱序✓' : '乱序✗'}`)
    }
    det16.push(`①四脚本自检 ${stOk.join('/')}（${stMark.join(' ')}）`)
    // ② 快照两次生成＋输入乱序对照（独立于自检的第一手 CLI 对照：commit 生成器对同一
    //    合成账本两次运行 stdout 逐字节相同；生成器读取固定快照内的合成夹具）
    const fixtureDoc = JSON.parse(readFileSync(join(SCRIPTS, '.golden', 'docgen-fixtures.json'), 'utf8'))
    const proj16 = join(fx16, 'proj')
    mkdirSync(join(proj16, '.zcode'), { recursive: true })
    for (const [rel, content] of Object.entries(fixtureDoc.sources)) {
      const p = join(proj16, rel)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, content, 'utf8')
    }
    writeFileSync(join(proj16, '.zcode', 'org-ledger.jsonl'), fixtureDoc.ledger_lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
    const cArgs = [join(SCRIPTS, 'gen-commit-summary.mjs'), '--project', proj16, '--ledger', join(proj16, '.zcode', 'org-ledger.jsonl'), '--runid', 'fx-dispatch-2099', '--batch-pointer', 'docs/tasks/fx-task.md', '--type', 'feat', '--scope', 'FX', '--subject', '合成提交短句']
    const c1 = r16Run(cArgs), c2 = r16Run(cArgs)
    const detOk = c1.status === 0 && c2.status === 0 && (c1.stdout || '') === (c2.stdout || '') && (c1.stdout || '') === fixtureDoc.expected.commit3
    if (!detOk) ok16 = false
    det16.push(`②快照两次生成逐字节一致${detOk ? '✓（乱序一致性由①self-test 标记承载）' : '✗'}`)
    // ③ D-6 扫描正负探针：运行时合成禁用词（源码零字面——转义序列拼接）
    const SYNTH = '\u6218\u5f79'
    const mkRoot = (name, files, overlay) => {
      const d = join(fx16, name)
      mkdirSync(join(d, '.zcode'), { recursive: true })
      writeFileSync(join(d, '.zcode', 'org-config.json'), JSON.stringify({ terms_scan: { baseline: 'scripts/.golden/terms-baseline.json', suffix_lexer: { '.md': 'markdown', '.json': 'json' }, exclude: [], active: overlay, historical: [{ root: 'skill', include: ['h.md'] }] } }), 'utf8')
      for (const [rel, content] of Object.entries(files)) writeFileSync(join(d, rel), content, 'utf8')
      return d
    }
    const stOn = join(fx16, 'on.json')
    writeFileSync(stOn, '{"b2_terms_v2":true}', 'utf8')
    const envOn = { ...process.env, ORG_FLAGS_STATE: stOn }
    // 未围栏 JSON 字符串值 → check-terms active 判红
    const dRaw = mkRoot('terms-raw', { 'fx.json': `{"note":"合成探针含${SYNTH}字样"}\n` }, [{ root: 'skill', include: ['fx.json'] }])
    const rRaw = r16Run([join(SCRIPTS, 'check-terms.mjs'), '--strict', '--surface', 'active', '--root', dRaw], { env: envOn })
    const rawOk = rRaw.status !== 0 && rRaw.status !== 3
    if (!rawOk) ok16 = false
    // 同一内容被 Markdown 围栏包住 → check-terms 跳过（退出 0——单闸不闭合的实证）
    const dFence = mkRoot('terms-fence', { 'fx.md': `\`\`\`text\n合成围栏探针含${SYNTH}字样\n\`\`\`\n` }, [{ root: 'skill', include: ['fx.md'] }])
    const rFence = r16Run([join(SCRIPTS, 'check-terms.mjs'), '--strict', '--surface', 'active', '--root', dFence], { env: envOn })
    const fenceOk = rFence.status === 0
    if (!fenceOk) ok16 = false
    // 围栏进 RESIDUALS 权威段 → residuals-check 非零拒绝（双闸缺一不可的第二闸）——
    // W-4：判红只认 status===1（排除 3=装载错假阳性）且输出须含围栏类判红原因
    const fxRes = join(fx16, 'residuals-fenced.md')
    writeFileSync(fxRes, String(fixtureDoc.residuals_canonical).replace('<!-- residuals-json: begin -->\n{', '<!-- residuals-json: begin -->\n```\n{'), 'utf8')
    const rRes = r16Run([join(SCRIPTS, 'residuals-check.mjs'), '--file', fxRes, '--check'])
    const resOut = (rRes.stdout || '') + (rRes.stderr || '')
    const resOk = rRes.status === 1 && resOut.includes('围栏')
    if (!resOk) ok16 = false
    // B-1 整段外围栏形态：含运行时禁用词的合法 canonical RESIDUALS 夹具——
    // 未围栏（check-terms 判红＋residuals-check 通过的快照对照）vs 整段外围栏
    // （check-terms 跳过＋residuals-check 明确因围栏判红）
    const K8 = ['created_at', 'description', 'evidence', 'id', 'owner', 'phenomenon', 'status', 'trigger']
    const canonRes = (res) => JSON.stringify({ residuals: [...res].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)).map((e) => Object.fromEntries(K8.map((k) => [k, e[k]]))), schema: 'residuals/v1' }, null, 2)
    const withWord = (() => {
      const src = String(fixtureDoc.residuals_canonical)
      const ls = src.split('\n')
      const bi = ls.indexOf('<!-- residuals-json: begin -->'), ei = ls.indexOf('<!-- residuals-json: end -->')
      const doc = JSON.parse(ls.slice(bi + 1, ei).join('\n'))
      doc.residuals.push({ created_at: '2099-01-01', description: `含${SYNTH}的合成未来现象`, evidence: ['合成证据'], id: 'fx-probe', owner: '合成责任人', phenomenon: `含${SYNTH}的合成未来现象`, status: 'closed', trigger: '合成未来触发' })
      const seg = canonRes(doc.residuals).split('\n')
      ls.splice(bi + 1, ei - bi - 1, ...seg)
      return ls.join('\n')
    })()
    const dSegRaw = mkRoot('terms-seg-raw', { 'fx-res.md': withWord + '\n' }, [{ root: 'skill', include: ['fx-res.md'] }])
    const rSegRaw = r16Run([join(SCRIPTS, 'check-terms.mjs'), '--strict', '--surface', 'active', '--root', dSegRaw], { env: envOn })
    const rSegRes = r16Run([join(SCRIPTS, 'residuals-check.mjs'), '--file', join(dSegRaw, 'fx-res.md'), '--check'])
    const segRawOk = rSegRaw.status === 1 && rSegRes.status === 0
    const withWordFenced = withWord.replace('<!-- residuals-json: begin -->', '```\n<!-- residuals-json: begin -->').replace('<!-- residuals-json: end -->', '<!-- residuals-json: end -->\n```')
    const dSegFence = mkRoot('terms-seg-fence', { 'fx-res.md': withWordFenced + '\n' }, [{ root: 'skill', include: ['fx-res.md'] }])
    const rSegFence = r16Run([join(SCRIPTS, 'check-terms.mjs'), '--strict', '--surface', 'active', '--root', dSegFence], { env: envOn })
    const rSegFenceRes = r16Run([join(SCRIPTS, 'residuals-check.mjs'), '--file', join(dSegFence, 'fx-res.md'), '--check'])
    const segFenceOut = (rSegFenceRes.stdout || '') + (rSegFenceRes.stderr || '')
    const segFenceOk = rSegFence.status === 0 && rSegFenceRes.status === 1 && segFenceOut.includes('围栏')
    if (!segRawOk || !segFenceOk) ok16 = false
    det16.push(`③terms 探针 未围栏红=${rawOk ? '✓' : `✗(exit=${rRaw.status})`} 围栏跳过=${fenceOk ? '✓(exit=0 单闸不闭合)' : `✗(exit=${rFence.status})`} residuals 拦围栏=${resOk ? '✓(exit=1 围栏原因)' : `✗(exit=${rRes.status})`} 整段围栏对照=${segRawOk && segFenceOk ? '✓(未围栏:terms红/residuals过；整段围栏:terms跳过/residuals围栏红)' : `✗(raw:${rSegRaw.status}/${rSegRes.status} fence:${rSegFence.status}/${rSegFenceRes.status})`}`)
    // ④ 代号污染负例：宿主注册表动态取一模型名写入临时生成物 → check-hardcode --strict 非零
    let modelName = null
    try {
      const hostCfg = readHostConfig()
      outer: for (const p of Object.values(hostCfg.provider || {})) {
        for (const mk of Object.keys(p.models || {})) { modelName = mk; break outer }
      }
    } catch { modelName = null }
    let polOk = false, polNote = '宿主注册表不可读'
    if (modelName) {
      const dPol = join(fx16, 'hardcode-probe')
      mkdirSync(dPol, { recursive: true })
      writeFileSync(join(dPol, 'gen-out.md'), `合成生成物提及实配模型 ${modelName}（污染负例探针）\n`, 'utf8')
      const rPol = r16Run([join(SCRIPTS, 'check-hardcode.mjs'), '--root', dPol, '--strict'])
      polOk = rPol.status !== 0 && rPol.status !== 3
      polNote = polOk ? `RED(命中类别=实配模型名,exit=${rPol.status})` : `未红(exit=${rPol.status})`
    }
    if (!polOk) ok16 = false
    det16.push(`④hardcode 探针=${polNote}`)
    // ⑤ b3_docgen_v1：off=production_check=skipped；on=追加现役 RESIDUALS --check 影子对照；
    //    W-4：装载异常不静默降 off——stderr 告警＋判失败（production_check=load_error）；
    //    N-6（返工轮 2）：状态件形状损坏（数组/null/标量）fail-closed 判失败（check-terms 先例同律）
    let b3On = false
    let b3LoadErr = null
    let stateObj = null
    try {
      const stPath = flagsStatePath()
      if (existsSync(stPath)) {
        const rawSt = JSON.parse(readFileSync(stPath, 'utf8').replace(/^\uFEFF/, ''))
        if (rawSt === null || typeof rawSt !== 'object' || Array.isArray(rawSt)) stateObj = 'bad-shape'
        else stateObj = rawSt
      } else stateObj = {}
      b3On = resolveFlagValue(loadOrgConfig(projectDir).merged, 'b3_docgen_v1', stateObj === 'bad-shape' ? {} : stateObj) === true
    } catch (e) { b3LoadErr = e.message }
    let prodNote = 'skipped'
    if (b3LoadErr !== null) {
      console.error(`[warn] b3_docgen_v1 装载异常（${b3LoadErr}）——R16 按失败处置不静默降 off（W-4）`)
      prodNote = 'load_error'
      ok16 = false
    } else if (stateObj === 'bad-shape') {
      console.error(`[warn] flag 状态件形状非法（须普通对象——${flagsStatePath()}）——fail-closed 判失败不静默 skipped（N-6·check-terms 先例同律）`)
      prodNote = 'state_broken'
      ok16 = false
    } else if (b3On) {
      const rProd = r16Run([join(SCRIPTS, 'residuals-check.mjs'), '--file', join(SKILL_ROOT, 'RESIDUALS.md'), '--check'])
      prodNote = rProd.status === 0 ? 'passed' : `failed(exit=${rProd.status})`
      if (rProd.status !== 0) ok16 = false
    }
    det16.push(`⑤production_check=${prodNote}`)
  } finally { rmSync(fx16, { recursive: true, force: true }) }
  record('R16', ok16, `文档生成自检——${det16.join(' ')}`)
}

// ═══ W5a R17：α/β 门禁自检（spawn 主仓 check-commit-msg --self-test 与 verify-docs --self-test；
//     缺件=FAIL 不跳过；沿用统一超时与 SIGKILL。仅在 --project <主仓> 语境成立——缺省
//     cwd=技能仓时两脚本缺件必 FAIL，不静默降级。β 判据=0/1/3 映射与 spawn 失败四类具名
//     PASS（verify-docs 自检 β-E2E 向量行）；α 判据=exit 0＋「全过」标记。 ═══
if (want('R17')) {
  const alphaScript = join(projectDir, 'scripts', 'check-commit-msg.mjs')
  const betaScript = join(projectDir, 'scripts', 'verify-docs.mjs')
  const r17Run = (script) => spawnSync(node()[0], [script, '--self-test'], { encoding: 'utf8', cwd: projectDir, timeout: 300_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 })
  let ok17 = true
  // ① α 自检：exit 0 且输出含全过标记
  const aOut = existsSync(alphaScript) ? (() => { const r = r17Run(alphaScript); return { r, out: (r.stdout || '') + (r.stderr || '') } })() : { r: { status: null }, out: 'check-commit-msg 缺件' }
  const aOk = existsSync(alphaScript) && aOut.r.status === 0 && aOut.out.includes('全过')
  console.log(`${aOk ? 'PASS' : 'FAIL'} R17-alpha α自检:exit=${aOut.r.status}/全过=${aOut.out.includes('全过')}`)
  if (!aOk) ok17 = false
  // ② β 自检：exit 0 且 β 0/1/3 映射与 spawn 失败四类具名 PASS 齐备
  const bOut = existsSync(betaScript) ? (() => { const r = r17Run(betaScript); return { r, out: (r.stdout || '') + (r.stderr || '') } })() : { r: { status: null }, out: 'verify-docs 缺件' }
  const betaMarks = ['β-E2E terms0 映射', 'β-E2E terms1 映射', 'β-E2E terms3 映射', 'β-E2E spawn失败 映射']
  const betaLineHit = (m) => bOut.out.split('\n').some((l) => l.startsWith(`PASS ${m}`)) // 返工 W-4①：整行匹配（PASS <具名>），非仅标记名出现
  const bOk = existsSync(betaScript) && bOut.r.status === 0 && betaMarks.every(betaLineHit)
  console.log(`${bOk ? 'PASS' : 'FAIL'} R17-beta β自检:exit=${bOut.r.status}/四类具名整行=${betaMarks.filter(betaLineHit).length}/4`)
  if (!bOk) ok17 = false
  record('R17', ok17, `α/β 门禁自检——α ${aOk ? '✓' : '✗'} β ${bOk ? '✓' : '✗'}${!ok17 ? `（α输出尾：${aOut.out.slice(-120)}｜β输出尾：${bOut.out.slice(-120)}）` : ''}`)
}

// ═══ W5b R18：resource-sampler 自检接入（spawn resource-sampler.mjs --self-test 断言 exit 0＋
//     汇总形态 `self-test 汇总：过 X/skip Y/全 Z` 且 X+Y=Z、total>=70——skip 不计 pass 的报告
//     保真面；统一超时 SIGKILL 看护与 R17 同款 300s——sampler 自检含大量子进程实跑） ═══
if (want('R18')) {
  const samplerScript = join(SCRIPTS, 'resource-sampler.mjs') // 本块脚本字串唯一承载点（R12/R13 同款）
  const r18Run = (args) => spawnSync(node()[0], args, { encoding: 'utf8', cwd: SKILL_ROOT, timeout: 300_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 })
  const r = r18Run([samplerScript, '--self-test'])
  const out = (r.stdout || '') + (r.stderr || '')
  const m = /self-test 汇总：过 (\d+)\/skip (\d+)\/全 (\d+)/.exec(out)
  const ok18 = r.status === 0 && m !== null && Number(m[1]) + Number(m[2]) === Number(m[3]) && Number(m[3]) >= 70
  record('R18', ok18, `sampler 自检:exit=${r.status}/汇总=${m ? `过${m[1]}/skip${m[2]}/全${m[3]}` : '形态不符'}${!ok18 ? `（输出尾：${out.slice(-200)}）` : ''}`)
}


// ═══ RT1C R19：run-recover 恢复自检接入（spawn run-recover.mjs --self-test 断言 exit 0＋
//     汇总形态 `self-test 汇总：fixtures=42 vectors=<实数> failed=0 skip_ids=0` 与首行矩阵 token——
//     fixtures 按 distinct fixture_id 计数；独立隔离 temp-root=/tmp/rt1c-executor-selftest 由脚本内
//     默认值承载（裸 --self-test，不携带 --fixtures/--temp-root）；spawn 看护与 R17/R18 同款
//     300s/SIGKILL/64MiB；R-META 与 KNOWN_ITEMS 双载同步由下方漏载断言承载） ═══
if (want('R19')) {
  const recoverScript = join(SCRIPTS, 'run-recover.mjs') // 本块脚本字串唯一承载点（R12/R13 同款）
  const r19Run = (args) => spawnSync(node()[0], args, { encoding: 'utf8', cwd: SKILL_ROOT, timeout: 300_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 })
  const r = r19Run([recoverScript, '--self-test'])
  const out = (r.stdout || '') + (r.stderr || '')
  const fx = /fixtures=(\d+)/.exec(out)
  const vec = /vectors=(\d+)/.exec(out)
  const failed = /failed=(\d+)/.exec(out)
  const skip = /skip_ids=(\d+)/.exec(out)
  const ok19 = r.status === 0 && fx !== null && Number(fx[1]) === 42 && vec !== null && failed !== null && Number(failed[1]) === 0 && skip !== null && Number(skip[1]) === 0 && out.includes('matrix scan_classification=PASS')
  record('R19', ok19, `run-recover 自检:exit=${r.status}/fixtures=${fx ? fx[1] : '?'}/vectors=${vec ? vec[1] : '?'}/failed=${failed ? failed[1] : '?'}/skip_ids=${skip ? skip[1] : '?'}${!ok19 ? `（输出尾：${out.slice(-200)}）` : ''}`)
}


// ═══ RT1AGG R22：run-store 自检接入（spawn run-store.mjs --self-test 断言 exit 0＋
//     汇总形态 `self-test 汇总：ids=52 vectors=<脚本从终态 fixtures 实测的N> failed=0` 与
//     state_matrix=168/168、crash_matrix=117/117、command_matrix=PASS；ids 按 distinct
//     fixture_id 计数；裸 --self-test 不携带 --fixtures/--temp-root（脚本内默认绝对路径与
//     /tmp/rt1a-executor-selftest 隔离域承载）；spawn 看护与 R19 同款 300s/SIGKILL/64MiB；
//     RT1C 批界「regression 不得出现 run-store self-test 并轨」自 rt1agg-ruling-user-1 起取代） ═══
if (want('R22')) {
  const storeScript = join(SCRIPTS, 'run-store.mjs') // 本块脚本字串唯一承载点（R19 同款）
  const r22Run = (args) => spawnSync(node()[0], args, { encoding: 'utf8', cwd: SKILL_ROOT, timeout: 300_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 })
  const r = r22Run([storeScript, '--self-test'])
  const out = (r.stdout || '') + (r.stderr || '')
  const ids = /ids=(\d+)/.exec(out)
  const vec = /vectors=(\d+)/.exec(out)
  const failed = /failed=(\d+)/.exec(out)
  const stateM = /state_matrix=(\d+\/\d+)/.exec(out)
  const crashM = /crash_matrix=(\d+\/\d+)/.exec(out)
  // R1/W3：从终态 fixtures 独立复算 vectors 数并断言与自检输出相等（防汇总虚报）
  let fixturesVectors = null
  try {
    const fxDoc = JSON.parse(readFileSync(join(SCRIPTS, '.golden', 'run-store-fixtures.json'), 'utf8'))
    if (Array.isArray(fxDoc.vectors)) fixturesVectors = fxDoc.vectors.length
  } catch { fixturesVectors = null }
  const recountOk = fixturesVectors !== null && vec !== null && Number(vec[1]) === fixturesVectors
  const ok22 = r.status === 0 && ids !== null && Number(ids[1]) === 52 && vec !== null && failed !== null && Number(failed[1]) === 0 && recountOk && out.includes('state_matrix=168/168') && out.includes('crash_matrix=117/117') && out.includes('command_matrix=PASS')
  record('R22', ok22, `run-store 自检:exit=${r.status}/ids=${ids ? ids[1] : '?'}/vectors=${vec ? vec[1] : '?'}/fixtures_recount=${fixturesVectors ?? '?'}/failed=${failed ? failed[1] : '?'}/state=${stateM ? stateM[1] : '?'}/crash=${crashM ? crashM[1] : '?'}${!ok22 ? `（输出尾：${out.slice(-200)}）` : ''}`)
}


// ── 应跑项漏载断言（W5a/D-9）：results 的 id 集与应跑集（考虑 --only 过滤）恰等——
//    漏载即 FAIL，防静默 9/9 式回归面收缩。 ──
const expectIds = only ? KNOWN_ITEMS.filter((id) => only.includes(id)) : KNOWN_ITEMS.slice()
const gotIds = results.map((r) => r.id)
const dupIds = gotIds.filter((id, i) => gotIds.indexOf(id) !== i)
const missingIds = expectIds.filter((id) => !gotIds.includes(id))
const extraIds = gotIds.filter((id) => !expectIds.includes(id))
if (missingIds.length || extraIds.length || dupIds.length || results.length !== expectIds.length) { // 返工 W-4②：集合双向全等（漏/多）＋无重复＋长度恰等
  console.log(`FAIL R-META 应跑集失配：漏=${missingIds.join(',') || '无'} 多=${extraIds.join(',') || '无'} 重=${dupIds.join(',') || '无'} 实载=${results.length}/应跑=${expectIds.length}（防静默收缩）`)
  results.push({ id: 'R-META', pass: false, detail: '应跑集失配（漏/多/重/长度）' })
}

const fails = results.filter((r) => !r.pass).length
const notruns = results.filter((r) => r.notrun).length
const passed = results.filter((r) => r.pass && !r.notrun).length
console.log(`\nregression 汇总：${passed}/${results.length - notruns} 过${fails ? `，FAIL ×${fails}` : ''}${notruns ? `，SKIP ×${notruns}（未跑项不计入通过数）` : ''}（项=${results.map((r) => r.id).join('/')}）`)
process.exit(fails ? 1 : 0)
