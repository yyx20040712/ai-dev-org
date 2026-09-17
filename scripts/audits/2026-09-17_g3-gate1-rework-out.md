# 门一回炉复审报告（g3 批 r1，ops-gate1-k1 源A）

> 审包=2026-09-17_g3-rework-for-gate1.md（唯一输入，未触包外文件）。行号=deploy-check.mjs 当前新件行号（hunk 偏移推算，标「约」）。

## 一、五项 ADDRESSED 逐项核对

- R1=W2 **ADDRESSED 成立**：三处证据闭环——①installHostFacts 写盘段自包 try/catch（约 :231-241），IO/回读抛错返回 FAIL 带真因；②调用方三源分行归因（约 :446-463）：loadOrgConfig 失败→「org-config 装载失败」warn、readHostConfig 失败→「宿主配置装载失败」warn、installHostFacts 返回值直传——「写盘错被笼统误标+warn 降级 exit 0」两缺陷均消除；③FAIL 计数入阻断（installFailCount→exitCodeFrom+汇总行注记）。红证（向量先行对旧结构红）与变异红证（还原旧笼统 catch 后坏覆盖件被误标=W2 形态实录）均在 §2，TDD 序合规。新 IO 注入向量（父级为文件→mkdir 必抛）为真断言非摆设（我重算）。
- R2=W3 **ADDRESSED 成立（含对首轮前提的诚实修正）**：红证显示首轮「裸崩堆栈」判语不准——坏覆盖件实际被更早的主 cfg 守卫干净接住（[装载错] exit 3，三动作整场跳过）。实现者以实录修正前提而非迁就审查者，属实。处置=install 块内 oc 独立 try/catch+主 cfg 守卫后移至 install 块后，坏覆盖件时 ④⑤③ 先执行、③ 打印干净跳过行（主控真机注入绿证逐字在 §2），再按装载错退 3。实质问题已解。
- R3=W1+N4 **ADDRESSED 成立**：勘误一 59→60（分组自加=60 与首轮逐行数一致，且主动交代「②节另有一处 59」）；勘误二承认另删 4 行 const 取值行由 let+try 等价承接。原文按历史件纪律保留+勘误为准。
- R4=N5 **ADDRESSED 成立**：新增两向量（fxOnlyU/fxOnlyA）我逐条重算，断言与行模板逐字对得上；向量数 26→29 与绿证自洽。
- 维持不修 4 项（N1/N2/N3 登记口径同首轮；N6 流水 1551→1596→1626 如实呈报，包外事实未证伪）。

## 二、回炉改动面新破坏扫描（重点=R2 守卫后移副作用面）

已逐项推演：非 install 路径次序不变（主控实测坏覆盖件 exit=3）；用法错优先于装载错（--agents-dir 缺值 exit=1 实录）；installFailCount 非 install 路径恒 0（非 install 终态逐字不变）；写盘后守卫装载读到的是新覆盖件=更 fresh 同向无害；④⑤ 在坏 cfg 下仍执行=独立修复动作不依赖 cfg，已申报；白名单收敛（+54/+8 全落单件，其余六件逐字相同=主控比对）。

### W（新，1 项）

**W1-r1**：`if (hostCfg)` 闸制造 hf 未定义暴露面（回炉新引入）——hf 仅三处赋值；若 readHostConfig() 不抛而返回 falsy（host v2 config 缺席），:462 `if (hf.level==='FAIL')` TypeError 裸崩，恰打 --install 主部署场景，且丢失「不派生：无宿主命中 alias=全列」指引行。关键前提不确定：readJson 缺席文件是抛 ENOENT 还是 return null 包内无源不可裁。处置建议一行：补 else 跳过行或实录 readJson 缺席语义。

### N（新，3 项）

N1-r1：--install 每场双次 loadOrgConfig（纯读无害）。N2-r1：写盘→守卫窗口微缝（毫秒级外部干涉，实际不可达级）。N3-r1：R4 两新向量未钉 hostUnconsumed 段（双同名条目会列重复名——文案面非断言面，g3 首轮既有面）。

## 三、统计与总评

五项处置全部 ADDRESSED 且红/绿/变异证据链完整，守卫后移副作用面逐项推演仅一处新暴露（W1-r1，前提不确定已标明），无 B。总评：回炉合格，建议 W1-r1 以一行 else 兜底或 readJson 语义实录收口（可转残留登记），不阻断本批。

FINDINGS: B=0 W=1 N=3
VERDICT: PASS
MODEL-SELF: model-field:b2466f8b-9d89-4428-a38e-c2aca1c41d0e/k3
