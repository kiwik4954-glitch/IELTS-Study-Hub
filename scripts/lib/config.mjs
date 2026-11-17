/**
 * Hub configuration: committed defaults -> scripts/hub.config.json -> environment.
 *
 * Precedence, lowest to highest:
 *   1. DEFAULT_CONFIG (this file; mirrors scripts/hub.config.json)
 *   2. scripts/hub.config.json (or HUB_CONFIG=<path>)
 *   3. Environment: HUB_PORT, ISTS_PORT, ISTS_PATH, BANDREADY_CMD, DATA_ROOT
 *
 * The Hub is loopback-only by contract: a config that asks for any other bind
 * address is rejected instead of silently exposing the apps to the LAN.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { expandPath, isFile, isPlainObject, readJsonFile } from "./fs-utils.mjs";

export const HUB_VERSION = "0.1.0";
export const MODULE_IDS = Object.freeze(["ists", "bandready"]);
export const MODULE_STATUSES = Object.freeze([
  "not-installed",
  "not-ready",
  "starting",
  "running",
  "stopped",
  "error",
]);

export const DEFAULT_CONFIG = Object.freeze({
  hub: {
    host: "127.0.0.1",
    port: 8780,
  },
  dataRoot: "%APPDATA%\\IELTS-Study-Hub",
  portal: {
    dir: "portal",
    dist: "dist",
  },
  modules: {
    ists: {
      enabled: true,
      port: 3000,
      path: "apps/ists",
      // `corepack pnpm exec next start -H 127.0.0.1 -p <port>`; `{port}` is substituted.
      // Do not use `pnpm start -- ...`: pnpm forwards the literal `--` to next, which
      // treats it as a project directory.
      args: ["exec", "next", "start", "-H", "127.0.0.1", "-p", "{port}"],
      buildFile: ".next/BUILD_ID",
      readyPath: "/",
      readyTimeoutMs: 60_000,
    },
    bandready: {
      enabled: true,
      // The installer puts `bandready` on PATH; BANDREADY_CMD overrides it.
      command: "bandready",
      // The Hub opens the app itself (with the launch secret); never open a second tab.
      args: ["--no-browser"],
      // Preferred only: the launcher may fall back to any free port, recorded in web.json.
      port: 8765,
      dataDir: "%APPDATA%\\BandReady",
      webJson: "%APPDATA%\\BandReady\\web.json",
      readyPath: "/health",
      readyTimeoutMs: 180_000,
    },
  },
  shutdown: {
    graceMs: 3_000,
  },
  monitor: {
    intervalMs: 10_000,
  },
});

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return override;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out;
}

function assertPort(value, label) {
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigError(`${label} must be an integer between 1 and 65535 (got ${JSON.stringify(value)})`);
  }
  return port;
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new ConfigError(`${label} must be true or false (got ${JSON.stringify(value)})`);
  }
  return value;
}

function assertPositiveInt(value, label) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new ConfigError(`${label} must be a positive integer (got ${JSON.stringify(value)})`);
  }
  return number;
}

function readConfigFile(configPath, { required = false } = {}) {
  if (!isFile(configPath)) {
    if (required) throw new ConfigError(`Config file not found: ${configPath}`);
    return null;
  }
  let parsed;
  try {
    parsed = readJsonFile(configPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Config file ${configPath} is not valid JSON: ${reason}`);
  }
  if (!isPlainObject(parsed)) {
    throw new ConfigError(`Config file ${configPath} must contain a JSON object`);
  }
  return parsed;
}

function applyEnv(config, env) {
  const override = JSON.parse(JSON.stringify(config));

  if (env.HUB_PORT !== undefined && env.HUB_PORT !== "") {
    override.hub.port = env.HUB_PORT;
  }
  if (env.ISTS_PORT !== undefined && env.ISTS_PORT !== "") {
    override.modules.ists.port = env.ISTS_PORT;
  }
  if (env.ISTS_PATH !== undefined && env.ISTS_PATH !== "") {
    override.modules.ists.path = env.ISTS_PATH;
  }
  if (env.BANDREADY_CMD !== undefined && env.BANDREADY_CMD !== "") {
    override.modules.bandready.command = env.BANDREADY_CMD;
  }
  if (env.DATA_ROOT !== undefined && env.DATA_ROOT !== "") {
    override.dataRoot = env.DATA_ROOT;
  }
  return override;
}

/**
 * Load and validate the Hub configuration.
 *
 * @param {object} [options]
 * @param {string} [options.repoRoot]   Repository root (defaults to two levels above scripts/).
 * @param {string} [options.env]        Environment to read (defaults to process.env).
 * @param {string} [options.configPath] Config file (defaults to <repoRoot>/scripts/hub.config.json).
 * @param {string} [options.home]       Home directory used for ~ and %APPDATA% fallbacks.
 */
export function loadConfig(options = {}) {
  const {
    repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
    env = process.env,
    configPath,
    home,
  } = options;

  const scriptsDir = path.join(repoRoot, "scripts");
  const resolvedConfigPath = configPath ? path.resolve(configPath) : path.join(scriptsDir, "hub.config.json");
  const explicitConfig = Boolean(configPath || env.HUB_CONFIG);
  const filePath = configPath ?? (env.HUB_CONFIG ? path.resolve(env.HUB_CONFIG) : resolvedConfigPath);

  if (filePath && !isFile(filePath) && explicitConfig) {
    throw new ConfigError(`Config file not found: ${filePath}`);
  }
  const fileConfig = readConfigFile(filePath, { required: explicitConfig });
  let merged = deepMerge(DEFAULT_CONFIG, fileConfig ?? {});
  merged = applyEnv(merged, env);

  // ---- validate scalars -----------------------------------------------------
  const hubHost = String(merged.hub.host ?? "127.0.0.1").trim();
  if (!LOOPBACK_HOSTS.has(hubHost)) {
    throw new ConfigError(
      `hub.host must be loopback: 127.0.0.1 (or localhost); refusing to bind ${JSON.stringify(hubHost)}`,
    );
  }
  const hubPort = assertPort(merged.hub.port, "hub.port");
  const istsPort = assertPort(merged.modules.ists.port, "modules.ists.port");
  const bandreadyPort = assertPort(merged.modules.bandready.port, "modules.bandready.port");
  if (hubPort === istsPort) throw new ConfigError("hub.port and modules.ists.port must differ");
  if (hubPort === bandreadyPort) throw new ConfigError("hub.port and modules.bandready.port must differ");
  if (istsPort === bandreadyPort) throw new ConfigError("modules.ists.port and modules.bandready.port must differ");

  const istsEnabled = assertBoolean(merged.modules.ists.enabled, "modules.ists.enabled");
  const bandreadyEnabled = assertBoolean(merged.modules.bandready.enabled, "modules.bandready.enabled");
  const istsTimeout = assertPositiveInt(merged.modules.ists.readyTimeoutMs, "modules.ists.readyTimeoutMs");
  const bandreadyTimeout = assertPositiveInt(
    merged.modules.bandready.readyTimeoutMs,
    "modules.bandready.readyTimeoutMs",
  );
  const graceMs = assertPositiveInt(merged.shutdown.graceMs, "shutdown.graceMs");
  const monitorIntervalMs = assertPositiveInt(merged.monitor.intervalMs, "monitor.intervalMs");

  // ISTS binds 0.0.0.0 unless told otherwise; reject a config that dropped the flag.
  const istsArgs = Array.isArray(merged.modules.ists.args) ? merged.modules.ists.args.map(String) : [];
  if (!istsArgs.includes("-H") || !istsArgs.includes("127.0.0.1")) {
    throw new ConfigError("modules.ists.args must contain -H 127.0.0.1 (next start would bind 0.0.0.0)");
  }
  const bandreadyArgs = Array.isArray(merged.modules.bandready.args)
    ? merged.modules.bandready.args.map(String)
    : [];

  // ---- resolve paths --------------------------------------------------------
  const expand = (value) => expandPath(value, { env, home, baseDir: repoRoot });
  const dataRoot = expand(merged.dataRoot);
  if (!dataRoot) throw new ConfigError("dataRoot must not be empty");

  const portalDir = expand(merged.portal.dir);
  const portalDist = path.join(portalDir, merged.portal.dist ?? "dist");
  const istsAppDir = expand(merged.modules.ists.path);
  const bandreadyDataDir = expand(merged.modules.bandready.dataDir);
  const bandreadyWebJson = expand(merged.modules.bandready.webJson);

  const hubDir = path.join(dataRoot, "hub");
  const logsDir = path.join(hubDir, "logs");
  const istsDataDir = path.join(dataRoot, "ists");

  const paths = {
    scriptsDir,
    configFile: filePath,
    dataRoot,
    hubDir,
    logsDir,
    stateFile: path.join(hubDir, "state.json"),
    istsDataDir,
    istsDbFile: path.join(istsDataDir, "ists.db"),
    istsUploadDir: path.join(istsDataDir, "uploads"),
    portalDir,
    portalDist,
    portalIndex: path.join(portalDist, "index.html"),
    placeholderFile: path.join(scriptsDir, "hub", "placeholder.html"),
    istsAppDir,
    istsPackageJson: path.join(istsAppDir, "package.json"),
    istsNodeModules: path.join(istsAppDir, "node_modules"),
    istsBuildFile: path.join(istsAppDir, merged.modules.ists.buildFile ?? ".next/BUILD_ID"),
    bandreadyDataDir,
    bandreadyWebJson,
  };

  return {
    version: HUB_VERSION,
    repoRoot,
    configFile: filePath,
    configFileExists: isFile(filePath),
    hub: { host: hubHost === "localhost" ? "127.0.0.1" : hubHost, port: hubPort },
    dataRoot,
    portal: { dir: portalDir, dist: portalDist },
    modules: {
      ists: {
        id: "ists",
        enabled: istsEnabled,
        port: istsPort,
        path: istsAppDir,
        args: istsArgs,
        buildFile: merged.modules.ists.buildFile ?? ".next/BUILD_ID",
        readyPath: merged.modules.ists.readyPath ?? "/",
        readyTimeoutMs: istsTimeout,
      },
      bandready: {
        id: "bandready",
        enabled: bandreadyEnabled,
        command: String(merged.modules.bandready.command ?? "bandready"),
        args: bandreadyArgs,
        port: bandreadyPort,
        dataDir: bandreadyDataDir,
        webJson: bandreadyWebJson,
        readyPath: merged.modules.bandready.readyPath ?? "/health",
        readyTimeoutMs: bandreadyTimeout,
      },
    },
    shutdown: { graceMs },
    monitor: { intervalMs: monitorIntervalMs },
    paths,
  };
}

/** Substitute `{port}` (and `{host}`) placeholders inside an argument array. */
export function resolveArgs(args, { port, host = "127.0.0.1" }) {
  return args.map((arg) =>
    String(arg).replaceAll("{port}", String(port)).replaceAll("{host}", host),
  );
}

/** Loopback origin for a module port, used in state/API responses. */
export function moduleOrigin(port) {
  return `http://127.0.0.1:${port}`;
}
