/**
 * ledger-migrate（B1 工件 D；B8 清障批硬化）：账本按项目拆迁四子命令＋演练模式＋自检。
 * 语义单源=docs/tasks/B1-gates-ledger-flags.md D-5（候选快照受控交接）＋D-13②（受控回退）。
 * 归属键=project_id ?? project（02 §9）；ai-dev-org 行→项目账本，其余→隔离件（源相对序；归一化分组仅用于 dry-run/候选件计数与待裁登记）。
 * 子命令：--dry-run（只读产候选件）／--apply --candidate <file>（复算源三项逐项全等才写·不符 exit 1；目标件已存在非空=exit 1 拒——D-13① append-only）／
 * --verify（冻结源锚＋两目标快照段保序对账＋合法追加排除回显；manifest 结构破损=装载错 3·内容不符=判定红 1——R15 统一口径；source 字段级形态破损同归装载错族——W-2）／
 * --rollback --manifest <file>（前置=verify 判红；旧账本受控追加 schema v3 event=stopped 异常行——D-13② 唯一例外）。
 * 演练：--fixture-root <dir>（label→source/project/quarantine/candidate.json·manifest 显式或缺省）——realpath 三面 containment＋symlink 载体拒（R14/R14b）＋既存写目标 nlink>1 硬链拒（W-1·生产写侧同守卫）·写路径全限定夹具根。
 * 生产：源/隔离/候选=SKILL_ROOT/.zcode/ 同名件（隔离件 env ORG_QUARANTINE_PATH=内部测试设施）；项目账本=ledgerPathFor(projectRoot) 真派生（R13——apply/verify/
 * rollback 共用同一派生路径·非默认 ledger_path 端到端支持；manifest label=身份串不作路径展开）；项目根=resolveProjectRoot（--project＞projects ai-dev-org {root} 注册项＞
 * homedir 相对约定回退·stdout 回显 root 与依据；org-config 装载异常 exit 3 不吞）。锁=目标账本同目录 <ledger>.lock。退出码口径单源=06 §5.8（不复写）。
 * B8 D-1 hermetic：--self-test 24 向量全自包含（/tmp 隔离技能根＋合成源/合成 manifest——零宿主真实源、manifest、local 或 homedir 依赖；
 *   真实两仓零写断言移出 self-test，由 V-01 外部前后哈希独立复核）。
 * B8 D-2 写侧：候选件/项目账本/隔离件/manifest/rollback 追加全部经 secureWriteFile（O_NOFOLLOW 打开且不带 O_TRUNC→持 fd fstatSync 最终身份判定
 *   〔非普通文件/nlink>1 拒〕→同 fd 读〔append 时〕/ftruncate/完整写回→finally 关 fd）；预检 lstat 仅作提前提示，不再是写前安全证明。
 * B8 D-3 平台分支：hardlinkWritePolicy 单源——本机实证平台=linux（O_NOFOLLOW 持 fd＋nlink 判定·Linux 硬链负例实测）；win32=对既存写目标
 *   fail-closed 静态保守分支（仅允许独占创建新目标·nlink 不作跨平台充分证据）；无可靠 O_NOFOLLOW 平台=拒绝写（装载族）。
 *   win32/unsupported 为静态设计判据，未做跨机/跨设备实证（cross_machine_tested=false）。
 * B8 D-4 notice：CLI 预检通过后、业务装载前向 stderr 打 [notice] ORG_QUARANTINE_PATH=default:/override: 单行（只显示路径与来源，不读不印状态内容）。
 * B8 D-5 预检：参数组合闭集前置校验（16 非法例族）——一切装载与写入之前 exit 1；合法命令装载失败=3；内容判红=1；2 永不发。
 * B8 r4 哨兵：--self-test 入口检测 env ORG_B8_TEST_DEPTH 即固定 exit 1 并输出逐字标记行（防自检副本递归放大）；自检内部 spawn 一律显式 env、不携带该键。
 */
import fs, { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, realpathSync, symlinkSync, lstatSync, linkSync, copyFileSync, openSync, writeSync, readSync, closeSync, fstatSync, ftruncateSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { SKILL_ROOT, withFileLock, cliFlag, UsageError, loadOrgConfig, ledgerPathFor } from './org-config.mjs'

const AI_PROJECT = 'ai-dev-org'
const LABEL_SOURCE = 'skill:.zcode/org-ledger.jsonl'
const LABEL_PROJECT = 'project:.zcode/org-ledger.jsonl'
const LABEL_QUARANTINE = 'skill:.zcode/org-ledger.quarantine.jsonl'
const CANDIDATE_SCHEMA = 'ledger-migrate-candidate/1'
const MANIFEST_SCHEMA = 'ledger-migration/1'
const MAIN_REPO_MARKER = 'docs/agent-matrix.json'
const sha256Buf = (b) => createHash('sha256').update(b).digest('hex')
const sha256Text = (s) => sha256Buf(Buffer.from(String(s), 'utf8'))
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))

// ── B8 D-3：平台写侧策略单源（纯函数·可单测；仅 linux 本机实证，其余为静态保守判据）──
export function hardlinkWritePolicy(platform = process.platform) {
  if (platform === 'linux' || platform === 'darwin' || platform === 'freebsd' || platform === 'openbsd' || platform === 'netbsd')
    return { mode: 'held-fd-nlink', note: 'POSIX O_NOFOLLOW 可用：持 fd fstat 身份判定＋nlink>1 拒（本机 linux 实证；其余 POSIX 为文档判据未实测）' }
  if (platform === 'win32')
    return { mode: 'fail-closed-existing', note: 'win32 静态保守分支：既存写目标拒绝写入，仅允许独占创建新目标（nlink 不作跨平台充分证据；未实测）' }
  return { mode: 'reject-write', note: '平台缺少可靠 O_NOFOLLOW 写侧防护：拒绝写（fail-closed·未实测）' }
}

// ── B8 D-2：安全写助手（候选件/项目账本/隔离件/manifest/rollback 追加唯一写通道）──
// 测试注入点 secureWriteHook.preOpen：仅自检⑱⑲⑳（open 前换路径模拟「预检后路径替换」TOCTOU 窗）；
// 触发即复位防泄漏；默认生产调用恒 null，无环境延时开关。
export const secureWriteHook = { preOpen: null }
const writeAll = (fd, data) => { const b = Buffer.from(data, 'utf8'); let off = 0; while (off < b.length) off += writeSync(fd, b, off, b.length - off) }
export function secureWriteFile(p, content, { append = false, kind = '写目标', policy = null } = {}) {
  const pol = policy || hardlinkWritePolicy()
  if (pol.mode === 'reject-write') { const e = new Error(`${kind}拒绝写入：平台缺少可靠 O_NOFOLLOW 写侧防护（hardlinkWritePolicy=reject-write·fail-closed·未跨机实测——B8 D-3）`); e.code = 'PLATFORM_UNSUPPORTED'; throw e }
  if (pol.mode === 'fail-closed-existing') { // win32 静态保守分支（未实测）：既存目标 fail-closed；新目标独占创建
    if (existsSync(p)) throw new UsageError(`${kind}既存目标在 win32 平台策略下拒绝写入（fail-closed·静态保守分支未实测；仅允许独占创建新目标——B8 D-3）`)
    let fd = -1
    try { fd = openSync(p, 'wx'); writeAll(fd, content) } finally { if (fd >= 0) closeSync(fd) }
    return
  }
  // held-fd-nlink（linux 实证）：O_NOFOLLOW 打开（不带 O_TRUNC）→ 持 fd fstat 最终身份判定 → 同 fd 读/截/写回
  if (secureWriteHook.preOpen) { const h = secureWriteHook.preOpen; secureWriteHook.preOpen = null; h(p) } // 一次性注入（触发即复位防泄漏）
  let fd = -1
  try {
    try { fd = openSync(p, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o644) } catch (e) {
      if (e && e.code === 'ELOOP') throw new UsageError(`${kind}为符号链接（O_NOFOLLOW 持 fd 打开拒——写穿越界面；预检后路径替换亦被本判定闭合——B8 D-2）`)
      throw e
    }
    const st = fstatSync(fd)
    if (!st.isFile()) throw new UsageError(`${kind}非普通文件（持 fd fstat 身份判定拒写——B8 D-2）`)
    if (st.nlink > 1) throw new UsageError(`${kind}为硬链接（持 fd fstat nlink=${st.nlink}——共享 inode 写穿越界面·一律拒——B8 D-2/W-1）`)
    let final = content
    if (append) { // 从同一 fd 读取现有内容（append 语义与旧 appendLedgerLine 一致：缺尾换行补齐后拼接）
      const buf = Buffer.alloc(65536)
      const chunks = []
      let pos = 0, nRead = 0
      while ((nRead = readSync(fd, buf, 0, buf.length, pos)) > 0) { chunks.push(Buffer.from(buf.subarray(0, nRead))); pos += nRead }
      const cur = Buffer.concat(chunks).toString('utf8')
      final = (cur && !cur.endsWith('\n') ? cur + '\n' : cur) + content
    }
    ftruncateSync(fd, 0)
    writeAll(fd, final)
  } finally { if (fd >= 0) closeSync(fd) } // fd 必关（异常路径同）
}

// ── 自检（D-9/R14＋B8 D-1/D-2/D-3/D-4/D-5：24 向量；夹具一律 os.tmpdir() 与 /tmp 隔离技能根，零宿主依赖）──
function selfTest() {
  let fails = 0, n = 0
  const t = (name, cond) => (n++, console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`), cond || fails++)
  const row = (ts, sv, rid, proj, pid, ev, x = {}) => ({ ts, schema_version: sv, runId: rid, project: proj, ...(pid ? { project_id: pid } : {}), event: ev, role: 'executor', tier: 'impl', source: 's', cfg_hash: 'h', outcome: 'o', ...x })
  let fx = null
  let isoCtx = null // ⑬ 建立的隔离技能根上下文（⑯/㉒/㉓ 复用；统一清理于外层 finally——单层隔离·禁嵌套自拷贝）
  try {
    fx = mkdtempSync(join(tmpdir(), 'ledger-migrate-st-'))
    // 合成源：ai-dev-org×4＋waterprint 两旧形（前斜杠/E:\ 反斜杠）＋synapse＋mocked tmp 行
    const rows = [
      row('2026-01-01T00:00:00Z', 3, 'st-1', AI_PROJECT, AI_PROJECT, 'switch', { source: 's1' }), row('2026-01-02T00:00:00Z', 'v3', 'st-2', 'raw-old', AI_PROJECT, 'ok', { source: 's1' }),
      row('2026-01-03T00:00:00Z', 2, 'st-3', AI_PROJECT, null, 'ruling', { role: 'controller', tier: 'manual', source: 'm' }), row('2026-01-04T00:00:00Z', undefined, 'st-4', AI_PROJECT, null, 'doc-health', { role: 'controller', tier: 'manual', source: 'm' }),
      row('2026-01-05T00:00:00Z', 3, 'st-5', 'E:\\class\\waterprint', 'E:\\class\\waterprint', 'ok', { source: 's2' }), row('2026-01-06T00:00:00Z', 3, 'st-6', '/pid/waterprint', '/pid/waterprint', 'ok', { source: 's2' }),
      row('2026-01-07T00:00:00Z', 3, 'st-7', 'Synapse', 'Synapse', 'ok', { source: 's3' }), row('2026-01-08T00:00:00Z', 2, 'st-8', 'C:/Temp/tmp.DrillX', null, 'switch', { mocked: true, role: 'gate1-reviewer', tier: 'audit', source: 's4' }),
    ]
    const srcPath = join(fx, 'source.jsonl')
    writeFileSync(srcPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    const shaA0 = sha256Buf(readFileSync(srcPath)) // B8 ⑧ 合成哨兵 A：fixture A 内 source.jsonl（dry-run/apply/verify 实际读取的具名输入）
    t('① dry-run 逐组计数/零漂移（waterprint 两旧形并组＋mocked 组＋组和=源行数）', typeof runDryRun === 'function' && (() => {
      const cand = runDryRun({ fixtureRoot: fx })
      const c = JSON.parse(readFileSync(join(fx, 'candidate.json'), 'utf8'))
      const s = (o) => Object.values(o).reduce((a, b) => a + b, 0)
      return cand === true && c.schema === 'ledger-migrate-candidate/1' && c.source.lines === 8 && c.total === 8 && c.groups['ai-dev-org'] === 4 && c.groups.waterprint === 2 && c.groups.synapse === 1 && c.groups.mocked === 1 && s(c.groups) === 8 && s(c.schema_dist) === 8
    })())
    t('② apply 隔离件源相对序＋分组计数正确（非文件物理分组）＋verify 绿基线', typeof runApply === 'function' && typeof runVerify === 'function' && (() => {
      const a = runApply({ fixtureRoot: fx, candidate: join(fx, 'candidate.json') })
      const q = readFileSync(join(fx, 'quarantine.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
      const mf = JSON.parse(readFileSync(join(fx, 'manifest.json'), 'utf8'))
      const p = readFileSync(join(fx, 'project.jsonl'), 'utf8').trim().split('\n')
      const orderOk = q.length === 4 && q[0].project_id === 'E:\\class\\waterprint' && q[1].project_id === '/pid/waterprint' && q[2].project_id === 'Synapse' && q[3].mocked === true
      return a === true && orderOk && p.length === 4 && mf.targets[0].lines === 4 && mf.targets[1].lines === 4 && mf.targets[0].line_sha256.length === 4 && runVerify({ fixtureRoot: fx, manifest: join(fx, 'manifest.json') }) === true
    })())
    t('③ apply 目标守卫：首 apply 后追加→再 apply 拒（exit 1 族）＋两目标行数不变（零截断）', typeof runApply === 'function' && (() => {
      const pj = join(fx, 'project.jsonl'), qj = join(fx, 'quarantine.jsonl')
      const nP = splitLines(readFileSync(pj, 'utf8')).length, nQ = splitLines(readFileSync(qj, 'utf8')).length
      appendLedgerLine(pj, JSON.stringify(row('2026-01-09T00:00:00Z', 3, 'st-9', AI_PROJECT, AI_PROJECT, 'switch')))
      let threw = null
      try { runApply({ fixtureRoot: fx, candidate: join(fx, 'candidate.json') }) } catch (e) { threw = e }
      return threw !== null && threw.code === 'TARGET_EXISTS' && splitLines(readFileSync(pj, 'utf8')).length === nP + 1 && splitLines(readFileSync(qj, 'utf8')).length === nQ
    })())
    const midA = sha256Buf(readFileSync(srcPath)) // ⑧ 检查点1：①②③（dry-run/apply/守卫拒）后源不变
    const srcKeep = rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
    t('④ manifest 哈希锚篡改检出（冻结源改一字节→verify 红）', typeof runVerify === 'function' && (() => {
      writeFileSync(srcPath, readFileSync(srcPath, 'utf8').replace('st-1', 'st-X'))
      return runVerify({ fixtureRoot: fx, manifest: join(fx, 'manifest.json') }) === false
    })())
    writeFileSync(srcPath, srcKeep) // ④ 构造态复原（篡改-复原成对）
    const restA = sha256Buf(readFileSync(srcPath)) // ⑧ 检查点2：复原正确性
    const structCase = (idx, empty) => { const mp = join(fx, 'manifest.json'), keep = readFileSync(mp, 'utf8'); const mf = JSON.parse(keep); mf.targets[idx].line_sha256 = empty ? [] : mf.targets[idx].line_sha256.slice(0, -1); writeFileSync(mp, JSON.stringify(mf)); let code = null; try { runVerify({ fixtureRoot: fx, manifest: mp }) } catch (e) { code = e.code } writeFileSync(mp, keep); return code === 'MANIFEST_MISSING' }
    t('⑤ manifest 结构：targets[0].line_sha256 截短→MANIFEST_MISSING（exit 3 族·project 段）', typeof runVerify === 'function' && structCase(0, false))
    t('⑥ manifest 结构：targets[1].line_sha256 清空→MANIFEST_MISSING（exit 3 族·quarantine 段）', typeof runVerify === 'function' && structCase(1, true))
    // ⑧ 检查点3：⑤⑥（verify 只读）后源不变；注入负例：向 A 的 source.jsonl 追加一行→同哨兵断言必红（无注入恒真不得计为通过）
    const endA = sha256Buf(readFileSync(srcPath))
    const aSame = midA === shaA0 && restA === shaA0 && endA === shaA0
    const aKeep = readFileSync(srcPath, 'utf8')
    writeFileSync(srcPath, aKeep + JSON.stringify(row('2026-01-10T00:00:00Z', 3, 'st-inject', AI_PROJECT, AI_PROJECT, 'switch')) + '\n')
    const injectRed = sha256Buf(readFileSync(srcPath)) !== shaA0
    writeFileSync(srcPath, aKeep) // 复原（A 段余下向量不再读源；保持夹具整洁）
    rmSync(fx, { recursive: true, force: true })
    fx = mkdtempSync(join(tmpdir(), 'ledger-migrate-st2-'))
    const rowsA = [row('2026-02-01T00:00:00Z', 3, 'sa-1', AI_PROJECT, AI_PROJECT, 'switch', { source: 's1' }), row('2026-02-02T00:00:00Z', 2, 'sa-2', 'hjjc', null, 'ruling', { role: 'controller', tier: 'manual', source: 'm' })]
    const src2 = join(fx, 'source.jsonl')
    writeFileSync(src2, rowsA.map((r) => JSON.stringify(r)).join('\n') + '\n')
    const shaB0 = sha256Buf(readFileSync(src2)) // ⑧ 合成哨兵 B：fixture B 内 source.jsonl
    const stale = typeof runDryRun === 'function' && runDryRun({ fixtureRoot: fx }) === true
    const bSame = sha256Buf(readFileSync(src2)) === shaB0 // dry-run 只读哨兵（stale 构造追加发生在其之后）
    if (stale) writeFileSync(src2, readFileSync(src2, 'utf8') + JSON.stringify(row('2026-02-03T00:00:00Z', 3, 'sa-3', AI_PROJECT, AI_PROJECT, 'switch', { source: 's1' })) + '\n') // 批准后源追加一行
    let threw = null
    try { if (typeof runApply === 'function') runApply({ fixtureRoot: fx, candidate: join(fx, 'candidate.json') }) } catch (e) { threw = e }
    const staleRejected = threw !== null && String(threw.message || threw).includes('源已变动')
    const zeroWrite = !existsSync(join(fx, 'project.jsonl')) && !existsSync(join(fx, 'quarantine.jsonl')) && !existsSync(join(fx, 'manifest.json'))
    t('⑦ stale candidate：批准后源追加→apply 拒（exit 1 族）＋目标与 manifest 零写入', staleRejected && zeroWrite)
    t('⑧ 合成快照哨兵（B8 hermetic 化）：fixture A/B 内 source.jsonl（dry-run/apply/verify 实际读取的具名输入）操作前后 sha256 不变＋注入追加后同断言判红（真实两仓零写断言移出 self-test，由 V-01 外部前后哈希独立复核）', aSame && bSame && injectRed && String(fx).startsWith(tmpdir()))
    const multi = { synapse: 'synapse', 'ai-dev-org': { id: AI_PROJECT, root: '/synthetic/proj-root' }, waterprint: 'waterprint' }
    const rr = typeof resolveProjectRoot === 'function' ? resolveProjectRoot(null, multi) : null
    t('⑨ R2 定址：多 projects 分区按 ai-dev-org 身份注册项确定性解析（不按枚举序首中）', !!rr && rr.root === '/synthetic/proj-root' && String(rr.basis).includes('身份注册'))
    t('⑩ R13 派生（B8 R1 隔离化）：合成 merged 注入 migratePaths→ledgerPathFor 三层序真派生（非默认 ledger_path→相对项目根解析；默认→恒等映射）——零读真实 default/local（原直跑旁路消除）', typeof migratePaths === 'function' && (() => {
      const proj = mkdtempSync(join(tmpdir(), 'lm-r13-'))
      try {
        const custom = migratePaths({ projectRoot: proj, mergedOverride: { ledger_path: 'custom/ledger.jsonl' } })
        const dflt = migratePaths({ projectRoot: join(proj, 'd2'), mergedOverride: {} })
        return custom.projectLedger === join(proj, 'custom', 'ledger.jsonl') && dflt.projectLedger === join(proj, 'd2', '.zcode', 'org-ledger.jsonl')
      } finally { rmSync(proj, { recursive: true, force: true }) }
    })())
    // ⑬ B8 D-1 hermetic 化：/tmp 隔离技能根（复制两脚本＋最小合成 default={}＋合成源）经显式 --project 与
    // 临时 ORG_QUARANTINE_PATH＋空 HOME 跑非默认 ledger_path 全链 E2E——不读任何真实源/manifest/local/homedir。
    // 单层隔离：iso 根只建一层；内部 spawn 均为业务子命令（非递归 --self-test），显式 env 不携带 ORG_B8_TEST_DEPTH。
    isoCtx = (() => {
      const iso = mkdtempSync(join(tmpdir(), 'lm-iso-'))
      const home = mkdtempSync(join(tmpdir(), 'lm-iso-home-'))
      mkdirSync(join(iso, 'scripts'), { recursive: true })
      copyFileSync(fileURLToPath(import.meta.url), join(iso, 'scripts', 'ledger-migrate.mjs'))
      copyFileSync(join(SKILL_ROOT, 'scripts', 'org-config.mjs'), join(iso, 'scripts', 'org-config.mjs'))
      writeFileSync(join(iso, 'org-config.default.json'), '{}\n')
      mkdirSync(join(iso, '.zcode'), { recursive: true })
      const rowsIso = [row('2026-04-01T00:00:00Z', 3, 'iso-1', AI_PROJECT, AI_PROJECT, 'ok'), row('2026-04-02T00:00:00Z', 3, 'iso-2', 'elsewhere', 'elsewhere', 'ok')]
      writeFileSync(join(iso, '.zcode', 'org-ledger.jsonl'), rowsIso.map((r) => JSON.stringify(r)).join('\n') + '\n')
      const proj = join(iso, 'proj')
      mkdirSync(join(proj, '.zcode'), { recursive: true })
      writeFileSync(join(proj, '.zcode', 'org-config.json'), JSON.stringify({ ledger_path: 'custom/ledger.jsonl' }))
      const env = { PATH: process.env.PATH, HOME: home, ORG_QUARANTINE_PATH: join(iso, 'q.jsonl') } // 外来 env 显式重定向（B8 D-4/r4 哨兵键不进入子进程）
      return { iso, home, proj, env, script: join(iso, 'scripts', 'ledger-migrate.mjs'), manifest: join(proj, 'm.json') }
    })()
    t('⑬ R13 E2E（B8 hermetic 化）：隔离技能根复制两脚本＋default={}＋合成源，经显式 --project 与临时 ORG_QUARANTINE_PATH＋空 HOME 跑非默认 ledger_path 全链 dry-run→apply→verify——零宿主真实源/manifest/local/HOME 依赖', (() => {
      const runIso = (args) => spawnSync(process.execPath, [isoCtx.script, ...args], { encoding: 'utf8', env: isoCtx.env, timeout: 60_000 })
      const cand = join(isoCtx.proj, 'cand.json')
      const r1 = runIso(['--dry-run', '--project', isoCtx.proj, '--candidate', cand])
      const r2 = runIso(['--apply', '--candidate', cand, '--project', isoCtx.proj, '--manifest', isoCtx.manifest])
      const derived = join(isoCtx.proj, 'custom', 'ledger.jsonl')
      const r3 = runIso(['--verify', '--project', isoCtx.proj, '--manifest', isoCtx.manifest])
      return r1.status === 0 && r2.status === 0 && r3.status === 0 && existsSync(derived) && splitLines(readFileSync(derived, 'utf8')).length === 1 && existsSync(join(isoCtx.iso, 'q.jsonl')) && splitLines(readFileSync(join(isoCtx.iso, 'q.jsonl'), 'utf8')).length === 1
    })())
    t('⑭ R14 负例①：夹具内符号链接指向夹具外→用法错拒', (() => {
      const fx = mkdtempSync(join(tmpdir(), 'lm-r14a-')), outside = join(tmpdir(), 'lm-r14-outside.json')
      try {
        writeFileSync(outside, 'x')
        symlinkSync(outside, join(fx, 'link.jsonl'))
        try { migratePaths({ fixtureRoot: fx, candidate: join(fx, 'link.jsonl') }); return false } catch (e) { return e instanceof UsageError && String(e.message).includes('符号链接') }
      } finally { rmSync(fx, { recursive: true, force: true }); rmSync(outside, { force: true }) }
    })())
    t('⑭b R14b 负例：悬空 symlink 候选件→拒＋夹具外零落盘（对照组：正常 dry-run 绿）', typeof migratePaths === 'function' && typeof runDryRun === 'function' && (() => {
      const fx = mkdtempSync(join(tmpdir(), 'lm-r14c-')), outside = join(tmpdir(), 'lm-r14b-escape-' + process.pid + '.json')
      try {
        symlinkSync(outside, join(fx, 'dangling.jsonl')) // 悬空：outside 此刻不存在
        let rejected = false
        try { migratePaths({ fixtureRoot: fx, candidate: join(fx, 'dangling.jsonl') }) } catch (e) { rejected = e instanceof UsageError && String(e.message).includes('悬空') }
        const control = rejected && (() => { try { migratePaths({ fixtureRoot: fx, candidate: join(fx, 'candidate.json') }); return true } catch { return false } })() // 对照组：正常候选件 confine 绿
        return rejected && control && !existsSync(outside) // 夹具外零落盘
      } finally { rmSync(fx, { recursive: true, force: true }); rmSync(outside, { force: true }) }
    })())
    t('⑮ R14 负例②：fixture-root 自身为指向夹具外的符号链接→用法错拒', (() => {
      const real = mkdtempSync(join(tmpdir(), 'lm-r14b-')), link = join(tmpdir(), 'lm-r14-link-' + process.pid)
      try {
        symlinkSync(real, link)
        try { migratePaths({ fixtureRoot: link, candidate: join(link, 'candidate.json') }); return false } catch (e) { return e instanceof UsageError && String(e.message).includes('符号链接') }
      } finally { rmSync(link, { force: true }); rmSync(real, { recursive: true, force: true }) }
    })())
    // ⑯ B8 D-1 hermetic 化：以⑬隔离 apply 产出的合成 manifest 只读副本逐型变异，真 CLI 子进程断言 exit 3/1
    t('⑯ R15 CLI（B8 合成 manifest）：隔离 apply 产出 manifest 副本变异（schema 错/缺 source/source 字段级八型/targets 数量不符→真 exit 3；line_sha256 内容变异→真 exit 1）', (() => {
      const raw = readFileSync(isoCtx.manifest, 'utf8')
      const mk = (mut) => { const p2 = join(tmpdir(), 'lm-r15-' + Math.random().toString(36).slice(2) + '.json'); writeFileSync(p2, mut(raw)); return p2 }
      const runCli = (mp) => spawnSync(process.execPath, [isoCtx.script, '--verify', '--project', isoCtx.proj, '--manifest', mp], { encoding: 'utf8', env: isoCtx.env, timeout: 60_000 }).status
      const bads = [
        mk((t) => JSON.stringify({ ...JSON.parse(t), schema: 'ledger-migration/9' })),
        mk((t) => { const m = JSON.parse(t); delete m.source; return JSON.stringify(m) }),
        mk((t) => { const m = JSON.parse(t); m.targets = m.targets.slice(0, 1); return JSON.stringify(m) }),
        mk((t) => JSON.stringify({ ...JSON.parse(t), source: {} })), // W-2：整体空
        mk((t) => JSON.stringify({ ...JSON.parse(t), source: 'bad' })), // W-2：整体类型错
        mk((t) => { const m = JSON.parse(t); delete m.source.label; return JSON.stringify(m) }), // W-2：label 缺失
        mk((t) => { const m = JSON.parse(t); m.source.label = 7; return JSON.stringify(m) }), // W-2：label 类型错
        mk((t) => { const m = JSON.parse(t); delete m.source.lines; return JSON.stringify(m) }), // W-2：lines 缺失
        mk((t) => { const m = JSON.parse(t); m.source.lines = '717'; return JSON.stringify(m) }), // W-2：lines 类型错
        mk((t) => { const m = JSON.parse(t); delete m.source.sha256; return JSON.stringify(m) }), // W-2：sha256 缺失
        mk((t) => { const m = JSON.parse(t); m.source.sha256 = 'zz'; return JSON.stringify(m) }), // W-2：sha256 类型错
      ]
      const content = mk((t) => t.replace(/("line_sha256": \[\s*")([0-9a-f])/, (mm, g1, g2) => g1 + '0'))
      const codes = [...bads.map(runCli), runCli(content)]
      for (const p2 of [...bads, content]) rmSync(p2, { force: true })
      return codes.slice(0, -1).every((c) => c === 3) && codes[codes.length - 1] === 1
    })())
    t('⑪ R2 配置破损不吞：CLI 装载 catch 分支持 exit 3（tripwire·源面断言）', (() => { const src = readFileSync(fileURLToPath(import.meta.url), 'utf8'); return /装载失败：\$\{e\.message\}（返工 R2[^）]*）[\s\S]{0,80}process\.exit\(3\)/.test(src) })())
    t('⑫ R3 漏网负例：fixture 模式 candidate 越出夹具根→用法错拒（migratePaths 围栏）', (() => { try { if (typeof migratePaths === 'function') migratePaths({ fixtureRoot: '/synthetic/fx', candidate: '/synthetic/outside/candidate.json' }); return false } catch (e) { return e instanceof UsageError && String(e.message).includes('夹具根') } })())
    t('⑰ W-1 负例：夹具内硬链候选件（fs.link→夹具外受害件）→dry-run 用法错拒＋受害件内容零改写（红态=守卫缺席时写穿实改·round3 主席席复算同型）', typeof runDryRun === 'function' && (() => {
      const fx = mkdtempSync(join(tmpdir(), 'lm-w1-')), victim = join(tmpdir(), 'lm-w1-victim-' + process.pid + '.json')
      try {
        writeFileSync(join(fx, 'source.jsonl'), JSON.stringify(row('2026-03-01T00:00:00Z', 3, 'w1-1', AI_PROJECT, AI_PROJECT, 'switch')) + '\n')
        writeFileSync(victim, '{"victim":"pristine"}')
        linkSync(victim, join(fx, 'candidate.json')) // 硬链无 realpath 痕迹——containment 必过·唯 nlink 可辨
        let rejected = false; try { runDryRun({ fixtureRoot: fx }) } catch (e) { rejected = e instanceof UsageError && String(e.message).includes('硬链接') }
        return rejected && readFileSync(victim, 'utf8') === '{"victim":"pristine"}' // 拒收＋夹具外零改写双断言
      } finally { rmSync(fx, { recursive: true, force: true }); rmSync(victim, { force: true }) }
    })())
    // ── B8 D-2 三向量：预检后路径替换负例（open 前注入点换路径；默认生产调用不注入、无环境延时开关）──
    t('⑱ B8 D-2 fd 负例（candidate dry-run 写点）：预检后 candidate.json 替换为指向受害件的 symlink→O_NOFOLLOW 持 fd 拒（判红族）＋victim 字节不变＋hook 复位', typeof secureWriteFile === 'function' && typeof secureWriteHook === 'object' && (() => {
      const fx = mkdtempSync(join(tmpdir(), 'lm-b8-18-')), victim = join(tmpdir(), 'lm-b8-18-v-' + process.pid + '.json')
      try {
        writeFileSync(join(fx, 'source.jsonl'), JSON.stringify(row('2026-05-01T00:00:00Z', 3, 'e18-1', AI_PROJECT, AI_PROJECT, 'switch')) + '\n')
        writeFileSync(join(fx, 'candidate.json'), '{"old":true}\n') // 预置普通候选件：confine/lstat 预检全过
        writeFileSync(victim, '{"victim":"pristine"}')
        const cPath = join(fx, 'candidate.json')
        secureWriteHook.preOpen = (p) => { if (p === cPath) { rmSync(cPath); symlinkSync(victim, cPath) } }
        let threw = null
        try { runDryRun({ fixtureRoot: fx }) } catch (e) { threw = e }
        return threw instanceof UsageError && String(threw.message).includes('符号链接') && readFileSync(victim, 'utf8') === '{"victim":"pristine"}' && secureWriteHook.preOpen === null
      } finally { rmSync(fx, { recursive: true, force: true }); rmSync(victim, { force: true }); secureWriteHook.preOpen = null }
    })())
    t('⑲ B8 D-2 fd 负例（apply 写目标）：writeLedgerFile open 前 project.jsonl 替换为指向受害件的 symlink→持 fd 拒＋victim 不变＋apply 未落 manifest', typeof secureWriteFile === 'function' && (() => {
      const fx = mkdtempSync(join(tmpdir(), 'lm-b8-19-')), victim = join(tmpdir(), 'lm-b8-19-v-' + process.pid + '.json')
      try {
        writeFileSync(join(fx, 'source.jsonl'), JSON.stringify(row('2026-05-02T00:00:00Z', 3, 'e19-1', AI_PROJECT, AI_PROJECT, 'switch')) + '\n')
        runDryRun({ fixtureRoot: fx })
        writeFileSync(victim, '{"victim":"pristine"}')
        const pj = join(fx, 'project.jsonl')
        secureWriteHook.preOpen = (p) => { if (p === pj) symlinkSync(victim, pj) } // 目标缺席→直接以 symlink 占位（open 前替换）
        let threw = null
        try { runApply({ fixtureRoot: fx, candidate: join(fx, 'candidate.json') }) } catch (e) { threw = e }
        return threw instanceof UsageError && String(threw.message).includes('符号链接') && readFileSync(victim, 'utf8') === '{"victim":"pristine"}' && !existsSync(join(fx, 'manifest.json'))
      } finally { rmSync(fx, { recursive: true, force: true }); rmSync(victim, { force: true }); secureWriteHook.preOpen = null }
    })())
    t('⑳ B8 D-2 fd 负例（rollback 受控追加）：appendLedgerLine open 前 source.jsonl 替换为指向受害件的 symlink→持 fd 拒＋victim 不变（受控追加面同守卫）', typeof secureWriteFile === 'function' && (() => {
      const fx = mkdtempSync(join(tmpdir(), 'lm-b8-20-')), victim = join(tmpdir(), 'lm-b8-20-v-' + process.pid + '.json')
      try {
        writeFileSync(join(fx, 'source.jsonl'), [row('2026-05-03T00:00:00Z', 3, 'e20-1', AI_PROJECT, AI_PROJECT, 'ok'), row('2026-05-04T00:00:00Z', 3, 'e20-2', 'other', 'other', 'ok')].map((r) => JSON.stringify(r)).join('\n') + '\n')
        runDryRun({ fixtureRoot: fx })
        runApply({ fixtureRoot: fx, candidate: join(fx, 'candidate.json') })
        const pj = join(fx, 'project.jsonl'), keep = readFileSync(pj, 'utf8')
        writeFileSync(pj, keep.replace('e20-1', 'e20-X')) // 构造 verify 判红态（快照段内篡改）
        writeFileSync(victim, '{"victim":"pristine"}')
        const sp = join(fx, 'source.jsonl')
        secureWriteHook.preOpen = (p) => { if (p === sp) { rmSync(sp); symlinkSync(victim, sp) } }
        let threw = null
        try { runRollback({ fixtureRoot: fx, manifest: join(fx, 'manifest.json') }) } catch (e) { threw = e }
        return threw instanceof UsageError && String(threw.message).includes('符号链接') && readFileSync(victim, 'utf8') === '{"victim":"pristine"}'
      } finally { rmSync(fx, { recursive: true, force: true }); rmSync(victim, { force: true }); secureWriteHook.preOpen = null }
    })())
    // ── B8 D-3 平台向量：三平台注入＋真实 Linux 硬链对照（win32/unsupported=静态保守分支·未跨机实测）──
    t('㉑ B8 D-3 平台分支：linux=held-fd-nlink／win32=fail-closed-existing／unsupported=reject-write＋真实 Linux 硬链 victim 拒＋win32 注入既存拒/新目标独占创建＋unsupported 注入=装载族', typeof hardlinkWritePolicy === 'function' && typeof secureWriteFile === 'function' && (() => {
      const polL = hardlinkWritePolicy('linux'), polW = hardlinkWritePolicy('win32'), polU = hardlinkWritePolicy('sunos')
      const shapeOk = polL.mode === 'held-fd-nlink' && polW.mode === 'fail-closed-existing' && polU.mode === 'reject-write'
      const d = mkdtempSync(join(tmpdir(), 'lm-b8-21-'))
      try {
        const victim = join(d, 'victim.json'), alias = join(d, 'alias.json')
        writeFileSync(victim, '{"victim":"pristine"}'); linkSync(victim, alias)
        let hl = null
        try { secureWriteFile(alias, '{"new":1}\n', { kind: '测试写目标' }) } catch (e) { hl = e } // 默认 policy=本机 linux
        const hardOk = hl instanceof UsageError && String(hl.message).includes('硬链接') && readFileSync(victim, 'utf8') === '{"victim":"pristine"}'
        const wtarget = join(d, 'w-target.json')
        writeFileSync(wtarget, '{"w":1}')
        let w = null
        try { secureWriteFile(wtarget, '{"w":2}\n', { kind: '测试写目标', policy: hardlinkWritePolicy('win32') }) } catch (e) { w = e }
        const winOk = w instanceof UsageError && String(w.message).includes('fail-closed') && readFileSync(wtarget, 'utf8') === '{"w":1}'
        const wnew = join(d, 'w-new.json')
        secureWriteFile(wnew, '{"n":1}\n', { kind: '测试写目标', policy: hardlinkWritePolicy('win32') })
        const winNewOk = readFileSync(wnew, 'utf8') === '{"n":1}\n'
        let u = null
        try { secureWriteFile(join(d, 'u.json'), 'x', { kind: '测试写目标', policy: hardlinkWritePolicy('sunos') }) } catch (e) { u = e }
        const unsOk = !!u && u.code === 'PLATFORM_UNSUPPORTED'
        return shapeOk && hardOk && winOk && winNewOk && unsOk
      } finally { rmSync(d, { recursive: true, force: true }) }
    })())
    // ── B8 D-4 notice 向量：子进程显式清键/重定向，default 与 override 两态各断言（stderr·stdout 机器格式不变）──
    t('㉒ B8 D-4 notice：子进程显式清 ORG_QUARANTINE_PATH→stderr 单行 default:<绝对缺省路径>＋未设置说明；显式 /tmp 覆盖→override:<绝对覆盖路径>＋显式覆盖说明；stdout 零 notice', (() => {
      const fxDry = join(isoCtx.iso, 'notice-fx')
      mkdirSync(fxDry, { recursive: true })
      writeFileSync(join(fxDry, 'source.jsonl'), JSON.stringify(row('2026-04-05T00:00:00Z', 3, 'nt-1', AI_PROJECT, AI_PROJECT, 'ok')) + '\n')
      const base = { PATH: process.env.PATH, HOME: isoCtx.home } // 外来 env 显式收敛（ORG_QUARANTINE_PATH 不进入 default 态）
      const rD = spawnSync(process.execPath, [isoCtx.script, '--dry-run', '--fixture-root', fxDry], { encoding: 'utf8', env: base, timeout: 60_000 })
      const dOk = rD.status === 0 && (rD.stderr || '').includes(`[notice] ORG_QUARANTINE_PATH=default:${join(isoCtx.iso, '.zcode', 'org-ledger.quarantine.jsonl')}`) && (rD.stderr || '').includes('未设置，使用缺省')
      const rO = spawnSync(process.execPath, [isoCtx.script, '--dry-run', '--fixture-root', fxDry], { encoding: 'utf8', env: { ...base, ORG_QUARANTINE_PATH: join(isoCtx.iso, 'q2.jsonl') }, timeout: 60_000 })
      const oOk = rO.status === 0 && (rO.stderr || '').includes(`[notice] ORG_QUARANTINE_PATH=override:${join(isoCtx.iso, 'q2.jsonl')}`) && (rO.stderr || '').includes('显式覆盖')
      return dOk && oOk && !(rD.stdout || '').includes('[notice]')
    })())
    // ── B8 D-5 CLI 预检向量：16 非法组合逐名全 exit 1（预检先于装载/写入）＋candidate 缺件/破损→3 ──
    t('㉓ B8 D-5 CLI 预检：16 非法组合（self-test+verify／self-test+未知 flag／无模式／双模式／未知 flag／等号形态／重复 project／project 缺值／fixture+project／verify+candidate／dry-run+manifest／rollback 缺 manifest／apply 缺 candidate／rollback+candidate／verify+note／额外位置参数）全真 exit 1＋candidate 缺件/破损→3', (() => {
      const runIso = (args) => spawnSync(process.execPath, [isoCtx.script, ...args], { encoding: 'utf8', env: isoCtx.env, timeout: 60_000 })
      const cfx = join(isoCtx.iso, 'cli-fx')
      mkdirSync(cfx, { recursive: true })
      writeFileSync(join(cfx, 'source.jsonl'), JSON.stringify(row('2026-04-06T00:00:00Z', 3, 'cli-1', AI_PROJECT, AI_PROJECT, 'ok')) + '\n')
      const invalids = [
        ['--self-test', '--verify'],
        ['--self-test', '--wat'],
        ['--project', isoCtx.proj],
        ['--dry-run', '--verify', '--fixture-root', cfx],
        ['--dry-run', '--wat', '--fixture-root', cfx],
        ['--dry-run', '--project=' + isoCtx.proj],
        ['--verify', '--project', '/a', '--project', '/b'],
        ['--verify', '--project'],
        ['--verify', '--fixture-root', cfx, '--project', isoCtx.proj],
        ['--verify', '--fixture-root', cfx, '--candidate', join(cfx, 'c.json')],
        ['--dry-run', '--fixture-root', cfx, '--manifest', join(cfx, 'm.json')],
        ['--rollback', '--fixture-root', cfx],
        ['--apply', '--fixture-root', cfx],
        ['--rollback', '--manifest', join(cfx, 'm.json'), '--candidate', join(cfx, 'c.json')],
        ['--verify', '--fixture-root', cfx, '--note', 'x'],
        ['--verify', '--fixture-root', cfx, 'stray'],
      ]
      const codes = invalids.map((a) => { const r = runIso(a); return { c: r.status, err: (r.stderr || '').includes('[用法错]') } })
      const allInvalid1 = codes.length === 16 && codes.every((x) => x.c === 1 && x.err)
      const rMiss = runIso(['--apply', '--candidate', join(cfx, 'nope.json'), '--project', isoCtx.proj, '--manifest', join(cfx, 'm2.json')])
      writeFileSync(join(cfx, 'broken.json'), '{not json')
      const rBroken = runIso(['--apply', '--candidate', join(cfx, 'broken.json'), '--project', isoCtx.proj, '--manifest', join(cfx, 'm3.json')])
      return allInvalid1 && rMiss.status === 3 && rBroken.status === 3
    })())
  } catch (e) { t(`夹具异常（${e.message}）`, false) } finally {
    if (fx) rmSync(fx, { recursive: true, force: true })
    if (isoCtx) { rmSync(isoCtx.iso, { recursive: true, force: true }); rmSync(isoCtx.home, { recursive: true, force: true }) } // 单层隔离根统一清理
  }
  console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
  process.exit(fails === 0 ? 0 : 1)
}

// ── 归属与分组（D-5 单源）──
export function ownerOf(row) { const p = row && typeof row === 'object' ? (row.project_id ?? row.project) : undefined; return typeof p === 'string' && p.trim() ? p.trim() : null }
export function isAttribution(row) { return ownerOf(row) === AI_PROJECT }
export function normalizeProjectName(raw) { // 归一化：反斜杠/多斜杠折一→取末段→小写（旧形 pid 并组——waterprint 系）
  const seg = String(raw ?? '').replace(/[\\/]+/g, '/').trim().split('/').filter(Boolean)
  return (seg[seg.length - 1] || '(无名)').toLowerCase()
}
export function groupKeyOf(row) { // mocked 演练行独立组（health-scan mocked 语义同源）；余按归一化名
  if (row && typeof row === 'object' && row.mocked === true) return 'mocked'
  return normalizeProjectName(row ? (row.project_id ?? row.project) : '')
}
export function schemaKeyOf(row) { return row && row.schema_version !== undefined ? String(row.schema_version) : '缺失' }

// ── 路径解析（D-5 演练映射＋生产定址——返工 R2 收紧：确定性解析·回退留痕·禁吞装载异常）──
export function resolveProjectRoot(explicit, projectsPartition = {}) {
  if (explicit) return { root: resolve(explicit), basis: '--project 显式参' }
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
  for (const [k, v] of Object.entries(projectsPartition || {})) { // 按项目身份确定性解析 ai-dev-org 注册项（对象形态 {root}）
    if ((k === AI_PROJECT || v === AI_PROJECT || (isObj(v) && v.id === AI_PROJECT)) && isObj(v) && typeof v.root === 'string' && v.root.trim())
      return { root: resolve(v.root.trim()), basis: `projects.${k}.root（ai-dev-org 身份注册项）` }
  }
  const cand = join(homedir(), 'work', 'aidevorg') // homedir 相对约定——前两者皆无时的保留回退（禁绝对路径硬编码同形）
  if (existsSync(join(cand, MAIN_REPO_MARKER))) return { root: cand, basis: 'homedir 相对约定回退（projects 分区无 ai-dev-org {root} 注册；存在 docs/agent-matrix.json 即认）' }
  return null
}
const realOf = (x) => { try { return realpathSync(x) } catch { return resolve(x) } } // 缺席目标=字面解析；既存=symlink 真身
const rejectHardlink = (p, kind) => { let s = null; try { s = lstatSync(p) } catch { return } if (s && s.nlink > 1) throw new UsageError(`${kind} 写目标为硬链接（nlink=${s.nlink}——共享 inode 写穿越界面·夹具外受害件会被实际改写——W-1 一律拒）`) } // W-1：hardlink 无 realpath 痕迹，唯 nlink 可辨
export function assertFixtureConfine(fixtureRoot, p, kind) { // 返工 R3/R14/R14b：realpath 三面 containment＋写目标节点 lstat（含悬空 symlink 一律拒）
  if (!fixtureRoot || !p) return
  const root = realOf(fixtureRoot), target = resolve(p)
  let st = null
  try { st = lstatSync(target) } catch { st = null } // 缺席=无节点（悬空链接本体 lstat 仍可命中）
  if (st && st.isSymbolicLink())
    throw new UsageError(`${kind} 写路径为符号链接节点（${target}——含悬空链接·写穿越界面——R14b 一律拒）`)
  rejectHardlink(target, kind) // W-1：既存写目标 nlink>1 拒（复用上方 lstat 语义·独立 lstat 保持守卫单源可复用于生产写侧）
  let real = target
  try { real = realpathSync(target) } catch { real = join(realOf(dirname(target)), basename(target)) } // 目标缺席→父目录真身＋basename
  if (real !== root && !real.startsWith(root + '/'))
    throw new UsageError(`${kind} 写路径越出夹具根（${target}→真身 ${real}）——fixture 模式 symlink 载体漏网禁入生产（R3/R14）`)
}
export function migratePaths({ fixtureRoot = null, projectRoot = null, candidate = null, manifest = null, mergedOverride = null } = {}) {
  const or = (explicit, dflt) => (explicit ? resolve(explicit) : dflt)
  if (fixtureRoot) {
    if (realOf(fixtureRoot) !== resolve(fixtureRoot))
      throw new UsageError(`fixture-root 为符号链接（${fixtureRoot}→${realOf(fixtureRoot)}）——演练根禁 symlink 载体（R14：防整根指向生产目录）`)
    const P = {
      fixture: true,
      source: join(fixtureRoot, 'source.jsonl'),
      projectLedger: join(fixtureRoot, 'project.jsonl'),
      quarantine: join(fixtureRoot, 'quarantine.jsonl'),
      candidate: or(candidate, join(fixtureRoot, 'candidate.json')),
      manifest: or(manifest, join(fixtureRoot, 'manifest.json')),
    }
    for (const [k, v] of [['source', P.source], ['project', P.projectLedger], ['quarantine', P.quarantine], ['candidate', P.candidate], ['manifest', P.manifest]])
      assertFixtureConfine(fixtureRoot, v, k) // R14b：一切 fixture 写目标全覆盖（source 含 rollback 受控追加面）
    return P
  }
  return {
    fixture: false,
    source: join(SKILL_ROOT, '.zcode', 'org-ledger.jsonl'),
    projectLedger: mergedOverride ? ledgerPathFor(projectRoot, null, mergedOverride) : ledgerPathFor(projectRoot), // 返工 R13：真派生（merged ledger_path 相对项目根）；R1 z-B-1：mergedOverride=自检专用合成 merged 注入（向量⑩隔离化——直跑 --self-test 零读真实 default/local；生产调用恒缺省=现行为）
    quarantine: process.env.ORG_QUARANTINE_PATH || join(SKILL_ROOT, '.zcode', 'org-ledger.quarantine.jsonl'), // env=内部测试设施（缺省行为不变）
    candidate: or(candidate, join(SKILL_ROOT, '.zcode', 'ledger-migrate.candidate.json')),
    manifest: or(manifest, join(projectRoot, '.zcode', 'org-ledger.migration.json')),
  }
}

// ── 读源与候选快照（D-5：dry-run 只读产候选件）──
const splitLines = (text) => { const ls = String(text).split('\n'); if (ls.length && ls[ls.length - 1] === '') ls.pop(); return ls }
function readSource(p) {
  if (!existsSync(p)) throw new Error(`源账本不存在：${p}`)
  const raw = readFileSync(p)
  return { raw, lines: splitLines(raw.toString('utf8')) }
}
function schemaDistOf(lines) {
  const d = {}
  for (const l of lines) { let r = null; try { r = JSON.parse(l) } catch {}; const k = r ? schemaKeyOf(r) : 'unparseable'; d[k] = (d[k] || 0) + 1 }
  return sortKeys(d)
}
function buildCandidate(raw, lines) {
  const groups = {}
  for (const l of lines) { let r = null; try { r = JSON.parse(l) } catch {}; const k = r ? (isAttribution(r) ? AI_PROJECT : groupKeyOf(r)) : '(unparseable)'; groups[k] = (groups[k] || 0) + 1 }
  const dist = schemaDistOf(lines)
  const total = lines.length
  const gsum = Object.values(groups).reduce((a, b) => a + b, 0)
  const dsum = Object.values(dist).reduce((a, b) => a + b, 0)
  if (gsum !== total || dsum !== total) throw new Error(`dry-run 对账不符：逐组和 ${gsum}／schema 和 ${dsum} ≠ 源行数 ${total}（停止条件②——数字对不上=环境配错，禁硬闯）`)
  return { schema: CANDIDATE_SCHEMA, created_at: new Date().toISOString(), source: { label: LABEL_SOURCE, lines: total, sha256: sha256Buf(raw) }, groups: sortKeys(groups), total, schema_dist: dist }
}
export function runDryRun(opts = {}) {
  const P = migratePaths(opts)
  const src = readSource(P.source)
  const cand = buildCandidate(src.raw, src.lines)
  mkdirSync(dirname(P.candidate), { recursive: true })
  rejectHardlink(P.candidate, '候选件写目标') // W-1 预检提示（open 前 lstat——非写前安全证明）
  secureWriteFile(P.candidate, JSON.stringify(cand, null, 2) + '\n', { kind: '候选件写目标' }) // B8 D-2：唯一写通道（O_NOFOLLOW 持 fd fstat）
  const iso = Object.entries(cand.groups).filter(([k]) => k !== AI_PROJECT)
  console.log(`ledger-migrate dry-run（只读）：源=${LABEL_SOURCE} 行数=${cand.source.lines} sha256=${cand.source.sha256}`)
  console.log(`目标组：${AI_PROJECT}=${cand.groups[AI_PROJECT] ?? 0}（→ ${LABEL_PROJECT}）`)
  console.log(`隔离组（待裁·按归一化 project 分组计数；隔离件写盘序=源相对序）：${iso.map(([k, v]) => `${k}=${v}`).join(' ') || '（无）'}`)
  console.log(`总计=${cand.total}（逐组和=${Object.values(cand.groups).reduce((a, b) => a + b, 0)}）schema 分布=${JSON.stringify(cand.schema_dist)}`)
  console.log(`候选件已落盘：${P.candidate}（sha256=${sha256Buf(readFileSync(P.candidate)).slice(0, 16)}…）；停点=候选件待主控批准——apply＝主控指令触发（--apply --candidate <候选件>），实现岗不执行`)
  return true
}

// ── apply（D-5 受控交接：复算源三项与候选件逐项全等才写；不删不改源）──
function writeLedgerFile(p, lines) {
  mkdirSync(dirname(p), { recursive: true })
  return withFileLock(p + '.lock', () => { rejectHardlink(p, '账本写目标'); secureWriteFile(p, lines.length ? lines.join('\n') + '\n' : '', { kind: '账本写目标' }) }) // lstat=预检提示；持 fd fstat=最终判定（B8 D-2；apply 两目标件——空体硬链也拦）
}
function appendLedgerLine(p, line) {
  mkdirSync(dirname(p), { recursive: true })
  return withFileLock(p + '.lock', () => { rejectHardlink(p, '账本写目标'); secureWriteFile(p, line + '\n', { append: true, kind: '账本写目标' }) }) // rollback 受控追加面（B8 D-2 同助手：同 fd 读→截→写回）
}
export function runApply(opts = {}) {
  const P = migratePaths(opts)
  if (!existsSync(P.candidate)) { const e = new Error(`候选件不存在：${P.candidate}（先 --dry-run 产候选件并经主控批准）`); e.code = 'CANDIDATE_LOAD_FAILED'; throw e } // B8 D-5：装载族 exit 3
  let cand = null
  try { cand = JSON.parse(readFileSync(P.candidate, 'utf8')) } catch (e) { const e2 = new Error(`候选件解析失败 ${P.candidate}: ${e.message}`); e2.code = 'CANDIDATE_LOAD_FAILED'; throw e2 }
  if (!cand || cand.schema !== CANDIDATE_SCHEMA || !cand.source) { const e = new Error(`候选件 schema 不符（${P.candidate}）——须 ${CANDIDATE_SCHEMA}`); e.code = 'CANDIDATE_LOAD_FAILED'; throw e }
  const src = readSource(P.source)
  const fresh = buildCandidate(src.raw, src.lines) // 复算当前源三项（行数/sha256/分组分布＋schema 分布）
  const mism = []
  if (fresh.source.lines !== cand.source.lines) mism.push(`行数 ${fresh.source.lines}≠批准 ${cand.source.lines}`)
  if (fresh.source.sha256 !== cand.source.sha256) mism.push(`sha256 漂移`)
  if (JSON.stringify(fresh.groups) !== JSON.stringify(cand.groups)) mism.push('分组分布漂移')
  if (JSON.stringify(fresh.schema_dist) !== JSON.stringify(cand.schema_dist)) mism.push('schema 分布漂移')
  if (mism.length) { const e = new Error(`源已变动·旧批准失效·重跑 dry-run 重新批准（${mism.join('；')}）`); e.code = 'SOURCE_CHANGED'; throw e }
  for (const [k, p] of [['项目账本', P.projectLedger], ['隔离件', P.quarantine], ['manifest', P.manifest]]) // 返工 R4：目标存在守卫（D-13① append-only 保护）
    if (existsSync(p) && statSync(p).size > 0) { const e = new Error(`${k} 已存在且非空（${p}）——apply 拒绝（重迁须经主控受控裁决处置既有件后重跑；零截断保证）`); e.code = 'TARGET_EXISTS'; throw e }
  const ai = [], other = []
  for (const l of src.lines) { let r = null; try { r = JSON.parse(l) } catch {}; (r && isAttribution(r) ? ai : other).push(l) }
  writeLedgerFile(P.projectLedger, ai) // 两目标件各持同目录 .lock；源文件零触碰
  writeLedgerFile(P.quarantine, other)
  const manifestObj = {
    schema: MANIFEST_SCHEMA,
    frozen_at: new Date().toISOString(),
    source: { label: LABEL_SOURCE, lines: src.lines.length, sha256: sha256Buf(src.raw) },
    targets: [
      { label: LABEL_PROJECT, lines: ai.length, rows_by_schema: schemaDistOf(ai), line_sha256: ai.map(sha256Text) },
      { label: LABEL_QUARANTINE, lines: other.length, rows_by_schema: schemaDistOf(other), line_sha256: other.map(sha256Text) },
    ],
  }
  mkdirSync(dirname(P.manifest), { recursive: true })
  rejectHardlink(P.manifest, 'manifest 写目标') // W-1 预检提示
  secureWriteFile(P.manifest, JSON.stringify(manifestObj, null, 2) + '\n', { kind: 'manifest 写目标' }) // B8 D-2：唯一写通道
  console.log(`[ok] apply 完成：项目账本 ${ai.length} 行（${P.projectLedger}）／隔离件 ${other.length} 行（${P.quarantine}·源相对序）／manifest 已落 ${P.manifest}`)
  console.log(`[ok] 冻结源 ${src.lines.length} 行 sha256=${sha256Buf(src.raw).slice(0, 16)}…——源文件零改写（冻结只读），后续写入者改走项目账本（R4/health-scan 随动）`)
  return true
}

const projectRootOf = (opts) => { if (!opts || !opts.projectRoot) { const e = new Error('生产语境缺 projectRoot（CLI 定址链保证——防御性守卫）'); e.code = 'MANIFEST_MISSING'; throw e } return opts.projectRoot }

// ── verify（D-5 三段语义）──
function firstHashMismatch(lines, hashes) { // 保序逐行对账，返首个差异下标（全等=-1）
  for (let i = 0; i < hashes.length; i++) if (sha256Text(lines[i]) !== hashes[i]) return i
  return -1
}
export function runVerify(opts = {}) {
  const P = migratePaths(opts)
  if (!existsSync(P.manifest)) { const e = new Error(`manifest 不存在：${P.manifest}`); e.code = 'MANIFEST_MISSING'; throw e }
  let mf = null
  try { mf = JSON.parse(readFileSync(P.manifest, 'utf8')) } catch (e2) { const e = new Error(`manifest 解析失败 ${P.manifest}: ${e2.message}`); e.code = 'MANIFEST_MISSING'; throw e }
  if (!mf || mf.schema !== MANIFEST_SCHEMA || !mf.source || !Array.isArray(mf.targets) || mf.targets.length !== 2) { const e = new Error(`manifest 顶层结构破损（schema/source/targets 三形——返工 R15：结构面统一装载错族）`); e.code = 'MANIFEST_MISSING'; throw e }
  const so = mf.source
  if (typeof so !== 'object' || so === null || Array.isArray(so) || typeof so.label !== 'string' || !so.label.trim() || !Number.isInteger(so.lines) || so.lines < 0 || typeof so.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(so.sha256)) { const e = new Error(`manifest source 字段级结构破损（须 {label:非空串,lines:非负整数,sha256:64hex}——W-2：字段级形态与顶层结构统一装载错族）`); e.code = 'MANIFEST_MISSING'; throw e } // W-2：source 字段级形态（原先 label 类破损静默绿·余形误判红）
  for (const tg of mf.targets) { // 返工 R9：装载面结构断言（口径=结构破损属装载错族 exit 3；内容不符=判定红 exit 1）
    const ls = tg ? tg.line_sha256 : null
    if (!tg || typeof tg.lines !== 'number' || !Array.isArray(ls) || ls.length !== tg.lines || !ls.every((h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h))) {
      const e = new Error(`manifest targets[].line_sha256 结构破损（label=${tg && tg.label}——须数组且 length==targets[].lines 且逐元素 64hex）`); e.code = 'MANIFEST_MISSING'; throw e
    }
  }
  let red = false
  if (!existsSync(P.source)) { console.error(`[FAIL] ①冻结源缺位（${P.source}）`); red = true } else {
    const raw = readFileSync(P.source)
    const h = sha256Buf(raw)
    if (h !== mf.source.sha256) { console.error(`[FAIL] ①冻结源 sha256≠manifest 锚（现 ${h.slice(0, 12)}…≠锚 ${String(mf.source.sha256).slice(0, 12)}…）——防篡改判红`); red = true } else {
      const ls = splitLines(raw.toString('utf8'))
      if (ls.length !== mf.source.lines) { console.error(`[FAIL] ①冻结源行数 ${ls.length}≠${mf.source.lines}`); red = true } else console.log(`[ok] ①冻结源锚全等（${mf.source.lines} 行·sha256=${h.slice(0, 16)}…）`)
    }
  }
  const t0 = mf.targets[0], t1 = mf.targets[1]
  if (!existsSync(P.projectLedger)) { console.error('[FAIL] ②项目账本缺位'); red = true } else {
    const pl = splitLines(readFileSync(P.projectLedger, 'utf8')), bad = pl.length < t0.lines ? pl.length : firstHashMismatch(pl, t0.line_sha256)
    if (bad >= 0) { console.error(`[FAIL] ②项目账本快照段第 ${bad + 1} 行哈希≠manifest（保序对账判红${pl.length < t0.lines ? `——行数 ${pl.length}＜快照段 ${t0.lines}` : ''}）`); red = true } else console.log(`[ok] ②项目账本快照段 ${t0.lines} 行保真；③快照段后合法追加 ${pl.length - t0.lines} 行（B1 起合法增长——不计漂移不校验内容）`)
  }
  if (!existsSync(P.quarantine)) { console.error('[FAIL] ②隔离件缺位'); red = true } else {
    const ql = splitLines(readFileSync(P.quarantine, 'utf8')), bad = ql.length !== t1.lines ? ql.length : firstHashMismatch(ql, t1.line_sha256)
    if (bad >= 0) { console.error(`[FAIL] ②隔离件对账判红（${ql.length !== t1.lines ? `行数 ${ql.length}≠${t1.lines}` : `第 ${bad + 1} 行哈希≠manifest`}）`); red = true } else console.log(`[ok] ②隔离件全量 ${t1.lines} 行保真`)
  }
  return !red
}

// ── rollback（D-13②受控回退：前置=verify 判红确系迁移缺陷）──
export function runRollback(opts = {}) {
  const P = migratePaths(opts)
  if (!opts.manifest || !existsSync(P.manifest)) { const e = new Error(`--rollback 须显式 --manifest <可读路径>（D-13②受控入口；收到 ${opts.manifest || '缺省'}）`); e.code = 'MANIFEST_MISSING'; throw e }
  const verdict = runVerify({ fixtureRoot: opts.fixtureRoot, projectRoot: opts.projectRoot, manifest: opts.manifest })
  if (verdict) { const e = new Error('--verify 绿——无迁移缺陷判据，拒绝回退（D-13②：回退仅在 verify 判红确系迁移缺陷时受控执行）'); e.code = 'VERIFY_GREEN'; throw e }
  const line = JSON.stringify({ ts: new Date().toISOString(), schema_version: 3, runId: 'ledger-migrate-rollback', project: AI_PROJECT, project_id: AI_PROJECT, event: 'stopped', role: 'controller', tier: 'manual', source: 'ledger-migrate', cfg_hash: 'rollback', outcome: 'rollback', note: String(opts.note || '迁移判定失败受控回退——恢复原单写向；项目侧件处置=保留待重迁或删除') })
  appendLedgerLine(P.source, line) // 旧账本「本批只读」的唯一受控例外（§1/D-13②）
  console.log('[ok] 旧账本（' + P.source + '）已受控追加异常事件行（schema v3·event=stopped）——恢复原单写向')
  console.log('处置指引：项目侧账本/隔离件/manifest 不自动删除（manifest 已录哈希不改写——历史事实保留）；14 天内重迁（--dry-run→批准→--apply）或以裁决行正式废弃项目侧件（禁双写长期并行）；回退后主控手记行写回旧路径（单写向恢复）。')
  return true
}

// ── CLI（isMain guard；B8 D-5 预检闭集→B8 r4 哨兵→B8 D-4/D-3 notice→装载→分派）──
const LEDGER_VALUE_FLAGS = ['--fixture-root', '--candidate', '--project', '--manifest', '--note']
const LEDGER_KNOWN_FLAGS = new Set(['--self-test', '--dry-run', '--apply', '--verify', '--rollback', ...LEDGER_VALUE_FLAGS])
const LEDGER_MODES = ['--dry-run', '--apply', '--verify', '--rollback']
export function precheckLedgerCli(argv) { // B8 D-5：参数组合闭集前置校验——一切装载/写入之前；用法错=UsageError→exit 1
  const usage = (m) => { throw new UsageError(m) }
  const eq = argv.find((a) => typeof a === 'string' && a.startsWith('--') && a.includes('='))
  if (eq !== undefined) usage(`等号形态「${eq}」不支持——flag 一律空格分隔取值`)
  if (argv.includes('--self-test')) {
    if (argv.length !== 1) usage('--self-test 须单独使用（与一切其他参数互斥——B8 D-5）')
    return { mode: '--self-test' }
  }
  const unknown = argv.find((a) => typeof a === 'string' && a.startsWith('--') && !LEDGER_KNOWN_FLAGS.has(a))
  if (unknown !== undefined) usage(`未知参数：${unknown}（本脚本仅提供四模式点名 flag＋--self-test）`)
  const positional = argv.filter((a, i) => typeof a === 'string' && !a.startsWith('--') && !LEDGER_VALUE_FLAGS.includes(argv[i - 1]))
  if (positional.length) usage(`多余位置参数：${positional.join(',')}（本脚本不收位置参数）`)
  const dupMode = LEDGER_MODES.find((m) => argv.filter((a) => a === m).length > 1)
  if (dupMode !== undefined) usage(`模式 flag ${dupMode} 出现 ${argv.filter((a) => a === dupMode).length} 次（重复=用法错——R1 z-B-2/D-5：任何装载前拒绝）`) // R1：重复模式 flag 先于装载 exit 1
  const modes = LEDGER_MODES.filter((m) => argv.includes(m))
  if (modes.length !== 1) usage(`须恰一个模式：--dry-run／--apply --candidate <候选件>／--verify [--manifest <件>]／--rollback --manifest <件>（收到：${modes.join(',') || '无'}）`)
  const mode = modes[0]
  const has = (f) => argv.includes(f)
  if (mode === '--dry-run' && has('--manifest')) usage('--dry-run 禁配 --manifest（manifest 只由 apply 产出/verify 与 rollback 消费）')
  if (mode === '--dry-run' && has('--note')) usage('--note 仅用于 --rollback')
  if (mode === '--apply' && !has('--candidate')) usage('--apply 须搭配 --candidate <候选件路径>（候选快照受控交接——D-5）')
  if (mode === '--verify' && has('--candidate')) usage('--verify 只读对账禁配 --candidate')
  if (mode === '--verify' && has('--note')) usage('--note 仅用于 --rollback')
  if (mode === '--rollback' && !has('--manifest')) usage('--rollback 须显式 --manifest <路径>（D-13②受控入口）')
  if (mode === '--rollback' && has('--candidate')) usage('--rollback 禁配 --candidate（回退不产迁移件）')
  if (has('--note') && mode !== '--rollback') usage('--note 仅用于 --rollback')
  if (has('--fixture-root') && has('--project')) usage('--fixture-root 与 --project 互斥（演练模式零生产定址）')
  for (const f of LEDGER_VALUE_FLAGS) if (has(f)) cliFlag(argv, f) // cliFlag 三校验（重复/末位缺值/值形如 flag）→UsageError=用法错
  return { mode }
}
const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) {
    // B8 r4 哨兵：自检入口检测 ORG_B8_TEST_DEPTH 即固定拒入（防自拷贝递归放大——副本入口逐字标记行）
    if (process.env.ORG_B8_TEST_DEPTH) { console.error('[sentinel] self-test rejected（ORG_B8_TEST_DEPTH 在环境——自检副本递归守卫·B8 r4）'); process.exit(1) }
    if (argv.length !== 1) { console.error('[用法错] --self-test 须单独使用（与一切其他参数互斥——B8 D-5）'); process.exit(1) }
    selfTest()
  }
  let fixtureRoot = null, candidate = null, manifest = null, projectExplicit = null, note = null, mode = null
  try {
    mode = precheckLedgerCli(argv).mode // B8 D-5：闭集前置校验（先于 notice/装载/任何写入）
    fixtureRoot = cliFlag(argv, '--fixture-root')
    candidate = cliFlag(argv, '--candidate')
    manifest = cliFlag(argv, '--manifest')
    projectExplicit = cliFlag(argv, '--project')
    note = cliFlag(argv, '--note')
  } catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
    throw e
  }
  const qp = process.env.ORG_QUARANTINE_PATH // B8 D-4：env notice（stderr 单行·预检后装载前·只显示路径与来源，不读不印状态内容）
  console.error(qp ? `[notice] ORG_QUARANTINE_PATH=override:${resolve(qp)}（显式覆盖）` : `[notice] ORG_QUARANTINE_PATH=default:${join(SKILL_ROOT, '.zcode', 'org-ledger.quarantine.jsonl')}（未设置，使用缺省）`)
  const pol = hardlinkWritePolicy() // B8 D-3：平台边界 notice（stderr·静态保守分支未跨机实测；R1 d-N-4：平台名动态取 process.platform）
  console.error(`[notice] 迁移写侧平台策略=${pol.mode}（本机平台=${process.platform}${process.platform === 'linux' ? '＝本批唯一实证面（O_NOFOLLOW 持 fd＋fstat nlink>1 拒实测）' : '≠linux——非本批实证面，按 hardlinkWritePolicy 静态分支执行·未实测'}；win32/unsupported=静态保守分支·未跨机/跨设备实测——cross_machine_tested=false）`)
  let projectRoot = null
  let projects = null
  try { const m = loadOrgConfig(SKILL_ROOT).merged; projects = m && typeof m.projects === 'object' && m.projects ? m.projects : {} } catch (e) { console.error(`[装载错] org-config 装载失败：${e.message}（返工 R2——配置异常不得吞成空后继续启发式）`); process.exit(3) }
  if (!fixtureRoot) {
    const rr = resolveProjectRoot(projectExplicit, projects)
    if (!rr) { console.error('[装载错] 生产项目根无法定址——传 --project <主仓根>，或在本机件件 projects 分区落 {root} 对象（06 §5.8 行 3=配置/装载错）'); process.exit(3) }
    projectRoot = rr.root
    console.log(`[root] 项目根=${projectRoot}（依据：${rr.basis}）`) // R2：回退/定址依据 stdout 回显
  }
  try {
    if (mode === '--dry-run') { runDryRun({ fixtureRoot, projectRoot, candidate }); process.exit(0) }
    if (mode === '--apply') { runApply({ fixtureRoot, projectRoot, candidate, manifest }); process.exit(0) }
    if (mode === '--verify') { const ok = runVerify({ fixtureRoot, projectRoot, manifest }); process.exit(ok ? 0 : 1) }
    if (mode === '--rollback') { runRollback({ fixtureRoot, projectRoot, manifest, note }); process.exit(0) }
  } catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
    if (e && (e.code === 'SOURCE_CHANGED' || e.code === 'VERIFY_GREEN' || e.code === 'TARGET_EXISTS')) { console.error(`[FAIL] ${e.message}`); process.exit(1) }
    if (e && (e.code === 'MANIFEST_MISSING' || e.code === 'CANDIDATE_LOAD_FAILED' || e.code === 'PLATFORM_UNSUPPORTED')) { console.error(`[装载错] ${e.message}（06 §5.8 行 3=配置/装载错）`); process.exit(3) }
    console.error(`[FAIL] ${e.message}`)
    process.exit(1)
  }
}
