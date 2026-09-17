# 2026-09-17 v1.7.4 m4 硬编码清偿批——实现批报告（触派发器）

任务书=ai-dev-org 技能「2026-09-17 v1.7.4 m4 硬编码清偿批（实现批，触派发器）」七段制。
白名单改动=org-config.default.json / scripts/ds-call-v2.mjs / scripts/regression.mjs /
scripts/check-anchors.mjs / CHANGELOG.md / RESIDUALS.md / references/06-model-routing.md（§8 一行）
/ 本报告。禁 git（提交由主控收口）、禁网络（全部 dry-run/mock/覆盖件验证）、禁子代理——均遵守
（一处操作失误见自裁申报 1）。本机宿主 Node v25.2.1（node-guard 告警行属已知基线面，非本批引入）。

## 一、基线（改前红证，2026-09-17 实录）

| 项 | 命令（cwd=技能根） | 退出码 | 关键输出 | 期值核对 |
|---|---|---|---|---|
| cfg 哈希（旧） | `node scripts/org-config.mjs hash` | 0 | `cfg:a26f710a540d` | =基线数字 ✓ |
| 硬编码点在位 | grep 三脚本 | 0（有命中） | ds-call-v2.mjs:188/195 各含 max_tokens=32768+temperature: 0.2；regression.mjs:420 `const SOURCES = ['kimi-main', 'deepseek']`；check-anchors.mjs:98 PROJECT_NAMES 六名 | 三点全在 ✓ |
| regression | `node scripts/regression.mjs` | 0 | `8/8 过，SKIP ×1`（R1 SKIP） | ✓ |
| anchors | `node scripts/check-anchors.mjs` | 0 | `WARN ×0 / FAIL ×0（扫描面=11 件）` | ✓ |
| hardcode | `node scripts/check-hardcode.mjs --strict` | 0 | `命中 0 处（白名单豁免 36；词表=org-config 0 条+宿主注册表 4 条）` | 豁免 36/14 ✓ |
| 钩子面 | 禁 git 操作，无法真触发 pre-commit；以三组成命令分别过作等效核对（validate 0/anchors 0/hardcode --strict 0，见上行与本表） | 0/0/0 | — | 等效 ✓ |

覆盖件基态：`根/.zcode/org-config.json` 不存在（ls exit 2）——变异用新建+用后删，还原=基态（diff 空）。

## 二、交付清单（按单元）

| 单元 | 文件 | 内容 |
|---|---|---|
| U1 | org-config.default.json | 新增三分区 dispatch_request（max_tokens/temperature+note）/regression_cfg（r1_sources+note）/anchors_exempt（project_names 六名+note），插在 hardcode_scan 之后、roles 之前，预裁决 A 原文 |
| U2 | scripts/ds-call-v2.mjs | 新增 loadDispatchRequest（装载点校验有限数值，缺段/非数值=ConfigError exit 3 点名分区与字段）；cliMain 于 nodeVersionGuard 后装载；buildRequest 第四参 reqParams，:188/:195 两 body 载荷改用配置值（anthropic/openai 两形态）；callSource 透传；dry-run 分支同步 |
| U3 | scripts/regression.mjs | R1 块 SOURCES 改读 merged.regression_cfg.r1_sources；缺段/空数组/名单<2 源/别名∉providers → record('R1', false, 点名原因)（守卫先于派发循环=零真实调用即 FAIL）；下游 verdicts 比较键随 srcA/srcB 泛化（自裁申报 3）；wantR1 假时 SKIP 分支未动 |
| U4 | scripts/check-anchors.mjs | import loadOrgConfig；PROJECT_NAMES 改由 deriveProjectNames(merged) 纯函数派生（缺段/非数组=exit 3，词表缺失族口径，stderr 点名 anchors_exempt）；主流程装载守卫在 --self-test 之后（自检不触真实装载）；--self-test 扩 2 向量（fixture 派生正例+缺段错误形态），16→18 |
| U5 | CHANGELOG.md / RESIDUALS.md / references/06 §8 / 本报告 | v1.7.4 条目四节（含 cfg_hash 变更申报 a26f710a540d→20254429f008）；evolve-m4-hardcode 翻 closed（commit <hash> 占位待主控回填）；06 §8 末尾 v2.4 一行（任务书原文） |

## 三、绿证（改后全实录）

| # | 命令（cwd=技能根） | 退出码 | 关键输出 |
|---|---|---|---|
| ① | `node scripts/org-config.mjs validate; echo exit=$?` | 0 | `validate PASS（3 源双校验通过，cfg:20254429f008）` |
| ② | `node scripts/org-config.mjs hash` | 0 | `cfg:20254429f008`（新哈希，对照表见 §五） |
| ③ | grep 字面量清零 | 1（无命中） | ds-call-v2.mjs 无 32768/0.2（注释+正文双查）；check-anchors.mjs 无六名；regression.mjs R1 块无 kimi-main/deepseek（残留 3 处 deepseek=R10 既有本地 mock fixture/注释，:251/:357/:448，改动前已在，非本批引入非 R1 点） |
| ④ | `node scripts/regression.mjs; echo exit=$?` | 0 | `8/8 过，SKIP ×1`；**R4 行实录：`cfg哈希一致=true（流水 20254429f008 vs live cfg:20254429f008）`**——新哈希行随 R5 mock 派发先于 R4 写入，自愈路径成立；R5 `exit=2(期2) attempt=12/12 switch=2/2 exhaust=1/1` 链行为不变 |
| ⑤ | `node scripts/check-anchors.mjs; echo exit=$?` | 0 | `WARN ×0 / FAIL ×0（扫描面=11 件）`——真实装载点名单后豁免面不增不减 |
| ⑥ | `node scripts/check-anchors.mjs --self-test; echo exit=$?` | 0 | `[self-test] 18/18 过` |
| ⑦ | `node scripts/ds-call-v2.mjs --role gate1-reviewer --dry-run <临时 prompt>` | 0 | JSON 含 `"cfg_hash": "20254429f008"`、`"chain"`、`"route_source": "chain"`（dry-run 无 stderr [routing] 行——该行属真实派发路径；补全链 mock 派发实录：`[routing] run=20260917010140-wxpc role=gate1-reviewer@fb86152e cfg=20254429f008 尝试源 1/3..2/3..3/3`+全源尽，3 条 [routing] 行均含新哈希，exit=2 期值，零成本） |
| 终扫 | validate+check-anchors+check-hardcode --strict（文档三件改后） | 0/0/0 | validate PASS cfg:20254429f008；anchors 0/0 面 11；hardcode 命中 0（豁免 36/14） |

## 四、变异红证（文件备份法：覆盖件系新建、基态不存在，用后删=还原 diff 空，`ls` 复核 exit 2）

**变异①（null 三分区）**：临时建 `根/.zcode/org-config.json`=`{"dispatch_request":null,"regression_cfg":null,"anchors_exempt":null}`（深合并显式 null=删除键）：

| 命令 | 退出码 | 实录（stderr 点名） |
|---|---|---|
| `ds-call-v2 --role gate1-reviewer --dry-run <p>` | **3** | `[fatal] org-config dispatch_request 分区缺失或非对象（现=undefined）——派发器请求参数单源（v1.7.4 m4 清偿），缺段=exit 3 无静默回退` |
| `node scripts/check-anchors.mjs` | **3** | `org-config anchors_exempt.project_names 缺段或非数组（现=undefined）——项目侧点名单单源（v1.7.4 m4 清偿），缺段=exit 3 无静默回退` |
| `node scripts/regression.mjs --only R1 --r1` | 1 | `FAIL R1 regression_cfg.r1_sources 缺段或非数组（org-config 单源，v1.7.4 m4 清偿）——R1 语义面失效，显式 FAIL 不静默跳过`；汇总 `0/1 过，FAIL ×1`；**零真实调用**（守卫先于派发循环）——所选形态=任务书首选（--only R1 --r1 + null 覆盖件），备选形态（r1_sources 空数组）未另行执行 |

删覆盖件 → `validate` 复绿（PASS cfg:20254429f008，exit 0）。

**变异②（点名单消费证）**：覆盖件=`{"anchors_exempt":{"project_names":[]}}` → `check-anchors` 出现路径缺失 WARN（试点 WARN 级口径退出码 0）：

```
[WARN] references/03-machine-enforcement.md:8 路径缺失 `scripts/run_gates.py`
[WARN] references/03-machine-enforcement.md:58 路径缺失 `__init__.py`
[WARN] references/05-porting-guide.md:85 路径缺失 `scripts/run_gates.py`
[WARN] references/05-porting-guide.md:86 路径缺失 `scripts/check-locks.mjs`
[WARN] references/05-porting-guide.md:86 路径缺失 `check-tickets.mjs`
[WARN] references/08-doc-governance.md:122 路径缺失 `scripts/check_model_names.py`
[WARN] references/08-doc-governance.md:123 路径缺失 `scripts/check-model-names.mjs`
check-anchors 汇总：WARN ×7 / FAIL ×0（扫描面=11 件）
```

WARN 计数 7>0=点名单被真实消费（置空即豁免失效）。删覆盖件 → 复绿（validate PASS；终扫 anchors 0/0）。

## 五、新旧 cfg 哈希对照

| 时点 | cfg_hash | 变更源 |
|---|---|---|
| 改前（基线） | `cfg:a26f710a540d` | — |
| 改后（U1 落盘后实跑） | `cfg:20254429f008` | org-config.default.json 新增三分区（规范化哈希含新键） |

可观察形态：任何派发 [routing] 行/流水 org_config_hash/账本 cfg_hash 自本批起=20254429f008；
缺段守卫的 exit 3 stderr 点名输出（§四）即新告警面。

## 六、自裁申报

1. **变异/实录期一次真实外呼（操作失误）**：取 mock 派发退出码实录时第二轮误以两点注入
   `--mock-source kimi-main:429,deepseek:500`（漏 kimi-backup，链内三源）→ kimi-backup 发生一次
   真实调用（prompt=短 noop「m4 mock drill」，成功 exit 0，正常落账）。违反本批「禁真实外呼」，
   如实呈报；随后已改全链三点注入复跑（exit=2 期值）。影响=一次最小载荷 Kimi 调用计费+一行 ok 账本。
2. **R1 守卫增「少于 2 源」判据**：任务书列缺段/空数组/别名∉providers 三点；单源名单会使
   verdicts 成对比较退化为误导性 FAIL，故加显式判据（消息点名），属超出字面的最小防御性补充。
3. **R1 下游比较键泛化**：regression.mjs 原 :436/:438 `verdicts['kimi-main']/['deepseek']` 为
   SOURCES 的下游消费点，随配置化一并改为 srcA/srcB（不改则名单可配而比较键仍钉死两名=半配置化）。
4. **绿证⑦形态注记**：--dry-run 路径无 stderr [routing] 行（dry-run 在链循环前 exit 0，设计如此）；
   以 dry-run JSON `cfg_hash` 字段+全链 mock 派发 stderr [routing] 行双实录达成任务书要旨。
5. **06 §8 新行位置**：按任务书字面加于节末尾；该节既有条目大体新者在前，新行居尾与倒序惯例稍异
   （遵任务书原文优先）。
6. **RESIDUALS 修订记节未加同步行**：任务书预裁决仅列 evolve-m4-hardcode 行翻 closed，未列修订记
   新行；不扩面（CHANGELOG v1.7.4 条即本批版本面记录）。
7. **基线「钩子过」核对方式**：禁 git 操作致无法真触发 pre-commit；以三组成命令分别过作等效核对
   （见 §一），未运行任何 git 命令。

## 七、回炉 1 轮（门一 W-1/W-2/N-1 终裁批内清偿）

| 项 | 改动 | 红证（全零外呼，真退出码） | 复绿 |
|---|---|---|---|
| W-1 mock 漏注射=静默真实调用洞 | ds-call-v2 callSource 开头：`mock && !(src.alias in mock)` → ConfigError（消息=`--mock-source 漏注射 <alias>——mock 模式缺注射即拒跑，防静默真实调用（门一 W-1，本批自裁 1 前科）`）；外层 cliMain catch 首行 `e instanceof ConfigError → rethrow`（防吞入换源/exhaust 链语义） | `--mock-source kimi-main:429`（仅一点，链 3 源）→ **exit=3**；stderr：`[routing] 换源 kimi-main → kimi-backup: HTTP 429 退避 3 次耗尽（mock）`+`[fatal] --mock-source 漏注射 kimi-backup——…`——链走到 kimi-backup 即拒跑，零外呼 | 复绿全套见 §七末 |
| W-2 重复别名守卫 | regression R1 守卫链「少于 2 源」判据后补 `new Set(SOURCES).size !== SOURCES.length` → FAIL（消息=`r1_sources 含重复别名——双源一致性退化为同源自比（门一 W-2）`，附现值） | 覆盖件 `{"regression_cfg":{"r1_sources":["kimi-main","kimi-main"]}}` → `--only R1 --r1` → **exit=1**，`FAIL R1 r1_sources 含重复别名（现=[kimi-main,kimi-main]）…`（守卫先于派发循环=零外呼）；删覆盖件 → validate PASS（exit 0） | ✓ |
| N-1 装载守卫对齐 | check-anchors 主流程 loadOrgConfig 包 try/catch：抛错 → stderr 一行 `[fatal] org-config 装载失败（check-anchors 主流程）: <msg>（06 §5.8 行 3=配置/装载错）`+exit 3（对齐 ds-call-v2 ConfigError 惯例） | 覆盖件写坏 JSON `{ 坏 JSON（N-1 注入）` → **exit=3**，`[fatal] org-config 装载失败…JSON 解析失败…`；删覆盖件 → anchors 0/0（exit 0）。轻量触发路径=坏 JSON 覆盖件（存在，无需记「无路径」自裁） | ✓ |

回炉后复绿全套（真退出码）：validate=0（cfg:20254429f008 不变——回炉零配置面变更）；hash=0；
check-anchors=0（0/0 面 11）；--self-test=0（**18/18 向量数不变如实保留**）；check-hardcode
--strict=0（命中 0，豁免 36/14）；regression=0（8/8 过 R1 SKIP；R5 全链 mock exit 2 计数
12/2/1 不变=W-1 守卫不误伤全注射形态；R10 B1 向量仍过=ConfigError 直通不破坏既有错误面）；
dry-run=0（cfg_hash=20254429f008）。

自裁申报补记（回炉轮）：
8. **W-1 消息文本微扩**：终裁消息原文后附「（本批自裁 1 前科）」等定语即任务书原文，未扩；
   W-2 消息在终裁文本后附 `（现=[…]）` 现值列表——便于对账，主体文本未改。
9. **R4 流水分布变化说明**：回炉后 R4 行事件分布较首绿多 `ok:1/switch:14`——系首绿后自裁 1
   误真实调用（ok 行）+W-1 红证 switch 行入流水（历史行不改写，08 §3），行 schema 完整
   校验通过，非回炉引入的坏行。

## 八、结论

三点硬编码全数收编 org-config 三分区，值不变纯迁址+缺段 exit 3/FAIL 守卫落地，自检 16→18 向量，
evolve-m4-hardcode 翻 closed；回炉 1 轮三项（W-1 漏注射拒跑/W-2 重复别名/N-1 装载守卫）批内
清偿完毕（§七）。门禁终态=regression 8/8+anchors 0/0（面 11）+self-test 18/18+
hardcode 命中 0（豁免 36/14）+validate PASS。commit 哈希由主控收口后回填 RESIDUALS 占位。

MODEL-SELF: model-field:builtin:bigmodel-coding-plan/GLM-5.3
LEDGER-CLAIM: role=ops-executor executor=model-field:builtin:bigmodel-coding-plan/GLM-5.3 units=6 outcome=done
