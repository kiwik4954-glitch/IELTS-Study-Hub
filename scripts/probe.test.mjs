import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBandReadyLaunchUrl,
  describeLaunchFile,
  readBandReadyLaunchFile,
  redactUrl,
  requestUrl,
  waitFor,
} from "./lib/probe.mjs";

const readFrom = (text) => async () => text;

test("a valid web.json yields port and launch secret", async () => {
  const state = await readBandReadyLaunchFile("C:\\fake\\web.json", {
    readFile: readFrom(JSON.stringify({ port: 9123, launch: "s3cret-token-value" })),
  });
  assert.deepEqual(state, { ok: true, port: 9123, launch: "s3cret-token-value" });
});

test("invalid web.json variants are rejected with a reason", async () => {
  const missing = await readBandReadyLaunchFile("C:\\fake\\web.json", {
    readFile: async () => {
      const error = new Error("no such file");
      error.code = "ENOENT";
      throw error;
    },
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not found/);

  for (const text of [
    "{ nope",
    JSON.stringify({ port: 0, launch: "x" }),
    JSON.stringify({ port: 70000, launch: "x" }),
    JSON.stringify({ port: 9123, launch: "" }),
    JSON.stringify({ port: 9123, launch: 42 }),
    JSON.stringify({ launch: "x" }),
  ]) {
    const result = await readBandReadyLaunchFile("web.json", { readFile: readFrom(text) });
    assert.equal(result.ok, false, `expected rejection for ${text}`);
    assert.equal(result.port, null);
    assert.equal(result.launch, null);
  }
});

test("the launch file summary never contains the token", () => {
  const described = describeLaunchFile({ ok: true, port: 9123, launch: "s3cret-token-value" });
  assert.match(described, /port 9123/);
  assert.match(described, /token present/);
  assert.doesNotMatch(described, /s3cret/);
});

test("the launch URL encodes the secret exactly once", () => {
  assert.equal(
    buildBandReadyLaunchUrl(8765, "a+b/c=d"),
    "http://127.0.0.1:8765/?launch=a%2Bb%2Fc%3Dd",
  );
});

test("redactUrl masks token-style query parameters and credentials", () => {
  assert.equal(
    redactUrl("http://user:pass@127.0.0.1:8765/?launch=abc123&x=1"),
    "http://127.0.0.1:8765/?launch=%5Bredacted%5D&x=1",
  );
  assert.match(redactUrl("not a url ?launch=abc"), /launch=\[redacted\]/);
});

test("waitFor succeeds after transient failures and counts attempts", async () => {
  let clock = 0;
  const sleeps = [];
  const result = await waitFor(
    async () => ({ ok: clock >= 1500, statusCode: clock >= 1500 ? 200 : 503 }),
    {
      timeoutMs: 5_000,
      intervalMs: 500,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 4); // t=0, 500, 1000 (fail), 1500 (ok)
  assert.equal(sleeps.length, 3);
});

test("waitFor gives up at the deadline and returns the last result", async () => {
  let clock = 0;
  const result = await waitFor(
    async () => ({ ok: false, error: "connection refused" }),
    {
      timeoutMs: 2_000,
      intervalMs: 500,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.last.error, "connection refused");
  assert.ok(result.waitedMs >= 2_000);
});

test("waitFor treats a throwing check as a failed attempt", async () => {
  let clock = 0;
  let calls = 0;
  const result = await waitFor(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("ECONNREFUSED");
      return { ok: true };
    },
    {
      timeoutMs: 1_000,
      intervalMs: 100,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
});

test("waitFor stops immediately when the signal is aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await waitFor(async () => ({ ok: true }), { signal: controller.signal });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 0);
});

test("requestUrl rejects malformed URLs without touching the network", async () => {
  const result = await requestUrl("not-a-url");
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid URL/);
  assert.equal(result.statusCode, null);
});
