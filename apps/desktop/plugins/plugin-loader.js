const { BrowserWindow, shell } = require('electron')
const { PluginHost, checkId, checkSource, checkTarget } = require('../lib/plugin-host')
const { createPluginTools } = require('../lib/plugin-tools')

const WATCH_SCOPE = 'plugins'
const WATCH_KEY = 'plugins.watch.v1'

/**
 * Plugin files in the user's plugins folder, mounted into the running profile.
 *
 * A plugin that fails to load never replaces the one that works: the error is
 * reported and the previous code stays mounted until the file loads again. That
 * matters most when "reload on save" is on, because a half-saved edit is normal.
 *
 * Both directions of editing use one engine: Plugin studio's `plugins.*`
 * methods and the agent's `plugin_*` tools call the same PluginHost, so what the
 * model writes is mounted, reported, and reloaded like anything typed by hand.
 */
module.exports = ({ runtime, loader, artifacts, loaded }) => {
  const host = new PluginHost({ loader, artifacts, runtime })
  for (const entry of loader.scan()) {
    const initial = loaded.find(item => item.id === entry.id && item.plugin)
    if (initial) host.mounted.set(entry.id, { mtime: entry.mtime, plugin: initial.plugin })
  }
  return ({
  id: 'desktop.plugin-loader',
  inject: ['transport.v1', 'storage.v1', 'agent.tools.v1'],
  apply(ctx) {
    const transport = ctx.get('transport.v1')
    const store = ctx.get('storage.v1')
    const registry = ctx.get('agent.tools.v1')
    host.watching = store.get(WATCH_SCOPE, WATCH_KEY) !== false

    const broadcast = () => {
      const value = host.catalog()
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) transport.send(window.webContents, 'plugins.changed', value)
      }
    }

    const run = async (work) => {
      await work()
      broadcast()
      return host.catalog()
    }

    const follow = () => {
      if (!host.watching) return
      loader.watch(
        () =>
          void host
            .sync()
            .then(broadcast)
            .catch(() => {}),
      )
    }

    loader.ensure()
    // A shipped plugin becomes the user's own file the first time the app runs:
    // from here on it is read, watched, reloaded, and edited like one they wrote,
    // and an edit survives the next start.
    try {
      artifacts.seed()
    } catch (error) {
      console.error('Could not seed the shipped plugins:', error)
    }
    // Switching this plugin off has to unmount what it added and stop watching.
    ctx.effect(() => () => loader.stop())

    ctx.effect(() => transport.handle('plugins.catalog', () => host.catalog()))
    ctx.effect(() => transport.handle('plugins.render', ({ id }) => loader.render(checkId(id))))
    ctx.effect(() =>
      transport.handle('plugins.read', ({ id: plugin, target: kind }) =>
        host.read(checkId(plugin), checkTarget(kind ?? 'main')),
      ),
    )
    ctx.effect(() =>
      transport.handle('plugins.write', ({ id: plugin, target: kind, source }) =>
        run(() => host.write(checkId(plugin), checkTarget(kind), checkSource(source))),
      ),
    )
    ctx.effect(() =>
      transport.handle('plugins.create', ({ id: plugin, target: kind }) =>
        run(() => host.create(checkId(plugin), checkTarget(kind))),
      ),
    )
    ctx.effect(() =>
      transport.handle('plugins.remove', ({ id: plugin, target: kind }) =>
        run(() => host.remove(checkId(plugin), kind ? checkTarget(kind) : undefined)),
      ),
    )
    ctx.effect(() =>
      transport.handle('plugins.reload', ({ id: plugin } = {}) =>
        run(() => host.reload(plugin ? checkId(plugin) : undefined)),
      ),
    )
    ctx.effect(() =>
      transport.handle('plugins.restore', ({ id: plugin, target: kind }) =>
        run(() => host.restore(checkId(plugin), checkTarget(kind ?? 'renderer'))),
      ),
    )
    ctx.effect(() =>
      transport.handle('plugins.watch', ({ watching: next }) =>
        run(async () => {
          if (typeof next !== 'boolean') throw new Error('Expected watching boolean')
          host.watching = next
          store.set(WATCH_SCOPE, WATCH_KEY, next)
          loader.stop()
          follow()
        }),
      ),
    )
    ctx.effect(() =>
      transport.handle('plugins.reveal', async ({ id: plugin, target: kind } = {}) => {
        if (plugin && kind) {
          const entry = loader.entry(checkId(plugin), checkTarget(kind))
          if (entry) {
            shell.showItemInFolder(entry.file)
            return
          }
        }
        const error = await shell.openPath(loader.directory)
        if (error) throw new Error(error)
      }),
    )

    for (const definition of createPluginTools(host)) {
      ctx.effect(() =>
        registry.register(definition.name, {
          description: definition.description,
          access: definition.access,
          inputSchema: definition.inputSchema,
          execute: async (input) => {
            try {
              return await definition.execute(input)
            } finally {
              // A plugin written by the agent has to appear in the studio the
              // same way a plugin edited there does, errors included.
              broadcast()
            }
          },
        }),
      )
    }

    // Mount what is already on disk, then keep watching it if the user wants that.
    void host
      .sync()
      .then(() => {
        follow()
        broadcast()
      })
      .catch(() => {})
  },
})
}
