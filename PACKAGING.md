# 分享打包指南（ai-dev-org · v2.1.0 批5 立）

把本技能打包给他人/他机使用时的净化边界与流程。目标：**随包零个人/本机事实**
（账号 uuid、个人路径、本机订阅实值），宿主版本耦合事实随包但单源成册（references/10）。

## 1 打包

```
node scripts/package-skill.mjs --out <空输出目录>
```

- 导出面=**git 索引面**（checkout-index；工作树非净=拒绝打包 exit 3——打包基线必须
  是已提交态，此检查同时排除未提交改动与未追踪件）；输出目录非空=拒绝覆盖，
  **且不得位于技能仓内**（导出副本污染工作树——跨盘符仓外目录合法，回炉轮2）。导出后另有三件
  在位断言（本机件/账本目录/派发流水——枚举式护栏，非结构保证）。
- 天然不随包（gitignore 运行产物/本机件，导出后另有在位断言）：
  `org-config.local.json`（本机个人事实层——providers/projects/vision_channels/
  agent_bindings 实值）、`.zcode/`（账本/干涸窗标记）、`scripts/model-routing-log.jsonl`
  （派发流水）、`.git/`。
- **分享面门禁**（零命中才出包，命中=exit 1 保留目录供排查——勿提交、排查后删除）：
  ①uuid 形态（36 字符全形+裸 8-hex 前缀词表兜底）；②盘符绝对路径（正/反斜杠形态；
  正则转义族如 `FINDINGS:\s*` 不误伤——已知残留：目录段首字符为转义字母**且次字符
  非字母数字**的形态（单字母目录/下划线/连字符开头段），正反斜杠同律）；③本机标识
  （org-config 本机件 entry_name+uuid_prefix+绑定值——绑定串不剔家族名；供应商家族名
  按整词等值剔除，08 §1 判例）。**文件名通道同扫**（文件名含个人事实同等拦截）。
  本机件未就位时③维词表为空=降级两维并在结语如实声明（不冒充三维）。
  白名单=`scripts/share-whitelist.json`（行级豁免，逐条理由+至少一个定位条件；
  零条件/缺理由/拼错键=装载侧拒收 fail-closed；注册件 contains/reason 自检禁真实
  标识；自检合成样例须 synthetic_exempt 声明）。
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
