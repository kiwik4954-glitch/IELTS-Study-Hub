/**
 * Small filesystem helpers shared by the Hub scripts.
 *
 * Everything here is synchronous on purpose: the state file is tiny, and blocking
 * avoids interleaved writes while the process manager transitions modules.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** True for plain objects (not arrays, not null). */
export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** mkdir -p, never throws when it already exists. */
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Strip a UTF-8 BOM (Windows editors often add one). */
export function stripBom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Read and parse a JSON file. Returns null when missing; throws on invalid JSON. */
export function readJsonFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(stripBom(text));
}

/** Read JSON, returning a structured result instead of throwing. */
export function tryReadJsonFile(file) {
  try {
    return { ok: true, value: readJsonFile(file) };
  } catch (error) {
    return { ok: false, value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Write JSON atomically: write a sibling temp file, then rename over the target.
 * A crash mid-write can therefore never leave a truncated state file behind.
 */
export function writeJsonAtomic(file, value, { mode = 0o600 } = {}) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    fs.writeFileSync(tmp, text, { encoding: "utf8", mode });
    fs.renameSync(tmp, file);
    return file;
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    throw error;
  }
}

/** True when the path exists (file or directory, symlinks not followed). */
export function exists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/** True when the path exists and is a regular file. */
export function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/** True when the path exists and is a directory. */
export function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Read at most `limit` trailing characters of a text file (for error hints). */
export function tailFile(file, limit = 800) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - limit);
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(Math.min(limit, stat.size));
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return buffer.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

/** Expand %VAR%, ${VAR} and a leading ~; resolve relative paths against `baseDir`. */
export function expandPath(value, { env = process.env, home = os.homedir(), baseDir = process.cwd() } = {}) {
  if (typeof value !== "string") return value;
  let out = value.trim();
  if (!out) return out;
  const lookup = (name) => {
    if (Object.prototype.hasOwnProperty.call(env, name) && env[name] !== undefined) {
      return env[name];
    }
    if (name.toUpperCase() === "APPDATA") {
      // Windows is the first-class target; keep this working elsewhere for tests/CI.
      return env.APPDATA || path.join(home, "AppData", "Roaming");
    }
    return undefined;
  };
  out = out.replace(/%([^%]+)%/g, (match, name) => lookup(name) ?? match);
  out = out.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => {
    const name = braced ?? bare;
    return lookup(name) ?? match;
  });
  if (out === "~") out = home;
  else if (out.startsWith(`~${path.sep}`) || out.startsWith("~/")) out = path.join(home, out.slice(2));
  if (!path.isAbsolute(out)) out = path.resolve(baseDir, out);
  return path.normalize(out);
}
