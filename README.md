# Sisyphus

A Cordis desktop workspace whose features are editable runtime plugins.

## Run

Requires Node.js 22+ and Python 3.10+.

```sh
python scripts/setup.py
npm run build
npm start
```

## Change the running app

Feature packages live in `plugins/<feature>/`. Each package owns its source,
styles, assets, and native adapters. `packages/` contains shared libraries and
contracts only. There is no compiled feature list in the Electron or frontend host.

The build stages these **source folders** under `build/plugins`. On startup the
app copies them to `userData/plugins`, preserving local edits. Electron discovers
package manifests there and compiles their entry points on demand. The renderer
loads the resulting code through Cordis. Editing a component or CSS file in app
data and pressing **Plugin studio → Reload** changes the running feature without
rebuilding or restarting the app. **Reload on save** is optional. Compilation or
activation errors leave the previous working plugin mounted.

For development against the repository:

```sh
npm run dev:app
# Or, with the app already running:
npm run plugins:watch
```

The watcher stages and copies source changes from `plugins/` to app data. Use
`npm run plugins:sync -- --dest <app-data-plugins-folder>` for a one-time sync.
App-data edits are preserved unless `--force` is explicitly supplied.
`SISYPHUS_USER_DATA` selects an alternate app-data root for both Electron and sync.
Host or shared-library changes still require rebuilding/restarting the host.

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
  Workspace:** independently composed plugins. Drag blocks to stack or split them;
  save arrangements from Layouts.

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
