# 2026-09-17 自我迭代批（v1.7.1 卫生批）实现者报告

- 批次：技能自我迭代批 v1.7.1（卫生批）
- 岗位：ops-executor（model-field:builtin:bigmodel-coding-plan/GLM-5.3）
- 落点：A=scripts/hardcode-whitelist.json（追加 1 条）；B=.githooks/pre-commit（新建）
- git 操作：零（本批全部 git 收口由主控执行，实现者未做任何 git 写操作）

## ① 红证（改前基线，任务书 §4 纪律）

命令（cwd=SKILL_ROOT）：`node scripts/check-hardcode.mjs; echo exit=$?`

```text
[WARN] RESIDUALS.md:94 实配模型名(GLM-5.3) 命中「GLM-5.3」——供应商 live 事实不得写入 .md 正文（06 §0/08 §1）；改指针化（指向 org-config）或登记白名单（scripts/hardcode-whitelist.json）
[WARN] RESIDUALS.md:94 实配模型名(deepseek-flash) 命中「deepseek-flash」——供应商 live 事实不得写入 .md 正文（06 §0/08 §1）；改指针化（指向 org-config）或登记白名单（scripts/hardcode-whitelist.json）
[WARN] RESIDUALS.md:94 实配模型名(k3) 命中「k3」——供应商 live 事实不得写入 .md 正文（06 §0/08 §1）；改指针化（指向 org-config）或登记白名单（scripts/hardcode-whitelist.json）
[info] 白名单豁免 33 处（13 条规则）
check-hardcode 汇总：扫 12 个 .md，命中 3 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
exit=0
```

与任务书 §5 基线数字逐项一致（12 .md／命中 3 @ RESIDUALS.md:94 三处／豁免 33/13）——环境无异常。

锚串核验（落点 A 前置自检）：`grep -n "builtin:bigmodel-coding-plan/GLM-5.3" RESIDUALS.md` → 仅 `94:` 一行命中（grep 计 1，与条目 reason 登记一致）；该行同时含 GLM-5.3/deepseek-flash/k3 三命中，行级豁免一并覆盖。

## ② 绿证（落点 A 完成后复跑同命令）

```text
[info] 白名单豁免 36 处（14 条规则）
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 36；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
exit=0
```

红→绿闭环：命中 3→0；白名单 13→14 条规则、豁免 33→36 处；退出码两态均 0。扫描器自身 JSON.parse 该白名单成功（未触发降级 exit=5 路径）——文件合法性由扫描装载实证。

## ③ 落点 A 最终内容（hardcode-whitelist.json 追加条目，entries 数组末尾）

既有 13 条零改动（仅在原末条后补逗号+追加下条）；缩进两空格与现文件一致：

```json
{ "file": "RESIDUALS.md", "contains": "builtin:bigmodel-coding-plan/GLM-5.3", "reason": "2026-09-17 自我迭代批清偿：RESIDUALS.md:94（evolve-gate2-samesource 行，v1.7 收口尾笔登记）引用实配 model-key 作同源欠账证据——08 §1 判例历史件豁免（08 §3 禁改写原文），行级登记；同行 k3/deepseek-flash/GLM-5.3 三命中一并覆盖；锚串在本文件唯一（grep 计 1）" }
```

## ④ 落点 B 最终内容（.githooks/pre-commit 新建，逐字=任务书 §3 预裁决）

文件形态：UTF-8、LF 行尾（`od -c` 首行实证 `# ! / b i n / s h \n`）、`file` 判型 POSIX shell script。

```sh
#!/bin/sh
# 提交门禁（2026-09-17 自我迭代批 v1.7.1）：把收口扫描中最快的两项挂进提交流，
# 堵「扫描跑在最后一批编辑之前」的流程洞（v1.7 收口尾笔自身引入 3 处 WARN 的根因）。
# 安装（仓库本地配置，不入版本库）：git config core.hooksPath .githooks
# 退出码口径单源=references/06 §5.8：1/3=阻断；5=降级运行（显式留痕不阻断）。
set -u
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
fail=0
for s in check-hardcode check-anchors; do
  out=$(node "scripts/$s.mjs" 2>&1)
  rc=$?
  printf '%s\n' "$out" | tail -n 1
  if [ "$rc" -eq 3 ]; then
    echo "[pre-commit] $s exit=3（配置/装载错）—— 阻断提交"
    fail=1
  elif [ "$rc" -ne 0 ] && [ "$rc" -ne 5 ]; then
    echo "[pre-commit] $s exit=$rc —— 阻断提交"
    fail=1
  fi
done
node scripts/org-config.mjs validate >/dev/null 2>&1 || { echo "[pre-commit] org-config validate 失败 —— 阻断提交"; fail=1; }
[ "$fail" -eq 0 ] && echo "[pre-commit] 三项快扫通过"
exit "$fail"
```

## ⑤ 落点 B 直跑验证（cwd=SKILL_ROOT，本仓库=.git 所在仓库）

命令：`sh .githooks/pre-commit; echo exit=$?`

```text
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 36；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
[pre-commit] 三项快扫通过
exit=0
```

末行「[pre-commit] 三项快扫通过」、exit=0——与任务书 §4 预期一致；check-anchors（WARN×0/FAIL×0，面 11 件）与 org-config validate（PASS，cfg:a26f710a540d，exit=0）均与 §5 基线吻合。

## ⑥ 运行时可观察性（任务书 §7 注记）

钩子可观察形态=安装（`git config core.hooksPath .githooks`，仓库本地配置不入版本库）后的每次 `git commit`：钩子先打印两项扫描的汇总行（各脚本 stdout 末行），再打印「[pre-commit] 三项快扫通过」或逐项「[pre-commit] …—— 阻断提交」行并按 fail 位退出。本批未执行任何 git config/commit（§1 禁令），安装动作留主控收口。

## ⑦ 自裁申报

1. 验证口径一处说明（非实现偏离）：任务书 §4 的直跑命令 `sh "C:/…/.githooks/pre-commit"` 未指定 cwd；实现者 shell 缺省 cwd（E:\zcode_md\fix）不在任何 git 仓库内，首跑在 `git rev-parse --show-toplevel` 处 `fatal: not a git repository` exit=1——此为钩子设计内行为（git 执行钩子时 cwd 必在仓库内）。改以 cwd=SKILL_ROOT（与 §4 前序基线命令同一 cd 口径）直跑，即得上节 ⑤ 全绿输出。两落点文件内容零偏离（逐字=预裁决）。
2. 其余无：既有白名单 13 条零改动；未触碰两落点+本报告之外任何文件；零 git 操作、零网络调用、零子代理、零新依赖。

## ⑧ 回炉 1 轮（主控终审预裁修订——check-hardcode 升 strict，堵 WARN 级漏网）

背景：原钩子只阻断 FAIL 级（exit 1/3），而本批要堵的 v1.7 腐化形态正是 check-hardcode 的 WARN 级命中（收口尾笔 3 处 WARN 即此漏网）。预裁修订：check-hardcode 调用改带 `--strict`（WARN 命中→exit 1→阻断；逃生口=登记白名单/指针化，显式可审计）；check-anchors 维持原样（WARN 试点校准期，仅 FAIL 阻断）。仅此一处+头注补行，其余逐字不动。

修订 1（头注，原头注第 1 行后补）：
`# check-hardcode 按 --strict 跑（WARN 命中即阻断——收口零命中纪律的提交面执法；逃生口=登记白名单）`

修订 2（循环体）：
```sh
  if [ "$s" = "check-hardcode" ]; then
    out=$(node "scripts/$s.mjs" --strict 2>&1)
  else
    out=$(node "scripts/$s.mjs" 2>&1)
  fi
  rc=$?
```

回炉实录 1（strict 绿证，cwd=SKILL_ROOT）`sh .githooks/pre-commit; echo exit=$?`：
```text
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 36；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
[pre-commit] 三项快扫通过
exit=0
```

回炉实录 2（变异红证，文件备份法、零 git）：`cp RESIDUALS.md ../RESIDUALS.md.mutbak`（技能根上级=扫描根之外）→ `printf '%s\n' 'mutation-probe: 通道走 glm5.3flash 直连' >> RESIDUALS.md`（glm5.3flash=词表紧邻变体，绕过朴素大小写匹配）→ 复跑钩子：
```text
check-hardcode 汇总：扫 12 个 .md，命中 1 处（白名单豁免 36；词表=org-config 0 条+宿主注册表 4 条）——strict：按 RED 处置，不得收口
[pre-commit] check-hardcode exit=1 —— 阻断提交
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
exit=1
```
还原核销：`cp ../RESIDUALS.md.mutbak RESIDUALS.md` → `diff RESIDUALS.md ../RESIDUALS.md.mutbak` 输出空（diff-exit=0）→ `rm ../RESIDUALS.md.mutbak`（rm-exit=0）→ 终态复跑钩子三项快扫通过 exit=0。红→绿→还原三态实录齐备。

回炉自裁申报：
1. 「头注第 1 行后」判读：头注块首行=「# 提交门禁（2026-09-17…）」行，补行插于其后（shebang 非注，不作为头注计行）。除此外两处修订逐字=预裁；落点 A 及钩子其余内容零改动。
2. 其余无：变异测试全程未触碰 .git、未用 git 还原；备份件置于扫描根外且已核销。

## ⑨ 回炉 2 轮（门审 W 项 Minor：rc=5 降级留痕在钩子面可见化）

背景：钩子对 rc=5（降级运行）放行正确，但 `[degraded]` 留痕走 stderr 且被 `tail -n 1` 截掉——「显式留痕不阻断」在钩子输出面不可见，输出与行为矛盾。修订仅改循环内回显段（阻断逻辑与退出码零变化），逐字=主控预裁：

```sh
  if [ "$rc" -eq 5 ]; then
    printf '%s\n' "$out" | grep '\[degraded\]' || echo "[pre-commit] $s exit=5（降级运行——扫描面部分不可用，留痕如上）"
  else
    printf '%s\n' "$out" | tail -n 1
  fi
```

前置核实（check-hardcode.mjs:208）：`process.exit(strict && effective.length ? (DEGRADED ? 5 : 1) : DEGRADED ? 5 : 0)`——降级信号优先于 strict 命中（终审 W4：勿让 1 吞 5），故坏白名单+strict 下 exit=5 放行路径成立。

回炉 2 实录 1（净空态）`sh .githooks/pre-commit; echo exit=$?`：
```text
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 36；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
[pre-commit] 三项快扫通过
exit=0
```

回炉 2 实录 2（降级态红证，文件备份法、零 git）：`cp scripts/hardcode-whitelist.json ../hardcode-whitelist.json.mutbak` → `printf '{ 坏\n' > scripts/hardcode-whitelist.json` → 跑钩子：
```text
[degraded] 白名单件不可读（Expected property name or '}' in JSON at position 2 (line 1 column 3)）——按零豁免执行（可能假 WARN），退出码 5
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
[pre-commit] 三项快扫通过
exit=0
```
`[degraded]` 留痕行经新回显段 grep 显式可见（修订前该行走 stderr 且被 tail 截除）；rc=5 放行不阻断（无「阻断提交」行），行为=「显式留痕不阻断」与输出一致。还原核销：`cp ../hardcode-whitelist.json.mutbak scripts/hardcode-whitelist.json` → `diff` 输出空（diff-exit=0）→ `rm ../hardcode-whitelist.json.mutbak`（rm-exit=0）→ 终态复跑钩子「三项快扫通过」exit=0。

回炉 2 自裁申报：
1. 无。回显段修订逐字=预裁；阻断逻辑（rc=1/3 判定与 fail 位）与退出码零变化；白名单件还原后 diff 验空，备份置于扫描根外且已核销；全程零 git、零网络。

MODEL-SELF: model-field:builtin:bigmodel-coding-plan/GLM-5.3
LEDGER-CLAIM: role=ops-executor executor=model-field:builtin:bigmodel-coding-plan/GLM-5.3 units=2 outcome=done
