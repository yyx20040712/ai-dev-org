# evolve-E1 实现报告（b1+b2+b6+R10）——2026-09-16

领单号=evolve-E1；简报=2026-09-16_evolve-brief-e1.md；计划=2026-09-16_evolve-plan-v3.md
（裁决件 ruling-v3 不存在，简报 §3 预裁决 P-1~P-5 即判据源）。环境=Node v25.2.1
/Git Bash win32/git@main。基线核对=git fe19260 干净、regression 7/7（R1 SKIP）、
hardcode 命中 0（豁免 33）、anchors WARN×0/FAIL×0、health-scan RED×0/WARN×2、
cfg=a26f710a540d——全部对上后开工。

## 1. 实现摘要

- **b1（glm-look 传输层）**：fetch→node:http(s) 直连，镜像 ds-call-v2 v2.2.1
  postJson——`export function splitEndpoint(url)`（URL→protocol/hostname/port/
  path，端口缺省按协议补 80/443、显式端口数字化）；postJson 消费
  splitEndpoint，signal=AbortSignal.timeout 唯一超时源（req 侧零 setTimeout）、
  res.on('error') 补挂、不跟随 3xx、不设 accept-encoding；20min 上限
  （CALL_TIMEOUT_MS）与非 429 的 4xx/超时立断语义保持；process.exitCode
  自然退出保持（isMain guard 内 `process.exitCode = await main()`）。
  配套：isMain guard（org-config.mjs:124-126 范式）+顶层配置装载惰性单例
  （orgCfg()，import 消费纯函数零副作用）+env 重定向钩子两枚（见自裁 1）。
- **b2（ds-call-v2 退出码分类）**：`export class ConfigError extends Error`
  （exitCode=3）+`export function classifyExitCode(e)`（有 exitCode 属性用
  属性（1-255 整数），无=1）；顶层 uncaughtException 改走分类器，删
  `/JSON|配置|registry|org-config/` 消息正则兜底；装载点四处包装
  ConfigError（registry readJson/sys_prompt_file+dod_file readFileSync/
  loadOrgConfig/readHostConfig）；CLI 体包 `async function cliMain()`+
  isMain guard。判据源=06 §5.8 退出码总表。
- **b6（sys_prompt_file 包含性校验）**：`export function ensureWithinRoot(root,
  abs)`——path.resolve 后 path.relative 结果恰 `..` 或首段 `..`（涵盖 `..\`
  与 `../` 两种分隔形态）或绝对路径形态（跨盘符时 path.relative 产绝对串）
  =越界抛 ConfigError（exit 3+stderr 点名越界路径）。两落点同步演进：
  ds-call-v2 loadRole 装载点（ConfigError 直抛不被装载失败文案吞）+
  regression loadRoleAssembled（单源 import 消费，:42-43 注释自承互指）。
- **R10（regression 新增，归属 b1）**：三子面——①结构断言（glm-look.mjs
  剥块注释+跳 // 整行后的非注释行无 `fetch(` 调用形态+存在 node:http(s)
  import）；②本地 mock 双通道往返（node:http 本地 server 拟真双形：
  glm=/anthropic /v1/messages anthropic 形、ds=/deepseek /chat/completions
  openai 形各一轮；子进程驱动 glm-look+env 钩子隔离；断言 exit 0+stdout
  正文+流水 attempt/ok 行（ok 行 truncated=false 派生布尔一并断言））；
  ③纯函数向量（splitEndpoint 4 例；classifyExitCode 5 例含三类+属性直通；
  ensureWithinRoot 三负例+两正例）。块内 spawnSync 全带 timeout 60s+
  killSignal SIGKILL。

## 2. 文件清单（修改面=白名单内三脚本）

| 文件 | 批次 | 变更 |
|---|---|---|
| scripts/glm-look.mjs | b1 | 传输层 postJson+splitEndpoint export+isMain guard+惰性配置+env 钩子+头注补记；SCRUB_RE/scrub 字面量零改动（R9 对账绿实证） |
| scripts/ds-call-v2.mjs | b2/b6 | ConfigError/classifyExitCode/ensureWithinRoot export+兜底改分类器+装载点包装+loadRole 校验+CLI 体 cliMain()+isMain |
| scripts/regression.mjs | R10/b6 | R10 块（R9 后 R1 前）+imports（spawn/pathToFileURL/ensureWithinRoot）+loadRoleAssembled 校验消费；头注未动（b5 承接） |
| scripts/audits/2026-09-16_evolve-e1-log.md | 本单 | 全程真退出码实录（本报告证据源） |

## 3. 红证实录（真退出码，全文见 e1-log.md）

- **红（R10 先行，b1/b2/b6 未实现）**：`node scripts/regression.mjs --only R10`
  → `FAIL R10 …非注释行fetch命中=1「const r = await fetch(url, { method: "POST", heade」
  node:http(s)import=✗；③向量:splitEndpoint=FAIL/classify+ensure=FAIL；②mock往返:跳过`，
  **exit=1**。
  （过程中修 R10 自身两处实现 bug：vecFail 帮助函数字符串拼接错误；向量脚本
  具名 import 缺导出=SyntaxError 直崩改命名空间 import——均为测试件修正，
  被测面红证口径不变。）
- **转绿（三批完成）**：b1 后 `--only R10`=①绿②绿③splitEndpoint 绿/其余红
  （exit=1）；b2 后=③classify 绿/ensure 红（exit=1）；b6 后
  `PASS R10 …①…✓；③…全过；②…glm=✓/ds=✓`，**exit=0**。
- **变异红证 1（b1 面）**：postJson 调用点临时恢复 fetch 调用→
  `FAIL R10 …非注释行fetch命中=1「const r = await fetch(url, …」`，**exit=1**；
  证毕还原。
- **变异红证 2（b2 面）**：classifyExitCode 翻转（ConfigError→return 1）→
  `FAIL R10 …classify+ensure=FAIL(exit=1 「FAIL 分类:配置 ConfigError→3」)`，
  **exit=1**；证毕还原。
- **还原确认**：变异还原后全量 `node scripts/regression.mjs`→
  `regression 汇总：8/8 过，SKIP ×1`，**exit=0**。

## 4. throw 点穷举表（b2 判定面，实读 ds-call-v2.mjs 全文）

会落入顶层 uncaughtException 的 throw 点：

| # | 位置 | 触发场景 | 类型 | 退出码 |
|---|---|---|---|---|
| 1 | loadRole→readJson(REGISTRY_PATH)（包装） | registry.json JSON 损坏 | ConfigError | 3 |
| 2 | loadRole `throw new Error('未知角色…')` | roleId 不存在 | 普通 Error（用法） | 1 |
| 3 | loadRole→readFileSync(sys_prompt_file/dod_file)（包装） | registry 声明路径文件缺失/不可读 | ConfigError | 3 |
| 4 | loadRole→ensureWithinRoot（b6 新增） | sys_prompt_file 越界 | ConfigError | 3 |
| 5 | cliMain→loadOrgConfig（包装） | org-config JSON 损坏 | ConfigError | 3 |
| 6 | cliMain→readHostConfig（包装） | 宿主 config.json 损坏 | ConfigError | 3 |
| 7 | cliMain `throw new Error('--mock-source 需要…')` | mock spec 格式错 | 普通 Error（用法） | 1 |
| 8 | cliMain→readFileSync(promptPath) | prompt 文件不存在（fs ENOENT） | 普通 Error（用法类，英文消息无中文关键词——修复面） | 1 |
| 9 | callSource 内 4 处 throw（退避耗尽/NO_RETRY HTTP/空响应/unreachable） | 远程调用类 | **链内 :427 try/catch 捕获，不到 uncaughtException** | 链尾 exhaust=2 |

显式 process.exit 点（非 throw，退出码直接给定、全部保持不变）：
exitConfig()（死配置守卫/mock alias/status 校验/账本目录失败）=3；
loadSources 校验失败=3；makeFinishClassifier 缺词表=3；usage 三分支（--role
缺/prompt 缺/链空）=1；--list-roles/--list-sources/--dry-run=0；exhaust=2；
输出写失败=4。**删除项=uncaughtException 内消息正则兜底**（P-1 达成）。

端到端分类实证（e1-log 落盘）：坏 org-config JSON→`[fatal] org-config 装载
失败: JSON 解析失败 …` **exit=3**；未知角色→`[fatal] 未知角色: nope …`
**exit=1**；--mock-source bad→`[fatal] --mock-source 需要 …` **exit=1**。
import 副作用验证：`import('ds-call-v2.mjs')` 零执行（classify 三类直取
3/1/1，process 不退）。

## 5. 测试证据（终态，全部真退出码落盘 e1-log）

| 命令 | 结果 | exit |
|---|---|---|
| node scripts/regression.mjs | **8/8 过**，SKIP ×1（R1，配给保护——不计入通过数） | 0 |
| node scripts/check-hardcode.mjs | 命中 0（白名单豁免 33） | 0 |
| node scripts/check-anchors.mjs | WARN ×0 / FAIL ×0 | 0 |
| node scripts/health-scan.mjs --project . | **RED ×0 / WARN ×2**（=基线存量：1 行 ok 缺 usage+4 行 in=0，不劣化） | 0 |

R10 内部子面终态：①fetch 命中 0+import ✓；②mock 往返 glm/ds 双 ✓（exit 0+
正文+流水 attempt/ok 行）；③向量 splitEndpoint 4/4+classify 5/5+ensure 5/5。

## 6. commit 哈希清单（三笔，未 push）

| commit | 批 | 文件 |
|---|---|---|
| **9b6bac9** | b1+R10 | glm-look.mjs+regression.mjs（213+/8-） |
| **d3d7adc** | b2 | ds-call-v2.mjs（169+/137-，含 CLI 体缩进重排语义零变化） |
| **919f27a** | b6 | ds-call-v2.mjs+regression.mjs（27+/3-） |

## 7. 自裁申报（逐条，含内部新增面）

1. **env 钩子两枚**（glm-look）：`GLM_LOOK_LOG_DIR`（流水落点重定向——简报
   P-4 明示）；`GLM_LOOK_HOST_CONFIG`（宿主配置路径重定向——**未逐字列入
   简报**，但为「子进程驱动 glm-look 指向 mock 端点」的必要实现：无它则
   mock 往返必读真实宿主 config 触真实源发现=违反零外呼铁律）。两钩缺省
   行为不变（不设 env 时路径与原硬编码逐字节一致）。均标注内部测试设施，
   prod 路径禁依赖。
2. **R10 ②mock 往返用异步 spawn+60s 超时+SIGKILL 看护（非 spawnSync）**：
   根因=spawnSync 冻结父进程事件循环，本进程内 mock server 无法应答——
   实测复现（TCP 握手完成、server 请求永不处理、子进程挂到被外层杀，
   socket connect 插桩+对照实验定位，e1-log 有痕）。P-4 文面「R10 内一切
   spawnSync 带 timeout+killSignal」仍满足（块内全部 spawnSync——两个向量
   脚本——均带 60s/SIGKILL）；异步往返看护等价（60s/SIGKILL/windowsHide）。
3. **R10 ③向量经临时目录向量脚本（子进程）承载 import**：红态（两脚本尚无
   isMain guard）主进程直接 import ds-call-v2 会执行 CLI 体 process.exit(1)
   杀死 regression 自身、import glm-look 会执行 main() 产生副作用——子进程
   承载是红证可行的必要形态；绿态（isMain 就位）实测 import 零副作用。
4. **ds-call-v2 CLI 体包 cliMain()+isMain 导致 diff 全块缩进重排**（b2 预裁
   「CLI 体顶格执行面隔离」的实现形态）；语义零变化实证：--list-roles/
   --dry-run（R2b）/mock exhaust（R5）全过。
5. **glm-look 顶层 ORG_CFG/VISION/chCfg 改惰性单例 orgCfg()**：isMain 后
   import 零副作用的必要配套（原顶层 loadOrgConfig 在 import 时执行）；
   行为等价（单次装载缓存，main 内取用）。
6. **ensure 向量第三负例以混合分隔输入（root+'/../evil/x.txt'）承载 '../'
   形态**：win32 下 path.relative 恒产反斜杠分隔，'../' 前缀分支为 posix
   保留分支；判据实现用 `rel.split(/[\\/]/)[0]==='..'` 两分隔统一覆盖，
   三负例输入字面分别体现 `..`、`..\`、`../` 三形态（P-4③口径）。
7. **本报告与 e1-log 落盘 scripts/audits/ 但不入 commit**：随该目录既有
   untracked 惯例（plan/brief 系列同态）；三笔 commit 只含代码面。
8. 行为变化面（P-5 只需报告注明）：本单=②英文 locale 配置装载类未捕获
   异常 exit 1→3；③sys_prompt_file 越界新增 exit 3 拒绝路径（当前不可达）。

## 8. 疑虑与残留（移交 b9 登记批）

- b1 三条残留（计划 v3 既定，非本单可实证面）：>300s 首字节面不可回归
  复现（双臂探针面）；Node25 退出面不可实证；异端点传输语义面（glm 形
  3xx/gzip 与 ds 已实证面不同面，mock 仅证本地拟真）。
- R1 仍 SKIP（真实派发配给保护）——冻结裁决前须跑或显式登记欠账（既有态）。
- glm-look 头注:13 仍写「scripts/model-routing-log.jsonl 追加」——env 钩子
  缺省行为不变故头注字面仍真；若后续钩子转正需同步头注（未改，最小面）。
- 本机全程零真实外部 API 调用：R10 往返走 127.0.0.1 本地 server+env 钩子；
  R5=--mock-source 注入；R2b=--dry-run；model-routing-log.jsonl/org-ledger
  仅既有 R5 演练写入（与基线同态），本单新增写入为零。

MODEL-SELF: model-field:builtin:bigmodel-coding-plan/GLM-5.3
LEDGER-CLAIM: role=ops-executor executor=model-field:builtin:bigmodel-coding-plan/GLM-5.3 units=3 outcome=done
