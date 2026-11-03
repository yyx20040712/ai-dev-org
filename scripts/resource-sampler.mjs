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
// 写面安全口径（R4-1 主控裁定·两席共同裁定锚（终局收束））：**多层防御**（装载校验＋末级 lstat/realpath＋
//   O_NOFOLLOW 预开＋路径侧 dev/ino 绑定＋nlink 复核）·尽力检测·**残余 TOCTOU 窗口已文档化**
//   （lstat→writeSync 间隙·cleanup check→rmSync 同族·owner=修模板批〔fd 目录句柄/写域隔离深化〕）；
//   不宣称「绝不写穿」绝对断言。out 语义（轮 6 R5-2 硬语义）：**out 由本 run 独占创建（O_EXCL）·
//   任何预存在（含空文件）即拒=写面不可用 3**——跨 run 不得混装升级为创建独占语义。
// 主控契约裁定（返工轮 3）：
//   ① process_pattern＝spawn 前 pgrep 方言预检（pgrep 自身干跑·失败=3）＋信息字段；max_processes 与
//      residual/reaped 一律组全域计数（pgrep -g <pgid>，无 -f）——sampler/pgrep 本不在目标 detached
//      组内，非匹配组内进程不漏计。组全域口径含 zombie/D 态＝fail-closed 设计（残留保守非零即 1·R3-N6）。
//   ② /tmp 直系子路径合法：仅「路径本身＝/tmp」拒绝；最近存在祖先＝/tmp 的不存在路径放行。
//   ③ 子命令 stdout 丢弃（stdio ignore）＝既定——out JSONL 为唯一数据工件；stderr 继承（递归哨兵
//      可观测）；摘要 JSON 独占 sampler stdout。
// 写面对象同一性（返工轮 4 B1·轮 5 R4-1 措辞收束·轮 6 R5-1/R5-2 硬语义·修模板批 W5b T2 fd 目录
//   句柄深化）：--out 预开旗标面＝O_NONBLOCK|O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW|O_EXCL——
//   预开旗标面无截断旗标（TRUNC 位零出现·R4-N11 登记处置：O_EXCL 独占新建空文件＋O_APPEND
//   同 run 追加语义＝完整写面契约，源码零截断旗标）；O_EXCL 独占创建：任何预存在（含空文件、
//   含硬链接）装载期即拒 3——
//   **装载期 O_EXCL 已拒一切预存在（含硬链接），nlink>1 只在运行期新建链接时可达＝运行期写失败 1**
//   （R6-N2 措辞修正：与「每次写前 nlink 复核」分层如实，不混写「写面不可用」）；R6-N4：中止 run
//   会留空/半写 out，重试须先 rm 同一 out 再跑，否则 O_EXCL 拒＝装载错 3。O_NONBLOCK 使 FIFO 换入
//   形态开不阻塞（开后 fstatSync 非 regular 即拒 3·防御面）；修模板批 T2③：经 /proc/self/fd/<fd0>
//   以 O_WRONLY|O_APPEND 重开**清 O_NONBLOCK**，验 dev/ino 一致与 nlink=1 后关旧 fd——常规路径
//   fd 无 O_NONBLOCK 位（ORG_RESOURCE_SAMPLER_PROBE_FDINFO=1 时 summary 附 out_fd_flags=<八进制>
//   供 V-2 观测）。
// fd 目录句柄相对写面（W5b T2·handoff 38:31「TOCTOU fd 目录句柄深化＋O_NONBLOCK 清旗标」）：
//   ①以 O_RDONLY|O_DIRECTORY 打开 out 父目录 dirfd 并 fstat 验目录；②经 /proc/self/fd/<dirfd>/
//   <basename> 按既有旗标预开 out；③重开清 O_NONBLOCK；④每次写前双复核——父目录路径侧 lstat
//   dev/ino 对 dirfd fstat、out 经 procfd 路径 lstat dev/ino/nlink，漂移/缺失＝运行期写失败 1；
//   ⑤cleanup 对每条登记路径打开最近存在祖先 dirfd，经 procfd lstat/删除/复核，保留装载期
//   dev/ino 比对；⑥procfd 不可用时显式降级路径模式并在 summary 输出 dirfd_mode=path（残余窗口
//   ＝既有路径侧 TOCTOU 窗口 lstat→writeSync 间隙，如实登记），正常环境输出 dirfd_mode=procfd；
//   ⑦R4-N9 同源并项：运行期写失败=1、写面不可用=3，退出域不扩。procfd 相对 open/lstat/unlink/
//   递归删除语义已在 Node 24.21.0 装配期实测可行（Linux /proc/self/fd）。
// N 级登记处置（W5b T3·零逻辑改动对号）：R4-N12 后采顺序＝「后采→终采→reaped/residual 定值」
//   （finally 块源码顺序复核在位）；R4-N13 dir_prefixes 元素类型由 checkTmpPath 承担（非字符串＝
//   装载错 3·向量化；原文未随档＝登记处置不虚构）；R4-N14 countDirs 为逐样本快照、跨样本不累积、
//   peak 取最大值（恒值向量化）；R4-N15 同 out 第二次运行由 O_EXCL 拒＝装载错 3（跨 run 独占·
//   向量化），pgrep 默认 maxBuffer 超限按 unknown 计并退 1（fail-closed·头注登记·不加向量）。
// race 纪律（返工轮 4 B2·轮 5 R4-2 实修）：全部 Promise.race 败方定时器 clearTimeout（interval 循环/
//   close 5s race）；backup 2s 定时器验后即清；摘要落盘后挂 **unref** 的 1s 硬退出定时器兜底——正常
//   路径事件循环空即自然退出零延迟；悬挂场景（子进程句柄持活循环）定时器照发·任何情况必有退出码。
// 递归哨兵：env ORG_RESOURCE_SAMPLER_DEPTH 非空即拒绝（exit 1＋[sentinel] resource-sampler rejected），
//   main 入口最前判定（运行/清理/自检三形态全拒·W-5）；子环境固定注入深度 1（嵌套调用必被拒）。
// 收割完备性（B-1）：spawn 后全程 try/finally——finally 无条件幂等 SIGKILL 整组＋await close（W-8）＋
//   终采（最终进程测量在 reaped/residual 定值之前·B3）——reaped=true 与 unknown/非零残留绝不并存；
//   异常路径先收割再按 3/1 退出；reaped 须已知零残留（W-3）；spawnErr 强制 reaped=false（RN-3）。
// 供应商事实零硬编码：不含端点/模型名；自检夹具一律落 os.tmpdir()（w5b-t3-resource-sampler-selftest-*），
//   不写技能仓。

import { readFileSync, writeFileSync, existsSync, statSync, lstatSync, mkdirSync, rmSync, readdirSync, chmodSync, realpathSync, mkdtempSync, symlinkSync, linkSync, openSync, closeSync, fstatSync, writeSync, constants as fsConstants } from 'node:fs'
import { join, dirname, resolve, basename, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'

const SELF = fileURLToPath(import.meta.url)
const DEPTH_ENV = 'ORG_RESOURCE_SAMPLER_DEPTH'
const SENTINEL = '[sentinel] resource-sampler rejected'
const DEFAULTS = { intervalMs: 5000, timeoutMs: 300000, maxIterations: 100, maxProcesses: 8, maxDirs: 20 }
// 内部测试设施（W5b T2·V-2 观测面）：置 1 时 run 摘要附 out_fd_flags=<八进制>（读 /proc/self/fdinfo/<fd>）
const PROBE_FDINFO_ENV = 'ORG_RESOURCE_SAMPLER_PROBE_FDINFO'
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

/** 内部测试设施（W5b T2·V-2 观测面）：读 /proc/self/fdinfo/<fd> 的 flags 行（八进制），证明
 *  O_NONBLOCK 位已清且 O_APPEND 位保留；不可读返回 null（不干扰主流程）。 */
function probeOutFdFlags(fd) {
  if (fd === null) return null
  try {
    const txt = readFileSync(join('/proc/self/fdinfo', String(fd)), 'utf8')
    const m = /^flags:\s*(\S+)/m.exec(txt)
    return m ? m[1] : null
  } catch { return null }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** B2：可清理 sleep——Promise.race 败方定时器必须 clearTimeout（防悬挂拖长墙钟/拖住退出）。 */
const sleepT = (ms) => { let t = null; const p = new Promise((res) => { t = setTimeout(res, ms) }); return { p, clear: () => { if (t !== null) { clearTimeout(t); t = null } } } }

/** 运行形态（B-1 收割完备性）：detached 进程组、前/间隔/后采样、每采样（含前采样）即判限即杀（W-2）、
 *  spawn 后全程 try/finally——finally 无条件幂等 SIGKILL 整组＋await close（W-8·race 败方定时器清）＋
 *  终采（B3：最终进程测量在 reaped/residual 定值之前）＋复测残留；异常路径先收割再按 3/1 退出；
 *  后采写失败进返回路径（exit 1·RN-11/B4）；摘要落盘后 1s 硬退出定时器兜底（B2·R5-3：unref 兜底——正常路径零延迟·悬挂场景照发）。 */
export async function runMode(cmd, outPath, limits) {
  const samples = []
  const started = Date.now()
  const procBase = '/proc/self/fd'
  const procfdAvail = existsSync(procBase) // T2⑥：procfd 不可用＝显式降级路径模式（dirfd_mode=path·残余窗口登记于头注）
  let outFd = null, st0 = null, dirFd = null, stDir = null
  let dirfdMode = 'path'
  const closeFd = () => {
    try { if (outFd !== null) closeSync(outFd) } catch { /* 幂等 */ }
    try { if (dirFd !== null) closeSync(dirFd) } catch { /* 幂等 */ }
    outFd = null; dirFd = null
  }
  try {
    if (procfdAvail) {
      // T2①：out 父目录 dirfd（O_RDONLY|O_DIRECTORY）＋fstat 验目录
      dirFd = openSync(dirname(outPath), fsConstants.O_RDONLY | fsConstants.O_DIRECTORY)
      stDir = fstatSync(dirFd)
      if (!stDir.isDirectory()) throw new SamplerLoadError(`--out 父目录 dirfd 非目录（写面不可用）：${dirname(outPath)}`)
      // T2②：经 procfd 路径按既有旗标预开 out（O_NONBLOCK|O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW|O_EXCL）
      const fd0 = openSync(join(procBase, String(dirFd), basename(outPath)),
        fsConstants.O_NONBLOCK | fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW | fsConstants.O_EXCL, 0o600)
      const stA = fstatSync(fd0)
      if (!stA.isFile()) { closeSync(fd0); throw new SamplerLoadError(`--out 预开 fd 非 regular 文件（FIFO 换入防御面·写面不可用）：${outPath}`) }
      if (stA.nlink > 1) { closeSync(fd0); throw new SamplerLoadError(`--out 预置硬链接（nlink=${stA.nlink}>1·fail-closed 拒绝·写面不可用）：${outPath}`) }
      // T2③：经 procfd 重开清 O_NONBLOCK，验 dev/ino 一致与 nlink=1 后关旧 fd；失败＝写面不可用 3
      const fd1 = openSync(join(procBase, String(fd0)), fsConstants.O_WRONLY | fsConstants.O_APPEND)
      const stB = fstatSync(fd1)
      if (stB.dev !== stA.dev || stB.ino !== stA.ino || stB.nlink !== 1) {
        closeSync(fd1)
        throw new SamplerLoadError(`--out 重开清 O_NONBLOCK 同一性核验失败（dev/ino/nlink·写面不可用）：${outPath}`)
      }
      closeSync(fd0)
      outFd = fd1; st0 = stB
      dirfdMode = 'procfd'
    } else {
      // T2⑥ 显式降级路径模式（既有旗标直开；残余窗口＝路径侧 lstat→writeSync 间隙，头注登记）
      outFd = openSync(outPath, fsConstants.O_NONBLOCK | fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW | fsConstants.O_EXCL, 0o600)
      st0 = fstatSync(outFd)
      if (!st0.isFile()) throw new SamplerLoadError(`--out 预开 fd 非 regular 文件（R5-1·FIFO 换入防御面·写面不可用）：${outPath}`)
      if (st0.nlink > 1) throw new SamplerLoadError(`--out 预置硬链接（nlink=${st0.nlink}>1·fail-closed 拒绝·写面不可用）：${outPath}`)
      dirfdMode = 'path'
    }
  } catch (e) {
    closeFd()
    if (e instanceof SamplerLoadError) throw e
    throw new SamplerLoadError(`--out 写面不可用（O_NONBLOCK|O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW|O_EXCL 预开失败·含末级 symlink/ELOOP/预存在〔含空文件〕面）：${outPath}（${e.code ?? e.message}）`)
  }
  // B1（轮 4·轮 6 R4-N17 归位·W5b T2④ 双复核深化）：每次写前绑定核验——被替换/迁出/缺失/
  //  多硬链接/父目录漂移一律运行期写失败（SamplerWriteError→1）；lstat 异常保留 e.code
  //（仅 ENOENT 报「原路径缺失/对象缺失」·其余如实报码）
  const writeSample = (rec) => {
    if (dirfdMode === 'procfd' && dirFd !== null) {
      // T2④ 双复核之一：父目录路径侧 lstat dev/ino 对 dirfd fstat
      let dstPath = null
      try { dstPath = lstatSync(dirname(outPath)) } catch (e) {
        throw new SamplerWriteError(`采样写出失败：${dirname(outPath)} 父目录缺失/异常（${e?.code ?? e?.message}·父目录 dirfd 同一性双复核·尽力检测）`)
      }
      if (dstPath.dev !== stDir.dev || dstPath.ino !== stDir.ino) throw new SamplerWriteError(`采样写出失败：${dirname(outPath)} 父目录被替换（路径侧 dev/ino 对 dirfd fstat 比对失败·TOCTOU 尽力检测）`)
      // T2④ 双复核之二：out 经 procfd 路径 lstat dev/ino/nlink
      let stp = null
      try { stp = lstatSync(join(procBase, String(dirFd), basename(outPath))) } catch (e) {
        if (e && e.code === 'ENOENT') throw new SamplerWriteError(`采样写出失败：${outPath} 原对象缺失（procfd lstat ENOENT·尽力检测不写孤儿 inode）`)
        throw new SamplerWriteError(`采样写出失败：${outPath} procfd lstat 异常（${e?.code ?? e?.message}·尽力检测）`)
      }
      if (stp.dev !== st0.dev || stp.ino !== st0.ino) throw new SamplerWriteError(`采样写出失败：${outPath} 对象被替换（procfd dev/ino 与预开 fd 比对失败·TOCTOU 尽力检测）`)
      if (stp.nlink > 1) throw new SamplerWriteError(`采样写出失败：${outPath} 出现多硬链接（nlink=${stp.nlink}>1·fail-closed·运行期新建链接面）`)
    } else {
      // 路径模式（T2⑥ 降级面）：既有路径侧核验（残余窗口已登记）
      let stPath = null
      try { stPath = lstatSync(outPath) } catch (e) {
        if (e && e.code === 'ENOENT') throw new SamplerWriteError(`采样写出失败：${outPath} 原路径缺失（lstat ENOENT·尽力检测不写孤儿 inode）`)
        throw new SamplerWriteError(`采样写出失败：${outPath} lstat 异常（${e?.code ?? e?.message}·尽力检测）`)
      }
      if (stPath.dev !== st0.dev || stPath.ino !== st0.ino) throw new SamplerWriteError(`采样写出失败：${outPath} 对象被替换（路径侧 dev/ino 与预开 fd 比对失败·TOCTOU 尽力检测）`)
      if (stPath.nlink > 1) throw new SamplerWriteError(`采样写出失败：${outPath} 出现多硬链接（nlink=${stPath.nlink}>1·fail-closed·运行期新建链接面）`)
    }
    try { writeSync(outFd, JSON.stringify(rec) + '\n') } catch (e) { throw new SamplerWriteError(`采样写出失败：${outPath}（${e.code ?? e.message}）`) }
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
    console.log(JSON.stringify({ mode: 'run', pid: null, samples: 0, child_exit: null, timeout: false, reaped: false, peak_processes: 0, peak_dirs: 0, limit_hit: false, limit_reason: null, residual_processes: 0, unknown_counts: true, process_pattern: cmd.pattern, dirfd_mode: dirfdMode, error: null, spawn_error: String(e.message) }))
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
        dirfd_mode: dirfdMode, // T2⑥：procfd=fd 目录句柄相对写面；path=显式降级（残余窗口登记于头注）
        ...(process.env[PROBE_FDINFO_ENV] === '1' ? { out_fd_flags: probeOutFdFlags(outFd) } : {}), // 内部测试设施（V-2 观测面）
        error: runErr ? String(runErr.message) : (postWriteErr ? String(postWriteErr.message) : null),
        spawn_error: spawnErr ? String(spawnErr.message) : null,
      }))
    } catch { /* 摘要打印失败不吞退出码 */ }
    closeFd()
    // B2/R4-2：硬退出兜底（unref——正常路径事件循环空即自然退出零延迟；悬挂场景定时器照发·任何情况必有退出码）
    setTimeout(() => { try { process.exit(typeof process.exitCode === 'number' ? process.exitCode : 1) } catch { /* 兜底 */ } }, 1000).unref?.()
  }
  if (runErr) throw runErr // 先收割再按 3/1 退出（main catch 映射：装载错 3/运行期写失败 1）
  checkTmpPath(outPath, '--out（写入后路径域复核·B-2·ds-R4-N18：仅验域不对迁出 ENOENT 构成同一性证据）')
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

/** 清理形态：仅删登记集（W5b T2⑤：每条登记路径打开最近存在祖先 dirfd，经 procfd lstat/删除/复核，
 *  保留装载期 dev/ino 比对；dirfd 打开失败或 procfd 不可用＝该条回退路径模式·操作语义不变；
 *  删除前 realpath＋dev/ino 同一性比对（B-2·TOCTOU fail-closed）/删除/复核（W-9：仅 ENOENT=已知零·
 *  其余异常=未知非零退出）），输出 registered/existed/deleted/residual/dirfd_mode。 */
export function cleanupMode(reg) {
  const procBase = '/proc/self/fd'
  const procfdAvail = existsSync(procBase)
  const detail = []
  let existed = 0, deleted = 0, residual = 0, failed = false, residualUnknown = false
  for (let i = 0; i < reg.paths.length; i++) {
    const p = reg.paths[i], rp = reg.resolved[i], id0 = reg.ids[i]
    let isExist = false, isDeleted = false, isResidual = false, error = null
    // T2⑤ dirfd 面：最近存在祖先（自父目录向上）开 O_RDONLY|O_DIRECTORY，经 procfd 相对路径操作
    let ancFd = null, tgt = rp
    if (procfdAvail) {
      try {
        let probe = dirname(rp)
        while (!existsSync(probe)) { const parent = dirname(probe); if (parent === probe) break; probe = parent }
        if (statSync(probe).isDirectory()) {
          const fdTry = openSync(probe, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY)
          if (fstatSync(fdTry).isDirectory()) {
            const rel = relative(probe, rp)
            if (!rel.startsWith('..') && rel.length > 0) { ancFd = fdTry; tgt = join(procBase, String(ancFd), rel) }
            else closeSync(fdTry)
          } else closeSync(fdTry)
        }
      } catch { tgt = rp /* dirfd 打开失败＝该条回退路径模式（语义不变） */ }
    }
    try {
      const st = lstatSync(tgt); isExist = true
      if (id0 !== null && `${st.dev}:${st.ino}` !== id0) throw new SamplerLoadError(`registry.paths[${i}] 删除前对象同一性漂移（dev/ino 与装载期比对失败·TOCTOU fail-closed）：${p}`)
      checkTmpPath(p, `registry.paths[${i}]（删除前同一性复核·B-2）`)
      rmSync(tgt, { recursive: true, force: false })
      isDeleted = true
    } catch (e) {
      if (e instanceof SamplerLoadError) { console.error(`[装载错] ${e.message}`); if (ancFd !== null) { try { closeSync(ancFd) } catch { /* 幂等 */ } } return 3 }
      if (e.code === 'ENOENT') { /* 未存在：existed=false 如实登记 */ } else { error = `${e.code ?? ''} ${e.message}`; failed = true }
    }
    try { lstatSync(tgt); isResidual = true } catch (e) {
      if (!e || e.code !== 'ENOENT') { residualUnknown = true; failed = true; error = error ?? `残留复核异常（W-9 fail-closed）：${e?.code ?? e?.message}` } // 已消失=已知零；其余=未知
    }
    if (ancFd !== null) { try { closeSync(ancFd) } catch { /* 幂等 */ } }
    if (isExist) existed++
    if (isDeleted) deleted++
    if (isResidual) residual++
    detail.push({ path: p, existed: isExist, deleted: isDeleted, residual: isResidual, error })
  }
  console.log(JSON.stringify({ mode: 'cleanup', registered: reg.paths.length, existed, deleted, residual, failed, residual_unknown: residualUnknown, dirfd_mode: procfdAvail ? 'procfd' : 'path', paths: detail }))
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

/** 自检汇总纯函数（W5b T1·R6-N1 skip 报告保真）：skip 不计 pass——过 X/skip Y/全 Z（Z=总向量数，
 *  全绿时 X+Y=Z；存在 fail 时 X+Y<Z 且退出码 1）。 */
export function summarizeSelfTest(cases) {
  const pass = cases.filter((c) => !c.skipped && c.ok).length
  const skip = cases.filter((c) => c.skipped).length
  return { total: cases.length, pass, skip, fail: cases.length - pass - skip }
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
    // W5b T1（R6-N1 skip 报告保真）：结果形态 {cases,pass,skip,fail}；skip 逐条打印原因；
    // 汇总固定为「过 X/skip Y/全 Z」，禁再出现「self-test 全过」（skip 不计 pass·不虚报覆盖）
    const { cases, pass, skip, fail } = selfTest()
    for (const c of cases) if (c.skipped) console.log(`[self-test] SKIP ${c.name}（${c.detail}）`)
    for (const c of cases) if (!c.ok && !c.skipped) console.log(`[self-test] FAIL ${c.name}${c.detail ? `（${c.detail}）` : ''}`)
    console.log(`self-test 汇总：过 ${pass}/skip ${skip}/全 ${cases.length}`)
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
    // R4-N3：装载期非 regular 文件拒收（FIFO/设备件防 openSync 永久阻塞·目录同面）
    if (existsSync(args.out) && !statSync(args.out).isFile()) throw new SamplerLoadError(`--out 非 regular 文件（FIFO/设备件/目录拒收·防 openSync 永久阻塞·写面不可用）：${args.out}`)
  } catch (e) {
    console.error(`[装载错] ${e.message}`); process.exit(3)
  }
  runMode(cmd, args.out, limits)
    .then((code) => { process.exitCode = code }) // RN-12：自然退出防管道截断
    .catch((e) => { console.error(`[${e instanceof SamplerLoadError ? '装载错' : '运行错'}] ${e.message}`); process.exitCode = e instanceof SamplerLoadError ? 3 : 1 })
}

// ── 自检（W5b T1 形态：{cases,pass,skip,fail}·skip 不计 pass；覆盖 B1 路径侧绑定核验/B2 race 纪律/
//    B3 如实更正/W4/W5/N 项＋W5b T1 报告保真/T2 fd 目录句柄/T3 N 级登记；
//    夹具落 os.tmpdir() 前缀 w5b-t3-resource-sampler-selftest-*，随验清理） ──
function selfTest() {
  const cases = []
  const add = (name, ok, detail = '') => cases.push({ name, ok: !!ok, detail })
  const skip = (name, reason) => cases.push({ name, ok: true, skipped: true, detail: reason }) // W5b T1：skip 助手（不计 pass·逐条带原因）
  const observed = new Set()
  const tmp = mkdtempSync(join(tmpdir(), 'w5b-t3-resource-sampler-selftest-'))
  const envClean = () => { const e = { ...process.env }; delete e[DEPTH_ENV]; delete e[PROBE_FDINFO_ENV]; return e }
  const safe = (fn, d = false) => { try { return fn() } catch { return d } } // R3-N15：断言内 IO 一律预取包裹
  const cli = (args, opts = {}) => {
    const base = opts.depth ? { ...envClean(), [DEPTH_ENV]: '1' } : (opts.pathBroken ? { ...envClean(), PATH: '/nonexistent-w5b-t3-path' } : envClean())
    const env = { ...base, ...(opts.extraEnv ?? {}) } // W5b T2：extraEnv 承载 ORG_RESOURCE_SAMPLER_PROBE_FDINFO 等内部设施
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
    // W5b T1（R6-N1）skip 汇总纯函数向量：skip 不计 pass——合成四例（过/过/skip/败）得 过=2/skip=1/全=4/fail=1
    const sumMix = summarizeSelfTest([{ name: 'a', ok: true }, { name: 'b', ok: true }, { name: 's', ok: true, skipped: true }, { name: 'f', ok: false }])
    add('R6-N1 skip 报告保真·汇总纯函数：skip 不计 pass——合成 过=2/skip=1/全=4/fail=1 且 pass+skip≠total（存在失败）；全绿合成集 pass+skip===total',
      sumMix.pass === 2 && sumMix.skip === 1 && sumMix.total === 4 && sumMix.fail === 1 && sumMix.pass + sumMix.skip !== sumMix.total
        && (() => { const s2 = summarizeSelfTest([{ name: 'x', ok: true }, { name: 'y', ok: true, skipped: true }]); return s2.pass === 1 && s2.skip === 1 && s2.fail === 0 && s2.pass + s2.skip === s2.total })(),
      JSON.stringify(sumMix))
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
    // B2/R6-N3 墙钟上限（[hard-exit] 面观测·阈值 <3000）：长 interval＋快退子进程 → 总时长受硬退出兜底约束
    const wall0 = Date.now()
    const wall = runCase('wall', [process.execPath, '-e', 'process.exit(0)'], ['--interval-ms', '8000'])
    const wallMs = Date.now() - wall0
    add('B2/R6-N3 [hard-exit] 墙钟上限：长 interval（8s）＋快退子进程 → 总时长 <3000ms（race 败方定时器悬挂/硬退出兜底缺失即红·观测面记录 wall_ms）',
      wall.r.status === 0 && wallMs < 3000, `status=${wall.r.status} wall_ms=${wallMs}`)
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
    // B-1/R6-N5 正常退出留孙进程（marker 强化·r5 活断言）：孙进程启动即写 marker 文件；pgrep pattern
    // 实际匹配孙进程 cmdline（含连字符 ORPHAN-MARKER-OK-<run>——禁恒不匹配形态；W5c D-4：token 带
    // run 后缀=自检进程 pid·marker 文件名/内容/cmdline 同源·跨运行唯一）；阳性对照＝sampler 运行中
    // 同 pattern pgrep 命中≥1（哨兵在位证明）；退出后同 pattern 零命中（真收割证明）；向量另断言
    // marker 内容与 JSONL 孙进程在场（逐样本 processes≥2·RN-4）。活断言轮询须真让出事件循环——
    // 自检进程为同步体（spawnSync 轮询无法收到 exit 事件），故承载于临时 helper 子进程（真 async/await，
    // 结论以 JSON 打印·夹具随 tmp 清理），自检 spawnSync 读其结论断言。
    const b1Out = join(tmp, 'samples-orphan.jsonl')
    const B1_RUN = String(process.pid) // W5c D-4：run 唯一值缺省=自检进程 pid（marker 文件名与 pgrep token 同源）
    const b1Marker = join(tmp, `orphan-marker-${B1_RUN}.txt`)
    const b1Cmd = join(tmp, 'cmd-orphan.json')
    const b1Helper = join(tmp, 'b1-live-helper.mjs')
    const B1_PATTERN = `ORPHAN-MARKER-OK-${B1_RUN}`
    wj(b1Cmd, { argv: ['sh', '-c', `node -e "require('fs').writeFileSync(process.argv[1],'${B1_PATTERN}');setTimeout(()=>{},5000)" '${b1Marker}' & sleep 0.2; exit 0`], cwd: tmp, process_pattern: 'node|sh|sleep', dir_prefixes: [tmp] }) // R5-4/ds-N3：先起孤儿再等待（sh 与孙同窗可观测）
    writeFileSync(b1Helper, `import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
const [selfPath, cmdFile, outFile, markerFile] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const env = { ...process.env }; delete env.ORG_RESOURCE_SAMPLER_DEPTH
const child = spawn(process.execPath, [selfPath, '--cmdfile', cmdFile, '--out', outFile, '--interval-ms', '100', '--max-dirs', '100'], { stdio: 'ignore', env })
let positive = false
try {
  const d1 = Date.now() + 20000
  while (Date.now() < d1 && child.exitCode === null && !positive) {
    await sleep(50)
    if (spawnSync('pgrep', ['-f', ${JSON.stringify(B1_PATTERN)}], { encoding: 'utf8' }).status === 0) positive = true
  }
  const d2 = Date.now() + 30000
  while (child.exitCode === null && Date.now() < d2) await sleep(50)
} finally {
  // r6（ds-N-3）：兜底收割——helper 任何路径退出前对未退出的 sampler 直接 SIGKILL（幂等·不留后台进程）。
  // W5c D-2：child 未 detached——负 pid 组杀不对应进程组（原组杀行无效冗余已删）；整组收割由
  // sampler 自身 finally（detached pgid 整组 SIGKILL）承载。
  if (child.exitCode === null && child.pid) {
    try { child.kill('SIGKILL') } catch { /* 已退出·幂等 */ }
    await sleep(150)
  }
}
const stray = spawnSync('pgrep', ['-f', ${JSON.stringify(B1_PATTERN)}], { encoding: 'utf8' })
let seen = false
try { seen = readFileSync(outFile, 'utf8').split('\\n').filter(Boolean).map((l) => JSON.parse(l)).some((r) => r.processes >= 2) } catch { seen = false }
let markerOk = false
try { markerOk = readFileSync(markerFile, 'utf8') === ${JSON.stringify(B1_PATTERN)} } catch { markerOk = false }
console.log(JSON.stringify({ status: child.exitCode, signal: child.signalCode, positive, strayZero: stray.status === 1, seen, markerOk, outExists: existsSync(outFile) }))
`, 'utf8')
    const b1 = spawnSync(process.execPath, [b1Helper, SELF, b1Cmd, b1Out, b1Marker], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env: envClean() })
    let b1R = null
    try { b1R = JSON.parse(b1.stdout) } catch { b1R = null }
    observed.add(b1R ? b1R.status : null)
    add('B-1/R6-N5 收割完备性·正常退出留孙（r5 活断言）：孙进程启动即写 marker 文件且内容断言＝ORPHAN-MARKER-OK-<run>（W5c D-4·run=自检进程 pid）；pgrep pattern 实匹配孙进程 cmdline（含连字符）＋阳性对照（sampler 运行中同 pattern 命中≥1）＋退出后零残留；JSONL 孙进程在场（RN-4·逐样本 processes≥2）→ child exit 0 后孙进程被 finally 幂等 SIGKILL 兜底 → exit 0/samples 落盘',
      !!b1R && b1R.status === 0 && b1R.signal === null && b1R.markerOk && b1R.seen && b1R.positive && b1R.strayZero && b1R.outExists,
      `helper=${JSON.stringify(b1R)} err=${String(b1.stderr ?? '').slice(0, 80)}`)
    // ── W5c D-2/D-4 增补（helper 无效组杀行删除＋marker 运行唯一化·恰 2 向量·77→79）──
    const b1HelperSrc = readFileSync(b1Helper, 'utf8')
    add('D2① b1 helper 无效组杀行删除（W5c D-2·源码自检）：helper 源不含 process.kill(-child.pid（child 未 detached·负 pid 组杀不对应进程组·无效冗余），仍含 finally／child.kill SIGKILL／150ms 余量（有效兜底保留）',
      !b1HelperSrc.includes('process.kill(-child.pid') && b1HelperSrc.includes('finally') && b1HelperSrc.includes("child.kill('SIGKILL')") && b1HelperSrc.includes('await sleep(150)'),
      `hasKill=${b1HelperSrc.includes('process.kill(-child.pid')}`)
    add('D4① b1 marker 运行唯一化（W5c D-4·同 token 断言）：marker 文件名／文件内容／pgrep token／孙进程 cmdline 同带 run 后缀（run=自检进程 pid·跨运行唯一），跨运行固定 token 不复用',
      (() => {
        const run = String(process.pid)
        const cmdSrc = readFileSync(b1Cmd, 'utf8')
        return B1_PATTERN === `ORPHAN-MARKER-OK-${run}` && b1Marker.endsWith(`orphan-marker-${run}.txt`)
          && cmdSrc.includes(B1_PATTERN) && b1HelperSrc.includes(B1_PATTERN) && !b1HelperSrc.includes('"ORPHAN-MARKER-OK"')
      })(), `pattern=${B1_PATTERN} marker=${basename(b1Marker)}`)
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
    add('B1 写面对象同一性·硬链接预置：O_EXCL 先命中（预存在即拒·写面不可用 exit 3·R5-2 语义下 O_EXCL 先于 nlink 面）且目标件原样未被写',
      rHl.status === 3 && rHl.stderr.includes('[装载错]') && hlOk, `status=${rHl.status} err=${rHl.stderr.slice(0, 140)} victim=${hlOk}`)
    // R4-N5 运行期硬链接：子进程 ln 追加硬链接 → 路径侧 nlink>1 fail-closed → 运行期写失败 exit 1
    const wLn = mkW('ln', (o) => `sleep 0.05; ln '${o}' '${o}.extra'; sleep 1`) // R4-N5 正靶（轮 6）：同 inode nlink=2·仅 nlink 检查可截（dev/ino 不漂移）
    add('R4-N5 运行期硬链接（正靶）：同 inode 追加硬链接（nlink=2·dev/ino 不漂移）→ 路径侧 nlink 检查截获 → 运行期写失败 exit 1/零残留（删 nlink 检查必红）',
      wLn.r.status === 1 && wLn.s && String(wLn.s.error ?? '').includes('多硬链接') && wLn.s.residual_processes === 0,
      `status=${wLn.r.status} out=${wLn.r.stdout.slice(0, 200)}`)
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
    // R4-N6 直系路径两面补齐：--out 直系与 dir_prefixes=[直系] 各一（沙箱唯一名）
    const directOut = `/tmp/w5b-t3-direct-${process.pid}-${Date.now().toString(36)}-out.jsonl`
    const rDirectOut = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', directOut])
    const directPre = `/tmp/w5b-t3-direct-${process.pid}-${Date.now().toString(36)}-dirs`
    const rDirectPre = runCase('direct-pre', [process.execPath, '-e', 'process.exit(0)'], ['--interval-ms', '100'], directPre)
    const directOutGone = safe(() => { rmSync(directOut, { force: true }); return true })
    add('R4-N6 直系路径两面：--out 直系（run exit 0 落盘后清理）与 dir_prefixes=[直系]（readdir ENOENT=已知零·exit 0）均放行',
      rDirectOut.status === 0 && rDirectPre.r.status === 0 && rDirectPre.s?.limit_hit === false && directOutGone,
      `out=${rDirectOut.status} pre=${rDirectPre.r.status} clean=${directOutGone}`)
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
    // R4-N16 两仓根存在性前置断言：不存在则 skip 标注（skip 计 skipped 不计 pass·symlink 面依赖真实仓根）
    const rootsOk = ['/home/yyx/work/aidevorg', '/home/yyx/.zcode/skills/ai-dev-org'].every((r) => existsSync(r))
    if (rootsOk) {
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
    } else {
      skip('W-10/RW-5 仓根 symlink 面拆分：两仓根不存在——前置断言失败按条件跳过（如实登记·skip 不计 pass）', 'repo roots absent')
    }
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
      skip('V-4 删除失败/残留：uid=0 环境 chmod 0555 不构成拒绝面——按 N-1 条件跳过（标注 skipped）', 'uid=0')
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
    // R4-N7 假 pgrep 退出 2 注入运行期 unknown：方言面放行（-f→0）·计数面退出 2 → unknown_counts=true/reaped=false/exit 1
    const fakeDir = join(tmp, 'fakebin'); mkdirSync(fakeDir, { recursive: true })
    writeFileSync(join(fakeDir, 'pgrep'), '#!/bin/sh\nif [ "$1" = "-f" ]; then exit 0; fi\nexit 2\n', 'utf8')
    chmodSync(join(fakeDir, 'pgrep'), 0o755)
    const fpCmd = join(tmp, 'cmd-fakepgrep.json')
    wj(fpCmd, { argv: ['/bin/sh', '-c', 'sleep 0.5'], cwd: tmp, process_pattern: 'node|sh|sleep', dir_prefixes: [tmp] })
    const envFake = { ...envClean(), PATH: fakeDir + ':' + (process.env.PATH ?? '') }
    const rFp = spawnSync(process.execPath, [SELF, '--cmdfile', fpCmd, '--out', join(tmp, 'samples-fakepgrep.jsonl'), '--interval-ms', '100'], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env: envFake })
    observed.add(rFp.status)
    add('R4-N7 假 pgrep 退出 2 注入运行期 unknown：方言面放行·计数面退出 2 → exit 1/unknown_counts=true/reaped=false（禁静默归零）',
      rFp.status === 1 && json(rFp)?.unknown_counts === true && json(rFp)?.reaped === false,
      `status=${rFp.status} out=${rFp.stdout.slice(0, 220)}`)
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
    // R4-N3/R5-1 FIFO 面：O_EXCL 先命中（预存在即拒 3·不悬挂）；O_NONBLOCK＋开后 fstat 非 regular 为防御面（CLI 不可达·如实登记）
    const fifoP = join(tmp, 'out-fifo')
    const mkfifoR = spawnSync('mkfifo', [fifoP], { encoding: 'utf8' })
    if (mkfifoR.status === 0) {
      const rFifo = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', fifoP])
      add('R4-N3/R5-1 FIFO 预存在：O_EXCL 先命中 → exit 3（装载错·不悬挂不阻塞）',
        rFifo.status === 3 && rFifo.stderr.includes('[装载错]') && spawnSync('pgrep', ['-f', 'w5b-t3-resource-sampler.mjs --cmdfile.*out-fifo']).status === 1, `status=${rFifo.status} err=${rFifo.stderr.slice(0, 140)}`)
    } else {
      skip('R4-N3 FIFO 拒收：mkfifo 不可用——条件跳过（标注 skipped）', `mkfifo status=${mkfifoR.status}`)
    }
    // R5-2 预存在 out 拒收（两面）：O_EXCL 先命中——空文件与非空文件均 exit 3
    const emptyOut = join(tmp, 'out-empty.jsonl'); writeFileSync(emptyOut, '', 'utf8')
    const rEe = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', emptyOut])
    add('R5-2 预存在 out（空文件）：O_EXCL → exit 3（out 由本 run 独占创建·写面不可用）',
      rEe.status === 3 && rEe.stderr.includes('预开失败') && safe(() => readFileSync(emptyOut, 'utf8') === ''), `status=${rEe.status} err=${rEe.stderr.slice(0, 140)}`)
    const nonEmpty = join(tmp, 'out-nonempty.jsonl'); writeFileSync(nonEmpty, 'PRE-EXISTING')
    const rNe = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', nonEmpty])
    add('R5-2 预存在 out（非空文件）：O_EXCL 先命中 → exit 3（写面不可用·原内容未动）',
      rNe.status === 3 && rNe.stderr.includes('预开失败') && safe(() => readFileSync(nonEmpty, 'utf8') === 'PRE-EXISTING'), `status=${rNe.status} err=${rNe.stderr.slice(0, 140)}`)
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
    add('B-2 --out 末级 symlink 指向真实文件：预开 O_NOFOLLOW|O_EXCL 拒绝（EEXIST/ELOOP 面·tmp 域内目标 realpath 放行·r6 改回预开面表述）→ exit 3 且目标文件原样未被写',
      rOutSym.status === 3 && rOutSym.stderr.includes('[装载错]') && victimOk, `status=${rOutSym.status} err=${rOutSym.stderr.slice(0, 140)} victim=${victimOk}`)
    // B-2 --out 域外（中间 symlink realpath 落仓根）两仓根各一（R3-N8 补技能仓根面）
    const outLinkA = join(tmp, 'out-link-into-repo')
    try { symlinkSync('/home/yyx/work/aidevorg', outLinkA) } catch { /* 已存在 */ }
    if (rootsOk) {
      const rOutLinkA = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', join(outLinkA, 's.jsonl')])
      add('B-2 --out 域外（中间 symlink realpath 落主仓根）：exit 3 且启动前拒绝（不 spawn 不写仓）',
        rOutLinkA.status === 3 && rOutLinkA.stderr.includes('仓根'), `status=${rOutLinkA.status} err=${rOutLinkA.stderr.slice(0, 140)}`)
    } else {
      skip('B-2 --out 域外（主仓根面）：两仓根不存在——前置断言失败按条件跳过（如实登记·skip 不计 pass）', 'repo roots absent')
    }
    if (rootsOk) {
      const rOutLinkB = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', join(linkB, 's.jsonl')])
      add('B-2 --out 域外（中间 symlink realpath 落技能仓根·R3-N8）：exit 3 且启动前拒绝（不 spawn 不写仓）',
        rOutLinkB.status === 3 && rOutLinkB.stderr.includes('仓根'), `status=${rOutLinkB.status} err=${rOutLinkB.stderr.slice(0, 140)}`)
    } else {
      skip('B-2 --out 域外（技能仓根面·R3-N8）：两仓根不存在——前置断言失败按条件跳过（如实登记·skip 不计 pass）', 'repo roots absent')
    }
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
      skip('RN-2/W-3 unknown 注入：uid=0 环境 chmod 000 不构成 EACCES——按 R3-N2 条件跳过（标注 skipped）', 'uid=0')
    }
    // ── W5b T2 fd 目录句柄与 O_NONBLOCK（恰 4 向量·procfd 缺失时按 skip 记入 Y 并打印原因）──
    const procfdAvailT = existsSync('/proc/self/fd')
    if (procfdAvailT) {
      // T2① 正例 procfd 模式（显式放宽 max-dirs：自检沙箱 tmp 直系子目录数超缺省 20，与本向量判据无关）
      const t2a = runCase('procfd', [process.execPath, '-e', 'process.exit(0)'], ['--max-dirs', '100'])
      add('T2① fd 目录句柄正例：run exit 0 且 summary dirfd_mode=procfd（父目录 dirfd＋procfd 相对预开＋重开清 O_NONBLOCK 全链）',
        t2a.r.status === 0 && t2a.s && t2a.s.dirfd_mode === 'procfd', `status=${t2a.r.status} s=${JSON.stringify(t2a.s).slice(0, 200)}`)
      // T2③ O_NONBLOCK 位已清（out_fd_flags 观测面·显式放宽 max-dirs：自检沙箱 tmp 直系子目录数超缺省 20）
      const t2b = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', join(tmp, 'samples-fdflags.jsonl'), '--max-dirs', '100'], { extraEnv: { [PROBE_FDINFO_ENV]: '1' } })
      const t2bS = json(t2b)
      const fl = t2bS && t2bS.out_fd_flags != null ? parseInt(String(t2bS.out_fd_flags), 8) : null
      add('T2③ O_NONBLOCK 位已清：ORG_RESOURCE_SAMPLER_PROBE_FDINFO=1 → summary out_fd_flags 八进制不含 O_NONBLOCK（0o4000）且保留 O_APPEND（0o2000）',
        t2b.status === 0 && fl !== null && (fl & 0o4000) === 0 && (fl & 0o2000) !== 0, `status=${t2b.status} out_fd_flags=${t2bS?.out_fd_flags}`)
      // T2④ 父目录运行期改名 fail-closed
      const mvDir = join(tmp, 't2-mv'); mkdirSync(mvDir, { recursive: true })
      const mvCmd = join(tmp, 'cmd-t2mv.json')
      wj(mvCmd, { argv: ['sh', '-c', `sleep 0.3; mv '${mvDir}' '${mvDir}.moved'; sleep 1`], cwd: tmp, process_pattern: 'node|sh|sleep', dir_prefixes: [tmp] })
      const t2c = cli(['--cmdfile', mvCmd, '--out', join(mvDir, 's.jsonl'), '--interval-ms', '100', '--max-dirs', '100'])
      const t2cS = json(t2c)
      const movedOk = safe(() => existsSync(join(`${mvDir}.moved`, 's.jsonl')))
      const movedIntact = safe(() => {
        const txt = readFileSync(join(`${mvDir}.moved`, 's.jsonl'), 'utf8')
        return txt.length > 0 && txt.endsWith('\n') && txt.split('\n').filter(Boolean).every((l) => { const o = JSON.parse(l); return typeof o.ts === 'string' && typeof o.dirs === 'number' })
      })
      add('T2④ 父目录运行期改名：父目录 dirfd 同一性双复核 fail-closed → 运行期写失败 exit 1/零残留/dirfd_mode=procfd 在场/迁出文件内容原样（JSONL 完整可解析·r5）',
        t2c.status === 1 && t2cS && String(t2cS.error ?? '').includes('采样写出失败') && t2cS.residual_processes === 0 && t2cS.dirfd_mode === 'procfd' && movedOk && movedIntact,
        `status=${t2c.status} out=${String(t2c.stdout ?? '').slice(0, 200)} moved=${movedOk} intact=${movedIntact}`)
      // T2⑤ cleanup 经最近存在祖先 dirfd
      const cdDir = join(tmp, 't2-cleanup'); mkdirSync(cdDir, { recursive: true })
      const cf1 = join(cdDir, 'c1.txt'), cf2 = join(cdDir, 'c2.txt')
      writeFileSync(cf1, 'C1'); writeFileSync(cf2, 'C2')
      const cReg = join(tmp, 'registry-t2.json'); wj(cReg, { paths: [cf1, cf2] })
      const t2d = cli(['--cleanup', '--registry', cReg])
      const t2dS = json(t2d)
      add('T2⑤ cleanup 经最近存在祖先 dirfd：exit 0/deleted=2/residual=0/dirfd_mode=procfd（装载期 dev/ino 比对保留）',
        t2d.status === 0 && t2dS && t2dS.deleted === 2 && t2dS.residual === 0 && t2dS.dirfd_mode === 'procfd',
        `status=${t2d.status} out=${t2d.stdout.slice(0, 200)}`)
    } else {
      skip('T2① fd 目录句柄正例 dirfd_mode=procfd', 'procfd unavailable（/proc/self/fd 缺失）')
      skip('T2③ O_NONBLOCK 位已清（out_fd_flags 八进制观测）', 'procfd unavailable（/proc/self/fd 缺失）')
      skip('T2④ 父目录运行期改名 fail-closed（dirfd 同一性双复核）', 'procfd unavailable（/proc/self/fd 缺失）')
      skip('T2⑤ cleanup 经最近存在祖先 dirfd', 'procfd unavailable（/proc/self/fd 缺失）')
    }
    // ── W5b T3 N 级登记全处置（恰 3 向量）──
    const n13Cmd = join(tmp, 'cmd-n13.json')
    wj(n13Cmd, { argv: [process.execPath, '-e', 'process.exit(0)'], cwd: tmp, process_pattern: 'node|sh|sleep', dir_prefixes: [tmp, 123] })
    const n13 = cli(['--cmdfile', n13Cmd, '--out', join(tmp, 'samples-n13.jsonl')])
    add('R4-N13 dir_prefixes 元素非字符串：checkTmpPath 承担类型校验 → 装载错 exit 3（原文未随档·登记处置=零逻辑改动·不虚构）',
      n13.status === 3 && n13.stderr.includes('[装载错]'), `status=${n13.status} err=${n13.stderr.slice(0, 140)}`)
    const n14a = join(tmp, 'n14-a'), n14b = join(tmp, 'n14-b')
    mkdirSync(join(n14a, 'sub-a'), { recursive: true }); mkdirSync(join(n14b, 'sub-b'), { recursive: true })
    const n14Cmd = join(tmp, 'cmd-n14.json')
    wj(n14Cmd, { argv: [process.execPath, '-e', 'setTimeout(()=>{},400)'], cwd: tmp, process_pattern: 'node|sh|sleep', dir_prefixes: [n14a, n14b] })
    const n14Out = join(tmp, 'samples-n14.jsonl')
    const n14 = cli(['--cmdfile', n14Cmd, '--out', n14Out, '--interval-ms', '100'])
    const n14Dirs = safe(() => readFileSync(n14Out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).dirs), [])
    const n14Ok = n14.status === 0 && Array.isArray(n14Dirs) && n14Dirs.length >= 2 && n14Dirs.every((d) => d === 2) && json(n14)?.peak_dirs === 2
    add('R4-N14 countDirs 逐样本快照：两前缀各一子目录 → 每样本恒 dirs=2、跨样本不累积、peak_dirs=2（peak 取最大值）',
      n14Ok, `status=${n14.status} dirs=${JSON.stringify(n14Dirs)} peak=${json(n14)?.peak_dirs}`)
    const n15Out = join(tmp, 'samples-n15.jsonl')
    const n15First = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', n15Out, '--max-dirs', '100'])
    const n15Second = cli(['--cmdfile', join(tmp, 'cmd-ok.json'), '--out', n15Out, '--max-dirs', '100'])
    add('R4-N15 同 out 第二次运行：首跑 exit 0 落盘后重跑同 out → O_EXCL 跨 run 独占拒＝装载错 exit 3（重试须先 rm 同一 out·R6-N4）',
      n15First.status === 0 && n15Second.status === 3 && n15Second.stderr.includes('[装载错]'), `first=${n15First.status} second=${n15Second.status} err=${n15Second.stderr.slice(0, 140)}`)
    // 退出域：全部观测退出码 ∈ {0,1,3}（无 2）
    add('D-1 退出域：全部观测退出码 ∈ {0,1,3}（无 2）', [...observed].every((s) => s === 0 || s === 1 || s === 3), JSON.stringify([...observed].sort((a, b) => a - b)))
  } finally {
    try { chmodSync(tmp, 0o755) } catch { /* 已不在 */ }
    rmSync(tmp, { recursive: true, force: true })
  }
  const { total, pass, skip: skipN, fail } = summarizeSelfTest(cases)
  void total
  return { cases, pass, skip: skipN, fail }
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main()
