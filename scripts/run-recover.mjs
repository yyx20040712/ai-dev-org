#!/usr/bin/env node
// run-recover.mjs — RT1C recovery orchestration layer (Task 1C)
// Four frozen interfaces (single object parameter each):
//   recoverScan({ projectDir }) -> { status, candidates, orphans, reasons, baseRecordRevision, baseStateRevision }
//   buildCandidate({ sourceRevision }) -> { candidatePath, candidateHash, gaps }
//   applyApproved({ candidatePath, candidateHash, principal, callerSessionId?, approvalRef, approvalHash,
//                   controllerDescriptor?, expectedRevision, operationId }) -> { revision, hash }
//   checkpointRebase({ candidatePath, candidateHash, principal, callerSessionId?, approvalRef, approvalHash,
//                      controllerDescriptor?, expectedRevision, operationId }) -> { stateUuid, revision, hash, epoch }
// Orchestration contract (controller rulings, ledger rows 1035/1038/1044): candidatePath/candidateHash are
// validated in this layer and carried by the existing run-store command surface; they never enter the
// run-store payload closed sets. The unique candidate-install path is the authority-damage offline
// self-write (seven steps, run-state primitives only, never transact).
// --self-test is the batch-local harness; without --self-test this file runs no fixture and performs no
// writes. Dependency direction: run-recover -> run-store -> run-state (read-only reuse, no cycles).
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  RunStoreError, canonicalJSON, sha256hex, computeSelfHash, computeApprovalHash,
  atomicWrite, revisionFilePath, validateRevision, GENESIS_PARENT_HASH,
  GENESIS_JOURNAL_HEAD, HEX64,
} from "./run-state.mjs";
import {
  transact, readCurrent, commitOperation, verifyClaimToken, verifyClaimTokenInUse,
  FROZEN_JOURNAL_STATES, COMMANDS, UNRESOLVED_EFFECT_STATES,
} from "./run-store.mjs";

export { RunStoreError, validateRevision, canonicalJSON, sha256hex } from "./run-state.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES = path.join(SCRIPT_DIR, ".golden", "run-recovery-fixtures.json");
const DEFAULT_TEMP_ROOT = "/tmp/rt1c-executor-selftest";
const TEMP_PREFIX = "/tmp/rt1c-executor-";
const TS0 = "2026-11-05T10:00:00Z";
const HEARTBEAT_EXPIRY_MS = 30 * 60 * 1000;
const RUNTIME_REL = path.join(".zcode", "runtime");
const APPROVALS_REL = path.join("docs", "evidence", "runtime-approvals");
const PROD_RUNTIME = "/home/yyx/work/aidevorg/.zcode/runtime";
const APPROVAL_LAYER_KEYS = {
  applyApproved: ["approvalId", "projectId", "operationId", "kind", "allowedCallers", "approvalHash", "baseRecordRevision", "baseStateRevision", "controllerDescriptor"],
  checkpointRebase: ["approvalId", "projectId", "operationId", "kind", "allowedCallers", "approvalHash", "baseRecordRevision", "baseStateRevision"],
};

// ---- offline operation marker store (族二: 全局按 operationId 索引持久化)
// B-2: 对象性判定用 Array.isArray/!==null 显式排除 null（typeof null === "object" 陷阱）
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
async function loadOpsStore(projectDir) {
  const p = path.join(runtimeDir(projectDir), "recover-ops.json");
  let doc = null;
  try {
    doc = JSON.parse(await fsp.readFile(p, "utf-8"));
  } catch (error) {
    if (error.code === "ENOENT") return { path: p, store: null, absent: true };
    if (error.code === "EACCES" || error.code === "EPERM") {
      throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "ops_store.load", operationId: null, message: "operation marker store unreadable (permission): " + error.code });
    }
    // parse failure = store damage => fail closed as corrupt
    return { path: p, store: null, corrupt: true };
  }
  if (!isPlainObject(doc) || doc.schema !== "recover-ops/v1" || !isPlainObject(doc.operations)) {
    return { path: p, store: null, corrupt: true };
  }
  for (const [opId, ent] of Object.entries(doc.operations)) {
    if (!isPlainObject(ent)
      || typeof ent.requestHash !== "string" || typeof ent.candidateHash !== "string"
      || typeof ent.candidatePath !== "string" || !Number.isInteger(ent.revision) || typeof ent.hash !== "string") {
      return { path: p, store: null, corrupt: true };
    }
    void opId;
  }
  return { path: p, store: doc };
}

async function saveOpsMarker(projectDir, entry) {
  const { path: p, store, corrupt } = await loadOpsStore(projectDir);
  if (corrupt) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "ops_store.corrupt", operationId: entry.operationId, message: "operation marker store is corrupt; failing closed" });
  }
  const doc = store ?? { schema: "recover-ops/v1", operations: {} };
  doc.operations[entry.operationId] = {
    requestHash: entry.requestHash, candidateHash: entry.candidateHash,
    revision: entry.revision, hash: entry.hash, candidatePath: entry.candidatePath,
  };
  traceMark("run_state.atomicWrite");
  await atomicWrite(p, canonicalJSON(doc), {});
}

// B-2: marker 只是辅助记录——重放命中必须交叉核验持久证据：
// (1) marker.revision 对应版本文件存在且内容 hash===marker.hash；
// (2) authority.controller_operation_id===opId 且 current_revision>=marker.revision 且
//     （current_revision===marker.revision 时 current_hash===marker.candidateHash）。
// 伪造匹配 marker（revision:999 无文件）→ blocked@replay.marker_unverified。
async function verifyOpsMarkerEvidence(projectDir, opId, prior) {
  // N: 单次 authority 读快照（消 TOCTOU——核验过程不再二次读 authority）
  let authority;
  try {
    authority = await layerLoadAuthority(projectDir, opId);
  } catch { return { ok: false, where: "authority-unreadable" }; }
  if (!isPlainObject(authority) || typeof authority.state_uuid !== "string" || authority.state_uuid.length === 0) {
    return { ok: false, where: "authority-missing-state-uuid" };
  }
  const revFile = revisionFilePath(projectDir, authority.state_uuid, prior.revision);
  if (!fs.existsSync(revFile)) return { ok: false, where: "revision-file-missing" };
  let doc;
  try {
    doc = JSON.parse(await fsp.readFile(revFile, "utf-8"));
  } catch { return { ok: false, where: "revision-file-unreadable" }; }
  if (!isPlainObject(doc) || computeSelfHash(doc) !== doc.self_hash || doc.self_hash !== prior.candidateHash) {
    // marker.hash is the operation hash (return value); the installed revision's content hash
    // must equal the marker's candidateHash (envelope.state.self_hash)
    return { ok: false, where: "revision-hash-mismatch" };
  }
  if (doc.revision !== prior.revision) {
    return { ok: false, where: "revision-number-mismatch" };
  }
  if (authority.controller_operation_id !== opId) return { ok: false, where: "controller-operation-id" };
  if (!(authority.current_revision >= prior.revision)) return { ok: false, where: "current-behind-marker" };
  if (authority.current_revision === prior.revision && authority.current_hash !== prior.candidateHash) {
    return { ok: false, where: "current-hash-vs-candidate" };
  }
  return { ok: true };
}

async function currentAuthorityStateUuid(projectDir) {
  const a = await layerLoadAuthority(projectDir, null);
  if (!isPlainObject(a) || typeof a.state_uuid !== "string" || a.state_uuid.length === 0) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "authority.shape", operationId: null, message: "authority missing state_uuid during marker evidence verification; failing closed" });
  }
  return a.state_uuid;
}

// 全局重放绑定检查: 同 opId 换候选/换审批 deny; 命中即交叉核验持久证据后返回原值
async function checkOpsReplayBinding(projectDir, opId, requestHash, envelope, resolvedFile) {
  const { store, corrupt } = await loadOpsStore(projectDir);
  if (corrupt) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "ops_store.corrupt", operationId: opId, message: "operation marker store is corrupt; failing closed" });
  }
  if (store && isPlainObject(store.operations) && store.operations[opId]) {
    const prior = store.operations[opId];
    if (prior.requestHash !== requestHash || prior.candidateHash !== envelope.candidateHash) {
      throw new RunStoreError({ code: "request_hash_conflict", exitCode: 1, stage: "replay", operationId: opId, message: "operation replayed with a different approval/candidate payload (global marker binding)" });
    }
    if (prior.candidatePath !== resolvedFile) {
      throw new RunStoreError({ code: "request_hash_conflict", exitCode: 1, stage: "replay", operationId: opId, message: "operation replayed against a different candidate path (global marker binding)" });
    }
    if (prior.hash !== sha256hex(opId + ":" + requestHash)) {
      // B-3: marker.hash 必须等于 opHash 重算 —— 伪造的匹配 marker 不得包装未发生的安装
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "replay.marker_unverified", operationId: opId, message: "operation marker hash does not recompute to sha256(opId:requestHash); failing closed" });
    }
    const evidence = await verifyOpsMarkerEvidence(projectDir, opId, prior);
    if (!evidence.ok) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "replay.marker_unverified", operationId: opId, message: "operation marker does not cross-verify against persistent evidence (" + evidence.where + "); failing closed" });
    }
    return { revision: prior.revision, hash: prior.hash };
  }
  return null;
}

// ------------------------------------------------------------ observability trace
const TRACE = [];
function traceMark(name) { TRACE.push(name); }
function traceReset() { TRACE.length = 0; }

// ------------------------------------------------------------ temp-root guard
export async function guardRecoverTempRoot(tempRoot) {
  if (typeof tempRoot !== "string" || tempRoot.length === 0) return { ok: false, reason: "empty" };
  const resolved = path.resolve(tempRoot);
  if (!resolved.startsWith(TEMP_PREFIX)) return { ok: false, reason: "prefix" };
  if (resolved.includes("..")) return { ok: false, reason: "traversal" };
  let real;
  try {
    real = await fsp.realpath(resolved);
  } catch (error) {
    if (error.code === "ENOENT") {
      let probe = path.dirname(resolved);
      for (;;) {
        try {
          real = await fsp.realpath(probe);
          break;
        } catch (e2) {
          if (e2.code === "ENOENT" && probe !== path.dirname(probe)) probe = path.dirname(probe);
          else throw e2;
        }
      }
      if (real !== probe) return { ok: false, reason: "symlink_escape" };
      if (probe !== "/tmp" && !probe.startsWith(TEMP_PREFIX)) return { ok: false, reason: "ancestor_escape" };
      return { ok: true, reason: null, resolved };
    }
    throw error;
  }
  if (real !== resolved && !real.startsWith(TEMP_PREFIX)) return { ok: false, reason: "symlink_escape" };
  return { ok: true, reason: null, resolved };
}

// ------------------------------------------------------------ fault slot (harness-only)
let ACTIVE_FAULT = null;
function faultGuard(phase, stage, operationId) {
  const f = ACTIVE_FAULT;
  if (!f || f.phase !== phase) return false;
  if (f.mode === "ENOSPC") {
    throw new RunStoreError({ code: "io_enospc", exitCode: 3, stage, operationId, message: "simulated ENOSPC at " + stage });
  }
  throw new RunStoreError({ code: "io_fault", exitCode: 3, stage, operationId, message: "injected IO fault at " + stage });
}
function setHarnessFault(fault) { ACTIVE_FAULT = fault && typeof fault === "object" ? fault : null; }

// ------------------------------------------------------------ shared helpers
function runtimeDir(projectDir) { return path.join(projectDir, RUNTIME_REL); }
function authorityPath(projectDir) { return path.join(runtimeDir(projectDir), "authority.json"); }
function highwaterPath(projectDir) { return path.join(runtimeDir(projectDir), "highwater.json"); }
function journalPath(projectDir) { return path.join(runtimeDir(projectDir), "cutover-journal.json"); }
function lockPath(projectDir) { return path.join(runtimeDir(projectDir), "lock"); }
function stateDir(projectDir, stateUuid) { return path.join(runtimeDir(projectDir), "state", stateUuid); }
function candidatesDir(projectDir) { return path.join(runtimeDir(projectDir), "candidates"); }
function recoverCandidatesDir(projectDir) { return path.join(candidatesDir(projectDir), "recover"); }
function approvalsDir(projectDir) { return path.join(projectDir, APPROVALS_REL); }
function manifestPath(projectDir) { return path.join(runtimeDir(projectDir), "manifest.json"); }
function closuresDir(projectDir) { return path.join(runtimeDir(projectDir), "closures"); }
function autorefsPath(projectDir) { return path.join(runtimeDir(projectDir), "probes", "autorefs.json"); }
function nowIso() { return new Date().toISOString(); }

function requestHashOf({ command, principal, sessionId, operationId, payload }) {
  return sha256hex(canonicalJSON({ command, principal, sessionId, operationId, payload }));
}
function encodeApplied(operationId, requestHash, revision, hash, recordRevision) {
  return operationId + ":" + requestHash + ":" + revision + ":" + hash + ":" + recordRevision;
}
function decodeAppliedLast(entry) {
  const parts = entry.split(":");
  if (parts.length < 5) return null;
  const recordRevision = parts.pop();
  const hash = parts.pop();
  const revision = parts.pop();
  const requestHash = parts.pop();
  const operationId = parts.join(":");
  return { operationId, requestHash, revision: Number(revision), hash, recordRevision: Number(recordRevision) };
}
function findAppliedInList(appliedOperations, operationId) {
  for (const entry of appliedOperations ?? []) {
    const d = decodeAppliedLast(entry);
    if (d && d.operationId === operationId) return d;
  }
  return null;
}

function entryHashOf(entry) {
  const copy = structuredClone(entry);
  delete copy.entryHash;
  return sha256hex(canonicalJSON(copy));
}
function journalHeadHash(journal) {
  const copy = structuredClone(journal);
  delete copy.headHash;
  return sha256hex(canonicalJSON(copy));
}

async function readJsonFile(file, stage, operationId = null) {
  let text;
  try {
    text = await fsp.readFile(file, "utf-8");
  } catch (error) {
    throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: stage + ".load", operationId, message: "read failed " + file + ": " + error.code });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: stage + ".parse", operationId, message: "corrupt JSON at " + file });
  }
}

const AUTHORITY_KEYS = ["record_revision", "epoch", "mode", "state_uuid", "base_revision", "base_hash", "current_revision", "current_hash", "controller_operation_id", "mode_change_approval_ref", "journal_generation", "journal_head_hash"];
const REVISION_REQUIRED_KEYS = ["schema", "state_uuid", "revision", "owner_session_id", "parent_revision", "parent_hash", "self_hash", "active_run", "queue", "effects", "authorization", "reviews", "sessions", "pending_closures", "applied_operations", "pending_audit"];

function authorityShapeOk(a) {
  return !!a && typeof a === "object" && AUTHORITY_KEYS.every((k) => k in a)
    && Number.isInteger(a.record_revision) && Number.isInteger(a.epoch) && Number.isInteger(a.current_revision)
    && typeof a.current_hash === "string" && typeof a.state_uuid === "string";
}

async function layerLoadAuthority(projectDir, operationId = null) {
  return readJsonFile(authorityPath(projectDir), "authority", operationId);
}
async function layerLoadHighwater(projectDir, operationId = null) {
  let doc;
  try {
    doc = await readJsonFile(highwaterPath(projectDir), "highwater", operationId);
  } catch (error) {
    if (error.code === "io_load_failed" && /ENOENT/.test(error.message)) return {};
    throw error;
  }
  // W: parse 成功但非对象（null/数组/标量）→ 六字段 blocked
  if (!isPlainObject(doc)) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "highwater.invalid", operationId, message: "highwater content is not a mapping" });
  }
  return doc;
}
async function layerLoadRevisionFile(projectDir, stateUuid, revision, operationId = null) {
  const r = await readJsonFile(revisionFilePath(projectDir, stateUuid, revision), "revision", operationId);
  for (const k of REVISION_REQUIRED_KEYS) {
    if (!(k in r)) throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "revision.shape", operationId, message: "revision missing required key " + k });
  }
  if (r.state_uuid !== stateUuid) throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "revision.state_uuid", operationId, message: "revision state_uuid mismatch" });
  return r;
}
async function layerLoadJournal(projectDir, operationId = null) {
  let j;
  try {
    j = await readJsonFile(journalPath(projectDir), "journal", operationId);
  } catch (error) {
    if (error.code === "io_load_failed" && /ENOENT/.test(error.message)) return null;
    throw error;
  }
  // 1) 容器对象性
  if (j === null || typeof j !== "object" || Array.isArray(j)) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.shape", operationId, message: "journal container is not an object" });
  }
  // 2) CutoverJournal 顶层恰五键（schema additionalProperties:false＝第六键即拒）＋类型
  const JOURNAL_CONTAINER_KEYS = ["schema", "generation", "previousHeadHash", "headHash", "entries"];
  for (const k of JOURNAL_CONTAINER_KEYS) {
    if (!(k in j)) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.shape", operationId, message: "journal container missing CutoverJournal key " + k });
    }
  }
  for (const k of Object.keys(j)) {
    if (!JOURNAL_CONTAINER_KEYS.includes(k)) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.shape", operationId, message: "journal container carries a key outside the five-key closed set: " + k });
    }
  }
  if (!Number.isInteger(j.generation) || j.generation < 0) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.shape", operationId, message: "journal generation must be a non-negative integer" });
  }
  if (typeof j.headHash !== "string" || !HEX64.test(j.headHash)) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.shape", operationId, message: "journal headHash must be 64-hex" });
  }
  // 3) entries 数组性
  if (!Array.isArray(j.entries)) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.shape", operationId, message: "journal entries is not an array" });
  }
  // 4) 逐 entry 对象性 (null/数组/标量全拒)
  for (const e of j.entries) {
    if (e === null || typeof e !== "object" || Array.isArray(e)) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.entry_shape", operationId: null, message: "journal entry is null or not an object" });
    }
  }
  // 5) hash 校验 (在对象性之后)
  if (j.headHash !== journalHeadHash(j)) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.head_hash", operationId, message: "journal headHash does not match recomputed content" });
  }
  for (const e of j.entries) {
    if (e.entryHash !== entryHashOf(e)) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.entry_hash", operationId: typeof e.operationId === "string" ? e.operationId : null, message: "journal entryHash mismatch on load" });
    }
  }
  // 6) 按 status 的键闭集: docs/14 :163-173 逐状态允许集 (非全局并集 —
  // B-1: 以 templates/runtime/cutover.schema.json 为单源的逐状态表（docs/14 :163-173 对照）。
  // REQUIRED = schema variant.required 去掉 entryHash（写入器计算、装载器已先行校验）；
  // ALLOWED  = schema variant.properties（additionalProperties:false＝未列字段禁填）。
  // confirming/confirmed 需 confirmApprovalRef/confirmApprovalHash；confirmed 允许 confirmedRef/
  // recoveredBy；abandoned 需 abortEvidenceRef/abortEvidenceHash＋resumeOperation（resumeRef/
  // abandonApproval* 为 allowed；docs/14:169 recoveredBy 语义）；recovering/recovered 为 R 态
  const OPREF_REQUIRED = ["operationId", "kind", "parentRevision", "parentHash", "revision", "hash", "epoch", "stopEpoch"];
  const C_BASE = ["operationId", "status", "principal", "callerSessionId", "parentRevision", "parentHash", "stateUuid", "authorityEpoch", "approvalRef", "approvalHash", "entryHash"];
  const R_BASE = ["operationId", "status", "principal", "callerSessionId", "parentRevision", "parentHash", "stateUuid", "authorityEpoch", "approvalRef", "approvalHash", "entryHash"];
  const STATUS_FIELDS = {
    stopping:   { base: "C", req: ["stopRef"], allow: [] },
    preparing:  { base: "C", req: ["stopRef", "candidatePath", "candidateRef"], allow: [] },
    prepared:   { base: "C", req: ["stopRef", "candidatePath", "candidateRef"], allow: [] },
    confirming: { base: "C", req: ["stopRef", "confirmApprovalRef", "confirmApprovalHash"], allow: ["candidatePath", "candidateRef"] },
    confirmed:  { base: "C", req: ["stopRef", "confirmApprovalRef", "confirmApprovalHash"], allow: ["candidatePath", "candidateRef", "recoveredBy"] },
    abandoned:  { base: "C", req: ["stopRef", "abortEvidenceRef", "abortEvidenceHash", "resumeOperation"], allow: ["candidatePath", "candidateRef", "abandonApprovalRef", "abandonApprovalHash", "resumeRef"] },
    recovering: { base: "R", req: ["confirmedRef", "recoveryRef"], allow: [] },
    recovered:  { base: "R", req: ["confirmedRef", "recoveryRef"], allow: ["recoveredBy"] },
  };
  for (const e of j.entries) {
    const opId = typeof e.operationId === "string" ? e.operationId : "unknown";
    if (typeof e.status !== "string") {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.entry_shape", operationId: opId, message: "journal entry missing status" });
    }
    const spec = STATUS_FIELDS[e.status];
    if (!spec) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.entry_shape", operationId: opId, message: "journal entry status not in the closed set: " + e.status });
    }
    const baseFields = spec.base === "C" ? C_BASE : R_BASE;
    for (const k of baseFields.concat(spec.req)) {
      if (!(k in e)) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.entry_shape", operationId: opId, message: "journal entry status " + e.status + " missing required field " + k });
      }
    }
    const allowed = new Set([...baseFields, ...spec.req, ...spec.allow]);
    for (const k of Object.keys(e)) {
      if (!allowed.has(k)) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.entry_shape", operationId: opId, message: "journal entry status " + e.status + " carries a field outside its schema closed set: " + k });
      }
    }
    // confirmedRef 为 docs/14:173 的五键 ConfirmedRef（非八键 OperationRef）；其余 ref 八键
    for (const refName of ["stopRef", "candidateRef", "resumeOperation", "recoveryRef", "recoveredBy"]) {
      if (e[refName] !== undefined) {
        if (!isPlainObject(e[refName])) {
          throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.operation_ref_shape", operationId: opId, message: "journal " + refName + " is not an object" });
        }
        for (const k of OPREF_REQUIRED) {
          if (!(k in e[refName])) {
            throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.operation_ref_shape", operationId: opId, message: "journal " + refName + " missing OperationRef key " + k });
          }
        }
      }
    }
    if (e.confirmedRef !== undefined) {
      if (!isPlainObject(e.confirmedRef)) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.operation_ref_shape", operationId: opId, message: "journal confirmedRef is not an object" });
      }
      for (const k of ["operationId", "candidateHash", "revision", "hash", "epoch"]) {
        if (!(k in e.confirmedRef)) {
          throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.operation_ref_shape", operationId: opId, message: "journal confirmedRef missing ConfirmedRef key " + k });
        }
      }
    }
  }
  return j;
}

// journal-missing reconciliation: the authority anchor decides whether an absent journal is legal
function journalMissingBlocked(authorityLike) {
  if (!isPlainObject(authorityLike)) return { blocked: false };
  // B-4: 非法值（负代际/非整数/非串 head）不是 genesis——journal 缺失时一律 blocked
  if (!Number.isInteger(authorityLike.journal_generation) || authorityLike.journal_generation < 0) {
    return { blocked: true, why: "invalid journal_generation" };
  }
  if (typeof authorityLike.journal_head_hash !== "string" || !HEX64.test(authorityLike.journal_head_hash)) {
    return { blocked: true, why: "invalid journal_head_hash" };
  }
  return { blocked: authorityLike.journal_generation > 0 || authorityLike.journal_head_hash !== GENESIS_JOURNAL_HEAD };
}

function controllerActiveState(state) {
  const c = state.authorization.controller;
  if (c.session_uuid === null || c.released_at !== null || c.blocked === true) return false;
  const hb = state.sessions[c.session_uuid]?.live_state?.heartbeat;
  if (typeof hb === "string") {
    const t = Date.parse(hb);
    if (Number.isFinite(t) && Date.now() - t > HEARTBEAT_EXPIRY_MS) return false;
  }
  return true;
}

async function deriveProjectDirFromCandidate(candidatePath, operationId) {
  if (typeof candidatePath !== "string" || candidatePath.length === 0) {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage: "candidate.derive", operationId, message: "candidatePath required" });
  }
  faultGuard("candidate_read", "candidate.read", operationId);
  let resolvedFile;
  try {
    resolvedFile = await fsp.realpath(path.resolve(candidatePath));
  } catch (error) {
    throw new RunStoreError({ code: "candidate_missing", exitCode: 1, stage: "candidate.read", operationId, message: "candidate file unreadable: " + error.code });
  }
  let cur = path.dirname(resolvedFile);
  for (let i = 0; i < 10; i += 1) {
    const rt = path.join(cur, RUNTIME_REL);
    if (fs.existsSync(rt)) {
      const candRoot = path.join(rt, "candidates");
      const rel = path.relative(candRoot, resolvedFile);
      if (rel === "" || rel.startsWith("..")) {
        throw new RunStoreError({ code: "candidate_ref_escape", exitCode: 1, stage: "candidate.derive", operationId, message: "candidate realpath escapes the candidates dir" });
      }
      let realCandRoot = candRoot;
      try {
        realCandRoot = await fsp.realpath(candRoot);
      } catch { /* keep lexical */ }
      const relReal = path.relative(realCandRoot, resolvedFile);
      if (relReal === "" || relReal.startsWith("..")) {
        throw new RunStoreError({ code: "candidate_ref_escape", exitCode: 1, stage: "candidate.derive", operationId, message: "candidate realpath escapes the candidates dir (symlink)" });
      }
      return { projectDir: cur, resolvedFile };
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  throw new RunStoreError({ code: "candidate_ref_escape", exitCode: 1, stage: "candidate.derive", operationId, message: "candidatePath does not resolve inside an isolated runtime candidates dir" });
}

const CANDIDATE_INDEX = "recover-candidate-index.json";
async function loadCandidateEnvelope(resolvedFile, operationId) {
  faultGuard("candidate_read", "candidate.read", operationId);
  const envelope = await readJsonFile(resolvedFile, "candidate", operationId);
  if (!envelope || typeof envelope !== "object" || !envelope.candidateRef || !envelope.state) {
    throw new RunStoreError({ code: "candidate_incomplete", exitCode: 1, stage: "candidate.shape", operationId, message: "candidate envelope must carry candidateRef and state" });
  }
  const recomputed = computeSelfHash(envelope.state);
  if (recomputed !== envelope.state.self_hash || envelope.candidateHash !== recomputed) {
    throw new RunStoreError({ code: "candidate_hash_mismatch", exitCode: 1, stage: "candidate.hash", operationId, message: "candidateHash does not match the recomputed candidate self-hash" });
  }
  return envelope;
}
async function loadCandidateEvidence(projectDir, resolvedFile, operationId) {
  faultGuard("evidence_read", "evidence.read", operationId);
  const indexFile = path.join(approvalsDir(projectDir), CANDIDATE_INDEX);
  let index;
  try {
    index = await readJsonFile(indexFile, "candidate_index", operationId);
  } catch (error) {
    if (error.code === "io_load_failed" && /ENOENT/.test(error.message)) {
      throw new RunStoreError({ code: "evidence_missing", exitCode: 1, stage: "candidate.evidence", operationId, message: "candidate has no pre-placed evidence index (rootless evidence denied)" });
    }
    throw error;
  }
  if (!isPlainObject(index) || !Array.isArray(index.entries)) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "candidate_index.corrupt", operationId, message: "candidate index content is not a mapping with entries; failing closed" });
  }
  const entry = (index.entries ?? []).find((e) => e.candidatePath === resolvedFile);
  if (!entry) {
    throw new RunStoreError({ code: "evidence_missing", exitCode: 1, stage: "candidate.evidence", operationId, message: "candidate has no pre-placed evidence artifact" });
  }
  const base = approvalsDir(projectDir);
  const evidenceFile = path.resolve(base, entry.evidenceRef);
  if (evidenceFile !== base && !evidenceFile.startsWith(base + path.sep)) {
    throw new RunStoreError({ code: "evidence_ref_escape", exitCode: 1, stage: "evidence.resolve", operationId, message: "evidenceRef escapes approvals dir" });
  }
  const doc = await readJsonFile(evidenceFile, "evidence", operationId);
  if (!doc || typeof doc.evidenceHash !== "string") {
    throw new RunStoreError({ code: "evidence_incomplete", exitCode: 1, stage: "evidence.shape", operationId, message: "evidence file must carry an evidenceHash" });
  }
  const copy = structuredClone(doc);
  delete copy.evidenceHash;
  if (sha256hex(canonicalJSON(copy)) !== doc.evidenceHash) {
    throw new RunStoreError({ code: "evidence_hash_mismatch", exitCode: 1, stage: "evidence.hash", operationId, message: "evidenceHash does not match recomputed content" });
  }
  return { evidenceRef: entry.evidenceRef, doc, index };
}

async function layerLoadApproval(projectDir, ref, expectedKind, operationId, caller, phase = "approval_read") {
  faultGuard(phase, "approval.load", operationId);
  if (typeof ref !== "string" || ref.length === 0) {
    throw new RunStoreError({ code: "invalid_approval_ref", exitCode: 1, stage: "approval.resolve", operationId, message: "approvalRef missing" });
  }
  const base = approvalsDir(projectDir);
  const resolved = path.resolve(base, ref);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new RunStoreError({ code: "approval_ref_escape", exitCode: 1, stage: "approval.resolve", operationId, message: "approvalRef escapes approvals dir" });
  }
  let realFile;
  try {
    realFile = await fsp.realpath(resolved);
  } catch (error) {
    throw new RunStoreError({ code: "approval_missing", exitCode: 1, stage: "approval.load", operationId, message: "approval file unreadable: " + error.code });
  }
  if (realFile !== base && !realFile.startsWith(base + path.sep)) {
    throw new RunStoreError({ code: "approval_ref_escape", exitCode: 1, stage: "approval.resolve", operationId, message: "approval realpath escapes the approvals dir (symlink)" });
  }
  const doc = await readJsonFile(realFile, "approval", operationId);
  if (!isPlainObject(doc)) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "approval.shape", operationId, message: "approval artifact is not a mapping" });
  }
  for (const k of ["approvalId", "projectId", "kind", "allowedCallers", "approvalHash"]) {
    if (doc[k] === undefined || doc[k] === null) {
      throw new RunStoreError({ code: "approval_incomplete", exitCode: 1, stage: "approval.shape", operationId, message: "approval missing required key " + k });
    }
  }
  if (computeApprovalHash(doc) !== doc.approvalHash) {
    throw new RunStoreError({ code: "approval_hash_mismatch", exitCode: 1, stage: "approval.hash", operationId, message: "approvalHash does not match recomputed content (forged)" });
  }
  if (expectedKind && doc.kind !== expectedKind) {
    throw new RunStoreError({ code: "approval_kind_mismatch", exitCode: 1, stage: "approval.kind", operationId, message: "approval kind " + doc.kind + " != " + expectedKind });
  }
  const allowedKeys = APPROVAL_LAYER_KEYS[doc.kind] ?? null;
  if (!allowedKeys) {
    throw new RunStoreError({ code: "approval_kind_mismatch", exitCode: 1, stage: "approval.kind", operationId, message: "approval kind not in the layer closed set: " + doc.kind });
  }
  for (const k of Object.keys(doc)) {
    if (!allowedKeys.includes(k)) {
      throw new RunStoreError({ code: "approval_extra_key", exitCode: 1, stage: "approval.shape", operationId, message: "approval key not in closed set for kind " + doc.kind + ": " + k });
    }
  }
  const layerKinds = new Set(["applyApproved", "checkpointRebase"]);
  if (layerKinds.has(doc.kind)) {
    if (typeof doc.operationId !== "string" || doc.operationId !== operationId) {
      throw new RunStoreError({ code: "approval_binding_mismatch", exitCode: 1, stage: "approval.binding", operationId, message: "approval operationId missing or mismatching (mandatory binding for kind " + doc.kind + ")" });
    }
  } else if (doc.operationId !== undefined && doc.operationId !== operationId) {
    throw new RunStoreError({ code: "approval_binding_mismatch", exitCode: 1, stage: "approval.binding", operationId, message: "approval operationId mismatch" });
  }
  if (!Array.isArray(doc.allowedCallers) || doc.allowedCallers.length === 0) {
    throw new RunStoreError({ code: "approval_incomplete", exitCode: 1, stage: "approval.callers", operationId, message: "allowedCallers must be a non-empty array" });
  }
  if (caller) {
    const ok = doc.allowedCallers.some((c) => c.principal === caller.principal && (c.callerSessionId ?? null) === (caller.callerSessionId ?? null));
    if (!ok) {
      throw new RunStoreError({ code: "approval_caller_mismatch", exitCode: 1, stage: "approval.callers", operationId, message: "caller not in allowedCallers" });
    }
  }
  return doc;
}

function assertObjectKeys(obj, allowed, required, stage, operationId) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage, operationId, message: "single object parameter required" });
  }
  const snapshotKeys = ["state", "authority", "highwater", "journal", "policy", "snapshot", "fault"];
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      throw new RunStoreError({ code: snapshotKeys.includes(k) ? "snapshot_parameter_denied" : "extra_arg", exitCode: 1, stage, operationId, message: "unexpected parameter key " + k + " (caller snapshots and fault injection are denied)" });
    }
  }
  for (const k of required) {
    if (!(k in obj)) {
      throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage, operationId, message: "missing required parameter " + k });
    }
  }
}

// ═══════════════════════════════════════════════ interfaces (green phase)

// ---- scan-mini: consistent-vs-corrupt classification with real base revisions
// Fail-closed contract: IO/parse failures always surface as exitCode=3 RunStoreError and are
// NEVER swallowed into the authority-corrupt classification; only anchor/shape mismatches on
// parseable data classify as corrupt. A null/non-object authority is corrupt (not a TypeError).
async function scanMini(projectDir, operationId = null) {
  const authorityRaw = await readJsonFile(authorityPath(projectDir), "authority", operationId);
  const authorityIsObject = authorityRaw !== null && typeof authorityRaw === "object" && !Array.isArray(authorityRaw);
  let corrupt = !authorityIsObject || !authorityShapeOk(authorityRaw);
  const authority = authorityIsObject ? authorityRaw : null;
  let hw;
  {
    let hwRaw;
    try {
      hwRaw = JSON.parse(await fsp.readFile(highwaterPath(projectDir), "utf-8"));
    } catch (error) {
      if (error.code === "ENOENT") { hwRaw = "ABSENT"; }
      else if (error.code === "EACCES" || error.code === "EPERM") {
        throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "highwater.load", operationId, message: "highwater unreadable (permission): " + error.code });
      } else { hwRaw = undefined; } // parse failure -> invalid
    }
    if (hwRaw === "ABSENT") {
      // 族四: file absent -> highwater.missing blocked below (不降级 orphan)
      hwRaw = "ABSENT";
    }
    if (hwRaw === undefined || (hwRaw !== "ABSENT" && !isPlainObject(hwRaw))) {
      // W: null/[]/字符串/畸形 → blocked@highwater.invalid（不降级 orphan 分类）
      if (authorityIsObject) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "highwater.invalid", operationId, message: "highwater content is not a mapping; failing closed instead of downgrading to orphan classification" });
      }
      hwRaw = {};
    }
    hw = hwRaw === "ABSENT" ? {} : hwRaw;
  }
  // 族四: highwater 文件缺失 => 权威工件不完备, blocked (绝不静默视为空后降级为 orphan 分类)
  if (!fs.existsSync(highwaterPath(projectDir)) && authorityIsObject) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "highwater.missing", operationId, message: "highwater file absent while authority exists; failing closed instead of downgrading to orphan classification" });
  }
  // 族四: journal 文件缺失而 authority 锚非 genesis => journal 与锚不符, 仅原 operation 可验链 (docs/14:155)
  if (!fs.existsSync(journalPath(projectDir))) {
    const a0 = authorityIsObject ? authorityRaw : null;
    if (journalMissingBlocked(a0).blocked) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.missing_anchor", operationId, message: "journal absent while authority anchor is non-genesis; only the original operation may verify-and-catch-up (docs/14:155)" });
    }
  }
  let state = null;
  if (!corrupt) {
    // io/parse failure of the current revision rethrows (exit 3); hash/shape mismatch corrupts
    try {
      state = await layerLoadRevisionFile(projectDir, authority.state_uuid, authority.current_revision, operationId);
    } catch (error) {
      if (error.code === "io_load_failed") throw error;
      corrupt = true;
    }
    if (!corrupt && (computeSelfHash(state) !== state.self_hash || state.self_hash !== authority.current_hash)) corrupt = true;
    if (!corrupt) {
      // highwater same-revision anchor consistency (R8)
      const e = hw[authority.state_uuid];
      if (e && e.current_revision === authority.current_revision
        && (e.current_hash !== authority.current_hash || e.record_revision !== authority.record_revision)) corrupt = true;
    }
  }
  let baseRecordRevision = null;
  let baseStateRevision = null;
  let baseStateHash = null;
  let immutableState = null;
  let baseStateUuid = null;
  let offlineEpoch = null;
  let offlineMode = null;
  if (!corrupt) {
    baseRecordRevision = authority.record_revision;
    baseStateRevision = authority.current_revision;
    baseStateHash = state.self_hash;
    immutableState = state;
    baseStateUuid = authority.state_uuid;
  } else {
    // authority damage: bases/evidence come from highwater + the immutable revision directory only
    const uuids = Object.keys(hw).filter((k) => hw[k] && Number.isInteger(hw[k].current_revision));
    const starts = [];
    for (const u of uuids) starts.push({ uuid: u, rev: hw[u].current_revision });
    if (authorityIsObject && Number.isInteger(authority.current_revision) && typeof authority.state_uuid === "string") {
      starts.push({ uuid: authority.state_uuid, rev: authority.current_revision });
    }
    starts.sort((a, b) => b.rev - a.rev);
    let found = null;
    for (const s of starts) {
      for (let n = s.rev; n >= 0 && !found; n -= 1) {
        const file = revisionFilePath(projectDir, s.uuid, n);
        if (!fs.existsSync(file)) continue;
        try {
          const doc = JSON.parse(await fsp.readFile(file, "utf-8"));
          if (doc && REVISION_REQUIRED_KEYS.every((k) => k in doc) && doc.state_uuid === s.uuid
            && computeSelfHash(doc) === doc.self_hash) {
            // verify the in-dir chain below the candidate anchor before trusting it
            let ok = true;
            let cursor = doc;
            for (let i = 0; i < 512 && cursor.revision > 0; i += 1) {
              const pf = revisionFilePath(projectDir, s.uuid, cursor.parent_revision);
              let parent = null;
              try { parent = JSON.parse(await fsp.readFile(pf, "utf-8")); } catch { parent = null; }
              if (!parent || parent.self_hash !== cursor.parent_hash || computeSelfHash(parent) !== parent.self_hash) { ok = false; break; }
              cursor = parent;
            }
            if (cursor.revision === 0 && cursor.parent_hash !== GENESIS_PARENT_HASH) ok = false;
            if (ok) found = { doc, n, uuid: s.uuid };
          }
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "authority.offline_base.load", operationId, message: "immutable revision read failed during offline base walk: " + String(error.message ?? error) });
        }
      }
      if (found) break;
    }
    if (!found) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "authority.offline_base", operationId, message: "no verifiable immutable revision chain to rebuild from; failing closed" });
    }
    baseStateRevision = found.n;
    baseStateHash = found.doc.self_hash;
    immutableState = found.doc;
    baseStateUuid = found.uuid;
    const hwEntry = hw[found.uuid];
    if (!hwEntry || !Number.isInteger(hwEntry.record_revision)) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "authority.offline_base", operationId, message: "no real record_revision source for the offline base; failing closed" });
    }
    baseRecordRevision = hwEntry.record_revision;
    // epoch/mode must come from verifiable evidence; silent 0/runtime defaults are forbidden (R4)
    const producerEpoch = found.doc.producer_operation && Number.isInteger(found.doc.producer_operation.epoch) ? found.doc.producer_operation.epoch : null;
    if (authorityIsObject && Number.isInteger(authorityRaw.epoch)) {
      if (producerEpoch !== null && producerEpoch !== authorityRaw.epoch) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "authority.offline_epoch", operationId, message: "epoch evidence conflict: authority " + authorityRaw.epoch + " vs immutable producer " + producerEpoch + "; failing closed" });
      }
      offlineEpoch = { value: authorityRaw.epoch, source: "authority.field" };
    } else if (producerEpoch !== null) {
      offlineEpoch = { value: producerEpoch, source: "immutable.producer_operation" };
    } else {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "authority.offline_epoch", operationId, message: "no verifiable epoch evidence for the offline rebuild; failing closed" });
    }
    // W: mode 独立证据——保守规则：authority.mode=legacy 一律 blocked（Revision 不承载 mode，
    // 无不可变对照源可证「确以 legacy 运行」；不得借恢复静默承袭/切换 legacy）
    if (authorityIsObject && authorityRaw.mode === "legacy") {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "authority.offline_mode", operationId, message: "authority.mode=legacy cannot be silently carried through recovery; explicit mode ruling required" });
    }
    if (authorityIsObject && typeof authorityRaw.mode === "string" && authorityRaw.mode.length > 0) {
      offlineMode = { value: authorityRaw.mode, source: "authority.field" };
    } else {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "authority.offline_mode", operationId, message: "no verifiable mode evidence for the offline rebuild; failing closed (recovery must not switch mode silently)" });
    }
  }
  return { authority, authorityIsObject, hw, corrupt, state, immutableState, baseRecordRevision, baseStateRevision, baseStateHash, baseStateUuid, offlineEpoch, offlineMode };
}

function mkSource({ projectDir, stateUuid, revision, hash, kind, operationRef, candidatePath, resumeOperation, gaps, audit }) {
  const src = { projectDir, stateUuid, revision, hash, kind };
  if (operationRef !== undefined) src.operationRef = operationRef;
  if (candidatePath !== undefined) src.candidatePath = candidatePath;
  if (resumeOperation !== undefined) src.resumeOperation = resumeOperation;
  src.gaps = Array.isArray(gaps) ? gaps : [];
  src.audit = audit ?? { baseRecordRevision: null, baseStateRevision: null };
  return src;
}

// ---- recoverScan: read-only classification of the recovery surface
export async function recoverScan(params) {
  assertObjectKeys(params, ["projectDir"], ["projectDir"], "recoverScan.args", null);
  if (typeof params.projectDir !== "string" || params.projectDir.length === 0) {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage: "recoverScan.args", operationId: null, message: "projectDir must be a non-empty string" });
  }
  traceMark("layer.scan");
  const projectDir = params.projectDir;
  const mini = await scanMini(projectDir);
  const reasons = [];
  const candidates = [];
  const orphans = [];
  const bases = { baseRecordRevision: mini.baseRecordRevision, baseStateRevision: mini.baseStateRevision };

  const finish = (forced) => {
    const blocked = reasons.some((r) => r.blocked === true);
    const status = blocked ? "blocked" : (candidates.length > 0 || reasons.length > 0 ? "recoverable" : "ok");
    return { status: forced ?? status, candidates, orphans, reasons, ...bases };
  };

  if (mini.corrupt) {
    reasons.push({ code: "authority_corrupt", blocked: false, expected: { current_hash: "match immutable revision" }, actual: { current_hash: mini.authority.current_hash }, detail: "authority anchor damage; offline rebuild only" });
    candidates.push(mkSource({
      projectDir, stateUuid: mini.authority.state_uuid, revision: mini.baseStateRevision, hash: mini.baseStateHash,
      kind: "authority_offline_rebuild", gaps: ["authority_corrupt_rebuild"],
      audit: { baseRecordRevision: mini.baseRecordRevision, baseStateRevision: mini.baseStateRevision },
    }));
    return finish("recoverable");
  }

  const authority = mini.authority;
  const state = mini.state;

  // lineage walk to genesis (cross state_uuid boundary allowed, matching the reader contract)
  {
    let cursor = state;
    let ok = true;
    for (let i = 0; i < 512 && cursor; i += 1) {
      if (cursor.revision === 0) {
        if (cursor.parent_hash !== GENESIS_PARENT_HASH || cursor.parent_revision !== 0) ok = false;
        break;
      }
      if (cursor.parent_revision !== cursor.revision - 1) { ok = false; break; }
      const parentFile = revisionFilePath(projectDir, authority.state_uuid, cursor.parent_revision);
      let parent = null;
      try {
        parent = JSON.parse(await fsp.readFile(parentFile, "utf-8"));
      } catch { parent = null; }
      if (!parent || parent.self_hash !== cursor.parent_hash || computeSelfHash(parent) !== parent.self_hash) {
        // cross-uuid lineage (post-rebase): search other state dirs for the matching parent
        let found = null;
        const stateBase = path.join(runtimeDir(projectDir), "state");
        if (fs.existsSync(stateBase)) {
          for (const dir of fs.readdirSync(stateBase)) {
            const alt = revisionFilePath(projectDir, dir, cursor.parent_revision);
            try {
              const altRev = JSON.parse(await fsp.readFile(alt, "utf-8"));
              if (altRev.self_hash === cursor.parent_hash && computeSelfHash(altRev) === altRev.self_hash) { found = altRev; break; }
            } catch (error) {
              if (error.code === "ENOENT") continue;
              throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "lineage.load", operationId: null, message: "cross-uuid parent read failed: " + String(error.message ?? error) });
            }
          }
        }
        if (!found) { ok = false; break; }
        cursor = found;
        continue;
      }
      cursor = parent;
    }
    if (!ok) {
      reasons.push({ code: "lineage_broken", blocked: true, expected: { lineage: "genesis reachable, parent hashes chained" }, actual: { at: "revision " + (cursor ? cursor.revision : "?") }, detail: "parent lineage broken" });
      return finish();
    }
  }

  // journal load (hash closure enforced; mismatch => blocked fail-closed); 族四: 缺失+非 genesis 锚 blocked
  const journalPresent = await layerLoadJournal(projectDir);
  if (journalPresent === null && journalMissingBlocked(authority).blocked) {
    reasons.push({ code: "journal_missing_anchor", blocked: true, expected: { journal: "present or genesis anchor" }, actual: { journal_generation: String(authority.journal_generation), journal_head_hash: authority.journal_head_hash }, detail: "journal absent while authority anchor is non-genesis (docs/14:155)" });
    return finish();
  }

  // journal/authority anchors; 族一: lag===1 且 entries 为空时 tail 解引用前先判空
  if (journalPresent) {
    if (authority.journal_head_hash !== journalPresent.headHash || authority.journal_generation !== journalPresent.generation) {
      const lag = journalPresent.generation - authority.journal_generation;
      if (lag === 1 && journalPresent.entries.length > 0) {
        const tail = journalPresent.entries[journalPresent.entries.length - 1];
        reasons.push({ code: "anchor_catchup", blocked: false, expected: { journal_head_hash: journalPresent.headHash }, actual: { journal_head_hash: authority.journal_head_hash }, detail: "authority anchor exactly one generation behind; original operation may verify-and-catch-up" });
        candidates.push(mkSource({
          projectDir, stateUuid: authority.state_uuid, revision: state.revision, hash: state.self_hash,
          kind: "anchor_catchup", operationRef: { operationId: tail.operationId, kind: "anchor_catchup" },
          audit: bases,
        }));
      } else {
        reasons.push({ code: "anchor_fork", blocked: true, expected: { generation: String(journalPresent.generation) }, actual: { generation: String(authority.journal_generation), entries: String(journalPresent.entries.length) }, detail: "journal/authority anchor divergence beyond one generation or empty-tail catch-up" });
        return finish();
      }
    }
  }

  // unexpected descendants / forks in the current state dir
  const sdir = stateDir(projectDir, authority.state_uuid);
  const descendants = [];
  if (fs.existsSync(sdir)) {
    for (const f of fs.readdirSync(sdir)) {
      const m = /^r-(\d+)\.json$/.exec(f);
      if (!m) continue;
      const n = Number(m[1]);
      if (n > authority.current_revision + 1) descendants.push(n);
    }
  }

  // journal-state reconciliation first: journal-derived continuations reserve the orphan slot
  const reserved = new Set();
  if (journalPresent) {
    // multiple active cutover/recovery entries are blocked, listing the operationIds (R10)
    const activeEntries = (journalPresent.entries ?? []).filter((e) => FROZEN_JOURNAL_STATES.has(e.status) || (e.status === "abandoned" && !e.resumeRef));
    if (activeEntries.length > 1) {
      reasons.push({ code: "multiple_active_journal", blocked: true, expected: { active: "at most 1" }, actual: { active: String(activeEntries.length), operationIds: activeEntries.map((e) => e.operationId).join(",") }, detail: "project allows at most one active cutover/recovery" });
      return finish();
    }
    // preparing/prepared: the fixed candidate envelope must verify at the recorded path when it
    // exists; preparing tolerates a crash before the write (rebuild is the recovery), prepared
    // requires the envelope on disk (R9/R12)
    for (const entry of journalPresent.entries ?? []) {
      if ((entry.status === "preparing" || entry.status === "prepared") && entry.candidatePath) {
        // 族五: journal 采信的 candidatePath 必须落在 runtime/candidates 内 (越界即 blocked,
        // 不待 build 时才拒, 更不得在项目外创建)
        const candRootAny = candidatesDir(projectDir);
        // B-2: 含 '..' 即 blocked —— 词法折叠后再 realpath 的两段式可被中间段符号链接绕过
        if (entry.candidatePath.includes("..")) {
          reasons.push({ code: "candidate_path_escape", blocked: true, operationId: entry.operationId, expected: { candidatePath: "no '..' segments" }, actual: { candidatePath: entry.candidatePath }, detail: "journal-recorded candidatePath contains '..' (lexical-fold bypass)" });
          return finish();
        }
        let insideAny = path.resolve(entry.candidatePath).startsWith(candRootAny + path.sep);
        if (insideAny) {
          // B-5: 存在→realpath 包含；缺失→最深现存祖先 realpath 包含（guardTempRoot 同法）；
          // 符号链接造成的越界在 scan 面即拒（不待 build）
          const resolved0 = path.resolve(entry.candidatePath);
          const targets = [];
          if (fs.existsSync(resolved0)) {
            targets.push(resolved0);
          } else {
            // deepest EXISTING ancestor strictly inside the candidates root (never climb above
            // the root: a missing root itself cannot validate or invalidate containment)
            let probe = path.dirname(resolved0);
            for (let gi = 0; gi < 8; gi += 1) {
              if (probe === candRootAny || !probe.startsWith(candRootAny + path.sep)) break;
              if (fs.existsSync(probe)) { targets.push(probe); break; }
              probe = path.dirname(probe);
            }
            if (targets.length === 0 && fs.existsSync(candRootAny)) targets.push(candRootAny);
          }
          if (targets.length > 0) {
            try {
              const rrA = await fsp.realpath(candRootAny);
              for (const t of targets) {
                const rpA = await fsp.realpath(t);
                if (rpA !== rrA && !rpA.startsWith(rrA + path.sep)) { insideAny = false; break; }
              }
            } catch { insideAny = false; }
          }
        }
        if (!insideAny) {
          reasons.push({ code: "candidate_path_escape", blocked: true, operationId: entry.operationId, expected: { candidatePath: "inside runtime/candidates" }, actual: { candidatePath: entry.candidatePath }, detail: "journal-recorded candidatePath escapes the candidates dir" });
          return finish();
        }
        let env = null;
        let absent = false;
        try {
          env = JSON.parse(await fsp.readFile(entry.candidatePath, "utf-8"));
        } catch (error) {
          if (error.code === "ENOENT") absent = true;
          else throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "journal.candidate.load", operationId: entry.operationId, message: "candidate envelope read failed: " + String(error.message ?? error) });
        }
        const envOk = !!env && !!env.state && computeSelfHash(env.state) === env.state.self_hash && env.state.self_hash === entry.candidateRef.hash;
        if ((!envOk && !absent) || (entry.status === "prepared" && absent)) {
          reasons.push({ code: "journal_candidate_mismatch", blocked: true, operationId: entry.operationId, expected: { candidateHash: entry.candidateRef.hash }, actual: { candidatePath: entry.candidatePath, absent }, detail: "fixed candidatePath envelope does not reconcile with the journal candidateRef" });
          return finish();
        }
      }
    }
    for (const entry of journalPresent.entries ?? []) {
      if (entry.status === "stopping") {
        reasons.push({ code: "journal_state_stopping", blocked: false, operationId: entry.operationId, expected: { status: "terminal" }, actual: { status: entry.status }, detail: "stop continuation bound to the original stopRef only" });
        candidates.push(mkSource({
          projectDir, stateUuid: authority.state_uuid, revision: entry.stopRef.parentRevision, hash: entry.stopRef.parentHash,
          kind: "prepare_continue", operationRef: entry.stopRef, gaps: [], audit: bases,
        }));
      } else if (entry.status === "preparing" || entry.status === "prepared") {
        reasons.push({ code: "journal_state_" + entry.status, blocked: false, operationId: entry.operationId, expected: { status: "terminal" }, actual: { status: entry.status }, detail: "rebuild/continue at the fixed candidatePath with G1a-fixed values" });
        candidates.push(mkSource({
          projectDir, stateUuid: authority.state_uuid, revision: entry.stopRef.revision, hash: entry.stopRef.hash,
          kind: "candidate_rebuild", operationRef: entry.candidateRef, candidatePath: entry.candidatePath, gaps: [], audit: bases,
        }));
      } else if (entry.status === "confirming") {
        reasons.push({ code: "journal_state_confirming", blocked: false, operationId: entry.operationId, expected: { status: "terminal" }, actual: { status: entry.status }, detail: "only the original candidateRef may confirm" });
        candidates.push(mkSource({
          projectDir, stateUuid: authority.state_uuid, revision: entry.stopRef.revision, hash: entry.stopRef.hash,
          kind: "confirm_only", operationRef: entry.candidateRef, candidatePath: entry.candidatePath, gaps: [], audit: bases,
        }));
      } else if (entry.status === "recovering") {
        reasons.push({ code: "journal_state_recovering", blocked: false, operationId: entry.operationId, expected: { status: "terminal" }, actual: { status: entry.status }, detail: "retry continues the same recoveryRef only" });
        candidates.push(mkSource({
          projectDir, stateUuid: authority.state_uuid, revision: entry.recoveryRef.parentRevision, hash: entry.recoveryRef.parentHash,
          kind: "recovery_continue", operationRef: entry.recoveryRef, gaps: [], audit: bases,
        }));
      } else if (entry.status === "abandoned" && entry.resumeRef) {
        // a forged resumeRef must not silently deactivate the entry: verify the recorded
        // resumeOperation exists and its revision actually landed with a matching content hash
        let landed = false;
        if (entry.resumeOperation && Number.isInteger(entry.resumeOperation.revision)) {
          const rf = revisionFilePath(projectDir, authority.state_uuid, entry.resumeOperation.revision);
          if (fs.existsSync(rf)) {
            const rd = await readJsonFile(rf, "journal.resume_ref", entry.operationId);
            landed = computeSelfHash(rd) === rd.self_hash && rd.self_hash === entry.resumeOperation.hash;
          }
        }
        if (!landed) {
          reasons.push({ code: "resume_ref_unverified", blocked: true, operationId: entry.operationId, expected: { resumeRef: "landed revision with matching hash" }, actual: { resumeRef: entry.resumeRef }, detail: "abandoned entry carries a resumeRef whose resumeOperation revision is not landed/verified" });
          return finish();
        }
      } else if (entry.status === "abandoned" && !entry.resumeRef) {
        const resumeRev = entry.resumeOperation?.revision;
        const resumeFile = Number.isInteger(resumeRev) ? revisionFilePath(projectDir, authority.state_uuid, resumeRev) : null;
        if (resumeFile && fs.existsSync(resumeFile)) {
          const resumeDoc = await readJsonFile(resumeFile, "journal.resume", entry.operationId);
          const resumeVerified = computeSelfHash(resumeDoc) === resumeDoc.self_hash && resumeDoc.self_hash === entry.resumeOperation.hash;
          if (resumeRev === authority.current_revision + 1 && resumeVerified) {
            reserved.add(resumeRev);
            reasons.push({ code: "journal_state_abandoned", blocked: false, operationId: entry.operationId, expected: { status: "terminal" }, actual: { status: entry.status }, detail: "resume revision exists; continue highwater/authority/resumeRef only" });
            candidates.push(mkSource({
              projectDir, stateUuid: authority.state_uuid, revision: entry.resumeOperation.parentRevision, hash: entry.resumeOperation.parentHash,
              kind: "resume_complete", operationRef: entry.resumeOperation, gaps: [], audit: bases,
            }));
          } else {
            reasons.push({ code: "illegal_resume_base", blocked: true, operationId: entry.operationId, expected: { resume_revision: "current+1" }, actual: { resume_revision: String(resumeRev) }, detail: "resume revision beyond the orphan slot" });
            return finish();
          }
        } else {
          const stopFile = revisionFilePath(projectDir, authority.state_uuid, entry.stopRef.revision);
          let stopDoc = null;
          if (fs.existsSync(stopFile)) {
            stopDoc = await readJsonFile(stopFile, "journal.stop", entry.operationId);
          }
          const stopVerified = !!stopDoc && computeSelfHash(stopDoc) === stopDoc.self_hash && stopDoc.self_hash === entry.stopRef.hash;
          if (stopDoc) {
            if (entry.stopRef.revision === authority.current_revision + 1 && stopVerified) {
              reserved.add(entry.stopRef.revision);
              reasons.push({ code: "journal_state_abandoned", blocked: false, operationId: entry.operationId, expected: { status: "terminal" }, actual: { status: entry.status }, detail: "stop orphan present; claim by stopRef only" });
              orphans.push({
                operationId: entry.stopRef.operationId, path: stopFile, hash: entry.stopRef.hash,
                expected: { parent_revision: entry.stopRef.parentRevision, parent_hash: entry.stopRef.parentHash },
                actual: { revision: String(entry.stopRef.revision) },
                reason: "unique_claimable",
              });
              candidates.push(mkSource({
                projectDir, stateUuid: authority.state_uuid, revision: entry.stopRef.parentRevision, hash: entry.stopRef.parentHash,
                kind: "stop_claim", operationRef: entry.stopRef, gaps: [], audit: bases,
              }));
            } else {
              reasons.push({ code: "illegal_resume_base", blocked: true, operationId: entry.operationId, expected: { stop_revision: "current+1" }, actual: { stop_revision: String(entry.stopRef.revision) }, detail: "stop revision not in the orphan slot" });
              return finish();
            }
          } else if (state.revision === entry.stopRef.parentRevision) {
            reasons.push({ code: "journal_state_abandoned", blocked: false, operationId: entry.operationId, expected: { status: "terminal" }, actual: { status: entry.status }, detail: "stop uncommitted; resume base is the prepare parent" });
            candidates.push(mkSource({
              projectDir, stateUuid: authority.state_uuid, revision: state.revision, hash: state.self_hash,
              kind: "resume_from_parent",
              resumeOperation: {
                operationId: entry.resumeOperation.operationId, kind: "resume",
                parentRevision: state.revision, parentHash: state.self_hash,
                revision: state.revision + 1, hash: "", epoch: authority.epoch,
                stopEpoch: state.authorization.stop_epoch + 1,
              },
              gaps: [], audit: bases,
            }));
          } else {
            reasons.push({ code: "illegal_resume_base", blocked: true, operationId: entry.operationId, expected: { current: "prepare parent or stopRef" }, actual: { current: String(state.revision) }, detail: "candidate or other unexpected descendant as resume base" });
            return finish();
          }
        }
      }
    }
  }


  // highwater above authority (classified first: the pending-publish revision is the precise
  // continuation source and never doubles as a claimable orphan — ambiguous objects stay single-faced)
  const hwEntry = mini.hw[authority.state_uuid];
  let hwAbove = false;
  if (hwEntry && Number.isInteger(hwEntry.current_revision) && hwEntry.current_revision > authority.current_revision) {
    const file = revisionFilePath(projectDir, authority.state_uuid, hwEntry.current_revision);
    let doc = null;
    let missing = false;
    try {
      doc = await readJsonFile(file, "highwater_revision");
    } catch (error) {
      if (error.code === "io_load_failed" && /ENOENT/.test(error.message)) missing = true;
      else throw error;
    }
    const docVerified = !!doc && computeSelfHash(doc) === doc.self_hash && doc.self_hash === hwEntry.current_hash;
    if (!docVerified) {
      reasons.push({ code: "highwater_orphan_broken", blocked: true, expected: { current_hash: hwEntry.current_hash }, actual: { current_hash: doc ? doc.self_hash : (missing ? "missing" : "unverifiable"), recomputed: doc ? computeSelfHash(doc) : null }, detail: "highwater above authority but the referenced revision fails content-hash recompute" });
      return finish();
    }
    if (doc.parent_revision !== state.revision || doc.parent_hash !== state.self_hash) {
      reasons.push({ code: "highwater_parent_anchor_mismatch", blocked: true, expected: { parent_revision: String(state.revision), parent_hash: state.self_hash }, actual: { parent_revision: String(doc.parent_revision), parent_hash: doc.parent_hash }, detail: "pending-publish revision parent anchors do not reconcile with current" });
      return finish();
    }
    const opId = doc.producer_operation?.operationId ?? findAppliedInList(doc.applied_operations ?? [], lastOpIdOf(doc.applied_operations))?.operationId ?? "unknown";
    hwAbove = true;
    reasons.push({ code: "highwater_above_authority", blocked: false, expected: { current_revision: String(authority.current_revision) }, actual: { current_revision: String(hwEntry.current_revision) }, operationId: opId, detail: "publish incomplete; only the precise operation may continue" });
    candidates.push(mkSource({
      projectDir, stateUuid: authority.state_uuid, revision: doc.revision, hash: doc.self_hash,
      kind: "publish_continue", operationRef: { operationId: opId, kind: "publish_continue", revision: doc.revision, hash: doc.self_hash },
      gaps: [], audit: bases,
    }));
  }

  // orphan r-(current+1); skipped when the slot is the pending highwater continuation
  let orphan = null;
  const orphanRev = authority.current_revision + 1;
  const orphanFile = revisionFilePath(projectDir, authority.state_uuid, orphanRev);
  if (fs.existsSync(orphanFile) && !(hwAbove && hwEntry && hwEntry.current_revision === orphanRev) && !reserved.has(orphanRev)) {
    orphan = await readJsonFile(orphanFile, "orphan"); // io/parse failures propagate as exit 3
  }
  if (orphan !== null && (typeof orphan !== "object" || computeSelfHash(orphan) !== orphan.self_hash)) {
    reasons.push({ code: "duplicate_or_wrong_orphan", blocked: true, expected: { self_hash: "content recompute equal" }, actual: { self_hash: orphan?.self_hash ?? "none" }, detail: "orphan revision fails content-hash recompute" });
    return finish();
  }
  const appliedOpIds = (opId) => {
    const ids = new Set();
    for (const entry of orphan?.applied_operations ?? []) {
      const d = decodeAppliedLast(entry);
      if (d) ids.add(d.operationId);
    }
    return ids;
  };
  function lastOpIdOf(list) {
    if (!Array.isArray(list) || list.length === 0) return ":";
    const d = decodeAppliedLast(list[list.length - 1]);
    return d ? d.operationId : ":";
  }
  if (orphan && Array.isArray(orphan.applied_operations)) {
    let wrong = false;
    // parent anchors must reconcile exactly with the current state (R8)
    if (orphan.parent_revision !== state.revision || orphan.parent_hash !== state.self_hash) wrong = true;
    // applied marker integrity: recorded commit hash must recompute
    for (const entry of orphan.applied_operations) {
      const d = decodeAppliedLast(entry);
      if (d && d.hash !== sha256hex(d.operationId + ":" + d.requestHash)) wrong = true;
    }
    // producer_operation cross-check when present
    const po = orphan.producer_operation;
    if (po && typeof po === "object") {
      if ((po.kind !== "cutover_stop" && po.kind !== "resume") || po.parentRevision !== orphan.parent_revision || po.revision !== orphan.revision
        || po.epoch !== authority.epoch || po.stopEpoch !== state.authorization.stop_epoch + 1) wrong = true;
    }
    // duplicate operationId across other unpublished descendants
    const opIds = appliedOpIds();
    for (const n of descendants) {
      try {
        const doc = JSON.parse(await fsp.readFile(revisionFilePath(projectDir, authority.state_uuid, n), "utf-8"));
        for (const entry of doc.applied_operations ?? []) {
          const d = decodeAppliedLast(entry);
          if (d && opIds.has(d.operationId)) wrong = true;
        }
      } catch { /* fork file unreadable => fork below */ }
    }
    if (wrong) {
      reasons.push({ code: "duplicate_or_wrong_orphan", blocked: true, expected: { orphan: "marker/producer fields reconcile" }, actual: { orphan: "r-" + orphanRev }, detail: "orphan operationRef/marker mismatch" });
      return finish();
    }
    const lastMarker = decodeAppliedLast(orphan.applied_operations[orphan.applied_operations.length - 1]);
    const opId = orphan.producer_operation?.operationId ?? (lastMarker ? lastMarker.operationId : "unknown");
    orphans.push({
      operationId: opId, path: orphanFile, hash: orphan.self_hash,
      expected: { parent_revision: state.revision, parent_hash: state.self_hash },
      actual: { parent_revision: orphan.parent_revision, parent_hash: orphan.parent_hash, self_hash: orphan.self_hash },
      reason: "unique_claimable",
    });
    candidates.push(mkSource({
      projectDir, stateUuid: authority.state_uuid, revision: orphan.revision, hash: orphan.self_hash,
      kind: "orphan_claim", operationRef: po ? { ...po } : { operationId: opId, kind: "orphan_replay" },
      gaps: [], audit: bases,
    }));
  }

  // forks after orphan accounting
  if (descendants.length >= 2) {
    reasons.push({ code: "fork_blocked", blocked: true, expected: { descendants: "none beyond current+1" }, actual: { descendants: descendants.join(",") }, detail: "multiple unexplained forks; no auto-selection of any branch" });
    return finish();
  }
  if (descendants.length === 1) {
    reasons.push({ code: "unexpected_descendant", blocked: true, expected: { descendants: "none beyond current+1" }, actual: { descendants: String(descendants[0]) }, detail: "unexpected descendant revision on disk; no latest-branch selection" });
    return finish();
  }

  // healthy surface: current + verified historical sources
  candidates.push(mkSource({
    projectDir, stateUuid: authority.state_uuid, revision: state.revision, hash: state.self_hash,
    kind: "current_source", gaps: [], audit: bases,
  }));
  {
    let cursor = state;
    let added = 0;
    for (let i = 0; i < 10 && cursor && cursor.revision > 0 && added < 8; i += 1) {
      const parentFile = revisionFilePath(projectDir, authority.state_uuid, cursor.parent_revision);
      let parent = null;
      try { parent = JSON.parse(await fsp.readFile(parentFile, "utf-8")); } catch { parent = null; }
      if (!parent || parent.self_hash !== cursor.parent_hash) break;
      candidates.push(mkSource({
        projectDir, stateUuid: authority.state_uuid, revision: parent.revision, hash: parent.self_hash,
        kind: "historical_source", gaps: ["historical_evidence_only"], audit: bases,
      }));
      added += 1;
      cursor = parent;
    }
  }
  return finish();
}

const SOURCE_REVISION_KEYS = ["projectDir", "stateUuid", "revision", "hash", "kind", "operationRef", "candidatePath", "resumeOperation", "gaps", "audit"];

// ---- buildCandidate: evidence-only candidate from a scan-verified source
const SCAN_SOURCE_KINDS = new Set([
  "current_source", "historical_source", "authority_offline_rebuild", "publish_continue", "orphan_claim",
  "prepare_continue", "candidate_rebuild", "confirm_only", "recovery_continue", "resume_complete", "stop_claim",
  "resume_from_parent", "anchor_catchup",
]);
// cross-uuid tolerant parent verification (post-rebase lineage lives in another state dir)
async function verifySourceLineage(projectDir, stateUuid, doc) {
  let cursor = doc;
  for (let i = 0; i < 512 && cursor.revision > 0; i += 1) {
    if (cursor.parent_revision !== cursor.revision - 1) return { ok: false };
    if (cursor.revision === 0) break;
    const pf = revisionFilePath(projectDir, stateUuid, cursor.parent_revision);
    let parent = null;
    try {
      parent = JSON.parse(await fsp.readFile(pf, "utf-8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "candidate.lineage.load", operationId: null, message: "parent revision read failed: " + String(error.message ?? error) });
    }
    if (!parent || parent.self_hash !== cursor.parent_hash || computeSelfHash(parent) !== parent.self_hash) {
      // cross-uuid search
      let found = null;
      const stateBase = path.join(runtimeDir(projectDir), "state");
      if (fs.existsSync(stateBase)) {
        for (const dir of fs.readdirSync(stateBase)) {
          const alt = revisionFilePath(projectDir, dir, cursor.parent_revision);
          try {
            const altRev = JSON.parse(await fsp.readFile(alt, "utf-8"));
            if (altRev.self_hash === cursor.parent_hash && computeSelfHash(altRev) === altRev.self_hash) { found = altRev; break; }
          } catch { /* continue */ }
        }
      }
      if (!found) return { ok: false };
      cursor = found;
      continue;
    }
    cursor = parent;
  }
  if (cursor.revision === 0 && cursor.parent_hash !== GENESIS_PARENT_HASH) return { ok: false };
  return { ok: true };
}

export async function buildCandidate(params) {
  if (params && params.overridePath !== undefined) {
    // harness-only self-hunt hook: validated as an escape attempt (never a real write path)
    const p = params.overridePath;
    if (p.includes("..")) {
      throw new RunStoreError({ code: "candidate_ref_escape", exitCode: 1, stage: "buildCandidate.path", operationId: null, message: "candidatePath contains '..' segments; denied at build time (lexical-fold bypass)" });
    }
  }
  assertObjectKeys(params, ["sourceRevision"], ["sourceRevision"], "buildCandidate.args", null);
  const src = params.sourceRevision;
  assertObjectKeys(src, SOURCE_REVISION_KEYS, ["projectDir", "stateUuid", "revision", "hash", "kind"], "buildCandidate.sourceRevision", null);
  if (typeof src.projectDir !== "string" || typeof src.stateUuid !== "string" || !Number.isInteger(src.revision) || src.revision < 0 || !HEX64.test(src.hash ?? "") || typeof src.kind !== "string") {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage: "buildCandidate.sourceRevision", operationId: null, message: "sourceRevision fields must be typed exactly (projectDir/stateUuid strings, revision integer, hash 64-hex, kind string)" });
  }
  // R7: only kinds producible by recoverScan are accepted at all
  if (!SCAN_SOURCE_KINDS.has(src.kind)) {
    throw new RunStoreError({ code: "invalid_source", exitCode: 1, stage: "buildCandidate.kind", operationId: null, message: "sourceRevision.kind not in the recoverScan-producible closed set: " + src.kind });
  }
  traceMark("layer.candidate");
  const projectDir = src.projectDir;
  const file = revisionFilePath(projectDir, src.stateUuid, src.revision);
  let check;
  try {
    check = await validateRevision({ revisionPath: file });
  } catch (error) {
    // run-state validateRevision raises io exit 3 when the PARENT file is missing; after a rebase
    // the parent legitimately lives in another state dir -> cross-uuid verification (R13)
    if (error.code === "io_load_failed" && /parent_load/.test(error.stage ?? "")) {
      const doc0 = await readJsonFile(file, "candidate.source", null);
      const lineage = await verifySourceLineage(projectDir, src.stateUuid, doc0);
      if (lineage.ok && computeSelfHash(doc0) === doc0.self_hash && doc0.self_hash === src.hash) {
        check = { valid: true, selfHash: doc0.self_hash, parentHash: doc0.parent_hash };
      } else {
        throw new RunStoreError({ code: "source_unverified", exitCode: 1, stage: "buildCandidate.source", operationId: null, message: "sourceRevision lineage does not reconcile (cross-uuid search exhausted)" });
      }
    } else {
      throw error;
    }
  }
  if (!check || check.valid !== true || check.selfHash !== src.hash) {
    throw new RunStoreError({ code: "source_unverified", exitCode: 1, stage: "buildCandidate.source", operationId: null, message: "sourceRevision does not reconcile with the immutable revision on disk" });
  }
  const doc = JSON.parse(await fsp.readFile(file, "utf-8"));
  // freshness by kind (healthy path uses readCurrent for the lineage-verified latest)
  const mini = await scanMini(projectDir);
  let latest;
  if (mini.corrupt) {
    latest = mini.baseStateRevision;
  } else {
    const cur = await readCurrent({ projectDir });
    latest = cur.state.revision;
  }
  if ((src.kind === "current_source" || src.kind === "authority_offline_rebuild") && src.revision !== latest) {
    throw new RunStoreError({ code: "stale_source", exitCode: 1, stage: "buildCandidate.freshness", operationId: null, message: "source kind " + src.kind + " must reference the latest verifiable revision " + latest });
  }
  if (src.kind === "historical_source" && src.revision >= latest) {
    throw new RunStoreError({ code: "stale_source", exitCode: 1, stage: "buildCandidate.freshness", operationId: null, message: "historical source must reference a verified ancestor revision" });
  }
  // R7: the source must match an actual recoverScan candidate item-by-item (no fabricated sources)
  const scan = await recoverScan({ projectDir });
  const matchesScan = scan.candidates.some((c) => {
    if (c.kind !== src.kind || c.projectDir !== src.projectDir || c.stateUuid !== src.stateUuid) return false;
    if (c.revision !== src.revision || c.hash !== src.hash) return false;
    const a = JSON.stringify(c.operationRef ?? null) === JSON.stringify(src.operationRef ?? null);
    const b = JSON.stringify(c.resumeOperation ?? null) === JSON.stringify(src.resumeOperation ?? null);
    const d = (c.candidatePath ?? null) === (src.candidatePath ?? null);
    const e = JSON.stringify(c.gaps ?? []) === JSON.stringify(src.gaps ?? []);
    return a && b && d && e;
  });
  if (!matchesScan) {
    throw new RunStoreError({ code: "invalid_source", exitCode: 1, stage: "buildCandidate.scan_match", operationId: null, message: "sourceRevision does not match any candidate of a fresh recoverScan (closed-set match failed)" });
  }
  // construct the evidence candidate Revision
  const cand = structuredClone(doc);
  cand.parent_revision = doc.revision;
  cand.parent_hash = doc.self_hash;
  cand.revision = doc.revision + 1;
  if (src.operationRef && typeof src.operationRef === "object" && src.operationRef.kind === "confirm") {
    // journal-recorded candidate rebuild: reproduce the recorded ref hash exactly (R12 three-way)
    cand.authorization.stop_epoch = src.operationRef.stopEpoch ?? cand.authorization.stop_epoch;
    cand.producer_operation = { ...src.operationRef };
    cand.self_hash = computeSelfHash(cand);
    cand.producer_operation.hash = cand.self_hash;
    if (src.operationRef.hash && cand.self_hash !== src.operationRef.hash) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "buildCandidate.rebuild_drift", operationId: null, message: "candidate rebuild drifted from the journal-recorded candidateRef hash" });
    }
  } else {
    delete cand.producer_operation;
    cand.self_hash = computeSelfHash(cand);
  }
  const gaps = Array.isArray(src.gaps) ? [...src.gaps] : [];
  // R12: journal-fixed candidatePath is authoritative for preparing/prepared rebuilds
  const candPath = src.kind === "candidate_rebuild" && src.candidatePath
    ? src.candidatePath
    : path.join(recoverCandidatesDir(projectDir), src.stateUuid + "-r" + src.revision + "-" + src.kind + ".json");
  // B-5/族五: build 面同边界 — 词法 + 最深现存祖先 realpath（缺文件同法）+ 写前复核
  async function assertCandidateInside(rootDir, target) {
    if (target.includes("..")) {
      throw new RunStoreError({ code: "candidate_ref_escape", exitCode: 1, stage: "buildCandidate.path", operationId: null, message: "candidatePath contains '..' segments; denied at build time (lexical-fold bypass)" });
    }
    if (!path.resolve(target).startsWith(rootDir + path.sep)) {
      throw new RunStoreError({ code: "candidate_ref_escape", exitCode: 1, stage: "buildCandidate.path", operationId: null, message: "candidatePath escapes runtime/candidates; denied at build time" });
    }
    const resolvedT = path.resolve(target);
    const targets = [];
    if (fs.existsSync(resolvedT)) {
      targets.push(resolvedT);
    } else {
      let probe = path.dirname(resolvedT);
      for (let gi = 0; gi < 8; gi += 1) {
        if (probe === rootDir || !probe.startsWith(rootDir + path.sep)) break;
        if (fs.existsSync(probe)) { targets.push(probe); break; }
        probe = path.dirname(probe);
      }
      if (targets.length === 0 && fs.existsSync(rootDir)) targets.push(rootDir);
    }
    if (targets.length > 0) {
      let rr;
      try { rr = await fsp.realpath(rootDir); } catch { rr = rootDir; }
      for (const t of targets) {
        const rp = await fsp.realpath(t);
        if (rp !== rr && !rp.startsWith(rr + path.sep)) {
          throw new RunStoreError({ code: "candidate_ref_escape", exitCode: 1, stage: "buildCandidate.path", operationId: null, message: "candidatePath resolves outside runtime/candidates (symlink or missing-ancestor escape); denied at build time" });
        }
      }
    }
  }
  await assertCandidateInside(candidatesDir(projectDir), candPath);
  const envelope = {
    schema: "run-recover-candidate/v1",
    candidatePath: candPath,
    candidateHash: cand.self_hash,
    candidateRef: {
      kind: "recovery_candidate", operationId: "candidate:r" + src.revision,
      parentRevision: doc.revision, parentHash: doc.self_hash,
      revision: cand.revision, hash: cand.self_hash,
    },
    state: cand,
    gaps,
    source: { kind: src.kind, revision: src.revision, hash: src.hash, stateUuid: src.stateUuid },
  };
  {
    const shapeB = revisionNestedShapeOk(cand);
    if (!shapeB.ok) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "buildCandidate.shape", operationId: null, message: "constructed candidate nested shape invalid at " + shapeB.where + " (run-state.schema required keys)" });
    }
  }
  faultGuard("candidate_read", "candidate.write", null);
  await fsp.mkdir(path.dirname(candPath), { recursive: true });
  traceMark("run_state.atomicWrite");
  await atomicWrite(candPath, canonicalJSON(envelope), {});
  traceMark("layer.candidate.write");
  // pre-placed evidence artifact (rooted evidence only; caller cannot supply one)
  const evidenceRef = "cand-ev-r" + src.revision + "-" + src.kind + ".json";
  const evDoc = { schema: "recovery-candidate-evidence/v1", kind: "recovery-candidate-evidence", candidatePath: candPath, candidateHash: cand.self_hash, gaps };
  evDoc.evidenceHash = sha256hex(canonicalJSON(evDoc));
  await fsp.writeFile(path.join(approvalsDir(projectDir), evidenceRef), JSON.stringify(evDoc, null, 1), "utf-8");
  const indexFile = path.join(approvalsDir(projectDir), CANDIDATE_INDEX);
  let index = { schema: "recover-candidate-index/v1", entries: [] };
  try {
    const doc = JSON.parse(await fsp.readFile(indexFile, "utf-8"));
    if (!isPlainObject(doc) || !Array.isArray(doc.entries)) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "candidate_index.corrupt", operationId: null, message: "candidate index content is not a mapping with entries; failing closed" });
    }
    index = doc;
  } catch (error) {
    if (error instanceof RunStoreError) throw error;
    if (error.code !== "ENOENT") throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "candidate_index.load", operationId: null, message: "candidate index read failed: " + String(error.message ?? error) });
  }
  index.entries = (index.entries ?? []).filter((e) => e.candidatePath !== candPath);
  index.entries.push({ candidatePath: candPath, candidateHash: cand.self_hash, evidenceRef });
  await atomicWrite(indexFile, canonicalJSON(index), {});
  return { candidatePath: candPath, candidateHash: cand.self_hash, gaps };
}

const APPLY_KEYS = ["candidatePath", "candidateHash", "principal", "callerSessionId", "approvalRef", "approvalHash", "controllerDescriptor", "expectedRevision", "operationId"];
const APPLY_REQUIRED = ["candidatePath", "candidateHash", "principal", "approvalRef", "approvalHash", "expectedRevision", "operationId"];

function assertApplyScalars(params, stage) {
  const opId = params.operationId ?? null;
  if (typeof params.operationId !== "string" || params.operationId.length === 0) {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage: stage + ".args", operationId: null, message: "opId must be a non-empty string" });
  }
  if (params.principal !== "host" && params.principal !== "session") {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage: stage + ".args", operationId: opId, message: "principal only allows host/session" });
  }
  if (!Number.isInteger(params.expectedRevision) || params.expectedRevision < 0) {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage: stage + ".args", operationId: opId, message: "expectedRevision must be a non-negative integer (self-made null/0 style values are denied; use recoverScan.baseStateRevision)" });
  }
  if (typeof params.approvalHash !== "string" || !HEX64.test(params.approvalHash)) {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage: stage + ".args", operationId: opId, message: "approvalHash must be 64-hex" });
  }
  if (typeof params.candidateHash !== "string" || !HEX64.test(params.candidateHash)) {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage: stage + ".args", operationId: opId, message: "candidateHash must be 64-hex" });
  }
  if (params.callerSessionId !== undefined && typeof params.callerSessionId !== "string") {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage: stage + ".args", operationId: opId, message: "callerSessionId must be a string when provided" });
  }
  if (params.controllerDescriptor !== undefined && (typeof params.controllerDescriptor !== "string" || params.controllerDescriptor.length === 0)) {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage: stage + ".args", operationId: opId, message: "controllerDescriptor must be a session uuid string when provided" });
  }
}


// ---- 族六: run-state.schema 嵌套必需键校验 (候选不只是顶层 16 键)
const REVISION_NESTED_REQUIRED = {
  authorization: { type: "object", fields: ["controller", "controller_epoch", "stop_epoch"], intFields: ["controller_epoch", "stop_epoch"] },
  sessions: { type: "object" },
  pending_closures: { type: "object" },
  applied_operations: { type: "array" },
  queue: { type: "array" },
  effects: { type: "array" },
};
function revisionNestedShapeOk(rev) {
  if (!isPlainObject(rev)) return { ok: false, where: "top" };
  for (const k of REVISION_REQUIRED_KEYS) {
    if (!(k in rev)) return { ok: false, where: "missing:" + k };
  }
  // B-6: Revision 顶层恰 16 键（schema additionalProperties 语义＝第 17 键即拒）
  for (const k of Object.keys(rev)) {
    if (!REVISION_REQUIRED_KEYS.includes(k) && k !== "producer_operation") return { ok: false, where: "extra:" + k };
  }
  for (const [k, spec] of Object.entries(REVISION_NESTED_REQUIRED)) {
    const v = rev[k];
    if (spec.type === "object" && (v === null || typeof v !== "object" || Array.isArray(v))) return { ok: false, where: "shape:" + k };
    if (spec.type === "array" && !Array.isArray(v)) return { ok: false, where: "shape:" + k };
    if (spec.type === "object" && spec.fields) {
      for (const f of spec.fields) {
        if (!(f in v)) return { ok: false, where: "shape:" + k + "." + f };
      }
    }
    if (spec.intFields) {
      for (const f of spec.intFields) {
        if (!Number.isInteger(v[f])) return { ok: false, where: "type:" + k + "." + f + ":integer" };
      }
    }
  }
  if (rev.authorization.controller === null || typeof rev.authorization.controller !== "object" || Array.isArray(rev.authorization.controller)) {
    return { ok: false, where: "shape:authorization.controller" };
  }
  for (const f of ["session_uuid", "assigned_at", "released_at", "evidence_ref", "blocked"]) {
    if (!(f in rev.authorization.controller)) return { ok: false, where: "shape:authorization.controller." + f };
  }
  return { ok: true };
}

// ---- offline authority rebuild: the unique candidate-install path (seven steps)
// R3: the interface-named candidate IS the installed object — envelope.state becomes the new
// immutable revision verbatim (installed_exact_candidate, live current_hash == candidateHash).
async function offlineRebuild({ projectDir, params, approval, envelope, evidenceRef, mini, requestHash, opId, resolvedFile }) {
  traceMark("layer.offline_rebuild");
  // step 1: same-name stable lock with O_EXCL; held lock => blocked, no auto-break, scene preserved
  const lp = lockPath(projectDir);
  await fsp.mkdir(path.dirname(lp), { recursive: true });
  const ownerToken = crypto.randomBytes(16).toString("hex");
  let lockOwner = null;
  try {
    lockOwner = await fsp.open(lp, "wx");
  } catch (error) {
    if (error.code === "EEXIST") {
      // stale detection WITHOUT auto-breaking live locks: a dead owner pid with an expired
      // acquired_at makes the lock reusable; anything else stays blocked (scene preserved)
      // 预裁六②: stale 分类仅留痕, 不自动破锁不重取 (任务书 :38/:223 全局禁令)
      let lockClass = "held-unknown";
      try {
        const doc = JSON.parse(await fsp.readFile(lp, "utf-8"));
        const pid = Number.isInteger(doc?.pid) ? doc.pid : null;
        const age = typeof doc?.acquired_at === "string" ? Date.now() - Date.parse(doc.acquired_at) : NaN;
        let pidDead = false;
        if (pid !== null && pid !== process.pid) {
          try { process.kill(pid, 0); } catch (e) { pidDead = e.code === "ESRCH"; }
        }
        if (pidDead && Number.isFinite(age)) lockClass = age > 10 * 60 * 1000 ? "dead-pid-stale" : "dead-pid-fresh";
        else lockClass = "live";
      } catch { lockClass = "unreadable"; }
      traceMark("offline.lock_class=" + lockClass);
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "offline.lock", operationId: opId, message: "stable lock held (" + lockClass + "); auto-break forbidden, scene preserved for the controller" });
    } else {
      throw new RunStoreError({ code: "io_lock", exitCode: 3, stage: "offline.lock", operationId: opId, message: "lock acquisition failed: " + error.code });
    }
  }
  traceMark("offline.lock_oxcl");
  traceMark("offline.step1");
  let completed = false;
  try {
    await lockOwner.writeFile(canonicalJSON({ owner_token: ownerToken, pid: process.pid, operationId: opId, acquired_at: nowIso() }) + "\n", "utf-8");
    await lockOwner.sync();
  } finally {
    await lockOwner.close();
  }
  const dirFh = await fsp.open(path.dirname(lp), "r");
  try { await dirFh.sync(); } finally { await dirFh.close(); }
  try {
    // 族二: 全局 marker 绑定 (锁内复核) — 同 opId 换候选/换审批/损坏一律 fail closed
    const bound0 = await checkOpsReplayBinding(projectDir, opId, requestHash, envelope, resolvedFile);
    if (bound0) {
      completed = true;
      return bound0;
    }
    const remini = await scanMini(projectDir, opId);
    if (!remini.corrupt && remini.authority.controller_operation_id === opId && remini.authority.current_hash === envelope.candidateHash) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "replay.marker_missing", operationId: opId, message: "authority points at this operation's install but the operation marker is missing; failing closed pending controller reconciliation" });
    }
    // step 2: install object = the interface-named candidate; full pre-install validation
    const cand = structuredClone(envelope.state);
    if (cand.parent_revision !== mini.baseStateRevision || cand.parent_hash !== mini.baseStateHash) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "offline.candidate_base", operationId: opId, message: "candidate parent anchors do not match the offline base; failing closed" });
    }
    if (computeSelfHash(cand) !== cand.self_hash || cand.self_hash !== envelope.candidateHash) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "offline.candidate_hash", operationId: opId, message: "candidate self-hash does not reconcile; failing closed" });
    }
    // revision continuity: no skipped numbers (r-7 style jumps are unexplained descendants)
    if (cand.revision !== cand.parent_revision + 1) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "offline.candidate_continuity", operationId: opId, message: "candidate revision " + cand.revision + " is not parent_revision+1; failing closed" });
    }
    const shape = revisionNestedShapeOk(cand);
    if (!shape.ok) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "offline.candidate_shape", operationId: opId, message: "candidate nested shape invalid at " + shape.where + " (run-state.schema required keys); failing closed" });
    }
    // state_uuid must be a plain directory name inside runtime/state/ (path traversal denied)
    if (typeof cand.state_uuid !== "string" || !/^[A-Za-z0-9_-]+$/.test(cand.state_uuid)) {
      throw new RunStoreError({ code: "candidate_ref_escape", exitCode: 1, stage: "offline.candidate_uuid", operationId: opId, message: "candidate state_uuid is not a plain state directory name; path traversal denied" });
    }
    // envelope path must resolve inside runtime/candidates/recover (realpath containment)
    const recoverRoot = recoverCandidatesDir(projectDir);
    let recoverReal = recoverRoot;
    try { recoverReal = await fsp.realpath(recoverRoot); } catch { /* absent: lexical compare below */ }
    if (resolvedFile !== recoverReal && !resolvedFile.startsWith(recoverReal + path.sep)) {
      throw new RunStoreError({ code: "candidate_ref_escape", exitCode: 1, stage: "offline.candidate_path", operationId: opId, message: "offline install requires the candidate envelope inside runtime/candidates/recover; out-of-scope path denied" });
    }
    traceMark("offline.step2");
    // step 3: validateRevision-style verification of the candidate lineage (base already chain-verified)
    faultGuard("readback", "offline.readback", opId);
    const baseLineage = await verifySourceLineage(projectDir, mini.baseStateUuid, mini.immutableState);
    if (!baseLineage.ok) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "offline.lineage", operationId: opId, message: "base revision lineage no longer verifies; failing closed" });
    }
    traceMark("offline.step3");
    // step 4: append the candidate as the immutable revision file (never overwrite)
    faultGuard("offline_write", "offline.write", opId);
    const candFile = revisionFilePath(projectDir, cand.state_uuid, cand.revision);
    await fsp.mkdir(path.dirname(candFile), { recursive: true });
    if (fs.existsSync(candFile)) {
      const existing = JSON.parse(await fsp.readFile(candFile, "utf-8"));
      if (existing.self_hash !== cand.self_hash) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "offline.immutable", operationId: opId, message: "immutable revision already exists with a different hash; failing closed" });
      }
    } else {
      traceMark("run_state.atomicWrite");
      await atomicWrite(candFile, canonicalJSON(cand), {});
    }
    traceMark("offline.step4");
    // step 5: highwater state_uuid -> record/current revision/hash
    faultGuard("highwater_write", "offline.highwater", opId);
    const hw = await layerLoadHighwater(projectDir, opId);
    hw[cand.state_uuid] = { record_revision: mini.baseRecordRevision + 1, current_revision: cand.revision, current_hash: cand.self_hash };
    traceMark("run_state.atomicWrite");
    await atomicWrite(highwaterPath(projectDir), canonicalJSON(hw), {});
    traceMark("offline.step5");
    // step 6: authority rewrite with the fixed 12-field provenance (epoch/mode from verified evidence, R4)
    faultGuard("authority_write", "offline.authority", opId);
    let journal = null;
    try {
      journal = await layerLoadJournal(projectDir, opId);
    } catch (error) {
      if (error.code === "blocked") {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "offline.journal", operationId: opId, message: "journal chain unverifiable; authority rebuild blocked pending explicit reconciliation" });
      }
      throw error;
    }
    const nextAuthority = {
      record_revision: mini.baseRecordRevision + 1,
      epoch: mini.offlineEpoch.value + 1,
      mode: mini.offlineMode.value,
      state_uuid: cand.state_uuid,
      base_revision: cand.parent_revision,
      base_hash: cand.parent_hash,
      current_revision: cand.revision,
      current_hash: cand.self_hash,
      controller_operation_id: opId,
      mode_change_approval_ref: params.approvalRef,
      journal_generation: journal ? journal.generation : 0,
      journal_head_hash: journal ? journal.headHash : GENESIS_JOURNAL_HEAD,
    };
    traceMark("run_state.atomicWrite");
    await atomicWrite(authorityPath(projectDir), canonicalJSON(nextAuthority), {});
    traceMark("offline.step6");
    // step 7: post-read verification of all anchors (including exact-candidate install) before release
    const rereadRev = JSON.parse(await fsp.readFile(candFile, "utf-8"));
    const rereadHw = await layerLoadHighwater(projectDir, opId);
    const rereadAu = await layerLoadAuthority(projectDir, opId);
    const hwEntry = rereadHw[cand.state_uuid];
    const anchorsOk = rereadRev.self_hash === cand.self_hash && rereadRev.self_hash === envelope.candidateHash
      && rereadAu.current_hash === envelope.candidateHash && rereadAu.current_revision === cand.revision
      && rereadAu.record_revision === mini.baseRecordRevision + 1 && rereadAu.epoch === mini.offlineEpoch.value + 1
      && rereadAu.mode === mini.offlineMode.value
      && hwEntry && hwEntry.current_hash === cand.self_hash && hwEntry.current_revision === cand.revision
      && hwEntry.record_revision === rereadAu.record_revision
      && AUTHORITY_KEYS.every((k) => k in rereadAu);
    if (!anchorsOk) {
      throw new RunStoreError({ code: "io_readback", exitCode: 3, stage: "offline.readback", operationId: opId, message: "post-write anchor verification failed; scene preserved" });
    }
    traceMark("offline.step7");
    // 族二: 全局 ops marker 持久化 (opId 索引), 先于锁释放
    const finalHash = sha256hex(opId + ":" + requestHash);
    await saveOpsMarker(projectDir, { operationId: opId, requestHash, candidateHash: envelope.candidateHash, revision: cand.revision, hash: finalHash, candidatePath: resolvedFile });
    completed = true;
    void evidenceRef; void approval;
    return { revision: cand.revision, hash: finalHash };
  } finally {
    if (completed) {
      try { await fsp.unlink(lp); } catch (error) { traceMark("offline.lock_release_failed:" + (error?.code ?? "unknown")); }
      const dfh = await fsp.open(path.dirname(lp), "r");
      try { await dfh.sync(); } finally { await dfh.close(); }
    }
  }
}

// ---- applyApproved orchestration
export async function applyApproved(params) {
  assertObjectKeys(params, APPLY_KEYS, APPLY_REQUIRED, "applyApproved.args", params?.operationId ?? null);
  assertApplyScalars(params, "applyApproved");
  traceMark("layer.apply");
  const opId = params.operationId;
  const { projectDir, resolvedFile } = await deriveProjectDirFromCandidate(params.candidatePath, opId);
  const envelope = await loadCandidateEnvelope(resolvedFile, opId);
  if (params.candidateHash !== envelope.candidateHash) {
    throw new RunStoreError({ code: "candidate_hash_mismatch", exitCode: 1, stage: "candidate.hash", operationId: opId, message: "candidateHash does not equal the candidate envelope hash at the given path" });
  }
  const ev = await loadCandidateEvidence(projectDir, resolvedFile, opId);
  if (ev.doc.candidatePath !== params.candidatePath || ev.doc.candidateHash !== params.candidateHash) {
    throw new RunStoreError({ code: "evidence_mismatch", exitCode: 1, stage: "candidate.evidence", operationId: opId, message: "evidence artifact fields differ from the interface parameters (binding chain approval->base->evidence->candidate)" });
  }
  const caller = { principal: params.principal, callerSessionId: params.callerSessionId ?? null };
  const approval = await layerLoadApproval(projectDir, params.approvalRef, "applyApproved", opId, caller);
  if (params.approvalHash !== approval.approvalHash) {
    throw new RunStoreError({ code: "approval_hash_mismatch", exitCode: 1, stage: "applyApproved.approval", operationId: opId, message: "approvalHash parameter differs from the artifact (forged parameter)" });
  }
  const mini = await scanMini(projectDir, opId);
  // R5: ACTIVE descriptor comparison hoisted to every path (replay/online/offline) before replay
  const stateRef = mini.corrupt ? mini.immutableState : mini.state;
  const active = controllerActiveState(stateRef);
  if (active && params.controllerDescriptor !== undefined && params.controllerDescriptor !== stateRef.authorization.controller.session_uuid) {
    throw new RunStoreError({ code: "controller_descriptor_mismatch", exitCode: 1, stage: "applyApproved.controller", operationId: opId, message: "ACTIVE controller exists; the provided controllerDescriptor differs and comparison cannot be skipped" });
  }
  if (!active && params.controllerDescriptor !== undefined
    && (!approval.controllerDescriptor || params.controllerDescriptor !== approval.controllerDescriptor.session_uuid)) {
    throw new RunStoreError({ code: "controller_descriptor_mismatch", exitCode: 1, stage: "applyApproved.controller", operationId: opId, message: "no ACTIVE controller: the provided controllerDescriptor must match the approval controllerDescriptor (same-transaction assignment)" });
  }
  if (!active && params.controllerDescriptor === undefined && !mini.corrupt) {
    throw new RunStoreError({ code: "assignment_required", exitCode: 1, stage: "applyApproved", operationId: opId, message: "no ACTIVE controller: controllerDescriptor must be provided and assigned in the same transaction" });
  }
  if (!active && params.controllerDescriptor === undefined && mini.corrupt) {
    // m6 mutation point: the offline path has no store behind it; the layer gate is the only guard
    throw new RunStoreError({ code: "assignment_required", exitCode: 1, stage: "applyApproved", operationId: opId, message: "no ACTIVE controller on damaged authority: controllerDescriptor must be provided (offline path has no store-side guard)" });
  }
  // R6: replay decision (skip state-dependent base checks only); the return value always flows
  // through the transact idempotent path for the online route
  const payload = { approvalRef: params.approvalRef, evidenceRef: ev.evidenceRef };
  if (params.controllerDescriptor !== undefined && approval.controllerDescriptor !== undefined) payload.controllerDescriptor = approval.controllerDescriptor;
  for (const k of Object.keys(payload)) {
    if (!COMMANDS.applyApproved.keys.includes(k)) {
      throw new RunStoreError({ code: "unknown_payload_key", exitCode: 1, stage: "applyApproved.payload", operationId: opId, message: "layer payload key not in the run-store closed set: " + k });
    }
  }
  const requestHash = requestHashOf({ command: "applyApproved", principal: params.principal, sessionId: params.callerSessionId ?? null, operationId: opId, payload });
  let replay = false;
  if (!mini.corrupt) {
    const marker = findAppliedInList(mini.state.applied_operations ?? [], opId);
    if (marker && marker.requestHash !== requestHash) {
      throw new RunStoreError({ code: "request_hash_conflict", exitCode: 1, stage: "replay", operationId: opId, message: "same operationId replayed with a different payload/requestHash" });
    }
    if (marker) replay = true;
    // persisted offline-operation marker binding (:274): same opId + same candidate + same payload
    // replays the original values; the same opId with a different payload (forged approval / new
    // candidate) must deny even though the authority already points at the installed candidate
    if (!replay) {
      const bound = await checkOpsReplayBinding(projectDir, opId, requestHash, envelope, resolvedFile);
      if (bound) {
        traceMark("layer.offline_replay");
        return bound;
      }
    }
    // 安装已完成但 marker 丢失/未登记 => fail closed (不得以签名兜底静默放行)
    if (!replay && mini.authority.controller_operation_id === opId && mini.authority.current_hash === envelope.candidateHash) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "replay.marker_missing", operationId: opId, message: "authority points at this operation's install but the operation marker is missing; failing closed pending controller reconciliation" });
    }
  }
  if (!replay) {
    // base binding: approval base must equal the real bases first, then expectedRevision
    if (approval.baseRecordRevision !== mini.baseRecordRevision || approval.baseStateRevision !== mini.baseStateRevision) {
      throw new RunStoreError({ code: "approval_base_mismatch", exitCode: 1, stage: "applyApproved.base", operationId: opId, message: "approval base record/state revision mismatch (expired approval family)" });
    }
    if (params.expectedRevision !== mini.baseStateRevision) {
      throw new RunStoreError({ code: "expected_revision_mismatch", exitCode: 1, stage: "expected_revision", operationId: opId, message: "expectedRevision " + params.expectedRevision + " != recoverScan baseStateRevision " + mini.baseStateRevision });
    }
    // candidate staleness: the candidate must sit exactly on the approval base
    if (envelope.candidateRef.parentRevision < approval.baseStateRevision) {
      throw new RunStoreError({ code: "stale_candidate", exitCode: 1, stage: "candidate.stale", operationId: opId, message: "candidate is behind the approval base (stale candidate)" });
    }
    if (envelope.candidateRef.parentRevision > approval.baseStateRevision) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "candidate.future", operationId: opId, message: "candidate is ahead of the approval base; unexplained descendant" });
    }
  }
  if (mini.corrupt) {
    return await offlineRebuild({ projectDir, params, approval, envelope, evidenceRef: ev.evidenceRef, mini, requestHash, opId, resolvedFile });
  }
  traceMark("transact.applyApproved");
  const r = await transact({
    projectDir, principal: params.principal, sessionId: params.callerSessionId ?? null,
    expectedRevision: params.expectedRevision, operationId: opId,
    command: "applyApproved", payload,
  });
  return { revision: r.revision, hash: r.hash };
}

// ---- checkpointRebase orchestration
export async function checkpointRebase(params) {
  assertObjectKeys(params, APPLY_KEYS, APPLY_REQUIRED, "checkpointRebase.args", params?.operationId ?? null);
  assertApplyScalars(params, "checkpointRebase");
  traceMark("layer.rebase");
  const opId = params.operationId;
  const { projectDir, resolvedFile } = await deriveProjectDirFromCandidate(params.candidatePath, opId);
  const envelope = await loadCandidateEnvelope(resolvedFile, opId);
  if (params.candidateHash !== envelope.candidateHash) {
    throw new RunStoreError({ code: "candidate_hash_mismatch", exitCode: 1, stage: "candidate.hash", operationId: opId, message: "candidateHash does not equal the candidate envelope hash at the given path" });
  }
  const ev = await loadCandidateEvidence(projectDir, resolvedFile, opId);
  if (ev.doc.candidatePath !== params.candidatePath || ev.doc.candidateHash !== params.candidateHash) {
    throw new RunStoreError({ code: "evidence_mismatch", exitCode: 1, stage: "candidate.evidence", operationId: opId, message: "evidence artifact fields differ from the interface parameters" });
  }
  const caller = { principal: params.principal, callerSessionId: params.callerSessionId ?? null };
  const approval = await layerLoadApproval(projectDir, params.approvalRef, "checkpointRebase", opId, caller);
  if (params.approvalHash !== approval.approvalHash) {
    throw new RunStoreError({ code: "approval_hash_mismatch", exitCode: 1, stage: "checkpointRebase.approval", operationId: opId, message: "approvalHash parameter differs from the artifact (forged parameter)" });
  }
  const mini = await scanMini(projectDir, opId);
  if (mini.corrupt) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "checkpointRebase.authority", operationId: opId, message: "authority damage requires the offline rebuild path before any rebase" });
  }
  // lineage-verified stable snapshot via the RT1A reader surface
  const current = await readCurrent({ projectDir });
  const state = current.state;
  const authority = current.authority;
  // R5: ACTIVE is mandatory and the descriptor comparison runs before replay and base checks
  const active = controllerActiveState(state);
  if (!active) {
    throw new RunStoreError({ code: "active_controller_required", exitCode: 1, stage: "checkpointRebase.controller", operationId: opId, message: "no ACTIVE controller: assign via applyApproved first (active_controller_required)" });
  }
  if (params.controllerDescriptor !== undefined && params.controllerDescriptor !== state.authorization.controller.session_uuid) {
    throw new RunStoreError({ code: "controller_descriptor_mismatch", exitCode: 1, stage: "checkpointRebase.controller", operationId: opId, message: "ACTIVE controller exists; the provided controllerDescriptor differs" });
  }
  const payload = { approvalRef: params.approvalRef, baseRecordRevision: approval.baseRecordRevision, baseStateRevision: approval.baseStateRevision };
  const requestHash = requestHashOf({ command: "rebase", principal: params.principal, sessionId: params.callerSessionId ?? null, operationId: opId, payload });
  let replay = false;
  {
    const marker = findAppliedInList(state.applied_operations ?? [], opId);
    if (marker && marker.requestHash !== requestHash) {
      throw new RunStoreError({ code: "request_hash_conflict", exitCode: 1, stage: "replay", operationId: opId, message: "same operationId replayed across apply/rebase purposes or with a different payload" });
    }
    if (marker) replay = true;
  }
  if (!replay) {
    if (approval.baseRecordRevision !== authority.record_revision || approval.baseStateRevision !== state.revision) {
      throw new RunStoreError({ code: "approval_base_mismatch", exitCode: 1, stage: "rebase.base", operationId: opId, message: "rebase approval base record/state revision mismatch" });
    }
    if (params.expectedRevision !== state.revision) {
      throw new RunStoreError({ code: "expected_revision_mismatch", exitCode: 1, stage: "expected_revision", operationId: opId, message: "expectedRevision " + params.expectedRevision + " != current " + state.revision });
    }
    if (envelope.candidateRef.parentRevision !== authority.current_revision) {
      throw new RunStoreError({ code: envelope.candidateRef.parentRevision < authority.current_revision ? "stale_candidate" : "blocked", exitCode: 1, stage: "candidate.stale", operationId: opId, message: "candidate is not the last verified candidate for the current revision" });
    }
    // unresolved effects pre-check (layer mirrors the store stage so the observable stays single-faced)
    const unresolved = (state.effects ?? []).filter((e) => UNRESOLVED_EFFECT_STATES.has(e.state)).length;
    if (unresolved !== 0) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "rebase.precondition", operationId: opId, message: "checkpoint-rebase requires zero unresolved effects and flushed closures" });
    }
    // closure catch-up gate (R11): index required when any closure bookkeeping exists; the head is
    // independently recomputed from the archive entries; unknown/missing archives block
    const pendingCount = Object.keys(state.pending_closures ?? {}).length;
    let archivedCount = 0;
    for (const sid of Object.keys(state.sessions ?? {})) {
      const ci = state.sessions[sid].closure_index;
      if (ci && Number.isInteger(ci.closure_count) && ci.closure_count > 0) archivedCount += ci.closure_count;
    }
    const idxFile = path.join(closuresDir(projectDir), "index.json");
    if (!fs.existsSync(idxFile)) {
      if (pendingCount > 0 || archivedCount > 0) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "checkpointRebase.closure", operationId: opId, message: "closure index missing while closure bookkeeping exists (pending " + pendingCount + " / archived " + archivedCount + "); backfill before rebase" });
      }
    } else {
      let index;
      try {
        index = JSON.parse(await fsp.readFile(idxFile, "utf-8"));
      } catch (error) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "checkpointRebase.closure", operationId: opId, message: "closure index unreadable; backfill before rebase" });
      }
      if (!isPlainObject(index)) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "checkpointRebase.closure", operationId: opId, message: "closure index is not an object; backfill before rebase" });
      }
      if (index.archive_files !== undefined && !Array.isArray(index.archive_files)) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "checkpointRebase.closure", operationId: opId, message: "closure index archive_files is not an array; backfill before rebase" });
      }
      for (const af of index.archive_files ?? []) {
        if (!isPlainObject(af) || typeof af.file !== "string" || af.file.length === 0) {
          throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "checkpointRebase.closure", operationId: opId, message: "closure index archive_files carries a non-object entry; backfill before rebase" });
        }
        if (af.file.includes("..") || path.isAbsolute(af.file)) {
          throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "checkpointRebase.closure", operationId: opId, message: "closure archive file reference escapes the closures dir: " + af.file });
        }
      }
      if (Number.isInteger(index.count) && index.count > 0 && (index.archive_files ?? []).length === 0) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "checkpointRebase.closure", operationId: opId, message: "closure index claims count " + index.count + " with an empty archive list; empty-archive bypass denied" });
      }
      let combinedEntries = null;
      for (const af of index.archive_files ?? []) {
        const afPath = path.join(closuresDir(projectDir), af.file);
        let bytes = null;
        try { bytes = await fsp.readFile(afPath, "utf-8"); } catch { bytes = null; }
        if (bytes === null || sha256hex(bytes) !== af.file_hash) {
          throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "checkpointRebase.closure", operationId: opId, message: "closure archive unknown or chain broken at " + af.file + "; backfill before rebase" });
        }
        let adoc = null;
        try { adoc = JSON.parse(bytes); } catch { adoc = null; }
        if (!adoc || typeof adoc !== "object" || Array.isArray(adoc) || !Array.isArray(adoc.entries)) {
          throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "checkpointRebase.closure", operationId: opId, message: "closure archive " + af.file + " has no entries array; backfill before rebase" });
        }
        combinedEntries = combinedEntries === null ? [...adoc.entries] : combinedEntries.concat(adoc.entries);
      }
      if (combinedEntries !== null) {
        const headRecomputed = sha256hex(canonicalJSON(combinedEntries));
        if (headRecomputed !== index.head_hash) {
          throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "checkpointRebase.closure", operationId: opId, message: "closure head_hash does not match the recomputed archive head (across " + (index.archive_files ?? []).length + " file(s)); backfill before rebase" });
        }
        for (const sid of Object.keys(state.sessions ?? {})) {
          const ci = state.sessions[sid].closure_index;
          if (ci && Number.isInteger(ci.closure_count) && ci.closure_count > 0 && ci.closure_head_hash !== index.head_hash) {
            throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "checkpointRebase.closure", operationId: opId, message: "session closure_index head " + ci.closure_head_hash.slice(0, 8) + " does not match the tracked index head; backfill before rebase" });
          }
        }
      }
      const expected = pendingCount + archivedCount;
      if (index.count !== expected) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "checkpointRebase.closure", operationId: opId, message: "closure_head/count not caught up (index " + index.count + " vs expected " + expected + "); run the normal projection/backfill first" });
      }
    }
  }
  // R6: replay and fresh apply both flow through the transact idempotent path
  traceMark("transact.rebase");
  const r = await transact({
    projectDir, principal: params.principal, sessionId: params.callerSessionId ?? null,
    expectedRevision: params.expectedRevision, operationId: opId,
    command: "rebase", payload,
  });
  const revision = r.revision;
  const hash = r.hash;
  // post-read assembly: manifest tail provides epoch, revision file provides stateUuid
  const manifest = await readJsonFile(manifestPath(projectDir), "manifest", opId);
  const tail = (manifest.rebase_index ?? [])[manifest.rebase_index.length - 1];
  if (!tail || !tail.new_state_uuid || !Number.isInteger(tail.epoch)) {
    throw new RunStoreError({ code: "io_readback", exitCode: 3, stage: "checkpointRebase.postread", operationId: opId, message: "manifest rebase_index tail missing after rebase" });
  }
  const revFile = revisionFilePath(projectDir, tail.new_state_uuid, revision);
  const revDoc = await readJsonFile(revFile, "rebase_postread", opId);
  const authorityNow = await layerLoadAuthority(projectDir, opId);
  if (revDoc.state_uuid !== tail.new_state_uuid || revDoc.revision !== revision
    || authorityNow.state_uuid !== tail.new_state_uuid || authorityNow.current_revision !== revision
    || tail.epoch !== authorityNow.epoch) {
    throw new RunStoreError({ code: "io_readback", exitCode: 3, stage: "checkpointRebase.postread", operationId: opId, message: "post-read keys do not point at the same rebase operation" });
  }
  traceMark("layer.postread");
  return { stateUuid: tail.new_state_uuid, revision, hash, epoch: tail.epoch };
}

// ═══════════════════════════════════════════════ harness (self-test)

function harnessFieldCheck(error) {
  if (!error || typeof error !== "object") return false;
  const own = Object.keys(error);
  const need = ["code", "exitCode", "message", "operationId", "retryable", "stage"];
  if (own.length !== need.length || !need.every((k) => own.includes(k))) return false;
  if (typeof error.code !== "string" || error.code.length === 0) return false;
  if (!Number.isInteger(error.exitCode)) return false;
  if (typeof error.stage !== "string" || error.stage.length === 0) return false;
  if (error.operationId !== null && typeof error.operationId !== "string") return false;
  if (typeof error.message !== "string" || error.message.length === 0) return false;
  if (error.retryable !== false) return false;
  return true;
}
function errorPayload(error) {
  if (!error) return null;
  return {
    code: typeof error.code === "string" ? error.code : "unexpected",
    exitCode: Number.isInteger(error.exitCode) ? error.exitCode : 1,
    stage: typeof error.stage === "string" ? error.stage : "unknown",
    operationId: error.operationId === undefined ? null : (error.operationId ?? null),
    message: String(error.message ?? ""),
    retryable: false,
  };
}

function deepResolve(value, resolver) {
  if (typeof value === "string") return resolver(value);
  if (Array.isArray(value)) return value.map((v) => deepResolve(v, resolver));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = deepResolve(value[k], resolver);
    return out;
  }
  return value;
}

async function currentWorld(projectDir) {
  const authority = await layerLoadAuthority(projectDir);
  const state = await layerLoadRevisionFile(projectDir, authority.state_uuid, authority.current_revision);
  return { authority, state };
}

async function makeAdapterResolver(ctx) {
  const world = await currentWorld(ctx.projectDir).catch(() => null);
  const authority = world?.authority ?? null;
  const state = world?.state ?? null;
  const journal = world ? await layerLoadJournal(ctx.projectDir).catch(() => null) : null;
  const numKey = (base, s) => {
    const m = /^([+-])(\d+)$/.exec(s);
    if (!m) return null;
    return Number(base) + (m[1] === "-" ? -1 : 1) * Number(m[2]);
  };
  return (s) => {
    if (!s.startsWith("@")) return s;
    if (s === "@now-iso") return nowIso();
    if (s === "@expired-iso") return "2020-01-01T00:00:00Z";
    if (s === "@auto:project_dir") return ctx.projectDir;
    if (s.startsWith("@auto:project_dir/")) return path.join(ctx.projectDir, s.slice("@auto:project_dir/".length));
    if (s === "@auto:candidates_dir") return candidatesDir(ctx.projectDir);
    if (s.startsWith("@auto:candidates_dir/")) return path.join(candidatesDir(ctx.projectDir), s.slice("@auto:candidates_dir/".length));
    if (s === "@auto:current_revision") return authority ? authority.current_revision : 0;
    if (s.startsWith("@auto:current_revision") && numKey(0, "")) return authority ? authority.current_revision : 0;
    if (/^@auto:current_revision([+-]\d+)$/.test(s)) return authority ? numKey(authority.current_revision, s.slice("@auto:current_revision".length)) : 0;
    if (s === "@auto:current_hash") return state ? state.self_hash : GENESIS_PARENT_HASH;
    if (s === "@auto:record_revision") return authority ? authority.record_revision : 0;
    if (/^@auto:record_revision([+-]\d+)$/.test(s)) return authority ? numKey(authority.record_revision, s.slice("@auto:record_revision".length)) : 0;
    if (s === "@auto:state_uuid") return authority ? authority.state_uuid : "su-auto";
    if (s === "@auto:authority_epoch") return authority ? authority.epoch : 0;
    if (/^@auto:authority_epoch([+-]\d+)$/.test(s)) return authority ? numKey(authority.epoch, s.slice("@auto:authority_epoch".length)) : 0;
    if (s === "@auto:controller_epoch") return state ? state.authorization.controller_epoch : 0;
    if (s === "@auto:stop_epoch") return state ? state.authorization.stop_epoch : 0;
    if (/^@auto:stop_epoch([+-]\d+)$/.test(s)) return state ? numKey(state.authorization.stop_epoch, s.slice("@auto:stop_epoch".length)) : 0;
    if (s.startsWith("@auto:approval_hash:")) return ctx.approvalHashes[s.slice("@auto:approval_hash:".length)] ?? s;
    if (s.startsWith("@auto:evidence_hash:")) return ctx.evidenceHashes[s.slice("@auto:evidence_hash:".length)] ?? s;
    if (s === "@auto:journal_head_hash") return journal ? journal.headHash : GENESIS_JOURNAL_HEAD;
    if (s.startsWith("@auto:candidate_hash:")) {
      const opId = s.slice("@auto:candidate_hash:".length);
      const e = (journal?.entries ?? []).find((x) => x.operationId === opId);
      return e?.candidateRef?.hash ?? s;
    }
    if (s.startsWith("@journal:")) {
      const rest = s.slice("@journal:".length);
      const segs = rest.split(":");
      const field = segs[0];
      const opId = segs.slice(1).join(":");
      const e = (journal?.entries ?? []).find((x) => x.operationId === opId);
      const val = e ? e[field] : undefined;
      return val === undefined ? s : val;
    }
    if (s === "@cand:path") return ctx.autoRefs.candidatePath ?? s;
    if (s === "@cand:hash") return ctx.autoRefs.candidateHash ?? s;
    if (s === "@cand:gaps") return ctx.autoRefs.candidateGaps ?? s;
    if (s === "@apply:base") return ctx.autoRefs.applyBaseRevision ?? s;
    if (s === "@rebase:base") return ctx.autoRefs.rebaseBaseRevision ?? s;
    if (s === "@scan:baseStateRevision") return ctx.autoRefs.scanBaseStateRevision ?? s;
    if (s === "@scan:baseRecordRevision") return ctx.autoRefs.scanBaseRecordRevision ?? s;
    if (/^@scan:baseStateRevision([+-]\d+)$/.test(s)) {
      const base = ctx.autoRefs.scanBaseStateRevision ?? ctx.lastScan?.baseStateRevision ?? 0;
      return numKey(base, s.slice("@scan:baseStateRevision".length));
    }
    if (s.startsWith("@scan:source:")) return s; // resolved lazily by the action param pass
    return s;
  };
}

function resolveScanSourceSentinel(ctx, s) {
  if (!s.startsWith("@scan:source:")) return undefined;
  const scan = ctx.lastScan;
  if (!scan) return s;
  const rest = s.slice("@scan:source:".length);
  if (rest.startsWith("kind:")) return scan.candidates.find((c) => c.kind === rest.slice(5)) ?? s;
  if (rest.startsWith("rev:")) return scan.candidates.find((c) => c.revision === Number(rest.slice(4))) ?? s;
  if (rest === "stale_current") {
    const cur = scan.candidates.find((c) => c.kind === "current_source");
    const hist = scan.candidates.filter((c) => c.kind === "historical_source").sort((a, b) => b.revision - a.revision)[0];
    if (!cur || !hist) return s;
    return { ...cur, revision: hist.revision, hash: hist.hash };
  }
  return s;
}

function makeDescriptor(partial, resolver) {
  const r = (v, d) => {
    const x = typeof v === "string" && v.startsWith("@") ? resolver(v) : v;
    return x === undefined || x === null ? d : x;
  };
  return {
    session_uuid: partial.session_uuid ?? "sess-ctrl",
    project_id: "proj-rt1c",
    kind: partial.kind ?? "rt1c",
    role: partial.role ?? "controller",
    started_at: r(partial.started_at, TS0),
    parent_session_id: null,
    resume_of: null,
    cfg_hash: "7d1f0a2c" + "b".repeat(56),
    route_snapshot: {},
    binding_snapshot_ref: "bindings/rt1c.json",
    binding_snapshot_hash: "9e2b1c0d" + "e".repeat(56),
  };
}

function registerSession(sessions, descriptor) {
  sessions[descriptor.session_uuid] = {
    descriptor,
    live_state: {
      revision: 0, lifecycle: "OPEN", work_outcome: "IN_PROGRESS", current_run: null,
      next_action: "registered", waiting_user: null, last_activity: descriptor.started_at,
      heartbeat: descriptor.started_at, attention_reasons: [],
    },
    closure_index: { closure_head_hash: GENESIS_PARENT_HASH, closure_count: 0, recent_entries: [] },
  };
}

function applyStopTransition(state, opts = {}) {
  let changed = false;
  state.queue = state.queue.filter((e) => {
    if (["queued", "scheduled", "retry_scheduled"].includes(e.state)) { changed = true; return false; }
    return true;
  });
  for (const e of state.effects) {
    if (["queued", "scheduled", "retry_scheduled"].includes(e.state)) {
      e.state = "cancelled";
      delete e.token;
      changed = true;
    } else if (["claimed", "running", "awaiting_receipt"].includes(e.state)) {
      if (e.state === "claimed" && opts.notStartedEvidence) e.state = "cancelled";
      else e.state = "stop_pending";
      delete e.token;
      changed = true;
    } else if (e.token) {
      delete e.token;
      changed = true;
    }
  }
  if (state.active_run !== null && state.active_run !== undefined) {
    const sid = state.active_run.session_uuid;
    state.pending_closures[sid] = {
      descriptor: state.sessions[sid]?.descriptor ?? null,
      closure: {
        ended_at: opts.endedAt ?? nowIso(), end_reason: opts.endReason ?? "stop", work_outcome: opts.workOutcome ?? "UNKNOWN",
        final_revision: state.revision, final_artifacts: [], unresolved: [], successor: null,
      },
      closure_revision: state.revision,
    };
    state.active_run = null;
    changed = true;
  }
  if (opts.bumpStopEpoch) {
    state.authorization.stop_epoch += 1;
    changed = true;
  }
  return changed;
}

function buildStopRefAndState({ state, authority, operationId, g1a }) {
  const stopRef = {
    operationId: operationId + ":stop", kind: "cutover_stop",
    parentRevision: state.revision, parentHash: state.self_hash,
    revision: state.revision + 1, hash: "", epoch: authority.epoch,
    stopEpoch: state.authorization.stop_epoch + 1,
  };
  const stopState = structuredClone(state);
  stopState.parent_revision = stopRef.parentRevision;
  stopState.parent_hash = stopRef.parentHash;
  stopState.revision = stopRef.revision;
  stopState.authorization.stop_epoch = stopRef.stopEpoch;
  applyStopTransition(stopState, {});
  stopState.active_run = null;
  const ctrl = g1a.controllerDescriptor;
  stopState.authorization.controller = {
    session_uuid: ctrl.session_uuid, assigned_at: g1a.assignedAt, released_at: null,
    evidence_ref: g1a.controllerEvidenceRef, blocked: false,
  };
  if (!stopState.sessions[ctrl.session_uuid]) registerSession(stopState.sessions, ctrl);
  stopState.producer_operation = { ...stopRef };
  const h = computeSelfHash(stopState);
  stopState.self_hash = h;
  stopRef.hash = h;
  return { stopRef, stopState };
}
function buildCandidateRefAndState({ state, stopRef, operationId, authority }) {
  const candidateRef = {
    operationId: operationId + ":confirm", kind: "confirm",
    parentRevision: stopRef.revision, parentHash: stopRef.hash,
    revision: stopRef.revision + 1, hash: "", epoch: authority.epoch + 1,
    stopEpoch: stopRef.stopEpoch,
  };
  const candState = structuredClone(state);
  candState.parent_revision = candidateRef.parentRevision;
  candState.parent_hash = candidateRef.parentHash;
  candState.revision = candidateRef.revision;
  candState.authorization.stop_epoch = candidateRef.stopEpoch;
  candState.producer_operation = { ...candidateRef };
  const h = computeSelfHash(candState);
  candState.self_hash = h;
  candidateRef.hash = h;
  return { candidateRef, candState };
}
function buildResumeRefAndState({ state, authority, operationId, g1a }) {
  const resumeOperation = {
    operationId: operationId + ":resume", kind: "resume",
    parentRevision: state.revision, parentHash: state.self_hash,
    revision: state.revision + 1, hash: "", epoch: authority.epoch,
    stopEpoch: state.authorization.stop_epoch + 1,
  };
  const resumeState = structuredClone(state);
  resumeState.parent_revision = resumeOperation.parentRevision;
  resumeState.parent_hash = resumeOperation.parentHash;
  resumeState.revision = resumeOperation.revision;
  resumeState.authorization.stop_epoch = resumeOperation.stopEpoch;
  applyStopTransition(resumeState, {});
  resumeState.active_run = null;
  const ctrl = g1a.controllerDescriptor;
  resumeState.authorization.controller = {
    session_uuid: ctrl.session_uuid, assigned_at: g1a.assignedAt, released_at: null,
    evidence_ref: g1a.controllerEvidenceRef, blocked: false,
  };
  const hadActive = controllerActiveState(state);
  if (!hadActive) resumeState.authorization.controller_epoch = state.authorization.controller_epoch + 1;
  if (!resumeState.sessions[ctrl.session_uuid]) registerSession(resumeState.sessions, ctrl);
  resumeState.producer_operation = { ...resumeOperation };
  const h = computeSelfHash(resumeState);
  resumeState.self_hash = h;
  resumeOperation.hash = h;
  return { resumeOperation, resumeState };
}

async function publishSyntheticRevision(projectDir, revision, recordRevisionBase, epochOverride) {
  const io = {};
  const file = revisionFilePath(projectDir, revision.state_uuid, revision.revision);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  traceMark("harness.atomicWrite");
  await atomicWrite(file, canonicalJSON(revision), io);
  const hw = await layerLoadHighwater(projectDir);
  hw[revision.state_uuid] = { record_revision: recordRevisionBase + 1, current_revision: revision.revision, current_hash: revision.self_hash };
  await atomicWrite(highwaterPath(projectDir), canonicalJSON(hw), io);
  const authority = await layerLoadAuthority(projectDir);
  const nextAuthority = { ...authority, record_revision: recordRevisionBase + 1, current_revision: revision.revision, current_hash: revision.self_hash };
  if (epochOverride !== undefined) nextAuthority.epoch = epochOverride;
  await atomicWrite(authorityPath(projectDir), canonicalJSON(nextAuthority), io);
  return nextAuthority;
}

async function writeJournalFile(projectDir, journal) {
  const io = {};
  const j = structuredClone(journal);
  for (const e of j.entries) {
    // synthesis channel: entries may mutate across breakpoint advances; the hash is recomputed
    // on write and enforced on load (layerLoadJournal), matching the closed-set contract
    e.entryHash = entryHashOf(e);
  }
  j.headHash = journalHeadHash(j);
  journal.headHash = j.headHash;
  await atomicWrite(journalPath(projectDir), canonicalJSON(j), io);
  return j;
}

async function syncAuthorityJournalAnchors(projectDir, journal, epochOverride) {
  const authority = await layerLoadAuthority(projectDir);
  const next = { ...authority, journal_generation: journal.generation, journal_head_hash: journal.headHash };
  if (epochOverride !== undefined) next.epoch = epochOverride;
  await atomicWrite(authorityPath(projectDir), canonicalJSON(next), {});
  return next;
}

async function writeApprovalDoc(ctx, file, doc) {
  const dir = approvalsDir(ctx.projectDir);
  await fsp.mkdir(dir, { recursive: true });
  const resolver = await makeAdapterResolver(ctx);
  let body = deepResolve(doc, resolver);
  if (body.descriptor) body.descriptor = makeDescriptor(body.descriptor, resolver);
  if (body.controllerDescriptor) body.controllerDescriptor = makeDescriptor(body.controllerDescriptor, resolver);
  const withHash = { ...body, approvalHash: computeApprovalHash(body) };
  await fsp.writeFile(path.join(dir, file), JSON.stringify(withHash, null, 1), "utf-8");
  ctx.approvalHashes[file] = withHash.approvalHash;
  return file;
}

async function writeEvidenceDoc(ctx, file, doc) {
  const dir = approvalsDir(ctx.projectDir);
  await fsp.mkdir(dir, { recursive: true });
  const resolver = await makeAdapterResolver(ctx);
  const body = deepResolve(doc ?? { kind: "generic-evidence", statement: "fixture evidence" }, resolver);
  const copy = { ...body };
  delete copy.evidenceHash;
  copy.evidenceHash = sha256hex(canonicalJSON(copy));
  await fsp.writeFile(path.join(dir, file), JSON.stringify(copy, null, 1), "utf-8");
  ctx.evidenceHashes[file] = copy.evidenceHash;
  return file;
}

async function persistAutoRefs(ctx) {
  const p = autorefsPath(ctx.projectDir);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const payload = {
    candidatePath: ctx.autoRefs.candidatePath ?? null,
    candidateHash: ctx.autoRefs.candidateHash ?? null,
    candidateGaps: ctx.autoRefs.candidateGaps ?? null,
    scanBaseStateRevision: ctx.autoRefs.scanBaseStateRevision ?? null,
    scanBaseRecordRevision: ctx.autoRefs.scanBaseRecordRevision ?? null,
    applyBaseRevision: ctx.autoRefs.applyBaseRevision ?? null,
    applyRevision: ctx.autoRefs.applyRevision ?? null,
    applyHash: ctx.autoRefs.applyHash ?? null,
    rebaseBaseRevision: ctx.autoRefs.rebaseBaseRevision ?? null,
    approvalHashes: ctx.approvalHashes,
    evidenceHashes: ctx.evidenceHashes,
  };
  await fsp.writeFile(p, JSON.stringify(payload, null, 1), "utf-8");
}
async function loadAutoRefs(ctx) {
  try {
    const payload = JSON.parse(await fsp.readFile(autorefsPath(ctx.projectDir), "utf-8"));
    ctx.autoRefs = { ...ctx.autoRefs, ...payload };
    ctx.approvalHashes = { ...ctx.approvalHashes, ...(payload.approvalHashes ?? {}) };
    ctx.evidenceHashes = { ...ctx.evidenceHashes, ...(payload.evidenceHashes ?? {}) };
  } catch { /* absent: keep in-memory refs */ }
}

async function seedRevision(ctx, patch) {
  const projectDir = ctx.projectDir;
  const { authority, state } = await currentWorld(projectDir);
  const next = structuredClone(state);
  next.parent_revision = state.revision;
  next.parent_hash = state.self_hash;
  next.revision = state.revision + 1;
  const resolver = await makeAdapterResolver(ctx);
  if (patch.sessions_add) {
    for (const spec of patch.sessions_add) {
      const desc = makeDescriptor(spec.descriptor ?? spec, resolver);
      registerSession(next.sessions, desc);
      if (spec.heartbeat === "@now-iso") next.sessions[desc.session_uuid].live_state.heartbeat = nowIso();
      if (spec.heartbeat === "@expired-iso") next.sessions[desc.session_uuid].live_state.heartbeat = "2020-01-01T00:00:00Z";
    }
  }
  if (patch.effects) next.effects = deepResolve(patch.effects, resolver);
  if (patch.queue) next.queue = deepResolve(patch.queue, resolver);
  if (patch.active_run !== undefined) next.active_run = deepResolve(patch.active_run, resolver);
  if (patch.pending_closures !== undefined) next.pending_closures = deepResolve(patch.pending_closures, resolver);
  if (typeof patch.pending_audit === "number") next.pending_audit = patch.pending_audit;
  if (typeof patch.reviews_pad === "string") next.reviews = [{ pad: patch.reviews_pad }];
  if (patch.controller_block === true) next.authorization.controller = { ...next.authorization.controller, blocked: true };
  if (patch.controller_release === true) next.authorization.controller = { ...next.authorization.controller, released_at: nowIso() };
  if (patch.controller_assign) {
    const desc = makeDescriptor(patch.controller_assign, resolver);
    if (!next.sessions[desc.session_uuid]) registerSession(next.sessions, desc);
    next.authorization.controller = { session_uuid: desc.session_uuid, assigned_at: nowIso(), released_at: null, evidence_ref: "ev-genesis.json", blocked: false };
    next.authorization.controller_epoch += 1;
  }
  if (patch.closure_index_set) {
    for (const [sid, ci] of Object.entries(patch.closure_index_set)) {
      if (next.sessions[sid]) next.sessions[sid].closure_index = { closure_head_hash: ci.closure_head_hash ?? GENESIS_PARENT_HASH, closure_count: ci.closure_count ?? 0, recent_entries: [] };
    }
  }
  if (patch.heartbeat_expired) for (const sid of patch.heartbeat_expired) if (next.sessions[sid]) next.sessions[sid].live_state.heartbeat = "2020-01-01T00:00:00Z";
  if (patch.heartbeat_now) for (const sid of patch.heartbeat_now) if (next.sessions[sid]) next.sessions[sid].live_state.heartbeat = nowIso();
  const seedRequestHash = sha256hex("seed-" + next.revision);
  const commitHash = sha256hex("seed-" + next.revision + ":" + seedRequestHash);
  next.applied_operations.push(encodeApplied("seed-" + next.revision, seedRequestHash, next.revision, commitHash, authority.record_revision + 1));
  next.self_hash = computeSelfHash(next);
  await publishSyntheticRevision(projectDir, next, authority.record_revision);
  return { revision: next.revision, hash: next.self_hash };
}

async function cutoverSynth(ctx, spec) {
  const projectDir = ctx.projectDir;
  const { authority, state } = await currentWorld(projectDir);
  const g1a = await readJsonFile(path.join(approvalsDir(projectDir), spec.g1aFile), "adapter.approval");
  const operationId = spec.operationId;
  const { stopRef, stopState } = buildStopRefAndState({ state, authority, operationId, g1a });
  const { candidateRef, candState } = buildCandidateRefAndState({ state: stopState, stopRef, operationId, authority });
  const candFile = path.join(candidatesDir(projectDir), operationId + ".json");
  const io = {};
  const baseEntry = {
    operationId, status: "stopping", principal: "host", callerSessionId: "host-initial",
    parentRevision: stopRef.parentRevision, parentHash: stopRef.parentHash,
    stateUuid: authority.state_uuid, authorityEpoch: authority.epoch,
    approvalRef: spec.g1aFile, approvalHash: g1a.approvalHash, stopRef, entryHash: "",
  };
  const journal = { schema: "cutover-journal/v1", generation: 0, previousHeadHash: GENESIS_JOURNAL_HEAD, headHash: GENESIS_JOURNAL_HEAD, entries: [] };
  const bp = spec.breakpoint;
  const commitEntry = async (entry) => {
    journal.entries = journal.entries.filter((e) => e.operationId !== entry.operationId);
    journal.entries.push(entry);
    journal.generation += 1;
    journal.previousHeadHash = journal.headHash;
    await writeJournalFile(projectDir, journal);
  };
  const buildAbandoned = (fromState) => {
    const { resumeOperation, resumeState } = buildResumeRefAndState({ state: fromState, authority, operationId, g1a });
    const abandoned = {
      ...baseEntry, status: "abandoned", abortEvidenceRef: "ev-abort.json",
      abortEvidenceHash: sha256hex(canonicalJSON({ kind: "abort-evidence", statement: "abandoned by fixture" })),
      resumeOperation,
    };
    return { abandoned, resumeOperation, resumeState };
  };
  if (bp === "stopping_no_file") {
    await commitEntry({ ...baseEntry, status: "stopping" });
    await syncAuthorityJournalAnchors(projectDir, journal);
    return { stopRef, candidateRef };
  }
  if (bp === "stopping_landed") {
    await publishSyntheticRevision(projectDir, stopState, authority.record_revision);
    await commitEntry({ ...baseEntry, status: "stopping" });
    await syncAuthorityJournalAnchors(projectDir, journal);
    return { stopRef, candidateRef };
  }
  if (bp === "stopping_orphan") {
    // journal stopping committed; stop revision materialized but UNPUBLISHED (orphan slot)
    const file = revisionFilePath(projectDir, authority.state_uuid, stopRef.revision);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, canonicalJSON(stopState), io);
    await commitEntry({ ...baseEntry, status: "stopping" });
    await syncAuthorityJournalAnchors(projectDir, journal);
    return { stopRef, candidateRef };
  }
  if (bp === "preparing") {
    await publishSyntheticRevision(projectDir, stopState, authority.record_revision);
    await commitEntry({ ...baseEntry, status: "preparing", candidatePath: candFile, candidateRef });
    await syncAuthorityJournalAnchors(projectDir, journal);
    return { stopRef, candidateRef, candFile };
  }
  if (bp === "prepared") {
    await publishSyntheticRevision(projectDir, stopState, authority.record_revision);
    await fsp.mkdir(path.dirname(candFile), { recursive: true });
    await atomicWrite(candFile, canonicalJSON({ candidatePath: candFile, candidateRef, state: candState }), io);
    await commitEntry({ ...baseEntry, status: "prepared", candidatePath: candFile, candidateRef });
    await syncAuthorityJournalAnchors(projectDir, journal);
    return { stopRef, candidateRef, candFile };
  }
  if (bp === "confirming") {
    await publishSyntheticRevision(projectDir, stopState, authority.record_revision);
    await fsp.mkdir(path.dirname(candFile), { recursive: true });
    await atomicWrite(candFile, canonicalJSON({ candidatePath: candFile, candidateRef, state: candState }), io);
    const g1bFile = spec.g1bFile ?? "app-g1b.json";
    const g1b = await readJsonFile(path.join(approvalsDir(projectDir), g1bFile), "adapter.approval");
    await commitEntry({ ...baseEntry, status: "prepared", candidatePath: candFile, candidateRef });
    await commitEntry({ ...baseEntry, status: "confirming", candidatePath: candFile, candidateRef, confirmApprovalRef: g1bFile, confirmApprovalHash: g1b.approvalHash });
    await syncAuthorityJournalAnchors(projectDir, journal);
    return { stopRef, candidateRef, candFile };
  }
  if (bp === "advance_confirming") {
    // from a prepared breakpoint: advance the journal to confirming with the pre-written G1b
    const g1bFile = spec.g1bFile ?? "app-g1b.json";
    const g1b = await readJsonFile(path.join(approvalsDir(projectDir), g1bFile), "adapter.approval");
    const j = await layerLoadJournal(projectDir);
    journal.entries = j.entries; journal.generation = j.generation; journal.headHash = j.headHash; journal.previousHeadHash = j.previousHeadHash;
    const e = (j.entries ?? []).find((x) => x.operationId === operationId);
    if (!e || !e.candidateRef) throw new Error("advance_confirming requires a prepared entry");
    await commitEntry({ ...e, status: "confirming", confirmApprovalRef: g1bFile, confirmApprovalHash: g1b.approvalHash });
    await syncAuthorityJournalAnchors(projectDir, journal);
    return { stopRef: e.stopRef, candidateRef: e.candidateRef, candFile: e.candidatePath };
  }
  if (bp === "advance_confirmed") {
    // from a prepared breakpoint: publish the journal-recorded candidate revision and commit confirmed
    const g1bFile = spec.g1bFile ?? "app-g1b.json";
    const g1b = await readJsonFile(path.join(approvalsDir(projectDir), g1bFile), "adapter.approval");
    const j = await layerLoadJournal(projectDir);
    journal.entries = j.entries; journal.generation = j.generation; journal.headHash = j.headHash; journal.previousHeadHash = j.previousHeadHash;
    const e = (j.entries ?? []).find((x) => x.operationId === operationId);
    if (!e || !e.candidateRef) throw new Error("advance_confirmed requires a prepared entry");
    const stopDoc = JSON.parse(await fsp.readFile(revisionFilePath(projectDir, authority.state_uuid, e.candidateRef.parentRevision), "utf-8"));
    const rebuilt = structuredClone(stopDoc);
    rebuilt.parent_revision = e.candidateRef.parentRevision;
    rebuilt.parent_hash = e.candidateRef.parentHash;
    rebuilt.revision = e.candidateRef.revision;
    rebuilt.authorization.stop_epoch = e.candidateRef.stopEpoch;
    rebuilt.producer_operation = { ...e.candidateRef };
    rebuilt.self_hash = computeSelfHash(rebuilt);
    rebuilt.producer_operation.hash = rebuilt.self_hash;
    if (rebuilt.self_hash !== e.candidateRef.hash) throw new Error("advance_confirmed: candidate rebuild drifted from the journal candidateRef");
    const au2 = await layerLoadAuthority(projectDir);
    await publishSyntheticRevision(projectDir, rebuilt, au2.record_revision);
    await commitEntry({ ...e, status: "confirmed", confirmApprovalRef: g1bFile, confirmApprovalHash: g1b.approvalHash });
    await syncAuthorityJournalAnchors(projectDir, journal, authority.epoch + 1);
    return { stopRef: e.stopRef, candidateRef: e.candidateRef, candFile: e.candidatePath };
  }
  if (bp === "advance_recovering") {
    // from a confirmed state: add a recovering entry with a pre-written ForwardRecoveryApproval
    const fwFile = spec.fwFile ?? "app-fw.json";
    const fw = await readJsonFile(path.join(approvalsDir(projectDir), fwFile), "adapter.approval");
    const j = await layerLoadJournal(projectDir);
    journal.entries = j.entries; journal.generation = j.generation; journal.headHash = j.headHash; journal.previousHeadHash = j.previousHeadHash;
    const e = (j.entries ?? []).find((x) => x.operationId === operationId);
    if (!e || !e.candidateRef) throw new Error("advance_recovering requires a confirmed entry");
    const rConfirmedRef = { operationId: e.operationId, candidateHash: e.candidateRef.hash, revision: e.candidateRef.revision, hash: e.candidateRef.hash, epoch: e.candidateRef.epoch };
    const au3 = await layerLoadAuthority(projectDir);
    const cur = await layerLoadRevisionFile(projectDir, au3.state_uuid, au3.current_revision);
    const recState = structuredClone(cur);
    recState.parent_revision = cur.revision;
    recState.parent_hash = cur.self_hash;
    recState.revision = cur.revision + 1;
    recState.authorization.stop_epoch = cur.authorization.stop_epoch + 1;
    applyStopTransition(recState, {});
    applyStopTransition(recState, { endedAt: fw.recoveryTimestamp, endReason: "recover_forward", workOutcome: "UNKNOWN" });
    recState.active_run = null;
    const recoveryOpId = spec.recoveryOperationId ?? (operationId + "-r1");
    const recRef0 = { operationId: recoveryOpId + ":recover", kind: "recoverForward", parentRevision: cur.revision, parentHash: cur.self_hash, revision: cur.revision + 1, hash: "", epoch: fw.targetAuthorityEpoch, stopEpoch: cur.authorization.stop_epoch + 1 };
    recState.producer_operation = { ...recRef0 };
    const rh = computeSelfHash(recState);
    recState.self_hash = rh;
    recState.producer_operation.hash = rh;
    recRef0.hash = rh;
    const recovering = {
      operationId: recoveryOpId, status: "recovering", principal: "host", callerSessionId: "host",
      parentRevision: recRef0.parentRevision, parentHash: recRef0.parentHash, stateUuid: au3.state_uuid,
      authorityEpoch: recRef0.epoch, approvalRef: fwFile, approvalHash: fw.approvalHash,
      confirmedRef: rConfirmedRef, recoveryRef: recRef0, entryHash: "",
    };
    await commitEntry(recovering);
    await syncAuthorityJournalAnchors(projectDir, journal);
    return { stopRef: e.stopRef, candidateRef: e.candidateRef, candFile: e.candidatePath, recoveryRef: recRef0 };
  }
  // abandoned family
  if (bp === "abandoned_stop_orphan") {
    // stop revision stays UNPUBLISHED as the orphan; current remains the prepare parent
    const file = revisionFilePath(projectDir, authority.state_uuid, stopRef.revision);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, canonicalJSON(stopState), io);
    const { abandoned, resumeOperation } = buildAbandoned(stopState);
    await commitEntry(abandoned);
    await syncAuthorityJournalAnchors(projectDir, journal);
    return { stopRef, candidateRef, resumeOperation };
  }
  if (bp === "abandoned_no_files") {
    const { abandoned, resumeOperation } = buildAbandoned(state);
    await commitEntry(abandoned);
    await syncAuthorityJournalAnchors(projectDir, journal);
    return { stopRef, candidateRef, resumeOperation };
  }
  if (bp === "abandoned_resume_exists") {
    // stop published, resume revision materialized as an unpublished orphan carrying the resume marker
    await publishSyntheticRevision(projectDir, stopState, authority.record_revision);
    const { abandoned, resumeOperation, resumeState } = buildAbandoned(stopState);
    const resumePayload = { operationRef: operationId };
    const resumeRequestHash = requestHashOf({ command: "resumeAfterAbortedCutover", principal: "host", sessionId: null, operationId, payload: resumePayload });
    resumeState.applied_operations.push(encodeApplied(operationId, resumeRequestHash, resumeOperation.revision, sha256hex(operationId + ":" + resumeRequestHash), authority.record_revision + 1));
    resumeState.self_hash = computeSelfHash(resumeState);
    resumeOperation.hash = resumeState.self_hash;
    abandoned.resumeOperation = resumeOperation;
    const file = revisionFilePath(projectDir, authority.state_uuid, resumeOperation.revision);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, canonicalJSON(resumeState), io);
    await commitEntry(abandoned);
    await syncAuthorityJournalAnchors(projectDir, journal);
    return { stopRef, candidateRef, resumeOperation };
  }
  if (bp === "abandoned_current_is_candidate") {
    const au2 = await layerLoadAuthority(projectDir);
    await publishSyntheticRevision(projectDir, stopState, authority.record_revision);
    const au3 = await layerLoadAuthority(projectDir);
    await publishSyntheticRevision(projectDir, candState, au3.record_revision);
    void au2;
    const { abandoned, resumeOperation } = buildAbandoned(stopState);
    await commitEntry(abandoned);
    await syncAuthorityJournalAnchors(projectDir, journal);
    return { stopRef, candidateRef, resumeOperation };
  }
  throw new Error("unknown cutover breakpoint " + bp);
}

async function runSetupSteps(ctx, steps) {
  ctx.approvalHashes = ctx.approvalHashes ?? {};
  ctx.evidenceHashes = ctx.evidenceHashes ?? {};
  for (const step of steps) {
    if (step.op === "genesis") {
      const resolver = await makeAdapterResolver(ctx);
      const desc = makeDescriptor(step.descriptor ?? {}, resolver);
      await writeEvidenceDoc(ctx, "ev-genesis.json", { kind: "initial-assignment", statement: "genesis evidence" });
      await writeApprovalDoc(ctx, "app-genesis.json", {
        approvalId: "apr-genesis-" + ctx.fixtureId, projectId: "proj-rt1c",
        operationId: "genesis-" + ctx.fixtureId, kind: "assignController",
        allowedCallers: [{ principal: "host", callerSessionId: null }],
        controllerDescriptor: step.descriptor ?? { session_uuid: desc.session_uuid, started_at: step.descriptor?.started_at ?? TS0 },
      });
      await transact({
        projectDir: ctx.projectDir, principal: "host", sessionId: null, expectedRevision: 0,
        operationId: "genesis-" + ctx.fixtureId, command: "assignController",
        payload: { descriptor: desc, evidenceRef: "ev-genesis.json", approvalRef: "app-genesis.json" },
      });
    } else if (step.op === "seed") {
      await seedRevision(ctx, step.patch);
    } else if (step.op === "approval") {
      await writeApprovalDoc(ctx, step.file, step.doc);
    } else if (step.op === "evidence") {
      await writeEvidenceDoc(ctx, step.file, step.doc ?? { kind: "generic-evidence", statement: step.statement ?? "fixture evidence" });
    } else if (step.op === "cutover_synth") {
      await cutoverSynth(ctx, step);
    } else if (step.op === "highwater_ahead") {
      const { authority, state } = await currentWorld(ctx.projectDir);
      const next = structuredClone(state);
      next.parent_revision = state.revision;
      next.parent_hash = state.self_hash;
      next.revision = state.revision + 1;
      const rh = requestHashOf({ command: "applySessionEvent", principal: "session", sessionId: "sess-ctrl", operationId: step.operationId, payload: {} });
      next.applied_operations.push(encodeApplied(step.operationId, rh, next.revision, sha256hex(step.operationId + ":" + rh), authority.record_revision + 1));
      next.self_hash = computeSelfHash(next);
      const io = {};
      const file = revisionFilePath(ctx.projectDir, authority.state_uuid, next.revision);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await atomicWrite(file, canonicalJSON(next), io);
      const hw = await layerLoadHighwater(ctx.projectDir);
      hw[authority.state_uuid] = { record_revision: authority.record_revision + 1, current_revision: next.revision, current_hash: next.self_hash };
      await atomicWrite(highwaterPath(ctx.projectDir), canonicalJSON(hw), io);
    } else if (step.op === "orphan") {
      const { authority, state } = await currentWorld(ctx.projectDir);
      const next = structuredClone(state);
      next.parent_revision = state.revision;
      next.parent_hash = state.self_hash;
      next.revision = state.revision + 1;
      const rh = requestHashOf({ command: step.command ?? "applySessionEvent", principal: step.principal ?? "session", sessionId: step.sessionId ?? "sess-ctrl", operationId: step.operationId, payload: step.payload ?? {} });
      const commitHash = sha256hex(step.operationId + ":" + rh);
      next.applied_operations.push(encodeApplied(step.operationId, rh, next.revision, commitHash, authority.record_revision + 1));
      next.self_hash = computeSelfHash(next);
      const io = {};
      const file = revisionFilePath(ctx.projectDir, authority.state_uuid, next.revision);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await atomicWrite(file, canonicalJSON(next), io);
    } else if (step.op === "orphan_producer") {
      const { authority, state } = await currentWorld(ctx.projectDir);
      const next = structuredClone(state);
      next.parent_revision = state.revision;
      next.parent_hash = state.self_hash;
      next.revision = state.revision + 1;
      const rh = requestHashOf({ command: step.command ?? "applySessionEvent", principal: step.principal ?? "session", sessionId: step.sessionId ?? "sess-ctrl", operationId: step.operationId, payload: step.payload ?? {} });
      next.applied_operations.push(encodeApplied(step.operationId, rh, next.revision, sha256hex(step.operationId + ":" + rh), authority.record_revision + 1));
      next.producer_operation = {
        operationId: step.operationId, kind: "cutover_stop",
        parentRevision: step.wrongField === "parentRevision" ? step.wrongValue : state.revision,
        parentHash: state.self_hash,
        revision: step.wrongField === "revision" ? step.wrongValue : next.revision,
        hash: "",
        epoch: step.wrongField === "epoch" ? step.wrongValue : authority.epoch,
        stopEpoch: step.wrongField === "stopEpoch" ? step.wrongValue : state.authorization.stop_epoch + 1,
      };
      if (step.wrongField === "kind") next.producer_operation.kind = step.wrongValue;
      next.self_hash = computeSelfHash(next);
      const io = {};
      const file = revisionFilePath(ctx.projectDir, authority.state_uuid, next.revision);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await atomicWrite(file, canonicalJSON(next), io);
    } else if (step.op === "fork") {
      const { authority, state } = await currentWorld(ctx.projectDir);
      const io = {};
      for (const spec of step.revisions) {
        const n = state.revision + spec.offset;
        const forkState = structuredClone(state);
        forkState.parent_revision = n - 1;
        forkState.parent_hash = spec.parentHash === "broken" ? sha256hex("broken-" + n) : state.self_hash;
        forkState.revision = n;
        const rh = sha256hex("fork-" + n + "-" + (spec.operationId ?? "fork"));
        forkState.applied_operations = [encodeApplied(spec.operationId ?? ("fork-" + n), rh, n, sha256hex((spec.operationId ?? ("fork-" + n)) + ":" + rh), authority.record_revision + 1)];
        forkState.self_hash = computeSelfHash(forkState);
        const file = revisionFilePath(ctx.projectDir, authority.state_uuid, n);
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await atomicWrite(file, canonicalJSON(forkState), io);
      }
    } else if (step.op === "corrupt_authority") {
      const authority = await layerLoadAuthority(ctx.projectDir);
      const next = { ...authority, ...step.patch };
      await atomicWrite(authorityPath(ctx.projectDir), canonicalJSON(next), {});
    } else if (step.op === "bump_authority_epoch") {
      const authority = await layerLoadAuthority(ctx.projectDir);
      const next = { ...authority, epoch: authority.epoch + 1 };
      await atomicWrite(authorityPath(ctx.projectDir), canonicalJSON(next), {});
    } else if (step.op === "rewind_authority_anchors") {
      // simulate a crash after journal commit but before the authority anchor update:
      // the anchor goes back to the recorded previous generation head (a real lag, not a
      // cosmetic generation decrement), so only the original operation can catch it up
      const authority = await layerLoadAuthority(ctx.projectDir);
      const journal = await layerLoadJournal(ctx.projectDir);
      const resolver = await makeAdapterResolver(ctx);
      const headHash = typeof step.headHash === "string" ? resolver(step.headHash)
        : (step.generations === 1 && journal ? journal.previousHeadHash : sha256hex("stale-anchor-" + (authority.journal_generation - step.generations)));
      const next = { ...authority, journal_generation: authority.journal_generation - step.generations, journal_head_hash: headHash };
      await atomicWrite(authorityPath(ctx.projectDir), canonicalJSON(next), {});
    } else if (step.op === "tamper_journal_entry") {
      const journal = await readJsonFile(journalPath(ctx.projectDir), "journal");
      const e = journal.entries.find((x) => x.operationId === step.operationId);
      if (!e) throw new Error("tamper_journal_entry: unknown operationId " + step.operationId);
      e.entryHash = step.entryHash ?? sha256hex("tampered");
      await atomicWrite(journalPath(ctx.projectDir), canonicalJSON(journal), {});
    } else if (step.op === "tamper_orphan_hash") {
      const authority = await layerLoadAuthority(ctx.projectDir);
      const file = revisionFilePath(ctx.projectDir, authority.state_uuid, authority.current_revision + step.revision_offset);
      const doc = JSON.parse(await fsp.readFile(file, "utf-8"));
      const last = doc.applied_operations[doc.applied_operations.length - 1];
      const parts = last.split(":");
      parts[3] = sha256hex("wrong-commit-hash");
      doc.applied_operations[doc.applied_operations.length - 1] = parts.join(":");
      doc.self_hash = computeSelfHash(doc);
      await atomicWrite(file, canonicalJSON(doc), {});
    } else if (step.op === "rewrite_revision") {
      const authority = await layerLoadAuthority(ctx.projectDir);
      const file = revisionFilePath(ctx.projectDir, authority.state_uuid, step.revision);
      const doc = JSON.parse(await fsp.readFile(file, "utf-8"));
      Object.assign(doc, step.patch);
      doc.self_hash = computeSelfHash(doc);
      await atomicWrite(file, canonicalJSON(doc), {});
    } else if (step.op === "tamper_revision_keep_hash") {
      const authority = await layerLoadAuthority(ctx.projectDir);
      const file = revisionFilePath(ctx.projectDir, authority.state_uuid, step.revision);
      const doc = JSON.parse(await fsp.readFile(file, "utf-8"));
      Object.assign(doc, step.patch ?? { reviews: [{ pad: "tampered-content" }] });
      // deliberately NOT recomputing self_hash: content changed, hash field retained
      await atomicWrite(file, canonicalJSON(doc), {});
    } else if (step.op === "tamper_candidate_skip") {
      // rebuild a self-consistent candidate whose revision jumps parent+3 (skip attack);
      // evidence and index are re-signed so only the continuity check can catch it
      const resolver = await makeAdapterResolver(ctx);
      const file = resolver(step.file);
      const env = JSON.parse(await fsp.readFile(file, "utf-8"));
      env.state.revision = env.state.parent_revision + 3;
      env.state.self_hash = computeSelfHash(env.state);
      env.candidateHash = env.state.self_hash;
      env.candidateRef.revision = env.state.revision;
      env.candidateRef.hash = env.state.self_hash;
      await atomicWrite(file, canonicalJSON(env), {});
      ctx.autoRefs.candidateHash = env.candidateHash;
      const dir = approvalsDir(ctx.projectDir);
      const evPath = path.join(dir, step.evidence);
      const ev = JSON.parse(await fsp.readFile(evPath, "utf-8"));
      ev.candidateHash = env.candidateHash;
      delete ev.evidenceHash;
      ev.evidenceHash = sha256hex(canonicalJSON(ev));
      await fsp.writeFile(evPath, JSON.stringify(ev, null, 1), "utf-8");
      const indexFile = path.join(dir, CANDIDATE_INDEX);
      const idx = JSON.parse(await fsp.readFile(indexFile, "utf-8"));
      for (const e of idx.entries ?? []) if (e.candidatePath === file) e.candidateHash = env.candidateHash;
      await atomicWrite(indexFile, canonicalJSON(idx), {});
      await persistAutoRefs(ctx);
    } else if (step.op === "journal_inject_ref") {
      // 在指定状态条目上注入 ref 字段（闭集负例）
      const j = await layerLoadJournal(ctx.projectDir);
      if (!j) throw new Error("journal_inject_ref: no journal");
      const e = (j.entries ?? []).find((x) => x.operationId === step.operationId);
      if (!e) throw new Error("journal_inject_ref: entry not found");
      e.status = step.status;
      e[step.refName] = step.ref;
      e.entryHash = entryHashOf(e);
      j.headHash = journalHeadHash(j);
      await atomicWrite(journalPath(ctx.projectDir), canonicalJSON(j), {});
    } else if (step.op === "journal_inject_recoveryref") {
      // confirmed 条目另加 recoveredBy（schema 允许）并注入 recovering R 条目
      const j = await layerLoadJournal(ctx.projectDir);
      if (!j) throw new Error("journal_inject_recoveryref: no journal");
      const e = (j.entries ?? []).find((x) => x.operationId === step.rootOperationId && x.status === "confirmed");
      if (!e || !e.candidateRef) throw new Error("journal_inject_recoveryref: confirmed entry not found");
      const resolver0 = await makeAdapterResolver(ctx);
      void resolver0;
      e.recoveredBy = { operationId: "op-c1:recover", kind: "recoverForward", parentRevision: e.candidateRef.revision, parentHash: e.candidateRef.hash, revision: e.candidateRef.revision + 1, hash: "f".repeat(64), epoch: 1, stopEpoch: 1 };
      e.entryHash = entryHashOf(e);
      const recoveryRef = { operationId: step.recoveryOperationId + ":recover", kind: "recoverForward", parentRevision: e.candidateRef.revision, parentHash: e.candidateRef.hash, revision: e.candidateRef.revision + 1, hash: "f".repeat(64), epoch: 1, stopEpoch: 1 };
      const confirmedRef5 = { operationId: e.operationId, candidateHash: e.candidateRef.hash, revision: e.candidateRef.revision, hash: e.candidateRef.hash, epoch: e.candidateRef.epoch };
      const recovering = {
        operationId: step.recoveryOperationId, status: "recovering", principal: "host", callerSessionId: "host",
        parentRevision: recoveryRef.parentRevision, parentHash: recoveryRef.parentHash, stateUuid: e.stateUuid,
        authorityEpoch: 1, approvalRef: "app-g1a.json", approvalHash: e.approvalHash,
        confirmedRef: confirmedRef5, recoveryRef, entryHash: "",
      };
      recovering.entryHash = entryHashOf(recovering);
      j.entries.push(recovering);
      j.generation += 1;
      j.previousHeadHash = j.headHash;
      j.headHash = journalHeadHash(j);
      await atomicWrite(journalPath(ctx.projectDir), canonicalJSON(j), {});
      await syncAuthorityJournalAnchors(ctx.projectDir, j);
    } else if (step.op === "journal_dotdot_path") {
      // 构造绝对前缀＋'recover/../evil' 的未折叠字符串（词法 resolve 会折回根内）
      const j = await layerLoadJournal(ctx.projectDir);
      if (!j) throw new Error("journal_dotdot_path: no journal");
      const e = (j.entries ?? []).find((x) => x.operationId === step.operationId);
      if (!e) throw new Error("journal_dotdot_path: entry not found");
      e.candidatePath = candidatesDir(ctx.projectDir) + "/recover/../" + step.leaf;
      e.entryHash = entryHashOf(e);
      j.headHash = journalHeadHash(j);
      await atomicWrite(journalPath(ctx.projectDir), canonicalJSON(j), {});
    } else if (step.op === "journal_strip_field") {
      const j = await layerLoadJournal(ctx.projectDir);
      if (!j) throw new Error("journal_strip_field: no journal");
      const e = (j.entries ?? []).find((x) => x.operationId === step.operationId);
      if (!e) throw new Error("journal_strip_field: unknown op");
      delete e[step.field];
      e.entryHash = entryHashOf(e);
      j.headHash = journalHeadHash(j);
      await atomicWrite(journalPath(ctx.projectDir), canonicalJSON(j), {});
    } else if (step.op === "journal_raw_extra_key") {
      const j = { schema: "cutover-journal/v1", generation: 0, previousHeadHash: GENESIS_JOURNAL_HEAD, headHash: "", entries: [], extraKey: true };
      j.headHash = journalHeadHash(j);
      await atomicWrite(journalPath(ctx.projectDir), canonicalJSON(j), {});
    } else if (step.op === "tamper_candidate_field_typed") {
      // 类型/闭集攻击: set 路径值后全量重签
      const resolverT = await makeAdapterResolver(ctx);
      const fileT = resolverT(step.file);
      const envT = JSON.parse(await fsp.readFile(fileT, "utf-8"));
      const segs = step.set.path.split(".");
      let ref = envT.state;
      for (let i = 0; i < segs.length - 1; i += 1) ref = ref[segs[i]];
      ref[segs[segs.length - 1]] = step.set.value;
      envT.state.self_hash = computeSelfHash(envT.state);
      envT.candidateHash = envT.state.self_hash;
      envT.candidateRef.hash = envT.state.self_hash;
      await atomicWrite(fileT, canonicalJSON(envT), {});
      ctx.autoRefs.candidateHash = envT.candidateHash;
      const dirT = approvalsDir(ctx.projectDir);
      const evT = path.join(dirT, step.evidence);
      const evDocT = JSON.parse(await fsp.readFile(evT, "utf-8"));
      evDocT.candidateHash = envT.candidateHash;
      delete evDocT.evidenceHash;
      evDocT.evidenceHash = sha256hex(canonicalJSON(evDocT));
      await fsp.writeFile(evT, JSON.stringify(evDocT, null, 1), "utf-8");
      const idxT = JSON.parse(await fsp.readFile(path.join(dirT, CANDIDATE_INDEX), "utf-8"));
      for (const e of idxT.entries ?? []) if (e.candidatePath === fileT) e.candidateHash = envT.candidateHash;
      await atomicWrite(path.join(dirT, CANDIDATE_INDEX), canonicalJSON(idxT), {});
      await persistAutoRefs(ctx);
    } else if (step.op === "forge_ops_marker") {
      // 构造与本次调用完全匹配（requestHash/candidatePath）但指向不存在版本的伪造 marker
      const resolverF = await makeAdapterResolver(ctx);
      const candPathF = ctx.autoRefs.candidatePath;
      const payloadF = { approvalRef: "app-apply.json", evidenceRef: "cand-ev-r1-authority_offline_rebuild.json" };
      const reqHashF = requestHashOf({ command: "applyApproved", principal: "host", sessionId: null, operationId: "op-apply-1", payload: payloadF });
      const hashF = step.forged_hash ? "deadbeef".repeat(8) : sha256hex("op-apply-1:" + reqHashF);
      let revF = step.revision;
      if (revF === "@auto:current_revision") {
        const auF = await layerLoadAuthority(ctx.projectDir);
        revF = auF.current_revision;
      }
      const docF = { schema: "recover-ops/v1", operations: { "op-apply-1": { requestHash: reqHashF, candidateHash: ctx.autoRefs.candidateHash, revision: revF, hash: hashF, candidatePath: candPathF } } };
      await fsp.mkdir(path.dirname(path.join(ctx.projectDir, ".zcode/runtime/recover-ops.json")), { recursive: true });
      await atomicWrite(path.join(ctx.projectDir, ".zcode/runtime/recover-ops.json"), canonicalJSON(docF), {});
    } else if (step.op === "delete_journal") {
      await fsp.unlink(journalPath(ctx.projectDir)).catch((e) => { if (e.code !== "ENOENT") throw e; });
    } else if (step.op === "delete_highwater") {
      await fsp.unlink(highwaterPath(ctx.projectDir));
    } else if (step.op === "journal_raw") {
      // 合成任意 journal 形状 (entryHash/headHash 按 loader 同规则重算, 供装载序负例)
      const resolverJ = await makeAdapterResolver(ctx);
      const j = { schema: "cutover-journal/v1", generation: 1, previousHeadHash: GENESIS_JOURNAL_HEAD, headHash: "", entries: deepResolve(step.entries, resolverJ) };
      for (const e of j.entries) {
        if (e && typeof e === "object" && !Array.isArray(e)) e.entryHash = entryHashOf(e);
      }
      j.headHash = journalHeadHash(j);
      await atomicWrite(journalPath(ctx.projectDir), canonicalJSON(j), {});
    } else if (step.op === "tamper_candidate_field") {
      // 候选嵌套结构攻击: 改字段后全量重签 (self_hash/candidateHash/evidence/index 一致),
      // 只有结构校验能拦
      const resolver0 = await makeAdapterResolver(ctx);
      const file0 = resolver0(step.file);
      const env0 = JSON.parse(await fsp.readFile(file0, "utf-8"));
      if (step.set_null) env0.state[step.set_null] = null;
      if (step.delete_field) {
        const [a, b] = step.delete_field.split(".");
        if (b) delete env0.state[a][b]; else delete env0.state[a];
      }
      env0.state.self_hash = computeSelfHash(env0.state);
      env0.candidateHash = env0.state.self_hash;
      env0.candidateRef.hash = env0.state.self_hash;
      await atomicWrite(file0, canonicalJSON(env0), {});
      ctx.autoRefs.candidateHash = env0.candidateHash;
      const dir0 = approvalsDir(ctx.projectDir);
      const evPath0 = path.join(dir0, step.evidence);
      const ev0 = JSON.parse(await fsp.readFile(evPath0, "utf-8"));
      ev0.candidateHash = env0.candidateHash;
      delete ev0.evidenceHash;
      ev0.evidenceHash = sha256hex(canonicalJSON(ev0));
      await fsp.writeFile(evPath0, JSON.stringify(ev0, null, 1), "utf-8");
      const indexFile0 = path.join(dir0, CANDIDATE_INDEX);
      const idx0 = JSON.parse(await fsp.readFile(indexFile0, "utf-8"));
      for (const e of idx0.entries ?? []) if (e.candidatePath === file0) e.candidateHash = env0.candidateHash;
      await atomicWrite(indexFile0, canonicalJSON(idx0), {});
      await persistAutoRefs(ctx);
    } else if (step.op === "delete_revision") {
      const authority = await layerLoadAuthority(ctx.projectDir);
      const file = revisionFilePath(ctx.projectDir, authority.state_uuid, step.revision);
      await fsp.unlink(file);
    } else if (step.op === "closures") {
      const dir = closuresDir(ctx.projectDir);
      await fsp.mkdir(dir, { recursive: true });
      const resolver = await makeAdapterResolver(ctx);
      if (step.archive) {
        const archive = deepResolve(step.archive, resolver);
        await fsp.writeFile(path.join(dir, step.archive_file ?? "archive.json"), canonicalJSON(archive), "utf-8");
      }
      if (step.index) {
        const index = deepResolve(step.index, resolver);
        await fsp.writeFile(path.join(dir, "index.json"), canonicalJSON(index), "utf-8");
      }
    } else if (step.op === "archive_pending_closures") {
      const { state } = await currentWorld(ctx.projectDir);
      const sids = Object.keys(state.pending_closures);
      const entries = sids.map((sid) => {
        const closure = state.pending_closures[sid].closure;
        return { session_uuid: sid, ended_at: closure.ended_at, end_reason: closure.end_reason, work_outcome: closure.work_outcome, final_revision: closure.final_revision };
      });
      const head = entries.length ? sha256hex(canonicalJSON(entries)) : GENESIS_PARENT_HASH;
      const dir = closuresDir(ctx.projectDir);
      await fsp.mkdir(dir, { recursive: true });
      const archive = { schema: "closure-archive/v1", entries };
      await fsp.writeFile(path.join(dir, "archive.json"), canonicalJSON(archive), "utf-8");
      const index = { schema: "closure-index/v1", head_hash: head, count: entries.length, archive_files: [{ file: "archive.json", file_hash: sha256hex(canonicalJSON(archive)) }] };
      await fsp.writeFile(path.join(dir, "index.json"), canonicalJSON(index), "utf-8");
      const { authority, state: cur } = await currentWorld(ctx.projectDir);
      const next = structuredClone(cur);
      next.parent_revision = cur.revision;
      next.parent_hash = cur.self_hash;
      next.revision = cur.revision + 1;
      for (const sid of sids) {
        if (next.sessions[sid]) {
          next.sessions[sid].live_state.lifecycle = "CLOSED";
          next.sessions[sid].closure_index = { closure_head_hash: head, closure_count: entries.length, recent_entries: [] };
        }
        delete next.pending_closures[sid];
      }
      const caReq = sha256hex("closure-archive-" + next.revision);
      next.applied_operations.push(encodeApplied("closure-archive-" + next.revision, caReq, next.revision, sha256hex("closure-archive-" + next.revision + ":" + caReq), authority.record_revision + 1));
      next.self_hash = computeSelfHash(next);
      await publishSyntheticRevision(ctx.projectDir, next, authority.record_revision);
    } else if (step.op === "lock") {
      const lp = lockPath(ctx.projectDir);
      await fsp.mkdir(path.dirname(lp), { recursive: true });
      await fsp.writeFile(lp, canonicalJSON({ owner_token: step.ownerToken ?? crypto.randomBytes(16).toString("hex"), pid: process.pid, operationId: step.operationId ?? "op-foreign", acquired_at: nowIso() }) + "\n", "utf-8");
    } else if (step.op === "build_candidate") {
      const scan = await recoverScan({ projectDir: ctx.projectDir });
      let source = null;
      if (step.kind) source = scan.candidates.find((c) => c.kind === step.kind) ?? null;
      if (!source && step.revision !== undefined) {
        const resolver = await makeAdapterResolver(ctx);
        const wanted = deepResolve(step.revision, resolver);
        source = scan.candidates.find((c) => c.revision === wanted) ?? null;
      }
      if (!source) throw new Error("build_candidate: no scan source (kind=" + step.kind + " rev=" + step.revision + ")");
      const res = await buildCandidate({ sourceRevision: source });
      ctx.autoRefs.candidatePath = res.candidatePath;
      ctx.autoRefs.candidateHash = res.candidateHash;
      ctx.autoRefs.candidateGaps = res.gaps;
      ctx.autoRefs.scanBaseStateRevision = scan.baseStateRevision;
      ctx.autoRefs.scanBaseRecordRevision = scan.baseRecordRevision;
      ctx.lastScan = scan;
    } else if (step.op === "apply_interface") {
      const resolver = await makeAdapterResolver(ctx);
      const params = deepResolve(step.params, resolver);
      ctx.autoRefs.applyBaseRevision = params.expectedRevision;
      const res = await applyApproved(params);
      ctx.autoRefs.applyRevision = res.revision;
      ctx.autoRefs.applyHash = res.hash;
    } else if (step.op === "rebase_interface") {
      const resolver = await makeAdapterResolver(ctx);
      const params = deepResolve(step.params, resolver);
      ctx.autoRefs.rebaseBaseRevision = params.expectedRevision;
      await checkpointRebase(params);
    } else if (step.op === "raw") {
      const target = path.resolve(ctx.projectDir, step.file);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, step.text, "utf-8");
    } else if (step.op === "symlink") {
      const resolver = await makeAdapterResolver(ctx);
      const target = path.resolve(ctx.projectDir, resolver(step.file));
      await fsp.mkdir(path.dirname(target), { recursive: true });
      try { await fsp.unlink(target); } catch { /* absent */ }
      await fsp.symlink(resolver(step.target), target);
    } else if (step.op === "symlink_candidate") {
      const resolver = await makeAdapterResolver(ctx);
      const link = resolver(step.link);
      await fsp.unlink(link);
      await fsp.symlink(resolver(step.target), link);
    } else if (step.op === "tamper_approval") {
      const dir = approvalsDir(ctx.projectDir);
      const doc = JSON.parse(await fsp.readFile(path.join(dir, step.file), "utf-8"));
      doc.statement = "mutated after signing";
      await fsp.writeFile(path.join(dir, step.file), JSON.stringify(doc, null, 1), "utf-8");
    } else if (step.op === "tamper_candidate") {
      const resolver = await makeAdapterResolver(ctx);
      const file = resolver(step.file);
      const doc = JSON.parse(await fsp.readFile(file, "utf-8"));
      doc.state.reviews = [{ pad: "tampered" }];
      await fsp.writeFile(file, JSON.stringify(doc, null, 1), "utf-8");
    } else {
      throw new Error("unknown setup op " + step.op);
    }
  }
  await persistAutoRefs(ctx);
}

// ------------------------------------------------------------ probes
function countRevisionFiles(projectDir) {
  const base = path.join(runtimeDir(projectDir), "state");
  if (!fs.existsSync(base)) return 0;
  let n = 0;
  for (const dir of fs.readdirSync(base)) {
    const d = path.join(base, dir);
    if (!fs.statSync(d).isDirectory()) continue;
    n += fs.readdirSync(d).filter((f) => /^r-\d+\.json$/.test(f)).length;
  }
  return n;
}

async function runViaAction(ctx, via) {
  // child-side journal-only continuation used by fresh-process probes
  const projectDir = ctx.projectDir;
  if (via === "prepare_retry") {
    const authority = await layerLoadAuthority(projectDir);
    const journal = await layerLoadJournal(projectDir);
    const entry = (journal?.entries ?? []).find((e) => e.status === "stopping");
    if (!entry) return { exit: 1, error: { code: "no_journal_entry", exitCode: 1, stage: "via", operationId: null, message: "no stopping entry", retryable: false } };
    const r = await transact({
      projectDir, principal: "host", sessionId: null, expectedRevision: authority.current_revision,
      operationId: entry.operationId, command: "prepare",
      payload: { approvalRef: entry.approvalRef, operationRef: entry.operationId, stopEvidenceRef: "ev-g1a-stop.json" },
    });
    return { exit: 0, result: { revision: r.revision, hash: r.hash } };
  }
  if (via === "resume_retry") {
    const authority = await layerLoadAuthority(projectDir);
    const journal = await layerLoadJournal(projectDir);
    const entry = (journal?.entries ?? []).find((e) => e.status === "abandoned");
    if (!entry) return { exit: 1, error: { code: "no_journal_entry", exitCode: 1, stage: "via", operationId: null, message: "no abandoned entry", retryable: false } };
    const r = await transact({
      projectDir, principal: "host", sessionId: null, expectedRevision: authority.current_revision,
      operationId: entry.operationId, command: "resumeAfterAbortedCutover",
      payload: { operationRef: entry.operationId },
    });
    return { exit: 0, result: { revision: r.revision, hash: r.hash } };
  }
  if (via === "read_candidate") {
    await loadAutoRefs(ctx);
    const p = ctx.autoRefs.candidatePath;
    if (!p || !fs.existsSync(p)) return { exit: 1, error: { code: "candidate_missing", exitCode: 1, stage: "via", operationId: null, message: "candidate absent", retryable: false } };
    const env = JSON.parse(await fsp.readFile(p, "utf-8"));
    return { exit: 0, result: { candidatePath: env.candidatePath ?? p, candidateHash: env.candidateHash ?? null, readonly: true } };
  }
  throw new Error("unknown via " + via);
}

async function runProbe(ctx, probe, action, observed) {
  const projectDir = ctx.projectDir;
  const resolver = await makeAdapterResolver(ctx);
  const out = {};
  if (probe.kind === "readonly") {
    const b = observed.before, a = observed.after;
    out.authority = !!b.authority_hash && b.authority_hash === a.authority_hash;
    out.highwater = (b.highwater_hash ?? null) === (a.highwater_hash ?? null);
    out.journal = (b.journal_hash ?? null) === (a.journal_hash ?? null);
    out.current_self = (b.current_self_hash ?? null) === (a.current_self_hash ?? null);
  } else if (probe.kind === "controller_retained") {
    out.same_session = observed.before.controller?.session_uuid === observed.after.controller?.session_uuid;
    out.same_assigned_at = observed.before.controller?.assigned_at === observed.after.controller?.assigned_at;
    out.same_evidence_ref = observed.before.controller?.evidence_ref === observed.after.controller?.evidence_ref;
  } else if (probe.kind === "candidate_state") {
    let p = ctx.autoRefs.candidatePath;
    if (!p) {
      const jj = await layerLoadJournal(projectDir).catch(() => null);
      const ent = (jj?.entries ?? []).find((x) => x.candidatePath);
      p = ent?.candidatePath ?? null;
    }
    if (p && fs.existsSync(p)) {
      const env = JSON.parse(await fsp.readFile(p, "utf-8"));
      out.path = p;
      out.hash = env.candidateHash ?? env.candidateRef?.hash ?? null;
      out.hash_ok = out.hash !== null && env.state && env.state.self_hash === out.hash && computeSelfHash(env.state) === out.hash;
      out.gaps = env.gaps ?? [];
      out.gaps_present = Array.isArray(env.gaps);
      const ev = await loadCandidateEvidence(projectDir, p, null).catch(() => null);
      out.evidence_ref = ev?.evidenceRef ?? null;
      out.evidence_hash_ok = ev !== null;
    } else {
      out.path = null;
      out.hash_ok = false;
      out.gaps_present = false;
      out.evidence_hash_ok = false;
    }
  } else if (probe.kind === "bases") {
    const bases = observed.result?.baseRecordRevision !== undefined
      ? { rec: observed.result.baseRecordRevision, st: observed.result.baseStateRevision }
      : ctx.lastScan ? { rec: ctx.lastScan.baseRecordRevision, st: ctx.lastScan.baseStateRevision }
        : { rec: ctx.autoRefs.scanBaseRecordRevision, st: ctx.autoRefs.scanBaseStateRevision };
    out.baseRecordRevision = bases.rec ?? null;
    out.baseStateRevision = bases.st ?? null;
    out.highwaterRecord = observed.before.hw_record_revision ?? null;
    out.immutableLatest = observed.before.current_revision ?? null;
    out.record_ok = out.baseRecordRevision !== null && out.baseRecordRevision === out.highwaterRecord;
    out.state_ok = out.baseStateRevision !== null && out.baseStateRevision === out.immutableLatest;
  } else if (probe.kind === "rebase_report") {
    const authority = await layerLoadAuthority(projectDir).catch(() => null);
    const manifest = await readJsonFile(manifestPath(projectDir), "manifest").catch(() => null);
    const tail = manifest?.rebase_index?.[manifest.rebase_index.length - 1] ?? null;
    out.manifest_tail = tail;
    out.manifest_epoch = tail?.epoch ?? null;
    out.manifest_final_revision = tail?.final_revision ?? null;
    out.new_state_uuid = observed.result?.stateUuid ?? tail?.new_state_uuid ?? null;
    out.changed = observed.before.state_uuid !== observed.after.state_uuid;
    out.epoch = observed.after.epoch ?? null;
    if (observed.result && authority) {
      const revFile = revisionFilePath(projectDir, observed.result.stateUuid, observed.result.revision);
      let revDoc = null;
      try { revDoc = JSON.parse(await fsp.readFile(revFile, "utf-8")); } catch { revDoc = null; }
      out.revision_file_state_uuid = revDoc?.state_uuid ?? null;
      out.postread_ok = revDoc !== null && revDoc.state_uuid === observed.result.stateUuid
        && revDoc.revision === observed.result.revision
        && authority.state_uuid === observed.result.stateUuid
        && authority.current_revision === observed.result.revision
        && tail !== null && tail.epoch === observed.result.epoch && tail.new_state_uuid === observed.result.stateUuid;
    } else {
      out.postread_ok = false;
    }
    out.old_versions_kept = (observed.before.revision_files ?? 0) > 0 && countRevisionFiles(projectDir) >= (observed.before.revision_files ?? 0);
    out.old_final_hash_indexed = tail !== null && observed.before.current_self_hash !== null && tail.final_hash === observed.before.current_self_hash;
  } else if (probe.kind === "rebuild_candidate") {
    const scan = await recoverScan({ projectDir });
    const source = scan.candidates.find((c) => c.kind === (probe.sourceKind ?? "candidate_rebuild"));
    if (!source) { out.equal = false; out.hash = null; out.journal_hash = null; out.same_path = false; }
    else {
      const res = await buildCandidate({ sourceRevision: source });
      const journal = await layerLoadJournal(projectDir);
      const e = (journal?.entries ?? []).find((x) => x.candidateRef);
      out.hash = res.candidateHash;
      out.journal_hash = e?.candidateRef?.hash ?? null;
      out.equal = res.candidateHash === out.journal_hash;
      out.same_path = res.candidatePath === e?.candidatePath;
      out.three_way = out.equal && out.same_path;
    }
  } else if (probe.kind === "trace") {
    const p = [...TRACE];
    out.path = p;
    out.offline_steps = p.filter((t) => t.startsWith("offline.step")).length;
    out.lock_oxcl = p.includes("offline.lock_oxcl");
    out.uses_transact = p.some((t) => t.startsWith("transact"));
    out.uses_run_state_primitives = p.includes("run_state.atomicWrite");
  } else if (probe.kind === "ordinary_write") {
    const a = await layerLoadAuthority(projectDir);
    try {
      await writeEvidenceDoc(ctx, "ev-ow.json", { kind: "generic-evidence", statement: "ordinary write probe" });
      await writeApprovalDoc(ctx, "app-ow.json", { approvalId: "apr-ow-" + ctx.fixtureId, projectId: "proj-rt1c", kind: "safeWrite", allowedCallers: [{ principal: "session", callerSessionId: "sess-ctrl" }] });
      const r = await transact({ projectDir, principal: "session", sessionId: "sess-ctrl", expectedRevision: a.current_revision, operationId: "op-ow-" + ctx.fixtureId, command: "applySessionEvent", payload: { event: { event_id: "evt-ow", session_uuid: "sess-ctrl", kind: "inbox_message", evidence_ref: "ev-ow.json", payload: {}, created_at: nowIso(), status: "recorded" }, evidenceRef: "ev-ow.json", approvalRef: "app-ow.json", callerSessionId: "sess-ctrl" } });
      out.outcome = "passed";
      out.revision = r.revision;
    } catch (e) {
      out.outcome = e.code ? "denied" : "error";
      out.code = e.code ?? null;
      out.stage = e.stage ?? null;
    }
  } else if (probe.kind === "recover_forward_retry") {
    const params0 = deepResolve(probe.params, resolver);
    const beforeFiles0 = countRevisionFiles(projectDir);
    let first = null, second = null;
    try { first = await transact(params0); } catch (e) { first = { __denied: e.code ?? "error" }; }
    const auMid = await layerLoadAuthority(projectDir);
    const secondParams = { ...params0, expectedRevision: auMid.current_revision };
    try { second = await transact(secondParams); } catch (e) { second = { __denied: e.code ?? "error" }; }
    out.first_outcome = first && first.__denied ? "denied" : "passed";
    out.second_outcome = second && second.__denied ? "denied" : "passed";
    out.first_revision = first?.revision ?? null;
    out.second_revision = second?.revision ?? null;
    out.first_hash = first?.hash ?? null;
    out.second_hash = second?.hash ?? null;
    out.same_revision = out.first_revision !== null && out.first_revision === out.second_revision;
    out.files_added = countRevisionFiles(projectDir) - beforeFiles0;
  } else if (probe.kind === "transact_direct_rebase") {
    // store-side gate proof: calling run-store rebase directly on a pending-closures state
    const params0 = deepResolve(probe.params, resolver);
    try {
      await transact(params0);
      out.outcome = "passed-unexpectedly";
    } catch (e) {
      out.outcome = "denied";
      out.code = e.code ?? null;
      out.stage = e.stage ?? null;
    }
  } else if (probe.kind === "transact_replay") {
    const params = deepResolve(probe.params, resolver);
    try {
      const r = await transact(params);
      out.outcome = "passed";
      out.revision = r.revision;
      out.recordRevision = r.recordRevision;
    } catch (e) {
      out.outcome = e.code ? "denied" : "error";
      out.code = e.code ?? null;
      out.stage = e.stage ?? null;
    }
    const filesNow = countRevisionFiles(projectDir);
    out.files_after = filesNow;
    out.files_added = filesNow - (ctx.filesAtProbeStart ?? filesNow);
  } else if (probe.kind === "commit_operation") {
    let ref = deepResolve(probe.operationRef, resolver);
    if (probe.tamper && ref && typeof ref === "object") {
      ref = { ...ref };
      if (probe.tamper.revision === "+1") ref.revision += 1;
      if (probe.tamper.hash === "wrong") ref.hash = sha256hex("wrong-ref-hash");
    }
    try {
      const r = await commitOperation({ projectDir, operationRef: ref });
      out.outcome = "passed";
      out.revision = r.revision;
    } catch (e) {
      out.outcome = e.code ? "denied" : "error";
      out.code = e.code ?? null;
    }
    out.files_after = countRevisionFiles(projectDir);
    out.files_added = out.files_after - (ctx.filesAtProbeStart ?? out.files_after);
  } else if (probe.kind === "fresh_action") {
    const childArgs = [fileURLToPath(import.meta.url), "--self-test", "--fixtures", ctx.fixturesPath, "--temp-root", ctx.tempRoot, "--only", ctx.fixtureId, "--no-setup", "--step", ctx.fixtureId + ":" + ctx.vectorIndex];
    if (probe.via) childArgs.push("--via", probe.via);
    const child = spawnSync(process.execPath, childArgs, { encoding: "utf-8", timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 });
    const text = (child.stdout || "") + (child.stderr || "");
    const line = text.split("\n").find((l) => l.startsWith("__RUN_RECOVER_STEP_RESULT__"));
    if (!line) {
      out.ok = false;
      out.rc = child.status;
      out.tail = text.slice(-200);
    } else {
      const payload = JSON.parse(line.slice("__RUN_RECOVER_STEP_RESULT__".length));
      out.ok = true;
      out.fresh_process = true;
      out.exit = payload.exit;
      out.result = payload.result ?? null;
      out.error = payload.error ?? null;
      if (payload.result && typeof payload.result === "object") {
        out.revision = payload.result.revision ?? null;
        out.hash = payload.result.hash ?? null;
        out.candidate_path = payload.result.candidatePath ?? null;
        out.candidate_hash = payload.result.candidateHash ?? null;
      }
    }
  } else if (probe.kind === "fresh_read_candidate") {
    const childArgs = [fileURLToPath(import.meta.url), "--self-test", "--fixtures", ctx.fixturesPath, "--temp-root", ctx.tempRoot, "--only", ctx.fixtureId, "--no-setup", "--step", ctx.fixtureId + ":" + ctx.vectorIndex, "--via", probe.via ?? "read_candidate"];
    const child = spawnSync(process.execPath, childArgs, { encoding: "utf-8", timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 });
    const text = (child.stdout || "") + (child.stderr || "");
    const line = text.split("\n").find((l) => l.startsWith("__RUN_RECOVER_STEP_RESULT__"));
    if (!line) { out.ok = false; out.rc = child.status; }
    else {
      const payload = JSON.parse(line.slice("__RUN_RECOVER_STEP_RESULT__".length));
      out.ok = true;
      out.fresh_process = true;
      out.path = payload.result?.candidatePath ?? null;
      out.hash = payload.result?.candidateHash ?? null;
    }
    if (ctx.autoRefs.candidatePath && fs.existsSync(ctx.autoRefs.candidatePath)) {
      out.byte_hash_parent = sha256hex(fs.readFileSync(ctx.autoRefs.candidatePath, "utf-8"));
      if (out.path && fs.existsSync(out.path)) out.byte_hash_child = sha256hex(fs.readFileSync(out.path, "utf-8"));
      out.bytes_equal = out.byte_hash_parent === out.byte_hash_child;
    }
  } else if (probe.kind === "token_old") {
    const before = ctx.beforeState;
    const { state } = await currentWorld(projectDir);
    const token = {
      state_uuid: ctx.beforeAuthority?.state_uuid ?? "su-x", session_uuid: before?.authorization?.controller?.session_uuid ?? "sess-x",
      effect_id: (before?.effects?.[0] ?? {}).effect_id ?? "eff-x", operation_id: "op-x",
      controller_epoch: before?.authorization?.controller_epoch ?? 0, stop_epoch: before?.authorization?.stop_epoch ?? 0,
      claimed_revision: before?.revision ?? 0,
    };
    out.verify = verifyClaimToken(state, token);
    out.verify_in_use = verifyClaimTokenInUse(state, token, "op-x");
  } else if (probe.kind === "guard") {
    out.results = [];
    let symlinkCase = null;
    if (probe.symlink_case) {
      const link = probe.symlink_case.link;
      try { await fsp.unlink(link); } catch { /* absent */ }
      await fsp.symlink(probe.symlink_case.target, link);
      symlinkCase = link;
    }
    try {
      for (const p of probe.paths) {
        const g = await guardRecoverTempRoot(p);
        out.results.push({ path: p, ok: g.ok, reason: g.reason ?? null });
      }
      if (symlinkCase) {
        const g = await guardRecoverTempRoot(symlinkCase);
        out.results.push({ path: symlinkCase, ok: g.ok, reason: g.reason ?? null });
      }
    } finally {
      if (symlinkCase) await fsp.unlink(symlinkCase).catch(() => {});
    }
    out.main_repo_rejected = (out.results[0]?.ok === false);
    out.skill_repo_rejected = (out.results[1]?.ok === false);
    out.traversal_rejected = out.results.slice(2, 4).every((r) => r.ok === false);
    out.symlink_rejected = out.results.length > 4 && out.results[4].ok === false;
  } else if (probe.kind === "cli_temp_root_reject") {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--self-test", "--temp-root", probe.path], { encoding: "utf-8", timeout: 60_000, killSignal: "SIGKILL" });
    const text = (child.stdout || "") + (child.stderr || "");
    out.rc = child.status;
    out.token = text.includes("temp-root rejected");
    out.no_files = !fs.existsSync(path.join(probe.path, ".zcode", "runtime"));
  } else if (probe.kind === "production_check") {
    out.runtime_absent = !fs.existsSync(PROD_RUNTIME);
  } else if (probe.kind === "extra_args") {
    const fn = { recoverScan, buildCandidate, applyApproved, checkpointRebase }[probe.interface];
    try {
      await fn(deepResolve(probe.params, resolver));
      out.outcome = "passed-unexpectedly";
    } catch (e) {
      out.outcome = "denied";
      out.code = e.code ?? null;
    }
  } else if (probe.kind === "forward_branch") {
    const doc = await readJsonFile(path.join(approvalsDir(projectDir), probe.file), "probe.approval");
    const four = ["controllerDescriptor", "assignedAt", "controllerEvidenceRef", "controllerEvidenceHash"];
    const present = four.filter((k) => doc[k] !== undefined);
    out.four_present = present.length;
    out.branch = present.length === 4 ? "controller-preset" : present.length === 0 ? "no-controller" : "invalid-mixed";
    out.valid = present.length === 0 || present.length === 4;
    try {
      const params = deepResolve(probe.misuse, resolver);
      await transact(params);
      out.misuse_outcome = "passed-unexpectedly";
    } catch (e) {
      out.misuse_outcome = "denied";
      out.misuse_code = e.code ?? null;
    }
  } else if (probe.kind === "count_approvals") {
    const dir = approvalsDir(projectDir);
    out.count = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length : 0;
    out.before = ctx.approvalsBefore ?? null;
    out.unchanged = out.before !== null && out.count === out.before;
  } else if (probe.kind === "input_hash_crosslang") {
    // real subprocess recomputation with the run-state canonical serializer (no self-attestation)
    const code = 'const { canonicalJSON, sha256hex } = await import("file://' + path.join(SCRIPT_DIR, "run-state.mjs") + '");'
      + 'const fs = await import("node:fs/promises");'
      + 'const doc = JSON.parse(await fs.readFile(' + JSON.stringify(ctx.fixturesPath) + ', "utf-8"));'
      + 'const v = doc.vectors.find((x) => x.fixture_id === ' + JSON.stringify(ctx.fixtureId) + ');'
      + 'const target = v && v.fixture_id ? null : v;'
      + 'const vectors = doc.vectors.filter((x) => x.fixture_id === ' + JSON.stringify(ctx.fixtureId) + ');'
      + 'const want = vectors[' + ctx.vectorIndex + '];'
      + 'process.stdout.write(sha256hex(canonicalJSON(want.input)));';
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf-8", timeout: 60_000, killSignal: "SIGKILL" });
    const recomputed = (child.stdout || "").trim();
    const vector = ctx.vector;
    out.ok = child.status === 0 && recomputed.length === 64 && recomputed === vector.input_hash;
    out.child_rc = child.status;
    out.recomputed_prefix = recomputed.slice(0, 12);
  } else if (probe.kind === "transact_corrupt_deny") {
    // observable depth-defense proof: transact cannot serve a damaged-authority project
    try {
      await transact({ projectDir, principal: "host", sessionId: null, expectedRevision: 0, operationId: "probe-transact-corrupt", command: "applyApproved", payload: { approvalRef: "app-apply.json", evidenceRef: "ev-genesis.json" } });
      out.outcome = "passed-unexpectedly";
    } catch (e) {
      out.outcome = "denied";
      out.code = e.code ?? null;
    }
  } else if (probe.kind === "canonical_files_ok") {
    // observable run-state primitive evidence: authoritative files re-serialize canonically byte-equal
    let ok = true;
    for (const f of [authorityPath(projectDir), highwaterPath(projectDir)]) {
      try {
        const text = await fsp.readFile(f, "utf-8");
        ok = ok && canonicalJSON(JSON.parse(text)) === text;
      } catch { ok = false; }
    }
    out.ok = ok;
  } else if (probe.kind === "installed_exact_candidate") {
    const authority = await layerLoadAuthority(projectDir).catch(() => null);
    out.live_hash = authority?.current_hash ?? null;
    out.candidate_hash = ctx.autoRefs.candidateHash ?? null;
    out.exact = out.live_hash !== null && out.live_hash === out.candidate_hash;
  } else if (probe.kind === "anchors" || probe.kind === "anchors_after") {
    const authority = await layerLoadAuthority(projectDir).catch(() => null);
    if (!authority) { out.equal = false; }
    else {
      const journal = await layerLoadJournal(projectDir).catch(() => null);
      if (journal) out.equal = authority.journal_head_hash === journal.headHash && authority.journal_generation === journal.generation;
      else out.equal = authority.journal_generation === 0 && authority.journal_head_hash === GENESIS_JOURNAL_HEAD;
    }
  } else if (probe.kind === "authority_keys") {
    const authority = await layerLoadAuthority(projectDir).catch(() => null);
    out.keys = authority ? Object.keys(authority).length : 0;
    out.expected_keys = 12;
  } else if (probe.kind === "lock_exists") {
    out.exists = fs.existsSync(lockPath(projectDir));
  } else if (probe.kind === "effects_kept") {
    const { state } = await currentWorld(projectDir).catch(() => ({ state: null }));
    out.effects_kept = (state?.effects ?? []).some((e) => e.effect_id === "eff-1" && e.state === "running");
  } else if (probe.kind === "lineage_ok") {
    const authority = await layerLoadAuthority(projectDir).catch(() => null);
    if (!authority) { out.ok = false; }
    else {
      const file = revisionFilePath(projectDir, authority.state_uuid, authority.current_revision);
      try {
        const r = await validateRevision({ revisionPath: file });
        out.ok = r.valid === true;
      } catch (error) {
        // post-rebase parents legitimately live in another state dir: cross-uuid verification
        if (error.code === "io_load_failed" && /parent_load/.test(error.stage ?? "")) {
          const doc = await readJsonFile(file, "probe.lineage", null);
          const v = await verifySourceLineage(projectDir, authority.state_uuid, doc);
          out.ok = v.ok === true && computeSelfHash(doc) === doc.self_hash;
        } else {
          out.ok = false;
        }
      }
    }
  } else if (probe.kind === "applied_self_hash_ok") {
    const authority = await layerLoadAuthority(projectDir).catch(() => null);
    if (!authority) { out.ok = false; }
    else {
      const r = await validateRevision({ revisionPath: revisionFilePath(projectDir, authority.state_uuid, authority.current_revision) }).catch(() => ({ valid: false }));
      out.ok = r.valid === true;
    }
  } else if (probe.kind === "input_hash_crosslang") {
    out.ok = true; // the harness load closure already recomputed every input_hash with run-state canonical JSON
  } else {
    throw new Error("unknown probe kind " + probe.kind);
  }
  return out;
}

async function snapshotWorld(projectDir) {
  const snap = { exists: true };
  try {
    const authority = await layerLoadAuthority(projectDir);
    const state = (typeof authority.state_uuid === "string" && authority.state_uuid.length > 0)
      ? await layerLoadRevisionFile(projectDir, authority.state_uuid, authority.current_revision)
      : null; // B-4: 损坏 state_uuid 场景仍能快照权威面（无裸 TypeError；revision 派生字段置空）
    snap.authority_hash = sha256hex(await fsp.readFile(authorityPath(projectDir), "utf-8"));
    try { snap.highwater_hash = sha256hex(await fsp.readFile(highwaterPath(projectDir), "utf-8")); } catch { snap.highwater_hash = null; }
    try { const hwSnap = await layerLoadHighwater(projectDir); void hwSnap; } catch { snap.highwater_invalid = true; }
    try { snap.journal_hash = sha256hex(await fsp.readFile(journalPath(projectDir), "utf-8")); } catch { snap.journal_hash = null; }
    snap.current_self_hash = state ? state.self_hash : null;
    snap.current_revision = authority.current_revision;
    snap.record_revision = authority.record_revision;
    snap.epoch = authority.epoch;
    snap.state_uuid = authority.state_uuid;
    snap.controller = state ? { ...state.authorization.controller } : null;
    snap.controller_epoch = state ? state.authorization.controller_epoch : null;
    snap.stop_epoch = state ? state.authorization.stop_epoch : null;
    snap.revision_files = countRevisionFiles(projectDir);
    snap.pending_audit = state ? state.pending_audit : null;
    snap.active_run_session = state ? (state.active_run?.session_uuid ?? null) : null;
    snap.pending_closures_count = state ? Object.keys(state.pending_closures ?? {}).length : null;
    let hw = {};
    try { hw = await layerLoadHighwater(projectDir); } catch { hw = {}; }
    snap.hw_record_revision = hw[authority.state_uuid]?.record_revision ?? null;
    return snap;
  } catch (error) {
    return { exists: false, snapshot_error: String(error?.message ?? error) };
  }
}

// ------------------------------------------------------------ assertion engine
function getPath(root, p) {
  if (p === "$.result.keys") return root.result ? Object.keys(root.result).sort() : undefined;
  if (p === "$.error.keys") return root.error ? Object.keys(root.error).sort() : undefined;
  if (typeof p !== "string" || !p.startsWith("$.")) return undefined;
  let cur = root;
  for (const seg of p.slice(2).split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (/^\d+$/.test(seg) && Array.isArray(cur)) cur = cur[Number(seg)];
    else if (typeof cur === "object") cur = cur[seg];
    else return undefined;
  }
  return cur;
}
function stripCloneForHash(src) {
  const copy = structuredClone(src);
  delete copy.self_hash;
  if (copy.producer_operation && typeof copy.producer_operation === "object") {
    const po = { ...copy.producer_operation };
    delete po.hash;
    copy.producer_operation = po;
  }
  return copy;
}
async function resolveAssertionValue(value, observed, ctx) {
  if (typeof value !== "string" || !value.startsWith("@")) return value;
  if (value.startsWith("@after:")) return getPath(observed, "$.after." + value.slice("@after:".length));
  if (value === "@probe:applied_revision") return ctx.autoRefs.applyRevision ?? null;
  if (value === "@probe:applied_hash") return ctx.autoRefs.applyHash ?? null;
  if (value.startsWith("@probe:")) return getPath(observed, "$.probes." + value.slice("@probe:".length).replace(/[.]/g, ".")) ?? observed.probes[value.slice("@probe:".length)];
  const resolver = await makeAdapterResolver(ctx);
  const world = await currentWorld(ctx.projectDir).catch(() => null);
  const before = observed.before ?? {};
  if (/^@scan:baseStateRevision([+-]\d+)$/.test(value)) {
    const base = getPath(observed, "$.result.baseStateRevision") ?? getPath(observed, "$.before.current_revision") ?? ctx.autoRefs.scanBaseStateRevision ?? (world ? world.authority.current_revision : 0);
    const m = /^([+-])(\d+)$/.exec(value.slice("@scan:baseStateRevision".length));
    return base + (m[1] === "-" ? -1 : 1) * Number(m[2]);
  }
  if (value === "@auto:current_revision") return before.current_revision ?? (world ? world.authority.current_revision : 0);
  if (/^@auto:stop_epoch([+-]\d+)$/.test(value)) {
    const base = before.stop_epoch ?? world?.state?.authorization?.stop_epoch ?? 0;
    const m = /^([+-])(\d+)$/.exec(value.slice("@auto:stop_epoch".length));
    return base + (m[1] === "-" ? -1 : 1) * Number(m[2]);
  }
  if (value.startsWith("@auto:candidate_hash:")) {
    const opId = value.slice("@auto:candidate_hash:".length);
    const journal = await layerLoadJournal(ctx.projectDir).catch(() => null);
    const e = (journal?.entries ?? []).find((x) => x.operationId === opId);
    return e?.candidateRef?.hash ?? value;
  }
  if (value.startsWith("@auto:candidates_dir/")) return path.join(candidatesDir(ctx.projectDir), value.slice("@auto:candidates_dir/".length));
  if (value === "@auto:journal_head_hash") {
    const journal = await layerLoadJournal(ctx.projectDir).catch(() => null);
    return journal ? journal.headHash : GENESIS_JOURNAL_HEAD;
  }
  return resolver(value);
}
async function evalAssertion(observed, a, ctx) {
  const actual = getPath(observed, a.path);
  const value = await resolveAssertionValue(a.value, observed, ctx);
  const deepEq = (x, y) => {
    if (x === y) return true;
    if (x === null || y === null || typeof x !== "object" || typeof y !== "object") return false;
    try { return canonicalJSON(x) === canonicalJSON(y); } catch { return false; }
  };
  switch (a.op) {
    case "eq": return deepEq(actual, value);
    case "ne": return !deepEq(actual, value);
    case "exists": return actual !== undefined;
    case "absent": return actual === undefined;
    case "lt": return typeof actual === "number" && typeof value === "number" && actual < value;
    case "lte": return typeof actual === "number" && typeof value === "number" && actual <= value;
    case "hash_eq": {
      const srcPath = typeof a.value === "object" && a.value !== null ? a.value.of : value?.of;
      const src = getPath(observed, srcPath);
      if (!src || typeof src !== "object") return false;
      return sha256hex(canonicalJSON(stripCloneForHash(src))) === actual;
    }
    default: return false;
  }
}

// ------------------------------------------------------------ vector runner
const INTERFACE_FNS = { recoverScan, buildCandidate, applyApproved, checkpointRebase };

async function resolveActionParams(ctx, action) {
  const resolver = await makeAdapterResolver(ctx);
  if (action.preScan) {
    const scan = await recoverScan({ projectDir: ctx.projectDir });
    ctx.lastScan = scan;
    ctx.autoRefs.scanBaseStateRevision = scan.baseStateRevision;
    ctx.autoRefs.scanBaseRecordRevision = scan.baseRecordRevision;
  }
  const raw = deepResolve(action.params ?? {}, resolver);
  // resolve scan-source sentinels that must become objects
  const walk = (v) => {
    if (typeof v === "string" && v.startsWith("@scan:source:")) return resolveScanSourceSentinel(ctx, v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return walk(raw);
}

async function runVector(vector, ctx) {
  const fid = vector.fixture_id;
  const input = vector.input;
  traceReset();
  setHarnessFault(null);
  if (!ctx.noSetup) {
    // fresh materialization per vector: a reused temp root must never inherit stale projects
    await fsp.rm(ctx.projectDir, { recursive: true, force: true });
  }
  const preSetup = await snapshotWorld(ctx.projectDir);
  if (!ctx.noSetup) {
    await fsp.mkdir(ctx.projectDir, { recursive: true });
    await runSetupSteps(ctx, input.setup.steps ?? []);
  } else {
    await loadAutoRefs(ctx);
  }
  const before = await snapshotWorld(ctx.projectDir);
  {
    const adir = approvalsDir(ctx.projectDir);
    ctx.approvalsBefore = fs.existsSync(adir) ? fs.readdirSync(adir).filter((f) => f.endsWith(".json")).length : 0;
  }
  ctx.beforeAuthority = before.exists ? await layerLoadAuthority(ctx.projectDir).catch(() => null) : null;
  ctx.beforeState = before.exists && ctx.beforeAuthority ? await layerLoadRevisionFile(ctx.projectDir, ctx.beforeAuthority.state_uuid, ctx.beforeAuthority.current_revision).catch(() => null) : null;
  ctx.filesAtProbeStart = before.exists ? before.revision_files : 0;
  const action = input.action;
  traceReset();
  ctx.vector = vector;
  let params = {};
  try {
    params = await resolveActionParams(ctx, action);
  } catch (e) {
    params = { __resolve_error: e };
  }
  setHarnessFault(input.fault ?? null);
  let result = null;
  let error = null;
  if (params && params.__resolve_error) {
    error = params.__resolve_error;
  } else {
    try {
      result = await INTERFACE_FNS[action.interface](params);
    } catch (e) {
      error = e;
    }
  }
  setHarnessFault(null);
  if (result && typeof result === "object" && result.candidatePath) {
    ctx.autoRefs.candidatePath = result.candidatePath;
    ctx.autoRefs.candidateHash = result.candidateHash;
    ctx.autoRefs.candidateGaps = result.gaps;
    await persistAutoRefs(ctx);
  }
  const after = await snapshotWorld(ctx.projectDir);
  const deltaNum = (a, b) => (Number.isInteger(a) && Number.isInteger(b)) ? a - b : null;
  const deltas = before.exists && after.exists ? {
    revision: deltaNum(after.current_revision, before.current_revision),
    epoch: deltaNum(after.epoch, before.epoch),
    controller_epoch: deltaNum(after.controller_epoch, before.controller_epoch),
    stop_epoch: deltaNum(after.stop_epoch, before.stop_epoch),
    record_revision: deltaNum(after.record_revision, before.record_revision),
    revision_files: deltaNum(after.revision_files, before.revision_files),
  } : { revision: 0, epoch: 0, controller_epoch: 0, stop_epoch: 0, record_revision: 0, revision_files: 0 };
  const observed = {
    fixture_id: fid,
    vector_index: ctx.vectorIndex,
    interface: action.interface,
    deltas,
    seq_deltas: after.exists ? {
      controller_epoch: after.controller_epoch - (preSetup.exists ? preSetup.controller_epoch : 1),
      revision: after.current_revision - (preSetup.exists ? preSetup.current_revision : 0),
    } : {},
    before,
    after,
    probes_trace: [...TRACE],
    probes: {},
  };
  let actualExit;
  let classification;
  if (error) {
    observed.error = errorPayload(error);
    observed.error_fields_ok = harnessFieldCheck(error);
    const isBlocked = observed.error.code === "blocked";
    actualExit = isBlocked ? "blocked" : observed.error.exitCode;
    classification = isBlocked ? "blocked" : "denied";
  } else if (result && result.status === "blocked") {
    observed.result = result;
    actualExit = "blocked";
    classification = "blocked";
  } else {
    observed.result = result;
    actualExit = 0;
    classification = TRACE.includes("layer.offline_rebuild") ? "recovered" : "passed";
  }
  observed.actual_exit = actualExit;
  observed.classification = classification;
  // probes: run declared probes first, then implicit *_after twins for count_approvals, then
  // auto-run configuration-free probes referenced by assertion paths but not declared
  for (const probe of action.probes ?? []) {
    try {
      observed.probes[probe.name ?? probe.kind] = await runProbe(ctx, probe, action, observed);
    } catch (e) {
      observed.probes[probe.name ?? probe.kind] = { probe_error: String(e?.message ?? e) };
    }
  }
  for (const probe of action.probes ?? []) {
    const name = probe.name ?? probe.kind;
    if (name.endsWith("_before") && probe.kind === "count_approvals") {
      const afterName = name.slice(0, -"_before".length) + "_after";
      try {
        observed.probes[afterName] = await runProbe(ctx, { kind: "count_approvals" }, action, observed);
      } catch (e) {
        observed.probes[afterName] = { probe_error: String(e?.message ?? e) };
      }
    }
  }
  const AUTO_PROBES = new Set(["readonly", "controller_retained", "candidate_state", "bases", "rebase_report", "trace", "anchors", "anchors_after", "authority_keys", "lock_exists", "effects_kept", "lineage_ok", "applied_self_hash_ok", "input_hash_crosslang", "token_old", "production_check", "fresh_read_candidate", "ordinary_write", "count_approvals", "rebuild_candidate"]);
  for (const a of vector.expected_state.assertions) {
    const m = /^ \$?\.?probes\.([A-Za-z0-9_]+)/.exec(" " + a.path);
    if (!m) continue;
    const name = m[1];
    if (observed.probes[name] === undefined && AUTO_PROBES.has(name)) {
      try {
        observed.probes[name] = await runProbe(ctx, { kind: name }, action, observed);
      } catch (e) {
        observed.probes[name] = { probe_error: String(e?.message ?? e) };
      }
    }
  }
  // assertions
  const assertions = [];
  let allOk = true;
  for (const a of vector.expected_state.assertions) {
    const ok = await evalAssertion(observed, a, ctx);
    if (!ok) allOk = false;
    assertions.push({ ...a, actual: getPath(observed, a.path), ok });
  }
  const exitOk = actualExit === vector.expected_exit;
  const fieldsOk = !observed.error || observed.error_fields_ok === true;
  const terminalOk = classification === vector.expected_state.terminal;
  // R2-7: revision_delta participates in the vector verdict (expectation flip 1->0 must redden)
  // 损坏权威面（current_revision 不可读）时 delta 不可测：期望 0 且实测无推进即视为满足
  const deltaOk = deltas.revision === vector.expected_state.revision_delta
    || (deltas.revision === null && vector.expected_state.revision_delta === 0);
  // R1-14: declared evidence relative names must point at THIS vector's output pattern
  let evidenceOk = true;
  for (const evName of vector.expected_state.evidence) {
    if (evName.replace(/^runs\//, "") !== fid + "-" + ctx.vectorIndex + "/observed.json") evidenceOk = false;
  }
  // snapshot read failures surface as harness errors instead of silently passing with delta=0
  const snapshotError = before.snapshot_error || after.snapshot_error;
  observed.assertions = assertions;
  observed.delta_ok = deltaOk;
  observed.evidence_ok = evidenceOk;
  if (snapshotError) observed.harness_error = "snapshot failure: " + snapshotError;
  const vectorOk = allOk && exitOk && fieldsOk && terminalOk && deltaOk && evidenceOk && !snapshotError;
  return { observed, vectorOk, exitOk, allOk, terminalOk, fieldsOk };
}

// ------------------------------------------------------------ summary tokens
function tokenEval(idResults) {
  const ok = (fid) => (idResults[fid] ?? []).length > 0 && (idResults[fid] ?? []).every((r) => r.vectorOk);
  const at = (fid, idx) => (idResults[fid] ?? [])[idx];
  const okIdx = (fid, idx) => at(fid, idx)?.vectorOk === true;
  const cls = (fid, idx) => at(fid, idx)?.observed.classification;
  const deniedIdx = (fid, idx) => okIdx(fid, idx) && cls(fid, idx) === "denied";
  const blockedIdx = (fid, idx) => okIdx(fid, idx) && cls(fid, idx) === "blocked";
  const errCode = (fid, idx) => at(fid, idx)?.observed.error?.code ?? null;
  const probeOf = (fid, idx, name) => at(fid, idx)?.observed.probes?.[name];
  const tokens = [];
  const P = (name, cond) => tokens.push({ name, pass: cond === true });
  P("scan_classification=PASS", ["F-R-001", "F-R-002", "F-R-003", "F-R-004", "F-R-005"].every(ok));
  P("journal_reconcile=PASS", ["F-R-006", "F-R-007", "F-R-008", "F-R-009", "F-R-010", "F-R-011", "F-R-012", "F-R-013", "F-R-014"].every(ok));
  P("orphan_unique_claim=PASS", ["F-R-002", "F-R-012", "F-R-022", "F-R-023"].every(ok));
  P("approval_fail_closed=PASS", ["F-R-019", "F-R-020", "F-R-021", "F-R-029", "F-R-034"].every(ok));
  P("controller_assignment=PASS", ["F-R-026", "F-R-027", "F-R-028"].every(ok));
  P("historical_not_live=PASS", ok("F-R-017"));
  P("audit_gaps=PASS", okIdx("F-R-016", 0) && ok("F-R-017") && ok("F-R-018") && ok("F-R-039"));
  P("fresh_process=PASS", ok("F-R-015") && ok("F-R-025"));
  P("io_fail_closed=PASS", ok("F-R-041"));
  P("forged_approval_hash=denied", deniedIdx("F-R-019", 0) && errCode("F-R-019", 0) === "approval_hash_mismatch");
  P("expired_approval_base=denied", deniedIdx("F-R-019", 1) && errCode("F-R-019", 1) === "approval_base_mismatch");
  P("stale_candidate=denied", deniedIdx("F-R-021", 0) && errCode("F-R-021", 0) === "stale_candidate");
  P("g1a_g1b_misuse=denied", [0, 1, 2, 3, 4, 5].every((i) => deniedIdx("F-R-020", i) && errCode("F-R-020", i) === "approval_kind_mismatch"));
  P("forward_recovery_active_branches=PASS", ok("F-R-020"));
  P("active_wrong_descriptor=denied", deniedIdx("F-R-026", 2) && errCode("F-R-026", 2) === "controller_descriptor_mismatch");
  P("duplicate_or_wrong_orphan=blocked", ok("F-R-022") && ok("F-R-023") && blockedIdx("F-R-022", 0));
  P("journal_authority_anchor=PASS", ok("F-R-024"));
  P("fresh_process_retry=PASS", ok("F-R-025"));
  P("active_controller=PASS", okIdx("F-R-026", 0) && okIdx("F-R-026", 1));
  P("inactive_or_blocked_controller=PASS", [0, 1, 2].every((i) => okIdx("F-R-028", i) && deniedIdx("F-R-028", i)));
  P("inactive_direct_rebase=active_controller_required", okIdx("F-R-027", 0) && errCode("F-R-027", 0) === "active_controller_required");
  P("two_interface_recovery_sequence=PASS", okIdx("F-R-027", 1) && okIdx("F-R-032", 1) && okIdx("F-R-032", 2));
  P("g1a_journal_only_recovery=PASS", ok("F-R-015"));
  P("authority_rebuild=PASS", okIdx("F-R-016", 0) && probeOf("F-R-016", 0, "installed_exact_candidate")?.exact === true);
  P("offline_transact_not_used=PASS", okIdx("F-R-016", 0) && probeOf("F-R-016", 0, "trace")?.uses_transact === false);
  P("run_state_primitives=PASS", okIdx("F-R-016", 0) && probeOf("F-R-016", 0, "trace")?.uses_run_state_primitives === true && probeOf("F-R-016", 0, "canonical_files_ok")?.ok === true);
  P("offline_lock_ox=PASS", okIdx("F-R-016", 0) && probeOf("F-R-016", 0, "trace")?.lock_oxcl === true && blockedIdx("F-R-016", 4));
  P("offline_seven_steps=7/7", okIdx("F-R-016", 0) && probeOf("F-R-016", 0, "trace")?.offline_steps === 7);
  P("authority_fields=12/12", okIdx("F-R-016", 0) && probeOf("F-R-016", 0, "authority_keys")?.keys === 12);
  P("base_record_revision=VERIFIED", okIdx("F-R-016", 0) && probeOf("F-R-016", 0, "bases")?.record_ok === true);
  P("base_state_revision=VERIFIED", okIdx("F-R-016", 0) && probeOf("F-R-016", 0, "bases")?.state_ok === true);
  P("expected_revision_null_zero=denied", deniedIdx("F-R-016", 1) && deniedIdx("F-R-016", 2) && deniedIdx("F-R-016", 3));
  P("new_epoch=PASS", okIdx("F-R-016", 0) && at("F-R-016", 0).observed.deltas.epoch === 1);
  P("candidate_cross_process=PASS", okIdx("F-R-017", 0) && okIdx("F-R-025", 1));
  P("candidate_evidence_hash=PASS", okIdx("F-R-017", 0) && probeOf("F-R-017", 0, "candidate_state")?.evidence_hash_ok === true);
  P("io_exit_three=PASS", ok("F-R-041") && (idResults["F-R-041"] ?? []).every((r) => r.observed.actual_exit === 3));
  P("history_not_live=PASS", okIdx("F-R-017", 0));
  P("unresolved_effects=blocked", blockedIdx("F-R-030", 0));
  P("closure_lag=blocked", ok("F-R-031") && (idResults["F-R-031"] ?? []).length >= 6 && (idResults["F-R-031"] ?? []).filter((r, i) => i !== 8).every((r) => r.observed.classification === "blocked"));
  P("inactive_direct_rebase=denied", deniedIdx("F-R-027", 0));
  P("active_rebase_controller_epoch_delta=0", okIdx("F-R-026", 1) && at("F-R-026", 1).observed.deltas.controller_epoch === 0);
  P("recovery_sequence=PASS", okIdx("F-R-027", 1) && okIdx("F-R-032", 1));
  P("rebase_postread_shape=PASS", okIdx("F-R-032", 0) && ok("F-R-033"));
  P("rebase_replay_original_revision_hash=PASS", okIdx("F-R-036", 1));
  P("old_token=denied", ok("F-R-033") && probeOf("F-R-033", 0, "token_old")?.verify === false);
  P("rebase_replay_delta=0", okIdx("F-R-036", 1) && at("F-R-036", 1).observed.deltas.revision === 0);
  return tokens;
}

async function loadFixtures(fixturesPath) {
  const text = await fsp.readFile(fixturesPath, "utf-8");
  const doc = JSON.parse(text);
  if (doc.schema_version !== "run-recovery-fixtures/v1") throw new Error("fixtures schema_version mismatch");
  if (doc.invariants_ref !== "references/11-runtime-state.md#invariant-registry") throw new Error("invariants_ref mismatch");
  const vectors = doc.vectors;
  for (const v of vectors) {
    const recomputed = sha256hex(canonicalJSON(v.input));
    if (recomputed !== v.input_hash) {
      throw new Error("input_hash mismatch for " + v.fixture_id + " (cross-language canonical closure broken)");
    }
  }
  return { doc, vectors };
}

async function runVectorChildAction(vector, ctx, via) {
  const action = vector.input.action;
  if (via) {
    setHarnessFault(vector.input.fault ?? null);
    try {
      const r = await runViaAction(ctx, via);
      setHarnessFault(null);
      return r;
    } catch (e) {
      setHarnessFault(null);
      const p = errorPayload(e);
      return { exit: p.code === "blocked" ? "blocked" : p.exitCode, error: p };
    }
  }
  const params = await resolveActionParams(ctx, action);
  setHarnessFault(vector.input.fault ?? null);
  try {
    const result = await INTERFACE_FNS[action.interface](params);
    setHarnessFault(null);
    return { exit: 0, result };
  } catch (e) {
    setHarnessFault(null);
    const p = errorPayload(e);
    return { exit: p.code === "blocked" ? "blocked" : p.exitCode, error: p };
  }
}

async function runSelfTest({ fixturesPath, tempRoot, only = null, noSetup = false, step = null, via = null }) {
  const { vectors } = await loadFixtures(fixturesPath);
  const runRoot = tempRoot;
  if (step) {
    const [fid, idxStr] = step.split(":");
    const idx = Number(idxStr);
    const vector = vectors.filter((v) => v.fixture_id === fid)[idx];
    if (!vector) throw new Error("step vector not found: " + step);
    const ctx = {
      runRoot, fixtureId: fid, vectorIndex: idx, projectDir: path.join(runRoot, fid, String(idx), "proj"),
      extras: {}, autoRefs: {}, approvalHashes: {}, evidenceHashes: {}, fixturesPath, tempRoot: runRoot, noSetup: true,
    };
    let childResult;
    try {
      await loadAutoRefs(ctx);
      childResult = await runVectorChildAction(vector, ctx, via);
    } catch (e) {
      childResult = { exit: 3, error: errorPayload(e) };
    }
    console.log("__RUN_RECOVER_STEP_RESULT__" + JSON.stringify(childResult));
    return { rc: 0, runRoot };
  }
  const selected = only ? vectors.filter((v) => only.includes(v.fixture_id)) : vectors;
  const results = [];
  const idResults = {};
  let denyCount = 0, blockedCount = 0, ioCount = 0, passCount = 0, recoveredCount = 0;
  for (let i = 0; i < selected.length; i += 1) {
    const vector = selected[i];
    const fid = vector.fixture_id;
    const idx = selected.slice(0, i).filter((v) => v.fixture_id === fid).length;
    const ctx = {
      runRoot, fixtureId: fid, vectorIndex: idx, projectDir: path.join(runRoot, fid, String(idx), "proj"),
      extras: {}, autoRefs: {}, approvalHashes: {}, evidenceHashes: {}, fixturesPath, tempRoot: runRoot, noSetup,
    };
    let out;
    try {
      out = await runVector(vector, ctx);
    } catch (e) {
      const observed = { fixture_id: fid, vector_index: idx, harness_error: String(e?.message ?? e), error: errorPayload(e), classification: "failed", deltas: { revision: 0, epoch: 0, controller_epoch: 0 } };
      out = { observed, vectorOk: false, exitOk: false, allOk: false, terminalOk: false, fieldsOk: false };
    }
    const evidenceDir = path.join(runRoot, "runs", fid + "-" + idx);
    await fsp.mkdir(evidenceDir, { recursive: true });
    await fsp.writeFile(path.join(evidenceDir, "observed.json"), JSON.stringify(out.observed, null, 1), "utf-8");
    // R14: every declared evidence relative name must point at THIS vector's freshly written output
    const declared = vector.expected_state.evidence;
    const evidenceExists = declared.length > 0 && declared.every((evName) => evName === "runs/" + fid + "-" + idx + "/observed.json" && fs.existsSync(path.join(runRoot, evName)));
    if (!evidenceExists) {
      out.observed.evidence_ok = false;
      out.vectorOk = false;
      console.log(`    FAIL evidence-declared=${JSON.stringify(declared)} expected=["runs/${fid}-${idx}/observed.json"] :: 证据相对名必须逐 vector 指向本次输出`);
    }
    results.push({ fid, idx, ...out });
    if (!idResults[fid]) idResults[fid] = [];
    idResults[fid].push({ vectorOk: out.vectorOk, observed: out.observed });
    const cls = out.observed.classification;
    if (cls === "denied" && out.observed.actual_exit === 3) ioCount += 1;
    else if (cls === "denied") denyCount += 1;
    else if (cls === "blocked") blockedCount += 1;
    else if (cls === "recovered") { recoveredCount += 1; passCount += 1; }
    else if (cls === "passed") passCount += 1;
    const status = out.vectorOk ? "PASS" : "FAIL";
    const o = out.observed;
    const failBits = out.vectorOk ? "" : ` !ok:${!out.exitOk ? "exit " : ""}${!out.allOk ? "assert " : ""}${!out.terminalOk ? "terminal " : ""}${!out.fieldsOk ? "fields" : ""}`;
    console.log(`${status} ${fid}#${idx} exit=${o.actual_exit}(exp=${vector.expected_exit}) terminal=${o.classification}(exp=${vector.expected_state.terminal}) rev=Δ${o.deltas.revision} epoch=Δ${o.deltas.epoch} ctrl=Δ${o.deltas.controller_epoch} evidence=runs/${fid}-${idx}/observed.json${failBits}`);
    if (!out.vectorOk) {
      for (const a of o.assertions ?? []) {
        if (!a.ok) console.log(`    FAIL ${a.path} ${a.op} ${JSON.stringify(a.value)} actual=${JSON.stringify(a.actual)} :: ${a.message}`);
      }
      if (o.harness_error) console.log("    harness_error=" + o.harness_error);
    }
  }
  const failed = results.filter((r) => !r.vectorOk);
  const distinctIds = [...new Set(selected.map((v) => v.fixture_id))];
  const skipIds = distinctIds.filter((id) => !(idResults[id] ?? []).length);
  const tokens = tokenEval(idResults);
  const tokenLine = tokens.map((t) => t.pass ? t.name : t.name + "(FAIL)").join(" ");
  const counts = { passed: passCount, recovered: recoveredCount, denied: denyCount, blocked: blockedCount, io_exit3: ioCount };
  console.log("matrix " + tokenLine);
  console.log(`deny_family counts=${JSON.stringify(counts)}`);
  console.log(`self-test 汇总：fixtures=${distinctIds.length} vectors=${selected.length} failed=${failed.length} skip_ids=${skipIds.length}`);
  if (failed.length === 0 && skipIds.length === 0 && tokens.every((t) => t.pass)) console.log("self-test 全过（run-recovery）");
  console.log("run_root=" + runRoot);
  return { rc: failed.length === 0 && skipIds.length === 0 && tokens.every((t) => t.pass) ? 0 : 1, runRoot };
}

async function main(argv) {
  const args = argv.slice(2);
  const selfTest = args.includes("--self-test");
  let fixtures = DEFAULT_FIXTURES;
  let tempRoot = DEFAULT_TEMP_ROOT;
  let only = null;
  let noSetup = false;
  let step = null;
  let via = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--fixtures") { fixtures = args[i + 1]; i += 1; }
    else if (args[i] === "--temp-root") { tempRoot = args[i + 1]; i += 1; }
    else if (args[i] === "--only") { only = args[i + 1].split(",").map((s) => s.trim()).filter(Boolean); i += 1; }
    else if (args[i] === "--no-setup") noSetup = true;
    else if (args[i] === "--step") { step = args[i + 1]; i += 1; }
    else if (args[i] === "--via") { via = args[i + 1]; i += 1; }
    else if (args[i] === "--self-test") { /* flag */ }
    else {
      console.error("run-recover: unknown argument " + args[i] + " (accepted: --self-test --fixtures <path> --temp-root <path> --only <ids> --no-setup --step <id:idx> --via <name>)");
      return 1;
    }
  }
  if (!selfTest) {
    console.log("run-recover: no-op without --self-test (no fixture execution, no writes)");
    return 0;
  }
  const guard = await guardRecoverTempRoot(tempRoot);
  if (!guard.ok) {
    console.error("temp-root rejected (" + guard.reason + "): " + tempRoot);
    return 1;
  }
  tempRoot = guard.resolved;
  if (!fs.existsSync(fixtures)) {
    console.error("run-recover: fixtures file missing: " + fixtures);
    return 3;
  }
  try {
    const { rc } = await runSelfTest({ fixturesPath: fixtures, tempRoot, only, noSetup, step, via });
    return rc;
  } catch (e) {
    console.error("run-recover self-test harness failure: " + (e?.message ?? e));
    return 3;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then((rc) => process.exit(rc));
}
