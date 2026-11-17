#!/usr/bin/env node
/**
 * Environment check: PASS/FAIL for everything the Hub needs before it can run.
 *
 * Usage:
 *   node scripts/check-env.mjs [--json] [--no-color]
 *
 * Exits 1 when any check FAILs. WARN items are advisory (e.g. the portal is not
 * scaffolded yet, or BandReady is installed via its own installer and manages
 * its own Python). This script never installs, starts or kills anything.
 */

import path from "node:path";
import process from "node:process";

import { HUB_VERSION, loadConfig } from "./lib/config.mjs";
import { isDirectory, isFile } from "./lib/fs-utils.mjs";
import {
  findCorepackJs,
  isAlive,
  resolveExecutable,
  resolvePnpmPlan,
  runCommandCapture,
} from "./lib/proc.mjs";
import { checkPortAvailable } from "./lib/ports.mjs";
import { readStateFile } from "./lib/state.mjs";
import { readBandReadyLaunchFile, requestUrl } from "./lib/probe.mjs";

const args = new Set(process.argv.slice(2).filter((arg) => arg === "--json" || arg === "--no-color"));
const JSON_OUTPUT = args.has("--json");
const USE_COLOR = !args.has("--no-color") && !JSON_OUTPUT && Boolean(process.stdout.isTTY);

const COLORS = {
  reset: "\u001b[0m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  dim: "\u001b[2m",
};

function color(text, name) {
  if (!USE_COLOR) return text;
  return `${COLORS[name]}${text}${COLORS.reset}`;
}

/** @type {Array<{id:string,label:string,status:'PASS'|'FAIL'|'WARN'|'SKIP',detail:string,hint?:string}>} */
const results = [];

function add(id, label, status, detail, hint = null) {
  results.push({ id, label, status, detail, hint });
}

function firstLine(value) {
  return String(value ?? "").trim().split(/\r?\n/)[0] ?? "";
}

async function versionOf(command, arg = "--version") {
  const result = await runCommandCapture(command, [arg], { timeoutMs: 8_000 });
  if (result.code !== 0) {
    return { ok: false, text: firstLine(result.stderr || result.stdout) || result.error || `exit ${result.code}` };
  }
  return { ok: true, text: firstLine(result.stdout || result.stderr) };
}

function parseVersion(text) {
  const match = String(text).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0), text: match[0] };
}

function atLeast(version, major, minor) {
  return version.major > major || (version.major === major && version.minor >= minor);
}

function pidOnPort(port, netstatOutput) {
  if (!netstatOutput) return null;
  for (const line of netstatOutput.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5) continue;
    const local = columns[1];
    const state = columns[3];
    if (state !== "LISTENING") continue;
    if (!local.endsWith(`:${port}`)) continue;
    const pid = Number.parseInt(columns[4], 10);
    if (Number.isInteger(pid)) return pid;
  }
  return null;
}

async function main() {
  const config = (() => {
    try {
      return { ok: true, value: loadConfig() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })();

  if (!config.ok) {
    add("config", "Hub configuration", "FAIL", config.error, "Fix or delete scripts/hub.config.json (defaults are built in).");
    printReport({ repoRoot: "unknown", config: null });
    return 1;
  }

  const cfg = config.value;
  const paths = cfg.paths;
  add("config", "Hub configuration", "PASS", cfg.configFileExists ? cfg.configFile : "built-in defaults (no config file)");

  // ---- Node / package manager ----------------------------------------------
  const nodeVersion = parseVersion(process.version);
  add(
    "node",
    "Node.js",
    nodeVersion && atLeast(nodeVersion, 20, 9) ? "PASS" : "FAIL",
    `${process.version} (need >= 20.9)`,
    nodeVersion && atLeast(nodeVersion, 20, 9) ? undefined : "Install Node.js 20.9+ from https://nodejs.org (LTS).",
  );

  const corepackJs = findCorepackJs();
  const corepackExe = resolveExecutable("corepack");
  add(
    "corepack",
    "corepack",
    corepackJs || corepackExe ? "PASS" : "FAIL",
    corepackJs ? `corepack.js at ${corepackJs}` : corepackExe ? `corepack shim at ${corepackExe}` : "not found",
    corepackJs || corepackExe ? undefined : "corepack ships with Node.js >= 20.9; reinstall Node.js with the official installer.",
  );

  const pnpmPlan = resolvePnpmPlan();
  add(
    "pnpm",
    "pnpm (per app)",
    pnpmPlan ? "PASS" : corepackExe ? "WARN" : "FAIL",
    pnpmPlan ? "corepack pnpm, pinned per app (ISTS 10.30.3, BandReady 9.12.0)" : "corepack JS entry not found",
    pnpmPlan ? undefined : "Use corepack pnpm; never force one global pnpm version (the apps pin different ones).",
  );

  // ---- Python / uv / git ---------------------------------------------------
  const python = resolveExecutable("python3") ?? resolveExecutable("python");
  if (python) {
    const version = await versionOf(python);
    const parsed = parseVersion(version.text);
    const good = version.ok && parsed && atLeast(parsed, 3, 11);
    add(
      "python",
      "Python",
      good ? "PASS" : "WARN",
      `${version.ok ? version.text : `could not run (${version.text})`}${good ? "" : " (need >= 3.11)"}`,
      good ? undefined : "Only needed for BandReady's source sidecar; `uv` can download Python 3.11 on demand.",
    );
  } else {
    add(
      "python",
      "Python",
      "WARN",
      "not found on PATH",
      "Only needed for BandReady's source sidecar; the browser edition installs its own Python via uv.",
    );
  }

  const uv = resolveExecutable("uv");
  if (uv) {
    const version = await versionOf(uv);
    add("uv", "uv", version.ok ? "PASS" : "WARN", version.text, version.ok ? undefined : "Reinstall uv: https://docs.astral.sh/uv/");
  } else {
    add("uv", "uv", "WARN", "not found on PATH", "Required to install/update BandReady; https://docs.astral.sh/uv/");
  }

  const git = resolveExecutable("git");
  if (git) {
    const version = await versionOf(git);
    add("git", "git", version.ok ? "PASS" : "FAIL", version.text, version.ok ? undefined : "Reinstall Git for Windows.");
  } else {
    add("git", "git", "FAIL", "not found on PATH", "Install Git: https://git-scm.com/download/win (needed for submodules).");
  }

  // ---- Submodules ----------------------------------------------------------
  const istsPresent = isDirectory(cfg.modules.ists.path) && isFile(paths.istsPackageJson);
  add(
    "ists",
    "ISTS submodule",
    istsPresent ? "PASS" : "FAIL",
    istsPresent ? paths.istsAppDir : `missing or empty: ${paths.istsAppDir}`,
    istsPresent ? undefined : "git submodule update --init --recursive",
  );

  const bandreadyDir = path.join(cfg.repoRoot, "apps", "bandready");
  const bandreadyPresent =
    isFile(path.join(bandreadyDir, "sidecar", "pyproject.toml")) ||
    isFile(path.join(bandreadyDir, "install.ps1")) ||
    isFile(path.join(bandreadyDir, "README.md"));
  add(
    "bandready",
    "BandReady submodule",
    bandreadyPresent ? "PASS" : "FAIL",
    bandreadyPresent ? bandreadyDir : "missing",
    bandreadyPresent ? undefined : "git submodule update --init --recursive",
  );

  const bandreadyLauncher = resolveExecutable(cfg.modules.bandready.command);
  add(
    "bandready-launcher",
    "BandReady launcher",
    bandreadyLauncher ? "PASS" : "WARN",
    bandreadyLauncher ?? `not found: ${cfg.modules.bandready.command} (module status will be not-installed)`,
    bandreadyLauncher
      ? undefined
      : "Install the browser edition: irm https://raw.githubusercontent.com/Luxshan2000/ielts-prep/main/install.ps1 | iex (or set BANDREADY_CMD).",
  );

  // ---- Portal / app dependencies ------------------------------------------
  const portalPackage = path.join(paths.portalDir, "package.json");
  if (!isFile(portalPackage)) {
    add(
      "portal",
      "Portal dependencies",
      "WARN",
      "portal/package.json not found (portal not scaffolded yet)",
      "The Hub still runs and serves a placeholder page; run node scripts/setup.mjs once the portal exists.",
    );
  } else if (isDirectory(path.join(paths.portalDir, "node_modules"))) {
    add("portal", "Portal dependencies", "PASS", path.join(paths.portalDir, "node_modules"));
  } else {
    add(
      "portal",
      "Portal dependencies",
      "FAIL",
      "portal/node_modules is missing",
      "node scripts/setup.mjs",
    );
  }

  add(
    "ists-deps",
    "ISTS dependencies",
    isDirectory(paths.istsNodeModules) ? "PASS" : "WARN",
    isDirectory(paths.istsNodeModules) ? paths.istsNodeModules : "apps/ists/node_modules missing",
    isDirectory(paths.istsNodeModules) ? undefined : "cd apps/ists && corepack pnpm install",
  );
  add(
    "ists-build",
    "ISTS build",
    isFile(paths.istsBuildFile) ? "PASS" : "WARN",
    isFile(paths.istsBuildFile) ? paths.istsBuildFile : "apps/ists/.next/BUILD_ID missing",
    isFile(paths.istsBuildFile) ? undefined : "cd apps/ists && corepack pnpm build (needs network for next/font once)",
  );

  // ---- Ports ---------------------------------------------------------------
  const persisted = readStateFile(paths.stateFile).state;
  const launch = await readBandReadyLaunchFile(cfg.modules.bandready.webJson);
  let netstatOutput = null;
  if (process.platform === "win32") {
    const netstat = await runCommandCapture("netstat", ["-ano", "-p", "tcp"], { timeoutMs: 8_000 });
    if (netstat.code === 0) netstatOutput = netstat.stdout;
  }

  const portChecks = [
    { id: "hub-port", label: `Port ${cfg.hub.port} (Hub)`, port: cfg.hub.port, kind: "hub" },
    { id: "ists-port", label: `Port ${cfg.modules.ists.port} (ISTS)`, port: cfg.modules.ists.port, kind: "ists" },
    {
      id: "bandready-port",
      label: `Port ${cfg.modules.bandready.port} (BandReady preferred)`,
      port: cfg.modules.bandready.port,
      kind: "bandready",
    },
  ];

  for (const check of portChecks) {
    const availability = await checkPortAvailable(check.port);
    if (availability.available) {
      add(check.id, check.label, "PASS", `127.0.0.1:${check.port} is free`);
      continue;
    }

    const tracked = persisted?.modules?.[check.kind];
    const trackedPid = tracked && Number.isInteger(tracked.pid) && isAlive(tracked.pid) ? tracked.pid : null;
    let extra = "";
    if (check.kind === "hub" && persisted?.hub?.pid && isAlive(persisted.hub.pid)) {
      extra = `another Hub instance is running (pid ${persisted.hub.pid}); stop it with node scripts/stop.mjs`;
    } else if (trackedPid && tracked.port === check.port) {
      extra = `already running under Hub tracking (pid ${trackedPid}); run node scripts/stop.mjs first`;
    } else if (check.kind === "bandready" && launch.ok && launch.port === check.port) {
      const health = await requestUrl(`http://127.0.0.1:${check.port}/health`, { timeoutMs: 2_000 });
      if (health.ok) {
        extra = `BandReady is already running here (port from web.json); the Hub will adopt it and not stop it`;
      }
    }

    if (extra) {
      add(check.id, check.label, "WARN", `occupied — ${extra}`);
      continue;
    }

    const pid = pidOnPort(check.port, netstatOutput);
    add(
      check.id,
      check.label,
      "FAIL",
      `127.0.0.1:${check.port} is in use${pid ? ` (pid ${pid})` : ""}`,
      `Close that process or change the port (${check.kind === "hub" ? "HUB_PORT" : check.kind === "ists" ? "ISTS_PORT" : "modules.bandready.port in scripts/hub.config.json"}) before starting the Hub.`,
    );
  }

  return printReport({ repoRoot: cfg.repoRoot, config: cfg });
}

function printReport({ repoRoot, config }) {
  const counts = results.reduce(
    (accumulator, result) => {
      accumulator[result.status] = (accumulator[result.status] ?? 0) + 1;
      return accumulator;
    },
    { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 },
  );
  const ok = counts.FAIL === 0;

  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify({ ok, hubVersion: HUB_VERSION, repoRoot, results, counts }, null, 2)}\n`);
    return ok ? 0 : 1;
  }

  const width = Math.max(...results.map((result) => result.label.length), 10);
  const line = "─".repeat(Math.min(process.stdout.columns || 100, 100));
  process.stdout.write(`\nIELTS Study Hub ${HUB_VERSION} — environment check\n`);
  process.stdout.write(`repo: ${repoRoot}${config ? ` · node ${process.version} · ${process.platform} ${process.arch}` : ""}\n`);
  process.stdout.write(`${line}\n`);
  for (const result of results) {
    const status = color(result.status.padEnd(5), result.status === "PASS" ? "green" : result.status === "FAIL" ? "red" : "yellow");
    process.stdout.write(`${status} ${result.label.padEnd(width)}  ${result.detail}\n`);
    if (result.hint && result.status !== "PASS") {
      process.stdout.write(`      ${color(`→ ${result.hint}`, "dim")}\n`);
    }
  }
  process.stdout.write(`${line}\n`);
  process.stdout.write(
    `Summary: ${counts.PASS} passed, ${counts.FAIL} failed, ${counts.WARN} warnings\n`,
  );
  process.stdout.write(
    ok ? `${color("Environment OK.", "green")}\n` : `${color("Environment check failed — fix the FAIL items above.", "red")}\n`,
  );
  return ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`check-env crashed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
