import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './config.mjs';
import { TroupeError, fail } from './errors.mjs';
import { ROLE_NAMES } from './roles.mjs';

export const DEFAULT_WORKFLOW_DIR = fileURLToPath(new URL('../workflows/', import.meta.url));

const WORKFLOW_ID = /^[a-z0-9][a-z0-9-]*$/;
const TOP_LEVEL_FIELDS = ['schemaVersion', 'id', 'title', 'description', 'steps'];
const STEP_FIELDS = ['id', 'role', 'dependsOn', 'optional', 'when', 'acceptance'];
const WORKFLOW_ROLES = ['controller', ...ROLE_NAMES];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function topologicalSteps(workflow) {
  const remaining = [...workflow.steps];
  const ordered = [];
  const completed = new Set();
  while (remaining.length) {
    const index = remaining.findIndex((step) => step.dependsOn.every((dependency) => completed.has(dependency)));
    if (index < 0) {
      const ids = remaining.map((step) => step.id).join(', ');
      throw new TroupeError(`工作流存在循环依赖：${ids}`, 'INVALID_WORKFLOW');
    }
    const [step] = remaining.splice(index, 1);
    ordered.push(step);
    completed.add(step.id);
  }
  return ordered;
}

export function validateWorkflow(workflow) {
  const issues = [];
  if (!isObject(workflow)) return ['工作流顶层必须是对象'];
  if (workflow.schemaVersion !== 1) issues.push('schemaVersion 必须为 1');
  for (const key of Object.keys(workflow)) {
    if (!TOP_LEVEL_FIELDS.includes(key)) issues.push(`未知顶层字段：${key}`);
  }
  if (typeof workflow.id !== 'string' || !WORKFLOW_ID.test(workflow.id)) issues.push('工作流 id 无效');
  if (typeof workflow.title !== 'string' || !workflow.title.trim()) issues.push('工作流 title 必须是非空字符串');
  if (typeof workflow.description !== 'string' || !workflow.description.trim()) issues.push('工作流 description 必须是非空字符串');
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    issues.push('工作流 steps 必须是非空数组');
    return issues;
  }

  const ids = new Set();
  for (const [index, step] of workflow.steps.entries()) {
    if (!isObject(step)) {
      issues.push(`步骤 ${index + 1} 必须是对象`);
      continue;
    }
    const label = typeof step.id === 'string' && step.id ? step.id : `#${index + 1}`;
    for (const key of Object.keys(step)) {
      if (!STEP_FIELDS.includes(key)) issues.push(`步骤 ${label} 含未知步骤字段 ${key}`);
    }
    if (typeof step.id !== 'string' || !WORKFLOW_ID.test(step.id)) issues.push(`步骤 ${label} 的 id 无效`);
    if (ids.has(step.id)) issues.push(`重复步骤：${step.id}`);
    ids.add(step.id);
    if (!WORKFLOW_ROLES.includes(step.role)) issues.push(`步骤 ${label} 含未知角色：${step.role}`);
    if (!Array.isArray(step.dependsOn)) issues.push(`步骤 ${label}.dependsOn 必须是数组`);
    else {
      const dependencies = new Set();
      for (const dependency of step.dependsOn) {
        if (typeof dependency !== 'string' || !WORKFLOW_ID.test(dependency)) issues.push(`步骤 ${label} 含无效依赖 ${dependency}`);
        if (dependencies.has(dependency)) issues.push(`步骤 ${label} 含重复依赖 ${dependency}`);
        dependencies.add(dependency);
      }
    }
    if (typeof step.optional !== 'boolean') issues.push(`步骤 ${label}.optional 必须是布尔值`);
    if (typeof step.when !== 'string' || !step.when.trim()) issues.push(`步骤 ${label}.when 必须是非空字符串`);
    if (typeof step.acceptance !== 'string' || !step.acceptance.trim()) issues.push(`步骤 ${label}.acceptance 必须是非空字符串`);
  }

  let canSort = ids.size === workflow.steps.length;
  for (const step of workflow.steps) {
    if (!isObject(step) || !Array.isArray(step.dependsOn)) {
      canSort = false;
      continue;
    }
    for (const dependency of step.dependsOn) {
      if (dependency === step.id) {
        issues.push(`步骤 ${step.id} 不得自依赖`);
        canSort = false;
      } else if (!ids.has(dependency)) {
        issues.push(`步骤 ${step.id} 引用了不存在的依赖 ${dependency}`);
        canSort = false;
      }
    }
  }
  if (canSort) {
    try {
      topologicalSteps(workflow);
    } catch (error) {
      if (error.code !== 'INVALID_WORKFLOW') throw error;
      issues.push(error.message);
    }
  }
  return issues;
}

export function assertValidWorkflow(workflow) {
  const issues = validateWorkflow(workflow);
  if (issues.length) throw new TroupeError(`工作流无效：\n- ${issues.join('\n- ')}`, 'INVALID_WORKFLOW');
  return workflow;
}

export function listWorkflows(workflowDir = DEFAULT_WORKFLOW_DIR) {
  const directory = path.resolve(workflowDir);
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  const workflows = [];
  const ids = new Set();
  for (const file of files) {
    const workflow = readJson(path.join(directory, file));
    const issues = validateWorkflow(workflow);
    if (isObject(workflow) && workflow.id !== path.basename(file, '.json')) issues.push(`工作流 id 必须与文件名一致：${file}`);
    if (ids.has(workflow?.id)) issues.push(`重复工作流 id：${workflow.id}`);
    if (issues.length) throw new TroupeError(`工作流无效 ${file}：\n- ${issues.join('\n- ')}`, 'INVALID_WORKFLOW');
    ids.add(workflow.id);
    workflows.push(workflow);
  }
  return workflows.sort((left, right) => left.id.localeCompare(right.id));
}

export function loadWorkflow(id, workflowDir = DEFAULT_WORKFLOW_DIR) {
  const workflows = listWorkflows(workflowDir);
  const workflow = workflows.find((item) => item.id === id);
  if (!workflow) fail(`未知工作流：${id}；可选：${workflows.map((item) => item.id).join(', ') || '(无)'}`, 'UNKNOWN_WORKFLOW');
  return workflow;
}

export function planWorkflow(workflow) {
  assertValidWorkflow(workflow);
  const steps = topologicalSteps(workflow);
  return {
    schemaVersion: 1,
    workflow: workflow.id,
    currentBatch: steps[0].id,
    batches: steps.map((step) => ({
      id: step.id,
      role: step.role,
      dependsOn: [...step.dependsOn],
      optional: step.optional,
      when: step.when,
      acceptance: step.acceptance,
      status: 'pending',
      result: null,
    })),
  };
}
