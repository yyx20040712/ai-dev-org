# 外部评审清偿战役计划 v3（evolve 批，2026-09-16）

> v1→v2：吸纳源A（k1）B1/W1-9/N1-8（FAIL）。
> v2→v3：吸纳源B（k2）B1-3/W1-6/N1-9（FAIL）。吸收台账见 §8。
> 送裁决岗终裁（含 N2 改指/删除之争、同族异供应商注记、白名单两处扩权）。

## 0. 立案五问

1. **为何立项**：技能经受外部全面评审（双异源探查+人工复核+门一两源两轮
   对抗审），确认 6 项代码级缺陷+文档计数/清单/头注腐化（形态普查+规则化
   修复）+登记纯度问题。按自身宪法（ORG 系+「静默消失=违规」）须清偿。
2. **目标**：修复全部已确认缺陷；未修项登记（在册补注、新事实建行）；完整组织流程。
3. **DoD**：regression 全绿（含 R10，R1 仍 SKIP）+ 门禁三扫**零新增命中**
   （基线存量 WARN×2 不劣化）+ 新增自检向量全过 + 分笔 commit +
   RESIDUALS/CHANGELOG/账本 v2 闭环 + 行为变化面全量申报（P-6 四项）。
4. **风险**：①check-anchors 扩面暴露未知断锚（≤5 处随批修，超限回炉）；
   ②Node 25 宿主（mock 路径 v1.6 全绿先例，零外部派发）；③传输层重写
   （结构断言+mock 往返双验；>300s 首字节面/异端点语义面/Node25 退出面
   三项不可实证面如实登记）。
5. **验收方式**：门二实证岗独立重跑全部门禁+新自检；裁决岗复算关键数字。

## 1. 基线数字（git @ fe19260 干净）

regression 7/7（R1 SKIP）；hardcode 命中 0（豁免 33）；anchors WARN×0/FAIL×0；
health-scan RED×0/WARN×2（存量）；cfg=`a26f710a540d`；node v25.2.1。

## 2. 证据勘误（两源亲验合并）

- M1 方向：--date 坏值→**静默空窗=假绿**（非全量）。
- H2 口径：R1 钉单源，合法最坏=4×20min+35s≈81min。
- 行号："三类告警"在 SKILL.md:124。
- 【v3】regression spawnSync 共**五处**：R2b:86/R5:111/**R4:176**/R8:223/R1:253。
- 【v3】同族 ·XN 活实例：01·E2（SKILL:144）、01·B5（02:18）、04·SY-1
  （SKILL:141）、06·v1.1（02:204 版本串，免误伤）、02·C2（01:157 唯一断锚）。

## 3. 批次映射（v3 修订后终版）

| 批 | 类型 | 内容 |
|---|---|---|
| b1 | 实现 | glm-look 传输层：fetch→node:http(s) 直连（镜像 ds-call-v2 v2.2.1）；AbortSignal 唯一超时源（req 侧禁 setTimeout）；res.on('error')；process.exitCode 自然退出保持（禁急退）；SCRUB_RE/scrub 字面量不动（R9 钉）。【v3】加 **isMain guard**（org-config.mjs:124-126 范式）+export 纯函数（URL 拆解）；R10 归属本批（汇总定义）：①结构断言=**非注释行**无 `fetch(` 调用+node:http 引用（头注/注释行排除口径钉死）；②本地 mock HTTP 往返**双通道拟真**（glm=/v1/messages anthropic 形、ds=/chat/completions openai 形，分别返回两种响应骨架；子进程驱动+timeout 看护）；③纯函数向量。残留登记**三条**：>300s 首字节面不可回归复现/Node25 退出面不可实证/异端点传输语义面（glm 形 3xx/gzip 与 ds 已实证面不同面，mock 仅证本地拟真） |
| b2 | 实现 | ds-call-v2 退出码分类：类型化错误（exitCode 属性）替换消息正则；**穷尽 throw 点清单化**（实读穷举，输出写失败 exit 4 保持）；export classifyExitCode(e)（判据源=06 §5.8）；【v3】加 isMain guard（CLI 体顶格执行面隔离）；R10 向量：配置→3/用法→1/未知→1 |
| b3 | 实现 | log-triage --date：格式正则 **+语义校验**（Date 解析 NaN/Invalid=exit 1）；负向向量（2026-13-45、2026-02-30、foo）；窗口 epoch 化与 --hours 同路径。【v3】日界口径=**UTC**（与现状文件选择同口径，撤回"本地零点"）；UTC 日界向量（Asia/Shanghai 下本地 02:00 归前一 UTC 日窗口） |
| b4 | 实现 | provider null 守卫：org-config validateProviders 近邻+check-hardcode deriveHostModelTerms+log-triage buildAliasMap（白名单内全修）。【v3】check-hardcode 修后形态预裁=该 provider 记降级行继续扫（exit 5 语义，不崩溃）；普查面=白名单 8 脚本+health-scan 头注级扩权面，health-span providers 消费点若命中=**登记不修**（超扩权范围，下批承接）；null-provider fixture 实扫 |
| b5 | 实现 | regression 超时看护：**五处 spawnSync 全覆盖**（R2b:86/R5:111/**R4:176**/R8:223/R1:253）+R10 新增 spawn 全部带看护；timeout 依据=实测×裕量（**含 R1**，推导与裕量均入报告）；R1=单源推导 4×20min+35s≈81min+裕量，派生值>护栏 120min 时取派生值并申报（禁裁剪）。regression.mjs:2 头注 R 清单顺手指针化（依据=本批修改面内一致性收口，**非** 02 §5 回炉条款——依据错配已纠）。残留登记：R1 超时改动零运行时实证（替代验证=派生复算+门一 diff 审） |
| b6 | 实现 | sys_prompt_file 包含性校验（纵深防御定性维持）。【v3】落点=**两处**（ds-call-v2.mjs:105 + regression.mjs:48 loadRoleAssembled，两处须同步演进注释自承）；path.relative(SKILL_ROOT,abs) 判 `..` 前缀；export 纯函数+R10 向量（恰 `..`、`..\`、`../` 三例）；禁触 scripts/roles/** |
| b7 | 实现 | check-anchors 扩 NN·XN 条目型+文档号两位数支持（`0[1-9]` → `[0-9]{2}` 形态，条目号天然多位）。【v3】·XN 正则口径=大写组名+数字（小写 v1.1 版本串天然排除）；「」叙述跳过规则延续 ·XN 族；前置全库普查 ·XN 引用面；登记表仅从 01/04 正文解析；WARN 级不变；向量：正例 01·E2/04·SY-1、负例 02·C2→WARN、免误伤例（06·v1.1/K3 编号短语）；--self-test 强化（解析逻辑拷打） |
| b8 | 文档 | 形态普查（**规则式非枚举式**）：①「六段/三类告警」族全库扫（**可改面**：白名单+两处扩权件；**禁改面**只登记命中数不修改）；逐命中三分类：完整清单断言→改「七段（单源 02 §4）」或指针化／段名引用→保留／【v3】混合短语（如"12 步+任务书六段"）→只改腐化半边。单源根治：02 §4 首句「固定七段（1-6 段惯称『六段简报』），缺一段=不合格」。②【v3】**头注退出码复写规则式清偿**：一切脚本头注复写退出码语义者指针化 06 §5.8——实锤七件=skill-gc:20（与总表直接冲突）/log-triage:18/regression:13-15/health-scan:15（带指针仍复写）/ds-call-v2:14-16/org-config:7/check-hardcode:21+06:91（单源文件 §5 内联复写→改指本件 §5.8）。③SKILL.md:53 括注指针化；:124 去数字；06 §5 R 清单指针化；01:166 补遣→补遗；04 头注计数指针化 |
| b9 | 登记 | RESIDUALS/CHANGELOG/账本闭环。【v3 落位=门一 diff 审之前】（登记内容入审面；门二实证后仅追加 ruling/收口行，呈终审）。登记纪律：在册补注不重建（02-§8-model-terms 补承接批次）；M6=外部评审新发现**新建 open 行**（runId 4 字符碰撞+appendFileSync 交错+switch 单值覆盖）互指 A-dsN-1 与 regression:116 注释；M1 按勘误后事实登记；k2 首派静默失败如实登记；**同族异供应商注记**（源A/源B MODEL-SELF 均=k3，不同 provider uuid——轻量双审合规但按「同源记欠账」文化记欠账行）；结构项四件新建 open 行+承接批次；本批修复项=新建 closed 行**单行制**（新开即闭，四件头注指针化并入 b8 描述不单开）；P-4 处置以终裁为准 |

## 4. 白名单（三态，v3 两处扩权）

- **新建**：scripts/audits/2026-09-16_evolve-*.md
- **修改**：scripts/{glm-look,ds-call-v2,log-triage,org-config,check-hardcode,regression,check-anchors,skill-gc}.mjs；【v3 扩权①】health-scan.mjs（**仅头注指针化一行级**）；SKILL.md；references/{01,02,04,06}-*.md；【v3 扩权②】templates/org-seg.snippet.md（**仅 :11"三类告警"计数短语指针化，R7 钉的"单源=02 §9"指针行不动**）；RESIDUALS.md；CHANGELOG.md；.zcode/org-ledger.jsonl（仅追加）
- **禁改**：references/{03,05,07,08,09}-*.md；scripts/roles/**（含 .golden）；org-config.default.json；scripts/.golden/**；templates/**（除扩权②单行）；model-routing-log.jsonl；历史审计档（scripts/audits/** 既有件）；.git*

## 5. 预裁决（v3 修订）

- P-1：删正则兜底；类型化穷尽；未知=exit 1；判据源=06 §5.8。
- P-2：R1 timeout=单源推导 4×20min+35s≈81min+裕量（裕量推导入报告）；派生值>护栏 120min 时取派生值并申报挂起风险，禁裁剪到派生值以下。
- P-3：条目登记表从 01/04 正文解析+前置全库普查；正则口径见 b7。
- **P-4（v3 改默认，待终裁确认）**：「02·C2」断锚**改指 01·C2**（k2 依据：01:96"SY 三屋试点门一 0B/3W/13N（三 W 全真缺陷…）"与 E2 行锚点同事件实录，"02·C2"系"01·C2"笔误——改指保锚点追溯链；v1"删除"方案弃）。终裁定夺。
- P-5：计数修复去数字+指针化；02 §4/06 §5.8 单源允许落数字。
- **P-6（v3 四项）**：行为变化申报=①log-triage --date 非法值（静默空窗→exit 1）；②ds-call-v2 英文 locale 配置类未捕获异常 exit 1→3（修误分类）；③registry 文件路径越界新增 exit 3 拒绝路径（纵深防御，当前不可达）；【v3】④**M3 族**：null provider 从 TypeError 崩溃（exit 1+栈）改为校验错误（org-config/ds-call-v2 路径 exit 3+明确消息；check-hardcode 路径=降级行 exit 5 语义继续扫）。全入 CHANGELOG v1.7+06 §5.8 迁移注记。其余外部契约零变化。
- **P-7（v3 单源化）**：实现者简报一律七段；第 7 段落点词表**单源=02 §4**（日志字段/指标/健康检查/断言式告警）——本战役实例化映射：新退出码/stderr 消息=健康检查族；R10 向量=合入前门禁（DoD 验收面，**不冒充**第 7 项）；文档/登记批（b8/b9）第 7 段统一答「无新运行时行为——可观察性落点=文档面体检机检（check-anchors/R7/门禁三扫）」。
- 【v3】P-8：普查与修复一律**规则式**（"一切……者"），禁枚举式清单（枚举=腐化温床，两源一致病理）；禁改面命中=登记不修改。

## 6. assumptions:（v3 修订，对抗位逐条拷问）

1. 六项代码修复契约变化面=P-6 **四项**，无其他可观测行为差。
2. Node 25.2.1 mock 路径可复现 v1.6 全绿；零真实外部派发；**三处**不可运行时
   实证面（R1 超时/b1 三条残留）如实登记，不以替代验证冒充实证。
3. check-anchors 扩面后现存断锚仅 01·E2→"02·C2"（两源亲读面坐实；03/05/
   07/08/09 未读面由 b7 前置普查兜底）；≤5 处随批修，超限回炉。
4. 结构手术本战役不实施只登记；02 §8=在册行补注不重建。
5. 行号以实现时实读为准（两源勘误已吸收）。
6. 授权范围=修复+登记+完整流程含分笔 commit（不 push）；不含结构重构与真实
   外部派发；b8 头注件=两源亲验新发现。
7. 【v3 新增】zcode cli 日志文件名日界=UTC（现状 log-triage:197 取 UTC 日期
   为据）；行过滤窗口=UTC 日界对齐。若实现者实读发现文件名生成逻辑非 UTC，
   按实证口径修正并在报告申报（假设明示，请拷问）。

## 7. 流程与烤验映射

计划 v3=文档批→轻量双审两轮（源A 审 v1 FAIL 全吸纳；源B 审 v2 FAIL 全吸纳；
**源A/源B 同族异供应商（均 k3）已注记+欠账登记**）→裁决岗终裁（核对两轮
吸纳忠实性+独立复算+P-4 定夺）→b1-b8 分批实现（ops-executor，七段简报+TDD
红→绿→变异红证+真退出码落盘+分笔 commit）→**b9 登记批落地**→全量 diff
门一隔离审（ops-gate1-k1，自包含审包含登记面）→门二实证（ops-probe 重跑
矩阵含 R10）→终审（ops-adjudicator）→收口（RED=0+账本 ruling 行+呈报包）。
实现者=GLM 系，门一=kimi 系——异构成立。

## 8. 吸收台账

v1→v2（源A 18 条）：B1→形态普查+02 §4 根治+P-7｜W1→P-2 重写｜W2→b5 残留｜
W3→b1 三钉+R10+双残留｜W4→b2 穷尽+export｜W5→P-6 扩+迁移注记｜W6→立案更正｜
W7→b7 前置普查+向量｜W8→头注指针化｜W9→登记纪律｜N1→弃 killAfter｜N2→三钉｜
N3→path.relative｜N4→勘误｜N5→来源注记｜N6→普查+fixture｜N7→顺手指针化｜
N8→日界同口径。

v2→v3（源B 18 条）：B1→b5 五处全覆盖+R10 看护｜B2→b8 规则式七件实锤+06:91｜
B3→普查范围=可改面全扫/禁改面登记+两处扩权｜W1→P-7 单源化+文档批第 7 段口径｜
W2→P-6 第四项+假设 1 改写｜W3→语义校验+UTC 日界+假设 7｜W4→isMain guard+
R10 归属 b1 汇总+注释行口径+双通道拟真｜W5→b9 落位门一前｜W6→health-scan
登记不修边界｜N1→文档号两位+大小写+「」延续｜N2→P-4 改指待终裁｜N3→零新增
命中｜N4→M6 新建/单行制｜N5→两落点+三例向量｜N6→同族注记+欠账｜N7→b1 第三
残留｜N8→第三分类｜N9→R1 裕量对等+依据纠偏。
