import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ConfigError, loadConfig, resolveArgs, moduleOrigin } from "./lib/config.mjs";

function makeRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hub-config-"));
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  return repoRoot;
}

function clean(repoRoot) {
  fs.rmSync(repoRoot, { recursive: true, force: true });
}

test("defaults: ports, data root and derived paths", () => {
  const repoRoot = makeRepo();
  const home = path.join(repoRoot, "home");
  try {
    const config = loadConfig({ repoRoot, env: {}, home });
    assert.equal(config.hub.host, "127.0.0.1");
    assert.equal(config.hub.port, 8780);
    assert.equal(config.modules.ists.port, 3000);
    assert.equal(config.modules.bandready.port, 8765);
    assert.equal(config.repoRoot, repoRoot);
    assert.equal(config.dataRoot, path.join(home, "AppData", "Roaming", "IELTS-Study-Hub"));
    assert.equal(config.paths.stateFile, path.join(config.dataRoot, "hub", "state.json"));
    assert.equal(config.paths.logsDir, path.join(config.dataRoot, "hub", "logs"));
    assert.equal(config.paths.istsDbFile, path.join(config.dataRoot, "ists", "ists.db"));
    assert.equal(config.paths.istsUploadDir, path.join(config.dataRoot, "ists", "uploads"));
    assert.equal(config.paths.istsAppDir, path.join(repoRoot, "apps", "ists"));
    assert.equal(config.paths.portalDist, path.join(repoRoot, "portal", "dist"));
    assert.equal(config.paths.portalIndex, path.join(config.paths.portalDist, "index.html"));
    assert.equal(config.paths.placeholderFile, path.join(repoRoot, "scripts", "hub", "placeholder.html"));
    assert.deepEqual(config.modules.ists.args, ["exec", "next", "start", "-H", "127.0.0.1", "-p", "{port}"]);
    assert.equal(config.configFileExists, false);
  } finally {
    clean(repoRoot);
  }
});

test("environment overrides win over defaults and the config file", () => {
  const repoRoot = makeRepo();
  const dataRoot = path.join(repoRoot, "custom data");
  fs.writeFileSync(
    path.join(repoRoot, "scripts", "hub.config.json"),
    JSON.stringify({ hub: { port: 9100 }, modules: { ists: { port: 3100 } } }),
  );
  try {
    const config = loadConfig({
      repoRoot,
      env: {
        APPDATA: path.join(repoRoot, "appdata"),
        HUB_PORT: "9200",
        ISTS_PORT: "3200",
        ISTS_PATH: path.join("vendor", "ists"),
        BANDREADY_CMD: "C:\\Program Files\\Band Ready\\bandready.exe",
        DATA_ROOT: dataRoot,
      },
    });
    assert.equal(config.hub.port, 9200);
    assert.equal(config.modules.ists.port, 3200);
    assert.equal(config.modules.ists.path, path.join(repoRoot, "vendor", "ists"));
    assert.equal(config.modules.bandready.command, "C:\\Program Files\\Band Ready\\bandready.exe");
    assert.equal(config.dataRoot, path.resolve(dataRoot));
    // Not overridden: the config file's bandready defaults survive the merge.
    assert.equal(config.modules.bandready.port, 8765);
    assert.equal(config.modules.bandready.webJson, path.join(repoRoot, "appdata", "BandReady", "web.json"));
  } finally {
    clean(repoRoot);
  }
});

test("config file merges over defaults and keeps unspecified keys", () => {
  const repoRoot = makeRepo();
  fs.writeFileSync(
    path.join(repoRoot, "scripts", "hub.config.json"),
    JSON.stringify({
      hub: { port: 9001 },
      modules: { ists: { port: 3001 }, bandready: { enabled: false } },
      shutdown: { graceMs: 5000 },
    }),
  );
  try {
    const config = loadConfig({ repoRoot, env: { APPDATA: path.join(repoRoot, "appdata") } });
    assert.equal(config.hub.port, 9001);
    assert.equal(config.hub.host, "127.0.0.1", "unset host keeps the loopback default");
    assert.equal(config.modules.ists.port, 3001);
    assert.equal(config.modules.ists.readyTimeoutMs, 60_000, "unset timeout keeps the default");
    assert.equal(config.modules.bandready.enabled, false);
    assert.equal(config.shutdown.graceMs, 5000);
    assert.equal(config.monitor.intervalMs, 10_000);
  } finally {
    clean(repoRoot);
  }
});

test("invalid ports are rejected", () => {
  const repoRoot = makeRepo();
  fs.writeFileSync(path.join(repoRoot, "scripts", "hub.config.json"), JSON.stringify({ hub: { port: 70_000 } }));
  try {
    assert.throws(() => loadConfig({ repoRoot, env: {} }), ConfigError);
    assert.throws(() => loadConfig({ repoRoot, env: { HUB_PORT: "not-a-port" } }), /integer/);
  } finally {
    clean(repoRoot);
  }
});

test("non-loopback bind addresses are rejected", () => {
  const repoRoot = makeRepo();
  fs.writeFileSync(path.join(repoRoot, "scripts", "hub.config.json"), JSON.stringify({ hub: { host: "0.0.0.0" } }));
  try {
    assert.throws(() => loadConfig({ repoRoot, env: {} }), /loopback/);
  } finally {
    clean(repoRoot);
  }
});

test("duplicate ports and a missing 127.0.0.1 ISTS bind flag are rejected", () => {
  const repoRoot = makeRepo();
  fs.writeFileSync(
    path.join(repoRoot, "scripts", "hub.config.json"),
    JSON.stringify({ modules: { ists: { port: 8765 } } }),
  );
  try {
    assert.throws(() => loadConfig({ repoRoot, env: {} }), /must differ/);
  } finally {
    clean(repoRoot);
  }

  const second = makeRepo();
  fs.writeFileSync(
    path.join(second, "scripts", "hub.config.json"),
    JSON.stringify({ modules: { ists: { args: ["start", "--", "-p", "{port}"] } } }),
  );
  try {
    assert.throws(() => loadConfig({ repoRoot: second, env: {} }), /-H 127\.0\.0\.1/);
  } finally {
    clean(second);
  }
});

test("an explicitly configured file must exist and be valid JSON", () => {
  const repoRoot = makeRepo();
  try {
    assert.throws(
      () => loadConfig({ repoRoot, env: {}, configPath: path.join(repoRoot, "nope.json") }),
      ConfigError,
    );
    const bad = path.join(repoRoot, "bad.json");
    fs.writeFileSync(bad, "{ not json");
    assert.throws(() => loadConfig({ repoRoot, env: {}, configPath: bad }), /not valid JSON/);
  } finally {
    clean(repoRoot);
  }
});

test("argument templates substitute port and host without touching other args", () => {
  assert.deepEqual(resolveArgs(["start", "--", "-p", "{port}", "--host", "{host}"], { port: 3210 }), [
    "start",
    "--",
    "-p",
    "3210",
    "--host",
    "127.0.0.1",
  ]);
  assert.equal(moduleOrigin(3000), "http://127.0.0.1:3000");
});

test("the committed scripts/hub.config.json matches the defaults", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const config = loadConfig({ repoRoot, env: { APPDATA: path.join(repoRoot, ".tmp-appdata"), HOME: os.homedir() } });
  assert.equal(config.hub.port, 8780);
  assert.equal(config.modules.ists.port, 3000);
  assert.equal(config.modules.bandready.port, 8765);
  assert.equal(config.modules.ists.enabled, true);
  assert.equal(config.dataRoot.endsWith(path.join("IELTS-Study-Hub")), true);
});
