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
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PANEL_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCAL = path.join(SKILL, 'org-config.local.json');
const PORT = Number(process.env.ORG_PANEL_PORT || 8787);
const PROJECT = process.env.ORG_PANEL_PROJECT || '';
// 岗位序与槽名正则改矩阵驱动（装配岗批 D-2·账本 701 ③）：ROLE_ORDER=矩阵 roles 键声明序、
// SLOT_RE=该序拼装——加岗零面板码改；矩阵单次读盘（进程启动一次，state()/setOrder() 共用，
// 禁每请求重复读两份矩阵）。
const MATRIX = JSON.parse(fs.readFileSync(path.join(SKILL, 'templates', 'agents.matrix.json'), 'utf8'));
const ROLE_ORDER = Object.keys(MATRIX.roles || {});
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
const { loadOrgConfig } = await import(pathToFileURL(path.join(SKILL, 'scripts', 'org-config.mjs')).href);

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
const writeLocal = (obj) => {
  fs.copyFileSync(LOCAL, LOCAL + '.panel-bak');
  fs.writeFileSync(LOCAL, JSON.stringify(obj, null, 2) + '\n');
};
const restoreLocal = () => { fs.copyFileSync(LOCAL + '.panel-bak', LOCAL); };

/** 角色顺序态：单源=合并配置 role_fallbacks（本机件覆盖默认件）；池=agent_slots 该角色全档。 */
function state() {
  const { merged } = loadOrgConfig(SKILL);
  const l = readLocal();
  const matrix = MATRIX; // 矩阵进程级单次读盘（模块顶装载），state() 不重复读
  const bindings = l.agent_bindings || {};
  const poolOf = (role) => Object.keys(merged.agent_slots || {}).filter((s) => { const m = SLOT_RE.exec(s); return m && m[1] === role; });
  const roles = ROLE_ORDER.map((role) => {
    const def = (matrix.roles || {})[role] || { title: role, level: 'high' };
    const pool = poolOf(role);
    const lvl = pool.length ? SLOT_RE.exec(pool[0])[3] : def.level;
    const seq = (merged.role_fallbacks || {})[role] || [];
    const ordered = [...seq.filter((s) => pool.includes(s)), ...pool.filter((s) => !seq.includes(s))];
    return {
      role,
      title: def.title,
      level: lvl,
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
  return {
    now: new Date().toString(),
    project: PROJECT ? git1(PROJECT) : null,
    skill: { ...git1(SKILL), tags },
    ledger: { lines: ledger.length, lastRunId: last.runId, lastTs: last.ts },
    validate,
    roles,
    roleGroups,
  };
}

/** 顺序写入（串行互斥）：order=provider 短名全排列；原子双写 role_fallbacks＋agent_defaults，
 *  validate 不过即回滚 .panel-bak。返回 {ok, validate}。 */
let writeChain = Promise.resolve();
function setOrder(role, order) {
  const runJob = () => {
    const { merged } = loadOrgConfig(SKILL);
    const level = ((MATRIX.roles || {})[role] || {}).level; // 矩阵进程级单次读盘（模块顶装载）
    if (!level) return { ok: false, error: `未知角色「${role}」` };
    const pool = [...new Set(Object.keys(merged.agent_slots || {})
      .map((s) => SLOT_RE.exec(s))
      .filter((m) => m && m[1] === role)
      .map((m) => m[2]))];
    const uniq = [...new Set(order)];
    if (uniq.length !== order.length) return { ok: false, error: '顺序含重复 provider' };
    if (uniq.length !== pool.length || !uniq.every((p) => pool.includes(p))) {
      return { ok: false, error: `顺序须为该角色候选池（${pool.join(', ')}）的全排列` };
    }
    const slots = uniq.map((p) => `ops-${role}-${p}-${level}`);
    const l = readLocal();
    l.role_fallbacks = { ...(l.role_fallbacks || {}), [role]: slots };
    l.agent_defaults = { ...(l.agent_defaults || {}), [role]: slots[0] };
    writeLocal(l);
    const validate = run('node scripts/org-config.mjs validate');
    if (validate.code !== 0) { restoreLocal(); run('node scripts/org-config.mjs validate'); }
    return { ok: validate.code === 0, validate };
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
      try { body = JSON.parse(b || '{}'); } catch { return send(400, { error: '请求体须为 JSON' }); }
      const { role, order } = body || {};
      if (!ROLE_ORDER.includes(role)) return send(400, { error: `role 必填且∈${ROLE_ORDER.length} 角色（${ROLE_ORDER.join(', ')}）` });
      if (!Array.isArray(order) || order.length === 0 || order.some((p) => typeof p !== 'string')) return send(400, { error: 'order 须为非空 provider 短名数组' });
      return setOrder(role, order).then((r) => send(r.ok ? 200 : 409, r));
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/sync') return send(200, run('node scripts/deploy-check.mjs --sync-agents'));
  send(404, { error: 'not found' });
});
setInterval(sweep, 5000);
server.listen(PORT, '127.0.0.1', () => console.log(`ai-dev-org panel http://127.0.0.1:${PORT}（随页生灭：无人接入 ${STARTUP_MS / 1000}s 后自动退出；ORG_PANEL_PROJECT=${PROJECT || '未设·隐藏项目仓卡'}）`));
