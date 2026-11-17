/**
 * Hub process manager: start/stop the two apps, track PIDs + start times, probe
 * readiness, persist state and stream logs.
 *
 * Status is only ever `running` when BOTH the tracked process is alive AND the
 * documented HTTP probe answers 200 (ISTS `/`, BandReady `/health`).
 */

import path from "node:path";

import { MODULE_IDS, moduleOrigin } from "./config.mjs";
import { ensureDir, isDirectory, isFile, tailFile } from "./fs-utils.mjs";
import { createLogSink } from "./logs.mjs";
import { checkPortAvailable, portBusyHint } from "./ports.mjs";
import {
  attachChildLogging,
  captureProcessStartMs,
  isAlive,
  resolveExecutable,
  resolvePnpmPlan,
  spawnManaged,
  stopProcessTree,
  verifyProcessRecord,
} from "./proc.mjs";
import {
  buildBandReadyLaunchUrl,
  describeLaunchFile,
  probeModule,
  readBandReadyLaunchFile,
  waitFor,
} from "./probe.mjs";
import {
  clearStateFile,
  createModuleState,
  createState,
  normalizeState,
  readStateFile,
  sanitizeState,
  writeStateFile,
} from "./state.mjs";

const ISTS_NOT_INSTALLED =
  "apps/ists is missing. Run: git submodule update --init --recursive";
const ISTS_DEPS_MISSING =
  "ISTS dependencies are not installed. Run: cd apps/ists && corepack pnpm install";
const ISTS_NOT_BUILT =
  "ISTS is not built. Run: cd apps/ists && corepack pnpm build";
const BANDREADY_INSTALL_HINT =
  "BandReady browser edition not found on PATH. Install it (install.ps1) or set BANDREADY_CMD to the executable.";

const noopLogger = { info() {}, warn() {}, error() {} };

export class HubManager {
  constructor({
    config,
    logger = noopLogger,
    spawn = spawnManaged,
    probe = probeModule,
    readLaunchFile = readBandReadyLaunchFile,
    now = () => new Date(),
  }) {
    this.config = config;
    this.paths = config.paths;
    this.logger = logger;
    this.spawn = spawn;
    this.probe = probe;
    this.readLaunchFile = readLaunchFile;
    this.now = now;

    this.state = createState({
      hubPort: config.hub.port,
      hubVersion: config.version,
      hubPid: process.pid,
      now: this.now(),
    });
    this.state.hub.pid = process.pid;

    /** @type {Map<string, {child: import('node:child_process').ChildProcess, sink: any}>} */
    this.children = new Map();
    /** @type {Map<string, Promise<any>>} */
    this.starts = new Map();
    /** @type {Map<string, Promise<any>>} */
    this.stops = new Map();
    /** @type {Map<string, {controller: AbortController}>} */
    this.startCtx = new Map();
    this.stopping = new Set();
    this.monitorTimer = null;
    this.monitorStrikes = new Map();
    this.closed = false;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Load prior state (adopt still-alive tracked PIDs) and prepare log dirs. */
  async init({ recover = true } = {}) {
    ensureDir(this.paths.logsDir);
    const read = readStateFile(this.paths.stateFile);
    if (read.error) this.logger.warn(read.error);
    const raw = read.state;
    this.state.hub.pid = process.pid;
    this.state.hub.processStartMs = await captureProcessStartMs(process.pid);
    if (recover && raw) {
      const previous = normalizeState(raw, { hubPort: this.config.hub.port, hubVersion: this.config.version });
      for (const id of MODULE_IDS) {
        const record = previous.modules[id];
        if (!record || !Number.isInteger(record.pid)) continue;
        const identity = await verifyProcessRecord(record);
        if (!identity.ok) {
          this.logger.warn(`Not adopting ${id}: ${identity.reason}`);
          continue;
        }
        this.state.modules[id] = {
          ...createModuleState(),
          ...record,
          status: "starting",
          url: null,
          error: null,
        };
        const probe = await this.probe(record.port, this.config.modules[id].readyPath);
        if (probe.ok) {
          this.state.modules[id].status = "running";
          this.state.modules[id].url = this._publicUrl(id, record.port);
        } else {
          this.state.modules[id].status = "error";
          this.state.modules[id].error =
            `Recovered process ${record.pid} from a previous Hub session but it is not answering; run node scripts/stop.mjs.`;
        }
        this.logger.info(`Adopted ${id} (pid ${record.pid}) as ${this.state.modules[id].status}`);
      }
    }
    this._persist();
    return this.state;
  }

  startMonitor() {
    if (this.monitorTimer) return;
    const interval = this.config.monitor.intervalMs;
    this.monitorTimer = setInterval(() => {
      this.checkHealth().catch((error) => this.logger.warn(`health check failed: ${error.message}`));
    }, interval);
    this.monitorTimer.unref?.();
  }

  /** Re-probe running modules; two consecutive failures make the status `error`. */
  async checkHealth() {
    if (this.closed) return;
    for (const id of MODULE_IDS) {
      const record = this.state.modules[id];
      if (!record || record.status !== "running" || record.external) continue;
      if (!Number.isInteger(record.pid) || !isAlive(record.pid)) {
        this._update(id, { status: "stopped", port: null, url: null, pid: null, processStartMs: null, error: null });
        continue;
      }
      const probe = await this.probe(record.port, this.config.modules[id].readyPath);
      if (probe.ok) {
        this.monitorStrikes.delete(id);
        continue;
      }
      const strikes = (this.monitorStrikes.get(id) ?? 0) + 1;
      this.monitorStrikes.set(id, strikes);
      if (strikes >= 2) {
        this._update(id, {
          status: "error",
          error: `Process ${record.pid} is alive but ${this.config.modules[id].readyPath} did not return 200.`,
        });
      }
    }
  }

  /** Portal-facing state (no PIDs, no secrets). */
  getState() {
    const modules = {};
    for (const id of MODULE_IDS) {
      const record = this.state.modules[id] ?? createModuleState();
      modules[id] = {
        status: record.status,
        port: record.port,
        url: record.url,
        startedAt: record.startedAt,
        error: record.error,
        external: record.external === true,
      };
    }
    return sanitizeState({
      hub: {
        version: this.state.hub.version,
        port: this.config.hub.port,
      },
      modules,
      updatedAt: this.state.updatedAt,
    });
  }

  // ------------------------------------------------------------------- starting

  /** Synchronous gate used by the HTTP API to answer 409 before accepting work. */
  canStart(id) {
    if (!MODULE_IDS.includes(id)) return { ok: false, error: `unknown module: ${id}` };
    const moduleConfig = this.config.modules[id];
    if (!moduleConfig.enabled) return { ok: false, error: `${id} is disabled in hub.config.json` };
    const record = this.state.modules[id];
    if (record.status === "starting") return { ok: false, error: `${id} is already starting` };
    if (record.status === "running") {
      return { ok: false, error: `${id} is already running${record.external ? " (outside the Hub)" : ""}` };
    }
    return { ok: true, error: null };
  }

  /** Fire-and-forget-safe start. Concurrent calls share one attempt. */
  startModule(id) {
    if (!MODULE_IDS.includes(id)) return Promise.resolve({ ok: false, error: `unknown module: ${id}` });
    if (this.starts.has(id)) return this.starts.get(id);
    const promise = this._start(id)
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`${id} failed to start: ${message}`);
        // Never leave a half-started child behind after an unexpected failure.
        if (this.children.has(id)) await this._stopChild(id).catch(() => undefined);
        this._update(id, { status: "error", pid: null, processStartMs: null, error: message });
        return { ok: false, error: message };
      })
      .finally(() => {
        this.starts.delete(id);
        this.startCtx.delete(id);
      });
    this.starts.set(id, promise);
    return promise;
  }

  async _start(id) {
    if (!this.config.modules[id].enabled) {
      this._update(id, { status: "stopped", error: `${id} is disabled in hub.config.json` });
      return { ok: false, error: `${id} is disabled` };
    }
    const record = this.state.modules[id];
    if (record.status === "running" || record.status === "starting") {
      return { ok: true, status: record.status };
    }
    return id === "ists" ? this._startIsts() : this._startBandReady();
  }

  async _startIsts() {
    const id = "ists";
    const moduleConfig = this.config.modules[id];

    if (!isFile(this.paths.istsPackageJson)) {
      this._update(id, { status: "not-installed", error: ISTS_NOT_INSTALLED });
      return { ok: false, status: "not-installed", error: ISTS_NOT_INSTALLED };
    }
    if (!isDirectory(this.paths.istsNodeModules)) {
      this._update(id, { status: "not-ready", error: ISTS_DEPS_MISSING });
      return { ok: false, status: "not-ready", error: ISTS_DEPS_MISSING };
    }
    if (!isFile(this.paths.istsBuildFile)) {
      this._update(id, { status: "not-ready", error: ISTS_NOT_BUILT });
      return { ok: false, status: "not-ready", error: ISTS_NOT_BUILT };
    }

    const portCheck = await checkPortAvailable(moduleConfig.port);
    if (!portCheck.available) {
      const error = portBusyHint(moduleConfig.port, { envVar: "ISTS_PORT" });
      this._update(id, { status: "error", port: null, url: null, error });
      return { ok: false, status: "error", error };
    }

    const pnpm = resolvePnpmPlan();
    if (!pnpm) {
      const error = "corepack was not found next to Node.js; Node.js >= 20.9 (which bundles corepack) is required.";
      this._update(id, { status: "error", error });
      return { ok: false, status: "error", error };
    }

    ensureDir(this.paths.istsDataDir);
    ensureDir(this.paths.istsUploadDir);

    const args = [...pnpm.args, ...moduleConfig.args.map((arg) => arg.replaceAll("{port}", String(moduleConfig.port)))];
    const env = {
      ...process.env,
      DATABASE_URL: `file:${this.paths.istsDbFile}`,
      UPLOAD_DIR: this.paths.istsUploadDir,
      NEXT_TELEMETRY_DISABLED: "1",
    };
    const sink = createLogSink({ logsDir: this.paths.logsDir, id, name: "ISTS" });
    sink.writeLine(`# start: ${pnpm.display}; cwd=${this.paths.istsAppDir}; port=${moduleConfig.port}`);
    sink.writeLine(`# DATABASE_URL=file:${this.paths.istsDbFile}`);

    this._update(id, {
      status: "starting",
      port: moduleConfig.port,
      url: null,
      startedAt: this.now().toISOString(),
      pid: null,
      processStartMs: null,
      external: false,
      error: null,
    });

    const controller = new AbortController();
    this.startCtx.set(id, { controller });

    let child;
    try {
      child = this.spawn({ command: pnpm.command, args, cwd: this.paths.istsAppDir, env });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sink.writeLine(`# spawn failed: ${message}`);
      this._update(id, { status: "error", error: `Could not start ISTS: ${message}` });
      return { ok: false, error: message };
    }
    this.children.set(id, { child, sink });
    attachChildLogging(child, sink);

    const processStartMs = await captureProcessStartMs(child.pid);
    this._update(id, { pid: child.pid ?? null, processStartMs });
    this.logger.info(`ISTS starting (pid ${child.pid}, port ${moduleConfig.port})`);

    this._watchExit(id, child, sink);

    const readiness = await Promise.race([
      waitFor(() => this.probe(moduleConfig.port, moduleConfig.readyPath), {
        timeoutMs: moduleConfig.readyTimeoutMs,
        intervalMs: 700,
        signal: controller.signal,
      }).then((result) => ({ type: "probe", result })),
      this._exitSignal(child).then((exit) => ({ type: "exit", exit })),
    ]);

    if (controller.signal.aborted || this.stopping.has(id)) {
      await this._stopChild(id);
      this._update(id, { status: "stopped", port: null, url: null, pid: null, processStartMs: null, error: null });
      return { ok: false, status: "stopped", error: "stopped while starting" };
    }

    if (readiness.type === "exit") {
      const message = `ISTS exited before it became ready (code ${readiness.exit.code ?? "null"})`;
      this._logTail(sink, id, message);
      this._update(id, { status: "error", port: null, url: null, pid: null, processStartMs: null, error: message });
      return { ok: false, status: "error", error: message };
    }
    if (!readiness.result.ok) {
      const message = `ISTS did not answer GET ${moduleConfig.readyPath} within ${moduleConfig.readyTimeoutMs / 1000}s; see logs/ists.log`;
      this._logTail(sink, id, message);
      await this._stopChild(id);
      this._update(id, {
        status: "error",
        port: null,
        url: null,
        pid: null,
        processStartMs: null,
        error: message,
      });
      return { ok: false, status: "error", error: message };
    }

    this._update(id, { status: "running", url: moduleOrigin(moduleConfig.port), error: null });
    sink.writeLine(`# ready: GET ${moduleOrigin(moduleConfig.port)}${moduleConfig.readyPath} -> 200`);
    this.logger.info(`ISTS running at ${moduleOrigin(moduleConfig.port)}`);
    return { ok: true, status: "running", port: moduleConfig.port, url: moduleOrigin(moduleConfig.port) };
  }

  async _startBandReady() {
    const id = "bandready";
    const moduleConfig = this.config.modules[id];

    // Already running (started by the installer/shortcut)? Adopt it read-only.
    const existing = await this.readLaunchFile(moduleConfig.webJson);
    if (existing.ok) {
      const health = await this.probe(existing.port, moduleConfig.readyPath);
      if (health.ok) {
        const record = {
          status: "running",
          port: existing.port,
          url: this._publicUrl(id, existing.port),
          startedAt: this.now().toISOString(),
          pid: null,
          processStartMs: null,
          external: true,
          error: null,
        };
        this._update(id, record);
        this.logger.info(`BandReady already running outside the Hub on port ${existing.port} (adopted, will not be stopped)`);
        return { ok: true, status: "running", port: existing.port, external: true };
      }
    }

    const executable = resolveExecutable(moduleConfig.command);
    if (!executable) {
      this._update(id, { status: "not-installed", error: BANDREADY_INSTALL_HINT });
      return { ok: false, status: "not-installed", error: BANDREADY_INSTALL_HINT };
    }

    const previous = existing.ok ? existing : null;
    const args = moduleConfig.args.map((arg) => arg.replaceAll("{port}", String(moduleConfig.port)));
    const env = {
      ...process.env,
      BANDREADY_DATA_DIR: moduleConfig.dataDir,
    };
    ensureDir(moduleConfig.dataDir);
    const sink = createLogSink({ logsDir: this.paths.logsDir, id, name: "BandReady" });
    sink.writeLine(`# start: ${executable} ${args.join(" ")} (preferred port ${moduleConfig.port})`);

    this._update(id, {
      status: "starting",
      port: null,
      url: null,
      startedAt: this.now().toISOString(),
      pid: null,
      processStartMs: null,
      external: false,
      error: null,
    });

    const controller = new AbortController();
    this.startCtx.set(id, { controller });

    let child;
    try {
      child = this.spawn({ command: executable, args, cwd: moduleConfig.dataDir, env });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sink.writeLine(`# spawn failed: ${message}`);
      this._update(id, { status: "error", error: `Could not start BandReady: ${message}` });
      return { ok: false, error: message };
    }
    this.children.set(id, { child, sink });
    attachChildLogging(child, sink);

    const processStartMs = await captureProcessStartMs(child.pid);
    this._update(id, { pid: child.pid ?? null, processStartMs });
    this.logger.info(`BandReady starting (pid ${child.pid}); waiting for ${moduleConfig.webJson}`);

    this._watchExit(id, child, sink);

    const readiness = await Promise.race([
      waitFor(
        async () => {
          const launch = await this.readLaunchFile(moduleConfig.webJson);
          if (!launch.ok) return { ok: false, error: launch.error };
          if (previous && launch.launch === previous.launch) {
            return { ok: false, error: "waiting for BandReady to write a fresh launch secret" };
          }
          const health = await this.probe(launch.port, moduleConfig.readyPath);
          if (!health.ok) return { ok: false, error: `GET /health returned ${health.statusCode ?? health.error}` };
          return { ok: true, port: launch.port, launch: launch.launch };
        },
        { timeoutMs: moduleConfig.readyTimeoutMs, intervalMs: 1_000, signal: controller.signal },
      ).then((result) => ({ type: "probe", result })),
      this._exitSignal(child).then((exit) => ({ type: "exit", exit })),
    ]);

    if (controller.signal.aborted || this.stopping.has(id)) {
      await this._stopChild(id);
      this._update(id, { status: "stopped", port: null, url: null, pid: null, processStartMs: null, error: null });
      return { ok: false, status: "stopped", error: "stopped while starting" };
    }

    if (readiness.type === "exit") {
      const message = `BandReady exited before it became ready (code ${readiness.exit.code ?? "null"})`;
      this._logTail(sink, id, message);
      this._update(id, { status: "error", port: null, url: null, pid: null, processStartMs: null, error: message });
      return { ok: false, status: "error", error: message };
    }
    if (!readiness.result.ok) {
      const message = `BandReady did not answer GET /health within ${moduleConfig.readyTimeoutMs / 1000}s; see logs/bandready.log`;
      this._logTail(sink, id, message);
      await this._stopChild(id);
      this._update(id, { status: "error", port: null, url: null, pid: null, processStartMs: null, error: message });
      return { ok: false, status: "error", error: message };
    }

    const launchState = readiness.result.last;
    if (!launchState || typeof launchState.launch !== "string" || !Number.isInteger(launchState.port)) {
      const message = "BandReady reported ready without a usable launch record; see logs/bandready.log";
      this._logTail(sink, id, message);
      await this._stopChild(id);
      this._update(id, { status: "error", port: null, url: null, pid: null, processStartMs: null, error: message });
      return { ok: false, status: "error", error: message };
    }
    const { port, launch } = launchState;
    sink.addSecret(launch); // future log lines redacted, even if the app prints its URL
    sink.writeLine(`# ${describeLaunchFile({ ok: true, port, launch })}`); // port + "token present", never the token
    this._update(id, {
      status: "running",
      port,
      url: this._publicUrl(id, port),
      error: null,
    });
    this.logger.info(`BandReady running on port ${port}`);
    return { ok: true, status: "running", port, url: this._publicUrl(id, port) };
  }

  // -------------------------------------------------------------------- stopping

  async stopModule(id) {
    if (!MODULE_IDS.includes(id)) return { ok: false, error: `unknown module: ${id}` };
    if (this.stops.has(id)) return this.stops.get(id);
    const promise = this._stopModule(id).finally(() => this.stops.delete(id));
    this.stops.set(id, promise);
    return promise;
  }

  async _stopModule(id) {
    const record = this.state.modules[id];

    if (record.external && record.status === "running") {
      const error = `${id} was started outside the Hub; close it from its own window.`;
      this._update(id, { error });
      return { ok: false, status: record.status, error };
    }

    const ctx = this.startCtx.get(id);
    if (ctx) ctx.controller.abort();
    if (this.starts.has(id)) {
      try {
        await this.starts.get(id);
      } catch {
        /* start already reported its error */
      }
    }

    const current = this.state.modules[id];
    if (!Number.isInteger(current.pid)) {
      this._update(id, { status: "stopped", port: null, url: null, pid: null, processStartMs: null, error: null });
      return { ok: true, status: "stopped" };
    }

    this.stopping.add(id);
    this.logger.info(`Stopping ${id} (pid ${current.pid})...`);
    try {
      const result = await stopProcessTree(
        { pid: current.pid, processStartMs: current.processStartMs },
        { graceMs: this.config.shutdown.graceMs },
      );
      if (result.refused) {
        this.logger.warn(`Refused to stop ${id}: ${result.reason}. Clearing stale tracking record.`);
      } else if (!result.stopped) {
        this.logger.error(`Could not stop ${id}: ${result.reason}`);
        this._update(id, { status: "error", error: result.reason });
        return { ok: false, status: "error", error: result.reason };
      }
      this._update(id, {
        status: "stopped",
        port: null,
        url: null,
        startedAt: null,
        pid: null,
        processStartMs: null,
        external: false,
        error: null,
      });
      this.logger.info(`${id} stopped`);
      return { ok: true, status: "stopped" };
    } finally {
      this.stopping.delete(id);
      this.monitorStrikes.delete(id);
      const entry = this.children.get(id);
      if (entry) {
        entry.sink.writeLine(`# stopped at ${this.now().toISOString()}`);
        entry.sink.close();
        this.children.delete(id);
      }
    }
  }

  async stopAll({ clear = true } = {}) {
    const results = {};
    await Promise.all(
      MODULE_IDS.filter((id) => Number.isInteger(this.state.modules[id].pid)).map(async (id) => {
        results[id] = await this.stopModule(id).catch((error) => ({ ok: false, error: error.message }));
      }),
    );
    this.closed = true;
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = null;
    this.state.hub.stoppedAt = this.now().toISOString();
    const anyFailure = Object.values(results).some((result) => result && result.ok === false);
    if (clear && !anyFailure) {
      try {
        clearStateFile(this.paths.stateFile);
      } catch (error) {
        this.logger.warn(`Could not clear state file: ${error.message}`);
      }
    } else {
      this._persist();
    }
    return results;
  }

  // ---------------------------------------------------------------- integrations

  /** URL the "Open" button should use; BandReady goes through the Hub redirect. */
  _publicUrl(id, port) {
    if (id === "bandready") return `http://127.0.0.1:${this.config.hub.port}/open/bandready`;
    return moduleOrigin(port);
  }

  /** Resolve the real browser URL for /open/:id (BandReady includes its launch secret). */
  async resolveOpenUrl(id) {
    if (!MODULE_IDS.includes(id)) return { ok: false, status: 404, error: `unknown module: ${id}` };
    const record = this.state.modules[id];
    if (!record || record.status !== "running" || !Number.isInteger(record.port)) {
      return { ok: false, status: 409, error: `${id} is not running`, moduleStatus: record?.status ?? "stopped" };
    }
    if (id === "ists") {
      return { ok: true, url: moduleOrigin(record.port), status: 302 };
    }
    const launch = await this.readLaunchFile(this.config.modules.bandready.webJson);
    if (!launch.ok) return { ok: false, status: 503, error: launch.error };
    if (launch.port !== record.port) {
      return {
        ok: false,
        status: 503,
        error: `BandReady changed ports (${record.port} -> ${launch.port}); refresh /api/state`,
      };
    }
    return { ok: true, url: buildBandReadyLaunchUrl(launch.port, launch.launch), status: 302 };
  }

  // ------------------------------------------------------------------- internals

  _update(id, patch) {
    this.state.modules[id] = { ...(this.state.modules[id] ?? createModuleState()), ...patch };
    this._persist();
  }

  _persist() {
    try {
      ensureDir(this.paths.hubDir);
      this.state.updatedAt = this.now().toISOString();
      writeStateFile(this.paths.stateFile, this.state);
    } catch (error) {
      this.logger.warn(`Could not write ${this.paths.stateFile}: ${error.message}`);
    }
  }

  _watchExit(id, child, sink) {
    child.once("exit", (code, signal) => {
      if (this.stopping.has(id)) return;
      if (this.children.get(id)?.child !== child) return;
      const current = this.state.modules[id];
      if (current.pid !== child.pid) return;
      const clean = code === 0;
      const message = clean
        ? null
        : `exited unexpectedly (${signal ? `signal ${signal}` : `code ${code}`}); see logs/${id}.log`;
      sink.writeLine(`# process exited (${signal ? `signal ${signal}` : `code ${code}`})`);
      this._update(id, {
        status: clean ? "stopped" : "error",
        port: null,
        url: null,
        pid: null,
        processStartMs: null,
        startedAt: null,
        error: message,
      });
      this.logger.warn(`${id} ${message ?? "exited"}`);
      sink.close();
      this.children.delete(id);
    });
  }

  _exitSignal(child) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
    }
    return new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
  }

  /** Stop a child we started without identity verification (we hold the handle's PID). */
  async _stopChild(id) {
    const entry = this.children.get(id);
    if (!entry) return;
    this.stopping.add(id);
    try {
      await stopProcessTree(
        { pid: entry.child.pid, processStartMs: this.state.modules[id].processStartMs },
        { graceMs: Math.min(this.config.shutdown.graceMs, 1_500) },
      );
    } catch (error) {
      this.logger.warn(`Could not stop ${id}: ${error.message}`);
    } finally {
      this.stopping.delete(id);
      entry.sink.close();
      this.children.delete(id);
    }
  }

  _logTail(sink, id, message) {
    const tail = tailFile(sink?.file ?? path.join(this.paths.logsDir, `${id}.log`), 600).trim();
    if (tail) {
      this.logger.error(`${message}\n--- last output ---\n${tail}`);
    } else {
      this.logger.error(message);
    }
  }
}
