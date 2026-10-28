/**
 * ledger-migrate（B1 工件 D）：账本按项目拆迁四子命令＋演练模式＋自检。
 * 语义单源=docs/tasks/B1-gates-ledger-flags.md D-5（候选快照受控交接）＋D-13②（受控回退）。
 * 归属键=project_id ?? project（02 §9）；ai-dev-org 行→项目账本，其余→隔离件（源相对序；归一化分组仅用于 dry-run/候选件计数与待裁登记）。
 * 子命令：--dry-run（只读产候选件）／--apply --candidate <file>（复算源三项逐项全等才写·不符 exit 1；目标件已存在非空=exit 1 拒——D-13① append-only）／
 * --verify（冻结源锚＋两目标快照段保序对账＋合法追加排除回显；manifest 结构破损=装载错 3·内容不符=判定红 1——R15 统一口径）／
 * --rollback --manifest <file>（前置=verify 判红；旧账本受控追加 schema v3 event=stopped 异常行——D-13② 唯一例外）。
 * 演练：--fixture-root <dir>（label→source/project/quarantine/candidate.json·manifest 显式或缺省）——realpath 三面 containment＋symlink 载体拒（R14）·写路径全限定夹具根。
 * 生产：源/隔离/候选=SKILL_ROOT/.zcode/ 同名件（隔离件 env ORG_QUARANTINE_PATH=内部测试设施）；项目账本=ledgerPathFor(projectRoot) 真派生（R13——apply/verify/
 * rollback 共用同一派生路径·非默认 ledger_path 端到端支持；manifest label=身份串不作路径展开）；项目根=resolveProjectRoot（--project＞projects ai-dev-org {root} 注册项＞
 * homedir 相对约定回退·stdout 回显 root 与依据；org-config 装载异常 exit 3 不吞）。锁=目标账本同目录 <ledger>.lock。退出码口径单源=06 §5.8（不复写）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync, statSync, realpathSync, symlinkSync, lstatSync } from 'node:fs'
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

// ── 自检（D-9/R14：五向量＋绿基线/回退小闭环；夹具一律 os.tmpdir()，零触两仓真实面）──
function selfTest() {
  let fails = 0, n = 0
  const t = (name, cond) => (n++, console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`), cond || fails++)
  // 两仓零写入断言基线（向量⑧·返工 R3 扩两仓）
  const snapDir = (p) => { const m = {}; if (!existsSync(p)) return m; for (const f of readdirSync(p)) { const a = join(p, f); if (statSync(a).isFile()) m[f] = sha256Buf(readFileSync(a)) } return m }
  const rr0 = resolveProjectRoot(null, {})
  const mainZc = rr0 ? join(rr0.root, '.zcode') : null
  const skillZcBefore = JSON.stringify([snapDir(join(SKILL_ROOT, '.zcode')), mainZc ? snapDir(mainZc) : {}])
  const row = (ts, sv, rid, proj, pid, ev, x = {}) => ({ ts, schema_version: sv, runId: rid, project: proj, ...(pid ? { project_id: pid } : {}), event: ev, role: 'executor', tier: 'impl', source: 's', cfg_hash: 'h', outcome: 'o', ...x })
  let fx = null
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
    t('④ manifest 哈希锚篡改检出（冻结源改一字节→verify 红）', typeof runVerify === 'function' && (() => {
      writeFileSync(srcPath, readFileSync(srcPath, 'utf8').replace('st-1', 'st-X'))
      return runVerify({ fixtureRoot: fx, manifest: join(fx, 'manifest.json') }) === false
    })())
    const structCase = (idx, empty) => { const mp = join(fx, 'manifest.json'), keep = readFileSync(mp, 'utf8'); const mf = JSON.parse(keep); mf.targets[idx].line_sha256 = empty ? [] : mf.targets[idx].line_sha256.slice(0, -1); writeFileSync(mp, JSON.stringify(mf)); let code = null; try { runVerify({ fixtureRoot: fx, manifest: mp }) } catch (e) { code = e.code } writeFileSync(mp, keep); return code === 'MANIFEST_MISSING' }
    t('⑤ manifest 结构：targets[0].line_sha256 截短→MANIFEST_MISSING（exit 3 族·project 段）', typeof runVerify === 'function' && structCase(0, false))
    t('⑥ manifest 结构：targets[1].line_sha256 清空→MANIFEST_MISSING（exit 3 族·quarantine 段）', typeof runVerify === 'function' && structCase(1, true))
    rmSync(fx, { recursive: true, force: true })
    fx = mkdtempSync(join(tmpdir(), 'ledger-migrate-st2-'))
    const rowsA = [row('2026-02-01T00:00:00Z', 3, 'sa-1', AI_PROJECT, AI_PROJECT, 'switch', { source: 's1' }), row('2026-02-02T00:00:00Z', 2, 'sa-2', 'hjjc', null, 'ruling', { role: 'controller', tier: 'manual', source: 'm' })]
    const src2 = join(fx, 'source.jsonl')
    writeFileSync(src2, rowsA.map((r) => JSON.stringify(r)).join('\n') + '\n')
    const stale = typeof runDryRun === 'function' && runDryRun({ fixtureRoot: fx }) === true
    if (stale) writeFileSync(src2, readFileSync(src2, 'utf8') + JSON.stringify(row('2026-02-03T00:00:00Z', 3, 'sa-3', AI_PROJECT, AI_PROJECT, 'switch', { source: 's1' })) + '\n') // 批准后源追加一行
    let threw = null
    try { if (typeof runApply === 'function') runApply({ fixtureRoot: fx, candidate: join(fx, 'candidate.json') }) } catch (e) { threw = e }
    const staleRejected = threw !== null && String(threw.message || threw).includes('源已变动')
    const zeroWrite = !existsSync(join(fx, 'project.jsonl')) && !existsSync(join(fx, 'quarantine.jsonl')) && !existsSync(join(fx, 'manifest.json'))
    t('⑦ stale candidate：批准后源追加→apply 拒（exit 1 族）＋目标与 manifest 零写入', staleRejected && zeroWrite)
    t('⑧ fixture 全程两仓零写入（SKILL_ROOT/.zcode＋主仓 .zcode 哈希前后全等＋演练路径全在 tmp）', (() => { const same = JSON.stringify([snapDir(join(SKILL_ROOT, '.zcode')), mainZc ? snapDir(mainZc) : {}]) === skillZcBefore; return same && String(fx).startsWith(tmpdir()) })())
    const multi = { synapse: 'synapse', 'ai-dev-org': { id: AI_PROJECT, root: '/synthetic/proj-root' }, waterprint: 'waterprint' }
    const rr = typeof resolveProjectRoot === 'function' ? resolveProjectRoot(null, multi) : null
    t('⑨ R2 定址：多 projects 分区按 ai-dev-org 身份注册项确定性解析（不按枚举序首中）', !!rr && rr.root === '/synthetic/proj-root' && String(rr.basis).includes('身份注册'))
    t('⑩ R13 派生：非默认 ledger_path→生产 P.projectLedger 真派生；默认配置→恒等映射', typeof migratePaths === 'function' && (() => {
      const proj = mkdtempSync(join(tmpdir(), 'lm-r13-'))
      try {
        mkdirSync(join(proj, '.zcode'), { recursive: true })
        writeFileSync(join(proj, '.zcode', 'org-config.json'), JSON.stringify({ ledger_path: 'custom/ledger.jsonl' }))
        const custom = migratePaths({ projectRoot: proj })
        const dflt = migratePaths({ projectRoot: join(proj, 'd2') })
        return custom.projectLedger === join(proj, 'custom', 'ledger.jsonl') && dflt.projectLedger === join(proj, 'd2', '.zcode', 'org-ledger.jsonl')
      } finally { rmSync(proj, { recursive: true, force: true }) }
    })())
    t('⑬ R13 E2E：非默认配置→apply 写派生路径→verify 同路径绿（env ORG_QUARANTINE_PATH 隔离·零触生产）', typeof runApply === 'function' && typeof runVerify === 'function' && (() => {
      const proj = mkdtempSync(join(tmpdir(), 'lm-r13e-'))
      try {
        mkdirSync(join(proj, '.zcode'), { recursive: true })
        writeFileSync(join(proj, '.zcode', 'org-config.json'), JSON.stringify({ ledger_path: 'custom/ledger.jsonl' }))
        const src = readSource(join(SKILL_ROOT, '.zcode', 'org-ledger.jsonl')) // 生产源只读
        const expectAi = src.lines.filter((l) => { try { return isAttribution(JSON.parse(l)) } catch { return false } }).length
        const cand = join(proj, 'cand.json')
        writeFileSync(cand, JSON.stringify(buildCandidate(src.raw, src.lines)))
        process.env.ORG_QUARANTINE_PATH = join(proj, 'q.jsonl')
        try {
          if (runApply({ projectRoot: proj, candidate: cand, manifest: join(proj, 'm.json') }) !== true) return false
          const derived = join(proj, 'custom', 'ledger.jsonl')
          return existsSync(derived) && splitLines(readFileSync(derived, 'utf8')).length === expectAi && runVerify({ projectRoot: proj, manifest: join(proj, 'm.json') }) === true
        } finally { delete process.env.ORG_QUARANTINE_PATH }
      } finally { rmSync(proj, { recursive: true, force: true }) }
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
    t('⑯ R15 CLI：schema 错/缺 source/targets 数量不符→真 exit 3；内容不符→真 exit 1', (() => {
      const mfReal = rr0 ? join(rr0.root, '.zcode', 'org-ledger.migration.json') : null
      if (!mfReal || !existsSync(mfReal)) return false
      const raw = readFileSync(mfReal, 'utf8')
      const mk = (mut) => { const p2 = join(tmpdir(), 'lm-r15-' + Math.random().toString(36).slice(2) + '.json'); writeFileSync(p2, mut(raw)); return p2 }
      const runCli = (mp) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--verify', '--manifest', mp]).status
      const bads = [
        mk((t) => JSON.stringify({ ...JSON.parse(t), schema: 'ledger-migration/9' })),
        mk((t) => { const m = JSON.parse(t); delete m.source; return JSON.stringify(m) }),
        mk((t) => { const m = JSON.parse(t); m.targets = m.targets.slice(0, 1); return JSON.stringify(m) }),
      ]
      const content = mk((t) => t.replace(/("line_sha256": \[\s*")([0-9a-f])/, (mm, g1, g2) => g1 + '0'))
      const codes = [...bads.map(runCli), runCli(content)]
      for (const p2 of [...bads, content]) rmSync(p2, { force: true })
      return codes[0] === 3 && codes[1] === 3 && codes[2] === 3 && codes[3] === 1
    })())
    t('⑪ R2 配置破损不吞：CLI 装载 catch 分支持 exit 3（tripwire·源面断言）', (() => { const src = readFileSync(fileURLToPath(import.meta.url), 'utf8'); return /装载失败：\$\{e\.message\}（返工 R2[^）]*）[\s\S]{0,80}process\.exit\(3\)/.test(src) })())
    t('⑫ R3 逃逸负例：fixture 模式 candidate 越出夹具根→用法错拒（migratePaths 围栏）', (() => { try { if (typeof migratePaths === 'function') migratePaths({ fixtureRoot: '/synthetic/fx', candidate: '/synthetic/outside/candidate.json' }); return false } catch (e) { return e instanceof UsageError && String(e.message).includes('夹具根') } })())
  } catch (e) { t(`夹具异常（${e.message}）`, false) } finally { if (fx) rmSync(fx, { recursive: true, force: true }) }
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
export function assertFixtureConfine(fixtureRoot, p, kind) { // 返工 R3/R14/R14b：realpath 三面 containment＋写目标节点 lstat（含悬空 symlink 一律拒）
  if (!fixtureRoot || !p) return
  const root = realOf(fixtureRoot), target = resolve(p)
  let st = null
  try { st = lstatSync(target) } catch { st = null } // 缺席=无节点（悬空链接本体 lstat 仍可命中）
  if (st && st.isSymbolicLink())
    throw new UsageError(`${kind} 写路径为符号链接节点（${target}——含悬空链接·写穿逃逸面——R14b 一律拒）`)
  let real = target
  try { real = realpathSync(target) } catch { real = join(realOf(dirname(target)), basename(target)) } // 目标缺席→父目录真身＋basename
  if (real !== root && !real.startsWith(root + '/'))
    throw new UsageError(`${kind} 写路径越出夹具根（${target}→真身 ${real}）——fixture 模式 symlink 载体逃逸禁入生产（R3/R14）`)
}
export function migratePaths({ fixtureRoot = null, projectRoot = null, candidate = null, manifest = null } = {}) {
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
    projectLedger: ledgerPathFor(projectRoot), // 返工 R13：真派生（merged ledger_path 相对项目根——apply/verify/rollback 共用同一 P·非默认配置端到端支持）
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
  writeFileSync(P.candidate, JSON.stringify(cand, null, 2) + '\n')
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
  return withFileLock(p + '.lock', () => writeFileSync(p, lines.length ? lines.join('\n') + '\n' : ''))
}
function appendLedgerLine(p, line) {
  mkdirSync(dirname(p), { recursive: true })
  return withFileLock(p + '.lock', () => { const cur = existsSync(p) ? readFileSync(p, 'utf8') : ''; writeFileSync(p, (cur && !cur.endsWith('\n') ? cur + '\n' : cur) + line + '\n') })
}
export function runApply(opts = {}) {
  const P = migratePaths(opts)
  if (!existsSync(P.candidate)) throw new Error(`候选件不存在：${P.candidate}（先 --dry-run 产候选件并经主控批准）`)
  let cand = null
  try { cand = JSON.parse(readFileSync(P.candidate, 'utf8')) } catch (e) { throw new Error(`候选件解析失败 ${P.candidate}: ${e.message}`) }
  if (!cand || cand.schema !== CANDIDATE_SCHEMA || !cand.source) throw new Error(`候选件 schema 不符（${P.candidate}）——须 ${CANDIDATE_SCHEMA}`)
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
  writeFileSync(P.manifest, JSON.stringify(manifestObj, null, 2) + '\n')
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

// ── CLI（isMain guard）──
const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) selfTest()
  let fixtureRoot = null, candidate = null, manifest = null, projectExplicit = null
  try {
    fixtureRoot = cliFlag(argv, '--fixture-root')
    candidate = cliFlag(argv, '--candidate')
    manifest = cliFlag(argv, '--manifest')
    projectExplicit = cliFlag(argv, '--project')
  } catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
    throw e
  }
  const modes = ['--dry-run', '--apply', '--verify', '--rollback'].filter((m) => argv.includes(m))
  if (modes.length !== 1) { console.error(`[用法错] 须恰一个模式：--dry-run／--apply --candidate <候选件>／--verify [--manifest <件>]／--rollback --manifest <件>（收到：${modes.join(',') || '无'}）`); process.exit(1) }
  const mode = modes[0]
  if (mode === '--apply' && !candidate) { console.error('[用法错] --apply 须搭配 --candidate <候选件路径>（候选快照受控交接——D-5）'); process.exit(1) }
  let projectRoot = null
  let projects = null
  try { const m = loadOrgConfig(SKILL_ROOT).merged; projects = m && typeof m.projects === 'object' && m.projects ? m.projects : {} } catch (e) { console.error(`[装载错] org-config 装载失败：${e.message}（返工 R2——配置异常不得吞成空后继续启发式）`); process.exit(3) }
  if (!fixtureRoot) {
    const rr = resolveProjectRoot(projectExplicit, projects)
    if (!rr) { console.error('[装载错] 生产项目根无法定址——传 --project <主仓根>，或在本机件 projects 分区落 {root} 对象（06 §5.8 行 3=配置/装载错）'); process.exit(3) }
    projectRoot = rr.root
    console.log(`[root] 项目根=${projectRoot}（依据：${rr.basis}）`) // R2：回退/定址依据 stdout 回显
  }
  try {
    if (mode === '--dry-run') { runDryRun({ fixtureRoot, projectRoot, candidate }); process.exit(0) }
    if (mode === '--apply') { runApply({ fixtureRoot, projectRoot, candidate, manifest }); process.exit(0) }
    if (mode === '--verify') { const ok = runVerify({ fixtureRoot, projectRoot, manifest }); process.exit(ok ? 0 : 1) }
    if (mode === '--rollback') { if (!manifest) { console.error('[用法错] --rollback 须显式 --manifest <路径>（D-13②受控入口）'); process.exit(1) } runRollback({ fixtureRoot, projectRoot, manifest, note: cliFlag(argv, '--note') }); process.exit(0) }
  } catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); process.exit(1) }
    if (e && (e.code === 'SOURCE_CHANGED' || e.code === 'VERIFY_GREEN' || e.code === 'TARGET_EXISTS')) { console.error(`[FAIL] ${e.message}`); process.exit(1) }
    if (e && e.code === 'MANIFEST_MISSING') { console.error(`[装载错] ${e.message}（06 §5.8 行 3=配置/装载错）`); process.exit(3) }
    console.error(`[FAIL] ${e.message}`)
    process.exit(1)
  }
}
