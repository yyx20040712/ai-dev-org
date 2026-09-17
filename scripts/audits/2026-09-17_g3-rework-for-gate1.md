# g3 批门一回炉复审包（r1——净增量面，禁访仓库）

## 0. 复审指令

你是门一（ops-gate1-k1）对 g3 批回炉轮 1 的定点复审。首轮结论=PASS B=0/W=3/N=6（你方出件，处置清单见 §1）。复审范围=回炉净增量：**仅 deploy-check.mjs 的改动+实现报告勘误**（其余六件自首轮后零改动——git diff --stat 总量比对见 §4，主控核对）。任务：①逐项核对 W1/W2/W3/N4/N5 是否 ADDRESSED；②对改动面做新破坏扫描（新守卫/后移是否引入新缺陷——特别注意实现者 R2 自裁：主 cfg 守卫后移至 install 块后，评估其副作用面）；③产出 [B|W|N]+file:line 与尾栏。

## 1. 首轮处置清单（主控裁定）

- R1=W2 批内修；R2=W3 批内修；R3=W1+N4 报告勘误；R4=N5 补两向量；N1/N2/N3/N6 维持登记（不修）。
- 回炉后主控亲验：全量自检真退出码全 0（regression 8/8/anchors 12 件 0/0/hardcode 0/health-scan RED 0/cfg 不变）；R2 真机注入实测=临时坏覆盖件下 --install 走干净跳过行（真因+DEPLOY §3 指引）、两路径终态均 exit 3、注入件已还原。

## 2. 实现报告回炉轮 1 节全文（处置+红证+自裁申报）

## 回炉轮 1（2026-09-17，门一 PASS B=0/W=3/N=6——出件
scripts/audits/2026-09-17_g3-gate1-out.md，逐项对原文处置）

### 处置清单（批内修 4 项 ADDRESSED）

**R1=W2 ADDRESSED**——--install 动作③错误处置重构：installHostFacts 写盘段
（mkdir/write/readJson 回读）自包 try/catch，IO/回读抛错返回 `{level:'FAIL',
line:「install-hostfacts——覆盖件写盘/回读失败（<overPath>：<真因 e.message>）
——…（真因如上，非装载失败）」}`；调用方三源分行归因（org-config 装载失败
→warn 跳过+指引／宿主配置装载失败→warn 跳过+指引=现语义维持／installHostFacts
返回值→FAIL 计数）；FAIL 行以 `[FAIL]` 前缀打印、计入
`exitCodeFrom({failCount: sum.fail + installFailCount})`，汇总行加
`——另含 install 动作 FAIL ×N（计入阻断）` 注记。头注同步（错误处置两行）。

红证（向量先行，对现状=红）——写盘 IO 注入（父级为文件的路径→mkdir/write 必抛）：

```
$ node scripts/deploy-check.mjs --self-test；echo st_exit=$?
FAIL g3 install：写盘 IO 抛错→FAIL 结果带真因（不裸抛/不误归因装载失败）
self-test 1 项失败            st_exit=1
```

变异红证（W2 形态=临时还原旧笼统 catch，坏覆盖件注入 .zcode/org-config.json）：

```
[install] install-hostfacts——跳过：宿主配置装载失败（JSON 解析失败 C:\…\.zcode\org-config.json: …）
```
——org-config 的 JSON 错被误标「宿主配置装载失败」=门一 W2 指认的真因掩盖
形态实录；还原新结构后同注入输出正确归因行（见 R2 绿证）。

**R2=W3 ADDRESSED**——loadOrgConfig 入守卫+主 cfg 守卫后移。红证实测修正了
门一前提：坏覆盖件并不裸崩到 install 块的 oc 装载——更早的主 cfg 守卫先行
`[装载错] … exit 3`（install 三动作整场被跳过，「干净跳过行」不可达）：

```
$ node scripts/deploy-check.mjs --install；echo exit=$?
[装载错] org-config 装载失败：JSON 解析失败 C:\…\.zcode\org-config.json: …
exit=3      （三行 install 动作均未执行）
```

处置=install 块内 oc 装载包独立 try/catch（分行归因见 R1）+主 cfg 守卫
（runChecks 消费位）后移至 install 块之后——坏覆盖件时 install 三动作先执行、
③ 打印干净跳过行，再到守卫按装载错退 3（检查主体无 cfg 确不可跑，口径
06 §5.8 行 3，非静默）。绿证（同注入）：

```
[install] install-hostfacts——跳过：org-config 装载失败（JSON 解析失败 C:\…\.zcode\org-config.json: …）——处置=修复或移除 .zcode/org-config.json（用户域件）/核对默认件后复跑；手工路径=DEPLOY §3
[装载错] org-config 装载失败：JSON 解析失败 …    exit=3（无堆栈；注入件已即删）
```

**R3=W1+N4 ADDRESSED（勘误，不静默改写）**——
- 勘误一（⑦#8 与②节两处「59 条」）：应为 **60 条**（分组 9/10/10/10/7/9/5
  自加=60，与 00-glossary.md 交付物逐行一致——门一 W1 证伪成立）。P7 的
  45~60 带仍满足；属报告计数错误，原文按历史件纪律保留不动，以本勘误为准。
- 勘误二（⑦#9 行账）：ds-call-v2 除删本地 flag 副本（函数体 4 行）外，另删
  4 行 const 取值行（roleId/onlyAlias/projectName/mockSpec），由 let+try/catch
  块等价承接——门一 N4 指认的行账不严属实，「等价承接」语义不变。

**R4=N5 ADDRESSED**——补两条 install 向量（钉单分支）：仅 unmatched（无
ambiguous）→不写+指引（行含 none/歧义槽=无）；仅 ambiguous（无 unmatched）
→不写+指引（行含 ambi/零命中槽=无）。两向量对现状即绿（行为本正，属补钉
非修错——门一 N5 判「风险低」一致）。

### 不修维持 4 项（按门一/主控裁示，收口登记）

- N1 维持：log-triage 首 catch 无 instanceof 过滤——形态不一但无功能差（cliFlag
  现仅抛 UsageError），下轮卫生面。
- N2 维持：向量 constructor.name 判型——红态防崩自裁成立（⑦#5），绿态等价。
- N3 维持：deploy-check 自检 g3Differ 半红态 TypeError 不触发（两函数同批落地）。
- N6 维持：流水 +45/+30 行均为包外事实，已如实呈报（本轮复跑 regression R5
  mock 演练再 +30：1551→1596→1626，gitignore 机局部非提交面）。

### 回炉改动面与红绿态

改动仅 `scripts/deploy-check.mjs` 一件（+R1 内部 try/catch、调用方分行归因、
FAIL 计数、cfg 守卫后移、头注两行、自检向量 +3：26→29）与本报告追加节。
红态两处（R1 向量红/W2 变异红+R2 集成红）、绿态全量如下（真退出码实录）：

```
$ node scripts/org-config.mjs --self-test   → self-test 全过（17 向量）        exit=0
$ node scripts/deploy-check.mjs --self-test → self-test 全过（29 向量）        exit=0
$ node scripts/org-config.mjs hash          → cfg:20254429f008                exit=0
$ node scripts/regression.mjs               → 汇总：8/8 过，SKIP ×1            exit=0
$ node scripts/check-anchors.mjs            → WARN ×0 / FAIL ×0（扫描面=12 件） exit=0
$ node scripts/check-hardcode.mjs           → 命中 0 处（白名单豁免 36/14 条）  exit=0
$ node scripts/health-scan.mjs              → RED ×0 / WARN ×2 ——可收口        exit=0
$ node scripts/deploy-check.mjs --install   → ③「无需覆盖件」不写盘；汇总 ok 11/warn 0/FAIL 1（node-major 受禁系既有如实告警）exit=1；.zcode/org-config.json 不存在
```

### 新破坏扫描自查

- 调用方唯一消费点核毕：installFailCount 声明于 install 块前、消费于汇总后，
  非 --install 路径恒 0（汇总行/退出码与 g3 交付态逐字一致）。
- cfg 守卫后移的次序效应：非 install 路径行为不变（守卫与 runChecks 相邻）。
  实测两路径（坏覆盖件注入 `.zcode/org-config.json` 后即删）：
  ```
  $ node scripts/deploy-check.mjs（无 --install）；echo exit=$?
  [装载错] org-config 装载失败：JSON 解析失败 C:\…\.zcode\org-config.json: …
  exit=3          ← 与 g3 交付态一致（守卫后移未改非 install 路径终态）
  $ node scripts/deploy-check.mjs --agents-dir；echo exit=$?
  [用法错] flag --agents-dir 居末位无值（…）
  exit=1          ← flag 用法错先于装载错（守卫在 agentsDir 解析后=用法优先）
  ```
- 全量自检 7 项全绿（上节）；R2/R8/R9/R10 交叉面未触（regression 8/8 实证）。
- 白名单复核：git status=同 g3 交付 7 改件+00 件+本报告；新增未跟踪 2 件
  （g3-for-gate1.md/g3-gate1-out.md）=主控/门一产出，非本执行者写入。

MODEL-SELF: ops-executor bound
LEDGER-CLAIM: EXECUTOR=model-field:ops-executor

## 3. deploy-check.mjs 当前完整 diff（相对基线 cd2d751——含首轮已审部分，复审聚焦回炉增量：错误处置重构/守卫后移/+3 向量）

```diff
diff --git a/scripts/deploy-check.mjs b/scripts/deploy-check.mjs
index 7ca5f5f..aea195e 100644
--- a/scripts/deploy-check.mjs
+++ b/scripts/deploy-check.mjs
@@ -18,9 +18,15 @@
  *   ⑥ remote       git remote 非空=ok；空=[warn]（备份面）；非 git 仓=[warn]
  *   ⑦ ledger-dir   SKILL_ROOT/.zcode/ 试写临时文件后删 → ok/FAIL
  * 汇总行：deploy-check 汇总：ok X/warn Y/FAIL Z——<可部署/处置后复跑/阻断>
- * --install 仅两动作：④缺失清单逐件复制 templates→agents-dir+sha256 复核；
- *   ⑤hooksPath 未设时 git config core.hooksPath .githooks。绝不改
- *   org-config/宿主配置/已存在漂移件；完成后自动复跑七项按同口径退出。
+ * --install 三动作：④缺失清单逐件复制 templates→agents-dir+sha256 复核；
+ *   ⑤hooksPath 未设时 git config core.hooksPath .githooks；③宿主事实派生
+ *   项目覆盖件 .zcode/org-config.json（g3 批 deploy-hostfacts-split 清偿
+ *   ——按 entry_name 唯一命中派生 uuid_prefix；已存在绝不覆盖/有零命中或
+ *   歧义不写+指引 DEPLOY §3/与默认件一致不写）。绝不改 org-config.default.json
+ *   /宿主配置/已存在漂移件；完成后自动复跑七项按同口径退出（写盘后 ③项
+ *   spawn org-config validate 自然复跑=派生落盘回读真退出码面）。
+ *   错误处置（回炉轮 1，门一 W2/W3）：③ 装载失败（org-config/宿主）分行
+ *   干净跳过（warn+指引）；写盘/回读抛错=[FAIL] 行带真因计入阻断（exit 1）。
  * 用法：node scripts/deploy-check.mjs [--install] [--self-test] [--agents-dir <dir>]
  * 可 import 纯函数零副作用（isMain guard 惯例；自检向量禁动真实状态）。
  */
@@ -30,7 +36,7 @@ import { homedir, tmpdir } from 'node:os'
 import { spawnSync } from 'node:child_process'
 import { createHash } from 'node:crypto'
 import { fileURLToPath } from 'node:url'
-import { SKILL_ROOT, loadOrgConfig, cliFlag } from './org-config.mjs'
+import { SKILL_ROOT, loadOrgConfig, cliFlag, UsageError, readHostConfig, readJson } from './org-config.mjs'
 
 const SCRIPTS = join(SKILL_ROOT, 'scripts')
 export const TEMPLATES_AGENTS = join(SKILL_ROOT, 'templates', 'agents')
@@ -206,6 +212,87 @@ export function installHook() {
     : `install-hook——设置失败（exit ${r.status}：${String(r.stderr || '').trim()}）——手跑 git config core.hooksPath .githooks`
 }
 
+// ── g3 批（deploy-hostfacts-split 残留清偿）：宿主事实派生项目覆盖件 ──
+// 授权形态=仅 --install 显式调用（P4）；供应商事实属用户配置域——派生只读
+// 宿主注册表、只写机局部 .zcode/org-config.json（gitignore 不入库），绝不改
+// org-config.default.json 与宿主 config（key/端点事实永不改、不入库）。
+
+/** 派生纯函数（P5）：对 defaultCfg.providers 每别名按 entry_name 在宿主
+ *  provider 注册表找命中（命中语义与 validateProviders 的 name 判据同源）——
+ *  唯一命中→{uuid_prefix: id 前 8 字符, entry_name}；零命中→unmatched；
+ *  ≥2 命中→ambiguous（歧义不猜，列入指引）。附带 hostUnconsumed（宿主有
+ *  而默认件未用的条目名=候选信息）。 */
+export function deriveHostFacts(defaultCfg, hostCfg) {
+  const hostEntries = Object.entries(hostCfg?.provider || {})
+  const providers = {}
+  const unmatched = []
+  const ambiguous = []
+  for (const [alias, def] of Object.entries(defaultCfg?.providers || {})) {
+    const name = def?.entry_name
+    const hits = name == null ? [] : hostEntries.filter(([id, p]) => p && p.name === name)
+    if (hits.length === 1) providers[alias] = { uuid_prefix: hits[0][0].slice(0, 8), entry_name: name }
+    else if (hits.length === 0) unmatched.push(alias)
+    else ambiguous.push(alias)
+  }
+  const usedNames = new Set(
+    Object.values(defaultCfg?.providers || {}).map((d) => (d && typeof d === 'object' ? d.entry_name : null)).filter((v) => v != null),
+  )
+  const hostUnconsumed = hostEntries
+    .filter(([, p]) => p && p.name && !usedNames.has(p.name))
+    .map(([id, p]) => `${p.name}(${id.slice(0, 8)})`)
+  return { providers, unmatched, ambiguous, hostUnconsumed }
+}
+
+/** 写盘判定纯函数（P4）：全命中（无 unmatched/ambiguous 由调用方先判）且派生
+ *  值与默认件完全一致→false（不写，防本机冗余件——cfg 哈希不变）；任一漂移
+ *  →true（须派生覆盖件）。 */
+export function hostFactsDiffer(derived, defaultCfg) {
+  return Object.entries(defaultCfg?.providers || {}).some(([alias, def]) => {
+    const d = derived?.providers?.[alias]
+    return !d || d.uuid_prefix !== def?.uuid_prefix || d.entry_name !== def?.entry_name
+  })
+}
+
+/** --install 动作三（P4/P5）：派生宿主事实写项目覆盖件。
+ *  已存在→绝不覆盖；有 unmatched/ambiguous→不写文件+明确指引行（指向 DEPLOY
+ *  §3 手工路径，歧义不猜）；全命中且与默认件完全一致→不写文件；否则写盘
+ *  （note 字段声明用户配置域+派生规则一句）并回读复核。写盘后 runChecks ③
+ *  （spawn org-config validate）自然复跑=落盘回读真退出码面。 */
+export function installHostFacts(defaultCfg, hostCfg, overPath) {
+  if (existsSync(overPath))
+    return { wrote: false, level: 'ok', line: `install-hostfacts——覆盖件已存在（${overPath}）——绝不覆盖（用户配置域；改写走 DEPLOY §3 手工路径）` }
+  const d = deriveHostFacts(defaultCfg, hostCfg)
+  if (d.unmatched.length || d.ambiguous.length)
+    return {
+      wrote: false,
+      level: 'warn',
+      line:
+        `install-hostfacts——不派生：无宿主命中 alias=${d.unmatched.join('、') || '无'} / 歧义（同 entry_name≥2）=${d.ambiguous.join('、') || '无'}` +
+        `${d.hostUnconsumed.length ? ` / 宿主未消费候选=${d.hostUnconsumed.join('、')}` : ''}` +
+        `——歧义不猜，手工路径=DEPLOY §3（按三元组对齐或手写 .zcode/org-config.json）`,
+    }
+  if (!hostFactsDiffer(d, defaultCfg))
+    return { wrote: false, level: 'ok', line: 'install-hostfacts——宿主事实与默认件一致——无需覆盖件（不写，防本机冗余件）' }
+  const payload = {
+    note: 'deploy-check --install 派生件——用户配置域，装后可自由改写；派生规则=按 entry_name 在宿主供应商注册表找唯一命中，uuid_prefix 取其 id 前 8 字符（DEPLOY §3）',
+    providers: d.providers,
+  }
+  // 回炉轮 1 R1（W2）：写盘段自包 try/catch——IO/回读抛错返回 FAIL 结果带
+  // 真因（计入 summarize fail→exit 1），不再由调用方笼统报「宿主配置装载失败」
+  // warn（真因掩盖+静默失败面——门一 W2）
+  try {
+    mkdirSync(dirname(overPath), { recursive: true })
+    writeFileSync(overPath, JSON.stringify(payload, null, 2) + '\n')
+    const back = readJson(overPath) // 落盘回读复核（写坏=FAIL 行，validate 复跑另有 ③ 兜底）
+    const ok = JSON.stringify(back.providers) === JSON.stringify(payload.providers)
+    return ok
+      ? { wrote: true, level: 'ok', line: `install-hostfacts——已派生覆盖件 ${overPath}（${Object.keys(d.providers).length} 源，逐别名唯一命中；回读一致）` }
+      : { wrote: true, level: 'FAIL', line: `install-hostfacts——覆盖件写盘回读不符（${overPath}）——重跑 --install 或人工核查磁盘/权限` }
+  } catch (e) {
+    return { wrote: false, level: 'FAIL', line: `install-hostfacts——覆盖件写盘/回读失败（${overPath}：${e.message}）——重跑 --install 或人工核查磁盘/权限/占用（真因如上，非装载失败）` }
+  }
+}
+
 // ── --self-test（纯函数为主，禁动真实状态；fixture 用临时目录）──
 function selfTest() {
   let fails = 0
@@ -248,6 +335,75 @@ function selfTest() {
   const s2 = summarize([{ level: 'ok' }, { level: 'ok' }, { level: 'warn' }])
   t('汇总行：warn 不阻断（→处置后复跑，exit 仍 0）', s2.verdict === '处置后复跑' && exitCodeFrom({ failCount: s2.fail }) === 0)
 
+  // 向量5：g3 批（deploy-hostfacts-split 清偿）宿主事实派生纯函数——红态=函数
+  // 未落→FAIL 不崩（typeof 守卫惯例，同本件向量2 风格）
+  const g3Def = typeof deriveHostFacts === 'function' ? deriveHostFacts : null
+  const g3Differ = typeof hostFactsDiffer === 'function' ? hostFactsDiffer : null
+  const fxDef = { providers: {
+    uniq: { uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' },
+    none: { uuid_prefix: 'bbbbbbbb', entry_name: 'E-B' },
+    ambi: { uuid_prefix: 'cccccccc', entry_name: 'E-Y1' },
+    same: { uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' },
+  } }
+  const fxHost = { provider: {
+    'aaaaaaaa-1111': { name: 'E-A' },
+    'yyyyyyyy-3333': { name: 'E-Y1' },
+    'yyyyyyyy-4444': { name: 'E-Y1' },
+    'zzzzzzzz-5555': { name: 'E-Z' },
+  } }
+  const dfx = g3Def ? deriveHostFacts(fxDef, fxHost) : null
+  t('g3 派生：唯一命中→{uuid_prefix:id 前 8 字符, entry_name}', !!dfx && JSON.stringify(dfx.providers.uniq) === JSON.stringify({ uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' }))
+  t('g3 派生：零命中→unmatched（不猜）', !!dfx && JSON.stringify(dfx.unmatched) === JSON.stringify(['none']))
+  t('g3 派生：同 entry_name≥2 命中→ambiguous（歧义不猜）', !!dfx && JSON.stringify(dfx.ambiguous) === JSON.stringify(['ambi']))
+  t('g3 派生：hostUnconsumed 归集（宿主有而默认件未用的条目名=候选信息）', !!dfx && JSON.stringify(dfx.hostUnconsumed) === JSON.stringify(['E-Z(zzzzzzzz)']))
+  const fxDef2 = { providers: { a: { uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' }, b: { uuid_prefix: 'zzzzzzzz', entry_name: 'E-Z' } } }
+  const fxHost2 = { provider: { 'aaaaaaaa-9999': { name: 'E-A' }, 'zzzzzzzz-8888': { name: 'E-Z' } } }
+  const d2 = g3Def ? deriveHostFacts(fxDef2, fxHost2) : null
+  t('g3 判定：全命中且值与默认件完全一致→hostFactsDiffer=false（不写盘）', !!d2 && !d2.unmatched.length && !d2.ambiguous.length && g3Differ(d2, fxDef2) === false)
+  const d3 = g3Def ? deriveHostFacts({ providers: { a: { uuid_prefix: 'deadbeef', entry_name: 'E-A' } } }, { provider: { 'aaaaaaaa-1111': { name: 'E-A' } } }) : null
+  t('g3 判定：uuid 前缀漂移→hostFactsDiffer=true（须派生覆盖件）', !!d3 && g3Differ(d3, { providers: { a: { uuid_prefix: 'deadbeef', entry_name: 'E-A' } } }) === true)
+
+  // 向量6：installHostFacts 写盘决策（fixture=临时目录，禁动真实状态）
+  if (typeof installHostFacts === 'function') {
+    const fxDir = mkdtempSync(join(tmpdir(), 'deploy-check-g3-'))
+    try {
+      const p1 = join(fxDir, 'case1.json')
+      writeFileSync(p1, '{"providers":{"keep":1}}')
+      const r1 = installHostFacts(fxDef, fxHost, p1)
+      t('g3 install：覆盖件已存在→绝不覆盖（原内容不动）', r1.wrote === false && readFileSync(p1, 'utf8').includes('"keep"'))
+      const p2 = join(fxDir, 'case2.json')
+      const r2 = installHostFacts(fxDef, fxHost, p2)
+      t('g3 install：有 unmatched/ambiguous→不写文件（指引手工路径）', r2.wrote === false && r2.line.includes('DEPLOY §3') && !existsSync(p2))
+      const p3 = join(fxDir, 'case3.json')
+      const r3 = installHostFacts(fxDef2, fxHost2, p3)
+      t('g3 install：全命中且与默认件一致→不写文件（无冗余件）', r3.wrote === false && r3.line.includes('无需覆盖件') && !existsSync(p3))
+      const p4 = join(fxDir, 'case4.json')
+      const r4 = installHostFacts({ providers: { a: { uuid_prefix: 'deadbeef', entry_name: 'E-A' } } }, { provider: { 'aaaaaaaa-1111': { name: 'E-A' } } }, p4)
+      const back4 = existsSync(p4) ? JSON.parse(readFileSync(p4, 'utf8')) : null
+      t('g3 install：漂移→写覆盖件（note 声明+派生 providers+落盘回读一致）', r4.wrote === true && !!back4 && typeof back4.note === 'string' && back4.note.includes('deploy-check --install') && JSON.stringify(back4.providers) === JSON.stringify({ a: { uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' } }))
+      // 回炉轮 1 R1：写盘 IO 抛错→FAIL 结果带真因（红态=裸抛不入结果集——
+      // 旧结构下该错会被调用方笼统报成「宿主配置装载失败」warn=真因掩盖）
+      const blocker = join(fxDir, 'blocker-file')
+      writeFileSync(blocker, 'x')
+      const p5 = join(blocker, 'nested', 'case5.json') // 父级是文件→mkdir/write 必抛 IO 错
+      const r5run = (() => { try { return { r: installHostFacts({ providers: { a: { uuid_prefix: 'deadbeef', entry_name: 'E-A' } } }, { provider: { 'aaaaaaaa-1111': { name: 'E-A' } } }, p5) } } catch (e) { return { e } } })()
+      t('g3 install：写盘 IO 抛错→FAIL 结果带真因（不裸抛/不误归因装载失败）', r5run.r?.level === 'FAIL' && r5run.r.line.includes('写盘/回读失败') && r5run.r.line.includes(blocker))
+      // 回炉轮 1 R4（门一 N5）：仅 unmatched / 仅 ambiguous 两分支单独钉
+      const fxOnlyU = { providers: { uniq: { uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' }, none: { uuid_prefix: 'bbbbbbbb', entry_name: 'E-B' } } }
+      const pU = join(fxDir, 'onlyU.json')
+      const rU = installHostFacts(fxOnlyU, fxHost, pU)
+      t('g3 install：仅 unmatched（无 ambiguous）→不写+指引（行含 none/歧义槽=无）', rU.wrote === false && !existsSync(pU) && rU.line.includes('none') && rU.line.includes('歧义（同 entry_name≥2）=无') && rU.line.includes('DEPLOY §3'))
+      const fxOnlyA = { providers: { uniq: { uuid_prefix: 'aaaaaaaa', entry_name: 'E-A' }, ambi: { uuid_prefix: 'cccccccc', entry_name: 'E-Y1' } } }
+      const pA = join(fxDir, 'onlyA.json')
+      const rA = installHostFacts(fxOnlyA, fxHost, pA)
+      t('g3 install：仅 ambiguous（无 unmatched）→不写+指引（行含 ambi/零命中槽=无）', rA.wrote === false && !existsSync(pA) && rA.line.includes('ambi') && rA.line.includes('无宿主命中 alias=无') && rA.line.includes('DEPLOY §3'))
+    } finally {
+      rmSync(fxDir, { recursive: true, force: true })
+    }
+  } else {
+    t('g3 install：installHostFacts 已导出（红态=函数未落）', false)
+  }
+
   console.log(fails === 0 ? `self-test 全过（${n} 向量）` : `self-test ${fails} 项失败`)
   process.exit(fails === 0 ? 0 : 1)
 }
@@ -259,25 +415,65 @@ if (isMain) {
   const argv = process.argv.slice(2)
   if (argv.includes('--self-test')) selfTest()
 
-  // 自身装载错守卫（exit 3 族）：templates/agents 缺失（清单单源不可用）/org-config 装载失败
+  // 自身装载错守卫（exit 3 族）：templates/agents 缺失（清单单源不可用）
   if (!existsSync(TEMPLATES_AGENTS)) {
     console.error('[装载错] templates/agents/ 缺失——代理清单单源不可用（重装本仓后复跑）')
     process.exit(EXIT_SELF_ERROR)
   }
-  let cfg
+
+  // g3 批（evolve-l4-flags/P9 收敛）：--agents-dir 缺值/值形如 flag/重复→
+  // [用法错] exit 1——原 `|| DEFAULT_AGENTS_DIR` 对缺值静默回退默认目录（假动作面）
+  let agentsDir = DEFAULT_AGENTS_DIR
   try {
-    cfg = loadOrgConfig(SKILL_ROOT).merged
+    if (argv.includes('--agents-dir')) agentsDir = cliFlag(argv, '--agents-dir')
   } catch (e) {
-    console.error(`[装载错] org-config 装载失败：${e.message}`)
-    process.exit(EXIT_SELF_ERROR)
+    if (e instanceof UsageError) {
+      console.error(`[用法错] ${e.message}`)
+      process.exit(1)
+    }
+    throw e
   }
 
-  const agentsDir = argv.includes('--agents-dir') ? cliFlag(argv, '--agents-dir') || DEFAULT_AGENTS_DIR : DEFAULT_AGENTS_DIR
-
+  let installFailCount = 0
   if (argv.includes('--install')) {
-    console.log('[install] 首装模式——仅补缺失代理件与未设 hooksPath（不覆盖漂移件/不改 org-config/宿主配置）')
+    console.log('[install] 首装模式——三动作：④补缺失代理件 / ⑤hooksPath 未设时补设 / ③宿主事实派生项目覆盖件（护栏：不覆盖漂移件/不改 org-config.default.json 与宿主配置）')
     console.log(`[install] ${installAgents(agentsDir).line}`)
     console.log(`[install] ${installHook()}`)
+    // g3 动作③（回炉轮 1 R1/R2 重构错误处置——门一 W2/W3）：三源分行归因——
+    // ① org-config 装载失败（默认件/覆盖件坏）→干净跳过（warn+指引，不裸崩
+    //    不硬停 install 其余动作；覆盖件=用户手改域，note 明示装后可自由改写）；
+    // ② 宿主配置装载失败→跳过+指引（现语义维持）；
+    // ③ installHostFacts 自包写盘段 try/catch——IO/回读抛错=FAIL 结果带真因，
+    //    [FAIL] 行计入阻断（exit 1），不再笼统误报「宿主配置装载失败」。
+    let hf
+    let oc = null
+    try {
+      oc = loadOrgConfig(SKILL_ROOT)
+    } catch (e) {
+      hf = { wrote: false, level: 'warn', line: `install-hostfacts——跳过：org-config 装载失败（${e.message}）——处置=修复或移除 .zcode/org-config.json（用户域件）/核对默认件后复跑；手工路径=DEPLOY §3` }
+    }
+    if (oc) {
+      let hostCfg = null
+      try {
+        hostCfg = readHostConfig()
+      } catch (e) {
+        hf = { wrote: false, level: 'warn', line: `install-hostfacts——跳过：宿主配置装载失败（${e.message}）——手工路径=DEPLOY §3` }
+      }
+      if (hostCfg) hf = installHostFacts(oc.merged, hostCfg, oc.overPath)
+    }
+    if (hf.level === 'FAIL') installFailCount++
+    console.log(hf.level === 'FAIL' ? `[FAIL] ${hf.line}` : `[install] ${hf.line}`)
+  }
+
+  // 自身装载错守卫（exit 3 族）：org-config 装载失败（检查主体消费 cfg——
+  // 回炉轮 1 R2 后移至 install 块后：坏覆盖件时 install 三动作先执行、③ 打印
+  // 干净跳过行，再到此处按装载错退 3，不再整场前置短路）
+  let cfg
+  try {
+    cfg = loadOrgConfig(SKILL_ROOT).merged
+  } catch (e) {
+    console.error(`[装载错] org-config 装载失败：${e.message}`)
+    process.exit(EXIT_SELF_ERROR)
   }
 
   let results
@@ -291,6 +487,8 @@ if (isMain) {
     throw e
   }
   const sum = summarize(results)
-  console.log(sum.line)
-  process.exit(exitCodeFrom({ failCount: sum.fail }))
+  // 回炉轮 1 R1：install 动作③ 的 FAIL 计入阻断口径（sum 口径本身不动——
+  // 门一 W2：写盘真因 FAIL 静默 warn=失败面掩盖）
+  console.log(sum.line + (installFailCount ? `——另含 install 动作 FAIL ×${installFailCount}（计入阻断）` : ''))
+  process.exit(exitCodeFrom({ failCount: sum.fail + installFailCount }))
 }
```

## 4. git diff --stat 总量比对（主控核对回炉面收敛）

- 首轮（门一已审）：7 files changed, 302 insertions(+), 37 deletions(-)
- 回炉后（当前）：7 files changed, 356 insertions(+), 45 deletions(-)
- 增量 +54/+8 全部落 deploy-check.mjs 单件（其余六件 hunks 与首轮逐字相同——主控 git diff 逐件比对核对）；未跟踪面=00-glossary.md（首轮已审全文，未再改）+三份批档（brief/impl-report/gate1-out——报告增量=回炉节，已全文入 §2）。
