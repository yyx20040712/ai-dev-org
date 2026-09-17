# g3 批门二实证矩阵（ops-probe——机械重跑面，独立复算，禁判断性定性）

> 技能根=C:\Users\Administrator\.zcode\skills\ai-dev-org。逐项真跑，`命令；echo exit=$?`
> 实录；结论只报事实（退出码/输出行/文件在否），禁推测定性。证据全文落：
> scripts/audits/2026-09-17_g3-gate2-evidence.md（含矩阵逐项命令+输出原文）。

## 矩阵（8 项）

1. **自检三件**：`node scripts/org-config.mjs --self-test`（预期含「全过」+向量数）；
   `node scripts/deploy-check.mjs --self-test`（同上）；`node scripts/log-triage.mjs --self-test`。
2. **回归与扫描四件**：`node scripts/regression.mjs`（记汇总行+R8 行原文）；
   `node scripts/check-anchors.mjs`；`node scripts/check-hardcode.mjs`；
   `node scripts/health-scan.mjs`（记 RED/WARN 计数行）。
3. **用法错五路**（b1 行为面）：分别跑并记退出码+末行——
   `node scripts/deploy-check.mjs --agents-dir`；
   `node scripts/org-config.mjs --project`；
   `node scripts/regression.mjs --only R8 --only R9`；
   `node scripts/log-triage.mjs --date`；
   `node scripts/ds-call-v2.mjs --role gate1-reviewer --dry-run --mock-source`。
4. **变异红证抽钉（C3——证明测试在测）**：文件备份法（cp 存 .bak）注释
   org-config.mjs cliFlag 重复检测 throw 行 → `node scripts/org-config.mjs
   --self-test` 应 exit 1 且 FAIL 行含「≥2 次」→ 还原（mv .bak 回）→ 复跑
   exit 0。diff 确认还原为空（git diff scripts/org-config.mjs 与矩阵前快照一致
   ——用 `git stash list`/`git diff --stat` 自选最简法证明零残留）。
5. **R2 坏覆盖件真机注入**：确认 `.zcode/org-config.json` 不存在（在则停该项
   报 BLOCKED）→ `printf '{ 坏' > .zcode/org-config.json` →
   `node scripts/deploy-check.mjs --install`（记 install-hostfacts 行+末行+退出码）
   → `node scripts/deploy-check.mjs`（记 [装载错] 行+退出码）→
   `rm .zcode/org-config.json` → `ls .zcode/` 确认还原。
6. **b2 本机形态**：`node scripts/deploy-check.mjs --install` 完整输出的
   install-hostfacts 行（预期「宿主事实与默认件一致——无需覆盖件」）+
   `.zcode/org-config.json` 仍不存在 + org-config ③项 validate ok 行。
7. **b3 指针抽核**：从 references/00-glossary.md 任取 5 条「NN §M」指针，
   逐条打开目标文件核该章节标题存在（贴目标行原文）；另记 SKILL.md:89 行原文。
8. **白名单对账**：`git status --porcelain`（预期=7 改+references/00-glossary.md
   +scripts/audits/ 下本批档件，无其他）。

## 产出契约

证据文件八节逐项（命令+exit+N 行输出原文）；末两行机读尾栏：
MODEL-SELF: ops-probe bound
FINDINGS: 项数=8 异常=<数>
回复主控五行内（矩阵 8 项通过数+异常项号+证据路径）。
