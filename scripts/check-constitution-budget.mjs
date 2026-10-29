/**
 * 宪法组织段预算自检（ai-dev-org）：提取 AGENTS.md 中全部 ORG-SEG 标记段，
 * 每段非空白字符数 ≤600 为过；缺段/多段/BEGIN 无 END/超限=FAIL
 *（建单清单第 0 步强制项）。多段=配置错误（意图单段，防预算分散漏网）。
 * 用法：node check-constitution-budget.mjs [AGENTS.md 路径（默认 ./AGENTS.md）]
 * 退出码口径单源=references/06 §5.8（此处不复写数字映射——selfiter 批
 * evolve-ccb-weaktype 补还）。
 */
import { readFileSync } from 'node:fs'

const LIMIT = 600
const path = process.argv[2] || 'AGENTS.md'
let md
try {
  md = readFileSync(path, 'utf8')
} catch (e) {
  console.error(`FAIL 读取失败 ${path}: ${e.message}`)
  process.exit(1)
}
md = md.replace(/^\uFEFF/, '')
const re = /<!--\s*ORG-SEG:BEGIN[^>]*-->([\s\S]*?)<!--\s*ORG-SEG:END\s*-->/g
const segs = [...md.matchAll(re)]
// 配对校验（ds-B1 终裁）：任何 BEGIN 无配对 END=FAIL——不只依赖正则产出段数
const beginCount = (md.match(/ORG-SEG:BEGIN/g) || []).length
const endCount = (md.match(/ORG-SEG:END/g) || []).length
if (beginCount !== segs.length || endCount !== segs.length) {
  console.error(`FAIL ORG-SEG 标记不配对（BEGIN×${beginCount}/END×${endCount}/完整段×${segs.length}；标记须大写 ORG-SEG:BEGIN/END）——存在未闭合段或悬垂标记`)
  process.exit(1)
}
if (segs.length === 0) {
  console.error(`FAIL 未找到 ORG-SEG 标记段（${path}）——采用组织层的项目必须先插入标记段再建单`)
  process.exit(1)
}
if (segs.length > 1) {
  console.error(`FAIL 检出 ${segs.length} 个 ORG-SEG 段（意图单段——多段=预算分散漏网面，请合并）`)
  process.exit(1)
}
const count = segs[0][1].replace(/\s/g, '').length
if (count > LIMIT) {
  console.error(`FAIL ORG-SEG 段非空白字符 ${count} > ${LIMIT}——先裁剪（只删措辞不删条款）再派发；事件记账 kind=constitution-overrun`)
  process.exit(1)
}
console.log(`PASS ORG-SEG 段非空白字符 ${count}/${LIMIT}`)
