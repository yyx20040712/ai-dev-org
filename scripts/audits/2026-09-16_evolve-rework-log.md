# 回炉轮真退出码实录（evolve-rework r1/r2，2026-09-16）

执行岗=ops-executor（原 evolve 批实现者续命，02 §5）。本档只落真实命令+真退出码。
报告=同目录 2026-09-16_evolve-rework-report.md。回炉简报门一出件=B1/W1/W2/W3/N1-N4+主控移交。

## 0. 基线门禁（开工体检，改前）

```
$ node scripts/regression.mjs
PASS R2a … PASS R2b … PASS R5 … PASS R4 … PASS R7 … PASS R8 … PASS R9 … PASS R10（①/③/② 各面全过）
SKIP R1 未给 --r1——真实派发配给保护
regression 汇总：8/8 过，SKIP ×1（未跑项不计入通过数）
exit=0

$ node scripts/check-hardcode.mjs
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）
exit=0

$ node scripts/check-anchors.mjs
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
exit=0

$ node scripts/health-scan.mjs --project .
health-scan 汇总：RED ×0 / WARN ×2（…账本行 76/流水行 1132/窗口 20…）——可收口
exit=0
```

## 1. B1 红态（R10 ④ 向量先落，ds-call-v2 未修）

向量=regression.mjs R10 新增 ④（坏 registry JSON / roles:null 两形态，注入形态=
备份-注入-跑-还原 try/finally；脚本注入窗后 git status scripts/roles/registry.json
=空，还原核验过）。

```
$ node scripts/regression.mjs --only R10
FAIL R10 …④B1向量(registry错误面):✗ 坏JSON→exit=1(期3)/[fatal]=true；roles:null→exit=1(期3)/[fatal]=true
regression 汇总：0/1 过，FAIL ×1（项=R10）
exit=1
```

红态坐实：现行 cliMain 顶层裸 readJson 与 loadRole 裸取 registry.roles[roleId]
在坏形态下均落 uncaughtException→classifyExitCode 无 exitCode 属性=exit 1
（06 §5.8 配置/装载错应=3）。

## 2. B1 转绿（ds-call-v2.mjs 两处修后）

修改点：①cliMain 顶层 `readJson(REGISTRY_PATH)` 包 ConfigError（与 loadRole
内包装同型）；②loadRole 增 registry.roles null/非对象前置校验（ConfigError）。

```
$ node scripts/regression.mjs --only R10
PASS R10 …④B1向量(registry错误面):全过 坏JSON→exit=3(期3)/[fatal]=true；roles:null→exit=3(期3)/[fatal]=true
regression 汇总：1/1 过（项=R10）
exit=0
```

## 3. 变异红证（B1，1 例）

变异=临时撤 cliMain 顶层包装（还原裸 `const registry = readJson(REGISTRY_PATH)`，
证毕还原）：

```
$ node scripts/regression.mjs --only R10
FAIL R10 …④B1向量(registry错误面):✗ 坏JSON→exit=1(期3)/[fatal]=true；roles:null→exit=3(期3)/[fatal]=true
regression 汇总：0/1 过，FAIL ×1（项=R10）
exit=1
```

判读：坏 JSON 向量随撤包翻红（1≠3）而 roles:null 向量保持 3（其守卫在
loadRole，独立于被撤的 cliMain 包装）——证 ④ 向量确实钉住 cliMain 装载点，
非恒真断言。证毕还原后复跑=第 2 节绿态。

## 4. W2（glm-look chCfg 兜底恢复）与 r1 时点全量门禁

```
$ node scripts/glm-look.mjs --list-sources
== channel=glm（glm-look）== … == channel=ds（ds-look）== …（源发现正常）
exit=0

$ node scripts/regression.mjs
regression 汇总：8/8 过，SKIP ×1（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）
exit=0

$ node scripts/check-hardcode.mjs   → 命中 0（豁免 33），exit=0
$ node scripts/check-anchors.mjs    → WARN ×0 / FAIL ×0，exit=0
$ node scripts/health-scan.mjs --project .  → RED ×0 / WARN ×2，exit=0
```

## 5. r1 commit

```
0c6384b fix(evolve-rework-r1): B1+W2 代码面
（scripts/ds-call-v2.mjs + scripts/glm-look.mjs + scripts/regression.mjs，41+/2-）
```

## 6. r2 面（W3/N1/N3/移交/W1/N2/N4）验证实录

```
$ node scripts/check-hardcode.mjs --self-test
check-hardcode 自检：19/19 过
exit=0
（N3 核验：修复后自检运行 Temp/hc-b4-* 计数 4→4 不增——现存 4 个系修前
 23:22-23:23 遗留（修复合集），本修复后零新增零残留；旧目录属 OS temp 区
 不在技能根白名单内，未清理，见报告自裁申报）

$ node scripts/log-triage.mjs --date foo
[usage] --date 非法值「foo」——…（一行 stderr）
exit=1                          # N1：process.exitCode=1+return 自然退出形态，实测仍 exit 1

$ node scripts/log-triage.mjs --self-test
self-test 全过（含 b3/b4 向量与验收断言）
exit=0

$ node scripts/log-triage.mjs --date 2026-09-16 --health
== 源健康检查（窗口=2026-09-16，cfg:a26f710a540d）== …
exit=0                          # 主流程 run() 包装后正常路径无回归

# W3 机检（C1 两式，改后应=0）：
$ grep -rnE "退出码.*：.*[0-9]+=" scripts/*.mjs   → 0 命中（exit=1）
$ grep -rn "退出码[：:].*[0-9]=" scripts/*.mjs    → 0 命中（exit=1）

# 移交项核验：
$ grep -rn "06 §8.6" scripts/health-scan.mjs     → 0 命中（:10/:104 均已改 02 §8.6）

# W1 计数核验：
$ grep -c "九笔 commit" CHANGELOG.md SKILL.md    → CHANGELOG 2（v1.7 正文+v1.6 既有条）/SKILL 1
$ grep -c "七笔 commit" CHANGELOG.md SKILL.md    → CHANGELOG 1（勘误注记内引述笔误原文）/SKILL 0
```

## 7. 终态门禁（r2 时点，全量复跑）

```
$ node scripts/regression.mjs
PASS R2a/R2b/R5/R4/R7/R8/R9/R10（④B1向量:全过 坏JSON→exit=3/roles:null→exit=3）
SKIP R1（未给 --r1——配给保护）
regression 汇总：8/8 过，SKIP ×1
exit=0

$ node scripts/check-hardcode.mjs
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）
exit=0

$ node scripts/check-anchors.mjs
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
exit=0

$ node scripts/health-scan.mjs --project .
health-scan 汇总：RED ×0 / WARN ×2（…账本行 76/流水行 1162/窗口 20…）——可收口
exit=0
```


