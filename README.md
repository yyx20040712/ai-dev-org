# DevTroupe 开发剧团

一个轻量的 ZCode 软件开发插件：**主控做导演，五岗按需上场**。主控默认直接实现并运行测试；只有确有需要时，才调用调研、规划、实现、评审或视觉子代理。用户通过唯一的 `/dev-troupe` 总调度命令启动这套协作流程。

## 不再做什么

v4 是有意的不兼容重构，移除了固定十岗、任务书与审包、双审和实证裁决、质量账本、RESIDUALS/HANDOFF、术语棘轮、自制回归平台，以及与这些流程耦合的 run-* 状态机。旧实现保留在本机归档，不进入插件包。

v5 将宿主入口从 Skill 收敛为单一 command；v5.1 增加五岗结构化结果契约、可选工作流模板和 dry-run 批次快照。插件不包含独立 `skills/`，也不增加自动 runner、独立状态机或后台队列。

v6 更名为 **DevTroupe 开发剧团**，插件、命令、CLI、配置和生成清单统一使用 `dev-troupe` / `troupe`。更名前配置与清单不自动读取或迁移。

## 安装

### 本地开发市场

开发源码的上一级目录包含 `marketplace.json`，可作为本地测试市场根目录：

1. 在 ZCode 打开 **插件市场 → 添加 → 添加插件市场**，选择该根目录。
2. 在 **个人 → dev-troupe-workspace** 中找到 **DevTroupe 开发剧团** 并安装。
3. 新建任务，在斜杠命令面板中调用 `/dev-troupe`，并附上开发任务。

### GitHub 分发市场

分发仓库根目录额外提供 `marketplace.json`，可直接作为市场添加。添加该仓库后，在 **个人 → dev-troupe** 中安装或更新 **DevTroupe 开发剧团**；`dev-troupe` 是分发市场名，`dev-troupe-workspace` 仅用于本地开发。

源码、市场目录和安装后的副本是不同位置。修改源码后需要刷新市场并更新插件；不会在原会话热加载。

## 总调度命令

入口文件为 `commands/dev-troupe.md`，是协作流程的唯一真源。命令通过 `$ARGUMENTS` 接收开发目标、问题或任务描述，并指导主控完成理解、实现、验证和交付。它使用 ZCode 动态 shell 解析安装后的 CLI 绝对路径，不依赖普通 Bash 环境中的插件根目录变量。

如果调用时没有提供任务，主控会先询问具体目标。命令不依赖或加载任何 Skill。

## 工作流与结构化结果

`workflows/` 提供 `quick-fix`、`feature` 和 `visual-change` 三个可选“剧本”。在插件根目录执行：

```bash
node bin/troupe.mjs workflow list
node bin/troupe.mjs workflow show feature
node bin/troupe.mjs workflow plan feature --json
```

`plan` 会校验角色、步骤和依赖，按稳定拓扑顺序输出批次快照，但不调用 Agent、不写文件。小任务不需要工作流文件；多批任务可由主控按需把输出保存为项目 `.zcode/dev-troupe.batch.json`，并依据真实结果更新 `pending/active/done/blocked/skipped` 状态和 `result`。恢复时必须再核对代码、测试和 diff，不能只信快照。

五岗仍返回可读正文，末尾附一个角色专属 JSON 契约。契约字段在 `src/roles.mjs` 中定义，由代理生成器注入模板；它用于节点间传递事实、步骤、改动、测试和发现，不触发自动分支或返工。

## 首次配置

需要 Node 20 或更新版本。插件内不包含个人模型配置或凭据。以下 CLI 示例在插件根目录执行；安装副本的路径由 ZCode 管理，总调度命令会通过动态 shell 解析实际路径。

```bash
node bin/troupe.mjs init
node bin/troupe.mjs sync
node bin/troupe.mjs doctor
```

`init` 不覆盖已有配置。没有旧配置时会创建空配置；参考 `config/example.json` 填入真实槽位后再运行 `sync`。代理档案由宿主在会话启动时加载，因此同步后应新建会话。

用户配置默认位于：

```text
${XDG_CONFIG_HOME:-~/.config}/dev-troupe/config.json
```

可用 `TROUPE_CONFIG` 或 `--config` 指定其他位置。项目可选覆盖文件为 `.zcode/dev-troupe.json`，只用于非秘密路由覆盖。API key、token、密码等不得写入配置，应继续由宿主或环境变量管理。

## 显式导入更早期旧技能（可选）

更名不做自动兼容：只读取新配置路径、`TROUPE_*` 环境变量和 `.dev-troupe.json` 清单。更名前的配置与清单不会自动读取、复制或删除，需要时重新配置并执行 `sync`。

仅在明确需要导入更早期旧技能模型绑定时使用 `--from`：

```bash
node bin/troupe.mjs init --from /path/to/legacy/ai-dev-org
# 确认路由后，备份并移除旧十岗代理：
node bin/troupe.mjs sync --migrate-legacy
```

`--from` 只处理用户显式指定的目录，不自动发现旧技能，也不读取更名前的默认用户配置。

## 配置结构

```json
{
  "schemaVersion": 1,
  "slots": {
    "fast": {
      "model": "provider-id/model-id",
      "multimodal": false,
      "label": "Fast model"
    }
  },
  "roles": {
    "executor": { "level": "high", "slots": ["fast"] }
  }
}
```

- `slots` 定义可复用的 `provider/model` 绑定；`multimodal` 只有视觉路由需要强制为 `true`。
- `roles` 的顺序就是回退顺序，数组首项是首选。
- `level` 可选值为 `low`、`high`、`max`，生成到代理档案的 `thoughtLevel` 字段。
- 未列出的角色沿用插件默认空路由。把角色槽位设为空数组即可停用该角色。

## CLI 命令

| 命令 | 用途 |
| --- | --- |
| `troupe init [--from DIR]` | 创建配置或显式导入指定旧技能的模型绑定 |
| `troupe doctor` | 本地检查配置和代理一致性；不声称远程模型可用 |
| `troupe list` | 列出五岗及路由 |
| `troupe route ROLE [--json]` | 输出一个角色的完整回退顺序 |
| `troupe pick ROLE [--json]` | 输出当前首选代理 |
| `troupe sync` | 生成代理，只清理由新清单登记的过期生成物 |
| `troupe sync --migrate-legacy` | 备份后移除旧十岗代理并生成新角色 |
| `troupe workflow list [--json]` | 列出可选工作流模板 |
| `troupe workflow show ID [--json]` | 查看一个工作流及其步骤依赖 |
| `troupe workflow plan ID [--json]` | dry-run 展开批次快照，不执行也不写文件 |
| `troupe panel [--port 8787]` | 启动 localhost 面板，不自动打开浏览器 |
| `panel/start.sh` | 后台启动面板并打开系统浏览器；可用 `TROUPE_PANEL_PORT` 指定端口 |

所有命令支持 `--config`；读取配置时支持 `--project` 和 `--no-project`。`sync`/`doctor` 支持 `--agents-dir`，便于隔离测试。

## 面板

```bash
node bin/troupe.mjs panel
```

打开终端显示的 `http://127.0.0.1:<port>`。桌面入口可直接调用插件内的 `panel/start.sh`，它会确认面板就绪后打开系统浏览器；启动器需要 Bash、Node、curl 和系统打开器（Linux 的 `xdg-open` 或 macOS 的 `open`），也可用 `TROUPE_OPEN` 指定打开器。测试时可设置 `TROUPE_NODE`、`TROUPE_OPEN` 和 `TROUPE_PANEL_LOG`，不会启动可见浏览器。面板可以调整角色槽位、顺序、思考档位并重新生成代理。它只写用户配置，不读取项目覆盖，不调用远程模型，不写质量账本。agent 启动面板时应使用后台进程。

## 默认工程实践

- 小改动由主控直接完成；独立实现块才派 executor。
- 高风险改动可调用一个 reviewer；不存在固定双审或独立裁决文书。
- 测试应与变更风险相称，报告真实运行结果，不用删减断言制造通过。
- 产品方向、额外费用、凭据、破坏性操作和对外发布仍需要用户决定。
- 未解决事项进入项目已有的 issue 或待办，不维护平行账本。

## 开发验证

以下命令只在完整源码工作区执行；按白名单生成的 GitHub 分发仓库不包含 `test/` 或 `scripts/validate-plugin.mjs`，因此分发检出不应运行这两条开发命令。

```bash
npm test
npm run verify
```

测试使用 Node 内置测试运行器，覆盖配置与显式旧技能导入、路由、生成器、工作流、CLI、面板、启动器和打包清单，无第三方依赖。分发时只打包 `package.json.files` 白名单中的运行资源，并额外提供根级 `marketplace.json` 供 GitHub 市场发现。
