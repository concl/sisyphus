const { ipcMain, BrowserWindow } = require('electron')
module.exports = () => ({
  id: 'desktop.transport',
  provide: ['transport.v1'],
  apply(ctx) {
    const methods = new Map()
    ipcMain.handle('sisyphus:call', async (event, { method, input } = {}) => {
      if (
        !BrowserWindow.fromWebContents(event.sender) ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error('Untrusted sender')
      if (typeof method !== 'string' || !methods.has(method))
        throw new Error(`Service unavailable: ${method}`)
      return methods.get(method)(input, event.sender)
    })
    ctx.effect(() => () => ipcMain.removeHandler('sisyphus:call'))
    ctx.provide('transport.v1', {
      handle(method, handler) {
        if (methods.has(method)) throw new Error(`Duplicate method: ${method}`)
        methods.set(method, handler)
        return () => methods.delete(method)
      },
      send(sender, event, value) {
        if (!sender.isDestroyed()) sender.send('sisyphus:event', { event, value })
      },
    })
  },
})
