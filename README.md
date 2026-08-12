# sisyphus

Extendable app for workspace, planning, and automation — an Electron desktop
shell with a React frontend, built around an extension model where pages
register into a sidebar-visible registry. Extensions ship as workspace
packages under `packages/`; a managed python-host (FastAPI) service shows how
the app can own and expose additional processes.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design: the extension
model, IPC contracts, managed services, packaging, and testing.

## Quickstart

```sh
# 1. Install everything (npm workspaces + python-host venv)
python scripts/setup.py

# 2. Run all unit tests (frontend vitest, desktop node:test, python pytest)
python scripts/test.py

# 3. Build the frontend bundle
python scripts/build.py

# 4. Run the desktop app (builds the UI first)
python scripts/build_and_run_desktop.py
#   or, in dev with hot reload:
npm --prefix apps/frontend run dev   # then launch apps/desktop with VITE_DEV_SERVER_URL set

# 5. Build the Windows installer (electron-builder; requires the frontend build)
python scripts/build.py --package
```

## Verification

- Unit tests: `python scripts/test.py`
- End-to-end smoke (boots Electron, drives the UI, spawns a real shell, calls
  the python-host service through IPC): build the frontend, then
  `npm run smoke` in `apps/desktop`.
