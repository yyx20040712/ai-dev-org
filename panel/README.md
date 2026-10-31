# 组织控制面板（panel/·入仓参数化版）

模型配置顺序的日常唯一调整入口（角色候选池拖拽排序→原子写本机件→validate 不过即回滚）。
本目录随技能仓分发，**零绝对路径硬编码**——技能根由脚本位置推导，新机即开即用。

## 启动

```bash
bash panel/start.sh                       # 默认端口 8787，自动后台拉起并开浏览器
ORG_PANEL_PORT=9000 bash panel/start.sh   # 自定义端口
```

环境变量（全部可选）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `ORG_PANEL_PORT` | `8787` | 监听端口（仅 127.0.0.1） |
| `ORG_PANEL_PROJECT` | 未设 | 项目仓绝对路径——设置后面板增呈项目仓状态卡；未设即隐藏 |
| `ORG_PANEL_STARTUP_MS` | `60000` | 启动后无人接入的自动退出容忍窗 |
| `ORG_PANEL_GRACE_MS` | `30000` | 单页心跳失联容忍窗 |

## 前置条件（首次使用）

1. 本机件 `org-config.local.json` 已就位（`node scripts/deploy-check.mjs --install` 可脚手架）——
   面板读合并配置并写回本机件，缺件时面板不可用。
2. Node 受支持系（判据单源=org-config `supported_node.forbid_major`，见 DEPLOY.md §0）。

## 边界（与用户域面板同律）

- 仅监听 `127.0.0.1`，不对外；随页生灭（全部页面关闭即自动退出）。
- 调整通道=角色优先顺序直写：`role_fallbacks`＋`agent_defaults` 原子双写，
  `validate` 不过即回滚 `.panel-bak`；无到期回落、无重置默认。
- 顺序调整后如需部署面跟随：面板内「同步」按钮＝`deploy-check --sync-agents`
  （或命令行同款）；代理档案为会话启动快照，改后须新会话生效。
- 跨技能引用：本面板动态 import 技能仓 `scripts/org-config.mjs`（脚本位置推导，
  勿改回绝对路径）——其他技能复用本仓模块时同法。

## 写审计链（R0 起）

- **审计位置**：`<技能根>/.zcode/panel-write-audit.jsonl`（运行时由 SKILL 根推导，
  非硬编码绝对路径；`.zcode/` 已被 gitignore，随批保留为写序档案）。
- **记录范围**：三个写 API（`/api/order`、`/api/level`、`/api/sync`）每个受理的写操作
  恰追加一行 JSON，字段固定 `ts`/`op`/`before_cfg_sha12`/`after_cfg_sha12`/`result`/`detail`。
- **写链串行（R1 z-B01）**：`/api/sync` 的执行＋after＋审计与 `/api/order`、`/api/level`
  共用同一条 writeChain 串行——审计行序＝写链执行序，并发写/同步下哈希链闭合。
- **append-only**：`appendFileSync` 单行原子追加，只增不改——禁止重写、排序、删除或
  截断；审计追加失败＝该写操作显式失败并按既有回滚链恢复，不得静默无审计成功。
- **三结果**：`result` ∈ `ok`（成功落盘）/`rolled_back`（写后 validate 失败已按
  `.panel-bak` 回滚，after=回滚完成态）/`rejected`（预检、白名单或执行拒绝，零写入）。
- **rejected 语义细分（R1 d-N03）**：对 `/api/order`、`/api/level`，`rejected`＝配置零
  写入（预检/白名单/执行拒绝，含写前装载异常）；对 `/api/sync`，`rejected`＝重渲染
  执行拒绝（agents 面本次零落盘），并非配置白名单式拒绝——白名单拒绝仅指配置写路径
  越界（detail 含 `reject=whitelist:*` 类别），两类以 detail 区分。R2 补（ds-N1）：
  `rejected` 含哈希降级行（detail 带 `after`/`before`=unavailable·响应
  `auditHashDegraded=true`·sync 本体 `code` 如实）——此时 agents 面可能已写，
  「零落盘」保证仅适用白名单拒绝（detail `reject=whitelist:*`）。
- **哈希哨兵（R1 z-B02）**：before/after 计算失败（配置装载/哈希不可算）时字段显式取
  值 `unavailable`，绝不伪填对方哈希；`ok` 与 `rolled_back` 只在取得真实哈希时记录
  （`rolled_back` 仅以真实回滚完成态哈希落行；回滚未确认时记 `rejected` 且 detail 带
  `rollback_ok=false`）。
- **前后哈希**：`before_cfg_sha12`/`after_cfg_sha12` 均为 `cfgHash(loadOrgConfig(SKILL).merged)`
  （org-config.mjs 导出，规范化 JSON 的 sha256 前 12 位），写前、写后各算一次；
  `/api/sync` 不改配置时 before=after 仍记录。`detail` 只含 role、validate/sync code、
  拒绝类别等非密钥摘要。
- **写路径白名单**：server.mjs 显式定义 `PANEL_WRITE_ALLOWLIST`＝本机件本体、
  `.panel-bak`、同目录 `.<basename>.<pid>.tmp` 模式三项精确成员；备份/临时/rename/恢复
  目标每次落盘前逐一校验，拒绝 symlink 与路径穿越旁路。
- **`.panel-bak` 非写序**：备份仅是原子写的写前字节副本，不能倒推历史写序——写序
  唯一记录=本审计件。
- **主控补账**：面板对主仓与技能仓 `org-ledger.jsonl` 零写；批后账本登记由主控完成，
  面板不直写项目账本。
