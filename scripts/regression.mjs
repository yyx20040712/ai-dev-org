/**
 * 技能自包含回归（ai-dev-org——06 §5 的内化执行件；R 清单单源=本脚本 --only
 * 可选项集合，此处不复写清单——evolve-E2 b5 指针化）。
 * 2026-10-03 清理批次（用户裁决「彻底删除死代码和文档」）：派发器族回归项
 * 随 ds-call-v2.mjs/scripts/roles 物理删除而删（R1 语义抽样/R2 golden 自比对/
 * R5 mock 全链演练/R11 干涸窗+同族负例/R9 scrub 受控复制对账/R10③vecDs
 * 纯函数向量/R10④B1 registry 错误面向量）——详见 git 历史（dispatch-retire
 * 批前提交）。现役项：
 *   R4'=流水与账本字段完整性（流水现役写入者=glm-look；历史派发器行按
 *       08 §3 旧版本类跳过不改写；账本=主控补记单源 02 §9）；
 *   R7'=账本 schema 指针正向校验（A3——SKILL/snippet 禁内联字段清单）；
 *   R8'=三脚本自检套件聚合（org-config/deploy-check/log-triage）；
 *   R10'=glm-look 回归面（结构断言+splitEndpoint 向量+本地 mock 双通道往返
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
 *       失败四类具名 PASS；仅在 --project <主仓> 语境成立，缺省 cwd=技能仓必 FAIL）。
 * 现役项=R4/R7/R8/R10/R12/R13/R14/R15/R16/R17 十项（W5a 补 R12/R16/R17 头注随动）。
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
const KNOWN_ITEMS = ['R4', 'R7', 'R8', 'R10', 'R12', 'R13', 'R14', 'R15', 'R16', 'R17'] // --only 合法项清单（与下方各 want 块双载——删项须同步两处；派发器族项 R1/R2/R5/R11/R9 已随清理批次删除；R16=B6 文档生成批；R17=W5a α/β 门禁自检）
if (only && only.some((id) => !KNOWN_ITEMS.includes(id))) {
  console.error(`[用法错] 未知回归项：${only.filter((id) => !KNOWN_ITEMS.includes(id)).join(',')}（现役项=${KNOWN_ITEMS.join('/')}——派发器族项已随 2026-10-03 清理批次删除，详见 git 历史）`)
  process.exit(1)
}
const want = (id) => !only || only.includes(id)
const results = []
const record = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${detail}`) }
const node = () => [process.execPath]

// ═══ R4'：流水与账本字段完整性 ═══
// 流水行分类（2026-10-03 清理批次后口径）：channel+dispatcher_version=glm-look
// 现役行（按 GLM_REQUIRED 校验）；channel 无 dispatcher_version=外来 legacy 行；
// 无 channel 有 dispatcher_version=历史派发器行（按 08 §3 旧版本类跳过——
// 历史行禁改写，ds-call-v2 已删除不再产新行）；两者皆无=极早期 legacy 行
// （最小三字段校验）。
if (want('R4')) {
  const GLM_REQUIRED = {
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
  const checkLines = (label, path, required, tailN, opts = {}) => {
    if (!existsSync(path)) return { pass: false, detail: `${label}:文件不存在 ${path}` }
    const ls = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean).slice(-tailN)
    let bad = 0, skipped = 0, foreign = 0, unknown = 0, kinds = {}
    for (const l of ls) {
      let e; try { e = JSON.parse(l) } catch { bad++; continue }
      if (opts.skipIf && opts.skipIf(e)) { skipped++; continue }
      // glm-look 对齐行=channel+dispatcher_version 双标记（selfiter glm-look-schema）
      if (e.channel !== undefined && e.dispatcher_version !== undefined) {
        const gr = GLM_REQUIRED[e.event]
        if (!gr) { unknown++; bad++; continue }
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
      for (const k of req) if (e[k] === undefined) { bad++; break }
      if (e.event) kinds[e.event] = (kinds[e.event] || 0) + 1
    }
    return { pass: bad === 0, kinds, detail: `${label}:尾${ls.length}行坏${bad}行（含未知事件${unknown}）跳${skipped}行(历史/旧版本)外来${foreign}行(他源channel标记) 事件分布=${JSON.stringify(kinds)}` }
  }
  const a = checkLines('流水', LOG_PATH, ['ts', 'runId', 'event'], 100)
  // 校验域真空显式呈现（k1-W1/d1-W3 返工：原「全跳过=FAIL」守卫按清理批次申报软化
  // ——派发器删除后低频写入窗口下尾行全历史=常态非假绿；真空态如实标注，不静默）
  if (a.kinds && !Object.keys(a.kinds).length) a.detail += '；⚠校验域真空：尾行全为历史/外来行（现役 glm-look 行零——低频写入窗口常态，非校验失效）'
  // 2026-10-03 清理批次：流水 cfg 哈希一致性子核对退役——原语义=高频派发行
  // 的「换环境按旧供应商事实硬闯」防线；派发器删除后流水仅剩低频 glm-look
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
    if (!['ok', 'switch', 'exhaust', ...MANUAL_EVENTS].includes(e.event)) return ['__unknown_event__'] // 账本侧未知 event 计坏行（终轮 A'-Kimi：防新增记账事件未同步 schema 即弱校验通过）
    if (MANUAL_EVENTS.has(e.event)) return LEDGER_REQUIRED // 主控人工补记
    const base = e.event === 'ok' ? [...LEDGER_REQUIRED, 'usage'] : LEDGER_REQUIRED
    const v2 = [...base, ...(LEDGER_V2[e.event] || [])]
    // selfiter B4 分代：schema_version 3 的派发行增 project_id 必填（v2 存量行按 v2 契约——历史行禁改写，08 §3）
    return e.schema_version === 3 ? [...v2, 'project_id'] : v2
  }
  const b = checkLines('账本', ledgerPath, ledgerReq, 50, {
    // 无 schema_version 且早于纪律生效时点（2026-09-16T12:00Z）的存量行=旧版本
    // 形态——跳过计数（不追认不改写，08 §3）；时点后新增行漏带不再跳过=计坏。
    skipIf: (e) => {
      if (e.schema_version !== undefined) return false
      const t = Date.parse(e.ts || '')
      return Number.isNaN(t) ? true : t < Date.parse('2026-09-16T12:00:00Z')
    },
  })
  record('R4', passA && b.pass && layerOk, `${a.detail}；${b.detail}；${layerDet}`)
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

// ═══ R10：glm-look 回归面（evolve 批 E1 2026-09-16——R10 归属 b1，P-4 预裁决；
//         2026-10-03 清理批次：③vecDs 纯函数向量与④B1 registry 错误面向量随
//         ds-call-v2/registry 删除而删，详见 git 历史） ═══
//   ①结构断言：glm-look.mjs 非注释行无 fetch( 调用形态+存在 node:http(s) import
//     （注释剥离口径钉死：先剥 /*…*/ 块注释再跳过 // 整行注释；行内尾注不剔——
//      代码半行仍在非注释行内受检）；
//   ③纯函数向量（splitEndpoint——glm-look 自有导出）；
//   ②本地 mock 双通道往返：起 node:http 本地 server 拟真双形（glm=/anthropic
//     /v1/messages anthropic 形、ds=/deepseek /chat/completions openai 形各一轮），
//     子进程驱动 glm-look，env 重定向钩子 GLM_LOOK_HOST_CONFIG/GLM_LOOK_LOG_DIR
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
  // ③ 纯函数向量（splitEndpoint——glm-look 自有；红态函数未导出→FAIL 不崩）
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
  const rGlm = r10Spawn([vecGlm])
  const vecOk = rGlm.status === 0 && (rGlm.stdout || '').includes('R10VEC-ALL-PASS')
  if (!vecOk) ok = false
  const vecFail = (r) => `FAIL(exit=${r.status} 「${((r.stdout || '') + '\n' + (r.stderr || '')).split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 2).join('|')}」)`
  det.push(`③向量:splitEndpoint=${vecOk ? '全过' : vecFail(rGlm)}`)
  // ② 本地 mock 双通道往返（b1 传输层+env 钩子就位才跑——红态跳过防触真实宿主源发现）
  if (vecOk) {
    const { createServer } = await import('node:http')
    const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const server = createServer((req, res) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        // failover 批（2026-10-13）⑧向量：/anthropic-dead 恒 401（次序在通道甄别前
        // ——该路径含 /anthropic 子串，glm 通道源发现会命中它）
        if (req.url.includes('/anthropic-dead')) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"mock unauthorized"}'); return }
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
    // failover 批（2026-10-13）⑧向量：glm 双源——首源（pid 字典序 mock-glm-dead 排前）
    // 恒 401、次源正常。期望=exit 0+正文 MOCK-GLM-OK+流水 fail(mock-glm-dead,401)+
    // ok(mock-glm-live)。红态=旧码 sources[0] 立断 exit 1 无切换承载源。
    const hostCfgFailover = join(r10tmp, 'host-config-failover.json')
    writeFileSync(hostCfgFailover, JSON.stringify({
      provider: {
        'mock-glm-dead': { options: { baseURL: `http://127.0.0.1:${port}/anthropic-dead`, apiKey: 'r10-fo-key-eeeeeeeeeeeeeeeeee' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
        'mock-glm-live': { options: { baseURL: `http://127.0.0.1:${port}/anthropic`, apiKey: 'r10-fo-key-ffffffffffffff' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
      },
    }), 'utf8')
    const rFo = await r10SpawnAsync([join(SCRIPTS, 'glm-look.mjs'), '--prompt', promptFile, imgFile, '--channel', 'glm', '-o', join(r10tmp, 'fo-report.md')], { env: { ...process.env, GLM_LOOK_HOST_CONFIG: hostCfgFailover, GLM_LOOK_LOG_DIR: logDir } })
    const foLogLines = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []
    const foOk = rFo.status === 0 && (rFo.stdout || '').includes('MOCK-GLM-OK') &&
      foLogLines.some((e) => e.event === 'fail' && e.source === 'mock-glm-dead' && e.statusCode === 401) &&
      foLogLines.some((e) => e.event === 'ok' && e.source === 'mock-glm-live')
    if (!foOk) ok = false
    det.push(`⑧源级切换承载源:${foOk ? `✓(exit=0 首源401→次源出活+流水双行)` : `✗(exit=${rFo.status} stderr尾=${(rFo.stderr || '').slice(-120).replace(/\n/g, ' ')})`}`)
    // failover 批返工轮1（k1-W3/d1-W1 处置）：⑨全灭序列=双死源→exit 1+汇总行含
    // 全部 pid（序=偏好序）；⑩首源成活不触次源=活源 pid 排前（字典序 mock-glm-a<
    // mock-glm-z）→exit 0+ok 归 a+流水零行涉 z。红态=⑨循环尾汇总缺失或 exit≠1/
    // ⑩成活后误触次源。
    const hostCfgAllDead = join(r10tmp, 'host-config-alldead.json')
    writeFileSync(hostCfgAllDead, JSON.stringify({
      provider: {
        'mock-glm-dead1': { options: { baseURL: `http://127.0.0.1:${port}/anthropic-dead`, apiKey: 'r10-ad-key-1111111111111111' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
        'mock-glm-dead2': { options: { baseURL: `http://127.0.0.1:${port}/anthropic-dead`, apiKey: 'r10-ad-key-2222222222222222' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
      },
    }), 'utf8')
    const rAd = await r10SpawnAsync([join(SCRIPTS, 'glm-look.mjs'), '--prompt', promptFile, imgFile, '--channel', 'glm'], { env: { ...process.env, GLM_LOOK_HOST_CONFIG: hostCfgAllDead, GLM_LOOK_LOG_DIR: logDir } })
    const adLog = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []
    const adOk = rAd.status === 1 &&
      (rAd.stderr || '').includes('2 个源全穷尽（mock-glm-dead1 → mock-glm-dead2）') &&
      adLog.filter((e) => e.event === 'fail' && (e.source === 'mock-glm-dead1' || e.source === 'mock-glm-dead2')).length === 2
    if (!adOk) ok = false
    det.push(`⑨全源穷尽:${adOk ? `✓(exit=1 汇总行+双 fail 行)` : `✗(exit=${rAd.status} stderr尾=${(rAd.stderr || '').slice(-120).replace(/\n/g, ' ')})`}`)
    const hostCfgLiveFirst = join(r10tmp, 'host-config-livefirst.json')
    writeFileSync(hostCfgLiveFirst, JSON.stringify({
      provider: {
        'mock-glm-a': { options: { baseURL: `http://127.0.0.1:${port}/anthropic`, apiKey: 'r10-lf-key-3333333333333333' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
        'mock-glm-z': { options: { baseURL: `http://127.0.0.1:${port}/anthropic-dead`, apiKey: 'r10-lf-key-4444444444444444' }, models: { 'GLM-5.3-Flash': { name: 'GLM-5.3-Flash' } } },
      },
    }), 'utf8')
    const rLf = await r10SpawnAsync([join(SCRIPTS, 'glm-look.mjs'), '--prompt', promptFile, imgFile, '--channel', 'glm'], { env: { ...process.env, GLM_LOOK_HOST_CONFIG: hostCfgLiveFirst, GLM_LOOK_LOG_DIR: logDir } })
    const lfLog = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []
    const lfOk = rLf.status === 0 && (rLf.stdout || '').includes('MOCK-GLM-OK') &&
      lfLog.some((e) => e.event === 'ok' && e.source === 'mock-glm-a') &&
      !lfLog.some((e) => e.source === 'mock-glm-z')
    if (!lfOk) ok = false
    det.push(`⑩首源成活不触次源:${lfOk ? `✓(exit=0 ok 归首源+次源零流水行)` : `✗(exit=${rLf.status} stderr尾=${(rLf.stderr || '').slice(-120).replace(/\n/g, ' ')})`}`)
    server.close()
  } else {
    ok = false
    det.push('②mock往返:跳过（splitEndpoint 未导出=b1 传输层未落，env 钩子未就位——跑则触真实宿主源发现）')
  }
  if (!keepTmp) rmSync(r10tmp, { recursive: true, force: true })
  record('R10', ok, `glm-look 回归面——${det.join('；')}`)
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
    const stOk = rSt.status === 0 && (rSt.stdout || '').trimEnd().split('\n').pop().includes('27 向量')
    if (!stOk) ok = false
    det.push(`①self-test 24向量(off 隔离):${stOk ? '✓' : `✗(exit=${rSt.status} 尾=${((rSt.stdout || '') + (rSt.stderr || '')).slice(-100).replace(/\n/g, ' ')})`}`)
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
//     ①自检子进程 status 0 且 pass=109/fail=0、T13-04 在场且过、词表提取计数 22（不得只凭 stdout「全过」）；
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
    // ①自检子进程（隔离态）：status 0、pass=109/fail=0、T13-04 在场且过、词表提取计数 22
    // （计数经 T13-04 向量名内 BANNED=22 断言承载——隔离态夹具=22 合成 token，见该向量）
    const rSt = r13Run([tbScript, '--self-test', '--json'])
    // --json 输出逐向量断言（不得只凭 stdout「全过」字样判定）
    let st = null
    try { st = JSON.parse(rSt.stdout || '') } catch { st = null }
    const v1304 = (st?.cases || []).find((c) => String(c.name).includes('T13-04'))
    const stOk = rSt.status === 0 && st?.pass === 109 && st?.fail === 0 && v1304?.ok === true && String(v1304?.name || '').includes('BANNED=22')
    if (!stOk) ok = false
    det.push(`①自检子进程:${stOk ? '✓(exit=0/pass=109/fail=0/T13-04 过且装载计数 22)' : `✗(exit=${rSt.status} pass=${st?.pass} fail=${st?.fail})`}`)
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
