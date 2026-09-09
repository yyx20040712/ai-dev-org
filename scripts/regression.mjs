/**
 * 技能自包含回归（ai-dev-org v1.0 冻结前置——06 §5 R1~R6 的内化执行件）：
 *   R2'=系统提示 golden 字节自比对（golden 冻结于 scripts/roles/.golden/，
 *       双路验证：档案文件装载 vs golden、派发器 --dry-run assembled_system
 *       vs golden——勾连真实装载路径，防 regression 自身装载逻辑漂移）；
 *   R5'=mock 全链 exhaust 演练（--mock-source 三源全注入=零成本，校验
 *       exit 2/attempt 12/switch 2/exhaust 1 互斥落账）；
 *   R4'=流水与账本字段完整性（两类行 schema 逐字段校验，见 06 §5）；
 *   R1'3=语义抽样（3 个锚定样例双源跑，判定方向一致性；真实派发
 *       ~9k Kimi tokens，须 --r1 显式触发=配给保护）。
 * 用法：node scripts/regression.mjs [--only R2,R5,R4] [--r1] [--update-golden]
 *       [--project <账本目录>] [--keep-tmp]
 * 退出码：0=所选回归项全过；1=任一 FAIL；3=配置错误（golden 缺失未
 *       --update-golden/宿主配置不可用）。
 * golden 更新=冻结动作：--update-golden 重生成后应随工作单元提交并在
 * 修订记登记（改系统提示≠错，错在未登记的静默漂移）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { SKILL_ROOT, readJson } from './org-config.mjs'

const SCRIPTS = join(SKILL_ROOT, 'scripts')
const GOLDEN_DIR = join(SCRIPTS, 'roles', '.golden')
const LOG_PATH = join(SCRIPTS, 'model-routing-log.jsonl')
const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const only = flag('--only') ? flag('--only').split(',').map((s) => s.trim().toUpperCase()) : null
const wantR1 = argv.includes('--r1')
const updateGolden = argv.includes('--update-golden')
const projectDir = flag('--project') || process.cwd()
const keepTmp = argv.includes('--keep-tmp')
const want = (id) => !only || only.includes(id)
const results = []
const record = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${detail}`) }
const node = () => [process.execPath]

// ── 角色装载（与 ds-call-v2.mjs loadRole 同构——锚定注释：两处须同步演进；
//    交叉验证路（R2'b）用派发器 --dry-run 真实装载兜住此处复制件的漂移） ──
function loadRoleAssembled(roleId) {
  const registry = readJson(join(SCRIPTS, 'roles', 'registry.json'))
  const def = registry.roles[roleId]
  if (!def) throw new Error(`未知角色: ${roleId}`)
  const sysPrompt = readFileSync(join(SKILL_ROOT, def.sys_prompt_file), 'utf8')
  const dod = def.dod_file ? readFileSync(join(SKILL_ROOT, def.dod_file), 'utf8') : ''
  const assembled = (def.dod_file ? sysPrompt.trimEnd() + '\n\n' + dod.trim() : sysPrompt.trimEnd()) + '\n'
  return { assembled, sig: createHash('sha256').update(sysPrompt + '\n---DOD---\n' + dod).digest('hex').slice(0, 8), version: def.role_version }
}

// ═══ R2'：golden 字节自比对（a 档案装载路 / b 派发器 dry-run 路） ═══
if (want('R2')) {
  const registry = readJson(join(SCRIPTS, 'roles', 'registry.json'))
  const roleIds = Object.keys(registry.roles)
  if (updateGolden) {
    mkdirSync(GOLDEN_DIR, { recursive: true })
    for (const id of roleIds) writeFileSync(join(GOLDEN_DIR, `${id}.system.txt`), loadRoleAssembled(id).assembled, 'utf8')
    writeFileSync(join(GOLDEN_DIR, 'MANIFEST.txt'), roleIds.map((id) => { const r = loadRoleAssembled(id); return `${id} v${r.version} sig=${r.sig} sha256=${createHash('sha256').update(r.assembled).digest('hex')}` }).join('\n') + '\n', 'utf8')
    console.log(`[golden] 已重生成 ${roleIds.length} 角色冻结副本（随工作单元提交+修订记登记）`)
  }
  if (!existsSync(join(GOLDEN_DIR, 'MANIFEST.txt'))) { console.error('FAIL R2 golden 缺失——先 --update-golden 冻结'); process.exit(3) }
  let allOk = true, detail = []
  for (const id of roleIds) {
    const goldPath = join(GOLDEN_DIR, `${id}.system.txt`)
    if (!existsSync(goldPath)) { detail.push(`${id}:golden 缺文件`); allOk = false; continue }
    const cur = Buffer.from(loadRoleAssembled(id).assembled, 'utf8')
    const gold = readFileSync(goldPath)
    if (cur.equals(gold)) detail.push(`${id}:=`)
    else { detail.push(`${id}:≠(cur ${cur.length}B/gold ${gold.length}B)`); allOk = false }
  }
  record('R2a', allOk, `档案装载 vs golden 字节比对 ${detail.join(' ')}`)
  // R2'b：派发器真实装载路交叉验证（--dry-run 零副作用：读文件+打印即退）
  const tmp = mkdtempSync(join(tmpdir(), 'r2b-'))
  const promptFile = join(tmp, 'p.txt')
  writeFileSync(promptFile, 'noop', 'utf8')
  let bOk = true, bDetail = []
  for (const id of roleIds) {
    const r = spawnSync(node()[0], [join(SCRIPTS, 'ds-call-v2.mjs'), '--role', id, '--dry-run', promptFile], { encoding: 'utf8', cwd: tmp })
    if (r.status !== 0) { bOk = false; bDetail.push(`${id}:dry-run exit=${r.status}`); continue }
    const dry = JSON.parse(r.stdout)
    const gold = readFileSync(join(GOLDEN_DIR, `${id}.system.txt`), 'utf8')
    if (dry.role.assembled_system + '\n' === gold) bDetail.push(`${id}:=`)
    else { bOk = false; bDetail.push(`${id}:≠`) }
  }
  if (!keepTmp) rmSync(tmp, { recursive: true, force: true })
  record('R2b', bOk, `派发器 dry-run assembled_system vs golden ${bDetail.join(' ')}`)
}

// ═══ R5'：mock 全链 exhaust 演练（零成本） ═══
if (want('R5')) {
  const tmp = mkdtempSync(join(tmpdir(), 'r5-'))
  const promptFile = join(tmp, 'p.txt')
  writeFileSync(promptFile, 'exhaust 演练（mock 全链注入，零成本）', 'utf8')
  const logBefore = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean).length : 0
  // cwd=tmp：账本随派发器 cwd 落 tmp/.zcode/（--project 仅是条目名，不改变落点）
  const r = spawnSync(node()[0], [join(SCRIPTS, 'ds-call-v2.mjs'), '--role', 'gate1-reviewer', '--mock-source', 'kimi-main:429,kimi-backup:429,deepseek:500', '--project', 'r5-drill', promptFile], { encoding: 'utf8', cwd: tmp })
  const exitOk = r.status === 2
  const stderrOk = (r.stderr || '').includes('全源尽')
  const lines = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean) : []
  const fresh = lines.slice(logBefore).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const runId = fresh[0]?.runId
  const mine = fresh.filter((e) => e.runId === runId)
  const attempts = mine.filter((e) => e.event === 'attempt').length
  const switches = mine.filter((e) => e.event === 'switch').length
  const exhausts = mine.filter((e) => e.event === 'exhaust')
  const ledgerPath = join(tmp, '.zcode', 'org-ledger.jsonl')
  const ledgerOk = existsSync(ledgerPath) && readFileSync(ledgerPath, 'utf8').includes('"event":"exhaust"')
  const countsOk = attempts === 12 && switches === 2 && exhausts.length === 1
  record('R5', exitOk && stderrOk && countsOk && ledgerOk,
    `exit=${r.status}(期2) stderr全源尽=${stderrOk} 事件计数 attempt=${attempts}/12 switch=${switches}/2 exhaust=${exhausts.length}/1 chain=${exhausts[0]?.chain ?? '—'} 账本exhaust=${ledgerOk}`)
  if (!keepTmp) rmSync(tmp, { recursive: true, force: true })
}

// ═══ R4'：流水与账本字段完整性 ═══
if (want('R4')) {
  const CURRENT_DISPATCHER = '2.1.0' // 与 ds-call-v2.mjs DISPATCHER_VERSION 同步演进
  const ROUTING_REQUIRED = { attempt: ['ts', 'runId', 'event', 'source', 'model', 'attempt', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'], ok: ['ts', 'runId', 'event', 'source', 'model', 'usage', 'latencyMs', 'finish', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'], switch: ['ts', 'runId', 'event', 'from', 'to', 'error', 'statusCode', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'], exhaust: ['ts', 'runId', 'event', 'chain', 'error', 'statusCode', 'role_id', 'role_version', 'role_sig', 'dispatcher_version', 'org_config_hash'] }
  const LEDGER_REQUIRED = ['ts', 'project', 'event', 'role', 'tier', 'source', 'cfg_hash', 'outcome']
  const checkLines = (label, path, required, tailN) => {
    if (!existsSync(path)) return { pass: false, detail: `${label}:文件不存在 ${path}` }
    const ls = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean).slice(-tailN)
    let bad = 0, skipped = 0, kinds = {}
    for (const l of ls) {
      let e; try { e = JSON.parse(l) } catch { bad++; continue }
      // 历史版本流水行按当时 schema 落账=合法历史（禁改写），只校验当前契约
      if (e.dispatcher_version !== undefined && e.dispatcher_version !== CURRENT_DISPATCHER) { skipped++; continue }
      const req = typeof required === 'function' ? required(e) : required
      for (const k of req) if (e[k] === undefined) { bad++; break }
      if (e.event) kinds[e.event] = (kinds[e.event] || 0) + 1
    }
    return { pass: bad === 0, detail: `${label}:尾${ls.length}行坏${bad}行跳${skipped}行(旧版本) 事件分布=${JSON.stringify(kinds)}` }
  }
  const routingReq = (e) => ROUTING_REQUIRED[e.event] || ['ts', 'runId', 'event']
  const a = checkLines('流水', LOG_PATH, routingReq, 100)
  const ledgerPath = flag('--ledger') || join(projectDir, '.zcode', 'org-ledger.jsonl')
  const b = checkLines('账本', ledgerPath, (e) => e.event === 'ok' ? [...LEDGER_REQUIRED, 'usage'] : LEDGER_REQUIRED, 50)
  record('R4', a.pass && b.pass, `${a.detail}；${b.detail}`)
}

// ═══ R1'3：语义抽样（真实派发，--r1 显式触发） ═══
if (wantR1) {
  const CASES = [
    { id: 'S1-断言弱化', expect: 'FAIL', prompt: '审查以下测试改动并只回答一行「判定:PASS」或「判定:FAIL:原因」：\n```diff\n- assert saved.tags.length === 3\n+ assert saved.tags.length >= 1\n```' },
    { id: 'S2-干净样例', expect: 'PASS', prompt: '审查以下测试改动并只回答一行「判定:PASS」或「判定:FAIL:原因」：\n```diff\n- const n = items.filter(x => x.ok).length\n+ const n = items.filter((x) => x.ok).length\n```' },
    { id: 'S3-占位残留', expect: 'FAIL', prompt: '审查以下测试改动并只回答一行「判定:PASS」或「判定:FAIL:原因」：\n```diff\n+ // TODO: 补充断言\n+ it("works", () => { expect(true).toBe(true) })\n```' },
  ]
  const SOURCES = ['kimi-main', 'deepseek']
  const tmp = mkdtempSync(join(tmpdir(), 'r1-'))
  let allPass = true, detail = []
  for (const c of CASES) {
    const verdicts = {}
    for (const src of SOURCES) {
      const pf = join(tmp, c.id + '.txt')
      writeFileSync(pf, c.prompt, 'utf8')
      const r = spawnSync(node()[0], [join(SCRIPTS, 'ds-call-v2.mjs'), '--role', 'gate1-reviewer', '--source', src, '--project', tmp, pf, pf + '.' + src + '.out'], { encoding: 'utf8', cwd: tmp, timeout: 600_000 })
      const out = r.status === 0 ? readFileSync(pf + '.' + src + '.out', 'utf8') : ''
      verdicts[src] = /判定\s*[:：]\s*PASS/i.test(out) ? 'PASS' : /判定\s*[:：]\s*FAIL/i.test(out) ? 'FAIL' : `UNPARSEABLE(exit=${r.status})`
      if (verdicts[src] === 'UNPARSEABLE') allPass = false
    }
    const agree = verdicts['kimi-main'] === verdicts['deepseek'] && verdicts['kimi-main'] === c.expect
    if (!agree) allPass = false
    detail.push(`${c.id}:${verdicts['kimi-main']}/${verdicts['deepseek']}(期${c.expect})${agree ? '✓' : '✗'}`)
  }
  if (!keepTmp) rmSync(tmp, { recursive: true, force: true })
  record('R1', allPass, `双源判定方向一致性 ${detail.join(' ')}`)
} else if (want('R1')) {
  record('R1', true, 'SKIP（未给 --r1——真实派发配给保护，~9k Kimi tokens；冻结裁决前须跑或显式登记欠账）')
}

const fails = results.filter((r) => !r.pass).length
console.log(`\nregression 汇总：${results.filter((r) => r.pass).length}/${results.length} 过${fails ? `，FAIL ×${fails}` : ''}（项=${results.map((r) => r.id).join('/')}）`)
process.exit(fails ? 1 : 0)
