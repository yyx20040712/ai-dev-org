# evolve-E2 实现报告（b3+b4+b5+b7）——2026-09-16

领单号=evolve-E2；简报=2026-09-16_evolve-brief-e2.md；计划=2026-09-16_evolve-plan-v3.md
§3 b3/b4/b5/b7+§5 预裁决。环境=Node v25.2.1/Git Bash win32/技能根 git@main，基线 HEAD=919f27a
（E1 终笔）。基线核对=regression 8/8（R1 SKIP）/hardcode 0（豁免 33）/anchors WARN×0 FAIL×0/
health RED×0 WARN×2/cfg=a26f710a540d——全部对上后开工。全程零真实外呼；
model-routing-log.jsonl 与 org-ledger.jsonl 零新增写入（R5 演练=regression 既有 mock 路径，
与基线同态）。真退出码全文=同目录 `2026-09-16_evolve-e2-log.md`（本报告证据源）。

## 1. 实现摘要

- **b3（log-triage --date）**：格式正则 `^\d{4}-\d{2}-\d{2}$`+语义校验（UTC 年/月/日分量
  回环——见自裁 1）拒 `foo/2026-9-16/2026-13-45/2026-02-30/2025-02-29`；非法→stderr 一行
  `[usage]`+exit 1（原=静默空窗假绿面，M1）。窗口 epoch ms 化：`export resolveWindow`
  纯函数（--hours/--date 同路径；--date 窗=[UTC 零点,次 UTC 零点)、--hours 窗=[now−Nh,∞)
  保持无上界）；三收割器（harvestCliLog/harvestRouting/harvestAgents）时间过滤统一 epoch 化。
  --self-test 扩 10 向量（含 UTC 日界双向例：上海本地 09-17 02:00 行=UTC 09-16 18:00 归窗、
  上海本地 09-16 04:00 行=UTC 09-15 20:00 不入窗=非本地零点判据）。
- **b4（provider null 守卫三处）**：org-config validateProviders——null/非对象 def 产明确
  校验错误行 continue（validate CLI 路径 errors 非空→exit 3）+近邻提示 `near?.[1]?.name`
  （宿主 null 条目显示 name=null 不崩）；check-hardcode deriveHostModelTerms——null 条目记
  `[degraded]` stderr 降级行+DEGRADED=true 继续扫其余（exit 5 语义族）；log-triage
  buildAliasMap——`p?.uuid_prefix` null 条目跳过。向量=null-provider fixture 注入各消费点
  （org-config 7→10 向量+计数动态化；check-hardcode 18→19（临时 fixture 文件+console.error
  钩子断言降级行）；log-triage +1）。
- **b5（regression 超时看护）**：五处主流程 spawnSync 全加 timeout+killSignal:'SIGKILL'——
  R2b:94/R5:119/R4:184/R8:231=5,000ms（实测×5 推导见表 §4）；R1:398=1,260,000→
  **5,400,000ms**（派生 4×1,200,000+35,000=4,835,000+裕量取 90min，∈C5 机检窗
  [4,835,000, 7,200,000]，禁裁剪）。regression.mjs:2 头注「06 §5 R1~R6」数字清单复写→
  指针化（R 清单单源=本脚本 --only 项集合）。E1 的 R10 异步 spawn 看护核实结论=**已在**
  （r10SpawnAsync 60s 定时器→SIGKILL；r10Spawn 60_000+SIGKILL），按简报不重改。
- **b7（check-anchors 扩面）**：①§引用正则 `0([1-9])`→`(?<![\d-])([01]\d|\d)(?!\d)`
  （两位文档号 10+ 与单数字去前导零；邻接禁数字/连字符=防日期串误配）；②新增 ①b 条目型
  断锚扫描 NN·XN（大写条目组 1-4 字母可带 -数字；小写 v1.1 天然不命中；「」跳过延续）→
  登记表=仅从 01（`^### X N`）与 04（`^\|\s*(WP|SY|MG|ORG)-\d+`）正文解析（不从 golden
  反推）；断锚=WARN；③P-4 终裁改指 01:157 `02·C2`→`01·C2`；④--self-test 4→16 向量强化
  （恒真 head 断言改真实文件解析；正例 01·E2/04·SY-1；合成负例 02·C2→WARN 保留（裁决 C3）；
  免误伤 06·v1.1/K3；两位文档号例）。

## 2. 文件清单（修改面=白名单内，全笔核验过）

| 文件 | 批 | 变更 |
|---|---|---|
| scripts/log-triage.mjs | b3+b4 | isValidDateStr/resolveWindow export+epoch 窗口三收割器+CLI 校验+自检 11 向量+buildAliasMap p?.守卫+头注退出码行补非法 --date=1 |
| scripts/org-config.mjs | b4 | validateProviders null def 错误行+near?.[1]?.name+自检 3 向量（7→10）+计数动态化 |
| scripts/check-hardcode.mjs | b4 | deriveHostModelTerms null 条目降级行+自检 1 向量（fixture 文件注入） |
| scripts/regression.mjs | b5 | 五处 spawnSync timeout+killSignal+:2 头注指针化（8+/6−） |
| scripts/check-anchors.mjs | b7 | SEC_REF_RE 两位数+ENTRY_REF_RE+buildEntryIndex/checkEntryRefs/inQuote+主扫描接线+self-test 4→16 向量+头注扩面注记 |
| references/01-org-principles.md | b7 | 仅 :157 一行（02·C2→01·C2，diff 实核 1+/1−） |
| scripts/audits/2026-09-16_evolve-e2-log.md | 本单 | 真退出码实录（untracked 惯例不入 commit） |

## 3. 红证与变异红证（四批，真退出码详见 e2-log）

| 批 | 红（实现前） | 绿 | 变异红证 |
|---|---|---|---|
| b3 | 自检 10 向量 FAIL exit=1；CLI `--date foo` 静默接受（窗口=foo 零报错；exit 1 系既有 RED 回退检出，甄别实据在 log） | 自检全过 exit=0；三非法值 [usage]+exit=1；合法日期/--hours 正常且 cfg 哈希零漂移 | 撤分量回环判（只留 NaN）→坏日 2 向量翻红 exit=1（CLI 面被既有 RED 掩蔽=断言式自检为权威面） |
| b4 | 三脚本自检 5 向量 FAIL exit=1（TypeError 被 try/catch 捕为 THREW） | 三自检全过（10/19/19 内含新向量）+validate/hash 路径不劣化 | check-hardcode 守卫短路禁用→其向量翻红 18/19 exit=1 |
| b5 | grep 实录：R2b/R5/R4/R8 四处无 timeout；R1=1,260,000<4,835,000 且无 killSignal（红态=不达标面） | 全量 regression 8/8（R1 SKIP）exit=0；结构自检五处全带看护 | R8 timeout 压 1ms→子进程被杀 status=null→FAIL 点名（非静默）exit=1=看护击发实证 |
| b7 | 强化自检 11 向量 FAIL exit=1（并引出真发现：06 无 §8.6，8.6 系 02 章节——原恒真断言盲点）；主扫 WARN×0=现存断锚未检出 | 自检 16/16 exit=0；扩面主扫恰报 WARN×1（01:157）零误报；P-4 改指后 WARN×0/FAIL×0 | 登记表缺失文档误判合法→合成负例 02·C2+两位条目 2 向量翻红 exit=1（活库已修净只能靠自检捕捉=C3 要求保留合成负例的正当性实证） |

## 4. 五处 timeout 实测×裕量表+R1 推导（b5）

实测法=各命令连跑 5 轮墙钟取 max（临时脚本驱动，cwd 拟真各 R 项实际调用形态；R5 在 tmp
cwd 跑防真实落账）：

| 位 | 命令 | min/max(ms) | ×5(max) | 取值 | 取值裕量与依据 |
|---|---|---|---|---|---|
| R2b:94 | ds-call-v2 --dry-run | 51/65 | 325 | **5,000** | 取整到 5s 档：≥×5 且吸收 Windows 首启/杀软扫描抖动（与 R10 同类 mock 路径 60s 先例同向不放大到分钟级） |
| R5:119 | ds-call-v2 --mock-source 全链 429 | 155/208 | 1,040 | **5,000** | 同上（×24） |
| R4:184 | org-config.mjs hash | 38/49 | 245 | **5,000** | 同上（×102） |
| R8:231 | log-triage --self-test | 41/54 | 270 | **5,000** | 同上（×93） |
| R1:398 | ds-call-v2 --source 真实派发 | 不可实测（SKIP 配给保护） | 派生见下 | **5,400,000** | 见下 |

R1 推导（P-2/P-3 单源）：合法最坏=链长 4×派发器 CALL_TIMEOUT_MS 20min（4×1,200,000）
+35s 进程装载/落账开销（35,000）=**4,835,000ms**；裕量取 ×1.117→90min=5,400,000ms
（整数分钟档、∈裁决 C5 机检窗 [4,835,000, 7,200,000]、未裁剪至派生值以下）；原值
1,260,000 低于派生值=合法最坏链会被先杀误报 FAIL。R1 零运行时实证（SKIP）——替代验证=
本表推导复算+门一 diff 审；残留登记移交 b9（计划 v3 b5 既定条目）。

## 5. ·XN 全库前置普查清单+处置表（P-4⑤；grep 面=references/*.md+SKILL.md+RESIDUALS.md+scripts/*.mjs 头注）

| # | 位置 | 引用 | 判定 | 处置 |
|---|---|---|---|---|
| 1 | SKILL.md:141 | 04·SY-1 | 合法（04 有 SY-1） | 不动 |
| 2 | SKILL.md:144 | 01·E2 | 合法 | 不动 |
| 3 | references/01-org-principles.md:157 | **02·C2** | **断锚**（C2 系 01 条目；02 无条目登记表） | **P-4 终裁改指 01·C2（b7 批内修，机器证：改前 WARN×1/改后 WARN×0）** |
| 4 | references/02-pipeline-templates.md:18 | 01·B5 | 合法 | 不动 |
| 5 | references/02-pipeline-templates.md:204 | 06·v1.1 | 小写版本串=免误伤（不命中） | 不动 |
| 6 | references/03-machine-enforcement.md:3 | 01·A2 | 合法 | 不动 |
| 7 | references/07-role-cards.md:3 | 01·E2 | 合法 | 不动 |

**登记表外新断锚=1 处（恰为 P-4 预判位），≤5 随批修成立，无 BLOCKED 项。** scripts/*.mjs
头注 ·XN 命中 0。扩面主扫终态=对现存全库 WARN×0（7 处普查项全部通过或免误伤）。

## 6. providers 消费点普查清单（P-2；面=白名单 8 脚本+health-scan，grep+逐处实读）

| 文件:行 | 消费点 | null 安全 | 处置 |
|---|---|---|---|
| log-triage.mjs:38→63 | buildAliasMap `p.uuid_prefix` | ✗ 裸取 | **b4 已修**（p?.uuid_prefix） |
| log-triage.mjs:283 | `merged.providers?.[a]` 真值判 | ✓ 已守卫 | 不动 |
| org-config.mjs:100-108 | validateProviders `def.uuid_prefix`+`near[1].name` | ✗ 双裸取 | **b4 已修**（null def→错误行 continue；near?.[1]?.name） |
| org-config.mjs:113/119 | `cfg.providers[alias]` 真值判 | ✓（null→falsy→错误行） | 不动 |
| check-hardcode.mjs:64-66 | deriveHostModelTerms `p.models`（宿主原始 JSON） | ✗ 裸取 | **b4 已修**（降级行+continue+exit 5 族） |
| ds-call-v2.mjs:159-160 | loadSources `def.uuid_prefix` | ✓ 间接受护（validateProviders 前置闸门 errors→exit 3；b4 修后 null def 在 validate 即拦） | 不动（防线链报告注明） |
| ds-call-v2.mjs:439 | `merged.providers?.[alias]?.billing` | ✓ 已守卫 | 不动 |
| glm-look.mjs:150 | discoverSources `prov.options`（宿主原始 JSON） | ✗ **裸取——本单新发现** | **登记不修**（glm-look=E1 已落面，简报禁改其行为；移交主控→b9 处置） |
| regression.mjs:349 | R10 mock 宿主配置 fixture 字面量 | n/a（构造面非消费面） | 不动 |
| health-scan.mjs | — | **零命中**（grep 'provider' 计数 0） | 无消费点（简报 P-2 的「health-scan 命中→登记不修」预案未触发） |
| skill-gc.mjs / check-anchors.mjs | — | 零命中 | 无消费点 |

注：deepMerge 语义=显式 null 删除键，merged.providers 经文件装载路径不可达 null 值——
org-config 侧守卫为纵深防御；宿主原始 JSON（readHostConfig/宿主 config 直读）侧 null 条目
可达=真实坏配置面（check-hardcode/glm-look 即此类）。

## 7. commit 哈希清单（四笔，未 push；`git commit -F <UTF-8 文件>`）

| commit | 批 | 文件（stat 实核） |
|---|---|---|
| **2c91ddd** | b3 | scripts/log-triage.mjs（66+/14−） |
| **3f0c080** | b4 | scripts/org-config.mjs+check-hardcode.mjs+log-triage.mjs（36+/7−） |
| **58fb979** | b5 | scripts/regression.mjs（8+/6−） |
| **67a60e1** | b7 | scripts/check-anchors.mjs+references/01-org-principles.md（75+/12−；01 仅 :157 单行 1+/1−） |

工作树净（仅 scripts/audits/ 下 untracked 惯例件：plan/brief/e1/e2 系列同态，报告与 log
不入 commit——承 E1 惯例）。

## 8. 终态门禁（真退出码，e2-log §4.5 全文）

| 命令 | 结果 | exit |
|---|---|---|
| node scripts/regression.mjs | **8/8 过，SKIP ×1**（R1 配给保护） | 0 |
| node scripts/check-hardcode.mjs | 命中 0（白名单豁免 33） | 0 |
| node scripts/check-anchors.mjs | **WARN ×0 / FAIL ×0**（合成负例仅在 self-test 内部） | 0 |
| node scripts/check-anchors.mjs --self-test | 16/16 过 | 0 |
| node scripts/health-scan.mjs --project . | **RED ×0 / WARN ×2**（=基线存量，不劣化） | 0 |

零新增命中达成（纪律 §4 全量不回退 ✓）。

## 9. 自裁申报（逐条）

1. **b3 语义校验形态超简报字面**：P-1 写「new Date 解析后 Invalid/NaN=拒」；实测本机 V8
   （Node v25.2.1）ISO 解析对日溢出**回卷**（`new Date('2026-02-30T00:00:00Z')`=有效
   epoch=03-02）仅月越界才 NaN——单靠 NaN 判拒不住 P-1 自己列的 2026-02-30 负例向量。
   实现取超集：NaN 判+UTC 年/月/日分量回环比对（P-1 向量全过的必要形态；简报口径的字面
   子集被实证证伪，按 P-1 意图「真实存在的日期」落地）。
2. **b3 --date 窗口新增上界**：P-1 字面只言「窗口 epoch 化+UTC 日界」未明言上界；原实现
   仅下界。为使「上海本地 09-17 02:00 行**归** 09-16 窗」向量对本地日窗口有区分力，落
   [UTC 零点,次 UTC 零点) 双边窗（--hours 保持无上界原状）。行为差=显式 --date 过去日时
   外链路流水与 metadata 收割不再收次日以后行（原会收）；缺省当日/--hours 路径零差。
   已入 commit message 行为变化申报（P-6① 扩面）。
3. **b4 org-config 自检计数动态化（7→10 向量时顺手）**：原「self-test 全过（7 向量）」
   硬编码数字会随向量增删漂移撒谎，改 `${n}` 动态——超出 P-2 字面但属同文件自检最小
   卫生（A4 同族预防），无行为面差。
4. **b5 四处秒级路径取整到 5s 档（非精确 ×5 值）**：×5 实测=325/1040/245/270ms，逐值
   落地会在 Windows 抖动下假杀；取整 5s（×24~×102 裕量）+推导表全量入报告供裁决复核
   （P-3 只钉 R1 数值窗，秒级路径留「×5 裕量+取整」裁量——已按上限透明化）。
5. **b7 §引用正则附加邻接守卫（(?<![\d-])/(?!\d)）**：简报给形 `([01]\d|\d)` 未言邻接
   约束；无守卫时日期串尾部（如 2026-09-16 后接 §）会误配 16 号文档。前置普查实证扫描
   面零命中单数字/10+ 形态，守卫为防未来误伤的收紧向自裁（不影响现存任何引用）。
6. **b7 红态中自检向量锚修正一次**：首版向量断言「06 含 §8.6」翻红后查证=06 无 8.6
   （8.6 系 02:204 章节）——测试件错误（原恒真断言正是被此盲点骗过），修向量非修实现；
   按测试件修正口径申报（承 E1 先例），被测面红证口径不变。
7. **报告与 log 不入 commit**：承 scripts/audits/ 既有 untracked 惯例（E1 第 7 条同款）。

## 10. 疑虑与残留（移交主控/b9）

- **glm-look.mjs:150 `prov.options` 对 null 宿主条目裸取**（discoverSources，宿主原始
  JSON 侧可达）——M3 同族第 4 消费点，本单白名单外+glm-look=E1 已落面，**登记不自修**，
  请主控转 b9/后续批处置（消费点普查表 §6）。
- R1 超时值零运行时实证（SKIP 配给保护）——替代验证=推导复算表（§4）+门一 diff 审；
  冻结裁决前须跑 --r1 或显式登记欠账（既有态，b9 承接）。
- health-scan providers 消费点零命中（P-2 预案未触发）——若后续 health-scan 演进出
  providers 消费面，b9 无需动作，下次普查自然纳入。
- log-triage 头注 :18 退出码行本批最小增补（非法 --date=1）；b8 头注指针化批会重整该行
  ——两批衔接无冲突（本批保持字面真）。
- check-anchors-calibration 在册项（RESIDUALS:56）：本批已消「自检 head 断言恒真未拷打
  解析逻辑」一项（16 向量真实解析）；其余三项（全角冒号形态/roles/*.dod.md 扫描面/
  PROJECT_NAMES 漂移面）仍 open，归 --strict 升级前置批——b9 登记时可视情补注本批进展。

MODEL-SELF: model-field:builtin:bigmodel-coding-plan/GLM-5.3
LEDGER-CLAIM: role=ops-executor executor=model-field:builtin:bigmodel-coding-plan/GLM-5.3 units=4 outcome=done
