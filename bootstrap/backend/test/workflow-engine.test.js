'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const {
  WorkflowEngine,
  validateProgram,
} = require('../../../plugins/actions/backend/lib/workflow-engine.js')
const { ActionServices } = require('../../../plugins/actions/backend/lib/catalog.js')
const { dataActions } = require('../../../plugins/actions/backend/lib/data-actions.js')
const { networkActions } = require('../../../plugins/actions/backend/lib/network-actions.js')

async function finished(engine) {
  for (let index = 0; index < 200; index++) {
    const run = engine.snapshot()[0]
    if (run?.status !== 'running') {
      await delay(0)
      return run
    }
    await delay(5)
  }
  throw new Error('Run did not finish')
}
const node = (id, type, config = {}, bindings = {}) => ({ id, type, config, bindings })
const chain = (...nodes) => ({
  id: 'test',
  nodes,
  edges: nodes.map((step, index) => ({ from: index ? nodes[index - 1].id : 'start', to: step.id })),
})

test('a workflow executes extension actions and passes nested results without any card or application model', async () => {
  const engine = new WorkflowEngine()
  engine.actions.registerService('data', { actions: dataActions() })
  const program = chain(
    node('source', 'data.value', {}, { value: { input: 'person', path: [] } }),
    node(
      'format',
      'data.format',
      { template: 'Hello {{name}} from {{place.city}}.' },
      { values: { step: 'source', path: ['value'] } },
    ),
    node('parse', 'data.parse', {}, { text: { step: 'source', path: ['value', 'json'] } }),
  )
  program.inputs = [
    {
      key: 'person',
      label: 'Person',
      kind: 'json',
      value: { name: 'Ada', place: { city: 'London' }, json: '{"ready":true}' },
    },
  ]
  engine.run(program)
  const run = await finished(engine)
  assert.equal(run.status, 'succeeded')
  assert.equal(run.nodes.format.result.text, 'Hello Ada from London.')
  assert.deepEqual(run.nodes.parse.result.value, { ready: true })
  assert.equal(program.nodes[1].config.values, undefined)
})

test('data references require an upstream dependency and reject missing outputs and unsafe paths', () => {
  const engine = new WorkflowEngine()
  engine.actions.registerService('data', { actions: dataActions() })
  const program = chain(
    node('source', 'data.value', { value: {} }),
    node('target', 'data.value', {}, { value: { step: 'source', path: ['value'] } }),
  )
  const invalid = structuredClone(program)
  invalid.edges = [
    { from: 'start', to: 'source' },
    { from: 'start', to: 'target' },
  ]
  assert.throws(() => engine.run(invalid), /connected earlier step/)
  invalid.edges = program.edges
  invalid.nodes[1].bindings.value.path = ['missing']
  assert.throws(() => engine.run(invalid), /output unavailable/)
  invalid.nodes[1].bindings.value.path = ['value', '__proto__']
  assert.throws(() => engine.run(invalid), /Invalid data reference/)
  assert.equal(engine.snapshot().length, 0)
})

test('resolved values are validated before invoking their consumer; independent branches finish', async () => {
  const engine = new WorkflowEngine()
  engine.actions.registerService('data', { actions: dataActions() })
  let invoked = false
  engine.register('consumer', {
    fields: [{ key: 'count', kind: 'number' }],
    validate: (input) => {
      if (typeof input.count !== 'number') throw new Error('Expected a number')
    },
    execute: () => {
      invoked = true
    },
  })
  const program = chain(
    node('source', 'data.value', { value: { count: 'invalid' } }),
    node('target', 'consumer', {}, { count: { step: 'source', path: ['value', 'count'] } }),
  )
  program.nodes.push(node('independent', 'data.value', { value: 42 }))
  program.edges.push({ from: 'start', to: 'independent' })
  engine.run(program)
  const run = await finished(engine)
  assert.equal(run.status, 'failed')
  assert.equal(run.nodes.target.error, 'Expected a number')
  assert.equal(invoked, false)
  assert.equal(run.nodes.independent.result.value, 42)
})

test('a web service result can drive another extension action', async () => {
  const engine = new WorkflowEngine()
  let requested
  engine.actions.registerService('web', {
    actions: networkActions(async (url, options) => {
      requested = { url, options }
      return new Response('{"person":{"name":"Ada"}}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  })
  engine.actions.registerService('data', { actions: dataActions() })
  engine.run(
    chain(
      node('request', 'web.request', {
        url: 'https://example.org/',
        method: 'GET',
        headers: {},
        body: null,
        timeoutSeconds: 5,
      }),
      node(
        'format',
        'data.format',
        { template: 'Hello {{name}}' },
        { values: { step: 'request', path: ['body', 'person'] } },
      ),
    ),
  )
  const run = await finished(engine)
  assert.equal(run.status, 'succeeded')
  assert.equal(requested.options.method, 'GET')
  assert.equal(run.nodes.format.result.text, 'Hello Ada')
})

test('provider disposal cancels owned calls and prevents downstream calls to disposed implementations', async () => {
  const actions = new ActionServices()
  const updates = []
  actions.subscribe((types) => updates.push(types.map((type) => type.type)))
  const off = actions.registerService('example', {
    name: 'Example',
    actions: {
      echo: {
        aliases: ['echo'],
        fields: [{ key: 'value', kind: 'json' }],
        execute: async ({ value }) => {
          await delay(5)
          return { value }
        },
      },
    },
  })
  assert.deepEqual(updates[0], ['example.echo'])
  assert.equal(actions.get('echo'), actions.get('example.echo'))
  const engine = new WorkflowEngine({ actions })
  engine.run(
    chain(node('a', 'example.echo', { value: 1 }), node('b', 'example.echo', { value: 2 })),
  )
  off()
  assert.deepEqual(updates.at(-1), [])
  const run = await finished(engine)
  assert.equal(run.status, 'cancelled')
  assert.equal(run.nodes.a.status, 'cancelled')
  assert.equal(run.nodes.b.status, 'skipped')
  assert.throws(() => engine.run(chain(node('a', 'echo', { value: 0 }))), /unavailable/)
})

test('registry invocation works independently and duplicate service registration rolls back partial additions', async () => {
  const actions = new ActionServices()
  actions.registerService('data', { actions: dataActions() })
  assert.deepEqual(await actions.invoke('data.parse', { text: '[1,2]' }), { value: [1, 2] })
  assert.throws(
    () =>
      actions.registerService('data', {
        actions: { newAction: { execute: () => 1 }, value: { execute: () => 2 } },
      }),
    /duplicate/,
  )
  assert.equal(actions.has('data.newAction'), false)
})

test('missing result properties and non-JSON outputs are visible failures', async () => {
  const engine = new WorkflowEngine()
  engine.actions.registerService('data', { actions: dataActions() })
  engine.run(
    chain(
      node('source', 'data.value', { value: {} }),
      node('target', 'data.value', {}, { value: { step: 'source', path: ['value', 'missing'] } }),
    ),
  )
  assert.match((await finished(engine)).nodes.target.error, /property unavailable/)
  engine.register('invalid', { execute: () => ({ value: NaN }) })
  engine.run(chain(node('invalid', 'invalid')))
  assert.equal((await finished(engine)).status, 'failed')
  assert.throws(
    () => validateProgram(chain(node('a', 'data.value', { value: () => {} }))),
    /JSON-compatible/,
  )
})
