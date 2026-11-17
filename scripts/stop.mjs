#!/usr/bin/env node
/**
 * Stop the Hub processes recorded in state.json.
 *
 *   node scripts/stop.mjs [--dry-run]
 *
 * Only PIDs present in %APPDATA%\IELTS-Study-Hub\hub\state.json are touched, and each
 * one is verified by start time first (a reused PID is refused, never killed). The
 * graceful signal is followed by `taskkill /PID <pid> /T /F` after 3 seconds.
 * Nothing is ever selected by port or image name.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { loadConfig } from "./lib/config.mjs";
import { expandPath } from "./lib/fs-utils.mjs";
import { stopProcessTree, verifyProcessRecord } from "./lib/proc.mjs";
import { readStateFile } from "./lib/state.mjs";

const argv = new Set(process.argv.slice(2));
if (argv.has("--help") || argv.has("-h")) {
  process.stdout.write(
    [
      "Usage: node scripts/stop.mjs [--dry-run]",
      "",
      "Stops only processes tracked in the Hub state file, verifying each PID's start",
      "time first. Refuses PIDs the Hub did not start. Clears state.json afterwards.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}
const DRY_RUN = argv.has("--dry-run");

function log(message) {
  process.stdout.write(`${message}\n`);
}

function warn(message) {
  process.stdout.write(`! ${message}\n`);
}

function resolvePaths() {
  try {
    const config = loadConfig();
    return { stateFile: config.paths.stateFile, graceMs: config.shutdown.graceMs };
  } catch (error) {
    // Stopping must still work with a broken config: fall back to the documented default.
    warn(`Could not load hub.config.json (${error.message}); using %APPDATA%\\IELTS-Study-Hub.`);
    const dataRoot = expandPath("%APPDATA%\\IELTS-Study-Hub");
    return {
      stateFile: path.join(dataRoot, "hub", "state.json"),
      graceMs: 3_000,
    };
  }
}

async function main() {
  const paths = resolvePaths();
  const graceMs = paths.graceMs ?? 3_000;

  if (!fs.existsSync(paths.stateFile)) {
    log(`No tracked Hub processes (${paths.stateFile} does not exist).`);
    return 0;
  }

  const read = readStateFile(paths.stateFile);
  if (read.error) {
    process.stderr.write(`Cannot read ${paths.stateFile}: ${read.error}\n`);
    process.stderr.write("Refusing to guess which processes to stop. Inspect the file, then delete it manually if nothing is running.\n");
    return 1;
  }
  if (!read.state) {
    log(`No tracked Hub processes (${paths.stateFile} is empty).`);
    return 0;
  }

  const state = read.state;
  const records = [];
  for (const id of ["ists", "bandready"]) {
    const record = state.modules?.[id];
    if (!record) continue;
    if (Number.isInteger(record.pid)) {
      records.push({ id, label: id, pid: record.pid, processStartMs: record.processStartMs });
    } else if (record.status === "running" && record.external) {
      warn(`${id} is running outside the Hub (pid not tracked); close it from its own window.`);
    }
  }
  if (state.hub && Number.isInteger(state.hub.pid)) {
    records.push({ id: "hub", label: "Hub", pid: state.hub.pid, processStartMs: state.hub.processStartMs ?? null });
  }

  if (records.length === 0) {
    log("State file has no tracked PIDs; clearing it.");
    if (!DRY_RUN) fs.rmSync(paths.stateFile, { force: true });
    return 0;
  }

  log(`Tracked processes: ${records.map((record) => `${record.label} (pid ${record.pid})`).join(", ")}`);
  if (DRY_RUN) {
    log("--dry-run: nothing will be stopped.");
    return 0;
  }

  let failures = 0;
  for (const record of records) {
    if (record.id === "hub" && record.pid === process.pid) continue; // never stop ourselves
    const identity = await verifyProcessRecord(record);
    if (!identity.ok) {
      warn(`Skipping ${record.label} (pid ${record.pid}): ${identity.reason}.`);
      continue;
    }
    if (identity.unverified) {
      warn(`${record.label} (pid ${record.pid}): start time unavailable, stopping without identity check.`);
    }
    log(`Stopping ${record.label} (pid ${record.pid})...`);
    const result = await stopProcessTree(record, { graceMs });
    if (result.refused) {
      warn(`Refused to stop ${record.label}: ${result.reason}.`);
      failures += 1;
      continue;
    }
    if (!result.stopped) {
      process.stderr.write(`Could not stop ${record.label} (pid ${record.pid}): ${result.reason}\n`);
      failures += 1;
      continue;
    }
    log(`  ✓ ${record.label} stopped${result.forced ? " (forced)" : ""}`);
  }

  if (failures > 0) {
    process.stderr.write(`\n${failures} process(es) could not be stopped; keeping state file for a retry.\n`);
    return 1;
  }

  fs.rmSync(paths.stateFile, { force: true });
  log(`\nAll tracked processes stopped. Cleared ${paths.stateFile}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`stop.mjs failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
