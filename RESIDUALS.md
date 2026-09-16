# 残留登记册（ai-dev-org）

> 三态：open（待处置）/won't-fix（显式不修+裁决依据）/closed（已修）。
> **静默消失=违规**（优化战役 2026-09-10 红线 3）。新残留随发现逐行
> 追加，处置留痕；本册随 W 级审计呈报。
> project 匹配约束（health-scan §① 同款）：本册按编号精确对账。

## 登记行

| 编号 | 来源 | 内容 | 状态 | 处置 |
|---|---|---|---|---|
| A-dsN-1 | A 包 deepseek 初审 N 类（档=Synapse scripts/audits/2026-09-10_skill-audit-a-ds-out.md；裁决承转=优化战役交接书 `E:/class/智慧水务/Synapse_remake/docs/prompts/2026-09-10_ai-dev-org-optimize-brief.md` §1 快照「已裁维持」，其上游=2026-09-10 技能落地场用户在档裁决链） | runId 可读性（时间戳+随机后缀难肉眼比对） | won't-fix | 维持原裁：runId=机器关联键非人读键，流水按 runId 过滤可机读；人读需求由 ts 字段承担。裁决主体=上游战役主控终裁+用户交接书认受（非本轮自裁） |
| B-K-N1 | B 包 Kimi 初审 N 类（档=2026-09-10_skill-audit-b-kimi-out.md；B 包复审=同目录 b-kimi-re-out.md） | skill-gc 插件边界 JSON 字段缺失 | closed | v1.1 已加（处置在档） |
| B-K-N2 | B 包 Kimi 初审 N 类（档同上） | `--project` 同名异义（账本条目名 vs 项目目录） | closed | 已文档化（ds-call-v2.mjs 头注+02 §9 注记：--project=账本条目名，配置装载恒从 cwd） |
| C-K-N1 | C 包 Kimi 终审 N 类（档=2026-09-10_skill-audit-c-re2-kimi-out.md；裁决承转=交接书 §1 快照「已裁有意设计不修」，交接书全路径见 A-dsN-1 行） | SKILL.md description 触发词冗长 | won't-fix | 维持原裁：触发词覆盖=召回优先，长度换加载命中率。裁决主体同 A-dsN-1（非本轮自裁） |
| BC-ds-2nd | B/C 包 deepseek 复审缺席（交接书 §1 快照第 4 条） | deepseek 二轮未走（条件同域已落实） | closed | 已由优化战役 W5 六派发补齐（deepseek 审 A'/B'/C' 三区，档=Synapse scripts/audits/2026-09-10_w5-*-ds-out.md）——本轮闭环 |
| HOST-node25 | 优化战役 W2 执行事件+回炉轮 1 复核 | 宿主 Node 25.2.1 下 ds-call-v2 路径**退出阶段** libuv 断言崩溃（0xC0000409, uv_handle_closing, async.c:76）——输出与落账已完成 | won't-fix | 定性（回炉轮 1 修正为或然并存）：裸 fetch 单请求 Node 25 不复现（实验档=w5 终裁档 §Node25 对照）——崩溃=Node 25 libuv 敏感性×ds-call-v2 路径特定形态（长响应/重试循环）组合，「纯环境缺陷」与「代码触发面」不可分。接受风险=跟踪上限到此；缓解=外部派发一律 Node 24（SKILL.md 派发节注记）；**若 Node 24 后续同崩则本项重开升级排查**（重开触发=人工发现，无常驻机检=已接受监控盲区）。**2026-09-14 部分闭环**：ds-call-v2 v2.2.0 增 Node 版本守卫（受禁主版本住 org-config `supported_node.forbid_major`，脚本零硬编码路径，W-12）——「人工发现」升级为「启动即告警」；仍不阻断（崩溃仅在退出阶段且落账已完成） |
| W5-A-W4 | W5 回炉轮 1 登记（Kimi-W4） | R5 演练行永久留在技能根流水（历史事件不删） | closed（2026-09-16 三态归一） | 原裁"带 mocked 上下文可甄别、不清洗"**被证伪**：甄别是给人看的，health-scan 按 project 精确匹配不识别 mock，致技能根收口门禁永久 RED（实测 RED ×1，P0-1）。新处置=①源头：ds-call-v2 账本行写 `mocked:true`（W-2）；②判据：health-scan 跳过 mocked 行 + 临时演练项目（os.tmpdir() 前缀）；③`glm-look` 章节修订行补记。历史行不改写（08 §3），仍留流水。**2026-09-16 勘误（v1.6 批）**：原状态「已修订（2026-09-14）」为三态外第四态，违本册三态纯度（裁决档 §2 kimi-W4）——按语义归 closed（处置已落地即 closed；后续修订动作一律另起新行，见新登记 entropy-4state 行的 supersedes 口径） |

## 2026-09-14 优化批新登记（Kimi 异源对抗审核后）

| 编号 | 来源 | 内容 | 状态 | 处置 |
|---|---|---|---|---|
| glm-look-endpoints | 主控（P0-3 实扫技能根） | references/07-role-cards.md 与 SKILL.md §修订记 含 live 端点字面量（deepseek/GLM 直连端点与实配解析名，具体串见白名单件），违 06 §0「本件与 SKILL.md 均不含任何端点」与 08 §1 寻址表 | **closed（2026-09-15 入口治理批）** | 操作段已指针化（07 设计岗卡改按通道描述，实配以 `--list-sources` 为准；SKILL.md 同步）。历史叙述两处（07 修订记+CHANGELOG 迁档件）按 08 §3 原样保留，白名单收缩为 2 条历史豁免。用户 WIP 锁定约束由 2026-09-15 用户指令「优化本机的 AI 软件开发技能」解除 |
| glm-look-schema | 主控（P0-4 真因 1，R4 基线暴露） | glm-look.mjs 自写流水行 schema 不全（缺 dispatcher_version/role_version/role_sig/org_config_hash/attempt），与 ds-call-v2 双写入者两套 schema（A3 同构病）；致 R4 尾窗 35 行判坏 | open | 写入者 glm-look.mjs 属 WIP 锁定集→本次以 regression 侧「外来行（channel 标记）分类」绕过（45→19 行正确归类），非根治。待 glm-look 落定后统一行 schema |
| glm-look-truncation | Kimi 审核 N-6 | glm-look 截断坑：其倍升仅在「正文为零」触发，**截断但有正文**的看图报告照样当 ok 收下（与 P0-2 同类） | open | 本次不修（WIP 锁定集）。同族语义=审计岗截断，health-scan ④ 已按 `truncated` 拦截派发器侧；glm-look 侧待其落定后补 `truncated` 字段 |
| project-id-migration | Kimi 审核 W-9/P2-4 | 账本 project 自由文本（实测 9 个名对应约 3 个真实项目）——欠账判定与同源窗口跨名串味 | open | 本次**不引入** project_id（避新旧键并存期误判「已补还/新欠」，W-9）。待专门批次：增设 project_id+过渡期 raw→id 映射表存项目覆盖件，health-scan 先归一化再判定 |
| findings-parser | Kimi 审核 W-7 / 主控 | 审计岗 DoD 已强制机读尾栏 `FINDINGS: B= W= N= VERDICT=`（本次落 gate1/auditor 两份 DoD），但**解析器未实现**——账本 `findings` 字段与误报率（P2-1/health-scan ⑤ 之 RED 面）仍缺 | open | 本次只落 DoD 与格式契约（W-7 要求先定义机读格式再入账）；解析器+误报率判据=下一批（Kimi N-1 已裁不自动倍升，先 RED 暴露） |
| check-hardcode-promotion | 主控 P0-3 / Kimi W-6 | check-hardcode.mjs 现 WARN 级；「审查通过后升 RED」缺判据/时点/责任人（W-6 指为愿望式升档） | open | 待定升格判据：白名单稳定 N 个收口且误报=0 则升 `--strict`；本次已留 `--strict` 开关与自检 |
| skillmd-scriptlist-sync | 主控 | SKILL.md §派发与自检 脚本清单未列 `check-hardcode.mjs`、health-scan ④⑤ 新增告警类 | **closed（2026-09-15 入口治理批）** | 脚本清单已补登 check-hardcode.mjs；④⑤ 告警类说明以 02 §10 指针承接（清单行内不展开细则） |
| glm-look-truncation-field | 主控（P0-2 同族面） | glm-look.mjs 落流水的 ok 行**无 `truncated` 字段**，health-scan ④ 仅查账本——视觉通道的截断（含倍升耗尽后）不进入 RED 面 | closed（2026-09-16 v1.6 批） | 已落：ok 行带 `truncated` 派生布尔（finish 白名单反转，词表=org-config finish_vocab）+stderr 非完整终态告警；通道字段差异（role_id/channel 形态）与统一行 schema 面仍由 glm-look-schema 行承载（open） |
| manual-event-consumers | 主控（ORG-11 修复后） | regression 已接受 MANUAL_EVENTS（porting-delta/doc-health/ruling/constitution-overrun/escaped-defect），但 health-scan **不读**这些事件（如 doc-health 不影响判定）；且 escaped-defect 尚无写入者 | open | P1（留用户裁决）落地时一并接线：escaped-defect 写入者 + health-scan 逃逸率统计（残留 findings-parser 同批） |
| preexisting-wip-baseline | 主控（开工体检） | 开工时已有 4 文件未提交改动（SKILL.md/06/07/glm-look.mjs，含 2026-09-11 双通道补遗）——本次优化批的差异须与用户 WIP 区分 | open | 冻结档=scripts/audits/2026-09-14_preexisting-dirty-baseline.diff（464 行）+四文件 sha256；本次改动不触碰该 4 件（硬约束 3） |

## 2026-09-16 子代理绑定批新登记（A+A'+B-0+B-1 轮；批档=E:/zcode_md/fix/subagent-plan-2026-09-16/08-exec-log.md）

| 编号 | 来源 | 内容 | 状态 | 处置 |
|---|---|---|---|---|
| glm-look-streaming | 批档 subagent-plan 05-ruling §七增补一指认的登记缺口（B-1 承接补登） | 06 §5.7 声称「流式化登记 RESIDUALS」而本册原无该条——登记缺口补正：流式化（anthropic SSE）根治网关非流式窗口截断，未实现 | open | B-2 批承接（ds-call-v2 与 glm-look 各自独立实现，承 W-3）；504 专项处置已定（载荷超窗不盲重试） |
| 02-§8-model-terms | B-1 check-hardcode 词表扩容实扫 | references/02 §8 额度经济学节含模型名安排性提及约 20 处（母本继承配置性条款层）——白名单过渡豁免，非指针化 | open | 白名单 13 条规则承接（reason 注明过渡）；指针化=后续文档批；§8.5 分面放行语义仍有效；承接批次=结构项专项批（evolve-struct-* 同批呈报） |
| empty-tools-invalid | A'① probe-k 实证（08-exec-log §二） | 子代理 frontmatter `tools: []`=**泄漏全工具面**（真实发生 tool.call Read 读出金丝雀文件）——空数组被当"无限制"而非"无工具" | closed | 已按交接预案处置：ops-gate1-k1/k2 退 `tools: Read`+双墙声明（物理墙+协议墙）；环境事实入 06 §6 补遗 |
| agents-profile-session-fixed | A 批验证观察（metadata profileSnapshot） | 代理档案=会话启动时快照——会话中改文件对已启动会话无效（k1/k2 以旧 tools:[] 快照跑完验证批） | won't-fix | 宿主行为（无热加载既有结论的同族面）；纪律=改代理文件后须新会话验证，已写入 06 §6 补遗 |
| PostToolUse-livefire | B-0 观测面批 | zcode.cjs 内含 PostToolUse/PostToolUseFailure 执行器与 workspace_hooks 信任面（存在性已验），但实弹配置+触发验证未做 | open | 需机检强制（hook 拦截）的批次首场核对项；当前机检强制仍走 verify/health-scan 脚本路线 |
| adjudicator-tail-order | A 批首部署验证（08-exec-log §三） | ops-adjudicator 报告在 LEDGER-CLAIM 尾栏后附加 1 行路径说明——「末两行=机读尾栏」契约未严格保持 | open | 轻微（尾栏存在且格式正确，grep 可命中）；下轮代理文件批收紧措辞（「尾栏后禁再有任何行」），不单独返工 |
| subagent-shell-gt-truncation | A'④ 接续演练实录（fixture-probe2） | 子代理 Bash 层 `node -e "...>..."` 参数中 `>` 被截断（收到后半丢失，SyntaxError）——传参层环境缺陷 | open | E2 简报纪律：含 `>` 的命令改脚本文件载体（演练中 ops-probe 已自适应 item*.js 载体并如实记录）；根因定位留后续 |
| killed-agent-metadata-gap | 收口账本补记（2026-09-16） | 被 TaskStop 杀死的子代理 metadata.json **不落 profileSnapshot.model/createdAt**——log-triage ③ 静默回退检测对被杀岗无声明值可核（须回退到派发简报人工对质） | open | B-0 观测盲区登记；处置=接续演练场景以简报契约为声明源+主控人工核对；机检化（从编排会话派发记录回填声明值）留后续批 |

## 2026-09-16 维护熵清偿批新登记（v1.6 战役；批档=scripts/audits/2026-09-16_entropy-*）

| 编号 | 来源 | 内容 | 状态 | 处置 |
|---|---|---|---|---|
| synapse-md-expand | 08 §6 补正（08 §6 声称已登记实未登记——全面评审+双源审一致指认） | Synapse md 面门禁扩面（存量 562+ 件处置）另立批次 | open | 08 §6 的登记声称本批补正（本行即其登记）；扩面实施=独立批，属 Synapse 项目仓非本技能范围 |
| entropy-4state | 主控全面评审+裁决档 §2 kimi-W4 | W5-A-W4 行出现三态外第四态「已修订」——本册三态纯度破口 | closed | W5-A-W4 状态归 closed+行内勘误注记；**supersedes 口径本行建立**：后续新行取代旧行判断时在新行处置列写「supersedes: <旧行编号>」，被取代行不参与终态统计（人工对账与机检同口径） |
| archive-distribution-trigger | 裁决档 §2 kimi-N2 | _archive 引用改绝对路径（`~/.zcode/skills/_archive/…`）依赖本机技能目录形态 | won't-fix | 显式不修+触发器：一旦引入技能分发/同步机制，_archive 引用策略随批重评（触发=分发机制落地批） |
| runbook-external-source | 主控全面评审（清偿计划 P1-A d） | 子代理失败接续 runbook 真源在技能外（E:/zcode_md/fix/subagent-plan-2026-09-16/09 号件）——技能自包含缺口 | open | 本批登记；迁移入技能 references=后续批（与 subagent-plan 批收尾协调，非本批范围） |
| check-anchors-calibration | 终审门一 N1 | 试点固有盲点：标题索引正则不含全角冒号形态；扫描面未含 scripts/roles/*.dod.md（其内恰有 02 §3 指引）；PROJECT_NAMES 点名豁免=白名单漂移面；自检 head 断言恒真未拷打解析逻辑 | open | 全部于 check-anchors 升 --strict 前置批处置（升级前置条件=连续两轮零误报+本行闭环，裁决档 ds-W6） |
| r1-deepseek-format-flake | 主控 R1 三跑实证 | deepseek 侧间歇把「判定」耗在推理通道、可见正文格式漂移（3 跑 1 遇 UNPARSEABLE）——容错解析（判定\|verdict\|裸 PASS/FAIL）已收敛大半，重跑即绿 | open | 低优先：根治=CASE 提示词强化或固定输出形态采样；遇抖动处置=重跑 R1 留证（勿静默改判） |

## 2026-09-16 外部评审清偿战役新登记（evolve 批；批档=scripts/audits/2026-09-16_evolve-*）

修复项=closed 单行制（新开即闭）；未修项=open 各自建行。修复明细与红→绿
证据=E1/E2/E3 报告；行为变化四项+env 钩子申报=CHANGELOG v1.7 条。

| 编号 | 来源 | 内容 | 状态 | 处置 |
|---|---|---|---|---|
| evolve-h1-transport | 外部评审清偿战役 evolve 批（档=scripts/audits/2026-09-16_evolve-*；实现=E1 b1） | glm-look 传输层 global fetch（undici 内建 headersTimeout≈300s=非流式长推理隐形截断）改 node:http(s) 直连+AbortSignal 唯一超时源+res.on('error')+isMain guard+纯函数 export；R10=结构断言+本地 mock 双通道往返+向量钉面 | closed | 已修（commit 9b6bac9）；三条不可实证残留拆行 evolve-b1-transportresidual |
| evolve-h3-exitcode | 同上（实现=E1 b2） | ds-call-v2 退出码分类：uncaughtException 消息正则兜底（英文 locale 误分类面）改类型化 ConfigError+classifyExitCode（判据源=06 §5.8）+穷尽 throw 点清单化（E1 报告四节表） | closed | 已修（commit d3d7adc） |
| evolve-m1-datewindow | 同上（实现=E2 b3） | log-triage --date 非法值原为静默空窗=假绿（勘误后事实：窗口字面值照跑零报错，非全量）——格式+UTC 分量回环语义校验拒（exit 1）+窗口 epoch 化 UTC 日界 | closed | 已修（commit 2c91ddd）；行为变化已入 CHANGELOG v1.7 申报① |
| evolve-m3-nullguard | 同上（实现=E2 b4） | provider null 裸取三消费点（org-config validateProviders 双裸取/check-hardcode deriveHostModelTerms/log-triage buildAliasMap）TypeError 崩溃改校验错误行 exit 3/降级行 exit 5 族/跳过 | closed | 已修（commit 3f0c080）；同族第 4 消费点新发现拆行 evolve-glmlook-150-null |
| evolve-h2-timeouts | 同上（实现=E2 b5） | regression 五处主流程 spawnSync 无超时看护（合法最坏链被外层挂起/误杀面）全带 timeout+killSignal：四处秒级 mock 路径 5,000ms；R1=单源推导 4,835,000ms，×1.117 裕量取 90min（5,400,000ms）档（∈裁决 C5 机检窗禁裁剪） | closed | 已修（commit 58fb979）；R1 零运行时实证拆行 evolve-r1-timeout-unverified |
| evolve-b6-containment | 同上（实现=E1 b6） | sys_prompt_file 无包含性校验（registry 路径可指向技能根外）补 path.relative 判 .. 前缀/绝对形态=越界 exit 3；两落点同步（ds-call-v2 loadRole+regression loadRoleAssembled 单源 import 消费） | closed | 已修（commit 919f27a）；纵深防御定性维持（当前 registry 无越界=不可达守卫） |
| evolve-b7-anchorblind | 同上（实现=E2 b7） | check-anchors 条目型引用（NN·XN）断锚盲区+单数字文档号形态不识别——扩面：登记表从 01/04 正文解析+两位文档号+自检 4→16 向量（原 head 断言恒真盲点）；01:157 唯一现存断锚改指 01·C2（P-4 终裁） | closed | 已修（commit 67a60e1）；扩面主扫 WARN×0/FAIL×0 零误报 |
| evolve-b8-docrot | 同上（实现=E3 b8） | 文档计数/清单/头注腐化：「固定六段」族形态普查三分类处置+02 §4 单源根治「固定七段（1-6 段惯称『六段简报』）」+九件脚本头注退出码复写块指针化 06 §5.8+06 §5 R 清单与 SKILL 同族 R1~R6 断言指针化+01:166 补遗错字+04 头注计数去数字 | closed | 已修（commit b76efd7）；禁改面命中登记不修（references/05 两处、07 一处、task-brief 模板、init-defenses 三处——处置明细=E3 报告普查表；verify.mjs:6 与 check-constitution-budget:3 已各自拆行） |
| evolve-b1-transportresidual | 外部评审清偿战役 evolve 批（计划 v3 b1 既定拆行） | b1 三面不可实证残留：①>300s 首字节面不可回归复现（undici 消除以 R10 结构断言承载=非注释行无 fetch 形态）；②Node25 退出阶段崩溃面不可实证（本战役零外派期）；③异端点传输语义面（glm 形 3xx/gzip 未实证——本地 mock 仅证拟真，非真实端点语义） | open | 替代验证=R10 结构断言+双通道 mock 往返；真外呼窗口（--r1 真实跑或设计岗首用）后回填核验；+R10 错误面无覆盖（mock 仅 200 happy path；非 2xx 体收割/AbortError 拒收/3xx 不跟随分派无向量）——承接=下批 R10 扩向量 |
| evolve-r1-timeout-unverified | 外部评审清偿战役 evolve 批（E2 移交） | R1 超时改动 5,400,000ms 零运行时实证（R1 SKIP=真实派发配给保护，改动未经真实长链跑过） | open | 替代验证=派生复算表（E2 报告）+门一 diff 审；触发器=下次 --r1 真实跑后核对（看护是否误杀/放行合法最坏链） |
| evolve-m4-hardcode | 外部评审清偿战役 evolve 批（外部评审 M4） | 脚本内残留硬编码三处：ds-call-v2 max_tokens=32768/temperature=0.2（请求参数，非供应商事实面）；regression R1 SOURCES 源别名内联；check-anchors PROJECT_NAMES 项目名点名单 | open | 承接=下批 org-config 化（与 hardcode_scan/roles 分区协调） |
| evolve-m6-runid | 外部评审清偿战役 evolve 批（外部评审 M6） | runId 随机后缀仅 4 字符（同秒/并发碰撞窗口）+账本 appendFileSync 多写入者行交错无锁+log-triage switch 统计单值覆盖（同 runId 多次 switch 只记末值） | open | 互指 A-dsN-1（runId=机器关联键定位维持）与 regression R5 区期望计数注释；处置=账本写入器专项批 |
| evolve-m5-regenv | 外部评审清偿战役 evolve 批（外部评审 M5） | 回归 R2b/R5/R4 勾连宿主 config 双校验与源链装载（本机宿主注册表=隐式 fixture），跨环境（无同形宿主条目）不复现 | open | 设计取舍显式化：自包含回归以本机配置面为基线；跨环境移植按 05 §6 差异回灌协议处置，不追回 |
| evolve-l3-sort | 外部评审清偿战役 evolve 批（外部评审低优先 L 类） | 清单类输出无显式排序键：check-hardcode/check-anchors 以 readdirSync 枚举序输出（跨平台/目录序不稳定——diff 对账与 --update 重冻结噪声面） | open | 低优先；处置=扫描输出前显式 sort（check-anchors 升 --strict 前置批一并） |
| evolve-l4-flags | 同上 | CLI flag 解析=argv.indexOf 取下一位（cliFlag 单源导出）：flag 值缺失（取 undefined）或误吃下一 flag（如 --project --json 会把 --json 当值）不报错 | open | 低优先；处置=cliFlag 校验值非 flag 形态+值缺失=用法错 1（org-config 单点改全件受益） |
| evolve-l5-frontmatter | 同上 | frontmatter 解析健壮性弱面：skill-gc description 多行/块形态歧义判 unknown 仅报告（块级边界未严格解析）；check-hardcode agents 扫描剥 frontmatter 对未闭合形态的边界行为未向量覆盖 | open | 低优先；处置=解析器专项或维持 unknown 保守口径（ds-B2 终裁「只报告不删」延续） |
| evolve-l9-degrade | 同上 | 降级显式留痕口径未全件统一：check-hardcode 降级=exit 5 已立；log-triage 日志目录缺失/health-scan 账本缺失仍静默空输出（与 M1 静默空窗同族面） | open | 低优先；处置=「缺输入显式留痕」口径统一批（08 §4 文档腐化体检顺带核） |
| evolve-glmlook-150-null | 外部评审清偿战役 evolve 批（E2 普查新发现，E2 报告六节表） | glm-look.mjs:150 discoverSources prov.options 对 null 宿主条目裸取（宿主原始 JSON 侧可达）——M3 族第 4 消费点 | open | E2 纪律登记不自修（glm-look=E1 已落面+超 E2 白名单）；处置=glm-look 下一修改批顺带（同 b4 形态：降级行+跳过） |
| evolve-k2-silent | 外部评审清偿战役 evolve 批（源B 派发事件） | k2 首派静默失败：无输出 5min/0 工具调用（重跑成功）——宿主侧通道事件，无本地可检信号 | open | 单次事件不升级；触发器=复发≥2 次升宿主排查批 |
| evolve-samefamily | 外部评审清偿战役 evolve 批（裁决 C6 口径） | 计划双审源同族证据形态：源A/源B MODEL-SELF 同 model-key（同宿主实配模型键，具体串与 uuid 前缀对=b2466f8b…/5e1abd9d… 见批档 k1/k2 审出件——本册不落供应商 live 事实）——「异供应商」为未证假设，勿断言为已证事实 | open | 处置=轻量双审合规注记+按「同源记欠账」文化记欠账；宿主提供真异构备源时消账 |
| evolve-verify-mjs-header | 外部评审清偿战役 evolve 批（E3 头注普查） | templates/verify.mjs:6 头注「（退出码：0=全过；1=有 FAIL）」数字=语义复写——随 init-defenses 分发到项目仓的模板骨架件 | open | 禁改面命中登记不修（templates/** 白名单外，本批仅 org-seg.snippet.md:11 扩权）；处置=init-defenses 模板升版批顺带指针化 |
| evolve-ccb-weaktype | 外部评审清偿战役 evolve 批（E3 头注普查） | check-constitution-budget.mjs:3 头注「→ exit 1」弱同型复写（单退出码弱形态，非完整数字=语义表） | open | 登记不修（脚本不在本批白名单）；处置=下批脚本头注卫生批 |
| evolve-struct-tables | 外部评审清偿战役 evolve 批（结构项——计划 v3 假设 4：本战役不实施只登记） | 岗位三表三写：SKILL.md 岗位速查/06 §1 分工总表/07 §1 编制表——内容重叠漂移面，须单源化+指针收敛 | open | 承接=结构项专项批（evolve-struct-* 同批呈报） |
| evolve-struct-glossary | 同上 | 术语速查入口缺位（拟 00 件：跨 references 术语表/新手上手图——「惯称/口径」类术语散布定义无集中入口） | open | 承接=结构项专项批 |
| evolve-struct-patchwrite | 同上 | 补丁式时序写作累积：「后节接管前节」注记链（02 §8.4 接管注记/06 §6 补遗等）散布各件，结构性收敛未做 | open | 承接=结构项专项批 |
| evolve-healthscan-86ref | 主控移交+b7 自检引出（evolve 批 check-anchors 自检实测发现 06 无 §8.6、真源在 02，未随批清偿） | health-scan.mjs 两处（:10/:104）「06 §8.6」断链引用（三段通道真源=references/02 §8.6） | closed | 已修（回炉 r2，2026-09-16）：两处改指 02 §8.6；断锚面随批复扫 WARN×0/FAIL×0 |
| evolve-listroles-rolesnull | 终审 D 裁（档=2026-09-16_evolve-ruling-final.md；门一复审 W1 首指） | ds-call-v2 cliMain `--list-roles`（:362 Object.entries）与 `--role` 缺省分支（:380 Object.keys）对 roles:null 无守卫——TypeError→exit 1≠06 §5.8 行 3（配置错=3）；同族 A3 病（回炉只修了 --role 派发路径） | open | 纵深防御/一致性 W 级（正常运维 registry 无 roles:null）；承接=下批：两分支前补守卫或抽公共断言+R10 增 `--list-roles×roles:null` 向量 |
| evolve-probeb-testfixture | 终审 E 裁（门二黄项 A-1 归因；档=2026-09-16_evolve-gate2-evidence.md） | cli/agents/ 常驻 probe-b 合成路由探针 metadata（验证 06 §6 补遗负面清单⑤「枚举值=假绑定」；profileId=probe-b/自述 model field=upstream enum "sonnet"）——任何含 ③ 的 `--date` 分诊长期 exit 1，易误读为真 RED | open | 非缺陷（检测器按设计击发）；处置=清理该探针残留或建测试 fixture 白名单（log-triage ③ 豁免名单），避免收口门禁误判 |
| evolve-gate2-samesource | 终审 F 裁（独立发现：agents/ops-probe.md:6 与 ops-executor.md:6 同绑定） | 门二实证岗与实现者同 model-key（builtin:bigmodel-coding-plan/GLM-5.3）——06 §7「审查者与实现者异构优先+同源记欠账」欠账未记 | open | 声明：本战役异构对抗由门一（k3）+裁决（deepseek-flash）承载，门二=机械重跑面（矩阵命令+退出码，无判断性结论）；欠账保留至宿主提供真异构实证岗或 ops-probe 改绑异源 |
| evolve-p2-advisories | 终审 P2 建议（非阻断，三项打包） | ①C1 机检盲区：「exit N=」变体形态不在两式 grep 内（ds-call-v2:14 现存合规保留句即该形态）②plan 白名单「health-scan=仅头注指针化一行级」措辞与实际（+§8.6 笔误修正两处）不精确 ③ds-call-v2:14 保留句含已覆盖半句「exit 4=输出写失败时」可削 | open | 承接=下批小扫尾：C1 严式扩 `\bexit \d+=`/白名单措辞入 05 移植口径/保留句削半句 |

修订记同步见本册末节 2026-09-16 行。

## 残留快照对账表（交接书 §1.3 → 本册编号；「静默消失」证伪位）

| 交接书 §1 快照条目 | 本册编号 | 状态 |
|---|---|---|
| A 包 ds-N 类（runId 可读性——已裁维持） | A-dsN-1 | won't-fix（对应） |
| B 包 Kimi-N（插件边界 JSON 字段已加；--project 同名异义文档化已做） | B-K-N1+B-K-N2 | closed×2（对应） |
| C 包 Kimi-N1（description 触发词冗长——已裁有意设计不修，维持） | C-K-N1 | won't-fix（对应） |
| B/C 包 deepseek 未走第二轮（条件同域已落实） | BC-ds-2nd | closed（W5 闭环） |
| （战役新发现，快照外） | HOST-node25/W5-A-W4 | 登记 2 条 |

## 修订记

- 2026-09-14 优化批（Kimi 异源对抗审核后，裁决档=scripts/audits/2026-09-14_plan-v1-ruling.md；
  审核档=同目录 2026-09-14_plan-v1-kimi-audit-out.md，run=20260914141615-w5e5）：新增登记 8 条
  （glm-look-endpoints / glm-look-schema / glm-look-truncation / project-id-migration /
  findings-parser / check-hardcode-promotion / skillmd-scriptlist-sync / preexisting-wip-baseline）；
  W5-A-W4 由 won't-fix 转「已修订」（原裁被实测证伪）；HOST-node25 部分闭环（版本守卫）。
  本次闭环项：P0-1（收口门禁卡死）、P0-2（截断假成功——账本 `truncated`+health-scan ④ RED）、
  P0-3（零硬编码机检化为 WARN+白名单）、P0-4（R4 基线 FAIL 两真因：statusCode:null + 外来行分类）。
  主控新增发现：P0-4（审核者未见，基线亲验产物）。
- 2026-09-10 回炉轮 2（终轮，W5 复审处置）：登记 B'-ds-N7 后半（后续
  新增主控子模式须同步 references/07 §1 编制表注记——本轮 tech-writer
  不增编制已核，此为预防性登记）；HOST-node25 重开条件触发机制=人工
  触发线如实注记（用户/主控发现 Node 24 同崩即重开，无常驻机检——
  监控缺位 won't-fix 承接 C'-Kimi N1）。
- 2026-09-10 回炉轮 1（W5 审 C' 处置）：won't-fix 补档指针与裁决主体
  （Kimi-W-2）；HOST-node25 转态 won't-fix+定性或然修正（Kimi-W-4/
  ds-W3：裸 fetch 对照实验后放弃「纯环境缺陷」超证据定性）；增残留
  快照对账表（Kimi-W-1/ds-W4：§1.3 全集对账，零静默消失）；BC-ds-2nd
  闭环（W5 六派发完成）；三态纯度修正（Kimi-N-1：open→W5 移入处置列）。
- 2026-09-10 立册（优化战役 W4）：承接交接书 §1.3 残留快照全量登记。
- 2026-09-10 立册日清算补记（与上行同期，分行纯追加）：A-dsN-1/C-K-N1
  won't-fix 显式化、B-K-N1/N2 closed 闭证、BC-ds-2nd 转 W5 闭环、
  HOST-node25 新登记。
- 2026-09-15 入口治理批（用户指示「优化本机的 AI 软件开发技能」）：闭环
  2 条（glm-look-endpoints、skillmd-scriptlist-sync）；配套=SKILL.md 修订记
  迁 CHANGELOG.md、references/07 操作段指针化+补遗三、loop-defenses/
  loop-retrospective 死链修复（loop-engineering→本技能 references）、
  白名单收缩 4→2 条（均历史豁免）。批档=E:/zcode_md/fix/skills-优化批-2026-09-15/。
- 2026-09-16 维护熵清偿战役（v1.6）：新增登记 6 条（synapse-md-expand/
  entropy-4state 已闭/archive-distribution-trigger won't-fix/runbook-external-source/
  check-anchors-calibration/r1-deepseek-format-flake）；闭环 1 条
  （glm-look-truncation-field——ok 行 truncated 派生布尔落地）；W5-A-W4
  三态归一勘误。终审=门一 PASS（B=0/W=4 全吸纳）+auditor 有条件放行
  （B=1/W=7 吸纳 6 驳 1——W6 深合并语义）；cfg 漂移 WARN（54f08fbf→
  a26f710a）处置=本战役 b7/b9 配置落地+auditor 配置面复核+终裁（投放面
  重盘：kimi-main 当日真实调用 ok/err 健康、deepseek payg 已加显式告警
  门禁、vision 双通道 --list-sources 实证可用）。批档=scripts/audits/
  2026-09-16_entropy-*；明细=CHANGELOG v1.6 条。
- 2026-09-16 子代理绑定批（A+A'+B-0+B-1）：新增登记 7 条（glm-look-streaming
  补登/02-§8-model-terms/empty-tools-invalid 已处置/agents-profile-session-fixed
  won't-fix/PostToolUse-livefire/adjudicator-tail-order/subagent-shell-gt-truncation）；
  本批闭环事实（非残留）：跨供应商 model 绑定双源实证、六 ops-* 代理入役、
  log-triage.mjs 入 scripts/、check-hardcode 扩容（宿主词表+agents 扫描）。
  批档=E:/zcode_md/fix/subagent-plan-2026-09-16/（08-exec-log.md=执行档案）。
- 2026-09-16 外部评审清偿战役（evolve 批，v1.7）：新增登记 25 条（closed 8=
  本战役修复项单行制：evolve-h1-transport/evolve-h3-exitcode/evolve-m1-datewindow/
  evolve-m3-nullguard/evolve-h2-timeouts/evolve-b6-containment/evolve-b7-anchorblind/
  evolve-b8-docrot；open 17=evolve-b1-transportresidual 三面拆行+
  evolve-r1-timeout-unverified+evolve-m4-hardcode+evolve-m5-regenv+evolve-m6-runid+
  evolve-l3-sort/evolve-l4-flags/evolve-l5-frontmatter/evolve-l9-degrade+
  evolve-glmlook-150-null+evolve-k2-silent+evolve-samefamily+
  evolve-verify-mjs-header+evolve-ccb-weaktype+evolve-struct-tables/
  evolve-struct-glossary/evolve-struct-patchwrite）；在册 02-§8-model-terms
  补承接批次注（不重建）。批档=scripts/audits/2026-09-16_evolve-*；
  明细=CHANGELOG v1.7 条+E1/E2/E3 报告。
- 2026-09-16 回炉轮（evolve-rework r1/r2，门一出件全处置）：B1/W2 代码面+
  W1/W3/N1-N4+主控移交文档面；本册变动=closed 新增 1 行（evolve-healthscan-86ref
  ——主控移交+b7 自检引出，本轮回炉闭合）+evolve-b1-transportresidual 处置列
  追加 R10 错误面承接注+evolve-h2-timeouts 行 R1 超时表述勘误（防加法误读）。
  批档=scripts/audits/2026-09-16_evolve-rework-*。
