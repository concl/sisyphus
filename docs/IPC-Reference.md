# IPC Reference

All inter-process communication goes through the sandboxed preload bridge.
Channel names and payload types live in `packages/shared` (`IPC` const in
`src/ipc.ts`, payload types in `src/types.ts`).

> **Sync note:** the sandboxed preload cannot import packages, so
> `apps/desktop/preload.js` inlines the channel strings. Keep them in sync
> with the `IPC` const in `@sisyphus/shared`.

## Channels

All channels are registered in one place, `registerIpc()` in
`apps/desktop/main.js`.

### Terminals (node-pty shells owned by the main process)

| Channel | Direction | Payload → Result |
| --- | --- | --- |
| `terminal:list-backends` | renderer → main (invoke) | `{}` → `{ backends: [{id, name}], defaultId }` |
| `terminal:spawn` | renderer → main (invoke) | `{ ptyId, backendId, cols, rows }` → `{ ok: boolean, error?: string }` |
| `terminal:input` | renderer → main (send) | `{ ptyId, data }` |
| `terminal:resize` | renderer → main (send) | `{ ptyId, cols, rows }` |
| `terminal:kill` | renderer → main (send) | `{ ptyId }` |
| `terminal:data` | main → renderer (event) | pty output |
| `terminal:exit` | main → renderer (event) | exit info |

### Managed services (the python-host FastAPI app)

| Channel | Direction | Payload → Result |
| --- | --- | --- |
| `service:status` | renderer → main (invoke) | `{}` → `ServiceStatus` |
| `service:call` | renderer → main (invoke) | `{ path }` → service response (validated HTTP proxy; paths must start with `/`) |

### Processes, extensions, storage

| Channel | Direction | Payload → Result |
| --- | --- | --- |
| `processes:list` | renderer → main (invoke) | `{}` → `ManagedProcessInfo[]` |
| `extensions:list` | renderer → main (invoke) | `{}` → `ListedExtension[]` (installed runtime extensions from the userData store, with per-page icon URLs resolved) |
| `storage:get` | renderer → main (invoke) | `{ scope, key }` → value |
| `storage:set` | renderer → main (invoke) | `{ scope, key, value }` → ack |
| `storage:delete` | renderer → main (invoke) | `{ scope, key }` → ack |

## Preload bridge surface

`preload.js` exposes these globals to the renderer
(`contextIsolation: true`, `nodeIntegration: false` — this is the only bridge):

```ts
window.versions = {
  node(), chrome(), electron(), platform(),   // runtime info
  ping(),                                     // ipc 'ping' round-trip
}

window.terminals = {
  listBackends(),                             // -> { backends, defaultId }
  spawn({ ptyId, backendId, cols, rows }),    // -> { ok, error? }
  write(ptyId, data),
  resize(ptyId, cols, rows),
  kill(ptyId),
  onData(callback),                           // subscription; returns unsubscribe
  onExit(callback),                           // subscription; returns unsubscribe
}

window.services = {
  status(),                                   // -> ServiceStatus
  call(path),                                 // -> HTTP proxy into python-host
}

window.processes = {
  list(),                                     // -> ManagedProcessInfo[]
}

window.sisyphus = {
  extensions: { list() },                     // -> ListedExtension[]
  storage: {
    get(scope, key),
    set(scope, key, value),
    delete(scope, key),
  },
}
```

Runtime extensions never touch `window.*` storage directly — the loader hands
them `host.storage`, pre-scoped to the extension id (see
[Extensions](Extensions.md#storage-api)).

## Terminal lifecycle

1. `terminal:list-backends` → pick a backend (`apps/desktop/lib/backends.js`
   does shell detection).
2. `terminal:spawn` → main process creates the node-pty shell.
3. Renderer writes via `terminal:input`, resizes via `terminal:resize`,
   subscribes to `terminal:data` / `terminal:exit`, and kills via
   `terminal:kill`.

## Service proxy

The renderer never talks to the python-host service directly. Calls go
`window.services.call(path)` → `service:call` IPC → main-process HTTP proxy
into `127.0.0.1:8765` with path validation. See
[Managed Services](Managed-Services.md).

## DevTools

`main.js` sets no application menu; `F12` is bound in `createWindow()` as the
DevTools toggle.
