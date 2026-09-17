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
- 本仓克隆到 `~/.zcode/skills/ai-dev-org`（克隆形态而非 zip 解压——hook/remote
  两项检查依赖 git 仓；zip 形态 deploy-check 对应项降级 [warn] 跳过）。

## 1 一键自检

```
node scripts/deploy-check.mjs
```

七项逐条（node-major/skill-files/org-config/agents/hook/remote/ledger-dir），
每行 `[ok]`/`[warn]`/`[FAIL] 主题——处置指引`；汇总行给出
可部署/处置后复跑/阻断 终判。任一 FAIL=exit 1（warn 不阻断）。

## 2 首装

```
node scripts/deploy-check.mjs --install
```

仅两动作：补 `~/.zcode/agents/ops-*` 六代理（templates/agents/ 单源复制，
逐件 sha256 复核；已存在漂移件**不覆盖**——保护本机定制）+ 提交钩子
（`git config core.hooksPath .githooks`，已设含自定义值时不重复设置）。
不碰供应商配置。完成后自动复跑七项并按同口径退出。

## 3 供应商对齐（用户裁决面）

org-config providers 双校验不符（deploy-check ③ FAIL 或 validate 输出
alias/期望/实际三元组）时：按三元组改 `org-config.default.json`，或建项目
覆盖件 `.zcode/org-config.json` 深合并覆盖（推荐——默认件保持仓库基线）。
宿主 config（key/端点事实）**永不改、不入库**。

## 4 新会话验证

代理档案=**会话启动快照**（06 §6 补遗，无热加载）——装完须开新会话生效。
随后跑：

```
node scripts/regression.mjs        # 自包含 8 项
node scripts/log-triage.mjs --health
```

## 5 门禁自证

提交钩子=strict 三快扫（check-hardcode --strict+check-anchors+org-config
validate）。自证法（变异红证同款，文件备份法还原）：临时向任一 .md 正文
注入一处 live 事实（如端点字面量），`sh .githooks/pre-commit` 应 exit 1
阻断；还原后复跑应 exit 0。

## 6 回填义务

新机首场战役按 references/05 移植后做压力场景复测，结果回填 CHANGELOG
对应条目（版本与状态节指针同源——SKILL.md 不内联版本面）。
