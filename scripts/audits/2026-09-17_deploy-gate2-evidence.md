# 2026-09-17 v1.7.3 部署能力批——门二实证（ops-probe 独立重跑）

- 执行者：ops-probe（独立会话；model-field:builtin:bigmodel-coding-plan/GLM-5.3）
- 环境实录：win32 10.0.26200 x64 / Git Bash；node v25.2.1（默认）；volta 2.0.2；起 2026-09-17T00:43:41Z，讫 00:49:17Z（全部 UTC）。
- 方法：每条命令亲跑，exit 码为真值；除临时目录与 M6 的 git config 一设一还原外未改任何仓库/宿主文件（终态复核见 §M6/§收尾）。
- 进度：M1-M8 全部完成。

## M1 拷贝字节级（sha256 六对逐一）

命令（cwd=技能根）：

```bash
for f in ops-adjudicator ops-diagnostics ops-executor ops-gate1-k1 ops-gate1-k2 ops-probe; do
  a=$(sha256sum "templates/agents/$f.md" | cut -d' ' -f1)
  b=$(sha256sum "C:/Users/Administrator/.zcode/agents/$f.md" | cut -d' ' -f1)
  [ "$a" = "$b" ] && v=EQUAL || v=DIFFER
  echo "$f.md template=$a deployed=$b result=$v"
done
```

exit=0。结果（六对全 EQUAL）：

| 文件 | template sha256 | deployed sha256 | 相等性 |
|---|---|---|---|
| ops-adjudicator.md | b9555c10909a652186e3985fd9a61f7ce3c0a906a8f6f8c8b9f3c158be507f0f | b9555c10909a652186e3985fd9a61f7ce3c0a906a8f6f8c8b9f3c158be507f0f | EQUAL |
| ops-diagnostics.md | 878758bfb5f4db10b4dcb88348fb28e8c59c2ee824416502ad55fa4aa791cabf | 878758bfb5f4db10b4dcb88348fb28e8c59c2ee824416502ad55fa4aa791cabf | EQUAL |
| ops-executor.md | 9ec9d19439d6ee01d2209143241e004b746407a428fdc876f401757649876be8 | 9ec9d19439d6ee01d2209143241e004b746407a428fdc876f401757649876be8 | EQUAL |
| ops-gate1-k1.md | c249300842ddb7a79a7bafb87bc806c62dd6b67110981dd16814aa01583d769e | c249300842ddb7a79a7bafb87bc806c62dd6b67110981dd16814aa01583d769e | EQUAL |
| ops-gate1-k2.md | beb87c005b7419196582ce6761f4031665d0f0acc091450cd4bdf33fbcfd78c4 | beb87c005b7419196582ce6761f4031665d0f0acc091450cd4bdf33fbcfd78c4 | EQUAL |
| ops-probe.md | 26d6fc22c29037151c14e06cdde759bf28fab99822cc645e006f7ffc82e1c482 | 26d6fc22c29037151c14e06cdde759bf28fab99822cc645e006f7ffc82e1c482 | EQUAL |

判定：PASS（6/6 EQUAL）。

## M2 参考态（volta node 24.21.0）

命令（cwd=技能根）：`volta run --node 24.21.0 node scripts/deploy-check.mjs` → exit=0。关键输出：

```
[ok] node-major——v24.21.0（主版本 24）不在受禁系
[ok] skill-files——必备 4 件齐（SKILL.md、org-config.default.json、scripts/org-config.mjs、scripts/roles/registry.json）
[ok] org-config——validate 通过（validate PASS（3 源双校验通过，cfg:a26f710a540d））
[ok] agents——ops-adjudicator.md（C:\Users\Administrator\.zcode\agents）sha256 相符
[ok] agents——ops-diagnostics.md / ops-executor.md / ops-gate1-k1.md / ops-gate1-k2.md / ops-probe.md（各一行，均 sha256 相符）
[ok] hook——core.hooksPath=.githooks（提交门禁已挂）
[ok] remote——已挂（origin）
[ok] ledger-dir——SKILL_ROOT/.zcode/ 可写（账本目录就绪）
deploy-check 汇总：ok 12/warn 0/FAIL 0——可部署
```

判定：PASS（exit 0；ok12/warn0/FAIL0）。

## M3 受禁系如实告警（默认 node v25.2.1）

命令（cwd=技能根）：`node scripts/deploy-check.mjs` → exit=1。关键输出：

```
[FAIL] node-major——当前 v25.2.1（主版本 25）∈ 受禁系（org-config supported_node.forbid_major）——改装受支持主版本后复跑
[ok] skill-files / org-config / agents×6 / hook / remote / ledger-dir（七类照常输出，均 [ok]，行文同 M2）
deploy-check 汇总：ok 11/warn 0/FAIL 1——阻断
```

判定：PASS（exit 1；唯一 FAIL=node-major，其余六项照常输出）。

## M4 自检

命令（cwd=技能根）：`node scripts/deploy-check.mjs --self-test` → exit=0。关键输出：16 条 PASS（forbid 正/反例、forbid 配置缺省、清单派生、漂移三分类 missing/drift/equal、退出码四则 0/1/self-test/3、hook 三值、汇总计数与 warn 不阻断两则），末行 `self-test 全过（16 向量）`。
判定：PASS（exit 0；向量数=16）。

## M5 负例→安装→复绿→漂移保护（临时目录法）

T=`mktemp -d` = /tmp/tmp.pJmpVQ1a7x（= C:/Users/ADMINI~1/AppData/Local/Temp/tmp.pJmpVQ1a7x），初始为空。所有 --install 均带 --agents-dir $T（真实 ~/.zcode/agents 未被触碰——M1 六哈希在 M5 全程前后可比对）。

### 5a 负例（空目录）

- `node scripts/deploy-check.mjs --agents-dir $T`（默认 node v25.2.1）→ exit=1。agents 六行全 `[FAIL] agents——ops-*.md（…）缺失（--install 可补：templates/agents/ 单源复制）`；汇总 `ok 5/warn 0/FAIL 7——阻断`（FAIL 7 = agents 6 + node-major 1）。
- node 24 对照：`volta run --node 24.21.0 node scripts/deploy-check.mjs --agents-dir $T` → agents 六 FAIL、汇总 `ok 6/warn 0/FAIL 6——阻断`；**shell exit=126（复跑 2 次稳定）——异常 A1（volta 非零退出码变形），脚本本体判定语义正确**。
- 判定：PASS（六缺失全 FAIL；默认 node 形态 exit=1 成立）。

### 5b 安装（--install）

- 默认 node v25.2.1：`node scripts/deploy-check.mjs --install --agents-dir $T` → exit=1（简报预告形态：①node-major 本就红）。实录：`[install] 首装模式——仅补缺失代理件与未设 hooksPath（不覆盖漂移件/不改 org-config/宿主配置）`；`[install] install-agents——补齐 6 件（ops-adjudicator.md、ops-diagnostics.md、ops-executor.md、ops-gate1-k1.md、ops-gate1-k2.md、ops-probe.md，逐件 sha256 复核相等）`；`[install] install-hook——core.hooksPath 已设=.githooks（不重复设置…）`；随后七项复跑：agents 六行全 `[ok] … sha256 相符`、无 agents FAIL、唯一红=①node-major；汇总 `ok 11/warn 0/FAIL 1——阻断`。判据（agents 行全 [ok] 且无 agents FAIL）=满足；$T 下实存 6 件。
- node 24.21.0 对照：`volta run --node 24.21.0 node scripts/deploy-check.mjs --install --agents-dir $T` → exit=0，汇总 `ok 12/warn 0/FAIL 0——可部署`。
- 判定：PASS（两形态均如实；安装+复绿成立）。

### 5c 复跑（复绿确认）

- node 24：`--agents-dir $T` → exit=0，`ok 12/warn 0/FAIL 0——可部署`。
- 默认 node 25：`--agents-dir $T` → 脚本 exit=1（重定向取真值，规避管道掩码）、agents 六行全 [ok]、汇总 `ok 11/warn 0/FAIL 1——阻断`。
- 判定：PASS（复绿；两形态均录）。

### 5d 漂移保护

- `echo "deploy-gate2-drift-marker-2026-09-17" >> $T/ops-probe.md`；追加后 sha256=48815b663e1180daa75e7986ce80b9e4d02af0df603c8e000e4db2947375f97d；marker grep 计数=1。
- `volta run --node 24.21.0 node scripts/deploy-check.mjs --install --agents-dir $T` → exit=0。关键输出：

```
[install] install-agents——无缺失件（已存在漂移件不覆盖——保护本机定制）
[warn] agents——ops-probe.md（…）存在但 sha256 漂移（人工比对；--install 不覆盖——保护本机定制）
deploy-check 汇总：ok 11/warn 1/FAIL 0——处置后复跑
```

- 复核：$T/ops-probe.md 安装后 sha256 仍=48815b66…（与追加后一致=未被覆盖）；marker 行 grep 计数仍=1；该项 [warn] 且整体 exit 0（warn 不阻断）。
- 判定：PASS。
- 清理：`rm -rf $T` 后 `ls -d $T` → No such file or directory（已除）。

## M6 钩子项变异（git config 一设一还原）

- 基线：`git config core.hooksPath` = `.githooks`（变动前实录）。
- 设：`git config core.hooksPath bogus-deploy-probe`（SET_EXIT=0，读回=bogus-deploy-probe）→ `volta run --node 24.21.0 node scripts/deploy-check.mjs` → exit=0，关键行：

```
[warn] hook——core.hooksPath=bogus-deploy-probe（用户自定义，不改只提示命令：git config core.hooksPath .githooks）
deploy-check 汇总：ok 11/warn 1/FAIL 0——处置后复跑
```

- 还原：`git config core.hooksPath .githooks`（RESTORE_EXIT=0）→ 同命令复跑 → exit=0，`[ok] hook——core.hooksPath=.githooks（提交门禁已挂）`，汇总 `ok 12/warn 0/FAIL 0——可部署`。
- 终值复核：`git config core.hooksPath` → `.githooks`（收尾 00:49:17Z 再复核一次仍=.githooks）。
- 判定：PASS（设→[warn]+exit0；还原→[ok]；终值=.githooks）。

## M7 门禁不回归（cwd=技能根）

| 命令 | exit | 关键输出 |
|---|---|---|
| `sh .githooks/pre-commit` | 0 | `check-hardcode 汇总：扫 13 个 .md，命中 0 处（白名单豁免 36…）`；`check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）`；`[pre-commit] 三项快扫通过` |
| `node scripts/check-anchors.mjs` | 0 | `check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）`（=0/0） |
| `node scripts/regression.mjs --only R7` | 0 | `PASS R7 账本 schema 指针唯一指向 02 §9 SKILL.md:✓ org-seg.snippet:✓` + `regression 汇总：1/1 过（项=R7）` |
| `node scripts/check-hardcode.mjs --strict` | 0 | `[info] 白名单豁免 36 处（14 条规则）`；`扫 13 个 .md，命中 0 处` |

判定：PASS（4/4；--strict 下命中 0，扫描面 13 件含 DEPLOY.md——见 M8）。

## M8 DEPLOY.md 终态

- 在位：`ls DEPLOY.md` exit=0（技能根）。
- 受禁系处置段（两条路）实录（DEPLOY.md L13-16）：

```
默认 Node 命中受禁系时的两条路（本机实证形态）：①版本管理器——Volta 系统
可 `volta pin node@24`（改默认）或单次
`volta run --node 24 node scripts/deploy-check.mjs`（本仓参考态即此形态）；
②直接改装受支持主版本。禁用系下 deploy-check ①项=FAIL 属如实告警（已知
退出崩溃面），其余六项照常检查。
```

- 受禁词扫描：`grep -cE "GLM|Kimi|k3|deepseek|bigmodel" DEPLOY.md` → 输出 `0`（grep exit=1=无匹配）。
- 判定：PASS（处置段两条路齐；命中 0）。

## 异常清单

- A1【环境/工具面，非被测脚本缺陷】volta 2.0.2（win32/Git Bash）非零退出码变形：`volta run --node 24.21.0 node -e "process.exit(1)"` → shell exit=126；exit(2)→126；exit(0)→0。证据：一次性 node -e 三连实测。影响面：凡经 `volta run` 的"exit 1"在 shell 面呈 126（M5a 对照复现 2 次）。脚本自身判定（汇总行/阻断措辞/FAIL 计数）不受影响；矩阵所有预期 exit 1 的项均另有默认 node 直跑形态实测=1（M3、5a、5b、5c）。初分类：volta-on-Windows 退出码传递缺陷，建议裁决部知悉（DEPLOY.md 两条路之 volta 路径在 CI/脚本消费退出码时需注意）。未自行修复。
- A2【记录性注记，非异常】M5b 默认 node 25 下 `--install` 整体 exit=1 而非 0：与简报预告语义完全一致（①node-major 恒红，安装动作本身完成且 agents 项全 [ok]）；node 24 对照形态 exit=0。不构成偏差。
- A3【记录性注记】收尾 `git status --short` 显示 M CHANGELOG.md / RESIDUALS.md / SKILL.md、?? DEPLOY.md、?? scripts/deploy-check.mjs、?? templates/agents/ 等——均为本部署批实现方的待提交变更（先于本实证存在），非本岗改动；本岗在仓库内的唯一写入=本证据文件。

## 矩阵汇总

| 项 | 判定 | 注 |
|---|---|---|
| M1 拷贝字节级 | PASS | 6/6 EQUAL |
| M2 参考态 volta node24 | PASS | exit 0；ok12/warn0/FAIL0 |
| M3 受禁系告警 node25 | PASS | exit 1；唯一 FAIL=node-major；余六项照常 |
| M4 自检 | PASS | exit 0；16 向量全过 |
| M5 负例→安装→复绿→漂移 | PASS | 四子步全符判据；A1/A2 注记 |
| M6 钩子变异 | PASS | bogus→[warn]+exit0；还原→[ok]；终值=.githooks |
| M7 门禁不回归 | PASS | 4/4（pre-commit/anchors 0-0/R7 PASS/hardcode --strict 0 命中） |
| M8 DEPLOY.md 终态 | PASS | 两条路段在位；受禁词命中 0 |

总计：8/8 PASS；异常 1 项（A1，volta 工具面，非脚本缺陷）+ 2 项记录性注记。终裁归裁决部。

## 证据文件指针

- 本实录：C:/Users/Administrator/.zcode/skills/ai-dev-org/scripts/audits/2026-09-17_deploy-gate2-evidence.md
- 被测脚本：C:/Users/Administrator/.zcode/skills/ai-dev-org/scripts/deploy-check.mjs
- 部署对照面：C:/Users/Administrator/.zcode/agents/ops-*.md（六件）↔ templates/agents/ops-*.md
- 过程中间物：/tmp/m5_rerun.out、/tmp/m5_n25_rerun.out、/tmp/m6_restore.out、/tmp/m7_precommit.out（Git Bash /tmp，会话性临时文件）
