/**
 * Persistent Hub state: %APPDATA%\IELTS-Study-Hub\hub\state.json
 *
 * Shape (version 1):
 *   {
 *     "version": 1,
 *     "hub": { "version": "0.1.0", "port": 8780, "pid": 1234, "startedAt": "..." },
 *     "modules": {
 *       "ists": { "status": "running", "port": 3000, "url": "...", "startedAt": "...",
 *                 "pid": 1234, "processStartMs": 1690000000000, "error": null },
 *       ...
 *     },
 *     "updatedAt": "..."
 *   }
 *
 * Secrets are never stored: `sanitizeState` drops secret-named keys and redacts
 * `?launch=` values, and writeStateFile always sanitizes first.
 */

import fs from "node:fs";
import path from "node:path";

import { tryReadJsonFile, writeJsonAtomic } from "./fs-utils.mjs";
import { MODULE_IDS, MODULE_STATUSES } from "./config.mjs";

export const STATE_VERSION = 1;

const SECRET_KEY = /^(launch|launchsecret|launchtoken|secret|token|auth|authorization|apikey|api_key|password)$/i;
const SECRET_QUERY = /([?&](?:launch|token|secret|key|api_key|password)=)[^&#\s"'<>]*/gi;

/** Build a module record with every field the portal/API expects. */
export function createModuleState(overrides = {}) {
  return {
    status: "stopped",
    port: null,
    url: null,
    startedAt: null,
    pid: null,
    processStartMs: null,
    external: false,
    error: null,
    ...overrides,
  };
}

/** Fresh state for a Hub startup. */
export function createState({ hubPort, hubPid = null, hubVersion = "0.1.0", now = new Date() } = {}) {
  const iso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const modules = {};
  for (const id of MODULE_IDS) modules[id] = createModuleState();
  return {
    version: STATE_VERSION,
    hub: { version: hubVersion, port: hubPort, pid: hubPid, processStartMs: null, startedAt: iso },
    modules,
    updatedAt: iso,
  };
}

/** True for a known module id. */
export function isModuleId(id) {
  return MODULE_IDS.includes(id);
}

/** True for a status the portal understands. */
export function isModuleStatus(status) {
  return MODULE_STATUSES.includes(status);
}

/** Deep clone that removes secrets and token-bearing query strings. */
export function sanitizeState(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeState(item));
  if (typeof value === "string") return value.replace(SECRET_QUERY, "$1[redacted]");
  if (value === null || typeof value !== "object") return value;

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = sanitizeState(item);
  }
  return out;
}

/**
 * Read state.json.
 * @returns {{ state: object|null, error: string|null, exists: boolean }}
 */
export function readStateFile(file) {
  const result = tryReadJsonFile(file);
  if (!result.ok) {
    return { state: null, error: `state.json is unreadable: ${result.error}`, exists: true };
  }
  if (result.value === null) return { state: null, error: null, exists: false };
  if (typeof result.value !== "object" || Array.isArray(result.value)) {
    return { state: null, error: "state.json does not contain a JSON object", exists: true };
  }
  return { state: result.value, error: null, exists: true };
}

/**
 * Merge persisted module records into a fresh state, keeping only records that are
 * structurally usable. Unknown ids are dropped; unknown statuses become "stopped".
 */
export function normalizeState(raw, { hubPort, hubVersion = "0.1.0" } = {}) {
  const fresh = createState({ hubPort, hubVersion, now: new Date() });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fresh;

  if (typeof raw.hub === "object" && raw.hub !== null) {
    for (const key of ["startedAt", "pid", "processStartMs"]) {
      if (raw.hub[key] !== undefined && raw.hub[key] !== null) fresh.hub[key] = raw.hub[key];
    }
    if (hubPort !== undefined) fresh.hub.port = hubPort;
    if (typeof raw.hub.version === "string") fresh.hub.version = raw.hub.version;
  }
  for (const id of MODULE_IDS) {
    const record = raw.modules && typeof raw.modules === "object" ? raw.modules[id] : null;
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    const merged = createModuleState();
    for (const key of Object.keys(merged)) {
      if (record[key] !== undefined) merged[key] = record[key];
    }
    if (!isModuleStatus(merged.status)) merged.status = "stopped";
    if (!Number.isInteger(merged.port)) merged.port = null;
    if (!Number.isInteger(merged.pid)) merged.pid = null;
    if (!Number.isFinite(merged.processStartMs)) merged.processStartMs = null;
    if (typeof merged.external !== "boolean") merged.external = false;
    fresh.modules[id] = merged;
  }
  if (typeof raw.updatedAt === "string") fresh.updatedAt = raw.updatedAt;
  return fresh;
}

/** Write state atomically (sanitized, so no launch token can reach disk). */
export function writeStateFile(file, state, { now = new Date() } = {}) {
  const safe = sanitizeState(state);
  safe.updatedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  if (!safe.version) safe.version = STATE_VERSION;
  writeJsonAtomic(file, safe);
  return path.resolve(file);
}

/** Remove state.json (used after every tracked process is gone). */
export function clearStateFile(file, fsImpl = fs) {
  fsImpl.rmSync(file, { force: true });
}
