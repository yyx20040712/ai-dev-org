# CHANGELOG

> 本件=SKILL.md 修订记的全量迁档（2026-09-15 入口治理批迁入，原文
> 逐字保留，此后新增版本只在本件追加）。SKILL.md 只保留最近一条摘要
> 与本件指针。历史条目属过程记录，按 references/08 §3 红线不再改写。

## 2026-09-17 v1.7.1（自我迭代卫生批——外部评估驱动：批档入库+提交面堵收口扫描流程洞+R1 运行时欠账清偿）

- **背景（三项运维末端缺口，均主控实测坐实）**：①evolve 批批档（scripts/audits/
  2026-09-16_evolve-* 与 evolve-ledger-* 三件，共 28 件）未入 git——证据链未
  版本化，与本技能 C4「落盘才算证明」自相矛盾；②v1.7 收口尾笔（451fb08）自身
  向 RESIDUALS.md:94 引入 3 处实配模型名命中（扫描跑在最后一批编辑之前=流程洞），
  收口消息「三扫零新增」与 HEAD 实态不符（主控自抓自登，同 evolve-v17-erratum1
  计数病族）；③R1 真实派发自 v1.0 冻结起零实跑（配给保护长期 SKIP）。
- **清偿**：①批档全量入库；②RESIDUALS.md:94 行级白名单登记（08 §1 历史件
  豁免判例；锚串=收口尾笔引用的完整实配 model-key 原文，实值住白名单 JSON
  条目、正文不抄写——本条起草初版曾将该实值写入本件，被本批新装 strict
  钩子当场拦截后改指针化措辞，门禁自证；锚串在 RESIDUALS.md 内 grep 计 1，
  整行三命中一并覆盖）+新增 `.githooks/pre-commit` 提交门禁（check-hardcode
  **--strict**+check-anchors+org-config validate 三快扫；退出码口径单源=
  06 §5.8——1/3 阻断、5 降级留痕放行；安装=`git config core.hooksPath
  .githooks`）——「收口零命中」从收口时点自觉变成提交面机检，堵死「扫描先于
  尾笔编辑」类流程洞；③R1 专项 `--only R1 --r1 --keep-tmp`：双源判定方向
  一致性 3/3 过（断言弱化/干净样例/占位残留三用例双源方向全对），宿主 Node
  v25.2.1 下真实派发零退出崩溃（HOST-node25 退出面未触发）——残留册
  evolve-r1-timeout-unverified 随批关闭（触发器条件已兑现）。
- **行为变化申报**：安装钩子后本仓 git commit 新增阻断行为（strict 命中=
  阻断提交；逃生口=登记白名单/指针化，显式可审计）；rc=5 降级场景放行但
  回显 [degraded] 留痕行；非 strict 扫描口径不变（health-scan/收口语义照旧）。
- **实现链**：ops-executor 三轮（两落点+回炉 2 轮：strict 修订、rc=5 留痕
  回显；变异红证双证=实现者+主控独立复现，注入 live 事实→exit 1 阻断→
  文件备份法还原 diff 空）；同源轻量门审（code-reviewer——可省面配给内
  降级，02 §8.3）：B=0/W=1（随批回炉闭合）/N 全过，批档敏感串全量机检
  零密钥实值；门禁终态=regression 8/8+R1 专项 1/1+check-hardcode 命中 0
  （豁免 36/14）+check-anchors 0/0+health-scan RED=0/WARN×2（基线存量）。
  档=scripts/audits/2026-09-17_selfiter-impl-report.md。

## 2026-09-16 v1.7（外部评审清偿战役 evolve 批——外部全面评审→计划 v1-v3 双源对抗审→终裁有条件放行→E1/E2/E3 实施→门禁终态）

- **战役过程**：外部全面评审（双异源探查+人工复核）确认 6 项代码级缺陷+
  文档计数/清单/头注腐化+登记纯度问题→清偿计划 v1→源A（k1）对抗审 FAIL
  （B1/W1-9/N1-8 全吸纳成 v2）→源B（k2）审 v2 FAIL（B1-3/W1-6/N1-9 全吸纳
  成 v3）→裁决岗终裁有条件放行（C1 头注规则式穷举/C4 固定六段清零/C5 R1
  机检窗/C6 同族证据形态等）→E1（b1+b2+b6+R10）/E2（b3+b4+b5+b7）/
  E3（b8+b9）分批实施（九笔 commit，未 push）→门禁终态。
- **代码修复（b1-b7）**：glm-look 传输层 fetch→node:http(s) 直连（AbortSignal
  唯一超时源+isMain guard+纯函数 export+R10=结构断言+本地 mock 双通道往返
  +向量）；ds-call-v2 退出码类型化（ConfigError/classifyExitCode，判据源=
  06 §5.8，穷尽 throw 点清单化）；log-triage --date 格式+UTC 分量回环语义
  校验+窗口 epoch 化 UTC 日界；provider null 守卫三消费点（org-config
  校验错误 exit 3/check-hardcode 降级行 exit 5 族/log-triage 跳过）；
  regression 五处 spawnSync 超时看护（R1=单源推导 4,835,000ms，×1.117 裕量
  取 90min（5,400,000ms）档，∈C5 机检窗禁裁剪）；sys_prompt_file 包含性校验两落点；
  check-anchors NN·XN 条目型断锚扩面+文档号两位数+自检 4→16 向量
  （01:157 断锚改指 01·C2）。
- **文档清偿（b8）**：「固定六段」族形态普查三分类处置——02 §4 单源根治
  「固定七段（1-6 段惯称『六段简报』）」；SKILL:90 混合短语改「任务书七段」；
  SKILL:53/:124 与模板 org-seg.snippet:11 告警三分类计数短语指针化（告警
  分类单源=02 §10）；九件脚本头注退出码复写块规则式指针化 06 §5.8
  （11 件穷举表=E3 报告；glm-look 无数字表排除；check-constitution-budget:3
  与 templates/verify.mjs:6=禁改面登记不修）；06 §5 R 清单与 SKILL 同族
  「R1~R6」断言指针化（R 项清单单源=regression.mjs 现行项集合）；01:166
  补遗勘误；04 头注计数去数字（条数单源=doc-counts golden）。
- **行为变化申报（四项，全部退出码面——存量调用方核对）**：①log-triage
  --date 非法值：静默空窗→stderr 用法错+exit 1（并新增 [UTC 零点,次 UTC
  零点) 上界）；②ds-call-v2 英文 locale 配置装载类未捕获异常：exit 1→3
  （消息正则兜底删除，修误分类）；③registry 文件路径越界：新增 exit 3
  拒绝路径（纵深防御，当前不可达）；④null provider：TypeError 崩溃→
  校验错误（org-config/ds-call-v2 路径 exit 3+明确消息；check-hardcode
  路径=降级行 exit 5 语义继续扫）。06 §5.8 迁移注记已补 v1.7 行。其余
  外部契约（CLI 形态/schema/golden/退出码总表结构）零变化。
- **内部测试设施申报**：glm-look env 钩子两枚（GLM_LOOK_HOST_CONFIG/
  GLM_LOOK_LOG_DIR——R10 mock 往返指向本地端点与临时流水之必要实现；
  缺省行为不变，prod 路径禁依赖）。
- **登记面（b9）**：RESIDUALS 新增 25 行（closed 8=修复项单行制；open 17=
  b1 三面不可实证残留/R1 超时未实证/M4 硬编码三处/M5 回归环境耦合/M6 runId
  并发/L3/L4/L5/L9 低优先四项/glm-look:150 同族/k2 首派静默/双审源同族注记
  （C6 口径：同 model-key 异 uuid 前缀，异供应商=未证假设）/verify.mjs:6/
  ccb:3/结构项三件）+在册 02-§8-model-terms 补承接批次注（不重建）。
  头注指针化=v1.6 批声称「各脚本头注一律指针到本表」未闭环的本批实证
  闭环（九件复写块清零，机检 C1 断言化）。
- **门禁终态**：regression 8/8（R1 SKIP 配给保护）+check-hardcode 命中 0
  （豁免 33）+check-anchors WARN×0/FAIL×0+--self-test 16/16+health-scan
  RED×0/WARN×2（基线存量不劣化）+新增 grep 断言 C1/C4 绿（「固定六段」
  活文档面清零+头注「退出码：数字=语义」复写块清零；红→绿+变异红证×2）。
  批档=scripts/audits/2026-09-16_evolve-*（简报/双审原文/计划 v1-v3/
  E1-E3 报告与真退出码 log）。
- **勘误注记（2026-09-16 回炉 r2 追加，08 §3 口径=勘误性最小修+注记留痕，
  其余原文不改写）**：①本条「七笔 commit」系计数笔误，实为九笔（9b6bac9/
  d3d7adc/919f27a/2c91ddd/3f0c080/58fb979/67a60e1/b76efd7/6edffa2），上文
  已正；②R1 超时表述原「4,835,000 派生+90min 裕量」易读作加法，已改
  「单源推导 4,835,000ms，×1.117 裕量取 90min（5,400,000ms）档」。

## 2026-09-16 v1.6（维护熵清偿战役——全面评审→双源对抗审→终裁→八批实施→终审回炉）

- **战役过程**：主控全面评审（脚本 10+文档 9，结论=设计 A/工程 B+/维护 C+，
  维护熵集中在 A3 双源失守/锚点契约/元治理三面）→ 清偿计划 v1.0 送双源
  对抗审（gate1-reviewer@kimi-main + @deepseek，均 FAIL/B=4，四阻断收敛：
  schema 对账先行、mock 过滤带验收断言、退出码先查调用面、07 先例并入
  裁决包）→ 主控终裁 v1.1 八批次（档=scripts/audits/2026-09-16_entropy-*，
  含裁决档与双审原文）→ b0-b8 分笔实施（九笔 commit）→ 终审双发（门一
  全量代码 diff 73KB 审 + auditor 配置面复核）→ b9 回炉全吸纳。
- **b1-b3 治理面**：RESIDUALS 三态归一（第四态勘误）+supersedes 口径+4 新行；
  08 §1 闭环撤注；02 §3 审级统一口径（[B|W|N] 定义单源，两 DoD 改指针）；
  门一 DoD 增 ≤4000 字产出预算（golden 重冻结）；**账本 schema 单源化**——
  SKILL.md/snippet 删 v1 内联清单改指针（单源=02 §9）+regression R7 正向
  校验；**锚点清扫**——06 §8.6 笔误修正（真源=02 §8.6）/「改了就要再审」
  惯例正式登记 08 §7（原引 §0 断锚）/_archive 三处绝对路径消歧/外部批档
  引用消歧（subagent-plan 05-ruling）/计数去数字化；**新脚本
  check-anchors.mjs**（断锚+路径+计数三面 WARN 试点，doc-counts golden
  对账，首校准轮零误报）。
- **b4-b5 可信度面**：log-triage mock 甄别根修——派发器 switch/exhaust 行
  补 `mocked` 贯穿+全角（mock）兜底（当日实陷：--health 曾把 4 笔演练
  429 计为真实额度失效，假推荐换源——修后实跑翻转为「k1 不换源」）；
  `_dup` 空设计删除（同秒键真去重+剔重计数暴露）；自检全 fixture 聚合；
  **验收断言入 R8**（mock429×4+真实504⇒不换源，FAIL 即阻断）。glm-look
  传输纪律对齐派发器 v2.2.1：AbortSignal 20min 唯一超时源、非 429 的
  4xx/超时立断、scrub 脱敏受控复制（R9 字面量对账钉同步）、fileURLToPath
  根治路径 hack、死代码清除、BOM 剥离、ok 行 truncated 派生布尔（闭
  glm-look-truncation-field 残留）。
- **b7-b8 配置与卫生**：org-config 新增 **source_health**（dual_groups+
  gate1_subagent_of 显式映射+--health 启动别名校验）与 **vision_channels**
  分区（**预裁 A 申报**——独立分区不触碰 roles 注册表，07「会话内岗不动
  注册表」先例保持；事实分层统一口径：身份/甄别类供应商事实住本件，
  连接/密钥类住宿主 config）；glm-look 全配置驱动（模型/端点/偏好序零
  硬编码，--list-sources 等价实证）；派发器 payg 显式告警（链首/换源双
  点位+switch 行机读位）；**06 §5.8 退出码总表**立单源+迁移注记（四头注
  改真、glm-look/skill-gc 的 2 冲突清偿）；finish 词表收紧（缺表=exit 3
  拒跑，三脚本同律，删双份兜底硬编码）；check-hardcode 静默吞错→降级
  留痕（exit 5，缺失面同覆）+年份硬编码→日期形态判定；postJson 补
  res.on('error')；R1 超时对齐 20min 上限；R4 手记行契约（stopped 事件
  登记+截止时点闸门：2026-09-16T12Z 后漏带 schema_version 的新行必计坏）；
  readJsonlFile/cliFlag 收敛 org-config 单源导出。
- **b9 终审回炉**：门一（kimi-main，run=20260916130256-eely，PASS，B=0/
  W=4/N=4）——W2 R1 容错（commit bded344 早于终审 diff 快照时点，D1
  复验已闭环）、W3 glm-look 词表拒跑、W1 R4 截止闸门+死分支删、W4 降级
  缺失面+5 优先于 1、N2 剔重计数、N3 迁移注记、N4 R7 反例扩形态，全
  吸纳；auditor（deepseek，run=20260916130257-58s9，有条件放行，B=1/
  W=7/N=4）——B 同件互斥口径按事实分层统一、W1 映射键化、W2 启动校验、
  W3/W4 字段契约与双条件命中声明、W5 pid 定序、N3 payg 机读位，全吸纳；
  **W6 驳回**（覆盖件无须复制分区——深合并语义「未提及沿用默认件」为
  org-config 自检向量 1 既定行为）。
- **验证终态**：自检 5/5（log-triage 12 向量含验收断言）；regression
  7/7+R1 双源语义抽样 3/3（解析容错三形态）；门禁三扫零命中
  （check-hardcode 0/白名单 33，check-anchors WARN×0 FAIL×0，health-scan
  RED=0/WARN×3 均在册或有处置）；新机检 check-anchors+R7/R8/R9 入役。
  cfg 哈希 54f08fbf90c5→a26f710a540d（source_health/vision_channels 落地）。
- **未吸纳转残留**：check-anchors 校准面（全角冒号/dod 扫描面/点名豁免
  漂移）与 R1 deepseek 格式抖动（3 跑 2 绿，重跑即绿）——均登记 RESIDUALS
  v1.6 节，处置时点=check-anchors 升 strict 前置批。

## 2026-09-16 v1.5（子代理绑定批 A+A'+B-0+B-1——交接书 07-handoff §三管道全量）

- **A 批**：四绑定子代理入役 `~/.zcode/agents/`（ops-executor=GLM 最高档
  Write 面+E2 白名单墙 / ops-diagnostics=真只读物理墙 / ops-probe=E2 协议墙
  如实声明 / ops-adjudicator=deepseek 异构裁决位）；系统提示三段+MODEL-SELF
  自报行+LEDGER-CLAIM 尾栏；七代理首场验证全绿（日志零回退+越权写物理
  拦截+分笔 commit+进度文件），档=E:/zcode_md/fix/subagent-plan-2026-09-16/
  08-exec-log.md。
- **A' 批**：①Kimi 双源绑定日志实证（kimi-main+zipoo 同模型键零回退；空
  tools=泄漏全工具面——门一退 tools:[Read]+双墙）；②ops-gate1-k1/k2 双源
  入役（同包双跑一致性验证：B 级核心发现完全重合，均 FAIL 判对）；
  ③④源健康检查+接续纪律 runbook（log-triage --health 五类分诊→k1/k2
  推荐；杀岗演练=进度落盘可续）。runbook 真源=批档 09 号件。
- **B-0 批**：scripts/log-triage.mjs 入册——两账并呈（cli/log 内链路+
  派发器流水外链路）五类分诊/attempt 放大统计/静默回退检测（probe-b
  形态可机检抓出）/岗×源用量（Kimi 双源分列）/finish 终态派生（保守
  口径，词表住 org-config finish_vocab）；2026-09-16 真实日志回放=正确
  指出当日 504 双源 exhaust 并建议不换源（mock 演练行自动剔除）。
- **B-1 批**：check-hardcode 扩容（实配模型名词表=宿主注册表派生+归一
  变体；agents 目录 ops-*.md 剥 frontmatter 扫正文——B-2 裁决②③）；06
  §1 设计岗行指针化；org-config/registry 增 roles.*.migration_note（⑥
  迁移期双承载注记，cfg bec09005e3ac→54f08fbf90c5）；RESIDUALS 新登记
  7 条（含 05 §七指认的流式化登记缺口补正）；06 §6 补遗+07 §4 补遗+
  SKILL.md 派发节子代理绑定通道段。
- 授权链：用户裁决 D2 四项+指令二（承载架构改版）+裁决三（多模态域
  B-6 定档）——05-ruling.md §八/§九/§十。

## 2026-09-16 v1.4（防截断入册+产出入仓纪律批——用户指令「补齐，保证技能后续使用时不会持续造成 AI 污染」+「防截断调整嵌入技能」）

- **派发防截断根修入册**：ds-call-v2.mjs v2.2.1（node:http 直连/
  signal 唯一超时源/20min 上限）脚本本体已由 F-TESTREF-00 批落地
  （2026-09-16，Synapse 仓 6ff13f95f4 记档），本批补齐文档面——
  references/06 §5.7 补遗（499 分诊/undici 300s 隐形杀手/对策三层/
  双臂探针实证）+ references/04 §八 ORG-12/ORG-13（超时排障链+
  证据链三伤）+ 任务书模板纪律段（审包瘦身+产出预算+产出面纪律）+
  SKILL.md 派发段操作事实。
- **产出入仓面纪律立件**（防 AI 痕迹污染）：references/08 §6——
  入项目仓工件（文件名/内容/commit message）零外部模型代号与 AI
  指称；派发工件命名弃源别名后缀；§5 审档归宿收紧（默认仓外档案
  区，入仓须先中性化；反例=2026-09-16 Synapse 审包入库带模型别名）；
  词表单源=项目仓门禁脚本（WaterPrint 双面/Synapse 现 src 面）。
  SKILL.md 红旗表+烤验触发表（收口/交付批行）挂载；任务书模板
  纪律段带指针。
- **姊妹技能同批**：review-ai-code §六「痕迹回流检查」操作化
  （词表+两仓门禁命令+命名面人工过目——Synapse md 面未设防段）。
- 未了项：Synapse md 门禁扩面（存量 562+ 件处置）另立批次；
  流式化（根治贴窗）留技能层后续。

## 2026-09-15 v1.3（入口治理批——用户指示「优化本机的 AI 软件开发技能」）

- **修订记迁档**：SKILL.md 修订记全文迁入本件，入口只留最近一条摘要
  + 指针（入口瘦身，历史零改动）。
- **脚本清单补齐**（残留 skillmd-scriptlist-sync 闭环）：SKILL.md
  §派发与自检 补登 `check-hardcode.mjs`。
- **供应商实配名指针化**（残留 glm-look-endpoints 闭环）：SKILL.md
  与 references/07 操作段的模型名/端点改为指向 org-config 与
  `glm-look.mjs --list-sources`；07 修订记历史叙述按红线原样保留，
  白名单条目相应收缩为历史豁免。
- **关联技能断链修复**：loop-defenses / loop-retrospective 的
  `../loop-engineering/` 死链改指本技能 references（03/04/05），
  并在两件中显式声明与本技能的分工。
- **新增姊妹技能 review-ai-code**（用户模糊需求分析落地）：面向
  人类负责人的全局图景建立 + AI 产出审查 + 带掌控派活协议；与本技能
  互补——本技能管"AI 组织怎么运转"，它管"人怎么驾驭 AI 组织"。

## 2026-09-14 v1.2（优化批——Kimi 异源对抗审核后；裁决档=scripts/audits/
  2026-09-14_plan-v1-ruling.md，审核档=同目录 *-kimi-audit-out.md）：
  修复合入前防线自身的三处「自证失效」+新增两项机检——**P0-1** 收口
  门禁被演练数据永久卡死（实测 RED ×1；原 won't-fix 被证伪）→ 演练行
  源头甄别 + health-scan 跳过 mocked/临时项目；**P0-2** 截断的审计报告
  被记为 ok（实测 8 笔，含门一 out=32768）→ 账本 `truncated` 派生布尔 +
  health-scan ④ RED（白名单反转判据）；**P0-3** 「零硬编码」声明无机检
  且正文确有 live 端点 → check-hardcode.mjs（名单从 org-config 派生，
  WARN 起步 + 独立 JSON 白名单）；**P0-4**（审核者未见，基线亲验发现）
  技能自身 R4 回归 FAIL → 网络失败写 `statusCode:null` + regression 按
  `channel` 标记分类外来行。另：账本 schema v2（runId/mocked/truncated/
  schema_version）、Node 版本守卫、任务书增「运行时可观察性」项、
  审计岗 DoD 增机读 FINDINGS 尾栏。八条新增残留见 RESIDUALS.md。

## 2026-09-11 v1.1 补遗④（用户指示）：外呼看图扩双通道——deepseek
  已可识图，与 GLM-5.3-Flash 一起承担视觉任务：glm-look.mjs 增
  `--channel glm|ds`（ds=deepseek-flash@api.deepseek.com，OpenAI
  image_url 载荷；流水 channel=ds-look；识图实证在册）。纪律四条双
  通道同守（截断终态通道化 glm=max_tokens/ds=length）；**三段流
  定式=glm 判读→ds 审核提异见→glm 终裁（D/R 制同构——2026-09-11
  用户指示定式；两轮 -o 落档，视觉验收面照旧留用户）**。真源=
  07 设计岗卡补遗条。

## 2026-09-10 v1.1 补遗③（用户指示）：设计岗外呼看图标准流程入册——
  `scripts/glm-look.mjs`（GLM-5.3-Flash 多模态，宿主 config anthropic
  端点自发现+流水入同账本 channel=glm-look）；纪律四条=max_tokens≥8000
  且零正文自动倍升（thinking 段耗额坑——低档=假成功）/判据先行禁裸问/
  报告溯源头+流水可指认/方向级决策仍留用户。真源=07 设计岗卡；首次
  实战档=WaterPrint C 批需求采证（.workflow/c-analysis/）。

## 2026-09-10 v1.1 补遗（用户 Ruling）：①v1.0 冻结生效（四项裁决，
  见「验证状态」节）；②02 §8.6 三段通道新增第 0 步「社区实践调研
  前置」——较大模块技术路线选择，主控（GLM）先调研社区实践
  （技术大佬/知名项目选型），调研结果随任务包作 Kimi 拟定参考输入，
  不闭门造车即可。

## 2026-09-10 v1.1（优化战役，W5 全局三源审计回炉轮 1）：加载地图+09；
  烤验触发表立节（W4）并按双源审计增「纯配置变更批/收口交付批」两行
  +复合批并集注记；团队化边界段立节（W3）；派发命令清单+三新脚本
  （init-defenses/regression/health-scan）；Node24 派发注记
  （HOST-node25）。变更明细=技能仓库 git 提交链（W0~W4 五提交）+
  回炉轮 1 提交；审计档=Synapse scripts/audits/2026-09-10_w5-*。
