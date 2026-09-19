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
