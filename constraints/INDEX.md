# 约束树索引（INDEX）

> 状态：active ｜ 权威：index ｜ 更新：2026-10-25 ｜ 替代：无

人读索引。机读索引=`index.json`（脚本生成，禁手改）。规则句单源=各册卡片，本表只做投影。
路由表依据=`docs/06` §4。本件的卡片 ID 出现位置受 `check` 第 6 条 (b) 校验；路由表与卡片清单的**内容**不参与机检，一致性由 P13 检索演练复核。

## 1. 册表

| 册 | 代号 | 文件 | 状态 |
|---|---|---|---|
| 01-context | CTX | `01-context.md` | 正式卡（P9） |
| 02-verification | VER | `02-verification.md` | 正式卡（P9） |
| 03-architecture | ARC | `03-architecture.md` | 正式卡（P10） |
| 04-collaboration | COL | `04-collaboration.md` | 正式卡（P10） |
| 05-documentation | DOC | `05-documentation.md` | 已建（P8b） |
| 06-environment | ENV | `06-environment.md` | 已建（P8b） |
| 07-orchestration | ORC | `07-orchestration.md` | 已建（P8b） |

## 2. 任务类型路由表

| 任务类型 | 先读 | 按需读 |
|---|---|---|
| 新功能 / 实现 / 修复 | CTX + VER | ARC、COL、ENV |
| 重构 / 迁移 | ARC + VER | CTX、ENV、COL |
| 代码审查 / 验收 | VER + COL | ARC、DOC |
| 设计 / 规划 | CTX + ARC | COL、DOC |
| 文档 / 规格 | DOC | CTX、ARC |
| 数据 / 计算 | VER + ARC | ENV、DOC |
| 环境 / 工具链 | ENV | ORC、VER |
| 多智能体编排 | ORC | COL、CTX |
| 结项 | 全部 blocking 卡 | — |

## 3. 卡片清单

| ID | 一句话规则 | 触发词 | 角色 | 执行方式 |
|---|---|---|---|---|
| C-CTX-01 | 业务代码第一笔提交前，先让仓库、门禁命令与最小测试各跑通一次。 | 新项目、开工、基线、第一笔提交 | planner、executor | checklist |
| C-CTX-02 | 规约先写验收标准；占位实现视为未完成，不得合入。 | 写任务书、验收标准、占位实现 | planner、executor | review |
| C-CTX-03 | 规约写满五层：行为、接口、架构、生命周期、文化。 | 写任务书、规约、五层 | planner | review |
| C-CTX-04 | 规约写全文件路径、关键代码与版本，实现者不必另找上下文。 | 写任务书、规约、上下文 | planner | review |
| C-CTX-05 | 先侦查后派发；实现者按任务书施工，不承担探索。 | 派发、侦查、任务书 | planner、executor | review |
| C-CTX-06 | 重写前先修流程；流程根因未除，不得重写。 | 重写、返工、根因 | planner、adjudicator | review |
| C-CTX-07 | 跨层类型用生成器同步；禁止手写两处类型互相对齐。 | 类型、跨层、生成器 | planner、executor | review |
| C-CTX-08 | 开工清单逐项打勾留痕后，再写业务代码。 | 开工、清单、打勾 | planner、executor | checklist |
| C-VER-01 | 测试入口统一为一条命令；测试数字以 CI 输出为唯一权威。 | 测试入口、CI、测试数字 | executor、reviewer | review |
| C-VER-02 | 每次提交前本地跑全量门禁，逐项留退出码。 | 提交前、门禁、全量 | executor、reviewer | checklist |
| C-VER-03 | 新写的测试必须先失败一次，再通过。只看到通过、没有看到失败，视为未验证。 | 新增测试、修改断言、修复缺陷 | executor、reviewer | machine |
| C-VER-04 | e2e 断言落到渲染出的真实文本；只断元素存在不算通过。 | e2e、断言、渲染文本 | executor、reviewer | review |
| C-VER-05 | 落盘数据配独立回读断言；只构造不回读视为未生效。 | 落盘、回读、断言 | executor、reviewer | review |
| C-VER-06 | 路径拼接必配穿越用例与目录快照比对，零新增才准合入。 | 路径拼接、安全、穿越用例 | executor、reviewer | machine |
| C-VER-07 | 变异红证禁用 checkout 还原；用文件备份法并在还原后确认 diff 为空。 | 变异测试、红证、还原 | executor | checklist |
| C-VER-08 | 确定性断言与数值断言分层；确定性零容差，数值对照显式容差。 | 数值断言、确定性、容差 | executor、reviewer | review |
| C-VER-09 | 断言检验行为：异常用例断消息键，正常用例断产出值。 | 断言、异常用例、行为 | executor、reviewer | review |
| C-VER-10 | 验算闭环跑主算例与全部副算例；只跑主算例不算闭环。 | 验算、算例、闭环 | executor、reviewer | review |
| C-VER-11 | 机检不可由人工判断替代；无机检的验证面按缺位处理。 | 机检、人工判断、缺位 | reviewer、adjudicator | review |
| C-VER-12 | 任何提交都跑同一套门禁；亲笔变更不免检。 | 提交、门禁、亲笔 | executor、reviewer、adjudicator | checklist |
| C-ARC-01 | 在项目宪法声明文件行数上限与例外；按该上限拆分超限文件。 | 文件行数、拆分、项目宪法、超限 | planner、executor、reviewer | review |
| C-ARC-02 | 写状态机前先列出全部状态、事件与迁移表，跨步骤序列逐条走查并交审计。 | 新增状态机、改状态迁移、跨步骤流程 | planner、executor、reviewer | review |
| C-ARC-03 | 提交前检索并删除未引用文件、孤儿组件、重复资产与 stub。 | 死代码、未引用文件、重复资产、提交前 | executor、reviewer | checklist |
| C-ARC-04 | 切换实现方案时删除旧方案，只保留一套当前方案，不让多套实现并存。 | 方案切换、旧方案、并存实现、当前方案 | executor、reviewer | review |
| C-ARC-05 | 在项目宪法指定单一换算库；单位换算只经该库，手写换算系数仅可留在测试期望值。 | 单位换算、数值换算、换算库、手写系数 | planner、executor、reviewer | review |
| C-ARC-06 | 将可预期业务失败作为领域异常或 Result 返回；对不可能态与内部不变量破坏使用 assert 或直接失败，不捕获、不包装。 | 领域异常、程序缺陷、内部不变量、assert、Result | planner、executor、reviewer | review |
| C-ARC-07 | 无序集合先按稳定键排序再构造产出；跨进程落盘前排序映射键，中文键使用固定排序键。 | 输出顺序、无序集合、落盘、确定性、中文键 | executor、reviewer | machine |
| C-ARC-08 | 落盘产物先写同分区临时文件，再用 rename 原子替换；在项目配置声明留存上限与清理策略。 | 落盘、原子写、临时文件、rename、留存上限 | planner、executor、reviewer | review |
| C-ARC-09 | 派发前按文件规模、死代码、方案唯一三项核对代码上下文，即 C-ARC-01/03/04 的清单化核对。 | 代码上下文、派发前、小文件、死代码、单一方案 | planner | checklist |
| C-COL-01 | 简报评审先自查需求源内部一致性；发现矛盾时按主授权消解并记档。 | 简报评审、需求源、一致性、主授权 | planner、reviewer | review |
| C-COL-02 | 审计发现两种口径无法同时成立时，列出冲突与影响并交所有者裁定，不自行选值。 | 口径冲突、审计门、所有者裁定、复算 | reviewer、adjudicator | review |
| C-COL-03 | 派发代理涉及仓库外材料时，在 prompt 写明绝对路径，并显式声明该目录在仓库外。 | 代理派发、仓库外材料、绝对路径、prompt | planner | review |
| C-COL-04 | 在项目宪法声明返工上限，未声明时不超过 2 轮；每轮量化回归用例与 diff 净增量，超限即终止并交用户。 | 返工、修复轮、返工上限、净增 diff | executor、reviewer、adjudicator | review |
| C-COL-05 | 实现与验收分岗；锁定测试文件及其激活状态，实现者不得改测试或关闭用例，验收 registry 仅由结项者变更。 | 实现验收分离、测试锁、激活锁、registry、控制面 | executor、reviewer、adjudicator | review |
| C-COL-06 | 偏离任务书的任何处置都在报告中逐条写明位置、理由与影响，删减面附 diff 级自查，没有偏离也要写『无』。 | 任务书执行、返工、自裁处置 | executor、reviewer、adjudicator | review |
| C-COL-07 | 审计账本以流水终态为唯一来源派生截断标记，分别记录完整、截断与失败；未知终态按非完整处理。 | 审计账本、流水终态、截断标记、未知终态 | planner、executor、reviewer | machine |
| C-COL-08 | 修改接缝一侧时核对相邻另一侧的声明与消费；两侧互斥即停止并上报。 | 接缝、相邻声明、语义漂移、互斥 | executor、reviewer | review |
| C-DOC-04 | 规范与校验器必须同步演进 | 改规范、改校验脚本、新增机检 | planner、executor、reviewer | checklist |

P10 起 CTX/VER/ARC/COL 已正式化（四册 37 张＋DOC 样卡 1 张＝清单 38 行），DOC/ENV/ORC 留 P11-P12；张数目标见 `docs/08-lessons-merge.md` §3。
