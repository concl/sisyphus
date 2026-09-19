const { PythonHost } = require('./lib/python-host.js')
module.exports = (options) => ({
  id: 'desktop.python-host',
  inject: ['transport.v1'],
  provide: ['python.v1'],
  apply(ctx) {
    const host = new PythonHost(options)
    ctx.effect(() => () => host.dispose())
    ctx.provide('python.v1', host)
    const transport = ctx.get('transport.v1')
    ctx.effect(() => transport.handle('python.list', () => host.list()))
    ctx.effect(() => transport.handle('python.start', ({ id }) => host.start(id)))
    ctx.effect(() => transport.handle('python.stop', ({ id }) => host.stop(id)))
    ctx.effect(() => transport.handle('python.call', ({ id, path }) => host.call(id, path)))
  },
})
