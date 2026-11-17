# Contributing

Thanks for helping. This repository intentionally keeps two upstream projects as
submodules; please read this page before opening a pull request.

## Ground rules

1. **Do not modify `apps/ists` or `apps/bandready`.** They are upstream projects.
   Configure them through environment variables, command-line flags or Hub scripts.
   If an upstream change is truly unavoidable, open an issue first and explain why a
   wrapper cannot solve it.
2. **One area per pull request.** The file ownership below exists to keep parallel
   work from colliding.
3. **Never commit user data.** No `.env*`, SQLite files, uploads, recordings, model
   weights, PDFs, logs or API keys.
4. **Never claim a test passed unless you ran it.** Include the command and its output
   summary in the PR.

## File ownership

| Area | Paths | Owner |
|---|---|---|
| Portal UI | `portal/` | frontend |
| Process manager, env checks, setup | `scripts/` | engineering |
| Documentation | `docs/`, root `*.md` | docs |
| Submodules, root config, CI | `apps/`, `.gitmodules`, `.github/` | integrator |

If your change needs two areas, split it into two PRs or coordinate in an issue first.

## Development setup

```bash
git clone --recurse-submodules <url>
cd IELTS-Study-Hub
node scripts/check-env.mjs   # once available
node scripts/setup.mjs
node scripts/dev.mjs
```

Upstream details live in `apps/ists/README.md` and `apps/bandready/README.md`.

## Commit style

- `feat(portal): ...`, `fix(scripts): ...`, `docs: ...`, `chore: ...`
- Keep commits small and explain the "why" in the body when behaviour changes.

## Reporting bugs

Include OS version, Node/pnpm/Python versions, the command you ran, the Hub log
(`%APPDATA%\IELTS-Study-Hub\hub\logs` on Windows) and whether the issue reproduces
with the upstream app started manually.
