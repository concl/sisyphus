// preload.js
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
  platform: () => process.platform,
  ping: () => ipcRenderer.invoke('ping'),
})

// Terminal bridge: renderer <-> main process (which owns the node-pty shells).
contextBridge.exposeInMainWorld('terminals', {
  // -> { backends: [{id,name}], defaultId }
  listBackends: () => ipcRenderer.invoke('terminal:list-backends'),
  // -> { ok: boolean, error?: string }
  spawn: ({ ptyId, backendId, cols, rows }) =>
    ipcRenderer.invoke('terminal:spawn', { ptyId, backendId, cols, rows }),
  write: (ptyId, data) => ipcRenderer.send('terminal:input', { ptyId, data }),
  resize: (ptyId, cols, rows) => ipcRenderer.send('terminal:resize', { ptyId, cols, rows }),
  kill: (ptyId) => ipcRenderer.send('terminal:kill', { ptyId }),
  // Subscriptions; each returns an unsubscribe function.
  onData: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onExit: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },
})

// Managed-services bridge: the python-host FastAPI app, owned by the main
// process. `call` proxies a path to the service's HTTP API.
contextBridge.exposeInMainWorld('services', {
  status: () => ipcRenderer.invoke('service:status'),
  call: (path) => ipcRenderer.invoke('service:call', { path }),
})

// Managed subprocess registry (services + terminal shells).
contextBridge.exposeInMainWorld('processes', {
  list: () => ipcRenderer.invoke('processes:list'),
})

// Runtime extensions: installed extensions from the userData store. Their
// entry modules are served to the renderer over the sisyphus-ext:// protocol.
contextBridge.exposeInMainWorld('sisyphus', {
  extensions: {
    list: () => ipcRenderer.invoke('extensions:list'),
  },
  // Scoped key-value data storage (userData/storage/<scope>.json). Both the
  // app (scope 'app') and extensions (scope = extension id) use this.
  storage: {
    get: (scope, key) => ipcRenderer.invoke('storage:get', { scope, key }),
    set: (scope, key, value) => ipcRenderer.invoke('storage:set', { scope, key, value }),
    delete: (scope, key) => ipcRenderer.invoke('storage:delete', { scope, key }),
  },
})
