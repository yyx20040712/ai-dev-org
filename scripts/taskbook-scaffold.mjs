#!/usr/bin/env node
// taskbook-scaffold.mjs — 任务书起始件确定性生成器与静态 lint-only（W6 R2-T1，2026-11-01）
// 生成：完整任务书起始件=公共骨架（templates/task-brief-template.md）＋恰一件型件（templates/taskbook/<type>.md）
//       ＋五辅助待填位（assumptions／源文引用区／白名单／D/V 双锚／F/E 台账位）；占位内容不形成机读 F/E 条目。
// lint-only：只查七段、唯一型件、必备辅助段与待填位可见；不执行 F 命令、不调用 record、不生成 evidence。
// 退出码口径单源=references/06 §5.8（此处不复写语义）。
// 确定性：输出只由模板与型件文件内容决定，无时间戳、无环境派生内容；--out 已存在拒绝覆盖（不改动原文件）。
// 供应商事实零硬编码：本脚本不含端点/模型名；self-test 夹具一律落 os.tmpdir()，不写技能仓。

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, copyFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SKILL_ROOT = resolve(SCRIPT_DIR, '..')
const SELF = fileURLToPath(import.meta.url)
const TYPES = ['impl', 'docs-inst', 'data', 'route-design', 'close']
const SKELETON_FILE = 'task-brief-template.md'
const TYPE_DIR = 'taskbook'
const SEVEN = ['身份与禁令', '必读序', '预裁决', '纪律', '基线数字', '报告契约', '运行时可观察性']

export class ScaffoldLoadError extends Error {}

/** 装载公共骨架与五型件（只读；缺失/不可读=装载错）。 */
export function loadTemplates(templateDir = join(SKILL_ROOT, 'templates')) {
  const skeletonPath = join(templateDir, SKELETON_FILE)
  if (!existsSync(skeletonPath)) throw new ScaffoldLoadError(`公共骨架模板不存在：${skeletonPath}`)
  let skeleton
  try { skeleton = readFileSync(skeletonPath, 'utf8') } catch (e) { throw new ScaffoldLoadError(`公共骨架模板不可读：${skeletonPath}（${e.message}）`) }
  const typeFiles = new Map()
  for (const t of TYPES) {
    const p = join(templateDir, TYPE_DIR, `${t}.md`)
    if (!existsSync(p)) throw new ScaffoldLoadError(`型件不存在：${p}`)
    let body
    try { body = readFileSync(p, 'utf8') } catch (e) { throw new ScaffoldLoadError(`型件不可读：${p}（${e.message}）`) }
    typeFiles.set(t, body)
  }
  return { skeleton, typeFiles }
}

/** 五辅助待填位（静态文本，占位含 {{，不构成机读 F/E 行）。 */
export function auxiliaryBlock() {
  return [
    '## assumptions（scaffold 待填位·逐条替换）',
    '',
    '- {{assumption-1：证伪即停手交主控}}',
    '',
    '## 源文引用区（scaffold 待填位）',
    '',
    '- {{`路径:NN`｜被引源行原文（逐字，禁整段搬入未被引用的正文）}}',
    '',
    '## 白名单（scaffold 待填位）',
    '',
    '| 路径 | 动作 |',
    '|---|---|',
    '| {{路径}} | {{新建／修改}} |',
    '',
    '## D/V 双锚（scaffold 待填位）',
    '',
    '| D 项 | 规范锚 | 验收锚 |',
    '|---|---|---|',
    '| {{D-x}} | {{规范 file:line＋逐字片段}} | {{V-y}} |',
    '',
    '## F/E 事实台账与期望值推导（scaffold 待填位·占位不得保留为机读条目形态）',
    '',
    '- F 条目位：{{F-01 ｜ 标签 ｜ `命令` ｜ 声明值 ｜ 日期}}',
    '- E 条目位：{{E-1 ｜ 判据 #k ｜ 基线 N ← F-01 ｜ 增量 ±n ｜ 期望 M ｜ 算式}}',
    '',
  ].join('\n')
}

/** 确定性生成：公共骨架＋恰一件型件＋五辅助待填位。 */
export function generateTaskbook(type, templateDir) {
  const { skeleton, typeFiles } = loadTemplates(templateDir)
  const typeBody = typeFiles.get(type)
  const sep = (s) => (s.endsWith('\n') ? s : s + '\n')
  return sep(skeleton) + '\n' + sep(typeBody) + '\n' + auxiliaryBlock()
}

/** 解析型件标题中的型 id；非五型返回 null。 */
export function typeOfHeading(title) {
  const m = /任务书型件：[^（(]*[（(]([a-z-]+)[）)]/.exec(String(title ?? ''))
  if (!m) return null
  return TYPES.includes(m[1]) ? m[1] : null
}

/** lint-only 静态检查（纯函数；findings 非空=检出）。 */
export function lintOnly(text) {
  const findings = []
  const lines = String(text ?? '').split('\n')
  const headings = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i])
    if (m) headings.push({ line: i + 1, level: m[1].length, title: m[2] })
  }
  // S1 七段齐备（按骨架 2 级编号段标题判定，防型件低级标题子串误配）
  for (let k = 0; k < SEVEN.length; k++) {
    if (!headings.some((h) => h.level === 2 && /^\d+\.\s/.test(h.title) && h.title.includes(SEVEN[k]))) {
      findings.push({ check: 'S1', line: 0, message: `缺七段之一：「${SEVEN[k]}」` })
    }
  }
  // S2 唯一型件（恰一件且型 id 合法）
  const typeHeads = headings.filter((h) => typeOfHeading(h.title) !== null || /任务书型件：/.test(h.title))
  const rawTypeHeads = headings.filter((h) => /任务书型件：/.test(h.title))
  if (rawTypeHeads.length === 0) findings.push({ check: 'S2', line: 0, message: '缺型件（须恰一件「# 任务书型件：…」）' })
  else if (rawTypeHeads.length > 1) findings.push({ check: 'S2', line: rawTypeHeads[1].line, message: `型件多于一件（${rawTypeHeads.length} 件）` })
  else if (typeOfHeading(rawTypeHeads[0].title) === null) findings.push({ check: 'S2', line: rawTypeHeads[0].line, message: `型件型 id 非法（须为 ${TYPES.join('／')}）` })
  // S3 五辅助段齐备
  const AUX = [
    ['assumptions', /assumptions/i],
    ['源文引用区', /源文引用区/],
    ['白名单', /白名单/],
    ['D/V 双锚', /D\/V/],
    ['F/E 事实台账', /F\/E|事实台账/],
  ]
  for (const [name, re] of AUX) {
    if (!headings.some((h) => re.test(h.title))) findings.push({ check: 'S3', line: 0, message: `缺必备辅助段：「${name}」` })
  }
  // S4 待填位可见
  const ph = lines.filter((l) => l.includes('{{')).length
  if (ph === 0) findings.push({ check: 'S4', line: 0, message: '待填位不可见（无 {{…}} 占位）' })
  // S5（W5b D-6·W-2 锚片段规约代码化·r5 围栏跳过）：①反引号计数奇数=未闭合 span；②路径型或
  // :NN 简写引用候选未完整落在任一 inline span 内；③引用 span 片段为空「」——三类 finding 文案
  // 逐字含规约字面「锚片段禁含内层反引号；整行含反引号时改取净子段」。只扫围栏外行（r5·ds-W-2：
  // 围栏代码块内形态不产生 finding）。合法生成物 0 findings。
  const S5_NOTE = '锚片段禁含内层反引号；整行含反引号时改取净子段'
  const S5_PATH_LIKE = (v) => typeof v === 'string' && v.length > 0 && !/\s/.test(v) && !/[<>{}*…]/.test(v) && /\.(md|mjs|js|json|jsonl|txt|py|sh|yml|yaml|snippet)$/i.test(v)
  const S5_CAND_RE = /([^\s「」`]*):\d+「[^」]*」/g
  let s5Fence = null
  for (let i = 0; i < lines.length; i++) {
    const fm5 = /^\s*(```|~~~)/.exec(lines[i])
    // W5c D-5：s5Fence 保存实际 marker——空态遇 ```／~~~ 开启；非空态仅同 marker 关闭，异 marker 为块内行
    // 继续跳过（不在两种标记间交替闭合）；marker 比较沿用 fm5[1] 三字符形态（更长围栏非本 D 范围）
    if (fm5) { if (s5Fence === null) s5Fence = fm5[1]; else if (s5Fence === fm5[1]) s5Fence = null; continue }
    if (s5Fence) continue
    const ln = lines[i]
    const bt = (ln.match(/`/g) ?? []).length
    if (bt % 2 === 1) findings.push({ check: 'S5', line: i + 1, message: `未闭合 span（反引号计数为奇数；${S5_NOTE}）` })
    const spans = []
    for (const m of ln.matchAll(/`[^`\n]*`/g)) spans.push([m.index, m.index + m[0].length])
    const inSpan = (a, b) => spans.some(([s, e]) => a >= s && b <= e)
    for (const m of ln.matchAll(S5_CAND_RE)) {
      const whole = m[0], prefix = m[1]
      const a = m.index, b = m.index + whole.length
      if (whole.endsWith('「」')) { findings.push({ check: 'S5', line: i + 1, message: `引用 span 片段为空（${S5_NOTE}）` }); continue }
      if ((prefix === '' || S5_PATH_LIKE(prefix)) && !inSpan(a, b)) findings.push({ check: 'S5', line: i + 1, message: `引用候选未完整落在 inline span 内（${S5_NOTE}）` })
    }
  }
  return { findings, placeholderLines: ph, type: rawTypeHeads.length === 1 ? typeOfHeading(rawTypeHeads[0].title) : null, sevenTotal: SEVEN.length }
}

/** 机读 F/E 条目形态探测（占位内容不得形成机读条目）。 */
export function machineFERows(text) {
  const out = []
  for (const ln of String(text ?? '').split('\n')) {
    const s = ln.trim()
    if (/^F-\d{2}\s*｜/.test(s) || /^(?:-\s+)?E-?\d+\s*｜/.test(s)) out.push(s)
  }
  return out
}

// ── 自检（夹具落 os.tmpdir()） ──
function selfTest() {
  const cases = []
  const add = (name, ok, detail = '') => cases.push({ name, ok: !!ok, detail })
  const tmp = mkdtempSync(join(tmpdir(), 'w5b-t1-scaffold-selftest-')) // N-5：临时目录前缀对齐 assumption 7
  const cli = (args) => spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8' })
  try {
    // 确定性：同型两次生成逐字节一致
    const a = generateTaskbook('impl'), b = generateTaskbook('impl')
    add('确定性：impl 两次生成逐字节一致', a === b && a.length > 0, `len=${a.length}/${b.length}`)
    // 五型齐备：各含恰一件型件、五辅助段、待填位、无机读 F/E 行
    let fiveOk = true, feOk = true, auxDetail = ''
    for (const t of TYPES) {
      const doc = generateTaskbook(t)
      const heads = doc.split('\n').filter((l) => /^#\s*任务书型件：/.test(l))
      if (heads.length !== 1 || typeOfHeading(heads[0]) !== t) { fiveOk = false; auxDetail = `${t} 型件=${heads.length}` }
      if (machineFERows(doc).length !== 0) { feOk = false; auxDetail = `${t} 机读 F/E 行=${machineFERows(doc).length}` }
    }
    add('五型生成：各恰一件合法型件', fiveOk, auxDetail)
    add('占位边界：五型生成物机读 F/E 条目均为 0', feOk, auxDetail)
    const implDoc = a
    add('五辅助段与待填位可见', ['assumptions', '源文引用区', '白名单', 'D/V', 'F/E'].every((k) => implDoc.includes(k)) && implDoc.includes('{{'), '')
    // lint-only 正例：对生成物 0 findings
    const zPos = lintOnly(implDoc)
    add('lint-only 正例：生成物 0 findings 且识别型件', zPos.findings.length === 0 && zPos.type === 'impl' && zPos.placeholderLines > 0, JSON.stringify(zPos.findings))
    // 变异 1：删任一七段标题 → 检出
    const mutated = implDoc.split('\n').filter((l) => !/^## 3\. 预裁决/.test(l)).join('\n')
    add('lint-only 变异 1：删七段标题判检出', lintOnly(mutated).findings.some((f) => f.check === 'S1' && f.message.includes('预裁决')), JSON.stringify(lintOnly(mutated).findings))
    // 变异 2：去尽待填位 → 检出
    add('lint-only 变异 2：去尽待填位判检出', lintOnly(implDoc.replace(/\{\{[^}]*\}\}/g, 'X')).findings.some((f) => f.check === 'S4'), JSON.stringify(lintOnly(implDoc.replace(/\{\{[^}]*\}\}/g, 'X')).findings))
    // 变异 3：第二件型件 → 唯一型件检出
    const dup = implDoc + '\n# 任务书型件：数据型（data）\n'
    add('lint-only 变异 3：双型件判检出', lintOnly(dup).findings.some((f) => f.check === 'S2'), JSON.stringify(lintOnly(dup).findings))
    // CLI 生成：成功 0／已存在 1／未知型 1／用法错 1／输出不可用 3
    const out1 = join(tmp, 'gen-impl.md')
    const rGen = cli(['--type', 'impl', '--out', out1])
    add('CLI 生成：exit 0 且落盘与库函数逐字节一致', rGen.status === 0 && readFileSync(out1, 'utf8') === implDoc, `status=${rGen.status}`)
    const rDup = cli(['--type', 'impl', '--out', out1])
    add('CLI 重复 --out：拒绝覆盖 exit 1 且原文件未改动', rDup.status === 1 && readFileSync(out1, 'utf8') === implDoc, `status=${rDup.status}`)
    const rUnknown = cli(['--type', 'no-such', '--out', join(tmp, 'x.md')])
    add('CLI 未知型：exit 1', rUnknown.status === 1, `status=${rUnknown.status}`)
    const rUsage = cli([])
    add('CLI 用法错：无参数 exit 1', rUsage.status === 1, `status=${rUsage.status}`)
    const rBadOut = cli(['--type', 'data', '--out', join(tmp, 'no-such-dir', 'x.md')])
    add('CLI 输出不可用：目录不存在 exit 3', rBadOut.status === 3, `status=${rBadOut.status}`)
    // 装载错：模板目录缺失（库函数抛装载错）
    let loadThrew = false
    try { loadTemplates(join(tmp, 'no-such-templates')) } catch (e) { loadThrew = e instanceof ScaffoldLoadError }
    add('装载错：模板目录缺失抛 ScaffoldLoadError（主入口映射 exit 3）', loadThrew, '')
    // CLI lint-only：生成物 exit 0；变异件 exit 1；目标缺失 exit 3；不产生 evidence 类新文件
    const rLint = cli(['--lint-only', out1])
    add('CLI lint-only：生成物 exit 0', rLint.status === 0, `status=${rLint.status} out=${rLint.stdout.slice(0, 120)}`)
    const mutPath = join(tmp, 'mutated.md')
    writeFileSync(mutPath, mutated, 'utf8')
    const rMut = cli(['--lint-only', mutPath])
    add('CLI lint-only：七段缺一 exit 1', rMut.status === 1, `status=${rMut.status}`)
    const rMissing = cli(['--lint-only', join(tmp, 'no-such.md')])
    add('CLI lint-only：目标缺失 exit 3', rMissing.status === 3, `status=${rMissing.status}`)
    const before = readdirSync(tmp).sort().join(',')
    cli(['--lint-only', out1])
    const after = readdirSync(tmp).sort().join(',')
    add('lint-only 无副作用：运行前后目录内容不变（不生成 evidence、不调 record）', before === after, `${before} → ${after}`)
    // 双审修入：W-14/W-5 --templates 覆盖旗标（真 CLI 实跑）；N-11 argv 严格化；N-4 五型逐一 lintOnly；N-7 占位计数逐型
    const tplCopy = join(tmp, 'tpl-copy')
    mkdirSync(join(tplCopy, 'taskbook'), { recursive: true })
    copyFileSync(join(SKILL_ROOT, 'templates', 'task-brief-template.md'), join(tplCopy, 'task-brief-template.md'))
    for (const t of TYPES) copyFileSync(join(SKILL_ROOT, 'templates', 'taskbook', `${t}.md`), join(tplCopy, 'taskbook', `${t}.md`))
    const outTpl = join(tmp, 'gen-tpl.md')
    const rTpl = cli(['--type', 'close', '--out', outTpl, '--templates', tplCopy])
    add('W-14 CLI --templates 有效副本：exit 0 且生成与缺省模板逐字节一致', rTpl.status === 0 && readFileSync(outTpl, 'utf8') === generateTaskbook('close'), `status=${rTpl.status}`)
    const rTplBad = cli(['--type', 'impl', '--out', join(tmp, 'gen-tpl-bad.md'), '--templates', join(tmp, 'no-such-tpl')])
    add('W-14 CLI --templates 无效目录：真 CLI 实跑 exit 3（[装载错]）', rTplBad.status === 3 && String(rTplBad.stderr || '').includes('装载错'), `status=${rTplBad.status} err=${String(rTplBad.stderr || '').slice(0, 120)}`)
    const rStExtra = cli(['--self-test', 'extra'])
    const rStFlag = cli(['--self-test', '--json'])
    add('N-11 CLI argv 严格化：--self-test 携带多余/未知参数判用法错 exit 1', rStExtra.status === 1 && rStFlag.status === 1, `extra=${rStExtra.status} flag=${rStFlag.status}`)
    // W-17 D-2d 修入向量（恰 2 条·23→25）：--templates 缺值/跨旗标/lint-only 同现统一 usage 1
    add('W-17 D-2d --templates 缺值：居末缺值与下一 token 为旗标（跨旗标）均 usage exit 1（不静默回退默认模板、不再 exit 1/3 不一致）', cli(['--type', 'impl', '--out', join(tmp, 'gen-tpl-end.md'), '--templates']).status === 1 && cli(['--type', 'impl', '--templates', '--out', join(tmp, 'gen-tpl-flag.md')]).status === 1 && !existsSync(join(tmp, 'gen-tpl-end.md')) && !existsSync(join(tmp, 'gen-tpl-flag.md')), '')
    add('W-17 D-2d --templates 与 lint-only 同现：不再被静默忽略（含裸缺值形态），均 usage exit 1', cli(['--lint-only', out1, '--templates', tplCopy]).status === 1 && cli(['--lint-only', out1, '--templates']).status === 1, '')
    let lint5 = true; const lint5Detail = {}
    for (const t of TYPES) {
      const z = lintOnly(generateTaskbook(t))
      lint5Detail[t] = z.findings.length
      const auxOk = ['assumptions', '源文引用区', '白名单', 'D/V', 'F/E'].every((k) => generateTaskbook(t).includes(k))
      if (z.findings.length !== 0 || !auxOk) lint5 = false
    }
    add('N-4 五型逐一 lintOnly＋五辅助段断言：各型 0 findings 且辅助段齐备', lint5, JSON.stringify(lint5Detail))
    const phByType = {}
    for (const t of TYPES) phByType[t] = generateTaskbook(t).split('\n').filter((l) => l.includes('{{')).length
    add('N-7 占位计数逐型记录（口径=含 {{ 的物理行数）：impl 与其余四型分开且全部 >0',
      phByType.impl > 0 && TYPES.slice(1).every((t) => phByType[t] > 0),
      JSON.stringify({ impl: phByType.impl, others: { docsInst: phByType['docs-inst'], data: phByType.data, routeDesign: phByType['route-design'], close: phByType.close } }))
    // ── W5b D-6 S5 锚片段规约代码化（恰 2 向量·25→27）──
    add('W5b D-6 S5 检查：未闭合 span／引用候选外露／空片段夹具各给 S5 finding 且文案含「锚片段禁含内层反引号；整行含反引号时改取净子段」', (() => {
      const bad = ['普通行', '未闭合 `a 与 `b` 尾', '见 docs/note.md:2「x」外露无 span', '空片段 `docs/note.md:2「」` 尾'].join('\n')
      const fs5 = lintOnly(bad).findings.filter((f) => f.check === 'S5')
      return fs5.length >= 3 && fs5.every((f) => f.message.includes('锚片段禁含内层反引号；整行含反引号时改取净子段'))
    })(), JSON.stringify(lintOnly(['未闭合 `a 与 `b` 尾', '见 docs/note.md:2「x」外露无 span', '空片段 `docs/note.md:2「」` 尾'].join('\n')).findings))
    add('W5b D-6 S5 不误伤：合法生成物与 --templates 有效副本生成物均 0 条 S5 finding', (() => {
      const d1 = lintOnly(generateTaskbook('impl')).findings.filter((f) => f.check === 'S5')
      const d2 = lintOnly(generateTaskbook('close', tplCopy)).findings.filter((f) => f.check === 'S5')
      return d1.length === 0 && d2.length === 0
    })(), JSON.stringify({ impl: lintOnly(generateTaskbook('impl')).findings.filter((f) => f.check === 'S5').length, close: lintOnly(generateTaskbook('close', tplCopy)).findings.filter((f) => f.check === 'S5').length }))
    add('W5b D-6 S5 围栏跳过（r5·ds-W-2）：围栏代码块内奇数反引号不产生 S5 finding，围栏外同类形态仍检出', (() => {
      const inner = '```text\n未闭合 `a 与 `b` 在围栏内\n```\n'
      const fencedOnly = lintOnly('普通行\n' + inner + '收尾行\n').findings.filter((f) => f.check === 'S5')
      const outside = lintOnly('普通行\n' + inner + '未闭合 `x 与 `y` 围栏外\n').findings.filter((f) => f.check === 'S5')
      return fencedOnly.length === 0 && outside.some((f) => f.check === 'S5')
    })(), JSON.stringify({ fenced: lintOnly('普通行\n```text\n未闭合 `a 与 `b` 在围栏内\n```\n收尾行\n').findings.filter((f) => f.check === 'S5'), outside: lintOnly('未闭合 `x 与 `y` 围栏外\n').findings.filter((f) => f.check === 'S5') }))
    // ── W5c D-5 增补（S5 围栏标记配对·恰 1 向量·28→29）──
    add('W5c D-5 S5 围栏标记配对：``` 内出现 ~~~ 不闭合当前围栏（异 marker 仅作块内行·继续跳过），块内奇数反引号不报 S5，真正同 marker 关闭后围栏外异常仍报；~~~ 同款配对', (() => {
      const mk = (open, other, close) => `普通行\n${open}\n${other}\n未闭合 \`a 在块内\n${close}\n未闭合 \`x 围栏外\n`
      const a = lintOnly(mk('```', '~~~', '```')).findings.filter((f) => f.check === 'S5')
      const b = lintOnly(mk('~~~', '```', '~~~')).findings.filter((f) => f.check === 'S5')
      return a.length === 1 && a[0].line === 6 && b.length === 1 && b[0].line === 6
    })(), JSON.stringify({ backtickOpen: lintOnly('普通行\n```\n~~~\n未闭合 `a 在块内\n```\n未闭合 `x 围栏外\n').findings.filter((f) => f.check === 'S5'), tildeOpen: lintOnly('普通行\n~~~\n```\n未闭合 `a 在块内\n~~~\n未闭合 `x 围栏外\n').findings.filter((f) => f.check === 'S5') }))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  const pass = cases.filter((c) => c.ok).length
  return { cases, pass, fail: cases.length - pass }
}

// ── 主入口 ──
function usage() {
  console.error('用法：node scripts/taskbook-scaffold.mjs --type <impl|docs-inst|data|route-design|close> --out <path> [--templates <dir>]')
  console.error('      node scripts/taskbook-scaffold.mjs --lint-only <任务书.md>')
  console.error('      node scripts/taskbook-scaffold.mjs --self-test')
}

function main() {
  const argv = process.argv.slice(2)
  // N-11：先解析后分支——未知/多余参数一律用法错；--self-test 须为唯一参数
  let type = null, out = null, lintTarget = null, templatesDir = null, selfTestFlag = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--self-test') selfTestFlag = true
    else if (a === '--type') { type = argv[++i] ?? null }
    else if (a === '--out') { out = argv[++i] ?? null }
    else if (a === '--lint-only') { lintTarget = argv[++i] ?? null }
    else if (a === '--templates') { const v = argv[++i] ?? null; if (v === null || v.startsWith('--')) { usage(); process.exit(1) } templatesDir = v } // W-17 D-2d：缺值（居末）或下一 token 为旗标一律 usage 1——修复居末缺值静默回退默认模板目录与跨旗标缺值 exit 1/3 不一致
    else { usage(); process.exit(1) }
  }
  if (selfTestFlag) {
    if (argv.length !== 1) { usage(); process.exit(1) }
    const { cases, pass, fail } = selfTest()
    for (const c of cases) if (!c.ok) console.log(`[self-test] FAIL ${c.name}${c.detail ? `（${c.detail}）` : ''}`)
    if (fail === 0) console.log(`self-test 全过（${cases.length} 向量）`)
    else console.log(`[self-test] FAIL ×${fail}`)
    process.exit(fail === 0 ? 0 : 1)
  }
  if (lintTarget !== null) {
    if (type !== null || out !== null || templatesDir !== null) { usage(); process.exit(1) } // W-17 D-2d：--templates 与 lint-only 同现不再被静默忽略，统一 usage 1
    if (!lintTarget) { usage(); process.exit(1) }
    if (!existsSync(lintTarget)) { console.error(`[装载错] lint 目标不存在：${lintTarget}`); process.exit(3) }
    let text
    try { text = readFileSync(lintTarget, 'utf8') } catch (e) { console.error(`[装载错] lint 目标不可读：${lintTarget}（${e.message}）`); process.exit(3) }
    const { findings, placeholderLines, type: detectedType } = lintOnly(text)
    for (const f of findings) console.log(`[${f.check}] ${f.line ? `${lintTarget}:${f.line} ` : ''}${f.message}`)
    if (findings.length > 0) { console.log(`lint-only 汇总：检出 ×${findings.length}`); process.exit(1) }
    console.log(`lint-only 通过（七段 7/7；型件=${detectedType ?? '未知'}；辅助段 5/5；待填位=${placeholderLines} 处；不执行 F 命令、不生成 evidence）`)
    process.exit(0)
  }
  if (!type || !out) { usage(); process.exit(1) }
  if (!TYPES.includes(type)) { console.error(`[用法错] 未知型「${type}」（可用：${TYPES.join('／')}）`); process.exit(1) }
  if (existsSync(out)) { console.error(`[用法错] --out 已存在，拒绝覆盖：${out}`); process.exit(1) }
  let doc
  try { doc = generateTaskbook(type, templatesDir ?? undefined) } catch (e) {
    if (e instanceof ScaffoldLoadError) { console.error(`[装载错] ${e.message}`); process.exit(3) }
    throw e
  }
  try {
    const dir = dirname(resolve(out))
    if (!existsSync(dir) || !statSync(dir).isDirectory()) { console.error(`[装载错] 输出目录不可用：${dir}`); process.exit(3) }
    writeFileSync(out, doc, 'utf8')
  } catch (e) { console.error(`[装载错] 输出不可写：${out}（${e.message}）`); process.exit(3) }
  console.log(`已生成：${out}（type=${type}；公共骨架＋恰一件型件＋五辅助待填位；确定性生成，无机读 F/E 条目）`)
  process.exit(0)
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main()
