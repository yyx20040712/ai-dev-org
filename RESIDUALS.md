# 残留登记册（ai-dev-org · selfiter 批重立薄册 2026-09-17）

> 三态：open（待处置）/won't-fix（显式不修+裁决依据）/closed（已修）。
> **静默消失=违规**。历史登记全量=归档件 `~/.zcode/skills/_archive/
> ai-dev-org-history-2026-09/RESIDUALS.md`（含 selfiter 终态化登记节——
> B1/B2 修复闭 20 项、C 类终态 11 项、范围界定与触发器口径；路径相对
> skills 根）。本册只登记其后新发现与在册触发器。

## 触发器行（open——触发即处置）

| 编号 | 内容 | 触发器 |
|---|---|---|
| evolve-b1-transportresidual | >300s 首字节/Node25 退出面/异端点流式语义三面不可本机实证 | 真外呼窗口（R1 真跑/设计岗首用）核验 |
| evolve-k2-silent | k2 首派静默失败单次事件 | 复发≥2 次升宿主排查批 |
| g3-deploy-writereal | 派生覆盖件异机真机写盘 | 下次新机部署首跑 --install |
| PostToolUse-livefire | hook 实弹触发验证 | 需机检强制（hook 拦截）的批次首场核对 |
| killed-agent-metadata-gap | 被杀岗 metadata 无声明值可核 | 机检化（编排会话派发记录回填）后续批 |
| check-anchors-calibration | 全角冒号形态/dod.md 扫描面/点名豁免漂移面 | check-anchors 升 --strict 决策前置批 |
| host-metadata-schema-drift | 宿主子代理 metadata schema 演进使 ③ 检测面失明（在册实例：2026-09-17 profileSnapshot.model 字符串→modelSelection 结构体，旧 ③ 静默跳过新格式绑定岗——declaredModelOf 已收编两格式） | 宿主升级后首场绑定岗派发核对 metadata 形态仍被 declaredModelOf 认识；常驻 tripwire=log-triage ③ WARN「格式漂移疑似」（detectMetadataShapeDrift：model 键非字符串/modelSelection 残缺）出现即触发处置 |
| empty-declared-blindspot | 空字符串 model 声明被当非绑定岗静默跳过（tripwire 只查非字符串形态；批前既有行为，宿主空串语义未确证——门二裁决 B3 登记） | 宿主 metadata 实证出现 model:"" 时处置（先确证语义再定跳过/漂移口径） |
| log-triage-import-side-effect | log-triage.mjs 顶层无 import.meta.main 守卫，import 即跑 CLI 主流程（门二实证 M5-M7 注入命令实录；批前既有） | 出现模块化消费该文件的需求时加守卫（当前消费面=CLI+自检，无受损） |
| synapse-md-expand | Synapse 项目仓 md 面门禁扩面（范围外） | Synapse 项目仓独立批 |

## 修订记

- 2026-09-17 档位批首验闭合：selfiter-k1k2-reasoninglevel **closed**（新会话派发
  ops-gate1-k1 真实审包小任务）。证据链四件：①宿主 metadata
  `profileSnapshot.modelSelection.options.reasoningLevel="max"`（`$max` 语法宿主
  解析活体实证）；②网络日志 provider=kimi-main（org-config 别名）/model=声明
  绑定值（剥档位后一致）/attempt=1/finish=stop（102s/8691tok，tool_uses=0=
  协议墙遵守）；③log-triage ③ 零回退
  检出+⑥ 归因 `ops-gate1-k1 @ kimi-main calls=1 in=5439 out=3252`（与 metadata
  usage 逐字一致），MODEL-SELF 尾栏=声明值；④反证样本：同日 5 次旧快照
  （level=None）派发全部卡死 status=running=拒启形态。随批清偿检测面盲区
  （首场真实派发即暴露）：log-triage ③ 声明值归一器 `declaredModelOf`——
  宿主 metadata 新格式 `modelSelection` 结构体合成同构字符串、旧 `model`
  字符串透传、残缺形态=null 跳过不合成伪值；单比较口径不分叉+4 自检向量
  （regression R8 承载，8/8 过）。

- 2026-09-17 档位批：根因定位 selfiter-k1k2-reasoninglevel=宿主 model 串
  `$档位` 后缀语法（非 UI 选择器）；六岗七档案+六模板统一 `$max`（含清偿
  三件 GLM 岗契约尾栏残留的旧前缀串）；log-triage ③ 检测面同步（VALID_MODEL_RE
  认 `$` 后缀+account: 前缀、比对剥档位，向量随批）。

- 2026-09-17 v2.0.1 修复批：外部全局对抗审（主控承接分析+门一 Kimi 双源
  独立全局审双 PASS——绑定子代理通道受阻按 runbook 换外部派发器承载）清偿
  脚本 7 中+18 低缺陷与 2 处文档双源漂移（明细=git 分笔提交）；三件 GLM
  绑定模板与已装档案统一 account: 前缀（宿主 provider id 再变更时
  deploy-check warn 复活属预期执法非缺陷）。

- 2026-09-17 selfiter 批 B3 重立：全量册归档（65 件历史件随批出库，sha256
  对账 65/65 OK），薄册仅承载触发器行与后续新登记。
- 2026-09-17 selfiter 批 B4/B5/B6 承接项闭环：evolve-m6-runid+
  project-id-migration（B4）、glm-look-streaming（B5——真端点流式语义留
  R1 真外呼核验位）、check-hardcode-promotion（B6 升格判据满足，strict
  RED 生效+--warn 逃生口）。g3-glossary-drift 并入 08 §4 体检纪律（用户
  裁决，不单独立项）——至此 selfiter 四组裁决 D 类全部实施完毕。

- 2026-09-17 selfiter v2.0 收口注记：门一出件 B=0/W=3/N=3 PASS 全数处置
  （回炉笔 a872d5e）；R1 真实派发 3/3 双源方向一致（流式派发器首场，
  kimi-main 三连首发成功零 504=B5 真窗实证）；门二机械矩阵 12 项真退出码
  全绿（主控承载——selfiter-k1k2-reasoninglevel 欠账范围实证波及全部绑定岗）。
