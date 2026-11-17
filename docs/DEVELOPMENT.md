# Development

## Layout

```
portal/   React + TypeScript + Vite (Hub UI)
scripts/  Node process manager and CLIs
apps/     upstream submodules (do not edit)
docs/     architecture, install, privacy, troubleshooting
```

## Running the pieces

Portal (dev):

```bash
cd portal
corepack pnpm install
corepack pnpm dev -- --port 5175
```

Hub (once implemented):

```bash
node scripts/dev.mjs        # hub + both apps
node scripts/stop.mjs       # stop everything the hub started
```

ISTS (manual):

```bash
cd apps/ists
corepack pnpm dev           # Next dev server
```

BandReady (manual, browser mode from source):

```bash
cd apps/bandready
corepack pnpm install
cd sidecar && uv sync --extra dev --extra voice && cd ..
node scripts/dev.mjs --browser --no-mock --port 5273 --sidecar-port 8710
```

**`--no-mock` matters**: BandReady's dev script enables mock providers by default.

## Rules for contributors

- Do not edit `apps/ists` or `apps/bandready`.
- One area per PR (`portal/`, `scripts/`, `docs/`).
- Never commit data, keys or logs.
- Report the commands you actually ran with test results.

## Testing

- Portal: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build`.
- Scripts: `node --test scripts/*.test.mjs`.
- Submodules: `git submodule status` must match the pinned commits in
  `THIRD_PARTY_NOTICES.md`.

## Release checklist

1. `scripts/check-env.mjs` passes on a clean Windows machine.
2. `scripts/setup.mjs` + `scripts/dev.mjs` bring both apps up and the portal shows
   `running`.
3. Stopping the Hub leaves no orphan processes.
4. ISTS verifiably listens on `127.0.0.1` only.
5. A real microphone round-trip works in BandReady's browser edition (manual).
6. `git status` contains no secrets, databases, uploads, models or logs.
