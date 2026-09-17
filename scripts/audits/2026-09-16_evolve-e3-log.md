# evolve-E3 真退出码实录（b8+b9）——2026-09-16

## 0. 开工基线核对（HEAD=67a60e1，承 E2 终态）

```
67a60e1 fix(evolve-b7): check-anchors 扩面 NN·XN 条目型引用+文档号两位数——①§引用正则 0([1-9]) 改 (?<![\d-])([01]\d|\d)(?!\d)（支持 10+ 号文档与单数字去前导零形态；前后禁数字/连字符邻接防日期串误配；前置普查=扫描面单数字/10+ 形态命中 0=零新误伤）；②新增 ①b 条目型断锚扫描：NN·XN 形（文档号+·+大写条目组 1-4 字母可带 -数字，如 01·E2/04·SY-1/04·ORG-11；小写版本串 06·v1.1 天然不命中；「」叙述跳过延续；K3 等无文档号前缀编号短语不命中）→登记表存在性，登记表仅从 01（^### X N 标记）与 04（表行 | XN-n | 标记）正文解析（P-3 裁决：不从 golden 反推），断锚=WARN 试点口径不变；③P-4 终裁改指：references/01-org-principles.md:157 断锚 02·C2→01·C2（C2 系 01 条目，01:96 同事件实录锚点，改指保审计链）；④--self-test 强化 4→16 向量（原 head 断言对自建 Set 恒真=在册盲点：改真实文件解析三向量——实测引出真发现 06 无 §8.6（8.6 系 02 章节）——+两位/单数字文档号解析+条目登记表实析+正例 01·E2/04·SY-1+合成负例 02·C2→WARN（裁决 C3 要求自检保留）+P-4 改指目标存在向量+免误伤两例+「」跳过+两位条目形）。扩面主扫唯一新 WARN=01:157（与全库普查预判一致零误报），P-4 改指后 WARN×0/FAIL×0。红→绿→变异红证（登记表缺失文档误判合法→合成负例+两位条目两向量翻红；活库已修净只能靠自检捕捉=C3 正当性实证）真退出码实录落 scripts/audits/2026-09-16_evolve-e2-log.md。终态门禁全绿：regression 8/8（R1 SKIP）+hardcode 0+anchors 0/0+health RED0/WARN2
---
SKIP R1 未给 --r1——真实派发配给保护，~9k Kimi tokens；冻结裁决前须跑或显式登记欠账（SKIP 不计入通过数——ds-W6）

regression 汇总：8/8 过，SKIP ×1（未跑项不计入通过数）（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）
exit=0
[info] 白名单豁免 33 处（13 条规则）
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
exit=0
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
exit=0
[info] 用量 kimi-backup：2 次 ok，累计 in=9,345 out=21,143
[info] 用量 builtin:bigmodel-coding-plan：4 次 ok，累计 in=343,911 out=16,939
health-scan 汇总：RED ×0 / WARN ×2（WARN 不阻断但须回显计数，累计出现即按升格条件处置，W-1）（账本行 76/流水行 1072/窗口 20/审计岗 drafter,gate1-reviewer,auditor-readonly）——可收口
exit=0
```

## 1. 文档批 TDD 红态（改前 grep 断言——机检先行）

### C4 红：活文档面「固定六段」命中（应=空，现为红）

```
$ grep -rn "固定六段" references/ SKILL.md templates/
references/\02-pipeline-templates.md:70:固定六段，缺一段=任务书不合格【SY 试点实证：模板偏差=回炉主要来源】。
exit=（非空=红态实锤）

$ grep -c "固定七段" references/02-pipeline-templates.md
0
exit=1
```
（grep -c 输出 0=改前无「固定七段」；exit=1 系计数 0 所致）

### C1 红：脚本头注「退出码：数字=语义」复写块（应=空，现为红）

```
$ grep -rn "退出码[：:].*[0-9]=" scripts/*.mjs
scripts/check-anchors.mjs:15:// 退出码：0=通过（可有 WARN，回显计数）；1=计数 FAIL 或自检 FAIL；3=配置错（golden 缺失）。
scripts/org-config.mjs:7: * 退出码：0=成功；1=用法错误/自检失败；3=配置校验失败（区别于派发器源尽 exhaust=2）。总表=references/06 §5.8。
scripts/check-hardcode.mjs:21: * 退出码：0=无命中/WARN；1=--strict 命中或自检失败；3=配置错；5=降级运行（宿主配置/白名单损坏——显式留痕不静默；总表=references/06 §5.8）。
scripts/health-scan.mjs:15: * 退出码：0=无 RED；1=有 RED 或自检失败；3=配置错。总表=references/06 §5.8。
scripts/ds-call-v2.mjs:14: *  - 退出码：3=配置级错误（uuid/name 校验、registry↔org-config 角色交叉失败、
scripts/regression.mjs:14: * 退出码：0=所选回归项全过；1=任一 FAIL（含 R2b 派发器装载路异常
scripts/skill-gc.mjs:20: * 退出码：0=正常；1=参数误用或归档事务失败；2=--apply 未指定删除类。
scripts/log-triage.mjs:18: * 退出码：0=正常；1=发现 RED 级事项（静默回退检出）或自检断言失败（全 fixture 聚合——v1.6 批）
exit=0（9 命中=红态实锤）
```

（补：上式 8 命中漏 init-defenses 括注形态，换宽式正则重跑红态）

```
$ grep -rnE "退出码.*：.*[0-9]+=" scripts/*.mjs | wc -l
9
exit=0
$ grep -nE "退出码.*：.*[0-9]+=" scripts/init-defenses.mjs
8: * 退出码（同技能约定 3-2-1-4 的本地件子集）：3=配置错误（目标不存在/
exit=0（宽式=9 块红态实锤，即九件头注全集）
```

## 2. b8 改后绿态（C1/C4 机检）

```
$ grep -rn "固定六段" references/ SKILL.md templates/
exit=1（空输出+exit 1=绿）

$ grep -c "固定七段" references/02-pipeline-templates.md
1
exit=0（1=单源句命中）

$ grep -rnE "退出码.*：.*[0-9]+=" scripts/*.mjs
exit=1（空输出+exit 1=九件复写块清零）

$ grep -rn "三类告警" references/ SKILL.md templates/ scripts/*.mjs
exit=1（空=告警计数族清零）
```

## 3. 变异红证（临时回退 02 §4 单源句一处——C4 断言须翻红）

```
$ grep -rn "固定六段" references/ SKILL.md templates/
references/\02-pipeline-templates.md:70:固定六段（1-6 段惯称「六段简报」），缺一段=任务书不合格【SY 试点实证：
exit=0（1 命中=变异被断言抓住=红证成立）
```

（变异红证 2：skill-gc 头注临时回退复写行——C1 断言须翻红）

```
$ grep -rnE "退出码.*：.*[0-9]+=" scripts/skill-gc.mjs
scripts/skill-gc.mjs:22: * 退出码：0=正常；1=参数误用或归档事务失败；2=--apply 未指定删除类。
exit=0（复写块被抓=红证成立）
```

## 4. b8 终态全量门禁（变异还原后）

```
$ node scripts/regression.mjs
SKIP R1 未给 --r1——真实派发配给保护，~9k Kimi tokens；冻结裁决前须跑或显式登记欠账（SKIP 不计入通过数——ds-W6）

regression 汇总：8/8 过，SKIP ×1（未跑项不计入通过数）（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）
exit=0

$ node scripts/check-hardcode.mjs
[info] 白名单豁免 33 处（13 条规则）
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
exit=0

$ node scripts/check-anchors.mjs
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
exit=0

$ node scripts/check-anchors.mjs --self-test
[self-test] 16/16 过
exit=0

$ node scripts/health-scan.mjs --project .
[info] 用量 builtin:bigmodel-coding-plan：4 次 ok，累计 in=343,911 out=16,939
health-scan 汇总：RED ×0 / WARN ×2（WARN 不阻断但须回显计数，累计出现即按升格条件处置，W-1）（账本行 76/流水行 1087/窗口 20/审计岗 drafter,gate1-reviewer,auditor-readonly）——可收口
exit=0
```

## 5. b9（RESIDUALS/CHANGELOG/SKILL 修订记/06 迁移注记）终态全量门禁

```
$ node scripts/regression.mjs

regression 汇总：8/8 过，SKIP ×1（未跑项不计入通过数）（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）
exit=0

$ node scripts/check-hardcode.mjs
[info] 白名单豁免 33 处（13 条规则）
check-hardcode 汇总：扫 12 个 .md，命中 1 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
exit=0

$ node scripts/check-anchors.mjs
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
exit=0

$ node scripts/check-anchors.mjs --self-test
[self-test] 16/16 过
exit=0

$ node scripts/health-scan.mjs --project .
[info] 用量 builtin:bigmodel-coding-plan：4 次 ok，累计 in=343,911 out=16,939
health-scan 汇总：RED ×0 / WARN ×2（WARN 不阻断但须回显计数，累计出现即按升格条件处置，W-1）（账本行 76/流水行 1102/窗口 20/审计岗 drafter,gate1-reviewer,auditor-readonly）——可收口
exit=0

$ grep -rn "固定六段" references/ SKILL.md templates/
exit=1

$ grep -rnE "退出码.*：.*[0-9]+=" scripts/*.mjs
exit=1
```

（勘误环：RESIDUALS.md:85 evolve-samefamily 行初稿落宿主实配模型键字面（k3）触发 hardcode WARN×1——供应商 live 事实不落正文（06 §0），改值指针化到批档审出件后复扫：）

```
$ node scripts/check-hardcode.mjs
[info] 白名单豁免 33 处（13 条规则）
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
exit=0（0 命中=复绿；白名单未动=禁改面）
```

## 6. 收尾终态快照（b8+b9 两笔提交后；HEAD=6edffa2）

```
$ git log --oneline -2
6edffa2 fix(evolve
b76efd7 fix(evolve
---
regression 汇总：8/8 过，SKIP ×1（未跑项不计入通过数）（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）
exit=0
check-hardcode 汇总：扫 12 个 .md，命中 0 处（白名单豁免 33；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
exit=0
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=11 件）
exit=0
[self-test] 16/16 过
exit=0
health-scan 汇总：RED ×0 / WARN ×2（WARN 不阻断但须回显计数，累计出现即按升格条件处置，W-1）（账本行 76/流水行 1117/窗口 20/审计岗 drafter,gate1-reviewer,auditor-readonly）——可收口
exit=0
C4: exit=1
C1: exit=1
C4b: 1
R7 单独跑：
$ node scripts/regression.mjs --only R7
PASS R7 账本 schema 指针唯一指向 02 §9 SKILL.md:✓ org-seg.snippet:✓
regression 汇总：1/1 过（项=R7）
exit=0
```
