// evolve 批账本补记器（主控单写纪律；一次性收口工具，随批档留存）
// 用法：node scripts/audits/evolve-ledger-append.mjs （读同目录 evolve-ledger-rows.json，追加至 .zcode/org-ledger.jsonl）
import { readFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const rows = JSON.parse(readFileSync(join(here, 'evolve-ledger-rows.json'), 'utf8'))
const order = ['ts','schema_version','runId','project','event','role','tier','source','cfg_hash','usage','truncated','outcome']
const now = new Date().toISOString()
const lines = rows.map(r => {
  const o = { ts: now, schema_version: 2 }
  for (const k of order.slice(2)) o[k] = r[k]
  if (!o.cfg_hash) o.cfg_hash = 'a26f710a540d'
  const fixed = {}
  for (const k of order) fixed[k] = o[k]
  return JSON.stringify(fixed)
})
appendFileSync(join(root, '.zcode', 'org-ledger.jsonl'), lines.join('\n') + '\n')
console.log(`appended ${rows.length} rows at ${now}`)
