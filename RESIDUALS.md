# RESIDUALS（残留登记册）

> 状态：active ｜ 权威：registry ｜ 替代：无

当前 **open=0**（全册终态：closed／won't-fix）。历史登记行全文=开发方工作区
历史文档区存档与技能仓 git 提交历史，不驻技能加载面。

## 新登记行格式

`| 登记号 | 现象 | 触发处置行 | 状态 |`——登记号自拟短键；触发处置行写清
「何时/何条件下必须处置」；销账时改状态并留处置摘要，不删行。新登记随批进行；
历史行不回填本册。

## open 表

| 登记号 | 现象 | 触发处置 | 状态 |
|---|---|---|---|
| binding-live-registry-drift | executor 默认槽 startplan 的绑定值所指计划源供应商在宿主供应商注册表已不存在（现行注册表计划源=individual-coding-plan／offpeak-idle-plan／highspeed-card 三家），实派即 provider-not-found；机检面（validate／doctor／deploy-check）均不查宿主注册表活性，仅实派或 ListModels 可见 | 已裁决闭合：startplan 槽保留（供应商将更新·届时用户经面板自动调整）；本次用户已把 glmflash 调为 executor 首位（面板=顺序日常唯一写者·startplan 居回退序第 2）；再触发=startplan 供应商恢复或再变时由用户面板调整，无需机检面动作 | closed |
