# 05 · 文档与语言（DOC）

> 状态：active ｜ 权威：normative ｜ 替代：无

本册承载单一真相源、历史记录、生成物与语言类约束。典型触发=写文档、改规格、整理索引。卡片字段规范单源=`docs/03` §4（跨仓=/home/yyx/work/aidevorg/docs/03-target-architecture.md §4）。

## C-DOC-01 矛盾时删文档只留一份权威
---
id: C-DOC-01
title: 矛盾时删文档只留一份权威
category: documentation
triggers: [文档矛盾, 单一权威, README, 删文档]
roles: [executor, reviewer]
phases: [implement, review]
severity: blocking
enforcement: review
check: 检索同一事实的全部文档承载处；发现矛盾时保留正确一份并删除其余，diff 含删除记录
evidence:
  - project: Synapse
    event: README 声称无 PDFium 但文件在仓，文档与现实脱节形成权威冲突
    ref: "AI辅助开发经验教训.md §C2"
    date: YYYY-MM-DD
---
发现文档与现实矛盾时删除过时文档只留一份权威，不留两份并存。

## C-DOC-02 文档不写易过期数字
---
id: C-DOC-02
title: 文档不写易过期数字
category: documentation
triggers: [文档数字, 测试数, 手写数字, CI]
roles: [planner, executor, reviewer]
phases: [design, implement, review]
severity: warning
enforcement: review
check: 逐份文档检索易过期的具体数字（测试数、覆盖率等）；数字处改为指向 CI 输出的指针
evidence:
  - project: Synapse
    event: 测试数 30/52/59/75/452 在多份文档间互相矛盾，手写数字必然过期
    ref: "AI辅助开发经验教训.md §C3"
    date: YYYY-MM-DD
---
文档不手写易过期的具体数字，数字口径写以 CI 输出为准的指针。

## C-DOC-03 中文统一 UTF-8 并验证可读
---
id: C-DOC-03
title: 中文统一 UTF-8 并验证可读
category: documentation
triggers: [编码, 乱码, 中文文档, UTF-8]
roles: [executor, reviewer]
phases: [implement, review]
severity: warning
enforcement: checklist
check: 写中文文档后用工具读回验证可读；发现双重编码或乱码即修复并重验
evidence:
  - project: Synapse
    event: PROCESS.md 双重编码损坏，工具链编码不一致
    ref: "AI辅助开发经验教训.md §C4"
    date: YYYY-MM-DD
---
中文内容统一 UTF-8；写入后用工具读回验证可读，乱码即未验证。

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
    ref: references/04-lessons.md 七、ORG-11
    date: YYYY-MM-DD
---
新增规范条款时，能机检的同批落成校验项，不能机检的写明人工判据。

## C-DOC-05 事实按寻址表落唯一真相源
---
id: C-DOC-05
title: 事实按寻址表落唯一真相源
category: documentation
triggers: [唯一真相源, 寻址表, 双源, 正文抄写]
roles: [planner, executor, reviewer]
phases: [design, implement, review]
severity: blocking
enforcement: review
check: 写文档先查寻址表定该类事实的唯一真相源；正文新增承载段前核对是否与主承载重复
evidence:
  - project: ai-dev-org
    event: 寻址表定每类事实的唯一真相源与禁止出现处
    ref: references/08-doc-governance.md 1. 事实分层寻址表
    date: YYYY-MM-DD
---
每类事实只写入寻址表指定的唯一真相源，他处引用用指针不在正文抄写。

## C-DOC-06 历史件只追加或归档
---
id: C-DOC-06
title: 历史件只追加或归档
category: documentation
triggers: [历史记录, 改写, 勘误, 追加]
roles: [executor, reviewer, adjudicator]
phases: [implement, review]
severity: blocking
enforcement: review
check: 逐件核对已成档过程记录的 diff；原地改写为 0，追加与归档留痕，纠错走勘误件引用原位置
evidence:
  - project: ai-dev-org
    event: 改写历史记录制造当时就这么说的伪证，删除尚可在版本历史中考证
    ref: references/08-doc-governance.md 3. 历史件禁改写
    date: YYYY-MM-DD
---
历史件只追加或归档，禁原地改写；发现错误新增勘误件引用原位置。

## C-DOC-07 API 明细由生成命令产出
---
id: C-DOC-07
title: API 明细由生成命令产出
category: documentation
triggers: [API 文档, 生成命令, 手抄, 端点清单]
roles: [planner, executor, reviewer]
phases: [design, implement, review]
severity: warning
enforcement: review
check: API 文档核对生成命令在场；手抄端点清单与手改生成明细为 0
evidence:
  - project: ai-dev-org
    event: 手抄端点清单与代码双源必漂移，API 明细定为代码注解加生成命令产出
    ref: references/09-product-docs.md 1. 事实分层
    date: YYYY-MM-DD
---
API 明细由代码注解与生成命令产出，禁手抄端点清单。

## C-DOC-08 产品文档随批次回写
---
id: C-DOC-08
title: 产品文档随批次回写
category: documentation
triggers: [产品文档, 回写, 变更日志, 事后补写]
roles: [planner, executor]
phases: [implement, close]
severity: warning
enforcement: checklist
check: 每批次结束核对功能面与契约面变化；手册与变更日志回写、API 注解再生成记录在场
evidence:
  - project: ai-dev-org
    event: 事后补写产品文档造成失实，回写定为批次结束动作
    ref: references/09-product-docs.md 2. 生命周期
    date: YYYY-MM-DD
---
功能面变化随批次回写手册与变更日志，契约面变化随批再生成 API 注解，不留事后补写窗口。
