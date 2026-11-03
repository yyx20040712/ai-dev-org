# RESIDUALS（残留登记册）

> 状态：active ｜ 权威：registry ｜ 替代：无

当前 **open=1**（由下方权威 JSON 段 status 派生；2026-11-03 W5c 工具批 implreview-split-locale-gitstate 销账 1〔D-9 结构化判据＋GIT_DIR 拦截＋statSync 错误码感知·提交 bb2da70/142570a〕；历史计数叙事：B1 批挂账 8 行·销账 2 行后余 6；B2 返工轮 1 挂账 2 行后余 8；B3 批 b2n-probe-residual 销账 1 后余 7；2026-10-29 B3 收笔新挂 3 行（b3n-flag-on-pending／b3n-ledger-frozen-gap／b3n-pub-gate-legacy·授权=账本 b3-close）后余 10；2026-10-29 B4b 批 b3n-ledger-frozen-gap＋b3n-flag-on-pending 销账 2＋b4n-panel-polish 新挂 1 后余 9；2026-10-30 B5 批 b3n-pub-gate-legacy 销账 1＋b5n-tb-evidence-minor 新挂 1 后余 9；2026-10-31 B6 批 b6n-atomicwrite-race＋b6n-frozen-anchor-external 新挂 2 后余 11（首次经 JSON 权威段登记）；；2026-10-30 B8 事故新挂 1 行（b8n-test-harness-runaway·授权=账本 b8-incident 行·纯 JSON 登记不触冻结旧表）后余 9；2026-10-30 B8 实现批销账 8 行（b1n 六项 legacy＋b6n-atomicwrite-race＋b8n-test-harness-runaway）后余 0。余册终态：closed／won't-fix）。历史登记行全文=开发方工作区
历史文档区存档与技能仓 git 提交历史，不驻技能加载面。

**权威段唯一**：下方 residuals-json 标记对之间的 JSON 是唯一权威（schema=residuals/v1）；「历史旧表」仅供对账、已冻结非权威；禁止双写——冻结表行不得在冻结块外重现，新登记只走 JSON 八键，不再新增 Markdown 行。

<!-- residuals-json: begin -->
{
  "residuals": [
    {
      "created_at": null,
      "description": "CLI 预检（参数组合前置校验）与 D-1 exit 家族映射未完全统一（CLI 预检 exit3 映射；round3 ds N 系）",
      "evidence": [],
      "id": "b1n-cli-precheck",
      "owner": null,
      "phenomenon": "CLI 预检（参数组合前置校验）与 D-1 exit 家族映射未完全统一（CLI 预检 exit3 映射；round3 ds N 系）",
      "status": "closed",
      "trigger": "已处置（2026-10-30·B8·D-5 预检闭集：两脚本参数组合前置校验先于装载与任何写入——ledger 16 例与 org-config 15 例非法组合全真 exit 1（向量㉓/org 三向量），candidate 缺件/破损→3，破损配置下非法组合仍 1 而合法命令才 3，业务判红=1，2 永不发）——证据＝主仓 docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-04"
    },
    {
      "created_at": null,
      "description": "档面数字同步残留：任务书/审计面旧数字（自检向量 16→18 已同步·行数 360→414→438 链有旧值残留处）",
      "evidence": [],
      "id": "b1n-doc-sync",
      "owner": null,
      "phenomenon": "档面数字同步残留：任务书/审计面旧数字（自检向量 16→18 已同步·行数 360→414→438 链有旧值残留处）",
      "status": "closed",
      "trigger": "closed（B2 面板/矩阵批随动清扫：B1 审计第 7 行终值 16→18、第 12 行 ledger-migrate 摘要 360→438 并补 §14 指针，grep 残留=0——证据=主仓 docs/evidence/B2-panel-matrix-impl-2026-10-29.md）"
    },
    {
      "created_at": null,
      "description": "ORG_QUARANTINE_PATH 等环境变量依赖的缺省提示面不足（env notice；round3 ds N 系）",
      "evidence": [],
      "id": "b1n-env-notice",
      "owner": null,
      "phenomenon": "ORG_QUARANTINE_PATH 等环境变量依赖的缺省提示面不足（env notice；round3 ds N 系）",
      "status": "closed",
      "trigger": "已处置（2026-10-30·B8·D-4 notice：ledger-migrate 于 ORG_QUARANTINE_PATH、org-config 于 ORG_FLAGS_STATE 各在 CLI 预检后装载前向 stderr 打 default:/override: 单行（只显路径与来源·不读不印状态内容·stdout 机器格式不变），缺省行注明未设置使用缺省、覆盖行注明显式覆盖；向量㉒与 org-config 合法回归断言＋V-04 四组 notice 实录）——证据＝主仓 docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-04"
    },
    {
      "created_at": null,
      "description": "ledger-migrate 自检夹具 hermetic 化未竟（对宿主环境有隐依赖面——env/路径缺省；B1 round3 ds 席 N 系）",
      "evidence": [],
      "id": "b1n-hermetic",
      "owner": null,
      "phenomenon": "ledger-migrate 自检夹具 hermetic 化未竟（对宿主环境有隐依赖面——env/路径缺省；B1 round3 ds 席 N 系）",
      "status": "closed",
      "trigger": "已处置（2026-10-30·B8·D-1 hermetic 化：自检⑬⑯改全合成——/tmp 隔离技能根复制两脚本＋合成 default={}＋合成源与合成 manifest＋空 HOME，24 向量零宿主真实源/manifest/local/HOME 依赖；V-01 隔离根 exit 0/24 PASS 且真实面逐路径哈希前后不变，before 基线副本红证归因=缺真实源）——证据＝主仓 docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-01"
    },
    {
      "created_at": null,
      "description": "st_nlink>1 hardlink 判定的平台可移植性（跨设备载体/非 POSIX 形态未覆盖；round3 ds N 系「平台可移植」）",
      "evidence": [],
      "id": "b1n-portability",
      "owner": null,
      "phenomenon": "st_nlink>1 hardlink 判定的平台可移植性（跨设备载体/非 POSIX 形态未覆盖；round3 ds N 系「平台可移植」）",
      "status": "closed",
      "trigger": "已处置（2026-10-30·B8·D-3 平台分支：hardlinkWritePolicy 纯函数单源＋向量㉑ linux/win32/unsupported 三平台注入＋真实 Linux 硬链 victim 负例实测，win32 既存目标 fail-closed 与 unsupported 拒写为静态保守分支；仅 Linux 实证；静态平台分支；未跨机（cross_machine_tested=false））——证据＝主仓 docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-03"
    },
    {
      "created_at": null,
      "description": "org-config projectRootOf 死代码清理（round3 N-1 与审计申报不符项）",
      "evidence": [],
      "id": "b1n-projectrootof",
      "owner": null,
      "phenomenon": "org-config projectRootOf 死代码清理（round3 N-1 与审计申报不符项）",
      "status": "closed",
      "trigger": "closed（B2 批复核：org-config.mjs 已无 projectRootOf，grep 计数=0 保持零出现、无删除动作虚构——证据=主仓 docs/evidence/B2-panel-matrix-impl-2026-10-29.md）"
    },
    {
      "created_at": null,
      "description": "ledger-migrate 写路径 lstat→write 间隙 TOCTOU 窗口（锁内复查已收敛·残余为同进程间隙竞态；round3 挂账）",
      "evidence": [],
      "id": "b1n-toctou",
      "owner": null,
      "phenomenon": "ledger-migrate 写路径 lstat→write 间隙 TOCTOU 窗口（锁内复查已收敛·残余为同进程间隙竞态；round3 挂账）",
      "status": "closed",
      "trigger": "已处置（2026-10-30·B8·D-2 写侧收敛：候选件/项目账本/隔离件/manifest/rollback 追加全部经 secureWriteFile 唯一写通道——O_NOFOLLOW 打开不带 O_TRUNC→持 fd fstat 最终身份判定（非普通文件/nlink>1 拒）→同 fd 读截写回→finally 关 fd；向量⑱⑲⑳预检后路径替换负例 victim 零改写，V-02 三路径探针全绿，旧 lstat→write 窗写穿红证随档）——证据＝主仓 docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-02"
    },
    {
      "created_at": null,
      "description": "V-18 回退演练在 r3 后未复跑（向量面未变·路径等价成立但缺注记；round3 ds N 系）",
      "evidence": [],
      "id": "b1n-v18-rerun",
      "owner": null,
      "phenomenon": "V-18 回退演练在 r3 后未复跑（向量面未变·路径等价成立但缺注记；round3 ds N 系）",
      "status": "closed",
      "trigger": "已处置（2026-10-30·B8·D-7 复跑：以冻结源只读副本建 /tmp 四件套五步真跑，rollback-step0-4-exit=0/1/0/0/0，步2 异常行三断言＋manifest 字节不变，source 717→718→719 仅旧账本副本追加，步4 health-scan --ledger RED=0，生产冻结源前后哈希不变）——证据＝主仓 docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-06"
    },
    {
      "created_at": null,
      "description": "references/06:286-288 现役 runbook 残词「probe=进度文件回写」（B2 批删除面仅指定 :23/:25-27/:259/:143-144，:287 按禁扩面纪律保留——实现审计档 §7 第 3 条申报）",
      "evidence": [],
      "id": "b2n-probe-residual",
      "owner": null,
      "phenomenon": "references/06:286-288 现役 runbook 残词「probe=进度文件回写」（B2 批删除面仅指定 :23/:25-27/:259/:143-144，:287 按禁扩面纪律保留——实现审计档 §7 第 3 条申报）",
      "status": "closed",
      "trigger": "下次动 references/06 时随批清账（删除或改写现役键）。已处置（2026-10-29 B3 批）：改写为 executor 承载（分笔 commit＋进度文件回写）——证据=主仓 docs/evidence/B3-terms-impl-2026-10-29.md"
    },
    {
      "created_at": null,
      "description": "本机件 role_fallbacks.vision 仍 3 项（面板有效序 glmflash→ds→699→startplan 补尾，异于矩阵出厂序 glmflash→startplan→ds→699）——用户面板动态基线域，非机检缺陷（org-config 校验只查首元与默认值一致，未对齐出厂序不阻）",
      "evidence": [],
      "id": "b2n-vision-local-order",
      "owner": null,
      "phenomenon": "本机件 role_fallbacks.vision 仍 3 项（面板有效序 glmflash→ds→699→startplan 补尾，异于矩阵出厂序 glmflash→startplan→ds→699）——用户面板动态基线域，非机检缺陷（org-config 校验只查首元与默认值一致，未对齐出厂序不阻）",
      "status": "closed",
      "trigger": "已处置（2026-10-30·B7 批）：本机 vision 序经真实面板 /api/order 唯一一次 POST 对齐矩阵出厂序 glmflash→startplan→ds→699，V-03 验证写前序＝装配 F-05 实读、validate 通过、.panel-bak 等于写前本机件、部署面 56 件零差异、剔除 vision 后全配置递归深等；现象列「仍 3 项」为登记时快照，装配 F-05 实读已为 4 项且顺序 glmflash→startplan→699→ds，本批只对齐 F-06 出厂序，现象列原文保留——证据＝主仓 docs/evidence/B7-panel-tools-impl-2026-10-30.md"
    },
    {
      "created_at": null,
      "description": "生产 b2_terms_v2 保持 off（on 态已在临时夹具全验证·但账本 748 行为首冻后新增词面红 1 处——主控裁决行用词失误·既有行禁改）",
      "evidence": [],
      "id": "b3n-flag-on-pending",
      "owner": null,
      "phenomenon": "生产 b2_terms_v2 保持 off（on 态已在临时夹具全验证·但账本 748 行为首冻后新增词面红 1 处——主控裁决行用词失误·既有行禁改）",
      "status": "closed",
      "trigger": "已处置（2026-10-29 B4b 批收尾）：账本语义缺口经用户 exclude 豁免处置（b3n-ledger-frozen-gap 同日销账）后，主控切生产 b2_terms_v2 on（flags set·状态件已写）并亲跑生产矩阵全绿——五快扫 exit0（on 态 strict both）＋regression 8/8＋surface both exit0（active 0/新增 0/基线 136 件/495 组/691 次）＋agent-slots doctor FAIL0/WARN0＋主仓 verify-docs FAIL0/WARN2＋deploy-check ok64——证据=主仓账本 b4b-flag-on 行"
    },
    {
      "created_at": null,
      "description": "活账本/流水持续追加与 historical 冻结计数语义冲突（设计缺口：首冻后任何新增含禁用词的账本行都使 strict historical 红·748 行即实例）",
      "evidence": [],
      "id": "b3n-ledger-frozen-gap",
      "owner": null,
      "phenomenon": "活账本/流水持续追加与 historical 冻结计数语义冲突（设计缺口：首冻后任何新增含禁用词的账本行都使 strict historical 红·748 行即实例）",
      "status": "closed",
      "trigger": "已处置（2026-10-29 B4b 单点配置批·用户当面二选一 exclude 豁免）：terms_scan.historical 移出两仓账本与流水（skill 整规则删＋project 条目删）＋terms_scan.note 落政策与执法口径＋历史基线收缩 138 件/549 组/1239 次→136/495/691（--update 棘轮维持）＋同批改写词面新增 3 处（交接件 18 :11/:22＋B4 审计档 :95）；on 态 strict both exit=0——证据=主仓账本 b4b-ledger-exclude 行＋技能仓 terms-baseline diff"
    },
    {
      "created_at": null,
      "description": "pub-sanitize --out 四维门禁 9 命中（盘符夹具×4＋代号残留×5：SKILL.md:23／references/07:16/:17／terms-baseline note／agent-slots:684）＝HEAD 既有坏账（管线此前从未跑达门禁步·对照实证）",
      "evidence": [],
      "id": "b3n-pub-gate-legacy",
      "owner": null,
      "phenomenon": "pub-sanitize --out 四维门禁 9 命中（盘符夹具×4＋代号残留×5：SKILL.md:23／references/07:16/:17／terms-baseline note／agent-slots:684）＝HEAD 既有坏账（管线此前从未跑达门禁步·对照实证）",
      "status": "closed",
      "trigger": "已处置（2026-10-30 B5 批·用户裁决方案甲）：文档面代号×5 已随 B2-B4 绑定面 $max 化与词面改写自然补还（对账：原 9=文档 5+盘符 4·补还后 4+本批新识别本机绑定串 3=现 7）；A 组 3 处真实绑定串夹具清洗为中性串（deploy-check.mjs B4-D-3 组五值钉死＋org-config.mjs:929）＋B 组盘符夹具 4 处登记 share-whitelist synthetic_exempt（迁移器零源改）；门禁 7→0（V-01 分享包就绪零命中 exit0·实证部复算 8/8·裁决部 ACCEPT）——证据=主仓 docs/evidence/B5-pub-gate-impl-2026-10-29.md＋账本 b5-final-accept 行"
    },
    {
      "created_at": null,
      "description": "面板打磨域缓议三件（B4 批双审 ds 席 N 级·主控裁定挂册）：①跨角色并发在途态重置（render() 重建按钮可用且新 runtime busy:false·先完成者 load() 重置他卡三态）②同角色档位保存在途重入无 obsolete/同一 runtime 守卫③writeLocal rename 后 validate 前崩溃窗留未验证配置且无 .panel-bak 恢复提示（低危·单人单页面板场景）",
      "evidence": [],
      "id": "b4n-panel-polish",
      "owner": null,
      "phenomenon": "面板打磨域缓议三件（B4 批双审 ds 席 N 级·主控裁定挂册）：①跨角色并发在途态重置（render() 重建按钮可用且新 runtime busy:false·先完成者 load() 重置他卡三态）②同角色档位保存在途重入无 obsolete/同一 runtime 守卫③writeLocal rename 后 validate 前崩溃窗留未验证配置且无 .panel-bak 恢复提示（低危·单人单页面板场景）",
      "status": "closed",
      "trigger": "已处置（2026-10-30·B7 面板批）：跨角色在途态保留＋同角色档位保存重入守卫＋.panel-bak 恢复提示三件已实现并验证（V-01 三分证：跨角色保留／同角色重入回归守卫／stale 完成隔离；V-02 四例：备份在场提示／缺席隐藏／recovery 键缺席隐藏／正常保存后提示仍在，零自动恢复）——证据＝主仓 docs/evidence/B7-panel-tools-impl-2026-10-30.md"
    },
    {
      "created_at": "2026-10-30",
      "description": "B5 批 b3n-pub-gate-legacy 销账叙述「门禁 7→0」经查证走 package-skill --out 三维通道（B5 审计档 :99），pub-sanitize 四维门禁端到端通道历史从未跑达门禁步——H8 休眠实为两层：T 声明层（488 声明自 B4 返工注释起漂移休眠）与门禁层（SKILL.md:23／references/07:16/:17 决策号／terms-baseline.json:13／agent-slots.mjs:695 账本行号共 5 处既有命中）；B7 批 D-6（T 重算 489/514）＋D-6b（X3 counts 扩面＋X2-8）已修，隔离实证与端到端 exit0 四维零命中留档",
      "evidence": [
        "docs/evidence/B7-panel-tools-impl-2026-10-30.md §8b",
        "docs/evidence/B7-recon-2026-10-30.md",
        "docs/evidence/B7-close-2026-10-30.md"
      ],
      "id": "b5n-pub-gate-channel-substitution",
      "owner": "B7",
      "phenomenon": "B5 销账口径置换：pub-sanitize 四维门禁层从未被端到端通道触达（B5 走 package-skill 三维通道结项），双层休眠至 B7 体检揭示",
      "status": "closed",
      "trigger": "已处置（2026-10-30·B7·D-6/D-6b 修复端到端转绿·记录性登记·不重开 b3n）"
    },
    {
      "created_at": null,
      "description": "任务书证据层两小缺口（B5 批 tbreview 轮 3 N×2＋implreview 席二 N-3 同族·主控裁定挂册）：①V-08.3 基线深等未覆盖 share-whitelist 顶层 `_note` 与新增顶层键拒斥（本批以 24+/0- numstat＋hunk 范围反证未动）②F 事实台账技能仓 HEAD 仅说明文字绑定、repo_head 字段记主仓头（taskbook-evidence verify 不校验该字段）",
      "evidence": [],
      "id": "b5n-tb-evidence-minor",
      "owner": null,
      "phenomenon": "任务书证据层两小缺口（B5 批 tbreview 轮 3 N×2＋implreview 席二 N-3 同族·主控裁定挂册）：①V-08.3 基线深等未覆盖 share-whitelist 顶层 `_note` 与新增顶层键拒斥（本批以 24+/0- numstat＋hunk 范围反证未动）②F 事实台账技能仓 HEAD 仅说明文字绑定、repo_head 字段记主仓头（taskbook-evidence verify 不校验该字段）",
      "status": "closed",
      "trigger": "已处置（2026-10-30·B7 批）：taskbook-evidence record 逐条新增 skill_head（SKILL_ROOT git HEAD 实读·与 repo_head 分源不混写），verify 执行命令前区分 legacy 全缺／新件全有两形态（后者须 7-40 位小写十六进制＋全件一致＋git cat-file 可解析，混排/混值/未知提交 exit 3 且零命令执行），自检 18→23 向量全绿，B7 台账为首件受益并经 V-04 深等重录验证；share-whitelist 的 _note 深等＋顶层键集相等正反证由 B7 任务书 V-08.3 探针承载（check-taskbook 本体零改）——证据＝主仓 docs/evidence/B7-panel-tools-impl-2026-10-30.md"
    },
    {
      "created_at": "2026-10-31",
      "description": "返工轮 2 主控裁决登记残留（同 TOCTOU 先例 b1n-toctou 族）",
      "evidence": [
        "docs/evidence/B6-docgen-impl-2026-10-29.md §11",
        "docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-05（两生成器目标侧独占创建与并发验收）"
      ],
      "id": "b6n-atomicwrite-race",
      "owner": "B6",
      "phenomenon": "gen-handoff/gen-close-summary atomicNewWrite 先 existsSync 再 rename，两并发进程可同过存在性检查后写覆盖（单人单进程理论面）",
      "status": "closed",
      "trigger": "下次动两生成器写侧时评估目标侧独占创建（link/O_EXCL 形态）收敛 existsSync→rename 竞态窗"
    },
    {
      "created_at": "2026-10-31",
      "description": "返工轮 2 主控裁决登记残留（内建常量将致脚本与冻结表强耦合·暂不内建）",
      "evidence": [
        "docs/evidence/B6-docgen-impl-2026-10-29.md §11",
        "docs/evidence/B7-panel-tools-impl-2026-10-30.md §V-06（采乙：维持 V-05c 型外部锚定；B6/B7 两轮主控裁决一致）"
      ],
      "id": "b6n-frozen-anchor-external",
      "owner": "B6",
      "phenomenon": "residuals-check 冻结哈希仅文件内自洽（表与标记同步改写仍过），锚定由 V-05c 外部探针承担",
      "status": "closed",
      "trigger": "下次动 residuals-check 或要求 --check 单独承担冻结锚定时内建基线常量或基线文件比对"
    },
    {
      "created_at": "2026-10-30",
      "description": "双审第二席 R2 终轮 N-01~06 六条展示面残留：①档位保存失败 error 态可被后续排序保存成功覆盖为 saved（数据面无风险·render 已回显服务端真值）②排序 timer 未决期档位按钮短暂 enabled（saveLevel 守卫保证零 fetch·点击静默无响应）③c5b opts enabled 断言恒真面与 catch 分支无独立向量④§12 sha256 前缀摘要口径自述⑤定版红「中间态回放」表述与旧日志互斥⑥探针 R1/R2 版标签与机器行计数勘误——均非阻断，详见 B7-close §N",
      "evidence": [
        "docs/evidence/B7-close-2026-10-30.md §N",
        "docs/evidence/B7-panel-tools-impl-2026-10-30.md",
        "docs/evidence/R0-dispatch-enforcement-impl-2026-10-30.md §3/§6（2026-10-30·R0·b7n①②代码修复红绿 3→0＋14/14·b7n③向量 27→58·④⑤⑥主控勘误注记 B7 审计档 :17/:176·V-07 无头四截图 vision PASS·面板回归 51/15 逐名重建全过）"
      ],
      "id": "b7n-panel-display-polish",
      "owner": "B7",
      "phenomenon": "面板展示态竞争六条（终审附注：收笔登记、实施转下批，均有守卫兜底无数据面风险）",
      "status": "closed",
      "trigger": "下次面板批或再动 panel/index.html 时收敛（错误态保持/timer 期按钮一致态/向量补强）"
    },
    {
      "created_at": "2026-10-30",
      "description": "B8 实现岗红队台架失控循环（/tmp/B8-red-lm 无终止 --verify/--self-test 驱动＋自检自拷贝递归＋异步 spawn 不收割）致整机两次拖垮重启；处置预定＝任务书 r4-r7 反失控条款（哨兵防递归/异步收割/进程目录预算/台架一次性形态/资源面申报）＋V-11 资源纪律实录验收",
      "evidence": [
        "docs/evidence/B8-incident-2026-10-30.md",
        "docs/evidence/B8-incident-2026-10-30-quarantine.diff",
        "docs/tasks/B8-migrator-hardening.md",
        "docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-11（测试面资源纪律实录）"
      ],
      "id": "b8n-test-harness-runaway",
      "owner": "B8",
      "phenomenon": "无人值守实现批自建测试台架无资源界：无终止循环×自引用测试递归×异步子进程不收割（2026-10-30 实测 load 891+/进程 2600+/Committed_AS 4.7 倍超限/7 万临时目录）",
      "status": "closed",
      "trigger": "B8 实现批结项时随批销账（V-11 资源纪律实录通过即 closed）；R2-T3 resource-sampler 工具化后升格为常备工具面"
    },
    {
      "created_at": null,
      "description": "executor 默认槽 startplan 的绑定值所指计划源供应商在宿主供应商注册表已不存在（现行注册表计划源=individual-coding-plan／offpeak-idle-plan／highspeed-card 三家），实派即 provider-not-found；机检面（validate／doctor／deploy-check）均不查宿主注册表活性，仅实派或 ListModels 可见",
      "evidence": [],
      "id": "binding-live-registry-drift",
      "owner": null,
      "phenomenon": "executor 默认槽 startplan 的绑定值所指计划源供应商在宿主供应商注册表已不存在（现行注册表计划源=individual-coding-plan／offpeak-idle-plan／highspeed-card 三家），实派即 provider-not-found；机检面（validate／doctor／deploy-check）均不查宿主注册表活性，仅实派或 ListModels 可见",
      "status": "closed",
      "trigger": "已裁决闭合：startplan 槽保留（供应商将更新·届时用户经面板自动调整）；本次用户已把 glmflash 调为 executor 首位（面板=顺序日常唯一写者·startplan 居回退序第 2）；再触发=startplan 供应商恢复或再变时由用户面板调整，无需机检面动作"
    },
    {
      "created_at": "2026-11-03",
      "description": "deploy-check.mjs gitState 以英文消息正则判定非 git 目录（/not a git repository/i）；中文 locale 下非 git 目录抛 SelfLoadError exit 3——隔离取证序列以 LC_ALL=C 规避在案（implreview-split 批证据档 §6）",
      "evidence": [
        "docs/evidence/implreview-split-2026-11-03.md §6-1（主仓）"
      ],
      "id": "implreview-split-locale-gitstate",
      "owner": "W5c 工具批",
      "phenomenon": "gitState 中文 locale 失配：非 git 目录不被英文正则识别→装载错 exit 3（应为可控降级）",
      "status": "closed",
      "trigger": "下一工具批（与 routeSecondMismatch 诊断噪声、agent-slots.mjs:311 注释同笔清理）"
    },
    {
      "created_at": "2026-10-31",
      "description": "本地源面与 CI 分发面词表及项目基线可能漂移；技能根基线任何重冻批须同步主仓镜像件，由本地 verify-docs 同源机检执法",
      "evidence": [
        "docs/evidence/W5a-gates-2026-10-31.md"
      ],
      "id": "vocab-two-face-skew",
      "owner": "W5a",
      "phenomenon": "源面与分发面 check-terms 全脚本及未来词表存在两面偏差",
      "status": "open",
      "trigger": "下次词表变更批须先推分发面或同步两面；技能根基线任何重冻批（棘轮升降）须同步主仓镜像件——本地 verify-docs 同源机检执法"
    }
  ],
  "schema": "residuals/v1"
}
<!-- residuals-json: end -->

## 新登记规则（JSON 八键）

新登记只在权威 JSON 段新增条目，每条恰含八键不多不少：id/status/owner/trigger/evidence/created_at/phenomenon/description。status 限 open／closed／won't-fix 三枚举；id 唯一且全段按 id 字典序排序；新登记要求 owner 为非空字符串、created_at 为合法 ISO 日期或时间、evidence 为字符串数组、description 非空。历史迁移条目（id 在冻结表 id 集内）保留 owner/created_at=null、evidence=[]、description=phenomenon 的来源缺位形态，未来新登记不接受这三个缺省形态。本文件全文禁 term-scan 开关标记；权威 JSON 段为非围栏正文（字符串值可被词面与零代号扫描），两闸缺一不可。校验命令=node scripts/residuals-check.mjs --file RESIDUALS.md --check。

## 历史旧表（冻结·非权威）

<!-- residuals-frozen: begin sha256=deab8eee600e3a6caf9d9c6c8dc26610bdbb17b68d98d1728f1228dba5490053 冻结·非权威 -->
| 登记号 | 现象 | 触发处置 | 状态 |
|---|---|---|---|
| binding-live-registry-drift | executor 默认槽 startplan 的绑定值所指计划源供应商在宿主供应商注册表已不存在（现行注册表计划源=individual-coding-plan／offpeak-idle-plan／highspeed-card 三家），实派即 provider-not-found；机检面（validate／doctor／deploy-check）均不查宿主注册表活性，仅实派或 ListModels 可见 | 已裁决闭合：startplan 槽保留（供应商将更新·届时用户经面板自动调整）；本次用户已把 glmflash 调为 executor 首位（面板=顺序日常唯一写者·startplan 居回退序第 2）；再触发=startplan 供应商恢复或再变时由用户面板调整，无需机检面动作 | closed |
| b1n-hermetic | ledger-migrate 自检夹具 hermetic 化未竟（对宿主环境有隐依赖面——env/路径缺省；B1 round3 ds 席 N 系） | 已处置（2026-10-30·B8·D-1 hermetic 化：自检⑬⑯改全合成——/tmp 隔离技能根复制两脚本＋合成 default={}＋合成源与合成 manifest＋空 HOME，24 向量零宿主真实源/manifest/local/HOME 依赖；V-01 隔离根 exit 0/24 PASS 且真实面逐路径哈希前后不变，before 基线副本红证归因=缺真实源）——证据＝主仓 docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-01 | closed |
| b1n-toctou | ledger-migrate 写路径 lstat→write 间隙 TOCTOU 窗口（锁内复查已收敛·残余为同进程间隙竞态；round3 挂账） | 已处置（2026-10-30·B8·D-2 写侧收敛：候选件/项目账本/隔离件/manifest/rollback 追加全部经 secureWriteFile 唯一写通道——O_NOFOLLOW 打开不带 O_TRUNC→持 fd fstat 最终身份判定（非普通文件/nlink>1 拒）→同 fd 读截写回→finally 关 fd；向量⑱⑲⑳预检后路径替换负例 victim 零改写，V-02 三路径探针全绿，旧 lstat→write 窗写穿红证随档）——证据＝主仓 docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-02 | closed |
| b1n-portability | st_nlink>1 hardlink 判定的平台可移植性（跨设备载体/非 POSIX 形态未覆盖；round3 ds N 系「平台可移植」） | 已处置（2026-10-30·B8·D-3 平台分支：hardlinkWritePolicy 纯函数单源＋向量㉑ linux/win32/unsupported 三平台注入＋真实 Linux 硬链 victim 负例实测，win32 既存目标 fail-closed 与 unsupported 拒写为静态保守分支；仅 Linux 实证；静态平台分支；未跨机（cross_machine_tested=false））——证据＝主仓 docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-03 | closed |
| b1n-env-notice | ORG_QUARANTINE_PATH 等环境变量依赖的缺省提示面不足（env notice；round3 ds N 系） | 已处置（2026-10-30·B8·D-4 notice：ledger-migrate 于 ORG_QUARANTINE_PATH、org-config 于 ORG_FLAGS_STATE 各在 CLI 预检后装载前向 stderr 打 default:/override: 单行（只显路径与来源·不读不印状态内容·stdout 机器格式不变），缺省行注明未设置使用缺省、覆盖行注明显式覆盖；向量㉒与 org-config 合法回归断言＋V-04 四组 notice 实录）——证据＝主仓 docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-04 | closed |
| b1n-cli-precheck | CLI 预检（参数组合前置校验）与 D-1 exit 家族映射未完全统一（CLI 预检 exit3 映射；round3 ds N 系） | 已处置（2026-10-30·B8·D-5 预检闭集：两脚本参数组合前置校验先于装载与任何写入——ledger 16 例与 org-config 15 例非法组合全真 exit 1（向量㉓/org 三向量），candidate 缺件/破损→3，破损配置下非法组合仍 1 而合法命令才 3，业务判红=1，2 永不发）——证据＝主仓 docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-04 | closed |
| b1n-v18-rerun | V-18 回退演练在 r3 后未复跑（向量面未变·路径等价成立但缺注记；round3 ds N 系） | 已处置（2026-10-30·B8·D-7 复跑：以冻结源只读副本建 /tmp 四件套五步真跑，rollback-step0-4-exit=0/1/0/0/0，步2 异常行三断言＋manifest 字节不变，source 717→718→719 仅旧账本副本追加，步4 health-scan --ledger RED=0，生产冻结源前后哈希不变）——证据＝主仓 docs/evidence/B8-migrator-hardening-impl-2026-10-30.md §V-06 | closed |
| b1n-doc-sync | 档面数字同步残留：任务书/审计面旧数字（自检向量 16→18 已同步·行数 360→414→438 链有旧值残留处） | closed（B2 面板/矩阵批随动清扫：B1 审计第 7 行终值 16→18、第 12 行 ledger-migrate 摘要 360→438 并补 §14 指针，grep 残留=0——证据=主仓 docs/evidence/B2-panel-matrix-impl-2026-10-29.md） | closed |
| b1n-projectrootof | org-config projectRootOf 死代码清理（round3 N-1 与审计申报不符项） | closed（B2 批复核：org-config.mjs 已无 projectRootOf，grep 计数=0 保持零出现、无删除动作虚构——证据=主仓 docs/evidence/B2-panel-matrix-impl-2026-10-29.md） | closed |
| b3n-flag-on-pending | 生产 b2_terms_v2 保持 off（on 态已在临时夹具全验证·但账本 748 行为首冻后新增词面红 1 处——主控裁决行用词失误·既有行禁改） | 已处置（2026-10-29 B4b 批收尾）：账本语义缺口经用户 exclude 豁免处置（b3n-ledger-frozen-gap 同日销账）后，主控切生产 b2_terms_v2 on（flags set·状态件已写）并亲跑生产矩阵全绿——五快扫 exit0（on 态 strict both）＋regression 8/8＋surface both exit0（active 0/新增 0/基线 136 件/495 组/691 次）＋agent-slots doctor FAIL0/WARN0＋主仓 verify-docs FAIL0/WARN2＋deploy-check ok64——证据=主仓账本 b4b-flag-on 行 | closed |
| b3n-ledger-frozen-gap | 活账本/流水持续追加与 historical 冻结计数语义冲突（设计缺口：首冻后任何新增含禁用词的账本行都使 strict historical 红·748 行即实例） | 已处置（2026-10-29 B4b 单点配置批·用户当面二选一 exclude 豁免）：terms_scan.historical 移出两仓账本与流水（skill 整规则删＋project 条目删）＋terms_scan.note 落政策与执法口径＋历史基线收缩 138 件/549 组/1239 次→136/495/691（--update 棘轮维持）＋同批改写词面新增 3 处（交接件 18 :11/:22＋B4 审计档 :95）；on 态 strict both exit=0——证据=主仓账本 b4b-ledger-exclude 行＋技能仓 terms-baseline diff | closed |
| b3n-pub-gate-legacy | pub-sanitize --out 四维门禁 9 命中（盘符夹具×4＋代号残留×5：SKILL.md:23／references/07:16/:17／terms-baseline note／agent-slots:684）＝HEAD 既有坏账（管线此前从未跑达门禁步·对照实证） | 已处置（2026-10-30 B5 批·用户裁决方案甲）：文档面代号×5 已随 B2-B4 绑定面 $max 化与词面改写自然补还（对账：原 9=文档 5+盘符 4·补还后 4+本批新识别本机绑定串 3=现 7）；A 组 3 处真实绑定串夹具清洗为中性串（deploy-check.mjs B4-D-3 组五值钉死＋org-config.mjs:929）＋B 组盘符夹具 4 处登记 share-whitelist synthetic_exempt（迁移器零源改）；门禁 7→0（V-01 分享包就绪零命中 exit0·实证部复算 8/8·裁决部 ACCEPT）——证据=主仓 docs/evidence/B5-pub-gate-impl-2026-10-29.md＋账本 b5-final-accept 行 | closed |
| b2n-vision-local-order | 本机件 role_fallbacks.vision 仍 3 项（面板有效序 glmflash→ds→699→startplan 补尾，异于矩阵出厂序 glmflash→startplan→ds→699）——用户面板动态基线域，非机检缺陷（org-config 校验只查首元与默认值一致，未对齐出厂序不阻） | 已处置（2026-10-30·B7 批）：本机 vision 序经真实面板 /api/order 唯一一次 POST 对齐矩阵出厂序 glmflash→startplan→ds→699，V-03 验证写前序＝装配 F-05 实读、validate 通过、.panel-bak 等于写前本机件、部署面 56 件零差异、剔除 vision 后全配置递归深等；现象列「仍 3 项」为登记时快照，装配 F-05 实读已为 4 项且顺序 glmflash→startplan→699→ds，本批只对齐 F-06 出厂序，现象列原文保留——证据＝主仓 docs/evidence/B7-panel-tools-impl-2026-10-30.md | closed |
| b4n-panel-polish | 面板打磨域缓议三件（B4 批双审 ds 席 N 级·主控裁定挂册）：①跨角色并发在途态重置（render() 重建按钮可用且新 runtime busy:false·先完成者 load() 重置他卡三态）②同角色档位保存在途重入无 obsolete/同一 runtime 守卫③writeLocal rename 后 validate 前崩溃窗留未验证配置且无 .panel-bak 恢复提示（低危·单人单页面板场景） | 已处置（2026-10-30·B7 面板批）：跨角色在途态保留＋同角色档位保存重入守卫＋.panel-bak 恢复提示三件已实现并验证（V-01 三分证：跨角色保留／同角色重入回归守卫／stale 完成隔离；V-02 四例：备份在场提示／缺席隐藏／recovery 键缺席隐藏／正常保存后提示仍在，零自动恢复）——证据＝主仓 docs/evidence/B7-panel-tools-impl-2026-10-30.md | closed |
| b5n-tb-evidence-minor | 任务书证据层两小缺口（B5 批 tbreview 轮 3 N×2＋implreview 席二 N-3 同族·主控裁定挂册）：①V-08.3 基线深等未覆盖 share-whitelist 顶层 `_note` 与新增顶层键拒斥（本批以 24+/0- numstat＋hunk 范围反证未动）②F 事实台账技能仓 HEAD 仅说明文字绑定、repo_head 字段记主仓头（taskbook-evidence verify 不校验该字段） | 已处置（2026-10-30·B7 批）：taskbook-evidence record 逐条新增 skill_head（SKILL_ROOT git HEAD 实读·与 repo_head 分源不混写），verify 执行命令前区分 legacy 全缺／新件全有两形态（后者须 7-40 位小写十六进制＋全件一致＋git cat-file 可解析，混排/混值/未知提交 exit 3 且零命令执行），自检 18→23 向量全绿，B7 台账为首件受益并经 V-04 深等重录验证；share-whitelist 的 _note 深等＋顶层键集相等正反证由 B7 任务书 V-08.3 探针承载（check-taskbook 本体零改）——证据＝主仓 docs/evidence/B7-panel-tools-impl-2026-10-30.md | closed |
| b2n-probe-residual | references/06:286-288 现役 runbook 残词「probe=进度文件回写」（B2 批删除面仅指定 :23/:25-27/:259/:143-144，:287 按禁扩面纪律保留——实现审计档 §7 第 3 条申报） | 下次动 references/06 时随批清账（删除或改写现役键）。已处置（2026-10-29 B3 批）：改写为 executor 承载（分笔 commit＋进度文件回写）——证据=主仓 docs/evidence/B3-terms-impl-2026-10-29.md | closed |
<!-- residuals-frozen: end -->
