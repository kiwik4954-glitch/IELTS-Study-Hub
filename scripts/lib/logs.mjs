/**
 * Module logs: %APPDATA%\IELTS-Study-Hub\hub\logs\{ists,bandready}.log
 *
 * Log sinks redact secrets before touching disk. BandReady prints its launch URL
 * (`?launch=<secret>`) on startup, so both the exact token (once known) and any
 * generic `launch=`/`token=` query value are masked.
 */

import fs from "node:fs";
import path from "node:path";

import { ensureDir } from "./fs-utils.mjs";

export const MAX_LOG_BYTES = 5 * 1024 * 1024;

const SECRET_QUERY = /([?&](?:launch|token|secret|key|api_key|password|auth)=)[^&#\s"'<>]*/gi;

/** Mask known secret values plus token-looking query parameters. */
export function redactSecrets(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out.replace(SECRET_QUERY, "$1[redacted]");
}

/** Timestamp + redaction applied to one log line. */
export function formatLogLine(line, { now = new Date(), secrets = [] } = {}) {
  const stamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return `[${stamp}] ${redactSecrets(line, secrets).replace(/\r?\n$/, "")}\n`;
}

/** Rotate `file` to `file.1` when it is at or above `maxBytes`. */
export function rotateLogFile(file, { maxBytes = MAX_LOG_BYTES } = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (stat.size < maxBytes) return false;
  try {
    fs.renameSync(file, `${file}.1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Append-only, synchronously written log file. Synchronous writes keep ordering
 * exact and make tests deterministic; the volume (two local apps) is tiny.
 */
export class LogSink {
  constructor(file, { name, maxBytes = MAX_LOG_BYTES, secrets = [], now = () => new Date() } = {}) {
    this.file = file;
    this.name = name ?? path.basename(file, path.extname(file));
    this.maxBytes = maxBytes;
    this.now = now;
    this._secrets = new Set();
    this.closed = false;
    this.bytes = 0;
    ensureDir(path.dirname(file));
    rotateLogFile(file, { maxBytes });
    try {
      this.bytes = fs.statSync(file).size;
    } catch {
      this.bytes = 0;
    }
    if (this.bytes === 0) {
      fs.appendFileSync(
        file,
        `# IELTS Study Hub - ${this.name} log - started ${this.now().toISOString()}\n`,
        "utf8",
      );
    }
  }

  /** Register a secret discovered later (e.g. BandReady's launch token). */
  addSecret(secret) {
    if (typeof secret === "string" && secret.length >= 4) this._secrets.add(secret);
  }

  get secrets() {
    return [...this._secrets];
  }

  /** Write one line (a trailing newline is added; existing ones are collapsed). */
  writeLine(line) {
    if (this.closed) return;
    const text = formatLogLine(line, { now: this.now(), secrets: this.secrets });
    try {
      fs.appendFileSync(this.file, text, "utf8");
      this.bytes += Buffer.byteLength(text);
      if (this.bytes >= this.maxBytes) {
        rotateLogFile(this.file, { maxBytes: this.maxBytes });
        this.bytes = 0;
        fs.appendFileSync(
          this.file,
          `# ${this.name} log rotated at ${this.now().toISOString()}\n`,
          "utf8",
        );
      }
    } catch {
      /* logging must never crash the Hub */
    }
  }

  /** Write already-framed text (used for Hub messages). */
  writeRaw(text) {
    if (this.closed) return;
    const safe = redactSecrets(text, this.secrets);
    try {
      fs.appendFileSync(this.file, safe, "utf8");
      this.bytes += Buffer.byteLength(safe);
    } catch {
      /* ignore */
    }
  }

  close() {
    this.closed = true;
  }
}

/** Create a sink for one module log file. */
export function createLogSink({ logsDir, id, name, maxBytes, now }) {
  const file = path.join(logsDir, `${id}.log`);
  return new LogSink(file, { name: name ?? id, maxBytes, now });
}
