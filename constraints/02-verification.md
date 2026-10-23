# 02 · 验证与测试（VER）

> 状态：active ｜ 权威：normative ｜ 更新：2026-10-23 ｜ 替代：无

本册承载测试、假绿、红证、门禁与安全用例类约束。典型触发=写测试、改断言、修缺陷、验收。
卡片字段规范单源=`docs/03` §4；本册在 P8b 只写 1 张样卡，P9 会重写为正式卡（张数目标见 `docs/08` §3）。

## C-VER-03 新测试必须先失败一次

---
id: C-VER-03
title: 新测试必须先失败一次
category: verification
triggers: [新增测试, 修改断言, 修复缺陷]
paths: ["**/*.test.*", "**/tests/**"]
roles: [executor, reviewer]
phases: [implement, review]
severity: blocking
enforcement: machine
check: 跑目标测试，确认先红后绿；记录两次退出码
evidence:
  - project: Synapse
    event: 乱码断言恒真
    ref: "AI辅助开发经验教训.md §D1"
    date: 2026-08-21
  - project: WaterPrint
    event: 8/8 占位实质化断言弱化
    ref: references/04-lessons.md 二、审计与测试类 WP-5
    date: 2026-10-21
---

新写的测试必须先失败一次，再通过。只看到通过、没有看到失败，视为未验证。
