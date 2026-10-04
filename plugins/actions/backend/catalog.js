const { BrowserWindow } = require('electron')
const { ActionServices } = require('./lib/catalog.js')
module.exports = () => ({
  id: 'desktop.action-catalog',
  name: 'Action catalog',
  inject: ['transport.v1'],
  provide: ['actions.v1'],
  apply(ctx) {
    const actions = new ActionServices()
    const transport = ctx.get('transport.v1')
    ctx.provide('actions.v1', actions)
    ctx.effect(() => () => actions.dispose())
    ctx.effect(() =>
      actions.subscribe((types) => {
        for (const window of BrowserWindow.getAllWindows())
          if (!window.isDestroyed()) transport.send(window.webContents, 'actions.changed', types)
      }),
    )
    ctx.effect(() => transport.handle('actions.list', () => actions.list()))
  },
})
