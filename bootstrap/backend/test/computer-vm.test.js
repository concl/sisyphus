const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { HelperDriver } = require('../../../plugins/computer/backend/lib/computer')
const { computerSettings } = require('../../../plugins/computer/backend/lib/computer-settings')
const { createVmGuest } = require('../../../plugins/computer/backend/lib/vm-guest')

const token = 'ab'.repeat(32)

test('desktop settings persist the toggle and keep the pairing token out of snapshots', () => {
  let stored
  const storage = {
    get: () => stored,
    set: (_, __, value) => {
      stored = value
    },
  }
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value.split('').reverse().join('')),
    decryptString: (value) => value.toString().split('').reverse().join(''),
  }
  const settings = computerSettings(storage, encryption)
  assert.deepEqual(settings.get(), { enabled: false, host: '', hasToken: false })
  assert.equal(settings.connection(), null)
  assert.throws(() => settings.save({ enabled: true, host: '-V', token }), /SSH host/)
  assert.throws(() => settings.save({ enabled: true, host: 'test-vm', token: '' }), /pairing token/)
  const saved = settings.save({ enabled: true, host: 'test-vm', token })
  assert.deepEqual(saved, { enabled: true, host: 'test-vm', hasToken: true })
  assert.notEqual(Buffer.from(stored.encryptedToken, 'base64').toString(), token)
  assert.deepEqual(computerSettings(storage, encryption).connection(), { host: 'test-vm', token })
  assert.throws(
    () => settings.save({ enabled: true, host: 'other-vm', token: '' }),
    /pairing token/,
  )
  settings.save({ enabled: false, host: 'test-vm', token: '' })
  assert.equal(settings.connection(), null)
  assert.equal(settings.get().hasToken, true)
  settings.save({ enabled: true, host: 'test-vm', token: '' })
  encryption.isEncryptionAvailable = () => false
  assert.throws(() => settings.connection(), /credential store/)
})

test(
  'VM mode authenticates and routes requests through the guest, then cancels input on disconnect',
  { timeout: 10000 },
  async () => {
    const calls = []
    let startInput, cancelInput
    const started = new Promise((resolve) => {
      startInput = resolve
    })
    const cancelled = new Promise((resolve) => {
      cancelInput = resolve
    })
    const server = createVmGuest(token, () => ({
      async call(request, signal) {
        calls.push(request)
        if (request.action === 'screenshot') return { image: 'guest pixels' }
        startInput()
        return new Promise((resolve) =>
          signal.addEventListener(
            'abort',
            () => {
              cancelInput()
              resolve({ inputSent: true })
            },
            { once: true },
          ),
        )
      },
      dispose() {},
    }))
    const sockets = new Set()
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const makeDriver = (pairingToken) =>
      new HelperDriver('win32', {
        connection: () => ({ host: 'test-vm', token: pairingToken }),
        spawnProcess(command, args, options) {
          assert.equal(command, 'ssh')
          assert.deepEqual(args.slice(-3), ['-W', '127.0.0.1:47631', 'test-vm'])
          const forward = `
        const socket = require('node:net').connect(${server.address().port}, '127.0.0.1')
        process.stdin.pipe(socket).pipe(process.stdout)
        socket.on('error', () => process.exit(1))
        socket.on('close', () => process.stdin.destroy())
      `
          return spawn(process.execPath, ['-e', forward], options)
        },
      })
    const wrong = makeDriver('ff'.repeat(32))
    const vm = makeDriver(token)
    try {
      await assert.rejects(wrong.call({ action: 'screenshot' }), /rejected the pairing token/)
      assert.deepEqual(calls, [])
      assert.deepEqual(await vm.call({ action: 'screenshot' }), { image: 'guest pixels' })
      const controller = new AbortController()
      const click = vm.call({ action: 'click', x: 5, y: 9 }, controller.signal)
      const stopped = assert.rejects(click, /Request stopped/)
      await started
      controller.abort()
      await stopped
      await cancelled
      await assert.rejects(vm.call({ action: 'click' }), /Take another screenshot/)
      assert.deepEqual(calls, [{ action: 'screenshot' }, { action: 'click', x: 5, y: 9 }])
    } finally {
      wrong.dispose()
      vm.dispose()
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    }
  },
)

test('an enabled VM driver cannot fall back to host input when configuration is unavailable', async () => {
  const driver = new HelperDriver('win32', {
    connection: () => null,
    spawnProcess: () => assert.fail('must not start a host helper'),
  })
  await assert.rejects(driver.call({ action: 'screenshot' }), /Complete the VM connection/)
})
