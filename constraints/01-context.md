# 01 · 任务书与上下文（CTX）

> 状态：active ｜ 权威：normative ｜ 更新：2026-10-23 ｜ 替代：无

本册承载任务书、上下文预算与跨会话接续类约束。卡片字段规范单源=`docs/03` §4。
本批为 P8a 首册，仅 1 张样卡，P9 会重写为正式卡。

## C-CTX-01 先建基线再写业务代码

---
id: C-CTX-01
title: 先建基线再写业务代码
category: context
triggers: [新项目, 开工, 基线, 第一笔提交]
roles: [planner, executor]
phases: [design, implement]
severity: blocking
enforcement: checklist
check: 三项打勾：代码仓有提交；门禁命令存在且跑通一次；至少一个测试跑过
evidence:
  - project: Synapse
    event: 三个项目一次失败的三次重演
    ref: references/04-lessons.md 一、质量门类 SY-1
    date: 2026-08-21
---

业务代码第一笔提交前，先让仓库、门禁命令与最小测试各跑通一次。
