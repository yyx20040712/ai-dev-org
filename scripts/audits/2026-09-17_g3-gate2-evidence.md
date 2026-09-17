# g3 批门二实证证据（ops-probe 机械重跑面）

> 矩阵=scripts/audits/2026-09-17_g3-gate2-matrix.md；技能根=C:\Users\Administrator\.zcode\skills\ai-dev-org。
> 环境：Git Bash on win32 10.0.26200 x64；node v25.2.1；git 仓库根=技能根本身。
> 每条命令实录 `命令；echo exit=$?`。进度：item1-8 全部完成（尾栏见文末）。

## 1. 自检三件

### 1a. org-config 自检

```
$ node scripts/org-config.mjs --self-test; echo exit=$?
PASS 对象逐字段覆盖+未提及沿用
PASS 数组整体替换
PASS 显式 null=删除
PASS null 于新增键=不新增
PASS 哈希键序无关
PASS 哈希剔 null（对象键）
PASS 哈希剔 null（数组元素，顺序保留）
PASS b4 null provider→校验错误行（不崩）
PASS b4 近邻提示 null 宿主条目不崩（near?.[1]?.name）
PASS b4 健康源不受 null 条目影响（live 双校验通过不出错行）
PASS g3 cliFlag：缺席→null（现语义不变）
PASS g3 cliFlag：正常取值
PASS g3 cliFlag：同名 flag 出现≥2 次→UsageError
PASS g3 cliFlag：flag 居末位（无值）→UsageError
PASS g3 cliFlag：下一 token 以 -- 开头（值形如 flag）→UsageError
PASS g3 cliFlag：单 - 开头值（负数）放行
PASS g3 cliFlag：UsageError 不带 exitCode 属性（消费点显式 exit 1）
self-test 全过（17 向量）
exit=0
```

含「全过」：是；向量数：17。

### 1b. deploy-check 自检

```
$ node scripts/deploy-check.mjs --self-test; echo exit=$?
PASS forbid 正例（v25.2.1 ∈ [25] → FAIL）
PASS forbid 反例（v24.21.0 ∉ [25] → ok）
PASS forbid 配置缺省（无 forbid_major → 恒 ok）
PASS 清单派生（ops-*.md 全收+排序+他件剔除）
PASS 漂移分类：缺失→FAIL（--install 可补）
PASS 漂移分类：存在但哈希不等→warn（不覆盖）
PASS 漂移分类：存在且相等→ok
PASS 退出码：无 FAIL → 0（warn 不阻断由汇总向量另证）
PASS 退出码：有 FAIL → 1
PASS 退出码：--self-test 失败 → 1
PASS 退出码：自身装载错 → 3（SelfLoadError 常量）
PASS hook 值：.githooks → ok
PASS hook 值：未设 → FAIL（--install 可补）
PASS hook 值：自定义 → warn（只提示）
PASS 汇总行：计数+终判（FAIL→阻断）
PASS 汇总行：warn 不阻断（→处置后复跑，exit 仍 0）
PASS g3 派生：唯一命中→{uuid_prefix:id 前 8 字符, entry_name}
PASS g3 派生：零命中→unmatched（不猜）
PASS g3 派生：同 entry_name≥2 命中→ambiguous（歧义不猜）
PASS g3 派生：hostUnconsumed 归集（宿主有而默认件未用的条目名=候选信息）
PASS g3 判定：全命中且值与默认件完全一致→hostFactsDiffer=false（不写盘）
PASS g3 判定：uuid 前缀漂移→hostFactsDiffer=true（须派生覆盖件）
PASS g3 install：覆盖件已存在→绝不覆盖（原内容不动）
PASS g3 install：有 unmatched/ambiguous→不写文件（指引手工路径）
PASS g3 install：全命中且与默认件一致→不写文件（无冗余件）
PASS g3 install：漂移→写覆盖件（note 声明+派生 providers+落盘回读一致）
PASS g3 install：写盘 IO 抛错→FAIL 结果带真因（不裸抛/不误归因装载失败）
PASS g3 install：仅 unmatched（无 ambiguous）→不写+指引（行含 none/歧义槽=无）
PASS g3 install：仅 ambiguous（无 unmatched）→不写+指引（行含 ambi/零命中槽=无）
PASS g3 install：hostCfg=null 注入→不裸抛+不写+指引（全别名入 unmatched）
self-test 全过（30 向量）
exit=0
```

含「全过」：是；向量数：30。

### 1c. log-triage 自检

```
$ node scripts/log-triage.mjs --self-test; echo exit=$?
PASS 429→quota
PASS 504→window
PASS 500→server
PASS 401→config
PASS ECONNRESET→transport
PASS 枚举值判定（sonnet 非 <uuid>/<model> 形态）
PASS 合法绑定形态（uuid/model）
PASS 合法绑定形态（builtin:model/key）
PASS probe-b 假绑定可被 ③ 抓出（RED+枚举）
PASS 验收断言：mock429×4 不计入（mockN=4/quota=0/window=1）
PASS 验收断言：推荐=k1 不换源（当日实陷回归——原输出假推荐 k2）
PASS 全角（mock）兜底命中（不计入推荐）
PASS b3 格式校验：非 YYYY-MM-DD 拒（foo/2026-9-16/空串）
PASS b3 语义校验：坏月日拒（2026-13-45）
PASS b3 语义校验：坏日拒（2026-02-30——本机 V8 ISO 解析日溢出回卷非 NaN，须分量回环判）
PASS b3 语义校验：平年 2 月 29 拒（2025-02-29）
PASS b3 语义校验：合法值过（2026-09-16/闰 2024-02-29/平年 2025-02-28）
PASS b3 窗口 epoch 化+UTC 日界（since=UTC 零点/until=次 UTC 零点）
PASS b3 UTC 日界：上海本地 09-17 02:00 行（=UTC 09-16 18:00）归 09-16 窗
PASS b3 UTC 日界（非本地零点）：上海本地 09-16 04:00 行（=UTC 09-15 20:00）不入 09-16 窗
PASS b3 --hours 同路径：epoch ms 回推（now 定锚 12:00Z−2h=10:00Z）
PASS b3 窗口行过滤：UTC 09-16 窗内两行留（含上海 09-17 02:00 行）/次 UTC 零点起弃
PASS b4 null provider→buildAliasMap 不崩（null 条目跳过/其余映射保留）
self-test 全过
exit=0
```

含「全过」：是；末行无向量数（输出原文如此）。

（item2-8 逐笔续写于下）

## 2. 回归与扫描四件

### 2a. regression

```
$ node scripts/regression.mjs; echo exit=$?
PASS R2a 档案装载 vs golden 字节比对+MANIFEST 一致 gate1-reviewer:= drafter:= auditor-readonly:=
PASS R2b 派发器 dry-run assembled_system vs golden gate1-reviewer:= drafter:= auditor-readonly:=
PASS R5 exit=2(期2) stderr全源尽=true 事件计数 attempt=12/12 switch=2/2 exhaust=1/1（链长3推导）chain=kimi-main→kimi-backup→deepseek 账本exhaust=true
PASS R4 流水:尾100行坏0行（含未知事件0）跳0行(旧版本)外来0行(他源channel标记) 事件分布={"attempt":80,"switch":13,"exhaust":7}；cfg哈希一致=true（流水 20254429f008 vs live cfg:20254429f008）；账本:尾50行坏0行（含未知事件0）跳9行(旧版本)外来0行(他源channel标记) 事件分布={"ok":30,"ruling":9,"stopped":1,"switch":1}
PASS R7 账本 schema 指针唯一指向 02 §9 SKILL.md:✓ org-seg.snippet:✓
PASS R8 log-triage:exit=0/全过=true/验收断言=true org-config:exit=0/全过=true deploy-check:exit=0/全过=true
PASS R9 scrub 复制体与源字面量一致=true
PASS R10 b1/b2/b6 回归面——①结构断言:非注释行fetch命中=0 node:http(s)import=✓；③向量:splitEndpoint=全过/classify+ensure=全过；②mock往返:glm=✓(exit=0 正文+流水attempt/ok行)/ds=✓(exit=0)；④B1向量(registry错误面):全过 坏JSON→exit=3(期3)/[fatal]=true；roles:null→exit=3(期3)/[fatal]=true
SKIP R1 未给 --r1——真实派发配给保护，~9k Kimi tokens；冻结裁决前须跑或显式登记欠账（SKIP 不计入通过数——ds-W6）

regression 汇总：8/8 过，SKIP ×1（未跑项不计入通过数）（项=R2a/R2b/R5/R4/R7/R8/R9/R10/R1）
exit=0
```

汇总行原文见上；R8 行原文见上。

### 2b. check-anchors

```
$ node scripts/check-anchors.mjs; echo exit=$?
check-anchors 汇总：WARN ×0（试点校准期）/ FAIL ×0（扫描面=12 件）
exit=0
```

### 2c. check-hardcode

```
$ node scripts/check-hardcode.mjs; echo exit=$?
[info] 白名单豁免 36 处（14 条规则）
check-hardcode 汇总：扫 14 个 .md，命中 0 处（白名单豁免 36；词表=org-config 0 条+宿主注册表 4 条）（WARN 级——升格判据待定，W-6）
exit=0
```

### 2d. health-scan

```
$ node scripts/health-scan.mjs; echo exit=$?
[WARN] 账本存在 1 行 ok 缺 usage 字段——预算累计会低估，修复记账后重扫
[WARN] 账本存在 4 行 in=0 而 out>0——疑缓存命中未计（cache_read_input_tokens 未并），预算累计低估（P2-5）
[info] 账本跳过 1 行 mocked=true（演练行——源头甄别，不参与欠账/同源判定）
[info] 账本跳过 1 个临时演练项目（os.tmpdir() 前缀——P0-1 判据）：C:\Users\ADMINI~1\AppData\Local\Temp\r5-692zCI
[info] 项目 synapse：exhaust 后已补还（ok 2026-09-16）
[info] 项目 E:/class/智水蓝图/waterprint：exhaust 后已补还（ok 2026-09-13）
[info] 账本 41 行无 truncated 字段（schema v1 历史行）——④ 对历史行豁免，其覆盖率为已知欠账
[info] 尾窗 ok 源分布：builtin:bigmodel-coding-plan/model-field:b2466f8b-9d89-4428-a38e-c2aca1c41d0e/k3/model-field:8ad55776-2296-4f1a-bc46-05755c8f1300/deepseek-flash/session
[info] 用量 kimi-main：27 次 ok，累计 in=176,480 out=147,713
[info] 用量 deepseek：22 次 ok，累计 in=146,718 out=307,727
[info] 用量 kimi-backup：2 次 ok，累计 in=9,345 out=21,143
[info] 用量 builtin:bigmodel-coding-plan：16 次 ok，累计 in=343,911 out=16,939
[info] 用量 model-field:b2466f8b-9d89-4428-a38e-c2aca1c41d0e/k3：4 次 ok，累计 in=0 out=0
[info] 用量 model-field:5e1abd9d-1f4f-41fb-afa1-ecb5ce76e256/k3：1 次 ok，累计 in=0 out=0
[info] 用量 model-field:8ad55776-2296-4f1a-bc46-05755c8f1300/deepseek-flash：2 次 ok，累计 in=0 out=0
[info] 用量 session：6 次 ok，累计 in=0 out=0
health-scan 汇总：RED ×0 / WARN ×2（WARN 不阻断但须回显计数，累计出现即按升格条件处置，W-1）（账本行 111/流水行 1701/窗口 20/审计岗 drafter,gate1-reviewer,auditor-readonly）——可收口
exit=0
```

RED/WARN 计数行原文见末汇总行（RED ×0 / WARN ×2）。

## 3. 用法错五路（b1 行为面）

### 3a.

```
$ node scripts/deploy-check.mjs --agents-dir; echo exit=$?
[用法错] flag --agents-dir 居末位无值（缺值=用法错——原取 undefined 静默，g3 批 evolve-l4-flags 清偿）
exit=1
```

### 3b.

```
$ node scripts/org-config.mjs --project; echo exit=$?
[用法错] flag --project 居末位无值（缺值=用法错——原取 undefined 静默，g3 批 evolve-l4-flags 清偿）
exit=1
```

### 3c.

```
$ node scripts/regression.mjs --only R8 --only R9; echo exit=$?
[用法错] flag --only 出现 2 次（重复=用法错——原仅解析首个，g3 批 evolve-l4-flags 清偿）
exit=1
```

### 3d.

```
$ node scripts/log-triage.mjs --date; echo exit=$?
[用法错] flag --date 居末位无值（缺值=用法错——原取 undefined 静默，g3 批 evolve-l4-flags 清偿）
exit=1
```

### 3e.

```
$ node scripts/ds-call-v2.mjs --role gate1-reviewer --dry-run --mock-source; echo exit=$?
[用法错] flag --mock-source 居末位无值（缺值=用法错——原取 undefined 静默，g3 批 evolve-l4-flags 清偿）
exit=1
```

五路均 exit=1，末行均为 [用法错] 行（输出全文即上文 1 行）。

## 4. 变异红证抽钉（C3——org-config.mjs cliFlag 重复检测 throw 行）

目标行定位（grep）：`107:  if (hits.length >= 2) throw new UsageError(`flag ${name} 出现 ${hits.length} 次（重复=用法错——原仅解析首个，g3 批 evolve-l4-flags 清偿）`)`

矩阵前快照：

```
$ md5sum scripts/org-config.mjs && git diff --stat -- scripts/org-config.mjs; echo "exit=$?"; git stash list | wc -l
f4744bfb70be4b0b97e8d185fd7ed80c *scripts/org-config.mjs
 scripts/org-config.mjs | 54 +++++++++++++++++++++++++++++++++++++++++++++-----
 1 file changed, 49 insertions(+), 5 deletions(-)
exit=0
0
```

（注：矩阵前 git diff 非空=工作区本有 g3 批改动 49+/5-，故零残留判据=还原后与该快照一致，非空 diff。）

备份+变异：

```
$ cp scripts/org-config.mjs scripts/org-config.mjs.bak && sed -i '107s|.*|// MUTATION-PROBE $&|' scripts/org-config.mjs; echo mutate_exit=$?
mutate_exit=0
```

变异后第 105-108 行（sed -n 实录，107 行行首已 // 注释，throw 不再执行）：

```
  for (let i = 0; i < argv.length; i++) if (argv[i] === name) hits.push(i)
  if (hits.length === 0) return null
// MUTATION-PROBE $  if (hits.length >= 2) throw new UsageError(`flag ${name} 出现 ${hits.length} 次（重复=用法错——原仅解析首个，g3 批 evolve-l4-flags 清偿）`)
  const val = argv[hits[0] + 1]
```

变异后自检：

```
$ node scripts/org-config.mjs --self-test; echo exit=$?
（前 12 行 PASS 同 §1a，略列——原文已实测，第 13 行起：）
FAIL g3 cliFlag：同名 flag 出现≥2 次→UsageError
PASS g3 cliFlag：flag 居末位（无值）→UsageError
PASS g3 cliFlag：下一 token 以 -- 开头（值形如 flag）→UsageError
PASS g3 cliFlag：单 - 开头值（负数）放行
PASS g3 cliFlag：UsageError 不带 exitCode 属性（消费点显式 exit 1）
self-test 1 项失败
exit=1
```

（注：变异后输出原文共 18 行=12 PASS+1 FAIL+4 PASS+汇总行「self-test 1 项失败」，为省篇幅前 12 PASS 行与 §1a 同名向量一致，未抄录；FAIL 行与汇总行为逐字原文。）

还原+复跑+零残留证明：

```
$ mv scripts/org-config.mjs.bak scripts/org-config.mjs && node scripts/org-config.mjs --self-test > /tmp/restore_test.out 2>&1; echo exit=$?; tail -2 /tmp/restore_test.out; md5sum scripts/org-config.mjs; git diff --stat -- scripts/org-config.mjs; git stash list | wc -l; ls scripts/*.bak 2>&1
exit=0
PASS g3 cliFlag：UsageError 不带 exitCode 属性（消费点显式 exit 1）
self-test 全过（17 向量）
f4744bfb70be4b0b97e8d185fd7ed80c *scripts/org-config.mjs
 scripts/org-config.mjs | 54 +++++++++++++++++++++++++++++++++++++++++++++-----
 1 file changed, 49 insertions(+), 5 deletions(-)
0
ls: cannot access 'scripts/*.bak': No such file or directory
```

零残留判据逐项：md5 还原后=f4744bfb70be4b0b97e8d185fd7ed80c（与矩阵前快照逐字节一致）；git diff --stat 与矩阵前快照同一输出；git stash list 计数 0（前后均 0）；.bak 文件不存在（ls 报 No such file or directory=无残留文件本身；该 ls 无匹配使复合命令整体 exit=2，已如实记录）。复跑自检 exit=0 且「self-test 全过（17 向量）」。

（item5-8 续写于下）

## 5. R2 坏覆盖件真机注入

前置核验（不存在→非 BLOCKED，执行）：

```
$ ls -la .zcode/ 2>&1; echo ls_exit=$?; ls .zcode/org-config.json 2>&1; echo file_exit=$?
total 56
drwxr-xr-x 1 Administrator 197121     0 Sep 17 11:20 ./
drwxr-xr-x 1 Administrator 197121 0 Sep 17 10:47 ../
-rw-r--r-- 1 Administrator 197121 46715 Sep 17 09:48 org-ledger.jsonl
ls_exit=0
ls: cannot access '.zcode/org-config.json': No such file or directory
file_exit=2
```

注入（字节级实录 od -c：`{ ` + UTF-8 坏=e5 9d 8f）：

```
$ printf '{ 坏' > .zcode/org-config.json && od -c .zcode/org-config.json | head -2; echo inject_exit=$?
0000000   {     345 235 217
0000005
inject_exit=0
```

install 路径（记 install-hostfacts 行+末行+退出码）：

```
$ node scripts/deploy-check.mjs --install; echo exit=$?
[install] 首装模式——三动作：④补缺失代理件 / ⑤hooksPath 未设时补设 / ③宿主事实派生项目覆盖件（护栏：不覆盖漂移件/不改 org-config.default.json 与宿主配置）
[install] install-agents——无缺失件（已存在漂移件不覆盖——保护本机定制）
[install] install-hook——core.hooksPath 已设=.githooks（不重复设置；自定义值属用户裁决面）
[install] install-hostfacts——跳过：org-config 装载失败（JSON 解析失败 C:\Users\Administrator\.zcode\skills\ai-dev-org\.zcode\org-config.json: Expected property name or '}' in JSON at position 2 (line 1 column 3)）——处置=修复或移除 .zcode/org-config.json（用户域件）/核对默认件后复跑；手工路径=DEPLOY §3
[装载错] org-config 装载失败：JSON 解析失败 C:\Users\Administrator\.zcode\skills\ai-dev-org\.zcode\org-config.json: Expected property name or '}' in JSON at position 2 (line 1 column 3)
exit=3
```

install-hostfacts 行=上文第 4 行；末行=[装载错] 行；退出码=3。

检查路径（记 [装载错] 行+退出码）：

```
$ node scripts/deploy-check.mjs; echo exit=$?
[装载错] org-config 装载失败：JSON 解析失败 C:\Users\Administrator\.zcode\skills\ai-dev-org\.zcode\org-config.json: Expected property name or '}' in JSON at position 2 (line 1 column 3)
exit=3
```

还原：

```
$ rm .zcode/org-config.json; echo rm_exit=$?; ls .zcode/; echo ls_exit=$?
rm_exit=0
org-ledger.jsonl
ls_exit=0
```

还原后 .zcode/ 内容=仅 org-ledger.jsonl（与注入前 ls -la 一致，注入件零残留）。

## 6. b2 本机形态

```
$ node scripts/deploy-check.mjs --install; echo exit=$?; ls .zcode/org-config.json 2>&1; echo override_exit=$?
[install] 首装模式——三动作：④补缺失代理件 / ⑤hooksPath 未设时补设 / ③宿主事实派生项目覆盖件（护栏：不覆盖漂移件/不改 org-config.default.json 与宿主配置）
[install] install-agents——无缺失件（已存在漂移件不覆盖——保护本机定制）
[install] install-hook——core.hooksPath 已设=.githooks（不重复设置；自定义值属用户裁决面）
[install] install-hostfacts——宿主事实与默认件一致——无需覆盖件（不写，防本机冗余件）
[FAIL] node-major——当前 v25.2.1（主版本 25）∈ 受禁系（org-config supported_node.forbid_major）——改装受支持主版本后复跑
[ok] skill-files——必备 4 件齐（SKILL.md、org-config.default.json、scripts/org-config.mjs、scripts/roles/registry.json）
[ok] org-config——validate 通过（validate PASS（3 源双校验通过，cfg:20254429f008））
[ok] agents——ops-adjudicator.md（C:\Users\Administrator\.zcode\agents）sha256 相符
[ok] agents——ops-diagnostics.md（C:\Users\Administrator\.zcode\agents）sha256 相符
[ok] agents——ops-executor.md（C:\Users\Administrator\.zcode\agents）sha256 相符
[ok] agents——ops-gate1-k1.md（C:\Users\Administrator\.zcode\agents）sha256 相符
[ok] agents——ops-gate1-k2.md（C:\Users\Administrator\.zcode\agents）sha256 相符
[ok] agents——ops-probe.md（C:\Users\Administrator\.zcode\agents）sha256 相符
[ok] hook——core.hooksPath=.githooks（提交门禁已挂）
[ok] remote——已挂（origin）
[ok] ledger-dir——SKILL_ROOT/.zcode/ 可写（账本目录就绪）
deploy-check 汇总：ok 11/warn 0/FAIL 1——阻断
exit=1
ls: cannot access '.zcode/org-config.json': No such file or directory
override_exit=2
```

三要素实录：install-hostfacts 行=「[install] install-hostfacts——宿主事实与默认件一致——无需覆盖件（不写，防本机冗余件）」；`.zcode/org-config.json` 仍不存在（override_exit=2）；org-config ③项 validate ok 行=「[ok] org-config——validate 通过（validate PASS（3 源双校验通过，cfg:20254429f008））」。
另实录：本机 v25.2.1 命中 forbid_major → [FAIL] node-major 行，汇总 ok 11/warn 0/FAIL 1——阻断，exit=1（输出原文，机器事实，未作定性）。

（item7-8 续写于下）

## 7. b3 指针抽核（5 条「NN §M」+SKILL.md:89）

抽法：references/00-glossary.md 内任取 5 条含「NN §M」指针的条目，逐条到目标文件核章节标题存在。

| # | 术语表出处（00-glossary.md 行） | 指针 | 目标命中行（原文） |
|---|---|---|---|
| 1 | 37：\| 单批次流水线 \| 基准 12 步（领单→…→收口）的标准步序 \| 02 §2 \| | 02 §2 | 02-pipeline-templates.md:20：`## 2. 单批次流水线（基准 12 步）` |
| 2 | 56：\| 变异红证 \| 临时破坏实现证明确实会红（防「看起来会失败」假阳性） \| 03 §4 / 01·C3 \| | 03 §4 | 03-machine-enforcement.md:48：`## 4. 变异红证（防假阳性）` |
| 3 | 69：\| 额度经济学 \| 投放面原则；具体数字与红线住 org-config（正文禁硬编码） \| 06 §3 \| | 06 §3 | 06-model-routing.md:35：`## 3. 额度经济学（投放面原则；具体数字与红线看 org-config）` |
| 4 | 25：\| 岗位编制终表 \| 全属性（岗名×通道×档位语义）唯一真源（编制=8 岗）；他处仅索引岗名 \| 07 §1 \| | 07 §1 | 07-role-cards.md:7：`## 1. 岗位编制终表（编制=8 岗；「人类用户」=裁决位不计入编制）` |
| 5 | 42：\| 交接（取代制） \| 交接书只新写不改旧；最新一份=进程状态真源 \| 02 §7 / 08 §1 \| | 08 §1 | 08-doc-governance.md:10：`## 1. 事实分层寻址表（哪类事实住哪——双源漂移的根治面）` |

5/5 命中（章节标题行均存在，原文已贴）。

SKILL.md:89 行原文（sed -n '89p' 实录）：

```
00 术语速查+新手上手图 ｜ 01 原理 A~E 五组 ｜ 02 管道 12 步+任务书七段+回炉+数据专轨+适配注记 ｜
```

## 8. 白名单对账

```
$ git status --porcelain; echo exit=$?
 M DEPLOY.md
 M SKILL.md
 M scripts/deploy-check.mjs
 M scripts/ds-call-v2.mjs
 M scripts/log-triage.mjs
 M scripts/org-config.mjs
 M scripts/regression.mjs
?? references/00-glossary.md
?? scripts/audits/2026-09-17_g3-brief.md
?? scripts/audits/2026-09-17_g3-for-gate1.md
?? scripts/audits/2026-09-17_g3-gate1-out.md
?? scripts/audits/2026-09-17_g3-gate2-evidence.md
?? scripts/audits/2026-09-17_g3-gate2-matrix.md
?? scripts/audits/2026-09-17_g3-impl-report.md
?? scripts/audits/2026-09-17_g3-rework-for-gate1.md
?? scripts/audits/2026-09-17_g3-rework2-for-gate1.md
exit=0
```

对账事实：改（M）=7 件（DEPLOY.md/SKILL.md/deploy-check.mjs/ds-call-v2.mjs/log-triage.mjs/org-config.mjs/regression.mjs）；??=references/00-glossary.md+scripts/audits/ 下 2026-09-17_g3-* 档件 8 件（含本证据件与矩阵件）；清单内无其他条目。

## 异常清单（现象/证据/初分类——禁定性，裁决归裁决部）

1. 现象：item 6 `deploy-check --install` 末行汇总「ok 11/warn 0/FAIL 1——阻断」exit=1，FAIL 行=[FAIL] node-major——当前 v25.2.1（主版本 25）∈ 受禁系。证据：§6 输出原文。初分类：环境/配置面事实（本机 node 主版本命中 org-config supported_node.forbid_major）；矩阵 item6 三预期要素（install-hostfacts 一致行/覆盖件不存在/③ validate ok 行）均到位，exit=1 由该 FAIL 行致。另注：item 2a regression 汇总含「SKIP ×1（R1——未给 --r1）」、item 2d health-scan WARN ×2（缺 usage 字段 1 行+in=0 而 out>0 4 行）——均为输出原文实录，非执行异常，未计入异常数。

## 尾栏

矩阵 8 项全部真跑完毕；item4 变异-还原-零残留、item5 注入-还原-零残留均完整执行并在上文证明。

MODEL-SELF: ops-probe bound
FINDINGS: 项数=8 异常=1
