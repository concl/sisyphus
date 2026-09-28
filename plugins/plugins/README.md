# Plugins

The Plugins panel displays discovered runtime entry points in a searchable card
grid, edits their original entry source,
reveals folders, and reloads or restores packages. Shipped plugins and user plugins
use the same loader. Package source lives in `userData/plugins/<package>/`;
renderer code is compiled on demand and registered with Cordis. Failed compilation
or activation keeps the prior working version. Reload on save is optional.

Plugin creation is available through the existing backend and agent tools; the
panel does not include creation controls. Single-file plugins use
`<namespace>.<name>.renderer.js` for this window or `.main.js` for the main process
(`.main.cjs` is also supported). For a multi-file plugin, add a folder with a `package.json` declaring
`sisyphus.frontend` and/or `sisyphus.backend`; see
[ARCHITECTURE.md](../../ARCHITECTURE.md). React and service contracts
are supplied by the host, and other dependencies belong to the plugin.

Restore restores the entire package, including its frontend/backend source and
assets. The Electron platform bridge requires an app restart; feature entry
points reload live. Native plugins are trusted code with the app's permissions.
