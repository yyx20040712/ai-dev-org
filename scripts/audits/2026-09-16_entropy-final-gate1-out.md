[routing]: run=20260916130256-eely source=kimi-main model=kimi-k3 role=gate1-reviewer@fb86152e cfg=8296eaf4dc7e switches=0 usage=in=0,out=11103 latency=593592ms (by ds-call-v2 链)

# 门一终审：实现批 diff 复核（批次 1-8）

## 逐条发现

**W1 — R4 skipIf 放宽面无闸门，且致 ledgerReq 死分支（b8 / 假设 1）**
定位：regression.mjs R4 段 `skipIf: (e) => e.schema_version === undefined`。
问题：包内自述依据=「02 §9 已立新增写入者必带 schema_version 纪律」，但该纪律本身无机检——R4 恰是唯一的账本行校验机检，放宽后**没有任何机检能抓住漏带字段的新写入者**，自我引用式免责。且 skipIf 拦截后，ledgerReq 闭包内 `e.schema_version !== undefined ? [...base, ...LEDGER_V2...] : base` 的 false 分支永不达（A4 死代码）。
建议：skipIf 应加截止条件（如 `e.ts < '2026-09-16'` 冻结日或 `MANUAL_EVENTS.includes(e.event)`），skipped 超阈值即 FAIL；删 ledgerReq 死分支。

**W2 — R1 三形态容错声明与 diff 代码面不符（§1「实施后追加」/ §2.5）**
定位：regression.mjs R1 行 `verdicts[src] = /判定\s*[:：]\s*PASS/i.test(out) ? 'PASS' : /判定\s*[:：]\s*FAIL/i ... : 'UNPARSEABLE'`。
问题：任务书两处声称「判定|verdict|裸 PASS/FAIL 三形态容错已加」，但送审 diff 中该行仍是单形态（仅「判定:」前缀）。裸 PASS 输出仍落 UNPARSEABLE→假 FAIL，正是 §2.5 抖动机理的源头。机器事实（D1）与实现者报告冲突：容错或未提交，或报告失实。
建议：补齐容错提交并重跑 R1 留证，或修正报告措辞为「容错未落地，抖动残留照旧」。

**W3 — glm-look 的 truncated 派生缺 finish_vocab 拒跑守卫，与本批自我纪律不一（b5/b7）**
定位：glm-look.mjs `const completeFinishes = new Set(ORG_CFG.finish_vocab?.complete || []); const truncatedFlag = !completeFinishes.has(norm.finish)`。
问题：同批 ds-call-v2（`if (complete.size === 0 ...) process.exit(3)`）与 log-triage（装载守卫 exit 3）均已立「缺表=配置错拒跑」，唯独 glm-look 用可选链静默兜底——finish_vocab 缺失时 completeFinishes 为空集，**truncated 恒 true**，每条 ok 流水静默落错误派生字并打印误导性告警。这正是本批宣称要消灭的静默假数据形态。
建议：对齐拒跑（缺词表 exit 3），勿用 `|| []` 兜底。

**W4 — check-hardcode 降级留痕只覆盖「损坏」，不覆盖「缺失」（b8）**
定位：check-hardcode.mjs `if (!existsSync(hostCfgPath)) return terms`（无留痕）对照 catch 分支的 `[degraded]...退出码 5`。
问题：宿主配置解析失败会降级+exit 5，但宿主配置**整个不存在**时仍静默返回空词表——漏检面（供应商词表丢失）完全相同，却无任何留痕，非 strict 下假绿。另：`strict && effective.length ? 1 : DEGRADED ? 5 : 0` 中 strict 命中+降级同时发生时 exit 1 吞掉降级信号。
建议：existsSync=false 亦置 DEGRADED（或要求显式 `--no-host-config` 确认）；exit 1 与 5 可考虑合并编码或在汇总行显式并记。

**N1 — check-anchors 三面校准期固有盲点（b3）**
定位：锚正则 `/0([1-9])\s*§\s*(\d+(?:\.\d+)?)/` 仅覆盖 01–09 号文件；标题索引正则 `[.、:\s]` 不含全角冒号，「## 5.8：总表」形态标题将漏索引→假 WARN；扫描面不含 scripts/roles/*.dod.md（其内恰新增「references/02 §3」指引）；`PROJECT_NAMES` 硬编码豁免名单（如 `check-tickets.mjs`）构成白名单漂移面。自检 t('head-8.6', heads.has('8.6'), true) 为恒真断言，未真正拷打解析逻辑。试点 WARN 级可接受。
建议：校准期登记为已知分类，升格 --strict 前处理全角冒号与 dod 扫描面。

**N2 — log-triage 同秒判重键存在反向误剔面（b4）**
定位：`key: \`${d.sessionId || ''}|${(d.timestamp || '').slice(0, 19)}\``。
问题：同秒同会话的两起**不同**错误（重试 attempt 各落一行）时，request.failed 会被 network.failed 键误剔→低估真实失效。另 network.failed 的 attempt 计数分支行是否入 netFailRaw 影响剔重正确性——diff 上下文不足，**不确定**。当前为明示取舍，较原 _dup 空设计严格更优。
建议：--health 输出暴露剔重计数（`deduped ×N`），供人工判读置信度。

**N3 — 契约破坏面清单（§3.3 拷问回应）**
glm-look/skill-gc 用法错 2→1、ds-call-v2/log-triage 缺 finish_vocab 拒跑（exit 3）、glm-look 顶部即 loadOrgConfig（org-config 不可载时连 --list-sources 都不可用）。对依赖旧退出码的 runbook/CI 模板与存量缺词表的项目覆盖件均为行为变更。包内无法确认外部调用方现状（不确定），但总表=06 §5.8 的迁移注记未见于本 diff（文档面另册，无法裁决）。
建议：06 §5.8 附「旧码→新码」迁移行；auditor 册核对。

**N4 — R7 反例正则形态过窄（b2）**
定位：`const inline = /ts\/project\/event|ts,project,event/.test(txt)`。
问题：内联清单若写作「ts、project、event」（顿号）或空格枚举即绕过反例判据；正向判据依赖「行 schema」字样，措辞改（如「账本行结构」）即失守。
建议：反例扩形态，或改为机读比对 02 §9 字段清单本身。

## 拷问回应摘要

- **假设 1（R4）**：取舍不成立为「安全」——见 W1，自我引用式免责，需截止条件兜底。
- **假设 2（scrub 对账）**：成立。R9 正则字面量比对 fail-closed（任一文件重排格式即 FAIL），钉同步有效；残余面=未跑 regression 时漂移可溜出，属流程面非代码面。
- **假设 3（endpoint_contains）**：成立。「/anthropic」「deepseek」为协议/端点形态，住 org-config 合法；聚合网关代发 deepseek 模型会漏配，但配置可改，非硬编码病。
- **预裁 A（vision_channels 独立分区）**：成立。不动 roles 注册表、宿主 config 仍掌端点/key、脚本零硬编码，未发现第三例外；discoverSources 统一后 glm/ds 两通道行为与原实现逐行等价（偏好序粒度变细为数组序，属声明内变更）。

## 总评与放行意见

八批次落地质量整体高：mock 标志贯穿 switch/exhaust、_dup 空设计真去重替换、自检全 fixture 聚合、byRole 死码删除、URL pathname 手拼根除、退出码统一均有逐行证据；新脚本 check-anchors 三面设计克制（WARN 试点+golden 对账 FAIL）。无阻断级偏差。四处 W 均为「本批自我宣称纪律的执行缺口」而非新引入架构病，修复成本低。

**放行意见：有条件放行**——条件=W2（R1 容错声明与代码对齐，涉 D1 诚实性）与 W3（glm-look 拒跑对齐）本批内清偿；W1/W4 可登记残留随下批，但 W1 须在 RESIDUALS 显式挂「漏带 schema_version 即静默免检」风险行。

FINDINGS: B=0 W=4 N=4 VERDICT=PASS