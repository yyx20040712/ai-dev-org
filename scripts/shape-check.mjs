#!/usr/bin/env node
// shape-check.mjs — RT1C2 declarative shape library. Zero-dependency fail-closed runtime
// production code (not a test stand-in) consumed by the migrated run-recover read points.
// Surface: exactly eleven symbols, arity 1. Rejection taxonomy (RunStoreError six fields,
// retryable=false): declarator config -> invalid_shape_declaration exit=1 stage=shape.declare;
// gate argument errors -> invalid_argument exit=1; shape failure default invalid_shape (code
// overridable) exit=1; read/parse + realpath IO -> io_load_failed exit=3; hash default
// hash_mismatch / path default path_escape exit=1. Import has no side effects; only the direct
// CLI with --self-test runs fixtures. Imports: node stdlib + ./run-state.mjs only.
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { RunStoreError, canonicalJSON, sha256hex, HEX64 } from "./run-state.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES = path.join(SCRIPT_DIR, ".golden", "shape-check-fixtures.json");
const DEFAULT_TEMP_ROOT = "/tmp/rt1c2-executor-shape-selftest";
const TEMP_PREFIX = "/tmp/rt1c2-executor-";
// ----------------------------------------------------------------- shape core
const SHAPE_TAG = "rt1c2.shape/v1";
// Shape immutability: object/exactKeys/array/ref copy+freeze closure values at declaration
// time (members are frozen Shapes = full deep copy); ref.registry stays live by design.
const frozenFields = (fields) => {
  const copy = {};
  for (const [k, v] of Object.entries(fields)) copy[k] = v;
  return Object.freeze(copy);
};
const declareError = (message) => { throw new RunStoreError({ code: "invalid_shape_declaration", exitCode: 1, stage: "shape.declare", operationId: null, message }); };
const argError = (stage, message) => { throw new RunStoreError({ code: "invalid_argument", exitCode: 1, stage, operationId: null, message }); };
const isShape = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && v.$$shape === SHAPE_TAG && typeof v.check === "function";
const mkShape = (kind, spec, check) => Object.freeze({ $$shape: SHAPE_TAG, kind, spec, check });
const isSafeInt = (v) => Number.isInteger(v) && v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER;
const shapeFail = (code, stage, operationId, message) => { throw new RunStoreError({ code, exitCode: 1, stage, operationId: operationId ?? null, message }); };
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
function optionsGate(options, allowed, fnName) {
  if (options === null || options === undefined || typeof options !== "object" || Array.isArray(options)) {
    declareError(fnName + " requires exactly one options object (null/undefined/non-object denied)");
  }
  for (const k of Object.keys(options)) {
    if (!allowed.includes(k)) declareError(fnName + " options key outside the closed set: " + k);
  }
  return options;
}
// declarators: object / array / string / integer / hex64 / enum / ref / exactKeys
export function object(options) {
  const o = optionsGate(options, ["fields", "required"], "object");
  const fields = o.fields === undefined ? {} : o.fields;
  const required = o.required === undefined ? [] : o.required;
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) declareError("object.fields must be a non-null non-array object");
  for (const [k, v] of Object.entries(fields)) {
    if (!isShape(v)) declareError("object.fields." + k + " must be a Shape");
  }
  if (!Array.isArray(required) || required.some((k) => typeof k !== "string")) declareError("object.required must be an array of strings");
  const fieldKeys = new Set(Object.keys(fields));
  for (const k of required) {
    if (!fieldKeys.has(k)) declareError("object.required key not a fields member: " + k);
  }
  const frozen = frozenFields(fields);
  const requiredFrozen = Object.freeze([...required]);
  return mkShape("object", { fields: frozen, required: requiredFrozen }, (value, p) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) shapeFail("invalid_shape", "shape.check", null, p + " must be a non-null non-array object (got " + typeOf(value) + ")");
    for (const k of requiredFrozen) if (!(k in value)) shapeFail("invalid_shape", "shape.check", null, p + " is missing required key " + JSON.stringify(k));
    for (const [k, sub] of Object.entries(frozen)) if (k in value) sub.check(value[k], p + "." + k);
    return true;
  });
}
export function array(options) {
  const o = optionsGate(options, ["items", "min", "max"], "array");
  if (!("items" in o) || !isShape(o.items)) declareError("array.items must be a Shape (required)");
  const min = o.min === undefined ? 0 : o.min;
  const max = o.max === undefined ? null : o.max;
  if (!isSafeInt(min) || min < 0) declareError("array.min must be a safe non-negative integer");
  if (max !== null && (!isSafeInt(max) || max < min)) declareError("array.max must be null or a safe integer >= min");
  // R2-C5: items closure value is an immutable copy (frozen spec) — later mutations of the
  // ORIGINAL options object cannot flip validation behavior
  const items = o.items;
  const spec = Object.freeze({ items, min, max });
  return mkShape("array", spec, (value, p) => {
    if (!Array.isArray(value)) shapeFail("invalid_shape", "shape.check", null, p + " must be an array (got " + typeOf(value) + ")");
    if (value.length < min) shapeFail("invalid_shape", "shape.check", null, p + " length " + value.length + " is below min " + min);
    if (max !== null && value.length > max) shapeFail("invalid_shape", "shape.check", null, p + " length " + value.length + " is above max " + max);
    for (let i = 0; i < value.length; i += 1) items.check(value[i], p + "[" + i + "]");
    return true;
  });
}
export function string(options) {
  const o = optionsGate(options, ["min", "max", "pattern"], "string");
  const min = o.min === undefined ? 1 : o.min;
  const max = o.max === undefined ? null : o.max;
  const pattern = o.pattern === undefined ? null : o.pattern;
  if (!isSafeInt(min) || min < 0) declareError("string.min must be a safe non-negative integer");
  if (max !== null && (!isSafeInt(max) || max < min)) declareError("string.max must be null or a safe integer >= min");
  if (pattern !== null && !(pattern instanceof RegExp)) declareError("string.pattern must be a RegExp or null");
  return mkShape("string", { min, max, pattern }, (value, p) => {
    if (typeof value !== "string") shapeFail("invalid_shape", "shape.check", null, p + " must be a string (got " + typeOf(value) + ")");
    if (value.length < min) shapeFail("invalid_shape", "shape.check", null, p + " length " + value.length + " is below min " + min);
    if (max !== null && value.length > max) shapeFail("invalid_shape", "shape.check", null, p + " length " + value.length + " is above max " + max);
    if (pattern !== null) {
      pattern.lastIndex = 0; // stateless validation: never let a previous match leak through
      if (!pattern.test(value)) shapeFail("invalid_shape", "shape.check", null, p + " does not match the declared pattern");
    }
    return true;
  });
}
export function integer(options) {
  const o = optionsGate(options, ["min", "max"], "integer");
  const min = o.min === undefined ? null : o.min;
  const max = o.max === undefined ? null : o.max;
  if (min !== null && !isSafeInt(min)) declareError("integer.min must be null or a safe integer");
  if (max !== null && !isSafeInt(max)) declareError("integer.max must be null or a safe integer");
  if (min !== null && max !== null && min > max) declareError("integer.min must be <= max");
  return mkShape("integer", { min, max }, (value, p) => {
    if (typeof value !== "number" || !Number.isInteger(value) || !isSafeInt(value)) shapeFail("invalid_shape", "shape.check", null, p + " must be a safe integer (got " + typeOf(value) + ")");
    if (min !== null && value < min) shapeFail("invalid_shape", "shape.check", null, p + " is below min " + min);
    if (max !== null && value > max) shapeFail("invalid_shape", "shape.check", null, p + " is above max " + max);
    return true;
  });
}
export function hex64(options) {
  optionsGate(options, [], "hex64"); // only the empty object is a legal configuration
  return mkShape("hex64", {}, (value, p) => {
    if (typeof value !== "string" || !HEX64.test(value)) shapeFail("invalid_shape", "shape.check", null, p + " must be a 64-char lowercase hex string (got " + typeOf(value) + ")");
    return true;
  });
}
function enumShape(options) {
  const o = optionsGate(options, ["values"], "enum");
  if (!("values" in o) || !Array.isArray(o.values) || o.values.length === 0) {
    declareError("enum.values must be a non-empty array");
  }
  const seen = new Set();
  for (const v of o.values) {
    if (typeof v !== "string") declareError("enum.values entries must be strings");
    if (seen.has(v)) declareError("enum.values must be deduplicated (duplicate: " + v + ")");
    seen.add(v);
  }
  const values = Object.freeze([...o.values]);
  return mkShape("enum", { values }, (value, p) => {
    if (typeof value !== "string" || !values.includes(value)) shapeFail("invalid_shape", "shape.check", null, p + " must be strictly one of the declared values (got " + typeOf(value) + ")");
    return true;
  });
}
export { enumShape as enum };
export function ref(options) {
  const o = optionsGate(options, ["name", "registry"], "ref");
  if (!("name" in o) || typeof o.name !== "string" || o.name.length === 0) declareError("ref.name must be a non-empty string");
  if (!("registry" in o) || o.registry === null || typeof o.registry !== "object" || Array.isArray(o.registry)) {
    declareError("ref.registry must be a non-null non-array object");
  }
  // registry VALUES are validated lazily at resolution: cyclic registries stay declarable
  // (placeholder-then-fill; live registry = documented immutability exception); cycles/missing/
  // non-Shape entries reject as invalid_shape_declaration on resolution. R2-C5: name closure
  // value is an immutable copy — spec is frozen so the name cannot be swapped after construction
  const spec = Object.freeze({ name: o.name, registry: o.registry });
  return mkShape("ref", spec, (value, p) => {
    let cursor = spec;
    const chain = [];
    for (;;) {
      if (chain.includes(cursor.name)) declareError("ref resolution hit a circular reference at " + cursor.name);
      chain.push(cursor.name);
      const entry = cursor.registry[cursor.name];
      if (entry === undefined) declareError("ref registry has no entry named " + cursor.name + " (missing name)");
      if (!isShape(entry)) declareError("ref registry entry is not a Shape: " + cursor.name);
      if (entry.kind !== "ref") return entry.check(value, p);
      cursor = entry.spec;
    }
  });
}
export function exactKeys(options) {
  const o = optionsGate(options, ["fields", "required"], "exactKeys");
  if (!("fields" in o) || o.fields === null || typeof o.fields !== "object" || Array.isArray(o.fields)) {
    declareError("exactKeys.fields must be a non-null non-array object (required)");
  }
  for (const [k, v] of Object.entries(o.fields)) {
    if (!isShape(v)) declareError("exactKeys.fields." + k + " must be a Shape");
  }
  const required = o.required === undefined ? Object.keys(o.fields) : o.required;
  if (!Array.isArray(required) || required.some((k) => typeof k !== "string")) declareError("exactKeys.required must be an array of strings");
  const fieldKeys = new Set(Object.keys(o.fields));
  for (const k of required) {
    if (!fieldKeys.has(k)) declareError("exactKeys.required key not a fields member: " + k);
  }
  const frozen = frozenFields(o.fields);
  const requiredFrozen = Object.freeze([...required]);
  return mkShape("exactKeys", { fields: frozen, required: requiredFrozen }, (value, p) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) shapeFail("invalid_shape", "shape.check", null, p + " must be a non-null non-array object (got " + typeOf(value) + ")");
    for (const k of Object.keys(value)) if (!fieldKeys.has(k)) shapeFail("invalid_shape", "shape.check", null, p + " carries a key outside the declared closed set: " + JSON.stringify(k));
    for (const k of requiredFrozen) if (!(k in value)) shapeFail("invalid_shape", "shape.check", null, p + " is missing required key " + JSON.stringify(k));
    for (const [k, sub] of Object.entries(frozen)) if (k in value) sub.check(value[k], p + "." + k);
    return true;
  });
}
// gates: shared argument gate / readShape / verifyHash / withinRoot
function gateArgs(options, allowed, fnName, defStage) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) argError(defStage, fnName + " requires exactly one options object");
  for (const k of Object.keys(options)) if (!allowed.includes(k)) argError(defStage, fnName + " options key outside the closed set: " + k);
  if (typeof options.stage !== "string" || options.stage.length === 0) argError(defStage, fnName + ".stage must be a non-empty string");
  const operationId = options.operationId !== undefined && options.operationId !== null ? String(options.operationId) : null;
  return { stage: options.stage, operationId };
}
export async function readShape(options) {
  const { stage, operationId } = gateArgs(options, ["file", "value", "shape", "stage", "operationId", "code"], "readShape", "shape.read");
  const hasFile = Object.prototype.hasOwnProperty.call(options, "file") && options.file !== undefined;
  const hasValue = Object.prototype.hasOwnProperty.call(options, "value") && options.value !== undefined;
  if (hasFile && hasValue) argError(stage, "readShape accepts exactly one of file/value (both given)");
  if (!hasFile && !hasValue) argError(stage, "readShape accepts exactly one of file/value (neither given)");
  if (!isShape(options.shape)) argError(stage, "readShape.shape must be a Shape");
  const code = options.code === undefined ? "invalid_shape" : options.code;
  if (typeof code !== "string" || code.length === 0) argError(stage, "readShape.code must be a non-empty string");
  let value = options.value;
  if (hasFile) {
    if (typeof options.file !== "string" || options.file.length === 0) argError(stage, "readShape.file must be a non-empty string");
    let text;
    try {
      text = await fsp.readFile(options.file, "utf-8");
    } catch (error) {
      throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage, operationId, message: "readShape file read failed " + options.file + ": " + error.code });
    }
    try { value = JSON.parse(text); } catch (error) {
      throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage, operationId, message: "readShape JSON parse failed at " + options.file + ": " + String(error?.message ?? error) });
    }
  }
  try {
    options.shape.check(value, "$");
  } catch (error) {
    if (error instanceof RunStoreError && error.code === "invalid_shape" && error.stage === "shape.check") {
      throw new RunStoreError({ code, exitCode: 1, stage, operationId, message: "shape failure at " + stage + ": " + error.message });
    }
    throw error;
  }
  return value;
}
export function verifyHash(options) {
  const { stage, operationId } = gateArgs(options, ["value", "expected", "exclude", "raw", "stage", "operationId", "code"], "verifyHash", "shape.hash");
  const expected = options.expected;
  if (typeof expected !== "string" || !HEX64.test(expected)) argError(stage, "verifyHash.expected must be a 64-char lowercase hex string");
  const exclude = options.exclude === undefined ? [] : options.exclude;
  if (!Array.isArray(exclude) || exclude.some((k) => typeof k !== "string")) argError(stage, "verifyHash.exclude must be an array of strings");
  const raw = options.raw === undefined ? false : options.raw;
  if (typeof raw !== "boolean") argError(stage, "verifyHash.raw must be a boolean");
  const code = options.code === undefined ? "hash_mismatch" : options.code;
  if (typeof code !== "string" || code.length === 0) argError(stage, "verifyHash.code must be a non-empty string");
  let digest;
  if (raw) {
    if (typeof options.value !== "string") argError(stage, "verifyHash.value must be a string when raw=true");
    digest = sha256hex(options.value);
  } else {
    if (options.value === null || typeof options.value !== "object") argError(stage, "verifyHash.value must be an object when raw=false");
    let copy;
    try { copy = structuredClone(options.value); }
    catch (error) { argError(stage, "verifyHash value is not cloneable: " + String(error?.message ?? error)); }
    for (const k of exclude) delete copy[k];
    try { digest = sha256hex(canonicalJSON(copy)); }
    catch (error) { argError(stage, "verifyHash canonical serialization failed: " + String(error?.message ?? error)); }
  }
  if (digest !== expected) {
    throw new RunStoreError({ code, exitCode: 1, stage, operationId, message: "hash mismatch at " + stage + ": recomputed " + digest + " != expected " + expected });
  }
  return true;
}
export async function withinRoot(options) {
  const { stage, operationId } = gateArgs(options, ["root", "target", "stage", "operationId", "allowMissing", "rejectDotDot", "code"], "withinRoot", "shape.path");
  if (typeof options.root !== "string" || options.root.length === 0) argError(stage, "withinRoot.root must be a non-empty string");
  if (typeof options.target !== "string" || options.target.length === 0) argError(stage, "withinRoot.target must be a non-empty string");
  const allowMissing = options.allowMissing === undefined ? true : options.allowMissing;
  const rejectDotDot = options.rejectDotDot === undefined ? true : options.rejectDotDot;
  if (typeof allowMissing !== "boolean") argError(stage, "withinRoot.allowMissing must be a boolean");
  if (typeof rejectDotDot !== "boolean") argError(stage, "withinRoot.rejectDotDot must be a boolean");
  const code = options.code === undefined ? "path_escape" : options.code;
  if (typeof code !== "string" || code.length === 0) argError(stage, "withinRoot.code must be a non-empty string");
  const fail = (message) => {
    throw new RunStoreError({ code, exitCode: 1, stage, operationId, message });
  };
  const ioFail = (message) => {
    throw new RunStoreError({ code: "io_load_failed", exitCode: 3, stage, operationId, message });
  };
  // frozen order: arguments -> lexical (..) -> existence -> realpath containment.
  // lexical gate is a LITERAL substring test: "zzz..evil.json" is denied like "a/../b" (ruling rt1c2-preruling-4 ①)
  if (rejectDotDot && options.target.includes("..")) {
    fail("withinRoot target contains a literal '..' (rejected before lexical folding): " + options.target);
  }
  const resolvedRoot = path.resolve(options.root);
  const resolvedTarget = path.resolve(options.target);
  const underStrict = (child, base) => base === "/" ? child !== "/" : (child !== base && child.startsWith(base + path.sep));
  // root="/" special case: resolvedRoot + sep would be "//" and reject every absolute target
  if (resolvedRoot === "/") {
    if (resolvedTarget === "/") fail("withinRoot target is not a strict descendant of root: / vs /");
  } else if (!underStrict(resolvedTarget, resolvedRoot)) {
    fail("withinRoot target is not a strict descendant of root: " + resolvedTarget + " vs " + resolvedRoot);
  }
  const realContainment = async (candidate) => {
    let realRoot, realCandidate;
    try {
      realRoot = await fsp.realpath(resolvedRoot);
      realCandidate = await fsp.realpath(candidate);
    } catch (error) {
      ioFail("withinRoot realpath failed (" + (error?.code ?? String(error?.message ?? error)) + "): " + candidate);
    }
    if (!underStrict(realCandidate, realRoot)) {
      fail("withinRoot realpath escapes root (symlink or aliasing): " + realCandidate + " vs " + realRoot);
    }
    return realCandidate;
  };
  // existence probe with permission classification: existsSync cannot tell ENOENT from EACCES,
  // so statSync error codes decide — only ENOENT means "missing", real IO failures fail exit3
  const statCode = (p) => {
    try { fs.statSync(p); return null; }
    catch (error) { return error?.code ?? "EIO"; }
  };
  // R2-C2: lstat identifies the dirent link BODY — a dangling symlink can never complete a
  // realpath containment proof: reject fail-closed, never release as an ordinary missing leaf
  const lstatIsLink = (p) => {
    try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
  };
  const targetStat = statCode(resolvedTarget);
  if (targetStat === null) {
    await realContainment(resolvedTarget);
    return resolvedTarget;
  }
  if (targetStat !== "ENOENT") ioFail("withinRoot existence probe failed (" + targetStat + "): " + resolvedTarget);
  if (lstatIsLink(resolvedTarget)) fail("withinRoot target is a dangling symlink (no realpath containment proof possible): " + resolvedTarget);
  if (!allowMissing) ioFail("withinRoot target missing while allowMissing=false: " + resolvedTarget);
  // missing target (missing root included): walk the deepest EXISTING ancestors of target and
  // root; the ancestor must stay inside the root ancestor after realpath (symlink alias = escape)
  const deepestExisting = (start) => {
    let p = start;
    for (;;) {
      const c = statCode(p);
      if (c === null) return p;
      if (c !== "ENOENT") ioFail("withinRoot ancestor probe failed (" + c + "): " + p);
      if (lstatIsLink(p)) fail("withinRoot ancestor is a dangling symlink (no containment proof): " + p);
      const next = path.dirname(p);
      if (next === p) return null;
      p = next;
    }
  };
  const ancTarget = deepestExisting(resolvedTarget);
  const ancRoot = deepestExisting(resolvedRoot);
  if (ancRoot === null || ancTarget === null) ioFail("withinRoot ancestor chain unreachable for target/root: " + resolvedTarget + " vs " + resolvedRoot);
  let realAncRoot, realAncTarget;
  try {
    realAncRoot = await fsp.realpath(ancRoot);
    realAncTarget = await fsp.realpath(ancTarget);
  } catch (error) {
    ioFail("withinRoot ancestor realpath failed (" + (error?.code ?? String(error?.message ?? error)) + "): " + ancTarget);
  }
  if (realAncTarget === realAncRoot || underStrict(realAncTarget, realAncRoot)) return resolvedTarget;
  fail("withinRoot deepest existing ancestor escapes root via realpath: " + realAncTarget + " vs " + realAncRoot);
}
// ------------------------------------------------------- self-test harness (CLI only)
const isDslNode = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && typeof v.$ === "string";
function compileDsl(node) {
  if (!isDslNode(node)) {
    throw new Error("fixture DSL node must be an object with a $ kind");
  }
  const opt = { ...node };
  delete opt.$;
  if (opt.fields !== undefined && opt.fields !== null && typeof opt.fields === "object" && !Array.isArray(opt.fields)) {
    // non-DSL member values pass through raw so the declarator itself rejects them
    opt.fields = Object.fromEntries(Object.entries(opt.fields).map(([k, v]) => [k, isDslNode(v) ? compileDsl(v) : v]));
  }
  if (isDslNode(opt.items)) opt.items = compileDsl(opt.items);
  if (opt.pattern !== undefined && opt.pattern !== null && typeof opt.pattern === "object") {
    opt.pattern = new RegExp(opt.pattern.source, opt.pattern.flags ?? "");
  }
  if (opt.registry !== undefined && opt.registry !== null && typeof opt.registry === "object" && !Array.isArray(opt.registry)) {
    opt.registry = Object.fromEntries(Object.entries(opt.registry).map(([k, v]) => [k, isDslNode(v) ? compileDsl(v) : v]));
  }
  const fns = { object, array, string, integer, hex64, enum: enumShape, ref, exactKeys };
  const fn = fns[node.$];
  if (!fn) throw new Error("unknown DSL kind " + node.$);
  compileDsl.lastOptions = opt; // harness side channel: exact object handed to the declarator
  return fn(opt);
}

async function guardTempRoot(tempRoot) {
  if (typeof tempRoot !== "string" || tempRoot.length === 0) return { ok: false, reason: "empty" };
  const resolved = path.resolve(tempRoot);
  if (!resolved.startsWith(TEMP_PREFIX)) return { ok: false, reason: "prefix" };
  if (resolved.includes("..")) return { ok: false, reason: "traversal" };
  let real;
  try {
    real = await fsp.realpath(resolved);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    let probe = path.dirname(resolved);
    for (;;) {
      try { real = await fsp.realpath(probe); break; }
      catch (e2) { if (e2.code === "ENOENT" && probe !== path.dirname(probe)) probe = path.dirname(probe); else throw e2; }
    }
    if (real !== probe) return { ok: false, reason: "symlink_escape" };
    if (probe !== "/tmp" && !probe.startsWith(TEMP_PREFIX)) return { ok: false, reason: "ancestor_escape" };
    return { ok: true, reason: null, resolved };
  }
  if (real !== resolved && !real.startsWith(TEMP_PREFIX)) return { ok: false, reason: "symlink_escape" };
  return { ok: true, reason: null, resolved };
}

// chmod fixtures (0o000 dirs) would defeat a later rm -rf on a REUSED temp root: restore
// traversability first so repeated runs stay idempotent. lstat only — never follow symlinks.
async function unfreezeTree(p) {
  let st;
  try { st = await fsp.lstat(p); } catch { return; }
  if (st.isDirectory()) {
    try { await fsp.chmod(p, 0o700); } catch { /* leave as-is */ }
    for (const e of await fsp.readdir(p)) await unfreezeTree(path.join(p, e));
  }
}

async function materializeSandbox(dir, sandbox) {
  await unfreezeTree(dir).catch(() => {});
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(dir, { recursive: true });
  for (const d of sandbox.dirs ?? []) await fsp.mkdir(path.join(dir, d), { recursive: true });
  for (const [name, content] of Object.entries(sandbox.files ?? {})) {
    const target = path.join(dir, name);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, String(content), "utf-8");
  }
  for (const [link, target] of Object.entries(sandbox.links ?? {})) {
    const linkPath = path.join(dir, link);
    await fsp.mkdir(path.dirname(linkPath), { recursive: true });
    await fsp.symlink(target, linkPath).catch((e) => { if (e.code !== "EEXIST") throw e; });
  }
  // harness-only chmod (e.g. 0o000 dirs) so permission failures are real FS
  for (const [name, mode] of Object.entries(sandbox.chmod ?? {})) {
    await fsp.chmod(path.join(dir, name), mode).catch((e) => { throw new Error("sandbox chmod failed for " + name + ": " + e.code); });
  }
}

function errorView(error) {
  if (!error) return null;
  const fieldsOk = ["code", "exitCode", "stage", "operationId", "message", "retryable"].every((k) => k in error)
    && typeof error.code === "string" && error.code.length > 0 && Number.isInteger(error.exitCode) && typeof error.stage === "string" && error.stage.length > 0
    && (error.operationId === null || typeof error.operationId === "string") && typeof error.message === "string" && error.message.length > 0 && error.retryable === false;
  return { code: typeof error.code === "string" ? error.code : "unexpected", exitCode: Number.isInteger(error.exitCode) ? error.exitCode : 1,
    stage: typeof error.stage === "string" ? error.stage : "unknown", operationId: error.operationId ?? null, retryableIsFalse: error.retryable === false, fieldsOk };
}

async function runSelfTest({ fixturesPath, tempRoot }) {
  let doc;
  try { doc = JSON.parse(await fsp.readFile(fixturesPath, "utf-8")); }
  catch (error) { console.error("shape-check: fixtures load failed: " + String(error?.message ?? error)); return 3; }
  if (doc.schema_version !== "shape-check-fixtures/v1" || !Array.isArray(doc.mutation_targets) || !Array.isArray(doc.vectors)) {
    console.error("shape-check: fixtures schema mismatch (schema_version/mutation_targets/vectors)"); return 3;
  }
  const MECHS = new Set(["object", "array", "string", "integer", "hex64", "enum", "ref", "exactKeys", "readShape", "verifyHash", "withinRoot"]);
  const DECLARATORS = new Set(["object", "array", "string", "integer", "hex64", "enum", "ref", "exactKeys"]);
  for (const v of doc.vectors) {
    const keys = Object.keys(v);
    const bad = keys.length !== 5 || !["fixture_id", "mechanism", "input", "expected", "mutation_tag"].every((k) => keys.includes(k))
      || !MECHS.has(v.mechanism) || (v.mutation_tag !== null && !doc.mutation_targets.includes(v.mutation_tag))
      || (v.expected.polarity !== "positive" && v.expected.polarity !== "negative");
    if (bad) { console.error("shape-check: vector schema violated at " + v.fixture_id); return 3; }
  }  const usedTags = new Set(doc.vectors.filter((v) => v.mutation_tag !== null).map((v) => v.mutation_tag));
  if (usedTags.size !== doc.mutation_targets.length || !doc.mutation_targets.every((t) => usedTags.has(t))) { console.error("shape-check: mutation_targets not exactly covered by fixtures"); return 3; }
  // builtin ref registries (JSON cannot express cyclic registries)
  const chainRegistry = {};
  chainRegistry.n3 = string({}); chainRegistry.n2 = ref({ name: "n3", registry: chainRegistry }); chainRegistry.n1 = ref({ name: "n2", registry: chainRegistry });
  const loopRegistry = {};
  loopRegistry.a = ref({ name: "b", registry: loopRegistry }); loopRegistry.b = ref({ name: "a", registry: loopRegistry });
  // builtin patches: JSON cannot express cyclic registries/functions/BigInt; verifyHash rejects
  const BUILTINS = {
    chain: { name: "n1", registry: chainRegistry },
    loop: { name: "a", registry: loopRegistry },
    uncloneable: { value: { fn: () => 1 } },
    bigintvalue: { value: { n: 10n } },
  };
  const runRoot = path.join(tempRoot, "run");
  await fsp.mkdir(runRoot, { recursive: true });
  let failed = 0;
  let skipped = 0;
  const groups = { declarators: { ok: true, n: 0 }, read: { ok: true, n: 0 }, hash: { ok: true, n: 0 }, path: { ok: true, n: 0 }, errors: { ok: true, n: 0 } };
  const seenErrorSurfaces = [];
  for (const v of doc.vectors) {
    const sandboxDir = path.join(runRoot, v.fixture_id);
    if (v.input.sandbox) await materializeSandbox(sandboxDir, v.input.sandbox);
    const call = v.input.call;
    let actual = { ok: false, error: { code: "not_run", exitCode: 1 } };
    const repeat = v.input.repeat ?? 1;
    try {
      let fnOptions = call.options;
      if (fnOptions !== null && typeof fnOptions === "object" && !Array.isArray(fnOptions)) {
        fnOptions = JSON.parse(JSON.stringify(fnOptions).split("$SANDBOX").join(sandboxDir));
        if (typeof fnOptions.builtin === "string" && BUILTINS[fnOptions.builtin]) {
          const patch = BUILTINS[fnOptions.builtin];
          const merged = { ...fnOptions };
          delete merged.builtin;
          fnOptions = { ...merged, ...patch };
        } else if (DECLARATORS.has(call.fn)) {
          fnOptions = compileDsl({ $: call.fn, ...fnOptions }); // nested DSL -> Shapes (declare errors surface here)
        } else if (isDslNode(fnOptions.shape)) {
          fnOptions.shape = compileDsl(fnOptions.shape);
        }
      }
      const fns = { object, array, string, integer, hex64, enum: enumShape, ref, exactKeys, readShape, verifyHash, withinRoot };
      const fn = fns[call.fn];
      if (!fn) throw new Error("unknown fn " + call.fn);
      if (DECLARATORS.has(call.fn)) {
        // compiled options already ARE the Shape; invalid ones go through fn() so the
        // declaration error surfaces from the function body
        const shape = fnOptions !== null && typeof fnOptions === "object" && fnOptions.$$shape === "rt1c2.shape/v1" ? fnOptions : fn(fnOptions);
        actual = { ok: true };
        if (call.mutateAfterDeclare === true) {
          // immutability probe: mutating the ORIGINAL options object AND the declared Shape's spec
          // after construction must never change behavior (ref.registry = live exception)
          const passed = compileDsl.lastOptions;
          try {
            if (passed && typeof passed === "object") {
              if (passed.fields && typeof passed.fields === "object" && !Array.isArray(passed.fields)) {
                passed.fields.a = compileDsl({ $: "hex64" });
                passed.required = ["zzz"];
              }
              if (passed.items !== undefined) passed.items = compileDsl({ $: "hex64" }); // R2-C5 items+name
              if (typeof passed.name === "string") passed.name = "mutated-after-declare"; // R2-C5 closures
            }
            if (shape && shape.spec && typeof shape.spec === "object") {
              shape.spec.name = "mutated-after-declare"; shape.spec.items = compileDsl({ $: "hex64" }); shape.spec.min = 99; // R2-C5: frozen spec rejects
            }
          } catch { /* strict-mode frozen-spec writes throw; behavior must stay unchanged */ }
        }
        if (call.value !== undefined && v.expected.phase === "check") {
          for (let i = 0; i < repeat; i += 1) shape.check(call.value, "$");
        }
      } else if (call.fn === "verifyHash") {
        actual = { ok: true, returns: fn(fnOptions) };
      } else {
        actual = { ok: true, returns: await fn(fnOptions) };
      }
    } catch (error) {
      const view = errorView(error);
      seenErrorSurfaces.push(view);
      if (!view.fieldsOk) groups.errors.ok = false;
      if (view.code === "invalid_shape_declaration" && view.stage !== "shape.declare") groups.errors.ok = false;
      actual = { ok: false, error: view };
    }
    const exp = v.expected;
    const wantReturns = typeof exp.returns === "string" && exp.returns.includes("$SANDBOX") ? exp.returns.split("$SANDBOX").join(sandboxDir) : exp.returns;
    const ok = exp.polarity === "positive"
      ? actual.ok === true && (exp.returns === undefined || JSON.stringify(actual.returns) === JSON.stringify(wantReturns))
      : actual.ok === false && actual.error.code === exp.code && actual.error.exitCode === exp.exitCode;
    const group = DECLARATORS.has(call.fn) ? "declarators" : call.fn === "readShape" ? "read" : call.fn === "verifyHash" ? "hash" : "path";
    groups[group].n += 1;
    if (!ok) { failed += 1; groups[group].ok = false; }
    const expView = exp.polarity === "positive" ? { polarity: "positive" } : { polarity: "negative", code: exp.code, exitCode: exp.exitCode };
    console.log(`${ok ? "PASS" : "FAIL"} ${v.fixture_id} mechanism=${v.mechanism} expected=${JSON.stringify(expView)} actual=${JSON.stringify(actual.ok ? { ok: true } : { ok: false, error: actual.error })} exitCode=${actual.ok ? 0 : actual.error.exitCode} mutation_tag=${v.mutation_tag}`);
  }
  if (seenErrorSurfaces.length === 0) groups.errors.ok = false;
  console.log(`shape_declarators=${groups.declarators.ok && groups.declarators.n > 0 ? "PASS" : "FAIL"} shape_read=${groups.read.ok && groups.read.n > 0 ? "PASS" : "FAIL"} shape_hash=${groups.hash.ok && groups.hash.n > 0 ? "PASS" : "FAIL"} shape_path=${groups.path.ok && groups.path.n > 0 ? "PASS" : "FAIL"} shape_errors=${groups.errors.ok ? "PASS" : "FAIL"} failed=${failed} skip=${skipped}`);
  return failed === 0 && skipped === 0 && Object.values(groups).every((g) => g.ok) ? 0 : 1;
}

async function main(argv) {
  const args = argv.slice(2);
  const selfTest = args.includes("--self-test");
  let fixtures = DEFAULT_FIXTURES;
  let tempRoot = DEFAULT_TEMP_ROOT;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--fixtures") { fixtures = args[i + 1]; i += 1; }
    else if (args[i] === "--temp-root") { tempRoot = args[i + 1]; i += 1; }
    else if (args[i] === "--self-test") { /* flag */ }
    else {
      console.error("shape-check: unknown argument " + args[i] + " (accepted: --self-test --fixtures <path> --temp-root <path>)");
      return 1;
    }
  }
  if (!selfTest) {
    console.log("shape-check: no-op without --self-test (no fixture execution, no writes)");
    return 0;
  }
  const guard = await guardTempRoot(tempRoot);
  if (!guard.ok) { console.error("temp-root rejected (" + guard.reason + "): " + tempRoot); return 1; }
  if (!fs.existsSync(fixtures)) { console.error("shape-check: fixtures file missing: " + fixtures); return 3; }
  return await runSelfTest({ fixturesPath: fixtures, tempRoot: guard.resolved });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then((rc) => process.exit(rc));
}
