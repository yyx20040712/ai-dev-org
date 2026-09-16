# 审计任务书：ai-dev-org 技能优化方案 v1.0（送异源对抗审核）

> 任务性质：对抗式审核（只挑错不改写）。送审方=ai-dev-org 技能维护方（主控）。
> 审核者零仓库接触：材料自包含，全部证据已内联；不得臆测包外事实。
> 输出契约：[B|W|N] 分级逐条 + 定位（章节/条目编号）+ 建议修正案 + 末尾总评与放行意见。

## 0. 被审对象是什么

`ai-dev-org` 是一份"AI 软件开发公司"组织方法论技能（单文件 SKILL.md + 9 个
references + 8 个脚本 + 模板 + 角色注册表），服务于**单人开发者 + AI 组织**
的生产级开发。核心主张：错误必须在**合入前**现形；每个决定可追溯。

其自身的第一性纪律（本次审核的判据来源）：
- **A2 规则必须机检可达**："写进 .md 而没有检查的规则是建议"；机检优先级
  lint/CI > 单测 > e2e > 架构评审。
- **A3 单一真相源，禁双源**：两份等价声明靠注释对齐必然失守。
- **A4 占位与死代码零容忍**。
- **C2 双门独立审计**；**D1 机器事实终裁，亲验不信任自报**。
- **D5 成本入账**；**08 §3 历史件禁改写（只许追加）**。
- **06 §0 零硬编码声明**："供应商事实（源序/端点/套餐/额度/配给）一律以
  org-config 为唯一真相源……本件与 SKILL.md 均不含任何具体端点/套餐数字"。
- **08 §1 寻址表**：供应商路由事实（端点/源序/套餐数字/配给数字）的"禁止
  出现处"=**任何 .md 正文硬编码**。
- **SKILL.md 烤验机关**：收口前必跑 `health-scan.mjs`，**RED=0 方可收口**。
- **02 §10**："回炉轮数联动……超限事件=health-scan 之后的必查项"。
- **ORR-4 教训（references/04 §六）**："愿望式预算——常载层无量化防线则缓慢
  失守无报警"，其制度化=ORG-SEG 段 ≤600 非空白字符机检。

## 1. 送审方案 v1.0（拟执行）

**总目标**：修复合入前防线自身的三处"自证失效"，补齐已写下但无机检的铁律；
不改 v1.0 冻结的方法论核心原文，全部走补遗/追加。

**硬约束（不可违反）**：
1. 不改 v1.0 冻结核心原文；新增一律"补遗/追加"。
2. 不新增岗位、不扩编制。
3. 本次不动用户正在改动的 4 个文件（SKILL.md / references/06 / references/07
   / scripts/glm-look.mjs，均已有未提交改动）。
4. 不改历史件、不改既有账本行（08 §3 红线）——只许追加新行。
5. 部署期分档：P0/P2/P3 中的机检项由主控直接执行为**已裁决**；P1（新增运行时
   验证层/新事件类型）属"裁决权限三分法"负面清单，**留用户裁决**，本次只提交
   设计不改代码。

### P0-1 演练数据永久卡死收口门禁（已实测）

**现象（亲验输出）**：
```
$ node scripts/health-scan.mjs --project .        # 在技能根
[RED] 欠账未还：项目 C:\Users\ADMINI~1\AppData\Local\Temp\r5-692zCI 存在 exhaust
      （2026-09-09）且其后无补还 ok 行——按 06 §4 回退只读审并计划补还
health-scan 汇总：RED ×1（项目 9 个/账本行 39/流水行 440/窗口 20）——有 RED 不得收口
exit=1
```
**根因（已定位）**：技能根账本 `.zcode/org-ledger.jsonl` 第 1-3 行是 2026-09-09
一次 R5 全链故障注入演练留下来的 mock 事件，其 project 字段=一个临时目录，
永远不会等到补还 ok 行。`health-scan.mjs` 的欠账检查按 project 精确匹配、
**不识别 mock**，于是永久报 RED。该风险此前被登记为 won't-fix（残留册
W5-A-W4："流水行永久留在技能根流水……带 mocked 上下文可甄别；不清洗"）——
但"可甄别"是给人看的，扫描器不会甄别。
**关键细节**：三行中 switch 两行的 outcome 文本含"（mock）"字样，**exhaust 行
的 outcome 不含 mock 标记**（内容是"exhaust-debt（同源审计欠账，主控回退只读
审）"），因此按内容关键字识别 mock 会漏掉真正触发 RED 的那一行。
流水日志（model-routing-log.jsonl）中同时间段的 attempt 事件带 `mocked:true`
（同 runId `20260909025204-re1o` / `20260909025354-8mu9`），这是可机读的真相源；
但账本行 schema 不含 runId、不含 mocked，故无法用 runId 关联。

**拟修法**：
- (a) 前向：`ds-call-v2.mjs` 写账本时增 `mocked` 字段（该路径已知 mocked 状态）。
- (b) 遗留：`health-scan.mjs` 判据由"project 精确匹配"升级为"**跳过 os.tmpdir()
  前缀的 project**，并输出 INFO 计数留痕"——理由：演练按设计就在临时目录跑
  （`regression.mjs` R5 用 `mkdtempSync(tmpdir())` + `cwd=tmp`），临时目录项目
  可机读判定为演练。
- (c) 同时修 `regression.mjs` R5（可选）：确保演练永远写临时账本。

**已知副作用（须审）**：若真实项目位于临时目录，其欠账会被免检（误免）。
拟用"INFO 输出被跳过的 project 清单"缓解（留痕但不阻断收口）。

### P0-2 截断的审计报告被记为 ok（假成功）

**现象（亲验证据，取自流水日志）**：`finish` 字段在流水 ok 行中齐全（119/119），
但以下行以 `event:ok` 落账（即被当作成功产出）：
```
09-12T19:53:31  gate1-reviewer  deepseek   deepseek-v4-flash  out=32768  finish=length   ← 门一审计，撞顶
09-10T01:51:46  design-reviewer GLM-5.3-Flash                  out=8000   finish=max_tokens
09-11T00:02:27  design-reviewer GLM-5.3-Flash                  out=8000   finish=max_tokens
09-12T15:43:45  design-reviewer deepseek-v4-flash              out=8000   finish=length
09-13T12:41:20  design-reviewer deepseek-v4-flash              out=8000   finish=length
（另有 3 行同类，共 8 行）
```
**根因**：
1. `ds-call-v2.mjs` 把 `max_tokens` 硬编码 32768，`parseResponse` **已解析出
   `finish`（stop_reason / finish_reason）**，且流水日志记录了它，但
   `logger.ledger()` 写账本时**丢弃 finish**——账本行只有 `outcome:ok`，
   与一份完整审计**完全无法区分**（账本 schema 字段实测：
   ts/project/event/role/tier/source/cfg_hash/outcome/usage）。
2. 无任何检查把 `finish ∈ {max_tokens, length}` 视为失败：`health-scan.mjs`
   全文不含 `finish`（已grep确认）。
3. 视觉通道 `glm-look.mjs` 已为同类坑立纪律（"零正文+截断终态自动倍升
   8000→16000→32000"），但 `ds-call-v2.mjs` 只有"正文完全为空才提示仅推理"
   一条弱兜底；且 glm-look 的倍升**仅在正文为零时触发**，**截断但有正文**的
   报告照样当 ok 收下。
**为什么这是最高优先**：账本是本方法论的信任根（D1 机器事实终裁）；根被污染，
  "门一抓了 3 个 W 全真缺陷"这类结论的**覆盖率**不可信（截断报告可能漏检）。

**拟修法**：
- (a) `ds-call-v2.mjs`：账本行增记 `finish`，并派生 `truncated` 布尔
  （`finish∈{max_tokens,length}`）；截断时 stderr 显式告警
  （"审计产出被截断——按假成功处置"）。
- (b) `health-scan.mjs` 新增检查 ④**RED**：审计岗（gate1-reviewer /
  auditor-readonly / drafter）的 ok 行若 `truncated` 为真 → RED，阻断收口，
  按 02 §5 回炉/换源处置。
- (c) 历史 8 行不追认、不改写（08 §3）；但收口时以 INFO 列出历史截断数，
  提示"历史存在 N 笔截断产出，其覆盖率为已知欠账"。
- (d) 分歧点（须审）：是否应同时把 ds-call-v2 的 max_tokens 提升或加自动
  倍升（对齐 glm-look 四纪律）？审者请给意见。

### P0-3 "零硬编码"声明无机检，且正文确有 live 端点

**现象（亲验证据）**：
- 声明：`references/06` §0 第 8-9 行"本件与 SKILL.md 均不含任何具体端点/套餐
  数字"；`references/08` §1 寻址表把"端点"列进"禁止出现处=任何 .md 正文硬编码"。
- 实际：`references/07-role-cards.md` 第 107-110 行含
  `bigmodel`、`z.ai/zcode plan`、`api.deepseek.com`、实配模型名
  `deepseek-v4-flash`；第 142 行再次出现 `api.deepseek.com`。
- 全文扫描（.md，排除 org-config 与实例账本）命中 50+ 处模型/端点字面量，
  多数属 08 §1 允许的"安排性提及"（岗位×供应商分工链**描述**），但**端点 URL
  与实配模型名不属于描述**。

**拟修法**：
- (a) 新增机检脚本（临时命名 `check-hardcode.mjs` 或并入现有门禁）：
  扫 .md 中 `https?://`、`api\.`、已知供应商主机名与实配模型名形态；
  输出 [WARN] 起步（避免立即阻断），审查通过后升 RED；配白名单（历史事故叙述、
  残留册、审计档）。
- (b) `references/07` 的两处 live 端点**本次不改**——该文件正被用户改动
  （未提交 diff 已覆盖该段落），改它=与用户 WIP 冲突。列入残留，待 07 下次
  落定后处置。
- (c) 在 `references/08` §1 增一条**判例**：为"安排性提及"边界补一个实例
  （描述可写、端点与实配名不可写），使边界可被机检引用。

### P2 已写下但无机检的铁律（补机检）

| 编号 | 缺的检查 | 实测证据 | 拟修法 |
|---|---|---|---|
| P2-1 | **门一信噪比/误报率** | 账本只记"派发成功"，不记抓了什么（schema 无 findings/rejected） | 账本增 `findings:{B,W,N}` 与门二 `rejected` 计数；health-scan ⑤ 算误报率，超阈 WARN、连续超限 RED |
| P2-2 | **设计链同源** | 06 §8.6 要求"异构对抗审核"；但 `roles.auditor-readonly.source="deepseek"` 是**固定单源**。实测 2026-09-13T06:04 有一次 `drafter→deepseek`（无 switch 事件，疑为显式 `--source` 或链起点偏移），与 auditor 固定源同源，**无欠账行** | health-scan ⑤：同批 `drafter.source == auditor.source` → RED（06 §8.6 异构要求） |
| P2-3 | **配给回归** | 只在收口输出 INFO 用量；实测 deepseek（套餐外按量）已是最大出口：out=224,433 vs kimi-main 89,286 | 某源 out 占比超阈 → WARN"配给红线实际失守" |
| P2-4 | **project 稳定键** | 账本 39 行出现 9 个 project 名，实际仅约 3 个真实项目（同一项目多种写法：`synapse` vs `E:/class/智慧水务/Synapse_remake`；`智水蓝图` vs `E:/class/智水蓝图` vs `.../waterprint`） | 增 `project_id`（项目覆盖件常量），自由文本降为 `project_raw`；否则 P0-1 的欠账与 ② 的窗口均跨项目串味 |
| P2-5 | **usage 假值** | 存在 `in:0, out:18875` 类行（anthropic 缓存命中走 `cache_read_input_tokens`，`parseResponse` 未计），预算累计低估 | `in==0 && out>0` → WARN 数据质量；usage 补缓存字段 |
| P2-6 | **cfg 漂移** | 无检查。本次对账 PASS（账本末行 `add15c606e1b` == 当前 `cfg:add15c606e1b`） | 账本末行 cfg_hash ≠ 当前 hash → WARN"供应商事实已变，源序/配给需重盘" |
| P2-7 | **health-scan 名实不符** | 文档称"扫流水+账本"，实测**全部判定只读账本**；routing 仅用于解析校验与汇总计数（源码 5 处引用，无判定用法） | 或在文档改述，或让 ④/⑤ 真用流水（如 finish 取流水） |

### P3 工程卫生

- P3-1 **Node 版本守卫**：残留册 HOST-node25 承认"无常驻机检=已接受监控盲区"。
  拟在 `ds-call-v2.mjs` 入口加版本守卫（major===25 → stderr 告警，提示用
  Node 24 跑外部派发）。本机实测：`node --version`=v25.2.1；已找到
  `D:\nodejs24\node.exe`=v24.20.0（缓解手段可用）。
- P3-2 **SKILL.md 常载层软预算**：ORG-4 教训"愿望式预算无报警则缓慢失守"
  同样适用于常载层；ORG-SEG 有 ≤600 硬检查，SKILL.md 本体（实测 10859 字节）
  无任何预算检查 → 加 WARN 级阈值。
- P3-3 **断点续作演练**：05 §3 承认"编排者单点"依赖台账/交接书无损续作，但
  无验证。拟入 R 清单：新会话仅凭账本+交接书冷启动完成一次小额收口。

### P1（本次只提交设计，留用户裁决，不改代码）

新增**运行时验证层**（这是当前方法论最大的结构缺口：A1 明言"防线价值在于让
错误在合入前现形"，则逃逸到运行时的错误无处安放）：
1. 任务书 DoD 增一项"运行时可观察性"：每个新行为须回答"上线后我怎么看到它
   在工作"。
2. 账本增 `escaped-defect` 事件：线上缺陷登记"本该由哪道门抓住"（防线归因）。
3. 收口时算逃逸率，超线即按 04 三段式升格质量门。

## 2. 假设清单（烤验机关要求——请逐条拷问）

1. **假设**：技能根账本的 3 行 mock 来自一次手工/早期 R5 演练（cwd=技能根），
   非真实派发事故。**依据**：流水日志同时间段 attempt 全 `mocked:true`。
2. **假设**：`out=32768 finish=length` 的门一行确实被截断，且该审计被当合格
   审计收下（未回炉/未换源）。**依据**：账本该行 `event:ok`，其后无回炉记录。
3. **假设**：2026-09-13T06:04 的 `drafter→deepseek` 非"换源"（因无 switch 事件），
   而是显式 `--source deepseek` 或链起点偏移；且与 auditor 固定源构成同源。
4. **假设**：`os.tmpdir()` 前缀可作为"演练项目"的机读判据。
   **风险**：真实项目若在临时目录会被误免（已在 P0-1 披露）。
5. **假设**：`health-scan` 中 routing 变量仅用于解析校验。**依据**：源码审读。
6. **假设**：改 `ds-call-v2`/`health-scan` 不破坏回归 R1–R6。**待实测**。
7. **假设**：`truncated` 判据取 `finish∈{max_tokens,length}` 即可覆盖全部截断形态
   （anthropic=`max_tokens`，openai/兼容=`length`）。

## 3. 审核重点面（请优先拷打）

1. **根因归属是否成立**：P0-1/P0-2/P0-3 的根因判断有无误读？有无更简/更根本的
   修法？特别是 P0-2 的"账本丢 finish 导致假成功"是否为真因。
2. **修法是否违反技能自身法则**：是否触碰 08 §3（历史件禁改写）、A3（禁双源，
   例如把 finish 同时写进账本与流水是否构成双源）、A2（新增机检是否真不可绕过）。
3. **是否引入新的静默失败**：`truncated` 判据、tmpdir 免检、WARN-vs-RED 分档，
   各自的漏检面在哪里。
4. **回归风险**：`health-scan` 新增 RED ④ 是否会让既有项目立刻不可收口
   （历史 8 笔截断）；`ds-call-v2` 改 schema 是否破坏 R4（R4 已要求流水 ok 行含
   `finish`——账本 schema 变更是否会与 `regression.mjs` 的 ledgerReq 校验冲突）。
5. **优先级排序是否合理**：有没有被漏掉的更高优先项（尤其 P1 是否本应先于 P2）。
6. **成本现实性**：新增检查是否会让单人开发者的日常流程负担过重（05 §3 承认
   "重流程有成本"）；哪些应降为"按需"。

## 4. 输出要求

- [B|W|N] 分级，逐条给：编号 → 定位（P0-1/P2-3/假设 3 等）→ 问题 → 依据 →
  建议修正案（"应当如何"，不代拟全文）。
- 末尾：总评 + 明确放行意见（放行 / 有条件放行（列条件）/ 返工）。
- 若发现送审材料本身内部矛盾，直接指出（这正是你的职责）。
- 不确定的明确标"不确定"，禁臆测包外事实。
