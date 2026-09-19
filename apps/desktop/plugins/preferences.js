const { BrowserWindow, nativeTheme, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

module.exports = ({ userData }) => ({
  id: 'desktop.preferences',
  inject: ['transport.v1', 'storage.v1'],
  provide: ['preferences.v1'],
  apply(ctx) {
    const storage = ctx.get('storage.v1')
    const transport = ctx.get('transport.v1')
    const themes = ['system', 'light', 'dark']
    const saved = storage.get('preferences', 'theme')
    nativeTheme.themeSource = themes.includes(saved) ? saved : 'system'
    const snapshot = () => ({
      theme: nativeTheme.themeSource,
      dark: nativeTheme.shouldUseDarkColors,
      platform: process.platform,
    })
    const broadcast = () => {
      for (const window of BrowserWindow.getAllWindows())
        transport.send(window.webContents, 'appearance.changed', snapshot())
    }
    nativeTheme.on('updated', broadcast)
    ctx.effect(() => () => nativeTheme.removeListener('updated', broadcast))
    const preferences = {
      get: snapshot,
      setTheme(theme) {
        if (!themes.includes(theme)) throw new Error('Unknown theme')
        storage.set('preferences', 'theme', theme)
        nativeTheme.themeSource = theme
        broadcast()
        return snapshot()
      },
    }
    const locations = () =>
      [
        {
          id: 'all',
          title: 'All local app data',
          description: 'The app data root, including browser cache and local settings.',
          path: userData,
          directory: true,
        },
        {
          id: 'workspace',
          title: 'Workspace layouts',
          description: 'Current panel arrangement and named layouts.',
          path: path.join(userData, 'storage', 'ui.workspace.json'),
        },
        {
          id: 'planner',
          title: 'Planner',
          description: 'To-dos, events, and deletion records used by sync.',
          path: path.join(userData, 'storage', 'planner.json'),
        },
        {
          id: 'sync',
          title: 'Sync configuration',
          description: 'The location of your chosen cloud-mirrored folder.',
          path: path.join(userData, 'storage', 'planner.sync.json'),
        },
        {
          id: 'preferences',
          title: 'Appearance',
          description: 'System, light, or dark theme preference.',
          path: path.join(userData, 'storage', 'preferences.json'),
        },
        {
          id: 'chat',
          title: 'Chat history',
          description: 'Conversations, messages, and tool activity. Stored on this device.',
          path: path.join(userData, 'storage', 'chat.history.json'),
        },
        {
          id: 'provider',
          title: 'Chat configuration',
          description: 'Provider URL, model, system prompt, and app-data permissions.',
          path: path.join(userData, 'storage', 'chat.config.json'),
        },
        {
          id: 'secrets',
          title: 'Encrypted credentials',
          description: 'API key encrypted with this operating system’s credential protection.',
          path: path.join(userData, 'secrets'),
          directory: true,
        },
      ].map((entry) => ({ ...entry, exists: fs.existsSync(entry.path) }))
    ctx.provide('preferences.v1', preferences)
    ctx.effect(() => transport.handle('appearance.get', snapshot))
    ctx.effect(() => transport.handle('appearance.set', ({ theme }) => preferences.setTheme(theme)))
    ctx.effect(() => transport.handle('data.locations', locations))
    ctx.effect(() =>
      transport.handle('data.open', async ({ id }) => {
        const location = locations().find((entry) => entry.id === id)
        if (!location) throw new Error('Unknown data location')
        if (location.directory || !location.exists) {
          const directory = location.directory ? location.path : path.dirname(location.path)
          fs.mkdirSync(directory, { recursive: true })
          const error = await shell.openPath(directory)
          if (error) throw new Error(error)
        } else shell.showItemInFolder(location.path)
      }),
    )
  },
})
