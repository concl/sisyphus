# Getting Started

## Prerequisites

- **Node.js + npm** — the repo is an npm workspaces monorepo; all dependencies
  install once at the root.
- **Python 3** — drives the `scripts/*.py` entry points and runs the
  python-host service inside its own venv.
- **Windows** — the scripts use `npm.cmd` automatically, so everything works
  from Git Bash or cmd.

## Setup

```sh
python scripts/setup.py
```

This installs the npm workspaces at the repo root and creates the python-host
venv at `services/python-host/.venv` with the pinned `requirements.txt`.

## Run the app

```sh
python scripts/build_and_run_desktop.py
```

This builds the shared package and the frontend, then launches the Electron
app. See [Packaging](Packaging.md) for how the built files are resolved.

## Dev loop (hot reload)

```sh
npm --prefix apps/frontend run dev
```

Then launch `apps/desktop` with `VITE_DEV_SERVER_URL` set so the window loads
the Vite dev server instead of the built `dist/`.

## Build & package

```sh
python scripts/build.py            # build @sisyphus/shared + the frontend
python scripts/build.py --package  # also build the Windows installer (electron-builder)
```

## Test

```sh
python scripts/test.py             # all unit tests
```

See [Testing](Testing.md) for per-component commands and the end-to-end smoke
test.

## Script reference

| Script | What it does |
| --- | --- |
| `scripts/setup.py` | Installs npm workspaces at the root + python-host venv |
| `scripts/test.py` | Runs all unit tests (vitest, node:test, pytest) |
| `scripts/build.py` | Builds `@sisyphus/shared` and the frontend; `--package` also runs electron-builder |
| `scripts/package.py` | Drives electron-builder to produce the installer |
| `scripts/build_and_run_desktop.py` | Build + launch the desktop app (dev flow) |
