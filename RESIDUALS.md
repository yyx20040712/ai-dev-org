# RESIDUALS（残留登记册）

> 状态：active ｜ 权威：registry ｜ 替代：无

当前 **open=8**（B1 批挂账 8 行·2026-10-29 随 B1-close 登记；余册终态：closed／won't-fix）。历史登记行全文=开发方工作区
历史文档区存档与技能仓 git 提交历史，不驻技能加载面。

## 新登记行格式

`| 登记号 | 现象 | 触发处置行 | 状态 |`——登记号自拟短键；触发处置行写清
「何时/何条件下必须处置」；销账时改状态并留处置摘要，不删行。新登记随批进行；
历史行不回填本册。

## open 表

| 登记号 | 现象 | 触发处置 | 状态 |
|---|---|---|---|
| binding-live-registry-drift | executor 默认槽 startplan 的绑定值所指计划源供应商在宿主供应商注册表已不存在（现行注册表计划源=individual-coding-plan／offpeak-idle-plan／highspeed-card 三家），实派即 provider-not-found；机检面（validate／doctor／deploy-check）均不查宿主注册表活性，仅实派或 ListModels 可见 | 已裁决闭合：startplan 槽保留（供应商将更新·届时用户经面板自动调整）；本次用户已把 glmflash 调为 executor 首位（面板=顺序日常唯一写者·startplan 居回退序第 2）；再触发=startplan 供应商恢复或再变时由用户面板调整，无需机检面动作 | closed |
| b1n-hermetic | ledger-migrate 自检夹具 hermetic 化未竟（对宿主环境有隐依赖面——env/路径缺省；B1 round3 ds 席 N 系） | 下次动 ledger-migrate 自检面或 B2 检查器硬化批时收敛（自检全自包含夹具） | open |
| b1n-toctou | ledger-migrate 写路径 lstat→write 间隙 TOCTOU 窗口（锁内复查已收敛·残余为同进程间隙竞态；round3 挂账） | 下次动迁移器写侧时评估 fd 级防护（O_NOFOLLOW/O_EXCL 或 stat 后持 fd 写） | open |
| b1n-portability | st_nlink>1 hardlink 判定的平台可移植性（跨设备载体/非 POSIX 形态未覆盖；round3 ds N 系「平台可移植」） | 技能迁移他机或非 Linux 载体部署时验证并按需加平台分支 | open |
| b1n-env-notice | ORG_QUARANTINE_PATH 等环境变量依赖的缺省提示面不足（env notice；round3 ds N 系） | 下次动 org-config/ledger-migrate 文案时补 notice | open |
| b1n-cli-precheck | CLI 预检（参数组合前置校验）与 D-1 exit 家族映射未完全统一（CLI 预检 exit3 映射；round3 ds N 系） | 下次动两脚本 CLI 面时随 D-1 家族口径收敛 | open |
| b1n-v18-rerun | V-18 回退演练在 r3 后未复跑（向量面未变·路径等价成立但缺注记；round3 ds N 系） | 下次动迁移器或回退链时复跑 V-18 五步并留 rollback-step0-4-exit= 实录 | open |
| b1n-doc-sync | 档面数字同步残留：任务书/审计面旧数字（自检向量 16→18 已同步·行数 360→414→438 链有旧值残留处） | 面板批或 B2 文档笔随动清扫 | open |
| b1n-projectrootof | org-config projectRootOf 死代码清理（round3 N-1 与审计申报不符项） | B2 注册链批（面板批动 org-config 常量时顺带清理） | open |
