# 结项/交付型任务书合成反例（W5b R1 fixture）

> 用途：R2-T1 检查面消费参照件——合成最小样，内容虚构，与任何现役任务书无关。
> 结构取材：docs/tasks/B9-archive-reconcile.md（形态参照，未逐字引用）。型语境：结项/交付（对账与交接）。

## 1. 白名单（02 §4 三态表）

| 路径 | 动作 |
|---|---|
| `scripts/verify-docs.mjs` | 修改 |
| `SKILL.md` | 禁改 |

## 2. 引用核对样例

- 逐字引用甲：`SKILL.md:9999「# AI 开发公司组织操作系统（ai-dev-org）」`
- 逐字引用乙：`SKILL.md:2「name: ai-dev-org-变异」`

## 3. 验收命令

验收命令段在本变异中移除（T0 反样承载）。

## 4. 事实台账（机读，F 条目）

F-01 ｜ 合成正例基线计数 ｜ `echo 1` ｜ 1 ｜ 2026-10-31 ｜ record=F-01

## 5. 期望值（机读，E 条目）

| # | 判据 | 期望 | 依据 |
|---|---|---|---|
| 1 | `grep -c 'TBFXMARK' scripts/.golden/taskbook/close-pass.md` | 2 | 证 |

TBFXMARK 唯一标记行：本串在本文件恰出现两处（本行＋判据 #1 命令行）。

## 6. 禁止改动（T3 反样承载）

本节为 T3 反样：以下路径为禁改面。

`scripts/verify-docs.mjs`

本行为词面反样承载：回炉（T13 反样词面，供 R2-T1 验证 FAIL）。
