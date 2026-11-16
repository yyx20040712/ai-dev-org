import { assertRole, ROLE_DEFS, ROLE_NAMES } from './roles.mjs';

export function routeRole(config, role) {
  assertRole(role);
  const roleConfig = config.roles?.[role] ?? { slots: [] };
  const level = roleConfig.level ?? (role === 'research' || role === 'executor' ? 'high' : 'max');
  return (roleConfig.slots ?? []).map((slotId) => {
    const slot = config.slots[slotId];
    if (!slot) throw new Error(`角色 ${role} 引用了不存在的槽位 ${slotId}`);
    return {
      role,
      slot: slotId,
      agent: `ops-${role}-${slotId}`,
      label: slot.label || slotId,
      model: slot.model,
      level,
      multimodal: slot.multimodal === true,
      tools: [...ROLE_DEFS[role].tools],
    };
  });
}

export function pickRole(config, role) {
  const [first] = routeRole(config, role);
  if (!first) {
    const error = new Error(`角色 ${role} 尚未配置模型；请运行 troupe init 或编辑用户配置`);
    error.code = 'NO_ROUTE';
    throw error;
  }
  return first;
}

export function inventory(config) {
  return ROLE_NAMES.map((role) => ({
    role,
    title: ROLE_DEFS[role].title,
    description: ROLE_DEFS[role].description,
    routes: routeRole(config, role),
  }));
}
