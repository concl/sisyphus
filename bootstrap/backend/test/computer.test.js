const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Computer, WindowsDriver, helperCommand } = require('../../../plugins/computer/backend/lib/computer')
const { modelOutput, projectImages } = require('../../../plugins/chat/backend/lib/tool-images')
const image = { image: 'aW1hZ2U=', display: 0, width: 1600, height: 900, left: 0, top: 0, screenWidth: 1920, screenHeight: 1080 }
const context = runId => ({ runId, signal: new AbortController().signal })

test('Windows helper compiles and captures a scaled PNG with matching physical bounds', { skip: process.platform !== 'win32' }, async () => {
  const driver = new WindowsDriver()
  try {
    const frame = await driver.call({ action: 'screenshot' }, new AbortController().signal)
    const png = Buffer.from(frame.image, 'base64')
    assert.equal(png.subarray(1, 4).toString(), 'PNG')
    assert.equal(png.readUInt32BE(16), frame.width)
    assert.equal(png.readUInt32BE(20), frame.height)
    assert(frame.width <= 1600)
    assert(frame.screenWidth >= frame.width)
    assert(frame.displays.length > 0)
  } finally { driver.dispose() }
})

test('desktop ownership, fresh frames, serialization and release', async () => {
  const calls = []
  const desktop = new Computer({ call: async input => { calls.push(input); return image }, dispose() {} })
  const first = context('a'), second = context('b')
  await assert.rejects(desktop.execute('click', { screenshotId: 'none', x: 0, y: 0 }, first), /stale/)
  const frame = await desktop.execute('screenshot', {}, first)
  await assert.rejects(desktop.execute('screenshot', {}, second), /Another conversation/)
  const action = { screenshotId: frame.screenshotId, x: 10, y: 10 }
  const results = await Promise.allSettled([desktop.execute('click', action, first), desktop.execute('click', action, first)])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.equal(calls.filter(call => call.action === 'click').length, 1)
  desktop.release('a')
  await desktop.execute('screenshot', {}, second)
  desktop.dispose()
  await assert.rejects(desktop.execute('screenshot', {}, second), /stopped/)
})

test('cancellation prevents queued desktop input', async () => {
  const controller = new AbortController()
  const calls = []
  const desktop = new Computer({ call: async input => { calls.push(input); return image }, dispose() {} })
  const task = desktop.execute('screenshot', {}, { runId: 'a', signal: controller.signal })
  controller.abort()
  await assert.rejects(task, /ended/)
  assert.equal(calls.length, 0)
})

test('screenshots are image content, compatible projection is idempotent and removes old pixels', () => {
  const result = modelOutput({ output: { type: 'computer-screenshot', data: image.image, mediaType: 'image/png', screenshotId: 'frame-1' } })
  assert.equal(result.value[1].type, 'file')
  const tool = id => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'computer_screenshot', output: result }] })
  const messages = [tool('one'), tool('two')]
  const projected = projectImages(messages, true)
  assert.equal(projected[0].content[0].output.type, 'text')
  assert.equal(projected[1].content.length, 1)
  assert.equal(projected[3].content[1].type, 'image')
  assert.deepEqual(projectImages(projected, true), projected)
  assert.equal(projectImages(messages, false)[0].content[0].output.value.length, 1)
  assert.equal(projectImages(messages, false)[1].content[0].output.value.length, 2)
  assert.equal(messages[0].content[0].output.value.length, 2, 'source history is untouched')
})

test('click duration is optional, bounded and distinct from observation wait', async () => {
  const registered = new Map()
  const cleanup = []
  require('../../../plugins/computer/backend/computer')().apply({
    get: () => ({ register: (name, tool) => { registered.set(name, tool); return () => registered.delete(name) } }),
    effect: effect => cleanup.push(effect()),
  })
  try {
    const schema = registered.get('computer_click').inputSchema
    const base = { screenshotId: 'frame', x: 10, y: 10 }
    assert.equal(schema.parse(base).durationMs, 50)
    assert.equal(schema.parse({ ...base, durationMs: 0 }).durationMs, 0)
    assert.equal(schema.parse({ ...base, durationMs: 250, waitMs: 2000 }).waitMs, 2000)
    for (const durationMs of [-1, 1.5, 10001]) assert.equal(schema.safeParse({ ...base, durationMs }).success, false)
    assert(registered.has('computer_wait'))
  } finally { for (const dispose of cleanup) dispose?.() }
})

test('delayed observations retain uncertainty even when pixels are unchanged', async () => {
  const calls = [], waits = []
  const desktop = new Computer({ call: async input => { calls.push(input); return input.capture === false ? { inputSent: true } : image }, dispose() {} }, { delay: async ms => waits.push(ms) })
  const frame = await desktop.execute('screenshot', { display: 0 }, context('a'))
  const result = await desktop.execute('click', { screenshotId: frame.screenshotId, x: 10, y: 10, durationMs: 150, waitMs: 2000, expectedEffect: 'Menu opens' }, context('a'))
  assert.equal(calls.find(call => call.action === 'click').durationMs, 150)
  assert.equal(calls.find(call => call.action === 'click').capture, false)
  assert.deepEqual(waits, [2000, 250])
  assert.equal(result.actionStatus, 'input-sent')
  assert.equal(result.outcome, 'unverified')
  assert.equal(result.observation.visualChange, 'not-detected')
  assert.equal(result.observation.matchingSamples, true)
  assert.equal(result.observation.sampleIntervalMs, 250)
  assert.match(result.observation.verificationHint, /do NOT prove/)
  const count = calls.filter(call => call.action === 'click').length
  const waited = await desktop.execute('wait', { waitMs: 1500 }, context('a'))
  assert.equal(waited.actionStatus, 'observed')
  assert.equal(calls.filter(call => call.action === 'click').length, count)
})

test('a page changing between samples returns the latest image without inventing success', async () => {
  let shot = 0
  const desktop = new Computer({ call: async input => input.capture === false ? { inputSent: true } : { ...image, image: ++shot <= 2 ? image.image : 'bmV3LXBhZ2U=' }, dispose() {} }, { delay: async () => {} })
  const frame = await desktop.execute('screenshot', {}, context('a'))
  const result = await desktop.execute('click', { screenshotId: frame.screenshotId, x: 10, y: 10 }, context('a'))
  assert.equal(result.data, 'bmV3LXBhZ2U=')
  assert.equal(result.observation.visualChange, 'detected')
  assert.equal(result.observation.matchingSamples, false)
  assert.equal(result.outcome, 'unverified')
})

test('cancelling a post-input wait blocks capture and requires re-observation', async () => {
  const controller = new AbortController()
  const calls = []
  const desktop = new Computer({ call: async input => { calls.push(input); return image }, dispose() {} }, {
    delay: async () => { controller.abort(); throw new Error('stopped') },
  })
  const ctx = { runId: 'a', signal: controller.signal }
  const frame = await desktop.execute('screenshot', {}, ctx)
  await assert.rejects(desktop.execute('click', { screenshotId: frame.screenshotId, x: 0, y: 0 }, ctx), /Input was sent, but observation failed/)
  assert.equal(calls.length, 2)
  assert.equal(desktop.frame, null)
})

test('helper selection supports macOS and X11 with explicit Wayland limitations', () => {
  assert.equal(helperCommand('win32', {}).command, 'powershell.exe')
  assert.equal(helperCommand('darwin', {}).command, 'python3')
  assert.equal(helperCommand('linux', { DISPLAY: ':1', SISYPHUS_COMPUTER_PYTHON: '/tmp/venv/bin/python' }).command, '/tmp/venv/bin/python')
  assert.throws(() => helperCommand('linux', { WAYLAND_DISPLAY: 'wayland-0' }), /Wayland/)
  assert.throws(() => helperCommand('freebsd', {}), /does not support/)
})
