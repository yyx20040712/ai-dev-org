import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, updateUserConfig } from './config.mjs';
import { inventory } from './router.mjs';
import { assertRole, LEVELS } from './roles.mjs';
import { defaultAgentsDir, syncAgents } from './agents.mjs';

const PANEL_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'panel', 'index.html');

function json(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let settled = false;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > 64 * 1024) {
        settled = true;
        reject(new Error('请求体超过 64 KiB'));
      }
    });
    request.on('end', () => {
      if (settled) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error(`请求 JSON 无效：${error.message}`));
      }
    });
    request.on('error', reject);
  });
}

function panelState(configPath) {
  const loaded = loadConfig({ configPath, includeProject: false });
  return {
    configPath: loaded.sources.userPath,
    levels: LEVELS,
    slots: Object.entries(loaded.config.slots).map(([id, slot]) => ({ id, ...slot })),
    roles: inventory(loaded.config).map((item) => ({
      role: item.role,
      title: item.title,
      description: item.description,
      level: item.routes[0]?.level ?? loaded.config.roles[item.role]?.level,
      routes: item.routes.map((route) => ({
        slot: route.slot,
        agent: route.agent,
        model: route.model,
        label: route.label,
        multimodal: route.multimodal,
      })),
    })),
  };
}

export function createPanelServer({ configPath, agentsDir = defaultAgentsDir() } = {}) {
  let writes = Promise.resolve();
  const enqueue = (operation) => {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  };

  const server = http.createServer(async (request, response) => {
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (request.headers.host !== expectedHost) {
        json(response, 403, { error: '拒绝非本机 Host' });
        return;
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
        });
        response.end(fs.readFileSync(PANEL_HTML));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        json(response, 200, panelState(configPath));
        return;
      }
      if (request.method !== 'POST') {
        json(response, 404, { error: '未找到该入口' });
        return;
      }
      if (request.headers.origin && request.headers.origin !== `http://${expectedHost}`) {
        json(response, 403, { error: '拒绝跨来源写入' });
        return;
      }
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
        json(response, 415, { error: 'POST 需要 application/json' });
        return;
      }
      const body = await readBody(request);

      if (url.pathname === '/api/order') {
        assertRole(body.role);
        if (!Array.isArray(body.slots)) throw new Error('slots 必须是数组');
        const result = await enqueue(() => updateUserConfig({
          configPath,
          mutate(config) {
            config.roles ??= {};
            config.roles[body.role] ??= { level: 'high', slots: [] };
            config.roles[body.role].slots = body.slots;
          },
        }));
        json(response, 200, { ok: true, roles: result.roles[body.role], state: panelState(configPath) });
        return;
      }
      if (url.pathname === '/api/level') {
        assertRole(body.role);
        if (!LEVELS.includes(body.level)) throw new Error('无效思考档位');
        await enqueue(() => updateUserConfig({
          configPath,
          mutate(config) {
            config.roles ??= {};
            config.roles[body.role] ??= { slots: [] };
            config.roles[body.role].level = body.level;
          },
        }));
        json(response, 200, { ok: true, state: panelState(configPath) });
        return;
      }
      if (url.pathname === '/api/sync') {
        const result = await enqueue(() => {
          const { config } = loadConfig({ configPath, includeProject: false });
          return syncAgents({ config, agentsDir });
        });
        json(response, 200, { ok: true, result });
        return;
      }
      json(response, 404, { error: '未找到该入口' });
    } catch (error) {
      const localFailure = request.method === 'GET'
        || ['CONFIG_READ', 'INVALID_JSON', 'CONFIG_SECRET', 'INVALID_AGENT_MANIFEST', 'SYNC_INCOMPLETE'].includes(error.code)
        || /^E[A-Z0-9]+$/.test(error.code || '');
      json(response, localFailure ? 500 : 400, { error: error.message });
    }
  });
  return server;
}

export async function startPanel({ port = 8787, configPath, agentsDir } = {}) {
  if (!Number.isInteger(Number(port)) || Number(port) < 0 || Number(port) > 65535) throw new Error('端口无效');
  const server = createPanelServer({ configPath, agentsDir });
  await new Promise((resolve, reject) => {
    const onStartupError = (error) => reject(error);
    server.once('error', onStartupError);
    server.listen(Number(port), '127.0.0.1', () => {
      server.off('error', onStartupError);
      resolve();
    });
  });
  server.on('error', (error) => {
    console.error(`面板运行错误：${error.message}`);
    process.exitCode = 1;
  });
  return server;
}
