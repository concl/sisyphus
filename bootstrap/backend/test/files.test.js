const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { FileBridge } = require('../../../plugins/files/backend/lib/mcp-files.js')
const { FileIndex } = require('../../../plugins/files/backend/lib/file-index.js')

// The bridge must close before the folder is removed: the server process would
// otherwise keep it locked while it shuts down.
function bridgeWorkspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-mcp-'))
  const bridge = new FileBridge()
  t.after(async () => {
    await bridge.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { dir: fs.realpathSync(dir), bridge }
}

function context(services) {
  return {
    get: (name) => services[name],
    effect: (fn) => {
      fn()
    },
  }
}

function registry() {
  const tools = new Map()
  return {
    register: (name, definition) => {
      tools.set(name, definition)
      return () => tools.delete(name)
    },
    get: (name) => tools.get(name),
    list: () => [...tools].map(([name, definition]) => ({ name, ...definition })),
  }
}

function transport() {
  const handlers = new Map()
  return {
    handle: (name, fn) => {
      handlers.set(name, fn)
      return () => handlers.delete(name)
    },
    call: (name, input) => handlers.get(name)(input),
  }
}

test('the filesystem bridge reads, writes, and edits inside the folder', async (t) => {
  const { dir, bridge } = bridgeWorkspace(t)
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello world\n')

  assert.match(await bridge.call(dir, 'read_text_file', { path: 'notes.txt' }), /hello world/)
  await bridge.call(dir, 'create_directory', { path: 'src' })
  await bridge.call(dir, 'write_file', { path: 'src/new.txt', content: 'line\n' })
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'new.txt'), 'utf8'), 'line\n')
  await bridge.call(dir, 'edit_file', {
    path: 'src/new.txt',
    edits: [{ oldText: 'line', newText: 'changed' }],
  })
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'new.txt'), 'utf8'), 'changed\n')
  assert.match(
    await bridge.call(dir, 'list_directory', { path: '.' }),
    /notes\.txt/,
    'the folder listing should be visible to the model',
  )
  // The server, not just the tool schema, is what enforces the folder boundary.
  await assert.rejects(
    () => bridge.call(dir, 'read_text_file', { path: '../escape.txt' }),
    (error) => /outside|denied|allowed/i.test(error.message),
  )
})

test('the files plugin registers read and write tools that need a folder', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-mcp-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'readme.md'), '# notes')
  const tools = registry()
  const handlers = transport()
  require('../../../plugins/files/backend/files.js')({
    index: new FileIndex(),
  }).apply(context({ 'transport.v1': handlers, 'agent.tools.v1': tools }))

  const list = tools.list()
  assert.deepEqual(
    list
      .filter((tool) => tool.access === 'write')
      .map((tool) => tool.name)
      .sort(),
    ['create_directory', 'edit_file', 'write_file'],
  )
  assert.deepEqual(
    list
      .filter((tool) => tool.access === 'read')
      .map((tool) => tool.name)
      .sort(),
    ['list_directory', 'read_file', 'search_files'],
  )
  await assert.rejects(() => tools.get('read_file').execute({ path: 'readme.md' }, {}), /no folder/)
  // The mention picker reads the same folder.
  const entries = await handlers.call('files.list', { folder: dir, query: 'read' })
  assert.deepEqual(
    entries.map((entry) => entry.path),
    ['readme.md'],
  )
})
