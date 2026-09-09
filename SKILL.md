---
name: ai-dev-org
description: Use when 用户提出开发/实现/修复/重构/批次/战役/开工/简报/工单/派发/审计/收口/交付类请求，或涉及模型路由/额度/换源/供应商/体验套餐决策，或出现组织/岗位/分工/角色卡/部门墙/主控/立案/排程/呈报/成本账本/环境限制欠账等组织协作症状时加载本技能。Not for 纯问答或单行修复。
---

# AI 开发公司组织操作系统（ai-dev-org）

## 概述

跨项目通用的「AI 软件开发公司」组织规范：岗位编制 × 模型路由 × 部门墙
协议 × 成本纪律。第一性原理：执行者必然犯错——组织设计目标是让错误在
合入前现形、每个决定可追溯。**用户只对接一个岗位（主控）**，其余岗位由
主控单一调用（铁律见 references/06 §2）。本技能=loop-engineering 升级
替代件（组织视图+管道视图合并，旧件已归档）。

## 岗位速查（终表见 references/07）

| 岗位 | 通道 | 档位/tier 记法 |
|---|---|---|
| 主控（+PM 子模式） | 主会话 | 会话宿主模型；唯一用户对接岗 |
| 拟定者 drafter | 派发器 `--role drafter` | prime（路线级设计拟定，零仓库接触） |
| 实现者 | 会话内子代理 | 意图档位+欠账记账（定档不可强制，见下） |
| 门一 gate1-reviewer | 派发器 `--role gate1-reviewer` | audit（隔离一审，只喂自包含 diff 包） |
| 门二 | 会话内子代理 | 意图档位+欠账记账（异构优先） |
| 审核者 auditor-readonly | 派发器 `--role auditor-readonly` | debt-readonly（兜底/欠账只读审） |
| SRE 诊断岗 sre-diagnostic | 会话内只读子代理 | 取证/冻结提取/e2e 红 triage；禁写禁臆断 |
| 设计岗 design-reviewer | 会话内图像通道 | 意图档位 session:multimodal-exp+欠账记账（宿主可配模型则按其配置入口执行）；方向级决策留用户 |

（岗位编制=8；人类用户=裁决位不计入编制——同 references/06 §1/07 §1 表注。）

供应商事实（源序/端点/套餐/配给）**一律看 org-config**（默认件+
项目覆盖件 `.zcode/org-config.json`），本件零硬编码。会话内子代理无
model 参数=环境限制：意图档位声明+「环境限制统一档」欠账是**账本强制
输出项**，禁伪装已定档。

## 派发与自检（scripts/）

```
node scripts/ds-call-v2.mjs --role <id> [--source <alias>] [--project <名>]
     [--dry-run|--list-roles|--list-sources] [--mock-source <alias>:<status>]
     <prompt文件> [输出文件]        # --role 必填（v1 内嵌提示已废止）
node scripts/org-config.mjs [resolve|hash|validate|--self-test]
node scripts/skill-gc.mjs [--apply --delete-redirects|--delete-invalid]   # 技能目录盘点/清理（默认干跑；删除先归档可回滚；active 技能去留=用户裁决不机删）
node scripts/check-constitution-budget.mjs <AGENTS.md>   # ORG-SEG ≤600 非空白字符
node scripts/init-defenses.mjs --target <项目根> --stack <npm-verify|pnpm-pygates|generic> [--yes]   # 新项目防线日脚手架（05 §4）
node scripts/regression.mjs [--only R2,R5,R4] [--r1] [--update-golden] [--project <dir>]   # 自包含回归（06 §5 R 清单内化；R1 真实派发须 --r1）
node scripts/health-scan.mjs [--project <dir>] [--budget <alias>:<maxOutTokens>]   # 收口前健康扫描（欠账/同源/预算，RED=0 方可收口）
```

无 `--role` 报错；源装载双校验（uuid_prefix+entry_name）不符即 exit 3 无 fallback。
（宿主 Node 25.2.1（已证档）下 ds-call-v2 路径有 libuv 退出阶段崩溃=
RESIDUALS/HOST-node25——外部派发一律用 Node 24 跑；见文末修订记。）
运行流水=scripts/model-routing-log.jsonl（字段口径见 references/06 §5）；
项目账本=.zcode/org-ledger.jsonl（行 schema：ts/project/event/role/tier/
source/cfg_hash/usage?/outcome——tier 记法：外部岗取 org-config 枚举，
会话内岗记 session:<描述>，见 references/07 §4）。
（下述 scripts/ 路径相对**技能根**=本文件所在目录，zcode 加载本技能时附基目录。）

## 加载地图（references/，按需读勿全量）

01 原理 16+3 条 ｜ 02 管道 12 步+任务书六段+回炉+数据专轨+适配注记 ｜
03 机器强制 ｜ 04 教训库 25+4 条 ｜ 05 移植指南+差异回灌协议 ｜
06 模型路由+换源状态机+派发器 v2 ｜ 07 角色卡终表+主控 PM 四子模式 ｜
08 文档群治理（事实分层/指针化手册/历史件红线/体检） ｜
09 产品文档编制面（需求五问/手册骨架/API 锚定生成物/tech-writer 子模式）

## 红旗（出现即停）

- 跳过 intake 五问直接开工 ／ 给门一的包含任何仓库访问信息
- 换源时放宽任务书或 DoD ／ 源尽不记欠账假装审过
- 子代理"已定档"却无欠账行 ／ ORG-SEG 段超预算未跑自检即派发
- 本项目已有组织段时整抄通用 stub（双组织段=双源）

## 烤验触发表（grillme 机关——派发前自检，未过不得收口）

| 批次类型 | 强制对抗位（缺一=烤验未过） |
|---|---|
| 实现批 | 门一异构隔离审+门二实证终审（02 §2 步骤 6/7） |
| 文档/制度批 | 轻量双审（02 §3） |
| 数据批 | 独立复算+专家追认（02 §6） |
| 路线级设计 | 三段通道：拟定+对抗审核+主控终裁（02 §8.6） |
| 已审面修改 | 该面随批重过——给首审档呈 diff，「改了就要再审」（08 §0 惯例） |
| 纯配置变更批（org-config/路由/配给） | 按「已审面修改」处理：配置 diff+预期行为变化呈 auditor-readonly 复核（W5 审 B' 双源 B1） |
| 收口/交付批 | 烤验证据随呈报包复核：各对抗位报告+health-scan RED=0+基线数字对账（W5 审 ds-B1） |

**复合批取命中各行对抗位的并集**（一个批次踩多类=逐类全过，禁择一）。

派发前自检三问：①本批命中表中哪些对抗位？②各位源可用且与实现者
异构吗？③欠账清单有无本批必须补还项？收口前必跑
`node scripts/health-scan.mjs --project <dir>`（RED=0 方可收口，
三类告警细则=02 §10）。**主控简报中的关键假设须显式标注「假设」
并请对抗位拷问——假设未被拷问=烤验未过。**

## 团队化边界与扩展位（显式化——不假装解决）

- 本技能编制=单人开发者+AI 组织（8 岗+人类用户裁决位）：主控单写
  账本、单一 git 历史、单裁决通道——**未覆盖多人团队场景**（并行
  PR 流/代码所有权分区/多主控协调/人人间评审）。
- 团队化的两个已知扩展位（均为用户未来裁决位，现不实现）：①裁决
  代表制——多人时谁握「用户裁决位」（代表制/分工分权）；②分支
  模型——共享 main vs 短命 feature 分支+门审前置。触发条件=真实
  多人协作出现，届时按 05 §6 差异回灌协议呈报设计案再动。

## 常见借口对照

| 借口 | 现实 |
|---|---|
| "这次太小不用走组织流程" | 在册事故多出自"小改动"（04·SY-1） |
| "换源了，要求降一点" | 任务书与 DoD 不随换源放宽（06·§4） |
| "子代理大概用了对的模型" | 无 model 参数=环境限制，如实记欠账 |
| "部门墙灵活一点效率高" | 喂什么=岗位边界，灵活化=在册红线（01·E2） |

## 验证状态

内容锚定 Synapse/WaterPrint 双项目实战事故与 GREEN 史（锚点格式见
references/04；本技能自身的基线失败=设计审核链 5B/5W/3N 实录，
scripts/audits/2026-09-10_org-skill-*）。新项目首场战役按 05 移植后
做压力场景复测并回填本节。v1.0 冻结条件=首个适配场完整 LOOP 走通+
派发器 v2 回归 R1~R6 全过（drafter 复用与项目切换的前置）。

## 修订记

- 2026-09-10 v1.1（优化战役，W5 全局三源审计回炉轮 1）：加载地图+09；
  烤验触发表立节（W4）并按双源审计增「纯配置变更批/收口交付批」两行
  +复合批并集注记；团队化边界段立节（W3）；派发命令清单+三新脚本
  （init-defenses/regression/health-scan）；Node24 派发注记
  （HOST-node25）。变更明细=技能仓库 git 提交链（W0~W4 五提交）+
  回炉轮 1 提交；审计档=Synapse scripts/audits/2026-09-10_w5-*。
