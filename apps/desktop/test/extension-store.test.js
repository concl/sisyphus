'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { compareVersions, ensureStore, seedDefaults, scanStore } = require('../lib/extension-store')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-ext-test-'))
}

function writeExt(dir, id, version, { entry = 'entry.js', style, pages = [] } = {}) {
  const extDir = path.join(dir, `${id}@${version}`)
  fs.mkdirSync(extDir, { recursive: true })
  fs.writeFileSync(
    path.join(extDir, 'manifest.json'),
    JSON.stringify({ id, version, entry, ...(style ? { style } : {}), pages }),
  )
  fs.writeFileSync(path.join(extDir, entry), 'export function register() {}')
  if (style) fs.writeFileSync(path.join(extDir, style), '.x {}')
}

test('compareVersions compares dotted versions numerically', () => {
  assert.equal(compareVersions('1.2.10', '1.2.9') > 0, true)
  assert.equal(compareVersions('1.2.9', '1.2.9'), 0)
  assert.equal(compareVersions('2.0.0', '1.9.9') > 0, true)
  assert.equal(compareVersions('1.10', '1.9') > 0, true)
})

test('seedDefaults copies missing extension dirs and skips existing ones', () => {
  const src = tmpDir()
  const dst = tmpDir()
  writeExt(src, 'a', '1.0.0')
  writeExt(src, 'b', '2.0.0')
  // Pre-place a in the store; seeding must not overwrite it.
  writeExt(dst, 'a', '1.0.0')
  fs.writeFileSync(path.join(dst, 'a@1.0.0', 'entry.js'), 'CUSTOM')

  assert.equal(seedDefaults(dst, src), 1)
  assert.equal(fs.existsSync(path.join(dst, 'b@2.0.0', 'manifest.json')), true)
  // a@1.0.0 untouched
  assert.equal(fs.readFileSync(path.join(dst, 'a@1.0.0', 'entry.js'), 'utf8'), 'CUSTOM')
})

test('seedDefaults is a no-op for a missing source dir', () => {
  assert.equal(seedDefaults(tmpDir(), path.join(tmpDir(), 'nope')), 0)
})

test('scanStore lists extensions and builds entry/style urls', () => {
  const dir = tmpDir()
  writeExt(dir, 'a', '1.0.0', { style: 'style.css' })
  writeExt(dir, 'b', '2.0.0')

  const listed = scanStore(dir, 'sisyphus-ext://ext')
  assert.equal(listed.length, 2)
  const a = listed.find((e) => e.id === 'a')
  assert.equal(a.version, '1.0.0')
  assert.equal(a.url, 'sisyphus-ext://ext/a@1.0.0/entry.js')
  assert.equal(a.styleUrl, 'sisyphus-ext://ext/a@1.0.0/style.css')
})

test('scanStore resolves per-page icon urls from the manifest', () => {
  const dir = tmpDir()
  writeExt(dir, 'a', '1.0.0', {
    pages: [
      { id: 'a', title: 'A', icon: 'icon.svg', keepAlive: false },
      { id: 'a-extra', title: 'Extra', keepAlive: false },
    ],
  })

  const [listed] = scanStore(dir, 'sisyphus-ext://ext')
  assert.deepEqual(listed.pages, [
    { id: 'a', iconUrl: 'sisyphus-ext://ext/a@1.0.0/icon.svg' },
    { id: 'a-extra' },
  ])
})

test('scanStore tolerates malformed pages entries', () => {
  const dir = tmpDir()
  writeExt(dir, 'a', '1.0.0', { pages: [null, 3, { icon: 'x.svg' }] })

  const [listed] = scanStore(dir)
  assert.deepEqual(listed.pages, [])
})

test('scanStore picks the highest version per id', () => {
  const dir = tmpDir()
  writeExt(dir, 'a', '1.0.0')
  writeExt(dir, 'a', '1.2.0')
  writeExt(dir, 'a', '1.10.0')

  const listed = scanStore(dir)
  assert.equal(listed.length, 1)
  assert.equal(listed[0].version, '1.10.0')
  assert.equal(listed[0].url, 'sisyphus-ext://ext/a@1.10.0/entry.js')
})

test('scanStore ignores malformed directories', () => {
  const dir = tmpDir()
  writeExt(dir, 'a', '1.0.0')
  fs.mkdirSync(path.join(dir, 'not-an-extension'))
  const broken = path.join(dir, 'broken@1.0.0')
  fs.mkdirSync(broken)
  fs.writeFileSync(path.join(broken, 'manifest.json'), 'not json')

  const listed = scanStore(dir)
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, 'a')
})

test('ensureStore creates the store directory', () => {
  const dir = path.join(tmpDir(), 'nested', 'store')
  ensureStore(dir)
  assert.equal(fs.existsSync(dir), true)
})
