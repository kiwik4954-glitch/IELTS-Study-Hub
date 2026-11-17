import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  clearStateFile,
  createModuleState,
  createState,
  normalizeState,
  readStateFile,
  sanitizeState,
  writeStateFile,
} from "./lib/state.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hub-state-"));
}

test("createState has the documented shape", () => {
  const state = createState({ hubPort: 8780, hubPid: 4242, now: new Date("2026-01-01T00:00:00.000Z") });
  assert.equal(state.version, 1);
  assert.deepEqual(Object.keys(state.modules).sort(), ["bandready", "ists"]);
  assert.equal(state.hub.port, 8780);
  assert.equal(state.hub.pid, 4242);
  assert.equal(state.hub.startedAt, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(createModuleState(), {
    status: "stopped",
    port: null,
    url: null,
    startedAt: null,
    pid: null,
    processStartMs: null,
    external: false,
    error: null,
  });
});

test("writeStateFile/readStateFile round-trip PID and start time", () => {
  const dir = tempDir();
  const file = path.join(dir, "hub", "state.json");
  try {
    const state = createState({ hubPort: 8780, hubPid: 99 });
    state.modules.ists = createModuleState({
      status: "running",
      port: 3000,
      url: "http://127.0.0.1:3000",
      startedAt: "2026-01-01T00:00:00.000Z",
      pid: 1234,
      processStartMs: 1_700_000_000_000,
    });
    writeStateFile(file, state);
    const read = readStateFile(file);
    assert.equal(read.error, null);
    assert.equal(read.exists, true);
    assert.equal(read.state.modules.ists.pid, 1234);
    assert.equal(read.state.modules.ists.processStartMs, 1_700_000_000_000);
    assert.equal(read.state.modules.ists.status, "running");
    assert.equal(read.state.hub.port, 8780);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("secrets never reach disk: launch tokens are dropped and ?launch= is redacted", () => {
  const dir = tempDir();
  const file = path.join(dir, "state.json");
  const secret = "super-secret-launch-token-value";
  try {
    const state = createState({ hubPort: 8780 });
    state.launch = secret;
    state.modules.bandready = createModuleState({
      status: "running",
      port: 8765,
      url: `http://127.0.0.1:8765/?launch=${secret}`,
      launch: secret,
    });
    writeStateFile(file, state);
    const text = fs.readFileSync(file, "utf8");
    assert.equal(text.includes(secret), false);
    assert.match(text, /launch=\[redacted\]/);
    assert.equal(JSON.parse(text).launch, undefined);
    assert.equal(JSON.parse(text).modules.bandready.launch, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sanitizeState is recursive and leaves ordinary fields alone", () => {
  const sanitized = sanitizeState({
    hub: { port: 8780 },
    secret: "x",
    modules: {
      ists: { status: "running", token: "abc", nested: [{ launch: "y", port: 1 }] },
    },
  });
  assert.deepEqual(sanitized, {
    hub: { port: 8780 },
    modules: { ists: { status: "running", nested: [{ port: 1 }] } },
  });
});

test("writes are atomic and leave no temp files behind", () => {
  const dir = tempDir();
  const file = path.join(dir, "state.json");
  try {
    writeStateFile(file, createState({ hubPort: 8780 }));
    writeStateFile(file, createState({ hubPort: 8781 }));
    const leftovers = fs.readdirSync(dir).filter((name) => name.includes(".tmp"));
    assert.deepEqual(leftovers, []);
    assert.equal(readStateFile(file).state.hub.port, 8781);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("missing, empty and corrupt state files are handled without throwing", () => {
  const dir = tempDir();
  try {
    const missing = readStateFile(path.join(dir, "missing.json"));
    assert.deepEqual(missing, { state: null, error: null, exists: false });

    const corrupt = path.join(dir, "corrupt.json");
    fs.writeFileSync(corrupt, "{ broken");
    const read = readStateFile(corrupt);
    assert.equal(read.state, null);
    assert.match(read.error, /unreadable/);

    const array = path.join(dir, "array.json");
    fs.writeFileSync(array, "[]");
    assert.match(readStateFile(array).error, /JSON object/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("normalizeState drops unknown modules and repairs bad fields", () => {
  const normalized = normalizeState(
    {
      version: 1,
      hub: { port: 1111, pid: 55, processStartMs: 1_700_000_000_000 },
      modules: {
        ists: { status: "bogus", port: "3000", pid: 12.5, processStartMs: "nope" },
        bandready: { status: "running", port: 8765, pid: 77 },
        evil: { status: "running", pid: 1 },
      },
    },
    { hubPort: 8780 },
  );
  assert.equal(normalized.hub.port, 8780);
  assert.equal(normalized.hub.pid, 55);
  assert.equal(normalized.hub.processStartMs, 1_700_000_000_000);
  assert.equal(normalized.modules.ists.status, "stopped");
  assert.equal(normalized.modules.ists.port, null);
  assert.equal(normalized.modules.ists.pid, null);
  assert.equal(normalized.modules.ists.processStartMs, null);
  assert.equal(normalized.modules.bandready.status, "running");
  assert.equal(normalized.modules.evil, undefined);
});

test("clearStateFile removes the file safely when it is already gone", () => {
  const dir = tempDir();
  const file = path.join(dir, "state.json");
  try {
    fs.writeFileSync(file, "{}");
    clearStateFile(file);
    assert.equal(fs.existsSync(file), false);
    clearStateFile(file); // second call must not throw
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
