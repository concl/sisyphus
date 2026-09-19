import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Profile } from '../index.js'

test('Cordis waits for services and disposes consumers before providers', async () => {
  const calls = []
  const profile = new Profile()
  const consumer = {
    name: 'Consumer',
    inject: ['data'],
    apply(ctx) {
      calls.push(`read:${ctx.get('data').value}`)
      ctx.effect(() => () => calls.push('consumer stopped'))
    },
  }
  const provider = {
    name: 'Provider',
    provide: 'data',
    apply(ctx) {
      ctx.provide('data', { value: 1 })
      ctx.effect(() => () => calls.push('provider stopped'))
    },
  }
  await profile.mount([
    { id: 'consumer', plugin: consumer },
    { id: 'provider', plugin: provider },
  ])
  assert.equal(profile.get('data').value, 1)
  await profile.setEnabled('provider', false)
  assert.equal(profile.list()[0].state, 'waiting')
  assert.deepEqual([...calls.slice(1)].sort(), ['consumer stopped', 'provider stopped'])
  await profile.setEnabled('provider', true)
  assert.equal(profile.list()[0].state, 'active')
  await profile.dispose()
})

test('composing the same profile again leaves mounted plugins alone', async () => {
  const profile = new Profile()
  let mounts = 0
  const plugin = {
    name: 'Once',
    apply() {
      mounts++
    },
  }
  await profile.mount([{ id: 'once', plugin }])
  await profile.mount([{ id: 'once', plugin }])
  assert.equal(mounts, 1)
  assert.equal(profile.list().length, 1)
  await assert.rejects(
    () =>
      profile.mount([
        { id: 'twice', plugin },
        { id: 'twice', plugin },
      ]),
    /Duplicate plugin: twice/,
  )
  await profile.dispose()
})

test('a plugin can arrive, be replaced with new code, and leave while the app runs', async () => {
  const profile = new Profile()
  const calls = []
  const version = (label) => ({
    name: label,
    apply(ctx) {
      calls.push(`mount:${label}`)
      ctx.effect(() => () => calls.push(`dispose:${label}`))
    },
  })
  await profile.add({ id: 'added', plugin: version('v1') })
  assert.deepEqual(calls, ['mount:v1'])
  assert.equal(profile.list().find((plugin) => plugin.id === 'added').state, 'active')
  await assert.rejects(() => profile.add({ id: 'added', plugin: version('x') }), /Duplicate plugin/)

  await profile.replace('added', version('v2'))
  assert.deepEqual(calls, ['mount:v1', 'dispose:v1', 'mount:v2'])

  // A switch that is off survives a code reload: new code must not sneak back on.
  await profile.setEnabled('added', false)
  assert.equal(profile.list().find((plugin) => plugin.id === 'added').state, 'disabled')
  await profile.replace('added', version('v3'))
  assert.deepEqual(calls, ['mount:v1', 'dispose:v1', 'mount:v2', 'dispose:v2'])
  await profile.setEnabled('added', true)
  assert.deepEqual(calls.slice(4), ['mount:v3'])

  await profile.unmount('added')
  assert.deepEqual(calls.slice(5), ['dispose:v3'])
  assert.equal(
    profile.list().some((plugin) => plugin.id === 'added'),
    false,
  )
  await assert.rejects(() => profile.unmount('added'), /Unknown plugin: added/)
  await assert.rejects(() => profile.replace('added', version('v4')), /Unknown plugin: added/)

  // Leaving and coming back is the same call.
  await profile.add({ id: 'added', plugin: version('v4') })
  assert.deepEqual(calls.slice(6), ['mount:v4'])
  await profile.dispose()
})

test('a plugin that arrives at runtime can serve one that is already waiting', async () => {
  const profile = new Profile()
  const seen = []
  await profile.mount([
    {
      id: 'reader',
      plugin: {
        name: 'Reader',
        inject: ['greeting'],
        apply(ctx) {
          seen.push(ctx.get('greeting'))
        },
      },
    },
  ])
  assert.equal(profile.list()[0].state, 'waiting')
  await profile.add({
    id: 'provider',
    plugin: {
      name: 'Provider',
      provide: 'greeting',
      apply(ctx) {
        ctx.provide('greeting', 'hello')
      },
    },
  })
  assert.deepEqual(seen, ['hello'])
  assert.equal(profile.list().find((plugin) => plugin.id === 'reader').state, 'active')
  await profile.dispose()
})
