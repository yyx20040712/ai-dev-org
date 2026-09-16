# 裁决书：ai-dev-org 优化方案 v1.0（Kimi 对抗审核后终裁）

> 裁决主体=主控（维护方）。审核=Kimi K3 异源对抗（auditor-readonly @ kimi-main，
> 档=scripts/audits/2026-09-14_plan-v1-kimi-audit-out.md，run=20260914141615-w5e5）。
> 裁决权限三分法：机检项=主控独裁（已裁决）；新增事件类型/运行时层=留用户（本次不改代码）。
> 方法：**D1 机器事实终裁，亲验不信任自报**——审核者的每条技术断言先亲验再裁决。

## 一、审核者两条阻断的终裁（均经亲验）

### B-1「tmpdir 判据撞 8.3 短名」→ **驳回（证伪）**

审核者断言：账本 project 是 8.3 短名形态，而 `os.tmpdir()` 返回展开长名，
前缀匹配落空，P0-1 修法上线后 RED 依旧。

**亲验证据**（本机 Node 25.2.1 / 24.20.0 双验，脚本 `_verify_b1.cjs`）：
```
os.tmpdir()                = "C:\\Users\\ADMINI~1\\AppData\\Local\\Temp"
账本 project               = "C:\\Users\\ADMINI~1\\AppData\\Local\\Temp\\r5-692zCI"
startsWith(os.tmpdir())    = true          ← 前缀匹配成立
TEMP env                   = "C:\\Users\\ADMINI~1\\AppData\\Local\\Temp"  ← 本机环境本身就是短名
```
本机 `os.tmpdir()`（即 `TEMP` 环境变量）本身返回的就是 8.3 短名形态，与账本
project 前缀**精确匹配**，修法按原样即可生效。**断言被证伪。**

**但部分采纳其加固建议**（非阻断、低成本保险）：判据侧同时做大小写归一与
`realpath` 归一后再比较，防其它宿主/Node 版本返回长名形态。这是"驳回结论、
采纳加固"——理由：审核者的事实断言错了，但其识别出的**可移植性风险面**真实存在。

### B-2「finish 落账构成 A3 双源，且账本↔流水缺行级关联键」→ **采纳（修正后）**

审核者指出两点，均成立：
1. 流水 119/119 行已含 finish（单源已存在），再把 finish 写进账本=同一事实
   两个存储处，违反 A3。
2. 账本行无 runId，账本↔流水无行级关联键，只能靠 ts+role+source 模糊匹配。

**终裁（明文裁决 finish 唯一真相源与 ④ 数据源）**：
- **流水=finish 唯一真相源**（原始事实）；**账本只存派生布尔 `truncated`**
  ——派生判定不算双源（与技能自身"派生值"语义一致：账本存的是判定结果，
  不是 finish 的副本），此推理明文入账。
- **补行级关联键**：账本行增 `runId`（派发器已有该变量，零成本）。
- **④ 仅判含 `truncated` 字段的行**；无该字段的历史行豁免（不追认、不改写，
  合 08 §3）。
- 由此击穿审核者重点面 4 之担忧：④ 从账本读派生布尔，历史行无字段即豁免，
  **不会因流水历史截断而立刻 RED**。

## 二、W 级终裁

| 编号 | 裁决 | 处置 |
|---|---|---|
| W-1 INFO/WARN 无升格机制=ORR-4 同病 | **采纳**（本次最有价值的发现） | 新增每条 WARN 必须登记升格条件；health-scan 收口摘要强制回显 WARN 计数 |
| W-2 (c) 应升必选（源头治理优先） | **采纳** | 源头侧：派发器 mock 时账本写 `mocked:true`；判据侧不再单靠路径 |
| W-3 截断判据黑名单→白名单 | **采纳** | 反转：仅 `stop/end_turn/stop_sequence` 为完整；词表存 org-config |
| W-4 审计岗清单硬编码=第二源 | **采纳** | 改由 org-config `roles.<id>.audit_surface` 派生 |
| W-5 ④ × tmpdir 豁免交互未定义 | **采纳** | 明文：④ 只继承 `mocked` 豁免，**不继承** tmpdir 豁免 |
| W-6 hardcode 扫描器升格无判据+名单硬编码 | **部分采纳** | 名单从 org-config 派生（采纳）；升格判据本次登记为待定，先 WARN |
| W-7 findings 来源未定义（疑违 D1） | **采纳** | 审计岗 DoD 强制机读 findings 尾栏；账本 `findings` 由该栏解析写入；解析失败不计已验审计。本次落 DoD 与 schema，解析器登记残留 |
| W-8 P2-2 归因未明即立 RED | **采纳** | P2-2 降 WARN，待归因完成再议 RED（消 RED 路径须先证存在） |
| W-9 P2-4 新旧键并存期未定义 | **采纳** | 本次**不引入** project_id（避过渡期双键混乱）；登记为残留，待专门批次 |
| W-10 执行顺序冲突（先基线后改 schema） | **采纳** | 已执行：先跑 R1–R6 基线（见 §三），再动 schema |
| W-11 残留册与新行为矛盾 | **采纳** | 向残留册**追加**修订记录闭合 W5-A-W4（只追加，合 08 §3） |
| W-12 P3-1 守卫过弱+路径硬编码 | **采纳** | 守卫版本区间入 org-config；`D:\nodejs24` 路径不入脚本（仅作业注记）；glm-look 缺口登记残留 |
| N-1 不加自动倍升 | **采纳** | 不倍升；截断走 RED+回炉（避免放大套餐外计费） |
| N-2 阈值未量化 | **采纳** | 每阈值给初始数字+调整机制 |
| N-5 schema 版本号 | **采纳** | 账本行增 `schema_version` |
| N-6 glm-look 同类坑登记残留 | **采纳** | 登记 |
| N-7 P1-1 可单独提前 | **采纳** | P1-1 纯文本追加、零代码风险，本次落地；P1-2/3 留用户 |
| N-3/N-4 | 采纳为文档澄清 | N-4：回炉非必然落账，假设 2 依据降级为"账本无回炉行"（已如实登记） |

## 三、主控新发现（审核者未见——基线亲验的产物）

**P0-4 技能自身仓库 R4 回归 FAIL**（W-10 要求先跑基线，遂暴露）：
```
$ node scripts/regression.mjs --only R2,R5,R4 --project .     # Node 24
FAIL R4 流水:尾100行坏36行（含未知事件0）…  3/4 过，FAIL ×1
```
**两个真因（均已定位）**：
1. **（35 行）design-reviewer 行 schema 不全**：`scripts/glm-look.mjs` 自写流水，
   行内缺 `dispatcher_version/role_version/role_sig/org_config_hash/attempt`
   ——不同写入者、两套 schema（A3 同构病：双源）。R4 的旧版本行跳过条件
   （`dispatcher_version !== undefined && !== CURRENT`）对**无该字段的行不生效**，
   于是被按 ds-call-v2 schema 校验→坏行。
2. **（1 行）网络级失败行缺 `statusCode`**：`ds-call-v2.mjs` 对
   `TypeError: fetch failed` 类网络错写入 switch/exhaust 行时无 statusCode
   （HTTP 状态码不存在），而 R4 schema 要求该字段→坏行。
   实测样本：`09-13T14:12:42 switch gate1-reviewer kimi-main fetch failed`。

**终裁**：
- 真因 2 在 ds-call-v2（不在 WIP 锁定集）→ **本次修**：网络错显式写
  `statusCode: null`（字段存在即过 schema）。
- 真因 1 的写入者 glm-look.mjs **在 WIP 锁定集内（硬约束 3）**→ 不碰；
  改由 regression.mjs 正确分类"他源写入行"（有 `channel` 字段=glm-look 标记）
  并在 detail 计数回显；glm-look 统一行 schema 登记残留，待其落定后处置。

## 四、执行清单（本次落地）

1. `ds-call-v2.mjs`：账本行增 `runId`、`schema_version`、`mocked`、`truncated`；
   mock 模式写 `mocked:true`；网络错 `statusCode:null`；截断时 stderr 告警。
2. `org-config.default.json`：增 `completion_ok`/`truncation` 词表、
   `roles.<id>.audit_surface`、`supported_node` 版本区间、`thresholds` 初始阈值。
3. `health-scan.mjs`：① 跳过 `mocked` 与规范化 tmpdir；④ 截断 RED（白名单反转）；
   ⑤ 同源设计链 WARN（降级）；收口摘要回显 WARN 计数；cfg 漂移 WARN。
4. `regression.mjs`：他源写入行正确分类（`channel` 标记）+ detail 计数。
5. `check-hardcode.mjs`（新）：按 org-config 派生名单扫 .md 端点/实配名，
   WARN 起步；白名单文件独立（避 .md 自指）。
6. 残留册追加：W5-A-W4 修订、glm-look schema、glm-look 截断、project_id、
   findings 解析器、check-hardcode 升格。
7. DoD（audit roles）：增机读 `FINDINGS:` 尾栏要求。
8. P1-1「DoD 增运行时可观察性」：纯文本追加，落 SKILL.md 补遗。

**未落地（留用户裁决）**：P1-2 `escaped-defect` 事件、P1-3 逃逸率升格质量门。
