const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PluginLoader } = require('../lib/plugin-loader')
const { MAX_SOURCE, PluginHost, checkSource } = require('../lib/plugin-host')
const { createPluginTools } = require('../lib/plugin-tools')

/** Stands in for the Cordis profile: it remembers what was mounted, and in order. */
function profile(initial = []) {
  const plugins = new Map(initial.map((id) => [id, { id, state: 'active', enabled: true }]))
  const calls = []
  return {
    calls,
    list: () => [...plugins.values()],
    async add({ id, plugin }) {
      calls.push(`add:${id}`)
      plugins.set(id, { id, plugin, state: 'active', enabled: true })
    },
    async replace(id, plugin) {
      calls.push(`replace:${id}`)
      plugins.set(id, { id, plugin, state: 'active', enabled: true })
    },
    async unmount(id) {
      calls.push(`unmount:${id}`)
      plugins.delete(id)
    },
    get: (id) => plugins.get(id),
  }
}

function setup({ mounted = [] } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-host-'))
  const loader = new PluginLoader(directory)
  loader.ensure()
  const runtime = profile(mounted)
  const host = new PluginHost({ loader, runtime })
  const tools = Object.fromEntries(createPluginTools(host).map((tool) => [tool.name, tool]))
  return { directory, host, runtime, tools }
}

const MAIN = `export default {
  name: 'hello',
  value: () => 'first',
  apply() {},
}
`

test('the agent gets the plugin tools, gated by the access level that already exists', () => {
  const { tools } = setup()
  assert.deepEqual(Object.keys(tools).sort(), [
    'plugin_list',
    'plugin_read',
    'plugin_reload',
    'plugin_remove',
    'plugin_write',
  ])
  assert.equal(tools.plugin_list.access, 'read')
  assert.equal(tools.plugin_read.access, 'read')
  for (const name of ['plugin_write', 'plugin_reload', 'plugin_remove'])
    assert.equal(tools[name].access, 'write', `${name} changes the app`)
  assert.equal(
    tools.plugin_read.inputSchema.parse({ id: 'user.notes' }).target,
    'main',
    'the target defaults to the main process',
  )
  assert.throws(
    () => tools.plugin_write.inputSchema.parse({ id: 'NotAnId', target: 'main', source: 'x' }),
    'a schema rejects an id the loader would reject',
  )
  assert.throws(
    () =>
      tools.plugin_write.inputSchema.parse({ id: 'user.notes', target: 'sideways', source: 'x' }),
    'a schema rejects a target that is not a process',
  )
  assert.throws(
    () =>
      tools.plugin_write.inputSchema.parse({
        id: 'user.notes',
        target: 'main',
        source: 'x'.repeat(MAX_SOURCE + 1),
      }),
    'a schema rejects a file over the size the loader allows',
  )
  assert.throws(() => checkSource('x'.repeat(MAX_SOURCE + 1)), /under 8 MB/)
})

test('a plugin the agent writes is mounted, replaced, and removed', async () => {
  const { host, runtime, tools } = setup()
  const written = await tools.plugin_write.execute({
    id: 'user.notes',
    target: 'main',
    source: MAIN,
  })
  assert.equal(path.basename(written.file), 'user.notes.main.js')
  assert.equal(written.state, 'active')
  assert.equal(written.error, undefined)
  assert.equal(runtime.get('user.notes').plugin.value(), 'first')
  assert.deepEqual(runtime.calls, ['add:user.notes'])

  await tools.plugin_write.execute({
    id: 'user.notes',
    target: 'main',
    source: MAIN.replace('first', 'second'),
  })
  assert.equal(runtime.get('user.notes').plugin.value(), 'second', 'the new code is what runs')
  assert.deepEqual(runtime.calls.slice(1), ['replace:user.notes'])

  const listed = await tools.plugin_list.execute({})
  assert.equal(path.isAbsolute(listed.folder), true)
  assert.deepEqual(
    listed.plugins.map((entry) => `${entry.id}:${entry.target}:${entry.state}`),
    ['user.notes:main:active'],
  )
  assert.match((await tools.plugin_read.execute({ id: 'user.notes' })).source, /second/)

  await tools.plugin_remove.execute({ id: 'user.notes' })
  assert.equal(fs.existsSync(path.join(host.loader.directory, 'user.notes.main.js')), false)
  assert.equal(runtime.get('user.notes'), undefined)
  assert.equal((await tools.plugin_list.execute({})).plugins.length, 0)
})

test('a renderer file is written for the window, and the main process leaves it alone', async () => {
  const { runtime, tools } = setup()
  const result = await tools.plugin_write.execute({
    id: 'user.panel',
    target: 'renderer',
    source: "sisyphus.define({ id: 'user.panel', plugin: { apply() {} } })",
  })
  assert.deepEqual(runtime.calls, [], 'the main process does not mount renderer files')
  assert.equal(result.mounted, 'the window mounts a renderer file when it is written or reloaded')
  assert.deepEqual(
    (await tools.plugin_list.execute({})).plugins.map((entry) => `${entry.id}:${entry.target}`),
    ['user.panel:renderer'],
  )
})

test('a broken edit is reported, and the code that works stays mounted', async () => {
  const { runtime, tools } = setup()
  await tools.plugin_write.execute({ id: 'user.notes', target: 'main', source: MAIN })
  const broken = await tools.plugin_write.execute({
    id: 'user.notes',
    target: 'main',
    source: 'export default { name:',
  })
  assert.match(broken.error, /could not be loaded/)
  assert.equal(
    runtime.get('user.notes').plugin.value(),
    'first',
    'a half-saved file is normal, and it does not take the app down with it',
  )
  assert.match((await tools.plugin_list.execute({})).plugins[0].error, /could not be loaded/)
  assert.deepEqual(runtime.calls, ['add:user.notes'], 'the working code is never unmounted')
})

test('a file that changed outside the app waits until it is reloaded', async () => {
  const { directory, host, runtime, tools } = setup()
  const file = path.join(directory, 'user.notes.main.js')
  // A file that arrived the way a synced one does: written by something else.
  fs.writeFileSync(file, MAIN)
  await tools.plugin_reload.execute({})
  assert.equal(runtime.get('user.notes').plugin.value(), 'first')

  fs.writeFileSync(file, MAIN.replace('first', 'synced'))
  // What the folder watcher does: look again. Noticing is not applying, so the
  // code that works is still the code that runs and the file is reported pending.
  await host.sync()
  assert.equal(runtime.get('user.notes').plugin.value(), 'first')
  assert.equal((await tools.plugin_list.execute({})).plugins[0].pending, true)
  assert.deepEqual(runtime.calls, ['add:user.notes'], 'nothing was mounted again')

  // The same path the studio's Reload button takes, from the agent's side.
  await tools.plugin_reload.execute({ id: 'user.notes' })
  assert.equal(runtime.get('user.notes').plugin.value(), 'synced')
  assert.deepEqual(runtime.calls, ['add:user.notes', 'replace:user.notes'])
  assert.equal((await tools.plugin_list.execute({})).plugins[0].pending, false)
})

test('reload on save is the opt-in that applies a change by itself', async () => {
  const { directory, host, runtime } = setup()
  const file = path.join(directory, 'user.notes.main.js')
  fs.writeFileSync(file, MAIN)
  await host.sync()
  assert.equal(runtime.get('user.notes').plugin.value(), 'first')

  host.reloadOnSave = true
  fs.writeFileSync(file, MAIN.replace('first', 'edited'))
  await host.sync()
  assert.equal(runtime.get('user.notes').plugin.value(), 'edited')
  assert.equal(host.catalog().plugins[0].pending, false)
})

test('a plugin that is already part of the app is not replaced by a file of the same id', async () => {
  const { runtime, tools } = setup({ mounted: ['user.taken'] })
  const result = await tools.plugin_write.execute({
    id: 'user.taken',
    target: 'main',
    source: MAIN,
  })
  assert.match(result.error, /already a plugin of this app/)
  assert.deepEqual(runtime.calls, [], 'nothing was mounted over it')
})

test('closing the host unmounts what the folder added, and stops it coming back', async () => {
  const { host, runtime, tools } = setup()
  await tools.plugin_write.execute({ id: 'user.notes', target: 'main', source: MAIN })
  await host.close()
  assert.equal(runtime.get('user.notes'), undefined)
  assert.deepEqual(runtime.calls, ['add:user.notes', 'unmount:user.notes'])
  await host.sync()
  assert.equal(runtime.get('user.notes'), undefined, 'a closed host mounts nothing')
  assert.equal(host.loader.watcher, null)
})
