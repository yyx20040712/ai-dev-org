# 新机部署指南（ai-dev-org 技能本体）

新机从零到可派发的六步。可观察形态=`node scripts/deploy-check.mjs` 七项
逐行输出与汇总行（新机首跑即见）；本件零供应商 live 事实（模型名/uuid 值/
端点一律以 org-config 与宿主注册表为准，06 §0）。

## 0 前置

- zcode CLI 已装；Node 用**受支持系**（禁用系见残留册 HOST-node25 退出崩溃面
  ——判据单源=org-config `supported_node.forbid_major`，deploy-check ① 项
  即查此面）。

默认 Node 命中受禁系时的两条路（本机实证形态）：①版本管理器——Volta 系统
可 `volta pin node@24`（改默认）或单次
`volta run --node 24 node scripts/deploy-check.mjs`（本仓参考态即此形态）；
②直接改装受支持主版本。禁用系下 deploy-check ①项=FAIL 属如实告警（已知
退出崩溃面），其余六项照常检查。
- **volta run 退出码掩码**：`volta run --node 24 …`
  会把任意非零退出码掩成 126（实测 exit 1/2/3 经 volta run 均 →126；
  exit 0 正常；裸 node 透传无误）。交互式人工排查用 volta run 无碍；
  **依赖精确退出码的脚本化封装禁经 volta run**（如 exhaust=2 断言、钩子
  对 3/5 的分流——语义单源=references/06 §5.8）——须在受支持 Node
  环境直跑 node（推荐 `volta pin node@24` 固定默认后裸跑）。
- 本仓克隆到 `~/.zcode/skills/ai-dev-org`（克隆形态而非 zip 解压——hook/remote
  两项检查依赖 git 仓；zip 形态 deploy-check 对应项降级 [warn] 跳过）。

## 1 一键自检

```
node scripts/deploy-check.mjs
```

七项逐条（node-major/skill-files/org-config/agents/hook/remote/ledger-dir），
每行 `[ok]`/`[warn]`/`[FAIL] 主题——处置指引`；汇总行给出
可部署/处置后复跑/阻断 终判。任一 FAIL=exit 1（warn 不阻断）。
项目语境：`node scripts/deploy-check.mjs --project <项目根>`——⑦ 改试写项目
账本目录（ledgerPathFor 三层解析）＋⑧ project-gate 以同款命令
`node scripts/verify-docs.mjs`（cwd=项目根）复跑项目门禁（B1 三面同款）。

## 2 首装

```
node scripts/deploy-check.mjs --install
```

四动作：③a **本机件脚手架**——
`org-config.local.json` 缺失时从默认件复制占位全量（note 声明用户配置域；
已存在绝不覆盖），随后按 §3 填实值；④ 补 `~/.zcode/agents/ops-*` 代理
（templates/agents/ 单源复制，逐件 sha256 复核；已存在漂移件**不覆盖**
——保护本机定制）；⑤ 提交钩子（`git config core.hooksPath .githooks`，
已设含自定义值时不重复设置）；③ 宿主事实派生项目覆盖件（g3 批 v1.7.6
——授权形态=仅 --install 显式调用；规则与护栏见 §3）。
不碰供应商默认件与宿主配置。完成后自动复跑七项并按同口径退出。

## 3 供应商对齐（用户裁决面）

org-config 三层：默认件 `org-config.default.json`
（通用/随包，providers 为 TODO 占位）← 本机件 `org-config.local.json`
（个人实值，gitignore）← 项目覆盖件 `.zcode/org-config.json`。

providers 双校验不符或占位拒验（deploy-check ③ FAIL / validate 输出
alias/期望/实际三元组或「尚未本机化」指引）时：**首选填本机件**
`org-config.local.json` 各源实值（uuid_prefix=宿主注册表条目 id 前 8
字符/entry_name=条目名/kind/billing/model_family——deploy-check
--install 动作③a 可脚手架；uuid_prefix 第二形态=账户计划源
`account:<计划名>`，计划名须列入顶层 account_plan_allowlist 本机允许清单，
不走宿主注册表双命中），或建项目覆盖件 `.zcode/org-config.json`
深合并覆盖。宿主 config（key/端点事实）**永不改、不入库**。

自动化路（deploy-check --install 动作③，g3 批 v1.7.6）：从宿主供应商注册表
按 entry_name 找唯一命中，派生各 alias 的 uuid_prefix（宿主条目 id 前 8
字符）写项目覆盖件 `.zcode/org-config.json`（含 note 声明「用户配置域，装后
可自由改写」；`.zcode/` 已 gitignore，机局部不入库）。护栏：覆盖件已存在
**绝不覆盖**；有别名零命中或同名歧义（同 entry_name≥2）时**不写文件**、
打印指引指向本节手工路径（歧义不猜）；全部命中且与默认件完全一致时**不写**
（无冗余件）。派生只读宿主注册表与默认件，写后七项复跑（③ validate 真退出
码即回读面）。

## 4 新会话验证

代理档案=**会话启动快照**（06 §6 补遗，无热加载）——装完须开新会话生效。
随后跑：

```
node scripts/regression.mjs        # 自包含回归（项数以实时输出为准——A3）
node scripts/log-triage.mjs --health
```

## 5 门禁自证

提交钩子=strict 三快扫（check-hardcode --strict+check-anchors+org-config
validate）。自证法（变异红证同款，文件备份法还原）：临时向任一 .md 正文
注入一处 live 事实（如端点字面量），`sh .githooks/pre-commit` 应 exit 1
阻断；还原后复跑应 exit 0。

## 6 回填义务

新机首个项目阶段按 references/05 移植后做压力场景复测，结果回填仓外批档（技能仓零过程件——08 §6 规则 4）
对应条目（版本与状态节指针同源——SKILL.md 不内联版本面）。

## 7 首激活向导

从零到面板可用的完整序（每步判据内联；①-③ 细则=§1-§3）：

1. 一键自检：`node scripts/deploy-check.mjs`——红项按行内指引处置。
2. 首装：`node scripts/deploy-check.mjs --install`——散置脚手架已收编 `org-bootstrap.mjs`（INFRA1 D-3·幂等续配不重初始化；ready 且非显式请求=休眠零写）：本机件最小骨架＋代理部署＋钩子＋宿主事实派生；两态/续配/冻结迁移细目=`node scripts/org-bootstrap.mjs status|guide|resume|freeze`。
3. 供应商对齐（模型绑定·用户裁决面）：按 §3 填 `org-config.local.json` 各源实值
   （uuid_prefix/entry_name/model_family；账户计划源=`account:` 前缀＋allowlist 清单）。
4. 绑定渲染：本机件 `agent_bindings` 按岗填 `<provider>/<model>$<档位>` →
   `node scripts/org-config.mjs validate`（PASS 即过；绑定源一致性由 validateLocalFacts
   核对——计划源绑定值斜杠前段须与 uuid_prefix 全串一致）→
   `node scripts/deploy-check.mjs --sync-agents`（渲染部署面·sha256 回读复核）。
5. 回归与新会话验证：`node scripts/regression.mjs` 全过＋按 §4 开新会话。
6. 前端 UI 部署（面板启动）：`bash panel/start.sh`——环境变量与边界=panel/README.md
   （端口 `ORG_PANEL_PORT`·项目仓卡 `ORG_PANEL_PROJECT`·仅监听 127.0.0.1·随页生灭）。
7. 模型配置日常调整＝面板拖拽：顺序直写本机件 `role_fallbacks`＋`agent_defaults`
   原子双写，validate 不过即回滚；无到期回落、无重置默认。

### 跨技能模组引用检索（技能迁移他机时）

- 引用形态单律：跨技能/跨目录复用本仓模块（如面板动态 import `scripts/org-config.mjs`）
  一律**由脚本自身位置推导根路径**（`path.resolve(dirname(fileURLToPath(import.meta.url)), …)`），
  禁绝对路径硬编码——新机路径不同即断链。
- 取配置装载器：`import(pathToFileURL(join(SKILL_ROOT, 'scripts', 'org-config.mjs')).href)`
  后取 `loadOrgConfig(SKILL_ROOT)`（isMain 守卫零副作用，import 不触发 CLI）。
- 检索入口：本技能模块清单=SKILL.md「派发与自检」段命令表；约束卡检索=
  `node scripts/constraint-index.mjs query --task <动词> --role <岗> --path <文件>`
  （路由先读序）；技能目录盘点=`node scripts/skill-gc.mjs`（默认干跑只读）。
