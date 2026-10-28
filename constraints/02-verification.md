# 02 · 验证与测试（VER）

> 状态：active ｜ 权威：normative ｜ 替代：无

本册承载测试、假绿、红证、门禁与安全用例类约束。典型触发=写测试、改断言、修缺陷、验收。

## C-VER-01 测试入口统一，CI 输出为唯一权威
---
id: C-VER-01
title: 测试入口统一，CI 输出为唯一权威
category: verification
triggers: [测试入口, CI, 测试数字]
roles: [executor, reviewer]
phases: [implement, review]
severity: blocking
enforcement: review
check: 全量测试一条命令跑完；测试数字只引 CI 输出
evidence:
  - project: Synapse
    event: 测试数字被反复改写不可信，缺统一入口
    ref: "AI辅助开发经验教训.md §D3"
    date: YYYY-MM-DD
---
测试入口统一为一条命令；测试数字以 CI 输出为唯一权威。

## C-VER-02 门禁全量本地跑
---
id: C-VER-02
title: 门禁全量本地跑
category: verification
triggers: [提交前, 门禁, 全量]
roles: [executor, reviewer]
phases: [implement, review, close]
severity: blocking
enforcement: checklist
check: 门禁矩阵逐项本地跑并留退出码，漏项即未完成
evidence:
  - project: WaterPrint
    event: 新增门禁项本地漏跑，缺陷漏网至评审轮
    ref: references/04-lessons.md 一、质量门类 WP-1
    date: YYYY-MM-DD
---
每次提交前本地跑全量门禁，逐项留退出码。

## C-VER-03 新测试必须先失败一次
---
id: C-VER-03
title: 新测试必须先失败一次
category: verification
triggers: [新增测试, 修改断言, 修复缺陷]
roles: [executor, reviewer]
phases: [implement, review]
severity: blocking
enforcement: machine
check: 跑目标测试，确认先红后绿；记录两次退出码
evidence:
  - project: Synapse
    event: 乱码断言恒真
    ref: "AI辅助开发经验教训.md §D1"
    date: YYYY-MM-DD
  - project: WaterPrint
    event: 8/8 占位实质化断言弱化
    ref: references/04-lessons.md 二、审计与测试类 WP-5
    date: YYYY-MM-DD
---
新写的测试必须先失败一次，再通过。只看到通过、没有看到失败，视为未验证。

## C-VER-04 e2e 断言必须落到渲染真实文本
---
id: C-VER-04
title: e2e 断言必须落到渲染真实文本
category: verification
triggers: [e2e, 断言, 渲染文本]
roles: [executor, reviewer]
phases: [implement, review]
severity: blocking
enforcement: review
check: e2e 用例断言渲染文本实值；只断元素存在即退回
evidence:
  - project: Synapse
    event: 52 测试全绿但文字不可见
    ref: references/04-lessons.md 二、审计与测试类 SY-3
    date: YYYY-MM-DD
---
e2e 断言落到渲染出的真实文本；只断元素存在不算通过。

## C-VER-05 落盘加独立回读断言才算生效
---
id: C-VER-05
title: 落盘加独立回读断言才算生效
category: verification
triggers: [落盘, 回读, 断言]
roles: [executor, reviewer]
phases: [implement, review]
severity: blocking
enforcement: review
check: 落盘后独立回读断言在场并通过；只构造不回读即退回
evidence:
  - project: WaterPrint
    event: 审计头构造了但落盘环节静默丢弃
    ref: references/04-lessons.md 二、审计与测试类 WP-8
    date: YYYY-MM-DD
---
落盘数据配独立回读断言；只构造不回读视为未生效。

## C-VER-06 路径拼接必须做穿越用例
---
id: C-VER-06
title: 路径拼接必须做穿越用例
category: verification
triggers: [路径拼接, 安全, 穿越用例]
roles: [executor, reviewer]
phases: [implement, review]
severity: blocking
enforcement: machine
check: 确认穿越用例在场且目录快照零新增；拼接点有白名单
evidence:
  - project: WaterPrint
    event: 拼接无白名单致 HTTP 可达任意路径写（Critical）
    ref: references/04-lessons.md 二、审计与测试类 WP-6
    date: YYYY-MM-DD
---
路径拼接必配穿越用例与目录快照比对，零新增才准合入。

## C-VER-07 变异红证禁用 checkout 还原
---
id: C-VER-07
title: 变异红证禁用 checkout 还原
category: verification
triggers: [变异测试, 红证, 还原]
roles: [executor]
phases: [implement]
severity: blocking
enforcement: checklist
check: 变异红证用文件备份法；还原后与备份基线比对 diff 为空
evidence:
  - project: Synapse
    event: 对未提交实现做变异红证用版本还原，把实现一并抹掉
    ref: references/04-lessons.md 二、审计与测试类 SY-4
    date: YYYY-MM-DD
---
变异红证禁用 checkout 还原；用文件备份法并在还原后确认 diff 为空。

## C-VER-08 数值断言分层
---
id: C-VER-08
title: 数值断言分层
category: verification
triggers: [数值断言, 确定性, 容差]
roles: [executor, reviewer]
phases: [implement, review]
severity: blocking
enforcement: review
check: 确定性断言双跑零容差；数值对照断言显式声明容差
evidence:
  - project: WaterPrint
    event: 容差掺入确定性断言留后门，绝对相等误报换算抖动
    ref: engineering-conventions.md GR-01
    date: YYYY-MM-DD
---
确定性断言与数值断言分层；确定性零容差，数值对照显式容差。

## C-VER-09 断言必须检验行为
---
id: C-VER-09
title: 断言必须检验行为
category: verification
triggers: [断言, 异常用例, 行为]
roles: [executor, reviewer]
phases: [implement, review]
severity: blocking
enforcement: review
check: 异常用例断言消息键；正常用例断言产出值，不只断不抛
evidence:
  - project: WaterPrint
    event: 异常测试不验消息键，异常类型被换照样绿
    ref: engineering-conventions.md GR-27
    date: YYYY-MM-DD
  - project: WaterPrint
    event: 名义表等值断言全绿但消费面行为错（死表面）
    ref: references/04-lessons.md 二、审计与测试类 WP-6（AU-2 死表面）
    date: YYYY-MM-DD
---
断言检验行为：异常用例断消息键，正常用例断产出值。

## C-VER-10 验算闭环主副算例全量
---
id: C-VER-10
title: 验算闭环主副算例全量
category: verification
triggers: [验算, 算例, 闭环]
roles: [executor, reviewer]
phases: [implement, review]
severity: warning
enforcement: review
check: 验算覆盖主算例与全部副算例
evidence:
  - project: WaterPrint
    event: 副算例漏检，由双审交叉抓获
    ref: references/04-lessons.md 三、协作与流程类 WP-12
    date: YYYY-MM-DD
---
验算闭环跑主算例与全部副算例；只跑主算例不算闭环。

## C-VER-11 不能用人工判断替代机检
---
id: C-VER-11
title: 不能用人工判断替代机检
category: verification
triggers: [机检, 人工判断, 缺位]
roles: [reviewer, adjudicator]
phases: [review, adjudicate]
severity: blocking
enforcement: review
check: 确认机检在场；不得以可人工甄别为由放行
evidence:
  - project: ai-dev-org
    event: 机检被人工判断替代，带 mock 字样的演练行靠人工甄别放行
    ref: references/04-lessons.md 七、ORG-5
    date: YYYY-MM-DD
---
机检不可由人工判断替代；无机检的验证面按缺位处理。

## C-VER-12 任何提交都跑同一套门禁
---
id: C-VER-12
title: 任何提交都跑同一套门禁
category: verification
triggers: [提交, 门禁, 亲笔]
roles: [executor, reviewer, adjudicator]
phases: [implement, review, close]
severity: blocking
enforcement: checklist
check: 每笔提交复跑同一门禁套件并留退出码，身份不免检
evidence:
  - project: WaterPrint
    event: 亲笔变更只跑定向测试，行数墙缺陷漏网，由独立复算逮出
    ref: references/04-lessons.md 九、ORG-14
    date: YYYY-MM-DD
---
任何提交都跑同一套门禁；亲笔变更不免检。
