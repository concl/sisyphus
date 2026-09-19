const path = require('node:path')
const { ScopedStore, isValidScope } = require('../lib/app-storage')
module.exports = (directory) => ({
  id: 'desktop.storage',
  inject: ['transport.v1'],
  provide: ['storage.v1'],
  apply(ctx) {
    const store = (scope) => {
      if (!isValidScope(scope) || scope === '.' || scope === '..')
        throw new Error('Invalid storage scope')
      return new ScopedStore(path.join(directory, `${scope}.json`))
    }
    const validate = (key) => {
      if (
        typeof key !== 'string' ||
        key.length > 256 ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      )
        throw new Error('Invalid storage key')
    }
    const storage = {
      get(scope, key) {
        validate(key)
        return store(scope).read(key)
      },
      set(scope, key, value) {
        validate(key)
        store(scope).write(key, value)
      },
    }
    ctx.provide('storage.v1', storage)
    const transport = ctx.get('transport.v1')
    ctx.effect(() => transport.handle('storage.get', ({ scope, key }) => storage.get(scope, key)))
    ctx.effect(() =>
      transport.handle('storage.set', ({ scope, key, value }) => storage.set(scope, key, value)),
    )
  },
})
