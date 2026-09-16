# 裁决档：ai-dev-org 维护熵清偿计划 v1.0 双源对抗审终裁（2026-09-16）

## 0. 授权与派发事实（D2 决策原文入账）

- 用户指令原文（2026-09-16，本会话）：「请你制定详细计划，并让deepseek和kimi
  提建议，裁决后向我汇报。」
- 送审件：`scripts/audits/2026-09-16_entropy-plan-v1-for-audit.md`（约 13KB，
  自包含，含 8 条假设清单）。
- 派发：`ds-call-v2.mjs --role gate1-reviewer`，Node 24 运行，双源并行：
  - deepseek（deepseek-v4-flash）：run=20260916120740-ppwg，usage in=5673/
    out=14265，latency 65.4s，finish=complete。
  - kimi-main（kimi-k3）：run=20260916120740-eihg，usage in=5568/out=2765，
    latency 68.0s，finish=complete。
- 双审结论：deepseek **B=4/W=11/N=5 VERDICT=FAIL**；kimi **B=4/W=4/N=2
  VERDICT=FAIL**。两源独立裁定一致=返工。

## 1. 收敛性阻断发现（两源同打，全部采纳）

| # | 收敛发现（deepseek/kimi 编号） | 裁决 |
|---|---|---|
| C1 | schema 单源化前必须先做「02 §9 文档 vs ds-call-v2 落账代码」逐字段对账，否则单源化的可能是笔误（ds-B1 / kimi-B3a） | **采纳**，且主控已当场完成对账首步（见 §3 亲验记录 V2：字段名层面吻合）；完整对账（含可选性语义）仍列为实施批次 0 硬门 |
| C2 | mock 过滤数据源自相矛盾（流水 mocked:true vs 账本 mocked?），历史行可能无字段静默漏滤；修法未断言终点「过滤后推荐=不换源」（ds-B2 / kimi-B3b） | **采纳**。定唯一数据源=流水行 `mocked:true`（R4 已校验的实时字段），账本行为派生副本；历史无字段行回退判据=同 runId 关联流水。验收断言固定：`mock429×4 + 真实504窗口 ⇒ 推荐不换源`，入 regression，FAIL 即阻断 |
| C3 | 退出码统一前未做全量调用面 grep（自认未验证即排期），regression R 断言/CI 模板/runbook 可能硬编码旧语义（ds-B3 / kimi-B4） | **采纳**。调用面 grep+兼容映射表=实施批次 0 第零步，结果作 go/no-go；exit 2 语义冲突单独立项，不与文档指针化同批 |
| C4 | 在 07「不入 org-config」先例存废未裁决前，vision_channels 预设为「唯一兼容解」=以第三种例外回避裁决（ds-B4 / kimi-B2） | **采纳**。撤回预判；「07 先例存废 + vision 收编形态」合并为单一用户裁决包（备选 A=不动 roles 增分区；备选 B=废先例、视觉外呼归外部岗直入 providers；各附后果）；裁决前实施批禁落 P0-B(d)。SKILL.md 现行错误表述先改中性：「现况=脚本内配置，收编形态待用户裁决」 |

## 2. 单源发现裁决（逐条）

**deepseek 侧**：
- W1（SKILL.md 派发节是否冻结核心）：**采纳关切、驳回处置变更**。亲验 git
  历史：派发节 schema 行为 2026-09-14 schema v2 批新增运营段，非 v1.0 冻结
  面（冻结=方法论核心原文）。指针化合法，本裁决档即证据。
- W2（批次划分缺失）：**采纳**，见 §4 批次重排（P1-C 元治理对账前置）。
- W3（[B|W|N] 定义住中立源）：**采纳**。定义住 references/02（管道契约真
  源），gate1/auditor 两 DoD 改指针。
- W4（两处计数语义互不一致）：**采纳**。「16+3」与「四组 16 条」是不同时点
  快照，均已过期；澄清后统一按 kimi-W3 生成式方案处理。
- W5（假设 2 逐档核对）：**采纳**，入批次 0。
- W6/kimi-W2（check-anchors 校准协议）：**采纳**。两阶段：全量 WARN 基线→
  误报分类→仅高置信规则升 RED；阈值与样本量待基线轮实测后定，不预造数字
  （对齐 ration_redlines 不假造数字先例）。
- W7（自包含 vs 收敛的态度矛盾）：**采纳并立统一判据**：分发单元内的脚本
  对单元外共享件零依赖；单元内部跨脚本稳定接口→共享。据此：ds-call-v2=
  可独立拷走的分发单元→scrub 受控复制+golden 对账（方案②）；flag()/
  readJsonl=技能根内部七脚本共用→收敛 org-config.mjs（P2-3 照旧）。同案
  不同判的表象由此消解。
- W8（_dup 落实或删除二选一）：**采纳并现裁**：删（A4 死代码即删），去重
  以 runId+event 复合键与 C2 修法合并一处落地。
- W9（glm-look 落账是否遵 v2）：**已亲验关闭**（§3 V1）：glm-look 只写流水
  不写账本，无第三处账本分叉；其流水行字段形态（role_id/channel）与派发器
  的差异入批次 5 注记（不改，channel 标记已有甄别语义）。
- W10（常驻/按需清单）：**采纳**，入 08 §4 补遗：常驻=check-hardcode+收口
  health-scan；按需=check-anchors（文档批后+定期体检）、regression（脚本
  改动批后）。
- W11（429 细分）：**采纳**。429=限流属额度族走换源状态机；其余 4xx 立断
  不重试（NO_RETRY 对齐）。
- N1/N3/N5：采纳为实施批注记（timeout=max(20min,P99+余量)；4000 字梯度
  随批次 5 DoD 论证；行号基线=v1.5 提交后锁定）。

**kimi 侧**：
- B1（证据载体/输入四件）：**部分采纳**。「输入四件」是实现批包形态，计划
  审无 diff（2026-09-14 先例同构，无此四件）；但「亲验措辞无可复核载体」
  成立：v1.1 起审包内机器事实引证附命令原文摘录，或标注「送审方单方陈述，
  实施批首步复核」。本档 §3 亲验记录即先行示范。
- W1（负向正则→正向校验）：**采纳**。P0-A(c) 改为正向校验「SKILL.md/
  templates 中 schema 指针存在且唯一指向 02 §9」；负向串仅 WARN 候选。
- W3（去数字化与计数对账自相矛盾）：**采纳**。方案=生成式：check-anchors
  产出 01/04 实际条数，与 golden 计数文件比对；文档正文去数字持指针。机检
  锚点=golden 文件，非散文数字。
- W4（修订记锚点+superseded_by）：**采纳**。修订记只留 v1.5 摘要+CHANGELOG
  精确锚点；RESIDUALS 勘误行采「supersedes: W5-A-W4」形态，health-scan
  统计侧加「被取代行不参与终态统计」过滤。
- N1/N2：采纳（timeout 分布依据；_archive 登记「引入分发机制时随批重评」
  触发器入 RESIDUALS）。

**驳回项**：无整体驳回条目；仅 W1(deepseek) 的处置变更被驳回（见上）。

## 3. 亲验记录（D1——裁决依据的机器事实）

- V1（ds-W9）：`grep ledger glm-look.mjs` 零命中账本写入口；logEvent 仅写
  `scripts/model-routing-log.jsonl`（:39/:52/:229-267）。glm-look 不写账本。
- V2（C1 首步）：ds-call-v2.mjs:193 落账字段序列 `{ts,schema_version,runId,
  project,event,role,tier,source,cfg_hash,usage,mocked?,truncated?,outcome}`
  与 references/02 §9 声明逐字段吻合（字段名层面；LEDGER_SCHEMA_VERSION=2）。
- V3（本批派发）：两 run 流水与退出码见 §0；均 finish=complete 非 truncated。

## 4. 计划 v1.1 批次结构（裁决后重排）

| 批次 | 内容 | 对抗位 |
|---|---|---|
| 0 对账批（纯只读） | schema 全量对账（含可选性）；退出码调用面 grep+兼容映射（go/no-go）；假设 2 逐档核对；两审 B/W 依赖行号项亲验复核 | 主控亲验+呈档 |
| 1 元治理对账（P1-C） | 修订记/RESIDUALS 补登与勘误/08 §1 撤注/[B|W|N] 定义入 02/门一 4000 字预算 | 轻量双审 |
| 2 P0-A schema 单源化 | 指针化+正向校验机检（批次 0 通过后） | 轻量双审 |
| 3 P1-A 锚点清扫 | 断锚修正+_archive 消歧+外部批档引用消歧+check-anchors WARN 试点 | 轻量双审+试点校准 |
| 4 P1-B log-triage 修复 | mock 过滤（单源=流水）+_dup 删除+复合键去重+别名派生+自检聚合+验收断言「不换源」 | 门一 diff 审+R 清单回归 |
| 5 P0-B 代码面 | 传输层/脱敏方案②/429 细分/SCRIPT_DIR/死代码（**不含 (d) 配置收编**） | 门一 diff 审+门二实证 |
| 6 用户裁决包 | 07 先例存废+vision 收编形态（A/B 备选）+payg 默认链末端+uuid_prefix 可移植性 | 用户 |
| 7 配置落地批 | 依批次 6 裁决落 (d)(f) 与 org-config 变更 | auditor-readonly 复核（烤验表配置变更批） |
| 8 P2 卫生收尾 | 退出码总表（视批次 0 go/no-go）/helper 收敛/静默吞错/BOM 等 | 轻量双审 |

顺序原则：纯文档先行（去繁殖）→代码面对账后动→配置面殿后（依赖用户裁决）。
前置条件：v1.5 批 22 个未提交文件先分笔提交收口（P2-8），锁定行号基线。

## 5. 终裁

- 双源对抗审结论（FAIL/返工）**维持**——计划 v1.0 不放行。
- 计划 **v1.1 成立**（本档 §1/§2/§4 全量吸收两审 B/W/N 与收敛阻断），
  状态=待用户裁决：①批次 6 裁决包三项；②是否批准批次 0-5+7-8 进入实施。
- 本批为纯计划批，未改动任何正文与代码（仅新增本档与审包/两出件于
  scripts/audits/，均未跟踪文件，无 WIP 冲突）。
