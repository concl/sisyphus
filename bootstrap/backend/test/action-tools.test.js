'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { z } = require('zod')
const { Automations } = require('../../../plugins/actions/backend/lib/automations.js')
const { AutomationFiles } = require('../../../plugins/actions/backend/lib/automation-files.js')
const { automationTools } = require('../../../plugins/actions/backend/lib/action-tools.js')
const { dataActions } = require('../../../plugins/actions/backend/lib/data-actions.js')

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-action-tools-'))
  t.after(() => {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()))
      throw new Error('Unexpected test directory')
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const files = new AutomationFiles(directory)
  const automations = new Automations({ files })
  automations.actions.registerService('data', { actions: dataActions() })
  let changes = 0
  const tools = new Map(
    automationTools({ automations, onChange: () => changes++ }).map((tool) => [tool.name, tool]),
  )
  return {
    automations,
    files,
    tools,
    call: async (name, input) => tools.get(name).execute(input),
    changes: () => changes,
  }
}

test('every automation tool exposes an object schema the worker can serialize', (t) => {
  const { tools } = setup(t)
  assert.deepEqual(
    [...tools.keys()],
    [
      'list_actions',
      'list_action_types',
      'get_action',
      'create_action',
      'update_action',
      'delete_action',
      'run_action',
    ],
  )
  for (const tool of tools.values()) {
    assert.ok(tool.description.length, tool.name)
    assert.ok(['read', 'write'].includes(tool.access), tool.name)
    // The chat worker turns each schema into JSON Schema for the model.
    const schema = z.toJSONSchema(tool.inputSchema)
    assert.equal(schema.type, 'object', tool.name)
  }
})

test('create_action builds an ordered, runnable card from a title and steps', async (t) => {
  const { automations, tools, call, changes } = setup(t)
  const saved = await call('create_action', {
    title: 'Open my notes',
    description: 'A one-click shortcut',
    steps: [
      { action: 'data.value', config: { value: { ready: true } } },
      {
        action: 'data.format',
        title: 'Build a message',
        bindings: { values: { step: 'step-1', path: ['value'] } },
      },
    ],
  })
  assert.equal(saved.title, 'Open my notes')
  assert.deepEqual(saved.edges, [
    { from: 'start', to: 'step-1' },
    { from: 'step-1', to: 'step-2' },
  ])
  assert.equal(saved.nodes[1].type, 'data.format')
  assert.equal(saved.nodes[1].title, 'Build a message')
  // Step settings start from the action defaults and stay self-contained.
  assert.deepEqual(saved.nodes[0].config, { value: { ready: true } })
  assert.deepEqual(saved.nodes[1].config, { template: '', values: {} })
  assert.deepEqual(saved.issues, [])
  // It is persisted, and the open panel is told to refresh.
  assert.equal(automations.get(saved.id).id, saved.id)
  assert.equal(changes(), 1)
  assert.equal(tools.get('create_action').access, 'write')
})

test('create_action names inputs, fills a kind-appropriate default, and binds it', async (t) => {
  const { call } = setup(t)
  const saved = await call('create_action', {
    title: 'Greeting',
    inputs: [{ key: 'name', label: 'Name', kind: 'text', value: 'Ada' }],
    steps: [{ action: 'data.format', bindings: { template: 'name' } }],
  })
  assert.deepEqual(saved.inputs, [{ key: 'name', label: 'Name', kind: 'text', value: 'Ada' }])
  assert.deepEqual(saved.issues, [])
  const withoutValue = await call('create_action', {
    title: 'Sites',
    inputs: [{ key: 'sites', label: 'Sites', kind: 'lines' }],
    steps: [{ action: 'data.value', bindings: { value: 'sites' } }],
  })
  assert.deepEqual(withoutValue.inputs[0].value, [])
  assert.deepEqual(withoutValue.issues, [])
})

test('create_action rejects an unknown action so the model can correct itself', async (t) => {
  const { call } = setup(t)
  await assert.rejects(
    () => call('create_action', { title: 'Broken', steps: [{ action: 'nope.missing' }] }),
    /Unknown action/,
  )
})

test('create_action saves a draft and reports the step that is not ready to run', async (t) => {
  const { automations, call } = setup(t)
  automations.actions.registerService('needs', {
    actions: {
      name: {
        name: 'Needs a name',
        defaults: { name: '' },
        fields: [{ key: 'name', label: 'Name', kind: 'text' }],
        validate: (input) => {
          if (!input.name) throw new Error('Enter a name')
        },
        execute: () => ({}),
      },
    },
  })
  const saved = await call('create_action', {
    title: 'Incomplete',
    steps: [{ action: 'needs.name' }],
  })
  assert.equal(saved.nodes[0].type, 'needs.name')
  assert.equal(saved.issues.length, 1)
  assert.equal(saved.issues[0].nodeId, 'step-1')
  assert.match(saved.issues[0].message, /^Needs a name: /)
})

test('update_action edits metadata and one saved value without touching the graph', async (t) => {
  const { call } = setup(t)
  const created = await call('create_action', {
    title: 'Greeting',
    inputs: [{ key: 'name', label: 'Name', kind: 'text', value: 'Ada' }],
    steps: [{ action: 'data.format', bindings: { template: 'name' } }],
  })
  const updated = await call('update_action', {
    id: created.id,
    title: 'Hi there',
    color: 'rose',
    inputValues: { name: 'Grace' },
  })
  assert.equal(updated.title, 'Hi there')
  assert.equal(updated.color, 'rose')
  assert.equal(updated.inputs[0].value, 'Grace')
  assert.deepEqual(updated.nodes, created.nodes)
  assert.deepEqual(updated.edges, created.edges)
  // A value-only edit keeps the card on the same program.
  assert.equal(updated.programId, created.programId)
  await assert.rejects(
    () => call('update_action', { id: created.id, inputValues: { missing: 'x' } }),
    /Unknown card input/,
  )
})

test('update_action replaces steps and forks the program when the graph changes', async (t) => {
  const { call } = setup(t)
  const created = await call('create_action', {
    title: 'Two steps',
    steps: [{ action: 'data.value' }, { action: 'data.format' }],
  })
  const replaced = await call('update_action', {
    id: created.id,
    steps: [{ action: 'data.parse', config: { text: '{"ok":true}' } }],
  })
  assert.equal(replaced.nodes.length, 1)
  assert.equal(replaced.nodes[0].type, 'data.parse')
  // A changed graph gets its own program so other cards keep theirs.
  assert.notEqual(replaced.programId, created.programId)
  assert.deepEqual(replaced.issues, [])
})

test('update_action can reconnect existing steps without replacing them', async (t) => {
  const { call } = setup(t)
  const created = await call('create_action', {
    title: 'Chain',
    steps: [{ action: 'data.value' }, { action: 'data.format' }],
  })
  const rewired = await call('update_action', {
    id: created.id,
    edges: [
      { from: 'start', to: 'step-1' },
      { from: 'start', to: 'step-2' },
    ],
  })
  assert.deepEqual(rewired.nodes, created.nodes)
  assert.deepEqual(rewired.edges, [
    { from: 'start', to: 'step-1' },
    { from: 'start', to: 'step-2' },
  ])
  assert.deepEqual(rewired.issues, [])
})

test('get_action and delete_action read and remove a card, and notify the panel', async (t) => {
  const { automations, call, changes } = setup(t)
  const created = await call('create_action', {
    title: 'Doomed',
    steps: [{ action: 'data.value' }],
  })
  const read = await call('get_action', { id: created.id })
  assert.equal(read.title, 'Doomed')
  assert.equal(changes(), 1)
  await call('delete_action', { id: created.id })
  assert.equal(changes(), 2)
  assert.deepEqual(automations.list(), [])
  await assert.rejects(() => call('get_action', { id: 'missing' }), /not found/)
})

test('list_action_types returns the catalog, filtered and without functions', async (t) => {
  const { call } = setup(t)
  const all = await call('list_action_types', {})
  assert.ok(all.some((action) => action.type === 'data.value'))
  for (const action of all) assert.equal(action.execute, undefined)
  const filtered = await call('list_action_types', { search: 'json' })
  assert.ok(
    filtered.every((action) => /json/i.test(`${action.type} ${action.name} ${action.description}`)),
  )
  assert.ok(filtered.some((action) => action.type === 'data.parse'))
})
