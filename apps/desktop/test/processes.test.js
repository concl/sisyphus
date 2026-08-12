'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { collectProcesses } = require('../lib/processes')

function fakeService(running = true) {
  return {
    running,
    child: running ? { pid: 42 } : null,
    url: 'http://127.0.0.1:8765',
    lastCheck: { ok: true },
    lastError: null,
  }
}

test('collectProcesses reports the managed service first', () => {
  const out = collectProcesses(fakeService(), new Map(), { backends: [] })
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'service')
  assert.equal(out[0].id, 'python-host')
  assert.equal(out[0].running, true)
  assert.equal(out[0].pid, 42)
})

test('collectProcesses includes terminal shells with backend names', () => {
  const ptys = new Map([['term-1', { pty: { pid: 7 }, backendId: 'powershell' }]])
  const out = collectProcesses(fakeService(), ptys, {
    backends: [{ id: 'powershell', name: 'PowerShell', command: 'x', args: [] }],
  })
  const term = out.find((p) => p.kind === 'terminal')
  assert.equal(term.name, 'PowerShell')
  assert.equal(term.pid, 7)
  assert.deepEqual(term.detail, { backendId: 'powershell' })
})

test('collectProcesses marks a stopped service as not running', () => {
  const out = collectProcesses(fakeService(false), new Map(), { backends: [] })
  assert.equal(out[0].running, false)
  assert.equal(out[0].pid, undefined)
})
