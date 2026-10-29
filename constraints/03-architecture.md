# 03 · 架构与代码（ARC）

> 状态：active ｜ 权威：normative ｜ 替代：无

本册承载状态机、代码组织、异常、确定性输出与原子落盘类约束。典型触发=改结构、拆文件、换方案、改异常、落盘。卡片字段规范单源=`docs/03` §4（跨仓=/home/yyx/work/aidevorg/docs/03-target-architecture.md §4）。

## C-ARC-01 按项目上限拆分文件
---
id: C-ARC-01
title: 按项目上限拆分文件
category: architecture
triggers: [文件行数, 拆分, 项目宪法, 超限]
roles: [planner, executor, implreview]
phases: [design, implement, review]
severity: blocking
enforcement: review
check: 逐文件核对行数与项目宪法上限；超限且无声明例外的文件为 0
evidence:
  - project: Synapse
    event: 3,303 行单文件难以读取修改，源项目上限 500 行、最大文件 429 行
    ref: "AI辅助开发经验教训.md §B1"
    date: YYYY-MM-DD
---
在项目宪法声明文件行数上限与例外；按该上限拆分超限文件。

## C-ARC-02 状态机先列态空间与事件
---
id: C-ARC-02
title: 状态机先列态空间与事件
category: architecture
triggers: [新增状态机, 改状态迁移, 跨步骤流程]
roles: [planner, executor, implreview]
phases: [design, implement, review]
severity: blocking
enforcement: review
check: 状态×事件迁移表覆盖全部状态与事件；跨步骤序列逐条走查并交审计确认
evidence:
  - project: Synapse
    event: U2 五轮返工，单格枚举未覆盖跨格序列并丢稿
    ref: references/04-lessons.md 二、审计与测试类 SY-2
    date: YYYY-MM-DD
---
写状态机前先列出全部状态、事件与迁移表，跨步骤序列逐条走查并交审计。

## C-ARC-03 提交前删除死代码
---
id: C-ARC-03
title: 提交前删除死代码
category: architecture
triggers: [死代码, 未引用文件, 重复资产, 提交前]
roles: [executor, implreview]
phases: [implement, review]
severity: blocking
enforcement: checklist
check: 提交前附未引用项检索结果；所列死代码均有删除 diff
evidence:
  - project: Synapse
    event: 孤儿组件、重复 pdf.js 与 stub 堆积，形成上下文噪音
    ref: "AI辅助开发经验教训.md §B2"
    date: YYYY-MM-DD
---
提交前检索并删除未引用文件、孤儿组件、重复资产与 stub。

## C-ARC-04 切换方案即删除旧方案
---
id: C-ARC-04
title: 切换方案即删除旧方案
category: architecture
triggers: [方案切换, 旧方案, 并存实现, 当前方案]
roles: [executor, implreview]
phases: [implement, review]
severity: blocking
enforcement: review
check: 方案切换 diff 含旧方案删除；检索实现入口时仅见当前方案
evidence:
  - project: Synapse
    event: PDFium、pdf.js 与手动 span 三套方案并存，当前实现难以判定
    ref: "AI辅助开发经验教训.md §B3"
    date: YYYY-MM-DD
---
切换实现方案时删除旧方案，只保留一套当前方案，不让多套实现并存。

## C-ARC-05 数值换算只走单一库
---
id: C-ARC-05
title: 数值换算只走单一库
category: architecture
triggers: [单位换算, 数值换算, 换算库, 手写系数]
roles: [planner, executor, implreview]
phases: [design, implement, review]
severity: blocking
enforcement: review
check: 换算调用均进入项目指定库；业务代码手写换算系数为 0，测试例外逐项可辨
evidence:
  - project: WaterPrint
    event: 手写换算系数是门禁漏网高发区；86400/86400.0 隐式整除与精度差异曾造成 Q_design 双轨
    ref: engineering-conventions.md GR-05
    date: YYYY-MM-DD
---
在项目宪法指定单一换算库；单位换算只经该库，手写换算系数仅可留在测试期望值。

## C-ARC-06 区分领域异常与程序缺陷
---
id: C-ARC-06
title: 区分领域异常与程序缺陷
category: architecture
triggers: [领域异常, 程序缺陷, 内部不变量, assert, Result]
roles: [planner, executor, implreview]
phases: [design, implement, review]
severity: blocking
enforcement: review
check: 逐失败点核对分类；业务失败有领域返回，程序缺陷保留断言或原始栈迹
evidence:
  - project: WaterPrint
    event: 把程序缺陷包装成领域异常会误导调参并丢失栈迹
    ref: engineering-conventions.md GR-08
    date: YYYY-MM-DD
---
将可预期业务失败作为领域异常或 Result 返回；对不可能态与内部不变量破坏使用 assert 或直接失败，不捕获、不包装。

## C-ARC-07 保证输出顺序确定
---
id: C-ARC-07
title: 保证输出顺序确定
category: architecture
triggers: [输出顺序, 无序集合, 落盘, 确定性, 中文键]
roles: [executor, implreview]
phases: [implement, review]
severity: blocking
enforcement: machine
check: 同一输入跨两个进程双跑并逐字节比对；确认直接迭代无序集合与未排序落盘键均为 0
evidence:
  - project: WaterPrint
    event: set 迭代序随进程与 PYTHONHASHSEED 变化，中文键还受 locale 影响，源项目以 sorted/key=repr 固定顺序
    ref: engineering-conventions.md GR-16
    date: YYYY-MM-DD
---
无序集合先按稳定键排序再构造产出；跨进程落盘前排序映射键，中文键使用固定排序键。

## C-ARC-08 用临时文件原子落盘
---
id: C-ARC-08
title: 用临时文件原子落盘
category: architecture
triggers: [落盘, 原子写, 临时文件, rename, 留存上限]
roles: [planner, executor, implreview]
phases: [design, implement, review]
severity: blocking
enforcement: review
check: 逐类落盘产物核对临时文件与 rename 同分区；中断测试无半截产物，留存配置在场
evidence:
  - project: WaterPrint
    event: 非原子覆盖会在崩溃时留下可消费的半截产物，无限留存致磁盘增长
    ref: engineering-conventions.md GR-38
    date: YYYY-MM-DD
---
落盘产物先写同分区临时文件，再用 rename 原子替换；在项目配置声明留存上限与清理策略。

## C-ARC-09 派发前清理代码上下文
---
id: C-ARC-09
title: 派发前清理代码上下文
category: architecture
triggers: [代码上下文, 派发前, 小文件, 死代码, 单一方案]
roles: [planner]
phases: [design]
severity: warning
enforcement: checklist
check: 派发记录逐项列出文件规模核对、死代码检索与方案数量三项结果
evidence:
  - project: Synapse
    event: 代码占用过多上下文，源条目以小文件、死代码删除与单一方案共同减少噪音
    ref: "AI辅助开发经验教训.md §G1"
    date: YYYY-MM-DD
---
派发前按文件规模、死代码、方案唯一三项核对代码上下文，即 C-ARC-01/03/04 的清单化核对。
