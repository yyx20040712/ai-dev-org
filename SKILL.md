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
| 拟定者 drafter | 会话内绑定子代理 ops-drafter（kimi-third 座，2026-10-03 派发器退役批迁入） |
| 实现者 | 会话内子代理 |
| 门一 gate1-reviewer | 会话内绑定子代理（常设双审 ops-gate1-k1+d1；k2=额度兜底（kimi-backup）；ops-gate1-k3=源A深备） |
| 门二（双部制） | 会话内子代理：实证部＋裁决部（07 §1） |
| 审核者 auditor-readonly | 会话内绑定子代理 ops-auditor（deepseek 座，2026-10-03 派发器退役批迁入） |
| SRE 诊断岗 sre-diagnostic | 会话内只读子代理 |
| 设计岗 design-reviewer | 会话内图像通道（外呼位=glm-look，细则=07 §4 设计岗卡） |

（编制表注/tier 记法/禁令/职责/交接物一律看 07 §1，本表不复制——v1.7.5 收敛。）

供应商事实（源序、端点、套餐、配给）一律看 org-config（三层装载：
通用默认件←本机件 `org-config.local.json`（个人实值，gitignore 不随
分享包——v2.1.0 批）←项目覆盖件 `.zcode/org-config.json`，06 §0），
本件零硬编码。会话内子代理没有
model 参数属环境限制（宿主事实单源=references/10 §2）：如实按「意图档位声明 + 环境限制统一档」记欠账
（账本强制输出项），禁止伪装已定档。

## 派发与自检（scripts/）

**派发器退役并物理删除（2026-10-03 用户裁决「派发器彻底退役，所有岗位全部
改由子智能体协作执行」+同日纯净化批「彻底删除死代码和文档」）**：ds-call-v2.mjs
与 scripts/roles/ 注册表已删除（档案=git 历史，恢复须新用户裁决）；全部岗位=
子智能体承载（07 §1）；账本事件=主控补记单源（02 §9）；glm-look（设计岗
视觉外呼）=工具不属岗位派发器，不在删除面（预裁申报，异议即裁）。

```
node scripts/org-config.mjs [resolve|hash|validate|--self-test]
node scripts/check-hardcode.mjs [--strict]   # .md 正文供应商 live 事实扫描（名单从 org-config 派生；命中=WARN，--strict 按 RED 退 1）
node scripts/check-anchors.mjs [--update|--strict]   # 08 §4 文档腐化体检机检化：NN §M 断锚+路径存在性+01/04 条目计数 vs doc-counts golden（WARN 试点校准期；计数失守=FAIL；--update=重冻结随批提交）
node scripts/skill-gc.mjs [--apply --delete-redirects|--delete-invalid]   # 技能目录盘点/清理（默认干跑；删除先归档可回滚；active 技能去留=用户裁决不机删）
node scripts/check-constitution-budget.mjs <AGENTS.md>   # ORG-SEG ≤600 非空白字符
node scripts/init-defenses.mjs --target <项目根> --stack <npm-verify|pnpm-pygates|generic> [--yes]   # 新项目防线日脚手架（05 §4）
node scripts/regression.mjs [--only R4,R7,R8,R10] [--project <dir>]   # 自包含回归（R 清单单源=本脚本；2026-10-03 纯净化批：派发器族项 R1/R2/R5/R11/R9 随死码删除——档案=git 历史）
node scripts/health-scan.mjs [--project <dir>] [--budget <alias>:<maxOutTokens>]   # 收口前健康扫描（RED=0 方可收口；告警分类单源=02 §10）
node scripts/log-triage.mjs [--date YYYY-MM-DD|--hours N] [--health]   # 观测面分诊（B-0）：cli/log+glm-look/历史派发流水两账并呈——五类分诊/attempt 放大/静默回退检测（声明≠实际=RED）/岗×源用量（Kimi 双源分列）/finish 终态派生；--health=源健康检查（A'③）出 k1/k2 派发推荐（额度类→换源；504 窗口类→不换源瘦身）+常设双审对绑定同族核对（R3）+跨门岗对核对（纪律⑤；干涸窗呈现已随 R2 机制删除）
node scripts/glm-look.mjs --prompt <判据.md> <图1.png> [图2…] [-o 报告.md] [--channel glm|ds]   # 设计岗外呼看图双通道（通道/模型/端点甄别=org-config vision_channels 分区+--list-sources；单次调用 20min 上限、非429的4xx立断、scrub 脱敏；max_tokens≥8000 自动倍升防推理段耗额假成功；三段流定式：glm 判读→ds 审核提异见→glm 终裁）
node scripts/package-skill.mjs --out <空目录> [--self-test]   # 分享打包：git 跟踪面导出+分享面门禁（uuid/盘符路径/本机标识零命中）+MANIFEST——受赠机首跑与白名单=PACKAGING.md（v2.1.0 批）
```

**子代理绑定通道（2026-09-16 起，06 §6 补遗+07 §4 补遗；门一 2026-09-22 三岗制、2026-10-03 改绑批增 ops-gate1-k3 成四岗；宿主语义细则单源=references/10 §2）**：文本岗/
异构岗/门一四岗已挂 `~/.zcode/agents/ops-*.md` 绑定子代理（frontmatter
model=`<provider>/<model-key>$<档位>`——模板面存 `{{binding:岗}}` 占位、
部署面=org-config 本机件 `agent_bindings` 渲染实值（v2.1.0 批4），`$` 后缀=显式思考档位声明，缺省
即派发拒启 reasoning-level-missing（实证=references/10 §2），绑定岗现役档案
一律 `$max`（未绑定岗无 model 字段，见随宿主批）；上游枚举值=假绑定禁用；空 tools=
泄漏全工具面禁用；代理档案会话启动快照无热加载——改档须新会话验证+
`log-triage.mjs` 日志核对零回退）。**2026-09-19 用户裁决**：原 GLM 绑定三岗（实现者/门二实证部/
SRE 诊断=ops-executor/probe/diagnostics）改**随宿主会话模型**——未绑定
形态（无 model 字段=回落宿主默认/coding plan 服务商），账本记
`session:host-tier`+E3 欠账行恢复；绑定纪律与 `$max` 档位仅约束设
model 字段的岗（现役=门一 k1/k2/d1/ops-gate1-k3+裁决部+ops-drafter/ops-auditor
七件；本括注=纪律①适用面界定——随宿主三岗维持未绑定形态，非座次冻结，
改绑=用户裁决位在册先例三起）。外部派发器已彻底退役（2026-10-03
用户裁决——全部岗位子智能体承载；工具面保留=应急/校验，启用须新裁决；
roles.* 迁移注记已终态化）。子代理失败
接续纪律=杀岗→`log-triage.mjs --health` 归因→额度类换源继任（读进度
落盘）/窗口类同源瘦身/无工具岗同包重跑（runbook 真源=references/06
§6 补遗二——selfiter 批迁入技能内）。

无 `--role` 报错；源装载双校验（uuid_prefix+entry_name）不符即 exit 3，
无 fallback。宿主 Node 25 兼容面（libuv 退出崩溃实证/Node 24
规避/守卫）单源=references/10 §1——外部派发一律用 Node 24 跑，脚本
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
06 模型路由+承载切换+外呼记账（派发器已删） ｜ 07 角色卡终表+主控 PM 四子模式 ｜
08 文档群治理（事实分层/指针化手册/历史件红线/体检/产出入仓纪律） ｜
09 产品文档编制面（需求五问/手册骨架/API 锚定生成物/tech-writer 子模式） ｜
10 宿主兼容事实单源册（宿主版本耦合——实证戳+异机重验清单）
（01/04 条数单源=`scripts/.golden/doc-counts.json`，check-anchors 对账，
正文不落数字——A3 防双源）

档案件（按需查、勿随技能常载）：历史版本史/残留册全量/批档=
`~/.zcode/skills/_archive/ai-dev-org-history-2026-09/`（65 件 sha256 对账
归档，selfiter 批 B3；路径相对 skills 根）。在册触发器与后续新登记=本
目录 RESIDUALS.md（薄册）。
新机部署与一键自检=DEPLOY.md（根目录）｜ scripts/deploy-check.mjs（--install 补代理/钩子/派生覆盖件）。

## 红旗（出现即停）

- 跳过 intake 五问直接开工 ／ 给门一的包里含任何仓库访问信息
- 席位自设输入通道墙拒收派发包（通道异议=向主控申报由主控裁——
  2026-10-05 裁决回落 writeback-2a6-8，细则=06 §6 补遗三）
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
| 纯配置变更批（org-config/路由/配给） | 单点配置批（改 1 个配置件 ≤10 行）=门一单审（k1）+主控亲验全机检矩阵（分级烤验 R5 carve-out，与分级段同源）；其余纯配置批按「已审面修改」处理：配置 diff+预期行为变化呈 auditor-readonly 复核（W5 审 B' 双源 B1） |
| 收口/交付批 | 烤验证据随呈报包复核：各对抗位报告 + health-scan RED=0 + 基线数字对账（W5 审 ds-B1）+ 入仓工件污染面零命中（08 §6——项目仓门禁+命名过目） |

复合批取命中各行对抗位的**并集**：一个批次踩多类，逐类全过，禁择一。

**分级烤验（2026-09-22 用户裁决 R5；回炉 W-4 边界成文；2026-09-29 修订一
（用户裁决）：小批单审位 k1→d1——节约稀缺额度，裁决原文入册=当日残留册条，
单点配置批维持 k1（至本修订二止）；2026-10-02 修订二（用户裁决）：门一
审核位换源 k1→k2（源B=第二配额备源）——常设双审与单点配置批单审一并
换座，k1 退额度兜底位，绑定不动，换位逐字原文=当日账本 ruling 行承载，
残留册条=别名规范化版；2026-10-03 修订三（用户裁决）：门一默认席位换新
k1——常设一审 k2→k1（kimi-third 座，改座不改绑）、k2 退额度兜底，单点
配置批单审随座改 k1（修订二批漏改烤验触发表行致表=k1 与分级段=k2 分歧，
本批统一 k1 并在残留册留痕），逐字原文=当日账本 ruling 行承载；2026-10-03
修订四（用户裁决，质量优先）：k1 承载源配额充裕（用户申报≈主力之半）——
小批单审位 d1→k1（撤销修订一的节约稀缺额度换位；R5 分级结构与单点配置批
口径不动），并扩面：前端任务设计稿（文本形态）拟定可派 Kimi（经拟定者通道，
细则=07 §1 拟定者行+02 §8.1+06 §3）；逐字原文=当日账本 ruling 行承载，
残留册条=别名规范化版）**：「小批」
定义=纯文档/纯注释批且改动 ≤3 文件、无逻辑行变更；单点配置批=改 1 个
配置件的 ≤10 行变更。**生成物豁免（2026-10-05 回落——waterprint 2A2 批
k1 复审 N2 口径，用户裁决批准入册）：单一生成源再生产物（禁手编——如
`gen_status` 再生成的 status.md）不入小批人工面文件计数，即 ≤3 文件按
人工面计（生成源=唯一人工面；随批再生成的漂移=机检面非人工面。前提：
该生成物已挂再生产一致性机检——重跑生成源与提交物逐字节对账，如
gen_status --check / check-anchors --strict；未挂机检的生成物不得援引
本豁免）**。小批=门一单审（k1）+主控亲验全机检矩阵；单点
配置批=门一单审（k1）+主控亲验全机检矩阵；**其余
一切批次（实现/收口/跨件/涉脚本/涉红线/复合批）仍取全对抗位（双审
k1+d1，复合批按并集）**。额度受限期的替代组合成文：门一单审+**异构代位
审**（异源岗代位+申报入档，如 adjudicator 代 d1）+主控亲验——例外须
申报，不得静默降级。**审包预算纪律扩面至子代理通道**（ORG-12 同款）：
自包含包输入面目标 ≤8k tokens，可指针化的既有事实（golden/契约/先例
文本）不内联——审包体积=额度主变量（30 天实数：双审单批 ≈40-50k
subagent tokens；代位审包不自带实件自由读授权，否则 4.5M tokens 级
爆炸——2026-09-22 实测教训）。

**N 级回炉免审口径（2026-10-05 用户裁决回落，writeback-2a6-8）**：
回炉处置项全为 N 级=主控亲笔+全机检+门二行为佐证即可收口（免门一
复审），W/B 级仍须复审；N 级处置触及已审面仓内文件=该面仍随批重过
（免审仅覆盖纯批档处置与记档）；免审处置逐条落批档可审计——细则
单源=references/02 §5。

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

- **当前版本=v2.1.0（2026-09-22 完善与分离战役，六批+回炉两轮）**：①矛盾清偿
  （烤验表纯配置行 R5 carve-out 消双源/门二编制行双部制成文/铁律1显式指定
  三形态枚举/02 §8.1 意图实配口径注）；②宿主版本耦合事实收拢 references/10
  单源册（三栏：事实/实证环境戳/异机重验——正文全指针化）；③org-config 三层化
  （通用默认件←本机件 local(gitignore)←项目覆盖件——git 跟踪面零个人事实，
  占位拒验 fail-fast+③a 最小骨架脚手架）；④绑定模板 {{binding:岗}} 占位化+
  deploy-check 渲染后对账+agent_bindings 配置面单源；⑤分享打包 package-skill.mjs
  （索引面导出+三维门禁 uuid/盘符/本机标识+文件名通道+MANIFEST）+PACKAGING.md；
  ⑥跨门异构纪律⑤成文+cross_gate_pairs 机检（log-triage ⑧ WARN+计数——现役
  d1=adjudicator 同族退化面如实可见，升格=用户裁决位）。对抗链=门一双审
  （k1 B1W4N8/d1 B3W12N4 双 FAIL）→回炉轮1 全处置→二过（d1 B0W8N9 PASS，
  B1/B2 门禁级缺陷实修：盘符正则排除族漏报+白名单 fail-open 双闸）→回炉轮2
  （d1 二过 8W 全处置）→probe 实证 10/10 全绿（node24 对照可部署）。
  B3（本机件包外不可裁决）裁决=主控机检逐键 diff 亲验（仅 note 级差异+预期新增），
  隔离墙代价登记在册。
- v2.0.2（2026-09-19 escaped-defect ①② 修复批）：清偿
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
