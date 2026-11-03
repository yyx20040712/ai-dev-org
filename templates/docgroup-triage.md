# 文档分诊规则（docgroup）

> 状态：active ｜ 权威：本件（新项目文档分诊规则） ｜ 替代：无 ｜ 变更锚：w10-docgroup

摘要：本件由 init-docgroup 铺设，承载新项目文档群的分诊规则：路径规则只决定唯一类别与登记元数据，分诊只登记不搬迁任何既有文档。机读索引=docs/doc-index.json（schema=docgroup-index/v1），未知或同优先级歧义文档停留 pending_triage 待人工分诊。

## 六字段验收句（逐字）

新文档必须具有唯一类别、目标位置、责任域、状态、权威/替代关系和索引落点，未知项停留待分诊而非自动搬迁。

## 类别枚举（每文档恰一）

| 类别 | 覆盖面 |
|---|---|
| project-constitution | 任意目录层文件名 AGENTS.md |
| changelog | 任意目录层文件名 CHANGELOG.md |
| adr | docs/adr/ 前缀 |
| product-spec | docs/spec/ 前缀 |
| product-manual | docs/manual/ 前缀 |
| doc-template | docs/templates/ 前缀 |
| taskbook | docs/tasks/ 前缀 |
| handoff | evidence/handoffs/ 前缀 |
| close | evidence/close/ 前缀 |
| session-log | evidence/session-logs/ 前缀 |
| evidence | evidence/ 其余（其他 evidence） |
| triage-rule | 精确 docs/doc-triage.md（本件） |
| doc-index | 精确 docs/doc-index.json（索引自身） |

## 规则优先级

1. 精确规则优先于前缀：路径全等命中即定类别。三条内置自记录＝docs/doc-index.json→doc-index、docs/doc-triage.md→triage-rule、docs/templates/document.md→doc-template，均 target==path、owner=docgroup-init、status=registered。
2. 文件名规则与目录前缀规则同优先级：按命中键长度取最长唯一前缀命中。
3. 同长度多命中或无命中=unknown：进入 pending_triage 原地停留待人工分诊（例：docs/spec/AGENTS.md 同时命中文件名 AGENTS.md 与前缀 docs/spec，两者键长相同即歧义）。
4. 已分诊记录八键=path/category/target/owner/status/authority/supersedes/index；status=registered 只表示已登记，不冒充 active；supersedes=null 表示未声明而非断言无替代。
5. 待分诊记录八键全值固定：path=原路径、category=unknown、target=原路径、owner=unassigned、status=pending-triage、authority=unresolved、supersedes=null、index=/pending_triage/N（N=零基数组序号）。
6. 索引两数组均按 path 的 POSIX 路径字节序（UTF-8 无符号字节）排列；一个文档只落一个数组，index 指针必须回指自身。

## 未知不搬迁

分诊全程无 mv/rename/unlink：未知文档停留原路径、原文逐字节不变，只登记进 pending_triage。人工分诊后由后续批更新类别与元数据，再迁入 documents。

## W11 下游消费指针

W11 按 docgroup-index/v1 只读消费 documents/pending_triage 两数组与 JSON Pointer（index 键回指自身）；pending_triage 队列即待人工分诊工作面。schema 变更须另批裁决与迁移，不静默破坏兼容位。本件铺设不构成 W11 已接线声明。
