import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Profile } from '../index.js'
import {
  PLUGIN_STATES_KEY,
  PLUGIN_STATES_SCOPE,
  applyStates,
  readStates,
  writeState,
} from '../preferences.js'

/** The native storage service answers synchronously; the renderer's does not. */
function memory(sync = true) {
  const data = new Map()
  const store = {
    get: (scope, key) => data.get(`${scope}:${key}`),
    set: (scope, key, value) => data.set(`${scope}:${key}`, value),
  }
  return sync
    ? store
    : {
        get: async (scope, key) => store.get(scope, key),
        set: async (scope, key, value) => store.set(scope, key, value),
      }
}

test('a switch is remembered for the next start, in either storage flavour', async () => {
  for (const storage of [memory(), memory(false)]) {
    assert.deepEqual(await readStates(storage), {})
    await writeState(storage, 'feature.chat', false)
    await writeState(storage, 'user.notes', false)
    await writeState(storage, 'feature.chat', true)
    assert.deepEqual(await readStates(storage), { 'feature.chat': true, 'user.notes': false })
  }
})

test('the stored document is shared between processes and shared by scope', async () => {
  const data = new Map()
  const native = {
    get: (scope, key) => data.get(`${scope}:${key}`),
    set: (scope, key, value) => data.set(`${scope}:${key}`, value),
  }
  const renderer = {
    get: async (scope, key) => data.get(`${scope}:${key}`),
    set: async (scope, key, value) => data.set(`${scope}:${key}`, value),
  }
  await writeState(native, 'desktop.files', false)
  await writeState(renderer, 'feature.terminal', false)
  assert.deepEqual(await readStates(renderer), {
    'desktop.files': false,
    'feature.terminal': false,
  })
  assert.equal(data.has(`${PLUGIN_STATES_SCOPE}:${PLUGIN_STATES_KEY}`), true)
  assert.equal(
    data.has(`${PLUGIN_STATES_SCOPE}:anything.else`),
    false,
    'one key holds every switch',
  )
})

test('nonsense in the document is ignored instead of breaking the boot', async () => {
  const storage = memory()
  storage.set(PLUGIN_STATES_SCOPE, PLUGIN_STATES_KEY, { good: false, bad: 'yes', worse: 3 })
  assert.deepEqual(await readStates(storage), { good: false })
  storage.set(PLUGIN_STATES_SCOPE, PLUGIN_STATES_KEY, ['not', 'a', 'document'])
  assert.deepEqual(await readStates(storage), {})
  storage.set(PLUGIN_STATES_SCOPE, PLUGIN_STATES_KEY, null)
  assert.deepEqual(await readStates(storage), {})
})

test('applying stored switches only touches plugins this process composes', async () => {
  const storage = memory()
  await writeState(storage, 'feature.chat', false)
  await writeState(storage, 'desktop.files', false)
  await writeState(storage, 'feature.home', true)
  const profile = new Profile()
  const calls = []
  const plugin = (id) => ({
    name: id,
    apply() {
      calls.push(id)
    },
  })
  await profile.mount([
    { id: 'feature.chat', plugin: plugin('feature.chat') },
    { id: 'feature.home', plugin: plugin('feature.home') },
  ])
  const off = await applyStates(profile, storage)
  assert.deepEqual(off, ['feature.chat'])
  assert.deepEqual(
    profile.list().map((entry) => [entry.id, entry.enabled]),
    [
      ['feature.chat', false],
      ['feature.home', true],
    ],
  )
  assert.deepEqual(calls, ['feature.chat', 'feature.home'])
  await profile.dispose()
})
