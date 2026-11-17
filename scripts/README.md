# Scripts

Node.js environment checks, process management and developer commands for the Hub.

## Ownership

Only this directory. Do not edit `apps/`, `portal/` or root docs.

## Planned commands

| File | Contract |
|---|---|
| `check-env.mjs` | Prints PASS/FAIL for Node, corepack/pnpm, Python, uv, git, submodules, app deps and ports. Exit 1 on failure. |
| `setup.mjs` | Installs portal/app dependencies and builds the portal. Never changes global tool versions. |
| `dev.mjs` | Starts the Hub (portal + API) plus both apps, streamed logs, graceful shutdown on Ctrl+C. |
| `stop.mjs` | Stops only processes recorded in the Hub state file. |
| `hub/` | Internal modules: config, ports, state store, spawn/kill, probes, static server. |

## Hard requirements

- `spawn` with argument arrays; no shell string concatenation.
- Track PID + start time; stop with graceful kill, then `taskkill /PID <pid> /T /F`
  after a timeout. Never kill by port or image name.
- Bind every server to `127.0.0.1`.
- ISTS must be started with `-H 127.0.0.1 -p <port>`.
- Read BandReady's real port from `%APPDATA%\BandReady\web.json`; do not assume 8765.
- Windows paths with spaces or non-ASCII characters must work.
- Logs go to `%APPDATA%\IELTS-Study-Hub\hub\logs\`; never log secrets or `web.json`.

## Status model

`running` requires process liveness **and** a successful HTTP probe:

- ISTS: `GET /` → 200
- BandReady: `GET /health` → 200

See `docs/ARCHITECTURE.md` for the full contract.
