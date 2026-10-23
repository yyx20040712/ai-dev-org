# 03 · 架构与代码（ARC）

> 状态：active ｜ 权威：normative ｜ 更新：2026-10-23 ｜ 替代：无

本册承载状态机、接缝、单一真相源、规模预算与分层类约束。典型触发=改结构、加模块、改类型、改样式。
卡片字段规范单源=`docs/03` §4；本册在 P8b 只写 1 张样卡，P10 会重写为正式卡（张数目标见 `docs/08` §3）。

## C-ARC-02 状态机先列态空间与事件

---
id: C-ARC-02
title: 状态机先列态空间与事件
category: architecture
triggers: [新增状态机, 改状态迁移, 跨步骤流程]
roles: [planner, executor, reviewer]
phases: [design, implement, review]
severity: blocking
enforcement: review
check: 设计评审先看状态×事件迁移表，缺表即退回
evidence:
  - project: Synapse
    event: U2 五轮返工，跨步骤序列丢稿
    ref: references/04-lessons.md 二、审计与测试类 SY-2
    date: 2026-10-21
---

写状态机前先列出全部状态、事件与迁移表，并逐条走查跨步骤序列。
