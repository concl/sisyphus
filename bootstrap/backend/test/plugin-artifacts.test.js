'use strict'
// The shipped build reaching the user's folder: what gets copied, what is left
// alone, and how a shipped plugin is put back after an edit.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const test = require('node:test')
const { PluginArtifacts } = require('../lib/plugin-artifacts')

for (const edit of [null, 'source', 'manifest']) {
  test(`source topology migration preserves an edited package: ${edit ?? 'untouched'}`, t => {
    const shippedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topology-shipped-'))
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'topology-local-'))
    t.after(() => {
      fs.rmSync(shippedDir, { recursive: true, force: true })
      fs.rmSync(directory, { recursive: true, force: true })
    })
    const stage = (modern) => {
      const files = {
        'notes/package.json': JSON.stringify({ sisyphus: modern
          ? { frontend: { id: 'feature.notes', entry: './frontend/index.ts' } }
          : { id: 'feature.notes', entry: './src/index.ts' } }),
        [`notes/${modern ? 'frontend' : 'src'}/index.ts`]: 'export default { apply() {} }',
      }
      for (const [name, source] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(shippedDir, name)), { recursive: true })
        fs.writeFileSync(path.join(shippedDir, name), source)
      }
      fs.writeFileSync(path.join(shippedDir, 'manifest.json'), JSON.stringify({ plugins: [{
        id: 'feature.notes', target: 'renderer', files: Object.keys(files).map(name => ({
          name, sha256: sha256(path.join(shippedDir, name)),
        })),
      }] }))
    }
    stage(false)
    const artifacts = new PluginArtifacts({ shippedDir, directory })
    artifacts.seed()
    if (edit === 'source') fs.appendFileSync(path.join(directory, 'notes/src/index.ts'), '\n// my edit')
    if (edit === 'manifest') fs.writeFileSync(path.join(directory, 'notes/package.json'), JSON.stringify({
      sisyphus: { id: 'feature.notes', entry: './src/index.ts', order: 99 },
    }))
    stage(true)
    artifacts.seed()
    const local = JSON.parse(fs.readFileSync(path.join(directory, 'notes/package.json')))
    if (edit) {
      assert.equal(local.sisyphus.entry, './src/index.ts')
      assert.ok(fs.existsSync(path.join(directory, 'notes/src/index.ts')))
      assert.equal(fs.existsSync(path.join(directory, 'notes/frontend/index.ts')), false)
      artifacts.seed()
      assert.ok(fs.existsSync(path.join(directory, 'notes/src/index.ts')), 'preservation survives another launch')
      artifacts.restore('feature.notes')
      assert.ok(JSON.parse(fs.readFileSync(path.join(directory, 'notes/package.json'))).sisyphus.frontend)
    } else {
      assert.equal(local.sisyphus.frontend.entry, './frontend/index.ts')
      assert.equal(fs.existsSync(path.join(directory, 'notes/src/index.ts')), false)
    }
    fs.appendFileSync(path.join(directory, 'notes/frontend/index.ts'), '\n// edited after migration')
    assert.equal(artifacts.edited('notes\\frontend\\index.ts'), true, 'Windows catalog paths match manifest hashes')
  })
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

/** A shipped build: one plugin per file, and the manifest that describes their hashes. */
function shipped(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-shipped-'))
  const plugins = []
  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), source)
    plugins.push({
      id: name.replace(/\.renderer\.js$/, ''),
      target: 'renderer',
      order: 3,
      export: 'notesPlugin',
      needs: [],
      js: name,
      css: null,
      files: [{ name, bytes: source.length, sha256: sha256(path.join(dir, name)) }],
    })
  }
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ built: '2026-01-01T00:00:00.000Z', plugins }, null, 2),
  )
  return dir
}

const folder = (files = {}) => fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-plugins-'))

const artifactsFor = (files, directory = folder()) =>
  new PluginArtifacts({ shippedDir: shipped(files), directory })

test('a shipped build lands in the user folder with its manifest', () => {
  const artifacts = artifactsFor({ 'feature.notes.renderer.js': 'code v1' })
  const result = artifacts.seed()
  assert.deepEqual(result.seeded.sort(), ['feature.notes.renderer.js', 'manifest.json'])
  assert.equal(
    fs.readFileSync(path.join(artifacts.directory, 'feature.notes.renderer.js'), 'utf8'),
    'code v1',
  )
  assert.equal(artifacts.edited('feature.notes.renderer.js'), false)
  assert.deepEqual(artifacts.ids(), ['feature.notes'])
})

test('an edit in the user folder is kept, and reported as an edit', () => {
  const artifacts = artifactsFor({ 'feature.notes.renderer.js': 'code v1' })
  artifacts.seed()
  fs.writeFileSync(path.join(artifacts.directory, 'feature.notes.renderer.js'), 'my change')
  const again = artifacts.seed()
  assert.deepEqual(again.kept, ['feature.notes.renderer.js'])
  assert.equal(
    fs.readFileSync(path.join(artifacts.directory, 'feature.notes.renderer.js'), 'utf8'),
    'my change',
  )
  assert.equal(artifacts.edited('feature.notes.renderer.js'), true)
})

test('a rebuild replaces an untouched copy and leaves an edited one alone', () => {
  const artifacts = artifactsFor({ 'feature.notes.renderer.js': 'code v1' })
  artifacts.seed()
  // A new build arrives in the same folder the app already has.
  fs.writeFileSync(path.join(artifacts.shippedDir, 'feature.notes.renderer.js'), 'code v2')
  const result = artifacts.seed()
  assert(result.seeded.includes('feature.notes.renderer.js'))
  assert(result.seeded.includes('manifest.json'), 'the build record is refreshed too')
  assert.equal(
    fs.readFileSync(path.join(artifacts.directory, 'feature.notes.renderer.js'), 'utf8'),
    'code v2',
  )
})

test('a shipped plugin can be put back after an edit', () => {
  const artifacts = artifactsFor({ 'feature.notes.renderer.js': 'code v1' })
  artifacts.seed()
  fs.writeFileSync(path.join(artifacts.directory, 'feature.notes.renderer.js'), 'my change')
  assert.equal(artifacts.edited('feature.notes.renderer.js'), true)
  assert.deepEqual(artifacts.restore('feature.notes'), ['feature.notes.renderer.js'])
  assert.equal(artifacts.edited('feature.notes.renderer.js'), false)
  assert.equal(
    fs.readFileSync(path.join(artifacts.directory, 'feature.notes.renderer.js'), 'utf8'),
    'code v1',
  )
  assert.throws(() => artifacts.restore('feature.other'), /not a plugin this build shipped/)
})

test('a file the build drops is taken back, and a user file is never touched', () => {
  const artifacts = artifactsFor({
    'feature.notes.renderer.js': 'code v1',
    'feature.old.renderer.js': 'gone soon',
  })
  artifacts.seed()
  const mine = path.join(artifacts.directory, 'user.notes.renderer.js')
  fs.writeFileSync(mine, 'mine')
  // The next build carries one plugin fewer.
  fs.rmSync(path.join(artifacts.shippedDir, 'feature.old.renderer.js'))
  fs.writeFileSync(
    path.join(artifacts.shippedDir, 'manifest.json'),
    JSON.stringify({
      plugins: [
        {
          id: 'feature.notes',
          js: 'feature.notes.renderer.js',
          css: null,
          files: [
            {
              name: 'feature.notes.renderer.js',
              sha256: sha256(path.join(artifacts.shippedDir, 'feature.notes.renderer.js')),
            },
          ],
        },
      ],
    }),
  )
  const result = artifacts.seed()
  assert.deepEqual(result.removed, ['feature.old.renderer.js'])
  assert.equal(fs.existsSync(path.join(artifacts.directory, 'feature.old.renderer.js')), false)
  assert.equal(fs.readFileSync(mine, 'utf8'), 'mine')
})

test('a build with no plugins is not an error, it is just nothing to seed', () => {
  const directory = folder()
  const artifacts = new PluginArtifacts({ shippedDir: path.join(directory, 'nowhere'), directory })
  assert.equal(artifacts.available, false)
  const result = artifacts.seed()
  assert.equal(result.available, false)
  assert.deepEqual(result.seeded, [])
})
