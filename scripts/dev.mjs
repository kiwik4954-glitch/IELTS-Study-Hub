#!/usr/bin/env node
/**
 * Start the Hub: API + portal (or placeholder), then ISTS and BandReady.
 *
 *   node scripts/dev.mjs [--no-ists] [--no-bandready] [--skip-portal] [--port <n>]
 *
 * - Hub binds 127.0.0.1 only.
 * - Each app is spawned with an argument array, logs stream to
 *   %APPDATA%\IELTS-Study-Hub\hub\logs\<id>.log, and PID + start time are written
 *   to %APPDATA%\IELTS-Study-Hub\hub\state.json.
 * - Ctrl+C stops only the processes this run tracks, then clears the state file.
 */

import process from "node:process";

import { loadConfig } from "./lib/config.mjs";
import { isFile } from "./lib/fs-utils.mjs";
import { HubManager } from "./lib/manager.mjs";
import { startHubServer } from "./hub/server.mjs";

const argv = process.argv.slice(2);
const flags = {
  noIsts: argv.includes("--no-ists"),
  noBandready: argv.includes("--no-bandready"),
  help: argv.includes("--help") || argv.includes("-h"),
};
const portIndex = argv.indexOf("--port");
if (portIndex !== -1 && argv[portIndex + 1]) {
  process.env.HUB_PORT = argv[portIndex + 1];
}
const unknown = argv.filter(
  (arg, index) =>
    !["--no-ists", "--no-bandready", "--help", "-h", "--port"].includes(arg) &&
    !(index > 0 && argv[index - 1] === "--port"),
);
if (flags.help) {
  process.stdout.write(
    [
      "Usage: node scripts/dev.mjs [options]",
      "",
      "  --no-ists        do not auto-start ISTS",
      "  --no-bandready   do not auto-start BandReady",
      "  --port <n>       Hub port (same as HUB_PORT)",
      "",
      "Ctrl+C stops the tracked apps and the Hub. State: %APPDATA%\\IELTS-Study-Hub\\hub\\state.json",
      "",
    ].join("\n"),
  );
  process.exit(0);
}
if (unknown.length) {
  process.stderr.write(`Unknown option(s): ${unknown.join(" ")}\nRun node scripts/dev.mjs --help\n`);
  process.exit(2);
}

const logger = {
  info: (message) => process.stdout.write(`[hub] ${message}\n`),
  warn: (message) => process.stdout.write(`[hub] ! ${message}\n`),
  error: (message) => process.stderr.write(`[hub] ERROR ${message}\n`),
};

let manager = null;
let server = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    logger.warn("Second interruption — exiting immediately without waiting for apps.");
    process.exit(130);
    return;
  }
  shuttingDown = true;
  logger.info(`Received ${signal}; stopping tracked processes...`);
  try {
    if (manager) await manager.stopAll({ clear: true });
  } catch (error) {
    logger.error(`Shutdown error: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (server) {
    await new Promise((resolve) => server.close(() => resolve()));
  }
  logger.info("Stopped. State cleared.");
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    process.stderr.write(`Configuration error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
    return;
  }

  manager = new HubManager({ config, logger });
  await manager.init();

  try {
    server = await startHubServer({ manager, config, logger });
  } catch (error) {
    process.stderr.write(`Could not start the Hub: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
    return;
  }

  const portalReady = isFile(config.paths.portalIndex);
  process.stdout.write(
    [
      "",
      `IELTS Study Hub ${config.version}`,
      `  URL:    http://127.0.0.1:${config.hub.port}`,
      `  Portal: ${portalReady ? config.paths.portalDist : "not built — serving the placeholder page"}`,
      `  State:  ${config.paths.stateFile}`,
      `  Logs:   ${config.paths.logsDir}`,
      "  Press Ctrl+C to stop the Hub and the apps it started.",
      "",
    ].join("\n"),
  );

  manager.startMonitor();

  const toStart = [];
  if (!flags.noIsts && config.modules.ists.enabled) toStart.push("ists");
  if (!flags.noBandready && config.modules.bandready.enabled) toStart.push("bandready");
  if (flags.noIsts) logger.info("ISTS auto-start disabled (--no-ists)");
  if (flags.noBandready) logger.info("BandReady auto-start disabled (--no-bandready)");

  if (toStart.length) {
    logger.info(`Starting ${toStart.join(" and ")}...`);
    await Promise.all(
      toStart.map((id) =>
        manager.startModule(id).catch((error) => {
          logger.error(`${id}: ${error instanceof Error ? error.message : String(error)}`);
        }),
      ),
    );
  }

  const state = manager.getState();
  process.stdout.write("\nModule status\n");
  for (const id of ["ists", "bandready"]) {
    const module = state.modules[id];
    const port = module.port ? ` http://127.0.0.1:${module.port}` : "";
    process.stdout.write(`  ${id.padEnd(10)} ${module.status}${port}${module.error ? ` — ${module.error}` : ""}\n`);
  }
  if (!portalReady) {
    process.stdout.write("\nThe portal is not built yet; open the Hub URL for the placeholder page.\n");
    process.stdout.write("Build it with: node scripts/setup.mjs\n");
  }
  process.stdout.write("\n");
}

main().catch(async (error) => {
  process.stderr.write(`dev.mjs failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  try {
    if (manager) await manager.stopAll({ clear: true });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
