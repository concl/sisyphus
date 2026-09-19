const { dialog, BrowserWindow } = require('electron')
const { FolderDocumentTransport, syncDocument } = require('../lib/planner-sync')

module.exports = () => ({
  id: 'desktop.planner-sync',
  inject: ['transport.v1', 'storage.v1', 'planner.v1'],
  apply(ctx) {
    const transport = ctx.get('transport.v1')
    const storage = ctx.get('storage.v1')
    const planner = ctx.get('planner.v1')
    const scope = 'planner.sync'
    const status = () => ({ folder: storage.get(scope, 'folder') || null })
    ctx.effect(() => transport.handle('planner.sync.status', status))
    ctx.effect(() =>
      transport.handle('planner.sync.chooseFolder', async (_, sender) => {
        const owner = BrowserWindow.fromWebContents(sender)
        const result = await dialog.showOpenDialog(owner, {
          title: 'Choose a folder mirrored by your cloud provider',
          properties: ['openDirectory', 'createDirectory'],
        })
        if (!result.canceled && result.filePaths[0])
          storage.set(scope, 'folder', result.filePaths[0])
        return status()
      }),
    )
    ctx.effect(() =>
      transport.handle('planner.sync.now', async () => {
        const folder = status().folder
        if (!folder) throw new Error('Choose a sync folder first')
        const document = await syncDocument(planner.document(), new FolderDocumentTransport(folder))
        return planner.merge(document)
      }),
    )
  },
})
