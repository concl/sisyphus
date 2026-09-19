'use strict'
// The agent's half of runtime plugin editing. Descriptions are written for the
// model; every call goes through the same PluginHost the studio uses.
//
// These tools run code the model wrote, in this app, with the app's own reach:
// a renderer plugin shares the window and a main-process plugin has Node. The
// access level is the gate that already exists for every other tool (`write` for
// anything that changes the app, `read` for looking), and each call is audited
// in the transcript.
const { z } = require('zod')
const { MAX_SOURCE } = require('./plugin-host')

const ID = z
  .string()
  .regex(
    /^user\.[a-z0-9][a-z0-9-]*$/,
    'plugin ids look like user.name, in lowercase letters, digits, or dashes',
  )
const TARGET = z.enum(['main', 'renderer'])

const TOOLS = [
  {
    name: 'plugin_list',
    access: 'read',
    description:
      'List the plugin files this app has been given, with the process each runs in, its file path, whether it is mounted, and the error of any file that failed to load. A file that changed on disk keeps the code that is already mounted running and is reported with pending: true until plugin_reload mounts it. These plugins are edited with plugin_write and reloaded with plugin_reload.',
    schema: z.object({}).strict(),
    run: (host) => host.catalog(),
  },
  {
    name: 'plugin_read',
    access: 'read',
    description:
      'Read one runtime plugin file, to change it with plugin_write or to explain what it does.',
    schema: z.object({ id: ID, target: TARGET.default('main') }).strict(),
    run: (host, { id, target }) => host.read(id, target),
  },
  {
    name: 'plugin_write',
    access: 'write',
    description:
      'Create or replace a runtime plugin file and mount it in the running app at once, with no rebuild and no restart. The file name is the id: user.<name>.main.js for the main process, user.<name>.renderer.js for the window. A main-process file exports a Cordis plugin (export default { name, inject, apply }); it can add services, agent tools, or plugins.* methods, and it runs with Node access. A renderer file is a plain script with no imports whose only reach is its sisyphus parameter, and it calls sisyphus.define({ id, plugin }) once: sisyphus.react, sisyphus.sdk and sisyphus.icons are available, and ctx.effect must undo whatever it registers. A renderer file is mounted by the window, so its own error appears in Plugin studio rather than here. Anything that changes how the app looks or behaves should undo itself when its plugin is switched off. The app does not mount a change it merely notices: a file edited outside this tool stays on the version that runs until plugin_reload.',
    schema: z
      .object({ id: ID, target: TARGET, source: z.string().min(1).max(MAX_SOURCE) })
      .strict(),
    run: async (host, { id, target, source }) => {
      await host.write(id, target, source)
      const entry = host.catalog().plugins.find((item) => item.id === id && item.target === target)
      return {
        id,
        target,
        file: entry?.file,
        state: entry?.state,
        error: entry?.error,
        mounted: target === 'renderer' ? 'the window mounts a renderer file when it is written or reloaded' : undefined,
      }
    },
  },
  {
    name: 'plugin_reload',
    access: 'write',
    description:
      'Mount runtime plugin files as they are on disk now, all of them or one. This is what applies a change the app only noticed: a file edited outside this app, a repository plugin folder that was synced, or an edit made by hand. A reload disposes what the old code was holding, so a native feature loses its terminals, servers, and runs in flight.',
    schema: z.object({ id: ID.optional() }).strict(),
    run: async (host, { id }) => {
      await host.reload(id)
      const catalog = host.catalog()
      return id
        ? catalog.plugins.filter((item) => item.id === id)
        : catalog.plugins.filter((item) => item.error)
    },
  },
  {
    name: 'plugin_remove',
    access: 'write',
    description:
      'Delete a runtime plugin file and unmount it. Nothing outside the plugins folder is touched, and a plugin that is part of the app itself cannot be removed this way.',
    schema: z.object({ id: ID, target: TARGET.optional() }).strict(),
    run: async (host, { id, target }) => {
      await host.remove(id, target)
      return { removed: id }
    },
  },
]

/** Turns the definitions into agent tools bound to one host. */
const createPluginTools = (host) =>
  TOOLS.map((definition) => ({
    name: definition.name,
    access: definition.access,
    description: definition.description,
    inputSchema: definition.schema,
    execute: (input) => definition.run(host, input),
  }))

module.exports = { TOOLS, createPluginTools }
