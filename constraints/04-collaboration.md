# 04 · 协作与审计（COL）

> 状态：active ｜ 权威：normative ｜ 更新：2026-10-25 ｜ 替代：无

本册承载需求一致性、返工、角色分离、审计终态与自裁申报类约束。典型触发=派发、评审、返工、改接缝、结项。卡片字段规范单源=`docs/03` §4（跨仓=/home/yyx/work/aidevorg/docs/03-target-architecture.md §4）。

## C-COL-01 评审前自查需求一致性
---
id: C-COL-01
title: 评审前自查需求一致性
category: collaboration
triggers: [简报评审, 需求源, 一致性, 主授权]
roles: [planner, reviewer]
phases: [design, review]
severity: warning
enforcement: review
check: 评审记录含一致性自查；每项矛盾均附主授权依据与处置记录
evidence:
  - project: WaterPrint
    event: M1b 简报 DoD 与 D 系列互相矛盾，需求源内部不一致
    ref: references/04-lessons.md 三、协作与流程类 WP-10
    date: 2026-10-21
---
简报评审先自查需求源内部一致性；发现矛盾时按主授权消解并记档。

## C-COL-02 将口径冲突交所有者裁定
---
id: C-COL-02
title: 将口径冲突交所有者裁定
category: collaboration
triggers: [口径冲突, 审计门, 所有者裁定, 复算]
roles: [reviewer, adjudicator]
phases: [review, adjudicate]
severity: blocking
enforcement: review
check: 审计报告附冲突两侧与复算结果；所有者裁定记录在场前不判定通过
evidence:
  - project: WaterPrint
    event: 「1 用 1 备」字面与双渠计算口径冲突，改任一数都无法对齐
    ref: references/04-lessons.md 三、协作与流程类 WP-11
    date: 2026-10-21
---
审计发现两种口径无法同时成立时，列出冲突与影响并交所有者裁定，不自行选值。

## C-COL-03 为仓外材料写明绝对路径
---
id: C-COL-03
title: 为仓外材料写明绝对路径
category: collaboration
triggers: [代理派发, 仓库外材料, 绝对路径, prompt]
roles: [planner]
phases: [design]
severity: blocking
enforcement: review
check: 逐份派发文本核对仓外材料；绝对路径与仓外声明同时在场，缺项即退回
evidence:
  - project: WaterPrint
    event: 二审代理未见仓库外 .workflow，误把报告写入仓库并污染工作树
    ref: references/04-lessons.md 三、协作与流程类 WP-13
    date: 2026-10-21
---
派发代理涉及仓库外材料时，在 prompt 写明绝对路径，并显式声明该目录在仓库外。

## C-COL-04 声明返工上限并核对净增 diff
---
id: C-COL-04
title: 声明返工上限并核对净增 diff
category: collaboration
triggers: [返工, 修复轮, 返工上限, 净增 diff]
roles: [executor, reviewer, adjudicator]
phases: [implement, review, adjudicate]
severity: blocking
enforcement: review
check: 每轮回附返工轮次、回归用例与 diff 净增量；超限处有终止与用户交接记录
evidence:
  - project: Synapse
    event: UNDO-01 七轮振荡，复用首轮 diff 使审计输入膨胀，SY-5 规定两轮上限与净增量化
    ref: references/04-lessons.md 二、审计与测试类 SY-5
    date: 2026-10-21
  - project: ai-dev-org
    event: 02 §5 区分 WP 5 轮与 SY 2 轮，新项目宪法未声明时取严者
    ref: references/02-pipeline-templates.md §5
    date: 2026-10-21
---
在项目宪法声明返工上限，未声明时不超过 2 轮；每轮量化回归用例与 diff 净增量，超限即终止并交用户。

## C-COL-05 分离实现验收并锁定测试
---
id: C-COL-05
title: 分离实现验收并锁定测试
category: collaboration
triggers: [实现验收分离, 测试锁, 激活锁, registry, 控制面]
roles: [executor, reviewer, adjudicator]
phases: [implement, review, close]
severity: blocking
enforcement: review
check: 核对实现者与验收者不同；测试面 diff 为零、激活锁通过、registry 仅有结项者写入
evidence:
  - project: Synapse
    event: 弱模型改 tests/** 让代码通过，执行者同时握实现与验收
    ref: references/04-lessons.md 三、协作与流程类 SY-9
    date: 2026-10-21
  - project: WaterPrint
    event: 测试文件由清单哈希与只读属性双重锁定，本地与 CI 双验，重锁须人类独立提交
    ref: testing.md 只读锁定
    date: 2026-10-21
---
实现与验收分岗；锁定测试文件及其激活状态，实现者不得改测试或关闭用例，验收 registry 仅由结项者变更。

## C-COL-06 偏离任务书必须逐条申报
---
id: C-COL-06
title: 偏离任务书必须逐条申报
category: collaboration
triggers: [任务书执行, 返工, 自裁处置]
roles: [executor, reviewer, adjudicator]
phases: [implement, review, adjudicate]
severity: blocking
enforcement: review
check: 报告含自裁申报节，逐条列位置、理由与影响，删减面附 diff 级自查；审计逐条对 diff 核诚实性；无偏离写『无』
evidence:
  - project: Synapse
    event: 三屋试点中实现岗自裁漏报 SKILL.md 删减面
    ref: references/04-lessons.md 三、协作与流程类 SY-10
    date: 2026-10-21
---
偏离任务书的任何处置都在报告中逐条写明位置、理由与影响，删减面附 diff 级自查，没有偏离也要写『无』。

## C-COL-07 区分完整、截断与失败
---
id: C-COL-07
title: 区分完整、截断与失败
category: collaboration
triggers: [审计账本, 流水终态, 截断标记, 未知终态]
roles: [planner, executor, reviewer]
phases: [design, implement, review]
severity: blocking
enforcement: machine
check: 构造完整、截断、失败、未知四类流水，核对账本状态与截断标记；确认截断、失败或未知均不得计为通过
evidence:
  - project: ai-dev-org
    event: 流水已记录 finish，账本却丢弃终态，8 笔截断审计被当成功
    ref: references/04-lessons.md 七、2026-09-14 优化批增补 ORG-5
    date: 2026-09-14
---
审计账本以流水终态为唯一来源派生截断标记，分别记录完整、截断与失败；未知终态按非完整处理。

## C-COL-08 改接缝必核对相邻侧
---
id: C-COL-08
title: 改接缝必核对相邻侧
category: collaboration
triggers: [接缝, 相邻声明, 语义漂移, 互斥]
roles: [executor, reviewer]
phases: [implement, review]
severity: blocking
enforcement: review
check: 接缝变更报告列出两侧核对结果；发现互斥时有停止与上报记录
evidence:
  - project: Synapse
    event: save-status 语义下沉后被动态 paper 消费，接缝两处声明漂移
    ref: references/04-lessons.md 三、协作与流程类 SY-8
    date: 2026-10-21
---
修改接缝一侧时核对相邻另一侧的声明与消费；两侧互斥即停止并上报。
