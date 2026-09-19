const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('sisyphus', {
  call: (method, input) => ipcRenderer.invoke('sisyphus:call', { method, input }),
  on: (event, listener) => {
    const callback = (_, payload) => {
      if (payload.event === event) listener(payload.value)
    }
    ipcRenderer.on('sisyphus:event', callback)
    return () => ipcRenderer.removeListener('sisyphus:event', callback)
  },
})
