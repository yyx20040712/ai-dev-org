# 残留登记册（ai-dev-org · selfiter 批重立薄册 2026-09-17）

> 三态：open（待处置）/won't-fix（显式不修+裁决依据）/closed（已修）。
> **静默消失=违规**。历史登记全量=归档件 `~/.zcode/skills/_archive/
> ai-dev-org-history-2026-09/RESIDUALS.md`（含 selfiter 终态化登记节——
> B1/B2 修复闭 20 项、C 类终态 11 项、范围界定与触发器口径；路径相对
> skills 根）。本册只登记其后新发现与在册触发器。

## 触发器行（open——触发即处置）

| 编号 | 内容 | 触发器 |
|---|---|---|
| evolve-b1-transportresidual | >300s 首字节/Node25 退出面/异端点流式语义三面不可本机实证 | 真外呼窗口（R1 真跑/设计岗首用）核验 |
| evolve-k2-silent | k2 首派静默失败单次事件 | 复发≥2 次升宿主排查批 |
| g3-deploy-writereal | 派生覆盖件异机真机写盘 | 下次新机部署首跑 --install |
| PostToolUse-livefire | hook 实弹触发验证 | 需机检强制（hook 拦截）的批次首场核对 |
| killed-agent-metadata-gap | 被杀岗 metadata 无声明值可核 | 机检化（编排会话派发记录回填）后续批 |
| check-anchors-calibration | 全角冒号形态/dod.md 扫描面/点名豁免漂移面 | check-anchors 升 --strict 决策前置批 |
| host-metadata-schema-drift | 宿主子代理 metadata schema 演进使 ③ 检测面失明（在册实例：2026-09-17 profileSnapshot.model 字符串→modelSelection 结构体，旧 ③ 静默跳过新格式绑定岗——declaredModelOf 已收编两格式；真源=10 §3） | 宿主升级后首场绑定岗派发核对 metadata 形态仍被 declaredModelOf 认识；常驻 tripwire=log-triage ③ WARN「格式漂移疑似」（detectMetadataShapeDrift：model 键非字符串/modelSelection 残缺）出现即触发处置 |
| empty-declared-blindspot | 空字符串 model 声明被当非绑定岗静默跳过（tripwire 只查非字符串形态；批前既有行为，宿主空串语义未确证——门二裁决 B3 登记；真源=10 §3） | 宿主 metadata 实证出现 model:"" 时处置（先确证语义再定跳过/漂移口径） |
| log-triage-import-side-effect | log-triage.mjs 顶层无 import.meta.main 守卫，import 即跑 CLI 主流程（门二实证 M5-M7 注入命令实录；批前既有） | 出现模块化消费该文件的需求时加守卫（当前消费面=CLI+自检，无受损） |
| volta-exitcode-mask | volta run 将任意非零退出码掩成 126（本机实证 2026-09-17：1/2/3→126、0 正常、裸 node 透传无误；DEPLOY.md §0 已提示；真源=10 §1） | 出现脚本化消费精确退出码且须经 volta run 的封装时处置（volta pin 固定默认或直跑 node） |
| k2-deepseek-rebind | **已撤销（2026-09-22 批中用户澄清：k2 系 k1 额度兜底位，不改绑；终态=增设独立岗 d1）**——历史行保留至本批收口后清理 | 无（撤销） |
| gate1-d1-firstdispatch | 新岗 ops-gate1-d1（deepseek 按量档绑定，2026-09-22 用户裁决增设；绑定值单源=agents/ops-gate1-d1.md frontmatter）——代理档案会话启动快照，设立会话内不可派发 | 新会话首场 d1 派发：metadata 声明模型核对+`log-triage.mjs` ③ 静默回退检测零回退+MODEL-SELF 尾栏一致，三项齐=closed（对齐 selfiter-k1k2-reasoninglevel 闭合形态）。另：观察项（不门控 closed）——同场记录 k1/d1 报告发现并集覆盖度，供异构价值评估 |
| r2-drywindow-livefire | ds-call-v2 干涸窗记忆（2026-09-22 R2）：自检 6/6+mock 功能演练已证（R11），**真实 429/403 触发路径未实弹** | 首次真实配额族失败后核对三件：source-dry.json 落标/次派发 [dry] 跳过行/窗口过期或成功调用自恢复——齐=closed |
| probe-bc-metadata-residue | 历史会话残留（probe-b 声明=sonnet 枚举伪值/probe-c=deepseek 无档位后缀——盘上无对应档案，纯 CLI metadata 痕迹）污染 log-triage ③ 输出噪声（2026-09-22 全局诊断批发现，R6 登记；真源=10 §3） | log-triage ③ 呈现面升级时加无档案过滤；新同形态会话复发即升宿主排查批 |
| synapse-md-expand | Synapse 项目仓 md 面门禁扩面（范围外） | Synapse 项目仓独立批 |
| edfix-r1-e2e-gap | escaped-defect 修复批（2026-09-19）R1 标准真跑 SKIP——parseFindings 端到端仅由同批 auditor-readonly 单点真实派发实证（账本 runId 20260919061400-nthy333f，中文 verdict 有条件放行完整附着），回归网对dispatcher→账本链路无持久向量（回炉 W-5） | 下次派发器/parseFindings 变更批或冻结裁决前跑 `regression --r1`；届时本行随批 closed |
| cross-gate-samefamily | 现役跨门岗对同族（门一 d1=deepseek↔门二裁决部 adjudicator=deepseek）——异构对抗退化形态，log-triage --health ⑧ 常态 WARN（v2.1.0 批纪律⑤机检挂载，计数行在册；申报面=收口呈报包；2026-09-22 用户裁决「同意裁决」=WARN 常态维持，改绑仍留后续裁决位） | 升格 RED=跨门异构护栏落地或裁决部改绑异族源（改绑=用户裁决位）；每场收口 --health 复检计数 |
| share-gate-drive-residual | 分享门禁盘符维度已知漏报族：目录段首字符为转义字母且次字符非字母数字的形态（如单字母目录/下划线/连字符开头段，正反斜杠同律——v2.1.0 回炉轮2 口径成文，PACKAGING §1 在册） | 真实泄漏事件或扫描器升级批处置；日常按门禁其余两维+文件名通道覆盖 |
| d1-secondpass-w1-falsified | d1 二过 W-1（疑 share-whitelist 残留目录级 E:\\ 宽豁免）——主控机检证伪：两条 E:\\ 条目均文件定址（04/05），references/ 前缀条目仅 E:/zcode_md 与 E:/class 具体串（裁决记录，防复发复猜） | 无（证伪结案；白名单变更批随批复核该面） |
| render-typo-key-residual | 绑定模板占位键笔误形态（{{bind:…}}/{{bindnig:…}}——不含 binding 子串）绕过渲染 tripwire 静默直装（k1 二过 N-3；标准/畸形/未闭合三形态已覆盖，此为键名拼写面） | 模板占位键重构批或首见笔误实害时处置（放宽为全 {{…}} 残留检测+标准形白名单）；deploy-check ④ 渲染对账可兜底发现（部署后漂移位） |
| synapse-temporal-defect-refine | Synapse F-LINEAGE-02 ①a 批（2026-10-01）三教训：CSS 过渡按样式重算周期末计算值判定（禁断→恢复需强制回流分隔）／时间维度缺陷需时间维度断言（多时刻采样）／切片断言采样起点须取被锁行为发生前最后自然采样点后（恒真断言经变异红证证伪实证）。三条候选升级挂账**暂不实施**（用户裁决 2026-10-01「挂账在末尾，检验提炼后再考虑完善技能」）：①禁断→回流→恢复抽共享工具函数 ②瞬态多时刻采样固化为常驻 e2e 用例 ③Synapse methodology §4 ⑤j 候选条款（涉 CSS 过渡/异步视觉状态票面验收段必含时间维度断言形态）。教训本体回流=项目事故档（v105 §3 待回流段在案）；工程升级载体=项目层（代码/测试/methodology），不入本技能 | **短窗检验**=F-LGRAPH-01 ②批（编辑器交互批——useCardDrag 拆分+调线手柄又一处命令式 DOM）收口时盘点：同型时间维度/恒真断言缺陷复现≥1→三条升级立即随批实施+⑤j 正式立条；零复现→教训降级为事故档常规行、⑤j 不立（防过度治理）。**技能泛化**（本技能收录「时间维度缺陷防线」类内容）=第二个前端项目出现同型复现时再议——走 05 §6 差异回灌协议，届时以结论+项目档案指针形态入册不复述细节 |
| synapse-skill-consolidation-window | 用户裁决 2026-10-01：脉络图战役收口后集中维护技能——「打造软件工程领域综合大型技能，使其他技能功能均被本技能覆盖，简化流程+保证单一信息源」。随批两件：①下批开工纪律技能清点表增「消费点」列（微改动，F-LGRAPH-01 ①批简报携带）；②主控建议四组入档（战术知识消费现成技能/技能=判断力编译+机检优先+事故锚点+窄而深+技能过自门/真实缺口=视觉回归常驻+性能预算+消费接线/移植判据=防什么风险而非大厂都这么做）。**主控异议在档**：巨石式「内容覆盖」有四风险——上下文经济学（全域知识单技能=每次加载 95% 无关内容；本技能自身「references 按需读」设计即为此解）/复制即双源（官方/插件技能内容抄入自有技能=第二事实源，上游更新即腐化——恰违反单一信息源本意）/治理面失控（600 字符预算+anchors 机检管得住窄技能，全域巨石=规则冲突+审不过，selfiter 六批两轮回炉治理八个岗位的先例可参）/违反本册刚立的二次实证泛化判据。**主控替代方案**：伞形架构——入口唯一（本技能或新薄路由技能承载「分域消费点索引」：什么场景读哪个现成技能的哪节），内容驻原地零复制，项目特异规范驻项目——「覆盖调度权而非内容」；单一信息源的正解=每个事实恰一个权威出处+指针互联，非物理合并 | 脉络图战役收口（F-LGRAPH-01 ②批 done）后用户启动集中维护期：首场=自有技能库重复面测绘盘点+「伞形 vs 巨石」呈裁（本行异议与两案随呈批包内联），用户裁决后分批实施；实施批照 selfiter 先例过门一对抗审 |

## 修订记

- 2026-09-29 矛盾清偿+小批单审换源批（两笔合审）：**批A 矛盾清偿**——02 §1
  角色表收敛为指针+WP×SY 承载对照（根因=A3 双源：门二行「只审不跑」与 07 §1
  双部制「裁决部禁跑命令」文本冲突，照 06 §1 v1.7.5 先例；门二词表
  CONFIRMED|REJECTED|ESCALATED 收编 02 §3）；02 §8.3+06 §3 旧「可省批次降
  兜底档/降同源=配给内降级」口径废止（与分级烤验 R5 单审口径对同批次源安排
  相反，删旧留新）；02 §8.1「必须显式指定模型」补三枚举单源指针（随宿主
  形态=06 §2 铁律1③ 合法）；00-glossary 主控行指针 02 §1→07 §1 联动；07 §1
  全文逐格对照签核=被删职责/禁令七处全部有承载（主控亲验）。**批B 小批单审
  位换源（用户裁决原文：「修改纯文档小批次审核，由k1改为d1，为了节约成本」）**
  ——分级烤验修订一：小批（纯文档/纯注释 ≤3 文件、无逻辑行变更）门一单审
  k1→d1；单点配置批维持 k1（用户文句未覆盖，保守裁量）。成本口径申报：本批
  按「节约稀缺额度」执行（Kimi 订阅额度=约束面，d1 按量计费入账）——若本意
  为金费支出则方向相反，留用户裁决位。同步面：SKILL.md 分级烤验段（单源）+
  02 §8.3 摘语+06 §3（纯指针）。门一审=ops-gate1-d1（小批新单审位自审自证；
  B0/W3/N5 PASS，84063 tok，agentId 2c4ece20），回炉一轮全处置：F-1 可省
  清单与单源分类不闭合→02 §8.3/06 §3 补「仅命中分级烤验定义者方走减档、
  未命中默认全对抗位」；F-2 单源旁复写明细且有损（§8.1 丢 E3 记账要件/
  §8.3 丢主控亲验要件）→两处改准纯指针；F-3 残留册同步缺→本条即补；
  F-4 回炉 W-4 出处注记→SKILL.md 标题行恢复；F-5 门二词表与 findings-parser
  关系→02 §3 注明会话内岗不入统一面；F-6 表内括注措辞→02 §1 注明承载史
  注记非现役禁令；F-7 用户原文与成本口径→本条原文入账+申报；F-8 R1 SKIP
  盲区→小批→d1 生效点=主控派发选座（非派发器路由），R1 不覆盖、无端到端
  机检位，下场纯文档小批实派 d1=首验（与 gate1-d1-firstdispatch 触发器行
  同场核对；本场 d1 派发已留 MODEL-SELF 尾栏+metadata 声明一致两项证据，
  ③ 静默回退核对因窗口内无请求记录不可核——触发器维持 open，③ 观测面
  空窗另留意）。机检终态：anchors 0/0+hardcode strict 零命中+regression 9/9
  （R1 配给 SKIP）。

- 2026-09-22 v2.1.0 完善与分离战役（用户裁决「只要保证方向符合软件工程业务目标
  即可，赞同你的决策，请开工」）：六批（矛盾清偿/宿主耦合分离 10 号册/org-config
  三层化/模板绑定占位化/分享打包+三维门禁/收口）+回炉两轮。对抗链=门一双审
  k1（B1W4N8 FAIL）+d1（B3W12N4 FAIL）→轮1 全处置（B1 盘符正则排除族漏报/
  B2 白名单 fail-open 双闸/k1 畸形占位 tripwire/词表整词剔除+裸前缀入表等
  19+12 条全裁）→d1 二过 B0W8N9 PASS（W-1 机检证伪=d1-secondpass-w1-falsified
  在册）→轮2 d1 二过 8W 全处置（跨盘误拒/骨架 note 自咬/node 守卫缺省 warn 化/
  synthetic_exempt 收紧 scripts/ 域/term_exemptions 加闸/未闭合占位检测）。
  probe 实证 10/10 全绿+node24 对照可部署（证据=Temp/probe-v210-progress.md
  仓外档）。B3 裁决=三层等价性主控机检逐键 diff 亲验（canonicalize 对比仅 note
  级差异+cross_gate_pairs 预期新增，输出在主控会话实录归档）；本机件
  org-config.local.json=gitignore 个人事实层，**备份=用户责任**（建议私有副本）。
  先例两笔：①门一审包「单文件=审包本体」授权载体形态（派发工具截断的补救，
  例外声明记档）；②门一异构位与门二裁决部同族=纪律⑤ WARN 常态（触发器行
  cross-gate-samefamily）。机检终态：org-config 48/deploy-check 39/log-triage
  全过/package-skill 24 向量；validate PASS；regression 9/9（R1 配给 SKIP）；
  hardcode strict 零命中；anchors 0/0；health-scan RED=0；实包门禁零命中
  +MANIFEST 65 件；deploy-check@node24 ok13。

- 2026-09-22 全量修复批（用户裁决「全部修复」，承接同日全局诊断报告
  R1-R6）：**R2 干涸窗记忆**——ds-call-v2 v2.4.0 增 dry-until 标记
  （429/403 配额族失败落标、窗内派发跳过、成功即清除、--no-dry 应急、
  --self-test 6 向量；标记=SKILL_ROOT/.zcode/source-dry.json 全局单
  文件，DS_DRY_FILE 可重定向；时长=org-config source_health.dry_minutes
  缺省 60）——掐断「干涸窗内每派发对死源重打」（30 天实数 567 attempts/
  46 ok/87 switch）。**R3 常设双审对同族 tripwire**——org-config 增
  model_family+standing_pair；health-scan 启动校验同族=RED exit 3；
  log-triage --health ⑧ 实况核对（agent frontmatter→uuid→provider→
  family，现役 k1=kimi/d1=deepseek 异族成立）。**R4 子代理通道补记
  纪律**——02 §9 成文（ok 行必带 truncated:false+runId）；顺手修复
  2026-09-19 批 4 行漏 truncated 补记行（数据修复：1 行 source=host+
  3 行 gate1-k1 子代理通道，R4 闸门逼出）。**R1 文档同步**——SKILL.md
  速查表门一行/绑定通道段/用法面/log-triage 行、07 §1 表+双承载注记、
  07 §4 名录（+d1 行，计数改指针式）、06 §6 补遗①（uuid 标识注记）、
  review-ai-code 门一段（跨仓同步）。**R5 分级烤验**——纯文档/单点
  配置小批=门一单审（k1）+主控亲验；实现/收口/跨件/红线批仍双审
  （k1+d1）；审包预算 ≤8k tokens 扩面子代理通道。**R6**——probe-b/c
  历史会话残留登记触发器行。新增 regression R11（自检/干涸功能演练/
  R3 负例三向量）+R5 演练 DS_DRY_FILE 隔离（生产标记活跃时演练免疫）
  +R4 流水 schema 登记 dry-skip 事件。机检：validate PASS/regression
  9/9（R1 配给保护 SKIP）/hardcode strict 零命中/anchors 0/0/
  deploy-check@node24 ok13。对抗位=双审：门一 k1（B=0/W=8/N=8 PASS）
  +异构代位审 ops-adjudicator（deepseek，代 d1 位——d1 设立会话内不可
  派发，代位申报入档；B=1/W=4/N=7 有条件放行）。回炉一轮全处置：B-1
  ⑧假绿改三分支终判（?/ok/WARN，旧版把未解析吞成「[ok] 异构成立」）/
  W2 fail-open 收紧（standing_pair 缺键或缺 model_family=FAIL，非静默
  通过）/R11 派生化去字面别名（名单=source_chain−standing_pair[1]，同族
  负例对派生）/W3 06 §4+02 §8.2 不得主动跳过例外成文/W4 R5 小批边界
  与异构代位组合成文/W1 读容错告警（ENOENT 静默、损坏[dry-warn]）/
  W2' tmp+rename 原子写/N1 dry_minutes=0 停用语义/N3 全干涸分支落观测/
  N4 过期条目随写 GC/N6 引号剥离/N8 family 归一化比较/N2' dry-skip 带
  mocked 标记。复跑全绿：validate/self-test 6/6/regression 9/9/
  hardcode/anchors/deploy-check ok13+⑧ 新证据行（双侧实解析异族）。
  实测教训两条入册：①代位审包若授予实件自由读，成本 4.5M tokens 级
  （adjudicator 本批实跑）——审包自包含纪律对代位岗同样适用；②本批
  git 分笔=脚本+配置+文档三笔。残留登记：k1-W6 真实 429→落标集成路径
  无确定性向量（mock 不落标=设计边界），由 r2-drywindow-livefire 触发
  器承载；k1-W8 脚本体 hardcode 扫描面缺口（.mjs 面无扫描，纪律靠审）；
  k1-W7 数据修复 before/after 存证=本册 runId 清单（02 §9 注记同步）。

- 2026-09-22 门一异构双审终态批（纯配置变更；用户三段裁决收敛）：
  ①「两个审核一 kimi 一 deepseek（kimi 额度不够）」→ 首案改绑 k2→
  deepseek 执行四面后；②批中澄清「k2 是应对 k1 额度耗尽设计的，子代理
  不动」→ 改绑全数回滚（部署档/模板/org-config 结构/本册，k2 恢复
  kimi-backup 绑定原值）；③「deepseek 也走独立子代理，方便管理」→
  终态落三岗制：**常设双审=ops-gate1-k1（kimi-main 子代理）+ops-gate1-d1
  （deepseek 按量档独立子代理，新增岗，绑定值取 adjudicator 现役同款
  零回退先例；部署档+模板双侧 sha256 一致）；ops-gate1-k2=kimi-backup
  额度兜底位（源A耗尽承载）**。净变更：新增 agents/ops-gate1-d1.md
  （双侧）+org-config（gate1_subagent_of 增 deepseek 映射+migration_note
  终态+kimi-backup note 补角色注）+本册 gate1-d1-firstdispatch 触发器行。
  运行时欠账=d1 新会话首派三项核对（见触发器行）。另：本批 deploy-check
  的 node-major FAIL=系统 node25 触发受禁检查（在册 HOST-node25 环境残留，
  先于本批存在），volta node24 下复跑全绿——非本批引入。
  门一 k1 复核（代行 auditor-readonly，payg 规避+额度敏感预裁）出件
  B=0/W=4/N=6 PASS 全数处置：W1 deepseek note 对称补注/W2 互补性核对
  改观察项不门控 closed/W3 降级形态入 migration_note（链退 deepseek=
  d1 独立一审+账本单源降级标注）/W4 回滚证据=k2 模板 git 零 diff+
  部署档 sha256 与模板相等（deploy-check ok 行），双证成立；N1 绑定
  纪律首段=uuid 标识注记（06 §6 补遗①随批补）/N2 档位成本未量化
  （$max 按在册纪律，降档=一行改绑+新会话验证，用户裁决位）/N3
  dual_groups 语义注记入 source_health.note/N5「恢复」改「落位」/
  N6 代行缺口=d1 首派后额度允许时对本批终态补一次复核（可选）。

- 2026-09-19 escaped-defect 修复批（ed-fix-①②）：清偿 batch-relay-prod
  战役登记的两项 org 侧逃逸缺陷——①ds-call-v2 parseFindings verdict
  字符集 [A-Za-z]→字母∪CJK 基本区（v2.3.2；原与 auditor-readonly DoD
  中文词表 放行|有条件放行|返工 结构性失配=auditor 尾栏永不附着+health-scan
  ⑥ 连锁误 RED）；②health-scan ⑥ FINDINGS 缺栏执法面拆挂 org-config
  新字段 `roles.<id>.findings_surface`（gate1-reviewer/auditor-readonly
  挂、drafter 不挂——原 audit_surface 一标志双语义把无尾栏 DoD 的拟定岗
  拉进执法面=每行真实 drafter ok 永久误 RED；④截断执法面仍挂
  audit_surface 不弱化）。逃逸根因记账：R10 向量当年从解析器假设出发
  而非各岗 DoD 契约——本批按岗 DoD 词表补向量（中文三词+中文尾随标点
  N1）+health-scan 自测拆标志夹具（20/20）。验证：regression 8/8+
  hardcode strict 零命中+anchors 0/0+战役项目 residual RED 实测归零
  （findings 分布={"返工":1} 正常汇总）。战役账本 escaped-defect 行由
  主控补 ruling 偿还行闭环。
  回炉轮1（auditor-readonly 有条件放行 B1/W5/N3、门一 k1 PASS B0/W2/N4）：
  B-1 证伪降 N——parseFindings 为全串捕获、下游无词表归一分支（⑥ 仅
  精确键计数），「有条件放行」不可能被「放行」吞并，铁证=同批真实派发
  账本行 verdict 原样「有条件放行」+R10 既有全串断言向量；W-1 答复——
  战役 auditor 旧行缺栏系批内 15:05 ruling 人工核对回填（值逐字取自
  审出件），残 RED×1 本就只有 drafter 行，修复后归零非重扫语义取巧；
  W-2/W-3 实修——org-config validate 增 validateRoleSurfaces 双向
  一致性机检（findings_surface⇔DoD 尾栏行，挂错/漏挂任一方向 exit 3，
  +4 自测向量）；W-4 证据——gate1-reviewer.dod.md 第 14 行即全型
  FINDINGS 尾栏（B/W/N+PASS|FAIL）；W-5 登记——本册触发器行
  edfix-r1-e2e-gap；N-3 采纳——02 §10 ④ 注 audit_surface 名实注记。
  验证补面：org-config validate+--self-test 全过、regression 8/8。
  回炉轮2（auditor-readonly 二轮 B0/W4/N4 有条件放行→全处置）：W-1
  实修=validateRoleSurfaces 补 registry↔cfg.roles 差集向遍历（+1 自测
  向量）；W-2 实修=hasTail 裸子串改行首锚定 `/^\s*`?FINDINGS:\s*B=/m`
  （防说明性提及假通过/假误报）；W-3 成文=02 §9 人工回填例外条款
  （ruling 留痕+复验双轨口径）；W-4 实修=validateRoleSurfaces 挂入
  ds-call-v2 loadSources 前置关卡（派发拒启 exit 3——validate 不再仅
  人工/CI 触发）；N-1 采纳=R10 有条件放行向量标注「归一化行为锁」；
  N-2 采纳=错误文案分型（无 dod_file 字段/文件不存在/不可读三型）；
  N-3 补件=SKILL v2.0.2 与本修订段原文随呈批包内联（门一 k1 二过
  核对）；N-4 采纳=02 §9 词表两域独立注记。门一 k1 二过（delta 包
  B0/W1/N3 PASS）：W1 实修=R5 增集成行为锁向量（bad-surface 覆盖件
  cwd 下断言派发 exit 3+stderr 点名——防 loadSources 接线被误删后
  纯函数向量仍全绿的 fail-open 静默）；N1 采纳=hasTail 全形代理
  （B=/W=/N=/VERDICT= 同构，防截断尾栏改道逃逸）；N3 采纳=def?.
  可选链+花括号块；N2 记档=差集向无豁免口（registry≡roles 同集纪律
  下正确，形态演进时再议）。回炉两轮=默认上限
  【SY】≤2 收口，二轮后残余处置不再开第三轮对抗审（终态=门一 k1
  首审 B0/W2/N4→补证闭环 B0/W0/N4→二过 delta B0/W1/N3→W1 补锁；
  门二 probe 7/7；auditor 两轮 B1→B0 收敛有条件放行，残余 N 级记档）。
- 2026-09-19 随宿主批（host-follow）：用户裁决「所有 GLM 绑定岗默认
  跟随宿主会话模型」（宿主已配 coding plan 服务商）——ops-executor/
  ops-probe/ops-diagnostics 三岗六件（模板+已装档案）删 frontmatter model
  字段（未绑定形态=回落宿主默认），正文绑定句与机读尾栏同步
  MODEL-SELF/EXECUTOR=model-field:…→session:host-tier（E3 欠账行恢复）；
  异构对抗三岗（gate1-k1/k2=Kimi、adjudicator=deepseek）绑定不动。
  文档同步：SKILL.md 绑定段+07 §1 双承载注记/§4 随宿主批注记+06 §6
  补遗注记；顺手 2 处：ops-executor 正文「六段简报」对齐七段口径。
  验证：deploy-check ④ 六件 sha256 相符+pre-commit 快扫+regression
  （本会话=代理档案旧快照，未绑定形态真实派发核对=下会话首场小任务+
  log-triage ③，会话快照纪律 06 §6 补遗④）。

- 2026-09-17 漂移清偿批（drift-clear-2026-09-17）：外部评估批出 9 项文档
  双源漂移+1 项环境交互事实，本批清偿——02 §10 机检面收全 ①-⑦+呈现
  排序归一（原乱序①④②③⑤且⑥⑦散落 §9 括注）/§5+§9 回炉上限默认口径
  （宪法未声明取严者【SY】≤2 轮，主控预裁申报、ORG-SEG 可覆盖）/§9
  六段残留对齐七段；06 §4 403 归因对齐 log-triage 配额族口径（v2.0.1
  L4）/§6 补遗①绑定格式补 `$档位` 后缀（单源=07 §4 纪律①）；07 §1
  编制表双承载注记+实现者行七段对齐；08 §5 挂 §6 规则 4 指针/§1 寻址表
  扩 01~09；05 §5 整合基准口径注记。评估批另报「06 §0 断锚」经复核
  **撤销**（00 术语表前导已单源定义 §0 约定并以 06 §0 为例——非缺陷）。
  DEPLOY.md §0 增 volta run 退出码掩码提示+本册登记 volta-exitcode-mask
  触发器行。门一=ops-gate1-k1 隔离审（自包含 diff 包）B=0/W=2/N=3
  PASS；回炉一轮全处置：W1 八处指针主控逐点亲验（七处实在，一处指错
  ——「05 §2 回炉轮数」更正为 06 §7，补遗二引文转写改逐字）；W2 ⑥⑦
  补日期字面+⑦ 窗口口径；N1 消 ≤2 双写（§5 改纯指针）；N2 全角斜杠；
  N3 消 `$max` 双源陈述。门禁：anchors 0/0+hardcode strict 零命中+
  pre-commit 过+regression 8/8（R1 配给保护 SKIP，2026-09-17 已有真跑
  3/3 记录在册）。

- 2026-09-17 档位批首验闭合：selfiter-k1k2-reasoninglevel **closed**（新会话派发
  ops-gate1-k1 真实审包小任务）。证据链四件：①宿主 metadata
  `profileSnapshot.modelSelection.options.reasoningLevel="max"`（`$max` 语法宿主
  解析活体实证）；②网络日志 provider=kimi-main（org-config 别名）/model=声明
  绑定值（剥档位后一致）/attempt=1/finish=stop（102s/8691tok，tool_uses=0=
  协议墙遵守）；③log-triage ③ 零回退
  检出+⑥ 归因 `ops-gate1-k1 @ kimi-main calls=1 in=5439 out=3252`（与 metadata
  usage 逐字一致），MODEL-SELF 尾栏=声明值；④反证样本：同日 5 次旧快照
  （level=None）派发全部卡死 status=running=拒启形态。随批清偿检测面盲区
  （首场真实派发即暴露）：log-triage ③ 声明值归一器 `declaredModelOf`——
  宿主 metadata 新格式 `modelSelection` 结构体合成同构字符串、旧 `model`
  字符串透传、残缺形态=null 跳过不合成伪值；单比较口径不分叉+4 自检向量
  （regression R8 承载，8/8 过）。

- 2026-09-17 档位批：根因定位 selfiter-k1k2-reasoninglevel=宿主 model 串
  `$档位` 后缀语法（非 UI 选择器）；六岗七档案+六模板统一 `$max`（含清偿
  三件 GLM 岗契约尾栏残留的旧前缀串）；log-triage ③ 检测面同步（VALID_MODEL_RE
  认 `$` 后缀+account: 前缀、比对剥档位，向量随批）。

- 2026-09-17 v2.0.1 修复批：外部全局对抗审（主控承接分析+门一 Kimi 双源
  独立全局审双 PASS——绑定子代理通道受阻按 runbook 换外部派发器承载）清偿
  脚本 7 中+18 低缺陷与 2 处文档双源漂移（明细=git 分笔提交）；三件 GLM
  绑定模板与已装档案统一 account: 前缀（宿主 provider id 再变更时
  deploy-check warn 复活属预期执法非缺陷）。

- 2026-09-17 selfiter 批 B3 重立：全量册归档（65 件历史件随批出库，sha256
  对账 65/65 OK），薄册仅承载触发器行与后续新登记。
- 2026-09-17 selfiter 批 B4/B5/B6 承接项闭环：evolve-m6-runid+
  project-id-migration（B4）、glm-look-streaming（B5——真端点流式语义留
  R1 真外呼核验位）、check-hardcode-promotion（B6 升格判据满足，strict
  RED 生效+--warn 逃生口）。g3-glossary-drift 并入 08 §4 体检纪律（用户
  裁决，不单独立项）——至此 selfiter 四组裁决 D 类全部实施完毕。

- 2026-09-17 selfiter v2.0 收口注记：门一出件 B=0/W=3/N=3 PASS 全数处置
  （回炉笔 a872d5e）；R1 真实派发 3/3 双源方向一致（流式派发器首场，
  kimi-main 三连首发成功零 504=B5 真窗实证）；门二机械矩阵 12 项真退出码
  全绿（主控承载——selfiter-k1k2-reasoninglevel 欠账范围实证波及全部绑定岗）。
