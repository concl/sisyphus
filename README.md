# Sisyphus

A Cordis desktop workspace whose features are editable runtime plugins.

## Find your way around

- `plugins/<feature>/frontend/`: a feature's UI and frontend services.
- `plugins/<feature>/backend/`: the same feature's desktop services and workers.
- `plugins/<feature>/package.json`: declares either or both entry points.
- `bootstrap/`: starts Electron and its frontend, then loads plugins dynamically.
- `shared/`: reusable UI, contracts, backend helpers, and the Cordis runtime wrapper.
- `scripts/`: development, build, and packaging commands.

Start with a feature folder. To-dos and Calendar use the same Planner service;
Chat keeps its frontend, backend, and worker code together. Cordis composes each
process at runtime, and explicit messages connect frontend and backend. Mobile
is out of scope for this version.

## Run

Requires Node.js 22+ and Python 3.10+.

```sh
python scripts/setup.py
npm run build
npm start
```

### A button for the app

The app can be opened from a desktop entry instead of a terminal, which is what you
want on a taskbar, a Dock, or a menu:

```sh
npm run shortcut                  # the entry, where this system keeps them
npm run shortcut -- --menu        # Windows: also in the Start menu
npm run shortcut -- --startup     # also run it when you log in
npm run shortcut -- --remove      # take the entries away again
```

The entry points at the Electron binary in this checkout and runs it with
`bootstrap/backend` as its working directory - the same thing `npm start` runs - so a click
needs no terminal, no Node on `PATH`, and no rebuild. Windows gets a `.lnk` on the
Desktop, macOS an `.app` in `~/Applications` with an alias on the Desktop, and Linux a
`.desktop` file in the applications menu. Pin it the way the system pins anything:
_Pin to taskbar_, drag it onto the Dock, or _Add to favorites_. While the app is
running a second click focuses its window.

An icon is used from `bootstrap/backend/build/icon.ico` (or `.icns`, `.png`) when that file
exists; otherwise the system's own icon is drawn. The entries point into this checkout,
so move the folder and run the script again.

Nothing here starts Python: the app starts its own Python host (`plugins/python/service`)
when a Python block asks a service to run, so there is nothing to warm up first. Use
`--startup` for the app at login, and a second login item for anything else that has to
be running beforehand.

## Change the running app

Feature packages live in `plugins/<feature>/`. Each package owns its source,
styles, assets, and backend adapters. `shared/` contains shared libraries and
contracts only. There is no compiled feature list in the Electron or frontend host.

The build stages these **source folders** under `build/plugins`. On startup the
app copies them to `userData/plugins`, preserving local edits. Electron discovers
package manifests there and compiles their entry points on demand. The renderer
loads the resulting code through Cordis. Editing a component or CSS file in app
data and pressing **Plugin studio → Reload** changes the running feature without
rebuilding or restarting the app. A file that changed is noticed and marked
changed; it is mounted when **Reload** (or the chat agent's `plugin_reload`) asks
for it, and on its own only when **Reload on save** is switched on. Compilation or
activation errors leave the previous working plugin mounted.

For development against the repository:

```sh
npm run dev:app
# Or, with the app already running:
npm run plugins:watch
```

The watcher stages and copies source changes from `plugins/` to app data. Each
copy lands as a changed file in the running app: press **Reload all** in Plugin
studio to mount them, or switch on **Reload on save** while iterating. Use
`npm run plugins:sync -- --dest <app-data-plugins-folder>` for a one-time sync.
App-data edits are preserved unless `--force` is explicitly supplied.
`SISYPHUS_USER_DATA` selects an alternate app-data root for both Electron and sync.
Host or shared-library changes still require rebuilding/restarting the host.

Existing plugin IDs and npm imports are unchanged. Legacy manifests still load;
edited app-data packages keep their old source layout until explicitly restored
or force-synced. Untouched packages migrate to `frontend/` and `backend/` automatically.

**Plugin studio** edits entry points, reveals source folders, reloads plugins, and
restores shipped source. Native Electron platform adapters (window, transport,
storage, and preferences) are bootstrap infrastructure and require a restart;
feature adapters and UI plugins reload live. Plugins are trusted code, not security
sandboxes. Chat inference/history runs in a worker; native capabilities use narrow
service contracts in Electron.

## Features

- **Chat:** independent concurrent conversations, per-conversation cancellation,
  branching/editing, folder tools, Markdown and reasoning. Switching conversations
  or workspace blocks does not stop work. Full provider messages from every tool
  step are replayed on the next turn, including supported reasoning metadata.
  The small context indicator uses provider usage when available and labels
  estimates with `~`. No compaction or automatic context limit is applied.
- **To-dos and Calendar:** separate dockable plugins sharing the `planner.v1`
  service. A task with a date appears in Calendar; clearing its date keeps it in
  To-dos. Completion and edits affect the same record in either view. Existing
  planner data and file sync are retained; old Planner layouts open To-dos.
- **Terminal, Python Host, VS Code, Browser Tabs, Home, Settings, Theme, and
  Workspace:** independently composed plugins. Drag blocks to stack or split them,
  and drag the rail icons to arrange the sidebar; a saved layout keeps both orders,
  and Restore default layout puts both back.

See [ARCHITECTURE.md](ARCHITECTURE.md) for package manifests, service boundaries,
and lifecycle details.

## Verify

```sh
npm test
npm run typecheck:plugins
npm run lint
npm run smoke
python scripts/build.py --package
```

Smoke uses isolated app data and a local model fixture; it does not call a paid
model provider. `SISYPHUS_PYTHON` selects the Python interpreter.
