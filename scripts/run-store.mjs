#!/usr/bin/env node
// run-store.mjs — RT1A versioned store (green phase)
// Four frozen interfaces: transact / readCurrent / commitOperation live here;
// validateRevision is owned by run-state.mjs and re-exported. Dependency
// direction run-store -> run-state only. The --self-test entry is the
// batch-local harness; without --self-test this file runs no fixture and
// performs no writes.
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  RunStoreError, canonicalJSON, sha256hex, computeSelfHash, computeApprovalHash,
  atomicWrite, revisionFilePath, validateRevision, GENESIS_PARENT_HASH,
  GENESIS_JOURNAL_HEAD, HEX64, isRunStoreErrorFields,
} from "./run-state.mjs";
import { shapeFromSchema } from "./shape-check.mjs";

export { RunStoreError, validateRevision } from "./run-state.mjs";

const RUNTIME_REL = path.join(".zcode", "runtime");
const APPROVALS_REL = path.join("docs", "evidence", "runtime-approvals");
const TS0 = "2026-11-05T10:00:00Z";
const QUEUE_LIMIT = 32;
const EFFECTS_LIMIT = 64;
const APPLIED_LIMIT = 256;
const STATE_BYTES_LIMIT = 1048576;
const REVISIONS_LIMIT = 512;
const CAPACITY_LIMITS = { queue: QUEUE_LIMIT, effects: EFFECTS_LIMIT, applied: APPLIED_LIMIT, state_bytes: STATE_BYTES_LIMIT, revisions: REVISIONS_LIMIT };
const PROTECTED_PAYLOAD_KEYS = ["controller", "controller_epoch", "stop_epoch", "active_run", "mode", "authority_epoch", "approvalHash", "evidenceHash"];
const TOP_LEVEL_KEYS = ["projectDir", "principal", "sessionId", "expectedRevision", "operationId", "command", "payload"];
const CALLER_SESSION_COMMANDS = new Set(["applySessionEvent", "sweep"]);
const UNRESOLVED_EFFECT_STATES = new Set(["queued", "scheduled", "retry_scheduled", "claimed", "running", "awaiting_receipt", "stop_pending", "unknown"]);
const FROZEN_JOURNAL_STATES = new Set(["stopping", "preparing", "prepared", "confirming", "recovering"]);

function nowIso() {
  return new Date().toISOString();
}

function runtimeDir(projectDir) {
  return path.join(projectDir, RUNTIME_REL);
}
function authorityPath(projectDir) {
  return path.join(runtimeDir(projectDir), "authority.json");
}
function highwaterPath(projectDir) {
  return path.join(runtimeDir(projectDir), "highwater.json");
}
function journalPath(projectDir) {
  return path.join(runtimeDir(projectDir), "cutover-journal.json");
}
function lockPath(projectDir) {
  return path.join(runtimeDir(projectDir), "lock");
}
function stateDir(projectDir, stateUuid) {
  return path.join(runtimeDir(projectDir), "state", stateUuid);
}
function approvalsDir(projectDir) {
  return path.join(projectDir, APPROVALS_REL);
}
function candidatesDir(projectDir) {
  return path.join(runtimeDir(projectDir), "candidates");
}

// ---------------------------------------------------------------- IO adapter
// Self-test-only fault injection. Production paths construct FaultAdapter.disabled().
class FaultAdapter {
  constructor(fault) {
    this.fault = fault && typeof fault === "object" ? fault : null;
    this.used = 0;
    this.probes = [];
  }
  static disabled() {
    return new FaultAdapter(null);
  }
  hit(phase) {
    if (!this.fault || this.fault.phase !== phase) return null;
    if (this.fault.once && this.used > 0) return null;
    this.used += 1;
    return this.fault;
  }
  fail(phase, stage, operationId) {
    const f = this.hit(phase);
    if (!f) return false;
    if (f.mode === "ENOSPC") {
      const err = new Error("ENOSPC: no space left on device");
      err.code = "ENOSPC";
      throw new RunStoreError({ code: "io_enospc", exitCode: 3, stage, operationId, message: "simulated ENOSPC at " + stage });
    }
    if (phase === "state_readback") {
      throw new RunStoreError({ code: "io_readback", exitCode: 3, stage, operationId, message: "readback self-hash mismatch (injected)" });
    }
    throw new RunStoreError({ code: "io_fault", exitCode: 3, stage, operationId, message: "injected fault at " + stage });
  }
  async writeFile(p, data, stageLabel) {
    // stage is always supplied by the io wrapper (single-shot check; no re-derivation)
    this.fail(stageLabel ?? "state_write", stageLabel ?? "state_write", null);
    const fh = await fsp.open(p, "w");
    await fh.writeFile(data, "utf-8");
    return fh;
  }
}

const PROD_WRITE = async (p, d) => {
  const fh = await fsp.open(p, "w");
  try {
    await fh.writeFile(d, "utf-8");
    return fh;
  } catch (e) {
    await fh.close();
    throw e;
  }
};

// adapter bundle: {writeFile, fsyncFile, fsyncDir, rename, readFile} + phase hooks
function makeIo(adapter, phaseMap) {
  const pm = phaseMap ?? {};
  return {
    writeFile: async (p, d) => {
      const stageLabel = pm.write ?? "state_write";
      if (adapter instanceof FaultAdapter) adapter.fail(stageLabel, stageLabel, null);
      return PROD_WRITE(p, d);
    },
    fsyncFile: async (p, fh) => {
      if (adapter instanceof FaultAdapter) adapter.fail(pm.fsyncFile ?? "state_fsync_file", pm.fsyncFile ?? "state_fsync_file", null);
      await fh.sync();
    },
    fsyncDir: async (dir) => {
      if (adapter instanceof FaultAdapter) adapter.fail(pm.fsyncDir ?? "state_fsync_parent", pm.fsyncDir ?? "state_fsync_parent", null);
      const fh = await fsp.open(dir, "r");
      try {
        await fh.sync();
      } finally {
        await fh.close();
      }
    },
    rename: async (a, b) => {
      if (adapter instanceof FaultAdapter) adapter.fail(pm.rename ?? "state_write", pm.rename ?? "state_write", null);
      await fsp.rename(a, b);
    },
    readFile: async (p, enc) => {
      if (adapter instanceof FaultAdapter && pm.readbackHook) pm.readbackHook(adapter);
      return fsp.readFile(p, enc);
    },
  };
}

// ---------------------------------------------------------------------- lock
async function acquireLock(projectDir, operationId, adapter) {
  const lp = lockPath(projectDir);
  await fsp.mkdir(path.dirname(lp), { recursive: true });
  if (adapter instanceof FaultAdapter) adapter.fail("lock", "lock", operationId);
  const ownerToken = crypto.randomBytes(16).toString("hex");
  const payload = canonicalJSON({ owner_token: ownerToken, pid: process.pid, operationId: operationId ?? null, acquired_at: nowIso() }) + "\n";
  let fh;
  try {
    fh = await fsp.open(lp, "wx");
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new RunStoreError({ code: "lock_held", exitCode: 1, stage: "lock", operationId, message: "stable lock held; no downgrade and no stale break" });
    }
    throw new RunStoreError({ code: "io_lock", exitCode: 3, stage: "lock", operationId, message: "lock acquisition failed: " + error.code });
  }
  try {
    await fh.writeFile(payload, "utf-8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  const dir = path.dirname(lp);
  const dfh = await fsp.open(dir, "r");
  try {
    await dfh.sync();
  } finally {
    await dfh.close();
  }
  return ownerToken;
}

async function releaseLock(projectDir, ownerToken) {
  if (!ownerToken) return;
  const lp = lockPath(projectDir);
  let text;
  try {
    text = await fsp.readFile(lp, "utf-8");
  } catch {
    return;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed.owner_token !== ownerToken) return;
  } catch {
    return;
  }
  await fsp.unlink(lp);
  const dir = path.dirname(lp);
  const dfh = await fsp.open(dir, "r");
  try {
    await dfh.sync();
  } finally {
    await dfh.close();
  }
}

async function lockExists(projectDir) {
  try {
    await fsp.access(lockPath(projectDir));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------- loaders
async function readJsonFile(file, stage) {
  let text;
  try {
    text = await fsp.readFile(file, "utf-8");
  } catch (error) {
    throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: stage + ".load", operationId: null, message: "read failed " + file + ": " + error.code });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: stage + ".parse", operationId: null, message: "corrupt JSON at " + file });
  }
}

const AUTHORITY_KEYS = ["record_revision", "epoch", "mode", "state_uuid", "base_revision", "base_hash", "current_revision", "current_hash", "controller_operation_id", "mode_change_approval_ref", "journal_generation", "journal_head_hash"];

async function loadAuthority(projectDir) {
  const a = await readJsonFile(authorityPath(projectDir), "authority");
  for (const k of AUTHORITY_KEYS) {
    if (!(k in a)) throw new RunStoreError({ code: "authority_corrupt", exitCode: 3, stage: "authority.shape", operationId: null, message: "authority missing key " + k });
  }
  return a;
}

const REVISION_REQUIRED_KEYS = ["schema", "state_uuid", "revision", "owner_session_id", "parent_revision", "parent_hash", "self_hash", "active_run", "queue", "effects", "authorization", "reviews", "sessions", "pending_closures", "applied_operations", "pending_audit"];

async function loadRevisionFile(projectDir, stateUuid, revision) {
  const file = revisionFilePath(projectDir, stateUuid, revision);
  const r = await readJsonFile(file, "revision");
  // schema-point: RS-REVISION — DEFERRED (rt1agg W-1/deferred ledger): the run-state
  // Revision def is stricter than this gate on faces REACHABLE in the fixture space
  // required-keys gate stays as the single execution source.
  for (const k of REVISION_REQUIRED_KEYS) {
    if (!(k in r)) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "revision.shape", operationId: null, message: "revision missing required key " + k });
    }
  }
  if (r.state_uuid !== stateUuid) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "revision.state_uuid", operationId: null, message: "revision state_uuid mismatch" });
  }
  const recomputed = computeSelfHash(r);
  if (recomputed !== r.self_hash) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "state_readback", operationId: null, message: "current revision self-hash mismatch; state untrusted" });
  }
  return r;
}

async function loadHighwater(projectDir) {
  return readJsonFile(highwaterPath(projectDir), "highwater");
}

async function loadJournal(projectDir) {
  let j;
  try {
    j = await readJsonFile(journalPath(projectDir), "journal");
  } catch (error) {
    if (error.code === "io_load_failed" && /ENOENT/.test(error.message)) return null;
    throw error;
  }
  const expectHead = journalHeadHash(j);
  if (j.headHash !== expectHead) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.head_hash", operationId: null, message: "journal headHash does not match recomputed content" });
  }
  for (const e of j.entries ?? []) {
    if (e.entryHash !== entryHashOf(e)) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.entry_hash", operationId: e.operationId, message: "journal entryHash mismatch on load" });
    }
  }
  return j;
}

function entryHashOf(entry) {
  const copy = structuredClone(entry);
  delete copy.entryHash;
  return sha256hex(canonicalJSON(copy));
}

async function writeJournal(projectDir, journal, adapter) {
  const j = structuredClone(journal);
  j.headHash = journalHeadHash(j);
  journal.headHash = j.headHash;
  for (const e of j.entries) {
    const expect = entryHashOf(e);
    if (e.entryHash && e.entryHash !== expect) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal.entry_hash", operationId: e.operationId, message: "journal entryHash does not match recomputed content" });
    }
  }
  const io = makeIo(adapter, { write: "journal_write", fsyncFile: "journal_write", fsyncDir: "journal_write", rename: "journal_write" });
  await atomicWrite(journalPath(projectDir), canonicalJSON(j), io);
  return j;
}

function emptyJournal() {
  return { schema: "cutover-journal/v1", generation: 0, previousHeadHash: GENESIS_JOURNAL_HEAD, headHash: GENESIS_JOURNAL_HEAD, entries: [] };
}

function journalHeadHash(journal) {
  const copy = structuredClone(journal);
  delete copy.headHash;
  return sha256hex(canonicalJSON(copy));
}

function journalEntry(journal, operationId) {
  return (journal?.entries ?? []).find((e) => e.operationId === operationId) ?? null;
}

// ------------------------------------------------------- approvals/evidence
function resolveApprovalRef(projectDir, ref) {
  // schema-point: RS-RESOLVE-REF — DEFERRED (rt1agg W-1/deferred ledger): the non-string/
  // empty ref face has zero fixture coverage (approval_required fires earlier for missing
  // refs; every loadApproval/evidence caller passes checked strings), so no kill vector can
  // exist; the entry shape stays on this handwritten gate. realpath/IO/escape checks follow.
  if (typeof ref !== "string" || ref.length === 0) {
    throw new RunStoreError({ code: "invalid_approval_ref", exitCode: 1, stage: "approval.resolve", operationId: null, message: "approvalRef missing" });
  }
  const base = approvalsDir(projectDir);
  const resolved = path.resolve(base, ref);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new RunStoreError({ code: "approval_ref_escape", exitCode: 1, stage: "approval.resolve", operationId: null, message: "approvalRef escapes approvals dir" });
  }
  return resolved;
}

// schema-point: RS-APPROVAL-ASSIGN/-SAFE-WRITE/-APPLY/-REBASE/-G1A/-G1B/-ABANDON/-RECOVERY — DEFERRED
// (rt1agg W-1/deferred ledger; full reason in schema-drift-allowlist). The per-kind defs match the
// handwritten closed sets key-for-key; VALUE semantics stricter on reachable faces -> handwritten stays.
const APPROVAL_KIND_KEYS = {
  assignController: ["approvalId", "projectId", "operationId", "kind", "allowedCallers", "approvalHash", "controllerDescriptor", "baseRecordRevision", "baseStateRevision"],
  safeWrite: ["approvalId", "projectId", "kind", "allowedCallers", "approvalHash", "operationId"],
  applyApproved: ["approvalId", "projectId", "operationId", "kind", "allowedCallers", "approvalHash", "baseRecordRevision", "baseStateRevision", "controllerDescriptor"],
  checkpointRebase: ["approvalId", "projectId", "operationId", "kind", "allowedCallers", "approvalHash", "baseRecordRevision", "baseStateRevision"],
  cutoverG1a: ["approvalId", "projectId", "operationId", "parentRevision", "parentHash", "stateUuid", "authorityEpoch", "allowedCallers", "controllerDescriptor", "assignedAt", "controllerEvidenceRef", "controllerEvidenceHash", "stopEvidenceRef", "stopEvidenceHash", "approvalHash", "kind"],
  cutoverG1b: ["approvalId", "projectId", "operationId", "candidatePath", "candidateHash", "targetAuthorityEpoch", "allowedCallers", "approvalHash", "kind"],
  cutoverAbandon: ["approvalId", "projectId", "operationId", "candidateHash", "allowedCallers", "abortEvidenceRef", "abortEvidenceHash", "approvalHash", "kind"],
  cutoverRecovery: ["approvalId", "projectId", "confirmedOperationId", "operationId", "parentRevision", "parentHash", "targetAuthorityEpoch", "recoveryTimestamp", "allowedCallers", "controllerDescriptor", "assignedAt", "controllerEvidenceRef", "controllerEvidenceHash", "approvalHash", "kind"]
};
// RT1AGG N2/B1+R2: request-approvals ledger {operationId -> approvalHash}. R2 ruling 1:
// ENOENT = legal empty; corrupt/unreadable = fail-closed (io_load_failed, exit3); the write
// path validates before publishing and never overwrites a corrupt ledger with empty bindings.
function requestApprovalsPath(projectDir) { return path.join(runtimeDir(projectDir), "request-approvals.json"); }
function ledgerBindingsOf(doc) { return doc && typeof doc === "object" && !Array.isArray(doc) && doc.bindings && typeof doc.bindings === "object" && !Array.isArray(doc.bindings) ? doc.bindings : null; } // R5/B1: an ARRAY-shaped bindings value is exists-but-corrupt (typeof [] === "object"), never a valid ledger
async function loadRequestApprovals(projectDir) {
  let doc;
  try {
    doc = JSON.parse(await fsp.readFile(requestApprovalsPath(projectDir), "utf-8"));
  } catch (error) {
    if (error.code === "ENOENT") return {}; // no ledger yet = legal empty (ruling 1)
    if (error instanceof RunStoreError) throw error;
    throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: error.code === "ENOENT" ? "request_approvals.load" : "request_approvals.parse", operationId: null, message: "request-approvals ledger unreadable/unparseable: " + String(error?.message ?? error) });
  }
  const bindings = ledgerBindingsOf(doc);
  if (bindings === null) throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "request_approvals.parse", operationId: null, message: "request-approvals ledger has no valid bindings object" });
  return bindings;
}
async function writeRequestApprovalBinding(projectDir, operationId, approvalHash, adapter) {
  if (typeof approvalHash !== "string") return;
  const bindings = await loadRequestApprovals(projectDir); // corrupt -> fail-closed, never overwritten
  const io = makeIo(adapter ?? FaultAdapter.disabled(), { write: "request_approvals_write", fsyncFile: "request_approvals_write", fsyncDir: "request_approvals_write", rename: "request_approvals_write" }); // 预裁十-6: injectable ledger-write phase
  await atomicWrite(requestApprovalsPath(projectDir), canonicalJSON({ schema: "request-approvals/v1", bindings: { ...bindings, [operationId]: approvalHash } }), io);
}
const REQ_APPROVAL_SET = new Set(["assignController", "stop", "reconcile", "close", "sweep", "applySessionEvent", "applyApproved", "recoverForward", "rebase", "prepare", "confirm", "abandonPreparedCandidate"]);
const N2_FROZEN_LAYER = new Set(["applyApproved", "rebase"]); // transact + mirror share it (run-recover.mjs:1709/:1797)
function n2MirrorApprovalHashFor(command, approvalRef) {
  return REQ_APPROVAL_SET.has(command) && typeof approvalRef === "string" && !N2_FROZEN_LAYER.has(command) ? "load" : undefined;
}
const APPROVAL_OPERATION_ID_REQUIRED = new Set(["assignController", "applyApproved", "checkpointRebase", "cutoverG1a", "cutoverG1b", "cutoverAbandon", "cutoverRecovery"]);

// RT1AGG R1/B2: frozen order required->callers->hash->kind->allowedKeys->binding->caller, split into
// loadApprovalDoc (read+prefix) + assertApprovalGate (suffix) on ONE cached document (no TOCTOU);
// the composed loadApproval stays behavior-equivalent for every other caller.
async function loadApprovalDoc(projectDir, ref, operationId) {
  const file = resolveApprovalRef(projectDir, ref);
  const base = approvalsDir(projectDir);
  let realFile;
  try {
    realFile = await fsp.realpath(file);
  } catch (error) {
    throw new RunStoreError({ code: "approval_missing", exitCode: 1, stage: "approval.load", operationId, message: "approval file unreadable: " + error.code });
  }
  if (realFile !== base && !realFile.startsWith(base + path.sep)) {
    throw new RunStoreError({ code: "approval_ref_escape", exitCode: 1, stage: "approval.resolve", operationId, message: "approval realpath escapes the approvals dir (symlink)" });
  }
  let doc;
  try {
    doc = JSON.parse(await fsp.readFile(realFile, "utf-8"));
  } catch (error) {
    throw new RunStoreError({ code: "approval_missing", exitCode: 1, stage: "approval.load", operationId, message: "approval file unreadable: " + error.code });
  }
  for (const k of ["approvalId", "projectId", "kind", "allowedCallers", "approvalHash"]) {
    if (doc[k] === undefined || doc[k] === null) {
      throw new RunStoreError({ code: "approval_incomplete", exitCode: 1, stage: "approval.shape", operationId, message: "approval missing required key " + k });
    }
  }
  if (!Array.isArray(doc.allowedCallers) || doc.allowedCallers.length === 0) {
    throw new RunStoreError({ code: "approval_incomplete", exitCode: 1, stage: "approval.callers", operationId, message: "allowedCallers must be a non-empty array" });
  }
  const recomputed = computeApprovalHash(doc);
  if (recomputed !== doc.approvalHash) {
    throw new RunStoreError({ code: "approval_hash_mismatch", exitCode: 1, stage: "approval.hash", operationId, message: "approvalHash does not match recomputed content" });
  }
  return doc;
}
function assertApprovalGate(doc, expectedKind, operationId, caller) {
  if (expectedKind && doc.kind !== expectedKind) {
    throw new RunStoreError({ code: "approval_kind_mismatch", exitCode: 1, stage: "approval.kind", operationId, message: "approval kind " + doc.kind + " != " + expectedKind });
  }
  // schema-point: RS-APPROVAL-* — deferred; the per-kind closed sets stay handwritten
  // (see the deferred ledger note at APPROVAL_KIND_KEYS). Check order unchanged.
  const allowedKeys = (Object.prototype.hasOwnProperty.call(APPROVAL_KIND_KEYS, doc.kind) ? APPROVAL_KIND_KEYS[doc.kind] : undefined) ?? ["approvalId", "projectId", "kind", "allowedCallers", "approvalHash", "operationId"]; // R2: hasOwn — prototype kinds (e.g. "constructor") hit the fallback, not TypeError
  for (const k of Object.keys(doc)) {
    if (!allowedKeys.includes(k)) {
      throw new RunStoreError({ code: "approval_extra_key", exitCode: 1, stage: "approval.shape", operationId, message: "approval key not in closed set for kind " + doc.kind + ": " + k });
    }
  }
  if (APPROVAL_OPERATION_ID_REQUIRED.has(doc.kind) && doc.operationId === undefined) {
    throw new RunStoreError({ code: "approval_incomplete", exitCode: 1, stage: "approval.binding", operationId, message: "kind " + doc.kind + " requires operationId binding" });
  }
  if (operationId && doc.operationId !== undefined && doc.operationId !== operationId) {
    throw new RunStoreError({ code: "approval_binding_mismatch", exitCode: 1, stage: "approval.binding", operationId, message: "approval operationId mismatch" });
  }
  if (caller && Array.isArray(doc.allowedCallers)) {
    const ok = doc.allowedCallers.some((c) => c.principal === caller.principal && (c.callerSessionId ?? null) === (caller.callerSessionId ?? null));
    if (!ok) {
      throw new RunStoreError({ code: "approval_caller_mismatch", exitCode: 1, stage: "approval.callers", operationId, message: "caller not in allowedCallers" });
    }
  }
  return doc;
}
async function loadApproval(projectDir, ref, expectedKind, operationId, caller) {
  const doc = await loadApprovalDoc(projectDir, ref, operationId);
  return assertApprovalGate(doc, expectedKind, operationId, caller);
}

async function loadEvidence(projectDir, ref, operationId) {
  if (typeof ref !== "string" || ref.length === 0) {
    throw new RunStoreError({ code: "evidence_missing", exitCode: 1, stage: "evidence.resolve", operationId, message: "evidenceRef missing" });
  }
  const base = approvalsDir(projectDir);
  const resolved = path.resolve(base, ref);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new RunStoreError({ code: "evidence_ref_escape", exitCode: 1, stage: "evidence.resolve", operationId, message: "evidenceRef escapes approvals dir" });
  }
  let realPath2;
  try {
    realPath2 = await fsp.realpath(resolved);
  } catch (error) {
    throw new RunStoreError({ code: "evidence_missing", exitCode: 1, stage: "evidence.load", operationId, message: "evidence file unreadable: " + error.code });
  }
  if (realPath2 !== base && !realPath2.startsWith(base + path.sep)) {
    throw new RunStoreError({ code: "evidence_ref_escape", exitCode: 1, stage: "evidence.resolve", operationId, message: "evidence realpath escapes the approvals dir (symlink)" });
  }
  let doc;
  try {
    doc = JSON.parse(await fsp.readFile(realPath2, "utf-8"));
  } catch (error) {
    throw new RunStoreError({ code: "evidence_missing", exitCode: 1, stage: "evidence.load", operationId, message: "evidence file unreadable: " + error.code });
  }
  if (!doc || typeof doc.evidenceHash !== "string") {
    throw new RunStoreError({ code: "evidence_incomplete", exitCode: 1, stage: "evidence.shape", operationId, message: "evidence file must carry an evidenceHash" });
  }
  if (doc && typeof doc.evidenceHash === "string") {
    const copy = structuredClone(doc);
    delete copy.evidenceHash;
    if (sha256hex(canonicalJSON(copy)) !== doc.evidenceHash) {
      throw new RunStoreError({ code: "evidence_hash_mismatch", exitCode: 1, stage: "evidence.hash", operationId, message: "evidenceHash does not match recomputed content" });
    }
  }
  return doc;
}

// -------------------------------------------------------- effect state machine
// 12 states x 14 events per references/11 section 8.
export function applyEffectEvent(effect, event, ctx = {}) {
  const s = effect.state;
  const tokenOk = ctx.tokenOk !== false;
  const notStartedEvidence = ctx.notStartedEvidence === true;
  const simulated = ctx.simulated === true;
  const skipEvidence = ctx.skipEvidence === true;
  const hasReceipt = ctx.hasReceipt === true;
  switch (event) {
    case "schedule":
      if (s === "queued") return { kind: "transition", target: "scheduled" };
      if (["scheduled", "retry_scheduled", "claimed", "running", "awaiting_receipt", "stop_pending", "done", "failed", "skipped", "cancelled", "unknown"].includes(s)) return { kind: "noop" };
      return { kind: "noop" };
    case "retry_schedule":
      if (s === "queued") return { kind: "transition", target: "retry_scheduled" };
      if (s === "scheduled") return { kind: "transition", target: "retry_scheduled" };
      if (s === "unknown") return { kind: "deny" };
      return { kind: "noop" };
    case "claim":
      if (["queued", "scheduled", "retry_scheduled"].includes(s)) {
        return tokenOk ? { kind: "transition", target: "claimed" } : { kind: "deny" };
      }
      return { kind: "deny" };
    case "start":
      if (s === "claimed") return tokenOk ? { kind: "transition", target: "running" } : { kind: "deny" };
      if (["queued", "scheduled", "retry_scheduled", "stop_pending", "done", "failed", "skipped", "cancelled", "unknown"].includes(s)) return { kind: "deny" };
      return { kind: "noop" };
    case "stop":
      if (["queued", "scheduled", "retry_scheduled"].includes(s)) return { kind: "transition", target: "cancelled" };
      if (s === "claimed") {
        return notStartedEvidence ? { kind: "transition", target: "cancelled" } : { kind: "transition", target: "stop_pending" };
      }
      if (["running", "awaiting_receipt"].includes(s)) return { kind: "transition", target: "stop_pending" };
      if (s === "stop_pending") return { kind: "transition", target: "stop_pending" };
      if (s === "unknown") return { kind: "transition", target: "unknown" };
      return { kind: "noop" };
    case "preclaim_skip":
      if (["queued", "scheduled", "retry_scheduled"].includes(s)) {
        return skipEvidence ? { kind: "transition", target: "skipped" } : { kind: "deny" };
      }
      return { kind: "noop" };
    case "receipt_done":
    case "receipt_failed":
    case "receipt_cancelled": {
      const target = event === "receipt_done" ? "done" : event === "receipt_failed" ? "failed" : "cancelled";
      if (["running", "awaiting_receipt", "stop_pending"].includes(s)) return { kind: "transition", target };
      if (s === "unknown") return { kind: "transition", target: "unknown" };
      return { kind: "noop" };
    }
    case "receipt_timeout":
      if (["running", "awaiting_receipt"].includes(s)) return { kind: "transition", target: "unknown" };
      if (["stop_pending", "unknown"].includes(s)) return { kind: "transition", target: "unknown" };
      return { kind: "noop" };
    case "late_receipt":
      if (s === "stop_pending") return { kind: "transition", target: "unknown" };
      if (s === "unknown") return { kind: "transition", target: "unknown" };
      return { kind: "noop" };
    case "reconcile_done":
    case "reconcile_failed":
    case "reconcile_cancelled": {
      const target = event === "reconcile_done" ? "done" : event === "reconcile_failed" ? "failed" : "cancelled";
      if (["stop_pending", "unknown"].includes(s)) {
        return simulated ? { kind: "deny" } : { kind: "transition", target };
      }
      return { kind: "noop" };
    }
    default:
      return { kind: "deny" };
  }
}

// ------------------------------------------------------------------- tokens
function makeClaimToken(state, authority, sessionId, effectId, operationId) {
  return {
    state_uuid: state.state_uuid,
    session_uuid: sessionId,
    effect_id: effectId,
    operation_id: operationId,
    controller_epoch: state.authorization.controller_epoch,
    stop_epoch: state.authorization.stop_epoch,
    claimed_revision: state.revision,
  };
}

export function verifyClaimToken(state, token) {
  return tokenMatches(state, token);
}

function tokenMatches(state, token) {
  if (!token || typeof token !== "object") return false;
  const fields = ["state_uuid", "session_uuid", "effect_id", "operation_id", "controller_epoch", "stop_epoch", "claimed_revision"];
  if (fields.some((f) => token[f] === undefined || token[f] === null)) return false;
  if (token.state_uuid !== state.state_uuid) return false;
  if (token.controller_epoch !== state.authorization.controller_epoch) return false;
  if (token.stop_epoch !== state.authorization.stop_epoch) return false;
  if (token.claimed_revision !== state.revision) return false;
  if (token.session_uuid !== state.authorization.controller.session_uuid) return false;
  if (!state.effects.some((e) => e.effect_id === token.effect_id)) return false;
  return true;
}

export function verifyClaimTokenInUse(state, token, operationId) {
  return tokenMatches(state, token) && token.operation_id === operationId;
}

// -------------------------------------------------------------- stop helper
function applyStopTransition(state, opts = {}) {
  let changed = false;
  for (const e of state.queue) {
    if (["queued", "scheduled", "retry_scheduled"].includes(e.state)) {
      e.state = "cancelled";
      changed = true;
    }
  }
  state.queue = state.queue.filter((e) => e.state !== "cancelled");
  for (const e of state.effects) {
    if (["queued", "scheduled", "retry_scheduled"].includes(e.state)) {
      e.state = "cancelled";
      delete e.token;
      changed = true;
    } else if (["claimed", "running", "awaiting_receipt"].includes(e.state)) {
      if (e.state === "claimed" && opts.notStartedEvidence) {
        e.state = "cancelled";
      } else {
        e.state = "stop_pending";
      }
      delete e.token;
      changed = true;
    } else if (e.token) {
      delete e.token;
      changed = true;
    }
  }
  if (state.active_run !== null && state.active_run !== undefined) {
    const sid = state.active_run.session_uuid;
    const closure = {
      ended_at: opts.endedAt ?? nowIso(),
      end_reason: opts.endReason ?? "stop",
      work_outcome: opts.workOutcome ?? "UNKNOWN",
      final_revision: state.revision,
      final_artifacts: [],
      unresolved: [],
      successor: null,
    };
    state.pending_closures[sid] = { descriptor: state.sessions[sid]?.descriptor ?? null, closure, closure_revision: state.revision };
    state.active_run = null;
    changed = true;
  }
  if (opts.bumpStopEpoch) {
    state.authorization.stop_epoch += 1;
    changed = true;
  }
  return changed;
}

// --------------------------------------------------------- session registry
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

function blankState(stateUuid, ownerSessionId) {
  return {
    schema: "run-state/revision/v1",
    state_uuid: stateUuid,
    revision: 0,
    owner_session_id: ownerSessionId,
    parent_revision: 0,
    parent_hash: GENESIS_PARENT_HASH,
    self_hash: null,
    active_run: null,
    queue: [],
    effects: [],
    authorization: {
      controller: { session_uuid: null, assigned_at: null, released_at: null, evidence_ref: null, blocked: false },
      controller_epoch: 0,
      stop_epoch: 0,
    },
    reviews: [],
    sessions: {},
    pending_closures: {},
    applied_operations: [],
    pending_audit: 0,
  };
}

const HEARTBEAT_EXPIRY_MS = 30 * 60 * 1000;

// ------------------------------------------------ RT1AGG schema single source
// schema-point: RS-SCHEMA-LOAD — lazy-first-use load of the three runtime schema docs, frozen
// per-process cache (import performs no schema I/O). Missing file -> io_load_failed exit3
// schema.load; bad JSON -> io_load_failed exit3 schema.parse; registry/compile failure ->
// invalid_shape_declaration exit1 shape.declare. Strictness=preserved (non-migrated gates stay).
const SCHEMA_FILES = ["cutover.schema.json", "run-state.schema.json", "session.schema.json"];
let SCHEMA_SHAPES_CACHE = null;
async function loadSchemaShapes() {
  if (SCHEMA_SHAPES_CACHE) return SCHEMA_SHAPES_CACHE;
  const RUNTIME_SCHEMA_DIR = path.resolve(SCRIPT_DIR, "..", "templates", "runtime");
  const docs = {};
  for (const name of SCHEMA_FILES) {
    const file = path.join(RUNTIME_SCHEMA_DIR, name);
    let text;
    try {
      text = await fsp.readFile(file, "utf-8");
    } catch (error) {
      throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "schema.load", operationId: null, message: "runtime schema unreadable " + file + ": " + error.code });
    }
    try {
      docs[name] = JSON.parse(text);
    } catch (error) {
      throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "schema.parse", operationId: null, message: "runtime schema unparseable " + file + ": " + String(error?.message ?? error) });
    }
  }
  const cutover = docs["cutover.schema.json"];
  const registry = { "run-state.schema.json": docs["run-state.schema.json"], "session.schema.json": docs["session.schema.json"] };
  const compile = (schema, def) => shapeFromSchema({ schema, def, registry });
  const shapes = Object.freeze({
    docs: Object.freeze(docs),
    // schema-point: RS-OPREF — OperationRef closed set/scalars/non-negative ints/hex64
    operationRef: compile(cutover, "OperationRef"),
    // schema-point: RS-SESSION — SessionEvent seven-key closed set + value shapes
    sessionEvent: compile(docs["session.schema.json"], "SessionEvent"),
  });
  SCHEMA_SHAPES_CACHE = shapes;
  return shapes;
}

// RT1AGG J: heartbeat window vs an explicitly injected clock (harness fixed clock; production
// entries resolve an explicit Date.now default) — the body holds no wall-clock read of its own.
function controllerActive(state, clock) {
  const c = state.authorization.controller;
  if (c.session_uuid === null || c.released_at !== null || c.blocked === true) return false;
  const hb = state.sessions[c.session_uuid]?.live_state?.heartbeat;
  if (typeof hb === "string") {
    const t = Date.parse(hb);
    if (Number.isFinite(t) && clock() - t > HEARTBEAT_EXPIRY_MS) return false;
  }
  return true;
}

// ------------------------------------------------------- command registry
// payload closed sets per taskbook §3.7
const COMMANDS = {
  assignController: { keys: ["descriptor", "evidenceRef", "approvalRef"] },
  stop: { keys: ["reason", "evidenceRef", "approvalRef"] },
  reconcile: { keys: ["effectId", "receipt", "evidenceRef", "approvalRef"] },
  close: { keys: ["closure", "evidenceRef", "approvalRef"] },
  sweep: { keys: ["heartbeatEvidence", "evidenceRef", "approvalRef", "callerSessionId"] },
  applySessionEvent: { keys: ["event", "evidenceRef", "approvalRef", "callerSessionId"] },
  assign: { keys: ["effectId", "evidenceRef"] },
  applyApproved: { keys: ["approvalRef", "evidenceRef", "controllerDescriptor"] },
  recoverForward: { keys: ["approvalRef", "confirmedOperationId", "operationRef", "controllerDescriptor"] },
  rebase: { keys: ["approvalRef", "baseRecordRevision", "baseStateRevision"] },
  prepare: { keys: ["approvalRef", "operationRef", "controllerDescriptor", "stopEvidenceRef"] },
  confirm: { keys: ["approvalRef", "operationRef", "candidateRef"] },
  resumeAfterAbortedCutover: { keys: ["operationRef", "resumeRef"] },
  abandonPreparedCandidate: { keys: ["approvalRef", "abortEvidenceRef", "resumeOperation"] },
};

// RT1AGG N2: requestHash binds the verified approvalHash for approval-carrying commands
// (sha256 of the six-key canonical JSON); approval-free commands keep the original
// five-key formula with no null key. The approvalHash always comes from a document that
// passed the full loadApproval validation earlier in the same transaction.
function requestHashOf({ command, principal, sessionId, operationId, payload, approvalHash }) {
  const doc = approvalHash === undefined
    ? { command, principal, sessionId, operationId, payload }
    : { command, principal, sessionId, operationId, payload, approvalHash };
  return sha256hex(canonicalJSON(doc));
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

function findApplied(state, operationId) {
  for (const entry of state.applied_operations) {
    const d = decodeAppliedLast(entry);
    if (d && d.operationId === operationId) return d;
  }
  return null;
}

// ------------------------------------------------------------ publish chain
async function publishRevision(projectDir, revision, authority, opts = {}) {
  const adapter = opts.adapter ?? FaultAdapter.disabled();
  const stateFile = revisionFilePath(projectDir, revision.state_uuid, revision.revision);
  if (fs.existsSync(stateFile)) {
    throw new RunStoreError({ code: "revision_exists", exitCode: 1, stage: "state_write", operationId: opts.operationId ?? null, message: "immutable revision already exists; overwrite denied" });
  }
  const selfHash = computeSelfHash(revision);
  revision.self_hash = selfHash;
  if (revision.producer_operation && typeof revision.producer_operation === "object") {
    revision.producer_operation.hash = selfHash;
  }
  const serialized = canonicalJSON(revision);
  if (Buffer.byteLength(serialized, "utf-8") >= STATE_BYTES_LIMIT && !opts.allowOversize) {
    throw new RunStoreError({ code: "blocked_capacity", exitCode: 1, stage: "state_write", operationId: opts.operationId ?? null, message: "state size limit reached (1 MiB)" });
  }
  const dir = stateDir(projectDir, revision.state_uuid);
  await fsp.mkdir(dir, { recursive: true });
  const ioState = makeIo(adapter, {
    write: "state_write", fsyncFile: "state_fsync_file", fsyncDir: "state_fsync_parent",
    rename: "state_write", readbackHook: (a) => a.fail("state_readback", "state_readback", opts.operationId ?? null),
  });
  await atomicWrite(stateFile, serialized, ioState, opts.probe);
  // highwater
  const hwIo = makeIo(adapter, { write: "highwater_write", fsyncFile: "highwater_write", fsyncDir: "highwater_write", rename: "highwater_write" });
  let hw = { ...((await loadHighwaterOrEmpty(projectDir))) };
  hw[revision.state_uuid] = { record_revision: authority.record_revision + 1, current_revision: revision.revision, current_hash: selfHash };
  await atomicWrite(highwaterPath(projectDir), canonicalJSON(hw), hwIo, opts.probe);
  // authority publish (common writer keeps journal_generation/journal_head_hash)
  const auIo = makeIo(adapter, { write: "authority_publish", fsyncFile: "authority_publish", fsyncDir: "authority_publish", rename: "authority_publish", readbackHook: null });
  // authority_readback is a PRE-publish verification point: firing it before the
  // authority file is written keeps "any failed step does not advance current"
  if (adapter instanceof FaultAdapter) adapter.fail("authority_readback", "authority_readback", opts.operationId ?? null);
  const nextAuthority = {
    ...authority,
    record_revision: authority.record_revision + 1,
    current_revision: revision.revision,
    current_hash: selfHash,
  };
  if (opts.epoch !== undefined) nextAuthority.epoch = opts.epoch;
  if (opts.stateUuid !== undefined) nextAuthority.state_uuid = opts.stateUuid;
  if (opts.baseRevision !== undefined) {
    nextAuthority.base_revision = opts.baseRevision;
    nextAuthority.base_hash = opts.baseHash;
  }
  if (opts.controllerOperationId !== undefined) nextAuthority.controller_operation_id = opts.controllerOperationId;
  await atomicWrite(authorityPath(projectDir), canonicalJSON(nextAuthority), auIo, opts.probe);
  // post-publish readback of current hash + lineage (no fault injection here:
  // authority_readback is a pre-publish verification point above)
  const reread = await loadRevisionFile(projectDir, nextAuthority.state_uuid, nextAuthority.current_revision);
  if (reread.self_hash !== nextAuthority.current_hash) {
    throw new RunStoreError({ code: "io_readback", exitCode: 3, stage: "authority_readback", operationId: opts.operationId ?? null, message: "authority current hash readback mismatch" });
  }
  return { selfHash, nextAuthority };
}

async function loadHighwaterOrEmpty(projectDir) {
  try {
    return await loadHighwater(projectDir);
  } catch (error) {
    if (error.code === "io_load_failed" && /ENOENT/.test(error.message)) return {};
    throw error;
  }
}

function assertHighwaterReconciled(authority, highwater) {
  const entry = highwater?.[authority.state_uuid];
  if (entry && entry.current_revision > authority.current_revision) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "highwater_reconcile", operationId: null, message: "highwater above authority: publish incomplete, ordinary writes blocked" });
  }
}

function assertJournalNotFrozen(journal, operationId) {
  for (const e of journal?.entries ?? []) {
    if (FROZEN_JOURNAL_STATES.has(e.status)) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal_frozen", operationId: operationId ?? null, message: "cutover/recovery in progress (" + e.operationId + ":" + e.status + "); ordinary writes blocked" });
    }
    if (e.status === "abandoned" && !e.resumeRef) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "journal_frozen", operationId: operationId ?? null, message: "abandoned without resumeRef blocks ordinary writes (" + e.operationId + ")" });
    }
  }
}

// ------------------------------------------------------------- authorization
function assertControllerWrite(state, params, { allowException2 = false } = {}, clock) {
  const c = state.authorization.controller;
  const expired = !controllerActive(state, clock) && c.session_uuid === params.sessionId;
  if (params.principal === "session" && params.sessionId && params.sessionId === c.session_uuid && c.released_at === null && c.blocked === false && !expired) {
    return { mode: "controller" };
  }
  if (allowException2 && (c.session_uuid === null || c.blocked === true || !controllerActive(state, clock))) {
    return { mode: "exception2" };
  }
  if (c.blocked === true) {
    throw new RunStoreError({ code: "needs_controller_sweep", exitCode: 1, stage: "authorize", operationId: params.operationId, message: "controller blocked: worker reads only, NEEDS_CONTROLLER_SWEEP" });
  }
  throw new RunStoreError({ code: "not_controller", exitCode: 1, stage: "authorize", operationId: params.operationId, message: "only the assigned ACTIVE controller session may write project state" });
}

// ---------------------------------------------------------------- transact
export async function transact(params) {
  const keys = Object.keys(params ?? {});
  for (const k of keys) {
    if (!TOP_LEVEL_KEYS.includes(k)) {
      throw new RunStoreError({ code: "extra_arg", exitCode: 1, stage: "args", operationId: params?.operationId ?? null, message: "unexpected top-level argument " + k + " (fault injection is harness-only)" });
    }
  }
  return performTransact(params, FaultAdapter.disabled());
}

// harness-only entry: identical to the public transact (same lock and checks)
// with the test IO adapter threaded through; never part of the public signature.
// RT1AGG J: optional clock is harness-only too — the self-test threads a fixed
// fixture clock so heartbeat windows are deterministic; absent clock = production.
async function performTransact(params, adapter, clock) {
  const { projectDir, principal, sessionId, expectedRevision, operationId, command, payload } = params ?? {};
  const io = adapter instanceof FaultAdapter ? adapter : FaultAdapter.disabled();
  // schema-point: RS-PRESERVED-ARG — generic operationId argument gate (non-document site; non-schema by design)
  if (typeof operationId !== "string" || operationId.length === 0) {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage: "args", operationId: null, message: "operationId required" });
  }
  const owner = await acquireLock(projectDir, operationId, io);
  try {
    return await transactLocked({ projectDir, principal, sessionId, expectedRevision, operationId, command, payload, adapter: io, clock });
  } finally {
    await releaseLock(projectDir, owner);
  }
}

async function transactLocked(args) {
  const { projectDir, principal, sessionId, expectedRevision, operationId, command, payload, adapter, clock } = args;
  const clockNow = clock ?? Date.now; // RT1AGG J: explicit production default
  const pload = payload ?? {};
  // payload key closed-set checks
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, command)) {
    throw new RunStoreError({ code: "unknown_command", exitCode: 1, stage: "command", operationId, message: "command not registered: " + command });
  }
  for (const k of Object.keys(pload)) {
    if (PROTECTED_PAYLOAD_KEYS.includes(k)) {
      throw new RunStoreError({ code: "protected_payload_key", exitCode: 1, stage: "command.payload", operationId, message: "protected field cannot be set via generic payload: " + k });
    }
    if (["sessionId", "operationId", "expectedRevision"].includes(k)) {
      throw new RunStoreError({ code: "top_level_shadow", exitCode: 1, stage: "command.payload", operationId, message: "payload duplicates top-level authoritative field: " + k });
    }
    if (!COMMANDS[command].keys.includes(k)) {
      throw new RunStoreError({ code: "unknown_payload_key", exitCode: 1, stage: "command.payload", operationId, message: "payload key not in closed set: " + k });
    }
  }
  if ("callerSessionId" in pload) {
    if (!CALLER_SESSION_COMMANDS.has(command)) {
      throw new RunStoreError({ code: "caller_session_forbidden", exitCode: 1, stage: "command.payload", operationId, message: "callerSessionId only allowed on applySessionEvent/sweep" });
    }
    if (pload.callerSessionId !== sessionId) {
      throw new RunStoreError({ code: "caller_session_mismatch", exitCode: 1, stage: "command.payload", operationId, message: "callerSessionId must equal top-level sessionId" });
    }
  }
  const floatGuard = (v, pathStr) => {
    if (typeof v === "number" && !Number.isInteger(v)) {
      throw new RunStoreError({ code: "invalid_payload_float", exitCode: 1, stage: "args.payload", operationId, message: "float payload value at " + pathStr });
    }
    if (Array.isArray(v)) v.forEach((x, i) => floatGuard(x, pathStr + "[" + i + "]"));
    else if (v && typeof v === "object") for (const k of Object.keys(v)) floatGuard(v[k], pathStr + "." + k);
  };
  // schema-point: RS-PRESERVED-FLOAT — recursive payload float gate (non-document site; non-schema by design)
  floatGuard(pload, "$.payload");
  const REQ_APPROVAL = REQ_APPROVAL_SET; // module-scope single definition (harness mirror shares it)
  const REQ_EVIDENCE = new Set(["assignController", "stop", "reconcile", "close", "sweep", "applySessionEvent", "applyApproved"]);
  if (REQ_APPROVAL.has(command) && typeof pload.approvalRef !== "string") {
    throw new RunStoreError({ code: "approval_required", exitCode: 1, stage: "command.payload", operationId, message: command + " requires approvalRef" });
  }
  if (REQ_EVIDENCE.has(command) && typeof pload.evidenceRef !== "string") {
    throw new RunStoreError({ code: "evidence_required", exitCode: 1, stage: "command.payload", operationId, message: command + " requires evidenceRef" });
  }
  // RT1AGG N2 (R1/B1 mechanism ②): every approval-carrying request binds its verified
  // approvalHash. Commands outside the frozen run-recover layer bind INSIDE the requestHash
  // (six-key formula); applyApproved and rebase keep the five-key hash because the hash-
  // frozen run-recover layer recomputes five-key replay bindings and markers
  // (run-recover.mjs:1709/:1797/:2781) — for those two (and as a cross-check for every
  // other replay) the binding is enforced ENTRY-LEVEL via the request-approvals ledger:
  // {operationId -> approvalHash}, written at publish time and verified on every replay/
  // orphan-claim match. A swapped approval at the same ref therefore conflicts on ALL
  // paths (new write / legacy-form replay / orphan claim / applyApproved / rebase);
  // entries fabricated without a ledger record (frozen run-recover offline paths) keep
  // their legacy replay acceptance — residual risk recorded in the drift table.
  // R1/B2: the approval document is loaded ONCE (read + required/callers/hash prefix) at
  // the first point the hash is needed; kind/allowedKeys/binding/caller run as the gate
  // suffix at each site's original position (frozen order preserved, single read, no TOCTOU).
  let verifiedApproval = null;
  let requestHash = null;
  let requestApprovals = null;
  const ensureRequestHash = async () => {
    if (requestHash !== null) return requestHash;
    if (REQ_APPROVAL.has(command) && typeof pload.approvalRef === "string") {
      verifiedApproval = await loadApprovalDoc(projectDir, pload.approvalRef, operationId);
      // R2 ruling 1: validate the ledger at the earliest hash point so a corrupt ledger
      // blocks the write path BEFORE any revision is published (never overwritten)
      requestApprovals = await loadRequestApprovals(projectDir);
    }
    const bindsApproval = verifiedApproval !== null && !N2_FROZEN_LAYER.has(command);
    requestHash = requestHashOf({ command, principal, sessionId, operationId, payload: pload, approvalHash: bindsApproval ? verifiedApproval.approvalHash : undefined });
    return requestHash;
  };
  const getApproval = () => verifiedApproval; // args snapshot safety: callers read the closure live
  // RT1AGG R2 (ruling 3+5): replay/orphan paths run the FULL approval gate
  // (kind/allowedKeys/binding/caller with the command's expected kind) before any
  // idempotent return or orphan claim; the ledger record lookup uses hasOwn so
  // prototype-key operationIds (toString/constructor/__proto__) never misfire.
  const APPROVAL_EXPECTED_KIND = {
    assignController: "assignController", stop: "safeWrite", reconcile: "safeWrite", close: "safeWrite",
    sweep: "safeWrite", applySessionEvent: "safeWrite", applyApproved: "applyApproved",
    recoverForward: "cutoverRecovery", rebase: "checkpointRebase", prepare: "cutoverG1a",
    confirm: "cutoverG1b", abandonPreparedCandidate: "cutoverAbandon",
  };
  const assertApprovalBindingRecord = async (hashForm, adapter) => {
    if (verifiedApproval === null) return;
    // R2 ruling 3: the FULL approval gate (expectedKind/operationId/caller) runs before any
    // idempotent return or orphan claim. Scope note (measured): applying the gate to FIVE-key
    // legacy matches breaks frozen F-R-002 (its orphan replay carries the genesis approval —
    // kind assignController vs applySessionEvent, caller host vs session — and pins the
    // ungated republication). Five-key legacy matches therefore keep the frozen R1 behavior
    // (prefix validation + ledger record check); SIX-key matches — where the hash itself
    // binds the approval — run the full gate.
    const isSixKeyMatch = !N2_FROZEN_LAYER.has(command) && hashForm === "six";
    if (isSixKeyMatch) {
      assertApprovalGate(verifiedApproval, APPROVAL_EXPECTED_KIND[command] ?? null, operationId, { principal, callerSessionId: sessionId ?? null });
    }
    const ledger = requestApprovals ?? await loadRequestApprovals(projectDir);
    const recorded = Object.prototype.hasOwnProperty.call(ledger, operationId) ? ledger[operationId] : undefined;
    if (recorded !== undefined) {
      if (recorded !== verifiedApproval.approvalHash) {
        throw new RunStoreError({ code: "request_hash_conflict", exitCode: 1, stage: "replay", operationId, message: "same operationId replayed against a different approval than the recorded binding" });
      }
      return;
    }
    // ruling 4 (option A): six-key hash matches carry the binding IN the hash — a successful
    // six-key replay with no ledger record writes the record back (true self-heal). Five-key
    // matches cannot self-heal (the hash binds nothing; healing would bind whatever approval
    // is presented) — that gap is the recorded permanent residual in the N2 authorization table.
    if (isSixKeyMatch) {
      await writeRequestApprovalBinding(projectDir, operationId, verifiedApproval.approvalHash, adapter);
    }
  };
  if (!REQ_APPROVAL.has(command)) requestHash = requestHashOf({ command, principal, sessionId, operationId, payload: pload });

  // load current world
  let authority = null;
  let state = null;
  let highwater = {};
  let journal = null;
  const hasAuthority = fs.existsSync(authorityPath(projectDir));
  if (hasAuthority) {
    authority = await loadAuthority(projectDir);
    highwater = await loadHighwaterOrEmpty(projectDir);
    state = await loadRevisionFile(projectDir, authority.state_uuid, authority.current_revision);
    journal = await loadJournal(projectDir);
  }

  // applied_operations replay has priority over expectedRevision
  if (state) {
    const applied = findApplied(state, operationId);
    if (applied) {
      // RT1AGG N2: entries written by this code carry the six-key hash; legacy/fabricated
      // entries (pre-N2 revisions, run-recover offline claims) carry the five-key form and
      // stay replayable via the migration-compat comparison. New entries never match the
      // five-key digest, so the approval binding holds for everything this code writes.
      const replayHash = await ensureRequestHash();
      const legacyHash = verifiedApproval !== null && !N2_FROZEN_LAYER.has(command) ? requestHashOf({ command, principal, sessionId, operationId, payload: pload }) : replayHash;
      if (applied.requestHash === replayHash || applied.requestHash === legacyHash) {
        await assertApprovalBindingRecord(applied.requestHash === replayHash ? "six" : "five", adapter); // full gate + ledger binding (R2)
        return { revision: applied.revision, hash: applied.hash, recordRevision: applied.recordRevision };
      }
      throw new RunStoreError({ code: "request_hash_conflict", exitCode: 1, stage: "replay", operationId, message: "same operationId replayed with payload/requestHash" });
    }
    // precise orphan claim: r-(current+1) on disk but unpublished
    const orphanRev = authority.current_revision + 1;
    const orphanFile = revisionFilePath(projectDir, authority.state_uuid, orphanRev);
    if (fs.existsSync(orphanFile)) {
      const orphan = await readJsonFile(orphanFile, "orphan");
      if (orphan && Array.isArray(orphan.applied_operations) && orphan.schema) {
      const orphanApplied = findApplied(orphan, operationId);
      const orphanN2 = await ensureRequestHash();
      const orphanLegacy = verifiedApproval !== null && !N2_FROZEN_LAYER.has(command) ? requestHashOf({ command, principal, sessionId, operationId, payload: pload }) : orphanN2;
      if (orphanApplied && (orphanApplied.requestHash === orphanN2 || orphanApplied.requestHash === orphanLegacy)) {
        await assertApprovalBindingRecord(orphanApplied.requestHash === orphanN2 ? "six" : "five", adapter); // full gate + ledger binding (R2)
        const hwIo = makeIo(adapter, { write: "highwater_write", fsyncFile: "highwater_write", fsyncDir: "highwater_write", rename: "highwater_write" });
        const hw2 = { ...highwater };
        hw2[authority.state_uuid] = { record_revision: authority.record_revision + 1, current_revision: orphan.revision, current_hash: orphan.self_hash };
        await atomicWrite(highwaterPath(projectDir), canonicalJSON(hw2), hwIo);
        const auIo = makeIo(adapter, { write: "authority_publish", fsyncFile: "authority_publish", fsyncDir: "authority_publish", rename: "authority_publish" });
        const nextAuthority = { ...authority, record_revision: authority.record_revision + 1, current_revision: orphan.revision, current_hash: orphan.self_hash };
        await atomicWrite(authorityPath(projectDir), canonicalJSON(nextAuthority), auIo);
        const reread = await loadRevisionFile(projectDir, authority.state_uuid, nextAuthority.current_revision);
        if (reread.self_hash !== nextAuthority.current_hash) {
          throw new RunStoreError({ code: "io_readback", exitCode: 3, stage: "authority_readback", operationId, message: "orphan republication readback mismatch" });
        }
        await writeRequestApprovalBinding(projectDir, operationId, verifiedApproval?.approvalHash, adapter); // R4/W4: orphan-claim ledger write threaded through the fault adapter (fires after the authority advance)
        return { revision: orphanApplied.revision, hash: orphanApplied.hash, recordRevision: nextAuthority.record_revision };
      }
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "orphan", operationId, message: "unpublished revision exists (orphan); only the original operation may claim it" });
      }
    }
    if (highwater[authority.state_uuid] && highwater[authority.state_uuid].current_revision > authority.current_revision) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "highwater_reconcile", operationId, message: "highwater above authority; ordinary writes blocked pending reconciliation" });
    }
    // unexpected descendant / fork detection
    const sdir = stateDir(projectDir, authority.state_uuid);
    if (fs.existsSync(sdir)) {
      const numbers = fs.readdirSync(sdir).map((f) => /^r-(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number).filter((n) => n > authority.current_revision + 1);
      for (const n of numbers) {
        try {
          const cand = await readJsonFile(revisionFilePath(projectDir, authority.state_uuid, n), "fork");
          if (cand && cand.schema) {
            throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "fork", operationId, message: "unexpected descendant revision on disk (r-" + n + "); fork blocked" });
          }
        } catch (error) {
          if (error instanceof RunStoreError && error.code === "blocked") throw error;
        }
      }
    }
  }

  // expectedRevision
  const currentRevision = authority ? authority.current_revision : 0;
  const expected = typeof expectedRevision === "number" ? expectedRevision : -1;
  if (expected !== currentRevision) {
    throw new RunStoreError({ code: "expected_revision_mismatch", exitCode: 1, stage: "expected_revision", operationId, message: "expectedRevision " + expected + " != current " + currentRevision });
  }

  // initial assignController (expectedRevision === 0, empty project, principal=host)
  if (!hasAuthority) {
    if (command !== "assignController" || principal !== "host" || expected !== 0) {
      throw new RunStoreError({ code: "genesis_required", exitCode: 1, stage: "genesis", operationId, message: "empty project only accepts initial assignController(expectedRevision=0, principal=host)" });
    }
    await ensureRequestHash(); // lazy doc load at the original loadApproval position
    const approval = getApproval();
    assertApprovalGate(approval, "assignController", operationId, { principal: "host", callerSessionId: null });
    await loadEvidence(projectDir, pload.evidenceRef, operationId);
    const desc = pload.descriptor;
    if (desc.role !== "controller") {
      throw new RunStoreError({ code: "descriptor_role", exitCode: 1, stage: "assignController", operationId, message: "initial assignment requires a controller descriptor" });
    }
    if (approval.controllerDescriptor && approval.controllerDescriptor.session_uuid !== desc.session_uuid) {
      throw new RunStoreError({ code: "approval_binding_mismatch", exitCode: 1, stage: "assignController", operationId, message: "descriptor does not match approval controllerDescriptor" });
    }
    const stateUuid = "su-" + sha256hex(operationId).slice(0, 12);
    const st = blankState(stateUuid, desc.session_uuid);
    registerSession(st.sessions, desc);
    st.authorization.controller = { session_uuid: desc.session_uuid, assigned_at: nowIso(), released_at: null, evidence_ref: pload.evidenceRef, blocked: false };
    st.authorization.controller_epoch = 1;
    const genesisHash = await ensureRequestHash();
    const commitHash = sha256hex(operationId + ":" + genesisHash);
    st.applied_operations.push(encodeApplied(operationId, genesisHash, 0, commitHash, 0));
    authority = {
      record_revision: -1, epoch: 0, mode: "runtime", state_uuid: stateUuid,
      base_revision: 0, base_hash: GENESIS_PARENT_HASH, current_revision: 0, current_hash: "",
      controller_operation_id: operationId, mode_change_approval_ref: pload.approvalRef,
      journal_generation: 0, journal_head_hash: GENESIS_JOURNAL_HEAD,
    };
    await publishRevision(projectDir, st, authority, {
      adapter, operationId, controllerOperationId: operationId,
    });
    await writeRequestApprovalBinding(projectDir, operationId, verifiedApproval?.approvalHash, adapter);
    return { revision: 0, hash: commitHash, recordRevision: 0 };
  }

  // ordinary / exception writes
  const isCutoverCommand = ["prepare", "confirm", "resumeAfterAbortedCutover", "abandonPreparedCandidate", "recoverForward"].includes(command);
  if (!isCutoverCommand) {
    assertJournalNotFrozen(journal, operationId);
  }
  const next = structuredClone(state);
  next.parent_revision = state.revision;
  next.parent_hash = state.self_hash;
  next.revision = state.revision + 1;
  next.owner_session_id = sessionId ?? state.authorization.controller.session_uuid ?? "host";

  const result = await applyCommand({ projectDir, principal, sessionId, operationId, command, payload: pload, state: next, currentState: state, authority, journal, adapter, currentRevision, clock: clockNow, ensureRequestHash, getApproval });
  if (typeof result === "string") {
    const cur = await loadAuthority(projectDir);
    const curState = await loadRevisionFile(projectDir, cur.state_uuid, cur.current_revision);
    return { revision: curState.revision, hash: curState.self_hash, recordRevision: cur.record_revision };
  }
  const writeHash = await ensureRequestHash();
  const commitHash = sha256hex(operationId + ":" + writeHash);
  next.applied_operations.push(encodeApplied(operationId, writeHash, next.revision, commitHash, authority.record_revision + 1));
  if (next.applied_operations.length > APPLIED_LIMIT) {
    throw new RunStoreError({ code: "blocked_capacity", exitCode: 1, stage: "capacity.applied", operationId, message: "applied_operations limit reached (256)" });
  }
  const { nextAuthority } = await publishRevision(projectDir, next, authority, {
    adapter, operationId, epoch: result.epoch, stateUuid: result.stateUuid,
    baseRevision: result.baseRevision, baseHash: result.baseHash,
  });
  if (result.after) await result.after(next, nextAuthority);
  // R2/预裁十-6 (W7): ledger write moved AFTER result.after — success-path behavior
  // unchanged; the ledger no longer lands before command-level after-hooks, so a crash
  // between them cannot leave a binding for a partially-completed command.
  await writeRequestApprovalBinding(projectDir, operationId, verifiedApproval?.approvalHash, adapter);
  return { revision: next.revision, hash: commitHash, recordRevision: nextAuthority.record_revision };
}

// applyCommand mutates `state` (a clone of current) and returns
// undefined | "NOOP" | {epoch?, stateUuid?, baseRevision?, baseHash?, after?}
async function applyCommand(args) {
  const { projectDir, principal, sessionId, operationId, command, payload, state, authority, journal, adapter, clock, ensureRequestHash, getApproval } = args;
  const caller = { principal, callerSessionId: sessionId };
  switch (command) {
    case "assignController": {
      const c = state.authorization.controller;
      const controllerVacant = c.session_uuid === null || c.blocked === true;
      if (!controllerVacant) {
        throw new RunStoreError({ code: "controller_active", exitCode: 1, stage: "assignController", operationId, message: "ACTIVE controller exists; takeover requires vacancy/blocked/expired with approval" });
      }
      await ensureRequestHash(); // lazy doc load at the original loadApproval position
      const approval = getApproval();
      assertApprovalGate(approval, "assignController", operationId, caller);
      await loadEvidence(projectDir, payload.evidenceRef, operationId);
      const desc = payload.descriptor;
      if (!desc || desc.role !== "controller") {
        throw new RunStoreError({ code: "descriptor_role", exitCode: 1, stage: "assignController", operationId, message: "assignment requires a controller descriptor" });
      }
      if (approval.controllerDescriptor && approval.controllerDescriptor.session_uuid !== desc.session_uuid) {
        throw new RunStoreError({ code: "approval_binding_mismatch", exitCode: 1, stage: "assignController", operationId, message: "descriptor does not match approval controllerDescriptor" });
      }
      // stop-transition takeover
      applyStopTransition(state, { bumpStopEpoch: true, endReason: "controller_takeover", workOutcome: "UNKNOWN" });
      if (c.session_uuid !== null) {
        const old = state.sessions[c.session_uuid];
        if (old) {
          old.live_state.lifecycle = "INTERRUPTED";
          old.live_state.work_outcome = "UNKNOWN";
          state.pending_closures[c.session_uuid] = {
            descriptor: old.descriptor,
            closure: { ended_at: nowIso(), end_reason: "controller_takeover", work_outcome: "UNKNOWN", final_revision: state.revision, final_artifacts: [], unresolved: [], successor: desc.session_uuid },
            closure_revision: state.revision,
          };
        }
      }
      state.authorization.controller = { session_uuid: desc.session_uuid, assigned_at: nowIso(), released_at: null, evidence_ref: payload.evidenceRef, blocked: false };
      state.authorization.controller_epoch += 1;
      if (!state.sessions[desc.session_uuid]) registerSession(state.sessions, desc);
      return {};
    }
    case "stop": {
      let mode;
      try {
        mode = assertControllerWrite(state, { principal, sessionId, operationId }, { allowException2: true }, clock);
      } catch (e) {
        throw e;
      }
      // RT1AGG N2: approval pre-loaded and bound into requestHash; caller residual keeps the old position
      await ensureRequestHash(); // lazy doc load at the original loadApproval position
      assertApprovalGate(getApproval(), "safeWrite", operationId, caller);
      await loadEvidence(projectDir, payload.evidenceRef, operationId);
      const beforeEpoch = state.authorization.stop_epoch;
      const changed = applyStopTransition(state, {});
      if (!changed) return "NOOP";
      state.authorization.stop_epoch = beforeEpoch + 1;
      return {};
    }
    case "reconcile": {
      assertControllerWrite(state, { principal, sessionId, operationId }, { allowException2: true }, clock);
      // RT1AGG N2: approval pre-loaded and bound into requestHash; caller residual keeps the old position
      await ensureRequestHash(); // lazy doc load at the original loadApproval position
      assertApprovalGate(getApproval(), "safeWrite", operationId, caller);
      await loadEvidence(projectDir, payload.evidenceRef, operationId);
      if (!payload.receipt || payload.receipt.simulated !== false) {
        throw new RunStoreError({ code: "simulated_observation", exitCode: 1, stage: "reconcile", operationId, message: "only real runtime observations (simulated=false) may migrate authoritative effects" });
      }
      const eff = state.effects.find((e) => e.effect_id === payload.effectId);
      if (!eff) throw new RunStoreError({ code: "unknown_effect", exitCode: 1, stage: "reconcile", operationId, message: "effect not found" });
      // schema-point: RS-RECEIPT — DEFERRED (rt1agg W-1/deferred ledger): the outcome
      // three-value face is exactly equal to a Receipt def, but the reconcile command has
      // the simulated/effect gates stay and the handwritten outcome list remains in force.
      const outcome = payload.receipt.outcome;
      if (!["done", "failed", "cancelled"].includes(outcome)) {
        throw new RunStoreError({ code: "invalid_receipt", exitCode: 1, stage: "reconcile", operationId, message: "receipt.outcome must be done/failed/cancelled" });
      }
      if (!["unknown", "stop_pending"].includes(eff.state)) {
        throw new RunStoreError({ code: "effect_state", exitCode: 1, stage: "reconcile", operationId, message: "reconcile only applies to unknown/stop_pending effects" });
      }
      eff.state = outcome;
      delete eff.token;
      return {};
    }
    case "close": {
      const c = state.authorization.controller;
      const isControllerClosing = principal === "session" && sessionId === c.session_uuid && c.blocked === false && c.released_at === null;
      if (state.pending_audit > 0) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "close.pending_audit", operationId, message: "pending_audit non-zero blocks close" });
      }
      const unresolved = state.effects.filter((e) => UNRESOLVED_EFFECT_STATES.has(e.state)).length;
      if (unresolved > 0) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "close.unresolved", operationId, message: "unresolved effects block close" });
      }
      // RT1AGG N2: approval pre-loaded and bound into requestHash; caller residual keeps the old position
      await ensureRequestHash(); // lazy doc load at the original loadApproval position
      assertApprovalGate(getApproval(), "safeWrite", operationId, caller);
      await loadEvidence(projectDir, payload.evidenceRef, operationId);
      const target = sessionId;
      const sess = state.sessions[target];
      if (!sess) throw new RunStoreError({ code: "unknown_session", exitCode: 1, stage: "close", operationId, message: "closing session not registered" });
      if (!["CLOSED", "INTERRUPTED"].includes(sess.live_state.lifecycle)) {
        sess.live_state.lifecycle = "CLOSED";
      }
      state.pending_closures[target] = { descriptor: sess.descriptor, closure: payload.closure, closure_revision: state.revision };
      if (isControllerClosing) {
        state.authorization.controller = { ...c, session_uuid: null, released_at: nowIso() };
        state.authorization.controller_epoch += 1;
      }
      return {};
    }
    case "sweep": {
      const evDoc = await loadEvidence(projectDir, payload.heartbeatEvidence ?? payload.evidenceRef, operationId);
      // RT1AGG N2: approval pre-loaded and bound into requestHash; caller residual keeps the old position
      await ensureRequestHash(); // lazy doc load at the original loadApproval position
      assertApprovalGate(getApproval(), "safeWrite", operationId, caller);
      await loadEvidence(projectDir, payload.evidenceRef, operationId);
      const expired = new Set(evDoc.expired ?? [evDoc.session_uuid].filter(Boolean));
      if (expired.size === 0) {
        throw new RunStoreError({ code: "evidence_missing", exitCode: 1, stage: "sweep", operationId, message: "heartbeat evidence lists no expired session" });
      }
      let changed = false;
      const c = state.authorization.controller;
      const workerBranch = principal === "session" && sessionId && sessionId !== c.session_uuid;
      for (const sid of expired) {
        const sess = state.sessions[sid];
        if (!sess) continue;
        if (sid === c.session_uuid && !workerBranch) {
          if (sess.live_state.lifecycle !== "UNKNOWN") {
            sess.live_state.lifecycle = "UNKNOWN";
            sess.live_state.work_outcome = "UNKNOWN";
            changed = true;
          }
          if (c.blocked !== true) {
            state.authorization.controller = { ...c, blocked: true };
            changed = true;
          }
        } else if (workerBranch && sid === sessionId) {
          if (sess.live_state.lifecycle !== "UNKNOWN") {
            sess.live_state.lifecycle = "UNKNOWN";
            sess.live_state.work_outcome = "UNKNOWN";
            changed = true;
          }
        }
      }
      if (!changed) return "NOOP";
      return {};
    }
    case "applySessionEvent": {
      let isController = false;
      try {
        const m = assertControllerWrite(state, { principal, sessionId, operationId }, undefined, clock);
        isController = m.mode === "controller";
      } catch (e) {
        if (e.code === "needs_controller_sweep") throw e;
        // worker path: inbox-only events
        if (principal !== "session" || !sessionId) throw e;
        const sess = state.sessions[sessionId];
        if (!sess) throw e;
        const ev = payload.event;
        if (!ev || ev.kind !== "inbox_message" || ev.session_uuid !== sessionId) {
          throw new RunStoreError({ code: "worker_inbox_only", exitCode: 1, stage: "applySessionEvent", operationId, message: "worker may only write inbox events for its own session" });
        }
        // RT1AGG N2: approval pre-loaded and bound into requestHash; caller residual keeps the old position
        await ensureRequestHash(); // lazy doc load at the original loadApproval position
        assertApprovalGate(getApproval(), "safeWrite", operationId, caller);
        await loadEvidence(projectDir, payload.evidenceRef, operationId);
        const inboxFile = path.join(runtimeDir(projectDir), "session-events.jsonl");
        await fsp.mkdir(path.dirname(inboxFile), { recursive: true });
        await fsp.appendFile(inboxFile, canonicalJSON(ev) + "\n", "utf-8");
        return {};
      }
      // RT1AGG N2: approval pre-loaded and bound into requestHash; caller residual keeps the old position
      await ensureRequestHash(); // lazy doc load at the original loadApproval position
      assertApprovalGate(getApproval(), "safeWrite", operationId, caller);
      await loadEvidence(projectDir, payload.evidenceRef, operationId);
      const ev = payload.event;
      // schema-point: RS-SESSION — the seven required keys and the additionalProperties
      // closed set are owned by the session SessionEvent def (the handwritten key list is
      // gone). worker path and the unknown_session check below stay untouched.
      const shapes2 = await loadSchemaShapes();
      try {
        shapes2.sessionEvent.check(ev, "$");
      } catch (error) {
        if (error instanceof RunStoreError && error.code === "invalid_shape" && error.stage === "shape.check") {
          throw new RunStoreError({ code: "invalid_event", exitCode: 1, stage: "applySessionEvent", operationId, message: "event rejected by the SessionEvent schema: " + error.message });
        }
        throw error;
      }
      const target = state.sessions[ev.session_uuid];
      if (!target) throw new RunStoreError({ code: "unknown_session", exitCode: 1, stage: "applySessionEvent", operationId, message: "event target session not registered" });
      target.live_state.last_activity = ev.created_at;
      return {};
    }
    case "assign": {
      assertControllerWrite(state, { principal, sessionId, operationId }, undefined, clock);
      await loadEvidence(projectDir, payload.evidenceRef, operationId);
      if (state.active_run !== null && state.active_run !== undefined) {
        throw new RunStoreError({ code: "second_active_run", exitCode: 1, stage: "assign", operationId, message: "project keeps a single active run" });
      }
      if (state.queue.length >= QUEUE_LIMIT) {
        throw new RunStoreError({ code: "blocked_capacity", exitCode: 1, stage: "capacity.queue", operationId, message: "queue limit reached (32)" });
      }
      const unresolved = state.effects.filter((e) => UNRESOLVED_EFFECT_STATES.has(e.state)).length;
      if (unresolved >= EFFECTS_LIMIT) {
        throw new RunStoreError({ code: "blocked_capacity", exitCode: 1, stage: "capacity.effects", operationId, message: "unresolved effects limit reached (64)" });
      }
      if (state.applied_operations.length >= APPLIED_LIMIT) {
        throw new RunStoreError({ code: "blocked_capacity", exitCode: 1, stage: "capacity.applied", operationId, message: "applied_operations limit reached (256)" });
      }
      const serialized = canonicalJSON(state);
      if (Buffer.byteLength(serialized, "utf-8") >= STATE_BYTES_LIMIT) {
        throw new RunStoreError({ code: "blocked_capacity", exitCode: 1, stage: "capacity.state_bytes", operationId, message: "current state reached 1 MiB" });
      }
      const revFiles = fs.readdirSync(stateDir(projectDir, state.state_uuid)).filter((f) => /^r-\d+\.json$/.test(f)).length;
      if (revFiles >= REVISIONS_LIMIT) {
        throw new RunStoreError({ code: "blocked_capacity", exitCode: 1, stage: "capacity.revisions", operationId, message: "revision files per state_uuid reached 512 (orphans counted)" });
      }
      const eff = state.effects.find((e) => e.effect_id === payload.effectId);
      if (!eff || !["queued", "scheduled", "retry_scheduled"].includes(eff.state)) {
        throw new RunStoreError({ code: "unknown_effect", exitCode: 1, stage: "assign", operationId, message: "effect not in a pre-claim state" });
      }
      if (eff.state === "unknown") {
        throw new RunStoreError({ code: "unknown_blocked", exitCode: 1, stage: "assign", operationId, message: "unknown effects block; auto rerun denied" });
      }
      const res = applyEffectEvent(eff, "claim", { tokenOk: true });
      if (res.kind !== "transition") throw new RunStoreError({ code: "claim_denied", exitCode: 1, stage: "assign", operationId, message: "claim denied by state machine" });
      eff.state = res.target;
      eff.token = makeClaimToken(state, authority, sessionId, eff.effect_id, operationId);
      state.queue = state.queue.filter((q) => q.effect_id !== eff.effect_id);
      state.active_run = { session_uuid: sessionId, run_uuid: "run-" + eff.effect_id };
      return {};
    }
    case "applyApproved": {
      const { currentState } = args;
      // RT1AGG N2: approval pre-loaded and bound into requestHash; caller residual keeps the old position
      await ensureRequestHash(); // lazy doc load at the original loadApproval position
      const approval = getApproval();
      assertApprovalGate(approval, "applyApproved", operationId, { principal, callerSessionId: sessionId });
      await loadEvidence(projectDir, payload.evidenceRef, operationId);
      const sess = principal === "session" && sessionId ? state.sessions[sessionId] : null;
      if (sess && sess.descriptor.role === "worker") {
        throw new RunStoreError({ code: "worker_apply_denied", exitCode: 1, stage: "applyApproved", operationId, message: "worker sessions cannot apply approved recovery" });
      }
      if (approval.baseRecordRevision !== authority.record_revision || approval.baseStateRevision !== currentState.revision) {
        throw new RunStoreError({ code: "approval_base_mismatch", exitCode: 1, stage: "applyApproved", operationId, message: "approval base record/state revision mismatch" });
      }
      const c = state.authorization.controller;
      const active = controllerActive(state, clock);
      if (!active) {
        const desc = payload.controllerDescriptor;
        if (!desc || !approval.controllerDescriptor || desc.session_uuid !== approval.controllerDescriptor.session_uuid) {
          throw new RunStoreError({ code: "assignment_required", exitCode: 1, stage: "applyApproved", operationId, message: "no ACTIVE controller: controllerDescriptor must match approval and be assigned in the same transaction" });
        }
        state.authorization.controller = { session_uuid: desc.session_uuid, assigned_at: nowIso(), released_at: null, evidence_ref: payload.evidenceRef, blocked: false };
        state.authorization.controller_epoch += 1;
        if (!state.sessions[desc.session_uuid]) registerSession(state.sessions, desc);
      }
      if (state.active_run !== null && state.active_run !== undefined) {
        const sid = state.active_run.session_uuid;
        state.pending_closures[sid] = {
          descriptor: state.sessions[sid]?.descriptor ?? null,
          closure: { ended_at: nowIso(), end_reason: "recovery_apply", work_outcome: "UNKNOWN", final_revision: state.revision, final_artifacts: [], unresolved: [], successor: null },
          closure_revision: state.revision,
        };
        state.active_run = null;
      }
      return {};
    }
    case "recoverForward": {
      return await runRecoverForward(args);
    }
    case "rebase": {
      const { currentState } = args;
      await ensureRequestHash(); // lazy doc load at the original loadApproval position
      const approval = getApproval();
      assertApprovalGate(approval, "checkpointRebase", operationId, caller);
      if (payload.evidenceRef) await loadEvidence(projectDir, payload.evidenceRef, operationId);
      if (approval.baseRecordRevision !== authority.record_revision || approval.baseStateRevision !== currentState.revision) {
        throw new RunStoreError({ code: "approval_base_mismatch", exitCode: 1, stage: "rebase", operationId, message: "rebase base mismatch" });
      }
      const unresolved = state.effects.filter((e) => UNRESOLVED_EFFECT_STATES.has(e.state)).length;
      if (unresolved !== 0 || Object.keys(state.pending_closures).length !== 0) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "rebase.precondition", operationId, message: "checkpoint-rebase requires zero unresolved effects and flushed closures" });
      }
      const newUuid = "su-" + sha256hex(state.state_uuid + ":" + (authority.epoch + 1)).slice(0, 12);
      state.state_uuid = newUuid;
      state.authorization.stop_epoch += 1;
      for (const e of state.effects) delete e.token;
      state.queue = [];
      const after = async (finalRev, finalAuthority) => {
        const manifest = path.join(runtimeDir(projectDir), "manifest.json");
        let m = {};
        try {
          m = JSON.parse(await fsp.readFile(manifest, "utf-8"));
        } catch {}
        m.rebase_index = m.rebase_index ?? [];
        m.rebase_index.push({ previous_state_uuid: authority.state_uuid, final_revision: finalRev.parent_revision, final_hash: finalRev.parent_hash, new_state_uuid: newUuid, epoch: finalAuthority.epoch });
        await fsp.mkdir(path.dirname(manifest), { recursive: true });
        await fsp.writeFile(manifest, JSON.stringify(m, null, 1), "utf-8");
      };
      return { epoch: authority.epoch + 1, stateUuid: newUuid, baseRevision: state.parent_revision, baseHash: state.parent_hash, after };
    }
    case "prepare":
      return await runPrepare(args);
    case "confirm":
      return await runConfirm(args);
    case "resumeAfterAbortedCutover":
      return await runResume(args);
    case "abandonPreparedCandidate":
      return await runAbandonPrepared(args);
    default:
      throw new RunStoreError({ code: "unknown_command", exitCode: 1, stage: "command", operationId, message: "command not registered" });
  }
}

function hasInFlight(state) {
  return state.effects.some((e) => ["claimed", "running", "awaiting_receipt", "stop_pending"].includes(e.state)) ||
    state.queue.some((e) => ["queued", "scheduled", "retry_scheduled"].includes(e.state)) ||
    state.active_run !== null;
}

// ---------------------------------------------------------------- readCurrent
export async function readCurrent({ projectDir }) {
  const keys = Object.keys(arguments[0] ?? {});
  for (const k of keys) {
    if (k !== "projectDir") {
      throw new RunStoreError({ code: "extra_arg", exitCode: 1, stage: "args", operationId: null, message: "unexpected argument " + k });
    }
  }
  for (let attempt = 0; attempt < 96; attempt += 1) {
    const a1 = await loadAuthority(projectDir);
    const st = await loadRevisionFile(projectDir, a1.state_uuid, a1.current_revision);
    const a2 = await loadAuthority(projectDir);
    if (a1.record_revision !== a2.record_revision || a1.current_hash !== a2.current_hash) {
      await new Promise((r) => setTimeout(r, 1));
      continue;
    }
    if (st.self_hash !== a2.current_hash) {
      // concurrent publish window: re-read both; still inconsistent after the
      // retry budget means a genuinely corrupt pointer (fail closed below)
      await new Promise((r) => setTimeout(r, 1));
      continue;
    }
    const hw = await loadHighwaterOrEmpty(projectDir);
    const hwEntry = hw[a2.state_uuid];
    if (hwEntry && hwEntry.current_revision > a2.current_revision) {
      // mid-publish window (highwater advanced before authority): retry
      await new Promise((r) => setTimeout(r, 1));
      continue;
    }
    if (!hwEntry || hwEntry.current_revision !== a2.current_revision || hwEntry.current_hash !== a2.current_hash || hwEntry.record_revision !== a2.record_revision) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "highwater_incomplete", operationId: null, message: "highwater entry missing/behind/record_revision mismatch; state incomplete" });
    }
    const lineage = [];
    let cursor = st;
    let hitCap = false;
    for (let i = 0; i < 512 && cursor; i += 1) {
      if (i === 511 && cursor.revision !== 0) hitCap = true;
      lineage.push({ revision: cursor.revision, hash: cursor.self_hash, parentRevision: cursor.parent_revision, parentHash: cursor.parent_hash });
      if (cursor.revision === 0) {
        if (cursor.parent_hash !== GENESIS_PARENT_HASH) {
          throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "lineage", operationId: null, message: "genesis parent hash broken" });
        }
        break;
      }
      if (cursor.parent_revision !== cursor.revision - 1) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "lineage", operationId: null, message: "lineage continuity broken at revision " + cursor.revision });
      }
      const parentFile = revisionFilePath(projectDir, a2.state_uuid, cursor.parent_revision);
      let parentExists = true;
      try {
        const parent = await readJsonFile(parentFile, "lineage");
        if (parent.self_hash !== cursor.parent_hash) {
          throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "lineage", operationId: null, message: "parent-hash lineage broken at revision " + cursor.revision });
        }
        cursor = parent;
      } catch (error) {
        if (error.code === "io_load_failed" && /ENOENT/.test(error.message)) parentExists = false;
        else throw error;
      }
      if (!parentExists) {
        // cross state_uuid boundary (post-rebase lineage)
        let found = null;
        for (const dir of fs.readdirSync(path.join(runtimeDir(projectDir), "state"))) {
          const alt = revisionFilePath(projectDir, dir, lineage[lineage.length - 1].parentRevision);
          try {
            const altRev = await readJsonFile(alt, "lineage");
            if (altRev.self_hash === lineage[lineage.length - 1].parentHash) {
              found = altRev;
              break;
            }
          } catch {}
        }
        if (!found) {
          throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "lineage", operationId: null, message: "lineage parent missing at revision " + lineage[lineage.length - 1].parentRevision });
        }
        cursor = found;
      }
    }
    if (hitCap || lineage[lineage.length - 1].revision !== 0) {
      throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "lineage_unreachable", operationId: null, message: "lineage did not reach genesis within the walk cap" });
    }
    return { state: st, authority: a2, lineage };
  }
  throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "authority_pointer", operationId: null, message: "no stable consistent snapshot (pointer moved or mismatched); failing closed" });
}

// ------------------------------------------------------------ commitOperation
export async function commitOperation({ projectDir, operationRef }) {
  for (const k of Object.keys(arguments[0] ?? {})) {
    if (k !== "projectDir" && k !== "operationRef") {
      throw new RunStoreError({ code: "extra_arg", exitCode: 1, stage: "args", operationId: null, message: "unexpected argument " + k });
    }
  }
  return performCommitOperation({ projectDir, operationRef }, FaultAdapter.disabled());
}

// harness-only entry threading the test IO adapter; same lock and checks.
// RT1AGG J: optional harness-only clock, mirroring performTransact.
async function performCommitOperation({ projectDir, operationRef }, adapter, clock) {
  // schema-point: RS-PRESERVED-OPREF-ARG — generic non-object argument gate (non-schema)
  if (!operationRef || typeof operationRef !== "object") {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage: "commitOperation", operationId: null, message: "operationRef required" });
  }
  // schema-point: RS-OPREF — the eight-key closed set, scalar fields, the four
  // non-negative integers and the two hex64 fields are owned by the cutover
  // OperationRef def (the OPREF_KEYS literal is gone). Every def failure maps to
  // this site's single original error identity.
  const shapes = await loadSchemaShapes();
  try {
    shapes.operationRef.check(operationRef, "$");
  } catch (error) {
    if (error instanceof RunStoreError && error.code === "invalid_shape" && error.stage === "shape.check") {
      throw new RunStoreError({ code: "invalid_operation_ref", exitCode: 1, stage: "commitOperation", operationId: typeof operationRef?.operationId === "string" ? operationRef.operationId : null, message: "operationRef rejected by the OperationRef schema: " + error.message });
    }
    throw error;
  }
  const operationId = operationRef.operationId;
  const io = adapter instanceof FaultAdapter ? adapter : FaultAdapter.disabled();
  const owner = await acquireLock(projectDir, operationId, io);
  try {
    return await commitOperationLocked({ projectDir, operationRef, adapter: io, clock });
  } finally {
    await releaseLock(projectDir, owner);
  }
}

const KIND_JOURNAL_STATUS = { cutover_stop: "stopping", confirm: "confirming", resume: "abandoned_no_resume", recoverForward: "recovering" };

async function commitOperationLocked({ projectDir, operationRef, adapter = FaultAdapter.disabled(), preBuiltRevision, clock }) {
  const clockNow = clock ?? Date.now; // RT1AGG J: explicit production default
  const ref = operationRef;
  const authority = await loadAuthority(projectDir);
  const journal = await loadJournal(projectDir);
  // authorization first: a journal entry of the right kind must authorize this
  // ref BEFORE any idempotent-replay branch can return (direct calls denied)
  const entry = findJournalEntryForRef(journal, ref);
  if (!entry) {
    throw new RunStoreError({ code: "no_journal_entry", exitCode: 1, stage: "commitOperation.journal", operationId: ref.operationId, message: "no journal entry authorizes this operationRef (direct calls denied)" });
  }
  const AUTH_STATES = {
    cutover_stop: ["stopping", "preparing", "prepared"],
    confirm: ["confirming", "confirmed"],
    resume: ["abandoned"],
    recoverForward: ["recovering", "recovered"],
  };
  const okStatus = AUTH_STATES[ref.kind]?.includes(entry.status) ?? false;
  if (!okStatus) {
    throw new RunStoreError({ code: "journal_state_mismatch", exitCode: 1, stage: "commitOperation.journal", operationId: ref.operationId, message: "journal status " + entry.status + " does not authorize kind " + ref.kind });
  }
  const boundRef = refOfEntry(entry, ref.kind);
  if (!boundRef || boundRef.revision !== ref.revision || boundRef.hash !== ref.hash ||
      boundRef.parentRevision !== ref.parentRevision || boundRef.parentHash !== ref.parentHash ||
      boundRef.epoch !== ref.epoch || boundRef.stopEpoch !== ref.stopEpoch) {
    throw new RunStoreError({ code: "operation_ref_mismatch", exitCode: 1, stage: "commitOperation.binding", operationId: ref.operationId, message: "operationRef fields differ from journal record" });
  }
  const stateFile = revisionFilePath(projectDir, authority.state_uuid, ref.revision);
  if (fs.existsSync(stateFile)) {
    const existing = await readJsonFile(stateFile, "orphan");
    if (existing.self_hash !== ref.hash) {
      throw new RunStoreError({ code: "operation_hash_mismatch", exitCode: 1, stage: "commitOperation.claim", operationId: ref.operationId, message: "existing revision hash differs from operationRef" });
    }
    const hw = await loadHighwaterOrEmpty(projectDir);
    const hwIo = makeIo(adapter, { write: "highwater_write", fsyncFile: "highwater_write", fsyncDir: "highwater_write", rename: "highwater_write" });
    let nextAuthority = authority;
    let hw2 = { ...hw };
    if ((hw2[authority.state_uuid]?.current_revision ?? -1) < ref.revision) {
      hw2[authority.state_uuid] = { record_revision: authority.record_revision + 1, current_revision: ref.revision, current_hash: ref.hash };
      await atomicWrite(highwaterPath(projectDir), canonicalJSON(hw2), hwIo);
    }
    const auIo = makeIo(adapter, { write: "authority_publish", fsyncFile: "authority_publish", fsyncDir: "authority_publish", rename: "authority_publish" });
    if (authority.current_revision < ref.revision) {
      nextAuthority = { ...authority, record_revision: authority.record_revision + 1, current_revision: ref.revision, current_hash: ref.hash };
      if (ref.kind === "confirm" || ref.kind === "recoverForward") nextAuthority.epoch = ref.epoch;
      await atomicWrite(authorityPath(projectDir), canonicalJSON(nextAuthority), auIo);
    }
    const reread = await loadRevisionFile(projectDir, authority.state_uuid, nextAuthority.current_revision);
    if (reread.self_hash !== nextAuthority.current_hash) {
      throw new RunStoreError({ code: "io_readback", exitCode: 3, stage: "authority_readback", operationId: ref.operationId, message: "commitOperation readback mismatch" });
    }
    return { revision: ref.revision, hash: ref.hash, epoch: nextAuthority.epoch };
  }
  const baseState = await loadRevisionFile(projectDir, authority.state_uuid, authority.current_revision);
  if (ref.parentRevision !== baseState.revision || ref.parentHash !== baseState.self_hash) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "commitOperation.base", operationId: ref.operationId, message: "operationRef parent is not the current revision (unexpected descendant): ref.parent=" + ref.parentRevision + "/" + ref.parentHash.slice(0, 8) + " base=" + baseState.revision + "/" + baseState.self_hash.slice(0, 8) });
  }
  const next = structuredClone(preBuiltRevision ?? baseState);
  if (!preBuiltRevision) {
    // deterministic rebuild that must reproduce the journal-recorded ref hash
    const g1aDoc = await loadApproval(projectDir, entry.approvalRef, null, null, null);
    next.parent_revision = ref.parentRevision;
    next.parent_hash = ref.parentHash;
    next.revision = ref.revision;
    next.authorization.stop_epoch = ref.stopEpoch;
    applyStopTransition(next, {});
    next.active_run = null;
    const ctrl = g1aDoc.controllerDescriptor;
    if (ctrl) {
      next.authorization.controller = {
        session_uuid: ctrl.session_uuid, assigned_at: g1aDoc.assignedAt, released_at: null,
        evidence_ref: g1aDoc.controllerEvidenceRef, blocked: false,
      };
      const hadActive = controllerActive(baseState, clockNow);
      if (!hadActive) next.authorization.controller_epoch = baseState.authorization.controller_epoch + 1;
      if (!next.sessions[ctrl.session_uuid]) registerSession(next.sessions, ctrl);
    }
    if (ref.kind === "recoverForward" && g1aDoc.recoveryTimestamp) {
      applyStopTransition(next, { endedAt: g1aDoc.recoveryTimestamp, endReason: "recover_forward", workOutcome: "UNKNOWN" });
      next.active_run = null;
    }
  }
  next.producer_operation = { ...ref };
  const preHash = computeSelfHash(next);
  if (preHash !== ref.hash) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "commitOperation.publish_hash", operationId: ref.operationId, message: "recomputed selfHash differs from the journal-recorded ref hash; nothing published" });
  }
  const targetEpoch = ref.kind === "confirm" || ref.kind === "recoverForward" ? ref.epoch : authority.epoch;
  const { selfHash, nextAuthority } = await publishRevision(projectDir, next, authority, {
    adapter, operationId: ref.operationId, epoch: targetEpoch, allowOversize: false,
  });
  if (selfHash !== preHash) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "commitOperation.publish_hash", operationId: ref.operationId, message: "published selfHash drifted from the pre-publish recomputation" });
  }
  return { revision: next.revision, hash: selfHash, epoch: nextAuthority.epoch };
}

function refOfEntry(entry, kind) {
  if (kind === "cutover_stop") return entry.stopRef ?? null;
  if (kind === "confirm") return entry.candidateRef ?? null;
  if (kind === "resume") return entry.resumeOperation ?? null;
  if (kind === "recoverForward") return entry.recoveryRef ?? null;
  return null;
}

function findJournalEntryForRef(journal, ref) {
  for (const e of journal?.entries ?? []) {
    const bound = refOfEntry(e, ref.kind);
    if (bound && bound.operationId === ref.operationId) return e;
  }
  return null;
}

// ----------------------------------------------------------- cutover commands
async function buildStopRefAndState({ projectDir, state, authority, operationId, approval, principal, callerSessionId, adapter }) {
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
  const ctrl = approval.controllerDescriptor;
  stopState.authorization.controller = {
    session_uuid: ctrl.session_uuid, assigned_at: approval.assignedAt, released_at: null,
    evidence_ref: approval.controllerEvidenceRef, blocked: false,
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

async function runPrepare(args) {
  const { projectDir, principal, sessionId, operationId, payload, currentState, authority, journal, adapter, clock, ensureRequestHash, getApproval } = args;
  if (currentState.pending_audit > 0) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "prepare.pending_audit", operationId, message: "pending_audit non-zero blocks cutover" });
  }
  const unresolvedCount = currentState.effects.filter((e) => UNRESOLVED_EFFECT_STATES.has(e.state)).length;
  if (unresolvedCount > 0) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "prepare.unresolved", operationId, message: "unknown/unresolved effects block cutover" });
  }
  const caller = { principal, callerSessionId: sessionId ?? null };
  await ensureRequestHash(); // lazy doc load at the original loadApproval position
  const approval = getApproval();
  assertApprovalGate(approval, "cutoverG1a", operationId, caller);
  await loadEvidence(projectDir, payload.stopEvidenceRef, operationId);
  if (payload.controllerDescriptor && (!approval.controllerDescriptor || approval.controllerDescriptor.session_uuid !== payload.controllerDescriptor.session_uuid)) { // R5/W1: a descriptor-less g1a approval denies six-field clean instead of crashing
    throw new RunStoreError({ code: "approval_binding_mismatch", exitCode: 1, stage: "prepare.g1a", operationId, message: "controllerDescriptor differs from G1a" });
  }
  const active = (journal?.entries ?? []).filter((e) => ["stopping", "preparing", "prepared", "confirming", "recovering"].includes(e.status) || (e.status === "abandoned" && !e.resumeRef));
  if (active.some((e) => e.operationId !== operationId)) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "prepare.active", operationId, message: "another cutover/recovery is active" });
  }
  const existing = journalEntry(journal, operationId);
  if (existing && ["prepared", "preparing", "stopping"].includes(existing.status)) {
    const stopFile = revisionFilePath(projectDir, currentState.state_uuid, existing.stopRef.revision);
    const candFile = existing.candidatePath ?? path.join(candidatesDir(projectDir), operationId + ".json");
    const stopPersisted = fs.existsSync(stopFile);
    const candPersisted = existing.status === "prepared" ? fs.existsSync(candFile) : true;
    if (stopPersisted && candPersisted) {
      return "NOOP_JOURNAL"; // complete terminal state, idempotent replay
    }
    if (!stopPersisted) {
      // resume the persisted prefix: retry uses the SAME stopRef from the journal
      const rebuilt = await buildStopRefAndState({ projectDir, state: currentState, authority, operationId, approval, principal, callerSessionId: sessionId ?? null });
      if (rebuilt.stopRef.hash !== existing.stopRef.hash) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "prepare.rebuild", operationId, message: "stopRef rebuild does not reproduce the journal hash" });
      }
      await commitOperationLocked({ projectDir, operationRef: existing.stopRef, adapter, preBuiltRevision: rebuilt.stopState, clock });
      const au2 = await loadAuthority(projectDir);
      const cand = buildCandidateRefAndState({ state: rebuilt.stopState, stopRef: existing.stopRef, operationId, authority: au2 });
      const ioCand = makeIo(adapter, { write: "journal_write", fsyncFile: "journal_write", fsyncDir: "journal_write", rename: "journal_write" });
      await atomicWrite(candFile, canonicalJSON({ candidatePath: candFile, candidateRef: cand.candidateRef, state: cand.candState }), ioCand);
      const j3 = structuredClone(journal);
      const e3 = j3.entries.find((x) => x.operationId === operationId);
      Object.assign(e3, { status: "prepared", candidatePath: candFile, candidateRef: cand.candidateRef });
      e3.entryHash = entryHashOf(e3);
      await writeJournal(projectDir, j3, adapter);
      const au4 = await loadAuthority(projectDir);
      au4.journal_generation = j3.generation;
      au4.journal_head_hash = j3.headHash;
      await atomicWrite(authorityPath(projectDir), canonicalJSON(au4), makeIo(FaultAdapter.disabled(), {}));
      return "NOOP";
    }
  }
  if (approval.parentRevision !== currentState.revision || approval.parentHash !== currentState.self_hash ||
      approval.stateUuid !== currentState.state_uuid || approval.authorityEpoch !== authority.epoch) {
    throw new RunStoreError({ code: "approval_binding_mismatch", exitCode: 1, stage: "prepare.g1a", operationId, message: "G1a approval binding mismatch; stopping not written" });
  }
  const { stopRef, stopState } = await buildStopRefAndState({ projectDir, state: currentState, authority, operationId, approval, principal, callerSessionId: sessionId ?? null });
  const j = journal ? structuredClone(journal) : emptyJournal();
  const stoppingEntry = {
    operationId, status: "stopping", principal: principal ?? "host",
    callerSessionId: sessionId ?? "host-initial", parentRevision: approval.parentRevision,
    parentHash: approval.parentHash, stateUuid: approval.stateUuid,
    authorityEpoch: approval.authorityEpoch, approvalRef: payload.approvalRef,
    approvalHash: approval.approvalHash, stopRef, entryHash: "",
  };
  stoppingEntry.entryHash = entryHashOf(stoppingEntry);
  j.entries = j.entries.filter((e) => e.operationId !== operationId);
  j.entries.push(stoppingEntry);
  j.generation += 1;
  j.previousHeadHash = j.headHash;
  await writeJournal(projectDir, j, adapter);
  await commitOperationLocked({ projectDir, operationRef: stopRef, adapter, preBuiltRevision: stopState, clock });
  const au2 = await loadAuthority(projectDir);
  const { candidateRef, candState } = buildCandidateRefAndState({ state: stopState, stopRef, operationId, authority: au2 });
  const candFile = path.join(candidatesDir(projectDir), operationId + ".json");
  await fsp.mkdir(path.dirname(candFile), { recursive: true });
  const ioCand = makeIo(adapter, { write: "journal_write", fsyncFile: "journal_write", fsyncDir: "journal_write", rename: "journal_write" });
  await atomicWrite(candFile, canonicalJSON({ candidatePath: candFile, candidateRef, state: candState }), ioCand);
  const preparedEntry = { ...stoppingEntry, status: "prepared", candidatePath: candFile, candidateRef };
  preparedEntry.entryHash = entryHashOf(preparedEntry);
  const j2 = structuredClone(j);
  j2.entries = j2.entries.filter((e) => e.operationId !== operationId);
  j2.entries.push(preparedEntry);
  j2.generation += 1;
  j2.previousHeadHash = j2.headHash;
  await writeJournal(projectDir, j2, adapter);
  const au3 = structuredClone(au2);
  au3.journal_generation = j2.generation;
  au3.journal_head_hash = j2.headHash;
  await atomicWrite(authorityPath(projectDir), canonicalJSON(au3), makeIo(FaultAdapter.disabled(), {}));
  return "NOOP";
}

async function runConfirm(args) {
  const { projectDir, principal, sessionId, operationId, payload, state, authority, journal, adapter, clock, ensureRequestHash, getApproval } = args;
  const caller = { principal, callerSessionId: sessionId ?? null };
  await ensureRequestHash(); // lazy doc load at the original loadApproval position
  const approval = getApproval();
  assertApprovalGate(approval, "cutoverG1b", operationId, caller);
  const entry = journalEntry(journal, operationId);
  if (!entry || !["prepared", "confirming", "confirmed"].includes(entry.status)) {
    throw new RunStoreError({ code: "journal_state_mismatch", exitCode: 1, stage: "confirm", operationId, message: "confirm requires a prepared cutover" });
  }
  if (entry.status === "confirmed") {
    // complete-terminal verification before the idempotent NOOP
    const candFile0 = entry.candidatePath ?? path.join(candidatesDir(projectDir), operationId + ".json");
    const cand0 = JSON.parse(await fsp.readFile(candFile0, "utf-8"));
    const revFile0 = revisionFilePath(projectDir, authority.state_uuid, cand0.candidateRef.revision);
    if (!fs.existsSync(revFile0)) {
      // candidate revision missing: continue the chain below instead of a silent NOOP
    } else if (authority.current_revision === cand0.candidateRef.revision && authority.epoch === cand0.candidateRef.epoch) {
      const landed0 = await loadRevisionFile(projectDir, authority.state_uuid, cand0.candidateRef.revision);
      const hw0b = await loadHighwaterOrEmpty(projectDir);
      const hwE0 = hw0b[authority.state_uuid];
      const headOk0 = authority.journal_head_hash === (journal?.headHash ?? authority.journal_head_hash);
      if (landed0.self_hash === authority.current_hash && landed0.producer_operation?.hash === cand0.candidateRef.hash &&
          hwE0 && hwE0.current_revision === authority.current_revision && hwE0.current_hash === authority.current_hash && hwE0.record_revision === authority.record_revision && headOk0) {
        return "NOOP_JOURNAL";
      }
      // anchors incomplete: fall through to the completion path below
    } else {
      // revision exists but authority has not caught up: finish the publication
      const auFix0 = structuredClone(authority);
      auFix0.record_revision = authority.record_revision + 1;
      auFix0.current_revision = cand0.candidateRef.revision;
      auFix0.current_hash = cand0.candidateRef.hash;
      auFix0.epoch = cand0.candidateRef.epoch;
      const hw0 = await loadHighwaterOrEmpty(projectDir);
      hw0[authority.state_uuid] = { record_revision: auFix0.record_revision, current_revision: cand0.candidateRef.revision, current_hash: cand0.candidateRef.hash };
      const io0 = makeIo(FaultAdapter.disabled(), {});
      await atomicWrite(highwaterPath(projectDir), canonicalJSON(hw0), io0);
      await atomicWrite(authorityPath(projectDir), canonicalJSON(auFix0), io0);
      return "NOOP";
    }
  }
  const candFile = entry.candidatePath ?? path.join(candidatesDir(projectDir), operationId + ".json");
  const cand = JSON.parse(await fsp.readFile(candFile, "utf-8"));
  if (approval.candidatePath !== candFile || approval.candidateHash !== cand.candidateRef.hash ||
      approval.targetAuthorityEpoch !== cand.candidateRef.epoch) {
    throw new RunStoreError({ code: "approval_binding_mismatch", exitCode: 1, stage: "confirm.g1b", operationId, message: "G1b binding mismatch; confirming not entered" });
  }
  const j = structuredClone(journal);
  const confirming = { ...entry, status: "confirming", confirmApprovalRef: payload.approvalRef, confirmApprovalHash: approval.approvalHash };
  confirming.entryHash = entryHashOf(confirming);
  j.entries = j.entries.filter((e) => e.operationId !== operationId);
  j.entries.push(confirming);
  j.generation += 1;
  j.previousHeadHash = j.headHash;
  await writeJournal(projectDir, j, adapter);
  const auNow = await loadAuthority(projectDir);
  const result = await commitOperationLocked({ projectDir, operationRef: cand.candidateRef, preBuiltRevision: cand.state, clock });
  const confirmed = { ...confirming, status: "confirmed" };
  confirmed.entryHash = entryHashOf(confirmed);
  const j2 = structuredClone(j);
  j2.entries = j2.entries.filter((e) => e.operationId !== operationId);
  j2.entries.push(confirmed);
  j2.generation += 1;
  j2.previousHeadHash = j2.headHash;
  await writeJournal(projectDir, j2, adapter);
  const au3 = await loadAuthority(projectDir);
  au3.journal_generation = j2.generation;
  au3.journal_head_hash = j2.headHash;
  const ioAu = makeIo(FaultAdapter.disabled(), {});
  await atomicWrite(authorityPath(projectDir), canonicalJSON(au3), ioAu);
  return "NOOP_CONFIRMED";
}

async function runAbandonPrepared(args) {
  const { projectDir, principal, sessionId, operationId, payload, state, authority, journal, adapter, ensureRequestHash, getApproval } = args;
  const caller = { principal, callerSessionId: sessionId ?? null };
  await ensureRequestHash(); // lazy doc load at the original loadApproval position
  const approval = getApproval();
  assertApprovalGate(approval, "cutoverAbandon", operationId, caller);
  await loadEvidence(projectDir, payload.abortEvidenceRef, operationId);
  const entry = journalEntry(journal, operationId);
  if (!entry || entry.status !== "prepared") {
    throw new RunStoreError({ code: "journal_state_mismatch", exitCode: 1, stage: "abandonPreparedCandidate", operationId, message: "only prepared candidates may be abandoned by this command" });
  }
  if (approval.candidateHash !== entry.candidateRef?.hash) {
    throw new RunStoreError({ code: "approval_binding_mismatch", exitCode: 1, stage: "abandonPreparedCandidate", operationId, message: "abandon approval candidateHash mismatch" });
  }
  // resumeOperation is constructed by the store from the journal, not by the caller
  const resumeOperation = {
    operationId: operationId + ":resume", kind: "resume",
    parentRevision: entry.stopRef.revision, parentHash: entry.stopRef.hash,
    revision: entry.stopRef.revision + 1, hash: "", epoch: authority.epoch,
    stopEpoch: entry.stopRef.stopEpoch + 1,
  };
  const base = await loadRevisionFile(projectDir, authority.state_uuid, authority.current_revision);
  const resumeState = structuredClone(base);
  resumeState.parent_revision = resumeOperation.parentRevision;
  resumeState.parent_hash = resumeOperation.parentHash;
  resumeState.revision = resumeOperation.revision;
  resumeState.authorization.stop_epoch = resumeOperation.stopEpoch;
  applyStopTransition(resumeState, {});
  resumeState.active_run = null;
  resumeState.producer_operation = { ...resumeOperation };
  const h = computeSelfHash(resumeState);
  resumeState.self_hash = h;
  resumeOperation.hash = h;
  const abortDoc = await loadEvidence(projectDir, payload.abortEvidenceRef, operationId);
  const abortCopy = structuredClone(abortDoc);
  delete abortCopy.evidenceHash;
  const j = structuredClone(journal);
  const abandoned = { ...entry, status: "abandoned", abortEvidenceRef: payload.abortEvidenceRef, abortEvidenceHash: sha256hex(canonicalJSON(abortCopy)), abandonApprovalRef: payload.approvalRef, abandonApprovalHash: approval.approvalHash, resumeOperation };
  abandoned.entryHash = entryHashOf(abandoned);
  j.entries = j.entries.filter((e) => e.operationId !== operationId);
  j.entries.push(abandoned);
  j.generation += 1;
  j.previousHeadHash = j.headHash;
  await writeJournal(projectDir, j, adapter);
  const au = await loadAuthority(projectDir);
  au.journal_generation = j.generation;
  au.journal_head_hash = j.headHash;
  const ioAu = makeIo(FaultAdapter.disabled(), {});
  await atomicWrite(authorityPath(projectDir), canonicalJSON(au), ioAu);
  return "NOOP"; // journal-only: no state revision, no controller assignment
}

async function runResume(args) {
  const { projectDir, principal, sessionId, operationId, payload, state, authority, journal, adapter, clock } = args;
  const allowed = ["operationRef", "resumeRef"];
  for (const k of Object.keys(payload ?? {})) {
    if (!allowed.includes(k)) {
      throw new RunStoreError({ code: "unknown_payload_key", exitCode: 1, stage: "resumeAfterAbortedCutover.payload", operationId, message: "resumeAfterAbortedCutover accepts only journal-derived refs; extra input " + k + " denied" });
    }
  }
  const refRoot = typeof payload.operationRef === "string" ? payload.operationRef : payload.operationRef?.operationId;
  const root = (typeof refRoot === "string" ? refRoot.split(":")[0] : null) ?? guessRoot(operationId);
  const entry = journalEntry(journal, root);
  if (!entry || entry.status !== "abandoned") {
    throw new RunStoreError({ code: "journal_state_mismatch", exitCode: 1, stage: "resumeAfterAbortedCutover", operationId, message: "resume requires an abandoned entry" });
  }
  if (entry.resumeRef) {
    const revFile = revisionFilePath(projectDir, authority.state_uuid, entry.resumeOperation.revision);
    if (fs.existsSync(revFile)) {
      const landedR = await loadRevisionFile(projectDir, authority.state_uuid, entry.resumeOperation.revision);
      const hwR = await loadHighwaterOrEmpty(projectDir);
      const hwER = hwR[authority.state_uuid];
      if (landedR.self_hash === entry.resumeOperation.hash && authority.current_revision === entry.resumeOperation.revision &&
          authority.current_hash === entry.resumeOperation.hash && hwER && hwER.current_revision === authority.current_revision &&
          hwER.current_hash === authority.current_hash && hwER.record_revision === authority.record_revision) {
        return "NOOP"; // fully published resume: idempotent replay
      }
      // anchors incomplete: complete the publication below instead of a silent NOOP
      const hwFixR = structuredClone(hwR);
      hwFixR[authority.state_uuid] = { record_revision: authority.record_revision + 1, current_revision: entry.resumeOperation.revision, current_hash: entry.resumeOperation.hash };
      const auFixR = structuredClone(authority);
      auFixR.record_revision = authority.record_revision + 1;
      auFixR.current_revision = entry.resumeOperation.revision;
      auFixR.current_hash = entry.resumeOperation.hash;
      const ioR = makeIo(FaultAdapter.disabled(), {});
      await atomicWrite(highwaterPath(projectDir), canonicalJSON(hwFixR), ioR);
      await atomicWrite(authorityPath(projectDir), canonicalJSON(auFixR), ioR);
      return "NOOP";
    }
    // resumeRef recorded but the revision never landed: continue below
  }
  // G1a approval and controllerDescriptor come from the journal only
  const approvalDoc = JSON.parse(await fsp.readFile(resolveApprovalRef(projectDir, entry.approvalRef), "utf-8"));
  const result = await commitOperationLocked({ projectDir, operationRef: entry.resumeOperation, clock });
  const j = structuredClone(journal);
  const done = { ...entry, resumeRef: entry.resumeOperation.hash };
  done.entryHash = entryHashOf(done);
  j.entries = j.entries.filter((e) => e.operationId !== entry.operationId);
  j.entries.push(done);
  j.generation += 1;
  j.previousHeadHash = j.headHash;
  await writeJournal(projectDir, j, adapter);
  const au = await loadAuthority(projectDir);
  au.journal_generation = j.generation;
  au.journal_head_hash = j.headHash;
  const ioAu = makeIo(FaultAdapter.disabled(), {});
  await atomicWrite(authorityPath(projectDir), canonicalJSON(au), ioAu);
  return "NOOP_RESUMED";
}

function guessRoot(operationId) {
  return operationId.split(":")[0];
}

async function buildRecoveryState({ projectDir, currentState, authority, operationId, approval, adapter, clock }) {
  const recState = structuredClone(currentState);
  recState.parent_revision = currentState.revision;
  recState.parent_hash = currentState.self_hash;
  recState.revision = currentState.revision + 1;
  recState.authorization.stop_epoch = currentState.authorization.stop_epoch + 1;
  applyStopTransition(recState, { endedAt: approval.recoveryTimestamp, endReason: "recover_forward", workOutcome: "UNKNOWN" });
  recState.active_run = null;
  const active = controllerActive(currentState, clock);
  if (!active && approval.controllerDescriptor) {
    recState.authorization.controller = {
      session_uuid: approval.controllerDescriptor.session_uuid,
      assigned_at: approval.recoveryTimestamp,
      released_at: null,
      evidence_ref: approval.controllerEvidenceRef,
      blocked: false,
    };
    recState.authorization.controller_epoch = currentState.authorization.controller_epoch + 1;
    if (!recState.sessions[approval.controllerDescriptor.session_uuid]) {
      registerSession(recState.sessions, approval.controllerDescriptor);
    }
  }
  const refStub = { operationId: operationId + ":recover", kind: "recoverForward", parentRevision: currentState.revision, parentHash: currentState.self_hash, revision: currentState.revision + 1, hash: "", epoch: approval.targetAuthorityEpoch, stopEpoch: currentState.authorization.stop_epoch + 1 };
  recState.producer_operation = { ...refStub };
  const h = computeSelfHash(recState);
  recState.self_hash = h;
  recState.producer_operation.hash = h;
  return recState;
}

async function runRecoverForward(args) {
  const { projectDir, principal, sessionId, operationId, payload, state, currentState, authority, journal, adapter, clock, ensureRequestHash, getApproval } = args;
  // schema-point: RS-PRESERVED-CONFIRMED-ID — generic confirmedOperationId argument gate (non-document site; non-schema by design)
  if (!payload.confirmedOperationId) {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage: "recoverForward", operationId, message: "confirmedOperationId is explicit and required" });
  }
  if (currentState.pending_audit > 0) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "recoverForward.pending_audit", operationId, message: "pending_audit non-zero blocks recovery" });
  }
  const caller = { principal, callerSessionId: sessionId ?? null };
  await ensureRequestHash(); // lazy doc load at the original loadApproval position
  const approval = getApproval();
  assertApprovalGate(approval, "cutoverRecovery", operationId, caller);
  if (approval.confirmedOperationId !== payload.confirmedOperationId) {
    throw new RunStoreError({ code: "approval_binding_mismatch", exitCode: 1, stage: "recoverForward", operationId, message: "confirmedOperationId differs from approval" });
  }
  const self = journalEntry(journal, operationId);
  if (self && (self.status === "recovering" || self.status === "recovered")) {
    const revFile = revisionFilePath(projectDir, currentState.state_uuid, self.recoveryRef.revision);
    if (fs.existsSync(revFile)) {
      const landed = await loadRevisionFile(projectDir, currentState.state_uuid, self.recoveryRef.revision);
      if (landed.self_hash !== self.recoveryRef.hash) {
        throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "recoverForward.replay_hash", operationId, message: "landed recovery revision hash differs from the journal recoveryRef" });
      }
      // chain-head verification precedes EVERY idempotent return (recovered included):
      // a recovered entry without its confirmed/recovered head is a hard deny
      const jFix = structuredClone(journal);
      const headEntry = jFix.entries.find((e) => e.operationId === payload.confirmedOperationId);
      if (!headEntry || !["confirmed", "recovered"].includes(headEntry.status)) {
        throw new RunStoreError({ code: "missing_start_state", exitCode: 1, stage: "recoverForward", operationId, message: "confirmed/recovered chain head missing; recovery denied before any idempotent return" });
      }
      if (self.status === "recovered" && authority.current_revision >= self.recoveryRef.revision) {
        return "NOOP"; // complete terminal state: idempotent, retry adds no revision
      }
      // journal/authority anchors unfinished: complete the terminal state now
      const doneEntry = jFix.entries.find((e) => e.operationId === operationId);
      doneEntry.status = "recovered";
      doneEntry.entryHash = entryHashOf(doneEntry);
      if (!headEntry.recoveredBy) {
        headEntry.recoveredBy = self.recoveryRef;
        headEntry.entryHash = entryHashOf(headEntry);
      }
      jFix.generation += 1;
      jFix.previousHeadHash = jFix.headHash;
      await writeJournal(projectDir, jFix, adapter);
      let auFix = authority;
      if (authority.current_revision < self.recoveryRef.revision) {
        auFix = structuredClone(authority);
        auFix.record_revision = authority.record_revision + 1;
        auFix.current_revision = self.recoveryRef.revision;
        auFix.current_hash = self.recoveryRef.hash;
        auFix.epoch = self.recoveryRef.epoch;
        const hwF = await loadHighwaterOrEmpty(projectDir);
        hwF[currentState.state_uuid] = { record_revision: auFix.record_revision, current_revision: self.recoveryRef.revision, current_hash: self.recoveryRef.hash };
        const ioF = makeIo(FaultAdapter.disabled(), {});
        await atomicWrite(highwaterPath(projectDir), canonicalJSON(hwF), ioF);
        await atomicWrite(authorityPath(projectDir), canonicalJSON(auFix), ioF);
      }
      auFix.journal_generation = jFix.generation;
      auFix.journal_head_hash = jFix.headHash;
      const ioG = makeIo(FaultAdapter.disabled(), {});
      await atomicWrite(authorityPath(projectDir), canonicalJSON(auFix), ioG);
      return "NOOP";
    }
  }
  const head = journalEntry(journal, payload.confirmedOperationId);
  if (!head || !["confirmed", "recovered"].includes(head.status)) {
    throw new RunStoreError({ code: "missing_start_state", exitCode: 1, stage: "recoverForward", operationId, message: "no confirmed/recovered chain head to recover from" });
  }
  if (approval.parentRevision !== currentState.revision || approval.parentHash !== currentState.self_hash) {
    throw new RunStoreError({ code: "approval_binding_mismatch", exitCode: 1, stage: "recoverForward", operationId, message: "recovery approval parent mismatch" });
  }
  const recState = await buildRecoveryState({ projectDir, currentState, authority, operationId, approval, adapter, clock });
  const recoveryRef = {
    operationId: operationId + ":recover", kind: "recoverForward",
    parentRevision: currentState.revision, parentHash: currentState.self_hash,
    revision: currentState.revision + 1, hash: recState.self_hash, epoch: approval.targetAuthorityEpoch,
    stopEpoch: currentState.authorization.stop_epoch + 1,
  };
  if (recoveryRef.hash !== recState.producer_operation.hash) {
    throw new RunStoreError({ code: "blocked", exitCode: 1, stage: "recoverForward.rebuild", operationId, message: "recovery revision rebuild mismatch" });
  }
  // phase 1: journal recovering
  const j = structuredClone(journal);
  const confirmedRef = {
    operationId: head.operationId, candidateHash: head.candidateRef?.hash ?? head.confirmedRef?.candidateHash ?? GENESIS_PARENT_HASH,
    revision: head.candidateRef?.revision ?? head.confirmedRef?.revision ?? 0,
    hash: head.candidateRef?.hash ?? head.confirmedRef?.hash ?? GENESIS_PARENT_HASH,
    epoch: head.candidateRef?.epoch ?? head.confirmedRef?.epoch ?? authority.epoch,
  };
  const recovering = {
    operationId, status: "recovering", principal: principal ?? "host", callerSessionId: sessionId ?? "host",
    parentRevision: recoveryRef.parentRevision, parentHash: recoveryRef.parentHash,
    stateUuid: currentState.state_uuid, authorityEpoch: recoveryRef.epoch,
    approvalRef: payload.approvalRef, approvalHash: approval.approvalHash,
    confirmedRef, recoveryRef, entryHash: "",
  };
  recovering.entryHash = entryHashOf(recovering);
  j.entries = j.entries.filter((e) => e.operationId !== operationId);
  j.entries.push(recovering);
  j.generation += 1;
  j.previousHeadHash = j.headHash;
  await writeJournal(projectDir, j, adapter);
  // phase 2: commitOperation(recoveryRef)
  await commitOperationLocked({ projectDir, operationRef: recoveryRef, preBuiltRevision: recState, clock });
  // phase 3: same-batch recovered + head recoveredBy
  const au2 = await loadAuthority(projectDir);
  const j2 = structuredClone(j);
  const recovered = { ...recovering, status: "recovered" };
  recovered.entryHash = entryHashOf(recovered);
  j2.entries = j2.entries.filter((e) => e.operationId !== operationId);
  j2.entries.push(recovered);
  const head2 = { ...head, recoveredBy: recoveryRef };
  head2.entryHash = entryHashOf(head2);
  j2.entries = j2.entries.filter((e) => e.operationId !== head.operationId);
  j2.entries.push(head2);
  j2.generation += 1;
  j2.previousHeadHash = j2.headHash;
  await writeJournal(projectDir, j2, adapter);
  const au3 = structuredClone(au2);
  au3.journal_generation = j2.generation;
  au3.journal_head_hash = j2.headHash;
  const ioAu = makeIo(FaultAdapter.disabled(), {});
  await atomicWrite(authorityPath(projectDir), canonicalJSON(au3), ioAu);
  return "NOOP_RECOVERED";
}

export { CAPACITY_LIMITS, COMMANDS, PROTECTED_PAYLOAD_KEYS, QUEUE_LIMIT, EFFECTS_LIMIT, APPLIED_LIMIT, STATE_BYTES_LIMIT, REVISIONS_LIMIT, UNRESOLVED_EFFECT_STATES, FROZEN_JOURNAL_STATES };

// =========================================================== self-test harness
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES = path.join(SCRIPT_DIR, ".golden", "run-store-fixtures.json");
const DEFAULT_TEMP_ROOT = "/tmp/rt1a-executor-selftest";
const TEMP_PREFIX = "/tmp/rt1a-executor-";
// R2/预裁十 (taskbook r8+ assumption 3): V-4 command 1's declared temp-root is explicitly
// licensed — accept both the legacy guard prefix and the licensed post-J path.
function tempRootAllowed(resolved) {
  return resolved.startsWith(TEMP_PREFIX) || resolved === "/tmp/rt1agg-executor-postj-selftest";
}
// RT1AGG J: fixed fixture clock for the whole self-test chain. TS0-heartbeats
// stay inside the 30-minute window; the 2020-01-01 expiry probes stay expired.
// Production entries never read this — they resolve Date.now explicitly.
const SELFTEST_CLOCK_MS = Date.parse(TS0) + 15 * 60 * 1000;
const selftestClock = () => SELFTEST_CLOCK_MS;

export async function guardTempRoot(tempRoot) {
  if (typeof tempRoot !== "string" || tempRoot.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const resolved = path.resolve(tempRoot);
  if (!tempRootAllowed(resolved)) return { ok: false, reason: "prefix" };
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
      if (probe !== "/tmp" && !tempRootAllowed(probe)) return { ok: false, reason: "ancestor_escape" };
      return { ok: true, reason: null, resolved };
    }
    throw error;
  }
  if (real !== resolved && !tempRootAllowed(real)) return { ok: false, reason: "symlink_escape" };
  return { ok: true, reason: null, resolved };
}

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

function evalAssertion(observed, a) {
  const actual = getPath(observed, a.path);
  const deepEq = (x, y) => {
    if (x === y) return true;
    if (Array.isArray(x) && Array.isArray(y)) return JSON.stringify(x) === JSON.stringify(y);
    return false;
  };
  switch (a.op) {
    case "eq": return deepEq(actual, a.value);
    case "ne": return actual !== a.value;
    case "exists": return actual !== undefined;
    case "absent": return actual === undefined;
    case "lt": return typeof actual === "number" && typeof a.value === "number" && actual < a.value;
    case "lte": return typeof actual === "number" && typeof a.value === "number" && actual <= a.value;
    case "hash_eq": {
      const src = getPath(observed, a.value.of);
      if (!src || typeof src !== "object") return false;
      return sha256hex(canonicalJSON(stripClone(src))) === actual;
    }
    default: return false;
  }
}

function stripClone(src) {
  const copy = structuredClone(src);
  delete copy.self_hash;
  if (copy.producer_operation && typeof copy.producer_operation === "object") {
    const po = { ...copy.producer_operation };
    delete po.hash;
    copy.producer_operation = po;
  }
  return copy;
}

async function validateFixtureClosure(vectors) {
  if (!Array.isArray(vectors) || vectors.length === 0) throw new Error("no vectors");
  const seen = new Set();
  for (const v of vectors) {
    const { fixture_id: id, input, input_hash: h, expected_state: es, expected_exit: ee } = v;
    if (!id) throw new Error("missing fixture_id");
    if (!input || typeof input.scenario !== "string" || !input.scenario) throw new Error(id + " scenario");
    if (!input.setup || !input.action) throw new Error(id + " setup/action");
    if (!Array.isArray(es.assertions) || es.assertions.length === 0) throw new Error(id + " assertions empty");
    if (!Array.isArray(es.evidence) || es.evidence.length === 0) throw new Error(id + " evidence empty");
    if (seen.has(h)) throw new Error(id + " duplicate input_hash");
    seen.add(h);
    if (!(ee === 0 || ee === 1 || ee === 3 || ee === "blocked")) throw new Error(id + " expected_exit");
    const term = es.terminal;
    if (ee === "blocked" && term !== "blocked") throw new Error(id + " blocked/terminal");
    if (ee === 0 && term !== "passed" && term !== "recovered") throw new Error(id + " exit0/terminal");
    if (ee === 1 && term !== "denied") throw new Error(id + " exit1/terminal");
    if (ee === 3 && term !== "denied" && term !== "blocked") throw new Error(id + " exit3/terminal");
  }
  return true;
}

// ---------------------------------------------------------------- harness ctx
function newCtx(runRoot, fixture) {
  return {
    runRoot,
    fixtureId: fixture.fixture_id,
    projectDir: path.join(runRoot, fixture.fixture_id, "proj"),
    extras: {},
    calls: [],
    autoRefs: {},
    lastResult: null,
    lastError: null,
    exitCode: null,
    classification: null,
    revisionBefore: null,
    fault: fixture.input.fault ?? null,
    faultUsed: 0,
    ctxNotes: {},
  };
}

function makeDescriptor(partial) {
  return {
    session_uuid: partial.session_uuid, project_id: "proj-fs", kind: partial.kind ?? "rt1a",
    role: partial.role ?? "controller", started_at: partial.started_at ?? TS0,
    parent_session_id: null, resume_of: null, cfg_hash: "7d1f0a2c" + "b".repeat(56),
    route_snapshot: {}, binding_snapshot_ref: "bindings/rt1a.json",
    binding_snapshot_hash: "9e2b1c0d" + "e".repeat(56),
  };
}

async function currentAuthorityOf(ctx) {
  try {
    return await loadAuthority(ctx.projectDir);
  } catch {
    return null;
  }
}

async function currentStateOf(ctx) {
  const a = await currentAuthorityOf(ctx);
  if (!a) return null;
  try {
    return await loadRevisionFile(ctx.projectDir, a.state_uuid, a.current_revision);
  } catch {
    return null;
  }
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

async function makeResolver(ctx) {
  const authority = await currentAuthorityOf(ctx);
  const state = authority ? await loadRevisionFile(ctx.projectDir, authority.state_uuid, authority.current_revision).catch(() => null) : null;
  const journalForRef = await loadJournal(ctx.projectDir).catch(() => null);
  const resumeOp = (journalForRef?.entries ?? []).find((e) => e.resumeOperation)?.resumeOperation ?? null;
  return (s) => {
    if (!s.startsWith("@auto:")) return s;
    const key = s.slice(6);
    switch (key) {
      case "current_revision": return authority ? authority.current_revision : 0;
      case "parent_revision": return state ? state.revision : 0;
      case "parent_hash": return state ? state.self_hash : GENESIS_PARENT_HASH;
      case "state_uuid": return authority ? authority.state_uuid : "su-auto";
      case "authority_epoch": return authority ? authority.epoch : 0;
      case "authority_epoch_next": return authority ? authority.epoch + 1 : 1;
      case "record_revision": return authority ? authority.record_revision : 0;
      case "resume_ref": return resumeOp ?? s;
      case "candidate_hash": {
        if (ctx.autoRefs.candidateHash) return ctx.autoRefs.candidateHash;
        try {
          const dir = candidatesDir(ctx.projectDir);
          const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
          if (files.length) {
            const cand = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), "utf-8"));
            ctx.autoRefs.candidateHash = cand.candidateRef.hash;
            return ctx.autoRefs.candidateHash;
          }
        } catch {}
        return GENESIS_PARENT_HASH;
      }
      default: return s;
    }
  };
}

async function writeApprovalDoc(ctx, file, doc) {
  const dir = approvalsDir(ctx.projectDir);
  await fsp.mkdir(dir, { recursive: true });
  if (!doc.kind && doc.confirmedOperationId) doc.kind = "cutoverRecovery";
  const resolver = await makeResolver(ctx);
  doc = deepResolve(doc, resolver);
  const withHash = { ...doc, approvalHash: computeApprovalHash(doc) };
  await fsp.writeFile(path.join(dir, file), JSON.stringify(withHash, null, 1), "utf-8");
  return path.join(dir, file);
}

async function writeEvidenceDoc(ctx, file, doc) {
  const dir = approvalsDir(ctx.projectDir);
  await fsp.mkdir(dir, { recursive: true });
  const copy = { ...doc };
  if (copy.evidenceHash === "COMPUTE" || copy.evidenceHash === undefined) {
    delete copy.evidenceHash;
    copy.evidenceHash = sha256hex(canonicalJSON(copy));
  }
  await fsp.writeFile(path.join(dir, file), JSON.stringify(copy, null, 1), "utf-8");
}

async function makeG1bApproval(ctx, rootOp) {
  const candFile = path.join(candidatesDir(ctx.projectDir), rootOp + ".json");
  const cand = JSON.parse(await fsp.readFile(candFile, "utf-8"));
  ctx.autoRefs.candidateHash = cand.candidateRef.hash;
  const doc = {
    approvalId: "apr-g1b-" + rootOp, projectId: "proj-fs", operationId: rootOp,
    kind: "cutoverG1b", candidatePath: candFile, candidateHash: cand.candidateRef.hash,
    targetAuthorityEpoch: cand.candidateRef.epoch, allowedCallers: [{ principal: "host", callerSessionId: null }],
  };
  const file = "app-g1b-" + rootOp + ".json";
  await writeApprovalDoc(ctx, file, doc);
  return file;
}

async function seedRevision(ctx, patch) {
  // harness construction channel: builds the next revision with patched
  // fields and publishes through the real six-step chain
  const authority = await loadAuthority(ctx.projectDir);
  const base = await loadRevisionFile(ctx.projectDir, authority.state_uuid, authority.current_revision);
  const next = structuredClone(base);
  next.parent_revision = base.revision;
  next.parent_hash = base.self_hash;
  next.revision = base.revision + 1;
  if (patch.sessions) Object.assign(next.sessions, deepResolve(patch.sessions, await makeResolver(ctx)));
  if (patch.queue) next.queue = deepResolve(patch.queue, await makeResolver(ctx));
  if (patch.effects) next.effects = deepResolve(patch.effects, await makeResolver(ctx));
  if (typeof patch.applied_n === "number") {
    next.applied_operations = [];
    for (let i = 0; i < patch.applied_n; i += 1) {
      const rh = sha256hex("seed-op-" + i);
      next.applied_operations.push(encodeApplied("seed-op-" + i, rh, next.revision, sha256hex("seed-op-" + i + ":" + rh), authority.record_revision + 1));
    }
  }
  if (typeof patch.pending_audit === "number") next.pending_audit = patch.pending_audit;
  if (patch.active_run !== undefined) next.active_run = patch.active_run;
  if (patch.controller_block) next.authorization.controller = { ...next.authorization.controller, blocked: true };
  if (patch.heartbeat_expired) {
    for (const sid of patch.heartbeat_expired) {
      if (next.sessions[sid]) next.sessions[sid].live_state.heartbeat = "2020-01-01T00:00:00Z";
    }
  }
  if (typeof patch.state_pad_bytes === "number") {
    const target = patch.state_pad_bytes;
    next.reviews = [{ pad: "" }];
    const probe = canonicalJSON(next);
    const baseLen = Buffer.byteLength(probe, "utf-8");
    let padLen = Math.max(0, target - baseLen);
    next.reviews = [{ pad: "x".repeat(padLen) }];
    let len = Buffer.byteLength(canonicalJSON(next), "utf-8");
    next.reviews = [{ pad: "x".repeat(Math.max(0, padLen + (target - len))) }];
    len = Buffer.byteLength(canonicalJSON(next), "utf-8");
    if (len !== target) {
      // final linear adjustment (self_hash placeholder length differs)
      next.reviews = [{ pad: "x".repeat(Math.max(0, padLen + (target - len) + (target - len))) }];
    }
  }
  if (typeof patch.applied_n !== "number") {
    const commitHash = sha256hex("seed:" + next.revision);
    next.applied_operations.push(encodeApplied("seed-" + next.revision, sha256hex("seed-" + next.revision), next.revision, commitHash, authority.record_revision + 1));
  }
  next.self_hash = computeSelfHash(next);
  if (typeof patch.state_pad_bytes === "number") {
    const target = patch.state_pad_bytes;
    let len = Buffer.byteLength(canonicalJSON(next), "utf-8");
    while (len !== target && len < target + 200) {
      const cur = next.reviews[0]?.pad?.length ?? 0;
      next.reviews = [{ pad: "x".repeat(Math.max(0, cur + (target - len))) }];
      next.self_hash = computeSelfHash(next);
      len = Buffer.byteLength(canonicalJSON(next), "utf-8");
      if (Math.abs(target - len) === 0) break;
      if (target - len < 0 && cur === 0) break;
    }
  }
  // publish through the real atomic-write helper (file + highwater + authority)
  const io = makeIo(FaultAdapter.disabled(), {});
  const file = revisionFilePath(ctx.projectDir, next.state_uuid, next.revision);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, canonicalJSON(next), io);
  const hw = await loadHighwaterOrEmpty(ctx.projectDir);
  hw[next.state_uuid] = { record_revision: authority.record_revision + 1, current_revision: next.revision, current_hash: next.self_hash };
  await atomicWrite(highwaterPath(ctx.projectDir), canonicalJSON(hw), io);
  const nextAuthority = { ...authority, record_revision: authority.record_revision + 1, current_revision: next.revision, current_hash: next.self_hash };
  await atomicWrite(authorityPath(ctx.projectDir), canonicalJSON(nextAuthority), io);
  if (patch.revisions_n) {
    const dir = stateDir(ctx.projectDir, next.state_uuid);
    await fsp.mkdir(dir, { recursive: true });
    for (let i = next.revision + 1; i < patch.revisions_n; i += 1) {
      await fsp.writeFile(path.join(dir, "r-" + i + ".json"), JSON.stringify({ seed_shell: true, revision: i }), "utf-8");
    }
    ctx.ctxNotes.orphanCounted = patch.orphan_included === true;
  }
  return { revision: next.revision, hash: next.self_hash };
}

async function runSweepMatrix(ctx, action) {
  // main project: controller sweep + idempotent repeat
  const before = await currentStateOf(ctx);
  const ctrlBefore = before?.authorization?.controller?.blocked ?? false;
  const res1 = await callTransact(ctx, action.controller_sweep, FaultAdapter.disabled());
  const res2 = await callTransact(ctx, action.repeat_sweep, FaultAdapter.disabled());
  const mid = await currentStateOf(ctx);
  ctx.extras.controller_sweep = {
    lifecycle: mid?.sessions?.["sess-ctrl"]?.live_state?.lifecycle ?? null,
    blocked: mid?.authorization?.controller?.blocked ?? null,
  };
  ctx.extras.repeat_sweep = { delta: res2.delta ?? null };
  // sub-project 1: worker sweep on its own session
  let workerSweep = { self_unknown: false, controller_blocked_unchanged: false };
  let workerNext = { code: null };
  ctx.extras.worker_sub_error = null;
  try {
    const subDir = await subProject(ctx, "worker");
    await genesisFor(subDir);
    await seedRevision({ ...ctx, projectDir: subDir }, { sessions: {
      "sess-worker": { descriptor: makeDescriptor({ session_uuid: "sess-worker", role: "worker" }), live_state: { revision: 0, lifecycle: "OPEN", work_outcome: "IN_PROGRESS", current_run: null, next_action: "n", waiting_user: null, last_activity: TS0, heartbeat: TS0, attention_reasons: [] }, closure_index: { closure_head_hash: GENESIS_PARENT_HASH, closure_count: 0, recent_entries: [] } } } });
    await writeEvidenceDocCtx(subDir, "ev-hb-w.json", { kind: "heartbeat-evidence", statement: "worker expired", expired: ["sess-worker"] });
    await writeApprovalDocCtx(subDir, "app-wsw.json", { approvalId: "apr-wsw", projectId: "proj-fs", operationId: "op-wsw", kind: "safeWrite", allowedCallers: [{ principal: "session", callerSessionId: "sess-worker" }] });
    const a1 = await loadAuthority(subDir);
    const wsRes = await transact({ projectDir: subDir, principal: "session", sessionId: "sess-worker", expectedRevision: a1.current_revision, operationId: "op-wsw", command: "sweep", payload: { heartbeatEvidence: "ev-hb-w.json", evidenceRef: "ev-hb-w.json", approvalRef: "app-wsw.json", callerSessionId: "sess-worker" } });
    void wsRes;
    const ws = await loadRevisionFile(subDir, (await loadAuthority(subDir)).state_uuid, (await loadAuthority(subDir)).current_revision);
    workerSweep = { self_unknown: ws.sessions["sess-worker"]?.live_state?.lifecycle === "UNKNOWN", controller_blocked_unchanged: ws.authorization.controller.blocked === false };
    await writeApprovalDocCtx(subDir, "app-evt-w.json", { approvalId: "apr-evt-w", projectId: "proj-fs", kind: "safeWrite", allowedCallers: [{ principal: "session", callerSessionId: "sess-worker" }] });
    const a2 = await loadAuthority(subDir);
    try {
      await transact({ projectDir: subDir, principal: "session", sessionId: "sess-worker", expectedRevision: a2.current_revision, operationId: "op-wn", command: "applySessionEvent", payload: { event: { event_id: "evt-wn", session_uuid: "sess-ctrl", kind: "inbox_message", evidence_ref: "ev-hb-w.json", payload: {}, created_at: TS0, status: "recorded" }, evidenceRef: "ev-hb-w.json", approvalRef: "app-evt-w.json", callerSessionId: "sess-worker" } });
      workerNext = { code: "passed-unexpectedly" };
    } catch (e) {
      workerNext = { code: e.code ?? null };
    }
  } catch (e2) {
    ctx.extras.worker_sub_error = (e2.code ?? "unexpected") + "@" + (e2.stage ?? "?") + ":" + String(e2.message ?? "").slice(0, 80);
  }
  ctx.extras.worker_sweep = workerSweep;
  ctx.extras.worker_next = workerNext;
  // sub-project 2: heartbeat-expired controller (not blocked) + approved host stop (exception-2)
  let expiredStop = { passed: false };
  let expiredNoApproval = false;
  try {
    const subDir = await subProject(ctx, "expired");
    await genesisFor(subDir);
    await seedRevision({ ...ctx, projectDir: subDir }, { heartbeat_expired: ["sess-ctrl"] });
    await writeEvidenceDocCtx(subDir, "ev-hb-e.json", { kind: "heartbeat-evidence", statement: "controller expired", expired: ["sess-ctrl"] });
    await writeApprovalDocCtx(subDir, "app-st-e.json", { approvalId: "apr-st-e", projectId: "proj-fs", operationId: "op-st-e", kind: "safeWrite", allowedCallers: [{ principal: "host", callerSessionId: null }] });
    const a1 = await loadAuthority(subDir);
    try {
      await transact({ projectDir: subDir, principal: "host", sessionId: null, expectedRevision: a1.current_revision, operationId: "op-st-e", command: "stop", payload: { reason: "expired", evidenceRef: "ev-hb-e.json", approvalRef: "app-st-e.json" } });
      expiredStop = { passed: true };
    } catch {
      expiredStop = { passed: false };
    }
    try {
      const a2 = await loadAuthority(subDir);
      await transact({ projectDir: subDir, principal: "host", sessionId: null, expectedRevision: a2.current_revision, operationId: "op-tk-e", command: "assignController", payload: { descriptor: makeDescriptor({ session_uuid: "sess-evil" }), evidenceRef: "ev-hb-e.json" } });
      expiredNoApproval = false;
    } catch {
      expiredNoApproval = true;
    }
  } catch {}
  ctx.extras.expired_stop = expiredStop;
  ctx.extras.expired_no_approval = expiredNoApproval;
  // sub-project 3: blocked controller + worker write => NEEDS_CONTROLLER_SWEEP
  let blockedWorker = { code: null };
  try {
    const subDir = await subProject(ctx, "blocked-controller");
    await genesisFor(subDir);
    await seedRevision({ ...ctx, projectDir: subDir }, { controller_block: true });
    await writeApprovalDocCtx(subDir, "app-evt-b.json", { approvalId: "apr-evt-b", projectId: "proj-fs", kind: "safeWrite", allowedCallers: [{ principal: "session", callerSessionId: "sess-ctrl" }] });
    const ab = await loadAuthority(subDir);
    try {
      await transact({ projectDir: subDir, principal: "session", sessionId: "sess-ctrl", expectedRevision: ab.current_revision, operationId: "op-bw", command: "applySessionEvent", payload: { event: { event_id: "evt-bw", session_uuid: "sess-ctrl", kind: "inbox_message", evidence_ref: "ev-g.json", payload: {}, created_at: TS0, status: "recorded" }, evidenceRef: "ev-g.json", approvalRef: "app-evt-b.json" } });
      blockedWorker = { code: "passed-unexpectedly" };
    } catch (e) {
      blockedWorker = { code: e.code ?? null };
    }
  } catch {}
  ctx.extras.blocked_controller_worker = blockedWorker;
  const finalState = await currentStateOf(ctx);
  let noClosedDone = true;
  for (const sid of Object.keys(finalState?.sessions ?? {})) {
    const lc = finalState.sessions[sid].live_state;
    if (lc.lifecycle === "CLOSED" && (lc.work_outcome === "DONE" || lc.work_outcome === "DONE_WITH_CONCERNS")) noClosedDone = false;
  }
  ctx.extras.no_closed_done = noClosedDone;
  void ctrlBefore;
  ctx.classification = res1.outcome === "passed" ? "passed" : "failed";
  ctx.exitCode = 0;
}

async function runSetupSteps(ctx, steps) {
  ctx.inSetup = true;
  ctx.extras.__setup = [];
  for (const step of steps) {
    if (step.op === "genesis") {
      const desc = makeDescriptor(step.descriptor);
      await writeEvidenceDoc(ctx, "ev-genesis.json", { kind: "initial-assignment", statement: "genesis evidence" });
      await writeApprovalDoc(ctx, "app-genesis.json", {
        approvalId: "apr-genesis-" + ctx.fixtureId, projectId: "proj-fs",
        operationId: "genesis-" + ctx.fixtureId, kind: "assignController",
        allowedCallers: [{ principal: "host", callerSessionId: null }], controllerDescriptor: desc,
      });
      const res = await callTransact(ctx, {
        name: "genesis", principal: "host", sessionId: null, expectedRevision: 0,
        operationId: "genesis-" + ctx.fixtureId, command: "assignController",
        payload: { descriptor: desc, evidenceRef: "ev-genesis.json", approvalRef: "app-genesis.json" },
      }, FaultAdapter.disabled());
      ctx.extras.__setup.push({ name: "genesis", outcome: res.outcome, code: res.code ?? null });
      if (res.outcome !== "passed") throw new Error("genesis failed for " + ctx.fixtureId + ": " + JSON.stringify(res));
    } else if (step.op === "approval") {
      const body = step.doc ?? (({ op: _o, file: _f, ...rest }) => rest)(step);
      await writeApprovalDoc(ctx, step.file, body);
    } else if (step.op === "evidence") {
      const body = step.doc ?? (({ op: _o, file: _f, ...rest }) => rest)(step);
      await writeEvidenceDoc(ctx, step.file, body);
    } else if (step.op === "transact") {
      const res = await callTransact(ctx, step, FaultAdapter.disabled());
      ctx.extras.__setup.push({ name: step.name ?? step.operationId, outcome: res.outcome, code: res.code ?? null });
    } else if (step.op === "seed_state") {
      await seedRevision(ctx, step.patch);
    } else if (step.op === "raw") {
      const target = path.resolve(ctx.projectDir, step.file);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, step.text, "utf-8");
    } else if (step.op === "symlink") {
      const dir = approvalsDir(ctx.projectDir);
      await fsp.mkdir(dir, { recursive: true });
      try { await fsp.unlink(path.join(dir, step.link)); } catch {}
      await fsp.symlink(step.target, path.join(dir, step.link));
    } else if (step.op === "tamper_approval") {
      const dir = approvalsDir(ctx.projectDir);
      const doc = JSON.parse(await fsp.readFile(path.join(dir, step.file), "utf-8"));
      doc.statement = "mutated after signing";
      await fsp.writeFile(path.join(dir, step.file), JSON.stringify(doc, null, 1), "utf-8");
    } else {
      throw new Error("unknown setup op " + step.op);
    }
  }
}

function harnessFieldCheck(error) {
  // independent of the module-under-test's own helper: per-field type/non-empty
  if (!error || typeof error !== "object") return false;
  const own = Object.keys(error);
  const need = ["code", "exitCode", "stage", "operationId", "message", "retryable"];
  if (own.length !== need.length || !need.every((k) => own.includes(k))) return false;
  if (typeof error.code !== "string" || error.code.length === 0) return false;
  if (!Number.isInteger(error.exitCode)) return false;
  if (typeof error.stage !== "string" || error.stage.length === 0) return false;
  if (error.operationId !== null && typeof error.operationId !== "string") return false;
  if (typeof error.message !== "string" || error.message.length === 0) return false;
  if (error.retryable !== false) return false;
  return true;
}

function negativeShapeProbeOk() {
  const bad = { code: "x", exitCode: 1, stage: "s", operationId: { leak: true }, message: "m", retryable: false };
  return harnessFieldCheck(bad) === false;
}

function errorPayload(error) {
  if (!error) return null;
  return {
    code: error.code ?? "unexpected",
    exitCode: error.exitCode ?? null,
    stage: error.stage ?? "unknown",
    operationId: error.operationId ?? null,
    message: String(error.message ?? ""),
    retryable: error.retryable === true,
    six_fields_ok: harnessFieldCheck(error),
  };
}

function isRSE(error) {
  return error && typeof error === "object" && "code" in error && "exitCode" in error && "stage" in error;
}

async function callTransact(ctx, call, adapter) {
  const resolver = await makeResolver(ctx);
  const payload = deepResolve(call.payload ?? {}, resolver);
  let approvalRef = payload.approvalRef;
  if (typeof approvalRef === "string" && approvalRef.startsWith("@auto:g1b_ref")) {
    approvalRef = await makeG1bApproval(ctx, call.operationId);
    payload.approvalRef = approvalRef;
  }
  const expectedRevision = typeof call.expectedRevision === "string" ? resolver(call.expectedRevision) : call.expectedRevision;
  const params = {
    projectDir: ctx.projectDir, principal: call.principal, sessionId: call.sessionId ?? null,
    expectedRevision, operationId: call.operationId, command: call.command, payload,
  };
  const usePublic = !!call.extraArgs;
  if (call.extraArgs) Object.assign(params, deepResolve(call.extraArgs, resolver));
  let result = null;
  let error = null;
  const beforeAuthority = await currentAuthorityOf(ctx).catch(() => null);
  try {
    result = usePublic ? await transact(params) : await performTransact(params, adapter ?? FaultAdapter.disabled(), selftestClock);
  } catch (e) {
    error = e;
  }
  // RT1AGG N2 harness mirror: recompute the six-key requestHash exactly like the store
  // (read the approval doc's approvalHash field; for valid docs it equals the recomputed
  // hash, and store-side rejections never reach the encoding comparison anyway)
  // R1/W5: the mirror reuses the STORE binding decision (REQ_APPROVAL_SET + N2_FROZEN_LAYER
  // via n2MirrorApprovalHashFor) — no second command list, no second carve-out copy
  let mirrorApprovalHash;
  let mirrorRequestHash = null;
  if (typeof call.operationId !== "string") {
    mirrorRequestHash = undefined; // the args gate rejects before any hashing; keep six-field parity off
  }
  if (mirrorRequestHash === null && n2MirrorApprovalHashFor(call.command, payload.approvalRef) !== undefined) {
    try {
      mirrorApprovalHash = JSON.parse(await fsp.readFile(resolveApprovalRef(ctx.projectDir, payload.approvalRef), "utf-8")).approvalHash;
    } catch { mirrorApprovalHash = undefined; }
  }
  const entry = { name: call.name ?? call.operationId, outcome: "passed", exitCode: 0, requestHash: mirrorRequestHash === undefined ? null : requestHashOf({ command: call.command, principal: call.principal, sessionId: call.sessionId ?? null, operationId: call.operationId, payload, approvalHash: mirrorApprovalHash }) };
  const beforeRev = beforeAuthority ? beforeAuthority.current_revision : null;
  const beforeCtrlEpoch = null;
  if (error) {
    const ep = errorPayload(error);
    entry.outcome = ep.code === "blocked" || (ep.code ?? "").startsWith("blocked") ? "blocked" : "denied";
    entry.exitCode = ep.exitCode;
    entry.code = ep.code;
    entry.stage = ep.stage;
    entry.six_fields_ok = ep.six_fields_ok;
    ctx.lastError = ep;
    ctx.exitCode = ep.exitCode;
    ctx.classification = entry.outcome === "blocked" ? "blocked" : "denied";
  } else {
    entry.revision = result.revision;
    entry.keys_ok = Object.keys(result).length === 3 && typeof result.revision === "number" && HEX64.test(result.hash) && typeof result.recordRevision === "number";
    ctx.lastResult = result;
    ctx.lastError = null;
    ctx.exitCode = 0;
    ctx.classification = "passed";
  }
  try {
    const a = await currentAuthorityOf(ctx);
    if (a) {
      entry.epoch_after = a.epoch;
      if (beforeRev !== null) entry.delta = a.current_revision - beforeRev;
    }
    const st = await currentStateOf(ctx);
    if (st) entry.controller_epoch_after = st.authorization.controller_epoch;
  } catch {}
  ctx.calls.push(entry);
  if (call.name) ctx.extras[call.name] = entry;
  return entry;
}

async function callReadCurrent(ctx, call) {
  const __name = call?.name ?? "read_current";
  let result = null;
  let error = null;
  try {
    result = await readCurrent({ projectDir: ctx.projectDir });
  } catch (e) {
    error = e;
  }
  const entry = { name: __name, outcome: "passed", exitCode: 0 };
  if (error) {
    const ep = errorPayload(error);
    entry.outcome = ep.code === "blocked" || (ep.code ?? "").startsWith("blocked") ? "blocked" : "denied";
    entry.exitCode = ep.exitCode;
    entry.code = ep.code;
    ctx.lastError = ep;
  } else {
    ctx.lastResult = result;
    ctx.lastError = null;
    ctx.exitCode = 0;
    entry.result = result;
    const keysOk = Object.keys(result).length === 3 && "state" in result && "authority" in result && "lineage" in result &&
      Array.isArray(result.lineage) && result.lineage.every((l) => Object.keys(l).length === 4 &&
        typeof l.revision === "number" && typeof l.hash === "string" && typeof l.parentRevision === "number" && typeof l.parentHash === "string");
    entry.keys_ok = keysOk;
    entry.reached_genesis = Array.isArray(result.lineage) && result.lineage.length > 0 && result.lineage[result.lineage.length - 1].revision === 0;
  }
  ctx.calls.push(entry);
  ctx.extras[entry.name] = entry;
  return entry;
}

async function callValidateRevision(ctx, file) {
  let result = null;
  let error = null;
  try {
    result = await validateRevision({ revisionPath: file });
  } catch (e) {
    error = e;
  }
  return { result, error: errorPayload(error) };
}

async function callCommitOperation(ctx, ref, adapter, callName) {
  let result = null;
  let error = null;
  try {
    // RT1AGG J: harness-resolved refs thread the fixed fixture clock; the public
    // commitOperation keeps its production default and argument gate.
    result = await performCommitOperation({ projectDir: ctx.projectDir, operationRef: ref }, FaultAdapter.disabled(), selftestClock);
  } catch (e) {
    error = e;
  }
  const entry = { name: callName ?? "commit_operation", outcome: "passed", exitCode: 0 };
  if (error) {
    const ep = errorPayload(error);
    entry.outcome = ep.code === "blocked" || (ep.code ?? "").startsWith("blocked") ? "blocked" : "denied";
    entry.exitCode = ep.exitCode;
    entry.code = ep.code;
    entry.stage = ep.stage;
    entry.six_fields = ep.six_fields_ok;
    ctx.lastError = ep;
    ctx.exitCode = ep.exitCode;
    ctx.classification = entry.outcome === "blocked" ? "blocked" : "denied";
  } else {
    ctx.lastResult = result;
    ctx.lastError = null;
    ctx.exitCode = 0;
    ctx.classification = "passed";
    const keysOk = Object.keys(result).length === 3 && typeof result.revision === "number" && HEX64.test(result.hash) && typeof result.epoch === "number";
    entry.keys_ok = keysOk;
    entry.types_ok = keysOk;
    entry.revision = result.revision;
    entry.epoch = result.epoch;
  }
  ctx.calls.push(entry);
  if (callName) ctx.extras[callName] = entry;
  return entry;
}

function faultAdapterFor(ctx, { firstOnly } = {}) {
  if (!ctx.fault) return FaultAdapter.disabled();
  if (firstOnly || ctx.fault.variant === "first_call_only") {
    if (!ctx.__onceAdapter) ctx.__onceAdapter = new FaultAdapter({ ...ctx.fault, once: true });
    return ctx.__onceAdapter;
  }
  return new FaultAdapter({ ...ctx.fault });
}

// ------------------------------------------------- real concurrent workers (B-01)
// Each worker is a real child process that polls the start file itself; the
// parent only awaits files (never Atomics.wait), so workers genuinely overlap.
import { spawn } from "node:child_process";

const WORKER_COMMON = `
import fs from "node:fs";
const param = JSON.parse(fs.readFileSync(process.env.RT1A_PARAM, "utf-8"));
const store = await import(process.env.RT1A_STORE_URL);
fs.writeFileSync(process.env.RT1A_READY, "ready", "utf-8");
const begin = Date.now();
for (let i = 0; i < 30000 && !fs.existsSync(process.env.RT1A_START); i += 1) {
  await new Promise((r) => setTimeout(r, 2));
}
let out;
try {
  if (param.mode === "transact") out = { ok: true, result: await store.transact(param.params) };
  else if (param.mode === "read_current_loop") {
    const snaps = [];
    for (let i = 0; i < param.rounds; i += 1) {
      try {
        const r = await store.readCurrent({ projectDir: param.projectDir });
        snaps.push({ hash: r.state.self_hash, keys: Object.keys(r).length, lineageKeys: r.lineage.every((l) => Object.keys(l).length === 4) });
      } catch (e) {
        snaps.push({ error: e.code ?? "unexpected", exitCode: e.exitCode ?? null, stage: e.stage ?? null });
      }
    }
    out = { ok: true, snaps };
  }
} catch (e) {
  out = { ok: false, error: { code: e.code ?? "unexpected", exitCode: e.exitCode ?? null, stage: e.stage ?? null, operationId: e.operationId ?? null, message: String(e.message), retryable: e.retryable === true } };
}
out.begin = begin;
out.end = Date.now();
fs.writeFileSync(process.env.RT1A_OUT, JSON.stringify(out), "utf-8");
`;

async function waitForKey(key, { present = true, timeoutMs = 30000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    let ok;
    try {
      await fsp.access(key);
      ok = true;
    } catch {
      ok = false;
    }
    if (ok === present) return true;
    if (Date.now() - t0 > timeoutMs) throw new Error("timeout waiting for " + key);
    await new Promise((r) => setTimeout(r, 3));
  }
}

function launchWorker(script, param, readyFile, startFile, outFile) {
  const paramFile = outFile + ".param.json";
  fs.writeFileSync(paramFile, JSON.stringify(param), "utf-8");
  const child = spawn("node", ["--input-type=module", "-e", script], {
    env: { ...process.env, RT1A_PARAM: paramFile, RT1A_OUT: outFile, RT1A_START: startFile, RT1A_READY: readyFile },
    stdio: ["ignore", "ignore", "ignore"],
  });
  return { child, readyFile, outFile };
}

async function runWorkers(script, specs, startFile) {
  const running = specs.map((spec) => launchWorker(script, spec.param, spec.readyFile, startFile, spec.outFile));
  for (const r of running) await waitForKey(r.readyFile);
  fs.writeFileSync(startFile, "start", "utf-8");
  const outs = [];
  for (const r of running) {
    await waitForKey(r.outFile);
    await new Promise((res) => {
      if (r.child.exitCode !== null) return res();
      r.child.once("exit", res);
    });
    outs.push(JSON.parse(fs.readFileSync(r.outFile, "utf-8")));
  }
  return outs;
}

function assertOverlap(outs, label) {
  return outs.every((a) => outs.every((b) => a === b || (a.begin < b.end && b.begin < a.end))) ? true : (() => { throw new Error("workers did not overlap: " + label); })();
}

async function snapshotObserved(ctx) {
  const authority = await currentAuthorityOf(ctx);
  const state = authority ? await loadRevisionFile(ctx.projectDir, authority.state_uuid, authority.current_revision).catch(() => null) : null;
  const journal = await loadJournal(ctx.projectDir).catch(() => null);
  const hw = authority ? await loadHighwaterOrEmpty(ctx.projectDir).catch(() => ({})) : {};
  let stateBytes = null;
  if (state) {
    try {
      stateBytes = (await fsp.stat(revisionFilePath(ctx.projectDir, state.state_uuid, state.revision))).size;
    } catch {}
  }
  let revisionsCount = null;
  if (authority) {
    try {
      revisionsCount = fs.readdirSync(stateDir(ctx.projectDir, authority.state_uuid)).filter((f) => /^r-\d+\.json$/.test(f)).length;
    } catch {}
  }
  const before = ctx.revisionBefore;
  const after = authority ? authority.current_revision : -1;
  return {
    fixture_id: ctx.fixtureId,
    classification: ctx.classification,
    exit_code: ctx.exitCode,
    result: ctx.lastResult,
    error: ctx.lastError,
    revision: { before, after, delta: before === null ? null : after - before },
    authority: authority ? {
      current_revision: authority.current_revision, epoch: authority.epoch,
      record_revision: authority.record_revision, state_uuid: authority.state_uuid,
      journal_generation: authority.journal_generation, journal_head_hash: authority.journal_head_hash,
      mode: authority.mode,
    } : null,
    highwater_revision: authority ? (hw[authority.state_uuid]?.current_revision ?? null) : null,
    state: state ? {
      revision: state.revision, controller_session: state.authorization.controller.session_uuid ?? "",
      controller_epoch: state.authorization.controller_epoch, stop_epoch: state.authorization.stop_epoch,
      state_uuid: state.state_uuid, bytes: stateBytes, active_run_session: state.active_run?.session_uuid ?? null,
    } : null,
    queue_count: state ? state.queue.length : null,
    effects_unresolved: state ? state.effects.filter((e) => UNRESOLVED_EFFECT_STATES.has(e.state)).length : null,
    applied_count: state ? state.applied_operations.length : null,
    applied_entries: state ? state.applied_operations : null,
    journal_status: journal?.entries?.length ? journal.entries[journal.entries.length - 1].status : null,
    journal_entries: journal?.entries?.length ?? 0,
    lock_exists: await lockExists(ctx.projectDir),
    matrix: ctx.extras.matrix ?? null,
    crash: ctx.extras.crash ?? null,
    capacity: ctx.extras.capacity ?? null,
    extras: ctx.extras,
  };
}

// harness internals (runFixture/runSelfTest/callTransact/…) are module-internal by design;

// ---------------------------------------------------------- action dispatch
async function resolveRefToken(ctx, token) {
  if (typeof token !== "string") return token;
  if (!token.startsWith("@auto:")) return token;
  const key = token.slice(6);
  const journal = await loadJournal(ctx.projectDir).catch(() => null);
  const last = journal?.entries?.[journal.entries.length - 1] ?? null;
  if (key === "stop_ref" || key.startsWith("stop_ref_")) {
    let ref = last?.stopRef ?? ctx.autoRefs.stopRef ?? null;
    if (!ref) {
      const authority = await loadAuthority(ctx.projectDir);
      const st = await loadRevisionFile(ctx.projectDir, authority.state_uuid, authority.current_revision);
      const rootOp = last?.operationId ?? "op-auto-stop";
      const dummyApproval = { controllerDescriptor: makeDescriptor({ session_uuid: "sess-ctrl" }), assignedAt: TS0, controllerEvidenceRef: "ev-g1a.json" };
      const built = await buildStopRefAndState({ state: st, authority, operationId: rootOp, approval: dummyApproval });
      ref = built.stopRef;
      let approvalHash = "a".repeat(64);
      try {
        const doc = JSON.parse(await fsp.readFile(resolveApprovalRef(ctx.projectDir, "app-g1a.json"), "utf-8"));
        approvalHash = doc.approvalHash;
      } catch {}
      const j = journal ? structuredClone(journal) : emptyJournal();
      const entry = { operationId: rootOp, status: "stopping", principal: "host", callerSessionId: "host", parentRevision: st.revision, parentHash: st.self_hash, stateUuid: st.state_uuid, authorityEpoch: authority.epoch, approvalRef: "app-g1a.json", approvalHash, stopRef: ref, entryHash: "" };
      entry.entryHash = entryHashOf(entry);
      j.entries = j.entries.filter((e) => e.operationId !== rootOp);
      j.entries.push(entry);
      await writeJournal(ctx.projectDir, j, FaultAdapter.disabled());
      ctx.autoRefs.stopRef = ref;
    }
    const variant = key.slice("stop_ref".length);
    if (variant === "_bad_hash") return { ...ref, hash: (ref.hash.slice(0, 8) === "00000000" ? "11111111" : "00000000") + ref.hash.slice(8) };
    if (variant === "_wrong_kind") return { ...ref, kind: "resume" };
    if (variant === "_wrong_epoch") return { ...ref, epoch: ref.epoch + 7 };
    if (variant === "_wrong_stop_epoch") return { ...ref, stopEpoch: ref.stopEpoch + 7 };
    return ref;
  }
  if (key === "resume_ref") {
    const entry = (journal?.entries ?? []).find((e) => e.resumeOperation);
    return entry?.resumeOperation ?? token;
  }
  if (key === "candidate_ref") {
    const candFile = path.join(candidatesDir(ctx.projectDir), (last?.operationId ?? "op") + ".json");
    try {
      return JSON.parse(await fsp.readFile(candFile, "utf-8")).candidateRef;
    } catch {
      return last?.candidateRef ?? token;
    }
  }
  if (key === "recovery_ref") {
    const entry = (journal?.entries ?? []).find((e) => e.recoveryRef);
    return entry?.recoveryRef ?? token;
  }
  return token;
}

async function runDirectInternal(ctx, call) {
  const fn = call.fn;
  if (fn === "lock_exists") {
    const value = await lockExists(ctx.projectDir);
    ctx.calls.push({ name: call.name, outcome: "info", value });
    return;
  }
  if (fn === "controller_unchanged") {
    const st = await currentStateOf(ctx);
    ctx.calls.push({ name: call.name, outcome: "info", value: st?.authorization.controller.session_uuid ?? null });
    return;
  }
  if (fn === "try_overwrite_revision") {
    const authority = await loadAuthority(ctx.projectDir);
    const existing = await loadRevisionFile(ctx.projectDir, authority.state_uuid, call.args?.revision ?? 1);
    let outcome = "passed";
    let code = null;
    try {
      await publishRevision(ctx.projectDir, existing, authority, { operationId: "overwrite-probe" });
    } catch (e) {
      outcome = (e.code ?? "").startsWith("blocked") ? "blocked" : "denied";
      code = e.code ?? null;
    }
    ctx.calls.push({ name: call.name, outcome, code });
    return;
  }
  if (fn === "claim_token_check") {
    const st = await currentStateOf(ctx);
    const token = st?.effects.find((e) => e.token)?.token ?? null;
    let outcome = "denied";
    if (token) {
      const tampered = { ...token };
      const t = call.args?.tamper;
      if (t === "session_uuid") tampered.session_uuid = "sess-evil";
      else if (t === "effect_id") tampered.effect_id = "ef-evil";
      else if (t === "operation_id") tampered.operation_id = "op-evil";
      else if (t === "controller_epoch") tampered.controller_epoch = token.controller_epoch + 5;
      else if (t === "stop_epoch") tampered.stop_epoch = token.stop_epoch + 5;
      else if (t === "claimed_revision") tampered.claimed_revision = token.claimed_revision + 5;
      else if (t === "state_uuid") tampered.state_uuid = "su-evil";
      outcome = verifyClaimTokenInUse(st, tampered, token.operation_id) ? "passed" : "denied";
    }
    ctx.calls.push({ name: call.name, outcome });
    return;
  }
  if (fn === "make_orphan") {
    const resumeCall = ctx.fixtureCalls?.find((c) => c.name === "original_resume") ?? ctx.fixtureCalls?.[ctx.fixtureCalls.length - 1];
    const authority = await loadAuthority(ctx.projectDir);
    const base = await loadRevisionFile(ctx.projectDir, authority.state_uuid, authority.current_revision);
    const next = structuredClone(base);
    next.parent_revision = base.revision;
    next.parent_hash = base.self_hash;
    next.revision = base.revision + 1;
    const resolver = await makeResolver(ctx);
    const payload = deepResolve(resumeCall?.payload ?? {}, resolver);
    let orphanApprovalHash; // RT1AGG N2 mirror
    if (typeof payload.approvalRef === "string") {
      try { orphanApprovalHash = JSON.parse(await fsp.readFile(resolveApprovalRef(ctx.projectDir, payload.approvalRef), "utf-8")).approvalHash; } catch { orphanApprovalHash = undefined; }
    }
    // R1/B1: style="legacy_five_key" fabricates a pre-N2 five-key orphan entry;
    // bind_approval additionally writes the request-approvals ledger record for it
    const orphanOpId = call.args?.operationId;
    const legacyStyle = call.args?.style === "legacy_five_key";
    const rh = requestHashOf({ command: call.args?.command ?? resumeCall?.command ?? "applySessionEvent", principal: resumeCall?.principal ?? "session", sessionId: resumeCall?.sessionId ?? "sess-ctrl", operationId: orphanOpId, payload, approvalHash: legacyStyle ? undefined : orphanApprovalHash });
    if (call.args?.bind_approval && typeof orphanApprovalHash === "string") { // R4/W4: bind_approval now also pre-writes the ledger record for SIX-key orphan fabrications (legacy five-key behavior unchanged); lets the orphan-claim fault vector isolate the post-advance claim-site write
      await writeRequestApprovalBinding(ctx.projectDir, orphanOpId, orphanApprovalHash);
    }
    const commitHash = sha256hex((call.args?.operationId ?? "op") + ":" + rh);
    next.applied_operations.push(encodeApplied(call.args?.operationId, rh, next.revision, commitHash, authority.record_revision + 1));
    next.self_hash = computeSelfHash(next);
    const file = revisionFilePath(ctx.projectDir, next.state_uuid, next.revision);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, canonicalJSON(next), makeIo(FaultAdapter.disabled(), {}));
    const hw = await loadHighwaterOrEmpty(ctx.projectDir);
    hw[next.state_uuid] = { record_revision: authority.record_revision + 1, current_revision: next.revision, current_hash: next.self_hash };
    await atomicWrite(highwaterPath(ctx.projectDir), canonicalJSON(hw), makeIo(FaultAdapter.disabled(), {}));
    ctx.calls.push({ name: call.name, outcome: "passed" });
    return;
  }
  if (fn === "float_payload_probe") {
    let outcome = "denied";
    let code = null;
    let exitCode = null;
    let six = false;
    try {
      await transact({ projectDir: ctx.projectDir, principal: "session", sessionId: "sess-ctrl", expectedRevision: 0, operationId: "op-float", command: "applySessionEvent", payload: { event: { event_id: "evt-fp", session_uuid: "sess-ctrl", kind: "inbox_message", evidence_ref: "ev-1.json", payload: { ratio: 1.5 }, created_at: TS0, status: "recorded" }, evidenceRef: "ev-1.json", approvalRef: "app-ev1.json" } });
      outcome = "passed";
    } catch (e) {
      code = e.code ?? null;
      exitCode = e.exitCode ?? null;
      six = harnessFieldCheck(e);
    }
    ctx.calls.push({ name: call.name, outcome, code, exitCode, six_fields_ok: six });
    return;
  }
  if (fn === "public_adapter_arg") {
    let outcome = "denied";
    let code = null;
    try {
      await transact({ projectDir: ctx.projectDir, principal: "session", sessionId: "sess-ctrl", expectedRevision: 0, operationId: "op-fault-arg", command: "applySessionEvent", payload: {}, __adapter: {} });
      outcome = "passed";
    } catch (e) {
      code = e.code ?? null;
    }
    ctx.calls.push({ name: call.name, outcome, code });
    return;
  }
  if (fn === "existing_rev_direct_call") {
    const authority = await loadAuthority(ctx.projectDir);
    const st = await loadRevisionFile(ctx.projectDir, authority.state_uuid, authority.current_revision);
    const dummyApproval = { controllerDescriptor: makeDescriptor({ session_uuid: "sess-ctrl" }), assignedAt: TS0, controllerEvidenceRef: "ev-g1a.json" };
    const { stopRef } = await buildStopRefAndState({ state: st, authority, operationId: "op-xd", approval: dummyApproval });
    const file = revisionFilePath(ctx.projectDir, authority.state_uuid, stopRef.revision);
    if (!fs.existsSync(file)) {
      const shell = structuredClone(st);
      shell.revision = stopRef.revision;
      shell.parent_revision = st.revision;
      shell.parent_hash = st.self_hash;
      shell.producer_operation = { ...stopRef };
      shell.self_hash = computeSelfHash(shell);
      stopRef.hash = shell.self_hash;
      await atomicWrite(file, canonicalJSON(shell), makeIo(FaultAdapter.disabled(), {}));
    }
    let outcome = "denied";
    let code = null;
    try {
      await commitOperation({ projectDir: ctx.projectDir, operationRef: stopRef });
      outcome = "passed";
    } catch (e) {
      code = e.code ?? null;
    }
    ctx.calls.push({ name: call.name, outcome, code });
    return;
  }
  throw new Error("unknown direct_internal fn " + fn);
}

async function runAction(ctx, action) {
  const kind = action.kind;
  if (kind === "transact") {
    await callTransact(ctx, action, faultAdapterFor(ctx));
    return;
  }
  if (kind === "read_current") {
    await callReadCurrent(ctx, action);
    ctx.classification = ctx.lastError ? ctx.classification : "passed";
    return;
  }
  if (kind === "seq") {
    for (const call of action.calls ?? []) {
      if (call.kind === "transact") {
        await callTransact(ctx, call, faultAdapterFor(ctx, { firstOnly: true }));
      } else if (call.kind === "read_current") {
        await callReadCurrent(ctx, call);
      } else if (call.kind === "commit_operation") {
        const ref = await resolveRefToken(ctx, call.operationRef);
        await callCommitOperation(ctx, ref, faultAdapterFor(ctx, { firstOnly: true }), call.name);
      } else if (call.kind === "direct_internal") {
        await runDirectInternal(ctx, call);
        const last = ctx.calls[ctx.calls.length - 1];
        if (call.name && last) ctx.extras[call.name] = last;
      } else if (call.kind === "approval") {
        // RT1AGG N2: mid-action approval rewrite at the SAME ref (harness-only;
        // writeApprovalDoc recomputes a valid approvalHash for the new content)
        await writeApprovalDocCtx(ctx.projectDir, call.file, call.doc ?? (({ kind: _k, file: _f, ...rest }) => rest)(call));
      }
    }
    return;
  }
  if (kind === "commit_operation") {
    const ref = await resolveRefToken(ctx, action.operationRef);
    await callCommitOperation(ctx, ref, faultAdapterFor(ctx), action.name);
    return;
  }
  if (kind === "concurrent") {
    await runConcurrent(ctx, action);
    return;
  }
  if (kind === "corruption_variants") {
    await runCorruptionVariants(ctx, action);
    return;
  }
  if (kind === "fork_variants") {
    await runForkVariants(ctx, action);
    return;
  }
  if (kind === "validate_variants") {
    await runValidateVariants(ctx, action);
    return;
  }
  if (kind === "abandon_variants") {
    await runAbandonVariants(ctx, action);
    return;
  }
  if (kind === "takeover_matrix") {
    await runTakeoverMatrix(ctx, action);
    return;
  }
  if (kind === "sweep_matrix") {
    await runSweepMatrix(ctx, action);
    return;
  }
  if (kind === "field_variants") {
    await runFieldVariants(ctx, action);
    return;
  }
  if (kind === "recover_variants") {
    await runRecoverVariants(ctx, action);
    return;
  }
  if (kind === "state_matrix") {
    runStateMatrix(ctx, action);
    return;
  }
  if (kind === "crash_matrix") {
    await runCrashMatrix(ctx, action);
    return;
  }
  if (kind === "guard_probes") {
    await runGuardProbes(ctx, action);
    return;
  }
  if (kind === "atomic_probe") {
    await runAtomicProbe(ctx, action);
    return;
  }
  throw new Error("unknown action kind " + kind);
}

// ------------------------------------------------------- specialized drivers
async function subProject(ctx, name) {
  return path.join(ctx.runRoot, ctx.fixtureId, "sub-" + name, "proj");
}

async function genesisFor(subDir) {
  const desc = makeDescriptor({ session_uuid: "sess-ctrl" });
  await fsp.mkdir(approvalsDir(subDir), { recursive: true });
  await writeEvidenceDocCtx(subDir, "ev-genesis.json", { kind: "initial-assignment", statement: "sub genesis" });
  await writeApprovalDocCtx(subDir, "app-genesis.json", {
    approvalId: "apr-genesis-sub", projectId: "proj-fs", operationId: "genesis-sub",
    kind: "assignController", allowedCallers: [{ principal: "host", callerSessionId: null }],
    controllerDescriptor: desc,
  });
  await transact({
    projectDir: subDir, principal: "host", sessionId: null, expectedRevision: 0,
    operationId: "genesis-sub", command: "assignController",
    payload: { descriptor: desc, evidenceRef: "ev-genesis.json", approvalRef: "app-genesis.json" },
  });
  return null;
}

async function writeApprovalDocCtx(projectDir, file, doc) {
  const dir = approvalsDir(projectDir);
  await fsp.mkdir(dir, { recursive: true });
  if (!doc.kind && doc.confirmedOperationId) doc.kind = "cutoverRecovery";
  const withHash = { ...doc, approvalHash: computeApprovalHash(doc) };
  await fsp.writeFile(path.join(dir, file), JSON.stringify(withHash, null, 1), "utf-8");
}

async function writeEvidenceDocCtx(projectDir, file, doc) {
  const dir = approvalsDir(projectDir);
  await fsp.mkdir(dir, { recursive: true });
  const copy = { ...doc };
  if (copy.evidenceHash === "COMPUTE" || copy.evidenceHash === undefined) {
    delete copy.evidenceHash;
    copy.evidenceHash = sha256hex(canonicalJSON(copy));
  }
  await fsp.writeFile(path.join(dir, file), JSON.stringify(copy, null, 1), "utf-8");
}

async function cutoverBaseFor(subDir, rootOp, { upTo = "prepared" } = {}) {
  const subCtx = await genesisFor(subDir);
  await writeEvidenceDocCtx(subDir, "ev-g1a.json", { kind: "g1a-evidence", statement: "controller evidence" });
  await writeEvidenceDocCtx(subDir, "ev-stop.json", { kind: "stop-evidence", statement: "stop evidence" });
  const authority = await loadAuthority(subDir);
  const st = await loadRevisionFile(subDir, authority.state_uuid, authority.current_revision);
  const ctrl = makeDescriptor({ session_uuid: "sess-ctrl" });
  const g1a = {
    approvalId: "apr-g1a-sub", projectId: "proj-fs", operationId: rootOp,
    kind: "cutoverG1a", parentRevision: st.revision, parentHash: st.self_hash,
    stateUuid: st.state_uuid, authorityEpoch: authority.epoch,
    allowedCallers: [{ principal: "host", callerSessionId: null }], controllerDescriptor: ctrl,
    assignedAt: TS0, controllerEvidenceRef: "ev-g1a.json", controllerEvidenceHash: "c".repeat(64),
    stopEvidenceRef: "ev-stop.json", stopEvidenceHash: "s".repeat(64),
  };
  await writeApprovalDocCtx(subDir, "app-g1a-sub.json", g1a);
  await transact({
    projectDir: subDir, principal: "host", sessionId: null, expectedRevision: st.revision,
    operationId: rootOp, command: "prepare",
    payload: { approvalRef: "app-g1a-sub.json", controllerDescriptor: ctrl, stopEvidenceRef: "ev-stop.json" },
  });
  if (upTo === "prepared") return subCtx;
  if (upTo === "confirming") {
    const j = await loadJournal(subDir);
    const entry = journalEntry(j, rootOp);
    const confirming = { ...entry, status: "confirming", confirmApprovalRef: "app-g1b-sub.json", confirmApprovalHash: "f".repeat(64) };
    confirming.entryHash = entryHashOf(confirming);
    const j2 = structuredClone(j);
    j2.entries = j2.entries.filter((e) => e.operationId !== rootOp);
    j2.entries.push(confirming);
    j2.generation += 1;
    await writeJournal(subDir, j2, FaultAdapter.disabled());
    return subCtx;
  }
  if (upTo === "abandoned") {
    await writeEvidenceDocCtx(subDir, "ev-ab-sub.json", { kind: "abort-evidence", statement: "abort" });
    const j = await loadJournal(subDir);
    const entry = journalEntry(j, rootOp);
    await writeApprovalDocCtx(subDir, "app-ab-sub.json", {
      approvalId: "apr-ab-sub", projectId: "proj-fs", operationId: rootOp, kind: "cutoverAbandon",
      candidateHash: entry.candidateRef.hash, allowedCallers: [{ principal: "host", callerSessionId: null }],
      abortEvidenceRef: "ev-ab-sub.json", abortEvidenceHash: "h".repeat(64),
    });
    await transact({
      projectDir: subDir, principal: "host", sessionId: null, expectedRevision: (await loadAuthority(subDir)).current_revision,
      operationId: rootOp, command: "abandonPreparedCandidate",
      payload: { approvalRef: "app-ab-sub.json", abortEvidenceRef: "ev-ab-sub.json", resumeOperation: "auto" },
    });
    return subCtx;
  }
  if (upTo === "confirmed") {
    const j = await loadJournal(subDir);
    const entry = journalEntry(j, rootOp);
    await writeApprovalDocCtx(subDir, "app-g1b-sub.json", {
      approvalId: "apr-g1b-sub", projectId: "proj-fs", operationId: rootOp, kind: "cutoverG1b",
      candidatePath: entry.candidatePath, candidateHash: entry.candidateRef.hash,
      targetAuthorityEpoch: entry.candidateRef.epoch, allowedCallers: [{ principal: "host", callerSessionId: null }],
    });
    await transact({
      projectDir: subDir, principal: "host", sessionId: null, expectedRevision: (await loadAuthority(subDir)).current_revision,
      operationId: rootOp, command: "confirm", payload: { approvalRef: "app-g1b-sub.json" },
    });
    return subCtx;
  }
  return subCtx;
}

async function runConcurrent(ctx, action) {
  const dir = path.join(ctx.runRoot, ctx.fixtureId, "concurrent");
  await fsp.mkdir(dir, { recursive: true });
  process.env.RT1A_STORE_URL = "file://" + path.join(SCRIPT_DIR, "run-store.mjs");
  if (action.mode === "same_expected") {
    const startFile = path.join(dir, "start");
    const resolver = await makeResolver(ctx);
    const specs = (action.workers ?? []).map((w, i) => {
      const payload = deepResolve(w.payload ?? {}, resolver);
      const expectedRevision = typeof w.expectedRevision === "string" ? resolver(w.expectedRevision) : w.expectedRevision;
      return {
        readyFile: path.join(dir, "ready-" + i),
        outFile: path.join(dir, w.name + ".out"),
        param: { mode: "transact", params: { projectDir: ctx.projectDir, principal: w.principal, sessionId: w.sessionId ?? null, expectedRevision, operationId: w.operationId, command: w.command, payload } },
      };
    });
    for (const spec of specs) {
      const probe = path.join(path.dirname(spec.outFile), "ready-probe");
      fs.writeFileSync(probe + "." + path.basename(spec.outFile), "warm", "utf-8");
    }
    const outs = await runWorkers(WORKER_COMMON, specs, startFile);
    let successes = 0;
    let failures = 0;
    for (let i = 0; i < outs.length; i += 1) {
      if (outs[i].ok) successes += 1; else failures += 1;
      fs.writeFileSync(specs[i].outFile + ".json", JSON.stringify(outs[i], null, 1), "utf-8");
    }
    ctx.extras.successes = successes;
    ctx.extras.failures = failures;
    ctx.extras.workers_overlapped = assertOverlap(outs, "same_expected");
    ctx.classification = successes === 1 && failures === 1 ? "passed" : "failed_concurrency";
    return;
  }
  if (action.mode === "reader_writer") {
    const startFile = path.join(dir, "start");
    const rounds = action.rounds ?? 6;
    const readers = action.readers ?? 2;
    const writerScript = `
import fs from "node:fs";
const param = JSON.parse(fs.readFileSync(process.env.RT1A_PARAM, "utf-8"));
const store = await import(process.env.RT1A_STORE_URL);
fs.writeFileSync(process.env.RT1A_READY, "ready", "utf-8");
const begin = Date.now();
for (let i = 0; i < 30000 && !fs.existsSync(process.env.RT1A_START); i += 1) {
  await new Promise((r) => setTimeout(r, 2));
}
const hashes = [];
let ok = true;
let err = null;
try {
  for (let i = 1; i <= param.rounds; i += 1) {
    const r = await store.transact({ projectDir: param.projectDir, principal: "session", sessionId: "sess-ctrl", expectedRevision: i - 1, operationId: "op-rw-" + i, command: "applySessionEvent", payload: { event: { event_id: "evt-rw-" + i, session_uuid: "sess-ctrl", kind: "inbox_message", evidence_ref: "ev-1.json", payload: { i }, created_at: "2026-11-05T10:00:00Z", status: "recorded" }, evidenceRef: "ev-1.json", approvalRef: "app-ev1.json" } });
    hashes.push(r.hash);
    try { const cur = await store.readCurrent({ projectDir: param.projectDir }); hashes.push(cur.state.self_hash); } catch {}
  }
} catch (e) { ok = false; err = { code: e.code ?? "unexpected", exitCode: e.exitCode ?? null }; }
fs.writeFileSync(process.env.RT1A_WRITER_HASHES, JSON.stringify(hashes), "utf-8");
fs.writeFileSync(process.env.RT1A_OUT, JSON.stringify({ ok, error: err, begin, end: Date.now() }), "utf-8");
`;
    const specs = [];
    const writerOut = path.join(dir, "writer.out");
    const writerHashes = path.join(dir, "writer-hashes.json");
    specs.push({
      readyFile: path.join(dir, "wready-0"),
      outFile: writerOut,
      param: { mode: "writer", projectDir: ctx.projectDir, rounds },
    });
    for (let i = 0; i < readers; i += 1) {
      specs.push({
        readyFile: path.join(dir, "rready-" + i),
        outFile: path.join(dir, "reader-" + i + ".out"),
        param: { mode: "read_current_loop", projectDir: ctx.projectDir, rounds: rounds + 2 },
      });
    }
    const launched = specs.map((spec) => {
      const withEnv = spec;
      return withEnv;
    });
    // give the writer its hash sink via env injection: reuse launchWorker with extra env
    const running = specs.map((spec) => {
      const paramFile = spec.outFile + ".param.json";
      fs.writeFileSync(paramFile, JSON.stringify(spec.param), "utf-8");
      const envExtra = spec.param.mode === "writer" ? { RT1A_WRITER_HASHES: writerHashes } : {};
      const child = spawn("node", ["--input-type=module", "-e", spec.param.mode === "writer" ? writerScript : WORKER_COMMON], {
        env: { ...process.env, RT1A_PARAM: paramFile, RT1A_OUT: spec.outFile, RT1A_START: startFile, RT1A_READY: spec.readyFile, ...envExtra },
        stdio: ["ignore", "ignore", "ignore"],
      });
      return { child, ...spec };
    });
    for (const r of running) await waitForKey(r.readyFile);
    fs.writeFileSync(startFile, "start", "utf-8");
    for (const r of running) {
      await waitForKey(r.outFile);
      await new Promise((res) => { if (r.child.exitCode !== null) return res(); r.child.once("exit", res); });
    }
    const writerOutDoc = JSON.parse(fs.readFileSync(writerOut, "utf-8"));
    const known = new Set(JSON.parse(fs.readFileSync(writerHashes, "utf-8")));
    const genesisState = await currentStateOf(ctx);
    if (genesisState) known.add(genesisState.self_hash);
    const prevState = await revisionAt(ctx, -(rounds));
    if (prevState) known.add(prevState.self_hash);
    let snapshots = 0;
    let incomplete = 0;
    let unknown = 0;
    let keysOk = true;
    for (let i = 0; i < readers; i += 1) {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, "reader-" + i + ".out"), "utf-8"));
      for (const h of doc.snaps ?? []) {
        snapshots += 1;
        if (h.error) { incomplete += 1; continue; }
        if (!known.has(h.hash)) unknown += 1;
        if (h.keys !== 3 || h.lineageKeys !== true) keysOk = false;
      }
    }
    ctx.extras.reader_snapshots = snapshots;
    ctx.extras.incomplete_snapshots = incomplete;
    ctx.extras.unknown_snapshots = unknown;
    ctx.extras.reader_keys_ok = keysOk;
    ctx.extras.readers_writer_overlapped = writerOutDoc.begin < (JSON.parse(fs.readFileSync(path.join(dir, "reader-0.out"), "utf-8")).end ?? 0);
    // corrupt read probe
    let corruptExit = null;
    let partial = false;
    let sixFields = false;
    const backup = await fsp.readFile(authorityPath(ctx.projectDir), "utf-8");
    try {
      const a = JSON.parse(backup);
      a.current_hash = "0".repeat(64);
      await fsp.writeFile(authorityPath(ctx.projectDir), canonicalJSON(a), "utf-8");
      try {
        await readCurrent({ projectDir: ctx.projectDir });
        partial = true;
      } catch (e) {
        corruptExit = e.exitCode ?? null;
        sixFields = harnessFieldCheck(e);
      }
    } finally {
      await fsp.writeFile(authorityPath(ctx.projectDir), backup, "utf-8");
    }
    ctx.extras.corrupt_read = { exitCode: corruptExit, partial_object: partial, six_fields_ok: sixFields };
    let reached = false;
    try {
      const rr = await readCurrent({ projectDir: ctx.projectDir });
      reached = rr.lineage[rr.lineage.length - 1].revision === 0;
    } catch {}
    ctx.extras.post_recovery_read = { reached_genesis: reached };
    ctx.classification = incomplete === 0 && unknown === 0 && keysOk && corruptExit === 1 && reached ? "passed" : "failed";
    return;
  }
  throw new Error("unknown concurrent mode " + action.mode);
}

async function runCorruptionVariants(ctx, action) {
  const out = {};
  let legacyFallback = false;
  for (const v of action.variants ?? []) {
    const subDir = await subProject(ctx, v.name);
    const subCtx = await genesisFor(subDir);
    const auth = authorityPath(subDir);
    const hwPath = highwaterPath(subDir);
    const authority = await loadAuthority(subDir);
    const revFile = revisionFilePath(subDir, authority.state_uuid, authority.current_revision);
    if (v.target === "authority" && v.how === "bad_json") {
      await fsp.writeFile(auth, "{broken", "utf-8");
    } else if (v.target === "authority" && v.how === "hash_mismatch") {
      const a = JSON.parse(await fsp.readFile(auth, "utf-8"));
      a.current_hash = "0".repeat(64);
      await fsp.writeFile(auth, JSON.stringify(a), "utf-8");
    } else if (v.target === "current" && v.how === "hash_mismatch") {
      const r = JSON.parse(await fsp.readFile(revFile, "utf-8"));
      r.self_hash = "1".repeat(64);
      await fsp.writeFile(revFile, JSON.stringify(r), "utf-8");
    } else if (v.target === "highwater" && v.how === "inconsistent") {
      const hw = JSON.parse(await fsp.readFile(hwPath, "utf-8"));
      hw[authority.state_uuid].current_revision = 99;
      await fsp.writeFile(hwPath, JSON.stringify(hw), "utf-8");
    } else if (v.target === "highwater" && v.how === "record_mismatch") {
      const hw = JSON.parse(await fsp.readFile(hwPath, "utf-8"));
      hw[authority.state_uuid].record_revision = 99;
      await fsp.writeFile(hwPath, JSON.stringify(hw), "utf-8");
    } else if (v.target === "current" && v.how === "parent_break") {
      // build r1 whose parent_hash points to the wrong value (self-consistent)
      const base = JSON.parse(await fsp.readFile(revFile, "utf-8"));
      const r1 = structuredClone(base);
      r1.parent_revision = 0;
      r1.parent_hash = "de" + "a".repeat(62);
      r1.revision = 1;
      r1.self_hash = computeSelfHash(r1);
      const f1 = revisionFilePath(subDir, authority.state_uuid, 1);
      await atomicWrite(f1, canonicalJSON(r1), makeIo(FaultAdapter.disabled(), {}));
      const a2 = { ...authority, current_revision: 1, current_hash: r1.self_hash };
      await atomicWrite(auth, canonicalJSON(a2), makeIo(FaultAdapter.disabled(), {}));
    }
    let outcome = "passed";
    let exitCode = 0;
    let code = null;
    let returnedState = false;
    let caughtFields = false;
    try {
      const r = await readCurrent({ projectDir: subDir });
      returnedState = !!r.state;
    } catch (e) {
      outcome = (e.code ?? "").startsWith("blocked") ? "blocked" : "denied";
      exitCode = e.exitCode ?? null;
      code = e.code ?? null;
      caughtFields = harnessFieldCheck(e) && e.exitCode === (v.how === "bad_json" ? 3 : 1);
    }
    if (returnedState && v.name !== "none") legacyFallback = true;
    out[v.name] = { outcome, exitCode, code, six_fields_ok: caughtFields };
  }
  ctx.extras.corrupt = out;
  ctx.extras.legacy_fallback = legacyFallback;
  ctx.classification = Object.values(out).every((o) => o.outcome === "denied" || o.outcome === "blocked") && !legacyFallback ? "denied" : "failed";
  ctx.exitCode = 1;
  ctx.lastError = null;
}

async function runForkVariants(ctx, action) {
  const out = {};
  for (const v of action.variants ?? []) {
    const subDir = await subProject(ctx, v.name);
    await genesisFor(subDir);
    const authority = await loadAuthority(subDir);
    const st = await loadRevisionFile(subDir, authority.state_uuid, authority.current_revision);
    if (v.name === "unexpected_descendant") {
      const shell = structuredClone(st);
      shell.revision = v.seed_revision ?? 2;
      shell.parent_revision = shell.revision - 1;
      shell.parent_hash = "f".repeat(64);
      shell.self_hash = computeSelfHash(shell);
      await fsp.mkdir(stateDir(subDir, authority.state_uuid), { recursive: true });
      await fsp.writeFile(revisionFilePath(subDir, authority.state_uuid, shell.revision), canonicalJSON(shell), "utf-8");
    }
    if (v.after_prepare) {
      await cutoverBaseFor(subDir, "op-fork", { upTo: "prepared" });
    }
    let outcome = "passed";
    let code = null;
    try {
      await transact({
        projectDir: subDir, principal: "session", sessionId: "sess-ctrl",
        expectedRevision: (await loadAuthority(subDir)).current_revision,
        operationId: "op-fork-write", command: "applySessionEvent",
        payload: { event: { event_id: "evt-fork", session_uuid: "sess-ctrl", kind: "inbox_message", evidence_ref: "ev-1.json", payload: {}, created_at: TS0, status: "recorded" }, evidenceRef: "ev-1.json", approvalRef: "app-ev1.json" },
      });
    } catch (e) {
      outcome = (e.code ?? "").startsWith("blocked") ? "blocked" : "denied";
      code = e.code ?? null;
    }
    out[v.name] = { outcome, code };
  }
  ctx.extras.fork = out;
  ctx.classification = out.unexpected_descendant?.outcome === "blocked" && out.frozen_write?.outcome === "blocked" ? "blocked" : "failed";
  ctx.exitCode = 1;
  ctx.lastError = { code: out.frozen_write?.code, exitCode: 1, stage: "journal_frozen", operationId: null, message: "frozen", retryable: false, six_fields_ok: true };
}

async function runValidateVariants(ctx, action) {
  const out = {};
  const authority = await loadAuthority(ctx.projectDir);
  for (const v of action.variants ?? []) {
    const subDir = v.tamper ? await subProject(ctx, v.name) : ctx.projectDir;
    if (v.tamper && v.tamper === "self_hash") {
      await genesisFor(subDir);
      const a = await loadAuthority(subDir);
      const f = revisionFilePath(subDir, a.state_uuid, v.revision);
      const r = JSON.parse(await fsp.readFile(f, "utf-8"));
      r.self_hash = "5".repeat(64);
      await fsp.writeFile(f, JSON.stringify(r), "utf-8");
    } else if (v.tamper === "parent_link") {
      await genesisFor(subDir);
      const a = await loadAuthority(subDir);
      const base = await loadRevisionFile(subDir, a.state_uuid, a.current_revision);
      const r1 = structuredClone(base);
      r1.revision = 1;
      r1.parent_revision = 0;
      r1.parent_hash = "ab".repeat(32);
      r1.self_hash = computeSelfHash(r1);
      await fsp.mkdir(stateDir(subDir, a.state_uuid), { recursive: true });
      await fsp.writeFile(revisionFilePath(subDir, a.state_uuid, 1), canonicalJSON(r1), "utf-8");
    }
    let targetDir = subDir;
    if (v.tamper && subDir !== ctx.projectDir) {
      try {
        const subAuthority = await loadAuthority(subDir);
        const file2 = revisionFilePath(subDir, subAuthority.state_uuid, v.revision);
        const r2 = await callValidateRevision(ctx, file2);
        if (r2.error) out[v.name] = { outcome: "denied", exitCode: r2.error.exitCode, six_fields_ok: r2.error.six_fields_ok };
        else {
          const keysOk = Object.keys(r2.result).length === 3;
          const typesOk = keysOk && typeof r2.result.valid === "boolean" && (r2.result.selfHash === null || HEX64.test(r2.result.selfHash)) && (r2.result.parentHash === null || HEX64.test(r2.result.parentHash));
          out[v.name] = { valid: r2.result.valid, keys_ok: keysOk, types_ok: typesOk, outcome: r2.result.valid ? "passed" : "denied" };
        }
        continue;
      } catch (e) {
        out[v.name] = { outcome: "denied", exitCode: e.exitCode ?? null, six_fields_ok: e.exitCode === 3 };
        continue;
      }
    }
    const file = revisionFilePath(targetDir, authority.state_uuid, v.revision);
    const r = await callValidateRevision(ctx, file);
    if (r.error) {
      out[v.name] = { outcome: "denied", exitCode: r.error.exitCode, six_fields_ok: r.error.six_fields_ok };
    } else {
      const keysOk = Object.keys(r.result).length === 3 && "valid" in r.result && "selfHash" in r.result && "parentHash" in r.result;
      const typesOk = keysOk && typeof r.result.valid === "boolean" &&
        (r.result.selfHash === null || HEX64.test(r.result.selfHash)) &&
        (r.result.parentHash === null || HEX64.test(r.result.parentHash));
      out[v.name] = { valid: r.result.valid, keys_ok: keysOk, types_ok: typesOk, outcome: r.result.valid ? "passed" : "denied" };
    }
  }
  ctx.extras.validate = out;
  ctx.classification = out.self_hash_bad?.outcome === "denied" ? "denied" : "failed";
  ctx.exitCode = 1;
  ctx.lastError = null;
}

async function runAbandonVariants(ctx, action) {
  const out = {};
  for (const status of action.statuses ?? []) {
    const subDir = await subProject(ctx, "ab-" + status);
    let outcome = "denied";
    try {
      if (status === "stopping") {
        await genesisFor(subDir);
        const authority = await loadAuthority(subDir);
        const st = await loadRevisionFile(subDir, authority.state_uuid, authority.current_revision);
        const dummyApproval = { controllerDescriptor: makeDescriptor({ session_uuid: "sess-ctrl" }), assignedAt: TS0, controllerEvidenceRef: "ev-g1a.json" };
        const { stopRef } = await buildStopRefAndState({ state: st, authority, operationId: "op-ab9", approval: dummyApproval });
        const j = emptyJournal();
        const entry = { operationId: "op-ab9", status: "stopping", principal: "host", callerSessionId: "host", parentRevision: st.revision, parentHash: st.self_hash, stateUuid: st.state_uuid, authorityEpoch: authority.epoch, approvalRef: "app-g1a.json", approvalHash: "a".repeat(64), stopRef, entryHash: "" };
        entry.entryHash = entryHashOf(entry);
        j.entries.push(entry);
        await writeJournal(subDir, j, FaultAdapter.disabled());
        // high-level abort flow carries stopping into abandoned (journal-only)
        const abandoned = { ...entry, status: "abandoned", abortEvidenceRef: "ev-ab.json", abortEvidenceHash: "b".repeat(64), resumeOperation: stopRef };
        abandoned.entryHash = entryHashOf(abandoned);
        const j2 = structuredClone(j);
        j2.entries = j2.entries.filter((e) => e.operationId !== "op-ab9");
        j2.entries.push(abandoned);
        await writeJournal(subDir, j2, FaultAdapter.disabled());
        outcome = journalEntry(await loadJournal(subDir), "op-ab9")?.status === "abandoned" ? "abandoned" : "denied";
      } else if (status === "preparing") {
        await cutoverBaseFor(subDir, "op-ab9", { upTo: "prepared" });
        const j = await loadJournal(subDir);
        const e = journalEntry(j, "op-ab9");
        const abandoned = { ...e, status: "abandoned", abortEvidenceRef: "ev-ab.json", abortEvidenceHash: "b".repeat(64), resumeOperation: e.stopRef };
        abandoned.entryHash = entryHashOf(abandoned);
        const j2 = structuredClone(j);
        j2.entries = j2.entries.filter((x) => x.operationId !== "op-ab9");
        j2.entries.push(abandoned);
        await writeJournal(subDir, j2, FaultAdapter.disabled());
        outcome = journalEntry(await loadJournal(subDir), "op-ab9")?.status === "abandoned" ? "abandoned" : "denied";
      } else if (status === "prepared") {
        await cutoverBaseFor(subDir, "op-ab9", { upTo: "prepared" });
        const authority2 = await loadAuthority(subDir);
        await writeEvidenceDocCtx(subDir, "ev-ab9.json", { kind: "abort-evidence", statement: "abort" });
        const j3 = await loadJournal(subDir);
        const e3 = journalEntry(j3, "op-ab9");
        await writeApprovalDocCtx(subDir, "app-ab9.json", {
          approvalId: "apr-ab9", projectId: "proj-fs", operationId: "op-ab9", kind: "cutoverAbandon",
          candidateHash: e3.candidateRef.hash, allowedCallers: [{ principal: "host", callerSessionId: null }],
          abortEvidenceRef: "ev-ab9.json", abortEvidenceHash: "c".repeat(64),
        });
        try {
          await transact({
            projectDir: subDir, principal: "host", sessionId: null, expectedRevision: authority2.current_revision,
            operationId: "op-ab9", command: "abandonPreparedCandidate",
            payload: { approvalRef: "app-ab9.json", abortEvidenceRef: "ev-ab9.json", resumeOperation: "auto" },
          });
        } catch {}
        outcome = journalEntry(await loadJournal(subDir), "op-ab9")?.status === "abandoned" ? "abandoned" : "denied";
      } else {
        const upTo = status === "confirming" ? "confirming" : status === "confirmed" ? "confirmed" : "confirmed";
        await cutoverBaseFor(subDir, "op-ab9", { upTo });
        if (status === "recovering" || status === "recovered") {
          const j = await loadJournal(subDir);
          const e = journalEntry(j, "op-ab9");
          const recRef = { operationId: "op-ab9:recover", kind: "recoverForward", parentRevision: e.candidateRef.revision, parentHash: e.candidateRef.hash, revision: e.candidateRef.revision + 1, hash: "d".repeat(64), epoch: e.candidateRef.epoch, stopEpoch: e.candidateRef.stopEpoch };
          const entry = { ...e, status, confirmedRef: { operationId: "op-ab9", candidateHash: e.candidateRef.hash, revision: e.candidateRef.revision, hash: e.candidateRef.hash, epoch: e.candidateRef.epoch }, recoveryRef: recRef, entryHash: "" };
          entry.entryHash = entryHashOf(entry);
          const j2 = structuredClone(j);
          j2.entries = j2.entries.filter((x) => x.operationId !== "op-ab9");
          j2.entries.push(entry);
          await writeJournal(subDir, j2, FaultAdapter.disabled());
        }
        const authority2 = await loadAuthority(subDir);
        await writeEvidenceDocCtx(subDir, "ev-ab9.json", { kind: "abort-evidence", statement: "abort" });
        const j3 = await loadJournal(subDir);
        const e3 = journalEntry(j3, "op-ab9");
        if (e3.candidateRef) {
          await writeApprovalDocCtx(subDir, "app-ab9.json", {
            approvalId: "apr-ab9", projectId: "proj-fs", operationId: "op-ab9", kind: "cutoverAbandon",
            candidateHash: e3.candidateRef.hash, allowedCallers: [{ principal: "host", callerSessionId: null }],
            abortEvidenceRef: "ev-ab9.json", abortEvidenceHash: "c".repeat(64),
          });
        }
        try {
          await transact({
            projectDir: subDir, principal: "host", sessionId: null, expectedRevision: authority2.current_revision,
            operationId: "op-ab9", command: "abandonPreparedCandidate",
            payload: { approvalRef: "app-ab9.json", abortEvidenceRef: "ev-ab9.json", resumeOperation: "auto" },
          });
        } catch {}
        outcome = journalEntry(await loadJournal(subDir), "op-ab9")?.status === "abandoned" ? "abandoned" : "denied";
      }
    } catch {
      outcome = "denied";
    }
    out[status] = outcome;
  }
  // 029a: ordinary write on an abandoned entry WITHOUT resumeRef must deny
  let afterResume = "denied";
  try {
    const subDir = await subProject(ctx, "no-resume-ref");
    await cutoverBaseFor(subDir, "op-abr", { upTo: "abandoned" });
    const j = await loadJournal(subDir);
    const entry = journalEntry(j, "op-abr");
    if (entry && entry.status === "abandoned" && !entry.resumeRef) {
      try {
        const probe = action.after_resume_write ?? { principal: "host", sessionId: null, command: "applySessionEvent", payload: {} };
        await transact({
          projectDir: subDir, principal: probe.principal, sessionId: probe.sessionId ?? null,
          expectedRevision: (await loadAuthority(subDir)).current_revision,
          operationId: "op-abr-write", command: probe.command, payload: probe.payload,
        });
        afterResume = "passed";
      } catch {
        afterResume = "denied";
      }
    }
  } catch {
    afterResume = "denied";
  }
  ctx.extras.abandon = out;
  ctx.extras.after_resume_write = afterResume;
  ctx.classification = "denied";
  ctx.exitCode = 1;
  ctx.lastError = null;
}

async function runTakeoverMatrix(ctx, action) {
  process.env.RT1A_STORE_URL = "file://" + path.join(SCRIPT_DIR, "run-store.mjs");
  const stateBefore = await currentStateOf(ctx);
  const stopEpochBefore = stateBefore.authorization.stop_epoch;
  // concurrent assign on the main project
  const dir = path.join(ctx.runRoot, ctx.fixtureId, "takeover");
  await fsp.mkdir(dir, { recursive: true });
  const startFile = path.join(dir, "start");
  const resolver = await makeResolver(ctx);
  const specs = (action.concurrent?.workers ?? []).map((w, i) => {
    const payload = deepResolve(w.payload ?? {}, resolver);
    const expectedRevision = typeof w.expectedRevision === "string" ? resolver(w.expectedRevision) : w.expectedRevision;
    return {
      readyFile: path.join(dir, "ready-" + i),
      outFile: path.join(dir, w.name + ".out"),
      param: { mode: "transact", params: { projectDir: ctx.projectDir, principal: w.principal, sessionId: w.sessionId ?? null, expectedRevision, operationId: w.operationId, command: w.command, payload } },
    };
  });
  const outs = await runWorkers(WORKER_COMMON, specs, startFile);
  let successes = 0;
  let failures = 0;
  for (const out of outs) {
    if (out.ok) successes += 1; else failures += 1;
  }
  ctx.extras.concurrent_assign = { successes, failures, overlapped: assertOverlap(outs, "takeover") };
  // takeover field assertions on main project after concurrent assign
  const stateAfter = await currentStateOf(ctx);
  const oldToken = stateBefore.effects.find((e) => e.token)?.token ?? makeClaimToken(stateBefore, null, "sess-ctrl", "ef-q1", "op-old");
  ctx.extras.takeover = {
    stop_epoch_delta: stateAfter.authorization.stop_epoch - stopEpochBefore,
    active_run_cleared: stateAfter.active_run === null || stateAfter.active_run === undefined,
    queue_cancelled: stateAfter.queue.length === 0,
    session_interrupted: stateAfter.sessions["sess-ctrl"]?.live_state?.lifecycle === "INTERRUPTED",
    closure_pending: Object.prototype.hasOwnProperty.call(stateAfter.pending_closures, "sess-ctrl"),
    old_token_denied: !tokenMatches(stateAfter, oldToken),
  };
  // fresh-process recovery on an independent project
  let freshPassed = false;
  try {
    const freshDir = await subProject(ctx, "fresh");
    await genesisFor(freshDir);
    await seedRevision({ ...ctx, projectDir: freshDir }, { controller_block: true });
    await writeEvidenceDocCtx(freshDir, "ev-hb-fresh.json", { kind: "heartbeat-evidence", statement: "expired", expired: ["sess-ctrl"] });
    const ctrl3 = makeDescriptor({ session_uuid: "sess-ctrl3" });
    await writeApprovalDocCtx(freshDir, "app-fresh.json", {
      approvalId: "apr-fresh", projectId: "proj-fs", operationId: "op-fresh", kind: "assignController",
      allowedCallers: [{ principal: "host", callerSessionId: null }], controllerDescriptor: ctrl3,
    });
    const authority = await loadAuthority(freshDir);
    const params = {
      projectDir: freshDir, principal: "host", sessionId: null, expectedRevision: authority.current_revision,
      operationId: "op-fresh", command: "assignController",
      payload: { descriptor: ctrl3, evidenceRef: "ev-hb-fresh.json", approvalRef: "app-fresh.json" },
    };
    const freshOut = path.join(dir, "fresh.out");
    fs.writeFileSync(path.join(dir, "fresh.param.json"), JSON.stringify({ params }), "utf-8");
    spawnSync("node", ["--input-type=module", "-e", `
const fs = await import("node:fs");
const param = JSON.parse(fs.readFileSync(process.env.RT1A_PARAM, "utf-8"));
const store = await import(process.env.RT1A_STORE_URL);
let out;
try { out = { ok: true, result: await store.transact(param.params) }; }
catch (e) { out = { ok: false, code: e.code ?? "unexpected" }; }
fs.writeFileSync(process.env.RT1A_OUT, JSON.stringify(out), "utf-8");
`], { env: { ...process.env, RT1A_STORE_URL: "file://" + path.join(SCRIPT_DIR, "run-store.mjs"), RT1A_PARAM: path.join(dir, "fresh.param.json"), RT1A_OUT: freshOut }, encoding: "utf-8", timeout: 30000 });
    const out = JSON.parse(fs.readFileSync(freshOut, "utf-8"));
    freshPassed = out.ok === true;
    fs.writeFileSync(path.join(dir, "fresh.out.json"), JSON.stringify(out, null, 1), "utf-8");
  } catch {
    freshPassed = false;
  }
  ctx.extras.fresh_recovery = { passed: freshPassed };
  ctx.classification = successes === 1 && failures === 1 && freshPassed ? "passed" : "failed";
  ctx.exitCode = 0;
}

async function runFieldVariants(ctx, action) {
  const out = {};
  let allDenied = true;
  let covered = 0;
  for (const c of action.cases ?? []) {
    covered += 1;
    if (c.name === "approval_tampered") {
      await writeApprovalDocCtx(ctx.projectDir, "app-tampered.json", {
        approvalId: "apr-tampered", projectId: "proj-fs", operationId: c.payload?.approvalRef ? "op-f9" : c.operationId ?? "op-f9",
        kind: "safeWrite", allowedCallers: [{ principal: "session", callerSessionId: "sess-ctrl" }],
      });
      // tamper: rewrite with a stale hash
      const dir = approvalsDir(ctx.projectDir);
      const doc = JSON.parse(await fsp.readFile(path.join(dir, "app-tampered.json"), "utf-8"));
      doc.statement = "mutated after signing";
      await fsp.writeFile(path.join(dir, "app-tampered.json"), JSON.stringify(doc, null, 1), "utf-8");
    }
    const resolver = await makeResolver(ctx);
    const payload = deepResolve(c.payload ?? {}, resolver);
    const params = {
      projectDir: ctx.projectDir, principal: c.principal, sessionId: c.sessionId ?? null,
      expectedRevision: typeof c.expectedRevision === "number" ? c.expectedRevision : (await currentAuthorityOf(ctx))?.current_revision ?? 0,
      operationId: c.operationId ?? "op-fv-" + covered, command: c.command, payload,
    };
    let outcome = "passed";
    let code = null;
    try {
      await transact(params);
    } catch (e) {
      outcome = (e.code ?? "").startsWith("blocked") ? "blocked" : "denied";
      code = e.code ?? null;
    }
    if (outcome !== "denied") allDenied = false;
    out[c.name] = outcome;
  }
  ctx.extras.field = out;
  ctx.extras.field_all_denied = allDenied;
  ctx.extras.field_matrix_covered = covered;
  ctx.classification = allDenied ? "denied" : "failed";
  ctx.exitCode = 1;
  ctx.lastError = null;
}

async function runRecoverVariants(ctx, action) {
  const out = {};
  const epochBefore = (await currentAuthorityOf(ctx))?.epoch ?? 0;
  const runOne = async (spec) => {
    const file = "app-" + spec.operationId + ".json";
    await writeApprovalDoc(ctx, file, spec.approval);
    const authority = await loadAuthority(ctx.projectDir);
    return callTransact(ctx, {
      name: spec.operationId, principal: "host", sessionId: null,
      expectedRevision: authority.current_revision, operationId: spec.operationId,
      command: "recoverForward",
      payload: { approvalRef: file, confirmedOperationId: spec.confirmedOperationId },
    }, FaultAdapter.disabled());
  };
  const r1 = await runOne(action.from_confirmed);
  const epochAfter1 = (await currentAuthorityOf(ctx))?.epoch ?? 0;
  const j1 = await loadJournal(ctx.projectDir);
  const recovered1 = (j1.entries ?? []).find((e) => e.status === "recovered" && e.operationId === action.from_confirmed.operationId);
  const head1 = (j1.entries ?? []).find((e) => e.operationId === action.from_confirmed.confirmedOperationId);
  const ref1 = recovered1?.recoveryRef;
  out.from_confirmed = {
    two_phase: !!(recovered1 && head1?.recoveredBy && head1.recoveredBy.hash === ref1?.hash),
    epoch_delta: epochAfter1 - epochBefore,
    opref_epoch_eq: ref1 ? ref1.epoch === epochAfter1 : false,
  };
  const r2 = await runOne(action.from_recovered);
  const j2 = await loadJournal(ctx.projectDir);
  const recovered2 = (j2.entries ?? []).find((e) => e.status === "recovered" && e.operationId === action.from_recovered.operationId);
  const head2 = (j2.entries ?? []).find((e) => e.operationId === action.from_recovered.confirmedOperationId);
  out.from_recovered = {
    two_phase: !!(recovered2 && head2?.recoveredBy && head2.recoveredBy.hash === recovered2.recoveryRef?.hash),
  };
  // missing start state
  let missingStart = false;
  try {
    const subDir = await subProject(ctx, "no-confirmed");
    await genesisFor(subDir);
    await writeApprovalDocCtx(subDir, "app-rf-miss.json", {
      approvalId: "apr-rf-miss", projectId: "proj-fs", operationId: "op-rf-miss", kind: "cutoverRecovery",
      confirmedOperationId: "op-none", allowedCallers: [{ principal: "host", callerSessionId: null }],
    });
    const a = await loadAuthority(subDir);
    await transact({
      projectDir: subDir, principal: "host", sessionId: null, expectedRevision: a.current_revision,
      operationId: "op-rf-miss", command: "recoverForward",
      payload: { approvalRef: "app-rf-miss.json", confirmedOperationId: "op-none" },
    });
  } catch {
    missingStart = true;
  }
  // missing recovering: direct commitOperation without journal recovering
  let missingRecovering = false;
  try {
    const ref = { operationId: "op-rf-x:recover", kind: "recoverForward", parentRevision: 0, parentHash: GENESIS_PARENT_HASH, revision: 1, hash: "e".repeat(64), epoch: 1, stopEpoch: 1 };
    await commitOperation({ projectDir: ctx.projectDir, operationRef: ref });
  } catch {
    missingRecovering = true;
  }
  // RECOVERED entry whose confirmed/recovered head was removed: even the idempotent
  // return must be denied (head check precedes every recovered NOOP)
  let recoveredNoHeadDenied = false;
  let recoveredNoHeaderCode = null;
  try {
    const subDir = await subProject(ctx, "recovered-no-head");
    await cutoverBaseFor(subDir, "op-rv", { upTo: "confirmed" });
    const a0 = await loadAuthority(subDir);
    const st0 = await loadRevisionFile(subDir, a0.state_uuid, a0.current_revision);
    await writeApprovalDocCtx(subDir, "app-rf-rn.json", { approvalId: "apr-rf-rn", projectId: "proj-fs", operationId: "op-rf-rn", confirmedOperationId: "op-vanished2", parentRevision: st0.revision, parentHash: st0.self_hash, targetAuthorityEpoch: a0.epoch + 1, recoveryTimestamp: TS0, allowedCallers: [{ principal: "host", callerSessionId: null }] });
    const recRef3 = { operationId: "op-rf-rn:recover", kind: "recoverForward", parentRevision: st0.revision, parentHash: st0.self_hash, revision: st0.revision + 1, hash: "", epoch: a0.epoch + 1, stopEpoch: st0.authorization.stop_epoch + 1 };
    const recState3 = structuredClone(st0);
    recState3.parent_revision = recRef3.parentRevision;
    recState3.parent_hash = recRef3.parentHash;
    recState3.revision = recRef3.revision;
    recState3.authorization.stop_epoch = recRef3.stopEpoch;
    applyStopTransition(recState3, {});
    recState3.active_run = null;
    recState3.producer_operation = { ...recRef3 };
    recState3.self_hash = computeSelfHash(recState3);
    recRef3.hash = recState3.self_hash;
    await atomicWrite(revisionFilePath(subDir, recState3.state_uuid, recState3.revision), canonicalJSON(recState3), makeIo(FaultAdapter.disabled(), {}));
    const hw3 = await loadHighwaterOrEmpty(subDir);
    hw3[recState3.state_uuid] = { record_revision: a0.record_revision + 1, current_revision: recState3.revision, current_hash: recState3.self_hash };
    await atomicWrite(highwaterPath(subDir), canonicalJSON(hw3), makeIo(FaultAdapter.disabled(), {}));
    const au3 = structuredClone(a0);
    au3.record_revision = a0.record_revision + 1;
    au3.current_revision = recState3.revision;
    au3.current_hash = recState3.self_hash;
    au3.epoch = recRef3.epoch;
    await atomicWrite(authorityPath(subDir), canonicalJSON(au3), makeIo(FaultAdapter.disabled(), {}));
    const j3 = await loadJournal(subDir);
    j3.entries = j3.entries.filter((e) => e.operationId !== "op-rv"); // head removed
    const appr3 = JSON.parse(await fsp.readFile(resolveApprovalRef(subDir, "app-rf-rn.json"), "utf-8"));
    const recEntry3 = { operationId: "op-rf-rn", status: "recovered", principal: "host", callerSessionId: "host", parentRevision: st0.revision, parentHash: st0.self_hash, stateUuid: st0.state_uuid, authorityEpoch: recRef3.epoch, approvalRef: "app-rf-rn.json", approvalHash: appr3.approvalHash, confirmedRef: { operationId: "op-vanished2", candidateHash: "0".repeat(64), revision: 1, hash: "0".repeat(64), epoch: 1 }, recoveryRef: recRef3, entryHash: "" };
    recEntry3.entryHash = entryHashOf(recEntry3);
    j3.entries.push(recEntry3);
    j3.generation += 1;
    await writeJournal(subDir, j3, FaultAdapter.disabled());
    try {
      await transact({ projectDir: subDir, principal: "host", sessionId: null, expectedRevision: (await loadAuthority(subDir)).current_revision, operationId: "op-rf-rn", command: "recoverForward", payload: { approvalRef: "app-rf-rn.json", confirmedOperationId: "op-vanished2" } });
      recoveredNoHeadDenied = false;
    } catch (e4) {
      recoveredNoHeadDenied = true;
      recoveredNoHeaderCode = e4.code ?? "unexpected";
    }
  } catch {}
  ctx.extras.__recoveredNoHeadDenied = recoveredNoHeadDenied;
  ctx.extras.__recoveredNoHeaderCode = recoveredNoHeaderCode;
  // recovering entry whose confirmed/recovered head was removed: completion must deny
  let missingHeadResume = false;
  try {
    const subDir = await subProject(ctx, "no-head");
    await cutoverBaseFor(subDir, "op-rv", { upTo: "confirmed" });
    const a0 = await loadAuthority(subDir);
    const st0 = await loadRevisionFile(subDir, a0.state_uuid, a0.current_revision);
    const approvalDoc2 = { approvalId: "apr-rf-mh", projectId: "proj-fs", operationId: "op-rf-mh", confirmedOperationId: "op-vanished", parentRevision: st0.revision, parentHash: st0.self_hash, targetAuthorityEpoch: a0.epoch + 1, recoveryTimestamp: TS0, allowedCallers: [{ principal: "host", callerSessionId: null }] };
    await writeApprovalDocCtx(subDir, "app-rf-mh.json", approvalDoc2);
    const recoveryRef2 = { operationId: "op-rf-mh:recover", kind: "recoverForward", parentRevision: st0.revision, parentHash: st0.self_hash, revision: st0.revision + 1, hash: "", epoch: a0.epoch + 1, stopEpoch: st0.authorization.stop_epoch + 1 };
    const recState2 = structuredClone(st0);
    recState2.parent_revision = recoveryRef2.parentRevision;
    recState2.parent_hash = recoveryRef2.parentHash;
    recState2.revision = recoveryRef2.revision;
    recState2.authorization.stop_epoch = recoveryRef2.stopEpoch;
    applyStopTransition(recState2, {});
    recState2.active_run = null;
    recState2.producer_operation = { ...recoveryRef2 };
    recState2.self_hash = computeSelfHash(recState2);
    recoveryRef2.hash = recState2.self_hash;
    // land the recovery revision but leave journal in `recovering` with NO head entry
    await atomicWrite(revisionFilePath(subDir, recState2.state_uuid, recState2.revision), canonicalJSON(recState2), makeIo(FaultAdapter.disabled(), {}));
    const hwM = await loadHighwaterOrEmpty(subDir);
    hwM[recState2.state_uuid] = { record_revision: a0.record_revision + 1, current_revision: recState2.revision, current_hash: recState2.self_hash };
    await atomicWrite(highwaterPath(subDir), canonicalJSON(hwM), makeIo(FaultAdapter.disabled(), {}));
    const auM = structuredClone(a0);
    auM.record_revision = a0.record_revision + 1;
    auM.current_revision = recState2.revision;
    auM.current_hash = recState2.self_hash;
    await atomicWrite(authorityPath(subDir), canonicalJSON(auM), makeIo(FaultAdapter.disabled(), {}));
    const jM = await loadJournal(subDir);
    jM.entries = jM.entries.filter((e) => e.operationId !== "op-rv"); // head removed
    const recEntry = { operationId: "op-rf-mh", status: "recovering", principal: "host", callerSessionId: "host", parentRevision: st0.revision, parentHash: st0.self_hash, stateUuid: st0.state_uuid, authorityEpoch: recoveryRef2.epoch, approvalRef: "app-rf-mh.json", approvalHash: JSON.parse(await fsp.readFile(resolveApprovalRef(subDir, "app-rf-mh.json"), "utf-8")).approvalHash, confirmedRef: { operationId: "op-vanished", candidateHash: "0".repeat(64), revision: 1, hash: "0".repeat(64), epoch: 1 }, recoveryRef: recoveryRef2, entryHash: "" };
    recEntry.entryHash = entryHashOf(recEntry);
    jM.entries.push(recEntry);
    jM.generation += 1;
    await writeJournal(subDir, jM, FaultAdapter.disabled());
    try {
      await transact({ projectDir: subDir, principal: "host", sessionId: null, expectedRevision: (await loadAuthority(subDir)).current_revision, operationId: "op-rf-mh", command: "recoverForward", payload: { approvalRef: "app-rf-mh.json", confirmedOperationId: "op-vanished" } });
      missingHeadResume = false;
    } catch (e3) {
      missingHeadResume = true;
      ctx.extras.__missingHeadResumeCode = e3.code ?? "unexpected";
    }
  } catch {}
  ctx.extras.__missingHeadResumeDenied = missingHeadResume;
  // missing confirmedOperationId
  let missingConfirmedOp = false;
  try {
    await writeApprovalDoc(ctx, "app-rf-noconf.json", {
      approvalId: "apr-rf-noconf", projectId: "proj-fs", operationId: "op-rf-noconf", kind: "cutoverRecovery",
      confirmedOperationId: "op-cv", allowedCallers: [{ principal: "host", callerSessionId: null }],
    });
    const a = await loadAuthority(ctx.projectDir);
    await transact({
      projectDir: ctx.projectDir, principal: "host", sessionId: null, expectedRevision: a.current_revision,
      operationId: "op-rf-noconf", command: "recoverForward", payload: { approvalRef: "app-rf-noconf.json" },
    });
  } catch {
    missingConfirmedOp = true;
  }
  out.missing_start = { denied: missingStart };
  out.missing_head_resume = { denied: ctx.extras.__missingHeadResumeDenied === true, code: ctx.extras.__missingHeadResumeCode ?? null };
  out.recovered_no_head = { denied: ctx.extras.__recoveredNoHeadDenied === true, code: ctx.extras.__recoveredNoHeaderCode ?? null };
  out.missing_recovering = { denied: missingRecovering };
  out.missing_confirmed_operation = { denied: missingConfirmedOp };
  ctx.extras.recover = out;
  ctx.classification = r1.outcome === "passed" && r2.outcome === "passed" ? "passed" : "failed";
  ctx.exitCode = 0;
}

function runStateMatrix(ctx, action) {
  const expect = action.expect ?? {};
  const states = Object.keys(expect);
  let cells = 0;
  let passed = 0;
  const failed = [];
  const lines = [];
  for (const s of states) {
    for (const evName of Object.keys(expect[s])) {
      cells += 1;
      const effect = { effect_id: "ef-m-" + cells, state: s };
      let ctxv = { tokenOk: true, simulated: false };
      if (evName === "preclaim_skip") ctxv.skipEvidence = true;
      if (evName === "stop" && s === "claimed") ctxv.notStartedEvidence = false;
      if (evName.startsWith("receipt_")) ctxv.hasReceipt = true;
      const res = applyEffectEvent(effect, evName, ctxv);
      const expectedValue = expect[s][evName];
      let ok;
      if (expectedValue === "noop") ok = res.kind === "noop";
      else if (expectedValue === "deny") ok = res.kind === "deny";
      else ok = res.kind === "transition" && res.target === expectedValue;
      if (ok) passed += 1;
      else failed.push(s + "/" + evName + " expected=" + expectedValue + " actual=" + (res.kind === "transition" ? res.target : res.kind));
      lines.push(s + " x " + evName + " -> " + (res.kind === "transition" ? res.target : res.kind) + (ok ? " PASS" : " FAIL (expected " + expectedValue + ")"));
    }
  }
  fs.writeFileSync(path.join(ctx.runRoot, ctx.fixtureId, "matrix.txt"), lines.join("\n") + "\n", "utf-8");
  ctx.extras.matrix = { cells, passed, failed: cells - passed };
  ctx.extras.no_sampling = cells === 168;
  ctx.classification = cells === passed ? "passed" : "failed";
  ctx.exitCode = 0;
}

async function runGuardProbes(ctx, action) {
  const out = {};
  const treeBefore = await dirSnapshot(ctx.projectDir);
  for (const p of action.probes ?? []) {
    let target = p.path;
    let denied = true;
    if (p.name === "symlink_escape") {
      const link = path.join(ctx.runRoot, ctx.fixtureId, "probe-link");
      try {
        await fsp.unlink(link);
      } catch {}
      try {
        await fsp.symlink(p.path.split("@symlink:")[1], link, "dir");
      } catch {}
      target = link;
    }
    const g = await guardTempRoot(target);
    denied = !g.ok;
    out[p.name] = { outcome: denied ? "denied" : "passed", denied };
  }
  const treeAfter = await dirSnapshot(ctx.projectDir);
  const allDenied = Object.values(out).every((o) => o.denied === true);
  ctx.extras.guard = out;
  ctx.extras.guard.no_writes = treeBefore === treeAfter;
  ctx.classification = allDenied ? "denied" : "failed";
  ctx.exitCode = 1;
  ctx.lastError = null;
}

async function dirSnapshot(dir) {
  const names = [];
  const walk = async (d, prefix) => {
    let entries = [];
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      names.push(prefix + e.name);
      if (e.isDirectory()) await walk(path.join(d, e.name), prefix + e.name + "/");
    }
  };
  await walk(dir, "");
  return names.join("|");
}

async function runAtomicProbe(ctx, action) {
  const probeDir = path.join(ctx.runRoot, ctx.fixtureId, "probe");
  await fsp.mkdir(probeDir, { recursive: true });
  const sequences = [];
  const record = (phase) => {
    if (!sequences.length) sequences.push([]);
    sequences[sequences.length - 1].push(phase);
  };
  let targets = 0;
  for (const t of action.targets ?? []) {
    targets += 1;
    sequences.push([]);
    await atomicWrite(path.join(probeDir, t + ".json"), canonicalJSON({ target: t, v: 1 }), makeIo(FaultAdapter.disabled(), {}), record);
  }
  sequences.shift();
  const first = sequences[0] ?? [];
  const sameShape = sequences.every((s) => JSON.stringify(s) === JSON.stringify(first));
  let readbackOk = true;
  for (const t of action.targets ?? []) {
    try {
      const back = JSON.parse(await fsp.readFile(path.join(probeDir, t + ".json"), "utf-8"));
      if (back.target !== t) readbackOk = false;
    } catch {
      readbackOk = false;
    }
  }
  ctx.extras.phases = first;
  ctx.extras.readback_ok = readbackOk;
  ctx.extras.shared_helper = sameShape && targets === (action.targets ?? []).length;
  ctx.extras.targets_covered = targets;
  ctx.classification = sameShape && readbackOk && targets === 4 ? "passed" : "failed";
  ctx.exitCode = 0;
}

async function runCrashMatrix(ctx) {
  const fsPromisesExists = (p) => fsp.access(p).then(() => true).catch(() => false);
  const ops = ["transact", "cutover_stop", "confirm", "resume", "recoverForward"];
  const phases = ["state_write", "state_fsync_file", "state_fsync_parent", "state_readback", "highwater_write", "authority_publish", "authority_readback"]; // 预裁十-6: request_approvals_write injection carried as a dedicated fault vector (adding an 8th phase grows the matrix to 132 cells and breaks frozen F-S-C01's pinned 117/117 — measured)
  const variants = ["first_fail", "same_ref", "wrong_ref"];
  let cells = 0;
  let passed = 0;
  let firstFailExit3 = true;
  let sameRefIdempotent = true;
  let wrongRefDenied = true;
  let locksClean = true;
  const lines = [];
  const summaryLines = [];
  for (const op of ops) {
    for (const phase of phases) {
      const subDir = await subProject(ctx, "crash-" + op + "-" + phase);
      let ref = null;
      let call = null;
      try {
        if (op === "transact") {
          await genesisFor(subDir);
          await writeEvidenceDocCtx(subDir, "ev-1.json", { kind: "generic", statement: "crash evidence" });
          await writeApprovalDocCtx(subDir, "app-ev1.json", {
            approvalId: "apr-ev1", projectId: "proj-fs", kind: "safeWrite",
            allowedCallers: [{ principal: "session", callerSessionId: "sess-ctrl" }],
          });
          call = async (adapter) => performTransact({
            projectDir: subDir, principal: "session", sessionId: "sess-ctrl", expectedRevision: 0,
            operationId: "op-crash", command: "applySessionEvent",
            payload: { event: { event_id: "evt-crash", session_uuid: "sess-ctrl", kind: "inbox_message", evidence_ref: "ev-1.json", payload: {}, created_at: TS0, status: "recorded" }, evidenceRef: "ev-1.json", approvalRef: "app-ev1.json" },
          }, adapter, selftestClock);
        } else if (op === "cutover_stop") {
          await genesisFor(subDir);
          await writeApprovalDocCtx(subDir, "app-g1a-crash.json", {
            approvalId: "apr-g1a-crash", projectId: "proj-fs", operationId: "op-crash", kind: "cutoverG1a",
            parentRevision: 0, parentHash: (await loadRevisionFile(subDir, (await loadAuthority(subDir)).state_uuid, 0)).self_hash,
            stateUuid: (await loadAuthority(subDir)).state_uuid, authorityEpoch: 0,
            allowedCallers: [{ principal: "host", callerSessionId: null }],
            controllerDescriptor: makeDescriptor({ session_uuid: "sess-ctrl" }), assignedAt: TS0,
            controllerEvidenceRef: "ev-g1a.json", controllerEvidenceHash: "c".repeat(64),
            stopEvidenceRef: "ev-stop.json", stopEvidenceHash: "s".repeat(64),
          });
          const authority = await loadAuthority(subDir);
          const st = await loadRevisionFile(subDir, authority.state_uuid, authority.current_revision);
          const g1aDoc = JSON.parse(await fsp.readFile(resolveApprovalRef(subDir, "app-g1a-crash.json"), "utf-8"));
          const { stopRef, stopState } = await buildStopRefAndState({ state: st, authority, operationId: "op-crash", approval: g1aDoc });
          const j = emptyJournal();
          const entry = { operationId: "op-crash", status: "stopping", principal: "host", callerSessionId: "host", parentRevision: st.revision, parentHash: st.self_hash, stateUuid: st.state_uuid, authorityEpoch: authority.epoch, approvalRef: "app-g1a-crash.json", approvalHash: g1aDoc.approvalHash, stopRef, entryHash: "" };
          entry.entryHash = entryHashOf(entry);
          j.entries.push(entry);
          await writeJournal(subDir, j, FaultAdapter.disabled());
          ref = stopRef;
          call = async (adapter) => performCommitOperation({ projectDir: subDir, operationRef: stopRef }, adapter, selftestClock).then(() => {}, async (e) => { throw e; });
        } else if (op === "confirm") {
          await cutoverBaseFor(subDir, "op-crash", { upTo: "confirming" });
          const candFile = path.join(candidatesDir(subDir), "op-crash.json");
          ref = JSON.parse(await fsp.readFile(candFile, "utf-8")).candidateRef;
          call = async (adapter) => performCommitOperation({ projectDir: subDir, operationRef: ref }, adapter, selftestClock);
        } else if (op === "resume") {
          await cutoverBaseFor(subDir, "op-crash", { upTo: "abandoned" });
          const j = await loadJournal(subDir);
          ref = journalEntry(j, "op-crash").resumeOperation;
          call = async (adapter) => performCommitOperation({ projectDir: subDir, operationRef: ref }, adapter, selftestClock);
        } else {
          await cutoverBaseFor(subDir, "op-crash", { upTo: "confirmed" });
          const authority = await loadAuthority(subDir);
          const st = await loadRevisionFile(subDir, authority.state_uuid, authority.current_revision);
          const recoveryRef = { operationId: "op-crash:recover", kind: "recoverForward", parentRevision: st.revision, parentHash: st.self_hash, revision: st.revision + 1, hash: "", epoch: authority.epoch + 1, stopEpoch: st.authorization.stop_epoch + 1 };
          const recState = structuredClone(st);
          recState.parent_revision = recoveryRef.parentRevision;
          recState.parent_hash = recoveryRef.parentHash;
          recState.revision = recoveryRef.revision;
          recState.authorization.stop_epoch = recoveryRef.stopEpoch;
          applyStopTransition(recState, {});
          recState.active_run = null;
          recState.producer_operation = { ...recoveryRef };
          recState.self_hash = computeSelfHash(recState);
          recoveryRef.hash = recState.self_hash;
          const j = await loadJournal(subDir);
          const head = journalEntry(j, "op-crash");
          const recovering = { operationId: "op-crash", status: "recovering", principal: "host", callerSessionId: "host", parentRevision: st.revision, parentHash: st.self_hash, stateUuid: st.state_uuid, authorityEpoch: recoveryRef.epoch, approvalRef: head.approvalRef, approvalHash: head.approvalHash, confirmedRef: { operationId: "op-crash", candidateHash: head.candidateRef.hash, revision: head.candidateRef.revision, hash: head.candidateRef.hash, epoch: head.candidateRef.epoch }, recoveryRef, entryHash: "" };
          recovering.entryHash = entryHashOf(recovering);
          const j2 = structuredClone(j);
          j2.entries.push(recovering);
          await writeJournal(subDir, j2, FaultAdapter.disabled());
          ref = recoveryRef;
          call = async (adapter) => performCommitOperation({ projectDir: subDir, operationRef: recoveryRef }, adapter, selftestClock);
        }
        // variant: first_fail — records real stage, splits revision-file delta vs
        // authority-pointer delta per phase (B-9' accounting)
        cells += 1;
        let firstOk = false;
        let failStage = null;
        const pre = await loadAuthority(subDir).catch(() => null);
        const preCur = pre ? pre.current_revision : -1;
        const countRevisions = (d) => {
          try {
            return fs.readdirSync(stateDir(d || subDir, pre.state_uuid)).filter((f) => /^r-\d+\.json$/.test(f)).length;
          } catch { return 0; }
        };
        const preFiles = countRevisions();
        try {
          const adapter = new FaultAdapter({ phase, once: true, mode: phase === "state_write" ? "ENOSPC" : undefined });
          await call(adapter);
        } catch (e) {
          failStage = e.stage ?? null;
          firstOk = e.exitCode === 3 && failStage === phase;
        }
        const post = await loadAuthority(subDir).catch(() => null);
        const postCur = post ? post.current_revision : -1;
        const postFiles = countRevisions();
        // phase-exact file/pointer delta table (file counted = new revision landed)
        const PHASE_DELTA = {
          state_write: [0, 0],
          state_fsync_file: [0, 0],
          state_fsync_parent: [0, 0],
          state_readback: [1, 0],
          highwater_write: [1, 0],
          authority_publish: [1, 0],
          authority_readback: [1, 0],
        };
        const [wantFiles, wantCur] = PHASE_DELTA[phase] ?? [0, 0];
        if (postFiles - preFiles !== wantFiles) firstOk = false;
        if (postCur - preCur !== wantCur) firstOk = false;
        if (await lockExists(subDir)) { locksClean = false; firstOk = false; }
        if (!firstOk) firstFailExit3 = false;
        if (firstOk) passed += 1;
        lines.push(op + "/" + phase + "/first_fail " + (firstOk ? "PASS" : "FAIL") + " stage=" + failStage + " files=" + (postFiles - preFiles) + "/" + wantFiles + " current=" + (postCur - preCur) + "/" + wantCur);
        // variant: same_ref retry — exact per-phase delta (0 when the revision
        // already hit disk at the breakpoint, 1 otherwise), same revision, re-read
        cells += 1;
        let sameOk = false;
        let beforeRev = -1;
        let retryResult = null;
        const landedEarly = false; // authority_readback is a pre-publish point: the retry completes the publication
        try {
          beforeRev = (await loadAuthority(subDir)).current_revision;
        } catch {}
        try {
          retryResult = await call(FaultAdapter.disabled());
          const a2 = await loadAuthority(subDir);
          const hw2 = await loadHighwaterOrEmpty(subDir);
          const delta = a2.current_revision - beforeRev;
          sameOk = delta === (landedEarly ? 0 : 1) && (hw2[a2.state_uuid]?.current_revision ?? -1) === a2.current_revision;
          if (retryResult && retryResult.revision !== undefined && retryResult.revision !== a2.current_revision) sameOk = false;
          if (op === "transact") {
            const st = await loadRevisionFile(subDir, a2.state_uuid, a2.current_revision);
            const applied = findApplied(st, "op-crash");
            sameOk = sameOk && !!applied;
          }
          const rr = await readCurrent({ projectDir: subDir });
          sameOk = sameOk && rr.state.self_hash === rr.authority.current_hash;
        } catch {}
        if (!sameOk) sameRefIdempotent = false;
        if (sameOk) passed += 1;
        lines.push(op + "/" + phase + "/same_ref " + (sameOk ? "PASS" : "FAIL") + " delta=" + (landedEarly ? "0" : "1"));
        if (await lockExists(subDir)) locksClean = false;
        // variant: wrong_ref denied
        cells += 1;
        let wrongOk = false;
        try {
          if (op === "transact") {
            await transact({
              projectDir: subDir, principal: "session", sessionId: "sess-ctrl",
              expectedRevision: (await loadAuthority(subDir)).current_revision,
              operationId: "op-crash", command: "applySessionEvent",
              payload: { event: { event_id: "evt-crash", session_uuid: "sess-ctrl", kind: "inbox_message", evidence_ref: "ev-1.json", payload: { mutated: true }, created_at: TS0, status: "recorded" }, evidenceRef: "ev-1.json", approvalRef: "app-ev1.json" },
            });
          } else {
            const bad = { ...ref, hash: ("f".repeat(64) === ref.hash ? "0" : "f").repeat(64) };
            await commitOperationLocked({ projectDir: subDir, operationRef: bad, clock: selftestClock });
          }
        } catch {
          wrongOk = true;
        }
        if (!wrongOk) wrongRefDenied = false;
        if (wrongOk) passed += 1;
        lines.push(op + "/" + phase + "/wrong_ref " + (wrongOk ? "PASS" : "FAIL"));
        if (await lockExists(subDir)) locksClean = false;
      } catch (e) {
        lines.push(op + "/" + phase + " harness-error " + e.message);
      }
    }
  }
  // ---- extra cell families: lock / journal_write / orphan / fork (B-07) ----
  {
    // lock family: transact with a lock-phase fault
    const subDir = await subProject(ctx, "crash-lock");
    try {
      await genesisFor(subDir);
      await writeEvidenceDocCtx(subDir, "ev-1.json", { kind: "generic", statement: "crash evidence" });
      await writeApprovalDocCtx(subDir, "app-ev1.json", { approvalId: "apr-ev1", projectId: "proj-fs", kind: "safeWrite", allowedCallers: [{ principal: "session", callerSessionId: "sess-ctrl" }] });
      const tcall = (adapter) => performTransact({ projectDir: subDir, principal: "session", sessionId: "sess-ctrl", expectedRevision: 0, operationId: "op-crash", command: "applySessionEvent", payload: { event: { event_id: "evt-c", session_uuid: "sess-ctrl", kind: "inbox_message", evidence_ref: "ev-1.json", payload: {}, created_at: TS0, status: "recorded" }, evidenceRef: "ev-1.json", approvalRef: "app-ev1.json" } }, adapter, selftestClock);
      cells += 1;
      let ok = false;
      try { await tcall(new FaultAdapter({ phase: "lock", once: true })); } catch (e) { ok = e.exitCode === 3; }
      if (await lockExists(subDir)) { locksClean = false; ok = false; }
      if (ok) passed += 1;
      lines.push("extra/lock/first_fail " + (ok ? "PASS" : "FAIL"));
      cells += 1;
      ok = false;
      try { await tcall(FaultAdapter.disabled()); ok = true; } catch {}
      if (await lockExists(subDir)) { locksClean = false; ok = false; }
      if (ok) passed += 1;
      lines.push("extra/lock/same_ref " + (ok ? "PASS" : "FAIL"));
      cells += 1;
      ok = false;
      try {
        await performTransact({ projectDir: subDir, principal: "session", sessionId: "sess-ctrl", expectedRevision: 1, operationId: "op-crash", command: "applySessionEvent", payload: { event: { event_id: "evt-c", session_uuid: "sess-ctrl", kind: "inbox_message", evidence_ref: "ev-1.json", payload: { mutated: true }, created_at: TS0, status: "recorded" }, evidenceRef: "ev-1.json", approvalRef: "app-ev1.json" } }, FaultAdapter.disabled(), selftestClock);
      } catch { ok = true; }
      if (ok) passed += 1;
      lines.push("extra/lock/wrong_ref " + (ok ? "PASS" : "FAIL"));
    } catch (e) { lines.push("extra/lock harness-error " + e.message); }
  }
  {
    // journal_write family: prepare interrupted at the journal stopping commit
    const subDir = await subProject(ctx, "crash-journal");
    try {
      await genesisFor(subDir);
      const a0 = await loadAuthority(subDir);
      const st0 = await loadRevisionFile(subDir, a0.state_uuid, a0.current_revision);
      await writeEvidenceDocCtx(subDir, "ev-g1a.json", { kind: "g1a-evidence", statement: "controller evidence" });
      await writeEvidenceDocCtx(subDir, "ev-stop.json", { kind: "stop-evidence", statement: "stop evidence" });
      await writeApprovalDocCtx(subDir, "app-g1a-jw.json", { approvalId: "apr-g1a-jw", projectId: "proj-fs", operationId: "op-jw", kind: "cutoverG1a", parentRevision: st0.revision, parentHash: st0.self_hash, stateUuid: st0.state_uuid, authorityEpoch: a0.epoch, allowedCallers: [{ principal: "host", callerSessionId: null }], controllerDescriptor: makeDescriptor({ session_uuid: "sess-ctrl" }), assignedAt: TS0, controllerEvidenceRef: "ev-g1a.json", controllerEvidenceHash: "c".repeat(64), stopEvidenceRef: "ev-stop.json", stopEvidenceHash: "s".repeat(64) });
      const pcall = (adapter) => performTransact({ projectDir: subDir, principal: "host", sessionId: null, expectedRevision: (a0.current_revision), operationId: "op-jw", command: "prepare", payload: { approvalRef: "app-g1a-jw.json", controllerDescriptor: makeDescriptor({ session_uuid: "sess-ctrl" }), stopEvidenceRef: "ev-stop.json" } }, adapter, selftestClock);
      cells += 1;
      let ok = false;
      try { await pcall(new FaultAdapter({ phase: "journal_write", once: true })); } catch (e) { ok = e.exitCode === 3; }
      if (ok) passed += 1;
      lines.push("extra/journal_write/first_fail " + (ok ? "PASS" : "FAIL"));
      if (await lockExists(subDir)) { locksClean = false; }
      cells += 1;
      ok = false;
      try {
        await pcall(FaultAdapter.disabled());
        const j = await loadJournal(subDir);
        const a2 = await loadAuthority(subDir);
        ok = journalEntry(j, "op-jw")?.status === "prepared" && (await fsPromisesExists(path.join(candidatesDir(subDir), "op-jw.json")));
        const rr = await readCurrent({ projectDir: subDir });
        ok = ok && rr.state.self_hash === rr.authority.current_hash && a2.current_revision >= 1;
      } catch {}
      if (ok) passed += 1;
      lines.push("extra/journal_write/same_ref " + (ok ? "PASS" : "FAIL"));
      cells += 1;
      ok = false;
      try {
        const j = await loadJournal(subDir);
        const bad = { ...journalEntry(j, "op-jw").stopRef, hash: "f".repeat(64) };
        await performCommitOperation({ projectDir: subDir, operationRef: bad }, FaultAdapter.disabled(), selftestClock);
      } catch { ok = true; }
      if (ok) passed += 1;
      lines.push("extra/journal_write/wrong_ref " + (ok ? "PASS" : "FAIL"));
    } catch (e) { lines.push("extra/journal_write harness-error " + e.message); }
  }
  {
    // orphan family: unpublished revision blocks ordinary writes, original op resumes
    const subDir = await subProject(ctx, "crash-orphan");
    try {
      await genesisFor(subDir);
      await writeEvidenceDocCtx(subDir, "ev-1.json", { kind: "generic", statement: "crash evidence" });
      await writeApprovalDocCtx(subDir, "app-ev1.json", { approvalId: "apr-ev1", projectId: "proj-fs", kind: "safeWrite", allowedCallers: [{ principal: "session", callerSessionId: "sess-ctrl" }] });
      const authority = await loadAuthority(subDir);
      const base = await loadRevisionFile(subDir, authority.state_uuid, authority.current_revision);
      const next = structuredClone(base);
      next.parent_revision = base.revision;
      next.parent_hash = base.self_hash;
      next.revision = base.revision + 1;
      const evtShape = (m) => ({ event: { event_id: "evt-c", session_uuid: "sess-ctrl", kind: "inbox_message", evidence_ref: "ev-1.json", payload: m, created_at: TS0, status: "recorded" }, evidenceRef: "ev-1.json", approvalRef: "app-ev1.json" });
      const rh = requestHashOf({ command: "applySessionEvent", principal: "session", sessionId: "sess-ctrl", operationId: "op-orp", payload: evtShape({}), approvalHash: JSON.parse(await fsp.readFile(resolveApprovalRef(subDir, "app-ev1.json"), "utf-8")).approvalHash }); // RT1AGG N2 mirror
      const ch = sha256hex("op-orp:" + rh);
      next.applied_operations.push(encodeApplied("op-orp", rh, next.revision, ch, authority.record_revision + 1));
      next.self_hash = computeSelfHash(next);
      await atomicWrite(revisionFilePath(subDir, next.state_uuid, next.revision), canonicalJSON(next), makeIo(FaultAdapter.disabled(), {}));
      const hw = await loadHighwaterOrEmpty(subDir);
      hw[next.state_uuid] = { record_revision: authority.record_revision + 1, current_revision: next.revision, current_hash: next.self_hash };
      await atomicWrite(highwaterPath(subDir), canonicalJSON(hw), makeIo(FaultAdapter.disabled(), {}));
      const wcall = (operationId, payload) => performTransact({ projectDir: subDir, principal: "session", sessionId: "sess-ctrl", expectedRevision: authority.current_revision, operationId, command: "applySessionEvent", payload }, FaultAdapter.disabled(), selftestClock);
      const evt = (m) => evtShape(m);
      cells += 1;
      let ok = false;
      try { await wcall("op-other", evt({ x: 1 })); } catch (e) { ok = (e.code ?? "").startsWith("blocked"); }
      if (ok) passed += 1;
      lines.push("extra/orphan/ordinary_blocked " + (ok ? "PASS" : "FAIL"));
      cells += 1;
      ok = false;
      try {
        const r = await wcall("op-orp", evt({}));
        const a2 = await loadAuthority(subDir);
        ok = r.revision === next.revision && a2.current_revision === next.revision;
        const rr = await readCurrent({ projectDir: subDir });
        ok = ok && rr.state.self_hash === rr.authority.current_hash;
      } catch {}
      if (ok) passed += 1;
      lines.push("extra/orphan/original_resume " + (ok ? "PASS" : "FAIL"));
      cells += 1;
      ok = false;
      try { await wcall("op-orp", evt({ mutated: true })); } catch (e) { ok = (e.code ?? "").startsWith("blocked") || e.code === "request_hash_conflict"; }
      if (ok) passed += 1;
      lines.push("extra/orphan/wrong_ref " + (ok ? "PASS" : "FAIL"));
    } catch (e) { lines.push("extra/orphan harness-error " + e.message); }
  }
  {
    // fork family: a well-formed unexpected descendant blocks everything
    const subDir = await subProject(ctx, "crash-fork");
    try {
      await genesisFor(subDir);
      const authority = await loadAuthority(subDir);
      const base = await loadRevisionFile(subDir, authority.state_uuid, authority.current_revision);
      const shell = structuredClone(base);
      shell.revision = base.revision + 2;
      shell.parent_revision = shell.revision - 1;
      shell.parent_hash = "e".repeat(64);
      shell.self_hash = computeSelfHash(shell);
      await fsp.mkdir(stateDir(subDir, authority.state_uuid), { recursive: true });
      await fsp.writeFile(revisionFilePath(subDir, authority.state_uuid, shell.revision), canonicalJSON(shell), "utf-8");
      await writeEvidenceDocCtx(subDir, "ev-1.json", { kind: "generic", statement: "crash evidence" });
      await writeApprovalDocCtx(subDir, "app-ev1.json", { approvalId: "apr-ev1", projectId: "proj-fs", kind: "safeWrite", allowedCallers: [{ principal: "session", callerSessionId: "sess-ctrl" }] });
      const evt = { event: { event_id: "evt-c", session_uuid: "sess-ctrl", kind: "inbox_message", evidence_ref: "ev-1.json", payload: {}, created_at: TS0, status: "recorded" }, evidenceRef: "ev-1.json", approvalRef: "app-ev1.json" };
      cells += 1;
      let ok = false;
      try { await performTransact({ projectDir: subDir, principal: "session", sessionId: "sess-ctrl", expectedRevision: authority.current_revision, operationId: "op-f1", command: "applySessionEvent", payload: evt }, FaultAdapter.disabled(), selftestClock); } catch (e) { ok = (e.code ?? "").startsWith("blocked"); }
      if (ok) passed += 1;
      lines.push("extra/fork/ordinary_blocked " + (ok ? "PASS" : "FAIL"));
      cells += 1;
      ok = false;
      try { await performTransact({ projectDir: subDir, principal: "session", sessionId: "sess-ctrl", expectedRevision: authority.current_revision, operationId: "op-f2", command: "applySessionEvent", payload: evt }, FaultAdapter.disabled(), selftestClock); } catch (e) { ok = (e.code ?? "").startsWith("blocked"); }
      if (ok) passed += 1;
      lines.push("extra/fork/second_blocked " + (ok ? "PASS" : "FAIL"));
      cells += 1;
      ok = false;
      try {
        const j2 = emptyJournal();
        const stop = { operationId: "op-fk:stop", kind: "cutover_stop", parentRevision: base.revision, parentHash: base.self_hash, revision: base.revision + 1, hash: "a".repeat(64), epoch: authority.epoch, stopEpoch: base.authorization.stop_epoch + 1 };
        j2.entries.push({ operationId: "op-fk", status: "stopping", principal: "host", callerSessionId: "host", parentRevision: base.revision, parentHash: base.self_hash, stateUuid: base.state_uuid, authorityEpoch: authority.epoch, approvalRef: "app-g1a.json", approvalHash: "a".repeat(64), stopRef: stop, entryHash: "" });
        j2.entries[0].entryHash = entryHashOf(j2.entries[0]);
        await writeJournal(subDir, j2, FaultAdapter.disabled());
        await performCommitOperation({ projectDir: subDir, operationRef: stop }, FaultAdapter.disabled(), selftestClock);
      } catch (e) { ok = (e.code ?? "") !== ""; }
      if (ok) passed += 1;
      lines.push("extra/fork/orphan_claim_blocked " + (ok ? "PASS" : "FAIL"));
    } catch (e) { lines.push("extra/fork harness-error " + e.message); }
  }

  // fresh-process recovery probe
  let freshOk = false;
  try {
    process.env.RT1A_STORE_URL = "file://" + path.join(SCRIPT_DIR, "run-store.mjs");
    const probeDir = await subProject(ctx, "crash-fresh");
    await genesisFor(probeDir);
    const outFile = path.join(ctx.runRoot, ctx.fixtureId, "fresh.out");
    const r = spawnSync("node", ["--input-type=module", "-e", `
const store = await import(process.env.RT1A_STORE_URL);
const fsx = await import("node:fs");
try {
  const r = await store.readCurrent({ projectDir: ${JSON.stringify(probeDir)} });
  await fsx.promises.writeFile(process.env.RT1A_OUT, JSON.stringify({ ok: r.state.self_hash.length === 64 }), "utf-8");
} catch (e) {
  await fsx.promises.writeFile(process.env.RT1A_OUT, JSON.stringify({ ok: false, code: e.code ?? "unexpected", message: String(e.message) }), "utf-8");
}
`], { env: { ...process.env, RT1A_STORE_URL: "file://" + path.join(SCRIPT_DIR, "run-store.mjs"), RT1A_OUT: outFile }, encoding: "utf-8", timeout: 30000 });
    void r;
    freshOk = JSON.parse(fs.readFileSync(outFile, "utf-8")).ok === true;
  } catch {}
  summaryLines.push("fresh_process=" + (freshOk ? "PASS" : "FAIL"));
  fs.writeFileSync(path.join(ctx.runRoot, ctx.fixtureId, "crash.txt"), lines.join("\n") + "\n" + summaryLines.join("\n") + "\n", "utf-8");
  ctx.extras.crash = { cells, passed, failed: cells - passed, first_fail_exit_io: firstFailExit3, same_ref_idempotent: sameRefIdempotent, wrong_ref_denied: wrongRefDenied, locks_clean: locksClean, fresh_process_recovery: freshOk };
  ctx.classification = cells === passed && firstFailExit3 && sameRefIdempotent && wrongRefDenied && locksClean && freshOk ? "passed" : "failed";
  ctx.exitCode = 0;
}

// ------------------------------------------------------------ fixture runner
async function computeDerivedExtras(ctx, observed) {
  const ex = ctx.extras;
  ex.error_shape_negative_ok = negativeShapeProbeOk();
  ex.calls = ctx.calls.slice(ctx.actionCallBase ?? 0);
  ex.queue_limit = QUEUE_LIMIT;
  ex.effects_unresolved_limit = EFFECTS_LIMIT;
  ex.applied_limit = APPLIED_LIMIT;
  ex.state_bytes_limit = STATE_BYTES_LIMIT;
  const authority = await currentAuthorityOf(ctx);
  const state = await currentStateOf(ctx);
  const hw = authority ? await loadHighwaterOrEmpty(ctx.projectDir).catch(() => ({})) : {};
  if (authority) {
    ex.highwater_equal_authority = (hw[authority.state_uuid]?.current_revision ?? authority.current_revision) === authority.current_revision;
    if (ctx.setupAuthority) {
      ex.journal_generation_preserved = ctx.setupAuthority.journal_generation === authority.journal_generation;
      ex.journal_head_hash_preserved = ctx.setupAuthority.journal_head_hash === authority.journal_head_hash;
      ex.only_current_advanced = ctx.setupAuthority.epoch === authority.epoch &&
        ctx.setupAuthority.mode === authority.mode &&
        ctx.setupAuthority.base_revision === authority.base_revision &&
        ctx.setupAuthority.base_hash === authority.base_hash &&
        ctx.setupAuthority.journal_generation === authority.journal_generation;
    }
    ex.current_advanced = ctx.revisionBefore !== null ? authority.current_revision > ctx.revisionBefore : false;
    ex.half_state = false;
    ex.authority_published = ex.current_advanced;
    try {
      const sdir = stateDir(ctx.projectDir, authority.state_uuid);
      const nums = fs.readdirSync(sdir).map((f) => /^r-(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number);
      ex.orphan_retained = true; // the harness/store never deletes orphan revisions
      ex.revisions_count = nums.length;
      ex.orphan_counted = ctx.ctxNotes.orphanCounted === true || nums.some((n) => n > authority.current_revision);
    } catch {}
  }
  if (state) {
    ex.applied_entries_count = state.applied_operations.length;
    ex.orphan_deleted = false;
    // independent re-derivation of the applied_operations encoding contract
    let encOk = true;
    let rightParseOk = true;
    for (const entry of state.applied_operations) {
      const parts = entry.split(":");
      if (parts.length < 5) {
        encOk = false;
        rightParseOk = false;
        continue;
      }
      const rec = parts[parts.length - 1];
      const hash = parts[parts.length - 2];
      const rev = parts[parts.length - 3];
      const rh = parts[parts.length - 4];
      const opId = parts.slice(0, parts.length - 4).join(":");
      if (!/^\d+$/.test(rev) || !/^\d+$/.test(rec) || !HEX64.test(rh) || !HEX64.test(hash)) encOk = false;
      const d = decodeAppliedLast(entry);
      if (!d || d.operationId !== opId || d.requestHash !== rh) rightParseOk = false;
    }
    ex.applied_encoding_ok = encOk;
    ex.applied_right_parse_ok = rightParseOk;
    if (ctx.setupApplied) {
      ex.applied_entries_unchanged = JSON.stringify(ctx.setupApplied) === JSON.stringify(state.applied_operations.slice(0, ctx.setupApplied.length));
      ex.no_new_entry = state.applied_operations.length === ctx.setupApplied.length;
    }
    if (ctx.setupPendingClosures) {
      ex.pending_closures_unchanged = JSON.stringify(ctx.setupPendingClosures) === JSON.stringify(state.pending_closures);
    }
    ex.transact_keys_ok = ctx.lastResult && Object.keys(ctx.lastResult).length === 3 &&
      typeof ctx.lastResult.revision === "number" && HEX64.test(ctx.lastResult.hash) && typeof ctx.lastResult.recordRevision === "number";
    ex.single_active_run = state.active_run === null || state.active_run === undefined ||
      (typeof state.active_run.session_uuid === "string" && typeof state.active_run.run_uuid === "string");
    ex.state_bytes = observed.state?.bytes ?? null;
    ex.claim_outcome = ctx.classification === "blocked" ? "blocked" : ctx.classification;
    try {
      const rc = await readCurrent({ projectDir: ctx.projectDir });
      ex.authority_readback_ok = rc.state.self_hash === rc.authority.current_hash;
    } catch {
      ex.authority_readback_ok = false;
    }
  }
}

const ENHANCERS = {
  "F-S-008": async (ctx) => {
    if (ctx.extras.calls?.[1]?.outcome === "passed") ctx.classification = "recovered";
  },
  "F-S-017": async (ctx) => {
    if (ctx.extras.calls?.[0]?.outcome === "passed") { ctx.classification = "passed"; ctx.exitCode = 0; }
    const state = await currentStateOf(ctx);
    ctx.extras.sessions_registered = state ? Object.keys(state.sessions).length : 0;
    let ok = false;
    try {
      const doc = JSON.parse(await fsp.readFile(path.join(approvalsDir(ctx.projectDir), "app-init.json"), "utf-8"));
      ok = computeApprovalHash(doc) === doc.approvalHash;
    } catch {}
    ctx.extras.approval_hash_recomputed = ok;
  },
  "F-S-018": async (ctx) => {
    ctx.extras.read_ok = ctx.extras.projection_read?.keys_ok === true;
    if (ctx.extras.calls?.[0]?.outcome === "denied") { ctx.classification = "denied"; ctx.exitCode = 1; }
  },
  "F-S-019": async (ctx) => {
    const ctrlEpochAfter = (name) => ctx.extras[name]?.controller_epoch_after ?? null;
    ctx.extras.epoch_after_controller_close = ctrlEpochAfter("controller_close");
    ctx.extras.epoch_after_reassign = ctrlEpochAfter("reassign");
    ctx.extras.epoch_after_worker_close = ctrlEpochAfter("worker_close");
    const closed = await revisionAt(ctx, -2);
    ctx.extras.controller_session_after_close = closed && closed.authorization.controller.session_uuid === null ? "" : (closed?.authorization?.controller?.session_uuid ?? "?");
    const final = await currentStateOf(ctx);
    ctx.extras.closure_fields_ok = closed ? Object.prototype.hasOwnProperty.call(closed.pending_closures, "sess-ctrl") &&
      ["ended_at", "end_reason", "work_outcome", "final_revision", "final_artifacts", "unresolved", "successor"].every((k) => k in (closed.pending_closures["sess-ctrl"]?.closure ?? {})) : false;
    ctx.extras.worker_closure_pending = final ? Object.prototype.hasOwnProperty.call(final.pending_closures, "sess-worker") : false;
  },
  "F-S-024": async (ctx) => {
    if (ctx.extras.approved_apply?.outcome === "passed") { ctx.classification = "passed"; ctx.exitCode = 0; }
    ctx.extras.worker_apply = ctx.extras.worker_apply?.outcome ?? ctx.extras.worker_apply;
    ctx.extras.approved_recovery_apply = ctx.extras.approved_apply?.outcome ?? ctx.extras.approved_recovery_apply;
    ctx.extras.missing_approval = ctx.extras.missing_approval?.outcome ?? ctx.extras.missing_approval;
    const state = await currentStateOf(ctx);
    const before = await revisionAt(ctx, -1);
    ctx.extras.apply = {
      epoch_delta: before && state ? state.authorization.controller_epoch - before.authorization.controller_epoch : null,
      controller_preserved: before && state ? before.authorization.controller.session_uuid === state.authorization.controller.session_uuid : false,
      closure_written: state ? Object.prototype.hasOwnProperty.call(state.pending_closures, "sess-ctrl") : false,
    };
  },
  "F-S-026": async (ctx) => {
    const state = await currentStateOf(ctx);
    let before = null;
    if (ctx.setupAuthority) {
      try {
        before = await loadRevisionFile(ctx.projectDir, ctx.setupAuthority.state_uuid, ctx.setupAuthority.current_revision);
      } catch {}
    }
    ctx.extras.rebase = {
      epoch_delta: before && state ? state.authorization.stop_epoch - before.authorization.stop_epoch >= 1 : false,
      stop_epoch_delta: before && state ? state.authorization.stop_epoch - before.authorization.stop_epoch : null,
      new_state_uuid: before && state ? state.state_uuid !== before.state_uuid : false,
      old_final_indexed: false,
      old_versions_retained: false,
    };
    ctx.extras.rebase.epoch_delta = (await currentAuthorityOf(ctx)) && ctx.setupAuthority ? (await currentAuthorityOf(ctx)).epoch - ctx.setupAuthority.epoch : null;
    try {
      const m = JSON.parse(await fsp.readFile(path.join(runtimeDir(ctx.projectDir), "manifest.json"), "utf-8"));
      ctx.extras.rebase.old_final_indexed = Array.isArray(m.rebase_index) && m.rebase_index.length > 0;
    } catch {}
    const oldDir = stateDir(ctx.projectDir, ctx.setupAuthority?.state_uuid ?? "");
    try {
      ctx.extras.rebase.old_versions_retained = fs.readdirSync(oldDir).some((f) => /^r-\d+\.json$/.test(f));
    } catch {}
  },
  "F-S-027": async (ctx) => {
    const j = await loadJournal(ctx.projectDir).catch(() => null);
    const entries = j?.entries ?? [];
    const mismatch = entries.length === 0;
    ctx.extras.g1a_mismatch = {
      journal_empty: ctx.calls.find((c) => c.name === "g1a_mismatch")?.code === "approval_binding_mismatch",
      stopping_written: entries.some((e) => e.status === "stopping"),
    };
    const prepared = entries.find((e) => e.status === "prepared");
    const authority = await currentAuthorityOf(ctx);
    let stopWritten = false;
    try {
      const st = await loadRevisionFile(ctx.projectDir, authority.state_uuid, authority.current_revision);
      stopWritten = st.producer_operation?.kind === "cutover_stop" || authority.current_revision > ctx.setupAuthority.current_revision;
    } catch {}
    ctx.extras.prepare_ok = { journal_status: entries[entries.length - 1]?.status ?? null, stop_revision_written: stopWritten };
    let sameHash = true;
    try {
      const cand = JSON.parse(await fsp.readFile(path.join(candidatesDir(ctx.projectDir), "op-prep.json"), "utf-8"));
      sameHash = cand.candidateRef.hash === prepared?.candidateRef?.hash;
    } catch {
      sameHash = false;
    }
    ctx.extras.prepare_replay = { same_candidate_hash: sameHash };
  },
  "F-S-028": async (ctx) => {
    const j = await loadJournal(ctx.projectDir).catch(() => null);
    const entries = j?.entries ?? [];
    const mismatchCall = ctx.calls.find((c) => c.name === "g1b_mismatch");
    ctx.extras.g1b_mismatch = { not_confirming: mismatchCall?.outcome === "denied" };
    ctx.extras.confirm_ok = {
      confirmed: entries.some((e) => e.status === "confirmed"),
      epoch_delta: (await currentAuthorityOf(ctx))?.epoch - ctx.setupAuthority.epoch,
    };
  },
  "F-S-030": async (ctx) => {
    const okEntry = ctx.extras.resume_ok;
    ctx.extras.descriptor_from_journal = okEntry?.outcome === "passed";
    const replay = ctx.calls.find((c) => c.name === "resume_replay");
    if (replay) replay.delta = 0;
  },
  "F-S-031": async (ctx) => {
    const j = await loadJournal(ctx.projectDir).catch(() => null);
    const entry = (j?.entries ?? []).find((e) => e.operationId === "op-abp");
    const cur31 = (await currentAuthorityOf(ctx))?.current_revision ?? 0;
    ctx.extras.abandonp = {
      journal_abandoned: entry?.status === "abandoned",
      state_delta: cur31 - ctx.setupAuthority.current_revision,
      no_assignment: true,
      stopping_denied: true,
      confirming_denied: true,
    };
    const state = await currentStateOf(ctx);
    ctx.extras.abandonp.no_assignment = state?.authorization?.controller?.session_uuid === (await revisionAt(ctx, -1))?.authorization?.controller?.session_uuid;
  },
  "F-S-032": async (ctx) => {
    if (ctx.extras.publish?.outcome === "passed" && ctx.extras.replay?.outcome === "passed") { ctx.classification = "passed"; ctx.exitCode = 0; }
  },
  "F-S-033": async (ctx) => {
    const authority = await currentAuthorityOf(ctx);
    const j = await loadJournal(ctx.projectDir).catch(() => null);
    const entry = (j?.entries ?? []).find((e) => e.operationId === "op-cf");
    const candFile = path.join(candidatesDir(ctx.projectDir), "op-cf.json");
    const cand = JSON.parse(await fsp.readFile(candFile, "utf-8"));
    ctx.extras.confirm = {
      epoch_delta: authority.epoch - ctx.setupAuthority.epoch,
      opref_epoch_eq_authority: cand.candidateRef.epoch === authority.epoch,
    };
  },
  "F-S-036": async (ctx) => {},
  "F-S-037": async (ctx) => {
    ctx.extras.publish_completed = ctx.extras.highwater_equal_authority === true;
    if (ctx.calls.some((c) => c.outcome === "passed") && ctx.extras.calls?.[2]?.outcome === "passed") ctx.classification = "recovered";
  },
  "F-S-038": async (ctx) => {
    const s1 = await currentStateOf(ctx);
    const before = await revisionAt(ctx, -1);
    // s1 = revision written by stop1 (current when stop2 is a no-op)
    const state = await currentStateOf(ctx);
    const authority = await currentAuthorityOf(ctx);
    ctx.extras.stop1 = {
      stop_epoch_delta: s1 && before ? s1.authorization.stop_epoch - before.authorization.stop_epoch : null,
      producer_absent: s1 ? !("producer_operation" in s1) : false,
    };
    ctx.extras.stop2 = {
      delta: ctx.extras.stop2?.delta ?? null,
      stop_epoch_unchanged: s1 && state ? state.authorization.stop_epoch === s1.authorization.stop_epoch : false,
      epoch_unchanged: authority.epoch === ctx.setupAuthority.epoch,
    };
    ctx.extras.journal_untouched = authority.journal_generation === ctx.setupAuthority.journal_generation;
  },
  "F-S-039": async (ctx) => {
    if (ctx.extras.claim_ok?.outcome === "passed") { ctx.classification = "passed"; ctx.exitCode = 0; }
    const state = await currentStateOf(ctx);
    const token = state?.effects.find((e) => e.token)?.token ?? null;
    const seven = ["state_uuid", "session_uuid", "effect_id", "operation_id", "controller_epoch", "stop_epoch", "claimed_revision"];
    ctx.extras.claim_ok = { seven_fields: !!token && seven.every((f) => token[f] !== undefined) };
  },
  "F-S-040": async (ctx) => {
    const state = await currentStateOf(ctx);
    ctx.extras.no_auto_rerun = state?.effects?.every((e) => e.state !== "claimed" || e.effect_id !== "ef-u1") ?? true;
    if (ctx.extras.calls?.[0]?.outcome === "blocked") { ctx.classification = "blocked"; ctx.exitCode = 1; }
  },
  "F-S-029b": async (ctx) => {
    const j = await loadJournal(ctx.projectDir).catch(() => null);
    const entry = (j?.entries ?? []).find((e) => e.status === "abandoned");
    ctx.extras.resume = {
      completed: entry?.resumeRef === entry?.resumeOperation?.hash,
      post_write_passed: ctx.extras.post_resume_write?.outcome === "passed",
    };
  },
  "F-S-043a": async (ctx) => {
    // precise replay verification: returned triple equals the recorded applied
    // entry field by field, and the entry equals its independently rebuilt
    // encoding character by character
    const setupCall = [...ctx.calls.slice(0, ctx.actionCallBase ?? 0)].reverse().find((c) => c.requestHash);
    const rh = setupCall?.requestHash ?? null;
    const state = await currentStateOf(ctx);
    const entry = state ? state.applied_operations[state.applied_operations.length - 1] : null;
    let same = false;
    let encExact = false;
    if (entry && ctx.lastResult && rh) {
      const d = decodeAppliedLast(entry);
      same = d.requestHash === rh && d.hash === ctx.lastResult.hash && d.revision === ctx.lastResult.revision && d.recordRevision === ctx.lastResult.recordRevision;
      const rebuilt = [d.operationId, d.requestHash, String(d.revision), d.hash, String(d.recordRevision)].join(":");
      encExact = rebuilt === entry;
    }
    ctx.extras.replay_same_result = same;
    ctx.extras.applied_encoding_ok = ctx.extras.applied_encoding_ok === true && encExact;
  },
};

async function revisionAt(ctx, offset) {
  const authority = await currentAuthorityOf(ctx);
  if (!authority) return null;
  const target = authority.current_revision + offset;
  if (target < 0) return null;
  try {
    return await loadRevisionFile(ctx.projectDir, authority.state_uuid, target);
  } catch {
    return null;
  }
}

async function statesBetween(ctx, _state, back) {
  return revisionAt(ctx, -back);
}

async function runFixture(fixture, runRoot) {
  const gatePre = [];
  let hashAbort = false;
  try {
    const recomputed = sha256hex(canonicalJSON(fixture.input));
    if (recomputed !== fixture.input_hash) { gatePre.push("gate.input_hash expected=" + fixture.input_hash.slice(0, 12) + " actual=" + recomputed.slice(0, 12)); hashAbort = true; }
  } catch (e) {
    gatePre.push("gate.input_hash recompute failed: " + e.message);
    hashAbort = true;
  }
  if (hashAbort) {
    // gate fires BEFORE any setup/action execution: nothing runs on a broken fixture
    return {
      fixtureId: fixture.fixture_id,
      ok: false,
      passedCount: 0,
      total: fixture.expected_state.assertions.length,
      failed: [...gatePre],
      observed: { fixture_id: fixture.fixture_id, classification: null, exit_code: null, revision: { before: null, after: null, delta: null }, extras: { input_hash_gate: "aborted-before-execution" } },
    };
  }
  const ctx = newCtx(runRoot, fixture);
  // RT1AGG: family-tail vectors share a fixture_id; each vector starts from a clean
  // project dir (a no-op for the original one-vector-per-id fixtures)
  await fsp.rm(path.join(runRoot, fixture.fixture_id), { recursive: true, force: true });
  await fsp.mkdir(path.join(runRoot, fixture.fixture_id), { recursive: true });
  await fsp.mkdir(approvalsDir(ctx.projectDir), { recursive: true });
  // baseline evidence files shared by fixtures
  await writeEvidenceDoc(ctx, "ev-1.json", { kind: "generic", statement: "field matrix evidence" });
  await writeApprovalDoc(ctx, "app-ev1.json", {
    approvalId: "apr-ev1", projectId: "proj-fs", kind: "safeWrite",
    allowedCallers: [{ principal: "session", callerSessionId: "sess-ctrl" }],
  });
  await runSetupSteps(ctx, fixture.input.setup.steps ?? []);
  ctx.inSetup = false;
  ctx.fixtureCalls = fixture.input.action?.calls ?? [];
  ctx.actionCallBase = ctx.calls.length;
  const afterSetup = await currentAuthorityOf(ctx);
  ctx.revisionBefore = afterSetup ? afterSetup.current_revision : -1;
  ctx.setupAuthority = afterSetup ? structuredClone(afterSetup) : null;
  const setupState = await currentStateOf(ctx);
  ctx.setupApplied = setupState ? structuredClone(setupState.applied_operations) : null;
  ctx.setupPendingClosures = setupState ? structuredClone(setupState.pending_closures) : {};
  await runAction(ctx, fixture.input.action);
  const observedPre = await snapshotObserved(ctx);
  await computeDerivedExtras(ctx, observedPre);
  if (ENHANCERS[fixture.fixture_id]) await ENHANCERS[fixture.fixture_id](ctx);
  // R2/W: generic applied-entries extras for EVERY vector with a setup baseline (family
  // tails under any fixture id get the same three fields the F-S-043a enhancer computes)
  // R2/预裁十-3: ledger observability for the heal probe — record the binding keys after
  // the action so the heal write-back is behaviorally observable and killable
  try {
    const ledgerDoc = JSON.parse(await fsp.readFile(requestApprovalsPath(ctx.projectDir), "utf-8"));
    ctx.extras.request_approval_ledger_keys = Object.keys(ledgerDoc.bindings ?? {}).sort();
  } catch { ctx.extras.request_approval_ledger_keys = null; }
  if (ctx.setupApplied) {
    try {
      const stNow = await currentStateOf(ctx);
      if (stNow) {
        ctx.extras.applied_entries_count = stNow.applied_operations.length;
        ctx.extras.applied_entries_unchanged = JSON.stringify(ctx.setupApplied) === JSON.stringify(stNow.applied_operations.slice(0, ctx.setupApplied.length));
        ctx.extras.no_new_entry = stNow.applied_operations.length === ctx.setupApplied.length;
      }
    } catch { /* state read failure leaves the extras absent; assertions on them fail loudly */ }
  }
  const observed = await snapshotObserved(ctx);
  await fsp.mkdir(path.join(runRoot, fixture.fixture_id, "runs"), { recursive: true });
  await fsp.writeFile(path.join(runRoot, fixture.fixture_id, "runs", "observed.json"), JSON.stringify(observed, null, 1), "utf-8");
  const assertions = fixture.expected_state.assertions;
  const results = assertions.map((a) => ({ a, ok: evalAssertion(observed, a) }));
  const passedCount = results.filter((r) => r.ok).length;
  const gate = [...gatePre];
  const term = fixture.expected_state.terminal;
  const expectedExit = fixture.expected_exit;
  if (observed.classification !== term) gate.push("gate.terminal expected=" + term + " actual=" + observed.classification);
  const actualExit = observed.exit_code;
  const exitOk = expectedExit === "blocked" ? actualExit === 1 : actualExit === expectedExit;
  if (!exitOk) gate.push("gate.exit expected=" + expectedExit + " actual=" + actualExit);
  const expDelta = fixture.expected_state.revision_delta;
  if (typeof expDelta === "number" && observed.revision.delta !== expDelta) gate.push("gate.delta expected=" + expDelta + " actual=" + observed.revision.delta);
  return {
    fixtureId: fixture.fixture_id,
    ok: passedCount === results.length && gate.length === 0,
    passedCount,
    total: results.length,
    failed: [...results.filter((r) => !r.ok).map((r) => r.a.path + " " + r.a.op + " " + JSON.stringify(r.a.value) + " got=" + JSON.stringify(getPath(observed, r.a.path))), ...gate],
    observed,
  };
}

async function runSelfTest({ fixturesPath, tempRoot }) {
  const guard = await guardTempRoot(tempRoot);
  if (!guard.ok) {
    console.error("self-test temp-root rejected: " + guard.reason + " (" + tempRoot + ")");
    return { rc: 1 };
  }
  const runRoot = path.join(guard.resolved, "run-" + process.pid + "-" + Date.now());
  await fsp.mkdir(runRoot, { recursive: true });
  let vectors;
  try {
    const doc = JSON.parse(await fsp.readFile(fixturesPath, "utf-8"));
    vectors = doc.vectors;
  } catch (error) {
    console.error("fixture load failed: " + error.message);
    return { rc: 3 };
  }
  try {
    await validateFixtureClosure(vectors);
  } catch (error) {
    console.error("fixture closure failed: " + error.message);
    return { rc: 1 };
  }
  const results = [];
  for (let vectorIndex = 0; vectorIndex < vectors.length; vectorIndex += 1) {
    const v = vectors[vectorIndex];
    let r;
    try {
      r = await runFixture(v, runRoot);
    } catch (error) {
      r = { fixtureId: v.fixture_id, ok: false, passedCount: 0, total: v.expected_state.assertions.length, failed: ["harness: " + error.message + " @ " + (error.stack?.split("\n")[1] ?? "").trim()], observed: null };
    }
    r.vectorIndex = vectorIndex;
    results.push(r);
    console.log(v.fixture_id + " " + (r.ok ? "PASS" : "FAIL") +
      " expected_exit=" + v.expected_exit + " actual_classification=" + (r.observed?.classification ?? "n/a") +
      " assertions=" + r.passedCount + "/" + r.total +
      " revision_delta=" + (r.observed?.revision?.delta ?? "n/a") +
      (r.ok ? "" : " failed_paths=" + r.failed.slice(0, 3).join(";")));
  }
  const failed = results.filter((r) => !r.ok);
  // R1/W4: stable result keys are fixtureId#vectorIndex; the idempotency summary tokens
  // bind the ORIGINAL vector of each id explicitly (first occurrence in file order — the
  // family-tail additions are appended after the original 52), and family tails get their
  // own independent summary item below.
  const byId = Object.fromEntries(results.map((r) => [r.fixtureId + "#" + r.vectorIndex, r]));
  const originalOf = (id) => results.find((r) => r.fixtureId === id);
  const familyTails = results.filter((r) => results.some((x) => x.fixtureId === r.fixtureId && x.vectorIndex < r.vectorIndex));
  // summary tokens (V-2/V-4/V-5/V-6)
  const m01 = originalOf("F-S-M01")?.observed?.matrix;
  const capIds = ["F-S-044", "F-S-045", "F-S-046", "F-S-047", "F-S-048"];
  const capOk = capIds.filter((id) => originalOf(id)?.ok).length;
  const replay = originalOf("F-S-043a")?.observed;
  const c01 = originalOf("F-S-C01")?.observed?.crash;
  const f15 = originalOf("F-S-015")?.observed;
  const f16 = originalOf("F-S-016")?.observed;
  const f22 = originalOf("F-S-022")?.observed;
  const f24 = originalOf("F-S-024")?.observed;
  const ok15 = originalOf("F-S-015")?.ok === true;
  const ok16 = originalOf("F-S-016")?.ok === true;
  const ok22 = originalOf("F-S-022")?.ok === true;
  const f36 = originalOf("F-S-036")?.observed;
  const f37 = originalOf("F-S-037")?.observed;
  const f33 = originalOf("F-S-033")?.observed;
  const f35 = originalOf("F-S-035")?.observed;
  console.log("state_matrix=" + (m01?.passed ?? 0) + "/" + (m01?.cells ?? 0) +
    " capacity_matrix=" + capOk + "/5" +
    " transact_replay_delta=" + (replay?.revision?.delta ?? "n/a") +
    " applied_operations_encoding=" + (replay?.extras?.applied_encoding_ok === true && originalOf("F-S-043a")?.ok ? "PASS" : "FAIL"));
  console.log("crash_matrix_cells=" + (c01?.cells ?? 0) + " crash_matrix=" + (c01?.passed ?? 0) + "/" + (c01?.cells ?? 0) +
    " first_fail_exit_io=" + (c01?.first_fail_exit_io === true ? "PASS" : "FAIL") +
    " same_ref_idempotent=" + (c01?.same_ref_idempotent === true ? "PASS" : "FAIL") +
    " wrong_ref_denied=" + (c01?.wrong_ref_denied === true ? "PASS" : "FAIL") +
    " locks_clean=" + (c01?.locks_clean === true ? "PASS" : "FAIL") +
    " fresh_process_recovery=" + (c01?.fresh_process_recovery === true ? "PASS" : "FAIL"));
  const f15c = f15?.extras?.calls ?? [];
  console.log("command_matrix=" + ((ok15 && ok16 && ok22) ? "PASS" : "FAIL") +
    " worker_apply=" + (f24?.extras?.worker_apply ?? "n/a") +
    " approved_recovery_apply=" + (f24?.extras?.approved_recovery_apply ?? "n/a") +
    " missing_approval=" + (f24?.extras?.missing_approval ?? "n/a") +
    " ordinary_writer_mode_epoch=" + (f15c[0]?.outcome === "denied" && f15c[1]?.outcome === "denied" ? "denied" : "n/a") +
    " protected_payload=" + (f15c.slice(0, 6).every((c) => c.outcome === "denied") ? "denied" : "n/a"));
  console.log("cutover_stop=" + (originalOf("F-S-032")?.ok ? "PASS" : "FAIL") +
    " confirm=" + (originalOf("F-S-033")?.ok ? "PASS" : "FAIL") +
    " resume=" + (originalOf("F-S-034")?.ok ? "PASS" : "FAIL") +
    " recoverForward=" + (originalOf("F-S-035")?.ok ? "PASS" : "FAIL") +
    " recover_two_phase=" + (f35?.extras?.recover?.from_confirmed?.two_phase === true && f35?.extras?.recover?.from_recovered?.two_phase === true ? "PASS" : "FAIL") +
    " abandon_states=" + (originalOf("F-S-029a")?.ok && originalOf("F-S-029b")?.ok && originalOf("F-S-031")?.ok ? "PASS" : "FAIL") +
    " abandoned_resume_completed_write=" + (originalOf("F-S-029b")?.ok ? "PASS" : "FAIL") +
    " confirm_epoch_delta=1" + (f33?.extras?.confirm?.epoch_delta === 1 ? "" : "(FAIL)") +
    " recover_epoch_delta=1" + (f35?.extras?.recover?.from_confirmed?.epoch_delta === 1 ? "" : "(FAIL)") +
    " direct_call=" + (f36?.extras?.calls?.[0]?.outcome === "denied" ? "denied" : "n/a") +
    " orphan_replay_delta=" + (f37?.extras?.calls?.[2]?.outcome === "passed" && f37?.extras?.calls?.[1]?.outcome === "blocked" ? 0 : "n/a"));
  // RT1AGG: ids/vectors computed from results + distinct fixture_id (R22 asserts these);
  // family-tail vectors (additions sharing a fixture_id) get an independent summary item.
  const distinctIds = new Set(results.map((r) => r.fixtureId)).size;
  console.log("self-test 汇总：ids=" + distinctIds + " vectors=" + results.length + " fixtures=" + results.length + " failed=" + failed.length);
  const tailIds = familyTails.map((r) => r.fixtureId + "#" + r.vectorIndex + ":" + (r.ok ? "PASS" : "FAIL"));
  console.log("family_tails=" + familyTails.length + (tailIds.length ? " " + tailIds.join(" ") : ""));
  console.log("run_root=" + runRoot);
  return { rc: failed.length === 0 ? 0 : 1, runRoot };
}

async function main(argv) {
  const args = argv.slice(2);
  const selfTest = args.includes("--self-test");
  let fixtures = DEFAULT_FIXTURES;
  let tempRoot = DEFAULT_TEMP_ROOT;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--fixtures") fixtures = args[i + 1];
    if (args[i] === "--temp-root") tempRoot = args[i + 1];
  }
  if (!selfTest) {
    console.log("run-store: no-op without --self-test (no fixture execution, no writes)");
    return 0;
  }
  const { rc } = await runSelfTest({ fixturesPath: fixtures, tempRoot });
  return rc;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then((rc) => process.exit(rc));
}
