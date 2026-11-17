import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LogSink, formatLogLine, redactSecrets, rotateLogFile } from "./lib/logs.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hub-logs-"));
}

test("redactSecrets masks known secrets and token query values", () => {
  const text = "using token abcdef123456 and URL http://127.0.0.1:8765/?launch=xyz789&x=1";
  const redacted = redactSecrets(text, ["abcdef123456"]);
  assert.doesNotMatch(redacted, /abcdef123456/);
  assert.doesNotMatch(redacted, /xyz789/);
  assert.match(redacted, /launch=\[redacted\]/);
  assert.match(redacted, /x=1/);
});

test("formatLogLine prefixes a timestamp and never doubles newlines", () => {
  const line = formatLogLine("hello\n", { now: new Date("2026-01-01T00:00:00.000Z") });
  assert.equal(line, "[2026-01-01T00:00:00.000Z] hello\n");
});

test("LogSink writes a header and redacts secrets in every line", () => {
  const dir = tempDir();
  const file = path.join(dir, "ists.log");
  try {
    const sink = new LogSink(file, {
      name: "ISTS",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    sink.addSecret("super-secret-token");
    sink.writeLine("starting with super-secret-token");
    sink.writeLine("[stderr] http://127.0.0.1:8765/?launch=other-secret&ok=1");
    sink.close();
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, /# IELTS Study Hub - ISTS log/);
    assert.doesNotMatch(text, /super-secret-token/);
    assert.doesNotMatch(text, /other-secret/);
    assert.match(text, /launch=\[redacted\]/);
    assert.match(text, /\[2026-01-01T00:00:00.000Z\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rotateLogFile keeps one previous generation", () => {
  const dir = tempDir();
  const file = path.join(dir, "bandready.log");
  try {
    fs.writeFileSync(file, "x".repeat(200));
    assert.equal(rotateLogFile(file, { maxBytes: 100 }), true);
    assert.equal(fs.existsSync(`${file}.1`), true);
    assert.equal(fs.existsSync(file), false);
    assert.equal(rotateLogFile(file, { maxBytes: 100 }), false, "missing file needs no rotation");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a sink rotates before it reopens an oversized log", () => {
  const dir = tempDir();
  const file = path.join(dir, "bandready.log");
  try {
    fs.writeFileSync(file, "y".repeat(200));
    const sink = new LogSink(file, { name: "BandReady", maxBytes: 100 });
    sink.writeLine("fresh line");
    sink.close();
    assert.equal(fs.existsSync(`${file}.1`), true);
    assert.match(fs.readFileSync(file, "utf8"), /fresh line/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a sink rotates while writing once the cap is crossed", () => {
  const dir = tempDir();
  const file = path.join(dir, "ists.log");
  try {
    const sink = new LogSink(file, { name: "ISTS", maxBytes: 400 });
    sink.writeLine("z".repeat(600));
    sink.writeLine("after rotation");
    sink.close();
    assert.equal(fs.existsSync(`${file}.1`), true);
    assert.match(fs.readFileSync(file, "utf8"), /after rotation/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
