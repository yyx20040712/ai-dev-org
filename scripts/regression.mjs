/**
 * 技能自包含回归（ai-dev-org——06 §5 的内化执行件；R 清单单源=本脚本 --only
 * 可选项集合，此处不复写清单——evolve-E2 b5 指针化）。
 * 2026-10-03 纯净化批（用户裁决「彻底删除死代码和文档」）：派发器族回归项
 * 随 ds-call-v2.mjs/scripts/roles 物理删除而删（R1 语义抽样/R2 golden 自比对/
 * R5 mock 全链演练/R11 干涸窗+同族负例/R9 scrub 受控复制对账/R10③vecDs
 * 纯函数向量/R10④B1 registry 错误面向量）——档案=git 历史（dispatch-retire
 * 批前提交）。现役项：
 *   R4'=流水与账本字段完整性（流水现役写入者=glm-look；历史派发器行按
 *       08 §3 旧版本类跳过不改写；账本=主控补记单源 02 §9）；
 *   R7'=账本 schema 指针正向校验（A3——SKILL/snippet 禁内联字段清单）；
 *   R8'=三脚本自检套件聚合（org-config/deploy-check/log-triage）；
 *   R10'=glm-look 回归面（结构断言+splitEndpoint 向量+本地 mock 双通道往返
 *       +null 守卫——evolve 批 b1 承载）。
 * 用法：node scripts/regression.mjs [--only R4,R7,R8,R10] [--project <账本目录>]
 *       [--ledger <账本路径>] [--keep-tmp]
 *       （flag 取值一律空格分隔，--x=y 等号形态=用法错拒收——cliFlag 单源立场）
 * 退出码口径单源=references/06 §5.8。
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync, spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { SKILL_ROOT, cliFlag, UsageError } from './org-config.mjs'
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
  if (onlyArg) only = onlyArg.split(',').map((s) => s.trim().toUpperCase())
  projectDir = flag('--project') || process.cwd()
} catch (e) {
  if (e instanceof UsageError) {
    console.error(`[用法错] ${e.message}`)
    process.exit(1)
  }
  throw e
}
const keepTmp = argv.includes('--keep-tmp')
const KNOWN_ITEMS = ['R4', 'R7', 'R8', 'R10'] // --only 合法项清单（与下方各 want 块双载——删项须同步两处；派发器族项 R1/R2/R5/R11/R9 已随纯净化批删除）
if (only && only.some((id) => !KNOWN_ITEMS.includes(id))) {
  console.error(`[用法错] 未知回归项：${only.filter((id) => !KNOWN_ITEMS.includes(id)).join(',')}（现役项=${KNOWN_ITEMS.join('/')}——派发器族项已随 2026-10-03 纯净化批删除，档案=git 历史）`)
  process.exit(1)
}
const want = (id) => !only || only.includes(id)
const results = []
const record = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${detail}`) }
const node = () => [process.execPath]

// ═══ R4'：流水与账本字段完整性 ═══
// 流水行分类（2026-10-03 纯净化批后口径）：channel+dispatcher_version=glm-look
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
  // 校验域真空显式呈现（k1-W1/d1-W3 回炉：原「全跳过=FAIL」守卫按纯净化批申报软化
  // ——派发器删除后低频写入窗口下尾行全历史=常态非假绿；真空态如实标注，不静默）
  if (a.kinds && !Object.keys(a.kinds).length) a.detail += '；⚠校验域真空：尾行全为历史/外来行（现役 glm-look 行零——低频写入窗口常态，非校验失效）'
  // 2026-10-03 纯净化批：流水 cfg 哈希一致性子核对退役——原语义=高频派发行
  // 的「换环境按旧供应商事实硬闯」防线；派发器删除后流水仅剩低频 glm-look
  // 写入（旧行哈希=写入时点事实，配置变更后必然滞后=假红面）。现役配置漂移
  // 观测=health-scan cfg 漂移 WARN+账本行 cfg_hash 主控补记即时值（02 §9）。
  a.detail += '；cfg哈希子核对=退役（纯净化批——低频写入面假红，观测移交 health-scan）'
  const passA = a.pass
  const ledgerPath = flag('--ledger') || join(projectDir, '.zcode', 'org-ledger.jsonl')
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

// ═══ R10：glm-look 回归面（evolve 批 E1 2026-09-16——R10 归属 b1，P-4 预裁决；
//         2026-10-03 纯净化批：③vecDs 纯函数向量与④B1 registry 错误面向量随
//         ds-call-v2/registry 删除而删，档案=git 历史） ═══
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
    // 发现=新机纯装形态（mergeHostRegistries 物化 providerRules 后通道命中；门一双审
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
    server.close()
  } else {
    ok = false
    det.push('②mock往返:跳过（splitEndpoint 未导出=b1 传输层未落，env 钩子未就位——跑则触真实宿主源发现）')
  }
  if (!keepTmp) rmSync(r10tmp, { recursive: true, force: true })
  record('R10', ok, `glm-look 回归面——${det.join('；')}`)
}

const fails = results.filter((r) => !r.pass).length
const notruns = results.filter((r) => r.notrun).length
const passed = results.filter((r) => r.pass && !r.notrun).length
console.log(`\nregression 汇总：${passed}/${results.length - notruns} 过${fails ? `，FAIL ×${fails}` : ''}${notruns ? `，SKIP ×${notruns}（未跑项不计入通过数）` : ''}（项=${results.map((r) => r.id).join('/')}）`)
process.exit(fails ? 1 : 0)
