[routing]: run=20260916130257-58s9 source=deepseek model=deepseek-v4-flash role=auditor-readonly@001e83df cfg=8296eaf4dc7e switches=0 usage=in=1665,out=7484 latency=36806ms (by ds-call-v2 链)

# 审核发现（org-config 新增 source_health / vision_channels）

**B 级（阻断）**

**[B] 定位：diff 新增 `vision_channels.note` 与其下 `hardcode_scan.note`（同件互斥声明）**
问题：两处对"供应商事实归属"给出直接互斥口径——`vision_channels.note`："供应商事实住本件（06 §0）"；`hardcode_scan.note`："供应商 live 事实（端点/实配名）在宿主 config 而不在本件"。而本批确实把供应商事实写入默认件（`model:"GLM-5.3-Flash"`、`prefer_hosts:["open.bigmodel.cn","z.ai","zcode"]`、`endpoint_contains`）。同一批事实出现两个事实源声明，与本战役"单一事实源"目标正面冲突；`forbidden_terms` 仍为空，未把新入供应商词纳入扫描，防回退也缺位。
建议：应显式切分并统一二者口径（如"身份/甄别事实住本件，连接与密钥事实住宿主 config"），二取一；并将本件新增供应商词同步进 `forbidden_terms`。若原意即"身份在此/连接在彼"，补一句边界声明后可降为 W。

**W 级（应修）**

**[W] 定位：`source_health.dual_groups` ↔ `gate1_primary/secondary_subagent`**
`dual_groups` 为源别名（kimi-main/kimi-backup），`gate1_*_subagent` 为子代理名（ops-gate1-k1/k2），命名体系不同却同放一区，无字段表明哪段属哪组、组与子代理如何对应；换源推荐取值路径不可判定。
建议：应增显式关联键（如组对象内并列 primary/secondary，或子代理指向组 id）。

**[W] 定位：`source_health` 全节**
本批立意即"别名变更致静默失效"，但配置值与脚本/注册表的匹配**无校验约定**——kimi-main/kimi-backup、ops-gate1-k1/k2 写错时仍是静默失效，旧病复现。
建议：应约定 `--health` 启动即校验，未命中显式报错而非静默。

**[W] 定位：`vision_channels.glm` 与 `vision_channels.ds`**
两通道 schema 不对称：ds 无 `prefer_hosts`，为必选还是可选未声明；缺 `prefer_hosts` 时甄别/排序行为未定义。
建议：应声明各字段必选/可选及缺失默认行为。

**[W] 定位：两通道 `endpoint_contains`**
甄别口径不一致：glm 用协议路径 `/anthropic`，ds 用厂名 `deepseek`。经 Anthropic 兼容路径代理的 deepseek 类端点可能同时命中两通道，源选择有歧义；命中优先级未声明。
建议：应统一甄别口径并定义多通道命中时的裁决顺序。

**[W] 定位：`vision_channels.note`「未命中者殿后按宿主 config 序」**
依赖 JSON 对象键序，而 RFC 8259 不保证对象保序，非确定性。
建议：应以显式数组或排序键替代对象序。

**[W] 定位：`vision_channels.note`「--list-sources 输出与改前一致（等价迁移）」**
等价迁移仅对默认件成立；项目覆盖件若未含 `vision_channels`，按语义 2「通道未声明=无源返回」将回退到无源，与"等价迁移"声明冲突。
建议：应说明覆盖件迁移前置条件，或为未声明态提供兼容回退。

**[W] 定位：`hardcode_scan.note`**
其空 `forbidden_terms` 的理由（"供应商事实不在本件"）已被本次新增两分区推翻，逻辑不成立。
建议：应据新事实重述理由或补扫描名单（与首条 B 合并处置）。

**N 级（提示）**

**[N] 定位：`vision_channels.glm.model` / `ds.model`**
`GLM-5.3-Flash`、`deepseek-flash` 的真实性/时效**包内不可验证**（零仓库接触）。不确定，须宿主侧对账。

**[N] 定位：`vision_channels.glm.prefer_hosts`**
`zcode` 混列于公网域名间，疑似内部/环境代号；本机事实入默认件，加剧 ask 面 2 所述通用性张力。
建议：应确认其归属或迁至覆盖件。

**[N] 定位：§2.3 / §3.3（payg 告警）**
"告警不阻断"留痕合理，但非交互流水线中 stderr 告警易被吞没，费用面留痕不落地。意见：最低限度补机读标记位（如结构化日志字段），是否加确认位留用户终裁。

**[N] 定位：§2.4（cfg 哈希漂移）**
以"本批复核"充当漂移处置动作，属自证闭环，缺独立重盘投放面的证据。
建议：应另附重盘结论而非以复核代处置。

**总评与放行意见**
材料自包含、diff 清晰，行为变化基本可读。但存在 1 处同件互斥的事实源声明（与单一事实源目标冲突），以及 source_health 映射/校验缺位、vision_channels schema 不对称与甄别口径不一致、迁移等价前提未闭合等 7 项应修。新增分区确实加剧了与本机事实、宿主 config 的边界张力。
**有条件放行**：条件——(1) 统一"供应商事实归属"口径并处置 `forbidden_terms`（B）；(2) 补 source_health 映射键与校验约定；(3) 明确 vision_channels 字段必选性、甄别口径与优先级；(4) 说明覆盖件迁移前提。上述落地后放行。

FINDINGS: B=1 W=7 N=4 VERDICT=有条件放行