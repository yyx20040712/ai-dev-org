# 04 · 协作与审计（COL）

> 状态：active ｜ 权威：normative ｜ 更新：2026-10-23 ｜ 替代：无

本册承载角色分离、并行写冲突、审计新鲜度与自裁申报类约束。典型触发=派发、并行、返工、裁决。
卡片字段规范单源=`docs/03` §4；本册在 P8b 只写 1 张样卡，P10 会重写为正式卡（张数目标见 `docs/08` §3）。

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
check: 报告含自裁申报节，逐条列位置、理由与影响；无偏离写「无」
evidence:
  - project: Synapse
    event: 试点批实现岗自裁漏报删减面
    ref: references/04-lessons.md 三、协作与流程类 SY-10
    date: 2026-10-21
---

偏离任务书的任何处置都在报告中逐条写明位置、理由与影响，没有偏离也要写无。
