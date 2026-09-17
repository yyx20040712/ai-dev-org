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
