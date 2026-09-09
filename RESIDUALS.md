# 残留登记册（ai-dev-org）

> 三态：open（待处置）/won't-fix（显式不修+裁决依据）/closed（已修）。
> **静默消失=违规**（优化战役 2026-09-10 红线 3）。新残留随发现逐行
> 追加，处置留痕；本册随 W 级审计呈报。
> project 匹配约束（health-scan §① 同款）：本册按编号精确对账。

## 登记行

| 编号 | 来源 | 内容 | 状态 | 处置 |
|---|---|---|---|---|
| A-dsN-1 | A 包 deepseek 初审 N 类（档=Synapse scripts/audits/2026-09-10_skill-audit-a-ds-out.md；裁决承转=优化战役交接书 `E:/class/智慧水务/Synapse_remake/docs/prompts/2026-09-10_ai-dev-org-optimize-brief.md` §1 快照「已裁维持」，其上游=2026-09-10 技能落地场用户在档裁决链） | runId 可读性（时间戳+随机后缀难肉眼比对） | won't-fix | 维持原裁：runId=机器关联键非人读键，流水按 runId 过滤可机读；人读需求由 ts 字段承担。裁决主体=上游战役主控终裁+用户交接书认受（非本轮自裁） |
| B-K-N1 | B 包 Kimi 初审 N 类（档=2026-09-10_skill-audit-b-kimi-out.md；B 包复审=同目录 b-kimi-re-out.md） | skill-gc 插件边界 JSON 字段缺失 | closed | v1.1 已加（处置在档） |
| B-K-N2 | B 包 Kimi 初审 N 类（档同上） | `--project` 同名异义（账本条目名 vs 项目目录） | closed | 已文档化（ds-call-v2.mjs 头注+02 §9 注记：--project=账本条目名，配置装载恒从 cwd） |
| C-K-N1 | C 包 Kimi 终审 N 类（档=2026-09-10_skill-audit-c-re2-kimi-out.md；裁决承转=交接书 §1 快照「已裁有意设计不修」，交接书全路径见 A-dsN-1 行） | SKILL.md description 触发词冗长 | won't-fix | 维持原裁：触发词覆盖=召回优先，长度换加载命中率。裁决主体同 A-dsN-1（非本轮自裁） |
| BC-ds-2nd | B/C 包 deepseek 复审缺席（交接书 §1 快照第 4 条） | deepseek 二轮未走（条件同域已落实） | closed | 已由优化战役 W5 六派发补齐（deepseek 审 A'/B'/C' 三区，档=Synapse scripts/audits/2026-09-10_w5-*-ds-out.md）——本轮闭环 |
| HOST-node25 | 优化战役 W2 执行事件+回炉轮 1 复核 | 宿主 Node 25.2.1 下 ds-call-v2 路径**退出阶段** libuv 断言崩溃（0xC0000409, uv_handle_closing, async.c:76）——输出与落账已完成 | won't-fix | 定性（回炉轮 1 修正为或然并存）：裸 fetch 单请求 Node 25 不复现（实验档=w5 终裁档 §Node25 对照）——崩溃=Node 25 libuv 敏感性×ds-call-v2 路径特定形态（长响应/重试循环）组合，「纯环境缺陷」与「代码触发面」不可分。接受风险=跟踪上限到此；缓解=外部派发一律 Node 24（SKILL.md 派发节注记）；**若 Node 24 后续同崩则本项重开升级排查**（重开触发=人工发现，无常驻机检=已接受监控盲区） |
| W5-A-W4 | W5 回炉轮 1 登记（Kimi-W4） | R5 演练行永久留在技能根流水（历史事件不删） | won't-fix | 流水=追加式运行记录（历史件禁改写同款语义），演练行带 mocked 上下文可甄别；不清洗 |

## 残留快照对账表（交接书 §1.3 → 本册编号；「静默消失」证伪位）

| 交接书 §1 快照条目 | 本册编号 | 状态 |
|---|---|---|
| A 包 ds-N 类（runId 可读性——已裁维持） | A-dsN-1 | won't-fix（对应） |
| B 包 Kimi-N（插件边界 JSON 字段已加；--project 同名异义文档化已做） | B-K-N1+B-K-N2 | closed×2（对应） |
| C 包 Kimi-N1（description 触发词冗长——已裁有意设计不修，维持） | C-K-N1 | won't-fix（对应） |
| B/C 包 deepseek 未走第二轮（条件同域已落实） | BC-ds-2nd | closed（W5 闭环） |
| （战役新发现，快照外） | HOST-node25/W5-A-W4 | 登记 2 条 |

## 修订记

- 2026-09-10 回炉轮 2（终轮，W5 复审处置）：登记 B'-ds-N7 后半（后续
  新增主控子模式须同步 references/07 §1 编制表注记——本轮 tech-writer
  不增编制已核，此为预防性登记）；HOST-node25 重开条件触发机制=人工
  触发线如实注记（用户/主控发现 Node 24 同崩即重开，无常驻机检——
  监控缺位 won't-fix 承接 C'-Kimi N1）。
- 2026-09-10 回炉轮 1（W5 审 C' 处置）：won't-fix 补档指针与裁决主体
  （Kimi-W-2）；HOST-node25 转态 won't-fix+定性或然修正（Kimi-W-4/
  ds-W3：裸 fetch 对照实验后放弃「纯环境缺陷」超证据定性）；增残留
  快照对账表（Kimi-W-1/ds-W4：§1.3 全集对账，零静默消失）；BC-ds-2nd
  闭环（W5 六派发完成）；三态纯度修正（Kimi-N-1：open→W5 移入处置列）。
- 2026-09-10 立册（优化战役 W4）：承接交接书 §1.3 残留快照全量登记。
- 2026-09-10 立册日清算补记（与上行同期，分行纯追加）：A-dsN-1/C-K-N1
  won't-fix 显式化、B-K-N1/N2 closed 闭证、BC-ds-2nd 转 W5 闭环、
  HOST-node25 新登记。
