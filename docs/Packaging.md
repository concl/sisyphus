# Packaging

## Tooling

`electron-builder` (NSIS on Windows; DMG/AppImage later), configured in
`apps/desktop/electron-builder.yml` and driven by `scripts/package.py`. The
entry point is:

```sh
python scripts/build.py --package   # frontend build + installer
```

## Two-zone model

The app follows the standard two-zone model:

- **Install zone (read-only):** the app bundle — `main.js`, `preload.js`, the
  frontend `dist/`, and the `node-pty` native binary. Nothing here is ever
  written at runtime.
- **User zone (writable):** `app.getPath('userData')` — settings, app state,
  the extension store, and scoped storage. Never shipped in the installer.

## How the bundle is assembled

- **Frontend:** staged at `apps/desktop/build/frontend/` before packaging;
  `main.js` resolves it via `resolveFrontendIndex()` (dev path first, staged
  path in the packaged app).
- **python-host:** ships as `extraResources` (`resources/python-host`: app
  code + `.venv`); `main.js` resolves it via `resolvePythonHostDir()`.
  Windows venvs are relocatable, so the packaged service boots from the
  bundled copy; the `SISYPHUS_PYTHON` env override remains available.
- **node-pty:** ships N-API prebuilds that work in both Node and Electron, so
  `npmRebuild: false` skips source rebuilding (which would require MSVC
  Spectre libraries). electron-builder unpacks the `.node` binaries from the
  asar automatically. `main.js` still guards the `require` with try/catch so
  dev keeps working without it.

## Dependency rules

Any package required by the main process at runtime must declare its own
runtime deps as `dependencies` (not `devDependencies`): electron-builder
prunes devDependencies from the asar, and a missing transitive dep makes
`main.js` die at `require()` time with no visible error. For example,
`@sisyphus/shared` needs `react` in `dependencies` because its built `icon.js`
requires `react/jsx-runtime`.

## First run

On first run the app seeds `userData/extensions/` with the bundled default
extensions from `packages/` (dev) or `resources/runtime-extensions` (packaged)
— see [Extensions](Extensions.md).

## Deferred until the first real ship

- Code signing
- Auto-update
- The extension API surface
