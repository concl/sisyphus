'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { ServiceSupervisor } = require('../lib/service-supervisor')

function fakeChild() {
  const child = new EventEmitter()
  child.pid = 1234
  child.exitCode = null
  child.killed = false
  child.kill = () => {
    child.killed = true
  }
  return child
}

function fakeFetch({ body = { status: 'ok' }, ok = true, error } = {}) {
  return async () => {
    if (error) throw error
    return { ok, json: async () => body }
  }
}

test('start spawns uvicorn with the service directory as cwd', () => {
  const spawned = []
  const svc = new ServiceSupervisor({
    hostDir: '/host',
    spawnFn: (cmd, args, opts) => {
      spawned.push({ cmd, args, opts })
      return fakeChild()
    },
  })
  svc.start()
  assert.equal(svc.running, true)
  assert.equal(spawned.length, 1)
  assert.equal(spawned[0].args[0], '-m')
  assert.equal(spawned[0].args[1], 'uvicorn')
  assert.equal(spawned[0].opts.cwd, '/host')
})

test('start is idempotent while running', () => {
  const child = fakeChild()
  let spawns = 0
  const svc = new ServiceSupervisor({
    hostDir: '/host',
    spawnFn: () => {
      spawns += 1
      return child
    },
  })
  svc.start()
  svc.start()
  assert.equal(spawns, 1)
})

test('health() reports healthy against a responding service', async () => {
  const svc = new ServiceSupervisor({ hostDir: '/host', spawnFn: () => fakeChild(), fetchFn: fakeFetch() })
  svc.start()
  assert.equal(await svc.health(), true)
  assert.deepEqual(svc.lastCheck, { ok: true })
})

test('health() reports failure when the service is unreachable', async () => {
  const svc = new ServiceSupervisor({
    hostDir: '/host',
    spawnFn: () => fakeChild(),
    fetchFn: fakeFetch({ error: new Error('refused') }),
  })
  svc.start()
  assert.equal(await svc.health(), false)
  assert.equal(svc.lastCheck.ok, false)
  assert.equal(svc.lastCheck.error, 'refused')
})

test('stop() kills the child and clears running state', () => {
  const child = fakeChild()
  const svc = new ServiceSupervisor({ hostDir: '/host', spawnFn: () => child })
  svc.start()
  svc.stop()
  assert.equal(child.killed, true)
  assert.equal(svc.running, false)
})
