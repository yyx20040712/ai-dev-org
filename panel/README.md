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
