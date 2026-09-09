# 残留登记册（ai-dev-org）

> 三态：open（待处置）/won't-fix（显式不修+裁决依据）/closed（已修）。
> **静默消失=违规**（优化战役 2026-09-10 红线 3）。新残留随发现逐行
> 追加，处置留痕；本册随 W 级审计呈报。

## 登记行

| 编号 | 来源 | 内容 | 状态 | 处置 |
|---|---|---|---|---|
| A-dsN-1 | A 包 deepseek 初审 N 类 | runId 可读性（时间戳+随机后缀难肉眼比对） | won't-fix | 已裁维持（2026-09-10 终裁在档）：runId=机器关联键非人读键，流水按 runId 过滤可机读；人读需求由 ts 字段承担 |
| B-K-N1 | B 包 Kimi 初审 N 类 | skill-gc 插件边界 JSON 字段缺失 | closed | v1.1 已加（审查处置在档=Synapse scripts/audits/2026-09-10_skill-audit-b-*-out.md） |
| B-K-N2 | B 包 Kimi 初审 N 类 | `--project` 同名异义（账本条目名 vs 项目目录） | closed | 已文档化（ds-call-v2.mjs 头注+02 §9 注记：--project=账本条目名，配置装载恒从 cwd） |
| C-K-N1 | C 包 Kimi 终审 N 类 | SKILL.md description 触发词冗长 | won't-fix | 已裁有意设计（2026-09-10 终裁在档）：触发词覆盖=召回优先，长度换加载命中率，不修 |
| BC-ds-2nd | B/C 包 deepseek 复审 | deepseek 二轮缺席（条件同域已落实） | open→W5 | 由优化战役 W5 六派发补齐（deepseek 审 A'/B'/C' 三区）——闭环后翻 closed |
| HOST-node25 | 优化战役 W2 执行事件 | 宿主 Node 25.2.1 外部派发退出阶段 libuv 崩溃（0xC0000409, uv_handle_closing, async.c:76）——输出与落账已完成 | open | 环境缺陷非技能缺陷；行动指引已入冻结证据包：外部派发一律用 Node 24 跑（Volta 实体路径）；根治=等上游 Node 修复，不跟踪 |

## 修订记

- 2026-09-10 立册（优化战役 W4）：承接交接书 §1.3 残留快照全量登记
  并清算——A-dsN-1/C-K-N1 won't-fix 显式化、B-K-N1/N2 closed 闭证、
  BC-ds-2nd 转 W5 闭环、HOST-node25 新登记。
