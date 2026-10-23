# 05 · 文档与语言（DOC）

> 状态：active ｜ 权威：normative ｜ 更新：2026-10-23 ｜ 替代：无

本册承载单一真相源、历史记录、生成物与语言类约束。典型触发=写文档、改规格、整理索引。
卡片字段规范单源=`docs/03` §4；本册在 P8b 只写 1 张样卡，P11 会重写为正式卡（张数目标见 `docs/08` §3）。

## C-DOC-04 规范与校验器必须同步演进

---
id: C-DOC-04
title: 规范与校验器必须同步演进
category: documentation
triggers: [改规范, 改校验脚本, 新增机检]
roles: [planner, executor, reviewer]
phases: [design, implement, review]
severity: warning
enforcement: checklist
check: 规范条款与校验项同批提交，报告逐条给出条款到检查项的对应
evidence:
  - project: ai-dev-org
    event: 规范要求记账但校验器只认旧事件
    ref: references/04-lessons.md 七、2026-09-14 优化批增补 ORG-11
    date: 2026-10-21
---

新增规范条款时，能机检的同批落成校验项，不能机检的写明人工判据。
