# Plugin studio

Studio lists discovered runtime entry points, edits their original entry source,
reveals folders, and reloads or restores packages. Shipped plugins and user plugins
use the same loader. Package source lives in `userData/plugins/<package>/`;
renderer code is compiled on demand and registered with Cordis. Failed compilation
or activation keeps the prior working version. Reload on save is optional.

The small New Plugin templates use the supported legacy single-file format.
For a multi-file plugin, add a folder with a `package.json` and a `sisyphus` entry
manifest; see [ARCHITECTURE.md](../../ARCHITECTURE.md). React and service contracts
are supplied by the host, and other dependencies belong to the plugin.

Restore restores the entire package, including its renderer/native source and
assets. The Electron platform bridge requires an app restart; feature entry
points reload live. Native plugins are trusted code with the app's permissions.
