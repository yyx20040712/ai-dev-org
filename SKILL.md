---
name: ai-dev-org
description: Use when 用户提出开发/实现/修复/重构/批次/战役/开工/简报/工单/派发/审计/收口/交付类请求，或涉及模型路由/额度/换源/供应商/体验套餐决策，或出现组织/岗位/分工/角色卡/部门墙/主控/立案/排程/呈报/成本账本/环境限制欠账等组织协作症状时加载本技能。Not for 纯问答或单行修复。
---

# AI 开发公司组织操作系统（ai-dev-org）

## 概述

跨项目通用的「AI 软件开发公司」组织规范，四根支柱：岗位编制、模型路由、
部门墙协议、成本纪律。第一性原理只有一条——执行者必然犯错，所以组织
设计的目标是让错误在合入前现形、让每个决定可追溯。

用户只对接一个岗位：主控。其余岗位一律由主控调用（铁律见
references/06 §2）。本技能是 loop-engineering 的升级替代件（组织视图与
管道视图合并，旧件已归档于 `~/.zcode/skills/_archive/
loop-engineering-archive-2026-09/`——路径相对 skills 根，非技能根）。

## 岗位速查（全属性终表单源=references/07 §1——本表仅岗名×通道索引，禁增列）

| 岗位 | 通道 |
|---|---|
| 主控（+PM 子模式） | 主会话（唯一用户对接岗） |
| 拟定者 drafter | 派发器 `--role drafter` |
| 实现者 | 会话内子代理 |
| 门一 gate1-reviewer | 派发器 `--role gate1-reviewer` |
| 门二 | 会话内子代理 |
| 审核者 auditor-readonly | 派发器 `--role auditor-readonly` |
| SRE 诊断岗 sre-diagnostic | 会话内只读子代理 |
| 设计岗 design-reviewer | 会话内图像通道（外呼位=glm-look，细则=07 §4 设计岗卡） |

（编制表注/tier 记法/禁令/职责/交接物一律看 07 §1，本表不复制——v1.7.5 收敛。）

供应商事实（源序、端点、套餐、配给）一律看 org-config（默认件 + 项目
覆盖件 `.zcode/org-config.json`），本件零硬编码。会话内子代理没有
model 参数属环境限制：如实按「意图档位声明 + 环境限制统一档」记欠账
（账本强制输出项），禁止伪装已定档。

## 派发与自检（scripts/）

```
node scripts/ds-call-v2.mjs --role <id> [--source <alias>] [--project <名>]
     [--dry-run|--list-roles|--list-sources] [--mock-source <alias>:<status>]
     <prompt文件> [输出文件]        # --role 必填（v1 内嵌提示已废止）
node scripts/org-config.mjs [resolve|hash|validate|--self-test]
node scripts/check-hardcode.mjs [--strict]   # .md 正文供应商 live 事实扫描（名单从 org-config 派生；命中=WARN，--strict 按 RED 退 1）
node scripts/check-anchors.mjs [--update|--strict]   # 08 §4 文档腐化体检机检化：NN §M 断锚+路径存在性+01/04 条目计数 vs doc-counts golden（WARN 试点校准期；计数失守=FAIL；--update=重冻结随批提交）
node scripts/skill-gc.mjs [--apply --delete-redirects|--delete-invalid]   # 技能目录盘点/清理（默认干跑；删除先归档可回滚；active 技能去留=用户裁决不机删）
node scripts/check-constitution-budget.mjs <AGENTS.md>   # ORG-SEG ≤600 非空白字符
node scripts/init-defenses.mjs --target <项目根> --stack <npm-verify|pnpm-pygates|generic> [--yes]   # 新项目防线日脚手架（05 §4）
node scripts/regression.mjs [--only R2,R5,R4] [--r1] [--update-golden] [--project <dir>]   # 自包含回归（06 §5 R 清单内化；R1 真实派发须 --r1）
node scripts/health-scan.mjs [--project <dir>] [--budget <alias>:<maxOutTokens>]   # 收口前健康扫描（RED=0 方可收口；告警分类单源=02 §10）
node scripts/log-triage.mjs [--date YYYY-MM-DD|--hours N] [--health]   # 观测面分诊（B-0）：cli/log+派发器流水两账并呈——五类分诊/attempt 放大/静默回退检测（声明≠实际=RED）/岗×源用量（Kimi 双源分列）/finish 终态派生；--health=源健康检查（A'③）出 k1/k2 派发推荐（额度类→换源；504 窗口类→不换源瘦身）
node scripts/glm-look.mjs --prompt <判据.md> <图1.png> [图2…] [-o 报告.md] [--channel glm|ds]   # 设计岗外呼看图双通道（通道/模型/端点甄别=org-config vision_channels 分区+--list-sources；单次调用 20min 上限、非429的4xx立断、scrub 脱敏；max_tokens≥8000 自动倍升防推理段耗额假成功；三段流定式：glm 判读→ds 审核提异见→glm 终裁）
```

**子代理绑定通道（2026-09-16 起，06 §6 补遗+07 §4 补遗）**：文本岗/
异构岗/门一双源已挂 `~/.zcode/agents/ops-*.md` 绑定子代理（frontmatter
model=`<provider>/<model-key>$<档位>`——`$` 后缀=显式思考档位声明，缺省
即派发拒启 reasoning-level-missing（2026-09-17 宿主代码实证），现役档案
一律 `$max`；上游枚举值=假绑定禁用；空 tools=
泄漏全工具面禁用；代理档案会话启动快照无热加载——改档须新会话验证+
`log-triage.mjs` 日志核对零回退）。**2026-09-19 用户裁决**：原 GLM 绑定三岗（实现者/门二实证部/
SRE 诊断=ops-executor/probe/diagnostics）改**随宿主会话模型**——未绑定
形态（无 model 字段=回落宿主默认/coding plan 服务商），账本记
`session:host-tier`+E3 欠账行恢复；绑定纪律与 `$max` 档位仅约束设
model 字段的岗（现役=门一 k1/k2+裁决部三件，异构对抗位不动）。
外部派发器=健康探针+后备通道，
不拆除（迁移期双承载，org-config roles.*.migration_note）。子代理失败
接续纪律=杀岗→`log-triage.mjs --health` 归因→额度类换源继任（读进度
落盘）/窗口类同源瘦身/无工具岗同包重跑（runbook 真源=references/06
§6 补遗二——selfiter 批迁入技能内）。

无 `--role` 报错；源装载双校验（uuid_prefix+entry_name）不符即 exit 3，
无 fallback。宿主 Node 25（已证档）下 ds-call-v2 在退出阶段有 libuv
断言崩溃（RESIDUALS/HOST-node25）——外部派发一律用 Node 24 跑，脚本
启动时带版本守卫。**传输层与超时（v2.2.1，06 §5.7）**：node:http(s)
直连（弃 global fetch——undici headersTimeout≈300s 是非流式长推理
客户端侧隐形杀手）、signal=唯一超时源、后台调用上限 20 分钟（用户
指令 2026-09-16）；499=客户端中断族——排障先三层分诊勿直断服务端宕。
**审包纪律（ORG-12）**：审包体积=派发时效主变量——registry 巨行/
宪法全文/methodology diff/变异 raw 附默认剔除，简报输出段设产出预算
硬约束。**产出面纪律（08 §6）**：入项目仓工件（命名/内容/commit
message）零外部模型代号与 AI 指称，审档默认归宿=仓外档案区。

运行流水=`scripts/model-routing-log.jsonl`（字段口径见 references/06 §5）；
项目账本=`.zcode/org-ledger.jsonl`（行 schema **单源=references/02 §9**——
本件与模板一律持指针，禁内联字段清单，A3；regression R7 正向校验）。
tier 记法：外部岗取 org-config
枚举，会话内岗记 `session:<描述>`（见 references/07 §4）。

（scripts/ 路径相对技能根=本文件所在目录；zcode 加载本技能时附基目录。）

## 加载地图（references/，按需读勿全量）

00 术语速查+新手上手图 ｜ 01 原理 A~E 五组 ｜ 02 管道 12 步+任务书七段+回炉+数据专轨+适配注记 ｜
03 机器强制 ｜ 04 教训库 WP/SY/MG/ORG 四系 ｜ 05 移植指南+差异回灌协议 ｜
06 模型路由+换源状态机+派发器 v2 ｜ 07 角色卡终表+主控 PM 四子模式 ｜
08 文档群治理（事实分层/指针化手册/历史件红线/体检/产出入仓纪律） ｜
09 产品文档编制面（需求五问/手册骨架/API 锚定生成物/tech-writer 子模式）
（01/04 条数单源=`scripts/.golden/doc-counts.json`，check-anchors 对账，
正文不落数字——A3 防双源）

档案件（按需查、勿随技能常载）：历史版本史/残留册全量/批档=
`~/.zcode/skills/_archive/ai-dev-org-history-2026-09/`（65 件 sha256 对账
归档，selfiter 批 B3；路径相对 skills 根）。在册触发器与后续新登记=本
目录 RESIDUALS.md（薄册）。
新机部署与一键自检=DEPLOY.md（根目录）｜ scripts/deploy-check.mjs（--install 补代理/钩子/派生覆盖件）。

## 红旗（出现即停）

- 跳过 intake 五问直接开工 ／ 给门一的包里含任何仓库访问信息
- 换源时放宽任务书或 DoD ／ 源尽不记欠账假装审过
- 子代理「已定档」却无欠账行 ／ ORG-SEG 段超预算未跑自检即派发
- 本项目已有组织段时整抄通用 stub（双组织段=双源）
- 入项目仓工件带外部模型代号/AI 指称，或审档未中性化直接入仓
  （产出面纪律=08 §6；项目仓门禁执法）

## 烤验触发表（grillme 机关——派发前自检，未过不得收口）

| 批次类型 | 强制对抗位（缺一=烤验未过） |
|---|---|
| 实现批 | 门一异构隔离审 + 门二实证终审（02 §2 步骤 6/7） |
| 文档/制度批 | 轻量双审（02 §3） |
| 数据批 | 独立复算 + 专家追认（02 §6） |
| 路线级设计 | 三段通道：拟定 + 对抗审核 + 主控终裁（02 §8.6） |
| 已审面修改 | 该面随批重过——给首审档呈 diff，「改了就要再审」（08 §7 惯例） |
| 纯配置变更批（org-config/路由/配给） | 按「已审面修改」处理：配置 diff+预期行为变化呈 auditor-readonly 复核（W5 审 B' 双源 B1） |
| 收口/交付批 | 烤验证据随呈报包复核：各对抗位报告 + health-scan RED=0 + 基线数字对账（W5 审 ds-B1）+ 入仓工件污染面零命中（08 §6——项目仓门禁+命名过目） |

复合批取命中各行对抗位的**并集**：一个批次踩多类，逐类全过，禁择一。

派发前自检三问：①本批命中表中哪些对抗位？②各位源可用且与实现者
异构吗？③欠账清单有无本批必须补还项？收口前必跑
`node scripts/health-scan.mjs --project <dir>`（RED=0 方可收口，
告警分类细则=02 §10）。**主控简报中的关键假设须显式标注「假设」并请
对抗位拷问——假设未被拷问=烤验未过。**

## 团队化边界与扩展位（显式化——不假装解决）

- 本技能编制=单人开发者 + AI 组织（8 岗 + 人类用户裁决位）：主控单写
  账本、单一 git 历史、单裁决通道——**未覆盖多人团队场景**（并行 PR
  流、代码所有权分区、多主控协调、人人间评审）。
- 团队化的两个已知扩展位（均为用户未来裁决位，现不实现）：①裁决
  代表制——多人时谁握「用户裁决位」；②分支模型——共享 main 还是
  短命 feature 分支+门审前置。触发条件=真实多人协作出现，届时按
  05 §6 差异回灌协议呈报设计案再动。

## 常见借口对照

| 借口 | 现实 |
|---|---|
| "这次太小不用走组织流程" | 在册事故多出自"小改动"（04·SY-1） |
| "换源了，要求降一点" | 任务书与 DoD 不随换源放宽（06·§4） |
| "子代理大概用了对的模型" | 无 model 参数=环境限制，如实记欠账 |
| "部门墙灵活一点效率高" | 喂什么=岗位边界，灵活化=在册红线（01·E2） |

## 版本与状态（selfiter 批 B3 起自含——历史指针化）

- **当前版本=v2.0.2（2026-09-19 escaped-defect ①② 修复批）**：清偿
  batch-relay-prod 战役登记的两项 org 侧逃逸——①派发器 parseFindings
  verdict 字符集 [A-Za-z]→字母∪CJK（与 auditor-readonly DoD 中文词表
  放行|有条件放行|返工 结构性失配=auditor 尾栏永不附着+health-scan ⑥
  连锁误 RED；v2.3.2）；②health-scan ⑥ 执法面拆挂 org-config 新字段
  `roles.<id>.findings_surface`（原 audit_surface 一标志双语义，把无
  尾栏 DoD 的拟定岗拉进执法面=每行真实 drafter ok 永久误 RED；④截断
  执法面不动）。R10/health-scan 向量按各岗 DoD 词表补齐（逃逸根因=
  向量从解析器假设出发而非 DoD 契约）。战役项目 residual RED 实测归零。
  回炉轮1（门一 k1 PASS B0/W2/N4、auditor-readonly 有条件放行 B1/W5/N3）：
  B-1 全串捕获证伪；W-2/W-3 实修=org-config validate 增 validateRoleSurfaces
  （findings_surface⇔DoD 尾栏双向机检，挂错/漏挂 exit 3）；W-5 登记
  RESIDUALS 触发器 edfix-r1-e2e-gap。回炉轮2（auditor 二轮 B0/W4/N4）：
  W-1 差集向遍历+W-2 尾栏行首锚定+W-4 挂入派发 loadSources 前置（运行期
  强制拒启）+W-3 人工回填例外条款成文（02 §9）+N 全采纳；两轮上限收口，
  终态=k1 B0/W0/N4 PASS（W1/W2 补证闭环）+probe 7/7+auditor B1→B0 收敛。
  k1 二过（delta B0/W1/N3 PASS）：W1=R5 补执法面拒启 exit3 集成行为锁
  向量；N1=hasTail 全形代理；N3=健壮性可选链——全实施，N2 记档。
- v2.0.1（2026-09-17 修复批）：外部全局对抗审出 7 中+18 低
  脚本缺陷与 2 处文档双源漂移全数清偿——派发器 stdout 产物路径改自然退出/
  log-triage switch 死数据收割+②段输出+窗口互斥/regression 期望配置源对齐+
  R10 注入面零触碰共享件/四脚本 cliFlag 收编/org-config CLI 装载守卫/
  glm-look 截断重试词表化+倍升记账修正；07 runbook 指针与 06 §5.7 新旧
  两说更正；三件 GLM 绑定模板对齐宿主 account: 前缀。门一=Kimi 双源独立
  全局审双 PASS（绑定子代理通道受阻按 06 §6 补遗二 runbook 换外部派发器
  承载，用户裁决 2026-09-17）。
- v2.0（2026-09-17 selfiter 收口批落章）：自我迭代七批闭环
  （B1 代码卫生 14 项/B2 文档收敛/B3 历史归档纯净化/B4 账本写入器 v3/
  B5 SSE 流式化/B6 hardcode 升 RED/B7 收口）——四组用户裁决（git 不压平/
  R1 真跑/轮转保尾/D 类全实施）全数兑现。
- v1.0→v1.7.6+selfiter 前段版本史/各批修订记=归档件（`~/.zcode/skills/
  _archive/ai-dev-org-history-2026-09/CHANGELOG.md`，路径相对 skills 根）；
  v1.0 冻结（用户裁决 2026-09-10）的条件、资格与裁决档指针=该件 v1.7.2 迁入
  存档段。
- selfiter 批起版本演化=git 提交信息（分笔可回溯）+归档区批档+薄册新登记，
  不再维护仓内 CHANGELOG（技能仓零过程件纪律，08 §6 规则 4）。
- 残留欠账=RESIDUALS.md（薄册：触发器行+新登记）；历史全量=归档区同名件。
- 新项目首场战役按 05 移植后做压力场景复测，结果回填仓外批档与薄册修订记。
