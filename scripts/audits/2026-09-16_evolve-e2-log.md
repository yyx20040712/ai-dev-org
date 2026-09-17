# evolve-E2 真退出码实录（b3+b4+b5+b7）——2026-09-16

环境：Node v25.2.1 / Git Bash win32 / 技能根=C:\Users\Administrator\.zcode\skills\ai-dev-org / git@main HEAD=919f27a（E1 终笔）。
简报=2026-09-16_evolve-brief-e2.md。所有命令均在技能根执行；`EXIT=` 行为真实退出码。

## 0. 基线核对（E1 后，开工前）

```
$ node scripts/regression.mjs
regression 汇总：8/8 过，SKIP ×1（未跑项不计入通过数）（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）
EXIT=0
$ node scripts/check-hardcode.mjs
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）
EXIT=0
$ node scripts/check-anchors.mjs
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
EXIT=0
$ node scripts/health-scan.mjs --project .
health-scan 汇总：RED ×0 / WARN ×2（……）——可收口
EXIT=0
```

基线四门禁与简报 §5 全部对上（regression 8/8 R1 SKIP / hardcode 0 豁免 33 / anchors 0/0 / health RED0 WARN2）。

## 0.1 前置事实（实现前提实证）

- V8（Node v25.2.1）ISO 解析语义实测：
  `new Date('2026-02-30T00:00:00Z').getTime()`=**1772409600000（有效！日溢出回卷 03-02）**；
  `'2026-13-45'`=NaN（月越界才拒）；`'2026-09-16'`/`'2024-02-29'`=有效。
  ⇒ P-1「Invalid/NaN=拒」单靠 NaN 判不住 2026-02-30 向量——语义校验须加 UTC 年/月/日
  分量回环比对（P-1 向量全过的必要实现，申报见报告自裁节）。
- 两位文档号/单数字文档号 § 引用普查（SKILL.md+RESIDUALS.md+references/*.md）：
  单数字形态（如 `6 §2`）命中 **0**；10+ 号文档形态命中 **0**（现存全为 0X 形态）。
  ⇒ 文档号正则扩两位+单数字零新误伤面。

## 0.2 ·XN 全库前置普查（P-4⑤；grep 面=references/*.md+SKILL.md+RESIDUALS.md+scripts/*.mjs）

| # | 位置 | 引用 | 判定 | 处置 |
|---|---|---|---|---|
| 1 | SKILL.md:141 | 04·SY-1 | 合法（04 登记表有 SY-1） | 不动 |
| 2 | SKILL.md:144 | 01·E2 | 合法（01 登记表有 E2） | 不动 |
| 3 | references/01-org-principles.md:157 | **02·C2** | **断锚**（C2 系 01 条目；02 无条目登记表） | P-4 终裁改指 01·C2（b7 批内修） |
| 4 | references/02-pipeline-templates.md:18 | 01·B5 | 合法 | 不动 |
| 5 | references/02-pipeline-templates.md:204 | 06·v1.1 | 小写版本串=免误伤形态（不命中） | 不动 |
| 6 | references/03-machine-enforcement.md:3 | 01·A2 | 合法 | 不动 |
| 7 | references/07-role-cards.md:3 | 01·E2 | 合法 | 不动 |

scripts/*.mjs 头注 ·XN 命中 0。**登记表外新断锚数=1（恰为 P-4 预判的 01:157），≤5 随批修成立。**

## 0.3 providers 消费点普查（P-2；面=白名单 8 脚本+health-scan，grep 实读）

| 文件:行 | 消费点 | null 安全 | 处置 |
|---|---|---|---|
| log-triage.mjs:38 | buildAliasMap `p.uuid_prefix` | ✗ 裸取 | **b4 修**（p?.uuid_prefix） |
| log-triage.mjs:258 | `merged.providers?.[a]` 真值判 | ✓ 已守卫 | 不动 |
| org-config.mjs:100-107 | validateProviders `def.uuid_prefix`+`near[1].name` | ✗ 双裸取 | **b4 修**（null def→校验错误行 continue；near?.[1]?.name） |
| org-config.mjs:111/117 | `cfg.providers[alias]` 真值判 | ✓（null→falsy→错误行） | 不动 |
| check-hardcode.mjs:64-65 | deriveHostModelTerms `p.models`（宿主原始 JSON） | ✗ 裸取 | **b4 修**（降级行+continue+exit 5 族） |
| ds-call-v2.mjs:159-160 | loadSources `def.uuid_prefix` | ✓ 间接受护（validateProviders 前置闸门 exit 3；b4 修后 null def 在 validate 即拦） | 不动（报告注明防线链） |
| ds-call-v2.mjs:439 | `merged.providers?.[alias]?.billing` | ✓ 已守卫 | 不动 |
| glm-look.mjs:150 | discoverSources `prov.options`（宿主原始 JSON） | ✗ **裸取——新发现** | **登记不修**（glm-look=E1 已落面，禁改其行为；移交报告→主控转 b9） |
| regression.mjs:349 | R10 mock 宿主配置 fixture 字面量 | n/a（构造面） | 不动 |
| health-scan.mjs / skill-gc.mjs / check-anchors.mjs | — | 零命中（grep 'provider' 计数 0） | 无消费点 |

## 1. b3（log-triage --date 校验+UTC 日界窗口）

### 1.1 红（先加自检向量，实现未落）

```
$ node scripts/log-triage.mjs --self-test
FAIL b3 格式校验：非 YYYY-MM-DD 拒（foo/2026-9-16/空串）
FAIL b3 语义校验：坏月日拒（2026-13-45）
FAIL b3 语义校验：坏日拒（2026-02-30——本机 V8 ISO 解析日溢出回卷非 NaN，须分量回环判）
FAIL b3 语义校验：平年 2 月 29 拒（2025-02-29）
FAIL b3 语义校验：合法值过（2026-09-16/闰 2024-02-29/平年 2025-02-28）
FAIL b3 窗口 epoch 化+UTC 日界（since=UTC 零点/until=次 UTC 零点）
FAIL b3 UTC 日界：上海本地 09-17 02:00 行（=UTC 09-16 18:00）归 09-16 窗
FAIL b3 UTC 日界（非本地零点）：上海本地 09-16 04:00 行（=UTC 09-15 20:00）不入 09-16 窗
FAIL b3 --hours 同路径：epoch ms 回推（now 定锚 12:00Z−2h=10:00Z）
FAIL b3 窗口行过滤：UTC 09-16 窗内两行留（含上海 09-17 02:00 行）/次 UTC 零点起弃
self-test 10 项失败
EXIT=1
```

CLI 红态（校验缺失=静默空窗，M1 假绿面实证）：

```
$ node scripts/log-triage.mjs --date foo
== log-triage 分诊（内链路 zcode-foo.jsonl ×0 行 + 外链路流水；窗口=foo）==
   attempts={} ok={}
   （零报错、零 [usage] 行——「foo」被静默接受为窗口标签；退出码 1 系既有 RED 级静默回退
    检出所致，不带 --date 同样退 1——与 --date 校验无关，甄别实据）
```

### 1.2 绿（实现落地后）

```
$ node scripts/log-triage.mjs --self-test
（前段原向量全 PASS…）
PASS b3 --hours 同路径：epoch ms 回推（now 定锚 12:00Z−2h=10:00Z）
PASS b3 窗口行过滤：UTC 09-16 窗内两行留（含上海 09-17 02:00 行）/次 UTC 零点起弃
self-test 全过
EXIT=0
$ node scripts/log-triage.mjs --date foo        → stderr:[usage] --date 非法值「foo」…  EXIT=1
$ node scripts/log-triage.mjs --date 2026-13-45 → stderr:[usage] …「2026-13-45」…       EXIT=1
$ node scripts/log-triage.mjs --date 2026-02-30 → stderr:[usage] …「2026-02-30」…       EXIT=1
$ node scripts/log-triage.mjs --date 2026-09-16 → == log-triage 分诊（内链路 zcode-2026-09-16.jsonl ×29398 行…窗口=2026-09-16）==  EXIT=1（合法值；退出 1=既有 RED 静默回退检出语义，与基线同态）
$ node scripts/log-triage.mjs --hours 2 --health → == 源健康检查（窗口=近 2h，cfg:a26f710a540d）==  EXIT=0（--hours 路径回归；cfg 哈希不漂移）
```

### 1.3 变异红证（b3）

变异=isValidDateStr 撤 UTC 分量回环判（只留 NaN 判，`return true`）：

```
$ node scripts/log-triage.mjs --self-test
FAIL b3 语义校验：坏日拒（2026-02-30——本机 V8 ISO 解析日溢出回卷非 NaN，须分量回环判）
FAIL b3 语义校验：平年 2 月 29 拒（2025-02-29）
self-test 2 项失败（共 10 向量中恰 2 翻红=变异精准命中）
EXIT=1
```

CLI 面该变异被既有 RED 检出掩蔽（--date 2026-02-30 仍退 1 但非 [usage]）——断言式自检向量
为权威捕捉面（P-7 口径印证）。证毕还原：`--self-test` 全过 EXIT=0；`git diff --stat
scripts/log-triage.mjs` = 66 insertions(+), 14 deletions(-)（无变异残留）。

## 2. b4（provider null 守卫三处+消费点普查）

### 2.1 红（先加向量，守卫未落；null-provider fixture=构造 providers 含 null 的对象过各消费点）

```
$ node scripts/org-config.mjs --self-test
FAIL b4 null provider→校验错误行（不崩）
FAIL b4 近邻提示 null 宿主条目不崩（near?.[1]?.name）
FAIL b4 健康源不受 null 条目影响（live 双校验通过不出错行）
self-test 3 项失败          EXIT=1   （红因=validateProviders 对 null def 裸取 uuid_prefix→TypeError 被
                                        向量 try/catch 捕为 THREW——三断言同源翻红）
$ node scripts/check-hardcode.mjs --self-test
FAIL b4 null provider→降级行+其余源词表继续派生（不崩）
check-hardcode 自检：18/19 过   EXIT=1   （红因=deriveHostModelTerms 对 null p 裸取 p.models→TypeError）
$ node scripts/log-triage.mjs --self-test
FAIL b4 null provider→buildAliasMap 不崩（null 条目跳过/其余映射保留）
self-test 1 项失败          EXIT=1   （红因=buildAliasMap 对 null p 裸取 uuid_prefix→TypeError）
```

### 2.2 绿（三守卫落地后）

```
$ node scripts/org-config.mjs --self-test     → self-test 全过（10 向量）            EXIT=0
$ node scripts/check-hardcode.mjs --self-test → check-hardcode 自检：19/19 过        EXIT=0
$ node scripts/log-triage.mjs --self-test     → self-test 全过                       EXIT=0
$ node scripts/org-config.mjs validate        → validate PASS（3 源双校验通过，cfg:a26f710a540d）  EXIT=0
$ node scripts/org-config.mjs hash            → cfg:a26f710a540d                     EXIT=0（cfg 哈希零漂移）
```

修后形态：org-config=validateProviders 对 null/非对象 def 产明确校验错误行（`providers.<alias>
值为 null——…配置损坏`）continue 不崩（validate CLI 路径 errors 非空→exit 3，P-7 b4 观察面）；
近邻提示 near?.[1]?.name（null 宿主条目显示 name=null 不崩）。check-hardcode=null 条目记
`[degraded]` stderr 行+DEGRADED=true 继续扫其余（exit 5 语义族）。log-triage=p?.uuid_prefix
null 条目跳过。注：deepMerge 语义=显式 null 删除键，merged.providers 经文件装载路径不可达
null 值——守卫为纵深防御面（M3 族）；宿主原始 JSON（readHostConfig/deriveHostModelTerms 侧）
null 条目可达=真实坏配置面。

### 2.3 变异红证（b4）

变异=check-hardcode 守卫短路禁用（`if (false) {…guard…}`）：

```
$ node scripts/check-hardcode.mjs --self-test
FAIL b4 null provider→降级行+其余源词表继续派生（不崩）
check-hardcode 自检：18/19 过    EXIT=1
```

证毕还原：`--self-test` 19/19 过 EXIT=0；git diff --stat 三文件 36 insertions/7 deletions（无变异残留）。

## 3. b5（regression 五处 spawnSync 超时看护+:2 头注指针化）

### 3.1 红态（改前现状，grep 实录）

```
$ grep -n 'spawnSync(' scripts/regression.mjs
92:  R2b  …--dry-run…            { encoding:'utf8', cwd: tmp }                       ← 无 timeout/killSignal
117: R5   …--mock-source…        { encoding:'utf8', cwd: tmp }                       ← 无
182: R4   org-config.mjs hash    { encoding:'utf8', cwd: process.cwd() }             ← 无
229: R8   log-triage --self-test { encoding:'utf8', cwd: SKILL_ROOT }                ← 无
396: R1   …--source…             { …, timeout: 1_260_000 }                           ← 低于 C5 下限 4,835,000 且无 killSignal
（260: R10 r10Spawn=E1 已落 60_000+SIGKILL，不在本批改面）
```

### 3.2 实测耗时×裕量推导表（实测法=各命令连跑 5 轮墙钟取 max，临时脚本 E:\zcode_md\fix\b5-measure.cjs 驱动）

| 位 | 命令 | min | max | ×5(max) | 取整取值 | 取值裕量 |
|---|---|---|---|---|---|---|
| R2b:94 | ds-call-v2 --dry-run（每角色） | 51ms | 65ms | 325ms | **5,000ms** | ×77（取整到 5s 档：吸收 Windows 首启/杀软扫描抖动，与 R10 同类路径 60s 先例同向） |
| R5:119 | ds-call-v2 --mock-source 全链 429 | 155ms | 208ms | 1,040ms | **5,000ms** | ×24（同上） |
| R4:184 | org-config.mjs hash | 38ms | 49ms | 245ms | **5,000ms** | ×102（同上） |
| R8:231 | log-triage --self-test | 41ms | 54ms | 270ms | **5,000ms** | ×93（同上） |
| R1:398 | ds-call-v2 --source 真实派发（SKIP 不实测） | — | — | 派生：4×1,200,000（链长 4×CALL_TIMEOUT_MS 20min）+35,000（装载/落账开销）=**4,835,000ms** | **5,400,000ms**（90min） | ×1.117；∈C5 机检窗 [4,835,000, 7,200,000]；禁裁剪到派生值以下（P-2） |

killSignal=五处全 'SIGKILL'（与 R10 块既有口径一致）。R1 零运行时实证（配给保护 SKIP）——
替代验证=派生复算（上表）+门一 diff 审；残留登记移交 b9（计划 v3 b5 既定）。

### 3.3 绿（五处落地后全量）

```
$ node scripts/regression.mjs
regression 汇总：8/8 过，SKIP ×1（未跑项不计入通过数）（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）
EXIT=0
$ grep -n 'spawnSync(' scripts/regression.mjs   → 94/119/184/231/398 五处均带 timeout+killSignal:'SIGKILL'
$ grep -c "killSignal: 'SIGKILL'" scripts/regression.mjs  → 6（五处主流程+R10 r10Spawn 一处=E1 已落）
```

E1 的 R10 异步 spawn 看护面核实结论：**已在**（r10SpawnAsync=60s 定时器→child.kill('SIGKILL')；
r10Spawn=timeout 60_000+killSignal SIGKILL）——按简报不重改，仅报告注明。

### 3.4 变异红证（b5）

变异=R8 timeout 压到 1ms（看护击发实验——证 timeout+killSignal 真生效非摆设）：

```
$ node scripts/regression.mjs --only R8
FAIL R8 exit=null 自检含验收断言=false（输出尾：）
regression 汇总：0/1 过，FAIL ×1（项=R8）
EXIT=1
```

击发形态=子进程被 SIGKILL 终止→status=null→FAIL 消息点名（非静默挂起）——P-7 b5 观察面
「挂起进程被 killSignal 终止后的 regression FAIL 消息点名」实证。证毕还原→全量 8/8 过 EXIT=0。

### 3.5 :2 头注指针化

改前：`技能自包含回归（ai-dev-org v1.0 冻结前置——06 §5 R1~R6 的内化执行件）：`
改后：`技能自包含回归（ai-dev-org v1.0 冻结前置——06 §5 的内化执行件；R 清单单源=本脚本 --only 可选项集合，此处不复写清单——evolve-E2 b5 指针化）：`
（R 数字清单不复写=抗清单腐化；单源=--only 项集合。）

## 4. b7（check-anchors 扩 NN·XN 条目型+两位文档号+P-4 改指+--self-test 强化）

### 4.1 红（先强化自检向量，扩面未落）

```
$ node scripts/check-anchors.mjs --self-test
[self-test] FAIL ×11: head-06 含 8.6（真实文件解析）:got=false want=true; §引用两位文档号解析…;
  条目登记表实析…; 条目正例…; 条目负例（合成串，裁决 C3 要求自检保留）：02·C2→WARN…;
  P-4 改指目标存在…; 免误伤×2…; 「」叙述跳过…; 两位文档号条目形…（11 项全红）
EXIT=1
$ node scripts/check-anchors.mjs   → WARN ×0 / FAIL ×0   EXIT=0   ← 红态事实：01:157 现存断锚
                                                                02·C2 未被检出（扩面前盲区）
```

红态中「head-06 含 8.6」翻红引出真发现：**06 无 §8.6（8.6 系 02:204 章节；06 有 5.7/5.8/8）**
——原恒真断言（自建 Set 自查自）掩蔽的解析盲点现身（RESIDUALS check-anchors-calibration
在册项实证）；向量改真锚：06 含 5.8+不含 8.6、02 含 8.6。

### 4.2 绿（SEC_REF_RE 两位数+ENTRY_REF_RE 条目型+登记表 01/04 正文解析落地）

```
$ node scripts/check-anchors.mjs --self-test
[self-test] 16/16 过                    EXIT=0
$ node scripts/check-anchors.mjs
[WARN] references/01-org-principles.md:157 条目断锚 02·C2——目标文档无此条目（登记表=01 A-E 系+04 WP/SY/MG/ORG 系正文条目）
check-anchors 汇总：WARN ×1（试点校准期）/ FAIL ×0（扫描面=11 件）   EXIT=0
```

扩面主扫唯一新 WARN=01:157 02·C2——与 §0.2 全库普查预判一致（其余 ·XN 引用 6 处全部
合法命中或免误伤形态，零误报）。

### 4.3 P-4 改指（裁决终裁：保审计链）

01:157 `（02·C2）`→`（01·C2）`：

```
$ node scripts/check-anchors.mjs
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）   EXIT=0
$ node scripts/check-anchors.mjs --self-test                          EXIT=0（16/16，含 P-4 改指目标存在向量）
```

golden 计数不受影响（改动为行内引用串，01 的 ^### X N 标记零变化——无需 --update）。

### 4.4 变异红证（b7）

变异=checkEntryRefs 登记表缺失文档误判合法（`=== true`→`!== false`）：

```
$ node scripts/check-anchors.mjs --self-test
[self-test] FAIL ×2: 条目负例（合成串，裁决 C3 要求自检保留）：02·C2→WARN:got=false want=true;
  两位文档号条目形：10·A1 …:got=false want=true
EXIT=1
（主扫面 WARN×0——活库断锚已被 P-4 修净，变异只能靠自检合成负例捕捉=裁决 C3 要求
 自检保留合成负例的正当性实证。）
```

证毕还原：self-test 16/16 过 EXIT=0。

### 4.5 终态门禁（b7 收口后全量，真退出码）

```
$ node scripts/regression.mjs
regression 汇总：8/8 过，SKIP ×1（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）   EXIT=0
$ node scripts/check-hardcode.mjs
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 33…）            EXIT=0
$ node scripts/check-anchors.mjs
check-anchors 汇总：WARN ×0 / FAIL ×0（扫描面=11 件）                    EXIT=0
$ node scripts/health-scan.mjs --project .
health-scan 汇总：RED ×0 / WARN ×2（…）——可收口                          EXIT=0
$ node scripts/check-anchors.mjs --self-test
[self-test] 16/16 过                                                     EXIT=0
```

全部门禁与基线一致（零新增命中；WARN×2=基线存量不劣化）。全程零真实外呼、
model-routing-log.jsonl/org-ledger.jsonl 零新增写入（R5 演练行=regression 既有 mock
路径，与基线同态）。




