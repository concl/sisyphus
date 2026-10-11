'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { AutomationFiles } = require('../../../plugins/actions/backend/lib/automation-files.js')
const { Automations } = require('../../../plugins/actions/backend/lib/automations.js')
const { browserTabsFlow } = require('../../../plugins/actions/backend/lib/action-examples.js')

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-automation-files-'))
  t.after(() => {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()))
      throw new Error('Unexpected test directory')
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const files = new AutomationFiles(directory)
  const automations = new Automations({ files })
  return { directory, files, automations }
}
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

test('inline input saves merge into the current graph and preserve provider editor metadata', (t) => {
  const { automations } = setup(t)
  const flow = browserTabsFlow('tabs')
  flow.inputs[0].editor = 'example.websites'
  flow.inputs[0].field = { kind: 'lines', hint: 'One address per line' }
  const saved = automations.save(flow)
  const edited = automations.save({
    ...saved,
    nodes: saved.nodes.map((node) => ({ ...node, x: 700 })),
  })
  const inputs = automations.setInputs('tabs', { websites: ['https://example.org/'] })
  assert.equal(inputs.programId, edited.programId)
  assert.equal(inputs.nodes[0].x, 700)
  assert.equal(inputs.inputs[0].editor, 'example.websites')
  assert.deepEqual(inputs.inputs[0].field, flow.inputs[0].field)
  assert.deepEqual(inputs.inputs[0].value, ['https://example.org/'])
  assert.throws(() => automations.setInputs('tabs', { missing: true }), /Unknown card input/)
})

test('exposed input controls survive duplication and reopening with independent values', (t) => {
  const { files, automations } = setup(t)
  const flow = browserTabsFlow('tabs')
  flow.inputs.push({
    key: 'window',
    label: 'Window',
    kind: 'text',
    value: 'new',
    field: {
      kind: 'select',
      options: [
        { value: 'new', label: 'New window' },
        { value: 'reuse', label: 'Reuse window' },
      ],
    },
  })
  const saved = automations.save(flow)
  const copy = automations.save({ ...saved, id: 'copy' })
  automations.setInputs(copy.id, { window: 'reuse' })
  const reopened = new Automations({ files })
  assert.deepEqual(reopened.list().find((card) => card.id === 'copy').inputs[1], {
    ...flow.inputs[1],
    value: 'reuse',
  })
  assert.equal(reopened.list().find((card) => card.id === 'tabs').inputs[1].value, 'new')
  assert.throws(
    () =>
      automations.save({
        ...saved,
        inputs: [{ ...flow.inputs[1], field: { kind: 'number' } }],
      }),
    /does not match/,
  )
})

test('runCard waits for results, propagates cancellation and rejects overlapping recursion', async (t) => {
  const { automations } = setup(t)
  automations.register('echo', {
    fields: [{ key: 'value', kind: 'text' }],
    execute: async ({ value }, { signal }) => {
      await require('node:timers/promises').setTimeout(10, null, { signal })
      return { value }
    },
  })
  automations.save({
    id: 'card',
    title: 'Card',
    inputs: [],
    nodes: [{ id: 'echo', type: 'echo', config: { value: 'finished' } }],
    edges: [{ from: 'start', to: 'echo' }],
  })
  const result = await automations.runCard('card')
  assert.equal(result.status, 'succeeded')
  assert.equal(result.nodes.echo.result.value, 'finished')
  const controller = new AbortController()
  const running = automations.runCard('card', {}, { signal: controller.signal })
  await assert.rejects(automations.runCard('card'), /already running/)
  controller.abort()
  await assert.rejects(running, { name: 'AbortError' })
})

test('each card is a separate file; configuration changes do not rewrite programs or other cards', (t) => {
  const { files, automations, directory } = setup(t)
  const original = automations.save(browserTabsFlow('tabs'))
  const duplicate = automations.save({ ...original, id: 'research', title: 'Research' })
  assert.equal(duplicate.programId, original.programId)
  const programFile = files.programFile(original.programId)
  const programBytes = fs.readFileSync(programFile, 'utf8')
  const originalBytes = fs.readFileSync(files.cardFile(original.id), 'utf8')
  const program = read(programFile)
  const card = read(files.cardFile(duplicate.id))
  assert.equal(card.programId, program.id)
  assert.equal(card.nodes, undefined)
  assert.equal(program.inputs[0].value, undefined)
  assert.equal(program.color, undefined)
  duplicate.inputs[0].value = ['https://example.org/research']
  automations.save(duplicate)
  assert.equal(fs.readFileSync(programFile, 'utf8'), programBytes)
  assert.equal(fs.readFileSync(files.cardFile(original.id), 'utf8'), originalBytes)
  assert.deepEqual(
    read(files.cardFile(duplicate.id)).inputValues.websites,
    duplicate.inputs[0].value,
  )
  assert.equal(fs.existsSync(path.join(directory, 'storage', 'automations.json')), false)
  const reopened = new Automations({ files: new AutomationFiles(directory) })
  assert.deepEqual(
    reopened.list().find((flow) => flow.id === 'research'),
    duplicate,
  )
})

test('editing a shared graph forks its program and preserves other cards and accompanying files', (t) => {
  const { files, automations } = setup(t)
  const original = automations.save(browserTabsFlow('tabs'))
  const copy = automations.save({ ...original, id: 'research' })
  const originalProgram = fs.readFileSync(files.programFile(original.programId), 'utf8')
  const asset = path.join(path.dirname(files.programFile(original.programId)), 'notes.txt')
  fs.writeFileSync(asset, 'Program-owned file')
  copy.nodes.push({
    id: 'pause',
    title: 'Wait',
    type: 'wait',
    x: 600,
    y: 60,
    config: { seconds: 1 },
  })
  copy.edges.push({ from: 'open-tabs', to: 'pause' })
  const independent = automations.save(copy)
  assert.notEqual(independent.programId, original.programId)
  assert.equal(fs.readFileSync(files.programFile(original.programId), 'utf8'), originalProgram)
  assert.deepEqual(
    automations.list().find((flow) => flow.id === original.id),
    original,
  )
  assert.equal(
    fs.readFileSync(
      path.join(path.dirname(files.programFile(independent.programId)), 'notes.txt'),
      'utf8',
    ),
    'Program-owned file',
  )
  assert.throws(() => automations.save(copy), /Reopen/)
})

test('legacy aggregate migration preserves source bytes and does not reimport deleted cards', (t) => {
  const { files, automations, directory } = setup(t)
  fs.mkdirSync(path.dirname(files.legacyFile), { recursive: true })
  const legacyBytes = JSON.stringify(
    { 'flows.v1': [browserTabsFlow('tabs')], unrelated: 42 },
    null,
    2,
  )
  fs.writeFileSync(files.legacyFile, legacyBytes)
  assert.equal(automations.list()[0].inputs[0].key, 'websites')
  assert.equal(files.initialized(), true)
  assert.equal(fs.readFileSync(files.legacyFile, 'utf8'), legacyBytes)
  automations.delete('tabs')
  assert.equal(fs.existsSync(files.cardFile('tabs')), false)
  assert.equal(fs.existsSync(files.programFile('tabs')), true)
  const reopened = new Automations({ files: new AutomationFiles(directory) })
  assert.deepEqual(reopened.list(), [])
})

test('interrupted migration preserves existing records and finishes importing the remaining cards', (t) => {
  const { files, automations } = setup(t)
  const first = browserTabsFlow('first')
  const second = browserTabsFlow('second')
  fs.mkdirSync(path.dirname(files.legacyFile), { recursive: true })
  fs.writeFileSync(files.legacyFile, JSON.stringify({ 'flows.v1': [first, second] }))
  files.save({ ...first, title: 'Already edited' })
  assert.deepEqual(
    automations.list().map((flow) => flow.title),
    ['Already edited', second.title],
  )
  assert.equal(files.initialized(), true)
})

test('corrupt legacy and card files surface their filename and remain untouched', (t) => {
  const { files, automations } = setup(t)
  fs.mkdirSync(path.dirname(files.legacyFile), { recursive: true })
  fs.writeFileSync(files.legacyFile, 'broken json')
  assert.throws(() => automations.list(), /Cannot read.*automations.json/)
  assert.equal(files.initialized(), false)
  assert.equal(fs.readFileSync(files.legacyFile, 'utf8'), 'broken json')
  fs.writeFileSync(files.legacyFile, JSON.stringify({ 'flows.v1': [] }))
  automations.save(browserTabsFlow('tabs'))
  const card = files.cardFile('tabs')
  fs.writeFileSync(card, 'null')
  assert.throws(() => automations.save(browserTabsFlow('tabs')), /Cannot read.*tabs.json/)
  assert.equal(fs.readFileSync(card, 'utf8'), 'null')
})

test('failed card publication preserves the previous graph and values', (t) => {
  const { files, automations } = setup(t)
  const original = automations.save(browserTabsFlow('tabs'))
  const changed = structuredClone(original)
  changed.nodes[0].title = 'Different graph'
  const rename = fs.renameSync
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === files.cardFile('tabs')) throw new Error('Simulated disk error')
    return rename(from, to)
  })
  assert.throws(() => automations.save(changed), /Simulated disk error/)
  assert.deepEqual(automations.list()[0], original)
  assert.equal(
    fs.readdirSync(path.dirname(files.cardFile('tabs'))).some((file) => file.endsWith('.tmp')),
    false,
  )
})

test('ordering changes only per-card positions and unsafe identifiers cannot escape the data folder', (t) => {
  const { files, automations, directory } = setup(t)
  const first = automations.save(browserTabsFlow('first'))
  automations.save({ ...first, id: 'second' })
  const program = fs.readFileSync(files.programFile(first.programId), 'utf8')
  automations.reorder(['second', 'first'])
  assert.deepEqual(
    new Automations({ files: new AutomationFiles(directory) }).list().map((flow) => flow.id),
    ['second', 'first'],
  )
  assert.equal(fs.readFileSync(files.programFile(first.programId), 'utf8'), program)
  assert.throws(() => files.cardFile('../escape'), /Invalid card/)
  assert.throws(() => files.programFile('../escape'), /Invalid program/)
  assert.throws(() => automations.save({ ...first, programId: '../escape' }), /Invalid program/)
})
