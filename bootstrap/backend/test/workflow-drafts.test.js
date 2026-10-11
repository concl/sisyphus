'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Automations } = require('../../../plugins/actions/backend/lib/automations.js')
const { AutomationFiles } = require('../../../plugins/actions/backend/lib/automation-files.js')
const { checkProgram } = require('../../../plugins/actions/backend/lib/workflow-engine.js')
const { localActions } = require('../../../plugins/actions/backend/lib/action-runners.js')
const { dataActions } = require('../../../plugins/actions/backend/lib/data-actions.js')
const { networkActions } = require('../../../plugins/actions/backend/lib/network-actions.js')

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-drafts-'))
  t.after(() => {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()))
      throw new Error('Unexpected test directory')
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const files = new AutomationFiles(directory)
  const engine = new Automations({ files })
  engine.actions.registerService('data', { actions: dataActions() })
  return { engine, files }
}
const step = (id, type = 'data.value', config = {}) => ({ id, type, title: id, config })
const flow = (...nodes) => ({
  id: 'draft',
  title: 'Draft',
  nodes,
  edges: nodes.map((node, index) => ({ from: index ? nodes[index - 1].id : 'start', to: node.id })),
})

test('empty, disconnected, missing-provider and incomplete action drafts survive reopening', (t) => {
  const { engine, files } = setup(t)
  let executed = 0
  engine.register('needsName', {
    defaults: { name: '' },
    validate: (input) => {
      if (!input.name) throw new Error('Enter a name')
    },
    execute: () => executed++,
  })
  const cases = [
    flow(),
    { ...flow(step('a')), edges: [] },
    flow(step('a', 'missing.action')),
    flow(step('a', 'needsName')),
  ]
  for (const draft of cases) {
    engine.save(draft)
    const reopened = new Automations({ files, actions: engine.actions }).list()[0]
    assert.deepEqual(
      reopened.nodes.map((node) => node.id),
      draft.nodes.map((node) => node.id),
    )
    assert.ok(checkProgram(reopened, engine.actions).length)
    assert.throws(() => engine.start(draft.id))
  }
  assert.equal(executed, 0)
  assert.equal(engine.snapshot().length, 0)
})

test('unfinished raw JSON and numbers round-trip and can never run an older parsed value', (t) => {
  const { engine } = setup(t)
  for (const raw of ['{"unfinished":', '']) {
    const saved = engine.save(
      flow({ ...step('data', 'data.value', { value: 42 }), drafts: { value: raw } }),
    )
    assert.equal(engine.list()[0].nodes[0].drafts.value, raw)
    const issues = checkProgram(saved, engine.actions)
    assert.equal(issues[0].nodeId, 'data')
    assert.throws(() => engine.start('draft'), /Finish editing/)
  }
})

test('raw input drafts belong to the card and do not change a shared program', async (t) => {
  const { engine } = setup(t)
  const original = flow({ ...step('data'), bindings: { value: 'input' } })
  original.inputs = [{ key: 'input', label: 'Data', kind: 'json', value: { saved: true } }]
  const saved = engine.save(original)
  engine.save({ ...saved, id: 'copy' })
  const edited = engine.setInputs('draft', { input: { saved: true } }, { input: '{' })
  assert.equal(edited.programId, saved.programId)
  const cards = engine.list()
  assert.equal(cards.find((card) => card.id === 'draft').inputs[0].draft, '{')
  assert.equal(cards.find((card) => card.id === 'copy').inputs[0].draft, undefined)
  assert.throws(() => engine.start('draft'), /Finish editing input/)
  engine.start('draft', { input: { validOverride: true } })
  await engine.completions.get('draft')
  assert.equal(engine.runs.get('draft').status, 'succeeded')
  engine.setInputs('draft', { input: { repaired: true } })
  assert.equal(engine.list().find((card) => card.id === 'draft').inputs[0].draft, undefined)
})

test('defaults are applied consistently to direct calls and resolved workflow inputs', async (t) => {
  const { engine } = setup(t)
  engine.register('defaults', {
    defaults: { prefix: 'Hello', suffix: '!' },
    fields: [{ key: 'prefix', kind: 'text' }],
    execute: (input) => input,
  })
  const direct = await engine.actions.invoke('defaults', { prefix: 'Hi' })
  engine.run(flow(step('a', 'defaults', { prefix: 'Hi' })))
  await engine.completions.get('draft')
  assert.deepEqual(engine.runs.get('draft').nodes.a.result, direct)
})

test('removing a result producer is a repairable saved draft with a consumer-specific issue', (t) => {
  const { engine } = setup(t)
  const saved = engine.save(
    flow({ ...step('consumer'), bindings: { value: { step: 'removed', path: ['value'] } } }),
  )
  assert.equal(checkProgram(saved, engine.actions)[0].nodeId, 'consumer')
  assert.throws(() => engine.start('draft'), /source step was removed/)
})

test('draft persistence still rejects cycles, including disconnected cycles', (t) => {
  const { engine } = setup(t)
  const draft = flow(step('a'), step('b'))
  draft.edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' },
  ]
  assert.throws(() => engine.save(draft), /loop/)
})

test('built-in action documentation travels through the catalog without functions', (t) => {
  const { engine } = setup(t)
  engine.actions.registerService('web', { actions: networkActions() })
  const local = localActions({ shell: {}, integrations: {} })
  delete local.run
  engine.actions.registerService('system', { actions: local })
  for (const action of engine.types()) {
    assert.ok(action.effects.length, action.type)
    assert.ok(action.calls.length, action.type)
    assert.ok(action.examples.length, action.type)
    assert.equal(action.execute, undefined)
    assert.doesNotThrow(() => JSON.stringify(action))
  }
})
