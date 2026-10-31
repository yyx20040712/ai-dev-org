---
name: ai-dev-org
description: Use when 用户提出开发/实现/修复/重构/批次/开工/简报/工单/派发/审计/结项/交付类请求，或涉及模型路由/额度/切换承载源/供应商/体验套餐决策，或出现组织/岗位/分工/角色卡/输入边界/主控/建单/排期/汇报/成本账本/环境限制待补登记等组织协作症状时加载本技能。Not for 纯问答或单行修复。
---

# AI 开发公司组织操作系统（ai-dev-org）

## 概述

跨项目通用的「AI 软件开发公司」组织规范。四根支柱：岗位清单、模型路由、输入边界协议、成本纪律。
第一性原理只有一条——执行者必然犯错，组织设计的目标是让错误在合入前现形、让每个决定可追溯。

用户只对接一个岗位：主控，其余岗位一律由主控调用（铁律见 references/06 §2）。本技能是 loop-engineering 的升级替代件（前任沿革注记=references/06 卷首；历史承载=git 提交历史）。

## 岗位速查（全属性终表单源=references/07 §1——本表仅岗名×通道索引，增岗随账本裁决行随动）

| 岗位 | 通道 |
|---|---|
| 主控（+PM 子模式） | 主会话（唯一用户对接岗） |
| 规划岗 drafter | 会话内绑定子代理 ops-drafter（699 短名源承载） |
| 任务书装配岗 assembler | 会话内绑定子代理 ops-assembler-{699,yyx,zipoo}-max（默认 699·ruling-assembler-role-spec） |
| 实现岗 | 会话内子代理（诊断取证职责并入——07 §1） |
| 任务书审核岗 tbreview | 会话内绑定子代理 ops-tbreview-*（默认 ds；派发前任务书审包，D21） |
| 规划审核岗 planreview | 会话内绑定子代理 ops-planreview-*（默认 ds；路线/重批设计件按需对抗审核） |
| 执行者审核岗 implreview | 会话内绑定子代理 ops-implreview-*（常设双审 699＋ds；默认与回退序单源=矩阵 06 §1） |
| 实证裁决岗（双部制） | 会话内子代理：实证部＋裁决部（07 §1） |
| 审核岗 auditor-readonly | 会话内绑定子代理 ops-implreview-ds-max（deepseek 承载） |
| 设计岗 design-reviewer | 会话内图像通道（外呼位=glm-look，细则=07 §4 设计岗卡） |

（表注/tier 记法/禁令/职责/交接物一律看 07 §1，本表不复制。）供应商事实（源序、端点、套餐、配给）
单源=org-config 三层装载：通用默认件←本机件 `org-config.local.json`（个人实值，gitignore 不随分享包）
←项目覆盖件 `.zcode/org-config.json`（06 §0），本件零硬编码。会话内子代理没有 model 参数属环境限制
（宿主事实单源=references/10 §2）：如实按「意图档位声明＋环境限制统一档」记待补登记（账本强制输出项），
禁止伪装已定档。

## 派发与自检（scripts/）

除主控外全部岗位=会话内子智能体承载（设计岗走图像通道——07 §1）；账本事件=主控补记单源
（02 §9）；glm-look（设计岗视觉外呼）=工具、不属岗位。

```
node scripts/org-config.mjs [resolve|hash|validate|--self-test]
node scripts/agent-slots.mjs list|show|resolve --route "<route 串>"|select|gen|enable|disable|preset|doctor|sync   # ROUTE 提示词路由与矩阵待位（写法单源=references/02 §8.1）
node scripts/check-hardcode.mjs [--strict]   # .md 正文供应商 live 事实扫描（名单从 org-config 派生；缺省命中=RED 退出（hardcode_scan.strict 默认 true）；--warn=试点校准期显式降级）
node scripts/check-anchors.mjs [--update|--strict]   # 08 §4 文档腐化体检机检化：NN §M 断锚+路径存在性+01/04 条目计数 vs doc-counts golden（WARN 试点校准期；计数失守=FAIL；--update=重冻结随批提交）
node scripts/check-taskbook.mjs <任务书.md> [--root <dir>]... [--strict|--json|--self-test]   # 任务书派发前自检：路径存在性/行号越界与逐字核对/白名单与禁改互斥/命令脚本存在性/零命中判据与逐字块互斥/退出码契约/结构等（WARN 试点；FAIL 退 1）
node scripts/skill-gc.mjs [--apply --delete-redirects|--delete-invalid]   # 技能目录盘点/清理（默认干跑；删除先归档可回滚；active 技能去留=用户裁决不机删）
node scripts/check-constitution-budget.mjs <AGENTS.md>   # ORG-SEG ≤600 非空白字符
node scripts/init-defenses.mjs --target <项目根> --stack <npm-verify|pnpm-pygates|generic> [--yes]   # 新项目首周防线脚手架（05 §4）
node scripts/regression.mjs [--only R4,R7,R8,R10] [--project <dir>]   # 自包含回归（R 清单单源=本脚本）
node scripts/health-scan.mjs [--project <dir>] [--budget <alias>:<maxOutTokens>]   # 结项前健康扫描（RED=0 方可结项；告警分类单源=02 §10）
node scripts/log-triage.mjs [--date YYYY-MM-DD|--hours N] [--health]   # 观测面分诊：cli/log+glm-look/历史派发流水两账并呈——五类分诊/attempt 放大/静默回退检测（声明≠实际=RED）/岗×源用量（Kimi 双源分列）/finish 终态派生；--health=源健康检查出双审两席派发推荐（额度类→切换承载源；504 窗口类→不切换承载源、瘦身重试）+常设双审对绑定同族核对（R3）+跨门岗对核对
node scripts/glm-look.mjs --prompt <判据.md> <图1.png> [图2…] [-o 报告.md] [--channel glm|ds]   # 设计岗外呼看图双通道（通道/模型/端点甄别=org-config vision_channels 分区+--list-sources；单次调用 20min 上限、非429的4xx立断、scrub 脱敏；max_tokens≥8000 自动倍升防推理段耗额假成功；三段流定式：glm 判读→ds 审核提异见→glm 终裁）
node scripts/package-skill.mjs --out <空目录> [--self-test]   # 分享打包：git 跟踪面导出+分享面门禁（uuid/盘符路径/本机标识零命中）+MANIFEST——受赠机首跑与白名单=PACKAGING.md
```

**单批路由 ROUTE（写法单源=references/02 §8.1）**：任务书/工单开头写一行
`ROUTE: executor-glmflash;implreview-699`——每项 `<role>-<provider>`、分号分隔，
未列岗位走矩阵默认；解析与静态校验=`agent-slots.mjs resolve`；单批生效、不改矩阵。
**子代理绑定通道（06 §6 补遗＋07 §4 补遗；宿主语义细则单源=references/10 §2）**：绑定件=矩阵单源
（templates/agents.matrix.json→gen-agents 生成 `~/.zcode/agents/ops-*.md`，指针=07 §4 补遗）。frontmatter model=`<provider>/<model-key>$<档位>`
——模板面存 `{{binding:岗}}` 占位、部署面=org-config 本机件 `agent_bindings` 渲染实值；`$` 后缀=显式思考
档位声明，缺省即派发拒启 reasoning-level-missing（实证=references/10 §2）。

现役绑定件一律 `$max`；上游枚举值=假绑定禁用；空 tools=泄漏全工具面禁用；代理档案会话启动快照无热加载——改档须新会话验证＋`log-triage.mjs` 日志核对零回退。

矩阵各岗绑定面全绑（绑定件=矩阵单源，指针=07 §4 补遗）：派发对象=矩阵登记的 ops-* 绑定代理——
系统默认代理（general-purpose 等跟随宿主、无绑定）禁承载矩阵岗，误派即停、按矩阵默认重派并
账本留痕；唯一例外=实证裁决岗实证部（无绑定件·随宿主承载·意图档位声明＋账本 session:host-tier）。
绑定纪律与 `$max` 档位约束全部设 model 字段的岗；改绑=用户裁决位。

子代理失败接续纪律=杀岗→`log-triage.mjs --health` 归因→额度类切换承载源继任（读进度落盘）/
窗口类同源瘦身/无工具岗同包重跑（runbook 真源=references/06 §6 补遗二）。
org-config 源装载双校验（uuid_prefix+entry_name）不符即 exit 3，无 fallback。

宿主 Node 25 兼容面（libuv 退出崩溃实证/Node 24 规避/守卫）单源=references/10 §1——外部模型调用
（外呼脚本）一律用 Node 24 跑，脚本启动时带版本守卫。**传输层与超时（06 §5.7）**：node:http(s) 直连（弃
global fetch——undici headersTimeout≈300s 是非流式长推理客户端侧隐形杀手）、signal=唯一超时源、
后台调用上限 20 分钟；499=客户端中断族——排障先三层分诊勿直断服务端宕。

**审包纪律（04·ORG-12）**：审包体积=派发时效主变量——旧注册表巨行/宪法全文/methodology diff/变异
原始件默认剔除，简报输出段设产出预算硬约束。**产出面纪律（08 §6）**：入项目仓工件（命名/内容/
commit message）零外部模型代号与 AI 指称，审档默认归宿=仓外历史区。

运行流水=`scripts/model-routing-log.jsonl`（字段口径见 references/06 §5）；项目账本=
`.zcode/org-ledger.jsonl`（行 schema **单源=references/02 §9**——本件与模板一律持指针，禁内联字段
清单——01·A3；regression R7 正向校验）。tier 记法：有 roles 条目的绑定岗（代码审查岗/规划岗/审核岗）取 org-config
`roles.<role>.tier`（意图档位，承载=frontmatter 绑定）；其余绑定岗与会话内岗记 `session:<档位描述>`（细则=references/07 §4）。

（scripts/ 路径相对技能根=本文件所在目录；zcode 加载本技能时附基目录。）

## 加载地图（references/，按需读勿全量）

00 术语速查+新手上手图 ｜ 01 原理 A~E 五组 ｜ 02 管道 12 步+任务书七段+返工规则+数据专轨+适配注记 ｜
03 机器强制 ｜ 04 教训库 WP/SY/MG/ORG 四系 ｜ 05 移植指南+差异回灌协议 ｜
06 模型路由+承载切换+外呼记账（外部派发器已删） ｜ 07 角色卡终表+主控 PM 四子模式 ｜
08 文档群治理（事实分层/指针化手册/历史件处置/体检/产出入仓纪律） ｜ 09 产品文档面（需求五问/手册骨架/API 锚定生成物/tech-writer 子模式） ｜
10 宿主兼容事实单源件（宿主版本耦合——实证戳+异机重验清单）。
条目型指针（如 `01·A3`、`04·SY-1`）指对应条目组；01/04 条数单源=`scripts/.golden/doc-counts.json`
（check-anchors 对账，正文不落数字——A3 防双源）。
历史件按需查、勿随技能常载：修订记/批档/迁出原文=开发方工作区历史文档区与技能仓 git
提交历史（不随分发面）；当前登记=技能根 RESIDUALS.md。
新机部署与一键自检=DEPLOY.md（根目录）＋deploy-check.mjs（--install 补代理/钩子/派生覆盖件）；
首激活向导（模型绑定→validate→sync-agents→面板启动）与跨技能模组引用检索=DEPLOY §7；面板=panel/
（入仓参数化：根路径由脚本位置推导·零绝对路径·用法=panel/README.md）。

## 红旗（出现即停）

- 跳过 intake 五问直接开工 ／ 给代码审查岗的包里含任何仓库访问信息
- 岗位实例自设输入通道墙拒收派发包（通道异议=向主控申报由主控裁，细则=06 §6 补遗三）
- 切换承载源时放宽任务书或 DoD ／ 源尽不记待补登记假装审过
- 任务书未过两道闸（机检＋审核岗）即派发 ／ 审核 FAIL 后未改就派发
- 子代理「已定档」却无待补登记行 ／ ORG-SEG 段超预算未跑自检即派发
- 本项目已有组织段时整抄通用 stub（双组织段=双源）
- 入项目仓工件带外部模型代号/AI 指称，或审档未中性化直接入仓
  （产出面纪律=08 §6；项目仓门禁执法）

## 对抗链触发表（grillme 机关——派发前自检，未过不得结项）

| 批次类型 | 强制对抗位（缺一=对抗链未过） |
|---|---|
| 实现批 | 代码审查岗不同模型族隔离审＋实证裁决岗实证终审（02 §2 步骤 6/7） |
| 文档/制度批 | 轻量双审（02 §3） |
| 数据批 | 独立复算＋专家追认（02 §6） |
| 路线级设计 | 三段通道：拟定＋对抗审核＋主控终裁（06 §1） |
| 已审面修改 | 该面随批重过——给首审档呈 diff，「改了就要再审」（08 §7 惯例） |
| 单点配置变更批（org-config/路由/配给；改 1 个配置件 ≤10 行） | 代码审查岗单审＋主控亲验全机检矩阵 |
| 其余纯配置变更批 | 按「已审面修改」处理：该面随批重过——配置 diff＋预期行为变化呈 auditor-readonly 复核 |
| 结项/交付批 | 对抗链证据随汇报包复核：各对抗位报告＋health-scan RED=0＋基线数字对账＋入仓工件污染面零命中（08 §6——项目仓门禁＋命名过目） |

复合批取命中各行对抗位的**并集**：一个批次踩多类，逐类全过，禁择一。

**分级规则**：「小批」=纯文档/纯注释批且改动 ≤3 文件、无逻辑行变更→代码审查岗单审＋
主控亲验全机检矩阵；单点配置批=改 1 个配置件的 ≤10 行变更→同前。**生成物豁免**：单一
生成源再生产物（禁手编——如 `gen_status` 再生成的 status.md）不入小批人工面文件计数，即
≤3 文件按人工面计（生成源=唯一人工面；随批再生成的漂移=机检面非人工面）。

前提：该生成物已挂再生产一致性机检——重跑生成源与提交物逐字节对账（如 gen_status --check /
check-anchors --strict）；未挂机检的生成物不得援引本豁免。**其余一切批次（实现/结项/跨件/
涉脚本/涉禁止项/复合批）仍取全对抗位（常设双审两席，复合批按并集）**。

前端任务设计稿（文本形态）拟定可派 Kimi（经规划岗通道，细则=07 §1 规划岗行＋06 §1＋06 §3）。
额度受限期的替代组合：代码审查岗单审＋不同模型族代位审（异源岗代位＋申报入档，如
实证裁决岗代审第二席）＋主控亲验——例外须申报，不得静默降级。

**审包预算纪律扩面至子代理通道**（04·ORG-12 同款）：自包含包输入面 ≤8k tokens，可指针化的
既有事实（golden/契约/先例文本）不内联——审包体积=额度主变量（单批 subagent tokens 随包体
放大）；代位审包不自带实件自由读授权，否则 token 级失控。

**N 级返工免审口径**：返工处置项全为 N 级=主控亲笔＋全机检＋实证裁决岗行为佐证即可结项
（免代码审查岗复审），W/B 级仍须复审；N 级处置触及已审面仓内文件=该面仍随批重过；免审处置逐条落批档可审计——细则单源=references/02 §5。

派发前自检四问：①本批命中表中哪些对抗位？②各位源可用且与实现者不同模型族吗？③待补
登记清单有无本批必须补还项？④任务书是否已过机检与审核岗？结项前必跑
health-scan.mjs（RED=0 方可结项，告警分类细则=02 §10）。**主控简报中的关键假设须显式标注
「假设」并请对抗位拷问——假设未被拷问=对抗链未过。**

## 团队化边界与扩展位（显式化——不假装解决）

- 岗位清单=单人开发者＋AI 组织（10 岗＋人类用户裁决位；2026-10-29 B2 批三审拆岗与诊断退役随动）：主控单写账本、单一 git 历史、
  单裁决通道——未覆盖多人团队场景（并行 PR 流、代码所有权分区、多主控协调、多人互审）。
- 两个已知扩展位（均为用户未来裁决位，现不实现）：①裁决代表制——多人时谁握「用户
  裁决位」；②分支模型——共享 main 还是短命 feature 分支＋门审前置。触发条件=真实
  多人协作出现，届时按 05 §6 差异回灌协议提交设计案再动。

## 常见借口对照

| 借口 | 现实 |
|---|---|
| "这次太小不用走组织流程" | 小改动照样出过已登记事故（04·ORG-14）——"小"不免检 |
| "换了承载源，要求降一点" | 任务书与 DoD 不随切换承载源放宽（06 §4） |
| "子代理大概用了对的模型" | 未绑定子代理无 model 参数=环境限制，如实记待补登记 |
| "输入边界灵活一点效率高" | 喂什么=岗位边界，灵活化=已登记禁止项（01·E2） |

## 版本与状态

- 当前版本=v3.2.2。本技能不内载时间与批次史：版本演化与历史记录=技能仓 git 提交历史＋
  开发方工作区（主仓 docs/ 与 history/），技能正文不维护沿革叙述。
- 残留登记=RESIDUALS.md（触发处置行＋新登记行）。
- 新项目移植后首场压力场景复测（05），结果回填 RESIDUALS 新登记行。
