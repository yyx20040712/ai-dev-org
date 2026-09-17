# g3 批门二裁决包（异构裁决位——自包含，禁访包外）

## 0. 裁决指令

你是门二裁决部（ops-adjudicator）。对 g3 批（v1.7.6 三残留清偿）执行终审裁决：对门一三轮发现（首轮 B=0/W=3/N=6；复审 B=0/W=1/N=3；微确认 B=0/W=0/N=1）与门二实证矩阵（8/8）逐条裁决 CONFIRMED/REJECTED/ESCALATED；对批整体给 VERDICT=放行|有条件放行|返工+回炉建议（如需）。独立复算要点任选两处（如：deriveHostFacts 匹配规则推演、cliFlag 三校验边界、W1-r1 不可达定性）。假设拷问：对包内主控预裁 P1（W7 副本收编）与 R2 守卫后移自裁各给一句 verdict。末尾机读尾栏：
```
FINDINGS: B= W= N=
VERDICT: 放行|有条件放行|返工
```

## 1. 批上下文

- 三工作项=evolve-l4-flags（cliFlag 用法错校验）/deploy-hostfacts-split（--install 派生项目覆盖件 org-config）/evolve-struct-glossary（references/00 术语件 60 条七组）。白名单=五脚本+00 件+SKILL.md 一行+DEPLOY.md §2/§3。基线 HEAD=cd2d751。
- 主控预裁 P1~P9 见任务书（§2 内联）。

## 2. 任务书全文

# g3 批任务书（v1.7.6 三残留清偿：cliFlag 用法错校验 / deploy 覆盖件派生 / 术语 00 件）

> 主控→实现者（ops-executor）。本件=自包含任务书，领单后按「必读序」读档后开工。
> 批型=实现批+文档批复合；基线 HEAD=cd2d751（工作树清洁，主控已核）。

## 1. 身份与禁令

- 你的身份：实现者（ops-executor）。领单号=g3（2026-09-17，v1.7.6）。
- 禁令：禁派子代理；禁越下方白名单改任何其他文件；禁碰 git 提交面
  （commit 由主控收口执行——你只改文件+跑命令+写报告）；禁改 RESIDUALS.md
  与 CHANGELOG.md（主控收口面）；禁改 scripts/roles/** 与 .golden/**
  与 org-config.default.json；禁伪造测试输出——红证实录贴原文。
- 卡点即停：任务书自相矛盾、或基线数字对不上（环境配错）→ BLOCKED 停手
  申报，不自裁。

## 2. 必读序（逐件列路径+看什么）

1. `references/06 §5.8`（scripts 同目录上级 references/06-model-routing.md）——
   退出码总表：本批 UsageError=exit 1 的契约依据；各脚本头注指针化惯例。
2. `scripts/org-config.mjs`（全文 177 行）——cliFlag 现状（:88 单行无校验）、
   readHostConfig/validateProviders（b2 派生函数复用其命中语义）、
   --self-test 向量风格（b1 红证落点）。
3. `scripts/deploy-check.mjs`（全文 296 行）——--install 现两动作（:182-207）、
   runChecks ③（:148-154 org-config validate FAIL 时的处置指引文案=派生
   功能的痛点来源）、--self-test fixture 风格（mkdtemp，禁动真实状态）。
4. `scripts/ds-call-v2.mjs` :352-364 ——本地 flag 副本（W7 豁免件，本批收编，
   见预裁 P1）；:44 已有 org-config.mjs import 行（收编=加一标识符）。
5. `scripts/log-triage.mjs` :51-52/:225 与 `scripts/regression.mjs` :33-37
   ——cliFlag 消费点（flag 包装）；regression R8 块 :230-235（本批扩展点）。
6. `RESIDUALS.md` 三行：evolve-l4-flags / deploy-hostfacts-split /
   evolve-struct-glossary——本批三工作项的登记原文（处置列=验收口径）。
7. `references/08-doc-governance.md` §1/§3——b3 术语件的分层纪律（索引件
   非真源）与历史件红线（禁改任何既有 .md 的历史叙述）。
8. `SKILL.md` 加载地图节 + `DEPLOY.md` §2/§3——b3/b2 的联动改动面。
9. 工程技能默认用：TDD（红→绿→变异红证）与完成前验证（收工前全量自检）
   ——不另加载文件，按纪律执行。

## 3. 预裁决（票面范围工程歧义逐条，你不再自裁这些点）

- **P1（b1 裁决申报）**：ds-call-v2.mjs 本地 flag 副本收编为 org-config
  cliFlag 单源 import。依据：W7「分发单元自包含」豁免前提已过时——该件
  :44 已从 org-config.mjs import 六个标识符，自包含既已破，副本=纯双源面
  （A3）。收编后 org-config.mjs:86-87 注释中「ds-call-v2 豁免」句同步改写
  为「已收编（g3 批，W7 前提过时）」。此为主控预裁+申报（D4 无先例可逆类），
  报告中如实登记。
- **P2（b1 语义）**：cliFlag 三校验——①同名 flag 出现≥2 次=用法错；
  ②flag 居末位（无值）=用法错；③下一 token 以 `--` 开头（值形如 flag）
  =用法错。形态=throw UsageError（新类型，org-config.mjs 导出，Error 子类，
  不带 exitCode 属性——消费点显式 catch 后 `console.error('[用法错] …')`
  +process.exit(1)；不 catch 则 Node 自然退 1，同为契约内）。缺席（flag
  不在 argv）仍返回 null=现语义不变。单 `-` 开头值（如负数）不算 flag 形态，
  放行。
- **P3（b1 消费点接线）**：org-config.mjs 自身 main 的 `--project` 裸 indexOf
  解析（:134-136）改走 cliFlag；log-triage/regression/deploy-check 的
  flag 解析段各加 try/catch→exit 1；ds-call-v2 删本地副本改 import。
  glm-look.mjs 的自研解析形态不属本批范围（残留原文只点名 cliFlag 面与
  三消费点）——报告「疑虑」节可注记观察，不改。
- **P4（b2 授权边界）**：派生只在 `--install` 显式调用时发生=用户授权形态；
  覆盖件已存在→绝不覆盖（打印提示跳过）；零命中→不写文件+明确指引行
  （指向 DEPLOY §3 手工路径）；全部命中且值与默认件完全一致→不写文件
  （打印「宿主事实与默认件一致——无需覆盖件」），避免本机产生冗余件。
- **P5（b2 匹配规则）**：deriveHostFacts(defaultCfg, hostCfg) 纯函数——
  对 defaultCfg.providers 每别名：在宿主 provider 注册表中按 `p.name ===
  entry_name` 找命中；唯一命中→派生 {uuid_prefix: id 前 8 字符,
  entry_name}；零命中→unmatched；≥2 命中→ambiguous（歧义不猜，列入
  指引）。附带产出 hostUnconsumed（宿主有而默认件未用的条目名=候选信息）。
  写盘形态：`<SKILL_ROOT>/.zcode/org-config.json`（.zcode/ 已 gitignore，
  机局部不入库），JSON 带 note 字段声明「deploy-check --install 派生件——
  用户配置域，装后可自由改写」+派生规则一句。派生后必须落盘回读：spawn
  org-config validate（runChecks ③ 已有路径自然复跑）真退出码实录。
- **P6（b3 件性质）**：references/00-glossary.md=**索引件非真源**（08 §1
  层层递进的 A3 要求）——每条=术语+一句白话+权威指针（NN §M 形态）；件头
  显式声明「定义冲突时以指针目标为准」。禁在 00 件内复写任何完整条款、
  禁落 live 事实（实配模型名/端点——check-hardcode --strict 在 pre-commit
  钩子里跑，写错即被拦）。含「新手上手图」节（阅读顺序：SKILL.md→00→
  按批次类型入口）。
- **P7（b3 术语清单）**：按七组收录（组织与岗位/管道与批次/审计与烤验/
  模型路由与额度/账本与登记/文档治理/机器强制），总量 45~60 条；具体词条
  由你从 SKILL.md+references 正文提炼，每条指针必须真实存在（写完跑
  check-anchors 自证）。SKILL.md 加载地图节首列加「00 术语速查+新手上手图
  ｜」一段（只动这一行级）。
- **P8（回归覆盖）**：R8 由「log-triage --self-test 单点」扩为三脚本自检
  套件（org-config --self-test / deploy-check --self-test / log-triage
  --self-test 各自 exit 0 且输出含「全过」）——R8 id 不变、detail 扩述。
  b1 向量落 org-config --self-test（≥5 条：重复/末位缺值/值形如 flag/
  正常取值/缺席返回 null）；b2 向量落 deploy-check --self-test（纯函数
  注入 fixture：唯一命中派生/零命中/双同名歧义/hostUnconsumed 归集/
  全一致不写盘判定函数）。
- **P9（行为变化申报面）**：以下原静默回退行为改为 exit 1——deploy-check
  `--agents-dir` 缺值时不再回退默认目录；log-triage `--hours/--date/--project`
  缺值不再按 0/null 静默处理；regression `--only/--project` 同理；ds-call-v2
  `--role/--source/--project` 缺值不再走「无 --role 报错」外的静默路径。
  这些是收敛非破坏（fail-fast），报告「行为变化」节逐条列明，主控汇总入
  CHANGELOG。

## 4. 纪律（TDD+验证口径）

- 红→绿→变异红证：先写自检向量（对现状=红：如重复 flag 现返回首值不抛
  错→向量期 FAIL）→实现→绿；变异红证任选一点（如临时注释掉重复检测
  →对应向量变红→还原）。红证实录=贴命令与输出原文进报告，`echo exit=$?`
  落盘真退出码。
- 实现顺序建议：b1（org-config cliFlag+UsageError+向量）→ b1 接线
  （四消费点+ds-call-v2 收编）→ b2（deriveHostFacts+install 动作③+向量
  +DEPLOY.md）→ R8 扩展 → b3（00 件+SKILL.md 一行）→ 全量自检。
- 每完成一面跑：`node scripts/org-config.mjs --self-test`、
  `node scripts/deploy-check.mjs --self-test`、
  `node scripts/regression.mjs`（终态须 8/8+SKIP R1）、
  `node scripts/check-anchors.mjs`（扫描面将 11→12 件，WARN/FAIL 均须 0）、
  `node scripts/check-hardcode.mjs`、`node scripts/health-scan.mjs`
  （RED=0）。真退出码逐条实录。
- 注意宿主 Node=v25.2.1（受禁系）：自检/mock 路径不受影响照跑；如遇
  ds-call-v2 退出阶段崩溃样体征（输出已完成+非零退出）按 RESIDUALS
  HOST-node25 口径判读（输出为准），勿反复重跑烧时间。

## 5. 基线数字（执行者自检参照——对不上=环境配错，停手申报）

| 项 | 基线值 |
|---|---|
| 基线 HEAD | cd2d751（工作树清洁） |
| cfg 哈希 | cfg:20254429f008（org-config hash；b2 不改默认件与配置→哈希不应变） |
| regression | 8/8 过 + SKIP R1（未给 --r1） |
| check-anchors | 扫描面 11 件，WARN 0 / FAIL 0 |
| check-hardcode | 命中 0（白名单豁免 36 处/14 条规则） |
| health-scan | RED 0 / WARN 2 |
| org-config --self-test | 全过 10 向量 |
| deploy-check --self-test | 全过（现向量数自数） |
| 账本/流水行数 | 111 / 1551（health-scan 回显口径） |

## 6. 报告契约

全文落 `scripts/audits/2026-09-17_g3-impl-report.md`，含八节：
①执行摘要（三工作项×状态）②文件清单（逐件：路径+改动要点+行数变化）
③红证（TDD 红实录）④绿证（全量自检输出+真退出码）⑤变异红证
⑥行为变化申报（按 P9 逐条）⑦自裁申报（凡任务书未明示而你自行决定的
点，含 P1 收编的执行细节；删减面 diff 自查）⑧疑虑（含 glm-look 观察）。
回复主控五行内（状态+报告路径+最大疑虑）。

## 7. 运行时可观察性

- b1/b2：新校验与派生的可观察形态=stderr `[用法错]`/`[install]` 行+退出码
  （0/1），且 org-config/deploy-check --self-test 向量数在汇总行可数。
- b3：check-anchors 扫描面计数 11→12 即 00 件入扫的自证；SKILL.md 加载
  地图行含「00」可 grep。
- R8：detail 串列三脚本各自「全过」字样。

## 附：白名单（仅下列文件可写）

```
scripts/org-config.mjs
scripts/deploy-check.mjs
scripts/log-triage.mjs
scripts/regression.mjs
scripts/ds-call-v2.mjs
references/00-glossary.md          # 新建
SKILL.md                            # 仅加载地图一行级
DEPLOY.md                           # 仅 §2/§3 相关段
scripts/audits/2026-09-17_g3-impl-report.md  # 报告
```

禁改面（命中即停）：其余一切；尤其 RESIDUALS.md / CHANGELOG.md /
scripts/roles/** / scripts/.golden/** / org-config.default.json /
references/01~09 / templates/**。

## 3. 实现报告全文（含回炉轮 1/2 节）

# g3 批收工报告（v1.7.6 三残留清偿——实现者填报）

> 领单=g3（2026-09-17）。基线 HEAD=cd2d751，开工核基线全部对上（§5 表八项，
> 逐项见④）。禁令遵守：未派子代理；未碰 git 提交面（commit 由主控收口）；
> 未改 RESIDUALS.md/CHANGELOG.md/scripts/roles/**/.golden/**/org-config.default.json/
> references/01~09/templates/**；红/绿/变异证据均为命令实录原文。

## ① 执行摘要

| 工作项 | 残留登记 | 状态 |
|---|---|---|
| b1 cliFlag 用法错校验（UsageError+三校验+四消费点接线+ds-call-v2 收编） | evolve-l4-flags | DONE（收编=主控预裁 P1，执行细节见⑦） |
| b2 deploy 覆盖件派生（deriveHostFacts+install 动作③+DEPLOY.md） | deploy-hostfacts-split | DONE |
| b3 术语 00 件（references/00-glossary.md+SKILL.md 加载地图一行） | evolve-struct-glossary | DONE（59 词条七组；check-anchors 扫描面 11→12 自证） |
| 附带 R8 扩展（三脚本自检套件，P8） | ——（预裁范围） | DONE（R8 id 不变，detail 扩述） |

## ② 文件清单（全部在白名单内；git status 实测=7 改+1 新建，无越权面）

| 文件 | 改动要点 | 行数变化 |
|---|---|---|
| `scripts/org-config.mjs` | 新增 UsageError 类（Error 子类，无 exitCode 属性）；cliFlag 重写为三校验（重复≥2 次/居末位无值/下一 token 以 -- 开头均 throw UsageError；缺席仍返 null；单 - 开头值放行）；:86-87 注释按 P1 改写为「已收编（g3 批，W7 前提过时）」；main 的 --project 裸 indexOf 改走 cliFlag（try/catch→[用法错] exit 1）；--self-test 增 g3 向量 7 条（10→17） | 177→221（+44） |
| `scripts/deploy-check.mjs` | --agents-dir 缺值不再 `|| DEFAULT_AGENTS_DIR` 静默回退→[用法错] exit 1；新增导出纯函数 deriveHostFacts（按 entry_name 唯一命中派生 uuid_prefix=id 前 8 字符；零命中→unmatched；≥2→ambiguous；附带 hostUnconsumed）/hostFactsDiffer（全一致=false 不写盘判定）/installHostFacts（已存在绝不覆盖/有 unmatched·ambiguous 不写+指引 DEPLOY §3/全一致不写/否则写盘+落盘回读复核）；--install 增动作③（授权=仅显式 --install；宿主配置不可读=跳过+指引不阻断）；头注「仅两动作」→「三动作」+[install] 横幅同步；--self-test 增 g3 向量 10 条（16→26，fixture=mkdtemp 禁动真实状态） | 296→448（+152） |
| `scripts/log-triage.mjs` | import UsageError；--date 顶层解析包 try/catch、run() 调用包 try/catch（--hours 在 resolveWindow 内抛）→[用法错]+process.exitCode=1 自然退出形态（本件 HOST-node25 纪律不强杀）；P9 面=--hours/--date（--project 见⑦自裁 3） | 383→405（+22） |
| `scripts/regression.mjs` | import UsageError；--only/--project 解析包 try/catch→[用法错] exit 1（only 单次取值，重复由 cliFlag 抛）；R8 由 log-triage 单点扩为三脚本套件（org-config/deploy-check/log-triage 各自 exit 0 且输出含「全过」；log-triage 另持验收断言=C2 沿袭；R8 id 不变、timeout 5s→30s 适应三件串跑） | 471→498（+27） |
| `scripts/ds-call-v2.mjs` | P1 收编：本地 flag 副本（原 :353-356）删除，import 行增 cliFlag+UsageError（现引 org-config 八标识符）；--role/--source/--project/--mock-source 解析包 try/catch→[用法错] exit 1；positional 过滤与其余逻辑不动 | 513→522（+9） |
| `references/00-glossary.md` | 新建（b3）：索引件非真源，件头声明「定义冲突时以指针目标为准」；新手上手图（SKILL.md→00→按批次类型入口）；七组 59 词条（组织与岗位 9/管道与批次 10/审计与烤验 10/模型路由与额度 10/账本与登记 7/文档治理 9/机器强制 5）——总量落在 P7 的 45~60 带；零 live 事实、零完整条款复写 | 新建 112 行 |
| `SKILL.md` | 加载地图节首列加「00 术语速查+新手上手图 ｜」一段（仅此一行级，:89） | 153（净 +0 行，行内扩） |
| `DEPLOY.md` | §2 首装「仅两动作」→「仅三动作」（序号=对应检查项 ④/⑤/③）+动作③一句；§3 增自动化路段（派生规则+四护栏+永不改不入库重申）。仅动 §2/§3 | 70→80（+10） |
| `scripts/audits/2026-09-17_g3-impl-report.md` | 本报告 | 新建 |

git diff --stat 实录：7 files changed, 302 insertions(+), 37 deletions(-)
（另：scripts/model-routing-log.jsonl 因复跑 regression R5 mock 演练自然落账
+45 行——该件 gitignore（.gitignore:2）机局部不入库，非本批手改面，见⑦-6。）

## ③ 红证（TDD 红实录——向量先行，对现状=FAIL）

b1 红（向量先落 org-config --self-test，实现未动）：

```
$ node scripts/org-config.mjs --self-test > /tmp/g3-red-b1.txt 2>&1; echo exit=$?
exit=1
FAIL g3 cliFlag：同名 flag 出现≥2 次→UsageError
FAIL g3 cliFlag：flag 居末位（无值）→UsageError
FAIL g3 cliFlag：下一 token 以 -- 开头（值形如 flag）→UsageError
FAIL g3 cliFlag：UsageError 不带 exitCode 属性（消费点显式 exit 1）
self-test 4 项失败
```
（另 3 条向量——缺席返 null/正常取值/负数放行——红期即 PASS=现语义保持面。）

b2 红（向量先落 deploy-check --self-test，函数未落→typeof 守卫 FAIL 不崩）：

```
$ node scripts/deploy-check.mjs --self-test > /tmp/g3-red-b2.txt 2>&1; echo exit=$?
exit=1
FAIL g3 派生：唯一命中→{uuid_prefix:id 前 8 字符, entry_name}
FAIL g3 派生：零命中→unmatched（不猜）
FAIL g3 派生：同 entry_name≥2 命中→ambiguous（歧义不猜）
FAIL g3 派生：hostUnconsumed 归集（宿主有而默认件未用的条目名=候选信息）
FAIL g3 判定：全命中且值与默认件完全一致→hostFactsDiffer=false（不写盘）
FAIL g3 判定：uuid 前缀漂移→hostFactsDiffer=true（须派生覆盖件）
FAIL g3 install：installHostFacts 已导出（红态=函数未落）
self-test 7 项失败
```

R8 扩展的红面由 b1 变异窗口双证承载（变异一使 org-config 自检 exit 1→扩展后
R8 即 FAIL，见⑤），不另设人工红（P8 定义 R8=聚合面，其断言对象即两处向量）。

## ④ 绿证（全量自检输出+真退出码；开工基线核对亦在此）

开工基线核对（§5 表逐项，全部对上）：HEAD=cd2d751 ✓（工作树仅任务书未跟踪件
=主控所落，与「主控已核」一致）；cfg:20254429f008 ✓；regression 8/8+SKIP R1 ✓；
check-anchors 扫描面 11 件 WARN 0/FAIL 0 ✓；check-hardcode 命中 0（豁免 36 处/
14 条规则）✓；health-scan RED 0/WARN 2（账本 111/流水 1551）✓；org-config
--self-test 全过 10 向量 ✓；deploy-check --self-test 全过 16 向量 ✓。

收工全量（终态）：

```
$ node scripts/org-config.mjs --self-test；echo exit=$?
self-test 全过（17 向量）          exit=0
$ node scripts/deploy-check.mjs --self-test；echo exit=$?
self-test 全过（26 向量）          exit=0
$ node scripts/log-triage.mjs --self-test；echo exit=$?
self-test 全过（23 PASS）          exit=0
$ node scripts/regression.mjs；echo exit=$?
PASS R8 log-triage:exit=0/全过=true/验收断言=true org-config:exit=0/全过=true deploy-check:exit=0/全过=true
regression 汇总：8/8 过，SKIP ×1（未跑项不计入通过数）（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）
                                   exit=0
$ node scripts/check-anchors.mjs；echo exit=$?
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=12 件）   exit=0
$ node scripts/check-hardcode.mjs；echo exit=$?
check-hardcode 汇总：扫 14 个 .md，命中 0 处（白名单豁免 36；词表=org-config 0 条+宿主注册表 4 条）   exit=0
$ node scripts/health-scan.mjs；echo exit=$?
health-scan 汇总：RED ×0 / WARN ×2（…账本行 111/流水行 1596/窗口 20…）——可收口   exit=0
$ node scripts/org-config.mjs hash；echo exit=$?
cfg:20254429f008                   exit=0   ← b2 未改默认件/未写覆盖件=哈希不变（§5 表口径）
$ grep -n "00 术语速查" SKILL.md
89:00 术语速查+新手上手图 ｜ 01 原理 A~E 五组 ｜ …   ← b3 联动可 grep（§7）
```

b2 真机派生实录（P5「派生后落盘回读：validate 自然复跑真退出码」）：实跑前先
干跑纯函数（只读）确认本机形态=三源唯一命中且值与默认件全同→hostFactsDiffer
=false（预期不写盘），再实跑：

```
$ node scripts/deploy-check.mjs --install；echo exit=$?
[install] 首装模式——三动作：④补缺失代理件 / ⑤hooksPath 未设时补设 / ③宿主事实派生项目覆盖件（护栏：不覆盖漂移件/不改 org-config.default.json 与宿主配置）
[install] install-agents——无缺失件（已存在漂移件不覆盖——保护本机定制）
[install] install-hook——core.hooksPath 已设=.githooks（不重复设置；自定义值属用户裁决面）
[install] install-hostfacts——宿主事实与默认件一致——无需覆盖件（不写，防本机冗余件）
[FAIL] node-major——当前 v25.2.1（主版本 25）∈ 受禁系（…）——改装受支持主版本后复跑
[ok] skill-files——必备 4 件齐（…）
[ok] org-config——validate 通过（validate PASS（3 源双校验通过，cfg:20254429f008））
[ok] agents——ops-adjudicator.md（…）sha256 相符 （其余五件同 [ok]）
[ok] hook——core.hooksPath=.githooks（提交门禁已挂）
[ok] remote——已挂（origin）
[ok] ledger-dir——SKILL_ROOT/.zcode/ 可写（账本目录就绪）
deploy-check 汇总：ok 11/warn 0/FAIL 1——阻断
exit=1
$ ls .zcode/org-config.json → No such file（覆盖件未产生=「全一致不写」护栏生效）
```

（exit=1 全由 node-major ①项——本机 Node 25 受禁系的既有如实告警，DEPLOY.md §0
明载该形态，非本批引入；③项 validate spawn 真退出码 0 已在行内。写盘路径行为由
自检 fixture 向量四条覆盖——已存在不覆盖/unmatched 不写/全一致不写/漂移写盘+回读一致。）

## ⑤ 变异红证（临时破坏→对应向量变红→还原→复绿）

变异一（b1 重复检测）：org-config.mjs 重复 throw 行临时注释
（`// MUTATION-g3: if (hits.length >= 2) throw …`）：

```
$ node scripts/org-config.mjs --self-test；echo st_exit=$?
FAIL g3 cliFlag：同名 flag 出现≥2 次→UsageError
self-test 1 项失败            st_exit=1
$ node scripts/regression.mjs --only R8；echo r8_exit=$?
FAIL R8 log-triage:exit=0/全过=true/验收断言=true org-config:exit=1/全过=false（输出尾：ror…
                               r8_exit=1   ← 扩展后 R8 对单脚本自检失守即红（P8 扩展的防假绿证明）
```
还原后：org-config --self-test 全过（17 向量）exit=0。

变异二（b2 歧义检测）：deploy-check.mjs deriveHostFacts 命中分支临时改
`hits.length === 1 || true`（歧义/零命中分支失效）：

```
$ node scripts/deploy-check.mjs --self-test；echo st_exit=$?
FAIL g3 派生：零命中→unmatched（不猜）
FAIL g3 派生：同 entry_name≥2 命中→ambiguous（歧义不猜）
FAIL g3 install：有 unmatched/ambiguous→不写文件（指引手工路径）
self-test 3 项失败            st_exit=1
```
还原后：deploy-check --self-test 全过（26 向量）exit=0。

## ⑥ 行为变化申报（P9 逐条——原静默回退改 exit 1，收敛非破坏）

| # | 脚本×flag | 原行为 | 新行为 |
|---|---|---|---|
| 1 | deploy-check --agents-dir 缺值 | `\|\| DEFAULT_AGENTS_DIR` 静默回退默认目录（假动作面） | [用法错]+exit 1 |
| 2 | deploy-check --agents-dir 值形如 flag/重复 | 取到 `--xx` 当目录/仅首个生效 | [用法错]+exit 1 |
| 3 | log-triage --hours/--date 缺值 | --hours→Number(undefined\|\|0)=0（按当日窗静默）；--date→null（同左） | [用法错]+exitCode=1 自然退出 |
| 4 | log-triage --hours/--date 值形如 flag/重复 | 误吃下一 flag 当值/仅首个生效 | 同上 exit 1 |
| 5 | regression --only/--project 缺值 | --only→null（全跑）；--project→process.cwd() 静默 | [用法错]+exit 1 |
| 6 | regression --only/--project 值形如 flag/重复 | 同上族静默 | [用法错]+exit 1 |
| 7 | ds-call-v2 --role/--source/--project/--mock-source 缺值 | --role→「--role 必填」err exit 1（文案改）；--source/--project→undefined/null 静默路径 | [用法错]+exit 1（文案与归因统一） |
| 8 | ds-call-v2 --mock-source 多点重复 | **仅首个生效**（v1.7.4 门二 A-1 实证形态——残留登记原文） | [用法错]+exit 1 |
| 9 | org-config --project 缺值/值形如 flag/重复 | 缺值→projectDir=undefined→装载 TypeError 裸崩；值形如 flag→被当目录名；重复→仅首个 | [用法错]+exit 1（不再裸堆栈） |
| 10 | deploy-check --install（新增动作③） | 无此动作（新机须手改默认件或手写覆盖件） | 三护栏见②（已存在不覆盖/不全命中不写+指引/全一致不写）；绝不改默认件与宿主配置 |
| 11 | R8（regression） | 仅聚合 log-triage --self-test 单点 | 三脚本套件各自 exit 0+「全过」（R8 id 不变，detail 扩述） |
| 12 | ds-call-v2 import 面 | 本地 flag 副本（双源） | 收编为 org-config cliFlag 单源 import（P1 预裁） |

以上均为 06 §5.8 行 1（用法/参数错）类目内收敛，请主控汇总入 CHANGELOG。

## ⑦ 自裁申报（任务书未明示而自行决定处，逐条）

1. **b2 部分命中的写盘判定**：P4 只明示「零命中→不写」与「全命中且一致→不写」，
   未明示部分命中（部分唯一命中+部分 unmatched/ambiguous）。自裁=有任何
   unmatched 或 ambiguous 即整体不写（与零命中同处置+指引）——理由：部分覆盖件
   无法清掉 ③项 validate FAIL（未覆盖别名仍持失效默认值），写了=冗余件+假动作；
   歧义不猜原则（P5）同向。已由向量「unmatched/ambiguous→不写文件」钉住。
2. **R8 timeout 5s→30s**：三脚本串跑（Windows 冷文件系统+mkdtemp fixture）余量。
   判定逻辑不变（各件独立 spawn+全过断言）。
3. **P9「log-triage --project」**：实查本件无 --project 消费点（grep 证据在执行
   记录；用法行仅 --date/--hours/--health/--self-test）——按实际消费面=--hours/
   --date 执行，P9 该点判为宽表述而非缺口。未新增 --project 支持（越权面）。
4. **ds-call-v2 用法错输出形态**：P2 允许「不 catch 自然退 1」，本批取显式
   try/catch+[用法错] 前缀（与四消费点一致、§7 可观察形态统一）；未走本件
   uncaughtException 的 [fatal] 路径（该路径留作兜底，语义同为 exit 1）。
5. **org-config 向量的红期防崩写法**：g3 向量用 `e?.constructor?.name ===
   'UsageError'` 判型而非 `instanceof`（红态类未定义时不 ReferenceError 崩自检，
   绿态判定等价）——向量内容红绿两态一致，非两套断言。
6. **流水行 1551→1596**：本批多次复跑 regression（基线核对/R8 扩展后/收工全量）
   R5 mock 全链演练按设计落账（mock 标记行）——实测 +45 行，均为 mock 行
   （R4 对账口径过滤面不变，health-scan 仍「可收口」）。该件 gitignore 机局部，
   非 git 提交面；如实呈报。
7. **deploy-check 头注/[install] 横幅文案**：动作③编号取「③」=对齐七项检查中
   其所服务的 org-config ③项（DEPLOY.md §2 同步用「序号=对应检查项」括注）
   ——P4/P5 未规定编号方案。
8. **00-glossary 词条选取与计数**：P7 给七组与 45~60 总量带、词条由执行者提炼
   ——实收 59 条（9/10/10/10/7/9/5），每条指针均已在册（check-anchors 扫描面
   12 件 WARN 0/FAIL 0 自证）；「账本（org-ledger）」指针取 02 §9（R7 已钉
   schema 单源指向该节，索引从之）。
9. **删减面 diff 自查**：git diff 逐件复核——无任何既有行被删除性改写（全部为
   追加/替换等义扩展；ds-call-v2 删除的仅为 P1 预裁明示的本地 flag 副本 4 行，
   其功能由 import 承接；log-triage/regression 的 const→let 重排为 try/catch
   包裹所需，取值语义不变）。SKILL.md 仅 :89 行内扩一段，无其他行触碰。

## ⑧ 疑虑（不改，供主控裁决/登记）

1. **glm-look.mjs 自研解析形态（P3 点名观察项）**：其 :231-236 为 argv 手写循环
   （`argv[++i]` 形态），与 cliFlag 同族的缺值/误吃 flag 缝仍在（如 `--prompt`
   居末位→undefined、值形如 flag 被吃）。残留原文只点名 cliFlag 面与三消费点，
   本批未动——建议随 evolve-l4-flags 处置列一并收口或另登记。
2. **b2 写盘路径的真机实证缺口**：本机属「全一致→不写」形态，真机写盘路径仅由
   fixture 向量证明（含回读复核）；新机首次 --install 的真写盘行为待真实异构
   环境验证（DEPLOY.md §3 已明示护栏与手工回退路）。
3. **R8 三脚本串跑的耗时面**：R8 现串行 spawn 三件自检（全量 regression 实测
   无感增量），若后续向量继续膨胀可议并行——非本批面。
4. **00 件的活度纪律**：索引件无独立机检钉「词条与指针目标语义不漂移」（锚
   存在性已机检，语义漂移靠 08 §4 体检）——P6 未要求，如实记疑虑。

## 回炉轮 1（2026-09-17，门一 PASS B=0/W=3/N=6——出件
scripts/audits/2026-09-17_g3-gate1-out.md，逐项对原文处置）

### 处置清单（批内修 4 项 ADDRESSED）

**R1=W2 ADDRESSED**——--install 动作③错误处置重构：installHostFacts 写盘段
（mkdir/write/readJson 回读）自包 try/catch，IO/回读抛错返回 `{level:'FAIL',
line:「install-hostfacts——覆盖件写盘/回读失败（<overPath>：<真因 e.message>）
——…（真因如上，非装载失败）」}`；调用方三源分行归因（org-config 装载失败
→warn 跳过+指引／宿主配置装载失败→warn 跳过+指引=现语义维持／installHostFacts
返回值→FAIL 计数）；FAIL 行以 `[FAIL]` 前缀打印、计入
`exitCodeFrom({failCount: sum.fail + installFailCount})`，汇总行加
`——另含 install 动作 FAIL ×N（计入阻断）` 注记。头注同步（错误处置两行）。

红证（向量先行，对现状=红）——写盘 IO 注入（父级为文件的路径→mkdir/write 必抛）：

```
$ node scripts/deploy-check.mjs --self-test；echo st_exit=$?
FAIL g3 install：写盘 IO 抛错→FAIL 结果带真因（不裸抛/不误归因装载失败）
self-test 1 项失败            st_exit=1
```

变异红证（W2 形态=临时还原旧笼统 catch，坏覆盖件注入 .zcode/org-config.json）：

```
[install] install-hostfacts——跳过：宿主配置装载失败（JSON 解析失败 C:\…\.zcode\org-config.json: …）
```
——org-config 的 JSON 错被误标「宿主配置装载失败」=门一 W2 指认的真因掩盖
形态实录；还原新结构后同注入输出正确归因行（见 R2 绿证）。

**R2=W3 ADDRESSED**——loadOrgConfig 入守卫+主 cfg 守卫后移。红证实测修正了
门一前提：坏覆盖件并不裸崩到 install 块的 oc 装载——更早的主 cfg 守卫先行
`[装载错] … exit 3`（install 三动作整场被跳过，「干净跳过行」不可达）：

```
$ node scripts/deploy-check.mjs --install；echo exit=$?
[装载错] org-config 装载失败：JSON 解析失败 C:\…\.zcode\org-config.json: …
exit=3      （三行 install 动作均未执行）
```

处置=install 块内 oc 装载包独立 try/catch（分行归因见 R1）+主 cfg 守卫
（runChecks 消费位）后移至 install 块之后——坏覆盖件时 install 三动作先执行、
③ 打印干净跳过行，再到守卫按装载错退 3（检查主体无 cfg 确不可跑，口径
06 §5.8 行 3，非静默）。绿证（同注入）：

```
[install] install-hostfacts——跳过：org-config 装载失败（JSON 解析失败 C:\…\.zcode\org-config.json: …）——处置=修复或移除 .zcode/org-config.json（用户域件）/核对默认件后复跑；手工路径=DEPLOY §3
[装载错] org-config 装载失败：JSON 解析失败 …    exit=3（无堆栈；注入件已即删）
```

**R3=W1+N4 ADDRESSED（勘误，不静默改写）**——
- 勘误一（⑦#8 与②节两处「59 条」）：应为 **60 条**（分组 9/10/10/10/7/9/5
  自加=60，与 00-glossary.md 交付物逐行一致——门一 W1 证伪成立）。P7 的
  45~60 带仍满足；属报告计数错误，原文按历史件纪律保留不动，以本勘误为准。
- 勘误二（⑦#9 行账）：ds-call-v2 除删本地 flag 副本（函数体 4 行）外，另删
  4 行 const 取值行（roleId/onlyAlias/projectName/mockSpec），由 let+try/catch
  块等价承接——门一 N4 指认的行账不严属实，「等价承接」语义不变。

**R4=N5 ADDRESSED**——补两条 install 向量（钉单分支）：仅 unmatched（无
ambiguous）→不写+指引（行含 none/歧义槽=无）；仅 ambiguous（无 unmatched）
→不写+指引（行含 ambi/零命中槽=无）。两向量对现状即绿（行为本正，属补钉
非修错——门一 N5 判「风险低」一致）。

### 不修维持 4 项（按门一/主控裁示，收口登记）

- N1 维持：log-triage 首 catch 无 instanceof 过滤——形态不一但无功能差（cliFlag
  现仅抛 UsageError），下轮卫生面。
- N2 维持：向量 constructor.name 判型——红态防崩自裁成立（⑦#5），绿态等价。
- N3 维持：deploy-check 自检 g3Differ 半红态 TypeError 不触发（两函数同批落地）。
- N6 维持：流水 +45/+30 行均为包外事实，已如实呈报（本轮复跑 regression R5
  mock 演练再 +30：1551→1596→1626，gitignore 机局部非提交面）。

### 回炉改动面与红绿态

改动仅 `scripts/deploy-check.mjs` 一件（+R1 内部 try/catch、调用方分行归因、
FAIL 计数、cfg 守卫后移、头注两行、自检向量 +3：26→29）与本报告追加节。
红态两处（R1 向量红/W2 变异红+R2 集成红）、绿态全量如下（真退出码实录）：

```
$ node scripts/org-config.mjs --self-test   → self-test 全过（17 向量）        exit=0
$ node scripts/deploy-check.mjs --self-test → self-test 全过（29 向量）        exit=0
$ node scripts/org-config.mjs hash          → cfg:20254429f008                exit=0
$ node scripts/regression.mjs               → 汇总：8/8 过，SKIP ×1            exit=0
$ node scripts/check-anchors.mjs            → WARN ×0 / FAIL ×0（扫描面=12 件） exit=0
$ node scripts/check-hardcode.mjs           → 命中 0 处（白名单豁免 36/14 条）  exit=0
$ node scripts/health-scan.mjs              → RED ×0 / WARN ×2 ——可收口        exit=0
$ node scripts/deploy-check.mjs --install   → ③「无需覆盖件」不写盘；汇总 ok 11/warn 0/FAIL 1（node-major 受禁系既有如实告警）exit=1；.zcode/org-config.json 不存在
```

### 新破坏扫描自查

- 调用方唯一消费点核毕：installFailCount 声明于 install 块前、消费于汇总后，
  非 --install 路径恒 0（汇总行/退出码与 g3 交付态逐字一致）。
- cfg 守卫后移的次序效应：非 install 路径行为不变（守卫与 runChecks 相邻）。
  实测两路径（坏覆盖件注入 `.zcode/org-config.json` 后即删）：
  ```
  $ node scripts/deploy-check.mjs（无 --install）；echo exit=$?
  [装载错] org-config 装载失败：JSON 解析失败 C:\…\.zcode\org-config.json: …
  exit=3          ← 与 g3 交付态一致（守卫后移未改非 install 路径终态）
  $ node scripts/deploy-check.mjs --agents-dir；echo exit=$?
  [用法错] flag --agents-dir 居末位无值（…）
  exit=1          ← flag 用法错先于装载错（守卫在 agentsDir 解析后=用法优先）
  ```
- 全量自检 7 项全绿（上节）；R2/R8/R9/R10 交叉面未触（regression 8/8 实证）。
- 白名单复核：git status=同 g3 交付 7 改件+00 件+本报告；新增未跟踪 2 件
  （g3-for-gate1.md/g3-gate1-out.md）=主控/门一产出，非本执行者写入。

## 回炉轮 2（2026-09-17，门一复审 PASS B=0/W=1/N=3 后唯一 W）

**事实定性（一行）**：R5=W1-r1 属**纵深防御**（evolve-b6 同族）——主控已落
机器事实：实装 readJson 对缺席文件必抛 ENOENT（readFileSync 语义），故
readHostConfig 返 falsy 的路径**当前不可达**；本修=补 else 分支消除 hf 未定义
的**理论暴露面**，非修活缺陷。

**改动**：仅 `scripts/deploy-check.mjs`——install 块 `if (hostCfg)` 补 else
（hf=warn 跳过行，真因一行含返回值描述+「实装缺席必抛 ENOENT 由装载失败行
承接」注记）+自检向量 1 条（26→29→**30**；hostCfg=null 注入 installHostFacts：
不裸抛+不写+指引行，全别名入 unmatched——最小落法取注入式，非调用面重构）。

**红证**（变异注入=缺陷形态实录：readHostConfig 位临时注 null，现行结构无 else）：

```
$ node scripts/deploy-check.mjs --install；echo exit=$?
（install 三行正常打印后——）
file:///C:/…/scripts/deploy-check.mjs:465
    if (hf.level === 'FAIL') installFailCount++
           ^
TypeError: Cannot read properties of undefined (reading 'level')
                                   exit=1（裸堆栈——hf 未赋值暴露面）
```

**绿证**（同注入复验，修复后）：同款 null 注入下 ③ 打印干净跳过行、无堆栈：

```
[install] install-hostfacts——跳过：宿主配置不可读/缺席（readHostConfig 返回 null——理论形态，实装缺席必抛 ENOENT 由装载失败行承接）——手工路径=DEPLOY §3
```

（注入行已即撤——grep MUTATION 计 0；正常路径不受影响。）

**复跑实录（真退出码）**：

```
$ node scripts/deploy-check.mjs --self-test → self-test 全过（30 向量）  exit=0
$ node scripts/regression.mjs               → 8/8 过，SKIP ×1             exit=0
  PASS R8 log-triage:exit=0/全过=true/验收断言=true org-config:exit=0/全过=true deploy-check:exit=0/全过=true
```

**零触碰自查**：git status 与回炉轮 1 交付面完全一致（7 改+00 件+报告+主控/
门一 3 件）；本轮改动面仅上述 else 分支+1 向量，其余零触碰。

MODEL-SELF: ops-executor bound
LEDGER-CLAIM: EXECUTOR=model-field:ops-executor

## 4. 门一三轮出件

### 首轮
# 门一隔离一审报告（ops-gate1-k1，源A）——g3 批 v1.7.6

> 审包=同目录 2026-09-17_g3-for-gate1.md（唯一输入，未触包外任何文件）。
> 行号=diff 后新件行号，由 hunk 偏移推算处标「约」。

## 一、规格符合性（对照预裁 P1~P9，逐条核验结论）

- **P1 收编**：ds-call-v2.mjs diff（@@ -45,7 / @@ -350,14+350,23）删本地 flag 副本、import 增 cliFlag/UsageError；org-config.mjs 约 :86-88 注释改写含「已收编（g3 批，W7 前提过时）」字样。**符合**。
- **P2 三校验**：org-config.mjs 约 :102-111——hits.length≥2 抛 / val===undefined 抛 / startsWith('--') 抛 / 缺席 null / 单 `-` 放行；UsageError（约 :90-96）Error 子类、仅设 name 不设 exitCode。**符合**。
- **P3 接线**：org-config main --project 走 cliFlag+try/catch（约 :158-168）；log-triage（约 :225-235、:391-405）/regression（约 :38-48）/deploy-check（约 :407-419）各加 try/catch→exit 1（log-triage 取 exitCode=1 自然退出，exit 码等价且⑥如实区分形态）；glm-look 仅观察未动，与 P3 授权一致。**符合**。
- **P4/P5 派生**：deriveHostFacts（约 :222-241）唯一命中/零命中/≥2 歧义/hostUnconsumed 四语义逐行对得上；installHostFacts（约 :257-282）已存在早退（:258-259）→unmatched/ambiguous 不写+DEPLOY §3 指引（:261-269）→全一致不写（:270-271）→写盘带 note+落盘 readJson 回读（:276-282）；仅 --install 分支调用（约 :422-435）。fixture 向量推演我逐条重算（uniq/none/ambi/E-Z(zzzzzzzz)/case1-4），断言期望值全部正确。**符合**。
- **P6/P7 术语件**：件头「定义冲突时以指针目标为准」在；无完整条款复写、无 live 事实；新手上手图=SKILL.md→00→批次入口；七组齐全；SKILL.md 仅加载地图一行加「00 术语速查+新手上手图 ｜」（hunk @@ -86,7+86,7 @@ 第 4 行=新 :89，与报告⑦#9「:89」互证一致）。**符合**（条数问题见 W1）。
- **P8**：org-config 向量 +7（≥5 要求满足：重复/末位/值形如 flag/正常/缺席全有）；deploy-check 向量 +10（五要求全覆盖）；R8（regression.mjs 约 :241-264）三脚本串跑、各 exit 0+「全过」、log-triage 保「验收断言」——旧断言未撤只加，**未弱化，符合**。
- **P9**：四脚本五条静默回退面均改 fail-fast，与⑥12 行逐条对得上（log-triage --project 缺口见假设 A4）。**符合**。

## 二、范围蔓延核验

diff 触 7 改件+1 新建，全在白名单内；DEPLOY.md 仅 §2/§3 两 hunk；SKILL.md 单行；禁改面（RESIDUALS/CHANGELOG/roles/.golden/org-config.default.json/references 01~09/templates）零触碰；cfg 哈希不变的前提（默认件未改）由 diff 佐证。**无蔓延**。

## 三、逐条发现

### B（阻断）——无

### W（非阻断缺陷）

**W1 实现报告条数自相矛盾且与交付物不符（报告诚实性）**。§4 ⑦#8：「实收 59 条（9/10/10/10/7/9/5）」——分组数自加=60；00-glossary.md diff 全文逐行数亦为 60（一9/二10/三10/四10/五7/六9/七5）。「59」与自身分组、与交付物双重矛盾。P7 的 45~60 带仍满足，属报告事实错误非规格违约。

**W2 --install 动作③ catch 误归因+降级（静默失败面）**。deploy-check.mjs 约 :430-434：try 同时包裹 `readHostConfig()` 与 `installHostFacts(...)`，后者内含 mkdirSync/writeFileSync/readJson 回读（:276-278）——写盘/权限/回读解析任一抛错，统统报成「install-hostfacts——跳过：**宿主配置装载失败**（…）」且 level=warn。本件 summarize 语义 warn 不阻断 exit 0（自检向量 s2 自证），写盘真因被掩盖、诊断被误导；installHostFacts 自有的「回读不符→FAIL」路径（:281-282）只接住干净不符，接不住抛错。

**W3 loadOrgConfig 置于守卫外，P4「打印提示跳过」路径存在不可达洞**。deploy-check.mjs 约 :428：`const oc = loadOrgConfig(SKILL_ROOT)` 在 try 之外。覆盖件属用户手改域（note 明示「装后可自由改写」），若覆盖件 JSON 损坏，异常在到达 installHostFacts 的 existsSync 早退（:258-259「绝不覆盖（打印提示）」）之前即裸崩堆栈，与 P4 授权形态相悖。readJson 是否抛缺=包内无源、**不确定**，但同段对 readHostConfig 的 try/catch 包装本身暗示可抛，守卫不对称是结构事实。

### N（观察/轻微）

**N1** log-triage.mjs 约 :229-233 首个 catch 未做 `instanceof UsageError` 过滤（catch(e)→g3UsageErr=e），与其余三消费点形态不一致；当前 cliFlag 仅抛 UsageError，无功能差。

**N2** org-config.mjs 约 :190-196 向量以 `e?.constructor?.name === 'UsageError'` 判型代 instanceof——红态防 ReferenceError 的自裁（⑦#5）成立，但判型强度弱于 instanceof；包内无第二个 UsageError 定义，绿态等价。

**N3** deploy-check.mjs 自检约 :372-374 `g3Differ(d2, fxDef2)` 在「deriveHostFacts 已落而 hostFactsDiffer 未落」的半红态下 TypeError 崩自检，与本件自述「FAIL 不崩」守卫惯例（:348-349 注释）不完全一致；两函数同批落地，实际不触发。

**N4** ⑦#9「ds-call-v2 删除的仅为…副本 4 行」计数不精确：diff @@ -350,14+350,23 另删 4 行 const 取值行（roleId/onlyAlias/projectName/mockSpec），由 let+try 等价承接；声明 gist 属实，行账不严。

**N5** ⑦#1 b2 部分命中自裁的 install 向量仅覆盖 unmatched+ambiguous 并存组合（case2，约 :384-386），未单测仅 unmatched/仅 ambiguous 两分支；代码为单条件 OR（:261），风险低。

**N6** ⑦#6 流水 1551→1596（+45 mock 行）包内无法核验（账本非包内材料）；已如实呈报、gitignore 非提交面。

## 四、假设拷问（verdict=证伪/未证伪）

1. 「00 件实收 59 条」→**证伪**（见 W1，双重矛盾）。
2. oc.overPath 即 `<SKILL_ROOT>/.zcode/org-config.json`（P5 写盘形态）→**未证伪**。包内无 loadOrgConfig 源；DEPLOY §3/00 件/P5 三方口径一致。
3. readJson/readHostConfig/loadOrgConfig 失败抛异常（W2/W3 前提）→**未证伪**（结构性成立：实现者自加 try/catch 暗示可抛；抛错语义本身包内不可裁，标不确定）。
4. 「log-triage 无 --project 消费点」（⑦#3，P9 宽表述判）→**未证伪**。包内 diff 面未见 --project 消费；grep 证据在包外执行记录，不可复核。
5. 「--hours 在 run() 内 resolveWindow 经 flag() 抛」（diff 注释 :388 块）→**未证伪**。包内无 resolveWindow 源；主控五条实测不含 --hours；run() 外包 catch 结构上可承接。
6. 「+45 行均为 mock 行」（⑦#6）→**未证伪**（包外事实，自报）。
7. 「check-anchors 扫描面 12 件 WARN 0/FAIL 0」（⑦#8）→**未证伪**。包内无运行原文；主控预验清单未列此项；00 件可交叉核的指针（06 §5.8、02 §9、08 §1/§3、07 §1/§2/§4 等）与任务书引用面无矛盾。
8. 红→绿→变异红证实录真实存在 →**未证伪**。§4 节选仅 ⑥⑦⑧，红/绿/变异节不在包内；主控已预验绿态（全量 exit 0+五条用法错路径 [用法错]+exit 1）。
9. cliFlag token 计数判重复不误伤合法 argv →**未证伪**（推演支撑：合法值必不以 `--` 开头，flag 名 token 居他 flag 值位的 argv 必已非法；与 P2 字面一致）。
10. 「删减仅副本 4 行」（⑦#9）→**证伪**（计数不精确，实质无害，见 N4）。
11. installHostFacts 首参取 oc.merged ≡ P5 的 defaultCfg →**未证伪**（推演：existsSync 早退保证派生只在覆盖件缺席时发生，此时 merged=default；00 件「默认件+项目覆盖件深合并」条目佐证口径）。

## 五、统计与总评

B=0，W=3，N=6。三工作项对 P1~P9 逐条符合，白名单零越界，新旧断言只加不撤且我逐条重算 fixture 期望值无误，主控预裁项无可推翻处。扣分面集中在：实现报告两处数字不严（W1/N4）与 --install 动作③的错误处置结构（W2 误归因降级、W3 守卫外装载）——后者建议回炉微修（loadOrgConfig 入 try、catch 内按 e 来源分行或 installHostFacts 内部自包写盘段），非阻断。总评：通过，建议 W2/W3 登记残留或随下批清偿。

FINDINGS: B=0 W=3 N=6
VERDICT: PASS
MODEL-SELF: model-field:b2466f8b-9d89-4428-a38e-c2aca1c41d0e/k3

### 回炉复审（r1）
见主控落档——内容如下（自复审回复原文）：

## 2. 实现报告回炉轮 1 节全文（处置+红证+自裁申报）

## 回炉轮 1（2026-09-17，门一 PASS B=0/W=3/N=6——出件
scripts/audits/2026-09-17_g3-gate1-out.md，逐项对原文处置）

（复审全文结论：五项 ADDRESSED+W1-r1 新发现——已由微确认闭合，见下）

### 微确认（轮 2）
处方符合性：符合——else 兜底使 hf 全路径赋值；新破坏扫描无；FINDINGS: B=0 W=0 N=1 VERDICT=PASS（N1=else 行无自检向量直钉，纵深防御语境可接受）。

## 5. 门二实证证据全文（ops-probe）

# g3 批门二实证证据（ops-probe 机械重跑面）

> 矩阵=scripts/audits/2026-09-17_g3-gate2-matrix.md；技能根=C:\Users\Administrator\.zcode\skills\ai-dev-org。
> 环境：Git Bash on win32 10.0.26200 x64；node v25.2.1；git 仓库根=技能根本身。
> 每条命令实录 `命令；echo exit=$?`。进度：item1-8 全部完成（尾栏见文末）。

## 1. 自检三件

### 1a. org-config 自检

```
$ node scripts/org-config.mjs --self-test; echo exit=$?
PASS 对象逐字段覆盖+未提及沿用
PASS 数组整体替换
PASS 显式 null=删除
PASS null 于新增键=不新增
PASS 哈希键序无关
PASS 哈希剔 null（对象键）
PASS 哈希剔 null（数组元素，顺序保留）
PASS b4 null provider→校验错误行（不崩）
PASS b4 近邻提示 null 宿主条目不崩（near?.[1]?.name）
PASS b4 健康源不受 null 条目影响（live 双校验通过不出错行）
PASS g3 cliFlag：缺席→null（现语义不变）
PASS g3 cliFlag：正常取值
PASS g3 cliFlag：同名 flag 出现≥2 次→UsageError
PASS g3 cliFlag：flag 居末位（无值）→UsageError
PASS g3 cliFlag：下一 token 以 -- 开头（值形如 flag）→UsageError
PASS g3 cliFlag：单 - 开头值（负数）放行
PASS g3 cliFlag：UsageError 不带 exitCode 属性（消费点显式 exit 1）
self-test 全过（17 向量）
exit=0
```

含「全过」：是；向量数：17。

### 1b. deploy-check 自检

```
$ node scripts/deploy-check.mjs --self-test; echo exit=$?
PASS forbid 正例（v25.2.1 ∈ [25] → FAIL）
PASS forbid 反例（v24.21.0 ∉ [25] → ok）
PASS forbid 配置缺省（无 forbid_major → 恒 ok）
PASS 清单派生（ops-*.md 全收+排序+他件剔除）
PASS 漂移分类：缺失→FAIL（--install 可补）
PASS 漂移分类：存在但哈希不等→warn（不覆盖）
PASS 漂移分类：存在且相等→ok
PASS 退出码：无 FAIL → 0（warn 不阻断由汇总向量另证）
PASS 退出码：有 FAIL → 1
PASS 退出码：--self-test 失败 → 1
PASS 退出码：自身装载错 → 3（SelfLoadError 常量）
PASS hook 值：.githooks → ok
PASS hook 值：未设 → FAIL（--install 可补）
PASS hook 值：自定义 → warn（只提示）
PASS 汇总行：计数+终判（FAIL→阻断）
PASS 汇总行：warn 不阻断（→处置后复跑，exit 仍 0）
PASS g3 派生：唯一命中→{uuid_prefix:id 前 8 字符, entry_name}
PASS g3 派生：零命中→unmatched（不猜）
PASS g3 派生：同 entry_name≥2 命中→ambiguous（歧义不猜）
PASS g3 派生：hostUnconsumed 归集（宿主有而默认件未用的条目名=候选信息）
PASS g3 判定：全命中且值与默认件完全一致→hostFactsDiffer=false（不写盘）
PASS g3 判定：uuid 前缀漂移→hostFactsDiffer=true（须派生覆盖件）
PASS g3 install：覆盖件已存在→绝不覆盖（原内容不动）
PASS g3 install：有 unmatched/ambiguous→不写文件（指引手工路径）
PASS g3 install：全命中且与默认件一致→不写文件（无冗余件）
PASS g3 install：漂移→写覆盖件（note 声明+派生 providers+落盘回读一致）
PASS g3 install：写盘 IO 抛错→FAIL 结果带真因（不裸抛/不误归因装载失败）
PASS g3 install：仅 unmatched（无 ambiguous）→不写+指引（行含 none/歧义槽=无）
PASS g3 install：仅 ambiguous（无 unmatched）→不写+指引（行含 ambi/零命中槽=无）
PASS g3 install：hostCfg=null 注入→不裸抛+不写+指引（全别名入 unmatched）
self-test 全过（30 向量）
exit=0
```

含「全过」：是；向量数：30。

### 1c. log-triage 自检

```
$ node scripts/log-triage.mjs --self-test; echo exit=$?
PASS 429→quota
PASS 504→window
PASS 500→server
PASS 401→config
PASS ECONNRESET→transport
PASS 枚举值判定（sonnet 非 <uuid>/<model> 形态）
PASS 合法绑定形态（uuid/model）
PASS 合法绑定形态（builtin:model/key）
PASS probe-b 假绑定可被 ③ 抓出（RED+枚举）
PASS 验收断言：mock429×4 不计入（mockN=4/quota=0/window=1）
PASS 验收断言：推荐=k1 不换源（当日实陷回归——原输出假推荐 k2）
PASS 全角（mock）兜底命中（不计入推荐）
PASS b3 格式校验：非 YYYY-MM-DD 拒（foo/2026-9-16/空串）
PASS b3 语义校验：坏月日拒（2026-13-45）
PASS b3 语义校验：坏日拒（2026-02-30——本机 V8 ISO 解析日溢出回卷非 NaN，须分量回环判）
PASS b3 语义校验：平年 2 月 29 拒（2025-02-29）
PASS b3 语义校验：合法值过（2026-09-16/闰 2024-02-29/平年 2025-02-28）
PASS b3 窗口 epoch 化+UTC 日界（since=UTC 零点/until=次 UTC 零点）
PASS b3 UTC 日界：上海本地 09-17 02:00 行（=UTC 09-16 18:00）归 09-16 窗
PASS b3 UTC 日界（非本地零点）：上海本地 09-16 04:00 行（=UTC 09-15 20:00）不入 09-16 窗
PASS b3 --hours 同路径：epoch ms 回推（now 定锚 12:00Z−2h=10:00Z）
PASS b3 窗口行过滤：UTC 09-16 窗内两行留（含上海 09-17 02:00 行）/次 UTC 零点起弃
PASS b4 null provider→buildAliasMap 不崩（null 条目跳过/其余映射保留）
self-test 全过
exit=0
```

含「全过」：是；末行无向量数（输出原文如此）。

（item2-8 逐笔续写于下）

## 2. 回归与扫描四件

### 2a. regression

```
$ node scripts/regression.mjs; echo exit=$?
PASS R2a 档案装载 vs golden 字节比对+MANIFEST 一致 gate1-reviewer:= drafter:= auditor-readonly:=
PASS R2b 派发器 dry-run assembled_system vs golden gate1-reviewer:= drafter:= auditor-readonly:=
PASS R5 exit=2(期2) stderr全源尽=true 事件计数 attempt=12/12 switch=2/2 exhaust=1/1（链长3推导）chain=kimi-main→kimi-backup→deepseek 账本exhaust=true
PASS R4 流水:尾100行坏0行（含未知事件0）跳0行(旧版本)外来0行(他源channel标记) 事件分布={"attempt":80,"switch":13,"exhaust":7}；cfg哈希一致=true（流水 20254429f008 vs live cfg:20254429f008）；账本:尾50行坏0行（含未知事件0）跳9行(旧版本)外来0行(他源channel标记) 事件分布={"ok":30,"ruling":9,"stopped":1,"switch":1}
PASS R7 账本 schema 指针唯一指向 02 §9 SKILL.md:✓ org-seg.snippet:✓
PASS R8 log-triage:exit=0/全过=true/验收断言=true org-config:exit=0/全过=true deploy-check:exit=0/全过=true
PASS R9 scrub 复制体与源字面量一致=true
PASS R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=0 node:http(s)import=✓；③向量:splitEndpoint=全过/classify+ensure=全过；②mock往返:glm=✓(exit=0 正文+流水attempt/ok行)/ds=✓(exit=0)；④B1向量(registry错误面):全过 坏JSON→exit=3(期3)/[fatal]=true；roles:null→exit=3(期3)/[fatal]=true
SKIP R1 未给 --r1——真实派发配给保护，~9k Kimi tokens；冻结裁决前须跑或显式登记欠账（SKIP 不计入通过数——ds-W6）

regression 汇总：8/8 过，SKIP ×1（未跑项不计入通过数）（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）
exit=0
```

汇总行原文见上；R8 行原文见上。

### 2b. check-anchors

```
$ node scripts/check-anchors.mjs; echo exit=$?
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=12 件）
exit=0
```

### 2c. check-hardcode

```
$ node scripts/check-hardcode.mjs; echo exit=$?
[info] 白名单豁免 36 处（14 条规则）
check-hardcode 汇总：扫 14 个 .md，命中 0 处（白名单豁免 36；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
exit=0
```

### 2d. health-scan

```
$ node scripts/health-scan.mjs; echo exit=$?
[WARN] 账本存在 1 行 ok 缺 usage 字段——预算累计会低估，修复记账后重扫
[WARN] 账本存在 4 行 in=0 而 out>0——疑缓存命中未计（cache_read_input_tokens 未并），预算累计低估（P2-5）
[info] 账本跳过 1 行 mocked=true（演练行——源头甄别，不参与欠账/同源判定）
[info] 账本跳过 1 个临时演练项目（os.tmpdir() 前缀——P0-1 判据）：C:\Users\ADMINI~1\AppData\Local\Temp\r5-692zCI
[info] 项目 synapse：exhaust 后已补还（ok 2026-09-16）
[info] 项目 E:/class/智水蓝图/waterprint：exhaust 后已补还（ok 2026-09-13）
[info] 账本 41 行无 truncated 字段（schema v1 历史行）——④ 对历史行豁免，其覆盖率为已知欠账
[info] 尾窗 ok 源分布：builtin:bigmodel-coding-plan/model-field:b2466f8b-9d89-4428-a38e-c2aca1c41d0e/k3/model-field:8ad55776-2296-4f1a-bc46-05755c8f1300/deepseek-flash/session
[info] 用量 kimi-main：27 次 ok，累计 in=176,480 out=147,713
[info] 用量 deepseek：22 次 ok，累计 in=146,718 out=307,727
[info] 用量 kimi-backup：2 次 ok，累计 in=9,345 out=21,143
[info] 用量 builtin:bigmodel-coding-plan：16 次 ok，累计 in=343,911 out=16,939
[info] 用量 model-field:b2466f8b-9d89-4428-a38e-c2aca1c41d0e/k3：4 次 ok，累计 in=0 out=0
[info] 用量 model-field:5e1abd9d-1f4f-41fb-afa1-ecb5ce76e256/k3：1 次 ok，累计 in=0 out=0
[info] 用量 model-field:8ad55776-2296-4f1a-bc46-05755c8f1300/deepseek-flash：2 次 ok，累计 in=0 out=0
[info] 用量 session：6 次 ok，累计 in=0 out=0
health-scan 汇总：RED ×0 / WARN ×2（WARN 不阻断但须回显计数，累计出现即按升格条件处置，W-1）（账本行 111/流水行 1701/窗口 20/审计岗 drafter,gate1-reviewer,auditor-readonly）——可收口
exit=0
```

RED/WARN 计数行原文见末汇总行（RED ×0 / WARN ×2）。

## 3. 用法错五路（b1 行为面）

### 3a.

```
$ node scripts/deploy-check.mjs --agents-dir; echo exit=$?
[用法错] flag --agents-dir 居末位无值（缺值=用法错——原取 undefined 静默，g3 批 evolve-l4-flags 清偿）
exit=1
```

### 3b.

```
$ node scripts/org-config.mjs --project; echo exit=$?
[用法错] flag --project 居末位无值（缺值=用法错——原取 undefined 静默，g3 批 evolve-l4-flags 清偿）
exit=1
```

### 3c.

```
$ node scripts/regression.mjs --only R8 --only R9; echo exit=$?
[用法错] flag --only 出现 2 次（重复=用法错——原仅解析首个，g3 批 evolve-l4-flags 清偿）
exit=1
```

### 3d.

```
$ node scripts/log-triage.mjs --date; echo exit=$?
[用法错] flag --date 居末位无值（缺值=用法错——原取 undefined 静默，g3 批 evolve-l4-flags 清偿）
exit=1
```

### 3e.

```
$ node scripts/ds-call-v2.mjs --role gate1-reviewer --dry-run --mock-source; echo exit=$?
[用法错] flag --mock-source 居末位无值（缺值=用法错——原取 undefined 静默，g3 批 evolve-l4-flags 清偿）
exit=1
```

五路均 exit=1，末行均为 [用法错] 行（输出全文即上文 1 行）。

## 4. 变异红证抽钉（C3——org-config.mjs cliFlag 重复检测 throw 行）

目标行定位（grep）：`107:  if (hits.length >= 2) throw new UsageError(`flag ${name} 出现 ${hits.length} 次（重复=用法错——原仅解析首个，g3 批 evolve-l4-flags 清偿）`)`

矩阵前快照：

```
$ md5sum scripts/org-config.mjs && git diff --stat -- scripts/org-config.mjs; echo "exit=$?"; git stash list | wc -l
f4744bfb70be4b0b97e8d185fd7ed80c *scripts/org-config.mjs
 scripts/org-config.mjs | 54 +++++++++++++++++++++++++++++++++++++++++++++-----
 1 file changed, 49 insertions(+), 5 deletions(-)
exit=0
0
```

（注：矩阵前 git diff 非空=工作区本有 g3 批改动 49+/5-，故零残留判据=还原后与该快照一致，非空 diff。）

备份+变异：

```
$ cp scripts/org-config.mjs scripts/org-config.mjs.bak && sed -i '107s|.*|// MUTATION-PROBE $&|' scripts/org-config.mjs; echo mutate_exit=$?
mutate_exit=0
```

变异后第 105-108 行（sed -n 实录，107 行行首已 // 注释，throw 不再执行）：

```
  for (let i = 0; i < argv.length; i++) if (argv[i] === name) hits.push(i)
  if (hits.length === 0) return null
// MUTATION-PROBE $  if (hits.length >= 2) throw new UsageError(`flag ${name} 出现 ${hits.length} 次（重复=用法错——原仅解析首个，g3 批 evolve-l4-flags 清偿）`)
  const val = argv[hits[0] + 1]
```

变异后自检：

```
$ node scripts/org-config.mjs --self-test; echo exit=$?
（前 12 行 PASS 同 §1a，略列——原文已实测，第 13 行起：）
FAIL g3 cliFlag：同名 flag 出现≥2 次→UsageError
PASS g3 cliFlag：flag 居末位（无值）→UsageError
PASS g3 cliFlag：下一 token 以 -- 开头（值形如 flag）→UsageError
PASS g3 cliFlag：单 - 开头值（负数）放行
PASS g3 cliFlag：UsageError 不带 exitCode 属性（消费点显式 exit 1）
self-test 1 项失败
exit=1
```

（注：变异后输出原文共 18 行=12 PASS+1 FAIL+4 PASS+汇总行「self-test 1 项失败」，为省篇幅前 12 PASS 行与 §1a 同名向量一致，未抄录；FAIL 行与汇总行为逐字原文。）

还原+复跑+零残留证明：

```
$ mv scripts/org-config.mjs.bak scripts/org-config.mjs && node scripts/org-config.mjs --self-test > /tmp/restore_test.out 2>&1; echo exit=$?; tail -2 /tmp/restore_test.out; md5sum scripts/org-config.mjs; git diff --stat -- scripts/org-config.mjs; git stash list | wc -l; ls scripts/*.bak 2>&1
exit=0
PASS g3 cliFlag：UsageError 不带 exitCode 属性（消费点显式 exit 1）
self-test 全过（17 向量）
f4744bfb70be4b0b97e8d185fd7ed80c *scripts/org-config.mjs
 scripts/org-config.mjs | 54 +++++++++++++++++++++++++++++++++++++++++++++-----
 1 file changed, 49 insertions(+), 5 deletions(-)
0
ls: cannot access 'scripts/*.bak': No such file or directory
```

零残留判据逐项：md5 还原后=f4744bfb70be4b0b97e8d185fd7ed80c（与矩阵前快照逐字节一致）；git diff --stat 与矩阵前快照同一输出；git stash list 计数 0（前后均 0）；.bak 文件不存在（ls 报 No such file or directory=无残留文件本身；该 ls 无匹配使复合命令整体 exit=2，已如实记录）。复跑自检 exit=0 且「self-test 全过（17 向量）」。

（item5-8 续写于下）

## 5. R2 坏覆盖件真机注入

前置核验（不存在→非 BLOCKED，执行）：

```
$ ls -la .zcode/ 2>&1; echo ls_exit=$?; ls .zcode/org-config.json 2>&1; echo file_exit=$?
total 56
drwxr-xr-x 1 Administrator 197121     0 Sep 17 11:20 ./
drwxr-xr-x 1 Administrator 197121 0 Sep 17 10:47 ../
-rw-r--r-- 1 Administrator 197121 46715 Sep 17 09:48 org-ledger.jsonl
ls_exit=0
ls: cannot access '.zcode/org-config.json': No such file or directory
file_exit=2
```

注入（字节级实录 od -c：`{ ` + UTF-8 坏=e5 9d 8f）：

```
$ printf '{ 坏' > .zcode/org-config.json && od -c .zcode/org-config.json | head -2; echo inject_exit=$?
0000000   {     345 235 217
0000005
inject_exit=0
```

install 路径（记 install-hostfacts 行+末行+退出码）：

```
$ node scripts/deploy-check.mjs --install; echo exit=$?
[install] 首装模式——三动作：④补缺失代理件 / ⑤hooksPath 未设时补设 / ③宿主事实派生项目覆盖件（护栏：不覆盖漂移件/不改 org-config.default.json 与宿主配置）
[install] install-agents——无缺失件（已存在漂移件不覆盖——保护本机定制）
[install] install-hook——core.hooksPath 已设=.githooks（不重复设置；自定义值属用户裁决面）
[install] install-hostfacts——跳过：org-config 装载失败（JSON 解析失败 C:\Users\Administrator\.zcode\skills\ai-dev-org\.zcode\org-config.json: Expected property name or '}' in JSON at position 2 (line 1 column 3)）——处置=修复或移除 .zcode/org-config.json（用户域件）/核对默认件后复跑；手工路径=DEPLOY §3
[装载错] org-config 装载失败：JSON 解析失败 C:\Users\Administrator\.zcode\skills\ai-dev-org\.zcode\org-config.json: Expected property name or '}' in JSON at position 2 (line 1 column 3)
exit=3
```

install-hostfacts 行=上文第 4 行；末行=[装载错] 行；退出码=3。

检查路径（记 [装载错] 行+退出码）：

```
$ node scripts/deploy-check.mjs; echo exit=$?
[装载错] org-config 装载失败：JSON 解析失败 C:\Users\Administrator\.zcode\skills\ai-dev-org\.zcode\org-config.json: Expected property name or '}' in JSON at position 2 (line 1 column 3)
exit=3
```

还原：

```
$ rm .zcode/org-config.json; echo rm_exit=$?; ls .zcode/; echo ls_exit=$?
rm_exit=0
org-ledger.jsonl
ls_exit=0
```

还原后 .zcode/ 内容=仅 org-ledger.jsonl（与注入前 ls -la 一致，注入件零残留）。

## 6. b2 本机形态

```
$ node scripts/deploy-check.mjs --install; echo exit=$?; ls .zcode/org-config.json 2>&1; echo override_exit=$?
[install] 首装模式——三动作：④补缺失代理件 / ⑤hooksPath 未设时补设 / ③宿主事实派生项目覆盖件（护栏：不覆盖漂移件/不改 org-config.default.json 与宿主配置）
[install] install-agents——无缺失件（已存在漂移件不覆盖——保护本机定制）
[install] install-hook——core.hooksPath 已设=.githooks（不重复设置；自定义值属用户裁决面）
[install] install-hostfacts——宿主事实与默认件一致——无需覆盖件（不写，防本机冗余件）
[FAIL] node-major——当前 v25.2.1（主版本 25）∈ 受禁系（org-config supported_node.forbid_major）——改装受支持主版本后复跑
[ok] skill-files——必备 4 件齐（SKILL.md、org-config.default.json、scripts/org-config.mjs、scripts/roles/registry.json）
[ok] org-config——validate 通过（validate PASS（3 源双校验通过，cfg:20254429f008））
[ok] agents——ops-adjudicator.md（C:\Users\Administrator\.zcode\agents）sha256 相符
[ok] agents——ops-diagnostics.md（C:\Users\Administrator\.zcode\agents）sha256 相符
[ok] agents——ops-executor.md（C:\Users\Administrator\.zcode\agents）sha256 相符
[ok] agents——ops-gate1-k1.md（C:\Users\Administrator\.zcode\agents）sha256 相符
[ok] agents——ops-gate1-k2.md（C:\Users\Administrator\.zcode\agents）sha256 相符
[ok] agents——ops-probe.md（C:\Users\Administrator\.zcode\agents）sha256 相符
[ok] hook——core.hooksPath=.githooks（提交门禁已挂）
[ok] remote——已挂（origin）
[ok] ledger-dir——SKILL_ROOT/.zcode/ 可写（账本目录就绪）
deploy-check 汇总：ok 11/warn 0/FAIL 1——阻断
exit=1
ls: cannot access '.zcode/org-config.json': No such file or directory
override_exit=2
```

三要素实录：install-hostfacts 行=「[install] install-hostfacts——宿主事实与默认件一致——无需覆盖件（不写，防本机冗余件）」；`.zcode/org-config.json` 仍不存在（override_exit=2）；org-config ③项 validate ok 行=「[ok] org-config——validate 通过（validate PASS（3 源双校验通过，cfg:20254429f008））」。
另实录：本机 v25.2.1 命中 forbid_major → [FAIL] node-major 行，汇总 ok 11/warn 0/FAIL 1——阻断，exit=1（输出原文，机器事实，未作定性）。

（item7-8 续写于下）

## 7. b3 指针抽核（5 条「NN §M」+SKILL.md:89）

抽法：references/00-glossary.md 内任取 5 条含「NN §M」指针的条目，逐条到目标文件核章节标题存在。

| # | 术语表出处（00-glossary.md 行） | 指针 | 目标命中行（原文） |
|---|---|---|---|
| 1 | 37：\| 单批次流水线 \| 基准 12 步（领单→…→收口）的标准步序 \| 02 §2 \| | 02 §2 | 02-pipeline-templates.md:20：`## 2. 单批次流水线（基准 12 步）` |
| 2 | 56：\| 变异红证 \| 临时破坏实现证明确实会红（防「看起来会失败」假阳性） \| 03 §4 / 01·C3 \| | 03 §4 | 03-machine-enforcement.md:48：`## 4. 变异红证（防假阳性）` |
| 3 | 69：\| 额度经济学 \| 投放面原则；具体数字与红线住 org-config（正文禁硬编码） \| 06 §3 \| | 06 §3 | 06-model-routing.md:35：`## 3. 额度经济学（投放面原则；具体数字与红线看 org-config）` |
| 4 | 25：\| 岗位编制终表 \| 全属性（岗名×通道×档位语义）唯一真源（编制=8 岗）；他处仅索引岗名 \| 07 §1 \| | 07 §1 | 07-role-cards.md:7：`## 1. 岗位编制终表（编制=8 岗；「人类用户」=裁决位不计入编制）` |
| 5 | 42：\| 交接（取代制） \| 交接书只新写不改旧；最新一份=进程状态真源 \| 02 §7 / 08 §1 \| | 08 §1 | 08-doc-governance.md:10：`## 1. 事实分层寻址表（哪类事实住哪——双源漂移的根治面）` |

5/5 命中（章节标题行均存在，原文已贴）。

SKILL.md:89 行原文（sed -n '89p' 实录）：

```
00 术语速查+新手上手图 ｜ 01 原理 A~E 五组 ｜ 02 管道 12 步+任务书七段+回炉+数据专轨+适配注记 ｜
```

## 8. 白名单对账

```
$ git status --porcelain; echo exit=$?
 M DEPLOY.md
 M SKILL.md
 M scripts/deploy-check.mjs
 M scripts/ds-call-v2.mjs
 M scripts/log-triage.mjs
 M scripts/org-config.mjs
 M scripts/regression.mjs
?? references/00-glossary.md
?? scripts/audits/2026-09-17_g3-brief.md
?? scripts/audits/2026-09-17_g3-for-gate1.md
?? scripts/audits/2026-09-17_g3-gate1-out.md
?? scripts/audits/2026-09-17_g3-gate2-evidence.md
?? scripts/audits/2026-09-17_g3-gate2-matrix.md
?? scripts/audits/2026-09-17_g3-impl-report.md
?? scripts/audits/2026-09-17_g3-rework-for-gate1.md
?? scripts/audits/2026-09-17_g3-rework2-for-gate1.md
exit=0
```

对账事实：改（M）=7 件（DEPLOY.md/SKILL.md/deploy-check.mjs/ds-call-v2.mjs/log-triage.mjs/org-config.mjs/regression.mjs）；??=references/00-glossary.md+scripts/audits/ 下 2026-09-17_g3-* 档件 8 件（含本证据件与矩阵件）；清单内无其他条目。

## 异常清单（现象/证据/初分类——禁定性，裁决归裁决部）

1. 现象：item 6 `deploy-check --install` 末行汇总「ok 11/warn 0/FAIL 1——阻断」exit=1，FAIL 行=[FAIL] node-major——当前 v25.2.1（主版本 25）∈ 受禁系。证据：§6 输出原文。初分类：环境/配置面事实（本机 node 主版本命中 org-config supported_node.forbid_major）；矩阵 item6 三预期要素（install-hostfacts 一致行/覆盖件不存在/③ validate ok 行）均到位，exit=1 由该 FAIL 行致。另注：item 2a regression 汇总含「SKIP ×1（R1——未给 --r1）」、item 2d health-scan WARN ×2（缺 usage 字段 1 行+in=0 而 out>0 4 行）——均为输出原文实录，非执行异常，未计入异常数。

## 尾栏

矩阵 8 项全部真跑完毕；item4 变异-还原-零残留、item5 注入-还原-零残留均完整执行并在上文证明。

MODEL-SELF: ops-probe bound
FINDINGS: 项数=8 异常=1

## 6. 主控亲验记录

- 全量自检真退出码全 0（regression 8/8/anchors 12 件 0/0/hardcode 0/health-scan RED 0 WARN 2/cfg:20254429f008 不变）；五路用法错 exit 1 实测；坏覆盖件真机注入两路径 exit 3+还原；readJson 缺席必抛 ENOENT 机器事实（readFileSync 语义）。
