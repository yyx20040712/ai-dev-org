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
| 02-§8-model-terms | B-1 check-hardcode 词表扩容实扫 | references/02 §8 额度经济学节含模型名安排性提及约 20 处（母本继承配置性条款层）——白名单过渡豁免，非指针化 | open | 白名单 13 条规则承接（reason 注明过渡）；指针化=后续文档批；§8.5 分面放行语义仍有效 |
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
