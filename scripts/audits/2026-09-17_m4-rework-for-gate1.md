# 门一回炉复核包：v1.7.4 m4 批回炉 1 轮（自包含增量——只读本文件；你首轮审过的 diff 上下文仍在你的会话记忆）

## 回炉处置申报（对首轮 W-1/W-2/N-1）
- W-1：ds-call-v2 callSource 守卫——mock 对象存在且 !(alias in mock) → ConfigError exit 3 点名「--mock-source 漏注射 <alias>」；红证：单点注射 --mock-source kimi-main:429 → 链至 kimi-backup 即 exit 3 [fatal] 点名（零外呼）。
- W-2：regression R1 守卫链增重复别名判据（new Set(size) !== length → record FAIL 点名）；红证：覆盖件 [kimi-main,kimi-main] → --only R1 --r1 FAIL 点名（守卫先于派发零外呼）。
- N-1：check-anchors 主流程 loadOrgConfig 包 try/catch → [fatal]+exit 3（06 §5.8 行 3）；红证：坏 JSON 覆盖件 → exit 3 点名装载失败。
- 复绿全套：validate 0（cfg:20254429f008 不变）/regression 8/8（R5 计数 12/2/1 不变=全注射形态不误伤）/anchors 0/0/self-test 18/18/hardcode --strict 0/dry-run 0。

## 当前三脚本+CHANGELOG 全量 diff（增量处以【回炉】标注对应 W/N）
```diff
diff --git a/CHANGELOG.md b/CHANGELOG.md
index f2e7016..5d7edd7 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -4,6 +4,42 @@
 > 逐字保留，此后新增版本只在本件追加）。v1.7.2 起 SKILL.md 不再保留
 > 任何修订记内联条（含最近一条摘要），版本面单源=本件。历史条目属过程记录，按 references/08 §3 红线不再改写。
 
+## 2026-09-17 v1.7.4（m4 硬编码清偿批——脚本参数面收编 org-config：三分区单源+缺段 exit 3 守卫）
+
+- **动机**：在册残留 evolve-m4-hardcode 三处脚本硬编码（ds-call-v2 请求参数
+  字面量/regression R1 源名单内联/check-anchors 项目侧点名单）——「脚本禁
+  硬编码供应商事实」纪律（06 §0/A3）的参数面延伸：改动须走 cfg_hash 可追溯，
+  缺段拒跑而非静默回退。
+- **变更**：A org-config.default.json 新增三分区 dispatch_request（max_tokens/
+  temperature，ds-call-v2 两载荷形态共用）/regression_cfg（r1_sources）/
+  anchors_exempt（project_names），插在 hardcode_scan 与 roles 之间；B ds-call-v2
+  两 body 载荷改读配置（装载点校验有限数值，否则 ConfigError exit 3 点名
+  分区与字段）；C regression R1 SOURCES 改读 regression_cfg.r1_sources（缺段/
+  空数组/别名∉providers → R1 FAIL 显式原因，不静默跳过；守卫先于派发循环=
+  零真实调用）；D check-anchors PROJECT_NAMES 改由配置派生（缺段/非数组
+  exit 3，词表缺失族）+--self-test 16→18 向量（fixture 派生正例+缺段错误
+  形态）。cfg_hash 变更申报：a26f710a540d → 20254429f008（以 `node
+  scripts/org-config.mjs hash` 实跑为准）。
+- **行为变化申报**：值不变纯迁址（三分区默认值=原脚本字面量，行为面零变化）；
+  新增缺段守卫（旧行为=无守卫）——ds-call-v2 缺段/非数值=exit 3、
+  check-anchors 缺段/非数组=exit 3、R1 缺段/空名单/未知别名=FAIL，均无
+  静默回退；变异红证：null 覆盖件三点全中、点名单置空 → 路径缺失
+  WARN ×7（消费证）。
+- **机检面**：R2a/R2b golden 不涉（系统提示不变）；R5 链行为不变（mock
+  全链 exit 2/attempt 12/switch 2/exhaust 1）；R4 自愈路径=新哈希行随
+  R5 mock 派发先于 R4 写入（cfg哈希一致=true：流水 20254429f008 vs live）；
+  终态=regression 8/8、anchors 0/0（面 11）、--self-test 18/18、hardcode
+  命中 0。批档=scripts/audits/2026-09-17_m4-impl-report.md。
+- **实现链**：ops-executor 一轮+回炉 1 轮（门一 W-1/W-2/N-1 终裁批内清偿，
+  门一回炉重审）：W-1 mock 漏注射=ConfigError exit 3 拒跑（外层 catch 直通
+  配置类错不进换源/exhaust 链语义——根因堵死本批自裁 1「漏注射静默真实调用」
+  前科）；W-2 R1 守卫链补重复别名判据（双源一致性退化同源自比=FAIL）；
+  N-1 check-anchors 主流程装载失败=[fatal] 一行+exit 3（对齐 ds-call-v2
+  ConfigError 惯例，06 §5.8 行 3）。三红证零外呼实录（漏注射 exit 3 点名
+  kimi-backup/重复别名 FAIL 点名/坏 JSON [fatal] exit 3），自检向量数不变
+  （18）如实保留；复绿全套=regression 8/8+anchors 0/0+self-test 18/18+
+  hardcode 0 命中+validate PASS（cfg 不变 20254429f008——回炉零配置面变更）。
+
 ## 2026-09-17 v1.7.3（部署能力批——新机一键自检+首装：宿主侧 ops-* 六代理版本化入 templates）
 
 - **动机**：外部评估 P5 的可落地部分——新机部署能力缺位（部署体检散落多脚本、
diff --git a/scripts/check-anchors.mjs b/scripts/check-anchors.mjs
index 551393d..5cf0a62 100644
--- a/scripts/check-anchors.mjs
+++ b/scripts/check-anchors.mjs
@@ -23,6 +23,7 @@ import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from
 import { join, dirname, resolve } from 'node:path'
 import { fileURLToPath } from 'node:url'
 import { homedir } from 'node:os'
+import { loadOrgConfig } from './org-config.mjs'
 
 const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url)) // 规范路径解析（勿用 URL pathname 手拼——v1.6 批 P0-B 教训）
 const SKILL_ROOT = resolve(SCRIPT_DIR, '..')
@@ -95,7 +96,21 @@ function checkEntryRefs(ln, entIdx) {
 
 // 项目侧路径（项目仓/项目覆盖件/项目脚本示例）不属技能根存在性检查域——按前缀+点名跳过（试点基线分类：均为 WP/Synapse 项目侧文件）
 const PROJECT_PREFIX = /^(\.zcode\/|reports\/|briefs\/|docs\/)/
-const PROJECT_NAMES = new Set(['scripts/run_gates.py', 'scripts/check_model_names.py', 'scripts/check-model-names.mjs', 'scripts/check-locks.mjs', 'check-tickets.mjs', '__init__.py'])
+
+// 点名单单源=org-config anchors_exempt.project_names（v1.7.4 m4 清偿，残留册
+// evolve-m4-hardcode 承接）：deriveProjectNames 派生纯函数（主扫描真实装载+
+// --self-test fixture 共用）；缺段/非数组=exit 3（词表缺失族——同 finish_vocab
+// 口径：无兜底名单，缺=配置错即拒跑，无静默回退）。PROJECT_PREFIX 正则=
+// 语法形态，留脚本内（org-config 同段 note 明示）。
+function deriveProjectNames(merged) {
+  const list = merged?.anchors_exempt?.project_names
+  if (!Array.isArray(list))
+    return {
+      names: null,
+      error: `org-config anchors_exempt.project_names 缺段或非数组（现=${list === undefined ? 'undefined' : JSON.stringify(list) ?? String(list)}）——项目侧点名单单源（v1.7.4 m4 清偿），缺段=exit 3 无静默回退`,
+    }
+  return { names: new Set(list), error: null }
+}
 
 function resolveRef(v) {
   if (v.startsWith('~/')) return resolve(homedir(), v.slice(2))
@@ -158,6 +173,11 @@ function selfTest() {
   t('免误伤：K3 编号短语（无文档号·前缀）不命中', refsOf('K3 编号短语不命中')?.length === 0, true)
   t('「」叙述跳过延续 ·XN 族', refsOf('「旧引 02·C2 为断锚」叙述')?.length === 0, true)
   t('两位文档号条目形：10·A1 解析 no=10（现无该号文档=断锚方向）', (() => { const r = refsOf('10·A1'); return Array.isArray(r) && r.length === 1 && r[0].no === '10' && r[0].ok === false })(), true)
+  // m4 清偿向量（v1.7.4）：点名单从 fixture 配置派生正例（名单内路径被豁免）+缺段 exit 3 语义
+  const dOk = typeof deriveProjectNames === 'function' ? deriveProjectNames({ anchors_exempt: { project_names: ['scripts/x.py', 'y.md'] } }) : null
+  t('m4 点名单 fixture 派生正例：名单内命中被豁免/名单外不命中（豁免不外溢）', dOk?.error == null && dOk?.names?.has?.('scripts/x.py') === true && dOk?.names?.has?.('scripts/other.py') === false, true)
+  const dBad = typeof deriveProjectNames === 'function' ? deriveProjectNames({}) : null
+  t('m4 缺段→exit 3 语义：deriveProjectNames 返回错误形态+stderr 点名 anchors_exempt', dBad?.error != null && dBad?.names === null && dBad.error.includes('anchors_exempt'), true)
   if (fails.length) console.error(`[self-test] FAIL ×${fails.length}: ${fails.join('; ')}`)
   else console.error(`[self-test] ${n}/${n} 过`)
   return fails.length === 0
@@ -166,6 +186,20 @@ function selfTest() {
 // ── 主流程 ──
 if (flag('--self-test')) process.exit(selfTest() ? 0 : 1)
 
+// 点名单装载（主流程真实配置；--self-test 用 fixture 不触真实装载）——
+// 缺段/非数组=exit 3（词表缺失族），stderr 点名；装载失败（坏 JSON 等）
+// =06 §5.8 行 3（配置/装载错）：[fatal] 一行+exit 3（门一 N-1，回炉 1 轮——
+// 对齐 ds-call-v2 ConfigError 惯例，防裸抛堆栈噪声/误退出码）
+let mergedCfg
+try {
+  mergedCfg = loadOrgConfig(process.cwd()).merged
+} catch (e) {
+  console.error(`[fatal] org-config 装载失败（check-anchors 主流程）: ${e.message}（06 §5.8 行 3=配置/装载错）`)
+  process.exit(3)
+}
+const { names: PROJECT_NAMES, error: namesErr } = deriveProjectNames(mergedCfg)
+if (namesErr) { console.error(namesErr); process.exit(3) }
+
 const idx = buildHeadingIndex()
 const entryIdx = buildEntryIndex()
 let warn = 0, fail = 0
diff --git a/scripts/ds-call-v2.mjs b/scripts/ds-call-v2.mjs
index 3141aca..864ad1b 100644
--- a/scripts/ds-call-v2.mjs
+++ b/scripts/ds-call-v2.mjs
@@ -112,6 +112,22 @@ const exitConfig = (msg) => {
   process.exit(3)
 }
 
+// ── 派发器请求参数单源（v1.7.4 m4 清偿）：org-config dispatch_request ──
+// 两载荷形态（anthropic/openai）共用；缺段/非有限数值=ConfigError（exit 3，
+// stderr 点名分区与字段）——无静默回退，禁脚本内字面量。
+function loadDispatchRequest(merged) {
+  const d = merged?.dispatch_request
+  if (d == null || typeof d !== 'object')
+    throw new ConfigError(`org-config dispatch_request 分区缺失或非对象（现=${d === undefined ? 'undefined' : String(d)}）——派发器请求参数单源（v1.7.4 m4 清偿），缺段=exit 3 无静默回退`)
+  const bad = (k, v) =>
+    new ConfigError(`org-config dispatch_request.${k} 缺失或非有限数值（现=${typeof v === 'number' ? String(v) : JSON.stringify(v) ?? String(v)}）——派发器请求参数单源（v1.7.4 m4 清偿），缺段/非数值=exit 3 无静默回退`)
+  const mt = d.max_tokens
+  const tp = d.temperature
+  if (typeof mt !== 'number' || !Number.isFinite(mt)) throw bad('max_tokens', mt)
+  if (typeof tp !== 'number' || !Number.isFinite(tp)) throw bad('temperature', tp)
+  return { maxTokens: mt, temperature: tp }
+}
+
 // ── 本地落账安全封装：目录自动建+IO 失败降级警告（不抛入远程重试语义） ──
 function makeSafeAppend() {
   let warned = false
@@ -178,21 +194,21 @@ function loadSources(merged, hostCfg) {
   })
 }
 
-function buildRequest(src, prompt, system) {
+function buildRequest(src, prompt, system, reqParams) {
   if (src.kind === 'anthropic') {
     const base = src.baseURL.replace(/\/v1$/, '')
     return {
       url: `${base}/v1/messages`,
       method: 'POST',
       headersReal: { 'content-type': 'application/json', 'x-api-key': src.apiKey, 'anthropic-version': '2023-06-01' },
-      body: { model: src.modelName, max_tokens: 32768, temperature: 0.2, system, messages: [{ role: 'user', content: prompt }] },
+      body: { model: src.modelName, max_tokens: reqParams.maxTokens, temperature: reqParams.temperature, system, messages: [{ role: 'user', content: prompt }] },
     }
   }
   return {
     url: `${src.baseURL}/chat/completions`,
     method: 'POST',
     headersReal: { 'Content-Type': 'application/json', Authorization: `Bearer ${src.apiKey}` },
-    body: { model: src.modelName, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.2, max_tokens: 32768 },
+    body: { model: src.modelName, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: reqParams.temperature, max_tokens: reqParams.maxTokens },
   }
 }
 
@@ -280,10 +296,14 @@ function postJson(url, headers, body, timeoutMs) {
   })
 }
 
-async function callSource(src, prompt, system, logger, mock) {
+async function callSource(src, prompt, system, logger, mock, reqParams) {
+  // 门一 W-1（v1.7.4 回炉 1 轮）：--mock-source 给出但链内某源未注射=拒跑——
+  // 防「漏注射=静默真实调用」（本批自裁 1 前科：两点注入漏链内第三源致一次真实调用）。
+  if (mock && !(src.alias in mock))
+    throw new ConfigError(`--mock-source 漏注射 ${src.alias}——mock 模式缺注射即拒跑，防静默真实调用（门一 W-1，本批自裁 1 前科）`)
   const mockedStatus = mock ? mock[src.alias] : undefined
   const mocked = mockedStatus !== undefined
-  const req = buildRequest(src, prompt, system)
+  const req = buildRequest(src, prompt, system, reqParams)
   const t0 = Date.now()
   for (let attempt = 0; attempt < 4; attempt++) {
     logger.routing('attempt', { source: src.alias, model: src.modelName, attempt: attempt + 1, promptBytes: Buffer.byteLength(prompt, 'utf8'), mocked: !!mocked })
@@ -352,6 +372,7 @@ async function cliMain() {
   let merged // b2：配置装载类失败抛 ConfigError（exit 3）——英文 locale 消息不含关键词，原正则兜底误判 exit 1
   try { ({ merged } = loadOrgConfig(process.cwd())) } catch (e) { throw new ConfigError(`org-config 装载失败: ${e.message}`) }
   nodeVersionGuard(merged)
+  const dispatchReq = loadDispatchRequest(merged) // m4 清偿：请求参数单源（缺段/非数值=exit 3，两载荷形态共用）
   const rawLedger = merged.ledger_path || '.zcode/org-ledger.jsonl'
   const ledgerPath = isAbsolute(rawLedger) ? rawLedger : join(process.cwd(), rawLedger)
   // 注：--project=账本条目名；配置装载恒从 cwd。死配置守卫（org-config 角色↔registry
@@ -424,7 +445,7 @@ async function cliMain() {
           role: { id: role.id, version: role.version, sig: role.sig, sys_prompt: role.sysPrompt, dod: role.dod, assembled_system: system },
           chain: chain.map((s) => s.alias),
           route_source: routeSource,
-          sources: chain.map((s) => ({ alias: s.alias, url: buildRequest(s, prompt, system).url, model: s.modelName, kind: s.kind })),
+          sources: chain.map((s) => ({ alias: s.alias, url: buildRequest(s, prompt, system, dispatchReq).url, model: s.modelName, kind: s.kind })),
           routing_log: LOG_PATH,
           ledger: ledgerPath,
           cfg_hash: cfgHash(merged),
@@ -453,8 +474,9 @@ async function cliMain() {
     console.error(`[routing] run=${runId} role=${role.id}@${role.sig} cfg=${cfgHash(merged)} 尝试源 ${i + 1}/${chain.length}: ${s.alias}(${s.modelName})`)
     let result
     try {
-      result = await callSource(s, prompt, system, logger, mock)
+      result = await callSource(s, prompt, system, logger, mock, dispatchReq)
     } catch (e) {
+      if (e instanceof ConfigError) throw e // W-1（回炉 1 轮）：漏注射=配置类错直通 exit 3，不进换源/exhaust 链语义
       // P0-4 真因 2：网络级失败（fetch failed）无 HTTP 状态码——显式写 null，
       // 保字段存在（R4 schema 要求 statusCode；缺字段=坏行）。
       const statusCode = e.statusCode ?? null
diff --git a/scripts/regression.mjs b/scripts/regression.mjs
index 285058f..1106176 100644
--- a/scripts/regression.mjs
+++ b/scripts/regression.mjs
@@ -417,12 +417,32 @@ if (wantR1) {
     { id: 'S2-干净样例', expect: 'PASS', prompt: '审查以下测试改动并只回答一行「判定:PASS」或「判定:FAIL:原因」：\n```diff\n- const n = items.filter(x => x.ok).length\n+ const n = items.filter((x) => x.ok).length\n```' },
     { id: 'S3-占位残留', expect: 'FAIL', prompt: '审查以下测试改动并只回答一行「判定:PASS」或「判定:FAIL:原因」：\n```diff\n+ // TODO: 补充断言\n+ it("works", () => { expect(true).toBe(true) })\n```' },
   ]
-  const SOURCES = ['kimi-main', 'deepseek']
+  // R1 双源抽样源名单单源=org-config regression_cfg.r1_sources（v1.7.4 m4 清偿，
+  // 残留册 evolve-m4-hardcode 承接）：缺段/空数组/别名∉providers → record('R1', false,
+  // 明确原因)——不静默跳过（守卫先于派发循环=零真实调用即 FAIL）；名单语义=前两源
+  // 成对比较方向一致性；改名单=R1 语义变更须重验。
+  const { merged } = loadOrgConfig(process.cwd())
+  const SOURCES = Array.isArray(merged.regression_cfg?.r1_sources) ? merged.regression_cfg.r1_sources : null
+  const badSources = SOURCES === null
+    ? 'regression_cfg.r1_sources 缺段或非数组（org-config 单源，v1.7.4 m4 清偿）'
+    : SOURCES.length === 0
+      ? 'regression_cfg.r1_sources 为空数组（org-config 单源，v1.7.4 m4 清偿）'
+      : SOURCES.length < 2
+        ? `regression_cfg.r1_sources 少于 2 源（现=[${SOURCES.join(',')}]）——双源方向一致性判定不可构成`
+      : new Set(SOURCES).size !== SOURCES.length
+        ? `r1_sources 含重复别名（现=[${SOURCES.join(',')}]）——双源一致性退化为同源自比（门一 W-2）`
+        : SOURCES.some((a) => !(merged.providers || {})[a])
+          ? `regression_cfg.r1_sources 含 providers 外别名（现=[${SOURCES.join(',')}]——源别名须∈providers）`
+          : null
+  if (badSources) {
+    record('R1', false, `${badSources}——R1 语义面失效，显式 FAIL 不静默跳过`)
+  } else {
   const tmp = mkdtempSync(join(tmpdir(), 'r1-'))
   let allPass = true, detail = []
+  const [srcA, srcB] = SOURCES
   for (const c of CASES) {
     const verdicts = {}
-    for (const src of SOURCES) {
+    for (const src of [srcA, srcB]) {
       const pf = join(tmp, c.id + '.txt')
       writeFileSync(pf, c.prompt, 'utf8')
       const r = spawnSync(node()[0], [join(SCRIPTS, 'ds-call-v2.mjs'), '--role', 'gate1-reviewer', '--source', src, '--project', tmp, pf, pf + '.' + src + '.out'], { encoding: 'utf8', cwd: tmp, timeout: 5_400_000, killSignal: 'SIGKILL' }) // R1 超时=单源推导 4×20min（链长 4×派发器 CALL_TIMEOUT_MS）+35s 开销=4,835,000ms，+裕量取 90min（5,400,000ms∈C5 机检窗 [4,835,000, 7,200,000]；evolve-E2 b5——原 1,260,000 低于派生值，合法最坏链会被先杀误报 FAIL；v1.6 批史：原 10min 同病）
@@ -433,12 +453,13 @@ if (wantR1) {
       verdicts[src] = vm ? vm[1].toUpperCase() : `UNPARSEABLE(exit=${r.status})`
       if (verdicts[src] === 'UNPARSEABLE') allPass = false
     }
-    const agree = verdicts['kimi-main'] === verdicts['deepseek'] && verdicts['kimi-main'] === c.expect
+    const agree = verdicts[srcA] === verdicts[srcB] && verdicts[srcA] === c.expect
     if (!agree) allPass = false
-    detail.push(`${c.id}:${verdicts['kimi-main']}/${verdicts['deepseek']}(期${c.expect})${agree ? '✓' : '✗'}`)
+    detail.push(`${c.id}:${verdicts[srcA]}/${verdicts[srcB]}(期${c.expect})${agree ? '✓' : '✗'}`)
   }
   if (!keepTmp) rmSync(tmp, { recursive: true, force: true })
   record('R1', allPass, `双源判定方向一致性 ${detail.join(' ')}`)
+  }
 } else if (want('R1')) {
   recordSkip('R1', '未给 --r1——真实派发配给保护，~9k Kimi tokens；冻结裁决前须跑或显式登记欠账（SKIP 不计入通过数——ds-W6）')
 }
```

## 复核 DoD：三处置是否 ADDRESSED（守卫语义完备/红证与代码一致/无新破坏——特别是 W-1 守卫不误伤 R5 全链 mock 与真实派发路径）；末行 VERDICT=PASS 或 FAIL。中文。
