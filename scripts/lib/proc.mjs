/**
 * Process primitives: executable resolution, spawning, liveness, start-time
 * identity checks and tree shutdown.
 *
 * Rules enforced here:
 *   - spawn(command, args[], { shell: false }) — never a command string;
 *   - windowsHide, detached children so Ctrl+C in the Hub does not race our shutdown;
 *   - stop only a PID tree we recorded, after verifying its start time (no PID reuse);
 *   - never select a process by port or image name.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

const IS_WINDOWS = process.platform === "win32";
const WINDOWS_EXECUTABLE_EXTS = [".exe", ".cmd", ".bat", ".com"];

/** Sleep helper shared by the stop routines. Deliberately ref'd: a foreground stop
 *  must stay alive while it waits for the grace period, then force-kill. */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Find a command on PATH (or an explicit path) without executing it. */
export function resolveExecutable(command, { env = process.env, platform = process.platform, exists = fs.existsSync } = {}) {
  if (!command || typeof command !== "string") return null;
  const exts = platform === "win32" ? WINDOWS_EXECUTABLE_EXTS : [""];
  const hasSeparator = command.includes("/") || command.includes("\\");
  if (path.isAbsolute(command) || hasSeparator) {
    if (exists(command)) return path.resolve(command);
    if (platform === "win32" && !path.extname(command)) {
      for (const ext of exts) {
        if (exists(`${command}${ext}`)) return path.resolve(`${command}${ext}`);
      }
    }
    return null;
  }
  const pathValue = env.PATH ?? env.Path ?? "";
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    const base = path.join(dir, command);
    if (exists(base)) return base;
    if (platform === "win32") {
      for (const ext of exts) {
        if (exists(`${base}${ext}`)) return `${base}${ext}`;
      }
    }
  }
  return null;
}

/** Locate corepack's JS entry so `pnpm` can run under node without a .cmd shim. */
export function findCorepackJs({
  nodeExecPath = process.execPath,
  env = process.env,
  platform = process.platform,
  exists = fs.existsSync,
} = {}) {
  const candidates = [];
  const nodeDir = path.dirname(nodeExecPath);
  candidates.push(path.join(nodeDir, "node_modules", "corepack", "dist", "corepack.js"));
  candidates.push(path.join(nodeDir, "node_modules", "corepack", "dist", "lib", "corepack.js"));
  if (env.APPDATA) candidates.push(path.join(env.APPDATA, "npm", "node_modules", "corepack", "dist", "corepack.js"));
  if (platform !== "win32") {
    candidates.push("/usr/local/lib/node_modules/corepack/dist/corepack.js");
    candidates.push("/usr/lib/node_modules/corepack/dist/corepack.js");
  }
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Build a spawn plan for pnpm that never needs a shell:
 *   node <corepack.js> pnpm <args...>
 * Returns null when corepack is unavailable.
 */
export function resolvePnpmPlan({ env = process.env, platform = process.platform, nodeExecPath = process.execPath } = {}) {
  const corepackJs = findCorepackJs({ nodeExecPath, env, platform });
  if (!corepackJs) return null;
  return {
    command: nodeExecPath,
    args: [corepackJs, "pnpm"],
    display: `corepack pnpm (${corepackJs})`,
    corepackJs,
  };
}

/** Spawn one managed child. Arrays only; no shell, no console window. */
export function spawnManaged({ command, args = [], cwd, env = process.env }) {
  if (typeof command !== "string" || !command) throw new Error("spawnManaged: command is required");
  if (!Array.isArray(args)) throw new Error("spawnManaged: args must be an array");
  return spawn(command, args, {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Stream a child's stdout/stderr into a LogSink, one redacted line at a time. */
export function attachChildLogging(child, sink) {
  const streams = [
    { stream: child.stdout, prefix: "" },
    { stream: child.stderr, prefix: "[stderr] " },
  ];
  for (const { stream, prefix } of streams) {
    if (!stream) continue;
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    reader.on("line", (line) => sink.writeLine(`${prefix}${line}`));
    reader.on("error", () => undefined);
    stream.on("error", () => undefined);
  }
  return {
    close() {
      for (const { stream } of streams) {
        try {
          stream?.destroy();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/**
 * Run a short command and capture its output (used for version checks).
 * @returns {Promise<{code:number|null, stdout:string, stderr:string, error:string|null, timedOut:boolean}>}
 */
export function runCommandCapture(command, args = [], {
  cwd,
  env = process.env,
  timeoutMs = 15_000,
  maxBytes = 64 * 1024,
} = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let child;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ code: null, stdout, stderr, error: error instanceof Error ? error.message : String(error), timedOut: false });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (chunk) => {
      if (stdout.length < maxBytes) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < maxBytes) stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      finish({ code: null, stdout, stderr, error: error instanceof Error ? error.message : String(error), timedOut });
    });
    child.once("close", (code, signal) => {
      finish({
        code: typeof code === "number" ? code : null,
        stdout,
        stderr,
        error: timedOut ? `timed out after ${timeoutMs} ms` : signal ? `killed by ${signal}` : null,
        timedOut,
      });
    });
  });
}

/**
 * Run a command attached to the current console (setup progress).
 * @returns {Promise<{code:number|null, error:string|null}>}
 */
export function runCommandForeground(command, args = [], { cwd, env = process.env } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: "inherit",
      });
    } catch (error) {
      resolve({ code: null, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    child.once("error", (error) => resolve({ code: null, error: error instanceof Error ? error.message : String(error) }));
    child.once("exit", (code) => resolve({ code, error: null }));
  });
}

/** True when the PID exists (EPERM means it exists but belongs to someone else). */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === "EPERM");
  }
}

function system32(...parts) {
  const root = process.env.SystemRoot || "C:\\Windows";
  return path.join(root, "System32", ...parts);
}

/** Windows taskkill, absolute path, array arguments. */
export function taskkill(pid, { force = false, tree = true } = {}) {
  const exe = fs.existsSync(system32("taskkill.exe")) ? system32("taskkill.exe") : "taskkill";
  const args = ["/PID", String(pid)];
  if (tree) args.push("/T");
  if (force) args.push("/F");
  return runCommandCapture(exe, args, { timeoutMs: 10_000 });
}

/**
 * Process start time in ms since the Unix epoch, or null when unavailable.
 * Used to prove that a recorded PID is still the process we started.
 */
export async function getProcessStartTimeMs(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (IS_WINDOWS) {
    const powershell = fs.existsSync(system32("WindowsPowerShell", "v1.0", "powershell.exe"))
      ? system32("WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe";
    const script =
      `$p=Get-Process -Id ${pid} -ErrorAction Stop; ` +
      "[int64](($p.StartTime.ToUniversalTime().Ticks - 621355968000000000)/10000)";
    const result = await runCommandCapture(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeoutMs: 10_000,
    });
    if (result.code !== 0) return null;
    const value = Number.parseInt(result.stdout.trim(), 10);
    return Number.isFinite(value) ? value : null;
  }
  if (process.platform === "linux") {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const fields = stat.slice(close + 2).split(" ");
      // field 22 of /proc/<pid>/stat is starttime; after the ") " split it is index 19.
      const startTicks = Number.parseInt(fields[19], 10);
      const bootTime = Number.parseFloat(
        fs.readFileSync("/proc/stat", "utf8").match(/^btime\s+(\d+)/m)?.[1] ?? "",
      );
      const ticksPerSecond = 100;
      if (!Number.isFinite(startTicks) || !Number.isFinite(bootTime)) return null;
      return Math.round((bootTime + startTicks / ticksPerSecond) * 1000);
    } catch {
      return null;
    }
  }
  const result = await runCommandCapture("ps", ["-o", "lstart=", "-p", String(pid)], { timeoutMs: 5_000 });
  if (result.code !== 0) return null;
  const parsed = Date.parse(result.stdout.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** Capture a process's own start time with a few retries (the OS needs a moment). */
export async function captureProcessStartMs(pid, { attempts = 5, delayMs = 150 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await getProcessStartTimeMs(pid);
    if (value !== null) return value;
    await sleep(delayMs);
  }
  return null;
}

/**
 * Verify that a tracked record still points at the process we started.
 * @returns {Promise<{ok:boolean, reason:string|null, unverified:boolean}>}
 */
export async function verifyProcessRecord(record, { toleranceMs = 15_000 } = {}) {
  if (!record || !Number.isInteger(record.pid)) {
    return { ok: false, reason: "no tracked PID", unverified: false };
  }
  if (!isAlive(record.pid)) {
    return { ok: false, reason: `process ${record.pid} is not running`, unverified: false };
  }
  if (!Number.isFinite(record.processStartMs)) {
    return { ok: true, reason: null, unverified: true };
  }
  const actual = await getProcessStartTimeMs(record.pid);
  if (actual === null) return { ok: true, reason: null, unverified: true };
  if (Math.abs(actual - record.processStartMs) > toleranceMs) {
    return { ok: false, reason: `pid ${record.pid} now belongs to a different process`, unverified: false };
  }
  return { ok: true, reason: null, unverified: false };
}

/** Direct children/descendants of a PID (best effort; [] when unavailable). */
export async function listPidTree(rootPid) {
  if (!Number.isInteger(rootPid)) return [];
  if (IS_WINDOWS) {
    const powershell = fs.existsSync(system32("WindowsPowerShell", "v1.0", "powershell.exe"))
      ? system32("WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe";
    const script =
      "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId):$($_.ParentProcessId)\" }";
    const result = await runCommandCapture(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeoutMs: 20_000,
    });
    if (result.code !== 0) return [];
    const children = new Map();
    for (const line of result.stdout.split(/\r?\n/)) {
      const [pidText, ppidText] = line.trim().split(":");
      const pid = Number.parseInt(pidText, 10);
      const ppid = Number.parseInt(ppidText, 10);
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(pid);
    }
    const descendants = [];
    const queue = [rootPid];
    const seen = new Set([rootPid]);
    while (queue.length) {
      const current = queue.shift();
      for (const child of children.get(current) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        descendants.push(child);
        queue.push(child);
      }
    }
    return descendants;
  }
  const result = await runCommandCapture("ps", ["-A", "-o", "pid=,ppid="], { timeoutMs: 10_000 });
  if (result.code !== 0) return [];
  const children = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    const [pidText, ppidText] = line.trim().split(/\s+/);
    const pid = Number.parseInt(pidText, 10);
    const ppid = Number.parseInt(ppidText, 10);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const descendants = [];
  const queue = [rootPid];
  const seen = new Set([rootPid]);
  while (queue.length) {
    const current = queue.shift();
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      descendants.push(child);
      queue.push(child);
    }
  }
  return descendants;
}

function signalPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    if (process.platform !== "win32") {
      try {
        process.kill(-pid, signal);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

async function waitForAllDead(pids, timeoutMs, { pollMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isAlive(pid))) return true;
    await sleep(pollMs);
  }
  return pids.every((pid) => !isAlive(pid));
}

/**
 * Stop a tracked PID tree: graceful signal first, wait `graceMs`, then force
 * (`taskkill /PID <pid> /T /F` on Windows, SIGKILL elsewhere).
 *
 * @returns {Promise<{stopped:boolean, refused:boolean, forced:boolean, reason:string|null, pids:number[]}>}
 */
export async function stopProcessTree(record, {
  graceMs = 3_000,
  toleranceMs = 15_000,
  verify = verifyProcessRecord,
  listTree = listPidTree,
} = {}) {
  if (!record || !Number.isInteger(record.pid)) {
    return { stopped: false, refused: true, forced: false, reason: "no tracked PID", pids: [], already: false };
  }
  if (!isAlive(record.pid)) {
    // Already gone (e.g. another stop call, or the app exited): nothing to refuse.
    return { stopped: true, refused: false, forced: false, reason: null, pids: [], already: true };
  }
  const identity = await verify(record, { toleranceMs });
  if (!identity.ok) {
    if (!isAlive(record.pid)) {
      return { stopped: true, refused: false, forced: false, reason: null, pids: [], already: true };
    }
    return { stopped: false, refused: true, forced: false, reason: identity.reason, pids: [], already: false };
  }

  const rootPid = record.pid;
  const tree = await listTree(rootPid);
  const initialPids = [...tree.reverse(), rootPid]; // deepest first

  if (IS_WINDOWS) {
    // taskkill without /F asks the tree to close rather than terminating it outright.
    await taskkill(rootPid, { force: false, tree: true });
  } else {
    signalPid(rootPid, "SIGTERM");
  }

  let graceful = await waitForAllDead(initialPids, graceMs);
  let forced = false;
  if (!graceful) {
    // Re-read the tree: children may have been forked since the first snapshot.
    const refreshed = await listTree(rootPid);
    const pids = [...new Set([...refreshed.reverse(), ...initialPids])];
    for (const pid of pids) {
      if (!isAlive(pid)) continue;
      if (IS_WINDOWS) await taskkill(pid, { force: true, tree: true });
      else signalPid(pid, "SIGKILL");
      forced = true;
    }
    if (IS_WINDOWS) await taskkill(rootPid, { force: true, tree: true });
    graceful = await waitForAllDead(pids, 2_000);
  }

  return {
    stopped: graceful,
    refused: false,
    forced,
    reason: graceful ? null : "processes are still running after taskkill",
    pids: initialPids,
    already: false,
  };
}
