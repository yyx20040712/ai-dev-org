# 06 · 模型路由与换源状态机（ai-dev-org 视图）

> **零硬编码声明**：供应商事实（源序/端点/套餐/额度/配给）一律以
> org-config 为唯一真相源——技能默认件 `org-config.default.json` +
> 项目覆盖件 `<项目>/.zcode/org-config.json`（深合并语义：对象逐字段
> 覆盖、未提及字段沿用默认、数组整体替换、显式 null=删除；规范化
> 哈希=递归键排序+剔 null+紧凑序列化的 sha256 前 12 位，工具
> `scripts/org-config.mjs hash`）。本件与 SKILL.md 均不含任何具体
> 端点/套餐数字。
> 母本=loop-engineering references/06 v1.1（归档于 `~/.zcode/skills/_archive/
> loop-engineering-archive-2026-09/`——路径相对 skills 根）；依据链=用户四次 Ruling
>（2026-09-02，扩展派发器/实现面禁 deepseek/审计面放行/三段通道）。

## 1. 分工总表（岗位×通道×档位语义）

岗位全属性（通道/tier 记法含 org-config `roles.*` 键名/职责/禁令/交接物/编制表注）**单源=references/07 §1**——本节不再复写表格（v1.7.5 收敛）。路由域注记三条：
- SRE 诊断岗=不定档；结论将直接写入票面/裁决链时升档承载（细则=07 §1 SRE 行）；
- 设计岗外呼看图流水入同账本（channel=glm-look——细则=07 §4 设计岗卡）；
- 绑定子代理现役承载（六 ops-*）=07 §4 补遗。

**三段通道**（路线级设计）：`drafter` 拟定设计书（候选≥2+权衡）→
`auditor-readonly` 位异构对抗审核（只挑错不改写）→ 主控终裁+指挥实现。
拟定者不终裁、审核者不改写、主控不跳审自裁。单函数级局部优化不走
此通道（主控直裁）。

## 2. 三条设计铁律

1. **单一调用者**：一切模型/子代理派发只出自主控，显式指定机型+供应商+
   思考等级，禁静默继承默认（缺省继承=最贵档静默浪费）。
2. **实现与审查分离**：实现者不审查、审查者不实现；门一只见自包含
   diff 审计包（简报+完整 diff 内联+验证摘要），零仓库接触。
3. **异构对抗**：审查者与实现者尽量异源（同源记欠账）——稀缺额度
   只买「异构对抗」这一件事。

## 3. 额度经济学（投放面原则；具体数字与红线看 org-config）

- 稀缺源（如企业版小额度档）只投两处：**门一异构对抗**+**路线级设计
  拟定**。必保面=受锁面/安全面/跨模块接缝/数据批/迁移/回炉第二轮起/
  新依赖引入；可省面=≤3 文件小批/纯文档批（降同源=配给内降级，非欠账）。
- 套餐外按量源**分面放行**：实现面禁用；审计面放行（兜底层+门二异构位），
  用量流水账可指认。
- 体验套餐（易逝额度）发现即优先消费：同档位先烧体验再烧主力；多模态
  任务默认低档体验位；判断力密集环节不降档；耗尽回落正式套餐**不记
  换源事件**。

## 4. 换源状态机（主源耗尽换备源）

```
主源（org-config source_chain[0]，不得主动跳过）
 → 耗尽/限流/配额错 → 备源（任务书与 DoD 不放宽；事件=switch 入账）
 → 链内递进至兜底审计源（套餐外计价，事件=switch）
 → 全源尽 → 记 exhaust+「同源审计欠账」回退只读审子代理
    （连续两个关键批未补还异构审计 → 升级用户裁决）
```

- 换源/欠账/用量事件逐件入 `model-routing-log.jsonl`（派发器自动）
  与项目账本 `.zcode/org-ledger.jsonl`；审计报告头标注 [routing] 行。
- 退避：429/5xx/网络错指数退避 3 次后换源；400/401/403/404（配置级
  错误）不退避立即换源；末次守卫=抛真实状态码并落 switch 事件。
- 主备源同端点不同配额的形态（第二配额备源）与异供应商备源形态均
  由 org-config providers 描述，状态机不区分对待。
- **payg 显式告警（2026-09-16 v1.6 批预裁）**：链首源或换源目标为
  `billing:"payg"`（套餐外按量）时，派发器 stderr 显式 `[payg]` 告警
  ——换源不放宽任务书与 DoD（本节铁律），但费用面必须留痕不静默。

## 5. 派发器 v2（角色档案化）与记账

- CLI：`node scripts/ds-call-v2.mjs --role <id> [--source <alias>]
  [--project <名>] [--dry-run|--list-roles|--list-sources]
  [--mock-source <alias>:<status>] <prompt文件> [输出文件]`。
- **无 `--role` 即报错**（v1 内嵌系统提示已废止——硬编码缺陷在 v2.0
  归零）；系统提示+DoD 随 `scripts/roles/registry.json` 装载（路径
  相对技能根）；DoD 拼接进 system 消息末尾，user 消息保持纯任务包。
- 每事件记账字段（**运行流水 model-routing-log.jsonl 统一行 schema**：
  ts/runId/event/source/model/+扩展字段 role_id/role_version/role_sig/
  dispatcher_version/org_config_hash——项目账本 org-ledger.jsonl 的行
  schema 见 SKILL.md 派发节与 02 §9，两账各用各的 schema，勿混）；
  输出首行 `[routing]: run=… role=<id>@<sig> cfg=<hash> …`。
- 源装载校验：org-config `providers.<alias>.uuid_prefix`+`entry_name` 与
  宿主 `~/.zcode/v2/config.json` 条目双校验，不一致即 **exit 3**（语义与
  全退出码总表=本件 §5.8——本节不复写）并输出 alias/期望/实际三元组，
  无任何 fallback。
- 回归前置（全部 R 项过方启用 drafter 复用与项目切换）：R 项清单单源=
  `scripts/regression.mjs` 现行项集合（--only 可选项）——本节不复写清单，
  防双源计数腐化（evolve 批 b8 指针化）。

### 5.7 传输层与超时（v2.2.1 补遗，2026-09-16；来源=F-TESTREF-00 门一补审 5 轮 17 attempt 排障+本机双臂探针实证）

**故障形态**：后台派发长推理（5 分钟量级）被掐，服务端记 **499**
（context canceled——**客户端中断族，非服务端宕**；用户侧后台观察与
服务端日志互证）。链路=推理时长 > 网关 5 分钟**非流式窗口** → 网关
切断 → 后端在途调用记 499。

**根因双层**：①网关侧非流式窗口（服务侧约束）；②客户端侧 **undici
（global fetch）内建 headersTimeout≈300s 默认**——非流式长推理的
隐形杀手，306.3s 即 `TypeError: fetch failed`（本机 400s 延迟服务器
双臂探针：A 臂 global fetch 306.3s 即死；B 臂 node:http 直连 400s
全通，唯一超时=自设上限）。对照样本：成功派出 out≈9273 tok≈247s
——贴窗沿通过，窗口即硬顶。

**对策三层（v2.2.1，用户指令 2026-09-16：后台调用上限 10→20 分钟）**：
1. **传输层**：弃 global fetch 改 **node:http(s) 直连**（postJson
   helper；undici 包在技能目录不可解析——动态 import 按模块位置走，
   故不采 setGlobalDispatcher 方案）；**signal 是唯一超时来源**，
   `CALL_TIMEOUT_MS=1_200_000`。退避/重试/解析语义零变化。
2. **输入层**：**审包体积=派发时效主变量**——同窗口内推理时长≈
   f(输入+输出预算)。审包 v4 实测 110KB→84KB：剔 registry 巨行/
   AGENTS 全文/methodology diff/变异 raw 附。
3. **输出层**：**产出预算硬约束**——简报输出段设 token 上限
   （补审先例 ≤4000）入任务书，防产出段撑长推理贴窗。

**分诊口诀**：499=客户端中断族——先分层（服务端/网关/客户端），
双臂探针定层，勿直断服务端宕。**残留**：流式化（根治贴窗）留
技能层后续（登记 RESIDUALS）。

### 5.8 退出码总表（全脚本统一契约——2026-09-16 v1.6 批）

| 退出码 | 语义 | 适用 |
|---|---|---|
| 0 | 成功（可有 WARN/INFO 回显） | 全部 |
| 1 | 用法/参数错；自检断言失败；RED 级事项检出（分诊类） | 全部 |
| 2 | **源链耗尽 exhaust（派发器专用；regression R1 断言依赖——其他脚本禁复用）** | ds-call-v2 |
| 3 | 配置/装载错（org-config 缺段、源双校验不符、golden 缺失、词表缺失） | 全部 |
| 4 | 本地 IO 错（输出写失败等——远程调用已发生语义不回滚） | ds-call-v2 |
| 5 | 降级运行（输入/发现面部分不可用：宿主配置/白名单损坏——显式留痕不阻断） | check-hardcode、glm-look（selfiter 批扩入） |

本表=退出码唯一真相源；各脚本头注一律指针到本表，禁复写语义（A3）。
**迁移注记（本表统一的旧行为→新行为，供存量调用方核对——终审 N3）**：
glm-look 用法错 2→1；skill-gc 参数错 2→1；四脚本自检失败（头注旧称=3）
实为 1；org-config 缺 finish_vocab 等词表=新增 3 类拒跑（ds-call-v2/
log-triage/glm-look 三处同律）；check-hardcode 新增 5=降级运行。
**v1.7（evolve 批）**：log-triage 非法 --date 静默空窗→exit 1（用法错，
窗口并增次 UTC 零点上界）；ds-call-v2 英文 locale 配置装载类未捕获异常
exit 1→3（类型化分类替换消息正则）；registry 文件路径越界新增 exit 3
拒绝（纵深防御，当前不可达）；null provider 三路径 TypeError 崩溃→
org-config/ds-call-v2 exit 3+明确消息、check-hardcode 降级 exit 5 继续扫。
本批起各脚本头注一律仅持「口径单源=本表」指针（九件复写块清偿，C1 机检）。
**selfiter 批 C1 严式常驻**（evolve-p2-① 扩面）：`exit N=`/`退出码：N=` 两式
数字=语义复写形态由 pre-commit 快扫拦截（原 one-off grep 配方的变体盲区闭合
——严式首扫即揪出 b8 清偿后残留的同族两处）。
**selfiter 批 glm-look 面行为变化申报**：①宿主 provider null 条目=降级行+
跳过、exit 5（行 5 适用面扩入本件——原 TypeError 崩溃面，M3 族第 4 消费点）；
②截断终态（含「截断但有正文」）一律倍升重试，3 轮后仍截断=报告照常输出但
exit 1 不记成功（原 hasText 即收=假成功面，05 §4 判据「截断的审计报告不算
合格审计」执法）；③流水行 schema 对齐派发器 ctx 五字段+attempt/finish_class/
statusCode（R4 对 channel+dispatcher_version 双标记行按对齐 schema 校验，
legacy 行维持外来跳过）；④argv 收编 cliFlag 单源（缺值/重复/值形如 flag/
等号形态/未知 flag=用法错 fail-fast）。

## 6. 会话内子代理定档限制与欠账（诚实记账）

- 宿主 Agent 工具面**无 model 参数**（2026-09-02 Synapse 实测）——
  实现者/门二/只读排查岗无法强制指定机型。处置：简报首行写**意图
  档位**（主控声明），收口时账本如实记「环境限制统一档」欠账行；
  禁止伪装已定档、禁止以"大概同档"入账。
- 该限制是**宿主能力边界**，不是提示词可解项——新环境若有 model
  参数，org-config 可将相应岗位改挂外部派发器通道（承载切换=配置
  项，流程不变）。

**§6 补遗（2026-09-16 试金石+七代理首场验证，子代理绑定批）**：
`~/.zcode/agents/*.md` frontmatter **model 字段**=上述限制的绕行通道，已双证据实证：
①跨供应商绑定生效——格式=`<provider-uuid>/<model-key>`（Kimi 双源与 deepseek
三源绑定值均日志实证零回退——具体值以 ~/.zcode/agents/ops-*.md frontmatter
与宿主供应商注册表为准，不抄入本件）；
②**上游枚举值（sonnet 等）静默回退宿主=假绑定，禁用**（负面清单⑤）；
③`tools: []`（空数组）=泄漏全工具面而非无工具——无工具岗须写显式清单或
`tools: Read`+协议墙；④代理档案**会话启动时快照**（无热加载）——改文件须
新会话验证；⑤首部署纪律=日志核对一次（`log-triage.mjs` ③ 静默回退检测
机检化：声明 vs 实际路由不符=RED）。六 ops-* 代理（executor/diagnostics/
probe/adjudicator/gate1-k1/k2）已按此入役，清单见 07 §4 补遗。
**与 E3 的关系澄清（审核 W-3）**：绑定岗免记「环境限制统一档」欠账行——
frontmatter model 绑定值经日志核对零回退后，LEDGER-CLAIM 尾栏
EXECUTOR=model-field:＜值＞ 即机读证据（W-2 双印证非双源）；未绑定岗
（无 model 字段）维持 E3 原条款不变（意图档位声明+欠账行）。

**§6 补遗二：子代理失败接续 runbook（selfiter 批 B2 迁入——真源自此在技能内；
原外源件=subagent-plan-2026-09-16/09 号件，按 08 §3 归档不改写）**：

一、**死亡检测与归因（第一步必做）**：子代理无响应/失败返回/会话中断 →
先查日志归因再选处置（禁盲重试）：`node scripts/log-triage.mjs --hours 2 --health`
（技能根解析）。归因源=CLI 日志（子代理会话 model.network.* 事件）+
agents metadata（声明绑定/status/usage）。

二、**三类处置**（五类分诊收敛为三动作）：①额度类（429/403）=读进度落盘→
派另一源继任（双源岗互换；异构岗按 org-config source_chain 递进）——换源不
放宽任务书与 DoD，事件入账；②窗口类（504/超长时延）=同源瘦身重派（同端点
共模换源无效——处置=审包体积↓/产出预算硬约束/流式化）；③无工具岗中断
（纯包岗）=同包重跑（输入即全部状态）。其余类：传输层瞬时错=退避后同源
重派；配置错=停批修配置禁重试。

三、**继任者接续简报（固定三件）**：①已完成清单（来自进度文件/提交史，
逐项+证据指针）②剩余清单 ③上下文指针（进度文件路径/commit 范围/证据目录
——继任者第一动作=读指针恢复状态，并对已完成项证据文件做存在性核对，
缺=上报而非静默重跑）。

四、**分笔落盘纪律**（模型调用失败=子代理无法再汇报的等价实现）：写工具岗
每单元即时落盘（executor=分笔 commit；probe=进度文件回写）；只读岗=单交付物
短任务同包重跑（无进度文件——写通道会破坏只读墙）；纯包岗=同包重跑。

五、**简报层已知缺陷规避**：子代理 Bash 传参层 `>` 截断（在册残留）——含
`>` 的命令一律改脚本文件载体（先落 .js 再执行），修复前不派裸 `>` 命令。

## 7. 新项目对齐清单

**必保留（缺一即失守）**：开工盘点含模型调用面（逐项用/不用+理由，
单件落盘）/单一调用者+显式定档/实现与审查分离+门一隔离（自包含包）/
审查者与实现者异构优先+同源记欠账/套餐外源分面放行（实现面禁、审计
面受控）/成本按模型×供应商×套餐分列+cfg 哈希入账。

**可按项目裁剪**：派发器通道的有无（无外部 API 环境=外部岗位降级为
文件交接协议：任务书落盘→人工/另会话投递→产出物回读入账）；回炉
轮数；体验套餐细则（无订阅则删）；冻结提取是否独立岗；账本文件位置。

## 8. 修订史

- 2026-09-16 v2.3 子代理绑定批（A+A'+B-0+B-1）：§1 分工总表设计岗行模型名
  指针化（--list-sources）；§6 补遗=frontmatter model 绑定事实五条（跨供应商
  生效/枚举值假绑定禁用/空 tools 泄漏/会话启动快照/首部署日志核对）；新增
  观测面工具 scripts/log-triage.mjs（五类分诊+静默回退检测+岗×源用量+finish
  终态派生+--health 源健康与 k1/k2 推荐）；org-config/registry 增 roles.*
  migration_note（迁移期双承载注记，§9 用户指令二落地）；cfg 哈希
  bec09005e3ac→54f08fbf90c5。批档=E:/zcode_md/fix/subagent-plan-2026-09-16/。
- 2026-09-16 v2.2.1 补遗：§5.7 传输层与超时入册（来源=F-TESTREF-00
  门一补审排障+双臂探针实证；对策三层=传输层 node:http 直连+signal
  唯一超时源+20 分钟上限／审包瘦身／产出预算硬约束；499=客户端中断
  族分诊口诀；用户指令「后台调用上限提至 20 分钟」）。

- 2026-09-10 v1.1：增设 SRE 诊断岗 sre-diagnostic（只读排查升格）与
  设计岗 design-reviewer（视觉判读条款升格为岗）——均会话内岗，不入
  注册表/org-config roles，角色卡与系统提示模板见 references/07 §4。
- 2026-09-10 补遗②：设计岗条款行增 glm-look 外呼位注记（GLM-5.3-Flash
  多模态看图标准流程——07 设计岗卡为真源；用户指示入册）。
- 2026-09-10 v2.0（ai-dev-org）：自 loop-engineering references/06
  v1.1 改写——供应商事实全部抽出至 org-config；新增派发器 v2 角色
  档案化条款与记账字段；会话内子代理欠账升格为账本强制输出项
  （设计书=Kimi 拟定，审核=deepseek 5B/5W/3N，终裁档=
  ~/.zcode/skills/_archive/ai-dev-org-history-2026-09/audits/2026-09-10_org-skill-rulings.md）。
- 2026-09-02 v1.0/v1.1：见归档件修订史（用户四次 Ruling 定稿）。
- 2026-09-17 v2.4（m4 清偿批）：派发器请求参数/R1 源名单/anchors 豁免点名单收编 org-config（新分区 dispatch_request/regression_cfg/anchors_exempt）；缺段=exit 3 无静默回退。批档=~/.zcode/skills/_archive/ai-dev-org-history-2026-09/audits/2026-09-17_m4-impl-report.md
- 2026-09-17 v2.5（g3 三残留清偿批）：ds-call-v2 flag 解析收编 org-config cliFlag 单源（W7「分发单元自包含」副本豁免前提过时——主控预裁申报，门二 R-6 裁定成立）+用法错三校验（evolve-l4-flags 清偿；行为变化=缺值/重复/值形如 flag 统一 [用法错] exit 1，行为变化申报=归档区 CHANGELOG v1.7.6 条）；deploy-check --install 增派生覆盖件动作③（deploy-hostfacts-split 清偿）。批档=~/.zcode/skills/_archive/ai-dev-org-history-2026-09/audits/2026-09-17_g3-*
- 2026-09-17 v2.6（selfiter 批 B1+B2）：§5.8 行 5 适用面扩入 glm-look+C1 严式常驻+glm-look 面四项行为变化申报（B1b）；§6 补遗二=子代理失败接续 runbook 迁入（runbook-external-source 清偿，真源自此在技能内）；glm-look 流水行 schema 对齐 ctx 五字段（§5 记账字段面）。批档=仓外 E:/zcode_md/fix/ai-dev-org-selfiter-plan-2026-09-17/
