# 07 · 编排与调度（ORC）

> 状态：active ｜ 权威：normative ｜ 更新：2026-10-26 ｜ 替代：无

本册承载子代理边界、并行派发、模型绑定与路由、长派发排障、定时与闲时任务类约束。典型触发=并行派发、配模型、定时调度、长派发超时排障。卡片字段规范单源=`docs/03` §4（跨仓=/home/yyx/work/aidevorg/docs/03-target-architecture.md §4）。

## C-ORC-01 按写面隔离并行派发
---
id: C-ORC-01
title: 按写面隔离并行派发
category: orchestration
triggers: [并行派发, 写面隔离, 同文件, 共享状态]
roles: [planner, executor, reviewer]
phases: [design, implement, review]
severity: blocking
enforcement: checklist
check: 逐项列出并核对各任务写面清单（写面交集判据的核验载体）；并行任务两两写面交集为空且无共享状态，否则改串行并留记录
evidence:
  - project: Synapse
    event: 多个代理并行写共享状态或同文件，造成 125 个编译错误
    ref: AI辅助开发经验教训.md §A3
    date: 2026-08-21
---
并行派发前列出各任务写面，写不同文件且无共享状态才可并行；写同文件或共享状态必须串行。

## C-ORC-02 显式绑定模型并核对路由
---
id: C-ORC-02
title: 显式绑定模型并核对路由
category: orchestration
triggers: [代理档案, 模型绑定, thoughtLevel, 静默回退, metadata]
roles: [planner, executor, reviewer, diagnostics]
phases: [design, implement, review]
severity: blocking
enforcement: machine
check: 首场派发后运行 node scripts/log-triage.mjs --hours 24 实测；机检=RED 退出码（log-triage --hours 24），WARN=人工逐项闭环；确认③无 RED 且本岗声明等于实际路由；无请求或 metadata 漂移 WARN 未闭环均不通过
evidence:
  - project: ai-dev-org
    event: F7 确认 model＋thoughtLevel 为公开契约，旧后缀仅兼容
    ref: 01-decisions.md §3 F7
    date: 2026-10-21（评估日）
  - project: ai-dev-org
    event: 上游枚举值曾静默回退，metadata 结构演进使旧检测面失明
    ref: references/10-host-compat.md §2 假绑定条＋§3 metadata 条
    date: 2026-09-17
---
绑定岗代理档案显式声明具体模型与档位，禁用上游枚举值；首场派发后核对声明与实际路由，并逐项核对闭环 metadata 形态漂移告警。

## C-ORC-03 改档后用新会话验证
---
id: C-ORC-03
title: 改档后用新会话验证
category: orchestration
triggers: [代理档案, 改档, 新会话]
roles: [planner, executor, diagnostics]
phases: [implement, review]
severity: warning
enforcement: checklist
check: 改档记录含新会话标识、最小任务结果及工具面与绑定快照；原会话验证不得作为生效证据
evidence:
  - project: ai-dev-org
    event: 代理档案是会话启动快照，改档对运行中会话不生效
    ref: references/10-host-compat.md §2 代理档案快照条
    date: 2026-09-16
---
修改代理档案或模型档位后，不在原会话认定生效；另起新会话执行最小派发并核对工具面与绑定快照。

## C-ORC-04 长派发分层排障并留真退出码
---
id: C-ORC-04
title: 长派发分层排障并留真退出码
category: orchestration
triggers: [长任务派发, 三层分诊, 审包体积, 超时, 真退出码]
roles: [planner, executor, reviewer, diagnostics]
phases: [design, implement, review]
severity: blocking
enforcement: checklist
check: 派发记录含审包体积、唯一超时源、简报预算与三层分诊；每条命令有独立退出码，证据和结论在同一提交，缺项即退回
evidence:
  - project: ai-dev-org
    event: 长推理派发多次被掐，审包膨胀、证据断链与链式命令吞红损害排障
    ref: references/04-lessons.md 八、2026-09-16 派发防截断批增补 ORG-12
    date: 2026-09-16
---
长任务派发前压缩审包并声明唯一超时源与简报预算，失败后按服务端、网关、客户端三层分诊；证据与结论同笔提交，逐条命令单独落真退出码。

## C-ORC-05 先检占用再调度定时与闲时任务
---
id: C-ORC-05
title: 先检占用再调度定时与闲时任务
category: orchestration
triggers: [定时任务, 闲时任务, 占用检测, 断点接续, 静默窗]
roles: [planner, executor, diagnostics]
phases: [design, implement]
severity: blocking
enforcement: checklist
check: 调度记录含进程、锁、文件活动三类只读证据及等待复测与断点甄别，既有任务零删改（用户点名裁决的调整除外，须留裁决锚点）；无杀进程/清场动作；任务声明不依赖自动重试；闲时无后台子代理，任务具只读或可重跑声明，开工提交号在场
evidence:
  - project: ai-dev-org
    event: 闲时任务不支持后台子代理，不自动重试或回滚，开工前须提交
    ref: 02-evidence.md §5
    date: 2026-10-21
  - project: ai-dev-org
    event: 既有定时任务只增不改，占用检测只读且不得杀进程清场
    ref: 00-kickoff.md §2 L73
    date: 2026-10-24
  - project: ai-dev-org
    event: 跨会话占用须结合进程与目录静默窗，前会话断点不等于占用
    ref: occupancy-check-2026-10-26-0300.md §1 L15
    date: 2026-10-26
---
调度定时或闲时任务前，只读核对全系统进程、锁与目标目录活动静默窗并区分断点，既有任务只增不改（仅用户点名任务 ID 的裁决可调整，须留裁决锚点）且不得杀进程清场；闲时不派后台子代理，仅承载只读或可重跑工作，开工先提交且不依赖自动重试。

## C-ORC-06 显式声明子代理工具与嵌套边界
---
id: C-ORC-06
title: 显式声明子代理工具与嵌套边界
category: orchestration
triggers: [子代理, 工具白名单, tools, 嵌套派发]
roles: [planner, executor, reviewer]
phases: [design, implement, review]
severity: blocking
enforcement: checklist
check: 逐档核对工具白名单，无工具岗具备显式禁用清单或 Read＋协议墙，空数组假无工具配置为零；派发文本含禁嵌套声明，嵌套需求有主控处置记录（串行或工作流承载形态在案）
evidence:
  - project: ai-dev-org
    event: 空 tools 数组泄漏全工具面，无工具岗须显式清单或 Read＋协议墙
    ref: references/10-host-compat.md §2 tools 条
    date: 2026-09-16
  - project: ai-dev-org
    event: 子智能体及工作流内均不能再派子智能体
    ref: 02-evidence.md §2＋§6
    date: 2026-10-21
---
子代理档案显式声明工具边界，禁止用空 tools 数组充当无工具配置；任务书写明子代理不得再派子代理，嵌套需求交主控以串行或工作流处置。
