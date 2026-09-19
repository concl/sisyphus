# Architecture

Sisyphus is a desktop profile built on [Cordis](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md). `@deepseek-ai/cordis` owns plugin activation, service injection, effects, and disposal. There is no Sisyphus kernel implementation. `packages/profile` is only a named list and toggle controller around Cordis; it has no competing dependency engine.

Electron requires two processes, so there are two Cordis contexts. `apps/desktop/profile.js` chooses trusted native plugins; `apps/frontend/src/profile.ts` chooses renderer plugins. The preload's narrow `call/on` bridge joins them. A service name such as `storage.v1` is a contract, not a global object shared across processes.

## Where things live

| Path                            | Purpose                                                                   |
| ------------------------------- | ------------------------------------------------------------------------- |
| `packages/profile`              | Cordis composition and session toggles                                    |
| `packages/sdk/src/index.ts`     | Shared service and panel types                                            |
| `packages/ui/src`               | Shared UI primitives: resizable sidebar shell and chrome icons            |
| `packages/plugin-chat/src`      | Chat block: composer with `@` mentions, markdown transcript, sidebar      |
| `packages/plugin-home/src`      | Home block and its `icon.svg`                                             |
| `packages/plugin-terminal/src`  | Terminal block and its `icon.svg`                                         |
| `packages/plugin-python/src`    | Python Host block and its `icon.svg`                                      |
| `packages/plugin-planner/src`   | Planner block, styles, and `icon.svg`                                     |
| `packages/plugin-panels/src`    | Reversible panel registry                                                 |
| `packages/plugin-workspace/src` | Docked shell, styling, layout persistence                                 |
| `apps/desktop/plugins`          | Native transport, window, storage, PTY, Python, and planner sync adapters |
| `apps/desktop/lib`              | Native implementation and testable pure logic                             |
| `services/python-host`          | Python server definitions and sample ASGI app                             |
| `scripts`                       | Setup, test, build, run, and packaging shortcuts                          |

The renderer package for a feature owns its icon. Native adapters stay under `apps/desktop/plugins` because they run in Electron's main process, and their implementation lives in `apps/desktop/lib`. Search the feature name to find both halves. The composition profiles are the only places where plugins are selected.

`packages/ui/src` holds the primitives shared by more than one block. Today that is the resizable sidebar shell — `ResizableSidebar` and `useSidebarSize` handle drag, snap-to-close, keyboard resize, and the overlay mode used when a block is narrow — plus the chrome icons. A block that needs a collapsible side list (chat does) composes these instead of growing its own drag logic. Keep the package presentational: no services, no `ctx`, no plugin-specific state.

## Kernel boundary and plugin shape

Cordis is the kernel. It owns lifecycle and service resolution. It does not expose the raw filesystem, shell, Electron, or React to every plugin. Those are replaceable providers with small versioned interfaces. Storage offers scoped JSON values; planner sync offers a chosen-folder document transport. A future general filesystem provider should grant explicit roots or handles and validate paths.

Declare `inject` for services used, `provide` for services published, and return a disposer from `ctx.effect` for every registration, listener, process, or timer. For a UI block:

```tsx
import { services, type AppPlugin, type Panels } from '@sisyphus/sdk'
import icon from './icon.svg'

export const notesPlugin: AppPlugin = {
  id: 'feature.notes',
  name: 'Notes',
  inject: [services.panels],
  apply(ctx) {
    const panels = ctx.get(services.panels) as Panels
    ctx.effect(() =>
      panels.register({
        id: 'notes',
        title: 'Notes',
        icon,
        description: 'Capture a thought.',
        component: NotesPanel,
      }),
    )
  },
}
```

Add it to `apps/frontend/src/profile.ts`. Add a native plugin to `apps/desktop/profile.js` only if the feature needs native capabilities. Bundled plugins are trusted code; Cordis injection is a composition mechanism, not a sandbox for arbitrary third-party packages.

## Composable workspace and app data

UI plugins contribute `PanelDefinition` values; the workspace decides placement. Dockview uses edge drops for splits, tab drops for stacks, and draggable separators for resize. Floating OS-style windows are disabled. A panel type may have multiple instances if it declares `multiple`; closing a terminal block ends that instance's PTY.

The current layout autosaves as `userData/storage/ui.workspace.json` under `layout.v1`. **Layouts → Save** stores named snapshots in the same JSON file under `saved-layouts.v1`; **Layouts** opens one, and the rail reset control restores the profile's default. Layouts are device preferences and are not cloud synced. Removing a plugin removes its unavailable blocks from a restored layout. Named snapshots are retained so they can be reopened after re-enabling a plugin.

Scoped app data is JSON under `userData/storage/<scope>.json`, with temporary-file rename on writes. The planner's durable record document is `userData/storage/planner.json` under `document.v1`. This is a simple local-first store. The storage provider validates scope/key names, and the Electron renderer has no direct Node access.

## Conversation folders and agent tools

A conversation can be bound to one folder, and starts with none. `chat.folder.choose` opens the OS picker and `chat.setFolder` binds or clears a path for a stored conversation; the canonical path lives on the thread in `chat.history`, so reopening a conversation restores its folder. A folder that moved away is forgotten instead of failing the next reply. Only the picker's start location is remembered in `chat.folder`, so attaching a folder to one chat never binds it to another.

Tools are called with `{ folder, conversationId, signal }`, and the folder is the boundary:

| Provider               | Tools                                                                                        | Notes                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop.files`        | `read_file`, `list_directory`, `search_files`, `create_directory`, `write_file`, `edit_file` | Bridge to the official `@modelcontextprotocol/server-filesystem`. One server process per folder, started with Electron's own Node (`ELECTRON_RUN_AS_NODE`). Tool metadata and access levels stay declared here. |
| `desktop.shell`        | `run_command`                                                                                | One-shot `child_process` run in the folder with the shell `lib/backends.js` detects. Own process group, so a timeout or a stop kills the tree; output is capped before it reaches the model.                    |
| `desktop.planner-data` | `list_planner`, `create_planner_item`, `update_planner_item`, `delete_planner_item`          | App data only, unchanged.                                                                                                                                                                                       |

The access level still gates everything: read-only tools require `read`, the rest require `write`, and `none` exposes nothing. Every call is audited in the transcript with its input and a truncated result, which is also what `chat.tools` lists in Settings. The composer's `@` picker is `files.list`, a cached metadata walk of the bound folder (`lib/file-index.js`); it reads no file contents.

Path handling is defence in depth: `lib/chat-folder.js` resolves and rejects anything outside the folder (including through symlinked directories) for `run_command` working directories, the filesystem server jails its own paths to the folder it was started with, and the model is told the boundary in the system prompt.

Packaging note: the filesystem server is spawned as a child process, so `electron-builder.yml` unpacks `node_modules/@modelcontextprotocol/**` out of the asar archive.

## Planner and sync transport

The Planner block owns to-dos and dated events. Its document schema is `{schema:1, records:[...]}`. Every record has a stable ID, kind, title, `updatedAt`, and actor; deletions are tombstones. The planner sync logic in `apps/desktop/lib/planner-sync.js` expects a transport with `read(): Promise<Document>` and `write(document): Promise<void>`; synchronous adapters also work. The bundled `FolderDocumentTransport` writes `sisyphus-planner.json` in a folder chosen through Electron's directory picker. Point it at a folder mirrored by the user's cloud client to sync across devices; the desktop app never needs that provider's credentials.

An API-based Google Drive, Dropbox, WebDAV, or mobile transport can implement the same read/write document contract. It should add conditional writes/version checks and retry to handle concurrent devices. The current folder adapter merges by latest `updatedAt` with an actor tie-break and retains tombstones, but simultaneous remote writes are not transactionally safe. Sync is manual. This does not sync a Google Calendar account, provide background sync, or resolve semantic conflicts in simultaneous edits. Those require provider adapters and a stronger sync protocol.

## Runtime and distribution

The native transport checks that calls come from the app window's main frame. The preload exposes only `call` and `on`; context isolation and sandbox are enabled. Terminal ownership is bound to the calling window. Python servers are configured in `services/python-host/servers.json`, bind loopback ports dynamically, and stop when their provider unloads or the app quits.

The old page extension API and sample runtime loader were removed during this breaking migration. Existing user data and Git history are untouched. Packaged builds include Python server source but require an interpreter with the host requirements installed, selected with `SISYPHUS_PYTHON`; a portable interpreter remains distribution work.
