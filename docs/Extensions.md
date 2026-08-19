# Extensions

Pages are extensions. The sidebar, page mounting, and navigation all derive
from a page registry — add a descriptor, and the UI follows.

## Core types

Types come from `@sisyphus/shared`:

```ts
interface PageProps { active: boolean }

// Manifest data (framework-agnostic):
interface ExtensionManifest {
  id: string            // open string; unique across all registered pages
  title: string         // sidebar label
  icon?: string         // inline SVG markup owned by the extension
  keepAlive: boolean    // keep mounted while inactive (see below)
}

// A sidebar-visible page:
interface ExtensionPage extends ExtensionManifest {
  component: ComponentType<PageProps>
}
```

## Icons

Extensions own their icons — there is no app-level icon sprite. The `icon`
field is **inline SVG markup** (root `<svg>` with `viewBox` and
`currentColor`-based presentation attributes); the shared `Icon` component
parses and renders it, so icons inherit the surrounding text color.

- **Compile-time extensions** import their icon file with Vite's `?raw`
  suffix, which inlines the SVG markup into the bundle:

  ```ts
  import icon from './icon.svg?raw'
  ```

- **Runtime extensions** ship an `icon.svg` in their store dir, declare it in
  the manifest (`"icon": "icon.svg"`), and the host fetches and injects the
  markup into the registered page — the entry module never touches the icon
  (see [Loading pipeline](#loading-pipeline)).

If a page ends up without an icon, the sidebar falls back to the title's
first character.

## Compile-time extensions (shipped pages)

Adding a page:

1. Create `packages/extension-<name>` as a workspace package exporting an
   `ExtensionPage` descriptor, e.g.:

   ```tsx
   // packages/extension-home/src/index.tsx (pattern)
   import type { ExtensionPage } from '@sisyphus/shared'
   import icon from './icon.svg?raw'

   export const homeExtension = {
     id: 'home',
     title: 'Home',
     icon,
     keepAlive: false,
     component: () => <HomePage />,
   } as const satisfies ExtensionPage
   ```

2. Add the descriptor to the registry in
   `apps/frontend/src/extensions/index.tsx`.

3. Done — the sidebar item, page mount, and navigation are automatic. The
   sidebar buttons carry `data-page={id}`, stable hooks the smoke test relies
   on.

Shipped compile-time extensions:

| Package | Page id | What it does |
| --- | --- | --- |
| `extension-home` | `home` | Landing page with runtime version info |
| `extension-terminal` | `terminal` | node-pty shells (see [IPC Reference](IPC-Reference.md)) |
| `extension-processes` | `processes` | Live view of managed subprocesses |
| `extension-api` | `api` | Frontend for the python-host service (see [Managed Services](Managed-Services.md)) |

## Runtime-loaded extensions

Extensions are **trusted**. In addition to compile-time pages, the app loads
runtime extensions from a store under `userData`. The renderer's IPC bridge
can spawn processes (`window.terminals.spawn`), so "trusted" is an explicit
assumption — untrusted-code sandboxing is deliberately deferred.

### Extension store

Persistent storage lives in the user data directory, never the install
directory:

```
<userData>/
  extensions/
    <id>@<version>/
      manifest.json
      entry.js
      icon.svg
      style.css
```

Versioned directories (`id@version`) make install/update/rollback atomic —
swap a directory instead of mutating files. Highest version wins per id.

### Manifest

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

`"icon"` names a file within the extension dir; the host resolves it to a URL
and inlines its SVG markup into the registered page.

### Entry module

`entry.js` is plain ESM exporting `register(host)`. The host SDK is
`{ React, registerPages, storage }` — no bare imports and no build step;
relative imports resolve within the extension dir. `registerPages(...)` takes
`ExtensionPage` descriptors built via `host.React.createElement`; the page
metadata (icon, declared in the manifest) is applied by the host. An optional
`style.css` is injected by the host.

```js
export function register({ React, registerPages, storage }) {
  const Page = () => React.createElement('h1', null, 'hello')
  registerPages([
    { id: 'my-tool', title: 'My Tool', keepAlive: false, component: Page },
  ])
}
```

### Loading pipeline

1. Main process (`apps/desktop/lib/extension-store.js`, pure Node):
   `ensureStore` creates `userData/extensions`, `seedDefaults` copies bundled
   defaults from `packages/runtime-extensions` (dev) or
   `resources/runtime-extensions` (packaged) on first run, and `scanStore`
   lists installed extensions with per-page icon URLs.
2. A privileged custom protocol (`sisyphus-ext://`, registered pre-ready with
   `corsEnabled`/`stream`/`supportFetchAPI`) serves store files with path
   validation and correct MIME types.
3. The renderer (`apps/frontend/src/extensions/loader.ts`) lists extensions
   over IPC (`extensions:list`), dynamically `import()`s each entry URL,
   calls `register(host)`, and injects the stylesheet. The host's
   `registerPages` first fetches each page's icon file (declared in the
   manifest) and inlines the SVG markup into the descriptor.
4. Pages land in the dynamic registry
   (`apps/frontend/src/extensions/registry.ts`), which `App` reads via
   `useSyncExternalStore` — no UI changes needed for new pages.

The shipped sample (`packages/runtime-extensions/runtime-sample@1.1.0`)
demonstrates the full path end-to-end.

## Storage API

One scoped key-value contract shared by the app and its extensions
(`apps/desktop/lib/app-storage.js`, pure Node, atomic tmp+rename writes):

- One JSON file per scope under `userData/storage/<scope>.json` — distinct
  from the *extension store* (`userData/extensions/`, which holds installed
  extension files).
- Scopes are validated file names (`/^[a-zA-Z0-9._-]+$/`). The app uses scope
  `app`; each extension gets its own id as scope, so extensions can't collide
  with or read each other's data.
- Renderer access is over IPC (`storage:get` / `storage:set` /
  `storage:delete`), bridged by preload as `window.sisyphus.storage`, and
  surfaced to runtime extensions as `host.storage` (scoped to the extension
  id by the loader).

The runtime-sample extension persists a visit counter through `host.storage`
as a working example.

## keepAlive

Pages with `keepAlive: false` mount on first activation and unmount on
navigation away. Set `keepAlive: true` when a page holds state that must
survive switches — the terminal page does (live PTYs), which is why `App`
renders it hidden-but-mounted.
