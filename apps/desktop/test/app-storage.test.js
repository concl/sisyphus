'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ScopedStore, isValidScope } = require('../lib/app-storage')

function storeFor(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-storage-test-'))
  return { dir, store: new ScopedStore(path.join(dir, name + '.json')) }
}

test('isValidScope rejects unsafe scopes', () => {
  assert.equal(isValidScope('app'), true)
  assert.equal(isValidScope('my-extension_2'), true)
  assert.equal(isValidScope('../escape'), false)
  assert.equal(isValidScope('a/b'), false)
  assert.equal(isValidScope(''), false)
  assert.equal(isValidScope('a'.repeat(65)), false)
  assert.equal(isValidScope(42), false)
})

test('set/get/delete roundtrip and persist across instances', () => {
  const { dir, store } = storeFor('scope')
  store.write('count', 3)
  store.write('name', 'sisyphus')
  store.write('nested', { a: [1, 2] })

  // A new instance over the same file sees the same data.
  const reopened = new ScopedStore(path.join(dir, 'scope.json'))
  assert.equal(reopened.read('count'), 3)
  assert.equal(reopened.read('name'), 'sisyphus')
  assert.deepEqual(reopened.read('nested'), { a: [1, 2] })

  reopened.remove('count')
  assert.equal(reopened.read('count'), undefined)
})

test('scopes are isolated files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-storage-test-'))
  const a = new ScopedStore(path.join(dir, 'ext-a.json'))
  const b = new ScopedStore(path.join(dir, 'ext-b.json'))
  a.write('key', 'from-a')
  b.write('key', 'from-b')
  assert.equal(a.read('key'), 'from-a')
  assert.equal(b.read('key'), 'from-b')
})

test('missing and corrupt files read as empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-storage-test-'))
  const missing = new ScopedStore(path.join(dir, 'missing.json'))
  assert.equal(missing.read('anything'), undefined)

  const corruptFile = path.join(dir, 'corrupt.json')
  fs.writeFileSync(corruptFile, 'not json{{{')
  const corrupt = new ScopedStore(corruptFile)
  assert.equal(corrupt.read('anything'), undefined)
  // Writing over a corrupt file recovers it.
  corrupt.write('key', 1)
  assert.equal(new ScopedStore(corruptFile).read('key'), 1)
})

test('writes are atomic (no leftover tmp file)', () => {
  const { dir, store } = storeFor('scope')
  store.write('a', 1)
  assert.equal(fs.existsSync(path.join(dir, 'scope.json.tmp')), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'scope.json'), 'utf8')).a, 1)
})
