#!/usr/bin/env node
// ai-dev-org 组织控制面板服务器（入仓参数化版·2026-10-28 收尾批收编）
// 边界：仅监听 127.0.0.1；调整通道=角色优先顺序直写（到期回落窗机制已退役——
//       面板原子写本机件 role_fallbacks＋agent_defaults 对应角色，validate
//       不过即回滚备份；无到期、无重置默认，顺序常驻）；重渲染=deploy-check
//       --sync-agents（机械层脚本保留，面板是其唯一日常入口）。
// 参数化（新机自适应）：SKILL_ROOT 由本脚本位置推导（panel/ 位于技能根下）；
//       端口=ORG_PANEL_PORT（默认 8787）；项目仓=ORG_PANEL_PROJECT（可选——
//       未设时面板隐藏项目仓卡片，只呈技能仓）；跨技能引用一律走脚本位置推导
//       与动态 import，零绝对路径硬编码。
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PANEL_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCAL = path.join(SKILL, 'org-config.local.json');
// 部署面目录口径=deploy-check DEFAULT_AGENTS_DIR 同契约（homedir 推导，零绝对路径硬编码）
const AGENTS_DIR = path.join(os.homedir(), '.zcode', 'agents');
const PORT = Number(process.env.ORG_PANEL_PORT || 8787);
const PROJECT = process.env.ORG_PANEL_PROJECT || '';
// 岗位序与槽名正则改矩阵驱动（装配岗批 D-2·账本 701 ③）：ROLE_ORDER=矩阵 roles 键声明序、
// SLOT_RE=该序拼装——加岗零面板码改；矩阵单次读盘（进程启动一次，state()/setOrder() 共用，
// 禁每请求重复读两份矩阵）。
const MATRIX = JSON.parse(fs.readFileSync(path.join(SKILL, 'templates', 'agents.matrix.json'), 'utf8'));
const ROLE_ORDER = Object.keys(MATRIX.roles || {});
// 可选档位单源=MATRIX.levels（B4 返工 R1：杀字面双源——面板三档选项与 /api/level 校验同源派生）
const THINK_LEVELS = Array.isArray(MATRIX.levels) && MATRIX.levels.length ? MATRIX.levels : ['low', 'high', 'max'];
const SLOT_RE = new RegExp(`^ops-(${ROLE_ORDER.join('|')})-([a-z0-9]+)-(low|high|max)$`);
// 面板分组态（B2 批 D-6·账本 711）：单一 role→group 映射＋固定组元数据派生；
// 组内 roles 由矩阵键序 filter 而来（不另写组内排序——此后调键序只改矩阵，不改面板码）。
const ROLE_GROUPS = [
  { id: 'production', label: '生产', roles: ['research', 'planner', 'assembler', 'executor'] },
  { id: 'review', label: '审核', roles: ['tbreview', 'planreview', 'implreview'] },
  { id: 'adjudication', label: '裁决', roles: ['adjudicator'] },
  { id: 'vision', label: '视觉', roles: ['vision'] },
];

// 技能仓配置装载器单源复用（三层深合并；isMain 守卫零副作用）
const { loadOrgConfig, cfgHash } = await import(pathToFileURL(path.join(SKILL, 'scripts', 'org-config.mjs')).href);

// 生命周期（随页生灭）：页面心跳注册；全部页面离线（信标或心跳超时）即自动退出。
const STARTUP_MS = Number(process.env.ORG_PANEL_STARTUP_MS || 60000); // 启动后无人接入的容忍窗
const GRACE_MS = Number(process.env.ORG_PANEL_GRACE_MS || 30000); // 单页心跳失联容忍窗
const clients = new Map(); // clientId -> lastSeen
const startedAt = Date.now();
let everHadClient = false;
const shutdown = (reason) => { console.log(`[panel] 退出：${reason}`); try { server.close(); } catch {} process.exit(0); };
const sweep = () => {
  const now = Date.now();
  for (const [id, seen] of clients) if (now - seen > GRACE_MS) clients.delete(id);
  if (clients.size === 0 && now - startedAt > STARTUP_MS) shutdown(everHadClient ? '页面心跳全部断流' : '启动后无页面接入');
};
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b)); });

const run = (cmd) => {
  try {
    const out = execFileSync(cmd, { cwd: SKILL, shell: '/bin/bash', timeout: 60000, encoding: 'utf8' });
    return { code: 0, out: out.split('\n').slice(-6).join('\n').trim() };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || e.stderr || e.message).split('\n').slice(-6).join('\n').trim() };
  }
};
const git1 = (repo) => {
  try {
    const h = execFileSync(`git -C ${repo} log --oneline -1`, { shell: '/bin/bash', timeout: 10000, encoding: 'utf8' });
    const b = execFileSync(`git -C ${repo} branch --show-current`, { shell: '/bin/bash', timeout: 10000, encoding: 'utf8' });
    const dirty = execFileSync(`git -C ${repo} status --porcelain`, { shell: '/bin/bash', timeout: 10000, encoding: 'utf8' });
    return { head: h.slice(0, 7), subject: h.slice(8, 48).trim(), branch: b.trim(), clean: dirty.trim() === '' };
  } catch { return { head: '?', subject: 'git 不可用', branch: '?', clean: false }; }
};
const readLocal = () => JSON.parse(fs.readFileSync(LOCAL, 'utf8'));
// R0 B2（D-B2）写路径白名单：writeLocal 的备份/临时文件/rename 目标与 restoreLocal 的
// 恢复目标在每次落盘前逐一校验；路径解析（realpath 父目录＋lstat 本体）后必须仍等于
// LOCAL 同目录内三项精确成员——LOCAL 本体、LOCAL+'.panel-bak'、'.<basename>.<pid>.tmp'
// 模式——拒绝 symlink/路径穿越旁路。违者抛错（rejectKind=whitelist:*）＝零写入配置。
const PANEL_WRITE_ALLOWLIST = {
  dir: path.dirname(LOCAL),
  local: LOCAL,
  bak: LOCAL + '.panel-bak',
  tmpRe: new RegExp('^\\.' + path.basename(LOCAL).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.\\d+\\.tmp$'),
};
function panelWriteCheck(target) {
  try {
    const dir = fs.realpathSync(PANEL_WRITE_ALLOWLIST.dir);
    const resolved = path.resolve(String(target));
    const parent = fs.realpathSync(path.dirname(resolved));
    if (parent !== dir) return { ok: false, reason: '目录越界' };
    // R1：symlink 判定改 lstat（existsSync 会跟随链接——断链 symlink 被穿透＝旁路洞）
    let st = null;
    try { st = fs.lstatSync(resolved); } catch {}
    if (st && st.isSymbolicLink()) return { ok: false, reason: 'symlink 目标' };
    if (resolved === PANEL_WRITE_ALLOWLIST.local || resolved === PANEL_WRITE_ALLOWLIST.bak || PANEL_WRITE_ALLOWLIST.tmpRe.test(path.basename(resolved))) return { ok: true };
    return { ok: false, reason: '白名单外目标' };
  } catch (e) { return { ok: false, reason: '路径解析失败:' + (e && e.code ? e.code : 'error') }; }
}
const writeGuard = (target, kind) => {
  const c = panelWriteCheck(target);
  if (!c.ok) { const e = new Error(`写路径白名单拒绝（${kind}·${c.reason}）——本操作零写入`); e.rejectKind = `whitelist:${c.reason}`; throw e; }
};
// B4 D-5：原子写=同目录临时文件＋rename 替换；写前保留 .panel-bak（restoreLocal 的
// 原字节恢复源，语义不变），异常时清理临时文件。备份恢复仍走 .panel-bak 原字节 copy。
const writeLocal = (obj) => {
  writeGuard(LOCAL + '.panel-bak', '备份目标');
  fs.copyFileSync(LOCAL, LOCAL + '.panel-bak');
  const tmp = path.join(path.dirname(LOCAL), `.${path.basename(LOCAL)}.${process.pid}.tmp`);
  writeGuard(tmp, '临时文件');
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
    writeGuard(LOCAL, 'rename 目标');
    fs.renameSync(tmp, LOCAL);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
};
const restoreLocal = () => { writeGuard(LOCAL, '恢复目标'); fs.copyFileSync(LOCAL + '.panel-bak', LOCAL); };
// R0 B1（D-B1）三写 API 审计链：/api/order、/api/level、/api/sync 每个受理的写操作向
// SKILL_ROOT/.zcode/panel-write-audit.jsonl 追加恰好一行 JSON（appendFileSync 单行原子
// 追加·append-only：禁重写/排序/删除/以 bak 倒推历史写序；运行时路径由 SKILL 推导，不写死
// 绝对路径）。字段固定 {ts,op,before_cfg_sha12,after_cfg_sha12,result,detail}；before/after
// 均为 cfgHash(loadOrgConfig(SKILL).merged)（org-config.mjs 已导出），写前、写后各算一次；
// op∈order/level/sync；result∈ok/rolled_back/rejected；ts=ISO；detail 只放 role、
// HTTP/validate/sync code、错误类别等非密钥摘要。回滚后的 after=回滚完成态；sync 不改
// 配置时 before=after 仍记录。审计追加失败＝写操作显式失败并按既有回滚链恢复，不得静默
// 无审计成功。面板对主仓与技能仓 org-ledger.jsonl 零写（主控批后补账，本件是唯一写序记录）。
const AUDIT_PATH = path.join(SKILL, '.zcode', 'panel-write-audit.jsonl');
const cfgSha12 = () => cfgHash(loadOrgConfig(SKILL).merged);
function auditAppend(op, before, after, result, detail) {
  fs.appendFileSync(AUDIT_PATH, JSON.stringify({ ts: new Date().toISOString(), op, before_cfg_sha12: before, after_cfg_sha12: after, result, detail }) + '\n', 'utf8');
}
function auditFailText(e) { return `审计追加失败（${AUDIT_PATH}）——本次写操作判失败：${e && e.code ? e.code + ' ' : ''}${e ? e.message : ''}`; }
// R1 z-B02/d-W02：哈希字段显式哨兵——before/after 计算失败（配置装载/哈希不可算）时以
// 'unavailable' 显式占位，绝不伪填对方哈希、绝不借哨兵记 ok/rolled_back（rolled_back 只
// 在取得真实回滚完成态哈希后记录）。哨兵语义见 panel/README.md 写审计链节。
const AUDIT_HASH_SENTINEL = 'unavailable';
function tryCfgSha12() { try { return { ok: true, hash: cfgSha12() }; } catch (e) { return { ok: false, error: e.message }; } }
/** R1 z-W01/d-N03：尽力回滚链——restoreLocal（白名单守卫内）＋复跑 validate＋回滚完成态
 *  哈希；回滚失败时 hash 只反映当时实况且 rolledBack=false（不伪报回滚成功）。 */
function tryRollback() {
  try {
    restoreLocal();
    const revalidate = run('node scripts/org-config.mjs validate');
    const h = tryCfgSha12();
    return { rolledBack: true, hash: h.ok ? h.hash : null, revalidate, error: '' };
  } catch (e) {
    const h = tryCfgSha12();
    return { rolledBack: false, hash: h.ok ? h.hash : null, revalidate: null, error: e.message };
  }
}
// R0 B1：handler 级预检拒绝（非 JSON/缺参/形态错）＝零写入受理前拒绝，同样留一行
// result=rejected 审计（before=after=当时配置哈希，装载失败时用显式哨兵；追加失败时
// 仍以 400 显式拒绝收口）。
function auditPreReject(op, category) {
  const b = tryCfgSha12();
  try { auditAppend(op, b.ok ? b.hash : AUDIT_HASH_SENTINEL, b.ok ? b.hash : AUDIT_HASH_SENTINEL, 'rejected', category); } catch {}
}

/** B4 D-6：部署实况档位——agent_defaults[role] 槽对应部署件 frontmatter thoughtLevel。
 *  解析契约与 deploy-check readFrontmatterFields 同构（首 --- 对到次 ---，剥引号）；本地实现、禁 import deploy-check（CLI 副作用隔离）。缺失/异常/无值='?'。 */
const deployedLevelOf = (slot) => {
  try {
    if (typeof slot !== 'string' || !slot) return '?';
    const lines = fs.readFileSync(path.join(AGENTS_DIR, `${slot}.md`), 'utf8').replace(/^\uFEFF/, '').split('\n');
    const start = lines.findIndex((l) => l.trim() === '---');
    const end = start >= 0 ? lines.findIndex((l, i) => i > start && l.trim() === '---') : -1;
    if (start < 0 || end < 0) return '?';
    let found = null; // B4 返工 R5：循环取末个 thoughtLevel 匹配（与 deploy-check readFrontmatterFields 同构）
    for (let i = start + 1; i < end; i++) {
      const tm = /^thoughtLevel:\s*(.*?)\s*$/.exec(lines[i]);
      if (tm) found = tm[1].trim().replace(/^['"]|['"]$/g, '') || '?';
    }
    return found ?? '?';
  } catch { return '?'; }
};

/** 角色顺序态：单源=合并配置 role_fallbacks（本机件覆盖默认件）；池=agent_slots 该角色全档。 */
function state() {
  const { merged } = loadOrgConfig(SKILL);
  const l = readLocal();
  const matrix = MATRIX; // 矩阵进程级单次读盘（模块顶装载），state() 不重复读
  const bindings = l.agent_bindings || {};
  // B4 D-6：覆盖表（plain object 守卫）——level=desired（覆盖优先，否则出厂档）；
  // factoryLevel=矩阵出厂；deployedLevel=部署 frontmatter 实况投影。
  const overrides = l.thought_level_overrides && typeof l.thought_level_overrides === 'object' && !Array.isArray(l.thought_level_overrides) ? l.thought_level_overrides : {};
  const poolOf = (role) => Object.keys(merged.agent_slots || {}).filter((s) => { const m = SLOT_RE.exec(s); return m && m[1] === role; });
  const roles = ROLE_ORDER.map((role) => {
    const def = (matrix.roles || {})[role] || { title: role, level: 'high' };
    const pool = poolOf(role);
    const factoryLevel = def.level;
    const levelOverridden = Object.prototype.hasOwnProperty.call(overrides, role);
    const deployedLevel = deployedLevelOf((merged.agent_defaults || {})[role]);
    const seq = (merged.role_fallbacks || {})[role] || [];
    const ordered = [...seq.filter((s) => pool.includes(s)), ...pool.filter((s) => !seq.includes(s))];
    return {
      role,
      title: def.title,
      level: levelOverridden ? overrides[role] : factoryLevel,
      factoryLevel,
      levelOverridden,
      deployedLevel,
      order: ordered.map((slot) => {
        const s = (merged.agent_slots || {})[slot] || {};
        const prov = (merged.providers || {})[s.provider] || {};
        const bind = bindings[slot] || '';
        return {
          provider: s.provider,
          slot,
          model: s.model || '?',
          family: prov.family || prov.model_family || '?',
          entry: prov.entry_name || prov.display_name || '',
          billing: prov.billing || '',
          multimodal: prov.multimodal === true,
          plan: typeof prov.uuid_prefix === 'string' && prov.uuid_prefix.startsWith('account:') ? prov.uuid_prefix.slice('account:'.length) : '',
          binding: bind,
        };
      }),
    };
  });
  // 分组派生（D-6）：各组 roles=扁平卡数组按组员 filter（保持矩阵键序），vision 居末；
  // 扁平 roles 兼容字段原样保留——state() 同时返回两形态。
  const roleGroups = ROLE_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    roles: roles.filter((r) => g.roles.includes(r.role)),
  }));
  const ledger = fs.readFileSync(path.join(SKILL, '.zcode/org-ledger.jsonl'), 'utf8').trim().split('\n');
  const last = JSON.parse(ledger[ledger.length - 1]);
  const validate = run('node scripts/org-config.mjs validate');
  const tags = (() => { try { return execFileSync(`git -C ${SKILL} tag -l`, { shell: '/bin/bash', encoding: 'utf8' }).trim(); } catch { return ''; } })();
  // B7 D-3：rename 后崩溃窗恢复提示投影——backupPresent 只由 .panel-bak 存在性派生；
  // 存在≠已崩溃，message 用条件式措辞且不含「已崩溃」断言；不读/不输出备份内容，
  // 不自动回滚、不删除备份。正常成功保存留下的备份同样提示（存在即提示·保守设计）。
  const backupPresent = fs.existsSync(LOCAL + '.panel-bak');
  return {
    now: new Date().toString(),
    project: PROJECT ? git1(PROJECT) : null,
    skill: { ...git1(SKILL), tags },
    ledger: { lines: ledger.length, lastRunId: last.runId, lastTs: last.ts },
    validate,
    levels: MATRIX.levels,
    recovery: {
      backupPresent,
      message: backupPresent
        ? '检测到写前备份 .panel-bak——若上次保存在校验前中断，当前配置可能是未经校验的版本；面板不自动回滚，也不会自动删除该备份，如需恢复请人工核对 .panel-bak 后自行处理。'
        : '',
    },
    roles,
    roleGroups,
  };
}

/** 顺序写入（串行互斥）：order=provider 短名全排列；原子双写 role_fallbacks＋agent_defaults，
 *  validate 不过即回滚 .panel-bak。返回 {ok, validate}。
 *  R0 B1＋R1 z-B02/z-W01：每个受理写恰追加一行审计；before/after=cfgHash(merged) 写前/写后
 *  各一次，哈希不可算以 'unavailable' 哨兵显式占位（绝不伪填）；写后异常（validate 失败/
 *  after 哈希失败/审计追加失败/执行异常）统一走 tryRollback 回滚链——只在取得真实回滚完成态
 *  哈希时记 rolled_back，回滚失败以 rejected＋rollback_ok=false 显式留痕；写前拒绝记
 *  rejected（零写入）。审计追加失败＝显式失败＋尽力回滚，无静默无审计成功。 */
let writeChain = Promise.resolve();
function setOrder(role, order) {
  const runJob = () => {
    const before = tryCfgSha12();
    if (!before.ok) {
      try { auditAppend('order', AUDIT_HASH_SENTINEL, AUDIT_HASH_SENTINEL, 'rejected', `role=${role} reject=before_hash_unavailable`); } catch (e) { return { ok: false, error: auditFailText(e), rolledBack: false }; }
      return { ok: false, error: `配置装载失败（before 哈希不可算·零写入）：${before.error}`, rolledBack: false };
    }
    const rejectZeroWrite = (detail, error) => {
      try { auditAppend('order', before.hash, before.hash, 'rejected', detail); } catch (e) { return { ok: false, error: auditFailText(e), rolledBack: false }; }
      return { ok: false, error, rolledBack: false };
    };
    let written = false;
    try {
      const { merged } = loadOrgConfig(SKILL);
      const level = ((MATRIX.roles || {})[role] || {}).level; // 矩阵进程级单次读盘（模块顶装载）
      if (!level) return rejectZeroWrite(`role=${role} reject=unknown_role`, `未知角色「${role}」`);
      const pool = [...new Set(Object.keys(merged.agent_slots || {})
        .map((s) => SLOT_RE.exec(s))
        .filter((m) => m && m[1] === role)
        .map((m) => m[2]))];
      const uniq = [...new Set(order)];
      if (uniq.length !== order.length) return rejectZeroWrite(`role=${role} reject=duplicate_provider`, '顺序含重复 provider');
      if (uniq.length !== pool.length || !uniq.every((p) => pool.includes(p))) {
        return rejectZeroWrite(`role=${role} reject=not_permutation`, `顺序须为该角色候选池（${pool.join(', ')}）的全排列`);
      }
      const slots = uniq.map((p) => `ops-${role}-${p}-${level}`);
      const l = readLocal();
      l.role_fallbacks = { ...(l.role_fallbacks || {}), [role]: slots };
      l.agent_defaults = { ...(l.agent_defaults || {}), [role]: slots[0] };
      writeLocal(l);
      written = true;
      const validate = run('node scripts/org-config.mjs validate');
      if (validate.code !== 0) {
        const rb = tryRollback();
        if (rb.hash !== null && rb.rolledBack) {
          try { auditAppend('order', before.hash, rb.hash, 'rolled_back', `role=${role} validate=${validate.code} rolled_back=1`); } catch (e) { return { ok: false, error: auditFailText(e), validate, rolledBack: rb.rolledBack }; }
          return { ok: false, validate, revalidate: rb.revalidate, rolledBack: true };
        }
        try { auditAppend('order', before.hash, rb.hash !== null ? rb.hash : AUDIT_HASH_SENTINEL, 'rejected', `role=${role} reject=post_write_validate_${validate.code} rollback_ok=${rb.rolledBack}`); } catch (e) { return { ok: false, error: auditFailText(e), validate, rolledBack: rb.rolledBack }; }
        return { ok: false, error: `写后校验失败且未能取得真实回滚态哈希（回滚${rb.rolledBack ? '已执行' : '失败：' + rb.error}）——不记 rolled_back，配置态见审计 after 字段`, validate, rolledBack: rb.rolledBack };
      }
      const after = tryCfgSha12();
      if (!after.ok) {
        const rb = tryRollback();
        if (rb.hash !== null && rb.rolledBack) {
          try { auditAppend('order', before.hash, rb.hash, 'rolled_back', `role=${role} reject=after_hash_unavailable rolled_back=1`); } catch (e) { return { ok: false, error: auditFailText(e), rolledBack: rb.rolledBack }; }
          return { ok: false, error: `after 哈希不可算——已回滚，按真实回滚完成态记 rolled_back（${after.error}）`, rolledBack: true };
        }
        try { auditAppend('order', before.hash, rb.hash !== null ? rb.hash : AUDIT_HASH_SENTINEL, 'rejected', `role=${role} reject=after_hash_unavailable rollback_ok=${rb.rolledBack}`); } catch (e) { return { ok: false, error: auditFailText(e), rolledBack: rb.rolledBack }; }
        return { ok: false, error: `after 哈希不可算且未能确认回滚完成态（${after.error}；回滚${rb.rolledBack ? '已执行' : '失败：' + rb.error}）——显式失败，不记 ok`, rolledBack: rb.rolledBack };
      }
      try { auditAppend('order', before.hash, after.hash, 'ok', `role=${role} validate=0`); } catch (e) {
        const rb = tryRollback();
        return { ok: false, error: auditFailText(e) + `（已按 .panel-bak 尽力回滚：rolledBack=${rb.rolledBack}）`, validate, rolledBack: rb.rolledBack };
      }
      return { ok: true, validate };
    } catch (e) {
      if (e && e.rejectKind) return rejectZeroWrite(`role=${role} reject=${e.rejectKind}`, e.message);
      if (written) {
        const rb = tryRollback();
        if (rb.hash !== null && rb.rolledBack) {
          try { auditAppend('order', before.hash, rb.hash, 'rolled_back', `role=${role} reject=execution:${(e && e.code) || 'error'} rolled_back=1`); } catch (e2) { return { ok: false, error: auditFailText(e2), rolledBack: rb.rolledBack }; }
          return { ok: false, error: `写后执行异常——已回滚（${e.message}）`, rolledBack: true };
        }
        try { auditAppend('order', before.hash, rb.hash !== null ? rb.hash : AUDIT_HASH_SENTINEL, 'rejected', `role=${role} reject=execution:${(e && e.code) || 'error'} rollback_ok=${rb.rolledBack}`); } catch (e2) { return { ok: false, error: auditFailText(e2), rolledBack: rb.rolledBack }; }
        return { ok: false, error: `写后执行异常且回滚未确认（${e.message}；回滚${rb.rolledBack ? '已执行' : '失败：' + rb.error}）`, rolledBack: rb.rolledBack };
      }
      return rejectZeroWrite(`role=${role} reject=execution:${(e && e.code) || 'error'}`, e.message);
    }
  };
  const job = writeChain.then(runJob, runJob);
  writeChain = job.catch(() => {});
  return job;
}

/** B4 D-5 档位写入（与 setOrder 共用 writeChain 串行互斥）：D-2 绑定值改写=只替换
 *  本机件 agent_bindings 中目标角色全部槽位绑定值末个 `$` 后的档位后缀（front/model
 *  段逐字不动）；level=出厂档时删除覆盖键并还原后缀，不等时写覆盖键并改写后缀。
 *  全或无：目标角色全部槽位绑定预检（非字符串/缺 `$`/缺 `/`=零写入）；写后 validate
 *  失败=回滚链（rolledBack 真值）；validate 过后 sync-agents，sync 失败不回滚已验证
 *  配置，由响应与日志显式暴露（手动同步可重试）。
 *  R0 B1＋R1 z-B02/z-W01：审计链同 setOrder（哨兵/回滚链/写前拒绝区分）；sync 失败不改写
 *  已验证配置，审计 result=ok 且 detail 记 sync 非零码（写序真值）。 */
function setLevel(role, level) {
  const runJob = () => {
    const before = tryCfgSha12();
    if (!before.ok) {
      try { auditAppend('level', AUDIT_HASH_SENTINEL, AUDIT_HASH_SENTINEL, 'rejected', `role=${role} reject=before_hash_unavailable`); } catch (e) { return { ok: false, error: auditFailText(e), rolledBack: false }; }
      return { ok: false, error: `配置装载失败（before 哈希不可算·零写入）：${before.error}`, rolledBack: false };
    }
    const rejectZeroWrite = (detail, error) => {
      try { auditAppend('level', before.hash, before.hash, 'rejected', detail); } catch (e) { return { ok: false, error: auditFailText(e), rolledBack: false }; }
      return { ok: false, error, rolledBack: false };
    };
    let written = false;
    try {
      const factory = ((MATRIX.roles || {})[role] || {}).level;
      if (!factory || !THINK_LEVELS.includes(level)) return rejectZeroWrite(`role=${role} reject=bad_params`, `参数非法：role∈九角色且 level∈${THINK_LEVELS.join('|')}`);
      // B4 返工 R4：目标槽集=merged.agent_slots 全池（SLOT_RE 角色 match），并要求全池槽在本机件
      // agent_bindings 齐备——缺槽=409 预检失败零写入（不改写默认层，防未来槽/绑漂移）。
      const { merged } = loadOrgConfig(SKILL);
      const pool = Object.keys(merged.agent_slots || {}).filter((k) => { const m = SLOT_RE.exec(k); return m && m[1] === role; });
      const l = readLocal();
      const bindings = l.agent_bindings || {};
      for (const k of pool) {
        if (!Object.prototype.hasOwnProperty.call(bindings, k))
          return rejectZeroWrite(`role=${role} reject=bindings_missing(${k})`, `槽 ${k} 在本机件 agent_bindings 缺键（该角色全池槽须齐备）——已拒绝写入（零写入）`);
        const v = bindings[k];
        if (typeof v !== 'string' || !v.includes('$') || !v.includes('/'))
          return rejectZeroWrite(`role=${role} reject=bindings_bad_shape(${k})`, `绑定值异常（${k}=${JSON.stringify(v)})——须为 <front>/<model>$<档位>，已拒绝写入（零写入）`);
      }
      const overrides = { ...(l.thought_level_overrides && typeof l.thought_level_overrides === 'object' && !Array.isArray(l.thought_level_overrides) ? l.thought_level_overrides : {}) };
      if (level === factory) delete overrides[role]; else overrides[role] = level;
      const next = { ...l, agent_bindings: { ...bindings } };
      for (const k of pool) {
        const v = next.agent_bindings[k];
        next.agent_bindings[k] = `${v.slice(0, v.lastIndexOf('$'))}$${level}`;
      }
      if (Object.keys(overrides).length) next.thought_level_overrides = overrides; else delete next.thought_level_overrides;
      writeLocal(next);
      written = true;
      const validate = run('node scripts/org-config.mjs validate');
      if (validate.code !== 0) {
        const rb = tryRollback();
        if (rb.hash !== null && rb.rolledBack) {
          try { auditAppend('level', before.hash, rb.hash, 'rolled_back', `role=${role} level=${level} validate=${validate.code} rolled_back=1`); } catch (e) { return { ok: false, error: auditFailText(e), validate, rolledBack: rb.rolledBack }; }
          return { ok: false, error: '配置校验失败——已回滚到写前面（.panel-bak 原字节）', validate, revalidate: rb.revalidate, rolledBack: true };
        }
        try { auditAppend('level', before.hash, rb.hash !== null ? rb.hash : AUDIT_HASH_SENTINEL, 'rejected', `role=${role} level=${level} reject=post_write_validate_${validate.code} rollback_ok=${rb.rolledBack}`); } catch (e) { return { ok: false, error: auditFailText(e), validate, rolledBack: rb.rolledBack }; }
        return { ok: false, error: `写后校验失败且未能取得真实回滚态哈希（回滚${rb.rolledBack ? '已执行' : '失败：' + rb.error}）——不记 rolled_back`, validate, rolledBack: rb.rolledBack };
      }
      const sync = run('node scripts/deploy-check.mjs --sync-agents');
      const after = tryCfgSha12();
      if (!after.ok) {
        const rb = tryRollback();
        if (rb.hash !== null && rb.rolledBack) {
          try { auditAppend('level', before.hash, rb.hash, 'rolled_back', `role=${role} level=${level} reject=after_hash_unavailable rolled_back=1`); } catch (e) { return { ok: false, error: auditFailText(e), validate, sync, rolledBack: rb.rolledBack }; }
          return { ok: false, error: `after 哈希不可算——已回滚，按真实回滚完成态记 rolled_back（${after.error}）`, validate, sync, rolledBack: true };
        }
        try { auditAppend('level', before.hash, rb.hash !== null ? rb.hash : AUDIT_HASH_SENTINEL, 'rejected', `role=${role} level=${level} reject=after_hash_unavailable rollback_ok=${rb.rolledBack}`); } catch (e) { return { ok: false, error: auditFailText(e), validate, sync, rolledBack: rb.rolledBack }; }
        return { ok: false, error: `after 哈希不可算且未能确认回滚完成态（${after.error}）——显式失败，不记 ok`, validate, sync, rolledBack: rb.rolledBack };
      }
      try { auditAppend('level', before.hash, after.hash, 'ok', `role=${role} level=${level} validate=0 sync=${sync.code}`); } catch (e) {
        const rb = tryRollback();
        return { ok: false, error: auditFailText(e) + `（已按 .panel-bak 尽力回滚：rolledBack=${rb.rolledBack}）`, validate, sync, rolledBack: rb.rolledBack };
      }
      return { ok: true, validate, sync, rolledBack: false };
    } catch (e) {
      if (e && e.rejectKind) return rejectZeroWrite(`role=${role} reject=${e.rejectKind}`, e.message);
      if (written) {
        const rb = tryRollback();
        if (rb.hash !== null && rb.rolledBack) {
          try { auditAppend('level', before.hash, rb.hash, 'rolled_back', `role=${role} level=${level} reject=execution:${(e && e.code) || 'error'} rolled_back=1`); } catch (e2) { return { ok: false, error: auditFailText(e2), rolledBack: rb.rolledBack }; }
          return { ok: false, error: `写后执行异常——已回滚（${e.message}）`, rolledBack: true };
        }
        try { auditAppend('level', before.hash, rb.hash !== null ? rb.hash : AUDIT_HASH_SENTINEL, 'rejected', `role=${role} level=${level} reject=execution:${(e && e.code) || 'error'} rollback_ok=${rb.rolledBack}`); } catch (e2) { return { ok: false, error: auditFailText(e2), rolledBack: rb.rolledBack }; }
        return { ok: false, error: `写后执行异常且回滚未确认（${e.message}）`, rolledBack: rb.rolledBack };
      }
      return rejectZeroWrite(`role=${role} reject=execution:${(e && e.code) || 'error'}`, e.message);
    }
  };
  const job = writeChain.then(runJob, runJob);
  writeChain = job.catch(() => {});
  return job;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type }); res.end(Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body)); };
  if (url.pathname === '/' || url.pathname === '/index.html') return send(200, fs.readFileSync(path.join(PANEL_DIR, 'index.html')), 'text/html; charset=utf-8');
  if (url.pathname === '/api/ping') return send(200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/api/state') return send(200, state());
  if (req.method === 'GET' && url.pathname === '/api/health') return send(200, run('node scripts/log-triage.mjs --health --hours 24'));
  if (req.method === 'POST' && (url.pathname === '/api/hello' || url.pathname === '/api/beat')) {
    return readBody(req).then((b) => {
      const { clientId } = JSON.parse(b || '{}');
      if (!clientId) return send(400, { error: 'clientId 必填' });
      clients.set(clientId, Date.now());
      everHadClient = true;
      send(200, { ok: true, clients: clients.size });
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/bye') {
    return readBody(req).then((b) => {
      const { clientId } = JSON.parse(b || '{}');
      clients.delete(clientId);
      send(200, { ok: true, clients: clients.size });
      if (clients.size === 0) setTimeout(() => { if (clients.size === 0) shutdown('页面已全部关闭（离页信标）'); }, 1500);
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/order') {
    return readBody(req).then((b) => {
      let body;
      try { body = JSON.parse(b || '{}'); } catch { auditPreReject('order', 'reject=bad_json'); return send(400, { error: '请求体须为 JSON' }); }
      const { role, order } = body || {};
      if (!ROLE_ORDER.includes(role)) { auditPreReject('order', `role=${role} reject=unknown_role`); return send(400, { error: `role 必填且∈${ROLE_ORDER.length} 角色（${ROLE_ORDER.join(', ')}）` }); }
      if (!Array.isArray(order) || order.length === 0 || order.some((p) => typeof p !== 'string')) { auditPreReject('order', `role=${role} reject=bad_order_shape`); return send(400, { error: 'order 须为非空 provider 短名数组' }); }
      return setOrder(role, order).then((r) => send(r.ok ? 200 : 409, r));
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/level') {
    return readBody(req).then((b) => {
      let body;
      try { body = JSON.parse(b || '{}'); } catch { auditPreReject('level', 'reject=bad_json'); return send(400, { error: '请求体须为 JSON' }); }
      const { role, level } = body || {};
      if (!ROLE_ORDER.includes(role)) { auditPreReject('level', `role=${role} reject=unknown_role`); return send(400, { error: `role 必填且∈${ROLE_ORDER.length} 角色（${ROLE_ORDER.join(', ')}）` }); }
      if (!THINK_LEVELS.includes(level)) { auditPreReject('level', `role=${role} reject=bad_level`); return send(400, { error: `level 必填且∈${THINK_LEVELS.join('|')}` }); }
      return setLevel(role, level).then((r) => send(r.ok ? 200 : 409, r));
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/sync') {
    // R1 z-B01/d-W01：sync 执行＋after＋审计全部纳入 writeChain——与 order/level 同链串行，
    // 审计行序＝写链执行序（哈希链 before[n]==after[n-1] 在并发下仍闭合）。
    return readBody(req).then(() => {
      const runJob = () => {
        const before = tryCfgSha12();
        const r = run('node scripts/deploy-check.mjs --sync-agents');
        const after = tryCfgSha12();
        // R2 W-06：哈希面任一不可算即禁记 result=ok——哨兵行只配 rejected（真实可用信息：
        // sync_code＋缺失面标注）；响应附 auditHashDegraded 显式标记（sync 本体结果仍如实回传）。
        const hashOk = before.ok && after.ok;
        try {
          auditAppend('sync', before.ok ? before.hash : AUDIT_HASH_SENTINEL, after.ok ? after.hash : AUDIT_HASH_SENTINEL, r.code === 0 && hashOk ? 'ok' : 'rejected', `sync_code=${r.code}${before.ok ? '' : ' before=unavailable'}${after.ok ? '' : ' after=unavailable'}`);
        } catch (e) {
          return { ...r, auditFailed: true, error: auditFailText(e) };
        }
        return hashOk ? r : { ...r, auditHashDegraded: true, degraded: [before.ok ? '' : 'before', after.ok ? '' : 'after'].filter(Boolean).join('+') };
      };
      const job = writeChain.then(runJob, runJob);
      writeChain = job.catch(() => {});
      return job.then((r) => send(r && r.auditFailed ? 500 : 200, r));
    });
  }
  send(404, { error: 'not found' });
});
setInterval(sweep, 5000);
server.listen(PORT, '127.0.0.1', () => console.log(`ai-dev-org panel http://127.0.0.1:${PORT}（随页生灭：无人接入 ${STARTUP_MS / 1000}s 后自动退出；ORG_PANEL_PROJECT=${PROJECT || '未设·隐藏项目仓卡'}）`));
