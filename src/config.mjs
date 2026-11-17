import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TroupeError, fail } from './errors.mjs';
import { LEVELS, ROLE_NAMES } from './roles.mjs';

export const PLUGIN_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_CONFIG_PATH = path.join(PLUGIN_ROOT, 'config', 'default.json');

const SLOT_ID = /^[a-z0-9][a-z0-9-]*$/;
const SECRET_KEY = /(api[_-]?key|secret|password|authorization|access[_-]?token)/i;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function secretIssues(value, at = '$') {
  const issues = [];
  if (!isObject(value) && !Array.isArray(value)) return issues;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) issues.push(`配置不得保存凭据字段：${at}.${key}`);
    issues.push(...secretIssues(child, `${at}.${key}`));
  }
  return issues;
}

export function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === null) delete result[key];
    else if (isObject(value) && isObject(result[key])) result[key] = deepMerge(result[key], value);
    else result[key] = value;
  }
  return result;
}

export function readJson(file, { optional = false } = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) fail(`JSON 无法解析：${file}：${error.message}`, 'INVALID_JSON');
    fail(`无法读取配置 ${file}：${error.message}`, 'CONFIG_READ');
  }
}

function defaultUserConfigPath() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'dev-troupe', 'config.json');
}

export function userConfigPath(explicitPath) {
  if (explicitPath) return path.resolve(explicitPath);
  if (process.env.TROUPE_CONFIG) return path.resolve(process.env.TROUPE_CONFIG);
  return defaultUserConfigPath();
}

export function validateConfig(config) {
  const issues = [];
  if (!isObject(config)) return ['配置顶层必须是对象'];
  if (config.schemaVersion !== 1) issues.push('schemaVersion 必须为 1');
  for (const key of Object.keys(config)) {
    if (!['schemaVersion', 'slots', 'roles'].includes(key)) issues.push(`未知顶层字段：${key}`);
  }
  if (!isObject(config.slots)) issues.push('slots 必须是对象');
  if (!isObject(config.roles)) issues.push('roles 必须是对象');

  issues.push(...secretIssues(config));

  for (const [id, slot] of Object.entries(config.slots ?? {})) {
    if (!SLOT_ID.test(id)) issues.push(`槽位名无效：${id}`);
    if (!isObject(slot)) {
      issues.push(`槽位 ${id} 必须是对象`);
      continue;
    }
    for (const key of Object.keys(slot)) {
      if (!['model', 'multimodal', 'label'].includes(key)) issues.push(`槽位 ${id} 含未知字段 ${key}`);
    }
    if (typeof slot.model !== 'string' || !slot.model.includes('/') || /[\s$]/.test(slot.model)) {
      issues.push(`槽位 ${id}.model 必须是 provider/model，思考档位由角色单独配置`);
    }
    if (slot.multimodal !== undefined && typeof slot.multimodal !== 'boolean') {
      issues.push(`槽位 ${id}.multimodal 必须是布尔值`);
    }
    if (slot.label !== undefined && typeof slot.label !== 'string') issues.push(`槽位 ${id}.label 必须是字符串`);
  }

  for (const [role, roleConfig] of Object.entries(config.roles ?? {})) {
    if (!ROLE_NAMES.includes(role)) {
      issues.push(`未知角色：${role}`);
      continue;
    }
    if (!isObject(roleConfig)) {
      issues.push(`角色 ${role} 必须是对象`);
      continue;
    }
    for (const key of Object.keys(roleConfig)) {
      if (!['slots', 'level'].includes(key)) issues.push(`角色 ${role} 含未知字段 ${key}`);
    }
    if (roleConfig.level !== undefined && !LEVELS.includes(roleConfig.level)) issues.push(`角色 ${role} 的 level 无效`);
    if (!Array.isArray(roleConfig.slots)) {
      issues.push(`角色 ${role}.slots 必须是数组`);
      continue;
    }
    const seen = new Set();
    for (const id of roleConfig.slots) {
      if (typeof id !== 'string' || !isObject(config.slots?.[id])) issues.push(`角色 ${role} 引用了不存在的槽位 ${id}`);
      if (seen.has(id)) issues.push(`角色 ${role} 重复引用槽位 ${id}`);
      seen.add(id);
      if (role === 'vision' && config.slots?.[id]?.multimodal !== true) issues.push(`视觉角色只能使用 multimodal=true 的槽位：${id}`);
    }
  }
  return issues;
}

export function assertValidConfig(config) {
  const issues = validateConfig(config);
  if (issues.length) throw new TroupeError(`配置无效：\n- ${issues.join('\n- ')}`, 'INVALID_CONFIG');
  return config;
}

export function loadConfig({ configPath, projectDir = process.cwd(), includeProject = true } = {}) {
  const defaultPath = DEFAULT_CONFIG_PATH;
  const userPath = userConfigPath(configPath);
  const projectPath = includeProject && projectDir ? path.join(path.resolve(projectDir), '.zcode', 'dev-troupe.json') : null;
  const defaults = readJson(defaultPath);
  const user = readJson(userPath, { optional: true });
  const project = projectPath ? readJson(projectPath, { optional: true }) : null;
  for (const [layer, file] of [[defaults, defaultPath], [user, userPath], [project, projectPath]]) {
    if (!layer) continue;
    const secrets = secretIssues(layer);
    if (secrets.length) throw new TroupeError(`${file}：${secrets.join('；')}`, 'CONFIG_SECRET');
  }
  const config = deepMerge(deepMerge(defaults, user ?? {}), project ?? {});
  assertValidConfig(config);
  return {
    config,
    sources: { defaultPath, userPath, projectPath },
    hasUser: user !== null,
    hasProject: project !== null,
  };
}

function emptyConfig() {
  return readJson(DEFAULT_CONFIG_PATH);
}

export function writeUserConfig(config, configPath, { createOnly = false } = {}) {
  assertValidConfig(deepMerge(readJson(DEFAULT_CONFIG_PATH), config));
  const target = userConfigPath(configPath);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    if (fs.lstatSync(target).isSymbolicLink()) fail(`拒绝写入符号链接配置：${target}`, 'UNSAFE_CONFIG');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.tmp`);
  const backupTemporary = path.join(directory, `.${path.basename(target)}.${process.pid}.bak.tmp`);
  let committed = false;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    if (!createOnly && fs.existsSync(target)) fs.copyFileSync(target, backupTemporary, fs.constants.COPYFILE_EXCL);
    if (createOnly) {
      try {
        fs.linkSync(temporary, target);
      } catch (error) {
        if (error.code === 'EEXIST') fail(`配置已存在：${target}`, 'CONFIG_EXISTS');
        throw error;
      }
    } else {
      fs.renameSync(temporary, target);
      committed = true;
    }
    if (fs.existsSync(backupTemporary)) fs.renameSync(backupTemporary, `${target}.bak`);
  } catch (error) {
    if (committed) fail(`配置已写入 ${target}，但备份收尾失败：${error.message}`, 'CONFIG_BACKUP_INCOMPLETE');
    throw error;
  } finally {
    fs.rmSync(temporary, { force: true });
    fs.rmSync(backupTemporary, { force: true });
  }
  return target;
}

export function updateUserConfig({ configPath, mutate }) {
  const target = userConfigPath(configPath);
  const current = readJson(target, { optional: true }) ?? emptyConfig();
  const next = structuredClone(current);
  mutate(next);
  const effective = deepMerge(readJson(DEFAULT_CONFIG_PATH), next);
  assertValidConfig(effective);
  writeUserConfig(next, target);
  return next;
}

export function initConfig({ configPath } = {}) {
  const target = userConfigPath(configPath);
  if (fs.existsSync(target)) return { configPath: target, existing: true };
  try {
    writeUserConfig(emptyConfig(), target, { createOnly: true });
  } catch (error) {
    if (error.code === 'CONFIG_EXISTS') return { configPath: target, existing: true };
    throw error;
  }
  return { configPath: target, existing: false };
}
