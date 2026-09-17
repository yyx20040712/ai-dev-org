# 门一源B（ops-gate1-k2）对计划 v2 的对抗审查出件（归档副本）

> 派发：2026-09-16，主控；包=evolve-plan-v2 全文+证据摘录+源A审查链上下文。
> 首派静默无输出（5min/0 工具调用）——本件为同包重跑（包升级为 v2）出件。
> 结论：B=3 W=6 N=9，VERDICT=FAIL（不放行，定点回炉）。
> 注：本件为会话转写归档；MODEL-SELF: model-field:5e1abd9d-1f4f-41fb-afa1-ecb5ce76e256/k3
> （与源A同模型键 k3、不同 provider uuid——同族异供应商，已按「同源记欠账」文化入计划注记）

## 〇、审查基础声明

只读核实：SKILL.md、RESIDUALS.md、references/{01,02,06,04 前 60 行}、scripts/{regression,glm-look,ds-call-v2,log-triage,org-config,check-hardcode,check-anchors}.mjs 全文、skill-gc 前 60 行、health-scan 前 40 行、roles/registry.json、.golden/doc-counts.json、templates/org-seg.snippet.md。源A亲验事实逐条独立复核行号全中。

## 一、假设拷问

1. 假设 1（契约变化面=P-6 三项）=**证伪**：M3 族修复可观测差未入 P-6（今日 null provider=TypeError 崩溃 exit 1+栈：org-config:106 near[1].name、check-hardcode:65 p.models、log-triage:38 p.uuid_prefix；修后=校验消息 exit 3）；b3「本地零点」相对现状（:197 默认 UTC 日期）也是行为面移动未申报。
2. 假设 2=未证伪。「两处」未计 b5 的 R1 残留（实为 3 处登记点），不计发现。
3. 假设 3=未证伪。·XN 活实例=01·E2/01·B5/04·SY-1/06·v1.1（免误伤）/02·C2（唯一真断锚）。
4. 假设 4=未证伪（RESIDUALS:40 在册 open）。
5. 假设 5=未证伪（行号全中）。
6. 假设 6=未证伪（四件复写实读属实；skill-gc:20 比"复写"更重=头注与总表直接冲突；但枚举不完整见 B2）。

## 二、§7 吸纳忠实性核对

源A 18 条逐条核对均有落点、无蒸发。走样集中于三处「枚举式修复不完整」（B1/B2/B3）与 P-6 申报缺口（W2）——源A B1 病理在吸收层换形复发。

## 三、findings

- B1｜b5 超时看护清单不完整：regression 共五处 spawnSync（R2b:86/R5:111/**R4:176 无 timeout**/R8:223/R1:253）；b5 只修四处；R4 与 R2b 同风险剖面=同文件半截修复；R10 各向量若经 spawnSync 驱动亦未规定看护——H2 类将在新代码原地复现。
- B2｜b8「四件头注」枚举个案非规则：同型违面至少 4 处——log-triage:18（无指针复写）、regression:13-15（同）、health-scan:15（带指针仍复写语义，且不在修改白名单）、06:91（单源文件 §5 内联复写"exit 3（配置级…）"）；skill-gc:20 头注"2=--apply 未指定"与 §5.8:136/:143 直接冲突。
- B3｜b8「全库扫 .md」与禁改清单硬冲突：templates/org-seg.snippet.md:11「欠账/同源/预算三类告警」命中而 templates/** 禁改；历史审计档同型必中；计划未预裁禁改区命中处置（扩权/登记/豁免三选一）。
- W1｜P-7 与 02 §4 第 7 项落点词表双源（P-7 枚举与 02:82-85 枚举互不包含；R10 回归向量≠「上线后可观察」）；纯文档批第 7 段未定义→简报空转或执行者自裁。
- W2｜P-6 缺 M3 族（假设 1 证伪面）；check-hardcode 修后形态（静默跳过 vs 降级 exit 5）未定。
- W3｜b3 两洞：①正则过而语义非法（2026-13-45）→NaN→静默空窗复活；②「本地零点」依赖文件名时区（包外不可验）——现状 :197 取 UTC 日，若文件名实为 UTC 日界，本地零点反引入偏窗；窗口语义移动未入 P-6。
- W4｜R10 三缺口：①导入安全（glm-look:315 顶格 `process.exitCode=await main()`、ds-call-v2:283 起 CLI 体顶格执行——import 即执行主流程并污染 regression exitCode；须 isMain guard（org-config:124-126 范式）或子进程注入）；②规格分散 b1/b2/b6 无汇总定义/归属/看护；③结构断言对注释形态未钉（头注含 "fetch" 字样易假红假绿）；双通道（glm /v1/messages vs ds /chat/completions 载荷异构）mock 保真度未钉。
- W5｜§6 漏 b9：登记批若在门一后落地，RESIDUALS/CHANGELOG/账本改动逃过隔离审与实证；登记内容是被审 diff 一部分。
- W6｜b4 普查面越出白名单未预裁（health-scan 不在 8 脚本内；命中=停手上报扩权机制，计划未扩权也未声明登记不修）。
- N1｜b7「10+ 号」语义不明（文档号≥10 vs 条目号≥10）；·XN 大小写口径未钉（06·v1.1 免误伤依赖小写 v 排除）；「」跳过规则是否延续未述。
- N2｜P-4 复议：01:96「SY 三屋试点门一 0B/3W/13N（三 W 全真缺陷…）」与 E2 行锚点同事件实录——"02·C2"疑为"01·C2"笔误，改指保链优于删除，提请裁决岗定夺。
- N3｜DoD 措辞相抵：「三扫零命中」vs「WARN 不劣于基线 2」；建议「零新增命中」。
- N4｜b9 粒度：M6 全册无行（应=外部评审新建行）；「结构项新建行」与「修复项 closed 行」对同一件（四头注）可能双建——单行制或两行制须钉。
- N5｜b6 落点两处（ds-call-v2:105 + regression:48，两处同步演进注释自承）；向量须含恰 `..` 与 `..\`、`../` 两边例。
- N6｜源A 与本岗 model key 均=k3——同族异供应商；轻量双审无明文异构要求不升 W，但建议如实注记（同源记欠账文化/health-scan ② 哲学同族）。
- N7｜b1 残留未含「异端点传输语义面」：glm 通道端点（anthropic 形）3xx/gzip 行为与 ds-call-v2 已实证面不同面，「镜像」可迁移性未实证。
- N8｜b8 两分类覆盖不到混合短语（SKILL:90「12 步+任务书六段」兼正确与腐化计数）。
- N9｜b5 两小疵：R1 裕量无推导要求（不对等）；「02 §5 ≤5 行 Minor」系回炉轮条款，正式批适用面错配。

## 四、终裁建议

FAIL，定点回炉（最小集=①B1 补 R4:176+R10 看护；②B2 规则式+log-triage/regression 入列+health-scan 与 06:91 预裁；③B3 预裁禁改区命中处置（建议 org-seg 单件扩权保 R7 指针+历史档豁免登记）；④W2 P-6 扩第四项+假设 1 改写；⑤W5 §6 补 b9 落位；⑥W4① main-guard 预裁；⑦W1 P-7 与 02 §4 单源化；⑧W3 语义校验钉+日界假设入 assumptions）。W6/N 系随批修或登记。

MODEL-SELF: model-field:5e1abd9d-1f4f-41fb-afa1-ecb5ce76e256/k3
FINDINGS: B=3 W=6 N=9 VERDICT=FAIL
