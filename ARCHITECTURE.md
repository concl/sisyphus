# Architecture

Sisyphus is an extendable workspace/planning/automation app: an Electron
desktop shell with a React frontend, built around an extension model where
pages register into a sidebar-visible registry.

## Repository layout

- `apps/desktop` — Electron main process (`main.js`) + preload bridge (`preload.js`).
- `apps/frontend` — React + Vite + TypeScript UI (the renderer).
- `apps/mobile` — placeholder (empty).
- `packages/` — home of first-party packages. Each extension is its own
  workspace package (`@sisyphus/extension-*`) exporting an `ExtensionPage`
  descriptor; they ship with the app (see "Extension model").
- `packages/shared` (`@sisyphus/shared`) — framework-agnostic contracts: IPC
  channel names and payload types, `ExtensionManifest`/`ExtensionPage`, and
  managed-process types. Compiled to CJS (`dist/`) by its `prepare` script on
  install, so both the ESM frontend and the CJS main process import it by name.
- `packages/runtime-extensions/` — bundled runtime extensions (plain
  manifest + ESM entry), seeded into the userData store on first run (see
  "Runtime-loaded extensions").
- `services/python-host` — the python-host FastAPI service, spawned and
  managed by the desktop main process (see "Managed services"). Dependencies
  are pinned in `requirements.txt`; a venv lives in
  `services/python-host/.venv` (created by `scripts/setup.py`). `addons/` and
  `backends/` are reserved for future host-side plugins.
- `scripts/` — reproducibility entry points: `setup.py` (npm workspace install +
  python-host venv), `test.py` (all unit tests), `build.py` (shared + frontend
  builds), `package.py` (electron-builder installer), and
  `build_and_run_desktop.py` (dev flow: build + launch). Scripts use `npm.cmd`
  on Windows.

## Frontend

- **Pages are extensions.** `apps/frontend/src/extensions/index.tsx` is the
  single page registry; `Sidebar` renders nav items from it and `App` mounts
  pages from it. See "Extension model" below.
- **Styling:** CSS modules (`*.module.css`) with kebab-case class names; JS
  accesses them camelCase via `css.modules.localsConvention: 'camelCaseOnly'`
  in `vite.config.ts`. Design tokens (`:root` variables), base element styles,
  and shared primitives (`.icon`, `.icon-sm`, `.icon-btn`) stay global in
  `src/index.css`.
- **Icons:** extensions own their icons — no app-level sprite. Each extension
  ships an `icon.svg` next to its source, imported `?raw` (compile-time) or
  declared in the manifest and fetched over `sisyphus-ext://` (runtime), and
  passes the inline SVG markup as the page descriptor's `icon`. The shared
  `Icon` component (`packages/shared/src/icon.tsx`) parses and renders the
  markup, inheriting `currentColor`.

## Extension model

### Adding a page (compile-time extension)

1. Create `packages/extension-<name>` exporting a descriptor (`id`, `title`,
   `icon` — inline SVG markup from the extension's own `icon.svg`, imported
   `?raw` — `keepAlive`, `component`) typed as `ExtensionPage`; types and
   `PageProps` come from `@sisyphus/shared`. Pages receive `PageProps`
   (`{ active: boolean }`).
2. Add the descriptor to the registry in
   `apps/frontend/src/extensions/index.tsx`.
3. The sidebar item, the page mount, and navigation follow automatically.

The registry starts with the compile-time pages and is **dynamic**: runtime
extensions append to it (see below), so page ids are open strings. The sidebar
buttons carry `data-page={id}` — stable hooks that the desktop smoke test
(`npm run smoke`) relies on.

Shipped extensions: `extension-home` (landing page), `extension-terminal`
(node-pty shells), `extension-processes` (live view of managed subprocesses),
and `extension-api` (a frontend for the python-host service — see "Managed
services").

### keepAlive

Pages with `keepAlive: false` are mounted on first activation and unmounted
when the user navigates away. Set `keepAlive: true` when a page holds state
that must survive switches — the terminal page does (live PTYs), which is why
`App` renders it hidden-but-mounted.

### Runtime-loaded extensions

Extensions are **trusted**. First-party pages are compile-time; additionally,
the app loads runtime extensions from a store under `userData` — seeded with
bundled defaults and served to the renderer over a privileged protocol.
Untrusted-code sandboxing (isolated context, capability declarations) is
deliberately deferred; note that the renderer's IPC bridge can spawn processes
(`window.terminals.spawn`), so "trusted" is an explicit assumption, not a
guarantee.

#### Extension store

Persistent storage for extensions lives in the user data directory, never the
install directory:

```
<userData>/
  extensions/
    <id>@<version>/
      manifest.json
      entry.js
      icon.svg
      style.css
    runtime-sample@1.1.0/
      manifest.json
      entry.js
      icon.svg
      style.css
```

Versioned directories (`id@version`) make install/update/rollback atomic —
swap a directory instead of mutating files. `app.getPath('userData')` resolves
to `%APPDATA%\Sisyphus` (Windows; named by `productName` in
`apps/desktop/package.json`), `~/Library/Application Support/Sisyphus`
(macOS), or `~/.config/sisyphus` (Linux).

#### Manifest

```jsonc
{
  "id": "my-tool",
  "version": "0.2.1",
  "entry": "entry.js",
  "style": "style.css",
  "pages": [
    { "id": "my-tool", "title": "My Tool", "icon": "icon.svg", "keepAlive": false }
  ]
}
```

`icon` names a file inside the extension dir; the host resolves it to a
`sissyphus-ext://` URL and inlines its SVG markup into the registered page
(extensions own their icons). `entry.js` is plain ESM exporting
`register(host)`; the host hands it an SDK — `{ React, registerPages, storage }`
— and the extension calls `registerPages(...)` with `ExtensionPage`
descriptors built via `host.React.createElement`. No bare imports and no
build step; relative imports resolve within the extension dir. `style.css`
(optional) is injected by the host.

#### Loading

- Main process (`apps/desktop/lib/extension-store.js`, pure Node):
  `ensureStore` creates `userData/extensions`, `seedDefaults` copies the
  bundled defaults from `packages/runtime-extensions` (dev) or
  `resources/runtime-extensions` (packaged) into the store on first run, and
  `scanStore` lists installed extensions (highest version wins per id), with
  each manifest page's icon URL resolved.
- A privileged custom protocol (`sisyphus-ext://`, registered pre-ready with
  `corsEnabled`/`stream`/`supportFetchAPI`, handled in `whenReady`) serves
  store files with path validation and correct MIME types.
- The renderer (`apps/frontend/src/extensions/loader.ts`) lists extensions
  over IPC (`extensions:list`), dynamically `import()`s each entry URL, calls
  `register(host)`, and injects the stylesheet. The host's `registerPages`
  fetches each page's icon file (declared in the manifest) and inlines the
  SVG markup into the descriptor before registering. Pages land in the
  dynamic registry (`apps/frontend/src/extensions/registry.ts`), which `App`
  reads via `useSyncExternalStore` — no UI changes needed for new pages.
- Extensions talk to the main process only through declared IPC channels (see
  "Process model & IPC").

The shipped sample (`packages/runtime-extensions/runtime-sample@1.1.0`)
demonstrates the full path end-to-end.

#### Storage API

The app and its extensions share one scoped key-value storage contract
(`apps/desktop/lib/app-storage.js`, pure Node, atomic tmp+rename writes):

- One JSON file per scope under `userData/storage/<scope>.json` — deliberately
  distinct from the *extension store* (`userData/extensions/`, which holds
  installed extension files).
- Scopes are validated file names (`/^[a-zA-Z0-9._-]+$/`). The app uses scope
  `app`; each extension gets its own id as scope, so extensions can't collide
  with or read each other's data.
- Renderer access is over IPC (`storage:get` / `storage:set` /
  `storage:delete`, channels in `@sisyphus/shared`), bridged by preload as
  `window.sisyphus.storage`, and surfaced to runtime extensions as
  `host.storage` (scoped to the extension id by the loader).

The runtime-sample extension persists a visit counter through `host.storage`
as a working example.

## Process model & IPC

- The renderer runs with `contextIsolation: true` and `nodeIntegration: false`;
  the only bridge is `preload.js`, exposing `window.versions`, `window.terminals`,
  `window.services`, and `window.processes`.
- All channels are registered in one place, `registerIpc()` in `main.js`, using
  the `IPC` constants from `@sisyphus/shared`. Terminal channels:
  `terminal:list-backends`, `terminal:spawn`, `terminal:input`,
  `terminal:resize`, `terminal:kill`, `terminal:data`, `terminal:exit`.
  Service channels: `service:status`, `service:call` (a validated, scoped HTTP
  proxy into the python-host API — paths must start with `/`).
  Process channels: `processes:list`. Extension channels: `extensions:list`
  (installed runtime extensions from the userData store). Storage channels:
  `storage:get` / `storage:set` / `storage:delete` (scoped key-value data, see
  "Storage API").
- Channel names and payload types live in `packages/shared` (the `IPC` const
  and `types.ts`). The sandboxed preload bridge cannot import packages, so
  `preload.js` inlines the channel strings — keep them in sync with `IPC`
  (noted in `packages/shared/src/ipc.ts`).
- `main.js` intentionally sets no application menu; `F12` is bound in
  `createWindow()` as the DevTools toggle.

## Managed services

`services/python-host` is a FastAPI app spawned by the main process on startup
and killed on quit. The main process owns a `ServiceSupervisor`
(`apps/desktop/lib/service-supervisor.js`): it resolves the venv python
(`SISYPHUS_PYTHON` env override), spawns uvicorn on `127.0.0.1:8765`, polls
`/health`, and reports a `ServiceStatus`. Extensions reach the API through
`window.services.call(path)`, which the main process proxies over HTTP — the
frontend never talks to the service directly.

Testable main-process logic lives in `apps/desktop/lib/` as plain Node
modules: `backends.js` (shell detection), `service-supervisor.js` (spawn /
health / stop with injectable spawn+fetch), and `processes.js`
(`collectProcesses` builds the `ManagedProcessInfo` list for
`processes:list`).

## Packaging & distribution

The app follows the standard two-zone model:

- **Install zone (read-only):** the app bundle — `main.js`, `preload.js`, the
  frontend `dist/`, and the `node-pty` native binary. Nothing here is ever
  written at runtime.
- **User zone (writable):** `app.getPath('userData')` — settings, app state,
  and the extension store (see "Runtime-loaded extensions"). Never shipped in
  the installer.

Tooling: `electron-builder` (NSIS on Windows; DMG/AppImage later), configured
in `apps/desktop/electron-builder.yml` and driven by `scripts/package.py`:

- The frontend bundle is staged at `apps/desktop/build/frontend/` before
  packaging; `main.js` resolves it via `resolveFrontendIndex()` (dev path
  first, staged path in the packaged app).
- The python-host service ships as `extraResources`
  (`resources/python-host`: app code + `.venv`); `main.js` resolves it via
  `resolvePythonHostDir()`. Windows venvs are relocatable, so the packaged
  service boots from the bundled copy; a `SISYPHUS_PYTHON` env override
  remains available.
- `node-pty` ships N-API prebuilds that work in both Node and Electron, so
  `npmRebuild: false` skips source rebuilding (which would require MSVC
  Spectre libraries); electron-builder unpacks the `.node` binaries from the
  asar automatically. `main.js` still guards the `require` with try/catch so
  dev keeps working without it.
- Any package required by the main process at runtime must declare its own
  runtime deps as `dependencies` (not `devDependencies`): electron-builder
  prunes devDependencies from the asar, and a missing transitive dep makes
  `main.js` die at `require()` time with no visible error. (`@sisyphus/shared`
  needs `react` in `dependencies` because its built `icon.js` requires
  `react/jsx-runtime`.)

On first run the app creates `userData/extensions/` — the extension store
(see "Runtime-loaded extensions"). Seeding it with the bundled default
extensions from `packages/` lands together with the runtime loader. Deferred
until the first real ship: code signing, auto-update, and the extension API
surface.

## Monorepo wiring

The root is an npm workspaces monorepo (`package.json`:
`"workspaces": ["apps/*", "packages/*", "services/*"]`). Dependencies are
installed once at the root (`npm install` in the repo root); the root
`package-lock.json` is canonical and there are no per-app lockfiles. Workspace
packages (`packages/*`) are symlinked into consumers' `node_modules`, so any
app imports them by package name (e.g. `@sisyphus/shared`).

The shared contracts for the extension/IPC model live in `packages/shared`
(see "Extension model" and "Process model & IPC").

## Verification

- Frontend: `npm run test` in `apps/frontend` (vitest — registry contract
  tests) plus `npm run build` / `npm run lint` (`tsc -b && vite build`, eslint).
- Desktop logic: `npm test` in `apps/desktop` (node:test — `lib/backends.js`,
  `lib/service-supervisor.js`, `lib/processes.js`; the supervisor tests inject
  fake spawn/fetch).
- Python-host: `pytest` in `services/python-host` (inside its venv).
- End-to-end smoke: build the frontend, then `npm run smoke` in `apps/desktop`.
  It boots Electron, drives the UI via `webContents.executeJavaScript`, spawns
  a real shell, opens the Processes and Python API pages, calls the FastAPI
  service through IPC, and prints `SMOKE_RESULT`. The packaged app can be
  smoke-tested the same way: `dist/win-unpacked/Sisyphus.exe --smoke` (the
  result is also mirrored to `userData/smoke-result.json` in case stdout is
  unavailable).
- Dev loop: `npm --prefix apps/frontend run dev`, then run the desktop app with
  `VITE_DEV_SERVER_URL` set so it loads the Vite dev server instead of the
  built `dist/`.
