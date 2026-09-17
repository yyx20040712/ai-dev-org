# evolve-E1 实录日志（命令真退出码）

## 基线（改前）
PASS R2a 档案装载 vs golden 字节比对+MANIFEST 一致 gate1-reviewer:= drafter:= auditor-readonly:=
PASS R2b 派发器 dry-run assembled_system vs golden gate1-reviewer:= drafter:= auditor-readonly:=
PASS R5 exit=2(期2) stderr全源尽=true 事件计数 attempt=12/12 switch=2/2 exhaust=1/1（链长3推导）chain=kimi-main→kimi-backup→deepseek 账本exhaust=true
PASS R4 流水:尾100行坏0行（含未知事件0）跳0行(旧版本)外来0行(他源channel标记) 事件分布={"ok":20,"attempt":68,"switch":8,"exhaust":4}；cfg哈希一致=true（流水 a26f710a540d vs live cfg:a26f710a540d）；账本:尾50行坏0行（含未知事件0）跳30行(旧版本)外来0行(他源channel标记) 事件分布={"ok":15,"exhaust":4,"ruling":1}
PASS R7 账本 schema 指针唯一指向 02 §9 SKILL.md:✓ org-seg.snippet:✓
PASS R8 exit=0 自检含验收断言=true
PASS R9 scrub 复制体与源字面量一致=true
SKIP R1 未给 --r1——真实派发配给保护，~9k Kimi tokens；冻结裁决前须跑或显式登记欠账（SKIP 不计入通过数——ds-W6）

regression 汇总：7/7 过，SKIP ×1（未跑项不计入通过数）（项=R2a/R2b/R5/R4/R7/R8/R9/R1）
exit=0
[info] 白名单豁免 33 处（13 条规则）
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
exit=0
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
exit=0
[WARN] 账本存在 1 行 ok 缺 usage 字段——预算累计会低估，修复记账后重扫
[WARN] 账本存在 4 行 in=0 而 out>0——疑缓存命中未计（cache_read_input_tokens 未并），预算累计低估（P2-5）
[info] 账本跳过 1 个临时演练项目（os.tmpdir() 前缀——P0-1 判据）：C:\Users\ADMINI~1\AppData\Local\Temp\r5-692zCI
[info] 项目 synapse：exhaust 后已补还（ok 2026-09-16）
[info] 项目 E:/class/智水蓝图/waterprint：exhaust 后已补还（ok 2026-09-13）
[info] 账本 41 行无 truncated 字段（schema v1 历史行）——④ 对历史行豁免，其覆盖率为已知欠账
[info] 尾窗 ok 源分布：kimi-main/deepseek/builtin:bigmodel-coding-plan/kimi-backup/session
[info] 用量 kimi-main：27 次 ok，累计 in=176,480 out=147,713
[info] 用量 deepseek：22 次 ok，累计 in=146,718 out=307,727
[info] 用量 kimi-backup：2 次 ok，累计 in=9,345 out=21,143
[info] 用量 builtin:bigmodel-coding-plan：4 次 ok，累计 in=343,911 out=16,939
health-scan 汇总：RED ×0 / WARN ×2（WARN 不阻断但须回显计数，累计出现即按升格条件处置，W-1）（账本行 76/流水行 877/窗口 20/审计岗 drafter,gate1-reviewer,auditor-readonly）——可收口
exit=0

## TDD 红证（R10 先行，b1/b2/b6 未实现）
file:///C:/Users/Administrator/.zcode/skills/ai-dev-org/scripts/regression.mjs:306
  const vecFail = (r) => `FAIL(exit=${r.status} 「${[...(r.stdout || ''), ...(r.stderr || '')].split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 2).join('|')}」)`
                                                                                              ^

TypeError: [(...(r.stdout || "")),(...(r.stderr || ""))].split is not a function
    at vecFail (file:///C:/Users/Administrator/.zcode/skills/ai-dev-org/scripts/regression.mjs:306:95)
    at file:///C:/Users/Administrator/.zcode/skills/ai-dev-org/scripts/regression.mjs:307:48
    at ModuleJob.run (node:internal/modules/esm/module_job:413:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:654:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v25.2.1
exit=1
FAIL R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=1「const r = await fetch(url, { method: "POST", heade」 node:http(s)import=✗；③向量:splitEndpoint=FAIL(exit=1 「」)/classify+ensure=FAIL(exit=1 「」)；②mock往返:跳过（splitEndpoint 未导出=b1 传输层未落，env 钩子未就位——跑则触真实宿主源发现）

regression 汇总：0/1 过，FAIL ×1（项=R10）
exit=1

（修 vecFail 帮助函数与向量脚本命名空间 import 后重跑红证）
FAIL R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=1「const r = await fetch(url, { method: "POST", heade」 node:http(s)import=✗；③向量:splitEndpoint=FAIL(exit=1 「FAIL splitEndpoint 未导出（b1 待实现）」)/classify+ensure=FAIL(exit=1 「」)；②mock往返:跳过（splitEndpoint 未导出=b1 传输层未落，env 钩子未就位——跑则触真实宿主源发现）

regression 汇总：0/1 过，FAIL ×1（项=R10）
exit=1

## b1 实现后（R10 应半绿：①绿②绿③splitEndpoint 绿/classify+ensure 仍红）
FAIL R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=0 node:http(s)import=✓；③向量:splitEndpoint=FAIL(exit=1 「FAIL https 显式端口 8443|FAIL http 显式端口 3000」)/classify+ensure=FAIL(exit=1 「」)；②mock往返:跳过（splitEndpoint 未导出=b1 传输层未落，env 钩子未就位——跑则触真实宿主源发现）

regression 汇总：0/1 过，FAIL ×1（项=R10）
exit=1
FAIL R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=0 node:http(s)import=✓；③向量:splitEndpoint=全过/classify+ensure=FAIL(exit=1 「」)；②mock往返:glm=✗(exit=null stderr尾=[glm-look] source=mock-glm model=GLM-5.3-Flash images=1 max_tokens=8000 )/ds=✗(exit=null stderr尾=[ds-look] source=mock-ds model=deepseek-flash images=1 max_tokens=8000 )

regression 汇总：0/1 过，FAIL ×1（项=R10）
exit=1

（mock 往返改异步 spawn——spawnSync 冻结父进程事件循环致本进程内 server 无法应答，实测定位后修正）
FAIL R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=0 node:http(s)import=✓；③向量:splitEndpoint=全过/classify+ensure=FAIL(exit=1 「」)；②mock往返:glm=✓(exit=0 正文+流水attempt/ok行)/ds=✓(exit=0)

regression 汇总：0/1 过，FAIL ×1（项=R10）
exit=1

## b1 后全量（R10 预期仍红=classify/ensure 待 b2/b6；其余须全绿）
PASS R2a 档案装载 vs golden 字节比对+MANIFEST 一致 gate1-reviewer:= drafter:= auditor-readonly:=
PASS R2b 派发器 dry-run assembled_system vs golden gate1-reviewer:= drafter:= auditor-readonly:=
PASS R5 exit=2(期2) stderr全源尽=true 事件计数 attempt=12/12 switch=2/2 exhaust=1/1（链长3推导）chain=kimi-main→kimi-backup→deepseek 账本exhaust=true
PASS R4 流水:尾100行坏0行（含未知事件0）跳0行(旧版本)外来0行(他源channel标记) 事件分布={"attempt":73,"ok":12,"switch":10,"exhaust":5}；cfg哈希一致=true（流水 a26f710a540d vs live cfg:a26f710a540d）；账本:尾50行坏0行（含未知事件0）跳30行(旧版本)外来0行(他源channel标记) 事件分布={"ok":15,"exhaust":4,"ruling":1}
PASS R7 账本 schema 指针唯一指向 02 §9 SKILL.md:✓ org-seg.snippet:✓
PASS R8 exit=0 自检含验收断言=true
PASS R9 scrub 复制体与源字面量一致=true
FAIL R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=0 node:http(s)import=✓；③向量:splitEndpoint=全过/classify+ensure=FAIL(exit=1 「」)；②mock往返:glm=✓(exit=0 正文+流水attempt/ok行)/ds=✓(exit=0)
SKIP R1 未给 --r1——真实派发配给保护，~9k Kimi tokens；冻结裁决前须跑或显式登记欠账（SKIP 不计入通过数——ds-W6）

regression 汇总：7/8 过，FAIL ×1，SKIP ×1（未跑项不计入通过数）（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）
exit=1
[info] 白名单豁免 33 处（13 条规则）
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
exit=0
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
exit=0

## b2 实现后（R10 ③classify 应绿，ensure 仍红=b6 承接）
FAIL R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=0 node:http(s)import=✓；③向量:splitEndpoint=全过/classify+ensure=FAIL(exit=1 「FAIL 纯函数未导出（b2/b6 待实现）」)；②mock往返:glm=✓(exit=0 正文+流水attempt/ok行)/ds=✓(exit=0)

regression 汇总：0/1 过，FAIL ×1（项=R10）
exit=1

### b2 端到端分类验证
[node-guard] 当前 Node v25.2.1 主版本 25 在 org-config supported_node.forbid_major 内——已知退出阶段 libuv 断言崩溃面（残留册 HOST-node25）。外部派发请改用受支持版本（如 Node 24）。本次继续执行，运行结果与落账已完成，崩溃仅发生在退出阶段。
角色注册表（registry_version=1.1.0；路径相对技能根；源路由=org-config 优先/registry 兜底）：
  gate1-reviewer | source=chain（org-config） tier=audit | scripts/roles/gate1-reviewer.md
  drafter | source=chain（org-config） tier=prime | scripts/roles/drafter.md
  auditor-readonly | source=deepseek（org-config） tier=debt-readonly | scripts/roles/auditor-readonly.md
exit-config-broken=0
[fatal] org-config 装载失败: JSON 解析失败 C:\Users\Administrator\AppData\Local\Temp\tmp.GHiP5904Ck\.zcode\org-config.json: Expected property name or '}' in JSON at position 2 (line 1 column 3)
exit-unknown-role=3
[fatal] org-config 装载失败: JSON 解析失败 C:\Users\Administrator\AppData\Local\Temp\tmp.GHiP5904Ck\.zcode\org-config.json: Expected property name or '}' in JSON at position 2 (line 1 column 3)
exit-bad-mockspec=3

（干净 tmp 复测用法类——上一轮坏配置先炸遮蔽了 role 校验）
[node-guard] 当前 Node v25.2.1 主版本 25 在 org-config supported_node.forbid_major 内——已知退出阶段 libuv 断言崩溃面（残留册 HOST-node25）。外部派发请改用受支持版本（如 Node 24）。本次继续执行，运行结果与落账已完成，崩溃仅发生在退出阶段。
[fatal] 未知角色: nope（可用角色见 --list-roles）
exit-unknown-role=1
[node-guard] 当前 Node v25.2.1 主版本 25 在 org-config supported_node.forbid_major 内——已知退出阶段 libuv 断言崩溃面（残留册 HOST-node25）。外部派发请改用受支持版本（如 Node 24）。本次继续执行，运行结果与落账已完成，崩溃仅发生在退出阶段。
[fatal] --mock-source 需要 <alias>:<status>（可逗号并列多点，形如 kimi-main:429,deepseek:500）
exit-bad-mockspec=1

## b2 后全量（R10 仅剩 ensure 面红=b6 承接，其余须全绿）
PASS R2a 档案装载 vs golden 字节比对+MANIFEST 一致 gate1-reviewer:= drafter:= auditor-readonly:=
PASS R2b 派发器 dry-run assembled_system vs golden gate1-reviewer:= drafter:= auditor-readonly:=
PASS R5 exit=2(期2) stderr全源尽=true 事件计数 attempt=12/12 switch=2/2 exhaust=1/1（链长3推导）chain=kimi-main→kimi-backup→deepseek 账本exhaust=true
PASS R4 流水:尾100行坏0行（含未知事件0）跳0行(旧版本)外来0行(他源channel标记) 事件分布={"ok":5,"attempt":77,"switch":12,"exhaust":6}；cfg哈希一致=true（流水 a26f710a540d vs live cfg:a26f710a540d）；账本:尾50行坏0行（含未知事件0）跳30行(旧版本)外来0行(他源channel标记) 事件分布={"ok":15,"exhaust":4,"ruling":1}
PASS R7 账本 schema 指针唯一指向 02 §9 SKILL.md:✓ org-seg.snippet:✓
PASS R8 exit=0 自检含验收断言=true
PASS R9 scrub 复制体与源字面量一致=true
FAIL R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=0 node:http(s)import=✓；③向量:splitEndpoint=全过/classify+ensure=FAIL(exit=1 「FAIL 纯函数未导出（b2/b6 待实现）」)；②mock往返:glm=✓(exit=0 正文+流水attempt/ok行)/ds=✓(exit=0)
SKIP R1 未给 --r1——真实派发配给保护，~9k Kimi tokens；冻结裁决前须跑或显式登记欠账（SKIP 不计入通过数——ds-W6）

regression 汇总：7/8 过，FAIL ×1，SKIP ×1（未跑项不计入通过数）（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）
exit=1
[info] 白名单豁免 33 处（13 条规则）
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
exit=0
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
exit=0

## b6 实现后（R10 应全绿=转绿点）
PASS R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=0 node:http(s)import=✓；③向量:splitEndpoint=全过/classify+ensure=全过；②mock往返:glm=✓(exit=0 正文+流水attempt/ok行)/ds=✓(exit=0)

regression 汇总：1/1 过（项=R10）
exit=0

## 变异红证 1（b1 面：postJson 调用点临时恢复 fetch——预期 R10 ①红）
FAIL R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=1「const r = await fetch(url, { method: "POST", heade」 node:http(s)import=✓；③向量:splitEndpoint=全过/classify+ensure=全过；②mock往返:glm=✓(exit=0 正文+流水attempt/ok行)/ds=✓(exit=0)

regression 汇总：0/1 过，FAIL ×1（项=R10）
exit=1

## 变异红证 2（b2 面：classifyExitCode 翻转 ConfigError→1——预期 R10 ③ds 红）
FAIL R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=0 node:http(s)import=✓；③向量:splitEndpoint=全过/classify+ensure=FAIL(exit=1 「FAIL 分类:配置 ConfigError→3」)；②mock往返:glm=✓(exit=0 正文+流水attempt/ok行)/ds=✓(exit=0)

regression 汇总：0/1 过，FAIL ×1（项=R10）
exit=1

## 变异还原后终验（全量回归+门禁三扫）
PASS R2a 档案装载 vs golden 字节比对+MANIFEST 一致 gate1-reviewer:= drafter:= auditor-readonly:=
PASS R2b 派发器 dry-run assembled_system vs golden gate1-reviewer:= drafter:= auditor-readonly:=
PASS R5 exit=2(期2) stderr全源尽=true 事件计数 attempt=12/12 switch=2/2 exhaust=1/1（链长3推导）chain=kimi-main→kimi-backup→deepseek 账本exhaust=true
PASS R4 流水:尾100行坏0行（含未知事件0）跳0行(旧版本)外来0行(他源channel标记) 事件分布={"attempt":80,"switch":13,"exhaust":7}；cfg哈希一致=true（流水 a26f710a540d vs live cfg:a26f710a540d）；账本:尾50行坏0行（含未知事件0）跳30行(旧版本)外来0行(他源channel标记) 事件分布={"ok":15,"exhaust":4,"ruling":1}
PASS R7 账本 schema 指针唯一指向 02 §9 SKILL.md:✓ org-seg.snippet:✓
PASS R8 exit=0 自检含验收断言=true
PASS R9 scrub 复制体与源字面量一致=true
PASS R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=0 node:http(s)import=✓；③向量:splitEndpoint=全过/classify+ensure=全过；②mock往返:glm=✓(exit=0 正文+流水attempt/ok行)/ds=✓(exit=0)
SKIP R1 未给 --r1——真实派发配给保护，~9k Kimi tokens；冻结裁决前须跑或显式登记欠账（SKIP 不计入通过数——ds-W6）

regression 汇总：8/8 过，SKIP ×1（未跑项不计入通过数）（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）
exit=0
[info] 白名单豁免 33 处（13 条规则）
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
exit=0
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
exit=0
[WARN] 账本存在 1 行 ok 缺 usage 字段——预算累计会低估，修复记账后重扫
[WARN] 账本存在 4 行 in=0 而 out>0——疑缓存命中未计（cache_read_input_tokens 未并），预算累计低估（P2-5）
[info] 账本跳过 1 个临时演练项目（os.tmpdir() 前缀——P0-1 判据）：C:\Users\ADMINI~1\AppData\Local\Temp\r5-692zCI
[info] 项目 synapse：exhaust 后已补还（ok 2026-09-16）
[info] 项目 E:/class/智水蓝图/waterprint：exhaust 后已补还（ok 2026-09-13）
[info] 账本 41 行无 truncated 字段（schema v1 历史行）——④ 对历史行豁免，其覆盖率为已知欠账
[info] 尾窗 ok 源分布：kimi-main/deepseek/builtin:bigmodel-coding-plan/kimi-backup/session
[info] 用量 kimi-main：27 次 ok，累计 in=176,480 out=147,713
[info] 用量 deepseek：22 次 ok，累计 in=146,718 out=307,727
[info] 用量 kimi-backup：2 次 ok，累计 in=9,345 out=21,143
[info] 用量 builtin:bigmodel-coding-plan：4 次 ok，累计 in=343,911 out=16,939
health-scan 汇总：RED ×0 / WARN ×2（WARN 不阻断但须回显计数，累计出现即按升格条件处置，W-1）（账本行 76/流水行 922/窗口 20/审计岗 drafter,gate1-reviewer,auditor-readonly）——可收口
exit=0
