/**
 * 新项目防线日脚手架（ai-dev-org）——一条命令落地 05 §4 首周清单：
 *   ORG-SEG 插入（交互确认+预算自检联动）/CI 骨架（参数化 stack）/
 *   门禁聚合入口/任务书六段模板/台账/org-delta 初始化/.gitignore 片段。
 * 用法：
 *   node scripts/init-defenses.mjs --target <目录> --stack <npm-verify|pnpm-pygates|generic>
 *        [--project <项目名>] [--yes] [--dry-run]
 * 退出码口径单源=references/06 §5.8；本件特有：预算自检 FAIL 先回滚再退
 *   （exit 1）——此处不复写数字=语义映射，防双源漂移（evolve 批 b8 指针化）。
 * 覆盖安全：一切写入=「不存在则创建」；须确认的修改仅一处=AGENTS.md
 *   追加 ORG-SEG 段——须 --yes 或 TTY 交互确认，否则 SKIP（.gitignore
 *   幂等片段追加不须确认：含标记即跳过，重复内容不会写入）。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { spawnSync } from 'node:child_process'
import { SKILL_ROOT } from './org-config.mjs'

const TPL = join(SKILL_ROOT, 'templates')
const STACKS = ['npm-verify', 'pnpm-pygates', 'generic']
const GATE_ENTRY = {
  'npm-verify': { src: 'verify.mjs', dst: 'scripts/verify.mjs', desc: 'npm 门禁聚合（探测 package.json scripts）' },
  'pnpm-pygates': { src: 'run_gates.py', dst: 'scripts/run_gates.py', desc: 'pnpm+py 门禁聚合（探测 ruff/mypy/pytest）' },
  generic: { src: 'verify-generic.sh', dst: 'scripts/verify-generic.sh', desc: 'generic 门禁聚合（手填 GATES 数组）' },
}

const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const target = flag('--target')
const stack = flag('--stack')
const projectName = flag('--project')
const assumeYes = argv.includes('--yes')
const dryRun = argv.includes('--dry-run')
const date = new Date().toISOString().slice(0, 10)

if (!target || !stack) {
  console.error('用法: node scripts/init-defenses.mjs --target <目录> --stack <npm-verify|pnpm-pygates|generic> [--project <名>] [--yes] [--dry-run]')
  process.exit(1)
}
if (!STACKS.includes(stack)) { console.error(`FAIL stack 枚举外: ${stack}（可选 ${STACKS.join('/')}）`); process.exit(3) }
const dir = resolve(target)
if (!existsSync(dir)) { console.error(`FAIL 目标目录不存在: ${dir}`); process.exit(3) }
if (dir === SKILL_ROOT) { console.error('FAIL --target 指向技能根本身（防呆：脚手架产物不得写回技能本体）'); process.exit(3) }
for (const f of ['org-seg.snippet.md', 'agents-skeleton.md', `ci-${stack}.yml`, GATE_ENTRY[stack].src, 'task-brief-template.md', 'ledger-template.md', 'gitignore.snippet']) {
  if (!existsSync(join(TPL, f))) { console.error(`FAIL 技能模板缺失: templates/${f}`); process.exit(3) }
}
const project = projectName || dir.split(/[\\/]/).pop()
const plan = []
const done = (msg) => { console.log(`[OK] ${msg}`); plan.push(msg) }
const skip = (msg) => { console.log(`[SKIP] ${msg}`); plan.push('(skip) ' + msg) }
const render = (s) => s.replaceAll('{{PROJECT}}', project).replaceAll('{{DATE}}', date).replaceAll('{{STACK}}', stack)
const createIfAbsent = (abs, rel, desc, content) => {
  if (existsSync(abs)) return skip(`${desc}（已存在，不覆盖）: ${rel}`)
  if (!dryRun) { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content, 'utf8') }
  done(`${desc}: ${rel}`)
}

// ── 1. ORG-SEG 插入（交互确认+预算自检联动——超限自动回滚） ──
const agentsPath = join(dir, 'AGENTS.md')
const orgSegRaw = readFileSync(join(TPL, 'org-seg.snippet.md'), 'utf8').replace(/\r\n/g, '\n')
if (existsSync(agentsPath)) {
  const orig = readFileSync(agentsPath, 'utf8')
  if (/ORG-SEG:BEGIN/.test(orig)) skip('ORG-SEG 插入（已存在标记段——多段=预算分散逃逸，禁重复插入）')
  else {
    let confirm = false
    if (assumeYes) confirm = true
    else if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      const answer = await new Promise((res) => rl.question(`将向 ${agentsPath} 尾部追加 ORG-SEG 段（~330 非空白字符），继续？[y/N] `, res))
      rl.close() // readline 持有 stdin 监听不释放会挂起进程（W5 审 Kimi-B4/ds-W1）
      confirm = /^y(es)?$/i.test(answer.trim())
    }
    if (!confirm) skip('ORG-SEG 插入（非交互环境且未给 --yes——加 --yes 确认追加）')
    else {
      if (dryRun) done(`ORG-SEG 插入（dry-run）: AGENTS.md 尾部`)
      else {
        const backup = agentsPath + '.init-defenses.bak'
        copyFileSync(agentsPath, backup)
        appendFileSync(agentsPath, '\n' + orgSegRaw + '\n', 'utf8')
        const budget = spawnSync(process.execPath, [join(SKILL_ROOT, 'scripts', 'check-constitution-budget.mjs'), agentsPath], { encoding: 'utf8' })
        if (budget.status === 0) { unlinkSync(backup); done(`ORG-SEG 插入+预算自检联动: AGENTS.md（${budget.stdout.trim()}）`) }
        else { copyFileSync(backup, agentsPath); unlinkSync(backup); console.error(`FAIL ORG-SEG 插入后预算自检不过，已回滚：${budget.stdout.trim() || budget.stderr.trim()}`); process.exit(1) }
      }
    }
  }
} else {
  const skeleton = render(readFileSync(join(TPL, 'agents-skeleton.md'), 'utf8').replace(/\r\n/g, '\n')).replace('{{ORG_SEG}}', orgSegRaw)
  if (dryRun) done('宪法骨架+ORG-SEG 生成（dry-run）: AGENTS.md')
  else {
    writeFileSync(agentsPath, skeleton, 'utf8')
    const budget = spawnSync(process.execPath, [join(SKILL_ROOT, 'scripts', 'check-constitution-budget.mjs'), agentsPath], { encoding: 'utf8' })
    if (budget.status !== 0) {
      unlinkSync(agentsPath) // 骨架自检 FAIL 同样回滚（与追加路径行为一致，W5 审 ds-W3）——否则留下超限半成品且重跑被 SKIP 卡死
      console.error(`FAIL 骨架 ORG-SEG 预算自检不过（已回滚，模板缺陷请报技能维护方）：${budget.stdout.trim()}`)
      process.exit(1)
    }
    done(`宪法骨架+ORG-SEG 生成+预算自检（${budget.stdout.trim()}）: AGENTS.md`)
  }
}

// ── 2. CI 骨架（参数化 stack；ci-defenses.yml 避开既有 ci.yml） ──
createIfAbsent(join(dir, '.github', 'workflows', 'ci-defenses.yml'), '.github/workflows/ci-defenses.yml',
  `CI 骨架（stack=${stack}）`, render(readFileSync(join(TPL, `ci-${stack}.yml`), 'utf8')))

// ── 3. 门禁聚合入口 ──
const gate = GATE_ENTRY[stack]
createIfAbsent(join(dir, gate.dst), gate.dst, `门禁聚合入口（${gate.desc}）`, readFileSync(join(TPL, gate.src), 'utf8'))

// ── 4. 任务书六段模板 ──
createIfAbsent(join(dir, 'docs', 'templates', 'task-brief-template.md'), 'docs/templates/task-brief-template.md',
  '任务书六段模板', render(readFileSync(join(TPL, 'task-brief-template.md'), 'utf8')))

// ── 5. 台账（追加式） ──
createIfAbsent(join(dir, 'docs', 'ledger.md'), 'docs/ledger.md',
  '台账', render(readFileSync(join(TPL, 'ledger-template.md'), 'utf8')))

// ── 6. org-delta 初始化（.zcode/org-delta.jsonl——技能 05 §6 回灌通道） ──
const deltaPath = join(dir, '.zcode', 'org-delta.jsonl')
if (existsSync(deltaPath)) skip(`org-delta 初始化（已存在，不覆盖）: .zcode/org-delta.jsonl`)
else if (dryRun) done('org-delta 初始化（dry-run）: .zcode/org-delta.jsonl')
else {
  mkdirSync(dirname(deltaPath), { recursive: true })
  writeFileSync(deltaPath, JSON.stringify({ date, ticket: 'init-defenses', delta: `防线日初始化（stack=${stack}）`, suggestion: '-' }) + '\n', 'utf8')
  done('org-delta 初始化: .zcode/org-delta.jsonl（首行=init 事件）')
}

// ── 7. .gitignore 片段（幂等追加） ──
const giPath = join(dir, '.gitignore')
const giSnippet = readFileSync(join(TPL, 'gitignore.snippet'), 'utf8')
const giExisting = existsSync(giPath) ? readFileSync(giPath, 'utf8') : ''
if (giExisting.includes('ai-dev-org 防线片段')) skip('.gitignore 片段（已含标记，幂等跳过）')
else if (dryRun) done('.gitignore 片段追加（dry-run）')
else { appendFileSync(giPath, (giExisting.endsWith('\n') || giExisting === '' ? '' : '\n') + giSnippet, 'utf8'); done('.gitignore 片段追加') }

console.log(dryRun ? `\ndry-run 汇总：计划写入 ${plan.filter((p) => !p.startsWith('(skip)')).length} 项 / 跳过（已存在）${plan.filter((p) => p.startsWith('(skip)')).length} 项（零写入）` : `\n防线日汇总：完成 ${plan.filter((p) => !p.startsWith('(skip)')).length} 项 / 跳过 ${plan.filter((p) => p.startsWith('(skip)')).length} 项（stack=${stack}）`)
console.log('下一步：逐项核对技能 references/05 §4 首周清单——脚手架≠防线齐装，缺的 gate 按 [SKIP] 行提示补齐')
