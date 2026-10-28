# 10 · 宿主兼容事实单源件（host-compat）

> **§0 性质（本册为宿主版本耦合事实的唯一真相源）**：本技能与 zcode 宿主
> 及本机运行时**强耦合**的事实全部住本册——SKILL.md 与 references 各件
> 正文一律持指针（A3 禁复写），宿主升级时只改本册一处。每条三栏：
> **事实 / 实证环境戳（宿主版本+日期） / 异机重验动作**。
> 边界两条：①通用 Node/传输层工程事实（undici headersTimeout、SSE 语义
> 等）非宿主特异面，住 06 §5.7 不入本册；②项目环境怪癖（Git Bash rm
> 卡死等）住 references/04 的 MG 系（迁移教训）与各项目宪法，不入本册。值守类数值（如受禁 Node
> 大版本）住 org-config `supported_node`，本册只存语义与经验。
> 修订纪律：历史条目禁改写（08 §3）；宿主升级核验后**追加**修订记。
> 本册打包随技能走（通用于同版宿主），异机首跑按 §6 清单逐条重验。

## 1. 运行时与工具链

| 事实 | 实证环境戳 | 异机重验动作 |
|---|---|---|
| Node 25 下 ds-call-v2 退出阶段 libuv 断言崩溃（HOST-node25）——外部派发一律用 Node 24 跑；脚本启动带版本守卫（守卫读 org-config `supported_node.forbid_major`，禁硬编码） | 本机 Node 25.2.1，2026-09-17 已登记 | 异机/升级后跑 `org-config --self-test` + `regression`（R10②=glm-look 回归载体，其无 --self-test flag；ds-call-v2 已删除——清理批次 2026-10-03）；deploy-check node-major 检查须绿（版本守卫现役载体=deploy-check，volta node24 复跑先例已登记） |
| volta run 将任意非零退出码掩成 126（0 正常透传）——脚本化消费精确退出码时直跑 node 或 volta pin 固定 | 本机 volta 实证 2026-09-17（RESIDUALS volta-exitcode-mask） | 出现退出码消费封装时先跑 1/2/3 退码对照 |
| 本机 `grep`=shell 函数包壳 ugrep：多文件输出次序不稳定；`--ignore-files` 遵守 gitignore，忽略模式直接影响扫描面。处置=涉多文件管道一律加 `sort` 或改计数形态；可能零命中的 grep 以 `wc -l` 收尾，退出码才可判 | 本机 2026-10-25（P9 批实测——批档 P9-close 第 4 节） | 异机首跑 `type grep` 核对形态；多文件次序与忽略行为各做一次对照实测 |

## 2. 派发与代理档案语义（zcode 宿主）

| 事实 | 实证环境戳 | 异机重验动作 |
|---|---|---|
| 宿主 Agent 工具面无 model 参数（会话内岗定档限制 → E3 待补登记记账） | 2026-09-02 Synapse 实测 | 新宿主版本查 Agent 工具签名；有 model 参数则按 06 §6 承载切换 |
| `~/.zcode/agents/*.md` frontmatter model 字段=定档绕行通道；格式=`<provider-uuid>/<model-key>$<档位>`；缺 `$` 档位=宿主派发拒启 reasoning-level-missing（宿主代码实证：resolveProfileModelSelection/parseModelPickerValue 路径） | 2026-09-17 宿主代码实证+活体派发实证（metadata modelSelection.reasoningLevel="max"） | 首部署/改档=新会话真实小任务 + `log-triage ③` 零回退 |
| 上游枚举值（sonnet 等）静默回退宿主=假绑定，禁用（负面清单⑤） | 同上批实测 | log-triage ③ 声明 vs 实际路由核对 |
| `tools: []`（空数组）=泄漏全工具面而非无工具；无工具岗须显式清单或 `tools: Read`+协议墙 | 2026-09-16 子代理绑定批 | 新代理档案部署时核对工具面快照 |
| 代理档案=会话启动快照，无热加载——改代理档案对在跑会话不生效，须新会话验证 | 2026-09-16 批（设立会话内不可派发先例） | 改档后首场派发核对（RESIDUALS gate1-d1-firstdispatch 形态） |
| 宿主供应商注册表=双文件形态：新增供应商只落 `~/.zcode/v2/provider_config.json`（providerConfigRules.providerRules——providerId/providerName/config.access.apiKey/config.api.baseUrl/config.personalModelIds），旧 `~/.zcode/v2/config.json` provider 段不再收新条目——`readHostConfig` 双注册表合并（`mergeHostRegistries` 纯函数：旧件打底+新件映射覆盖同 id，映射形态与旧件消费面同构） | 2026-10-03 kimi-third 改绑批实证（新条目=本机件 kimi-third 所指宿主条目，仅落 provider_config.json，条目名/前缀实值住本机件；单读旧件=validate「无该前缀条目」必败） | 异机/宿主升级后跑 `org-config validate`+`--self-test`（双注册表向量）+`deploy-check`；宿主注册表形态再变=本册追加修订记（历史条目禁改写） |

## 3. 观测面（metadata/日志形态）

| 事实 | 实证环境戳 | 异机重验动作 |
|---|---|---|
| 子代理 metadata `profileSnapshot.model` 字符串 → `modelSelection` 结构体演进，旧检测面静默失明——declaredModelOf 已收编两格式；tripwire=log-triage ③ WARN「格式漂移疑似」 | 2026-09-17 发现（host-metadata-schema-drift） | 宿主升级后首场绑定岗派发核对 metadata 形态仍被认识 |
| 空字符串 model 声明（`model:""`）语义未确证，按非绑定岗跳过暂不告警 | 2026-09-22 实证裁决（岗）B3 登记（empty-declared-blindspot） | 宿主实证出现空串时先确证语义再定口径 |
| 历史会话 metadata 残留（伪值/无档位声明）污染 log-triage ③ 输出 | 2026-09-22 全局诊断批（probe-bc-metadata-residue） | ③ 呈现面升级时加无档位声明过滤；复发升宿主排查批 |

## 4. 子代理执行面怪癖

| 事实 | 实证环境戳 | 异机重验动作 |
|---|---|---|
| 子代理 Bash 传参层 `>` 截断（已登记残留）——含 `>` 的命令一律改脚本文件载体（先落 .js 再执行），修复前不派裸 `>` 命令 | 2026-09-16 runbook 已登记 | 新宿主版本派发含重定向命令实测 |

## 5. 订阅环境注记

- 2026-09-19 随宿主批用户裁决语境：宿主已配 coding plan 服务商，故
  实现者/实证裁决（岗）/SRE 诊断三岗改未绑定形态（回落宿主默认+E3 待补登记）。
  **订阅事实本身（服务商/档位/配额）住 org-config（v2.1.0 批起个人实值
  迁 org-config.local.json，gitignore 不随包）**，本条只存裁决语境。

## 6. 异机重验清单（打包分享/新机移植前置）

| 条目 | 重验动作 | 关联触发器（RESIDUALS） |
|---|---|---|
| Node 大版本面 | deploy-check node-major 绿；org-config --self-test+regression R10 | HOST-node25（历史行） |
| 绑定语法与拒启行为 | 新会话小任务派发 + log-triage ③ 零回退 | gate1-d1-firstdispatch |
| metadata 形态 | 首场绑定岗派发核对被 declaredModelOf 认识 | host-metadata-schema-drift |
| `>` 截断 | 含重定向命令实测（或维持脚本载体规避） | ——（06 §6 补遗二·五） |
| volta 退码掩码 | 退码消费封装前 1/2/3 对照 | volta-exitcode-mask |
| 流式/超时窗真端点语义 | 真外呼窗口核验 | evolve-b1-transportresidual |
| 干涸窗真实触发路径〔已作废〕 | 机制随派发器物理删除（2026-10-03 清理批次）——重验对象不存在，本行为闭项留痕 | r2-drywindow-livefire（closed 2026-10-03） |
