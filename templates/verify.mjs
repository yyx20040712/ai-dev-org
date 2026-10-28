/**
 * 门禁聚合入口（npm-verify 型骨架）——ai-dev-org init-defenses 生成。
 * 语义：探测 package.json scripts，逐 gate 跑「存在者」；缺失=SKIP（骨架
 * 宽松模式）。**宽松模式不是门禁**——投产必须 DEFENSES_STRICT=1（CI
 * 模板已设）：SKIP 升级为 FAIL，逼门禁齐装（W5 审 Kimi-W9 防假门禁）。
 * 用法：node scripts/verify.mjs（退出码口径单源=ai-dev-org 技能 references/06
 *   §5.8——分发到项目后以项目门禁文档为准，本件不复写数字映射）
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const STRICT = process.env.DEFENSES_STRICT === '1'
// gate 清单按需增删；顺序=快失败优先（静态检查在前，构建在后）
const GATES = [
  { id: 'lint', script: 'lint', hint: 'npm pkg set scripts.lint="eslint ."（先装 eslint）' },
  { id: 'typecheck', script: 'typecheck', hint: 'npm pkg set scripts.typecheck="tsc --noEmit"' },
  { id: 'test', script: 'test', hint: 'npm pkg set scripts.test="vitest run"（先装 vitest）' },
  { id: 'build', script: 'build', hint: 'npm pkg set scripts.build=…（本项目构建命令）' },
]

if (!existsSync('package.json')) {
  console.log(`SKIP package.json 不存在——先 npm init 并配置上方 GATES 对应 scripts${STRICT ? '（STRICT：视为 FAIL）' : ''}`)
  process.exit(STRICT ? 1 : 0)
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8').replace(/^\uFEFF/, ''))
const scripts = pkg.scripts || {}

let fails = 0
for (const g of GATES) {
  if (!scripts[g.script]) {
    console.log(`SKIP ${g.id}（package.json 无 scripts.${g.script}）→ ${g.hint}`)
    if (STRICT) fails++
    continue
  }
  console.log(`-- gate ${g.id}: npm run ${g.script}`)
  const r = spawnSync('npm', ['run', g.script], { stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) {
    console.error(`FAIL ${g.id}（exit=${r.status}）`)
    fails++
  } else {
    console.log(`PASS ${g.id}`)
  }
}
console.log(fails === 0 ? `verify 汇总：PASS（${STRICT ? 'strict' : '宽松'}模式，缺失 gate 不阻断）` : `verify 汇总：FAIL ×${fails}`)
process.exit(fails === 0 ? 0 : 1)
