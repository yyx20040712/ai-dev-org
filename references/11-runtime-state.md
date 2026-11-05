# references/11 运行态执行规范（runtime state）

> 本件从 `docs/14-runtime-evolution.md`（设计语义权威）提炼技能侧执行规范，供 run-store/run-session/run-cutover 各批与契约夹具（`scripts/.golden/runtime-faults.json`）引用。docs/14 保持设计语义源，本件只持执行规范；二者冲突时以 docs/14 为准并在下批任务书登记。引用形态固定为 `docs/14-runtime-evolution.md:NN「片段」` 与 `docs/superpowers/plans/2026-11-04-ai-dev-org-systematic-waves.md:NN「片段」`（主仓计划源行），不使用其他锚形态。

## 1 范围与指针纪律

- 本件覆盖 authority/revision/highwater、写事务、session 注册表、effect 状态机、stop、cutover 双门与 journal、容量与 checkpoint-rebase 的执行口径，并登记 invariant 总表（第 12 节）。
- 执行规范单源指针：冻结状态×事件全表、stop 全域迁移、authority/highwater/lineage 规则（`docs/superpowers/plans/2026-11-04-ai-dev-org-systematic-waves.md:184「冻结状态×事件全表、stop 全域迁移、authority/highwater/lineage 规则」`）。
- schema 契约面落在 `templates/runtime/`（八件），事故台架落在 `scripts/.golden/runtime-faults.json`；本件不复制字段闭集，只登记执行规则与负例映射。
- 本批（RT0C）只建契约与全模拟夹具，不实现任何 runtime writer，不启动切换、试点或连续队列（`docs/superpowers/plans/2026-11-04-ai-dev-org-systematic-waves.md:192「删除新增契约与夹具，生产仍 legacy」`）。

## 2 legacy/runtime/shadow 与 fail-closed

- authority.mode 是唯一来源选择器（`docs/14-runtime-evolution.md:56「authority.mode 是唯一来源选择器」`）；最新有效交接是当前进程状态唯一来源（`docs/14-runtime-evolution.md:58「最新有效交接是当前进程状态唯一来源」`），authority record 指向的 run-state revision（`docs/14-runtime-evolution.md:59「authority record 指向的 run-state revision」`）。
- shadow 不是生产模式，只是离线模拟候选（`docs/14-runtime-evolution.md:60「不是生产模式，只是离线模拟候选」`）；shadow 必须 simulated=true。所有契约夹具 simulated 恒真，expected_exit=blocked 是台架期望字面值，不是操作系统退出码。
- runtime 下 state 缺失、损坏、hash 不符或 lineage 断裂时 fail closed（`docs/14-runtime-evolution.md:64「runtime 下 state 缺失、损坏、hash 不符或 lineage 断裂时 fail closed」`），不回落 legacy。

## 3 运行文件清单

运行文件职责与是否状态来源，以 `docs/14-runtime-evolution.md:70「文件/目录 | 职责 | 是否状态来源」` 表为准，执行侧固定口径：

- `state/<state_uuid>/r-<revision>.json`（`docs/14-runtime-evolution.md:72「state/<state_uuid>/r-<revision>.json」`）：不可变 revision，唯一状态来源。
- `projections/sessions/<session_uuid>/`（`docs/14-runtime-evolution.md:73「projections/sessions/<session_uuid>/」`）：会话公开投影，可重建。
- authority.json（`docs/14-runtime-evolution.md:74「authority.json」`）：来源选择器与指针。
- highwater.json（`docs/14-runtime-evolution.md:75「highwater.json」`）：已持久化最高 revision。
- lock（`docs/14-runtime-evolution.md:76「lock」`）：稳定锁。
- observations.jsonl（`docs/14-runtime-evolution.md:77「observations.jsonl」`）、session-events.jsonl（`docs/14-runtime-evolution.md:78「session-events.jsonl」`）、signals.jsonl（`docs/14-runtime-evolution.md:79「signals.jsonl」`）：追加型证据流。
- manifest.json（`docs/14-runtime-evolution.md:80「manifest.json」`）、candidates 目录（`docs/14-runtime-evolution.md:81「candidates/」`）与 shadow 目录（`docs/14-runtime-evolution.md:82「shadow/」`）：候选与影子面。
- 必须显式保留（`docs/14-runtime-evolution.md:84「必须显式保留」`）可追踪历史面；可追踪历史面不放在被忽略的运行目录（`docs/14-runtime-evolution.md:86「可追踪历史面不放在被忽略的运行目录」`）；cutover 审批与证据工件永久保存在可追踪的（`docs/14-runtime-evolution.md:88「cutover 审批与证据工件永久保存在可追踪的」`）仓库面。

## 4 authority record

- 字段闭集：`docs/14-runtime-evolution.md:95「record_revision / epoch / mode / state_uuid」、base_revision + base_hash（`docs/14-runtime-evolution.md:96「base_revision + base_hash」`）、current_revision + current_hash（`docs/14-runtime-evolution.md:97「current_revision + current_hash」`）、controller_operation_id / mode_change_approval_ref（`docs/14-runtime-evolution.md:98「controller_operation_id / mode_change_approval_ref」`）、journal_generation + journal_head_hash（`docs/14-runtime-evolution.md:99「journal_generation + journal_head_hash」`）。
- 普通 writer 只能更新 current 指针（`docs/14-runtime-evolution.md:104「普通 writer 只能更新 current 指针」`）；state schema 禁止 mode 或独立 feature-flag 字段（`docs/14-runtime-evolution.md:105「state schema 禁止 mode 或独立 feature-flag 字段」`）；CI 从 record 派生 mode/epoch 的 deny-only 规则（`docs/14-runtime-evolution.md:106「CI 从 record 派生 mode/epoch 的 deny-only 规则」`）；模式切换只能由主控调用的 cutover CLI 写入（`docs/14-runtime-evolution.md:107「模式切换只能由主控调用的 cutover CLI 写入」`）。
- base 字段只用于 lineage（`docs/14-runtime-evolution.md:108「base 字段只用于 lineage」`）；highwater 记录每个 state_uuid 已持久化的最高（`docs/14-runtime-evolution.md:109「highwater 记录每个 state_uuid 已持久化的最高」`）；record 损坏或 highwater 不一致即阻断，不回落 legacy（`docs/14-runtime-evolution.md:110「record 损坏或 highwater 不一致即阻断，不回落 legacy」`），只允许离线重建候选（`docs/14-runtime-evolution.md:110「离线重建候选」`）。

## 5 revision、canonical JSON 与 self_hash

- 每个 revision 至少包含：`docs/14-runtime-evolution.md:117「schema / state_uuid / revision / owner_session_id」、parent_revision + parent_hash / self_hash（`docs/14-runtime-evolution.md:118「parent_revision + parent_hash / self_hash」`）、producer_operation（`docs/14-runtime-evolution.md:119「producer_operation（cutover stop/confirm/resume/recoverForward 产生的 revision 必填）」`）、active_run / queue / effects / authorization / reviews / sessions / pending_closures（`docs/14-runtime-evolution.md:120「active_run / queue / effects / authorization / reviews / sessions / pending_closures」`）与 applied_operations / pending_audit（`docs/14-runtime-evolution.md:121「applied_operations / pending_audit」`）。
- canonical JSON 规则：递归键排序、UTF-8、禁止浮点（`docs/14-runtime-evolution.md:134「canonical JSON 规则：递归键排序、UTF-8、禁止浮点」`），序列化无空白；self_hash 对除 self_hash 与 producer_operation.hash 外的全部字段重算，producer_operation 仅 cutover 四操作产生的 revision 必填，其余 absent（absent 表示字段不存在而不是 null，`docs/14-runtime-evolution.md:163「absent 表示字段不存在而不是 null」`）。
- authorization.controller={session_uuid,assigned_at,released_at,evidence_ref,blocked}（`docs/14-runtime-evolution.md:128「authorization.controller={session_uuid,assigned_at,released_at,evidence_ref,blocked}」`），session_uuid=null（`docs/14-runtime-evolution.md:128「session_uuid=null」`）、released_at 为空（`docs/14-runtime-evolution.md:128「released_at 为空」`）、assigned_at 可空（shadow controller 初值 assigned_at:null，`docs/14-runtime-evolution.md:399「evidence_ref:null」` 同线明文）均表示可空占位；active_run={session_uuid,run_uuid}|null（`docs/14-runtime-evolution.md:130「active_run={session_uuid,run_uuid}|null」`），其他会话的 current_run 必须为空（`docs/14-runtime-evolution.md:130「其他会话的 current_run 必须为空」`）。

## 6 写事务六步

写事务固定顺序：（`docs/14-runtime-evolution.md:136「写事务固定顺序：」`）

1. 获取稳定锁并校验 expected current revision、operation_id（`docs/14-runtime-evolution.md:138「获取稳定锁并校验 expected current revision、operation_id」`）；
2. 写入新的不可变 revision（`docs/14-runtime-evolution.md:139「写入新的不可变 revision」`）；
3. fsync 文件、fsync 父目录、回读并校验 self-hash（`docs/14-runtime-evolution.md:140「fsync 文件、fsync 父目录、回读并校验 self-hash」`）；
4. 持久化 highwater（`docs/14-runtime-evolution.md:141「持久化 highwater」`）；
5. 原子发布 authority record（`docs/14-runtime-evolution.md:142「原子发布 authority record」`）；
6. 校验 current 文件 hash 和 parent-hash lineage（`docs/14-runtime-evolution.md:143「校验 current 文件 hash 和 parent-hash lineage」`）。

任一步失败即按 fail-closed 处理：IO/装载失败以退出码 3 暴露，hash/lineage 不可信按安全阻断处理，不发布半状态、不前进 current 指针。

## 7 session 注册表与 controller

- SessionDescriptor.role 只能是 controller/worker/recovery（`docs/14-runtime-evolution.md:145「SessionDescriptor.role 只能是 controller/worker/recovery」`）；所有 assignController 必须原子递增 authorization.controller_epoch（`docs/14-runtime-evolution.md:147「所有 assignController 必须原子递增 authorization.controller_epoch」`）。
- 会话公开投影位于（`docs/14-runtime-evolution.md:299「会话公开投影位于」`）projections 面；每个会话保存不可变的（`docs/14-runtime-evolution.md:303「每个会话保存不可变的」`）事件流；项目仍只有单 active run 和单控制会话（`docs/14-runtime-evolution.md:305「项目仍只有单 active run 和单控制会话」`）。
- lifecycle 六态 OPEN / IDLE / CLOSING / CLOSED / INTERRUPTED / UNKNOWN（`docs/14-runtime-evolution.md:312「OPEN / IDLE / CLOSING / CLOSED / INTERRUPTED / UNKNOWN」`）；work_outcome 八态 IN_PROGRESS / WAITING_USER / BLOCKED / STALLED（`docs/14-runtime-evolution.md:318「IN_PROGRESS / WAITING_USER / BLOCKED / STALLED」`）与 DONE / DONE_WITH_CONCERNS / STOPPED / UNKNOWN（`docs/14-runtime-evolution.md:319「DONE / DONE_WITH_CONCERNS / STOPPED / UNKNOWN」`）；心跳过期只能转 lifecycle UNKNOWN（`docs/14-runtime-evolution.md:325「心跳过期只能转 lifecycle UNKNOWN」`），重复扫描必须幂等，且不得转 CLOSED/DONE（`docs/14-runtime-evolution.md:329「重复扫描必须幂等，且不得转 CLOSED/DONE」`）。
- 新会话接续旧工作时生成新 session_uuid＋resume_of（`docs/14-runtime-evolution.md:327「新会话接续旧工作时生成新 session_uuid＋resume_of」`）；successor 在 close 时可为 null（`docs/14-runtime-evolution.md:333「successor 在 close 时可为 null」`）；已结束但仍存在未解决事项的会话留在“需关注”（`docs/14-runtime-evolution.md:341「已结束但仍存在未解决事项的会话留在“需关注”」`）；重跑投影必须按 hash 幂等补齐（`docs/14-runtime-evolution.md:347「重跑投影必须按 hash 幂等补齐」`）。

## 8 effect 十二态×事件全表

十二态：queued / scheduled / retry_scheduled / claimed（`docs/14-runtime-evolution.md:230「queued / scheduled / retry_scheduled / claimed」`）、running / awaiting_receipt / stop_pending（`docs/14-runtime-evolution.md:231「running / awaiting_receipt / stop_pending」`）、done / failed / skipped / cancelled / unknown（`docs/14-runtime-evolution.md:232「done / failed / skipped / cancelled / unknown」`）。事件闭集 14 列：schedule、retry_schedule、claim、start、stop、preclaim_skip、receipt_done、receipt_failed、receipt_cancelled、receipt_timeout、late_receipt、reconcile_done、reconcile_failed、reconcile_cancelled。每格语法＝主目标态；条件注记。

<!-- effect-state-matrix:start -->
| state | schedule | retry_schedule | claim | start | stop | preclaim_skip | receipt_done | receipt_failed | receipt_cancelled | receipt_timeout | late_receipt | reconcile_done | reconcile_failed | reconcile_cancelled |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| queued | scheduled；入定时队列 | retry_scheduled；重试定时入列 | claimed；先核对 claimToken 七字段 | deny；未取得 claimToken 禁止启动 | cancelled；清定时器 | skipped；条件未满足且有无副作用证据 | no-op；未开始无回执可收 | no-op；未开始无回执可收 | no-op；未开始无回执可收 | no-op；未开始无回执可收 | no-op；无在途调用无迟到回执 | no-op；未开始无可对账 | no-op；未开始无可对账 | no-op；未开始无可对账 |
| scheduled | no-op；已在定时列 | retry_scheduled；重试定时入列 | claimed；先核对 claimToken 七字段 | deny；未取得 claimToken 禁止启动 | cancelled；清定时器 | skipped；条件未满足且有无副作用证据 | no-op；未开始无回执可收 | no-op；未开始无回执可收 | no-op；未开始无回执可收 | no-op；未开始无回执可收 | no-op；无在途调用无迟到回执 | no-op；未开始无可对账 | no-op；未开始无可对账 | no-op；未开始无可对账 |
| retry_scheduled | no-op；已在定时列 | no-op；已在重试定时列 | claimed；先核对 claimToken 七字段 | deny；未取得 claimToken 禁止启动 | cancelled；清定时器 | skipped；条件未满足且有无副作用证据 | no-op；未开始无回执可收 | no-op；未开始无回执可收 | no-op；未开始无回执可收 | no-op；未开始无回执可收 | no-op；无在途调用无迟到回执 | no-op；未开始无可对账 | no-op；未开始无可对账 | no-op；未开始无可对账 |
| claimed | no-op；已过入列期 | no-op；已认领不排重试 | deny；重复认领拒绝 | running；真实执行前置 assertExecutable | stop_pending；cancelled（仅有未发起证据）分支否则停等 | no-op；已过 pre-claim 窗口 | no-op；尚未发起调用无回执 | no-op；尚未发起调用无回执 | no-op；尚未发起调用无回执 | no-op；尚未发起调用无回执 | no-op；无在途调用 | no-op；无未解决回执 | no-op；无未解决回执 | no-op；无未解决回执 |
| running | no-op；执行中不入列 | no-op；执行中不排重试 | deny；已在执行禁止重复认领 | no-op；已运行 | stop_pending；在途调用停等回执 | no-op；已过 pre-claim 窗口 | done；正常回执落终态 | failed；失败回执落终态 | cancelled；取消回执落终态 | unknown；回执超时未解决 | no-op；以当前回执为准 | no-op；以回执为准 | no-op；以回执为准 | no-op；以回执为准 |
| awaiting_receipt | no-op；等待回执期不入列 | no-op；等待回执期不排重试 | deny；等待回执期禁止认领 | no-op；已发起 | stop_pending；在途调用停等回执 | no-op；已过 pre-claim 窗口 | done；正常回执落终态 | failed；失败回执落终态 | cancelled；取消回执落终态 | unknown；回执超时未解决 | no-op；以当前回执为准 | no-op；以回执为准 | no-op；以回执为准 | no-op；以回执为准 |
| stop_pending | no-op；停等期不再入列 | no-op；停等期不排重试 | deny；停等期禁止新认领 | deny；停等期禁止启动 | stop_pending；保持未解决且重复 stop 幂等 | no-op；已过 pre-claim 窗口 | done；停等回执落终态 | failed；停等回执落终态 | cancelled；停等回执落终态 | unknown；无回执超时转未知 | unknown；迟到回执先置未知 | done；凭证对账落终态 | failed；凭证对账落终态 | cancelled；凭证对账落终态 |
| done | no-op；终态不变 | no-op；retry 另立新 effect_id＋retry_of 本条不变 | deny；终态禁止认领 | deny；终态禁止启动 | no-op；终态 | no-op；终态不变 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态不变 | no-op；终态不变 | no-op；终态不变 |
| failed | no-op；终态不变 | no-op；retry 另立新 effect_id＋retry_of 本条不变 | deny；终态禁止认领 | deny；终态禁止启动 | no-op；终态 | no-op；终态不变 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态不变 | no-op；终态不变 | no-op；终态不变 |
| skipped | no-op；终态不变 | no-op；retry 另立新 effect_id＋retry_of 本条不变 | deny；终态禁止认领 | deny；终态禁止启动 | no-op；终态 | no-op；终态不变 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态不变 | no-op；终态不变 | no-op；终态不变 |
| cancelled | no-op；终态不变 | no-op；retry 另立新 effect_id＋retry_of 本条不变 | deny；终态禁止认领 | deny；终态禁止启动 | no-op；终态 | no-op；终态不变 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态幂等 | no-op；终态不变 | no-op；终态不变 | no-op；终态不变 |
| unknown | no-op；阻断中不变 | deny；未解决前禁止重试排期 | deny；阻断中禁止认领 | deny；阻断中禁止启动 | unknown；保持并阻断 | no-op；非 pre-claim 窗口 | unknown；回执须凭证 reconcile 才终态 | unknown；回执须凭证 reconcile 才终态 | unknown；回执须凭证 reconcile 才终态 | unknown；保持未解决 | unknown；迟到回执先置未知 | done；凭证对账落终态 | failed；凭证对账落终态 | cancelled；凭证对账落终态 |
<!-- effect-state-matrix:end -->

全表锁定规则：

- skipped 只能由 pre-claim 的条件未满足事件产生（`docs/14-runtime-evolution.md:239「skipped 只能由 pre-claim 的条件未满足事件产生」`），且必须有无副作用证据；缺证据即 deny。
- claimed 只有取得“尚未发起调用”的明确证据时才可 cancelled（`docs/14-runtime-evolution.md:236「claimed 只有取得“尚未发起调用”的明确证据时才可 cancelled」`）。
- running/awaiting_receipt 在 stop 时置 stop_pending（`docs/14-runtime-evolution.md:237「running/awaiting_receipt 在 stop 时置 stop_pending」`）；stop_pending 无回执时保持未解决（`docs/14-runtime-evolution.md:238「stop_pending 无回执时保持未解决」`），超时转 unknown；unknown 是对自动化非终态、对恢复未解决（`docs/14-runtime-evolution.md:240「unknown 是对自动化非终态、对恢复未解决」`）。
- 迟到回执先置 unknown 再凭证据 reconcile 到 done/failed/cancelled；只有 runtime 且 simulated=false 的真实 observation 可参与 reconcile，shadow/legacy 模拟面不得改变权威状态。
- 终态 retry 必须新 effect_id＋retry_of 指向旧 effect_id（区别于 operation retry；operation retry 是同一 operationRef 的幂等重放）。
- done/failed/skipped/cancelled 为终态（`docs/14-runtime-evolution.md:241「done/failed/skipped/cancelled 为终态」`）；重复 stop 不制造重复迁移、不增 stop_epoch，已撤权且无未解决效果时返回当前 revision；authority.epoch 不因普通 stop 改变。

## 9 stop 与 assertExecutable

- stop 在同一稳定锁事务中撤销 mandate（`docs/14-runtime-evolution.md:243「stop 在同一稳定锁事务中撤销 mandate」`）；未开始三态（queued/scheduled/retry_scheduled）在 stop 时取消并清定时器。
- 每次真实执行前必须调用（`docs/14-runtime-evolution.md:245「每次真实执行前必须调用」`）assertExecutable（`docs/14-runtime-evolution.md:245「assertExecutable」`）。契约：同锁自读 authority、state、highwater、journal，核对 effect、claimToken 七字段（state_uuid、session_uuid、controller_epoch、effect_id、stop_epoch、operation_id、claimed_revision）、claimed_revision 与 journal generation/headHash 一致；拒绝调用方快照与任何额外快照参数。
- 冻结面：stopping、preparing、prepared、confirming、recovering 及 abandoned 且无 resumeRef 全冻结；锁异常、读取异常、hash 不符、lineage 断裂、highwater 不一致、current revision 校验失败全 deny；本规范不宣称宿主 fencing。

## 10 cutover 双门与 journal

- cutover 使用双门两阶段协议（`docs/14-runtime-evolution.md:149「cutover 使用双门两阶段协议」`）；allowedCallers 闭集对象含 principal 与 callerSessionId，host 恢复可显式 callerSessionId:null（`docs/14-runtime-evolution.md:149「callerSessionId:null」`）。
- operationRef={operationId,kind,parentRevision,parentHash,revision,hash,epoch,stopEpoch}（`docs/14-runtime-evolution.md:153「operationRef={operationId,kind,parentRevision,parentHash,revision,hash,epoch,stopEpoch}」`）；CutoverJournal{schema,generation,previousHeadHash,headHash,entries[]}（`docs/14-runtime-evolution.md:155「CutoverJournal{schema,generation,previousHeadHash,headHash,entries[]}」`）；prepare 先构造（`docs/14-runtime-evolution.md:157「prepare 先构造」`）候选与 journal 锚。
- 进入 confirming 后 abandon/resume 均 deny（`docs/14-runtime-evolution.md:159「进入 confirming 后 abandon/resume 均 deny」`）；中止或 resume 只允许 stopping/preparing/prepared 及 abandoned 且无 resumeRef（`docs/14-runtime-evolution.md:161「中止或 resume 只允许 stopping/preparing/prepared 及 abandoned 且无 resumeRef」`）。
- journal 字段采用闭集；前态字段只增不删（`docs/14-runtime-evolution.md:163「journal 字段采用闭集；前态字段只增不删」`）——前态指演进累积：preparing/prepared 引入的 candidatePath/candidateRef 在 confirming/confirmed/abandoned 中仍允许存在，未列字段禁填；状态×允许字段全表以 `docs/14-runtime-evolution.md:165「status | 允许字段（在基类/前态上新增）」` 为准。
- confirmedRef 固定为（`docs/14-runtime-evolution.md:173「confirmedRef 固定为」）五键，candidateHash=原 confirmed.candidateRef.hash（`docs/14-runtime-evolution.md:173「candidateHash=原 confirmed.candidateRef.hash」`）；recoverForward 显式接收 confirmedOperationId（`docs/14-runtime-evolution.md:175「recoverForward 显式接收 confirmedOperationId」`）；不提供状态回滚接口，也不在本规划内切回 legacy（`docs/14-runtime-evolution.md:177「不提供状态回滚接口，也不在本规划内切回 legacy」`）。
- highwater 高于 authority 表示发布未完成，必须阻断并显式对账（`docs/14-runtime-evolution.md:179「highwater 高于 authority 表示发布未完成，必须阻断并显式对账」`）；orphan 不自动删除（`docs/14-runtime-evolution.md:181「orphan 不自动删除」`）。
- 审批只单向链接（`docs/superpowers/plans/2026-11-04-ai-dev-org-systematic-waves.md:182「审批只单向链接」`）；entryHash/headHash 计算排除自身；工件不得反存 Ruling hash。

## 11 容量与 checkpoint-rebase

- 初始上限（`docs/14-runtime-evolution.md:185「初始上限：queue 32、未决 effects 64、applied operations 256」`）：queue=32、未决 effects=64、applied operations=256、state=1 MiB、每 state_uuid revision=512（orphan 计入）。任一上限触发即 blocked 新 claim。
- 唯一人工出口是用户另批的 checkpoint-rebase（`docs/14-runtime-evolution.md:187「唯一人工出口是用户另批的 checkpoint-rebase」`）：前置零未解决 effects 且 closure head/count 追平，随后新 epoch、新 state_uuid、新 stop_epoch，撤销旧 token，保留旧版本；容量夹具必须写明预期 blocked 和人工 checkpoint-rebase 出口（`docs/superpowers/plans/2026-11-04-ai-dev-org-systematic-waves.md:188「容量夹具必须写明预期 blocked 和人工 checkpoint-rebase 出口」`）。checkpoint-rebase 不是自动 compaction。

## 12 invariant 登记表

登记口径：id 形态 INV-NN-NNN，A/B/C/D 族分别用 01/02/03/04 前缀；每个 id 至少一个 negative fixture，negative_fixture_ids 列全该 invariant 的全部负例；与 `scripts/.golden/runtime-faults.json` 双向对账，孤岛 invariant 与野 id 均违规。

<!-- invariant-registry:start -->
| invariant_id | family | invariant | source_ref | negative_fixture_ids |
|---|---|---|---|---|
| INV-01-001 | A | cutover 断点一：stopping 后 stop state 前，仅原 prepare 续作且 revision 不增 | docs/14-runtime-evolution.md:138「获取稳定锁并校验 expected current revision、operation_id」 | F-A-01 |
| INV-01-002 | A | cutover 断点二：stop state 后 highwater 前，原 stopRef 精确认领补 highwater 与 authority，不新增 revision | docs/14-runtime-evolution.md:141「持久化 highwater」 | F-A-02 |
| INV-01-003 | A | cutover 断点三：live stop 后候选写入前，按 G1a 固定值重建同 candidateHash | docs/14-runtime-evolution.md:157「prepare 先构造」 | F-A-03 |
| INV-01-004 | A | cutover 断点四：confirming 后 candidate state 前 abandon 与 resume 均 deny，只准原 confirm | docs/14-runtime-evolution.md:159「进入 confirming 后 abandon/resume 均 deny」 | F-A-04 |
| INV-01-005 | A | cutover 断点五：candidate state 后 highwater 前，原 candidateRef 续作不新增 revision | docs/14-runtime-evolution.md:141「持久化 highwater」 | F-A-05 |
| INV-01-006 | A | cutover 断点六：highwater 后 authority 前阻断普通写并补发布与回读校验 | docs/14-runtime-evolution.md:179「highwater 高于 authority 表示发布未完成，必须阻断并显式对账」 | F-A-06 |
| INV-01-007 | A | confirmed journal 与 authority 锚未齐则冻结终点未达，终态幂等前先补锚 | docs/14-runtime-evolution.md:143「校验 current 文件 hash 和 parent-hash lineage」 | F-A-07 |
| INV-01-008 | A | abandoned 无 resumeRef 只允许原 resume，普通写 deny | docs/14-runtime-evolution.md:161「中止或 resume 只允许 stopping/preparing/prepared 及 abandoned 且无 resumeRef」 | F-A-08 |
| INV-01-009 | A | stop 未提交但 resume revision 已存在时只续 highwater、authority 与 resumeRef | docs/14-runtime-evolution.md:139「写入新的不可变 revision」 | F-A-09 |
| INV-01-010 | A | resume state 后 resumeRef 前，同 resumeOperation 续作不新增 revision | docs/14-runtime-evolution.md:139「写入新的不可变 revision」 | F-A-10 |
| INV-01-011 | A | recovering 与 recovered 各断点仅原 recoveryRef 续作，非原引用 deny，recovery.assignedAt 必须等于 recoveryTimestamp | docs/14-runtime-evolution.md:175「recoverForward 显式接收 confirmedOperationId」 | F-A-11b,F-A-11c,F-A-11d,F-A-17 |
| INV-01-012 | A | recovered 新条目与旧链头 recoveredBy 必须同批，journal 与 authority 锚一致 | docs/14-runtime-evolution.md:173「confirmedRef 固定为」 | F-A-12a,F-A-12b |
| INV-02-003 | B | 精确 orphan 唯一认领，同 operationId 错误 hash 即 blocked | docs/14-runtime-evolution.md:181「orphan 不自动删除」 | F-B-03 |
| INV-02-004 | B | 单一 operationRef 重放幂等不新增 revision，未知后代与非法 resume base 均 blocked | docs/14-runtime-evolution.md:119「producer_operation（cutover stop/confirm/resume/recoverForward 产生的 revision 必填）」 | F-B-04a,F-B-04b |
| INV-02-005 | B | 复合损坏并存按 blocked 聚合面报告且不自动删除 | docs/14-runtime-evolution.md:64「runtime 下 state 缺失、损坏、hash 不符或 lineage 断裂时 fail closed」 | F-B-05 |
| INV-02-006 | B | G1a 审批绑定错配 deny 且不写 stopping | docs/14-runtime-evolution.md:149「cutover 使用双门两阶段协议」 | F-B-06 |
| INV-02-007 | B | G1b 审批或 candidate 绑定错配 deny 且不进 confirming | docs/14-runtime-evolution.md:399「G1b candidate confirm」 | F-B-07 |
| INV-02-008 | B | 调用方额外快照参数 schema deny | docs/14-runtime-evolution.md:245「assertExecutable」 | F-B-08 |
| INV-02-010 | B | confirmed 到 R1 再 R2 正向链：recoveredBy 与 recoveryRef 逐字段相等，confirmedRef 都指原 candidateRef | docs/14-runtime-evolution.md:173「candidateHash=原 confirmed.candidateRef.hash」 | F-B-10 |
| INV-02-011 | B | confirmedRef.candidateHash 必须等于原 candidateRef.hash | docs/14-runtime-evolution.md:173「candidateHash=原 confirmed.candidateRef.hash」 | F-B-11 |
| INV-02-012 | B | 多活动 operation 拒启，journal 与 authority 锚分叉只允许原 operation 验链补锚 | docs/14-runtime-evolution.md:155「CutoverJournal{schema,generation,previousHeadHash,headHash,entries[]}」 | F-B-12a,F-B-12b |
| INV-02-013 | B | mandate revoked=true 后任何使用均 deny | docs/14-runtime-evolution.md:243「stop 在同一稳定锁事务中撤销 mandate」 | F-B-13 |
| INV-03-001 | C | stop retry 同 operation 幂等，在途 stop 置 stop_pending，无 fencing 竞态 unknown，effect retry 新 effect_id 加 retry_of，重复 result 冲突 deny | docs/14-runtime-evolution.md:237「running/awaiting_receipt 在 stop 时置 stop_pending」 | F-C-02a,F-C-02b,F-C-18,F-C-19 |
| INV-03-003 | C | 不同 operation 重复 stop 不重复迁移，已撤权且无未解决效果不增 epoch 与 revision | docs/14-runtime-evolution.md:236「claimed 只有取得“尚未发起调用”的明确证据时才可 cancelled」 | F-C-03 |
| INV-03-004 | C | skipped 仅 pre-claim 条件不满足且有无副作用证据，缺证据 deny | docs/14-runtime-evolution.md:239「skipped 只能由 pre-claim 的条件未满足事件产生」 | F-C-04b |
| INV-03-005 | C | stop_pending 无回执保持未解决，超时转 unknown | docs/14-runtime-evolution.md:238「stop_pending 无回执时保持未解决」 | F-C-05 |
| INV-03-006 | C | 迟到回执先 unknown 再凭证据 reconcile 到 done、failed、cancelled，模拟 observation 不得改权威状态 | docs/14-runtime-evolution.md:240「unknown 是对自动化非终态、对恢复未解决」 | F-C-06d |
| INV-03-007 | C | ENOSPC 等 IO 失败退出码 3 且不发布半状态 | docs/14-runtime-evolution.md:64「runtime 下 state 缺失、损坏、hash 不符或 lineage 断裂时 fail closed」 | F-C-07 |
| INV-03-008 | C | 文件或父目录 fsync 失败退出码 3 且 current 不前进 | docs/14-runtime-evolution.md:140「fsync 文件、fsync 父目录、回读并校验 self-hash」 | F-C-08a,F-C-08b |
| INV-03-009 | C | readback 与 self_hash 不符按 IO 失败，hash 与 lineage 不可信按安全阻断 | docs/14-runtime-evolution.md:140「fsync 文件、fsync 父目录、回读并校验 self-hash」 | F-C-09a,F-C-09b |
| INV-03-010 | C | authority 损坏 fail closed，只从不可变 revision、highwater 与审计离线重建候选，recoverScan 返回两个 base revision，批准后新 epoch | docs/14-runtime-evolution.md:110「离线重建候选」 | F-C-10 |
| INV-03-011 | C | pending_audit 非零阻断 cutover 与 close | docs/14-runtime-evolution.md:121「applied_operations / pending_audit」 | F-C-11 |
| INV-03-012 | C | 投影失败保留完整 closure，重跑按 hash 幂等补齐后才允许后续裁剪，state 不存 projection_refs | docs/14-runtime-evolution.md:347「重跑投影必须按 hash 幂等补齐」 | F-C-12 |
| INV-03-013 | C | 冻结期定时器不得发起效果，signal 永远不能证明执行 | docs/14-runtime-evolution.md:243「stop 在同一稳定锁事务中撤销 mandate」 | F-C-13 |
| INV-03-014 | C | assign 或 rebase 后旧 state_uuid、controller_epoch、stop_epoch、claimed_revision 的 claimToken deny | docs/14-runtime-evolution.md:147「所有 assignController 必须原子递增 authorization.controller_epoch」 | F-C-14 |
| INV-03-015 | C | 容量上限 blocked 新 claim 且禁 rebase，零未解决且 closure 追平后仅人工 checkpoint-rebase 出口 | docs/14-runtime-evolution.md:187「唯一人工出口是用户另批的 checkpoint-rebase」 | F-C-15a |
| INV-04-001 | D | 双会话同项目仍单 active run 与单 controller，第二 active run deny | docs/14-runtime-evolution.md:305「项目仍只有单 active run 和单控制会话」 | F-D-01 |
| INV-04-002 | D | 相同 legacy runId 裸查询报错并要求 session_uuid 消歧 | docs/superpowers/plans/2026-11-04-ai-dev-org-systematic-waves.md:187「增加双会话同项目、相同 runId、会话隔离」 | F-D-02 |
| INV-04-003 | D | worker 只能写 inbox，直接项目写 deny | docs/superpowers/plans/2026-11-04-ai-dev-org-systematic-waves.md:187「增加双会话同项目、相同 runId、会话隔离」 | F-D-03 |
| INV-04-004 | D | 并发 assign 仅一个 expectedRevision 成功且 controller_epoch 原子递增 | docs/14-runtime-evolution.md:147「所有 assignController 必须原子递增 authorization.controller_epoch」 | F-D-04c |
| INV-04-005 | D | 配置快照不可变，配置变化只影响新会话，policy_hash 与 cfg_hash 不混用 | docs/14-runtime-evolution.md:353「session_uuid/project_id/kind/role/started_at」 | F-D-05 |
| INV-04-007 | D | 控制会话 sweep 前崩溃可凭超时证据经批准 recovery 接管，复起生成新 session_uuid 加 resume_of | docs/14-runtime-evolution.md:327「新会话接续旧工作时生成新 session_uuid＋resume_of」 | F-D-07 |
| INV-04-008 | D | 心跳过期仅 lifecycle UNKNOWN 加 controller.blocked 且不得 CLOSED 或 DONE，非法 work_outcome 与 end_reason 组合 deny | docs/14-runtime-evolution.md:325「心跳过期只能转 lifecycle UNKNOWN」 | F-D-06,F-D-08b |
| INV-04-010 | D | 最近历史默认 10、可配 5、10、20，完整历史仍可分页 | docs/14-runtime-evolution.md:339「最近历史」 | F-D-10 |
| INV-04-011 | D | state 先提交 closure head 与 count，归档滞后 coverage 为 stale，重跑幂等补齐前禁裁剪 | docs/14-runtime-evolution.md:347「重跑投影必须按 hash 幂等补齐」 | F-D-11 |
| INV-04-012 | D | 已结束但有未解决事项的会话始终留在需关注，不受最近历史条数隐藏 | docs/14-runtime-evolution.md:341「已结束但仍存在未解决事项的会话留在“需关注”」 | F-D-12 |
<!-- invariant-registry:end -->

登记表与台架对账口径：所有 runtime-faults 的 invariant_id 必须在本表登记，所有登记 id 至少被一条 fixture 使用；F-C-04a 为正例、F-C-04b 为负例同载一条 invariant；F-D-08 为正例、F-D-08b 为负例同载；本表 negative_fixture_ids 只列负例，正例同载关系由 fixture 的 polarity 字段承载。每条安全不变量至少一个负例（`docs/superpowers/plans/2026-11-04-ai-dev-org-systematic-waves.md:191「每条安全不变量至少一个负例」`）。
