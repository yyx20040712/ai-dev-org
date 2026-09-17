# 外部评审清偿战役计划 v1（evolve 批，2026-09-16）

## 0. 立案五问

1. **为何立项**：技能经受一次外部全面评审（双异源探查+人工复核），确认 6 项代码级
   缺陷（含 1 项代码-声明直接矛盾）+ 若干文档计数腐化，其中多项未在残留册登记。
   按本技能自身宪法（04·ORG 系：技能自身事故须登记；「静默消失=违规」），须清偿。
2. **目标**：修复全部已确认缺陷；未修项全部登记残留册（含承接批次）；走完整组织
   流程（计划双源对抗审→终裁→分批实施→门一→门二实证→终审→收口）。
3. **DoD**：regression 全绿（R1 仍 SKIP 配给保护）+ 门禁三扫零命中 +
   health-scan RED=0（WARN 不劣于基线 2）+ 新增自检向量全过 + 分笔 commit +
   RESIDUALS/CHANGELOG/账本 v2 闭环。
4. **风险**：①check-anchors 扩面可能暴露未知断锚（预案：≤5 处随批修，超限回炉）；
   ②Node 25 宿主（受禁主版本，mock 路径有 v1.6 全绿先例，本战役零外部派发）；
   ③传输层重写引入回归（预案：镜像 ds-call-v2 v2.2.1 已实证模式+自检向量）。
5. **验收方式**：门二实证岗独立重跑全部门禁+新自检，裁决岗复算关键数字。

## 1. 基线数字（2026-09-16 立案时点，git @ fe19260，工作区干净）

- regression：7/7 过（R1 SKIP）；check-hardcode：命中 0（白名单豁免 33）；
  check-anchors：WARN×0/FAIL×0；health-scan：RED×0/WARN×2（ok缺usage×1、
  in=0而out>0×4——均为存量已知项）；cfg_hash=`a26f710a540d`；node v25.2.1。

## 2. findings→批次映射

| 批 | 类型 | 内容 | 严重级 |
|---|---|---|---|
| b1 | 实现 | glm-look.mjs 传输层对齐：global fetch→node:http(s) 直连（镜像 ds-call-v2 v2.2.1 模式），AbortSignal.timeout 唯一超时源，res.on('error') 补挂；undici headersTimeout≈300s 隐形截断面消除 | H1 |
| b2 | 实现 | ds-call-v2.mjs 退出码分类：类型化错误（exitCode 属性）替换消息正则启发式；兜底仅认属性，未知=exit 1 | H3 |
| b3 | 实现 | log-triage.mjs 时间窗：--date 严格校验（YYYY-MM-DD，非法=exit 1 用法错）；窗口 epoch 化与 --hours 同路径 | M1 |
| b4 | 实现 | org-config.mjs validateProviders 近邻提示 + check-hardcode.mjs deriveHostModelTerms 的 provider null 守卫 | M3 |
| b5 | 实现 | regression.mjs 超时看护：R2b/R5/R8 spawnSync 加 timeout+killAfter；R1 超时按链长推导（见预裁决 P-2） | H2 |
| b6 | 实现 | ds-call-v2.mjs sys_prompt_file 包含性校验（resolve 后必须仍在技能根内，越界=exit 3） | 安全 |
| b7 | 实现 | check-anchors.mjs 扩条目型引用（NN·XN：01 的 A~E 组条目、04 的 WP/SY/MG/ORG 四系）+ 支持 10+ 号文档；修 01·E2 行"02·C2"断锚（见预裁决 P-4） | 高 |
| b8 | 文档 | 计数/清单腐化清偿：SKILL.md"三类告警"去数字指针化；06 §5 R1~R6 清单指针化；01:166 补遣→补遗；04 头注计数指针化（golden 单源）；SKILL.md 加载地图"六段"补第 7 项措辞；skill-gc.mjs 头注退出码 2→1 同步 | 中 |
| b9 | 登记 | RESIDUALS 新登记未修项（M4 硬编码残留×4、M6 runId 并发、M5 回归环境耦合、L3/L4/L5/L9、结构项四件：岗位三表收敛/术语速查/补丁式写作收敛/02 §8 指针化升批）+ 本批修复对应登记行；CHANGELOG v1.7；SKILL.md 修订记；账本 v2 行 | — |

## 3. 白名单（三态）

- **新建**：scripts/audits/2026-09-16_evolve-*.md（批档/简报/审出件）
- **修改**：scripts/{glm-look,ds-call-v2,log-triage,org-config,check-hardcode,regression,check-anchors,skill-gc}.mjs；SKILL.md；references/{01,02,04,06}-*.md；RESIDUALS.md；CHANGELOG.md；.zcode/org-ledger.jsonl（仅追加）
- **禁改**：references/{03,05,07,08,09}-*.md；scripts/roles/**（含 .golden）；org-config.default.json；scripts/.golden/**；templates/**；scripts/model-routing-log.jsonl；全部历史审计档；.git*

## 4. 预裁决（执行者不再自裁）

- **P-1**：b2 删除消息正则兜底（不可证伪）；已知配置类 throw 点全改类型化错误；
  未知异常一律 exit 1（保守）。
- **P-2**：b5 R1 timeout=按链长推导的合法最坏值（attempts×20min+退避），上限
  120min；超上限时取 120min 并在报告注明「真实派发窗口下挂起风险由 --r1
  显式触发者承担」。防误杀优先于防挂起。
- **P-3**：b7 条目登记表从目标文件正文解析（01/04 的条目标记实读），不从 golden
  计数反推；扫描扩展保持 WARN 级（试点校准期口径不变）。
- **P-4**：「02·C2」断锚修复=删除该括注引用（内容即 01·C2 本条，自指无意义），
  其余实证锚点不动。
- **P-5**：计数修复一律「去数字+指针化」，不在正文落新数字（A3：正文落数字
  必腐化）。
- **P-6**：行为变化显式申报面=仅 log-triage --date 非法值（静默全量→exit 1），
  入 CHANGELOG；其余批次均为内部质量修复，外部契约（CLI/退出码总表/schema/
  golden）零变化。

## assumptions:（对抗位逐条拷问，verdict=证伪/未证伪+依据）

1. 六项代码修复均不改变外部契约（见 P-6 申报面），均为内部质量修复。
2. Node 25.2.1 下 mock 路径回归可复现 v1.6 全绿（基线实测 7/7 支持）；本战役
   零真实外部派发（全走会话内绑定岗），不触碰配给。
3. check-anchors 扩面后现存语料断锚仅 01·E2→"02·C2" 一处（探查抽样结论）；
   实扫若暴露更多：≤5 处随批修，超限登记回炉。
4. 结构性大手术（岗位三表收敛/术语速查/补丁式写作收敛/02 §8 指针化）本战役
   **不实施**、只登记+立承接批次——范围判断，防一次战役双线作战。请拷问此边界。
5. 探查报告的行号/事实在派发时仍准确（git clean 支持）；实现者以实读为准，
   行号漂移不构成偏差。
6. 用户指令「按照工业级标准全流程自我进化」授权范围=修复已确认缺陷+登记未修项
   +完整组织流程含分笔 commit（不 push）；不含结构重构与真实外部派发。

## 5. 流程与烤验映射

计划（本件）=文档批→轻量双审（ops-gate1-k1 源A + ops-gate1-k2 源B，异构）
→裁决岗终裁（ops-adjudicator）→b1-b7/b8 分批实现（ops-executor，六段简报+
TDD 红→绿→变异红证+真退出码落盘+分笔 commit）→全量 diff 门一隔离审
（ops-gate1-k1，自包含审包）→门二实证（ops-probe 重跑矩阵）→终审
（ops-adjudicator）→收口（health-scan RED=0+账本+残留册+CHANGELOG+呈报包）。
实现者=GLM 系（会话内绑定），门一/双审=kimi 系/zipoo 系——异构成立。
