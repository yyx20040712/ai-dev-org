# 门一（源A）全量 diff 初审出件（会话转写归档）

> 归档说明：本件为收口批补档（终审包缺口①⑥）——原出件未独立落档，此处
> 会话转写；补档不早于出件时间，内容以派发回执为准。
> 派发：2026-09-16，主控；包=evolve-final-diff.diff+E1/E2/E3 报告+plan v3。
> 结论：B=1 W=3 N=7，VERDICT=FAIL → 触发回炉轮。
> MODEL-SELF: model-field:b2466f8b-9d89-4428-a38e-c2aca1c41d0e/k3

## 权威口径声明（终审 C6 澄清）

本出件 N 系全集=**N1-N7**：N1=log-triage process.exit(1) 形态/N2=R10 错误面
无覆盖/N3=check-hardcode 自检临时目录不清理/N4=R1 推导措辞加法误读/
N5=regression import 注册 ds-call-v2 uncaughtException（堆栈信息减少，知悉）/
N6=init-defenses 授权=裁决 C1 点名非 plan 字面（记录备查）/
N7=log-triage harvestAgents 两行缩进不齐（修饰性）。
回炉单处置=N1-N4+主控移交项；N5/N6=知悉记录、N7=修饰性不处置——处置差异
系主控派发单口径（按需处置非全量），非遗漏。

## C1-C6 速核

C2/C3/C4/C5/C6 通过；C1 通过但"清零"语义有残留碎片（见 W3）。

## findings

- **B1**：ds-call-v2 cliMain 顶层 readJson(REGISTRY_PATH) 未包装——registry.json
  损坏时 uncaughtException→classifyExitCode=1，而旧消息正则（消息含
  "registry"/"JSON"）恒判 3=未申报 exit 3→1 回退；E1 穷举表漏此第 5 装载点。
  次要同族：loadRole registry.roles[roleId] 对 roles:null 形态 TypeError→1。
- **W1**：CHANGELOG/SKILL 修订记「七笔 commit」——实际九笔（E1 三+E2 四+E3
  两），永久记录自落错误计数。
- **W2**：glm-look chCfg 未命中通道 {}→undefined，「行为等价」自裁在该边上
  不成立（头注自述「通道未声明=无源返回」语义漂移）。
- **W3**：头注指针化残留「数字=语义」碎片六件（ds-call-v2 exit2=exhaust/
  4=禁重试、check-hardcode 5=降级、check-anchors golden 缺失=3、regression
  不单独 3、init-defenses (exit 1)、log-triage 均属 1 类）——C1 机检形式绿
  （同行无全角冒号），「九件复写块清零/不另留」表述过满。
- **N1-N7**：见上方权威口径声明。

## 自裁申报拷问（22 条）

合理 18；不成立/越权 3：E1-5（行为等价在 chCfg 边上证伪=W2）、E3-5（保留句
上限声称包外依据=W3）、E1 §4 穷举表（漏 cliMain 装载点=B1）。

## 红线扫描

SCRUB/scrub 字面量未动（R9 完好）；roles/.golden/org-config.default.json/
templates（除扩权行）/两本 jsonl/历史审计档零触碰。通过。

FINDINGS: B=1 W=3 N=7 VERDICT=FAIL
