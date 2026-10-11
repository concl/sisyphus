const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { packages } = require('../lib/plugin-compiler')
const { PluginLoader } = require('../lib/plugin-loader')

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-frontend-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const folder = path.join(directory, 'feature')
  fs.mkdirSync(folder)
  const frontend = [
    { id: 'feature.base', entry: './base.ts', export: 'basePlugin', order: 1 },
    { id: 'feature.optional', entry: './optional.ts', export: 'optionalPlugin', order: 2 },
  ]
  const manifest = {
    sisyphus: { frontend, backend: [{ id: 'desktop.example', entry: './backend.cjs' }] },
  }
  const write = (name, value) => fs.writeFileSync(path.join(folder, name), value)
  const save = () => write('package.json', JSON.stringify(manifest))
  save()
  write(
    'base.ts',
    "import './base.css'; export const basePlugin = { provide: ['base'], apply(ctx) { ctx.provide('base', 42) } }",
  )
  write(
    'optional.ts',
    "import './optional.css'; export const optionalPlugin = { inject: ['optional-provider'], provide: ['optional'], apply(ctx) { ctx.provide('optional', ctx.get('optional-provider')) } }",
  )
  write('base.css', '.base { color: blue }')
  write('optional.css', '.optional { color: red }')
  write('backend.cjs', 'module.exports = { apply() {} }')
  return { directory, folder, frontend, manifest, write, save, loader: new PluginLoader(directory) }
}

function exported(loader, entry) {
  let plugin
  vm.runInNewContext(loader.render(entry.id).source, {
    SisyphusRuntime: {
      register(id, exports) {
        assert.equal(id, entry.id)
        plugin = exports[entry.export]
      },
    },
  })
  return plugin
}

test('sibling frontends compile separately and activate with independent dependencies and toggles', async (t) => {
  const f = fixture(t)
  const { Profile } = await import('@sisyphus/profile')
  const runtime = new Profile()
  t.after(() => runtime.dispose())
  await f.loader.prepare()
  for (const entry of f.loader.scan().filter((entry) => entry.target === 'renderer'))
    await runtime.add({ id: entry.id, plugin: exported(f.loader, entry) })
  assert.equal(runtime.get('base'), 42)
  assert.equal(runtime.list().find((p) => p.id === 'feature.optional').state, 'waiting')
  assert.match(f.loader.render('feature.base').css, /blue/)
  assert.doesNotMatch(f.loader.render('feature.base').css, /red/)
  assert.match(f.loader.render('feature.optional').css, /red/)
  await runtime.add({
    id: 'provider',
    plugin: {
      provide: ['optional-provider'],
      apply(ctx) {
        ctx.provide('optional-provider', 7)
      },
    },
  })
  assert.equal(runtime.get('optional'), 7)
  await runtime.setEnabled('feature.optional', false)
  assert.equal(runtime.get('base'), 42)
  await runtime.setEnabled('feature.optional', true)
  assert.equal(runtime.get('optional'), 7)
  f.write('optional.css', '.optional { color: green }')
  await f.loader.prepare()
  assert.match(f.loader.render('feature.optional').css, /green/)
  assert.match(f.loader.render('feature.base').css, /blue/)
})

test('removing one frontend preserves siblings and backend across discovery and reload', async (t) => {
  const f = fixture(t)
  f.loader.scan()
  f.loader.remove('feature.optional', 'renderer')
  let fresh = new PluginLoader(f.directory)
  assert.deepEqual(
    fresh.scan().map((e) => e.id),
    ['feature.base', 'desktop.example'],
  )
  await fresh.prepare()
  assert.match(fresh.render('feature.base').css, /blue/)
  fresh.remove('feature.base', 'renderer')
  fresh = new PluginLoader(f.directory)
  assert.deepEqual(
    fresh.scan().map((e) => e.id),
    ['desktop.example'],
  )
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(f.folder, 'package.json'))).sisyphus.frontend,
    [],
  )
})

for (const bad of [
  null,
  'bad',
  {},
  { id: 'feature.other' },
  { id: 'feature.base', entry: './base.ts' },
]) {
  test(
    'invalid or duplicate array entries never expose a partial package: ' + JSON.stringify(bad),
    (t) => {
      const f = fixture(t)
      const known = f.loader.scan().map((e) => e.id)
      f.manifest.sisyphus.frontend.push(bad)
      f.save()
      const entries = packages(f.directory)
      assert.equal(entries.length, 1)
      assert.equal(entries[0].target, null)
      assert.ok(entries[0].error)
      const retained = f.loader.scan()
      assert.deepEqual(
        retained.map((e) => e.id),
        known,
      )
      assert.ok(retained.every((e) => e.error))
    },
  )
}

test('conflicting frontend IDs across packages fail discovery without ambiguous entries', (t) => {
  const f = fixture(t)
  const other = path.join(f.directory, 'other')
  fs.mkdirSync(other)
  fs.writeFileSync(
    path.join(other, 'package.json'),
    JSON.stringify({ sisyphus: { frontend: f.frontend[0] } }),
  )
  const entries = packages(f.directory)
  assert.equal(entries.length, 2)
  assert.ok(entries.every((e) => e.target === null && /claimed by/.test(e.error)))
})

test('singleton frontend declarations remain supported and remove cleanly', (t) => {
  const f = fixture(t)
  f.manifest.sisyphus.frontend = f.frontend[0]
  f.save()
  assert.ok(f.loader.entry('feature.base', 'renderer'))
  f.loader.remove('feature.base', 'renderer')
  assert.equal(new PluginLoader(f.directory).entry('feature.base', 'renderer'), undefined)
  assert.ok(f.loader.entry('desktop.example'))
})

test('an empty package cannot resurrect removed entries after a malformed edit', async (t) => {
  const f = fixture(t)
  await f.loader.prepare()
  f.loader.remove('feature.optional', 'renderer')
  f.loader.remove('feature.base', 'renderer')
  f.loader.remove('desktop.example', 'main')
  assert.deepEqual(f.loader.scan(), [])
  assert.throws(() => f.loader.render('feature.base'), /Unknown plugin/)
  f.write('package.json', '{ unfinished')
  const entries = f.loader.scan()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].target, null)
  assert.ok(entries[0].error)
  assert.equal(
    entries.some((e) => e.id === 'feature.base'),
    false,
  )
})
