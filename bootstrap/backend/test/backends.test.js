'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { detectBackends } = require('../../../shared/backend/backends.js')

test('detectBackends returns a valid default shell on this platform', () => {
  const { backends, defaultId } = detectBackends()
  assert.ok(backends.length >= 1)
  assert.ok(backends.find((b) => b.id === defaultId))
  for (const b of backends) {
    assert.equal(typeof b.id, 'string')
    assert.equal(typeof b.name, 'string')
    assert.equal(typeof b.command, 'string')
    assert.ok(Array.isArray(b.args))
  }
})
