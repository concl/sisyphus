const { safeStorage, BrowserWindow, dialog } = require('electron')
const path = require('node:path')
const { ChatConfig, EncryptedKeyStore } = require('./lib/chat-config.js')
const { ChatHistory } = require('./lib/chat-history.js')
const { WorkerChat } = require('./worker-client')
const { validateFolder } = require('@sisyphus/native/folder')

module.exports = ({ userData }) => ({
  id: 'desktop.chat',
  name: 'Chat agent',
  inject: ['transport.v1', 'storage.v1', 'agent.tools.v1', 'runtime.workers.v1'],
  provide: ['chat.v1'],
  apply(ctx) {
    const transport = ctx.get('transport.v1')
    const registry = ctx.get('agent.tools.v1')
    const storage = ctx.get('storage.v1')
    const config = new ChatConfig(
      storage,
      new EncryptedKeyStore(path.join(userData, 'secrets', 'llm-key.enc'), safeStorage),
    )
    // One file per conversation, under userData/storage/chat.threads. The
    // directory is the only index, so there is nothing to keep in sync.
    const history = new ChatHistory(path.join(userData, 'storage', 'chat.threads'))
    // Conversations from the older single-file store are imported once. The
    // marker is only written when every file was written, so a partial import is
    // retried instead of silently losing conversations.
    if (!storage.get('chat.history', 'threads.imported.v1')) {
      const legacy = storage.get('chat.history', 'threads.v1')
      const report = history.import(Array.isArray(legacy) ? legacy : [])
      if (!report.failed.length)
        storage.set('chat.history', 'threads.imported.v1', {
          at: new Date().toISOString(),
          imported: report.imported.length,
          skipped: report.skipped.length,
        })
    }
    const chat = new WorkerChat({ directory: history.directory, config, registry,
      workers: ctx.get('runtime.workers.v1') })
    ctx.provide('chat.v1', chat)
    ctx.effect(() => () => chat.dispose())
    ctx.effect(() => transport.handle('chat.config.get', () => config.get()))
    ctx.effect(() =>
      transport.handle('chat.config.save', (input) => {
        const saved = config.save(input)
        for (const window of BrowserWindow.getAllWindows())
          transport.send(window.webContents, 'chat.config.changed', saved)
        return saved
      }),
    )
    ctx.effect(() =>
      transport.handle('chat.tools', () =>
        registry.list().map(({ name, description, access }) => ({ name, description, access })),
      ),
    )
    ctx.effect(() => transport.handle('chat.list', () => chat.list()))
    ctx.effect(() => transport.handle('chat.get', ({ id }) => chat.get(id)))
    ctx.effect(() => transport.handle('chat.delete', ({ id }) => chat.delete(id)))
    ctx.effect(() =>
      transport.handle('chat.setFolder', ({ id, folder }) => chat.setFolder(id, folder)),
    )
    // A conversation has no folder until one is attached to it. Only the
    // picker's start location is remembered, so choosing a folder for one chat
    // never binds it to the next.
    const scope = 'chat.folder'
    const startFolder = () => {
      const stored = storage.get(scope, 'last.v1')
      try {
        return stored ? validateFolder(stored) : undefined
      } catch {
        return undefined
      }
    }
    ctx.effect(() =>
      transport.handle('chat.folder.choose', async (_, sender) => {
        const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(sender), {
          title: 'Choose the folder for this conversation',
          defaultPath: startFolder(),
          properties: ['openDirectory', 'createDirectory'],
        })
        if (result.canceled || !result.filePaths[0]) return { folder: null, canceled: true }
        const folder = validateFolder(result.filePaths[0])
        storage.set(scope, 'last.v1', folder)
        return { folder }
      }),
    )
    ctx.effect(() =>
      transport.handle('chat.cancel', ({ runId }, sender) => chat.cancel(runId, sender.id)),
    )
    // Sending and editing stream the same way; editing answers the parent of the
    // edited message, so the new attempt becomes a branch beside the original.
    const start = (method) =>
      transport.handle(method, async (input, sender) => {
        const owner = sender.id
        const cancel = () => chat.cancel(input.runId, owner)
        sender.once('destroyed', cancel)
        try {
          return await chat[method === 'chat.edit' ? 'edit' : 'send'](input, owner, (event) =>
            transport.send(sender, 'chat.event', { ...event, runId: input.runId }),
          )
        } finally {
          sender.removeListener('destroyed', cancel)
        }
      })
    ctx.effect(() => start('chat.send'))
    ctx.effect(() => start('chat.edit'))
    // Chooses which branch of a conversation is on screen.
    ctx.effect(() =>
      transport.handle('chat.branch', ({ conversationId, messageId }) =>
        chat.selectBranch({ conversationId, messageId }),
      ),
    )
  },
})
