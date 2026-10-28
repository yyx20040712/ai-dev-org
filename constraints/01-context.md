# 01 · 任务书与上下文（CTX）

> 状态：active ｜ 权威：normative ｜ 替代：无

本册承载任务书、上下文预算与跨会话接续类约束。典型触发=新项目开工、写任务书、交底、会话接续。

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
    date: YYYY-MM-DD
  - project: Synapse
    event: 无版本仓库致 CI 缺位，重写后旧问题复发
    ref: "AI辅助开发经验教训.md §E1＋§F2"
    date: YYYY-MM-DD
---
业务代码第一笔提交前，先让仓库、门禁命令与最小测试各跑通一次。

## C-CTX-02 规约先写验收标准，占位即未完成
---
id: C-CTX-02
title: 规约先写验收标准，占位即未完成
category: context
triggers: [写任务书, 验收标准, 占位实现]
roles: [planner, executor]
phases: [design, implement]
severity: blocking
enforcement: review
check: 任务书附可核对验收标准；合入前核对占位标记清零
evidence:
  - project: Synapse
    event: 占位实现混入真功能，缺少完成定义
    ref: "AI辅助开发经验教训.md §A4"
    date: YYYY-MM-DD
---
规约先写验收标准；占位实现视为未完成，不得合入。

## C-CTX-03 规约给五层：行为接口架构生命周期文化
---
id: C-CTX-03
title: 规约给五层：行为接口架构生命周期文化
category: context
triggers: [写任务书, 规约, 五层]
roles: [planner]
phases: [design]
severity: warning
enforcement: review
check: 任务书五层逐层在场；缺任一层退回补写
evidence:
  - project: Synapse
    event: 规约只给行为层，生成代码与既有代码不兼容
    ref: "AI辅助开发经验教训.md §A1＋§五层规约骨架"
    date: YYYY-MM-DD
---
规约写满五层：行为、接口、架构、生命周期、文化。

## C-CTX-04 规约自包含：全路径＋关键代码＋版本
---
id: C-CTX-04
title: 规约自包含：全路径＋关键代码＋版本
category: context
triggers: [写任务书, 规约, 上下文]
roles: [planner]
phases: [design]
severity: warning
enforcement: review
check: 任务书含文件全路径、关键代码段与版本声明
evidence:
  - project: Synapse
    event: 规约缺路径、版本与现有接口，实现时上下文缺关键信息
    ref: "AI辅助开发经验教训.md §G2"
    date: YYYY-MM-DD
---
规约写全文件路径、关键代码与版本，实现者不必另找上下文。

## C-CTX-05 先侦查后派发，实现者不当探索者
---
id: C-CTX-05
title: 先侦查后派发，实现者不当探索者
category: context
triggers: [派发, 侦查, 任务书]
roles: [planner, executor]
phases: [design, implement]
severity: warning
enforcement: review
check: 任务书附侦查结论；实现岗按书施工，无自行探索面
evidence:
  - project: Synapse
    event: 上下文被无关探索淹没，实现与侦查混在一岗
    ref: "AI辅助开发经验教训.md §G1"
    date: YYYY-MM-DD
---
先侦查后派发；实现者按任务书施工，不承担探索。

## C-CTX-06 重写前先修流程
---
id: C-CTX-06
title: 重写前先修流程
category: context
triggers: [重写, 返工, 根因]
roles: [planner, adjudicator]
phases: [design, adjudicate]
severity: warning
enforcement: review
check: 重写提案附流程根因结论；流程缺陷未修不批重写
evidence:
  - project: Synapse
    event: 同一产品第三次重写，重写重置已修复缺陷
    ref: "AI辅助开发经验教训.md §F1＋§六守则三"
    date: YYYY-MM-DD
---
重写前先修流程；流程根因未除，不得重写。

## C-CTX-07 类型跨层同步用生成器，禁手写双写
---
id: C-CTX-07
title: 类型跨层同步用生成器，禁手写双写
category: context
triggers: [类型, 跨层, 生成器]
roles: [planner, executor]
phases: [design, implement]
severity: warning
enforcement: review
check: 类型定义单源；跨层类型由生成器产出，无双写文件
evidence:
  - project: Synapse
    event: 三层手动同步类型反复漂移，最后靠删保护绕过
    ref: "AI辅助开发经验教训.md §A2"
    date: YYYY-MM-DD
---
跨层类型用生成器同步；禁止手写两处类型互相对齐。

## C-CTX-08 开工清单逐项打勾后再写业务代码
---
id: C-CTX-08
title: 开工清单逐项打勾后再写业务代码
category: context
triggers: [开工, 清单, 打勾]
roles: [planner, executor]
phases: [design, implement]
severity: warning
enforcement: checklist
check: 开工清单九项逐项打勾留痕，全勾后才动业务代码
evidence:
  - project: Synapse
    event: 开工速查表逐条打勾，防线先于业务代码
    ref: "AI辅助开发经验教训.md §五"
    date: YYYY-MM-DD
---
开工清单逐项打勾留痕后，再写业务代码。
