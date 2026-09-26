# Plugin studio

Studio lists discovered runtime entry points, edits their original entry source,
reveals folders, and reloads or restores packages. Shipped plugins and user plugins
use the same loader. Package source lives in `userData/plugins/<package>/`;
renderer code is compiled on demand and registered with Cordis. Failed compilation
or activation keeps the prior working version. Reload on save is optional.

The New Plugin form writes a single file: `<namespace>.<name>.renderer.js` for
this window, or `.main.js` for the main process (`.main.cjs` is also accepted for
a CommonJS main-process plugin). That flat single-file form is the supported legacy
layout. For a multi-file plugin, add a folder with a `package.json` declaring
`sisyphus.frontend` and/or `sisyphus.backend`; see
[ARCHITECTURE.md](../../ARCHITECTURE.md). React and service contracts
are supplied by the host, and other dependencies belong to the plugin.

Restore restores the entire package, including its frontend/backend source and
assets. The Electron platform bridge requires an app restart; feature entry
points reload live. Native plugins are trusted code with the app's permissions.
