# 约束树索引（INDEX）

> 状态：active ｜ 权威：index ｜ 更新：2026-10-23 ｜ 替代：无

人读索引。机读索引=`index.json`（脚本生成，禁手改）。规则句单源=各册卡片，本表只做投影。
路由表依据=`docs/06` §4。本件的卡片 ID 出现位置受 `check` 第 6 条 (b) 校验；路由表与卡片清单的**内容**不参与机检，一致性由 P13 检索演练复核。

## 1. 册表

| 册 | 代号 | 文件 | 状态 |
|---|---|---|---|
| 01-context | CTX | `01-context.md` | 已建（P8a） |
| 02-verification | VER | `02-verification.md` | 已建（P8b） |
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
| C-CTX-01 | 先建基线再写业务代码 | 新项目、开工、基线、第一笔提交 | planner、executor | checklist |
| C-VER-03 | 新测试必须先失败一次 | 新增测试、修改断言、修复缺陷 | executor、reviewer | machine |
| C-ARC-02 | 状态机先列态空间与事件 | 新增状态机、改状态迁移、跨步骤流程 | planner、executor、reviewer | review |
| C-COL-06 | 偏离任务书必须逐条申报 | 任务书执行、返工、自裁处置 | executor、reviewer、adjudicator | review |
| C-DOC-04 | 规范与校验器必须同步演进 | 改规范、改校验脚本、新增机检 | planner、executor、reviewer | checklist |

P8 两批共 5 张样卡（P8a 建 1 张、P8b 建 4 张）；P9–P12 按各册目标张数重写为正式卡并补齐，张数目标见 `docs/08-lessons-merge.md` §3。
