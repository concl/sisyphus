const { contextBridge, ipcRenderer, webUtils } = require('electron')
contextBridge.exposeInMainWorld('sisyphus', {
  call: (method, input) => ipcRenderer.invoke('sisyphus:call', { method, input }),
  dropFiles: (files, folder) =>
    ipcRenderer.invoke('sisyphus:call', {
      method: 'files.resolveDrop',
      input: {
        paths: Array.from(files, (file) => webUtils.getPathForFile(file)).filter(Boolean),
        folder,
      },
    }),
  on: (event, listener) => {
    const callback = (_, payload) => {
      if (payload.event === event) listener(payload.value)
    }
    ipcRenderer.on('sisyphus:event', callback)
    return () => ipcRenderer.removeListener('sisyphus:event', callback)
  },
})
