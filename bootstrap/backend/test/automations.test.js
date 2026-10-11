'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { setTimeout: delay } = require('node:timers/promises')
const { Automations, validateFlow } = require('../../../plugins/actions/backend/lib/automations.js')
const {
  registerBuiltins,
  processRun,
} = require('../../../plugins/actions/backend/lib/action-runners.js')
const { browserTabsFlow } = require('../../../plugins/actions/backend/lib/action-examples.js')
const { AutomationFiles } = require('../../../plugins/actions/backend/lib/automation-files.js')

const node = (id, type = 'test', config = {}) => ({ id, type, title: id, config, x: 300, y: 60 })
const flow = (nodes, edges) => ({
  id: 'example',
  title: 'Example',
  color: 'green',
  description: '',
  nodes,
  edges,
})
function setup(legacy = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-automations-'))
  const files = new AutomationFiles(directory)
  const events = []
  const automations = new Automations({
    files,
    legacy: { list: () => legacy },
    onRun: (run) => events.push(run),
  })
  return { automations, files, directory, events }
}
async function finished(automations) {
  for (let index = 0; index < 400; index++) {
    const run = automations.snapshot()[0]
    if (run && run.status !== 'running') {
      await delay(0)
      return run
    }
    await delay(5)
  }
  throw new Error('Run did not finish')
}

test('legacy bundles migrate once into parallel Open steps without overwriting their source', () => {
  const legacy = [
    {
      id: 'old',
      name: 'Project',
      actions: [
        { integration: 'vscode', folders: [os.tmpdir()], window: 'reuse', profile: 'Work' },
        { integration: 'browser', urls: ['https://example.org'] },
      ],
    },
  ]
  const { automations, files } = setup(legacy)
  const saved = automations.list()[0]
  assert.equal(saved.title, 'Project')
  assert.equal(saved.nodes[0].config.application, 'editor')
  assert.equal(saved.nodes[0].config.profile, 'Work')
  assert.deepEqual(saved.edges, [
    { from: 'start', to: 'step-0' },
    { from: 'start', to: 'step-1' },
  ])
  automations.delete(saved.id)
  assert.deepEqual(automations.list(), [])
  assert.equal(legacy.length, 1)
  assert.equal(files.initialized(), true)
})

test('rejects cycles, duplicate edges, dangling edges, and disconnected steps before saving', () => {
  const nodes = [node('a'), node('b')]
  const start = { from: 'start', to: 'a' }
  assert.throws(
    () => validateFlow(flow(nodes, [start, { from: 'a', to: 'b' }, { from: 'b', to: 'a' }])),
    /loop/,
  )
  assert.throws(() => validateFlow(flow(nodes, [start, start])), /already connected/)
  assert.throws(() => validateFlow(flow(nodes, [start, { from: 'a', to: 'missing' }])), /Connect/)
  assert.throws(() => validateFlow(flow(nodes, [start])), /every step/)
  assert.throws(() => validateFlow(flow([node('start')], [])), /unique/)
  assert.throws(() => validateFlow(flow(nodes, [{ from: 'a', to: 'start' }])), /Start/)
})

test('branches start concurrently and a join executes exactly once after all inputs succeed', async () => {
  const { automations, events } = setup()
  const started = []
  const releases = {}
  automations.register('test', {
    name: 'Test',
    defaults: {},
    fields: [],
    validate() {},
    execute: (_, { node, log }) => {
      started.push(node.id)
      log(node.id)
      if (node.id === 'join') return
      return new Promise((resolve) => {
        releases[node.id] = resolve
      })
    },
  })
  automations.save(
    flow(
      [node('a'), node('b'), node('join')],
      [
        { from: 'start', to: 'a' },
        { from: 'start', to: 'b' },
        { from: 'a', to: 'join' },
        { from: 'b', to: 'join' },
      ],
    ),
  )
  automations.start('example')
  assert.throws(() => automations.start('example'), /already running/)
  await delay(0)
  assert.deepEqual(started, ['a', 'b'])
  releases.a()
  await delay(0)
  assert.deepEqual(started, ['a', 'b'])
  releases.b()
  const result = await finished(automations)
  assert.deepEqual(started, ['a', 'b', 'join'])
  assert.equal(result.status, 'succeeded')
  assert.equal(result.nodes.join.output, 'join')
  assert.equal(events[0].nodes.a.status, 'pending', 'published snapshots must not be mutated')
})

test('a failed branch skips dependent steps while an independent branch can finish', async () => {
  const { automations } = setup()
  const started = []
  automations.register('test', {
    validate() {},
    execute: async (_, { node }) => {
      started.push(node.id)
      if (node.id === 'a') throw new Error('Broken')
    },
  })
  automations.save(
    flow(
      [node('a'), node('b'), node('join')],
      [
        { from: 'start', to: 'a' },
        { from: 'start', to: 'b' },
        { from: 'a', to: 'join' },
        { from: 'b', to: 'join' },
      ],
    ),
  )
  automations.start('example')
  const result = await finished(automations)
  assert.deepEqual(started, ['a', 'b'])
  assert.equal(result.status, 'failed')
  assert.equal(result.nodes.a.error, 'Broken')
  assert.equal(result.nodes.join.status, 'skipped')
  assert.equal(result.nodes.b.status, 'succeeded')
})

test('cancellation interrupts waits, skips future steps, and permits another run', async () => {
  const { automations } = setup()
  registerBuiltins(automations, { shell: {}, integrations: {} })
  automations.save(
    flow(
      [
        node('a', 'wait', { mode: 'duration', seconds: 10 }),
        node('b', 'wait', { mode: 'duration', seconds: 0 }),
      ],
      [
        { from: 'start', to: 'a' },
        { from: 'a', to: 'b' },
      ],
    ),
  )
  automations.start('example')
  await delay(5)
  assert.throws(() => automations.delete('example'), /Stop/)
  automations.cancel('example')
  const result = await finished(automations)
  assert.equal(result.status, 'cancelled')
  assert.equal(result.nodes.a.status, 'cancelled')
  assert.equal(result.nodes.b.status, 'cancelled')
  automations.start('example')
  automations.dispose()
  assert.equal((await finished(automations)).status, 'cancelled')
})

test('missing runner steps stay saved and become executable when their plugin registers', async () => {
  const { automations } = setup()
  automations.save(flow([node('custom', 'custom')], [{ from: 'start', to: 'custom' }]))
  assert.throws(() => automations.start('example'), /unavailable/)
  const off = automations.register('custom', { validate() {}, execute: async () => {} })
  automations.start('example')
  assert.equal((await finished(automations)).status, 'succeeded')
  off()
  assert.equal(automations.list()[0].nodes[0].type, 'custom')
})

test('card order persists and invalid reorder requests leave data intact', () => {
  const { automations } = setup()
  const first = flow([node('a')], [{ from: 'start', to: 'a' }])
  automations.save(first)
  automations.save({ ...first, id: 'second' })
  automations.reorder(['second', 'example'])
  assert.deepEqual(
    automations.list().map((item) => item.id),
    ['second', 'example'],
  )
  assert.throws(() => automations.reorder(['second', 'second']), /order/)
  assert.deepEqual(
    automations.list().map((item) => item.id),
    ['second', 'example'],
  )
})

test('Open validates all targets before opening any, and preserves literal paths', async () => {
  const { automations } = setup()
  const opened = []
  registerBuiltins(automations, {
    shell: {
      openExternal: async (url) => opened.push(url),
      openPath: async (value) => {
        opened.push(value)
        return ''
      },
    },
    integrations: {},
  })
  automations.save(
    flow(
      [
        node('a', 'open', {
          application: 'default',
          targets: ['https://example.org', path.join(os.tmpdir(), 'missing-' + Date.now())],
        }),
      ],
      [{ from: 'start', to: 'a' }],
    ),
  )
  automations.start('example')
  assert.equal((await finished(automations)).status, 'failed')
  assert.deepEqual(opened, [])
  assert.throws(
    () =>
      automations.run(
        flow(
          [node('a', 'open', { application: 'default', targets: ['javascript:alert(1)'] })],
          [{ from: 'start', to: 'a' }],
        ),
      ),
    /absolute path/,
  )
  assert.throws(
    () =>
      automations.run(
        flow(
          [
            node('a', 'open', {
              application: 'default',
              targets: ['https://user:secret@example.org'],
            }),
          ],
          [{ from: 'start', to: 'a' }],
        ),
      ),
    /credentials/,
  )
})

test('Run captures stdout and stderr, passes arguments without a shell, and reports exit failure', async () => {
  let output = ''
  const context = {
    signal: new AbortController().signal,
    log: (chunk) => {
      output += chunk
    },
  }
  await processRun(
    {
      program: process.execPath,
      args: [
        '-e',
        'console.log(process.argv[1]); console.error("stderr")',
        'a b; $(nope) & "quoted"',
      ],
      timeoutSeconds: 5,
    },
    context,
  )
  assert.match(output, /a b; \$\(nope\) & "quoted"/)
  assert.match(output, /stderr/)
  await assert.rejects(
    processRun(
      { program: process.execPath, args: ['-e', 'process.exit(7)'], timeoutSeconds: 5 },
      context,
    ),
    /code 7/,
  )
  await assert.rejects(
    processRun({ program: 'sisyphus-nonexistent-command', args: [], timeoutSeconds: 5 }, context),
    /ENOENT/,
  )
})

test('Run cancellation terminates a child and timeout reports a useful failure', async () => {
  const controller = new AbortController()
  let ready
  const started = new Promise((resolve) => {
    ready = resolve
  })
  const child = processRun(
    {
      program: process.execPath,
      args: ['-e', 'console.log("ready"); setInterval(()=>{}, 1000)'],
      timeoutSeconds: 5,
    },
    { signal: controller.signal, log: ready },
  )
  await started
  controller.abort()
  await assert.rejects(child, /Cancelled/)
  await assert.rejects(
    processRun(
      { program: process.execPath, args: ['-e', 'setInterval(()=>{}, 1000)'], timeoutSeconds: 0.1 },
      { signal: new AbortController().signal, log() {} },
    ),
    /timed out/,
  )
})

test('Wait checks HTTP readiness, retries failures, and observes its deadline', async (t) => {
  let requests = 0
  const server = http.createServer((_, response) => {
    requests++
    response.writeHead(requests < 2 ? 503 : 200)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const { automations } = setup()
  registerBuiltins(automations, { shell: {}, integrations: {} })
  automations.save(
    flow(
      [
        node('a', 'wait', {
          mode: 'url',
          url: `http://127.0.0.1:${server.address().port}/`,
          timeoutSeconds: 3,
        }),
      ],
      [{ from: 'start', to: 'a' }],
    ),
  )
  automations.start('example')
  assert.equal((await finished(automations)).status, 'succeeded')
  assert.equal(requests, 2)
  assert.throws(
    () =>
      automations.run(
        flow(
          [node('a', 'wait', { mode: 'url', url: 'file:///tmp/foo', timeoutSeconds: 3 })],
          [{ from: 'start', to: 'a' }],
        ),
      ),
    /HTTP/,
  )
})

test('a moved target remains saved and readable; runtime reports the missing file', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-action-'))
  const file = path.join(directory, 'example.txt')
  fs.writeFileSync(file, 'example')
  const { automations } = setup()
  registerBuiltins(automations, { shell: { openPath: async () => '' }, integrations: {} })
  automations.save(
    flow(
      [node('a', 'open', { application: 'default', targets: [file] })],
      [{ from: 'start', to: 'a' }],
    ),
  )
  fs.rmSync(directory, { recursive: true })
  assert.equal(automations.list().length, 1)
  automations.start('example')
  assert.equal((await finished(automations)).status, 'failed')
})

test('a parameterized tab opener uses its saved websites and accepts temporary input overrides', async () => {
  const { automations } = setup()
  const opened = []
  registerBuiltins(automations, {
    shell: { openExternal: async (url) => opened.push(url) },
    integrations: {},
  })
  const example = browserTabsFlow('example')
  automations.save(example)
  automations.start('example')
  assert.equal((await finished(automations)).status, 'succeeded')
  assert.deepEqual(opened, example.inputs[0].value)
  opened.length = 0
  automations.start('example', { websites: ['https://example.org/one', 'https://example.org/two'] })
  const run = await finished(automations)
  assert.equal(run.status, 'succeeded')
  assert.deepEqual(opened, ['https://example.org/one', 'https://example.org/two'])
  assert.deepEqual(run.inputValues.websites, opened)
  assert.deepEqual(
    automations.list()[0].inputs[0].value,
    example.inputs[0].value,
    'run overrides must not change saved defaults',
  )
  assert.deepEqual(
    automations.list()[0].nodes[0].config.websites,
    [],
    'input resolution must not rewrite the graph',
  )
})

test('duplicates have independent defaults and reuse the same input connections', async () => {
  const { automations } = setup()
  const opened = []
  registerBuiltins(automations, {
    shell: { openExternal: async (url) => opened.push(url) },
    integrations: {},
  })
  const original = automations.save(browserTabsFlow('original'))
  const duplicate = structuredClone(original)
  duplicate.id = 'example'
  duplicate.title = 'My research tabs'
  duplicate.inputs[0].value = ['https://example.org/research']
  automations.save(duplicate)
  automations.start('example')
  assert.equal((await finished(automations)).status, 'succeeded')
  assert.deepEqual(opened, ['https://example.org/research'])
  assert.deepEqual(
    automations.list().find((flow) => flow.id === 'original').inputs[0].value,
    original.inputs[0].value,
  )
  assert.equal(
    automations.list().find((flow) => flow.id === 'example').nodes[0].bindings.websites,
    'websites',
  )
})

test('invalid inputs fail before any branch starts and do not overwrite stored defaults', () => {
  const { automations } = setup()
  const opened = []
  registerBuiltins(automations, {
    shell: { openExternal: async (url) => opened.push(url) },
    integrations: {},
  })
  const original = automations.save(browserTabsFlow('example'))
  assert.throws(
    () => automations.start('example', { websites: ['javascript:alert(1)'] }),
    /absolute path|HTTP/,
  )
  assert.throws(
    () => automations.start('example', { websites: ['https://user:secret@example.org'] }),
    /credentials/,
  )
  assert.throws(() => automations.start('example', { websites: [] }), /Add a website/)
  assert.throws(
    () => automations.start('example', { websites: 'https://example.org' }),
    /Invalid value/,
  )
  assert.throws(() => automations.start('example', { unknown: [] }), /Unknown card input/)
  assert.throws(
    () => automations.start('example', JSON.parse('{"__proto__":[] }')),
    /Unknown card input/,
  )
  assert.deepEqual(opened, [])
  assert.deepEqual(automations.snapshot(), [])
  assert.deepEqual(automations.list()[0], original)
})

test('malformed input connections cannot save; incompatible draft bindings cannot run', () => {
  const { automations } = setup()
  registerBuiltins(automations, { shell: {}, integrations: {} })
  const example = browserTabsFlow('example')
  assert.throws(
    () => automations.save({ ...example, inputs: [...example.inputs, example.inputs[0]] }),
    /unique/,
  )
  assert.throws(
    () =>
      automations.save({
        ...example,
        inputs: [{ key: '__proto__', label: 'Unsafe', kind: 'text', value: '' }],
      }),
    /unique/,
  )
  const invalid = structuredClone(example)
  invalid.nodes[0].bindings.websites = 'missing'
  assert.throws(() => automations.save(invalid), /unavailable/)
  invalid.nodes[0].bindings = { application: 'websites' }
  assert.doesNotThrow(() => automations.save(invalid))
  assert.throws(() => automations.start(invalid.id), /cannot be used/)
  invalid.nodes[0].bindings = { __proto__: null, nonexistent: 'websites' }
  assert.doesNotThrow(() => automations.save(invalid))
  assert.throws(() => automations.start(invalid.id), /cannot be used/)
})

test('text, number, boolean, and list inputs keep their types and can feed several steps', async () => {
  const { automations } = setup()
  const executed = []
  automations.register('test', {
    fields: [
      { key: 'text', kind: 'text' },
      { key: 'count', kind: 'number' },
      { key: 'enabled', kind: 'boolean' },
      { key: 'items', kind: 'lines' },
    ],
    validate(config) {
      assert.equal(typeof config.count, 'number')
      assert.equal(typeof config.enabled, 'boolean')
    },
    execute: async (config) => executed.push(config),
  })
  const example = flow(
    [node('a'), node('b')],
    [
      { from: 'start', to: 'a' },
      { from: 'a', to: 'b' },
    ],
  )
  example.inputs = [
    { key: 'text', label: 'Text', kind: 'text', value: 'a b; $(literal)' },
    { key: 'count', label: 'Count', kind: 'number', value: 0 },
    { key: 'enabled', label: 'Enabled', kind: 'boolean', value: false },
    { key: 'items', label: 'Items', kind: 'lines', value: ['one', 'two'] },
  ]
  example.nodes.forEach((node) => {
    node.bindings = { text: 'text', count: 'count', enabled: 'enabled', items: 'items' }
  })
  automations.save(example)
  assert.throws(() => automations.start('example', { count: NaN }), /Invalid value/)
  assert.throws(() => automations.start('example', { enabled: 'false' }), /Invalid value/)
  automations.start('example')
  assert.equal((await finished(automations)).status, 'succeeded')
  assert.deepEqual(executed, [
    { text: 'a b; $(literal)', count: 0, enabled: false, items: ['one', 'two'] },
    { text: 'a b; $(literal)', count: 0, enabled: false, items: ['one', 'two'] },
  ])
})
