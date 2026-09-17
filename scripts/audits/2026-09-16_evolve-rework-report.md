# evolve 回炉轮实现报告（evolve-rework r1/r2）——2026-09-16

领单=回炉轮简报（门一出件=B1/W1/W2/W3/N1-N4+主控移交 1 项；02 §5 原实现者续命）。
环境=Node v25.2.1/Git Bash win32/技能根 git@main；开工基线 HEAD=6edffa2（evolve b9 终笔），
工作树净（除 evolve 批既有未跟踪 audits 档）。基线门禁核对=regression 8/8（R1 SKIP）/
hardcode 0（豁免 33）/anchors WARN×0 FAIL×0/health RED×0 WARN×2——全部对上后开工。
真退出码全文=同目录 `2026-09-16_evolve-rework-log.md`（本报告证据源）。

## 1. 交付清单（分单元+commit）

| 单元 | 处置 | commit |
|---|---|---|
| B1 主面 | ds-call-v2 cliMain 顶层 `readJson(REGISTRY_PATH)` 裸调用包 ConfigError（与 loadRole 内包装同型：try/catch→`throw new ConfigError('registry 装载失败（路径）: …')`）——原形态在一切路径先执行，坏/缺 registry.json 抛普通 SyntaxError→uncaughtException 无 exitCode 属性=exit 1，违 06 §5.8 配置/装载错=3（未申报回退） | **0c6384b**（r1） |
| B1 同族次要面 | loadRole `registry.roles[roleId]` 前置校验：roles 为 null/非对象→ConfigError（exit 3）——原裸取在 roles:null 形态=TypeError→exit 1 同族回退面 | **0c6384b**（r1） |
| B1 向量（TDD） | regression R10 新增 ④ B1 向量×2 端到端：坏 registry JSON→exit 3；roles:null→exit 3（注入形态=备份-注入-跑-还原，try/finally 保还原；还原核验=注入后 git status registry.json 净）。红→绿+变异红证见 §4 | **0c6384b**（r1） |
| W2 | glm-look chCfg 未命中通道恢复 `\|\| {}` 兜底（一行；旧版恒 `{}`，b7 配置化时丢失；消费点 discoverSources 解构——缺兜底时未声明通道=TypeError 崩溃；保守恢复语义零变化方向，按简报「默认仍恢复兜底」执行） | **0c6384b**（r1） |
| W3 | 六件头注「数字=语义」残留碎片处置：3 件削成纯指针+3 件保留一句（明细=§3，保留清单呈终审） | r2 |
| N1 | log-triage --date 校验路径 `process.exit(1)` 改 `process.exitCode=1`+`return` 自然退出形态——主流程包 `run()`（return 须函数体承载；缩进重排语义零变化=ds-call-v2 cliMain/d3d7adc 先例）；自检向量复跑=--self-test 全过 exit 0、`--date foo` 实测仍 exit 1 | r2 |
| N2 | RESIDUALS evolve-b1-transportresidual 处置列追加「+R10 错误面无覆盖（mock 仅 200 happy path；非 2xx 体收割/AbortError 拒收/3xx 不跟随分派无向量）——承接=下批 R10 扩向量」 | r2 |
| N3 | check-hardcode 自检 mkdtempSync 临时目录 finally `rmSync(recursive force)` 补齐（参照 regression R10/R5 形态）；自检 19/19 过，修复后运行 Temp/hc-b4-* 计数不增（现存 4 个系修前遗留，见自裁 5） | r2 |
| N4 | CHANGELOG 与 RESIDUALS「4,835,000 派生+90min 裕量」类表述→「单源推导 4,835,000ms，×1.117 裕量取 90min（5,400,000ms）档」（防加法误读；scripts/regression.mjs:397 内联注释原表述已正确不动） | r2 |
| W1 | SKILL.md 修订记 v1.7 行与 CHANGELOG v1.7 条「七笔 commit」→「九笔 commit」（实=9b6bac9/d3d7adc/919f27a/2c91ddd/3f0c080/58fb979/67a60e1/b76efd7/6edffa2）；CHANGELOG 追加勘误注记一条（不重写旧文其余部分） | r2 |
| 主控移交 | health-scan.mjs :10/:104「06 §8.6」→「02 §8.6」（三段通道真源=references/02 §8.6）；RESIDUALS 新增 closed 行 evolve-healthscan-86ref（来源=主控移交+b7 自检引出；处置=本轮回炉闭合）；check-anchors 复扫 WARN×0/FAIL×0（新指目标 §8.6 存在性过） | r2 |
| E1 表勘误 | 历史件禁改写——E1 报告 §4 throw 点穷举表正文未动，勘误见本报告 §2 | （本报告） |

commit r2 = 见 git log（`fix(evolve-rework-r2): W1/W3/N1-N4+移交项 文档与自检面`）。

## 2. E1 §4 表勘误（B1 引出；历史件不改写正文）

E1 报告（scripts/audits/2026-09-16_evolve-e1-report.md）§4「throw 点穷举表」列
uncaughtException 面 9 点，**漏第 10 点=cliMain 顶层装载**：`cliMain` 首行
`readJson(REGISTRY_PATH)`（--list-roles/--list-sources/派发路径共用，先于 loadOrgConfig
执行）为裸调用无 ConfigError 包装——坏/缺 registry.json 时抛普通 SyntaxError，
classifyExitCode 无 exitCode 属性判 1，与 06 §5.8「配置/装载错=3」不符。同表第 1 点
（loadRole→readJson 包装）给了「registry.json JSON 损坏→3 已覆盖」的假象，实为同文件
第二装载点漏包。B1 本轮补包闭环（§4 表勘误口径：表计 9 点应为 10 点，第 10 点=cliMain
顶层 registry 装载，exit 3；另第 1 点同位置的 `registry.roles[roleId]` 裸取对
roles:null/非对象形态产 TypeError（exit 1）亦表内无载，B1 一并补前置校验 ConfigError）。

## 3. W3 处置明细与保留清单（呈终审裁决岗背书）

逐件对照 references/06 §5.8 总表（实读）：

| 件 | 原碎片 | §5.8 覆盖判定 | 处置 |
|---|---|---|---|
| scripts/ds-call-v2.mjs | 「exit 2=exhaust 系本件专用行、4=输出写失败时响应已落账主控禁重试」 | 行 2 已载「源链耗尽 exhaust（派发器专用）」——**已覆盖削**；行 4 载「本地 IO 错（输出写失败等——远程调用已发生语义不回滚）」，grep 全 06 无「禁重试/重复计费」注记——**禁重试指令未载** | 削 exit 2 半边；保留一句（exit 4 禁重试） |
| scripts/check-hardcode.mjs | 「5=降级运行系总表本件专属行」 | 行 5 已载降级运行+适用=check-hardcode | 削成纯指针 |
| scripts/check-anchors.mjs | 「golden 缺失=3 属总表配置/装载错类」 | 行 3 已明载「golden 缺失」 | 削成纯指针 |
| scripts/regression.mjs | 「R2b 派发器装载路异常计入 FAIL 汇总（exit 1），不单独 3」 | 行 1 载自检断言失败=1（「exit 1」半边已覆盖削）；「配置类异常在回归件计 FAIL 汇总不单独退 3」的聚合口径总表未载（行 3 适用=全部的 blanket 规则下，本件此点为显式偏离） | 保留一句（聚合口径） |
| scripts/init-defenses.mjs | 「预算自检 FAIL 先回滚再退（exit 1）」 | 行 1 载自检断言失败=1（「exit 1」半边已覆盖削）；「先回滚已落盘项再退」的回滚动作总表未载 | 保留一句（回滚语义） |
| scripts/log-triage.mjs | 「RED 检出/自检失败/非法 --date 用法拒均属总表 1 类」 | 行 1 三类逐一已载 | 削成纯指针 |

**保留清单（3 处，均一句以内，呈终审裁决岗背书或改判）**：
1. ds-call-v2：exit 4=输出写失败时响应已落账、主控禁重试（防重复计费——总表行 4
   仅载「远程调用已发生语义不回滚」，禁重试指令未载）。
2. regression：R2b 派发器装载路异常计入 FAIL 汇总、不单独退配置错（总表对回归件
   未载此聚合口径）。
3. init-defenses：预算自检 FAIL 先回滚已落盘项再退（回滚动作总表未载）。

机检旁证：C1 两式 grep（`退出码.*：.*[0-9]+=` 宽式与 `退出码[：:].*[0-9]=` 严式）
改后均 0 命中（保留句均避「退出码…：…数字=」形态）。另：health-scan/org-config/
skill-gc 三件头注仅余 b8 式「此处不复写数字=语义映射」免责短语（无数字=语义碎片），
不在简报 W3 六处清单内，未动。

## 4. 验证证据（红→绿+变异红证+终态门禁）

证据源=同目录 `2026-09-16_evolve-rework-log.md`（全部真退出码）。要点：

- **B1 红**（向量先落、代码未修）：`regression --only R10`→`④B1向量:✗ 坏JSON→exit=1(期3)/
  roles:null→exit=1(期3)`，exit=1——坐实现行两处均落 uncaughtException→exit 1。
- **B1 绿**（ds-call-v2 修后）：同命令→`④B1向量:全过 坏JSON→exit=3(期3)/[fatal]=true；
  roles:null→exit=3(期3)/[fatal]=true`，exit=0。
- **变异红证 1 例**：临时撤 cliMain 顶层包装（还原裸 readJson）→坏 JSON 向量翻红
  （exit=1）而 roles:null 向量保持 3（其守卫在 loadRole，独立于被撤点）——证向量
  钉住 cliMain 装载点非恒真；证毕还原复绿。
- **N1**：`log-triage --date foo`→一行 [usage]+exit 1（process.exitCode=1+return
  自然退出形态）；`--self-test` 全过 exit 0；`--date 2026-09-16 --health` 正常路径
  exit 0（run() 包装无回归）。
- **N3**：`check-hardcode --self-test` 19/19 过 exit 0；修复后运行 Temp/hc-b4-* 计数
  不增（4→4，现存 4 个系修前 23:22-23:23 遗留）。
- **移交项**：health-scan 内 `06 §8.6` 0 命中；check-anchors 全扫 WARN×0/FAIL×0。
- **W1**：`九笔 commit` 命中=CHANGELOG 2（v1.7 已正+v1.6 既有条）/SKILL 1；
  `七笔 commit` 余 1=CHANGELOG 勘误注记内引述笔误原文（有意）。
- **终态门禁（r2 时点全量复跑）**：regression **8/8 过（R1 SKIP）** exit 0 +
  check-hardcode **命中 0（豁免 33）** exit 0 + check-anchors **WARN×0/FAIL×0** exit 0 +
  health-scan **RED×0/WARN×2（基线存量不劣化）** exit 0。

## 5. 自裁申报（逐条）

1. **W1 执行形态**：简报「CHANGELOG v1.7 条与 SKILL.md 修订记 v1.7 行中七笔→九笔
   （CHANGELOG 追加勘误注记一行，不重写旧文）」存在两读（仅注记 vs 就地最小修+注记）。
   采后者：两处计数就地最小修+CHANGELOG v1.7 条末追加勘误注记一条（同时载明 N4
   表述勘误），其余原文零改写——与 08 §3「不改写」红线的相容性以「勘误性最小修+
   注记留痕」形态保住，注记内引述笔误原文备查。
2. **W3 保留句措辞**：保留三句按「总表未载的增量语义一句化」重写（原句含已覆盖的
   数字半边，如「（exit 1）」），非逐字保留原碎片；判据与保留清单呈 §3 终审。
3. **RESIDUALS 修订记追加回炉轮一行**（简报未明示）：与本册「处置留痕」纪律及
   历批惯例一致，载明本册三处变动（closed 1 行+N2 追加+N4 勘误）。
4. **log-triage 主流程包 run() 导致全块缩进重排**（约 150 行 +2 缩进）：return 须
   函数体承载的必要形态，语义零变化，diff 丢字校验（comm 双列比对）确认除预期
   改动外无语义损失；先例=d3d7adc cliMain（E1 自裁 4 同型）。
5. **修前遗留 4 个 hc-b4-* 临时目录未清理**：位于 OS temp 区（技能根外），按白名单
   纪律不越权清理；N3 修复后零新增零残留已实证，遗留目录随 OS temp 生命周期处置。
6. **audits 档不入 commit**：沿 evolve 批惯例（简报两笔 commit 范围=代码面+文档面，
   回炉 log/报告留盘不入库；git status 中为未跟踪态）。
7. **B1 roles:null 端到端向量依赖本机宿主配置**（loadSources 前置于 loadRole）：
   与 R2b/R5 同基线（evolve-m5-regenv 在册设计取舍），非新引入耦合。

## 6. 门禁终态声明

regression 8/8（R1 SKIP 配给保护）+check-hardcode 命中 0（豁免 33）+check-anchors
WARN×0/FAIL×0+health-scan RED×0/WARN×2（基线存量不劣化）+C1 两式 0 命中。两笔 commit
（0c6384b+r2）未 push。承接移交=下批 R10 扩向量（RESIDUALS evolve-b1-transportresidual
处置列已载）。

MODEL-SELF: model-field:builtin:bigmodel-coding-plan/GLM-5.3
LEDGER-CLAIM: role=ops-executor executor=model-field:builtin:bigmodel-coding-plan/GLM-5.3 units=2 outcome=done
