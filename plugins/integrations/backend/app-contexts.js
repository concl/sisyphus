const { BrowserWindow, dialog } = require('electron')
const { z } = require('zod')
const { AppContexts } = require('./lib/app-contexts.js')
const { validateFolder } = require('@sisyphus/native/folder')

module.exports = () => ({
  id: 'desktop.app-contexts',
  name: 'App contexts',
  inject: ['transport.v1', 'storage.v1', 'integrations.v1', 'agent.tools.v1'],
  provide: ['app-contexts.v1'],
  apply(ctx) {
    const transport = ctx.get('transport.v1')
    const integrations = ctx.get('integrations.v1')
    const tools = ctx.get('agent.tools.v1')
    const contexts = new AppContexts({ storage: ctx.get('storage.v1'), integrations })
    ctx.provide('app-contexts.v1', contexts)
    const changed = (operation) => (input) => {
      const result = operation(input)
      for (const window of BrowserWindow.getAllWindows())
        transport.send(window.webContents, 'contexts.changed', contexts.list())
      return result
    }

    ctx.effect(() => transport.handle('contexts.list', () => contexts.list()))
    ctx.effect(() => transport.handle('contexts.integrations', () => integrations.list()))
    ctx.effect(() =>
      transport.handle(
        'contexts.save',
        changed((input) => contexts.save(input)),
      ),
    )
    ctx.effect(() =>
      transport.handle(
        'contexts.saveAction',
        changed((input) => contexts.saveAction(input)),
      ),
    )
    ctx.effect(() =>
      transport.handle(
        'contexts.delete',
        changed(({ id, integration }) => contexts.delete(id, integration)),
      ),
    )
    ctx.effect(() =>
      transport.handle('contexts.launch', ({ id, integration }) =>
        contexts.launch(id, integration),
      ),
    )
    ctx.effect(() =>
      transport.handle('contexts.folder.choose', async (_, sender) => {
        const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(sender), {
          title: 'Add a folder to this VS Code workspace',
          properties: ['openDirectory', 'createDirectory'],
        })
        if (result.canceled || !result.filePaths[0]) return { canceled: true }
        return { folder: validateFolder(result.filePaths[0]) }
      }),
    )

    ctx.effect(() =>
      tools.register('list_app_contexts', {
        description: 'List the saved app contexts that can be opened for the user.',
        access: 'read',
        inputSchema: z.object({}).strict(),
        execute: async () =>
          contexts.list().map((item) => ({
            id: item.id,
            name: item.name,
            apps: item.actions.map((action) => action.integration),
          })),
      }),
    )
    ctx.effect(() =>
      tools.register('open_app_context', {
        description:
          'Open a saved VS Code workspace or browser tab set by id. For an older context containing both apps, specify integration to open only that app.',
        access: 'write',
        inputSchema: z
          .object({
            id: z.string().min(1).max(64),
            integration: z.enum(['vscode', 'browser']).optional(),
          })
          .strict(),
        execute: async ({ id, integration }) => {
          const result = await contexts.launch(id, integration)
          return `Opened app context “${result.name}”.`
        },
      }),
    )
  },
})
