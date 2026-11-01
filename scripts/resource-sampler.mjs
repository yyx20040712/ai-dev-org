#!/usr/bin/env node
// resource-sampler.mjs — 被测命令资源采样/限值收割/登记集清理（W5b R2-T3 D-1，2026-11-01）
// 规范锚：plan-b8plus-2026-10-30.md:142「禁止用全局」（仅登记集清理，禁全局 /tmp 清空）；
//   B8-migrator-hardening.md:50「异步子进程强制收割」:52「资源预算硬上限」:55「执行期间固定间隔 5s」
//   :56「采样器绑定被测命令 PID」；B8-migrator-hardening-impl-2026-10-30.md:146「18/18 全 exit=0」；
//   plan-b8plus-2026-10-30.md:156「新工具统一使用 0/1/3」。
// 三形态：
//   运行   --cmdfile <command.json> --out <samples.jsonl> [--interval-ms N] [--timeout-ms N]
//          [--max-iterations N] [--max-processes N] [--max-dirs N]
//   清理   --cleanup --registry <paths.json>
//   自检   --self-test
// 缺省=5000/300000/100/8/20（interval/timeout/iterations/processes/dirs）。
// 退出码：0 成功；1 用法错/递归拒绝/触限/子命令非零/spawn 错/删除失败/残留；3 装载错（JSON 不可读、
//   路径/正则非法、危险路径、--out 写面不可用）。无 2（06 §5.8：exit 2 为派发器专用）。
// 非 shell：只执行显式 argv（execve 直传，无 shell 解释）；不清全局 /tmp；不写仓库/账本/配置
//   （--out 与 dir_prefixes/registry 一律限 /tmp 后代，域外即装载错 3）。
// 递归哨兵：env ORG_RESOURCE_SAMPLER_DEPTH 非空即拒绝（exit 1＋[sentinel] resource-sampler rejected），
//   拒绝发生在 spawn 之前；子环境固定注入深度 1（子进程内再调本工具必被拒）。
// 供应商事实零硬编码：不含端点/模型名；自检夹具一律落 os.tmpdir()（w5b-t3-resource-sampler-selftest-*），
//   不写技能仓。

import { readFileSync, writeFileSync, existsSync, statSync, lstatSync, mkdirSync, rmSync, readdirSync, chmodSync, realpathSync, mkdtempSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'

const SELF = fileURLToPath(import.meta.url)
const DEPTH_ENV = 'ORG_RESOURCE_SAMPLER_DEPTH'
const SENTINEL = '[sentinel] resource-sampler rejected'
const DEFAULTS = { intervalMs: 5000, timeoutMs: 300000, maxIterations: 100, maxProcesses: 8, maxDirs: 20 }
// 两仓根（登记集危险路径面·D-1c）：绝对路径前缀，登记集内出现即装载错 3
const FORBIDDEN_ROOTS = ['/home/yyx/work/aidevorg', '/home/yyx/.zcode/skills/ai-dev-org']

/** 装载错（exit 3 单源）：JSON 不可读/非法、路径/正则非法、危险路径、写面不可用。 */
export class SamplerLoadError extends Error {}

/** /tmp 域路径校验（读面通用）：绝对、/tmp 后代、无 ..、解析不越界、符号链接目标不越界、非两仓根。 */
export function checkTmpPath(p, what) {
  if (typeof p !== 'string' || p.length === 0) throw new SamplerLoadError(`${what} 须为非空字符串：${String(p)}`)
  if (!p.startsWith('/')) throw new SamplerLoadError(`${what} 须为绝对路径：${p}`)
  if (p === '/tmp') throw new SamplerLoadError(`${what} 为 /tmp 自身（危险路径，禁触碰）`)
  if (p.includes('..')) throw new SamplerLoadError(`${what} 含 ..（越界形态，危险路径）：${p}`)
  if (!p.startsWith('/tmp/')) throw new SamplerLoadError(`${what} 非 /tmp 后代（危险路径）：${p}`)
  for (const root of FORBIDDEN_ROOTS) if (p === root || p.startsWith(root + '/')) throw new SamplerLoadError(`${what} 命中禁改仓根：${p}`)
  const rp = resolve(p)
  if (!rp.startsWith('/tmp/')) throw new SamplerLoadError(`${what} 解析后越界出 /tmp（危险路径）：${p} → ${rp}`)
  if (existsSync(rp) && lstatSync(rp).isSymbolicLink()) {
    let real
    try { real = realpathSync(rp) } catch { real = rp }
    if (real === '/tmp' || !real.startsWith('/tmp/')) throw new SamplerLoadError(`${what} 符号链接目标越界出 /tmp（危险路径）：${p} → ${real}`)
  }
  return rp
}

/** cmdfile 装载与校验（全部启动前完成；任一不符=装载错 3，不 spawn）。 */
export function loadCommand(cmdPath) {
  let raw
  try { raw = readFileSync(cmdPath, 'utf8') } catch (e) { throw new SamplerLoadError(`cmdfile 不可读：${cmdPath}（${e.message}）`) }
  let doc
  try { doc = JSON.parse(raw) } catch (e) { throw new SamplerLoadError(`cmdfile JSON 不可解析：${cmdPath}（${e.message}）`) }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new SamplerLoadError('cmdfile 须为 JSON 对象')
  const { argv, cwd, process_pattern: pattern, dir_prefixes: prefixes } = doc
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === 'string' && a.length > 0)) {
    throw new SamplerLoadError('cmdfile.argv 须为非空字符串的非空数组（非 shell：只执行显式 argv）')
  }
  if (typeof cwd !== 'string' || !cwd.startsWith('/') || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new SamplerLoadError(`cmdfile.cwd 须为已存在的绝对目录：${String(cwd)}`)
  }
  if (typeof pattern !== 'string' || pattern.length === 0) throw new SamplerLoadError('cmdfile.process_pattern 须为非空字符串（pgrep 正则）')
  try { new RegExp(pattern) } catch (e) { throw new SamplerLoadError(`cmdfile.process_pattern 非法正则（启动前拒绝，不 spawn）：${e.message}`) }
  if (!Array.isArray(prefixes) || prefixes.length === 0) throw new SamplerLoadError('cmdfile.dir_prefixes 须为非空数组')
  for (const p of prefixes) checkTmpPath(p, 'dir_prefixes[]')
  return { argv, cwd, pattern, prefixes }
}

/** 目录浅层计数（每前缀一层子目录；有界不递归）。 */
export function countDirs(prefixes) {
  let n = 0
  for (const p of prefixes || []) {
    let entries = []
    try { entries = readdirSync(p, { withFileTypes: true }) } catch { continue }
    for (const e of entries) if (e.isDirectory()) n++
  }
  return n
}

/** 进程组存活计数：pgrep -g <pgid>；剔除采样器自身 pid（pgrep 子进程不在目标组，防御面由组语义保证）。 */
export function countGroupProcesses(pgid) {
  let r
  try { r = spawnSync('pgrep', ['-g', String(pgid)], { encoding: 'utf8' }) } catch { return 0 }
  if (!r || r.status === null || (r.status !== 0 && r.status !== 1)) return 0 // pgrep 不可用时不虚构计数
  const selfPid = process.pid
  return String(r.stdout ?? '').split('\n').map((s) => Number(s.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p !== selfPid).length
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 运行形态：detached 进程组、前/间隔/后采样、触限即 SIGKILL 整组＋await close＋复测残留。 */
export async function runMode(cmd, outPath, limits) {
  const samples = []
  const started = Date.now()
  try { writeFileSync(outPath, '', 'utf8') } catch (e) { throw new SamplerLoadError(`--out 写面不可用：${outPath}（${e.message}）`) }
  const writeSample = (rec) => {
    try { writeFileSync(outPath, JSON.stringify(rec) + '\n', { flag: 'a' }) } catch (e) { throw new SamplerLoadError(`采样写出失败：${outPath}（${e.message}）`) }
  }

  // detached：子进程为新进程组/会话首（pgid=pid），整组收割用 kill(-pgid, 'SIGKILL')
  let child
  try {
    child = spawn(cmd.argv[0], cmd.argv.slice(1), {
      cwd: cmd.cwd, detached: true, stdio: 'inherit',
      env: { ...process.env, [DEPTH_ENV]: '1' }, // 子环境固定深度 1：嵌套调用必被哨兵拒绝
    })
  } catch (e) {
    console.log(JSON.stringify({ mode: 'run', pid: null, samples: 0, child_exit: null, timeout: false, reaped: false, peak_processes: 0, peak_dirs: 0, limit_hit: false, limit_reason: null, residual_processes: 0, spawn_error: String(e.message) }))
    return 1
  }
  const pgid = child.pid
  let exited = false, exitCode = null, exitSignal = null, spawnErr = null
  child.once('error', (e) => { spawnErr = e; exited = true }) // spawn 失败（如 ENOENT）立即退环，无悬挂
  child.once('exit', (code, signal) => { exited = true; exitCode = code; exitSignal = signal })

  let limitHit = false, limitReason = null
  let peakP = 0, peakD = 0
  let iteration = 0
  const doSample = () => {
    const elapsed = Date.now() - started
    const processes = countGroupProcesses(pgid)
    const dirs = countDirs(cmd.prefixes)
    peakP = Math.max(peakP, processes); peakD = Math.max(peakD, dirs)
    const rec = { ts: new Date().toISOString(), pid: pgid, iteration, elapsed_ms: elapsed, processes, dirs, limit_hit: limitHit }
    samples.push(rec); writeSample(rec)
    return rec
  }
  doSample() // 前采样
  // 强制收割：SIGKILL 整组＋await close；异常路径补杀（有界 2 轮×5s）
  const killGroup = async () => {
    for (let attempt = 0; attempt < 2 && !exited; attempt++) {
      try { process.kill(-pgid, 'SIGKILL') } catch { /* 组已消亡 */ }
      try { child.kill('SIGKILL') } catch { /* 已退出 */ }
      let waited = 0
      while (!exited && waited < 5000) { await sleep(25); waited += 25 }
    }
  }
  while (true) {
    if (exited) break
    const remaining = limits.timeoutMs - (Date.now() - started)
    if (remaining <= 0) { limitHit = true; limitReason = 'timeout'; break }
    await sleep(Math.max(1, Math.min(limits.intervalMs, remaining)))
    if (exited) break
    iteration += 1
    const s = doSample()
    if (Date.now() - started >= limits.timeoutMs) { limitHit = true; limitReason = 'timeout'; break }
    if (iteration >= limits.maxIterations) { limitHit = true; limitReason = 'max_iterations'; break }
    if (s.processes > limits.maxProcesses) { limitHit = true; limitReason = 'max_processes'; break }
    if (s.dirs > limits.maxDirs) { limitHit = true; limitReason = 'max_dirs'; break }
  }
  if (limitHit) await killGroup()
  let waited = 0 // 正常退出路径也 await close
  while (!exited && waited < 5000) { await sleep(25); waited += 25 }
  await sleep(150) // 组收割余量：SIGKILL 生效后再复测残留
  const residual = countGroupProcesses(pgid)
  doSample() // 后采样（limit_hit 终值）
  const reaped = exited && residual === 0
  console.log(JSON.stringify({
    mode: 'run', out: outPath, pid: pgid, samples: samples.length,
    child_exit: exitCode, child_signal: exitSignal, timeout: limitReason === 'timeout', reaped,
    peak_processes: peakP, peak_dirs: peakD, limit_hit: limitHit, limit_reason: limitReason,
    residual_processes: residual, spawn_error: spawnErr ? String(spawnErr.message) : null,
  }))
  if (spawnErr) return 1
  if (limitHit) return 1
  if (exitCode !== 0) return 1 // 含 null（信号终止）
  if (!reaped) return 1
  return 0
}

/** registry 装载与校验（先校验全部路径，再逐路径删除）。 */
export function loadRegistry(regPath) {
  let raw
  try { raw = readFileSync(regPath, 'utf8') } catch (e) { throw new SamplerLoadError(`registry 不可读：${regPath}（${e.message}）`) }
  let doc
  try { doc = JSON.parse(raw) } catch (e) { throw new SamplerLoadError(`registry JSON 不可解析：${regPath}（${e.message}）`) }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.paths)) throw new SamplerLoadError('registry 须为 {paths:[绝对路径...]}')
  const resolved = doc.paths.map((p) => checkTmpPath(p, 'registry.paths[]'))
  return { paths: doc.paths, resolved }
}

/** 清理形态：仅删登记集（逐路径 lstat/删除/复核），输出 registered/existed/deleted/residual。 */
export function cleanupMode(reg) {
  const detail = []
  let existed = 0, deleted = 0, residual = 0, failed = false
  for (let i = 0; i < reg.paths.length; i++) {
    const p = reg.paths[i], rp = reg.resolved[i]
    let isExist = false, isDeleted = false, isResidual = false, error = null
    try {
      lstatSync(rp); isExist = true
      rmSync(rp, { recursive: true, force: false })
      isDeleted = true
    } catch (e) {
      if (e.code === 'ENOENT') { /* 未存在：existed=false 如实登记 */ } else { error = `${e.code ?? ''} ${e.message}`; failed = true }
    }
    try { lstatSync(rp); isResidual = true } catch { /* 已消失=无残留 */ }
    if (isExist) existed++
    if (isDeleted) deleted++
    if (isResidual) residual++
    detail.push({ path: p, existed: isExist, deleted: isDeleted, residual: isResidual, error })
  }
  console.log(JSON.stringify({ mode: 'cleanup', registered: reg.paths.length, existed, deleted, residual, failed, paths: detail }))
  return failed || residual > 0 ? 1 : 0
}

// ── CLI 解析（严格空格分隔；等号/未知/额外/混用/缺值/缺旗标=usage 1） ──
export function parseArgs(argv) {
  const out = { selfTest: false, cleanup: false, cmdfile: null, out: null, registry: null, intervalMs: null, timeoutMs: null, maxIterations: null, maxProcesses: null, maxDirs: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--self-test') out.selfTest = true
    else if (a === '--cleanup') out.cleanup = true
    else if (a === '--cmdfile') { const v = argv[++i]; if (v === undefined) return usageExit(); out.cmdfile = v }
    else if (a === '--out') { const v = argv[++i]; if (v === undefined) return usageExit(); out.out = v }
    else if (a === '--registry') { const v = argv[++i]; if (v === undefined) return usageExit(); out.registry = v }
    else if (a === '--interval-ms') { const v = argv[++i]; if (v === undefined) return usageExit(); out.intervalMs = v }
    else if (a === '--timeout-ms') { const v = argv[++i]; if (v === undefined) return usageExit(); out.timeoutMs = v }
    else if (a === '--max-iterations') { const v = argv[++i]; if (v === undefined) return usageExit(); out.maxIterations = v }
    else if (a === '--max-processes') { const v = argv[++i]; if (v === undefined) return usageExit(); out.maxProcesses = v }
    else if (a === '--max-dirs') { const v = argv[++i]; if (v === undefined) return usageExit(); out.maxDirs = v }
    else return usageExit() // 未知旗标/等号形态（--x=y 不匹配上述分支）/额外位置参数
  }
  return out
}
function usageExit() { usage(); process.exit(1) }

function usage() {
  console.error('用法：node scripts/resource-sampler.mjs --cmdfile <command.json> --out <samples.jsonl> [--interval-ms N] [--timeout-ms N] [--max-iterations N] [--max-processes N] [--max-dirs N]')
  console.error('      node scripts/resource-sampler.mjs --cleanup --registry <paths.json>')
  console.error('      node scripts/resource-sampler.mjs --self-test')
}

const LIMIT_KEYS = [['intervalMs', '--interval-ms'], ['timeoutMs', '--timeout-ms'], ['maxIterations', '--max-iterations'], ['maxProcesses', '--max-processes'], ['maxDirs', '--max-dirs']]

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.selfTest) {
    const { cases, pass, fail } = selfTest()
    for (const c of cases) if (!c.ok) console.log(`[self-test] FAIL ${c.name}${c.detail ? `（${c.detail}）` : ''}`)
    if (fail === 0) console.log(`self-test 全过（${cases.length} 向量）`)
    else console.log(`[self-test] FAIL ×${fail}`)
    process.exit(fail === 0 ? 0 : 1)
  }
  // 形态互斥/必需旗标：缺旗标整体缺失=1、旗标后无值=1、等号/未知/额外/混用=1
  if (args.cleanup && (args.cmdfile !== null || args.out !== null)) { usage(); process.exit(1) }
  if (!args.cleanup && args.registry !== null) { usage(); process.exit(1) }
  if (args.cleanup && args.registry === null) { usage(); process.exit(1) }
  if (!args.cleanup && (args.cmdfile === null || args.out === null)) { usage(); process.exit(1) }
  const limits = { ...DEFAULTS }
  for (const [k] of LIMIT_KEYS) {
    if (args[k] !== null) {
      const n = Number(args[k])
      if (!Number.isInteger(n) || n <= 0) { usage(); process.exit(1) }
      limits[k] = n
    }
  }
  if (args.cleanup) {
    try { process.exit(cleanupMode(loadRegistry(args.registry))) } catch (e) {
      if (e instanceof SamplerLoadError) { console.error(`[装载错] ${e.message}`); process.exit(3) }
      console.error(`[运行错] ${e.message}`); process.exit(1)
    }
  }
  // 递归哨兵：任何非空深度值＝嵌套调用，启动前拒绝（不 spawn）
  if (process.env[DEPTH_ENV]) { console.error(SENTINEL); process.exit(1) }
  let cmd
  try {
    cmd = loadCommand(args.cmdfile)
    const rp = resolve(args.out)
    if (rp === '/tmp' || !rp.startsWith('/tmp/')) throw new SamplerLoadError(`--out 须为 /tmp 后代路径（禁写仓库/全局域）：${args.out}`)
    if (existsSync(rp) && statSync(rp).isDirectory()) throw new SamplerLoadError(`--out 指向目录（写失败面）：${args.out}`)
    const parent = dirname(rp)
    if (!existsSync(parent) || !statSync(parent).isDirectory()) throw new SamplerLoadError(`--out 目录不存在：${parent}`)
  } catch (e) {
    console.error(`[装载错] ${e.message}`); process.exit(3)
  }
  runMode(cmd, args.out, limits)
    .then((code) => process.exit(code))
    .catch((e) => { console.error(`[${e instanceof SamplerLoadError ? '装载错' : '运行错'}] ${e.message}`); process.exit(e instanceof SamplerLoadError ? 3 : 1) })
}

// ── 自检（≥16 向量；夹具落 os.tmpdir() 前缀 w5b-t3-resource-sampler-selftest-*，随验清理） ──
function selfTest() {
  const cases = []
  const add = (name, ok, detail = '') => cases.push({ name, ok: !!ok, detail })
  const observed = new Set()
  const tmp = mkdtempSync(join(tmpdir(), 'w5b-t3-resource-sampler-selftest-'))
  const envClean = () => { const e = { ...process.env }; delete e[DEPTH_ENV]; return e }
  const cli = (args, opts = {}) => {
    const r = spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env: opts.depth ? { ...envClean(), [DEPTH_ENV]: '1' } : envClean() })
    observed.add(r.status)
    return r
  }
  const json = (r) => { try { return JSON.parse(r.stdout) } catch { return null } }
  const wj = (p, o) => { writeFileSync(p, JSON.stringify(o), 'utf8') }
  const simpleCmd = (argv, prefix) => { const p = join(tmp, `cmd-${prefix}.json`); wj(p, { argv, cwd: tmp, process_pattern: 'w5b-t3', dir_prefixes: [tmp] }); return p }
  const runCase = (prefix, argv, extra = [], dirPrefix = null) => {
    const outF = join(tmp, `samples-${prefix}.jsonl`)
    let cmdF
    if (dirPrefix) { cmdF = join(tmp, `cmd-${prefix}.json`); wj(cmdF, { argv, cwd: tmp, process_pattern: 'w5b-t3', dir_prefixes: [dirPrefix] }) }
    else cmdF = simpleCmd(argv, prefix)
    const r = cli(['--cmdfile', cmdF, '--out', outF, ...extra])
    return { r, outF, cmdF, s: json(r) }
  }
  try {
    // V-1 正例：exit 0、child_exit 0、limit_hit=false、reaped=true
    const v1 = runCase('ok', [process.execPath, '-e', 'process.exit(0)'])
    add('V-1 正例：exit 0 且 child_exit=0/limit_hit=false/reaped=true/limit_reason=null',
      v1.r.status === 0 && v1.s && v1.s.child_exit === 0 && v1.s.limit_hit === false && v1.s.reaped === true && v1.s.limit_reason === null && v1.s.timeout === false,
      `status=${v1.r.status} out=${v1.r.stdout.slice(0, 200)}`)
    // JSONL 结构：ts/pid/iteration/elapsed_ms/processes/dirs/limit_hit
    let jsonlOk = false, jsonlDetail = ''
    try {
      const lines = readFileSync(v1.outF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      jsonlOk = lines.length >= 2 && lines.every((l) => ['ts', 'pid', 'iteration', 'elapsed_ms', 'processes', 'dirs', 'limit_hit'].every((k) => k in l))
      jsonlDetail = `lines=${lines.length}`
    } catch (e) { jsonlDetail = e.message }
    add('V-1 JSONL 结构：≥2 样本且逐样本含 ts/pid/iteration/elapsed_ms/processes/dirs/limit_hit', jsonlOk, jsonlDetail)
    // 递归哨兵直跑：DEPTH=1 → exit 1＋固定哨兵＋不 spawn（out 未产生）
    const gOut = join(tmp, 'samples-guard.jsonl')
    const gCmd = simpleCmd([process.execPath, '-e', 'process.exit(0)'], 'guard')
    const g = cli(['--cmdfile', gCmd, '--out', gOut], { depth: true })
    add('D-1a 递归哨兵直跑：DEPTH=1 → exit 1＋[sentinel] resource-sampler rejected＋out 未产生（启动前拒绝不 spawn）',
      g.status === 1 && g.stderr.includes(SENTINEL) && !existsSync(gOut), `status=${g.status} err=${g.stderr.slice(0, 120)}`)
    // 递归嵌套：父 sampler 的子环境固定深度 1 → 内层被拒
    const nOut = join(tmp, 'samples-nested-inner.jsonl')
    const nInnerCmd = simpleCmd([process.execPath, '-e', 'process.exit(0)'], 'nested-inner')
    const nOuter = runCase('nested', [process.execPath, SELF, '--cmdfile', nInnerCmd, '--out', nOut])
    add('D-1a 递归嵌套：子环境固定深度 1 → 内层 exit 1＋固定哨兵（stderr 继承可观测）＋外层 exit 1',
      nOuter.r.status === 1 && nOuter.r.stderr.includes(SENTINEL), `status=${nOuter.r.status} err=${nOuter.r.stderr.slice(0, 160)}`)
    // V-2 超时：子带孙且忽略普通终止（trap TERM/INT）→ 缩 timeout → exit 1/timeout=true/整组 SIGKILL/residual=0
    const v2 = runCase('timeout', ['sh', '-c', 'trap "" TERM INT; sleep 5 & sleep 5 & wait'], ['--interval-ms', '100', '--timeout-ms', '200'])
    add('V-2 超时收割：子带孙忽略普通终止 → exit 1/timeout=true/limit_reason=timeout/reaped=true/residual_processes=0',
      v2.r.status === 1 && v2.s && v2.s.timeout === true && v2.s.limit_reason === 'timeout' && v2.s.limit_hit === true && v2.s.reaped === true && v2.s.residual_processes === 0,
      `status=${v2.r.status} out=${v2.r.stdout.slice(0, 240)}`)
    add('V-2 组收割：触限后 peak_processes≥3（sh＋两孙）且终值残留 0（SIGKILL 整组）',
      v2.s && v2.s.peak_processes >= 3 && v2.s.residual_processes === 0, `peak=${v2.s?.peak_processes} residual=${v2.s?.residual_processes}`)
    // V-2 spawn error：exit 1 无悬挂（spawnSync 60s 看护未触发即无悬挂）
    const v2e = runCase('spawnerr', ['/nonexistent-w5b-t3-binary-xyz'])
    add('V-2 spawn error：目标不存在 → exit 1、timeout=false、无悬挂',
      v2e.r.status === 1 && v2e.s && v2e.s.spawn_error !== null && v2e.s.timeout === false, `status=${v2e.r.status} out=${v2e.r.stdout.slice(0, 200)}`)
    // V-2 子非零：exit 1
    const v2nz = runCase('nonzero', [process.execPath, '-e', 'process.exit(3)'])
    add('V-2 子非零：child_exit=3 → exit 1 无悬挂', v2nz.r.status === 1 && v2nz.s && v2nz.s.child_exit === 3, `status=${v2nz.r.status}`)
    // V-3 三限红队：每次只缩一限＋未触限对照
    const v3i = runCase('iter', [process.execPath, '-e', 'setTimeout(()=>{},1500)'], ['--interval-ms', '100', '--max-iterations', '2'])
    add('V-3 max_iterations：只缩迭代限 → exit 1/limit_reason=max_iterations/timeout=false', v3i.r.status === 1 && v3i.s && v3i.s.limit_reason === 'max_iterations' && v3i.s.timeout === false, `status=${v3i.r.status} out=${v3i.r.stdout.slice(0, 200)}`)
    const v3iCtl = runCase('iter-ctl', [process.execPath, '-e', 'setTimeout(()=>{},600)'], ['--interval-ms', '100'])
    add('V-3 max_iterations 对照：未触限（缺省 100）→ exit 0/limit_hit=false', v3iCtl.r.status === 0 && v3iCtl.s && v3iCtl.s.limit_hit === false && v3iCtl.s.limit_reason === null, `status=${v3iCtl.r.status}`)
    const v3p = runCase('proc', ['sh', '-c', 'sleep 2 & sleep 2 & wait'], ['--interval-ms', '100', '--max-processes', '1'])
    add('V-3 max_processes：只缩进程限 → exit 1/limit_reason=max_processes/零残留', v3p.r.status === 1 && v3p.s && v3p.s.limit_reason === 'max_processes' && v3p.s.residual_processes === 0, `status=${v3p.r.status} out=${v3p.r.stdout.slice(0, 200)}`)
    const v3pCtl = runCase('proc-ctl', ['sh', '-c', 'sleep 2 & sleep 2 & wait'], ['--interval-ms', '100'])
    add('V-3 max_processes 对照：缺省 8 未触限 → exit 0 且计数排除采样器/pgrep 面（peak=3：sh＋两子）', v3pCtl.r.status === 0 && v3pCtl.s && v3pCtl.s.limit_hit === false && v3pCtl.s.peak_processes === 3, `status=${v3pCtl.r.status} peak=${v3pCtl.s?.peak_processes}`)
    const dPrefix = join(tmp, 'dirs-work')
    mkdirSync(dPrefix, { recursive: true })
    const v3d = runCase('dirs', [process.execPath, '-e', `const fs=require('fs');const b=process.argv[1];fs.mkdirSync(b+'/d1');fs.mkdirSync(b+'/d2');setTimeout(()=>{},800)`, dPrefix], ['--interval-ms', '100', '--max-dirs', '1'], dPrefix)
    add('V-3 max_dirs：只缩目录限 → exit 1/limit_reason=max_dirs', v3d.r.status === 1 && v3d.s && v3d.s.limit_reason === 'max_dirs' && v3d.s.peak_dirs >= 2, `status=${v3d.r.status} out=${v3d.r.stdout.slice(0, 200)}`)
    const v3dCtl = runCase('dirs-ctl', [process.execPath, '-e', `const fs=require('fs');const b=process.argv[1];fs.mkdirSync(b+'/c1');setTimeout(()=>{},400)`, dPrefix], ['--interval-ms', '100'], dPrefix)
    add('V-3 max_dirs 对照：未触限（缺省 20）→ exit 0/limit_hit=false', v3dCtl.r.status === 0 && v3dCtl.s && v3dCtl.s.limit_hit === false && v3dCtl.s.limit_reason === null, `status=${v3dCtl.r.status} peak_dirs=${v3dCtl.s?.peak_dirs}`)
    // V-4 登记集清理：成功＋集外哨兵原样（内容不变）
    const cDir = join(tmp, 'cleanup-work')
    mkdirSync(cDir, { recursive: true })
    const f1 = join(cDir, 'a.txt'), f2 = join(cDir, 'b.txt'), sentry = join(cDir, 'sentry.txt')
    writeFileSync(f1, 'a'); writeFileSync(f2, 'b'); writeFileSync(sentry, 'SENTINEL-CONTENT')
    const regP = join(tmp, 'registry-ok.json')
    wj(regP, { paths: [f1, f2] })
    const cOk = cli(['--cleanup', '--registry', regP])
    const cOkS = json(cOk)
    add('V-4 登记集清理成功：exit 0/deleted=2/residual=0/逐路径 existed+deleted 如实/集外哨兵原样未触',
      cOk.status === 0 && cOkS && cOkS.registered === 2 && cOkS.existed === 2 && cOkS.deleted === 2 && cOkS.residual === 0
      && cOkS.paths.every((p) => p.existed && p.deleted && !p.residual) && existsSync(sentry) && readFileSync(sentry, 'utf8') === 'SENTINEL-CONTENT',
      `status=${cOk.status} out=${cOk.stdout.slice(0, 240)}`)
    // V-4 危险路径四面：/tmp 自身/非 /tmp 后代/越界/两仓根=3
    const danger = (label, paths) => {
      const rp = join(tmp, `registry-${label}.json`); wj(rp, { paths })
      const r = cli(['--cleanup', '--registry', rp])
      add(`V-4 危险路径 ${label}：exit 3（装载错·不删任何件）`, r.status === 3 && r.stderr.includes('[装载错]'), `status=${r.status} err=${r.stderr.slice(0, 120)}`)
    }
    danger('tmp-self', ['/tmp'])
    danger('non-tmp', ['/home/yyx/w5b-t3-nonexistent'])
    danger('escape', ['/tmp/../home/yyx/w5b-t3-nonexistent'])
    danger('repo-root', ['/home/yyx/work/aidevorg/docs/w5b-t3-nonexistent.md'])
    // V-4 删除失败/残留=1：父目录去写位使 unlink 必败（验后恢复权限随 finally 清理）
    const roDir = join(tmp, 'cleanup-ro')
    mkdirSync(roDir, { recursive: true })
    const locked = join(roDir, 'locked.txt')
    writeFileSync(locked, 'locked')
    chmodSync(roDir, 0o555)
    const regRo = join(tmp, 'registry-ro.json'); wj(regRo, { paths: [locked] })
    const cRo = cli(['--cleanup', '--registry', regRo])
    const cRoS = json(cRo)
    chmodSync(roDir, 0o755)
    add('V-4 删除失败/残留：unlink 被拒 → exit 1/deleted=0/residual=1/existed=1/failed=true',
      cRo.status === 1 && cRoS && cRoS.deleted === 0 && cRoS.residual === 1 && cRoS.existed === 1 && cRoS.failed === true,
      `status=${cRo.status} out=${cRo.stdout.slice(0, 240)}`)
    // 退出码矩阵：缺旗标/缺值/等号/未知/额外/混用=1
    const noArgs = cli([])
    add('D-1 缺旗标（无参）：usage exit 1', noArgs.status === 1, `status=${noArgs.status}`)
    const halfRun = cli(['--cmdfile', join(tmp, 'cmd-ok.json')])
    add('D-1 缺旗标（缺 --out）：usage exit 1', halfRun.status === 1, `status=${halfRun.status}`)
    const noVal = cli(['--cmdfile'])
    add('D-1 缺值（旗标后无值）：usage exit 1', noVal.status === 1, `status=${noVal.status}`)
    const eqForm = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', join(tmp, 'x.jsonl'), '--timeout-ms=5'])
    add('D-1 等号形态：usage exit 1', eqForm.status === 1, `status=${eqForm.status}`)
    const unknown = cli(['--bogus'])
    add('D-1 未知旗标：usage exit 1', unknown.status === 1, `status=${unknown.status}`)
    const extra = cli(['--self-test', 'extra'])
    add('D-1 额外位置参数：usage exit 1', extra.status === 1, `status=${extra.status}`)
    const mixed = cli(['--cleanup', '--registry', join(tmp, 'registry-ok.json'), '--cmdfile', join(tmp, 'cmd-ok.json'), '--out', join(tmp, 'x2.jsonl')])
    add('D-1 混用（cleanup＋run 旗标）：usage exit 1', mixed.status === 1, `status=${mixed.status}`)
    const regOnly = cli(['--registry', join(tmp, 'registry-ok.json')])
    add('D-1 --registry 无 --cleanup：usage exit 1', regOnly.status === 1, `status=${regOnly.status}`)
    const cleanupNoReg = cli(['--cleanup'])
    add('D-1 --cleanup 缺 --registry：usage exit 1', cleanupNoReg.status === 1, `status=${cleanupNoReg.status}`)
    const badNum = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', join(tmp, 'x3.jsonl'), '--max-dirs', 'abc'])
    add('D-1 非正整数限值：usage exit 1', badNum.status === 1, `status=${badNum.status}`)
    // 装载错 3：JSON 不可读/非法 schema/cwd 非绝对/非法正则（不 spawn）/--out 写失败两面
    const badJson = join(tmp, 'cmd-badjson.json'); writeFileSync(badJson, '{nope', 'utf8')
    const rBadJson = cli(['--cmdfile', badJson, '--out', join(tmp, 'x4.jsonl')])
    add('D-1 JSON 不可读/不可解析：exit 3', rBadJson.status === 3 && rBadJson.stderr.includes('[装载错]'), `status=${rBadJson.status}`)
    const emptyArgv = join(tmp, 'cmd-emptyargv.json'); wj(emptyArgv, { argv: [], cwd: tmp, process_pattern: 'x', dir_prefixes: [tmp] })
    const rEmpty = cli(['--cmdfile', emptyArgv, '--out', join(tmp, 'x5.jsonl')])
    add('D-1 JSON 非法 schema（argv 空数组）：exit 3', rEmpty.status === 3, `status=${rEmpty.status}`)
    const relCwd = join(tmp, 'cmd-relcwd.json'); wj(relCwd, { argv: ['true'], cwd: 'relative/dir', process_pattern: 'x', dir_prefixes: [tmp] })
    const rRel = cli(['--cmdfile', relCwd, '--out', join(tmp, 'x6.jsonl')])
    add('D-1 cwd 非绝对目录：exit 3', rRel.status === 3, `status=${rRel.status}`)
    const badRe = join(tmp, 'cmd-badre.json'); wj(badRe, { argv: [process.execPath, '-e', 'process.exit(0)'], cwd: tmp, process_pattern: '((', dir_prefixes: [tmp] })
    const badReOut = join(tmp, 'samples-badre.jsonl')
    const rBadRe = cli(['--cmdfile', badRe, '--out', badReOut])
    add('D-1d process_pattern 非法正则：exit 3 且启动前拒绝（out 未产生）', rBadRe.status === 3 && !existsSync(badReOut), `status=${rBadRe.status}`)
    const outNoDir = join(tmp, 'no-such-dir-w5b', 'samples.jsonl')
    const rOutDir = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', outNoDir])
    add('D-1d --out 目录不存在：exit 3', rOutDir.status === 3, `status=${rOutDir.status}`)
    const outIsDir = join(tmp, 'out-is-dir'); mkdirSync(outIsDir, { recursive: true })
    const rOutIsDir = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', outIsDir])
    add('D-1d --out 写失败（指向目录）：exit 3', rOutIsDir.status === 3, `status=${rOutIsDir.status}`)
    // 退出域：全部观测退出码 ∈ {0,1,3}（无 2）
    add('D-1 退出域：全部观测退出码 ∈ {0,1,3}（无 2）', [...observed].every((s) => s === 0 || s === 1 || s === 3), JSON.stringify([...observed].sort((a, b) => a - b)))
  } finally {
    try { chmodSync(tmp, 0o755) } catch { /* 已不在 */ }
    rmSync(tmp, { recursive: true, force: true })
  }
  const pass = cases.filter((c) => c.ok).length
  return { cases, pass, fail: cases.length - pass }
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main()
