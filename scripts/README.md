# Scripts

Node.js environment checks, process management and developer commands for the Hub.

## Ownership

Only this directory. Do not edit `apps/`, `portal/` or root docs.

## Commands

| File | Contract |
|---|---|
| `check-env.mjs` | Prints PASS/FAIL/WARN for Node, corepack/pnpm, Python, uv, git, submodules, portal deps, ISTS deps/build and ports 8780/3000/8765. Exit 1 on any FAIL. |
| `setup.mjs` | Installs portal dependencies and builds the portal with `corepack pnpm`. Checks ISTS deps/build and prints the commands when missing. Never changes global tool versions. |
| `dev.mjs` | Starts the Hub (portal + API) plus both apps, streams logs, probes readiness, handles Ctrl+C. |
| `stop.mjs` | Stops only processes recorded in the Hub state file, verifying each PID's start time first. |
| `hub/` | HTTP server, API routes, static/SPA serving and the placeholder page. |
| `lib/` | Config, state store, ports, spawn/kill, probes, logs, process manager. |

```bash
node scripts/check-env.mjs            # add --json for machine output
node scripts/setup.mjs                # --skip-portal-build, --force-build, --force-install
node scripts/dev.mjs                  # --no-ists, --no-bandready, --port <n>
node scripts/stop.mjs                 # --dry-run
node --test scripts/*.test.mjs
```

Then open `http://127.0.0.1:8780`.

## Configuration

`scripts/hub.config.json` is the committed example/defaults; `lib/config.mjs` also
carries the same defaults so the Hub works if the file is deleted. Precedence:

1. built-in defaults
2. `scripts/hub.config.json` (or `HUB_CONFIG=<path>`)
3. environment: `HUB_PORT`, `ISTS_PORT`, `ISTS_PATH`, `BANDREADY_CMD`, `DATA_ROOT`

Defaults: Hub `127.0.0.1:8780`, ISTS `3000`, BandReady preferred `8765`, data root
`%APPDATA%\IELTS-Study-Hub`. ISTS data is redirected with `DATABASE_URL=file:...` and
`UPLOAD_DIR` into `%APPDATA%\IELTS-Study-Hub\ists\`.

A non-loopback `hub.host` or ISTS args without `-H 127.0.0.1` are rejected at load time.

## Hub API

| Route | Behaviour |
|---|---|
| `GET /api/state` | `{ hub: {version, port}, modules: { ists, bandready } }` per `portal/README.md` |
| `POST /api/modules/:id/start` | `202 { status: "starting" }`; `409` when already running/disabled/unknown |
| `POST /api/modules/:id/stop` | `202 { status: "stopping" }`; `409` when not running or started outside the Hub |
| `GET /api/health` | Hub liveness |
| `GET /open/:id` | `302` to the app. BandReady's redirect adds its launch secret. |
| `GET /*` | `portal/dist` with SPA fallback; placeholder page until the portal is built |

Security: loopback bind only, `Host` allowlist (DNS-rebinding guard), same-origin check on
POSTs, path-traversal rejection, `no-store` on API/redirects.

### Why BandReady's `url` points at the Hub

BandReady only opens its pages with `/?launch=<secret>` (403 otherwise). The secret must
not be written to `state.json` or logs, so `/api/state` exposes
`http://127.0.0.1:<hub>/open/bandready` as the module `url`; the Hub reads `web.json` at
request time and redirects. The secret never enters state, logs, or the portal.

## State model

`running` requires process liveness **and** a successful HTTP probe:

- ISTS: `GET /` → 200
- BandReady: `GET /health` → 200 (port read from `%APPDATA%\BandReady\web.json`)

`state.json` records PID, process start time and port. `stop`/`stop.mjs` verify the start
time before killing, so a reused PID is never hit. Logs live in
`%APPDATA%\IELTS-Study-Hub\hub\logs\`; launch tokens are redacted before writing.

## Hard requirements honoured

- `spawn` with argument arrays; `shell: false`, `windowsHide: true`, detached children.
- Graceful kill first, then `taskkill /PID <pid> /T /F` after `shutdown.graceMs` (3 s).
- Never kill by port or image name; only tracked PID trees with a verified start time.
- pnpm runs as `node <corepack.js> pnpm …` so `.cmd` shims never need a shell, and paths
  with spaces/CJK work.
- Every server binds `127.0.0.1`.

## Known limitations

- The Hub does not cryptographically prove BandReady's launch secret; it trusts the
  user-private `web.json` and `/health`.
- A BandReady instance started outside the Hub is adopted read-only and will not be
  stopped by the Hub (the API returns 409 with that explanation).
- ISTS must already have `node_modules` and a production build; `setup.mjs` prints the
  commands instead of running upstream installs.
- Windows graceful shutdown is best-effort (`taskkill` without `/F`); console apps are
  usually force-killed after the grace period.
- No auto-restart or process supervision; if an app crashes the Hub reports `error`.
- The port/hub tests bind loopback sockets; no test reaches an external network.
