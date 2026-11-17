# Portal

React + TypeScript + Vite single-page app for IELTS Study Hub.

## Ownership

Only this directory. Do not edit `apps/` or `scripts/`.

## Contract with the Hub API

The portal talks to the Hub process (`http://127.0.0.1:8780` by default) and nothing
else.

- `GET /api/state` →
  ```json
  {
    "hub": { "version": "0.1.0", "port": 8780 },
    "modules": {
      "ists": { "status": "running", "port": 3000, "url": "http://127.0.0.1:3000",
                "startedAt": "...", "error": null },
      "bandready": { "status": "not-installed", "port": null, "url": null,
                     "startedAt": null, "error": "..." }
    }
  }
  ```
- `POST /api/modules/:id/start` → `202 { "status": "starting" }`
- `POST /api/modules/:id/stop` → `202 { "status": "stopping" }`

Statuses: `not-installed | not-ready | starting | running | stopped | error`.

## Rules

- Never hard-code app ports; always read them from `/api/state`.
- Never call the apps' private APIs or databases.
- Never display or request API keys.
- "Open" uses a normal link (`target="_blank" rel="noopener"`) — no iframes.
- Responsive: desktop, tablet and phone layouts.

## Design

- Primary: deep green. Background: warm off-white. Accent: soft orange.
- Card-based layout, clear typographic hierarchy, restrained motion.
- Must not look like a copy of the ISTS or BandReady home pages.

## Commands

```bash
corepack pnpm install
corepack pnpm dev -- --port 5175
corepack pnpm build
```
