import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createHubServer } from "./hub/server.mjs";
import { safeResolveInside } from "./hub/routes/static.mjs";

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-server-"));
  const dist = path.join(dir, "dist");
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>portal</title><div id=root></div>");
  fs.writeFileSync(path.join(dist, "assets", "app.js"), "console.log('portal');");
  const placeholder = path.join(dir, "placeholder.html");
  fs.writeFileSync(placeholder, "<!doctype html><title>placeholder</title>");
  return { dir, dist, placeholder };
}

function createFakeManager() {
  const modules = {
    ists: { status: "stopped", port: null, url: null, startedAt: null, error: null, external: false },
    bandready: { status: "stopped", port: null, url: null, startedAt: null, error: null, external: false },
  };
  return {
    getState: () => ({ hub: { version: "0.1.0", port: 8780 }, modules: JSON.parse(JSON.stringify(modules)) }),
    canStart(id) {
      if (!Object.hasOwn(modules, id)) return { ok: false, error: "unknown" };
      if (modules[id].status === "running") return { ok: false, error: "already running" };
      return { ok: true, error: null };
    },
    async startModule(id) {
      modules[id].status = "starting";
      return { ok: true, status: "starting" };
    },
    async stopModule(id) {
      modules[id].status = "stopped";
      return { ok: true, status: "stopped" };
    },
    async resolveOpenUrl(id) {
      if (id === "ists") return { ok: true, url: "http://127.0.0.1:3000", status: 302 };
      return { ok: false, status: 409, error: "not running" };
    },
    modules,
  };
}

async function rawRequest(base, requestPath, { method = "GET", headers = {} } = {}) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname, port, path: requestPath, method, headers },
      (response) => {
        response.resume();
        response.once("end", () => resolve({ status: response.statusCode, headers: response.headers }));
      },
    );
    request.once("error", reject);
    request.end();
  });
}

async function withServer(fn) {
  const fixture = makeFixture();
  const config = {
    version: "0.1.0",
    hub: { host: "127.0.0.1", port: 0 },
    paths: {
      portalDist: fixture.dist,
      portalIndex: path.join(fixture.dist, "index.html"),
      placeholderFile: fixture.placeholder,
    },
  };
  const manager = createFakeManager();
  const server = createHubServer({ manager, config, logger: { info() {}, warn() {}, error() {} } });
  await new Promise((resolve) => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  const port = server.address().port;
  config.hub.port = port;
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn({ base, manager, config });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
}

test("GET /api/state and /api/health answer the portal contract", async () => {
  await withServer(async ({ base }) => {
    const state = await fetch(`${base}/api/state`);
    assert.equal(state.status, 200);
    assert.match(state.headers.get("content-type"), /application\/json/);
    const body = await state.json();
    assert.equal(body.hub.port, 8780);
    assert.deepEqual(Object.keys(body.modules).sort(), ["bandready", "ists"]);

    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
  });
});

test("the portal is served with SPA fallback and missing assets are 404", async () => {
  await withServer(async ({ base }) => {
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /portal/);

    const route = await fetch(`${base}/some/client/route`);
    assert.equal(route.status, 200);
    assert.match(await route.text(), /portal/);

    const asset = await fetch(`${base}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type"), /javascript/);

    const missing = await fetch(`${base}/assets/missing.js`);
    assert.equal(missing.status, 404);
  });
});

test("path traversal is rejected", async () => {
  const root = path.join(os.tmpdir(), "hub-static-root");
  assert.equal(safeResolveInside(root, "/assets/app.js"), path.resolve(root, "assets", "app.js"));
  assert.equal(safeResolveInside(root, "/../../package.json"), null);
  assert.equal(safeResolveInside(root, "/%2e%2e/package.json"), null);
  assert.equal(safeResolveInside(root, "/%00evil"), null);
  assert.equal(safeResolveInside(root, "/..%2f..%2fpackage.json"), null);

  await withServer(async ({ base }) => {
    // WHATWG URL may collapse dot segments before the handler; either way it must
    // never serve a file from outside dist/.
    const response = await rawRequest(base, "/..%2f..%2fpackage.json");
    assert.ok(response.status === 400 || response.status === 404, `unexpected status ${response.status}`);
    const deeper = await rawRequest(base, "/%2e%2e/%2e%2e/package.json");
    assert.ok(deeper.status === 400 || deeper.status === 404, `unexpected status ${deeper.status}`);
  });
});

test("start/stop endpoints answer 202 and validate modules and origin", async () => {
  await withServer(async ({ base }) => {
    const start = await fetch(`${base}/api/modules/ists/start`, { method: "POST" });
    assert.equal(start.status, 202);
    assert.deepEqual(await start.json(), { status: "starting" });

    const unknown = await fetch(`${base}/api/modules/nope/start`, { method: "POST" });
    assert.equal(unknown.status, 404);

    const crossOrigin = await fetch(`${base}/api/modules/ists/stop`, {
      method: "POST",
      headers: { origin: "http://evil.example" },
    });
    assert.equal(crossOrigin.status, 403);

    const sameOrigin = await fetch(`${base}/api/modules/ists/stop`, {
      method: "POST",
      headers: { origin: base },
    });
    assert.equal(sameOrigin.status, 202);
    assert.deepEqual(await sameOrigin.json(), { status: "stopping" });
  });
});

test("the Hub rejects foreign Host headers (DNS rebinding) and redirects /open/:id", async () => {
  await withServer(async ({ base }) => {
    const foreign = await rawRequest(base, "/api/state", { headers: { host: "evil.example" } });
    assert.equal(foreign.status, 403);

    const open = await fetch(`${base}/open/ists`, { redirect: "manual" });
    assert.equal(open.status, 302);
    assert.equal(open.headers.get("location"), "http://127.0.0.1:3000");
    assert.equal(open.headers.get("referrer-policy"), "no-referrer");

    const notRunning = await fetch(`${base}/open/bandready`, { redirect: "manual" });
    assert.equal(notRunning.status, 409);
  });
});
