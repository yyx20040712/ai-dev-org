# 配置变更批复核任务书：org-config 新增 source_health / vision_channels 分区（纯配置变更批）

> 任务性质：只读审核（烤验表·纯配置变更批——配置 diff+预期行为变化呈复核）。
> 审核者零仓库接触：材料自包含。输出契约：[B|W|N] 分级逐条 + 总评与放行意见；
> 全文 ≤2500 字。
> 背景一句：2026-09-16 维护熵清偿战役批次 7（预裁 A 申报——分区收编不触碰
> roles 注册表，留用户终裁），同批派发器增 payg 显式告警。

## 1. 配置 diff 全文（org-config.default.json）

```diff
diff --git a/org-config.default.json b/org-config.default.json
index 162c090..32e0f56 100644
--- a/org-config.default.json
+++ b/org-config.default.json
@@ -51,6 +51,19 @@
     "source_share_warn": 0.6,
     "source_share_note": "单源占比超此值=配给红线可能失守（P2-3；初始值 0.6，按实测两批后调整）"
   },
+  "source_health": {
+    "dual_groups": [
+      ["kimi-main", "kimi-backup"]
+    ],
+    "gate1_primary_subagent": "ops-gate1-k1",
+    "gate1_secondary_subagent": "ops-gate1-k2",
+    "note": "log-triage --health 换源推荐的结构参数：双源分组与门一双子代理名（v1.6 批 P1-B——脚本禁硬编码别名，A3/06 §0；别名变更只改本件）"
+  },
+  "vision_channels": {
+    "glm": { "model": "GLM-5.3-Flash", "endpoint_contains": "/anthropic", "prefer_hosts": ["open.bigmodel.cn", "z.ai", "zcode"] },
+    "ds": { "model": "deepseek-flash", "endpoint_contains": "deepseek" },
+    "note": "设计岗外呼看图双通道（glm-look.mjs）的模型名/端点甄别子串/偏好序——v1.6 批 P0-B d 预裁 A：独立分区不动 roles 注册表（07 §4「会话内岗不动注册表」先例保持）；供应商事实住本件（06 §0），脚本零硬编码；宿主 config 仍为端点与 key 事实源；prefer_hosts=数组序即偏好序，未命中者殿后按宿主 config 序"
+  },
   "hardcode_scan": {
     "forbidden_terms": [],
     "note": "P0-3 check-hardcode 的额外扫描名单（正则字面量）。通用语法形态（http(s):// 与 api.<host>）属语法非事实，留脚本内；供应商 live 事实（端点/实配名）在宿主 config 而不在本件，故默认空——项目覆盖件可加自有禁词。"
```

## 2. 语义与预期行为变化

1. **source_health.dual_groups=[["kimi-main","kimi-backup"]]** +
   gate1_primary/secondary_subagent：log-triage --health 的换源推荐从此读
   配置（原硬编码别名——换别名即静默失效）。行为变化：推荐文案不再含
   供应商名（改引用配置值）；mock 演练行不计入推荐（同批根修）。
2. **vision_channels.glm/ds**（model/endpoint_contains/prefer_hosts）：
   glm-look.mjs 的模型与端点甄别、偏好序从此读配置（原硬编码于脚本）。
   行为变化：--list-sources 实测输出与改前一致（等价迁移）；通道未声明=
   无源返回（原为脚本内写死）。
3. **派发器 payg 告警**（代码侧，行为受配置 billing 字段驱动）：链首源或
   换源目标 billing="payg" 时 stderr 显式 [payg] 告警——不阻断（链仍走），
   费用面留痕。
4. **cfg 哈希漂移**（54f08fbf90c5→8296eaf4dc7e）：health-scan 如实 WARN
   「供应商事实已变需重盘投放面」——本批复核即该漂移的处置动作。

## 3. 请裁面

1. 新分区语义是否有歧义/过度配置（prefer_hosts 数组序即偏好序是否足够明确）？
2. 默认件写死本机事实（uuid_prefix 等）与通用性的张力——本批未动（在册），
   新增两分区是否加剧该张力？
3. payg「告警不阻断」的取舍：链尾按量兜底继续存在（用户已裁开工），
   告警是否足够/是否应加确认位？（留用户终裁项，请给意见）
4. 纯文档面（SKILL/06/07 说辞统一）已另册呈门一，本包只裁配置面。

## 4. 输出要求

- [B|W|N] 分级（定义=技能 02 §3：B=阻断实施/W=应修/N=提示），末尾总评+
  放行意见（放行/有条件放行（列条件）/返工）。
- 机读尾栏（强制最后一行）：`FINDINGS: B=<数> W=<数> N=<数> VERDICT=<放行|有条件放行|返工>`
- 不确定标不确定，禁臆测包外事实。
