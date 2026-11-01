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
// 退出码：0 成功；1 用法错/递归拒绝/触限/子命令非零/spawn 错/删除失败/残留/计数未知/**运行期写失败**；
//   3 装载错（JSON 不可读、路径/正则非法〔含 pgrep 方言〕、危险路径、**写面不可用**〔含预置硬链接〕）。
//   判据（N9）：运行期写失败=1、写面不可用=3。无 2（06 §5.8：exit 2 为派发器专用）。
// 非 shell：只执行显式 argv（execve 直传，无 shell 解释）；不清全局 /tmp；不写仓库/账本/配置。
// 主控契约裁定（返工轮 3）：
//   ① process_pattern＝spawn 前 pgrep 方言预检（pgrep 自身干跑·失败=3）＋信息字段；max_processes 与
//      residual/reaped 一律组全域计数（pgrep -g <pgid>，无 -f）——sampler/pgrep 本不在目标 detached
//      组内，非匹配组内进程不漏计。组全域口径含 zombie/D 态＝fail-closed 设计（残留保守非零即 1·R3-N6）。
//   ② /tmp 直系子路径合法：仅「路径本身＝/tmp」拒绝；最近存在祖先＝/tmp 的不存在路径放行。
//   ③ 子命令 stdout 丢弃（stdio ignore）＝既定——out JSONL 为唯一数据工件；stderr 继承（递归哨兵
//      可观测）；摘要 JSON 独占 sampler stdout。
// 写面对象同一性（返工轮 4 B1·路径侧绑定核验）：--out 以 O_NOFOLLOW|O_CREAT|O_APPEND 预开 fd 全程
//   追加（预置硬链接 nlink>1 即拒=写面不可用 3）；**每次写前路径侧核验**：lstatSync(outPath) 的
//   dev/ino 与预开 fd st0 比对（被替换/rename-and-replace→fail-closed）、ENOENT（rename 迁出/删除→
//   fail-closed）、nlink>1（后续硬链接→fail-closed）——均＝运行期写失败 1，绝不写穿/写孤儿 inode。
//   TOCTOU 残余窗口＝尽力校验、fail-closed（fd 目录句柄深化 owner=修模板批）。
// race 纪律（返工轮 4 B2）：全部 Promise.race 败方定时器 clearTimeout（interval 循环/close 5s race）；
//   backup 2s 定时器验后即清；摘要落盘后挂非 unref 的 1s 硬退出定时器兜底（任何情况必有退出码）。
// 递归哨兵：env ORG_RESOURCE_SAMPLER_DEPTH 非空即拒绝（exit 1＋[sentinel] resource-sampler rejected），
//   main 入口最前判定（运行/清理/自检三形态全拒·W-5）；子环境固定注入深度 1（嵌套调用必被拒）。
// 收割完备性（B-1）：spawn 后全程 try/finally——finally 无条件幂等 SIGKILL 整组＋await close（W-8）＋
//   终采（最终进程测量在 reaped/residual 定值之前·B3）——reaped=true 与 unknown/非零残留绝不并存；
//   异常路径先收割再按 3/1 退出；reaped 须已知零残留（W-3）；spawnErr 强制 reaped=false（RN-3）。
// 供应商事实零硬编码：不含端点/模型名；自检夹具一律落 os.tmpdir()（w5b-t3-resource-sampler-selftest-*），
//   不写技能仓。

import { readFileSync, writeFileSync, existsSync, statSync, lstatSync, mkdirSync, rmSync, readdirSync, chmodSync, realpathSync, mkdtempSync, symlinkSync, linkSync, openSync, closeSync, fstatSync, writeSync, constants as fsConstants } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'

const SELF = fileURLToPath(import.meta.url)
const DEPTH_ENV = 'ORG_RESOURCE_SAMPLER_DEPTH'
const SENTINEL = '[sentinel] resource-sampler rejected'
const DEFAULTS = { intervalMs: 5000, timeoutMs: 300000, maxIterations: 100, maxProcesses: 8, maxDirs: 20 }
// 两仓根（登记集危险路径面·D-1c·W-7 前移独立判定）：绝对路径前缀，词面与 realpath 双面命中即装载错 3
const FORBIDDEN_ROOTS = ['/home/yyx/work/aidevorg', '/home/yyx/.zcode/skills/ai-dev-org']

/** 装载错（exit 3 单源·写面不可用/路径/正则/JSON 面）。 */
export class SamplerLoadError extends Error {}
/** 运行期写失败（exit 1 单源·N9 判据：运行期写失败=1）。 */
export class SamplerWriteError extends Error {}

/** /tmp 域路径校验（B-2/W-7/契约②）：两仓根词面前移独立判定；仅「路径本身＝/tmp」拒绝；绝对、
 *  /tmp 后代、无 .. 词面、解析不越界；realpath（最近存在祖先）fail-closed（RW-1：仅 ENOENT 走
 *  不存在分支·祖先＝/tmp 放行＝直系子路径合法）；末级 symlink（含悬空）一律 realpath 复核目标域。 */
export function checkTmpPath(p, what) {
  if (typeof p !== 'string' || p.length === 0) throw new SamplerLoadError(`${what} 须为非空字符串：${String(p)}`)
  if (!p.startsWith('/')) throw new SamplerLoadError(`${what} 须为绝对路径：${p}`)
  for (const root of FORBIDDEN_ROOTS) if (p === root || p.startsWith(root + '/')) throw new SamplerLoadError(`${what} 命中禁改仓根（词面·W-7）：${p}`)
  if (p === '/tmp') throw new SamplerLoadError(`${what} 为 /tmp 自身（危险路径，禁触碰）`)
  if (p.includes('..')) throw new SamplerLoadError(`${what} 含 ..（越界形态，危险路径）：${p}`)
  if (!p.startsWith('/tmp/')) throw new SamplerLoadError(`${what} 非 /tmp 后代（危险路径）：${p}`)
  const rp = resolve(p)
  if (!rp.startsWith('/tmp/')) throw new SamplerLoadError(`${what} 解析后越界出 /tmp（危险路径）：${p} → ${rp}`)
  // B-2/RW-1：最近存在祖先 realpath——fail-closed（非 ENOENT 异常一律装载错；祖先＝/tmp 放行＝契约②）
  let probe = rp
  while (!existsSync(probe)) { const parent = dirname(probe); if (parent === probe) break; probe = parent }
  let realBase
  for (;;) {
    try { realBase = realpathSync(probe); break } catch (e) {
      if (e && e.code === 'ENOENT') { const parent = dirname(probe); if (parent === probe) { realBase = probe; break } probe = parent; continue }
      throw new SamplerLoadError(`${what} realpath 复核异常（fail-closed·RW-1）：${p}（${e.code ?? e.message}）`)
    }
  }
  for (const root of FORBIDDEN_ROOTS) if (realBase === root || realBase.startsWith(root + '/')) throw new SamplerLoadError(`${what} realpath 命中禁改仓根（中间符号链接面·B-2/W-7）：${p} → ${realBase}`)
  if (realBase !== '/tmp' && !realBase.startsWith('/tmp/')) throw new SamplerLoadError(`${what} realpath 越界出 /tmp（危险路径·中间符号链接面）：${p} → ${realBase}`)
  // 末级 symlink（含悬空）写穿面：一律 realpath 复核目标域，悬空（目标不可解析）＝fail-closed 拒 3
  let lst = null
  try { lst = lstatSync(rp) } catch (e) { if (!e || e.code !== 'ENOENT') throw new SamplerLoadError(`${what} lstat 复核异常（fail-closed）：${p}（${e?.code ?? e?.message}）`) }
  if (lst && lst.isSymbolicLink()) {
    let target
    try { target = realpathSync(rp) } catch (e) {
      throw new SamplerLoadError(`${what} 末级符号链接悬空（目标不可解析·fail-closed 拒绝写穿）：${p}（${e?.code ?? e?.message}）`)
    }
    for (const root of FORBIDDEN_ROOTS) if (target === root || target.startsWith(root + '/')) throw new SamplerLoadError(`${what} 末级符号链接目标命中禁改仓根：${p} → ${target}`)
    if (target === '/tmp' || !target.startsWith('/tmp/')) throw new SamplerLoadError(`${what} 末级符号链接目标越界出 /tmp（危险路径）：${p} → ${target}`)
  }
  return rp
}

/** pgrep 方言预检（W7/R3-N12/契约①）：spawn 前以 pgrep 自身对 process_pattern 干跑——pgrep 本体
 *  不可用（ENOENT 等）与方言非法分开报错（前者=装载错 3「pgrep 不可用」）；干跑退出域 0/1 合法。 */
export function checkPgrepDialect(pattern) {
  let r
  try { r = spawnSync('pgrep', ['-f', String(pattern)], { encoding: 'utf8' }) } catch (e) { throw new SamplerLoadError(`pgrep 不可用（方言预检无法执行·装载错）：${e.message}`) }
  if (!r || r.error) throw new SamplerLoadError(`pgrep 不可用（方言预检无法执行·装载错）：${r?.error?.message ?? 'spawn 失败'}`)
  if (r.status === 0 || r.status === 1) return
  throw new SamplerLoadError(`cmdfile.process_pattern 非法 pgrep 方言（干跑预检失败·启动前拒绝，不 spawn）：${pattern}`)
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
  checkPgrepDialect(pattern)
  if (!Array.isArray(prefixes) || prefixes.length === 0) throw new SamplerLoadError('cmdfile.dir_prefixes 须为非空数组')
  for (const p of prefixes) checkTmpPath(p, 'dir_prefixes[]')
  return { argv, cwd, pattern, prefixes }
}

/** 目录浅层计数（每前缀一层子目录；有界不递归；W-3：ENOENT=已知 0，其余错误=unknown 禁静默归零）。 */
export function countDirs(prefixes) {
  let n = 0, unknown = false
  for (const p of prefixes || []) {
    let entries
    try { entries = readdirSync(p, { withFileTypes: true }) } catch (e) {
      if (e && e.code === 'ENOENT') continue
      unknown = true; continue
    }
    for (const e of entries) if (e.isDirectory()) n++
  }
  return { n, unknown }
}

/** 进程组存活计数（契约①）：组全域 pgrep -g <pgid>（无 -f）——sampler/pgrep 本不在目标 detached
 *  组内，非匹配组内进程不漏计（含 zombie/D 态＝fail-closed 保守口径·R3-N6）；剔除采样器自身 pid
 *  （防御面）；pgrep 异常/退出码达 2 判 unknown（禁静默归零）；退出码 1 表示无匹配（已知空形态）。 */
export function countGroupProcesses(pgid) {
  let r
  try { r = spawnSync('pgrep', ['-g', String(pgid)], { encoding: 'utf8' }) } catch { return { n: 0, unknown: true } }
  if (!r || r.error || r.status === null || (r.status !== 0 && r.status !== 1)) return { n: 0, unknown: true }
  if (r.status === 1) return { n: 0, unknown: false } // 无匹配=已知空
  const selfPid = process.pid
  const n = String(r.stdout ?? '').split('\n').map((s) => Number(s.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p !== selfPid).length
  return { n, unknown: false }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** B2：可清理 sleep——Promise.race 败方定时器必须 clearTimeout（防悬挂拖长墙钟/拖住退出）。 */
const sleepT = (ms) => { let t = null; const p = new Promise((res) => { t = setTimeout(res, ms) }); return { p, clear: () => { if (t !== null) { clearTimeout(t); t = null } } } }

/** 运行形态（B-1 收割完备性）：detached 进程组、前/间隔/后采样、每采样（含前采样）即判限即杀（W-2）、
 *  spawn 后全程 try/finally——finally 无条件幂等 SIGKILL 整组＋await close（W-8·race 败方定时器清）＋
 *  终采（B3：最终进程测量在 reaped/residual 定值之前）＋复测残留；异常路径先收割再按 3/1 退出；
 *  后采写失败进返回路径（exit 1·RN-11/B4）；摘要落盘后 1s 硬退出定时器兜底（B2·非 unref）。 */
export async function runMode(cmd, outPath, limits) {
  const samples = []
  const started = Date.now()
  const closeFd = () => { try { if (fd !== null) closeSync(fd) } catch { /* 幂等 */ } }
  let fd = null, st0 = null
  try {
    fd = openSync(outPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW, 0o600)
    st0 = fstatSync(fd)
    if (st0.nlink > 1) throw new SamplerLoadError(`--out 预置硬链接（nlink=${st0.nlink}>1·fail-closed 拒绝·写面不可用）：${outPath}`)
  } catch (e) {
    closeFd()
    if (e instanceof SamplerLoadError) throw e
    throw new SamplerLoadError(`--out 写面不可用（O_NOFOLLOW|O_CREAT|O_APPEND 预开失败·含末级 symlink/ELOOP 面）：${outPath}（${e.code ?? e.message}）`)
  }
  // B1（轮 4）：每次写前路径侧绑定核验（fd 自比较死检查已删）——被替换/迁出/缺失/多硬链接一律
  // 运行期写失败（SamplerWriteError→1），绝不写穿/写孤儿 inode
  const writeSample = (rec) => {
    let stPath = null
    try { stPath = lstatSync(outPath) } catch (e) {
      throw new SamplerWriteError(`采样写出失败：${outPath} 原路径缺失（lstat ENOENT·fail-closed 不写孤儿 inode）`)
    }
    if (stPath.dev !== st0.dev || stPath.ino !== st0.ino) throw new SamplerWriteError(`采样写出失败：${outPath} 对象被替换（路径侧 dev/ino 与预开 fd 比对失败·TOCTOU fail-closed）`)
    if (stPath.nlink > 1) throw new SamplerWriteError(`采样写出失败：${outPath} 出现多硬链接（nlink=${stPath.nlink}>1·fail-closed）`)
    try { writeSync(fd, JSON.stringify(rec) + '\n') } catch (e) { throw new SamplerWriteError(`采样写出失败：${outPath}（${e.code ?? e.message}）`) }
  }

  // detached：子进程为新进程组/会话首（pgid=pid），整组收割用 kill(-pgid, 'SIGKILL')
  let child
  try {
    child = spawn(cmd.argv[0], cmd.argv.slice(1), {
      cwd: cmd.cwd, detached: true, stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, [DEPTH_ENV]: '1' }, // 子环境固定深度 1：嵌套调用必被哨兵拒绝
    })
  } catch (e) {
    closeFd()
    console.log(JSON.stringify({ mode: 'run', pid: null, samples: 0, child_exit: null, timeout: false, reaped: false, peak_processes: 0, peak_dirs: 0, limit_hit: false, limit_reason: null, residual_processes: 0, unknown_counts: true, process_pattern: cmd.pattern, error: null, spawn_error: String(e.message) }))
    return 1
  }
  const pgid = child.pid
  let exited = false, exitCode = null, exitSignal = null, spawnErr = null
  child.once('error', (e) => { spawnErr = e; exited = true }) // spawn 失败（如 ENOENT）立即退环，无悬挂
  child.once('exit', (code, signal) => { exited = true; exitCode = code; exitSignal = signal })
  const closeP = new Promise((res) => child.once('close', res)) // W-8：close 监听（await close 语义）
  const exitedP = new Promise((res) => { child.once('close', res); child.once('exit', res) }) // N-5：exit/close 事件打断 interval sleep

  let limitHit = false, limitReason = null
  let peakP = 0, peakD = 0, unknownCounts = false
  let iteration = 0
  let residual = 0, reaped = false, runErr = null, postWriteErr = null
  const doSample = () => {
    const elapsed = Date.now() - started
    const pc = countGroupProcesses(pgid)
    const dc = countDirs(cmd.prefixes)
    if (pc.unknown || dc.unknown) unknownCounts = true
    peakP = Math.max(peakP, pc.n); peakD = Math.max(peakD, dc.n)
    const rec = { ts: new Date().toISOString(), pid: pgid, iteration, elapsed_ms: elapsed, processes: pc.n, dirs: dc.n, limit_hit: limitHit }
    if (pc.unknown || dc.unknown) rec.count_unknown = true
    writeSample(rec)
    samples.push(rec) // RN-11/B4：仅成功落盘条数计入 samples
    return rec
  }
  // W-2：每次采样（含前采样）后即判限，触限即杀——timeout/迭代/进程/目录四限同口径
  const judge = (rec) => {
    if (Date.now() - started >= limits.timeoutMs) return 'timeout'
    if (iteration >= limits.maxIterations) return 'max_iterations'
    if (rec.processes > limits.maxProcesses) return 'max_processes'
    if (rec.dirs > limits.maxDirs) return 'max_dirs'
    return null
  }
  try {
    const first = doSample() // 前采样（iteration===0）
    const r0 = judge(first)
    if (r0) { limitHit = true; limitReason = r0 }
    while (!limitHit) {
      if (exited) break
      const remaining = limits.timeoutMs - (Date.now() - started)
      if (remaining <= 0) { limitHit = true; limitReason = 'timeout'; break }
      const sT = sleepT(Math.max(1, Math.min(limits.intervalMs, remaining)))
      try { await Promise.race([sT.p, exitedP]) } finally { sT.clear() } // B2：race 败方定时器必清
      if (exited || limitHit) break
      iteration += 1
      const r = judge(doSample())
      if (r) { limitHit = true; limitReason = r }
    }
  } catch (e) { runErr = e; throw e } finally {
    // B-1：无条件兜底收割（幂等·覆盖正常退出留孙/触限/异常全路径）＋await close（W-8·race 败方定时器清）
    if (pgid) {
      try { process.kill(-pgid, 'SIGKILL') } catch { /* 组已消亡·幂等 */ }
      try { child.kill('SIGKILL') } catch { /* 已退出·幂等 */ }
      const backup = setTimeout(() => { try { process.kill(-pgid, 'SIGKILL') } catch { /* 幂等 */ } try { child.kill('SIGKILL') } catch { /* 幂等 */ } }, 2000)
      const cT = sleepT(5000)
      try { await Promise.race([closeP, cT.p]) } finally { cT.clear() } // B2：race 败方定时器必清
      clearTimeout(backup)
      await sleep(150) // SIGKILL 生效余量
    }
    try { doSample() } catch (e) { postWriteErr = e } // 后采（B3：先采样后终采·写失败不覆盖原异常）
    if (pgid) {
      // B3：终采——最终进程测量在 reaped/residual 定值之前，reaped=true 与 unknown/非零残留绝不并存
      const cnt = countGroupProcesses(pgid)
      residual = cnt.n
      if (cnt.unknown) unknownCounts = true
    }
    reaped = exited === true && spawnErr === null && residual === 0 && unknownCounts === false // W-3/RN-3
    try {
      console.log(JSON.stringify({
        mode: 'run', out: outPath, pid: pgid ?? null, samples: samples.length,
        child_exit: exitCode, child_signal: exitSignal, timeout: limitReason === 'timeout', reaped,
        peak_processes: peakP, peak_dirs: peakD, limit_hit: limitHit, limit_reason: limitReason,
        residual_processes: residual, unknown_counts: unknownCounts, process_pattern: cmd.pattern,
        error: runErr ? String(runErr.message) : (postWriteErr ? String(postWriteErr.message) : null),
        spawn_error: spawnErr ? String(spawnErr.message) : null,
      }))
    } catch { /* 摘要打印失败不吞退出码 */ }
    closeFd()
    // B2：硬退出兜底（非 unref·任何情况必有退出码；自然退出通常先于此发生）
    setTimeout(() => { try { process.exit(typeof process.exitCode === 'number' ? process.exitCode : 1) } catch { /* 兜底 */ } }, 1000)
  }
  if (runErr) throw runErr // 先收割再按 3/1 退出（main catch 映射：装载错 3/运行期写失败 1）
  checkTmpPath(outPath, '--out（写入后同一性复核·B-2）')
  if (postWriteErr) return 1 // RN-11/B4：后采写失败进返回路径
  if (spawnErr) return 1
  if (limitHit) return 1
  if (exitCode !== 0) return 1 // 含 null（信号终止）
  if (!reaped) return 1
  return 0
}

/** registry 装载与校验（先校验全部路径＋登记既有对象 dev/ino 基准，再逐路径删除）。 */
export function loadRegistry(regPath) {
  let raw
  try { raw = readFileSync(regPath, 'utf8') } catch (e) { throw new SamplerLoadError(`registry 不可读：${regPath}（${e.message}）`) }
  let doc
  try { doc = JSON.parse(raw) } catch (e) { throw new SamplerLoadError(`registry JSON 不可解析：${regPath}（${e.message}）`) }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.paths)) throw new SamplerLoadError('registry 须为 {paths:[绝对路径...]}')
  const resolved = []
  const ids = []
  for (const p of doc.paths) {
    const rp = checkTmpPath(p, 'registry.paths[]')
    let id = null
    try { const st = lstatSync(rp); id = `${st.dev}:${st.ino}` } catch (e) { if (!e || e.code !== 'ENOENT') throw new SamplerLoadError(`registry.paths[] lstat 异常（fail-closed）：${p}（${e?.code ?? e?.message}）`) }
    resolved.push(rp); ids.push(id)
  }
  return { paths: doc.paths, resolved, ids }
}

/** 清理形态：仅删登记集（逐路径 lstat/删除前 realpath＋dev/ino 同一性比对（B-2·TOCTOU fail-closed）/
 *  删除/复核（W-9：仅 ENOENT=已知零·其余异常=未知非零退出）），输出 registered/existed/deleted/residual。 */
export function cleanupMode(reg) {
  const detail = []
  let existed = 0, deleted = 0, residual = 0, failed = false, residualUnknown = false
  for (let i = 0; i < reg.paths.length; i++) {
    const p = reg.paths[i], rp = reg.resolved[i], id0 = reg.ids[i]
    let isExist = false, isDeleted = false, isResidual = false, error = null
    try {
      const st = lstatSync(rp); isExist = true
      if (id0 !== null && `${st.dev}:${st.ino}` !== id0) throw new SamplerLoadError(`registry.paths[${i}] 删除前对象同一性漂移（dev/ino 与装载期比对失败·TOCTOU fail-closed）：${p}`)
      checkTmpPath(p, `registry.paths[${i}]（删除前同一性复核·B-2）`)
      rmSync(rp, { recursive: true, force: false })
      isDeleted = true
    } catch (e) {
      if (e instanceof SamplerLoadError) { console.error(`[装载错] ${e.message}`); return 3 }
      if (e.code === 'ENOENT') { /* 未存在：existed=false 如实登记 */ } else { error = `${e.code ?? ''} ${e.message}`; failed = true }
    }
    try { lstatSync(rp); isResidual = true } catch (e) {
      if (!e || e.code !== 'ENOENT') { residualUnknown = true; failed = true; error = error ?? `残留复核异常（W-9 fail-closed）：${e?.code ?? e?.message}` } // 已消失=已知零；其余=未知
    }
    if (isExist) existed++
    if (isDeleted) deleted++
    if (isResidual) residual++
    detail.push({ path: p, existed: isExist, deleted: isDeleted, residual: isResidual, error })
  }
  console.log(JSON.stringify({ mode: 'cleanup', registered: reg.paths.length, existed, deleted, residual, failed, residual_unknown: residualUnknown, paths: detail }))
  return failed || residual > 0 || residualUnknown ? 1 : 0
}

// ── CLI 解析（W-6/RN-15/W8：严格空格分隔白名单旗标；等号/未知/额外/缺值/旗标形值（值以 -- 起头）
//    ＝usage 1；互斥在分支前判定） ──
export function parseArgs(argv) {
  const out = { selfTest: false, cleanup: false, cmdfile: null, out: null, registry: null, intervalMs: null, timeoutMs: null, maxIterations: null, maxProcesses: null, maxDirs: null }
  const takeVal = (k) => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) return usageExit(); out[k] = v }
  let i = 0
  for (; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--self-test') out.selfTest = true
    else if (a === '--cleanup') out.cleanup = true
    else if (a === '--cmdfile') takeVal('cmdfile')
    else if (a === '--out') takeVal('out')
    else if (a === '--registry') takeVal('registry')
    else if (a === '--interval-ms') takeVal('intervalMs')
    else if (a === '--timeout-ms') takeVal('timeoutMs')
    else if (a === '--max-iterations') takeVal('maxIterations')
    else if (a === '--max-processes') takeVal('maxProcesses')
    else if (a === '--max-dirs') takeVal('maxDirs')
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

const LIMIT_KEYS = ['intervalMs', 'timeoutMs', 'maxIterations', 'maxProcesses', 'maxDirs']
const VALUED_FLAGS = { '--cmdfile': 'cmdfile', '--out': 'out', '--registry': 'registry', '--interval-ms': 'intervalMs', '--timeout-ms': 'timeoutMs', '--max-iterations': 'maxIterations', '--max-processes': 'maxProcesses', '--max-dirs': 'maxDirs' }

function main() {
  // W-5：递归哨兵置于 main 最前——运行/清理/自检三形态一律先拒，启动面零 spawn
  if (process.env[DEPTH_ENV]) { console.error(SENTINEL); process.exit(1) }
  const args = parseArgs(process.argv.slice(2))
  // W-6：三形态互斥与旗标白名单先于分支——--self-test 须独占；cleanup 禁 run 旗标与限值旗标
  if (args.selfTest && process.argv.slice(2).length !== 1) { usage(); process.exit(1) }
  if (args.cleanup && (args.cmdfile !== null || args.out !== null || LIMIT_KEYS.some((k) => args[k] !== null))) { usage(); process.exit(1) }
  if (!args.cleanup && args.registry !== null) { usage(); process.exit(1) }
  if (args.cleanup && args.registry === null) { usage(); process.exit(1) }
  if (!args.cleanup && !args.selfTest && (args.cmdfile === null || args.out === null)) { usage(); process.exit(1) }
  if (args.selfTest) {
    const { cases, pass, fail } = selfTest()
    for (const c of cases) if (!c.ok) console.log(`[self-test] FAIL ${c.name}${c.detail ? `（${c.detail}）` : ''}`)
    if (fail === 0) console.log(`self-test 全过（${cases.length} 向量）`)
    else console.log(`[self-test] FAIL ×${fail}`)
    process.exitCode = fail === 0 ? 0 : 1 // RN-12：自然退出防管道截断
    return
  }
  const limits = { ...DEFAULTS }
  for (const k of LIMIT_KEYS) {
    if (args[k] !== null) {
      const n = Number(args[k])
      if (!Number.isInteger(n) || n <= 0) { usage(); process.exit(1) }
      limits[k] = n
    }
  }
  if (args.cleanup) {
    try { process.exitCode = cleanupMode(loadRegistry(args.registry)); return } catch (e) {
      if (e instanceof SamplerLoadError) { console.error(`[装载错] ${e.message}`); process.exit(3) }
      console.error(`[运行错] ${e.message}`); process.exit(1)
    }
  }
  let cmd
  try {
    cmd = loadCommand(args.cmdfile)
    checkTmpPath(args.out, '--out') // B-2：--out 复用同一校验（含 realpath/末级 symlink 复核）
    if (existsSync(args.out) && statSync(args.out).isDirectory()) throw new SamplerLoadError(`--out 指向目录（写失败面）：${args.out}`)
  } catch (e) {
    console.error(`[装载错] ${e.message}`); process.exit(3)
  }
  runMode(cmd, args.out, limits)
    .then((code) => { process.exitCode = code }) // RN-12：自然退出防管道截断
    .catch((e) => { console.error(`[${e instanceof SamplerLoadError ? '装载错' : '运行错'}] ${e.message}`); process.exitCode = e instanceof SamplerLoadError ? 3 : 1 })
}

// ── 自检（≥16 向量·返工轮 4 扩面覆盖 B1 路径侧绑定核验/B2 race 纪律/B3 如实更正/W4/W5/N 项；
//    夹具落 os.tmpdir() 前缀 w5b-t3-resource-sampler-selftest-*，随验清理） ──
function selfTest() {
  const cases = []
  const add = (name, ok, detail = '') => cases.push({ name, ok: !!ok, detail })
  const observed = new Set()
  const tmp = mkdtempSync(join(tmpdir(), 'w5b-t3-resource-sampler-selftest-'))
  const envClean = () => { const e = { ...process.env }; delete e[DEPTH_ENV]; return e }
  const safe = (fn, d = false) => { try { return fn() } catch { return d } } // R3-N15：断言内 IO 一律预取包裹
  const cli = (args, opts = {}) => {
    const env = opts.depth ? { ...envClean(), [DEPTH_ENV]: '1' } : (opts.pathBroken ? { ...envClean(), PATH: '/nonexistent-w5b-t3-path' } : envClean())
    const r = spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env })
    observed.add(r.status)
    return r
  }
  const json = (r) => { try { return JSON.parse(r.stdout) } catch { return null } }
  const wj = (p, o) => { writeFileSync(p, JSON.stringify(o), 'utf8') }
  // 契约①：process_pattern＝pgrep 方言预检＋信息字段；计数一律组全域（pgrep -g 无 -f）
  const simpleCmd = (argv, prefix, pattern = 'node|sh|sleep') => { const p = join(tmp, `cmd-${prefix}.json`); wj(p, { argv, cwd: tmp, process_pattern: pattern, dir_prefixes: [tmp] }); return p }
  const runCase = (prefix, argv, extra = [], dirPrefix = null, pattern = 'node|sh|sleep') => {
    const outF = join(tmp, `samples-${prefix}.jsonl`)
    let cmdF
    if (dirPrefix) { cmdF = join(tmp, `cmd-${prefix}.json`); wj(cmdF, { argv, cwd: tmp, process_pattern: pattern, dir_prefixes: [dirPrefix] }) }
    else cmdF = simpleCmd(argv, prefix, pattern)
    const r = cli(['--cmdfile', cmdF, '--out', outF, ...extra])
    return { r, outF, cmdF, s: json(r) }
  }
  try {
    // V-1 正例：exit 0、child_exit 0、limit_hit=false、reaped=true
    const v1 = runCase('ok', [process.execPath, '-e', 'process.exit(0)'])
    add('V-1 正例：exit 0 且 child_exit=0/limit_hit=false/reaped=true/limit_reason=null',
      v1.r.status === 0 && v1.s && v1.s.child_exit === 0 && v1.s.limit_hit === false && v1.s.reaped === true && v1.s.limit_reason === null && v1.s.timeout === false,
      `status=${v1.r.status} out=${v1.r.stdout.slice(0, 200)}`)
    // JSONL 结构＋N-13 样本计数口径：逐样本七字段、summary.samples===落盘条数
    let jsonlOk = false, jsonlDetail = ''
    try {
      const lines = readFileSync(v1.outF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      jsonlOk = lines.length >= 2 && lines.every((l) => ['ts', 'pid', 'iteration', 'elapsed_ms', 'processes', 'dirs', 'limit_hit'].every((k) => k in l))
        && v1.s && v1.s.samples === lines.length
      jsonlDetail = `lines=${lines.length} summary=${v1.s?.samples}`
    } catch (e) { jsonlDetail = e.message }
    add('V-1 JSONL 结构＋N-13 计数口径：≥2 样本逐样本含 ts/pid/iteration/elapsed_ms/processes/dirs/limit_hit 且 summary.samples===成功落盘条数', jsonlOk, jsonlDetail)
    // B2 墙钟上限：长 interval＋快退子进程 → 总时长 < interval（race 败方定时器悬挂即红）
    const wall0 = Date.now()
    const wall = runCase('wall', [process.execPath, '-e', 'process.exit(0)'], ['--interval-ms', '8000'])
    const wallMs = Date.now() - wall0
    add('B2 墙钟上限：长 interval（8s）＋快退子进程 → 总时长 < interval（race 败方定时器悬挂/硬退出兜底缺失即红）',
      wall.r.status === 0 && wallMs < 8000, `status=${wall.r.status} wall_ms=${wallMs}`)
    // 递归哨兵直跑：DEPTH=1 → exit 1＋固定哨兵＋不 spawn（out 未产生）
    const gOut = join(tmp, 'samples-guard.jsonl')
    const gCmd = simpleCmd([process.execPath, '-e', 'process.exit(0)'], 'guard')
    const g = cli(['--cmdfile', gCmd, '--out', gOut], { depth: true })
    add('D-1a 递归哨兵直跑：DEPTH=1 → exit 1＋[sentinel] resource-sampler rejected＋out 未产生（启动前拒绝不 spawn）',
      g.status === 1 && g.stderr.includes(SENTINEL) && !existsSync(gOut), `status=${g.status} err=${g.stderr.slice(0, 120)}`)
    // W-5：哨兵对 cleanup/self-test 形态同样前置拒绝（main 最前）＋B3 更正：哨兵实体先建＋存活断言
    const xTxt = join(tmp, 'x.txt'); writeFileSync(xTxt, 'X-ENTITY') // RN-5 如实更正：补建实体
    const regD = join(tmp, 'registry-depth.json'); wj(regD, { paths: [xTxt] })
    const cD = cli(['--cleanup', '--registry', regD], { depth: true })
    const sD = cli(['--self-test'], { depth: true })
    const xOk = safe(() => existsSync(xTxt) && readFileSync(xTxt, 'utf8') === 'X-ENTITY')
    add('W-5 递归哨兵三形态前置：cleanup 与 self-test 携 DEPTH=1 均 exit 1＋固定哨兵（登记实体存活·不删任何件/不跑自检）',
      cD.status === 1 && cD.stderr.includes(SENTINEL) && sD.status === 1 && sD.stderr.includes(SENTINEL) && !sD.stdout.includes('self-test') && xOk,
      `cleanup=${cD.status} selftest=${sD.status} entity=${xOk}`)
    // 递归嵌套：父 sampler 的子环境固定深度 1 → 内层被拒（哨兵经 stderr 继承可观测）
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
    add('V-2 组收割：触限后 peak_processes≥3（sh＋两孙·组全域计数）且终值残留 0（SIGKILL 整组）',
      v2.s && v2.s.peak_processes >= 3 && v2.s.residual_processes === 0, `peak=${v2.s?.peak_processes} residual=${v2.s?.residual_processes}`)
    // V-2 spawn error：exit 1、reaped=false（RN-3）、无悬挂
    const v2e = runCase('spawnerr', ['/nonexistent-w5b-t3-binary-xyz'])
    add('V-2 spawn error：目标不存在 → exit 1、spawn_error 非空、reaped=false（RN-3·pid=null）、timeout=false、无悬挂',
      v2e.r.status === 1 && v2e.s && v2e.s.spawn_error !== null && v2e.s.timeout === false && v2e.s.reaped === false && v2e.s.pid === null,
      `status=${v2e.r.status} out=${v2e.r.stdout.slice(0, 240)}`)
    // V-2 子非零：exit 1
    const v2nz = runCase('nonzero', [process.execPath, '-e', 'process.exit(3)'])
    add('V-2 子非零：child_exit=3 → exit 1 无悬挂', v2nz.r.status === 1 && v2nz.s && v2nz.s.child_exit === 3, `status=${v2nz.r.status}`)
    // B-1 正常退出留孙进程：child exit 0 后同组孙进程由 finally 兜底收割。CLI 以 stdio ignore 运行
    //（阻断 grandchild 继承 stderr 管道拖住 spawnSync 的时序吞没）；RN-4：先经 JSONL 观测孙进程在场
    //（逐样本 processes≥2）再断言外部 pgrep 哨兵零残留
    const b1Out = join(tmp, 'samples-orphan.jsonl')
    const b1Cmd = join(tmp, 'cmd-orphan.json')
    wj(b1Cmd, { argv: ['sh', '-c', 'node -e "/*ORPHANMARK*/setTimeout(()=>{},5000)" & exit 0'], cwd: tmp, process_pattern: 'node|sh|sleep', dir_prefixes: [tmp] })
    const b1 = spawnSync(process.execPath, [SELF, '--cmdfile', b1Cmd, '--out', b1Out, '--interval-ms', '100'], { encoding: 'utf8', stdio: 'ignore', timeout: 60000, killSignal: 'SIGKILL', env: envClean() })
    observed.add(b1.status)
    const b1Stray = spawnSync('pgrep', ['-f', 'ORPHANMARK'], { encoding: 'utf8' })
    const b1Seen = safe(() => readFileSync(b1Out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).some((r) => r.processes >= 2))
    add('B-1 收割完备性·正常退出留孙：JSONL 先观测孙进程在场（RN-4·逐样本 processes≥2）→ child exit 0 后孙进程被 finally 幂等 SIGKILL 兜底 → exit 0/samples 落盘且外部 pgrep 哨兵零残留',
      b1.status === 0 && existsSync(b1Out) && b1Seen && b1Stray.status === 1,
      `status=${b1.status} seen=${b1Seen} stray=${b1Stray.status} out=${JSON.stringify(b1Stray.stdout).slice(0, 80)}`)
    // W5/yyx R3-5 组全域判别：pattern 绝不匹配子进程 cmdline＋同组多进程 → peak/触限/收割不受 pattern 影响（旧 -f 实现下必红）
    const gw = runCase('groupwide', ['sh', '-c', 'sleep 2 & sleep 2 & wait'], ['--interval-ms', '100', '--max-processes', '1'], null, 'ZZZ-W5B-T3-NOMATCH')
    add('W5/yyx R3-5 组全域判别：pattern 绝不匹配子进程 cmdline＋同组三进程 → 仍 peak=3/触限 max_processes/零残留（旧 -f 实现下必红）',
      gw.r.status === 1 && gw.s && gw.s.limit_reason === 'max_processes' && gw.s.peak_processes === 3 && gw.s.residual_processes === 0,
      `status=${gw.r.status} out=${gw.r.stdout.slice(0, 240)}`)
    // B1 向量组（写面对象同一性·路径侧绑定核验）：rename 迁出/rename-and-replace/原路径缺失 → 运行期写失败 exit 1
    const mkW = (prefix, childScript) => {
      const wDir = join(tmp, `w-${prefix}`); mkdirSync(wDir, { recursive: true })
      const wOut = join(wDir, 's.jsonl')
      const wCmd = join(tmp, `cmd-${prefix}.json`)
      wj(wCmd, { argv: ['sh', '-c', childScript(wOut, wDir)], cwd: tmp, process_pattern: 'node|sh|sleep', dir_prefixes: [tmp] })
      const r = cli(['--cmdfile', wCmd, '--out', wOut, '--interval-ms', '100'])
      return { r, s: json(r), wOut, wDir }
    }
    const wMv = mkW('mv', (o) => `sleep 0.05; mv '${o}' '${o}.moved'; sleep 1`)
    add('B1 写面对象同一性·rename 迁出：out 被 mv 走 → 路径侧 lstat ENOENT fail-closed → 运行期写失败 exit 1/零残留（不写孤儿 inode）',
      wMv.r.status === 1 && wMv.s && String(wMv.s.error ?? '').includes('采样写出失败') && wMv.s.residual_processes === 0,
      `status=${wMv.r.status} out=${wMv.r.stdout.slice(0, 200)}`)
    const victimRr = join(tmp, 'rr-victim.txt'); writeFileSync(victimRr, 'RR-OTHER')
    const wRr = mkW('rr', (o) => `sleep 0.05; mv '${victimRr}' '${o}'; sleep 1`)
    const rrOk = safe(() => !existsSync(victimRr) && readFileSync(wRr.wOut, 'utf8') === 'RR-OTHER') // 顶替后的新件（原 victimRr inode）原样未被写穿
    add('B1 写面对象同一性·rename-and-replace：他件 rename 顶替 out 路径 → 路径侧 dev/ino 比对 fail-closed → exit 1 且顶替件（原 inode）原样未被写穿',
      wRr.r.status === 1 && wRr.s && String(wRr.s.error ?? '').includes('采样写出失败') && rrOk,
      `status=${wRr.r.status} out=${wRr.r.stdout.slice(0, 200)} other=${rrOk}`)
    const wRm = mkW('rm', (o) => `sleep 0.05; rm -f '${o}'; sleep 1`)
    add('B1 写面对象同一性·原路径缺失：out 被删 → 路径侧 lstat ENOENT fail-closed → 运行期写失败 exit 1/零残留',
      wRm.r.status === 1 && wRm.s && String(wRm.s.error ?? '').includes('采样写出失败') && wRm.s.residual_processes === 0,
      `status=${wRm.r.status} out=${wRm.r.stdout.slice(0, 200)}`)
    // B1 写面不可用（=3）：--out 预置硬链接（nlink>1）即拒
    const hlVictim = join(tmp, 'hl-victim.txt'); writeFileSync(hlVictim, 'HL-VICTIM')
    const hlOut = join(tmp, 'hl-out.jsonl')
    try { linkSync(hlVictim, hlOut) } catch { /* 已存在 */ }
    const rHl = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', hlOut])
    const hlOk = safe(() => readFileSync(hlVictim, 'utf8') === 'HL-VICTIM')
    add('B1 写面对象同一性·硬链接预置：nlink>1 即拒（写面不可用 exit 3）且目标件原样未被写',
      rHl.status === 3 && rHl.stderr.includes('硬链接') && hlOk, `status=${rHl.status} err=${rHl.stderr.slice(0, 140)} victim=${hlOk}`)
    // B-1 writeSample 失败（目录级）：out 父目录运行中被删 → 先兜底收割（零残留）再运行期写失败 exit 1（N9）
    const wfDir = join(tmp, 'wf-dir'); mkdirSync(wfDir, { recursive: true })
    const wfCmd = join(tmp, 'cmd-wf.json')
    wj(wfCmd, { argv: ['sh', '-c', `rm -rf '${wfDir}' && sleep 2`], cwd: tmp, process_pattern: 'node|sh|sleep', dir_prefixes: [tmp] })
    const wf = cli(['--cmdfile', wfCmd, '--out', join(wfDir, 's.jsonl'), '--interval-ms', '100'])
    add('B-1 收割完备性·writeSample 失败：out 父目录运行中被删 → 采样写出失败（运行期写失败 exit 1·N9）且 finally 先兜底收割零残留',
      wf.status === 1 && (String(wf.stdout + wf.stderr).includes('采样写出失败')) && json(wf)?.residual_processes === 0,
      `status=${wf.status} err=${wf.stderr.slice(0, 120)} out=${wf.stdout.slice(0, 160)}`)
    // V-3 三限红队：每次只缩一限＋未触限对照（W-2：前采样即判限·RN-8 断言 iteration===0）
    const v3i = runCase('iter', [process.execPath, '-e', 'setTimeout(()=>{},1500)'], ['--interval-ms', '100', '--max-iterations', '2'])
    add('V-3 max_iterations：只缩迭代限 → exit 1/limit_reason=max_iterations/timeout=false', v3i.r.status === 1 && v3i.s && v3i.s.limit_reason === 'max_iterations' && v3i.s.timeout === false, `status=${v3i.r.status} out=${v3i.r.stdout.slice(0, 200)}`)
    const v3iCtl = runCase('iter-ctl', [process.execPath, '-e', 'setTimeout(()=>{},600)'], ['--interval-ms', '100'])
    add('V-3 max_iterations 对照：未触限（缺省 100）→ exit 0/limit_hit=false', v3iCtl.r.status === 0 && v3iCtl.s && v3iCtl.s.limit_hit === false && v3iCtl.s.limit_reason === null, `status=${v3iCtl.r.status}`)
    const v3p = runCase('proc', ['sh', '-c', 'sleep 2 & sleep 2 & wait'], ['--interval-ms', '100', '--max-processes', '1'])
    add('V-3 max_processes：只缩进程限 → exit 1/limit_reason=max_processes/零残留（W-2：每采样即判限即杀）', v3p.r.status === 1 && v3p.s && v3p.s.limit_reason === 'max_processes' && v3p.s.residual_processes === 0 && v3p.s.samples >= 1, `status=${v3p.r.status} out=${v3p.r.stdout.slice(0, 200)}`)
    const v3pCtl = runCase('proc-ctl', ['sh', '-c', 'sleep 2 & sleep 2 & wait'], ['--interval-ms', '100'])
    add('V-3 max_processes 对照：缺省 8 未触限 → exit 0 且组全域计数排除采样器/pgrep 面（peak=3：sh＋两子·契约①无 -f）', v3pCtl.r.status === 0 && v3pCtl.s && v3pCtl.s.limit_hit === false && v3pCtl.s.peak_processes === 3, `status=${v3pCtl.r.status} peak=${v3pCtl.s?.peak_processes}`)
    const dPrefix = join(tmp, 'dirs-work')
    mkdirSync(dPrefix, { recursive: true })
    const v3d = runCase('dirs', [process.execPath, '-e', `const fs=require('fs');const b=process.argv[1];fs.mkdirSync(b+'/d1');fs.mkdirSync(b+'/d2');setTimeout(()=>{},800)`, dPrefix], ['--interval-ms', '100', '--max-dirs', '1'], dPrefix)
    add('V-3 max_dirs：只缩目录限 → exit 1/limit_reason=max_dirs', v3d.r.status === 1 && v3d.s && v3d.s.limit_reason === 'max_dirs' && v3d.s.peak_dirs >= 2, `status=${v3d.r.status} out=${v3d.r.stdout.slice(0, 200)}`)
    const v3dCtl = runCase('dirs-ctl', [process.execPath, '-e', `const fs=require('fs');const b=process.argv[1];fs.mkdirSync(b+'/c1');setTimeout(()=>{},400)`, dPrefix], ['--interval-ms', '100'], dPrefix)
    add('V-3 max_dirs 对照：未触限（缺省 20）→ exit 0/limit_hit=false', v3dCtl.r.status === 0 && v3dCtl.s && v3dCtl.s.limit_hit === false && v3dCtl.s.limit_reason === null, `status=${v3dCtl.r.status} peak_dirs=${v3dCtl.s?.peak_dirs}`)
    // RN-8：前采样判限（spawn 前目录已在场 → iteration===0 的样本即触限）
    const prePrefix = join(tmp, 'dirs-pre'); mkdirSync(join(prePrefix, 'p1'), { recursive: true }); mkdirSync(join(prePrefix, 'p2'), { recursive: true })
    const rn8 = runCase('rn8', [process.execPath, '-e', 'setTimeout(()=>{},600)', prePrefix], ['--interval-ms', '100', '--max-dirs', '1'], prePrefix)
    let rn8Ok = false
    try { rn8Ok = rn8.r.status === 1 && rn8.s?.limit_reason === 'max_dirs' && readFileSync(rn8.outF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).every((r) => r.iteration === 0) } catch { rn8Ok = false }
    add('RN-8/W-2 前采样判限：spawn 前目录已在场 → 前/后样本 iteration===0 即触限即杀（无间隔迭代样本）',
      rn8Ok, `status=${rn8.r.status} out=${rn8.r.stdout.slice(0, 200)}`)
    // V-4 登记集清理：成功＋集外哨兵原样（内容不变）
    const cDir = join(tmp, 'cleanup-work')
    mkdirSync(cDir, { recursive: true })
    const f1 = join(cDir, 'a.txt'), f2 = join(cDir, 'b.txt'), sentry = join(cDir, 'sentry.txt')
    writeFileSync(f1, 'a'); writeFileSync(f2, 'b'); writeFileSync(sentry, 'SENTINEL-CONTENT')
    const regP = join(tmp, 'registry-ok.json')
    wj(regP, { paths: [f1, f2] })
    const cOk = cli(['--cleanup', '--registry', regP])
    const cOkS = json(cOk)
    const sentryOk = safe(() => existsSync(sentry) && readFileSync(sentry, 'utf8') === 'SENTINEL-CONTENT')
    add('V-4 登记集清理成功：exit 0/deleted=2/residual=0/逐路径 existed+deleted 如实/集外哨兵原样未触',
      cOk.status === 0 && cOkS && cOkS.registered === 2 && cOkS.existed === 2 && cOkS.deleted === 2 && cOkS.residual === 0
      && cOkS.paths.every((p) => p.existed && p.deleted && !p.residual) && sentryOk,
      `status=${cOk.status} out=${cOk.stdout.slice(0, 240)} sentry=${sentryOk}`)
    // 契约②/W4：/tmp 直系子路径合法——沙箱内唯一名（禁固定全局名·防删他人件），不存在直系路径登记清理 exit 0
    const directP = `/tmp/w5b-t3-direct-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const regDirect = join(tmp, 'registry-direct.json'); wj(regDirect, { paths: [directP] })
    const cDirect = cli(['--cleanup', '--registry', regDirect])
    const cDirectS = json(cDirect)
    add('契约②/W4 /tmp 直系子路径合法：沙箱唯一名不存在直系路径经登记清理 → exit 0/registered=1/existed=0/deleted=0（最近存在祖先＝/tmp 放行）',
      cDirect.status === 0 && cDirectS && cDirectS.registered === 1 && cDirectS.existed === 0 && cDirectS.deleted === 0,
      `status=${cDirect.status} out=${cDirect.stdout.slice(0, 200)}`)
    // V-4/W-9 危险路径四面＋集外哨兵可观测（sentinel 先建后跑·exit 3 且既有集外件原样不删任何件）
    const danger = (label, paths) => {
      const dDir = join(tmp, `danger-${label}`); mkdirSync(dDir, { recursive: true })
      const keep = join(dDir, 'keep.txt'); writeFileSync(keep, 'KEEP') // RN-5/RN-6：哨兵先建后跑
      const rp = join(tmp, `registry-${label}.json`); wj(rp, { paths })
      const r = cli(['--cleanup', '--registry', rp])
      const keepOk = safe(() => existsSync(keep) && readFileSync(keep, 'utf8') === 'KEEP')
      add(`V-4 危险路径 ${label}：exit 3（装载错）且 W-9 可观测——集外件原样不删任何件`,
        r.status === 3 && r.stderr.includes('[装载错]') && keepOk, `status=${r.status} err=${r.stderr.slice(0, 120)}`)
    }
    danger('tmp-self', ['/tmp'])
    danger('non-tmp', ['/home/yyx/w5b-t3-nonexistent'])
    danger('escape', ['/tmp/../home/yyx/w5b-t3-nonexistent'])
    // W-10/RW-5 仓根向量拆分：每仓根×每面独立 cli 调用各自断言（词面真值为独立字面量·不自引代码常量）
    danger('repo-root-a-lexical', ['/home/yyx/work/aidevorg/docs/w5b-t3-nonexistent.md'])
    danger('repo-root-b-lexical', ['/home/yyx/.zcode/skills/ai-dev-org/w5b-t3-nonexistent.mjs'])
    const keepA = join(tmp, 'keep-a.txt'); writeFileSync(keepA, 'KA')
    const keepB = join(tmp, 'keep-b.txt'); writeFileSync(keepB, 'KB')
    const linkA = join(tmp, 'link-into-aidevorg'), linkB = join(tmp, 'link-into-skillrepo')
    try { symlinkSync('/home/yyx/work/aidevorg', linkA) } catch { /* 已存在 */ }
    try { symlinkSync('/home/yyx/.zcode/skills/ai-dev-org', linkB) } catch { /* 已存在 */ }
    const regLinkA = join(tmp, 'registry-link-a.json'); wj(regLinkA, { paths: [join(linkA, 'docs', 'x.md')] })
    const regLinkB = join(tmp, 'registry-link-b.json'); wj(regLinkB, { paths: [join(linkB, 'x.mjs')] })
    const rLinkA = cli(['--cleanup', '--registry', regLinkA])
    const rLinkB = cli(['--cleanup', '--registry', regLinkB])
    const keepAOk = safe(() => existsSync(keepA) && readFileSync(keepA, 'utf8') === 'KA')
    const keepBOk = safe(() => existsSync(keepB) && readFileSync(keepB, 'utf8') === 'KB')
    add('W-10/RW-5 仓根 symlink 面拆分 A：/tmp 内中间 symlink realpath 落 aidevorg → exit 3 且集外件原样',
      rLinkA.status === 3 && rLinkA.stderr.includes('仓根') && keepAOk, `status=${rLinkA.status} err=${rLinkA.stderr.slice(0, 140)}`)
    add('W-10/RW-5 仓根 symlink 面拆分 B：/tmp 内中间 symlink realpath 落技能仓 → exit 3 且集外件原样',
      rLinkB.status === 3 && rLinkB.stderr.includes('仓根') && keepBOk, `status=${rLinkB.status} err=${rLinkB.stderr.slice(0, 140)}`)
    // B-2 末级 dangling symlink 写穿面：登记集末级悬空软链 → fail-closed 拒 3（不写穿目标域）；keepD 先建后跑（R3-N4）
    const keepD = join(tmp, 'keep-d.txt'); writeFileSync(keepD, 'KD')
    const dangling = join(tmp, 'dangling-link')
    try { symlinkSync('/tmp/w5b-t3-nonexistent-target-xyz', dangling) } catch { /* 已存在 */ }
    const regDang = join(tmp, 'registry-dangling.json'); wj(regDang, { paths: [dangling] })
    const rDang = cli(['--cleanup', '--registry', regDang])
    const keepDOk = safe(() => existsSync(keepD) && readFileSync(keepD, 'utf8') === 'KD')
    add('B-2 末级悬空 symlink：登记清理 fail-closed → exit 3（目标不可解析不写穿）且集外件原样（keepD 先建后跑）',
      rDang.status === 3 && rDang.stderr.includes('悬空') && keepDOk, `status=${rDang.status} err=${rDang.stderr.slice(0, 140)}`)
    // V-4 删除失败/残留=1（N-1：uid=0 下 chmod 0555 不构成拒绝面→条件跳过并标注）
    const roDir = join(tmp, 'cleanup-ro')
    mkdirSync(roDir, { recursive: true })
    const locked = join(roDir, 'locked.txt')
    writeFileSync(locked, 'locked')
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
    if (!isRoot) {
      chmodSync(roDir, 0o555)
      const regRo = join(tmp, 'registry-ro.json'); wj(regRo, { paths: [locked] })
      const cRo = cli(['--cleanup', '--registry', regRo])
      const cRoS = json(cRo)
      chmodSync(roDir, 0o755)
      add('V-4 删除失败/残留：unlink 被拒 → exit 1/deleted=0/residual=1/existed=1/failed=true',
        cRo.status === 1 && cRoS && cRoS.deleted === 0 && cRoS.residual === 1 && cRoS.existed === 1 && cRoS.failed === true,
        `status=${cRo.status} out=${cRo.stdout.slice(0, 240)}`)
    } else {
      add('V-4 删除失败/残留：uid=0 环境 chmod 0555 不构成拒绝面——按 N-1 条件跳过（标注 skipped）', true, 'skipped: uid=0')
    }
    // W7 pgrep 方言预检：JS 合法而 pgrep ERE 非法（前瞻）→ exit 3 且不 spawn
    const lookCmd = join(tmp, 'cmd-lookahead.json')
    wj(lookCmd, { argv: [process.execPath, '-e', 'process.exit(0)'], cwd: tmp, process_pattern: 'a(?=b)', dir_prefixes: [tmp] })
    const lookOut = join(tmp, 'samples-lookahead.jsonl')
    const rLook = cli(['--cmdfile', lookCmd, '--out', lookOut])
    add('W7 pgrep 方言预检：JS 合法（前瞻）而 pgrep ERE 非法 → 干跑预检失败 exit 3 且启动前拒绝（out 未产生）',
      rLook.status === 3 && rLook.stderr.includes('pgrep 方言') && !existsSync(lookOut), `status=${rLook.status} err=${rLook.stderr.slice(0, 140)}`)
    // R3-N12 pgrep 本体不可用（PATH 剥夺）与方言非法分开报错：exit 3＋「pgrep 不可用」
    const pnCmd = join(tmp, 'cmd-pn.json')
    wj(pnCmd, { argv: [process.execPath, '-e', 'process.exit(0)'], cwd: tmp, process_pattern: 'node|sh|sleep', dir_prefixes: [tmp] })
    const rPn = cli(['--cmdfile', pnCmd, '--out', join(tmp, 'samples-pn.jsonl')], { pathBroken: true })
    add('R3-N12 pgrep 本体不可用：PATH 剥夺 → 装载错 exit 3＋「pgrep 不可用」（与方言非法分开报错）',
      rPn.status === 3 && rPn.stderr.includes('pgrep 不可用'), `status=${rPn.status} err=${rPn.stderr.slice(0, 140)}`)
    // 退出码矩阵：缺旗标/缺值/等号/未知/额外/混用/旗标形值=1（W-6/RN-15/W8）
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
    // RN-15/W8 旗标形值拒收：全部带值旗标 × 居末缺值/跨旗标（值以 -- 起头）各 usage 1＋真区分面
    const okCmd = join(tmp, 'cmd-ok.json'), okOut = join(tmp, 'x-ok.jsonl')
    let flagValOk = true, flagValDetail = {}
    for (const [flag, key] of Object.entries(VALUED_FLAGS)) {
      const v = key === 'cmdfile' ? okCmd : (key === 'out' ? okOut : 'val')
      const pre = ['--cmdfile', okCmd, '--out', okOut]
      const rEnd = cli([...pre, flag]) // 居末缺值
      const rCross = cli([flag, ...pre]) // 跨旗标（下一 token 为旗标）
      const rMid = key === 'cmdfile' || key === 'out' ? null : cli([pre[0], pre[1], flag, '--out', okOut]) // run 内跨旗标
      if (rEnd.status !== 1 || rCross.status !== 1 || (rMid !== null && rMid.status !== 1)) { flagValOk = false; flagValDetail[flag] = [rEnd.status, rCross.status, rMid ? rMid.status : '-'] }
    }
    const flagShaped = cli(['--cmdfile', '--out', '--out', 'X']) // 真区分面：旗标形值若被收下（cmdfile='--out'）→装载错 3；拒收→usage 1
    add('RN-15/W8 旗标形值拒收：全部带值旗标居末缺值/跨旗标（值以 -- 起头）均 usage exit 1，且旗标形值不被收下（--cmdfile --out --out X → 1 非 3）',
      flagValOk && flagShaped.status === 1, JSON.stringify(flagValDetail))
    const stMixed = cli(['--self-test', '--cleanup'])
    const clLimit = cli(['--cleanup', '--registry', join(tmp, 'registry-ok.json'), '--max-dirs', '5'])
    add('W-6 形态互斥先于分支：--self-test 混用与 cleanup＋限值旗标均 usage exit 1（自检/清理不执行）',
      stMixed.status === 1 && clLimit.status === 1 && !stMixed.stdout.includes('self-test'), `st=${stMixed.status} cl=${clLimit.status}`)
    // 装载错 3：JSON 不可读/非法 schema/cwd 非绝对/非法正则（JS 面·不 spawn）/--out 写失败两面＋--out 域外（B-2）
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
    add('D-1d process_pattern 非法正则（JS 面）：exit 3 且启动前拒绝（out 未产生）', rBadRe.status === 3 && !existsSync(badReOut), `status=${rBadRe.status}`)
    const outNoDir = join(tmp, 'no-such-dir-w5b', 'samples.jsonl')
    const rOutDir = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', outNoDir])
    add('D-1d --out 目录不存在：exit 3', rOutDir.status === 3, `status=${rOutDir.status}`)
    const outIsDir = join(tmp, 'out-is-dir'); mkdirSync(outIsDir, { recursive: true })
    const rOutIsDir = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', outIsDir])
    add('D-1d --out 写失败（指向目录）：exit 3', rOutIsDir.status === 3, `status=${rOutIsDir.status}`)
    // B-2 --out 末级 symlink 两面：悬空（fail-closed）与指向真实文件（O_NOFOLLOW ELOOP）均 exit 3
    const outDang = join(tmp, 'out-dangling-link')
    try { symlinkSync('/tmp/w5b-t3-nonexistent-out-target', outDang) } catch { /* 已存在 */ }
    const rOutDang = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', outDang])
    add('B-2 --out 末级悬空 symlink：fail-closed → exit 3（不写穿）', rOutDang.status === 3 && rOutDang.stderr.includes('装载错'), `status=${rOutDang.status} err=${rOutDang.stderr.slice(0, 140)}`)
    const victim = join(tmp, 'victim.txt'); writeFileSync(victim, 'VICTIM-ORIGINAL')
    const outToVictim = join(tmp, 'out-link-to-victim')
    try { symlinkSync(victim, outToVictim) } catch { /* 已存在 */ }
    const rOutSym = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', outToVictim])
    const victimOk = safe(() => readFileSync(victim, 'utf8') === 'VICTIM-ORIGINAL')
    add('B-2 --out 末级 symlink 指向真实文件：O_NOFOLLOW 预开失败（ELOOP）→ exit 3 且目标文件原样未被写',
      rOutSym.status === 3 && victimOk, `status=${rOutSym.status} err=${rOutSym.stderr.slice(0, 140)} victim=${victimOk}`)
    // B-2 --out 域外（中间 symlink realpath 落仓根）两仓根各一（R3-N8 补技能仓根面）
    const outLinkA = join(tmp, 'out-link-into-repo')
    try { symlinkSync('/home/yyx/work/aidevorg', outLinkA) } catch { /* 已存在 */ }
    const rOutLinkA = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', join(outLinkA, 's.jsonl')])
    add('B-2 --out 域外（中间 symlink realpath 落主仓根）：exit 3 且启动前拒绝（不 spawn 不写仓）',
      rOutLinkA.status === 3 && rOutLinkA.stderr.includes('仓根'), `status=${rOutLinkA.status} err=${rOutLinkA.stderr.slice(0, 140)}`)
    const rOutLinkB = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', join(linkB, 's.jsonl')])
    add('B-2 --out 域外（中间 symlink realpath 落技能仓根·R3-N8）：exit 3 且启动前拒绝（不 spawn 不写仓）',
      rOutLinkB.status === 3 && rOutLinkB.stderr.includes('仓根'), `status=${rOutLinkB.status} err=${rOutLinkB.stderr.slice(0, 140)}`)
    // B-2 TOCTOU 运行中替换：子进程删 out 并以 symlink 指向受害者文件 → 路径侧 dev/ino 比对 fail-closed
    //（运行期写失败 exit 1）且受害者原样未被写穿；lstat 预取包裹（R3-N15）
    const tocDir = join(tmp, 'toc-dir'); mkdirSync(tocDir, { recursive: true })
    const tocOut = join(tocDir, 's.jsonl')
    const tocVictim = join(tmp, 'toc-victim.txt'); writeFileSync(tocVictim, 'TOC-VICTIM')
    const tocCmd = join(tmp, 'cmd-toc.json')
    wj(tocCmd, { argv: ['sh', '-c', `sleep 0.3; rm -f '${tocOut}'; ln -s '${tocVictim}' '${tocOut}'; sleep 1`], cwd: tmp, process_pattern: 'node|sh|sleep', dir_prefixes: [tmp] })
    const rToc = cli(['--cmdfile', tocCmd, '--out', tocOut, '--interval-ms', '100'])
    const tocSym = safe(() => lstatSync(tocOut).isSymbolicLink())
    const tocVictimOk = safe(() => readFileSync(tocVictim, 'utf8') === 'TOC-VICTIM')
    add('B-2 TOCTOU 运行中替换：out 被删并替换为指向受害者的 symlink → 路径侧核验 fail-closed（运行期写失败 exit 1）且受害者原样未被写穿',
      rToc.status === 1 && String(rToc.stdout + rToc.stderr).includes('采样写出失败') && tocSym === true && tocVictimOk,
      `status=${rToc.status} err=${rToc.stderr.slice(0, 100)} out=${rToc.stdout.slice(0, 200)} sym=${tocSym} victim=${tocVictimOk}`)
    // RN-11/B4 后采写失败：末次循环采样后 out 父目录随子进程被删 → postWriteErr 进返回路径 exit 1（samples 只计成功落盘）
    const pfDir = join(tmp, 'pf-dir'); mkdirSync(pfDir, { recursive: true })
    const pfCmd = join(tmp, 'cmd-pf.json')
    wj(pfCmd, { argv: ['sh', '-c', `sleep 0.32; rm -rf '${pfDir}'`], cwd: tmp, process_pattern: 'node|sh|sleep', dir_prefixes: [tmp] })
    const rPf = cli(['--cmdfile', pfCmd, '--out', join(pfDir, 's.jsonl'), '--interval-ms', '100'])
    const rPfS = json(rPf)
    add('RN-11/B4 后采写失败：末次循环采样后 out 父目录随子进程被删 → 后采写失败进返回路径 exit 1、error=采样写出失败、收割零残留（samples=成功落盘条数口径由 N-13 向量绑定）',
      rPf.status === 1 && rPfS && String(rPfS.error ?? '').includes('采样写出失败') && rPfS.residual_processes === 0 && rPfS.reaped === true && Number.isInteger(rPfS.samples) && rPfS.samples >= 1,
      `status=${rPf.status} err=${rPf.stderr.slice(0, 100)} out=${rPf.stdout.slice(0, 200)}`)
    // RN-2/W-3 unknown 注入：dir_prefixes 不可读（EACCES）→ 计数未知 → unknown_counts=true、reaped 不得假真、exit 1（R3-N2：uid 守卫）
    const isRootUid = typeof process.getuid === 'function' && process.getuid() === 0
    if (!isRootUid) {
      const eaDir = join(tmp, 'eacc-dir'); mkdirSync(eaDir, { recursive: true })
      const eaCmd = join(tmp, 'cmd-ea.json')
      wj(eaCmd, { argv: [process.execPath, '-e', 'setTimeout(()=>{},400)'], cwd: tmp, process_pattern: 'node|sh|sleep', dir_prefixes: [eaDir] })
      chmodSync(eaDir, 0o000)
      const rEa = cli(['--cmdfile', eaCmd, '--out', join(tmp, 'samples-ea.jsonl'), '--interval-ms', '100'])
      chmodSync(eaDir, 0o755)
      add('RN-2/W-3 unknown 注入：dir_prefixes 不可读（EACCES）→ 计数未知 → exit 1/unknown_counts=true/reaped=false（不假真）',
        rEa.status === 1 && json(rEa)?.unknown_counts === true && json(rEa)?.reaped === false,
        `status=${rEa.status} out=${rEa.stdout.slice(0, 220)}`)
    } else {
      add('RN-2/W-3 unknown 注入：uid=0 环境 chmod 000 不构成 EACCES——按 R3-N2 条件跳过（标注 skipped）', true, 'skipped: uid=0')
    }
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
