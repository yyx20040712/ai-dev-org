# 裁决部对 evolve 批（含回炉轮）的终审（会话转写归档）

> 归档说明：收口批补档（终审包缺口③-⑤）；内容以派发回执为准。
> 派发：2026-09-16，主控。
> MODEL-SELF: model-field:8ad55776-2296-4f1a-bc46-05755c8f1300/deepseek-flash

## 终审要点

- C1-C6（计划期六条件）逐条验收全过（门二矩阵+本席亲复算：C1 两式 grep 0、
  C4 活文档 0/02:70 命中、C5 五处 5,000×4+5,400,000∈窗、C3 全库 0+合成负例在）。
- 回炉闭环：B1 证据链（红 exit1→绿 exit3→变异红非恒真）坐实修误分类理据；
  11 项核销抽验 7 项全过。
- W3 保留背书：三处（ds-call-v2 exit4 禁重试/regression R2b 聚合口径/
  init-defenses 先回滚）亲读 06 §5.8 判定均属总表未载的本件特有语义——
  **背书成立**。
- D：--list-roles×roles:null——静态坐实 :362 Object.entries 与 :380
  Object.keys 两处无守卫（roles:null→TypeError→exit 1≠§5.8 行 3）——裁
  **拆行登记 evolve-listroles-rolesnull**（open，下批修+R10 向量）；纵深
  防御/一致性 W 级非 B。
- E：A-1 黄项=**probe-b 系人为构造的路由探针**（验证 06 §6 补遗负面清单⑤
  枚举值=假绑定；metadata.json profileId=probe-b/systemPrompt 自述
  model field=upstream enum "sonnet"）——③ 检测器按设计正确击发非缺陷；
  简报预期 exit 0 失准。裁：追认 exit 1+登记 evolve-probeb-testfixture
  （open，防长期误读为真 RED）。A-2（health-scan :104 运行时文案修正超
  「头注级」字面但属主控移交明令）——**追认不记越权**。
- F：账本口径=tier∈{session:model-field, session:host-tier}+schema_version:2
  +字段序 02 §9+双审 source 互异含各自 uuid 前缀禁并记 k3；**门二与实现者
  同 model-key（GLM-5.3）=同源**（ops-probe.md:6=ops-executor.md:6）——须
  注记欠账（异构对抗由门一 k3+裁决 deepseek 承载，门二=机械重跑面）。

## 终审六条件（收口前）

C1 登记 evolve-listroles-rolesnull｜C2 登记 evolve-probeb-testfixture｜
C3 账本行 tier/schema/字段序合规｜C4 双审 source 互异含 uuid 前缀｜
C5 同源注记（grep 同源 可命中）｜C6 门一出件缺席与 N1-N7/N1-N4 权威口径
书面澄清。

## P2 建议（非阻断，下批）

C1 机检扩 `\bexit \d+=` 形态；plan 白名单「头注级」措辞精确化；
ds-call-v2:14 保留句去已覆盖半句。

RULING: 有条件放行 CONDITIONS: 6
