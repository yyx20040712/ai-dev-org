#!/usr/bin/env node
// run-session.mjs — RT1D session registry and control lease (Task 1D)
// Eight interfaces (single object parameter each, projectDir first, unified
// return carrying revision):
//   assignController({ projectDir, principal, callerSessionId?, newDescriptor, evidenceRef, evidenceHash, approvalRef, approvalHash, expectedRevision, operationId }) -> { sessionUuid, controllerEpoch, revision }
//   openSession({ projectDir, principal, callerSessionId?, descriptor, expectedRevision, operationId }) -> { sessionUuid, revision }
//   applySessionEvent({ projectDir, principal, callerSessionId?, eventId, evidenceRef?, evidenceHash?, approvalRef?, approvalHash?, expectedRevision, operationId }) -> { sessionUuid, revision }
//   heartbeat({ projectDir, principal, callerSessionId?, sessionUuid, observedAt, evidenceRef, expectedRevision, operationId }) -> { revision }
//   sweepExpired({ projectDir, now, callerSessionId, evidenceRef?, evidenceHash?, approvalRef?, approvalHash?, expectedRevision, operationId }) -> { revision }
//   closeSession({ projectDir, sessionUuid, closure, callerSessionId, evidenceRef, evidenceHash, approvalRef?, approvalHash?, expectedRevision, operationId }) -> { revision }
//   startRun({ projectDir, principal, callerSessionId?, sessionUuid, runUuid, expectedRevision, operationId }) -> { revision }
//   endRun({ projectDir, principal, callerSessionId?, sessionUuid, runUuid, expectedRevision, operationId }) -> { revision }
// Write-path dispatch (taskbook RT1D §3.4-B, single source): delegation domain =
// assignController exactly one command through run-store transact (same evaluator,
// structural equivalence); self-write domain = the other seven interfaces through the
// exported run-store primitives (transactLocked + twelve helpers) in a lock-inner
// sequence aligned with the transactLocked source as single reference. Heartbeat-expiry
// takeover = caller-side two-step explicit sequence (sweepExpired, then assignController
// with expectedRevision = step-1 revision; no embedded orchestration).
// --self-test is the batch-local harness; without --self-test this file runs no fixture
// and performs no writes. Dependency direction: run-session -> run-store -> run-state
// (read-only reuse, no cycles).
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  RunStoreError, canonicalJSON, sha256hex, computeApprovalHash,
  atomicWrite, GENESIS_PARENT_HASH, HEX64,
} from "./run-state.mjs";
import {
  transact, readCurrent,
  transactLocked, acquireLock, releaseLock, loadAuthority, loadRevisionFile,
  publishRevision, controllerActive, assertControllerWrite, requestHashOf,
  writeRequestApprovalBinding, loadApprovalDoc, assertApprovalGate, loadEvidence,
  CAPACITY_LIMITS, FROZEN_JOURNAL_STATES, UNRESOLVED_EFFECT_STATES,
} from "./run-store.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES = path.join(SCRIPT_DIR, ".golden", "run-session-fixtures.json");
const DEFAULT_TEMP_ROOT = "/tmp/rt1d-executor-selftest";
const TEMP_PREFIX = "/tmp/rt1d-executor-";
const TS0 = "2026-11-05T10:00:00Z";
const HEARTBEAT_EXPIRY_MS = 30 * 60 * 1000; // docs/14:329 session-type timeout (30 min, run-store parity)
const RECENT_ENTRIES_LIMIT = 10;
const RUNTIME_REL = path.join(".zcode", "runtime");
const INBOX_FILE = "session-events.jsonl";
const EVENT_LEDGER_FILE = "session-events-applied.jsonl";
const CLOSURE_INDEX_FILE = path.join(".zcode", "closure-index.jsonl"); // 裁定五: 项目根 .zcode/closure-index.jsonl（docs/14:299）
const ARCHIVE_REL = path.join("docs", "evidence", "session-closures");
const DESCRIPTOR_KEYS = ["session_uuid", "project_id", "kind", "role", "started_at", "parent_session_id", "resume_of", "cfg_hash", "route_snapshot", "binding_snapshot_ref", "binding_snapshot_hash"];
const SESSION_ROLES = ["controller", "worker", "recovery"];
const EVENT_KEYS = ["event_id", "session_uuid", "kind", "evidence_ref", "payload", "created_at", "status"];
const CLOSURE_KEYS = ["ended_at", "end_reason", "work_outcome", "final_revision", "final_artifacts", "unresolved", "successor"];
const CLOSURE_OPTIONAL_KEYS = ["evidence_ref"];
const TERMINAL_WORK_OUTCOMES = ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "STALLED", "STOPPED"];
const TERMINAL_LIFECYCLES = ["CLOSED", "INTERRUPTED", "UNKNOWN"];

// harness-only fixed clock (self-test threads a deterministic window; production
// entries resolve Date.now explicitly — run-store RT1AGG J precedent)
let SESSION_CLOCK = null;
function clockNow() { return SESSION_CLOCK ? SESSION_CLOCK() : Date.now(); }
function nowIso() { return new Date().toISOString(); }

function err(code, stage, operationId, message, exitCode = 1) {
  return new RunStoreError({ code, exitCode, stage, operationId: operationId ?? null, message, retryable: false });
}
function runtimeDir(projectDir) { return path.join(projectDir, RUNTIME_REL); }
function inboxPath(projectDir) { return path.join(runtimeDir(projectDir), INBOX_FILE); }
function eventLedgerPath(projectDir) { return path.join(runtimeDir(projectDir), EVENT_LEDGER_FILE); }
function closureIndexPath(projectDir) { return path.join(projectDir, CLOSURE_INDEX_FILE); }
function archiveFileOf(projectDir, sessionUuid) { return path.join(projectDir, ARCHIVE_REL, sessionUuid + ".json"); }

function assertProjectDir(projectDir, operationId) {
  if (typeof projectDir !== "string" || projectDir.length === 0) {
    throw err("invalid_project_dir", "args.project_dir", operationId, "projectDir required");
  }
  if (!path.isAbsolute(projectDir)) {
    throw err("invalid_project_dir", "args.project_dir", operationId, "projectDir must be an absolute path (no cwd fallback)");
  }
  let st;
  try {
    st = fs.statSync(projectDir);
  } catch {
    throw err("invalid_project_dir", "args.project_dir", operationId, "projectDir does not exist: " + projectDir);
  }
  if (!st.isDirectory()) {
    throw err("invalid_project_dir", "args.project_dir", operationId, "projectDir is not a directory: " + projectDir);
  }
}
function assertOperationId(operationId) {
  if (typeof operationId !== "string" || operationId.length === 0) {
    throw err("invalid_argument", "args", operationId ?? null, "operationId required");
  }
}

function assertSafeSessionUuid(uuid, operationId, stage) {
  if (typeof uuid !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(uuid) || uuid.includes("..")) {
    throw err("invalid_argument", stage, operationId, "sessionUuid is not a safe archive file-name component: " + String(uuid));
  }
}
// ⑥（r11 预裁九⑥）: 归档写入前的 realpath 祖先链 containment——目录越界或 symlink 越界
// （漏网缺陷面）一律 deny unsafe_archive_path，绝不向归档目录之外写入。
async function assertArchiveContainment(projectDir, sessionUuid, operationId) {
  const archiveDir = path.join(projectDir, "docs", "evidence", "session-closures");
  const file = path.join(archiveDir, sessionUuid + ".json");
  // ancestors must stay inside the project (resolve chain, no .. escape)
  const resolvedDir = path.resolve(archiveDir);
  const projectRoot = path.resolve(projectDir);
  if (resolvedDir !== projectRoot && !resolvedDir.startsWith(projectRoot + path.sep)) {
    throw err("unsafe_archive_path", "closure_backfill.containment", operationId, "archive directory escapes the project root");
  }
  // ④（r12 预裁十④）: archiveDir 先 lstat——symlink 无论目标存在与否（含悬空）一律 deny
  try {
    const lst = await fsp.lstat(archiveDir);
    if (lst.isSymbolicLink()) {
      throw err("unsafe_archive_path", "closure_backfill.containment", operationId, "archive directory is a symlink (dangling or not); refusing to write through it");
    }
  } catch (error) {
    if (error instanceof RunStoreError) throw error;
    if (error.code !== "ENOENT") {
      throw err("unsafe_archive_path", "closure_backfill.containment", operationId, "archive directory lstat failed: " + error.code);
    }
  }
  // existing file/directory in the chain must be a real path inside the archive dir (no symlinks outward)
  let realDir = null;
  try {
    realDir = await fsp.realpath(archiveDir);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw err("unsafe_archive_path", "closure_backfill.containment", operationId, "archive directory unreadable: " + error.code);
    }
    // walk up to the nearest existing ancestor and validate containment there
    let probe = path.dirname(archiveDir);
    for (;;) {
      try {
        const real = await fsp.realpath(probe);
        if (real !== probe && !real.startsWith(projectRoot + path.sep)) { // r13②: 前缀兄弟目录拒（path.sep 边界）
          throw err("unsafe_archive_path", "closure_backfill.containment", operationId, "ancestor symlink escapes the project root");
        }
        break;
      } catch (e2) {
        if (e2.code === "ENOENT" && probe !== path.dirname(probe)) probe = path.dirname(probe);
        else if (e2.code === "ENOENT") break;
        else throw err("unsafe_archive_path", "closure_backfill.containment", operationId, "ancestor unreadable: " + e2.code);
      }
    }
  }
  if (realDir !== null) {
    const realProject = await fsp.realpath(projectRoot);
    if (realDir !== realProject && !realDir.startsWith(realProject + path.sep)) {
      throw err("unsafe_archive_path", "closure_backfill.containment", operationId, "archive directory symlink escapes the project root");
    }
    if (realDir !== resolvedDir) {
      // the archive directory itself is a symlink — deny regardless of destination (r11⑥)
      throw err("unsafe_archive_path", "closure_backfill.containment", operationId, "archive directory is a symlink; refusing to write through it");
    }
  }
  try {
    const realFile = await fsp.realpath(file);
    if (realFile !== file && !realFile.startsWith(path.resolve(archiveDir) + path.sep)) {
      throw err("unsafe_archive_path", "closure_backfill.containment", operationId, "archive file is a symlink escaping the archive dir");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw err("unsafe_archive_path", "closure_backfill.containment", operationId, "archive path probe failed: " + error.code);
    }
  }
  return file;
}
function floatGuardDeep(v, pathStr, operationId) {
  if (typeof v === "number" && !Number.isInteger(v)) {
    throw err("invalid_argument", "args.float", operationId, "float payload value at " + pathStr);
  }
  if (Array.isArray(v)) v.forEach((x, i) => floatGuardDeep(x, pathStr + "[" + i + "]", operationId));
  else if (v && typeof v === "object") for (const k of Object.keys(v)) floatGuardDeep(v[k], pathStr + "." + k, operationId);
}
function assertDescriptor(descriptor, operationId) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw err("invalid_argument", "openSession.descriptor", operationId, "descriptor must be an object");
  }
  for (const k of DESCRIPTOR_KEYS) {
    if (!(k in descriptor)) throw err("invalid_argument", "openSession.descriptor", operationId, "descriptor missing key " + k);
  }
  for (const k of Object.keys(descriptor)) {
    if (!DESCRIPTOR_KEYS.includes(k)) throw err("invalid_argument", "openSession.descriptor", operationId, "descriptor key not in closed set: " + k);
  }
  if (!SESSION_ROLES.includes(descriptor.role)) {
    throw err("descriptor_role", "openSession.descriptor", operationId, "descriptor.role must be controller/worker/recovery");
  }
  for (const k of ["session_uuid", "project_id", "kind", "started_at", "binding_snapshot_ref"]) {
    if (typeof descriptor[k] !== "string" || descriptor[k].length === 0) {
      throw err("invalid_argument", "openSession.descriptor", operationId, "descriptor." + k + " must be a non-empty string");
    }
  }
  for (const k of ["parent_session_id", "resume_of"]) {
    if (descriptor[k] !== null && typeof descriptor[k] !== "string") {
      throw err("invalid_argument", "openSession.descriptor", operationId, "descriptor." + k + " must be string|null");
    }
  }
  for (const k of ["cfg_hash", "binding_snapshot_hash"]) {
    if (typeof descriptor[k] !== "string" || !HEX64.test(descriptor[k])) {
      throw err("invalid_argument", "openSession.descriptor", operationId, "descriptor." + k + " must be hex64");
    }
  }
  if (typeof descriptor.route_snapshot !== "object" || descriptor.route_snapshot === null || Array.isArray(descriptor.route_snapshot)) {
    throw err("invalid_argument", "openSession.descriptor", operationId, "descriptor.route_snapshot must be an object");
  }
  assertSafeSessionUuid(descriptor.session_uuid, operationId, "openSession.descriptor.session_uuid");
  floatGuardDeep(descriptor, "$.descriptor", operationId);
}

function assertClosureBody(closure, operationId) {
  if (!closure || typeof closure !== "object" || Array.isArray(closure)) {
    throw err("invalid_argument", "closeSession.closure", operationId, "closure must be an object");
  }
  for (const k of CLOSURE_KEYS) {
    if (!(k in closure)) throw err("invalid_argument", "closeSession.closure", operationId, "closure missing key " + k);
  }
  for (const k of Object.keys(closure)) {
    if (!CLOSURE_KEYS.includes(k) && !CLOSURE_OPTIONAL_KEYS.includes(k)) {
      throw err("invalid_argument", "closeSession.closure", operationId, "closure key not in closed set: " + k);
    }
  }
  if (typeof closure.ended_at !== "string" || closure.ended_at.length === 0) {
    throw err("invalid_argument", "closeSession.closure", operationId, "closure.ended_at must be a non-empty string");
  }
  if (typeof closure.end_reason !== "string" || closure.end_reason.length === 0) {
    throw err("invalid_argument", "closeSession.closure", operationId, "closure.end_reason must be a non-empty string");
  }
  if (typeof closure.work_outcome !== "string") {
    throw err("invalid_argument", "closeSession.closure", operationId, "closure.work_outcome must be a string");
  }
  // :322 closed combination — a session heading to CLOSED may not carry unfinished outcomes
  if (!TERMINAL_WORK_OUTCOMES.includes(closure.work_outcome)) {
    throw err("closure_outcome_forbidden", "closeSession.closure", operationId, "CLOSED combination forbids work_outcome " + closure.work_outcome);
  }
  if (!Number.isInteger(closure.final_revision) || closure.final_revision < 0) {
    throw err("invalid_argument", "closeSession.closure", operationId, "closure.final_revision must be a non-negative integer");
  }
  if (!Array.isArray(closure.final_artifacts) || !Array.isArray(closure.unresolved)) {
    throw err("invalid_argument", "closeSession.closure", operationId, "closure.final_artifacts/unresolved must be arrays");
  }
  if (closure.unresolved.some((u) => typeof u !== "string")) {
    throw err("invalid_argument", "closeSession.closure", operationId, "closure.unresolved items must be strings");
  }
  if (closure.successor !== null && typeof closure.successor !== "string") {
    throw err("invalid_argument", "closeSession.closure", operationId, "closure.successor must be string|null");
  }
  if ("evidence_ref" in closure && (typeof closure.evidence_ref !== "string" || closure.evidence_ref.length === 0)) {
    throw err("invalid_argument", "closeSession.closure", operationId, "closure.evidence_ref must be a non-empty string when present");
  }
  floatGuardDeep(closure, "$.closure", operationId);
}

function assertEventBody(ev, operationId) {
  if (!ev || typeof ev !== "object" || Array.isArray(ev)) {
    throw err("invalid_event", "applySessionEvent.event", operationId, "inbox record is not an object");
  }
  for (const k of EVENT_KEYS) {
    if (!(k in ev)) throw err("invalid_event", "applySessionEvent.event", operationId, "inbox record missing key " + k);
  }
  for (const k of Object.keys(ev)) {
    if (!EVENT_KEYS.includes(k)) throw err("invalid_event", "applySessionEvent.event", operationId, "inbox record key not in closed set: " + k);
  }
  for (const k of ["event_id", "session_uuid", "kind", "evidence_ref", "created_at", "status"]) {
    if (typeof ev[k] !== "string" || ev[k].length === 0) {
      throw err("invalid_event", "applySessionEvent.event", operationId, "inbox record." + k + " must be a non-empty string");
    }
  }
  if (ev.payload === undefined) throw err("invalid_event", "applySessionEvent.event", operationId, "inbox record.payload required");
  floatGuardDeep(ev, "$.event", operationId);
}

async function readJsonl(file) {
  let text;
  try {
    text = await fsp.readFile(file, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw err("io_load_failed", "inbox.load", null, "unreadable " + file + ": " + error.code, 3);
  }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      throw err("io_load_failed", "inbox.parse", null, "corrupt JSONL line in " + file, 3);
    }
  }
  return out;
}
async function appendJsonl(file, record) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.appendFile(file, canonicalJSON(record) + "\n", "utf-8");
}
// 裁定五: closure-index append carries fsync + readback reconciliation
async function appendIndexLine(projectDir, entry) {
  const file = closureIndexPath(projectDir);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const line = canonicalJSON(entry);
  const fh = await fsp.open(file, "a");
  try {
    await fh.writeFile(line + "\n", "utf-8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  const text = await fsp.readFile(file, "utf-8");
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines[lines.length - 1] !== line) {
    throw err("io_readback", "closure_index.append", null, "closure-index append readback mismatch", 3);
  }
  return true;
}

// SessionEvent seven-key single source (taskbook §3.4-C): the event body is located
// by eventId in the project inbox and taken verbatim — the interface never constructs
// payload or any key.
async function locateInboxEvent(projectDir, eventId, operationId) {
  if (typeof eventId !== "string" || eventId.length === 0) {
    throw err("invalid_argument", "applySessionEvent.eventId", operationId, "eventId required");
  }
  const lines = await readJsonl(inboxPath(projectDir));
  const hits = lines.filter((e) => e && e.event_id === eventId);
  if (hits.length === 0) {
    throw err("invalid_event_ref", "applySessionEvent.inbox", operationId, "inbox holds no record for eventId " + eventId);
  }
  if (hits.length > 1) {
    // 裁定六: inbox 多条同 eventId 一律 deny（含同体——出现多条即篡改态）
    throw err("inbox_ambiguous", "applySessionEvent.inbox", operationId, "inbox holds " + hits.length + " records for eventId " + eventId);
  }
  return hits[0];
}
async function readEventLedger(projectDir) {
  return readJsonl(eventLedgerPath(projectDir));
}

// adapter-level equality assertion against the immutable artifacts' internally
// recomputed hashes (装配申报 r0 裁量⑥: delegated-face hash params = adapter equality,
// not a second gate — the run-store gate stays the single approval evaluator)
async function assertParamHashes(projectDir, { approvalRef, approvalHash, evidenceRef, evidenceHash, operationId }) {
  let approvalDoc = null;
  if (typeof approvalRef === "string") {
    approvalDoc = await loadApprovalDoc(projectDir, approvalRef, operationId);
    if (typeof approvalHash === "string" && approvalHash !== approvalDoc.approvalHash) {
      throw err("approval_hash_mismatch", "adapter.param", operationId, "approvalHash parameter does not match the recomputed approval document hash");
    }
  }
  let evidenceDoc = null;
  if (typeof evidenceRef === "string") {
    evidenceDoc = await loadEvidence(projectDir, evidenceRef, operationId);
    if (typeof evidenceHash === "string" && evidenceHash !== evidenceDoc.evidenceHash) {
      throw err("evidence_hash_mismatch", "adapter.param", operationId, "evidenceHash parameter does not match the recomputed evidence document hash");
    }
  }
  return { approvalDoc, evidenceDoc };
}

// approval-carrying self-write paths: the exported loadApprovalDoc + assertApprovalGate
// chain (same gate as run-store — exported-face reuse, not a duplicated evaluator);
// approvalChain / approvalParamGate / evidenceParamCheck live with the interfaces below.

function closureHashOf(descriptor, closure, closureRevision) {
  // R3-B-3 unified archive-package formula: sha256(canonicalJSON({descriptor,closure,closure_revision}))
  return sha256hex(canonicalJSON({ descriptor, closure, closure_revision: closureRevision }));
}

// 裁定五: 步②归档确保＋步③裁剪前置全对账——entry_id＋session_uuid＋closure_hash＋
// prev_entry_hash 链＋closure_head_hash/closure_count 与归档/索引逐项相等；索引 append 带
// fsync＋readback 复核；任一不符 fail-closed 保留 pending。
async function backfillClosures(projectDir, next, operationId) {
  const dry = arguments.length > 3 && arguments[3] === true;
  const onlyKeys = arguments.length > 4 && Array.isArray(arguments[4]) ? new Set(arguments[4]) : null;
  const unresolved = [];
  let changed = false;
  for (const sessionUuid of Object.keys(next.pending_closures)) {
    if (onlyKeys && !onlyKeys.has(sessionUuid)) continue;
    const pending = next.pending_closures[sessionUuid];
    // ⑥（r11）: 非法键＝跳过＋标记，不 throw 全局（其余 pending 照常对账）
    if (typeof sessionUuid !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionUuid) || sessionUuid.includes("..")) {
      unresolved.push({ session_uuid: String(sessionUuid), reason: "closure_archive_suspicious", detail: "pending_closures key is not a safe archive file-name component" });
      continue;
    }
    // containment 越界是安全面（非追平失败，漏网缺陷防护）：直接 throw 中止一切写（r11⑥）
    const file = await assertArchiveContainment(projectDir, sessionUuid, operationId);
    const chash = closureHashOf(pending.descriptor, pending.closure, pending.closure_revision);
    let body = null;
    try {
      const st = await fsp.stat(file);
      if (!st.isFile()) { unresolved.push({ session_uuid: sessionUuid, reason: "closure_archive_suspicious", detail: "archive path is not a regular file" }); continue; }
      body = JSON.parse(await fsp.readFile(file, "utf-8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        const pkg = { descriptor: pending.descriptor, closure: pending.closure, closure_revision: pending.closure_revision };
        const text = canonicalJSON(pkg);
        if (dry) {
          body = JSON.parse(text); // dry run: assume the archive would be written
        } else {
          try {
            await atomicWrite(file, text);
          } catch (werr) {
            // ⑧（r12 预裁十⑧）: apply 相归档写入失败（EACCES/EIO/ENOSPC）-> fail-closed 保留 pending
            unresolved.push({ session_uuid: sessionUuid, reason: "closure_archive_suspicious", detail: "archive write failed in the apply phase: " + (werr.code ?? String(werr?.message ?? werr)) });
            continue;
          }
          body = JSON.parse(text);
        }
      } else {
        unresolved.push({ session_uuid: sessionUuid, reason: "closure_archive_suspicious", detail: "archive unreadable: " + (error.code ?? String(error)) });
        continue;
      }
    }
    let got;
    try {
      got = sha256hex(canonicalJSON(body));
    } catch {
      unresolved.push({ session_uuid: sessionUuid, reason: "closure_archive_suspicious", detail: "archive body uncanonicalizable" });
      continue;
    }
    if (got !== chash) { unresolved.push({ session_uuid: sessionUuid, reason: "closure_archive_suspicious", detail: "archive hash does not match the pending closure package" }); continue; }
    let lines = await readJsonl(closureIndexPath(projectDir));
    const mine = lines.filter((l) => l && l.session_uuid === sessionUuid && l.closure_hash === chash);
    let entry;
    if (mine.length > 0) {
      entry = mine[mine.length - 1];
      if (entry.entry_id !== chash) { unresolved.push({ session_uuid: sessionUuid, reason: "closure_archive_suspicious", detail: "index entry_id != closure_hash" }); continue; }
      const at = lines.lastIndexOf(entry);
      const expectPrev = at > 0 ? lines[at - 1].closure_hash : GENESIS_PARENT_HASH;
      if (entry.prev_entry_hash !== expectPrev) { unresolved.push({ session_uuid: sessionUuid, reason: "closure_archive_suspicious", detail: "index prev_entry_hash chain broken" }); continue; }
    } else {
      // r14⑤: 同会话不同 hash 的旧行=a 分支覆盖历史（唯一 closure 语义按当前行对账），不拦 append；
      // 真正的歧义（无当前行且多行互异）由下方 currentRows/uuidRows 对账兜底。
      const prev = lines.length ? lines[lines.length - 1].closure_hash : GENESIS_PARENT_HASH;
      entry = { entry_id: chash, session_uuid: sessionUuid, closure_hash: chash, archived_at: nowIso(), prev_entry_hash: prev };
      if (!dry) {
        try {
          await appendIndexLine(projectDir, entry);
          lines = await readJsonl(closureIndexPath(projectDir)); // r11①: count 对账用 append 后快照
        } catch (error) {
          unresolved.push({ session_uuid: sessionUuid, reason: error.code === "io_readback" ? "closure_archive_suspicious" : "needs_closure_backfill", detail: "closure-index append failed: " + (error.code ?? String(error)) });
          continue;
        }
      }
    }
    const rec = next.sessions[sessionUuid];
    // ①（r11 预裁九①）: closure_count=完整索引唯一 uuid 数精确相等（非 >=1）；recent 无该
    // 会话时按完整索引＋归档重算同核（挤出 recent 不影响对账，count 以完整索引重算）。
    // ①（r11 预裁九①）: count 对账口径=该会话唯一 closure 数（docs/14:299）与该 uuid 在
    // 完整索引中的唯一行数精确相等；索引尚无该 uuid 行时（dry/待 append）以 1 为期望。
    const uuidIndexCount = new Set(lines.filter((l) => l && l.session_uuid === sessionUuid && typeof l.closure_hash === "string").map((l) => l.closure_hash)).size;
    const expectedCount = 1; // r14⑤: 唯一 closure 语义——该会话恰一个 closure，count 恒与 1 精确相等
    if (rec) {
      // ①（r12 预裁十①）: head 对账独立化——closure_head_hash 校验不再依赖 recent_entries
      // 在位（挤出态按该 uuid 的完整索引行重算 head 比对）；同会话多行（唯一 closure 违反）=suspicious。
      const uuidRows = lines.filter((l) => l && l.session_uuid === sessionUuid && typeof l.closure_hash === "string");
      // r14⑤/N: a 分支覆盖后的步③消费会产生同会话第二行（新 hash）——当前 chash 行在即取该
      // 行为 entry，其余行=覆盖历史（唯一 closure 语义按当前行对账，count 期望=1）；
      // 无当前行且有多行不同 hash=真正歧义 -> suspicious。
      const currentRows = uuidRows.filter((l) => l.closure_hash === entry.closure_hash);
      if (currentRows.length === 0 && uuidRows.length > 1) { unresolved.push({ session_uuid: sessionUuid, reason: "closure_archive_suspicious", detail: "closure index holds " + uuidRows.length + " divergent rows for this session (unique-closure violation)" }); continue; }
      if (currentRows.length > 1) { unresolved.push({ session_uuid: sessionUuid, reason: "closure_archive_suspicious", detail: "closure index holds " + currentRows.length + " identical-hash rows for this session" }); continue; }
      if (rec.closure_index.closure_head_hash !== entry.closure_hash) { unresolved.push({ session_uuid: sessionUuid, reason: "closure_archive_suspicious", detail: "closure_head_hash != latest closure_hash" }); continue; }
      const recentEntry = (rec.closure_index.recent_entries ?? []).find((e) => e && e.session_uuid === sessionUuid);
      if (recentEntry) {
        if (recentEntry.entry_id !== entry.entry_id || recentEntry.closure_hash !== entry.closure_hash) { unresolved.push({ session_uuid: sessionUuid, reason: "closure_archive_suspicious", detail: "closure_index recent entry does not match the archive/index" }); continue; }
      }
      if (rec.closure_index.closure_count !== expectedCount) {
        unresolved.push({ session_uuid: sessionUuid, reason: "closure_archive_suspicious", detail: "closure_count=" + rec.closure_index.closure_count + " != unique index rows for this session=" + expectedCount }); continue;
      }
    }
    if (!(next.revision > pending.closure_revision)) {
      unresolved.push({ session_uuid: sessionUuid, reason: "closure_prune_not_descendant", detail: "pruning revision must be a descendant of the archived revision" });
      continue;
    }
    if (dry) continue; // dry run: no state mutation
    delete next.pending_closures[sessionUuid];
    if (rec) {
      if (rec.live_state.lifecycle === "CLOSING") {
        rec.live_state.lifecycle = "CLOSED";
        // 裁定五: 终态化同步 live_state.work_outcome（沿事务A closure）
        if (typeof pending.closure.work_outcome === "string") rec.live_state.work_outcome = pending.closure.work_outcome;
        // 裁定一: 控制自关置空发生在步③ CLOSED 终态化时（＋released_at＋epoch+1）
        const c = next.authorization.controller;
        if (c.session_uuid === sessionUuid && c.released_at === null) {
          next.authorization.controller = { ...c, session_uuid: null, released_at: nowIso() };
          next.authorization.controller_epoch += 1;
        }
      }
    }
    changed = true;
  }
  return { unresolved, changed };
}

function encodeAppliedEntry(operationId, requestHash, revision, hash, recordRevision) {
  return operationId + ":" + requestHash + ":" + revision + ":" + hash + ":" + recordRevision;
}
function decodeAppliedEntry(entry) {
  const parts = entry.split(":");
  if (parts.length < 5) return null;
  const recordRevision = parts.pop();
  const hash = parts.pop();
  const revision = parts.pop();
  const requestHash = parts.pop();
  const operationId = parts.join(":");
  return { operationId, requestHash, revision: Number(revision), hash, recordRevision: Number(recordRevision) };
}
function findAppliedLocal(state, operationId) {
  for (const entry of state.applied_operations) {
    const d = decodeAppliedEntry(entry);
    if (d && d.operationId === operationId) return d;
  }
  return null;
}

// runId 历史复用（裁定八/⑥）: applied_operations 条目不含 runUuid——以历史 revision 文件的
// active_run/sessions[*].live_state.current_run 扫描承载「同 runUuid 已用过」的等值语义。
function scanRunUuidHistory(projectDir, stateUuid, runUuid) {
  const dir = path.join(runtimeDir(projectDir), "state", stateUuid);
  if (!fs.existsSync(dir)) return false;
  for (const f of fs.readdirSync(dir)) {
    if (!/^r-\d+\.json$/.test(f)) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      if (doc && doc.active_run && doc.active_run.run_uuid === runUuid) return true;
      if (doc && doc.sessions) {
        for (const u of Object.keys(doc.sessions)) {
          const cr = doc.sessions[u]?.live_state?.current_run;
          if (cr && cr.run_uuid === runUuid) return true;
        }
      }
    } catch (error) {
      // ③（r11 预裁九③）: 历史不可读 -> fail-closed deny（删 fail-open）
      throw err("history_unreadable", "startRun.history", null, "revision history file unreadable during runId scan: " + f + ": " + (error.code ?? String(error)));
    }
  }
  return false;
}

async function readJournalLoose(projectDir, operationId) {
  let j;
  try {
    j = JSON.parse(await fsp.readFile(path.join(runtimeDir(projectDir), "cutover-journal.json"), "utf-8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw err("io_load_failed", "journal.load", operationId, "cutover journal unreadable", 3);
  }
  // N 顺修（r13）: null/非对象形状包装（JSON "null" 合法解析但非 journal 形状）
  if (!j || typeof j !== "object" || Array.isArray(j)) {
    throw err("blocked", "journal.shape", operationId, "cutover journal is not an object");
  }
  // ⑫（r11 预裁九⑫）: 单源 loader 校验对齐——headHash 必填＋逐 entry entryHash 重算
  const headCopy = structuredClone(j);
  delete headCopy.headHash;
  if (typeof j.headHash !== "string") {
    throw err("blocked", "journal.head_hash", operationId, "journal headHash missing (mandatory, single-source loader parity)");
  }
  if (sha256hex(canonicalJSON(headCopy)) !== j.headHash) {
    throw err("blocked", "journal.head_hash", operationId, "journal headHash does not match recomputed content");
  }
  for (const e of j.entries ?? []) {
    const eCopy = structuredClone(e);
    delete eCopy.entryHash;
    if (typeof e.entryHash !== "string" || sha256hex(canonicalJSON(eCopy)) !== e.entryHash) {
      throw err("blocked", "journal.entry_hash", operationId, "journal entryHash mismatch on load");
    }
  }
  for (const e of j.entries ?? []) {
    if (FROZEN_JOURNAL_STATES.has(e.status)) {
      throw err("blocked", "journal_frozen", operationId, "cutover/recovery in progress (" + e.operationId + ":" + e.status + "); ordinary writes blocked");
    }
    if (e.status === "abandoned" && !e.resumeRef) {
      throw err("blocked", "journal_frozen", operationId, "abandoned without resumeRef blocks ordinary writes (" + e.operationId + ")");
    }
  }
}
async function readHighwaterLoose(projectDir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(runtimeDir(projectDir), "highwater.json"), "utf-8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw err("io_load_failed", "highwater.load", null, "highwater unreadable", 3);
  }
}

// ---------------------------------------------------------------------------
// self-write transaction core — lock-inner sequence aligned with the exported
// transactLocked source as single reference: applied_operations replay has priority
// over expectedRevision, orphan claim, highwater reconcile, fork detection,
// expectedRevision optimistic lock, journal frozen check, clone, publish chain,
// request-approvals ledger write order.
// ---------------------------------------------------------------------------
async function sessionWrite({ projectDir, principal, sessionId, operationId, expectedRevision, command, payload, authorize, mutate, heal, preReplay, requireBackfillClean = false }) {
  assertOperationId(operationId);
  const owner = await acquireLock(projectDir, operationId);
  try {
    if (!fs.existsSync(path.join(runtimeDir(projectDir), "authority.json"))) {
      throw err("genesis_required", "genesis", operationId, "empty project only accepts initial assignController(expectedRevision=0, principal=host)");
    }
    const authority = await loadAuthority(projectDir);
    const state = await loadRevisionFile(projectDir, authority.state_uuid, authority.current_revision);
    await readJournalLoose(projectDir, operationId);
    const pload = payload ?? {};
    // N2 单源形态：审批文档先载入（单次读、暂不上闸）供 requestHash 绑定；applied 判定先于
    // authorize（对齐 transactLocked 的 replay 优先序），命中后六 key 匹配跑同一闸并自愈台账。
    let preloadedApproval = null;
    if (typeof pload.approvalRef === "string") preloadedApproval = await loadApprovalDoc(projectDir, pload.approvalRef, operationId);
    const requestHash = requestHashOf({ command, principal, sessionId, operationId, payload: pload, approvalHash: preloadedApproval ? preloadedApproval.approvalHash : undefined });
    // applied_operations replay has priority over expectedRevision AND over authorize
    const applied = findAppliedLocal(state, operationId);
    if (applied) {
      // 预裁十三①（r17 接线）: preReplay 是 applied 命中分支的首步——先于 requestHash 比较、
      // authorize（活性/审批闸）、writeRequestApprovalBinding 台账绑定与 heal 写一切 side file。
      // 钩子返回的观察值随 replay 返回面回传（applySessionEvent 的 ledger 行快照单源）。
      const preReplayOut = preReplay ? await preReplay({ projectDir, operationId, applied }) : undefined;
      if (applied.requestHash === requestHash) {
        // replay six-key match: run the same gate on the preloaded doc, then self-heal the ledger (N2)
        if (preloadedApproval && authorize) {
          const approvalHash2 = await authorize({ state, projectDir, operationId, principal, sessionId });
          if (typeof approvalHash2 === "string" && approvalHash2 !== preloadedApproval.approvalHash) {
            throw err("request_hash_conflict", "replay", operationId, "replayed approval does not match the preloaded document");
          }
        }
        if (preloadedApproval) await writeRequestApprovalBinding(projectDir, operationId, preloadedApproval.approvalHash);
        if (heal) await heal({ projectDir, revision: applied.revision, operationId });
        return { revision: applied.revision, replay: true, ...(preReplayOut !== undefined ? { preReplay: preReplayOut } : {}) };
      }
      throw err("request_hash_conflict", "replay", operationId, "same operationId replayed with payload/requestHash");
    }
    // authorization (role predicates + the exported approval gate) runs inside the lock after the replay check
    let boundApprovalHash;
    if (authorize) boundApprovalHash = await authorize({ state, projectDir, operationId, principal, sessionId });
    const finalRequestHash = boundApprovalHash === preloadedApproval?.approvalHash ? requestHash : requestHashOf({ command, principal, sessionId, operationId, payload: pload, approvalHash: typeof boundApprovalHash === "string" ? boundApprovalHash : undefined });
    // orphan claim: r-(current+1) on disk but unpublished — only the original operation may claim it
    const orphanFile = path.join(runtimeDir(projectDir), "state", authority.state_uuid, "r-" + (authority.current_revision + 1) + ".json");
    if (fs.existsSync(orphanFile)) {
      let orphan = null;
      try {
        orphan = JSON.parse(await fsp.readFile(orphanFile, "utf-8"));
      } catch {
        orphan = null;
      }
      const orphanApplied = orphan && Array.isArray(orphan.applied_operations) ? findAppliedLocal(orphan, operationId) : null;
      if (orphanApplied && orphanApplied.requestHash === requestHash) {
        const hw = { ...(await readHighwaterLoose(projectDir)) };
        hw[authority.state_uuid] = { record_revision: authority.record_revision + 1, current_revision: orphan.revision, current_hash: orphan.self_hash };
        await atomicWrite(path.join(runtimeDir(projectDir), "highwater.json"), canonicalJSON(hw));
        const nextAuthority = { ...authority, record_revision: authority.record_revision + 1, current_revision: orphan.revision, current_hash: orphan.self_hash };
        await atomicWrite(path.join(runtimeDir(projectDir), "authority.json"), canonicalJSON(nextAuthority));
        // ⑫（r11）: orphan claim 补 request-approvals 台账绑定（对齐 transactLocked 孤儿认领序）
        if (preloadedApproval) await writeRequestApprovalBinding(projectDir, operationId, preloadedApproval.approvalHash);
        return { revision: orphanApplied.revision, replay: true, orphanClaim: true };
      }
      throw err("blocked", "orphan", operationId, "unpublished revision exists (orphan); only the original operation may claim it");
    }
    // highwater reconcile
    const hw0 = await readHighwaterLoose(projectDir);
    const hwEntry = hw0[authority.state_uuid];
    if (hwEntry && hwEntry.current_revision > authority.current_revision) {
      throw err("blocked", "highwater_reconcile", operationId, "highwater above authority; ordinary writes blocked pending reconciliation");
    }
    // unexpected descendant / fork detection
    const sdir = path.join(runtimeDir(projectDir), "state", authority.state_uuid);
    if (fs.existsSync(sdir)) {
      const numbers = fs.readdirSync(sdir).map((f) => /^r-(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number).filter((n) => n > authority.current_revision + 1);
      for (const n of numbers) {
        try {
          const cand = JSON.parse(await fsp.readFile(path.join(sdir, "r-" + n + ".json"), "utf-8"));
          if (cand && cand.schema) {
            throw err("blocked", "fork", operationId, "unexpected descendant revision on disk (r-" + n + "); fork blocked");
          }
        } catch (error) {
          if (error instanceof RunStoreError && error.code === "blocked") throw error;
        }
      }
    }
    // expectedRevision optimistic lock
    const expected = typeof expectedRevision === "number" ? expectedRevision : -1;
    if (expected !== authority.current_revision) {
      throw err("expected_revision_mismatch", "expected_revision", operationId, "expectedRevision " + expected + " != current " + authority.current_revision);
    }
    // clone + bump
    const next = structuredClone(state);
    next.parent_revision = state.revision;
    next.parent_hash = state.self_hash;
    next.revision = state.revision + 1;
    next.owner_session_id = sessionId ?? state.authorization.controller.session_uuid ?? "host";
    // 步③ catch-up pre-check on every session write (run writes hard-block on leftovers)
    // 裁定五两相：dry 预检在 mutate 前（startRun 硬门），apply 执行在 mutate 后随事务发布
    // （避免把本事务即将迁移的 CLOSING 提前终态化——⑮-b 链的 UNKNOWN 保持由此保证）
    const dryBackfill = await backfillClosures(projectDir, next, operationId, true);
    if (requireBackfillClean && dryBackfill.unresolved.length > 0) {
      const why = dryBackfill.unresolved[0];
      throw err("needs_closure_backfill", "closure_backfill", operationId, "closure archive not reconciled" + (why ? " (" + why.session_uuid + ": " + (why.reason || "pending") + ")" : " (pending_closures non-empty)") + "; startRun denied until caught up");
    }
    const mutation = await mutate({ state: next, currentState: state, authority, projectDir, payload: pload, principal, sessionId, operationId });
    // apply 相只消费事务开始时已存在的 pending（本事务新写入的 pending 留给后续事务的追平检查）
    const backfill = await backfillClosures(projectDir, next, operationId, false, Object.keys(state.pending_closures));
    // ⑦（r11 预裁九⑦）: run 写硬门延伸到 apply 相——任一 unresolved 即中止发布
    if (requireBackfillClean && backfill.unresolved.length > 0) {
      const why = backfill.unresolved[0];
      throw err("needs_closure_backfill", "closure_backfill", operationId, "closure reconciliation failed in the apply phase" + (why ? " (" + why.session_uuid + ": " + (why.reason || "pending") + ")" : "") + "; run write denied");
    }
    if (mutation && mutation.noop) {
      // 裁定五: noop 路径不丢 backfill——backfill 已变更则照常发布该 revision
      if (!backfill.changed) return { revision: mutation.revision, noop: true, ...(mutation.result ?? {}) };
    }
    const commitHash = sha256hex(operationId + ":" + finalRequestHash);
    next.applied_operations.push(encodeAppliedEntry(operationId, finalRequestHash, next.revision, commitHash, authority.record_revision + 1));
    if (next.applied_operations.length > CAPACITY_LIMITS.applied) {
      throw err("blocked_capacity", "capacity.applied", operationId, "applied_operations limit reached (" + CAPACITY_LIMITS.applied + ")");
    }
    const { nextAuthority } = await publishRevision(projectDir, next, authority, { operationId });
    if (mutation && mutation.after) await mutation.after(next, nextAuthority);
    await writeRequestApprovalBinding(projectDir, operationId, typeof boundApprovalHash === "string" ? boundApprovalHash : undefined);
    return { revision: next.revision, ...(mutation && mutation.result ? mutation.result : {}) };
  } finally {
    await releaseLock(projectDir, owner);
  }
}

function resolveWriterRole(state, principal, callerSessionId, operationId) {
  if (principal === "host") return { kind: "host", sessionId: null };
  if (principal === "session" && typeof callerSessionId === "string" && callerSessionId.length > 0) {
    const rec = state.sessions[callerSessionId];
    if (!rec) throw err("unknown_session", "authorize", operationId, "caller session not registered: " + callerSessionId);
    const c = state.authorization.controller;
    if (callerSessionId === c.session_uuid) return { kind: "controller", sessionId: callerSessionId };
    return { kind: rec.descriptor.role, sessionId: callerSessionId };
  }
  throw err("not_controller", "authorize", operationId, "principal must be host or a registered session caller");
}

// ---------------------------------------------------------------------------
// eight interfaces
// ---------------------------------------------------------------------------

function blankSessionRecord(descriptor) {
  return {
    descriptor,
    live_state: {
      revision: 0, lifecycle: "OPEN", work_outcome: "IN_PROGRESS", current_run: null,
      next_action: "registered", waiting_user: null, last_activity: descriptor.started_at,
      heartbeat: descriptor.started_at, attention_reasons: [],
    },
    closure_index: { closure_head_hash: GENESIS_PARENT_HASH, closure_count: 0, recent_entries: [] },
  };
}

async function evidenceParamCheck(projectDir, evidenceRef, evidenceHash, operationId) {
  const ev = await loadEvidence(projectDir, evidenceRef, operationId);
  if (typeof evidenceHash === "string" && evidenceHash !== ev.evidenceHash) {
    throw err("evidence_hash_mismatch", "evidence.param", operationId, "evidenceHash parameter does not match the recomputed evidence document hash");
  }
}
async function approvalParamGate(projectDir, { approvalRef, approvalHash, expectedKind, operationId, caller }) {
  const doc = await loadApprovalDoc(projectDir, approvalRef, operationId);
  assertApprovalGate(doc, expectedKind, operationId, caller);
  if (typeof approvalHash === "string" && approvalHash !== doc.approvalHash) {
    throw err("approval_hash_mismatch", "approval.param", operationId, "approvalHash parameter does not match the recomputed approval document hash");
  }
  return doc.approvalHash;
}
async function approvalChain(projectDir, { approvalRef, approvalHash, evidenceRef, evidenceHash, expectedKind, operationId, caller }) {
  // 裁定六: 恢复/blocked 路径四件全必填（approvalRef/approvalHash/evidenceRef/evidenceHash）
  if (typeof approvalRef !== "string") throw err("approval_required", "approval", operationId, "this path requires approvalRef");
  if (typeof approvalHash !== "string") throw err("approval_required", "approval", operationId, "this path requires approvalHash (all four fields mandatory)");
  if (typeof evidenceRef !== "string") throw err("evidence_required", "approval", operationId, "this path requires evidenceRef");
  if (typeof evidenceHash !== "string") throw err("evidence_required", "approval", operationId, "this path requires evidenceHash (all four fields mandatory)");
  const hash = await approvalParamGate(projectDir, { approvalRef, approvalHash, expectedKind, operationId, caller });
  const ev = await loadEvidence(projectDir, evidenceRef, operationId);
  if (evidenceHash !== ev.evidenceHash) {
    throw err("evidence_hash_mismatch", "approval.param", operationId, "evidenceHash parameter does not match the recomputed evidence document hash");
  }
  return hash;
}

async function appendInboxIfMissing(projectDir, ev) {
  // ④（r14 预裁十二④）: canonical 等价比对——同体（JSON 深等）非 canonical 行视为已在不追加
  const canonical = canonicalJSON(ev);
  const raw = (await fsp.readFile(inboxPath(projectDir), "utf-8").catch(() => "")).split("\n").filter((l) => l.trim());
  const canonEq = (line) => {
    try {
      return canonicalJSON(JSON.parse(line)) === canonical;
    } catch {
      return false;
    }
  };
  if (raw.some(canonEq)) return false;
  await appendJsonl(inboxPath(projectDir), ev);
  return true;
}
async function appendLedgerIfMissing(projectDir, eventId, bodyHash, operationId, revision, sessionUuid) {
  const ledger = await readEventLedger(projectDir);
  if (ledger.some((l) => l && l.event_id === eventId)) return false;
  await appendJsonl(eventLedgerPath(projectDir), { event_id: eventId, event_hash: bodyHash, operation_id: operationId, revision, session_uuid: sessionUuid ?? null, applied_at: nowIso() });
  return true;
}

// D-1: delegated assignController — run-store transact carries the single approval
// evaluator, stop transition, claimToken revocation, pending_closures and epoch
// (structural equivalence; the adapter only asserts hash-parameter equality).
export async function assignController(args) {
  const { projectDir, principal, callerSessionId, newDescriptor, evidenceRef, evidenceHash, approvalRef, approvalHash, expectedRevision, operationId } = args ?? {};
  assertOperationId(operationId);
  assertProjectDir(projectDir, operationId);
  // ③（r12 预裁十③）: 委派入口接同一 assertDescriptor（11 键/role 闭集/hex64/float/安全 uuid）；
  // 缺键/额外键/非法值在此包装为 RunStoreError（不再依赖下游 TypeError）
  try {
    assertDescriptor(newDescriptor, operationId);
  } catch (error) {
    if (error instanceof RunStoreError) throw err(error.code, "assignController.newDescriptor", operationId, error.message);
    throw error;
  }
  await assertParamHashes(projectDir, { approvalRef, approvalHash, evidenceRef, evidenceHash, operationId });
  // ④⑤（r11 预裁九④⑤）: applied 判定先行——命中则按 N2 单源返回既有 revision＋原
  // sessionUuid/epoch（epoch 自 applied revision 文件读原值）；未命中才做 uuid 防护并紧邻
  // transact（消防护-委派间 TOCTOU）。uuid 防护扩全：已注册 uuid 一律 deny（新 uuid 唯一）。
  const authFile = path.join(runtimeDir(projectDir), "authority.json");
  if (fs.existsSync(authFile)) {
    const authority = await loadAuthority(projectDir);
    const curState = await loadRevisionFile(projectDir, authority.state_uuid, authority.current_revision);
    const preDoc = typeof approvalRef === "string" ? await loadApprovalDoc(projectDir, approvalRef, operationId) : null;
    const delegatePayload = { descriptor: newDescriptor, evidenceRef, ...(typeof approvalRef === "string" ? { approvalRef } : {}) };
    const replayHash = requestHashOf({ command: "assignController", principal, sessionId: callerSessionId ?? null, operationId, payload: delegatePayload, approvalHash: preDoc ? preDoc.approvalHash : undefined });
    const applied = findAppliedLocal(curState, operationId);
    if (applied && applied.requestHash !== replayHash) {
      // ⑥（r12 预裁十⑥）: 同 opId 异体重放 -> request_hash_conflict（对齐 run-store :1087），
      // 不落回 uuid 防护
      throw err("request_hash_conflict", "replay", operationId, "same operationId replayed with payload/requestHash");
    }
    if (applied && applied.requestHash === replayHash) {
      // applied hit: run the delegated replay (ledger self-heal inside transact) and read the
      // ORIGINAL epoch from the applied revision file
      const out = await transact({
        projectDir, principal, sessionId: callerSessionId ?? null, expectedRevision, operationId,
        command: "assignController",
        payload: { descriptor: newDescriptor, evidenceRef, approvalRef },
      });
      let originalEpoch = null;
      try {
        const appliedFile = path.join(runtimeDir(projectDir), "state", authority.state_uuid, "r-" + applied.revision + ".json");
        const appliedState = JSON.parse(await fsp.readFile(appliedFile, "utf-8"));
        originalEpoch = appliedState?.authorization?.controller_epoch ?? null;
      } catch {
        originalEpoch = null;
      }
      return { sessionUuid: newDescriptor.session_uuid, controllerEpoch: originalEpoch ?? (await readCurrent({ projectDir })).state.authorization.controller_epoch, revision: out.revision };
    }
    const existing = curState.sessions?.[newDescriptor.session_uuid];
    if (existing) {
      throw err("session_uuid_reused", "assignController.newDescriptor", operationId, "newDescriptor.session_uuid is already registered (lifecycle " + existing.live_state.lifecycle + "); assignment requires a fresh session_uuid");
    }
  }
  const out = await transact({
    projectDir, principal, sessionId: callerSessionId ?? null, expectedRevision, operationId,
    command: "assignController",
    payload: { descriptor: newDescriptor, evidenceRef, ...(typeof approvalRef === "string" ? { approvalRef } : {}) },
  });
  const { state } = await readCurrent({ projectDir });
  return { sessionUuid: newDescriptor.session_uuid, controllerEpoch: state.authorization.controller_epoch, revision: out.revision };
}

export async function openSession(args) {
  const { projectDir, principal, callerSessionId, descriptor, expectedRevision, operationId } = args ?? {};
  assertOperationId(operationId);
  assertProjectDir(projectDir, operationId);
  assertDescriptor(descriptor, operationId);
  const out = await sessionWrite({
    projectDir, principal, sessionId: callerSessionId ?? null, operationId, expectedRevision,
    command: "openSession", payload: { descriptor },
    authorize: async ({ state }) => {
      const writer = resolveWriterRole(state, principal, callerSessionId, operationId);
      if (writer.kind === "controller") {
        assertControllerWrite(state, { principal, sessionId: callerSessionId, operationId }, undefined, clockNow);
      } else if (writer.kind !== "host") {
        throw err("not_controller", "openSession", operationId, "openSession callers: host or the ACTIVE controller session (the frozen signature carries no approval channel for recovery)");
      }
      return undefined;
    },
    mutate: async ({ state }) => {
      if (state.sessions[descriptor.session_uuid]) {
        throw err("session_exists", "openSession", operationId, "session already registered: " + descriptor.session_uuid);
      }
      state.sessions[descriptor.session_uuid] = blankSessionRecord(descriptor);
      return { result: { sessionUuid: descriptor.session_uuid } };
    },
  });
  return { sessionUuid: descriptor.session_uuid, revision: out.revision };
}

export async function applySessionEvent(args) {
  const { projectDir, principal, callerSessionId, eventId, evidenceRef, evidenceHash, approvalRef, approvalHash, expectedRevision, operationId } = args ?? {};
  assertOperationId(operationId);
  assertProjectDir(projectDir, operationId);
  if (typeof eventId !== "string" || eventId.length === 0) {
    throw err("invalid_argument", "applySessionEvent.eventId", operationId, "eventId required");
  }
  const pload = { eventId };
  if (approvalRef !== undefined) pload.approvalRef = approvalRef;
  if (evidenceRef !== undefined) pload.evidenceRef = evidenceRef;
  // ①（r15 预裁十三①·r17 接线）: preReplay——applied 命中分支首步查 ledger 行；缺行 deny
  // event_ledger_missing（在任何 side file 写入之前，不重建不回退）；行在场返回快照供原值回传。
  const preReplayEvent = async ({ projectDir: pd }) => {
    const ledger = await readEventLedger(pd);
    const rec0 = [...ledger].reverse().find((l) => l && l.event_id === eventId);
    if (!rec0) {
      throw err("event_ledger_missing", "applySessionEvent.replay", operationId, "applied-events ledger holds no row for eventId " + eventId + "; replay denied before any side-file write");
    }
    return rec0;
  };
  const healEvent = async ({ projectDir: pd }) => {
    // same-operationId replay after a crash between publish and the inbox side file:
    // 行在场形态只补 inbox canonical 行（ledger 写路径已删——缺行走 preReplay deny，不重建）。
    // 忽略面清单（逐字一致）: invalid_event_ref / inbox_ambiguous / io_load_failed；其余如实上抛。
    try {
      const ev = await locateInboxEvent(pd, eventId, operationId);
      await appendInboxIfMissing(pd, ev);
    } catch (error) {
      if (error instanceof RunStoreError && ["invalid_event_ref", "inbox_ambiguous", "io_load_failed"].includes(error.code)) return;
      throw error;
    }
  };
  const out = await sessionWrite({
    projectDir, principal, sessionId: callerSessionId ?? null, operationId, expectedRevision,
    command: "applySessionEvent", payload: pload,
    preReplay: preReplayEvent,
    authorize: async ({ state }) => {
      const writer = resolveWriterRole(state, principal, callerSessionId, operationId);
      if (writer.kind === "controller") {
        assertControllerWrite(state, { principal, sessionId: callerSessionId, operationId }, undefined, clockNow);
        if (typeof approvalRef === "string") {
          const hash = await approvalParamGate(projectDir, { approvalRef, approvalHash, expectedKind: "safeWrite", operationId, caller: { principal, callerSessionId } });
          // 裁定六: 带审批路径补 evidence 加载＋evidenceHash 比对（对齐 run-store REQ_EVIDENCE 面）
          if (typeof evidenceRef !== "string") throw err("evidence_required", "applySessionEvent", operationId, "approval-carrying apply requires evidenceRef");
          await evidenceParamCheck(projectDir, evidenceRef, evidenceHash, operationId);
          return hash;
        }
        return undefined;
      }
      if (writer.kind === "recovery") {
        return approvalChain(projectDir, { approvalRef, approvalHash, evidenceRef, evidenceHash, expectedKind: "safeWrite", operationId, caller: { principal, callerSessionId } });
      }
      if (writer.kind !== "worker") {
        throw err("not_controller", "applySessionEvent", operationId, "apply callers: ACTIVE controller, approved recovery, or worker inbox");
      }
      // worker 带审批提交同样绑定 approvalHash（N2 六 key，与预载 doc 的 hash 一致）
      if (typeof approvalRef === "string") {
        return approvalParamGate(projectDir, { approvalRef, approvalHash, expectedKind: "safeWrite", operationId, caller: { principal, callerSessionId } });
      }
      return undefined;
    },
    mutate: async ({ state, currentState }) => {
      const writer = resolveWriterRole(state, principal, callerSessionId, operationId);
      const ev = await locateInboxEvent(projectDir, eventId, operationId);
      assertEventBody(ev, operationId);
      const bodyHash = sha256hex(canonicalJSON(ev));
      const ledger = await readEventLedger(projectDir);
      const prior = ledger.find((l) => l && l.event_id === eventId) ?? null;
      if (writer.kind === "worker") {
        // inbox-only submission: append semantics, never apply
        if (prior) {
          if (prior.event_hash === bodyHash) return { noop: true, revision: prior.revision, result: { sessionUuid: ev.session_uuid } };
          throw err("event_conflict", "applySessionEvent.replay", operationId, "eventId resubmitted with a different canonical body");
        }
        if (ev.kind !== "inbox_message" || ev.session_uuid !== callerSessionId) {
          throw err("worker_inbox_only", "applySessionEvent", operationId, "worker may only submit inbox events for its own session");
        }
        return {
          result: { sessionUuid: ev.session_uuid },
          after: async (next) => {
            // 裁定六: 幂等经 applied 防护，不产生 inbox 多条——append-if-missing 语义
            await appendInboxIfMissing(projectDir, ev);
            await appendLedgerIfMissing(projectDir, eventId, bodyHash, operationId, next.revision, ev.session_uuid);
          },
        };
      }
      // controller / recovery apply: the seven keys come verbatim from the inbox record
      const target = state.sessions[ev.session_uuid];
      if (!target) throw err("unknown_session", "applySessionEvent", operationId, "event target session not registered: " + ev.session_uuid);
      const startLifecycle = currentState.sessions[ev.session_uuid]?.live_state?.lifecycle ?? target.live_state.lifecycle;
      if (TERMINAL_LIFECYCLES.includes(startLifecycle)) {
        throw err("session_terminal", "applySessionEvent", operationId, "event target session is terminal: " + startLifecycle);
      }
      await loadEvidence(projectDir, ev.evidence_ref, operationId);
      if (prior) {
        if (prior.event_hash === bodyHash) return { noop: true, revision: prior.revision, result: { sessionUuid: ev.session_uuid } };
        throw err("event_conflict", "applySessionEvent.replay", operationId, "eventId replayed with a different canonical body");
      }
      {
        // 裁定六: 全局 ID 查重去 kind 过滤——payload.id 域跨类唯一
        const idOf = (o) => (o && o.payload && typeof o.payload === "object" && typeof o.payload.id === "string" ? o.payload.id : null);
        const myId = idOf(ev);
        if (myId !== null) {
          const dup = (await readJsonl(inboxPath(projectDir))).some((o) => o && o.event_id !== eventId && idOf(o) === myId);
          if (dup) throw err("duplicate_global_id", "applySessionEvent", operationId, "global id already submitted (cross-kind unique): " + myId);
        }
      }
      target.live_state.last_activity = ev.created_at;
      return {
        result: { sessionUuid: ev.session_uuid },
        after: async (next) => {
          await appendLedgerIfMissing(projectDir, eventId, bodyHash, operationId, next.revision, ev.session_uuid);
        },
      };
    },
    heal: healEvent,
  });
  if (out.replay && out.sessionUuid === undefined) {
    // ②（r14 预裁十二②·r17 序重排）: apply 重放原 sessionUuid 唯一载体=applied-events ledger；
    // applied 命中分支已在首步由 preReplay 读取并随返回面回传（缺行已 deny，此处不再扫盘）。
    // 仅 orphan-claim 回放（非 applied 分支）无该快照时才回读 ledger——等价断言，非后置 gate。
    const rec0 = out.preReplay ?? [...(await readEventLedger(projectDir))].reverse().find((l) => l && l.event_id === eventId);
    if (!rec0) {
      throw err("event_ledger_missing", "applySessionEvent.replay", operationId, "applied-events ledger holds no row for eventId " + eventId + "; replay cannot restore the original sessionUuid");
    }
    return { sessionUuid: typeof rec0.session_uuid === "string" ? rec0.session_uuid : undefined, revision: out.revision };
  }
  return { sessionUuid: out.sessionUuid, revision: out.revision };
}

export async function heartbeat(args) {
  const { projectDir, principal, callerSessionId, sessionUuid, observedAt, evidenceRef, expectedRevision, operationId } = args ?? {};
  assertOperationId(operationId);
  assertProjectDir(projectDir, operationId);
  if (typeof sessionUuid !== "string" || sessionUuid.length === 0) throw err("invalid_argument", "heartbeat.sessionUuid", operationId, "sessionUuid required");
  if (typeof observedAt !== "string" || observedAt.length === 0) throw err("invalid_argument", "heartbeat.observedAt", operationId, "observedAt required");
  // 注记（r11⑭）: heartbeat 的 evidenceRef 仅做非空形态校验——观测性心跳不绑定审批/证据件
  // 加载（与 applySessionEvent 的事件证据绑定面不同），语义注记非行为变更。
  if (typeof evidenceRef !== "string" || evidenceRef.length === 0) throw err("invalid_argument", "heartbeat.evidenceRef", operationId, "evidenceRef required");
  const out = await sessionWrite({
    projectDir, principal, sessionId: callerSessionId ?? null, operationId, expectedRevision,
    command: "heartbeat", payload: { sessionUuid, observedAt, evidenceRef },
    authorize: async ({ state }) => {
      assertControllerWrite(state, { principal, sessionId: callerSessionId, operationId }, undefined, clockNow);
      return undefined;
    },
    mutate: async ({ state, currentState }) => {
      const rec = state.sessions[sessionUuid];
      if (!rec) throw err("unknown_session", "heartbeat", operationId, "session not registered: " + sessionUuid);
      const startLifecycle = currentState.sessions[sessionUuid]?.live_state?.lifecycle ?? rec.live_state.lifecycle;
      if (TERMINAL_LIFECYCLES.includes(startLifecycle)) {
        throw err("session_terminal", "heartbeat", operationId, "session lifecycle " + startLifecycle + " denies heartbeat");
      }
      rec.live_state.heartbeat = observedAt;
      return {};
    },
  });
  return { revision: out.revision };
}

export async function sweepExpired(args) {
  const { projectDir, now, callerSessionId, evidenceRef, evidenceHash, approvalRef, approvalHash, expectedRevision, operationId } = args ?? {};
  assertOperationId(operationId);
  assertProjectDir(projectDir, operationId);
  if (typeof now !== "string" && typeof now !== "number") throw err("invalid_argument", "sweepExpired.now", operationId, "now required (ISO string or epoch ms)");
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw err("invalid_argument", "sweepExpired.now", operationId, "now unparseable");
  const pload = { now };
  if (evidenceRef !== undefined) pload.evidenceRef = evidenceRef;
  if (approvalRef !== undefined) pload.approvalRef = approvalRef;
  const out = await sessionWrite({
    projectDir, principal: "session", sessionId: callerSessionId ?? null, operationId, expectedRevision,
    command: "sweepExpired", payload: pload,
    authorize: async ({ state }) => {
      const writer = resolveWriterRole(state, "session", callerSessionId, operationId);
      if (writer.kind === "worker") {
        throw err("needs_controller_sweep", "sweepExpired", operationId, "worker next is read-only: NEEDS_CONTROLLER_SWEEP");
      }
      if (writer.kind === "recovery") {
        return approvalChain(projectDir, { approvalRef, approvalHash, evidenceRef, evidenceHash, expectedKind: "safeWrite", operationId, caller: { principal: "session", callerSessionId } });
      }
      if (writer.kind === "controller") {
        const c = state.authorization.controller;
        if (c.blocked === true || !controllerActive(state, clockNow)) {
          throw err("needs_controller_sweep", "sweepExpired", operationId, "controller blocked/expired: an approved recovery sweep is required");
        }
        // ①（r14 预裁十二①）: controller 正常路径携审批时经同一 approvalParamGate 绑定（mut3 修法）
        if (typeof approvalRef === "string") {
          return approvalParamGate(projectDir, { approvalRef, approvalHash, expectedKind: "safeWrite", operationId, caller: { principal: "session", callerSessionId } });
        }
        return undefined;
      }
      throw err("not_controller", "sweepExpired", operationId, "sweep callers: ACTIVE controller or approved recovery");
    },
    mutate: async ({ state, currentState }) => {
      const c = state.authorization.controller;
      // 裁定四: 终态（CLOSED/INTERRUPTED/UNKNOWN）一律 no-op 不复活；无「跳过自身」特殊
      // 分支——controller 正常路径对过期会话（含控制会话自身）同样迁移 UNKNOWN，仅控制
      // 会话过期置 controller.blocked（docs/14:325/:329）。
      const expiredOf = (rec) => {
        const hb = rec.live_state?.heartbeat;
        if (typeof hb !== "string") return false;
        const t = Date.parse(hb);
        return Number.isFinite(t) && nowMs - t > HEARTBEAT_EXPIRY_MS;
      };
      let changed = false;
      for (const uuid of Object.keys(state.sessions)) {
        const rec = state.sessions[uuid];
        if (!expiredOf(rec)) continue;
        if (TERMINAL_LIFECYCLES.includes(rec.live_state.lifecycle)) continue;
        rec.live_state.lifecycle = "UNKNOWN";
        rec.live_state.work_outcome = "UNKNOWN";
        changed = true;
        if (uuid === c.session_uuid && c.blocked !== true) {
          state.authorization.controller = { ...c, blocked: true };
          changed = true;
        }
      }
      if (!changed) return { noop: true, revision: currentState.revision };
      return {};
    },
  });
  return { revision: out.revision };
}

export async function closeSession(args) {
  const { projectDir, sessionUuid, closure, callerSessionId, evidenceRef, evidenceHash, approvalRef, approvalHash, expectedRevision, operationId } = args ?? {};
  assertOperationId(operationId);
  assertProjectDir(projectDir, operationId);
  if (typeof sessionUuid !== "string" || sessionUuid.length === 0) throw err("invalid_argument", "closeSession.sessionUuid", operationId, "sessionUuid required");
  if (typeof evidenceRef !== "string" || evidenceRef.length === 0) throw err("invalid_argument", "closeSession.evidenceRef", operationId, "evidenceRef required");
  if (typeof evidenceHash !== "string" || evidenceHash.length === 0) throw err("invalid_argument", "closeSession.evidenceHash", operationId, "evidenceHash required");
  assertClosureBody(closure, operationId);
  const out = await sessionWrite({
    projectDir, principal: "session", sessionId: callerSessionId ?? null, operationId, expectedRevision,
    command: "closeSession", payload: (() => { const p = { sessionUuid, closure, evidenceRef }; if (approvalRef !== undefined) p.approvalRef = approvalRef; return p; })(),
    authorize: async ({ state }) => {
      const writer = resolveWriterRole(state, "session", callerSessionId, operationId);
      const c = state.authorization.controller;
      if (writer.kind === "controller" && c.blocked === true) {
        return approvalChain(projectDir, { approvalRef, approvalHash, evidenceRef, evidenceHash, expectedKind: "safeWrite", operationId, caller: { principal: "session", callerSessionId } });
      }
      if (writer.kind === "recovery") {
        return approvalChain(projectDir, { approvalRef, approvalHash, evidenceRef, evidenceHash, expectedKind: "safeWrite", operationId, caller: { principal: "session", callerSessionId } });
      }
      if (writer.kind === "controller") {
        assertControllerWrite(state, { principal: "session", sessionId: callerSessionId, operationId }, undefined, clockNow);
        await evidenceParamCheck(projectDir, evidenceRef, evidenceHash, operationId);
        if (typeof approvalRef === "string") {
          return approvalParamGate(projectDir, { approvalRef, approvalHash, expectedKind: "safeWrite", operationId, caller: { principal: "session", callerSessionId } });
        }
        return undefined;
      }
      if (writer.kind === "worker") {
        if (sessionUuid !== callerSessionId) {
          throw err("not_controller", "closeSession", operationId, "worker may only close its own session");
        }
        if (c.blocked === true) {
          // 裁定六: blocked 时一切非审批写 deny（含 worker 自关）——须带四件审批
          return approvalChain(projectDir, { approvalRef, approvalHash, evidenceRef, evidenceHash, expectedKind: "safeWrite", operationId, caller: { principal: "session", callerSessionId } });
        }
        await evidenceParamCheck(projectDir, evidenceRef, evidenceHash, operationId);
        return undefined;
      }
      throw err("not_controller", "closeSession", operationId, "close callers: controller (self/representative), worker (self), approved recovery");
    },
    mutate: async ({ state }) => {
      const c = state.authorization.controller;
      const rec = state.sessions[sessionUuid];
      if (!rec) throw err("unknown_session", "closeSession", operationId, "closing session not registered: " + sessionUuid);
      const lc = rec.live_state.lifecycle;
      if (lc === "CLOSING") throw err("invalid_transition", "closeSession", operationId, "session already CLOSING");
      if (TERMINAL_LIFECYCLES.includes(lc)) throw err("session_terminal", "closeSession", operationId, "session lifecycle " + lc + " denies close");
      if ((state.pending_audit ?? 0) > 0) throw err("blocked", "close.pending_audit", operationId, "pending_audit non-zero blocks close");
      const unresolved = (state.effects ?? []).filter((e) => UNRESOLVED_EFFECT_STATES.has(e.state)).length;
      if (unresolved > 0) throw err("blocked", "close.unresolved", operationId, "unresolved effects block close");
      if (state.active_run !== null && state.active_run !== undefined && state.active_run.session_uuid === sessionUuid) {
        throw err("close_with_active_run", "closeSession", operationId, "session holds the active run; endRun before close");
      }
      // 裁定一: 事务A 保留指派不置空——控制自关置空＋released_at＋epoch+1 发生在步③ CLOSED
      // 终态化时（§3.5-B 步③）；接管路径置空发生在接管事务。
      // 事务A: OPEN/IDLE -> CLOSING + SessionClosure into pending_closures + closure_index anchor
      rec.live_state.lifecycle = "CLOSING";
      const closureRevision = state.revision;
      state.pending_closures[sessionUuid] = { descriptor: rec.descriptor, closure, closure_revision: closureRevision };
      const chash = closureHashOf(rec.descriptor, closure, closureRevision);
      const idx = rec.closure_index;
      const entry = { entry_id: chash, session_uuid: sessionUuid, closure_hash: chash, archived_at: nowIso(), prev_entry_hash: idx.closure_head_hash };
      const at = idx.recent_entries.findIndex((e) => e && e.session_uuid === sessionUuid);
      if (at >= 0) idx.recent_entries[at] = entry;
      else idx.recent_entries.push(entry);
      if (idx.recent_entries.length > RECENT_ENTRIES_LIMIT) idx.recent_entries.splice(0, idx.recent_entries.length - RECENT_ENTRIES_LIMIT);
      idx.closure_head_hash = chash;
      idx.closure_count += 1;
      return {};
    },
  });
  return { revision: out.revision };
}

export async function startRun(args) {
  const { projectDir, principal, callerSessionId, sessionUuid, runUuid, expectedRevision, operationId } = args ?? {};
  assertOperationId(operationId);
  assertProjectDir(projectDir, operationId);
  if (typeof sessionUuid !== "string" || sessionUuid.length === 0) throw err("invalid_argument", "startRun.sessionUuid", operationId, "sessionUuid required");
  if (typeof runUuid !== "string" || runUuid.length === 0) throw err("invalid_argument", "startRun.runUuid", operationId, "runUuid required (empty run_uuid denied)");
  const out = await sessionWrite({
    projectDir, principal, sessionId: callerSessionId ?? null, operationId, expectedRevision,
    command: "startRun", payload: { sessionUuid, runUuid },
    requireBackfillClean: true,
    authorize: async ({ state }) => {
      assertControllerWrite(state, { principal, sessionId: callerSessionId, operationId }, undefined, clockNow);
      return undefined;
    },
    mutate: async ({ state }) => {
      const rec = state.sessions[sessionUuid];
      if (!rec) throw err("unknown_session", "startRun", operationId, "session not registered: " + sessionUuid);
      if (!["OPEN", "IDLE"].includes(rec.live_state.lifecycle)) {
        throw err("invalid_transition", "startRun", operationId, "startRun requires lifecycle OPEN/IDLE, got " + rec.live_state.lifecycle);
      }
      for (const uuid2 of Object.keys(state.sessions)) {
        const r2 = state.sessions[uuid2];
        if (uuid2 !== sessionUuid && r2.live_state?.current_run && r2.live_state.current_run.run_uuid === runUuid) {
          throw err("duplicate_run_id", "startRun", operationId, "run id already held by another session; bare runId is ambiguous (session_uuid required)");
        }
      }
      if (scanRunUuidHistory(projectDir, state.state_uuid, runUuid)) {
        throw err("duplicate_run_id", "startRun", operationId, "run id already used in project history (scan of past revisions); bare runId reuse denied");
      }
      if (state.active_run !== null && state.active_run !== undefined) {
        throw err("second_active_run", "startRun", operationId, "project keeps a single active run");
      }
      state.active_run = { session_uuid: sessionUuid, run_uuid: runUuid };
      rec.live_state.current_run = { session_uuid: sessionUuid, run_uuid: runUuid };
      if (rec.live_state.lifecycle === "IDLE") rec.live_state.lifecycle = "OPEN";
      return {};
    },
  });
  return { revision: out.revision };
}

export async function endRun(args) {
  const { projectDir, principal, callerSessionId, sessionUuid, runUuid, expectedRevision, operationId } = args ?? {};
  assertOperationId(operationId);
  assertProjectDir(projectDir, operationId);
  if (typeof sessionUuid !== "string" || sessionUuid.length === 0) throw err("invalid_argument", "endRun.sessionUuid", operationId, "sessionUuid required");
  if (typeof runUuid !== "string" || runUuid.length === 0) throw err("invalid_argument", "endRun.runUuid", operationId, "runUuid required");
  const out = await sessionWrite({
    projectDir, principal, sessionId: callerSessionId ?? null, operationId, expectedRevision,
    command: "endRun", payload: { sessionUuid, runUuid },
    authorize: async ({ state }) => {
      assertControllerWrite(state, { principal, sessionId: callerSessionId, operationId }, undefined, clockNow);
      return undefined;
    },
    mutate: async ({ state }) => {
      const rec = state.sessions[sessionUuid];
      if (!rec) throw err("unknown_session", "endRun", operationId, "session not registered: " + sessionUuid);
      if (state.active_run === null || state.active_run === undefined) {
        throw err("no_active_run", "endRun", operationId, "no active run to end");
      }
      if (state.active_run.session_uuid !== sessionUuid || state.active_run.run_uuid !== runUuid) {
        throw err("no_active_run", "endRun", operationId, "active run does not match sessionUuid/runUuid");
      }
      if (rec.live_state.lifecycle !== "OPEN") {
        throw err("invalid_transition", "endRun", operationId, "endRun requires lifecycle OPEN, got " + rec.live_state.lifecycle);
      }
      state.active_run = null;
      rec.live_state.current_run = null;
      rec.live_state.lifecycle = "IDLE";
      return {};
    },
  });
  return { revision: out.revision };
}

// ---------------------------------------------------------------------------
// temp-root guard (prefix / traversal / symlink_escape / ancestor_escape)
// ---------------------------------------------------------------------------
export async function guardSessionTempRoot(tempRoot) {
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

// ===========================================================================
// self-test harness
// ===========================================================================
const SELFTEST_CLOCK_MS = Date.parse(TS0) + 15 * 60 * 1000;
const INTERFACE_NAMES = ["assignController", "openSession", "applySessionEvent", "heartbeat", "sweepExpired", "closeSession", "startRun", "endRun"];
const DELEGATED_OPS = new Set(["assignController"]);

function getPath(root, p) {
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
function jsonDeepEq(x, y) {
  if (x === y) return true;
  if (Array.isArray(x) && Array.isArray(y)) return JSON.stringify(x) === JSON.stringify(y);
  return false;
}
function evalProbe(observed, a) {
  const actual = getPath(observed, a.path);
  switch (a.op) {
    case "eq": return jsonDeepEq(actual, a.value);
    case "ne": return actual !== a.value;
    case "exists": return actual !== undefined;
    case "absent": return actual === undefined;
    case "gte": return typeof actual === "number" && typeof a.value === "number" && actual >= a.value;
    case "lte": return typeof actual === "number" && typeof a.value === "number" && actual <= a.value;
    case "contains": return Array.isArray(actual) && actual.includes(a.value);
    default: return false;
  }
}
function evalAssertionString(observed, s) {
  const m = /^(\$\S+)\s+(eq|ne|exists|absent|gte|lte|contains)\s*(.*)$/.exec(s);
  if (!m) return false;
  let value = undefined;
  if (m[3]) {
    try { value = JSON.parse(m[3]); } catch { value = m[3]; }
  }
  return evalProbe(observed, { path: m[1], op: m[2], value });
}

async function mintArtifacts(projectDir, vector) {
  const mint = vector.input.mint ?? {};
  const skipEvidence = new Set(vector.input.mint_skip_evidences ?? []);
  const approvalsDir = path.join(projectDir, "docs", "evidence", "runtime-approvals");
  await fsp.mkdir(approvalsDir, { recursive: true });
  const written = new Set();
  const hashes = { approval: {}, evidence: {} };
  for (const e of vector.input.seed_inbox ?? []) {
    if (e && typeof e.evidence_ref === "string" && e.evidence_ref.length > 0 && !skipEvidence.has(e.evidence_ref) && !written.has("E:" + e.evidence_ref)) {
      written.add("E:" + e.evidence_ref);
      const o = (mint.evidences ?? {})[e.evidence_ref] ?? {};
      const doc = { evidenceId: path.basename(e.evidence_ref, ".json"), note: "rt1d self-test inbox evidence", ...(o.doc ?? {}) };
      const hash = o.badHash ? "0".repeat(64) : sha256hex(canonicalJSON(doc));
      hashes.evidence[e.evidence_ref] = hash;
      await fsp.writeFile(path.join(approvalsDir, e.evidence_ref), canonicalJSON({ ...doc, evidenceHash: hash }), "utf-8");
    }
  }
  for (const step of vector.input.steps ?? []) {
    const a = step.args ?? {};
    const approvalRef = a.approvalRef;
    if (typeof approvalRef === "string" && approvalRef.length > 0 && !written.has("A:" + approvalRef)) {
      written.add("A:" + approvalRef);
      const o = (mint.approvals ?? {})[approvalRef] ?? {};
      const doc = {
        approvalId: path.basename(approvalRef, ".json"),
        projectId: "rt1d-selftest",
        kind: o.kind ?? (step.op === "assignController" ? "assignController" : "safeWrite"),
        allowedCallers: o.allowedCallers ?? [{ principal: a.principal ?? "session", callerSessionId: a.callerSessionId ?? null }],
        ...(o.operationId !== undefined ? { operationId: o.operationId } : { operationId: a.operationId }),
        ...(o.controllerDescriptor ? { controllerDescriptor: o.controllerDescriptor } : {}),
      };
      const hash = o.badHash ? "0".repeat(64) : computeApprovalHash(doc);
      hashes.approval[approvalRef] = hash;
      await fsp.writeFile(path.join(approvalsDir, approvalRef), canonicalJSON({ ...doc, approvalHash: hash }), "utf-8");
    }
    for (const evidenceRef of [a.evidenceRef, a.heartbeatEvidence]) {
      if (typeof evidenceRef !== "string" || evidenceRef.length === 0 || written.has("E:" + evidenceRef)) continue;
      written.add("E:" + evidenceRef);
      const o = (mint.evidences ?? {})[evidenceRef] ?? {};
      const doc = { evidenceId: path.basename(evidenceRef, ".json"), note: "rt1d self-test evidence", ...(o.doc ?? {}) };
      const hash = o.badHash ? "0".repeat(64) : sha256hex(canonicalJSON(doc));
      hashes.evidence[evidenceRef] = hash;
      await fsp.writeFile(path.join(approvalsDir, evidenceRef), canonicalJSON({ ...doc, evidenceHash: hash }), "utf-8");
    }
  }
  return hashes;
}

async function seedVector(projectDir, vector) {
  const inbox = vector.input.seed_inbox;
  if (Array.isArray(inbox) && inbox.length) {
    await fsp.mkdir(path.dirname(inboxPath(projectDir)), { recursive: true });
    await fsp.writeFile(inboxPath(projectDir), inbox.map((e) => canonicalJSON(e)).join("\n") + "\n", "utf-8");
  }
}

// fixture placeholders: "@auto:current_revision" (optimistic-lock alignment, run-store
// fixture precedent) and "@mint:approvalHash:<ref>" / "@mint:evidenceHash:<ref>" (the
// recomputed immutable-artifact hashes — positives carry the correct values, negatives
// pass deliberate wrong constants)
function substitutePlaceholders(node, hashes, currentRevision, projectDir) {
  if (typeof node === "string") {
    if (node === "@auto:current_revision") return currentRevision;
    if (node.startsWith("@mint:approvalHash:")) return hashes.approval[node.slice("@mint:approvalHash:".length)];
    if (node.startsWith("@mint:evidenceHash:")) return hashes.evidence[node.slice("@mint:evidenceHash:".length)];
    if (node.startsWith("@project:")) return path.join(projectDir, node.slice("@project:".length));
    return node;
  }
  if (Array.isArray(node)) return node.map((x) => substitutePlaceholders(x, hashes, currentRevision, projectDir));
  if (node && typeof node === "object") {
    const out = {};
    for (const k of Object.keys(node)) out[k] = substitutePlaceholders(node[k], hashes, currentRevision, projectDir);
    return out;
  }
  return node;
}
async function currentRevisionOf(projectDir) {
  try {
    const a = JSON.parse(await fsp.readFile(path.join(runtimeDir(projectDir), "authority.json"), "utf-8"));
    return typeof a.current_revision === "number" ? a.current_revision : 0;
  } catch {
    return 0;
  }
}

async function runFsStep(projectDir, step) {
  const target = path.isAbsolute(step.path) ? step.path : path.join(projectDir, step.path);
  if (step.action === "delete") {
    await fsp.rm(target, { recursive: true, force: true });
  } else if (step.action === "write") {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, step.content ?? "", "utf-8");
  } else if (step.action === "mkdir") {
    await fsp.mkdir(target, { recursive: true });
  } else if (step.action === "symlink") {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.symlink(step.target, target);
  } else if (step.action === "chmod") {
    await fsp.chmod(target, step.mode ?? 0o000);
  } else if (step.action === "append") {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.appendFile(target, step.content ?? "", "utf-8");
  } else if (step.action === "prepend") {
    const prev = await fsp.readFile(target, "utf-8").catch(() => "");
    await fsp.writeFile(target, (step.content ?? "") + prev, "utf-8");
  } else {
    throw new Error("unknown __fs action " + step.action);
  }
}

async function observeProject(projectDir) {
  const obs = { result: null, steps: [], state: null, files: { inbox_lines: 0, index_entries: 0, ledger_entries: 0, ledger_exists: false, request_approvals_exists: false, approval_bindings: 0, archive_names: [], archive_valid: {}, index_chain_ok: true, index_corrupt: false, projections_written: [] } };
  // r17 接线证据面: 文件存在性观察（F-SS-265 强断言=ledger 保持缺失；F-SS-267=request-approvals
  // 未被 deny 前的绑定写重建）——不只行数/绑定数（空文件重建形态可被行数放过）。
  obs.files.ledger_exists = fs.existsSync(eventLedgerPath(projectDir));
  obs.files.request_approvals_exists = fs.existsSync(path.join(runtimeDir(projectDir), "request-approvals.json"));
  try {
    const ra = JSON.parse(await fsp.readFile(path.join(runtimeDir(projectDir), "request-approvals.json"), "utf-8"));
    obs.files.approval_bindings = Object.keys(ra.bindings ?? {}).length;
  } catch {}
  const hasAuthority = fs.existsSync(path.join(runtimeDir(projectDir), "authority.json"));
  if (hasAuthority) {
    try {
      const { state } = await readCurrent({ projectDir });
      obs.state = state;
    } catch (error) {
      obs.state = null;
      obs.read_error = error instanceof RunStoreError ? error.code : String(error);
    }
  }
  obs.files.inbox_lines = (await readJsonl(inboxPath(projectDir))).length;
  // 观察面容错：索引坏行不炸观察（deny 向量的观察仍可运行），标记 index_corrupt
  let idx = [];
  try {
    idx = await readJsonl(closureIndexPath(projectDir));
  } catch {
    obs.files.index_corrupt = true;
  }
  obs.files.index_entries = idx.length;
  for (let i = 1; i < idx.length; i += 1) {
    if (idx[i].prev_entry_hash !== idx[i - 1].closure_hash) obs.files.index_chain_ok = false;
  }
  obs.files.ledger_entries = (await readJsonl(eventLedgerPath(projectDir))).length;
  obs.files.applied_count = Array.isArray(obs.state?.applied_operations) ? obs.state.applied_operations.length : 0;
  const archiveDir = path.join(projectDir, ARCHIVE_REL);
  if (fs.existsSync(archiveDir)) {
    for (const name of fs.readdirSync(archiveDir)) {
      obs.files.archive_names.push(name);
      const st = fs.statSync(path.join(archiveDir, name));
      if (!st.isFile()) { obs.files.archive_valid[name.replace(/\.json$/, "")] = false; continue; }
      try {
        const body = JSON.parse(await fsp.readFile(path.join(archiveDir, name), "utf-8"));
        const uuid = name.replace(/\.json$/, "");
        const rec = obs.state?.sessions?.[uuid];
        const entry = rec?.closure_index?.recent_entries?.find?.((e) => e.session_uuid === uuid);
        obs.files.archive_valid[uuid] = entry ? sha256hex(canonicalJSON(body)) === entry.closure_hash : false; // r11⑭: 无锚不作 valid 断言
      } catch {
        obs.files.archive_valid[name.replace(/\.json$/, "")] = false;
      }
    }
  }
  const projDir = path.join(runtimeDir(projectDir), "projections");
  if (fs.existsSync(projDir)) obs.files.projections_written = listFilesRecursive(projDir);
  return obs;
}
function listFilesRecursive(dir, base) {
  const root = base ?? dir;
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...listFilesRecursive(p, root));
    else out.push(path.relative(root, p));
  }
  return out;
}

async function runVector(v, runRoot) {
  const baseDir = path.join(runRoot, String(v.vector_index).padStart(3, "0") + "-" + v.fixture_id);
  const projects = {};
  const projectNames = Array.from(new Set([(v.input.project ?? "p1"), ...((v.input.steps ?? []).map((s) => s.project).filter(Boolean))]));
  for (const name of projectNames) {
    const dir = path.join(baseDir, name);
    await fsp.mkdir(dir, { recursive: true });
    projects[name] = { dir, hashes: await mintArtifacts(dir, v) };
    await seedVector(dir, v);
  }
  const projectDir = projects[v.input.project ?? "p1"].dir;
  const steps = [];
  let last = null;
  let prevRevision = null;
  for (const step of v.input.steps ?? []) {
    const stepProject = projects[step.project ?? v.input.project ?? "p1"].dir;
    if (step.op === "__fs") {
      await runFsStep(stepProject, step);
      steps.push({ op: "__fs", ok: true });
      continue;
    }
    if (step.op === "__transact") {
      const a = step.args ?? {};
      const out = await transact({ projectDir: stepProject, principal: a.principal, sessionId: a.sessionId ?? null, expectedRevision: await currentRevisionOf(stepProject), operationId: a.operationId ?? "op-transact-" + steps.length, command: a.command, payload: a.payload });
      steps.push({ op: "__transact", ok: true, revision: out.revision });
      prevRevision = out.revision;
      continue;
    }
    if (step.op === "__corrupt_history") {
      const a = step.args ?? {};
      const stDir = path.join(stepProject, ".zcode/runtime/state");
      let sdir = null;
      for (const d of fs.readdirSync(stDir)) {
        if (fs.statSync(path.join(stDir, d)).isDirectory()) { sdir = d; break; }
      }
      if (sdir) {
        const f = path.join(stDir, sdir, "r-" + (a.revision ?? 1) + ".json");
        await fsp.writeFile(f, String(a.garbage ?? "corrupt-not-json"), "utf-8");
      }
      void fs;
      steps.push({ op: "__corrupt_history", ok: true });
      continue;
    }
    if (step.op === "__patch_state") {
      const a = step.args ?? {};
      const { state } = await readCurrent({ projectDir: stepProject });
      const next = structuredClone(state);
      if (a.__mutate === "set_lifecycle_closing" && typeof a.session_uuid === "string") {
        const rec3 = next.sessions[a.session_uuid];
        if (rec3) rec3.live_state.lifecycle = "CLOSING";
      }
      if (a.__mutate === "corrupt_head_hash" && typeof a.session_uuid === "string") {
        const rec2 = next.sessions[a.session_uuid];
        if (rec2) rec2.closure_index.closure_head_hash = "f".repeat(64);
      }
      if (a.__mutate === "corrupt_count" && typeof a.session_uuid === "string") {
        const rec2 = next.sessions[a.session_uuid];
        if (rec2) rec2.closure_index.closure_count = 2;
      }
      if (a.__mutate === "eject_recent_set_pending" && typeof a.session_uuid === "string") {
        const rec2 = next.sessions[a.session_uuid];
        if (rec2) rec2.closure_index.recent_entries = [];
        if (rec2 && !next.pending_closures[a.session_uuid]) {
          // crash mid-state: the archive was published but the pending entry was never pruned —
          // restore the ORIGINAL body verbatim from the immutable archive file
          try {
            const archFile = path.join(stepProject, "docs/evidence/session-closures", a.session_uuid + ".json");
            const body = JSON.parse(await fsp.readFile(archFile, "utf-8"));
            if (body && body.descriptor && body.closure && typeof body.closure_revision === "number") {
              next.pending_closures[a.session_uuid] = { descriptor: body.descriptor, closure: body.closure, closure_revision: body.closure_revision };
            }
          } catch { /* archive missing: leave pending unset */ }
        }
      }
      delete a.__mutate;
      delete a.session_uuid;
      Object.assign(next, a);
      const { sha256hex: sha2, canonicalJSON: canon2, computeSelfHash } = await import("./run-state.mjs");
      next.self_hash = computeSelfHash(next);
      const revFile = path.join(runtimeDir(stepProject), "state", next.state_uuid, "r-" + next.revision + ".json");
      await fsp.writeFile(revFile, canonicalJSON(next), "utf-8");
      const auth = JSON.parse(await fsp.readFile(path.join(runtimeDir(stepProject), "authority.json"), "utf-8"));
      auth.current_hash = next.self_hash;
      await fsp.writeFile(path.join(runtimeDir(stepProject), "authority.json"), canonicalJSON(auth), "utf-8");
      const hwFile = path.join(runtimeDir(stepProject), "highwater.json");
      if (fs.existsSync(hwFile)) {
        const hw = JSON.parse(await fsp.readFile(hwFile, "utf-8"));
        if (hw[next.state_uuid]) { hw[next.state_uuid].current_hash = next.self_hash; await fsp.writeFile(hwFile, canonicalJSON(hw), "utf-8"); }
      }
      steps.push({ op: "__patch_state", ok: true });
      continue;
    }
    if (!INTERFACE_NAMES.includes(step.op)) throw new Error("unknown step op " + step.op);
    const fn = INTERFACES[step.op];
    let rec = { op: step.op, ok: false };
    try {
      const cur = await currentRevisionOf(stepProject);
      const args2 = substitutePlaceholders(step.args ?? {}, projects[step.project ?? v.input.project ?? "p1"].hashes, cur, stepProject);
      if (typeof args2.projectDir === "string" && args2.projectDir.length > 0) {
        const out = await fn(args2);
        rec = { op: step.op, ok: true, revision: out.revision, dispatch: DELEGATED_OPS.has(step.op) ? "delegated" : "self_write", ...out };
      } else {
        const out = await fn({ ...args2, projectDir: stepProject });
        rec = { op: step.op, ok: true, revision: out.revision, dispatch: DELEGATED_OPS.has(step.op) ? "delegated" : "self_write", ...out };
      }
    } catch (error) {
      rec = { op: step.op, ok: false, error_code: error instanceof RunStoreError ? error.code : "harness_error", error_stage: error instanceof RunStoreError ? error.stage + ":" + error.message : String(error?.message ?? error) + " @" + String(error?.stack?.split("\n")[1] ?? "").trim() };
    }
    if (rec.ok && typeof rec.revision === "number" && prevRevision !== null) rec.revision_delta = rec.revision - prevRevision;
    if (rec.ok) prevRevision = rec.revision;
    steps.push(rec);
    last = rec;
  }
  const obs = await observeProject(projectDir);
  obs.steps = steps;
  obs.result = last;
  obs.projects = {};
  for (const name of projectNames) {
    if (name === (v.input.project ?? "p1")) continue;
    const o = await observeProject(projects[name].dir);
    obs.projects[name] = { state: o.state, files: o.files };
  }
  return { obs, projectDir };
}

const INTERFACES = {
  assignController: (a) => assignController(a),
  openSession: (a) => openSession(a),
  applySessionEvent: (a) => applySessionEvent(a),
  heartbeat: (a) => heartbeat(a),
  sweepExpired: (a) => sweepExpired(a),
  closeSession: (a) => closeSession(a),
  startRun: (a) => startRun(a),
  endRun: (a) => endRun(a),
};

async function runSelfTest({ fixturesPath, tempRoot }) {
  const guard = await guardSessionTempRoot(tempRoot);
  if (!guard.ok) {
    console.error("self-test temp-root rejected: " + guard.reason + " (" + tempRoot + ")");
    return { rc: 1 };
  }
  const runRoot = path.join(guard.resolved, "run-" + process.pid + "-" + Date.now());
  await fsp.mkdir(runRoot, { recursive: true });
  let vectors;
  try {
    const doc = JSON.parse(await fsp.readFile(fixturesPath, "utf-8"));
    if (doc.schema_version !== "run-session-fixtures/v1") throw new Error("schema_version mismatch");
    vectors = doc.vectors;
  } catch (error) {
    console.error("fixture load failed: " + error.message);
    return { rc: 3 };
  }
  SESSION_CLOCK = () => SELFTEST_CLOCK_MS;
  const results = [];
  for (let i = 0; i < vectors.length; i += 1) {
    const v = { ...vectors[i], vector_index: i };
    let r;
    try {
      const { obs } = await runVector(v, runRoot);
      const failures = [];
      const wantExit = v.expected.exit;
      if (wantExit === 0 && !obs.result?.ok) failures.push("expected ok, got error " + (obs.result?.error_code ?? "none"));
      if (wantExit === 1 && obs.result?.ok) failures.push("expected deny, got ok rev=" + obs.result?.revision);
      if (wantExit === 1 && v.expected.error_code && obs.result?.error_code !== v.expected.error_code) {
        failures.push("expected error_code " + v.expected.error_code + ", got " + (obs.result?.error_code ?? "none"));
      }
      (v.expected.state_probe ?? []).forEach((a, j) => {
        if (!evalProbe(obs, a)) failures.push("probe[" + j + "] " + a.path + " " + a.op + " " + JSON.stringify(a.value) + " failed");
      });
      (v.assertions ?? []).forEach((s, j) => {
        if (!evalAssertionString(obs, s)) failures.push("assertion[" + j + "] " + s + " failed");
      });
      r = { fixtureId: v.fixture_id, mode: v.mode, ok: failures.length === 0, failed: failures, obs };
    } catch (error) {
      r = { fixtureId: v.fixture_id, mode: v.mode, ok: false, failed: ["harness: " + error.message], obs: null };
    }
    results.push(r);
  }
  const sessionModes = new Set(["open", "heartbeat", "sweep", "assign"]);
  const leaseModes = new Set(["run"]);
  const closureModes = new Set(["close"]);
  const matrixOf = (modes) => results.filter((r) => modes.has(r.mode));
  const mtx = (modes) => {
    const g = matrixOf(modes);
    return g.length > 0 && g.every((r) => r.ok) ? "PASS" : "FAIL";
  };
  console.log("session_matrix=" + mtx(sessionModes) + " lease_matrix=" + mtx(leaseModes) + " closure_matrix=" + mtx(closureModes));
  for (const r of results) {
    console.log(r.fixtureId + " " + r.mode + " " + (r.ok ? "PASS" : "FAIL") +
      " op=" + (r.obs?.result?.op ?? "?") +
      " dispatch=" + (r.obs?.result?.dispatch ?? (r.obs?.result?.ok === false ? "deny" : "?")) +
      " revision=" + (r.obs?.result?.revision ?? "-") +
      " error=" + (r.obs?.result?.error_code ?? "-") +
      (r.obs?.result?.error_code === "harness_error" ? " detail=" + String(r.obs?.result?.error_stage ?? "").slice(0, 200) : "") +
      (r.ok ? "" : " failed=" + r.failed.slice(0, 3).join(";")));
  }
  const failed = results.filter((r) => !r.ok);
  const distinctIds = new Set(results.map((r) => r.fixtureId)).size;
  console.log("self-test 汇总：fixtures=" + distinctIds + " vectors=" + results.length + " failed=" + failed.length + " skip_ids=0");
  console.log("run_root=" + runRoot);
  return { rc: failed.length === 0 ? 0 : 1, runRoot };
}

async function main(argv) {
  const args = argv.slice(2);
  const selfTest = args.includes("--self-test");
  let fixtures = DEFAULT_FIXTURES;
  let tempRoot = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--fixtures") fixtures = args[i + 1];
    if (args[i] === "--temp-root") tempRoot = args[i + 1];
  }
  if (!selfTest) {
    console.log("run-session: no-op without --self-test (no fixture execution, no writes)");
    return 0;
  }
  if (tempRoot === null) {
    // bare --self-test: default root exists -> refuse (stale-run guard)
    if (fs.existsSync(DEFAULT_TEMP_ROOT)) {
      console.error("self-test temp-root rejected: temp_root_exists (" + DEFAULT_TEMP_ROOT + "); pass an explicit --temp-root");
      return 1;
    }
    tempRoot = DEFAULT_TEMP_ROOT;
  }
  const { rc } = await runSelfTest({ fixturesPath: fixtures, tempRoot });
  return rc;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // 预裁十四 P0: 自然退出形态——只设 exitCode，不调 process.exit；Node 待事件循环把
  // stdout 管道缓冲排空后自行退出（大输出＋负载下 process.exit 会丢缓冲块，管道截断）。
  main(process.argv).then((rc) => { process.exitCode = rc; });
}
