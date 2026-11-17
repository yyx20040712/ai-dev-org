export const LEVELS = Object.freeze(['low', 'high', 'max']);

export const ROLE_DEFS = Object.freeze({
  research: {
    title: '调研',
    description: '检索代码或资料，可用本地命令和小实验核验，区分事实、来源与推断。',
    tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Bash', 'Write', 'Edit'],
    color: 'cyan',
    contract: {
      summary: '一句话结论',
      facts: [{ statement: '已核实事实或明确标注的推断', evidence: 'path:line 或可访问 URL', kind: 'fact | inference' }],
      sources: ['实际查阅的路径或 URL'],
      uncertainties: ['仍不确定、缺失或无法核验的事项'],
    },
  },
  planner: {
    title: '规划',
    description: '为复杂或高风险改动比较方案并给出可执行建议，可用检索和小实验验证判断。',
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit'],
    color: 'blue',
    contract: {
      recommendation: '推荐方案及理由',
      steps: ['按实施顺序排列的动作'],
      files: ['预计影响的文件或目录'],
      verification: ['与风险相称的验证方式'],
      risks: ['主要风险、需求冲突或待用户决定事项'],
    },
  },
  executor: {
    title: '实现',
    description: '在明确范围内实现、测试并如实报告偏差。',
    tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'BashOutput', 'KillShell'],
    color: 'green',
    contract: {
      summary: '完成内容概述',
      changedFiles: [{ path: '实际变更路径', summary: '该文件的变化' }],
      tests: [{ command: '实际命令或检查', status: 'passed | failed | not_run', result: '真实结果摘要' }],
      failures: ['实际失败及原因；没有则为空数组'],
      unresolved: ['未解决事项；没有则为空数组'],
    },
  },
  reviewer: {
    title: '评审',
    description: '按需独立检查正确性、回归风险和验证缺口，可运行最小复现，不修改实现。',
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit'],
    color: 'yellow',
    contract: {
      status: 'PASS | FAIL | BLOCKED',
      findings: [{ path: '相关路径', line: 1, kind: 'defect | suggestion', impact: '实际影响', recommendation: '最小修复建议' }],
      checks: [{ command: '实际命令或检查', status: 'passed | failed | not_run', result: '真实结果摘要' }],
    },
  },
  vision: {
    title: '视觉',
    description: '根据实际渲染图像检查视觉结果，可调用既有渲染入口，不猜测未提供的画面。',
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit'],
    color: 'magenta',
    contract: {
      status: 'PASS | FAIL | BLOCKED',
      findings: [{ region: '页码、区域或 DOM 线索', issue: '观察到的问题', kind: 'defect | suggestion', recommendation: '最小修复建议' }],
      checks: ['实际查看的图像、区域和验收判据'],
    },
  },
});

export const ROLE_NAMES = Object.freeze(Object.keys(ROLE_DEFS));

export function assertRole(role) {
  if (!ROLE_NAMES.includes(role)) {
    const error = new Error(`未知角色：${role || '(未提供)'}；可选：${ROLE_NAMES.join(', ')}`);
    error.code = 'UNKNOWN_ROLE';
    throw error;
  }
  return role;
}
