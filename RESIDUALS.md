# RESIDUALS（残留登记册）

> 状态：active ｜ 权威：registry ｜ 替代：无

当前 **open=9**（B1 批挂账 8 行·销账 2 行后余 6；B2 返工轮 1 挂账 2 行后余 8；B3 批 b2n-probe-residual 销账 1 后余 7；2026-10-29 B3 收笔新挂 3 行（b3n-flag-on-pending／b3n-ledger-frozen-gap／b3n-pub-gate-legacy·授权=账本 b3-close）后余 10；2026-10-29 B4b 批 b3n-ledger-frozen-gap＋b3n-flag-on-pending 销账 2＋b4n-panel-polish 新挂 1 后余 9；2026-10-30 B5 批 b3n-pub-gate-legacy 销账 1＋b5n-tb-evidence-minor 新挂 1 后余 9；余册终态：closed／won't-fix）。历史登记行全文=开发方工作区
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
| b1n-doc-sync | 档面数字同步残留：任务书/审计面旧数字（自检向量 16→18 已同步·行数 360→414→438 链有旧值残留处） | closed（B2 面板/矩阵批随动清扫：B1 审计第 7 行终值 16→18、第 12 行 ledger-migrate 摘要 360→438 并补 §14 指针，grep 残留=0——证据=主仓 docs/evidence/B2-panel-matrix-impl-2026-10-29.md） | closed |
| b1n-projectrootof | org-config projectRootOf 死代码清理（round3 N-1 与审计申报不符项） | closed（B2 批复核：org-config.mjs 已无 projectRootOf，grep 计数=0 保持零出现、无删除动作虚构——证据=主仓 docs/evidence/B2-panel-matrix-impl-2026-10-29.md） | closed |
| b3n-flag-on-pending | 生产 b2_terms_v2 保持 off（on 态已在临时夹具全验证·但账本 748 行为首冻后新增词面红 1 处——主控裁决行用词失误·既有行禁改） | 已处置（2026-10-29 B4b 批收尾）：账本语义缺口经用户 exclude 豁免处置（b3n-ledger-frozen-gap 同日销账）后，主控切生产 b2_terms_v2 on（flags set·状态件已写）并亲跑生产矩阵全绿——五快扫 exit0（on 态 strict both）＋regression 8/8＋surface both exit0（active 0/新增 0/基线 136 件/495 组/691 次）＋agent-slots doctor FAIL0/WARN0＋主仓 verify-docs FAIL0/WARN2＋deploy-check ok64——证据=主仓账本 b4b-flag-on 行 | closed |
| b3n-ledger-frozen-gap | 活账本/流水持续追加与 historical 冻结计数语义冲突（设计缺口：首冻后任何新增含禁用词的账本行都使 strict historical 红·748 行即实例） | 已处置（2026-10-29 B4b 单点配置批·用户当面二选一 exclude 豁免）：terms_scan.historical 移出两仓账本与流水（skill 整规则删＋project 条目删）＋terms_scan.note 落政策与执法口径＋历史基线收缩 138 件/549 组/1239 次→136/495/691（--update 棘轮维持）＋同批改写词面新增 3 处（交接件 18 :11/:22＋B4 审计档 :95）；on 态 strict both exit=0——证据=主仓账本 b4b-ledger-exclude 行＋技能仓 terms-baseline diff | closed |
| b3n-pub-gate-legacy | pub-sanitize --out 四维门禁 9 命中（盘符夹具×4＋代号残留×5：SKILL.md:23／references/07:16/:17／terms-baseline note／agent-slots:684）＝HEAD 既有坏账（管线此前从未跑达门禁步·对照实证） | 已处置（2026-10-30 B5 批·用户裁决方案甲）：文档面代号×5 已随 B2-B4 绑定面 $max 化与词面改写自然补还（对账：原 9=文档 5+盘符 4·补还后 4+本批新识别本机绑定串 3=现 7）；A 组 3 处真实绑定串夹具清洗为中性串（deploy-check.mjs B4-D-3 组五值钉死＋org-config.mjs:929）＋B 组盘符夹具 4 处登记 share-whitelist synthetic_exempt（迁移器零源改）；门禁 7→0（V-01 分享包就绪零命中 exit0·实证部复算 8/8·裁决部 ACCEPT）——证据=主仓 docs/evidence/B5-pub-gate-impl-2026-10-29.md＋账本 b5-final-accept 行 | closed |
| b2n-vision-local-order | 本机件 role_fallbacks.vision 仍 3 项（面板有效序 glmflash→ds→699→startplan 补尾，异于矩阵出厂序 glmflash→startplan→ds→699）——用户面板动态基线域，非机检缺陷（org-config 校验只查首元与默认值一致，未对齐出厂序不阻） | 用户经面板自助调整，或下次面板批对齐矩阵出厂序 | open |
| b4n-panel-polish | 面板打磨域缓议三件（B4 批双审 ds 席 N 级·主控裁定挂册）：①跨角色并发在途态重置（render() 重建按钮可用且新 runtime busy:false·先完成者 load() 重置他卡三态）②同角色档位保存在途重入无 obsolete/同一 runtime 守卫③writeLocal rename 后 validate 前崩溃窗留未验证配置且无 .panel-bak 恢复提示（低危·单人单页面板场景） | 下次面板批或再动 panel/index.html、panel/server.mjs 时收敛（在途态保留＋重入守卫＋恢复提示）——证据=主仓 docs/evidence/B4-panel-ui-impl-2026-10-29.md §11 | open |
| b5n-tb-evidence-minor | 任务书证据层两小缺口（B5 批 tbreview 轮 3 N×2＋implreview 席二 N-3 同族·主控裁定挂册）：①V-08.3 基线深等未覆盖 share-whitelist 顶层 `_note` 与新增顶层键拒斥（本批以 24+/0- numstat＋hunk 范围反证未动）②F 事实台账技能仓 HEAD 仅说明文字绑定、repo_head 字段记主仓头（taskbook-evidence verify 不校验该字段） | 下次动 check-taskbook/taskbook-evidence 工具面或再写带 F/E 台账任务书时收敛（探针补 _note 深等＋顶层键集相等断言；证据件增 skill_head 字段或 F 命令附印技能仓 HEAD） | open |
| b2n-probe-residual | references/06:286-288 现役 runbook 残词「probe=进度文件回写」（B2 批删除面仅指定 :23/:25-27/:259/:143-144，:287 按禁扩面纪律保留——实现审计档 §7 第 3 条申报） | 下次动 references/06 时随批清账（删除或改写现役键）。已处置（2026-10-29 B3 批）：改写为 executor 承载（分笔 commit＋进度文件回写）——证据=主仓 docs/evidence/B3-terms-impl-2026-10-29.md | closed |
