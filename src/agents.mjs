import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory } from './router.mjs';
import { ROLE_DEFS } from './roles.mjs';
import { fail } from './errors.mjs';

const PLUGIN_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_TEMPLATES = path.join(PLUGIN_ROOT, 'templates', 'agents');
const MANIFEST_NAME = '.dev-troupe.json';
const MANAGED_AGENT = /^ops-(research|planner|executor|reviewer|vision)-.+\.md$/;

export function defaultAgentsDir() {
  return process.env.TROUPE_AGENTS_DIR || path.join(os.homedir(), '.zcode', 'agents');
}

export function renderAgent(route, roleTemplate, resultTemplate) {
  const definition = ROLE_DEFS[route.role];
  const values = {
    role: route.role,
    title: definition.title,
    agent: route.agent,
    model: route.model,
    level: route.level,
    tools: definition.tools.join(', '),
    color: definition.color,
    contract: JSON.stringify(definition.contract, null, 2),
  };
  let body = `${roleTemplate.trim()}\n\n${resultTemplate.trim()}`;
  for (const [key, value] of Object.entries(values)) body = body.replaceAll(`{{${key}}}`, value);
  if (/\{\{[a-z]+\}\}/.test(body)) fail(`角色模板存在未知占位符：${route.role}`, 'INVALID_TEMPLATE');
  return `---\nname: ${route.agent}\ndescription: ${definition.description}\ntools: ${values.tools}\ncolor: ${definition.color}\nmodel: ${route.model}\nthoughtLevel: ${route.level}\n---\n\n${body}\n`;
}

export function expectedAgentDocuments(config, templateDir = DEFAULT_TEMPLATES) {
  const resultTemplate = fs.readFileSync(path.join(templateDir, 'result.md'), 'utf8');
  const documents = new Map();
  for (const item of inventory(config)) {
    const template = fs.readFileSync(path.join(templateDir, `${item.role}.md`), 'utf8');
    for (const route of item.routes) documents.set(`${route.agent}.md`, renderAgent(route, template, resultTemplate));
  }
  return documents;
}

function readOwnedManifest(agentsDir) {
  const file = path.join(agentsDir, MANIFEST_NAME);
  if (!fs.existsSync(file)) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`代理生成清单无法解析：${file}：${error.message}`, 'INVALID_AGENT_MANIFEST');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.owned)
    || data.owned.some((name) => typeof name !== 'string' || path.basename(name) !== name)
    || new Set(data.owned).size !== data.owned.length) {
    fail(`代理生成清单无效：${file}`, 'INVALID_AGENT_MANIFEST');
  }
  return data.owned;
}

function atomicWrite(file, content) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function syncAgents({
  config,
  agentsDir = defaultAgentsDir(),
  backupDir,
  templateDir = DEFAULT_TEMPLATES,
} = {}) {
  if (!config) fail('sync 需要已加载配置', 'CONFIG_REQUIRED');
  const target = path.resolve(agentsDir);
  fs.mkdirSync(target, { recursive: true });
  const expected = expectedAgentDocuments(config, templateDir);
  const previousOwned = readOwnedManifest(target);
  const remove = previousOwned.filter((name) => !expected.has(name) && MANAGED_AGENT.test(name) && fs.existsSync(path.join(target, name)));
  const changed = [...expected].filter(([name, content]) => !fs.existsSync(path.join(target, name)) || fs.readFileSync(path.join(target, name), 'utf8') !== content);
  const needBackup = changed.some(([name]) => fs.existsSync(path.join(target, name))) || remove.length > 0;
  const actualBackup = needBackup
    ? (backupDir ? path.resolve(backupDir) : path.join(os.homedir(), '.zcode', 'archive', `troupe-agents-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`))
    : null;
  const backedUp = [];
  const progress = { backupDir: actualBackup, written: [], removed: [], backedUp };
  try {
    if (actualBackup) fs.mkdirSync(actualBackup, { recursive: true });
    const backup = (name) => {
      if (!actualBackup) return;
      const source = path.join(target, name);
      if (!fs.existsSync(source)) return;
      fs.copyFileSync(source, path.join(actualBackup, name), fs.constants.COPYFILE_EXCL);
      backedUp.push(name);
    };

    for (const [name] of changed) backup(name);
    for (const name of remove) backup(name);
    for (const [name, content] of changed) {
      atomicWrite(path.join(target, name), content);
      progress.written.push(name);
    }
    for (const name of remove) {
      fs.rmSync(path.join(target, name));
      progress.removed.push(name);
    }
    atomicWrite(path.join(target, MANIFEST_NAME), `${JSON.stringify({ version: 1, owned: [...expected.keys()] }, null, 2)}\n`);
  } catch (error) {
    error.message = `sync 未完成：${error.message}\n恢复信息：backupDir=${actualBackup || '(无)'} written=${progress.written.join(',') || '(无)'} removed=${progress.removed.join(',') || '(无)'}`;
    error.syncProgress = progress;
    throw error;
  }

  return {
    agentsDir: target,
    generated: expected.size,
    written: progress.written,
    unchanged: expected.size - changed.length,
    removed: progress.removed,
    backupDir: actualBackup,
    backedUp,
  };
}

export function doctorAgents(config, agentsDir = defaultAgentsDir()) {
  const target = path.resolve(agentsDir);
  const expected = expectedAgentDocuments(config);
  const issues = [];
  const warnings = [];
  for (const [name, content] of expected) {
    const file = path.join(target, name);
    if (!fs.existsSync(file)) issues.push(`缺少代理：${name}`);
    else if (fs.readFileSync(file, 'utf8') !== content) issues.push(`代理与配置不一致：${name}；请运行 troupe sync`);
  }
  if (!fs.existsSync(path.join(target, MANIFEST_NAME))) {
    issues.push('缺少代理生成清单；请运行 troupe sync');
  } else {
    try {
      const owned = readOwnedManifest(target);
      const missing = [...expected.keys()].filter((name) => !owned.includes(name));
      const extra = owned.filter((name) => !expected.has(name));
      if (missing.length || extra.length) issues.push(`代理生成清单与配置不一致：missing=${missing.join(',') || '无'} extra=${extra.join(',') || '无'}`);
    } catch (error) {
      issues.push(error.message);
    }
  }
  return { issues, warnings, expected: expected.size, agentsDir: target };
}
