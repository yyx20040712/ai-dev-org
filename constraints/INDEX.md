# 约束树索引（INDEX）

> 状态：active ｜ 权威：index ｜ 更新：2026-10-26 ｜ 替代：无

人读索引。机读索引=`index.json`（脚本生成，禁手改）。规则句单源=各册卡片，本表只做投影。
路由表依据=`docs/06` §4。本件的卡片 ID 出现位置受 `check` 第 6 条 (b) 校验；路由表与卡片清单的**内容**不参与机检，一致性由 P13 检索演练复核。

## 1. 册表

| 册 | 代号 | 文件 | 状态 |
|---|---|---|---|
| 01-context | CTX | `01-context.md` | 正式卡（P9） |
| 02-verification | VER | `02-verification.md` | 正式卡（P9） |
| 03-architecture | ARC | `03-architecture.md` | 正式卡（P10） |
| 04-collaboration | COL | `04-collaboration.md` | 正式卡（P10） |
| 05-documentation | DOC | `05-documentation.md` | 正式卡（P11） |
| 06-environment | ENV | `06-environment.md` | 正式卡（P11） |
| 07-orchestration | ORC | `07-orchestration.md` | 正式卡（P12） |

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
| C-DOC-01 | 发现文档与现实矛盾时删除过时文档只留一份权威，不留两份并存。 | 文档矛盾、单一权威、README、删文档 | executor、reviewer | review |
| C-DOC-02 | 文档不手写易过期的具体数字，数字口径写以 CI 输出为准的指针。 | 文档数字、测试数、手写数字、CI | planner、executor、reviewer | review |
| C-DOC-03 | 中文内容统一 UTF-8；写入后用工具读回验证可读，乱码即未验证。 | 编码、乱码、中文文档、UTF-8 | executor、reviewer | checklist |
| C-DOC-04 | 新增规范条款时，能机检的同批落成校验项，不能机检的写明人工判据。 | 改规范、改校验脚本、新增机检 | planner、executor、reviewer | checklist |
| C-DOC-05 | 每类事实只写入寻址表指定的唯一真相源，他处引用用指针不在正文抄写。 | 唯一真相源、寻址表、双源、正文抄写 | planner、executor、reviewer | review |
| C-DOC-06 | 历史件只追加或归档，禁原地改写；发现错误新增勘误件引用原位置。 | 历史记录、改写、勘误、追加 | executor、reviewer、adjudicator | review |
| C-DOC-07 | API 明细由代码注解与生成命令产出，禁手抄端点清单。 | API 文档、生成命令、手抄、端点清单 | planner、executor、reviewer | review |
| C-DOC-08 | 功能面变化随批次回写手册与变更日志，契约面变化随批再生成 API 注解，不留事后补写窗口。 | 产品文档、回写、变更日志、事后补写 | planner、executor | checklist |
| C-ENV-01 | Windows 下删除文件用 Python 的删除接口，不用 Git Bash rm。 | 删文件、Git Bash、rm、Windows | executor、reviewer | checklist |
| C-ENV-02 | Git Bash 下运行 tar 或 npm 前置系统目录使系统解包工具优先，避免盘符冒号被当主机名。 | tar、npm、Git Bash、盘符 | executor、reviewer | checklist |
| C-ENV-03 | 序列化时间戳统一 UTC 加 ISO 8601 含 Z 后缀，禁本地时间字符串与自选格式；时间戳不进设计态与内容哈希。 | 时间戳、UTC、ISO 8601、本地时间 | executor、reviewer | review |
| C-ENV-04 | 目录删除失败不判数据失败；核对落盘清单与数据实测，残留目录延后清理。 | 目录删除、迁移、残留目录、ENOTEMPTY | executor、reviewer | checklist |
| C-ENV-05 | 迁移后重建环境再验收；重锁必携 manifest 反推全量包路径，以哈希零变动为准。 | 迁移、环境重建、manifest、哈希验收 | executor、reviewer | checklist |
| C-ENV-06 | 升级前查预编译兼容矩阵；安装钩子被移除的版本显式补安装步骤。 | 升级、预编译、安装钩子、兼容矩阵 | executor、reviewer | checklist |
| C-ENV-07 | 新增布尔名用 is_/has_/allow_ 前缀并禁否定布尔；标识符只用 ASCII 字母数字下划线。 | 命名、布尔前缀、标识符、字符集 | executor、reviewer | review |
| C-ORC-01 | 并行派发前列出各任务写面，写不同文件且无共享状态才可并行；写同文件或共享状态必须串行。 | 并行派发、写面隔离、同文件、共享状态 | planner、executor、reviewer | checklist |
| C-ORC-02 | 绑定岗代理档案显式声明具体模型与档位，禁用上游枚举值；首场派发后核对声明与实际路由，并逐项处理 metadata 形态漂移告警。 | 代理档案、模型绑定、thoughtLevel、静默回退、metadata | planner、executor、reviewer、diagnostics | machine |
| C-ORC-03 | 修改代理档案或模型档位后，不在原会话认定生效；另起新会话执行最小派发并核对工具面与绑定快照。 | 代理档案、改档、新会话 | planner、executor、diagnostics | checklist |
| C-ORC-04 | 长任务派发前压缩审包并声明唯一超时源与简报预算，失败后按服务端、网关、客户端三层分诊；证据与结论同笔提交，逐条命令单独落真退出码。 | 长任务派发、三层分诊、审包体积、超时、真退出码 | planner、executor、reviewer、diagnostics | checklist |
| C-ORC-05 | 调度定时或闲时任务前，只读核对全系统进程、锁与目标目录活动静默窗并区分断点，既有任务只增不改且不得杀进程清场；闲时不派后台子代理，仅承载只读或可重跑工作，开工先提交且不依赖自动重试。 | 定时任务、闲时任务、占用检测、断点接续、静默窗 | planner、executor、diagnostics | checklist |
| C-ORC-06 | 子代理档案显式声明工具边界，禁止用空 tools 数组充当无工具配置；任务书写明子代理不得再派子代理，嵌套需求交主控重拆。 | 子代理、工具白名单、tools、嵌套派发 | planner、executor、reviewer | checklist |

P12 起 CTX/VER/ARC/COL/DOC/ENV/ORC 已正式化（七册 58 张＝清单 58 行）；张数目标见 `docs/08-lessons-merge.md` §3。
