#!/usr/bin/env node
/**
 * Set up the Hub's dependencies.
 *
 *   node scripts/setup.mjs [--skip-portal-build] [--force-build] [--force-install]
 *
 * - Installs the portal with `corepack pnpm` (never a global pnpm) and builds it.
 * - Only checks ISTS' dependencies/build and prints the commands if they are missing:
 *   upstream installs are intentionally left to the user.
 * - Idempotent: an up-to-date install/build is skipped on the second run.
 * - Never changes global tool versions: no `corepack prepare`, `corepack enable`,
 *   `npm -g`, or `pnpm use`. The per-app `packageManager` pin decides the version.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { loadConfig } from "./lib/config.mjs";
import { isDirectory, isFile } from "./lib/fs-utils.mjs";
import { resolvePnpmPlan, runCommandForeground } from "./lib/proc.mjs";

const argv = new Set(process.argv.slice(2));
if (argv.has("--help") || argv.has("-h")) {
  process.stdout.write(
    [
      "Usage: node scripts/setup.mjs [options]",
      "",
      "  --skip-portal-build   install portal dependencies but do not run the build",
      "  --force-build         rebuild the portal even when dist/ looks current",
      "  --force-install       run pnpm install even when node_modules looks current",
      "",
      "This script never installs global tools or changes pinned pnpm versions.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}
const FLAGS = {
  skipPortalBuild: argv.has("--skip-portal-build"),
  forceBuild: argv.has("--force-build"),
  forceInstall: argv.has("--force-install"),
};

function log(message) {
  process.stdout.write(`${message}\n`);
}

function warn(message) {
  process.stdout.write(`! ${message}\n`);
}

function fail(message) {
  process.stderr.write(`\nFAILED: ${message}\n`);
  process.exitCode = 1;
}

function newestMtimeMs(targets, { ignore = new Set(["node_modules", "dist", ".next"]) } = {}) {
  let newest = 0;
  const visit = (target, depth) => {
    if (depth > 8) return;
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      let entries;
      try {
        entries = fs.readdirSync(target, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (ignore.has(entry.name)) continue;
        visit(path.join(target, entry.name), depth + 1);
      }
      return;
    }
    if (stat.mtimeMs > newest) newest = stat.mtimeMs;
  };
  for (const target of targets) visit(target, 0);
  return newest;
}

function portalNeedsBuild(paths) {
  if (!isFile(paths.portalIndex)) return { needed: true, reason: "portal/dist/index.html is missing" };
  if (FLAGS.forceBuild) return { needed: true, reason: "--force-build" };
  const distMtime = (() => {
    try {
      return fs.statSync(paths.portalIndex).mtimeMs;
    } catch {
      return 0;
    }
  })();
  const sourceMtime = newestMtimeMs([
    path.join(paths.portalDir, "src"),
    path.join(paths.portalDir, "public"),
    path.join(paths.portalDir, "index.html"),
    path.join(paths.portalDir, "package.json"),
    path.join(paths.portalDir, "vite.config.ts"),
    path.join(paths.portalDir, "vite.config.js"),
    path.join(paths.portalDir, "tsconfig.json"),
  ]);
  if (sourceMtime > distMtime) return { needed: true, reason: "portal sources are newer than dist/" };
  return { needed: false, reason: "portal/dist is up to date" };
}

async function runPnpmStep(pnpm, args, { cwd, label }) {
  log(`\n→ ${label}`);
  log(`  corepack pnpm ${args.join(" ")}   (cwd: ${cwd})`);
  const result = await runCommandForeground(pnpm.command, [...pnpm.args, ...args], {
    cwd,
    env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
  });
  if (result.error) {
    fail(`${label}: could not start pnpm — ${result.error}`);
    return false;
  }
  if (result.code !== 0) {
    fail(`${label} (exit code ${result.code})`);
    return false;
  }
  log(`  ✓ ${label} finished`);
  return true;
}

async function main() {
  log("IELTS Study Hub — setup");
  log("Global tool versions are never modified; each app's packageManager pin is used.");

  // ---- Node + corepack -----------------------------------------------------
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 9)) {
    fail(`Node.js ${process.version} is too old; install >= 20.9.`);
    return;
  }
  const pnpm = resolvePnpmPlan();
  if (!pnpm) {
    fail("corepack was not found next to Node.js. Reinstall Node.js >= 20.9 (it bundles corepack).");
    return;
  }
  log(`Using ${pnpm.display}`);

  const config = loadConfig();
  const paths = config.paths;

  // ---- Portal --------------------------------------------------------------
  log("\n[1/2] Portal");
  const portalPackageJson = path.join(paths.portalDir, "package.json");
  if (!isFile(portalPackageJson)) {
    warn("portal/package.json not found — the portal is not scaffolded yet, skipping install and build.");
    warn("The Hub still runs and serves a placeholder page; re-run this script once the portal exists.");
  } else {
    const nodeModules = path.join(paths.portalDir, "node_modules");
    const lockfile = path.join(paths.portalDir, "pnpm-lock.yaml");
    let installNeeded = FLAGS.forceInstall || !isDirectory(nodeModules);
    if (!installNeeded && isFile(lockfile)) {
      try {
        installNeeded = fs.statSync(lockfile).mtimeMs > fs.statSync(nodeModules).mtimeMs;
      } catch {
        installNeeded = true;
      }
    }
    let packageManager = null;
    try {
      packageManager = JSON.parse(fs.readFileSync(portalPackageJson, "utf8")).packageManager ?? null;
    } catch {
      packageManager = null;
    }
    if (!packageManager) {
      warn("portal/package.json has no packageManager pin; corepack will use its default pnpm for this app.");
    }

    if (!installNeeded) {
      log("  ✓ portal dependencies already installed (skipping pnpm install)");
    } else {
      const args = ["install", "--reporter=append-only"];
      if (isFile(lockfile)) args.push("--frozen-lockfile");
      const installed = await runPnpmStep(pnpm, args, {
        cwd: paths.portalDir,
        label: "portal dependency install",
      });
      if (!installed) return;
    }

    if (FLAGS.skipPortalBuild) {
      log("  · portal build skipped (--skip-portal-build)");
    } else {
      const build = portalNeedsBuild(paths);
      if (!build.needed) {
        log(`  ✓ ${build.reason} (skipping pnpm build)`);
      } else {
        log(`  · ${build.reason}`);
        const built = await runPnpmStep(pnpm, ["run", "build"], {
          cwd: paths.portalDir,
          label: "portal build",
        });
        if (!built) return;
        if (!isFile(paths.portalIndex)) {
          fail("portal build finished but portal/dist/index.html is missing; check the portal's build output directory.");
          return;
        }
      }
    }
  }

  // ---- ISTS (guidance only) ------------------------------------------------
  log("\n[2/2] ISTS (apps/ists)");
  if (!isFile(paths.istsPackageJson)) {
    warn("apps/ists is not checked out. Run: git submodule update --init --recursive");
  } else {
    if (!isDirectory(paths.istsNodeModules)) {
      warn("ISTS dependencies are missing. Run:");
      log("    cd apps\\ists");
      log("    corepack pnpm install");
      log("  (better-sqlite3 may need Visual Studio Build Tools on Windows — see docs/TROUBLESHOOTING.md)");
    } else {
      log("  ✓ ISTS dependencies present");
    }
    if (!isFile(paths.istsBuildFile)) {
      warn("ISTS is not built yet. Run:");
      log("    cd apps\\ists");
      log("    corepack pnpm build");
      log("  (the first build fetches next/font from Google Fonts and needs network access)");
    } else {
      log("  ✓ ISTS production build present");
    }
  }

  // ---- BandReady (informational) ------------------------------------------
  log("\nBandReady (browser edition)");
  if (config.modules.bandready.command) {
    log(`  · Launcher configured as: ${config.modules.bandready.command} (checked at startup by the Hub)`);
  }
  log("  · If it is not installed, run the upstream installer: irm https://raw.githubusercontent.com/Luxshan2000/ielts-prep/main/install.ps1 | iex");

  log("\nSetup finished. Next: node scripts/check-env.mjs && node scripts/dev.mjs");
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack : String(error));
});
