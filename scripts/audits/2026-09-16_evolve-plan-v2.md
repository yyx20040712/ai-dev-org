# 外部评审清偿战役计划 v2（evolve 批，2026-09-16）

> v1→v2：吸纳门一源A对抗审（B=1/W=9/N=8，VERDICT=FAIL）全部 findings。
> 吸纳明细见 §7。源B（k2/zipoo）首派静默无输出（5min/0 工具调用）——按
> runbook 同包重跑纪律改送 v2 包，结果与失败事实均如实入账。

## 0. 立案五问

1. **为何立项**：技能经受外部全面评审（双异源探查+人工复核+门一双源对抗审），
   确认 6 项代码级缺陷（含 1 项代码-声明直接矛盾）+ 文档计数/清单腐化（形态
   普查后远超点列）+ 若干登记纯度问题，多项未在残留册登记。按自身宪法
   （ORG 系+「静默消失=违规」）须清偿。
2. **目标**：修复全部已确认缺陷；未修项全部登记残留册（在册行补注、新事实
   才建行）；走完整组织流程。
3. **DoD**：regression 全绿（含新增 R10，R1 仍 SKIP 配给保护）+ 门禁三扫零命中
   + health-scan RED=0（WARN 不劣于基线 2）+ 新增自检向量全过 + 分笔 commit +
   RESIDUALS/CHANGELOG/账本 v2 闭环 + 行为变化面全量申报（P-6）。
4. **风险**：①check-anchors 扩面暴露未知断锚（≤5 处随批修，超限回炉）；
   ②Node 25 宿主（mock 路径 v1.6 全绿先例，本战役零外部派发）；
   ③传输层重写回归（结构断言+mock 往返双验，>300s 首字节面不可回归复现，
   已知界限如实登记）。
5. **验收方式**：门二实证岗独立重跑全部门禁+新自检，裁决岗复算关键数字。

## 1. 基线数字（2026-09-16 立案时点，git @ fe19260，工作区干净）

- regression：7/7 过（R1 SKIP）；check-hardcode：命中 0（白名单豁免 33）；
  check-anchors：WARN×0/FAIL×0；health-scan：RED×0/WARN×2（存量已知）；
  cfg_hash=`a26f710a540d`；node v25.2.1。

## 2. 证据勘误（源A亲验，v1 摘录据此修正）

- M1 方向勘误：--date 坏值拼出 `fooT00:00:00` 串，一切真实 ts 均小于它→
  **静默空窗=假绿**（非"静默全量"，比全量更危险）；修复方案不变。
- H2 口径勘误：R1 子进程被 `--source` 钉成单源，合法最坏=4 attempt×20min+
  35s 退避≈81min（与链长无关）。
- 行号勘误：SKILL.md"三类告警"在 :124（非 :123）。

## 3. 批次映射（v2 修订后）

| 批 | 类型 | 内容（增量=【v2】标） |
|---|---|---|
| b1 | 实现 | glm-look.mjs 传输层对齐：fetch→node:http(s) 直连（镜像 ds-call-v2 v2.2.1 模式）；AbortSignal 唯一超时源（req 侧禁再设 setTimeout）；res.on('error') 补挂。【v2】保持 process.exitCode 自然退出语义（HOST-node25 规避方向，禁镜像 process.exit 急退）；SCRUB_RE/scrub 字面量不动（R9 对账钉）；纯函数（URL 拆解）export 供回归；regression 增 R10=结构断言（无 `await fetch(` 调用+node:http 引用）+本地 mock HTTP 往返（双通道）+纯函数向量；残留登记「>300s 首字节面不可回归复现（undici 消除=结构断言）」「传输切换后 Node25 退出面不可实证（零外部派发）」 |
| b2 | 实现 | ds-call-v2.mjs 退出码分类：类型化错误（Error.exitCode 属性）替换消息正则；【v2】DoD=**穷尽 throw 点清单化**（readJson×registry/宿主 config、账本 append、roles/源校验等，实现者实读穷举；输出写失败 exit 4 路径保持）；export 纯函数 classifyExitCode(e)（判据源=06 §5.8 总表）；R10 向量：配置类→3、用法类→1、未知→1；删正则兜底，未知=exit 1（保守） |
| b3 | 实现 | log-triage.mjs 时间窗：--date 严格校验（^\\d{4}-\\d{2}-\\d{2}$，非法=exit 1 用法错）；窗口 epoch 化与 --hours 同路径。【v2】文件选择（zcode-<本地日期>.jsonl）与行过滤（本地零点→epoch ms）日界同口径；自检向量含 TZ=Asia/Shanghai 跨日界 fixture |
| b4 | 实现 | provider null 守卫：org-config validateProviders 近邻提示+check-hardcode deriveHostModelTerms。【v2】同族面普查（log-triage buildAliasMap、health-scan 等一切 providers 消费点），null-provider fixture 实扫一遍 |
| b5 | 实现 | regression 超时看护：R2b/R5/R8 spawnSync 加 timeout+killSignal【v2：killAfter 非法选项已弃】（秒级路径实测耗时×裕量，依据写实现报告）；R1 timeout=单源合法最坏推导（4×20min+35s≈81min）+裕量；【v2】**派生值>护栏值时取派生值并申报挂起风险，禁裁剪到派生值以下**；regression.mjs:2 头注"R1~R6"顺手指针化（02 §5 ≤5 行 Minor 条款）；残留登记「R1 超时改动零运行时实证（R1 SKIP 期）——替代验证=派生复算+门一 diff 审」 |
| b6 | 实现 | ds-call-v2 sys_prompt_file 包含性校验。【v2】立案更正：文件路径唯一来源=仓内 registry.json（org-config roles 仅消费 .source，项目覆盖件无文件通道）——本项定性=**纵深防御**（防未来通道扩展），非在途漏洞；实现=path.relative(SKILL_ROOT,abs) 判 `..` 前缀（防前缀假过）；export 纯函数+R10 向量；**禁触碰 scripts/roles/**（向量走注入，不构造越界 registry） |
| b7 | 实现 | check-anchors 扩条目型引用（NN·XN）+支持 10+ 号文档。【v2】实施前置=全库普查 `·XN` 形态引用面（含"06·v1.1"版本串、K3 编号短语类免误伤确认）再定解析登记表；条目登记表仅从 01/04 正文解析（P-3 不变）；WARN 级不变；自检向量：正例 01·E2/04·SY-1 命中、负例 02·C2→WARN、免误伤例（版本串/编号短语）；--self-test 强化（在册 check-anchors-calibration 盲点部分收窄：解析逻辑拷打） |
| b8 | 文档 | 计数/清单腐化清偿——【v2】从点列升级为**形态普查**：全库扫「六段」「三类告警」族（.md 全量+8 个白名单 .mjs 头注），逐命中两分类处置：①完整清单断言→改「七段（六段+第 7 项可观察性，单源 02 §4）」或指针化；②段名引用（如"六段之「基线数字」段"）→保留。**单源根治**：02 §4 首句改「固定七段（1-6 段惯称『六段简报』），缺一段=任务书不合格」；SKILL.md:53 括注枚举→指针化（分类单源 02 §10）；SKILL.md:124"三类告警"去数字；06 §5 R 清单指针化；01:166 补遣→补遗；04 头注计数指针化（golden 单源）。【v2】skill-gc/ds-call-v2/org-config/check-hardcode 四件头注退出码复写→指针化 06 §5.8（非数字补丁；v1.6 声称已清偿未闭环的实证，CHANGELOG 注记） |
| b9 | 登记 | RESIDUALS/CHANGELOG/账本闭环。【v2】登记纪律=在册行补注不重建（02-§8-model-terms 补承接批次注记；M6 新行互指 A-dsN-1 与 regression 并发注释）；M1 按 §2 勘误后事实登记（静默空窗）；新行仅限不在册事实；k2 源静默无输出失败如实登记（观测面新事实）；结构项四件（岗位三表收敛/术语速查/补丁式写作收敛/02 §8 指针化升批）建新行+承接批次；本批修复项各建 closed 行（来源=外部评审清偿战役） |

## 4. 白名单（三态，v2 无变化）

- **新建**：scripts/audits/2026-09-16_evolve-*.md
- **修改**：scripts/{glm-look,ds-call-v2,log-triage,org-config,check-hardcode,regression,check-anchors,skill-gc}.mjs；SKILL.md；references/{01,02,04,06}-*.md；RESIDUALS.md；CHANGELOG.md；.zcode/org-ledger.jsonl（仅追加）
- **禁改**：references/{03,05,07,08,09}-*.md；scripts/roles/**（含 .golden）；org-config.default.json；scripts/.golden/**；templates/**；scripts/model-routing-log.jsonl；历史审计档；.git*

## 5. 预裁决（v2 修订）

- P-1：同 v1（删正则兜底；类型化错误穷尽改造；未知=exit 1）。【v2】判据源=06 §5.8。
- **P-2（v2 重写）**：R1 timeout=单源合法最坏推导 4×20min+35s≈81min+裕量；
  派生值>护栏值（120min）时**取派生值**并申报挂起风险——禁裁剪到派生值以下
  （裁剪制造误杀，与防误杀优先矛盾）。
- P-3：同 v1+前置全库普查（见 b7）。
- P-4：同 v1（删"02·C2"括注引用）。
- P-5：计数修复一律「去数字+指针化」；**02 §4/06 §5.8 作为单源允许落数字**（单源落数、他处持针）。
- **P-6（v2 扩充）**：行为变化申报面=①log-triage --date 非法值（静默空窗→
  exit 1）；②ds-call-v2 英文 locale 配置类未捕获异常（exit 1→3，修复误分类）；
  ③registry 文件路径越界新增 exit 3 拒绝路径（纵深防御，当前不可达）。三项
  全入 CHANGELOG v1.7+06 §5.8 迁移注记。其余外部契约零变化。
- 【v2】**P-7**：实现者简报一律**七段**（六段+第 7 项运行时可观察性，02 §4）；
  新行为可观察性落点=退出码/stderr 显式消息/回归向量（R10）三者之一以上。

## assumptions:（v2 修订，对抗位逐条拷问）

1. 【v2 修订】六项代码修复对外部契约的变化面=P-6 申报三项（均为缺陷修复或
   纵深防御新增拒绝路径），无其他可观测行为差。
2. （未变）Node 25.2.1 mock 路径可复现 v1.6 全绿；本战役零真实外部派发。
   【v2】R1/b1 的两处「不可运行时实证面」如实登记残留，不以替代验证冒充实证。
3. （未变）check-anchors 扩面后现存断锚仅 01·E2→"02·C2" 一处（源A亲读面
   内坐实四处条目型引用、断锚一处；03/05/07/08/09 未读面由 b7 前置普查兜底）；
   ≤5 处随批修，超限登记回炉。
4. （未变）结构手术本战役不实施、只登记+立承接批次。【v2】02 §8 指针化=
   在册行补注，不重建。
5. （未变）行号以实现时实读为准（源A勘误三处已吸收，余量同口径）。
6. （未变）授权范围=修复+登记+完整流程含分笔 commit（不 push）；不含结构
   重构与真实外部派发。【v2】b8 四件头注指针化与 skill-gc 项来源=源A亲验
   新发现（基线实扫），非计划夹带。

## 6. 流程与烤验映射

计划（本件 v2）=文档批→轻量双审（源A 审 v1 已 FAIL 全吸纳；源B 重审 v2）
→裁决岗终裁（核对 v1→v2 吸纳忠实性+独立复算）→b1-b8 分批实现
（ops-executor，**七段简报**+TDD 红→绿→变异红证+真退出码落盘+分笔 commit）
→全量 diff 门一隔离审（ops-gate1-k1，自包含审包）→门二实证（ops-probe
重跑矩阵含 R10）→终审（ops-adjudicator）→收口（RED=0+账本+残留册+
CHANGELOG+呈报包）。实现者=GLM 系，门一=kimi 系——异构成立；源B 若再失败，
单源+裁决岗独立复算承担第二对抗位，偏差如实登记（环境限制不冒充双源）。

## 7. v1→v2 吸收明细（源A findings 处置台账）

B1→b8 形态普查+02 §4 根治+P-7 七段简报｜W1→P-2 重写+§2 勘误｜W2→b5 残留
登记｜W3→b1 DoD 三钉（exitCode 语义/R9 字面量/禁 req.setTimeout）+R10+
双残留登记｜W4→b2 穷尽清单+classifyExitCode export+向量｜W5→P-6 扩充+06
§5.8 迁移注记｜W6→立案更正+纯函数注入向量+禁触 roles｜W7→b7 前置普查+
三型向量+self-test 强化｜W8→b8 四件头注指针化+CHANGELOG 注记｜W9→b9 登记
纪律四条｜N1→b5 弃 killAfter｜N2→b1 三钉（同 W3）｜N3→b6 path.relative
口径｜N4→§2 勘误｜N5→assumption 6 补来源注记｜N6→b4 同族普查+fixture 实扫
｜N7→b5 顺手指针化｜N8→b3 日界同口径+TZ 向量。
