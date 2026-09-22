const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PluginLoader } = require('../lib/plugin-loader')
const { PluginHost } = require('../lib/plugin-host')

test('frontend/backend packages compose dynamically and reload each side independently', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-topology-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const { Profile } = await import('@sisyphus/profile')
  const runtime = new Profile()
  const loader = new PluginLoader(directory)
  const host = new PluginHost({ loader, runtime, watching: false })
  t.after(async () => { await host.close(); await runtime.dispose() })
  await host.sync()

  const folder = path.join(directory, 'notes')
  fs.mkdirSync(path.join(folder, 'frontend'), { recursive: true })
  fs.mkdirSync(path.join(folder, 'backend'))
  const manifest = { sisyphus: {
    frontend: { id: 'feature.notes', entry: './frontend/index.ts', export: 'plugin' },
    backend: [{ id: 'desktop.notes', entry: './backend/index.cjs' }],
  } }
  const write = (file, text) => fs.writeFileSync(path.join(folder, file), text)
  write('package.json', JSON.stringify(manifest))
  write('frontend/index.ts', "import './style.css'; export const plugin = { apply() {} }")
  write('frontend/style.css', 'button { color: blue; }')
  write('backend/index.cjs', "module.exports = { provide: ['notes'], apply(ctx) { ctx.provide('notes', require('./value.cjs')) } }")
  write('backend/value.cjs', 'module.exports = 1')
  await host.reload()
  assert.equal(runtime.get('notes'), 1, 'a new package mounts without host edits')
  const backendStamp = loader.entry('desktop.notes').mtime
  const initialFrontendStamp = loader.entry('feature.notes', 'renderer').mtime

  write('frontend/style.css', 'button { color: rebeccapurple; }')
  await host.sync()
  assert.equal(loader.entry('desktop.notes').mtime, backendStamp, 'UI edits do not restart backend resources')
  assert.notEqual(loader.entry('feature.notes', 'renderer').mtime, initialFrontendStamp, 'the window receives a changed frontend version')
  await host.reload('feature.notes')
  assert.match(loader.render('feature.notes').css, /rebeccapurple/)
  const frontendStamp = loader.entry('feature.notes', 'renderer').mtime

  write('backend/value.cjs', 'module.exports = 200')
  await host.sync()
  assert.equal(runtime.get('notes'), 1, 'backend saves wait for explicit reload')
  assert.equal(loader.entry('feature.notes', 'renderer').mtime, frontendStamp)
  await host.reload('desktop.notes')
  assert.equal(runtime.get('notes'), 200)
  write('backend/value.cjs', 'module.exports = ;')
  await host.reload('desktop.notes')
  assert.equal(runtime.get('notes'), 200, 'a compile error retains the working service')
  write('backend/index.cjs', "module.exports = { apply() { throw new Error('broken activation') } }")
  await host.reload('desktop.notes')
  assert.equal(runtime.get('notes'), 200, 'an activation error rolls back to the working service')

  loader.remove('feature.notes', 'renderer')
  assert.equal(loader.entry('feature.notes', 'renderer'), undefined)
  assert.ok(loader.entry('desktop.notes'), 'removing the frontend retains the backend')
  loader.remove('desktop.notes', 'main')
  await host.reload()
  assert.throws(() => runtime.get('notes'), /Service unavailable/)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'package.json'))).sisyphus.backend, [])
})

test('invalid frontend/backend manifests retain known entries until repaired', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-manifest-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const folder = path.join(directory, 'notes')
  fs.mkdirSync(folder)
  const file = path.join(folder, 'package.json')
  const manifest = { sisyphus: { backend: [{ id: 'desktop.notes', entry: './index.cjs' }] } }
  fs.writeFileSync(file, JSON.stringify(manifest))
  const loader = new PluginLoader(directory)
  assert.equal(loader.scan()[0].id, 'desktop.notes')
  manifest.sisyphus.backend = 'broken'
  fs.writeFileSync(file, JSON.stringify(manifest))
  assert.equal(loader.scan()[0].id, 'desktop.notes')
  assert.match(loader.scan()[0].error, /must be an array/)
})

test('editable source packages reload imported modules and styles, and retain working code on errors', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'source-plugin-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const folder = path.join(directory, 'notes')
  fs.mkdirSync(folder)
  const manifest = { sisyphus: { id: 'feature.notes', entry: './view.ts', export: 'plugin',
    native: [{ id: 'desktop.notes', entry: './native.cjs' }] } }
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify(manifest))
  fs.writeFileSync(path.join(folder, 'view.ts'), "import './style.css'; export const plugin = { apply() {} }")
  fs.writeFileSync(path.join(folder, 'style.css'), 'button { color: blue; }')
  fs.writeFileSync(path.join(folder, 'native.cjs'), "const value = require('./value.cjs'); module.exports = () => ({ provide: ['notes'], apply(ctx) { ctx.provide('notes', value) } })")
  fs.writeFileSync(path.join(folder, 'value.cjs'), 'module.exports = 1')
  const { Profile } = await import('@sisyphus/profile')
  const runtime = new Profile()
  const loader = new PluginLoader(directory)
  const host = new PluginHost({ loader, runtime, watching: false })
  t.after(async () => { await host.close(); await runtime.dispose() })
  await host.sync()
  assert.equal(runtime.get('notes'), 1)
  assert.match(loader.read('feature.notes', 'renderer').source, /export const plugin/)
  assert.match(loader.render('feature.notes').source, /SisyphusRuntime.register/)
  assert.match(loader.render('feature.notes').css, /blue/)

  fs.writeFileSync(path.join(folder, 'value.cjs'), 'module.exports = 200')
  fs.writeFileSync(path.join(folder, 'style.css'), 'button { color: red; }')
  await host.reload()
  assert.equal(runtime.get('notes'), 200, 'local imports are re-evaluated')
  assert.match(loader.render('feature.notes').css, /red/)

  fs.writeFileSync(path.join(folder, 'value.cjs'), 'module.exports = ;')
  await host.reload('desktop.notes')
  assert.equal(runtime.get('notes'), 200)
  assert.match(host.catalog().plugins.find(entry => entry.id === 'desktop.notes').error, /Build failed/)
  fs.writeFileSync(path.join(folder, 'package.json'), '{ half saved')
  await host.sync()
  assert.equal(runtime.get('notes'), 200, 'an invalid manifest must not unmount the working package')
})

test('a source package that changed on disk waits for a reload, and says so', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'source-plugin-pending-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const folder = path.join(directory, 'notes')
  fs.mkdirSync(folder)
  const manifest = { sisyphus: { id: 'feature.notes', entry: './view.ts', export: 'plugin',
    native: [{ id: 'desktop.notes', entry: './native.cjs' }] } }
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify(manifest))
  fs.writeFileSync(path.join(folder, 'view.ts'), 'export const plugin = { apply() {} }')
  const native = (value) => `module.exports = () => ({ provide: ['notes'], apply(ctx) { ctx.provide('notes', '${value}') } })`
  fs.writeFileSync(path.join(folder, 'native.cjs'), native('first'))
  const { Profile } = await import('@sisyphus/profile')
  const runtime = new Profile()
  const loader = new PluginLoader(directory)
  const host = new PluginHost({ loader, runtime, watching: false })
  t.after(async () => { await host.close(); await runtime.dispose() })
  await host.sync()
  assert.equal(runtime.get('notes'), 'first')

  // A save outside the app, seen the way the watcher sees it: the catalog knows,
  // and the version that works goes on running.
  fs.writeFileSync(path.join(folder, 'native.cjs'), native('second'))
  await host.sync()
  assert.equal(runtime.get('notes'), 'first', 'a noticed change is not an applied one')
  assert.equal(host.catalog().plugins.find(entry => entry.id === 'desktop.notes').pending, true)

  await host.reload('desktop.notes')
  assert.equal(runtime.get('notes'), 'second')
  assert.equal(host.catalog().plugins.find(entry => entry.id === 'desktop.notes').pending, false)

  // Reload on save is what hands that decision to the watcher.
  host.reloadOnSave = true
  fs.writeFileSync(path.join(folder, 'native.cjs'), native('third'))
  await host.sync()
  assert.equal(runtime.get('notes'), 'third')
})

test('Cordis restores the previous plugin when replacement fails during apply', async () => {
  const { Profile } = await import('@sisyphus/profile')
  const runtime = new Profile()
  const plugin = { provide: ['answer'], apply(ctx) { ctx.provide('answer', 42) } }
  await runtime.add({ id: 'answer', plugin })
  await assert.rejects(runtime.replace('answer', { apply() { throw new Error('bad edit') } }), /bad edit/)
  assert.equal(runtime.get('answer'), 42)
  await runtime.dispose()
})
