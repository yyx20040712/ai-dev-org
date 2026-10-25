# 约束树索引（INDEX）

> 状态：active ｜ 权威：index ｜ 更新：2026-10-25 ｜ 替代：无

人读索引。机读索引=`index.json`（脚本生成，禁手改）。规则句单源=各册卡片，本表只做投影。
路由表依据=`docs/06` §4。本件的卡片 ID 出现位置受 `check` 第 6 条 (b) 校验；路由表与卡片清单的**内容**不参与机检，一致性由 P13 检索演练复核。

## 1. 册表

| 册 | 代号 | 文件 | 状态 |
|---|---|---|---|
| 01-context | CTX | `01-context.md` | 正式卡（P9） |
| 02-verification | VER | `02-verification.md` | 正式卡（P9） |
| 03-architecture | ARC | `03-architecture.md` | 已建（P8b） |
| 04-collaboration | COL | `04-collaboration.md` | 已建（P8b） |
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
| C-ARC-02 | 状态机先列态空间与事件 | 新增状态机、改状态迁移、跨步骤流程 | planner、executor、reviewer | review |
| C-COL-06 | 偏离任务书必须逐条申报 | 任务书执行、返工、自裁处置 | executor、reviewer、adjudicator | review |
| C-DOC-04 | 规范与校验器必须同步演进 | 改规范、改校验脚本、新增机检 | planner、executor、reviewer | checklist |

P9 起 CTX/VER 已正式化（20 张），其余样卡 P10-P12 重写；张数目标见 `docs/08-lessons-merge.md` §3。
