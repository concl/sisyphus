/**
 * IPC channels between the renderer (via the preload bridge) and the main
 * process. The preload bridge is sandboxed and inlines these strings; keep
 * them in sync with apps/desktop/preload.js.
 */
export const IPC = {
  // terminals (node-pty shells owned by the main process)
  terminalListBackends: 'terminal:list-backends',
  terminalSpawn: 'terminal:spawn',
  terminalInput: 'terminal:input',
  terminalResize: 'terminal:resize',
  terminalKill: 'terminal:kill',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  // managed services (the python-host FastAPI app)
  serviceStatus: 'service:status',
  serviceCall: 'service:call',
  // managed subprocess registry
  processesList: 'processes:list',
  // runtime extensions (store under userData/extensions)
  extensionsList: 'extensions:list',
  // scoped key-value data storage (userData/storage)
  storageGet: 'storage:get',
  storageSet: 'storage:set',
  storageDelete: 'storage:delete',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
