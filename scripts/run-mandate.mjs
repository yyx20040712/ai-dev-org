// run-mandate.mjs — RT1B mandate 生命周期与测试隔离单 JSON 信封（§3.11-A 主控已裁定）。
// 冻结契约：createMandateStore({ envelopePath, clock? }) 工厂（clock 仅测试 adapter 可注入，生产 Date.now）；
//   实例方法 verifyMandate({mandateId,expectedRevision,operationId})->{valid,reasons}
//   实例方法 revokeMandate({mandateId,stopEpoch,reason,expectedRevision,operationId})->{revision,status}
// 信封闭集（顶层恰五键）：envelope_revision/clock_floor/operation_log/mandates/envelope_self_hash；
//   包装恰五键 {mandate,policy_snapshot,status,revoked,envelope_revision}；
//   envelope_self_hash=剔除自身后重算（末条 operation_log.hash_after 为回嵌值，同 run-state
//   producer_operation.hash 口径不计入输入）；首条 hash_before=64 个 '0'。
// clock_floor 初值=首次创建时 now，每次成功写入后推进为 max(clock_floor,now)；now<clock_floor 即 deny。
// verify 业务拒绝=结构化 {valid:false,reasons}；revoke 业务拒绝=RunStoreError exitCode=1；
// IO/损坏/断链=RunStoreError exitCode=3 fail closed，不回落 legacy。禁止模块级 store 单例。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJSON, sha256hex, HEX64, GENESIS_PARENT_HASH, RunStoreError, atomicWrite } from "./run-state.mjs";
import { evaluateMandateValidity, parseTimeWithTz } from "./run-authz.mjs";

const ENVELOPE_KEYS = ["clock_floor", "envelope_revision", "envelope_self_hash", "mandates", "operation_log"];
const WRAPPER_KEYS = ["envelope_revision", "mandate", "policy_snapshot", "revoked", "status"];
const SNAPSHOT_KEYS = ["captured_at", "policy_hash", "policy_object"];
const MANDATE_FIELDS = ["mandate_id", "project_id", "queue_scope", "path_allowlist", "effect_allowlist", "taskbook_hash", "dod_hash", "route_hash", "dispatch_plan_hash", "policy_hash", "reversible_actions", "prohibitions", "valid_from", "valid_until", "revoked", "effect_undo_recipe", "verify", "independent_dod_evidence"];
// R3/T25②：TIMEZONE_RE 死常量已删——严格解析统一走 run-authz parseTimeWithTz

const rse = (code, exitCode, stage, operationId, message) => new RunStoreError({ code, exitCode, stage, operationId, message });

function computeEnvelopeSelfHash(env) {
  const copy = structuredClone(env);
  delete copy.envelope_self_hash;
  if (Array.isArray(copy.operation_log) && copy.operation_log.length > 0) {
    const last = copy.operation_log[copy.operation_log.length - 1];
    if (last && typeof last === "object") delete last.hash_after;
  }
  return sha256hex(safeCanonicalJSON(copy, "envelope_unserializable", "hash", null, "信封含不可 canonical 载荷（浮点等）"));
}

// R3/T21：canonical 序列化统一收敛——含浮点等不可序列化载荷=RunStoreError exitCode=3（禁裸 TypeError/exitCode=null）
function safeCanonicalJSON(value, code, stage, operationId, message) {
  try { return canonicalJSON(value); }
  catch { throw rse(code, 3, stage, operationId, message); }
}

// R3/T21 辅助：剔 self hash 与末条回嵌字段的哈希输入构造（供 safeCanonicalJSON 消费）
function stripSelfHashForHash(env) {
  const copy = structuredClone(env);
  delete copy.envelope_self_hash;
  if (Array.isArray(copy.operation_log) && copy.operation_log.length > 0) {
    const last = copy.operation_log[copy.operation_log.length - 1];
    if (last && typeof last === "object") delete last.hash_after;
  }
  return copy;
}

function validateEnvelope(env, stage) {
  const keys = Object.keys(env).sort();
  if (keys.join(",") !== ENVELOPE_KEYS.join(",")) throw rse("envelope_structure_invalid", 3, stage, null, "信封闭集不符：" + keys.join(","));
  if (!Number.isInteger(env.envelope_revision) || env.envelope_revision < 0) throw rse("envelope_structure_invalid", 3, stage, null, "envelope_revision 非法");
  if (!Number.isInteger(env.clock_floor) || env.clock_floor < 0) throw rse("envelope_structure_invalid", 3, stage, null, "clock_floor 非法");
  if (!Array.isArray(env.operation_log)) throw rse("envelope_structure_invalid", 3, stage, null, "operation_log 非数组");
  if (sha256hex(safeCanonicalJSON(stripSelfHashForHash(env), "envelope_unserializable", stage, null, "信封含不可 canonical 载荷（浮点等）")) !== env.envelope_self_hash) throw rse("envelope_self_hash_mismatch", 3, stage, null, "envelope_self_hash 重算不符");
  const log = env.operation_log;
  for (const e of log) {
    if (!e || typeof e !== "object") throw rse("operation_log_broken", 3, stage, null, "log 条目非对象");
    if (Object.keys(e).sort().join(",") !== ["hash_after", "hash_before", "operationId", "revision_after", "revision_before"].join(",")) {
      throw rse("operation_log_broken", 3, stage, e.operationId, "log 条目非恰五键");
    }
    if (!HEX64.test(String(e.hash_before)) || !HEX64.test(String(e.hash_after))) throw rse("operation_log_broken", 3, stage, e.operationId, "log hash 非 hex64");
  }
  if (log.length > 0) {
    if (log[0].hash_before !== GENESIS_PARENT_HASH) throw rse("operation_log_broken", 3, stage, log[0].operationId, "首条 hash_before 非 64 零");
    if (log[0].revision_before !== 0) throw rse("operation_log_broken", 3, stage, log[0].operationId, "首条 revision_before 非 0");
    for (let i = 0; i < log.length; i++) {
      if (log[i].revision_after !== log[i].revision_before + 1) throw rse("operation_log_broken", 3, stage, log[i].operationId, "revision 链断");
      if (i > 0 && log[i].hash_before !== log[i - 1].hash_after) throw rse("operation_log_broken", 3, stage, log[i].operationId, "hash 链断");
      // T8：相邻条 revision_before 必须等于前条 revision_after（缺口拒绝）
      if (i > 0 && log[i].revision_before !== log[i - 1].revision_after) throw rse("operation_log_broken", 3, stage, log[i].operationId, "revision 链缺口");
    }
    if (log[log.length - 1].revision_after !== env.envelope_revision) throw rse("operation_log_broken", 3, stage, null, "log 尾 revision 与 envelope_revision 不符");
    if (log[log.length - 1].hash_after !== env.envelope_self_hash) throw rse("operation_log_broken", 3, stage, null, "log 尾 hash_after 与 envelope_self_hash 不符");
  } else if (env.envelope_revision !== 0) {
    throw rse("operation_log_broken", 3, stage, null, "空 log 但 revision 非 0");
  }
  if (!env.mandates || typeof env.mandates !== "object" || Array.isArray(env.mandates)) throw rse("envelope_structure_invalid", 3, stage, null, "mandates 非对象");
  for (const [mid, wrapper] of Object.entries(env.mandates)) {
    if (!wrapper || typeof wrapper !== "object" || Object.keys(wrapper).sort().join(",") !== WRAPPER_KEYS.join(",")) {
      throw rse("wrapper_structure_invalid", 3, stage, null, "包装记录非恰五键：" + mid);
    }
    const m = wrapper.mandate;
    if (!m || typeof m !== "object") throw rse("mandate_structure_invalid", 3, stage, mid, "mandate 本体缺失");
    const miss = MANDATE_FIELDS.filter((f) => !(f in m));
    if (miss.length) throw rse("mandate_structure_invalid", 3, stage, mid, "缺字段:" + miss.join(","));
    const extra = Object.keys(m).filter((k) => !MANDATE_FIELDS.includes(k));
    if (extra.length) throw rse("mandate_structure_invalid", 3, stage, mid, "额外字段:" + extra.join(","));
    const snap = wrapper.policy_snapshot;
    if (!snap || typeof snap !== "object" || Object.keys(snap).sort().join(",") !== SNAPSHOT_KEYS.join(",")) {
      throw rse("policy_snapshot_invalid", 3, stage, mid, "policy_snapshot 非恰三键");
    }
    if (sha256hex(safeCanonicalJSON(snap.policy_object, "policy_snapshot_invalid", stage, mid, "policy_snapshot 含不可 canonical 载荷（浮点等）")) !== snap.policy_hash) throw rse("policy_snapshot_invalid", 3, stage, mid, "policy_snapshot 重算不符");
    // R2/W-05：captured_at 走 run-authz 严格 parseTimeWithTz（真共用；非法日历=装载期 exitCode=3）
    if (typeof snap.captured_at !== "string" || parseTimeWithTz(snap.captured_at) === null) throw rse("policy_snapshot_invalid", 3, stage, mid, "captured_at 非法");
    if (m.policy_hash !== snap.policy_hash) throw rse("policy_snapshot_invalid", 3, stage, mid, "mandate.policy_hash 与快照不符");
    if (typeof m.mandate_id !== "string" || m.mandate_id !== mid) throw rse("mandate_structure_invalid", 3, stage, mid, "mandate_id 与容器键不符");
  }
  return env;
}

async function loadEnvelopeFile(envelopePath, stage) {
  let text;
  try { text = await readFile(envelopePath, "utf-8"); }
  catch (e) { throw rse("io_load_failed", 3, stage, null, "信封读取失败: " + (e.code || e.message)); }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw rse("io_load_failed", 3, stage, null, "信封非合法 JSON"); }
  // T9：null/非对象载荷统一 fail closed，禁裸 TypeError
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw rse("envelope_structure_invalid", 3, stage, null, "信封载荷非对象");
  }
  return validateEnvelope(parsed, stage);
}

// createMandateStore：工厂返回信封上下文实例；verifyMandate/revokeMandate 为实例方法。
export async function createMandateStore(factoryArgs) {
  const { envelopePath, clock } = factoryArgs ?? {};
  if (typeof envelopePath !== "string" || envelopePath.length === 0) {
    throw rse("invalid_argument", 3, "create_mandate_store", null, "envelopePath required");
  }
  if (clock !== undefined && typeof clock !== "function") {
    throw rse("invalid_argument", 3, "create_mandate_store", null, "clock 须为函数（毫秒整数，与 Date.parse 同口径）");
  }
  const clockFn = typeof clock === "function" ? clock : Date.now;
  const now = () => {
    const v = clockFn();
    if (!Number.isInteger(v)) throw rse("invalid_clock", 3, "clock", null, "clock() 必须返回毫秒整数");
    return v;
  };
  let env;
  try {
    env = await loadEnvelopeFile(envelopePath, "load");
  } catch (e) {
    if (e instanceof RunStoreError && e.code === "io_load_failed" && /ENOENT/.test(e.message)) {
      env = { envelope_revision: 0, clock_floor: 0, operation_log: [], mandates: {}, envelope_self_hash: GENESIS_PARENT_HASH };
    } else throw e;
  }
  // 创世在内存态：首键 hash_before 固定 64 零；clock_floor 初值=首次创建时 now（G 裁定），
  // 为保持创世 hash 确定，创世 envelope_self_hash 固定 GENESIS，首次写入时 clock_floor 落定。
  if (env.operation_log.length === 0 && env.envelope_revision === 0) env.clock_floor = 0;

  // R2/W-06：副本构建 next envelope→验证/落盘成功后才替换 live env（失败写不污染内存态/不留 phantom mandate）
  const persist = async (mutate, operationId) => {
    const nowMs = now();
    if (env.clock_floor !== 0 && nowMs < env.clock_floor) {
      throw rse("clock_rollback_denied", 1, "write", operationId, "now<clock_floor 回拨拒绝写入");
    }
    const revisionBefore = env.envelope_revision;
    const hashBefore = env.operation_log.length === 0 ? GENESIS_PARENT_HASH : env.envelope_self_hash;
    const next = structuredClone(env);
    mutate(next);
    next.envelope_revision = revisionBefore + 1;
    next.clock_floor = next.clock_floor === 0 ? nowMs : Math.max(next.clock_floor, nowMs);
    const entry = { operationId, revision_before: revisionBefore, revision_after: next.envelope_revision, hash_before: hashBefore, hash_after: GENESIS_PARENT_HASH };
    next.operation_log.push(entry);
    entry.hash_after = computeEnvelopeSelfHash(next);
    next.envelope_self_hash = entry.hash_after;
    validateEnvelope(next, "write_validate");
    // R2/T9 口径：落盘 IO 失败收敛为 RunStoreError exitCode=3（副本写失败不替换 live env）
    try { await atomicWrite(envelopePath, canonicalJSON(next) + "\n"); }
    catch (e) {
      if (e instanceof RunStoreError) throw e;
      throw rse("io_write_failed", 3, "write", operationId, "信封落盘失败: " + (e.code || e.message));
    }
    env = next;
    return env.envelope_revision;
  };

  const store = {
    envelopePath,
    // 测试 adapter 播种入口（生产 mandate 挂接留 Task 3A；不新增公共授权面）
    async createMandate(createArgs) {
      const { mandate, policy, operationId } = createArgs ?? {};
      for (const k of Object.keys(createArgs ?? {})) if (!["mandate", "policy", "operationId"].includes(k)) {
        throw rse("unknown_argument", 1, "create_mandate", operationId ?? null, "未知参数 " + k);
      }
      if (!mandate || typeof mandate !== "object" || !MANDATE_FIELDS.every((f) => f in mandate)) {
        throw rse("invalid_argument", 1, "create_mandate", operationId ?? null, "mandate 十八字段闭集不符");
      }
      if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
        throw rse("invalid_argument", 1, "create_mandate", operationId ?? null, "policy 对象缺失");
      }
      if (typeof operationId !== "string" || !operationId) {
        throw rse("invalid_argument", 1, "create_mandate", null, "operationId required");
      }
      // R2/W-03：create 侧 policy 不可 canonical（浮点等）收敛为 RunStoreError（禁 TypeError 外抛）
      let policyHash;
      try { policyHash = sha256hex(canonicalJSON(policy)); }
      catch { throw rse("policy_unserializable", 1, "create_mandate", operationId, "policy 含浮点/不可规范化"); }
      // T6：operationId 全局唯一与幂等——同 operationId 同载荷创建重放返回原结果；异载荷=exitCode=1
      // R2/W-07：重放须核对操作种类——既有条目必须仍是该 mandate 的末次 create（mandate active 且无后续写）；
      // 以 revoke 的 operationId 调 create=exitCode=1
      let incomingMandateCanon;
      try { incomingMandateCanon = canonicalJSON(mandate); }
      catch { throw rse("mandate_unserializable", 1, "create_mandate", operationId, "mandate 含不可 canonical 载荷（浮点等）"); }
      const seen = env.operation_log.find((e) => e.operationId === operationId);
      if (seen) {
        const existing = env.mandates[mandate.mandate_id];
        if (existing && existing.status === "active" && existing.envelope_revision === seen.revision_after
          && canonicalJSON(existing.mandate) === incomingMandateCanon
          && existing.policy_snapshot.policy_hash === policyHash) {
          return { revision: seen.revision_after };
        }
        throw rse("operation_payload_conflict", 1, "create_mandate", operationId, "同 operationId 异载荷/异操作");
      }
      if (env.mandates[mandate.mandate_id]) throw rse("mandate_exists", 1, "create_mandate", operationId, "mandateId 已存在");
      const nowMs = now();
      // R3/T18：创建边界深拷贝——调用方后续 mutation 不得改变 live 信封状态（防引用污染磁盘/live 态）
      const mandateCopy = structuredClone(mandate);
      const policyCopy = structuredClone(policy);
      const wrapper = {
        mandate: mandateCopy,
        policy_snapshot: { policy_object: policyCopy, policy_hash: policyHash, captured_at: new Date(nowMs).toISOString() },
        status: "active",
        revoked: null,
        envelope_revision: 0,
      };
      const revision = await persist((next) => {
        wrapper.envelope_revision = next.envelope_revision + 1;
        next.mandates[mandate.mandate_id] = wrapper;
      }, operationId);
      return { revision };
    },

    // verifyMandate：业务拒绝为结构化 {valid:false,reasons}；有效性判断经共享 validity 核心
    async verifyMandate(verifyArgs) {
      const { mandateId, expectedRevision, operationId } = verifyArgs ?? {};
      for (const k of Object.keys(verifyArgs ?? {})) if (!["mandateId", "expectedRevision", "operationId"].includes(k)) {
        return { valid: false, reasons: ["unknown_argument:" + k] };
      }
      if (typeof mandateId !== "string" || !mandateId) return { valid: false, reasons: ["invalid_mandate_id"] };
      if (!Number.isInteger(expectedRevision)) return { valid: false, reasons: ["invalid_expected_revision"] };
      if (typeof operationId !== "string" || !operationId) return { valid: false, reasons: ["invalid_operation_id"] };
      const record = env.mandates[mandateId];
      if (!record) return { valid: false, reasons: ["mandate_not_found"] };
      const seen = env.operation_log.find((e) => e.operationId === operationId);
      if (seen && seen.revision_after !== record.envelope_revision) return { valid: false, reasons: ["operation_reconciliation_mismatch"] };
      // K1：clock_floor 以信封上下文独立参数传入核心（mandateRecord 保持五键闭集）
      const core = await evaluateMandateValidity({ mandateRecord: record, policySnapshot: record.policy_snapshot, now: now(), clockFloor: env.clock_floor });
      if (!core.valid) return { valid: false, reasons: core.reasons };
      if (expectedRevision !== record.envelope_revision) return { valid: false, reasons: ["stale_revision"] };
      return { valid: true, reasons: [] };
    },

    // revokeMandate：成功/同载荷重放恰 {revision,status}；业务拒绝 RunStoreError exitCode=1
    async revokeMandate(revokeArgs) {
      const { mandateId, stopEpoch, reason, expectedRevision, operationId } = revokeArgs ?? {};
      for (const k of Object.keys(revokeArgs ?? {})) if (!["mandateId", "stopEpoch", "reason", "expectedRevision", "operationId"].includes(k)) {
        throw rse("unknown_argument", 1, "revoke", operationId ?? null, "未知参数 " + k);
      }
      if (typeof mandateId !== "string" || !mandateId) throw rse("invalid_mandate_id", 1, "revoke", null, "mandateId required");
      if (!Number.isInteger(stopEpoch) || stopEpoch < 1) throw rse("invalid_stop_epoch", 1, "revoke", operationId ?? null, "stopEpoch 须为正整数（对齐 state.authorization.stop_epoch 外部基准）");
      if (typeof reason !== "string" || !reason) throw rse("invalid_reason", 1, "revoke", operationId ?? null, "reason required");
      if (!Number.isInteger(expectedRevision)) throw rse("invalid_expected_revision", 1, "revoke", operationId ?? null, "expectedRevision 须为整数");
      if (typeof operationId !== "string" || !operationId) throw rse("invalid_operation_id", 1, "revoke", null, "operationId required");
      const record = env.mandates[mandateId];
      if (!record) throw rse("mandate_not_found", 1, "revoke", operationId, "mandate 不存在");
      const seen = env.operation_log.find((e) => e.operationId === operationId);
      if (seen) {
        // T6：重放幂等须全对账——seen 条目必须正是产生当前撤销态的那次撤销写入（create 的 opId 不得被 revoke 重用）
        if (record.revoked && record.revoked.revision === seen.revision_after
          && record.revoked.stopEpoch === stopEpoch && record.revoked.reason === reason
          && record.revoked.revision - 1 === expectedRevision) {
          return { revision: record.revoked.revision, status: "revoked" };
        }
        throw rse("operation_payload_conflict", 1, "revoke", operationId, "同 operationId 异载荷/异操作");
      }
      if (expectedRevision !== record.envelope_revision) throw rse("stale_revision", 1, "revoke", operationId, "expectedRevision 过期");
      if (record.revoked) {
        if (stopEpoch !== record.revoked.stopEpoch) throw rse("wrong_stop_epoch", 1, "revoke", operationId, "stopEpoch 与记录撤销代不符");
        return { revision: record.envelope_revision, status: "revoked" };
      }
      const revision = await persist((next) => {
        const rec = next.mandates[mandateId];
        rec.revoked = { stopEpoch, reason, revision: next.envelope_revision + 1 };
        rec.status = "revoked";
        rec.envelope_revision = next.envelope_revision + 1;
      }, operationId);
      return { revision, status: "revoked" };
    },

    async readEnvelope() {
      return structuredClone(env);
    },

    // effective-mandate 投影（run-mandate 内部函数；包装→mandate＋status/revoked 派生有效性；
    // 任一 revoked=true 即有效 revoked，投影写入 mandate.revoked=true（18 字段内唯一承载位，仅派生副本））
    async projectEffectiveMandate(mandateId) {
      const record = env.mandates[mandateId];
      if (!record) return null;
      const revokedEffective = !!(record.revoked) || record.status === "revoked" || record.mandate.revoked === true;
      const mandate = structuredClone(record.mandate);
      if (revokedEffective) mandate.revoked = true;
      return { mandate, status: record.status, revokedEffective, envelope_revision: record.envelope_revision };
    },
  };
  return store;
}
