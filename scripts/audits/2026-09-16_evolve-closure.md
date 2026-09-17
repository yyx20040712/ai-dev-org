# 外部评审清偿战役（evolve 批 v1.7）收口呈报包

## 战役全链（烤验表逐级命中）

1. **立案**（主控）：外部全面评审 findings 编批；基线体检全绿（git @ fe19260
   干净/regression 7/7/三扫零/RED0 WARN2）。
2. **计划**：v1→v2→v3；双源对抗审两轮（源A k1 审 v1：B1/W9/N8 FAIL；源B k2
   审 v2：B3/W6/N9 FAIL——首派静默无输出按 runbook 同包重跑成功）；36 条
   findings 全吸纳（台账=plan v3 §8）。
3. **裁决**（deepseek-flash）：有条件放行 C1-C6；P-4 终裁=改指 01·C2；
   b8 清单不穷尽纠偏（+check-anchors:10/init-defenses:8-9）。
4. **实现**（ops-executor×GLM-5.3）：E1（b1 传输层+b2 退出码+b6 包含性+
   R10）/E2（b3 日期窗+b4 null 守卫+b5 五处超时+b7 锚点扩面）/E3（b8 形态
   普查+头注九件+b9 登记 25 行）——TDD 红→绿→变异红证、真退出码落盘、
   分笔 commit ×9。
5. **门一初审**（k1）：B1（cliMain 顶层装载漏包=未申报 exit3→1 回退）/
   W1-3/N1-7 **FAIL**→回炉轮（原实现者，11 项全处置+主控移交 §8.6 笔误，
   commit ×2）→门一复审 **PASS**（B0/W1/N4；302 行变更四重证据判缩进重排）。
6. **门二实证**（ops-probe）：矩阵 26/26 无红（25 绿+1 黄=probe-b 合成探针
   RED 系检测器正确击发）；C1-C6 计划期条件逐条过；抽源核读全坐实。
7. **终审**（deepseek-flash）：有条件放行 CONDITIONS=6；W3 三处保留句背书；
   A-2 追认；新发现=--list-roles×roles:null 两处无守卫（静态坐实）、门二与
   实现者同 model-key 同源欠账。
8. **收口**（主控）：四件出件补档+终审四条件登记行+账本 13 行补记（真实
   时间戳）+终扫。

## 终态数字

- regression **8/8**（R1 SKIP 配给保护；新增 R10）；check-hardcode 命中 0
  （豁免 33）；check-anchors WARN×0/FAIL×0+自检 16/16；health-scan
  **RED×0/WARN×2**（基线不劣化）；cfg=`a26f710a540d` 无漂移。
- commit **12 笔**（勘误：本件初版与账本 closure 行误记 13——实为实现 9+回炉
  2+收口 1；勘误行=evolve-v17-erratum1，主控自抓自登，与门一 W1 同类计数病
  承接 evolve-p2-advisories），未 push。
- RESIDUALS evolve 节 **30 行**（closed 9/open 21）+在册补注 1 处。
- 账本 v2 行 76→89（13 行补记，事件序以 runId 为准）。

## 终审六收口条件核对（全过）

①evolve-listroles-rolesnull 已登记（open）｜②evolve-probeb-testfixture
已登记（open，注明合成探针非缺陷）｜③账本行 tier⊆{session:model-field,
session:host-tier}+schema_version:2+字段序 02 §9（R4 全过）｜④双审 source
互异含各自 uuid 前缀（b2466f8b…/5e1abd9d…，未并记 k3）｜⑤同源注记=账本
evolve-gate2 行 outcome+RESIDUALS evolve-gate2-samesource 双落｜⑥出件补档
四件（final-gate1-out 含 N1-N7/N1-N4 权威口径声明）+本件。

## 行为变化面（P-6 四项，已入 CHANGELOG v1.7+06 §5.8 迁移注记）

①log-triage --date 非法值：静默空窗→exit 1；②ds-call-v2 英文 locale 配置
类未捕获异常 exit 1→3（修误分类）；③registry 文件路径越界新增 exit 3 拒绝
（纵深防御，当前不可达）；④null provider：TypeError 崩溃→校验错误
（org-config/ds-call-v2=exit 3；check-hardcode=降级 exit 5 继续扫）。
内部测试设施：GLM_LOOK_HOST_CONFIG/GLM_LOOK_LOG_DIR env 钩子（缺省不变）。

## 证据索引（scripts/audits/2026-09-16_evolve-*）

plan-v1/v2/v3｜plan-v1-k1-out｜plan-v2-k2-out｜ruling-v3｜ruling-final｜
brief-e1/e2/e3｜e1/e2/e3-report+log｜final-diff｜final-gate1-out｜
rework-diff｜rework-report+log｜rework-gate1-reout｜gate2-evidence｜
ledger-rows.json+ledger-append.mjs｜本件。

## 承接批次（下一批清单，均已在册）

evolve-listroles-rolesnull（守卫+向量）｜evolve-p2-advisories（C1 严式扩
`exit \d+=` 等）｜evolve-m4-hardcode（org-config 化）｜evolve-struct-*
（三表收敛/术语速查/补丁式写作）｜evolve-glmlook-150-null｜
evolve-probeb-testfixture（探针残留清理）｜02-§8-model-terms（指针化升批）。
