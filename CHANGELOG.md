# CHANGELOG

> 本件=SKILL.md 修订记的全量迁档（2026-09-15 入口治理批迁入，原文
> 逐字保留，此后新增版本只在本件追加）。SKILL.md 只保留最近一条摘要
> 与本件指针。历史条目属过程记录，按 references/08 §3 红线不再改写。

## 2026-09-16 v1.5（子代理绑定批 A+A'+B-0+B-1——交接书 07-handoff §三管道全量）

- **A 批**：四绑定子代理入役 `~/.zcode/agents/`（ops-executor=GLM 最高档
  Write 面+E2 白名单墙 / ops-diagnostics=真只读物理墙 / ops-probe=E2 协议墙
  如实声明 / ops-adjudicator=deepseek 异构裁决位）；系统提示三段+MODEL-SELF
  自报行+LEDGER-CLAIM 尾栏；七代理首场验证全绿（日志零回退+越权写物理
  拦截+分笔 commit+进度文件），档=E:/zcode_md/fix/subagent-plan-2026-09-16/
  08-exec-log.md。
- **A' 批**：①Kimi 双源绑定日志实证（kimi-main+zipoo 同模型键零回退；空
  tools=泄漏全工具面——门一退 tools:[Read]+双墙）；②ops-gate1-k1/k2 双源
  入役（同包双跑一致性验证：B 级核心发现完全重合，均 FAIL 判对）；
  ③④源健康检查+接续纪律 runbook（log-triage --health 五类分诊→k1/k2
  推荐；杀岗演练=进度落盘可续）。runbook 真源=批档 09 号件。
- **B-0 批**：scripts/log-triage.mjs 入册——两账并呈（cli/log 内链路+
  派发器流水外链路）五类分诊/attempt 放大统计/静默回退检测（probe-b
  形态可机检抓出）/岗×源用量（Kimi 双源分列）/finish 终态派生（保守
  口径，词表住 org-config finish_vocab）；2026-09-16 真实日志回放=正确
  指出当日 504 双源 exhaust 并建议不换源（mock 演练行自动剔除）。
- **B-1 批**：check-hardcode 扩容（实配模型名词表=宿主注册表派生+归一
  变体；agents 目录 ops-*.md 剥 frontmatter 扫正文——B-2 裁决②③）；06
  §1 设计岗行指针化；org-config/registry 增 roles.*.migration_note（⑥
  迁移期双承载注记，cfg bec09005e3ac→54f08fbf90c5）；RESIDUALS 新登记
  7 条（含 05 §七指认的流式化登记缺口补正）；06 §6 补遗+07 §4 补遗+
  SKILL.md 派发节子代理绑定通道段。
- 授权链：用户裁决 D2 四项+指令二（承载架构改版）+裁决三（多模态域
  B-6 定档）——05-ruling.md §八/§九/§十。

## 2026-09-16 v1.4（防截断入册+产出入仓纪律批——用户指令「补齐，保证技能后续使用时不会持续造成 AI 污染」+「防截断调整嵌入技能」）

- **派发防截断根修入册**：ds-call-v2.mjs v2.2.1（node:http 直连/
  signal 唯一超时源/20min 上限）脚本本体已由 F-TESTREF-00 批落地
  （2026-09-16，Synapse 仓 6ff13f95f4 记档），本批补齐文档面——
  references/06 §5.7 补遗（499 分诊/undici 300s 隐形杀手/对策三层/
  双臂探针实证）+ references/04 §八 ORG-12/ORG-13（超时排障链+
  证据链三伤）+ 任务书模板纪律段（审包瘦身+产出预算+产出面纪律）+
  SKILL.md 派发段操作事实。
- **产出入仓面纪律立件**（防 AI 痕迹污染）：references/08 §6——
  入项目仓工件（文件名/内容/commit message）零外部模型代号与 AI
  指称；派发工件命名弃源别名后缀；§5 审档归宿收紧（默认仓外档案
  区，入仓须先中性化；反例=2026-09-16 Synapse 审包入库带模型别名）；
  词表单源=项目仓门禁脚本（WaterPrint 双面/Synapse 现 src 面）。
  SKILL.md 红旗表+烤验触发表（收口/交付批行）挂载；任务书模板
  纪律段带指针。
- **姊妹技能同批**：review-ai-code §六「痕迹回流检查」操作化
  （词表+两仓门禁命令+命名面人工过目——Synapse md 面未设防段）。
- 未了项：Synapse md 门禁扩面（存量 562+ 件处置）另立批次；
  流式化（根治贴窗）留技能层后续。

## 2026-09-15 v1.3（入口治理批——用户指示「优化本机的 AI 软件开发技能」）

- **修订记迁档**：SKILL.md 修订记全文迁入本件，入口只留最近一条摘要
  + 指针（入口瘦身，历史零改动）。
- **脚本清单补齐**（残留 skillmd-scriptlist-sync 闭环）：SKILL.md
  §派发与自检 补登 `check-hardcode.mjs`。
- **供应商实配名指针化**（残留 glm-look-endpoints 闭环）：SKILL.md
  与 references/07 操作段的模型名/端点改为指向 org-config 与
  `glm-look.mjs --list-sources`；07 修订记历史叙述按红线原样保留，
  白名单条目相应收缩为历史豁免。
- **关联技能断链修复**：loop-defenses / loop-retrospective 的
  `../loop-engineering/` 死链改指本技能 references（03/04/05），
  并在两件中显式声明与本技能的分工。
- **新增姊妹技能 review-ai-code**（用户模糊需求分析落地）：面向
  人类负责人的全局图景建立 + AI 产出审查 + 带掌控派活协议；与本技能
  互补——本技能管"AI 组织怎么运转"，它管"人怎么驾驭 AI 组织"。

## 2026-09-14 v1.2（优化批——Kimi 异源对抗审核后；裁决档=scripts/audits/
  2026-09-14_plan-v1-ruling.md，审核档=同目录 *-kimi-audit-out.md）：
  修复合入前防线自身的三处「自证失效」+新增两项机检——**P0-1** 收口
  门禁被演练数据永久卡死（实测 RED ×1；原 won't-fix 被证伪）→ 演练行
  源头甄别 + health-scan 跳过 mocked/临时项目；**P0-2** 截断的审计报告
  被记为 ok（实测 8 笔，含门一 out=32768）→ 账本 `truncated` 派生布尔 +
  health-scan ④ RED（白名单反转判据）；**P0-3** 「零硬编码」声明无机检
  且正文确有 live 端点 → check-hardcode.mjs（名单从 org-config 派生，
  WARN 起步 + 独立 JSON 白名单）；**P0-4**（审核者未见，基线亲验发现）
  技能自身 R4 回归 FAIL → 网络失败写 `statusCode:null` + regression 按
  `channel` 标记分类外来行。另：账本 schema v2（runId/mocked/truncated/
  schema_version）、Node 版本守卫、任务书增「运行时可观察性」项、
  审计岗 DoD 增机读 FINDINGS 尾栏。八条新增残留见 RESIDUALS.md。

## 2026-09-11 v1.1 补遗④（用户指示）：外呼看图扩双通道——deepseek
  已可识图，与 GLM-5.3-Flash 一起承担视觉任务：glm-look.mjs 增
  `--channel glm|ds`（ds=deepseek-flash@api.deepseek.com，OpenAI
  image_url 载荷；流水 channel=ds-look；识图实证在册）。纪律四条双
  通道同守（截断终态通道化 glm=max_tokens/ds=length）；**三段流
  定式=glm 判读→ds 审核提异见→glm 终裁（D/R 制同构——2026-09-11
  用户指示定式；两轮 -o 落档，视觉验收面照旧留用户）**。真源=
  07 设计岗卡补遗条。

## 2026-09-10 v1.1 补遗③（用户指示）：设计岗外呼看图标准流程入册——
  `scripts/glm-look.mjs`（GLM-5.3-Flash 多模态，宿主 config anthropic
  端点自发现+流水入同账本 channel=glm-look）；纪律四条=max_tokens≥8000
  且零正文自动倍升（thinking 段耗额坑——低档=假成功）/判据先行禁裸问/
  报告溯源头+流水可指认/方向级决策仍留用户。真源=07 设计岗卡；首次
  实战档=WaterPrint C 批需求采证（.workflow/c-analysis/）。

## 2026-09-10 v1.1 补遗（用户 Ruling）：①v1.0 冻结生效（四项裁决，
  见「验证状态」节）；②02 §8.6 三段通道新增第 0 步「社区实践调研
  前置」——较大模块技术路线选择，主控（GLM）先调研社区实践
  （技术大佬/知名项目选型），调研结果随任务包作 Kimi 拟定参考输入，
  不闭门造车即可。

## 2026-09-10 v1.1（优化战役，W5 全局三源审计回炉轮 1）：加载地图+09；
  烤验触发表立节（W4）并按双源审计增「纯配置变更批/收口交付批」两行
  +复合批并集注记；团队化边界段立节（W3）；派发命令清单+三新脚本
  （init-defenses/regression/health-scan）；Node24 派发注记
  （HOST-node25）。变更明细=技能仓库 git 提交链（W0~W4 五提交）+
  回炉轮 1 提交；审计档=Synapse scripts/audits/2026-09-10_w5-*。
