const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PluginLoader, parseName } = require('../lib/plugin-loader')

function folder() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-plugins-'))
  const loader = new PluginLoader(directory)
  loader.ensure()
  return { directory, loader }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('plugin file names decide the id and the process', () => {
  assert.deepEqual(parseName('user.notes.main.js'), {
    id: 'user.notes',
    target: 'main',
    format: 'esm',
    label: 'main process',
  })
  assert.equal(parseName('user.notes.renderer.js').target, 'renderer')
  assert.equal(parseName('user.legacy.main.cjs').format, 'cjs')
  assert.equal(parseName('notes.js'), null, 'a file without the user. prefix is not a plugin')
  assert.equal(parseName('package.json'), null)
  assert.match(parseName('user.Big.main.js').error, /<namespace>\.<name>/)
})

test('the folder is scanned for plugins, and bad names are reported rather than loaded', () => {
  const { directory, loader } = folder()
  fs.writeFileSync(path.join(directory, 'user.zed.main.js'), 'export default { apply() {} }\n')
  fs.writeFileSync(path.join(directory, 'user.alpha.renderer.js'), 'sisyphus.define({})\n')
  fs.writeFileSync(path.join(directory, 'user.Bad.main.js'), 'export default { apply() {} }\n')
  fs.writeFileSync(path.join(directory, 'user.alpha.main.cjs'), 'module.exports = { apply() {} }\n')
  fs.writeFileSync(path.join(directory, 'user.alpha.main.js'), 'export default { apply() {} }\n')
  fs.writeFileSync(path.join(directory, 'notes.txt'), 'irrelevant\n')

  const entries = loader.scan()
  assert.deepEqual(
    entries.map((entry) => `${entry.id}:${entry.target}`).sort(),
    [
      'user.Bad.main.js:null',
      'user.alpha:main',
      'user.alpha:null',
      'user.alpha:renderer',
      'user.zed:main',
    ],
    'one entry per plugin file, with unusable names kept so they can be explained',
  )
  const ids = entries.map((entry) => entry.id)
  assert.deepEqual(
    ids,
    [...ids].sort((a, b) => a.localeCompare(b)),
    'the list is sorted by id',
  )
  assert.match(
    entries.find((entry) => entry.id === 'user.Bad.main.js').error,
    /<namespace>\.<name>/,
  )
  assert.equal(
    entries.filter((entry) => entry.id === 'user.alpha' && entry.target === 'main').length,
    1,
    'two files may not claim one id and process',
  )
  assert.match(
    entries.find((entry) => entry.target === null && entry.id === 'user.alpha').error,
    /claimed twice/,
  )
  assert.equal(
    entries.some((entry) => entry.id === 'notes.txt'),
    false,
  )
})

test('a plugin is read with the stylesheet beside it, or it mounts unstyled', () => {
  const { PluginHost } = require('../lib/plugin-host')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-styled-'))
  fs.writeFileSync(path.join(dir, 'feature.notes.renderer.js'), 'code')
  fs.writeFileSync(path.join(dir, 'feature.notes.renderer.css'), '.notes { color: red }')
  const manifest = {
    plugins: [
      {
        id: 'feature.notes',
        order: 1,
        export: 'notesPlugin',
        needs: [],
        js: 'feature.notes.renderer.js',
        css: 'feature.notes.renderer.css',
        files: [],
      },
    ],
  }
  const host = new PluginHost({
    loader: new PluginLoader(dir, { manifest }),
    runtime: null,
  })
  const read = host.read('feature.notes', 'renderer')
  assert.equal(read.source, 'code')
  assert.equal(read.css, '.notes { color: red }')
  const entry = host.catalog().plugins.find((item) => item.id === 'feature.notes')
  assert.equal(entry.shipped, true)
  assert.equal(entry.order, 1)
  assert.equal(entry.export, 'notesPlugin')
})

test('a plugin file is loaded, and editing it loads the new code', async () => {
  const { directory, loader } = folder()
  const source = (answer) => `export default {
  name: 'one',
  value: () => '${answer}',
  apply() {},
}
`
  fs.writeFileSync(path.join(directory, 'user.one.main.js'), source('first'))
  const first = await loader.load('user.one')
  assert.equal(first.id, 'user.one')
  assert.equal(first.value(), 'first')

  fs.writeFileSync(path.join(directory, 'user.one.main.js'), source('second'))
  const second = await loader.load('user.one')
  assert.equal(second.value(), 'second', 'the module cache does not serve the old code')
  assert.notEqual(first, second)
})

test('a plugin the user wrote can be mounted, edited, and replaced while the app runs', async () => {
  const { Profile } = await import('@sisyphus/profile')
  const { directory, loader } = folder()
  const file = path.join(directory, 'user.notes.main.js')
  const source = (count) => `export default {
  name: 'Notes',
  provide: 'notes.v1',
  apply(ctx) {
    ctx.provide('notes.v1', { count: () => ${count} })
  },
}
`
  fs.writeFileSync(file, source(1))
  const profile = new Profile()
  const loaded = await loader.load('user.notes')
  await profile.add({ id: loaded.id, plugin: loaded })
  assert.equal(profile.get('notes.v1').count(), 1)
  assert.equal(profile.list()[0].state, 'active')

  fs.writeFileSync(file, source(2))
  await profile.replace('user.notes', await loader.load('user.notes'))
  assert.equal(profile.get('notes.v1').count(), 2, 'the new code is what runs')

  fs.rmSync(file)
  await profile.unmount('user.notes')
  assert.equal(profile.list().length, 0)
  await profile.dispose()
})

test('a broken file is reported, and the other files still load', async () => {
  const { directory, loader } = folder()
  fs.writeFileSync(path.join(directory, 'user.broken.main.js'), 'export default { name: }\n')
  fs.writeFileSync(path.join(directory, 'user.odd.main.js'), "export default { name: 'odd' }\n")
  fs.writeFileSync(
    path.join(directory, 'user.wrong.main.js'),
    "export default { id: 'user.other', apply() {} }\n",
  )
  fs.writeFileSync(path.join(directory, 'user.text.main.js'), "export default 'not a plugin'\n")
  const byId = Object.fromEntries(
    (await loader.loadAll('main')).map((result) => [result.id, result]),
  )
  assert.match(byId['user.broken'].error, /could not be loaded/)
  assert.match(byId['user.odd'].error, /apply\(context\)/)
  assert.match(byId['user.wrong'].error, /the file name is the id/)
  assert.match(byId['user.text'].error, /plugin object or a function/)

  fs.writeFileSync(
    path.join(directory, 'user.legacy.main.cjs'),
    'module.exports = { apply() {} }\n',
  )
  const again = await loader.loadAll('main')
  assert.equal(again.find((result) => result.id === 'user.legacy').plugin.id, 'user.legacy')
  assert.equal((await loader.loadAll('renderer')).length, 0, 'each process loads its own files')
  await assert.rejects(() => loader.load('user.missing'), /Unknown plugin: user\.missing/)
})

test('creating, writing, and removing a plugin file', async () => {
  const { directory, loader } = folder()
  const created = loader.create('user.hello', 'main')
  assert.equal(path.basename(created.file), 'user.hello.main.js')
  assert.throws(() => loader.create('user.hello', 'main'), /already exists/)
  const exported = await loader.load('user.hello')
  assert.equal(exported.name, 'user.hello')
  assert.equal(typeof exported.apply, 'function', 'the example that is created actually loads')

  loader.create('user.hello-panel', 'renderer')
  const panel = loader.read('user.hello-panel', 'renderer')
  assert.match(panel.source, /sisyphus\.define\(/)
  assert.equal(
    (await loader.loadAll('main')).some((result) => result.id === 'user.hello-panel'),
    false,
  )

  loader.write('user.hello', 'main', "export default { name: 'hello', apply() {} }\n")
  assert.equal((await loader.load('user.hello')).name, 'hello')
  assert.throws(() => loader.write('user.hello', 'main', '   '), /needs some code/)
  assert.throws(() => loader.write('NotAnId', 'main', 'x'), /feature\.chat or user\.notes/)

  loader.remove('user.hello', 'main')
  assert.equal(
    loader.scan().some((entry) => entry.id === 'user.hello'),
    false,
  )
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')),
    [],
    'writes leave no temporary file behind',
  )
})

test('the folder watcher reports a save once, and stops when asked', async () => {
  const { directory, loader } = folder()
  let saves = 0
  const watching = loader.watch(() => {
    saves += 1
  })
  fs.writeFileSync(path.join(directory, 'user.late.main.js'), 'export default { apply() {} }\n')
  // Some filesystems deliver no directory events (network folders, some
  // containers). Nothing depends on the watcher: Reload is always available.
  const deadline = Date.now() + 5000
  while (watching && saves === 0 && Date.now() < deadline) await sleep(50)
  assert.equal(saves <= 1, true, 'a burst of events is reported once')
  assert.equal((await loader.loadAll('main')).length, 1, 'the new file loads either way')

  loader.stop()
  const settled = saves
  fs.writeFileSync(path.join(directory, 'user.later.main.js'), 'export default { apply() {} }\n')
  await sleep(500)
  assert.equal(saves, settled, 'a stopped watcher is silent')
})
