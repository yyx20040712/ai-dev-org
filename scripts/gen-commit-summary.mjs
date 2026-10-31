#!/usr/bin/env node
/**
 * Conventional 提交短句生成器（B6 文档生成批·docs/13 原案 B3 动作 7·b3_docgen_v1 试点形态）：
 *  - 缺省输出恰三行：<type>(<scope>): <subject> ／ Ledger: <项目相对账本路径>#runId=<runid> ／
 *    Batch: <batch-pointer>；锁定面变更且显式 --locked-change 时追加唯一第四行 [locked-change]，
 *    其他尾注与第五行一律拒绝（试点例外见 08 §8.5 两批回访条件）；
 *  - 账本只读逐行 JSON.parse 定位 runId（恰一行才继续）；不声明该行通过 schema 校验——
 *    账本校验仍只跑 B1 ledger-migrate.mjs --verify 与既有 R4，本脚本不建第二套校验；
 *  - batch-pointer 须为存在的项目仓内相对路径（禁绝对路径、..、URL、换行）；
 *  - 首行按 Unicode code point 计数≤72；subject 去首尾空白非空、无换行、不以句号结尾；
 *  - 正文不复制账本 note、论证或审核结论；相同输入重复运行逐字节相同；
 *  - --check 须搭配 --message-file：内存重算同一三行（或例外四行）并与该文件逐字节比较，不写回。
 * 用法：node scripts/gen-commit-summary.mjs --project <主仓根> --ledger <账本路径>
 *       --runid <实际派发行> --batch-pointer <仓内相对路径> --type <feat|fix|docs|chore>
 *       --scope <批次号> --subject <短句> [--locked-change]
 *       [--check --message-file <既有试点消息路径>] | --self-test
 * 退出码口径单源=references/06 §5.8：0=成功；1=用法/参数错或内容判红或自检失败；3=配置/装载失败。
 * 02 §2「分笔中文 commit」通则不变——本形态为 b3_docgen_v1 试点，不因试点改写通则。
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { SKILL_ROOT, UsageError } from './org-config.mjs'

const SELF = fileURLToPath(import.meta.url)
const TYPES = ['feat', 'fix', 'docs', 'chore']
const EXIT_OK = 0, EXIT_RED = 1, EXIT_CONFIG = 3
class ContentError extends Error {}
const usageExit = (m) => { console.error(`[用法错] ${m}（06 §5.8 行 1）`); process.exit(EXIT_RED) }
const redExit = (m) => { console.error(`[判红] ${m}`); process.exit(EXIT_RED) }
const configExit = (m) => { console.error(`[装载错] ${m}（06 §5.8 行 3）`); process.exit(EXIT_CONFIG) }

function parseArgs(argv, spec) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) usageExit(`多余位置参数：${a}`)
    if (a.includes('=')) usageExit(`等号形态「${a}」不支持——flag 一律空格分隔取值`)
    if (spec.bool.includes(a)) { out[a] = (out[a] || 0) + 1; if (out[a] > 1) usageExit(`重复 flag：${a}`); continue }
    const isValue = spec.value.includes(a)
    if (!isValue) usageExit(`未知参数：${a}（本脚本仅提供点名模式与 --self-test）`)
    const v = argv[i + 1]
    if (v === undefined) usageExit(`flag ${a} 居末位无值`)
    if (v.startsWith('--')) usageExit(`flag ${a} 的值形如 flag（「${v}」）`)
    if (v.trim() === '') usageExit(`flag ${a} 的值不得为空串或纯空白（W-2/N-10 同源：空值=用法错）`)
    i++
    if (out[a] !== undefined) usageExit(`重复 flag：${a}`)
    out[a] = v
  }
  return out
}

/** 校验并生成三行（或例外四行）消息文本；任何判红抛 ContentError。 */
function buildMessage(args) {
  const type = args['--type']
  if (!TYPES.includes(type)) usageExit(`--type 取值须 ${TYPES.join('|')}（收到「${type}」）`)
  const scope = args['--scope']
  // N-3：--scope 拒括号对与空白字符（防 first line 形态破坏）；换行含 \r\n
  if (!scope || !scope.trim() || /[\s()]/.test(scope)) redExit(`--scope 须非空且不含空白或括号：${scope ?? '(缺)'}`)
  const subject = args['--subject']
  if (subject === undefined || !subject.trim() || /[\n\r]/.test(subject)) redExit('--subject 去首尾空白后须非空且无换行')
  if (/[。.]$/.test(subject.trim())) redExit('--subject 不以句号结尾（全角或半角；叙事移入账本只留指针）')
  const first = `${type}(${scope}): ${subject.trim()}`
  if (Array.from(first).length > 72) redExit(`首行超长：${Array.from(first).length} > 72（按 Unicode code point 计数）`)
  const projectDir = resolve(args['--project'])
  if (!existsSync(projectDir)) redExit(`项目目录不存在：${projectDir}`)
  const ledgerPath = resolve(args['--ledger'])
  const ledgerRel = relative(projectDir, ledgerPath)
  if (!ledgerRel || ledgerRel.startsWith('..') || isAbsolute(ledgerRel)) redExit(`账本须在项目内（相对路径得「${ledgerRel || '(项目根外)'}」）`)
  if (!existsSync(ledgerPath)) configExit(`账本不可读：${ledgerPath}`)
  const runid = args['--runid']
  if (!runid || /[\n\r]/.test(runid)) redExit('--runid 须非空且无换行（含 \\r 拒收——N-3）')
  let hits = 0
  for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let obj = null
    try { obj = JSON.parse(line) } catch { continue }
    if (obj && typeof obj === 'object' && obj.runId === runid) hits++
  }
  if (hits === 0) throw new ContentError(`账本未命中 runId：${runid}（缺行即停，不读其他行代替）`)
  if (hits > 1) throw new ContentError(`账本 runId 重复命中 ${hits} 行：${runid}（恰一行才继续）`)
  const pointer = args['--batch-pointer']
  if (!pointer || /[\n\r]/.test(pointer)) redExit('--batch-pointer 须非空且无换行（含 \\r 拒收——N-3）')
  if (isAbsolute(pointer) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(pointer)) redExit(`--batch-pointer 禁绝对路径/URL：${pointer}`)
  const norm = pointer.replace(/\\/g, '/')
  if (norm.split('/').includes('..')) redExit(`--batch-pointer 禁 .. 段：${pointer}`)
  if (!existsSync(join(projectDir, norm))) throw new ContentError(`批档指针不存在：${pointer}（须为项目仓内存在的相对路径）`)
  const lines = [first, `Ledger: ${ledgerRel}#runId=${runid}`, `Batch: ${norm}`]
  if (args['--locked-change'] === 1) lines.push('[locked-change]')
  return lines.join('\n') + '\n'
}

// ── --self-test：固定快照驱动，真 CLI 子进程，逐项打印 case=<name> exit=<真值> ──
function selfTest() {
  const fxPath = join(SKILL_ROOT, 'scripts', '.golden', 'docgen-fixtures.json')
  if (!existsSync(fxPath)) configExit(`固定快照缺失：${fxPath}`)
  let fx
  try { fx = JSON.parse(readFileSync(fxPath, 'utf8')) } catch (e) { configExit(`固定快照不可解析：${e.message}`) }
  const tmp = mkdtempSync(join(tmpdir(), 'gen-commit-st-'))
  let allOk = true
  const note = (ok, label) => { if (!ok) allOk = false; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`) }
  try {
    const proj = join(tmp, 'proj')
    mkdirSync(join(proj, '.zcode'), { recursive: true })
    for (const [rel, content] of Object.entries(fx.sources)) {
      const p = join(proj, rel)
      mkdirSync(join(p, '..'), { recursive: true })
      writeFileSync(p, content, 'utf8')
    }
    writeFileSync(join(proj, '.zcode', 'org-ledger.jsonl'), fx.ledger_lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
    writeFileSync(join(proj, '.zcode', 'org-ledger-dup.jsonl'), fx.ledger_lines_dup.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
    const staleMsg = join(tmp, 'stale-msg.txt')
    writeFileSync(staleMsg, fx.expected.commit3.replace('Batch:', 'Batch 改动:'), 'utf8')
    const okMsg = join(tmp, 'ok-msg.txt')
    writeFileSync(okMsg, fx.expected.commit3, 'utf8')
    const run = (args) => spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', timeout: 60_000 })
    const subst = (args) => args.map((a) => a.replace(/@PROJECT@/g, proj).replace(/@LEDGER@/g, join(proj, '.zcode', 'org-ledger.jsonl')).replace(/@LEDGER_DUP@/g, join(proj, '.zcode', 'org-ledger-dup.jsonl')).replace(/@MSG@/g, staleMsg).replace(/@OKMSG@/g, okMsg))
    for (const c of fx.self_test_cases['gen-commit-summary']) {
      const r = run(subst(c.args))
      const code = r.status === null ? 124 : r.status
      console.log(`case=${c.name} exit=${code}`)
      if (code !== c.expected_exit) allOk = false
    }
    const p1 = subst(fx.self_test_cases['gen-commit-summary'].find((c) => c.name === 'commit-p1-deterministic').args)
    const r1 = run(p1), r2 = run(p1)
    note(r1.status === 0 && r2.status === 0 && r1.stdout === r2.stdout, '固定快照两次生成逐字节一致（重复运行 stdout 相同）')
    note(r1.stdout === fx.expected.commit3, '快照期望字节一致（fixture.expected.commit3 三行）')
    const r4 = run(subst(fx.self_test_cases['gen-commit-summary'].find((c) => c.name === 'commit-p2-locked-change').args))
    note(r4.status === 0 && r4.stdout === fx.expected.commit4, '快照期望字节一致（fixture.expected.commit4 锁定面例外四行）')
    const rc = run(p1.concat(['--check', '--message-file', okMsg]))
    note(rc.status === 0, '--check 一致（内存重算与消息文件逐字节相同）')
    console.log('PASS 输入乱序一致=无序参面（本脚本参数无排列维度，确定性由重复运行对照承载）')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  return allOk
}

const argv = process.argv.slice(2)
const ARG_SPEC = { value: ['--project', '--ledger', '--runid', '--batch-pointer', '--type', '--scope', '--subject', '--message-file'], bool: ['--locked-change', '--check', '--self-test'] }
// N-1：--self-test 不绕过参数检查——先按同源 parseArgs 校验（未知/重复/等号/空值=用法错）再进自检
try {
  parseArgs(argv, ARG_SPEC)
  if (argv.includes('--self-test')) process.exit(selfTest() ? EXIT_OK : EXIT_RED)
  const args = parseArgs(argv, ARG_SPEC)
  for (const req of ['--project', '--ledger', '--runid', '--batch-pointer', '--type', '--scope', '--subject']) if (args[req] === undefined) usageExit(`缺必填参数：${req}`)
  if ((args['--check'] === 1) !== (args['--message-file'] !== undefined)) usageExit('--check 与 --message-file 须搭配出现')
  const msg = buildMessage(args)
  if (args['--check'] === 1) {
    const mf = resolve(args['--message-file'])
    if (!existsSync(mf)) redExit(`--message-file 不存在：${mf}`)
    const cur = readFileSync(mf)
    if (!cur.equals(Buffer.from(msg, 'utf8'))) { console.error('[判红] --check 重算与消息文件不一致（试点短句漂移或尾注越形）'); process.exit(EXIT_RED) }
    console.log(`commit-summary --check 一致：${mf}（${Array.from(msg).length} code points）`)
    process.exit(EXIT_OK)
  }
  process.stdout.write(msg)
} catch (e) {
  if (e instanceof UsageError) usageExit(e.message)
  if (e instanceof ContentError) redExit(e.message)
  if (e instanceof Error && e.code === 'ENOENT') configExit(`装载失败：${e.message}`)
  console.error(`[fatal] ${e.message}`)
  process.exit(EXIT_CONFIG)
}
