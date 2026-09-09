/**
 * 技能垃圾回收（ai-dev-org 工具件）v1.1——清理无效技能与退役重定向页。
 * 分类口径（回炉轮 2 修订——Kimi/DS 双源审）：
 *   redirect = description 含退役/重定向标记 且 正文字节数 <2000B（字节口径）
 *   suspect  = description 含上述标记 但正文较大（疑似而非确证——仅报告，禁入自动删除集）
 *   invalid  = 缺 frontmatter 或缺 name 字段（硬事实）；description 解析存在
 *              多行/块形态歧义时判 unknown（仅报告）——「无法可靠解析的
 *              frontmatter 只报告、不进可自动删除集合」（ds-B2 终裁）
 *   orphan   = 技能根下无 SKILL.md 的目录（仅报告）
 *   active   = 正常技能
 * 安全设计：默认干跑；--apply 须与 --delete-redirects/--delete-invalid 同用；
 * 清单先写后移（manifest 写失败=中止不移动——归档事务完整性）；同日多次
 * 运行清单合并；删除=移入 _archive/skill-gc-<date>/ 可整目录移回回滚；
 * 插件缓存目录不扫描不动（插件技能若经他机制驻留技能根，统计口径不完整
 * ——见输出告警行）。「未使用」无法机检（无使用遥测），active/suspect 去
 * 留=用户裁决，本件不删。
 * 用法：
 *   node skill-gc.mjs [--root <dir>] [--json]                    # 盘点+可回收估算（干跑）
 *   node skill-gc.mjs --apply --delete-redirects [--delete-invalid]  # 归档+清理
 * 退出码：0=正常；1=参数误用或归档事务失败；2=--apply 未指定删除类。
 */
import { readdirSync, readFileSync, statSync, renameSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null)
const ROOT = flag('--root') || join(homedir(), '.zcode', 'skills')
const APPLY = argv.includes('--apply')
const DEL_REDIRECTS = argv.includes('--delete-redirects')
const DEL_INVALID = argv.includes('--delete-invalid')
const JSON_OUT = argv.includes('--json')
const RETIRED_DESC_RE = /已退役|已废弃|\bretired\b/i // 语义词 redirect/重定向 不入判据（K-W2：HTTP redirect 类 active 技能误伤面）
const BODY_LIMIT_BYTES = 2000

if (APPLY && !DEL_REDIRECTS && !DEL_INVALID) {
  console.error('--apply 须与 --delete-redirects 和/或 --delete-invalid 同用（防误删）')
  process.exit(2)
}

function classify(dir) {
  const skillPath = join(ROOT, dir, 'SKILL.md')
  if (!existsSync(skillPath)) return { dir, cls: 'orphan', name: dir, descB: 0, bodyB: 0, note: '无 SKILL.md' }
  const raw = readFileSync(skillPath, 'utf8').replace(/^\uFEFF/, '')
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const body = raw.slice(fm ? fm[0].length : 0)
  const bodyB = Buffer.byteLength(body, 'utf8') // 正文口径（K-W3：不含 frontmatter）
  if (!fm) return { dir, cls: 'invalid', name: dir, descB: 0, bodyB, note: '缺 frontmatter' }
  const name = (fm[1].match(/^name:\s*(.+?)\s*$/m) || [])[1]
  if (!name) return { dir, cls: 'invalid', name: dir, descB: 0, bodyB, note: '缺 name 字段' }
  const statusRetired = /^status:\s*(retired|已退役)\s*$/im.test(fm[1])
  const descLine = (fm[1].match(/^description:\s*(.*?)\s*$/m) || [])[1] ?? ''
  // 支持子集（K-W3）：单行 description；块形态（|/> 及其 +-数字修饰、序列 -）→ unknown 仅报告
  const descMulti = /^description:\s*(?:[|>][-+0-9]*|-)?\s*$/m.test(fm[1])
  if (descMulti)
    return { dir, cls: 'unknown', name, descB: 0, bodyB, note: 'description 为多行/块形态（跳过 desc 计量，仅报告——不入自动删除集）' }
  if (statusRetired || RETIRED_DESC_RE.test(descLine)) {
    if (bodyB < BODY_LIMIT_BYTES) return { dir, cls: 'redirect', name, descB: Buffer.byteLength(descLine, 'utf8'), bodyB, note: statusRetired ? '退役重定向页（status 字段判据）' : '退役重定向页（description 判据+字节阈内）' }
    return { dir, cls: 'suspect', name, descB: Buffer.byteLength(descLine, 'utf8'), bodyB, note: '退役语义但正文超阈（疑似——仅报告，人审定夺）' }
  }
  return { dir, cls: 'active', name, descB: Buffer.byteLength(descLine, 'utf8'), bodyB, note: '' }
}

const entries = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== '_archive')
  .map((e) => classify(e.name))
  .sort((a, b) => a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name))

const by = (c) => entries.filter((e) => e.cls === c)
const sumDesc = (list) => list.reduce((s, e) => s + e.descB, 0)
const reclaimDesc = sumDesc(by('redirect')) + sumDesc(by('invalid'))
const totalDesc = sumDesc(entries)

if (JSON_OUT) {
  console.log(JSON.stringify({ root: ROOT, scope_warning: '统计不含插件系统管理目录；插件技能若经他机制驻留技能根则口径不完整', total: entries.length, active: by('active').length, redirect: by('redirect').length, suspect: by('suspect').length, invalid: by('invalid').length, unknown: by('unknown').length, orphan: by('orphan').length, always_on_desc_bytes: totalDesc, reclaimable_desc_bytes: reclaimDesc, entries }, null, 2))
} else {
  console.log(`技能根：${ROOT}（统计不含插件系统管理目录——插件技能若经他机制驻留技能根则此口径不完整）`)
  for (const e of [...by('redirect'), ...by('suspect'), ...by('invalid'), ...by('unknown'), ...by('orphan')])
    console.log(`  [${e.cls}] ${e.name} — ${e.note}（desc ${e.descB}B/body ${e.bodyB}B）`)
  console.log(
    `\n合计 ${entries.length} 技能：active ${by('active').length} / redirect ${by('redirect').length} / suspect ${by('suspect').length} / invalid ${by('invalid').length} / unknown ${by('unknown').length} / orphan ${by('orphan').length}`,
  )
  console.log(`常驻 description 总量=${totalDesc}B；本次可回收=${reclaimDesc}B（仅 redirect+invalid；suspect/unknown 恒不自动删）`)
  if (!APPLY) console.log('（干跑——加 --apply --delete-redirects/--delete-invalid 才实际归档清理）')
}

if (APPLY) {
  const targets = entries.filter((e) => (DEL_REDIRECTS && e.cls === 'redirect') || (DEL_INVALID && e.cls === 'invalid'))
  if (!targets.length) {
    console.log('无可清理目标。')
    process.exit(0)
  }
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const arcDir = join(ROOT, '_archive', `skill-gc-${ts}`)
  mkdirSync(arcDir, { recursive: true })
  // 归档事务（K-W4）：intended/moved/failed 三态+临时文件原子替换；重写失败=非零退出
  const manifestPath = join(arcDir, 'GC-MANIFEST.json')
  let prev = []
  try {
    prev = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')).deleted || []
  } catch {}
  const intended = targets.map((t) => ({ dir: t.dir, cls: t.cls, note: t.note }))
  const writeManifestAtomic = (record) => {
    const tmp = manifestPath + '.tmp'
    writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8')
    renameSync(tmp, manifestPath)
  }
  try {
    writeManifestAtomic({ date: new Date().toISOString(), deleted: [...prev, ...intended.map((t) => ({ ...t, state: 'intended' }))] })
  } catch (e) {
    console.error(`[gc-abort] 归档清单写入失败（未移动任何目录，零副作用退出）: ${e.message}`)
    process.exit(1)
  }
  const moved = []
  const failed = []
  for (const t of targets) {
    try {
      renameSync(join(ROOT, t.dir), join(arcDir, t.dir))
      moved.push(t.dir)
      console.log(`已归档清理：${t.dir}（${t.cls}）→ ${arcDir}`)
    } catch (e) {
      failed.push(t.dir)
      console.error(`[gc-warn] 归档移动失败 ${t.dir}: ${e.message}（跳过，其余继续）`)
    }
  }
  try {
    writeManifestAtomic({
      date: new Date().toISOString(),
      deleted: [
        ...prev,
        ...intended.map((t) => ({ ...t, state: moved.includes(t.dir) ? 'moved' : 'failed' })),
      ],
    })
  } catch (e) {
    console.error(`[gc-error] 终态清单重写失败（已移动 ${moved.length} 件——按上方日志人工核对回滚）: ${e.message}`)
    process.exit(1)
  }
  console.log(`常驻面回收 ${reclaimDesc}B description；归档清单=${manifestPath}（可整目录移回回滚）`)
}
