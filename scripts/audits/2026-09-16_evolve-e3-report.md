# evolve-E3 实现报告（b8+b9）——2026-09-16

领单号=evolve-E3；简报=scripts/audits/2026-09-16_evolve-brief-e3.md；计划=
2026-09-16_evolve-plan-v3.md §3 b8/b9+§5 P-5/P-6/P-8（裁决件 ruling 以简报
预裁决 P-1~P-6 为准）。环境=Node v25.2.1/Git Bash win32/技能根 git@main，
基线 HEAD=67a60e1（E2 终笔）。基线核对=regression 8/8（R1 SKIP）/hardcode 0
（豁免 33）/anchors WARN×0 FAIL×0/health-scan RED×0 WARN×2/cfg 沿用——
全部对上后开工。全程零真实外呼；**账本 .zcode/org-ledger.jsonl 零写入**
（主控单写铁律遵守）；scripts/*.mjs 仅动头注注释行（零代码逻辑改动，
diff 实核）。真退出码全文=同目录 `2026-09-16_evolve-e3-log.md`。

## 1. 实现摘要

- **b8（文档+头注清偿，commit b76efd7，15 files 36+/33−）**：
  ①「固定六段」族形态普查三分类处置——02 §4 单源根治「固定七段（1-6 段
  惯称『六段简报』）」+删旧括注补丁句式（第 7 项=2026-09-14 P1-1 增语义
  并入正文）；SKILL:90 混合短语只改腐化半边（任务书六段→七段）；SKILL:53/
  :124+snippet:11 告警三分类计数短语指针化 02 §10；②计数/清单腐化——
  06 §5 R 清单（R1~R6 句+6 条内联 checklist）指针化（单源=regression.mjs
  现行项集合）；06:91 内联退出码复写改指本件 §5.8；SKILL:155 同族 R1~R6
  断言一并指针化（自裁 1）；01:166 补遣→补遗；04 头注「11 条」去数字指针
  化 doc-counts golden；③九件脚本头注退出码复写块规则式指针化 06 §5.8。
- **b9（登记闭环，commit 6edffa2，4 files 114+/10−）**：RESIDUALS 新增
  evolve 节 25 行（closed 8/open 17）+在册 02-§8-model-terms 补注+修订记行；
  CHANGELOG v1.7 条（战役全链+P-6 四项行为变化+env 钩子申报+头注闭环
  实证）；06 §5.8 迁移注记 v1.7 行；SKILL.md 修订记换 v1.7 单条。

## 2. 形态普查逐命中处置表（P-1/P-2；扫描面=references/**+SKILL.md+
templates/org-seg.snippet.md+templates/task-brief-template.md+scripts/*.mjs 头注；
grep 样式族=`固定六段`/`三类告警`/`任务书六段`/`六段`/`R1~R6`）

| # | 位置 | 原文形态 | 分类 | 处置 |
|---|---|---|---|---|
| 1 | references/02-pipeline-templates.md:70-71 | 「固定六段，缺一段=任务书不合格」+括注「（2026-09-14 P1-1 增第 7 项…）」 | ①完整清单断言 | **单源根治**：改「固定七段（1-6 段惯称『六段简报』），缺一段=任务书不合格」；括注删除、P1-1 语义并入正文（见 #1 处置后半句） |
| 2 | SKILL.md:90 | 「02 管道 12 步+任务书六段+回炉…」（加载地图） | ③混合短语 | 只改腐化半边→「任务书七段」（「12 步」保留） |
| 3 | SKILL.md:53 | 「收口前健康扫描（欠账/同源/预算，RED=0 方可收口）」 | ①完整清单断言 | 指针化→「（RED=0 方可收口；告警分类单源=02 §10）」 |
| 4 | SKILL.md:124 | 「三类告警细则=02 §10」 | ①完整清单断言 | 去数字留指针→「告警分类细则=02 §10」 |
| 5 | templates/org-seg.snippet.md:11 | 「（欠账/同源/预算三类告警）」 | ①完整清单断言 | 指针化（:11 扩权单行；R7 钉的「单源=02 §9」指针行 :9-10 未动，R7 单独复跑 PASS） |
| 6 | SKILL.md:155 | 「派发器 v2 回归 R1~R6 全过」（冻结条件） | 计数断言（P-2 同族） | 指针化→「回归全项过（R 项清单单源=scripts/regression.mjs 现行项集合）」——自裁 1 |
| 7 | references/06-model-routing.md:93-99 | 「回归前置（R1~R6 全过方启用…；清单内联）」+R1-R6 六条 checklist | 计数/清单腐化 | 指针化（同上单源；六条内联 checklist 删除，逐项语义真源=regression.mjs 头注） |
| 8 | references/06-model-routing.md:91 | 「exit 3（配置级；2 保留给源尽 exhaust，1=用法，4=本地 IO）」 | 内联退出码复写 | 括注改「（语义与全退出码总表=本件 §5.8——本节不复写）」 |
| 9 | references/01-org-principles.md:166 | 「06 §6 补遣」 | 错字 | →「补遗」 |
| 10 | references/04-lessons.md:3 | 「WP=WaterPrint 教训库 11 条+工作流条款」 | 计数复写 | 去数字指针化→「（条数单源=scripts/.golden/doc-counts.json——正文不落数字，A3）」 |
| 11 | references/02-pipeline-templates.md:235 | 「任务书六段之「基线数字」段增补一行」 | ②段名引用/惯称 | **保留不动**（简报 P-1 明示例；新 02 §4 已定义惯称） |
| 12 | references/01-org-principles.md:155 | 「实现者=六段简报」 | ②惯称 | **保留不动**（同上） |
| 13 | references/05-porting-guide.md:50 | 「任务书六段模板」 | 禁改面（references/05） | 登记不修 |
| 14 | references/05-porting-guide.md:60 | 「任务书模板（六段）」 | 禁改面 | 登记不修 |
| 15 | references/07-role-cards.md:13 | 「按六段简报 TDD 实现+分笔 commit+报告」 | 禁改面（references/07；且属②惯称） | 登记不修 |
| 16 | templates/task-brief-template.md:1 | 「任务书模板（六段，缺一段=不合格）」 | ①完整清单断言**但禁改面**（templates/** 白名单外） | 登记不修（移交主控裁量，见疑虑 1） |
| 17 | scripts/init-defenses.mjs:4/:110/:112 | 「任务书六段模板」（头注+生成清单行） | 本批白名单限「仅头注退出码块」——非退出码面 | 登记不修 |
| 18 | scripts/audits/** 历史件（如 evolve-plan-v1-k1-out.md:18 引「固定六段」） | 战役档案描述修复对象用引文 | 豁免口径 | **不改**（08 §3 历史件红线；含本战役 plan/brief/log/report 已落件） |

机检口径：C4 断言面（`grep -rn "固定六段" references/ SKILL.md templates/`）
改前命中=1（02:70）→改后 0；`三类告警` 改前 2（SKILL:124+snippet:11）→
改后 0；`六段` 族其余命中按上表 ② 保留/禁改登记——保留项由新 02 §4 惯称
定义收编，非腐化残留。

## 3. 头注 11 件逐件实读穷举表（P-3/C1；scripts/*.mjs 全 11 件实读+verify.mjs 附）

| # | 文件:行 | 改前形态（实读） | 判定 | 处置 |
|---|---|---|---|---|
| 1 | scripts/skill-gc.mjs:20 | 「退出码：0=正常；1=参数误用或归档事务失败；2=--apply 未指定删除类」——**2 与总表直接冲突**（代码 :38 实为 exit 1，v1.6 已迁） | 数字=语义复写块 | 指针化+顺带清偿陈旧 2（自裁 4） |
| 2 | scripts/log-triage.mjs:18-19 | 「0=正常；1=RED 级/自检失败/非法 --date…；3=配置错」（E2 b3 最小增补态） | 复写块 | 指针化（§5.8 全覆盖；留过渡注一句见自裁 5） |
| 3 | scripts/regression.mjs:14-16 | 「0=所选回归项全过；1=任一 FAIL（含 R2b…不单独 exit 3）；3=配置错误（golden 缺失…）」 | 复写块 | 指针化+保留本件特有一句（R2b 装载路异常计入 FAIL 汇总不单独 3） |
| 4 | scripts/health-scan.mjs:15 | 「0=无 RED；1=…；3=…。总表=references/06 §5.8」（带指针仍复写） | 复写块 | 指针化 |
| 5 | scripts/ds-call-v2.mjs:14-16 | 「3=配置级…；2=源尽 exhaust；4=本地 IO…；1=用法错误」 | 复写块 | 指针化（2/4 特有语义=总表既有行含适用列，不另留） |
| 6 | scripts/org-config.mjs:7 | 「0=…；1=…；3=…（区别于派发器源尽 exhaust=2）。总表=06 §5.8」 | 复写块 | 指针化 |
| 7 | scripts/check-hardcode.mjs:21 | 「0=…；1=…；3=…；5=降级运行…总表=06 §5.8」 | 复写块 | 指针化（5=总表本件专属行既有） |
| 8 | scripts/check-anchors.mjs:15 | 「0=通过…；1=计数 FAIL 或自检 FAIL；3=配置错（golden 缺失）」 | 复写块 | 指针化（:13-14 级别行=WARN/FAIL 试点口径非退出码映射，保留不动） |
| 9 | scripts/init-defenses.mjs:8-9 | 「退出码（同技能约定 3-2-1-4 的本地件子集）：3=…；1=…（已回滚）」 | 复写块 | 指针化+保留本件特有一句（预算自检 FAIL 先回滚再退） |
| 10 | scripts/glm-look.mjs:34 | 「退出码经 process.exitCode 自然退出（Node 25 libuv…勿用 process.exit 急退）」 | **无数字=语义表** | 排除（简报 P-3 既定口径；该行为传输纪律注非退出码映射） |
| 11 | scripts/check-constitution-budget.mjs:3 | 「每段非空白字符数 ≤600 为过；缺段/多段/…超限 → exit 1（立案清单第 0 步强制项）」 | 弱同型（单退出码弱形态，非完整数字=语义表） | **登记不修**（RESIDUALS evolve-ccb-weaktype；脚本不在本批白名单） |
| 附 | templates/verify.mjs:6 | 「（退出码：0=全过；1=有 FAIL）」 | 数字=语义复写（模板骨架件） | **登记不修**（templates/** 禁改面；RESIDUALS evolve-verify-mjs-header） |

件数口径：scripts/*.mjs 共 11 件**全部实读**（9 修+1 排除+1 登记不修）=
简报「11 件穷举表」；templates/verify.mjs 为表外禁改面登记项（附行呈报）。
C1 机检=`grep -rnE "退出码.*：.*[0-9]+=" scripts/*.mjs` 改前 9 块（恰=九件
全集）→改后 0；非头注行内既有指针注释（glm-look:242/skill-gc:38/
ds-call-v2:59-91/check-hardcode:32-86 等）均已指向 06 §5.8，不在复写块
判定面。

## 4. RESIDUALS 新增行清单（P-4；25 行+补注 1 处；来源列统一含「外部评审
清偿战役 evolve 批（档=scripts/audits/2026-09-16_evolve-*）」）

- **closed 8**：evolve-h1-transport（b1）/evolve-h3-exitcode（b2）/
  evolve-m1-datewindow（b3，按勘误后事实「静默空窗=假绿」书写）/
  evolve-m3-nullguard（b4）/evolve-h2-timeouts（b5，R1=5,400,000ms=
  4,835,000 派生+90min 裕量）/evolve-b6-containment（纵深防御定性）/
  evolve-b7-anchorblind（NN·XN 扩面+01:157 改指 01·C2）/evolve-b8-docrot
  （形态普查+九件头注+02 §4 根治+禁改面命中登记）——单行制，新开即闭。
- **open 17**：evolve-b1-transportresidual（三面：>300s 首字节不可复现/
  Node25 退出面不可实证/异端点传输语义面）/evolve-r1-timeout-unverified
  （触发器=下次 --r1 真实跑后核）/evolve-m4-hardcode（max_tokens=32768/
  temperature=0.2+regression R1 SOURCES 别名+check-anchors PROJECT_NAMES，
  承接=下批 org-config 化）/evolve-m5-regenv（跨环境不复现=设计取舍显式化）/
  evolve-m6-runid（4 字符碰撞+appendFileSync 交错+switch 单值覆盖，互指
  A-dsN-1 与 regression R5 区注释）/evolve-l3-sort/evolve-l4-flags/
  evolve-l5-frontmatter/evolve-l9-degrade（外部评审低优先四项各一行）/
  evolve-glmlook-150-null（E2 新发现 M3 族第 4 消费点）／evolve-k2-silent
  （触发器=复发≥2 次升宿主排查批）/evolve-samefamily（C6 口径：同
  model-key+异 uuid 前缀 b2466f8b…/5e1abd9d…，异供应商=未证假设勿断言）/
  evolve-verify-mjs-header/evolve-ccb-weaktype（两件禁改面登记）/
  evolve-struct-tables/evolve-struct-glossary/evolve-struct-patchwrite
  （结构项三件，承接=专项批）。
- **在册补注 1 处**：02-§8-model-terms 处置列+=「承接批次=结构项专项批
  （evolve-struct-* 同批呈报）」——不新建行。
- 修订记追加「2026-09-16 外部评审清偿战役（evolve 批，v1.7）」行。

## 5. 机检红→绿证据（全文=e3-log §1-§3；真退出码落盘）

- **红（改前）**：C4 `grep -rn "固定六段" references/ SKILL.md templates/`
  =1 命中（02:70）+`固定七段` 计数 0；C1 宽式
  `grep -rnE "退出码.*：.*[0-9]+=" scripts/*.mjs`=9 块（宽式补抓
  init-defenses 括注形态；窄式 8 块的差额=init-defenses:8）；`三类告警`=2。
- **绿（改后）**：C4=0（grep exit 1）+`固定七段` 计数 1+`三类告警`=0+
  C1=0（exit 1）。
- **变异红证 ×2**：①02 §4 单源句临时回退（七→六）→C4 grep 1 命中翻红，
  证毕还原；②skill-gc 头注临时回贴旧复写行→C1 grep 1 命中翻红，证毕还原。
- **门禁（b8 后/b9 后/收尾三轮）**：regression 8/8 过（R1 SKIP，exit 0；
  R7 单独复跑 PASS「SKILL.md:✓ org-seg.snippet:✓」）；check-hardcode
  命中 0（豁免 33，exit 0；b9 初稿曾 1 命中=RESIDUALS:85 落实配模型键
  字面，改值指针化到批档审出件后复绿——白名单禁改未动）；check-anchors
  WARN×0/FAIL×0（exit 0）+--self-test 16/16（exit 0）；health-scan
  RED×0/WARN×2（=基线存量 ok 缺 usage+in=0 而 out>0，不劣化，exit 0）。

## 6. commit 哈希（两笔，未 push；`git commit -F <UTF-8 文件>`）

| commit | 批 | 文件（stat 实核） |
|---|---|---|
| **b76efd7** | b8 | SKILL.md+references/{01,02,04,06}-*.md+templates/org-seg.snippet.md+九件 scripts/*.mjs（15 files，36+/33−；.mjs 全部仅头注注释行） |
| **6edffa2** | b9 | RESIDUALS.md+CHANGELOG.md+SKILL.md（修订记）+references/06-model-routing.md（§5.8 迁移注记）（4 files，114+/10−） |

工作树净（仅 scripts/audits/ untracked 惯例件；报告与 log 不入 commit，
承 E1/E2 惯例）。

## 7. 自裁申报（逐条）

1. **SKILL.md:155「R1~R6 全过」一并指针化**：P-2 字面仅列 06 §5 R 清单；
   SKILL:155 为同族计数断言（regression 现行项已非 R1~R6），按 P-8
   「普查与修复一律规则式」+SKILL.md 在修改白名单内处置。不改则同族
   腐化残留、与 06 §5 指针化形成双源不一。
2. **06 §5.8 迁移注记 v1.7 行含①**：简报 P-5 字面写「②③④退出码面」，
   但①（log-triage --date 静默空窗→exit 1）同为退出码面，且计划 v3 P-6
   明文「全入 CHANGELOG v1.7+06 §5.8 迁移注记」——按计划全入口径落地，
   CHANGELOG 与迁移注记两处一致呈报。
3. **evolve-samefamily 行不落实配模型键字面**：初稿按简报原文写
   「model-key（k3）」触发 check-hardcode WARN×1（宿主注册表实配模型名
   扫描面）——按 06 §0「本件与 SKILL.md 均不含任何端点/套餐数字」同律，
   本册正文不落供应商 live 事实，键值改指针化到批档 k1/k2 审出件（uuid
   前缀对 b2466f8b…/5e1abd9d… 保留，非扫描词面）；C6 证据形态语义不变。
4. **skill-gc:20 陈旧「2=--apply 未指定删除类」顺带清偿**：该复写与代码
   （:38 process.exit(1)）及 06 §5.8（2=派发器 exhaust 专用）直接冲突，
   属 v1.6 迁移漏清偿面；在头注行级修改权限内删除，无代码逻辑改动。
5. **指针行保留极简批注**：各件指针行内留「此处不复写数字=语义映射，
   防双源漂移——evolve 批 b8 指针化」 rationale 注+本件特有语义一句
   （regression/init-defenses 两件各有真特有语义；log-triage 留过渡分类
   注一句「RED 检出/自检失败/非法 --date 用法拒均属总表 1 类」——属
   「本地行为→总表类目」的归类注而非数字=语义复写，C1 机检面不命中；
   其余件全删只留指针+批注）。简报允许「仅保留本件特有语义一句以内」，
   此为上限内措辞，申报备查。
6. **报告与 log 不入 commit**：承 scripts/audits/ 既有 untracked 惯例
   （E1 自裁 7/E2 自裁 7 同款）；两笔 commit 只含交付面。
7. **普查面微扩**：P-1 扫描面字面为「references/**、SKILL.md、
   templates/org-seg.snippet.md、scripts/*.mjs 头注」，实扫加含
   templates/task-brief-template.md 与 references/05/07（grep 全库去除
   audits 后核对）——只为穷举登记不修项（#13-#17），未产生额外修改。

## 8. 疑虑（移交主控）

1. **task-brief-template.md:1「（六段，缺一段=不合格）」**=①类完整计数
   断言落在禁改面（templates/** 仅 snippet:11 扩权）——已登记于
   evolve-b8-docrot 处置列+本报告 #16，未按 P-4 清单拆独立 residual 行。
   建议：并入 evolve-verify-mjs-header 所指的 init-defenses 模板升版批
   一并指针化（同批扩权一行即可）。
2. references/05:50/:60、07:13 的「六段」字样属②惯称/段名引用，即便
   扩权也无须修改；与 task-brief 模板（①需改）性质不同，已分列呈报。
3. R1 仍 SKIP（配给保护）；b1 三面/R1 超时零实证等不可实证面均已按 P-4
   拆行登记，消账触发器见各行（真外呼窗口/--r1 真实跑/复发计数/宿主
   备源）。
4. 账本收口 ruling 行由主控单写（本单零写入）；RESIDUALS 25 行与
   CHANGELOG v1.7 已入 b9 commit，可随门一 diff 审面呈报。

MODEL-SELF: model-field:builtin:bigmodel-coding-plan/GLM-5.3
LEDGER-CLAIM: role=ops-executor executor=model-field:builtin:bigmodel-coding-plan/GLM-5.3 units=2 outcome=done
