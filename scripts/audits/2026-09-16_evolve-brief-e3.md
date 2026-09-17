# 实现简报 E3（b8+b9）——领单号 evolve-E3

## 1. 身份与禁令

- 你=ai-dev-org 技能实现者岗（会话内绑定，意图档位声明：宿主绑定档）。
  技能根=C:\Users\Administrator\.zcode\skills\ai-dev-org（下称 ROOT）。
- 禁令：禁 git push；禁新依赖；禁改 scripts/*.mjs 代码逻辑（**头注注释行级
  修改除外**）；禁触 scripts/roles/**（含 .golden）、org-config.default.json、
  scripts/.golden/**、templates/**（除 org-seg.snippet.md :11 一行扩权）、
  references/{03,05,07,08,09}、model-routing-log.jsonl、.zcode/org-ledger.jsonl
  （**账本=主控单写，你禁写**）、历史审计档既有件（scripts/audits/** 既有
  文件一律禁改——含本战役 plan/out/report/log 已落件）。
- 本单修改面（白名单）：SKILL.md；references/{01,02,04,06}-*.md；
  scripts/{skill-gc,log-triage,regression,health-scan,ds-call-v2,org-config,
  check-hardcode,check-anchors,init-defenses}.mjs（**仅头注退出码块指针化，
  行级**）；templates/org-seg.snippet.md（仅 :11）；RESIDUALS.md；CHANGELOG.md；
  新建 scripts/audits/2026-09-16_evolve-e3-*.md。超面=停手报 BLOCKED。

## 2. 必读序

1. scripts/audits/2026-09-16_evolve-plan-v3.md §3 b8/b9+§5 P-5/P-6/P-8
2. 裁决岗条件（主控转述）：C1=头注规则式穷举（11 件 .mjs 逐件实读表，
   显式含 check-anchors:10 与 init-defenses:8-9；templates/verify.mjs:6 与
   check-constitution-budget:3 登记不修）；C4=`固定六段` 活文档面清零+
   02 §4 `固定七段` 命中+R7 过
3. references/06-model-routing.md §5.8（退出码总表+迁移注记先例 :142-145）
4. RESIDUALS.md 全文（登记行风格/三态/supersedes 口径）
5. CHANGELOG.md 头部（条目风格）
6. references/02-pipeline-templates.md §4（根治对象）与 §10（SKILL:53/:124
   指针落点）
7. E1/E2 报告（scripts/audits/2026-09-16_evolve-e1-report.md、-e2-report.md）
   的自裁申报与移交面（b9 登记素材）

## 3. 预裁决

- **P-1（b8 形态普查）**：扫=活文档面（references/**、SKILL.md、templates/
  org-seg.snippet.md、scripts/*.mjs 头注）。样式族：`固定六段`／`三类告警`／
  `任务书六段`类完整计数断言。三分类处置：①完整清单断言→「七段（1-6 段
  惯称『六段简报』，单源 02 §4）」或指针化（SKILL:53→「分类单源 02 §10」；
  SKILL:124 去数字留指针）；②段名引用/惯称（"六段简报""六段之「基线数字」段"）
  →**保留不动**（新 02 §4 已定义惯称）；③混合短语（SKILL:90"12 步+任务书
  六段"）→只改腐化半边（→"任务书七段"）。**单源根治**：02 §4 首句→
  「固定七段（1-6 段惯称『六段简报』），缺一段=任务书不合格」，删除旧
  括注补丁句式（:71 括注内容并入正文或删除，语义不丢：第 7 项=2026-09-14
  P1-1 增）。逐命中处置表入报告。scripts/audits/** 历史件中的引文（本战役
  档案描述修复对象用）=不改（08 §3），报告注明该豁免口径。
- **P-2（b8 计数/清单腐化）**：06 §5 R 清单（"R1~R6"句）→指针化（"R 项
  清单单源=scripts/regression.mjs 现行项集合"）；06:91 内联退出码复写→
  改指本件 §5.8；01:166"补遣"→"补遗"；04 头注"WP 教训库 11 条"→去数字
  指针化（「条数单源=scripts/.golden/doc-counts.json」）。
- **P-3（b8 头注九件指针化，规则式）**：一切 scripts/*.mjs 头注中"数字=语义"
  退出码复写块→收敛为指针（「退出码口径单源=references/06 §5.8」+仅保留
  本件特有语义一句以内，若该语义 §5.8 已覆盖则全删只留指针）。九件=skill-gc/
  log-triage/regression/health-scan/ds-call-v2/org-config/check-hardcode/
  check-anchors/init-defenses（行号以实读为准：≈skill-gc:20、log-triage:18、
  regression:13-15、health-scan:15、ds-call-v2:14-16、org-config:7、
  check-hardcode:21、check-anchors:10、init-defenses:8-9）。**11 件逐件实读
  穷举表入报告**（含 glm-look:30 无数字表=排除、check-constitution-budget:3
  弱同型=登记不修、templates/verify.mjs:6=禁改面登记）。regression.mjs 只动
  头注（:2 行 E2 已指针化，:13-15 退出码块本批）——**禁触代码逻辑**。
- **P-4（b9 RESIDUALS 登记）**：按下表逐行落册（风格/三态/supersedes 依
  现有册；来源列统一含「外部评审清偿战役 evolve 批（档=scripts/audits/
  2026-09-16_evolve-*）」）：
  - closed 8 行：evolve-h1-transport（b1，含三条残留拆行见下）／
    evolve-h3-exitcode（b2）／evolve-m1-datewindow（b3，按勘误后事实
    "静默空窗"书写）／evolve-m3-nullguard（b4）／evolve-h2-timeouts（b5，
    R1=5,400,000ms=4,835,000 派生+裕量）／evolve-b6-containment（纵深防御
    定性）／evolve-b7-anchorblind（NN·XN 扩面+01:157 改指 01·C2）／
    evolve-b8-docrot（形态普查+九件头注+02 §4 根治）
  - open 拆行：evolve-b1-transportresidual（三面：>300s 首字节不可回归
    复现（undici 消除=结构断言）/Node25 退出面不可实证（零外派期）/
    异端点传输语义面（glm 形 3xx/gzip 未实证，mock 仅证本地拟真））／
    evolve-r1-timeout-unverified（R1 超时改动零运行时实证；触发器=下次
    --r1 真实跑后核）／evolve-m4-hardcode（ds-call-v2 max_tokens=32768/
    temperature=0.2、regression R1 SOURCES 别名、check-anchors
    PROJECT_NAMES——承接=下批 org-config 化）／evolve-m6-runid（runId 4
    字符并发碰撞+appendFileSync 交错+log-triage switch 单值覆盖；互指
    A-dsN-1 与 regression:116 注释）／evolve-m5-regenv（回归 R2b/R5/R4 勾连
    宿主 config 双校验，跨环境不复现——设计取舍显式化）／evolve-l3-sort、
    evolve-l4-flags、evolve-l5-frontmatter、evolve-l9-degrade（外部评审
    低优先四项，各一行）／evolve-glmlook-150-null（E2 在 E1 面新发现：
    glm-look:150 provider null 裸取，E1 纪律申报不自修移交）／
    evolve-k2-silent（k2 首派静默无输出 5min/0 工具调用，重跑成功；触发器=
    复发≥2 次升宿主排查批）／evolve-samefamily（**证据形态按裁决 C6：同
    model-key(k3)+异 uuid 前缀（b2466f8b…/5e1abd9d…），勿断言"异供应商"
    为已证事实**；处置=轻量双审合规注记+欠账，宿主提供真异构备源时消账）／
    evolve-verify-mjs-header（templates/verify.mjs:6 禁改面命中登记）／
    evolve-ccb-weaktype（check-constitution-budget:3 弱同型登记）／
    evolve-struct-tables（岗位三表收敛：SKILL/06 §1/07 §1 单源化+指针）／
    evolve-struct-glossary（术语速查入口 00 件）／evolve-struct-patchwrite
    （补丁式时序写作收敛——"后节接管前节"结构化）
  - 在册行补注 1 处：02-§8-model-terms 处置列+=「承接批次=结构项专项批
    （evolve-struct-* 同批呈报）」——**不新建行**
- **P-5（b9 CHANGELOG+SKILL/06）**：CHANGELOG 增 v1.7 条（战役全链：外部
  评审→计划 v1-v3 双源两轮 FAIL 全吸纳→裁决有条件放行 C1-C6→E1/E2/E3→
  门禁终态；**行为变化申报 P-6 四项**：①log-triage --date 非法=exit 1
  （原静默空窗）②ds-call-v2 英文 locale 配置类 exit 1→3（修误分类）
  ③registry 文件路径越界新增 exit 3（纵深防御不可达）④null provider 由
  TypeError 崩溃改校验错误（org-config/ds-call-v2=exit 3；check-hardcode=
  降级行继续扫）；内部测试设施申报：GLM_LOOK_HOST_CONFIG/GLM_LOOK_LOG_DIR
  env 钩子（缺省行为不变）；头注指针化=v1.6 声称清偿未闭环的本批实证闭环）。
  06 §5.8 迁移注记+=v1.7 行（上述②③④退出码面）。SKILL.md 修订记+=v1.7
  单条（版本面统一惯例）。SKILL.md :53/:124/:90 按 P-1 处置。
- **P-6（机检自验）**：C1=`grep -rn "退出码" scripts/*.mjs` 无"数字=语义"
  复写块不指向 06 §5.8 者（穷举表 11 件全）；C4=活文档面 `grep -rn
  "固定六段" references/ SKILL.md templates/`=空+02 命中"固定七段"+R7 过；
  全量门禁不回退（regression 8/8+三扫+health-scan RED=0/WARN≤2）。

## 4. 纪律

- 文档批 TDD 形态=机检先行（C1/C4 grep 断言红态=改前"固定六段"命中/
  头注复写命中落盘）→改→绿；变异红证≥1（临时回退一处指针化→grep 红）。
- 真退出码落盘 scripts/audits/2026-09-16_evolve-e3-log.md。
- 分笔 commit ×2（b8=文档+头注；b9=RESIDUALS/CHANGELOG/SKILL 修订记/06
  迁移注记），`git commit -F <UTF-8 文件>`，风格 `fix(evolve-bN): …`。

## 5. 基线数字（E2 后）

regression 8/8（R1 SKIP）；check-hardcode 0（豁免 33）；check-anchors
WARN×0/FAIL×0+自检 16/16；health-scan RED×0/WARN×2；git HEAD=67a60e1。

## 6. 报告契约

全文落 scripts/audits/2026-09-16_evolve-e3-report.md：实现摘要/形态普查
逐命中处置表/头注 11 件穷举表/RESIDUALS 新增行清单（编号+状态）/机检
红→绿证据/commit 哈希/自裁申报/疑虑。回复五行内。

## 7. 运行时可观察性（单源词表=02 §4；文档批口径）

- 本批无新运行时行为——可观察性落点=文档面体检机检：C1/C4 grep 断言+
  check-anchors（含 E2 扩面后 NN·XN 巡检）+R7 指针校验+门禁三扫对文档
  面的覆盖（本段即 02 §4 第 7 项的文档批统一答法，与计划 v3 P-7 一致）。
