# 残留登记册（ai-dev-org）

> 三态：open=待处置／won't-fix=显式不修＋依据／closed=已了结。
> 静默消失=违规：仍被其他文件指称的行 ID 不得从本册删除。
> 本册迁出内容（修订记 21 条＋已关闭触发器行 11 条，字节级留存）=/home/yyx/.zcode/skills/_archive/ai-dev-org-history-2026-10/RESIDUALS.md。
> 更早历史=技能仓 git 提交历史（2026-09 归档件已不在盘面）。
> 本册范围=open 表（含 won't-fix 终态行）＋新登记。

## open 表

| 编号 | 事项 | 触发处置 | 状态 |
|---|---|---|---|
| evolve-b1-transportresidual | 三项行为在本机无法实证：超过 300 秒的首字节延迟、Node25 的退出码表现、非标准端点的流式语义 | 真实外呼窗口开放时核验（R1 真跑或设计岗首次使用） | open |
| evolve-k2-silent | k2 承载源首次派发曾出现一次静默失败（至今单次） | 再次发生且累计满 2 次时，升级为宿主排查批次 | open |
| g3-deploy-writereal | 派生覆盖件在异机真机上的写盘效果未验证过 | 下次新机部署时首跑 --install 核对 | open |
| PostToolUse-livefire | PostToolUse hook 的实弹触发（真实拦截）未验证过 | 在需要机器强制（hook 拦截）的批次首场核对 | open |
| killed-agent-metadata-gap | 岗位被终止后其 metadata 缺少可核对的声明值 | 后续批次把派发记录回填做成机检 | open |
| check-anchors-calibration | 三处校准面待定：全角冒号形态、dod.md 扫描面、点名豁免漂移面 | 在决定 check-anchors 升 --strict 的批次之前先处理 | open |
| host-metadata-schema-drift | 宿主子代理 metadata 格式演进会让检测面失明；已发生一例：2026-09-17 profileSnapshot.model 从字符串改为 modelSelection 结构体，旧检测静默跳过新格式（声明读取器 declaredModelOf 现已兼容两种格式） | 宿主升级后首场绑定岗派发时，核对 metadata 格式仍被 declaredModelOf 识别；log-triage 出现「格式漂移疑似」告警即处置 | open |
| empty-declared-blindspot | 空字符串 model 声明会被当成非绑定岗静默跳过（检测只查非字符串形态；宿主对空串的语义尚未确证；实证裁决岗 B3 登记） | 宿主 metadata 实测出现 model:"" 时处置：先确证语义，再定跳过或漂移口径 | open |
| log-triage-import-side-effect | log-triage.mjs 顶层缺 import.meta.main 守卫，被 import 时会直接执行命令行主流程（批前既有行为） | 出现以模块方式消费该文件的需求时补守卫（当前消费面=命令行与自检，无实害） | open |
| volta-exitcode-mask | volta run 会把任何非零退出码掩成 126（本机 2026-09-17 实测：1/2/3 都变成 126，0 正常，直接跑 node 不受影响；DEPLOY.md 已有提示） | 出现必须经 volta run 且要消费精确退出码的封装时处置（用 volta pin 固定默认版本，或直接跑 node） | open |
| probe-bc-metadata-residue | 两个已结束会话的 metadata 残留（声明值对应不上任何真实岗档）给 log-triage 检测输出带来噪声（2026-09-22 全局诊断发现） | log-triage 检测呈现面升级时过滤无岗档的会话；新的同形态会话复发即升级宿主排查批次 | open |
| synapse-md-expand | Synapse 项目仓的 md 门禁扩面属项目侧范围，本技能未覆盖 | 由 Synapse 项目仓独立批次处理 | open |
| share-gate-drive-residual | 分享门禁的盘符维度有已知漏报族：目录段首字符为转义字母且第二个字符不是字母数字的路径形态（正反斜杠同理） | 发生真实泄漏事件或扫描器升级批次时处置；日常由门禁其余两个维度加文件名通道覆盖 | open |
| d1-secondpass-w1-falsified | 审核岗二过提出的 W-1 疑点（share-whitelist 残留目录级 E:\ 宽豁免）已被机检证伪：两条 E:\ 条目均为文件定址，references/ 前缀条目只有两个具体串（结论登记在案，防复发再猜） | 无（证伪结案；改动白名单的批次随批复核该面） | won't-fix（证伪） |
| render-typo-key-residual | 绑定模板占位键拼写错误（形如 bindnig，不含 binding 子串）会绕过渲染检测静默直装；标准、畸形、未闭合三形态已覆盖，本行只管键名拼写面 | 模板占位键重构批次或首次见到笔误造成实害时处置（放宽为全部 {{…}} 残留检测加标准形白名单）；deploy-check 渲染对账可在部署后兜底发现 | open |
| synapse-temporal-defect-refine | Synapse 项目提炼出三条时间维度测试升级候选（断流回流的共享工具函数抽取、瞬态缺陷多时刻采样固化为常驻用例、涉 CSS 过渡的票面验收必含时间维度断言），按用户裁决暂挂账不实施（裁决与过程=git 历史〈2026-10-01〉条） | Synapse 编辑器交互批次结项时盘点：同类时间维度缺陷复现一次及以上，三条候选随批实施；零复现，降级为项目事故档常规行。第二个前端项目出现同型缺陷时，再议是否收录进本技能 | open |
| synapse-skill-consolidation-window | 用户已裁决：脉络图项目结束后集中维护技能库（综合大技能与伞形索引两案待裁；主控异议与两案内容=git 历史〈2026-10-01〉条） | 脉络图批次组结项后由用户启动集中维护期：先做技能库重复面盘点，再做两案对照汇报，用户裁决后分批实施 | open |
| synapse-exhaust-debt | Synapse 项目有一笔 auditor-readonly 的 exhaust 补还未完成（2026-10-01 记账；当时的回退只读审已处置），health-scan 因此常驻一条 RED | Synapse 下场批首派 auditor-readonly 补还出 ok 行，health-scan RED 归零即结案；连续两个关键批次未补还则升级给用户 | open |

## 新登记

后续发现的新残留在此追加，格式同上表。

| 编号 | 事项 | 触发处置 | 状态 |
|---|---|---|---|
| R-Y2-3 | 账户计划型模型源（宿主 account:bigmodel-start-plan 等）不在技能双注册表面——validateProviders 不支持、slot 镜像无法落位（2026-10-24 startplan 执行岗试装后回退，实录=账本 y2-executor-startplan-ruling 行；登记面=handoff-2026-10-24-05 §4） | 已由 L19 批承载（2026-10-24 用户指令提前）：validate 增计划源分支（account_plan_allowlist 本机允许清单）＋slot/矩阵/绑定/默认席全链落位＋网络归因实证（log-triage [startplan] ok=163，空源限制消除）；对抗链=任务书四轮审核+双审+W1 仲裁证伪+终检 CLOSABLE 附条件 2 落实 | closed |
| R-L19-1 | account_plan_allowlist 只约束 providers 声明面，未约束 agent_bindings 消费面：绑定值写成 account:<未列入清单计划>/模型$档 仍可通过 validate/doctor/deploy-check（slot.model 与 level 对得上即过）；本机实值一致未触发（双审 ds-N1，2026-10-24） | 在 validateLocalFacts 或 doctor D4 增加绑定 provider 段与 providers.<slot.provider>.uuid_prefix（account: 源再对 allowlist）一致性核对的脚本批；此前人工换绑时主控亲核绑定值 | open |
| R-L19-2 | 文档/镜像滞后族（L19 双审与终检登记，2026-10-24；Y3 批同日部分关闭）：矩阵 roles.adjudicator default=699 vs 实际 zipoo（Y3 已对齐 zipoo＋fallback 全序）；deploy-check 指引文案未含账户源填法（Y3 已补 note 串＋DEPLOY §3）；docs/12 第 1.1 节「D27 规定 glmflash 实现」残句已随 Y5 清（单行改真，R-Y1-2 同批承载 docs/07 第 8 节 旧口径改真）；余两项=两仓 reviewer 回退序残差（技能仓矩阵 [699,yyx,zipoo,glm,glmflash,ds] vs 项目镜像 [699,yyx,ds,zipoo,glm,glmflash]）＋log-triage aliasOf 原串前缀匹配与 validate 大小写归一不一致（实值全小写未触发） | 余两项：回退序残差随下个镜像触点批对齐；触及脚本逻辑面的（aliasOf 归一）单开脚本批 | open（Y5 收窄） |
| R-Y4-1 | references 词面清理缺口与 --strict 切换条件（Y4 登记；Y5 批收窄，2026-10-25）：00/04 已随 Y5 清零（映射区住 term-scan 豁免区）——技能仓活动面终态=存量恰 353 次/基线恰 110 组（E-2/E-3 双向恰等，terms-baseline 随批重冻）；余量分布=01/02/03/05/06/07/08/09/10/DEPLOY（02 余机关节旧称 3 处不清零）；--strict 绝对零切换在存量>0 持续禁切 | 后续批逐件清理至零后切 --strict；D29④「Y5 后绝对零」按实际缺口重申报（现值 353），勿硬切 | open（Y5 收窄） |
| R-Y4-2 | 2026-09 归档路径盘面失联（Y4 批登记，2026-10-24；F-19/F-20 实证）：`_archive/` 唯一在位=ai-dev-org-history-2026-10（单件 RESIDUALS.md）；2026-09 系归档目录（ai-dev-org-history-2026-09 含 CHANGELOG/audits 等 65 件族）实体去向待查（盘外备份或已灭失），历史承载=git 提交历史。同族：references/06 L12-13 与 08 L56 仍引 `loop-engineering-archive-2026-09/`（Y4 终检 N 级并入本行）——SKILL.md Y4 版已改真指针（2026-10 真路径＋git 承载，不落失联路径） | 06/08 的失联路径随 references 词面批顺带改真或标注失联；2026-09 实体下落由用户知悉后裁决是否追索（git 历史可回溯，不阻断） | open |
| R-Y5-1 | 文档微残余族（Y5 批登记，2026-10-25；首读/终检 N 级合流；L24 收窄——L40 行两处节引已改「第 N 节」形，check-anchors 两处提示消除，该子项随 L24 批闭合）：04 §七节题未覆盖表内 ORG-10/11（批次归属=母本既有未清事项，非 Y5 回归）；00 L103-104 注释行与标题间缺空行＋L103/L93 单源声明语句重述；00 L3「会被 pre-commit 快扫拦截」仍偏断言（残句轻余） | 下个 00/04 词面触点批顺手清；§七节题修订须先核 ORG-10/11 批次归属（历史区/git） | open（L24 收窄） |
| R-Y5-2 | 工具与实例故障族（Y5 批登记，2026-10-25）：①Y4 任务书判据 #12b 的 grep -P 模式用了管道转义（PCRE 下=字面管道符）——历史判据恒 0 空跑（真实覆盖由 verify-docs E-4 承载，Y5 #13 已改未转义正确形态）；②审核岗 699 族一实例两轮空回执（转录 0 字节，约 465k subagent tokens 无产出——实例级故障，2026-10-24） | ①机检命令模板的转义规则候选入 check-taskbook 加固（-E/-P 模式禁管道转义的 lint）；②空回执复发且累计满 2 次时升级宿主排查批 | open |
| R-L18-1 | 项目仓 tasks 面棘轮 golden 的手工洗白面（L18 终检遗留登记，2026-10-25）：项目仓 scripts/ 下 term-baseline-tasks.json 的信任根=磁盘文件——先手工上调分件冻结再跑 `--update-terms` 可绕过只降不升（前置校验对象是当前 golden）；V5 重冻语义=files 重写为当次扫描现存件全量（0 命中件按 0 落盘） | 维护规程=golden 变更只走 `--update-terms` 或随批 diff 复核；更强约束（git HEAD 对账/哈希 attestation）为后续脚本批候选 | open |
| R-L18-2 | docs/07 第 8 节项目侧执法口径行未落（L18 假设 3 留审分支——主控未裁扩面，实现岗未自行扩面；F-11 零同步面实证仅覆盖 docs/00/09/11/12 的 7 处引用） | 已由 L24 批承载（2026-10-25）：docs/07 第 8 节项目侧口径行已落（规划件用户认可后并入）；对抗链=任务书机检＋699 审核＋双审＋终检＋主控亲验 | closed |
| R-L24-1 | ds 同族双岗常态化（用户裁决 D30 A 追认，2026-10-25）：ds 族同时承担实现双审第二席＋终检代位（名义岗 zipoo 周窗撞顶期）为长期例外——三族约束下重叠不可避免（用户原文见账本 user-ruling-d30 行，此处不转述）；与项目仓 R-L15b-2 族联动（zipoo 重置则终检回切） | 无（用户追认终态）；每批代位事实如实落账本与批档 | won't-fix（用户追认） |
| R-L24-2 | ds 三帽实例隔离纪律（D30 r1 三链条启用后常态面；三链条原文见账本 user-ruling-d30-r1 行）：ds 同会话可能触三帽（规划审＋实现双审第二席＋终检代位）——任一 ds 实例单会话至多一帽；三帽齐触启用三个新实例；终检实例须为当日最后使用（防同一实例先审后裁） | 每批派发前主控核对实例与帽的分配并落账本（实例与帽次序）；违反即当批返工 | open |
| R-P13-1 | constraint-index query 排序未用路由先读序（docs/06 第 4 节／INDEX §2／index.json routes 三方一致的先读·按需读序不参与排序；scripts/constraint-index.mjs L242 键序=paths 命中→desc 命中→severity→卡 ID 字典序）——P13 三任务演练全部命中 ARC 册、docs/06 第 9 节期望三违背；卡面 paths 普遍为空致路径优先键恒零（真实路径复核同输出） | 修复批：排序键序改「路由册序→severity→ID」或等效＋docs/06 第 7 节匹配规则补先读序文字＋复跑第 9 节三演练至判读正确（实录=项目仓 docs/evidence/phase3-drill.md） | open |
