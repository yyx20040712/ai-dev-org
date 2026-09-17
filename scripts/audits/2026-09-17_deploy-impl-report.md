# 2026-09-17 部署能力批（v1.7.3）实现报告

- 批次：v1.7.3 部署能力批（新机一键自检+首装；外部评估 P5 可落地部分）
- 实现者：ops-executor（会话内子代理）；简报=主控七段任务书（2026-09-17）
- 本批可观察形态=`node scripts/deploy-check.mjs` 七项逐行输出+汇总行（新机首跑即见）

## ① 交付清单（按单元；本批禁 git 操作——commit 由主控收口，哈希栏=收口时补）

| 单元 | 落点 | 交付物 | commit |
|---|---|---|---|
| A | templates/agents/（新建目录+6 件） | ops-executor/ops-diagnostics/ops-probe/ops-adjudicator/ops-gate1-k1/ops-gate1-k2 六件 .md 字节级拷贝（宿主侧→技能仓），逐件 sha256 双侧对账相等 | 主控收口 |
| B | scripts/deploy-check.mjs（新建） | 七项自检+--install+--self-test（16 向量）；ESM/仅 node: 内建/无依赖/中文输出/isMain guard 可 import 纯函数 | 主控收口 |
| C | DEPLOY.md（新建） | 六步部署指南（0 前置~6 回填义务），零供应商 live 事实 | 主控收口 |
| D | SKILL.md | 加载地图节「档案件」行后增 1 行（新机部署与一键自检导航） | 主控收口 |
| E | CHANGELOG.md | 头注后插 v1.7.3 条目（动机/变更/行为变化申报/机检面四节，格式仿 v1.7.2） | 主控收口 |
| F | RESIDUALS.md | 新增「2026-09-17 部署能力批（v1.7.3）新登记」小节（1 行 open=deploy-hostfacts-split）+末节修订记追加 1 行 | 主控收口 |

### 落点 A：sha256 双侧对账表（基线=简报预裁决前 16 位）

| 件 | 宿主侧（源） | 技能仓（templates/agents/） | 对账 | 预裁决前 16 |
|---|---|---|---|---|
| ops-executor.md | 9ec9d19439d6ee01d2209143241e004b746407a428fdc876f401757649876be8 | 同值 | EQUAL | 9ec9d19439d6ee01 相符 |
| ops-diagnostics.md | 878758bfb5f4db10b4dcb88348fb28e8c59c2ee824416502ad55fa4aa791cabf | 同值 | EQUAL | 878758bfb5f4db10 相符 |
| ops-probe.md | 26d6fc22c29037151c14e06cdde759bf28fab99822cc645e006f7ffc82e1c482 | 同值 | EQUAL | 26d6fc22c2903715 相符 |
| ops-adjudicator.md | b9555c10909a652186e3985fd9a61f7ce3c0a906a8f6f8c8b9f3c158be507f0f | 同值 | EQUAL | b9555c10909a6521 相符 |
| ops-gate1-k1.md | c249300842ddb7a79a7bafb87bc806c62dd6b67110981dd16814aa01583d769e | 同值 | EQUAL | c249300842ddb7a7 相符 |
| ops-gate1-k2.md | beb87c005b7419196582ce6761f4031665d0f0acc091450cd4bdf33fbcfd78c4 | 同值 | EQUAL | beb87c005b741919 相符 |

六件全 EQUAL、前 16 位与预裁决基线逐字相符（拷贝前先行核验宿主侧哈希再拷贝）。

## ② 验证证据（全部真退出码实录）

改前基线（纪律节要求）：

- `sh .githooks/pre-commit; echo exit=$?` → **exit=0**（三项快扫通过；hardcode 命中 0 豁免 36、anchors 0/0 面 11——与简报【5】基线数字全符）

交付后六项：

1. `node scripts/deploy-check.mjs; echo exit=$?`（默认 node=v25.2.1）→
   `[FAIL] node-major——当前 v25.2.1（主版本 25）∈ 受禁系（org-config supported_node.forbid_major）…`，其余 11 项 ok（含六代理 sha256 相符/hook=.githooks/remote=origin），`汇总：ok 11/warn 0/FAIL 1——阻断`，**exit=1**。
   同命令改用 Node 24.21.0（机器惯例受支持系，Volta）→ `汇总：ok 12/warn 0/FAIL 0——可部署`，**exit=0**——简报预期「本机=参考部署态全 ok exit 0」在此口径下兑现（差异归因见自裁申报 1）。
2. `node scripts/deploy-check.mjs --self-test; echo exit=$?` → 16 向量全 PASS（forbid 正/反/缺省、清单派生、漂移三分类、退出码 0/1/1/3、hook 三态、汇总两态），**exit=0**。
3. 负例 `node scripts/deploy-check.mjs --agents-dir <临时空目录>; echo exit=$?`（Node 24）→ 六行 `[FAIL] agents——ops-*.md …缺失（--install 可补）`，`汇总：ok 6/warn 0/FAIL 6——阻断`，**exit=1**。
4. `node scripts/deploy-check.mjs --install --agents-dir <同一临时目录>`（Node 24）→ `[install] install-agents——补齐 6 件（…，逐件 sha256 复核相等）`+`install-hook——core.hooksPath 已设=.githooks（不重复设置）`，复跑七项 `汇总：ok 12/warn 0/FAIL 0——可部署`，**exit=0**；复跑② **exit=0**；复跑③ **exit=0**（六缺失全转 ok）；临时目录用后已删（`ls` 确认 No such file）。
5. `sh .githooks/pre-commit; echo exit=$?` → **exit=0**（hardcode 扫 13 个 .md 命中 0——新增 DEPLOY.md 入扫描面零命中，templates/ 按既有 listMd 规则不入面；anchors 0/0）。
6. `node scripts/check-anchors.mjs; echo exit=$?` → `汇总：WARN ×0 / FAIL ×0（扫描面=11 件）`，**exit=0/0**。

附加复扫（门禁面确认）：`check-hardcode.mjs` exit=0（命中 0，豁免 36/14 规则不变）；`regression.mjs` → `8/8 过，SKIP ×1`，exit=0。

## ③ 自裁申报

1. **① 项验证口径偏离**：本机默认 node=v25.2.1 ∈ forbid_major（[25]），`node scripts/deploy-check.mjs` 真跑=exit 1（node-major FAIL=工具按规格「判据读配置」如实判禁，非缺陷）；简报「期全 ok exit 0」与默认解释器下 ① 项规格在本机互斥。已按机器惯例（SKILL.md 派发节「外部派发一律用 Node 24」；Volta node@24.21.0 实存）补 Node 24 对照跑=全 ok exit 0，两跑实录均呈报，未掩饰任一侧。
2. **② 项「四件」的解释**：简报列三路径（SKILL.md/scripts/roles/registry.json/scripts/org-config.mjs）而称四件；按装载链补第四件=org-config.default.json（org-config.mjs 装载必需、③ 项前置）。REQUIRED_FILES=[SKILL.md, org-config.default.json, scripts/org-config.mjs, scripts/roles/registry.json]。
3. **落点 F 超出一行 open 的部分**：除简报显式要求的新增小节+1 行 open（deploy-hostfacts-split 逐字）外，按本册自身惯例在末节「修订记」追加 2026-09-17 一行（历批次均如此）；小节内补「修订记同步见本册末节 2026-09-17 行」导引一行（仿 evolve 节既有形态）。
4. **--self-test 向量数**：简报要求 ≥4 向量，实落 16 向量（四指定面+hook 值分类+汇总映射加测）；CHANGELOG 机检面节数字初稿误写 15，发现后即正为 16 并复跑 pre-commit（exit=0）。
5. 其余零偏离：--install 仅两动作（补缺失+补未设 hooksPath）实跑验证不覆盖漂移/不动已设钩子；DEPLOY.md 零 live 事实；deploy-check 退出码 3 类（templates/agents 缺失/org-config 装载失败/git 仓判定异常→SelfLoadError→exit 3）已实现，其中 git 判定异常路径未在本机实测（本机为健康 git 仓——不可达分支，纯逻辑覆盖于向量「退出码：自身装载错→3」）。

## 回炉 1（主控亲验 W 级可用性缺口：①项 FAIL 处置指引断链）

- **缺口**：deploy-check ① 项 FAIL 指引只说「改装受支持主版本后复跑」，DEPLOY.md 未写怎么改——新机用户卡死。
- **修订**（仅 DEPLOY.md 步骤 0 Node 描述后追加一段，其余不动；文字=主控回炉指令逐字）：默认 Node 命中受禁系的两条路（Volta `volta pin node@24` 改默认 / `volta run --node 24` 单次——本仓参考态即此形态；或直接改装）+①项 FAIL=如实告警其余六项照查。
- **验证实录**：`node scripts/check-hardcode.mjs --strict; echo exit=$?` → 命中 0（豁免 36/14；扫 13 个 .md），**exit=0**（新句零 live 事实）；`sh .githooks/pre-commit; echo exit=$?` → 三项快扫通过（hardcode 0/anchors 0/0），**exit=0**。
- **回炉自裁申报**：①追加段按主控指令逐字落（指令「」为引用定界不入正文；长句按本文件行宽折行）；②回炉范围外零触碰（deploy-check.mjs/SKILL.md/CHANGELOG/RESIDUALS/templates 均未动）；③回炉单元不另计 units（本批交付面=原 6 单元+回炉 1 轮收口内含）。

MODEL-SELF: model-field:builtin:bigmodel-coding-plan/GLM-5.3
LEDGER-CLAIM: role=ops-executor executor=model-field:builtin:bigmodel-coding-plan/GLM-5.3 units=6 outcome=done
