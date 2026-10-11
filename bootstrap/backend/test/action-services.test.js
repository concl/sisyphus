const test = require('node:test')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const { ActionServices } = require('../../../plugins/actions/backend/lib/catalog.js')
const { Scripts } = require('../../../plugins/scripts/backend/lib/scripts.js')
const { PlannerRepository } = require('../../../plugins/planner/backend/lib/planner-data.js')
const calendarActions = require('../../../plugins/planner/backend/actions.js')
const { WorkflowEngine } = require('../../../plugins/actions/backend/lib/workflow-engine.js')

test('an uncooperative provider still settles cancelled and re-registration gets a fresh lifetime', async () => {
  const actions = new ActionServices()
  const off = actions.register('slow', { execute: () => new Promise(() => {}) })
  const call = actions.invoke('slow')
  await delay(0)
  off()
  await assert.rejects(call, { name: 'AbortError' })
  actions.register('slow', { execute: () => ({ value: 42 }) })
  assert.deepEqual(await actions.invoke('slow'), { value: 42 })
  actions.dispose()
  assert.equal(actions.list().length, 0)
})
test('caller cancellation reaches only that invocation', async () => {
  const actions = new ActionServices()
  actions.register('echo', {
    execute: async (input, { signal }) => {
      await delay(10, null, { signal })
      return input
    },
  })
  const controller = new AbortController()
  const a = actions.invoke('echo', { value: 1 }, { signal: controller.signal })
  const b = actions.invoke('echo', { value: 2 })
  controller.abort()
  await assert.rejects(a, { name: 'AbortError' })
  assert.deepEqual(await b, { value: 2 })
})
test('scripts run independently of automation, with literal arguments and stdin', async () => {
  const scripts = new Scripts()
  const result = await scripts.run({
    program: process.execPath,
    args: ['-e', 'process.stdin.on("data", data => process.stdout.write(data))'],
    stdin: 'saved input',
    timeoutSeconds: 10,
  })
  assert.equal(result.stdout, 'saved input')
  assert.equal(result.exitCode, 0)
  scripts.dispose()
  assert.throws(() => scripts.run({ program: process.execPath }), { name: 'AbortError' })
})
test('script service inserts the script path as one literal argument', async () => {
  let received
  const scripts = new Scripts(async (config) => {
    received = config
    return { stdout: 'ok' }
  })
  await scripts.runScript({
    interpreter: 'python',
    path: require('node:path').resolve('a script.py'),
    args: ['a b', '$literal'],
  })
  assert.deepEqual(received.args, [require('node:path').resolve('a script.py'), 'a b', '$literal'])
  assert.throws(() => scripts.run({ program: 'python', cwd: 'relative' }), /absolute/)
})
test('Calendar action uses the domain service, publishes changes and returns bindable event data', async () => {
  const data = new Map()
  const changes = []
  const planner = new PlannerRepository(
    {
      get: (scope, key) => data.get(`${scope}/${key}`),
      set: (scope, key, value) => data.set(`${scope}/${key}`, value),
    },
    (value) => changes.push(value),
  )
  const actions = new ActionServices()
  const cleanup = []
  calendarActions().apply({
    get: (name) => (name === 'planner.v1' ? planner : actions),
    effect: (fn) => cleanup.push(fn()),
  })
  const engine = new WorkflowEngine({ actions })
  engine.register('echo', { fields: [{ key: 'value', kind: 'text' }], execute: (input) => input })
  const input = { title: 'Planning', date: '2026-10-05' }
  engine.run({
    id: 'calendar-test',
    inputs: [],
    nodes: [
      { id: 'event', type: 'calendar.createEvent', config: { event: input } },
      {
        id: 'echo',
        type: 'echo',
        config: {},
        bindings: { value: { step: 'event', path: ['id'] } },
      },
    ],
    edges: [
      { from: 'start', to: 'event' },
      { from: 'event', to: 'echo' },
    ],
  })
  for (let i = 0; i < 100 && engine.snapshot()[0].status === 'running'; i++) await delay(5)
  const run = engine.snapshot()[0]
  assert.equal(run.status, 'succeeded')
  assert.equal(run.nodes.echo.result.value, planner.list()[0].id)
  assert.equal(changes.length, 1)
  await assert.rejects(
    actions.invoke('calendar.createEvent', {
      event: { ...input, start: '2026-10-05T11:00:00Z', end: '2026-10-05T10:00:00Z' },
    }),
    /End must be after/,
  )
  cleanup.forEach((off) => off())
  assert.equal(actions.has('calendar.createEvent'), false)
  assert.equal(planner.list().length, 1)
})

test('Calendar draft validation calls the injected planner and never writes', () => {
  const data = new Map()
  let changes = 0
  const planner = new PlannerRepository(
    {
      get: (scope, key) => data.get(scope + '/' + key),
      set: (scope, key, value) => data.set(scope + '/' + key, value),
    },
    () => changes++,
  )
  const actions = new ActionServices()
  let validations = 0
  calendarActions().apply({
    get: (name) =>
      name === 'planner.v1'
        ? {
            validateEvent(input) {
              validations++
              return planner.validateEvent(input)
            },
            createEvent() {
              throw new Error('Validation must not create an event')
            },
          }
        : actions,
    effect: (fn) => fn(),
  })
  const validate = (event) => actions.get('calendar.createEvent').validate({ event })
  validate({ title: 'Draft', date: '2026-10-10' })
  assert.throws(() => validate({ title: 'Draft', date: '2026-02-30' }), /valid calendar date/)
  assert.throws(
    () => validate({ title: 'Draft', date: '2026-10-10', calendarId: 'missing' }),
    /existing calendar/,
  )
  assert.equal(validations, 3)
  assert.deepEqual(planner.list(), [])
  assert.equal(changes, 0)
  actions.dispose()
})
