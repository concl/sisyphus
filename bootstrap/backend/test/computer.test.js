const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Computer, WindowsDriver } = require('../../../plugins/computer/backend/lib/computer')
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
