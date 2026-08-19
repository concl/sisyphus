# Sisyphus Wiki

Sisyphus is an extendable workspace / planning / automation app: an Electron
desktop shell with a React frontend, built around an extension model where
pages register into a sidebar-visible registry. A managed python-host
(FastAPI) service shows how the app can own and expose additional processes.

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

# 5. Build the Windows installer (electron-builder; requires the frontend build)
python scripts/build.py --package
```

## Where to start

- [Getting Started](Getting-Started.md) — prerequisites, setup, running, and the dev loop
- [Architecture](Architecture.md) — repo layout, process model, and monorepo wiring
- [Extensions](Extensions.md) — the extension model: compile-time and runtime-loaded pages
- [IPC Reference](IPC-Reference.md) — every channel and the preload bridge API
- [Managed Services](Managed-Services.md) — the python-host FastAPI service
- [Testing](Testing.md) — unit tests and the end-to-end smoke test
- [Packaging](Packaging.md) — installer build and the two-zone model

The root [`ARCHITECTURE.md`](../ARCHITECTURE.md) is the full design document.
These wiki pages are the navigable, task-oriented version of it.
