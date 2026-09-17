# 实现简报 E2（b3+b4+b5+b7）——领单号 evolve-E2

## 1. 身份与禁令

- 你=ai-dev-org 技能实现者岗（会话内绑定，意图档位声明：宿主绑定档）。
  技能根=C:\Users\Administrator\.zcode\skills\ai-dev-org（下称 ROOT）。
- 禁令：禁 git push；禁新依赖；禁触 scripts/roles/**（含 .golden）、
  org-config.default.json、scripts/.golden/**、templates/**、
  references/{02,03,04,05,06,07,08,09}、model-routing-log.jsonl（禁写）、
  历史审计档；禁真实外部 API 调用；禁改 E1 已落件的行为语义
  （glm-look/ds-call-v2/R10）——发现其问题=报告申报不自修。
- 本单修改面（白名单）：scripts/log-triage.mjs、scripts/org-config.mjs、
  scripts/check-hardcode.mjs、scripts/regression.mjs（仅超时看护+:2 头注行）、
  scripts/check-anchors.mjs、references/01-org-principles.md（仅 :157 一行
  P-4 改指）、新建 scripts/audits/2026-09-16_evolve-e2-*.md。超面=停手报 BLOCKED。

## 2. 必读序

1. scripts/audits/2026-09-16_evolve-plan-v3.md §3 b3/b4/b5/b7 行+§5 预裁决
2. scripts/audits/2026-09-16_evolve-e1-report.md——E1 已落面（R10/isMain/
   ConfigError/ensureWithinRoot），避免冲突
3. scripts/log-triage.mjs 全文——:38 buildAliasMap/:150-269 窗口与 --date 面
4. scripts/org-config.mjs——validateProviders（:96-121 区域）近邻提示
5. scripts/check-hardcode.mjs——deriveHostModelTerms（:60-70 区域）+降级
   exit 5 语义（:76-81 区域）
6. scripts/regression.mjs——五处 spawnSync（:86/:111/:176/:223/:253 现行
   行号，E1 后实读为准）+:2 头注 R 清单行
7. scripts/check-anchors.mjs 全文——:59-64 PROJECT_NAMES/:120 引用正则/
   --self-test 现状（head 断言恒真=在册盲点，本单强化）
8. references/01-org-principles.md :157（E2 行"02·C2"）与 :91-96（C2 条目）

## 3. 预裁决

- **P-1（b3）**：--date 校验=格式正则 `^\d{4}-\d{2}-\d{2}$` **+语义校验**
  （new Date 解析后 Invalid/NaN=拒）；非法→stderr 一行明确消息+exit 1（用法错）。
  窗口=epoch ms 化与 --hours 同路径；**日界口径=UTC**（与文件选择现状 :197
  同口径——撤回"本地零点"）；向量：负例 foo/2026-13-45/2026-02-30（exit 1）、
  UTC 日界例（Asia/Shanghai 下本地 2026-09-17 02:00 行归 UTC 2026-09-16 窗）。
  向量落 log-triage --self-test（现有骨架扩展），红态先落盘。
- **P-2（b4）**：null 守卫三处=org-config validateProviders 近邻提示
  （near[1].name 前判 near?.[1]?.name 且 null provider 产生明确校验错误行）、
  check-hardcode deriveHostModelTerms（p.models 前判 p&&p.models）、log-triage
  buildAliasMap（p.uuid_prefix 前判）。check-hardcode 对 null provider 的
  修后形态=**记降级行继续扫其余**（exit 5 语义族，不崩溃）。普查=白名单内
  8 脚本一切 providers 消费点 grep 实读过一遍，清单入报告；health-scan 的
  消费点若命中=**登记不修**（超扩权范围），发现写入报告由主控转 b9。
  向量：null-provider fixture（构造 providers 含 null 值的 merged 对象过
  各消费点）exit/输出形态断言。
- **P-3（b5）**：五处 spawnSync 全部加 timeout+killSignal；R2b/R5/R4/R8=
  秒级 mock 路径，timeout=实测耗时×5 裕量（实测法=跑一次记时长，推导入
  报告）；**R1=派生值 4,835,000ms（4×1,200,000+35,000）+裕量，取整
  ≥4,835,000 且 ≤7,200,000**（裁决岗 C5 机检口径），推导+裕量入报告。
  regression.mjs:2 头注"R1~R6"句→指针化（"R 清单单源=本脚本 --only
  项集合"形态，不落数字）。E1 的 R10 异步 spawn 看护面核实已在（报告
  注明核实结论即可，不重改）。
- **P-4（b7）**：check-anchors 扩面——①文档号正则 `0([1-9])`→两位数形态
  （`([01]\d|\d)` 或等价，支持 10+ 号文档，01-09 兼容）；②新增 NN·XN 条目型
  引用扫描：形态=文档号+`·`+大写字母组（1-4 字母，可带 `-`+数字，如
  E2/B5/WP-3/SY-1/MG-2/ORG-11）；小写（v1.1 版本串）天然排除；「」内叙述
  跳过规则延续；目标登记表**仅从 01（A1-A4/B1-B5/C1-C4/D1-D6/E1-E3）与
  04（WP/SY/MG/ORG 系）正文条目标记解析**（实读两件确认标记格式），不从
  golden 反推；断锚=WARN 级（试点口径不变）。③P-4 改指：01:157 `02·C2`
  →`01·C2`（裁决终裁，保审计链）。④--self-test 强化：正例（01·E2/04·SY-1
  合法命中）、负例（合成串 02·C2→WARN——裁决 C3 要求自检保留此合成负例）、
  免误伤例（06·v1.1/K3 编号短语不命中）、两位文档号例。红态（改造前先加
  向量证红）落盘。⑤前置普查：grep 全库（references+SKILL.md+scripts/*.mjs
  头注）一切 `·XN` 形态引用，清单入报告；若发现登记表外断锚≤5 处随批修
  （修法=P-4 同型改指或删，逐处注明依据），超限=报告 BLOCKED 申报。

## 4. 纪律

- TDD 红→绿→变异红证（每批至少一变异例）；真退出码落盘
  `scripts/audits/2026-09-16_evolve-e2-log.md`。
- 全量不回退：regression（R1 SKIP）8/8+check-hardcode 0+check-anchors
  零 WARN/FAIL+health-scan RED=0/WARN≤2。
- 分笔 commit ×4（b3/b4/b5/b7），`git commit -F <UTF-8 文件>`，风格
  `fix(evolve-bN): …`。
- 注意：check-anchors 扩面后若对现存文档报出新 WARN——那正是 b7 的职能；
  处置按 P-4⑤。终态必须 WARN×0（除合成负例在 self-test 内部）。

## 5. 基线数字（E1 后）

regression 8/8（R1 SKIP）；check-hardcode 0（豁免 33）；check-anchors
WARN×0/FAIL×0；health-scan RED×0/WARN×2；git HEAD=919f27a。
参照行号（实读为准）：log-triage 窗口≈:150-269；org-config 近邻≈:103-106；
check-hardcode p.models≈:64-65；check-anchors 正则≈:120；01 断锚=:157。

## 6. 报告契约

全文落 scripts/audits/2026-09-16_evolve-e2-report.md：实现摘要/文件清单/
红证与变异红证/五处 timeout 实测×裕量表+R1 推导/·XN 全库普查清单+处置表/
providers 消费点普查清单（含 health-scan 命中面）/commit 哈希/自裁申报/疑虑。
回复五行内。

## 7. 运行时可观察性（单源词表=02 §4）

- b3：非法 --date→stderr 明确消息+exit 1（健康检查形态）；窗口正确性=
  --self-test 向量（断言式）。
- b4：null provider→org-config/ds-call-v2 路径校验错误行 exit 3；
  check-hardcode 降级行（stderr 记数）继续扫——三形均 stderr 可见。
- b5：超时看护=挂起进程被 killSignal 终止后的 regression FAIL 消息点名
  （不静默）；R1 数值+推导入报告=审计可见。
- b7：新断锚→WARN 行（文件:行+引用串）；--self-test 向量全过=断言式。
