# Testing

## Unit tests

`python scripts/test.py` runs everything:

| Component | Framework | Command | Coverage |
| --- | --- | --- | --- |
| Frontend | vitest | `npm run test` in `apps/frontend` | Registry contract tests |
| Desktop logic | node:test | `npm test` in `apps/desktop` | `lib/backends.js` (shell detection), `lib/service-supervisor.js` (spawn/health/stop with injected fake spawn+fetch), `lib/processes.js`, `lib/extension-store.js`, `lib/app-storage.js` |
| Python-host | pytest | `pytest` in `services/python-host` (inside its venv) | FastAPI endpoints |

Frontend static checks: `npm run build` (`tsc -b && vite build`) and
`npm run lint` (eslint) in `apps/frontend`.

## End-to-end smoke test

The smoke test boots the real app and drives it:

```sh
# requires the frontend to be built first
npm run smoke   # in apps/desktop   (i.e. electron . --smoke)
```

It launches Electron, drives the UI via
`webContents.executeJavaScript`, spawns a real shell, opens the Processes and
Python API pages, calls the FastAPI service through IPC, and prints
`SMOKE_RESULT` (in `apps/desktop/smoke/smoke-script.js`).

### Smoke-testing the packaged app

```sh
dist/win-unpacked/Sisyphus.exe --smoke
```

The result is also mirrored to `userData/smoke-result.json` in case stdout is
unavailable in the packaged context.

## Dev loop

```sh
npm --prefix apps/frontend run dev
```

Then launch `apps/desktop` with `VITE_DEV_SERVER_URL` set so the window loads
the Vite dev server instead of the built `dist/` — changes hot-reload without
rebuilding.
