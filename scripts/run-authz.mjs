// run-authz.mjs — RT1B 唯一授权判定器（stub 阶段：self-test 台架完整、判定核心故意不满足行为断言）。
// 契约：evaluateMandate({mandate,queueItem,effect,context})->{decision,reasons,riskTags,policyHash}
//       evaluateMandateValidity({mandateRecord,policySnapshot,now})->{valid,reasons}（internal/non-authorizing）
// 生产边界：本批只建立可重放授权与 mandate 生命周期；self-test 的 allow 不是真实执行许可。
import { readFile, writeFile, mkdir, symlink, rm, realpath, access } from "node:fs/promises";
import path from "node:path";
import { canonicalJSON, sha256hex, HEX64, GENESIS_PARENT_HASH, RunStoreError, isRunStoreErrorFields } from "./run-state.mjs";
import { verifyClaimToken, verifyClaimTokenInUse } from "./run-store.mjs";

export const ZERO_HASH = "0".repeat(64);

// 内部探针（调用计数证明无第二套判定；不构成公共授权入口）
export const __probeState = { validityCoreCalls: 0, evaluateMandateCalls: 0, sharedRuleCalls: {}, lastConditions: null };

export function computePolicyHash(policyObject) {
  return sha256hex(canonicalJSON(policyObject));
}

// ====================== 唯一授权判定器（判定序冻结见 RT1B §3.4.6）======================
// 判定序：mandate 状态（撤销 deny·reason=mandate_revoked）→有效期/时钟地板→claimToken 一致性
// 与撤销失效→project/queue/path/effect 范围→五绑定/禁止项/undo·verify·独立 DoD→能力（八条件）
// →riskTags。前序 deny 不被后序 allow 覆盖；撤销检查不推进 run-store state。

const MANDATE_FIELDS = ["mandate_id", "project_id", "queue_scope", "path_allowlist", "effect_allowlist", "taskbook_hash", "dod_hash", "route_hash", "dispatch_plan_hash", "policy_hash", "reversible_actions", "prohibitions", "valid_from", "valid_until", "revoked", "effect_undo_recipe", "verify", "independent_dod_evidence"];
const QUEUE_ITEM_KEYS = ["projectId", "queue", "taskbookHash", "dodHash", "routeHash", "dispatchPlanHash"];
const CONTEXT_KEYS = ["projectId", "now", "clockFloor", "policy", "state", "claimToken", "operationId"];
const EFFECT_KEYS = ["effectId", "kind", "programHash", "argvSchema", "argv", "target", "realpath", "env", "envAllowlist", "resourceLimits", "preflight", "undoRecipe", "undoVerify", "undoDrill", "independentDodEvidence", "shellUsed", "packageManagerUsed", "networkUsed", "symlinkResolved", "networkIsolation", "pathIsolation", "resourceIsolation"];
const POLICY_KEYS = ["schema_version", "scope", "risk_tags", "capability_requirements", "validity", "note"];
const KNOWN_KINDS = ["DETERMINISTIC_LOCAL", "HOST_AGENT", "EXTERNAL"];
const RESOURCE_LIMIT_KEYS = ["cpuSeconds", "maxMemoryMb", "maxFileBytes", "maxProcesses"];
const WRAPPER_KEYS = ["envelope_revision", "mandate", "policy_snapshot", "revoked", "status"];
const UNCHECKABLE_MARKER = "not-machine-checkable";
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
// T3：effect 在场键类型表（undoRecipe/realpath/env 必携另判）
const EFFECT_VALUE_TYPES = {
  effectId: "string", kind: "string", programHash: "string", target: "string", realpath: "string",
  argvSchema: "object", argv: "object", env: "object", resourceLimits: "object", preflight: "object",
  undoRecipe: "object", undoVerify: "object", undoDrill: "object", independentDodEvidence: "object",
  envAllowlist: "object",
  shellUsed: "boolean", packageManagerUsed: "boolean", networkUsed: "boolean",
  symlinkResolved: "boolean", networkIsolation: "boolean", pathIsolation: "boolean", resourceIsolation: "boolean",
};
// T16：effect 内层证据闭集
const INNER_CLOSED_SETS = {
  preflight: ["mode", "result"],
  undoRecipe: ["steps", "scope"],
  undoVerify: ["command", "expect"],
  undoDrill: ["result", "evidenceHash"],
  independentDodEvidence: ["confirmedBy", "evidenceHash"],
  resourceLimits: RESOURCE_LIMIT_KEYS,
  argvSchema: ["type", "required", "properties"],
};

function sharedRule(name, via) {
  if (!Array.isArray(__probeState.sharedRuleCalls[name])) __probeState.sharedRuleCalls[name] = [];
  __probeState.sharedRuleCalls[name].push(via);
}

// T5：严格日历解析——正则取分量→Date.UTC 构造→回读分量全等；2026-02-30 等非法日历日拒绝
// R2/W-05：导出供 run-mandate 装载期真共用（captured_at 同一严格口径）
// R3/T22：时区偏移 HH∈[0,23]/MM∈[0,59] 范围校验（+99:99/+01:60/-00:60 拒）；
//         小数秒纳入毫秒并回读比对（12:30:00.999Z ≠ 12:30:00Z）
export function parseTimeWithTz(s) {
  if (typeof s !== "string") return null;
  const m = TIME_RE.exec(s.trim());
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, S, Frac, off] = m;
  const sec = S === undefined ? 0 : Number(S);
  const fracMs = Frac === undefined ? 0 : Math.round(Number(Frac) * 1000);
  if (!Number.isInteger(sec) || sec < 0 || sec > 59) return null;
  if (!Number.isInteger(fracMs) || fracMs < 0 || fracMs > 999) return null;
  let offMs = 0;
  if (off !== "Z") {
    const sign = off[0] === "-" ? -1 : 1;
    const digits = off.slice(1).replace(":", "");
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2));
    if (!Number.isInteger(oh) || oh < 0 || oh > 23) return null;
    if (!Number.isInteger(om) || om < 0 || om > 59) return null;
    offMs = sign * (oh * 60 + om) * 60000;
  }
  const ms = Date.UTC(Number(Y), Number(Mo) - 1, Number(D), Number(H), Number(Mi), sec, fracMs) - offMs;
  if (!Number.isFinite(ms)) return null;
  const chk = new Date(ms + offMs);
  if (chk.getUTCFullYear() !== Number(Y) || chk.getUTCMonth() !== Number(Mo) - 1 || chk.getUTCDate() !== Number(D) || chk.getUTCHours() !== Number(H) || chk.getUTCMinutes() !== Number(Mi) || chk.getUTCSeconds() !== sec || chk.getUTCMilliseconds() !== fracMs) return null;
  return ms;
}

// T16：不可机检标记递归扫描（任意字符串承载位命中即真）
function scanUncheckableMarker(o) {
  if (typeof o === "string") return o === UNCHECKABLE_MARKER;
  if (Array.isArray(o)) return o.some(scanUncheckableMarker);
  if (o && typeof o === "object") return Object.values(o).some(scanUncheckableMarker);
  return false;
}

// T16：effect 内层证据闭集校验（未知子键 deny）
function checkEffectInnerClosedSets(effect) {
  for (const [field, allowed] of Object.entries(INNER_CLOSED_SETS)) {
    const v = effect[field];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    for (const k of Object.keys(v)) if (!allowed.includes(k)) return "invalid_" + field + "_key:" + k;
  }
  const schema = effect.argvSchema;
  if (schema && typeof schema === "object" && !Array.isArray(schema) && schema.properties && typeof schema.properties === "object") {
    for (const [k, def] of Object.entries(schema.properties)) {
      if (!def || typeof def !== "object") return "invalid_argvSchema_key:" + k;
      for (const dk of Object.keys(def)) if (dk !== "type") return "invalid_argvSchema_key:" + k + "." + dk;
    }
  }
  return null;
}

// T9：context.state 形状守卫（malformed=结构化 deny，不进 run-store 抛 TypeError）
// R2/W-01：effects 逐元素校验（object 且 effect_id 字符串；[null] 等元素级 malformed 拒绝）
function claimStateShapeOk(state) {
  return !!(state && typeof state === "object" && !Array.isArray(state)
    && typeof state.state_uuid === "string"
    && Number.isInteger(state.revision)
    && state.authorization && typeof state.authorization === "object" && !Array.isArray(state.authorization)
    && Number.isInteger(state.authorization.controller_epoch)
    && Number.isInteger(state.authorization.stop_epoch)
    && state.authorization.controller && typeof state.authorization.controller === "object"
    && typeof state.authorization.controller.session_uuid === "string"
    && Array.isArray(state.effects)
    && state.effects.every((e) => e && typeof e === "object" && !Array.isArray(e) && typeof e.effect_id === "string"));
}

function isNonEmptyStringArray(v) {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.length > 0);
}

// R3/T19＋R4：argvSchema 形状严格化——畸形 schema=能力不可证明（manual）：
// R4/B-01：顶层 type 必须恰 "object"（缺失/异值/数组形均 manual）；required 须为字符串数组；
// properties.*.type ∈ JSON 基本类型闭集；全空 schema（required:[]＋properties:{}）=合法无参程序口径（§3.6.9 注）。
const ARGV_SCHEMA_JSON_TYPES = ["string", "integer", "number", "boolean", "object", "array"];
function argvSchemaWellFormed(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  if (schema.type !== "object") return false; // R4：顶层闭合（含缺失/异值/"array" 等）
  if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every((k) => typeof k === "string"))) return false;
  if (schema.properties !== undefined) {
    if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) return false;
    for (const def of Object.values(schema.properties)) {
      if (!def || typeof def !== "object" || Array.isArray(def)) return false;
      if (def.type === undefined || !ARGV_SCHEMA_JSON_TYPES.includes(def.type)) return false;
    }
  }
  return true;
}

function argvConforms(argv, schema) {
  if (!argv || typeof argv !== "object" || Array.isArray(argv)) return false;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!required.every((k) => k in argv)) return false;
  const props = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  for (const [k, v] of Object.entries(argv)) {
    const def = props[k];
    if (!def) return false;
    if (def.type === "string" && typeof v !== "string") return false;
    else if (def.type === "integer" && !Number.isInteger(v)) return false;
    else if (def.type === "number" && (typeof v !== "number" || v !== v)) return false;
    else if (def.type === "boolean" && typeof v !== "boolean") return false;
    // R4：object 类型属性值 null 不得借 typeof null==="object" 洗绿
    else if (def.type === "object" && (v === null || typeof v !== "object" || Array.isArray(v))) return false;
    else if (def.type === "array" && !Array.isArray(v)) return false;
  }
  return true;
}

function computeRiskTags(effect, policy) {
  const vocab = policy && policy.risk_tags && Array.isArray(policy.risk_tags.vocabulary) ? policy.risk_tags.vocabulary : [];
  const pick = (candidates) => candidates.find((t) => vocab.includes(t)) || candidates[candidates.length - 1];
  const tags = new Set();
  tags.add("effect." + String(effect.kind).toLowerCase());
  tags.add(argvConforms(effect.argv, effect.argvSchema) ? "argv.typed" : "argv.untyped");
  tags.add("fs.contained");
  tags.add(effect.networkUsed === false ? "net.none" : "net.unknown");
  const elevated = effect.shellUsed === true || effect.packageManagerUsed === true;
  tags.add(elevated ? pick(["risk.elevated", "risk.critical", "risk.low"]) : pick(["risk.low", "risk.critical", "risk.elevated"]));
  const sorted = [...tags].sort();
  const unknown = sorted.filter((t) => !vocab.includes(t));
  return { tags: sorted, unknown };
}

// ---------------- 共享规则原语（evaluate 与 validity 核心共用，无第二套）----------------
function ruleRevocation(record, via) {
  sharedRule("revocation", via);
  const m = record.mandate || record;
  if (record.revoked === true || (record.revoked && typeof record.revoked === "object")) return ["mandate_revoked"];
  if (record.status === "revoked") return ["mandate_revoked"];
  if (m && m.revoked === true) return ["mandate_revoked"];
  return [];
}
function rulePolicySnapshot(policySnapshot, mandatePolicyHash, via) {
  sharedRule("policy", via);
  const out = [];
  if (!policySnapshot || typeof policySnapshot !== "object" || Array.isArray(policySnapshot)) return ["policy_snapshot_invalid"];
  if (Object.keys(policySnapshot).sort().join(",") !== "captured_at,policy_hash,policy_object") return ["policy_snapshot_invalid"];
  if (computePolicyHash(policySnapshot.policy_object) !== policySnapshot.policy_hash) out.push("policy_snapshot_corrupted");
  if (parseTimeWithTz(policySnapshot.captured_at) === null) out.push("policy_snapshot_invalid_captured_at");
  if (typeof mandatePolicyHash !== "string" || mandatePolicyHash !== policySnapshot.policy_hash) out.push("policy_hash_mismatch");
  return out;
}
function ruleValidityWindow(mandate, nowMs, via) {
  sharedRule("validity", via);
  const from = parseTimeWithTz(mandate.valid_from);
  const until = parseTimeWithTz(mandate.valid_until);
  if (from === null || until === null || until < from) return ["invalid_time_format"];
  if (nowMs === null) return ["invalid_time_format"];
  if (nowMs < from) return ["not_yet_valid"];
  if (nowMs > until) return ["expired"];
  return [];
}
function ruleClockFloor(nowMs, floorMs, via) {
  sharedRule("clock_floor", via);
  if (floorMs !== null && floorMs !== undefined && nowMs !== null && nowMs < floorMs) return ["clock_rollback"];
  return [];
}
function ruleScopeShape(mandate, via) {
  sharedRule("scope", via);
  const out = [];
  if (!isNonEmptyStringArray(mandate.queue_scope)) out.push("empty_queue_scope");
  if (!isNonEmptyStringArray(mandate.path_allowlist)) out.push("empty_path_allowlist");
  if (!isNonEmptyStringArray(mandate.effect_allowlist)) out.push("empty_effect_allowlist");
  return out;
}

// ---------------- evaluateMandate：唯一效果授权判定入口（四键返回闭集）----------------
// 返工 R1（T1/T2/T3/T5/T9/T10/T15/T16）：KNOWN_KINDS 硬拒绝先于一切 allowlist；
// HOST_AGENT/EXTERNAL 硬编码 manual（policy manual_only_kinds 只并集加严）；
// realpath 双边界（policy 前缀＋mandate allowRoot）＋realpath/undoRecipe 证据交叉一致；
// effect 22 键在场/类型校验（env 缺失不默认 {}）；内层闭集＋不可机检标记全字符串扫描；
// 严格日历校验；context.state 形状 malformed=结构化 deny；deny/manual 返回可定位的实际
// policy 快照 hash（唯 mandate/policy 均不可定位时 ZERO_HASH＋no_policy_resolvable）。
export async function evaluateMandate(input) {
  __probeState.evaluateMandateCalls += 1;
  __probeState.lastConditions = null;
  const ret = (decision, reasons, riskTags, policyHash) => ({ decision, reasons, riskTags, policyHash });
  // K2：最早拒绝面也能解出 policy 即返回真实快照 hash（唯不可定位时 ZERO+no_policy_resolvable）
  // R2/W-03：浮点等不可 canonical 的 policy——hash 计算收敛为 invalid_policy＋no_policy_resolvable（禁 TypeError 外抛）
  const earlyCtx = input && typeof input === "object" && !Array.isArray(input) ? input.context : null;
  const earlyPolicy = earlyCtx && typeof earlyCtx.policy === "object" && !Array.isArray(earlyCtx.policy) ? earlyCtx.policy : null;
  let earlyPolicyHash = ZERO_HASH;
  let earlyPolicyHashable = false;
  if (earlyPolicy) {
    try { earlyPolicyHash = computePolicyHash(earlyPolicy); earlyPolicyHashable = true; }
    catch { earlyPolicyHash = ZERO_HASH; earlyPolicyHashable = false; }
  }
  const noPolicy = (reasons) => ret("deny", earlyPolicyHashable ? reasons : [...reasons, "no_policy_resolvable"], [], earlyPolicyHash);
  if (!input || typeof input !== "object" || Array.isArray(input)) return noPolicy(["invalid_argument"]);
  for (const k of Object.keys(input)) if (!["mandate", "queueItem", "effect", "context"].includes(k)) return noPolicy(["unexpected_parameter"]);
  for (const k of ["mandate", "queueItem", "effect", "context"]) if (!(k in input)) return noPolicy(["missing_parameter:" + k]);
  const { mandate, queueItem, effect, context } = input;

  // 输入闭集：调用方 riskTags 不进入信任输入
  if (queueItem && "riskTags" in queueItem) return noPolicy(["caller_risk_tags_forbidden"]);
  if (effect && "riskTags" in effect) return noPolicy(["caller_risk_tags_forbidden"]);
  if (!queueItem || typeof queueItem !== "object" || !effect || typeof effect !== "object" || !context || typeof context !== "object" || !mandate || typeof mandate !== "object") {
    return noPolicy(["invalid_argument"]);
  }
  for (const k of Object.keys(queueItem)) if (!QUEUE_ITEM_KEYS.includes(k)) return noPolicy(["unknown_queue_item_key:" + k]);
  for (const k of QUEUE_ITEM_KEYS) if (!(k in queueItem)) return noPolicy(["missing_queue_item_key:" + k]);
  for (const k of Object.keys(context)) if (!CONTEXT_KEYS.includes(k)) return noPolicy(["unknown_context_key:" + k]);
  for (const k of ["projectId", "now", "clockFloor", "policy"]) if (!(k in context)) return noPolicy(["missing_context_key:" + k]);
  for (const k of Object.keys(effect)) if (!EFFECT_KEYS.includes(k)) return noPolicy(["unknown_effect_key:" + k]);
  if (typeof effect.effectId !== "string" || !effect.effectId) return noPolicy(["invalid_effect_id"]);
  if (typeof effect.kind !== "string" || !effect.kind) return noPolicy(["invalid_effect_kind"]);

  // T1 硬不变量：未知 effect kind 在任何 policy/mandate allowlist 判定之前一律 deny
  if (!KNOWN_KINDS.includes(effect.kind)) return noPolicy(["unknown_effect"]);

  // policy 快照对象（分源：非完整 org 配置、非 cfg_hash）；R2/W-03：不可 canonical（浮点等）=invalid_policy
  const policy = context.policy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return noPolicy(["invalid_policy"]);
  for (const k of Object.keys(policy)) if (!POLICY_KEYS.includes(k)) return noPolicy(["unknown_policy_key:" + k]);
  let policyHash;
  try { policyHash = computePolicyHash(policy); }
  catch { return ret("deny", ["invalid_policy", "no_policy_resolvable"], [], ZERO_HASH); }
  const polScope = policy.scope && typeof policy.scope === "object" ? policy.scope : null;
  if (!polScope || !isNonEmptyStringArray(polScope.project_ids) || !isNonEmptyStringArray(polScope.queues) || !isNonEmptyStringArray(polScope.path_prefixes) || !isNonEmptyStringArray(polScope.effect_kinds)) {
    return ret("deny", ["invalid_policy_scope"], [], policyHash);
  }
  const vocab = policy.risk_tags && isNonEmptyStringArray(policy.risk_tags.vocabulary) ? policy.risk_tags.vocabulary : null;
  if (!vocab) return ret("deny", ["invalid_policy_risk_tags"], [], policyHash);
  const manualOnly = policy.capability_requirements && isNonEmptyStringArray(policy.capability_requirements.manual_only_kinds) ? policy.capability_requirements.manual_only_kinds : null;
  if (!manualOnly) return ret("deny", ["invalid_policy_capability_requirements"], [], policyHash);

  // mandate 十八字段闭集与 hash 形态（缺字段/额外字段/非 hex64 deny）
  const missing = MANDATE_FIELDS.filter((f) => !(f in mandate));
  if (missing.length) return ret("deny", missing.map((f) => "missing_mandate_field:" + f), [], policyHash);
  const extra = Object.keys(mandate).filter((k) => !MANDATE_FIELDS.includes(k));
  if (extra.length) return ret("deny", extra.map((k) => "unknown_mandate_field:" + k), [], policyHash);
  for (const f of ["taskbook_hash", "dod_hash", "route_hash", "dispatch_plan_hash", "policy_hash"]) {
    if (typeof mandate[f] !== "string" || !HEX64.test(mandate[f])) return ret("deny", ["invalid_mandate_hash:" + f], [], policyHash);
  }
  for (const f of ["taskbookHash", "dodHash", "routeHash", "dispatchPlanHash"]) {
    if (typeof queueItem[f] !== "string" || !HEX64.test(queueItem[f])) return ret("deny", ["invalid_binding_hash:" + f], [], policyHash);
  }
  if (typeof mandate.revoked !== "boolean") return ret("deny", ["invalid_mandate_revoked_flag"], [], policyHash);
  for (const f of ["queue_scope", "path_allowlist", "effect_allowlist", "reversible_actions", "prohibitions"]) {
    if (!Array.isArray(mandate[f]) || !mandate[f].every((x) => typeof x === "string" && x.length > 0)) return ret("deny", ["invalid_mandate_array:" + f], [], policyHash);
  }

  // T3：effect 证据必携（env 缺失不得默认 {}；undoRecipe/realpath 必携）＋在场键类型校验
  // R2/W-02：null 视为错类型显式拒（env:null 等不得借 typeof null==="object" 洗绿）
  for (const [k, t] of Object.entries(EFFECT_VALUE_TYPES)) {
    if (k in effect && (effect[k] === null || typeof effect[k] !== t)) return ret("deny", ["invalid_effect_evidence:" + k], [], policyHash);
  }
  if (!("env" in effect)) return ret("deny", ["env_evidence_missing"], [], policyHash);
  if (!("undoRecipe" in effect)) return ret("deny", ["undo_recipe_missing"], [], policyHash);
  if (!("realpath" in effect)) return ret("deny", ["realpath_evidence_missing"], [], policyHash);
  if (effect.env && (Array.isArray(effect.env) || typeof effect.env !== "object" || !Object.values(effect.env).every((v) => typeof v === "string"))) {
    return ret("deny", ["invalid_effect_evidence:env"], [], policyHash);
  }
  if (Array.isArray(effect.envAllowlist) && !effect.envAllowlist.every((x) => typeof x === "string")) return ret("deny", ["invalid_effect_evidence:envAllowlist"], [], policyHash);

  // T16：不可机检标记全字符串递归扫描（先于内层闭集，任何承载位命中即 deny）
  if (scanUncheckableMarker(effect) || scanUncheckableMarker(mandate.effect_undo_recipe) || scanUncheckableMarker(mandate.verify) || scanUncheckableMarker(mandate.independent_dod_evidence)) {
    return ret("deny", ["uncheckable_constraint"], [], policyHash);
  }
  // T16：effect 内层证据闭集（未知子键 deny）
  const innerBad = checkEffectInnerClosedSets(effect);
  if (innerBad) return ret("deny", [innerBad], [], policyHash);

  // 1) mandate 状态：撤销立即 deny
  const revReasons = ruleRevocation({ mandate, status: "active", revoked: mandate.revoked }, "evaluate");
  if (revReasons.length) return ret("deny", revReasons, [], policyHash);

  // 2) 有效期与时钟地板（严格日历校验）
  const nowMs = parseTimeWithTz(context.now);
  const floorMs = parseTimeWithTz(context.clockFloor);
  const timeReasons = nowMs === null || floorMs === null ? ["invalid_time_format"] : [...ruleValidityWindow(mandate, nowMs, "evaluate"), ...ruleClockFloor(nowMs, floorMs, "evaluate")];
  if (timeReasons.length) return ret("deny", timeReasons, [], policyHash);

  // 3) claimToken 七字段一致性（公共消费只调 RT1A 导出；malformed state=结构化 deny）
  if ("state" in context && !("claimToken" in context)) return ret("deny", ["caller_snapshot_forbidden"], [], policyHash);
  if ("claimToken" in context) {
    if (!context.state || typeof context.state !== "object") return ret("deny", ["claim_token_unverifiable"], [], policyHash);
    if (!claimStateShapeOk(context.state)) return ret("deny", ["claim_token_state_malformed"], [], policyHash);
    const op = typeof context.operationId === "string" && context.operationId ? context.operationId : context.claimToken && context.claimToken.operation_id;
    if (!verifyClaimTokenInUse(context.state, context.claimToken, op)) return ret("deny", ["claim_token_rejected"], [], policyHash);
  }

  // 4) policy_hash 绑定（cfg_hash/局部 hash 代替均 mismatch）
  if (mandate.policy_hash !== policyHash) return ret("deny", ["policy_hash_mismatch"], [], policyHash);

  // 5) project/queue 双重范围
  if (mandate.project_id !== queueItem.projectId || context.projectId !== queueItem.projectId) return ret("deny", ["project_scope_mismatch"], [], policyHash);
  if (!polScope.project_ids.includes(queueItem.projectId)) return ret("deny", ["project_not_in_policy_scope"], [], policyHash);
  const scopeShape = ruleScopeShape(mandate, "evaluate");
  if (scopeShape.length) return ret("deny", scopeShape, [], policyHash);
  if (!mandate.queue_scope.includes(queueItem.queue)) return ret("deny", ["queue_not_in_mandate_scope"], [], policyHash);
  if (!polScope.queues.includes(queueItem.queue)) return ret("deny", ["queue_not_in_policy_scope"], [], policyHash);

  // 6) path 范围：词法 .. 拒绝 → 绝对路径 → 白名单边界包含 → policy 前缀 → realpath 双边界（T2）
  const target = effect.target;
  if (typeof target !== "string" || !target) return ret("deny", ["invalid_target"], [], policyHash);
  if (target.includes("..")) return ret("deny", ["path_traversal"], [], policyHash);
  if (!path.isAbsolute(target)) return ret("deny", ["relative_path_forbidden"], [], policyHash);
  const boundaryRoot = (root, p) => { const r = root.replace(/\/+$/, ""); return p === r || p.startsWith(r + "/") ? root : null; };
  const allowRoot = mandate.path_allowlist.map((r) => boundaryRoot(r, target)).find(Boolean);
  if (!allowRoot) return ret("deny", ["path_out_of_allowlist"], [], policyHash);
  if (!polScope.path_prefixes.some((p) => target.startsWith(p))) return ret("deny", ["path_not_in_policy_scope"], [], policyHash);
  let real;
  try { real = await realpath(target); } catch { return ret("deny", ["realpath_unresolved"], [], policyHash); }
  if (!polScope.path_prefixes.some((p) => real.startsWith(p))) return ret("deny", ["realpath_not_in_policy_scope"], [], policyHash);
  if (!boundaryRoot(allowRoot, real)) return ret("deny", ["symlink_escape"], [], policyHash);
  if (effect.realpath !== real) return ret("deny", ["realpath_evidence_mismatch"], [], policyHash);

  // 7) effect 双重 allowlist（未知 kind 已在硬不变量段拒绝）
  if (!polScope.effect_kinds.includes(effect.kind)) return ret("deny", ["effect_not_in_policy_scope"], [], policyHash);
  if (!mandate.effect_allowlist.includes(effect.kind)) return ret("deny", ["effect_not_in_mandate_allowlist"], [], policyHash);

  // 8) 五绑定与禁止项
  const bindings = [["taskbookHash", "taskbook_hash"], ["dodHash", "dod_hash"], ["routeHash", "route_hash"], ["dispatchPlanHash", "dispatch_plan_hash"]];
  for (const [q, m] of bindings) if (queueItem[q] !== mandate[m]) return ret("deny", ["binding_mismatch:" + m], [], policyHash);
  if (mandate.prohibitions.includes(effect.effectId) || mandate.prohibitions.includes(effect.kind)) return ret("deny", ["prohibition_hit"], [], policyHash);
  if (!(mandate.reversible_actions.includes(effect.effectId) || mandate.reversible_actions.includes(effect.kind))) return ret("deny", ["action_not_reversible"], [], policyHash);

  // 9) undo recipe/verify/独立 DoD 绑定＋effect 侧证据交叉一致（T3：无关 undoRecipe deny）
  const recipe = mandate.effect_undo_recipe;
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) return ret("deny", ["invalid_undo_recipe"], [], policyHash);
  const recipeSteps = Array.isArray(recipe.steps) ? recipe.steps : null;
  if (!recipeSteps || recipeSteps.length === 0 || !recipeSteps.every((s) => typeof s === "string" && s)) return ret("deny", ["undo_recipe_empty"], [], policyHash);
  if (typeof recipe.scope !== "string" || !recipe.scope || !boundaryRoot(allowRoot, recipe.scope)) return ret("deny", ["undo_scope_mismatch"], [], policyHash);
  const verifyCmd = mandate.verify;
  if (!verifyCmd || typeof verifyCmd !== "object" || typeof verifyCmd.command !== "string" || !verifyCmd.command || typeof verifyCmd.expect !== "string" || !verifyCmd.expect) return ret("deny", ["verify_missing"], [], policyHash);
  const dod = mandate.independent_dod_evidence;
  if (!dod || typeof dod !== "object") return ret("deny", ["invalid_dod_evidence"], [], policyHash);
  if (typeof dod.command !== "string" || !dod.command) return ret("deny", ["dod_missing_command"], [], policyHash);
  if (typeof dod.expect !== "string" || !dod.expect) return ret("deny", ["dod_missing_expect"], [], policyHash);
  // R3/T20：确认人必须在场、非空字符串（缺失/空=deny；执行者自报另有 dod_self_reported）
  if (typeof dod.confirmedBy !== "string" || !dod.confirmedBy.trim()) return ret("deny", ["independent_dod_invalid"], [], policyHash);
  if (dod.confirmedBy === "executor" || dod.confirmedBy === "self") return ret("deny", ["dod_self_reported"], [], policyHash);
  if (typeof dod.evidenceHash !== "string" || !HEX64.test(dod.evidenceHash)) return ret("deny", ["dod_hash_invalid"], [], policyHash);
  if (dod.evidenceHash !== sha256hex(canonicalJSON({ command: dod.command, expect: dod.expect }))) return ret("deny", ["dod_hash_mismatch"], [], policyHash);
  const effectRecipe = effect.undoRecipe;
  if (!effectRecipe || typeof effectRecipe !== "object" || Array.isArray(effectRecipe)) return ret("deny", ["undo_recipe_missing"], [], policyHash);
  // R3/T21：steps 须为字符串数组（[0.6] 等非字符串承载=结构化 deny，禁 canonicalJSON 裸 TypeError）
  if (!Array.isArray(effectRecipe.steps) || !effectRecipe.steps.every((s) => typeof s === "string")) return ret("deny", ["invalid_effect_evidence:undoRecipe"], [], policyHash);
  if (canonicalJSON(effectRecipe.steps) !== canonicalJSON(recipeSteps) || effectRecipe.scope !== recipe.scope) return ret("deny", ["undo_recipe_mismatch"], [], policyHash);
  const effectVerify = effect.undoVerify;
  if (!effectVerify || typeof effectVerify !== "object" || typeof effectVerify.command !== "string" || !effectVerify.command || typeof effectVerify.expect !== "string" || !effectVerify.expect) return ret("deny", ["undo_verify_missing"], [], policyHash);
  const drill = effect.undoDrill;
  if (!drill || typeof drill !== "object") return ret("deny", ["undo_drill_missing"], [], policyHash);
  if (drill.result !== "passed") return ret("deny", ["undo_drill_not_passed"], [], policyHash);
  if (drill.evidenceHash !== sha256hex(canonicalJSON({ command: effectVerify.command, expect: effectVerify.expect }))) return ret("deny", ["undo_drill_hash_mismatch"], [], policyHash);
  const effectDod = effect.independentDodEvidence;
  if (!effectDod || typeof effectDod !== "object" || effectDod.confirmedBy !== dod.confirmedBy || effectDod.evidenceHash !== dod.evidenceHash) return ret("deny", ["dod_evidence_mismatch"], [], policyHash);

  // 10) HOST_AGENT/EXTERNAL 硬编码 manual（T1：policy manual_only_kinds 只能并集加严，不能放宽）
  if (effect.kind === "HOST_AGENT" || effect.kind === "EXTERNAL" || manualOnly.includes(effect.kind)) {
    return ret("manual", ["manual_only_kind:" + effect.kind], [], policyHash);
  }

  // 11) DETERMINISTIC_LOCAL 八条件能力检测（c7/c8 消费真实证据，不预置 pass）
  const conditions = { c1: "pass", c2: "pass", c3: "pass", c4: "pass", c5: "pass", c6: "pass", c7: "pass", c8: "pass" };
  const manualReasons = [];
  if (!(typeof effect.programHash === "string" && HEX64.test(effect.programHash)) || !argvSchemaWellFormed(effect.argvSchema) || !argvConforms(effect.argv, effect.argvSchema)) { conditions.c1 = "manual"; manualReasons.push("capability_program_argv"); }
  if (effect.shellUsed !== false) { conditions.c2 = "manual"; manualReasons.push("capability_shell_forbidden"); }
  else if (effect.packageManagerUsed !== false) { conditions.c2 = "manual"; manualReasons.push("capability_package_manager_forbidden"); }
  else if (effect.networkUsed !== false) { conditions.c2 = "manual"; manualReasons.push("capability_network_forbidden"); }
  if (!Array.isArray(effect.envAllowlist) || !Object.keys(effect.env).every((k) => effect.envAllowlist.includes(k))) { conditions.c3 = "manual"; manualReasons.push("capability_env_allowlist"); }
  if (effect.symlinkResolved !== true) { conditions.c4 = "manual"; manualReasons.push("capability_symlink_checks"); }
  const limits = effect.resourceLimits;
  if (!limits || typeof limits !== "object" || !RESOURCE_LIMIT_KEYS.every((k) => Number.isInteger(limits[k]) && limits[k] > 0)) { conditions.c5 = "manual"; manualReasons.push("capability_resource_limits"); }
  const pf = effect.preflight;
  if (!pf || typeof pf !== "object" || pf.mode !== "read-only" || pf.result !== "PASS") { conditions.c6 = "manual"; manualReasons.push("capability_preflight"); }
  conditions.c7 = (effectRecipe && Array.isArray(effectRecipe.steps) && effectRecipe.steps.length > 0 && effectVerify && recipe && verifyCmd) ? "pass" : "unproven";
  conditions.c8 = (effectDod && dod && HEX64.test(String(dod.evidenceHash)) && effectDod.evidenceHash === dod.evidenceHash) ? "pass" : "unproven";
  // OS 级网络/路径/资源隔离：任一不可用→合格集为空，全部转人工
  if (effect.networkIsolation !== true) manualReasons.push("capability_os_network_isolation");
  if (effect.pathIsolation !== true) manualReasons.push("capability_os_path_isolation");
  if (effect.resourceIsolation !== true) manualReasons.push("capability_os_resource_isolation");
  __probeState.lastConditions = { ...conditions };
  if (manualReasons.length || conditions.c7 !== "pass" || conditions.c8 !== "pass") {
    const extraManual = [];
    if (conditions.c7 !== "pass") extraManual.push("capability_undo_evidence_unproven");
    if (conditions.c8 !== "pass") extraManual.push("capability_dod_evidence_unproven");
    return ret("manual", [...manualReasons, ...extraManual], [], policyHash);
  }

  // 12) riskTags 只由 authz 生成；未知标签 deny
  const { tags, unknown } = computeRiskTags(effect, policy);
  if (unknown.length) return ret("deny", ["unknown_risk_tag"], [], policyHash);
  return ret("allow", [], tags, policyHash);
}

// -------- evaluateMandateValidity：internal/non-authorizing 共享判定核心 --------
// 覆盖撤销/有效期/时钟地板/policy 匹配/范围闭集；不授予 allow（无 decision 面）。
// K1 裁定：mandateRecord 保持恰五键闭集；信封 clock_floor 以独立参数 clockFloor 传入（不进 mandateRecord）。
export async function evaluateMandateValidity(args) {
  const { mandateRecord, policySnapshot, now, clockFloor } = args ?? {};
  __probeState.validityCoreCalls += 1;
  const bad = (reasons) => ({ valid: false, reasons });
  if (!mandateRecord || typeof mandateRecord !== "object" || Array.isArray(mandateRecord)) return bad(["invalid_mandate_record"]);
  for (const k of Object.keys(mandateRecord)) if (!WRAPPER_KEYS.includes(k)) return bad(["invalid_wrapper_key:" + k]);
  for (const k of WRAPPER_KEYS) if (!(k in mandateRecord)) return bad(["missing_wrapper_key:" + k]);
  const mandate = mandateRecord.mandate;
  if (!mandate || typeof mandate !== "object") return bad(["invalid_mandate"]);
  const missing = MANDATE_FIELDS.filter((f) => !(f in mandate));
  if (missing.length) return bad(missing.map((f) => "missing_mandate_field:" + f));
  const extra = Object.keys(mandate).filter((k) => !MANDATE_FIELDS.includes(k));
  if (extra.length) return bad(extra.map((k) => "unknown_mandate_field:" + k));
  for (const f of ["taskbook_hash", "dod_hash", "route_hash", "dispatch_plan_hash", "policy_hash"]) {
    if (typeof mandate[f] !== "string" || !HEX64.test(mandate[f])) return bad(["invalid_mandate_hash:" + f]);
  }
  const revReasons = ruleRevocation(mandateRecord, "core");
  const polReasons = rulePolicySnapshot(policySnapshot, mandate.policy_hash, "core");
  const nowMs = typeof now === "number" ? (Number.isInteger(now) ? now : null) : parseTimeWithTz(now);
  const floorMs = Number.isInteger(clockFloor) ? clockFloor : null;
  const timeReasons = nowMs === null ? ["invalid_time_format"] : [...ruleValidityWindow(mandate, nowMs, "core"), ...ruleClockFloor(nowMs, floorMs, "core")];
  const scopeReasons = ruleScopeShape(mandate, "core");
  const reasons = [...revReasons, ...polReasons, ...timeReasons, ...scopeReasons];
  return { valid: reasons.length === 0, reasons };
}
// ============================ 判定核心结束 ==========================

// ------------------------------ self-test 台架 -------------------------------
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const DEFAULT_FIXTURES = path.join(SCRIPT_DIR, ".golden", "run-authz-fixtures.json");
const DEFAULT_TEMP_ROOT = "/tmp/rt1b-executor-selftest";
const TEMP_ROOT_PREFIX = "/tmp/rt1b-executor-";
const FORBIDDEN_ROOTS = ["/home/yyx/work/aidevorg", "/home/yyx/.zcode/skills/ai-dev-org", "/home/yyx", "/home/yyx/.zcode"];

function usageExit(msg) {
  console.error("[usage] " + msg);
  console.error("[usage] node run-authz.mjs --self-test [--fixtures <file>] [--temp-root <dir>]");
  process.exit(1);
}

// T4：temp-root 校验返回结构化结果（不直接 exit），补根及父链 realpath 解析防符号链接越界
async function checkTempRoot(raw) {
  const resolved = path.resolve(String(raw));
  if (resolved.includes("\0")) return { ok: false, resolved, reason: "非法字节" };
  if (!resolved.startsWith(TEMP_ROOT_PREFIX)) return { ok: false, resolved, reason: `越界根 ${resolved}` };
  for (const f of FORBIDDEN_ROOTS) if (resolved === f || resolved.startsWith(f + "/")) return { ok: false, resolved, reason: `禁写根 ${f}` };
  // realpath 链：解析最深现存祖先，符号链接把根解析出前缀即越界（拒绝时零文件创建）
  let anc = resolved;
  for (;;) {
    try { await access(anc); break; } catch {
      const parent = path.dirname(anc);
      if (parent === anc) break;
      anc = parent;
    }
  }
  try {
    const realAnc = await realpath(anc);
    const realFull = path.join(realAnc, resolved.slice(anc.length));
    if (!realFull.startsWith(TEMP_ROOT_PREFIX)) return { ok: false, resolved, reason: `符号链接越界 ${resolved} → ${realFull}` };
    for (const f of FORBIDDEN_ROOTS) if (realFull === f || realFull.startsWith(f + "/")) return { ok: false, resolved, reason: `符号链接落入禁写根 ${realFull}` };
  } catch (e) {
    return { ok: false, resolved, reason: "realpath 解析失败: " + (e.code || e.message) };
  }
  return { ok: true, resolved, reason: "" };
}

async function guardTempRoot(raw) {
  const r = await checkTempRoot(raw);
  if (!r.ok) {
    console.error(`temp-root rejected: ${r.reason}（temp-root 必须解析到 ${TEMP_ROOT_PREFIX}* 之下）`);
    process.exit(1);
  }
  return r.resolved;
}

function parseArgs(argv) {
  const out = { selfTest: false, fixtures: null, tempRoot: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test") out.selfTest = true;
    else if (a === "--fixtures") { out.fixtures = argv[++i]; if (!out.fixtures) usageExit("--fixtures 缺值"); }
    else if (a === "--temp-root") { out.tempRoot = argv[++i]; if (!out.tempRoot) usageExit("--temp-root 缺值"); }
    else usageExit(`未知参数 ${a}`);
  }
  return out;
}

// $RUN 占位替换（仅测试 adapter；生产路径无占位符）
function subst(value, runDir) {
  if (typeof value === "string") return value.split("$RUN").join(runDir);
  if (Array.isArray(value)) return value.map((v) => subst(v, runDir));
  if (value && typeof value === "object") {
    const o = {};
    for (const k of Object.keys(value)) o[k] = subst(value[k], runDir);
    return o;
  }
  return value;
}

function deepPatch(base, over) {
  if (over === "__DELETE__") return undefined;
  const out = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v === "__DELETE__") delete out[k];
    else if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = deepPatch(out[k], v);
    else out[k] = v;
  }
  return out;
}

function getPath(obj, p) {
  const parts = p.replace(/^\$\./, "").split(".");
  let cur = obj;
  for (const seg of parts) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function canonicalEq(a, b) {
  try { return canonicalJSON(a) === canonicalJSON(b); } catch { return false; }
}

function evalAssertion(result, a) {
  const v = getPath(result, a.path);
  switch (a.op) {
    case "eq": return v !== undefined && canonicalEq(v, a.value);
    case "ne": return !canonicalEq(v, a.value);
    case "exists": return v !== undefined;
    case "absent": return v === undefined;
    case "lt": return typeof v === "number" && typeof a.value === "number" && v < a.value;
    case "lte": return typeof v === "number" && typeof a.value === "number" && v <= a.value;
    case "hash_eq": {
      const target = getPath(result, a.value.of);
      if (target === undefined) return false;
      try { return sha256hex(canonicalJSON(target)) === a.value.hash; } catch { return false; }
    }
    default: return false;
  }
}

function hasNonBmp(s) {
  for (const ch of String(s)) { if (ch.codePointAt(0) > 0xffff) return true; }
  return false;
}
function floatFree(o) {
  if (typeof o === "number") return Number.isInteger(o);
  if (Array.isArray(o)) return o.every(floatFree);
  if (o && typeof o === "object") return Object.values(o).every(floatFree);
  return true;
}

function recomputeSelfHash(env) {
  const copy = structuredClone(env);
  delete copy.envelope_self_hash;
  if (Array.isArray(copy.operation_log) && copy.operation_log.length > 0) {
    const last = copy.operation_log[copy.operation_log.length - 1];
    if (last && typeof last === "object") delete last.hash_after;
  }
  const h = sha256hex(canonicalJSON(copy));
  env.envelope_self_hash = h;
  if (Array.isArray(env.operation_log) && env.operation_log.length > 0) {
    const last = env.operation_log[env.operation_log.length - 1];
    if (last && typeof last === "object") last.hash_after = h;
  }
  return h;
}

async function applyTamper(envPath, kind) {
  if (kind === "corrupt_json") { await writeFile(envPath, "{ broken json", "utf-8"); return; }
  if (kind === "make_unreadable") { await rm(envPath, { force: true }); await mkdir(envPath, { recursive: true }); return; }
  const raw = await readFile(envPath, "utf-8");
  const env = JSON.parse(raw);
  const write = async (e) => writeFile(envPath, JSON.stringify(e, null, 1) + "\n", "utf-8");
  if (kind === "flip_envelope_self_hash") { env.envelope_self_hash = "f".repeat(64); await write(env); return; }
  if (kind === "drop_envelope_key") { delete env.clock_floor; env.envelope_self_hash = recomputeSelfHash(env); await write(env); return; }
  if (kind === "break_log_chain") { env.operation_log[env.operation_log.length - 1].revision_after -= 1; env.envelope_self_hash = recomputeSelfHash(env); await write(env); return; }
  if (kind === "tamper_policy_snapshot") {
    const first = Object.keys(env.mandates)[0];
    env.mandates[first].policy_snapshot.policy_object.scope.project_ids = ["evil-project"];
    env.envelope_self_hash = recomputeSelfHash(env); await write(env); return;
  }
  if (kind === "tamper_captured_at") {
    const first = Object.keys(env.mandates)[0];
    env.mandates[first].policy_snapshot.captured_at = "not-a-time";
    env.envelope_self_hash = recomputeSelfHash(env); await write(env); return;
  }
  // R2/W-05：非法日历 captured_at（格式合法但 2026-02-30）——装载期严格解析负例
  if (kind === "tamper_captured_at_calendar") {
    const first = Object.keys(env.mandates)[0];
    env.mandates[first].policy_snapshot.captured_at = "2026-02-30T00:00:00Z";
    env.envelope_self_hash = recomputeSelfHash(env); await write(env); return;
  }
  // R3/T21：信封内浮点载荷（undoRecipe.steps=[0.6]）——装载期 canonical 失败=RunStoreError exitCode=3
  if (kind === "float_in_envelope") {
    const first = Object.keys(env.mandates)[0];
    env.mandates[first].mandate.effect_undo_recipe = { steps: [0.6], scope: "/tmp/rt1b-executor-" };
    const writeRaw = async (e) => writeFile(envPath, JSON.stringify(e, null, 1) + "\n", "utf-8");
    await writeRaw(env);
    return;
  }
  if (kind === "drop_policy_snapshot") {
    const first = Object.keys(env.mandates)[0];
    delete env.mandates[first].policy_snapshot;
    env.envelope_self_hash = recomputeSelfHash(env); await write(env); return;
  }
  // T8/T9 返工新增损坏族
  if (kind === "null_envelope") { await writeFile(envPath, "null\n", "utf-8"); return; }
  if (kind === "log_null_entry") { env.operation_log = [null]; env.envelope_revision = 1; recomputeSelfHash(env); await write(env); return; }
  if (kind === "revision_gap") {
    const first = env.operation_log[0];
    const gapEntry = { operationId: "op-gap", revision_before: 5, revision_after: 6, hash_before: first.hash_after, hash_after: GENESIS_PARENT_HASH };
    env.operation_log = [first, gapEntry];
    env.envelope_revision = 6;
    recomputeSelfHash(env);
    await write(env); return;
  }
  throw new Error("unknown tamper " + kind);
}

// 模拟将来 queue/effect 调用方的预检探针：只委托同一 evaluateMandate（Exit 覆盖面·无第二套判定）
async function queuePrecheckProbe(inputs) {
  const r = await evaluateMandate(inputs);
  return { decision: r.decision, allowed: r.decision === "allow", auto_queue: r.decision === "allow" };
}

async function runFixture(fixture, runDir, defaults) {
  const { setup, action } = fixture.input;
  const result = { steps: {} };
  const failures = [];
  let mandateStoreMod = null;
  const envRel = setup.store && setup.store.envelope;
  const envPath = envRel ? path.join(runDir, envRel) : null;
  const clockOf = (ms) => () => ms;
  const openStore = async (clockNow) => {
    mandateStoreMod = mandateStoreMod || await import(pathToFileURLAbs(path.join(SCRIPT_DIR, "run-mandate.mjs")));
    return mandateStoreMod.createMandateStore({ envelopePath: envPath, clock: clockOf(clockNow ?? setup.store.clockNow) });
  };
  const resolvePolicyRef = (ref) => {
    if (ref && typeof ref === "object") return ref;
    if (typeof ref === "string" && ref !== "default") {
      const alt = setup.altPolicies && setup.altPolicies[ref];
      if (!alt) throw new Error("unknown policy ref " + ref);
      return alt;
    }
    return defaults.defaultPolicy;
  };
  const policyForMandate = (mandate) => {
    const h = mandate.policy_hash;
    if (h === computePolicyHash(defaults.defaultPolicy)) return defaults.defaultPolicy;
    for (const alt of Object.values(setup.altPolicies ?? {})) if (computePolicyHash(alt) === h) return alt;
    return defaults.defaultPolicy;
  };
  const baseMandateOf = (refOrObj) => {
    if (typeof refOrObj === "string") return setup.altMandates[refOrObj];
    return deepPatch(setup.mandate, refOrObj ?? {});
  };

  // 材料化真实文件与符号链接（真实 realpath/链接检查的证据面）
  for (const f of setup.files ?? []) {
    const p = path.join(runDir, f.path);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, f.content, "utf-8");
  }
  for (const s of setup.symlinks ?? []) {
    const lp = path.join(runDir, s.link);
    await mkdir(path.dirname(lp), { recursive: true });
    await symlink(s.target, lp);
  }

  // setup.store 播种（测试 adapter 经 createMandateStore 工厂构造 mandate 存储）
  if (setup.store) {
    let store = await openStore();
    for (const entry of setup.store.create ?? []) {
      let mandate = entry.mandate;
      let mandateId;
      if (typeof mandate === "string") {
        if (setup.altMandates && setup.altMandates[mandate]) { mandate = setup.altMandates[mandate]; mandateId = mandate.mandate_id; }
        else { mandateId = mandate; mandate = null; } // 引用已建 mandate：只续作 revoke
      } else mandateId = mandate.mandate_id;
      if (mandate) await store.createMandate({ mandate: subst(mandate, runDir), policy: policyForMandate(mandate), operationId: entry.operationId });
      if (entry.revoke) {
        const rev = entry.revoke;
        await store.revokeMandate({ mandateId, stopEpoch: rev.stopEpoch, reason: rev.reason, expectedRevision: rev.expectedRevision ?? (await store.readEnvelope()).envelope_revision, operationId: rev.operationId });
      }
    }
  }

  let primaryOutcome = null;
  let primaryDelta = 0;
  // 破坏注入基线：播种后快照 pristine 信封文本，tamper 步骤先还原再篡改（每变体独立作用于干净基线）
  let pristineText = null;
  if (setup.store && envPath) { try { pristineText = await readFile(envPath, "utf-8"); } catch { pristineText = null; } }

  // R3/T25④：step 键闭集白名单——未知 step 键=fixture FAIL（防台架语义静默扩面）
  const STEP_KEYS = new Set(["name", "run", "patch", "mandateId", "rawArg", "clockNow", "tamper", "revokedVia", "extraArgs", "stateRef", "preRevoke", "mandate", "policy", "operationId", "expectedRevision", "stopEpoch", "reason", "injectFloatIntoPolicy"]);
  for (const step of action.steps ?? []) {
    const record = {};
    result.steps[step.name] = record;
    const unknownStepKeys = Object.keys(step).filter((k) => !STEP_KEYS.has(k));
    if (unknownStepKeys.length > 0) {
      record.error = { name: "HarnessClosedSet", code: "unknown_step_key:" + unknownStepKeys.join(","), exitCode: null, stage: "step", valid_shape: false };
      if (step.name === action.primary) primaryOutcome = { kind: "error", record };
      continue;
    }
    try {
      if (step.run === "evaluate" || step.run === "precheck_probe") {
        const mand = step.mandateId ? null : baseMandateOf(step.patch && step.patch.mandate);
        let context = deepPatch(setup.context ?? {}, (step.patch && step.patch.context) ?? {});
        if (step.mandateId && step.patch && step.patch.context) context = deepPatch(setup.context ?? {}, step.patch.context);
        const policyObj = typeof context.policy === "string" ? resolvePolicyRef(context.policy) : context.policy;
        if (policyObj === undefined) { const c = { ...context }; delete c.policy; context = c; }
        else context = { ...context, policy: policyObj };
        // R2/W-03：浮点 policy 注入（台架以 6/10 运行时构造，fixture 输入保持无浮点）
        if (step.injectFloatIntoPolicy && context.policy && typeof context.policy === "object") {
          context = { ...context, policy: { ...context.policy, risk_tags: { ...context.policy.risk_tags, unknown: 6 / 10 } } };
        }
        const inputs = {
          mandate: step.mandateId ? null : subst(mand, runDir),
          queueItem: subst(deepPatch(setup.queueItem ?? {}, (step.patch && step.patch.queueItem) ?? {}), runDir),
          effect: subst(deepPatch(setup.effect ?? {}, (step.patch && step.patch.effect) ?? {}), runDir),
          context: subst(context, runDir),
        };
        if (step.mandateId) {
          const store = await openStore(step.clockNow);
          const projected = await store.projectEffectiveMandate(step.mandateId);
          inputs.mandate = subst(projected.mandate, runDir);
          record.projected_revoked = projected.revokedEffective;
        }
        result.policy_input = policyObj ?? null;
        if (step.run === "precheck_probe") {
          const before = __probeState.evaluateMandateCalls;
          const pr = await queuePrecheckProbe(inputs);
          record.decision = pr.decision;
          record.allowed = pr.allowed;
          record.auto_queue = pr.auto_queue;
          record.evaluate_call_delta = __probeState.evaluateMandateCalls - before;
        } else {
          const before = __probeState.evaluateMandateCalls;
          const r = await (step.rawArg ? evaluateMandate({ ...inputs, extra: "boom" }) : evaluateMandate(inputs));
          record.decision = r.decision;
          record.reasons = r.reasons;
          record.riskTags = r.riskTags;
          record.policyHash = r.policyHash;
          record.keys = Object.keys(r).sort().join(",");
          record.auto_queue = r.decision === "allow";
          record.real_effect_performed = false;
          record.conditions = __probeState.lastConditions ? { ...__probeState.lastConditions } : null;
          record.evaluate_call_delta = __probeState.evaluateMandateCalls - before;
        }
        if (step.name === action.primary) primaryOutcome = { kind: "evaluate", record };
      } else if (step.run === "verify" || step.run === "revoke" || step.run === "create") {
        if (step.tamper) {
          if (pristineText !== null) await writeFile(envPath, pristineText, "utf-8");
          await applyTamper(envPath, step.tamper);
        }
        let store = await openStore(step.clockNow);
        if (step.revokedVia) {
          const rev = step.revokedVia;
          const envNow = (await store.readEnvelope()).envelope_revision;
          await store.revokeMandate({ mandateId: step.mandateId, stopEpoch: rev.stopEpoch, reason: rev.reason, expectedRevision: envNow, operationId: rev.operationId });
          store = await openStore(step.clockNow);
        }
        if (step.run === "verify") {
          const before = __probeState.validityCoreCalls;
          let r;
          const args = { mandateId: step.mandateId, expectedRevision: step.expectedRevision, operationId: step.operationId, ...(step.extraArgs ?? {}) };
          try { r = await store.verifyMandate(args); }
          catch (e) { record.error = errFields(e); }
          if (!record.error) {
            record.valid = r.valid; record.reasons = r.reasons; record.keys = Object.keys(r).sort().join(",");
          }
          record.core_call_delta = __probeState.validityCoreCalls - before;
        } else if (step.run === "create") {
          const mandateSrc = typeof step.mandate === "string" ? setup.altMandates[step.mandate] : (step.mandate ?? setup.mandate);
          let policyObj = step.policy ? resolvePolicyRef(step.policy) : policyForMandate(mandateSrc);
          if (step.injectFloatIntoPolicy && policyObj && typeof policyObj === "object") {
            policyObj = { ...policyObj, risk_tags: { ...policyObj.risk_tags, unknown: 6 / 10 } };
          }
          let r;
          try { r = await store.createMandate({ mandate: subst(mandateSrc, runDir), policy: policyObj, operationId: step.operationId }); }
          catch (e) { record.error = errFields(e); }
          if (!record.error) { record.revision = r.revision; record.keys = Object.keys(r).sort().join(","); }
        } else {
          const revision_before = (await store.readEnvelope()).envelope_revision;
          let r;
          const args = { mandateId: step.mandateId, stopEpoch: step.stopEpoch, reason: step.reason, expectedRevision: step.expectedRevision, operationId: step.operationId, ...(step.extraArgs ?? {}) };
          try { r = await store.revokeMandate(args); }
          catch (e) { record.error = errFields(e); }
          if (!record.error) {
            record.revision = r.revision; record.status = r.status; record.keys = Object.keys(r).sort().join(",");
            record.delta = r.revision - revision_before;
            record.stop_epoch_used = step.stopEpoch;
          } else { record.delta = 0; record.stop_epoch_used = step.stopEpoch; }
        }
        if (step.name === action.primary) { primaryOutcome = { kind: step.run, record }; primaryDelta = record.delta ?? 0; }
      } else if (step.run === "claimtoken_matrix") {
        const state = (step.stateRef && setup.claimStates[step.stateRef]) || setup.claimStates.base;
        const token = setup.claimToken;
        const fields = Object.keys(token);
        // T13：探针真实化——包装计数真实调用，禁硬编码 "called"
        const calls = { verifyClaimToken: 0, verifyClaimTokenInUse: 0 };
        const vct = (s, t) => { calls.verifyClaimToken += 1; return verifyClaimToken(s, t); };
        const vcti = (s, t, op) => { calls.verifyClaimTokenInUse += 1; return verifyClaimTokenInUse(s, t, op); };
        const positive = !!(vct(state, token) && vcti(state, token, token.operation_id));
        const variants = {};
        for (const f of fields) {
          const t = { ...token, [f]: typeof token[f] === "number" ? token[f] + 1 : token[f] + "-stale" };
          variants[f] = vcti(state, t, token.operation_id) === false;
        }
        // T13：七字段逐一缺失变体（缺 controller_epoch 等）；R2/N-06：缺失拒绝真实计数
        const missingVariants = {};
        for (const f of fields) {
          const t = { ...token };
          delete t[f];
          missingVariants[f] = vcti(state, t, token.operation_id) === false;
        }
        record.fields = fields.length;
        record.positive = positive;
        record.variants = variants;
        record.stale_all_denied = Object.values(variants).every(Boolean);
        record.missing_all_denied = Object.values(missingVariants).every(Boolean);
        record.missing_denied_count = Object.values(missingVariants).filter(Boolean).length;
        record.rt1a_calls = { verifyClaimToken: calls.verifyClaimToken > 0 ? "called:" + calls.verifyClaimToken : "not-called", verifyClaimTokenInUse: calls.verifyClaimTokenInUse > 0 ? "called:" + calls.verifyClaimTokenInUse : "not-called" };
        if (setup.claimStates.stopped) record.token_after_stop = vcti(setup.claimStates.stopped, token, token.operation_id) === false;
        if (step.name === action.primary) primaryOutcome = { kind: "claimtoken", record };
      } else if (step.run === "core_probe") {
        let store = await openStore(step.clockNow);
        if (step.preRevoke) {
          const envNow = (await store.readEnvelope()).envelope_revision;
          await store.revokeMandate({ mandateId: step.mandateId, stopEpoch: 99, reason: "rt1b-core-probe", expectedRevision: envNow, operationId: "op-prerevoke-" + step.name });
          store = await openStore(step.clockNow);
        }
        const env = await store.readEnvelope();
        const wrapper = env.mandates[step.mandateId];
        const before = __probeState.validityCoreCalls;
        const r = await evaluateMandateValidity({ mandateRecord: wrapper, policySnapshot: wrapper.policy_snapshot, now: step.clockNow ?? setup.store.clockNow, clockFloor: env.clock_floor });
        record.valid = r.valid; record.reasons = r.reasons;
        record.keys = Object.keys(r).sort().join(",");
        record.core_reason = (r.reasons && r.reasons[0]) || "";
        record.core_call_delta = __probeState.validityCoreCalls - before;
        if (step.name === action.primary) primaryOutcome = { kind: "core", record };
      } else if (step.run === "recompute_hash") {
        const doc = setup.doc;
        record.node_hash = sha256hex(canonicalJSON(doc));
        record.has_non_bmp = hasNonBmp(JSON.stringify(doc));
        record.float_free = floatFree(doc);
        if (step.name === action.primary) primaryOutcome = { kind: "hash", record };
      } else if (step.run === "deep_copy_probe") {
        // R3/T18：创建边界深拷贝隔离——create 后调用方翻转原对象 revoked:true→false，verify 必须仍 mandate_revoked
        const store = await openStore(step.clockNow);
        const callerMandate = subst(structuredClone(setup.mandate), runDir);
        if (step.mandateId) callerMandate.mandate_id = step.mandateId;
        callerMandate.revoked = true;
        const policyObj = policyForMandate(callerMandate);
        await store.createMandate({ mandate: callerMandate, policy: policyObj, operationId: step.operationId ?? "op-deepcopy" });
        callerMandate.revoked = false; // 调用方后续 mutation：不得污染 live/磁盘态
        const rev = step.expectedRevision ?? (await store.readEnvelope()).envelope_revision;
        const v = await store.verifyMandate({ mandateId: callerMandate.mandate_id, expectedRevision: rev, operationId: (step.operationId ?? "op-deepcopy") + "-check" });
        record.valid = v.valid;
        record.reasons = v.reasons;
        record.keys = Object.keys(v).sort().join(",");
        if (step.name === action.primary) primaryOutcome = { kind: "verify", record };
      } else if (step.run === "store_isolation") {
        const a = await openStore();
        const b = await mandateStoreMod.createMandateStore({ envelopePath: path.join(runDir, "env-043b.json"), clock: clockOf(setup.store.clockNow) });
        const envA = await a.readEnvelope();
        const envB = await b.readEnvelope();
        const vb = await b.verifyMandate({ mandateId: "mand-rt1b-base", expectedRevision: 1, operationId: "op-iso-b" });
        const va = await a.verifyMandate({ mandateId: "mand-rt1b-base", expectedRevision: 1, operationId: "op-iso-a" });
        record.store_a_ids = Object.keys(envA.mandates);
        record.store_b_ids = Object.keys(envB.mandates);
        record.factory_distinct = a !== b;
        record.b_verify_not_found = vb.valid === false && (vb.reasons || []).includes("mandate_not_found");
        record.a_verify_ok = va.valid === true;
        if (step.name === action.primary) primaryOutcome = { kind: "isolation", record };
      } else {
        throw new Error("unknown step run " + step.run);
      }
    } catch (e) {
      record.error = errFields(e);
      if (step.name === action.primary) primaryOutcome = { kind: "error", record };
    }
  }

  if (setup.store && envPath) {
    try {
      const store = await openStore();
      const env = await store.readEnvelope();
      result.envelope_after = {
        envelope_revision: env.envelope_revision,
        log_last: env.operation_log[env.operation_log.length - 1],
      };
    } catch { /* 损坏后读不回为合法终态 */ }
  }
  result.qualified_empty = Object.values(result.steps).every((r) => r.decision === undefined || r.decision !== "allow");
  result.input_hash_match = sha256hex(canonicalJSON(fixture.input)) === fixture.input_hash;

  // 期望对账
  const es = fixture.expected_state;
  let actualExit;
  const po = primaryOutcome;
  if (!po) actualExit = "no_primary";
  else if (po.kind === "evaluate" || po.kind === "precheck_probe") actualExit = po.record.decision === "allow" ? 0 : po.record.decision === "deny" ? 1 : po.record.decision;
  else if (po.kind === "verify") actualExit = po.record.error ? po.record.error.exitCode : (po.record.valid === true ? 0 : 1);
  else if (po.kind === "revoke") actualExit = po.record.error ? po.record.error.exitCode : 0;
  else if (po.kind === "create") actualExit = po.record.error ? po.record.error.exitCode : 0;
  else if (po.kind === "error") actualExit = po.record.error ? po.record.error.exitCode : 3;
  else actualExit = 0;
  const terminalOf = { 0: "passed", 1: "denied", 3: "blocked", manual: "manual", blocked: "blocked", no_primary: "blocked" };
  const actualTerminal = terminalOf[actualExit] ?? "blocked";
  const assertionResults = es.assertions.map((a) => ({ a, ok: evalAssertion(result, a) }));
  const failedAssertions = assertionResults.filter((x) => !x.ok).map((x) => x.a.path);
  // T11/R3-T23：三接口返回形状逐 step 机检——对实际返回键集 r.keys 检查（非重建固定对象）；
  // policyHash 缺失/第五键出现均不得跳过（第五键变异必须 FAIL＋exit≠0）
  const shapeViolations = [];
  for (const [name, r] of Object.entries(result.steps)) {
    if (r.keys !== undefined && r.keys === "decision,policyHash,reasons,riskTags") {
      const shaped = ["allow", "deny", "manual"].includes(r.decision)
        && Array.isArray(r.reasons) && r.reasons.every((x) => typeof x === "string")
        && Array.isArray(r.riskTags) && r.riskTags.every((x) => typeof x === "string")
        && typeof r.policyHash === "string" && HEX64.test(r.policyHash);
      if (!shaped) shapeViolations.push("evaluate:" + name);
    } else if (r.keys !== undefined && r.valid === undefined && r.status === undefined && !r.error && r.decision !== undefined) {
      // 实际返回恰四键以外的 evaluate 形态（如第五键变异）——以实际键集判 FAIL
      shapeViolations.push("evaluate_keys:" + name + ":" + r.keys);
    }
    if (r.valid !== undefined && !r.error) {
      const shaped = r.keys === "reasons,valid" && typeof r.valid === "boolean" && Array.isArray(r.reasons) && r.reasons.every((x) => typeof x === "string");
      if (!shaped) shapeViolations.push("verify:" + name);
    }
    if (r.status !== undefined && !r.error) {
      const shaped = r.keys === "revision,status" && Number.isInteger(r.revision) && r.revision >= 0 && r.status === "revoked";
      if (!shaped) shapeViolations.push("revoke:" + name);
    }
    if (r.error) {
      if (r.error.name === "RunStoreError" && r.error.valid_shape !== true) shapeViolations.push("rse_shape:" + name);
      if (r.error.exitCode === null) shapeViolations.push("bare_error:" + name);
    }
  }
  const ok = canonicalEq(actualExit, fixture.expected_exit) && actualTerminal === es.terminal && primaryDelta === es.revision_delta && failedAssertions.length === 0 && shapeViolations.length === 0;
  return { ok, fixture_id: fixture.fixture_id, actualExit, actualTerminal, delta: primaryDelta, failedAssertions, shapeViolations, result,
    counts: { passed: assertionResults.length - failedAssertions.length, total: assertionResults.length } };
}

// T9：错误面收紧——只有 RunStoreError 携带 exitCode 并过六字段形状校验；裸 Error 不洗成 3
function errFields(e) {
  if (e && e.name === "RunStoreError") {
    return { name: "RunStoreError", code: e.code, exitCode: e.exitCode, stage: e.stage, valid_shape: isRunStoreErrorFields(e) };
  }
  return { name: e && e.name ? e.name : "Error", code: String(e && e.message ? e.message : e).slice(0, 200), exitCode: null, stage: null, valid_shape: false };
}

function pathToFileURLAbs(p) {
  return "file://" + p.replace(/ /g, "%20");
}

// T11：negative 极性必须含 deny/manual/blocked 原子值断言（decision 原子或 valid=false 或 error.exitCode∈{1,3}）
function polarityAssertionOk(fixture) {
  const es = fixture.expected_state;
  const primaryPath = "$.steps." + fixture.input.action.primary;
  if (es.polarity === "negative") {
    return es.assertions.some((a) => a.path.startsWith(primaryPath)
      && ((a.op === "eq" && (a.value === "deny" || a.value === "manual" || a.value === "blocked"))
        || (a.op === "eq" && /\.valid$/.test(a.path) && a.value === false)
        || (a.op === "eq" && /\.error\.exitCode$/.test(a.path) && (a.value === 1 || a.value === 3))));
  }
  return es.assertions.some((a) => a.op === "hash_eq" || /(\.keys|revision|valid|fields|core_call_delta|hash|factory_distinct|_verify_ok|rt1a_calls)/.test(a.path));
}

async function selfTest(args) {
  const fixturesPath = args.fixtures ? path.resolve(args.fixtures) : DEFAULT_FIXTURES;
  const tempRoot = await guardTempRoot(args.tempRoot ?? DEFAULT_TEMP_ROOT);
  let doc;
  try { doc = JSON.parse(await readFile(fixturesPath, "utf-8")); }
  catch (e) { console.error("[fatal] fixtures 装载失败: " + e.message); process.exit(3); }
  if (!Array.isArray(doc.vectors) || doc.schema_version !== "run-authz-fixtures/v1") { console.error("[fatal] fixtures 契约不符"); process.exit(3); }
  // 默认策略快照单源=org-config.default.json#authorization_policy（与 cfg_hash 分源）
  let defaultPolicy;
  let cfgSample = "";
  try {
    const cfgMod = await import(pathToFileURLAbs(path.join(SCRIPT_DIR, "org-config.mjs")));
    let cfgPath = path.join(SCRIPT_DIR, "..", "org-config.default.json");
    try { await readFile(cfgPath, "utf-8"); } catch { cfgPath = path.join(SCRIPT_DIR, "org-config.default.json"); }
    const rawCfg = JSON.parse(await readFile(cfgPath, "utf-8"));
    defaultPolicy = rawCfg.authorization_policy;
    cfgSample = cfgMod.cfgHash(rawCfg);
  } catch (e) { console.error("[fatal] org-config 装载失败: " + e.message); process.exit(3); }

  await mkdir(tempRoot, { recursive: true });
  const runDir = path.join(tempRoot, "rt-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8));
  await mkdir(runDir, { recursive: true });
  const defaults = { defaultPolicy };
  console.log(`run-authz self-test fixtures=${doc.vectors.length} temp-root=${tempRoot} policy_hash=${computePolicyHash(defaultPolicy)} cfg_hash_sample=${cfgSample}`);
  // T4：temp-root 符号链接越界自探针（在 tempRoot 内建指向禁写根的链接，校验器必须拒绝且零副作用）
  // R2/W-04：探针结果纳入 tokens/退出判定（guard 回归时 self-test 必须 exit≠0）
  let guardSymlinkDenied = false;
  const guardLink = path.join(runDir, "guard-link");
  try {
    await symlink("/home/yyx/work/aidevorg", guardLink);
    const probe = await checkTempRoot(guardLink);
    guardSymlinkDenied = probe.ok === false;
    await rm(guardLink, { force: true });
  } catch { guardSymlinkDenied = false; }
  console.log(`temp_root_guard_symlink=${guardSymlinkDenied ? "denied" : "NOT-DENIED"} run_dir=${path.basename(runDir)}`);

  const results = [];
  let runDirCleaned = false;
  try {
    for (const fixture of doc.vectors) results.push(await runFixture(fixture, runDir, defaults));
  } finally {
    // T14：本 runDir finally 清理；R2/N-03：清理成败真实标注（rm 失败不得显示 cleaned）
    try { await rm(runDir, { recursive: true, force: true }); runDirCleaned = true; } catch { runDirCleaned = false; }
  }

  const by = (id) => results.find((r) => r.fixture_id === id);
  const stepRec = (id, step) => { const r = by(id); return r ? r.result.steps[step] : undefined; };
  const allOk = (...ids) => ids.every((i) => { const r = by(i); return r && r.ok; });
  const denied = (id, step) => { const s = stepRec(id, step); return !!s && s.decision === "deny"; };
  const manual = (id, step) => { const s = stepRec(id, step); return !!s && s.decision === "manual"; };

  for (const r of results) {
    const expected = doc.vectors.find((v) => v.fixture_id === r.fixture_id);
    // T11：逐条输出补 decision/valid/status/reasons/riskTags/policyHash（primary step 实值）
    const p = r.result.steps[expected.input.action.primary] ?? {};
    const primaryBits = [
      p.decision !== undefined ? "decision=" + p.decision : "",
      p.valid !== undefined ? "valid=" + p.valid : "",
      p.status !== undefined ? "status=" + p.status : "",
      p.reasons !== undefined ? "reasons=" + JSON.stringify(p.reasons).slice(0, 160) : "",
      p.riskTags !== undefined ? "riskTags=" + p.riskTags.length : "",
      p.policyHash !== undefined ? "policyHash=" + String(p.policyHash).slice(0, 16) : "",
    ].filter(Boolean).join(" ");
    const line = `[${r.ok ? "PASS" : "FAIL"}] ${r.fixture_id} expected_exit=${JSON.stringify(expected.expected_exit)} actual_exit=${JSON.stringify(r.actualExit)} terminal=${r.actualTerminal} revision_delta=${r.delta} assertions=${r.counts.passed}/${r.counts.total} ${primaryBits} evidence=${path.basename(runDir)}${runDirCleaned ? "(cleaned)" : "(cleanup-failed)"}`;
    console.log(line + (r.ok ? "" : " failed_paths=" + JSON.stringify(r.failedAssertions) + (r.shapeViolations && r.shapeViolations.length ? " shape_violations=" + JSON.stringify(r.shapeViolations) : "")));
  }

  const c1 = by("F-A-001");
  const capMatrix = c1 && c1.result.steps.allow && c1.result.steps.allow.conditions
    ? Object.values(c1.result.steps.allow.conditions).filter((v) => v === "pass").length : 0;
  const fa24 = by("F-A-024");
  const tokens = {
    binding_matrix: allOk("F-A-011", "F-A-012", "F-A-013", "F-A-014", "F-A-015", "F-A-016", "F-A-017") ? "PASS" : "FAIL",
    policy_hash: allOk("F-A-013", "F-A-001") ? "PASS" : "FAIL",
    unknown_effect: denied("F-A-006", "unknown_effect") ? "denied" : "NOT-DENIED",
    unknown_tag: denied("F-A-006", "unknown_tag") ? "denied" : "NOT-DENIED",
    unknown_risk_tag: denied("F-A-006", "unknown_tag") ? "denied" : "NOT-DENIED",
    uncheckable_constraint: denied("F-A-041", "uncheckable") ? "denied" : "NOT-DENIED",
    caller_risk_tags: denied("F-A-027", "queue_item_tags") ? "denied" : "NOT-DENIED",
    authz_tags_only: allOk("F-A-028") ? "PASS" : "FAIL",
    single_evaluator: allOk("F-A-037") ? "PASS" : "FAIL",
    shared_validity_core: allOk("F-A-037") ? "PASS" : "FAIL",
    store_isolation: allOk("F-A-043") ? "PASS" : "FAIL",
    revision_delta_mapping: results.every((r) => r.delta === (doc.vectors.find((v) => v.fixture_id === r.fixture_id).expected_state.revision_delta)) ? "PASS" : "FAIL",
    polarity_assertions: doc.vectors.every((v) => polarityAssertionOk(v)) ? "PASS" : "FAIL",
    manual_mapping: results.filter((r) => typeof r.actualExit === "string" && r.actualExit === "manual").every((r) => r.actualTerminal === "manual") && allOk("F-A-018", "F-A-019", "F-A-020", "F-A-021", "F-A-022", "F-A-023", "F-A-024", "F-A-025", "F-A-026") ? "PASS" : "FAIL",
    capability_matrix: capMatrix === 8 ? "8/8" : String(capMatrix) + "/8",
    qualified_empty: !!(fa24 && fa24.result.qualified_empty) ? "PASS" : "FAIL",
    HOST_AGENT: manual("F-A-025", "host_agent") ? "manual" : "NOT-MANUAL",
    EXTERNAL: manual("F-A-026", "external") ? "manual" : "NOT-MANUAL",
    auto_queue: (() => { const a = stepRec("F-A-025", "host_agent"); const b = stepRec("F-A-026", "external"); return a && b && a.auto_queue === false && b.auto_queue === false ? "false" : "true"; })(),
    verify_shape: (() => { const s = stepRec("F-A-029", "verify_ok"); return s && s.keys === "reasons,valid" ? "PASS" : "FAIL"; })(),
    revoke_shape: (() => { const s = stepRec("F-A-032", "revoke_ok"); return s && s.keys === "revision,status" ? "PASS" : "FAIL"; })(),
    revoke_replay_delta: (() => { const s = stepRec("F-A-033", "replay"); return s && s.delta === 0 ? "0" : "nonzero"; })(),
    stale_revision: (() => { const s = stepRec("F-A-034", "stale_expected_revision"); return s && s.error && s.error.exitCode === 1 ? "denied" : "NOT-DENIED"; })(),
    wrong_stop_epoch: (() => { const s = stepRec("F-A-034", "wrong_stop_epoch"); return s && s.error && s.error.exitCode === 1 ? "denied" : "NOT-DENIED"; })(),
    revoked_token: (() => { const s = stepRec("F-A-035", "old_token_check"); return s && s.token_after_stop === true ? "denied" : "NOT-DENIED"; })(),
    claim_token_fields: (() => { const s = stepRec("F-A-036", "matrix"); return s && s.fields === 7 ? "7/7" : "?/?"; })(),
    claim_token_stale: (() => { const s = stepRec("F-A-036", "matrix"); return s && s.stale_all_denied ? "7/7" : "?/?"; })(),
    envelope_self_hash: (() => { const s = stepRec("F-A-038", "self_hash_tampered"); return s && s.error && s.error.exitCode === 3 ? "PASS" : "FAIL"; })(),
    operation_log_chain: (() => { const s = stepRec("F-A-038", "log_chain_broken"); return s && s.error && s.error.exitCode === 3 ? "PASS" : "FAIL"; })(),
    clock_injection: (() => { const s = stepRec("F-A-030", "clock_rollback"); return s && s.valid === false && (s.reasons || [])[0] === "clock_rollback" ? "PASS" : "FAIL"; })(),
    business_reject_exit_one: (() => { const f = by("F-A-034"); if (!f) return "FAIL"; const names = ["stale_expected_revision", "wrong_stop_epoch", "missing_mandate", "payload_conflict"]; return names.every((n) => { const s = f.result.steps[n]; return s && s.error && s.error.exitCode === 1; }) ? "PASS" : "FAIL"; })(),
    // ---- 返工 R1 新负例族 token（R2/N-06：claim_token_missing 输出真实计数）----
    claim_token_missing: (() => { const s = stepRec("F-A-036", "matrix"); return s && Number.isInteger(s.missing_denied_count) ? `${s.missing_denied_count}/7` : "?/7"; })(),
    temp_root_guard: guardSymlinkDenied ? "PASS" : "FAIL",
    effects_null_entry_denied: denied("F-A-036", "effects_null_entry") ? "denied" : "NOT-DENIED",
    env_null_denied: (() => { const s = stepRec("F-A-020", "env_null"); return s && s.decision === "deny" && (s.reasons || [])[0] === "invalid_effect_evidence:env" ? "denied" : "NOT-DENIED"; })(),
    policy_float_converged: (() => { const s = stepRec("F-A-040", "policy_float"); return s && s.decision === "deny" && (s.reasons || []).includes("no_policy_resolvable") && s.policyHash === ZERO_HASH ? "PASS" : "FAIL"; })(),
    create_float_policy_rejected: (() => { const s = stepRec("F-A-033", "create_float_policy"); return s && s.error && s.error.exitCode === 1 && s.error.name === "RunStoreError" ? "PASS" : "FAIL"; })(),
    captured_at_calendar_load: (() => { const s = stepRec("F-A-039", "captured_at_calendar"); return s && s.error && s.error.exitCode === 3 && s.error.code === "policy_snapshot_invalid" ? "PASS" : "FAIL"; })(),
    create_with_revoke_opid_rejected: (() => { const s = stepRec("F-A-033", "create_with_revoke_opid"); return s && s.error && s.error.exitCode === 1 ? "PASS" : "FAIL"; })(),
    // ---- 返工 R3 新负例族 token ----
    deep_copy_isolation: (() => { const s = stepRec("F-A-010", "deep_copy_isolation"); return s && s.valid === false && (s.reasons || [])[0] === "mandate_revoked" ? "PASS" : "FAIL"; })(),
    argv_schema_malformed_manual: (() => { const a = stepRec("F-A-018", "schema_required_not_array"); const b = stepRec("F-A-018", "schema_type_not_json"); return a && b && a.decision === "manual" && b.decision === "manual" ? "manual" : "NOT-MANUAL"; })(),
    empty_schema_no_args: (() => { const s = stepRec("F-A-018", "empty_schema_no_args"); return s && s.decision === "allow" ? "PASS" : "FAIL"; })(),
    dod_confirmer_invalid: (() => { const a = stepRec("F-A-016", "dod_confirmer_missing"); const b = stepRec("F-A-016", "dod_confirmer_empty"); return a && b && a.decision === "deny" && b.decision === "deny" ? "denied" : "NOT-DENIED"; })(),
    float_envelope_exit_three: (() => { const s = stepRec("F-A-038", "float_in_envelope"); return s && s.error && s.error.exitCode === 3 && s.error.name === "RunStoreError" ? "PASS" : "FAIL"; })(),
    time_offset_range: (() => { const a = stepRec("F-A-007", "offset_hh_out_of_range"); const b = stepRec("F-A-007", "offset_mm_out_of_range"); return a && b && a.decision === "deny" && b.decision === "deny" ? "denied" : "NOT-DENIED"; })(),
    frac_seconds: (() => { const a = stepRec("F-A-008", "frac_expired"); const b = stepRec("F-A-008", "frac_boundary_exact"); return a && b && a.decision === "deny" && b.decision === "allow" ? "PASS" : "FAIL"; })(),
    argv_schema_top_closed: (() => { const a = stepRec("F-A-018", "schema_top_type_invalid"); const b = stepRec("F-A-018", "schema_top_type_array"); const c = stepRec("F-A-018", "prop_object_null_value"); return a && b && c && a.decision === "manual" && b.decision === "manual" && c.decision === "manual" ? "manual" : "NOT-MANUAL"; })(),
    hard_unknown_kind: denied("F-A-006", "double_allowlist_unknown") ? "denied" : "NOT-DENIED",
    host_agent_hard_manual: manual("F-A-025", "relaxed_policy") ? "manual" : "NOT-MANUAL",
    policy_realpath_boundary: denied("F-A-004", "policy_root_escape") ? "denied" : "NOT-DENIED",
    evidence_closed_set: (() => { const a = stepRec("F-A-020", "env_number"); const b = stepRec("F-A-015", "effect_undo_recipe_missing"); return a && b && a.decision === "deny" && b.decision === "deny" ? "denied" : "NOT-DENIED"; })(),
    operation_idempotency: (() => { const f = by("F-A-033"); if (!f) return "FAIL"; const rep = f.result.steps.create_replay, dup = f.result.steps.create_replay_conflict, mix = f.result.steps.revoke_with_create_opid; return rep && rep.revision === 1 && dup && dup.error && dup.error.exitCode === 1 && mix && mix.error && mix.error.exitCode === 1 ? "PASS" : "FAIL"; })(),
    revision_adjacency: (() => { const s = stepRec("F-A-038", "revision_gap"); return s && s.error && s.error.exitCode === 3 && s.error.code === "operation_log_broken" ? "PASS" : "FAIL"; })(),
    malformed_envelope: (() => { const a = stepRec("F-A-038", "null_envelope"); const b = stepRec("F-A-038", "log_null_entry"); return a && b && a.error && a.error.exitCode === 3 && b.error && b.error.exitCode === 3 ? "PASS" : "FAIL"; })(),
    malformed_state_denied: denied("F-A-036", "malformed_state") ? "denied" : "NOT-DENIED",
    calendar_strict: denied("F-A-007", "calendar_invalid") ? "denied" : "NOT-DENIED",
    policy_hash_real_return: (() => { const s = stepRec("F-A-040", "unknown_context_key"); const z = stepRec("F-A-040", "policy_unresolvable"); return s && s.policyHash && s.policyHash !== ZERO_HASH && z && s.policyHash !== z.policyHash ? "PASS" : "FAIL"; })(),
    preflight_marker: denied("F-A-041", "preflight_constraint_marker") ? "denied" : "NOT-DENIED",
    io_corrupt_exit_three: (() => { const s = stepRec("F-A-030", "io_corrupt"); return s && s.error && s.error.exitCode === 3 ? "PASS" : "FAIL"; })(),
    unknown_argument_rejected: (() => { const v = stepRec("F-A-031", "unknown_argument"); const r = stepRec("F-A-034", "unknown_argument"); return v && v.valid === false && r && r.error && r.error.exitCode === 1 ? "PASS" : "FAIL"; })(),
  };
  const failed = results.filter((r) => !r.ok).length;
  const counts = {
    deny: results.filter((r) => r.actualExit === 1).length,
    manual: results.filter((r) => r.actualExit === "manual").length,
    blocked: results.filter((r) => r.actualExit === 3 || r.actualExit === "blocked").length,
    io3: results.filter((r) => r.actualExit === 3).length,
    passed: results.filter((r) => r.actualExit === 0).length,
  };
  console.log(`matrix: binding_matrix=${tokens.binding_matrix} policy_hash=${tokens.policy_hash} unknown_effect=${tokens.unknown_effect} unknown_tag=${tokens.unknown_tag} uncheckable_constraint=${tokens.uncheckable_constraint} caller_risk_tags=${tokens.caller_risk_tags} unknown_risk_tag=${tokens.unknown_risk_tag} authz_tags_only=${tokens.authz_tags_only}`);
  console.log(`core: single_evaluator=${tokens.single_evaluator} shared_validity_core=${tokens.shared_validity_core} store_isolation=${tokens.store_isolation}`);
  console.log(`mapping: revision_delta_mapping=${tokens.revision_delta_mapping} polarity_assertions=${tokens.polarity_assertions} manual_mapping=${tokens.manual_mapping}`);
  console.log(`capability: capability_matrix=${tokens.capability_matrix} qualified_empty=${tokens.qualified_empty} HOST_AGENT=${tokens.HOST_AGENT} EXTERNAL=${tokens.EXTERNAL} auto_queue=${tokens.auto_queue}`);
  console.log(`mandate: verify_shape=${tokens.verify_shape} revoke_shape=${tokens.revoke_shape} revoke_replay_delta=${tokens.revoke_replay_delta} stale_revision=${tokens.stale_revision} wrong_stop_epoch=${tokens.wrong_stop_epoch} revoked_token=${tokens.revoked_token} envelope_self_hash=${tokens.envelope_self_hash} operation_log_chain=${tokens.operation_log_chain} clock_injection=${tokens.clock_injection} business_reject_exit_one=${tokens.business_reject_exit_one}`);
  console.log(`claim: claim_token_fields=${tokens.claim_token_fields} claim_token_stale=${tokens.claim_token_stale} claim_token_missing=${tokens.claim_token_missing}`);
  console.log(`rework: hard_unknown_kind=${tokens.hard_unknown_kind} host_agent_hard_manual=${tokens.host_agent_hard_manual} policy_realpath_boundary=${tokens.policy_realpath_boundary} evidence_closed_set=${tokens.evidence_closed_set} operation_idempotency=${tokens.operation_idempotency} revision_adjacency=${tokens.revision_adjacency} malformed_envelope=${tokens.malformed_envelope} malformed_state_denied=${tokens.malformed_state_denied} calendar_strict=${tokens.calendar_strict} policy_hash_real_return=${tokens.policy_hash_real_return} preflight_marker=${tokens.preflight_marker} io_corrupt_exit_three=${tokens.io_corrupt_exit_three} unknown_argument_rejected=${tokens.unknown_argument_rejected}`);
  console.log(`rework2: temp_root_guard=${tokens.temp_root_guard} effects_null_entry_denied=${tokens.effects_null_entry_denied} env_null_denied=${tokens.env_null_denied} policy_float_converged=${tokens.policy_float_converged} create_float_policy_rejected=${tokens.create_float_policy_rejected} captured_at_calendar_load=${tokens.captured_at_calendar_load} create_with_revoke_opid_rejected=${tokens.create_with_revoke_opid_rejected}`);
  console.log(`rework3: deep_copy_isolation=${tokens.deep_copy_isolation} argv_schema_malformed_manual=${tokens.argv_schema_malformed_manual} empty_schema_no_args=${tokens.empty_schema_no_args} dod_confirmer_invalid=${tokens.dod_confirmer_invalid} float_envelope_exit_three=${tokens.float_envelope_exit_three} time_offset_range=${tokens.time_offset_range} frac_seconds=${tokens.frac_seconds}`);
  console.log(`rework4: argv_schema_top_closed=${tokens.argv_schema_top_closed}`);
  console.log(`totals: fixtures=${results.length} passed=${results.length - failed} failed=${failed} deny=${counts.deny} manual=${counts.manual} blocked=${counts.blocked} io3=${counts.io3} passed_exit_zero=${counts.passed}`);
  // T11：token 面 FAIL 同样不得 exit 0（失败汇总纳入退出判定）；R3/T25③：异常计数形态 "?/7" 一并纳入
  const tokenBad = Object.values(tokens).some((v) => typeof v === "string" && (v.includes("FAIL") || v.includes("NOT-") || /^\?\//.test(v) || v === "nonzero" || v === "true" || v === "PASS-FAIL"));
  process.exit(failed === 0 && !tokenBad ? 0 : 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.selfTest) usageExit("无 --self-test 不执行 fixture 或写操作");
  // 非阻塞调用：顶层 await 会挂起本模块求值，与 run-mandate 对本模块的静态 import 互等死锁。
  selfTest(args).catch((e) => { console.error("[fatal] self-test 台架故障: " + (e && e.stack ? e.stack : e)); process.exit(3); });
}
