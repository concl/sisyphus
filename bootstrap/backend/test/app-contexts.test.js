'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { AppContexts } = require('../../../plugins/contexts/backend/lib/app-contexts.js')

function setup() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-context-'))
  const values = new Map()
  const launched = []
  return {
    folder,
    launched,
    contexts: new AppContexts({
      storage: {
        get: (scope, key) => values.get(`${scope}:${key}`),
        set: (scope, key, value) => values.set(`${scope}:${key}`, value),
      },
      integrations: {
        launch: async (id, input) => {
          launched.push({ id, input })
          return id
        },
      },
    }),
  }
}

test('contexts validate, persist, update, and launch their integration actions', async () => {
  const { contexts, folder, launched } = setup()
  const saved = contexts.save({
    name: 'Development',
    actions: [
      { integration: 'vscode', folders: [folder], profile: 'Web', window: 'reuse' },
      { integration: 'browser', urls: ['https://example.com/docs'] },
    ],
  })
  assert.match(saved.id, /^development-/)
  assert.equal(contexts.list().length, 1)
  contexts.save({ ...saved, name: 'Development updated' })
  assert.equal(contexts.list()[0].name, 'Development updated')

  await assert.rejects(contexts.launch(saved.id), /Choose which app/)
  assert.equal(launched.length, 0)
  const result = await contexts.launch(saved.id, 'vscode')
  assert.equal(result.launched.length, 1)
  assert.deepEqual(
    launched.map((item) => item.id),
    ['vscode'],
  )

  contexts.delete(saved.id)
  assert.deepEqual(contexts.list(), [])
})

test('editing and removing one app preserves the other half of a legacy bundle', () => {
  const { contexts, folder } = setup()
  const vscode = { integration: 'vscode', folders: [folder], window: 'new' }
  const saved = contexts.save({
    name: 'Legacy',
    actions: [vscode, { integration: 'browser', urls: ['https://example.com/'] }],
  })
  // Browser edits must still work if an unrelated editor folder moves away.
  fs.rmSync(folder, { recursive: true, force: true })
  contexts.saveAction({
    id: saved.id,
    name: 'Legacy',
    action: { integration: 'browser', urls: ['https://example.org/'] },
  })
  assert.deepEqual(
    contexts.list()[0].actions.find((item) => item.integration === 'vscode'),
    vscode,
  )
  const detached = contexts.saveAction({
    id: saved.id,
    name: 'Reading',
    action: { integration: 'browser', urls: ['https://example.org/docs'] },
  })
  assert.notEqual(detached.id, saved.id)
  assert.deepEqual(
    contexts.list().find((item) => item.id === saved.id),
    { ...saved, actions: [vscode] },
  )
  contexts.delete(detached.id, 'browser')
  assert.deepEqual(contexts.list(), [{ ...saved, actions: [vscode] }])
})

test('app-specific deletion and opening never affect another app', async () => {
  const { contexts, folder, launched } = setup()
  const saved = contexts.save({
    name: 'Legacy',
    actions: [
      { integration: 'vscode', folders: [folder] },
      { integration: 'browser', urls: ['https://example.com/'] },
    ],
  })
  contexts.delete(saved.id, 'vscode')
  assert.equal(contexts.list()[0].actions.length, 1)
  await assert.rejects(contexts.launch(saved.id, 'vscode'), /no entry/)
  await contexts.launch(saved.id)
  assert.deepEqual(
    launched.map((item) => item.id),
    ['browser'],
  )
})

test('single-app saves validate before changing stored entries', () => {
  const { contexts } = setup()
  const action = { integration: 'browser', urls: ['https://example.com/'] }
  const saved = contexts.saveAction({ name: 'Reading', action })
  assert.throws(() => contexts.saveAction({ id: saved.id, name: null, action }), /names/)
  assert.throws(() => contexts.saveAction({ id: 'missing', name: 'Reading', action }), /not found/)
  assert.deepEqual(contexts.list(), [saved])
})

test('contexts reject unsafe URLs and missing folders', () => {
  const { contexts, folder } = setup()
  assert.throws(
    () =>
      contexts.save({
        name: 'Unsafe',
        actions: [{ integration: 'browser', urls: ['file:///etc/passwd'] }],
      }),
    /HTTP and HTTPS/,
  )
  assert.throws(
    () =>
      contexts.save({
        name: 'Missing',
        actions: [{ integration: 'vscode', folders: [path.join(folder, 'missing')] }],
      }),
    /no longer available/,
  )
})

test('a saved context remains visible when one of its folders moves away', () => {
  const { contexts, folder } = setup()
  const saved = contexts.save({
    name: 'Movable',
    actions: [{ integration: 'vscode', folders: [folder], window: 'new' }],
  })
  fs.rmSync(folder, { recursive: true, force: true })
  assert.equal(contexts.list()[0].id, saved.id)
})
