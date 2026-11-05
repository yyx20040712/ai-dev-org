// run-state.mjs — RT1A versioned-store helper module (green phase)
// Owns: canonical JSON, sha256, RunStoreError, revision self-hash/lineage,
// the shared atomic-write helper (temp write -> file fsync -> parent fsync ->
// rename -> parent fsync -> readback) and validateRevision.
// Dependency direction is run-store -> run-state only (no cycles).
import { createHash } from "node:crypto";
import { open, rename, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const GENESIS_PARENT_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
export const GENESIS_JOURNAL_HEAD = "6a6f75726e616c30303030303030303030303030303030303030303030303030";
export const HEX64 = /^[0-9a-f]{64}$/;

export function canonicalJSON(value) {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new TypeError("canonicalJSON: floats are forbidden");
    }
    return String(value);
  }
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJSON).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON(value[k])).join(",") + "}";
  }
  throw new TypeError("canonicalJSON: unsupported type " + typeof value);
}

export function sha256hex(value) {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

export class RunStoreError extends Error {
  constructor({ code, exitCode, stage, operationId, message, retryable = false }) {
    super(message);
    Object.defineProperty(this, "name", { value: "RunStoreError", enumerable: false });
    this.code = String(code);
    this.exitCode = Number.isInteger(exitCode) ? exitCode : 1;
    this.stage = String(stage);
    this.operationId = operationId === null || operationId === undefined ? null : String(operationId);
    Object.defineProperty(this, "message", { value: String(message), enumerable: true, writable: true, configurable: true });
    this.retryable = false;
  }
}

const RSE_KEYS = ["code", "exitCode", "stage", "operationId", "message", "retryable"];

export function isRunStoreErrorFields(error) {
  if (!error || typeof error !== "object") return false;
  const own = Object.keys(error);
  if (own.length !== RSE_KEYS.length || !RSE_KEYS.every((k) => own.includes(k))) return false;
  if (typeof error.code !== "string" || error.code.length === 0) return false;
  if (!Number.isInteger(error.exitCode)) return false;
  if (typeof error.stage !== "string" || error.stage.length === 0) return false;
  if (error.operationId !== null && typeof error.operationId !== "string") return false;
  if (typeof error.message !== "string" || error.message.length === 0) return false;
  if (error.retryable !== false) return false;
  return true;
}

export function stripForSelfHash(revision) {
  const copy = structuredClone(revision);
  delete copy.self_hash;
  if (copy.producer_operation && typeof copy.producer_operation === "object") {
    const po = { ...copy.producer_operation };
    delete po.hash;
    copy.producer_operation = po;
  }
  return copy;
}

export function computeSelfHash(revision) {
  return sha256hex(canonicalJSON(stripForSelfHash(revision)));
}

export function computeApprovalHash(approvalDoc) {
  const copy = structuredClone(approvalDoc);
  delete copy.approvalHash;
  return sha256hex(canonicalJSON(copy));
}

async function fsyncDirectory(dir) {
  const fh = await open(dir, "r");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

// Shared atomic-write helper for state/highwater/authority/journal.
// Order is fixed: temp write -> file fsync -> parent fsync -> rename ->
// parent fsync -> readback. ioAdapter enables self-test fault injection;
// recordPhase captures the probe order (F-S-041).
export async function atomicWrite(filePath, data, ioAdapter, recordPhase) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, "." + path.basename(filePath) + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2));
  const io = ioAdapter ?? {};
  const write = io.writeFile ?? (async (p, d) => {
    const fh = await open(p, "w");
    try {
      await fh.writeFile(d, "utf-8");
      return fh;
    } catch (e) {
      await fh.close();
      throw e;
    }
  });
  const fsyncFileFn = io.fsyncFile ?? (async (p, fh) => { await fh.sync(); });
  const fsyncDirFn = io.fsyncDir ?? fsyncDirectory;
  const renameFn = io.rename ?? rename;
  const read = io.readFile ?? ((p) => readFile(p, "utf-8"));
  const rec = recordPhase ?? (() => {});
  rec("write");
  const fh = await write(tmp, data);
  try {
    rec("fsync_file");
    await fsyncFileFn(tmp, fh);
  } finally {
    await fh.close();
  }
  rec("fsync_parent");
  await fsyncDirFn(dir);
  rec("rename");
  await renameFn(tmp, filePath);
  rec("fsync_parent");
  await fsyncDirFn(dir);
  rec("readback");
  const back = await read(filePath, "utf-8");
  if (back !== data) {
    throw new RunStoreError({ code: "io_readback", exitCode: 3, stage: "readback", operationId: null, message: "atomic write readback mismatch at " + filePath });
  }
  return true;
}

export function revisionFilePath(projectDir, stateUuid, revision) {
  return path.join(projectDir, ".zcode", "runtime", "state", stateUuid, "r-" + revision + ".json");
}

const REVISION_REQUIRED = ["schema", "state_uuid", "revision", "owner_session_id", "parent_revision",
  "parent_hash", "self_hash", "active_run", "queue", "effects", "authorization", "reviews",
  "sessions", "pending_closures", "applied_operations", "pending_audit"];

// validateRevision({ revisionPath }) -> { valid, selfHash, parentHash }
// - structure / self-hash / parent-lineage mismatch => valid=false (no repair)
// - read / parse failures throw RunStoreError exitCode=3
export async function validateRevision({ revisionPath }) {
  if (typeof revisionPath !== "string" || revisionPath.length === 0) {
    throw new RunStoreError({ code: "invalid_argument", exitCode: 3, stage: "validate_revision", operationId: null, message: "revisionPath required" });
  }
  let text;
  try {
    text = await readFile(revisionPath, "utf-8");
  } catch (error) {
    throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "validate_revision.load", operationId: null, message: "read failed: " + error.code });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "validate_revision.parse", operationId: null, message: "revision file is not valid JSON" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "validate_revision.parse", operationId: null, message: "revision payload is not an object" });
  }
  const missing = REVISION_REQUIRED.filter((k) => !(k in parsed));
  if (missing.length > 0) {
    return { valid: false, selfHash: null, parentHash: null };
  }
  const recomputed = computeSelfHash(parsed);
  const declared = typeof parsed.self_hash === "string" ? parsed.self_hash : null;
  if (declared === null || declared !== recomputed) {
    return { valid: false, selfHash: HEX64.test(recomputed) ? recomputed : null, parentHash: null };
  }
  // parent lineage: genesis parent is revision 0 with the reserved parent hash;
  // non-genesis revisions require a readable parent whose self_hash matches.
  const parentRevision = parsed.parent_revision;
  const parentHash = typeof parsed.parent_hash === "string" ? parsed.parent_hash : null;
  if (parentHash === null || !HEX64.test(parentHash)) {
    return { valid: false, selfHash: recomputed, parentHash: null };
  }
  if (parsed.revision === 0 && parentRevision === 0) {
    if (parentHash !== GENESIS_PARENT_HASH) {
      return { valid: false, selfHash: recomputed, parentHash };
    }
    return { valid: true, selfHash: recomputed, parentHash };
  }
  if (parentRevision !== parsed.revision - 1) {
    return { valid: false, selfHash: recomputed, parentHash };
  }
  const parentFile = path.join(path.dirname(revisionPath), "r-" + parentRevision + ".json");
  let parentText;
  try {
    parentText = await readFile(parentFile, "utf-8");
  } catch (error) {
    throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "validate_revision.parent_load", operationId: null, message: "parent revision read failed: " + error.code });
  }
  let parentParsed;
  try {
    parentParsed = JSON.parse(parentText);
  } catch {
    throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage: "validate_revision.parent_parse", operationId: null, message: "parent revision is not valid JSON" });
  }
  const parentSelf = typeof parentParsed.self_hash === "string" ? parentParsed.self_hash : null;
  if (parentSelf === null || parentSelf !== parentHash || parentParsed.state_uuid !== parsed.state_uuid) {
    return { valid: false, selfHash: recomputed, parentHash };
  }
  return { valid: true, selfHash: recomputed, parentHash };
}
