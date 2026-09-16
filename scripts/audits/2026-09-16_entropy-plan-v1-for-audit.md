# 审计任务书：ai-dev-org 维护熵清偿计划 v1.0（送双源对抗审核）

> 任务性质：对抗式审核（只挑错不改写）。送审方=ai-dev-org 技能维护主控。
> 审核者零仓库接触：材料自包含，全部证据已内联；不得臆测包外事实。
> 输出契约：[B|W|N] 分级逐条 + 定位（计划条目/假设编号）+ 建议修正案 + 末尾总评与放行意见。

## 0. 被审对象与判据来源

`ai-dev-org` 是"AI 开发公司组织操作系统"技能：岗位编制（8 岗+用户裁决位）、
模型路由、部门墙协议、成本纪律四支柱，配套 10 个脚本、9 份 references、
角色卡与模板，服务单人开发者+AI 组织。第一性原理：执行者必然犯错，组织
设计目标是让错误在合入前现形、让每个决定可追溯。

2026-09-16 主控对其做全面评审（脚本代码审+文档全量锚点核对+运行实测），
结论：设计水平高，但六天高速迭代后出现"维护熵"——体系正在违反自身核心
纪律。本计划清偿评审发现。与 2026-09-14 已修批次（账本 mocked/truncated
字段、check-hardcode 门禁、health-scan 等，均已落地）无重叠，本计划处理
的是其后残留面。

判据来源（技能自身第一性纪律，本次审核的标尺）：
- **A2** 规则必须机检可达（写进 .md 没有检查的规则是建议）
- **A3** 单一真相源禁双源（两份等价声明靠注释对齐必然失守）
- **A4** 占位与死代码零容忍
- **D1** 机器事实终裁，亲验不信任自报；**D2** 决策原文入账
- **08 §3** 历史件禁改写只许追加；**06 §0** 供应商事实零硬编码（org-config 单源）
- **ORG-12** 审包纪律：审包体积=派发时效主变量；简报输出段设产出预算硬约束
- 烤验表：纯配置变更批→auditor-readonly 复核；已审面修改→该面随批重过

基线声明：本计划针对**工作树@2026-09-16**（git HEAD=d1d7def 落后一个批次：
v1.5 子代理绑定批已成型未提交，见 P2-8）。引用行号均以工作树为准。

评审方法自述：脚本面=独立代码审读+主控抽查复核双轮；文档面=全量阅读+
锚点逐条核对。派发前亲验已修正一处评审误判（_archive 由"断链"改定性为
"路径歧义"，见 P1-A）——送审方自身可错，故本包走双源对抗审。

## 1. 送审计划 v1.0

**总目标**：清偿维护熵，恢复 A3/锚点契约/元治理三面自洽；不扩编制、不改
v1.0 冻结核心、历史件只追加。

**硬约束（不可违反）**：
1. 本批=纯计划批：只出计划/裁决/审档，不改正文与代码；实施分批待用户裁决后执行。
2. 活文档（SKILL.md/references/脚本）可改；v1.0 冻结核心原文不动，一律补遗。
3. 不新增岗位、不扩编制。
4. 账本与 RESIDUALS 既有行不改写，只追加。
5. 负面清单留用户裁决（本次只呈方案）：①org-config 增 vision 分区（配置
   变更批）；②默认链末端 payg 源取舍；③07「不入 org-config」先例条款存废。
6. 不碰用户 WIP：技能仓现有 22 个未提交文件属 v1.5 批；本批新增文件只入
   scripts/audits/（未跟踪目录），无冲突。

### P0-A 账本行 schema 双源分叉（会繁殖的缺陷——最高优先）

证据：
- references/02 §9：行 schema v2（2026-09-14）=`{ts,schema_version,runId,
  project,event,role,tier,source,cfg_hash,usage?,mocked?,truncated?,outcome}`
- SKILL.md 派发节：仍是 v1 字段列举「ts/project/event/role/tier/source/
  cfg_hash/usage?/outcome」——缺 schema_version/runId/mocked/truncated 四字段。
- templates/org-seg.snippet.md：项目宪法的 schema 指针指向 SKILL.md 该段——
  init-defenses 每生成一个新项目，过期 schema 就复制进一份项目宪法。
- references/07 §4 另有 tier 记法引用，口径未对齐 v2。

违例定性：A3「两份等价声明靠注释对齐必然失守」的现行违例，且经模板向外繁殖。

拟修法：
- (a) SKILL.md 派发节指针化：「行 schema 单源=references/02 §9」，删内联清单。
- (b) org-seg.snippet.md 同步指 02 §9。
- (c) 防再犯机检：regression 增轻量断言——SKILL.md 与 templates/*.md 中
  不得出现「ts/project/event」形态的字段枚举串。

已知副作用：SKILL.md 常载层失去即读 schema，读账本须跳转 02 §9——B5
（上下文预算）与 A3（单源）的取舍，请审者裁。

### P0-B glm-look.mjs 收编（纪律洼地）

证据（六项，均亲验源码；glm-look=设计岗外呼看图脚本，与派发器写同一本流水）：
1. fetch 无超时（源码 241 行，无 signal）——连接挂起无限阻塞；派发器
   ds-call-v2 v2.2.1 已为同款问题弃 fetch 改 node:http(s)+AbortSignal。
2. 4xx 与网络瞬断同退避：400/401/404 也按瞬断盲重试 3 次；派发器有
   NO_RETRY（4xx 立断换源）语义。
3. 零脱敏：错误响应体前 300 字符与错误串直写日志，与其头注「key 零泄露」
   声明无代码级保障；派发器的 scrub 已全覆盖所有输出面。
4. 硬编码绕开 org-config：模型名 GLM-5.3-Flash/deepseek-flash 与端点子串
   匹配（"/anthropic"、"deepseek"）写死在源码——与「供应商事实零硬编码」
   正面冲突。
5. 三份文档互相矛盾：SKILL.md 称「通道/模型/端点=org-config」；07 称
   「不入 org-config——会话内岗不动注册表先例」；脚本头注自称「不入
   org-config 先例」。三方各执一词，SKILL.md 是错的那方。
6. SCRIPT_DIR 用 URL pathname 手工拼接不做 percent-decode（路径含空格/
   中文必坏，同目录其他脚本都用 fileURLToPath）；死代码 if(resp===null)
   continue（内层 catch 耗尽必 return，该分支不可达）——违 A4。

拟修法：
- (a) 传输层对齐：fetch+AbortSignal.timeout 或 node:http(s) 直连；单次调用
  上限 20 分钟对齐派发器纪律。
- (b) 脱敏复用二选一（请裁）：①提取共享模块 scripts/lib/scrub.mjs（彻底
  A3，但破坏派发器「自包含」可移植性）；②受控复制+regression golden 对账
  （保自包含，留受控双源+对账机检）。
- (c) NO_RETRY 语义对齐：4xx 立断不重试。
- (d) 配置收编：org-config 增独立 vision_channels 分区（模型/端点偏好序
  入册，**不动 roles 注册表**——既兑现「供应商事实住 org-config」又不破
  「会话内岗不动注册表」先例）。属纯配置变更批→烤验表要求 auditor-readonly
  复核+负面清单留用户。
- (e) SCRIPT_DIR 改 fileURLToPath；死代码清除。
- (f) 三份文档统一说辞（以 (d) 落地形态为准重写）。

已知张力：若 07 先例条款不废，(d) 的「不动 roles」设计是唯一兼容解；若
审者认为视觉外呼位本就不属「会话内岗」、先例应废——属负面清单交用户。

### P1-A 锚点与计数腐化清扫 + 体检机检化

证据：
- **06 §8.6 断锚**：references/02 第 285 行引「06 §8.6 三段通道要求异构」
  ——06 的 §8 是修订史，三段通道真源=02 §8.6 与 06 §1。health-scan 第 ⑤
  项同源判据的条文出处指向空。
- **08 §0 断锚且惯例失载**：SKILL.md 烤验表引「08 §0 惯例（改了就要再
  审）」——08 无 §0，且「就要再审/随批重过」字样在 08/02 全文 grep 零
  命中：被引惯例本身无处登记。
- **_archive 路径歧义**（已修正定性）：SKILL.md/06/08 三处引
  `_archive/loop-engineering-archive-2026-09/`——目标实际存在于
  `~/.zcode/skills/_archive/`（技能根的上一级），按技能根相对解析必失败。
  修法=三处改绝对路径形态消歧，非删引用。
- **外部批档歧义指针**：07 补遗与 RESIDUALS 引「05 §一/§七/§十」但
  references/05 只有 §1~§6——实指外部批档 05-ruling.md 的章节，与内部
  引用写法无法区分，读者必误 resolve。
- **计数过期双处**：01 头部「四组 16 条」实测五组 22 条（A4/B5/C4/D6/E3）；
  SKILL.md 加载地图「01 原理 16+3 条」「04 教训库 25+4 条」实测 22 条/
  41 条（WP14+SY11+MG3+ORG13）。计数本身=正文数字与实际条数的双源。
- **缺限定符**：SKILL.md 验证状态引「scripts/audits/2026-09-10_org-skill-*」
  无项目限定——实际在 Synapse 项目仓（RESIDUALS 多行带全路径佐证）。

拟修法：
- (a) 断锚改指真源；「就要再审」惯例在 08 追加登记（活文档补遗）后锚点
  改指新节；外部批档引用统一消歧写法（如「批档 05-ruling §一」）。
- (b) 计数根治=去数字化指针化（「条数以 01/04 实际编号为准」）。
- (c) 新增 check-anchors.mjs（08 §4「文档腐化体检」的机检化——体检条款
  自己也是"写进 .md 而没有检查的规则"）：①「NN §M」引用的目标章节存在
  性；②被指文件存在性（含 _archive 绝对路径）；③01/04 条目计数对账。
- (d) runbook 真源在技能外（E:/zcode_md/fix/subagent-plan-2026-09-16/09 号
  件）：RESIDUALS 追加登记行，迁移另批，本次不迁。

已知副作用：check-anchors 对中文数字节号/表格内引用形态的误伤面未知——
先 WARN 全量跑一轮校准（A2 校准纪律），再升阻断。

### P1-B log-triage --health 可信度修复（含今日活证据）

**活证据（2026-09-16 晚亲验运行）**：--health 输出「门一派发推荐：k2｜依据：
窗口内检出额度类失效 ×4——换源有效」——该 ×4 全部是回归演练注入的 mock
429（exhaust 明细四行均带「（mock）」标记，流水行带 mocked:true），真实
失效只有凌晨窗口的 504（窗口类按换源状态机**不应**换源）。mock 事件未过
滤，推荐结论=假信号；后续派发若循此推荐将系统性避开主源。

代码级证据：
- `_dup` 去重标志全文件从未赋值（空设计）——同一失败若同时产生两类事件
  则计数翻倍，直接污染换源推荐。
- kimi-main/kimi-backup 别名硬编码，与同文件头注「供应商别名住 org-config
  禁硬编码」自相矛盾；org-config 换别名后推荐静默退化。
- 自检假 PASS：7 个 classifyError 断言只 console.log，退出码只绑定最后一个
  fixture——其余全挂也 exit 0。
- --hours 模式 readdirSync 无 existsSync 守卫（同文件 readJsonl 有守卫）。
- harvestAgents(null) 同进程三重全量遍历（纯浪费 IO）。

拟修法：mock 过滤（账本行 mocked 字段，v2 schema 已含）→ _dup 落实或删除
（A4：空设计即删，去重按 runId+event 复合键重做）→ 别名从 org-config
source_chain 派生 → 自检断言聚合计入退出码（与 P2-1 四脚本同款一起收口）
→ 目录守卫+遍历收敛。

关联对齐：regression R1 的 spawn timeout 600_000ms < 派发器 20 分钟调用
上限——合法长推理被回归先杀误报 FAIL，改 1_200_000+余量；check-hardcode
排除「2026-」前缀审计档的年份硬编码 2027 年即失效→org-config 化或滚动窗口。

### P1-C 元治理对账（含角色卡缺口）

证据：
- SKILL.md 修订记停在 v1.4，CHANGELOG 顶部已是 2026-09-16 v1.5，且
  SKILL.md 正文已含 v1.5 内容——违反自设「修订记只保留最近一条摘要」规则。
- 08 §6 声称「Synapse md 扩面另立批次（登记残留，见 RESIDUALS）」——
  RESIDUALS 无任何对应行：**声称已登记实未登记**，比静默消失更隐蔽。
- 08 §1 残留注记「glm-look-endpoints 待落定」未随 2026-09-15 闭环撤下
  （RESIDUALS 该行已 closed）——正文与残留册状态相反。
- RESIDUALS W5-A-W4 行出现三态之外第四态「已修订」。
- gate1-reviewer 的 DoD 要求 [B|W|N] 分级输出，但分级定义（B=阻断实施/
  W=应修/N=提示）只写在 auditor-readonly 的 DoD——门一执行者无从知义，
  分级口径不可比。
- 门一无输出预算（drafter ≤6000 字、auditor ≤2500 字都有）——ORG-12 立
  「产出预算硬约束」当日，门一自己缺位。

拟修法：修订记按规则只留 v1.5 一条（v1.4 明细已在 CHANGELOG）→ RESIDUALS
追加补登 Synapse md 扩面行；W5-A-W4 历史行不动，另追加勘误行维护三态纯度
（不改写旧行）→ 08 §1 注记随实况更新（活文档）→ [B|W|N] 定义单源化（定义
住一处，另一处改指针）→ 门一 DoD 增「全文 ≤4000 字」产出预算（本审包
输出要求已先行实践）。

注意：改角色卡/DoD=已审面修改→该面随批重过（本批双源审即满足；实施批
落地后 golden 副本同步更新并再过门一）。

### P2 工程卫生（低风险，顺批次收尾）

- **P2-1 退出码契约单源**：06 §5 增「退出码总表」，各脚本头注改指针；修复
  四脚本「文档说自检失败=3 实际 exit 1」（org-config/check-hardcode/
  health-scan/log-triage）+ glm-look 与 skill-gc 对退出码 2 的语义冲突
  （与派发器 2=exhaust 冲突）。
- **P2-2 check-hardcode 静默吞错**：白名单/宿主配置 JSON 损坏时零警告降级
  （strict 下假 RED 阻断、非 strict 假绿放行）——改 stderr WARN+独立退出码
  （fallback 须显式留痕）。
- **P2-3 CLI helper 七份复制收敛**：flag() 等收敛进 org-config.mjs 导出；
  ds-call-v2 若坚持自包含可声明豁免+注释指向（请裁）。
- **P2-4 派发器补漏**：postJson 补 res.on('error')（响应中断流防挂起）；
  finish 词表双份兜底硬编码→读 org-config finish_vocab（兑现「脚本零硬
  编码」自称）。
- **P2-5 BOM 对齐**：glm-look/check-hardcode 读宿主 config 补剥 BOM（对齐
  org-config.readJson 的既有纪律）。
- **P2-6 org-config.default.json 张力**：本机 uuid_prefix 写进默认件的可移
  植性；默认链末端=payg 按量源（走链尾静默烧钱）——负面清单呈用户。
- **P2-7 不重开项**：SKILL.md description 触发词长度（在册裁决 won't-fix，
  召回优先）——列此防审者重提。
- **P2-8 前置卫生**：v1.5 批（22 个未提交文件）应先分笔提交收口，再实施
  本计划，避免两批改动交叉。

## 2. 假设清单（烤验机关——请逐条拷问）

1. **假设**：_archive 引用目标=`~/.zcode/skills/_archive/loop-engineering-
   archive-2026-09/`（本轮亲验存在），修法定性=路径消歧而非断链删除。
   风险：若规范本意是归档应随技能目录携带（分发场景），写法取决于分发
   形态——当前无分发机制，倾向 skills 根绝对路径。
2. **假设**：2026-09-10_* 审档均在 Synapse 项目仓（RESIDUALS 多行带限定符
   佐证）；本轮未读 Synapse 仓亲验。若部分档在别处，改写须逐档核对。
3. **假设**：02 §9 的 schema v2 字段清单本身无笔误——本轮未逐字段与
   ds-call-v2 落账代码对读（若审者认为必要，可列为实施批首步：schema 文档
   vs 落账代码字段对账）。
4. **假设**：glm-look 传输层改造不影响三段流定式产出质量（max_tokens≥8000
   自动倍升逻辑不动）。
5. **假设**：脱敏复用倾向方案②（受控复制+golden 对账，保派发器自包含），
   但承认方案①（共享模块）更合 A3 字面。请裁。
6. **假设**：--health 修 mock 过滤读账本行 mocked 字段即可，不须回溯流水
   runId 关联。
7. **假设**：本轮「同 role 双源」可比（gate1-reviewer@kimi-main +
   gate1-reviewer@deepseek）；deepseek（payg 按量）单次大审包成本可承受。
8. **假设**：退出码统一不破坏既有调用方——本计划**未做**全量调用面 grep
   （regression R 断言/CI 模板/子代理 runbook 可能硬编码旧退出码语义），
   列为实施批首步。此假设未验证即排期，本身请拷问。

## 3. 审核重点面（请优先拷打）

1. **批次划分与先后**：P0-A（纯文档）与 P0-B（代码+配置）同批还是分批？
   P1-C 元治理对账是否应前置（先对账再动正文）？有无比 P0-A 更急的漏项？
2. **vision_channels 分区设计**（不动 roles）是真解还是制造第三种例外？
   07 先例条款存废是否应直接整体留用户？
3. **check-anchors.mjs 误伤面**：中文数字节号/表内引用/「批档 05-ruling」
   这类外部引用的边界；WARN→RED 升级路径是否现实。
4. **P1-B 修法有无更简根因**：--health 是否应直接读流水 mocked 而非账本？
   mock 过滤与 504 窗口类判定的交互（过滤后今日推荐应变为「不换源」——
   修法应保证这一点）。
5. **P1-C 的 [B|W|N] 定义单源化位置**：住 gate1-reviewer.dod、registry、
   还是 02？改 DoD 触发「已审面重过」的执行成本是否值得？
6. **成本现实性**：新增 check-anchors+扩 regression 后，单人开发者日常
   摩擦增量是否可接受；哪些检查应按需跑而非常驻。

## 4. 输出要求

- [B|W|N] 分级（B=阻断实施/W=应修/N=提示），逐条：编号→定位（P0-A/
  假设 5/审核重点 3 等）→问题→依据→建议修正案（「应当如何」，不代拟全文）。
- 末尾：总评 + 明确放行意见（放行 / 有条件放行（列条件）/ 返工）。
- 产出预算：全文 ≤4000 字（ORG-12）——预算内宁可深挖少数条目，勿平铺罗列。
- 若发现送审材料本身内部矛盾，直接指出（这正是你的职责）。不确定的明确
  标「不确定」，禁臆测包外事实。
