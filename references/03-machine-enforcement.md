# 03 · 机器强制（规则怎么变成不可绕过的）

> 原理见 01·A2：写进文档不进检查的规则是建议。本册是两项目全部强制形态的目录+设计要领。
> 机检优先级阶梯：lint/CI > 单测 > e2e > 架构评审（越靠左越不可绕过）。

## 1. 门禁清单（本地一键全查）

**WP 形态**（`scripts/run_gates.py`，9 项，CI 与本地同口径）：
check_structure（文件职责表双向校验：表多=失败，表少=失败）· check_grep_gates
（占位/裸 except/乱码计数=0）· check_magic_numbers（**AST 级**扫描——注释里的数字
骗不过；数值字面量仅允许出现在真源区白名单）· check_module_graph（真实 import
扫描器：实现期依赖必须是图谱声明边的子集——边级数字以 WP 仓当期 verify 输出
为准，v2.0.1 修复批：项目 live 数字不驻技能正文）· check_readonly（锁定测试面
完整性）· check_ruff · check_file_budgets（≤500 行等）· check_webapp ·
check_contract_headers。

**SY 形态**（`npm run verify`，CI 同口径）：
quality（TODO/占位/mojibake/跨域白名单）· tickets（工单号引用一致性+done 无占位残留
+open UI 必须渲染徽标）· locks（受锁文件 sha256 对账——文件数以 SY 仓当期 verify
输出为准，不驻技能正文）· lint · typecheck · test · build——七合一，
**退出码是唯一真相**（文档不手写测试数）。

## 2. 测试面双锁（防"改测试让代码通过"）

三层防线【SY ADR-0004 / WP §7 同构】：
1. **内容锁**：manifest（sha256）入库，CI 对账，差异即红——跨平台内容真相；
2. **属性锁**：OS 只读属性——本地写屏障（Windows 实测有效，exFAT 亦然）；
3. **激活锁**【SY 特色】：锁定测试用 `guardedDescribe(ticketId)` 包装——工单 open
   时 skip（main 恒绿），翻 done 即激活；**不实现就翻状态→测试当场红**（防作弊 K3：
   实现者碰不了 registry，控制面单写者）。

**合法变更流程**：解锁（人类/收口者）→修改→重锁→该变更作为独立 commit 接受审查
（`[locked-change]` 尾注）→**即时重锁入同一提交**（CI 只查 push head，跨提交延迟
重生成会造成按提交回溯时的假绿）。测试变更是显式事件，不是顺手行为。
重锁口径：内容归一化哈希（CRLF→LF 后再算——工具行尾差异不得引爆校验），
携全部既有路径一次重锁并核对**恰数增减**（大面积哈希变动=停，报告）。

## 3. 确定性与验证矩阵

- **双跑字节同**：同输入两次执行序列化输出逐字节相同——把确定性变成机器断言【WP 常驻测试】；
- **incremental==全量重算**（字节级）【WP】；序列化往返无损；
- **验证矩阵**：任务书里"行为×证明"两列表（例：分流守恒→D3 探针②；表→代码零双轨→
  apply 计数+主算例逐项）——每个声称的行为都有对应的机器证明形态【WP 简报标配】；
- **正门探针**：链路/集成级探针必须经装配正门（如 `app.run_full_calc`），
  **禁止直跑底层绕过装配层**——直跑三批未察的潜伏缺陷教训【WP M2c】；
- **消费面行为断言**：映射表/异常表类代码必须断言消费端实值（HTTP 响应体实值），
  名义表等值断言不合格【WP AU-2 死表面教训】；
- **落盘+回读**：审计字段/导出件的唯一合格证明【WP NF-1】。

## 4. 变异红证（防假阳性）

写完先红再绿只是底线；上强度用**断言级变异红证**：
单 token 变异→恰中目标用例红→还原→diff 确认空。
对**未提交**实现做变异时禁 `git checkout`（会把实现一并抹掉）——用文件备份法：
`cp 备份 → 变异 → 测红 → cp 还原 → diff 空`【SY UBS 实证后入 DoD 常态】。

## 5. 分层与结构强制

- **import-linter 分层契约**：只许向下依赖；L3 子系统互不感知；单元包之间禁止互相
  import；跨包只走正门（`__init__.py` 白名单）；装配点唯一（graph 引擎禁止 import
  任何具体单元）【WP，5 kept 契约 CI 强制】；
- **ESLint 分层**：`ipc → services → repos → db`、`renderer → window.api → ipc`，
  禁跨层【SY】；
- **图谱双源一致**：结构图谱文档与 import-linter 契约由门禁双向校验——改一处必须
  同步另一处，否则 CI 失败【WP】；
- **规模预算**：文件 ≤500 行（ruff/ESLint max-lines error 级）；出现第二职责就拆；
- **类型单一真相源**：跨进程类型只从 shared 生成；前端客户端由 OpenAPI 生成物供给，
  生成物禁手改【SY/WP 同构】。

## 6. 安全禁令（否定式，一条都不许碰）

【SY 例】禁 `nodeIntegration:true`/`webSecurity:false`/`sandbox:false`/
`contextIsolation:false`；renderer 禁引 Node API 与绝对路径；未过 shell-guard 的
URL 禁 openExternal；禁字符串拼接 SQL（一律预编译+参数绑定）；禁 eval；新增出网
host 需 ADR+受锁变更。
**路径拼接专项**【WP AU-1 Critical 教训】：凡涉文件名/目录拼接且分量含客户端可控
输入——穿越用例（浅/深构造 4xx）+目录快照零新增断言为 DoD 必选项。
安全禁令写成否定式清单是为了可机检+审计可逐条对照。

## 7. 完成定义（DoD）模板

【WP 版】功能代码+测试提交全绿｜占位/裸 except/乱码门禁=0｜新文件已登记职责表｜
`git diff --stat` 无范围蔓延｜无死代码无运行时产物入库｜中文工具验证可读｜
行数预算内｜（M2 起）单元四件套齐备。

【SY 版】verify 全绿（七合一，与 CI 同口径）｜grep 无 TODO/FIXME/placeholder｜
无乱码｜diff --stat 无蔓延｜占位已删+工单翻状态｜新增受锁文件已 locks:apply。

**DoD 的元规则**：逐项打勾后才算完成；文档不手写数字，一律"以 CI 输出为准"。

## 8. 机检的证伪与校准

- blanket 禁令会撞合法例外（【SY】INV-02 空 catch 禁令误伤三处尽力而为→回退为
  规约化）——**回退不是失败而是校准**；每次机检化上线先跑一轮全量验证误伤；
- 机检摩擦项写进开工前置清单（摩擦常量化），禁每会话重新学费；
- CI 触发存在延迟窗口："未触发"定性须等复查窗口（如 10 分钟）再查——
  勿在窗口期内下结论【WP CIFIX 教训】；
- 校验类脚本设计时必须显式回答："**跨行尾/跨平台字节是否稳定**"【WP 行尾哈希地雷：
  工具 CRLF 写入 × gitattributes eol=lf × CI LF 检出三因巧合才爆，33 文件长期潜伏】。
