'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { resolveDroppedPaths } = require('../../../plugins/files/native/lib/dropped-files.js')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-drop-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export {}')
  return root
}

test('accepts dropped items inside the conversation folder with relative paths', () => {
  const root = fixture()
  assert.deepEqual(resolveDroppedPaths([path.join(root, 'src', 'index.ts')], root), {
    status: 'accepted',
    entries: [{ path: 'src/index.ts', type: 'file' }],
  })
})

test('suggests an explicit folder bind for outside items', () => {
  const root = fixture()
  const result = resolveDroppedPaths([path.join(root, 'src', 'index.ts')], null)
  assert.equal(result.status, 'needs-folder')
  assert.equal(result.suggestedFolder, fs.realpathSync(path.join(root, 'src')))
  assert.deepEqual(result.names, ['index.ts'])
})

test('refuses unrelated paths instead of widening access to a broad ancestor', () => {
  const first = fixture()
  const second = fixture()
  const result = resolveDroppedPaths(
    [path.join(first, 'src', 'index.ts'), path.join(second, 'src', 'index.ts')],
    null,
  )
  assert.equal(result.status, 'rejected')
})
