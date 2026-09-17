# 实现简报 E1（b1+b2+b6+R10）——领单号 evolve-E1

## 1. 身份与禁令

- 你=ai-dev-org 技能实现者岗（会话内绑定，意图档位声明：宿主绑定档）。
  技能根=C:\Users\Administrator\.zcode\skills\ai-dev-org（下称 ROOT）。
- 禁令：禁 git push；禁新增第三方依赖（零依赖纪律）；禁触碰 scripts/roles/**
  （含 .golden）、org-config.default.json、scripts/.golden/**、templates/**、
  references/{03,05,07,08,09}、scripts/model-routing-log.jsonl（只读参照可，
  禁写入）、历史审计档（scripts/audits/** 既有件）；禁真实外部 API 调用
  （mock 本地 server 只可）；禁改 SCRUB_RE/scrub 字面量（R9 对账钉）；
  禁引入 process.exit 急退路径到 glm-look（保持 process.exitCode 自然退出）。
- 本单修改面（白名单）：scripts/glm-look.mjs、scripts/ds-call-v2.mjs、
  scripts/regression.mjs（仅 R10 新增）、新建 scripts/audits/2026-09-16_evolve-e1-*.md。
  超面=停手，在报告写 BLOCKED 不自裁。

## 2. 必读序（逐文件，看什么）

1. scripts/audits/2026-09-16_evolve-plan-v3.md——批次 b1/b2/b6 定义与预裁决
2. scripts/audits/2026-09-16_evolve-ruling-v3.md（若在）或本简报 §3 预裁决——
   裁决岗条件 C1-C6 中与本单相关项
3. scripts/ds-call-v2.mjs 全文——**v2.2.1 postJson 传输层（约 :208-234）=b1
   镜像源**；顶层兜底 :60-63=b2 对象；sys_prompt_file 装载 :99-110=b6 对象；
   attempt/退避循环（:241-280）=R1 超时推导依据（本单不改）
4. scripts/glm-look.mjs 全文——:256 fetch=b1 替换点；:30-31/:315 exitCode
   自然退出语义=保持；双通道 URL/载荷形态（glm=/v1/messages anthropic 形、
   ds=/chat/completions openai 形，约 :230 区域）
5. scripts/regression.mjs——R 项结构/现有 spawnSync 五处/golden 机制/R9
   scrub 对账（:230-236）=R10 落位参照；:48 loadRoleAssembled=b6 第二落点
6. scripts/org-config.mjs :124-126——isMain guard 范式（b1/b2 沿用）
7. references/06-model-routing.md §5.8（约 :130-145）——退出码总表=b2 判据源

## 3. 预裁决（不再自裁）

- P-1（b2）：删除消息正则兜底；全部已知配置类 throw 点改抛类型化错误
  （class ConfigError extends Error，实例带 exitCode=3；或等价形态）；顶层
  uncaughtException 按 e.exitCode 判定（有属性用属性，无属性=exit 1）；
  输出写失败路径保持显式 exit 4 不变。**穷尽清单入报告**（实读列举每个
  throw 点+其分类）。
- P-2（b6）：包含性校验=path.resolve 后 path.relative(ROOT,abs) 结果以
  `..` 开头（或为绝对路径形态异常）即拒绝，exit 3+明确 stderr 消息；校验
  落两处：ds-call-v2 sys_prompt_file 装载点 + regression loadRoleAssembled
  （两处同步演进，:42-43 注释自承）；以 export 纯函数（如
  ensureWithinRoot(root,abs)）实现，两处消费。
- P-3（b1）：镜像 ds-call-v2 v2.2.1 postJson——node:http(s) 按协议选模块、
  hostname/port/path 手工拆解（export 纯函数 splitEndpoint(url) 供 R10）、
  signal=AbortSignal.timeout 唯一超时源（req 侧禁 setTimeout）、
  res.on('error') 补挂、不跟随 3xx、不设 accept-encoding；20min 上限、
  非 429 的 4xx/超时立断语义保持；process.exitCode 自然退出保持。
- P-4（R10 归属 b1）：R10=「b1/b2/b6 回归面」汇总项，落 regression.mjs：
  ①结构断言：glm-look.mjs **非注释行**（跳过 // 与块注释行）无 `fetch(`
  调用形态+存在 node:http 或 node:https import；②本地 mock HTTP 往返：
  起 node:http 本地 server，双通道各一轮（glm 形响应骨架+ds 形响应骨架），
  子进程驱动 glm-look（指向 mock 端点）——**不得写入真实
  model-routing-log.jsonl/org-ledger.jsonl**：glm-look 若日志路径硬编码，
  增加内部 env 重定向钩子（如 GLM_LOOK_LOG_DIR，缺省行为不变），钩子
  作为内部测试设施写入报告；③纯函数向量：splitEndpoint≥3 例、
  classifyExitCode 三类（配置→3/用法→1/未知→1）≥3 例、ensureWithinRoot
  三例（恰 `..`、`..\`、`../`）+2 正例。R10 内一切 spawnSync 带 timeout
  （秒级 mock 路径 60s 量级）+killSignal。
- P-5（行为变化申报，实现侧只需在报告注明）：本单变化面=P-6②③④中
  b2/b6 部分（英文 locale 配置类 exit 1→3；越界新增 exit 3 拒绝路径）。

## 4. 纪律

- TDD 红→绿→变异红证：先写 R10（红：现状 glm-look 有 fetch→结构断言必FAIL），
  落盘退出码证据；再实现 b1/b2/b6 转绿；变异红证≥2 例（如临时恢复一处
  fetch 调用→R10 红；翻转 classifyExitCode 一条映射→向量红），证毕还原。
- 每步命令真退出码落盘：`... ; echo "exit=$?" >> scripts/audits/2026-09-16_evolve-e1-log.md`。
- 全量回归不回退：`node scripts/regression.mjs`（R1 SKIP 正常）+
  `node scripts/check-hardcode.mjs` + `node scripts/check-anchors.mjs` +
  `node scripts/health-scan.mjs --project .`（RED=0/WARN≤2）。
- 分笔 commit ×3（b1+R10／b2／b6），消息走 `git commit -F <UTF-8 临时文件>`
  （防 GBK 控制台乱码；风格=仓库惯例 `fix(evolve-bN): 标题——明细`）。
- 环境：Node v25.2.1（宿主无 24）；Git Bash/win32；路径含中文用户名注意引号。

## 5. 基线数字（自检参照，对不上=环境配错停手）

- regression 7/7（R1 SKIP）；check-hardcode 命中 0（豁免 33）；check-anchors
  WARN×0/FAIL×0；health-scan RED×0/WARN×2；cfg=`a26f710a540d`（org-config.mjs hash）。
- 参照行号（实读为准）：glm-look fetch=:256；ds-call-v2 兜底=:60-63；
  sys_prompt_file≈:99-110；regression loadRoleAssembled=:48；postJson≈:208-234。

## 6. 报告契约

- 全文落 scripts/audits/2026-09-16_evolve-e1-report.md：实现摘要/文件清单/
  红证实录（红→绿→变异红证退出码）/throw 点穷举表（b2）/测试证据/
  commit 哈希清单/自裁申报（含 env 钩子等内部新增面）/疑虑。
- 回复五行内：结论+关键数字（regression x/x、三 commit 短哈希、报告路径）。

## 7. 运行时可观察性（第 7 段，单源词表=02 §4）

- b1 新传输层：可观察落点=①glm-look 流水行（事件/通道/truncated 派生布尔
  不变）——mock 往返断言其仍产出；②失败形态=stderr 明确传输错误消息
  （不再是 undici HeadersTimeoutError 族）。
- b2 分类器：可观察落点=退出码本身（3/1/4 分型）+一行 [fatal] 消息——
  R10 向量即健康检查形态。
- b6 包含性：可观察落点=越界时 stderr 点名越界路径+exit 3。
- env 钩子（若有）：报告申报+CHANGELOG 由主控收口批统一记。
