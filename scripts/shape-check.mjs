#!/usr/bin/env node
// shape-check.mjs — RT1C2 declarative shape library. Zero-dependency fail-closed runtime
// production code (not a test stand-in) consumed by the migrated run-recover read points.
// RT1AGG adds shapeFromSchema (schema->Shape compiler, sync/pure/fail-closed): exactly
// twelve symbols, arity 1. Rejection taxonomy (RunStoreError six fields,
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
    for (const k of requiredFrozen) if (!Object.hasOwn(value, k)) shapeFail("invalid_shape", "shape.check", null, p + " is missing required key " + JSON.stringify(k)); // R1/B4: own-property only — prototype keys never satisfy required
    for (const [k, sub] of Object.entries(frozen)) if (Object.hasOwn(value, k)) sub.check(value[k], p + "." + k);
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
// ------------------------------------------------- schema -> Shape compiler (RT1AGG)
// shapeFromSchema: synchronous, pure, fail-closed draft-07 subset compiler. Zero file or
// network I/O; the caller hands over parsed schema documents. Compile/declare/ref errors
// throw invalid_shape_declaration @ shape.declare; value failures follow the library
// taxonomy (invalid_shape @ shape.check). Content-addressed process cache: same def +
// same transitive content returns the SAME frozen Shape; different content never hits.
const SCHEMA_METADATA_KEYS = new Set(["description", "$schema", "$defs"]);
const SCHEMA_TYPE_NAMES = new Set(["object", "array", "string", "integer", "boolean", "null"]);
const SCHEMA_ROOT_KEY = "cutover.schema.json"; // the root schema binds itself under this basename
const SCHEMA_SHAPE_CACHE = new Map();
const schemaCompileError = (message) => { throw new RunStoreError({ code: "invalid_shape_declaration", exitCode: 1, stage: "shape.declare", operationId: null, message: "shapeFromSchema: " + message }); };
// R1/N1: composite branches swallow VALUE-LEVEL failures only; declaration-class errors
// (lazy ref resolution: circular/missing/non-Shape) propagate out of oneOf/anyOf/not/elsewhere
const isValueLevelFailure = (e) => e instanceof RunStoreError && e.code === "invalid_shape" && e.stage === "shape.check";
const anyShape = () => mkShape("schemaAny", {}, () => true);
const neverShape = mkShape("schemaNever", {}, (v, p) => { shapeFail("invalid_shape", "shape.check", null, p + " is rejected by the boolean false schema"); });
const dateTimeShape = mkShape("schemaDateTime", {}, (v, p) => {
  // used WITH a type sibling: strings must parse finite; other types defer to the type part
  if (typeof v === "string" && !Number.isFinite(Date.parse(v))) shapeFail("invalid_shape", "shape.check", null, p + " must be a date-time string with a finite Date.parse value (got " + JSON.stringify(v) + ")");
  return true;
});
const strictDateTimeShape = mkShape("schemaStrictDateTime", {}, (v, p) => {
  // R1/N2: format:date-time WITHOUT a type sibling is string-only (non-strings reject)
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v))) shapeFail("invalid_shape", "shape.check", null, p + " must be a date-time string with a finite Date.parse value (got " + typeOf(v) + ")");
  return true;
});
const objectOnly = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const conditionalObject = (inner) => mkShape("schemaObjectIf", { inner }, (v, p) => (objectOnly(v) ? inner.check(v, p) : true));
const conditionalString = (inner) => mkShape("schemaStringIf", { inner }, (v, p) => (typeof v === "string" ? inner.check(v, p) : true));
const conditionalArray = (inner) => mkShape("schemaArrayIf", { inner }, (v, p) => (Array.isArray(v) ? inner.check(v, p) : true));
function unionShape(members) {
  const frozen = Object.freeze([...members]);
  return mkShape("schemaUnion", { members: frozen }, (v, p) => {
    for (const m of frozen) {
      let ok = true;
      try { m.check(v, p); } catch (e) { if (!isValueLevelFailure(e)) throw e; ok = false; }
      if (ok) return true;
    }
    shapeFail("invalid_shape", "shape.check", null, p + " must match one of the declared types");
  });
}
function allOfShape(branches, label) {
  const frozen = Object.freeze([...branches]);
  return mkShape("schemaAllOf", { branches: frozen }, (v, p) => {
    for (const b of frozen) b.check(v, p);
    return true;
  });
}
function oneOfShape(branches) {
  const frozen = Object.freeze([...branches]);
  return mkShape("schemaOneOf", { branches: frozen }, (v, p) => {
    let passes = 0;
    for (const b of frozen) {
      try { b.check(v, p); passes += 1; } catch (e) { if (!isValueLevelFailure(e)) throw e; }
    }
    if (passes !== 1) shapeFail("invalid_shape", "shape.check", null, p + " must match exactly one oneOf branch (matched " + passes + ")");
    return true;
  });
}
function anyOfShape(branches) {
  const frozen = Object.freeze([...branches]);
  return mkShape("schemaAnyOf", { branches: frozen }, (v, p) => {
    for (const b of frozen) {
      let ok = true;
      try { b.check(v, p); } catch (e) { if (!isValueLevelFailure(e)) throw e; ok = false; }
      if (ok) return true;
    }
    shapeFail("invalid_shape", "shape.check", null, p + " must match at least one anyOf branch");
  });
}
function notShape(branch) {
  return mkShape("schemaNot", { branch }, (v, p) => {
    let ok = true;
    try { branch.check(v, p); } catch (e) { if (!isValueLevelFailure(e)) throw e; ok = false; }
    if (ok) shapeFail("invalid_shape", "shape.check", null, p + " must NOT match the declared not-schema");
    return true;
  });
}
function ifThenElseShape(ifShape, thenShape, elseShape) {
  const spec = Object.freeze({ if: ifShape, then: thenShape, else: elseShape ?? null });
  return mkShape("schemaIfThenElse", spec, (v, p) => {
    let matched = true;
    try { ifShape.check(v, p); } catch (e) { if (!isValueLevelFailure(e)) throw e; matched = false; }
    if (matched) thenShape.check(v, p);
    else if (elseShape) elseShape.check(v, p);
    return true;
  });
}
function mapShape(fields, required, addlShape) {
  const frozen = frozenFields(fields);
  const requiredFrozen = Object.freeze([...required]);
  return mkShape("schemaMap", { fields: frozen, required: requiredFrozen, additional: addlShape }, (v, p) => {
    if (!objectOnly(v)) shapeFail("invalid_shape", "shape.check", null, p + " must be a non-null non-array object (got " + typeOf(v) + ")");
    // R1/B4+B5: own-property semantics; required keys not declared in properties are
    // presence-only AND validated by the additionalProperties schema (draft-07)
    for (const k of requiredFrozen) if (!Object.hasOwn(v, k)) shapeFail("invalid_shape", "shape.check", null, p + " is missing required key " + JSON.stringify(k));
    for (const [k, sub] of Object.entries(frozen)) if (Object.hasOwn(v, k)) sub.check(v[k], p + "." + k);
    for (const k of Object.keys(v)) if (!Object.hasOwn(frozen, k)) addlShape.check(v[k], p + "." + k);
    return true;
  });
}
export function shapeFromSchema(options) {
  const o = optionsGate(options, ["schema", "def", "registry"], "shapeFromSchema");
  if (o.schema === null || typeof o.schema !== "object" || Array.isArray(o.schema)) schemaCompileError("schema must be a non-null non-array object");
  if (typeof o.def !== "string" || o.def.length === 0) schemaCompileError("def must be a non-empty string");
  const registryRaw = o.registry === undefined ? {} : o.registry;
  if (registryRaw === null || typeof registryRaw !== "object" || Array.isArray(registryRaw)) schemaCompileError("registry must be a non-null non-array object");
  for (const [k, v] of Object.entries(registryRaw)) {
    if (typeof k !== "string" || k.length === 0 || k.includes("/") || k.includes("\\") || k !== path.basename(k)) schemaCompileError("registry key must be a plain schema basename: " + JSON.stringify(k));
    if (v === null || typeof v !== "object" || Array.isArray(v)) schemaCompileError("registry entry must be a schema object: " + k);
  }
  // purity: compile over private clones; later caller mutations cannot alter compiled Shapes
  let schema, registry;
  try { schema = structuredClone(o.schema); registry = structuredClone(registryRaw); }
  catch (error) { schemaCompileError("inputs are not cloneable: " + String(error?.message ?? error)); }
  let digest;
  try { digest = sha256hex(canonicalJSON({ def: o.def, schema, registry })); }
  catch (error) { schemaCompileError("content digest failed: " + String(error?.message ?? error)); }
  const cacheKey = o.def + "\u0000" + digest;
  if (SCHEMA_SHAPE_CACHE.has(cacheKey)) return SCHEMA_SHAPE_CACHE.get(cacheKey);
  // document set: registry basenames are authoritative as-is; the root document sits at the
  // reserved "__root__" key and — when the registry does not already provide the cutover
  // basename — additionally binds itself there, closing the run-state -> cutover back-loop
  // inside one compile (ruling: the root schema binds itself as cutover.schema.json).
  const ROOT_DOC_KEY = "__root__";
  const docs = { [ROOT_DOC_KEY]: schema };
  for (const [k, v] of Object.entries(registry)) docs[k] = v;
  const rootBindsCutover = !Object.prototype.hasOwnProperty.call(docs, SCHEMA_ROOT_KEY);
  if (rootBindsCutover) docs[SCHEMA_ROOT_KEY] = schema;
  const defsOfDoc = (docKey, refText) => {
    const doc = docs[docKey];
    const defs = doc && objectOnly(doc) && objectOnly(doc.$defs) ? doc.$defs : null;
    if (!defs) schemaCompileError("document has no $defs for $ref " + refText);
    return defs;
  };
  const parseRef = (refText, ownerDocKey) => {
    if (typeof refText !== "string" || refText.length === 0) schemaCompileError("$ref must be a non-empty string");
    const m = /^([^#]*)#\/\$defs\/([A-Za-z0-9_.-]+)$/.exec(refText);
    if (!m) schemaCompileError("unsupported $ref form (only [<doc>]#/$defs/<name>): " + refText);
    const [, file, name] = m;
    let docKey;
    if (file === "") docKey = ownerDocKey;
    else if (file === SCHEMA_ROOT_KEY && rootBindsCutover) docKey = ROOT_DOC_KEY;
    else docKey = file;
    if (!(docKey in docs)) schemaCompileError("$ref names a document absent from the registry: " + refText);
    return { docKey, name };
  };
  const compiled = {};        // def name -> Shape (live registry for lazy refs)
  const compiledOwner = {};   // def name -> owning docKey (ambiguity guard)
  const queue = [];
  const enqueueDef = (docKey, name, refText) => {
    const defs = defsOfDoc(docKey, refText);
    if (!(name in defs)) schemaCompileError("unresolvable $ref " + refText + " (no $defs entry " + name + ")");
    const target = defs[name];
    if (target !== true && target !== false && (target === null || typeof target !== "object" || Array.isArray(target))) schemaCompileError("$ref target is not a schema: " + refText);
    if (compiledOwner[name] === undefined) { compiledOwner[name] = docKey; queue.push([docKey, name]); }
    else if (compiledOwner[name] !== docKey) schemaCompileError("ambiguous def name across documents: " + name);
    return name;
  };
  const isSafeCount = (v) => isSafeInt(v) && v >= 0;
  const compileNode = (node, docKey, where) => {
    if (node === true) return anyShape();
    if (node === false) return neverShape;
    if (!objectOnly(node)) schemaCompileError("schema node must be an object or boolean at " + where);
    let refShapeOut = null;
    const typeParts = [];
    let objectPart = null, arrayPart = null, stringPart = null, integerMin = undefined;
    let enumPart = null, constPart = null, formatPart = null;
    const branches = {};
    for (const key of Object.keys(node)) {
      if (SCHEMA_METADATA_KEYS.has(key)) continue;
      const w = where + "/" + key;
      switch (key) {
        case "$ref": {
          if (Object.keys(node).some((k2) => k2 !== "$ref" && !SCHEMA_METADATA_KEYS.has(k2))) schemaCompileError("$ref must stand alone (siblings rejected) at " + where);
          const { docKey: targetDoc, name } = parseRef(node.$ref, docKey);
          enqueueDef(targetDoc, name, node.$ref);
          refShapeOut = ref({ name, registry: compiled });
          break;
        }
        case "type": {
          const t = node.type;
          const names = Array.isArray(t) ? t : [t];
          if (names.length === 0) schemaCompileError("type must not be empty at " + w);
          for (const n2 of names) {
            if (typeof n2 !== "string" || !SCHEMA_TYPE_NAMES.has(n2)) schemaCompileError("unsupported type value " + JSON.stringify(String(n2)) + " at " + w);
          }
          typeParts.push(names);
          break;
        }
        case "properties": {
          if (!objectOnly(node.properties)) schemaCompileError("properties must be an object at " + w);
          break;
        }
        case "required": {
          if (!Array.isArray(node.required) || node.required.some((k2) => typeof k2 !== "string")) schemaCompileError("required must be an array of strings at " + w);
          break;
        }
        case "additionalProperties": break;
        case "items": break;
        case "minItems": if (!isSafeCount(node.minItems)) schemaCompileError("minItems must be a safe non-negative integer at " + w); break;
        case "maxItems": if (!isSafeCount(node.maxItems)) schemaCompileError("maxItems must be a safe non-negative integer at " + w); break;
        case "minLength": if (!isSafeCount(node.minLength)) schemaCompileError("minLength must be a safe non-negative integer at " + w); break;
        case "maxLength": if (!isSafeCount(node.maxLength)) schemaCompileError("maxLength must be a safe non-negative integer at " + w); break;
        case "pattern": {
          if (typeof node.pattern !== "string") schemaCompileError("pattern must be a string at " + w);
          try { new RegExp(node.pattern); } catch (error) { schemaCompileError("pattern does not compile at " + w + ": " + String(error?.message ?? error)); }
          break;
        }
        case "minimum": if (typeof node.minimum !== "number" || !Number.isFinite(node.minimum)) schemaCompileError("minimum must be a finite number at " + w); break;
        case "enum": {
          if (!Array.isArray(node.enum) || node.enum.length === 0) schemaCompileError("enum must be a non-empty array at " + w);
          if (node.enum.some((x) => typeof x !== "string")) schemaCompileError("enum entries must be strings (non-string enums unsupported) at " + w);
          enumPart = enumShape({ values: node.enum });
          break;
        }
        case "const": {
          if (typeof node.const !== "string") schemaCompileError("const must be a string (non-string const unsupported) at " + w);
          constPart = enumShape({ values: [node.const] }); // R1/N2: enum AND const apply conjunctively when both present
          break;
        }
        case "format": {
          if (node.format !== "date-time") schemaCompileError("unsupported format " + JSON.stringify(String(node.format)) + " at " + w + " (only date-time)");
          formatPart = dateTimeShape; // N2 tightening applied in the parts assembly below
          break;
        }
        case "oneOf": case "anyOf": case "allOf": {
          if (!Array.isArray(node[key]) || node[key].length === 0) schemaCompileError(key + " must be a non-empty array at " + w);
          branches[key] = node[key].map((sub, i2) => compileNode(sub, docKey, w + "[" + i2 + "]"));
          break;
        }
        case "not": branches.not = compileNode(node.not, docKey, w); break;
        case "if": break;
        case "then": break;
        case "else": break;
        default: schemaCompileError("unsupported schema keyword " + JSON.stringify(key) + " at " + w);
      }
    }
    // if/then/else pairing (else optional; lone then/else rejected)
    if (("if" in node) || ("then" in node) || ("else" in node)) {
      if (!("if" in node) || !("then" in node)) schemaCompileError("if/then must appear together at " + where);
      if (("else" in node) && !("then" in node)) schemaCompileError("else without then rejected at " + where);
      branches.ifThenElse = ifThenElseShape(compileNode(node.if, docKey, where + "/if"), compileNode(node.then, docKey, where + "/then"), "else" in node ? compileNode(node.else, docKey, where + "/else") : null);
    }
    // object semantics
    const hasObjectKeys = ("properties" in node) || ("required" in node) || ("additionalProperties" in node);
    const declaredType = typeParts.length === 0 ? null : (typeParts[0].length === 1 ? typeParts[0][0] : null);
    const wantsObject = hasObjectKeys || declaredType === "object";
    const wantsArray = declaredType === "array" || ("items" in node) || ("minItems" in node) || ("maxItems" in node);
    const wantsString = declaredType === "string" || ("minLength" in node) || ("maxLength" in node) || ("pattern" in node);
    const wantsInteger = declaredType === "integer" || ("minimum" in node);
    if (("minimum" in node) && declaredType !== "integer") schemaCompileError("minimum is only supported for type integer at " + where);
    if (("minLength" in node) || ("maxLength" in node) || ("pattern" in node)) {
      if (declaredType !== null && declaredType !== "string") schemaCompileError("string keywords outside a string type at " + where);
    }
    if (("items" in node) || ("minItems" in node) || ("maxItems" in node)) {
      if (declaredType !== null && declaredType !== "array") schemaCompileError("array keywords outside an array type at " + where);
    }
    if (hasObjectKeys && declaredType !== null && declaredType !== "object") schemaCompileError("object keywords outside an object type at " + where);
    if (wantsObject) {
      const propFields = Object.create(null); // R2/N: null-prototype field map — schema-declared keys can never collide with Object.prototype members
      for (const [pk, pnode] of Object.entries(node.properties ?? {})) propFields[pk] = compileNode(pnode, docKey, where + "/properties/" + pk);
      const required = node.required ?? [];
      const propNames = new Set(Object.keys(node.properties ?? {}));
      // draft-07 presence-only semantics: a required key without a properties entry is
      // checked for presence with an unconstrained value; under additionalProperties:false
      // such a key would be simultaneously required and forbidden — rejected at declare.
      for (const rk of required) {
        if (!propNames.has(rk)) {
          if (node.additionalProperties === false) schemaCompileError("required key not declared in properties under a closed set at " + where + ": " + JSON.stringify(rk));
          // R1/B5: under additionalProperties:schema the key stays a presence-only extra
          // (the addl schema validates it inside mapShape); under an open object it stays
          // a presence-only any field
          if (node.additionalProperties === undefined) propFields[rk] = anyShape();
        }
      }
      let inner;
      if (node.additionalProperties === false) inner = exactKeys({ fields: propFields, required });
      else if (node.additionalProperties !== undefined) inner = mapShape(propFields, required, compileNode(node.additionalProperties, docKey, where + "/additionalProperties"));
      else inner = object({ fields: propFields, required });
      objectPart = declaredType === "object" ? inner : conditionalObject(inner);
    }
    if (wantsArray) {
      const items = compileNode(node.items ?? true, docKey, where + "/items");
      const min = node.minItems ?? 0;
      const max = node.maxItems ?? undefined ?? null;
      const inner = array({ items, min, max });
      arrayPart = declaredType === "array" ? inner : conditionalArray(inner);
    }
    if (wantsString) {
      const min = node.minLength ?? 0;
      const max = node.maxLength !== undefined ? node.maxLength : null;
      if (max !== null && max < min) schemaCompileError("maxLength below minLength at " + where);
      const pattern = node.pattern !== undefined ? new RegExp(node.pattern) : null;
      const inner = string({ min, max, pattern });
      stringPart = declaredType === "string" ? inner : conditionalString(inner);
    }
    if (wantsInteger) integerMin = node.minimum ?? null;
    const typeShapeOut = (() => {
      if (typeParts.length === 0) return null;
      const perUnion = typeParts[0].map((tname) => {
        if (tname === "object") return mkShape("schemaTypeObject", {}, (v, p) => { if (!objectOnly(v)) shapeFail("invalid_shape", "shape.check", null, p + " must be a non-null non-array object (got " + typeOf(v) + ")"); return true; });
        if (tname === "array") return mkShape("schemaTypeArray", {}, (v, p) => { if (!Array.isArray(v)) shapeFail("invalid_shape", "shape.check", null, p + " must be an array (got " + typeOf(v) + ")"); return true; });
        if (tname === "string") return mkShape("schemaTypeString", {}, (v, p) => { if (typeof v !== "string") shapeFail("invalid_shape", "shape.check", null, p + " must be a string (got " + typeOf(v) + ")"); return true; });
        if (tname === "integer") return mkShape("schemaTypeInteger", {}, (v, p) => { if (typeof v !== "number" || !Number.isInteger(v)) shapeFail("invalid_shape", "shape.check", null, p + " must be an integer (got " + typeOf(v) + ")"); return true; }); // R1/B6: Number.isInteger parity — the safe-int bound was an unauthorized extra rejection face
        if (tname === "boolean") return mkShape("schemaTypeBoolean", {}, (v, p) => { if (typeof v !== "boolean") shapeFail("invalid_shape", "shape.check", null, p + " must be a boolean (got " + typeOf(v) + ")"); return true; });
        return mkShape("schemaTypeNull", {}, (v, p) => { if (v !== null) shapeFail("invalid_shape", "shape.check", null, p + " must be null (got " + typeOf(v) + ")"); return true; });
      });
      return perUnion.length === 1 ? perUnion[0] : unionShape(perUnion);
    })();
    const integerShapeOut = integerMin !== undefined ? mkShape("schemaIntegerMin", { min: integerMin }, (v, p) => {
      if (typeof v !== "number" || !Number.isInteger(v)) shapeFail("invalid_shape", "shape.check", null, p + " must be an integer (got " + typeOf(v) + ")"); // R1/B6: plain Number.isInteger
      if (v < integerMin) shapeFail("invalid_shape", "shape.check", null, p + " is below min " + integerMin);
      return true;
    }) : null;
    // R1/N2: date-time without a type sibling tightens to string-only
    const formatPartResolved = formatPart !== null && typeShapeOut === null ? strictDateTimeShape : formatPart;
    const parts = [refShapeOut, typeShapeOut, objectPart, arrayPart, stringPart, integerShapeOut, enumPart, constPart, formatPartResolved,
      branches.allOf ? allOfShape(branches.allOf, where) : null,
      branches.oneOf ? oneOfShape(branches.oneOf) : null,
      branches.anyOf ? anyOfShape(branches.anyOf) : null,
      branches.not ? notShape(branches.not) : null,
      branches.ifThenElse ?? null,
    ].filter((x) => x !== null && x !== undefined);
    if (parts.length === 0) return anyShape();
    if (parts.length === 1) return parts[0];
    return allOfShape(parts, where);
  };
  // resolve the requested def from the root document, then compile the transitive closure
  enqueueDef(ROOT_DOC_KEY, o.def, o.def + " (requested def)");
  const shapes = {};
  while (queue.length > 0) {
    const [docKey, name] = queue.shift();
    if (shapes[name] !== undefined) continue;
    const defs = defsOfDoc(docKey, name);
    shapes[name] = compileNode(defs[name], docKey, "$defs/" + name);
    compiled[name] = shapes[name];
  }
  Object.freeze(compiled);
  const result = compiled[o.def];
  SCHEMA_SHAPE_CACHE.set(cacheKey, result);
  return result;
}
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
    for (const k of requiredFrozen) if (!Object.hasOwn(value, k)) shapeFail("invalid_shape", "shape.check", null, p + " is missing required key " + JSON.stringify(k)); // R1/B4: own-property only
    for (const [k, sub] of Object.entries(frozen)) if (Object.hasOwn(value, k)) sub.check(value[k], p + "." + k);
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
  const MECHS = new Set(["object", "array", "string", "integer", "hex64", "enum", "ref", "exactKeys", "readShape", "verifyHash", "withinRoot", "shapeFromSchema"]);
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
  // RT1AGG: the real runtime schema documents feed shapeFromSchema vectors. The compiler
  // itself performs zero file I/O — the harness parses and hands the docs over explicitly.
  const RUNTIME_SCHEMA_DOCS = {};
  try {
    for (const name of ["cutover.schema.json", "run-state.schema.json", "session.schema.json"]) {
      RUNTIME_SCHEMA_DOCS[name] = JSON.parse(await fsp.readFile(path.join(SCRIPT_DIR, "..", "templates", "runtime", name), "utf-8"));
    }
  } catch (error) {
    console.error("shape-check: runtime schema docs unavailable for shapeFromSchema vectors: " + String(error?.message ?? error));
    return 3;
  }
  // resolve fixture markers {schema_doc, def, registry_docs, def_mutation} into the real
  // shapeFromSchema options; the harness owns the mutation of the schema clone
  const resolveSchemaOptions = (callOptions) => {
    const o = { ...callOptions };
    let schema;
    if (o.schema !== undefined) {
      schema = structuredClone(o.schema); // inline schema (generic compile-face vectors)
    } else {
      const rootName = o.schema_doc ?? "cutover.schema.json";
      if (!(rootName in RUNTIME_SCHEMA_DOCS)) throw new Error("unknown schema_doc " + rootName);
      schema = structuredClone(RUNTIME_SCHEMA_DOCS[rootName]);
    }
    let registry;
    if (o.registry !== undefined) {
      registry = structuredClone(o.registry);
    } else {
      registry = {};
      for (const name of o.registry_docs ?? []) {
        if (!(name in RUNTIME_SCHEMA_DOCS)) throw new Error("unknown registry doc " + name);
        if (name === (o.schema_doc ?? "cutover.schema.json") && o.schema === undefined) throw new Error("registry_docs must not repeat the root schema_doc (root binds itself)");
        registry[name] = structuredClone(RUNTIME_SCHEMA_DOCS[name]);
      }
    }
    if (o.def_mutation) {
      const m = o.def_mutation;
      const target = schema.$defs?.[o.def];
      if (!target) throw new Error("def_mutation target def missing: " + o.def);
      if (m.op === "require_extra") {
        target.properties = { ...(target.properties ?? {}), [m.key]: {} };
        target.required = [...(target.required ?? []), m.key];
      } else if (m.op === "narrow_pattern") {
        if (!target.properties?.[m.key]?.pattern) throw new Error("narrow_pattern needs a pattern property: " + m.key);
        target.properties[m.key].pattern = "^zz-narrowed$";
      } else if (m.op === "shrink_enum") {
        if (!target.properties?.[m.key]?.enum) throw new Error("shrink_enum needs an enum property: " + m.key);
        target.properties[m.key].enum = ["__none__"];
      } else if (m.op === "drop_property_closed") {
        if (!(m.key in (target.properties ?? {}))) throw new Error("drop_property_closed needs the property: " + m.key);
        delete target.properties[m.key];
        if (Array.isArray(target.required)) target.required = target.required.filter((k) => k !== m.key);
      } else {
        throw new Error("unknown def_mutation op " + m.op);
      }
    }
    return { schema, def: o.def, registry };
  };
  const runRoot = path.join(tempRoot, "run");
  await fsp.mkdir(runRoot, { recursive: true });
  let failed = 0;
  let skipped = 0;
  const groups = { declarators: { ok: true, n: 0 }, read: { ok: true, n: 0 }, hash: { ok: true, n: 0 }, path: { ok: true, n: 0 }, errors: { ok: true, n: 0 }, schema: { ok: true, n: 0 } };
  const seenErrorSurfaces = [];
  const rtGroups = {};      // def -> {valid,invalid,cache,mutated} each true only while passing
  let cacheProbeOk = true;  // identity + cross-content probes
  const passedIds = new Set();
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
      if (call.fn === "shapeFromSchema" && call.probe !== "cross_content") {
        fnOptions = resolveSchemaOptions(fnOptions);
      }
      const fns = { object, array, string, integer, hex64, enum: enumShape, ref, exactKeys, readShape, verifyHash, withinRoot, shapeFromSchema };
      const fn = fns[call.fn];
      if (!fn) throw new Error("unknown fn " + call.fn);
      if (call.fn === "shapeFromSchema" && call.probe === "cross_content") {
        // cache poisoning probe: different content, same def — no stale Shape reuse either way
        const sA = shapeFromSchema(resolveSchemaOptions(call.a));
        const sB = shapeFromSchema(resolveSchemaOptions(call.b));
        if (sA === sB) throw new Error("cross-content cache probe: same Shape for different schema content");
        let aAccepted = true;
        try { sA.check(call.value, "$"); } catch { aAccepted = false; }
        if (aAccepted) throw new Error("cross-content cache probe: stale shape accepted a value valid only under the other content");
        let bAccepted = true;
        try { sB.check(call.value, "$"); } catch { bAccepted = false; }
        if (!bAccepted) throw new Error("cross-content cache probe: fresh shape rejected its own valid value");
        actual = { ok: true };
      } else if (call.fn === "shapeFromSchema") {
        const shape = fn(fnOptions);
        if (call.identity === true) {
          const again = fn(resolveSchemaOptions(call.options)); // same content -> same digest -> same Shape
          if (again !== shape) throw new Error("shapeFromSchema cache identity probe: recompile returned a different Shape");
        }
        actual = { ok: true };
        if (call.value !== undefined && v.expected.phase === "check") {
          for (let i = 0; i < repeat; i += 1) shape.check(call.value, "$");
        }
      } else if (DECLARATORS.has(call.fn)) {
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
    const group = DECLARATORS.has(call.fn) ? "declarators" : call.fn === "readShape" ? "read" : call.fn === "verifyHash" ? "hash" : call.fn === "shapeFromSchema" ? "schema" : "path";
    groups[group].n += 1;
    if (ok) passedIds.add(v.fixture_id);
    if (!ok) { failed += 1; groups[group].ok = false; }
    if (call.fn === "shapeFromSchema") {
      if (call.rt) {
        const d = call.rt.split(":")[0];
        const kind = call.rt.split(":")[1];
        rtGroups[d] = rtGroups[d] ?? {};
        rtGroups[d][kind] = ok && (rtGroups[d][kind] ?? true);
      }
      if (call.probe === "cross_content" || call.identity === true) cacheProbeOk = cacheProbeOk && ok;
    }
    const expView = exp.polarity === "positive" ? { polarity: "positive" } : { polarity: "negative", code: exp.code, exitCode: exp.exitCode };
    console.log(`${ok ? "PASS" : "FAIL"} ${v.fixture_id} mechanism=${v.mechanism} expected=${JSON.stringify(expView)} actual=${JSON.stringify(actual.ok ? { ok: true } : { ok: false, error: actual.error })} exitCode=${actual.ok ? 0 : actual.error.exitCode} mutation_tag=${v.mutation_tag}`);
  }
  if (seenErrorSurfaces.length === 0) groups.errors.ok = false;
  console.log(`shape_declarators=${groups.declarators.ok && groups.declarators.n > 0 ? "PASS" : "FAIL"} shape_read=${groups.read.ok && groups.read.n > 0 ? "PASS" : "FAIL"} shape_hash=${groups.hash.ok && groups.hash.n > 0 ? "PASS" : "FAIL"} shape_path=${groups.path.ok && groups.path.n > 0 ? "PASS" : "FAIL"} shape_errors=${groups.errors.ok ? "PASS" : "FAIL"} failed=${failed} skip=${skipped}`);
  // RT1AGG aggregates: roundtrip 4-group coverage per target def, cache determinism, and
  // expected-rejection (RED) evidence for mutated defs — all counted from this run only
  const rtLists = doc.rt1agg_roundtrip_defs ?? {};
  const allDefs = [...(rtLists.cutover ?? []), ...(rtLists.external ?? []), ...(rtLists.new ?? [])];
  const kindsNeeded = ["valid", "invalid", "cache", "mutated"];
  const defsOk = allDefs.filter((d) => rtGroups[d] && kindsNeeded.every((k) => rtGroups[d][k] === true));
  const addedIds = new Set(doc.rt1agg_added ?? []);
  const oldTotal = doc.vectors.filter((x) => !addedIds.has(x.fixture_id)).length;
  const oldPassed = doc.vectors.filter((x) => !addedIds.has(x.fixture_id) && passedIds.has(x.fixture_id)).length;
  const newTotal = doc.vectors.filter((x) => addedIds.has(x.fixture_id)).length;
  const mutatedAllRed = Object.values(rtGroups).every((g) => g.mutated !== false);
  console.log(`shape_schema=${groups.schema.ok && groups.schema.n > 0 ? "PASS" : "FAIL"} defs_roundtrip=${defsOk.length}/${allDefs.length} def_names=${allDefs.join("/")} external_named=${(rtLists.external ?? []).join("/")} new_named=${(rtLists.new ?? []).join("/")} old_vectors=${oldPassed}/${oldTotal} new_vectors=${newTotal} cache_determinism=${cacheProbeOk ? "PASS" : "FAIL"} schema_mutations=${mutatedAllRed ? "RED" : "GREEN"}`);
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
