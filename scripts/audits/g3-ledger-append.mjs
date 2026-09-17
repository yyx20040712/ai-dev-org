// g3 批收口账本补记（主控专用一次性脚本——行 schema v2 单源=references/02 §9）
import { appendFileSync } from 'node:fs'

const ts = new Date().toISOString()
const base = { schema_version: 2, project: 'ai-dev-org', cfg_hash: '20254429f008', usage: { in: 0, out: 0 }, mocked: false, truncated: false }
const rows = [
  { ...base, ts, runId: 'g3-executor', event: 'ok', role: 'ops-executor', tier: 'session:model-field', source: 'builtin:bigmodel-coding-plan',
    outcome: 'v1.7.6 三残留清偿批实现（b1 cliFlag 三校验+四消费点+ds-call-v2 收编/b2 deploy 派生/b3 术语 00 件+R8 扩展）+回炉轮 1（R1-R4）+轮 2（R5）；TDD 红/绿/变异红证四份在档；LEDGER-CLAIM EXECUTOR=model-field:ops-executor（报告尾栏）。subagent_tokens≈11.1M（三轮累计）' },
  { ...base, ts, runId: 'g3-gate1', event: 'ok', role: 'gate1-reviewer', tier: 'session:model-field', source: 'model-field:b2466f8b-9d89-4428-a38e-c2aca1c41d0e/k3',
    outcome: '隔离一审三轮（log-triage --health 推荐 k1）：首轮 PASS B=0/W=3/N=6→回炉 r1 四项处置→复审 PASS B=0/W=1/N=3（W1-r1 新发现）→轮 2 处方微修→微确认 PASS B=0/W=0/N=1；三轮 MODEL-SELF 自证绑定零回退（06 §6 补遗免欠账口径）。subagent_tokens≈324k' },
  { ...base, ts, runId: 'g3-probe', event: 'ok', role: 'ops-probe', tier: 'session:model-field', source: 'builtin:bigmodel-coding-plan',
    outcome: '门二实证矩阵 8/8（自检三件/回归扫描四件/用法错五路/变异抽钉零残留/坏覆盖件真机注入/b2 本机形态/b3 指针抽核 5-5/白名单对账）；机械重跑面（同源在册 evolve-gate2-samesource，判断性结论由裁决部异构承载）。subagent_tokens≈597k' },
  { ...base, ts, runId: 'g3-adjudicator', event: 'ok', role: 'ops-adjudicator', tier: 'session:model-field', source: 'model-field:8ad55776-2296-4f1a-bc46-05755c8f1300/deepseek-flash',
    outcome: '门二终审裁决 VERDICT=放行（B=0/W=0/N=5）：逐条 CONFIRMED/REJECTED/ESCALATED+独立复算 R-1~R-4+无佐证断言点名表 12 条+P0-P3 处置清单；P1 收编与 R2 守卫后移假设拷问均裁定成立。subagent_tokens≈66k' },
  { ...base, ts, runId: 'g3-r1-real', event: 'ok', role: 'gate1-reviewer', tier: 'audit', source: 'kimi-main+deepseek（双源抽样）',
    outcome: 'R1 真实派发语义抽样 3/3 双源方向一致（S1 断言弱化 FAIL/S2 干净 PASS/S3 占位残留 FAIL 全对期望）；volta Node 24 跑，零退出崩溃——派发器 flag 收编后端到端实证；用量落流水（model-routing-log，派发器自动记账）。regression 1/1 过 exit=0' },
  { ...base, ts, runId: 'g3-v176-closure', event: 'ruling', role: 'main-control', tier: 'session:host-tier', source: 'session',
    outcome: 'v1.7.6 g3 三残留清偿批收口：门二放行+P0 三项全办（R1 真跑消欠账/W1 勘误 60 口径入 CHANGELOG/N 项六行入残留册）；commit d4ccedb（本体 8 件）+批档 12 件+登记三件随批；终态=regression 8/8（R1 已另跑 3/3）/anchors 12 件 0-0/hardcode 0（strict 亦 0——收口路上实配名误写被闸拦一次即改）/health-scan RED=0；cfg:20254429f008 不变；push origin main 随批' },
]
appendFileSync('.zcode/org-ledger.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
console.log('appended', rows.length, 'rows')
