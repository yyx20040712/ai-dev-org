# 2026-09-17 v1.7.4 m4 硬编码清偿批 — 门二实证实录（ops-probe 独立重跑）

- 环境：win32 10.0.26200 x64 / Git Bash / Node v25.2.1；根=C:/Users/Administrator/.zcode/skills/ai-dev-org
- 纪律：全部亲跑真退出码；仅临时覆盖件 根/.zcode/org-config.json（建后必删，终态核验已删）与本实录件为写面；全部 --dry-run/--mock-source/覆盖件路径，零真实外呼。
- 注：ds-call-v2/check-anchors/regression 配置装载恒从 cwd（ds-call-v2 L369 / check-anchors L191 / regression L424），故覆盖件单元均以技能根为 cwd 执行。Node 25.2.1 在 supported_node.forbid_major 内→node-guard 仅 stderr 警告不拦（ds-call-v2 L100-108 亲读确认），退出阶段未见崩溃。

## 一、矩阵执行表

### M1 值不变性（配置侧）— PASS
- 命令：`node -e "const{loadOrgConfig}=await import('file:///.../scripts/org-config.mjs');...{d:merged.dispatch_request,r:merged.regression_cfg,a:merged.anchors_exempt})"`
- 时间：2026-09-17T09:07+0800；退出码=0
- 关键输出：`{"d":{"max_tokens":32768,"temperature":0.2,...},"r":{"r1_sources":["kimi-main","deepseek"],...},"a":{"project_names":["scripts/run_gates.py","scripts/check_model_names.py","scripts/check-model-names.mjs","scripts/check-locks.mjs","check-tickets.mjs","__init__.py"],...}}`
- 对照：max_tokens=32768/temperature=0.2 ✓；r1_sources=["kimi-main","deepseek"] ✓；project_names 六名 ✓ → PASS

### M2 守卫·dispatch_request — PASS
- 覆盖件 根/.zcode/org-config.json=`{"dispatch_request": null}`；命令（cwd=技能根）：`node scripts/ds-call-v2.mjs --role gate1-reviewer --dry-run <临时prompt>`（prompt=$TEMP/m4probe/prompt.txt）
- 时间：09:08:07；退出码=3；stderr 点名：`[fatal] org-config dispatch_request 分区缺失或非对象（现=undefined）——派发器请求参数单源（v1.7.4 m4 清偿），缺段=exit 3 无静默回退` ✓（另有 node-guard 警告行，系宿主 Node 25 既知面，与被测守卫无关）
- 删覆盖件复跑：09:08:15；退出码=0；stdout JSON 含 cfg_hash=20254429f008、chain=kimi-main→kimi-backup→deepseek ✓ → PASS

### M3 守卫·anchors — PASS（四段）
- ①覆盖件=`{"anchors_exempt": {"project_names": []}}`：09:08:37，`node scripts/check-anchors.mjs` → 路径缺失 WARN×7（run_gates.py×2/__init__.py/check-locks.mjs/check-tickets.mjs/check_model_names.py/check-model-names.mjs，正与名单六名对应）+`汇总：WARN ×7/ FAIL ×0`，退出码=0（试点口径，WARN≥1）✓
- ②删覆盖件复跑：09:08:43 → `WARN ×0/ FAIL ×0`，退出码=0 ✓
- ③覆盖件=`{"anchors_exempt": null}`：09:08:50 → stderr `org-config anchors_exempt.project_names 缺段或非数组（现=undefined）——项目侧点名单单源（v1.7.4 m4 清偿），缺段=exit 3 无静默回退`，退出码=3，点名 anchors ✓
- ④删覆盖件复跑：09:08:56 → `WARN ×0/ FAIL ×0`，退出码=0；.zcode/ 仅余 org-ledger.jsonl ✓ → PASS

### M4 守卫·regression_cfg — PASS
- 覆盖件=`{"regression_cfg": {"r1_sources": []}}`；命令（cwd=技能根）：`node scripts/regression.mjs --only R1 --r1`；时间 09:09:26
- 关键输出：`FAIL R1 regression_cfg.r1_sources 为空数组（org-config 单源，v1.7.4 m4 清偿）——R1 语义面失效，显式 FAIL 不静默跳过` + `regression 汇总：0/1 过，FAIL ×1`；退出码=1 ✓（FAIL 原因点名空数组判据）
- 零外呼旁证：scripts/model-routing-log.jsonl 行数 1406→1406（守卫先于派发循环断，无 attempt 行、无真实外呼迹象）✓
- 删覆盖件复跑 `--only R1`：09:09:36 → `SKIP R1 未给 --r1——真实派发配给保护，~9k Kimi tokens；冻结裁决前须跑或显式登记欠账（SKIP 不计入通过数——ds-W6）`+`汇总：0/0 过，SKIP ×1`，退出码=0（SKIP 语义不变）✓ → PASS

### M5 比较键泛化实证 — PASS
- `node scripts/regression.mjs --only R1`（无 --r1）→ SKIP 原文逐字如上 ✓
- `grep -c "verdicts\['kimi-main'\]" scripts/regression.mjs` → 0（grep 退出码 1=零匹配；现码=verdicts[srcA]/verdicts[src] 泛化键，亲读 L440-456 确认）✓ → PASS

### M6 R4 自愈复证 — PASS
- 命令（cwd=技能根）：`node scripts/regression.mjs`（全量）；09:10:00 起跑；退出码=0
- 关键输出：`PASS R4 …事件分布={"attempt":79,"exhaust":7,"switch":13,"ok":1}；cfg哈希一致=true（流水 20254429f008 vs live cfg:20254429f008）；账本:尾50行坏0行…跳14行(旧版本)` ✓
- 汇总：`8/8 过，SKIP ×1（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）` ✓ → PASS

### M7 字面量清零三查 — PASS
- `grep -c "32768" scripts/ds-call-v2.mjs`=0 ✓
- `grep -c "kimi-main.*deepseek" scripts/regression.mjs`=0（零行命中——含注释在内无任何源名单内联形态；源名仅经 org-config regression_cfg.r1_sources 消费，L424-434）✓
- `grep -c "run_gates" scripts/check-anchors.mjs`=0（正文与注释均无；豁免语义经 M3 ①②正反实测证）✓ → PASS

### M8 全链 mock 无回归 — PASS（命令形态偏差见异常 A-1）
- 探针（--dry-run 零副作用，09:10:4x）：矩阵原文三点重复 `--mock-source` 旗标 → `mock_field={"kimi-main":429}` 仅首点生效（A-1）。守「mock 禁漏注/禁真实外呼」纪律，本体改按脚本文档态单旗标逗号并列（等价全链三点注射）执行。
- 命令（cwd=$TEMP/m4probe，账本随派发器 cwd 落临时目录）：`node .../ds-call-v2.mjs --role gate1-reviewer --mock-source kimi-main:429,kimi-backup:500,deepseek:503 --project <临时目录> <prompt> <out>`；09:10:55；退出码=2 ✓（全源尽）
- stderr [routing] 三行均含 `cfg=20254429f008`（run=20260917011055-t2tn）✓；三源错误均带「（mock）」（429/500/503），mock 退避零等待、全程亚秒=零真实外呼 ✓；临时账本尾行 switch/exhaust 均 mocked:true、cfg_hash=20254429f008 ✓；exhaust 路径无输出文件（预期）✓ → PASS

### M9 真实外呼账目核对 — PASS（账本侧缺行观察 A-2）
- `tail -3 scripts/model-routing-log.jsonl` = 我方 M8 mock 行（mocked:true，预期自扰，无碍）。
- `grep "m4 mock drill"` 流水=0、根/.zcode/org-ledger.jsonl=0（两账均不存 prompt 正文——流水行仅 promptBytes；真实调用以 runId 链甄别）。
- 实现者自裁 1 的那次真实调用（scripts/audits/2026-09-17_m4-impl-report.md §六.1：两点注入漏 kimi-backup→一次真实调用）**在流水账**：runId=20260917010151-6qlc——L1370-1374 kimi-main 四 attempt 全 mocked:true→switch（429 mock）→L1375 kimi-backup attempt **mocked:false**→L1376 `event=ok source=kimi-backup usage={in:501,out:438} latency=13621ms finish=end_turn truncated=false`（promptBytes=13=「m4 mock drill」字节长吻合；13.6s 真实时延、真实非零用量=真实外呼铁证）✓ ok 行/计费源=kimi-backup 在账。
- 根账本核对该 runId=零行、2026-09-17T01:0x 时段零行（见 A-2）。→ 按「ok 行/计费源=kimi-backup 在账」判据 PASS，A-2 如实呈报。

### M10 门禁不回归 — PASS
- `sh .githooks/pre-commit` → `check-hardcode 命中 0`+`check-anchors WARN×0/FAIL×0`+`[pre-commit] 三项快扫通过`，退出码=0 ✓
- `node scripts/check-hardcode.mjs --strict` → `扫 13 个 .md，命中 0 处（白名单豁免 36）`，退出码=0 ✓
- `node scripts/check-anchors.mjs --self-test` → `[self-test] 18/18 过`，退出码=0 ✓ → PASS

## 二、异常清单（勿自修，呈裁决）

- **A-1（观察·命令形态 vs 脚本解析面）**：矩阵 M8 原文以三点重复 `--mock-source` 旗标给令，而 ds-call-v2 `flag()` 仅读首个旗标值（L349-352 亲读）→ 仅首点注入、余链静默转真实调用（探针实录：mock_field={"kimi-main":429}）。脚本文档态多点=单旗标逗号并列（L17-18）。证据：$TEMP/m4probe 探针实录（本档 M8 节）。初分类=简报命令形态与脚本文档形态不一致；脚本对重复旗标无告警（静默丢注入点）属 CLI 健壮性可议面，非本批被测守卫回归。实现者自裁 1 的真实外呼正是同型漏注事故（两点注入漏 kimi-backup）——与本观察互为印证。
- **A-2（观察·账本落点语义）**：实现者那次真实调用（runId=20260917010151-6qlc）ok 行仅在流水（scripts/model-routing-log.jsonl L1376），根/.zcode/org-ledger.jsonl 无该 runId 行。亲读 ds-call-v2 L372-373：账本路径=join(process.cwd(), ledger_path)——drill 以临时 cwd 执行时账本随落临时目录（与 regression R5 演练口径同构），流水路径恒绝对故在册。初分类=by-design 落账语义嫌疑大（非行丢失/坏行），临时账本件随临时目录处置不在我职权内，呈裁决定性。

## 三、证据文件指针
- 本实录：C:/Users/Administrator/.zcode/skills/ai-dev-org/scripts/audits/2026-09-17_m4-gate2-evidence.md
- 流水：C:/Users/Administrator/.zcode/skills/ai-dev-org/scripts/model-routing-log.jsonl（本次新增 30 行全 mocked:true：M6-R5 演练 15 行 runId 见 R5 输出+M8 演练 15 行 run=20260917011055-t2tn；1406→1436 对账吻合，零未释行）
- 根账本：C:/Users/Administrator/.zcode/skills/ai-dev-org/.zcode/org-ledger.jsonl（本次零写入——M8 账本随 cwd 落临时目录）
- 临时账本（M8 演练落点）：$TEMP/m4probe/.zcode/org-ledger.jsonl（mocked switch/exhaust 两行）
- 真实调用铁证行：model-routing-log.jsonl L1375-L1376（attempt mocked:false → ok source=kimi-backup）
- 实现者自裁声明：C:/Users/Administrator/.zcode/skills/ai-dev-org/scripts/audits/2026-09-17_m4-impl-report.md §六.1

## 四、收口
- 矩阵 M1-M10：**10/10 PASS**；异常 2 项（A-1/A-2，均观察级，未自修）。
- 临时覆盖件已删（终态 09:12:47 核验 .zcode/ 仅余 org-ledger.jsonl）；本岗全程零真实外呼（新增流水行全 mocked:true）。
- 同源注记：本岗 model-field 与前批同 key（deploy-gate2 行同注）——实证面=机械重跑，判断性结论留裁决部。
