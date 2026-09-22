# 分享打包指南（ai-dev-org · v2.1.0 批5 立）

把本技能打包给他人/他机使用时的净化边界与流程。目标：**随包零个人/本机事实**
（账号 uuid、个人路径、本机订阅实值），宿主版本耦合事实随包但单源成册（references/10）。

## 1 打包

```
node scripts/package-skill.mjs --out <空输出目录>
```

- 导出面=**git 跟踪面**（checkout-index）：工作树非净（未提交改动）=拒绝打包
  exit 3——打包基线必须是已提交态；输出目录非空=拒绝覆盖。
- 天然不随包（gitignore 运行产物/本机件，导出后另有在位断言）：
  `org-config.local.json`（本机个人事实层——providers/projects/vision_channels/
  agent_bindings 实值）、`.zcode/`（账本/干涸窗标记）、`scripts/model-routing-log.jsonl`
  （派发流水）、`.git/`。
- **分享面门禁**（零命中才出包，命中=exit 1 保留目录供排查）：
  ①uuid 形态（8-4-4-4-12 hex）；②盘符绝对路径（正/反斜杠形态——正则转义族
  如 `FINDINGS:\s*` 不误伤）；③本机标识（org-config 本机件 entry_name+绑定值，
  剔除供应商家族名——分工链描述属安排性提及，08 §1 判例）。
  白名单=`scripts/share-whitelist.json`（行级豁免，逐条理由——历史批档指针类；
  自检 fixture 合成样例豁免在册；白名单注册件自身=代码级 skip 防自咬）。
- 产出含 `MANIFEST.txt`（逐文件 sha256+基线 git 哈希——生成物，09 §1 语义）。
- **有意形态（非缺陷，勿"修"）**：`org-config.default.json` 的 `TODO` 占位与
  `templates/agents/*.md` 的 `{{binding:岗}}` 占位——受赠机填自己的实值。

## 2 受赠机首跑

1. 解包/克隆到 `~/.zcode/skills/ai-dev-org`；
2. 按 `DEPLOY.md` §0 前置（受支持 Node 系——受禁面见 references/10 §1）；
3. `node scripts/deploy-check.mjs --install`——脚手架 `org-config.local.json`
   （默认件占位全量复制），随后手工填：`providers`（uuid_prefix=宿主供应商注册表
   条目 id 前 8 字符/entry_name=条目名）、`vision_channels`、`agent_bindings`
   （绑定岗模板渲染实值——`{{binding:岗}}` 对应填法）；指引=DEPLOY.md §3；
4. 复跑 `node scripts/deploy-check.mjs` 全绿（可部署）；
5. **新会话**验证（代理档案=会话启动快照，references/10 §2）：
   `node scripts/regression.mjs` + `node scripts/log-triage.mjs --health`；
6. 宿主版本差异按 `references/10 §6` 异机重验清单逐条核对。

## 3 边界与裁决位

- 分享包内 references/10（宿主兼容事实）随包分发——通用于同版宿主；异版宿主
  以其 §6 重验清单为准，不视为缺陷。
- 历史修订记中的本机路径/供应商事件叙述属过程记录（08 §3 禁改写），分享面
  门禁按白名单放行——受赠机视作归档编号即可。
- 打包/分发范围本身=用户裁决面（发给谁、以何种许可）——本件只管技术净化。
