const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { validateFolder, resolveInside, folderLabel } = require('../../../shared/backend/chat-folder.js')
const { FileIndex, search } = require('../../../plugins/files/backend/lib/file-index.js')

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-folder-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return fs.realpathSync(dir)
}

test('validateFolder accepts a real directory and refuses anything else', (t) => {
  const dir = workspace(t)
  assert.equal(validateFolder(dir), dir)
  assert.throws(() => validateFolder(''), /Choose a folder/)
  assert.throws(() => validateFolder(42), /Choose a folder/)
  assert.throws(() => validateFolder(path.join(dir, 'missing')), /no longer available/)
  fs.writeFileSync(path.join(dir, 'file.txt'), 'x')
  assert.throws(() => validateFolder(path.join(dir, 'file.txt')), /folder, not a file/)
  assert.equal(folderLabel(dir).length > 0, true)
})

test('resolveInside keeps tool paths inside the conversation folder', (t) => {
  const dir = workspace(t)
  fs.mkdirSync(path.join(dir, 'src'))
  assert.equal(resolveInside(dir), dir)
  assert.equal(resolveInside(dir, 'src'), path.join(dir, 'src'))
  // A file the agent is about to create has no realpath yet.
  assert.equal(resolveInside(dir, 'src/new.txt'), path.join(dir, 'src', 'new.txt'))
  assert.equal(resolveInside(dir, './src/../src'), path.join(dir, 'src'))
  assert.throws(() => resolveInside(dir, '../outside.txt'), /outside this conversation folder/)
  assert.throws(() => resolveInside(dir, path.join(dir, '..', 'escape')), /outside/)
  assert.throws(() => resolveInside(dir, path.resolve(dir, '..', 'escape', 'deep.txt')), /outside/)
})

test('the mention index lists relative entries and skips heavy folders', async (t) => {
  const dir = workspace(t)
  fs.mkdirSync(path.join(dir, 'src'))
  fs.mkdirSync(path.join(dir, 'node_modules'))
  fs.mkdirSync(path.join(dir, '.git'))
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), '')
  fs.writeFileSync(path.join(dir, 'README.md'), '')
  fs.writeFileSync(path.join(dir, 'node_modules', 'junk.js'), '')
  const index = new FileIndex()
  const all = await index.list(dir, '', 50)
  assert.deepEqual(all.map((entry) => entry.path).sort(), ['README.md', 'src/', 'src/index.ts'])
  assert.equal(all.find((entry) => entry.path === 'src/').type, 'folder')
  assert.equal(all.find((entry) => entry.path === 'README.md').type, 'file')
  // A repeat query is served from the cache.
  assert.deepEqual(await index.list(dir, '', 50), all)
})

test('search ranks basename matches above path matches', () => {
  const entries = [
    { path: 'src/index.ts', type: 'file' },
    { path: 'index/README.md', type: 'file' },
    { path: 'src/main.ts', type: 'file' },
  ]
  assert.deepEqual(
    search(entries, 'index', 5).map((entry) => entry.path),
    ['src/index.ts', 'index/README.md'],
  )
  assert.deepEqual(search(entries, 'nothing', 5), [])
  assert.equal(search(entries, '', 2).length, 2)
})
