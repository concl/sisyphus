const { BrowserWindow, dialog, shell } = require('electron')
const { Vault } = require('./vault.js')
module.exports = ({ userData }) => ({
  id: 'desktop.notes',
  name: 'Notes',
  inject: ['transport.v1'],
  provide: ['notes.v1'],
  apply(ctx) {
    const transport = ctx.get('transport.v1')
    const vault = new Vault(userData, () => {
      for (const window of BrowserWindow.getAllWindows())
        transport.send(window.webContents, 'notes.changed', {})
    })
    ctx.provide('notes.v1', vault)
    for (const method of [
      'list',
      'read',
      'create',
      'save',
      'append',
      'rename',
      'trash',
      'daily',
      'createFolder',
      'createProject',
    ])
      ctx.effect(() => transport.handle(`notes.${method}`, (input) => vault[method](input)))
    ctx.effect(() =>
      transport.handle('notes.chooseFolder', async () => {
        const result = await dialog.showOpenDialog({
          title: 'Open project folder',
          properties: ['openDirectory'],
        })
        return result.canceled ? null : vault.setFolder(result.filePaths[0])
      }),
    )
    ctx.effect(() => transport.handle('notes.setFolder', ({ folder }) => vault.setFolder(folder)))
    ctx.effect(() =>
      transport.handle('notes.chooseParent', async () => {
        const result = await dialog.showOpenDialog({
          title: 'Project location',
          properties: ['openDirectory', 'createDirectory'],
        })
        return result.canceled ? null : result.filePaths[0]
      }),
    )
    ctx.effect(() =>
      transport.handle('notes.openExternal', async ({ url }) => {
        const target = new URL(url)
        if (!['http:', 'https:'].includes(target.protocol))
          throw new Error('Only HTTP and HTTPS links can be opened')
        await shell.openExternal(target.href)
      }),
    )
    ctx.effect(() =>
      transport.handle('notes.reveal', async () => {
        await vault.ready
        if (!vault.folder) throw new Error('Open a project folder first')
        const error = await shell.openPath(vault.folder)
        if (error) throw new Error(error)
      }),
    )
  },
})
