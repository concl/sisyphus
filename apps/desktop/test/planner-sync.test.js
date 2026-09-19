const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { empty, merge, FolderDocumentTransport, syncDocument } = require('../../../plugins/planner/native/lib/planner-sync.js')

test('merges separate devices and retains tombstones', () => {
  const one = { id: 'one', kind: 'todo', title: 'A', updatedAt: '2026-01-01', actor: 'a' }
  const deletion = { ...one, deleted: true, updatedAt: '2026-01-03' }
  const two = { id: 'two', kind: 'event', title: 'B', updatedAt: '2026-01-02', actor: 'b' }
  assert.deepEqual(
    merge({ schema: 1, records: [deletion] }, { schema: 1, records: [one, two] }).records,
    [deletion, two],
  )
})

test('folder adapter roundtrips a merged document', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-sync-'))
  try {
    const transport = new FolderDocumentTransport(directory)
    assert.deepEqual(transport.read(), empty())
    const local = {
      schema: 1,
      records: [{ id: 'one', kind: 'todo', title: 'A', updatedAt: '2026-01-01', actor: 'a' }],
    }
    assert.deepEqual(await syncDocument(local, transport), local)
    assert.deepEqual(transport.read(), local)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('sync accepts an asynchronous cloud-file adapter', async () => {
  let stored = empty()
  const adapter = {
    async read() {
      return stored
    },
    async write(document) {
      stored = document
    },
  }
  const item = { id: 'one', kind: 'todo', title: 'A', updatedAt: '2026-01-01', actor: 'a' }
  const result = await syncDocument({ schema: 1, records: [item] }, adapter)
  assert.deepEqual(result, stored)
})
