# {{晨巡或夜巡}}看护档 {{日期}}（{{触发时刻}} 一次性任务·{{裁定标签}}）

> 状态：{{状态}} ｜ 权威：本件＋{{占用档件名}}（占用判定）＋账本 runId={{runId 与行号}} ｜ 更新：{{日期}} ｜ 替代：{{替代件或写无}}
> 复制至主仓 docs/evidence/ 后按占位替换：本件为技能仓模板（晨巡/夜巡共用，仅替换类型占位），全部 {{占位符}} 在复制后逐项替换为本会话实测值；禁止携带占位符入仓，禁止复制历史档实测数据（CI run 号、提交指纹、钟点一律现测现填）。

## 0. 会话与占用判定

- {{触发时刻与自动化标识}}。占用检测两轮实测判{{占用判定词}}：{{进程、文件活动、锁、工作流逐项摘要}}——实测清单见 {{占用档件名}}。
- {{链位次说明：前序兄弟会话与本会话次序}}。

## 1. 最新交接件甄别（三证据交叉）

①{{ls -t docs/evidence/handoff-*.md 顶件}}；②{{git log -- docs/evidence/ 最新入仓笔}}；③{{替代链终端件号}}。三证据一致：**最新交接件＝{{件号}}**（{{批次终态与账本行}}）。

## 2. no-batch/开工裁定（判断依据）

- {{上一交接件开工第一句逐项核对结论}}。
- {{两仓零新指示实测（find 与 status 摘要）}}。
- 依 {{依据链（交接件裁定＋任务书边界）}} → **{{本会话裁定}}**，转入 {{后续动作}}。

## 3. 体检口径表（六项·命令/关键输出/真实退出码均占位）

| # | 命令（主仓 cwd） | 关键输出 | 退出码 |
|---|---|---|---|
| 1 | node scripts/verify-docs.mjs | {{FAIL/WARN 计数}} | {{退出码}} |
| 2 | node /home/yyx/.zcode/skills/ai-dev-org/scripts/regression.mjs --project /home/yyx/work/aidevorg | {{通过数}} | {{退出码}} |
| 3 | node /home/yyx/.zcode/skills/ai-dev-org/scripts/check-anchors.mjs --strict | {{WARN/FAIL 计数}} | {{退出码}} |
| 4 | node /home/yyx/.zcode/skills/ai-dev-org/scripts/org-config.mjs validate | {{校验结果与 cfg 指纹}} | {{退出码}} |
| 5 | node /home/yyx/.zcode/skills/ai-dev-org/scripts/agent-slots.mjs doctor --project /home/yyx/work/aidevorg | {{red/warn/clean}} | {{退出码}} |
| 6 | node /home/yyx/.zcode/skills/ai-dev-org/scripts/health-scan.mjs --project /home/yyx/work/aidevorg | {{RED/WARN 与账本行计数}} | {{退出码}} |

- {{与上一交接件体检面逐项吻合说明与终验锚结论}}。

## 4. CI 核销

- {{待核销提交号、CI run 实测与双 job 结论占位；无待核销项则写无}}。

## 5. 偏离与裁决登记

- {{本会话偏离登记占位（含词面修复轮次，只登记行号与建议词）；无则写无}}。

## 6. 交接

- {{交接件号、账本行、随批入仓件清单}}。
- {{本会话两仓变更面说明与未触碰面}}。

## 词面防呆

- 写档后立即跑：node /home/yyx/.zcode/skills/ai-dev-org/scripts/check-terms.mjs --file <本档绝对路径>，rc=0 才并入体检实录；rc 非 0 时按明细行号与建议替换词修词后复跑。
- 描述修复只引命中行号与建议替换词，禁引命中原词（引用与描述场景不豁免词面执法）。
- {{本档快检 rc 与命中数实录占位}}。
