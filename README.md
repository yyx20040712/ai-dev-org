# DevTroupe 开发剧团

DevTroupe 是基于一系列工程约束提高工程交付质量的轻量软件开发协作插件。它提供调研、规划、实现、评审和视觉五类角色，使用结构化结果传递事实、改动和验证状态，自动验证并支持可组装工作流。

插件通过唯一的 `/dev-troupe` 命令接收任务。主控可以直接完成小改动，也可以按任务需要调用角色；交付以代码、测试、最终 diff 和真实检查结果为依据。

适用于以下任务：

- 修复缺陷、实现边界清楚的功能或进行局部重构；
- 检索代码与资料、比较技术方案、规划跨模块改动；
- 评审高风险逻辑、安全或数据迁移改动；
- 根据真实渲染图检查页面、文档或其他视觉结果；
- 为复杂任务选择工作流模板，并维护必要的任务快照。

## 安装与首次配置

### 环境要求

- ZCode；
- Node.js 20 或更新版本。

插件不包含个人模型配置或凭据。API key、token、密码等秘密信息应继续由宿主或环境变量管理，不得写入插件配置。

### 本地开发市场

开发源码的上一级目录包含 `marketplace.json`，可作为本地测试市场根目录：

1. 在 ZCode 打开 **插件市场 → 添加 → 添加插件市场**，选择该根目录。
2. 在 **个人 → dev-troupe-workspace** 中找到 **DevTroupe 开发剧团** 并安装。
3. 新建任务，在斜杠命令面板中调用 `/dev-troupe`，并附上开发任务。

### GitHub 分发市场

分发仓库根目录提供 `marketplace.json`，可直接作为市场添加。添加该仓库后，在 **个人 → dev-troupe** 中安装或更新 **DevTroupe 开发剧团**。`dev-troupe` 是分发市场名，`dev-troupe-workspace` 用于本地开发。

源码、市场目录和安装后的副本位于不同位置。修改源码后，需要刷新市场并更新插件；安装副本不会在原会话中热加载。

### 初始化模型路由

以下 CLI 示例在插件根目录执行。安装副本中的实际 CLI 路径由 `/dev-troupe` 命令通过 ZCode 动态 shell 解析。

```bash
node bin/troupe.mjs init
# 编辑配置，填入真实模型槽位和角色路由
node bin/troupe.mjs sync
node bin/troupe.mjs doctor
```

`init` 创建空配置，不覆盖已有配置。配置格式见下文，也可以参考 `config/example.json`。`sync` 根据配置生成或更新本机代理档案；宿主在会话启动时加载这些档案，因此同步后应新建会话。

用户配置默认位于：

```text
${XDG_CONFIG_HOME:-~/.config}/dev-troupe/config.json
```

可用 `TROUPE_CONFIG` 环境变量或 `--config` 参数指定其他位置。项目可选覆盖文件为 `.zcode/dev-troupe.json`，只用于非秘密路由覆盖。

`sync` 覆盖或移除本插件管理的代理前会备份原文件。默认备份位于 `~/.zcode/archive/troupe-agents-<时间戳>-<进程号>/`，也可用 `--backup-dir` 指定目录。清理范围仅限生成清单登记且符合当前命名规则的代理。

## 使用 `/dev-troupe`

在 ZCode 中输入命令和具体任务，例如：

```text
/dev-troupe 修复配置校验中的错误，并补充相关测试
/dev-troupe 调研这个项目的缓存实现，给出有来源的结论
/dev-troupe 实现这个页面改动，并根据真实截图检查视觉结果
```

命令通过 `$ARGUMENTS` 接收开发目标、问题或任务描述。没有提供任务时，主控会先询问具体目标。

命令开始时会解析安装后的 CLI 绝对路径并运行本地 `doctor` 检查。`doctor` 检查配置和代理生成物是否一致，不调用远程模型，也不证明远程模型可用。

主控根据任务读取项目约定、相关文档和代码，直接实现或调用所需角色，随后运行与变更风险相称的检查并查看最终 diff。失败、未运行的检查和未解决事项应按实际状态报告。

## 角色、结构化结果与可选工作流

### 五类角色

| 角色 | 职责 | 典型使用场景 |
| --- | --- | --- |
| `research` | 检索代码或资料，区分事实、来源、推断和不确定项 | 缺少必要事实，需要独立检索或小实验 |
| `planner` | 比较方案，给出实施顺序、影响文件、验证方式和风险 | 跨模块改动、方案取舍或高风险路线 |
| `executor` | 在明确范围内实现、测试并报告实际结果 | 独立且边界清楚的实现块 |
| `reviewer` | 独立检查正确性、回归风险和验证缺口 | 高风险逻辑、安全、数据迁移或争议结论 |
| `vision` | 根据实际查看的渲染图检查视觉结果 | 已有截图或渲染图，需要视觉验收 |

角色是否可用取决于模型路由配置。可用 `list`、`route` 和 `pick` 查看配置及当前首选代理。

### 结构化结果

每个角色先返回简洁可读正文，再在末尾附且仅附一个角色专属 JSON 代码块。契约包含该角色所需的全部字段，用于传递事实、建议、改动、检查、发现和未解决事项。

- 调研结果区分事实与推断，并列出来源和不确定项；
- 规划结果包含推荐方案、步骤、影响文件、验证方式和风险；
- 实现结果列出变更文件、实际检查、失败和未解决事项；
- 评审与视觉结果包含状态、具体发现和实际检查；
- 未运行的检查不得标为通过，视觉判断必须对应实际查看的图像。

字段定义位于 `src/roles.mjs`，通用结果要求位于 `templates/agents/result.md`。结构化结果供主控和后续步骤使用，不会自行触发执行、返工或状态变更。

### 可选工作流

`workflows/` 提供三个模板：

| ID | 用途 |
| --- | --- |
| `quick-fix` | 目标和范围明确的小改动，由主控直接实现并验证 |
| `feature` | 按任务不确定性组合调研、规划、实现和可选评审 |
| `visual-change` | 实现视觉改动、生成真实渲染图并进行视觉验收 |

在插件根目录执行：

```bash
node bin/troupe.mjs workflow list
node bin/troupe.mjs workflow show feature
node bin/troupe.mjs workflow plan feature --json
```

`workflow plan` 校验角色、步骤和依赖，按稳定拓扑顺序输出批次计划。它是 dry-run：不调用 Agent，不写文件。

多批任务可由主控按需把输出保存为项目 `.zcode/dev-troupe.batch.json`，并根据真实结果维护 `pending/active/done/blocked/skipped` 状态和批次 `result`。快照不会自动创建或推进。恢复任务时仍需核对实际代码、测试和 git diff；视觉任务还需核对真实图像。

## 活文档与过程文档

插件处理项目文档时，用户可见的基本行为如下：

- 启动时读取 `AGENTS.md`、README 的相关部分，并按任务读取架构文档和有效决策记录；只有研究历史时才读取归档材料。
- 行为或工程约束变化时，在同一批修改中更新受影响的活文档章节。项目已有文档结构优先，不自动创建整套文档。
- 只修改测试内部实现且没有外部行为变化时，不要求创建文档。
- 用户修改的活文档代表最新设计意图，代码和测试代表现有实现。两者冲突时会明确报告，不静默覆盖任何一边。
- 多阶段、跨会话或结果需要复用时，才创建过程文档；短结果直接放在回复中。
- 过程材料按需保存在 `.zcode/dev-troupe/<task>/`。任务完成后，只归档本次创建且需要保留的材料，不整理其他历史文件。

具体读取、写入和归档规则由 `commands/dev-troupe.md` 定义。

## 配置结构、CLI 与面板

### 配置结构

```json
{
  "schemaVersion": 1,
  "slots": {
    "primary": {
      "model": "your-provider-id/your-model-id",
      "multimodal": true,
      "label": "Primary model"
    },
    "alternate": {
      "model": "another-provider-id/another-model-id",
      "multimodal": false,
      "label": "Alternate model"
    }
  },
  "roles": {
    "research": { "level": "high", "slots": ["primary", "alternate"] },
    "planner": { "level": "max", "slots": ["primary", "alternate"] },
    "executor": { "level": "high", "slots": ["alternate", "primary"] },
    "reviewer": { "level": "max", "slots": ["primary"] },
    "vision": { "level": "max", "slots": ["primary"] }
  }
}
```

- `slots` 定义可复用的 `provider/model` 绑定；`label` 是可选显示名。
- 角色的 `slots` 数组顺序就是回退顺序，首项是首选；空数组表示停用该角色。
- `level` 可选值为 `low`、`high`、`max`，写入生成代理档案的 `thoughtLevel` 字段。
- `vision` 只能使用 `multimodal: true` 的槽位；其他角色可使用普通文本模型槽位。
- 未列出的角色沿用插件默认空路由。默认配置、用户配置和项目覆盖按层合并，项目覆盖可用 `--no-project` 关闭。
- 配置会拒绝名称匹配 `api[_-]?key`、`secret`、`password`、`authorization` 或 `access[_-]?token` 的字段（不区分大小写）。

### CLI 命令

下表中的 `troupe` 对应 `node bin/troupe.mjs`；在已安装插件中，使用 `/dev-troupe` 输出的 CLI 绝对路径。

| 命令 | 用途 |
| --- | --- |
| `troupe init [--json]` | 创建空用户配置；已有配置不覆盖 |
| `troupe doctor [--json]` | 本地检查配置和代理一致性，不调用远程模型 |
| `troupe list [--json]` | 列出五类角色及其模型顺序 |
| `troupe route ROLE [--json]` | 输出一个角色的完整回退顺序 |
| `troupe pick ROLE [--json]` | 输出当前首选代理 |
| `troupe sync [--json]` | 生成或更新代理，备份被覆盖或移除的受管文件 |
| `troupe workflow list [--json]` | 列出可选工作流模板 |
| `troupe workflow show ID [--json]` | 查看一个工作流及其步骤依赖 |
| `troupe workflow plan ID [--json]` | dry-run 输出批次计划，不执行也不写文件 |
| `troupe panel [--port PORT]` | 启动 localhost 配置面板，不自动打开浏览器 |
| `troupe --version` | 输出插件版本 |
| `troupe --help` | 显示命令帮助 |

通用参数：

- `--config FILE`：指定用户配置文件；
- `--project DIR`：读取指定目录的 `.zcode/dev-troupe.json`；
- `--no-project`：不读取项目覆盖；
- `--agents-dir DIR`：为 `doctor`、`sync` 或 `panel` 指定代理目录；
- `--backup-dir DIR`：为 `sync` 指定覆盖备份目录。

### 配置面板

```bash
node bin/troupe.mjs panel
```

打开终端显示的 `http://127.0.0.1:<port>`，默认端口为 8787。面板统一为一套科技风软件工程工作台：顶部是 DevTroupe 艺术字与中文说明，左侧以现代电脑显示屏呈现调研、规划、实现、评审和视觉五岗的真实工作内容，模型配置作为独立终点展示槽位与本地配置。旧的 `/?design=editorial|instrument|blueprint` 地址和启动参数继续可用，但都进入同一界面，不再产生三种视觉风格。

左侧时间轴分为岗位动画和岗位间的发送过场，代码使用语法着色。滚轮向下正放、向上倒放当前岗位的工作过程；一旦进入交接，就会自动连续播放完整过场，不停留在中间帧。正放交接停在下一岗位起点，倒放停在上一岗位完成帧，不会自动加速播放下一岗位的工作动画。过场使屏幕其余内容失焦，两端显示带动效的岗位机器人和中文名称，中间为水平箭头、写有 handoff 的开合信封，以及位于上方且不遮挡信封的三个跳动点。点击右侧岗位则从当前播放位置加速播放沿路的完整岗位与交互动画，反向选择会加速倒放。点击当前岗可重播本岗，方向键、上一岗位、下一岗位、Home 和 End 仍可用于导航。减少动态效果偏好下取消逐字、扫光、跳动和飞行动画，保留即时状态切换。

右侧采用类似文档导航窗格的双栏同显结构：窄栏使用竖排岗位名称负责选岗，宽栏始终显示当前岗位模型列表，选岗时两侧内容同步翻页。模型选项使用有顶面与侧壁的键帽层次。拖动路由手柄并在列表内松手可调整首选与回退顺序；只有拖入拖动时出现的底部独立灰色区域才会移除，拖到普通末位不会误删。界面不提供上移、下移、移除按钮；手柄聚焦后仍可用方向键排序、Delete 移除。操作步骤、路由细节、配置路径和同步说明统一收纳在右上角问号面板中，可再次点击或按 Esc 收起。配置写入只针对用户配置，不读取项目覆盖；视觉岗只列出多模态候选。重新生成代理会写入代理目录中的代理档案和 `.dev-troupe.json` 生成清单，并在覆盖或移除受管代理前备份原文件。同步结果显示 generated、written、removed 数量；同步后需新建会话。动画播放不会写配置，面板不调用远程模型，也不展示批次状态。由 agent 启动面板时应使用后台进程。

桌面入口可调用插件内的 `panel/start.sh`（Linux/macOS，或已具备 Bash 环境的 Windows）或 `panel/start.bat`（Windows 原生，无需 Bash）。启动器在后台启动面板、确认页面就绪后打开系统浏览器；已有服务会复用。无参数时保持原端口行为。以下旧风格参数仅为兼容既有快捷方式保留，各参数对应的 URL 不同，但页面视觉与行为一致：

```bash
panel/start.sh --design editorial
panel/start.sh --design instrument
panel/start.sh --design blueprint
TROUPE_PANEL_DESIGN=instrument panel/start.sh
```

`--design` 优先于 `TROUPE_PANEL_DESIGN`，无效风格或参数会明确失败。`start.sh` 需要 Bash、Node、curl、grep、nohup，以及 Linux 的 `xdg-open` 或 macOS 的 `open`。可用 `TROUPE_PANEL_PORT` 指定端口，用 `TROUPE_OPEN` 指定打开器。测试时还可设置 `TROUPE_NODE` 和 `TROUPE_PANEL_LOG`。源码工作区的 editorial、instrument、blueprint 三个旧桌面快捷方式仍只指向当前工作区启动器，最终都打开同一个工作台。

Windows 启动器 `panel/start.bat` 行为与 `start.sh` 一致：已有服务直接复用，未运行则最小化拉起并等待就绪，再打开默认浏览器；日志写入 `%TEMP%\dev-troupe-panel.log`。可选参数为端口号（默认 8787）。CLI 解析先取随包 `bin/troupe.mjs`（解压即可运行，无需安装插件），未找到时取 `%USERPROFILE%\.zcode\cli\plugins\cache` 下各市场中已安装的最高版本。启动器只依赖 Node 与 Windows 10+ 自带的 curl；自动化测试可设置 `DT_PANEL_NOBROWSER=1` 只拉起服务不打开浏览器。

## 开发验证

以下命令只在完整源码工作区的插件根目录执行：

```bash
npm test
npm run verify
npm pack --dry-run
```

`npm test` 使用 Node 内置测试运行器，覆盖配置、路由、代理生成、工作流、CLI、面板、启动器和打包清单，无第三方依赖。`npm run verify` 运行测试和 `scripts/validate-plugin.mjs`，检查 manifest、运行资源和市场条目。

本机具备 Chromium 或 Chrome 时可另运行 `npm run test:panel-browser`；该开发检查脚本使用全局 `WebSocket`，需要 Node 22+，插件本身的运行要求仍为 Node 20+。它用 headless Chromium 经 CDP 验证单一工作台的真实页面及写入行为，不经过 WebDriver，也不占用系统 Firefox 的实例与用户配置。检查包含双栏同显、竖排导航、问号帮助、滚轮正放/倒放、连续信封开合与直线交接、元素无遮挡、跨岗加速完整路径、真实拖拽、键盘等价操作、独立删除区、减少动态效果、桌面单视口、移动端边界和各状态截图。该检查使用临时配置和临时代理目录，不属于默认 `npm test`，没有浏览器的 CI 不会因此失败。可用 `npm run test:panel-browser -- --output DIR` 保存桌面、移动端和暗色截图。

浏览器二进制按顺序解析：`CHROME` 或 `CHROMIUM` 环境变量 → `PLAYWRIGHT_BROWSERS_PATH` 与 `~/.cache/ms-playwright` 下的 Playwright Chromium → `PATH` 中的 `chromium`、`chromium-browser`、`google-chrome`。脚本以独立进程组启动自己的浏览器，结束时连同渲染子进程一并终止并删除临时 profile，不会有实例残留在后台。已有独立 CDP 端点时，可设置 `TROUPE_PANEL_CDP_URL`（例如 `http://127.0.0.1:9222`）复用该浏览器；脚本新建自己的标签页，只关闭该标签页，不终止外部浏览器。

`npm pack --dry-run` 检查实际打包白名单。运行包包含 `templates/agents/result.md` 等运行资源，不包含 `test/`、`scripts/` 或开发脚本。按白名单生成的 GitHub 分发仓库不包含这些开发资源，因此分发检出不应运行源码测试和验证脚本。
