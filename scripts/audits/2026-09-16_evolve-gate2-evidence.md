# 门二实证档：外部评审清偿战役（evolve 批，含回炉轮）——独立实证实录

- 取证岗：ops-probe（独立派发新会话，与裁决部不同上下文）
- 取证窗口：2026-09-16T16:40Z–16:57Z（各条目时间为命令完成时刻近似）
- 技能根：C:\Users\Administrator\.zcode\skills\ai-dev-org（全部命令在此目录执行）
- git 基线核实：fe19260..HEAD 共 11 笔 commit（b1-b9 九笔 + rework r1/r2 两笔），HEAD=6e147ce（rev-parse 实测 6e147ce3e0f9d210ee8c5dbbdf87538ff519cd15）——与简报一致
- 纪律：只读取证+跑验证命令，零文件修改（本档除外）

## 一、矩阵执行表（逐项：命令 / 退出码 / 关键输出）

| # | 命令 | 退出码 | 关键输出 | 判定 |
|---|------|--------|----------|------|
| 1a | `node scripts/org-config.mjs hash` | 0 | `cfg:a26f710a540d` | 绿——与账本历史 a26f710a540d 一致，无漂移 |
| 1b | `node scripts/org-config.mjs validate` | 0 | `validate PASS（3 源双校验通过，cfg:a26f710a540d）` | 绿 |
| 2 | `node scripts/regression.mjs`（全量） | 0 | `8/8 过，SKIP ×1`（项=R2a/R2b/R5/R4/R7/R8/R9/R10 过；R1 SKIP=预期「未给 --r1」） | 绿 |
| 3 | `node scripts/regression.mjs --only R10` | 0 | `1/1 过`——①结构断言：非注释行 fetch 命中=0、node:http(s) import ✓；②mock 往返：glm ✓(exit=0 attempt/ok 行)/ds ✓(exit=0)；③向量：splitEndpoint 全过/classify+ensure 全过；④B1 两向量：坏 JSON→exit=3 [fatal]=true、roles:null→exit=3 [fatal]=true | 绿 |
| 4 | `node scripts/check-hardcode.mjs` | 0 | `扫 12 个 .md，命中 0 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）` | 绿——命中 0/豁免 33 |
| 5a | `node scripts/check-anchors.mjs` | 0 | `WARN ×0 / FAIL ×0（扫描面=11 件）` | 绿 |
| 5b | `node scripts/check-anchors.mjs --self-test` | 0 | `[self-test] 16/16 过` | 绿 |
| 6 | `node scripts/health-scan.mjs --project .` | 0 | `RED ×0 / WARN ×2`——WARN 2 条=①账本 1 行 ok 缺 usage ②4 行 in=0 而 out>0（账本行 76/流水行 1177/窗口 20） | 绿——RED=0/WARN=2（≤2） |
| 7a | `node scripts/org-config.mjs --self-test` | 0 | 10 向量全过（含 b4 三向量：null def 校验错误行/近邻 null 宿主条目/健康源不受影响） | 绿 |
| 7b | `node scripts/log-triage.mjs --self-test` | 0 | 24 向量全过（含 b3 格式/语义/UTC 日界/窗口过滤 10 向量+b4 null provider 向量）——两脚本均支持 `--self-test`，简报「若非法」分支未触发 | 绿 |
| 8a | `node scripts/log-triage.mjs --date foo` | 1 | stdout 空；stderr 一行 `[usage] --date 非法值「foo」——须为真实存在的日期（YYYY-MM-DD…）` | 绿——符合 P-6① 申报 |
| 8b | `node scripts/log-triage.mjs --date 2026-13-45` | 1 | stdout 空；stderr 一行 `[usage] --date 非法值「2026-13-45」…` | 绿 |
| 8c | `node scripts/log-triage.mjs --date 2026-09-16` | **1**（简报预期 0） | stdout=完整分诊报表 83 行（①⑤ 供应商分布/② 外链路计数/③ 静默回退检测/⑥ 用量/⑦ 终态派生），stderr 空、无崩溃 | **黄**——运行本身正常；exit 1 触发链已定位（见异常清单 A-1） |
| 9-C1 | `grep -rn "退出码" scripts/*.mjs` + 补充形态扫描 + 10 件头注逐件实读 | 0 | 头注全部为「退出码口径单源=references/06 §5.8」指针形（check-anchors:15/check-hardcode:21/health-scan:15/ds-call-v2:14/init-defenses:8/log-triage:18/org-config:7/regression:14/skill-gc:20）；glm-look 头注无数字映射；补充扫描（`1=用法|2=exhaust|3=配置|4=输出|5=降级|exit N；`）命中行均带 06 §5.8 指针或单点特有语义注释（ds-call-v2:61-62 分类器判据注释带「判据源=06 §5.8 退出码总表」前缀；ds-call-v2:483 exit 4=本件特有+ds-W1 终裁指针；glm-look:242/skill-gc:39 单行注释带总表指针）——**无「无指针的数字=语义复写块」、无句式规避** | 绿 |
| 9-C2 | `git diff --name-only fe19260..HEAD -- scripts/` + diff 实读 | 0 | 修改 10 件 .mjs（check-anchors/check-hardcode/ds-call-v2/glm-look/health-scan/init-defenses/log-triage/org-config/regression/skill-gc）；check-constitution-budget 不在 diff=登记不修 ✓；hardcode-whitelist.json 未动 ✓；init-defenses=纯头注 2 行 ✓；health-scan=头注指针化+**另含 2 处 06 §8.6→02 §8.6 笔误修正（其中 1 处为运行时 WARN 文案字符串，line 104）**——diff 面与白名单差集=0（10 修改+1 不修=11 件对账一致），health-scan 改动略超「头注级」字面（见异常清单 A-2） | 绿（附注） |
| 9-C3 | `grep -rn "02·C2" references/ SKILL.md`；`grep -n "01·C2" references/01-org-principles.md`；自检源码核读 | 1 / 0 / — | 02·C2 全文档面 0 命中（grep exit 1=无匹配）✓；01·C2 命中 `references/01-org-principles.md:157`（「锚点：门一 3W 全真缺陷拦截实战（01·C2）」=改指行）✓；check-anchors.mjs:155 自检向量 `条目负例（合成串，裁决 C3 要求自检保留）：02·C2→WARN` 实在 ✓ | 绿 |
| 9-C4 | `grep -rn "固定六段" references/ SKILL.md templates/`；`grep -n "固定七段" references/02-pipeline-templates.md`；R7（矩阵 2 内） | 1 / 0 / 0 | 固定六段 0 命中 ✓；固定七段命中 `references/02-pipeline-templates.md:70`（「固定七段（1-6 段惯称『六段简报』），缺一段=任务书不合格」）✓；R7 PASS（矩阵 2 实录）✓ | 绿 |
| 9-C5 | `grep -n "spawnSync\|timeout" scripts/regression.mjs` + 实读 | 0 | 五处主流程 spawnSync 语句全带 timeout+killSignal:SIGKILL——R2b:94=5,000ms / R5:119=5,000 / R4:184=5,000 / R8:231=5,000 / R1:428=**5,400,000** ∈ C5 机检窗 [4,835,000, 7,200,000] ✓；另 R10 辅助 r10Spawn:266=60,000（b1 先立，注释 262/267-268 互指） | 绿 |
| 9-C6 | `grep -n "evolve-samefamily\|evolve-k2-silent\|异供应商" RESIDUALS.md` | 0 | RESIDUALS.md:85 evolve-samefamily 行含「源A/源B MODEL-SELF 同 model-key（同宿主实配模型键，具体串与 uuid 前缀对=b2466f8b…/5e1abd9d… 见批档 k1/k2 审出件）」+「异供应商」全文仅此 1 处且明示「为未证假设，勿断言为已证事实」✓；RESIDUALS.md:84 evolve-k2-silent 行（k2 首派静默失败，open）✓ | 绿 |
| 10a | ds-call-v2 cliMain 顶层装载点核读 | — | cliMain(331) 内 registry readJson(351)/loadOrgConfig(353)/readHostConfig(370) 三处 try-catch 包 `throw new ConfigError`（exitCode=3）；isMain guard=491 `if (isMain) await cliMain()`；loadRole(131) 内 readJson(135)+roles null/非对象守卫(139，回炉 B1 注释互指) | 绿 |
| 10b | glm-look 传输层核读 | — | `fetch(` 全文 0 命中（grep exit 1）；`import { request as httpRequest } from "node:http"`(45)+`node:https`(46) 实在；postJson 注释 86 自证镜像 ds-call-v2 v2.2.1 | 绿 |
| 10c | chCfg 兜底核读 | — | glm-look.mjs:64 `const chCfg = (ch) => (orgCfg().vision_channels || {})[ch] || {}`——W2 兜底实在（discoverSources:145 解构消费） | 绿 |
| 10d | R1 timeout 实值 | — | regression.mjs:428 `timeout: 5_400_000`（注释载单源推导 4×1,200,000+35,000=4,835,000+90min 裕量） | 绿 |

矩阵小项计数：26 项（1a/1b/2/3/4/5a/5b/6/7a/7b/8a/8b/8c/C1-C6/10a-10d）=25 绿 + 1 黄（8c 预期偏差，非缺陷）。

## 二、异常清单

**A-1（黄）：`log-triage --date 2026-09-16` 实测 exit 1，简报预期 exit 0**
- 现象：stdout 输出完整 83 行分诊报表、stderr 空、无崩溃；退出码=1。
- 证据：源码 scripts/log-triage.mjs:379 `if (fallbacks.some(f => f.level === 'RED')) process.exitCode = 1`；本次输出 ③ 静默回退检测含 1 条 RED 行：`[RED] probe-b … 声明=sonnet 实际=builtin:bigmodel-coding-plan/GLM-5.3 —— 疑似枚举/伪值（静默回退宿主）`（另有 4 条 WARN「窗口内无请求记录」不计阻断）。/tmp/lt-ok.out 全文 83 行留档。
- 初分类：非脚本缺陷——「有 RED 发现→exit 1」是分诊工具的正确信号语义（与自检向量「probe-b 假绑定可被 ③ 抓出（RED+枚举）」的实弹对应）；偏差源于简报预期值按「当日无 RED 发现」数据态写成，而当日流水实测含 probe-b 假绑定记录。裁决部可按「行为面=正常、exit 0 预期表述失准」处置。

**A-2（注记）：health-scan 修改面略超「头注级」字面**
- 现象：白名单三态称 health-scan=头注级；实测 diff（fe19260..HEAD）=头注退出码指针化 2 行 + `06 §8.6`→`02 §8.6` 笔误修正 2 处，其中 1 处（line 104）为运行时 WARN 文案字符串常量。
- 证据：`git diff fe19260..HEAD -- scripts/health-scan.mjs`（7 行变更：3 增 2 删+上下文）；该笔属回炉 r2 简报明载的「health-scan §8.6 笔误」项。
- 初分类：非越权——改动在 b9/r2 申报面内、无逻辑变更；仅「头注级」一词不能覆盖文案字符串行。对账结论不受影响（11 件三态对账一致）。

**A-3（观察）：regression 全量与 R10 专项输出无异常；health-scan WARN×2 为账本存量（1 行 ok 缺 usage+4 行 in=0 而 out>0），与 b9 门禁终态申报「WARN×2 基线存量不劣化」一致。**

无其他异常：C1-C6 六条机检全绿；矩阵 1-7、10 全部与申报门禁终态吻合（regression 8/8 R1 SKIP / hardcode 0+33 / anchors 0/0 / 自检 16/16 与 10+24 向量 / health RED0 WARN2 / cfg 哈希无漂移 a26f710a540d）。

## 三、证据文件指针

- 本档：scripts/audits/2026-09-16_evolve-gate2-evidence.md（即本件）
- 原始 stdout/stderr 捕获（/tmp，临时）：/tmp/lt-foo.out|err（8a）、/tmp/lt-badmonth.out|err（8b）、/tmp/lt-ok.out|err（8c，83 行全文）
- 交叉引用（前序批档，未改动）：scripts/audits/2026-09-16_evolve-rework-log.md、2026-09-16_evolve-rework-report.md、2026-09-16_evolve-rework-diff.diff
